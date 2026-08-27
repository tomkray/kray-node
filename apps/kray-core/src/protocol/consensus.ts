/**
 * CONSENSUS — Bitcoin is the referee. The operator becomes checked, not trusted.
 *
 * Until now one writer held a data directory and its history could only be
 * disputed by pointing at the anchors it had already published. That is a real
 * guarantee, but it is not consensus: nothing said WHICH of two competing
 * histories is the true one, so a second node had no rule to follow.
 *
 * This module is that rule, and it needs no vote, no stake, no gossip and no
 * majority — because Bitcoin already decided:
 *
 *     THE CANONICAL HISTORY IS THE ONE WHOSE DEEPEST **SPV-PROVEN** ANCHOR
 *     SITS DEEPEST IN BITCOIN.
 *
 * Every tie-break below it is a pure function too, so two honest followers on
 * opposite sides of the planet, offline, pick the same head from the same bytes.
 *
 * WHY THIS IS SOUND
 * · An anchor is not a claim: it carries the raw transaction, its merkle path,
 *   and the headers burying it (anchor/spv.ts). A forged one is refused before
 *   it can weigh anything — a liar is simply lighter, never heavier.
 * · To beat an honest history, a forger must get a CONFLICTING root into
 *   Bitcoin, deeper. That is Bitcoin's own reorg problem — the attack whose
 *   price Satoshi documented, not a new weakness KRAY invents.
 * · An operator can still choose what to include (censorship is a separate
 *   problem, addressed by inclusion evidence), but it can no longer decide
 *   which past is real: whoever anchored deeper wins, and everyone computes
 *   that identically.
 *
 * WHAT A FOLLOWER MUST DO with the winner: replay the journal itself. Every
 * check that matters already lives in the reducer (hash chain, conservation,
 * the Proof Gate, signed identities, custody). A follower that replays is a
 * full verifier — it never takes the writer's word for anything.
 */
import { parseHeader, verifySealProof, checkProofOfWork, type SealProof } from '../anchor/spv.ts'
import { SEAL_CONFIRMATIONS } from './schedule.ts'

// ── ADR-4 slice 4d · FORK-CHOICE DoS BOUNDS ─────────────────────────────────
// A HeadClaim arrives from a HOSTILE peer. provenWeight() must never let a flood of fabricated anchors force
// unbounded SPV work (the reviewer's #5). Every bound below is O(1) and denominated in a REAL Bitcoin limit —
// never CPU-seconds — so it is atemporal and byte-identical for honest claims within it. A claim is REJECTED
// WHOLE on count: a pure function of claim.anchors.length, so every node takes the same branch off the same
// bytes (never array order, never wall-clock) — a >bound flood costs O(1) and can never split two followers.
// PRESENTATION RULE: an honest node presents its <= MAX_FORK_CHOICE_ANCHORS DEEPEST anchors (all a fork needs).
export const MAX_FORK_CHOICE_ANCHORS = 1024   // >= 10x the reorg horizon (ANCHOR_FINAL=100): only anchors within it can decide a fork
export const MAX_PROOF_HEADERS = 100          // the reorg horizon; an honest proof carries <= 12 (anchor.ts), deeper burial is already final
export const MAX_ANCHOR_TX_BYTES = 100_000    // Bitcoin's standard-transaction relay size — an anchor is a real broadcast tx, never larger
export const MAX_MERKLEBLOCK_BYTES = 4_000    // a single-tx BIP-37 merkle proof is < 600 bytes; generous margin

/** One anchor as a peer presents it — a promise plus, ideally, its proof. */
export interface AnchorClaim {
  /** the KRAY block height this anchor sealed */
  height: number
  cascadeRoot: string
  txid: string | null
  /** the offline SPV proof; absent = unproven, and unproven weighs NOTHING */
  proof?: SealProof | null
}

/** What a node publishes about itself — everything a peer needs to judge it. */
export interface HeadClaim {
  network: string
  /** the KRAY chain height this node serves */
  height: number
  /** the tip block hash and the compiled cascade root of that tip */
  chainTipHash: string
  cascadeRoot: string
  /** the anchors this node claims — presented as its <= MAX_FORK_CHOICE_ANCHORS DEEPEST, in any order.
   *  A peer that over-sends is rejected whole (a flood cannot force unbounded verify work). */
  anchors: AnchorClaim[]
}

