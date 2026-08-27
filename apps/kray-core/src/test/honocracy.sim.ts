/**
 * Honocracy simulation — SEE the balance, then lock it.
 *   node src/kray-honocracy-sim.ts
 *
 * Prints the governance voice of the personas the founder described, and
 * asserts the founder's conditions hold: honor governs, money is capped by
 * honor, a whale with no work can never buy a maximum position, and Glow
 * amplifies how much KRAY counts. Tune DEFAULT_HONOCRACY and re-run to feel it.
 */
import { DEFAULT_HONOCRACY as P, voice, voiceBreakdown, unlockedKray } from '../economics/honocracy.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
const n = (b: bigint) => Number(b)
const pad = (s: string | number, w: number) => String(s).padStart(w)
const padL = (s: string, w: number) => s.padEnd(w)

interface Persona { name: string; glow: bigint; kray: bigint }
const PEOPLE: Persona[] = [
  { name: 'New soul (just joined)', glow: 0n, kray: 0n },
  { name: 'Small holder, no work', glow: 0n, kray: 100n },
  { name: '🐋 WHALE, no work', glow: 0n, kray: 1_000_000n },
  { name: 'Honest worker', glow: 100n, kray: 0n },
  { name: 'Worker + holder', glow: 100n, kray: 1_000n },
  { name: 'Devoted validator', glow: 10_000n, kray: 0n },
  { name: '👑 Devoted + whale', glow: 10_000n, kray: 1_000_000n },
]

console.log(`\nHonocracy voice = base + w_g·√Glow + w_k·√(min(KRAY, C·Glow + K0))`)
console.log(`params: base=${P.base} w_g=${P.wg} w_k=${P.wk} C=${P.c} K0=${P.k0}\n`)
console.log(`${padL('persona', 24)} ${pad('Glow', 8)} ${pad('KRAY', 11)} ${pad('honor', 7)} ${pad('KRAY used', 10)} ${pad('VOICE', 7)}`)
console.log('─'.repeat(72))
for (const p of PEOPLE) {
  const b = voiceBreakdown(p.glow, p.kray)
  console.log(`${padL(p.name, 24)} ${pad(n(p.glow), 8)} ${pad(n(p.kray), 11)} ${pad(n(b.honor), 7)} ${pad(n(b.unlockedKray), 10)} ${pad(n(b.total), 7)}`)
}

const whale = voice(0n, 1_000_000n)
const smallHolder = voice(0n, 100n)
const worker = voice(100n, 0n)
const workerHolder = voice(100n, 1_000n)
const devoted = voice(10_000n, 0n)
const devotedWhale = voice(10_000n, 1_000_000n)
const newSoul = voice(0n, 0n)

console.log(`\n— the founder's conditions, checked —`)

// 1 · inclusion: every verified soul has a floor voice
ok(newSoul === P.base, `all voices: a new soul has the base floor voice (${n(newSoul)})`)

// 2 · money is capped by honor: a whale with no work gains NOTHING beyond the K0 floor
ok(whale === smallHolder, `a WHALE with no work (1,000,000 KRAY) has the SAME voice as a 100-KRAY holder — extra money buys nothing without honor`)
ok(unlockedKray(0n, 1_000_000n) === P.k0, `without Glow, only K0=${n(P.k0)} of a whale's KRAY ever counts`)

// 3 · work beats pure money
ok(worker > whale, `an honest worker (${n(worker)}) outranks a mega-whale (${n(whale)}) — proof of work > proof of wealth`)

// 4 · Glow + KRAY = the most; honor alone already governs strongly
ok(workerHolder > worker && worker > whale, `Glow+KRAY (${n(workerHolder)}) > Glow-only (${n(worker)}) > whale (${n(whale)})`)
const maxVoice = PEOPLE.map((p) => voice(p.glow, p.kray)).reduce((a, b) => (b > a ? b : a))
ok(devotedWhale === maxVoice, `the devoted validator who also holds KRAY has the greatest voice (${n(devotedWhale)})`)

// 5 · Glow AMPLIFIES KRAY: more honor unlocks more of your money
ok(unlockedKray(10_000n, 1_000_000n) > unlockedKray(100n, 1_000_000n), `more Glow unlocks more KRAY: devoted uses ${n(unlockedKray(10_000n, 1_000_000n))} vs worker's ${n(unlockedKray(100n, 1_000_000n))}`)
ok(unlockedKray(100n, 1_000_000n) > unlockedKray(0n, 1_000_000n), `even some Glow unlocks more KRAY than none`)

// 6 · KRAY-only can never reach a maximum position
ok(whale < devoted, `a mega-whale (${n(whale)}) sits far below a devoted validator (${n(devoted)}) — money can't buy the top`)

// 7 · monotonic + anti-whale (√): honor never concentrates
ok(voice(400n, 0n) - P.base === (voice(100n, 0n) - P.base) * 2n, `√ dampening: 4× the Glow gives only 2× the honor voice (inverted pyramid)`)
ok(voice(50n, 500n) <= voice(50n, 5_000n) && voice(50n, 500n) <= voice(200n, 500n), `voice is monotonic in both Glow and KRAY`)

console.log(`\n✓ ${pass} checks passed — Honocracy holds: honor governs, money is capped by honor, no whale buys the top, Glow amplifies KRAY. ߜ`)
process.exit(0)
