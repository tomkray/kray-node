/**
 * THE BOOK GATE — what a remote signer (a guardian, and since 2026-09-18 the pen too) asks its OWN
 * replayed book before it lends a signature to a pot payout. Ported from the guardian daemon so the
 * pen runs the very same law; the daemons are thin I/O around this module.
 *
 *   1 · LAG ≠ THEFT (custody rung 2): if the writer names the exit's journal seq (minSeal) and the
 *       signer's own book is BEHIND it, answer 503 "lagging" — a liveness condition the quorum
 *       tolerates and retries — never a refusal, never a sign while behind.
 *   2 · MONOTONIC HEAD (custody rung 3): before reading a single balance, prove the book's current
 *       verified history still descends from the last head this signer signed against (and from the
 *       last anchored root it saw). A history that no longer passes through that root is a rewrite —
 *       EQUIVOCATION — a hard 403 that never auto-clears. A book that cannot answer is a 503 fault.
 *   3 · THE BALANCE: every exiter must HOLD (spendable + locked) ≥ what they withdraw, per THIS
 *       signer's own book. An unknown balance is a refusal (fail-closed). The predicate itself lives
 *       in pot-signer.ts; this module fetches the numbers from the book.
 *   4 · CONFIRM (anti-TOCTOU): the balances must come from the SAME verified snapshot the gate
 *       judged; a book that swapped snapshots mid-request answers 503 and the writer retries.
 *
 * Everything here is fail-closed: the only way to a signature is a book that answered, descends from
 * the signer's memory, is at or past the exit, and covers it.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

export interface SignerHead { seq: number; root: string; anchoredRoot: string | null }
export interface Lineage {
  known: boolean
  /** where the QUERIED root sits in the current history (null when unknown) */
  seq: number | null
  head: { seq: number; root: string }
  lastProvenAnchor: { root: string; seq: number } | null
}
export interface GateOk {
  ok: true
  /** the book head captured by this gate — the head persisted on a successful sign */
  gateHead: { seq: number; root: string } | null
  /** the deepest anchor the book re-proved, ratcheted forward only */
  gateAnchor: { root: string; seq: number } | null
  lineageSupported: boolean
}
export interface GateFault {
  ok: false
  status: 403 | 503
  lagging?: true
  equivocation?: true
  reason: string
  bookSeq?: number | null
  minSeal?: number
}

const HEX64 = /^[0-9a-f]{64}$/

async function getJson(url: string, ms: number): Promise<{ status: number; json: unknown } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) })
    if (r.status === 404) return { status: 404, json: null }
    if (!r.ok) return null
    return { status: r.status, json: await r.json() }
  } catch { return null }
}

/** Ask the OWN book's /lineage/<root> — {known, seq, head, lastProvenAnchor}. 404 = a pre-rung-3 follower
 *  ({unsupported}); unreachable/malformed = null. Both are liveness answers, never a verdict. */
export async function fetchLineage(bookUrl: string, root: string): Promise<Lineage | { unsupported: true } | null> {
  const r = await getJson(`${bookUrl}/api/kraynet/lineage/${root}`, 6000)
  if (!r) return null
  if (r.status === 404) return { unsupported: true }
  const j = r.json as { known?: unknown; seq?: unknown; head?: { seq?: unknown; root?: unknown }; lastProvenAnchor?: { root?: unknown; seq?: unknown } | null } | null
  if (!j || typeof j.known !== 'boolean' || !j.head || !HEX64.test(String(j.head.root || '').toLowerCase())) return null
  return {
    known: j.known,
    seq: Number.isFinite(Number(j.seq)) ? Number(j.seq) : null,
    head: { seq: Number(j.head.seq) || 0, root: String(j.head.root).toLowerCase() },
    lastProvenAnchor: j.lastProvenAnchor && HEX64.test(String(j.lastProvenAnchor.root || '').toLowerCase())
      ? { root: String(j.lastProvenAnchor.root).toLowerCase(), seq: Number(j.lastProvenAnchor.seq) || 0 }
      : null,
  }
}

