/**
 * SUCCESSION (ADR-3 · slice 3e — the pen as a race, not a machine) — when the writer falls silent, ANY
 * node may pick up the pen under a rule everyone computes identically, and Bitcoin decides who won.
 *
 * This is the frontier's hardest rail, and this module is deliberately SMALL: it does NOT invent a new
 * consensus. It composes the parts already proven and already live:
 *   · `chooseCanonical` (consensus.ts, LIVE) already answers "which of two histories is real" by the
 *     Bitcoin proof-of-work burying each one's anchor — no vote, no committee. Succession among
 *     competing successors is that same rule; this module only reduces it over N claimants.
 *   · the anchor backstop (anchor-pool.ts, LIVE) already pays a stranger from the conserved fee pool
 *     for burying the root — so a successor is already incentivised.
 *   · 3c `orderWindow`, 3a `inclusionRoot`, 3d `windowCommitment` — a successor's window is INTERNALLY
 *     re-derivable by those pure rules, so an honest node refuses a tampered set, a smuggled invalid act,
 *     or a fabricated commitment. The binding of that window onto the PREVIOUS canonical root, and the
 *     shared starting-nonce snapshot both writers must agree on, are LIVE-WIRING properties — NOT proven
 *     by this module (see `validateSuccessorWindow` and the honest limit below); the FOLLOWER_CONTRACT and
 *     the anchor are where they are enforced.
 *
 * The one genuinely new pure piece is THE SILENCE CLOCK: succession opens only after the writer has
 * published no anchored window for `silenceBlocks` consecutive Bitcoin blocks. That threshold turns a
 * brief hiccup (which needs no successor — the writer will resume) into an outage (which does), and it
 * reduces wasteful racing — but it is not what makes succession SAFE. Safety is `chooseCanonical`:
 * even if two nodes disagree on whether the clock has struck, the deeper Bitcoin anchor wins, and every
 * node computes that identically. Two writers do not fork the book permanently; the lighter one loses.
 *
 * Wired into NO live path. It is the rule 3e's live wiring will run; the writer, cascade root, anchor,
 * and the live `chooseCanonical`/backstop are unchanged. What this module CANNOT establish alone, stated
 * not hidden: liveness under an adversary who both withholds anchors AND hides the inbox (that is the
 * data-availability layer, ADR-2), and the trustless clock source (the successor reads a real Bitcoin
 * tip — A6 — not a peer's word). Safety it does provide; guaranteed liveness it does not, and says so.
 */
import { chooseCanonical, provenWeight, type ForkVerdict, type HeadClaim } from './consensus.ts'
import { orderWindow, type SignedAct, type WindowRules } from './window-order.ts'
import { inclusionRoot } from './inclusion-tree.ts'
import { windowCommitment, type CensorshipVerdict } from './censorship-evidence.ts'

/** Bitcoin blocks of writer silence before succession opens. A CONSENSUS PARAMETER, not a constant of
 *  nature: long enough that a brief writer restart never triggers a needless race, short enough that a
 *  real outage does not freeze writing for long. The Creator sets the final value before live wiring. */
export const DEFAULT_SILENCE_BLOCKS = 6

export interface SilenceView {
  /** true iff the writer has been silent long enough that a successor may assemble the next window */
  open: boolean
  /** how many Bitcoin blocks have passed since the last anchored window */
  silentBlocks: number
  /** the threshold in force */
  threshold: number
  /** a human-auditable reason */
  reason: string
}

/**
 * THE SILENCE CLOCK — a pure function of Bitcoin heights. Both heights MUST come from the successor's OWN
 * SPV-verified view, never a peer's word (A6) — and this discipline binds `lastAnchoredBtcHeight` at least
 * as strictly as `tipHeight`:
 *   · `tipHeight` — the current Bitcoin tip on the successor's own node.
 *   · `lastAnchoredBtcHeight` — the Bitcoin block that buried the writer's most recent anchored window,
 *     taken ONLY from an anchor the successor itself SPV-verified (the discipline `consensus.ts` enforces
 *     for every anchor), NEVER from an unproven peer/inbox claim. This input is the one an attacker would
 *     inflate: a poisoned `lastAnchoredBtcHeight = tipHeight` drives `silentBlocks` to ~0 and freezes
 *     succession shut against a genuinely-silent writer (a liveness-denial vector). Verify it, do not trust it.
 * Succession opens when the gap reaches the threshold.
 */
