// ⚠ LATENT-PATH TEST (personal-vault model) — NOT the current SPV pot door.
// Exercises the STILL-SHIPPING but latent personal-vault code (buildVaultSpend/finalizeCooperative,
// vault-settlement, the rune-rehome sweep, personalOf) that the SPV deposit door no longer feeds — deposits
// are POT-ONLY; personal-vault backing is reachable only via the dev field-trust door. KEPT per council ruling,
// never retired, never repointed onto the pot (that would drop the safety property it proves). The pot door is
// covered by the *-pot-e2e / *-pot-node-e2e files. See docs/MAINNET-READINESS.md (PROVEN-POT vs LATENT-VAULT).

/**
 * THE VAULT WATCHER, LIVE — the eye proven against the REAL attack, on real regtest Bitcoin.
 *
 * Three acts:
 *   1 · a real rune deposit registers its vault outpoint — the watcher reports it BACKED;
 *   2 · a lawful exit → co-signed payout → settle RELEASES the outpoint — no alarm, ever;
 *   3 · THE ATTACK: a second deposit, then the depositor waits out the CSV timelock and fires the
 *       UNILATERAL ESCAPE for real — sweeping the vault with no exit, no settle, no book entry.
 *       The watcher ALARMS the moment the drain hits the MEMPOOL (before a single confirmation),
 *       and the alarm names the outpoint, the rune, the amount and the vault.
 *
 * The book itself cannot see this theft (reserve == credits + locks still holds — the drain lives
 * on L1). That is precisely why the watcher exists: it is the eye on the residue the script cannot
 * close, and the trigger for the pre-signed settlement reflex to come.
 *
 *   HARNESS=<dir> RUNE=121:1 RUNE_NAME=KRAYNETBRIDGETWO KRAY_BTC_RPC_PASS=<pw> node src/test/vault-watch-e2e.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _signKrayWallet, scriptOfAddress, runeExitMessage } from '../protocol/scheme.ts'
import { deriveVault } from '../protocol/vault.ts'
import { devGuardians, depositorVault } from './dev-federation.mjs'
import { buildVaultSpend, finalizeCooperative, finalizeUnilateral, signSighash } from '../protocol/vault-spend.ts'
import { encodeVarint, TAG } from '../protocol/runestone.ts'

const HARNESS = process.env.HARNESS
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const RUNE = process.env.RUNE || '121:1'
const RUNE_NAME = process.env.RUNE_NAME || 'KRAYNETBRIDGETWO'
const AMT = 500n                       // per act — small on purpose, the harness rune is finite
const TIMELOCK = 16                    // short CSV so the escape is minable in seconds; the law is identical at 4320
const NET = 'regtest', BNET = toBtcNet(NET)
const bc = (...a) => execFileSync(`${HARNESS}/bc`, a, { encoding: 'utf8' }).trim()
const ord = (...a) => execFileSync(`${HARNESS}/ordw`, a, { encoding: 'utf8' })
const ordGet = (path) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081${path}`], { encoding: 'utf8' }))
const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
const sync = () => { const h = bc('getblockcount'); for (let i = 0; i < 40; i++) { try { if (String(ordGet('/r/blockheight')) === h) return } catch {} execFileSync('sleep', ['0.5']) } }
const jget = (path) => JSON.parse(execFileSync('curl', ['-s', NODE + path], { encoding: 'utf8' }))
const jpost = (path, body) => JSON.parse(execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(body), NODE + path], { encoding: 'utf8' }))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const key = (t) => { const sk = createHash('sha256').update('vault-watch|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }
const watch = () => jget('/api/kraynet/vault-watch?sweep=1')

function realDonate(krayAddr, sats, potAddr, minConf) {
  const dataHex = Buffer.from(krayAddr, 'ascii').toString('hex')
  const raw = bc('createrawtransaction', '[]', JSON.stringify([{ [potAddr]: Number((sats / 1e8).toFixed(8)) }, { data: dataHex }]))
  const funded = JSON.parse(bc('fundrawtransaction', raw, JSON.stringify({ changePosition: 2 })))
  const signed = JSON.parse(bc('signrawtransactionwithwallet', funded.hex))
  const txid = bc('sendrawtransaction', signed.hex)
  mine(Math.max(1, minConf))
  return jpost('/api/kraynet/donate', { txid })   // the node SPV-proves it and credits the ₭ gas
}

/** Deposit AMT of the rune into `vault` through ord (a real Runestone), prove it to the node. */
function depositInto(vaultAddr, vaultBody) {
  const out = JSON.parse(ord('send', '--fee-rate', '1', vaultAddr, `${AMT}:${RUNE_NAME}`))
  mine(1); sync()
  const dep = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: out.txid, vault: vaultBody })
  return { txid: out.txid, dep }
}

