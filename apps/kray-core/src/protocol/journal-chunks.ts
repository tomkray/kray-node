/**
 * JOURNAL CHUNKS (ADR-2 · slice 2a — data availability, trust-minimized reconstruction) — the journal,
 * cut into content-addressed pieces, each of which PROVES ITSELF against the anchored head.
 *
 * Article XII: Bitcoin preserves the 32-byte commitment; someone must preserve the evidence. Today
 * `kray-follow.mjs` re-derives the whole root from ONE downloaded journal, trusting the server for the
 * BYTES (it re-proves they're consistent, but must fetch them from one place). For real availability —
 * "if every official server vanishes, the data + rules + Bitcoin still rebuild the truth" — the journal
 * must be fetchable in pieces from UNTRUSTED peers, each piece self-verifying so no peer is trusted.
 *
 * THE INSIGHT: the journal is already a hash-chain — each event's `hash = sha256(prevHash ‖ canonical
 * (body))` (and `body` includes the strictly-incrementing `seq`), and every event carries its `prevHash`.
 * So a CHUNK (a span of events) self-verifies given only its bytes, the hash it chains onto
 * (`startPrevHash`), and the seq it starts at (`startSeq`): re-derive the internal chain, confirm the tip,
 * and confirm the seq increments by one each step. A manifest of chunk boundaries (startPrevHash+startSeq
 * → endHash+endSeq, in order) reconstructs genesis → the anchored head; each chunk is then fetched by its
 * content address from anyone and checked against its boundary. Tamper a field VALUE and both the address
 * and the chain break; drop or reorder a chunk and the boundary breaks.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT (stated honestly, after a soundness council):
 * · It re-derives the SAME chain math as `store.ts` (`GENESIS_HASH`/`sha256hex`/`canonical`) AND enforces
 *   the store's strictly-incrementing `seq` rule — so a hash-consistent-but-non-monotonic span (the
 *   `seq=[1,1,1]` forgery) is refused here exactly as the reducer refuses it on replay.
 · It does NOT run `applyLive` — signatures, balances, conservation, the economic laws. So verifying a
 *   chunk proves it is a byte-authentic SPAN of the journal whose tip is the given head; the EVENTS'
 *   validity comes only when the reassembled journal is replayed through the reducer.
 * · Authenticity lives in the HEAD: an isolated chunk with an attacker-CHOSEN boundary only proves
 *   self-consistency against that boundary. It becomes genuine only once its boundary descends from a
 *   manifest whose head the follower re-derives independently and Bitcoin re-anchors (`verifyManifest`).
 *
 * This is the FOUNDATION slice: content-addressing + self-verifying chunks. Replication factor + erasure
 * coding (2b), gossip/bootstrap (2c), and verifiable snapshots (2d) all stand on it. Pure and wired into
 * NO live path — nothing here changes the writer, the reducer, or the cascade root.
 */
import { createHash } from 'node:crypto'
import { GENESIS_HASH, sha256hex, canonical } from './kray-primitives.ts'

const HEX64 = /^[0-9a-f]{64}$/

/** The CANONICAL chunk span — a fixed event count so every honest node cuts the same journal into the
 *  byte-identical chunks with the same content addresses, and any two peers can share a chunk by its hash.
 *  A consensus-of-convention parameter (not a rule the reducer enforces); byte-bounding is a later refinement. */
export const DEFAULT_CHUNK_SIZE = 128

export interface JournalChunk {
  index: number
  /** seq (1-based) of the first and last event in the span */
  startSeq: number
  endSeq: number
  /** the hash this chunk chains onto (the previous chunk's endHash, or GENESIS_HASH for the first) */
  startPrevHash: string
  /** the hash of the last event — this chunk's tip */
  endHash: string
  /** content address = sha256 of the exact chunk bytes */
  address: string
  /** the raw journal lines (JSONL) in this span */
  lines: string[]
}

/** the content address of a chunk: the SHA-256 of its exact bytes (the lines a peer serves). */
export function chunkAddress(lines: readonly string[]): string {
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex')
}

/**
 * Re-derive the internal hash-chain of a span of raw journal lines, starting from `startPrevHash` and the
 * expected first `startSeq`. Enforces the store's replay rules that a chunk can check without the ledger:
 * for each event, `hash` must equal `sha256hex(prevHash ‖ canonical(event-without-hash))`, `prevHash` must
 * be the prior tip, AND `seq` must equal `startSeq + i` (strictly incrementing — the store's own guard, so
 * a `seq=[1,1,1]` span is refused here exactly as the reducer refuses it). It does NOT run `applyLive`
 * (signatures/economics) — that validity comes only when the reassembled journal is replayed. Returns the
 * tip (`endHash`) and final seq (`endSeq`) on success, or `ok:false` with the exact break.
 */
