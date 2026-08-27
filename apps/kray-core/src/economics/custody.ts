/**
 * CUSTODY — the MASTER GUARDIAN's proof that it really holds the atlas.
 *
 * Presence proves a guardian offered its machine. It does NOT prove the guardian
 * keeps the content the network exists to preserve. So the reward gains a second
 * dimension, and it is PROVEN rather than declared:
 *
 *   challenge_i = H(beacon ‖ address ‖ i) mod atlasSize    — which content to prove
 *   answer_i    = sha256(bytes ‖ beacon ‖ address)         — only the holder can produce
 *   effective work = base × (K + 2·hits)                   — CPU-only 1×, full atlas 3×
 *
 * WHY EACH PIECE IS THE WAY IT IS
 *
 * · The beacon is the REAL Bitcoin block hash of the seal. Nobody — not even the
 *   node — knows the challenges before that block exists, so they cannot be
 *   ground, pre-computed or steered. To bias them you would have to re-mine
 *   Bitcoin. It also makes yesterday's answers worthless today (no replay).
 * · The answer is SALTED WITH THE ADDRESS: one guardian's answer never works for
 *   another, so a correct answer cannot be copied off the wire or bought once.
 * · Coverage is CONTINUOUS, not a badge. Two tiers would create an edge to game;
 *   a straight line pays exactly what is actually held: half the atlas, half the
 *   bonus. A rotting disk needs no accusation — its coverage simply falls.
 * · The row carries a HIT BITMAP + ONE AGGREGATE hash (33 bytes, not 8×32): the
 *   verifier recomputes the answers for the claimed hits and compares the single
 *   aggregate. Claim a hit you cannot answer and the aggregate breaks. Compact
 *   AND unforgeable — capacity was measured once and is not spent twice.
 *
 * WHAT THIS KILLS, AND WHAT IT ONLY MAKES EXPENSIVE (the honest border — the
 * same border Bitcoin's own whitepaper draws around the 51%):
 * · KILLED BY MATHEMATICS: claiming content you lack, partial coverage sold as
 *   full, forged/copied/replayed answers, a corrupted store, and any settlement
 *   whose table does not follow from the claims.
 * · MERELY EXPENSIVE (until v2's address-salted replicas): one disk behind many
 *   identities, and streaming the bytes from someone else at challenge time —
 *   both cost more bandwidth than simply storing the atlas.
 *
 * Pure, total, integer-only. No float ever touches a weight.
 */
import { createHash } from 'node:crypto'
import { verifyBeat } from './beat-pow.ts'

const sha256 = (b: Buffer): Buffer => createHash('sha256').update(b).digest()
const hex = (b: Buffer): string => b.toString('hex')

/** How many contents a guardian is challenged on per seal. A sample, not an
 *  audit: 8 keeps the row tiny while making sustained fakery hopeless, and the
 *  law of large numbers makes coverage converge over a day of seals. */
export const CUSTODY_CHALLENGES = 8

/**
 * WHAT A PROVEN MASTER EARNS relative to a pure machine — in PAYOUT, the only
 * number anyone cares about. The split is LINEAR now (the only sybil-neutral
 * curve), so weight and payout are the SAME quantity: this constant IS the
 * payout multiple, delivered exactly. (History: under the retired √-weighted
 * split a 3 here paid only 1.714× — a multiplier applied to weight arrived
 * square-rooted at the wallet. That era is gone. DO NOT re-square this constant:
 * under the linear split, squaring would OVERPAY custody by 3×.)
 *
 * ⚠ THIS 3 IS A LAUNCH PLACEHOLDER CAP, NOT AN ATEMPORAL/DERIVED TRUTH.
 * A four-lens tribunal (2026-08-14) proved it: today it is INERT (an empty atlas
 * forces hits→0, and a uniform custody field cancels the multiplier inside the
 * linear split — pay 1× or 3×, the wallet is identical). At scale a FIXED number
 * cannot be right: a master's real cost (disk, and above all EGRESS to SERVE the
 * bytes) grows with the atlas while the ₭-denominated presence reward falls ~1/N,
 * so the correct ratio C_custody/R_baseline is not constant. The studied fix (not
 * yet built, the Creator's call) is: (a) let CUSTODY_CHALLENGES breathe with
 * atlasSize so faking-by-streaming stays ≥ the cost of honestly storing; (b) bind
 * the premium above 1× to PROVEN SERVICE, not mere possession (answer peers'
 * challenge-time GETs) — today custody attests read-at-proof-time only, so a lazy
 * master who HOLDS but never SERVES still earns; (c) make the multiplier a
 * RETARGETED OUTPUT whose setpoint is a fixed REDUNDANCY (a few served replicas of
 * the WORST-covered content), banded low [1, ~2], on the 1008-seal ÷2..×2 cadence,
 * keyed on proven coverage from the settlement lines — NEVER on the count of
 * master identities (one disk behind many salted names would fake abundance).
 * The invariant to hold is "≈R served copies of every star exist," not "masters
 * earn 3×". Fresh genesis ⇒ changing this costs nothing; decided, not defaulted.
 */
