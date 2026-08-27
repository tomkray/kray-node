/**
 * AMM V2 — constant product, integer only, no I/O.
 *
 * The same arithmetic the kray.space L2 already ships (UniV2 / 997/1000).
 * This file never touches the journal. The reducer calls it, then moves ₭
 * and rune credits. Divisibility never enters: every amount is the atomic
 * base unit the edict already credited.
 *
 *   amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
 *   k after a swap must not fall (the 0.3% stays in the pool).
 */
import { isqrt } from '../economics/presence.ts'
import { canonicalRuneKey } from '../economics/rune-book.ts'

export const AMM_FEE_NUM = 997n
export const AMM_FEE_DEN = 1000n
export const MINIMUM_LIQUIDITY = 100n

/** Protocol label — eternal. No key encodes here; requireSig refuses a KRAY_ signer.
 *  The id is the canonical `block:tx` so `01:1` and `1:1` cannot birth two pots.
 *  A stranger re-derives the pot from the rune id alone. Never hash, never bech32. */
export function ammPoolAddress(runeId: string): string {
  return 'KRAY_AMM_' + canonicalRuneKey(runeId).replace(/:/g, '_')
}

/** True for ₭ pots and rune/rune pots. Reserves move only by signed amm-add/swap. */
export function isAmmPotAddress(addr: string): boolean {
  return typeof addr === 'string' && addr.startsWith('KRAY_AMM_')
}

export type RrPair = { key: string; a: string; b: string }

/** Ordered pair. `156:2|5469:1` === `5469:1|156:2`. Same rune (incl. 01:1 ≡ 1:1) is refused. */
export function rrPairKey(runeA: string, runeB: string): RrPair {
  const a = canonicalRuneKey(runeA)
  const b = canonicalRuneKey(runeB)
  if (a === b) throw new Error('amm: a rune/rune pair needs two distinct runes')
  return a < b ? { key: `${a}|${b}`, a, b } : { key: `${b}|${a}`, a: b, b: a }
}

export function isRrPairKey(key: string): boolean {
  return typeof key === 'string' && key.includes('|')
}

/** Distinct from KRAY_AMM_<rune> so a ₭ pair and a rune/rune pair cannot share a pot. */
export function ammRrPoolAddress(runeA: string, runeB: string): string {
  const p = rrPairKey(runeA, runeB)
  return 'KRAY_AMM_RR_' + p.a.replace(/:/g, '_') + '_' + p.b.replace(/:/g, '_')
}

export type AmmPotRef =
  | { kind: 'kray'; runeId: string }
  | { kind: 'rr'; a: string; b: string }

/**
 * Inverse of ammPoolAddress / ammRrPoolAddress.
 * Canonical id is always `block:tx` (one colon) so the pot has two or four `_` parts.
 * The UI never shows this string as a name — people see IRON / GOLD. The pot stays the no-key escrow.
 */
export function parseAmmPotAddress(addr: string): AmmPotRef | null {
  if (typeof addr !== 'string' || !addr.startsWith('KRAY_AMM_')) return null
  if (addr.startsWith('KRAY_AMM_RR_')) {
    const parts = addr.slice('KRAY_AMM_RR_'.length).split('_')
    if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p))) return null
    try {
      const pair = rrPairKey(`${parts[0]}:${parts[1]}`, `${parts[2]}:${parts[3]}`)
      return { kind: 'rr', a: pair.a, b: pair.b }
    } catch {
      return null
    }
  }
  const parts = addr.slice('KRAY_AMM_'.length).split('_')
  if (parts.length !== 2 || parts.some((p) => !/^\d+$/.test(p))) return null
  try {
    return { kind: 'kray', runeId: canonicalRuneKey(`${parts[0]}:${parts[1]}`) }
  } catch {
    return null
  }
}

