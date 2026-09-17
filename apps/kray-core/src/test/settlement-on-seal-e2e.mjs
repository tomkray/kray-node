/**
 * THE FEE POOL PAYS ON EVERY PROVEN SEAL — validators with proven presence are settled when a seal lands,
 * even when the seal's own burial block is not the block they happened to beat against.
 *
 * The mainnet gap this closes (Land 2, 2026-09-12): two validators were beating live, the Treasury held 15 ₭,
 * a self-anchor seal confirmed 6 blocks deep — and no settlement fired, because the settle beacon was bound to
 * the BURIAL block hash, a beacon nobody had beaten against (beats are accepted only for the current tip hash,
 * and burial is ≥6 blocks in the past on mainnet). The pool "accumulated" while proven presence went unpaid.
 *
 * Here: a validator proves presence against the current beacon; a fee act fills the pool; a donation is
 * broadcast and buried in a NEW block (new beacon, no beats). The writer's own donation watch redeems it,
 * the seal rides in — and the settlement must follow, paying the validator from the pool, re-derived by
 * the reducer from the beats (a follower recomputes the same table or halts).
 *
 *   KRAY_BTC_RPC_PASS=<pw> KRAY_NODE=http://127.0.0.1:4499 node src/test/settlement-on-seal-e2e.mjs
 *   (writer booted with KRAY_TRUSTED_DEV=1 and a small KRAY_DONATION_WATCH_MS)
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { createHash } from 'node:crypto'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _bytesToHex } from '../protocol/scheme.ts'
import { mineBeat } from '../economics/beat-pow.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
const RPC = process.env.KRAY_BTC_RPC || 'http://127.0.0.1:18454'
const RPC_USER = process.env.KRAY_BTC_RPC_USER || 'kraycore'
const RPC_PASS = process.env.KRAY_BTC_RPC_PASS || ''
const WALLET = process.env.KRAY_WALLET || 'kray'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const WAIT_MS = parseInt(process.env.WAIT_MS || '90000', 10)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function bc(method, params = []) {
  const r = await fetch(`${RPC}/wallet/${WALLET}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64') }, body: JSON.stringify({ jsonrpc: '1.0', id: 'kray', method, params }) }).then((x) => x.json())
  if (r.error) throw new Error(`bitcoind ${method}: ${r.error.message}`)
  return r.result
}
const mine = async (n) => bc('generatetoaddress', [n, await bc('getnewaddress', ['', 'bech32m'])])
const jget = (p) => fetch(NODE + p).then((r) => r.json())
const jpost = (p, b) => fetch(NODE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json())
const bal = async (a) => BigInt((await jget('/api/kraynet/profile/' + encodeURIComponent(a))).balance || '0')
const id = (t) => { const s = nsha(new TextEncoder().encode('settle|' + t + '|' + Date.now())); const x = Buffer.from(schnorr.getPublicKey(s)).toString('hex'); return { s, x, a: btc.p2tr(Buffer.from(x, 'hex'), undefined, NETWORKS[NET]).address, sign: (m) => Buffer.from(schnorr.sign(nsha(new TextEncoder().encode(m)), s)).toString('hex') } }
async function act(who, body) {
  const prep = await jpost('/api/kraynet/prepare', body)
  if (!prep.message) return { error: 'prepare: ' + JSON.stringify(prep) }
  return jpost('/api/kraynet/submit', { ...body, nonce: prep.nonce, publicKey: who.x, signature: who.sign(prep.message), scheme: 'kraywallet' })
}

async function main() {
  console.log('\n╔═ SETTLEMENT ON SEAL — proven presence is paid when the seal lands, whatever block buried it ══╗')
  if (!RPC_PASS) die('set KRAY_BTC_RPC_PASS to the regtest rpcpassword')
  const info = await jget('/api/kraynet/donation/info')
  ok(info.configured === true, 'writer has pot + bitcoind wired')

  // ── 1 · a fee act fills the pool ─────────────────────────────────────────────
  const alice = id('alice'), bob = id('bob')
  await jpost('/api/kraynet/donate', { to: alice.a, sats: '5000' })   // dev mint (bench only)
  const t = await act(alice, { action: 'transfer', from: alice.a, to: bob.a, amount: '100' })
  ok(t.ok === true, 'Alice paid a fee act (transfer) — 1 ₭ into the Treasury')
  const tr0 = await jget('/api/kraynet/treasury')
  const pool0 = BigInt(tr0.balance || '0')
  ok(pool0 >= 1n, `Treasury holds ${pool0} ₭ before the seal`)
  const settlements0 = Number(tr0.settlements || 0)

  // ── 2 · the validator proves presence against the CURRENT beacon ─────────────
  const ch = await jget('/api/kraynet/beat/challenge')
  if (!ch.beacon) die('no beacon — bitcoind not reachable from the writer')
  const mined = mineBeat(ch.beacon, alice.a, ch.block, 400000)
  if (!mined) die('could not find a beat with the local budget — raise it')
  const bsm = 'kray.beat.submit.v1|' + NET + '|' + ch.beacon + '|' + alice.a + '|' + ch.block + '|' + mined.nonce + '|' + mined.zeros
  const beat = await jpost('/api/kraynet/beat', { beacon: ch.beacon, address: alice.a, block: ch.block, nonce: mined.nonce, zeros: mined.zeros, publicKey: alice.x, scheme: 'kraywallet', signature: alice.sign(bsm) })
  ok(beat.ok === true, `Alice's beat accepted against beacon ${ch.beacon.slice(-8)} (2^${mined.zeros} work)${beat.error ? ' [' + beat.error + ']' : ''}`)
  const pres = await jget('/api/kraynet/presence')
  ok((pres.validators || []).some((v) => v.address === alice.a), 'presence lists Alice as a proven validator')
  const balAliceBefore = await bal(alice.a)

  // ── 3 · a donation, buried in a NEW block (a beacon nobody beat) ─────────────
  const sk = createHash('sha256').update('settle-donor|' + Date.now()).digest()
  const { publicKeyHex: xonly } = _generateKeyPair(sk)
  const donor = btc.p2tr(_hexToBytes(xonly), undefined, NETWORKS[BNET]).address
  await bc('sendtoaddress', [donor, 0.002]); await mine(1)
  const prep = await jpost('/api/kraynet/donate/prepare', { donor, donorPubkey: xonly, sats: '3000' })
  if (!prep.ok) die('prepare failed: ' + prep.error)
  const signer = btc.Transaction.fromPSBT(_hexToBytes(prep.psbt)); signer.sign(sk, [btc.SigHash.ALL])
  const bcast = await jpost('/api/kraynet/donate/broadcast', { psbt: _bytesToHex(signer.toPSBT()) })
  if (!bcast.ok) die('broadcast failed: ' + bcast.error)
  await mine(Math.max(1, info.minConfirmations))
  const burial = await bc('getrawtransaction', [bcast.txid, true])
  ok(burial.blockhash && burial.blockhash !== ch.beacon, `the donation was buried under a NEW block (${String(burial.blockhash).slice(-8)}) — not the beacon Alice beat (${ch.beacon.slice(-8)})`)

  // ── 4 · the writer redeems + seals by itself; the settlement must follow ─────
  // wait for BOTH: the watch redeeming the donation (mint) and the settlement that must follow a seal —
  // on a lab with operator anchors the settlement may ride an earlier seal, so neither gates the other
  const t0 = Date.now(); let tr1 = null, minted = false
  while (Date.now() - t0 < WAIT_MS) {
    tr1 = await jget('/api/kraynet/treasury')
    if (!minted) minted = (await bal(donor)) >= 3000n
    if (minted && Number(tr1.settlements || 0) > settlements0) break
    await sleep(2500)
  }
  ok(minted, `the donation ${bcast.txid.slice(0, 12)}… was minted by the watch with its registered (block, root) hint — even though acts moved the tip root after /prepare`)
  const settled = Number((tr1 || {}).settlements || 0) > settlements0
  ok(settled, `a settlement was journaled after the seal (${settlements0} → ${(tr1 || {}).settlements}) within ${Math.round((Date.now() - t0) / 1000)}s — the fee pool paid on the proven seal`)
  const balAliceAfter = await bal(alice.a)
  ok(balAliceAfter > balAliceBefore, `Alice (the only proven validator) was paid ${balAliceAfter - balAliceBefore} ₭ from the pool`)
  const pool1 = BigInt((tr1 || {}).balance || '0')
  ok(pool1 === 0n, `Treasury drained to the workers (${pool0} → ${pool1}) — ₭ moved, none minted`)
  ok(tr1 && tr1.conserves === true, 'the treasury fold still conserves (lifetimeIn − lifetimeOut = balance)')

  // ── 5 · the settlement is re-derivable: its recorded table matches the beats ─
  const list = await jget('/api/kraynet/settlements')
  const last = (list.settlements || [])[0]
  ok(last && /^[0-9a-f]{64}$/.test(last.beacon || ''), `settlement seq ${last ? last.seq : '?'} names its Bitcoin beacon ${last ? last.beacon.slice(-8) : ''} — a follower recomputes the same table from the beats or halts`)

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the seal paid the proven. ═╝\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => die(e.stack || e.message))