export interface ProvenWeight {
  /** how many anchors re-proved from bytes alone */
  provenAnchors: number
  /** the deepest proven anchor's confirmation depth (0 = nothing proven) */
  depth: number
  /** the KRAY height of that deepest proven anchor */
  anchoredHeight: number
  /** the cascade root Bitcoin witnessed at that depth (null = none) */
  anchoredRoot: string | null
  /** anchors that CLAIMED a proof and were refuted — a liar names itself. A best-effort DIAGNOSTIC:
   *  chooseCanonical never reads it, and for a same-block valid+invalid twin it legitimately depends on
   *  order (a liar seen before its honest sibling is named; one seen after is deduped). Every fork-choice
   *  quantity below (work/totalWork/depth/provenAnchors/…) is fully order-invariant — that is what matters. */
  refuted: number
  /** cumulative proof-of-work of the heaviest proven anchor — a count of headers
   *  is free to fabricate; this is not. */
  work: bigint
  /** THE SUM of proof-of-work across EVERY proven anchor: how much Bitcoin has
   *  attended this history in total, and the first thing fork choice compares.
   *  Each anchor costs a real transaction in a real block, so this is the one
   *  quantity an attacker cannot inflate without paying Bitcoin for every unit. */
  totalWork: bigint
}

/**
 * THE WEIGHT OF A HISTORY — measured in Bitcoin's WORK, not in header counts.
 *
 * This function once compared `confirmations`, and an adversarial review broke
 * it in ten milliseconds: 5,000 chained headers fabricated with zero hashpower
 * outranked an honest chain, so anyone could rewrite history for free. A count
 * is free to manufacture. Work is not — that is the entire reason Bitcoin
 * exists, and the fork-choice rule must rest on it rather than on the length of
 * a list somebody handed us.
 *
 * Now each anchor's proof is weighed in cumulative proof-of-work, and one real
 * mainnet block outweighs 92 trillion minimum-difficulty forgeries. A refuted
 * proof is worse than a missing one and is counted separately: a peer that ships
 * forged proofs is not merely light, it is marked.
 */
