/**
 * THE CASCADE ROOT, FROM ITS PARTS (ADR-3 · the cascade opening) — ONE law, two callers, zero drift.
 *
 * The cascade root the ledger anchors to Bitcoin is a SEQUENTIAL hash over each subsystem's committed value
 * (money, stars, pot, seals, runes, contracts, amm, and — post-activation — the inclusion and window roots).
 * Because it is a sequential hash and not a merkle of components, proving that ONE component (the seal-window
 * root 3d's verdict rests on) is part of an anchored root requires REVEALING ALL of them and re-hashing: a full
 * "opening" of the anchored root. This module is that re-hash, made the SINGLE SOURCE OF TRUTH — `ledger.
 * cascadeRoot()` builds these parts and calls this function, and a censorship verifier calls the very same
 * function on the parts a prover reveals, so the two can never disagree by construction (no parallel formula to
 * drift). A field is present in `CascadeParts` iff it folds today, so an all-empty history opens to the same
 * bytes it always did — a format anchored on Bitcoin may only ever GROW (axiom A3).
 */
import { createHash } from 'node:crypto'

export interface CascadeParts {
  seq: number
  emitted: string           // bigint, decimal string
  burned: string            // bigint, decimal string
  moneyRoot: string
  starsRoot: string
  potCommitment: string     // the pot's own already-labelled commitment line
  runesCommitment: string
  contractsRoot: string
  /** present ONLY when the subsystem folds today (conditional components, appended in this exact order) */
  seals?: { count: number; root: string }
  qcommits?: { count: number; root: string }
  qmigrated?: string[]      // the sorted account list (folded as a comma-join)
  ammCommitment?: string
  inclusionRoot?: string    // ADR-3 A — present iff at/after the inclusion activation seq
  windowRoot?: string       // ADR-3 3d-a — present iff at/after the inclusion activation seq (with inclusionRoot)
  nonceRoot?: string        // ADR-3 eligibility opening — present iff at/after the inclusion activation seq (with inclusion/window)
  xRoot?: string            // Ӿ transferable book — present iff at/after the Ӿ transfer activation seq (slice 2; A3)
  fireRoot?: string         // THE FIREBORN LAW tank book — present iff at/after the feeless activation seq (A3)
  laneRoot?: string         // THE TK-FOLD lane book (Gate 2) — present iff at/after the fold activation seq (appended LAST, A3)
  marketCommitment?: string // THE STAR MARKET order book — present iff a listing exists (by presence, the AMM pattern; A3)
  offerCommitment?: string  // ESCROWED STAR OFFERS — present iff a live bid exists (A3 grow-only, after market)
  cutCommitment?: string    // Luz / CutBook (KRC-77) — present iff a star has portioned Luz (A3 by presence)
  faceCommitment?: string   // CITIZEN FACE — address→owned star; present iff at least one face is set (A3 by presence)
  profileCommitment?: string // CITIZEN MOUTH — address→bio/url/banner; present iff at least one mouth is set (A3 by presence)
  /** KRAY PLATE — living plate (addr→hash and/or star→hash); present iff at least one plate is set (A3 by presence) */
  krayPlateCommitment?: string
  /** THE PACKET MARKET order book (₭ / Luz / rune packets) — present iff a listing exists (by presence,
   *  the AMM pattern; appended LAST, A3): with no packet listed the field is absent, so every anchored root
   *  before this law — and an empty genesis — opens byte-identically. */
  packetCommitment?: string
  /** THE CLAIM ESCROW book — present iff a harvest is open (by presence, appended LAST, A3). It commits the
   *  root, what it holds, what it has paid and the chain of hands that took, so a stranger can verify a
   *  claim from the anchored bytes alone. */
  claimCommitment?: string
  /** THE STANDING POOLS — present iff a pool exists (by presence, appended LAST, A3). It commits what each
   *  pool holds, what its live seasons may still draw, and the horizon its owner may draw back at. */
  poolCommitment?: string
}

