/**
 * THE VOLUNTARY ANCHOR POOL — proven. Blocks run free; the Bitcoin anchor is paid
 * by a fairly-drawn volunteer; it never gets stuck; only a real payment is rewarded.
 */
import { AnchorPool, rewardFor, DEFAULT_REWARD } from '../economics/anchor-pool.ts'
import { createHash } from 'node:crypto'

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const root = (n: number) => sha(`cascade-root-${n}`)
let pass = 0
function ok(cond: boolean, label: string): void { if (!cond) { console.error(`\n✗ FAILED: ${label}`); process.exit(1) }; pass++ }
function rejects(fn: () => unknown, label: string): void { try { fn(); ok(false, label) } catch { pass++ } }

function main(): void {
  // ── 1 · COALESCING — a backlog of blocks is ONE pending target (O(1), not O(n))
  {
    const p = new AnchorPool()
    const j0 = p.advance(root(1), 100)
    const j1 = p.advance(root(2), 101)
    const j2 = p.advance(root(3), 102) // blocks kept flowing; target advanced
    ok(j0 === j1 && j1 === j2, 'many blocks accumulate under ONE pending job id (coalesced)')
    ok(p.pending!.root === root(3) && p.pending!.height === 102, 'the pending target is the LATEST cascade root — it consolidates all prior state')
  }

  // ── 2 · FAIR, VERIFIABLE DRAW — unbiasable beacon, anyone recomputes it
  {
    const p = new AnchorPool()
    for (const a of ['alice', 'bob', 'carol', 'dave', 'erin']) p.offer(a, 10_000n)
    p.advance(root(7), 200)
    const beacon = sha('bitcoin-block-hash-777')
    const payer = p.draw(beacon, 1_000n)
    ok(payer !== null, 'with volunteers present, a payer is drawn')
    // the draw is a PURE function of public inputs — an auditor reproduces it exactly
    const cands = p.candidates(1_000n)
    ok(AnchorPool.pick(beacon, p.pending!.jobId, root(7), cands) === payer, 'the draw is publicly verifiable (static pick reproduces it byte-for-byte)')
    // a DIFFERENT beacon generally moves the choice — no fixed favouritism
    let moved = 0
    for (let i = 0; i < 20; i++) if (AnchorPool.pick(sha('b' + i), p.pending!.jobId, root(7), cands) !== payer) moved++
    ok(moved > 0, 'different Bitcoin block hashes select different payers (no rigged winner)')
  }

  // ── fairness: over many beacons the winner distribution is roughly uniform
  {
    const cands = ['a', 'b', 'c', 'd'].sort()
    const count: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 }
    const N = 4000
    for (let i = 0; i < N; i++) count[AnchorPool.pick(sha('beacon#' + i), 0, root(1), cands)!]++
    const expected = N / cands.length
    let worst = 0
    for (const c of cands) worst = Math.max(worst, Math.abs(count[c] - expected) / expected)
    ok(worst < 0.12, `draw is ~uniform across volunteers (worst skew ${(worst * 100).toFixed(1)}% < 12%)`)
  }

  // ── 3 · PENDING-NEVER-LOST — empty pool waits; a volunteer appears → it anchors
  {
    const p = new AnchorPool()
    p.advance(root(9), 300)
    ok(p.draw(sha('beacon'), 1_000n) === null, 'no volunteers → the anchor stays PENDING (blocks kept flowing, nothing lost)')
    ok(p.pending !== null, 'the pending target survives an empty draw')
    p.offer('latecomer', 5_000n) // someone finally shows up
    const payer = p.draw(sha('beacon'), 1_000n)
    ok(payer === 'latecomer', 'the instant a volunteer appears, the draw picks them and the backlog anchors')
  }

  // ── 4 · GRIEF-PROOF — a drawn payer who fails is excluded; the job re-draws
  {
    const p = new AnchorPool()
    for (const a of ['x', 'y']) p.offer(a, 10_000n)
    p.advance(root(11), 400)
    const beacon = sha('grief-beacon')
    const first = p.draw(beacon, 1_000n)!
    p.markFailed(first) // they vanished mid-ceremony
    const second = p.draw(beacon, 1_000n)
    ok(second !== null && second !== first, 'a payer who fails to pay is excluded and a DIFFERENT payer is drawn (reconcile, nothing lost)')
    ok(p.pending !== null, 'through the failure the job stayed pending — never dropped')
    // if ALL fail, still pending (waits for a fresh volunteer) — liveness preserved
    p.markFailed(second)
    ok(p.draw(beacon, 1_000n) === null && p.pending !== null, 'if every current volunteer fails, the job simply waits for a new one — never stuck-lost')
  }

  // ── reward: ∝ real sats, only on a CONFIRMED, ROOT-MATCHING payment; Sybil gains 0
  {
    const p = new AnchorPool()
    p.offer('payer', 50_000n)
    p.advance(root(13), 500)
    const beacon = sha('reward-beacon')
    const who = p.draw(beacon, 1_000n)!
    // a settlement whose root does NOT match the pending cascade root is refused
    rejects(() => p.settle(who, sha('tx1'), 2_500n, root(999)), 'a settlement with the wrong cascade root is refused — no fake anchor earns a reward')
    // a zero-sat "payment" earns nothing (must have really paid Bitcoin)
    rejects(() => p.settle(who, sha('tx2'), 0n, root(13)), 'a zero-sat settlement is refused — reward is for REAL sats spent')
    const s = p.settle(who, sha('tx3'), 2_500n, root(13))
    // FLAT, and that is the whole point: profit = P·perAnchor − fee is strictly
  // DECREASING in the fee, so the rational volunteer pays the MINIMUM that
  // confirms — at every price, with no tuning. A fee-proportional reward paid
  // more for wasting more, and above one satoshi per KRAY its optimum was to
  // burn ~0.01 BTC per seal as deadweight, purely to farm ₭.
  ok(s.reward === rewardFor(2_500n) && s.reward === DEFAULT_REWARD.perAnchor, 'the volunteer who really paid is rewarded a FLAT amount for the service — never ∝ what they spent')
  ok(rewardFor(200n) === rewardFor(100_000n), 'a cheap anchor and an expensive one earn the SAME: paying more buys a fair chance, never a larger reward')
  ok(rewardFor(DEFAULT_REWARD.maxFeeSats + 1n) === 0n, 'and beyond the griefing guard it earns NOTHING — an anchor costing more than 0.01 BTC is not a service, it is a statement')
    ok(p.pending === null, 'once settled, the whole backlog up to that root is sealed — pending clears')
    ok(p.settledCount === 1 && p.totalSatsPaid() === 2_500n, 'the confirmed anchor is recorded (sats + reward accounted)')
    // Sybil: 1000 fake volunteers who never pay earn NOTHING (reward only via settle)
    for (let i = 0; i < 1000; i++) p.offer('sybil' + i, DEFAULT_REWARD.maxFeeSats)
    ok(p.totalRewarded() === s.reward, 'a horde of Sybil volunteers earns nothing — only actually paying sats is ever rewarded')
  }

  // reward cap holds; merkle root is deterministic + anchorable
  {
    // there is no cap to reach any more, because there is no proportional term
    // to run away: a flat reward is bounded by its own definition, and an absurd
    // fee earns zero rather than the ceiling
    ok(rewardFor(10_000_000_000n) === 0n, 'a ten-thousand-dollar "anchor" earns NOTHING — the reward cannot be farmed by spending, because it never depended on spending')
    ok(rewardFor(1n) === DEFAULT_REWARD.perAnchor, 'and the cheapest honest anchor earns the full service reward — the network pays for the root reaching Bitcoin, which is a binary fact')
    const p1 = new AnchorPool(); p1.offer('a', 9n); p1.advance(root(1), 1); p1.settle('a', sha('t'), 9n, root(1))
    const p2 = new AnchorPool(); p2.offer('a', 9n); p2.advance(root(1), 1); p2.settle('a', sha('t'), 9n, root(1))
    ok(/^[0-9a-f]{64}$/.test(p1.merkleRoot()) && p1.merkleRoot() === p2.merkleRoot(), 'the pool state has a deterministic, Bitcoin-anchorable merkle root (born indexed)')
  }

  console.log(`\n✓ ${pass} checks passed — THE VOLUNTARY ANCHOR POOL holds: KRAY blocks run free; the Bitcoin anchor of the consolidated cascade root is paid by a FAIRLY & VERIFIABLY DRAWN volunteer (unbiasable Bitcoin-block-hash beacon); a backlog costs O(1) (one anchor seals everything); an empty pool waits and NEVER loses (the instant someone volunteers, it anchors); a payer who fails is excluded and re-drawn (nothing lost); and only a CONFIRMED, root-matching, real-sat payment is rewarded (Sybil earns zero). Decentralized, grief-proof, 10,000-year live. No central anchor wallet, ever.`)
  process.exit(0)
}
main()
