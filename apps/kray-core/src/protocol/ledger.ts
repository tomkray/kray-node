/**
 * The Ledger — fungible KRAY, conserved as EMITTED − BURNED.
 *
 * KRAY is a plain fungible balance (no numbers, no ranges). It is EMITTED by the
 * proof-of-donation mint (Phase 2: real sats sacrificed to the anchoring pot) and
 * BURNED to create a star (an inscribe / origin / baptism turns 1 ₭ into a permanent,
 * non-fungible creation). There is no fixed supply cap and no premine.
 *
 * THE ONE INVARIANT is an equation of what really happened, checked on every apply
 * and every replay, or HALT:
 *
 *     Σ all balances  ==  Σ emitted  −  Σ burned
 *
 * A transfer's 1-₭ fee moves WITHIN the balances (payer → Treasury, the validator
 * reward loop), so it never changes the total. Only the mint raises it; only the
 * burn lowers it. The star registry (starmap) records the created stars; this
 * ledger owns the money and the conservation. Both are pure functions of the journal.
 */
import { createHash } from 'node:crypto'
import { StarRegistry } from './starmap.ts'
import { NAME_MAX_BYTES } from './star-lore.ts'
import { AnchoringPot, DEFAULT_POT_TARGET_SATS, MINT_CAP_SATS, WINDOW_PER_SEAL_SATS } from './pot.ts'
import {
  isSupportedScheme, toBtcNet, scriptOfAddress, verifySignature, isAddressOnNetwork,
  transferMessage, xSendMessage, cutSendMessage, burnMessage, sendStarMessage, starListMessage, starDelistMessage, starBuyMessage, starOfferMessage, starOfferCancelMessage, starOfferAcceptMessage, inscribeMessageV2, nameMessageV2, originMessageV2,
  inscribeMessageV3, inscribeMessageV4, inscribeMessageV5, inscribeMessageV6, originCohortRootOf, originChildBindOf,
  assertInscriptionMeta, BODY_HASH_RE, ORIGIN_COHORT_MAX,
  MAX_PARENTS_PER_ACT, MAX_ORIGINS_PER_ACT, ORDINAL_ID_RE,
  runeSendMessage, runeExitMessage, runeCancelMessage, ammAddMessage, ammRemoveMessage, ammSwapMessage, ammRrAddMessage, ammRrRemoveMessage, ammRrSwapMessage, contractMessage, contractMessageV2, contractCallMessage, contractCallMessageV2, eternizeMessage, quantumCommitMessage, quantumMigrateMessage,
} from './scheme.ts'
import { parseOriginProofs, verifyOriginProofs } from './ordinal-ancestry.ts'
import { emptyLane, laneRoot, laneTotal, applyFoldDiffs, foldDiffsHash, parseLaneAmount, type FoldDiffs } from './tk-fold.ts'
import { verifyFoldProof, decodeFoldPublic } from './fold-verifier.ts'
import { laneEnterMessage, laneExitMessage, foldSealMessage } from './scheme.ts'
import { lamportVerify, lamportPublicKeyFromHex, lamportSignatureFromHex, lamportPublicKeyCommit } from './lamport.ts'
import { RuneBook, parseRuneKey, canonicalRuneKey } from '../economics/rune-book.ts'
import { settleFromBeats } from '../economics/settlement.ts'
import { hitCount, custodyFromHex, verifyCustody, type AtlasOracle } from '../economics/custody.ts'
import { assertPresenceClaims, assertPresenceEra, foldClaimsByAddress, readPresenceTip } from '../economics/presence-window.ts'
import { validateContract, canonicalCode, runCall, contractAddress, isContractPotAddress, type ContractCode } from './contract.ts'
import { isMintPaper, isCutPaper, isPollPaper, resolveLuzGenesis } from './star-forms.ts'
import { CutBook } from './cut-book.ts'
import { PollBook } from './poll-book.ts'
import { sha256hex, MIN_FEE, TREASURY, BLACK_HOLE, STAR_OFFER, MAX_INSCRIPTION_BYTES, MAX_INSCRIPTION_PROPORTION, starBurnOf, BYTES_PER_KRAY_BURN, BYTES_PER_KRAY_PROPORTION, BYTES_PER_KRAY_MIN, BYTES_PER_KRAY_MIN_PROPORTION, SEAL_CONTENT_BUDGET, RETARGET_WINDOW_SEALS, retargetBytesPerKray, donationProofMinConf, SIZE_PROPORTION_ACTIVATION_SEQ, STAR_RE, type KrayEvent, type SettlementRow } from './kray-primitives.ts'
import { verifyDonationProof } from '../anchor/spv.ts'   // ADR-1: pure/offline SPV re-verify (no network) — safe in the reducer
import { selfAnchorScriptHex } from './self-anchor.ts'   // ADR-1 extended: re-derive a self-anchor burn script from (pot key, sealed payload) — pure, offline
import { KrayAnchor } from '../anchor/anchor.ts'         // KrayAnchor.payload — the one canonical anchor payload codec (static, offline)
import { verifyRuneDepositProof, verifyRuneSettleProof } from './rune-bridge.ts'   // ADR-1 extended to the rune peg — same purity, same law
import { proveInscription } from './inscription-proof.ts'   // ADR-1 extended to ETERNIZE — the L1 carving re-proven from raw bytes, offline
import type { ProvenTx } from './rune-ancestry.ts'
import type { RuneBalance } from './runestone.ts'   // THE KEYSTONE: the journal's accumulated per-rune outpoint truth
import { AmmBook, ammPoolAddress, ammRrPoolAddress, isAmmPotAddress, quoteAdd, quoteFirstMint, quoteOut, quoteRemove, rrPairKey } from './amm.ts'
import { StarMarket } from './star-market.ts'   // native, atomic, trustless star order book — folds by presence (A3), never touches Σ
import { StarOffers } from './star-offers.ts'   // escrowed bids — pot ₭ == book, or HALT
import { inclusionRoot as buildInclusionRoot, IncrementalInclusionTree } from './inclusion-tree.ts'   // ADR-3 3a (Slice A): the cumulative included-act SMT
import { IncrementalNonceMap } from './nonce-map.ts'   // ADR-3 eligibility opening: the committed account→(nonce,height) map
import { keyFromSignedMessage, orderWindow } from './window-order.ts'   // ADR-3 3c: the leaf key = SHA-256 of the SIGNED message ONLY (no envelope, no clock); orderWindow = THE SAME-INSTANT LAW's arithmetic
import { signedBytesOfEvent } from './signed-message.ts'   // the MIRROR — requireSig is the REFEREE that re-proves parity on every act, every replay
import { windowCommitment } from './censorship-evidence.ts'   // ADR-3 3d-a: binds a Bitcoin seal height to that seal's cumulative inclusion root
import { cascadeRootFromParts, type CascadeParts } from './cascade-root.ts'   // ADR-3: the cascade root, from its parts — one law, no drift

/**
 * ADR-3 · Slice A (Article XIV) — the ledger seq at/after which the cumulative included-act root folds into the
 * cascade root, PER NETWORK. BELOW it the component is ABSENT, so every root already buried on Bitcoin re-derives
 * BYTE-IDENTICALLY (axiom A3 — no anchored history is orphaned). Default = NOT-YET-ACTIVATED on every live
 * network: the feature is built and wired but folds nowhere until the Creator ratifies a real FUTURE height
 * (Article XIV: an objective activation condition). A test injects a small value to exercise both sides.
 *
 * SIGNET RATIFIED (the Creator, 2026-08-23): H = 155, pinned live at deploy while the tip stood at 149
 * (the deploy-race rite from the burn law — never hardcode blind; the margin covers the fleet→writer
 * window, and the writer restarts long before the tip can cross it). Every seal at/after seq 155 folds
 * the cumulative inclusion root + the per-seal window + the nonce map into the cascade root; every root
 * anchored below 155 re-derives byte-identically (A3). This is the LIVE-CHAIN UPGRADE TEST from
 * docs/PEN-ACTIVATION-DECISION.md — the rehearsal for mainnet, which is born activated (H = 0) at genesis.
 * Regtest stays MAX on purpose: live lab journals were sealed without the fold and must keep replaying
 * byte-exact — the swarm exams inject their own seq to exercise both sides.
 */
const INCLUSION_ACTIVATION_SEQ: Record<string, number> = {
  regtest: Number.MAX_SAFE_INTEGER,
  signet: 0,   // v1.0.0 genesis reset (2026-08-26): the old chain (pin 155) is retired; the new signet is BORN ACTIVE like main
  main: 0,
}

/** PROOF-MANDATORY ACTIVATION (audit 2026-08-28, ratified with the twin rebirth) — at/after this seq the
 *  REDUCER refuses an L1-peg event (donate / rune-deposit / rune-settle) that does not embed its own SPV
 *  proof. Below it, an absent proof is byte-identical to the old law (the door gates — the honest limit
 *  AXIOMS.md used to name). Signet and mainnet are reborn at 0 events, so both are BORN STRICT: the journal
 *  can never contain a proofless mint. Regtest stays MAX — the lab's dev-mint (KRAY_TRUSTED_DEV) is a bench
 *  tool, never a chain anyone follows. Verification polarity is unchanged: a PRESENT proof is re-proven
 *  wherever the node holds the pot script/key, and present-but-false HALTs. */
const PROOF_MANDATORY_SEQ: Record<string, number> = {
  regtest: Number.MAX_SAFE_INTEGER,
  signet: 0,   // reborn 2026-08-28 — born strict
  main: 0,     // born strict at genesis
}

/** RUNE-ANCESTRY MANDATORY (THE KEYSTONE, 2026-08-28/29 — ratified while both books held zero
 *  transactions) — at/after this seq the REDUCER refuses a rune-deposit OR rune-settle whose
 *  proof does not embed the recursive ancestry bundle, and re-derives the input rune state
 *  FROM BYTES (rune-ancestry.ts): every parent buried under weighed work, the allocation law
 *  re-run link by link, terminating at the rune's own etch (a premine needs no other witness)
 *  or at an outpoint THIS journal already re-derived (deposits + earlier settles' consolidation
 *  change — the accumulated truth). `inputRunes` stops being ord's word on these networks: the
 *  journal can never contain a rune credit or burn whose input state is an attestation.
 *  Regtest stays MAX — the bench keeps the dev path; tests inject 0. */
const RUNE_ANCESTRY_MANDATORY_SEQ: Record<string, number> = {
  regtest: Number.MAX_SAFE_INTEGER,
  signet: 0,   // born strict — zero events at ratification
  main: 0,     // born strict — zero events at ratification
}

/**
 * Ӿ TRANSFER ACTIVATION (slice 2 — the transferable book joins the anchored root). DORMANT on every network
 * until the Creator ratifies a real FUTURE seq: below it, `x-send` is refused (HALT) and the Ӿ root folds
 * NOWHERE (byte-identical history, A3); at/after it, Ӿ moves by signature and its book folds into the cascade
 * root. The MINT (slice 1) is always live and re-derivable; only the transfer + the root-commitment wait here.
 * A test injects a small value to exercise both sides.
 *
 * SIGNET RATIFIED (the Creator, 2026-08-23): seq 155 — the SAME rite, the same pinned height as the
 * inclusion fold above (one upgrade, one seq, one story to audit). Below 155 every anchored signet root
 * re-derives byte-identically; at/after it Ӿ moves by signature and its book folds into the root.
 * Mainnet is born activated (0). Regtest stays MAX on purpose: live lab journals were sealed without
 * the fold and must keep replaying byte-exact — the swarm exams inject their own seq to exercise both sides.
 */
const X_TRANSFER_ACTIVATION_SEQ: Record<string, number> = {
  regtest: Number.MAX_SAFE_INTEGER,
  signet: 0,   // v1.0.0 genesis reset: born active (old-chain pin was 155)
  main: 0,
}

/**
 * THE FIREBORN LAW (stage 1 — the Creator's ratified design, council rounds 1–7 in docs/X-FEELESS-DECISION.md):
 * "burn once, move forever (within the tank)". Every ₭ burned that mints Ӿ ALSO mints a finite, non-transferable,
 * non-regenerating lifetime allowance of feeless x-sends to the burner (F per ₭). At/after this per-network seq
 * the ledger PRESCRIBES the x-send fee — no client choice, no writer malleability (the signed domain carries no
 * fee, so the fee must never be a choice): if the tank has allowance AND the 3.5-second gap law holds, the fee
 * MUST be 0 and the tank decrements; otherwise the fee MUST be the eternal 1 ₭ (the paid path is the fallback,
 * never removed). Total journal bytes stay bounded by capital destroyed: Σ feeless sends ≤ F × ₭ burned — the
 * 3.5-second-bot refutation answered by fire, not fees. Below the seq: byte-identical history — the tank accrues
 * silently from every burn (pure derived state, retroactive: the fire always paid) but folds NOWHERE and spends
 * NOTHING (A3). signet: pinned at deploy as live tip + margin (tip was 209 at design). Mainnet born active (0).
 * Regtest stays MAX on purpose — lab journals replay byte-exact; exams inject their own seq (KRAY_LAB_FIREBORN_SEQ).
 */
const X_FEELESS_ACTIVATION_SEQ: Record<string, number> = {
  regtest: Number.MAX_SAFE_INTEGER,
  signet: 0,   // v1.0.0 genesis reset: born active (old-chain pin was 245)
  main: 0,
}

/**
 * THE TK-FOLD ACTIVATION (Gate 2 — docs/TK-FOLD-DESIGN.md, council rounds in docs/X-FEELESS-DECISION.md):
 * from this per-network seq the compressed lane exists in consensus — `lane-enter` moves spendable Ӿ into
 * the lane, `lane-exit` moves it back, and a `fold-seal` lands one PROVEN breath: a constant-size Groth16
 * proof of the ONE pinned guest program (TK_FOLD_VKEY_HASH), verified by the vendored WASM verifier on
 * apply AND on replay (the same code path — a re-syncing stranger re-verifies every fold), plus the sorted
 * state diffs (the Creator's re-sync law: every lane balance rebuilds from journal bytes alone). Below the
 * seq all three kinds are refused (HALT) and the lane root folds NOWHERE — a dormant, genesis-safe slice
 * (A3). signet: PINNED at the Gate 3b crossing rite (2026-08-24) as live tip + margin — the tip was 248
 * (quiet since the FIREBORN crossing), pin 255, the 149→155 discipline, never hardcoded blind. Mainnet
 * born active (0). Regtest stays MAX on purpose — live lab journals replay byte-exact; exams inject
 * their own seq (KRAY_LAB_TK_FOLD_SEQ).
 */
const TK_FOLD_ACTIVATION_SEQ: Record<string, number> = {
  regtest: Number.MAX_SAFE_INTEGER,
  signet: 0,   // v1.0.0 genesis reset: born active (old-chain pin was 255)
  main: 0,
}
/** Fireborn allowance minted per ₭ burned — 1 ₭ of fire prepays this many feeless Ӿ moves, for life. */
export const FIREBORN_SENDS_PER_KRAY = 1000n
/** Fireborn gap law (burst limiter): one feeless x-send per address per fast-block cadence (3.5 s). */
export const FIREBORN_GAP_MS = 3500

/**
 * THE BURN LAW (the Creator's ratified law, council-approved 4/4): "₭ can NEVER be frozen — only BURNED.
 * Freeze is only for stars." From this per-network seq, ONE constant gates THREE clauses together:
 *   (1) fungible ₭ aimed at KRAY_BLACK_HOLE is REFUSED on every user-reachable path (the choke point);
 *   (2) the signed `burn` kind is valid — destroy your own ₭, Ӿ born 1:1 to you;
 *   (3) the one-shot `burn-thaw` is allowed — the ₭ frozen at the hole BEFORE the law transmutes into a
 *       true burn, minting Ӿ to the ORIGINAL senders (re-derived from the journal; nothing rewritten).
 * Below the seq, history replays exactly as it always did (A3 — the anchored roots stay byte-identical).
 * regtest/main = 1: clean networks, the law from block zero (a fungible freeze never exists there).
 * signet: MUST be pinned at deploy as tip+1 (the council's deploy-race fix — never hardcode blind; the
 * writer re-reads its tip during the rite). 149 is the nominal value recorded at design time (tip was 148).
 */
const BURN_LAW_SEQ: Record<string, number> = {
  regtest: 1,
  signet: 1,   // v1.0.0 genesis reset: the law from block zero (old-chain pin was 149 — that chain carried one pre-law hole-credit)
  main: 1,
}

/**
 * THE REWARD RETIREMENT (council + adversary verdict, 2026-08-23): the unsigned `reward` kind was the last
 * writer-trusted payout in the money layer — conserved and pool-bounded, but its ENTITLEMENT was never
 * re-derivable on replay (a follower accepted "TREASURY → X" on the writer's word). The live validator payout
 * (`settlement`) re-derives its whole table from journaled beats and HALTs on disagreement — self-proving —
 * so `reward` is RETIRED, not armored: from this seq the kind is refused everywhere. Verified before pinning:
 * ZERO `reward` events exist in any live journal (signet 149/149 replayed) and the anchor backstop is off, so
 * seq 1 is PROVABLY byte-identical on every network — nothing anchored is orphaned (A3). If the anchor
 * backstop is ever lit, its successor pays the FIRST VALID SEALER, where the SPV proof IS the entitlement
 * (no draw — the adversary proved a journaled draw would be a false-green). Benches inject a high seq to
 * exercise the historical semantics.
 */
const REWARD_RETIRED_FROM_SEQ: Record<string, number> = {
  regtest: 1,
  signet: 1,
  main: 1,
}

/**
 * THE ATLAS FEE (branch A of docs/ATLAS-FEE-DECISION.md — the Creator's ratification, 2026-08-23):
 * from this per-network seq, an inscribe/origin pays — BESIDE the untouched size burn (full deflation
 * stays word-for-word as ratified 2026-08-13) — a wall-toll under the SAME linear law at the SAME era
 * rate, credited to TREASURY (the fee pool the validators' self-proving settlement re-derives):
 *
 *   atlasFee(size) = 0                                      if size == 0  (names/empty stars: unchanged)
 *   atlasFee(size) = max(1, ceil(size / bytesPerKrayNow))   otherwise
 *
 * Payer-funded and conserved (credit TREASURY == debit creator — the tripwire never moves); LINEAR, so
 * split/merge-neutral (the same Cauchy theorem as the burn); no new oracle (one breathing rate prices
 * both the fire and the wall). Below the seq the fee is absent and every anchored root replays
 * byte-identically (A3). main: born activated (0) — no history, no migration window. regtest stays
 * MAX so lab goldens replay byte-exact; a test injects a seq to exercise both sides.
 *
 * SIGNET PINNED AT DEPLOY (2026-08-23, the deploy-race rite): live tip re-read as seq 157 during the
 * rite, pinned at 165 (tip + 8 margin — the same discipline as the pen's 149→155). The disposable-node
 * proof replayed the live 157-event journal through THIS code at THIS pin: byte-identical root,
 * conservation intact, and a retroactive activation HALTs (the gate is real, not decorative).
 */
const ATLAS_FEE_ACTIVATION_SEQ: Record<string, number> = {
  regtest: Number.MAX_SAFE_INTEGER,
  signet: 0,   // v1.0.0 genesis reset: born active (old-chain pin was 165)
  main: 0,
}

/**
 * THE SAME-INSTANT LAW (ratified 2026-08-23 — docs/SAME-INSTANT-ORDER-DECISION.md): user acts the
 * writer stamps into the SAME millisecond (`at`) must stand in the journal in the one order
 * arithmetic derives — `orderWindow` over sha256(signed bytes), the ungrindable 3c key — or the act
 * is refused BEFORE any mutation (live door) and a lying journal HALTs every follower on replay
 * (same throw, same code path). Within simultaneity neither the writer nor the socket chooses; the
 * mathematics does. Across distinct instants time orders — a NAMED residue: `at` rides the anchored
 * bytes, and the pen's inclusion evidence already scars omission/delay. Below the seq the law is
 * absent and every anchored root replays byte-identically (A3). regtest stays MAX so lab goldens
 * replay byte-exact; the :4477 swarm and every unit test inject a seq to exercise both sides.
 */
const SAME_INSTANT_ORDER_ACTIVATION_SEQ: Record<string, number> = {
  regtest: Number.MAX_SAFE_INTEGER,
  // v1.0.0 genesis reset (2026-08-26): the new signet is BORN ACTIVE like main. The old chain's
  // deploy-rite pin was 175 (tip 166 + 9 margin, the 149→155 / 157→165 discipline) — retired with
  // that journal by the Creator's explicit ratification; the rite itself stays documented in
  // docs/SAME-INSTANT-ORDER-DECISION.md.
  signet: 0,
  main: 0,
}

/**
 * THE UNIQUE-RELIC LAW (ratified 2026-08-31): a second claim on the same name, the same
 * content hash, or the same body hash is REFUSED before any fire — the Buy fractal
 * (A5: first writer wins; a lost uniqueness race is not a star and does not burn).
 * Below the seq a cursed birth still burns (A3 — journals that already scarred a
 * paid-to-try attempt replay byte-identically). The official door already 409s
 * without burning; at/after this pin the reducer speaks the same sentence.
 *
 * Pins: regtest stays MAX so goldens and any cursed scar replay exact (lab injects
 * `KRAY_LAB_UNIQUE_RELIC_SEQ`). signet ratified at 80 (tip 68 + margin on 2026-08-31;
 * every recorded event replays below the pin — dormant, byte-identical, proven by a
 * disposable replay of that journal). main is empty genesis — born active (0).
 */
const UNIQUE_RELIC_REFUSE_SEQ: Record<string, number> = {
  regtest: Number.MAX_SAFE_INTEGER,
  signet: 80,
  main: 0,
}

/** ADR-3 eligibility opening — hard cap on the producedRoots lookback map (cascade root → {seq, inclusionRoot}).
 *  The seal case prunes below the last anchor seq, but a long PRE-activation run has no seals to prune, so this
 *  cap (evict-oldest) bounds memory regardless. Far larger than any real confirmation latency in events, so it
 *  never evicts a root a slow anchor could still reference. */
const PRODUCED_ROOTS_CAP = 200_000

// ADR-3 · Slice C — the signed inclusion deadline is OPT-IN (a citizen's own demand for censorship protection),
// never gated and never mandatory: a deadline does not move value, so the Supreme Law does not require it, and the
// 3d verdict treats a missing deadline as "nothing owed". There is therefore no deadline activation height — the
// field is always optional (handled in requireSig). Only the inclusion/window/nonce FOLD is activation-gated (the
// live-upgrade mechanism above); the deadline rides today's wallet unchanged.