/** Bootstrap head capture — works even against a pre-rung-3 follower (its /head already names cascadeRoot). */
export interface BookHeadSnapshot {
  seq: number
  root: string
  network: string | null
  /** the follower could not replace its snapshot (the stale law): it serves the last VERIFIED one */
  stale: boolean
  /** the follower saw a verified history that does NOT extend its previous snapshot (a fork it labelled) */
  prefixBreak: boolean
}
export async function bookHeadSnapshot(bookUrl: string): Promise<BookHeadSnapshot | null> {
  const r = await getJson(`${bookUrl}/api/kraynet/head`, 5000)
  if (!r || r.status === 404) return null
  const j = r.json as { seq?: unknown; cascadeRoot?: unknown; network?: unknown; stale?: unknown; prefixBreak?: unknown } | null
  if (!j || typeof j !== 'object' || !Number.isFinite(Number(j.seq))) return null
  const rawRoot = String(j.cascadeRoot || '').toLowerCase()
  const root = HEX64.test(rawRoot) ? rawRoot : ''   // '' = a pre-rung-3 book that names no root (the seq still counts)
  return {
    seq: Number(j.seq) || 0, root,
    network: j && typeof j.network === 'string' ? j.network : null,
    stale: !!(j && j.stale === true),
    prefixBreak: !!(j && j.prefixBreak),
  }
}

/** The OPEN lock the book shows for (from, runeId): undefined = the book does not expose locks (pre-v2
 *  follower: no `locked` key at all on a holding), null = no open lock, else {amount, l1Address}. */
export async function fetchBookLock(bookUrl: string, from: string, runeId: string): Promise<{ amount: bigint; l1Address: string } | null | undefined> {
  const r = await getJson(`${bookUrl}/api/kraynet/runes/of/${encodeURIComponent(from)}`, 6000)
  if (!r || r.status === 404) return undefined
  const j = r.json as { runes?: unknown[]; data?: unknown[] } | null
  const list = ((j && (j.runes || j.data)) || []) as Array<Record<string, unknown>>
  const hit = list.find((x) => (x.id || x.runeId || x.rune) === runeId)
  if (!hit) return null
  if (!Object.prototype.hasOwnProperty.call(hit, 'locked')) return undefined   // a pre-v2 follower never names locks
  const lk = hit.locked as { amount?: unknown; l1Address?: unknown } | string | null | undefined
  if (lk == null || lk === '') return null                                      // a v2 follower says: no open lock
  if (typeof lk === 'object' && lk.amount != null && typeof lk.l1Address === 'string') {
    try { return { amount: BigInt(String(lk.amount).split('.')[0] || '0'), l1Address: lk.l1Address } } catch { return null }
  }
  return undefined   // a legacy string-only `locked` names no destination: the lock check cannot run here
}

/** Prefetch every OPEN lock the bundle needs (sync lookup for the signer; absent pair → undefined). */
export async function bookLocks(bookUrl: string, body: { exit?: unknown; exits?: unknown }): Promise<(from: string, runeId: string) => { amount: bigint; l1Address: string } | null | undefined> {
  const locks = new Map<string, { amount: bigint; l1Address: string } | null | undefined>()
  for (const p of exitPairs(body)) locks.set(p.from.toLowerCase() + '|' + p.runeId, await fetchBookLock(bookUrl, p.from, p.runeId))
  return (from, runeId) => locks.get(String(from).toLowerCase() + '|' + String(runeId))
}

/** The signer's own book: the exiter's claim is spendable + LOCKED (once the book replays the rune-exit the
 *  credits sit in the lock — counting only the spendable slice would refuse every honest full-balance
 *  withdraw the moment the book syncs past its own exit event). null = the book could not answer. */
export async function fetchBookBalance(bookUrl: string, from: string, runeId: string): Promise<bigint | null> {
  const r = await getJson(`${bookUrl}/api/kraynet/runes/of/${encodeURIComponent(from)}`, 6000)
  if (!r || r.status === 404) return null
  const j = r.json as { runes?: unknown[]; data?: unknown[] } | null
  const list = (j && (j.runes || j.data)) || []
  const hit = (list as Array<Record<string, unknown>>).find((x) => (x.id || x.runeId || x.rune) === runeId)
  if (!hit) return 0n
  const raw = hit.amount ?? hit.balance ?? hit.qty ?? hit.value ?? 0
  const spendable = BigInt(String(raw).split('.')[0] || '0')
  let locked = 0n
  const lk = hit.locked as unknown
  if (lk != null && typeof lk === 'object' && (lk as { amount?: unknown }).amount != null) {
    locked = BigInt(String((lk as { amount: unknown }).amount).split('.')[0] || '0')
  } else if (lk != null && lk !== '') {
    try { locked = BigInt(String(lk).split('.')[0] || '0') } catch { locked = 0n }
  }
  return spendable + locked
}

