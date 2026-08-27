/**
 * THE TK-FOLD — the executable specification of the lane's mathematics (Gate 0).
 *
 * TK = Total Knowledge, signed Tom Kray (docs/X-FEELESS-DECISION.md round 8): KRAY hides nothing —
 * what the fold proof will deliver is total knowledge of a state transition, compressed. This module
 * is the PURE REFERENCE every future prover (the zkVM guest) and verifier (the reducer) must equal
 * byte-for-byte (docs/TK-FOLD-DESIGN.md). It is wired into no live path yet — like `window-order.ts`
 * before the Same-Instant Law, it is the proven primitive the lane will stand on.
 *
 * The law, stated so a SECOND implementation converges byte-for-byte:
 *   1. ADMISSION — a lane transfer enters a breath only if its signature verifies over the lane's own
 *      injective domain (`tkFoldSendMessage`). A forged act never occupies a nonce slot.
 *   2. ORDER — the admitted set stands in the `orderWindow` schedule over sha256(signed bytes): the
 *      SAME theorem as the Same-Instant Law. Not even the folder chooses; arrival order is irrelevant.
 *   3. APPLY — validate-then-mutate in that fixed order: the expected nonce, two distinct parties, a
 *      positive amount, a sufficient balance. A refused act mutates NOTHING and never advances a nonce
 *      (so its account's later acts in the same breath defer deterministically). Feeless by law: the
 *      lane has no fee field at all — per-transfer journal bytes are zero, which is the whole point.
 *   4. DIFFS — the breath's net effect: every touched address → its new balance and nonce, sorted.
 *      `applyFoldDiffs` rebuilds the post state from the diffs ALONE (the follower's path), and
 *      `verifyFold` demands the claimed post root byte-for-byte — the Creator's re-sync law.
 *   5. CONSERVATION — Σ balances is invariant under a pure-transfer breath, checked as a tripwire
 *      here and carried as a public input of the fold proof later.
 */
import { sha256hex } from './kray-primitives.ts'
import { verifySignature, toBtcNet, isSupportedScheme, type SchemeId } from './scheme.ts'
import { orderWindow, keyFromSignedMessage } from './window-order.ts'

/** The lane's OWN signed domain — injective, network-bound, distinct from every journal kind:
 *  a journal x-send signature can never be replayed into the lane, nor the reverse. */
export function tkFoldSendMessage(network: string, from: string, to: string, amount: bigint, nonce: number): string {
  return `kray-core.tk-fold-send.v1|net=${network}|from=${from}|to=${to}|amount=${amount}|nonce=${nonce}`
}

/** One lane transfer as the folder receives it (amounts ride as decimal strings, like journal events). */
export interface LaneTransfer {
  from: string
  to: string
  amount: string
  nonce: number
  publicKey?: string
  signature?: string
  scheme?: string
}

/** The lane's whole state — balances and per-account nonces. Pure data; cloned, never shared. */
export interface LaneState {
  balances: Map<string, bigint>
  nonces: Map<string, number>
}

export const emptyLane = (): LaneState => ({ balances: new Map(), nonces: new Map() })
export const cloneLane = (s: LaneState): LaneState => ({ balances: new Map(s.balances), nonces: new Map(s.nonces) })
export const laneTotal = (s: LaneState): bigint => { let t = 0n; for (const b of s.balances.values()) t += b; return t }

/** THE LANE ROOT — a hash over the sorted non-zero balances, the sorted nonces, and the conserved
 *  total. The commitment the fold proof binds (pre and post); any tampered balance flips it. */
