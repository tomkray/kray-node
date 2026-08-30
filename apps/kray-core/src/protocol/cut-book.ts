/**
 * CUT BOOK (KRC-77) — the holder map the IR cannot store.
 *
 * The paper on the star seals supply (or infinite). This book is the objective
 * token state: who holds how many units of that star's Cut. Rebuilt from the
 * journal on every replay. Folds into the cascade BY PRESENCE (the market
 * pattern): empty ⇒ field absent ⇒ byte-identical history (A3).
 *
 * Product mouth: Luz ✧ (Portuguese luz — the living star's light). Compiler
 * kind stays `cut`. Catalog: KRC-77. Cadent and LuX are discarded names.
 *
 * Genesis: a capped Cut credits the sealer with `supply`. Infinite has no
 * genesis credit (nothing to send until a later mint door exists).
 * Send is its own signed kind (`cut-send`) — never a ₭ / Ӿ signature.
 */
import { sha256hex } from './kray-primitives.ts'

export interface CutHolding {
  star: string
  amount: string
  supply: string
}

export interface CutView {
  star: string
  name: 'Luz'
  supply: string
  capped: boolean
  circulating: string
  holders: Array<{ address: string; amount: string }>
}

export class CutBook {
  /** star (decimal) → address → units */
  private readonly bal = new Map<string, Map<string, bigint>>()
  /** star → sealed supply (capped only) */
  private readonly supply = new Map<string, bigint>()

  empty(): boolean { return this.supply.size === 0 }

  has(star: string): boolean { return this.supply.has(String(star)) }

  of(star: string, addr: string): bigint {
    return this.bal.get(String(star))?.get(addr) ?? 0n
  }

  supplyOf(star: string): bigint {
    return this.supply.get(String(star)) ?? 0n
  }

  genesis(star: string, owner: string, supply: bigint): void {
    const k = String(star)
    if (this.supply.has(k)) throw new Error('cut-book: this star already has a Cut')
    if (supply <= 0n) throw new Error('cut-book: genesis supply must be greater than 0')
    if (!owner) throw new Error('cut-book: genesis needs an owner')
    this.supply.set(k, supply)
    this.bal.set(k, new Map([[owner, supply]]))
  }

  send(star: string, from: string, to: string, amount: bigint): void {
    const k = String(star)
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

  holdingsOf(addr: string): CutHolding[] {
    const out: CutHolding[] = []
    for (const [star, row] of this.bal) {
      const n = row.get(addr) ?? 0n
      if (n > 0n) out.push({ star, amount: n.toString(), supply: (this.supply.get(star) ?? 0n).toString() })
    }
    return out.sort((a, b) => (BigInt(a.star) < BigInt(b.star) ? -1 : 1))
  }

  view(star: string): CutView | null {
    const k = String(star)
    const supply = this.supply.get(k)
    if (supply == null) return null
    const row = this.bal.get(k) ?? new Map()
    const holders = [...row.entries()]
      .filter(([, n]) => n > 0n)
      .sort((a, b) => (b[1] === a[1] ? (a[0] < b[0] ? -1 : 1) : b[1] > a[1] ? 1 : -1))
      .map(([address, amount]) => ({ address, amount: amount.toString() }))
    let circulating = 0n
    for (const n of row.values()) circulating += n
    return {
      star: k,
      name: 'Luz',
      supply: supply.toString(),
      capped: true,
      circulating: circulating.toString(),
      holders,
    }
  }

  /** Every sealed (capped) book, star-order — the /rank/luz catalog. */
  catalog(): CutView[] {
    return [...this.supply.keys()]
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
      .map((k) => this.view(k))
      .filter((v): v is CutView => v != null)
  }

  /** Σ per star == sealed supply. Empty book is true. */
  conserves(): boolean {
    for (const [star, cap] of this.supply) {
      let sum = 0n
      for (const n of (this.bal.get(star) ?? new Map()).values()) sum += n
      if (sum !== cap) return false
    }
    return true
  }

  /** Sorted lines `star|addr|amount` — omitted from the cascade when empty. */
  commitment(): string {
    const lines: Array<{ n: bigint; line: string }> = []
    for (const [star, row] of this.bal) {
      const n = BigInt(star)
      for (const [addr, amount] of row) {
        if (amount > 0n) lines.push({ n, line: `${star}|${addr}|${amount}` })
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
