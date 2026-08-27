/**
 * THE RUNE BOOK — solvency as a tripwire, and the double-claim closed by arithmetic.
 *   node src/test/rune-book.test.ts
 *
 * A bridge is solvent or it is a story. This proves the book cannot drift: every
 * move re-checks that credits plus locks equal the reserve, the classic
 * spend-on-L2-and-claim-on-L1 attack is impossible by construction rather than
 * by promise, and every replayed proof — a deposit presented twice, a payout
 * burning two locks — is refused and named.
 */
import { RuneBook, runeKey } from '../economics/rune-book.ts'
import type { RuneId } from '../protocol/runestone.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
function rejects(fn: () => void, why: RegExp, label: string): void {
  try { fn() } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (why.test(msg)) { pass++; return }
    console.error(`  ✗ FAILED (wrong refusal) — ${label}\n      got: ${msg}`); process.exit(1)
  }
  console.error(`  ✗ FAILED (expected refusal) — ${label}`); process.exit(1)
}
const R: RuneId = { block: 900_000n, tx: 7n }
const R2: RuneId = { block: 900_001n, tx: 3n }
const A = 'bcrt1p' + 'a'.repeat(58), B = 'bcrt1p' + 'b'.repeat(58), C = 'bcrt1p' + 'c'.repeat(58)
const T = 1_700_000_000_000