export function laneRoot(s: LaneState): string {
  const parts: string[] = []
  for (const [a, b] of [...s.balances.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
    if (b !== 0n) parts.push(`${a}:${b}`)
  }
  parts.push('|nonces')
  for (const [a, n] of [...s.nonces.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
    if (n !== 0) parts.push(`${a}:${n}`)
  }
  parts.push(`|lanetotal:${laneTotal(s)}`)
  return sha256hex(parts.join('\n'))
}

/** The breath's net effect — every touched address → its NEW balance and nonce, sorted. This is what
 *  lands on the journal beside the fold proof; a re-syncing node rebuilds the state from this alone. */
export interface FoldDiffs {
  balances: Array<[string, string]>   // address → new balance (decimal string)
  nonces: Array<[string, number]>     // address → new expected nonce
}

/** The canonical bytes of the diffs — `diffsHash` is a public input of the fold proof, so a proof can
 *  never be re-used over altered diffs. Sorted, labelled, injective. */
export function foldDiffsHash(d: FoldDiffs): string {
  const lines: string[] = ['tk-fold-diffs.v1']
  for (const [a, b] of d.balances) lines.push(`b|${a}|${b}`)
  for (const [a, n] of d.nonces) lines.push(`n|${a}|${n}`)
  return sha256hex(lines.join('\n'))
}

export interface FoldResult {
  state: LaneState                    // the post state (the pre state is never mutated)
  applied: LaneTransfer[]             // in the canonical order they were applied
  refused: Array<{ t: LaneTransfer; reason: string }>
  deferred: LaneTransfer[]            // nonce not yet eligible in this breath — a later breath may take them
  diffs: FoldDiffs
  preRoot: string
  postRoot: string
  diffsHash: string
}

/**
 * THE FOLD — one breath of the lane, as a pure function. Deterministic in (network, preState, the SET
 * of transfers): any arrival permutation yields the identical schedule, diffs and roots — the folder
 * assembles, mathematics orders, nobody chooses.
 */
/** THE CANONICAL-DECIMAL LAW (Gate 1b hardening — twins must be TOTAL-equal, not vector-equal):
 *  an amount is admitted ONLY as the exact string `BigInt.prototype.toString` emits — no hex, no
 *  whitespace, no sign, no leading zeros — and it must fit u128 (the Rust twin's word). `BigInt()`
 *  alone would accept `"0x10"` or `" 5 "`, which the Rust implementation refuses: two verdicts on
 *  one act is a fork, so the WIDER door hardens to the narrower law. */
const CANONICAL_DECIMAL = /^(0|[1-9][0-9]*)$/
const U128_MAX = (1n << 128n) - 1n
export function parseLaneAmount(s: string): bigint | undefined {
  if (typeof s !== 'string' || s.length > 39 || !CANONICAL_DECIMAL.test(s)) return undefined
  const v = BigInt(s)
  return v > U128_MAX ? undefined : v
}
/** A lane nonce is a canonical non-negative integer within the Rust twin's u64 — anything else refuses. */
const isCanonicalNonce = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0

export function foldBreath(network: string, pre: LaneState, transfers: LaneTransfer[]): FoldResult {
  const preRoot = laneRoot(pre)
  const refused: Array<{ t: LaneTransfer; reason: string }> = []

  // ── 1. ADMISSION: the signature first, over the lane's own domain — a forged act never enters ──
  // The wrapper exposes `from` and `nonce` at the top level: orderWindow reads them off the act itself
  // to build each account's nonce chain (hiding them would demote every act to "nonce-free").
  const admitted: Array<{ from: string; nonce: number; t: LaneTransfer; key: string }> = []
  for (const t of transfers) {
    if (!isCanonicalNonce(t.nonce)) { refused.push({ t, reason: 'a lane nonce must be a canonical non-negative integer' }); continue }
    const amt = parseLaneAmount(t.amount)
    if (amt === undefined) { refused.push({ t, reason: 'an amount must be canonical decimal within u128 (the canonical-decimal law)' }); continue }
    const msg = tkFoldSendMessage(network, t.from, t.to, amt, t.nonce)
    const okSig = !!t.publicKey && !!t.signature && !!t.scheme && isSupportedScheme(t.scheme)
      && verifySignature(t.from, msg, t.signature!, t.publicKey, t.scheme as SchemeId, toBtcNet(network))
    if (!okSig) { refused.push({ t, reason: 'signature does not verify over the lane domain' }); continue }
    admitted.push({ from: t.from, nonce: t.nonce, t, key: keyFromSignedMessage(msg) })
  }

  // ── 2. ORDER: the orderWindow schedule — the Same-Instant theorem, lane edition ──
  const { ordered, deferred: notEligible } = orderWindow(admitted, {
    nonceOf: (from) => pre.nonces.get(from) ?? 0,
    keyOf: (x) => (x as { key: string }).key,
    isValid: () => true,               // admission already ran — the window sees only real signatures
  }) as { ordered: Array<{ t: LaneTransfer; key: string }>; deferred: Array<{ t: LaneTransfer; key: string }> }

  // ── 3. APPLY: validate-then-mutate in the fixed order — a refusal mutates nothing ──
  const post = cloneLane(pre)
  const applied: LaneTransfer[] = []
  const deferred: LaneTransfer[] = notEligible.map((x) => x.t)
  const bal = (a: string) => post.balances.get(a) ?? 0n
  for (const { t } of ordered) {
    const expected = post.nonces.get(t.from) ?? 0
    if (t.nonce !== expected) { deferred.push(t); continue }   // an earlier sibling was refused — its chain waits
    const amt = BigInt(t.amount)
    if (amt <= 0n) { refused.push({ t, reason: 'a lane transfer amount must be positive' }); continue }
    if (t.from === t.to) { refused.push({ t, reason: 'a lane transfer needs two different parties' }); continue }
    if (bal(t.from) < amt) { refused.push({ t, reason: `insufficient lane Ӿ (have ${bal(t.from)}, need ${amt})` }); continue }
    post.balances.set(t.from, bal(t.from) - amt)
    post.balances.set(t.to, bal(t.to) + amt)
    post.nonces.set(t.from, expected + 1)
    applied.push(t)
  }

  // ── 5. CONSERVATION tripwire: a pure-transfer breath can never mint or destroy ──
  if (laneTotal(post) !== laneTotal(pre)) throw new Error('tk-fold: conservation broke — the breath minted or destroyed Ӿ (impossible by construction; halt)')

  // ── 4. DIFFS: the net effect, sorted — the only bytes the journal will carry per touched address ──
  const touched = new Set<string>()
  for (const t of applied) { touched.add(t.from); touched.add(t.to) }
  const diffs: FoldDiffs = {
    balances: [...touched].sort().map((a) => [a, (post.balances.get(a) ?? 0n).toString()]),
    nonces: [...touched].filter((a) => (post.nonces.get(a) ?? 0) !== (pre.nonces.get(a) ?? 0))
      .sort().map((a) => [a, post.nonces.get(a)!]),
  }
  return { state: post, applied, refused, deferred, diffs, preRoot, postRoot: laneRoot(post), diffsHash: foldDiffsHash(diffs) }
}

/** THE FOLLOWER'S PATH — rebuild the post state from the diffs ALONE (the Creator's re-sync law):
 *  no transfer data needed, every balance exact. Pure; the pre state is never mutated. */
export function applyFoldDiffs(pre: LaneState, diffs: FoldDiffs): LaneState {
  const post = cloneLane(pre)
  for (const [a, b] of diffs.balances) post.balances.set(a, BigInt(b))
  for (const [a, n] of diffs.nonces) post.nonces.set(a, n)
  return post
}

/** THE VERIFIER'S DEMAND — diffs + claimed post root, or it does not exist: applies the diffs to the
 *  pre state and requires the byte-identical root (what the reducer will enforce beside the fold proof). */
export function verifyFold(pre: LaneState, diffs: FoldDiffs, claimedPostRoot: string): boolean {
  return laneRoot(applyFoldDiffs(pre, diffs)) === claimedPostRoot
}