export function successionWindow(lastAnchoredBtcHeight: number, tipHeight: number, silenceBlocks = DEFAULT_SILENCE_BLOCKS): SilenceView {
  if (!Number.isInteger(lastAnchoredBtcHeight) || !Number.isInteger(tipHeight) || !Number.isInteger(silenceBlocks) || silenceBlocks < 1) {
    return { open: false, silentBlocks: 0, threshold: silenceBlocks, reason: 'succession clock: heights must be integers and the threshold ≥ 1' }
  }
  const silentBlocks = Math.max(0, tipHeight - lastAnchoredBtcHeight)
  const open = silentBlocks >= silenceBlocks
  return {
    open, silentBlocks, threshold: silenceBlocks,
    reason: open
      ? `the writer has published no anchored window for ${silentBlocks} Bitcoin blocks (≥ ${silenceBlocks}) — succession is open to any node`
      : `only ${silentBlocks} of ${silenceBlocks} silent blocks — the writer is still within its window; no succession`,
  }
}

export interface SuccessorClaim<T extends SignedAct> {
  /** the new window's seal height */
  seal: number
  /** the admitted acts the successor assembled from the inbox for this window */
  actSet: readonly T[]
  /** the window commitment the successor published (must equal the re-derived one) */
  windowCommitment: string
}

export interface SuccessorVerdict {
  /** true iff the successor's window was built by the 3c/3a/3d rules and its commitment matches */
  valid: boolean
  reason: string
  /** the inclusion root re-derived here from the successor's admitted set (for a follower to reuse) */
  inclusionRoot: string | null
  /** how many acts in the claimed set were refused admission (invalid signature) — a successor should ship none */
  rejectedCount: number
  /** how many acts were ordered into the window */
  orderedCount: number
}

/**
 * VALIDATE A SUCCESSOR'S WINDOW — the pure re-derivation an honest node runs before it will follow a
 * successor. Runs 3c `orderWindow` over the claimed set (dropping any act whose signature does not
 * verify — a successor cannot smuggle an invalid act in), folds the ordered keys into the 3a
 * `inclusionRoot`, computes the 3d `windowCommitment(seal, root)`, and requires it to EQUAL what the
 * successor published. A mismatch — a tampered set, a smuggled invalid act, a fabricated commitment —
 * is refused. This is what makes a successor a follower-checkable role, not a trusted second writer.
 */
export function validateSuccessorWindow<T extends SignedAct>(claim: SuccessorClaim<T>, rules: WindowRules<T>): SuccessorVerdict {
  if (!claim || !Array.isArray(claim.actSet) || typeof claim.windowCommitment !== 'string') {
    return { valid: false, reason: 'a successor claim needs {seal, actSet[], windowCommitment}', inclusionRoot: null, rejectedCount: 0, orderedCount: 0 }
  }
  let ordered, rejected
  try { ({ ordered, rejected } = orderWindow(claim.actSet, rules)) }
  catch (e) { return { valid: false, reason: 'the window would not order — ' + (e instanceof Error ? e.message : String(e)), inclusionRoot: null, rejectedCount: 0, orderedCount: 0 } }
  let root: string, commit: string
  try {
    root = inclusionRoot(ordered.map((a) => rules.keyOf(a)))
    commit = windowCommitment(claim.seal, root)
  } catch (e) {
    return { valid: false, reason: 'the window commitment would not derive — ' + (e instanceof Error ? e.message : String(e)), inclusionRoot: null, rejectedCount: rejected.length, orderedCount: ordered.length }
  }
  if (commit !== claim.windowCommitment) {
    return { valid: false, reason: 'the re-derived window commitment does not match the successor’s — a tampered set, a smuggled invalid act, or a fabricated commitment', inclusionRoot: root, rejectedCount: rejected.length, orderedCount: ordered.length }
  }
  return { valid: true, reason: 'the successor’s window is exactly what the 3c/3a/3d rules produce from its admitted set', inclusionRoot: root, rejectedCount: rejected.length, orderedCount: ordered.length }
}

/**
 * THE CANONICAL HEAD among N competing claimants — a deterministic reduce over the LIVE `chooseCanonical`.
 * Succession's equivocation ("two nodes both assembled a window and anchored it") is resolved by the same
 * Bitcoin-work rule that resolves any fork: the deepest proven anchor wins, and the final tie-break is the
 * smaller tip hash, so every node picks the identical winner from the same bytes, in any order (the reduce
 * is order-invariant because `chooseCanonical` is a lexicographic total order over per-claim weight tuples).
 * Returns null for an empty list AND for a mixed-network list — fail-closed, never an uncaught throw, so one
 * hostile off-network claim cannot abort fork choice (consistent with `provenWeight`'s never-throw posture).
 */
