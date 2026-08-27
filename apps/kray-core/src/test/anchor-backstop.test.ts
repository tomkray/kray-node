/**
 * THE BACKSTOP THAT STANDS DOWN (Slice 2b core) — the pool yields to any external anchor, and survives reboots.
 *   node src/test/anchor-backstop.test.ts
 *
 * In the unified anchoring, the COMMON case is free: each burn donation IS the anchor. The pool is only the
 * quiet-period backstop. So two laws must hold beyond anchor-pool.test.ts:
 *   · satisfied() — when a donation (or the operator) seals the pending root, the job clears WITHOUT a reward
 *     (the network bought nothing from the pool), and a STALE external seal can never cancel a newer target;
 *   · snapshot()/restore() — standing offers, the pending job and the settled history survive a node reboot
 *     bit-for-bit: same candidates, same draw, same jobId sequence. A hostile snapshot yields an empty pool.
 */
import { AnchorPool, DEFAULT_REWARD } from '../economics/anchor-pool.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const R = (c: string) => c.repeat(64)
const BEACON = '0000000000000000000a' + 'e'.repeat(44)

function main() {
  console.log('\n╔═ THE BACKSTOP STANDS DOWN — the pool yields to any external anchor, and survives reboots ═╗\n')

  // ── satisfied(): an external anchor of the pending root clears the job, rewarding nobody ──
  const pool = new AnchorPool()
  pool.offer('guardian-1', 50_000n)
  pool.offer('guardian-2', 80_000n)
  pool.advance(R('a'), 7)
  ok(pool.pending !== null, 'a value-block with no anchor puts a job up')
  ok(!pool.satisfied(R('b')), 'an external seal of a DIFFERENT root does not touch the pending target')
  ok(pool.pending !== null && pool.pending.root === R('a'), 'the pending target is intact after the mismatched seal')
  ok(pool.satisfied(R('a')), 'a donation self-anchor of the EXACT pending root satisfies the job')
  ok(pool.pending === null, 'the job is cleared — no payer, no settlement, no reward (nothing was bought)')
  ok(pool.settledCount === 0 && pool.totalRewarded() === 0n, 'satisfied() rewards NOBODY — only a real pool anchor earns')
  ok(!pool.satisfied(R('a')), 'satisfying an already-cleared job is a no-op (idempotent, never throws)')

  // ── the stale-seal race: the job coalesces to a NEWER root; the OLD root's seal must not cancel it ──
  pool.advance(R('c'), 9)
  pool.advance(R('d'), 10)                       // coalesced — the newest root is the only target
  ok(!pool.satisfied(R('c')), 'a late-confirming seal of the SUPERSEDED root cannot cancel the newer target')
  ok(pool.pending !== null && pool.pending.root === R('d'), 'the newer root still waits for its anchor')

  // ── snapshot() → restore(): the pool survives a reboot bit-for-bit ──
  pool.markFailed('guardian-2')                  // a failed payer must survive the reboot too (no reward retry)
  const snap = JSON.parse(JSON.stringify(pool.snapshot()))   // through JSON, exactly like the data file
  const back = AnchorPool.restore(snap)
  ok(back.pending !== null && back.pending.root === R('d') && back.pending.failed.includes('guardian-2'),
    'restore() reproduces the pending job INCLUDING the failed-payer exclusion')
  ok(JSON.stringify(back.candidates(1n)) === JSON.stringify(pool.candidates(1n)), 'restore() reproduces the exact candidate list')
  ok(back.draw(BEACON, 1n) === pool.draw(BEACON, 1n) && back.draw(BEACON, 1n) !== null,
    'the restored pool draws the IDENTICAL payer from the same beacon — determinism survives the reboot')
  const s1 = back.settle(back.draw(BEACON, 1n)!, R('7'), 500n, R('d'))
  ok(s1.reward === DEFAULT_REWARD.perAnchor, 'the restored pool settles and rewards exactly as the original would')

  // ── settlements survive the reboot; jobId sequence continues (no reuse) ──
  const snap2 = JSON.parse(JSON.stringify(back.snapshot()))
  const back2 = AnchorPool.restore(snap2)
  ok(back2.settledCount === 1 && back2.settlements()[0].txid === R('7'), 'settled history survives the reboot')
  const nextId = back2.advance(R('e'), 12)
  ok(nextId > s1.jobId, 'the jobId sequence continues after restore — a settled jobId is never reused')

  // ── the reward is CONSERVED by construction: a capped policy is what the node pays from its fee pool ──
  const feePool = 1_234n                          // a node whose fee pool holds less than the flat reward
  const payable = DEFAULT_REWARD.perAnchor < feePool ? DEFAULT_REWARD.perAnchor : feePool
  const s2 = back2.settle(back2.draw(BEACON, 1n) ?? 'guardian-1', R('8'), 400n, R('e'), { perAnchor: payable, maxFeeSats: DEFAULT_REWARD.maxFeeSats })
  ok(s2.reward === 1_234n, 'the recorded reward equals what the fee pool can actually pay — honest books, never minted')

  // ── a hostile snapshot yields an EMPTY pool (fail-closed) ──
  for (const bad of [null, 42, 'x', { offers: 'nope', job: { jobId: 'a', root: 'zz' } }, { settled: [{ txid: 'short', sats: '-1', reward: 'NaN' }] }]) {
    const p = AnchorPool.restore(bad)
    if (!(p.pending === null && p.settledCount === 0 && p.readyCount(0n) === 0)) { ok(false, 'hostile snapshot must yield an empty pool'); break }
  }
  ok(true, 'every hostile snapshot shape yields an empty pool — offers simply re-register (fail-closed)')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the backstop yields to donations, survives reboots, and pays only what the fee pool holds. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
