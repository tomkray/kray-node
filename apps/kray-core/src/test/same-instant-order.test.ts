/**
 * THE SAME-INSTANT LAW (docs/SAME-INSTANT-ORDER-DECISION.md) — within one millisecond, not even the
 * writer chooses: the order is orderWindow over sha256(signed bytes), verified by every follower.
 * Prove by breaking:
 *   node src/test/same-instant-order.test.ts
 *
 *   SI-01  DORMANT by default — a stock ledger accepts any same-`at` order (A3: history byte-identical)
 *   SI-02  THE TIMESTAMP LAW — at/after activation a signed act without an integer `at` is refused
 *   SI-03  THE ORDER — two same-instant acts in wrong key order: the second is refused; the objective
 *          order is accepted; a third act that breaks the extended run is refused
 *   SI-04  NONCE OUTRANKS KEY — one account's chain may descend in keys inside one instant
 *   SI-05  THE INSERTION TRICK — hiding an inversion behind an own-account chain HALTs (greedy-equality,
 *          not pairwise); the objective order of the same three acts is accepted
 *   SI-06  AN UNSIGNED ACT BREAKS THE RUN — donate between two signed acts frees the order
 *   SI-07  DISTINCT INSTANTS ARE FREE — time orders across milliseconds (the NAMED residue)
 *   SI-08  THE BOUNDARY — a run cannot span the activation seq; below it nothing is checked
 *   SI-09  A FORGED JOURNAL HALTS — swap two same-instant events and every follower stops at the swap
 *   SI-10  REPLAY — a compliant journal replays on a fresh ledger to the same root (and the REFEREE
 *          re-proved mirror parity on every signed act this file ever applied)
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, inscribeMessageV2 } from '../protocol/scheme.ts'
import { keyFromSignedMessage } from '../protocol/window-order.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
const LAW = /THE SAME-INSTANT LAW/

function wallet(tag: string) {
  const sk = createHash('sha256').update('same-instant|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B'), C = wallet('C'), SINK = wallet('SINK')

/** a ledger with a chosen same-instant activation seq (MAX = dormant) + an auto-seq apply helper */
function ledger(siSeq?: number) {
  const L = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, siSeq)
  const J: KrayEvent[] = []
  const ap = (e: Record<string, unknown>) => { const ev = { ...e, seq: J.length + 1 } as unknown as KrayEvent; L.applyLive(ev); J.push(ev); return ev }
  return { L, J, ap }
}
const fund = (ap: (e: Record<string, unknown>) => KrayEvent, w: { addr: string }) =>
  ap({ kind: 'donate', hash: 'fund-' + w.addr.slice(-6) + '-' + Math.random().toString(36).slice(2), to: w.addr, amount: '1000' })

/** a signed transfer AT a chosen instant, with its ungrindable order key exposed */
function mkT(w: ReturnType<typeof wallet>, nonce: number, amount: bigint, at: number | undefined) {
  const msg = transferMessage(NET, w.addr, SINK.addr, amount, nonce)
  const ev = {
    kind: 'transfer', hash: 'tx-' + w.addr.slice(-6) + '-' + nonce + '-' + amount, from: w.addr, to: SINK.addr,
    amount: String(amount), fee: '1', nonce, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet',
    ...(at !== undefined ? { at } : {}),
  } as Record<string, unknown>
  return { ev, key: keyFromSignedMessage(msg) }
}
/** deterministic key-grinding: candidate transfers at amounts 2..40, sorted by key — the test PICKS
 *  relations (who is smaller) instead of hoping; the hash stays ungrindable, the test just measures it */
function candidates(w: ReturnType<typeof wallet>, nonce: number, at: number) {
  const all = [] as { ev: Record<string, unknown>; key: string }[]
  for (let amt = 2n; amt <= 40n; amt++) all.push(mkT(w, nonce, amt, at))
  return all.sort((x, y) => (x.key < y.key ? -1 : 1))   // ascending key
}