export function quoteOut(reserveIn: bigint, reserveOut: bigint, amountIn: bigint): bigint {
  if (amountIn <= 0n) throw new Error('amm: amount in must be positive')
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error('amm: empty pool cannot swap')
  const inWithFee = amountIn * AMM_FEE_NUM
  const out = (inWithFee * reserveOut) / (reserveIn * AMM_FEE_DEN + inWithFee)
  if (out <= 0n) throw new Error('amm: input too small — output rounds to zero')
  if (out >= reserveOut) throw new Error('amm: output would drain the reserve')
  const kBefore = reserveIn * reserveOut
  const kAfter = (reserveIn + amountIn) * (reserveOut - out)
  if (kAfter < kBefore) throw new Error(`amm: k invariant broken (${kBefore} → ${kAfter})`)
  return out
}

/** Two piles — ₭+rune or rune+rune. The edict never enters. */
export function quoteFirstMint(aIn: bigint, bIn: bigint): { supply: bigint; minted: bigint } {
  if (aIn <= 0n || bIn <= 0n) throw new Error('amm: first mint needs positive amounts on both sides')
  const raw = isqrt(aIn * bIn)
  if (raw <= MINIMUM_LIQUIDITY) throw new Error(`amm: initial liquidity too small (need √(x·y) > ${MINIMUM_LIQUIDITY})`)
  return { supply: raw, minted: raw - MINIMUM_LIQUIDITY }
}

export function quoteAdd(
  aReserve: bigint, bReserve: bigint, supply: bigint, aIn: bigint, bIn: bigint,
): { minted: bigint } {
  if (aIn <= 0n || bIn <= 0n) throw new Error('amm: add needs positive amounts on both sides')
  if (supply <= 0n || aReserve <= 0n || bReserve <= 0n) throw new Error('amm: add needs a live pool')
  const fromA = (aIn * supply) / aReserve
  const fromB = (bIn * supply) / bReserve
  const minted = fromA < fromB ? fromA : fromB
  if (minted <= 0n) throw new Error('amm: add too small — minted LP rounds to zero')
  return { minted }
}

export function quoteRemove(
  krayReserve: bigint, runeReserve: bigint, supply: bigint, lp: bigint,
): { krayOut: bigint; runeOut: bigint } {
  if (lp <= 0n) throw new Error('amm: burn must be positive')
  if (supply <= 0n || lp > supply) throw new Error('amm: cannot burn more LP than the supply')
  const krayOut = (lp * krayReserve) / supply
  const runeOut = (lp * runeReserve) / supply
  if (krayOut <= 0n || runeOut <= 0n) throw new Error('amm: burn too small — outputs round to zero')
  if (krayOut >= krayReserve || runeOut >= runeReserve) throw new Error('amm: burn would drain a reserve')
  return { krayOut, runeOut }
}

/** LP book — shares only. Reserves live on KRAY_AMM_* in the ₭ and rune books. */
export class AmmBook {
  private readonly shares = new Map<string, Map<string, bigint>>()
  private readonly supply = new Map<string, bigint>()

  private bagAt(key: string): Map<string, bigint> {
    let m = this.shares.get(key)
    if (!m) { m = new Map(); this.shares.set(key, m) }
    return m
  }

  private bag(runeId: string): Map<string, bigint> { return this.bagAt(canonicalRuneKey(runeId)) }

  exists(runeId: string): boolean { return (this.supply.get(canonicalRuneKey(runeId)) ?? 0n) > 0n }
  supplyOf(runeId: string): bigint { return this.supply.get(canonicalRuneKey(runeId)) ?? 0n }
  lpOf(runeId: string, addr: string): bigint { return this.bag(runeId).get(addr) ?? 0n }

  existsRr(a: string, b: string): boolean { return (this.supply.get(rrPairKey(a, b).key) ?? 0n) > 0n }
  supplyOfRr(a: string, b: string): bigint { return this.supply.get(rrPairKey(a, b).key) ?? 0n }
  lpOfRr(a: string, b: string, addr: string): bigint { return this.bagAt(rrPairKey(a, b).key).get(addr) ?? 0n }

  private mintAt(key: string, to: string, minted: bigint, supplyAfter: bigint): void {
    if (minted <= 0n) throw new Error('amm: mint must be positive')
    const current = this.supply.get(key) ?? 0n
    const expected = current === 0n ? minted + MINIMUM_LIQUIDITY : current + minted
    if (supplyAfter !== expected) {
      throw new Error(`amm: supplyAfter ${supplyAfter} ≠ expected ${expected} (dead shares on first mint, then exact increment)`)
    }
    const m = this.bagAt(key)
    m.set(to, (m.get(to) ?? 0n) + minted)
    this.supply.set(key, supplyAfter)
  }

