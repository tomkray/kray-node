/**
 * KRAY primitives — the model-agnostic core shared by the whole network.
 *
 * These are the protocol accounts, the event shape, the settlement row, the
 * inscription cap, and the canonical hashing that DEFINE the journal — none of
 * them depend on any particular emission or supply model. They were extracted
 * from the original ledger so the KRAYNET engine (ledger.ts, store.ts, node.ts,
 * starmap.ts) and the light-client modules (receipt.ts, block.ts) all speak one
 * event format, one canonicalization, one hash-chain — with no drift, ever.
 *
 * Depends only on node:crypto and the ContractCode type. BigInt only — no float
 * ever touches a KRAY.
 */
import { createHash } from 'node:crypto'
import type { ContractCode } from './contract.ts'

export const TREASURY = 'KRAY_TREASURY'
/**
 * THE BLACK HOLE — where a citizen sends what should never move again.
 *
 * FOR STARS ONLY (the ratified law): a star sent here is ENTOMBED — it keeps
 * existing, keeps being counted, and simply loses every possible way out; the
 * freezer earns ✦ glow. FUNGIBLE ₭ NEVER ENTOMBS — ₭ only BURNS (the signed
 * `burn` kind: destroyed from supply, Ӿ born 1:1 to the burner). From
 * BURN_LAW_SEQ the reducer refuses fungible ₭ aimed at this label on every
 * user-reachable path; the historical ₭ frozen here before the law is
 * transmuted into a true burn by the one-shot `burn-thaw` (see ledger.ts).
 *
 * WHY NOTHING CAN EVER LEAVE. This is not an address: no BIP-340 public key
 * encodes to `KRAY_BLACK_HOLE`, so there is no signature any machine could ever
 * produce that verifies as its owner — the same reason the emission vault and the
 * treasury cannot be spent by anyone. Key non-existence is already sufficient,
 * but the reducer ALSO refuses outright to move value out of it, so the guarantee
 * does not rest on a cryptographic argument a reader has to reconstruct. Two
 * independent reasons, both checkable by anyone replaying the journal.
 *
 * A star sent here keeps its inscription, its name and its whole family tree. It
 * is not erased; it is placed beyond reach. The atlas still shows it, forever,
 * which is exactly what makes the act meaningful.
 */
export const BLACK_HOLE = 'KRAY_BLACK_HOLE'
// THE ETERNAL FEE — exactly one ₭, never more. The ledger enforces `fee === MIN_FEE` (not a
// floor): a fee that is not signed must not be inflatable, or a front-runner could re-submit
// your signed act with a fee that drains your whole balance to the Treasury. A fixed constant
// cannot be adulterated — the strongest form of "the fee is proven".
export const MIN_FEE = 1n

// ADR-1/ADR-4 · the burial depth a donation's SPV proof must show for the reducer to re-verify it on replay.
// A CONSENSUS value (not env) so every node agrees deterministically; the door may demand MORE, never less.
//
// ADR-4 slice 4c — PER-NETWORK, the definitive-burn depth. The mint credits ₭ only from a burn buried to
// Bitcoin's own customary settlement depth, so un-burying an already-credited mint costs out-working N real
// blocks — Satoshi's documented 51%-style reorg, not a weakness KRAY invents. The journaled SPV proof is a
// FROZEN snapshot, so it stays safe BY CONSTRUCTION at depth N and replay stays a pure function of the journal
// (never a live-chain read — that would let two honest followers diverge). N mirrors ANCHOR_CONF /
// SEAL_CONFIRMATIONS: the SAME atemporal Bitcoin-settlement ruler the rest of KRAY already trusts, not a magic
// number. It is IMMUTABLE-UPWARD once a network holds a committed proof-mint (a later change is an era fork).
export const DONATION_PROOF_MIN_CONF: Record<string, number> = { main: 6, signet: 2, testnet: 2, regtest: 1 }
// Fail-CLOSED: an unknown network demands the DEEPEST burial (main), never the shallowest — a liar gets the
// hardest bar, mirroring spv.ts's own unknown-net → hardest-work fallback. Every path reads N through here.
export function donationProofMinConf(net: string): number {
  return DONATION_PROOF_MIN_CONF[net] ?? DONATION_PROOF_MIN_CONF.main
}