function main() {
  console.log('\n╔═ THE SAME-INSTANT LAW — order is arithmetic; not even the writer chooses ═╗\n')
  const T = 1_700_000_000_000

  console.log('SI-01 — dormant by default: a stock ledger accepts any same-instant order (A3)')
  {
    const S = ledger()   // regtest default MAX
    fund(S.ap, A); fund(S.ap, B)
    const ca = candidates(A, 0, T), cb = candidates(B, 0, T)
    const hi = ca[ca.length - 1], lo = cb[0]   // key(hi) > key(lo)
    S.ap(hi.ev); S.ap(lo.ev)                   // descending keys, same instant — no law below activation
    ok(true, 'wrong-key order at one instant applied clean while dormant')
    ok(S.L.balanceOf(SINK.addr) > 0n, 'value moved — the acts really applied')
  }

  console.log('\nSI-02 — the timestamp law: at/after activation a signed act must carry an integer `at`')
  {
    const S = ledger(1)
    fund(S.ap, A)
    rejects(() => S.ap(mkT(A, 0, 5n, undefined).ev), LAW, 'no `at` at all → refused')
    S.ap(mkT(A, 0, 5n, T).ev)
    ok(S.L.balanceOf(SINK.addr) === 5n, 'the same act WITH an instant applied clean')
  }

  console.log('\nSI-03 — the order: within one instant the smaller signed-bytes hash goes first')
  {
    const S = ledger(1)
    fund(S.ap, A); fund(S.ap, B); fund(S.ap, C)
    const a = candidates(A, 0, T), b = candidates(B, 0, T)
    const big = a[a.length - 1], small = b[0]
    S.ap(big.ev)
    rejects(() => S.ap(small.ev), LAW, 'smaller key AFTER a bigger one in the same instant → refused')
    const F = ledger(1)   // fresh book, objective order
    fund(F.ap, A); fund(F.ap, B); fund(F.ap, C)
    F.ap(small.ev); F.ap(big.ev)
    ok(true, 'the objective order (ascending keys) applied clean')
    const c = candidates(C, 0, T)
    const mid = c.find((x) => x.key > small.key && x.key < big.key)
    if (mid) rejects(() => F.ap(mid.ev), LAW, 'a third act whose key falls INSIDE the settled run → refused (greedy over the whole run)')
    else ok(true, '(no mid-key candidate ground — skip the third-act probe, covered by SI-05)')
  }

  console.log('\nSI-04 — nonce outranks key inside one account: a chain may descend in keys')
  {
    const S = ledger(1)
    fund(S.ap, A)
    // grind: nonce-0 act with a BIGGER key than some nonce-1 act — the chain must still stand
    const n0 = candidates(A, 0, T), n1 = candidates(A, 1, T)
    const first = n0[n0.length - 1], second = n1[0]
    ok(first.key > second.key, 'ground a descending-key chain (n0 key > n1 key)')
    S.ap(first.ev); S.ap(second.ev)
    ok(true, 'one account\'s nonce chain applied clean despite descending keys — nonce law outranks the tiebreak')
  }

  console.log('\nSI-05 — the insertion trick HALTs: greedy-equality over the run, never pairwise')
  {
    // x1(A n0, key HIGH) · x2(A n1, key LOW) · x3(B n0, key MID): journal [x1,x2,x3] passes every
    // ADJACENT pair (own-chain, then low<mid) but greedy demands x3 FIRST — the trick must die.
    const a0 = candidates(A, 0, T), a1 = candidates(A, 1, T), b0 = candidates(B, 0, T)
    const x1 = a0[a0.length - 1], x2 = a1[0]
    const x3 = b0.find((x) => x.key > x2.key && x.key < x1.key)
    if (!x3) { ok(true, '(grind found no mid key among 39 candidates — astronomically unlikely; rerun)') }
    else {
      const S = ledger(1)
      fund(S.ap, A); fund(S.ap, B)
      S.ap(x1.ev); S.ap(x2.ev)
      rejects(() => S.ap(x3.ev), LAW, 'journal [x1,x2,x3] refused — pairwise-clean but greedy-false')
      const F = ledger(1)
      fund(F.ap, A); fund(F.ap, B)
      F.ap(x3.ev); F.ap(x1.ev); F.ap(x2.ev)
      ok(true, 'the objective order [x3,x1,x2] of the SAME three acts applied clean')
    }
  }

  console.log('\nSI-06 — an unsigned act breaks the run: donate between two signed acts frees the order')
  {
    const S = ledger(1)
    fund(S.ap, A); fund(S.ap, B)
    const a = candidates(A, 0, T), b = candidates(B, 0, T)
    S.ap(a[a.length - 1].ev)                        // big key first
    S.ap({ kind: 'donate', hash: 'mid-run', to: C.addr, amount: '7' })   // unsigned — closes the run
    S.ap(b[0].ev)                                   // small key after — legal: a NEW run opened
    ok(true, 'small key after big key across an unsigned act — the run was honestly broken')
  }

  console.log('\nSI-07 — distinct instants are free: time orders across milliseconds (named residue)')
  {
    const S = ledger(1)
    fund(S.ap, A); fund(S.ap, B)
    const a = candidates(A, 0, T), b = candidates(B, 0, T + 1)
    S.ap(a[a.length - 1].ev)   // instant T, big key
    S.ap(b[0].ev)              // instant T+1, small key — different instant, no constraint
    ok(true, 'descending keys across two instants applied clean')
  }

  console.log('\nSI-08 — the boundary: a run cannot span the activation seq')
  {
    const S = ledger(4)   // funds are seqs 1-2; the pair lands at seqs 3 (below) and 4 (at)
    fund(S.ap, A); fund(S.ap, B)
    const a = candidates(A, 0, T), b = candidates(B, 0, T)
    S.ap(a[a.length - 1].ev)   // seq 3 — below the law: tracked by nothing
    S.ap(b[0].ev)              // seq 4 — at the law: opens a FRESH run; the pre-law act casts no shadow
    ok(true, 'wrong-key pair straddling the boundary applied clean — the law does not reach back (A3)')
  }

  console.log('\nSI-09 — a forged journal HALTs every follower at the swap')
  {
    const S = ledger(1)
    fund(S.ap, A); fund(S.ap, B)
    const a = candidates(A, 0, T), b = candidates(B, 0, T)
    S.ap(b[0].ev); S.ap(a[a.length - 1].ev)   // the honest, objective order
    const honest = S.J
    const F = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, 1)
    for (const [i, ev] of honest.entries()) F.applyLive({ ...ev, seq: i + 1 } as KrayEvent)
    ok(F.cascadeRoot() === S.L.cascadeRoot(), 'the honest journal replays byte-identical on a follower')
    const forged = [...honest]
    ;[forged[2], forged[3]] = [forged[3], forged[2]]   // the writer lies about the same-instant order
    const F2 = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, 1)
    rejects(() => { for (const [i, ev] of forged.entries()) F2.applyLive({ ...ev, seq: i + 1 } as KrayEvent) },
      LAW, 'the swapped journal HALTs the follower at the forged position')
  }

  console.log('\nSI-10 — replay + the referee: a compliant mixed journal replays to the same root')
  {
    const S = ledger(1)
    fund(S.ap, A)
    S.ap(mkT(A, 0, 3n, T).ev)
    // an inscribe rides the same book — the REFEREE (mirror parity) ran inside every signed act above too
    const chash = sha256hex('si-10-star'), n = S.L.nonceOf(A.addr)
    S.ap({
      kind: 'inscribe', hash: 'si-10', from: A.addr, contentHash: chash, contentType: 'text/plain', size: 9,
      nonce: n, publicKey: A.pk, signature: _signKrayWallet(inscribeMessageV2(NET, A.addr, chash, 'text/plain', 9, undefined, n), A.sk),
      scheme: 'kraywallet', at: T + 5,
    })
    const F = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, 1)
    for (const [i, ev] of S.J.entries()) F.applyLive({ ...ev, seq: i + 1 } as KrayEvent)
    ok(F.cascadeRoot() === S.L.cascadeRoot(), 'same journal, same root — the law is pure journal arithmetic')
  }

  console.log(`\n═ same-instant-order: ${pass} passed, ${fail} failed ═\n`)
  if (fail) process.exit(1)
}
main()
