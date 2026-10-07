/**
 * CUT BOOK (KRC-77 / KRC-7777) — the holder map the IR cannot store.
 *
 * The paper on the star seals supply (or infinite). This book is the objective
 * token state: who holds how many units of that star's Cut. Rebuilt from the
 * journal on every replay. Folds into the cascade BY PRESENCE (the market
 * pattern): empty ⇒ field absent ⇒ byte-identical history (A3).
 *
 * Product mouth: Luz ✧ (Portuguese luz — the living star's light). Compiler
 * kind stays `cut`. Catalog: KRC-77 (fungible) or KRC-7777 (serial — each
 * unit 1..N has one owner). Cadent and LuX are discarded names.
 *
 * Genesis: a capped Cut spends `supply` once. Empty founder table ⇒ the sealer
 * holds all of it. A sealed table credits those addresses; the remainder stays
 * with the sealer. Σ == supply or the book refuses. Infinite has no genesis
 * credit (nothing to send until a later mint door exists).
 * Send is its own signed kind (`cut-send`) — never a ₭ / Ӿ signature.
 * Serial send is a second kind (`cut-send-unit`) — never widen cut-send.v1.
 *
 * Vault boxes (KRAYVERSE) bind later: vault-0N → (star, unit) only after the
 * Creator seals the paper. This book never invents that inscription.
 */
import { sha256hex } from './kray-primitives.ts'

/** KRC-7777 pin, per network. All three are born at 0: below the pin every
 *  serial seal and every cut-send-unit is REFUSED, so no serial root grows
 *  and no era forks (A3). A journal with no serial act replays byte-identical. */
export const SERIAL_LUZ_SEQ: Record<string, number> = {
  regtest: 0,
  // Born with the law. Mainnet has never portioned Luz, so cut: was never in a
  // root. Signet's existing books are fungible KRC-77 — cut-send.v1 replays
  // unchanged. A serial act is the first time a unit line enters the cascade.
  signet: 0,
  main: 0,
}

/** KRC-7777 — max numbered copies on ONE star. The developer chooses 1..this.
 *  21_000 is the house ceiling: a 10_000-copy edition fits with room, and one
 *  star cannot write an unbounded owner-list into every future cascade root.
 *  Fungible KRC-77 stays at 10_000_000 (one number per holder, not one line per id).
 *  Raising this later is additive. Lowering it is not. */
export const MAX_SERIAL_CUT_SUPPLY = 21_000

export interface CutHolding {
  star: string
  amount: string
  supply: string
  serial?: boolean
  units?: string[]
}

export interface CutView {
  star: string
  name: 'Luz'
  supply: string
  capped: boolean
  circulating: string
  holders: Array<{ address: string; amount: string }>
  serial?: boolean
  units?: Array<{ unit: string; address: string }>
}

export class CutBook {
  /** star (decimal) → address → units (fungible books only) */
  private readonly bal = new Map<string, Map<string, bigint>>()
  /** star → sealed supply (capped only — fungible or serial) */
  private readonly supply = new Map<string, bigint>()
  /** star → unit id (1..N) → owner. Presence = this star is serial. */
  private readonly serialOwners = new Map<string, Map<bigint, string>>()

  empty(): boolean { return this.supply.size === 0 }

  has(star: string): boolean { return this.supply.has(String(star)) }

  isSerial(star: string): boolean { return this.serialOwners.has(String(star)) }

  of(star: string, addr: string): bigint {
    const k = String(star)
    const units = this.serialOwners.get(k)
    if (units) {
      let n = 0n
      for (const owner of units.values()) if (owner === addr) n++
      return n
    }
    return this.bal.get(k)?.get(addr) ?? 0n
  }

  supplyOf(star: string): bigint {
    return this.supply.get(String(star)) ?? 0n
  }

  ownerOfUnit(star: string, unit: bigint): string | null {
    return this.serialOwners.get(String(star))?.get(unit) ?? null
  }