/** Every (from, runeId) a bundle wants to move — the single exit plus each loaf rider. */
export function exitPairs(body: { exit?: unknown; exits?: unknown }): Array<{ from: string; runeId: string }> {
  const map = new Map<string, { from: string; runeId: string }>()
  const add = (e: unknown): void => {
    const x = e as { from?: unknown; runeId?: unknown } | null
    if (x && x.from && x.runeId) map.set(String(x.from).toLowerCase() + '|' + String(x.runeId), { from: String(x.from), runeId: String(x.runeId) })
  }
  add(body.exit)
  if (Array.isArray(body.exits)) for (const e of body.exits) add(e)
  return [...map.values()]
}

/** Prefetch every balance the bundle needs, then hand the signer a sync lookup (absent → null → refusal). */
export async function bookBalances(bookUrl: string, body: { exit?: unknown; exits?: unknown }): Promise<(from: string, runeId: string) => bigint | null> {
  const balances = new Map<string, bigint | null>()
  for (const p of exitPairs(body)) balances.set(p.from.toLowerCase() + '|' + p.runeId, await fetchBookBalance(bookUrl, p.from, p.runeId))
  return (from, runeId) => { const v = balances.get(String(from).toLowerCase() + '|' + String(runeId)); return v === undefined ? null : v }
}

/** Rung 2: a book behind the exit's seq cannot judge yet → 503 lagging (retriable), never a sign. */
export async function lagGate(bookUrl: string, minSeal: number, who = 'signer'): Promise<GateFault | null> {
  const snap = await bookHeadSnapshot(bookUrl)
  // the follower's own honesty labels come first: a snapshot it could not replace is a liveness fault (503), a
  // history that broke its prefix is a fork this signer will not judge (403) — regardless of minSeal
  if (snap && snap.prefixBreak) return { ok: false, status: 403, equivocation: true, reason: `the ${who} book labelled its history a PREFIX BREAK (a fork it adopted under KRAY_FOLLOW_PREFIX=warn) — this ${who} will not judge on it; a person inspects` }
  if (snap && snap.stale) return { ok: false, status: 503, lagging: true, bookSeq: snap.seq, minSeal, reason: `the ${who} book is STALE (serving its last verified snapshot at seq ${snap.seq}) — cannot judge; retry` }
  if (!(minSeal > 0)) return null
  const bookSeq = snap ? snap.seq : null
  if (bookSeq == null || bookSeq < minSeal) {
    return { ok: false, status: 503, lagging: true, bookSeq, minSeal, reason: `book at seq ${bookSeq ?? 'unreachable'} — the exit needs seq ${minSeal}; this ${who} cannot judge yet (lagging, retry)` }
  }
  return null
}

