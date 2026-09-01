/**
 * QUEUE-AT-SCALE SIMULATION — 1,000,000 transactions per MINUTE (Visa/Mastercard order of magnitude).
 * Not a promise: real schnorr-signed acts, the real orderWindow, the real reducer.
 *
 *   S-1  SIGN     — forge one full second of Visa-scale load (16,667 signed transfers)
 *   S-2  WINDOWS  — order that second as the live gate does: 250 windows of ~67 acts (4 ms flush)
 *   S-3  STORM    — all 16,667 acts land in ONE millisecond: one giant window, still deterministic
 *   S-4  SHUFFLE  — permute arrival 3× at storm scale: the ordered sequence is byte-identical
 *   S-5  MILLION  — 1,000,000 acts in ONE window (a whole minute colliding at one instant)
 *   S-6  VERIFY   — schnorr verification throughput (the physical bottleneck, single thread)
 *   S-7  APPLY    — the full live reducer path (requireSig + mirror referee + law) acts/sec
 *
 * Run: node src/test/bench-queue-scale.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, verifyKrayWallet } from '../protocol/scheme.ts'
import { orderWindow, keyFromSignedMessage, type SignedAct } from '../protocol/window-order.ts'

const NET = 'regtest'
const RATE_PER_MIN = 1_000_000
const RATE_PER_SEC = Math.ceil(RATE_PER_MIN / 60)          // 16,667
const FLUSH_MS = 4                                          // the live gate's tick
const PER_WINDOW = Math.ceil(RATE_PER_SEC * FLUSH_MS / 1000) // ~67 acts per flush
const WINDOWS_PER_SEC = Math.ceil(1000 / FLUSH_MS)           // 250

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const ms = (t0: number) => (performance.now() - t0)

function wallet(tag: string) {
  const sk = createHash('sha256').update('bench|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}

interface BenchAct extends SignedAct { msg: string; sig: string; pk: string; amount: string }

function main() {
  console.log(`\n╔═ QUEUE AT VISA SCALE — ${RATE_PER_MIN.toLocaleString()} tx/min = ${RATE_PER_SEC.toLocaleString()} tx/s = ${PER_WINDOW} acts per ${FLUSH_MS} ms window ═╗\n`)

  // ── S-1 · SIGN one full second of load: 1,000 wallets, ~17 sequential-nonce transfers each ──
  const NW = 1000
  const SINK = wallet('SINK')
  console.log(`S-1 — signing ${RATE_PER_SEC.toLocaleString()} real schnorr transfers (${NW} wallets)…`)
  let t0 = performance.now()
  const wallets = Array.from({ length: NW }, (_, i) => wallet('w' + i))
  const acts: BenchAct[] = []
  outer: for (let nonce = 0; ; nonce++) {
    for (let w = 0; w < NW; w++) {
      if (acts.length >= RATE_PER_SEC) break outer
      const from = wallets[w]
      const amount = 2n + BigInt((nonce * NW + w) % 5)
      const msg = transferMessage(NET, from.addr, SINK.addr, amount, nonce)
      acts.push({ from: from.addr, nonce, msg, sig: _signKrayWallet(msg, from.sk), pk: from.pk, amount: String(amount) })
    }
  }
  const signMs = ms(t0)
  console.log(`      signed ${acts.length.toLocaleString()} acts in ${signMs.toFixed(0)} ms (client-side cost, paid by the senders, not the writer)`)
  ok(acts.length === RATE_PER_SEC, `one second of Visa-scale load exists: ${acts.length.toLocaleString()} signed acts`)

  const rules = {
    nonceOf: (_a: string) => 0,
    keyOf: (a: BenchAct) => keyFromSignedMessage(a.msg),
    isValid: (_a: BenchAct) => true, // admission verification is benched separately in S-6
  }
  // the live gate reads each account's expected nonce from LEDGER STATE — a value no arrival
  // permutation can move. The bench mirrors that: the account's smallest nonce in the batch.
  const rulesForSlice = (slice: BenchAct[]) => {
    const minNonce = new Map<string, number>()
    for (const a of slice) {
      const cur = minNonce.get(a.from as string)
      if (cur === undefined || a.nonce! < cur) minNonce.set(a.from as string, a.nonce!)
    }
    return { ...rules, nonceOf: (addr: string) => minNonce.get(addr) ?? 0 }
  }

  // ── S-2 · order one second as the live gate does: 250 windows of ~67 ──
  console.log(`\nS-2 — ${WINDOWS_PER_SEC} windows of ~${PER_WINDOW} acts (one real second at the gate)`)
  t0 = performance.now()
  let orderedTotal = 0
  for (let i = 0; i < acts.length; i += PER_WINDOW) {
    const slice = acts.slice(i, i + PER_WINDOW)
    const w = orderWindow(slice, rulesForSlice(slice))
    orderedTotal += w.ordered.length
  }
  const secMs = ms(t0)
  ok(orderedTotal === acts.length, `all ${orderedTotal.toLocaleString()} acts scheduled, none lost`)
  ok(secMs < 1000, `ordering one FULL second of Visa load took ${secMs.toFixed(1)} ms of the writer's second (${(secMs / 1000 * 100).toFixed(2)}% of budget)`)

  // ── S-3 · the storm: the whole second lands in ONE millisecond ──
  console.log(`\nS-3 — storm: all ${acts.length.toLocaleString()} acts in ONE instant (one giant window)`)
  t0 = performance.now()
  const storm = orderWindow(acts, rulesForSlice(acts))
  const stormMs = ms(t0)
  ok(storm.ordered.length === acts.length && storm.deferred.length === 0 && storm.rejected.length === 0,
    `one window of ${acts.length.toLocaleString()} acts fully scheduled in ${stormMs.toFixed(1)} ms — no loss, no deferral`)

  // ── S-4 · shuffle arrival at storm scale: order is a function of the acts, not the arrival ──
  console.log(`\nS-4 — permute arrival 3× at storm scale`)
  const seqHash = (o: BenchAct[]) => createHash('sha256').update(o.map((a) => a.msg).join('\n')).digest('hex')
  const want = seqHash(storm.ordered)
  let identical = true
  for (let s = 1; s <= 3; s++) {
    const shuffled = [...acts]
    let seed = 0xC0FFEE ^ s
    for (let i = shuffled.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) >>> 0
      const j = seed % (i + 1)
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    if (seqHash(orderWindow(shuffled, rulesForSlice(shuffled)).ordered) !== want) identical = false
  }
  ok(identical, 'three arrival permutations ⇒ byte-identical order — no robot gains a place by racing the socket')

  // ── S-5 · one MILLION acts in one window (a whole minute colliding at one instant) ──
  // Keys are sha256 of signed bytes; ordering never reads the signature, so synthetic signed
  // messages measure the LAW's own cost at 1M honestly (verification is S-6, a separate dial).
  console.log(`\nS-5 — 1,000,000 acts in ONE window (pure ordering law)`)
  const M = 1_000_000
  const macts: BenchAct[] = new Array(M)
  for (let i = 0; i < M; i++) {
    const from = 'bcrt1q' + (i % 100_000).toString(36).padStart(8, '0')
    macts[i] = { from, nonce: Math.floor(i / 100_000), msg: `m|${from}|${i}`, sig: '', pk: '', amount: '1' }
  }
  t0 = performance.now()
  const mw = orderWindow(macts, { nonceOf: () => 0, keyOf: (a) => keyFromSignedMessage(a.msg), isValid: () => true })
  const mMs = ms(t0)
  ok(mw.ordered.length === M, `1,000,000 acts scheduled in ${(mMs / 1000).toFixed(2)} s — heap holds, O(n log n), zero lost`)

  // ── S-6 · schnorr verification throughput (the physical bottleneck) ──
  console.log(`\nS-6 — schnorr verification (single Node thread)`)
  const NV = 2000
  t0 = performance.now()
  let good = 0
  for (let i = 0; i < NV; i++) if (verifyKrayWallet(acts[i].from as string, acts[i].msg, acts[i].sig, acts[i].pk, NET)) good++
  const vMs = ms(t0)
  const vPerSec = Math.round(NV / (vMs / 1000))
  ok(good === NV, `${NV} signatures verified, all valid`)
  console.log(`      throughput: ${vPerSec.toLocaleString()} verifies/s per thread → ${Math.ceil(RATE_PER_SEC / vPerSec)} threads cover Visa scale (verification is embarrassingly parallel; order is decided AFTER, by the law)`)

  // ── S-7 · the full live reducer path: requireSig + mirror referee + conservation, acts/sec ──
  console.log(`\nS-7 — full reducer apply (signature + referee + nonce + balance law)`)
  const L = new KrayLedger(undefined, NET, undefined, false)
  const J: Record<string, unknown>[] = []
  const ap = (e: Record<string, unknown>) => { const ev = { ...e, seq: J.length + 1 }; L.applyLive(ev as never); J.push(ev) }
  for (const w of wallets.slice(0, 200)) ap({ kind: 'donate', hash: 'fund-' + w.addr, to: w.addr, amount: '1000' })
  const T = 1_750_000_000_000
  const applyActs = acts.filter((a) => wallets.slice(0, 200).some((w) => w.addr === a.from)).slice(0, 2000)
  const addrSet = new Map(wallets.map((w) => [w.addr, w]))
  t0 = performance.now()
  let applied = 0
  for (const a of applyActs) {
    ap({ kind: 'transfer', hash: 'tx-' + applied, from: a.from, to: SINK.addr, amount: a.amount, fee: '1',
      nonce: a.nonce, publicKey: addrSet.get(a.from as string)!.pk, signature: a.sig, scheme: 'kraywallet', at: T + applied })
    applied++
  }
  const aMs = ms(t0)
  const aPerSec = Math.round(applied / (aMs / 1000))
  ok(applied === applyActs.length, `${applied.toLocaleString()} signed transfers applied through the FULL law`)
  ok(L.conserves(), 'conservation tripwire green after the storm — Σ balances == emitted − burned, exactly')
  console.log(`      full-law throughput: ${aPerSec.toLocaleString()} acts/s per thread → ${Math.ceil(RATE_PER_SEC / aPerSec)}× needed for Visa scale (same parallel dial as S-6)`)

  console.log(`\n═ bench-queue-scale: ${pass} passed, ${fail} failed ═\n`)
  if (fail > 0) process.exit(1)
}

main()
