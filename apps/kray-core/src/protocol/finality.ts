/**
 * ADR-4 · slice 4a — THE TWO FINALITIES, never conflated.
 *
 * A Bitcoin-anchored L2 carries TWO different facts about "is this settled?", and collapsing them into
 * one word is how a user is misled. This module names them apart, as pure, TOTAL, offline functions
 * anyone (a follower, a UI, an auditor) can re-derive identically from the same bytes:
 *
 *   · CRANE-FINALITY — a root is canonical BY REPLAY the instant it is produced. It is a pure function of
 *     the journal bytes (store.ts: hash = sha256(prevHash + canonical(body))), so it needs no bitcoind, no
 *     anchor, no network: replaying THIS journal always yields THIS root. That replay-determinism is the
 *     ONLY thing in the whole system that earns the word "final" — and it is scoped by `basis:'replay'`
 *     right beside it, because it is NOT a settlement guarantee: fork choice (consensus.ts) can still make
 *     a heavier Bitcoin-anchored history canonical, replacing WHICH journal is the truth. Crane-finality
 *     never regresses WITHIN a fixed journal, and says nothing about which journal wins.
 *
 *   · ANCHOR-CONFIDENCE — a PROBABILISTIC spectrum graded by the BURIAL DEPTH of the deepest anchor that
 *     witnesses this root in Bitcoin. It deepens with every block and is never absolute. It keys on DEPTH,
 *     never on a count of anchors — the same reason consensus.ts abandoned confirmation-counts: a list of
 *     headers is free to fabricate, work is not. Depth is a MAX over anchors (never a sum), so a duplicated
 *     or forged anchor cannot inflate the tier: only real burial does. Its top tier is named `deep`, NOT
 *     "final"/"reorg-safe" — the beyond-reorg-reach floor (ANCHOR_FINAL) is a uniform 100 that a cheap
 *     reorg reaches on regtest/signet, so a safety word there would be a lie. `deep` describes burial and
 *     claims nothing.
 *
 * These are Lamport's two independent automata sharing no state variable. A Bitcoin reorg that un-buries an
 * anchor is a NAMED transition that lowers anchor-confidence — and a no-op on crane-finality (the journal
 * is untouched). Surfacing them as ONE object with a clear vocabulary is slice 4a; the reorg TRANSITION
 * test, the burn-under-reorg proof, and the fabricated-anchor DoS bound are the later slices (4b/4c/4d).
 *
 * PROVENANCE: `basis` states where `depth` came from — a follower feeds `spv-proven` (re-proved from
 * bytes, distinct-block, via provenWeight()); a server feeds `node-bitcoind-hint` (its own bitcoind's
 * confirmation count, a hint a follower must re-prove). The number is always honest about itself.
 */

/** The burial tiers of anchor-confidence, shallow → deep. `deep` is the top — never "final". */
export type AnchorTier = 'none' | 'seen' | 'confirmed' | 'deep'

/** Where `depth` came from — and therefore how much it can be trusted without re-proving. */
export type ConfidenceBasis = 'spv-proven' | 'node-bitcoind-hint'

/** The per-network burial floors. `deep` is normalized ≥ `confirmed` so the ladder can never invert. */
export interface ConfidenceThresholds {
  /** verified floor: depth ≥ this ⇒ at least `confirmed` (server ANCHOR_CONF / follower SEAL_CONFIRMATIONS) */
  confirmed: number
  /** beyond-reorg-reach floor: depth ≥ this ⇒ `deep` (server ANCHOR_FINAL). Normalized ≥ confirmed. */
  deep: number
  net: string
}

/** floor a possibly-hostile number to a non-negative integer; NaN/±Inf/negative/non-number ⇒ `min`. */
function nnInt(x: number, min = 0): number {
  return Number.isFinite(x) ? Math.max(min, Math.floor(x)) : min
}