export function provenWeight(claim: HeadClaim, minConfirmations = Number(SEAL_CONFIRMATIONS)): ProvenWeight {
  // ADR-4 4d — reject-whole DoS bound, decided by claim.anchors.length ALONE (a pure integer off the same
  // bytes, never array order), so every follower takes the identical branch. A non-array or a flood beyond the
  // bound returns the zero verdict in O(1) — NOT after scanning — so a hostile peer forces no expensive verify.
  const ZERO: ProvenWeight = { provenAnchors: 0, depth: 0, work: 0n, totalWork: 0n, anchoredHeight: -1, anchoredRoot: null, refuted: 0 }
  if (!Array.isArray(claim.anchors)) return ZERO
  if (claim.anchors.length > MAX_FORK_CHOICE_ANCHORS) return { ...ZERO, refuted: claim.anchors.length }
  let provenAnchors = 0, depth = 0, anchoredHeight = -1, refuted = 0
  let work = 0n, totalWork = 0n
  let anchoredRoot: string | null = null
  const net = claim.network === 'main' || claim.network === 'signet' || claim.network === 'regtest' || claim.network === 'test'
    ? claim.network : 'main'
  // ── ONE BITCOIN BLOCK COUNTS ONCE ────────────────────────────────────────
  // Without this, pasting the same valid anchor N times multiplied totalWork by
  // N at zero cost — which made the comment above it FALSE the day it was
  // written. Weight has to be denominated in something an attacker must buy, and
  // a copied array entry costs nothing. Distinctness is keyed on the block that
  // buried the seal, because that is the thing Bitcoin actually produced.
  const countedBlocks = new Set<string>()
  for (const a of claim.anchors) {
    if (!a.proof) continue // unproven claims weigh nothing at all
    // ADR-4 4d — refute a padded/oversized proof for O(1), BEFORE parseHeader/verifySealProof touch it. Each
    // gate refutes a STRICT SUBSET of what verifySealProof already refutes, so an honest anchor is byte-identical.
    const p = a.proof
    if (!Array.isArray(p.headers) || p.headers.length > MAX_PROOF_HEADERS) { refuted++; continue }         // headers-per-anchor multiplier (the 5,000-header scar)
    if (typeof p.rawTx !== 'string' || typeof p.txoutproof !== 'string' ||
        p.rawTx.length > 2 * MAX_ANCHOR_TX_BYTES || p.txoutproof.length > 2 * MAX_MERKLEBLOCK_BYTES ||       // hex is 2 chars/byte
        (p.coinbaseTx != null && (typeof p.coinbaseTx !== 'string' || p.coinbaseTx.length > 2 * MAX_ANCHOR_TX_BYTES)) ||
        (p.coinbaseProof != null && (typeof p.coinbaseProof !== 'string' || p.coinbaseProof.length > 2 * MAX_MERKLEBLOCK_BYTES))) { refuted++; continue }
    let blockKey: string
    try { blockKey = parseHeader(Buffer.from(p.headers[0], 'hex')).hashDisplay } catch (_) { refuted++; continue }
    if (countedBlocks.has(blockKey)) continue // already paid for; it is not paid for twice
    // a header whose OWN proof-of-work is invalid (invented difficulty, or a hash above its target) is refuted
    // for ~1 sha256d, not the ~40 of a full verify. A strict subset of verifySealProof's own PoW check → byte-identical.
    if (!checkProofOfWork(p.headers[0], net).ok) { refuted++; continue }
    const v = verifySealProof(a.proof, { cascadeRoot: a.cascadeRoot, blockNumber: a.height, minConfirmations, net })
    if (!v.ok) { refuted++; continue }
    provenAnchors++
    countedBlocks.add(blockKey)
    const w = v.work ?? 0n
    totalWork += w // every anchor Bitcoin attended, summed — the costly measure
    // HEAVIER IN BITCOIN WINS. At equal work, the anchor that sealed more KRAY
    // history; the header count is kept only as a human-readable number.
    if (w > work || (w === work && a.height > anchoredHeight)) {
      work = w
      depth = v.confirmations!
      anchoredHeight = a.height
      anchoredRoot = a.cascadeRoot
    }
  }
  return { provenAnchors, depth, work, totalWork, anchoredHeight, anchoredRoot, refuted }
}

export interface ForkVerdict {
  /** 'a' | 'b' — which head a follower must serve */
  winner: 'a' | 'b'
  /** the rule that decided it, in words a human can audit */
  why: string
  weightA: ProvenWeight
  weightB: ProvenWeight
}

/**
 * CHOOSE THE CANONICAL HEAD — a total, deterministic, offline function.
 *
 * The ladder, in order, each step used only when the one above ties:
 *  1 · the TOTAL proof-of-work across every DISTINCT proven anchor block — how
 *      much Bitcoin attended this history, one transaction and one block at a
 *      time. Distinctness is the whole of it: a copied anchor is not a paid one.
 *
 *  ── AND THE HONEST LIMIT OF THIS NUMBER ─────────────────────────────────
 *  totalWork sums the work of the BLOCKS that buried the anchors — work the
 *  anchorer did not do and did not pay for. What an anchorer pays is a FEE. So
 *  this quantity is a proxy: it measures how much Bitcoin attention a history
 *  attracted, not how much its author spent. It cannot be inflated for free,
 *  which is what a fork-choice rule needs, but nobody should read it as a
 *  security budget denominated in hashpower. It is denominated in the cost of
 *  getting distinct Bitcoin blocks to carry your commitments.
 *  2 · the heaviest single anchor, then the deeper burial, then more anchors:
 *      each rung costs something real, in descending order of price
 *  3 · only then the KRAY height an anchor claims, which is FREE to declare and
 *      therefore ranks below everything Bitcoin can price
 *  3 · more proven anchors overall (a longer witnessed life)
 *  4 · the taller chain (only among equally witnessed histories)
 *  5 · the lexicographically smaller tip hash — an arbitrary but IDENTICAL
 *      choice everywhere, because a tie that two nodes break differently is a
 *      permanent split, and a coin flip is worse than a rule.
 *
 * A history with nothing proven can still win against another with nothing
 * proven (by 4/5) — but it can NEVER outrank one Bitcoin has witnessed.
 */
