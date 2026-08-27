/**
 * ✦ FROZEN-STAR GLOW — the soulbound reputation from freezing a star. Prove by breaking:
 *
 *   node src/test/glow-star.test.ts
 *
 *   G-01  earn exactly 1 glow per distinct star frozen, per freezer; a non-freezer has 0
 *   G-02  SOULBOUND — only freezing (to the black hole) earns it; ₭ transfer / star-to-other / receiving do NOT;
 *         glow can never be received or bought
 *   G-03  a star freezes once — a duplicate event never double-counts
 *   G-04  PERMANENT + deterministic — same journal, same glow, re-derived (no decay, no drift)
 *   G-05  the farming vector is REAL and honest — 1000 junk freezes = 1000 RAW glow (the DARK-GLOW / peer-vote
 *         quality layer is future; this metric is the honest count, never a hidden claim of quality)
 *   G-06  the glyph is ✦ — a star's shine, not a currency mark
 */
import { BLACK_HOLE } from '../protocol/kray-primitives.ts'
import { frozenStarGlow, glowOf, GLOW_SYMBOL } from '../economics/glow-star.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const freeze = (from: string, star: number) => ({ kind: 'transfer-star', to: BLACK_HOLE, from, star })

console.log('\nG-01 — 1 glow per frozen star, per freezer')
{
  const ev = [freeze('A', 1), freeze('A', 2), freeze('A', 3), freeze('B', 4)]
  ok(glowOf(ev, 'A') === 3 && glowOf(ev, 'B') === 1, 'A froze 3 → 3 glow; B froze 1 → 1 glow')
  ok(glowOf(ev, 'C') === 0, 'a non-freezer has 0 glow')
}

console.log('\nG-02 — soulbound: only freezing earns it, nothing moves it')
{
  const ev = [
    freeze('A', 1),
    { kind: 'transfer', from: 'A', to: 'B', amount: '100' },        // moving ₭ does not move glow
    { kind: 'transfer-star', from: 'A', to: 'D', star: 2 },          // a star to a NON-black-hole address ≠ freeze
    { kind: 'transfer-star', from: 'X', to: 'A', star: 3 },          // receiving a star ≠ freezing it
  ]
  ok(glowOf(ev, 'A') === 1, 'only the freeze (to the black hole) counts; ₭ transfer + star-to-other + receiving earn nothing')
  ok(glowOf(ev, 'B') === 0 && glowOf(ev, 'D') === 0, 'glow can never be received or bought — soulbound by construction')
}

console.log('\nG-03 — a star freezes once')
{
  const ev = [freeze('A', 7), freeze('A', 7), freeze('A', 7)]
  ok(glowOf(ev, 'A') === 1, 'a duplicate freeze of the same star counts once, never thrice')
}

console.log('\nG-04 — permanent + deterministic')
{
  const ev = [freeze('A', 1), freeze('B', 2), freeze('A', 3)]
  const g1 = frozenStarGlow(ev), g2 = frozenStarGlow([...ev])
  ok(g1.get('A') === 2 && g2.get('A') === 2, 'same cascade → same glow (re-derivable, permanent, no decay)')
}

console.log('\nG-05 — the farming vector, honest (raw count is game-able; quality is the social layer)')
{
  const junk = Array.from({ length: 1000 }, (_, i) => freeze('FARMER', 10_000 + i))
  ok(glowOf(junk, 'FARMER') === 1000, '1000 junk freezes = 1000 RAW glow — recorded honestly; DARK GLOW / peer-vote judges quality (future)')
}

console.log('\nG-06 — the symbol')
ok(GLOW_SYMBOL === '✦', "the glyph is ✦ — a star's shine, not a currency mark")

console.log(`\n${fail === 0 ? '✅' : '❌'} frozen-star glow — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
