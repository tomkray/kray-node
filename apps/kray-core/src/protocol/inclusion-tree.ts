/**
 * INCLUSION TREE (ADR-3 · slice 3a — root injectivity, the seed of proof-of-absence) — a commitment
 * to WHICH acts a window contains, so a stranger can prove an act was included OR that it was NOT.
 *
 * The cascade root today commits to STATE (balances, stars, runes…), not to the SET of acts that
 * produced it — two different act sets can reach the same state (a transfer that nets out; commuting
 * acts). That is fine for proving state, but it cannot prove *absence*: "the writer left my signed act
 * out of the window at its deadline." For that (slice 3d, censorship-as-evidence) we need a commitment
 * that is INJECTIVE over the act set and carries a non-membership proof. This module is that commitment.
 *
 * THE STRUCTURE: a Sparse Merkle Tree over 256-bit keys — each act's key is its 3c signed-message hash
 * (`keyFromSignedMessage`), so the position is the act's own ungrindable identity. A key that is IN the
 * set has a present leaf at its position; a key that is OUT has the empty default leaf. Therefore:
 *   · MEMBERSHIP proof  — the sibling path recomputes the root from the PRESENT leaf ⇒ the act is in.
 *   · NON-MEMBERSHIP    — the same path recomputes the root from the EMPTY default leaf ⇒ the act is out.
 * Both are sound under SHA-256 collision/preimage resistance: if a key were present, its position would
 * hold `H(0x00‖key) ≠ default`, so the empty-leaf recompute could not reproduce the root — and vice versa.
 *
 * DOMAIN SEPARATION (the classic Merkle pitfall, closed BY CONSTRUCTION): a leaf is `H(0x00‖key)` (a
 * 33-byte preimage), an internal node is `H(0x01‖left‖right)` (a 65-byte preimage), and the empty leaf
 * is the 32 zero bytes — three disjoint preimage shapes (by tag AND by length), so no internal hash can
 * be re-presented as a leaf (second-preimage). Depth-collapse is independently unreachable because the
 * 256-bit key fixes the path length. This is a STRUCTURAL property, not something a live forge can test
 * (a real forge would require inverting SHA-256); the exam pins it by regressing if the tags are equalised.
 *
 * The commitment is over the SET (order-independent) — the complement of 3c, which commits to ORDER.
 * Pure and wired into NO live path: it is the accumulator 3d will stand on. Nothing here touches the
 * live writer or the cascade root.
 */
import { createHash } from 'node:crypto'

export const SMT_DEPTH = 256
/** the domain tags — DISTINCT on purpose. Exported so a test can regress if they are ever equalised. */
export const _LEAF_TAG = 0x00
export const _NODE_TAG = 0x01
const LEAF_TAG = Buffer.from([_LEAF_TAG])
const NODE_TAG = Buffer.from([_NODE_TAG])
const h = (buf: Buffer): Buffer => createHash('sha256').update(buf).digest()

/** the empty leaf: 32 zero bytes — a value no `H(0x00‖key)` (a 33-byte preimage) can equal */
const EMPTY_LEAF = Buffer.alloc(32, 0)
/** default subtree hashes by HEIGHT: DEFAULTS[0] = empty leaf; DEFAULTS[i] = node(default_{i-1}, default_{i-1}) */
const DEFAULTS: Buffer[] = (() => {
  const d = [EMPTY_LEAF]
  for (let i = 1; i <= SMT_DEPTH; i++) d[i] = h(Buffer.concat([NODE_TAG, d[i - 1], d[i - 1]]))
  return d
})()

/** the root of the empty set — a fixed constant every node agrees on */
export const EMPTY_ROOT = DEFAULTS[SMT_DEPTH].toString('hex')