  genesis(star: string, owner: string, supply: bigint): void {
    this.genesisAlloc(star, supply, [{ to: owner, amount: supply }])
  }

  /** Spend the whole sealed supply across named addresses. Σ must equal supply. */
  genesisAlloc(star: string, supply: bigint, credits: Array<{ to: string; amount: bigint }>): void {
    const k = String(star)
    if (this.supply.has(k)) throw new Error('cut-book: this star already has a Cut')
    if (supply <= 0n) throw new Error('cut-book: genesis supply must be greater than 0')
    if (!Array.isArray(credits) || credits.length === 0) throw new Error('cut-book: genesis needs at least one holder')
    const row = new Map<string, bigint>()
    let sum = 0n
    for (const c of credits) {
      const to = String(c.to || '')
      if (!to) throw new Error('cut-book: genesis needs an owner')
      if (c.amount <= 0n) throw new Error('cut-book: genesis amount must be greater than 0')
      row.set(to, (row.get(to) ?? 0n) + c.amount)
      sum += c.amount
    }
    if (sum !== supply) throw new Error('cut-book: genesis must spend the whole supply')
    this.supply.set(k, supply)
    this.bal.set(k, row)
  }

  /**
   * Serial genesis — same credits, but each unit 1..N has one owner.
   * Founder order is the paper's order; remainder (last credit) is the sealer.
   * Units are assigned sequentially: first credit takes 1..A, next A+1.., …
   */
  genesisSerial(star: string, supply: bigint, credits: Array<{ to: string; amount: bigint }>): void {
    const k = String(star)
    if (this.supply.has(k)) throw new Error('cut-book: this star already has a Cut')
    if (supply <= 0n) throw new Error('cut-book: genesis supply must be greater than 0')
    if (supply > BigInt(MAX_SERIAL_CUT_SUPPLY)) {
      throw new Error(`cut-book: serial Luz is at most ${MAX_SERIAL_CUT_SUPPLY} units`)
    }
    if (!Array.isArray(credits) || credits.length === 0) throw new Error('cut-book: genesis needs at least one holder')
    const units = new Map<bigint, string>()
    let next = 1n
    let sum = 0n
    for (const c of credits) {
      const to = String(c.to || '')
      if (!to) throw new Error('cut-book: genesis needs an owner')
      if (c.amount <= 0n) throw new Error('cut-book: genesis amount must be greater than 0')
      for (let i = 0n; i < c.amount; i++) {
        units.set(next, to)
        next++
      }
      sum += c.amount
    }
    if (sum !== supply || next - 1n !== supply) throw new Error('cut-book: genesis must spend the whole supply')
    this.supply.set(k, supply)
    this.serialOwners.set(k, units)
  }

  send(star: string, from: string, to: string, amount: bigint): void {
    const k = String(star)
    if (this.serialOwners.has(k)) throw new Error('cut-book: this Luz is serial — send one unit')
    if (!this.supply.has(k)) throw new Error('cut-book: no Cut on this star')
    if (amount <= 0n) throw new Error('cut-book: amount must be greater than 0')
    if (from === to) throw new Error('cut-book: send needs two different parties')
    const have = this.of(k, from)
    if (have < amount) throw new Error(`cut-book: insufficient Cut (have ${have}, need ${amount})`)
    const row = this.bal.get(k)!
    const nextFrom = have - amount
    if (nextFrom === 0n) row.delete(from)
    else row.set(from, nextFrom)
    row.set(to, (row.get(to) ?? 0n) + amount)
  }

  sendUnit(star: string, from: string, to: string, unit: bigint): void {
    const k = String(star)
    const units = this.serialOwners.get(k)
    if (!units) throw new Error('cut-book: this Luz is not serial')
    if (from === to) throw new Error('cut-book: send needs two different parties')
    const cap = this.supply.get(k) ?? 0n
    if (unit < 1n || unit > cap) throw new Error(`cut-book: unit ${unit} is not on this star`)
    const owner = units.get(unit)
    if (owner !== from) throw new Error(`cut-book: insufficient Cut (unit ${unit} is not yours)`)
    units.set(unit, to)
  }