function main() {
  const book = new RuneBook()

  // ── 1 · A PROVEN DEPOSIT BACKS ITS CREDITS, EXACTLY ──────────────────────
  book.deposit(R, 'aa'.repeat(32) + ':0', 1000n, A)
  ok(book.balanceOf(R, A) === 1000n && book.reserveOf(R) === 1000n, 'a deposit credits 1,000 and raises the reserve by 1,000 — never by a different number')
  ok(book.solvent(), 'SOLVENT: credits + locks == reserve')
  rejects(() => book.deposit(R, 'aa'.repeat(32) + ':0', 1000n, A), /already credited/, 'ATTACK: presenting the SAME deposit proof twice → REFUSED (minted once, ever)')
  rejects(() => book.deposit(R, 'bb'.repeat(32) + ':0', 0n, A), /must be positive/, 'a zero deposit is refused rather than recorded as nothing')

  // ── 2 · L2 TRANSFERS MOVE CREDITS, NEVER THE RESERVE ─────────────────────
  book.send(R, A, B, 400n)
  ok(book.balanceOf(R, A) === 600n && book.balanceOf(R, B) === 400n, 'an L2 transfer moves exactly what it says')
  ok(book.reserveOf(R) === 1000n && book.solvent(), '…and the reserve is untouched — the vault did not move, so neither did the backing')
  rejects(() => book.send(R, B, C, 401n), /insufficient/, 'spending more than you hold → REFUSED')
  rejects(() => book.send(R, C, A, 1n), /insufficient/, 'spending from an empty address → REFUSED (a balance is never negative)')

  // ── 3 · THE DOUBLE-CLAIM, CLOSED BY ARITHMETIC ───────────────────────────
  book.requestExit(R, B, 400n, 'bc1qexit', T)
  ok(book.balanceOf(R, B) === 0n, 'the exit request takes the credits OUT of the spendable book immediately')
  ok(book.lockedOf(R, B)?.amount === 400n && book.solvent(), '…into a lock — still backed, still counted, no longer spendable')
  rejects(() => book.send(R, B, C, 1n), /insufficient/, 'ATTACK: spend on L2 while an exit is pending → IMPOSSIBLE, because the credits are already gone from the book')
  rejects(() => book.requestExit(R, B, 1n, 'bc1qexit', T), /already has an open exit/, 'a second overlapping exit → REFUSED (an ambiguous burn is a hole)')
  rejects(() => book.requestExit(R, A, 99_999n, 'bc1qexit', T), /insufficient/, 'exiting more than you hold → REFUSED')

  // ── 4 · SETTLE: THE L1 PAYOUT BURNS EXACTLY ITS LOCK ─────────────────────
  rejects(() => book.settleExit(R, B, 399n, 'cc'.repeat(32)), /matches its lock exactly/, 'ATTACK: a payout for a DIFFERENT amount than the lock → REFUSED')
  book.settleExit(R, B, 400n, 'cc'.repeat(32))
  ok(book.lockedOf(R, B) === null && book.balanceOf(R, B) === 0n, 'the lock is gone and the credits are burned')
  ok(book.reserveOf(R) === 600n && book.solvent(), 'the reserve fell by exactly the payout — 1,000 in, 400 out, 600 backed')
  rejects(() => book.settleExit(R, A, 100n, 'cc'.repeat(32)), /no open exit/, 'settling without an open exit → REFUSED')
  book.requestExit(R, A, 100n, 'bc1qexit2', T)
  rejects(() => book.settleExit(R, A, 100n, 'cc'.repeat(32)), /already settled/, 'ATTACK: reusing ONE L1 payout to burn a SECOND lock → REFUSED (one payout, one burn)')

  // ── 5 · CANCELLING RETURNS EVERYTHING, EXACTLY ───────────────────────────
  book.cancelExit(R, A)
  ok(book.balanceOf(R, A) === 600n && book.lockedOf(R, A) === null && book.solvent(), 'a cancelled exit returns the credits untouched — nothing created, nothing stranded')
  rejects(() => book.cancelExit(R, A), /no open exit/, 'cancelling nothing → REFUSED')

  // ── 6 · RUNES DO NOT MIX ─────────────────────────────────────────────────
  book.deposit(R2, 'dd'.repeat(32) + ':1', 50n, A)
  ok(book.balanceOf(R2, A) === 50n && book.balanceOf(R, A) === 600n, 'two runes, two books — a deposit of one never moves the other')
  ok(book.reserveOf(R2) === 50n && book.solvent(), 'each rune is solvent on its own terms')
  rejects(() => book.send(R2, A, B, 51n), /insufficient/, 'you cannot spend rune A\'s balance as rune B')

  // ── 7 · THE AUDIT ANYONE CAN RUN ─────────────────────────────────────────
  const holders = book.holders(R)
  const total = holders.reduce((t, h) => t + h.amount, 0n) + (book.lockedOf(R, A)?.amount ?? 0n)
  ok(total === book.reserveOf(R), `Σ over every holder equals the reserve — ${total} == ${book.reserveOf(R)}, checkable by a stranger`)
  ok(book.runes().length === 2, 'the rune list is DERIVED from the book — never a curated array')
  ok(book.wasCredited('aa'.repeat(32) + ':0') && book.wasSettled('cc'.repeat(32)), 'the spent proofs are remembered forever, so no proof works twice')

  // ── 7b · THE BACKING LAW — no recipient is ever born a hostage ───────────
  // Bakery example, locked by the Creator: A deposits 1000 into a PERSONAL vault,
  // wants to pay B 150 and C 150. Until A rehomes the coins to the shared pot,
  // everything A holds is backed by a box only A's key opens — so the gate says
  // A may hand out NOTHING. One rehome later, everything is pot-backed and free.
  const bk = new RuneBook()
  bk.deposit(R, 'ee'.repeat(32) + ':0', 1000n, A)
  ok(bk.personalOf(R, A) === 1000n, 'a personal-vault deposit is PERSONAL backing — only the depositor\'s key opens that box')
  ok(bk.transferableOf(R, A) === 0n, 'before the rehome, A may hand out NOTHING — a recipient would be a hostage of A\'s key')
  const preCommit = bk.commitment()
  ok(!preCommit.includes('p|'), 'APPEND-ONLY: a book never pot-touched folds NO backing lines — every pre-rehome history hashes byte-identically')
  rejects(() => bk.rehome(R, B), /nothing to rehome/, 'rehoming with no personal backing → REFUSED (B never deposited)')
  const moved = bk.rehome(R, A)
  ok(moved === 1000n && bk.personalOf(R, A) === 0n, 'the rehome moves ALL of A\'s backing to the pot — the book records the box change, not a balance change')
  ok(bk.balanceOf(R, A) === 1000n && bk.reserveOf(R) === 1000n && bk.solvent(), 'credits and reserve are UNTOUCHED — same coins, different box, still solvent')
  ok(bk.transferableOf(R, A) === 1000n, 'after the rehome, everything A holds is pot-backed — A may pay anyone')
  ok(bk.commitment().includes(`p|${runeKey(R)}`) === false, 'A\'s zeroed backing folds no line — only NONZERO personal backing is committed')
  bk.send(R, A, B, 150n); bk.send(R, A, C, 150n)
  ok(bk.transferableOf(R, B) === 150n && bk.transferableOf(R, C) === 150n, 'B and C hold pot-backed credits — they can send onward or exit WITHOUT A, forever')
  rejects(() => bk.rehome(R, A), /nothing to rehome/, 'a second rehome with nothing personal left → REFUSED (one box move, one event)')
  // a later personal deposit re-raises A's personal backing — and the commitment now folds it
  bk.deposit(R, 'ee'.repeat(32) + ':1', 300n, A)
  ok(bk.personalOf(R, A) === 300n && bk.transferableOf(R, A) === 700n, 'a NEW personal deposit is gated again — only the pot-backed 700 may be handed out')
  // THE CREATOR'S RACE: bakery of 1000 lands, a later (or in-flight) deposit of 400
  // must stay PERSONAL so Open bakery lights up again — never wipe metal that did not move.
  const race = new RuneBook()
  race.deposit(R, '11'.repeat(32) + ':0', 1000n, A)
  race.deposit(R, '22'.repeat(32) + ':0', 400n, A)
  ok(race.rehome(R, A, 1000n) === 1000n && race.personalOf(R, A) === 400n && race.transferableOf(R, A) === 1000n,
    'partial rehome: 1000 went to the pot, the 400 that was not in that tx stay personal — bakery button re-arms')
  ok(race.solvent() && race.reserveOf(R) === 1400n, 'partial rehome does not touch reserve or credits')
  ok(race.rehome(R, A, 400n) === 400n && race.personalOf(R, A) === 0n && race.transferableOf(R, A) === 1400n,
    'the second Open bakery moves the leftover 400 — then everything is pot-backed')
  ok(bk.commitment().includes(`p|${runeKey(R)}|${A}:300`), 'a pot-touched rune COMMITS its backing map — two histories with different backing can never share a root')
  // settle follows the metal: a personal-path payout drains personal backing first
  bk.requestExit(R, A, 1000n, 'bc1qbakery', T)
  bk.settleExit(R, A, 1000n, 'ab'.repeat(32))
  ok(bk.personalOf(R, A) === 0n && bk.solvent(), 'a settle floors personal backing at zero — the payout spent the personal box first, the remainder parks in the pot')
  // a POOL deposit is pot-backed from birth — no rehome ever needed
  const bp = new RuneBook()
  bp.deposit(R2, 'ff'.repeat(32) + ':0', 600n, B, { pool: true })
  ok(bp.personalOf(R2, B) === 0n && bp.transferableOf(R2, B) === 600n, 'a deposit straight into the pot is pot-backed from birth — transferable immediately')
  ok(bp.commitment() !== '' && !bp.commitment().includes('p|'), 'pool-touched with zero personal folds no backing lines — nothing to commit that is not there')

  // ── 8 · A LONG RANDOM LIFE NEVER DRIFTS ──────────────────────────────────
  const b2 = new RuneBook()
  let seed = 12345
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  const people = [A, B, C]
  let deposits = 0n, burns = 0n
  for (let i = 0; i < 2000; i++) {
    const who = people[rnd(3)]
    const act = rnd(4)
    try {
      if (act === 0) { const amt = BigInt(1 + rnd(500)); b2.deposit(R, `${i}`.padStart(64, '0') + ':0', amt, who); deposits += amt }
      else if (act === 1) b2.send(R, who, people[rnd(3)], BigInt(1 + rnd(200)))
      else if (act === 2) b2.requestExit(R, who, BigInt(1 + rnd(100)), 'bc1qx', T + i)
      else { const p = b2.lockedOf(R, who); if (p) { b2.settleExit(R, who, p.amount, `${i}`.padStart(64, 'f')); burns += p.amount } }
    } catch (_) { /* refusals are the point — the book must survive being pushed */ }
    if (!b2.solvent()) { console.error(`  ✗ FAILED — solvency drifted at step ${i}`); process.exit(1) }
  }
  ok(b2.solvent() && b2.reserveOf(R) === deposits - burns, `2,000 random moves — always solvent, and the reserve is exactly deposits (${deposits}) minus burns (${burns})`)

  // ── 8 · THE POT-BACKED BOOK — who the shared pot must pay, each to their own address ──────────
  const pb = new RuneBook()
  const P: RuneId = { block: 900_009n, tx: 1n }
  pb.deposit(P, 'a1'.repeat(32) + ':0', 1000n, A)                 // A's own deposit — personal, self-custody
  ok(pb.potBackedHolders(P).length === 0, 'a holder\'s own personal-vault deposit is NOT pot-backed — the pot owes them nothing')
  pb.rehome(P, A, 400n)                                           // A rehomes 400 into the pot so they can send it
  pb.send(P, A, B, 400n)                                          // A sends 400 to B — now B is pot-backed
  const pbh1 = pb.potBackedHolders(P)
  ok(pbh1.length === 1 && pbh1[0].address === B && pbh1[0].amount === 400n, 'a RECEIVED credit is pot-backed by exactly its amount (B holds 400 the pot must pay); the sender A stays personal (pot owes 0)')
  pb.deposit(P, 'a2'.repeat(32) + ':0', 500n, C, { pool: true })  // C's pot deposit — pot-backed from day one
  const pbh2 = pb.potBackedHolders(P)
  ok(pbh2.length === 2 && pbh2[0].address === C && pbh2[0].amount === 500n && pbh2[1].address === B, 'a pool deposit is pot-backed from day one; the pot book lists C(500) then B(400), largest first')
  ok(pbh2.reduce((t, h) => t + h.amount, 0n) === 900n, 'Σ pot-backed (900) is the pooled backing the pot\'s outpoints hold — the exact total the pre-signed split pays')

  console.log(`\n✓ ${pass} checks passed — THE RUNE BOOK CANNOT DRIFT: credits plus locks equal the reserve after every single move, so every L2 credit is backed by runes in the vault at all times. The spend-on-L2-and-claim-on-L1 attack is closed by ARITHMETIC — the exit request removes the credits before any payout exists — and every replayed proof is refused: a deposit minted twice, a payout burning two locks, a settlement that does not match its lock. Two thousand random moves later, not one unit had drifted. ₿₭`)
}
main()