// 'donate'/'anchor' are the proof-of-donation mint events (KRAYNET): a donation of
// proven sats mints ₭ against the anchoring pot's deficit; an anchor spends pot sats
// to fund a Bitcoin anchor. Every kind the reducer handles lives in this union.
export type KrayEventKind = 'genesis' | 'emit' | 'transfer' | 'transfer-star' | 'reward' | 'inscribe' | 'name' | 'origin' | 'settle' | 'settlement' | 'guardian' | 'bridge' | 'rune-deposit' | 'rune-send' | 'rune-exit' | 'rune-cancel' | 'rune-lodge' | 'rune-rehome' | 'rune-settle' | 'amm-add' | 'amm-remove' | 'amm-swap' | 'amm-rr-add' | 'amm-rr-remove' | 'amm-rr-swap' | 'contract' | 'contract-call' | 'donate' | 'anchor' | 'seal' | 'quantum-commit' | 'quantum-migrate' | 'x-send' | 'burn' | 'burn-thaw' | 'lane-enter' | 'lane-exit' | 'fold-seal' | 'star-list' | 'star-delist' | 'star-buy'

/** A star's user-given name: 1..64 bytes UTF-8, byte-exact unique, forever. */
export const NAME_MAX_BYTES = 64
/** Canonical star number: digits with no leading zeros (or a lone "0"). */
export const STAR_RE = /^(0|[1-9]\d*)$/

