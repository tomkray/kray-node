/**
 * EXIT BURST ON THE POT DOOR — no double-delivery, no respawn, one settle (PROVEN-POT column).
 *
 * The rapid-fire race, on the CURRENT pot model: one open exit per rune per address; a cancel racing
 * the broadcast is refused (the lock ARMS at submit); a second withdraw cannot build while the first is
 * in flight (the draft is consumed / the exit is already armed — no two payouts of one lock coexist);
 * and on confirm the sweep settles ONCE, the reserve falling by exactly the lock. The pot-door analog of
 * the vault-outpoint spent-in-mempool guard (the personal-vault version stays proven in exit-payout-burst-e2e).
 *
 *   HARNESS=<dir> RUNE=130:1 RUNE_NAME='IRON•SATOSHI•ROCK' node src/test/exit-payout-burst-pot-e2e.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _signKrayWallet, scriptOfAddress, runeExitMessage, runeCancelMessage } from '../protocol/scheme.ts'
import { potCredit } from './dev-federation.mjs'

const HARNESS = process.env.HARNESS
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const RUNE = process.env.RUNE || '130:1'
const RUNE_NAME = process.env.RUNE_NAME || 'IRON•SATOSHI•ROCK'
const DEPOSIT = BigInt(process.env.DEPOSIT || '6000')
const EXIT = BigInt(process.env.EXIT || '4000')          // partial — proves the change/respawn guards
const NET = 'regtest', BNET = toBtcNet(NET)
const bc = (...a) => execFileSync(`${HARNESS}/bc`, a, { encoding: 'utf8' }).trim()
const ordGet = (p) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081${p}`], { encoding: 'utf8' }))
const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
const sync = () => { const h = bc('getblockcount'); for (let i = 0; i < 40; i++) { try { if (String(ordGet('/r/blockheight')) === h) return } catch {} execFileSync('sleep', ['0.5']) } }
const jget = (p) => JSON.parse(execFileSync('curl', ['-s', NODE + p], { encoding: 'utf8' }))
const jpost = (p, body) => JSON.parse(execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(body), NODE + p], { encoding: 'utf8' }))
const runeAt = (op) => { const raw = execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081/output/${op}`], { encoding: 'utf8' }); const esc = RUNE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const m = raw.match(new RegExp('"' + esc + '"\\s*:\\s*\\{\\s*"amount"\\s*:\\s*(\\d+)')); return m ? BigInt(m[1]) : 0n }
const runeOf = (addr) => (jget('/api/kraynet/runes/of/' + addr).runes || []).find((r) => r.runeId === RUNE) || {}
const spendable = (addr) => { const r = runeOf(addr); return r.amount != null ? BigInt(String(r.amount)) : 0n }
const lockedOf = (addr) => { const r = runeOf(addr); return r.locked ? BigInt(String(r.locked.amount ?? r.locked ?? '0')) : 0n }
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const key = (t) => { const sk = createHash('sha256').update('burst-pot|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }
const fundOwn = (addr, amt) => { const t = bc('sendtoaddress', addr, amt); mine(1); const d = JSON.parse(bc('getrawtransaction', t, 'true')); const s = scriptOfAddress(addr, BNET); return { txid: t, vout: d.vout.findIndex((o) => (o.scriptPubKey?.hex || '').toLowerCase() === s) } }

console.log('\n╔═ EXIT BURST ON THE POT DOOR — one exit, no respawn, no double-delivery, one settle ═╗')

const info = jget('/api/kraynet/donation/info')
ok(info.configured === true, `node pot + bitcoind wired (minConf ${info.minConfirmations})`)

// 0 · DEPOSIT via the pot door + 1-₭ gas
const NONCE = bc('getblockcount')
const OWNER = key('owner|' + NONCE), DESTK = key('dest|' + NONCE)
const OWNER_ADDR = btc.p2tr(_hexToBytes(OWNER.pk), undefined, NETWORKS[BNET]).address
const DEST_ADDR = btc.p2tr(_hexToBytes(DESTK.pk), undefined, NETWORKS[BNET]).address
const ownScriptHex = scriptOfAddress(OWNER_ADDR, BNET)
const { depTxid, dep } = potCredit({ owner: OWNER, amount: DEPOSIT, net: NET, rune: RUNE, runeName: RUNE_NAME })
ok(dep.ok === true && dep.amount === DEPOSIT.toString() && dep.credited === OWNER_ADDR, `deposited ${DEPOSIT} ${RUNE_NAME} to the pot, credited the owner (unique spender)`)
// seed a SECOND distinct pot IRON outpoint — the drain only EXISTS with ≥2 pot UTXOs (a second payout
// can then coin-select a DIFFERENT outpoint and deliver twice). With one UTXO the outpoint-spent-in-
// mempool naturally blocks it; seeding forces the test to exercise the DOOR guard, not the natural one.
const seed = potCredit({ owner: key('seed|' + NONCE), amount: DEPOSIT, net: NET, rune: RUNE, runeName: RUNE_NAME })
ok(seed.dep.ok === true, `seeded a second pot outpoint (${seed.dep.amount} ${RUNE_NAME}) — the pot now holds ≥2 IRON UTXOs, so a second payout CAN coin-select a distinct one`)
const gasHex = Buffer.from(OWNER_ADDR, 'ascii').toString('hex')
const graw = bc('createrawtransaction', '[]', JSON.stringify([{ [info.potAddress]: 0.00001 }, { data: gasHex }]))
const gfun = JSON.parse(bc('fundrawtransaction', graw, JSON.stringify({ changePosition: 2 })))
const gtx = bc('sendrawtransaction', JSON.parse(bc('signrawtransactionwithwallet', gfun.hex)).hex)
mine(Math.max(1, info.minConfirmations)); sync(); jpost('/api/kraynet/donate', { txid: gtx })

// 1 · EXIT locks; a SECOND overlapping exit is refused
let nonce = jget('/api/kraynet/profile/' + OWNER_ADDR).nonce
const exit1 = jpost('/api/kraynet/rune/exit', { from: OWNER_ADDR, runeId: RUNE, amount: EXIT.toString(), l1Address: DEST_ADDR, nonce, publicKey: OWNER.pk, signature: _signKrayWallet(runeExitMessage(NET, OWNER_ADDR, RUNE, EXIT, DEST_ADDR, nonce), OWNER.sk) })
ok(exit1.ok === true && spendable(OWNER_ADDR) === DEPOSIT - EXIT && lockedOf(OWNER_ADDR) === EXIT, `exit LOCKED ${EXIT} — spendable dropped to ${DEPOSIT - EXIT}, the locked ${EXIT} is not spendable`)
let n2 = jget('/api/kraynet/profile/' + OWNER_ADDR).nonce
const exit2 = jpost('/api/kraynet/rune/exit', { from: OWNER_ADDR, runeId: RUNE, amount: '1', l1Address: DEST_ADDR, nonce: n2, publicKey: OWNER.pk, signature: _signKrayWallet(runeExitMessage(NET, OWNER_ADDR, RUNE, 1n, DEST_ADDR, n2), OWNER.sk) })
ok(!!exit2.error && /already has an open exit/i.test(exit2.error), 'ATTACK: a SECOND overlapping exit → REFUSED (one open exit per rune per address)')

// 2 · WITHDRAW broadcasts a pot-paid payout (owner signs only their funding)
const fund = fundOwn(OWNER_ADDR, '0.00050000')
const built = jpost('/api/kraynet/rune/exit/payout-psbt', { from: OWNER_ADDR, runeId: RUNE, publicKey: OWNER.pk, feeRate: 2, funding: { txid: fund.txid, vout: fund.vout } })
ok(built.ok === true && !!built.psbt, 'the node BUILT the pot-paid payout PSBT')
const wtx = btc.Transaction.fromPSBT(Buffer.from(built.psbt, 'base64'), { allowUnknownInputs: true, allowUnknownOutputs: true })
for (let i = 0; i < wtx.inputsLength; i++) { const inp = wtx.getInput(i); const sh = inp.witnessUtxo && Buffer.from(inp.witnessUtxo.script).toString('hex'); if (sh === ownScriptHex) { try { wtx.signIdx(OWNER.sk, i) } catch { /* not this input */ } } }
const sub = jpost('/api/kraynet/rune/exit/payout-submit', { from: OWNER_ADDR, runeId: RUNE, psbt: Buffer.from(wtx.toPSBT(0)).toString('base64') })
ok(sub.ok === true && /^[0-9a-f]{64}$/.test(sub.txid || ''), `withdraw BROADCAST — ${String(sub.txid).slice(0, 16)}… (payout in the mempool, NOT yet confirmed)`)

