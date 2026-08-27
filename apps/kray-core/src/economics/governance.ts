/**
 * Honocracy governance — the neutral, honor-gated VOTING RAIL of KRAY-CORE.
 *
 * "Honra em primeiro pleno." A base primitive, like the star map or the
 * attestation stream: a hash-chained, fsync'd, Bitcoin-anchorable journal of
 * PROPOSALS and VOTES whose tally is a DETERMINISTIC function of the journal —
 * every node re-derives the identical result (born indexed). Each vote is
 * weighted by the voter's Honocracy VOICE:
 *
 *   voice = BASE + w_g·√Glow + w_k·√( min(KRAY, C·Glow + K0) )
 *
 * — honor gates money (a whale with no work is capped at √K0). The (Glow, KRAY,
 * voice) snapshot is COMMITTED into the anchored root and the formula is ENFORCED
 * on apply (voice must equal voice(Glow, KRAY)), so a forged voice can neither be
 * recorded nor anchored — every voice is auditable against the public formula.
 *
 * ONE STAR, ONE VOTE PER PROPOSAL — the fix no token-weighted chain has made,
 * unlocked by KRAY's ordinal identity. The KRAY weight is not a balance snapshot;
 * it is the SPECIFIC numbered stars the voter holds that are still CLEAN (unused)
 * on this proposal. Each vote marks its stars USED for that proposal, so the same
 * star — moved to any wallet, passed around a cartel, borrowed and returned — can
 * never add weight to the same proposal twice. No lock-up, no snapshot freeze:
 * coins move freely; each coin votes once. (Glow is soulbound, so its honor weight
 * already votes once per identity via one-vote-per-identity.)
 *
 * POLICY-AGNOSTIC (protocol-vs-portal): the rail records + tallies + enforces the
 * mechanics (identity, deadline, one-star-one-vote, the formula); what a proposal
 * MEANS and how it enacts is a portal's concern. The immutable economic core is
 * NEVER governed — governance moves the evolvable shell (fees, features, and, the
 * long game, activating a post-quantum scheme on this very rail: the light,
 * fork-free upgrade path that lets KRAY survive every era).
 */
import { appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, truncateSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { voice } from './honocracy.ts'

const GENESIS_HASH = 'kray-gov-genesis'
const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
function canonical(o: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))))
}

/** A contiguous span of numbered stars [start, start+len). */
export interface StarRange { start: bigint; len: bigint }

// ── star-range set arithmetic (BigInt, exact) ───────────────────────────────
export function sumLen(r: StarRange[]): bigint { return r.reduce((a, x) => a + x.len, 0n) }
function serializeRanges(r: StarRange[]): string { return r.filter((x) => x.len > 0n).map((x) => `${x.start}+${x.len}`).join(',') }
function parseRanges(s: string | undefined): StarRange[] {
  if (!s) return []
  return s.split(',').map((p) => { const [a, b] = p.split('+'); return { start: BigInt(a), len: BigInt(b) } })
}
/** `held` minus `used` — the clean sub-spans not yet used on this proposal. */
export function subtractRanges(held: StarRange[], used: StarRange[]): StarRange[] {
  const u = [...used].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const out: StarRange[] = []
  for (const h of held) {
    let cursor = h.start
    const end = h.start + h.len
    for (const r of u) {
      const rEnd = r.start + r.len
      if (rEnd <= cursor) continue
      if (r.start >= end) break
      if (r.start > cursor) out.push({ start: cursor, len: r.start - cursor })
      if (rEnd > cursor) cursor = rEnd
      if (cursor >= end) break
    }
    if (cursor < end) out.push({ start: cursor, len: end - cursor })
  }
  return out
}
/** Coalesced union of two range sets. */
function addRanges(used: StarRange[], add: StarRange[]): StarRange[] {
  const all = [...used, ...add].filter((r) => r.len > 0n).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const merged: StarRange[] = []
  for (const r of all) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.start + last.len) { const end = r.start + r.len; if (end > last.start + last.len) last.len = end - last.start }
    else merged.push({ start: r.start, len: r.len })
  }
  return merged
}
function overlaps(a: StarRange[], b: StarRange[]): boolean {
  for (const x of a) for (const y of b) if (x.start < y.start + y.len && y.start < x.start + x.len) return true
  return false
}

export interface GovEvent {
  seq: number
  prevHash: string
  hash: string
  at: number
  kind: 'propose' | 'vote'
  proposalId: string
  // propose
  title?: string
  proposer?: string
  closesAtInterval?: number
  // vote
  voter?: string
  choice?: string
  interval?: number // the Bitcoin-block interval the vote was cast at (window + audit)
  glow?: string // voter's Glow snapshot
  kray?: string // == the count of CLEAN stars committed (Σ stars)
  voice?: string // == voice(glow, kray), enforced on apply
  stars?: string // the specific clean star ranges committed, "start+len,..."
}