/** Normalize a thresholds bag: confirmed ≥ 1, deep ≥ confirmed. Total — a misconfig can never invert it. */
function normThresholds(t: ConfidenceThresholds): ConfidenceThresholds {
  const confirmed = nnInt(t.confirmed, 1) || 1
  const deep = Math.max(confirmed, nnInt(t.deep, confirmed))
  return { confirmed, deep, net: String(t.net ?? '') }
}

/**
 * Classify a burial depth into a tier — PURE, TOTAL, never throws on the /api hot path. A hostile depth
 * (NaN | negative | non-integer | Infinity | non-number) clamps to `none`; it can never fabricate a tier.
 * The tier is a function of DEPTH alone, so a flood of duplicated/forged anchors — which never raise real
 * burial — can never raise the tier.
 */
export function anchorTier(depth: number, t: ConfidenceThresholds): AnchorTier {
  const d = nnInt(depth)
  const { confirmed, deep } = normThresholds(t)
  if (d <= 0) return 'none'
  if (d >= deep) return 'deep'
  if (d >= confirmed) return 'confirmed'
  return 'seen'
}

/** The deepest anchor witnessing a root — a MAX over anchors (the server computes it; never a sum). */
export interface DeepestAnchor {
  depth: number
  anchoredRoot: string | null
  anchoredHeight: number | null
  provenAnchors: number
}

export interface AnchorConfidence {
  tier: AnchorTier
  depth: number
  basis: ConfidenceBasis
  anchoredRoot: string | null
  anchoredHeight: number | null
  provenAnchors: number
  /** the NORMALIZED thresholds actually used, echoed so any reader can audit the boundary */
  thresholds: ConfidenceThresholds
}

/**
 * Grade anchor-confidence from the deepest anchor — PURE, TOTAL. `provenAnchors ≤ 0 || depth ≤ 0` means
 * nothing witnesses this root, so the tier is `none` and the anchored fields are null (a forged anchor
 * that proves nothing weighs nothing). Emits the substring "final" NOWHERE — that word is crane's alone.
 */
export function anchorConfidence(deepest: DeepestAnchor, t: ConfidenceThresholds, basis: ConfidenceBasis = 'node-bitcoind-hint'): AnchorConfidence {
  const depth = nnInt(deepest.depth)
  const provenAnchors = nnInt(deepest.provenAnchors)
  const thresholds = normThresholds(t)
  const witnessed = provenAnchors > 0 && depth > 0
  const b: ConfidenceBasis = basis === 'spv-proven' ? 'spv-proven' : 'node-bitcoind-hint'
  return {
    tier: anchorTier(witnessed ? depth : 0, thresholds),
    depth,
    basis: b,
    anchoredRoot: witnessed ? (deepest.anchoredRoot ?? null) : null,
    anchoredHeight: witnessed ? (deepest.anchoredHeight ?? null) : null,
    provenAnchors,
    thresholds,
  }
}

/** The one place the word "final" is earned: canonical-by-replay of THIS journal, zero Bitcoin dependency. */
export interface CraneFinality {
  final: true
  basis: 'replay'
  root: string
  seq: number
}

/** Crane-finality of a tip — a trivial pure identity over already-computed values, so it cannot drift. */
export function craneFinality(root: string, seq: number): CraneFinality {
  return { final: true, basis: 'replay', root: String(root), seq: nnInt(seq) }
}

/** The whole finality view — the two facts side by side, so neither can be read as the other. */
export interface Finality {
  crane: CraneFinality
  anchor: AnchorConfidence
}

/** Compose the crane + anchor view in one call (the server's /api/kraynet/head surface). */
export function finalityView(craneRoot: string, craneSeq: number, deepest: DeepestAnchor, t: ConfidenceThresholds, basis: ConfidenceBasis = 'node-bitcoind-hint'): Finality {
  return { crane: craneFinality(craneRoot, craneSeq), anchor: anchorConfidence(deepest, t, basis) }
}
