/**
 * THE BITCOIN-SEEDED VALIDATOR RAFFLE — the surplus of a donation (the real sats beyond what the anchor itself
 * carries) goes to ONE guardian, chosen by Bitcoin's own block hash and WEIGHTED BY PROVEN WORK.
 *
 * Why it can exist keyless: the donor pays the winner DIRECTLY in their own donation transaction. There is no pool,
 * no escrow, no custodian — the winner is a pure function of (beacon, validator set), which the donor computes and
 * every node re-derives and verifies. Nobody holds a key; nobody can redirect it.
 *
 * Why it is FAIR:
 *   · UNBIASABLE — the draw comes from the Bitcoin block hash (the beacon). To steer it you would have to re-mine
 *     Bitcoin. It is address-independent, so it cannot be ground per-candidate either.
 *   · SYBIL-NEUTRAL — a guardian's chance is EXACTLY work/totalWork. Splitting work W into N identities of W/N
 *     gives N disjoint intervals whose lengths still sum to W, so the total probability is unchanged: W/total.
 *     Sybils gain nothing — the same linear law that makes the KRAY fee split sybil-neutral makes this raffle so.
 *   · DETERMINISTIC — canonical order (by address) → every node names the SAME winner from the same inputs.
 *
 * The honest limit: the beacon that seeds the draw must be known when the donor builds the transaction (you cannot
 * pay a winner chosen by a FUTURE block without a key to release the funds later). So the winner is public at
 * donation time, not secret — but it is unbiasable, and with thousands of work-weighted guardians a donor cannot
 * practically wait for a beacon that favors a chosen friend. Secrecy would require a KRAY-denominated prize seeded
 * by the CONFIRMING block; a real-satoshi prize is necessarily beacon-at-build-time.
 *
 * Pure, integer-only, offline. It names a winner; it moves nothing.
 */
import { createHash } from 'node:crypto'

export interface RaffleEntry {
  /** the guardian's payout address (its identity in the draw) */
  address: string
  /** the PROVEN work behind it this round — the weight, exactly as the fee split uses */
  work: bigint
}

/** The uniform draw in [0, totalWork) that the Bitcoin beacon fixes — address-independent, unbiasable. */
export function raffleDraw(beacon: string, totalWork: bigint): bigint {
  if (!/^[0-9a-f]{64}$/i.test(beacon)) throw new Error('raffle: the beacon must be a 32-byte Bitcoin block hash (hex)')
  if (totalWork <= 0n) throw new Error('raffle: total work must be positive')
  const h = createHash('sha256').update(`kray.raffle.v1|${beacon.toLowerCase()}`, 'utf8').digest('hex')
  return BigInt('0x' + h) % totalWork
}

/**
 * THE WINNER — the guardian whose work interval contains the beacon's draw. Weighted by work, canonical, total.
 * Returns null only for an empty/zero-work set (nobody did work → nobody wins; the surplus falls back to a burn).
 */
export function raffleWinner(beacon: string, entries: RaffleEntry[]): string | null {
  const live = entries.filter((e) => e.work > 0n)
  const total = live.reduce((s, e) => s + e.work, 0n)
  if (total <= 0n) return null
  const draw = raffleDraw(beacon, total)
  // canonical order so every node crosses the SAME threshold at the SAME candidate
  const sorted = [...live].sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0))
  let acc = 0n
  for (const e of sorted) { acc += e.work; if (draw < acc) return e.address }
  return sorted[sorted.length - 1].address // unreachable (draw < total), but never a silent undefined
}

/** A guardian's exact probability of winning — work/totalWork. Pure, for auditing and for the sybil proof. */
export function winProbability(work: bigint, totalWork: bigint): number {
  if (totalWork <= 0n) return 0
  return Number(work) / Number(totalWork)
}