interface ProposalState { title: string; proposer: string; closesAtInterval: number; openedSeq: number }
interface VoteState { choice: string; interval: number; glow: bigint; kray: bigint; voice: bigint }

export interface Tally {
  proposalId: string
  choices: Record<string, string> // choice → total voice
  totalVoice: string
  voters: number
  leader: string | null
}

export class Governance {
  private readonly journalPath: string
  private readonly snapshotPath: string
  private seq = 0
  private lastHash = GENESIS_HASH
  private readonly proposals = new Map<string, ProposalState>()
  private readonly votes = new Map<string, Map<string, VoteState>>()
  private readonly used = new Map<string, StarRange[]>() // proposalId → stars already spent voting
  private rootCache: string | null = null

  constructor(dataDir: string, network: string) {
    mkdirSync(dataDir, { recursive: true })
    this.journalPath = join(dataDir, `kray-gov-${network}.jsonl`)
    this.snapshotPath = join(dataDir, `kray-gov-${network}.json`)
    this.replay()
  }

  private apply(e: GovEvent): void {
    if (e.kind === 'propose') {
      if (this.proposals.has(e.proposalId)) throw new Error(`gov: proposal ${e.proposalId} already exists`)
      this.proposals.set(e.proposalId, { title: e.title!, proposer: e.proposer!, closesAtInterval: e.closesAtInterval!, openedSeq: e.seq })
      this.votes.set(e.proposalId, new Map())
      this.used.set(e.proposalId, [])
    } else {
      const p = this.proposals.get(e.proposalId)
      if (!p) throw new Error(`gov: vote on unknown proposal ${e.proposalId}`)
      const box = this.votes.get(e.proposalId)!
      if (box.has(e.voter!)) throw new Error(`gov: ${e.voter} already voted on ${e.proposalId}`)
      if (typeof e.interval !== 'number' || e.interval > p.closesAtInterval) throw new Error(`gov: vote at interval ${e.interval} past the close ${p.closesAtInterval}`)
      const g = BigInt(e.glow!), k = BigInt(e.kray!), v = BigInt(e.voice!)
      const stars = parseRanges(e.stars)
      if (sumLen(stars) !== k) throw new Error('gov: recorded KRAY weight != committed star count')
      if (voice(g, k) !== v) throw new Error('gov: recorded voice != voice(Glow, KRAY) — the formula is law')
      const usedSet = this.used.get(e.proposalId)!
      if (overlaps(stars, usedSet)) throw new Error('gov: a committed star already voted on this proposal — one star, one vote')
      this.used.set(e.proposalId, addRanges(usedSet, stars))
      box.set(e.voter!, { choice: e.choice!, interval: e.interval, glow: g, kray: k, voice: v })
    }
    this.rootCache = null
  }