export class KrayLedger {
  readonly balances = new Map<string, bigint>()
  readonly stars = new StarRegistry()
  readonly runes = new RuneBook()      // the rune L2 — reused as-is, never duplicated
  readonly amm = new AmmBook()         // LP shares only; reserves sit on KRAY_AMM_* in the two books
  readonly market = new StarMarket()   // star listings (seller, price); folds by presence, never holds value
  readonly offers = new StarOffers()   // escrowed bids; pot ₭ lives at STAR_OFFER
  readonly cuts = new CutBook()        // Luz ✧ per star — folds by presence (A3); IR cannot store the map
  readonly polls = new PollBook()      // Poll · ✦ — one glow-weighted ballot per address; not a cascade field
  private readonly contracts = new Map<string, { code: ContractCode; creator: string; state: Record<string, bigint>; star?: string; roster?: string[] }>()
  readonly pot: AnchoringPot
  readonly network: string
  /** THE PER-MINT CAP — one donation mints at most this many ₭ (1 ₭ per satoshi). IMMUTABLE: a hardcoded constant,
   *  NOT a constructor parameter, so no node — not even the operator's own, writing straight to its ledger or
   *  journal — can raise it. To mint more you must make more donations, each its OWN Bitcoin transaction (a real
   *  fee) and its OWN anchor; the scarce resource is Bitcoin transactions, not addresses, so splitting across
   *  identities buys nothing. Enforced in this consensus reducer, re-checked on every replay: a chain that minted
   *  more per donation is refused, and no honest node will ever accept it. */
  readonly mintCap = MINT_CAP_SATS
  private emitted = 0n
  private burned = 0n
  // Ӿ — the transferable token BORN FROM BURNED ₭ (the two-lights doctrine: ₭ dies → Ӿ condenses; a star
  // freezes → ✦ glow). Ӿ is minted 1:1 to the BURNER at every ₭ burn (the exactly-2 sites that move `burned`),
  // conserved as `Σ xMinted == burned`, a DISTINCT token backed by sacrifice-history and never redeemable for ₭
  // (the ₭ is truly gone). Accumulated from the ACTUAL burned amount at the site — never re-derived from size
  // (the byte-per-₭ rate retargets). Slice 1 = the birth, re-derivable by replay and NOT yet folded into the
  // cascade root; the Merkle commitment + transfers ride on top, gated. See docs/ACTIONS-MAP.md.
  private readonly glow = new Map<string, number>()      // ✦ frozen-star count per address (soulbound; matches glow-star.ts)
  private readonly xMinted = new Map<string, bigint>()   // lifetime Ӿ born to each address (the sacrifice record — never decreases)
  private readonly xBalance = new Map<string, bigint>()  // SPENDABLE Ӿ (slice 2): credited at the burn, moved by x-send; folds into the root at/after activation
  private xTotal = 0n
  private readonly nonces = new Map<string, number>()
  // a PROVEN donation carries the L1 outpoint it was paid at — credited once, ever,
  // exactly like a rune deposit. Rebuilt from the journal on every replay (a pure set).
  private readonly creditedDonations = new Set<string>()
  /** Holder txids that have fathered at least one L1 child (index, not a one-shot gate). */
  private readonly originBlessings = new Set<string>()
  /** Open L1 origin cohorts — rebuilt from the journal. Key = originCohortRoot. */
  private readonly originCohorts = new Map<string, { from: string; origins: string; leaves: Set<string>; taken: Set<string> }>()
  /** THE WINDOW LAW (Slice 2c) — every Bitcoin seal txid that already reopened mint capacity. One seal,
   *  one reopen, ever; the set folds into the cascade root so two histories that consumed different seals
   *  can never share a root. */
  private readonly sealedTxids = new Set<string>()
  /** THE SPACE TRINITY — pure functions of the journal, re-derived identically on every replay:
   *  the open seal's spent content budget, the retarget window's accumulated bytes, the seal count,
   *  and the era's byte price. No persistence, no oracle: the history IS the state. */
  private sealBytes = 0                          // content bytes written into the OPEN seal
  private windowBytes = 0                        // content bytes in the current 1008-seal (one-week) retarget window
  private sealsSeen = 0                          // seals since genesis (retarget fires every 1008)
  /** Last confirmed Bitcoin seal txid (64 hex), or empty before the first seal.
   *  Re-derived on replay from the journal prefix — never an oracle. v2 calls
   *  expose it as ctx.beacon; v1 calls keep 0 (A3). */
  private lastSealTxid = ''
  private bytesPerKrayNow = BYTES_PER_KRAY_BURN  // genesis 1 ₭/MB; snaps to 10_000 at proportion activation
  private proportionSnapped = false
  /** The live byte price (bytes per 1 ₭) — wallets read it to price a star BEFORE signing. */
  get bytesPerKray(): number { return this.bytesPerKrayNow }
  /** Live star ceiling for the NEXT act (10 MB after proportion; 21 MB below). */
  get inscriptionCeiling(): number {
    return (this.lastAppliedSeq + 1) >= this.sizeProportionSeq ? MAX_INSCRIPTION_PROPORTION : MAX_INSCRIPTION_BYTES
  }
  /** The atlas fee the NEXT act of this size would pay (0 below activation or for zero bytes) —
   *  the door quotes it beside the burn so frontend and reducer can never disagree on the price. */
  atlasFeeOf(size: number | undefined): bigint {
    const s = Number(size ?? 0)
    if (!Number.isFinite(s) || s <= 0) return 0n
    return (this.lastAppliedSeq + 1) >= this.atlasFeeActivationSeq ? starBurnOf(s, this.bytesPerKrayNow) : 0n
  }
  /** Bytes still available in the OPEN seal's content budget (era-aware). */
  get sealBudgetLeft(): number { return Math.max(0, this.sealBudgetAt(this.lastAppliedSeq + 1) - this.sealBytes) }
  /** Seals until the next space retarget. */
  get sealsToRetarget(): number { return RETARGET_WINDOW_SEALS - (this.sealsSeen % RETARGET_WINDOW_SEALS) }
  /** Bitcoin seals applied since genesis — ctx.interval on a v2 call. */
  get bitcoinSeals(): number { return this.sealsSeen }
  /** Last sealed Bitcoin txid, or '' — ctx.beacon on a v2 call is this as a bigint. */
  get lastBitcoinSeal(): string { return this.lastSealTxid }
  /** The last contract-call this ledger applied — who was paid, from which pot, under which Bitcoin seal.
   *  Re-derived on every apply; the explorer copies it onto the tx so a stranger does not have to re-run. */
  lastCall: {
    rule: string; from: string; contract: string; take: string
    payments: { to: string; amount: string }[]
    interval: string; beacon: string
  } | null = null
  /** QUANTUM RECOVERY (opt-in) — address → SHA-256(future post-quantum public key). A hash is quantum-safe,
   *  and the binding is authentic because it was signed under the current key while ECC was still secure. This
   *  stores value NOR moves it; it only lets an account migrate to a PQC key later without its exposed ECC key.
   *  Folds into the cascade root APPEND-ONLY, so a history with no commitment hashes byte-identically. */
  private readonly quantumCommits = new Map<string, string>()
  /** accounts already rescued through the quantum escape hatch — one rescue per account, ever (also folds into
   *  the cascade root append-only, and blocks any replay of a migration). */
  private readonly migratedAccounts = new Set<string>()
  private lastAppliedSeq = 0
  /** ADR-1 — the anchoring pot's Bitcoin scriptPubKey (hex). When set, the reducer RE-VERIFIES a donation's
   *  own SPV proof (if the event carries one) against it on every apply and replay, so the burn is proven
   *  from bytes, not the operator's word. Optional: unset ⇒ the re-verify is skipped (byte-identical to
   *  before), the door remains the gate. Threaded from the node/server that knows KRAY_POT_ADDRESS. */
  readonly potScriptHex?: string
  /** ADR-1 extended — the pot's x-only INTERNAL key (hex). When set, the reducer re-derives a
   *  SELF-ANCHORING donation's expected script from (this key, the event's sealed anchorBlock/anchorRoot)
   *  via the BIP-341 pay-to-contract tweak and re-verifies the SPV proof against the DERIVED script —
   *  never against a claim. NUMS internal key ⇒ the script is a true keyless burn. Optional: unset ⇒
   *  a self-anchor proof is skipped (byte-identical), mirroring potScriptHex's opt-in polarity. */
  readonly potInternalKeyHex?: string
  /** THE BACKING GATE (the no-hostage law) — when ON, a rune-send may only hand out POT-BACKED
   *  credits: the sender must first rehome their personal-vault backing to the shared consolidation
   *  pot, so no recipient ever depends on the sender's living key to reach Bitcoin. Flag-gated like
   *  every ADR-1 consensus tightening (KRAY_BACKING_GATE, unset = ON after Signet burn-in): a journal
   *  born before the law contains sends the gate would refuse, and the past is immutable — force 0
   *  only to replay that past. The DOOR enforces the law for every new send on every network; the
   *  reducer re-enforces it when the flag is on. */
  readonly backingGate: boolean
  /** Bytes of an inscribed content hash, or null if this node does not hold them.
   *  Windowed settlements (presenceTip) fail closed when a custody claim cannot
   *  be re-derived from these bytes. Historical events fall back to the bitmap. */
  readonly atlasBytes?: (hash: string) => Uint8Array | null

  constructor(potTarget: bigint = DEFAULT_POT_TARGET_SATS, network = 'regtest', potScriptHex?: string, backingGate = false, atlasBytes?: (hash: string) => Uint8Array | null, inclusionActivationSeq?: number, xTransferActivationSeq?: number, burnLawSeq?: number, rewardRetiredSeq?: number, atlasFeeActivationSeq?: number, sameInstantOrderSeq?: number, xFeelessActivationSeq?: number, tkFoldActivationSeq?: number, sizeProportionSeq?: number, potInternalKeyHex?: string, proofMandatorySeq?: number, runeAncestrySeq?: number, uniqueRelicRefuseSeq?: number) {
    this.pot = new AnchoringPot(potTarget)
    this.network = network
    this.potScriptHex = potScriptHex
    this.potInternalKeyHex = potInternalKeyHex
    this.backingGate = backingGate
    this.atlasBytes = atlasBytes
    // ADR-3 Slice A/C: production uses the per-network defaults (not-yet-activated); a test injects values to
    // cross the activation seqs. A real deploy sets each network's FUTURE height here, never an env var (consensus).
    this.inclusionActivationSeq = inclusionActivationSeq ?? (INCLUSION_ACTIVATION_SEQ[network] ?? Number.MAX_SAFE_INTEGER)
    this.xTransferActivationSeq = xTransferActivationSeq ?? (X_TRANSFER_ACTIVATION_SEQ[network] ?? Number.MAX_SAFE_INTEGER)
    this.burnLawSeq = burnLawSeq ?? (BURN_LAW_SEQ[network] ?? 1)   // unknown net → the law from block zero (fail-closed)
    this.rewardRetiredSeq = rewardRetiredSeq ?? (REWARD_RETIRED_FROM_SEQ[network] ?? 1)
    this.atlasFeeActivationSeq = atlasFeeActivationSeq ?? (ATLAS_FEE_ACTIVATION_SEQ[network] ?? Number.MAX_SAFE_INTEGER)
    this.sameInstantOrderSeq = sameInstantOrderSeq ?? (SAME_INSTANT_ORDER_ACTIVATION_SEQ[network] ?? Number.MAX_SAFE_INTEGER)
    this.xFeelessActivationSeq = xFeelessActivationSeq ?? (X_FEELESS_ACTIVATION_SEQ[network] ?? Number.MAX_SAFE_INTEGER)
    this.tkFoldActivationSeq = tkFoldActivationSeq ?? (TK_FOLD_ACTIVATION_SEQ[network] ?? Number.MAX_SAFE_INTEGER)
    this.sizeProportionSeq = sizeProportionSeq ?? (SIZE_PROPORTION_ACTIVATION_SEQ[network] ?? Number.MAX_SAFE_INTEGER)
    this.proofMandatorySeq = proofMandatorySeq ?? (PROOF_MANDATORY_SEQ[network] ?? Number.MAX_SAFE_INTEGER)
    this.runeAncestrySeq = runeAncestrySeq ?? (RUNE_ANCESTRY_MANDATORY_SEQ[network] ?? Number.MAX_SAFE_INTEGER)
    this.uniqueRelicRefuseSeq = uniqueRelicRefuseSeq ?? (UNIQUE_RELIC_REFUSE_SEQ[network] ?? Number.MAX_SAFE_INTEGER)
    // main pin 0 is the law itself (not a signaling): start at 10_000. Donate never
    // reads the rate — an empty-of-stars journal keeps its cascade.
    if (this.sizeProportionSeq === 0) {
      this.bytesPerKrayNow = BYTES_PER_KRAY_PROPORTION
      this.proportionSnapped = true
    }
  }

  private inscriptionCapAt(seq: number): number {
    return seq >= this.sizeProportionSeq ? MAX_INSCRIPTION_PROPORTION : MAX_INSCRIPTION_BYTES
  }
  /** Declared inscription weight. Live law (main; Signet at/after the pin): an INTEGER in
   *  the closed interval 0 ≤ size ≤ cap. Omit is a hole (would price as 0 and pay 1 ₭).
   *  Genesis era: size optional, finite ≥ 0, old 21 MB cap — Signet replay (A3). */
  private inscriptionBytesOf(e: KrayEvent): number {
    const cap = this.inscriptionCapAt(e.seq)
    if (e.seq >= this.sizeProportionSeq) {
      if (typeof e.size !== 'number' || !Number.isInteger(e.size) || e.size < 0 || !(e.size <= cap)) {
        throw new Error(`ledger: content is ${String(e.size)} bytes — the protocol ceiling is ${cap} (law: 0 ≤ size ≤ ${cap}, integer, declared)`)
      }
      return e.size
    }
    if (e.size !== undefined && (typeof e.size !== 'number' || !Number.isFinite(e.size) || e.size < 0)) {
      throw new Error('ledger: size must be a finite non-negative number when present')
    }
    const n = Number(e.size ?? 0)
    if (!(n <= cap)) throw new Error(`ledger: content is ${e.size} bytes — the protocol ceiling is ${cap}`)
    return n
  }
  private sealBudgetAt(seq: number): number {
    return seq >= this.sizeProportionSeq ? MAX_INSCRIPTION_PROPORTION : SEAL_CONTENT_BUDGET
  }
  private maybeSnapSizeProportion(seq: number): void {
    if (this.proportionSnapped) return
    if (this.sizeProportionSeq === Number.MAX_SAFE_INTEGER) return
    if (seq < this.sizeProportionSeq) return
    this.bytesPerKrayNow = BYTES_PER_KRAY_PROPORTION
    this.proportionSnapped = true
  }

  /** ADR-3 3a — the cumulative SMT over the SIGNED-message key of every act that fully applied AT/AFTER the
   *  activation height (donate/settlement/seal never sign, so they are absent; below H nothing is collected).
   *  Insert-only, maintained INCREMENTALLY (O(depth) per act, its root O(1)) — byte-identical to a rebuild, but a
   *  large history cannot grief the anchor (Slice-A council ratification item). Its root folds into the cascade. */
  private readonly includedTree = new IncrementalInclusionTree()
  private _pendingInclusionKey: string | null = null   // stashed by requireSig, committed only on a successful apply
  private readonly inclusionActivationSeq: number
  private readonly xTransferActivationSeq: number   // slice 2: below it, x-send is refused and the Ӿ root folds nowhere (A3)
  private readonly atlasFeeActivationSeq: number    // atlas fee: below it, inscribe/origin pays burn only (A3 — byte-identical history)
  private readonly sameInstantOrderSeq: number      // THE SAME-INSTANT LAW: below it, same-`at` order is unchecked (A3 — byte-identical history)
  private readonly xFeelessActivationSeq: number    // THE FIREBORN LAW: below it, x-send fee is the eternal 1 ₭ and the tank folds nowhere (A3)
  private readonly tkFoldActivationSeq: number      // THE TK-FOLD (Gate 2): below it, the lane kinds are refused and the lane root folds nowhere (A3)
  private readonly sizeProportionSeq: number        // 1 ₭/10 KB + 10 MB ceiling: below it, genesis 1 ₭/MB + 21 MB (A3)
  private readonly proofMandatorySeq: number        // PROOF MANDATORY: at/after it, an L1-peg event must EMBED its SPV proof (A3 below)
  private readonly runeAncestrySeq: number          // THE KEYSTONE: at/after it, a rune-deposit AND a rune-settle must EMBED the ancestry bundle (byte-pure input state)
  private readonly uniqueRelicRefuseSeq: number     // THE UNIQUE-RELIC LAW: at/after it, a taken name/bytes refuse BEFORE fire (A3 below — cursed-burn still applies)
  /** THE JOURNAL'S ACCUMULATED TRUTH — outpoint → balances of ONE rune, re-derived by earlier
   *  proven deposits. Scoped per rune (the etch-root shortcut is exact only for the focused rune,
   *  so one rune's memo must never answer for another). Re-built identically on every replay from
   *  the journaled bundles alone — derived state, never folded, never trusted across networks. */
  private readonly provenRuneOutpoints = new Map<string, Map<string, RuneBalance[]>>()
  /** THE KEYSTONE, for the door's assembler — has this journal already proven this outpoint for
   *  this rune? A yes lets a new deposit's bundle stop its walk there (the first walk pays). */
  hasProvenRuneOutpoint(runeId: string, outpoint: string): boolean {
    try { return this.provenRuneOutpoints.get(canonicalRuneKey(runeId))?.has(outpoint) ?? false } catch (_) { return false }
  }
  /** THE TK-FOLD LANE (Gate 2) — the compressed lane's whole consensus state: balances entered via
   *  `lane-enter`, rearranged ONLY by proven `fold-seal` breaths, exited via `lane-exit`. Its root
   *  (laneRoot, the same commitment the fold proof binds) folds into the cascade at/after activation. */
  private laneState = emptyLane()
  /** THE FIREBORN TANK — remaining feeless x-send allowance per address (F per ₭ burned, lifetime, never
   *  regenerates). Accrued from EVERY burn since genesis (pure derived state — the fire always paid), spendable
   *  and root-folded only at/after the feeless activation seq (A3: absent below ⇒ byte-identical history). */
  private readonly fireTank = new Map<string, bigint>()
  /** the gap law's memory: the `at` of each address's last FEELESS x-send (one per 3.5 s; bursts pay 1 ₭) */
  private readonly fireLastAt = new Map<string, number>()
  private fireSpent = 0n                            // lifetime feeless sends consumed — the tank tripwire's other half
  /** A1 — once the tripwire fires, every later apply HALTs. Dirty RAM must never keep serving. */
  private halted: string | null = null
  /** The open same-instant run: CONSECUTIVE signed acts sharing one `at`, all at/after the law's seq.
   *  Entries commit only in the apply tail (a refused act never occupies the run); any unsigned act,
   *  a different `at`, or a pre-law act closes it. Pure journal state — rebuilt identically on replay. */
  private _instantRun: { at: number; acts: { key: string; from: string; nonce?: number }[] } | null = null
  private readonly burnLawSeq: number               // THE BURN LAW: from here, fungible ₭ can never reach the hole; burn + burn-thaw become valid
  private readonly rewardRetiredSeq: number         // THE RETIREMENT: from here the unsigned `reward` is refused — the pool pays only what the bytes prove
  /** Every fungible ₭ a sender froze at the hole BEFORE the law — accumulated per sender during replay (amt
   *  only, never the fee), so the one-shot thaw re-derives EXACTLY who is owed what. A pure journal fold. */
  private readonly holeDeposits = new Map<string, bigint>()
  private thawApplied = false                       // re-derived on every replay: the thaw ran once, ever
  /** ADR-3 3d-a — the anchored (Bitcoin height → windowCommitment) map. It binds each seal's Bitcoin height to
   *  that seal's CUMULATIVE inclusion root, so "absent under THIS anchored root at THIS seal ≥ the deadline" is a
   *  single non-repudiable statement (the input 3d's verdict rests on). Its SMT root folds into the cascade
   *  alongside the inclusion root; co-activates with Slice A. The council proved this map must be MONOTONE (seal
   *  heights non-decreasing, enforced below) AND FINAL per height (a Map keyed by height keeps only the LAST,
   *  most-inclusive root at a height) — otherwise seq-cumulative-root ≠ height-cumulative-set and an honest
   *  writer could be falsely convicted from an earlier subset root at the same/higher height. */
  private readonly windowSeals = new Map<number, string>()   // Bitcoin height → windowCommitment(height, final root at that height)
  private lastSealHeight = 0                                  // seal heights must be non-decreasing across seals
  private _windowSealsRootCache: string | null = null
  /** ADR-3 eligibility opening — the committed account→(next nonce, first-anchor height) map. UNLIKE the
   *  inclusion tree (empty at H), it is maintained from GENESIS so it reflects every account's REAL nonce when
   *  activation folds it (an empty map would make eligibility acquit forever for pre-H accounts). Each advance
   *  stamps a 0 SENTINEL (unanchored); the next seal promotes it to that seal's Bitcoin height — sticky, so one
   *  reading from any anchored opening ≥ a deadline yields expected@deadline. Its root folds into the cascade
   *  ONLY post-activation (with inclusion/window). O(256) per advance — no anchor griefing. */
  private readonly nonceMap = new IncrementalNonceMap()
  /** accounts advanced since their nonce was last anchored → the SEQ of that latest advance. At a seal, only
   *  those whose advance seq ≤ the anchor's seq_anchor are promoted to the seal's height (the rest were not yet
   *  anchored by this tx — they keep the 0 sentinel, which the eligibility verdict acquits, never false-convicts). */
  private readonly nonceAdvancedSinceSeal = new Map<string, number>()
  /** ADR-3 eligibility opening (design council) — every cascade root THIS ledger has produced → the {seq,
   *  inclusionRoot} it fingerprints (each cascade root embeds its seq, so it is unique). A seal's anchor commits
   *  a PAST block-boundary root (seq_anchor ≤ the seal's seq under confirmation latency); the reducer looks the
   *  anchor's l1Root up here to fold windowCommitment(l1Height, inclusionRoot@seq_anchor) — the root the anchor
   *  ACTUALLY committed — instead of the current one. Bounded by a hard cap (evict-oldest) so a long pre-activation
   *  run cannot grow it without bound; the anti-rewind protection is the seq_anchor monotonic guard, not eviction;
   *  rebuilds deterministically from genesis on replay. */
  private readonly producedRoots = new Map<string, { seq: number; inclusionRoot: string }>()
  private lastSealAnchorSeq = 0   // seq_anchor of the last seal — the anchored inclusion chain never rewinds

  private atlasOracle(): AtlasOracle {
    const contents = this.stars.inscriptions().filter((x) => !x.cursed).map((x) => x.contentHash)
    const bytesOf = this.atlasBytes ?? ((_hash: string) => null)
    return { contents, bytesOf }
  }

  /**
   * Custody hits for the split. A present hex that fails aggregate verify is a
   * LIE — HALT on every path. Windowed settlements also HALT when the bytes
   * cannot be read (fail closed). Historical events without presenceTip keep
   * the bitmap count so Signet replay does not freeze (A3).
   */
  private hitsFromCustody(custodyHex: string | undefined, beacon: string, address: string, windowed: boolean): number {
    if (!custodyHex) return 0
    let claim
    try { claim = custodyFromHex(custodyHex) } catch (e) {
      throw new Error(`ledger: custody hex is malformed — ${e instanceof Error ? e.message : 'HALT'}`)
    }
    const v = verifyCustody(claim, beacon, address, this.atlasOracle())
    if (v.exact) return v.claimedHits
    if (v.reason === 'aggregate-mismatch' || v.reason === 'malformed') {
      throw new Error(`ledger: custody did not verify (${v.reason}) — HALT`)
    }
    if (windowed) {
      throw new Error(`ledger: custody bytes missing (${v.reason || 'unreadable'}) — fail closed — HALT`)
    }
    return hitCount(claim)
  }

  /** THE SUPREME LAW at the door AND at replay: a user act moves state only if its BIP-340
   *  signature verifies against the canonical message AND the signing key re-derives to the
   *  `from` taproot address (anti-spoof). No signature, wrong key, or one tampered byte ⇒
   *  refused. Re-run identically on every node, on every replay — the reducer trusts nothing. */
  private requireSig(e: KrayEvent, message: string): void {
    // DEFENSE-IN-DEPTH: a protocol label (KRAY_TREASURY, KRAY_BLACK_HOLE, a KRAY_CONTRACT_… address) is never a
    // real key, so it can never sign — but refuse it explicitly too, so value can never be MOVED OUT of a sink or
    // the treasury even if a signature scheme ever went wrong. The black hole is a burn: nothing leaves it, ever.
    if (e.from && e.from.startsWith('KRAY_')) {
      throw new Error(`ledger: ${e.kind} cannot be signed BY a protocol label (${e.from}) — a sink/treasury never spends`)
    }
    if (!e.publicKey || !e.signature || !e.scheme || !isSupportedScheme(e.scheme)) {
      throw new Error(`ledger: ${e.kind} must carry a supported signature (the Supreme Law)`)
    }
    // ADR-3 Slice C: a SIGNED inclusion deadline (a Bitcoin height) is an OPT-IN field — a citizen adds it to
    // DEMAND censorship protection ("include me by height D or it is provably censored"), and NEVER a mandatory
    // one. A deadline does not move value, so the Supreme Law does not require it; the 3d verdict already treats a
    // missing deadline as "nothing was owed". So the network runs with today's wallet from block 0, and signing a
    // deadline is an additive opt-in later. When present it rides INSIDE the signed bytes as a uniform
    // `|deadline=D` suffix at this ONE choke point; when absent the message is byte-identical to a no-deadline act
    // (A3). The signer picks D; anti-grief is 3d's availability witness. quantum-migrate (Lamport, outside
    // requireSig) simply never carries one — nothing is owed for it, consistent with opt-in.
    //
    // THE RESERVED-MARKER GUARD RUNS FOR EVERY SIGNED ACT, ALWAYS (council — a load-bearing invariant of opt-in):
    // a kind whose message ends in an unconstrained free-text field (a star `name`, a contract `args`) could
    // otherwise ABSORB the suffix — `…|name=Alice|deadline=D` is byte-identical to name='Alice|deadline=D' with NO
    // deadline, so ONE signature would authorize TWO acts. With deadlines always-optional the guard can no longer
    // be gated to post-activation; reserving the marker UNCONDITIONALLY keeps the signed identity injective.
    if (message.includes('|deadline=')) throw new Error(`ledger: ${e.kind} signed message must not contain the reserved |deadline= marker`)
    let signed = message
    if (e.deadline !== undefined) {
      if (!(Number.isInteger(e.deadline) && (e.deadline as number) > 0)) throw new Error(`ledger: ${e.kind} deadline, when present, must be a positive integer Bitcoin height`)
      signed = `${message}|deadline=${e.deadline}`
    }
    if (!verifySignature(e.from!, signed, e.signature, e.publicKey, e.scheme, toBtcNet(this.network))) {
      throw new Error(`ledger: ${e.kind} signature does not verify for ${e.from} (forged, wrong key, or tampered)`)
    }
    // THE REFEREE (same-instant law) — the door keys concurrent submits by the MIRROR's output
    // (signed-message.ts); if the mirror ever drifted from the inline message above, door order and
    // reducer law would silently disagree. So parity is re-proven HERE, on every act, on every
    // replay, fail-closed: a divergence refuses the act before any journal write — no fork, ever.
    if (signedBytesOfEvent(e, this.network) !== signed) {
      throw new Error(`ledger: ${e.kind} signed-bytes mirror diverged from the reducer's message — refusing the act (fail-closed; fix signed-message.ts)`)
    }
    // ADR-3 3a (Slice A): the SIGNED bytes just verified ARE the act's identity (never the envelope — pin 1; the
    // deadline IS signed, so it belongs to the identity, matching 3d's deadlineOf). Stash the leaf key; the tail
    // of applyLive commits it ONLY if the act fully applies, so a sig-valid-but-refused act never reaches the SMT.
    this._pendingInclusionKey = keyFromSignedMessage(signed)
    // THE SAME-INSTANT LAW — checked BEFORE any mutation: at the live door this refuses the act (the
    // gate re-instants it); on a forged journal the same throw HALTs every follower at this event.
    this.assertSameInstantOrder(e, this._pendingInclusionKey)
  }

  /** THE UNIQUE-RELIC LAW — A5 spoken at the reducer, same sentence as the door's 409.
   *  Below the pin this is a no-op (cursed-burn remains the historical scar). At/after it a
   *  taken name, content hash, or body hash throws BEFORE stars.applyLive / burn / nonce. */
  private assertUniqueRelicFree(e: KrayEvent): void {
    if (e.seq < this.uniqueRelicRefuseSeq) return
    if (e.kind === 'name' && typeof e.name === 'string' && this.stars.isNameTaken(e.name)) {
      throw new Error('ledger: that name is already taken — a name is written once, forever')
    }
    if (e.kind === 'inscribe' || e.kind === 'origin') {
      if (e.contentHash && this.stars.isContentTaken(e.contentHash)) {
        throw new Error('ledger: that exact content is already inscribed — every byte is unique in the universe')
      }
      if (e.bodyHash && this.stars.isBodyTaken(e.bodyHash)) {
        throw new Error('ledger: that exact work is already inscribed — the skeleton is unique in the universe')
      }
    }
  }