  mint(runeId: string, to: string, minted: bigint, supplyAfter: bigint): void {
    this.mintAt(canonicalRuneKey(runeId), to, minted, supplyAfter)
  }
  mintRr(a: string, b: string, to: string, minted: bigint, supplyAfter: bigint): void {
    this.mintAt(rrPairKey(a, b).key, to, minted, supplyAfter)
  }

  private burnAt(key: string, from: string, lp: bigint): void {
    const have = this.bagAt(key).get(from) ?? 0n
    if (have < lp) throw new Error(`amm: insufficient LP (have ${have}, need ${lp})`)
    const m = this.bagAt(key)
    const left = have - lp
    if (left > 0n) m.set(from, left)
    else m.delete(from)
    this.supply.set(key, (this.supply.get(key) ?? 0n) - lp)
  }

  burn(runeId: string, from: string, lp: bigint): void { this.burnAt(canonicalRuneKey(runeId), from, lp) }
  burnRr(a: string, b: string, from: string, lp: bigint): void { this.burnAt(rrPairKey(a, b).key, from, lp) }

  private holdersAt(key: string): { address: string; lp: bigint }[] {
    const m = this.shares.get(key)
    if (!m) return []
    return [...m.entries()].filter(([, n]) => n > 0n).sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([address, lp]) => ({ address, lp }))
  }

  holders(runeId: string): { address: string; lp: bigint }[] { return this.holdersAt(canonicalRuneKey(runeId)) }
  holdersRr(a: string, b: string): { address: string; lp: bigint }[] { return this.holdersAt(rrPairKey(a, b).key) }

  runeIds(): string[] {
    return [...this.supply.keys()].filter((id) => !isRrPairKey(id) && (this.supply.get(id) ?? 0n) > 0n).sort()
  }
  rrPairs(): RrPair[] {
    return [...this.supply.keys()].filter((id) => isRrPairKey(id) && (this.supply.get(id) ?? 0n) > 0n).sort().map((key) => {
      const [a, b] = key.split('|')
      return { key, a, b }
    })
  }

  empty(): boolean { return this.runeIds().length === 0 && this.rrPairs().length === 0 }

  /**
   * LP conservation — the rune-book solvent, for shares.
   * Every live pair: supply === Σ holders + MINIMUM_LIQUIDITY dead. Empty book is solvent.
   * Does not fold into the cascade (the numbers already do). A stranger's /audit
   * can refute a drifted book without re-deriving k.
   */
  solvent(): boolean {
    const keys = new Set([...this.supply.keys(), ...this.shares.keys()])
    for (const key of [...keys].sort()) {
      const supply = this.supply.get(key) ?? 0n
      const held = this.holdersAt(key).reduce((s, h) => s + h.lp, 0n)
      if (supply === 0n) {
        if (held !== 0n) return false
        continue
      }
      if (supply !== held + MINIMUM_LIQUIDITY) return false
    }
    return true
  }

  /** Folds into the cascade root once any pool exists (append-only).
   *  One pair, one line — same law as a star name. ₭-pair lines stay `${id}|supply|holders`.
   *  RR lines append after, prefixed `RR|`. Canonical keys: `01:1` ≡ `1:1`, DOG/GOLD ≡ GOLD/DOG. */
  commitment(): string {
    const parts: string[] = []
    for (const id of this.runeIds()) {
      const hs = this.holders(id).map((h) => `${h.address}=${h.lp}`).join(',')
      parts.push(`${id}|${this.supply.get(id) ?? 0n}|${hs}`)
    }
    for (const p of this.rrPairs()) {
      const hs = this.holdersAt(p.key).map((h) => `${h.address}=${h.lp}`).join(',')
      parts.push(`RR|${p.key}|${this.supply.get(p.key) ?? 0n}|${hs}`)
    }
    return parts.join('\n')
  }
}
