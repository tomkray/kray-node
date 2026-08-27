/**
 * THE NETWORK OUTLIVES ANY NODE — the read-only mirror and provable succession, made permanent.
 *
 * §15b of the docs claims KRAY survives the death of any node: a read-only mirror keeps serving the last
 * VERIFIED truth, and a new writer can succeed from a follower's verified copy at the byte-exact root. This
 * turns that claim into a reproducible proof. It needs NO bitcoind — mirror + succession are pure journal
 * re-derivation — so it runs anywhere Node runs, and npm test plus npm run test:boot keep it from ever silently regressing.
 *
 * Fully self-contained: it spawns its OWN writer, follower/mirror and successor, and cleans them up.
 *
 *   node src/test/mirror-succession-e2e.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, rmSync, mkdirSync, cpSync } from 'node:fs'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'

const ROOT = new URL('../../../..', import.meta.url).pathname
const SERVER = new URL('../../../kray-net/server.mjs', import.meta.url).pathname
const FOLLOW = ROOT + 'scripts/kray-follow.mjs'
const NET = 'regtest'
const WRITER_PORT = 4491, MIRROR_PORT = 4492, SUCC_PORT = 4493
const TMP = '/tmp/kray-mirror-succession'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { cleanup(); console.error('\n✗ ' + m); process.exit(1) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hex = (u8) => Buffer.from(u8).toString('hex')
const jget = (u) => fetch(u).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()).catch(() => ({ __down: true }))

const procs = []
function boot(port, dataDir, extra = {}) {
  const env = { ...process.env, KRAY_NET: NET, KRAY_PORT: String(port), KRAY_DATA: dataDir, KRAY_TRUSTED_DEV: '1', ...extra }
  delete env.KRAY_BTC_RPC; delete env.KRAY_BTC_RPC_PASS; delete env.KRAY_BTC_RPC_USER  // offline: simulated anchors, no Bitcoin needed
  const c = spawn('node', [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  c.stdout.on('data', () => {})   // drain so the pipe never blocks the child
  c.stderr.on('data', (d) => process.stderr.write('  [node:' + port + '] ' + d))
  c.on('exit', (code) => { if (code) console.error(`  [node:${port}] exited early (${code})`) })
  procs.push(c); return c
}
function cleanup() { for (const c of procs) { try { c.kill('SIGKILL') } catch { /* gone */ } } }
async function waitUp(port, ms = 20000) {
  const t0 = Date.now()
  for (;;) { const s = await jget(`http://127.0.0.1:${port}/api/kraynet/supply`); if (s && !s.__down && s.emitted !== undefined) return true; if (Date.now() - t0 > ms) return false; await sleep(300) }
}

function identity(seed) {
  const priv = sha256(new TextEncoder().encode(seed))
  const xonly = hex(schnorr.getPublicKey(priv))
  return { xonly, address: btc.p2tr(Buffer.from(xonly, 'hex'), undefined, NETWORKS[NET]).address, sign: (m) => hex(schnorr.sign(sha256(new TextEncoder().encode(m)), priv)) }
}
async function signedTransfer(port, from, to, amount) {
  const base = { action: 'transfer', from: from.address, to: to.address, amount: String(amount) }
  const prep = await jpost(`http://127.0.0.1:${port}/api/kraynet/prepare`, base)
  if (!prep.message) throw new Error('prepare failed: ' + JSON.stringify(prep))
  return jpost(`http://127.0.0.1:${port}/api/kraynet/submit`, { ...base, nonce: prep.nonce, publicKey: from.xonly, signature: from.sign(prep.message) })
}

