/**
 * WINDOW ORDER (ADR-3 · slice 3c — the deterministic window) — order is arithmetic, not a writer's choice.
 *
 * The single writer today assigns global order by arrival (`store.ts` `append`): it cannot forge a
 * signature or rewrite an anchored past, but it CAN reorder or silently refuse (Article XI, a NAMED
 * PATH). This module is the pure ordering rule that turns "which order?" into a function of the acts
 * themselves, so two independent writers holding the SAME set of signed acts derive the byte-identical
 * journal and the same cascade root — no cartel, no committee, no central sequencer. It is the seed of
 * "the pen is a race, not a machine": whoever assembles the window computes the same book as everyone else.
 *
 * THE RULE (Bitcoin-shaped), stated so a SECOND implementation converges with this one byte-for-byte:
 *   1. ADMISSION. An act enters the window only if its signature verifies (`isValid`). This is not
 *      optional: an act that can never apply must never occupy a nonce slot — otherwise a forger who
 *      grinds an invalid act onto an account's next nonce would evict that account's real chain every
 *      window, forever, and (because every writer computes the identical censored book) the censorship
 *      would masquerade as consensus. Admission mirrors the reducer's own law: check the signature FIRST.
 *   2. IDENTITY / TIEBREAK. Each admitted act's order key is `keyOf(act)` — the hash of the bytes the
 *      author's signature ACTUALLY commits (the canonical signed message), never the signature itself
 *      or any unsigned envelope field (`action`, `at`, `fee`, `scheme`). So the key cannot be reground
 *      cheaply while the act stays valid: to change your key you must change what you signed. Two acts
 *      with the same signed identity but different signatures collapse to ONE act (same authorised
 *      intent); a genuine double-spend signs a different message, so it keeps a distinct key.
 *   3. SCHEDULE (greedy, canonical). Repeatedly take the smallest-key act that is currently ELIGIBLE —
 *      a nonce-free act (a donation keyed by its Bitcoin outpoint) is eligible at once; a nonced act is
 *      eligible when its nonce equals the one its account currently expects (reducer law:
 *      `nonce === nonceOf(from)`). Appending it advances that account's expected nonce, which may make
 *      its next act eligible. Whatever is never eligible (a nonce gap, or a nonce a sibling act already
 *      claimed) is DEFERRED — not applied, not destroyed; a later window may take it.
 *
 * The result is a pure function of (the admitted act set, the starting nonces). Feed `ordered` to the
 * reducer and the journal + root are deterministic; the reducer still refuses any act that fails a later
 * law (balance, conservation) in that fixed order — identically on every writer, exactly as Bitcoin's
 * block order decides tx validity. This module ONLY orders; it applies nothing and is wired into no live
 * path yet — it is the proven primitive the succession rule (3e) will stand on. Nothing here touches the
 * live single writer. `keyOf` and `isValid` are REQUIRED (no grindable default): the caller — which has
 * the signature scheme and the per-kind signed message — supplies both.
 */
import { createHash } from 'node:crypto'

const MAX_DEPTH = 64

/** Deterministic JSON: sorted keys, `undefined` dropped, depth-capped so a nesting bomb is refused.
 *  Byte-for-byte identical for the same value on any machine. A utility — NOT the consensus order key
 *  (that must be over signed bytes only; see `keyFromSignedMessage`). */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) throw new Error('value nests deeper than any honest act ever does')
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalJson(v === undefined ? null : v, depth + 1)).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.filter((k) => obj[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k], depth + 1)).join(',') + '}'
}

/** The within-window order key: the SHA-256 of the exact bytes the author signed. Ungrindable — to move
 *  your key you must change what you signed (and thus your act's meaning). This is the ONLY safe tiebreak. */
export function keyFromSignedMessage(signedMessage: string): string {
  return createHash('sha256').update(signedMessage, 'utf8').digest('hex')
}

export interface SignedAct { from?: string; nonce?: number;[k: string]: unknown }

export interface WindowOrder<T extends SignedAct> {
  /** the acts that make this window, in the one objective order every writer computes */
  ordered: T[]
  /** admitted acts that never became eligible (nonce gap, or a nonce a sibling act already claimed) */
  deferred: T[]
  /** acts refused ADMISSION — signature did not verify; they never touched a nonce slot */
  rejected: T[]
}

