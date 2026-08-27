// ⚠ LATENT-PATH TEST (personal-vault model) — NOT the current SPV pot door.
// Exercises the STILL-SHIPPING but latent personal-vault code (buildVaultSpend/finalizeCooperative,
// vault-settlement, the rune-rehome sweep, personalOf) that the SPV deposit door no longer feeds — deposits
// are POT-ONLY; personal-vault backing is reachable only via the dev field-trust door. KEPT per council ruling,
// never retired, never repointed onto the pot (that would drop the safety property it proves). The pot door is
// covered by the *-pot-e2e / *-pot-node-e2e files. See docs/MAINNET-READINESS.md (PROVEN-POT vs LATENT-VAULT).

/**
 * THE BURST ATTACK — rapid exit/withdraw/cancel, proving no double-claim.
 *
 * The oldest bridge fraud is to claim the same coins twice: pay them out on L1
 * AND keep spending them on L2. The user-funded withdraw could open that door
 * if a broadcast payout could still be CANCELLED before it confirms — the runes
 * leave the vault on L1 while the cancel hands the credits back on L2.
 *
 * This proves it CANNOT happen, live on real regtest + ord:
 *   1 · exit locks; withdraw broadcasts a co-signed payout
 *   2 · a cancel racing the broadcast is REFUSED (the lock is ARMED at submit)
 *   3 · a SECOND exit is refused (one open exit per rune per address)
 *   4 · a second withdraw only RBF-competes for the SAME signed delivery
 *   5 · the sweep settles ONCE; reserve falls by exactly the lock; solvency holds
 *   6 · balances never let the address hold more than the vault backs
 *
 *   HARNESS=<dir> KRAY_NODE=http://127.0.0.1:4499 RUNE=114:1 RUNE_NAME=… node src/test/exit-payout-burst-e2e.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _signKrayWallet, scriptOfAddress, runeExitMessage, runeCancelMessage } from '../protocol/scheme.ts'
import { depositorVault } from './dev-federation.mjs'
import { parseRuneKey } from '../economics/rune-book.ts'

const HARNESS = process.env.HARNESS
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4499'
const RUNE = process.env.RUNE || '114:1'
const RUNE_NAME = process.env.RUNE_NAME || 'KRAYNETLTWODEMOAAA'
const DEPOSIT = BigInt(process.env.DEPOSIT || '5000')
const EXIT = BigInt(process.env.EXIT || '2000')
const NET = 'regtest', BNET = toBtcNet(NET)
const bc = (...a) => execFileSync(`${HARNESS}/bc`, a, { encoding: 'utf8' }).trim()
const ord = (...a) => execFileSync(`${HARNESS}/ordw`, a, { encoding: 'utf8' })
const ordGet = (path) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081${path}`], { encoding: 'utf8' }))
const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
const sync = () => { const h = bc('getblockcount'); for (let i = 0; i < 40; i++) { try { if (String(ordGet('/r/blockheight')) === h) return } catch {} execFileSync('sleep', ['0.5']) } }
const jget = (path) => JSON.parse(execFileSync('curl', ['-s', NODE + path], { encoding: 'utf8' }))
const jpost = (path, body) => JSON.parse(execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(body), NODE + path], { encoding: 'utf8' }))
const sleep = (s) => execFileSync('sleep', [String(s)])
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const key = (t) => { const sk = createHash('sha256').update('burst|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }

function realDonate(krayAddr, sats, potAddr, minConf) {
  const dataHex = Buffer.from(krayAddr, 'ascii').toString('hex')
  const raw = bc('createrawtransaction', '[]', JSON.stringify([{ [potAddr]: Number((sats / 1e8).toFixed(8)) }, { data: dataHex }]))
  const funded = JSON.parse(bc('fundrawtransaction', raw, JSON.stringify({ changePosition: 2 })))
  const signed = JSON.parse(bc('signrawtransactionwithwallet', funded.hex))
  const txid = bc('sendrawtransaction', signed.hex)
  mine(Math.max(1, minConf))
  return jpost('/api/kraynet/donate', { txid })
}
function fundOwn(addr, btcAmt) {
  const txid = bc('sendtoaddress', addr, btcAmt); mine(1)
  const dec = JSON.parse(bc('getrawtransaction', txid, 'true'))
  const scr = scriptOfAddress(addr, BNET)
  return { txid, vout: dec.vout.findIndex((o) => (o.scriptPubKey && o.scriptPubKey.hex || '').toLowerCase() === scr) }
}
function solvent(addr) {
  const book = jget('/api/kraynet/runes')
  const e = (book.runes || []).find((r) => r.runeId === RUNE)
  return { entry: e, solvent: e ? e.solvent !== false : true, netSolvent: book.solvent !== false }
}

console.log('\n╔═ THE BURST ATTACK — exit · withdraw · cancel in a race, proving no double-claim ══╗')

const info = jget('/api/kraynet/donation/info')
ok(info.configured === true, `node wired (minConf ${info.minConfirmations})`)
if (!info.configured) process.exit(1)

const NONCE = bc('getblockcount')
const OWNER = key('owner|' + NONCE)
const DESTK = key('dest|' + NONCE)
const _dv = depositorVault(OWNER.pk, NET)
const OWNER_ADDR = btc.p2tr(_hexToBytes(OWNER.pk), undefined, NETWORKS[BNET]).address
const DEST_ADDR = btc.p2tr(_hexToBytes(DESTK.pk), undefined, NETWORKS[BNET]).address
const rid = parseRuneKey(RUNE)

realDonate(OWNER_ADDR, 1000, info.potAddress, info.minConfirmations); sync()
const sendOut = JSON.parse(ord('send', '--fee-rate', '1', _dv.vault.address, `${DEPOSIT}:${RUNE_NAME}`)); mine(1); sync()
const dep = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: sendOut.txid, vault: _dv.params })
ok(dep.ok === true && dep.amount === DEPOSIT.toString(), `deposited ${DEPOSIT} ${RUNE_NAME} into the owner's vault`)

// ── 1 · EXIT locks; a SECOND exit is refused ────────────────────────────────
let nonce = jget('/api/kraynet/profile/' + OWNER_ADDR).nonce
const exitSig = _signKrayWallet(runeExitMessage(NET, OWNER_ADDR, RUNE, EXIT, DEST_ADDR, nonce), OWNER.sk)
const exit1 = jpost('/api/kraynet/rune/exit', { from: OWNER_ADDR, runeId: RUNE, amount: EXIT.toString(), l1Address: DEST_ADDR, nonce, publicKey: OWNER.pk, signature: exitSig })
ok(exit1.ok === true, `exit LOCKED ${EXIT} — spendable dropped to ${DEPOSIT - EXIT}`)
const bal1 = BigInt((solvent().entry.holders || []).find((h) => h.address === OWNER_ADDR)?.amount || '0')
ok(bal1 === DEPOSIT - EXIT, `the book shows exactly ${DEPOSIT - EXIT} spendable — the locked ${EXIT} is not spendable`)
let n2 = jget('/api/kraynet/profile/' + OWNER_ADDR).nonce
const exit2sig = _signKrayWallet(runeExitMessage(NET, OWNER_ADDR, RUNE, 1n, DEST_ADDR, n2), OWNER.sk)
const exit2 = jpost('/api/kraynet/rune/exit', { from: OWNER_ADDR, runeId: RUNE, amount: '1', l1Address: DEST_ADDR, nonce: n2, publicKey: OWNER.pk, signature: exit2sig })
ok(!!exit2.error && /already has an open exit/.test(exit2.error), 'ATTACK: a SECOND overlapping exit → REFUSED (one open exit per rune per address)')

// ── 2 · WITHDRAW broadcasts a co-signed payout ──────────────────────────────
const fund = fundOwn(OWNER_ADDR, '0.00050000')
const built = jpost('/api/kraynet/rune/exit/payout-psbt', { from: OWNER_ADDR, runeId: RUNE, publicKey: OWNER.pk, feeRate: 2, funding: { txid: fund.txid, vout: fund.vout } })
ok(built.ok === true && !!built.psbt, 'the node built the payout PSBT')
const wtx = btc.Transaction.fromPSBT(Buffer.from(built.psbt, 'base64'), { allowUnknownInputs: true, allowUnknownOutputs: true })
wtx.signIdx(OWNER.sk, 0); wtx.signIdx(OWNER.sk, 1)
const sub = jpost('/api/kraynet/rune/exit/payout-submit', { from: OWNER_ADDR, runeId: RUNE, psbt: Buffer.from(wtx.toPSBT(0)).toString('base64') })
ok(sub.ok === true && /^[0-9a-f]{64}$/.test(sub.txid || ''), `withdraw BROADCAST — ${String(sub.txid).slice(0, 16)}… (payout in the mempool, NOT yet confirmed)`)

// ── 3 · THE RACE — cancel the exit before the payout confirms → REFUSED ─────
let nc = jget('/api/kraynet/profile/' + OWNER_ADDR).nonce
const cancelSig = _signKrayWallet(runeCancelMessage(NET, OWNER_ADDR, RUNE, nc), OWNER.sk)
const cancel = jpost('/api/kraynet/rune/cancel', { from: OWNER_ADDR, runeId: RUNE, nonce: nc, publicKey: OWNER.pk, signature: cancelSig })
ok(!!cancel.error, `ATTACK: CANCEL racing the broadcast → REFUSED (${String(cancel.error).slice(0, 60)}…) — the lock ARMED at submit`)
// the lock must still be there, still locked, still armed
const lockNow = (solvent().entry.locked)
const stillLocked = lockNow && BigInt(String(lockNow.amount != null ? lockNow.amount : lockNow || '0')) === EXIT
ok(stillLocked, `the ${EXIT} is STILL locked after the refused cancel — the credits never came back`)
const balAfterCancel = BigInt((solvent().entry.holders || []).find((h) => h.address === OWNER_ADDR)?.amount || '0')
ok(balAfterCancel === DEPOSIT - EXIT, 'spendable is UNCHANGED by the refused cancel — no credits respawned to double-spend')

// ── 4 · a second withdraw cannot even BUILD while the first is in flight ────
// the vault outpoint is spent-in-mempool by the first payout, so gettxout returns nothing:
// the node sees no live backing and refuses. Stricter than RBF — there is never a moment
// where two distinct payouts of the same lock coexist as buildable drafts.
const fund2 = fundOwn(OWNER_ADDR, '0.00050000')
const built2 = jpost('/api/kraynet/rune/exit/payout-psbt', { from: OWNER_ADDR, runeId: RUNE, publicKey: OWNER.pk, feeRate: 5, funding: { txid: fund2.txid, vout: fund2.vout } })
ok(!!built2.error, `ATTACK: a SECOND withdraw while the first is unconfirmed → REFUSED (${String(built2.error).slice(0, 52)}…) — the vault outpoint is already spent in the mempool, so no second delivery can be built`)

// ── 5 · confirm → the sweep settles ONCE; reserve falls by exactly the lock ─
mine(Math.max(1, info.minConfirmations)); sync()
let destGot = 0n
try { const o = ordGet(`/output/${sub.txid}:0`); const r = o.runes && (o.runes[RUNE_NAME] || o.runes[RUNE]); if (r) destGot = BigInt((r.amount ?? r) || 0) } catch {}
ok(destGot === EXIT, `ord confirms exactly ${EXIT} ${RUNE_NAME} reached the signed destination on L1 — ONCE`)
let settled = false
for (let i = 0; i < 12 && !settled; i++) {
  sleep(5)
  const l = solvent().entry.locked
  if (!l || BigInt(String(l.amount != null ? l.amount : l || '0')) === 0n) settled = true
}
ok(settled, 'the sweep SETTLED the exit automatically — the lock burned, no manual call')
const s = solvent()
ok(s.entry.reserve === (DEPOSIT - EXIT).toString(), `reserve fell by EXACTLY the lock: ${DEPOSIT} → ${s.entry.reserve} (one burn, never two)`)
ok(s.entry.credits === (DEPOSIT - EXIT).toString() && s.solvent && s.netSolvent, `credits == reserve == ${DEPOSIT - EXIT}, solvent — the address never held more than the vault backs`)

// ── 6 · after settle: a fresh cancel finds nothing, a rebuild finds no lock ─
let nc2 = jget('/api/kraynet/profile/' + OWNER_ADDR).nonce
const cancel2 = jpost('/api/kraynet/rune/cancel', { from: OWNER_ADDR, runeId: RUNE, nonce: nc2, publicKey: OWNER.pk, signature: _signKrayWallet(runeCancelMessage(NET, OWNER_ADDR, RUNE, nc2), OWNER.sk) })
ok(!!cancel2.error && /no open exit/.test(cancel2.error), 'after settle: a cancel finds NO open exit — nothing to refund, nothing to double-claim')

console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the burst cannot double-claim: one exit, one armed lock, one delivery, one burn. The reserve never lies. ⚗️₿⇄₭`)
process.exit(fail ? 1 : 0)