console.log('\n╔═ THE VAULT WATCHER, LIVE — backed · released · and the REAL unilateral escape ALARMED ═╗')

const info = jget('/api/kraynet/donation/info')
ok(info.configured === true, `node has the pot + bitcoind wired (minConf ${info.minConfirmations})`)
if (!info.configured) process.exit(1)
const w0 = watch()
ok(w0.ok === true && w0.chainWired === true, `the watcher is on and chain-wired (sweep every ${w0.intervalSec}s, read-only)`)
const base = { watching: w0.watching, released: w0.released }

// ── ACT 1 · a real deposit → BACKED ─────────────────────────────────────────
const NONCE = bc('getblockcount')
const A = key('alice|' + NONCE), G = devGuardians()
const _dvA = depositorVault(A.pk, NET)
const vaultBodyA = _dvA.params
const paramsA = { ..._dvA.params, net: NET }
const vaultA = _dvA.vault
const A_ADDR = btc.p2tr(_hexToBytes(A.pk), undefined, NETWORKS[BNET]).address
const gasDon = realDonate(A_ADDR, 1000, info.potAddress, info.minConfirmations); sync()
ok(gasDon.ok === true && BigInt(jget('/api/kraynet/profile/' + A_ADDR).balance || '0') >= 1n, 'Alice funded with ₭ gas from a real SPV-proven donation')
const d1 = depositInto(vaultA.address, vaultBodyA)
ok(d1.dep.ok === true, `Act 1 — a real ${AMT}-${RUNE_NAME} deposit credited @ ${String(d1.dep.outpoint).slice(0, 20)}…`)
const w1 = watch()
ok(w1.watching === base.watching + 1 && w1.backed >= 1 && w1.alarms.length === 0,
  `the watcher REGISTERED the backing and reports it BACKED on-chain (watching ${w1.watching}, backed ${w1.backed}, alarms 0)`)

// ── ACT 2 · the lawful road: exit → co-signed payout → settle → RELEASED, no alarm ─
const nonce = jget('/api/kraynet/profile/' + A_ADDR).nonce
const exitSig = _signKrayWallet(runeExitMessage(NET, A_ADDR, RUNE, AMT, A_ADDR, nonce), A.sk)
const exit = jpost('/api/kraynet/rune/exit', { from: A_ADDR, runeId: RUNE, amount: AMT.toString(), l1Address: A_ADDR, nonce, publicKey: A.pk, signature: exitSig })
ok(exit.ok === true, 'Act 2 — Alice SIGNED an exit; the node locked her credits (spend-on-L2 and claim-on-L1 now mutually exclusive)')
const [vb, vt] = RUNE.split(':').map(BigInt)
const push = (h) => (h.length / 2).toString(16).padStart(2, '0') + h
const stone = '6a5d' + push(Buffer.concat([TAG.Body, vb, vt, AMT, 0n].map((n) => Buffer.from(encodeVarint(n)))).toString('hex'))
const [dTxid] = d1.dep.outpoint.split(':'); const dVout = Number(d1.dep.outpoint.split(':')[1])
const dSats = BigInt(JSON.parse(bc('getrawtransaction', dTxid, 'true')).vout[dVout].value * 1e8 | 0) || 10000n
const utxo1 = [{ txid: dTxid, vout: dVout, amountSats: dSats }]
const spend1 = buildVaultSpend(paramsA, utxo1, [
  { address: A_ADDR, amountSats: 330n }, { script: stone, amountSats: 0n }, { address: A_ADDR, amountSats: dSats - 330n - 500n },
], 'cooperative')
const payout = finalizeCooperative(spend1, new Map([[G[0].pk, signSighash(spend1.sighashes[0], G[0].sk)], [G[1].pk, signSighash(spend1.sighashes[0], G[1].sk)]]), signSighash(spend1.sighashes[0], A.sk))
const payoutTxid = bc('sendrawtransaction', payout.txHex)
mine(1); sync()
const settle = jpost('/api/kraynet/rune/settle', { from: A_ADDR, runeId: RUNE, txid: payoutTxid })
ok(settle.ok === true && settle.burned === AMT.toString(), `the co-signed payout settled — lock burned, reserve fell by exactly ${AMT}`)
const w2 = watch()
ok(w2.released === base.released + 1 && w2.alarms.length === 0,
  `the watcher marked the outpoint RELEASED by the settle's own inputs — a lawful spend raises NO alarm (released ${w2.released}, alarms 0)`)