export const CUSTODY_PAYOUT_FACTOR = 3
/**
 * The WEIGHT factor that delivers CUSTODY_PAYOUT_FACTOR at the wallet.
 *
 * It was the SQUARE of the payout factor while the split weighed √work. The
 * split is linear now — the only sybil-neutral curve — so weight and payout are
 * the same quantity again and the square would overpay by 3×. The intent stays
 * the constant; only the arithmetic between intent and delivery changed.
 */
export const CUSTODY_FULL_FACTOR = CUSTODY_PAYOUT_FACTOR

/**
 * THE CHALLENGES for one guardian at one seal — indexes into the atlas, in
 * order. Deterministic and reproducible by anyone with the beacon: the auditor
 * derives the same list a century from now.
 */
export function custodyChallenges(beacon: string, address: string, atlasSize: number, k = CUSTODY_CHALLENGES): number[] {
  if (!/^[0-9a-f]{64}$/.test(beacon)) throw new Error('custody: the beacon must be a 32-byte Bitcoin block hash (hex)')
  if (!Number.isInteger(atlasSize) || atlasSize < 0) throw new Error('custody: atlasSize must be a whole count')
  if (atlasSize === 0) return [] // an empty atlas asks nothing of anyone
  const out: number[] = []
  for (let i = 0; i < k; i++) {
    const h = sha256(Buffer.from(`kray-core.custody-challenge.v1|${beacon}|${address}|${i}`, 'utf8'))
    // 6 bytes of entropy per pick — the modulo bias over any real atlas is
    // vanishing, and the derivation stays trivially reproducible by hand
    out.push(h.readUIntBE(0, 6) % atlasSize)
  }
  return out
}

/** The answer only a holder of these exact bytes can produce, bound to this
 *  seal (beacon) and this guardian (address) — never transferable, never reusable. */
export function custodyAnswer(bytes: Uint8Array, beacon: string, address: string): string {
  return hex(sha256(Buffer.concat([Buffer.from(bytes), Buffer.from(`|${beacon}|${address}`, 'utf8')])))
}

/** Pack which challenges were answered into a bitmap, LSB-first (K bits). */
export function packHits(hits: boolean[]): string {
  const out = Buffer.alloc(Math.ceil(hits.length / 8))
  for (let i = 0; i < hits.length; i++) if (hits[i]) out[i >> 3] |= 1 << (i & 7)
  return hex(out)
}
export function unpackHits(bitmapHex: string, k: number): boolean[] {
  if (!/^[0-9a-f]*$/.test(bitmapHex) || bitmapHex.length % 2 !== 0) throw new Error('custody: hit bitmap must be canonical hex')
  const b = Buffer.from(bitmapHex, 'hex')
  const out: boolean[] = []
  for (let i = 0; i < k; i++) out.push((((b[i >> 3] ?? 0) >> (i & 7)) & 1) === 1)
  return out
}

/** The ONE aggregate over the answers a guardian claims to have — order-fixed,
 *  domain-separated, so a set of answers commits to exactly one 32-byte value. */
export function aggregateAnswers(answers: string[]): string {
  return hex(sha256(Buffer.from('kray-core.custody-aggregate.v1|' + answers.join('|'), 'utf8')))
}