export function chooseCanonical(a: HeadClaim, b: HeadClaim, minConfirmations = Number(SEAL_CONFIRMATIONS)): ForkVerdict {
  if (a.network !== b.network) throw new Error('consensus: these heads are different networks — there is no fork to resolve')
  const wa = provenWeight(a, minConfirmations), wb = provenWeight(b, minConfirmations)
  const pick = (winner: 'a' | 'b', why: string): ForkVerdict => ({ winner, why, weightA: wa, weightB: wb })
  // ── ORDERED BY WHAT IT COSTS TO PRODUCE ─────────────────────────────────
  // A review found the old ladder decidable by `anchoredHeight` — the KRAY height
  // inside an anchor's OP_RETURN. That value IS committed to Bitcoin, but
  // committed is not EARNED: one cheap transaction declares any number, and
  // nothing ties "I sealed height 999,999" to having lived 999,999 blocks. So the
  // rungs are now ranked by their price, and the free integer sits at the bottom.
  if (wa.totalWork !== wb.totalWork) return pick(wa.totalWork > wb.totalWork ? 'a' : 'b', `Bitcoin attended one MORE in total (${wa.totalWork} vs ${wb.totalWork} of summed work) — every unit of it bought with a real transaction in a real block`)
  if (wa.work !== wb.work) return pick(wa.work > wb.work ? 'a' : 'b', `equal attention, so the heaviest single anchor (${wa.work} vs ${wb.work})`)
  if (wa.depth !== wb.depth) return pick(wa.depth > wb.depth ? 'a' : 'b', `equal weight, so the deeper burial (${Math.max(wa.depth, wb.depth)} vs ${Math.min(wa.depth, wb.depth)} confirmations)`)
  if (wa.provenAnchors !== wb.provenAnchors) return pick(wa.provenAnchors > wb.provenAnchors ? 'a' : 'b', 'more anchors proven from bytes — a longer witnessed life, and one transaction per anchor')
  // BELOW HERE NOTHING COSTS ANYTHING, which is why it decides nothing that the
  // rungs above could have decided.
  if (wa.anchoredHeight !== wb.anchoredHeight) return pick(wa.anchoredHeight > wb.anchoredHeight ? 'a' : 'b', 'everything Bitcoin can price is tied, so the anchor claiming more KRAY history — a free integer, and it only ever breaks ties among equals')
  if (a.height !== b.height) return pick(a.height > b.height ? 'a' : 'b', 'equally witnessed, so the taller chain')
  if (a.chainTipHash !== b.chainTipHash) return pick(a.chainTipHash < b.chainTipHash ? 'a' : 'b', 'a dead tie, broken by the smaller tip hash — every follower on earth breaks it identically')
  return pick('a', 'the same history: nothing to choose')
}

/**
 * FOLLOW THE WINNER, then verify it yourself. This states the contract a
 * follower must honour; the verification itself is the reducer's, unchanged.
 *
 * A follower NEVER trusts the head it chose. It replays the journal: the event
 * hash chain, conservation after every event, the Proof Gate over every
 * settlement, each sealed identity's signature, each work claim, each custody
 * proof it can read, and every anchor's SPV proof. Only then does it serve.
 */
export const FOLLOWER_CONTRACT = [
  'replay the journal end to end — hash chain and conservation, or refuse',
  'recompute every settlement table (the Proof Gate) — one lawful table only',
  're-verify every sealed opt-in and every signed work claim',
  're-prove every anchor from raw bytes (SPV), and refuse a refuted one',
  'hold every journaled inscription — missing or junk bytes refuse the snapshot',
  're-prove custody for every content this replica holds',
  'serve only what survived all of the above — never the writer\'s word',
] as const
