/**
 * THE UNGRINDABLE TIEBREAK — item 0 of the market deploy checklist, proven by breaking.
 *   node src/test/deadline-grind.test.ts
 *
 * The same-instant law says order is arithmetic: within one millisecond the smaller sha256 of the signed
 * bytes goes first, and not even the writer chooses. That is only true if a racer cannot move their own
 * hash cheaply — and until this pin, they could. `requireSig` lets an author append `|deadline=D` to the
 * bytes they sign. D is a Bitcoin height that bounds when the act may still apply; it MOVES NO VALUE, and
 * it is the one byte an author may vary freely while the act stays the same act. Vary it, rehash, repeat.
 *
 * That matters most exactly where it is worst: a drop listed at price 0, where the tiebreak IS the
 * allocation, and the honest first-comer loses to whoever ground the longest.
 *
 *   DG-01  THE GRINDER, MEASURED — below the pin, a handful of deadlines drags a rival's key under an
 *          honest act's, and the rival jumps the queue at the same instant. The law accepts the theft.
 *   DG-02  THE PIN CLOSES IT — the identical acts, the identical ground deadline, at/after the pin: the
 *          order key no longer moves with D, so the queue-jump is refused by THE SAME-INSTANT LAW.
 *   DG-03  THE DEADLINE STILL BINDS — the pin touches the ORDER only. A deadline-bearing act still signs,
 *          still verifies, still applies, and still means what it said.
 *   DG-04  NO ANCHORED ROOT MOVES (A3) — the same journal, carrying a deadline, produces the identical
 *          cascade root with the pin on and off. The inclusion leaf is still the signed bytes.
 *   DG-05  A RUN CANNOT SPAN THE PIN — keys from the two eras are not comparable, so the boundary closes
 *          the run exactly as a new millisecond does.
 *   DG-06  REPLAY — a compliant journal replays on a fresh ledger to the same root.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage } from '../protocol/scheme.ts'
import { keyFromSignedMessage } from '../protocol/window-order.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
const MAX = Number.MAX_SAFE_INTEGER
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
const LAW = /THE SAME-INSTANT LAW/

function wallet(tag: string) {
  const sk = createHash('sha256').update('deadline-grind|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const HONEST = wallet('honest'), RACER = wallet('racer'), SINK = wallet('sink')

/** A ledger with both pins chosen: the same-instant law, and the era of its order key. */
function ledger(siSeq: number, freeSeq: number) {
  const L = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, siSeq, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, freeSeq)
  const J: KrayEvent[] = []
  const ap = (e: Record<string, unknown>) => { const ev = { ...e, seq: J.length + 1 } as unknown as KrayEvent; L.applyLive(ev); J.push(ev); return ev }
  return { L, J, ap }
}
const fund = (ap: (e: Record<string, unknown>) => KrayEvent, w: { addr: string }, tag: string) =>
  ap({ kind: 'donate', hash: 'fund-' + tag, to: w.addr, amount: '1000' })

/** A signed transfer at one instant, optionally carrying a deadline — with BOTH keys exposed: the bytes
 *  the author signed (the old order key, and still the inclusion leaf) and the message alone (the new one). */
function transfer(w: ReturnType<typeof wallet>, nonce: number, amount: bigint, at: number, deadline?: number) {
  const message = transferMessage(NET, w.addr, SINK.addr, amount, nonce)
  const signed = deadline !== undefined ? `${message}|deadline=${deadline}` : message
  const ev = {
    kind: 'transfer', hash: `tx-${w.addr.slice(-6)}-${nonce}-${amount}-${deadline ?? 'none'}`, from: w.addr, to: SINK.addr,
    amount: String(amount), fee: '1', nonce, publicKey: w.pk, signature: _signKrayWallet(signed, w.sk), scheme: 'kraywallet',
    at, ...(deadline !== undefined ? { deadline } : {}),
  } as Record<string, unknown>
  return { ev, signedKey: keyFromSignedMessage(signed), messageKey: keyFromSignedMessage(message) }
}

