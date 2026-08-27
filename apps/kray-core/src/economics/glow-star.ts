/**
 * ✦ FROZEN-STAR GLOW — the soulbound reputation an address earns by FREEZING a star.
 *
 * A star sent to the keyless black hole (`transfer-star` to `BLACK_HOLE`) is frozen forever — it can never
 * move again (no signature encodes to that address). The address that let it go earns **1 glow per star**.
 *
 *   glow(A) = | { distinct stars A froze } |
 *
 * PURE — a function of the journal the cascade already commits (the burns and freezes are proven, 126/126),
 *   so any stranger re-derives the exact same glow on replay. No oracle, no new consensus rule; a derivation.
 * PERMANENT — it never decays. Freezing a star is an eternal, irreversible act; the honor of it is eternal too.
 * SOULBOUND — it is a TALLY OF PAST ACTS, not a balance. There is no event that moves glow between addresses,
 *   so reputation can only be EARNED by letting go — never bought, never transferred. (₭ and Ӿ are money; ✦ is
 *   honor. The glyph itself refuses a currency's mark.)
 *
 * ⚠ THE FARMING VECTOR AND ITS ANSWER (the Creator's own refinement — recorded, quality layer is future).
 * Raw count is game-able: an address could inscribe thousands of worthless stars and freeze them to farm glow.
 * That is ALLOWED — but self-defeating, because every frozen star stays VISIBLE FOREVER in the atlas, so the
 * community can SEE and JUDGE the *quality* of a wallet's glow. Farming junk earns a "DARK GLOW" the community
 * reads at a glance and (later) votes on — each person voting with their own glow. So the real reputation is
 * COUNT × QUALITY, and the quality is socially verified by transparency, not by this function. This file is the
 * honest RAW metric only; the DARK-GLOW / peer-vote layer rides on top (see docs/GLOW-AND-X.md). We record the
 * thought so the path to resolve it is always here.
 */
import { BLACK_HOLE } from '../protocol/kray-primitives.ts'

/** The glyph of glow — a star's shine, deliberately NOT a currency mark (glow is reputation, never money). */
export const GLOW_SYMBOL = '✦'

/** The minimum an event must carry for this pure derivation — a slice of KrayEvent. */
export interface StarMoveEvent { kind: string; to?: string; from?: string; star?: number | string | null }

/**
 * FROZEN-STAR GLOW per address — `Map<address, count of distinct stars it froze>`. A star freezes at most once
 * (the black hole is keyless), so a repeated event for the same star never double-counts.
 */
export function frozenStarGlow(events: Iterable<StarMoveEvent>): Map<string, number> {
  const seen = new Set<string>() // a star counts once, ever
  const glow = new Map<string, number>()
  for (const e of events) {
    if (e.kind !== 'transfer-star' || e.to !== BLACK_HOLE || typeof e.from !== 'string' || e.star == null) continue
    const star = String(e.star)
    if (seen.has(star)) continue
    seen.add(star)
    glow.set(e.from, (glow.get(e.from) ?? 0) + 1)
  }
  return glow
}

/** One address's ✦ glow — the count of stars it froze; 0 if it never froze one. Pure, permanent, un-buyable. */
export function glowOf(events: Iterable<StarMoveEvent>, address: string): number {
  return frozenStarGlow(events).get(address) ?? 0
}
