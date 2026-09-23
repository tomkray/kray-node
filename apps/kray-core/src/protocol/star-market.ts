/**
 * THE STAR MARKET — a native, atomic, trustless order book for stars, proven in the reducer.
 *
 * A listing is a SIGNED commitment by the current owner: "star N is for sale at price P". It moves nothing
 * on its own — the star stays with the owner. A BUY applies BOTH legs in ONE reducer step: the buyer's ₭
 * pays the seller and the star moves to the buyer, atomically, or the whole act is refused. There is no
 * moment where one party has parted with value and the other has not — the escrow is the mathematics, not a
 * third party (Szabo: remove the trusted intermediary).
 *
 * State: star number → { seller, price }. Pure derived state, re-built from the journal on every replay,
 * exactly like balances and the AMM LP book. It folds into the cascade root BY PRESENCE (only once a listing
 * exists — the AMM pattern), so an empty history opens byte-identically (A3) and no genesis root moves.
 *
 * The market never holds a balance and never mints or burns — every buy is value-conserving (buyer −(price+
 * fee), seller +price, TREASURY +fee). The worst a bug here could do is fail a buy; it can never touch Σ.
 */

/**
 * THE TERMS OF AN OFFER — who may take it, and when. All three are optional and all three are SIGNED, so no relay
 * can add, strip or change one. Absent terms leave the v1 listing byte for byte (A3).
 *
 * · `to`         — only this address may take it. A gift left for somebody, or a private sale at a price.
 * · `gate`       — only whoever HOLDS that star may take it: the right travels with the star, not with a name
 *                  (the Creator, 2026-09-19). An L1 ordinal becomes a star through `origin`, so it gates too.
 * · `notBefore`  — not until Bitcoin reaches this height. The clock is the chain's own, proven and non-decreasing
 *                  in the ledger's seals — never a wall clock. This is what makes a bequest a bequest: the giver
 *                  may withdraw or push the height forward while they live; the heir may take it only after.
 */
import { STAR_RE } from './kray-primitives.ts'

export interface ListingTerms { to?: string; gate?: bigint; notBefore?: number }

/**
 * THE GIFT LISTING pin, per network — the era in which a listing may cost 0 and may carry terms. Below it the
 * old law stands: the price must be positive, and an offer that CARRIES a term is refused rather than applied
 * without it (the shape did not exist in that era).
 *
 * THE ONE THING TO CHECK BEFORE DEPLOYING THIS CODE ANYWHERE. `gateStar` and `notBefore` are new field names
 * that no earlier act could hold, but `to` is a field the event always had. A historical `star-list` that
 * happened to carry a `to` was ACCEPTED by the old law (which ignored it) and is REFUSED by this one — so such
 * a line would stop an upgraded node from replaying its own journal, at boot, before any pin is ever flipped.
 * This writer never emitted one (the public door's `star-list` carried only {star, price}), and every journal
 * reachable when this shipped was verified clean. Verify it again, on the writer itself, before you deploy:
 *
 *     grep '"kind":"star-list"' <journal> | grep -cE '"(to|gateStar|notBefore)":'      # must print 0
 *
 * The table lives here so the reducer and the signed-bytes mirror read the SAME number — though note that the
 * pin decides only ADMISSION: the signed line is a function of the act alone, never of a pin.
 */
export const GIFT_LISTING_SEQ: Record<string, number> = {
  regtest: 0,
  // RATIFIED 2026-09-21 — signet tip 230, so 231: the house's own rite (POT_BINDING_SEQ took 226→227 and
  // 81→82 three days earlier). Opening at the tip's next act makes the activation one explicit, auditable
  // instant, and the whole fleet already runs this code, so no house can meet an act it cannot read.
  signet: 231,
  // RATIFIED 2026-09-22 — main tip 81, so 82: the house's own rite, the same one POT_BINDING_SEQ used on
  // this very network (81→82). Opened at the tip's next act so the activation is ONE explicit, auditable
  // instant. All five market pins take this seq TOGETHER — the gift, the packet market, the claim escrow,
  // the mint, and the ungrindable tiebreak that must never lag behind them. signet carried every one of
  // them end to end first (opened, taken by more than one hand, and CLOSED), measured by scripts/mainnet-gate.mjs.
  main: 82,
}
/**
 * The terms an act CARRIES — read from its own fields and nothing else, never from an activation pin. The signed
 * line must be a function of the act alone: the door, the reducer and the signed-bytes mirror all build it from
 * here, so they can never disagree about which bytes were signed (the referee refuses any divergence). Whether an
 * act carrying terms may be APPLIED is the pin's question, and the reducer asks it separately.
 */
export function termsOfEvent(e: { to?: string; gateStar?: string; notBefore?: number }): ListingTerms {
  const terms: ListingTerms = {}
  if (typeof e.to === 'string' && e.to !== '') terms.to = e.to
  // A TERM IS READ ONLY WHEN IT IS WELL FORMED — otherwise it is ABSENT, exactly as the old law treated a
  // field it did not know. This is not leniency: it is what closes the relay's last door. The signed line
  // renders an ill-formed height and an absent height the SAME WAY (`notBefore=0`), so if the reducer
  // branched on the raw field, a relay could append `notBefore: -1` to somebody's honest, correctly signed
  // act and kill it without touching a byte of the signature. Read here, once, and a malformed addition is
  // inert; a well-formed one changes the line and the signature fails. Both doors shut.
  // (A wallet's own typo is caught LOUDLY at the public door, which refuses to build an act that does not
  //  match what the citizen asked for — a bequest must never fall through as a public drop.)
  if (e.gateStar !== undefined && e.gateStar !== null && STAR_RE.test(String(e.gateStar))) terms.gate = BigInt(String(e.gateStar))
  if (isBitcoinHeight(e.notBefore)) terms.notBefore = Number(e.notBefore)
  return terms
}