function main() {
  console.log('\n╔═ THE UNGRINDABLE TIEBREAK — a byte that moves no value must not move the queue ═╗\n')
  const T = 1_700_000_000_000

  // The honest act and the rival, fixed. The rival's key is the LARGER one, so arithmetic puts it second.
  const honest = transfer(HONEST, 0, 7n, T)
  let rivalAmount = 2n
  while (transfer(RACER, 0, rivalAmount, T).signedKey < honest.signedKey) rivalAmount++
  const rival = transfer(RACER, 0, rivalAmount, T)
  ok(rival.signedKey > honest.signedKey, `arithmetic puts the rival second (${rival.signedKey.slice(0, 8)}… > ${honest.signedKey.slice(0, 8)}…)`)

  console.log('\nDG-01 — the grinder, measured: a free byte drags the rival under the honest act')
  let tries = 0, ground: number | undefined
  for (let d = 1; d <= 100_000; d++) {
    tries = d
    if (transfer(RACER, 0, rivalAmount, T, d).signedKey < honest.signedKey) { ground = d; break }
  }
  ok(ground !== undefined, `a deadline that wins the race exists, found in ${tries} tries — no proof of work, no value moved`)
  if (ground === undefined) { console.log(`\n═ deadline-grind: ${pass} passed, ${++fail} failed ═\n`); process.exit(1) }
  const jumped = transfer(RACER, 0, rivalAmount, T, ground)
  ok(jumped.signedKey < honest.signedKey, 'with the deadline, the rival hashes FIRST under the old key')
  ok(jumped.messageKey === rival.messageKey, 'and its message key never moved — the act means exactly what it meant')
  {
    // Below the pin the old key is the law, so the ground order is "objective" and the honest act loses.
    const S = ledger(1, MAX)
    fund(S.ap, HONEST, 'h1'); fund(S.ap, RACER, 'r1')
    S.ap(jumped.ev)
    S.ap(honest.ev)
    ok(S.L.balanceOf(SINK.addr) === rivalAmount + 7n, 'BELOW THE PIN the queue-jump applies clean — the theft is lawful')
  }
  {
    const S = ledger(1, MAX)
    fund(S.ap, HONEST, 'h2'); fund(S.ap, RACER, 'r2')
    S.ap(honest.ev)
    rejects(() => S.ap(jumped.ev), LAW, 'and the HONEST order is the one refused — the law itself is inverted')
  }

  console.log('\nDG-02 — the pin closes it: the same acts, the same ground deadline, one law later')
  {
    const S = ledger(1, 1)
    fund(S.ap, HONEST, 'h3'); fund(S.ap, RACER, 'r3')
    rejects(() => { S.ap(jumped.ev); S.ap(honest.ev) }, LAW, 'the queue-jump is refused — a deadline no longer moves the key')
  }
  {
    const S = ledger(1, 1)
    fund(S.ap, HONEST, 'h4'); fund(S.ap, RACER, 'r4')
    S.ap(honest.ev)
    S.ap(jumped.ev)
    ok(S.L.balanceOf(SINK.addr) === rivalAmount + 7n, 'and the honest-first order — the one the rival tried to buy out of — applies clean')
  }

  console.log('\nDG-03 — the deadline still binds: the pin touches the order, nothing else')
  {
    const S = ledger(MAX, 1)
    fund(S.ap, HONEST, 'h5')
    S.ap(transfer(HONEST, 0, 5n, T, 900_000).ev)
    ok(S.L.balanceOf(SINK.addr) === 5n, 'a deadline-bearing act signs, verifies and applies exactly as before')
    rejects(() => S.ap({ ...transfer(HONEST, 1, 5n, T, 900_000).ev, deadline: 900_001 }),
      /signature does not verify/, 'and the deadline is still SIGNED — changing it under the signature is refused')
  }

  console.log('\nDG-04 — no anchored root moves (A3): the inclusion leaf is still the signed bytes')
  {
    const journal = (freeSeq: number) => {
      const S = ledger(MAX, freeSeq)   // same-instant law dormant, so ordering refuses nothing on either side
      fund(S.ap, HONEST, 'h6'); fund(S.ap, RACER, 'r6')
      S.ap(transfer(HONEST, 0, 3n, T, 800_000).ev)
      S.ap(transfer(RACER, 0, 4n, T + 1).ev)
      S.ap(transfer(HONEST, 1, 5n, T + 2, 800_001).ev)
      return S.L.cascadeRoot()
    }
    ok(journal(0) === journal(MAX), 'the same journal, carrying deadlines, produces the IDENTICAL cascade root on both sides of the pin')
  }

  console.log('\nDG-05 — a run cannot span the pin: keys from two eras are not comparable')
  {
    // Four acts at one instant. The pin lands in the middle, so the boundary closes the run — exactly as a
    // new millisecond would. Below it the old key ordered; above it the new one does; neither is compared
    // against the other, and the outcome is the same on every replay.
    const S = ledger(1, 5)
    fund(S.ap, HONEST, 'h7'); fund(S.ap, RACER, 'r7')     // seq 1, 2 — unsigned, they close no run of their own
    S.ap(jumped.ev)                                        // seq 3 — old era: the ground key is smaller, so it leads
    S.ap(honest.ev)                                        // seq 4 — old era, lawful under the key that was the law then
    const before = S.L.cascadeRoot()
    // Seq 5 is the first act of the NEW era. Its own key is smaller than the act before it, so if the run
    // had been allowed to span the pin this would be refused as out of order. The boundary closes instead.
    // Pick the amount whose key sits below the previous act's, instead of hoping one does — the hash stays
    // ungrindable, the test only measures which way it fell.
    let nextAmount = 2n
    while (transfer(HONEST, 1, nextAmount, T).messageKey > honest.signedKey) nextAmount++
    const next = transfer(HONEST, 1, nextAmount, T)
    ok(next.messageKey < honest.signedKey, 'the next act hashes BELOW the one before it — a spanning run would refuse it')
    S.ap(next.ev)                                          // seq 5
    ok(S.L.cascadeRoot() !== before, 'the first act past the pin opens a fresh run and applies — the boundary is not a wall')
    const F = ledger(1, 5)
    for (const [i, ev] of S.J.entries()) F.L.applyLive({ ...ev, seq: i + 1 } as KrayEvent)
    ok(F.L.cascadeRoot() === S.L.cascadeRoot(), 'and a follower replaying the same journal lands on the same root')
  }

  console.log('\nDG-06 — replay: a compliant journal replays on a fresh ledger to the same root')
  {
    const S = ledger(1, 1)
    fund(S.ap, HONEST, 'h8'); fund(S.ap, RACER, 'r8')
    S.ap(honest.ev)
    S.ap(jumped.ev)
    S.ap(transfer(HONEST, 1, 2n, T + 10, 700_000).ev)
    const F = ledger(1, 1)
    for (const [i, ev] of S.J.entries()) F.L.applyLive({ ...ev, seq: i + 1 } as KrayEvent)
    ok(F.L.cascadeRoot() === S.L.cascadeRoot(), 'same journal, same root — the pin is pure journal arithmetic')
  }

  console.log(`\n═ deadline-grind: ${pass} passed, ${fail} failed ═\n`)
  if (fail) process.exit(1)
}
main()
