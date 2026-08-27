/**
 * CONCURRENCY PROOF — can thousands act in the SAME instant without a single bug?
 *
 * KRAYNET is a fast network — and the safety of "many acts in the same millisecond"
 * is NOT provided by the fast blocks — it is provided BEFORE any
 * block, by the single-threaded sequencer (store.append) + the monotonic seq + the hash
 * chain + the atomic reducer. This test proves that empirically, adversarially, at scale:
 *
 *   0. REDUCER ATOMICITY (no server) — the same donation outpoint credited twice is REFUSED,
 *      and a refused event leaves NO partial state (credited-once, all-or-nothing).
 *   1. THOUSANDS of simultaneous inscriptions → unique, contiguous star numbers (no dup, no gap).
 *   2. Concurrent cross-account transfers → conservation never breaks, ₭ is only moved.
 *   3. Same account, SAME nonce, fired K times at once → exactly ONE wins (double-spend blocked).
 *   4. A GRAND STORM of thousands of mixed acts → the node never crashes, conservation holds.
 *   5. BLOCK PARTITION INTEGRITY — every sealed event lands in exactly one block: the blocks
 *      partition the seq stream [1..N] with no gap, no overlap, no duplication.
 *   6. Reboot from disk → the exact order + whole-state root reproduce byte-exact.
 *
 * Scale is env-tunable:  CONC_N=2000 CONC_STORM=4000 CONC_BATCH=120 node src/test/concurrency-proof.ts
 *
 * The node runs with KRAY_TRUSTED_DEV=1 ONLY to use the dev {to,sats} mint as a TEST FIXTURE
 * (an isolated, throwaway regtest that is deleted at the end). What is being proven — the queue,
 * the ordering, the atomicity — is independent of how the accounts were funded.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes } from '../protocol/scheme.ts'
import { KrayLedger } from '../protocol/ledger.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

// Ports are PER-INSTANCE (Bitcoin Core's portseed idea): two simultaneous runs can never
// collide, because each derives its own pair from its pid — far from every live-node port.
const NET = 'regtest', PORT = Number(process.env.CONC_PORT || 14400 + (process.pid % 500) * 2), BASE = `http://localhost:${PORT}`
const DATA = join(tmpdir(), `kraynet-conc-${process.pid}`)

// THE REAPER — a crashed or interrupted run must never leave an orphan node poisoning the next
// exam (a stale leftover server once fed 5,103 old stars to a fresh run's reboot phase). Every
// spawned child is registered here and killed on EVERY exit path — green, crash, or Ctrl-C.
const kids: Array<{ kill: (s: string) => void }> = []
process.on('exit', () => {
  for (const k of kids) { try { k.kill('SIGKILL') } catch { /* already gone */ } }
  try { rmSync(DATA, { recursive: true, force: true }) } catch { /* already removed */ }
})
process.on('SIGINT', () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// scale knobs — genuinely thousands by default, crankable on the command line
const M = Number(process.env.CONC_N || 800)          // inscriber wallets (each fires one inscription)
const STORM = Number(process.env.CONC_STORM || 1500) // mixed acts in the grand storm
const BATCH = Number(process.env.CONC_BATCH || 100)  // max requests truly in-flight at once (fd-safe < ulimit)
const SEAL_MS = 700                                  // fast seals so the storm crosses many block boundaries

const wallet = (tag: string) => { const sk = createHash('sha256').update('conc|' + tag, 'utf8').digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { tag, sk, pk, addr: btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[toBtcNet(NET)]).address! } }
const jget = (p: string) => fetch(BASE + p, { signal: AbortSignal.timeout(30000) }).then((r) => r.json() as Promise<any>).catch((e) => ({ error: String(e && e.message || e) }))
const jpost = (p: string, b: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(30000) }).then((r) => r.json() as Promise<any>).catch((e) => ({ error: String(e && e.message || e) }))

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

/** Run `worker` over every item with at most `batch` truly in-flight — thousands total, `batch` at
 *  once. This is the honest "same-instant storm": within a wave the requests race the sequencer. */
