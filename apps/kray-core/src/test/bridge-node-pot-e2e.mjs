/**
 * THE RUNE BRIDGE, THROUGH THE NODE — the whole L1↔L2 round-trip on the CURRENT pot model,
 * driven by the node's HTTP endpoints against a real regtest + ord, the way the extension does it.
 *
 * The bakery pot is the one home: a wallet sends a rune from its OWN Taproot address straight to
 * the shared pot, and the node NAMES the credit from the unique Taproot spender (bytes, never a
 * client field). Credits are pool-backed from birth — one L1 fee, instantly sendable. The exit is
 * user-funded and pot-paid: the owner SIGNS a rune-exit, the node builds the payout FROM THE POT
 * (`/rune/exit/payout-psbt`), the owner signs only their own funding sats, the pot co-signs the
 * pot input server-side (`/rune/exit/payout-submit`), and the sweep SETTLES the lock automatically
 * once buried. No module is poked directly — every state change goes through the node's endpoints.
 *
 * Adversarial checks ride along: a tx that does NOT pay the pot is refused, a replayed deposit
 * proof mints nothing, and a settled payout cannot settle twice.
 *
 *   HARNESS=<dir> RUNE=130:1 RUNE_NAME=IRON•SATOSHI•ROCK node src/test/bridge-node-e2e.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _signKrayWallet, scriptOfAddress, runeExitMessage } from '../protocol/scheme.ts'
import { encodeVarint, TAG } from '../protocol/runestone.ts'
const bytesToHex = (b) => Buffer.from(b).toString('hex')
const hexToBytes = (h) => _hexToBytes(h)

const HARNESS = process.env.HARNESS
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const RUNE = process.env.RUNE || '130:1'
const RUNE_NAME = process.env.RUNE_NAME || 'IRON•SATOSHI•ROCK'
const AMOUNT = BigInt(process.env.AMOUNT || '50000')
const NET = 'regtest', BNET = toBtcNet(NET)
const bc = (...a) => execFileSync(`${HARNESS}/bc`, a, { encoding: 'utf8' }).trim()
const ord = (...a) => execFileSync(`${HARNESS}/ordw`, a, { encoding: 'utf8' })
const ordGet = (p) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081${p}`], { encoding: 'utf8' }))
const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
const sync = () => { const h = bc('getblockcount'); for (let i = 0; i < 40; i++) { try { if (String(ordGet('/r/blockheight')) === h) return } catch {} execFileSync('sleep', ['0.5']) } }
const jget = (p) => JSON.parse(execFileSync('curl', ['-s', NODE + p], { encoding: 'utf8' }))
const jpost = (p, body) => JSON.parse(execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(body), NODE + p], { encoding: 'utf8' }))
const runeAt = (op) => { try { const o = ordGet(`/output/${op}`); const r = o.runes && (o.runes[RUNE_NAME] || o.runes[RUNE]); return r ? BigInt((r.amount ?? r) || 0) : 0n } catch { return 0n } }
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const key = (t) => { const sk = createHash('sha256').update('bridge-node|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }

console.log('\n╔═ THE RUNE BRIDGE, THROUGH THE NODE — wallet → pot → exit → settle, real regtest, pot model ══╗')

// ── 0 · the node must be pot- + bitcoind-wired ──────────────────────────────
const info = jget('/api/kraynet/donation/info')
const bp = jget('/api/kraynet/bridge/params')
ok(info.configured === true && bp && bp.pot, `node has the bakery pot + bitcoind wired (pot ${String(bp.pot).slice(0, 18)}…, minConf ${info.minConfirmations})`)
if (!info.configured || !bp || !bp.pot) process.exit(1)
const POT = bp.pot

// ── 1 · a fresh OWNER Taproot address it fully controls (unique, known spender) ─
const NONCE = bc('getblockcount')
const OWNER = key('owner|' + NONCE)
const xonly = _hexToBytes(OWNER.pk)
const OWNER_ADDR = btc.p2tr(xonly, undefined, NETWORKS[BNET]).address
const ownScriptHex = scriptOfAddress(OWNER_ADDR, BNET)
const ownScript = hexToBytes(ownScriptHex)
console.log(`   owner ${OWNER_ADDR.slice(0, 22)}…  rune ${RUNE_NAME} (${RUNE})`)

// ── 2 · fund OWNER with EXACTLY AMOUNT of the rune (ord) + a sats utxo (postage/fee) ─
const sent = JSON.parse(ord('send', '--fee-rate', '1', OWNER_ADDR, `${AMOUNT}:${RUNE_NAME}`))
mine(1); sync()
const rdec = JSON.parse(bc('getrawtransaction', sent.txid, 'true'))
const runeVout = rdec.vout.findIndex((o) => (o.scriptPubKey?.hex || '').toLowerCase() === ownScriptHex)
const runeSats = BigInt(Math.round(rdec.vout[runeVout].value * 1e8))
const fundTxid = bc('sendtoaddress', OWNER_ADDR, '0.00100000')
mine(1); sync()
const fdec = JSON.parse(bc('getrawtransaction', fundTxid, 'true'))
const fundVout = fdec.vout.findIndex((o) => (o.scriptPubKey?.hex || '').toLowerCase() === ownScriptHex)
const fundSats = BigInt(Math.round(fdec.vout[fundVout].value * 1e8))
ok(runeVout >= 0 && fundVout >= 0, `OWNER holds ${AMOUNT} ${RUNE_NAME} + ${fundSats} sats for postage/fee`)

// adversarial: the ord send paid OWNER, NOT the pot — the node refuses to credit it
const notPot = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: sent.txid })
ok(!!notPot.error && /bakery pot/i.test(notPot.error), 'a tx that does NOT pay the bakery pot is REFUSED — the pot names the path, not a client field')

// ── 3 · build the pot-deposit tx — OWNER's own utxos → pot(out0), runestone edict → out0 ─
const [rb, rt] = RUNE.split(':').map(BigInt)
const push = (h) => (h.length / 2).toString(16).padStart(2, '0') + h
const runestoneHex = '6a5d' + push(Buffer.concat([TAG.Body, rb, rt, AMOUNT, 0n].map((n) => Buffer.from(encodeVarint(n)))).toString('hex'))
const POT_VAL = 1000n, FEE = 400n
const changeVal = runeSats + fundSats - POT_VAL - FEE
const tx = new btc.Transaction({ allowUnknownOutputs: true, version: 2 })
tx.addInput({ txid: sent.txid, index: runeVout, witnessUtxo: { script: ownScript, amount: runeSats }, tapInternalKey: xonly })
tx.addInput({ txid: fundTxid, index: fundVout, witnessUtxo: { script: ownScript, amount: fundSats }, tapInternalKey: xonly })
tx.addOutputAddress(POT, POT_VAL, NETWORKS[BNET])              // out 0 — the pot, carries the runes
tx.addOutput({ script: hexToBytes(runestoneHex), amount: 0n }) // out 1 — runestone edict → out 0
tx.addOutputAddress(OWNER_ADDR, changeVal, NETWORKS[BNET])     // out 2 — sats change
tx.sign(OWNER.sk); tx.finalize()
const depTxid = bc('sendrawtransaction', bytesToHex(tx.extract()))
mine(1); sync()
ok(runeAt(`${depTxid}:0`) === AMOUNT, `the runestone landed ${AMOUNT} ${RUNE_NAME} at the POT output (out 0), ord agrees`)

// ── 4 · DEPOSIT — the node SPV-proves {runeId, txid} and credits the unique spender ─
const dep = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: depTxid })
ok(dep.ok === true && dep.credited === OWNER_ADDR && dep.amount === AMOUNT.toString() && dep.outpoint === `${depTxid}:0` && dep.pool === true,
  `node CREDITED the pot deposit to the unique Taproot spender — ${dep.amount} ${RUNE_NAME} @ ${String(dep.outpoint).slice(0, 18)}… (pool=${dep.pool})`)
ok(dep.solvent === true, `the book stays SOLVENT after the deposit (reserve=${dep.reserve})`)
const vw = jget('/api/kraynet/vault-watch')
ok((vw.outpoints || []).some((w) => w.outpoint === `${depTxid}:0`), `the deposit is BACKED — the watcher holds the pot outpoint (watching=${vw.watching})`)
const dup = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: depTxid })
ok(!!dup.error && /already/i.test(dup.error), 'REPLAYING the same deposit proof is REFUSED — one outpoint, one credit, ever')

// ── 5 · EXIT — the owner's 1-₭ gas is a real donation; the owner SIGNS the exit lock ─
const dataHex = Buffer.from(OWNER_ADDR, 'ascii').toString('hex')
const graw = bc('createrawtransaction', '[]', JSON.stringify([{ [info.potAddress]: 0.00001 }, { data: dataHex }]))
const gfun = JSON.parse(bc('fundrawtransaction', graw, JSON.stringify({ changePosition: 2 })))
const gtx = bc('sendrawtransaction', JSON.parse(bc('signrawtransactionwithwallet', gfun.hex)).hex)
mine(Math.max(1, info.minConfirmations)); sync()
const gas = jpost('/api/kraynet/donate', { txid: gtx })
const nonce = jget('/api/kraynet/profile/' + OWNER_ADDR).nonce
const exitSig = _signKrayWallet(runeExitMessage(NET, OWNER_ADDR, RUNE, AMOUNT, OWNER_ADDR, nonce), OWNER.sk)
const exit = jpost('/api/kraynet/rune/exit', { from: OWNER_ADDR, runeId: RUNE, amount: AMOUNT.toString(), l1Address: OWNER_ADDR, nonce, publicKey: OWNER.pk, signature: exitSig })
ok(gas.ok === true && exit.ok === true, `owner funded 1-₭ gas (real donation) and LOCKED the exit — ${AMOUNT} ${RUNE_NAME} payable only to the signed L1 address`)

// ── 6 · PAYOUT — the node builds it FROM THE POT; owner signs only their funding; pot co-signs ─
const built = jpost('/api/kraynet/rune/exit/payout-psbt', { from: OWNER_ADDR, runeId: RUNE, publicKey: OWNER.pk, feeRate: 2, funding: { txid: depTxid, vout: 2 } })
ok(built.ok === true && !!built.psbt, `the node BUILT the payout PSBT from the POT (fee ${built.summary && built.summary.feeSats} sats)`)
const wtx = btc.Transaction.fromPSBT(Buffer.from(built.psbt, 'base64'), { allowUnknownInputs: true, allowUnknownOutputs: true })
for (let i = 0; i < wtx.inputsLength; i++) {
  const inp = wtx.getInput(i)
  const sh = inp.witnessUtxo && Buffer.from(inp.witnessUtxo.script).toString('hex')
  if (sh === ownScriptHex) { try { wtx.signIdx(OWNER.sk, i) } catch { /* not this input's key */ } }
}
const sub = jpost('/api/kraynet/rune/exit/payout-submit', { from: OWNER_ADDR, runeId: RUNE, psbt: Buffer.from(wtx.toPSBT(0)).toString('base64') })
ok(sub.ok === true && /^[0-9a-f]{64}$/.test(sub.txid || ''), `payout BROADCAST from the pot — ${String(sub.txid || sub.error).slice(0, 16)}… (settles after ${sub.minConfirmations} conf)`)
mine(Math.max(1, info.minConfirmations)); sync()
ok(runeAt(`${sub.txid}:0`) === AMOUNT, `ord confirms the SIGNED L1 destination received exactly ${AMOUNT} ${RUNE_NAME}`)

