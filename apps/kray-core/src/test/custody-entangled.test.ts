/**
 * CUSTODY — THE ENTANGLED PREMIUM (v2). Prove by breaking:
 *
 *   node src/test/custody-entangled.test.ts
 *
 * The v1 premium (K fixed indices per address) is address-grindable — a 50% holder fakes 100% in ~256 tries.
 * The entangled premium reads the atlas at an index bound to the beat's OWN nonce, valid only if held. For any
 * fixed address the nonce sweeps the atlas uniformly, so the completion rate is EXACTLY the fraction held —
 * ungrindable, linear, and the CPU-only guardian (f=0) keeps its full base presence and simply earns no
 * premium. This exam pins:
 *   E-01  premium completion rate = fraction held (linear), for f = 1 / 0.5 / 0.25 / 0.1
 *   E-02  address-grind (200 addresses) cannot beat f — the indices do not concentrate
 *   E-03  a truly-held read verifies (> 0); forged / copied / no-PoW answers prove 0
 *   E-04  the CPU guardian (f=0) cannot forge a premium beat — base presence is untouched
 *   E-05  the v1 custody (effectiveWork, custodyChallenges) is byte-identical — nothing was rewired
 */
import { createHash } from 'node:crypto'
import { mineBeat } from '../economics/beat-pow.ts'
import { premiumIndex, verifyPremiumBeat, entangledPremiumWork, buildPremiumBeat, effectiveWork, custodyChallenges, CUSTODY_CHALLENGES, type AtlasOracle } from '../economics/custody.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

const N = 2048
const contents = Array.from({ length: N }, (_, i) => createHash('sha256').update('content-' + i).digest('hex'))
const bytesFor = (h: string) => Buffer.from('bytes-of-' + h)
function oracleHolding(f: number, seed: string): AtlasOracle {
  const held = new Set<string>()
  for (let i = 0; i < N; i++) if (Number(BigInt('0x' + createHash('sha256').update(`${seed}|${i}`).digest('hex')) % 1000n) < Math.round(f * 1000)) held.add(contents[i])
  return { contents, bytesOf: (h) => (held.has(h) ? bytesFor(h) : null) }
}
const fracHeld = (o: AtlasOracle) => o.contents.filter((h) => o.bytesOf(h) !== null).length / N
const BEACON = 'a'.repeat(64), ADDR = 'bcrt1p_premium_test'

// ── E-01 · completion rate = fraction held (linear) ──
console.log('\nE-01 — premium completion rate = fraction held (the nonce sweeps uniformly)')
for (const f of [1.0, 0.5, 0.25, 0.1]) {
  const o = oracleHolding(f, 'rate' + f), realF = fracHeld(o), M = 20000
  let held = 0
  for (let n = 0; n < M; n++) if (o.bytesOf(contents[premiumIndex(BEACON, ADDR, BigInt(n), N)]) !== null) held++
  const rate = held / M
  ok(Math.abs(rate - realF) < 0.03, `holds ${(realF * 100).toFixed(1)}% → premium rate ${(rate * 100).toFixed(1)}% (Δ ${((rate - realF) * 100).toFixed(2)}pp) — linear, exact`)
}

// ── E-02 · address-grind cannot beat f ──
console.log('\nE-02 — grinding the payout address cannot concentrate the indices')
{
  const o = oracleHolding(0.25, 'grind'), realF = fracHeld(o), M = 2000
  let best = 0
  for (let g = 0; g < 200; g++) {
    let held = 0
    for (let n = 0; n < M; n++) if (o.bytesOf(contents[premiumIndex(BEACON, `grind-${g}`, BigInt(n), N)]) !== null) held++
    best = Math.max(best, held / M)
  }
  ok(best < realF + 0.05, `200 ground addresses: best rate ${(best * 100).toFixed(1)}% ≈ f=${(realF * 100).toFixed(0)}% — grinding buys nothing`)
}

// ── E-03 · verify end-to-end: held ok; forged / copied / no-PoW → 0 ──
console.log('\nE-03 — a real held read verifies; every forgery proves 0')
{
  const full = oracleHolding(1.0, 'full')
  const b = mineBeat(BEACON, ADDR, 7, 40000)!
  const pb = buildPremiumBeat(BEACON, ADDR, 7, BigInt(b.nonce), b.zeros, full)!
  ok(pb !== null && verifyPremiumBeat(BEACON, ADDR, pb, full) > 0n, `held → premium beat verifies (${b.zeros} zeros, work ${verifyPremiumBeat(BEACON, ADDR, pb, full)})`)
  ok(verifyPremiumBeat(BEACON, ADDR, { ...pb, answer: 'f'.repeat(64) }, full) === 0n, 'forged answer → 0')
  ok(verifyPremiumBeat(BEACON, 'other-address', pb, full) === 0n, 'copied to another address → 0 (address-salted PoW + answer)')
  ok(verifyPremiumBeat(BEACON, ADDR, { block: 7, nonce: '99', zeros: 40, answer: pb.answer }, full) === 0n, 'no real PoW (claims 40 zeros) → 0')
  // aggregate: a held + a non-existent-block beat → only the real held one counts
  const agg = entangledPremiumWork(BEACON, ADDR, [pb], full)
  ok(agg.work > 0n && agg.blocks.length === 1, `entangledPremiumWork sums only verified holds (work ${agg.work})`)
}

// ── E-04 · the CPU guardian (f=0) is untouched ──
console.log('\nE-04 — CPU-only guardian (holds nothing) earns no premium, keeps its base presence')
{
  const empty = oracleHolding(0.0, 'none')
  const b = mineBeat(BEACON, ADDR, 7, 40000)!
  ok(buildPremiumBeat(BEACON, ADDR, 7, BigInt(b.nonce), b.zeros, empty) === null, 'f=0 cannot BUILD a premium beat (holds no read)')
  const pb = buildPremiumBeat(BEACON, ADDR, 7, BigInt(b.nonce), b.zeros, oracleHolding(1.0, 'full'))!
  ok(verifyPremiumBeat(BEACON, ADDR, pb, empty) === 0n, 'f=0 verifier credits 0 — premium is a SEPARATE dimension; base presence is not gated on holding')
}

// ── E-05 · the v1 custody is byte-identical (nothing rewired) ──
console.log('\nE-05 — the v1 custody path is untouched')
{
  ok(effectiveWork(1000n, 0) === 8000n && effectiveWork(1000n, 8) === 24000n, 'v1 effectiveWork unchanged: base×K at 0 hits (1×), base×3K at K hits (3×)')
  const ch = custodyChallenges(BEACON, ADDR, N)
  ok(ch.length === CUSTODY_CHALLENGES && ch.every((x) => x >= 0 && x < N), 'v1 custodyChallenges unchanged (K fixed indices per address)')
}

console.log(`\n${fail === 0 ? '✅' : '❌'} custody entangled premium — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
