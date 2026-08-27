/**
 * CENSORSHIP EVIDENCE (ADR-3 · slice 3d — the deadline that turns silence into proof) — the fold that
 * makes "the writer left my act out" a fact a stranger can check, not an accusation.
 *
 * Today a writer can silently refuse an act and no one can prove it (Article XI). This module composes
 * the three primitives already proven so that refusal becomes evidence:
 *   · 3c ADMISSION — the act's signature verifies, so the writer cannot answer "it was invalid";
 *   · 3c KEY — the act's identity is the hash of its signed message (ungrindable);
 *   · 3a ABSENCE — a non-membership proof shows the act's key is NOT in the window's inclusion root;
 *   · 3b AVAILABILITY — a witness that the act was public no later than its deadline, so the writer
 *     cannot answer "I never received it" (the inbox/gossip receipt; its provenance is the honest
 *     dependency below — this module verifies the composition, not the witness's own trustworthiness).
 *
 * A verdict of CENSORED requires ALL of: the act carries a SIGNED inclusion deadline; its signature
 * verifies; the inclusion root is the one committed at that window's seal (re-derived, so a fabricated
 * root is refused); the seal is at or past the deadline (inclusion was owed); the availability witness
 * proves the act was public by the deadline; the act was ELIGIBLE by its deadline (a nonced act's nonce
 * equals its account's expected nonce then — 3c only defers a gap, and a deferral is not a refusal); and
 * the absence proof verifies against that anchored root. Miss any one and the verdict is NOT censorship —
 * with the exact honest reason (invalid act, no deadline, unfounded root, deadline not reached, innocent-
 * because-not-yet-public, not-yet-eligible/superseded nonce, or an absence proof that fails because the act
 * is in fact included).
 *
 * TWO CALLER OBLIGATIONS the composition rests on (a soundness council named both — stated, not hidden):
 *   1. The deadline MUST be part of the bytes the signature covers (see `deadlineOf` below). A deadline
 *      read from an UNSIGNED envelope field is not something the author demanded — a stranger could
 *      stamp an aggressive deadline on someone else's valid act and manufacture a false CENSORED. The
 *      deadline is bound to the signature exactly as the identity key is (3c's signed-bytes discipline).
 *   2. The inclusion root at `seal` MUST be CUMULATIVE (monotone): it contains every act key included at
 *      any seal ≤ this one. Only then does "absent at a seal ≥ the deadline" mean "never included by the
 *      deadline." Under a per-window root, an act legitimately processed in an EARLIER window would look
 *      absent from a later one — convicting an honest writer. Cumulative roots close that.
 *   3. The eligibility oracle (`expectedNonceAt`, the 3c ⋈ 3d seam a later council named) MUST be the
 *      account's expected nonce in the APPLIED state as of the deadline, re-derived from the anchored
 *      journal — not asserted. In the fully-anchored path this is the one new link still owed: a
 *      nonce-membership opening against the state Bitcoin committed as of the deadline seal, exactly as
 *      `windowMembership` proves the window binding. Until that opening is supplied, `expectedNonceAt` is
 *      the caller's asserted-anchored input (fail-closed: a nonced act with no oracle is never convicted).
 *
 * Given those hold (and the key + validity bound to one signed message), no false CENSORED can be
 * produced without a SHA-256 break, and no true censorship can be denied once the inputs hold.
 *
 * Pure and wired into NO live path. It is the verdict function 3e's succession and the live wiring will
 * call; the writer, the cascade root, and the anchor are unchanged. Two dependencies this module CANNOT
 * discharge alone: the availability witness's trustlessness is the inbox/gossip layer (3b / ADR-2), and
 * the binding of `anchoredCommitment` onto Bitcoin is the live cascade-root/anchor wiring. A censorship
 * proof is only as strong as those.
 */
import { createHash } from 'node:crypto'
import { verifyExclusion, verifyProof, proveKey, type MerkleProof } from './inclusion-tree.ts'
import { verifyAvailability, type AvailabilityProof } from './availability.ts'
import { cascadeRootFromParts, type CascadeParts } from './cascade-root.ts'
import { verifyNonceProof, type NonceProof } from './nonce-map.ts'
import type { SignedAct } from './window-order.ts'