/** One guardian's custody claim, as the journal carries it: hits + aggregate. */
export interface CustodyClaim {
  /** LSB-first bitmap of which challenges were answered (K bits) */
  hits: string
  /** sha256 over the answers for exactly those hits, in challenge order */
  aggregate: string
}

/** The claim as ONE compact hex field for the settlement row (33 bytes at K=8). */
export const custodyToHex = (c: CustodyClaim): string => c.hits + c.aggregate
export function custodyFromHex(s: string, k = CUSTODY_CHALLENGES): CustodyClaim {
  const hitBytes = Math.ceil(k / 8)
  if (!/^[0-9a-f]*$/.test(s) || s.length !== (hitBytes + 32) * 2) throw new Error('custody: claim must be the canonical hits+aggregate hex')
  return { hits: s.slice(0, hitBytes * 2), aggregate: s.slice(hitBytes * 2) }
}

/** How many contents a guardian proved it holds. Total and pure. */
export function hitCount(claim: CustodyClaim, k = CUSTODY_CHALLENGES): number {
  return unpackHits(claim.hits, k).filter(Boolean).length
}

/**
 * THE EFFECTIVE WORK — base work scaled by proven custody, exact integers.
 * Zero hits (a pure CPU guardian) → base × K. Every content proved → base × 3K.
 * Nothing is invented: with no atlas to guard, everyone sits at base × K and the
 * split is exactly what it was before this law existed.
 */
export function effectiveWork(baseWork: bigint, hits: number, k = CUSTODY_CHALLENGES): bigint {
  if (baseWork < 0n) throw new Error('custody: negative work')
  if (!Number.isInteger(hits) || hits < 0 || hits > k) throw new Error('custody: hits out of range')
  return baseWork * BigInt(k + (CUSTODY_FULL_FACTOR - 1) * hits)
}

/** What the node/auditor needs to check a claim: the atlas (content hashes, in
 *  the ONE canonical order) and a way to read bytes — `null` when this node does
 *  not hold that content. A verifier without bytes says so; it never guesses. */
export interface AtlasOracle {
  /** every inscribed contentHash, canonical order (the journal's own order) */
  contents: string[]
  /** the exact bytes of a content, or null if this node does not keep it */
  bytesOf(contentHash: string): Uint8Array | null
}

export interface CustodyVerdict {
  /** the claimed aggregate is EXACTLY the one the claimed hits produce */
  exact: boolean
  /** every challenged content this verifier could actually read */
  checkable: number
  /** the claim asserts this many hits */
  claimedHits: number
  reason?: 'bytes-missing' | 'aggregate-mismatch' | 'malformed' | 'hit-unreadable'
}

/**
 * VERIFY A CUSTODY CLAIM — recompute the answers for the claimed hits and
 * compare the single aggregate.
 *
 * FAIL-CLOSED ON A PROVABLE LIE, HONEST ABOUT WHAT IT CANNOT SEE. A verifier
 * that holds the challenged bytes and finds a different aggregate has found a
 * lie, not an opinion — that settlement must never apply. A verifier that does
 * NOT hold some challenged content cannot judge those bits: it reports
 * `bytes-missing` (and `checkable`) instead of quietly approving. This is why
 * the guardians who keep the atlas are also the network's auditors: to audit
 * custody you must custody.
 */
