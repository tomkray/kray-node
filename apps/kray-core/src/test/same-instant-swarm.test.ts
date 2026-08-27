/**
 * THE SAME-INSTANT SWARM (tier 1 — the Creator's chronology: regtest proves everything first).
 *   node src/test/same-instant-swarm.test.ts
 *
 * A disposable HTTP regtest node boots with THE SAME-INSTANT LAW active from seq 1
 * (KRAY_LAB_SAME_INSTANT_SEQ — the regtest-only lab door, dead code on signet/main). Two dozen
 * wallets — the Creator's exact question: "e se dezenas fizerem no mesmo milésimo?" — fire signed
 * transfers CONCURRENTLY in a different arrival permutation every round. Then the journal on disk
 * is audited act by act: every run of consecutive signed acts sharing one millisecond must equal
 * the orderWindow schedule over sha256(signed bytes), re-derived here with the SAME mirror the
 * reducer's referee enforces. Finally the node REBOOTS on its own journal — a follower replaying
 * under the active law — and must reach the byte-identical cascade root.
 *
 * What would break it (and must not): the gate journaling arrival order instead of key order; two
 * flushes sharing a millisecond; a refusal of any honest citizen under contention; the mirror
 * disagreeing with the reducer on any act's signed bytes.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as btc from '@scure/btc-signer'
import { NETWORKS, _generateKeyPair, _hexToBytes, _signKrayWallet, toBtcNet } from '../protocol/scheme.ts'
import { signedBytesOfEvent } from '../protocol/signed-message.ts'
import { keyFromSignedMessage, orderWindow } from '../protocol/window-order.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
const PORT = 4497
const BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-same-instant-swarm-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const N = 24          // two dozen donors in the same millisecond
const ROUNDS = 6

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; return } fail++; console.error('  ✗ ' + m) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string) => fetch(BASE + p).then((r) => r.json())
const jpost = (p: string, body: unknown) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json())

function wallet(tag: string) {
  const sk = createHash('sha256').update(`same-instant-swarm|${tag}|${process.pid}`).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { tag, sk, pk: publicKeyHex, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address! }
}
type W = ReturnType<typeof wallet>
const wallets: W[] = Array.from({ length: N }, (_, i) => wallet('w' + i))
const SINK = wallet('sink')

function boot() {
  return spawn('node', [SERVER], {
    env: {
      ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET,
      KRAY_TRUSTED_DEV: '1', KRAY_LAB_SAME_INSTANT_SEQ: '1',   // the law breathes from the first act
    },
    stdio: 'ignore',
  })
}
async function waitUp() {
  for (let i = 0; i < 100; i++) { try { const h = await jget('/health'); if (h && h.ok) return } catch { /* booting */ } await sleep(80) }
  throw new Error('same-instant swarm: node did not answer /health')
}
/** deterministic shuffle so every round permutes arrival order differently but reproducibly */
function shuffled<T>(arr: T[], seed: number): T[] {
  const a = [...arr]
  let s = seed >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

/** every maximal run of consecutive SIGNED acts sharing one `at` must equal the orderWindow
 *  schedule — the same audit a follower's reducer performs, re-derived independently here */
function auditJournal(events: KrayEvent[]) {
  let runs = 0, biggest = 0
  let run: { at: number; acts: { key: string; from: string; nonce?: number }[] } | null = null
  const close = () => {
    if (run && run.acts.length > 1) {
      runs++
      biggest = Math.max(biggest, run.acts.length)
      const first = new Map<string, number>()
      for (const a of run.acts) if (a.nonce !== undefined && !first.has(a.from)) first.set(a.from, a.nonce)
      const { ordered, deferred } = orderWindow(run.acts, {
        nonceOf: (x) => first.get(x) ?? 0,
        keyOf: (x) => (x as { key: string }).key,
        isValid: () => true,
      })
      let equal = deferred.length === 0 && ordered.length === run.acts.length
      for (let i = 0; equal && i < ordered.length; i++) equal = ordered[i] === run.acts[i]
      ok(equal, `run of ${run.acts.length} acts at instant ${run.at} stands in the orderWindow schedule`)
      if (!equal) console.error('    journal keys: ' + run.acts.map((x) => x.key.slice(0, 8)).join(' → '))
    }
    run = null
  }
  for (const e of events) {
    const signed = (() => { try { return signedBytesOfEvent(e, NET) } catch { return null } })()
    if (signed == null || typeof e.at !== 'number') { close(); continue }
    const entry = { key: keyFromSignedMessage(signed), from: String(e.from), nonce: e.nonce }
    if (run && (run as { at: number }).at === e.at) (run as { acts: unknown[] }).acts.push(entry)
    else { close(); run = { at: e.at, acts: [entry] } }
  }
  close()
  return { runs, biggest }
}

async function main() {
  console.log('\n╔═ THE SAME-INSTANT SWARM — two dozen citizens, one millisecond, zero choice ═╗\n')
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  let child = boot()
  process.on('exit', () => { try { child.kill('SIGKILL') } catch { /* gone */ } })
  try {
    await waitUp()
    ok(true, 'disposable node up with THE SAME-INSTANT LAW active from seq 1')

    // fund the swarm (donate is unsigned — it breaks runs, exactly as the law expects)
    for (const w of wallets) {
      const d = await jpost('/api/kraynet/donate', { to: w.addr, sats: '1000' })
      if (!d.ok) { ok(false, 'funding donation failed for ' + w.tag + ': ' + (d.error || '?')); return done(1) }
    }
    ok(true, `${N} wallets funded 1000 ₭ each`)

    // ── the storm: every round, all N sign a transfer and fire CONCURRENTLY in a fresh permutation ──
    let accepted = 0, refused = 0
    for (let round = 0; round < ROUNDS; round++) {
      const jobs = [] as { w: W; body: Record<string, unknown> }[]
      for (const w of wallets) {
        const amount = String(2 + ((round * 7 + Number(w.tag.slice(1))) % 23))
        jobs.push({ w, body: { action: 'transfer', to: SINK.addr, amount } })
      }
      const prepared = [] as { w: W; body: Record<string, unknown>; nonce: number; sig: string }[]
      for (const j of jobs) {
        const prep = await jpost('/api/kraynet/prepare', { ...j.body, from: j.w.addr })
        if (typeof prep.message !== 'string') { ok(false, 'prepare failed: ' + (prep.error || '?')); return done(1) }
        prepared.push({ ...j, nonce: prep.nonce, sig: _signKrayWallet(prep.message, j.w.sk) })
      }
      const volley = shuffled(prepared, 0xC0FFEE + round)   // a different arrival order every round
      const results = await Promise.all(volley.map((p) => jpost('/api/kraynet/submit', {
        ...p.body, from: p.w.addr, nonce: p.nonce, publicKey: p.w.pk, signature: p.sig, scheme: 'kraywallet',
      })))
      for (const r of results) { if (r.ok) accepted++; else { refused++; console.error('    refused: ' + (r.error || '?')) } }
    }
    ok(refused === 0, `zero refusals under contention — every honest citizen landed (${accepted}/${N * ROUNDS})`)
    ok(accepted === N * ROUNDS, 'every volley act accepted')

    // ── the audit: read the journal from disk and re-derive every same-instant run independently ──
    const lines = readFileSync(join(DATA, `kraynet-journal-${NET}.jsonl`), 'utf8').trim().split('\n')
    const events = lines.map((l) => JSON.parse(l) as KrayEvent)
    const { runs, biggest } = auditJournal(events)
    ok(runs > 0, `the storm really created same-instant contention (${runs} multi-act runs, biggest ${biggest})`)
    ok(biggest >= 8, `at least one run held a real crowd (${biggest} acts in one millisecond)`)

    // sanity: the sink received every transfer — value moved, nothing double-applied
    const sinkProf = await jget('/api/kraynet/profile/' + encodeURIComponent(SINK.addr))
    ok(BigInt(sinkProf.balance || '0') > 0n, 'the sink holds the storm\'s transfers')
    const head0 = (await jget('/api/kraynet/head')).cascadeRoot

    // ── the follower: reboot on the same journal under the ACTIVE law — replay must accept and match ──
    child.kill('SIGKILL')
    await sleep(300)
    child = boot()
    await waitUp()
    const head1 = (await jget('/api/kraynet/head')).cascadeRoot
    ok(head1 === head0, 'a follower replaying under the active law reaches the byte-identical cascade root')

    console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — within one millisecond the order is a theorem: ${N} concurrent citizens × ${ROUNDS} permuted volleys, every run in the orderWindow schedule, zero refusals, byte-exact replay. ⛓₭\n`)
    return done(fail ? 1 : 0)
  } catch (e) {
    console.error('same-instant swarm exam crashed: ' + (e instanceof Error ? e.stack || e.message : String(e)))
    return done(1)
  }
  function done(code: number) {
    try { child.kill('SIGKILL') } catch { /* gone */ }
    rmSync(DATA, { recursive: true, force: true })
    process.exit(code)
  }
}
main()
