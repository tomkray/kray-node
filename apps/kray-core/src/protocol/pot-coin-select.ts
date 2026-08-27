/**
 * POT COIN SELECT — pick the vault UTXO(s) that closest match a rune-exit lock.
 *
 * Bitcoin consensus does not choose coins. Wallets do. This is that wallet
 * step for the bakery pot: spend the metal that identifies with the request,
 * leave the rest unspent so another exit can withdraw in parallel.
 *
 * Law (deterministic: same coins + same need → same set, every machine):
 *   least waste (Σ selected − lock), then fewest inputs, then outpoint order.
 *   Small pools (≤16 coins) enumerate. Larger pools: exact coin, else smallest
 *   single that covers, else largest-first fill.
 *
 * Pure and total. The door feeds live coins; the builder only sees the pick.
 */
export interface RuneCoin {
  txid: string
  vout: number
  amountSats: bigint
  runes: bigint
}

const outpoint = (c: RuneCoin): string => `${c.txid}:${c.vout}`

function byOutpoint(a: RuneCoin, b: RuneCoin): number {
  const x = outpoint(a), y = outpoint(b)
  return x < y ? -1 : x > y ? 1 : 0
}

function sortPick(coins: RuneCoin[]): RuneCoin[] {
  return [...coins].sort(byOutpoint)
}

const ENUM_CAP = 16

export function selectRuneCoins(coins: RuneCoin[], need: bigint): { selected: RuneCoin[]; totalRunes: bigint } {
  if (need <= 0n) throw new Error('pot-coin-select: the lock must be positive')
  const live = coins.filter((c) => c.runes > 0n)
  const pool = live.reduce((t, c) => t + c.runes, 0n)
  if (pool < need) {
    throw new Error(`pot-coin-select: the pool holds ${pool}, the lock is ${need} — cannot pay out more than it carries`)
  }

  const ordered = [...live].sort(byOutpoint)
  if (ordered.length <= ENUM_CAP) {
    let best: { pick: RuneCoin[]; waste: bigint; sum: bigint } | null = null
    const n = ordered.length
    const limit = 1 << n
    for (let mask = 1; mask < limit; mask++) {
      const pick: RuneCoin[] = []
      let sum = 0n
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) { pick.push(ordered[i]); sum += ordered[i].runes }
      }
      if (sum < need) continue
      const waste = sum - need
      if (
        !best
        || waste < best.waste
        || (waste === best.waste && pick.length < best.pick.length)
        || (waste === best.waste && pick.length === best.pick.length && outpoint(sortPick(pick)[0]) < outpoint(sortPick(best.pick)[0]))
      ) {
        best = { pick, waste, sum }
      }
    }
    /* c8 ignore next — pool >= need, so a covering subset exists */
    if (!best) throw new Error('pot-coin-select: no covering subset (unreachable when the pool covers the lock)')
    return { selected: sortPick(best.pick), totalRunes: best.sum }
  }

  const exact = live.filter((c) => c.runes === need).sort((a, b) => {
    if (a.amountSats !== b.amountSats) return a.amountSats < b.amountSats ? -1 : 1
    return byOutpoint(a, b)
  })
  if (exact.length) return { selected: [exact[0]], totalRunes: exact[0].runes }
  const above = live.filter((c) => c.runes >= need).sort((a, b) => {
    if (a.runes !== b.runes) return a.runes < b.runes ? -1 : 1
    if (a.amountSats !== b.amountSats) return a.amountSats < b.amountSats ? -1 : 1
    return byOutpoint(a, b)
  })
  if (above.length) return { selected: [above[0]], totalRunes: above[0].runes }

  const desc = [...live].sort((a, b) => (a.runes !== b.runes ? (a.runes > b.runes ? -1 : 1) : byOutpoint(a, b)))
  const selected: RuneCoin[] = []
  let sum = 0n
  for (const c of desc) {
    selected.push(c)
    sum += c.runes
    if (sum >= need) break
  }
  return { selected: sortPick(selected), totalRunes: sum }
}
