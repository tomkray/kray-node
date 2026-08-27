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

export interface StarListing { seller: string; price: bigint }

export class StarMarket {
  private readonly listings = new Map<string, StarListing>()   // star (decimal string) → { seller, price }

  get size(): number { return this.listings.size }
  empty(): boolean { return this.listings.size === 0 }

  /** The live offer for a star, or null. */
  get(star: bigint): StarListing | null {
    const l = this.listings.get(star.toString())
    return l ? { seller: l.seller, price: l.price } : null
  }

  /** Every live listing (read-only, for the marketplace page) — sorted by star number, canonical + order-free. */
  all(): Array<{ star: string; seller: string; price: string }> {
    return [...this.listings.entries()]
      .map(([star, l]) => ({ star, seller: l.seller, price: l.price.toString(), n: BigInt(star) }))
      .sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0))
      .map(({ star, seller, price }) => ({ star, seller, price }))
  }

  /** List (or re-list = edit price): the caller has ALREADY been proven the current owner by the reducer. */
  list(star: bigint, seller: string, price: bigint): void {
    this.listings.set(star.toString(), { seller, price })
  }

  /** Withdraw an offer (delist, or consumed by a buy / cleared when the star moves by any path). */
  remove(star: bigint): void {
    this.listings.delete(star.toString())
  }

  /**
   * The market's committed value for the cascade root — sorted by star number (canonical, order-free), each
   * line `star|seller|price`. Empty string only when there are no listings (and then the caller omits the
   * whole field, so the root is byte-identical to a pre-market history).
   */
  commitment(): string {
    return [...this.listings.entries()]
      .map(([star, l]) => ({ n: BigInt(star), line: `${star}|${l.seller}|${l.price}` }))
      .sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0))
      .map((x) => x.line)
      .join('\n')
  }
}
