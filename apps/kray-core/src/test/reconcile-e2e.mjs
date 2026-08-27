// ⚠ LATENT-PATH TEST (personal-vault model) — NOT the current SPV pot door.
// Exercises the STILL-SHIPPING but latent personal-vault code (buildVaultSpend/finalizeCooperative,
// vault-settlement, the rune-rehome sweep, personalOf) that the SPV deposit door no longer feeds — deposits
// are POT-ONLY; personal-vault backing is reachable only via the dev field-trust door. KEPT per council ruling,
// never retired, never repointed onto the pot (that would drop the safety property it proves). The pot door is
// covered by the *-pot-e2e / *-pot-node-e2e files. See docs/MAINNET-READINESS.md (PROVEN-POT vs LATENT-VAULT).

/**
 * THE RECONCILIATION — the forced exit settles the L2 book in lockstep with the L1 payout, proven.
 *
 * The last hole in the residue design: when the reflex broadcasts a depositor's settlement (paying them
 * their committed balance on L1), their L2 book must fall by exactly that amount, or they would hold it on
 * BOTH sides. This proves the loop closes with solvency intact at every step, and that the guard which
 * makes it sound — locking the committed balance at arm time — blocks the "send more, then fire the stale
 * settlement" double-spend.
 *
 * Boot: KRAY_PRESIGNED_SETTLEMENT=1 KRAY_VAULT_WATCH_SEC=<small> node apps/kray-net/server.mjs
 *
 *   1 · Alice deposits 1000, sends 600 to Bob on the L2 (Alice book 400, Bob 600); solvent;
 *   2 · Alice signs a rune-exit of her 400 to her own L1 address → the node LOCKS the 400;
 *   3 · ATTACK: Alice tries to send 100 more — REFUSED, her balance is locked (the double-spend guard);
 *   4 · Alice lodges the co-signed settlement (pays her 400 + 600 to consolidation), tied to the lock;
 *   5 · Alice fires the stale unilateral escape for the full 1000;
 *   6 · the watcher broadcasts the settlement (escape loses the race) and, once it confirms, RECONCILES:
 *       it settles Alice's locked exit — her 400 burns, the reserve falls to 600, Bob's 600 still backed;
 *   7 · solvency (reserve == Σ balances + locks) holds at EVERY step, checked live.
 *
 *   HARNESS=<dir> RUNE=2566:1 RUNE_NAME=KRAYNETBRIDGETRI KRAY_BTC_RPC_PASS=<pw> node src/test/reconcile-e2e.mjs
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
const key = (t) => { const sk = createHash('sha256').update('reconcile|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }
const held = (addr) => { const o = jget('/api/kraynet/runes'); const r = (o.runes || []).find((x) => x.runeId === RUNE); const h = r && (r.holders || []).find((x) => x.address === addr); return h ? BigInt(h.amount) : 0n }
const reserve = () => { const o = jget('/api/kraynet/runes'); const r = (o.runes || []).find((x) => x.runeId === RUNE); return r ? BigInt(r.reserve) : 0n }
const solvent = () => jget('/api/kraynet/runes').solvent !== false
function realDonate(krayAddr, sats, potAddr, minConf) {
  const dataHex = Buffer.from(krayAddr, 'ascii').toString('hex')
  const raw = bc('createrawtransaction', '[]', JSON.stringify([{ [potAddr]: Number((sats / 1e8).toFixed(8)) }, { data: dataHex }]))
  const funded = JSON.parse(bc('fundrawtransaction', raw, JSON.stringify({ changePosition: 2 })))
  const signed = JSON.parse(bc('signrawtransactionwithwallet', funded.hex))
  const txid = bc('sendrawtransaction', signed.hex); mine(Math.max(1, minConf))
  return jpost('/api/kraynet/donate', { txid })
}

console.log('\n╔═ THE RECONCILIATION — the forced exit settles the L2 book in lockstep, solvency intact ═╗')
const info = jget('/api/kraynet/donation/info')
ok(info.configured === true, `node pot + bitcoind wired (minConf ${info.minConfirmations})`)
ok(jget('/api/kraynet/vault-watch').reflexEnabled === true, 'the settlement reflex is ENABLED (KRAY_PRESIGNED_SETTLEMENT=1)')

const NONCE = bc('getblockcount')
const A = key('alice|' + NONCE), BOB = key('bob|' + NONCE), G = devGuardians()
const _con = consolidationVault(NET)
const _dv = depositorVault(A.pk, NET)
const params = { ..._dv.params, net: NET }
const vault = _dv.vault
const A_ADDR = btc.p2tr(_hexToBytes(A.pk), undefined, NETWORKS[BNET]).address
const BOB_ADDR = btc.p2tr(_hexToBytes(BOB.pk), undefined, NETWORKS[BNET]).address
const CON_ADDR = _con.address

// 1 · Alice deposits 1000, sends 600 to Bob → Alice 400, Bob 600; solvent
// deltas, not absolutes: this node's rune reserve may already hold runes from earlier e2e, so we prove
// the RECONCILIATION by how the reserve MOVES (rises by the deposit, falls by exactly the forced exit),
// while per-address balances (fresh keys) and the node's own solvency tripwire prove the rest.
const rBefore = reserve()
sync()
realDonate(A_ADDR, 1000, info.potAddress, info.minConfirmations); sync()
const depOut = JSON.parse(ord('send', '--fee-rate', '1', vault.address, `${TOTAL}:${RUNE_NAME}`)); mine(1); sync()
const dep = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: depOut.txid, vault: { guardians: G.map((g) => g.pk), threshold: 2, depositor: A.pk, timelock: TIMELOCK } })
const n0 = jget('/api/kraynet/profile/' + A_ADDR).nonce
jpost('/api/kraynet/rune/send', { from: A_ADDR, to: BOB_ADDR, runeId: RUNE, amount: SENT.toString(), nonce: n0, publicKey: A.pk, signature: _signKrayWallet(runeSendMessage(NET, A_ADDR, BOB_ADDR, RUNE, SENT, n0), A.sk), scheme: 'kraywallet' })
ok(dep.ok === true && held(A_ADDR) === KEEP && held(BOB_ADDR) === SENT && reserve() === rBefore + TOTAL && solvent(),
  `deposit + send: Alice ${KEEP}, Bob ${SENT}, reserve +${TOTAL}, SOLVENT (${KEEP}+${SENT}=${TOTAL} backed)`)
const [vtxid, vvout] = dep.outpoint.split(':')
const vaultSats = BigInt(Math.round(JSON.parse(bc('getrawtransaction', vtxid, 'true')).vout[Number(vvout)].value * 1e8))

// 2 · Alice signs a rune-exit of her 400 to her OWN L1 address → the node LOCKS the 400
const n1 = jget('/api/kraynet/profile/' + A_ADDR).nonce
const exit = jpost('/api/kraynet/rune/exit', { from: A_ADDR, runeId: RUNE, amount: KEEP.toString(), l1Address: A_ADDR, nonce: n1, publicKey: A.pk, signature: _signKrayWallet(runeExitMessage(NET, A_ADDR, RUNE, KEEP, A_ADDR, n1), A.sk) })
ok(exit.ok === true && held(A_ADDR) === 0n && reserve() === rBefore + TOTAL && solvent(),
  'Alice signed a self-exit of her 400 — the node LOCKED it (balance 0, still solvent: 0 + 600 + lock 400 backed)')

// 3 · ATTACK — Alice tries to send 100 more; her balance is LOCKED, so it is REFUSED
const n2 = jget('/api/kraynet/profile/' + A_ADDR).nonce
const sneaky = jpost('/api/kraynet/rune/send', { from: A_ADDR, to: BOB_ADDR, runeId: RUNE, amount: '100', nonce: n2, publicKey: A.pk, signature: _signKrayWallet(runeSendMessage(NET, A_ADDR, BOB_ADDR, RUNE, 100n, n2), A.sk), scheme: 'kraywallet' })
ok(!sneaky.ok && /insufficient/i.test(String(sneaky.error || '')),
  'the "send more after arming" double-spend is REFUSED — the committed balance is locked, so it cannot be promised twice')

// 4 · Alice lodges the co-signed settlement (pays her 400 + 600 consolidation), tied to the lock
const dust = dustFor('p2tr')
const utxo = [{ txid: vtxid, vout: Number(vvout), amountSats: vaultSats }]
const built = settlementOutputs({ runeId: rid, totalVaultRunes: TOTAL, depositorBookRunes: KEEP, depositorScriptHex: scriptOfAddress(A_ADDR, NET), consolidationScriptHex: scriptOfAddress(CON_ADDR, NET), depositorSats: dust, consolidationSats: dust, dust })
const sp = buildVaultSpend(params, utxo, built.outputs, 'cooperative')
const cosigned = finalizeCooperative(sp, new Map([[G[0].pk, signSighash(sp.sighashes[0], G[0].sk)], [G[1].pk, signSighash(sp.sighashes[0], G[1].sk)]]), signSighash(sp.sighashes[0], A.sk))
const lodge = jpost('/api/kraynet/vault-settlement', { runeId: RUNE, vault: { guardians: G.map((g) => g.pk), threshold: 2, depositor: A.pk, timelock: TIMELOCK }, outpoint: dep.outpoint, cosignedTxHex: cosigned.txHex })
ok(lodge.ok === true && lodge.depositorKeeps === KEEP.toString() && lodge.lockAmount === KEEP.toString(),
  `the settlement is ARMED and tied to the lock (keeps ${lodge.depositorKeeps} = locked ${lodge.lockAmount}, consolidation ${lodge.consolidation})`)

// 5 · Alice fires the stale unilateral escape for the full 1000
mine(TIMELOCK)
const escape = buildVaultSpend(params, utxo, [{ address: A_ADDR, amountSats: vaultSats - 400n }], 'unilateral')
const drain = finalizeUnilateral(escape, signSighash(escape.sighashes[0], A.sk))
const drainTxid = bc('sendrawtransaction', drain.txHex)
ok(!!drainTxid, `Alice fired the stale ESCAPE for the full ${TOTAL} (${drainTxid.slice(0, 16)}…)`)

// 6 · the watcher broadcasts the settlement, and once it confirms, RECONCILES the locked exit
const w1 = jget('/api/kraynet/vault-watch?sweep=1')
const op1 = w1.outpoints.find((o) => o.outpoint === dep.outpoint)
ok(op1 && op1.settlement && !!op1.settlement.broadcastTxid, `the watcher broadcast the settlement (${String(op1?.settlement?.broadcastTxid).slice(0, 16)}…)`)
mine(1); sync()
jget('/api/kraynet/vault-watch?sweep=1') // this sweep sees the settlement buried → reconciles
// give the reconcile time — it runs inside the sweep, after the settlement buries. Poll patiently,
// nudging a block/sync in case burial or ord lagged under a loaded bench (the LOGIC is deterministic;
// only the wall-clock of confirmation varies).
for (let i = 0; i < 30 && reserve() === rBefore + TOTAL; i++) { execFileSync('sleep', ['0.5']); if (i % 5 === 4) { mine(1); sync() } jget('/api/kraynet/vault-watch?sweep=1') }
ok(reserve() === rBefore + SENT && solvent(), `RECONCILED: Alice's 400 burned from the L2 book, reserve fell by exactly ${KEEP} (to rBefore+${SENT}) in lockstep with her L1 payout — SOLVENT`)
ok(held(A_ADDR) === 0n && held(BOB_ADDR) === SENT, 'Alice holds nothing on the L2 (she got her 400 on L1); Bob still holds his 600, now backed by consolidation')

// 7 · the CONSOLIDATION REGISTRY — the shared pool that now backs Bob enters the eye automatically
const conOutpoint = op1.settlement.broadcastTxid + ':2'
const wc = jget('/api/kraynet/vault-watch?sweep=1')
const con = wc.outpoints.find((o) => o.outpoint === conOutpoint)
ok(!!con && con.runeId === RUNE && !con.released, 'the consolidation pool backing Bob is now WATCHED automatically — the eye covers the shared federation custody, no manual step')
ok(wc.alarms.every((al) => al.outpoint !== conOutpoint), 'and it reports BACKED (unspent) — a drain of it later would ALARM exactly like a vault')

// 8 · the stale escape can never confirm — the settlement took the outpoint
let escapeAlive = true
try { escapeAlive = (JSON.parse(bc('getrawtransaction', drainTxid, 'true')).confirmations || 0) >= 1 } catch { escapeAlive = false }
ok(!escapeAlive, 'the stale escape can never confirm — the settlement already spent the outpoint')
ok(solvent(), 'FINAL: reserve == Σ balances + locks held at every step — the book never once lied')

console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the forced exit reconciled the book in lockstep with Bitcoin; no double-hold, solvency intact. ⚖₿₭\n`)
process.exit(fail ? 1 : 0)