// 3 · THE RACE — cancel the exit before the payout confirms → REFUSED, credits never respawn
let nc = jget('/api/kraynet/profile/' + OWNER_ADDR).nonce
const cancel = jpost('/api/kraynet/rune/cancel', { from: OWNER_ADDR, runeId: RUNE, nonce: nc, publicKey: OWNER.pk, signature: _signKrayWallet(runeCancelMessage(NET, OWNER_ADDR, RUNE, nc), OWNER.sk) })
ok(!!cancel.error, `ATTACK: CANCEL racing the broadcast → REFUSED (${String(cancel.error).slice(0, 48)}…) — the lock ARMED at submit`)
ok(lockedOf(OWNER_ADDR) === EXIT && spendable(OWNER_ADDR) === DEPOSIT - EXIT, `the ${EXIT} is STILL locked and spendable is UNCHANGED after the refused cancel — no credits respawned to double-spend`)

// 4 · a SECOND withdraw of the same lock cannot DELIVER while the first is in flight.
// Pot mechanism (NOT the vault outpoint-spent guard): the exit is ARMED at the first submit, so even if
// a second draft can be built (the pot commingles + coin-selects), submitting it must NOT put a second
// distinct payout of the same lock on the network — else the pot over-delivers by EXIT (a drain).
const fund2 = fundOwn(OWNER_ADDR, '0.00050000')
const built2 = jpost('/api/kraynet/rune/exit/payout-psbt', { from: OWNER_ADDR, runeId: RUNE, publicKey: OWNER.pk, feeRate: 5, funding: { txid: fund2.txid, vout: fund2.vout } })
let sub2 = { error: 'not built' }
if (built2.ok && built2.psbt) {
  const w2 = btc.Transaction.fromPSBT(Buffer.from(built2.psbt, 'base64'), { allowUnknownInputs: true, allowUnknownOutputs: true })
  for (let i = 0; i < w2.inputsLength; i++) { const inp = w2.getInput(i); const sh = inp.witnessUtxo && Buffer.from(inp.witnessUtxo.script).toString('hex'); if (sh === ownScriptHex) { try { w2.signIdx(OWNER.sk, i) } catch { /* not this input */ } } }
  sub2 = jpost('/api/kraynet/rune/exit/payout-submit', { from: OWNER_ADDR, runeId: RUNE, psbt: Buffer.from(w2.toPSBT(0)).toString('base64') })
}
const noSecondDelivery = !!sub2.error || sub2.txid === sub.txid   // refused OR idempotent (same tx) = safe
ok(noSecondDelivery, `ATTACK: a SECOND withdraw of the armed exit → NO second delivery (${sub2.error ? 'refused: ' + String(sub2.error).slice(0, 40) : sub2.txid === sub.txid ? 'idempotent, same txid' : 'BROADCAST A SECOND DISTINCT PAYOUT ' + String(sub2.txid).slice(0, 16) + ' — POT DRAIN'}…)`)