export function verifyCustody(claim: CustodyClaim, beacon: string, address: string, oracle: AtlasOracle, k = CUSTODY_CHALLENGES): CustodyVerdict {
  let hitsBits: boolean[]
  try { hitsBits = unpackHits(claim.hits, k) } catch (_) { return { exact: false, checkable: 0, claimedHits: 0, reason: 'malformed' } }
  if (!/^[0-9a-f]{64}$/.test(claim.aggregate)) return { exact: false, checkable: 0, claimedHits: 0, reason: 'malformed' }
  const claimedHits = hitsBits.filter(Boolean).length
  const idx = custodyChallenges(beacon, address, oracle.contents.length, k)
  if (idx.length === 0) {
    // no atlas: the only honest claim is zero hits over an empty answer set
    const exact = claimedHits === 0 && claim.aggregate === aggregateAnswers([])
    return { exact, checkable: 0, claimedHits, ...(exact ? {} : { reason: 'aggregate-mismatch' as const }) }
  }
  const answers: string[] = []
  let checkable = 0
  for (let i = 0; i < idx.length; i++) {
    const hash = oracle.contents[idx[i]]
    const bytes = oracle.bytesOf(hash)
    if (bytes !== null) checkable++
    if (!hitsBits[i]) continue // not claimed — nothing to prove for this challenge
    if (bytes === null) return { exact: false, checkable, claimedHits, reason: 'hit-unreadable' }
    answers.push(custodyAnswer(bytes, beacon, address))
  }
  const exact = aggregateAnswers(answers) === claim.aggregate
  return { exact, checkable, claimedHits, ...(exact ? {} : { reason: 'aggregate-mismatch' as const }) }
}

/**
 * BUILD an honest claim from what this machine actually holds — what a guardian
 * client runs. It answers only what it can read; nothing is invented.
 */