const HEX32 = /^[0-9a-f]{64}$/
const sha256hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/** The per-window commitment a writer anchors: it binds a seal height to that window's inclusion root,
 *  so "absent under THIS anchored root at THIS seal" is a single non-repudiable statement. The live
 *  wiring folds this into the cascade root; here it is the value a verifier independently re-derives. */
export function windowCommitment(seal: number, inclusionRootHex: string): string {
  if (!Number.isInteger(seal) || seal < 0) throw new Error('windowCommitment: seal must be a non-negative integer')
  if (!HEX32.test(inclusionRootHex)) throw new Error('windowCommitment: the inclusion root must be 64-hex')
  return sha256hex(`kray-core.window.v1|seal=${seal}|root=${inclusionRootHex}`)
}

export interface CensorshipClaim<T extends SignedAct> {
  /** the signed act allegedly censored */
  act: T
  /** the anchored window's seal height */
  seal: number
  /** that window's 3a inclusion root — MUST be CUMULATIVE through `seal` (contains every key included at
   *  any seal ≤ this one), or a writer who included the act in an earlier window is wrongly convicted */
  inclusionRoot: string
  /** the commitment the verifier independently holds (from the anchor) — re-derived and checked */
  anchoredCommitment: string
  /** 3a non-membership proof: the act's key is NOT in `inclusionRoot` */
  absenceProof: MerkleProof
  /** 3b/ADR-2 witness: the seal by which the act was provably public (must be ≤ deadline for censorship) */
  availableBySeal?: number
}

export interface CensorshipRules<T extends SignedAct> {
  /** the act's 3c order/identity key: hash of its signed message (use `keyFromSignedMessage`) */
  keyOf: (act: T) => string
  /** true iff the act's signature verifies (3c admission) */
  isValid: (act: T) => boolean
  /** the seal by which the act was owed inclusion — MUST be read from the SAME signed bytes `keyOf`
   *  hashes and `isValid` verifies, never an unsigned envelope field (an unsigned deadline is not
   *  something the author demanded, and honoring it would let a stranger stamp a verdict); null if the
   *  act carries no signed deadline */
  deadlineOf: (act: T) => number | null
  /** THE ELIGIBILITY ORACLE (the 3c ⋈ 3d seam, council-ruled) — the account's expected (next) nonce in the
   *  APPLIED state as of the last seal ≤ the act's `deadline`, re-derived by the follower from the anchored
   *  journal (never asserted). A nonced act is owed inclusion ONLY if it was ELIGIBLE by its deadline —
   *  `act.nonce === expected`. This closes the false CENSORED where 3c legitimately DEFERS an act whose
   *  nonce is a gap (a citizen who withholds their own earlier nonces cannot convict an honest writer that
   *  merely waited). Measured at the DEADLINE (symmetric with `availableBySeal ≤ deadline`), and STRICT
   *  equality (a filled lower slot is a superseded/losing double-sign, not owed; a higher nonce is a gap).
   *  Return null if unknown. REQUIRED to convict a nonced act; a nonce-free act (a donation keyed by its
   *  outpoint) is always eligible and skips the gate. */
  expectedNonceAt?: (act: T, deadline: number) => number | null
}

export type CensorshipVerdict =
  | { censored: true; key: string; seal: number; deadline: number }
  | { censored: false; reason: string }

/**
 * Decide whether a claim proves censorship. Fail-closed: every gate must pass, each with a named reason
 * when it does not, so a NOT-CENSORED verdict is as legible as a CENSORED one. Never throws on a
 * well-typed claim; a malformed window is reported, not raised.
 */
