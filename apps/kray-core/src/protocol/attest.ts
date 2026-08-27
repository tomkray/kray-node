/**
 * Attestations — KRAY-CORE's permanent, Bitcoin-anchorable home for external
 * ledgers' events (KRILL first). "Nada se perde, nada no vácuo."
 *
 * A tenant like KRILL produces thousands of internal validations that today live
 * only in its own local JSONL journal — verifiable by KRILL alone. This stream
 * MIRRORS each such event as an immutable attestation: it records the event's own
 * tamper-evident hash (the leaf), its source, seq, and kind — hash-chained and
 * fsync'd exactly like the KRAY ledger, with a merkle root anchored to Bitcoin.
 * Once here, KRILL's private history becomes a public, sealed, multi-node-
 * verifiable chain.
 *
 * ADDITIVE + ISOLATED by construction: this touches NEITHER the KRAY balance
 * ledger (KRAY conservation, emitted − burned, is untouched) NOR any source
 * ledger. A tenant project appends from its own house; core never imports a
 * tenant adapter. It is a parallel stream, like Glow: its own journal, its
 * own anchorable root.
 *
 * IDEMPOTENT: attestations are keyed by (source, sourceSeq) with a per-source
 * high-water mark, so re-tailing a source journal never double-records — a node
 * can sync a growing source repeatedly and only the new events are anchored.
 */
import { appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const GENESIS_HASH = 'kray-attest-genesis'
const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
function canonical(o: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))))
}

export interface AttestEvent {
  seq: number
  prevHash: string
  hash: string
  at: number
  source: string // which external ledger, e.g. 'krill:regtest'
  sourceSeq: number // the external event's own seq
  sourceHash: string // the external event's own tamper-evident hash — the anchored leaf
  kind: string // the external event kind (credit / claim-open / …)
  summary: string // compact human-readable digest of the event
}

export class Attestations {
  private readonly journalPath: string
  private readonly snapshotPath: string
  private seq = 0
  private lastHash = GENESIS_HASH
  // each leaf carries its source coordinates so the anchored root can be a pure
  // function of the SET of attested events (sorted), not of record/sync order —
  // so two nodes that mirror the same source histories reach the SAME root.
  private readonly leaves: Array<{ source: string; sourceSeq: number; sourceHash: string }> = []
  private readonly highWater = new Map<string, number>() // source → last sourceSeq attested
  private rootCache: string | null = null

  constructor(dataDir: string, network: string) {
    mkdirSync(dataDir, { recursive: true })
    this.journalPath = join(dataDir, `kray-attest-${network}.jsonl`)
    this.snapshotPath = join(dataDir, `kray-attest-${network}.json`)
    this.replay()
  }

  /** Pre-write validation — throws if the event may not be appended. Mutates nothing. */
  private validate(e: AttestEvent): void {
    const hw = this.highWater.get(e.source) ?? 0
    if (e.sourceSeq <= hw) throw new Error(`attest: source ${e.source} seq ${e.sourceSeq} not ahead of ${hw}`)
  }

  /** Commit in-memory state. Called ONLY after the durable journal write (or on
   *  replay), so memory can never lead the fsync'd journal. The LEAF value is the
   *  source event's own hash — never depends on WHEN we mirrored it. */
  private commit(e: AttestEvent): void {
    this.highWater.set(e.source, e.sourceSeq)
    this.leaves.push({ source: e.source, sourceSeq: e.sourceSeq, sourceHash: e.sourceHash })
    this.rootCache = null
    this.seq = e.seq
    this.lastHash = e.hash
  }

  private append(partial: Omit<AttestEvent, 'seq' | 'prevHash' | 'hash'>): AttestEvent {
    const body = { ...partial, seq: this.seq + 1, prevHash: this.lastHash }
    const hash = sha256hex(this.lastHash + canonical(body))
    const e: AttestEvent = { ...body, hash }
    this.validate(e) // throws before any write if invalid
    const fd = openSync(this.journalPath, 'a')
    try { appendFileSync(fd, JSON.stringify(e) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
    this.commit(e) // mutate memory ONLY after the durable write
    this.snapshot()
    return e
  }

  private replay(): void {
    if (!existsSync(this.journalPath)) return
    const lines = readFileSync(this.journalPath, 'utf8').split('\n').filter((l) => l.trim())
    for (const line of lines) {
      const e = JSON.parse(line) as AttestEvent
      const { hash, ...rest } = e
      if (e.prevHash !== this.lastHash || hash !== sha256hex(this.lastHash + canonical({ ...rest })) || e.seq !== this.seq + 1) {
        throw new Error(`attest: JOURNAL CHAIN BROKEN at seq ${e.seq} — refusing to run`)
      }
      this.validate(e)
      this.commit(e)
    }
    if (existsSync(this.snapshotPath)) {
      try {
        const snap = JSON.parse(readFileSync(this.snapshotPath, 'utf8')) as { lastSeq: number; lastHash: string }
        if (snap.lastSeq > this.seq) throw new Error(`attest: JOURNAL TRUNCATED — snapshot at ${snap.lastSeq}, journal ends ${this.seq}`)
        if (snap.lastSeq === this.seq && snap.lastHash !== this.lastHash) throw new Error('attest: snapshot diverges from journal')
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
    const state = { lastSeq: this.seq, lastHash: this.lastHash, sources: Object.fromEntries(this.highWater) }
    const tmp = this.snapshotPath + '.tmp'
    const fd = openSync(tmp, 'w')
    try { writeSync(fd, JSON.stringify(state, null, 2)); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(tmp, this.snapshotPath)
  }

  // ── public surface: record (append-only) and read ───────────────────────
  /** Attest one external event. Idempotent: a (source, sourceSeq) at or below the
   *  high-water mark is a NO-OP (returns false), so re-tailing never doubles. */
  record(source: string, sourceSeq: number, sourceHash: string, kind: string, summary: string): boolean {
    if (sourceSeq <= (this.highWater.get(source) ?? 0)) return false
    this.append({ source, sourceSeq, sourceHash, kind, summary, at: Date.now() })
    return true
  }

  /** The last sourceSeq attested for a source — where a tail should resume. */
  lastSourceSeq(source: string): number { return this.highWater.get(source) ?? 0 }
  /** Total attestations across all sources. */
  get count(): number { return this.seq }
  get journalLength(): number { return this.seq }
  get chainHead(): string { return this.lastHash }
  /** Sources attested here, with their high-water seq. */
  sources(): Array<{ source: string; upTo: number }> {
    return [...this.highWater.entries()].map(([source, upTo]) => ({ source, upTo }))
  }

  /** Merkle root over every attestation (in seq order) — anchored to Bitcoin like
   *  every other root. Bitcoin-style: duplicate the last leaf if the level is odd. */
  merkleRoot(): string {
    if (this.rootCache !== null) return this.rootCache
    if (this.leaves.length === 0) return (this.rootCache = sha256hex('kray-attest-empty'))
    // canonical order — by (source, sourceSeq) — so the root is a pure function of
    // the SET of anchored events, identical on every node regardless of sync order.
    let level = [...this.leaves]
      .sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.sourceSeq - b.sourceSeq))
      .map((l) => l.sourceHash)
    while (level.length > 1) {
      const next: string[] = []
      for (let i = 0; i < level.length; i += 2) next.push(sha256hex(level[i] + (i + 1 < level.length ? level[i + 1] : level[i])))
      level = next
    }
    return (this.rootCache = level[0])
  }
}
