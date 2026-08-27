/**
 * Glow — the soulbound proof-of-work reputation of a KRAY-CORE validator.
 *
 * "Honra que se ganha, nunca se compra." Glow is minted by the PROTOCOL to a
 * validator for real work (producing/verifying blocks, uptime, serving data);
 * it is the √-weight for the Honocracy governance voice (`honocracy.ts`) and the
 * pioneer's standing. It is a reputation LAYER, deliberately kept OUT of the
 * reward: the reward is Bitcoin-standard (sized by the work done each interval,
 * `reward.ts`), NOT by accumulated Glow — so honor governs, but never corrupts
 * the pure Bitcoin reward math.
 *
 * SOULBOUND by construction: the only public mutation is `earn` (up, for work).
 * There is no transfer, no bridge-out, no way to move Glow between addresses —
 * so reputation can never be bought, only earned. Reputation you can buy stops
 * being reputation and reopens the gamble the network exists to avoid.
 *
 * DECAY: reputation reflects ONGOING work, not a medal that pays forever. Glow
 * decays linearly to zero over MAX_IDLE_INTERVALS of inactivity, deterministic
 * (keyed to the chain's interval count, not wall-clock — every node agrees).
 * Working refreshes it. Event-sourced, hash-chained, fsync'd — same discipline
 * as the KRAY ledger; every node replays and verifies it identically.
 */
import { appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

/** Glow decays to zero over this many idle intervals (tunable later). */
export const MAX_IDLE_INTERVALS = 210

const GENESIS_HASH = 'kray-glow-genesis'
const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
function canonical(o: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))))
}

/** Linear decay: full value at idle 0, zero at idle ≥ MAX_IDLE. Integer, deterministic. */
export function decayedGlow(value: bigint, idleIntervals: number): bigint {
  if (idleIntervals <= 0) return value
  if (idleIntervals >= MAX_IDLE_INTERVALS) return 0n
  return (value * BigInt(MAX_IDLE_INTERVALS - idleIntervals)) / BigInt(MAX_IDLE_INTERVALS)
}

interface GlowState { earned: bigint; lastWorkInterval: number }
/** One validator's work in a batched interval: [address, points]. */
export type GlowRow = [string, string]

export interface GlowEvent {
  seq: number; prevHash: string; hash: string
  kind: 'earn' | 'earn-many'; at: number; interval: number
  validator?: string; points?: string // kind 'earn' — a single validator
  rows?: GlowRow[] // kind 'earn-many' — the WHOLE interval in one record
}

export class Glow {
  private readonly journalPath: string
  private readonly snapshotPath: string
  private readonly val = new Map<string, GlowState>()
  private seq = 0
  private lastHash = GENESIS_HASH
  private rootCache: string | null = null

  constructor(dataDir: string, network: string) {
    mkdirSync(dataDir, { recursive: true })
    this.journalPath = join(dataDir, `kray-glow-${network}.jsonl`)
    this.snapshotPath = join(dataDir, `kray-glow-${network}.json`)
    this.replay()
  }

  private s(validator: string): GlowState {
    let st = this.val.get(validator)
    if (!st) { st = { earned: 0n, lastWorkInterval: 0 }; this.val.set(validator, st) }
    return st
  }

  /** Credit ONE validator's work — the shared law for both record shapes. */
  private credit(validator: string, interval: number, points: string): void {
    const st = this.s(validator)
    if (interval < st.lastWorkInterval) throw new Error('glow: work interval out of order')
    const pts = BigInt(points)
    if (pts <= 0n) throw new Error('glow: points must be positive')
    st.earned = decayedGlow(st.earned, interval - st.lastWorkInterval) + pts
    st.lastWorkInterval = interval
  }

