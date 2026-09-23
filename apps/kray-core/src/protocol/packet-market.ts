/**
 * THE PACKET MARKET — the same atomic, trustless order book, for the things that are NOT stars.
 *
 * The Creator, 2026-09-19: *"é só fazer o market também aceitar vender pacotes de tokens, como kray, luz,
 * runes L2, além das estrelas que já tem no market… todas as vezes que escolher listar alguma coisa por 0
 * valor seria o escrow ou drop."* So this is not a second market with a second law: it is the star market's
 * law applied to a PACKET — a whole, indivisible quantity of one fungible thing.
 *
 * A listing is a SIGNED commitment by the holder: "I offer `amount` of this lane at price P". It moves
 * nothing on its own — exactly like a star listing, the book NEVER holds value. A take applies BOTH legs in
 * ONE reducer step: the taker's ₭ pays the seller AND the packet moves to the taker, atomically, or the whole
 * act is refused. There is no moment where one side has parted with value and the other has not; the escrow
 * is the mathematics, not a third party (Szabo).
 *
 * WHY NO CUSTODY POT. A star can only be held whole, so a lien over it is exact. A balance can be spent while
 * a listing stands — so this book re-proves the holding AT THE MOMENT OF THE TAKE, and refuses (moving
 * nothing, not even a fee) when the packet is no longer there. That keeps the market outside Σ: no pot, no
 * new value-bearing address, no conservation surface, and the worst a bug here can do is fail a take. It also
 * keeps a BEQUEST honest — the giver goes on living off their own balance, and the heir takes what is
 * actually there when the height opens (docs/design: the testament).
 *
 * WHOLE PACKETS ONLY. A take is all or nothing: no partial fill, so there is no rounding, no residue and no
 * race between two takers over one listing. The first take consumes it, once; the second finds nothing.
 *
 * State: (lane, asset, seller) → { amount, price, terms }. Pure derived state, rebuilt from the journal on
 * every replay, and folded into the cascade root BY PRESENCE (the AMM/star-market pattern), so an empty
 * history — and every anchored root before this law — opens byte-identically (A3).
 */
import { createHash } from 'node:crypto'
import { canonicalRuneKey } from '../economics/rune-book.ts'
import { STAR_RE } from './kray-primitives.ts'
import { hasTerms, type ListingTerms } from './star-market.ts'

/**
 * THE LANES a packet can be cut from — the fungible books this ledger already moves, and nothing else.
 * · `kray` — ₭ itself, the spendable balance.
 * · `luz`  — ✧ of ONE star (the asset is that star's number; Luz lives per star, per holder).
 * · `rune` — one rune of the L2 (the asset is its canonical `block:tx` id; FENYX and every etched rune ride here).
 * Ӿ is deliberately absent: its transfers are still dormant and carry their own fee law (the Fireborn tank), so
 * it will enter the market as its own slice, never by widening this one quietly.
 */
/**
 * THE WIDTH OF A NUMBER IN THE BOOK. A listing's price is never compared to anything — you may offer at any
 * price — so without a bound one act could write a MILLION-digit price into a line that every cascade root
 * thereafter must re-hash. Measured on this reducer: one such listing, bought for the eternal 1 ₭, made an
 * ordinary transfer 34× slower for as long as it stood, and only its lister could sweep it. The bound is the
 * widest number any book here can actually hold — a rune amount is u128, 39 digits — so nothing honest is
 * refused and nothing hostile is cheap.
 */
export const MAX_BOOK_DIGITS = 40

export const PACKET_LANES = ['kray', 'luz', 'rune'] as const
export type PacketLane = (typeof PACKET_LANES)[number]

/** THE PACKET MARKET pin, per network — regtest is born with it; signet and main wait for their whole fleet
 *  to run this law. Below the pin every packet act is REFUSED, so no root grows and no era forks (A3). */
export const PACKET_MARKET_SEQ: Record<string, number> = {
  regtest: 0,
  signet: 231,                          // ratified 2026-09-21 with the gift and the escrow — all four together
  // RATIFIED 2026-09-22 — main tip 81, so 82: the house's own rite, the same one POT_BINDING_SEQ used on
  // this very network (81→82). Opened at the tip's next act so the activation is ONE explicit, auditable
  // instant. All five market pins take this seq TOGETHER — the gift, the packet market, the claim escrow,
  // the mint, and the ungrindable tiebreak that must never lag behind them. signet carried every one of
  // them end to end first (opened, taken by more than one hand, and CLOSED), measured by scripts/mainnet-gate.mjs.
  main: 82,
}

