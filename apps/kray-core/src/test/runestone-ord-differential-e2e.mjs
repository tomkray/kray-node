/**
 * RUNESTONE ↔ ORD — THE DIFFERENTIAL PROOF, on real regtest transactions.
 *   HARNESS=<regtest harness dir> node src/test/runestone-ord-differential-e2e.mjs [--random N] [--seed S]
 *
 * WHY: the L2 credits runes by re-deriving the Runes allocation law from raw bytes with its OWN
 * decoder (runestone.ts: decipher + allocate). If that reading differs from ord's in any edge
 * case, an attacker can craft a transaction the L2 credits one way and Bitcoin settles another —
 * unbacked runes, the Liquid class of failure at the protocol-interpretation level. This suite
 * builds runestone transactions BYTE BY BYTE (edicts, pointers, spreads, mints, an etching,
 * cenotaphs of every flaw), mines each one for real, and compares EVERY output and EVERY burn
 * against ord. Inputs are taken from ord's own view before spending, so one disagreement can
 * never hide another. A single mismatch fails the run.
 *
 * Lab only: regtest bitcoind (the harness' `bc`), the ord server on :8081 (--index-runes), the
 * `kray` descriptor wallet for signing, the ord wallet for the initial rune hand-out. Nothing
 * here touches signet or mainnet.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TAG, FLAG, allocate, decipher, encodeVarint } from '../protocol/runestone.ts'

const HARNESS = process.env.HARNESS
if (!HARNESS || !existsSync(`${HARNESS}/bc`)) { console.error('✗ set HARNESS=<regtest harness dir with bc/ordw>'); process.exit(1) }
const ORD = process.env.ORD_URL || 'http://127.0.0.1:8081'
const argv = process.argv.slice(2)
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const RANDOM_N = parseInt(argOf('--random', '40'), 10)
const SEED = argOf('--seed', 'kray-runestone-differential-1')

const bc = (...a) => execFileSync(`${HARNESS}/bc`, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const bcJson = (...a) => JSON.parse(bc(...a))
const ordw = (...a) => execFileSync(`${HARNESS}/ordw`, a, { encoding: 'utf8' })
const ordGet = (p) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', ORD + p], { encoding: 'utf8' }))
const sleep = (s) => execFileSync('sleep', [String(s)])
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const fromHex = (h) => Uint8Array.from(Buffer.from(h, 'hex'))

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }

// ── the lab's runes: names ↔ ids (ord is the oracle for names) ────────────────────────────────
const GUARD = { name: 'KRAY•GUARDIAN•TEST', id: '31453:1' }   // premine, divisibility 2, no terms
const NETW = { name: 'KRAY•NETWORK', id: '27836:1' }           // open mint: amount 1 per mint, huge cap
const NAME_OF = new Map([[GUARD.id, GUARD.name], [NETW.id, NETW.name]])
const idOf = (name) => { for (const [id, n] of NAME_OF) if (n === name) return id; return null }
const runeEntry = (name) => { const d = ordGet('/rune/' + encodeURIComponent(name)); return d.entry || d }
const burnedOf = (name) => BigInt(String(runeEntry(name).burned ?? '0'))
const parseId = (s) => { const [b, t] = s.split(':'); return { block: BigInt(b), tx: BigInt(t) } }
const keyOf = (id) => `${id.block}:${id.tx}`

// ── raw transaction serialization (legacy shape; bitcoind adds the witness when it signs) ────────
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
const varint = (n) => n < 0xfd ? Buffer.from([n]) : n <= 0xffff ? Buffer.concat([Buffer.from([0xfd]), Buffer.from([n & 0xff, n >> 8])]) : (() => { throw new Error('too many') })()
function rawTx(inputs, outputs) {
  const parts = [u32le(2), varint(inputs.length)]
  for (const i of inputs) parts.push(Buffer.from(i.txid, 'hex').reverse(), u32le(i.vout), Buffer.from([0]), u32le(0xfffffffd))
  parts.push(varint(outputs.length))
  for (const o of outputs) { const s = Buffer.from(o.script); parts.push(u64le(o.sats), varint(s.length), s) }
  parts.push(u32le(0))
  return Buffer.concat(parts).toString('hex')
}

/** Build a runestone output script from integers: OP_RETURN OP_13 + data pushes (≤75 bytes each). */
function stone(ints, { opcodeInside = false, noOp13 = false, extraPushdata1 = false } = {}) {
  const body = []
  for (const n of ints) body.push(...encodeVarint(n))
  const out = noOp13 ? [0x6a] : [0x6a, 0x5d]
  if (extraPushdata1) { out.push(0x4c, body.length, ...body) }   // OP_PUSHDATA1 form of the same payload
  else for (let i = 0; i < body.length; i += 75) { const chunk = body.slice(i, i + 75); out.push(chunk.length, ...chunk) }
  if (opcodeInside) out.push(0xac)   // OP_CHECKSIG inside a runestone → cenotaph (non-push opcode)
  return Uint8Array.from(out)
}
const rawStone = (bytes) => Uint8Array.from([0x6a, 0x5d, ...bytes])   // hand-written payload bytes (for a broken varint)