/** A height Bitcoin can actually reach: a positive integer at or below the last block it will ever have. */
export function isBitcoinHeight(h: unknown): boolean {
  const n = typeof h === 'number' ? h : NaN
  return Number.isInteger(n) && n > 0 && n <= 21_000_000
}
export interface StarListing extends ListingTerms { seller: string; price: bigint }

/** True when an offer carries any term at all (an unconditional offer keeps the v1 message and the v1 line). */
export function hasTerms(t: ListingTerms | undefined): boolean {
  // Star #0 is a real star, so an absent gate is the ABSENT FIELD — never the number zero.
  return !!t && (!!t.to || t.gate !== undefined || (t.notBefore !== undefined && t.notBefore > 0))
}

/**
 * A listing WITH terms signs them all into one line — empty for an absent term, so the message is canonical and a
 * relay can neither add nor remove a condition. An offer with no terms keeps `starListMessage` (v1) byte for byte.
 */
export function starListV2Message(network: string, from: string, star: bigint, price: bigint, terms: ListingTerms, nonce: number): string {
  const to = terms.to ?? '', gate = terms.gate !== undefined ? terms.gate.toString() : ''
  const notBefore = terms.notBefore !== undefined && terms.notBefore > 0 ? String(terms.notBefore) : '0'
  return `kray-core.star-list.v2|net=${network}|from=${from}|star=${star}|price=${price}|to=${to}|gate=${gate}|notBefore=${notBefore}|nonce=${nonce}`
}

export class StarMarket {
  private readonly listings = new Map<string, StarListing>()   // star (decimal string) → { seller, price }
  /** THE COMMITTED LINE, REMEMBERED. `cascadeRoot()` runs after EVERY accepted act, and it rebuilt this
   *  whole string each time — so one big listing taxed every future event on the chain. The book knows when
   *  it changed; nothing else can change it. Invalidated on every write, never stale, never consensus. */
  private _commitment: string | null = null

  get size(): number { return this.listings.size }
  empty(): boolean { return this.listings.size === 0 }

  /** The live offer for a star, or null. */
  get(star: bigint): StarListing | null {
    const l = this.listings.get(star.toString())
    if (!l) return null
    const out: StarListing = { seller: l.seller, price: l.price }
    if (l.to) out.to = l.to
    if (l.gate !== undefined) out.gate = l.gate
    if (l.notBefore !== undefined && l.notBefore > 0) out.notBefore = l.notBefore
    return out
  }

  /** Every live listing (read-only, for the marketplace page) — sorted by star number, canonical + order-free. */
  all(): Array<{ star: string; seller: string; price: string; to?: string; gate?: string; notBefore?: number }> {
    return [...this.listings.entries()]
      .map(([star, l]) => ({ star, l, n: BigInt(star) }))
      .sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0))
      .map(({ star, l }) => {
        const row: { star: string; seller: string; price: string; to?: string; gate?: string; notBefore?: number } = { star, seller: l.seller, price: l.price.toString() }
        if (l.to) row.to = l.to
        if (l.gate !== undefined) row.gate = l.gate.toString()
        if (l.notBefore !== undefined && l.notBefore > 0) row.notBefore = l.notBefore
        return row
      })
  }

  /** List (or re-list = edit price): the caller has ALREADY been proven the current owner by the reducer. */
  list(star: bigint, seller: string, price: bigint, terms?: ListingTerms): void {
    const entry: StarListing = { seller, price }
    if (terms?.to) entry.to = terms.to
    if (terms?.gate !== undefined) entry.gate = terms.gate
    if (terms?.notBefore !== undefined && terms.notBefore > 0) entry.notBefore = terms.notBefore
    this._commitment = null
    this.listings.set(star.toString(), entry)
  }

  /** Withdraw an offer (delist, or consumed by a buy / cleared when the star moves by any path). */
  remove(star: bigint): void {
    this._commitment = null
    this.listings.delete(star.toString())
  }

  /**
   * The market's committed value for the cascade root — sorted by star number (canonical, order-free), each
   * line `star|seller|price`. Empty string only when there are no listings (and then the caller omits the
   * whole field, so the root is byte-identical to a pre-market history).
   */
  commitment(): string {
    if (this._commitment !== null) return this._commitment
    this._commitment = [...this.listings.entries()]
      // An offer with terms writes them after its price, each only when present, in this fixed order; an offer
      // without terms is the v1 line, byte for byte, so a pre-terms history folds identically (A3).
      .map(([star, l]) => {
        const terms = [l.to ? `to=${l.to}` : '', l.gate !== undefined ? `gate=${l.gate}` : '', l.notBefore !== undefined && l.notBefore > 0 ? `notBefore=${l.notBefore}` : ''].filter(Boolean)
        return { n: BigInt(star), line: terms.length ? `${star}|${l.seller}|${l.price}|${terms.join('|')}` : `${star}|${l.seller}|${l.price}` }
      })
      .sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0))
      .map((x) => x.line)
      .join('\n')
    return this._commitment
  }
}