  private append(partial: Omit<GovEvent, 'seq' | 'prevHash' | 'hash'>): GovEvent {
    const body = { ...partial, seq: this.seq + 1, prevHash: this.lastHash }
    const hash = sha256hex(this.lastHash + canonical(body))
    const e: GovEvent = { ...body, hash }
    this.apply(e)
    const fd = openSync(this.journalPath, 'a')
    try { appendFileSync(fd, JSON.stringify(e) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
    this.seq = e.seq
    this.lastHash = e.hash
    this.snapshot()
    return e
  }

  private replay(): void {
    if (!existsSync(this.journalPath)) return
    const rawLines = readFileSync(this.journalPath, 'utf8').split('\n')
    let offset = 0
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i]
      const lineStart = offset
      offset += Buffer.byteLength(line, 'utf8') + 1
      if (!line.trim()) continue
      let e: GovEvent
      try {
        e = JSON.parse(line) as GovEvent
      } catch {
        // a torn FINAL line is a crash artifact (never fsync'd/answered) — truncate
        // and carry on; an unparseable NON-final line is corruption.
        if (rawLines.slice(i + 1).some((l) => l.trim())) throw new Error(`gov: JOURNAL CHAIN BROKEN at line ${i + 1} — unparseable non-final line`)
        truncateSync(this.journalPath, lineStart)
        break
      }
      const { hash, ...rest } = e
      if (e.prevHash !== this.lastHash || hash !== sha256hex(this.lastHash + canonical({ ...rest })) || e.seq !== this.seq + 1) {
        throw new Error(`gov: JOURNAL CHAIN BROKEN at seq ${e.seq} — refusing to run`)
      }
      this.apply(e)
      this.seq = e.seq
      this.lastHash = e.hash
    }
    if (existsSync(this.snapshotPath)) {
      try {
        const snap = JSON.parse(readFileSync(this.snapshotPath, 'utf8')) as { lastSeq: number; lastHash: string }
        if (snap.lastSeq > this.seq) throw new Error(`gov: JOURNAL TRUNCATED — snapshot at ${snap.lastSeq}, journal ends ${this.seq}`)
        if (snap.lastSeq === this.seq && snap.lastHash !== this.lastHash) throw new Error('gov: snapshot diverges from journal')
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
    const state = { lastSeq: this.seq, lastHash: this.lastHash, proposals: this.proposals.size }
    const tmp = this.snapshotPath + '.tmp'
    const fd = openSync(tmp, 'w')
    try { writeSync(fd, JSON.stringify(state, null, 2)); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(tmp, this.snapshotPath)
  }

  // ── public surface ───────────────────────────────────────────────────────
  /** Open a proposal (a KIP). Unique id; meaning is a portal's. */
  propose(proposalId: string, title: string, proposer: string, closesAtInterval: number): void {
    this.append({ kind: 'propose', proposalId, title, proposer, closesAtInterval, at: Date.now() })
  }

  /** The clean (unused-on-this-proposal) sub-spans of a voter's held stars. */
  cleanRangesFor(proposalId: string, held: StarRange[]): StarRange[] {
    return subtractRanges(held, this.used.get(proposalId) ?? [])
  }

  /** Record a vote: its KRAY weight is the committed CLEAN star count; voice is
   *  enforced == voice(glow, kray); the stars are marked used for this proposal. */
  recordVote(proposalId: string, voter: string, choice: string, interval: number, glow: bigint, cleanRanges: StarRange[], voiceVal: bigint): void {
    const kray = sumLen(cleanRanges)
    this.append({ kind: 'vote', proposalId, voter, choice, interval, glow: glow.toString(), kray: kray.toString(), voice: voiceVal.toString(), stars: serializeRanges(cleanRanges), at: Date.now() })
  }

  proposalExists(proposalId: string): boolean { return this.proposals.has(proposalId) }
  proposalOf(proposalId: string): { title: string; proposer: string; closesAtInterval: number } | null {
    const p = this.proposals.get(proposalId)
    return p ? { title: p.title, proposer: p.proposer, closesAtInterval: p.closesAtInterval } : null
  }
  hasVoted(proposalId: string, voter: string): boolean { return this.votes.get(proposalId)?.has(voter) ?? false }
  /** Stars already spent voting on a proposal (coalesced). */
  usedStarsOf(proposalId: string): StarRange[] { return (this.used.get(proposalId) ?? []).map((r) => ({ start: r.start, len: r.len })) }
  /** How many CLEAN stars a holding would contribute to a proposal right now. */
  cleanCount(proposalId: string, held: StarRange[]): bigint { return sumLen(this.cleanRangesFor(proposalId, held)) }
  get proposalCount(): number { return this.proposals.size }
  get journalLength(): number { return this.seq }
  get chainHead(): string { return this.lastHash }

  tally(proposalId: string): Tally {
    const box = this.votes.get(proposalId)
    if (!box) throw new Error(`gov: no such proposal ${proposalId}`)
    const choices: Record<string, bigint> = {}
    let total = 0n
    for (const v of box.values()) { choices[v.choice] = (choices[v.choice] ?? 0n) + v.voice; total += v.voice }
    let leader: string | null = null, best = -1n, tie = false
    for (const [choice, v] of Object.entries(choices)) {
      if (v > best) { best = v; leader = choice; tie = false }
      else if (v === best) tie = true
    }
    return { proposalId, choices: Object.fromEntries(Object.entries(choices).map(([k, v]) => [k, v.toString()])), totalVoice: total.toString(), voters: box.size, leader: tie ? null : leader }
  }

  /** Root of all proposals + votes (glow/kray/voice/stars committed) — anchorable. */
  merkleRoot(): string {
    if (this.rootCache !== null) return this.rootCache
    const leaves: string[] = []
    for (const id of [...this.proposals.keys()].sort()) {
      const p = this.proposals.get(id)!
      leaves.push(sha256hex(`prop|${id}|${p.proposer}|${p.closesAtInterval}|${p.openedSeq}|${p.title}`))
      const box = this.votes.get(id)!
      const usedSet = this.used.get(id)!
      for (const voter of [...box.keys()].sort()) {
        const v = box.get(voter)!
        leaves.push(sha256hex(`vote|${id}|${voter}|${v.choice}|${v.interval}|${v.glow}|${v.kray}|${v.voice}`))
      }
      // commit the used-star set too, so double-vote prevention is anchored
      leaves.push(sha256hex(`used|${id}|${serializeRanges(usedSet)}`))
    }
    if (leaves.length === 0) return (this.rootCache = sha256hex('kray-gov-empty'))
    let level = leaves
    while (level.length > 1) {
      const next: string[] = []
      for (let i = 0; i < level.length; i += 2) next.push(sha256hex(level[i] + (i + 1 < level.length ? level[i + 1] : level[i])))
      level = next
    }
    return (this.rootCache = level[0])
  }
}