export function buildCustodyClaim(beacon: string, address: string, oracle: AtlasOracle, k = CUSTODY_CHALLENGES): CustodyClaim {
  const idx = custodyChallenges(beacon, address, oracle.contents.length, k)
  const hits: boolean[] = []
  const answers: string[] = []
  for (const at of idx) {
    const bytes = oracle.bytesOf(oracle.contents[at])
    hits.push(bytes !== null)
    if (bytes !== null) answers.push(custodyAnswer(bytes, beacon, address))
  }
  return { hits: packHits(hits), aggregate: aggregateAnswers(answers) }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTANGLED PREMIUM (v2) — proof-of-retrievability, UNGRINDABLE. Additive + dormant.
//
// The v1 premium above (challenge_i = H(beacon‖address‖i), a FIXED set of K indices per address) is a
// SEPARABLE claim: a partial holder of fraction f can address-GRIND — try payout addresses until those K
// fixed indices all land in the fraction it holds — and fake full coverage in ~1/f^K tries (a 50% holder
// fakes 100% in ~256). See RESIDUAL-VECTORS.md · V2/V4-possession, proven live in the anti-grind sim.
//
// THE FIX (why it is ungrindable): a PREMIUM BEAT reads the atlas at an index derived from its OWN PoW
// NONCE — premiumIndex(beacon, address, nonce) — and is valid ONLY if the miner holds that exact block. For
// ANY fixed address, as the nonce varies the index sweeps the atlas UNIFORMLY, so a fraction-f holder can
// complete valid premium beats at rate EXACTLY f. Grinding the address cannot concentrate the indices (they
// are per-nonce and unbounded, not a fixed set of K), and to even KNOW an index you must pay the hash that
// reveals it — so filtering is not free. Effective premium ∝ f: linear, exact, ungrindable.
//
// It is a SEPARATE dimension from presence, so the CPU-only guardian (f = 0) keeps its full base presence
// reward and simply earns no premium — the 1-click lottery is untouched. It is wired NOWHERE yet.
//
// ⚠ SCOPE (three-lens independent audit, 2026-08-22 — see docs/RESIDUAL-VECTORS.md · V2/V4-possession).
// This KILLS the v1 address-grind, and that is ALL it is claimed to do. It does NOT close "possession":
//   1. STREAMING — the atlas bytes are not in the PoW loop; the read happens once per WINNING nonce, so a
//      holder-of-nothing can stream the block at challenge time (read is at win-rate, not hash-rate), and
//      with sampled P << atlasSize reads, streaming is cheaper than storing at scale.
//   2. DETERMINISM — verifyPremiumBeat is verifier-relative (0 = a lie OR "I can't check", no abstain state),
//      so two honest nodes at different atlas fractions disagree. It CANNOT be wired deterministically without
//      a 3-state verdict + a non-holder-verifiable proof; the naive wiring HALTs partial holders (centralizing)
//      or re-trusts the writer.
//   3. UNBOUNDED BLOCK — entangledPremiumWork sums over an unbounded p.block; window it to the tip first.
//   4. It prices storage by HASHRATE (premium ∝ f·effort), which centralizes custody.
// Keep it DORMANT until the proof-of-storage layer exists (3-state verdict, non-holder-verifiable proof,
// windowed, storage-priced, latency-bounded). A step toward proof-of-retrievability — not the destination.

/** The atlas index a premium beat must read — bound to the beat's OWN nonce, so it sweeps uniformly and
 *  cannot be concentrated by choosing the address. */
export function premiumIndex(beacon: string, address: string, nonce: bigint, atlasSize: number): number {
  if (!/^[0-9a-f]{64}$/.test(beacon)) throw new Error('custody: beacon must be a 32-byte Bitcoin block hash (hex)')
  if (!Number.isInteger(atlasSize) || atlasSize <= 0) throw new Error('custody: atlasSize must be a positive count')
  if (nonce < 0n) throw new Error('custody: nonce must be non-negative')
  const h = sha256(Buffer.from(`kray-core.premium-index.v1|${beacon}|${address}|${nonce.toString()}`, 'utf8'))
  return h.readUIntBE(0, 6) % atlasSize
}

/** A premium beat: a real presence-style PoW PLUS the answer for the block at its own nonce-derived index. */
export interface PremiumBeat { block: number; nonce: string; zeros: number; answer: string }

/**
 * VERIFY ONE PREMIUM BEAT — its PoW is real AND the miner holds the block at its own read-index. Returns the
 * work it proves, or 0n. Fail-closed and honest: a verifier that does not itself hold the challenged block
 * cannot credit it (to audit retrievability you must retrieve), and a wrong/forged/copied answer proves 0.
 */
export function verifyPremiumBeat(beacon: string, address: string, p: PremiumBeat, oracle: AtlasOracle): bigint {
  const base = verifyBeat(beacon, address, { block: p.block, nonce: p.nonce, zeros: p.zeros })
  if (base === 0n) return 0n                                   // no real PoW → nothing
  if (typeof p.answer !== 'string' || !/^[0-9a-f]{64}$/.test(p.answer)) return 0n
  if (oracle.contents.length === 0) return 0n                  // no atlas → no premium to earn
  const idx = premiumIndex(beacon, address, BigInt(p.nonce), oracle.contents.length)
  const bytes = oracle.bytesOf(oracle.contents[idx])
  if (bytes === null) return 0n                                // this verifier cannot read it → fail-closed
  if (custodyAnswer(bytes, beacon, address) !== p.answer) return 0n   // wrong bytes / not held / copied → 0
  return base
}

/**
 * THE ENTANGLED PREMIUM WORK for one guardian — Σ of the premium beats it truly holds, best per block (a
 * block counts once, so it is not a free axis). A fraction-f holder's beats verify at rate f, so this scales
 * LINEARLY with the fraction genuinely held — no address-grind fakes it.
 */
export function entangledPremiumWork(beacon: string, address: string, beats: PremiumBeat[], oracle: AtlasOracle): { work: bigint; blocks: number[] } {
  const bestPerBlock = new Map<number, bigint>()
  for (const p of beats) {
    const w = verifyPremiumBeat(beacon, address, p, oracle)
    if (w === 0n) continue
    const prev = bestPerBlock.get(p.block) ?? 0n
    if (w > prev) bestPerBlock.set(p.block, w)
  }
  let work = 0n
  const blocks = [...bestPerBlock.keys()].sort((a, b) => a - b)
  for (const b of blocks) work += bestPerBlock.get(b)!
  return { work, blocks }
}

/** Build an honest premium beat from what this machine actually holds — the guardian client's helper. It
 *  reads its own nonce-index and answers only if it holds it; a non-holder simply cannot make a valid beat. */
export function buildPremiumBeat(beacon: string, address: string, block: number, nonce: bigint, zeros: number, oracle: AtlasOracle): PremiumBeat | null {
  const idx = premiumIndex(beacon, address, nonce, oracle.contents.length)
  const bytes = oracle.bytesOf(oracle.contents[idx])
  if (bytes === null) return null                              // does not hold the read → no valid premium beat
  return { block, nonce: nonce.toString(), zeros, answer: custodyAnswer(bytes, beacon, address) }
}