  private apply(e: GlowEvent): void {
    // earn: decay what was there up to this work interval, THEN add the new points.
    // earned only ever rises by proven work — soulbound, never received from another.
    if (e.kind === 'earn-many') {
      // THE WHOLE INTERVAL IN ONE RECORD — same law per row, ~40 bytes each
      // instead of ~309 (capacity: O(validators × intervals) was the largest
      // growth term of the whole system; see docs/CAPACITY.md).
      const rows = e.rows ?? []
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('glow: earn-many needs a non-empty table')
      const seen = new Set<string>()
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !row[0]) throw new Error('glow: a row must be [validator, points]')
        if (seen.has(row[0])) throw new Error(`glow: ${row[0]} appears twice in one interval`)
        seen.add(row[0])
      }
      for (const [validator, points] of rows) this.credit(validator, e.interval, points)
      this.rootCache = null
      return
    }
    this.credit(e.validator!, e.interval, e.points!)
    this.rootCache = null
  }

  private append(partial: Omit<GlowEvent, 'seq' | 'prevHash' | 'hash'>): void {
    const body = { ...partial, seq: this.seq + 1, prevHash: this.lastHash }
    const hash = sha256hex(this.lastHash + canonical(body))
    const e: GlowEvent = { ...body, hash }
    this.apply(e) // throws before any write if invalid
    const fd = openSync(this.journalPath, 'a')
    try { appendFileSync(fd, JSON.stringify(e) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
    this.seq = e.seq
    this.lastHash = e.hash
    this.snapshot()
  }

  private replay(): void {
    if (!existsSync(this.journalPath)) return
    const lines = readFileSync(this.journalPath, 'utf8').split('\n').filter((l) => l.trim())
    for (const line of lines) {
      const e = JSON.parse(line) as GlowEvent
      const { hash, ...rest } = e
      if (e.prevHash !== this.lastHash || hash !== sha256hex(this.lastHash + canonical({ ...rest })) || e.seq !== this.seq + 1) {
        throw new Error(`glow: JOURNAL CHAIN BROKEN at seq ${e.seq} — refusing to run`)
      }
      this.apply(e)
      this.seq = e.seq
      this.lastHash = e.hash
    }
    if (existsSync(this.snapshotPath)) {
      try {
        const snap = JSON.parse(readFileSync(this.snapshotPath, 'utf8')) as { lastSeq: number; lastHash: string }
        if (snap.lastSeq > this.seq) throw new Error(`glow: JOURNAL TRUNCATED — snapshot at ${snap.lastSeq}, journal ends ${this.seq}`)
        if (snap.lastSeq === this.seq && snap.lastHash !== this.lastHash) throw new Error('glow: snapshot diverges from journal')
      } catch (e) {
        if (e instanceof Error && (e.message.includes('diverges') || e.message.includes('TRUNCATED'))) throw e
      }
    }
  }

  private snapshot(): void {
    for (let i = 3; i >= 1; i--) {
      const from = i === 1 ? this.snapshotPath : `${this.snapshotPath}.${i - 1}`
      const to = `${this.snapshotPath}.${i}`
      try { if (existsSync(from)) { if (existsSync(to)) unlinkSync(to); copyFileSync(from, to) } } catch { /* best-effort */ }
    }
    const state = { lastSeq: this.seq, lastHash: this.lastHash, validators: Object.fromEntries([...this.val].map(([k, v]) => [k, { earned: v.earned.toString(), lastWorkInterval: v.lastWorkInterval }])) }
    const tmp = this.snapshotPath + '.tmp'
    const fd = openSync(tmp, 'w')
    try { writeSync(fd, JSON.stringify(state, null, 2)); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(tmp, this.snapshotPath)
  }

  // ── public surface — earn (up, soulbound) and read only ─────────────────
  /** Mint Glow to a validator for work done in `interval`. The ONLY mutation. */
  earn(validator: string, interval: number, points: bigint): void {
    this.append({ kind: 'earn', validator, interval, points: points.toString(), at: Date.now() })
  }

  /** Mint Glow for EVERY validator that worked an interval, in ONE record —
   *  the compact form the node writes at settle. Same law per row; a duplicate
   *  validator or a non-positive amount refuses the whole record (atomic). */
  earnMany(interval: number, rows: GlowRow[]): void {
    if (!rows.length) return
    this.append({ kind: 'earn-many', interval, rows, at: Date.now() })
  }

  /** Current Glow of a validator at `atInterval` (after decay). */
  glowOf(validator: string, atInterval: number): bigint {
    const st = this.val.get(validator)
    if (!st) return 0n
    return decayedGlow(st.earned, atInterval - st.lastWorkInterval)
  }

  /** Every validator with live Glow at `atInterval` — the governance/active set. */
  active(atInterval: number): Array<{ validator: string; glow: bigint }> {
    return [...this.val.entries()]
      .map(([validator, st]) => ({ validator, glow: decayedGlow(st.earned, atInterval - st.lastWorkInterval) }))
      .filter((x) => x.glow > 0n)
      .sort((a, b) => (b.glow > a.glow ? 1 : -1))
  }

  get journalLength(): number { return this.seq }
  get chainHead(): string { return this.lastHash }

  /** Root of the derived reputation — anchorable to Bitcoin like every other root. */
  merkleRoot(): string {
    if (this.rootCache !== null) return this.rootCache
    const leaves = [...this.val.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([v, st]) => sha256hex(`${v}:${st.earned}:${st.lastWorkInterval}`))
    if (leaves.length === 0) return (this.rootCache = sha256hex('kray-glow-empty'))
    let level = leaves
    while (level.length > 1) {
      const next: string[] = []
      for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? sha256hex(level[i] + level[i + 1]) : level[i])
      level = next
    }
    return (this.rootCache = level[0])
  }
}