export interface PacketListing extends ListingTerms {
  readonly seller: string
  readonly lane: PacketLane
  /** The one thing inside the lane: a star number for `luz`, a canonical rune id for `rune`, empty for `kray`. */
  readonly asset: string
  readonly amount: bigint
  readonly price: bigint
}

/** True for a lane this market knows. A stranger's lane is not a lane. */
export function isPacketLane(lane: unknown): lane is PacketLane {
  return typeof lane === 'string' && (PACKET_LANES as readonly string[]).includes(lane)
}

/**
 * The asset a lane addresses, in ITS canonical form — or a refusal. This is the single gate that stops a
 * twin-fork key (`1:2` vs `01:2`, `07` vs `7`) from ever becoming two different listings for one thing.
 */
export function canonicalPacketAsset(lane: PacketLane, asset: string | undefined): string {
  // typeof FIRST: `RegExp.test` coerces a JSON number (7 → "7") and would accept it, and so would
  // `canonicalRuneKey`'s own guard. One spelling of an asset, and it is a string — the house's C1 law.
  if (asset !== undefined && typeof asset !== 'string') throw new Error('ledger: a packet asset must be a string, not a number')
  const raw = asset ?? ''
  switch (lane) {
    case 'kray':
      if (raw !== '') throw new Error('ledger: the ₭ lane names no asset — ₭ is the asset')
      return ''
    case 'luz':
      if (!STAR_RE.test(raw)) throw new Error('ledger: a Luz packet names the star it is cut from (a canonical star number)')
      return raw
    case 'rune': {
      // `01:1` and `1:1` are the same rune to the book, so a market that signed either spelling would let one
      // packet wear two different signed lines. One spelling, one line, one key: a padded id is refused HERE,
      // by name, before any signature is weighed — never normalised in silence.
      const canon = canonicalRuneKey(raw)
      if (canon !== raw) throw new Error(`ledger: a rune packet names its rune canonically — ${canon}, not ${raw}`)
      return canon
    }
    default: {
      const never: never = lane
      throw new Error(`ledger: unknown packet lane ${String(never)}`)
    }
  }
}

/**
 * The asset an act names, read from the fields the ledger ALREADY uses for that lane — `star` for Luz,
 * `runeId` for a rune, nothing for ₭. One reader, called by the reducer and by the signed-bytes mirror, so
 * the line that was signed is a function of the act alone and the referee can never find a divergence.
 */
export function packetAssetOfEvent(lane: PacketLane, e: { star?: string; runeId?: string }): string {
  // EXCLUSIVE: a lane carries its own asset field and no other. A field the law would not read is not
  // harmless cargo — it is a second spelling of one act, and a place for a relay to hide something. One
  // shape per lane, refused by name here, in the ONE reader both the law and the mirror call.
  const carried = (v: unknown) => v !== undefined && v !== null && String(v) !== ''
  const stray = lane === 'luz' ? carried(e.runeId) : lane === 'rune' ? carried(e.star) : (carried(e.star) || carried(e.runeId))
  if (stray) throw new Error(`ledger: a ${lane} packet carries no other asset field — drop it`)
  switch (lane) {
    case 'kray': return canonicalPacketAsset('kray', '')
    case 'luz': return canonicalPacketAsset('luz', e.star)
    case 'rune': return canonicalPacketAsset('rune', e.runeId)
    default: {
      const never: never = lane
      throw new Error(`ledger: unknown packet lane ${String(never)}`)
    }
  }
}

/** One live listing per (lane, asset, seller): re-listing edits that one offer instead of breeding twins. */
export function packetKey(lane: PacketLane, asset: string, seller: string): string {
  return `${lane}|${asset}|${seller}`
}

export class PacketMarket {
  private readonly listings = new Map<string, PacketListing>()
  /** The committed line, remembered — see StarMarket for why. Invalidated on every write. */
  private _commitment: string | null = null

  get size(): number { return this.listings.size }
  empty(): boolean { return this.listings.size === 0 }

  /** The live offer, or null — a copy, so no caller can edit the book by holding its row. */
  get(lane: PacketLane, asset: string, seller: string): PacketListing | null {
    const l = this.listings.get(packetKey(lane, asset, seller))
    if (!l) return null
    const out: PacketListing = { seller: l.seller, lane: l.lane, asset: l.asset, amount: l.amount, price: l.price }
    const w = out as { to?: string; gate?: bigint; notBefore?: number }
    if (l.to) w.to = l.to
    if (l.gate !== undefined) w.gate = l.gate
    if (l.notBefore !== undefined && l.notBefore > 0) w.notBefore = l.notBefore
    return out
  }

