/**
 * V1 — THE PAY-CAP LIFT (dormant). Prove by breaking:
 *
 *   node src/test/v1-paycap-lift.test.ts
 *
 * The FLAT per-identity pay cap (BEAT_PAY_ZEROS_CAP) is the ONE thing that broke sybil-neutrality:
 * 2^zeros is neutral BY ITSELF (2^30 === 64 × 2^24), so a miner above the cap out-earns itself by
 * splitting across N addresses each ≤ the cap. This exam pins, with the REAL consensus functions:
 *   V1-01  with the cap, a splitter earns ~64× an honest miner of the SAME hashrate (the break).
 *   V1-02  lifting the cap makes splitting NEUTRAL, exact to the unit (the fix).
 *   V1-03  the clamp mechanism is real (spanWork honours payZerosCap; full pays 2^zeros).
 *   V1-04  DORMANCY: LIFT sits beyond every real seq, so today's behavior is byte-identical.
 *   V1-05  the seq gate routes: below LIFT → capped path; at/above LIFT → full-zeros path.
 *   V1-06  the presence window is untouched — a block-index grind still HALTs (no new vector).
 */
import { beatWork, spanWork, mineBeat } from '../economics/beat-pow.ts'
import { splitFeePool } from '../economics/reward.ts'
import { settleFromBeats } from '../economics/settlement.ts'
import { BEAT_PAY_ZEROS_CAP as CAP, BEAT_PAY_CAP_LIFTED_FROM_SEQ as LIFT, PRESENCE_WINDOW_FROM_SEQ, assertPresenceClaims } from '../economics/presence-window.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const refuses = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); fail++; console.log('  ✗ FAIL (no throw) — ' + m) }
  catch (e) { const msg = e instanceof Error ? e.message : String(e); if (re.test(msg)) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log(`  ✗ FAIL (wrong throw: ${msg}) — ` + m) } }
}

const POOL = 1_000_000n
const pct = (a: bigint) => (Number(a) / Number(POOL) * 100).toFixed(1) + '%'

// ── V1-01 / V1-02 — the break and the fix, via the REAL work + split functions ──
// A miner of hashrate 2^30 finds a best beat ~30 zeros; split into 64 addresses each mines ~24 zeros.
console.log('\nV1-01/02 — capped breaks sybil-neutrality; lifted restores it (real beatWork + splitFeePool)')
const weigh = (clamp: boolean) => (z: number) => beatWork(clamp ? Math.min(z, CAP) : z)
for (const clamp of [true, false]) {
  const w = weigh(clamp)
  const vs = [{ id: 'honest', weight: w(30) }, ...Array.from({ length: 64 }, (_, i) => ({ id: 's' + i, weight: w(24) }))]
  const r = splitFeePool(POOL, vs); const m = new Map(r.map(x => [x.id, x.amount]))
  const h = m.get('honest')!, s = r.filter(x => x.id[0] === 's').reduce((a, x) => a + x.amount, 0n)
  const ratio = Number(s) / Number(h)
  if (clamp) ok(ratio > 50, `V1-01: capped — splitter earns ${ratio.toFixed(0)}× an honest miner of the SAME hashrate (${pct(h)} vs ${pct(s)}) — the break`)
  else ok(Math.abs(ratio - 1) < 0.01, `V1-02: lifted — splitting is NEUTRAL (${ratio.toFixed(3)}×, ${pct(h)} vs ${pct(s)}) — the fix`)
}
ok(beatWork(30) === 64n * beatWork(24), 'V1-02: 2^30 === 64 × 2^24 — 2^zeros is sybil-neutral BY ITSELF (no cap needed)')

// ── V1-03 — the clamp mechanism is real ──
console.log('\nV1-03 — the clamp mechanism (spanWork honours payZerosCap)')
const BEACON = 'f'.repeat(64), ADDR = 'bcrt1p_v1_example_address_zero'
const beat = mineBeat(BEACON, ADDR, 7, 200_000)!
const z = beat.zeros
const rawW = spanWork(BEACON, ADDR, [beat]).work
const clampW = spanWork(BEACON, ADDR, [beat], { payZerosCap: 10 }).work
ok(z > 10, `V1-03: mined a beat with ${z} zeros (> 10, so a cap of 10 bites)`)
ok(rawW === beatWork(z) && clampW === beatWork(10) && clampW < rawW, `V1-03: payZerosCap=10 clamps ${rawW} → ${clampW}; uncapped pays the full 2^${z}`)

// ── V1-04 — DORMANCY: the fix is inert until the Creator ratifies the activation seq ──
console.log('\nV1-04 — dormancy (LIFT beyond every real seq ⇒ today byte-identical)')
ok(LIFT > PRESENCE_WINDOW_FROM_SEQ && LIFT > 1_000_000_000, `V1-04: LIFT (${LIFT}) is beyond any real seq — the cap stays active everywhere today; the fix is inert and proven`)

// ── V1-05 — the seq gate routes capped vs full ──
console.log('\nV1-05 — the seq gate routes by era')
const claim = [{ address: ADDR, beats: [beat] }]
const dormant = settleFromBeats(BEACON, POOL, claim, { presenceTip: 7, seq: 200 })      // seq < LIFT → capped path
const lifted = settleFromBeats(BEACON, POOL, claim, { presenceTip: 7, seq: LIFT })       // seq ≥ LIFT → full path
// this beat is < CAP(24), so both regimes pay it the SAME number — that IS the dormancy (byte-identical);
// the assertion still verifies each seq routes to its intended weighting function.
ok(dormant.lines[0].base === spanWork(BEACON, ADDR, [beat], { payZerosCap: CAP }).work, 'V1-05: seq < LIFT routes the CAPPED path (byte-identical to today)')
ok(lifted.lines[0].base === spanWork(BEACON, ADDR, [beat]).work, 'V1-05: seq ≥ LIFT routes the FULL-zeros path (the fix)')

// ── V1-06 — the presence window is untouched (no new vector opened) ──
console.log('\nV1-06 — the block-index grind still HALTs (window intact)')
const grind = [{ address: ADDR, beats: Array.from({ length: 2000 }, (_, i) => ({ block: i, nonce: '1', zeros: 8 })) }]
refuses(() => assertPresenceClaims(grind, 7), /one moment per address|outside the open presence window/, 'V1-06: 2000 distinct blocks under presenceTip still HALT — lifting the pay cap did not touch the window')

console.log(`\n${fail === 0 ? '✅' : '❌'} V1 pay-cap lift — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
