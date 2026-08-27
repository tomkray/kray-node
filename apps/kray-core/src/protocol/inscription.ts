/**
 * INSCRIPTION — an Ordinals envelope, decoded from raw Bitcoin witness bytes.
 *
 * Runes live in an OP_RETURN, which `parseTx` already hands to a decoder. An
 * ordinals inscription does not: it lives in the TAPROOT SCRIPT-PATH WITNESS of
 * its reveal transaction, inside an envelope
 *
 *     OP_FALSE OP_IF "ord" <tag,value>… OP_0 <body chunks…> OP_ENDIF
 *
 * carried in an UNEXECUTED branch, so it never affects the spend's validity — the
 * content is carried, not run. `ord` is normative for what an inscription id
 * resolves to; this module reproduces its envelope rules from bytes so an origin
 * binding can be PROVEN, not read from a trusted indexer.
 *
 * ── WHAT THIS DOES AND DOES NOT DO ──────────────────────────────────────────
 * It decodes the envelope: the protocol marker, the content-type (tag 1), the
 * concatenated body, and — the id — `<reveal_txid>i<index>`. It reads EXISTING
 * inscriptions off already-mined transactions, so BIP-110's proposed rule against
 * executing OP_IF (which would block NEW inscriptions) does not limit it.
 *
 * It deliberately does NOT track which satoshi an inscription rode, nor who owns
 * it now — that is ordinal sat-tracking, a separate and larger thing. An origin
 * binding proves existence and content; ownership is asserted with the binder's
 * signed consent and named as such (see docs/ORIGIN.md).
 *
 * Fail-closed: a malformed envelope yields nothing rather than a guess. Pure,
 * node:crypto only, no network.
 */
import { sha256d, toDisplayHex } from '../anchor/spv.ts'
import { createHash } from 'node:crypto'

/** The ordinals protocol marker, pushed right after OP_IF: the bytes "ord". */
const ORD = Buffer.from('ord', 'ascii')
const OP_FALSE = 0x00
const OP_IF = 0x63
const OP_ENDIF = 0x68
/** Tag 1 is the content-type; the rest ride in `tags` for a future reader. */
export const TAG_CONTENT_TYPE = 1
/** Tag 2 is the pointer — the sat offset in the reveal's outputs (`ord`). */
export const TAG_POINTER = 2
/** Tag 9 compresses the body — we cannot honestly display it without decoding. */
const TAG_CONTENT_ENCODING = 9
/** Tag 11 is a delegate — the body is not this inscription's own bytes. */
const TAG_DELEGATE = 11
/** The Tapscript element limit — a real inscription push never exceeds it. A push
 *  claiming more is non-standard, and reading it would over-read a crafted script. */
const MAX_PUSH = 520

/** One inscription found on a reveal transaction. */
export interface DecodedInscription {
  /** `<reveal_txid>i<index>` — the ordinals id, from the SIGNED reveal tx */
  id: string
  /** the media type (tag 1), or '' when the envelope carried none */
  contentType: string
  /** sha256 of the concatenated body, hex — the same hash KRAY inscriptions use */
  contentHash: string
  /** the body length in bytes */
  size: number
  /** the raw content bytes, so a caller can store them for custody */
  content: Buffer
  /** every tag/value pair seen, for a reader that grows to honour more of them */
  tags: Map<number, Buffer>
}

/** A minimal Bitcoin varint reader — value and the offset just past it. */
function readVarInt(buf: Buffer, at: number): { value: number; next: number } {
  const first = buf[at]
  if (first < 0xfd) return { value: first, next: at + 1 }
  if (first === 0xfd) return { value: buf.readUInt16LE(at + 1), next: at + 3 }
  if (first === 0xfe) return { value: buf.readUInt32LE(at + 1), next: at + 5 }
  throw new Error('inscription: varint too large for a transaction field')
}

/**
 * READ ONE SCRIPT ELEMENT at `at`: a data push (with its bytes) or a bare opcode.
 * Handles OP_0 (empty push), direct pushes 0x01..0x4b, and OP_PUSHDATA1/2/4.
 * Returns `data: null` for any non-push opcode (the caller decides what it means).
 */
function readElement(script: Buffer, at: number): { data: Buffer | null; opcode: number; next: number } {
  const op = script[at]
  if (op === OP_FALSE) return { data: Buffer.alloc(0), opcode: op, next: at + 1 } // OP_0 pushes empty
  // OP_1..OP_16 — ord writes small tag numbers this way (tag 1 = content-type, tag 13 = rune)
  if (op >= 0x51 && op <= 0x60) return { data: Buffer.from([op - 0x50]), opcode: op, next: at + 1 }
  if (op >= 0x01 && op <= 0x4b) return { data: script.subarray(at + 1, at + 1 + op), opcode: op, next: at + 1 + op }
  if (op === 0x4c) { const n = script[at + 1]; return { data: script.subarray(at + 2, at + 2 + n), opcode: op, next: at + 2 + n } }
  if (op === 0x4d) { const n = script.readUInt16LE(at + 1); return { data: script.subarray(at + 3, at + 3 + n), opcode: op, next: at + 3 + n } }
  if (op === 0x4e) { const n = script.readUInt32LE(at + 1); return { data: script.subarray(at + 5, at + 5 + n), opcode: op, next: at + 5 + n } }
  return { data: null, opcode: op, next: at + 1 } // a bare opcode (OP_IF, OP_ENDIF, OP_CHECKSIG…)
}

