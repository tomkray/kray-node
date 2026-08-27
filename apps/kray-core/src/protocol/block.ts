/**
 * KRAY-CORE — the block chain (fast, local, Bitcoin-anchorable).
 *
 * A block is a HEADER that seals a RANGE of ledger events into one merkle root
 * and chains to the previous block — Bitcoin's own shape (headers link; data
 * lives elsewhere). The leaves are the hash-chained ledger events (see
 * kray-ledger.ts), so a block double-secures them: the event hash-chain, the
 * block merkle root, and the block hash-chain. Any node can recompute a block's
 * root from the ledger and verify the whole chain from first principles.
 *
 * Same durability discipline as KRILL/the KRAY ledger: an append-only,
 * fsync'd block journal, verified end-to-end on every boot. Phase 1 anchors
 * each block's `merkleRoot` into Bitcoin via OP_RETURN — the header is already
 * exactly the 32-byte commitment that goes on-chain.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const H = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const ZERO = '0'.repeat(64)
// domain separation so a leaf can never be mistaken for an internal node
const hashLeaf = (raw: string) => H('\x00' + raw)
const hashNode = (a: string, b: string) => H('\x01' + a + b)

export interface KrayBlock {
  number: number
  prevHash: string
  fromSeq: number // first ledger event seq sealed in this block
  toSeq: number // last ledger event seq (toSeq < fromSeq means an empty block)
  txCount: number
  merkleRoot: string
  at: number
  hash: string
}

export interface MerkleStep { hash: string; siblingIsRight: boolean }

/** Merkle root over raw leaf strings (Bitcoin-style: duplicate the last if odd). */
export function buildMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return H('kray-empty-block')
  let level = leaves.map(hashLeaf)
  while (level.length > 1) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) next.push(hashNode(level[i], i + 1 < level.length ? level[i + 1] : level[i]))
    level = next
  }
  return level[0]
}

/** Inclusion proof for the leaf at `index` — the siblings needed to rebuild the root. */
export function merkleProof(leaves: string[], index: number): MerkleStep[] {
  if (index < 0 || index >= leaves.length) throw new Error('kray-block: leaf index out of range')
  let level = leaves.map(hashLeaf)
  let idx = index
  const proof: MerkleStep[] = []
  while (level.length > 1) {
    const isRight = idx % 2 === 1
    const sibIdx = isRight ? idx - 1 : idx + 1
    const sibling = sibIdx < level.length ? level[sibIdx] : level[idx] // duplicate last if odd
    proof.push({ hash: sibling, siblingIsRight: !isRight })
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) next.push(hashNode(level[i], i + 1 < level.length ? level[i + 1] : level[i]))
    idx = Math.floor(idx / 2)
    level = next
  }
  return proof
}

/** Verify a leaf is in the tree with the given root — what a light validator runs. */
export function verifyMerkleProof(rawLeaf: string, proof: MerkleStep[], root: string): boolean {
  let h = hashLeaf(rawLeaf)
  for (const step of proof) h = step.siblingIsRight ? hashNode(h, step.hash) : hashNode(step.hash, h)
  return h === root
}

export function blockHash(b: Omit<KrayBlock, 'hash'>): string {
  return H(`kray-block:${b.number}:${b.prevHash}:${b.merkleRoot}:${b.fromSeq}:${b.toSeq}:${b.txCount}:${b.at}`)
}

export class KrayChain {
  private readonly journalPath: string
  private blocks: KrayBlock[] = []

  constructor(dataDir: string, network: string) {
    mkdirSync(dataDir, { recursive: true })
    this.journalPath = join(dataDir, `kray-blocks-${network}.jsonl`)
    this.load()
  }

  private load(): void {
    if (!existsSync(this.journalPath)) return
    const lines = readFileSync(this.journalPath, 'utf8').split('\n').filter((l) => l.trim())
    for (const line of lines) {
      const b = JSON.parse(line) as KrayBlock
      const expectPrev = this.blocks.length === 0 ? ZERO : this.blocks[this.blocks.length - 1].hash
      const expectNum = this.blocks.length
      if (b.number !== expectNum || b.prevHash !== expectPrev || b.hash !== blockHash(b)) {
        throw new Error(`kray-block: BLOCK CHAIN BROKEN at block ${b.number} — refusing to run`)
      }
      this.blocks.push(b)
    }
  }

  /** Seal a range of ledger events (as leaves) into the next block, chained + fsync'd. */
  sealBlock(leaves: string[], fromSeq: number, toSeq: number, at: number): KrayBlock {
    const tip = this.blocks[this.blocks.length - 1]
    const body: Omit<KrayBlock, 'hash'> = {
      number: tip ? tip.number + 1 : 0,
      prevHash: tip ? tip.hash : ZERO,
      fromSeq, toSeq,
      txCount: leaves.length,
      merkleRoot: buildMerkleRoot(leaves),
      at,
    }
    const block: KrayBlock = { ...body, hash: blockHash(body) }
    const fd = openSync(this.journalPath, 'a')
    try { appendFileSync(fd, JSON.stringify(block) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
    this.blocks.push(block)
    return block
  }

  /** Recompute every block hash + prevHash linkage from the journal on disk. */
  verify(): boolean {
    let prev = ZERO
    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i]
      if (b.number !== i || b.prevHash !== prev || b.hash !== blockHash(b)) return false
      prev = b.hash
    }
    return true
  }

  tip(): KrayBlock | null { return this.blocks[this.blocks.length - 1] ?? null }
  height(): number { return this.blocks.length - 1 }
  blockAt(n: number): KrayBlock | null { return this.blocks[n] ?? null }
  get head(): string { return this.tip()?.hash ?? ZERO }
  get length(): number { return this.blocks.length }
}
