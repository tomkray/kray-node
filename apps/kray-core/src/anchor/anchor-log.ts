/**
 * THE ANCHOR LOG — the node's own memory of what Bitcoin already sealed.
 *
 * An anchored cascade root is a PROMISE the network made to the world: "at
 * block H, the history was exactly this". This log records every such promise
 * durably and hash-chained, so the node can be held to it forever — by itself.
 *
 * WHY IT MAKES HISTORY IMMUTABLE, not just tamper-evident:
 *
 * A block's hash chains through `prevHash` and seals its events in a merkle
 * root. Therefore the hash of block H is a function of EVERY event that ever
 * happened up to H. If anyone — the operator included — edits, inserts,
 * removes or reorders a single past event, block H's hash changes.
 *
 * So the check is exact and costs nothing: for each anchor, does block H STILL
 * hash to the `chainTipHash` that went into the root Bitcoin sealed? If not,
 * history was rewritten after Bitcoin witnessed it, and the node must HALT
 * rather than serve a lie. No state replay, no trust, no ambiguity.
 *
 * The log itself is hash-chained and fsync'd, so a tampered log is caught too;
 * and even a DELETED log cannot help an attacker — the roots are on Bitcoin,
 * where anyone can read them and run the same comparison.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { cascadeRootOf, type CascadeParts } from '../protocol/receipt.ts'
import { parseHeader, type SealProof } from './spv.ts'

const GENESIS_HASH = 'kray-anchorlog-genesis'
const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
function canonical(o: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))))
}

/** One promise made to Bitcoin: at `height`, the history compiled to `cascadeRoot`. */
export interface AnchorRecord {
  seq: number
  prevHash: string
  hash: string
  at: number
  height: number // the KRAY block whose hash is the chain part of the root
  cascadeRoot: string
  parts: CascadeParts
  txid: string | null // the Bitcoin transaction, once broadcast
  network: string
  /** The REAL Bitcoin block height whose arrival triggered this anchor — the
   *  block that WITNESSED this history, and therefore the block that minted the
   *  land beneath it. Absent on anchors made before this was recorded. */
  btcHeight?: number | null
  /** WHICH chain that height belongs to. A height without its chain invites the
   *  reader to assume mainnet; naming it keeps the birth certificate honest. */
  btcChain?: string | null
  /** THE OFFLINE PROOF of the confirmed seal — raw tx + merkle proof + headers
   *  (spv.ts). With it, any replay re-proves this promise against Bitcoin's own
   *  mathematics with no Bitcoin node. Absent on the pre-proof era, and while a
   *  seal is still confirming; restated (append-only) once the proof exists. */
  proof?: SealProof | null
}

export interface AnchorVerdict {
  height: number
  cascadeRoot: string
  txid: string | null
  /** the five parts still compile to the sealed root (the record is coherent) */
  partsCompile: boolean
  /** block `height` still hashes exactly as it did when Bitcoin witnessed it */
  historyIntact: boolean
  /** null when the node no longer has that block at all (pruned or truncated) */
  currentBlockHash: string | null
}

export class AnchorLog {
  private readonly path: string
  private readonly records: AnchorRecord[] = []
  private seq = 0
  private lastHash = GENESIS_HASH
  readonly network: string

  constructor(dataDir: string, network: string) {
    mkdirSync(dataDir, { recursive: true })
    this.network = network
    this.path = join(dataDir, `kray-anchors-${network}.jsonl`)
    this.replay()
  }

  private replay(): void {
    if (!existsSync(this.path)) return
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const r = JSON.parse(line) as AnchorRecord
      const { hash, ...body } = r
      if (r.prevHash !== this.lastHash || hash !== sha256hex(this.lastHash + canonical(body)) || r.seq !== this.seq + 1) {
        throw new Error(`anchor-log: CHAIN BROKEN at seq ${r.seq} — the node's own record of what Bitcoin sealed was tampered with. HALT.`)
      }
      this.records.push(r)
      this.seq = r.seq
      this.lastHash = r.hash
    }
  }

  /** Record a promise: this root, at this height, went to Bitcoin. */
  record(height: number, parts: CascadeParts, txid: string | null, at: number, btcHeight: number | null = null, btcChain: string | null = null, proof: SealProof | null = null): AnchorRecord {
    const cascadeRoot = cascadeRootOf(parts)
    const body = { seq: this.seq + 1, prevHash: this.lastHash, at, height, cascadeRoot, parts, txid, network: this.network, btcHeight, btcChain, ...(proof ? { proof } : {}) }
    const r: AnchorRecord = { ...body, hash: sha256hex(this.lastHash + canonical(body)) }
    const fd = openSync(this.path, 'a')
    try { appendFileSync(fd, JSON.stringify(r) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
    this.records.push(r)
    this.seq = r.seq
    this.lastHash = r.hash
    return r
  }

  /** Attach the Bitcoin txid to the newest record that still lacks one. */
  attachTxid(cascadeRoot: string, txid: string, at: number): void {
    const known = this.records.find((r) => r.cascadeRoot === cascadeRoot)
    if (!known || known.txid === txid) return
    this.record(known.height, known.parts, txid, at, known.btcHeight ?? null, known.btcChain ?? null) // append-only: never edit, restate
  }

  /**
   * THE PROOF FOR A BITCOIN BLOCK — the seal buried in this exact block hash.
   *
   * The reducer's clock gate asks precisely this: "show me the Bitcoin block that
   * released this interval." Keying by the block rather than by an interval
   * number keeps the question self-describing — a settlement names its beacon,
   * and the answer either exists in this store or it does not.
   */
  proofForBeacon(beacon: string): SealProof | null {
    const want = beacon.toLowerCase()
    for (let i = this.records.length - 1; i >= 0; i--) {
      const p = this.records[i].proof
      if (!p || !p.headers?.length) continue
      try {
        if (parseHeader(Buffer.from(p.headers[0], 'hex')).hashDisplay === want) return p
      } catch (_) { /* a malformed stored header answers nothing, and says so by not matching */ }
    }
    return null
  }

  /** Attach the OFFLINE SPV proof to a promise, once its seal has confirmed —
   *  append-only: the record is RESTATED with the proof riding along forever. */
  attachProof(txid: string, proof: SealProof, at: number): void {
    const known = [...this.records].reverse().find((r) => r.txid === txid)
    if (!known || known.proof) return // no such promise, or already proven
    this.record(known.height, known.parts, txid, at, known.btcHeight ?? null, known.btcChain ?? null, proof)
  }

  get count(): number { return this.records.length }
  all(): AnchorRecord[] { return [...this.records] }
  latest(): AnchorRecord | null { return this.records.length ? this.records[this.records.length - 1] : null }

  /**
   * THE IMMUTABILITY VERDICT — hold the node to every promise it made.
   * `blockHashAt` returns the hash of a block in the node's CURRENT chain.
   */
  audit(blockHashAt: (height: number) => string | null): AnchorVerdict[] {
    return this.records.map((r) => {
      const current = blockHashAt(r.height)
      return {
        height: r.height,
        cascadeRoot: r.cascadeRoot,
        txid: r.txid,
        partsCompile: cascadeRootOf(r.parts) === r.cascadeRoot,
        historyIntact: current !== null && current === r.parts.chainTipHash,
        currentBlockHash: current,
      }
    })
  }
}