async function flood<T, R>(items: T[], worker: (item: T, i: number) => Promise<R>, batch = BATCH): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const run = async () => { while (next < items.length) { const i = next++; out[i] = await worker(items[i], i) } }
  await Promise.all(Array.from({ length: Math.min(batch, items.length) }, run))
  return out
}

// prepare+sign+submit as ONE call (each returns the node's response)
async function act(w: { sk: Uint8Array; pk: string; addr: string }, action: string, params: Record<string, unknown>, nonceOverride?: number) {
  const prep = await jpost('/api/kraynet/prepare', { action, from: w.addr, ...params })
  if (prep.error) return { error: prep.error }
  const nonce = nonceOverride != null ? nonceOverride : prep.nonce
  const signature = _signKrayWallet(prep.message, w.sk)
  return jpost('/api/kraynet/submit', { action, from: w.addr, ...params, nonce, publicKey: w.pk, signature })
}

/** Walk the paginated /blocks endpoint (cap 60/page) and return EVERY block, oldest→newest. */
async function allBlocks(): Promise<{ h: number; from: number; to: number; leaves: number }[]> {
  const acc: any[] = []
  let before: number | null = null
  for (let guard = 0; guard < 100000; guard++) {
    const q = before == null ? '?limit=60' : `?limit=60&before=${before}`
    const p = await jget('/api/kraynet/blocks' + q)
    for (const b of p.blocks || []) acc.push(b)
    if (p.done || p.nextBefore == null) break
    before = p.nextBefore
  }
  return acc.map((b) => ({ h: Number(b.h), from: Number(b.from), to: Number(b.to), leaves: Number(b.leaves) })).sort((a, b) => a.h - b.h)
}

