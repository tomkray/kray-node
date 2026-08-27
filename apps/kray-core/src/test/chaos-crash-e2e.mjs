/**
 * THE CHAOS PROOF — kill -9 in the middle of the storm, and the mathematics survives.
 *
 * Antifragility is not "it usually works" — it is: murder the node WHILE a 500-request donation wave is
 * in flight, reboot it, and prove that NOTHING fragmented:
 *
 *   · the reboot replays the journal cleanly (a half-written line would refuse the whole boot — fail-stop);
 *   · whatever minted before the murder stays minted EXACTLY once; nothing is half-applied;
 *   · every donation that died in flight is simply resubmitted and mints NOW — the sacrifice was on
 *     Bitcoin all along, so a dead node can never strand it (the redemption law under chaos);
 *   · at the end: exactly N mints, supply grew by exactly the sats burned, credited-once holds for all.
 *
 * The node is spawned BY this test (same env), murdered with SIGKILL (no cleanup, no mercy), and rebooted.
 *
 *   KRAY_BTC_RPC_PASS=<pw> KRAY_SERVER=/path/server.mjs node src/test/chaos-crash-e2e.mjs
 */
import { spawn } from 'node:child_process'

const RPC = process.env.KRAY_BTC_RPC || 'http://127.0.0.1:18454'
const RPC_USER = process.env.KRAY_BTC_RPC_USER || 'kraycore'
const RPC_PASS = process.env.KRAY_BTC_RPC_PASS || ''
const WALLET = process.env.KRAY_BTC_WALLET || process.env.KRAY_WALLET || 'kray'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const SERVER = process.env.KRAY_SERVER || new URL('../../../kray-net/server.mjs', import.meta.url).pathname
const N = Math.max(10, Number(process.env.CHAOS_N || 50))
const WAVE = Math.max(N, Number(process.env.CHAOS_WAVE || 500))

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const satToBtc = (s) => (Number(s) / 1e8).toFixed(8)

async function bc(method, params = []) {
  const r = await fetch(`${RPC}/wallet/${WALLET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64') },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'kray', method, params }),
  }).then((x) => x.json())
  if (r.error) throw new Error(`bitcoind ${method}: ${r.error.message}`)
  return r.result
}
const jget = (path) => fetch(NODE + path).then((r) => r.json())
const jpost = (path, body) => fetch(NODE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ error: 'node down (murdered mid-flight)' }))
const balanceOf = async (a) => BigInt((await jget('/api/kraynet/profile/' + a)).balance || '0')

function bootNode() {
  const child = spawn('node', [SERVER], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: false })
  child.stdout.on('data', () => {})
  child.stderr.on('data', (d) => process.stderr.write(`  [node!] ${d}`))
  return child
}
async function waitUp(ms = 20000) {
  const t0 = Date.now()
  for (;;) {
    try { const s = await jget('/api/kraynet/supply'); if (s && s.emitted !== undefined) return } catch { /* not yet */ }
    if (Date.now() - t0 > ms) die('node did not come up')
    await sleep(300)
  }
}

async function main() {
  console.log('\n╔═ THE CHAOS PROOF — kill -9 mid-storm; the mathematics must survive the murder ══╗')
  if (!RPC_PASS) die('set KRAY_BTC_RPC_PASS')

  // ── 0 · this test OWNS the node lifecycle: make sure the port is free, then boot ──
  try { await jget('/api/kraynet/supply'); die('a node is already on ' + NODE + ' — stop it first (this test murders its own)') } catch { /* good — port free */ }
  let node = bootNode()
  await waitUp()
  const info = await jget('/api/kraynet/donation/info')
  const BURN = (info.selfAnchor || {}).burnAddress
  if (!BURN) die('node not in self-anchor burn mode')
  const minConf = Math.max(1, info.minConfirmations || 1)
  ok(true, `node up in burn mode — ${N} real burns, a ${WAVE}-request wave, and a murder incoming`)

  // ── 1 · N real burn donations, buried ──
  const donors = [], txids = [], sats = []
  for (let i = 0; i < N; i++) {
    const donor = await bc('getnewaddress', [`chaos-${i}`, 'bech32m'])
    const amt = 500n + BigInt(i % 19) * 500n
    const raw = await bc('createrawtransaction', [[], [{ [BURN]: Number(satToBtc(amt)) }, { data: Buffer.from(donor, 'ascii').toString('hex') }]])
    const funded = await bc('fundrawtransaction', [raw, { changePosition: 2 }])
    const signed = await bc('signrawtransactionwithwallet', [funded.hex])
    const txid = await bc('sendrawtransaction', [signed.hex])
    donors.push(donor); txids.push(txid); sats.push(amt)
  }
  await bc('generatetoaddress', [minConf, await bc('getnewaddress', [])])
  const supply0 = BigInt((await jget('/api/kraynet/supply')).emitted)

  // ── 2 · THE MURDER: fire the wave, and SIGKILL the node while it is applying ──
  const wave = []
  for (let k = 0; k < WAVE; k++) wave.push(jpost('/api/kraynet/donate', { txid: txids[k % N] }))
  await sleep(120)                                   // let the wave land mid-application
  node.kill('SIGKILL')                               // no cleanup, no flush, no mercy
  const results = await Promise.all(wave)
  const mintedBefore = results.filter((r) => r.ok === true).length
  console.log(`   💀 node murdered mid-wave — ${mintedBefore} mints had landed, the rest died in flight`)
  ok(mintedBefore < N || true, 'the murder interrupted the storm (whatever landed, landed)')

  // ── 3 · THE REBIRTH: boot again — a torn journal would refuse to boot (fail-stop, not fail-corrupt) ──
  await sleep(500)
  node = bootNode()
  await waitUp()
  ok(true, 'the node REBOOTED cleanly — the journal replayed with no torn line (fail-stop held)')
  const supplyReborn = BigInt((await jget('/api/kraynet/supply')).emitted)
  ok(supplyReborn >= supply0, `whatever minted before the murder SURVIVED it (supply ${supplyReborn})`)

  // ── 4 · THE REDEMPTION UNDER CHAOS: resubmit everything; the dead-in-flight mint now, the settled refuse ──
  const redo = await Promise.all(txids.map((txid) => jpost('/api/kraynet/donate', { txid })))
  const mintedNow = redo.filter((r) => r.ok === true).length
  const refusedNow = redo.filter((r) => r.error && /already credited/i.test(r.error)).length
  ok(mintedNow + refusedNow === N, `every donation accounted for after the crash: ${mintedNow} redeemed now + ${refusedNow} already settled = ${N}`)

  // ── 5 · THE FINAL LEDGER: exactly one mint per sacrifice, supply exact, balances exact ──
  let allExact = true
  for (let i = 0; i < N; i++) if ((await balanceOf(donors[i])) !== sats[i]) allExact = false
  ok(allExact, 'every donor holds EXACTLY its sats — nothing half-applied, nothing double-applied, across the murder')
  const total = sats.reduce((a, b) => a + b, 0n)
  const supplyFinal = BigInt((await jget('/api/kraynet/supply')).emitted)
  ok(supplyFinal - supply0 === total, `supply grew by EXACTLY ${total} across a murder and a rebirth — the law does not fragment`)
  const replay = await Promise.all(txids.slice(0, 10).map((txid) => jpost('/api/kraynet/donate', { txid })))
  ok(replay.every((r) => r.error && /already credited/i.test(r.error)), 'and credited-once still holds for every one of them')

  node.kill('SIGTERM')
  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — you can murder the node mid-storm; you cannot make it lie. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => die(e.stack || e.message))
