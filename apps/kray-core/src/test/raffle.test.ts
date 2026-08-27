/**
 * THE VALIDATOR RAFFLE — the Creator's novel idea, verified: the donation surplus can reward one guardian, chosen
 * by Bitcoin's hash, WITHOUT a key and WITHOUT letting Sybils tilt the odds.
 *
 * Proves: (1) the winner is a deterministic, re-derivable function of (beacon, set) — every node agrees; (2) it is
 * work-weighted — 4× the work wins ≈ 4× as often; (3) it is SYBIL-NEUTRAL — a whale of work W and that same whale
 * split into many identities of W/N each win with the SAME total frequency, so registering fake validators buys
 * nothing; (4) an empty/zero-work set names no winner (the surplus then falls back to a burn).
 *
 *   node src/test/raffle.test.ts
 */
import { createHash } from 'node:crypto'
import { raffleWinner, raffleDraw, winProbability, type RaffleEntry } from '../economics/raffle.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const beaconOf = (i: number): string => createHash('sha256').update('beacon|' + i).digest('hex')

function rates(entries: RaffleEntry[], rounds: number): Map<string, number> {
  const wins = new Map<string, number>()
  for (let i = 0; i < rounds; i++) { const w = raffleWinner(beaconOf(i), entries)!; wins.set(w, (wins.get(w) || 0) + 1) }
  const out = new Map<string, number>()
  for (const [a, n] of wins) out.set(a, n / rounds)
  return out
}

function main() {
  console.log('\n╔═ THE VALIDATOR RAFFLE — real sats to one guardian, by Bitcoin’s hash, no key, no sybil edge ═╗\n')
  const ROUNDS = 6000, TOL = 0.03

  // ── 1 · deterministic: the same (beacon, set) always names the same winner ──
  const set: RaffleEntry[] = [
    { address: 'addr-alpha', work: 10n }, { address: 'addr-bravo', work: 10n },
    { address: 'addr-charlie', work: 10n }, { address: 'addr-delta', work: 10n },
    { address: 'addr-echo', work: 10n }, { address: 'addr-foxtrot', work: 10n },
    { address: 'addr-whale', work: 40n },
  ] // total = 100, whale = 0.40
  const b = beaconOf(123)
  ok(raffleWinner(b, set) === raffleWinner(b, [...set].reverse()), 'the winner is deterministic and order-independent — every node re-derives the SAME guardian')
  ok(raffleDraw(b, 100n) < 100n, 'the draw is a uniform value inside [0, totalWork) fixed by the Bitcoin beacon')

  // ── 2 · work-weighted: the whale (40/100) wins ≈ 0.40 of the time ──
  const r1 = rates(set, ROUNDS)
  const whaleRate = r1.get('addr-whale') || 0
  ok(Math.abs(whaleRate - 0.40) < TOL, `weighted by work: the 40%-work whale wins ${(whaleRate * 100).toFixed(1)}% of draws (≈ 40%)`)
  ok(Math.abs((r1.get('addr-alpha') || 0) - 0.10) < TOL, `a 10%-work guardian wins ${(((r1.get('addr-alpha') || 0)) * 100).toFixed(1)}% (≈ 10%) — probability IS work/total`)

  // ── 3 · SYBIL-NEUTRAL: split the whale into 4 clones of 10 each — combined odds unchanged ──
  const split: RaffleEntry[] = [
    { address: 'addr-alpha', work: 10n }, { address: 'addr-bravo', work: 10n },
    { address: 'addr-charlie', work: 10n }, { address: 'addr-delta', work: 10n },
    { address: 'addr-echo', work: 10n }, { address: 'addr-foxtrot', work: 10n },
    { address: 'whale-clone-1', work: 10n }, { address: 'whale-clone-2', work: 10n },
    { address: 'whale-clone-3', work: 10n }, { address: 'whale-clone-4', work: 10n },
  ] // total still 100; the ex-whale is now 4 identities of 10 each
  const r2 = rates(split, ROUNDS)
  const cloneSum = ['whale-clone-1', 'whale-clone-2', 'whale-clone-3', 'whale-clone-4'].reduce((s, a) => s + (r2.get(a) || 0), 0)
  ok(Math.abs(cloneSum - 0.40) < TOL, `the whale SPLIT into 4 identities still wins ${(cloneSum * 100).toFixed(1)}% combined (≈ 40%) — sybils gain NOTHING`)
  ok(Math.abs(cloneSum - whaleRate) < TOL, 'one whale and four clones of it win at the same total rate — the raffle is sybil-neutral, exactly like the linear fee split')

  // ── 4 · the math is exact, not just empirical ──
  ok(winProbability(40n, 100n) === 0.40 && winProbability(10n, 100n) + winProbability(10n, 100n) + winProbability(10n, 100n) + winProbability(10n, 100n) === winProbability(40n, 100n), 'analytically: four 10-work clones sum to exactly the one 40-work whale — splitting is provably neutral')

  // ── 5 · nobody did work → nobody wins (the surplus falls back to a burn) ──
  ok(raffleWinner(beaconOf(9), [{ address: 'idle', work: 0n }]) === null, 'a set with no proven work names no winner — the raffle never invents one, the surplus simply burns')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — real Bitcoin to one guardian, chosen by Bitcoin, ownable by no one, un-gameable by sybils. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