  holdingsOf(addr: string): CutHolding[] {
    const out: CutHolding[] = []
    for (const [star, cap] of this.supply) {
      const n = this.of(star, addr)
      if (n <= 0n) continue
      const serial = this.serialOwners.has(star)
      const row: CutHolding = { star, amount: n.toString(), supply: cap.toString() }
      if (serial) {
        row.serial = true
        const units: string[] = []
        for (const [u, owner] of this.serialOwners.get(star)!) {
          if (owner === addr) units.push(u.toString())
        }
        units.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
        row.units = units
      }
      out.push(row)
    }
    return out.sort((a, b) => (BigInt(a.star) < BigInt(b.star) ? -1 : 1))
  }

  view(star: string): CutView | null {
    const k = String(star)
    const supply = this.supply.get(k)
    if (supply == null) return null
    const serial = this.serialOwners.has(k)
    const holdersMap = new Map<string, bigint>()
    if (serial) {
      for (const owner of this.serialOwners.get(k)!.values()) {
        holdersMap.set(owner, (holdersMap.get(owner) ?? 0n) + 1n)
      }
    } else {
      for (const [address, amount] of (this.bal.get(k) ?? new Map())) {
        if (amount > 0n) holdersMap.set(address, amount)
      }
    }
    const holders = [...holdersMap.entries()]
      .filter(([, n]) => n > 0n)
      .sort((a, b) => (b[1] === a[1] ? (a[0] < b[0] ? -1 : 1) : b[1] > a[1] ? 1 : -1))
      .map(([address, amount]) => ({ address, amount: amount.toString() }))
    let circulating = 0n
    for (const n of holdersMap.values()) circulating += n
    const out: CutView = {
      star: k,
      name: 'Luz',
      supply: supply.toString(),
      capped: true,
      circulating: circulating.toString(),
      holders,
    }
    if (serial) {
      out.serial = true
      out.units = [...this.serialOwners.get(k)!.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([unit, address]) => ({ unit: unit.toString(), address }))
    }
    return out
  }

  /** Every sealed (capped) book, star-order — the /rank/luz catalog. */
  catalog(): CutView[] {
    return [...this.supply.keys()]
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
      .map((k) => this.view(k))
      .filter((v): v is CutView => v != null)
  }

  /** Σ per star == sealed supply. Empty book is true. Serial: every id 1..N owned once. */
  conserves(): boolean {
    for (const [star, cap] of this.supply) {
      if (this.serialOwners.has(star)) {
        const units = this.serialOwners.get(star)!
        if (BigInt(units.size) !== cap) return false
        for (let i = 1n; i <= cap; i++) {
          if (!units.has(i) || !units.get(i)) return false
        }
        continue
      }
      let sum = 0n
      for (const n of (this.bal.get(star) ?? new Map()).values()) sum += n
      if (sum !== cap) return false
    }
    return true
  }

  /**
   * Sorted lines — omitted from the cascade when empty.
   * Fungible: `star|addr|amount` (byte-identical to pre-serial history).
   * Serial:   `star|u|unit|addr` (the `u` tag cannot collide with a fungible line).
   */
  commitment(): string {
    const lines: Array<{ n: bigint; line: string }> = []
    for (const [star, row] of this.bal) {
      const n = BigInt(star)
      for (const [addr, amount] of row) {
        if (amount > 0n) lines.push({ n, line: `${star}|${addr}|${amount}` })
      }
    }
    for (const [star, units] of this.serialOwners) {
      const n = BigInt(star)
      for (const [unit, addr] of units) {
        lines.push({ n, line: `${star}|u|${unit}|${addr}` })
      }
    }
    return lines
      .sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : a.line < b.line ? -1 : 1))
      .map((x) => x.line)
      .join('\n')
  }

  root(): string {
    return sha256hex(this.commitment())
  }
}