export function verifyCensorship<T extends SignedAct>(claim: CensorshipClaim<T>, rules: CensorshipRules<T>): CensorshipVerdict {
  const { act, seal, inclusionRoot, anchoredCommitment, absenceProof, availableBySeal } = claim

  const deadline = rules.deadlineOf(act)
  if (deadline == null || !Number.isInteger(deadline) || deadline < 0) {
    return { censored: false, reason: 'the act carries no inclusion deadline — nothing was owed by any seal' }
  }
  if (!rules.isValid(act)) {
    return { censored: false, reason: 'the act’s signature does not verify — a writer rightly excludes an invalid act (not censorship)' }
  }
  let derived: string
  try { derived = windowCommitment(seal, inclusionRoot) } catch (e) {
    return { censored: false, reason: 'malformed window — ' + (e instanceof Error ? e.message : String(e)) }
  }
  if (typeof anchoredCommitment !== 'string' || derived !== anchoredCommitment) {
    return { censored: false, reason: 'the inclusion root is not the one committed at this seal — an unfounded claim (a fabricated root is refused)' }
  }
  if (seal < deadline) {
    return { censored: false, reason: `this window (seal ${seal}) predates the act’s deadline (${deadline}) — inclusion was not yet owed` }
  }
  // seal ≥ deadline is sound ONLY because `inclusionRoot` is required to be CUMULATIVE through `seal`
  // (see CensorshipClaim.inclusionRoot): a key included in ANY window at seal ≤ this one is present, so
  // its absence here means it was never included by the deadline — not merely absent from one window.
  if (availableBySeal == null || !Number.isInteger(availableBySeal)) {
    return { censored: false, reason: 'absence is shown but availability is not — without a witness that the act was public by its deadline (inbox/gossip), absence is not proof of censorship' }
  }
  if (availableBySeal > deadline) {
    return { censored: false, reason: `the act was not public until seal ${availableBySeal}, after its own deadline (${deadline}) — innocent absence, not censorship` }
  }
  // ELIGIBILITY (the 3c ⋈ 3d seam) — an act is OWED inclusion only if it was applicable by its deadline.
  // 3c DEFERS a nonced act whose nonce is not its account's expected one; that deferral is honest (the
  // writer cannot apply nonce n before its predecessors without forging them), so it is NOT censorship.
  // Nonce-free acts (donations) are always eligible and skip the gate. For a nonced act we require STRICT
  // equality to the expected nonce AS OF THE DEADLINE: a higher nonce is a not-yet-eligible gap, a lower one
  // is a slot already filled by a superseded/losing double-signed sibling — neither was owed by the deadline.
  if (typeof act.nonce === 'number') {
    const expected = rules.expectedNonceAt?.(act, deadline)
    if (expected == null || !Number.isInteger(expected)) {
      return { censored: false, reason: 'eligibility cannot be checked — a nonced act needs the account’s expected nonce as of its deadline (the anchored applied state); absent that, deferral is indistinguishable from refusal and the writer is not convicted' }
    }
    if (act.nonce > expected) {
      return { censored: false, reason: `the act’s nonce (${act.nonce}) is a GAP above the account’s expected nonce (${expected}) at its deadline — it could not yet apply (the citizen’s own earlier nonces are missing), so the writer waiting is not censorship` }
    }
    if (act.nonce < expected) {
      return { censored: false, reason: `the act’s nonce (${act.nonce}) is below the account’s expected nonce (${expected}) at its deadline — that slot was already filled (a superseded or losing double-signed act), so inclusion of THIS act was not owed` }
    }
    // act.nonce === expected: the act sat at the eligible frontier and was owed inclusion by its deadline
  }
  const key = rules.keyOf(act)
  if (!verifyExclusion(inclusionRoot, key, absenceProof)) {
    return { censored: false, reason: 'the absence proof does not verify against the anchored root — the act may in fact be included' }
  }
  return { censored: true, key, seal, deadline }
}

/**
 * THE LIVE VERDICT (ADR-3 3d, wired) — the same verdict, but with its two remaining trusted inputs produced
 * FROM BITCOIN instead of taken on faith, uniting all four proven pieces into one trustless call:
 *   · availableBySeal  ← the availability WITNESS (a citizen's own Bitcoin anchor, SPV-re-derived): H ≤ deadline.
 *   · anchoredCommitment ← windowCommitment(seal, inclusionRoot), proven to be a MEMBER of the seal-window root
 *                          the writer folded into the cascade (3d-a). So "this seal committed this inclusion
 *                          root" is a fact a stranger checks, not a claim.
 * The absence (3a) and the signed deadline (C) are already trustless. Fail-closed with a named reason at every
 * gate. PURE — a verifier anyone runs against anchored data; it touches no writer and changes no consensus.
 *
 * THE ONE REMAINING LINK (stated, not hidden): `windowSealsRoot` must be the root the anchored cascade root
 * actually committed. Because the ledger cascade root is a SEQUENTIAL hash (not a merkle of components), that
 * proof is a FULL cascade opening — all ledger component values re-hashed to the anchored root, with the window
 * root among them (a `cascadeRootFromParts` mirroring ledger.cascadeRoot(), owed next). Until that opening is
 * supplied, `windowSealsRoot` is the caller's asserted-anchored input; every OTHER link here is trustless.
 */
