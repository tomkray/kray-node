/**
 * PRESENCE — who was actually there, and what each one earned for being there.
 *
 * A seal releases one budget for a whole span of fast blocks. Splitting it once
 * over each validator's TOTAL work is easy and wrong: √ is concave, so splitting
 * per block and summing is NOT the same number as splitting on the aggregate.
 * Over two blocks, a validator present in both earns 70.7% against 29.3% for one
 * who did identical total work in a single burst. The aggregate reading calls them
 * equal. Presence is the thing being paid for, so presence is what must be counted.
 *
 * ── WHY A BITMAP ────────────────────────────────────────────────────────────
 *
 * For the split to be PROVABLE rather than merely bounded, the work must be in the
 * journal — otherwise a node operator can write any payout table that sums within
 * the cap and no replay can refute it. But a row per validator per fast block would
 * multiply the journal by ~171 and undo the compaction already won.
 *
 * A validator's work per block is their declared weight, a scalar. What varies is
 * WHICH blocks they were in — one bit each. 171 blocks is 22 bytes. So the journal
 * carries a scalar and a bitmap, and anyone recomputes the whole table, block by
 * block, and checks it against the one that was written.
 *
 * Everything here is exact integer arithmetic. No float ever touches an amount.
 */

/** Pack presence flags into bytes, LSB-first within each byte. Pure and total. */
export function packPresence(bits: boolean[]): Uint8Array {
  const out = new Uint8Array(Math.ceil(bits.length / 8))
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= 1 << (i & 7)
  return out
}

/** Unpack `count` flags. `count` is carried separately: trailing zero bits are
 *  indistinguishable from padding, and guessing which is which would silently
 *  change who was present. */
export function unpackPresence(bytes: Uint8Array, count: number): boolean[] {
  const out: boolean[] = []
  for (let i = 0; i < count; i++) out.push(((bytes[i >> 3] ?? 0) >> (i & 7) & 1) === 1)
  return out
}

export const presenceToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
export function presenceFromHex(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0) throw new Error('presence: not a canonical hex bitmap')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Integer square root — Newton on BigInt, exact, no float anywhere near money.
 *  N2 ratified the algorithm as-is. Do not change the iteration without command + numbers. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('presence: negative work')
  if (n < 2n) return n
  let x = n, y = (x + 1n) / 2n
  while (y < x) { x = y; y = (x + n / x) / 2n }
  return x
}

export interface Participant {
  /** who */
  address: string
  /** their declared weight for every block they were present in */
  work: bigint
  /** one bit per fast block in the span */
  present: boolean[]
}

/**
 * SPLIT ONE SEAL'S BUDGET — per fast block, LINEARLY in work, among those PRESENT there.
 *
 * The budget is first divided across the blocks of the span, then each block's
 * share is split among whoever was in THAT block. Both divisions use largest
 * remainder, so the sum is the budget EXACTLY — not to a rounding error, exactly.
 * A network that leaks one unit per seal leaks a fortune over a century, and a
 * network that creates one breaks conservation.
 *
 * A block with nobody present pays nothing, and its share returns to the pot to be
 * distributed among the blocks that had someone. Nothing is invented and nothing
 * is stranded.
 */
export function splitSeal(budget: bigint, blocks: number, who: Participant[]): Map<string, bigint> {
  const out = new Map<string, bigint>()
  if (budget <= 0n || blocks <= 0 || !who.length) return out

  // which blocks had anybody at all — an empty block cannot be paid
  const live: number[] = []
  for (let b = 0; b < blocks; b++) if (who.some((p) => p.present[b] && p.work > 0n)) live.push(b)
  if (!live.length) return out

  // the budget over the LIVE blocks, largest remainder
  const per = budget / BigInt(live.length)
  let left = budget - per * BigInt(live.length)
  const share = new Map<number, bigint>()
  for (const b of live) { share.set(b, per + (left > 0n ? 1n : 0n)); if (left > 0n) left -= 1n }

  for (const b of live) {
    const here = who.filter((p) => p.present[b] && p.work > 0n)
    // ── LINEAR IN WORK, AND THAT IS A THEOREM, NOT A PREFERENCE ────────────
    // This weighed √work for a long time, to damp a whale. Measured against a
    // free identity it did the exact opposite: one machine split into 16 names
    // went from 50% of a contested pot to 80%, because N·√(W/N) = √(NW) > √W.
    // Only a LINEAR weight satisfies N·f(W/N) = f(W), so only a linear weight is
    // sybil-neutral — and no amount of measuring the work changes that, because
    // the defect is in the CURVE, not in the number it is applied to.
    //
    // The consequence for decentralisation is the opposite of the intention: a
    // concave curve makes the dominant strategy "pretend to be many small
    // validators", which is whale dominance wearing the costume of a crowd. A
    // linear curve pays exactly what was contributed, so a small validator is
    // never diluted by an honest large one, and a large one gains nothing by
    // pretending to be small. Bitcoin's own rule is this rule: hashrate share is
    // reward share.
    //
    // Concavity would be safe again the day identity costs something scarce.
    // Until then, the safe choice is the one with a proof behind it.
    const weights = here.map((p) => p.work)
    const total = weights.reduce((t, r) => t + r, 0n)
    if (total === 0n) continue
    const pot = share.get(b)!
    // largest remainder again, inside the block: floor everybody, then hand the
    // leftover units to the largest fractional parts, ties broken by ADDRESS so
    // every node on earth resolves them identically.
    const floors = weights.map((r) => (pot * r) / total)
    let rest = pot - floors.reduce((t, f) => t + f, 0n)
    const order = here
      .map((p, i) => ({ i, rem: pot * weights[i] - floors[i] * total, addr: p.address }))
      .sort((x, y) => (y.rem > x.rem ? 1 : y.rem < x.rem ? -1 : x.addr < y.addr ? -1 : 1))
    for (const o of order) { if (rest <= 0n) break; floors[o.i] += 1n; rest -= 1n }
    here.forEach((p, i) => { if (floors[i] > 0n) out.set(p.address, (out.get(p.address) ?? 0n) + floors[i]) })
  }
  return out
}

