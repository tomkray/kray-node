/**
 * THE SETTLEMENT — verified beats become a reward table, deterministically.
 *
 * This is the piece that turns PROVEN presence into money, and it is pure: the same beacon, the same
 * beats, and the same fee-pool budget always produce the same table, so every node recomputes it and no
 * operator can write themselves a cent the law does not owe them.
 *
 * The composition is the whole point, and each layer carries its own guarantee:
 *
 *   1 · beat-pow.spanWork  — a validator's WORK is the sum of its best-verified beat per block. A beat's
 *       hash binds the Bitcoin-revealed beacon, the validator's OWN address and the block, so work cannot
 *       be pre-ground, copied, bought, or replayed; a block claimed twice counts once; a beat that does
 *       not verify proves 0. Work is real compute, measured, not a connection counted.
 *   2 · reward.splitFeePool — the pool splits LINEARLY by that work. Linear is the ONLY sybil-neutral
 *       weight: N split identities that together did work W earn EXACTLY what one honest worker of work W
 *       earns (each identity's beats must carry ITS address, so one machine mining for N names divides its
 *       hashrate N ways → W/N each → ΣW). Splitting yourself up buys nothing. Integer-exact to the unit.
 *
 * A validator whose beats prove nothing is simply absent from the table — never a zero-value payout.
 *
 * Pure and total: no clock, no I/O, no network. Custody (the atlas-possession multiplier, custody.ts) is
 * a later layer that scales a validator's work before the split; this module is the presence-only floor.
 */
import { spanWork, type BeatProof } from './beat-pow.ts'
import { splitFeePool, type Reward } from './reward.ts'
import { effectiveWork, CUSTODY_CHALLENGES } from './custody.ts'
import { assertPresenceClaims, assertPresenceEra, readPresenceTip, foldClaimsByAddress, BEAT_PAY_ZEROS_CAP, BEAT_PAY_CAP_LIFTED_FROM_SEQ, PRESENCE_WINDOW_FROM_SEQ } from './presence-window.ts'

/** Windowed settle: one KRAY height, zeros paid at most BEAT_PAY_ZEROS_CAP. */
export interface SettleFromBeatsOpts {
  /** Whole number ≥ 0, or omit. A string/bool is refused (W2-01). */
  presenceTip?: unknown
  /**
   * Journal seq of this settlement. Omit = fail-closed (treated as the live era):
   * a 30-block grind cannot hide in the pure function. Historical callers pass
   * seq < PRESENCE_WINDOW_FROM_SEQ.
   */
  seq?: number
}

/** One validator's claim for a seal: who they are, and the beats they submitted for the span. */
export interface ValidatorClaim {
  address: string
  beats: BeatProof[]
  /** CUSTODY (optional): how many atlas challenges this validator ANSWERED (0..K). Scales its work by
   *  (K + 2·hits): a pure-CPU guardian (0) sits at the baseline, a full-atlas guardian (K) earns 3×.
   *  The ledger re-derives hits from verifyCustody when the event is windowed (presenceTip); this
   *  field is the already-audited count settleFromBeats uses. Absent hits → the cancelling baseline. */
  hits?: number
}

/** What the settlement records for one validator — enough for any node to recompute and refute it. */
export interface SettlementLine {
  address: string
  /** the EFFECTIVE work the split used = base × (K + 2·hits) — base when custody is absent (× K, which cancels) */
  work: bigint
  /** the raw work its beats proved this span (Σ best-verified beat per block), before custody scaling */
  base: bigint
  /** how many atlas challenges it proved this span (0 when no custody) */
  hits: number
  /** the blocks it was present in (a beat verified), ascending — the audit trail behind `base` */
  blocks: number[]
  /** what the split paid it */
  paid: bigint
}

/**
 * SETTLE A SEAL FROM ITS BEATS. Returns the reward table AND the per-validator work trail, so the caller
 * can both credit the winners (Reward[]) and journal the proof (SettlementLine[]) that lets a follower
 * recompute the exact same table from the exact same beacon + beats. Deterministic and order-free: the
 * output is sorted, and splitFeePool breaks its own ties by address, so every node on earth agrees.
 */
export function settleFromBeats(beacon: string, budget: bigint, claims: ValidatorClaim[], opts?: SettleFromBeatsOpts): { rewards: Reward[]; lines: SettlementLine[] } {
  // 0 · block is a scarce index — HALT a grind (windowed tip, or historical cap).
  //     presenceTip is an integer or absent — a string is not the old path (W2-01).
  //     Duplicate rows for one address fold or HALT (W2-02).
  const presenceTip = readPresenceTip(opts?.presenceTip)
  const seq = opts?.seq === undefined ? PRESENCE_WINDOW_FROM_SEQ : opts.seq
  assertPresenceEra(seq, presenceTip)
  const folded = foldClaimsByAddress(claims)
  assertPresenceClaims(folded, presenceTip)
  const windowed = presenceTip !== undefined
  // V1 fix (dormant): the FLAT per-identity pay cap is the one thing that broke sybil-neutrality — 2^zeros is
  // neutral by itself (2^30 === 64×2^24), so the cap let a miner above it out-earn itself by splitting into N
  // addresses. Lift it AT/ABOVE the activation seq; BELOW it, clamp exactly as before so existing history is
  // byte-identical on replay. seq defaults fail-closed to the live era (line above), so absence keeps the cap.
  const capActive = windowed && seq < BEAT_PAY_CAP_LIFTED_FROM_SEQ
  const spanOpts = capActive ? { payZerosCap: BEAT_PAY_ZEROS_CAP } : undefined
  // 1 · verify each claim's beats → its (base) work + the blocks; scale by PROVEN custody, K + 2·hits.
  //     A claim proving nothing (0 base work) drops out — custody or not.
  const worked = folded
    .map((c) => {
      const sw = spanWork(beacon, c.address, c.beats, spanOpts)
      const hits = Number.isInteger(c.hits) && (c.hits as number) > 0 ? Math.min(c.hits as number, CUSTODY_CHALLENGES) : 0
      return { address: c.address, base: sw.work, hits, work: sw.work > 0n ? effectiveWork(sw.work, hits) : 0n, blocks: sw.blocks }
    })
    .filter((w) => w.work > 0n)
    .sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0))   // deterministic input order

  // 2 · split the pool LINEARLY by EFFECTIVE work (sybil-neutral, integer-exact)
  const rewards = splitFeePool(budget, worked.map((w) => ({ id: w.address, weight: w.work })))
  const paidOf = new Map(rewards.map((r) => [r.id, r.amount]))

  // 3 · the proof trail — every worker, its work (effective + base), custody, blocks, and what it was paid
  const lines: SettlementLine[] = worked.map((w) => ({ address: w.address, work: w.work, base: w.base, hits: w.hits, blocks: w.blocks, paid: paidOf.get(w.address) ?? 0n }))
  return { rewards, lines }
}