export function canonicalHead(claims: readonly HeadClaim[], minConfirmations?: number): HeadClaim | null {
  if (!Array.isArray(claims) || claims.length === 0) return null
  // chooseCanonical throws on a network mismatch; refuse a heterogeneous list up front rather than let a
  // single off-network claim (from a hostile/buggy peer) crash the reduce. Deterministic in any order.
  if (new Set(claims.map((c) => c && c.network)).size > 1) return null
  return claims.reduce((best, c) => (chooseCanonical(best, c, minConfirmations).winner === 'a' ? best : c))
}

// ── THE CONDUCT STRIKE (ADR-3, the writer-inclusion obligation ENFORCED) ─────────────────────────────
//
// `verifyCensorshipAnchored` proves the fact: this chain omitted a Bitcoin-published act past its signed
// deadline. Until now the verdict had no teeth — fork choice weighed only Bitcoin work, and the incumbent
// censor is usually the heavier chain. These two functions are the teeth, and they are PURE compositions:
// no new consensus, no change to `chooseCanonical` (every existing caller is byte-identical).
//
// THE VALIDATING-REPLICA REQUIREMENT (censorship-evidence.ts, restated as a gate): a strike counts ONLY
// if the node itself ran `verifyCensorshipAnchored` over the head's CURRENT anchored root, consuming
// `windowSeals` from a journal whose seal heights the follower re-proved from its own bitcoind
// (kray-follow §4b). `sealHeightReproven` names that obligation; false ⇒ the strike does not stand
// (fail-closed — an unverified accusation moves nothing). A pure function cannot re-prove bitcoind
// heights itself; naming the input honest is the same posture `expectedNonceAt` held before its opening.
//
// HEALING is structural, not special-cased: the verdict requires an absence proof against the head's
// cumulative inclusion root. A chain that later INCLUDES the act can no longer produce that proof at its
// current root, so no current strike derives — the caller re-derives per head, per fork choice.

/** A censorship verdict this node derived itself, plus the named replica obligation. */
export interface ConductStrike {
  verdict: CensorshipVerdict
  /** true iff the follower re-proved the seal's l1Height from its own bitcoind (kray-follow §4b) */
  sealHeightReproven: boolean
}

/** A strike stands only when the verdict is CENSORED and the replica obligation is met. Fail-closed. */
export function strikeStands(s: ConductStrike | null | undefined): boolean {
  return !!s && s.verdict != null && s.verdict.censored === true && s.sealHeightReproven === true
}

/**
 * CENSORSHIP OPENS SUCCESSION — a writer that provably censors does not get to hide behind an alive
 * heartbeat. The silence clock answers outage; this answers refusal: a standing strike opens the
 * succession window immediately, whatever the clock says. No strike (or an unproven one) leaves the
 * clock's own verdict byte-identical — this function never closes a window the clock opened.
 */
export function censorshipOpensSuccession(strike: ConductStrike | null | undefined, silence: SilenceView): SilenceView {
  if (!strikeStands(strike) || silence.open) return silence
  const v = strike!.verdict as { censored: true; key: string; seal: number; deadline: number }
  return {
    open: true,
    silentBlocks: silence.silentBlocks,
    threshold: silence.threshold,
    reason: `the writer is provably CENSORING (act ${v.key.slice(0, 16)}… owed by seal ${v.deadline}, absent at anchored seal ${v.seal}) — censorship is not silence, and succession opens without waiting for the clock`,
  }
}

/**
 * FORK CHOICE WITH CONDUCT — the censored history loses to an honest one BEFORE any work is weighed.
 * This is the whole point of the obligation: the incumbent censor is normally the heavier chain, so a
 * conduct rung below the work rungs would never fire. Symmetric and fail-closed:
 *   · exactly one head under a standing strike → the OTHER head wins, whatever the work says;
 *   · both struck, or neither → `chooseCanonical` unchanged (work decides among equals, byte-identical).
 * The strikes are the CALLER's own verdicts (see the validating-replica gate above) — never a peer claim.
 */
export function chooseCanonicalWithConduct(
  a: HeadClaim,
  b: HeadClaim,
  strikes: { a?: ConductStrike | null; b?: ConductStrike | null },
  minConfirmations?: number,
): ForkVerdict {
  if (a.network !== b.network) throw new Error('consensus: these heads are different networks — there is no fork to resolve')
  const sa = strikeStands(strikes.a), sb = strikeStands(strikes.b)
  if (sa === sb) return chooseCanonical(a, b, minConfirmations)
  return {
    winner: sa ? 'b' : 'a',
    why: 'one history is provably CENSORING (an anchored omission past a signed deadline, verified by this node over a seal-height-re-proven journal) — an honest history outranks it before any Bitcoin work is weighed',
    weightA: provenWeight(a, minConfirmations),
    weightB: provenWeight(b, minConfirmations),
  }
}
