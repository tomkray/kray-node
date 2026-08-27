/**
 * NONCE MAP (ADR-3 · the eligibility opening — a committed account→nonce state a stranger can prove against) —
 * the missing trustless input for the 3c ⋈ 3d eligibility gate, in a SINGLE anchored opening.
 *
 * The censorship verdict needs the account's expected (next) nonce AS OF THE DEADLINE — but the accusing seal
 * (the one opening a light verifier holds) is ≥ the deadline, and expected-nonce is monotone (it only rises).
 * Reading the raw nonce at the accusing seal would over-convict (a predecessor applied between the deadline and
 * the accusation would look eligible). The design council's SINGLE-OPENING solution: STAMP each leaf with the
 * Bitcoin height at which the account's CURRENT nonce first became anchored — sticky. Then one reading of
 * (nonce, height) from ANY anchored opening ≥ the deadline decides eligibility without a second seal:
 *   · height ≤ deadline  → the account has held this nonce since a real seal ≤ D and still holds it ⇒ by
 *                          monotonicity expected@deadline == nonce EXACTLY (the frontier/superseded/gap split);
 *   · absent (nonce 0)   → expected@deadline == 0 (applied-count is monotone; absent now ⇒ absent then);
 *   · height > deadline  → the account reached this nonce only AFTER the deadline ⇒ expected@deadline < nonce
 *                          ⇒ fail-closed acquit (a deferral is not a refusal).
 * The sticky stamp makes the reading identical from every opening ≥ D, so an accuser cannot roll back to a
 * favorable earlier seal — the rollback attack is structurally impossible, not merely checked.
 *
 * THE STRUCTURE — the same 256-deep SMT as `inclusion-tree` (proven), each leaf carrying a VALUE: the position
 * is `H(address)` (a 256-bit key), a present leaf commits `H(0x02‖key‖utf8(`${nonce}:${height}`))`. `absent ⇒
 * nonce 0` is the ledger's own `nonceOf` default (`commitNonce` only ever raises to ≥ 1, so a present entry is
 * always ≥ 1). `height ∈ {0} ∪ {real l1Height ≥ 1}`, where 0 is the UNANCHORED SENTINEL (the nonce advanced
 * mid-stream and no seal has stamped it yet) — the verifier treats 0 as "> any deadline" (acquit-biased).
 *
 * DOMAIN SEPARATION — tags 0x02 (leaf) / 0x03 (node) are DISTINCT from `inclusion-tree`'s 0x00/0x01, and the
 * value leaf preimage (1+32+var) cannot be re-presented as a node (1+32+32) or the empty leaf (32 zeros). The
 * `${nonce}:${height}` form uses ':' (0x3a, not a digit) so the two integers split unambiguously.
 *
 * Pure and wired into NO live path until an explicit activation folds `nonceRoot` — append-only, so
 * pre-activation history is byte-identical (A3). `IncrementalNonceMap` maintains the same root in O(256) per
 * account advance (the writer cannot be griefed at anchor time), byte-identical to the batch root by construction.
 */
import { createHash } from 'node:crypto'

export const NMAP_DEPTH = 256
/** the domain tags — DISTINCT from inclusion-tree's 0x00/0x01, exported so a test can regress if equalised */
export const _NMAP_LEAF_TAG = 0x02
export const _NMAP_NODE_TAG = 0x03
const LEAF_TAG = Buffer.from([_NMAP_LEAF_TAG])
const NODE_TAG = Buffer.from([_NMAP_NODE_TAG])
const h = (buf: Buffer): Buffer => createHash('sha256').update(buf).digest()

const EMPTY_LEAF = Buffer.alloc(32, 0)
const DEFAULTS: Buffer[] = (() => {
  const d = [EMPTY_LEAF]
  for (let i = 1; i <= NMAP_DEPTH; i++) d[i] = h(Buffer.concat([NODE_TAG, d[i - 1], d[i - 1]]))
  return d
})()
/** the root of the empty map — every account is at nonce 0 */
export const NMAP_EMPTY_ROOT = DEFAULTS[NMAP_DEPTH].toString('hex')

const HEX64 = /^[0-9a-f]{64}$/
/** the 256-bit position of an account: the SHA-256 of its address string (any address shape → a fixed key) */
export function addrKey(address: string): string {
  if (typeof address !== 'string' || address.length === 0) throw new Error('nonce-map: address must be a non-empty string')
  return createHash('sha256').update(address, 'utf8').digest('hex')
}
function assertNonce(n: number): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`nonce-map: a nonce must be a non-negative integer, got ${JSON.stringify(n)}`)
}
function assertHeight(hgt: number): void {
  if (!Number.isInteger(hgt) || hgt < 0) throw new Error(`nonce-map: an anchor height must be a non-negative integer (0 = unanchored sentinel), got ${JSON.stringify(hgt)}`)
}
/** the present-leaf preimage: H(0x02 ‖ key ‖ utf8(`${nonce}:${height}`)). ':' (0x3a) is not a digit, so the
 *  two integers are an unambiguous split — no (n,h) pair collides with another. */
