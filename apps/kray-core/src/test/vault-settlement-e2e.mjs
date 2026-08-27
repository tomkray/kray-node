// ⚠ LATENT-PATH TEST (personal-vault model) — NOT the current SPV pot door.
// Exercises the STILL-SHIPPING but latent personal-vault code (buildVaultSpend/finalizeCooperative,
// vault-settlement, the rune-rehome sweep, personalOf) that the SPV deposit door no longer feeds — deposits
// are POT-ONLY; personal-vault backing is reachable only via the dev field-trust door. KEPT per council ruling,
// never retired, never repointed onto the pot (that would drop the safety property it proves). The pot door is
// covered by the *-pot-e2e / *-pot-node-e2e files. See docs/MAINNET-READINESS.md (PROVEN-POT vs LATENT-VAULT).

/**
 * THE SETTLEMENT REFLEX, LIVE — the residue attack FAILS ON ITS OWN, on real regtest Bitcoin.
 *
 * The story, end to end:
 *   1 · Mallory deposits 1000 runes into her user-cosign vault and is credited on the L2;
 *   2 · she sends 600 to Bob on the L2 — her book balance is now 400. At transfer time she CO-SIGNS
 *       a cooperative settlement of her vault that keeps her 400 and routes 600 to consolidation
 *       (no timelock on the cooperative leaf). The guardians co-sign it too. The network holds it.
 *   3 · THE ATTACK: after the timelock, Mallory fires the UNILATERAL ESCAPE for the full 1000 — the
 *       stale sweep. The watcher sees it in the mempool and the network broadcasts the pre-signed
 *       settlement, which spends the SAME vault outpoint with NO timelock and a higher fee.
 *   4 · Bitcoin's own consensus picks the winner: the settlement confirms, the escape becomes a
 *       double-spend of an already-spent output and can NEVER confirm. Mallory ends with EXACTLY
 *       400 runes on L1 — her book balance — and the 600 sit in consolidation, backing Bob.
 *
 * The attack is not blocked by a policeman; it fails because the honest settlement always wins the
 * race for the one outpoint. Proven from the raw Bitcoin bytes and ord, not asserted.
 *
 *   HARNESS=<dir> RUNE=2566:1 RUNE_NAME=KRAYNETBRIDGETRI KRAY_BTC_RPC_PASS=<pw> node src/test/vault-settlement-e2e.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, scriptOfAddress } from '../protocol/scheme.ts'
import { deriveVault } from '../protocol/vault.ts'
import { devGuardians, depositorVault, consolidationVault } from './dev-federation.mjs'
import { buildVaultSpend, finalizeCooperative, finalizeUnilateral, signSighash } from '../protocol/vault-spend.ts'
import { settlementOutputs, auditSettlementSafety } from '../protocol/vault-settlement.ts'
import { parseRuneKey } from '../economics/rune-book.ts'
import { dustFor } from '../protocol/dust.ts'

const HARNESS = process.env.HARNESS
const RUNE = process.env.RUNE || '2566:1'
const RUNE_NAME = process.env.RUNE_NAME || 'KRAYNETBRIDGETRI'
const TOTAL = 1000n, KEEP = 400n           // deposit 1000, send 600 away, keep 400
const TIMELOCK = 16
const NET = 'regtest', BNET = toBtcNet(NET)
const bc = (...a) => execFileSync(`${HARNESS}/bc`, a, { encoding: 'utf8' }).trim()
const ord = (...a) => execFileSync(`${HARNESS}/ordw`, a, { encoding: 'utf8' })
const ordGet = (path) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081${path}`], { encoding: 'utf8' }))
const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
const sync = () => { const h = bc('getblockcount'); for (let i = 0; i < 40; i++) { try { if (String(ordGet('/r/blockheight')) === h) return } catch {} execFileSync('sleep', ['0.5']) } }
const rid = parseRuneKey(RUNE)
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const key = (t) => { const sk = createHash('sha256').update('settle-e2e|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }
const ordRunesAt = (txid, vout) => { try { const o = ordGet(`/output/${txid}:${vout}`); const r = o.runes && (o.runes[RUNE_NAME] || o.runes[RUNE]); return r ? BigInt((r.amount ?? r) || 0) : 0n } catch { return 0n } }

console.log('\n╔═ THE SETTLEMENT REFLEX — the stale escape loses the race, the attack fails on its own ═╗')
if (!HARNESS) { console.error('set HARNESS'); process.exit(1) }

const NONCE = bc('getblockcount')
const M = key('mallory|' + NONCE), G = devGuardians()
const _con = consolidationVault(NET)
const CONSOL = key('consolidation|' + NONCE)
const _dv = depositorVault(M.pk, NET)
const params = { ..._dv.params, net: NET }
const vault = _dv.vault
const M_ADDR = btc.p2tr(_hexToBytes(M.pk), undefined, NETWORKS[BNET]).address
const CONSOL_ADDR = btc.p2tr(_hexToBytes(CONSOL.pk), undefined, NETWORKS[BNET]).address
const depScript = scriptOfAddress(M_ADDR, NET), conScript = scriptOfAddress(CONSOL_ADDR, NET)

// ── 1 · Mallory deposits 1000 runes into her vault (a real Runestone) ────────
sync() // if a prior e2e mined blocks, let ord index the wallet's rune UTXOs before we spend them
const sendOut = JSON.parse(ord('send', '--fee-rate', '1', vault.address, `${TOTAL}:${RUNE_NAME}`))
mine(1); sync()
const depVout = JSON.parse(bc('getrawtransaction', sendOut.txid, 'true')).vout.findIndex((o) => o.scriptPubKey.hex === scriptOfAddress(vault.address, NET))
const vaultSats = BigInt(Math.round(JSON.parse(bc('getrawtransaction', sendOut.txid, 'true')).vout[depVout].value * 1e8))
ok(ordRunesAt(sendOut.txid, depVout) === TOTAL, `Mallory deposited ${TOTAL} ${RUNE_NAME} into her vault (out #${depVout})`)

// ── 2 · she sends 600 on the L2 → book 400; at that moment she CO-SIGNS the settlement ─
// (the L2 book move is proven elsewhere; here we build the settlement her transfer would co-sign)
// runes ride on dust — so both rune outputs sit at the dust floor and the settlement keeps a LARGE
// fee margin, guaranteeing it out-bids the escape on both absolute fee AND feerate (BIP-125), the
// property the network relies on to win the race for the one outpoint.
const dust = dustFor('p2tr')
const { outputs, depositorOutput, consolidationOutput } = settlementOutputs({
  runeId: rid, totalVaultRunes: TOTAL, depositorBookRunes: KEEP,
  depositorScriptHex: depScript, consolidationScriptHex: conScript,
  depositorSats: dust, consolidationSats: dust, dust,
})
const utxo = [{ txid: sendOut.txid, vout: depVout, amountSats: vaultSats }]
const settleSpend = buildVaultSpend(params, utxo, outputs, 'cooperative')
// the SAFETY audit a guardian runs before co-signing — the depositor can keep no more than 400
const safe = auditSettlementSafety({ runeId: rid, outputScriptsHex: outputs.map((o) => o.script), inputRunes: TOTAL, depositorOutput, consolidationOutput, maxDepositorRunes: KEEP })
ok(safe.ok === true && safe.depositorGot === KEEP && safe.consolidationGot === TOTAL - KEEP,
  `the settlement is proven SAFE before anyone co-signs: Mallory keeps ${safe.depositorGot}, consolidation gets ${safe.consolidationGot} (audit, not trust)`)
// Mallory + 2 guardians co-sign the settlement — the network now holds a no-timelock spend of her vault
const settleTx = finalizeCooperative(settleSpend, new Map([[G[0].pk, signSighash(settleSpend.sighashes[0], G[0].sk)], [G[1].pk, signSighash(settleSpend.sighashes[0], G[1].sk)]]), signSighash(settleSpend.sighashes[0], M.sk))
ok(!!settleTx.txHex, 'Mallory + 2 guardians CO-SIGNED the settlement at transfer time — held by the network, ready, no timelock')

// ── 3 · THE ATTACK — after the timelock, she fires the stale unilateral escape for the FULL 1000 ─
mine(TIMELOCK)
const escape = buildVaultSpend(params, utxo, [{ address: M_ADDR, amountSats: vaultSats - 400n }], 'unilateral')
const drain = finalizeUnilateral(escape, signSighash(escape.sighashes[0], M.sk))
// she broadcasts the theft first (a modest 400-sat fee)
const drainTxid = bc('sendrawtransaction', drain.txHex)
ok(!!drainTxid, `Mallory broadcast the stale ESCAPE for the full ${TOTAL} (${drainTxid.slice(0, 16)}…) — the theft is in the mempool`)

// ── 4 · THE REFLEX — the network broadcasts the pre-signed settlement, RBF-replacing the escape ─
// both spend the SAME outpoint, so only one can ever confirm; the settlement keeps a large fee margin
// (rune outputs at dust), so Bitcoin's own RBF prefers it on both absolute fee and feerate.
const settleFee = vaultSats - dust - dust
let settleBroadcast = null, bcErr = ''
try { settleBroadcast = bc('sendrawtransaction', settleTx.txHex) }
catch (e) { bcErr = String(e.message).split('\n').find((l) => /error|reject|fee/i.test(l)) || e.message }
ok(!!settleBroadcast, `the network broadcast the pre-signed SETTLEMENT (fee ${settleFee} vs the escape's 400) — Bitcoin's RBF accepted it over the escape${settleBroadcast ? '' : ' [' + bcErr.slice(0, 80) + ']'}`)
mine(1); sync()

// ── 5 · Bitcoin picked the winner: the settlement confirmed, the escape is a dead double-spend ─
let settleConfirmed = false
try { settleConfirmed = (JSON.parse(bc('getrawtransaction', settleTx.txid, 'true')).confirmations || 0) >= 1 } catch { settleConfirmed = false }
ok(settleConfirmed, 'the SETTLEMENT confirmed on Bitcoin — the honest split is now the chain truth')
let escapeAlive = true
try { const c = JSON.parse(bc('getrawtransaction', drainTxid, 'true')).confirmations; escapeAlive = (c || 0) >= 1 } catch { escapeAlive = false }
ok(!escapeAlive, 'the stale ESCAPE can never confirm — it double-spends an output the settlement already took')

// ── 6 · the outcome ord sees: Mallory got EXACTLY her book balance, consolidation backs the rest ─
const mGot = ordRunesAt(settleTx.txid, depositorOutput)
const cGot = ordRunesAt(settleTx.txid, consolidationOutput)
ok(mGot === KEEP, `ord confirms Mallory received EXACTLY ${KEEP} on L1 — her book balance, not the ${TOTAL} she tried to steal`)
ok(cGot === TOTAL - KEEP, `and ${cGot} sit in consolidation — the runes Mallory sent Bob on the L2, still backed on Bitcoin`)

console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the residue attack FAILED ON ITS OWN: the stale escape lost the race for the outpoint. ⚖₿₭\n`)
process.exit(fail ? 1 : 0)