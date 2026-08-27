/**
 * RUNE ANCESTRY — a deposit proven from bytes, and every broken bundle refused.
 *   node src/test/rune-ancestry.test.ts
 *
 * This is the question the L2 mint must answer: "how many runes really landed
 * in this vault?" Answering it wrong in either direction is money — too much
 * credits an L2 with runes that do not exist, too little robs the depositor. So
 * every path here either PROVES the number or REFUSES and names why.
 *
 * The chain built below is a real one in miniature: an etch with a premine, a
 * transfer that splits it, and a deposit into a vault. Each link carries its own
 * Bitcoin inclusion proof, and each attack removes or corrupts exactly one thing.
 */
import { proveDeposit, proveOutpoint, outpointKey, type ProvenTx } from '../protocol/rune-ancestry.ts'
import { TAG, FLAG, encodeVarint, runeValue, type RuneId } from '../protocol/runestone.ts'
import { checkProofOfWork, sha256d, toDisplayHex } from '../anchor/spv.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}

// ── a miniature Bitcoin: raw txs, real merkle proofs, real header chains ────
const varintBytes = (n: number): number[] => (n < 0xfd ? [n] : [0xfd, n & 0xff, n >> 8])
function rawTx(inputs: Array<{ txid: string; vout: number }>, outputs: Uint8Array[]): string {
  const b: number[] = [0x01, 0x00, 0x00, 0x00, ...varintBytes(inputs.length)]
  for (const i of inputs) {
    b.push(...Buffer.from(i.txid, 'hex').reverse()) // outpoints are internal order
    b.push(i.vout & 0xff, (i.vout >> 8) & 0xff, (i.vout >> 16) & 0xff, (i.vout >> 24) & 0xff)
    b.push(0x00, 0xff, 0xff, 0xff, 0xff)
  }
  b.push(...varintBytes(outputs.length))
  for (const o of outputs) { b.push(...new Array(8).fill(0), ...varintBytes(o.length), ...o) }
  b.push(0x00, 0x00, 0x00, 0x00)
  return Buffer.from(b).toString('hex')
}
function header(prevInternal: Buffer, merkleInternal: Buffer, nonce: number): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); merkleInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000, 68); h.writeUInt32LE(0x207fffff, 72)
  // MINED, because the ancestry path now weighs headers exactly as the seal path
  // does: a chained list of unmined headers is free to make, and a deposit proven
  // by a burial nobody paid for would credit runes that never moved.
  for (let n = nonce; n < nonce + 1_000_000; n++) {
    h.writeUInt32LE(n >>> 0, 76)
    if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h
  }
  throw new Error('unmineable')
  return h
}
/** Bury a single-transaction block, `confs` deep, with a valid merkle proof. */
function bury(raw: string, nonce: number, confs = 2): { txoutproof: string; headers: string[] } {
  const txid = sha256d(Buffer.from(raw, 'hex'))
  const h1 = header(Buffer.alloc(32, nonce), txid, nonce) // a 1-tx block: the root IS the txid
  const headers = [h1]
  for (let i = 1; i < confs; i++) headers.push(header(sha256d(headers[i - 1]), Buffer.alloc(32, i), nonce * 100 + i))
  const txoutproof = Buffer.concat([h1, Buffer.from([1, 0, 0, 0]), Buffer.from([1]), txid, Buffer.from([1]), Buffer.from([0x01])]).toString('hex')
  return { txoutproof, headers: headers.map((h) => h.toString('hex')) }
}
const txidOf = (raw: string): string => toDisplayHex(sha256d(Buffer.from(raw, 'hex')))
function stone(ints: bigint[]): Uint8Array {
  const body: number[] = []
  for (const n of ints) body.push(...encodeVarint(n))
  const out = [0x6a, 0x5d]
  for (let i = 0; i < body.length; i += 75) { const c = body.slice(i, i + 75); out.push(c.length, ...c) }
  return Uint8Array.from(out)
}
const script = (fill: number): Uint8Array => Uint8Array.from([0x51, 0x20, ...new Array(32).fill(fill)])
const OWNER = script(0x11), VAULT = script(0x22), OTHER = script(0x33)
const RUNE: RuneId = { block: 900_000n, tx: 7n }