  /** THE SAME-INSTANT LAW (docs/SAME-INSTANT-ORDER-DECISION.md). At/after the activation seq every
   *  signed act must carry an honest integer `at`, and CONSECUTIVE signed acts sharing one `at` must
   *  stand in the journal exactly as `orderWindow` derives from their ungrindable keys — the greedy
   *  schedule where a smaller sha256(signed bytes) goes first and only an account's own nonce chain
   *  outranks it. Checking every prefix is equivalent to checking the whole run (greedy prefixes of a
   *  valid schedule are themselves valid schedules) and catches the violation at the earliest act. */
  private assertSameInstantOrder(e: KrayEvent, key: string): void {
    if (e.seq < this.sameInstantOrderSeq) return
    if (!(typeof e.at === 'number' && Number.isInteger(e.at) && e.at >= 0)) {
      // a non-numeric `at` would let a writer smuggle two "simultaneous" acts past the run tracker
      throw new Error(`ledger: THE SAME-INSTANT LAW — a signed ${e.kind} at/after seq ${this.sameInstantOrderSeq} must carry an integer millisecond timestamp`)
    }
    const run = this._instantRun
    if (!run || run.at !== e.at) return   // opens a new run (or none) — a single act is trivially ordered
    const claimed = [...run.acts, { key, from: String(e.from), nonce: e.nonce }]
    const first = new Map<string, number>()
    for (const a of claimed) if (a.nonce !== undefined && !first.has(a.from)) first.set(a.from, a.nonce)
    const { ordered } = orderWindow(claimed, {
      nonceOf: (addr) => first.get(addr) ?? 0,
      keyOf: (a) => (a as { key: string }).key,
      isValid: () => true,   // every entry carried a verified signature when it applied; this candidate's just did
    })
    for (let i = 0; i < claimed.length; i++) {
      if (ordered[i] !== claimed[i]) {
        throw new Error(`ledger: THE SAME-INSTANT LAW — acts stamped into one millisecond (${e.at}) must stand in the order arithmetic derives (orderWindow over sha256 of the signed bytes); this ${e.kind} (key ${key.slice(0, 12)}…) breaks the objective order. The door refuses it; a journal claiming it HALTs every follower here.`)
      }
    }
  }

  /** VALUE NEVER CROSSES NETWORKS. A signer's OWN address is bound to the network by requireSig, but a
   *  recipient/donor signs nothing — so the reducer refuses to mint onto or send to an address that does
   *  not belong to THIS network (a `bcrt1…` on signet, a `tb1…` on mainnet). Enforced at replay too, so
   *  every follower agrees. The protocol's own accounts — Treasury, black hole, and every derived
   *  contract address — are `KRAY_`-prefixed labels, never Bitcoin addresses, so they are exempt (a real
   *  taproot address can never start with `KRAY_`). */
  private requireRecipientNetwork(addr: string): void {
    // AMM pot is not a payment address. A credit here (donate / transfer / rune-send)
    // would skew the spot without a signed swap. Reserves move only by amm-add/swap.
    if (isAmmPotAddress(addr)) {
      throw new Error(`ledger: cannot credit an AMM pot (${addr}) — reserves move only by signed amm-add/swap`)
    }
    if (addr === STAR_OFFER) {
      throw new Error('ledger: cannot credit the star-offer pot — ₭ enters only by signed star-offer')
    }
    if (addr.startsWith('KRAY_')) return
    // a post-quantum ML-DSA account (`kq1` + SHA-256(key)) is a hash-committed identity, not a Bitcoin address;
    // the network it acts on is bound by the SIGNED message, exactly as for a taproot signer. Exempt like a label.
    if (/^kq1[0-9a-f]{64}$/.test(addr)) return
    if (!isAddressOnNetwork(addr, toBtcNet(this.network))) {
      throw new Error(`ledger: recipient ${addr} is not a ${this.network} address — value must never cross Bitcoin networks`)
    }
  }

  /** THE BURN LAW's choke point — fungible ₭ may NEVER be aimed at the black hole at/after the law seq
   *  (the Creator's ratified law: ₭ cannot be frozen, only burned; the council proved refusing only
   *  `transfer` leaves the law false — quantum-migrate/donate/reward/contract-payouts also reach the hole
   *  through the KRAY_ exemption above). Called at EVERY user-reachable fungible-credit site.
   *  `transfer-star` deliberately never calls this — star freezing is the ratified law (✦ never blinks). */
  private requireFungibleRecipient(addr: string, seq: number): void {
    this.requireRecipientNetwork(addr)
    if (addr === BLACK_HOLE && seq >= this.burnLawSeq) {
      throw new Error('ledger: ₭ cannot be frozen — only burned. Use the signed burn (it mints Ӿ 1:1 to you); the black hole entombs stars only')
    }
  }

  /**
   * L1 ordinal parentage — proveParentControl, or it is not a parent.
   * Genesis law: a signed origins list without the SPV bag never applies,
   * unless it is a v6 sibling of a journaled cohort. A present bag is
   * re-proven from bytes — a tampered journal HALTs. Casey: hops ≥ 1.
   * A blessing without a cohort is spent once; a blessing with a cohort
   * fathers exactly those committed content hashes.
   */
  private requireOriginControl(e: KrayEvent): {
    blessingIds: string[]
    open?: { root: string; from: string; origins: string; leaves: string[] }
    take?: { root: string; hash: string }
  } {
    const ids = e.kind === 'origin'
      ? (typeof e.l1InscriptionId === 'string' && e.l1InscriptionId ? [e.l1InscriptionId] : [])
      : (e.origins ?? [])
    if (!ids.length) {
      if (e.originProofs !== undefined || e.originCohort !== undefined || e.originCohortRoot !== undefined) {
        throw new Error('ledger: originProofs / origin cohort ride only with an L1 origin')
      }
      return { blessingIds: [] }
    }
    const root = typeof e.originCohortRoot === 'string' ? e.originCohortRoot.toLowerCase() : undefined
    const leaves = e.originCohort
    if (e.originProofs === undefined) {
      if (!root || !BODY_HASH_RE.test(root)) {
        throw new Error('ledger: an L1 ordinal parent needs a Bitcoin SPV control proof — a signed claim is not enough')
      }
      if (leaves !== undefined) throw new Error('ledger: only the opening act journals the origin cohort leaf list')
      const row = this.originCohorts.get(root)
      if (!row) throw new Error('ledger: unknown origin cohort — the blessing that committed this root is not on the journal')
      if (row.from !== e.from) throw new Error('ledger: origin cohort sibling must be signed by the author who opened it')
      if (row.origins !== ids.join(',')) throw new Error('ledger: origin cohort sibling must claim the same L1 parents as the opening act')
      const hash = String(e.contentHash || '').toLowerCase()
      if (!row.leaves.has(hash)) throw new Error('ledger: this content is not in the blessed origin cohort')
      if (row.taken.has(hash)) throw new Error('ledger: this origin cohort leaf already has a child')
      return { blessingIds: [], take: { root, hash } }
    }
    let proofs
    try { proofs = parseOriginProofs(e.originProofs) }
    catch (err) { throw new Error(`ledger: ${err instanceof Error ? err.message : String(err)}`) }
    const v = verifyOriginProofs(e.from!, this.network, ids, proofs, donationProofMinConf(toBtcNet(this.network)))
    if (!v.ok) throw new Error(`ledger: L1 origin is not proven under ${e.from} — ${v.reason}`)
    const blessingIds = [...new Set(proofs.map((p) => p.holderTxid.toLowerCase()))]
    // One blessing tx, many children (sating / Casey multi-envelope). Uniqueness
    // is contentHash (A5) + originChildBind, not holderTxid. Live door still
    // refuses if the holder UTXO is spent (a sale).
    if (e.originBind !== undefined) {
      const p0 = proofs[0]
      const expect = originChildBindOf(this.network, ids[0], p0.holderTxid, p0.holderVout, p0.holderOffset, String(e.contentHash || ''))
      if (String(e.originBind).toLowerCase() !== expect) throw new Error('ledger: originBind is not the SHA-256 of this blessing + this content')
    }
    if (leaves !== undefined) {
      if (!Array.isArray(leaves) || leaves.some((x) => typeof x !== 'string')) {
        throw new Error('ledger: originCohort must be an array of hex content hashes')
      }
      if (leaves.length < 2 || leaves.length > ORIGIN_COHORT_MAX) {
        throw new Error(`ledger: origin cohort is 2..${ORIGIN_COHORT_MAX} leaves`)
      }
      let computed: string
      try { computed = originCohortRootOf(leaves) }
      catch (err) { throw new Error(`ledger: ${err instanceof Error ? err.message : String(err)}`) }
      if (!root || root !== computed) throw new Error('ledger: originCohortRoot is not the SHA-256 of the committed leaves')
      const hash = String(e.contentHash || '').toLowerCase()
      if (!leaves.map((x) => x.toLowerCase()).includes(hash)) {
        throw new Error('ledger: the opening act\'s content must be one leaf of its own cohort')
      }
      if (this.originCohorts.has(root)) throw new Error('ledger: this origin cohort root is already open')
      return { blessingIds, open: { root, from: e.from!, origins: ids.join(','), leaves: leaves.map((x) => x.toLowerCase()) } }
    }
    if (root) throw new Error('ledger: opening a cohort needs the leaf list (originCohort)')
    return { blessingIds }
  }

  /** True when this holder txid already fathered an L1-origin child (door reuse check). */
  hasOriginBlessing(holderTxid: string): boolean {
    return this.originBlessings.has(holderTxid.toLowerCase())
  }