export interface KrayEvent {
  seq: number
  prevHash: string
  hash: string
  kind: KrayEventKind
  at: number
  from?: string
  to?: string
  amount?: string // KRAY, decimal string — BigInt-safe
  fee?: string
  nonce?: number
  /** ADR-3 Slice C — the SIGNED inclusion deadline: the Bitcoin block height by which this act must be
   *  included, part of the signed bytes (appended as `|deadline=D` at the requireSig choke point). Optional
   *  pre-activation (absent → the signed message is byte-identical to pre-C); REQUIRED for signing kinds
   *  after the Article XIV activation height. The clock for 3d's censorship verdict; C does not judge. */
  deadline?: number
  /** ADR-3 Slice 3d-a — the BITCOIN block height at which a `seal` is buried. Journaled so the reducer can
   *  bind windowCommitment(height, inclusionRoot) into the cascade root; re-proven by the follower via SPV
   *  exactly as the seal's txid is (a lied height is caught downstream). Required on a seal once the inclusion
   *  regime is active; absent before (A3 byte-identical). The Bitcoin clock 3d compares a deadline against. */
  l1Height?: number
  interval?: number // emit: the Bitcoin-block interval this subsidy belongs to
  memo?: string
  /** genesis only: the REAL Bitcoin block this network was born at. */
  btcHeight?: number
  // inscribe: tattoo content onto one specific star (KRAY unit) — forever
  star?: string // the star number, decimal string — BigInt-safe
  contentHash?: string // sha256 of the inscribed content
  contentType?: string
  size?: number // content size in bytes (protocol-capped)
  parent?: string // provenance: the parent star (family tree / constellation), optional
  // MULTIPARENT provenance (message v3) — additive, optional: an event without them hashes
  // and behaves exactly as before (retro-safe, byte-identical — the ADR-1 discipline).
  // Order is SIGNED (part of the v3 message); the reducer never re-sorts.
  parents?: string[] // KRAY parent star numbers (decimal strings), every one owned by `from`
  origins?: string[] // Bitcoin L1 ordinal parent ids (<txid>iN) — signed; ownership is the SPV bag
  /**
   * L1 ordinal parent CONTROL — SPV sat-walk (`proveParentControl`), aligned 1:1
   * with `origins` (or origin.v2 `l1InscriptionId`). Genesis law: an origins list
   * without this bag never applies. The bag rides the event like a donation
   * proof — cascade-committed when present; never a star merkle field.
   */
  originProofs?: Array<{
    holderTxid: string
    holderVout: number
    holderOffset: string
    bundle: Array<{ rawTx: string; txoutproof: string; headers: string[] }>
  }>
  /**
   * L1 origin cohort (message v6) — one blessing fathers N children when the
   * opening act commits `originCohort` (content hashes) whose SHA-256 is
   * `originCohortRoot`. Siblings carry only the root. Absent = frozen one-child
   * Casey (A3).
   */
  originCohort?: string[]
  originCohortRoot?: string
  /** Derived per child: sha256(domain|net|l1|holder|vout|offset|contentHash). */
  originBind?: string
  // INSCRIPTION METADATA (message v4) — any JSON the writer chooses, signed with the relic.
  // Absent on every pre-v4 event (A3). Describes; never executes.
  meta?: string
  // BODY HASH (message v5) — sha256 of the work's skeleton (MPEG frames / JPEG
  // without EXIF / PNG without ancillary). Absent on every pre-v5 event (A3).
  // The relic bytes on disk are never rewritten; this is a second commitment.
  bodyHash?: string
  name?: string // name: the star's user-given baptism (1..64 bytes, unique forever)
  // settlement: the WHOLE interval's payout in ONE record — a packed table
  // [address, emitted, rewarded] per validator. See SettlementRow.
  payouts?: SettlementRow[]
  /** seal settlements only: the fast-block span [fromBlock, toBlock] the seal closed. */
  span?: [number, number]
  // guardian: the SEALED opt-in — the identity allowed to sign work claims
  publicKey?: string
  signature?: string
  scheme?: string
  // bridge: a citizen binds its Bitcoin L1 rune to its KRAY identity
  rune?: string
  runeId?: string
  vault?: string
  // the rune L2: deposits credited against a PROVEN Bitcoin deposit, transfers, two-phase exit.
  outpoint?: string // txid:vout of the proven L1 deposit — credited once, ever
  /** rune-deposit only: the coins landed straight in the SHARED consolidation pot (not a
   *  personal vault), so the credit is pot-backed from birth. Additive and optional — an
   *  event without it hashes and behaves exactly as before (the ADR-1 discipline). */
  pool?: boolean
  // ADR-1 (proof-of-burn in consensus) — a donate/rune-deposit/rune-settle event may carry the L1
  // SPV PROOF itself (raw tx + BIP-37 merkle block + header chain), not just the result. Because the
  // cascade root hashes this canonical body, the proof is committed into the anchored root; because
  // the verifiers (spv.verifyDonationProof, rune-bridge.verifyRune*Proof) are pure/offline, the
  // reducer re-verifies it on every replay. OPTIONAL and append-only: an event without it hashes and
  // behaves exactly as before (retro-safe, byte-identical). Rune events extend the bag with the
  // vault params the credit binds to and the ord-attested input rune amounts (the named residue —
  // the allocation math is re-derived; the input state awaits the embedded-ancestry slice).
  proof?: {
    rawTx: string; txoutproof: string; headers: string[]
    vault?: { guardians: string[]; threshold: number; depositor: string; timelock: number }
    inputRunes?: Array<{ id: string; amount: string }>
    /** pot deposit: parent txs of the deposit vins, bound by hash so replay
     *  re-derives the unique Taproot spender. Absent on a personal-vault proof. */
    parentTxs?: string[]
    /** pot deposit: credit binds to the unique spender, not the vault depositor. */
    pool?: boolean
  }
  // ADR-1 extended (self-anchoring burn in consensus) — a donate that paid a SELF-ANCHOR output
  // (the pot's internal key tweaked by KrayAnchor.payload(anchorBlock, anchorRoot), BIP-341
  // pay-to-contract; NUMS internal key = a true keyless burn) names the seal it rode, so the
  // reducer RE-DERIVES the expected script from these two fields + the configured pot internal
  // key and re-proves the SPV proof against the derived script — never against a client claim.
  // Additive and optional (A3): an event without them hashes and behaves exactly as before, and
  // verification is opt-in per node config exactly like `proof` vs `potScriptHex` above.
  anchorBlock?: number  // the KRAY block number the donation's self-anchor output sealed
  anchorRoot?: string   // the sealed cascade root (32-byte hex)
  l1Txid?: string // the proven L1 payout a settlement burns against
  l1Address?: string // where an exit is to be paid on Bitcoin (signed, so unredirectable)
  // THE TK-FOLD (Gate 2) — a `fold-seal` lands one PROVEN breath of the compressed lane on the journal.
  // All additive and optional (A3: an event without them hashes exactly as before). The pre/post lane
  // roots and the diffs hash are public inputs of the fold proof AND part of the folder's signed message,
  // so the proof, the signature and these bytes can only tell one story. The diffs are the ONLY per-breath
  // state bytes (the Creator's re-sync law: a stranger rebuilds every lane balance from them alone).
  foldPre?: string        // lane root BEFORE the breath (must chain to the ledger's current lane root)
  foldPost?: string       // lane root AFTER the breath (re-derived from the diffs, or refused)
  foldDiffsHash?: string  // sha256 of the canonical diffs — a proof can never be reused over altered diffs
  foldDiffs?: { balances: Array<[string, string]>; nonces: Array<[string, number]> }
  foldProof?: string      // the constant-size Groth16 proof (hex) — verified on apply AND on replay
  foldPublic?: string     // the committed public values (hex, bincode-of-JSON) the proof is verified against
  // quantum-commit: SHA-256 of a future post-quantum public key — a HASH (Grover-only, quantum-safe today),
  // registered under the current signature, so an account can migrate to that PQC key without ever relying on
  // its exposed ECC key. See docs/QUANTUM-READINESS.md.
  quantumCommit?: string
  // quantum-migrate: the escape hatch — a Lamport (hash-based, quantum-safe) public key + signature that
  // authorizes moving a compromised account's value, matching the pre-registered quantum-commit. Works even
  // after a quantum computer breaks the account's ECC key, because it relies on the Lamport key alone.
  lamportPublicKey?: string // 32768-hex (256×2×32 bytes)
  lamportSignature?: string // 16384-hex (256×32 bytes)
  proofHash?: string // sha256 of the proof bundle, so an auditor can demand the bytes
  // origin: bind a Bitcoin L1 Ordinals inscription to a star
  l1InscriptionId?: string // origin: the L1 PARENT ordinal id <reveal_txid>i<index>
  satOffset?: string // origin: the sat offset in the holder outpoint (decimal, BigInt-safe)
  // contracts: the sealed code, and the calls that drive it.
  code?: ContractCode
  /** mint paper only — http(s) art URL the desk pulls at the birth. Not in the IR. */
  shelf?: string
  contract?: string // the contract's derived address
  rule?: string
  callArgs?: Record<string, string> // decimal strings — BigInt-safe
  /** contract-call v2: the signed clock (unix ms) the IR reads as ctx.at.
   *  Absent on every v1 call — those keep the frozen message and ctx.at = e.at (A3). */
  clock?: number
  /** AMM V2 — atomic base units (divisibility never enters the reducer). */
  krayIn?: string
  runeIn?: string
  minLp?: string
  lp?: string
  minKrayOut?: string
  minRuneOut?: string
  minOut?: string
  /** amm-swap: which reserve the signed amountIn spends. */
  side?: 'kray' | 'rune'
  /** amm-rr-*: the other rune. Events store the ordered pair (runeId < otherRuneId). */
  otherRuneId?: string
  otherIn?: string
  minOtherOut?: string
  /** amm-rr-swap: which of the two runes the signed amountIn spends. */
  payRuneId?: string
  /** seal settlements with custody rows: the REAL Bitcoin block hash the seal rode. */
  beacon?: string
  /** beat-proven settlements: the beats each validator submitted for the span, so any node re-derives the
   *  exact payout from the beacon + these beats (settleFromBeats) and refutes a table that does not follow.
   *  `custody` is the OPTIONAL atlas-possession proof (hits bitmap + aggregate, custodyToHex). When this
   *  event carries `presenceTip`, the reducer re-verifies the aggregate (verifyCustody) or HALTs — bits
   *  alone are not a proof. Historical events without presenceTip keep the bitmap count (A3). */
  claims?: Array<{ address: string; beats: Array<{ block: number; nonce: string; zeros: number }>; custody?: string }>
  /**
   * Windowed presence (additive, A3): the live KRAY height this seal settled.
   * Present ⇒ at most one distinct block per address, inside
   * [presenceTip − 128, presenceTip]; custody must verify; paid zeros cap at 24.
   * Absent ⇒ historical span (still capped at 1024 distinct blocks per address).
   */
  presenceTip?: number
}