export interface LiveCensorshipClaim<T extends SignedAct> {
  act: T
  seal: number                    // the Bitcoin seal height (3d-a; SPV-verified via BIP-34 by the caller/follower)
  inclusionRoot: string           // the cumulative inclusion root committed at that seal (3a/3d-a)
  absenceProof: MerkleProof       // 3a non-membership of the act key in inclusionRoot
  windowSealsRoot: string         // the anchored seal-window root (3d-a) — see "the one remaining link" above
  windowMembership: MerkleProof   // proof that windowCommitment(seal, inclusionRoot) is a member of windowSealsRoot
  availabilityProof: AvailabilityProof   // the act was public by height H — re-derived from Bitcoin bytes
}

export function verifyCensorshipLive<T extends SignedAct>(
  claim: LiveCensorshipClaim<T>,
  rules: CensorshipRules<T>,
  spv: { net: string; minConfirmations: number; minWork?: bigint },
): CensorshipVerdict {
  const key = rules.keyOf(claim.act)
  // 1 · AVAILABILITY, trustless — the act's key is a member of a Bitcoin-anchored root buried by height H
  const av = verifyAvailability(key, claim.availabilityProof, spv)
  if (!av.ok) return { censored: false, reason: `availability not proven: ${av.reason}` }
  // 2 · the anchoredCommitment is windowCommitment(seal, R), and it is a MEMBER of the seal-window root the
  //     writer folded into the cascade — so the (seal → inclusion root) binding is anchored, not asserted
  let wc: string
  try { wc = windowCommitment(claim.seal, claim.inclusionRoot) } catch (e) {
    return { censored: false, reason: 'malformed window — ' + (e instanceof Error ? e.message : String(e)) }
  }
  if (verifyProof(claim.windowSealsRoot, wc, claim.windowMembership) !== 'in') {
    return { censored: false, reason: 'the window commitment is not a member of the anchored seal-window root — this seal did not commit this inclusion root' }
  }
  // 3 · the verdict itself, now on facts: the anchored commitment + the SPV-proven availability height
  return verifyCensorship({
    act: claim.act,
    seal: claim.seal,
    inclusionRoot: claim.inclusionRoot,
    anchoredCommitment: wc,
    absenceProof: claim.absenceProof,
    availableBySeal: av.availableAtHeight,
  }, rules)
}

/**
 * THE FULLY-ANCHORED VERDICT (ADR-3 3d, the last link closed) — verifyCensorshipLive's one remaining trusted
 * input, `windowSealsRoot`, is now PROVEN to be what Bitcoin anchored, via the cascade OPENING: the prover
 * reveals the anchored root's parts, this re-hashes them (cascadeRootFromParts) to the root Bitcoin committed,
 * and the window root among those parts is therefore anchored — not asserted. The ONLY external input left is
 * `anchoredCascadeRoot`, the 32 bytes Bitcoin actually sealed, produced by the already-proven anchor SPV
 * (verifySealProof / KrayAnchor.decode). With that, every link of the censorship verdict is a fact re-derived
 * from Bitcoin. Fail-closed with a named reason at every gate. PURE — no writer/consensus touch.
 *
 * VALIDATING-REPLICA REQUIREMENT (verify council, stated not hidden): this verdict checks that
 * windowCommitment(seal, R) is a MEMBER of the anchored window root, but it TRUSTS that `seal` (l1Height) is the
 * REAL Bitcoin height at which R was anchored — it does not re-derive the height here. That realness is the
 * FOLLOWER's job: kray-follow.mjs section 4b re-proves every activated seal's l1Height from its own bitcoind,
 * bound to the l1Root the anchor commits (the 3d-a "enforced twice"). So a party that will ACT on a CENSORED
 * verdict (fork-choice, slashing, succession) MUST consume `windowSeals` only from a journal a follower has
 * seal-height-re-proven; a light client that merely opens the cascade inherits the height's realness from that
 * follower, exactly as it inherits the anchor from the anchor SPV. The pure verdict alone is necessary, not
 * sufficient, for the height.
 */