// ── ACT 3 · THE ATTACK — deposit, then the REAL unilateral escape, no exit, no settle ─
const M = key('mallory|' + NONCE)
const _dvM = depositorVault(M.pk, NET)
const vaultBodyM = _dvM.params
const paramsM = { ..._dvM.params, net: NET }
const vaultM = _dvM.vault
const M_ADDR = btc.p2tr(_hexToBytes(M.pk), undefined, NETWORKS[BNET]).address
const d2 = depositInto(vaultM.address, vaultBodyM)
ok(d2.dep.ok === true && d2.dep.credited === M_ADDR, `Act 3 — Mallory deposited ${AMT} for real and was credited on the L2`)
const w3 = watch()
ok(w3.watching === base.watching + 2 && w3.alarms.length === 0, 'her backing outpoint is watched and currently BACKED — no alarm yet')
const reserveBefore = jget('/api/kraynet/runes').runes.find((r) => r.runeId === RUNE)?.reserve

// she keeps (or spends) her L2 credits — and STILL goes for the vault: the exact residue attack.
mine(TIMELOCK)                                            // the CSV window passes — Bitcoin now permits her escape leaf
const [mTxid] = d2.dep.outpoint.split(':'); const mVout = Number(d2.dep.outpoint.split(':')[1])
const mSats = BigInt(JSON.parse(bc('getrawtransaction', mTxid, 'true')).vout[mVout].value * 1e8 | 0) || 10000n
const escape = buildVaultSpend(paramsM, [{ txid: mTxid, vout: mVout, amountSats: mSats }], [
  { address: M_ADDR, amountSats: mSats - 500n },          // she sweeps EVERYTHING to herself — runes ride the default allocation
], 'unilateral')
const drain = finalizeUnilateral(escape, signSighash(escape.sighashes[0], M.sk))
const drainTxid = bc('sendrawtransaction', drain.txHex)   // ← the theft, actually broadcast on Bitcoin
ok(!!drainTxid, `the UNILATERAL ESCAPE fired for real: Mallory alone swept her vault after the timelock (${drainTxid.slice(0, 16)}…)`)

// THE EYE: the alarm sounds from the MEMPOOL — before a single confirmation buries the theft
const w4 = watch()
const alarm = w4.alarms.find((a) => a.outpoint === d2.dep.outpoint)
ok(!!alarm && /outside the book/.test(alarm.reason),
  'the watcher ALARMED from the MEMPOOL — the backing moved outside the book, named before one confirmation')
ok(alarm && alarm.runeId === RUNE && alarm.amount === AMT.toString() && alarm.vault === vaultM.address,
  `the alarm names everything: outpoint ${String(alarm?.outpoint).slice(0, 16)}…, rune ${alarm?.runeId}, ${alarm?.amount} credited, the vault itself`)
mine(1)
const w5 = watch()
ok(w5.alarms.some((a) => a.outpoint === d2.dep.outpoint), 'the alarm persists after the theft confirms — history is not repainted')

// the book alone could NOT see this (the drain lives on L1) — which is exactly why the eye exists
const reserveAfter = jget('/api/kraynet/runes').runes.find((r) => r.runeId === RUNE)?.reserve
ok(reserveAfter === reserveBefore, `the L2 book still shows reserve ${reserveAfter} (it cannot see L1 drains) — the watcher sees what the book cannot`)
ok(jget('/api/kraynet/runes').solvent !== false, 'and the watcher changed NO ledger state — eyes, no hands (read-only proven)')

console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — backed, released, and the real escape ALARMED from the mempool. The eye never blinks. 👁₭\n`)
process.exit(fail ? 1 : 0)