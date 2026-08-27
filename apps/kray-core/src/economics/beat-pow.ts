/**
 * THE BEAT PROOF — work that costs something, measured in one hash.
 *
 * Presence used to be a constant. A guardian was credited GUARD_PTS for being
 * reachable, so "work" measured nothing scarcer than a timer and an open port:
 * a hundred idle processes claimed a hundred times the work of one honest
 * machine. A network cannot pay for effort it never asked anyone to spend.
 *
 * So a beat now carries a proof of work, and the measure is the one Bitcoin uses
 * on itself:
 *
 *     H = sha256("kray-core.beat.v1|" ‖ beacon ‖ address ‖ block ‖ nonce)
 *     work = 2 ^ (leading zero bits of H)
 *
 * ONE eight-byte nonce, ONE hash to verify, and the number that comes out is —
 * in expectation — the count of hashes it took to find. Best-of-C attempts has
 * about log₂(C) leading zeros, so 2^zeros ≈ C: the guardian submits their best
 * nonce for a block and the chain learns how much compute stood behind it,
 * without ever transmitting the search. Variance is high per block and vanishes
 * across a span, exactly as it does for a miner across many blocks.
 *
 * ── WHAT THE CHALLENGE IS BOUND TO, AND WHY EACH PART ───────────────────────
 *   beacon   the Bitcoin block hash of the open seal. Nobody can grind before
 *            Bitcoin reveals it, so work cannot be stockpiled in advance.
 *   address  the guardian's own identity. One machine's solution is worthless
 *            to another, so work cannot be bought, copied or shared.
 *   block    the KRAY height being attested. A solution proves presence AT A
 *            MOMENT and cannot be replayed into another one. The index is
 *            scarce: a windowed settlement (presenceTip) pays only the live
 *            tip — see presence-window.ts. It is not a free grinding axis.
 *
 * ── THE HONEST LIMIT OF THIS FILE ───────────────────────────────────────────
 * Measuring work makes `work` REAL. It does NOT, by itself, make identity
 * scarce, and it is worth stating plainly rather than discovering later: with a
 * √-weighted split, dividing one machine's work across N free identities
 * multiplies its weight by √N — measured or not. Only a LINEAR weight is
 * sybil-neutral, because only a linear function satisfies N·f(W/N) = f(W).
 * Concavity is what protects small validators, and it is the very thing that
 * rewards splitting; the two cannot both be had while identities are free.
 * That choice belongs to the network's economics, not to this module — this
 * module only makes sure that whatever the weight is, it is applied to work
 * somebody actually spent.
 *
 * Pure and total: node:crypto only, integers only, no clock, no network.
 */
import { createHash } from 'node:crypto'

/** How many leading zero bits a beat must have to count at all. Below this, a
 *  claim is noise: at 8 bits an honest laptop finds a solution instantly, so the
 *  floor excludes nothing real while refusing the zero-effort claim. */
export const BEAT_MIN_ZEROS = 8
/** The cap on measured work, so one lucky hash cannot claim the universe.
 *  2^64 is astronomically above any honest beat and still finite. */
export const BEAT_MAX_ZEROS = 64

/** The exact bytes a beat commits to — bound to the seal, the person and the moment. */
export function beatMessage(beacon: string, address: string, block: number, nonce: bigint): string {
  return `kray-core.beat.v1|${beacon}|${address}|${block}|${nonce}`
}

/** The beat's hash. One sha256, and it is the whole verification. */
export function beatHash(beacon: string, address: string, block: number, nonce: bigint): Buffer {
  return createHash('sha256').update(beatMessage(beacon, address, block, nonce), 'utf8').digest()
}

/** Leading zero BITS of a digest — the honest reading of how hard it was. */
export function leadingZeroBits(digest: Buffer): number {
  let bits = 0
  for (const byte of digest) {
    if (byte === 0) { bits += 8; continue }
    for (let m = 0x80; m > 0; m >>= 1) {
      if (byte & m) return bits
      bits++
    }
    return bits
  }
  return bits
}