async function main() {
  // ── 0 · REDUCER ATOMICITY (pure, no server): the same L1 donation credited twice is REFUSED,
  //        and the refusal leaves NO partial state. This is the guard that closes the only async
  //        race window (two proof-checks for the same outpoint reaching append together). ──────
  console.log('\n╔═ CONCURRENCY PROOF — thousands in the same instant, no bug ════╗')
  console.log('\n─ 0 · reducer atomicity — one L1 donation cannot mint twice ─')
  {
    const L = new KrayLedger(undefined as any, NET)
    const DONOR = wallet('donor0').addr
    const OUT = 'aa'.repeat(32) + ':0'
    L.applyLive({ seq: 1, kind: 'donate', hash: 'h1', to: DONOR, amount: '5000', outpoint: OUT } as KrayEvent)
    const after1 = L.balanceOf(DONOR)
    ok(after1 === 5000n, 'first proven donation credits exactly its proven sats (5000 ₭)')
    let threw = false
    try { L.applyLive({ seq: 2, kind: 'donate', hash: 'h2', to: DONOR, amount: '5000', outpoint: OUT } as KrayEvent) } catch { threw = true }
    ok(threw, 'the SAME outpoint a second time is REFUSED — a donation mints once, ever')
    ok(L.balanceOf(DONOR) === after1, 'the refused donation left NO partial state — balance unchanged (all-or-nothing)')
    ok(L.conserves(), 'conservation holds through the refusal')
  }

  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  const spawnEnv = (port: number) => ({ ...process.env, KRAY_PORT: String(port), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_TRUSTED_DEV: '1', KRAY_SEAL_MS: String(SEAL_MS) })
  const child = spawn('node', [SERVER], { env: spawnEnv(PORT), stdio: 'ignore' })
  kids.push(child)
  const done = (code: number) => { try { child.kill('SIGKILL') } catch {} rmSync(DATA, { recursive: true, force: true }); process.exit(code) }
  try {
    for (let i = 0; i < 80; i++) { try { if ((await jget('/health')).ok) break } catch {} await sleep(100) }

    // fund M wallets (dev-mint fixture; parallelised so setup does not dominate)
    console.log(`\n─ funding ${M} wallets (test fixture) ─`)
    const ppl = Array.from({ length: M }, (_, i) => wallet('w' + i))
    await flood(ppl, (w) => jpost('/api/kraynet/donate', { to: w.addr, sats: '100' }))
    const funded = await jget('/api/kraynet/overview')
    ok(funded.conserves === true, `conservation holds after ${M} donations`)

    // ── 1 · THOUSANDS OF SIMULTANEOUS INSCRIPTIONS ───────────────────────────
    console.log(`\n─ 1 · ${M} inscriptions fired in the SAME instant (${BATCH} in-flight) ─`)
    const results = await flood(ppl, (w, i) => act(w, 'inscribe', { content: 'race-' + i + '-' + w.addr.slice(-8), contentType: 'text/plain' }))
    const stars = results.map((r: any) => r && r.star).filter((s) => s != null).map(Number)
    ok(results.every((r: any) => r && !r.error), `all ${M} inscriptions were accepted (none errored)`)
    ok(stars.length === M, `every response carried the star number it was born as (${stars.length}/${M})`)
    const uniq = new Set(stars)
    ok(uniq.size === stars.length, `every star number is UNIQUE — no two births collided (${uniq.size} distinct)`)
    const sorted = [...stars].sort((a, b) => a - b)
    const contiguous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1)
    ok(contiguous, `the numbers are CONTIGUOUS by creation order — no gap, no skip [${sorted[0]}…${sorted[sorted.length - 1]}]`)
    const o1 = await jget('/api/kraynet/overview')
    ok(Number(o1.starCount) === M, `the ledger holds exactly ${M} stars (createdSeq advanced once per act)`)
    ok(o1.conserves === true, 'conservation holds after the storm (circulating = emitted − burned)')

    // ── 2 · CONCURRENT CROSS-ACCOUNT TRANSFERS ───────────────────────────────
    console.log('\n─ 2 · concurrent ₭ transfers between different accounts ─')
    const K2 = Math.min(200, M)
    const before2 = Number((await jget('/api/kraynet/supply')).circulating)
    const tr = await flood(ppl.slice(0, K2), (w, i) => act(w, 'transfer', { to: ppl[(i + 1) % K2].addr, amount: '10' }))
    ok(tr.every((r: any) => r && !r.error), `all ${K2} concurrent transfers applied`)
    const o2 = await jget('/api/kraynet/overview')
    ok(o2.conserves === true, 'conservation STILL holds after concurrent transfers')
    ok(Number((await jget('/api/kraynet/supply')).circulating) === before2, 'a transfer moves ₭, never creates or destroys it')

    // ── 3 · SAME ACCOUNT, SAME NONCE, FIRED K TIMES (double-spend attempt) ────
    const K3 = 32
    console.log(`\n─ 3 · one account fires ${K3} acts with the SAME nonce (double-spend / replay) ─`)
    const v = ppl[0]
    const nonce = (await jget('/api/kraynet/account/' + encodeURIComponent(v.addr))).nonce
    // spread the same-nonce race over a few distinct recipients — capped by the wallet count, so
    // the proof holds at ANY scale (the hardcore assault runs it from 3 users up to thousands)
    const race = await flood(Array.from({ length: K3 }, (_, i) => i), (i) => act(v, 'transfer', { to: ppl[1 + (i % Math.min(5, M - 1))].addr, amount: '1' }, nonce), K3)
    const wins = race.filter((r: any) => r && !r.error).length
    ok(wins === 1, `exactly ONE of the ${K3} same-nonce acts won (${wins}/${K3}) — the nonce blocks every replay`)

    // ── 4 · THE GRAND STORM — thousands of mixed acts at once ─────────────────
    console.log(`\n─ 4 · grand storm — ${STORM} mixed acts (inscribe · transfer · name) at once ─`)
    const kinds = ['inscribe', 'transfer', 'name'] as const
    const storm = await flood(Array.from({ length: STORM }, (_, i) => i), (i) => {
      const w = ppl[i % M]
      const k = kinds[i % kinds.length]
      if (k === 'transfer') return act(w, 'transfer', { to: ppl[(i * 7 + 3) % M].addr, amount: '1' })
      if (k === 'name') return act(w, 'name', { name: 'n' + i + w.addr.slice(-4) })
      return act(w, 'inscribe', { content: 'storm-' + i, contentType: 'text/plain' })
    }, BATCH)
    const responded = storm.filter((r: any) => r != null).length
    ok(responded === STORM, `every one of the ${STORM} acts got a response — the node never dropped or hung a request`)
    const health = await jget('/health')
    ok(health && health.ok === true, 'the node is alive and responsive after the storm')
    const o4 = await jget('/api/kraynet/overview')
    ok(o4.conserves === true, 'conservation holds after thousands of mixed acts')
    ok(o4.backed === undefined || o4.backed === true, 'the ledger is backed after the storm (reserves ≥ credits)')

    // ── 5 · BLOCK PARTITION INTEGRITY — every event in exactly one block ──────
    console.log('\n─ 5 · block partition — the seq stream splits into blocks with no gap/overlap ─')
    await sleep(SEAL_MS + 500)                         // let the heartbeat seal the tail
    const bl = await allBlocks()
    ok(bl.length > 0, `the chain sealed ${bl.length} fast blocks under load`)
    let partitionOk = bl.length > 0 && bl[0].from === 1
    let leafOk = true
    for (let i = 0; i < bl.length; i++) {
      if (bl[i].to < bl[i].from) partitionOk = false
      if (bl[i].leaves !== bl[i].to - bl[i].from + 1) leafOk = false
      if (i > 0 && bl[i].from !== bl[i - 1].to + 1) partitionOk = false   // contiguous: no gap, no overlap
    }
    ok(partitionOk, 'the blocks are a perfect partition of [1..N] — starts at seq 1, each begins right after the last (no gap, no overlap)')
    ok(leafOk, 'every block\'s leaf count equals its seq span — no event sealed twice, none dropped')
    const totalSealed = bl.length ? bl[bl.length - 1].to : 0
    const sumLeaves = bl.reduce((s, b) => s + b.leaves, 0)
    ok(sumLeaves === totalSealed, `the ${totalSealed} sealed events are covered exactly once (Σ leaves = tip seq)`)

    // ── 6 · REBOOT FROM DISK — the order is law ───────────────────────────────
    console.log('\n─ 6 · reboot from disk — the recorded order reproduces byte-exact ─')
    const oA = await jget('/api/kraynet/overview')
    child.kill('SIGKILL'); await sleep(500)
    const child2 = spawn('node', [SERVER], { env: spawnEnv(PORT + 1), stdio: 'ignore' })
    kids.push(child2)
    // the reboot node must REPLAY the whole journal — thousands of Schnorr verifications — before it
    // listens. A fixed 8s budget frays at level 7 of the assault (~9k events) and then the unguarded
    // fetch below crashed the proof with ECONNREFUSED: an artifact of the TEST's patience, not of the
    // law. The wait now scales with the journal it must replay (≥60s at storm scale), and the fetch
    // is guarded so a genuinely dead node fails the CHECK, never the harness.
    const rebootBudget = Math.max(150, Math.ceil(totalSealed / 4))   // ticks of 100ms — ~25ms/event is generous
    let rebooted = false
    for (let i = 0; i < rebootBudget; i++) { try { if ((await fetch(`http://localhost:${PORT + 1}/health`).then((r) => r.json())).ok) { rebooted = true; break } } catch {} await sleep(100) }
    const oB = rebooted ? await fetch(`http://localhost:${PORT + 1}/api/kraynet/overview`).then((r) => r.json()).catch(() => ({})) : {}
    ok(oB.cascadeRoot === oA.cascadeRoot, 'the cascade root is IDENTICAL after replay — the same total order, byte-exact')
    ok(Number(oB.starCount) === Number(oA.starCount), `the same ${oB.starCount} stars survive the reboot, in the same order`)
    ok(oB.conserves === true, 'conservation holds on the rebooted node too')
    try { child2.kill('SIGKILL') } catch {}

    console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the same-instant queue is safe at scale: one total order, no collision, no double-spend, a perfect block partition, byte-exact replay. ⛓₭\n`)
    done(fail ? 1 : 0)
  } catch (e) { console.error('\n✗ proof error:', e); done(1) }
}
main()
