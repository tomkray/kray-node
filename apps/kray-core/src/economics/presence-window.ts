/**
 * THE PRESENCE WINDOW — a beat is a fact about ONE open moment, not a free axis.
 *
 * `block` in a beat used to be any integer ≥ 0. spanWork then summed best-work
 * per distinct block, so one wallet could grind cheap 8-zero solutions on
 * block = 0,1,2,…,N under the current Bitcoin beacon and out-earn an honest
 * tab that only mined the live tip. That is not more machine strength — it is
 * an unbounded index.
 *
 * NEW settlements carry `presenceTip` (the KRAY height the seal closed). Every
 * claim block must equal that tip — door, settleBeats, and the reducer. A
 * mismatch HALTs. Historical settlements (no presenceTip) keep the old span
 * so Signet replay does not freeze (A3); they still HALT if one address
 * claims more than HISTORICAL_SPAN_BLOCK_CAP distinct blocks (a 10k grind
 * cannot hide behind a missing tip).
 *
 * Pure: no clock, no I/O. The door enforces the same numbers; this file is law.
 */

/** Policy cap on paid zeros for a windowed (presenceTip) settlement.
 *  verifyBeat still accepts a luckier hash; the split pays at most 2^24 so one
 *  lottery beat cannot take a quiet pool. Historical events keep full zeros. */
export const BEAT_PAY_ZEROS_CAP = 24

/**
 * Seq at and after which the per-identity pay cap above is LIFTED (the "V1" fix).
 *
 * WHY: a FLAT per-identity cap is the one thing that breaks sybil-neutrality. `2^zeros` is neutral BY
 * ITSELF — `2^30 === 64 × 2^24` — so an honest miner on one address and a splitter across 64 addresses
 * prove the SAME work. The cap flattens a single beat at 2^24, so a miner above the cap out-earns itself by
 * spreading N addresses each ≤ the cap (up to N×). Lifting the cap removes that split incentive exactly,
 * and the lucky-beat variance the cap guarded against stays bounded by the split ratio and self-averages
 * over seals (it is inherent lottery variance, not a grindable vector).
 *
 * BELOW this seq, windowed settles clamp paid zeros to BEAT_PAY_ZEROS_CAP — the original behavior, so ALL
 * existing history replays BYTE-FOR-BYTE. AT/ABOVE it, a beat is paid its full 2^zeros.
 *
 * DORMANT: MAX_SAFE_INTEGER keeps the cap active at every real seq, so today's behavior is unchanged. The
 * Creator ratifies the real activation — network-aware: a future Signet seq that preserves current history,
 * while a fresh mainnet genesis starts already lifted (seq 0). Until then this fix is inert and proven.
 */
export const BEAT_PAY_CAP_LIFTED_FROM_SEQ = Number.MAX_SAFE_INTEGER

/** How far behind the settle tip a single stored beat may sit. The door only
 *  accepts the live tip at POST; by the time Bitcoin confirms the seal the
 *  KRAY height has usually moved. One beat per address, inside this lookback,
 *  is still that seal's presence — not a free grinding axis. */
export const PRESENCE_LOOKBACK = 128

/** A pre-window settlement may span many real sealed heights. A grind of
 *  thousands of fake indices is not an honest seal window. */
export const HISTORICAL_SPAN_BLOCK_CAP = 1024

/**
 * Settlements at or above this seq MUST carry an integer presenceTip.
 * Seq below this is the Signet-era journal that predates the window (A3).
 * Live Signet head at the first window ship was 120 — 121 is the first
 * height a hostile pen cannot omit the tip and keep the 1024-block axis.
 */
export const PRESENCE_WINDOW_FROM_SEQ = 121

export interface PresenceBeat {
  block: number
}

export interface PresenceClaim {
  address: string
  beats: PresenceBeat[]
}

/**
 * presenceTip is a scarce KRAY height — only a whole number ≥ 0, or absent.
 * A string/bool/float is a type hole (JSON may keep a number; a hand-built
 * event may not). Absent is historical. Anything else HALTs — never coerced
 * into the old span.
 */
export function readPresenceTip(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || !Number.isFinite(raw)) {
    throw new Error('ledger: presenceTip must be a whole KRAY height — HALT')
  }
  return raw
}

/**
 * The door writes p2tr lowercase. Bech32 is case-insensitive (BIP-173).
 * A hostile journal that reprints the same taproot as TB1… or with trailing
 * space is the same person — not a second machine. Dummy test ids (val-A)
 * are unchanged. The beat hash still binds the canonical key after fold.
 */