/**
 * THE WORK A BEAT PROVES: 2^zeros, capped. This is the expected number of hashes
 * behind that nonce, so summing it across a span measures compute rather than
 * counting connections.
 */
export function beatWork(zeros: number): bigint {
  if (!Number.isInteger(zeros) || zeros < BEAT_MIN_ZEROS) return 0n
  return 1n << BigInt(Math.min(zeros, BEAT_MAX_ZEROS))
}

export interface BeatProof { block: number; nonce: string; zeros: number }

/** Optional span law — windowed settlements ignore foreign blocks and cap paid zeros. */
export interface SpanWorkOpts {
  /** When set, only this KRAY height counts. Other blocks add 0 (the reducer HALTs first). */
  onlyBlock?: number
  /** After verify, pay at most 2^cap. Does not change whether the beat is real. */
  payZerosCap?: number
}

/**
 * VERIFY ONE BEAT, from bytes. Returns the work it proves, or 0n — never a
 * guess, and never an exception for a malformed claim: a beat that does not
 * verify simply proved nothing, which is the same thing as not beating.
 */
export function verifyBeat(beacon: string, address: string, proof: BeatProof): bigint {
  if (!/^[0-9a-f]{64}$/.test(beacon)) return 0n
  if (!Number.isInteger(proof.block) || proof.block < 0) return 0n
  if (!/^\d{1,20}$/.test(proof.nonce)) return 0n
  if (!Number.isInteger(proof.zeros) || proof.zeros < BEAT_MIN_ZEROS || proof.zeros > 256) return 0n
  const actual = leadingZeroBits(beatHash(beacon, address, proof.block, BigInt(proof.nonce)))
  // the CLAIM must not exceed the truth; claiming less than you found is allowed
  // and simply pays less, so there is never an incentive to lie downward
  if (actual < proof.zeros) return 0n
  return beatWork(proof.zeros)
}

/**
 * MINE A BEAT — what a guardian's own machine runs, wherever it lives. Spend as
 * many hashes as you choose; the best nonce found is the one worth submitting,
 * and the chain will read your effort out of it.
 *
 * `budget` is a hash count, not a time: the same budget does the same work on
 * every machine, so a test is reproducible and a client is honest about cost.
 */
export function mineBeat(beacon: string, address: string, block: number, budget: number, startNonce = 0n): BeatProof | null {
  let best: BeatProof | null = null
  for (let i = 0; i < budget; i++) {
    const nonce = startNonce + BigInt(i)
    const zeros = leadingZeroBits(beatHash(beacon, address, block, nonce))
    if (zeros >= BEAT_MIN_ZEROS && (best === null || zeros > best.zeros)) {
      best = { block, nonce: nonce.toString(), zeros }
    }
  }
  return best
}

/**
 * THE WORK OF A SPAN: every beat verified, summed. A block claimed twice counts
 * ONCE — the highest of the two — because presence is a fact about a moment, not
 * a quantity a claimant can repeat.
 */
export function spanWork(beacon: string, address: string, proofs: BeatProof[], opts?: SpanWorkOpts): { work: bigint; blocks: number[] } {
  const bestPerBlock = new Map<number, bigint>()
  for (const p of proofs) {
    if (opts?.onlyBlock != null && p.block !== opts.onlyBlock) continue
    const w = verifyBeat(beacon, address, p)
    if (w === 0n) continue
    const paidZeros = opts?.payZerosCap != null ? Math.min(p.zeros, opts.payZerosCap) : p.zeros
    const paid = beatWork(paidZeros)
    const prev = bestPerBlock.get(p.block) ?? 0n
    if (paid > prev) bestPerBlock.set(p.block, paid)
  }
  let work = 0n
  for (const w of bestPerBlock.values()) work += w
  return { work, blocks: [...bestPerBlock.keys()].sort((a, b) => a - b) }
}