/**
 * PARSE A RAW TRANSACTION, RETAINING THE WITNESS. `parseTx` in spv.ts discards
 * witness bytes (it needs them only to compute the segwit txid); an inscription
 * lives THERE, so this keeps them. The txid is computed the same segwit-aware way
 * — sha256d of the serialization without marker/flag/witness — so the id derives
 * from the same txid Bitcoin's merkle tree commits to.
 */
export function parseTxWitness(rawTxHex: string): { txidDisplay: string; witnesses: Buffer[][] } {
  const raw = Buffer.from(rawTxHex, 'hex')
  let at = 4 // version
  const segwit = raw[at] === 0x00 && raw[at + 1] === 0x01
  if (segwit) at += 2
  const nIn = readVarInt(raw, at); at = nIn.next
  for (let i = 0; i < nIn.value; i++) {
    at += 36 // outpoint
    const sl = readVarInt(raw, at); at = sl.next + sl.value
    at += 4 // sequence
  }
  const nOut = readVarInt(raw, at); at = nOut.next
  for (let i = 0; i < nOut.value; i++) {
    at += 8 // amount
    const sl = readVarInt(raw, at); at = sl.next + sl.value
  }
  const witnessStart = at // the witness begins after the outputs — as spv.parseTx marks it
  const witnesses: Buffer[][] = []
  if (segwit) {
    for (let i = 0; i < nIn.value; i++) {
      const items = readVarInt(raw, at); at = items.next
      const stack: Buffer[] = []
      for (let j = 0; j < items.value; j++) {
        const l = readVarInt(raw, at)
        stack.push(Buffer.from(raw.subarray(l.next, l.next + l.value)))
        at = l.next + l.value
      }
      witnesses.push(stack)
    }
  } else {
    for (let i = 0; i < nIn.value; i++) witnesses.push([])
  }
  if (at + 4 !== raw.length) throw new Error('inscription: transaction did not parse to its exact length')
  const base = segwit
    ? Buffer.concat([raw.subarray(0, 4), raw.subarray(6, witnessStart), raw.subarray(raw.length - 4)])
    : raw
  return { txidDisplay: toDisplayHex(sha256d(base)), witnesses }
}

/**
 * THE TAPSCRIPT a script-path witness reveals. Taproot script-path witness is
 * `[…script inputs, script, control block]`, with an optional annex (a final item
 * beginning 0x50) stripped first. Fewer than two items after the annex means a
 * key-path spend — no script, no inscription.
 */
export function tapscriptOf(witness: Buffer[]): Buffer | null {
  let stack = witness
  if (stack.length >= 2 && stack[stack.length - 1].length > 0 && stack[stack.length - 1][0] === 0x50) {
    stack = stack.slice(0, -1) // drop the annex
  }
  if (stack.length < 2) return null
  return stack[stack.length - 2] // the script; the last item is the control block
}

/**
 * EVERY ORDINALS ENVELOPE IN ONE SCRIPT, in order. Scans for
 * `OP_FALSE OP_IF "ord" …` and reads tag/value pairs until an empty push (the
 * body separator), then body chunks until OP_ENDIF. Fail-closed: a truncated or
 * malformed envelope is skipped, never half-decoded.
 */
function scanEnvelopes(
  script: Buffer,
  skip: (tags: Map<number, Buffer>) => boolean,
): { contentType: string; content: Buffer; tags: Map<number, Buffer> }[] {
  const out: { contentType: string; content: Buffer; tags: Map<number, Buffer> }[] = []
  let at = 0
  while (at + 1 < script.length) {
    // seek the exact opening sequence: OP_FALSE, OP_IF, push("ord")
    if (script[at] !== OP_FALSE || script[at + 1] !== OP_IF) { at++; continue }
    let cur = at + 2
    try {
      // the marker read is INSIDE the try: a truncated push near the script end
      // must refuse this envelope, never throw out of the scan (a crafted tx is
      // an attempt, not a crash).
      const marker = readElement(script, cur)
      if (marker.data === null || !marker.data.equals(ORD)) { at++; continue }
      cur = marker.next
      const tags = new Map<number, Buffer>()
      let inBody = false
      const body: Buffer[] = []
      let closed = false
      while (cur < script.length) {
        if (script[cur] === OP_ENDIF) { closed = true; cur += 1; break }
        const el = readElement(script, cur)
        if (el.data === null) throw new Error('non-push in envelope')
        if (el.data.length > MAX_PUSH) throw new Error('push exceeds the tapscript element limit')
        cur = el.next
        if (!inBody) {
          if (el.data.length === 0) { inBody = true; continue } // the empty push separates header from body
          const valEl = readElement(script, cur)
          if (valEl.data === null) throw new Error('tag without a value')
          if (valEl.data.length > MAX_PUSH) throw new Error('tag value exceeds the element limit')
          cur = valEl.next
          const tagNum = el.data.length === 1 ? el.data[0] : Number('0x' + Buffer.from(el.data).reverse().toString('hex'))
          if (!tags.has(tagNum)) tags.set(tagNum, Buffer.from(valEl.data))
        } else {
          body.push(Buffer.from(el.data))
        }
      }
      if (!closed) throw new Error('envelope never closed with OP_ENDIF')
      at = cur
      if (skip(tags)) continue
      const ct = tags.get(TAG_CONTENT_TYPE)
      out.push({ contentType: ct ? ct.toString('latin1') : '', content: Buffer.concat(body), tags })
    } catch (_) {
      at += 2 // this envelope is malformed; resume the scan past its opener
    }
  }
  return out
}