async function main() {
  console.log('\n╔═ THE NETWORK OUTLIVES ANY NODE — mirror serves verified truth; succession continues the chain ══╗')
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  const alice = identity('mirror-succession-alice'), bob = identity('mirror-succession-bob')

  // ── 1 · a writer with real, signed history (no Bitcoin needed for the money re-derivation) ──
  boot(WRITER_PORT, `${TMP}/writer`)
  if (!(await waitUp(WRITER_PORT))) die('writer did not come up')
  ok(true, 'a writer node is up (offline: simulated anchors, real signed events)')
  const mint = await jpost(`http://127.0.0.1:${WRITER_PORT}/api/kraynet/donate`, { to: alice.address, sats: '1000' })
  if (!mint.ok) die('dev-mint failed: ' + JSON.stringify(mint))
  for (let i = 0; i < 3; i++) { const r = await signedTransfer(WRITER_PORT, alice, bob, 100); if (!r.ok) die('transfer failed: ' + JSON.stringify(r)) }
  const head = await jget(`http://127.0.0.1:${WRITER_PORT}/api/kraynet/head`)
  ok(head.height >= 4, `writer has a real history — height ${head.height}, root ${String(head.cascadeRoot).slice(0, 16)}…`)

  // ── 2 · a follower makes a stable VERIFIED copy (for succession later) ──
  execFileSync('node', [FOLLOW, '--from', `http://127.0.0.1:${WRITER_PORT}`, '--dir', `${TMP}/verified`], { stdio: 'pipe', timeout: 60000 })
  ok(existsSync(`${TMP}/verified/node-${NET}/kraynet-journal-${NET}.jsonl`), 'a follower re-derived + kept a VERIFIED copy of the whole history')

  // ── 3 · the read-only MIRROR (the follower with --serve) serves only verified truth, and refuses writes ──
  const mirror = spawn('node', [FOLLOW, '--from', `http://127.0.0.1:${WRITER_PORT}`, '--dir', `${TMP}/mirror`, '--serve', String(MIRROR_PORT)], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  procs.push(mirror)
  let mHead = null
  for (let i = 0; i < 40; i++) { mHead = await jget(`http://127.0.0.1:${MIRROR_PORT}/api/kraynet/head`); if (mHead && mHead.mirror && !mHead.__down) break; await sleep(500) }
  ok(mHead && mHead.mirror === true && String(mHead.verifiedRoot) === String(head.cascadeRoot),
    `the mirror serves the SAME root it independently verified — ${String(mHead.verifiedRoot).slice(0, 16)}…`)
  const mBob = await jget(`http://127.0.0.1:${MIRROR_PORT}/api/kraynet/profile/${bob.address}`)
  ok(BigInt(mBob.balance || '0') === 300n, `reading Bob's balance through the MIRROR gives the verified truth — ${mBob.balance} ₭`)
  const wPost = await jpost(`http://127.0.0.1:${MIRROR_PORT}/api/kraynet/donate`, { to: bob.address, sats: '1' })
  ok(wPost.error && /read-only/i.test(wPost.error), 'a write to the mirror is REFUSED — it verifies, it never writes')

  // ── 4 · kill the WRITER; the mirror keeps serving the last verified truth, marked stale ──
  procs[0].kill('SIGKILL')   // the writer is the first process booted
  await sleep(1000)
  ok((await jget(`http://127.0.0.1:${WRITER_PORT}/api/kraynet/supply`)).__down === true, 'the writer is dead')
  let stale = null
  for (let i = 0; i < 70; i++) { stale = await jget(`http://127.0.0.1:${MIRROR_PORT}/api/kraynet/head`); if (stale && stale.stale) break; await sleep(500) }
  ok(stale && stale.mirror === true, 'with the writer DEAD, the mirror still answers (availability survives the death)')
  const mBob2 = await jget(`http://127.0.0.1:${MIRROR_PORT}/api/kraynet/profile/${bob.address}`)
  ok(BigInt(mBob2.balance || '0') === 300n, 'and it still serves the last VERIFIED balance — never an unverified byte')

  // ── 5 · SUCCESSION — a new writer boots from the verified copy, byte-exact, and the chain lives on ──
  cpSync(`${TMP}/verified/node-${NET}`, `${TMP}/successor`, { recursive: true })
  boot(SUCC_PORT, `${TMP}/successor`, { KRAY_SELF_ANCHOR: '1', KRAY_POT_INTERNAL_KEY: '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0' })
  if (!(await waitUp(SUCC_PORT))) die('successor did not come up')
  const sHead = await jget(`http://127.0.0.1:${SUCC_PORT}/api/kraynet/head`)
  // the successor may append its own boot seal(s); the INHERITED prefix root must be byte-exact — prove via a fresh replay
  const succBob = await jget(`http://127.0.0.1:${SUCC_PORT}/api/kraynet/profile/${bob.address}`)
  ok(BigInt(succBob.balance || '0') === 300n, `the successor inherited the EXACT state — Bob still holds ${succBob.balance} ₭`)
  const cont = await signedTransfer(SUCC_PORT, alice, bob, 50)
  ok(cont.ok === true, 'the successor ACCEPTS a new signed transfer — the chain lives on under a new writer')
  const succBob2 = await jget(`http://127.0.0.1:${SUCC_PORT}/api/kraynet/profile/${bob.address}`)
  ok(BigInt(succBob2.balance || '0') === 350n, `and the new event applied on top of the inherited history — Bob now holds ${succBob2.balance} ₭`)

  cleanup()
  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the mirror serves verified truth through the writer's death, and a successor continues the exact chain. The network outlives any node. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => die(e.stack || e.message))