export function claimAddressKey(addr: string): string {
  if (typeof addr !== 'string') throw new Error('ledger: a claim needs an address — HALT')
  const t = addr.trim()
  if (!t) throw new Error('ledger: a claim needs an address — HALT')
  if (/^(bc1|tb1|bcrt1)/i.test(t)) return t.toLowerCase()
  return t
}

/** New seals (seq ≥ PRESENCE_WINDOW_FROM_SEQ) are windowed or they do not apply. */
export function assertPresenceEra(seq: number, presenceTip: number | undefined): void {
  if (seq >= PRESENCE_WINDOW_FROM_SEQ && presenceTip === undefined) {
    throw new Error(`ledger: settlements from seq ${PRESENCE_WINDOW_FROM_SEQ} must carry presenceTip — HALT`)
  }
}

/**
 * One address → one claim row. Duplicate rows with different blocks are a
 * grind (W2-02): splitFeePool would sum them. Same address + same block
 * folds (best-of lives in spanWork). Differing custody hexes HALT.
 */
export function foldClaimsByAddress<T extends PresenceClaim & { custody?: string; hits?: number }>(claims: T[]): T[] {
  const byAddr = new Map<string, T[]>()
  for (const c of claims) {
    const key = claimAddressKey(c.address)
    const list = byAddr.get(key) ?? []
    list.push(c)
    byAddr.set(key, list)
  }
  const out: T[] = []
  for (const [address, rows] of [...byAddr.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const beats = rows.flatMap((r) => (Array.isArray(r.beats) ? r.beats : []))
    const distinct = new Set<number>()
    for (const b of beats) {
      if (Number.isInteger(b.block) && b.block >= 0) distinct.add(b.block)
    }
    if (rows.length > 1 && distinct.size > 1) {
      throw new Error('ledger: a windowed settlement allows one moment per address — HALT')
    }
    const custodies = new Set(rows.map((r) => r.custody).filter((x): x is string => typeof x === 'string' && x.length > 0))
    if (custodies.size > 1) throw new Error('ledger: one address, two custody proofs — HALT')
    const hitVals = new Set(rows.map((r) => r.hits).filter((h): h is number => Number.isInteger(h)))
    if (hitVals.size > 1) throw new Error('ledger: one address, two hit counts — HALT')
    out.push({
      ...rows[0],
      address,
      beats,
      ...(custodies.size ? { custody: [...custodies][0] } : {}),
      ...(hitVals.size ? { hits: [...hitVals][0] } : {}),
    })
  }
  return out
}

/**
 * REFUSE a claim list that treats `block` as a grinding axis.
 * `presenceTip` present → at most one distinct block per address, and that
 * block ∈ [presenceTip − PRESENCE_LOOKBACK, presenceTip].
 * `presenceTip` absent  → at most HISTORICAL_SPAN_BLOCK_CAP distinct blocks
 * per address (A3 for old journals; kills the 10k-index attack on the old path).
 * Duplicate rows for one address are folded first (W2-02).
 */
export function assertPresenceClaims(claims: PresenceClaim[], presenceTip?: number): void {
  const folded = foldClaimsByAddress(claims)
  if (presenceTip !== undefined) {
    if (!Number.isInteger(presenceTip) || presenceTip < 0) {
      throw new Error('ledger: presenceTip must be a whole KRAY height — HALT')
    }
    const lo = Math.max(0, presenceTip - PRESENCE_LOOKBACK)
    for (const c of folded) {
      if (!Array.isArray(c.beats)) throw new Error('ledger: a claim must carry beats — HALT')
      const distinct = new Set<number>()
      for (const b of c.beats) {
        if (!Number.isInteger(b.block) || b.block < lo || b.block > presenceTip) {
          throw new Error(`ledger: beat block ${b.block} is outside the open presence window [${lo}…${presenceTip}] — HALT`)
        }
        distinct.add(b.block)
      }
      if (distinct.size > 1) {
        throw new Error('ledger: a windowed settlement allows one moment per address — HALT')
      }
    }
    return
  }
  for (const c of folded) {
    if (!Array.isArray(c.beats)) throw new Error('ledger: a claim must carry beats — HALT')
    const distinct = new Set<number>()
    for (const b of c.beats) {
      if (Number.isInteger(b.block) && b.block >= 0) distinct.add(b.block)
    }
    if (distinct.size > HISTORICAL_SPAN_BLOCK_CAP) {
      throw new Error(`ledger: a claim spans ${distinct.size} blocks — above the historical cap ${HISTORICAL_SPAN_BLOCK_CAP} — HALT`)
    }
  }
}