export interface AnchoredCensorshipClaim<T extends SignedAct> {
  act: T
  seal: number                    // the Bitcoin seal height
  inclusionRoot: string           // the cumulative inclusion root committed at that seal (R at the seal)
  absenceProof: MerkleProof       // 3a non-membership of the act key in inclusionRoot
  windowMembership: MerkleProof   // windowCommitment(seal, inclusionRoot) is a member of cascadeParts.windowRoot
  availabilityProof: AvailabilityProof   // the act was public by height H — re-derived from Bitcoin bytes
  cascadeParts: CascadeParts      // the revealed parts of the anchored cascade root (the opening)
  anchoredCascadeRoot: string     // the 32 bytes Bitcoin sealed (from verifySealProof / KrayAnchor.decode — proven)
  /** ADR-3 eligibility opening — for a NONCED act, the proof of act.from against cascadeParts.nonceRoot. The
   *  verifier reads (nonce, first-anchor height) from it and derives expected@deadline TRUSTLESSLY (no caller
   *  assertion). Omitted for a nonce-free donation (always eligible; the gate is skipped). */
  nonceMembership?: NonceProof
}

export function verifyCensorshipAnchored<T extends SignedAct>(
  claim: AnchoredCensorshipClaim<T>,
  rules: CensorshipRules<T>,
  spv: { net: string; minConfirmations: number; minWork?: bigint },
): CensorshipVerdict {
  // 1 · THE OPENING — the revealed parts must re-hash to the root Bitcoin anchored, so their window root IS
  //     anchored (a sequential-hash root cannot be opened at one component without revealing them all)
  let derivedRoot: string
  try { derivedRoot = cascadeRootFromParts(claim.cascadeParts) } catch (e) {
    return { censored: false, reason: 'malformed cascade parts — ' + (e instanceof Error ? e.message : String(e)) }
  }
  if (typeof claim.anchoredCascadeRoot !== 'string' || derivedRoot !== claim.anchoredCascadeRoot.toLowerCase()) {
    return { censored: false, reason: 'the revealed cascade parts do not re-hash to the anchored root — an unfounded opening (a fabricated window root is refused here)' }
  }
  const windowSealsRoot = claim.cascadeParts.windowRoot
  if (windowSealsRoot === undefined) {
    return { censored: false, reason: 'the anchored cascade committed no window root — the inclusion regime was not active at this seal, so no omission was yet provable' }
  }
  // 2 · ELIGIBILITY, trustless (the 3c ⋈ 3d seam) — for a NONCED act, DERIVE expected@deadline from the anchored
  //     nonce root instead of trusting the caller's expectedNonceAt. The sticky first-anchor height h_A makes one
  //     reading from this single opening (seal ≥ deadline) yield expected@deadline exactly (or fail-closed):
  //       · absent (n_A=0)        → expected@deadline = 0 (applied-count is monotone; absent now ⇒ absent then)
  //       · h_A ≥ 1 ∧ h_A ≤ D     → the account has held n_A since a real seal ≤ D ⇒ expected@deadline = n_A EXACTLY
  //       · h_A > D or sentinel 0 → reached n_A only after D (or unanchored) ⇒ acquit fail-closed (a deferral is
  //                                 not a refusal). This kills the rollback attack structurally (same read at any ≥ D).
  let eligibilityRules = rules
  if (typeof claim.act.nonce === 'number') {
    if (claim.cascadeParts.nonceRoot === undefined) {
      return { censored: false, reason: 'the anchored cascade committed no nonce root — eligibility is not provable at this seal' }
    }
    const from = claim.act.from
    if (typeof from !== 'string' || !from) {
      return { censored: false, reason: 'a nonced act must name its account (from) for the eligibility opening' }
    }
    const proven = verifyNonceProof(claim.cascadeParts.nonceRoot, from, claim.nonceMembership as NonceProof)
    if (proven == null) {
      return { censored: false, reason: 'the nonce opening does not verify against the anchored nonce root — eligibility is unproven, the writer is not convicted' }
    }
    const { nonce: nA, height: hA } = proven
    eligibilityRules = {
      ...rules,
      expectedNonceAt: (_act, deadline) => {
        if (nA === 0) return 0                                   // absent ⇒ expected@deadline = 0
        if (hA >= 1 && hA <= deadline) return nA                 // held n_A since a real seal ≤ D ⇒ expected@deadline = n_A
        return null                                              // h_A > D or sentinel ⇒ fail-closed acquit
      },
    }
  }
  // 3 · now windowSealsRoot is ANCHORED, not asserted, and (for a nonced act) eligibility is derived from the
  //     anchored nonce root — run the live verdict
  return verifyCensorshipLive({
    act: claim.act,
    seal: claim.seal,
    inclusionRoot: claim.inclusionRoot,
    absenceProof: claim.absenceProof,
    windowSealsRoot,
    windowMembership: claim.windowMembership,
    availabilityProof: claim.availabilityProof,
  }, eligibilityRules, spv)
}