  /** Every live listing, in the commitment's own order (canonical, order-free) — for the marketplace page. */
  all(): Array<{ lane: string; asset: string; seller: string; amount: string; price: string; to?: string; gate?: string; notBefore?: number }> {
    return [...this.listings.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([, l]) => {
        const row: { lane: string; asset: string; seller: string; amount: string; price: string; to?: string; gate?: string; notBefore?: number } =
          { lane: l.lane, asset: l.asset, seller: l.seller, amount: l.amount.toString(), price: l.price.toString() }
        if (l.to) row.to = l.to
        if (l.gate !== undefined) row.gate = l.gate.toString()
        if (l.notBefore !== undefined && l.notBefore > 0) row.notBefore = l.notBefore
        return row
      })
  }

  /** List (or re-list = edit amount/price/terms): the reducer has ALREADY proven the holding and the signature. */
  list(lane: PacketLane, asset: string, seller: string, amount: bigint, price: bigint, terms?: ListingTerms): void {
    const entry: PacketListing = { seller, lane, asset, amount, price }
    const w = entry as { to?: string; gate?: bigint; notBefore?: number }
    if (terms?.to) w.to = terms.to
    if (terms?.gate !== undefined) w.gate = terms.gate
    if (terms?.notBefore !== undefined && terms.notBefore > 0) w.notBefore = terms.notBefore
    this._commitment = null
    this.listings.set(packetKey(lane, asset, seller), entry)
  }

  /** Withdraw an offer (delist, or consumed by a take). */
  remove(lane: PacketLane, asset: string, seller: string): void {
    this._commitment = null
    this.listings.delete(packetKey(lane, asset, seller))
  }

  /**
   * The book's committed value for the cascade root — sorted by key (canonical, order-free), each line
   * `lane|asset|seller|amount|price` with the terms appended only when present, in this fixed order. Empty
   * only when there are no listings, and then the caller omits the whole field, so a pre-packet history folds
   * byte-identically (A3).
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
        const line = `${key}|${l.amount}|${l.price}`
        return terms.length ? `${line}|${terms.join('|')}` : line
      })
      .join('\n')
    return this._commitment
  }
}

/** The line a lister signs. Every field is in it — including each term, empty when absent — so no relay can
 *  add, strip or rewrite a condition, and the bytes name the network they were meant for. */
export function packetListMessage(network: string, from: string, lane: PacketLane, asset: string, amount: bigint, price: bigint, terms: ListingTerms, nonce: number): string {
  const to = terms.to ?? '', gate = terms.gate !== undefined ? terms.gate.toString() : ''
  const notBefore = terms.notBefore !== undefined && terms.notBefore > 0 ? String(terms.notBefore) : '0'
  return `kray-core.packet-list.v1|net=${network}|from=${from}|lane=${lane}|asset=${asset}|amount=${amount}|price=${price}|to=${to}|gate=${gate}|notBefore=${notBefore}|nonce=${nonce}`
}

/** Withdrawing your own offer names exactly which one. */
export function packetDelistMessage(network: string, from: string, lane: PacketLane, asset: string, nonce: number): string {
  return `kray-core.packet-delist.v1|net=${network}|from=${from}|lane=${lane}|asset=${asset}|nonce=${nonce}`
}

/**
 * THE TERMS A TAKER SAYS THEY ANSWERED, as one hash. Amount and price were always in the take's signed line,
 * but the TERMS were not — so a seller could re-list the same amount at the same price with a different name
 * on it, and the taker's untouched signature would close a different offer than the one they read. The taker
 * now declares the terms they saw; the reducer refuses if the offer no longer carries exactly those.
 *
 * An offer with no terms hashes to the empty string, so a plain take carries no new field at all (A3 in
 * spirit: the simple shape stays simple).
 */
export function packetTermsHash(terms: ListingTerms | undefined): string {
  if (!hasTerms(terms)) return ''
  const t = terms!
  const line = `to=${t.to ?? ''}|gate=${t.gate !== undefined ? t.gate : ''}|notBefore=${t.notBefore !== undefined && t.notBefore > 0 ? t.notBefore : 0}`
  return createHash('sha256').update(line, 'utf8').digest('hex')
}

/** The taker signs the EXACT offer — seller, lane, asset, amount, price AND the terms it carried. A re-listed,
 *  re-priced or re-aimed packet therefore refutes a stale take: the bytes no longer describe anything that
 *  exists (Fano — never a phantom, and now never a phantom CONDITION either). */
export function packetTakeMessage(network: string, from: string, seller: string, lane: PacketLane, asset: string, amount: bigint, price: bigint, termsHash: string, nonce: number): string {
  return `kray-core.packet-take.v1|net=${network}|from=${from}|seller=${seller}|lane=${lane}|asset=${asset}|amount=${amount}|price=${price}|terms=${termsHash}|nonce=${nonce}`
}
