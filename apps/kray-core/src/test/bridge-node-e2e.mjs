// ⚠ LATENT-PATH TEST (personal-vault model) — NOT the current SPV pot door.
// Exercises the STILL-SHIPPING but latent personal-vault code (buildVaultSpend/finalizeCooperative,
// vault-settlement, the rune-rehome sweep, personalOf) that the SPV deposit door no longer feeds — deposits
// are POT-ONLY; personal-vault backing is reachable only via the dev field-trust door. KEPT per council ruling,
// never retired, never repointed onto the pot (that would drop the safety property it proves). The pot door is
// covered by the *-pot-e2e / *-pot-node-e2e files. See docs/MAINNET-READINESS.md (PROVEN-POT vs LATENT-VAULT).

/**
 * THE RUNE BRIDGE, THROUGH THE NODE — the whole L1↔L2 round-trip driven by the node's HTTP
 * endpoints against a real regtest + ord, the way the extension / front-end drives it.
 *
 * A real rune is deposited into a user-cosign vault through ord (a real Runestone); the node
 * CREDITS it (/rune/deposit), the owner SIGNS an exit that the node LOCKS and fees 1 ₭
 * (/rune/exit), the vault pays out on L1 (owner + guardians co-sign — collusion impossible), and
 * then the node SETTLES it (/rune/settle {txid}) by fetching the payout proof from its OWN
 * bitcoind, refusing anything but a clean rune movement to the SIGNED destination, and burning the
 * L2 lock. The owner's ₭ gas is itself a REAL SPV-proven donation. No module is poked directly —
 * every state change goes through the node the extension talks to.
 *
 *   HARNESS=<dir> RUNE=121:1 RUNE_NAME=KRAYNETBRIDGETWO KRAY_BTC_RPC_PASS=<pw> node src/test/bridge-node-e2e.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _signKrayWallet, scriptOfAddress, runeExitMessage } from '../protocol/scheme.ts'
import { deriveVault, toXOnly } from '../protocol/vault.ts'
import { devGuardians, depositorVault } from './dev-federation.mjs'
import { buildVaultSpend, finalizeCooperative, signSighash, auditVaultSpend } from '../protocol/vault-spend.ts'
import { verifyRuneMovement } from '../protocol/rune-bridge.ts'
import { encodeVarint, TAG } from '../protocol/runestone.ts'
import { parseRuneKey } from '../economics/rune-book.ts'
import { dustFor } from '../protocol/dust.ts'

const HARNESS = process.env.HARNESS
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const RUNE = process.env.RUNE || '121:1'
const RUNE_NAME = process.env.RUNE_NAME || 'KRAYNETBRIDGETWO'
const AMOUNT = BigInt(process.env.AMOUNT || '50000')
const NET = 'regtest', BNET = toBtcNet(NET)
const bc = (...a) => execFileSync(`${HARNESS}/bc`, a, { encoding: 'utf8' }).trim()
const ord = (...a) => execFileSync(`${HARNESS}/ordw`, a, { encoding: 'utf8' })
const ordGet = (path) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081${path}`], { encoding: 'utf8' }))
const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
const sync = () => { const h = bc('getblockcount'); for (let i = 0; i < 30; i++) { try { if (String(ordGet('/r/blockheight')) === h) return } catch {} execFileSync('sleep', ['0.5']) } }
const jget = (path) => JSON.parse(execFileSync('curl', ['-s', NODE + path], { encoding: 'utf8' }))
const jpost = (path, body) => JSON.parse(execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(body), NODE + path], { encoding: 'utf8' }))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const key = (t) => { const sk = createHash('sha256').update('bridge-node|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }

// a REAL donation to `krayAddr`: pay the pot + commit the address in an OP_RETURN, mine, and let the
// node SPV-prove it from its own bitcoind — the proven way to hand the owner its 1-₭ exit gas.
function realDonate(krayAddr, sats, potAddr, minConf) {
  const dataHex = Buffer.from(krayAddr, 'ascii').toString('hex')
  const raw = bc('createrawtransaction', '[]', JSON.stringify([{ [potAddr]: Number((sats / 1e8).toFixed(8)) }, { data: dataHex }]))
  const funded = JSON.parse(bc('fundrawtransaction', raw, JSON.stringify({ changePosition: 2 })))
  const signed = JSON.parse(bc('signrawtransactionwithwallet', funded.hex))
  const txid = bc('sendrawtransaction', signed.hex)
  mine(Math.max(1, minConf))
  return jpost('/api/kraynet/donate', { txid })
}

console.log('\n╔═ THE RUNE BRIDGE, THROUGH THE NODE — deposit · exit · settle over HTTP, real regtest ══╗')

// ── 0 · the node must be pot- + bitcoind-wired ──────────────────────────────
const info = jget('/api/kraynet/donation/info')
ok(info.configured === true, `node has the pot + bitcoind wired (minConf ${info.minConfirmations})`)
if (!info.configured) process.exit(1)

// ── 1 · derive a fresh user-cosign vault (owner + 2-of-3 guardians, NUMS key path) ─
const NONCE = bc('getblockcount')
const OWNER = key('owner|' + NONCE), G = devGuardians()   // the node's FEDERATION guardians (deposit is bound to them)
const _dv = depositorVault(OWNER.pk, NET)
const params = { ..._dv.params, net: NET }
const vault = _dv.vault
const vaultScript = scriptOfAddress(vault.address, BNET)
const OWNER_ADDR = btc.p2tr(_hexToBytes(OWNER.pk), undefined, NETWORKS[BNET]).address
const ownerScript = scriptOfAddress(OWNER_ADDR, BNET)
const rid = parseRuneKey(RUNE)
console.log(`   owner ${OWNER_ADDR.slice(0, 20)}…  vault ${vault.address.slice(0, 20)}…`)

// ── 2 · the owner's 1-₭ gas comes from a REAL, SPV-proven donation ──────────
const don = realDonate(OWNER_ADDR, 1000, info.potAddress, info.minConfirmations)
sync() // the donate mined a block — let ord catch up before we send a rune through it
const gas = BigInt(jget('/api/kraynet/profile/' + OWNER_ADDR).balance || '0')
ok(don.ok === true && gas >= 1n, `owner funded with ${gas} ₭ from a REAL SPV-proven donation — enough for the 1-₭ exit gas`)

// ── 3 · DEPOSIT — send a real rune into the vault through ord (a real Runestone) ─
const sendOut = JSON.parse(ord('send', '--fee-rate', '1', vault.address, `${AMOUNT}:${RUNE_NAME}`))
const depTxid = sendOut.txid
mine(1); sync()
const rawDeposit = bc('getrawtransaction', depTxid)
const decoded = JSON.parse(bc('getrawtransaction', depTxid, 'true'))
let inputSum = 0n
for (let v = 0; v < decoded.vout.length; v++) { try { const o = ordGet(`/output/${depTxid}:${v}`); const r = o.runes && (o.runes[RUNE_NAME] || o.runes[RUNE]); if (r) inputSum += BigInt((r.amount ?? r) || 0) } catch {} }
const verdict = verifyRuneMovement({ rawTx: rawDeposit, runeId: rid, amount: AMOUNT, targetScriptHex: vaultScript, inputRunes: [{ id: rid, amount: inputSum }], dust: dustFor('p2tr') })
ok(verdict.ok === true, `the real deposit Runestone lands ${AMOUNT} ${RUNE_NAME} in the vault (out #${verdict.outputIndex}) — no cenotaph, verifier + ord agree`)
const vaultVout = verdict.outputIndex, vaultSats = verdict.sats

// THE PROVEN INGRESS — the node gets only {runeId, txid, vault params} and derives EVERYTHING itself:
// re-derives the vault address (the derivation is the authentication), SPV-proves the burial from its
// own bitcoind, refuses a cenotaph, finds the vault output, asks ord the exact amount landed, and
// credits THE DEPOSITOR BOUND IN THE VAULT — no field of value crosses from the client.
const dep = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: depTxid, vault: _dv.params })
ok(dep.ok === true && dep.credited === OWNER_ADDR && dep.amount === AMOUNT.toString() && dep.outpoint === `${depTxid}:${vaultVout}`,
  `node SPV-PROVED the deposit from {txid, vault} alone and credited the vault's own depositor — ${dep.amount} ${RUNE_NAME} @ ${String(dep.outpoint).slice(0, 20)}…`)
// a REPLAYED proof mints nothing (credited-once by outpoint), and junk vault params derive no vault
const depDup = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: depTxid, vault: _dv.params })
ok(!!depDup.error && /already credited/i.test(depDup.error), 'REPLAYING the same deposit proof is refused — one outpoint, one credit, ever')
const depForged = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: depTxid, vault: { ..._dv.params, depositor: key("mallory").pk } })
ok(!!depForged.error && /does not fund|no output/i.test(depForged.error), 'a FORGED depositor derives a DIFFERENT vault no output pays — the derivation is the authentication')

// ── 4 · EXIT — the owner SIGNS; the node LOCKS the runes and fees exactly 1 ₭ ─
const nonce = jget('/api/kraynet/profile/' + OWNER_ADDR).nonce
const exitSig = _signKrayWallet(runeExitMessage(NET, OWNER_ADDR, RUNE, AMOUNT, OWNER_ADDR, nonce), OWNER.sk)
const exit = jpost('/api/kraynet/rune/exit', { from: OWNER_ADDR, runeId: RUNE, amount: AMOUNT.toString(), l1Address: OWNER_ADDR, nonce, publicKey: OWNER.pk, signature: exitSig })
const afterExitGas = BigInt(jget('/api/kraynet/profile/' + OWNER_ADDR).balance || '0')
ok(exit.ok === true && gas - afterExitGas === 1n, `node LOCKED the exit (/rune/exit) and charged EXACTLY 1 ₭ to the validators (${gas} → ${afterExitGas} ₭)`)

// ── 5 · PAYOUT — owner + 2 guardians co-sign a vault spend carrying a runestone to the owner ─
const [rb, rt] = RUNE.split(':').map(BigInt)
const push = (h) => (h.length / 2).toString(16).padStart(2, '0') + h
const payoutRunestone = '6a5d' + push(Buffer.concat([TAG.Body, rb, rt, AMOUNT, 0n].map((n) => Buffer.from(encodeVarint(n)))).toString('hex'))
const utxo = [{ txid: depTxid, vout: vaultVout, amountSats: vaultSats }]
const outs = [
  { address: OWNER_ADDR, amountSats: 330n },                    // out 0 — the owner, carries the runes
  { script: payoutRunestone, amountSats: 0n },                  // out 1 — the runestone edict → out 0
  { address: OWNER_ADDR, amountSats: vaultSats - 330n - 500n }, // out 2 — BTC change (500-sat miner fee)
]
const spend = buildVaultSpend(params, utxo, outs, 'cooperative')
const ownerSig = signSighash(spend.sighashes[0], OWNER.sk)
const gsigs = new Map([[G[0].pk, signSighash(spend.sighashes[0], G[0].sk)], [G[1].pk, signSighash(spend.sighashes[0], G[1].sk)]])
const payout = finalizeCooperative(spend, gsigs, ownerSig)
const pa = auditVaultSpend(payout.txHex, params, utxo)
ok(pa.ok && pa.path === 'cooperative' && pa.signers.includes(toXOnly(OWNER.pk)), 'the payout is OWNER + guardian co-signed (collusion impossible), proven from raw bytes')
const payoutTxid = bc('sendrawtransaction', payout.txHex)
mine(1); sync()
let ownerOrd = 0n
try { const o = ordGet(`/output/${payoutTxid}:0`); const r = o.runes && (o.runes[RUNE_NAME] || o.runes[RUNE]); if (r) ownerOrd = BigInt((r.amount ?? r) || 0) } catch {}
ok(ownerOrd === AMOUNT, `ord confirms the runes really left the vault to the owner's L1 output (${ownerOrd} ${RUNE_NAME})`)

// ── 6 · SETTLE — the node SPV-proves the payout from its OWN bitcoind, then BURNS the lock ─
const settle = jpost('/api/kraynet/rune/settle', { from: OWNER_ADDR, runeId: RUNE, txid: payoutTxid })
ok(settle.ok === true && settle.l1Txid === payoutTxid, `node SETTLED (/rune/settle {txid}) — it fetched the payout proof from its own bitcoind and verified a clean rune movement to the SIGNED destination${settle.error ? ' [' + settle.error + ']' : ''}`)
ok(settle.burned === AMOUNT.toString() && settle.reserve === '0' && settle.solvent === true, `the lock BURNED and the reserve fell to 0 — one payout, one burn, still solvent (reserve=${settle.reserve})`)

// ── 7 · the same payout cannot settle twice; the net still conserves ────────
const dup = jpost('/api/kraynet/rune/settle', { from: OWNER_ADDR, runeId: RUNE, txid: payoutTxid })
ok(dup.ok !== true, `re-settling the same payout is REFUSED (${String(dup.error || '').slice(0, 44)}…) — one payout, one burn, forever`)
const ov = jget('/api/kraynet/overview')
ok(ov.conserves !== false && ov.backed !== false, 'the whole net still conserves — ₭ supply untouched by the bridge, every ₭ backed by a real satoshi')

console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — a REAL rune crossed IN and OUT entirely through the node's HTTP endpoints: the extension's exact path, on real Bitcoin, ord agreeing, SPV-proven, burned, solvent, non-replayable. ⚗️₿⇄₭`)
process.exit(fail ? 1 : 0)