/** One validator's line in a settlement, as the journal will carry it. */
export interface SettlementClaim {
  address: string
  /** the weight they declared for every block they were in */
  work: string
  /** their presence over the span, hex, LSB-first — 22 bytes for a Bitcoin block */
  presence: string
  /** what the row says they were paid */
  paid: string
}

export interface SettlementVerdict {
  /** the written table is EXACTLY the one the law produces */
  exact: boolean
  /** what the law produces, for comparison */
  expected: Map<string, bigint>
  /** every address whose written amount differs, and by how much */
  wrong: Array<{ address: string; written: bigint; expected: bigint }>
  /** the written total, and the budget it had to equal */
  writtenTotal: bigint
  reason?: 'bad-presence' | 'bad-amount' | 'over-budget' | 'mismatch'
}

/**
 * VERIFY A SETTLEMENT — recompute the whole table and compare, line by line.
 *
 * This is the difference between BOUNDED and PROVEN. Today a reducer can check
 * that a payout table sums within the halving cap and that the vault is solvent —
 * which stops theft of more than the curve allows, and stops nothing else. An
 * operator could still hand one validator another's share, and no replay would
 * refute it, because the WORK was never written down.
 *
 * With work and presence in the row, there is exactly ONE table the law can
 * produce. Anyone recomputes it from the journal and compares. A node that finds a
 * difference has found a lie, not an opinion.
 *
 * Refuses rather than guesses: a malformed bitmap, a non-integer amount or a total
 * over budget all fail closed, because a verifier that shrugs is a verifier that
 * approves.
 */
export function verifySettlement(budget: bigint, blocks: number, rows: SettlementClaim[]): SettlementVerdict {
  const empty = { expected: new Map<string, bigint>(), wrong: [], writtenTotal: 0n }
  const who: Participant[] = []
  let writtenTotal = 0n
  for (const r of rows) {
    let work: bigint, paid: bigint, present: boolean[]
    try {
      if (!/^\d+$/.test(r.work) || !/^\d+$/.test(r.paid)) return { exact: false, ...empty, reason: 'bad-amount' }
      work = BigInt(r.work); paid = BigInt(r.paid)
      present = unpackPresence(presenceFromHex(r.presence), blocks)
    } catch (_) { return { exact: false, ...empty, reason: 'bad-presence' } }
    writtenTotal += paid
    who.push({ address: r.address, work, present })
  }
  if (writtenTotal > budget) return { exact: false, ...empty, writtenTotal, reason: 'over-budget' }

  const expected = splitSeal(budget, blocks, who)
  const wrong: Array<{ address: string; written: bigint; expected: bigint }> = []
  for (const r of rows) {
    const want = expected.get(r.address) ?? 0n
    if (BigInt(r.paid) !== want) wrong.push({ address: r.address, written: BigInt(r.paid), expected: want })
  }
  // an address the law would pay but the table omitted is a difference too
  for (const [addr, want] of expected) {
    if (!rows.some((r) => r.address === addr)) wrong.push({ address: addr, written: 0n, expected: want })
  }
  return { exact: wrong.length === 0, expected, wrong, writtenTotal, ...(wrong.length ? { reason: 'mismatch' as const } : {}) }
}
