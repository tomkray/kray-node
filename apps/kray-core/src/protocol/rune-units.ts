/**
 * RUNE UNITS — display ↔ base, exact integer. Never consensus.
 *
 * The edict's `divisibility` (0…38) is a DECIMAL POINT on THAT rune.
 * The reducer, the journal and the AMM see only atomic base units.
 * Extra digits the edict does not grant are refused, not rounded.
 *
 * ₭ has no point (div = 0). 1 ₭ = 1. There is no 1.5 ₭ — a fake ₭
 * decimal would invent an edict Bitcoin never etched. The rune is
 * what modularizes: 1 ₭ = 1.111 display-rune (floor at the edict,
 * leftover named). Asking "how many ₭ for 1 rune" approximates to
 * a whole ₭ (ceil), never a ₭ fraction.
 */
export const MAX_DIVISIBILITY = 38
export const KRAY_DIVISIBILITY = 0

export function assertDiv(div: number): number {
  if (!Number.isInteger(div) || div < 0 || div > MAX_DIVISIBILITY) {
    throw new Error('rune-units: divisibility must be an integer 0…38 (the edict)')
  }
  return div
}

/** Display string ("1.5") → atomic base units. Extra decimals → null. */
export function toBaseUnits(display: string, div: number): string | null {
  const d = assertDiv(div)
  const str = String(display || '').trim()
  if (!/^\d+(\.\d+)?$/.test(str)) return null
  const [whole, frac = ''] = str.split('.')
  if (frac.length > d) return null
  const padded = (frac + '0'.repeat(d)).slice(0, d)
  try {
    return (BigInt(whole) * (10n ** BigInt(d)) + BigInt(padded || '0')).toString()
  } catch {
    return null
  }
}

/** Atomic base units → display (no thousands sep). Trailing zeros stripped. */
export function fromBaseUnits(base: string | bigint, div: number): string {
  const d = assertDiv(div)
  let s = String(base ?? '0').replace(/[^0-9]/g, '') || '0'
  if (d <= 0) return BigInt(s).toString()
  while (s.length <= d) s = '0' + s
  const whole = s.slice(0, s.length - d).replace(/^0+(?=\d)/, '')
  const frac = s.slice(s.length - d).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

export type MidSpot = {
  /** Floor: display-rune per 1 ₭ at the edict point. */
  runePerKray: string
  /** Base units of rune per 1 ₭ (floor). */
  runeBasePerKray: bigint
  /** runeBase % kray — the leftover the floor dropped. */
  rem: bigint
  /** Whole ₭ that still fail to cover 1 display-rune. */
  krayFloorPerRune: bigint
  /** Whole ₭ that cover 1 display-rune (ceil). ₭ never has a point. */
  krayCeilPerRune: bigint
}

/**
 * Mid book, display-only. Replay never calls this.
 * 1500 ₭ + 1000 display-rune → 1 ₭ = 0.666… rune, 1 rune ≈ 2 ₭.
 * 1000 ₭ + 1111 display-rune (div 3) → 1 ₭ = 1.111 rune.
 */
export function midSpot(kray: bigint, runeBase: bigint, div: number): MidSpot | null {
  const d = assertDiv(div)
  if (kray <= 0n || runeBase <= 0n) return null
  const runeBasePerKray = runeBase / kray
  const rem = runeBase % kray
  const one = 10n ** BigInt(d)
  const krayFloorPerRune = (kray * one) / runeBase
  const krayRem = (kray * one) % runeBase
  const krayCeilPerRune = krayRem === 0n ? krayFloorPerRune : krayFloorPerRune + 1n
  return {
    runePerKray: fromBaseUnits(runeBasePerKray, d),
    runeBasePerKray,
    rem,
    krayFloorPerRune,
    krayCeilPerRune,
  }
}

export type PairSpot = {
  /** Floor: display-B per 1 display-A, at B's edict. */
  bPerDisplayA: string
  bBasePerDisplayA: bigint
  remB: bigint
  /** Floor: display-A per 1 display-B, at A's edict. */
  aPerDisplayB: string
  aBasePerDisplayB: bigint
  remA: bigint
  /** Ceil display-A that still covers 1 display-B (A's edict; never an invented point). */
  aCeilPerDisplayB: string
}

/**
 * Mid of a rune/rune book, display-only. Replay never calls this.
 * Each side uses THAT rune's edict. 1 GOLD (div 2) = N.nnnnn DOG (div 5).
 * midSpot is the special case divA = 0 (₭ has no point).
 */
export function pairSpot(baseA: bigint, divA: number, baseB: bigint, divB: number): PairSpot | null {
  const da = assertDiv(divA)
  const db = assertDiv(divB)
  if (baseA <= 0n || baseB <= 0n) return null
  const oneA = 10n ** BigInt(da)
  const oneB = 10n ** BigInt(db)
  const bBasePerDisplayA = (baseB * oneA) / baseA
  const remB = (baseB * oneA) % baseA
  const aBasePerDisplayB = (baseA * oneB) / baseB
  const remA = (baseA * oneB) % baseB
  const aCeilBase = remA === 0n ? aBasePerDisplayB : aBasePerDisplayB + 1n
  return {
    bPerDisplayA: fromBaseUnits(bBasePerDisplayA, db),
    bBasePerDisplayA,
    remB,
    aPerDisplayB: fromBaseUnits(aBasePerDisplayB, da),
    aBasePerDisplayB,
    remA,
    aCeilPerDisplayB: fromBaseUnits(aCeilBase, da),
  }
}
