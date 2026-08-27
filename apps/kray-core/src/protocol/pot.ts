/**
 * The Anchoring Pot — the engine that makes KRAY proof-of-donation, and makes the
 * network atemporal.
 *
 * No ₭ is ever premined. ₭ is BORN only when someone sacrifices real satoshis into this
 * pot, and the pot pays the network's Bitcoin anchoring for as long as it holds sats. The
 * pot is self-regulating — a closed loop that funds its own eternity:
 *
 *     deficit = max(0, target − held)              how much runway the pot still wants
 *     donate `sats`  →  mint  min(sats, deficit)  ₭ to the donor        (1 ₭ per satoshi)
 *     the WHOLE donation enters the pot            (excess past the deficit = extra
 *                                                   runway — never wasted, never lost)
 *     minting is OPEN only while deficit > 0
 *     anchoring SPENDS sats from the pot over time → deficit grows → minting REOPENS  ♻
 *
 * Why this exact shape — derived from the network's axioms (longevity, fairness, and
 * "never a mechanism that could harm the network or cost it credibility"):
 *
 *   · LONGEVITY / ATEMPORAL — the pot funds anchoring forever and refills itself: as it
 *       drains, the deficit reopens and pulls in fresh sats. Even at zero donations the
 *       network does not die — existing ₭ still circulates and anyone can self-anchor
 *       (the never-freeze law of Phase 4).
 *   · FAIR / GOOD DISTRIBUTION — strictly 1 satoshi ⇒ 1 ₭. Every ₭ in existence maps to
 *       exactly one real satoshi ever sacrificed. No premine, no privilege, no founder cut.
 *   · ANTI-WHALE — you can never mint more than the current deficit. A whale's excess sats
 *       still fund the pot (centuries of anchoring) but mint NOTHING extra: wealth buys the
 *       network's eternity, never ₭ dominance. The whale becomes a benefactor.
 *   · NEVER HARMS / NO CREDIBILITY ERROR — integer 1:1 (never rounds a donation to zero),
 *       nothing is ever wasted (excess = runway), and a full-pot donation is REFUSED at the
 *       door (never take sats that would mint nothing). Deterministic integer math → the
 *       same mint on every node, at every instant, re-derivable from the journal forever.
 *
 * THE PEG-OF-SACRIFICE INVARIANT: mintedTotal ≤ donatedTotal, always — the network can
 * never have minted more ₭ than satoshis were ever really sacrificed to it.
 */

/** THE CHAIR LAW (ratified by the Creator 2026-08-26, at the v1.0.0 genesis) — the pot target IS
 *  an identity, not a guess:
 *
 *      2,100 chairs × 10,000 ₭ per chair (MINT_CAP_SATS) = 21,000,000 sats = 0.21 BTC
 *
 *  One chair = one full-cap mint. The window law frees exactly one chair per confirmed Bitcoin
 *  seal, so after the genesis spring empties, Bitcoin's own heartbeat is the only mint pacer.
 *  The two Bitcoin numbers (21M, and 2100 — the year of the last satoshi) meet in one constant
 *  that explains itself. NOT a supply ceiling: ₭ has none — every unit forever costs a burned
 *  satoshi and a buried seal; this only sizes the standing reservoir. Consensus constant: every
 *  replayer derives the same target from this line, never from an env var (a writer-only target
 *  would fork the roots at the first deficit-edge donation). The math below is target-agnostic. */
export const DEFAULT_POT_TARGET_SATS = 21_000_000n // = 2,100 chairs × MINT_CAP_SATS (10,000) — proven below

/** THE PER-MINT CAP — one donation mints at most this many ₭ (1 ₭ per satoshi). The supply has NO ceiling (it
 *  grows only with real satoshis burned), so this is not a total cap — it caps a SINGLE mint, so becoming a whale
 *  costs many separate Bitcoin transactions (each a real fee, each its own network anchor). Timeless in ₭ terms
 *  (always 10,000 ₭ per mint) and self-strengthening in real terms (as Bitcoin appreciates, burning 10,000 sats is
 *  a larger sacrifice, so the bar rises on its own). A clean, hardcore round maximum — comfortably above a normal
 *  Bitcoin fee (so minting is never fee-dominated) yet small enough that a whale needs thousands of transactions.
 *  Enforced in the ledger's consensus reducer; a chain that minted more per donation is refused on replay. */
export const MINT_CAP_SATS = 10_000n

