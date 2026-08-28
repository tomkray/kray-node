/**
 * STAR OFFERS — escrowed bids. The pot is a keyless label; the reducer is the vault.
 *
 * A live offer moves `price` ₭ from the bidder into KRAY_STAR_OFFER. That ₭ is not
 * spendable. Cancel returns it to the bidder. Accept pays the owner and moves the
 * star in ONE step. One live offer per (star, bidder). Folds by presence (A3).
 */
import { STAR_OFFER } from './kray-primitives.ts'
export { STAR_OFFER }

export function isStarOfferPot(addr: string): boolean {
  return addr === STAR_OFFER
}

export interface StarOffer { star: string; bidder: string; price: bigint }

function keyOf(star: bigint | string, bidder: string): string {
  return `${String(star)}|${bidder}`
}

export class StarOffers {
  private readonly offers = new Map<string, StarOffer>()

  empty(): boolean { return this.offers.size === 0 }
  get size(): number { return this.offers.size }

  get(star: bigint, bidder: string): StarOffer | null {
    const o = this.offers.get(keyOf(star, bidder))
    return o ? { star: o.star, bidder: o.bidder, price: o.price } : null
  }

  onStar(star: bigint): StarOffer[] {
    const k = String(star)
    return [...this.offers.values()]
      .filter((o) => o.star === k)
      .sort((a, b) => (b.price < a.price ? -1 : b.price > a.price ? 1 : (a.bidder < b.bidder ? -1 : 1)))
  }

  all(): Array<{ star: string; bidder: string; price: string }> {
    return [...this.offers.values()]
      .map((o) => ({ star: o.star, bidder: o.bidder, price: o.price.toString(), n: BigInt(o.star) }))
      .sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : (a.bidder < b.bidder ? -1 : 1)))
      .map(({ star, bidder, price }) => ({ star, bidder, price }))
  }

  put(star: bigint, bidder: string, price: bigint): void {
    this.offers.set(keyOf(star, bidder), { star: String(star), bidder, price })
  }

  remove(star: bigint, bidder: string): void {
    this.offers.delete(keyOf(star, bidder))
  }

  lockedTotal(): bigint {
    let n = 0n
    for (const o of this.offers.values()) n += o.price
    return n
  }

  commitment(): string {
    return [...this.offers.values()]
      .map((o) => ({ n: BigInt(o.star), line: `${o.star}|${o.bidder}|${o.price}` }))
      .sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : (a.line < b.line ? -1 : 1)))
      .map((x) => x.line)
      .join('\n')
  }
}