// ── the lab wallet: addresses, funding, signing ──────────────────────────────────────────────────
const newAddr = () => bc('getnewaddress', '', 'bech32m')
const scriptOf = (addr) => fromHex(bcJson('getaddressinfo', addr).scriptPubKey)
const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
function ordSync() {
  const h = bc('getblockcount')
  let seen = '?'
  for (let i = 0; i < 600; i++) { try { seen = String(ordGet('/r/blockheight')); if (seen === h) return } catch {} sleep(0.5) }
  throw new Error(`ord did not reach the tip (bitcoind ${h}, ord ${seen}) — the lab's ord is behind or down, not a protocol verdict`)
}
/** a fresh cardinal UTXO of the kray wallet (fee + change source) */
function cardinal(minSats = 200_000) {
  const u = bcJson('listunspent', '1', '9999999').filter((x) => x.spendable && Math.round(x.amount * 1e8) >= minSats && !x.txid.startsWith('runic-'))
  if (!u.length) throw new Error('no cardinal utxo')
  const x = u[0]
  return { txid: x.txid, vout: x.vout, sats: Math.round(x.amount * 1e8), script: fromHex(x.scriptPubKey) }
}
/** sign with the kray wallet, mine the tx into its own block (consensus-only; bypasses relay standardness) */
function mineTx(unsignedHex) {
  const s = bcJson('signrawtransactionwithwallet', unsignedHex)
  if (!s.complete) throw new Error('sign failed: ' + JSON.stringify(s.errors || s).slice(0, 300))
  const r = bcJson('generateblock', bc('getnewaddress'), JSON.stringify([s.hex]))
  const blk = bcJson('getblock', r.hash, 1)
  const txid = bcJson('decoderawtransaction', s.hex).txid
  const index = blk.tx.indexOf(txid)
  if (index < 0) throw new Error('mined tx not in its block')
  ordSync()
  return { txid, height: blk.height, index, hex: s.hex }
}
/** ord's runes on an outpoint → Map<name, amount(base units)> */
function ordRunes(txid, vout) {
  const o = ordGet(`/output/${txid}:${vout}`)
  const m = new Map()
  for (const [name, r] of Object.entries(o.runes || {})) m.set(name, BigInt(r.amount ?? r))
  return m
}

// ── the pool of rune-bearing outpoints the kray wallet owns (ord's view, never ours) ───────────
const pool = []   // { txid, vout, script, sats, runes: Map<name, amount> }
function takeRunes(want = 1, names = null) { // the richest outpoints first; `names` = one outpoint holding each named rune
  if (names) { const out = []; for (const nm of names) { const i = pool.findIndex((p) => p.runes.has(nm) && !out.includes(p)); if (i < 0) throw new Error(`no outpoint holding ${nm} in the pool — reorder the cases`); out.push(pool.splice(i, 1)[0]) } return out }
  pool.sort((a, b) => { const sa = [...a.runes.values()].reduce((t, v) => t + v, 0n); const sb = [...b.runes.values()].reduce((t, v) => t + v, 0n); return sa === sb ? 0 : (sb > sa ? 1 : -1) })
  return pool.splice(0, Math.min(want, pool.length))
}