/** THE WINDOW LAW (Slice 2c) — one CONFIRMED Bitcoin seal reopens exactly one mint-cap of capacity.
 *  With no operator spend left to drain the pot, the mint window is metered by the network's own proven
 *  Bitcoin heartbeat: each seal buried on Bitcoin (a donation's self-anchor, a drawn guardian's anchor,
 *  or a last-resort operator OP_RETURN) consumes this much runway — reopening exactly this much mint
 *  capacity — ONCE per Bitcoin txid, ever. Deterministic, re-derivable, nobody's spend involved: the
 *  rate regulator is Bitcoin itself. Equal to the per-mint cap so one confirmed seal funds at most one
 *  full mint — a whale needs N real burns AND N real buried seals for N mints. */
export const WINDOW_PER_SEAL_SATS = MINT_CAP_SATS

// THE CHAIR IDENTITY, self-checked at load: the target IS exactly 2,100 full-cap chairs.
// If either constant ever drifts, this module refuses to exist rather than run a broken identity.
if (DEFAULT_POT_TARGET_SATS !== 2_100n * MINT_CAP_SATS) throw new Error('pot: the chair identity broke — the target must equal 2,100 × the mint cap')

export class AnchoringPot {
  private held = 0n           // sats currently in the pot (proven donations − anchor spends)
  private donatedTotal = 0n   // every satoshi ever donated (monotonic)
  private spentTotal = 0n     // every satoshi ever spent on anchoring (monotonic)
  private mintedTotal = 0n    // every ₭ ever minted against this pot (monotonic)
  readonly target: bigint

  constructor(target: bigint = DEFAULT_POT_TARGET_SATS) {
    if (target <= 0n) throw new Error('pot: target must be positive')
    this.target = target
  }

  get satsHeld(): bigint { return this.held }
  get satsDonated(): bigint { return this.donatedTotal }
  get satsSpent(): bigint { return this.spentTotal }
  get krayMinted(): bigint { return this.mintedTotal }

  /** how many sats the pot still wants before it is at target (0 ⇒ full, minting closed) */
  deficit(): bigint { const d = this.target - this.held; return d > 0n ? d : 0n }
  /** minting is open only while the pot still needs runway */
  isOpen(): boolean { return this.deficit() > 0n }

  /** Would this many donated sats mint (a PURE preview — no mutation)? 1 ₭ per satoshi,
   *  capped at the current deficit. Never negative, never above the deficit. */
  previewMint(sats: bigint): bigint {
    if (sats <= 0n) return 0n
    const d = this.deficit()
    return sats < d ? sats : d   // min(sats, deficit)
  }

  /** THE MINT — absorb a proven donation. The whole donation enters the pot (excess past
   *  the deficit becomes extra runway); returns the ₭ minted (1 per satoshi, capped at the
   *  deficit that existed BEFORE this donation). Refuses a donation the pot cannot honor,
   *  so no satoshi is ever taken for a zero mint. */
  absorb(sats: bigint): bigint {
    if (sats <= 0n) throw new Error('pot: a donation must be positive')
    if (!this.isOpen()) throw new Error('pot: full — donation refused (it would mint nothing; keep your sats)')
    const minted = this.previewMint(sats)   // = min(sats, deficit) > 0 because isOpen
    this.held += sats                        // the WHOLE donation funds the pot — excess = runway
    this.donatedTotal += sats
    this.mintedTotal += minted
    return minted
  }

  /** ANCHORING DRAINS THE POT — the network spends pot sats to pay a Bitcoin anchor fee.
   *  Lowers `held`, which raises the deficit and REOPENS minting. Cannot overspend. */
  spendOnAnchor(sats: bigint): void {
    if (sats <= 0n) throw new Error('pot: an anchor spend must be positive')
    if (sats > this.held) throw new Error(`pot: anchor spend exceeds the pot (have ${this.held}, need ${sats})`)
    this.held -= sats
    this.spentTotal += sats
  }

  /** held == donated − spent, and minted ≤ donated (the peg-of-sacrifice). The tripwire. */
  balances(): boolean { return this.held === this.donatedTotal - this.spentTotal && this.mintedTotal <= this.donatedTotal }

  /** the pot's slice of the cascade root — commits the whole pot to Bitcoin so its deficit
   *  (and therefore every future mint) is a pure, tamper-evident function of the journal */
  commitment(): string {
    return `pot|target:${this.target}|held:${this.held}|donated:${this.donatedTotal}|spent:${this.spentTotal}|minted:${this.mintedTotal}`
  }
}