const leafOf = (keyHex: string, nonce: number, height: number): Buffer =>
  h(Buffer.concat([LEAF_TAG, Buffer.from(keyHex, 'hex'), Buffer.from(`${nonce}:${height}`, 'utf8')]))
const nodeOf = (l: Buffer, r: Buffer): Buffer => h(Buffer.concat([NODE_TAG, l, r]))
const bit = (kb: Buffer, i: number): number => (kb[i >> 3] >> (7 - (i & 7))) & 1

/** The id of the subtree node at `level` on `kb`'s path (the first `level` bits, canonical), so two keys sharing
 *  a prefix share the node. `flipLast` names the SIBLING at that level. (Same machinery as inclusion-tree.) */
function nodeId(level: number, kb: Buffer, flipLast = false): string {
  if (level === 0) return '0'
  const bytes = (level + 7) >> 3
  const buf = Buffer.alloc(bytes)
  kb.copy(buf, 0, 0, bytes)
  const used = level - (bytes - 1) * 8
  if (used < 8) buf[bytes - 1] &= (0xff << (8 - used)) & 0xff
  if (flipLast) buf[bytes - 1] ^= 1 << (8 - used)
  return level + ':' + buf.toString('hex')
}

/** a committed entry: (address, nonce ≥ 1, anchor height ≥ 0) — nonce 0 is absent (the default), never a leaf */
export type NonceEntry = readonly [address: string, nonce: number, height: number]
interface Item { key: string; kb: Buffer; nonce: number; height: number }
function itemsOf(entries: Iterable<NonceEntry>): Item[] {
  const byKey = new Map<string, Item>()
  for (const [address, nonce, height] of entries) {
    assertNonce(nonce); assertHeight(height)
    const key = addrKey(address)
    if (nonce === 0) { byKey.delete(key); continue }   // nonce 0 ⇒ absent (default), never a present leaf
    byKey.set(key, { key, kb: Buffer.from(key, 'hex'), nonce, height })   // last value for a repeated address wins
  }
  return [...byKey.values()]
}

function subtree(level: number, list: Item[]): Buffer {
  if (list.length === 0) return DEFAULTS[NMAP_DEPTH - level]
  if (level === NMAP_DEPTH) return leafOf(list[0].key, list[0].nonce, list[0].height)
  const left: Item[] = [], right: Item[] = []
  for (const it of list) (bit(it.kb, level) ? right : left).push(it)
  return nodeOf(subtree(level + 1, left), subtree(level + 1, right))
}

/** The Merkle root committing to exactly this account→(nonce,height) map (order-independent; absent ⇒ nonce 0). */
export function nonceMapRoot(entries: Iterable<NonceEntry>): string {
  return subtree(0, itemsOf(entries)).toString('hex')
}

export interface NonceProof {
  /** true if the account has a present leaf (nonce ≥ 1); false if absent (nonce 0) */
  present: boolean
  /** the committed next-nonce (≥ 1 when present, 0 when absent) */
  nonce: number
  /** the Bitcoin height at which this nonce first anchored (0 = unanchored sentinel; irrelevant when absent) */
  height: number
  /** NMAP_DEPTH sibling hashes (hex), level 0 nearest the root */
  siblings: string[]
}

/** Build the membership (present) / non-membership (absent ⇒ nonce 0) proof of `address`. */
export function proveNonce(entries: Iterable<NonceEntry>, address: string): NonceProof {
  const key = addrKey(address)
  const list = itemsOf(entries)
  const hit = list.find((it) => it.key === key)
  const kb = Buffer.from(key, 'hex')
  const siblings: string[] = new Array(NMAP_DEPTH)
  const walk = (level: number, sub: Item[]): void => {
    if (level === NMAP_DEPTH) return
    const left: Item[] = [], right: Item[] = []
    for (const it of sub) (bit(it.kb, level) ? right : left).push(it)
    const goRight = bit(kb, level)
    siblings[level] = (goRight ? subtree(level + 1, left) : subtree(level + 1, right)).toString('hex')
    walk(level + 1, goRight ? right : left)
  }
  walk(0, list)
  return { present: !!hit, nonce: hit ? hit.nonce : 0, height: hit ? hit.height : 0, siblings }
}

