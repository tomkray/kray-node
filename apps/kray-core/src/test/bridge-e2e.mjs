// ⚠ LATENT-PATH TEST (personal-vault model) — NOT the current SPV pot door.
// Exercises the STILL-SHIPPING but latent personal-vault code (buildVaultSpend/finalizeCooperative,
// vault-settlement, the rune-rehome sweep, personalOf) that the SPV deposit door no longer feeds — deposits
// are POT-ONLY; personal-vault backing is reachable only via the dev field-trust door. KEPT per council ruling,
// never retired, never repointed onto the pot (that would drop the safety property it proves). The pot door is
// covered by the *-pot-e2e / *-pot-node-e2e files. See docs/MAINNET-READINESS.md (PROVEN-POT vs LATENT-VAULT).

/**
 * THE RUNE BRIDGE, END TO END ON A REAL REGTEST — bitcoind + ord + the proven KRAYNET modules.
 * Derives a user-cosign vault, DEPOSITS a real rune into it through ord (a real Runestone), and
 * proves the deposit two ways: `ord` (normative) says the vault output holds the runes, AND our
 * fail-closed verifyRuneMovement accepts the exact on-chain bytes. Then a signed L2 exit locks it,
 * the vault pays out (owner + guardians co-sign — collusion impossible), and the settle burns it.
 * No fixtures: every rune here is a real Runestone the canonical indexer interpreted.
 *
 *   HARNESS=<dir> RUNE=<block:tx> node src/test/bridge-e2e.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _signKrayWallet, scriptOfAddress, runeExitMessage } from '../protocol/scheme.ts'
import { deriveVault, toXOnly } from '../protocol/vault.ts'
import { buildVaultSpend, finalizeCooperative, signSighash, auditVaultSpend } from '../protocol/vault-spend.ts'
import { verifyRuneMovement } from '../protocol/rune-bridge.ts'
import { encodeVarint, TAG } from '../protocol/runestone.ts'
import { proveTxBuried } from '../anchor/spv.ts'
import { parseRuneKey } from '../economics/rune-book.ts'
import { KrayLedger } from '../protocol/ledger.ts'
import { dustFor } from '../protocol/dust.ts'

const HARNESS = process.env.HARNESS
const RUNE = process.env.RUNE || '111:1'
const NET = 'regtest', BNET = toBtcNet(NET)
const bc = (...a) => execFileSync(`${HARNESS}/bc`, a, { encoding: 'utf8' }).trim()
const ord = (...a) => execFileSync(`${HARNESS}/ordw`, a, { encoding: 'utf8' })
const ordGet = (path) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081${path}`], { encoding: 'utf8' }))
const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
const sync = () => { const h = bc('getblockcount'); for (let i = 0; i < 30; i++) { try { if (String(ordGet('/r/blockheight')) === h) return } catch {} execFileSync('sleep', ['0.5']) } }
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const key = (t) => { const sk = createHash('sha256').update('bridge|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }

console.log('\n╔═ THE RUNE BRIDGE, END TO END — real bitcoind + real ord ══════════╗')

// ── 1 · derive the user-cosign vault (owner + 2-of-3 guardians) — fresh per run ─
const NONCE = bc('getblockcount') // a fresh vault each run, so the harness is re-runnable
const OWNER = key('owner|' + NONCE), G = [key('g1|' + NONCE), key('g2|' + NONCE), key('g3|' + NONCE)]
const params = { guardians: G.map((g) => g.pk), threshold: 2, depositor: OWNER.pk, timelock: 144, net: NET }
const vault = deriveVault(params)
const vaultScript = scriptOfAddress(vault.address, BNET)
console.log(`   vault ${vault.address.slice(0, 24)}…  (owner + 2-of-3 guardians, NUMS key path)`)
ok(deriveVault(params).address === vault.address, 'the vault is DETERMINISTIC — re-derived byte-identical from the same public params')

// ── 2 · DEPOSIT — send a real rune into the vault through ord (a real Runestone) ─
const RUNE_NAME = process.env.RUNE_NAME || 'KRAYNETBRIDGETEST'
const AMOUNT = BigInt(process.env.AMOUNT || '100000')
console.log(`   depositing ${AMOUNT} ${RUNE_NAME} → the vault…`)
const sendOut = JSON.parse(ord('send', '--fee-rate', '1', vault.address, `${AMOUNT}:${RUNE_NAME}`))
const depTxid = sendOut.txid
mine(1); sync()
const rawDeposit = bc('getrawtransaction', depTxid)

// ── 3 · our FAIL-CLOSED verifier accepts the exact on-chain bytes ───────────
const rid = parseRuneKey(RUNE)
// inputRunes = what the tx's inputs carried; by conservation (nothing burned) = Σ output runes (per ord)
const decoded = JSON.parse(bc('getrawtransaction', depTxid, 'true'))
let inputSum = 0n
for (let v = 0; v < decoded.vout.length; v++) { try { const o = ordGet(`/output/${depTxid}:${v}`); const r = o.runes && (o.runes[RUNE_NAME] || o.runes[RUNE]); if (r) inputSum += BigInt((r.amount ?? r) || 0) } catch {} }
const verdict = verifyRuneMovement({ rawTx: rawDeposit, runeId: rid, amount: AMOUNT, targetScriptHex: vaultScript, inputRunes: [{ id: rid, amount: inputSum }], dust: dustFor('p2tr') })
ok(verdict.ok === true, `verifyRuneMovement accepts the REAL deposit tx (out #${verdict.outputIndex}, ${verdict.sats} sats ≥ dust) — no cenotaph, nothing burned, the vault got exactly ${AMOUNT}`)
const vaultVout = verdict.outputIndex

// ── 4 · ord (normative) confirms the runes at the SAME output ───────────────
let ordRunes = 0n
try { const o = ordGet(`/output/${depTxid}:${vaultVout}`); const r = o.runes && (o.runes[RUNE_NAME] || o.runes[RUNE]); if (r) ordRunes = BigInt((r.amount ?? r) || 0) } catch {}
ok(ordRunes === AMOUNT, `ord (the normative indexer) confirms output #${vaultVout} holds ${ordRunes} ${RUNE_NAME} — the verifier and ord AGREE byte-for-byte`)

// ── 5 · CREDIT THE L2 (the owner's address is its identity) ─────────────────
const OWNER_ADDR = btc.p2tr(_hexToBytes(OWNER.pk), undefined, NETWORKS[BNET]).address
const ownerScript = scriptOfAddress(OWNER_ADDR, BNET)
const L = new KrayLedger(undefined, NET)
L.applyLive({ seq: 1, kind: 'donate', hash: 'a'.repeat(64), to: OWNER_ADDR, amount: '100' })  // ₭ fuel for the exit fee
L.applyLive({ seq: 2, kind: 'rune-deposit', hash: 'b'.repeat(64), runeId: RUNE, outpoint: `${depTxid}:${vaultVout}`, to: OWNER_ADDR, amount: AMOUNT.toString() })
ok(L.runes.balanceOf(rid, OWNER_ADDR) === AMOUNT && L.runesSolvent(), `the L2 credits ${AMOUNT} ${RUNE_NAME} to the owner — reserve == credits, solvent`)

// ── 6 · EXIT — a signed L2 lock (fee 1 ₭ → validators, reserve unmoved) ──────
const nonce = L.nonceOf(OWNER_ADDR)
const exitSig = _signKrayWallet(runeExitMessage(NET, OWNER_ADDR, RUNE, AMOUNT, OWNER_ADDR, nonce), OWNER.sk)
L.applyLive({ seq: 3, kind: 'rune-exit', hash: 'c'.repeat(64), from: OWNER_ADDR, runeId: RUNE, amount: AMOUNT.toString(), l1Address: OWNER_ADDR, fee: '1', nonce, publicKey: OWNER.pk, signature: exitSig, scheme: 'kraywallet' })
ok(L.runes.lockedOf(rid, OWNER_ADDR)?.amount === AMOUNT && L.runes.balanceOf(rid, OWNER_ADDR) === 0n && L.runesSolvent(),
  'EXIT: the runes LEAVE the spendable book into a lock (reserve unmoved, still solvent) — the eternal 1-₭ fee paid to the validators')

// ── 7 · PAYOUT — the vault spend, OWNER + 2 guardians co-sign, carrying a runestone to the owner ─
const [rb, rt] = RUNE.split(':').map(BigInt)
const push = (h) => (h.length / 2).toString(16).padStart(2, '0') + h
const payoutRunestone = '6a5d' + push(Buffer.concat([TAG.Body, rb, rt, AMOUNT, 0n].map((n) => Buffer.from(encodeVarint(n)))).toString('hex'))
const vaultSats = verdict.sats
const utxo = [{ txid: depTxid, vout: vaultVout, amountSats: vaultSats }]
const outs = [
  { address: OWNER_ADDR, amountSats: 330n },                    // out 0 — the owner, carries the runes
  { script: payoutRunestone, amountSats: 0n },                  // out 1 — the runestone edict → out 0
  { address: OWNER_ADDR, amountSats: vaultSats - 330n - 500n }, // out 2 — BTC change (500-sat fee)
]
const spend = buildVaultSpend(params, utxo, outs, 'cooperative')
const ownerSig = signSighash(spend.sighashes[0], OWNER.sk)
const gsigs = new Map([[G[0].pk, signSighash(spend.sighashes[0], G[0].sk)], [G[1].pk, signSighash(spend.sighashes[0], G[1].sk)]])
const payout = finalizeCooperative(spend, gsigs, ownerSig)
const pv = verifyRuneMovement({ rawTx: payout.txHex, runeId: rid, amount: AMOUNT, targetScriptHex: ownerScript, inputRunes: [{ id: rid, amount: AMOUNT }], dust: dustFor('p2tr') })
ok(pv.ok === true, `PAYOUT: the co-signed vault spend carries a valid runestone moving ${AMOUNT} to the owner (out #${pv.outputIndex}) — fail-closed verifier accepts it`)
const pa = auditVaultSpend(payout.txHex, params, utxo)
ok(pa.ok && pa.path === 'cooperative' && pa.signers.includes(toXOnly(OWNER.pk)), 'the audit confirms the OWNER co-signed (owner + guardians) — collusion impossible, proven from raw bytes')
const payoutTxid = bc('sendrawtransaction', payout.txHex)
mine(1); sync()
let ownerOrd = 0n
try { const o = ordGet(`/output/${payoutTxid}:0`); const r = o.runes && (o.runes[RUNE_NAME] || o.runes[RUNE]); if (r) ownerOrd = BigInt((r.amount ?? r) || 0) } catch {}
ok(ownerOrd === AMOUNT, `ord confirms the OWNER's L1 output now holds ${ownerOrd} ${RUNE_NAME} — the runes really left the vault to L1`)

// ── 8 · SETTLE — a REAL SPV proof of the payout, then BURN the L2 lock ───────
const txoutproof = bc('gettxoutproof', JSON.stringify([payoutTxid]))
const blockhash = JSON.parse(bc('getrawtransaction', payoutTxid, 'true')).blockhash
const header = bc('getblockheader', blockhash, 'false')
const buried = proveTxBuried(payout.txHex, txoutproof, [header], { net: 'regtest', minConfirmations: 1, minWork: 0n })
ok(buried.ok === true && buried.txid === payoutTxid, `SPV: the payout is PROVEN buried on Bitcoin regtest from raw bytes (${buried.confirmations} conf) — no node trusted`)
L.applyLive({ seq: 4, kind: 'rune-settle', hash: 'd'.repeat(64), from: OWNER_ADDR, runeId: RUNE, amount: AMOUNT.toString(), l1Txid: payoutTxid })
ok(L.runes.lockedOf(rid, OWNER_ADDR) === null && L.runes.reserveOf(rid) === 0n && L.runesSolvent(),
  'SETTLE: the proven payout BURNS the L2 lock and drops the reserve by exactly the same amount — one payout, one burn, still solvent')
ok(L.conserves(), 'and ₭ conservation held through the whole round-trip — the bridge never touched the fungible supply')

console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — a REAL rune crossed IN through a real Runestone and OUT through an owner+guardian co-signed payout, ord agreeing at every hop, SPV-proven, burned, solvent start to finish. The whole bridge, on real Bitcoin. ⚗️₿⇄₭`)
process.exit(fail ? 1 : 0)