/**
 * ONE VALIDATOR'S LINE IN A SETTLEMENT.
 *
 *   [address, emit, reward]                                        — legacy
 *   [address, emit, reward, work, presenceHex]                     — proves the TABLE
 *   [address, emit, reward, work, presenceHex, claimUpTo, claimSig] — proves the PERSON
 *
 * The first three are what was PAID. The rest are what the payment was FOR: the
 * weight declared, one bit per fast block, and the guardian's own BIP-340
 * statement that the work and presence are theirs. What nobody signed, the law
 * never pays. BOTH shapes replay — a journal written before this stays valid.
 */
export type SettlementRow =
  | [string, string, string]
  | [string, string, string, string, string]
  | [string, string, string, string, string, string, string]
  /** …+ custodyHex: the master guardian's PROOF it holds the atlas (33 bytes:
   *  hit bitmap + one aggregate). The work column then carries the EFFECTIVE
   *  work — base × (K + 2·hits) — and the reducer re-derives the base, checks
   *  the signature over it, and (holding the bytes) re-proves the custody. */
  | [string, string, string, string, string, string, string, string]

/** THE STAR CEILING — genesis era 21 MB (frozen for replay). After the size-proportion
 *  activation a new work is capped at MAX_INSCRIPTION_PROPORTION (10 MB). The 21 was an
 *  homage to Bitcoin's 21 million, not a derivation. Enforced at the door AND in the reducer. */