/** the pool's total base units of the premine rune */
const poolTotal = () => pool.reduce((t, p) => t + (p.runes.get(GUARD.name) ?? 0n), 0n)
/** cenotaphs BURN for real: when the pool runs low, the ord wallet hands the kray wallet a fresh stock */
function replenish() {
  if (pool.length >= 2 && poolTotal() >= 60_000n) return
  const addr = newAddr()
  const sent = JSON.parse(ordw('send', '--fee-rate', '1', addr, `6000:${GUARD.name}`))   // 6000.00 → 600000 base units
  mine(1); ordSync()
  const tx = bcJson('getrawtransaction', sent.txid, 'true')
  const vout = tx.vout.findIndex((o) => o.scriptPubKey.address === addr)
  const runes = ordRunes(sent.txid, vout)
  if (runes.get(GUARD.name) !== 600000n) throw new Error('replenish: ord does not show the fresh stock')
  pool.push({ txid: sent.txid, vout, script: scriptOf(addr), sats: Math.round(tx.vout[vout].value * 1e8), runes })
  console.log(`   · pool replenished: +600000 base units of ${GUARD.name} (ord's view)`)
}

// ── one differential case: build → mine → compare every output + every burn with ord ────────────
let caseNo = 0
function runCase(label, build) {
  caseNo++
  replenish()
  const runeIns = takeRunes(build.inputs ?? 1, build.names ?? null)
  if (!runeIns.length) throw new Error('the pool ran dry')
  const fee = cardinal()
  // ord's own view of the inputs BEFORE they are spent — the oracle for the input state
  const inputRunes = []
  for (const i of runeIns) for (const [name, amount] of i.runes) inputRunes.push({ id: parseId(idOf(name)), amount, name })
  const nOut = build.outputs
  const addrs = Array.from({ length: nOut }, () => newAddr())
  const scripts = addrs.map(scriptOf)
  // place the runestone (or other OP_RETURNs) at the requested indices
  const outputs = scripts.map((script) => ({ script, sats: 1000 }))
  const opret = build.opret || []           // [{ at, script }]
  for (const o of opret) outputs.splice(o.at, 0, { script: o.script, sats: 0 })
  const outScripts = outputs.map((o) => o.script)
  const inSats = runeIns.reduce((t, i) => t + i.sats, 0) + fee.sats
  const outSats = outputs.reduce((t, o) => t + o.sats, 0)
  const feeSats = 5000
  const change = inSats - outSats - feeSats
  if (change < 1000) throw new Error('not enough sats')
  const changeAddr = newAddr()
  outputs.push({ script: scriptOf(changeAddr), sats: change })
  outScripts.push(outputs[outputs.length - 1].script)
  const mintAmount = build.mintAmount
  const burnedBefore = new Map([...NAME_OF.values()].map((n) => [n, burnedOf(n)]))

  const mined = mineTx(rawTx([...runeIns.map((i) => ({ txid: i.txid, vout: i.vout })), { txid: fee.txid, vout: fee.vout }], outputs))
  const etchedId = build.etches ? { block: BigInt(mined.height), tx: BigInt(mined.index) } : undefined
  if (etchedId) {
    // ord assigns a reserved name to a nameless etching — learn it from ord, never guess
    const ent = ordGet(`/rune/${etchedId.block}:${etchedId.tx}`)
    const nm = (ent.entry || ent).spaced_rune || (ent.entry || ent).rune
    if (nm) NAME_OF.set(keyOf(etchedId), nm)
  }

  // OURS
  const art = decipher(outScripts)
  const ours = allocate(art, { outputScripts: outScripts, inputs: inputRunes.map((r) => ({ id: r.id, amount: r.amount })), mintAmount, etchedId })
  // ORD
  let mismatch = []
  for (let v = 0; v < outputs.length; v++) {
    const theirs = ordRunes(mined.txid, v)
    const mine_ = new Map()
    for (const b of ours.outputs.get(v) || []) { const n = NAME_OF.get(keyOf(b.id)) || keyOf(b.id); mine_.set(n, (mine_.get(n) ?? 0n) + b.amount) }
    const names = new Set([...theirs.keys(), ...mine_.keys()])
    for (const n of names) if ((theirs.get(n) ?? 0n) !== (mine_.get(n) ?? 0n)) mismatch.push(`vout ${v} ${n}: ord ${theirs.get(n) ?? 0n} vs ours ${mine_.get(n) ?? 0n}`)
    // refill the pool from ord's answer (only outputs the kray wallet owns: not OP_RETURN)
    if (theirs.size && outputs[v].script[0] !== 0x6a) pool.push({ txid: mined.txid, vout: v, script: outputs[v].script, sats: outputs[v].sats, runes: theirs })
  }
  // burns: the rune entries' `burned` counters move by exactly what we say burned
  const ourBurn = new Map()
  for (const b of ours.burned) { const n = NAME_OF.get(keyOf(b.id)) || keyOf(b.id); ourBurn.set(n, (ourBurn.get(n) ?? 0n) + b.amount) }
  for (const [n, before] of burnedBefore) {
    const delta = burnedOf(n) - before
    if (delta !== (ourBurn.get(n) ?? 0n)) mismatch.push(`burned ${n}: ord +${delta} vs ours +${ourBurn.get(n) ?? 0n}`)
  }
  const kind = art === null ? 'no runestone' : art.kind === 'cenotaph' ? `cenotaph(${art.flaws.join(',')})` : 'runestone'
  ok(mismatch.length === 0, `#${caseNo} ${label} — ${kind}, ${outputs.length} outputs, ${inputRunes.length} rune input(s) → ord agrees on every output and every burn${mismatch.length ? '\n        ' + mismatch.join('\n        ') : ''}`)
  return { mined, art, ours }
}

