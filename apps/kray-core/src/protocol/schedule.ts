/**
 * The two credibly-neutral constants KRAYNET still derives from Bitcoin.
 *
 * KRAYNET mints only by proof-of-donation (no fixed supply curve, no halving
 * ladder, no premine), so there is no emission schedule. Two Bitcoin-anchored
 * numbers remain, each with exactly one consumer:
 *
 *   · SEAL_CONFIRMATIONS — how deep a seal must be before it is trusted (consensus.ts)
 *   · CODEX_CEILING      — the practical upper bound the star-lore Codex computes its
 *                          number-theory traits against (star-lore.ts). Stars are
 *                          numbered by creation order with NO hard cap; this is only a
 *                          credibly-neutral large ceiling (Bitcoin's total satoshi count,
 *                          used as a plain number) so the trait math stays well-defined.
 *
 * Pure, BigInt-only: no float ever touches a unit.
 */

/**
 * A seal must be CONFIRMED before its settlement is trusted. Two blocks costs
 * ~20 minutes and removes the common shallow-reorg case; trusting at one
 * confirmation would risk acting on a seal that then vanished.
 */
export const SEAL_CONFIRMATIONS = 2n

/** A credibly-neutral large ceiling for the star Codex's number-theory traits —
 *  Bitcoin's total satoshi count, used purely as a number (NOT a supply cap;
 *  KRAYNET has no fixed supply — ₭ is fungible, minted by donation, burned by fire). */
export const CODEX_CEILING = 2_100_000_000_000_000n
