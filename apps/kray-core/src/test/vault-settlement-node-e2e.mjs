// ⚠ LATENT-PATH TEST (personal-vault model) — NOT the current SPV pot door.
// Exercises the STILL-SHIPPING but latent personal-vault code (buildVaultSpend/finalizeCooperative,
// vault-settlement, the rune-rehome sweep, personalOf) that the SPV deposit door no longer feeds — deposits
// are POT-ONLY; personal-vault backing is reachable only via the dev field-trust door. KEPT per council ruling,
// never retired, never repointed onto the pot (that would drop the safety property it proves). The pot door is
// covered by the *-pot-e2e / *-pot-node-e2e files. See docs/MAINNET-READINESS.md (PROVEN-POT vs LATENT-VAULT).

/**
 * THE SETTLEMENT REFLEX, THROUGH THE NODE — the whole loop the extension would drive, flag ON.
 *
 * Boot the bench with KRAY_PRESIGNED_SETTLEMENT=1, then:
 *   1 · deposit 1000 runes into Mallory's vault (the node SPV-proves + credits her);
 *   2 · Mallory sends 600 to Bob on the L2 — the node's book now says Mallory holds 400;
 *   3 · she LODGES a co-signed settlement keeping 400 → the node verifies it against ITS OWN book
 *       (cap = 400, never a client number) and arms it;
 *   4 · a GREEDY settlement keeping 1000 is REFUSED by the node — the residue attack cannot be armed;
 *   5 · Mallory fires the stale unilateral escape for the full 1000;
 *   6 · the node's WATCHER sees the drain and BROADCASTS the armed settlement itself — the escape
 *       loses the race, and ord confirms Mallory got exactly her 400.
 *
 *   HARNESS=<dir> RUNE=2566:1 RUNE_NAME=KRAYNETBRIDGETRI KRAY_BTC_RPC_PASS=<pw> \
 *   KRAY_PRESIGNED_SETTLEMENT=1 node apps/kray-net/server.mjs    # (bench, flag ON)
 *   node src/test/vault-settlement-node-e2e.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _signKrayWallet, scriptOfAddress, runeSendMessage, runeExitMessage } from '../protocol/scheme.ts'
import { deriveVault } from '../protocol/vault.ts'
import { devGuardians, depositorVault, consolidationVault } from './dev-federation.mjs'
import { buildVaultSpend, finalizeCooperative, finalizeUnilateral, signSighash } from '../protocol/vault-spend.ts'
import { settlementOutputs } from '../protocol/vault-settlement.ts'
import { parseRuneKey } from '../economics/rune-book.ts'
import { dustFor } from '../protocol/dust.ts'

const HARNESS = process.env.HARNESS
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const RUNE = process.env.RUNE || '2566:1'
const RUNE_NAME = process.env.RUNE_NAME || 'KRAYNETBRIDGETRI'
const TOTAL = 1000n, SENT = 600n, KEEP = 400n, TIMELOCK = 16
const NET = 'regtest', BNET = toBtcNet(NET)
const bc = (...a) => execFileSync(`${HARNESS}/bc`, a, { encoding: 'utf8' }).trim()
const ord = (...a) => execFileSync(`${HARNESS}/ordw`, a, { encoding: 'utf8' })
const ordGet = (path) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081${path}`], { encoding: 'utf8' }))
const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
const sync = () => { const h = bc('getblockcount'); for (let i = 0; i < 40; i++) { try { if (String(ordGet('/r/blockheight')) === h) return } catch {} execFileSync('sleep', ['0.5']) } }
const jget = (path) => JSON.parse(execFileSync('curl', ['-s', NODE + path], { encoding: 'utf8' }))
const jpost = (path, body) => JSON.parse(execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(body), NODE + path], { encoding: 'utf8' }))
const rid = parseRuneKey(RUNE)
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const key = (t) => { const sk = createHash('sha256').update('settle-node|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }
const ordRunesAt = (txid, vout) => { try { const o = ordGet(`/output/${txid}:${vout}`); const r = o.runes && (o.runes[RUNE_NAME] || o.runes[RUNE]); return r ? BigInt((r.amount ?? r) || 0) : 0n } catch { return 0n } }
function realDonate(krayAddr, sats, potAddr, minConf) {
  const dataHex = Buffer.from(krayAddr, 'ascii').toString('hex')
  const raw = bc('createrawtransaction', '[]', JSON.stringify([{ [potAddr]: Number((sats / 1e8).toFixed(8)) }, { data: dataHex }]))
  const funded = JSON.parse(bc('fundrawtransaction', raw, JSON.stringify({ changePosition: 2 })))
  const signed = JSON.parse(bc('signrawtransactionwithwallet', funded.hex))
  const txid = bc('sendrawtransaction', signed.hex); mine(Math.max(1, minConf))
  return jpost('/api/kraynet/donate', { txid })
}

console.log('\n╔═ THE SETTLEMENT REFLEX, THROUGH THE NODE — lodge · refuse-greedy · drain · auto-broadcast ═╗')
const info = jget('/api/kraynet/donation/info')
ok(info.configured === true, `node pot + bitcoind wired (minConf ${info.minConfirmations})`)
const w0 = jget('/api/kraynet/vault-watch')
ok(w0.reflexEnabled === true, 'the settlement reflex is ENABLED on this node (KRAY_PRESIGNED_SETTLEMENT=1)')
if (!w0.reflexEnabled) { console.error('   boot the bench with KRAY_PRESIGNED_SETTLEMENT=1'); process.exit(1) }

const NONCE = bc('getblockcount')
const M = key('mallory|' + NONCE), BOB = key('bob|' + NONCE), G = devGuardians()
const _con = consolidationVault(NET)
const _dv = depositorVault(M.pk, NET)
const params = { ..._dv.params, net: NET }
const vault = _dv.vault
const M_ADDR = btc.p2tr(_hexToBytes(M.pk), undefined, NETWORKS[BNET]).address
const BOB_ADDR = btc.p2tr(_hexToBytes(BOB.pk), undefined, NETWORKS[BNET]).address
const CON_ADDR = _con.address

// 1 · deposit 1000 into Mallory's vault (proven path)
realDonate(M_ADDR, 1000, info.potAddress, info.minConfirmations); sync()
const sendOut = JSON.parse(ord('send', '--fee-rate', '1', vault.address, `${TOTAL}:${RUNE_NAME}`)); mine(1); sync()
const dep = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: sendOut.txid, vault: { guardians: G.map((g) => g.pk), threshold: 2, depositor: M.pk, timelock: TIMELOCK } })
ok(dep.ok === true && dep.credited === M_ADDR, `Mallory deposited ${TOTAL}, credited on the L2 @ ${String(dep.outpoint).slice(0, 18)}…`)
const [vtxid, vvout] = dep.outpoint.split(':')
const vaultSats = BigInt(Math.round(JSON.parse(bc('getrawtransaction', vtxid, 'true')).vout[Number(vvout)].value * 1e8))

// 2 · Mallory sends 600 to Bob on the L2 → node book: Mallory 400
const n = jget('/api/kraynet/profile/' + M_ADDR).nonce
const sendSig = _signKrayWallet(runeSendMessage(NET, M_ADDR, BOB_ADDR, RUNE, SENT, n), M.sk)
const send = jpost('/api/kraynet/rune/send', { from: M_ADDR, to: BOB_ADDR, runeId: RUNE, amount: SENT.toString(), nonce: n, publicKey: M.pk, signature: sendSig, scheme: 'kraywallet' })
ok(send.ok === true && jget('/api/kraynet/runes').runes.find((r) => r.runeId === RUNE).holders.find((h) => h.address === M_ADDR).amount === KEEP.toString(),
  `Mallory sent ${SENT} to Bob on the L2 — the node's book now says she holds ${KEEP}`)

// 3 · she signs a self-exit of her 400 (LOCKING it), then LODGES a settlement tied to that lock
const ne = jget('/api/kraynet/profile/' + M_ADDR).nonce
const exit = jpost('/api/kraynet/rune/exit', { from: M_ADDR, runeId: RUNE, amount: KEEP.toString(), l1Address: M_ADDR, nonce: ne, publicKey: M.pk, signature: _signKrayWallet(runeExitMessage(NET, M_ADDR, RUNE, KEEP, M_ADDR, ne), M.sk) })
ok(exit.ok === true, 'Mallory signed a self-exit of her 400 — the node locked it (the commitment that makes a lodge sound)')
const utxo = [{ txid: vtxid, vout: Number(vvout), amountSats: vaultSats }]
const dust = dustFor('p2tr')
const built = settlementOutputs({ runeId: rid, totalVaultRunes: TOTAL, depositorBookRunes: KEEP, depositorScriptHex: scriptOfAddress(M_ADDR, NET), consolidationScriptHex: scriptOfAddress(CON_ADDR, NET), depositorSats: dust, consolidationSats: dust, dust })
const sp = buildVaultSpend(params, utxo, built.outputs, 'cooperative')
const cosigned = finalizeCooperative(sp, new Map([[G[0].pk, signSighash(sp.sighashes[0], G[0].sk)], [G[1].pk, signSighash(sp.sighashes[0], G[1].sk)]]), signSighash(sp.sighashes[0], M.sk))
const lodge = jpost('/api/kraynet/vault-settlement', { runeId: RUNE, vault: { guardians: G.map((g) => g.pk), threshold: 2, depositor: M.pk, timelock: TIMELOCK }, outpoint: dep.outpoint, cosignedTxHex: cosigned.txHex })
ok(lodge.ok === true && lodge.depositorKeeps === KEEP.toString() && lodge.lockAmount === KEEP.toString(),
  `the node ARMED the settlement — tied to the locked exit (keeps ${lodge.depositorKeeps} = locked ${lodge.lockAmount})`)

// 4 · a GREEDY settlement keeping the full 1000 is REFUSED by the node
const greedy = settlementOutputs({ runeId: rid, totalVaultRunes: TOTAL, depositorBookRunes: TOTAL, depositorScriptHex: scriptOfAddress(M_ADDR, NET), consolidationScriptHex: scriptOfAddress(CON_ADDR, NET), depositorSats: dust, consolidationSats: dust, dust })
const gsp = buildVaultSpend(params, utxo, greedy.outputs, 'cooperative')
const gco = finalizeCooperative(gsp, new Map([[G[0].pk, signSighash(gsp.sighashes[0], G[0].sk)], [G[1].pk, signSighash(gsp.sighashes[0], G[1].sk)]]), signSighash(gsp.sighashes[0], M.sk))
const greedyLodge = jpost('/api/kraynet/vault-settlement', { runeId: RUNE, vault: { guardians: G.map((g) => g.pk), threshold: 2, depositor: M.pk, timelock: TIMELOCK }, outpoint: dep.outpoint, cosignedTxHex: gco.txHex })
ok(!greedyLodge.ok && /residue attack|not safe/.test(String(greedyLodge.error || '')),
  'a settlement paying Mallory the full 1000 is REFUSED by the node — the residue attack cannot be armed')

// 5 · Mallory fires the stale unilateral escape for the full 1000
mine(TIMELOCK)
const escape = buildVaultSpend(params, utxo, [{ address: M_ADDR, amountSats: vaultSats - 400n }], 'unilateral')
const drain = finalizeUnilateral(escape, signSighash(escape.sighashes[0], M.sk))
const drainTxid = bc('sendrawtransaction', drain.txHex)
ok(!!drainTxid, `Mallory broadcast the stale ESCAPE for ${TOTAL} (${drainTxid.slice(0, 16)}…)`)

// 6 · the node's WATCHER sees the drain and BROADCASTS the armed settlement itself
const w1 = jget('/api/kraynet/vault-watch?sweep=1')
const op = w1.outpoints.find((o) => o.outpoint === dep.outpoint)
ok(!!op && op.settlement && !!op.settlement.broadcastTxid,
  `the node's watcher BROADCAST the pre-signed settlement itself (${String(op?.settlement?.broadcastTxid).slice(0, 16)}…) — no human in the loop`)
mine(1); sync()
let escapeAlive = true
try { escapeAlive = (JSON.parse(bc('getrawtransaction', drainTxid, 'true')).confirmations || 0) >= 1 } catch { escapeAlive = false }
ok(!escapeAlive, 'the stale escape can never confirm — the node\'s settlement took the outpoint first')
ok(ordRunesAt(op.settlement.broadcastTxid, 0) === KEEP, `ord confirms Mallory got EXACTLY ${KEEP} on L1 — the node closed the residue with no human in the loop`)

console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the node armed the honest split, refused the greedy one, and the reflex fired itself. ⚖₿₭\n`)
process.exit(fail ? 1 : 0)