/** Rung 3: descendance from the persisted head (and the anchored root), or bootstrap the memory. */
export async function headGate(bookUrl: string, lastHead: SignerHead | null, who = 'signer'): Promise<GateOk | GateFault> {
  if (lastHead) {
    const lin = await fetchLineage(bookUrl, lastHead.root)
    if (!lin) return { ok: false, status: 503, lagging: true, reason: `the ${who} book cannot answer lineage (unreachable) — cannot judge descendance; retry` }
    if ('unsupported' in lin) return { ok: false, status: 503, lagging: true, reason: `the ${who} book pre-dates the lineage route (custody rung 3) — update the follower on this box; retry` }
    if (lin.known !== true) {
      return { ok: false, status: 403, equivocation: true, reason: `EQUIVOCATION: the book's current history (head seq ${lin.head.seq}) does not pass through the last signed root ${lastHead.root.slice(0, 12)}… (seq ${lastHead.seq}) — a rewrite or fork; this ${who} holds until a person inspects (delete the head file only as a conscious rite)` }
    }
    let keptAnchorSeq = -1
    if (lastHead.anchoredRoot) {
      const lin2 = await fetchLineage(bookUrl, lastHead.anchoredRoot)
      if (!lin2 || 'unsupported' in lin2) return { ok: false, status: 503, lagging: true, reason: `the ${who} book cannot answer anchored-root lineage — cannot judge; retry` }
      if (lin2.known !== true) {
        return { ok: false, status: 403, equivocation: true, reason: `EQUIVOCATION: the book's current history abandons the anchored root ${lastHead.anchoredRoot.slice(0, 12)}… this ${who} accepted — a rewrite past a Bitcoin anchor; held until a person inspects` }
      }
      keptAnchorSeq = lin2.seq ?? -1
    }
    // the anchored root only RATCHETS forward: adopt the book's deepest proven anchor only when it sits
    // DEEPER (higher seq in this same history) than the one already held.
    const gateAnchor = lin.lastProvenAnchor && lin.lastProvenAnchor.seq > keptAnchorSeq
      ? lin.lastProvenAnchor
      : (lastHead.anchoredRoot ? { root: lastHead.anchoredRoot, seq: keptAnchorSeq } : lin.lastProvenAnchor)
    return { ok: true, gateHead: lin.head, gateAnchor, lineageSupported: true }
  }
  // Bootstrap (no persisted head yet): capture the book's head now so the FIRST sign plants the memory.
  const snap = await bookHeadSnapshot(bookUrl)
  const gateHead = snap && snap.root ? { seq: snap.seq, root: snap.root } : null   // no root = nothing to remember
  let gateAnchor: { root: string; seq: number } | null = null
  let lineageSupported = false
  if (gateHead) {
    const lin = await fetchLineage(bookUrl, gateHead.root)
    if (lin && !('unsupported' in lin)) { gateAnchor = lin.lastProvenAnchor; lineageSupported = true }
  }
  return { ok: true, gateHead, gateAnchor, lineageSupported }
}

/** Rung 4 (anti-TOCTOU): the balances just read must come from the SAME snapshot the gate judged. */
export async function confirmSnapshot(bookUrl: string, gate: GateOk, who = 'signer'): Promise<GateFault | null> {
  if (!gate.lineageSupported || !gate.gateHead) return null
  const again = await fetchLineage(bookUrl, gate.gateHead.root)
  if (!again || 'unsupported' in again) return { ok: false, status: 503, lagging: true, reason: `the ${who} book stopped answering lineage mid-request — retry` }
  if (again.known !== true || again.head.root !== gate.gateHead.root) {
    return { ok: false, status: 503, lagging: true, reason: `the ${who} book advanced or swapped its snapshot mid-request — the balances and the head gate must agree; retry` }
  }
  return null
}

/** The memory to persist after a REAL sign: the gate's head, the anchored root ratcheted forward. */
export function nextHead(gate: GateOk, lastHead: SignerHead | null): SignerHead | null {
  if (!gate.gateHead) return null
  return {
    seq: gate.gateHead.seq, root: gate.gateHead.root,
    anchoredRoot: (gate.gateAnchor && gate.gateAnchor.root) || (lastHead && lastHead.anchoredRoot) || null,
  }
}

export function loadHeadFile(path: string): SignerHead | null {
  try {
    if (!existsSync(path)) return null
    const j = JSON.parse(readFileSync(path, 'utf8')) as { seq?: unknown; root?: unknown; anchoredRoot?: unknown }
    if (!j || !HEX64.test(String(j.root || '').toLowerCase())) return null
    return {
      seq: Number(j.seq) || 0,
      root: String(j.root).toLowerCase(),
      anchoredRoot: HEX64.test(String(j.anchoredRoot || '').toLowerCase()) ? String(j.anchoredRoot).toLowerCase() : null,
    }
  } catch { return null }   // unreadable — the gate simply has no memory to hold (bootstrap)
}

export function saveHeadFile(path: string, head: SignerHead): void {
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify({ ...head, updatedAt: new Date().toISOString() }, null, 2) + '\n')
  renameSync(tmp, path)   // atomic swap — a crash mid-write never leaves a corrupt head
}