export function verifyChunkChain(lines: readonly string[], startPrevHash: string, startSeq: number): { ok: boolean; endHash: string; endSeq: number; reason?: string } {
  if (typeof startPrevHash !== 'string' || (!HEX64.test(startPrevHash) && startPrevHash !== GENESIS_HASH)) return { ok: false, endHash: '', endSeq: 0, reason: 'startPrevHash must be a 64-hex event hash or GENESIS_HASH' }
  if (!Number.isInteger(startSeq) || startSeq < 1) return { ok: false, endHash: startPrevHash, endSeq: 0, reason: 'startSeq must be a positive integer' }
  let prev = startPrevHash
  for (let i = 0; i < lines.length; i++) {
    let e: Record<string, unknown>
    try { e = JSON.parse(lines[i]) } catch { return { ok: false, endHash: prev, endSeq: startSeq + i - 1, reason: `line ${i} is not JSON` } }
    if (typeof e.hash !== 'string' || typeof e.prevHash !== 'string') return { ok: false, endHash: prev, endSeq: startSeq + i - 1, reason: `line ${i} missing hash/prevHash` }
    if (e.seq !== startSeq + i) return { ok: false, endHash: prev, endSeq: startSeq + i - 1, reason: `line ${i} seq ${String(e.seq)} != expected ${startSeq + i} (not strictly incrementing — the store's own rule)` }
    if (e.prevHash !== prev) return { ok: false, endHash: prev, endSeq: startSeq + i - 1, reason: `line ${i} does not chain onto the previous tip` }
    const { hash, ...rest } = e
    if (sha256hex(prev + canonical(rest)) !== hash) return { ok: false, endHash: prev, endSeq: startSeq + i - 1, reason: `line ${i} hash mismatch — the bytes are tampered` }
    prev = hash as string
  }
  return { ok: true, endHash: prev, endSeq: startSeq + lines.length - 1 }
}

/**
 * Cut a journal (raw JSONL lines, in order) into fixed-size content-addressed chunks. Throws if the
 * journal itself does not chain (a caller should only chunk a journal that already replays). Returns the
 * chunks, the reconstructed `head` (the tip), and the `genesis` the first chunk chains onto.
 */
export function chunkJournal(lines: readonly string[], chunkSize: number): { chunks: JournalChunk[]; head: string; genesis: string } {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error('chunkJournal: chunkSize must be a positive integer')
  const chunks: JournalChunk[] = []
  let prev = GENESIS_HASH
  let idx = 0
  for (let start = 0; start < lines.length; start += chunkSize) {
    const span = lines.slice(start, start + chunkSize)
    const startSeq = (JSON.parse(span[0]) as { seq: number }).seq
    const v = verifyChunkChain(span, prev, startSeq)
    if (!v.ok) throw new Error(`chunkJournal: the journal does not chain at chunk ${idx} — ${v.reason}`)
    chunks.push({ index: idx, startSeq, endSeq: v.endSeq, startPrevHash: prev, endHash: v.endHash, address: chunkAddress(span), lines: [...span] })
    prev = v.endHash
    idx++
  }
  return { chunks, head: prev, genesis: GENESIS_HASH }
}

/**
 * Verify a single chunk's bytes against a PRE-COMMITTED boundary (`startPrevHash`, `startSeq`, and
 * optionally the `address`/`endHash`). This proves the bytes are self-consistent against THAT boundary —
 * it does NOT, alone, prove membership in the one true journal: an attacker can fabricate a self-consistent
 * span against a boundary they chose. Authenticity comes only when the boundary descends from a manifest
 * whose head the follower re-derives and Bitcoin re-anchors (see `verifyManifest`). Trust the peer for the
 * bytes: none — but trust the BOUNDARY only if it came from an anchored manifest.
 */
export function verifyChunk(chunk: { lines: readonly string[]; startPrevHash: string; startSeq: number; address?: string; endHash?: string }): { ok: boolean; endHash: string; endSeq: number; reason?: string } {
  if (chunk.address != null && chunkAddress(chunk.lines) !== chunk.address) return { ok: false, endHash: chunk.startPrevHash, endSeq: 0, reason: 'content-address mismatch — these bytes are not the addressed chunk' }
  const v = verifyChunkChain(chunk.lines, chunk.startPrevHash, chunk.startSeq)
  if (!v.ok) return v
  if (chunk.endHash != null && v.endHash !== chunk.endHash) return { ok: false, endHash: v.endHash, endSeq: v.endSeq, reason: 'endHash mismatch — the chunk does not reach its claimed tip' }
  return v
}

/**
 * Verify an ordered manifest of chunks reconstructs the journal from genesis to a claimed `head`: each
 * chunk internally valid and content-addressed, and each chaining exactly onto the previous — so a
 * dropped, reordered, or tampered chunk is refused. If it returns ok, the chunks ARE the journal whose
 * tip is `head` (whose cascade root is what Bitcoin anchored).
 */
export function verifyManifest(chunks: readonly JournalChunk[], head: string, genesis = GENESIS_HASH): { ok: boolean; reason?: string } {
  if (!HEX64.test(head)) return { ok: false, reason: 'head must be 64-hex' }
  let prev = genesis
  let expectedSeq = chunks.length ? chunks[0].startSeq : 1
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    if (c.startPrevHash !== prev) return { ok: false, reason: `chunk ${i} does not chain onto the previous (hash boundary break — a dropped or reordered chunk)` }
    if (c.startSeq !== expectedSeq) return { ok: false, reason: `chunk ${i} does not continue the seq (expected ${expectedSeq}, got ${c.startSeq} — a dropped or reordered chunk)` }
    const v = verifyChunk({ lines: c.lines, startPrevHash: c.startPrevHash, startSeq: c.startSeq, address: c.address, endHash: c.endHash })
    if (!v.ok) return { ok: false, reason: `chunk ${i}: ${v.reason}` }
    prev = c.endHash
    expectedSeq = v.endSeq + 1
  }
  if (prev !== head) return { ok: false, reason: `the chunks reconstruct to a different tip than the anchored head — incomplete or forged` }
  return { ok: true }
}
