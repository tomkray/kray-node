/**
 * KRAY-CORE — Honocracy: the governance voice equation.
 *
 * "Honra em primeiro pleno." Governance blends BOTH proofs, with honor in
 * command (founder's Honokray-C inscription #70,716,714, symbol ߜ — the
 * inverted pyramid: the broad base of the honest holds the force):
 *
 *   voice = BASE  +  w_g · √(Glow)  +  w_k · √( min( KRAY , C·Glow + K0 ) )
 *
 *   · BASE            every verified soul has a floor voice (inclusion — "all voices")
 *   · w_g · √(Glow)   HONOR — proof of work; the primary term (w_g > w_k)
 *   · w_k · √(…)      PARTICIPATION — proof of stake, but KRAY is CAPPED at C·Glow + K0,
 *                     so your money speaks only as loud as your honor allows. Glow
 *                     UNLOCKS how much KRAY counts → "Glow amplifies the weight of tokens."
 *
 * A whale with tokens and no work is capped at √K0 — it can never buy a maximum
 * position. Glow alone already governs strongly; Glow + KRAY is the most. The √
 * everywhere is the inverted pyramid: honor and money both dampen, the base wins.
 *
 * Integer-only (BigInt + integer √) so every node computes the SAME voice —
 * deterministic governance, no floating-point drift across machines or eras.
 */

/** Deterministic integer square root (Newton's method) — floor(√n). */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('honocracy: √ of a negative')
  if (n < 2n) return n
  let x = n
  let y = (x + 1n) / 2n
  while (y < x) { x = y; y = (x + n / x) / 2n }
  return x
}

export interface HonocracyParams {
  base: bigint // floor voice for every verified soul (inclusion)
  wg: bigint // honor weight (Glow) — the primary term
  wk: bigint // participation weight (KRAY) — secondary
  c: bigint // cap ratio: KRAY counts up to c·Glow …
  k0: bigint // … plus this floor, so KRAY-only still gets a small, capped voice
}

/**
 * Default balance (a starting point to tune by simulation, not decree). Honor
 * weighs 3× participation; a soul with zero Glow can leverage at most K0=100
 * KRAY; each unit of Glow unlocks C=10 more KRAY of participation weight.
 */
export const DEFAULT_HONOCRACY: HonocracyParams = { base: 1n, wg: 3n, wk: 1n, c: 10n, k0: 100n }

/** How much of an address's KRAY actually counts, gated by its Glow (honor). */
export function unlockedKray(glow: bigint, kray: bigint, p: HonocracyParams = DEFAULT_HONOCRACY): bigint {
  const cap = p.c * glow + p.k0
  return kray < cap ? kray : cap
}

/** The governance voice of an address, given its earned Glow and held KRAY. */
export function voice(glow: bigint, kray: bigint, p: HonocracyParams = DEFAULT_HONOCRACY): bigint {
  if (glow < 0n || kray < 0n) throw new Error('honocracy: negative glow/kray')
  const honor = p.wg * isqrt(glow)
  const participation = p.wk * isqrt(unlockedKray(glow, kray, p))
  return p.base + honor + participation
}

/** Transparent breakdown of a voice — for the explorer / display. */
export function voiceBreakdown(glow: bigint, kray: bigint, p: HonocracyParams = DEFAULT_HONOCRACY): {
  base: bigint; honor: bigint; unlockedKray: bigint; participation: bigint; total: bigint
} {
  const uk = unlockedKray(glow, kray, p)
  const honor = p.wg * isqrt(glow)
  const participation = p.wk * isqrt(uk)
  return { base: p.base, honor, unlockedKray: uk, participation, total: p.base + honor + participation }
}