/** Verify a nonce proof against a root. Returns the proven {nonce, height} (≥ 0), or null if the proof is
 *  invalid — a light verifier's trustless read of "account X is at nonce N, first anchored at height H". */
export function verifyNonceProof(rootHex: string, address: string, proof: NonceProof): { nonce: number; height: number } | null {
  if (!HEX64.test(rootHex)) return null
  if (!proof || (proof.present !== true && proof.present !== false)) return null
  if (!Number.isInteger(proof.nonce) || proof.nonce < 0) return null
  if (!Number.isInteger(proof.height) || proof.height < 0) return null
  if (proof.present && proof.nonce < 1) return null            // a present leaf is always ≥ 1 (0 is the default)
  if (!proof.present && (proof.nonce !== 0 || proof.height !== 0)) return null   // absence is exactly (0,0)
  if (!Array.isArray(proof.siblings) || proof.siblings.length !== NMAP_DEPTH) return null
  let key: string
  try { key = addrKey(address) } catch { return null }
  const kb = Buffer.from(key, 'hex')
  let cur = proof.present ? leafOf(key, proof.nonce, proof.height) : EMPTY_LEAF
  for (let level = NMAP_DEPTH - 1; level >= 0; level--) {
    const sibHex = proof.siblings[level]
    if (typeof sibHex !== 'string' || !HEX64.test(sibHex)) return null
    const sib = Buffer.from(sibHex, 'hex')
    cur = bit(kb, level) ? nodeOf(sib, cur) : nodeOf(cur, sib)
  }
  if (!cur.equals(Buffer.from(rootHex, 'hex'))) return null
  return { nonce: proof.nonce, height: proof.height }
}

/**
 * INCREMENTAL NONCE MAP — the SAME root as `nonceMapRoot`, maintained in O(NMAP_DEPTH) per account advance
 * instead of O(N·DEPTH) per rebuild, so folding it into the cascade at every door-call (`cascadeRoot()` runs
 * per request) cannot be griefed. Unlike the insert-only inclusion tree it is an UPDATE map: an account's leaf
 * changes when its nonce advances (and when the seal flush promotes the sentinel height to a real one). Byte-
 * identical to `nonceMapRoot` over the same final (address→nonce,height) entries BY CONSTRUCTION.
 */
export class IncrementalNonceMap {
  private readonly values = new Map<string, { address: string; nonce: number; height: number }>()
  private readonly nodes = new Map<string, Buffer>()
  private _root: Buffer = DEFAULTS[NMAP_DEPTH]

  size(): number { return this.values.size }
  root(): string { return this._root.toString('hex') }
  /** the current (nonce, height) for an address, or undefined if absent (nonce 0) */
  get(address: string): { nonce: number; height: number } | undefined {
    const v = this.values.get(addrKey(address)); return v ? { nonce: v.nonce, height: v.height } : undefined
  }
  /** the membership/non-membership proof of `address` against this map's root (what the censorship prover attaches) */
  prove(address: string): NonceProof {
    return proveNonce([...this.values.values()].map((v) => [v.address, v.nonce, v.height] as NonceEntry), address)
  }

  /** Set `address`'s (nonce, height). nonce 0 clears it (back to the absent default). O(NMAP_DEPTH) hashes. */
  update(address: string, nonce: number, height: number): void {
    assertNonce(nonce); assertHeight(height)
    const key = addrKey(address)
    const kb = Buffer.from(key, 'hex')
    let cur: Buffer
    if (nonce === 0) { this.values.delete(key); cur = EMPTY_LEAF }
    else { this.values.set(key, { address, nonce, height }); cur = leafOf(key, nonce, height) }
    this.nodes.set(nodeId(NMAP_DEPTH, kb), cur)
    for (let level = NMAP_DEPTH - 1; level >= 0; level--) {
      const sib = this.nodes.get(nodeId(level + 1, kb, true)) ?? DEFAULTS[NMAP_DEPTH - (level + 1)]
      cur = bit(kb, level) ? nodeOf(sib, cur) : nodeOf(cur, sib)
      this.nodes.set(nodeId(level, kb), cur)
    }
    this._root = cur
  }
}

/** Test-facing views of the two tagged hashes, so the domain boundary can be exercised directly. */
export const _nmapLeafHash = (keyHex: string, nonce: number, height: number): string => leafOf(keyHex, nonce, height).toString('hex')
export const _nmapNodeHash = (lHex: string, rHex: string): string => nodeOf(Buffer.from(lHex, 'hex'), Buffer.from(rHex, 'hex')).toString('hex')
