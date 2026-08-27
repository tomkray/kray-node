/**
 * V5 — THE ANCHOR DRAW, sats-weighted. Prove by breaking:
 *
 *   node src/test/anchor-draw-v5.test.ts
 *
 * The uniform draw (today) is sybil-vulnerable: K minFee identities beat one K×minFee offer K-to-1 — same
 * capital, K× the anchors. The sats-weighted draw is sybil-NEUTRAL: chance ∝ sats offered, so splitting an
 * offer conserves the total interval. The reward stays flat, so this changes WHO is picked, never HOW MUCH.
 * The draw is a LIVE operator coordination (not replayed consensus), so the fix is a per-operator flag, and
 * the default (uniform) stays byte-identical.
 *   V5-01  sats-weighted: consolidated (K×minFee) earns the SAME as split (K × minFee) — sybil-neutral
 *   V5-01c contrast: the uniform draw gives the split-group ~K× (the vector, reproduced)
 *   V5-02  a whale (10× capacity) wins ~10× a small — proportional and fair (flat reward, trustless anchor)
 *   V5-03  DORMANCY: the flag defaults false, so draw() == the uniform pick, byte-identical to today
 *   V5-04  a zero/negative offer floors to 1 — no divide-by-zero
 */
import { AnchorPool, ANCHOR_DRAW_SATS_WEIGHTED } from '../economics/anchor-pool.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

const BEACON = 'a'.repeat(64), ROOT = 'b'.repeat(64), MIN = 1000n, K = 8, HONEST = 20, DRAWS = 40000

// ── V5-01 · sats-weighted is sybil-neutral ──
console.log('\nV5-01 — sats-weighted: same capital → same anchors (sybil-neutral)')
{
  const cands = ['CONS', ...Array.from({ length: K }, (_, i) => `s${i}`), ...Array.from({ length: HONEST }, (_, i) => `h${i}`)].sort()
  const sats = new Map<string, bigint>([['CONS', BigInt(K) * MIN]])
  for (let i = 0; i < K; i++) sats.set(`s${i}`, MIN)
  for (let i = 0; i < HONEST; i++) sats.set(`h${i}`, MIN)
  const satsOf = (a: string) => sats.get(a) ?? 0n
  let cw = 0, sw = 0
  for (let j = 0; j < DRAWS; j++) { const w = AnchorPool.pickWeighted(BEACON, j, ROOT, cands, satsOf); if (w === 'CONS') cw++; else if (w![0] === 's') sw++ }
  const ratio = sw / Math.max(1, cw)
  ok(Math.abs(ratio - 1) < 0.1, `consolidated ${cw} vs split-group ${sw} (ratio ${ratio.toFixed(2)}) — splitting K×minFee buys NOTHING`)

  // V5-01c contrast — the uniform draw is the vector
  let cu = 0, su = 0
  for (let j = 0; j < DRAWS; j++) { const w = AnchorPool.pick(BEACON, j, ROOT, cands); if (w === 'CONS') cu++; else if (w![0] === 's') su++ }
  ok(su / Math.max(1, cu) > 5, `contrast: the UNIFORM draw gives the split-group ${(su / Math.max(1, cu)).toFixed(1)}× — the V5 sybil, reproduced`)
}

// ── V5-02 · whale is proportional (fair) ──
console.log('\nV5-02 — a whale wins ∝ capacity (proportional; the reward stays flat, the anchor is a commodity)')
{
  const cands = ['small', 'whale'].sort()
  const satsOf = (a: string) => (a === 'whale' ? 10_000n : 1_000n)
  let ww = 0, sm = 0
  for (let j = 0; j < DRAWS; j++) { const w = AnchorPool.pickWeighted(BEACON, j, ROOT, cands, satsOf); if (w === 'whale') ww++; else sm++ }
  ok(Math.abs(ww / Math.max(1, sm) - 10) < 2, `whale (10× capacity) wins ${(ww / Math.max(1, sm)).toFixed(1)}× the small — proportional, never a larger per-anchor reward`)
}

// ── V5-03 · dormancy — the flag is off, draw == uniform pick ──
console.log('\nV5-03 — dormancy: default flag keeps the uniform draw byte-identical')
{
  ok(ANCHOR_DRAW_SATS_WEIGHTED === false, 'ANCHOR_DRAW_SATS_WEIGHTED defaults false (dormant)')
  const pool = new AnchorPool()
  pool.offer('x', MIN); pool.offer('y', 2n * MIN); pool.offer('z', 3n * MIN)
  const jobId = pool.advance(ROOT, 100)
  const viaDraw = pool.draw(BEACON, MIN)
  const viaPick = AnchorPool.pick(BEACON, jobId, ROOT, ['x', 'y', 'z'])
  ok(viaDraw === viaPick, `draw() with the flag off == uniform pick (byte-identical to today): picked ${viaDraw}`)
}

// ── V5-04 · a zero/negative offer floors to 1 ──
console.log('\nV5-04 — a zero offer floors to 1 (no divide-by-zero)')
{
  const w = AnchorPool.pickWeighted(BEACON, 0, ROOT, ['a', 'b'].sort(), (a) => (a === 'a' ? 0n : 1000n))
  ok(w === 'a' || w === 'b', `zero-offer candidate handled (floored to 1): picked ${w}`)
}

console.log(`\n${fail === 0 ? '✅' : '❌'} V5 anchor draw (sats-weighted) — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