function main() {
  // ── THE CHAIN: etch(premine 1000 → owner) → split(600 owner / 400 other) → deposit(600 → vault)
  const etchRaw = rawTx([{ txid: '00'.repeat(32), vout: 0 }], [
    OWNER,
    stone([TAG.Flags, 1n << FLAG.Etching, TAG.Rune, runeValue('KRAYVAULTDEMO'), TAG.Premine, 1000n]),
  ])
  const etch: ProvenTx = { rawTx: etchRaw, ...bury(etchRaw, 1), etchedId: RUNE }

  const splitRaw = rawTx([{ txid: txidOf(etchRaw), vout: 0 }], [
    OWNER, OTHER,
    stone([TAG.Body, RUNE.block, RUNE.tx, 400n, 1n]), // 400 to output 1, the rest to output 0
  ])
  const split: ProvenTx = { rawTx: splitRaw, ...bury(splitRaw, 2) }

  const depRaw = rawTx([{ txid: txidOf(splitRaw), vout: 0 }], [VAULT, OWNER])
  const dep: ProvenTx = { rawTx: depRaw, ...bury(depRaw, 3) }
  const bundle = [etch, split, dep]
  const opts = { minConfirmations: 2, net: 'regtest', rune: RUNE }

  // ── 1 · THE PREMINE IS PROVEN BY THE ETCH TRANSACTION ALONE ──────────────
  const v0 = proveOutpoint(txidOf(etchRaw), 0, [etch], opts)
  ok(v0.ok && v0.balances?.[0].amount === 1000n, `the premine is proven from the etch alone — 1,000 runes to its first output`)

  // ── 2 · THE ALLOCATION LAW CARRIES DOWN THE CHAIN ────────────────────────
  const v1 = proveOutpoint(txidOf(splitRaw), 0, bundle, opts)
  const v2 = proveOutpoint(txidOf(splitRaw), 1, bundle, opts)
  ok(v1.ok && v1.balances?.[0].amount === 600n, 'the split leaves 600 on output 0 (the unallocated remainder)')
  ok(v2.ok && v2.balances?.[0].amount === 400n, '…and the edict put exactly 400 on output 1')
  ok((v1.balances?.[0].amount ?? 0n) + (v2.balances?.[0].amount ?? 0n) === 1000n, 'nothing was created and nothing lost across the split')

  // ── 3 · THE DEPOSIT, WHICH IS THE QUESTION THE L2 MINT ASKS ──────────────
  const d = proveDeposit(txidOf(depRaw), Buffer.from(VAULT).toString('hex'), RUNE, bundle, opts)
  ok(d.ok && d.amount === 600n && d.vout === 0, `THE DEPOSIT IS PROVEN FROM BYTES: 600 runes landed in the vault (output ${d.vout})`)
  // Asking about a DIFFERENT rune cannot be answered "zero": to claim the vault
  // holds none of rune X you must prove X's ancestry too, and an unknown input
  // might have carried it. Refusing is the honest answer — a proof of absence is
  // still a proof, and this bundle does not contain one.
  const wrongRune = proveDeposit(txidOf(depRaw), Buffer.from(VAULT).toString('hex'), { block: 900_000n, tx: 8n }, bundle, opts)
  ok(!wrongRune.ok && wrongRune.reason === 'input-unknown', 'a DIFFERENT rune is REFUSED, not answered zero — proving absence needs its own ancestry')
  const notTheVault = proveDeposit(txidOf(depRaw), Buffer.from(OTHER).toString('hex'), RUNE, bundle, opts)
  ok(!notTheVault.ok && notTheVault.reason === 'no-such-output', 'an output that does not pay the vault is not a deposit — matched by SCRIPT, never by an index the claimant picks')

  // ── 4 · EVERY BROKEN BUNDLE IS REFUSED, AND NAMES ITSELF ─────────────────
  const missing = proveOutpoint(txidOf(depRaw), 0, [dep, split], opts) // the etch is gone
  ok(!missing.ok && missing.reason === 'input-unknown', 'ATTACK: an ancestry with a link REMOVED → refused (input-unknown), never assumed to be zero')

  const shallow = proveOutpoint(txidOf(etchRaw), 0, [{ ...etch, headers: etch.headers.slice(0, 1) }], opts)
  ok(!shallow.ok && shallow.reason === 'tx-shallow', 'ATTACK: a transaction buried less deep than the law demands → refused')

  const swapped = proveOutpoint(txidOf(etchRaw), 0, [{ ...etch, txoutproof: bury(splitRaw, 2).txoutproof }], opts)
  ok(!swapped.ok && swapped.reason === 'txid-mismatch', 'ATTACK: a merkle proof belonging to ANOTHER transaction → refused')

  const forgedTx = rawTx([{ txid: txidOf(splitRaw), vout: 0 }], [VAULT, OWNER, stone([TAG.Body, RUNE.block, RUNE.tx, 999_999n, 0n])])
  const inflated = proveDeposit(txidOf(forgedTx), Buffer.from(VAULT).toString('hex'), RUNE, [etch, split, { rawTx: forgedTx, ...bury(forgedTx, 4) }], opts)
  ok(inflated.ok && inflated.amount === 600n, 'ATTACK: an edict claiming 999,999 credits only the 600 that exist — the allocation law CLAMPS, it never invents')

  const cenoRaw = rawTx([{ txid: txidOf(splitRaw), vout: 0 }], [VAULT, stone([124n, 1n])]) // an unrecognized even tag
  const ceno = proveDeposit(txidOf(cenoRaw), Buffer.from(VAULT).toString('hex'), RUNE, [etch, split, { rawTx: cenoRaw, ...bury(cenoRaw, 5) }], opts)
  ok(ceno.ok && ceno.amount === 0n, 'a CENOTAPH deposit credits ZERO — Bitcoin burned those runes, and an L2 that missed it would be insolvent')

  // ── 5 · WHAT CANNOT BE PROVEN LOCALLY IS REFUSED, NOT GUESSED ────────────
  const mintRaw = rawTx([{ txid: txidOf(splitRaw), vout: 0 }], [VAULT, stone([TAG.Mint, RUNE.block, TAG.Mint, RUNE.tx])])
  const mint = proveDeposit(txidOf(mintRaw), Buffer.from(VAULT).toString('hex'), RUNE, [etch, split, { rawTx: mintRaw, ...bury(mintRaw, 6) }], opts)
  ok(!mint.ok && mint.reason === 'needs-index', 'an open MINT needs global state (the cap) — refused as needs-index, never accepted on faith')

  // ── 6 · THE NETWORK ACCUMULATES PROVEN TRUTH ─────────────────────────────
  const known = new Map([[outpointKey(txidOf(splitRaw), 0), [{ id: RUNE, amount: 600n }]]])
  const cheap = proveDeposit(txidOf(depRaw), Buffer.from(VAULT).toString('hex'), RUNE, [dep], { ...opts, known })
  ok(cheap.ok && cheap.amount === 600n, 'with the parent ALREADY proven, the deposit needs one transaction — the first walk pays for every later one')

  console.log(`\n✓ ${pass} checks passed — A DEPOSIT IS PROVEN FROM BYTES: every transaction real and buried, every runestone decoded by the specification, every allocation re-derived down the chain, and the vault's outputs matched by SCRIPT. Broken ancestries refuse and name themselves — a missing link, a shallow burial, a foreign merkle proof, a cenotaph's burn, and a mint whose cap no light verifier can know. Nothing is assumed to be zero, and nothing is ever invented. ₿₭`)
}
main()
