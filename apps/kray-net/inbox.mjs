/**
 * THE PUBLIC INBOX (ADR-3 · slice 3b) — a mailbox of SIGNED ACTS, never a second door.
 *
 * A signed act is already a self-contained public object: the domain-separated, network-bound,
 * nonced message plus its BIP-340 / ML-DSA signature. This module only STORES those blobs and
 * hands them back for draining — it applies nothing, verifies nothing, journals nothing. Every
 * act that leaves the inbox goes through the ONE existing door (`/api/kraynet/submit`), so the
 * Supreme Law's checks run identically whether an act arrives live or from this mailbox.
 *
 * Why it exists: today an act a citizen signed dies with the writer's process if it was never
 * submitted. With the inbox, any node that heard the act holds it durably and the writer drains
 * it when it returns — the act survives the outage, the fee still charges at apply, and a
 * duplicate drain is refused by the account nonce (end-to-end idempotent).
 *
 * SECURITY MODEL (after the adversarial council of 2026-08-19). The inbox admits blobs it cannot
 * verify (only the door's reducer can), so its ONLY defenses against free spam are byte/count caps
 * and the caller's per-IP rate limit — NOT any property of the unauthenticated `from`. An earlier
 * per-address cap was removed: keyed on a forgeable `from`, it was a censorship lever (fill a
 * victim's quota under their address, lock them out), never a real spam defense. Terminal state is
 * reclaimed on a retention TTL so unverified junk cannot fill the disk the journal shares. An
 * in-memory pending index keeps status/accept O(1) and pending(limit) O(limit·log), so a cheap
 * reader cannot make the node parse the whole mailbox on the event loop. Fail-closed throughout:
 * per-act byte cap, atomic tmp+rename+fsync, ids are the act's own SHA-256 (never client-named).
 */
import { createHash } from 'node:crypto'
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const ID_RE = /^[0-9a-f]{64}$/
const MAX_DEPTH = 64
const SEATS = ['pending', 'applied', 'refused', 'superseded']

/** Deterministic JSON: sorted keys, depth-capped so a nesting bomb is refused, not recursed into. */
export function stableStringify(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error('act nests deeper than any honest act ever does')
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map((v) => stableStringify(v === undefined ? null : v, depth + 1)).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.filter((k) => value[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k], depth + 1)).join(',') + '}'
}

export function actId(act) { return createHash('sha256').update(stableStringify(act)).digest('hex') }

function writeAtomic(path, bytes) {
  const tmp = path + '.tmp'
  writeFileSync(tmp, bytes)
  const fd = openSync(tmp, 'r+')
  try { fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmp, path)
}

function readEnvelope(dir, id) {
  try { return JSON.parse(readFileSync(join(dir, id + '.json'), 'utf8')) } catch { return null }
}

/**
 * One inbox on disk: `<dir>/{pending,applied,refused,superseded}/<sha256(act)>.json`.
 * Caps refuse new acts when full (429-shaped) — an inbox never evicts someone else's act to fit yours.
 * Terminal dirs (applied/refused/superseded) are reclaimed on `retentionSec` so junk cannot fill the disk.
 */