  balanceOf(a: string): bigint { return this.balances.get(a) ?? 0n }
  nonceOf(a: string): number { return this.nonces.get(a) ?? 0 }
  get totalEmitted(): bigint { return this.emitted }
  get totalBurned(): bigint { return this.burned }
  get circulating(): bigint { return this.emitted - this.burned }
  get appliedSeq(): number { return this.lastAppliedSeq }
  /** ✦ glow — stars this address froze. Soulbound tally; never a balance. Same derivation as glow-star.ts. */
  glowOf(a: string): number { return this.glow.get(a) ?? 0 }
  /** The Ӿ born to an address from its own ₭ burns — the transferable light of sacrifice, 1:1, never redeemable for ₭. */
  xMintedOf(a: string): bigint { return this.xMinted.get(a) ?? 0n }
  /** An address's SPENDABLE Ӿ (slice 2) — what it can send. Equals xMintedOf until it sends or receives an Ӿ transfer. */
  xBalanceOf(a: string): bigint { return this.xBalance.get(a) ?? 0n }
  /** THE TK-FOLD lane (Gate 2): an address's Ӿ inside the compressed lane (entered, folded, not yet exited). */
  laneBalanceOf(a: string): bigint { return this.laneState.balances.get(a) ?? 0n }
  /** the lane's current root — what the NEXT fold-seal's preRoot must chain to (and what folds into the cascade) */
  laneRootNow(): string { return laneRoot(this.laneState) }
  /** the lane's conserved total — every Ӿ that entered and has not exited */
  laneTotalNow(): bigint { return laneTotal(this.laneState) }
  /** an address's NEXT expected lane nonce (advanced only by proven fold-seal diffs) */
  laneNonceOf(a: string): number { return this.laneState.nonces.get(a) ?? 0 }
  /** the lane's whole state as sorted arrays — the folder's breath input (`pre`), and any auditor's view.
   *  A copy in the golden-vector shape; mutating it touches nothing. */
  laneStateView(): { balances: Array<[string, string]>; nonces: Array<[string, number]> } {
    const sortKey = (x: [string, unknown], y: [string, unknown]) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)
    return {
      balances: [...this.laneState.balances.entries()].filter(([, b]) => b !== 0n).sort(sortKey).map(([a, b]) => [a, b.toString()]),
      nonces: [...this.laneState.nonces.entries()].filter(([, n]) => n !== 0).sort(sortKey).map(([a, n]) => [a, n]),
    }
  }
  /** Total Ӿ ever minted — equals total ₭ burned by construction (the conservation the tripwire pins). */
  get xEmitted(): bigint { return this.xTotal }
  /** Every address that minted Ӿ and how much — the source for a Ӿ leaderboard/rank. A copy; sorting is the caller's. */
  xEntries(): Array<[string, bigint]> { return [...this.xMinted.entries()] }
  /**
   * THE Ӿ BOOKS a stranger re-derives on replay — minted (lifetime fire), spendable (journal book),
   * lane (TK-fold compressed book), tank (remaining feeless sends). Union of every address that
   * touched any of the four maps. A copy; the door sorts. Conservation: Σ minted == burned,
   * Σ spendable + Σ lane == burned (the tripwire).
   */
  xBooks(): Array<{ address: string; minted: bigint; spendable: bigint; lane: bigint; tank: bigint }> {
    const addrs = new Set<string>()
    for (const a of this.xMinted.keys()) addrs.add(a)
    for (const a of this.xBalance.keys()) addrs.add(a)
    for (const a of this.fireTank.keys()) addrs.add(a)
    for (const a of this.laneState.balances.keys()) addrs.add(a)
    return [...addrs].sort().map((address) => ({
      address,
      minted: this.xMintedOf(address),
      spendable: this.xBalanceOf(address),
      lane: this.laneBalanceOf(address),
      tank: this.fireTankOf(address),
    }))
  }
  /** Did the one-shot burn-thaw already run? (display; the reducer enforces once-ever) */
  get thawHasRun(): boolean { return this.thawApplied }
  /** The total pre-law frozen ₭ the thaw redeemed (0 before it runs) — Σ of the per-sender deposits. */
  get thawedTotal(): bigint { let t = 0n; if (!this.thawApplied) return 0n; for (const v of this.holeDeposits.values()) t += v; return t }

  private credit(a: string, amt: bigint): void { this.balances.set(a, this.balanceOf(a) + amt) }
  /** BURN → Ӿ: mint `n` Ӿ to the burner, in lockstep with `this.burned += n`. Called ONLY where ₭ is truly
   *  burned, so `Σ xMinted == burned` holds forever (the tripwire proves it). A no-op on a non-positive amount. */
  private mintX(a: string, n: bigint): void {
    if (n <= 0n) return
    this.xMinted.set(a, this.xMintedOf(a) + n); this.xBalance.set(a, this.xBalanceOf(a) + n); this.xTotal += n
    // THE FIREBORN LAW: the same fire that births Ӿ prepays its movement — F feeless sends per ₭ burned,
    // accrued from genesis on every replay (retroactive by design; spendable only at/after the activation seq).
    this.fireTank.set(a, this.fireTankOf(a) + n * FIREBORN_SENDS_PER_KRAY)
  }

  /** THE FIREBORN TANK of an address — remaining feeless x-sends (lifetime, non-transferable, never regenerates). */
  fireTankOf(a: string): bigint { return this.fireTank.get(a) ?? 0n }
  /** the `at` of the address's last feeless x-send, or undefined if it never sent feeless (gap law memory) */
  fireLastAtOf(a: string): number | undefined { return this.fireLastAt.get(a) }
  /** THE PRESCRIBED x-send fee (THE FIREBORN LAW) — the fee is never a choice. Below the activation seq: the
   *  eternal 1 ₭. At/after: 0 iff the tank has allowance AND the 3.5-second gap law holds; otherwise 1 ₭.
   *  Deterministic from ledger state + the act's (seq, at) — the door quotes it, the reducer enforces it. */
  xSendFeeFor(from: string, at: number, seq: number): bigint {
    if (seq < this.xFeelessActivationSeq) return MIN_FEE
    if (this.fireTankOf(from) <= 0n) return MIN_FEE
    const last = this.fireLastAt.get(from)
    // a feeless act REQUIRES a finite timestamp (the gap clock must be armable) — a timeless act pays
    const gapOk = Number.isFinite(at) && (last === undefined || at >= last + FIREBORN_GAP_MS)
    return gapOk ? 0n : MIN_FEE
  }

  /** Apply one journal event — ATOMIC: every precondition is checked and thrown on
   *  BEFORE any state is mutated, so a rejected event leaves the ledger byte-identical
   *  (no half-spent balance, no phantom nonce bump). An event that throws was refused at
   *  the door and is never journaled; the reducer only ever replays valid history, and a
   *  replay of that history applies identically on every node. TOTAL over a valid journal.
   *  A1 is not a report: after a fully applied act, `conserves()` must hold or this ledger
   *  HALTs (and stays halted) — a conservation lie never becomes the next cascade root. */
  applyLive(e: KrayEvent): void {
    if (this.halted) throw new Error(`ledger: HALTED — ${this.halted}`)
    if (e.seq <= this.lastAppliedSeq) return
    this.maybeSnapSizeProportion(e.seq)
    if (this.producedRoots.size === 0) this._recordProducedRoot(0)   // capture the genesis root before the first event
    this._pendingInclusionKey = null   // ADR-3 3a: reset per act; a signed kind re-sets it inside requireSig
    switch (e.kind) {
      case 'genesis':
        break // NO PREMINE — genesis mints nothing; every ₭ is earned by donation
      case 'donate': {
        // THE MINT — proof-of-donation. `amount` is the PROVEN satoshis sacrificed to the
        // anchoring pot (SPV-proven at ingress, like a rune deposit — wired at integration).
        // The pot mints 1 ₭ per satoshi, capped at its deficit; the whole donation funds the
        // pot (excess = extra anchoring runway). A full pot refuses the donation at the door.
        const sats = BigInt(e.amount!)
        if (sats <= 0n) throw new Error('ledger: a donation must be positive')
        // THE PER-MINT CAP — one donation mints at most `mintCap` ₭ (anti-whale; the supply itself has no ceiling).
        // Enforced BEFORE any mutation and re-checked on every replay, so a chain that minted more is refused. In
        // burn mode the sats are destroyed on L1, so rejecting an over-cap donation is what stops the excess from
        // being burned for nothing — split a larger amount across mints, each its own transaction and anchor.
        if (sats > this.mintCap) throw new Error(`ledger: a single donation mints at most ${this.mintCap} ₭ — split a larger amount across mints (each is its own Bitcoin transaction and anchor)`)
        // a PROVEN donation carries the L1 outpoint it paid at — minted once, ever (like a rune deposit).
        // A donation without an outpoint is the dev/regtest mint (the server gates which is allowed).
        // PROOF MANDATORY (born strict on signet/main): at/after activation the journal itself must carry
        // the cause — a mint the reducer cannot re-prove from bytes is refused, not door-trusted.
        if (e.seq >= this.proofMandatorySeq && (!e.proof || !e.outpoint)) {
          throw new Error('ledger: at/after proof-mandatory activation a donation must embed its L1 SPV proof and outpoint — the door alone is no longer the gate')
        }
        if (e.outpoint && this.creditedDonations.has(e.outpoint)) throw new Error(`ledger: donation outpoint ${e.outpoint} was already credited — a donation mints once, ever`)
        if (!this.pot.isOpen()) throw new Error('ledger: the anchoring pot is full — donation refused (it would mint nothing)')
        this.requireFungibleRecipient(e.to!, e.seq)    // the donor is credited ₭ on THIS network — and never the hole (the burn law)
        // ── ADR-1 · THE PEG, RE-PROVEN IN CONSENSUS ──────────────────────────────────────────────
        // If the event carries its L1 SPV proof AND this node knows the pot's Bitcoin script, re-verify
        // the burn FROM BYTES on every apply and replay: the tx pays the pot, is buried deep enough, and
        // the sats/outpoint/donor it proves MATCH what this event claims. A cold replay thus re-proves the
        // peg, not the operator's word — and because the proof rides in the event body, the cascade root
        // commits the CAUSE. Skipped (byte-identical) when the proof or the pot script is absent.
        //
        // ADR-1 EXTENDED · THE SELF-ANCHORING BURN — a donation that paid a self-anchor output names the
        // seal it rode (anchorBlock + anchorRoot). The expected script is then RE-DERIVED here from the
        // configured pot internal key tweaked by KrayAnchor.payload(anchorBlock, anchorRoot) (BIP-341
        // pay-to-contract; NUMS key ⇒ a keyless burn) — a claim never chooses the script, mathematics does.
        // A malformed seal claim HALTs everywhere (present-but-false); verification is opt-in per node
        // config (potInternalKeyHex), the exact polarity of potScriptHex above.
        const claimsSeal = e.anchorBlock !== undefined || e.anchorRoot !== undefined
        if (claimsSeal) {
          if (!Number.isInteger(e.anchorBlock) || (e.anchorBlock as number) < 0 || (e.anchorBlock as number) > 0xffffffff) throw new Error('ledger: a self-anchoring donation needs anchorBlock as a uint32 KRAY block number')
          if (!/^[0-9a-f]{64}$/.test(String(e.anchorRoot || ''))) throw new Error('ledger: a self-anchoring donation needs anchorRoot as 32-byte lowercase hex')
        }
        const expectedBurnScript = (e.proof && claimsSeal)
          ? (this.potInternalKeyHex ? selfAnchorScriptHex(this.potInternalKeyHex, KrayAnchor.payload(e.anchorBlock!, e.anchorRoot!)) : undefined)
          : (e.proof ? this.potScriptHex : undefined)
        if (e.proof && expectedBurnScript) {
          const v = verifyDonationProof(e.proof, { potScriptHex: expectedBurnScript, minConfirmations: donationProofMinConf(toBtcNet(this.network)), net: toBtcNet(this.network) })
          if (!v.ok) throw new Error(`ledger: the donation's own SPV proof does not verify on replay — ${v.reason}`)
          if (v.sats !== sats) throw new Error(`ledger: the proven pot payment (${v.sats} sats) ≠ the claimed donation amount (${sats}) — refused`)
          if (e.outpoint && v.outpoint !== e.outpoint) throw new Error(`ledger: the proven outpoint (${v.outpoint}) ≠ the claimed credit key (${e.outpoint}) — refused`)
          if (v.donor && v.donor !== e.to) throw new Error(`ledger: the proof commits donor ${v.donor}, not the claimed recipient ${e.to} — refused`)
        }
        // ── validated → mutate ──
        const minted = this.pot.absorb(sats)   // = min(sats, deficit), the whole donation kept as runway
        this.credit(e.to!, minted)
        this.emitted += minted                 // every ₭ minted is backed by a real satoshi
        if (e.outpoint) this.creditedDonations.add(e.outpoint)
        break
      }
      case 'anchor': {
        // ANCHORING DRAINS THE POT — pot sats pay a Bitcoin anchor fee; the deficit reopens
        // and minting resumes. `amount` = satoshis spent from the pot. Mints/burns no ₭.
        const sats = BigInt(e.amount!)
        if (sats <= 0n) throw new Error('ledger: an anchor spend must be positive')
        if (sats > this.pot.satsHeld) throw new Error(`ledger: anchor spend exceeds the pot (have ${this.pot.satsHeld}, need ${sats})`)
        // ── validated → mutate ──
        this.pot.spendOnAnchor(sats)
        break
      }
      case 'seal': {
        // THE WINDOW LAW (Slice 2c) — a CONFIRMED Bitcoin seal (any shape: a donation's own self-anchor,
        // a drawn guardian's anchor, or a last-resort operator OP_RETURN) reopens EXACTLY one mint-cap of
        // capacity, ONCE per Bitcoin txid, ever. The mint rate is thereby metered by Bitcoin's own proven
        // heartbeat — never by any party's spend. `l1Txid` names the buried seal so any auditor can demand
        // the SPV proof (a node journals only seals it verified buried); a replay that disagrees on the
        // consumed set cannot reproduce this chain's cascade root. Mints/burns no ₭.
        const txid = String(e.l1Txid || '').toLowerCase()
        if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('ledger: a seal needs its Bitcoin txid (32-byte hex)')
        if (this.sealedTxids.has(txid)) throw new Error('ledger: this Bitcoin seal already reopened the mint window — one seal, one reopen, ever')
        const w = WINDOW_PER_SEAL_SATS < this.pot.satsHeld ? WINDOW_PER_SEAL_SATS : this.pot.satsHeld
        // ADR-3 3d-a — once the inclusion regime is active, a seal MUST carry its BITCOIN height so the reducer
        // can bind windowCommitment(height, inclusionRoot) into the cascade. Below activation the field is absent
        // (byte-identical, A3). The height is journaled and re-proven by the follower's SPV exactly as the txid is
        // (a lied height is caught there, not here — the reducer is pure). Validate before any mutation.
        const sealBindsWindow = e.seq >= this.inclusionActivationSeq
        let sealAnchor: { seq: number; inclusionRoot: string } | null = null
        if (sealBindsWindow) {
          if (!(Number.isInteger(e.l1Height) && (e.l1Height as number) > 0)) {
            throw new Error('ledger: a seal after inclusion activation must carry its Bitcoin height (l1Height, a positive integer) — 3d-a binds the window to it')
          }
          // MONOTONICITY (council): seal heights must be NON-DECREASING, so the seq-cumulative inclusion root
          // equals the HEIGHT-cumulative set. Without this a writer could journal a genuinely-high-height seal
          // (empty root) after a low-height one (act included), anchoring two contradictory facts — an attacker
          // then convicts the honest writer from the earlier subset root. A follower re-proves this order too.
          if ((e.l1Height as number) < this.lastSealHeight) {
            throw new Error(`ledger: seal Bitcoin height ${e.l1Height} is below the last seal's ${this.lastSealHeight} — seal heights must be non-decreasing (3d-a monotonicity)`)
          }
          // DESIGN COUNCIL — the anchor commits a PAST block-boundary root (seq_anchor ≤ this seal's seq under
          // confirmation latency), so the height must be bound to the inclusion root THAT root actually anchored,
          // NOT the current (later, richer) one — else a writer pairs a stale height with the current inclusion
          // set (old-anchor-reuse) and shifts the omission boundary. The seal carries l1Root (the cascade root its
          // anchor commits); look it up in producedRoots to recover (seq_anchor, R_anchor).
          if (typeof e.l1Root !== 'string' || !/^[0-9a-f]{64}$/.test(e.l1Root)) {
            throw new Error('ledger: a seal after inclusion activation must carry l1Root (the cascade root its anchor commits) — the window binds to the inclusion set THAT root anchored')
          }
          const anchored = this.producedRoots.get(e.l1Root)
          if (!anchored) {
            throw new Error(`ledger: seal l1Root ${String(e.l1Root).slice(0, 12)}… is not a cascade root this history produced — an anchor must commit a real prefix root`)
          }
          // l1BlockNumber is REQUIRED symmetrically with l1Height/l1Root (verify council): the follower binds the
          // Bitcoin height THROUGH it (verifySealProof matches the anchor's committed block number / self-anchor
          // script). Without this gate a writer could OMIT it — the reducer would still fold the height, but the
          // follower's re-proof SKIPS a seal lacking it, letting a fabricated l1Height enter unverified. Requiring
          // it here means a seal the follower cannot Bitcoin-verify FAIL-STOPS replay instead. Never folded (A3).
          if (!(Number.isInteger(e.l1BlockNumber) && (e.l1BlockNumber as number) >= 0)) {
            throw new Error('ledger: a seal after inclusion activation must carry l1BlockNumber (the KRAY block number its anchor commits) — the follower binds the Bitcoin height through it')
          }
          // seq_anchor NON-DECREASING: the anchored inclusion chain never rewinds (a later seal cannot bind to an
          // earlier anchored state than a prior seal already did — that would reopen a smaller inclusion set).
          if (anchored.seq < this.lastSealAnchorSeq) {
            throw new Error(`ledger: seal anchor seq ${anchored.seq} is below the last seal's ${this.lastSealAnchorSeq} — the anchored inclusion chain never rewinds (3d-a)`)
          }
          sealAnchor = anchored
        }
        // ── validated → mutate ──
        this.sealedTxids.add(txid)
        this.lastSealTxid = txid
        // an empty pot is already fully open — the seal is still consumed (recorded), reopening nothing
        if (w > 0n) this.pot.spendOnAnchor(w)
        // THE SPACE TRINITY breathes on the seal: the content budget reopens, and every
        // RETARGET_WINDOW_SEALS (1008) seals re-derives the byte price from the window's measured
        // demand — Bitcoin's own difficulty shape, pure integer arithmetic over this very journal.
        this.sealBytes = 0
        this.sealsSeen += 1
        if (this.sealsSeen % RETARGET_WINDOW_SEALS === 0) {
          const min = e.seq >= this.sizeProportionSeq ? BYTES_PER_KRAY_MIN_PROPORTION : BYTES_PER_KRAY_MIN
          this.bytesPerKrayNow = retargetBytesPerKray(this.bytesPerKrayNow, this.windowBytes, min)
          this.windowBytes = 0
        }
        // ADR-3 3d-a — record this Bitcoin height ↔ the CUMULATIVE inclusion root at this seal. Keyed by HEIGHT
        // in a Map, so two seals in the SAME block keep only the LAST (most-inclusive) root at that height — an
        // earlier subset root can never be the anchored member, closing the equal-height false-conviction. Its
        // SMT folds into the cascade, so a verifier shows windowCommitment(H, R) was anchored and 3d rules
        // "absent under R at a seal H ≥ deadline" = censorship.
        if (sealBindsWindow && sealAnchor) {
          // Bind the height to R_anchor — the inclusion root the anchor's committed cascade root ACTUALLY holds
          // (at seq_anchor), not this.inclusionRoot() (the current, possibly-later one). Byte-identical when the
          // anchor commits the just-prior root (seq_anchor == seq-1, synchronous regtest); it only diverges under
          // real confirmation latency, which is exactly where binding to the current root was wrong.
          this.windowSeals.set(e.l1Height as number, windowCommitment(e.l1Height as number, sealAnchor.inclusionRoot))
          this.lastSealHeight = e.l1Height as number
          this.lastSealAnchorSeq = sealAnchor.seq
          this._windowSealsRootCache = null
          // ADR-3 eligibility opening — PROMOTE from the 0 sentinel to THIS seal's height ONLY the accounts whose
          // LATEST advance was at seq ≤ seq_anchor: their current nonce was reached BY the anchored state, so the
          // anchor witnessed it. An account advanced AFTER seq_anchor was not anchored by this tx — it keeps its
          // sentinel (a future seal promotes it), and the eligibility verdict acquits a not-yet-anchored nonce,
          // never false-convicts (fail-closed). Sticky: an account not re-advanced keeps its earlier stamp.
          for (const [addr, advSeq] of this.nonceAdvancedSinceSeal) {
            if (advSeq <= sealAnchor.seq) {
              this.nonceMap.update(addr, this.nonceOf(addr), e.l1Height as number)
              this.nonceAdvancedSinceSeal.delete(addr)
            }
          }
        }
        break
      }
      case 'quantum-commit': {
        // QUANTUM RECOVERY (opt-in, additive) — an account registers SHA-256(its future post-quantum key).
        // This moves NO value and touches no balance; it only records a quantum-safe commitment the account
        // can later use to migrate to that PQC key without ever relying on its exposed ECC key. The ATTACK to
        // close: someone registering a commitment for an address they do not own (which would let them hijack
        // that address's future migration). The current signature closes it — the commitment is signed BY the
        // committing address, exactly as a transfer is, and bound to the network + nonce (so it is authentic
        // while ECC is safe, and non-replayable). The latest signed commitment stands (an owner may rotate it).
        const commit = String(e.quantumCommit || '').toLowerCase()
        if (!/^[0-9a-f]{64}$/.test(commit)) throw new Error('ledger: a quantum-commit needs a 64-hex SHA-256 of the post-quantum public key')
        this.checkNonce(e)
        this.requireSig(e, quantumCommitMessage(this.network, e.from!, commit, e.nonce!))
        // ── validated → mutate ──
        this.commitNonce(e)
        this.quantumCommits.set(e.from!, commit)
        break
      }
      case 'quantum-migrate': {
        // THE QUANTUM ESCAPE HATCH — rescue a compromised account with a hash-based (quantum-safe) Lamport
        // signature that matches the pre-registered quantum-commit. This is authorized by the LAMPORT key
        // ALONE, deliberately NOT by the ECC key: it must work precisely when a quantum computer has broken
        // the ECC key. Its safety rests only on SHA-256 (Grover-only) — the holder of the Lamport secret,
        // whose public-key hash was committed ahead of time, is the sole party who can produce this signature.
        const from = e.from!, to = e.to!
        if (typeof from !== 'string' || typeof to !== 'string') throw new Error('ledger: quantum-migrate needs string from/to')
        if (from === to) throw new Error('ledger: a migration must move to a DIFFERENT address')
        const committed = this.quantumCommits.get(from)
        if (!committed) throw new Error('ledger: no quantum-commit registered for this address — nothing to migrate (register SHA-256 of your Lamport key first)')
        if (this.migratedAccounts.has(from)) throw new Error('ledger: this account has already been quantum-migrated — one rescue, ever')
        this.requireFungibleRecipient(to, e.seq)   // parity with transfer — a migration moves the WHOLE balance, so the hole is refused too (the burn law)
        // the revealed Lamport public key must hash to the pre-registered commit (proving it is THE key),
        // and the Lamport signature must verify over the exact migration message. Both are pure hashing.
        let pk, sig
        try { pk = lamportPublicKeyFromHex(String(e.lamportPublicKey || '')) } catch (err) { throw new Error(`ledger: malformed Lamport public key — ${err instanceof Error ? err.message : err}`) }
        try { sig = lamportSignatureFromHex(String(e.lamportSignature || '')) } catch (err) { throw new Error(`ledger: malformed Lamport signature — ${err instanceof Error ? err.message : err}`) }
        if (lamportPublicKeyCommit(pk) !== committed) throw new Error('ledger: the revealed Lamport key does not match the registered quantum-commit — refused')
        if (!lamportVerify(quantumMigrateMessage(this.network, from, to, e.nonce ?? 0), sig, pk)) throw new Error('ledger: the Lamport signature does not authorize this migration — refused')
        // ── validated → mutate: move ALL fungible ₭ to the rescue address; the compromised account is retired ──
        const bal = this.balanceOf(from)
        this.balances.set(from, 0n)
        if (bal > 0n) this.credit(to, bal)
        this.migratedAccounts.add(from)   // consume the escape hatch — one rescue, ever (also blocks any replay)
        break
      }
      case 'transfer': {
        const amt = BigInt(e.amount!)
        const fee = BigInt(e.fee ?? '0')
        if (e.from && (e.from.startsWith('KRAY_') || isContractPotAddress(e.from))) {
          throw new Error('ledger: a protocol pot cannot transfer — only its own rules move ₭')
        }
        if (amt <= 0n) throw new Error('ledger: transfer amount must be positive')
        if (e.from === e.to) throw new Error('ledger: a transfer needs two different parties')
        if (fee !== MIN_FEE) throw new Error('ledger: the eternal 1-₭ fee — exactly one, never more (an unsigned fee cannot be inflated)')
        this.checkNonce(e)
        const need = amt + fee
        if (this.balanceOf(e.from!) < need) throw new Error(`ledger: insufficient balance (have ${this.balanceOf(e.from!)}, need ${need})`)
        this.requireSig(e, transferMessage(this.network, e.from!, e.to!, amt, e.nonce!))
        this.requireFungibleRecipient(e.to!, e.seq)   // ₭ on THIS network — and NEVER frozen at the hole from the law seq
        // ── validated → mutate ──
        this.commitNonce(e)
        this.balances.set(e.from!, this.balanceOf(e.from!) - need)
        this.credit(e.to!, amt)           // (below the law seq the hole was a legal sink; the thaw redeems those)
        this.credit(TREASURY, fee)        // the fee funds the validators
        // pre-law fungible freeze — remember WHO froze WHAT (amt only, accumulated), so the one-shot
        // burn-thaw re-derives exactly who is owed Ӿ. A pure fold; nothing here changes any root.
        if (e.to === BLACK_HOLE) this.holeDeposits.set(e.from!, (this.holeDeposits.get(e.from!) ?? 0n) + amt)
        break
      }
      case 'transfer-star': {
        // the NFT move: a created star travels whole; the 1-₭ fee is paid from fungible ₭
        const fee = BigInt(e.fee ?? '0')
        if (fee !== MIN_FEE) throw new Error('ledger: the eternal 1-₭ fee — exactly one, never more (an unsigned fee cannot be inflated)')
        this.checkNonce(e)
        const star = BigInt(e.star!)
        if (e.to === e.from) throw new Error('ledger: a star already belongs to you — a send needs a different recipient')
        if (this.stars.ownerOf(star) !== e.from) throw new Error('ledger: cannot move a star you do not hold')
        if (this.balanceOf(e.from!) < fee) throw new Error(`ledger: insufficient balance for the fee (have ${this.balanceOf(e.from!)}, need ${fee})`)
        this.requireSig(e, sendStarMessage(this.network, e.from!, e.to!, star, e.nonce!))
        this.requireRecipientNetwork(e.to!)    // a star travels only to an address on THIS network
        // ── validated → mutate ──
        this.commitNonce(e)
        this.balances.set(e.from!, this.balanceOf(e.from!) - fee)
        this.credit(TREASURY, fee)
        this.stars.applyLive(e)           // move the star (registry no-op guard is belt-and-suspenders)
        this.market.remove(star)          // the owner changed: any live offer from the old owner is void (no stale/reviving listing)
        if (e.to === BLACK_HOLE) this.glow.set(e.from!, (this.glow.get(e.from!) ?? 0) + 1)
        break
      }
      case 'star-list': {
        // THE STAR MARKET — list (or re-list = edit price). A SIGNED commitment by the current owner; it moves
        // NO star and holds NO value — only a buy moves anything. Pays the eternal 1-₭ fee to the validators.
        const fee = BigInt(e.fee ?? '0')
        if (fee !== MIN_FEE) throw new Error('ledger: the eternal 1-₭ fee — exactly one, never more (an unsigned fee cannot be inflated)')
        this.checkNonce(e)
        const star = BigInt(e.star!)
        const price = BigInt(e.amount ?? '0')
        if (price <= 0n) throw new Error('ledger: a star listing needs a positive price')
        if (this.stars.ownerOf(star) !== e.from) throw new Error('ledger: cannot list a star you do not hold')
        if (this.balanceOf(e.from!) < fee) throw new Error(`ledger: insufficient balance for the fee (have ${this.balanceOf(e.from!)}, need ${fee})`)
        this.requireSig(e, starListMessage(this.network, e.from!, star, price, e.nonce!))
        // ── validated → mutate ──
        this.commitNonce(e)
        this.balances.set(e.from!, this.balanceOf(e.from!) - fee)
        this.credit(TREASURY, fee)
        this.market.list(star, e.from!, price)   // re-list replaces the prior offer (edit price)
        break
      }
      case 'star-delist': {
        // Withdraw your own live offer. Only the current owner (who is also the lister) may cancel; the star
        // never moved, so this only clears the commitment. Pays the eternal 1-₭ fee.
        const fee = BigInt(e.fee ?? '0')
        if (fee !== MIN_FEE) throw new Error('ledger: the eternal 1-₭ fee — exactly one, never more (an unsigned fee cannot be inflated)')
        this.checkNonce(e)
        const star = BigInt(e.star!)
        const listing = this.market.get(star)
        if (!listing) throw new Error('ledger: no live listing for that star — nothing to cancel')
        if (this.stars.ownerOf(star) !== e.from) throw new Error('ledger: cannot cancel a listing for a star you do not hold')
        if (this.balanceOf(e.from!) < fee) throw new Error(`ledger: insufficient balance for the fee (have ${this.balanceOf(e.from!)}, need ${fee})`)
        this.requireSig(e, starDelistMessage(this.network, e.from!, star, e.nonce!))
        // ── validated → mutate ──
        this.commitNonce(e)
        this.balances.set(e.from!, this.balanceOf(e.from!) - fee)
        this.credit(TREASURY, fee)
        this.market.remove(star)
        break
      }
      case 'star-buy': {
        // THE ATOMIC BUY — both legs in ONE reducer step: the buyer's ₭ pays the seller AND the star moves to
        // the buyer, or the whole act is refused. No trusted escrow: the mathematics is the escrow. The buyer
        // signed the EXACT terms (star, price, seller), so a re-priced or delisted offer refutes a stale buy —
        // never a phantom price (Fano). Pays the eternal 1-₭ fee to the validators, like the transfer-star it is.
        const fee = BigInt(e.fee ?? '0')
        if (fee !== MIN_FEE) throw new Error('ledger: the eternal 1-₭ fee — exactly one, never more (an unsigned fee cannot be inflated)')
        this.checkNonce(e)
        const star = BigInt(e.star!)
        const price = BigInt(e.amount ?? '0')
        const buyer = e.from!, seller = e.to!
        if (buyer === seller) throw new Error('ledger: a star already belongs to you — a buy needs a different seller')
        const listing = this.market.get(star)
        if (!listing) throw new Error('ledger: that star is not listed for sale')
        if (listing.seller !== seller) throw new Error('ledger: the listing seller does not match the signed buy — refused (the offer changed hands)')
        if (listing.price !== price) throw new Error(`ledger: the listing price (${listing.price}) ≠ the signed buy price (${price}) — refused (re-priced offer, no phantom price)`)
        if (this.stars.ownerOf(star) !== seller) throw new Error('ledger: the seller no longer holds that star — the listing is stale, refused')
        this.requireRecipientNetwork(buyer)   // the star travels only to an address on THIS network
        if (this.balanceOf(buyer) < price + fee) throw new Error(`ledger: insufficient balance for price + fee (have ${this.balanceOf(buyer)}, need ${price + fee})`)
        this.requireSig(e, starBuyMessage(this.network, buyer, star, price, seller, e.nonce!))
        // ── validated → mutate (atomic; Σ conserved: buyer −(price+fee), seller +price, TREASURY +fee) ──
        this.commitNonce(e)
        this.balances.set(buyer, this.balanceOf(buyer) - price - fee)
        this.credit(seller, price)
        this.credit(TREASURY, fee)
        this.stars.applyLive(e)             // move the star seller → buyer (star-buy case in the registry)
        this.market.remove(star)            // the offer is consumed, once
        break
      }
      case 'star-offer': {
        // ESCROWED BID — price ₭ leaves the bidder into the keyless pot. Spendable drops now.
        // One live offer per (star, bidder). Not on your own star. Fee 1 ₭ to TREASURY.
        const fee = BigInt(e.fee ?? '0')
        if (fee !== MIN_FEE) throw new Error('ledger: the eternal 1-₭ fee — exactly one, never more (an unsigned fee cannot be inflated)')
        this.checkNonce(e)
        const star = BigInt(e.star!)
        if (typeof e.amount !== 'string' || !/^[0-9]+$/.test(e.amount)) throw new Error('ledger: a star offer price must be a whole number of ₭')
        const price = BigInt(e.amount)
        if (price <= 0n) throw new Error('ledger: a star offer needs a positive price')
        const owner = this.stars.ownerOf(star)
        if (!owner) throw new Error('ledger: no such star — nothing to offer on')
        if (owner === e.from) throw new Error('ledger: you already hold that star — list it, do not bid on yourself')
        if (owner === BLACK_HOLE) throw new Error('ledger: that star is frozen — an offer cannot buy it')
        if (this.offers.get(star, e.from!)) throw new Error('ledger: you already have a live offer on that star — cancel it first')
        if (this.balanceOf(e.from!) < price + fee) throw new Error(`ledger: insufficient balance for price + fee (have ${this.balanceOf(e.from!)}, need ${price + fee})`)
        this.requireSig(e, starOfferMessage(this.network, e.from!, star, price, e.nonce!))
        this.commitNonce(e)
        this.balances.set(e.from!, this.balanceOf(e.from!) - price - fee)
        this.credit(STAR_OFFER, price)
        this.credit(TREASURY, fee)
        this.offers.put(star, e.from!, price)
        break
      }
      case 'star-offer-cancel': {
        // Only the bidder unlocks. ₭ returns. Another 1 ₭ fee from remaining spendable.
        const fee = BigInt(e.fee ?? '0')
        if (fee !== MIN_FEE) throw new Error('ledger: the eternal 1-₭ fee — exactly one, never more (an unsigned fee cannot be inflated)')
        this.checkNonce(e)
        const star = BigInt(e.star!)
        const live = this.offers.get(star, e.from!)
        if (!live) throw new Error('ledger: no live offer from you on that star')
        if (this.balanceOf(e.from!) < fee) throw new Error(`ledger: insufficient balance for the fee (have ${this.balanceOf(e.from!)}, need ${fee})`)
        if (this.balanceOf(STAR_OFFER) < live.price) throw new Error('ledger: offer pot is short of the book — HALT')
        this.requireSig(e, starOfferCancelMessage(this.network, e.from!, star, e.nonce!))
        this.commitNonce(e)
        this.balances.set(e.from!, this.balanceOf(e.from!) - fee)
        this.credit(TREASURY, fee)
        this.balances.set(STAR_OFFER, this.balanceOf(STAR_OFFER) - live.price)
        this.credit(e.from!, live.price)
        this.offers.remove(star, e.from!)
        break
      }
      case 'star-offer-accept': {
        // Owner signs EXACT (star, price, bidder). Pot pays owner; star moves owner → bidder. Listing cleared.
        const fee = BigInt(e.fee ?? '0')
        if (fee !== MIN_FEE) throw new Error('ledger: the eternal 1-₭ fee — exactly one, never more (an unsigned fee cannot be inflated)')
        this.checkNonce(e)
        const star = BigInt(e.star!)
        if (typeof e.amount !== 'string' || !/^[0-9]+$/.test(e.amount)) throw new Error('ledger: the signed accept price must be a whole number of ₭')
        const price = BigInt(e.amount)
        const owner = e.from!, bidder = e.to!
        if (!bidder) throw new Error('ledger: accept names the bidder')
        if (owner === bidder) throw new Error('ledger: you cannot accept your own offer')
        const live = this.offers.get(star, bidder)
        if (!live) throw new Error('ledger: no live offer from that bidder on that star')
        if (live.price !== price) throw new Error(`ledger: the offer price (${live.price}) ≠ the signed accept (${price}) — refused (no phantom price)`)
        if (this.stars.ownerOf(star) !== owner) throw new Error('ledger: cannot accept an offer on a star you do not hold')
        this.requireRecipientNetwork(bidder)
        if (this.balanceOf(owner) < fee) throw new Error(`ledger: insufficient balance for the fee (have ${this.balanceOf(owner)}, need ${fee})`)
        if (this.balanceOf(STAR_OFFER) < price) throw new Error('ledger: offer pot is short of the book — HALT')
        this.requireSig(e, starOfferAcceptMessage(this.network, owner, star, price, bidder, e.nonce!))
        this.commitNonce(e)
        this.balances.set(owner, this.balanceOf(owner) - fee)
        this.credit(TREASURY, fee)
        this.balances.set(STAR_OFFER, this.balanceOf(STAR_OFFER) - price)
        this.credit(owner, price)
        this.stars.applyLive(e)
        this.offers.remove(star, bidder)
        this.market.remove(star)
        break
      }
      case 'x-send': {
        // Ӿ TRANSFER (slice 2, DORMANT until the ratified activation seq) — move the transferable token born from
        // burned ₭. Signed with its OWN domain (xSendMessage, never a ₭ signature), pays the eternal 1-₭ fee to the
        // validators, and its book folds into the cascade root at/after activation. Below it: refused (HALT), so no
        // Ӿ moves and no root grows before the network ratifies — a dormant, genesis-safe slice (A3).
        if (e.seq < this.xTransferActivationSeq) throw new Error('ledger: Ӿ transfers are not active on this network yet (dormant until the ratified activation seq)')
        if (e.from && (e.from.startsWith('KRAY_') || isContractPotAddress(e.from))) throw new Error('ledger: a protocol pot cannot move Ӿ — only its own rules move value')
        const amt = parseLaneAmount(e.amount ?? '')
        if (amt === undefined) throw new Error('ledger: an Ӿ amount must be canonical decimal within u128 (the canonical-decimal law — no hex, no pad, no twin-fork)')
        const fee = BigInt(e.fee ?? '0')
        if (amt <= 0n) throw new Error('ledger: an Ӿ transfer amount must be positive')
        if (e.from === e.to) throw new Error('ledger: an Ӿ transfer needs two different parties')
        // THE FIREBORN LAW (prescriptive fee — never a choice): below its seq this prescribes the eternal 1 ₭
        // (byte-identical history, A3); at/after it, 0 iff the tank has allowance AND the gap law holds. The
        // signed domain carries no fee, so prescription is what makes fee-flipping by the writer impossible.
        const prescribed = this.xSendFeeFor(e.from!, Number(e.at ?? Number.NaN), e.seq)
        if (fee !== prescribed) throw new Error(prescribed === 0n
          ? 'ledger: THE FIREBORN LAW prescribes fee 0 here — the tank has allowance and the gap law holds (the fee is never a choice)'
          : 'ledger: the eternal 1-₭ fee — exactly one, never more (Ӿ moves, ₭ pays the gas)')
        this.checkNonce(e)
        if (this.xBalanceOf(e.from!) < amt) throw new Error(`ledger: insufficient Ӿ (have ${this.xBalanceOf(e.from!)}, need ${amt})`)
        if (fee > 0n && this.balanceOf(e.from!) < fee) throw new Error(`ledger: insufficient ₭ for the Ӿ transfer fee (have ${this.balanceOf(e.from!)}, need ${fee})`)
        this.requireSig(e, xSendMessage(this.network, e.from!, e.to!, amt, e.nonce!))
        this.requireFungibleRecipient(e.to!, e.seq)    // Ӿ on THIS network — and Ӿ can never be frozen at the hole either (the same law)
        // ── validated → mutate ──
        this.commitNonce(e)
        this.xBalance.set(e.from!, this.xBalanceOf(e.from!) - amt)
        this.xBalance.set(e.to!, this.xBalanceOf(e.to!) + amt)
        if (fee > 0n) {
          this.balances.set(e.from!, this.balanceOf(e.from!) - fee)
          this.credit(TREASURY, fee)       // the paid path funds the validators, exactly like a ₭ move
        } else {
          // the fireborn path: the fire already paid — one lifetime allowance burns, the gap clock arms
          this.fireTank.set(e.from!, this.fireTankOf(e.from!) - 1n)
          this.fireLastAt.set(e.from!, Number(e.at))
          this.fireSpent += 1n
        }
        break
      }
      case 'cut-send': {
        // LUZ ✧ — move this star's element. Own domain (cutSendMessage). Fee is the
        // eternal 1 ₭. The star may already be frozen: sealed terms keep running (§11.0c).
        if (e.from && (e.from.startsWith('KRAY_') || isContractPotAddress(e.from))) {
          throw new Error('ledger: a protocol pot cannot move Luz — only a holder signs')
        }
        if (typeof e.star !== 'string' || !STAR_RE.test(e.star)) throw new Error('ledger: a Luz send needs a star number')
        const amt = parseLaneAmount(e.amount ?? '')
        if (amt === undefined) throw new Error('ledger: a Luz amount must be canonical decimal within u128 (the canonical-decimal law — no hex, no pad, no twin-fork)')
        const fee = BigInt(e.fee ?? '0')
        if (amt <= 0n) throw new Error('ledger: a Luz amount must be positive')
        if (e.from === e.to) throw new Error('ledger: a Luz send needs two different parties')
        if (fee !== MIN_FEE) throw new Error('ledger: the eternal 1-₭ fee — exactly one, never more (Luz moves, ₭ pays the gas)')
        this.checkNonce(e)
        if (this.balanceOf(e.from!) < fee) throw new Error(`ledger: insufficient ₭ for the Luz fee (have ${this.balanceOf(e.from!)}, need ${fee})`)
        this.requireSig(e, cutSendMessage(this.network, e.from!, e.to!, BigInt(e.star), amt, e.nonce!))
        this.requireFungibleRecipient(e.to!, e.seq)
        if (e.to!.startsWith('KRAY_') || isContractPotAddress(e.to!) || isAmmPotAddress(e.to!)) {
          throw new Error('ledger: Luz cannot enter a protocol pot')
        }
        const held = this.cuts.of(e.star, e.from!)
        if (held < amt) throw new Error(`ledger: insufficient Luz (have ${held}, need ${amt})`)
        // ── validated → mutate ──
        this.commitNonce(e)
        this.cuts.send(e.star, e.from!, e.to!, amt)
        this.balances.set(e.from!, this.balanceOf(e.from!) - fee)
        this.credit(TREASURY, fee)
        break
      }
      case 'lane-enter': {
        // THE TK-FOLD LANE ENTRY (Gate 2, DORMANT until the ratified activation seq) — a holder moves their
        // own spendable Ӿ INTO the compressed lane by signature over the entry's OWN domain. Conservation:
        // Ӿ never mints or dies here — it changes books (xBalance → lane), and the tripwire counts BOTH.
        if (e.seq < this.tkFoldActivationSeq) throw new Error('ledger: THE TK-FOLD is not active on this network yet (dormant until the ratified activation seq)')
        if (e.from && (e.from.startsWith('KRAY_') || isContractPotAddress(e.from))) throw new Error('ledger: a protocol pot cannot enter the lane — only its own rules move value')
        const amt = parseLaneAmount(e.amount ?? '')
        if (amt === undefined) throw new Error('ledger: a lane amount must be canonical decimal within u128 (the canonical-decimal law)')
        if (amt <= 0n) throw new Error('ledger: a lane entry amount must be positive')
        const fee = BigInt(e.fee ?? '0')
        if (fee !== MIN_FEE) throw new Error('ledger: the eternal 1-₭ fee — exactly one, never more (entering the lane is a journal act)')
        this.checkNonce(e)
        if (this.xBalanceOf(e.from!) < amt) throw new Error(`ledger: insufficient Ӿ to enter the lane (have ${this.xBalanceOf(e.from!)}, need ${amt})`)
        if (this.balanceOf(e.from!) < fee) throw new Error(`ledger: insufficient ₭ for the lane entry fee (have ${this.balanceOf(e.from!)}, need ${fee})`)
        if (this.laneBalanceOf(e.from!) + amt > (1n << 128n) - 1n) throw new Error('ledger: a lane balance must stay within u128 (the prover\'s word)')
        this.requireSig(e, laneEnterMessage(this.network, e.from!, amt, e.nonce!))
        // ── validated → mutate ──
        this.commitNonce(e)
        this.xBalance.set(e.from!, this.xBalanceOf(e.from!) - amt)
        this.laneState.balances.set(e.from!, this.laneBalanceOf(e.from!) + amt)
        this.balances.set(e.from!, this.balanceOf(e.from!) - fee)
        this.credit(TREASURY, fee)
        break
      }
      case 'lane-exit': {
        // THE TK-FOLD LANE EXIT (Gate 2) — the mirror: lane Ӿ returns to the spendable journal book by
        // signature. The exit reads the LEDGER's lane state (rebuilt from proven diffs), so a stale fold
        // can never pay out more than the mathematics already settled.
        if (e.seq < this.tkFoldActivationSeq) throw new Error('ledger: THE TK-FOLD is not active on this network yet (dormant until the ratified activation seq)')
        if (e.from && (e.from.startsWith('KRAY_') || isContractPotAddress(e.from))) throw new Error('ledger: a protocol pot cannot exit the lane — only its own rules move value')
        const amt = parseLaneAmount(e.amount ?? '')
        if (amt === undefined) throw new Error('ledger: a lane amount must be canonical decimal within u128 (the canonical-decimal law)')
        if (amt <= 0n) throw new Error('ledger: a lane exit amount must be positive')
        const fee = BigInt(e.fee ?? '0')
        if (fee !== MIN_FEE) throw new Error('ledger: the eternal 1-₭ fee — exactly one, never more (exiting the lane is a journal act)')
        this.checkNonce(e)
        if (this.laneBalanceOf(e.from!) < amt) throw new Error(`ledger: insufficient lane Ӿ to exit (have ${this.laneBalanceOf(e.from!)}, need ${amt})`)
        if (this.balanceOf(e.from!) < fee) throw new Error(`ledger: insufficient ₭ for the lane exit fee (have ${this.balanceOf(e.from!)}, need ${fee})`)
        this.requireSig(e, laneExitMessage(this.network, e.from!, amt, e.nonce!))
        // ── validated → mutate ──
        this.commitNonce(e)
        this.laneState.balances.set(e.from!, this.laneBalanceOf(e.from!) - amt)
        this.xBalance.set(e.from!, this.xBalanceOf(e.from!) + amt)
        this.balances.set(e.from!, this.balanceOf(e.from!) - fee)
        this.credit(TREASURY, fee)
        break
      }
      case 'fold-seal': {
        // THE FOLD SEAL (Gate 2) — one PROVEN breath of the lane lands on the journal. The folder is a role,
        // never a trust: the reducer demands (1) the diffs re-hash to the claimed diffsHash, (2) the claimed
        // preRoot chains to THIS ledger's current lane root, (3) the committed public values tell the same
        // story as the act, (4) conservation — the proven laneTotal equals the lane's total NOW (a fold can
        // only rearrange), (5) the Groth16 proof verifies against the ONE pinned guest program, and (6) the
        // diffs alone rebuild a state whose root is the claimed postRoot (the re-sync law). Any failure
        // refuses BEFORE any mutation (live door) and HALTs a follower on replay — the same code path, so a
        // re-syncing stranger re-verifies every fold proof from bytes alone. The eternal 1-₭ fee prices the
        // verification work and makes door spam capital-bounded.
        if (e.seq < this.tkFoldActivationSeq) throw new Error('ledger: THE TK-FOLD is not active on this network yet (dormant until the ratified activation seq)')
        if (e.from && (e.from.startsWith('KRAY_') || isContractPotAddress(e.from))) throw new Error('ledger: a protocol pot cannot seal a fold — a folder is a citizen')
        const fee = BigInt(e.fee ?? '0')
        if (fee !== MIN_FEE) throw new Error('ledger: the eternal 1-₭ fee — exactly one, never more (a fold-seal is a journal act)')
        const isHex64 = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)
        if (!isHex64(e.foldPre) || !isHex64(e.foldPost) || !isHex64(e.foldDiffsHash)) throw new Error('ledger: a fold-seal needs foldPre/foldPost/foldDiffsHash as 64-hex roots')
        if (typeof e.foldProof !== 'string' || typeof e.foldPublic !== 'string') throw new Error('ledger: a fold-seal needs the proof and its committed public values')
        // (1) the diffs are THE proven diffs — shape-gate then re-hash (the canonical bytes are injective)
        const d = e.foldDiffs
        if (!d || !Array.isArray(d.balances) || !Array.isArray(d.nonces) || d.balances.length > 100_000 || d.nonces.length > 100_000) throw new Error('ledger: a fold-seal needs its diffs (bounded arrays) — the re-sync law rides the journal')
        for (const row of d.balances) {
          if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || parseLaneAmount(row[1] as string) === undefined) throw new Error('ledger: a fold diff balance must be [address, canonical u128 decimal]')
        }
        for (const row of d.nonces) {
          if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || typeof row[1] !== 'number' || !Number.isSafeInteger(row[1] as number) || (row[1] as number) < 0) throw new Error('ledger: a fold diff nonce must be [address, canonical non-negative integer]')
        }
        const diffs = d as FoldDiffs
        if (foldDiffsHash(diffs) !== e.foldDiffsHash) throw new Error('ledger: the diffs do not hash to foldDiffsHash — a proof can never be reused over altered diffs')
        // (2) the fold chains to the lane's PRESENT — a stale or foreign preRoot is refused
        const preNow = laneRoot(this.laneState)
        if (e.foldPre !== preNow) throw new Error('ledger: the fold does not chain — its preRoot is not the lane\'s current root (stale fold; re-fold from the present)')
        // (3) the committed public values and the act tell ONE story
        const pub = decodeFoldPublic(e.foldPublic)
        if (!pub) throw new Error('ledger: the fold\'s committed public values are malformed — refused')
        if (pub.network !== this.network) throw new Error('ledger: the fold was proven for another network — the domain wall holds')
        if (pub.preRoot !== e.foldPre || pub.postRoot !== e.foldPost || pub.diffsHash !== e.foldDiffsHash) throw new Error('ledger: the proof\'s public values disagree with the act — one story or none')
        // (4) conservation — a fold only rearranges: the proven total is the lane's total NOW
        if (BigInt(pub.laneTotal) !== laneTotal(this.laneState)) throw new Error('ledger: the fold\'s laneTotal is not the lane\'s conserved total — a breath can never mint or destroy Ӿ')
        // (5) the mathematics: the Groth16 proof, against the ONE pinned program (fail-closed — a node
        //     that cannot load the verifier throws here and HALTs, never accepts)
        if (!verifyFoldProof(e.foldProof, e.foldPublic)) throw new Error('ledger: the fold proof does not verify — it does not exist')
        // (6) the re-sync law, enforced BEFORE any mutation: the diffs alone rebuild the claimed post state
        const post = applyFoldDiffs(this.laneState, diffs)
        if (laneRoot(post) !== e.foldPost) throw new Error('ledger: the diffs do not rebuild the claimed postRoot — the re-sync law refuses')
        if (laneTotal(post) !== laneTotal(this.laneState)) throw new Error('ledger: the rebuilt lane total moved — conservation tripwire (halt)')
        this.checkNonce(e)
        if (this.balanceOf(e.from!) < fee) throw new Error(`ledger: insufficient ₭ for the fold-seal fee (have ${this.balanceOf(e.from!)}, need ${fee})`)
        this.requireSig(e, foldSealMessage(this.network, e.from!, e.foldPre, e.foldPost, e.foldDiffsHash, e.nonce!))
        // ── validated → mutate (the post state was computed and verified above; nothing half-applies) ──
        this.commitNonce(e)
        this.balances.set(e.from!, this.balanceOf(e.from!) - fee)
        this.credit(TREASURY, fee)
        this.laneState = post
        break
      }
      case 'burn': {
        // THE SPORADIC BURN (the Creator's ratified law, council-approved): a holder DESTROYS their own ₭ by
        // signature — the ₭ leaves supply (burned += amt) and Ӿ is born 1:1 to the burner. This is what the
        // "Burn ₭" button always promised; from BURN_LAW_SEQ the promise and the bytes are one. The 1-₭ fee
        // stays a FEE (→ validators), NEVER added to burned. Valid only at/after the law seq, so a fabricated
        // pre-law burn in a hostile journal is refused with a clean reason.
        if (e.seq < this.burnLawSeq) throw new Error('ledger: the burn law is not active at this seq — a pre-law burn cannot exist')
        if (e.from && (e.from.startsWith('KRAY_') || isContractPotAddress(e.from))) throw new Error('ledger: a protocol pot cannot burn — only a citizen sacrifices')
        const amt = BigInt(e.amount!)
        const fee = BigInt(e.fee ?? '0')
        if (amt <= 0n) throw new Error('ledger: a burn amount must be positive')
        if (fee !== MIN_FEE) throw new Error('ledger: the eternal 1-₭ fee — exactly one, never more (the fee is gas, never part of the burn)')
        this.checkNonce(e)
        if (this.balanceOf(e.from!) < amt + fee) throw new Error(`ledger: insufficient balance (have ${this.balanceOf(e.from!)}, need ${amt + fee})`)
        this.requireSig(e, burnMessage(this.network, e.from!, amt, e.nonce!))
        // ── validated → mutate (atomic; the council's exact mutation order) ──
        this.commitNonce(e)
        this.balances.set(e.from!, this.balanceOf(e.from!) - amt - fee)
        this.credit(TREASURY, fee)        // the fee funds the validators — without this the tripwire breaks by 1 ₭
        this.burned += amt                // the ₭ truly leaves supply — the death
        this.mintX(e.from!, amt)          // BURN → Ӿ: the sacrificed ₭ condenses 1:1 into the burner's new life
        break
      }
      case 'burn-thaw': {
        // THE ONE-SHOT THAW (council-shielded): the fungible ₭ frozen at the black hole BEFORE the law
        // transmutes into a true burn — hole −amt per sender, burned +amt, Ӿ born 1:1 to each ORIGINAL
        // sender (re-derived from holeDeposits, the pure journal fold). Carries NO payload (any is refused),
        // runs ONCE ever (a second throws — never a silent skip), refuses an empty thaw (fail-closed), and
        // is valid only at/after the law seq. Unsigned like donate/seal: a protocol event whose entire
        // effect is deterministic — a hostile writer can only trigger what the mathematics already fixed.
        // shape-gate FIRST: the thaw carries nothing; a payload is a hostile steering attempt, refused before
        // any state is even consulted (inputs are hostile until validated — the codebase's shape-gate discipline)
        for (const k of ['from', 'to', 'amount', 'fee', 'nonce', 'publicKey', 'signature'] as const) {
          if (e[k] !== undefined) throw new Error(`ledger: a burn-thaw carries no ${k} — its whole effect is re-derived from the journal`)
        }
        if (e.seq < this.burnLawSeq) throw new Error('ledger: the burn law is not active at this seq — the thaw waits for the law')
        if (this.thawApplied) throw new Error('ledger: the burn-thaw already ran — once, ever')
        if (this.holeDeposits.size === 0) throw new Error('ledger: nothing to thaw — no fungible ₭ was ever frozen at the hole (a clean network refuses an empty thaw)')
        // ── validated → mutate: per-sender, never force-zeroing the hole (non-transfer credits stay untouched) ──
        for (const [sender, amt] of this.holeDeposits) {
          this.balances.set(BLACK_HOLE, this.balanceOf(BLACK_HOLE) - amt)
          this.burned += amt
          this.mintX(sender, amt)         // the fire reaches them late, but exact — Ӿ to the ORIGINAL sacrificer
        }
        this.thawApplied = true
        break
      }
      case 'inscribe':
      case 'origin':
      case 'name': {
        // BORN FROM FIRE — 1 ₭ is BURNED and a star is created. The burn IS the cost:
        // the pure ₭ becomes the permanent, non-fungible star. The burn happens for the
        // ACT (network space); if the registry curses it (duplicate/taken), the ₭ is still
        // spent — you paid to try — and conservation holds (balance −1, burned +1).
        this.checkNonce(e)
        if (this.balanceOf(e.from!) < 1n) throw new Error('ledger: insufficient ₭ to burn (need 1 to create a star)')
        // ── SHAPE GATE (the Supreme Law's boundary: inputs are hostile until validated) — the star
        //    registry string-ops these fields (name → foldSeparators, l1InscriptionId → split), and the
        //    message builders below COERCE them, so a JSON number/object would slip past requireSig and
        //    only throw later inside stars.applyLive — AFTER the burn, leaving live state that was never
        //    journaled (a silent cascade-root fork). Refuse a malformed TYPE here, before ANY mutation. ──
        if (typeof e.from !== 'string') throw new Error('ledger: from must be a string')
        if (e.kind === 'name' && typeof e.name !== 'string') throw new Error('ledger: name must be a string — malformed event refused before any burn')
        if (e.kind === 'name' && Buffer.byteLength(e.name, 'utf8') > NAME_MAX_BYTES) {
          throw new Error(`ledger: a name is at most ${NAME_MAX_BYTES} bytes — refused before any burn`)
        }
        if (e.kind === 'origin' && typeof e.l1InscriptionId !== 'string') throw new Error('ledger: origin needs a string l1InscriptionId — malformed event refused before any burn')
        if ((e.kind === 'inscribe' || e.kind === 'origin') && typeof e.contentHash !== 'string') throw new Error('ledger: contentHash must be a string — malformed event refused before any burn')
        if (e.contentType !== undefined && typeof e.contentType !== 'string') throw new Error('ledger: contentType must be a string when present')
        // THE CONTENT CEILING IS CONSENSUS, not a door courtesy — a journal line claiming a
        // monster no validator could be asked to guard is refused BEFORE any burn, so a hostile
        // client that skips the HTTP door still cannot journal it (rule at the door AND here).
        if (e.size !== undefined && (typeof e.size !== 'number' || !Number.isFinite(e.size) || e.size < 0)) throw new Error('ledger: size must be a finite non-negative number when present')
        const actBytes = (e.kind === 'inscribe' || e.kind === 'origin') ? this.inscriptionBytesOf(e) : 0
        // ── MULTIPARENT (message v3) SHAPE GATE — consensus law, not door courtesy: caps,
        //    grammars, duplicates and placement are refused HERE before any burn, so a hostile
        //    client that skips the HTTP door still cannot journal a malformed lineage. The
        //    charsets (digits / 64-hex+iN) are what make the signed v3 string injective. ──
        const useV3 = e.parents !== undefined || e.origins !== undefined
        if (useV3) {
          if (e.kind !== 'inscribe') throw new Error('ledger: parents/origins lists ride only on an inscribe act (v3)')
          if (e.star != null) throw new Error('ledger: parents/origins lists ride only on a BIRTH act, not an add-to-existing')
          if (e.parent !== undefined) throw new Error('ledger: v3 lists and the v2 singular parent cannot ride one act — one statement of parentage per signature')
          for (const [field, list, re, cap] of [
            ['parents', e.parents, STAR_RE, MAX_PARENTS_PER_ACT],
            ['origins', e.origins, ORDINAL_ID_RE, MAX_ORIGINS_PER_ACT],
          ] as const) {
            if (list === undefined) continue
            if (!Array.isArray(list) || list.some((x) => typeof x !== 'string' || !re.test(x))) throw new Error(`ledger: ${field} must be an array of well-formed strings — malformed event refused before any burn`)
            if (list.length > cap) throw new Error(`ledger: at most ${cap} ${field} per act — the lineage cap is consensus`)
            if (new Set(list).size !== list.length) throw new Error(`ledger: duplicate ${field} refused — each parent is claimed once`)
          }
        }
        // METADATA (message v4) — free JSON, signed with the relic. Absent ⇒ frozen v2/v3.
        const useV4 = e.meta !== undefined
        if (useV4) {
          if (e.kind !== 'inscribe') throw new Error('ledger: inscription metadata rides only on an inscribe act (v4)')
          if (e.parent !== undefined) throw new Error('ledger: v4 metadata and the v2 singular parent cannot ride one act — put the parent in the parents list')
          if (typeof e.meta !== 'string') throw new Error('ledger: meta must be a string when present')
          try { assertInscriptionMeta(e.meta) }
          catch (err) { throw new Error(`ledger: ${err instanceof Error ? err.message : String(err)}`) }
        }
        // BODY HASH (message v5) — skeleton genetics. Absent ⇒ frozen v2/v3/v4 (A3).
        const useV5 = e.bodyHash !== undefined
        if (useV5) {
          if (e.kind !== 'inscribe') throw new Error('ledger: bodyHash rides only on an inscribe act (v5)')
          if (e.parent !== undefined) throw new Error('ledger: v5 body hash and the v2 singular parent cannot ride one act — put the parent in the parents list')
          if (typeof e.bodyHash !== 'string' || !BODY_HASH_RE.test(e.bodyHash)) throw new Error('ledger: bodyHash must be 64 lowercase hex — malformed event refused before any burn')
        }
        const useV6 = e.originCohortRoot !== undefined
        if (useV6) {
          if (e.kind !== 'inscribe') throw new Error('ledger: origin cohort rides only on an inscribe act (v6)')
          if (e.parent !== undefined) throw new Error('ledger: v6 cohort and the v2 singular parent cannot ride one act — put the parent in the parents list')
          if (typeof e.originCohortRoot !== 'string' || !BODY_HASH_RE.test(e.originCohortRoot)) {
            throw new Error('ledger: originCohortRoot must be 64 lowercase hex — malformed event refused before any burn')
          }
        }
        // A STAR IS A CANVAS — a creative act either BIRTHS a new star (no target) or ADDS the missing
        // attribute (name/content) to a star you already own (e.star = the target). Either way it burns
        // 1 ₭ from fire. `onstar` is signed so a target can never be swapped after the fact. (origin
        // always births a new star from an L1 ordinal, so it carries no target.)
        const onStar = (e.kind !== 'origin' && e.star != null) ? BigInt(e.star) : undefined
        this.requireSig(e,
          e.kind === 'name' ? nameMessageV2(this.network, e.from!, e.nonce!, e.name!, onStar)
          : e.kind === 'origin' ? originMessageV2(this.network, e.from!, e.l1InscriptionId!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.nonce!)
          : useV6 ? inscribeMessageV6(this.network, e.from!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.parents ?? [], e.origins ?? [], e.originCohortRoot!, e.nonce!, onStar, e.bodyHash, e.meta)
          : useV5 ? inscribeMessageV5(this.network, e.from!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.parents ?? [], e.origins ?? [], e.bodyHash!, e.nonce!, onStar, e.meta)
          : useV4 ? inscribeMessageV4(this.network, e.from!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.parents ?? [], e.origins ?? [], e.meta!, e.nonce!, onStar)
          : useV3 ? inscribeMessageV3(this.network, e.from!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.parents ?? [], e.origins ?? [], e.nonce!)
          : inscribeMessageV2(this.network, e.from!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.parent !== undefined ? BigInt(e.parent) : undefined, e.nonce!, onStar))
        // PROVENANCE IS OWNED — a recursion child (NEW content star with parents) must descend from
        // KRAY stars YOU own, EVERY one of them — unless a claimed parent wears mint paper. Then the
        // sealed IR itself blesses the birth: runCall('mint') takes the price and increments taken.
        // That is the father's blessing — mathematics, not a signature from the living mouth.
        // The v2 singular and the v3 list walk the same check, one parent at a time.
        let mintBless: { take: bigint; faces: string[]; apply: () => void } = { take: 0n, faces: [], apply: () => {} }
        if (e.kind === 'inscribe' && onStar === undefined) {
          const claimed = useV3 ? (e.parents ?? []) : (e.parent !== undefined ? [e.parent] : [])
          mintBless = this.previewMintBlessings(e.from!, claimed, e.seq, e.at ?? 0)
        }
        // A5 — a mint blessing must not curse-and-charge. Same bytes already written
        // refuse the WHOLE act (no burn, no take, no taken++). The door already 409s;
        // the writer serializes apply, so two clicks of one file: first wins, second dies here.
        if (e.kind === 'inscribe' && onStar === undefined && mintBless.faces.length) {
          if (e.contentHash && this.stars.isContentTaken(e.contentHash)) {
            throw new Error('ledger: that exact content is already inscribed — every byte is unique in the universe')
          }
          if (e.bodyHash && this.stars.isBodyTaken(e.bodyHash)) {
            throw new Error('ledger: that exact work is already inscribed — the skeleton is unique in the universe')
          }
        }
        // THE UNIQUE-RELIC LAW — every birth/add, not only a mint child. Below the pin this
        // returns; at/after it a same-tick loser keeps every ₭ (the Buy fractal).
        this.assertUniqueRelicFree(e)
        // L1 ORDINAL PARENT — proveParentControl from Bitcoin bytes (enforced twice:
        // the HTTP door attaches/verifies the bag; the reducer re-proves on every
        // apply and replay). A signed origins list without a bag is not a parent.
        const originPlan = this.requireOriginControl(e)
        // ADD-TO-EXISTING — the target must exist, be yours, and not already carry this attribute
        if (onStar !== undefined) {
          const owner = this.stars.ownerOf(onStar)
          if (owner == null) throw new Error(`ledger: star #${onStar} does not exist`)
          if (owner !== e.from) throw new Error(`ledger: only the owner of star #${onStar} can add to it`)
          const st = this.stars.star(onStar)!
          if (e.kind === 'name' && st.name) throw new Error(`ledger: star #${onStar} already carries a name — a name is written once, forever`)
          if (e.kind === 'inscribe' && st.contentHash) throw new Error(`ledger: star #${onStar} already holds content — a star holds one inscription, forever`)
        }
        // THE SEAL BUDGET (Space Trinity · law 2) — a HARD physical bound, not a price: the open
        // seal carries at most 1 MB of new content. An act that would overflow is refused WHOLE
        // (nothing burned, retry after the next seal) — a full mempool, not a punishment. This is
        // what bounds the atlas below the world's disks forever: ≤ one budget per seal, eternally.
        const sealBudget = this.sealBudgetAt(e.seq)
        if (!(this.sealBytes + actBytes <= sealBudget)) throw new Error(`ledger: the open seal's content budget is full (${this.sealBytes} of ${sealBudget} bytes used, ${actBytes} asked) — retry after the next seal`)
        // THE SIZE-BURN LAW (Space Trinity · law 3) — the act burns linearly with the bytes it
        // writes at THE ERA'S RATE (bytesPerKray retargets every 1008 seals — one week — from measured demand;
        // floor 1 ₭: names and empty stars stay at the eternal 1). Priced AFTER the shape gates
        // and CHECKED before any mutation — a creator who cannot afford the fire burns nothing.
        const burn = starBurnOf((e.kind === 'inscribe' || e.kind === 'origin') ? (e.size as number | undefined) : undefined, this.bytesPerKrayNow)
        // THE ATLAS FEE (branch A, ratified 2026-08-23) — the wall-toll BESIDE the fire: same linear
        // law, same era rate, credited to TREASURY so the validators who hold the atlas are funded by
        // the bytes they will carry, not only by act count. Absent below the activation seq (A3) and
        // for zero-byte acts (a name or empty star stays at the eternal 1 ₭ burn, no toll).
        const atlasFee = (e.seq >= this.atlasFeeActivationSeq && actBytes > 0) ? starBurnOf(actBytes, this.bytesPerKrayNow) : 0n
        const mintTake = mintBless.take
        if (this.balanceOf(e.from!) < burn + atlasFee + mintTake) {
          throw new Error(`ledger: insufficient ₭ to burn — this ${e.size ?? 0}-byte star costs ${burn} ₭ at this era's rate (1 ₭ per ${this.bytesPerKrayNow} bytes)`
            + (atlasFee > 0n ? `, plus the ${atlasFee} ₭ atlas fee (the wall-toll that funds the validators holding these bytes)` : '')
            + (mintTake > 0n ? `, plus the mint price ${mintTake} ₭` : '')
            + `, you hold ${this.balanceOf(e.from!)}`)
        }
        // ── validated → mutate. stars.applyLive runs FIRST: with the shape gate above it can only
        //    curse-or-create (never throw) — but ordering it ahead of the irreversible burn/nonce is
        //    the STRUCTURAL safety net, so any future star-registry throw can never outlive a mutation. ──
        this.stars.applyLive(e, { mintParents: mintBless.faces })
        for (const id of originPlan.blessingIds) this.originBlessings.add(id)
        if (originPlan.open) {
          this.originCohorts.set(originPlan.open.root, {
            from: originPlan.open.from,
            origins: originPlan.open.origins,
            leaves: new Set(originPlan.open.leaves),
            taken: new Set([String(e.contentHash).toLowerCase()]),
          })
        }
        if (originPlan.take) {
          const row = this.originCohorts.get(originPlan.take.root)
          if (row) row.taken.add(originPlan.take.hash)
        }
        this.commitNonce(e)
        this.balances.set(e.from!, this.balanceOf(e.from!) - burn - atlasFee)
        if (atlasFee > 0n) this.credit(TREASURY, atlasFee)   // the wall-toll: payer-funded, conserved (debit == credit — the tripwire never moves)
        this.burned += burn               // ONLY the fire counts as burned — the toll circulates on to the validators
        this.mintX(e.from!, burn)         // BURN → Ӿ: the sacrificed ₭ condenses into Ӿ for the burner (1:1, conserved)
        mintBless.apply()                 // mint take + taken++ — after burn so affordability was one check
        this.sealBytes += actBytes        // the open seal's budget spends what the act weighed
        this.windowBytes += actBytes      // and the retarget window measures the era's demand
        break
      }
      case 'reward': {
        // RETIRED (see REWARD_RETIRED_FROM_SEQ): the last writer-trusted payout — its entitlement was never
        // re-derivable on replay. Below the seq the historical semantics apply byte-identically (A3); at/after
        // it the kind is refused: the fee pool pays only through the self-proving `settlement` (and, if the
        // anchor backstop is ever lit, a first-valid-sealer claim where the SPV proof IS the entitlement).
        if (e.seq >= this.rewardRetiredSeq) throw new Error('ledger: the unsigned reward is retired — the fee pool pays only what the bytes prove (settlement re-derives its whole table; an anchor claim must carry its own proof)')
        const amt = BigInt(e.amount!)
        if (amt <= 0n) throw new Error('ledger: reward must be positive')
        if (this.balanceOf(TREASURY) < amt) throw new Error(`ledger: reward exceeds the fee pool (have ${this.balanceOf(TREASURY)}, need ${amt})`)
        this.requireFungibleRecipient(e.to!, e.seq)    // parity with settlement/transfer — and never the hole (the burn law)
        // ── validated → mutate ──
        this.balances.set(TREASURY, this.balanceOf(TREASURY) - amt)
        this.credit(e.to!, amt)
        break
      }
      // ── THE RUNE L2 — reused RuneBook (never duplicated). Every credit backed by a proven
      //    L1 deposit, every exit by a proven L1 payout; the book's own solvency tripwire
      //    guards reserve == credits + locks. ₭ and runes are separate books on one ledger. ──
      case 'rune-deposit': {
        // a PROVEN L1 deposit credits L2 runes. The SPV proof is verified at ingress (server,
        // as in v1); the reducer enforces credited-once + solvency via the RuneBook.
        if (!e.runeId || !e.outpoint || !e.to || !e.amount) throw new Error('ledger: rune-deposit needs runeId + outpoint + to + amount')
        // PROOF MANDATORY (the same born-strict law as donate): at/after activation the reducer refuses a
        // rune credit whose L1 burial is not journaled in the event itself.
        if (e.seq >= this.proofMandatorySeq && !e.proof) {
          throw new Error('ledger: at/after proof-mandatory activation a rune deposit must embed its L1 SPV proof — the door alone is no longer the gate')
        }
        if (this.runes.wasCredited(e.outpoint)) throw new Error(`ledger: outpoint ${e.outpoint} was already credited — a deposit mints once, ever`)
        // THE KEYSTONE (born strict on signet/main): at/after activation the input rune state
        // must be re-derivable from bytes — the event embeds the recursive ancestry bundle.
        if (e.seq >= this.runeAncestrySeq && !e.proof?.ancestry?.length) {
          throw new Error('ledger: at/after rune-ancestry activation a rune deposit must embed its ancestry bundle — the input state is re-derived from bytes, never attested')
        }
        // ── ADR-1 · THE PEG, RE-PROVEN IN CONSENSUS (runes) ─────────────────────────────────────
        // If the event carries its L1 SPV proof, re-prove the deposit FROM BYTES on every apply and
        // replay: buried under work, the exact claimed outpoint, the runestone allocation delivers
        // EXACTLY the claimed amount to the vault re-derived from the journaled params, and the
        // credit binds to that vault's own depositor key. When the proof carries the ancestry
        // bundle, the INPUT STATE itself is re-derived (rune-ancestry.ts) — terminating at the
        // rune's etch or at an outpoint an earlier proven deposit in this journal already proved.
        // A proof that is PRESENT but does not verify HALTs — fail-closed. Absent proof is
        // byte-identical to before (the door gates).
        let provenVaultBalance: bigint | undefined
        if (e.proof) {
          const known = this.provenRuneOutpoints.get(canonicalRuneKey(e.runeId))
          const v = verifyRuneDepositProof(e.proof, {
            runeId: parseRuneKey(e.runeId), outpoint: e.outpoint, to: e.to, amount: BigInt(e.amount),
            net: this.network, minConfirmations: donationProofMinConf(toBtcNet(this.network)),
            pool: e.pool === true,
          }, known)
          if (!v.ok) throw new Error(`ledger: the rune deposit's own SPV proof does not verify on replay — ${v.reason}`)
          provenVaultBalance = v.provenVaultBalance
        }
        this.requireRecipientNetwork(e.to)
        // ── validated → mutate ──
        // the journal accumulates proven truth: a later deposit's walk may stop at this outpoint
        if (provenVaultBalance !== undefined) {
          const runeKey = canonicalRuneKey(e.runeId)
          const memo = this.provenRuneOutpoints.get(runeKey) ?? new Map<string, RuneBalance[]>()
          memo.set(e.outpoint, [{ id: parseRuneKey(e.runeId), amount: provenVaultBalance }])
          this.provenRuneOutpoints.set(runeKey, memo)
        }
        // `pool: true` = the coins landed straight in the SHARED consolidation pot, so the
        // credit is pot-backed from birth (no rehome ever needed). Absent = personal vault,
        // exactly as every deposit before this field existed — byte-identical, gate-identical.
        this.runes.deposit(parseRuneKey(e.runeId), e.outpoint, BigInt(e.amount), e.to, { pool: e.pool === true })
        break
      }
      case 'rune-send': {
        // an L2 rune transfer — signed by its holder, pays the eternal 1-₭ fee (runes riding
        // this L2 fund the validators who secure it). The reserve can never move here.
        if (!e.runeId || !e.from || !e.to || !e.amount) throw new Error('ledger: rune-send needs runeId + from + to + amount')
        if (isContractPotAddress(e.to)) {
          throw new Error('ledger: a rune cannot enter a law pot — the IR pays only ₭. Send ₭ to fund it.')
        }
        const rfee = BigInt(e.fee ?? '0')
        if (rfee !== MIN_FEE) throw new Error('ledger: a rune transfer pays the eternal 1-₭ fee — exactly one, never more')
        const ramt = BigInt(e.amount)
        if (ramt <= 0n) throw new Error('ledger: a rune transfer must be positive')
        if (e.from === e.to) throw new Error('ledger: a rune transfer needs two different parties')
        const rid = parseRuneKey(e.runeId)
        this.checkNonce(e)
        this.requireSig(e, runeSendMessage(this.network, e.from, e.to, e.runeId, ramt, e.nonce!))
        this.requireRecipientNetwork(e.to)
        if (this.balanceOf(e.from) < rfee) throw new Error('ledger: 1 ₭ of gas is needed to move runes')
        if (this.runes.balanceOf(rid, e.from) < ramt) throw new Error(`ledger: insufficient runes (have ${this.runes.balanceOf(rid, e.from)}, need ${ramt})`)
        // THE BACKING GATE — a recipient must NEVER be born a hostage: a send may only hand out
        // credits the shared pot already backs on Bitcoin. Credits still backed by the sender's
        // PERSONAL vault (which only their key opens) stay theirs until they rehome. Flag-gated
        // for replay compatibility; the door enforces it for every new send regardless.
        if (this.backingGate && ramt > this.runes.transferableOf(rid, e.from)) {
          throw new Error(`ledger: this send would hand out credits still backed by the sender's PERSONAL vault — a recipient must never need the sender's key to reach Bitcoin. Only pot-backed credits are sendable (transferable now: ${this.runes.transferableOf(rid, e.from)})`)
        }
        // ── validated → mutate ──
        this.commitNonce(e)
        this.runes.send(rid, e.from, e.to, ramt)
        this.balances.set(e.from, this.balanceOf(e.from) - rfee)
        this.credit(TREASURY, rfee)
        break
      }
      case 'rune-exit': {
        // phase one of an exit — the credits LEAVE the spendable book before any L1 payout
        // exists (spend-on-L2 and claim-on-L1 made mutually exclusive by arithmetic). The L1
        // destination is SIGNED, so a payout can never be redirected. It pays the eternal 1-₭
        // fee: a signed L2 act the validators verify, prove and Merkle-commit, so they earn for
        // it — the L1 payout fee is Bitcoin's miners', a different party for different work.
        if (!e.runeId || !e.from || !e.amount || !e.l1Address) throw new Error('ledger: rune-exit needs runeId + from + amount + l1Address')
        const efee = BigInt(e.fee ?? '0')
        if (efee !== MIN_FEE) throw new Error('ledger: a rune exit pays the eternal 1-₭ fee — exactly one, never more')
        const eamt = BigInt(e.amount)
        if (eamt <= 0n) throw new Error('ledger: an exit must be positive')
        const erid = parseRuneKey(e.runeId)
        this.checkNonce(e)
        this.requireSig(e, runeExitMessage(this.network, e.from, e.runeId, eamt, e.l1Address, e.nonce!))
        // THE L1 DESTINATION MUST BE SETTLEABLE. It is a free, signed field — a depositor may exit to ANY
        // address (paying anyone on L1 is a feature, not a leak: only their OWN signed balance is spent).
        // But it must decode on THIS Bitcoin network, or no payout could ever match it. A rune-cancel can
        // now recover such a lock, but the cancel costs its own fee and its own act — fail fast here (the
        // same net check transfers use) so a malformed destination never locks funds toward a settlement
        // that cannot happen.
        if (!isAddressOnNetwork(e.l1Address, toBtcNet(this.network))) throw new Error(`ledger: the exit L1 destination is not a valid ${this.network} Bitcoin address — refused before it could strand the runes in an unsettleable lock`)
        if (this.balanceOf(e.from) < efee) throw new Error('ledger: 1 ₭ of gas is needed to exit runes')
        if (this.runes.lockedOf(erid, e.from)) throw new Error('ledger: this address already has an open exit — settle or cancel it first')
        if (this.runes.balanceOf(erid, e.from) < eamt) throw new Error(`ledger: insufficient runes to exit (have ${this.runes.balanceOf(erid, e.from)}, need ${eamt})`)
        // ── validated → mutate ──
        this.commitNonce(e)
        this.runes.requestExit(erid, e.from, eamt, e.l1Address, e.at ?? 0)
        this.balances.set(e.from, this.balanceOf(e.from) - efee)
        this.credit(TREASURY, efee)                        // the fee funds the validators
        break
      }
      case 'rune-rehome': {
        // THE BAKERY OPENS — the depositor moved their vault's physical runes into the shared
        // consolidation pot on Bitcoin: one co-signed L1 transaction (their own CHECKSIGVERIFY
        // is REQUIRED on the cooperative leaf — nobody rehomes anyone else's box). The door
        // verified that confirmed, buried transaction pays the ONE canonical pot before this
        // was journaled; the event records the FACT (l1Txid + pot outpoint = the audit trail),
        // so replay re-derives the backing move forever. Their L2 credits DO NOT move — only
        // the backing's location: from now on everything they hold or hand out is pot-backed
        // and every recipient exits without them. System path, the rune-lodge precedent: the
        // depositor's authorization IS their co-signature inside the L1 transaction itself.
        if (!e.runeId || !e.from || !e.l1Txid) throw new Error('ledger: rune-rehome needs runeId + from + l1Txid')
        if (!/^[0-9a-f]{64}$/.test(e.l1Txid)) throw new Error('ledger: the rehome L1 txid must be 32-byte hex')
        const rhid = parseRuneKey(e.runeId)
        if (this.runes.personalOf(rhid, e.from) <= 0n) throw new Error('ledger: rune-rehome names an address with no personal-vault backing — nothing to move')
        // amount, when present, is the metal L1 actually moved (the pot output). Absent =
        // the whole personal box — every rehome journaled before this field, byte-identical.
        const rhAmt = e.amount != null && String(e.amount) !== '' ? BigInt(e.amount) : undefined
        if (rhAmt !== undefined && rhAmt <= 0n) throw new Error('ledger: a rehome amount must be positive')
        // ── validated → mutate ──
        this.runes.rehome(rhid, e.from, rhAmt)
        break
      }
      case 'rune-lodge': {
        // a PRE-SIGNED SETTLEMENT was lodged against an open exit — journal the FACT, so the
        // uncancellability of an armed exit is CONSENSUS (replay re-derives it; a lost sidecar
        // can no longer un-arm it). The co-signed hex itself is verified at the DOOR against
        // Bitcoin (witness audit + rune allocation), the same door-proof class as a deposit's
        // SPV; the journal records the result. System path — no user signature exists to take:
        // the depositor's authorization IS their co-signature inside the lodged hex.
        if (!e.runeId || !e.from) throw new Error('ledger: rune-lodge needs runeId + from')
        const lrid = parseRuneKey(e.runeId)
        const lpex = this.runes.lockedOf(lrid, e.from)
        if (!lpex) throw new Error('ledger: rune-lodge names no open exit')
        if (lpex.armed) throw new Error('ledger: this exit is already armed — one settlement, one arming')
        // ── validated → mutate ── bind the arm to the POT-OUTPOINT SET the payout spends (e.outpoint,
        // audit-trail, NOT committed) so the door can refuse a second DISTINCT pot payout of one lock.
        this.runes.armExit(lrid, e.from, e.outpoint)
        break
      }
      case 'rune-cancel': {
        // the exit request is WITHDRAWN — the locked credits return untouched, the reserve never
        // moves (nothing entered or left Bitcoin). Signed by the lock's own holder and nonce-bound,
        // so nobody can cancel anyone else's exit or replay a cancel. Pays the eternal 1-₭ fee:
        // it is a signed L2 act the validators verify and Merkle-commit, like send and exit.
        // An ARMED exit (rune-lodge journaled) refuses INSIDE the book — reducer law, replay law:
        // a co-signed settlement hex cannot be un-signed, and cancelling under it would let the
        // stale hex pay the old balance on L1 while the credits respend on L2.
        if (!e.runeId || !e.from) throw new Error('ledger: rune-cancel needs runeId + from')
        const cfee = BigInt(e.fee ?? '0')
        if (cfee !== MIN_FEE) throw new Error('ledger: a rune cancel pays the eternal 1-₭ fee — exactly one, never more')
        const crid = parseRuneKey(e.runeId)
        this.checkNonce(e)
        this.requireSig(e, runeCancelMessage(this.network, e.from, e.runeId, e.nonce!))
        if (!this.runes.lockedOf(crid, e.from)) throw new Error('ledger: rune-cancel names no open exit')
        if (this.balanceOf(e.from) < cfee) throw new Error('ledger: 1 ₭ of gas is needed to cancel an exit')
        // ── validated → mutate ──
        this.commitNonce(e)
        this.runes.cancelExit(crid, e.from)
        this.balances.set(e.from, this.balanceOf(e.from) - cfee)
        this.credit(TREASURY, cfee)
        break
      }
      case 'rune-settle': {
        // phase two — the L1 payout is PROVEN (SPV at ingress, the same H2 mirror as v1), so
        // the locked credits BURN and the reserve falls by exactly the same amount. One
        // payout, one burn, forever — the RuneBook enforces it.
        // THE LOAF (custody rung 5): one pot payout may pay MANY signed exits, each on its own
        // output. Such a settle carries `outpoint` (l1Txid:vout — the DELIVERY this burn keys
        // on); the dedup law becomes one-delivery-one-burn. Absent = the historic whole-tx key,
        // byte-identical for every settle journaled before the loaf existed (append-only law).
        if (!e.runeId || !e.from || !e.amount || !e.l1Txid) throw new Error('ledger: rune-settle needs runeId + from + amount + l1Txid')
        if (!/^[0-9a-f]{64}$/.test(e.l1Txid)) throw new Error('ledger: the L1 txid must be 32-byte hex')
        // PROOF MANDATORY (audit 2026-08-28): at/after activation a settle must carry its own SPV proof.
        if (e.seq >= this.proofMandatorySeq && !e.proof) {
          throw new Error('ledger: at/after proof-mandatory activation a rune settle must embed its L1 SPV proof — the door alone is no longer the gate')
        }
        let settleDelivery: string | undefined
        if (e.outpoint != null) {
          const om = /^([0-9a-f]{64}):(\d+)$/.exec(String(e.outpoint))
          if (!om) throw new Error('ledger: a rune-settle delivery outpoint must be txid:vout')
          if (om[1] !== e.l1Txid) throw new Error('ledger: the settle delivery outpoint names a different transaction than l1Txid — refused')
          settleDelivery = String(e.outpoint)
        }
        const srid = parseRuneKey(e.runeId)
        const pex = this.runes.lockedOf(srid, e.from)
        if (!pex) throw new Error('ledger: rune-settle names no open exit')
        if (pex.amount !== BigInt(e.amount)) throw new Error(`ledger: the payout is ${e.amount} but the locked exit is ${pex.amount} — a settlement matches its lock exactly`)
        if (this.runes.wasSettled(settleDelivery || e.l1Txid)) throw new Error(`ledger: delivery ${settleDelivery || e.l1Txid} already settled an exit — one delivery, one burn`)
        // THE KEYSTONE, SETTLE LEG (same activation as the deposit leg — one ratification, both books
        // empty): at/after it the payout's input state must be re-derivable from bytes too.
        if (e.seq >= this.runeAncestrySeq && !e.proof?.ancestry?.length) {
          throw new Error('ledger: at/after rune-ancestry activation a rune settle must embed its ancestry bundle — the payout input state is re-derived from bytes, never attested')
        }
        // ── ADR-1 · the payout re-proven from bytes when the event carries its proof: buried, IS the
        // claimed l1Txid, and delivers EXACTLY the locked amount to the exit's SIGNED destination.
        // With the ancestry bundle the INPUT STATE itself is re-derived — the walk stops at outpoints
        // this journal already proved (deposits + earlier settles' consolidation change), and a payout
        // that burns the focused rune refuses. Present-but-invalid HALTs; absent is byte-identical.
        let settleOutputs: Array<{ vout: number; amount: bigint }> | undefined
        if (e.proof) {
          const known = this.provenRuneOutpoints.get(canonicalRuneKey(e.runeId))
          const v = verifyRuneSettleProof(e.proof, {
            runeId: srid, l1Txid: e.l1Txid, l1Address: pex.l1Address, amount: pex.amount,
            net: this.network, minConfirmations: donationProofMinConf(toBtcNet(this.network)),
            deliveryVout: settleDelivery ? Number(settleDelivery.split(':')[1]) : undefined,
          }, known)
          if (!v.ok) throw new Error(`ledger: the rune settle's own SPV proof does not verify on replay — ${v.reason}`)
          settleOutputs = v.provenOutputs
        }
        // ── validated → mutate ──
        // the journal accumulates proven truth: the payout's consolidation change is now a known
        // outpoint, so the NEXT settle's walk (or a loaf sibling's) stops right there.
        if (settleOutputs !== undefined) {
          const runeKey = canonicalRuneKey(e.runeId)
          const memo = this.provenRuneOutpoints.get(runeKey) ?? new Map<string, RuneBalance[]>()
          for (const o of settleOutputs) memo.set(`${e.l1Txid}:${o.vout}`, [{ id: srid, amount: o.amount }])
          this.provenRuneOutpoints.set(runeKey, memo)
        }
        this.runes.settleExit(srid, e.from, BigInt(e.amount), e.l1Txid, settleDelivery)
        break
      }
      case 'amm-add': {
        // First mint or proportional add. 1 ₭ gas. Rune in must be pot-backed.
        // Shape before economics: a JSON number in krayIn/runeId used to coerce past the
        // door — refuse the TYPE here, before nonce or money move (partial-apply class).
        this.assertAmmDerived(e)
        if (typeof e.from !== 'string' || !e.from) throw new Error('ledger: amm-add needs from as a string')
        if (typeof e.runeId !== 'string' || !e.runeId) throw new Error('ledger: runeId must be a string — malformed event refused before any mutation')
        const id = canonicalRuneKey(e.runeId)
        this.requireRuneOnL2(id, 'amm-add')
        const afee = BigInt(e.fee ?? '0')
        if (afee !== MIN_FEE) throw new Error('ledger: an AMM add pays the eternal 1-₭ fee — exactly one, never more')
        const krayIn = this.posAmt(e.krayIn, 'krayIn')
        const runeIn = this.posAmt(e.runeIn, 'runeIn')
        const minLp = this.posAmt(e.minLp ?? '0', 'minLp')
        if (krayIn <= 0n || runeIn <= 0n) throw new Error('ledger: amm-add needs positive ₭ and rune')
        const rid = parseRuneKey(id)
        this.checkNonce(e)
        this.requireSig(e, ammAddMessage(this.network, e.from, e.runeId, krayIn, runeIn, minLp, e.nonce!))
        this.requireRecipientNetwork(e.from)
        if (this.balanceOf(e.from) < krayIn + afee) throw new Error('ledger: 1 ₭ of gas plus the ₭ deposit is needed to add liquidity')
        if (this.runes.balanceOf(rid, e.from) < runeIn) throw new Error(`ledger: insufficient runes to add (have ${this.runes.balanceOf(rid, e.from)}, need ${runeIn})`)
        if (this.backingGate && runeIn > this.runes.transferableOf(rid, e.from)) {
          throw new Error('ledger: only pot-backed runes may enter the AMM — a hostage credit cannot back a pool')
        }
        const pot = ammPoolAddress(id)
        const first = !this.amm.exists(id)
        let minted: bigint
        let supplyAfter: bigint
        if (first) {
          const q = quoteFirstMint(krayIn, runeIn)
          minted = q.minted
          supplyAfter = q.supply
        } else {
          const q = quoteAdd(this.balanceOf(pot), this.runes.balanceOf(rid, pot), this.amm.supplyOf(id), krayIn, runeIn)
          minted = q.minted
          supplyAfter = this.amm.supplyOf(id) + minted
        }
        if (minted < minLp) throw new Error(`ledger: minted LP ${minted} is below signed minLp ${minLp}`)
        this.commitNonce(e)
        this.balances.set(e.from, this.balanceOf(e.from) - krayIn - afee)
        this.credit(pot, krayIn)
        this.credit(TREASURY, afee)
        this.runes.send(rid, e.from, pot, runeIn)
        this.amm.mint(id, e.from, minted, supplyAfter)
        break
      }
      case 'amm-remove': {
        this.assertAmmDerived(e)
        if (typeof e.from !== 'string' || !e.from) throw new Error('ledger: amm-remove needs from as a string')
        if (typeof e.runeId !== 'string' || !e.runeId) throw new Error('ledger: runeId must be a string — malformed event refused before any mutation')
        const id = canonicalRuneKey(e.runeId)
        this.requireRuneOnL2(id, 'amm-remove')
        const rfee = BigInt(e.fee ?? '0')
        if (rfee !== MIN_FEE) throw new Error('ledger: an AMM remove pays the eternal 1-₭ fee — exactly one, never more')
        const lp = this.posAmt(e.lp, 'lp')
        const minKrayOut = this.posAmt(e.minKrayOut ?? '0', 'minKrayOut')
        const minRuneOut = this.posAmt(e.minRuneOut ?? '0', 'minRuneOut')
        if (lp <= 0n) throw new Error('ledger: amm-remove needs a positive LP burn')
        const rid = parseRuneKey(id)
        this.checkNonce(e)
        this.requireSig(e, ammRemoveMessage(this.network, e.from, e.runeId, lp, minKrayOut, minRuneOut, e.nonce!))
        if (this.balanceOf(e.from) < rfee) throw new Error('ledger: 1 ₭ of gas is needed to remove liquidity')
        // Holder check BEFORE commitNonce — quoteRemove only bounds lp ≤ supply, so burning
        // someone else's (or more than you hold) used to bump the nonce then throw in burn()
        // (live memory dirty, journal empty → restart HALTs). Same disease as C1.
        if (this.amm.lpOf(id, e.from) < lp) throw new Error(`ledger: insufficient LP (have ${this.amm.lpOf(id, e.from)}, need ${lp})`)
        const pot = ammPoolAddress(id)
        const q = quoteRemove(this.balanceOf(pot), this.runes.balanceOf(rid, pot), this.amm.supplyOf(id), lp)
        if (q.krayOut < minKrayOut) throw new Error(`ledger: ₭ out ${q.krayOut} is below signed min ${minKrayOut}`)
        if (q.runeOut < minRuneOut) throw new Error(`ledger: rune out ${q.runeOut} is below signed min ${minRuneOut}`)
        this.requireRecipientNetwork(e.from)
        this.commitNonce(e)
        this.amm.burn(id, e.from, lp)
        this.balances.set(pot, this.balanceOf(pot) - q.krayOut)
        this.credit(e.from, q.krayOut)
        this.runes.send(rid, pot, e.from, q.runeOut)
        this.balances.set(e.from, this.balanceOf(e.from) - rfee)
        this.credit(TREASURY, rfee)
        break
      }
      case 'amm-swap': {
        this.assertAmmDerived(e)
        if (typeof e.from !== 'string' || !e.from) throw new Error('ledger: amm-swap needs from as a string')
        if (typeof e.runeId !== 'string' || !e.runeId) throw new Error('ledger: runeId must be a string — malformed event refused before any mutation')
        if (e.side !== 'kray' && e.side !== 'rune') throw new Error('ledger: amm-swap needs side=kray|rune')
        const id = canonicalRuneKey(e.runeId)
        this.requireRuneOnL2(id, 'amm-swap')
        const sfee = BigInt(e.fee ?? '0')
        if (sfee !== MIN_FEE) throw new Error('ledger: an AMM swap pays the eternal 1-₭ fee — exactly one, never more')
        const amountIn = this.posAmt(e.amount, 'amountIn')
        const minOut = this.posAmt(e.minOut ?? '0', 'minOut')
        if (amountIn <= 0n) throw new Error('ledger: amm-swap needs a positive amountIn')
        const rid = parseRuneKey(id)
        this.checkNonce(e)
        this.requireSig(e, ammSwapMessage(this.network, e.from, e.runeId, e.side, amountIn, minOut, e.nonce!))
        const pot = ammPoolAddress(id)
        const krayR = this.balanceOf(pot)
        const runeR = this.runes.balanceOf(rid, pot)
        if (e.side === 'kray') {
          if (this.balanceOf(e.from) < amountIn + sfee) throw new Error('ledger: 1 ₭ of gas plus the ₭ sold is needed to swap')
          const out = quoteOut(krayR, runeR, amountIn)
          if (out < minOut) throw new Error(`ledger: rune out ${out} is below signed minOut ${minOut}`)
          this.requireRecipientNetwork(e.from)
          this.commitNonce(e)
          this.balances.set(e.from, this.balanceOf(e.from) - amountIn - sfee)
          this.credit(pot, amountIn)
          this.credit(TREASURY, sfee)
          this.runes.send(rid, pot, e.from, out)
        } else {
          if (this.balanceOf(e.from) < sfee) throw new Error('ledger: 1 ₭ of gas is needed to swap')
          if (this.runes.balanceOf(rid, e.from) < amountIn) throw new Error(`ledger: insufficient runes to swap (have ${this.runes.balanceOf(rid, e.from)}, need ${amountIn})`)
          if (this.backingGate && amountIn > this.runes.transferableOf(rid, e.from)) {
            throw new Error('ledger: only pot-backed runes may enter the AMM — a hostage credit cannot swap in')
          }
          const out = quoteOut(runeR, krayR, amountIn)
          if (out < minOut) throw new Error(`ledger: ₭ out ${out} is below signed minOut ${minOut}`)
          this.requireRecipientNetwork(e.from)
          this.commitNonce(e)
          this.runes.send(rid, e.from, pot, amountIn)
          this.balances.set(pot, this.balanceOf(pot) - out)
          this.credit(e.from, out)
          this.balances.set(e.from, this.balanceOf(e.from) - sfee)
          this.credit(TREASURY, sfee)
        }
        break
      }
      case 'amm-rr-add': {
        // Same UniV2 as ₭+rune. Both piles are pot-backed rune. Fee is still 1 ₭ (A2).
        this.assertAmmDerived(e)
        if (typeof e.from !== 'string' || !e.from) throw new Error('ledger: amm-rr-add needs from as a string')
        if (typeof e.runeId !== 'string' || !e.runeId) throw new Error('ledger: runeId must be a string — malformed event refused before any mutation')
        if (typeof e.otherRuneId !== 'string' || !e.otherRuneId) throw new Error('ledger: otherRuneId must be a string — malformed event refused before any mutation')
        if (e.krayIn != null) throw new Error('ledger: a rune/rune add has no ₭ pile — ₭ is the fee only')
        const pair = rrPairKey(e.runeId, e.otherRuneId)
        if (canonicalRuneKey(e.runeId) !== pair.a || canonicalRuneKey(e.otherRuneId) !== pair.b) {
          throw new Error('ledger: rune/rune events store the ordered pair (runeId < otherRuneId)')
        }
        this.requireRuneOnL2(pair.a, 'amm-rr-add')
        this.requireRuneOnL2(pair.b, 'amm-rr-add')
        const afee = BigInt(e.fee ?? '0')
        if (afee !== MIN_FEE) throw new Error('ledger: an AMM add pays the eternal 1-₭ fee — exactly one, never more')
        const aIn = this.posAmt(e.runeIn, 'runeIn')
        const bIn = this.posAmt(e.otherIn, 'otherIn')
        const minLp = this.posAmt(e.minLp ?? '0', 'minLp')
        if (aIn <= 0n || bIn <= 0n) throw new Error('ledger: amm-rr-add needs positive amounts on both runes')
        const ridA = parseRuneKey(pair.a)
        const ridB = parseRuneKey(pair.b)
        this.checkNonce(e)
        this.requireSig(e, ammRrAddMessage(this.network, e.from, pair.a, pair.b, aIn, bIn, minLp, e.nonce!))
        this.requireRecipientNetwork(e.from)
        if (this.balanceOf(e.from) < afee) throw new Error('ledger: 1 ₭ of gas is needed to add rune/rune liquidity')
        if (this.runes.balanceOf(ridA, e.from) < aIn) throw new Error(`ledger: insufficient ${pair.a} to add`)
        if (this.runes.balanceOf(ridB, e.from) < bIn) throw new Error(`ledger: insufficient ${pair.b} to add`)
        if (this.backingGate && aIn > this.runes.transferableOf(ridA, e.from)) {
          throw new Error('ledger: only pot-backed runes may enter the AMM — a hostage credit cannot back a pool')
        }
        if (this.backingGate && bIn > this.runes.transferableOf(ridB, e.from)) {
          throw new Error('ledger: only pot-backed runes may enter the AMM — a hostage credit cannot back a pool')
        }
        const pot = ammRrPoolAddress(pair.a, pair.b)
        const first = !this.amm.existsRr(pair.a, pair.b)
        let minted: bigint
        let supplyAfter: bigint
        if (first) {
          const q = quoteFirstMint(aIn, bIn)
          minted = q.minted
          supplyAfter = q.supply
        } else {
          const q = quoteAdd(this.runes.balanceOf(ridA, pot), this.runes.balanceOf(ridB, pot), this.amm.supplyOfRr(pair.a, pair.b), aIn, bIn)
          minted = q.minted
          supplyAfter = this.amm.supplyOfRr(pair.a, pair.b) + minted
        }
        if (minted < minLp) throw new Error(`ledger: minted LP ${minted} is below signed minLp ${minLp}`)
        this.commitNonce(e)
        this.balances.set(e.from, this.balanceOf(e.from) - afee)
        this.credit(TREASURY, afee)
        this.runes.send(ridA, e.from, pot, aIn)
        this.runes.send(ridB, e.from, pot, bIn)
        this.amm.mintRr(pair.a, pair.b, e.from, minted, supplyAfter)
        break
      }
      case 'amm-rr-remove': {
        this.assertAmmDerived(e)
        if (typeof e.from !== 'string' || !e.from) throw new Error('ledger: amm-rr-remove needs from as a string')
        if (typeof e.runeId !== 'string' || !e.runeId) throw new Error('ledger: runeId must be a string — malformed event refused before any mutation')
        if (typeof e.otherRuneId !== 'string' || !e.otherRuneId) throw new Error('ledger: otherRuneId must be a string — malformed event refused before any mutation')
        const pair = rrPairKey(e.runeId, e.otherRuneId)
        if (canonicalRuneKey(e.runeId) !== pair.a || canonicalRuneKey(e.otherRuneId) !== pair.b) {
          throw new Error('ledger: rune/rune events store the ordered pair (runeId < otherRuneId)')
        }
        this.requireRuneOnL2(pair.a, 'amm-rr-remove')
        this.requireRuneOnL2(pair.b, 'amm-rr-remove')
        const rfee = BigInt(e.fee ?? '0')
        if (rfee !== MIN_FEE) throw new Error('ledger: an AMM remove pays the eternal 1-₭ fee — exactly one, never more')
        const lp = this.posAmt(e.lp, 'lp')
        const minA = this.posAmt(e.minRuneOut ?? '0', 'minRuneOut')
        const minB = this.posAmt(e.minOtherOut ?? '0', 'minOtherOut')
        if (lp <= 0n) throw new Error('ledger: amm-rr-remove needs a positive LP burn')
        const ridA = parseRuneKey(pair.a)
        const ridB = parseRuneKey(pair.b)
        this.checkNonce(e)
        this.requireSig(e, ammRrRemoveMessage(this.network, e.from, pair.a, pair.b, lp, minA, minB, e.nonce!))
        if (this.balanceOf(e.from) < rfee) throw new Error('ledger: 1 ₭ of gas is needed to remove liquidity')
        if (this.amm.lpOfRr(pair.a, pair.b, e.from) < lp) throw new Error(`ledger: insufficient LP (have ${this.amm.lpOfRr(pair.a, pair.b, e.from)}, need ${lp})`)
        const pot = ammRrPoolAddress(pair.a, pair.b)
        const q = quoteRemove(this.runes.balanceOf(ridA, pot), this.runes.balanceOf(ridB, pot), this.amm.supplyOfRr(pair.a, pair.b), lp)
        if (q.krayOut < minA) throw new Error(`ledger: ${pair.a} out ${q.krayOut} is below signed min ${minA}`)
        if (q.runeOut < minB) throw new Error(`ledger: ${pair.b} out ${q.runeOut} is below signed min ${minB}`)
        this.requireRecipientNetwork(e.from)
        this.commitNonce(e)
        this.amm.burnRr(pair.a, pair.b, e.from, lp)
        this.runes.send(ridA, pot, e.from, q.krayOut)
        this.runes.send(ridB, pot, e.from, q.runeOut)
        this.balances.set(e.from, this.balanceOf(e.from) - rfee)
        this.credit(TREASURY, rfee)
        break
      }
      case 'amm-rr-swap': {
        this.assertAmmDerived(e)
        if (typeof e.from !== 'string' || !e.from) throw new Error('ledger: amm-rr-swap needs from as a string')
        if (typeof e.runeId !== 'string' || !e.runeId) throw new Error('ledger: runeId must be a string — malformed event refused before any mutation')
        if (typeof e.otherRuneId !== 'string' || !e.otherRuneId) throw new Error('ledger: otherRuneId must be a string — malformed event refused before any mutation')
        if (typeof e.payRuneId !== 'string' || !e.payRuneId) throw new Error('ledger: payRuneId must be a string — malformed event refused before any mutation')
        const pair = rrPairKey(e.runeId, e.otherRuneId)
        if (canonicalRuneKey(e.runeId) !== pair.a || canonicalRuneKey(e.otherRuneId) !== pair.b) {
          throw new Error('ledger: rune/rune events store the ordered pair (runeId < otherRuneId)')
        }
        this.requireRuneOnL2(pair.a, 'amm-rr-swap')
        this.requireRuneOnL2(pair.b, 'amm-rr-swap')
        const pay = canonicalRuneKey(e.payRuneId)
        if (pay !== pair.a && pay !== pair.b) throw new Error('ledger: payRuneId must be one side of the pair')
        const sfee = BigInt(e.fee ?? '0')
        if (sfee !== MIN_FEE) throw new Error('ledger: an AMM swap pays the eternal 1-₭ fee — exactly one, never more')
        const amountIn = this.posAmt(e.amount, 'amountIn')
        const minOut = this.posAmt(e.minOut ?? '0', 'minOut')
        if (amountIn <= 0n) throw new Error('ledger: amm-rr-swap needs a positive amountIn')
        const ridA = parseRuneKey(pair.a)
        const ridB = parseRuneKey(pair.b)
        const payRid = pay === pair.a ? ridA : ridB
        const outRid = pay === pair.a ? ridB : ridA
        this.checkNonce(e)
        this.requireSig(e, ammRrSwapMessage(this.network, e.from, pair.a, pair.b, pay, amountIn, minOut, e.nonce!))
        if (this.balanceOf(e.from) < sfee) throw new Error('ledger: 1 ₭ of gas is needed to swap')
        const pot = ammRrPoolAddress(pair.a, pair.b)
        if (this.runes.balanceOf(payRid, e.from) < amountIn) throw new Error('ledger: insufficient runes to swap')
        if (this.backingGate && amountIn > this.runes.transferableOf(payRid, e.from)) {
          throw new Error('ledger: only pot-backed runes may enter the AMM — a hostage credit cannot swap in')
        }
        const rin = this.runes.balanceOf(payRid, pot)
        const rout = this.runes.balanceOf(outRid, pot)
        const out = quoteOut(rin, rout, amountIn)
        if (out < minOut) throw new Error(`ledger: rune out ${out} is below signed minOut ${minOut}`)
        this.requireRecipientNetwork(e.from)
        this.commitNonce(e)
        this.runes.send(payRid, e.from, pot, amountIn)
        this.runes.send(outRid, pot, e.from, out)
        this.balances.set(e.from, this.balanceOf(e.from) - sfee)
        this.credit(TREASURY, sfee)
        break
      }
      // ── CONTRACTS — the total, deterministic VM (contract.ts) reused as-is.
      //    A contract holds ₭ at a DERIVED address no key encodes to, so its money moves
      //    ONLY by its own signed rules — the same seal that guards the pot. ──
      case 'contract': {
        // seal code: the creator signs the exact code; the address is derived from
        // (codeHash, creator, journal position), reproducible by replay, impossible to squat.
        // v1 (no e.star) is FROZEN — no burn, no star (A3). v2 (e.star set) burns 1 ₭
        // onto an owned star that does not yet carry a law (the third canvas).
        if (!e.from || !e.code) throw new Error('ledger: a contract needs a creator and code')
        const v = validateContract(e.code)
        if (!v.ok) throw new Error(`ledger: the contract is not valid (${v.reason}) — code that cannot be checked never enters history`)
        const codeHash = sha256hex(canonicalCode(e.code))
        const useV2 = e.star !== undefined
        let onStar: bigint | undefined
        if (useV2) {
          if (typeof e.star !== 'string' || !STAR_RE.test(e.star)) throw new Error('ledger: v2 law needs a star number')
          onStar = BigInt(e.star)
          this.requireSig(e, contractMessageV2(this.network, e.from, codeHash, onStar))
          const owner = this.stars.ownerOf(onStar)
          if (owner == null) throw new Error(`ledger: star #${onStar} does not exist`)
          if (owner !== e.from) throw new Error(`ledger: only the owner of star #${onStar} can give it a law`)
          const st = this.stars.star(onStar)!
          if (st.contract) throw new Error(`ledger: star #${onStar} already carries a law — one leash, forever`)
          if (this.balanceOf(e.from) < 1n) throw new Error('ledger: insufficient ₭ to burn (need 1 to seal a law on a star)')
        } else {
          this.requireSig(e, contractMessage(this.network, e.from, codeHash))
        }
        const addr = contractAddress(codeHash, e.from, e.seq)
        if (this.contracts.has(addr)) throw new Error('ledger: that contract address already exists')
        if (isPollPaper(e.code) && !useV2) throw new Error('ledger: a poll hangs on a star')
        // ── validated → mutate ──
        const state: Record<string, bigint> = {}
        for (const [kk, val] of Object.entries(e.code.vars ?? {})) state[kk] = BigInt(val)
        // Art URL is NOT journaled (a replica would leak the drop). The writer door keeps it.
        if (e.shelf !== undefined && String(e.shelf).trim() !== '') {
          throw new Error('ledger: an art URL does not ride the journal — a stranger would steal the file')
        }
        this.contracts.set(addr, { code: e.code, creator: e.from, state, ...(useV2 ? { star: e.star } : {}) })
        if (useV2) {
          this.stars.applyLive(e)
          this.balances.set(e.from, this.balanceOf(e.from) - 1n)
          this.burned += 1n
          this.mintX(e.from, 1n)          // BURN → Ӿ: sealing a law burns 1 ₭ → 1 Ӿ to the burner (1:1, conserved)
          // Luz genesis: capped paper spends supply once (founders + remainder to sealer).
          if (isCutPaper(e.code) && String(e.code.vars?.capped) === '1') {
            const supply = BigInt(e.code.vars?.supply ?? '0')
            if (supply > 0n) {
              const credits = resolveLuzGenesis(e.code, e.from)
              for (const c of credits) {
                this.requireRecipientNetwork(c.to)
                if (c.to.startsWith('KRAY_') || isContractPotAddress(c.to) || isAmmPotAddress(c.to)) {
                  throw new Error('ledger: a founder cannot be a protocol pot')
                }
              }
              this.cuts.genesisAlloc(String(onStar), supply, credits)
            }
          }
          if (isPollPaper(e.code) && onStar != null) {
            const paper = e.code.poll
            if (!paper || !Array.isArray(paper.choices) || paper.choices.length < 2) {
              throw new Error('ledger: a poll needs sealed choices')
            }
            this.polls.open(String(onStar), paper.title || '', paper.choices)
          }
        }
        break
      }
      case 'contract-call': {
        // run a rule: the caller signs contract+rule+args+nonce, pays the eternal 1-₭ fee.
        // The language is total (always terminates), deterministic (every node agrees), and
        // pays only from the contract's OWN balance — Σ conservation can't be touched here.
        if (!e.from || !e.contract || !e.rule) throw new Error('ledger: a call needs from + contract + rule')
        const entry = this.contracts.get(e.contract)
        if (!entry) throw new Error('ledger: no such contract')
        const cfee = BigInt(e.fee ?? '0')
        if (cfee !== MIN_FEE) throw new Error('ledger: a contract call pays the eternal 1-₭ fee — exactly one, never more')
        this.checkNonce(e)
        const args: Record<string, bigint> = {}
        for (const [kk, val] of Object.entries(e.callArgs ?? {})) {
          if (!/^-?\d+$/.test(val)) throw new Error(`ledger: argument "${kk}" must be a whole number`)
          args[kk] = BigInt(val)
        }
        const clock = e.clock
        const v2 = clock !== undefined
        if (v2) {
          if (typeof clock !== 'number' || !Number.isInteger(clock) || clock < 0) {
            throw new Error('ledger: a v2 call needs a whole-number clock — the signed ctx.at')
          }
          this.requireSig(e, contractCallMessageV2(this.network, e.from, e.contract, e.rule, args, e.nonce!, clock))
        } else {
          this.requireSig(e, contractCallMessage(this.network, e.from, e.contract, e.rule, args, e.nonce!))
        }
        if (this.balanceOf(e.from) < cfee) throw new Error('ledger: 1 ₭ of gas is needed to call a contract')
        // LIVING MOUTH (v2): toggle_* / once_* / collect / stamp / draw / skip travel with the face.
        // Pulse and form doors (accept, refund, punch, release, claim, enter, settle, vote) follow the IR.
        let livingHolder: string | undefined
        if (entry.star != null) {
          livingHolder = this.stars.ownerOf(BigInt(entry.star)) ?? undefined
          if (!livingHolder) throw new Error('ledger: the bound star has no living owner')
          if ((e.rule === 'collect' || e.rule === 'stamp' || e.rule === 'draw' || e.rule === 'skip' || e.rule.startsWith('toggle_') || e.rule.startsWith('once_')) && e.from !== livingHolder) {
            throw new Error('ledger: only the living owner of the star may use its law — the mouth travels with the face')
          }
        }
        if (e.rule === 'mint') {
          throw new Error('ledger: mint is a birth — inscribe with this face as parent')
        }
        if (e.rule === 'enter' || e.rule === 'settle' || e.rule === 'draw' || e.rule === 'skip') {
          if (!v2) throw new Error('ledger: a raffle door needs a v2 call — the Bitcoin seal is the clock')
          if (entry.star == null) throw new Error('ledger: a raffle door needs a star — the Bitcoin seal is the clock, and draw is the living mouth')
        }
        if (isPollPaper(entry.code) && e.rule === 'vote') {
          if (!v2) throw new Error('ledger: a poll vote needs a v2 call — glow is a journal fact')
          if (entry.star == null) throw new Error('ledger: a poll vote needs a star')
        }
        const stateForCall = { ...entry.state }
        if (livingHolder) stateForCall.owner = BigInt('0x' + sha256hex(livingHolder).slice(0, 16))
        const at = v2 ? clock : (e.at ?? 0)
        const result = runCall(entry.code, e.rule, this.callContext(e.from, e.contract, e.seq, at, args, entry.star, v2), stateForCall)
        if (!result.ok) throw new Error(`ledger: the call was refused by the contract (${result.reason})`)
        if (isPollPaper(entry.code) && e.rule === 'vote') {
          const face = args.face
          if (face === undefined) throw new Error('ledger: a poll vote names a face')
          const fi = Number(face)
          if (!Number.isInteger(fi) || fi < 0) throw new Error('ledger: a poll face must be a whole number')
          const weight = this.glowOf(e.from)
          if (weight < 1) throw new Error('ledger: a poll vote needs ✦ glow — freeze a star first')
          if (this.polls.voted(String(entry.star), e.from)) throw new Error('ledger: already voted on this poll')
        }
        if (livingHolder && e.rule === 'collect') {
          for (const pmt of result.payments) pmt.to = livingHolder
        }
        const takeIn = result.take ?? 0n
        if (takeIn < 0n) throw new Error('ledger: a take cannot be negative')
        if (this.balanceOf(e.from) < cfee + takeIn) throw new Error('ledger: 1 ₭ of gas is needed to call a contract' + (takeIn > 0n ? ', plus the ticket' : ''))
        const roster = entry.roster ?? []
        const resolved: { to: string; amount: bigint }[] = []
        for (const pmt of result.payments) {
          if (pmt.seat !== undefined) {
            const i = Number(pmt.seat)
            if (!Number.isInteger(i) || i < 0 || !roster[i]) throw new Error('ledger: that raffle seat is empty — refused')
            resolved.push({ to: roster[i], amount: pmt.amount })
          } else {
            resolved.push({ to: pmt.to, amount: pmt.amount })
          }
        }
        // THE PROOF GATE (for code): re-execution is the source of truth; if the journal ALSO
        // records payouts (for auditors who don't re-run), they must match exactly, or HALT.
        if (e.payouts) {
          const recorded = (e.payouts as SettlementRow[]).map((r) => ({ to: r[0], amount: BigInt(r[1]) }))
          if (recorded.length !== resolved.length) throw new Error('ledger: the recorded payments are not the ones this call produces — HALT')
          for (let i = 0; i < recorded.length; i++) {
            if (recorded[i].to !== resolved[i].to || recorded[i].amount !== resolved[i].amount) throw new Error(`ledger: recorded payment ${i} does not match the law — HALT`)
          }
        }
        let paid = 0n
        for (const pmt of resolved) { paid += pmt.amount; this.requireFungibleRecipient(pmt.to, e.seq) }   // never cross networks, never the hole (the burn law)
        if (this.balanceOf(e.contract) + takeIn < paid) throw new Error('ledger: the contract cannot afford its own payments — refused')
        for (const b of result.binds ?? []) {
          const i = Number(b.at)
          if (!Number.isInteger(i) || i < 0 || i > 64) throw new Error('ledger: a raffle seat is out of range')
          if (b.addr !== e.from) throw new Error('ledger: a bind can only remember the signer')
        }
        // ── validated → mutate, atomically: fee, ticket, payments, roster, state ──
        this.commitNonce(e)
        this.balances.set(e.from, this.balanceOf(e.from) - cfee - takeIn)
        this.credit(TREASURY, cfee)
        if (takeIn > 0n) this.credit(e.contract, takeIn)
        this.balances.set(e.contract, this.balanceOf(e.contract) - paid)
        for (const pmt of resolved) this.credit(pmt.to, pmt.amount)
        if (!entry.roster) entry.roster = []
        for (const b of result.binds ?? []) entry.roster[Number(b.at)] = b.addr
        for (const [kk, val] of Object.entries(result.vars)) entry.state[kk] = val
        if (entry.state.taken === 0n) entry.roster = []
        if (isPollPaper(entry.code) && e.rule === 'vote' && entry.star != null) {
          this.polls.cast(String(entry.star), e.from, Number(args.face), this.glowOf(e.from))
        }
        this.lastCall = {
          rule: e.rule, from: e.from, contract: e.contract, take: takeIn.toString(),
          payments: resolved.map((p) => ({ to: p.to, amount: p.amount.toString() })),
          interval: this.sealsSeen.toString(), beacon: this.lastSealTxid,
        }
        break
      }
      case 'eternize': {
        // THE ETERNAL DOOR (docs/ETERNIZE.md) — bind a star to the L1 ordinal inscription that
        // carries its EXACT bytes. Ordinals solved the stone; this act buys that stone for one
        // star's body. The proof rides the event (ADR-1: pure/offline SPV re-verify, no network)
        // and re-proves on EVERY replay — a follower that cannot re-prove it refuses the line.
        // Identity, ownership and ₭ do not move; only availability upgrades to Bitcoin's own.
        this.checkNonce(e)
        // SHAPE GATE — inputs are hostile until validated; refuse malformed TYPES before any mutation.
        if (typeof e.from !== 'string') throw new Error('ledger: from must be a string')
        if (typeof e.star !== 'string' || !STAR_RE.test(e.star)) throw new Error('ledger: eternize names one star, by its number')
        if (typeof e.l1InscriptionId !== 'string' || !ORDINAL_ID_RE.test(e.l1InscriptionId)) throw new Error('ledger: eternize needs the L1 inscription id (<txid>iN)')
        this.requireSig(e, eternizeMessage(this.network, e.from, BigInt(e.star), e.l1InscriptionId, e.nonce!))
        const efee = BigInt(e.fee ?? '0')
        if (efee !== MIN_FEE) throw new Error('ledger: eternize costs exactly 1 ₭ — the seal, no more, no less')
        if (this.balanceOf(e.from) < efee) throw new Error('ledger: 1 ₭ is needed to eternize')
        const est = this.stars.star(BigInt(e.star))
        if (!est) throw new Error(`ledger: star #${e.star} does not exist`)
        if (!est.contentHash) throw new Error('ledger: a star with no content has no bytes to eternize — carve the body first')
        if (est.eternal) throw new Error(`ledger: star #${e.star} is already eternal — one binding, forever`)
        // OWNER-ONLY (Creator, 2026-08-31). A stranger who carves the same bytes on L1
        // first, or injects a line into their own node, still cannot bind: requireSig
        // binds `from` to a real key; this line requires that key to BE the holder.
        // A private journal that skips this is not the book — followers re-prove.
        if (est.owner !== e.from) throw new Error(`ledger: only the owner of star #${e.star} may eternize`)
        // THE PROOF — the reveal's carved bytes must BE this star's bytes, buried under real work.
        if (!Array.isArray(e.eternalProof) || e.eternalProof.length === 0) throw new Error('ledger: eternize carries its own SPV bundle — no proof, no eternity')
        const [revealTxid, idxStr] = e.l1InscriptionId.split('i')
        const verdict = proveInscription(revealTxid, Number(idxStr), e.eternalProof as ProvenTx[], {
          minConfirmations: donationProofMinConf(this.network), net: this.network,
        })
        if (!verdict.ok) throw new Error(`ledger: the L1 carving is not proven (${verdict.reason}) — refused`)
        if (verdict.contentHash !== est.contentHash) throw new Error('ledger: the carved bytes are not this star\'s bytes — byte-for-byte or nothing')
        // PAID TO THE ETERNIZER — the reveal output that received the sat must be
        // `from`'s script (the owner who seals, this instant). Owner changes later;
        // this line does not chase them. A clone born to another key cannot bind.
        let eternizerScript: string
        try { eternizerScript = scriptOfAddress(e.from, toBtcNet(this.network)).toLowerCase() }
        catch { throw new Error('ledger: cannot derive the eternizer script from `from`') }
        if (!verdict.paidScriptHex || verdict.paidScriptHex.toLowerCase() !== eternizerScript) {
          throw new Error('ledger: the L1 carving was not paid to the eternizer — a clone in another wallet cannot bind')
        }
        // ── validated → mutate, atomically: 1 ₭ → Treasury, the star gains its eternal binding ──
        this.commitNonce(e)
        this.balances.set(e.from, this.balanceOf(e.from) - efee)
        this.credit(TREASURY, efee)
        this.stars.applyLive(e)
        break
      }
      case 'settlement': {
        // THE VALIDATOR PAYOUT, RE-DERIVED FROM ITS BEATS. The event carries the Bitcoin beacon and the beats
        // each validator submitted for the span; the reducer recomputes the WHOLE table via settleFromBeats
        // (proven work in — beat PoW bound to beacon+address+block, a block counted once — linear split out)
        // and credits it from the fee pool. No operator can write a payout the beats do not produce: every
        // follower recomputes the same table and refutes a mismatch. Conserved — ₭ moves from the Treasury to
        // the workers, NONE minted. Sybil-neutral: splitting one machine across N names earns exactly the same.
        if (!e.beacon || !/^[0-9a-f]{64}$/.test(e.beacon)) throw new Error('ledger: a settlement needs the real 64-hex Bitcoin beacon it settled against')
        if (!Array.isArray(e.claims)) throw new Error('ledger: a settlement must carry the beats it settles (claims)')
        const presenceTip = readPresenceTip(e.presenceTip)
        assertPresenceEra(e.seq, presenceTip)
        const folded = foldClaimsByAddress(e.claims)
        const windowed = presenceTip !== undefined
        assertPresenceClaims(folded, presenceTip)
        if (windowed && !e.payouts) throw new Error('ledger: a windowed settlement must record the payout table — HALT')
        const budget = this.balanceOf(TREASURY)
        // Windowed: verifyCustody is exact or HALT (bits without aggregate are not a proof).
        // Historical: a lie (aggregate-mismatch) still HALTs; bytes-missing keeps the bitmap (A3).
        const { rewards } = settleFromBeats(e.beacon, budget, folded.map((c) => ({
          address: c.address, beats: c.beats,
          hits: this.hitsFromCustody(c.custody, e.beacon!, c.address, windowed),
        })), windowed ? { presenceTip, seq: e.seq } : { seq: e.seq })
        // if the event ALSO records the flat payout table (for auditors who do not re-run), it must match EXACTLY
        if (e.payouts) {
          const want = rewards.map((r) => r.id + '=' + r.amount.toString()).sort().join('|')
          const got = (e.payouts as SettlementRow[]).map((r) => r[0] + '=' + r[2]).sort().join('|')
          if (want !== got) throw new Error('ledger: the recorded settlement is not the one the beats produce — HALT')
        }
        for (const r of rewards) this.requireFungibleRecipient(r.id, e.seq)   // never cross networks, never the hole (the burn law)
        const paid = rewards.reduce((t, r) => t + r.amount, 0n)
        if (this.balanceOf(TREASURY) < paid) throw new Error('ledger: the settlement pays more than the fee pool holds')
        // ── validated → mutate ──
        this.balances.set(TREASURY, this.balanceOf(TREASURY) - paid)
        for (const r of rewards) this.credit(r.id, r.amount)
        break
      }
      default:
        // NO HARD FORK (axiom A3): a node meeting an event kind it does not implement FREEZES rather than
        // silently skipping it. Silently no-op'ing an unknown/future kind (advancing seq + the cascade root
        // while doing nothing) is exactly a silent fork — a newer node that DOES act on that kind diverges
        // from this one with no signal. So we HALT: the operator must upgrade to a build that understands it.
        throw new Error(`ledger: unknown event kind '${String((e as { kind?: unknown }).kind)}' — this node HALTS (no hard fork; upgrade to a build that implements this kind before replaying it)`)
    }
    this.lastAppliedSeq = e.seq
    // ADR-3 3a (Slice A): the act fully applied — NOW commit its leaf, but ONLY at/after the activation height
    // (from-H). Below H the WHOLE feature is inert — no collection, no fold — so the accumulator never grows and
    // there is zero pre-activation cost; acts before H predate the inclusion regime (they carry no deadline, so
    // they serve no 3d proof). Only a signed kind set _pendingInclusionKey (donate/settlement/seal never call
    // requireSig — pin 2; quantum-migrate signs via Lamport OUTSIDE requireSig, so it is a NAMED v1 exclusion, a
    // follow-up either routes it through collection or names it permanently out). Reached only past every `throw`
    // above, so a refused act contributes nothing. Same code at the door AND on replay.
    if (this._pendingInclusionKey && e.seq >= this.inclusionActivationSeq) this.includedTree.insert(this._pendingInclusionKey)
    // THE SAME-INSTANT LAW — commit the applied act into the open run (only a FULLY applied act
    // occupies a run slot; assertSameInstantOrder already proved this extension keeps the run equal
    // to orderWindow's schedule). An unsigned act, a pre-law act, or a different `at` closes the run.
    if (this._pendingInclusionKey && e.seq >= this.sameInstantOrderSeq && typeof e.at === 'number') {
      const entry = { key: this._pendingInclusionKey, from: String(e.from), nonce: e.nonce }
      if (this._instantRun && this._instantRun.at === e.at) this._instantRun.acts.push(entry)
      else this._instantRun = { at: e.at, acts: [entry] }
    } else {
      this._instantRun = null
    }
    this._pendingInclusionKey = null
    // record the cascade root this event produced → {seq, inclusion root}, so a later seal can bind its anchor's
    // committed root (a PAST block-boundary root under confirmation latency) to the inclusion set it anchored.
    this._recordProducedRoot(e.seq)
    // A1 · Conservation or HALT — the five equalities, after every accepted act. A lie here
    // means a reducer bug (or a hostile inject). Freeze: do not serve, do not append, do not
    // pretend the cascade root is money. Restart replays the durable journal (this act is
    // not on disk when the store gates the write on this throw).
    if (!this.conserves()) {
      this.halted = `conservation broke at seq ${e.seq}`
      throw new Error(`ledger: conservation broke at seq ${e.seq} — HALT (A1: Σ ₭ / Σ Ӿ / tank tripwire)`)
    }
  }

  /** producedRoots recorder — cascade root → {seq, inclusion root at that seq}. Bounded by a hard cap (evict the
   *  oldest — the only deletion; anti-rewind is the seq_anchor guard, not eviction). O(1) amortised (cascadeRoot O(1)). */
  private _recordProducedRoot(seq: number): void {
    this.producedRoots.set(this.cascadeRoot(), { seq, inclusionRoot: this.inclusionRoot() })
    if (this.producedRoots.size > PRODUCED_ROOTS_CAP) {
      const oldest = this.producedRoots.keys().next().value
      if (oldest !== undefined) this.producedRoots.delete(oldest)
    }
  }

  /** check only — throws on a missing/stale/forward nonce, mutates nothing (the atomic guard).
   *  A DEFINED whole-number nonce is MANDATORY: an omitted nonce would make the signed message
   *  independent of any monotonic value (it literally reads `nonce=undefined`), so the same signed
   *  body would replay forever under fresh seqs and survive replay — a durable double-spend. Every
   *  nonce-guarded (signed) kind must carry its real nonce, and the reducer refuses anything else. */
  private checkNonce(e: KrayEvent): void {
    if (typeof e.nonce !== 'number' || !Number.isInteger(e.nonce) || e.nonce < 0) {
      throw new Error('ledger: a signed action needs a whole-number nonce — a missing or non-integer nonce is refused (it would be infinitely replayable)')
    }
    if (e.nonce !== this.nonceOf(e.from!)) {
      throw new Error(`ledger: nonce ${e.nonce} != expected ${this.nonceOf(e.from!)}`)
    }
  }
  /** mutate — bump the signer's nonce; called only after every check has passed */
  private commitNonce(e: KrayEvent): void {
    const next = this.nonceOf(e.from!) + 1
    this.nonces.set(e.from!, next)
    // ADR-3 eligibility opening — track the new nonce with a 0 SENTINEL (unanchored) so a mid-stream cascade
    // opening never over-convicts; the next seal promotes it to that seal's Bitcoin height (sticky). Maintained
    // from genesis (mirrors balances), so the map reflects the real nonce when activation first folds it.
    this.nonceMap.update(e.from!, next, 0)
    this.nonceAdvancedSinceSeal.set(e.from!, e.seq)   // the SEQ of this advance — a seal promotes only advances ≤ its seq_anchor
  }

  /** THE RAIL — AMM output is re-derived from the signed in + the book. A journaled
   *  quote (amountOut, minted, k, …) is not a proof; it is a claim. Purge it here,
   *  before nonce or money move, so a stranger's replay never sees a number the
   *  reducer did not compute. */
  /** A pool is born only from a rune this L2 already proves (a deposit wrote the book). Ghost ids refuse before nonce. */
  private requireRuneOnL2(id: string, verb: string): void {
    const key = canonicalRuneKey(id)
    if (!this.runes.knows(parseRuneKey(key))) {
      throw new Error(`ledger: ${key} is not on this L2 — ${verb} refused; a pool is born only from a proven rune book`)
    }
  }

  private assertAmmDerived(e: KrayEvent): void {
    const banned = ['amountOut', 'minted', 'krayOut', 'runeOut', 'k'] as const
    for (const key of banned) {
      if (!Object.prototype.hasOwnProperty.call(e, key)) continue
      const v = (e as unknown as Record<string, unknown>)[key]
      if (v != null) throw new Error('ledger: AMM output is re-derived from the book — a journaled quote is purged before any mutation')
    }
  }

  private posAmt(raw: string | undefined, name: string): bigint {
    // typeof first: RegExp.test coerces a JSON number (4000 → "4000") and would
    // accept it — the same C1 class that once burned a name then threw.
    if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) throw new Error(`ledger: ${name} must be a whole number of base units`)
    return BigInt(raw)
  }

  /**
   * MINT BLESSING — if a claimed parent wears mint paper, the sealed IR fathers
   * the child (runCall mint). The living owner is not asked. At most one mint
   * parent per birth; every other parent still requires ownership. Preview only:
   * apply() mutates take + pay + state after the burn+price affordability check.
   */
  private previewMintBlessings(from: string, claimed: string[], seq: number, at: number): { take: bigint; faces: string[]; apply: () => void } {
    const jobs: Array<() => void> = []
    const faces: string[] = []
    let take = 0n
    let mintParents = 0
    for (const p of claimed) {
      const no = BigInt(p)
      const parent = this.stars.star(no)
      if (!parent) throw new Error(`ledger: parent star #${p} does not exist`)
      const pot = parent.contract
      const entry = pot ? this.contracts.get(pot) : undefined
      if (entry && isMintPaper(entry.code)) {
        mintParents++
        if (mintParents > 1) throw new Error('ledger: one mint parent per birth')
        faces.push(p)
        const livingHolder = this.stars.ownerOf(no)
        if (livingHolder == null) throw new Error(`ledger: parent star #${p} does not exist`)
        const stateForCall = { ...entry.state }
        stateForCall.owner = BigInt('0x' + sha256hex(livingHolder).slice(0, 16))
        const result = runCall(entry.code, 'mint', this.callContext(from, pot!, seq, at, {}, String(p), false), stateForCall)
        if (!result.ok) throw new Error(`ledger: the mint blessing refused (${result.reason})`)
        if ((result.binds ?? []).length) throw new Error('ledger: a mint blessing does not bind a seat')
        const takeIn = result.take ?? 0n
        if (takeIn < 0n) throw new Error('ledger: a take cannot be negative')
        const resolved: { to: string; amount: bigint }[] = []
        for (const pmt of result.payments) {
          if (pmt.seat !== undefined) throw new Error('ledger: a mint blessing does not pay a raffle seat')
          if (!pmt.to) throw new Error('ledger: a mint blessing payment needs an address')
          this.requireRecipientNetwork(pmt.to)
          resolved.push({ to: pmt.to, amount: pmt.amount })
        }
        const paid = resolved.reduce((s, r) => s + r.amount, 0n)
        if (this.balanceOf(pot!) + takeIn < paid) throw new Error('ledger: the mint pot cannot afford its own payment — refused')
        take += takeIn
        jobs.push(() => {
          if (takeIn > 0n) {
            this.balances.set(from, this.balanceOf(from) - takeIn)
            this.credit(pot!, takeIn)
          }
          if (paid > 0n) this.balances.set(pot!, this.balanceOf(pot!) - paid)
          for (const pmt of resolved) this.credit(pmt.to, pmt.amount)
          for (const [kk, val] of Object.entries(result.vars)) entry.state[kk] = val
        })
      } else {
        const parentOwner = this.stars.ownerOf(no)
        if (parentOwner == null) throw new Error(`ledger: parent star #${p} does not exist`)
        if (parentOwner !== from) throw new Error(`ledger: only the owner of star #${p} can father a child from it`)
      }
    }
    return { take, faces, apply: () => { for (const j of jobs) j() } }
  }

  /** the deterministic world a contract rule sees.
   *  v1 (no signed clock): interval/beacon stay 0 so every already-journaled call
   *  replays byte-identical (A3). v2: interval = seals since genesis, beacon =
   *  last Bitcoin seal txid as an integer — both re-derived from the journal
   *  prefix, never from a live tip. */
  private callContext(from: string, contract: string, seq: number, at: number, args: Record<string, bigint>, star?: string, v2 = false) {
    const holderAddress = star != null ? (this.stars.ownerOf(BigInt(star)) ?? '') : ''
    const beacon = (v2 && this.lastSealTxid) ? BigInt('0x' + this.lastSealTxid) : 0n
    const interval = v2 ? BigInt(this.sealsSeen) : 0n
    return {
      caller: from, self: contract, balance: this.balanceOf(contract),
      height: BigInt(seq), interval, at: BigInt(at), beacon,
      star: star != null ? BigInt(star) : 0n,
      holder: holderAddress ? BigInt('0x' + sha256hex(holderAddress).slice(0, 16)) : 0n,
      holderAddress,
      glow: BigInt(this.glowOf(from)),
      args,
      addressToInt: (a: string) => BigInt('0x' + sha256hex(a).slice(0, 16)),
    }
  }

  /** a contract's public view — its creator, current state, and the sealed IR (or null if unknown) */
  contractAt(addr: string): {
    address: string; creator: string; state: Record<string, string>
    rules: string[]; balance: string; code: ContractCode; codeHash: string; star?: string
    faces?: string[]
  } | null {
    const c = this.contracts.get(addr)
    if (!c) return null
    const state: Record<string, string> = {}
    for (const [kk, val] of Object.entries(c.state)) state[kk] = val.toString()
    return {
      address: addr, creator: c.creator, state,
      rules: c.code.rules.map((r) => r.name),
      balance: this.balanceOf(addr).toString(),
      code: c.code,
      codeHash: sha256hex(canonicalCode(c.code)),
      ...(c.star ? { star: c.star } : {}),
      ...(c.roster && c.roster.some(Boolean) ? { faces: c.roster.map((a) => a || '') } : {}),
    }
  }
  allContractAddresses(): string[] { return [...this.contracts.keys()].sort() }

  /** A1 reason if the tripwire already fired, else null. A halted ledger refuses every later apply. */
  haltedReason(): string | null { return this.halted }

  /** THE TRIPWIRE: Σ balances == emitted − burned, exactly, or the node has drifted. Ӿ rides the SAME tripwire:
   *  every ₭ burn mints exactly one Ӿ to the burner, so `Σ xMinted == burned` — a burn site that forgot to mint
   *  (or a mint with no burn) breaks this and HALTs the node (`applyLive` throws; the store poisons). */
  conserves(): boolean {
    let sum = 0n
    for (const b of this.balances.values()) sum += b
    let xs = 0n
    for (const x of this.xMinted.values()) xs += x
    let xb = 0n
    for (const v of this.xBalance.values()) xb += v
    // THE TK-FOLD extension of the Ӿ tripwire: lane-enter moves Ӿ between BOOKS (spendable → lane), never
    // mints or destroys — so the conserved quantity is the SUM of both books. A lane that inflated (or a
    // fold that leaked) breaks this and halts the node, the same law that guards the ₭ supply.
    const laneSum = laneTotal(this.laneState)
    // THE FIREBORN TRIPWIRE: every ₭ burned minted exactly F lifetime sends, so remaining tanks + consumed
    // sends must equal F × burned — a tank that inflated (or a feeless send that forgot to decrement) halts here.
    let ft = 0n
    for (const t of this.fireTank.values()) ft += t
    return sum === this.emitted - this.burned && xs === this.burned && xb + laneSum === this.burned && this.xTotal === this.burned
      && ft + this.fireSpent === this.burned * FIREBORN_SENDS_PER_KRAY
      && this.balanceOf(STAR_OFFER) === this.offers.lockedTotal()
      && this.cuts.conserves()
  }

  /** BOOKKEEPING CONSISTENCY (not the peg itself): emitted ≤ the pot's recorded donated total, and
   *  the pot's own books balance. HONEST LIMIT: pot.satsDonated increments by whatever a donate event
   *  CLAIMS, so this proves internal consistency (no ₭ minted beyond the recorded donations), NOT that
   *  a real satoshi was burned — that proof lives at the door today, not in this check. The true peg
   *  becomes replay-verifiable only when the donation's SPV proof is re-verified in the reducer (the
   *  named keystone; see docs/CONSENSUS-CONSTITUTION.md). Until then: call this "backed by the books,"
   *  never "backed by Bitcoin." */
  backed(): boolean { return this.emitted <= this.pot.satsDonated && this.pot.balances() }

  /** has this Bitcoin seal txid already reopened the mint window? (the window law is once-per-txid, ever) */
  hasSeal(txid: string): boolean { return this.sealedTxids.has(String(txid).toLowerCase()) }

  /** deterministic commitment over the consumed-seal set — folds into the cascade root so two histories
   *  that consumed different Bitcoin seals can never share a root. */
  private sealsRoot(): string {
    return sha256hex([...this.sealedTxids].sort().join('\n'))
  }

  /** the post-quantum recovery commitment registered for an address, or null (opt-in). */
  quantumCommitOf(address: string): string | null { return this.quantumCommits.get(address) ?? null }
  /** has this account been rescued through the quantum escape hatch already? */
  isMigrated(address: string): boolean { return this.migratedAccounts.has(address) }

  /** deterministic commitment over all quantum recovery registrations — address:commit pairs, sorted. */
  private quantumCommitsRoot(): string {
    return sha256hex([...this.quantumCommits.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([a, c]) => `${a}:${c}`).join('\n'))
  }

  /** the money-side commitment for the cascade root (the stars have their own root) */
  balanceRoot(): string {
    const parts: string[] = []
    for (const [a, b] of [...this.balances.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
      if (b !== 0n) parts.push(`${a}:${b}`)
    }
    parts.push(`|emitted:${this.emitted}|burned:${this.burned}`)
    return parts.join('\n')
  }

  /** THE Ӿ-BOOK COMMITMENT (slice 2) — a hash over the sorted non-zero Ӿ balances plus the conserved total. Folds
   *  into the cascade root ONLY at/after the transfer activation seq (A3: absent below it ⇒ byte-identical history),
   *  so a stranger re-derives every wallet's Ӿ from the anchored root once the network ratifies transfers. */
  private xRootFold(): string {
    const parts: string[] = []
    for (const [a, b] of [...this.xBalance.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
      if (b !== 0n) parts.push(`${a}:${b}`)
    }
    parts.push(`|xtotal:${this.xTotal}`)
    return sha256hex(parts.join('\n'))
  }

  /** THE FIREBORN COMMITMENT — a hash over the sorted non-zero tanks, each address's gap clock, and the lifetime
   *  feeless spend count. Folds into the cascade root ONLY at/after the feeless activation seq (A3: absent below
   *  ⇒ byte-identical history), so a stranger re-derives every wallet's remaining allowance from the anchored root. */
  private fireRootFold(): string {
    const parts: string[] = []
    for (const [a, t] of [...this.fireTank.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
      if (t !== 0n) parts.push(`${a}:${t}`)
    }
    parts.push('|gap')
    for (const [a, ts] of [...this.fireLastAt.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
      parts.push(`${a}:${ts}`)
    }
    parts.push(`|firespent:${this.fireSpent}`)
    return sha256hex(parts.join('\n'))
  }

  /** THE ANCHOR COMMITMENT — one 32-byte root over the WHOLE state (money AND stars),
   *  the value written to Bitcoin via OP_RETURN so anyone can re-derive it from the journal
   *  and compare. Any change to any balance, to the emitted/burned totals, or to any star
   *  flips this hash; a tampered journal cannot reproduce it. Pure function of the applied
   *  journal → byte-identical on every honest node, at every instant. This is the proof. */
  cascadeRoot(): string { return cascadeRootFromParts(this.cascadeParts()) }

  /**
   * ADR-3 cascade OPENING — the exact parts the cascade root is the sequential hash of (`cascadeRootFromParts`
   * IS the root law; this and it are the single source of truth, so no parallel formula can drift). A censorship
   * verifier re-hashes these parts to prove that ONE component — the seal-window root 3d's verdict rests on — is
   * part of an anchored root, since a sequential hash cannot be opened at one component without revealing all.
   * A conditional field is present ONLY when its subsystem folds today; below the inclusion activation seq the
   * inclusion/window fields are absent, so the pre-A history opens byte-identically — no anchored root is
   * orphaned (A3). The order these fold in lives entirely in `cascadeRootFromParts`.
   */
  cascadeParts(): CascadeParts {
    const active = this.lastAppliedSeq >= this.inclusionActivationSeq
    return {
      seq: this.lastAppliedSeq,
      emitted: String(this.emitted),
      burned: String(this.burned),
      moneyRoot: this.balanceRoot(),
      starsRoot: this.stars.merkleRoot(),
      potCommitment: this.pot.commitment(),   // the pot's deficit gates every future mint — anchored too
      runesCommitment: this.runes.commitment(),
      contractsRoot: this.contractRoot(),
      // each conditional subsystem folds ONLY once it exists (append-only, A3): seals gate every reopen, quantum
      // recovery + migrations join when first used, the AMM LP book when a pool exists.
      ...(this.sealedTxids.size > 0 ? { seals: { count: this.sealedTxids.size, root: this.sealsRoot() } } : {}),
      ...(this.quantumCommits.size > 0 ? { qcommits: { count: this.quantumCommits.size, root: this.quantumCommitsRoot() } } : {}),
      ...(this.migratedAccounts.size > 0 ? { qmigrated: [...this.migratedAccounts].sort() } : {}),
      ...(!this.amm.empty() ? { ammCommitment: this.amm.commitment() } : {}),
      // ADR-3 A + 3d-a + eligibility opening (Article XIV): the cumulative inclusion root, the per-seal window
      // root, AND the account nonce root fold in together, ONLY at/after the activation seq; below it all three
      // are absent so the pre-A format is byte-identical (A3). nonce: is appended LAST in cascadeRootFromParts.
      ...(active ? { inclusionRoot: this.inclusionRoot(), windowRoot: this.windowSealsRoot(), nonceRoot: this.nonceMap.root() } : {}),
      // Ӿ slice 2 — the transferable book folds in ONLY at/after ITS OWN activation seq (append-only, A3): below it
      // the field is absent, so the pre-Ӿ history (incl. today's signet) opens byte-identically. The mint (slice 1)
      // always rode the journal re-derivably; this is the commitment that lets a light client verify Ӿ from the root.
      ...(this.lastAppliedSeq >= this.xTransferActivationSeq ? { xRoot: this.xRootFold() } : {}),
      // THE FIREBORN LAW — the tank book folds in ONLY at/after ITS OWN activation seq (append-only, A3): below
      // it the field is absent, so every pre-fireborn anchored root opens byte-identically.
      ...(this.lastAppliedSeq >= this.xFeelessActivationSeq ? { fireRoot: this.fireRootFold() } : {}),
      // THE TK-FOLD (Gate 2) — the lane book folds in ONLY at/after ITS OWN activation seq (appended LAST,
      // A3): below it the field is absent, so every pre-fold anchored root opens byte-identically. The value
      // is the SAME laneRoot the fold proof binds — one commitment, two enforcers, zero drift.
      ...(this.lastAppliedSeq >= this.tkFoldActivationSeq ? { laneRoot: laneRoot(this.laneState) } : {}),
      // THE STAR MARKET — the listing book folds in ONLY once a listing exists (by presence, the AMM pattern;
      // appended LAST in cascadeRootFromParts, A3): with no listing the field is absent, so a pre-market
      // history — and an empty genesis — opens byte-identically. The market never holds value, so this
      // commits only WHO is offering WHICH star at WHAT price, re-derivable by any stranger from the journal.
      ...(!this.market.empty() ? { marketCommitment: this.market.commitment() } : {}),
      ...(!this.offers.empty() ? { offerCommitment: this.offers.commitment() } : {}),
      ...(!this.cuts.empty() ? { cutCommitment: this.cuts.commitment() } : {}),
    }
  }

  /** ADR-3 eligibility opening — the committed account→(nonce, first-anchor height) root a censorship verifier
   *  opens to read expected@deadline for a nonced act. Maintained from genesis, folded only post-activation. */
  nonceMapRoot(): string { return this.nonceMap.root() }
  /** the membership/non-membership proof of `address` against the current nonce root (the prover attaches it) */
  proveNonce(address: string) { return this.nonceMap.prove(address) }
  /** ADR-3 3a — the inclusion / non-inclusion (absence) proof of an act key against the current cumulative
   *  inclusion root (a censorship prover attaches it to show an act was omitted). */
  proveInclusion(keyHex: string) { return this.includedTree.prove(keyHex) }
  /** ADR-3 3d-a — the seal-window commitments folded so far, for a prover's windowMembership proof. */
  windowSealCommitments(): string[] { return [...this.windowSeals.values()] }

  /** ADR-3 3d-a — the SMT over every per-seal windowCommitment recorded so far (EMPTY_ROOT until the first seal
   *  after activation). Folds into the cascade; a verifier proves a specific windowCommitment(H, R) is a member. */
  windowSealsRoot(): string {
    return (this._windowSealsRootCache ??= buildInclusionRoot(this.windowSeals.values()))
  }

  /** ADR-3 3a — the cumulative Sparse-Merkle root over the SIGNED-message key of every act included so far.
   *  Order-independent (a set commitment), memoized until the set grows; EMPTY_ROOT when no signed act applied.
   *  It COMMITS the included set — it does NOT by itself make an omission evident (that is 3d).
   *  Maintained INCREMENTALLY (IncrementalInclusionTree): O(256) per act, its root O(1), byte-identical to a
   *  full rebuild — so a large post-activation history cannot grief the anchor (the Slice-A council item, closed).*/
  inclusionRoot(): string {
    return this.includedTree.root()
  }

  /** a deterministic commitment over every contract — address, code, and state — so the
   *  DeFi layer folds into the cascade root and anchors to Bitcoin. */
  private contractRoot(): string {
    const parts: string[] = []
    for (const addr of [...this.contracts.keys()].sort()) {
      const c = this.contracts.get(addr)!
      const st = Object.keys(c.state).sort().map((k) => `${k}=${c.state[k]}`).join(',')
      const faces = (c.roster && c.roster.some(Boolean)) ? `|faces=${c.roster.map((a) => a || '').join(',')}` : ''
      parts.push(`${addr}|${sha256hex(canonicalCode(c.code))}|${c.creator}|${st}${c.star ? `|star=${c.star}` : ''}${faces}`)
    }
    return parts.join('\n')
  }

  /** the rune L2 is solvent for every rune (reserve == credits + locks), or a node drifted */
  runesSolvent(): boolean { return this.runes.solvent() }

  /** LP book: every live pair has supply === Σ holders + MINIMUM_LIQUIDITY dead, or a node drifted */
  ammSolvent(): boolean { return this.amm.solvent() }
}
