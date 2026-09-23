/**
 * THE STANDING POOL — a whole supply committed once, and attested season after season.
 *
 * The Creator, 2026-09-20: *"seria o mesmo mecanismo da safra, só que ao invés de eu escolher um valor,
 * parte do que tenho, eu colocaria o valor todo do supply… e aquele escrow fica rodando como um script de
 * mint, pagando, e até mesmo recebimento de volta."*
 *
 * WHY A SEASON ALONE COULD NOT DO IT. A harvest pays only the names in its own root, and the root is frozen
 * when it is signed — which is exactly what stops a giver editing the list afterwards. The other face of that
 * guarantee is that escrowing a whole supply against one epoch's list FREEZES the remainder: nobody outside
 * that list can take it, not even its owner, until the closing height. Worse, a merkle root hides its own
 * sum, so the chain cannot know that a pot holding two billion is only ever going to pay five thousand — the
 * view would say "owed: 2,000,000,000" and mean nothing by it.
 *
 * SO THE POOL SPLITS ONE NUMBER INTO THREE, all of them true:
 *   · HELD      — what the owner has actually committed into the keyless pot, visible to everyone;
 *   · COMMITTED — what the open seasons can still pay out of it (never more than held);
 *   · FREE      — held − committed: real, but no season can reach it yet.
 *
 * A season drawn on a pool is the SAME harvest as before: one signed root, one leaf per hand, taken once.
 * What changes is only where its money comes from and where its leftovers go — out of the pool, and back to
 * the pool, so an epoch that nobody claimed refills the mint instead of leaving the chain.
 */
import type { PacketLane } from './packet-market.ts'

/** One pool per (lane, asset, owner). No counter, no id to mint: the key IS the promise's address. */
export function poolKey(lane: PacketLane, asset: string, owner: string): string {
  return `${lane}|${asset}|${owner}`
}

export interface Pool {
  readonly owner: string
  readonly lane: PacketLane
  readonly asset: string
  /** What sits in the keyless pot for this pool. Only a fund raises it; only a take or a close lowers it. */
  readonly held: bigint
  /** What the live seasons of this pool can still pay. Never above `held` — that is the whole point. */
  readonly committed: bigint
  /** The Bitcoin height at or after which the owner may draw back what no season has reached. */
  readonly expires: number
}

export class PoolBook {
  private readonly pools = new Map<string, Pool>()
  private _commitment: string | null = null

  get size(): number { return this.pools.size }
  empty(): boolean { return this.pools.size === 0 }

  get(lane: PacketLane, asset: string, owner: string): Pool | null {
    const p = this.pools.get(poolKey(lane, asset, owner))
    return p ? { ...p } : null
  }
  /** held − committed: real value in the pot that no open season can reach. */
  free(lane: PacketLane, asset: string, owner: string): bigint {
    const p = this.pools.get(poolKey(lane, asset, owner))
    return p ? p.held - p.committed : 0n
  }
  /** What the keyless pot must hold for ALL pools of one lane and asset — the tripwire's other half. */
  heldIn(lane: PacketLane, asset: string): bigint {
    let sum = 0n
    for (const p of this.pools.values()) if (p.lane === lane && p.asset === asset) sum += p.held
    return sum
  }
  /** Every lane and asset any pool touches, so a tripwire can walk them all. */
  assets(): Array<{ lane: PacketLane; asset: string }> {
    const seen = new Map<string, { lane: PacketLane; asset: string }>()
    for (const p of this.pools.values()) seen.set(`${p.lane}|${p.asset}`, { lane: p.lane, asset: p.asset })
    return [...seen.values()]
  }

  /** Every pool, for a reader — canonical order, and the three true numbers. */
  all(): Array<{ lane: string; asset: string; owner: string; held: string; committed: string; free: string; expires: number }> {
    return [...this.pools.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([, p]) => ({
        lane: p.lane, asset: p.asset, owner: p.owner,
        held: p.held.toString(), committed: p.committed.toString(), free: (p.held - p.committed).toString(),
        expires: p.expires,
      }))
  }