/**
 * THE PROVER (ADR-3 3d) — the mirror of verifyCensorshipAnchored: what a citizen or follower RUNS to GENERATE the
 * censorship evidence from the chain's own state at a seal, so the verdict has something to check. The two are
 * symmetric — build a claim here, and verifyCensorshipAnchored returns CENSORED (or the honest not-censored
 * reason). Pure: it composes the chain's own commitments —
 *   · inclusionRoot / absenceProof ← the inclusion tree AT THAT SEAL (its root, and the act key's non-membership);
 *   · windowMembership ← proof that windowCommitment(seal, inclusionRoot) is in the seal-window set the writer
 *     folded (so the (seal → root) binding the anchored cascade committed is the one being proven);
 *   · cascadeParts / anchoredCascadeRoot ← the opening of the root Bitcoin sealed;
 *   · availabilityProof ← the citizen's own Bitcoin availability anchor (built with proveAvailability).
 * The caller supplies the state (a follower replays the journal to the seal to obtain the tree + window set +
 * parts; the anchoredCascadeRoot comes from the anchor SPV) — this assembles it into one checkable claim.
 */
export interface CensorshipProverState {
  seal: number                                                   // the Bitcoin seal height
  inclusionTree: { root(): string; prove(keyHex: string): MerkleProof }   // the inclusion tree AT that seal
  windowSeals: Iterable<string>                                  // the seal-window commitments the cascade folded
  cascadeParts: CascadeParts                                     // the opened parts of the anchored cascade root
  anchoredCascadeRoot: string                                   // the 32 bytes Bitcoin sealed (from the anchor SPV)
  /** the account nonce map AT that seal — supplies the eligibility opening for a nonced act (ledger.proveNonce) */
  nonceMap?: { prove(address: string): NonceProof }
}

export function buildCensorshipClaim<T extends SignedAct>(
  act: T,
  availabilityProof: AvailabilityProof,
  state: CensorshipProverState,
  rules: Pick<CensorshipRules<T>, 'keyOf'>,
): AnchoredCensorshipClaim<T> {
  const key = rules.keyOf(act)
  const inclusionRoot = state.inclusionTree.root()               // R at the seal
  const absenceProof = state.inclusionTree.prove(key)            // the act key's non-membership in R
  const wc = windowCommitment(state.seal, inclusionRoot)
  const windowMembership = proveKey(state.windowSeals, wc)       // wc is a member of the folded seal-window set
  // for a nonced act, attach the eligibility opening (act.from's proof against the anchored nonce root)
  const nonceMembership = (typeof act.nonce === 'number' && typeof act.from === 'string' && act.from)
    ? state.nonceMap?.prove(act.from) : undefined
  return {
    act,
    seal: state.seal,
    inclusionRoot,
    absenceProof,
    windowMembership,
    availabilityProof,
    cascadeParts: state.cascadeParts,
    anchoredCascadeRoot: state.anchoredCascadeRoot,
    ...(nonceMembership ? { nonceMembership } : {}),
  }
}