export interface WindowRules<T extends SignedAct> {
  /** the account's expected nonce at the START of the window (the anchored prior state both writers share) */
  nonceOf: (addr: string) => number
  /** the ungrindable order key: hash of the bytes the signature commits — use `keyFromSignedMessage` */
  keyOf: (act: T) => string
  /** true iff the act's signature verifies. An act that fails is rejected before it can occupy a nonce slot */
  isValid: (act: T) => boolean
}

/** A tiny binary min-heap over string keys — the greedy schedule's engine, O(log n) per op. */
class MinHeap<T> {
  private a: { k: string; v: T }[] = []
  get size(): number { return this.a.length }
  push(k: string, v: T): void {
    const a = this.a; a.push({ k, v })
    let i = a.length - 1
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].k <= a[i].k) break;[a[p], a[i]] = [a[i], a[p]]; i = p }
  }
  pop(): { k: string; v: T } | undefined {
    const a = this.a; if (a.length === 0) return undefined
    const top = a[0], last = a.pop()!
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].k < a[m].k) m = l; if (r < a.length && a[r].k < a[m].k) m = r; if (m === i) break;[a[m], a[i]] = [a[i], a[m]]; i = m } }
    return top
  }
}

/**
 * Order one window's acts deterministically. Pure: the same admitted set + the same starting nonces ⇒
 * the identical `ordered` on any machine and any second implementation of the RULE above, regardless of
 * the input array's arrival order. `keyOf` MUST hash only signed bytes; `isValid` MUST verify the signature.
 */
export function orderWindow<T extends SignedAct>(acts: readonly T[], rules: WindowRules<T>): WindowOrder<T> {
  const { nonceOf, keyOf, isValid } = rules

  // 1 · ADMISSION — reject anything whose signature does not verify (it can never apply; letting it hold
  //     a nonce slot would let a forger censor an account forever). Rejected acts never enter the schedule.
  const rejected: T[] = []
  const admitted: { key: string; act: T }[] = []
  for (const a of acts) {
    if (!isValid(a)) { rejected.push(a); continue }
    admitted.push({ key: keyOf(a), act: a })
  }

  // 2 · IDENTITY — dedup by signed-identity key (two signatures of one signed message are ONE act).
  const byKey = new Map<string, T>()
  for (const { key, act } of admitted) if (!byKey.has(key)) byKey.set(key, act)

  // Index the min-key act per (account, nonce), so a double-spend at one nonce resolves to a single
  // deterministic candidate (the smaller key), and the loser stays deferred.
  const candidate = new Map<string, Map<number, { key: string; act: T }>>()   // from -> nonce -> min-key act
  const nonceFree: { key: string; act: T }[] = []
  for (const [key, act] of byKey) {
    if (typeof act.nonce === 'number') {
      if (typeof act.from !== 'string' || !act.from) continue   // a nonced act without an author can never apply
      let byNonce = candidate.get(act.from); if (!byNonce) { byNonce = new Map(); candidate.set(act.from, byNonce) }
      const cur = byNonce.get(act.nonce)
      if (!cur || key < cur.key) byNonce.set(act.nonce, { key, act })
    } else {
      nonceFree.push({ key, act })
    }
  }

  // 3 · SCHEDULE — greedy: always take the smallest-key ELIGIBLE act. A min-heap holds the current
  //     frontier (all nonce-free acts + each account's expected-nonce candidate); taking a nonced act
  //     pushes that account's next-nonce candidate. Canonical: prose and code are the SAME function.
  const expected = new Map<string, number>()
  const need = (from: string): number => { if (!expected.has(from)) expected.set(from, nonceOf(from)); return expected.get(from)! }
  const heap = new MinHeap<T>()
  for (const { key, act } of nonceFree) heap.push(key, act)
  for (const [from, byNonce] of candidate) { const c = byNonce.get(need(from)); if (c) heap.push(c.key, c.act) }

  const ordered: T[] = []
  const taken = new Set<string>()
  for (;;) {
    const top = heap.pop()
    if (!top) break
    if (taken.has(top.k)) continue
    taken.add(top.k)
    ordered.push(top.v)
    const a = top.v
    if (typeof a.nonce === 'number' && typeof a.from === 'string' && a.from) {
      expected.set(a.from, a.nonce + 1)
      const next = candidate.get(a.from)?.get(a.nonce + 1)
      if (next) heap.push(next.key, next.act)
    }
  }

  const deferred: T[] = []
  for (const [key, act] of byKey) if (!taken.has(key)) deferred.push(act)
  return { ordered, deferred, rejected }
}