const KEY_RE = /^[0-9a-f]{64}$/
function assertKey(keyHex: string): Buffer {
  if (!KEY_RE.test(keyHex)) throw new Error(`inclusion-tree: a key must be 64-hex (a 256-bit act key), got ${JSON.stringify(keyHex)}`)
  return Buffer.from(keyHex, 'hex')
}
const leafOf = (keyHex: string): Buffer => h(Buffer.concat([LEAF_TAG, Buffer.from(keyHex, 'hex')]))
const nodeOf = (l: Buffer, r: Buffer): Buffer => h(Buffer.concat([NODE_TAG, l, r]))
/** Test-facing views of the two tagged hashes, so the domain boundary can be exercised directly. */
export const _leafHash = (keyHex: string): string => leafOf(assertKey(keyHex) && keyHex).toString('hex')
export const _nodeHash = (lHex: string, rHex: string): string => nodeOf(Buffer.from(lHex, 'hex'), Buffer.from(rHex, 'hex')).toString('hex')
/** bit `i` of the key, MSB-first (i = 0 is the top of the path) */
const bit = (kb: Buffer, i: number): number => (kb[i >> 3] >> (7 - (i & 7))) & 1

interface Item { hex: string; kb: Buffer }
function itemsOf(keysHex: Iterable<string>): Item[] {
  const uniq = new Map<string, Item>()
  for (const k of keysHex) { assertKey(k); if (!uniq.has(k)) uniq.set(k, { hex: k, kb: Buffer.from(k, 'hex') }) }
  return [...uniq.values()]
}

/** Recompute the subtree hash at `level` (0 = root … SMT_DEPTH = leaf) for the keys that fall in it.
 *  Empty subtrees short-circuit to the level default in O(1), so the walk is O(|keys|·depth), not O(2^256). */
function subtree(level: number, list: Item[]): Buffer {
  if (list.length === 0) return DEFAULTS[SMT_DEPTH - level]
  if (level === SMT_DEPTH) return leafOf(list[0].hex)   // exactly one key can reach a leaf (256-bit keys unique)
  const left: Item[] = [], right: Item[] = []
  for (const it of list) (bit(it.kb, level) ? right : left).push(it)
  return nodeOf(subtree(level + 1, left), subtree(level + 1, right))
}

/** The Merkle root committing to exactly this SET of act keys (order-independent, injective). */
export function inclusionRoot(keysHex: Iterable<string>): string {
  return subtree(0, itemsOf(keysHex)).toString('hex')
}

export interface MerkleProof {
  /** true if the key is IN the set (present leaf), false if absent (empty leaf) */
  present: boolean
  /** SMT_DEPTH sibling hashes (hex), indexed by level 0…DEPTH-1 (level 0 nearest the root) */
  siblings: string[]
}

/** Build the inclusion (present=true) or non-inclusion (present=false) proof for `keyHex`. */
export function proveKey(keysHex: Iterable<string>, keyHex: string): MerkleProof {
  assertKey(keyHex)
  const list = itemsOf(keysHex)
  const present = list.some((it) => it.hex === keyHex)
  const kb = Buffer.from(keyHex, 'hex')
  const siblings: string[] = new Array(SMT_DEPTH)
  const walk = (level: number, sub: Item[]): void => {
    if (level === SMT_DEPTH) return
    const left: Item[] = [], right: Item[] = []
    for (const it of sub) (bit(it.kb, level) ? right : left).push(it)
    const goRight = bit(kb, level)
    const sibling = goRight ? subtree(level + 1, left) : subtree(level + 1, right)
    siblings[level] = sibling.toString('hex')
    walk(level + 1, goRight ? right : left)
  }
  walk(0, list)
  return { present, siblings }
}

/** Verify a proof against a root. Returns the proven fact: 'in', 'out', or null if the proof is invalid.
 *  `verifyInclusion` / `verifyExclusion` are the intent-named wrappers. */
export function verifyProof(rootHex: string, keyHex: string, proof: MerkleProof): 'in' | 'out' | null {
  if (!KEY_RE.test(keyHex) || !KEY_RE.test(rootHex)) return null
  if (!proof || (proof.present !== true && proof.present !== false)) return null   // strict boolean, no truthiness
  if (!Array.isArray(proof.siblings) || proof.siblings.length !== SMT_DEPTH) return null
  const kb = Buffer.from(keyHex, 'hex')
  let cur = proof.present ? leafOf(keyHex) : EMPTY_LEAF
  for (let level = SMT_DEPTH - 1; level >= 0; level--) {
    const sibHex = proof.siblings[level]
    if (typeof sibHex !== 'string' || !KEY_RE.test(sibHex)) return null
    const sib = Buffer.from(sibHex, 'hex')
    cur = bit(kb, level) ? nodeOf(sib, cur) : nodeOf(cur, sib)
  }
  if (!cur.equals(Buffer.from(rootHex, 'hex'))) return null
  return proof.present ? 'in' : 'out'
}