// ── seeded randomness (reproducible cases) ────────────────────────────────────────────────────
let seedState = createHash('sha256').update(SEED).digest()
const rnd = () => { seedState = createHash('sha256').update(seedState).digest(); return seedState.readUInt32BE(0) / 0x1_0000_0000 }
const pick = (n) => Math.floor(rnd() * n)
const bigPick = (max) => BigInt(pick(Number(max > 1_000_000_000n ? 1_000_000_000n : max) + 1))

async function main() {
  console.log(`\n╔═ RUNESTONE ↔ ORD DIFFERENTIAL — real regtest transactions, every output and burn compared (seed ${SEED}) ═╗`)
  const ordVersion = execFileSync('ord', ['--version'], { encoding: 'utf8' }).trim()
  console.log(`   ord: ${ordVersion} · chain height ${bc('getblockcount')}`)

  // ── 0 · hand the kray wallet a stock of both runes (ord wallet → kray wallet, ord's own send) ──
  const stockAddr = newAddr()
  const sent = JSON.parse(ordw('send', '--fee-rate', '1', stockAddr, `4000:${GUARD.name}`))   // 4000.00 → 400000 base units
  mine(1); ordSync()
  const stockTx = bcJson('getrawtransaction', sent.txid, 'true')
  const stockVout = stockTx.vout.findIndex((o) => o.scriptPubKey.address === stockAddr)
  const stockRunes = ordRunes(sent.txid, stockVout)
  ok(stockRunes.get(GUARD.name) === 400000n, `stock: the kray wallet holds ${stockRunes.get(GUARD.name)} base units of ${GUARD.name} (ord's view)`)
  pool.push({ txid: sent.txid, vout: stockVout, script: scriptOf(stockAddr), sats: Math.round(stockTx.vout[stockVout].value * 1e8), runes: stockRunes })

  const G = parseId(GUARD.id), N = parseId(NETW.id)
  const edict = (id, amount, output) => [id.block, id.tx, amount, BigInt(output)]
  // an edict list encodes as deltas from (0,0): sort by id, then delta-encode
  const body = (edicts) => {
    const sorted = [...edicts].sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : (a[0] < b[0] ? -1 : 1)))
    const ints = [TAG.Body]; let pb = 0n, pt = 0n
    for (const [b, t, amt, out] of sorted) { const db = b - pb; const dt = db === 0n ? t - pt : t; ints.push(db, dt, amt, out); pb = b; pt = t }
    return ints
  }

  // ── 1 · deterministic edge cases ─────────────────────────────────────────────────────────────
  console.log('\n─ deterministic edge cases ─')
  runCase('one edict to output 1', { outputs: 3, opret: [{ at: 3, script: stone([...body([edict(G, 1000n, 1)])]) }] })
  runCase('edict amount 0 = ALL of it, to output 2', { outputs: 3, opret: [{ at: 3, script: stone([...body([edict(G, 0n, 2)])]) }] })
  runCase('pointer to output 1, no edicts (everything lands on the pointer)', { outputs: 3, opret: [{ at: 3, script: stone([TAG.Pointer, 1n]) }] })
  runCase('no runestone at all → first non-OP_RETURN output', { outputs: 3 })
  runCase('spread: edict output = n, amount 0 (even split, remainder to the first outputs)', { outputs: 4, opret: [{ at: 0, script: stone([...body([edict(G, 0n, 6)])]) }] })   // T = 4 + 1 + change = 6
  runCase('spread: edict output = n, fixed amount per output, clamped', { outputs: 3, opret: [{ at: 3, script: stone([...body([edict(G, 7n, 5)])]) }] })   // T = 3 + 1 + change = 5
  runCase('edict amount larger than the balance → clamped, never invented', { outputs: 2, opret: [{ at: 2, script: stone([...body([edict(G, 999_999_999n, 1)])]) }] })
  runCase('two edicts same rune, cumulative, second clamps', { outputs: 3, opret: [{ at: 3, script: stone([...body([edict(G, 5000n, 1), edict(G, 999_999n, 2)])]) }] })
  runCase('edict for a rune NOT in the inputs → ignored', { outputs: 2, opret: [{ at: 2, script: stone([...body([edict(N, 5n, 1)])]) }] })
  runCase('edict to the OP_RETURN output itself → burned', { outputs: 2, opret: [{ at: 0, script: stone([...body([edict(G, 3000n, 0)])]) }] })
  runCase('pointer AT the OP_RETURN output → the remainder burns', { outputs: 2, opret: [{ at: 1, script: stone([TAG.Pointer, 1n]) }] })
  runCase('unrecognized ODD tag → ignored (the parity rule), edict still applies', { outputs: 2, opret: [{ at: 2, script: stone([125n, 7n, ...body([edict(G, 100n, 1)])]) }] })
  runCase('ordinary OP_RETURN (no OP_13) + runes → not a runestone, first non-OP_RETURN gets all', { outputs: 2, opret: [{ at: 0, script: Uint8Array.from([0x6a, 0x04, 0x64, 0x65, 0x61, 0x64]) }] })
  runCase('TWO runestone outputs: the FIRST decides (the second is data)', { outputs: 3, opret: [{ at: 1, script: stone([...body([edict(G, 200n, 0)])]) }, { at: 3, script: stone([...body([edict(G, 999n, 2)])]) }] })
  runCase('payload split across an OP_PUSHDATA1 push (same bytes, different push form)', { outputs: 2, opret: [{ at: 2, script: stone([...body([edict(G, 250n, 1)])], { extraPushdata1: true }) }] })
  // cenotaphs — every flaw the specification names, on a live transaction: ord must BURN the inputs
  runCase('CENOTAPH: unrecognized EVEN tag', { outputs: 2, opret: [{ at: 2, script: stone([124n, 1n, ...body([edict(G, 100n, 1)])]) }] })
  runCase('CENOTAPH: edict output past the last output', { outputs: 2, opret: [{ at: 2, script: stone([...body([edict(G, 100n, 9)])]) }] })
  runCase('CENOTAPH: pointer past the last output', { outputs: 2, opret: [{ at: 2, script: stone([TAG.Pointer, 9n]) }] })
  runCase('CENOTAPH: rune id with block 0 and tx ≠ 0', { outputs: 2, opret: [{ at: 2, script: stone([TAG.Body, 0n, 1n, 1n, 0n]) }] })
  runCase('CENOTAPH: trailing integers that cannot form an edict', { outputs: 2, opret: [{ at: 2, script: stone([TAG.Body, 1n, 1n, 1n]) }] })
  runCase('CENOTAPH: a tag with no value after it (truncated field)', { outputs: 2, opret: [{ at: 2, script: stone([TAG.Flags]) }] })
  runCase('CENOTAPH: unrecognized FLAG bit', { outputs: 2, opret: [{ at: 2, script: stone([TAG.Flags, 1n << 30n]) }] })
  runCase('CENOTAPH: non-push opcode inside the runestone', { outputs: 2, opret: [{ at: 2, script: stone([...body([edict(G, 100n, 1)])], { opcodeInside: true }) }] })
  runCase('CENOTAPH: a truncated varint (0x80 with nothing after)', { outputs: 2, opret: [{ at: 2, script: rawStone([0x01, 0x80]) }] })
  runCase('CENOTAPH: a varint longer than 18 bytes', { outputs: 2, opret: [{ at: 2, script: rawStone([0x14, ...new Array(19).fill(0x80), 0x00]) }] })
  // mints of the open-mint rune (terms: amount 1) — the caller supplies mintAmount from the terms, as the reducer does
  runCase('MINT of KRAY•NETWORK (amount 1) + edict of the minted unit to output 1', { outputs: 2, mintAmount: 1n, opret: [{ at: 2, script: stone([TAG.Mint, N.block, TAG.Mint, N.tx, ...body([edict(N, 1n, 1)])]) }] })
  runCase('two runes in the inputs, one edict each (delta encoding across ids)', { outputs: 3, names: [GUARD.name, NETW.name], opret: [{ at: 3, script: stone([...body([edict(G, 10n, 1), edict(N, 1n, 2)])]) }] })
  runCase('MINT + pointer: the minted unit lands on the pointer with the other rune', { outputs: 3, mintAmount: 1n, opret: [{ at: 3, script: stone([TAG.Mint, N.block, TAG.Mint, N.tx, TAG.Pointer, 2n]) }] })
  runCase('MINT inside a CENOTAPH: the mint counts and BURNS with everything else', { outputs: 2, mintAmount: 1n, opret: [{ at: 2, script: stone([TAG.Mint, N.block, TAG.Mint, N.tx, 124n, 1n]) }] })
  runCase('MINT of a rune id that does not exist → nothing minted, inputs flow as usual', { outputs: 2, mintAmount: undefined, opret: [{ at: 2, script: stone([TAG.Mint, 1n, TAG.Mint, 1n]) }] })
  // an etching WITHOUT a name (reserved name: no commitment needed) — premine + etch-relative edict 0:0
  runCase('ETCHING (nameless, reserved) with premine 1000 + edict 0:0 → output 1 + pointer 0', {
    outputs: 2, etches: true,
    opret: [{ at: 2, script: stone([TAG.Flags, FLAG_ETCHING(), TAG.Premine, 1000n, TAG.Divisibility, 0n, TAG.Pointer, 0n, TAG.Body, 0n, 0n, 600n, 1n]) }],
  })

  // ── 2 · randomized cases (seeded) ────────────────────────────────────────────────────────────
  console.log(`\n─ ${RANDOM_N} seeded random cases ─`)
  for (let i = 0; i < RANDOM_N; i++) {
    const nOut = 1 + pick(5)
    const ints = []
    const roll = rnd()
    const opretAt = pick(nOut + 1)
    const ins = 1 + pick(Math.max(1, Math.min(2, pool.length - 1)))
    let mintAmount
    if (roll < 0.15) { ints.push(TAG.Mint, N.block, TAG.Mint, N.tx); mintAmount = 1n }
    if (rnd() < 0.5) ints.push(TAG.Pointer, BigInt(pick(nOut + 1)))          // may point AT the OP_RETURN → burn
    if (rnd() < 0.1) ints.push(125n, BigInt(pick(1000)))                        // an odd tag: ignored
    const nEd = pick(4)
    const eds = []
    for (let k = 0; k < nEd; k++) {
      const id = rnd() < 0.8 ? G : N
      const amount = rnd() < 0.25 ? 0n : bigPick(rnd() < 0.7 ? 20_000n : 1_000_000n)
      const T = nOut + 2                                                          // rune outputs + the OP_RETURN + change
      const output = pick(T + 2)                                                  // 0..T+1: T = spread, T+1 = past the end → cenotaph
      eds.push(edict(id, amount, output))
    }
    if (eds.length) ints.push(...body(eds))
    if (rnd() < 0.05) ints.push(124n, 1n)                                        // an even unknown tag: cenotaph
    runCase(`random ${i + 1} (${nOut} outputs, ${nEd} edicts${mintAmount ? ', mint' : ''})`, { outputs: nOut, inputs: ins, mintAmount, opret: [{ at: opretAt, script: stone(ints) }] })
  }

  console.log(`\n╚═ ${pass} passed, ${fail} FAILED — ${fail === 0 ? 'OUR READING OF THE RUNES PROTOCOL EQUALS ORD ON EVERY BYTE WE THREW AT IT' : 'A DIVERGENCE FROM ORD: see the ✗ lines — this is exactly the class of bug that emptied Liquid'} ₿⇄₭`)
  process.exit(fail === 0 ? 0 : 1)
}
function FLAG_ETCHING() { return 1n << FLAG.Etching }

main().catch((e) => { console.error('✗ differential aborted:', e.message); process.exit(1) })