export const MAX_INSCRIPTION_BYTES = 21_000_000
/** THE PROPORTION CEILING (2026-08-25) — 10 MB. One seal still fits its largest star. */
export const MAX_INSCRIPTION_PROPORTION = 10_000_000

/** THE SIZE-BURN LAW — linear, floor 1 ₭, Cauchy-neutral:
 *    burn(size) = max(1, ceil(size / bytesPerKray))
 *  Genesis rate BYTES_PER_KRAY_BURN (1 ₭ / MB) is FROZEN so every already-journaled
 *  Signet star replays at the fire it actually paid (A3). After size-proportion
 *  activation the era snaps to BYTES_PER_KRAY_PROPORTION (1 ₭ / 10_000 bytes — the
 *  10 / 3-6-9 lock). Names and empty stars stay 1 ₭. The atlas toll, when active,
 *  uses the SAME function at the SAME live rate. */
export const BYTES_PER_KRAY_BURN = 1_000_000
export const BYTES_PER_KRAY_PROPORTION = 10_000
export function starBurnOf(size: number | undefined, bytesPerKray: number = BYTES_PER_KRAY_BURN): bigint {
  const s = Number(size ?? 0)
  if (!Number.isFinite(s) || s <= 0) return 1n
  if (!Number.isFinite(bytesPerKray) || bytesPerKray <= 0) return 1n
  return BigInt(Math.max(1, Math.ceil(s / bytesPerKray)))
}

/** Where the live law (1 ₭ / 10_000 bytes, 10 MB) begins.
 *  main: 0 — NOT a signaling. The journal is empty of stars; the law simply IS
 *  these numbers from the first act, as if they had always been the rule.
 *  signet: 274 — the ONLY activation (57 stars already paid 1 ₭/MB + 21 MB).
 *  Re-read the tip at deploy and bump if it has crossed. Below the pin, replay
 *  is byte-identical at the frozen genesis rate (A3).
 *  regtest: MAX — lab goldens keep the genesis rate; swarms inject pin 0. */
export const SIZE_PROPORTION_ACTIVATION_SEQ: Record<string, number> = {
  regtest: Number.MAX_SAFE_INTEGER,
  signet: 274,
  main: 0,
}