export function verifyInclusion(rootHex: string, keyHex: string, proof: MerkleProof): boolean {
  return proof?.present === true && verifyProof(rootHex, keyHex, proof) === 'in'
}
export function verifyExclusion(rootHex: string, keyHex: string, proof: MerkleProof): boolean {
  return proof?.present === false && verifyProof(rootHex, keyHex, proof) === 'out'
}

/** The id of the subtree node at `level` on `kb`'s path — the first `level` bits of the key (canonical, low bits
 *  of the last byte zeroed), so two keys sharing a prefix share the node. `flipLast` toggles bit (level-1) to
 *  name the SIBLING at that level. */
function nodeId(level: number, kb: Buffer, flipLast = false): string {
  if (level === 0) return '0'
  const bytes = (level + 7) >> 3
  const buf = Buffer.alloc(bytes)
  kb.copy(buf, 0, 0, bytes)
  const used = level - (bytes - 1) * 8   // 1..8 significant bits in the last byte (MSB-first)
  if (used < 8) buf[bytes - 1] &= (0xff << (8 - used)) & 0xff
  if (flipLast) buf[bytes - 1] ^= 1 << (8 - used)   // toggle bit (level-1) — the sibling direction
  return level + ':' + buf.toString('hex')
}

/**
 * INCREMENTAL INCLUSION TREE — the SAME root as `inclusionRoot(set)`, maintained in O(SMT_DEPTH) per insert
 * instead of O(|set|·SMT_DEPTH) per rebuild, so a large post-activation inclusion history cannot grief the
 * anchor (the ADR-3 Slice-A council's ratification item). INSERT-ONLY — the inclusion set never shrinks. It
 * stores only the non-default nodes it has touched, and each insert re-walks just the new key's leaf→root path
 * against cached siblings (or the height default). Byte-identical to `inclusionRoot()` BY CONSTRUCTION: it uses
 * the very same `leafOf`/`nodeOf`/`DEFAULTS` primitives and the same MSB-first path the batch tree walks.
 */
export class IncrementalInclusionTree {
  private readonly keys = new Set<string>()
  private readonly nodes = new Map<string, Buffer>()   // nodeId → subtree hash (the touched non-default nodes + leaves)
  private _root: Buffer = DEFAULTS[SMT_DEPTH]

  size(): number { return this.keys.size }
  has(keyHex: string): boolean { return this.keys.has(keyHex) }
  root(): string { return this._root.toString('hex') }
  /** The inclusion (present) or non-inclusion (absent) proof for `keyHex` against this tree's current root —
   *  what a censorship PROVER builds to show an act is absent from the committed set (verifyProof/verifyExclusion
   *  check it). Byte-identical to proveKey over the same set (the root is byte-identical). */
  prove(keyHex: string): MerkleProof { return proveKey(this.keys, keyHex) }

  /** Add a 256-bit key. Idempotent (a repeat is a no-op — a set, not a multiset). O(SMT_DEPTH) hashes. */
  insert(keyHex: string): void {
    assertKey(keyHex)
    if (this.keys.has(keyHex)) return
    this.keys.add(keyHex)
    const kb = Buffer.from(keyHex, 'hex')
    let cur = leafOf(keyHex)
    this.nodes.set(nodeId(SMT_DEPTH, kb), cur)   // the present leaf at the bottom
    for (let level = SMT_DEPTH - 1; level >= 0; level--) {
      const sib = this.nodes.get(nodeId(level + 1, kb, true)) ?? DEFAULTS[SMT_DEPTH - (level + 1)]
      cur = bit(kb, level) ? nodeOf(sib, cur) : nodeOf(cur, sib)
      this.nodes.set(nodeId(level, kb), cur)
    }
    this._root = cur
  }
}
