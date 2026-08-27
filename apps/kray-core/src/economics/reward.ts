/**
 * KRAY-CORE — the fee-pool split: the fees gathered under a seal → the validators
 * who did the WORK this window, weighted LINEARLY by that work. Bitcoin-standard:
 * you earn by the work you do NOW — like a miner's hashpower share this block —
 * not by an accumulated reputation. (v2 note: ₭ is born only by proof-of-donation,
 * never by an emission schedule — the retired per-interval subsidy is gone; what is
 * split here is the CONSERVED fee pool, moved from payers to workers, never minted.)
 *
 * Glow (the soulbound reputation, `glow.ts`) is deliberately kept OUT of this
 * math: it is a SEPARATE governance/prestige layer, so the core reward stays
 * pure Bitcoin and can never be corrupted by a reputation input.
 *
 * The seal meters WHEN a payout closes; this says WHO gets it:
 * each validator's share ∝ their work this window. LINEAR
 * is the ONLY sybil-neutral weight — N split identities that together did work W
 * earn EXACTLY what one honest worker of work W earns, so splitting yourself into
 * many names buys nothing. A concave √-weight does the OPPOSITE of its intent:
 * N·√(W/N) = √(NW) > √W, so it PAYS a whale to wear the costume of a crowd. Only
 * f linear satisfies N·f(W/N) = f(W). Integer-exact: the whole subsidy is
 * distributed to the unit (largest-remainder gives the dust to the highest-weight
 * validator), so conservation is perfect. (Mirrors splitFeePool below.)
 */

export interface Validator { id: string; weight: bigint }
export interface Reward { id: string; amount: bigint }

/**
 * Split `subsidy` among `validators` by weight = work done this interval, LINEARLY
 * (sybil-neutral — see the file header). A validator with zero work earns nothing
 * this interval. Returns [] if there is nothing to split or no worker — the subsidy
 * then simply stays in the vault.
 */
/**
 * THE INDIVISIBLE SPLIT — distribute an integer `total` among `validators` by weight, LINEARLY, to the
 * unit. KRAY has 0 decimals, so integer floors never sum to `total`; largest-remainder (Hamilton) hands
 * the leftover whole units, ONE each, to the fractional shares closest to rounding up. Σ shares == total
 * EXACTLY (never a unit created or stranded). Deterministic and order-free:
 *   · repeated ids are MERGED (one id = one participant whose weight is the sum) — the unique-id assumption
 *     made explicit, so the dust tiebreak is a STRICT TOTAL ORDER over distinct ids;
 *   · negative weights clamp to 0; zero-weight/empty/total≤0 pay nothing (the pot simply stays);
 *   · dust ties break by higher weight, then id ascending, with a proper antisymmetric comparator
 *     (a===b ⇒ 0) so every node on earth resolves them identically.
 */
function largestRemainderSplit(total: bigint, validators: Validator[]): Reward[] {
  if (total <= 0n || validators.length === 0) return []
  // merge by id (sum weights), clamp negatives to 0, drop zero-weight — insertion order = first appearance,
  // so the raw output order is unchanged for the (normal) unique-id case; a duplicate id is now ONE row.
  const merged = new Map<string, bigint>()
  for (const v of validators) { const w = v.weight < 0n ? 0n : v.weight; if (w > 0n) merged.set(v.id, (merged.get(v.id) ?? 0n) + w) }
  const weighted = [...merged].map(([id, w]) => ({ id, w }))
  if (weighted.length === 0) return []
  const totalW = weighted.reduce((a, v) => a + v.w, 0n)   // > 0: every w > 0 and at least one exists
  const parts = weighted.map((v) => ({ id: v.id, w: v.w, amount: (total * v.w) / totalW, rem: (total * v.w) % totalW }))
  const distributed = parts.reduce((a, r) => a + r.amount, 0n)
  let dust = total - distributed // 0 ≤ dust < weighted.length — whole units, never a fraction (KRAY is indivisible)
  if (dust > 0n) {
    const order = [...parts].sort((a, b) => (a.rem !== b.rem ? (b.rem > a.rem ? 1 : -1) : a.w !== b.w ? (b.w > a.w ? 1 : -1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    for (let i = 0; dust > 0n; i++, dust--) order[i].amount += 1n
  }
  return parts.filter((r) => r.amount > 0n).map((r) => ({ id: r.id, amount: r.amount }))
}

/**
 * Split `subsidy` among `validators` by weight = work done this interval, LINEARLY (sybil-neutral — see the
 * file header). A validator with zero work earns nothing; returns [] if there is nothing to split or no worker.
 */
export function splitSubsidy(subsidy: bigint, validators: Validator[]): Reward[] { return largestRemainderSplit(subsidy, validators) }

/** Σ of a reward split — must equal the subsidy that was split (or 0 if none). */
export function totalRewarded(rewards: Reward[]): bigint {
  return rewards.reduce((a, r) => a + r.amount, 0n)
}

/**
 * THE v2 REWARD — distribute an accumulated FEE POOL among the validators who did the WORK,
 * proportional to that work, LINEARLY. Linear is the ONLY sybil-neutral weight: N split
 * identities that together did work W earn exactly what one honest worker of work W earns, so
 * splitting yourself up buys nothing (a √-weight would reward it). The pool here is the collected
 * 1-₭ fees — ₭ already in circulation, MOVED from the Treasury to the workers, never minted — so
 * this settles the donation-funded model with no emission. Integer-exact via largest-remainder
 * (Hamilton), deterministic, and re-derivable: the same pool + the same work always yields the
 * same table, which is exactly why a settlement can be PROVEN rather than merely trusted.
 */
export function splitFeePool(pool: bigint, validators: Validator[]): Reward[] { return largestRemainderSplit(pool, validators) }