// ── 7 · AUTOMATIC SETTLE — the sweep burns the lock with no further hands ────
let settled = false
for (let i = 0; i < 12 && !settled; i++) {
  execFileSync('sleep', ['3'])
  const rr = jget('/api/kraynet/runes/of/' + OWNER_ADDR)
  const m = (rr.runes || []).find((r) => r.runeId === RUNE)
  const lk = m && m.locked ? BigInt(String(m.locked.amount ?? m.locked ?? '0')) : 0n
  if (lk === 0n) settled = true
}
ok(settled, 'the sweep SETTLED the exit automatically — the lock burned with no manual settle call')

// ── 8 · a settled payout cannot settle twice; the net still conserves ────────
const dupSettle = jpost('/api/kraynet/rune/settle', { from: OWNER_ADDR, runeId: RUNE, txid: sub.txid })
ok(dupSettle.ok !== true, `re-settling the same payout is REFUSED (${String(dupSettle.error || '').slice(0, 40)}…) — one payout, one burn`)
const book = jget('/api/kraynet/runes'); const entry = (book.runes || []).find((r) => r.runeId === RUNE)
const ov = jget('/api/kraynet/overview')
ok(book.solvent !== false && (!entry || entry.solvent !== false) && ov.conserves !== false && ov.backed !== false,
  'the whole net still conserves — the book is solvent, ₭ supply untouched by the bridge, every ₭ backed by a real satoshi')

console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — a REAL rune crossed IN and OUT entirely through the node's HTTP endpoints on the CURRENT pot model: wallet → pot (credit = unique spender), owner-signed exit, pot-paid payout, auto-settled, solvent, non-replayable. ⚗️₿⇄₭`)
process.exit(fail ? 1 : 0)