export function envelopesInScript(script: Buffer): { contentType: string; content: Buffer; tags: Map<number, Buffer> }[] {
  // Consensus shape: content-type (1) and pointer (2) are the tags we can
  // re-derive from bytes. Pointer is the sat the inscription sits on — the
  // control walk lands there. Parent / metadata / encoding / delegate / unknown
  // tags change what `ord` reports (a delegate has no body of its own;
  // encoding compresses it), so those envelopes are SKIPPED rather than bound.
  return scanEnvelopes(script, (tags) => [...tags.keys()].some((t) => t !== TAG_CONTENT_TYPE && t !== TAG_POINTER))
}

/**
 * The pointer tag as `ord` encodes it: little-endian sat offset in the
 * reveal's output value space. Absent → null (the caller uses sat 0).
 * Overlong (>8 bytes) refuses rather than wrapping.
 */
export function pointerSatOf(tags: Map<number, Buffer>): bigint | null {
  const v = tags.get(TAG_POINTER)
  if (!v || v.length === 0) return null
  if (v.length > 8) return null
  let n = 0n
  for (let i = 0; i < v.length; i++) n |= BigInt(v[i]) << (8n * BigInt(i))
  return n
}

/** Absolute sat offset → (vout, offset-in-output), or null if past Σ outputs. */
export function satpointInOutputs(outputValues: readonly bigint[], abs: bigint): { vout: number; offset: bigint } | null {
  if (abs < 0n) return null
  let rem = abs
  for (let vout = 0; vout < outputValues.length; vout++) {
    const val = outputValues[vout]
    if (rem < val) return { vout, offset: rem }
    rem -= val
  }
  return null
}

/**
 * Explorer-only: keep the body when extra tags do not rewrite it.
 * Tag 13 (rune etch) is why a Signet parent like KRAY•SPACE is a WebP plus a
 * rune tag — consensus `envelopesInScript` still skips that for origin proofs.
 * Delegate / content-encoding still refuse: those are not this inscription's bytes.
 */
export function envelopesInScriptLoose(script: Buffer): { contentType: string; content: Buffer; tags: Map<number, Buffer> }[] {
  return scanEnvelopes(script, (tags) => tags.has(TAG_CONTENT_ENCODING) || tags.has(TAG_DELEGATE))
}

/**
 * EVERY INSCRIPTION ON A REVEAL TRANSACTION, numbered as ordinals numbers them:
 * across inputs in order, each envelope within a script in order, id
 * `<reveal_txid>i<index>`. Reads existing inscriptions from bytes; refuses
 * nothing — an absence of envelopes is simply an empty list.
 */
function collectInscriptions(
  rawTxHex: string,
  envelopesOf: (script: Buffer) => { contentType: string; content: Buffer; tags: Map<number, Buffer> }[],
): DecodedInscription[] {
  const { txidDisplay, witnesses } = parseTxWitness(rawTxHex)
  const found: DecodedInscription[] = []
  let index = 0
  for (const witness of witnesses) {
    const script = tapscriptOf(witness)
    if (!script) continue
    for (const env of envelopesOf(script)) {
      const contentHash = createHash('sha256').update(env.content).digest('hex')
      found.push({
        id: `${txidDisplay}i${index}`,
        contentType: env.contentType,
        contentHash,
        size: env.content.length,
        content: env.content,
        tags: env.tags,
      })
      index++
    }
  }
  return found
}

export function inscriptionsInTx(rawTxHex: string): DecodedInscription[] {
  return collectInscriptions(rawTxHex, envelopesInScript)
}

/** Explorer face of an L1 inscription — keeps rune-tagged (tag 13) bodies. Not for origin proofs. */
export function inscriptionsInTxLoose(rawTxHex: string): DecodedInscription[] {
  return collectInscriptions(rawTxHex, envelopesInScriptLoose)
}

/** The one inscription at `<txid>i<index>` on this reveal tx, or null. */
export function inscriptionAt(rawTxHex: string, index: number): DecodedInscription | null {
  return inscriptionsInTx(rawTxHex)[index] ?? null
}

export function inscriptionAtLoose(rawTxHex: string, index: number): DecodedInscription | null {
  return inscriptionsInTxLoose(rawTxHex)[index] ?? null
}