/** Re-derive the cascade root from its parts — byte-identical to `ledger.cascadeRoot()`, which IS this. */
export function cascadeRootFromParts(p: CascadeParts): string {
  const h = createHash('sha256')
    .update('kraynet\n', 'utf8')
    .update(`seq:${p.seq}\n`, 'utf8')
    .update(`emitted:${p.emitted}|burned:${p.burned}\n`, 'utf8')
    .update(`money:${p.moneyRoot}\n`, 'utf8')
    .update(`stars:${p.starsRoot}\n`, 'utf8')
    .update(`${p.potCommitment}\n`, 'utf8')
  if (p.seals) h.update(`seals:${p.seals.count}|${p.seals.root}\n`, 'utf8')
  if (p.qcommits) h.update(`qcommits:${p.qcommits.count}|${p.qcommits.root}\n`, 'utf8')
  if (p.qmigrated) h.update(`qmigrated:${p.qmigrated.join(',')}\n`, 'utf8')
  h.update(`runes:${p.runesCommitment}\n`, 'utf8')
  h.update(`contracts:${p.contractsRoot}\n`, 'utf8')
  if (p.ammCommitment !== undefined) h.update(`amm:${p.ammCommitment}\n`, 'utf8')
  if (p.inclusionRoot !== undefined) h.update(`inclusion:${p.inclusionRoot}\n`, 'utf8')
  if (p.windowRoot !== undefined) h.update(`window:${p.windowRoot}\n`, 'utf8')
  if (p.nonceRoot !== undefined) h.update(`nonce:${p.nonceRoot}\n`, 'utf8')   // ADR-3 (A3): undefined ⇒ byte-identical history
  if (p.xRoot !== undefined) h.update(`x:${p.xRoot}\n`, 'utf8')               // Ӿ book (A3): undefined below activation ⇒ byte-identical
  if (p.fireRoot !== undefined) h.update(`fire:${p.fireRoot}\n`, 'utf8')      // FIREBORN tank (A3): undefined below activation ⇒ byte-identical
  if (p.laneRoot !== undefined) h.update(`lane:${p.laneRoot}\n`, 'utf8')      // TK-FOLD lane — appended LAST (A3): undefined below activation ⇒ byte-identical
  if (p.marketCommitment !== undefined) h.update(`market:${p.marketCommitment}\n`, 'utf8')   // STAR MARKET (A3): undefined when no listing exists ⇒ byte-identical to a pre-market history
  if (p.offerCommitment !== undefined) h.update(`offers:${p.offerCommitment}\n`, 'utf8')     // STAR OFFERS (A3): undefined when the book is empty ⇒ byte-identical genesis
  if (p.cutCommitment !== undefined) h.update(`cut:${p.cutCommitment}\n`, 'utf8')           // Luz CutBook (A3): undefined when no star has portioned hair ⇒ byte-identical
  if (p.faceCommitment !== undefined) h.update(`faces:${p.faceCommitment}\n`, 'utf8')       // CITIZEN FACE (A3): undefined when no face is set ⇒ byte-identical genesis
  if (p.profileCommitment !== undefined) h.update(`profiles:${p.profileCommitment}\n`, 'utf8') // CITIZEN MOUTH (A3): undefined when no mouth is set ⇒ byte-identical genesis
  if (p.krayPlateCommitment !== undefined) h.update(`kray-plates:${p.krayPlateCommitment}\n`, 'utf8') // KRAY PLATE (A3): undefined when no plate ⇒ byte-identical genesis
  if (p.packetCommitment !== undefined) h.update(`packets:${p.packetCommitment}\n`, 'utf8') // PACKET MARKET (A3): undefined when no packet is listed ⇒ byte-identical to every pre-packet history
  if (p.claimCommitment !== undefined) h.update(`claims:${p.claimCommitment}\n`, 'utf8') // CLAIM ESCROW (A3): undefined when no harvest is open ⇒ byte-identical to every pre-claim history
  if (p.poolCommitment !== undefined) h.update(`pools:${p.poolCommitment}\n`, 'utf8') // STANDING POOLS (A3): undefined when none exists ⇒ byte-identical to every pre-pool history
  return h.digest('hex')
}