// 5 · confirm → the sweep settles ONCE; reserve falls by exactly the lock
const reserveBefore = BigInt((jget('/api/kraynet/runes').runes.find((r) => r.runeId === RUNE) || {}).reserve || '0')
mine(Math.max(1, info.minConfirmations)); sync()
// ON-CHAIN TRUTH — did the second payout actually deliver? (definitive drain check)
const dest1 = runeAt(`${sub.txid}:0`)
const dest2 = (sub2 && sub2.txid && sub2.txid !== sub.txid) ? runeAt(`${sub2.txid}:0`) : 0n
ok(dest2 === 0n, `ON-CHAIN: the signed destination received ${dest1 + dest2} for a ${EXIT} lock — the second payout delivered ${dest2} (must be 0; >0 = CONFIRMED POT DRAIN of ${dest2})`)
let settled = false
for (let i = 0; i < 12 && !settled; i++) { execFileSync('sleep', ['3']); if (lockedOf(OWNER_ADDR) === 0n) settled = true }
ok(settled, 'the sweep SETTLED the exit automatically — the lock burned once, no manual settle')
const entry = (jget('/api/kraynet/runes').runes || []).find((r) => r.runeId === RUNE)
ok(entry && entry.solvent !== false && BigInt(entry.reserve) === reserveBefore - EXIT, `CONSERVATION: reserve fell by EXACTLY the locked ${EXIT} (${reserveBefore} → ${entry && entry.reserve}) — one settle, solvent`)

console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the pot door survives the burst: one open exit, no respawn on a refused cancel, no second delivery in flight, one settle. ⚗️₿⇄₭`)
process.exit(fail ? 1 : 0)