/** THE SPACE TRINITY (2026-08-13, the Creator's word — "abracadabra") — three laws that keep
 *  the network's internet inside the world's disks FOREVER, each a Bitcoin homage that works:
 *
 *  1 · THE STAR CEILING — 21 MB per star (the 21 million coins): the largest single work.
 *  2 · THE SEAL BUDGET — the HARD consensus bound is 21 MB of NEW content per seal (SEAL_CONTENT_BUDGET,
 *      == the star ceiling, because a block must fit its largest transaction — Bitcoin's own rule). The
 *      1 MB figure is NOT this bound; it is the retarget's economic TARGET (law 3 below), the average the
 *      price steers toward. Honest ceiling arithmetic: one seal ≤ 21 MB; a seal fires per CONFIRMED
 *      Bitcoin anchor txid, and several distinct anchors can confirm in one Bitcoin block, so per-block
 *      content is bounded ECONOMICALLY (a real anchor fee per seal) — not by physics — and the retarget
 *      prices sustained demand up ×2/window. The average habit rests near 1 MB/seal (~52.5 GB/year), an
 *      economic bound that falls against the world's disks every year. An act that would overflow the
 *      open seal's 21 MB budget is refused whole (retry after the next seal), like a full mempool.
 *  3 · THE SPACE RETARGET — every 1008 seals (2016/2: half a Bitcoin difficulty epoch, one week), the price of a byte
 *      re-derives from measured demand, exactly like Bitcoin's difficulty:
 *        bytesPerKray' = clamp(bytesPerKray × target/actual, ÷2 … ×2, band)
 *      Pure integer arithmetic over the journal itself — every replica derives the identical
 *      rate at the identical seq, no oracle, no vote. Flooding doubles the price against the
 *      flooder every window (×2^k — self-extinguishing); a quiet era loosens it toward the
 *      band floor, so the network stays affordable whatever a satoshi costs in dollars.
 *      The 1-₭-per-act floor and the LINEAR shape (the Cauchy/split-neutrality theorem)
 *      never change — only the rate breathes. */
export const SEAL_CONTENT_BUDGET = 21_000_000   // genesis-era per-seal bound (frozen). After proportion: MAX_INSCRIPTION_PROPORTION
export const TARGET_BYTES_PER_SEAL = 1_000_000  // the retarget AIMS here: 1 MB/seal average (Satoshi's block), enforced economically
// 1008, by tribunal (2026-08-13, four blind lenses): Bitcoin validated a SLEW RATE, not a raw
// number — one doubling per week (×4 per 2016 blocks). Our clamp is ×2, so the identical proven
// prudence is ×2 per 1008 seals. And 1008 = 2016/2 = 21×48 = 144×7: half a difficulty epoch,
// the 21 family, seven exact days of seals (1 seal ≈ 1 Bitcoin block ≈ 10 min — the recorded
// axiom this calibration rides on). A one-week boxcar NULLS both human demand cycles (diurnal
// 144, weekly 1008) that a 35-hour window aliased into phantom price wobble. The original 210
// borrowed from the WRONG donor: 210,000 is the EMISSION constant (halving); a control loop's
// validated donor is the 2016-block difficulty retarget.
export const RETARGET_WINDOW_SEALS = 1008
export const BYTES_PER_KRAY_MIN = 100_000        // genesis-era tightest: 10 ₭/MB — frozen for historical retarget
export const BYTES_PER_KRAY_MIN_PROPORTION = 1_000 // proportion-era tightest: ×10 from 10_000 (same siege ratio)
export const BYTES_PER_KRAY_MAX = 100_000_000    // loosest: 1 ₭ per 100 MB — the quiet-era price
export function retargetBytesPerKray(current: number, windowBytes: number, min = BYTES_PER_KRAY_MIN, max = BYTES_PER_KRAY_MAX): number {
  // target demand for a full window = 1 MB per seal ON AVERAGE, exactly Bitcoin's shape.
  // After proportion the HARD bound is 10 MB/seal; the economic target stays 1 MB/seal.
  const target = TARGET_BYTES_PER_SEAL * RETARGET_WINDOW_SEALS
  const bandMin = Number.isFinite(min) && min > 0 ? min : BYTES_PER_KRAY_MIN
  const bandMax = Number.isFinite(max) && max > 0 ? max : BYTES_PER_KRAY_MAX
  const raw = Math.floor((current * target) / Math.max(1, windowBytes))
  const clamped = Math.min(current * 2, Math.max(Math.floor(current / 2), raw))
  return Math.min(bandMax, Math.max(bandMin, clamped))
}

// the persistence shell (store.ts) computes the IDENTICAL hash-chain from these —
// one journal format, one canonicalization, no drift between reducer and disk.
export const GENESIS_HASH = 'kray-ledger-genesis'
export const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/** Canonical JSON: sorted keys, undefined dropped — hash never depends on order. */
export function canonical(o: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))))
}
