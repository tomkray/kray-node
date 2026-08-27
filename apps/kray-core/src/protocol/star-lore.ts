/**
 * Star lore — the model-agnostic star helpers shared across KRAYNET.
 *
 * The Codex (a star's number read for the mathematics inside it), the low-number
 * collections, the universal-keyboard name law, and the Inscription / Baptism
 * shapes. None of this depends on how stars are numbered or minted, so it is
 * shared by the star registry (starmap.ts), the node, and the tests — never
 * duplicated. Every trait is a pure, provable function of a star's number.
 *
 * Honours the minds who found the patterns: Fibonacci, Tesla, Euclid, Pythagoras,
 * the Egyptians, Galileo, Kepler.
 */
import { foldSeparators } from './library.ts'
import { CODEX_CEILING } from './schedule.ts'

// ── THE LOW-NUMBER CLUBS — a star wears the smallest (most coveted) it belongs to ──
export type StarCollection = 'first100' | 'first1k' | 'first10k' | 'first100k'
export function starCollection(n: bigint): StarCollection | null {
  if (n < 0n) return null
  if (n < 100n) return 'first100'
  if (n < 1_000n) return 'first1k'
  if (n < 10_000n) return 'first10k'
  if (n < 100_000n) return 'first100k'
  return null
}

// ── THE SACRED HOUSES — mathematical / geometric patterns a star can carry (several) ──
export type StarTrait =
  | 'fibonacci' | 'tesla369' | 'prime' | 'perfect' | 'triangular' | 'square'
  | 'binary' | 'palindrome' | 'repdigit' | 'round' | 'ladder' | 'master'
  | 'pi' | 'euler' | 'mersenne' | 'twinprime' | 'resonance'

// integer sqrt (Newton, BigInt-exact) and the perfect-square test built on it
function isqrt(n: bigint): bigint {
  if (n < 0n) return -1n
  if (n < 2n) return n
  let x = n, y = (x + 1n) / 2n
  while (y < x) { x = y; y = (x + n / x) / 2n }
  return x
}
function isPerfectSquare(n: bigint): boolean { if (n < 0n) return false; const r = isqrt(n); return r * r === n }
function isPow2(n: bigint): boolean { return n > 0n && (n & (n - 1n)) === 0n }
// a Fibonacci number iff 5n²+4 or 5n²−4 is a perfect square (Gessel's test)
function isFibonacci(n: bigint): boolean { const t = 5n * n * n; return isPerfectSquare(t + 4n) || isPerfectSquare(t - 4n) }
// a triangular number iff 8n+1 is a perfect square
function isTriangular(n: bigint): boolean { return n >= 0n && isPerfectSquare(8n * n + 1n) }
// the SEVEN perfect numbers below the Codex ceiling — Euclid–Euler, hard-listed because they are that rare
const PERFECTS = new Set(['6', '28', '496', '8128', '33550336', '8589869056', '137438691328'])
function digitSum(s: string): number { let t = 0; for (const c of s) t += c.charCodeAt(0) - 48; return t }
function isLadderRun(s: string): boolean { // 3+ strictly consecutive digits, up or down
  if (s.length < 3) return false
  let up = true, down = true
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1)
    if (d !== 1) up = false
    if (d !== -1) down = false
  }
  return up || down
}
// deterministic Miller–Rabin (these 12 bases are proven for all n < 3.3·10²⁴) — a
// modest, exact primality test with no float, no table.
function isPrime(n: bigint): boolean {
  if (n < 2n) return false
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
    if (n === p) return true
    if (n % p === 0n) return false
  }
  let d = n - 1n, r = 0n
  while (d % 2n === 0n) { d /= 2n; r++ }
  const powmod = (a: bigint, e: bigint, m: bigint): bigint => { let res = 1n; a %= m; while (e > 0n) { if (e & 1n) res = (res * a) % m; a = (a * a) % m; e >>= 1n } return res }
  witness: for (const a of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
    let x = powmod(a % n, d, n)
    if (x === 1n || x === n - 1n) continue
    for (let i = 0n; i < r - 1n; i++) { x = (x * x) % n; if (x === n - 1n) continue witness }
    return false
  }
  return true
}

// leading digits of π and e — a star whose whole number SPELLS the start of a
// transcendental constant (Archimedes' circle, Euler's growth). Immutable truths.
const PI_DIGITS = '3141592653589793238462643383279502884197169399375105820974944592'
const E_DIGITS = '2718281828459045235360287471352662497757247093699959574966967627'
function isConstPrefix(full: string, s: string): boolean { return s.length >= 3 && full.slice(0, s.length) === s }
// the sacred / solfeggio numbers — a curated set with real energetic lineage
const RESONANCE = new Set(['21', '33', '108', '144', '174', '216', '285', '396', '417', '432', '528', '639', '648', '741', '852', '864', '963', '1080', '1152', '1296', '1728', '2160', '3168', '4320', '144000'])