export function createInbox({
  dir, maxActBytes = 30 * 1024 * 1024, maxPending = 10_000, maxPendingBytes = 512 * 1024 * 1024,
  refusedRetentionSec = 3600, appliedRetentionSec = 6 * 3600,
}) {
  const D = Object.fromEntries(SEATS.map((s) => [s, join(dir, s)]))
  for (const s of SEATS) mkdirSync(D[s], { recursive: true })
  const P = D.pending

  const idsIn = (d) => readdirSync(d).filter((f) => f.endsWith('.json') && ID_RE.test(f.slice(0, -5))).map((f) => f.slice(0, -5))

  // THE PENDING INDEX (in memory) — {id -> {from, bytes, receivedAt}} for every pending act, so the
  // caps and status are O(1) and a reader can never force a full-mailbox parse on the event loop.
  // Rebuilt once at construction (bounded by maxPending); maintained on every add/remove below.
  const pend = new Map()
  let pendingBytes = 0
  const idxAdd = (id, meta) => { if (!pend.has(id)) { pend.set(id, meta); pendingBytes += meta.bytes } }
  const idxDel = (id) => { const m = pend.get(id); if (m) { pend.delete(id); pendingBytes -= m.bytes } }
  for (const id of idsIn(P)) {
    const env = readEnvelope(P, id)
    if (env) idxAdd(id, { from: env.act && env.act.from, bytes: Buffer.byteLength(JSON.stringify(env)), receivedAt: env.receivedAt || 0 })
  }

  const whereIs = (id) => SEATS.find((s) => existsSync(join(D[s], id + '.json'))) || null

  /** Accept a signed act blob. Static shape + caps only — NO application, NO signature check here
   *  (the door re-checks everything on drain; a mailbox that pre-judged would be a second door). */
  function accept(act) {
    if (!act || typeof act !== 'object' || Array.isArray(act)) return { ok: false, code: 400, error: 'an act is a JSON object' }
    if (typeof act.action !== 'string' || !act.action) return { ok: false, code: 400, error: 'an act names its {action}' }
    if (typeof act.from !== 'string' || !act.from) return { ok: false, code: 400, error: 'an act names its {from} address' }
    const signed = (typeof act.signature === 'string' && act.signature) || (typeof act.lamportSignature === 'string' && act.lamportSignature)
    if (!signed) return { ok: false, code: 400, error: 'the inbox holds SIGNED acts only — sign first, mail second (an unsigned act could never apply anyway)' }
    let canonical
    try { canonical = stableStringify(act) } catch (e) { return { ok: false, code: 400, error: e instanceof Error ? e.message : String(e) } }
    const bytes = Buffer.from(canonical)
    if (bytes.length > maxActBytes) return { ok: false, code: 413, error: `this act is ${bytes.length} bytes — over the ${maxActBytes}-byte inbox cap` }
    const id = createHash('sha256').update(bytes).digest('hex')
    const seat = whereIs(id)
    if (seat) return { ok: true, id, duplicate: true, status: seat }
    // Global caps only. There is deliberately NO per-address cap: `from` is unauthenticated here, so
    // a per-address quota would let an attacker lock a victim out under the victim's own address.
    // Real spam control is the caller's per-IP rate limit plus these global ceilings.
    if (pend.size >= maxPending) return { ok: false, code: 429, error: `the inbox holds ${pend.size} pending act(s) — full; retry after a drain` }
    if (pendingBytes + bytes.length > maxPendingBytes) return { ok: false, code: 429, error: 'the inbox is out of room — retry after a drain' }
    const envStr = JSON.stringify({ id, receivedAt: Math.floor(Date.now() / 1000), attempts: 0, act })
    writeAtomic(join(P, id + '.json'), envStr)
    idxAdd(id, { from: act.from, bytes: Buffer.byteLength(envStr), receivedAt: Math.floor(Date.now() / 1000) })
    return { ok: true, id, duplicate: false, status: 'pending' }
  }

  function status() {
    return { pending: pend.size, pendingBytes, applied: idsIn(D.applied).length, refused: idsIn(D.refused).length, superseded: idsIn(D.superseded).length }
  }

  /** FIFO: oldest receivedAt first, id as the deterministic tiebreak. O(limit) reads — only the
   *  slice is parsed from disk; ordering uses the in-memory index, never a full-mailbox scan. */
  function pending(limit = 100) {
    const ordered = [...pend.entries()]
      .sort((a, b) => (a[1].receivedAt - b[1].receivedAt) || (a[0] < b[0] ? -1 : 1))
      .slice(0, limit === Infinity ? undefined : limit)
    const out = []
    for (const [id] of ordered) { const env = readEnvelope(P, id); if (env) out.push(env) }
    return out
  }

  function lookup(id) {
    const clean = String(id)
    if (!ID_RE.test(clean)) return { seat: null, envelope: null }
    const seat = whereIs(clean)
    if (!seat) return { seat: null, envelope: null }
    return { seat, envelope: readEnvelope(D[seat], clean) }
  }

  /** Move a pending act to a terminal seat, atomically, updating the index. */
  function terminate(id, seat, extra) {
    const env = readEnvelope(P, id); if (!env) return false
    writeAtomic(join(D[seat], id + '.json'), JSON.stringify({ ...env, ...extra }))
    unlinkSync(join(P, id + '.json'))
    idxDel(id)
    return true
  }

  const markApplied = (id, outcome) => terminate(id, 'applied', { appliedAt: Math.floor(Date.now() / 1000), outcome })
  const markRefused = (id, reason) => terminate(id, 'refused', { refusedAt: Math.floor(Date.now() / 1000), reason })
  /** The account nonce already moved past this act — some act consumed its nonce. NOT a failure: the
   *  intent is in the journal. A distinct terminal so a crash between the door's fsync and markApplied
   *  never mislabels an APPLIED act as 'refused' (the exact outage window this module exists for). */
  const markSuperseded = (id, note) => terminate(id, 'superseded', { supersededAt: Math.floor(Date.now() / 1000), note: note || 'the account nonce already advanced past this act — its intent is in the journal' })

  /** Record a failed drain attempt; refuse after maxAttempts (a hostile act must not squat the pipe). */
  function markAttempt(id, error, maxAttempts = 10) {
    const env = readEnvelope(P, id); if (!env) return false
    env.attempts = (env.attempts || 0) + 1
    env.lastError = String(error).slice(0, 500)
    env.lastAttemptAt = Math.floor(Date.now() / 1000)
    if (env.attempts >= maxAttempts) { markRefused(id, `refused after ${env.attempts} drain attempts — last: ${env.lastError}`); return false }
    const envStr = JSON.stringify(env)
    writeAtomic(join(P, id + '.json'), envStr)
    const m = pend.get(id); if (m) { pendingBytes += Buffer.byteLength(envStr) - m.bytes; m.bytes = Buffer.byteLength(envStr) }
    return true
  }

  /** Expire pending acts older than ttlSec into refused/, AND reclaim terminal seats past their
   *  retention so unverified junk (and old receipts) can never fill the disk the journal shares. */
  function sweep(ttlSec) {
    const now = Math.floor(Date.now() / 1000)
    let expired = 0
    for (const env of pending(Infinity)) {
      if (now - (env.receivedAt || 0) > ttlSec) { if (markRefused(env.id, `expired after ${ttlSec}s in the inbox`)) expired++ }
    }
    reclaim(D.refused, refusedRetentionSec, now)
    reclaim(D.applied, appliedRetentionSec, now)
    reclaim(D.superseded, appliedRetentionSec, now)
    return expired
  }

  /** Delete terminal files older than retention (by mtime — cheap, no parse). The journal is the
   *  truth; an inbox receipt is ephemeral, so an expired GET /inbox/<id> is a plain 404. */
  function reclaim(d, retentionSec, now) {
    for (const id of idsIn(d)) {
      try { if (now - Math.floor(statSync(join(d, id + '.json')).mtimeMs / 1000) >= retentionSec) unlinkSync(join(d, id + '.json')) } catch { /* raced another sweep */ }
    }
  }

  return { accept, status, pending, lookup, markApplied, markRefused, markSuperseded, markAttempt, sweep, actId }
}