  /** Pour value in. Creates the pool on the first pour; a later pour may only push the horizon FORWARD,
   *  never pull it closer — a promise's end date is not something its maker may quietly shorten. */
  fund(lane: PacketLane, asset: string, owner: string, amount: bigint, expires: number): void {
    this._commitment = null
    const key = poolKey(lane, asset, owner)
    const p = this.pools.get(key)
    this.pools.set(key, p
      ? { ...p, held: p.held + amount, expires: Math.max(p.expires, expires) }
      : { owner, lane, asset, held: amount, committed: 0n, expires })
  }
  /** A new season draws a ceiling from the free part. The reducer has ALREADY proven it fits. */
  commit(lane: PacketLane, asset: string, owner: string, amount: bigint): void {
    const key = poolKey(lane, asset, owner)
    const p = this.pools.get(key)
    if (!p) throw new Error('pool-book: no such pool')
    if (p.committed + amount > p.held) throw new Error('pool-book: a pool cannot commit more than it holds')
    this._commitment = null
    this.pools.set(key, { ...p, committed: p.committed + amount })
  }
  /** A hand took its share: the value leaves the pot AND stops being committed, in one step. */
  paidOut(lane: PacketLane, asset: string, owner: string, amount: bigint): void {
    const key = poolKey(lane, asset, owner)
    const p = this.pools.get(key)
    if (!p) throw new Error('pool-book: no such pool')
    if (amount > p.committed || amount > p.held) throw new Error('pool-book: a pool cannot pay what it has not committed')
    this._commitment = null
    const next = { ...p, held: p.held - amount, committed: p.committed - amount }
    // A pool that has paid out everything it ever held is finished. Leaving an empty row behind would fold
    // a promise of nothing into every cascade root from here to the end of the chain.
    if (next.held === 0n && next.committed === 0n) this.pools.delete(key)
    else this.pools.set(key, next)
  }
  /** A season closed with leaves unclaimed: the value stays in the pot and becomes free again. */
  uncommit(lane: PacketLane, asset: string, owner: string, amount: bigint): void {
    const key = poolKey(lane, asset, owner)
    const p = this.pools.get(key)
    if (!p) throw new Error('pool-book: no such pool')
    if (amount > p.committed) throw new Error('pool-book: a pool cannot release what it never committed')
    this._commitment = null
    this.pools.set(key, { ...p, committed: p.committed - amount })
  }
  /** The owner draws back the free part at their horizon. The pool goes away once nothing is left in it. */
  drain(lane: PacketLane, asset: string, owner: string, amount: bigint): void {
    const key = poolKey(lane, asset, owner)
    const p = this.pools.get(key)
    if (!p) throw new Error('pool-book: no such pool')
    if (amount > p.held - p.committed) throw new Error('pool-book: a pool cannot return what a season still needs')
    this._commitment = null
    const next = { ...p, held: p.held - amount }
    if (next.held === 0n && next.committed === 0n) this.pools.delete(key)
    else this.pools.set(key, next)
  }

  /** The committed value for the cascade root — sorted, and every number that matters on the line.
   *  Remembered until a write, because `cascadeRoot()` runs after every accepted act. */
  commitment(): string {
    if (this._commitment !== null) return this._commitment
    this._commitment = [...this.pools.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([key, p]) => `${key}|${p.held}|${p.committed}|${p.expires}`)
      .join('\n')
    return this._commitment
  }
}

/** Pour a supply in (or top one up). The horizon is signed, so nobody can shorten a promise in flight. */
export function poolFundMessage(network: string, from: string, lane: PacketLane, asset: string, amount: bigint, expires: number, nonce: number): string {
  return `kray-core.pool-fund.v1|net=${network}|from=${from}|lane=${lane}|asset=${asset}|amount=${amount}|expires=${expires}|nonce=${nonce}`
}
/** Attest one season against a pool: a root, a ceiling it may draw, and the height its leftovers go home. */
export function poolSeasonMessage(network: string, from: string, lane: PacketLane, asset: string, ceiling: bigint, root: string, expires: number, nonce: number): string {
  return `kray-core.pool-season.v1|net=${network}|from=${from}|lane=${lane}|asset=${asset}|ceiling=${ceiling}|root=${root}|expires=${expires}|nonce=${nonce}`
}
/** Draw back the free part, at the horizon and never before. */
export function poolCloseMessage(network: string, from: string, lane: PacketLane, asset: string, amount: bigint, nonce: number): string {
  return `kray-core.pool-close.v1|net=${network}|from=${from}|lane=${lane}|asset=${asset}|amount=${amount}|nonce=${nonce}`
}