/** Read every mathematical trait a star's NUMBER carries (empty for a plain one). */
export function starTraits(n: bigint): StarTrait[] {
  const out: StarTrait[] = []
  if (n < 0n || n >= CODEX_CEILING) return out
  const s = n.toString()
  if (s.length >= 2 && /^(\d)\1+$/.test(s)) out.push('repdigit')          // The Monolith
  if (s.length >= 2 && s === [...s].reverse().join('')) out.push('palindrome') // Celestial Mirror
  if (s.length >= 3 && /^[1-9]0+$/.test(s)) out.push('round')             // The Zenith
  if (isLadderRun(s)) out.push('ladder')                                  // The Ascension
  if (isPow2(n)) out.push('binary')                                       // Eye of Horus
  if (isPerfectSquare(n)) out.push('square')                              // Galilean Square
  if (isTriangular(n)) out.push('triangular')                             // Sacred Triangle
  if (isFibonacci(n)) out.push('fibonacci')                               // Divine Proportion
  if (PERFECTS.has(s)) out.push('perfect')                                // Perfect Harmony
  const prime = isPrime(n)
  if (prime) out.push('prime')                                            // The Indivisible · Euclid
  if (prime && isPow2(n + 1n)) out.push('mersenne')                       // The Mersenne · 2^p − 1
  if (prime && n > 3n && (isPrime(n - 2n) || isPrime(n + 2n))) out.push('twinprime') // The Twins
  if (n > 0n && n % 3n === 0n) out.push('tesla369')                       // The Vortex 3·6·9
  { const ds = digitSum(s); if (ds === 11 || ds === 22 || ds === 33) out.push('master') } // Master numbers
  if (isConstPrefix(PI_DIGITS, s)) out.push('pi')                         // The Circle · Archimedes
  if (isConstPrefix(E_DIGITS, s)) out.push('euler')                       // The Constant · Euler
  if (RESONANCE.has(s)) out.push('resonance')                             // The Resonance
  return out
}

export interface Inscription {
  star: string // decimal string (BigInt-safe, canonical)
  id: string // `<signed event hash>i<index>` — derived from the SIGNED act, so the id cannot exist without the signature that authorised it
  number?: number // sequential inscription number among the LIVING (non-cursed); absent on cursed
  contentHash: string
  contentType: string
  size: number
  seq: number // the ledger event that tattooed it
  by: string
  parent?: string // provenance: the parent star (family tree / constellation)
  /** L1 PROVENANCE: when this inscription was bound from a Bitcoin Ordinals
   *  inscription (an `origin` event), the proven L1 id and reveal txid. Absent on
   *  a native L2 inscription. NEVER conflated with `parent`. */
  origin?: { l1InscriptionId: string; l1Txid: string }
  /** MULTIPARENT (message v3) — the full signed lineage, order as signed. When present,
   *  `parent`/`origin` above carry the FIRST element (endpoint-shape parity: the scalar
   *  fields never change meaning). Absent on every pre-v3 inscription, forever. */
  parents?: string[]
  origins?: { l1InscriptionId: string; l1Txid: string }[]
  /** Free JSON sealed with the inscription (v4). Absent on every pre-v4 tattoo. */
  meta?: string
  cursed: boolean // refused as a tattoo (recorded as history; never binds a star)
  cursedReason?: 'unowned' | 'duplicate' | 'self-fee' | 'badparent' | 'reinscribe'
}

// ── THE UNIVERSAL-KEYBOARD LAW ────────────────────────────────────────────────
// A name's IDENTITY is its universal keyboard form — no variation can coexist.
// Canonical identity = Unicode NFKC (fullwidth/compatibility/composed forms
// collapse) → case-folded → whitespace runs collapsed → trimmed. "Bob", "bob",
// "BOB", "Ｂob", " bob " and "bob␣␣" are ONE name; the first writer owns it and
// their exact byte form stays the display form forever. Invisible, control and
// bidi characters are NOT letters — a name carrying one is INVALID outright.
export const NAME_INVISIBLE = /[\u0000-\u001f\u007f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/
// The Law covers SEPARATORS too — a keyboard's 。 and ASCII . are the same key
// pressed on different keyboards, so `tom。kray` and `tom.kray` are ONE name (see
// library.foldSeparators — the same fold IDNA/UTS #46 performs).
export function canonicalName(name: string): string {
  return foldSeparators(name).normalize('NFKC').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim()
}
// ── NO WHITESPACE INSIDE A NAME, EVER ────────────────────────────────────────
// A name is ONE SEQUENCE, like an ordinals name: `satoshi`, never `sato shi`.
// Leading/trailing whitespace is trimmed by the canonical form; what is refused
// is whitespace INSIDE — it removes a whole impersonation class by construction.
const NAME_INNER_SPACE = /\s/
/** Hard ceiling of a baptism field — 64 UTF-8 bytes. Same bound as the
 *  universal-keyboard regex. Over this is not a name: refuse before burn,
 *  so a hostile client cannot journal a megabyte string (door AND reducer). */
export const NAME_MAX_BYTES = 64
export function isValidName(name: string): boolean {
  if (NAME_INVISIBLE.test(name)) return false
  const c = canonicalName(name)
  // A name is ONE word, spelled out: ASCII letters and digits ONLY — no space, dot, @, hyphen,
  // bullet, punctuation, or confusable script. Every keyboard on Earth types the SAME bytes, so
  // no look-alike (Cyrillic а, a hidden dot, an @) can ever be baptised to shadow an existing name.
  return /^[a-z0-9]{1,64}$/.test(c)
}

/** A star's baptism — its user-given name, unique in the universe, permanent. */
export interface Baptism {
  star: string // canonical decimal string
  name: string
  seq: number
  by: string
  cursed: boolean
  cursedReason?: 'unowned' | 'name-taken' | 'already-named' | 'self-fee' | 'invalid-name' | 'impersonates'
}
