/**
 * SERIAL PACKET MARKET — the packet market's law, applied to ONE KRC-7777 unit id.
 *
 * packet-list.v1 stays a FUNGIBLE packet (an amount). Widening it with `unit` would let one signed
 * line mean two things, and every historical packet would have to agree about a field it never
 * carried. So this is a sibling book and a sibling domain: list / delist / take name `star` + `unit`.
 *
 * The same four walls the packet market already holds:
 *   · a listing is a SIGNED commitment — it moves nothing and holds no value
 *   · a take applies BOTH legs in ONE reducer step (₭ pays the seller AND that unit id moves), or refuses
 *   · the holder is re-proven AT THE MOMENT OF THE TAKE (and again if they send the unit away first)
 *   · one listing per (star, unit) — the first take consumes it; a second finds nothing
 *
 * Folded into the cascade BY PRESENCE (A3): empty ⇒ field absent ⇒ every pre-serial-market root
 * opens byte-identically.
 */
import { STAR_RE } from './kray-primitives.ts'
import { hasTerms, type ListingTerms } from './star-market.ts'
import { packetTermsHash } from './packet-market.ts'

export interface SerialPacketListing extends ListingTerms {
  readonly seller: string
  readonly star: string
  readonly unit: bigint
  readonly price: bigint
}

/** One live offer per unit id on one star. A unit has one owner; twins cannot exist. */
export function serialPacketKey(star: string, unit: bigint): string {
  return `${star}|${unit}`
}

/**
 * The star and unit an act names — the ONE reader the reducer and the signed-bytes mirror share.
 * A number, a padded spelling, or a missing field is refused here, never normalised in silence.
 */
export function serialUnitOfEvent(e: { star?: string; unit?: string }): { star: string; unit: bigint } {
  if (typeof e.star !== 'string' || !STAR_RE.test(e.star)) {
    throw new Error('ledger: a serial packet names the star it is cut from (a canonical star number)')
  }
  if (typeof e.unit !== 'string' || !STAR_RE.test(e.unit) || e.unit === '0') {
    throw new Error('ledger: a serial packet names a unit id greater than 0')
  }
  return { star: e.star, unit: BigInt(e.unit) }
}

export class SerialPacketMarket {
  private readonly listings = new Map<string, SerialPacketListing>()
  private _commitment: string | null = null

  get size(): number { return this.listings.size }
  empty(): boolean { return this.listings.size === 0 }

  get(star: string, unit: bigint): SerialPacketListing | null {
    const l = this.listings.get(serialPacketKey(star, unit))
    if (!l) return null
    const out: SerialPacketListing = { seller: l.seller, star: l.star, unit: l.unit, price: l.price }
    const w = out as { to?: string; gate?: bigint; notBefore?: number }
    if (l.to) w.to = l.to
    if (l.gate !== undefined) w.gate = l.gate
    if (l.notBefore !== undefined && l.notBefore > 0) w.notBefore = l.notBefore
    return out
  }

  /** Every live unit offer, in the commitment's own order — for the marketplace page. */
  all(): Array<{ star: string; unit: string; seller: string; price: string; to?: string; gate?: string; notBefore?: number }> {
    return [...this.listings.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([, l]) => {
        const row: { star: string; unit: string; seller: string; price: string; to?: string; gate?: string; notBefore?: number } =
          { star: l.star, unit: l.unit.toString(), seller: l.seller, price: l.price.toString() }
        if (l.to) row.to = l.to
        if (l.gate !== undefined) row.gate = l.gate.toString()
        if (l.notBefore !== undefined && l.notBefore > 0) row.notBefore = l.notBefore
        return row
      })
  }

  /** List (or re-list = edit price/terms). The reducer has ALREADY proven owner and signature. */
  list(star: string, unit: bigint, seller: string, price: bigint, terms?: ListingTerms): void {
    const entry: SerialPacketListing = { seller, star, unit, price }
    const w = entry as { to?: string; gate?: bigint; notBefore?: number }
    if (terms?.to) w.to = terms.to
    if (terms?.gate !== undefined) w.gate = terms.gate
    if (terms?.notBefore !== undefined && terms.notBefore > 0) w.notBefore = terms.notBefore
    this._commitment = null
    this.listings.set(serialPacketKey(star, unit), entry)
  }

  /** Withdraw an offer (delist, consumed by a take, or the unit left the seller). */
  remove(star: string, unit: bigint): void {
    const key = serialPacketKey(star, unit)
    if (!this.listings.has(key)) return
    this._commitment = null
    this.listings.delete(key)
  }

  /**
   * Sorted `star|unit|seller|price` plus terms only when present. Empty only when there are no
   * listings — then the caller omits the whole cascade field (A3).
   */
  commitment(): string {
    if (this._commitment !== null) return this._commitment
    this._commitment = [...this.listings.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([key, l]) => {
        const terms = [
          l.to ? `to=${l.to}` : '',
          l.gate !== undefined ? `gate=${l.gate}` : '',
          l.notBefore !== undefined && l.notBefore > 0 ? `notBefore=${l.notBefore}` : '',
        ].filter(Boolean)
        const line = `${key}|${l.seller}|${l.price}`
        return terms.length ? `${line}|${terms.join('|')}` : line
      })
      .join('\n')
    return this._commitment
  }
}

export function serialPacketListMessage(network: string, from: string, star: string, unit: bigint, price: bigint, terms: ListingTerms, nonce: number): string {
  const to = terms.to ?? '', gate = terms.gate !== undefined ? terms.gate.toString() : ''
  const notBefore = terms.notBefore !== undefined && terms.notBefore > 0 ? String(terms.notBefore) : '0'
  return `kray-core.packet-list-unit.v1|net=${network}|from=${from}|star=${star}|unit=${unit}|price=${price}|to=${to}|gate=${gate}|notBefore=${notBefore}|nonce=${nonce}`
}

export function serialPacketDelistMessage(network: string, from: string, star: string, unit: bigint, nonce: number): string {
  return `kray-core.packet-delist-unit.v1|net=${network}|from=${from}|star=${star}|unit=${unit}|nonce=${nonce}`
}

/** Same terms hash the packet take already uses — one function, two books, zero drift. */
export function serialPacketTermsHash(terms: ListingTerms | undefined): string {
  return packetTermsHash(terms)
}

export function serialPacketTakeMessage(network: string, from: string, seller: string, star: string, unit: bigint, price: bigint, termsHash: string, nonce: number): string {
  return `kray-core.packet-take-unit.v1|net=${network}|from=${from}|seller=${seller}|star=${star}|unit=${unit}|price=${price}|terms=${termsHash}|nonce=${nonce}`
}

export { hasTerms }
