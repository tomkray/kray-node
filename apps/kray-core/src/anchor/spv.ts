/**
 * SPV — the seal, proven by Bitcoin's own mathematics, verifiable OFFLINE.
 *
 * "The seal confirmed on Bitcoin" was, until now, a fact the anchor log
 * asserted and the RPC observed. This module turns it into something any
 * replay can verify with no Bitcoin node at all:
 *
 *   txid = sha256d(rawTx)                       — the tx is exactly these bytes
 *   txid ∈ partial merkle tree → header.root    — the block truly contains it
 *   header_i+1.prev == sha256d(header_i)        — the chain truly buried it
 *   OP_RETURN == KRAY.NETWORK · height · root   — and what it seals is OUR root
 *
 * The proof material (raw tx + txoutproof + headers) is fetched once at
 * confirmation time and rides the anchor log forever.
 *
 * ── PROOF OF WORK, WHICH IS THE ONLY THING THAT MAKES DEPTH MEAN ANYTHING ───
 * An adversarial review found this file counting headers instead of weighing
 * them, and it was fatal: 5,000 chained headers were fabricated in TEN
 * MILLISECONDS with zero hashpower, and the fork-choice rule preferred them over
 * an honest chain. Anyone could have rewritten history for free. Counting
 * headers is not verifying Bitcoin — it is verifying that someone can run
 * sha256 twice.
 *
 * So every header is now weighed:
 *   sha256d(header) <= target(nBits)         the block really cost work
 *   target <= the network's own powLimit     the difficulty is not invented
 *   work = Σ ⌊2^256 / (target+1)⌋            depth is WEIGHT, never a count
 *
 * Weight is what defeats fabrication: one real mainnet block outweighs billions
 * of minimum-difficulty forgeries, so a chain that cost nothing wins nothing.
 * A count could always be faked; work cannot be, which is the whole reason
 * Bitcoin exists.
 *
 * Regtest difficulty is deliberately trivial, so PoW there proves nothing about
 * cost. The verdict says so out loud (`powMeaningful`) rather than letting a
 * development number be mistaken for security.
 *
 * Pure functions, node:crypto only. No float, no network, no trust.
 */
import { createHash } from 'node:crypto'
import { selfAnchorScriptHex, BURN_INTERNAL_KEY } from '../protocol/self-anchor.ts'
import { KrayAnchor } from './anchor.ts'

const sha256 = (b: Buffer): Buffer => createHash('sha256').update(b).digest()
/** Bitcoin's double-SHA256. */
export const sha256d = (b: Buffer): Buffer => sha256(sha256(b))
/** Internal byte order → the display (RPC) hex, and back. */
export const toDisplayHex = (b: Buffer): string => Buffer.from(b).reverse().toString('hex')
export const fromDisplayHex = (hex: string): Buffer => Buffer.from(hex, 'hex').reverse()

/** One parsed 80-byte header. */
export interface BtcHeader {
  hashDisplay: string // sha256d of the 80 bytes, display order
  prevDisplay: string // the previous block hash it commits to, display order
  merkleRootDisplay: string
}

/** Parse one 80-byte Bitcoin block header. Throws on wrong size. */
export function parseHeader(raw: Buffer): BtcHeader {
  if (raw.length !== 80) throw new Error(`spv: a Bitcoin header is exactly 80 bytes, got ${raw.length}`)
  return {
    hashDisplay: toDisplayHex(sha256d(raw)),
    prevDisplay: toDisplayHex(raw.subarray(4, 36)),
    merkleRootDisplay: toDisplayHex(raw.subarray(36, 68)),
  }
}

/** A minimal Bitcoin varint reader. */
function readVarInt(buf: Buffer, at: number): { value: number; next: number } {
  const first = buf[at]
  if (first < 0xfd) return { value: first, next: at + 1 }
  if (first === 0xfd) return { value: buf.readUInt16LE(at + 1), next: at + 3 }
  if (first === 0xfe) return { value: buf.readUInt32LE(at + 1), next: at + 5 }
  // 8-byte counts cannot occur in a merkleblock of a real chain — refuse
  throw new Error('spv: varint too large for a merkle block')
}

/**
 * VERIFY A `gettxoutproof` MERKLE BLOCK (BIP-37 partial merkle tree).
 *
 * Returns the txids it PROVES (display order) — the caller checks its txid is
 * among them AND that the embedded header is the expected one. Fail-closed on
 * any malformation: a proof that cannot be parsed proves nothing.
 */
export function verifyTxOutProof(proofHex: string): { header: BtcHeader; headerHex: string; provenTxids: string[]; positions: number[] } {
  const raw = Buffer.from(proofHex, 'hex')
  if (raw.length < 80 + 4 + 1 + 1) throw new Error('spv: txoutproof too short')
  const header = parseHeader(raw.subarray(0, 80))
  let at = 80
  const totalTx = raw.readUInt32LE(at); at += 4
  if (totalTx === 0 || totalTx > 10_000_000) throw new Error('spv: absurd tx count in proof')
  const nHashes = readVarInt(raw, at); at = nHashes.next
  const hashes: Buffer[] = []
  for (let i = 0; i < nHashes.value; i++) { hashes.push(Buffer.from(raw.subarray(at, at + 32))); at += 32 }
  const nFlagBytes = readVarInt(raw, at); at = nFlagBytes.next
  const flagBytes = raw.subarray(at, at + nFlagBytes.value); at += nFlagBytes.value
  if (at !== raw.length) throw new Error('spv: trailing bytes after the merkle proof')
  const flags: boolean[] = []
  for (let i = 0; i < nFlagBytes.value * 8; i++) flags.push(((flagBytes[i >> 3] >> (i & 7)) & 1) === 1)

  // tree height: the smallest tree that fits totalTx leaves
  let height = 0
  while ((1 << height) < totalTx) height++

  let flagAt = 0
  let hashAt = 0
  const proven: string[] = []
  const positions: number[] = []
  const widthAt = (h: number) => Math.max(1, Math.ceil(totalTx / (1 << h)))
  // BIP-37 depth-first reconstruction — returns the node hash at (height h, index i)
  function walk(h: number, i: number): Buffer {
    if (flagAt >= flags.length) throw new Error('spv: flag bits exhausted — malformed proof')
    const flag = flags[flagAt++]
    if (h === 0 || !flag) {
      if (hashAt >= hashes.length) throw new Error('spv: hashes exhausted — malformed proof')
      const hash = hashes[hashAt++]
      if (h === 0 && flag) { proven.push(toDisplayHex(hash)); positions.push(i) } // a MATCHED leaf: its txid AND its index in the block
      return hash
    }
    const left = walk(h - 1, i * 2)
    const right = i * 2 + 1 < widthAt(h - 1) ? walk(h - 1, i * 2 + 1) : left
    if (i * 2 + 1 < widthAt(h - 1) && left.equals(right)) throw new Error('spv: duplicate node pair (CVE-2012-2459 shape) — refused')
    return sha256d(Buffer.concat([left, right]))
  }
  const root = walk(height, 0)
  if (toDisplayHex(root) !== header.merkleRootDisplay) throw new Error('spv: reconstructed merkle root does not match the header')
  if (proven.length === 0) throw new Error('spv: the proof proves no transaction at all')
  // the header's own 80 bytes ride along, so a caller can WEIGH the block that
  // buried this transaction instead of taking its existence on faith
  return { header, headerHex: raw.subarray(0, 80).toString('hex'), provenTxids: proven, positions }
}

/**
 * PARSE A RAW TRANSACTION — enough of Bitcoin's serialization to compute the
 * TXID correctly and read the outputs structurally.
 *
 * THE SEGWIT TRAP this exists for: hashing the full bytes of a segwit tx gives
 * the WTXID; the txid Bitcoin's merkle tree commits to is sha256d of the
 * serialization WITHOUT the marker/flag/witness. An anchor paid by a taproot
 * wallet is always segwit, so a naive hash would never match its own proof.
 */
export interface TxInput { txid: string; vout: number }
export function parseTx(rawTxHex: string): { txidDisplay: string; outputScripts: Buffer[]; outputValues: bigint[]; inputs: TxInput[] } {
  const raw = Buffer.from(rawTxHex, 'hex')
  let at = 4 // version
  const segwit = raw[at] === 0x00 && raw[at + 1] === 0x01
  if (segwit) at += 2
  const vinStart = at
  const nIn = readVarInt(raw, at); at = nIn.next
  const inputs: TxInput[] = []
  for (let i = 0; i < nIn.value; i++) {
    inputs.push({ txid: toDisplayHex(raw.subarray(at, at + 32)), vout: raw.readUInt32LE(at + 32) })
    at += 36 // outpoint
    const sl = readVarInt(raw, at); at = sl.next + sl.value
    at += 4 // sequence
  }
  const outputScripts: Buffer[] = []
  // the AMOUNTS matter now, not only the scripts: a fee is Σ inputs − Σ outputs,
  // and a fee nobody can compute is a payment nobody can prove
  const outputValues: bigint[] = []
  const nOut = readVarInt(raw, at); at = nOut.next
  for (let i = 0; i < nOut.value; i++) {
    outputValues.push(raw.readBigUInt64LE(at))
    at += 8 // amount
    const sl = readVarInt(raw, at)
    outputScripts.push(Buffer.from(raw.subarray(sl.next, sl.next + sl.value)))
    at = sl.next + sl.value
  }
  const witnessStart = at
  if (segwit) {
    for (let i = 0; i < nIn.value; i++) {
      const items = readVarInt(raw, at); at = items.next
      for (let j = 0; j < items.value; j++) { const l = readVarInt(raw, at); at = l.next + l.value }
    }
  }
  if (at + 4 !== raw.length) throw new Error('spv: transaction did not parse to its exact length')
  const base = segwit
    ? Buffer.concat([raw.subarray(0, 4), raw.subarray(6, witnessStart), raw.subarray(raw.length - 4)])
    : raw
  return { txidDisplay: toDisplayHex(sha256d(base)), outputScripts, outputValues, inputs }
}

/** The exact 49-byte KRAY seal from a parsed OP_RETURN output — or null. */
export function extractKraySeal(rawTxHex: string): { blockNumber: number; cascadeRoot: string } | null {
  for (const script of parseTx(rawTxHex).outputScripts) {
    // OP_RETURN (0x6a) + push 49 (0x31) + "KRAY.NETWORK" + 0x01 + height(4 BE) + root(32)
    if (script.length !== 51 || script[0] !== 0x6a || script[1] !== 0x31) continue
    const payload = script.subarray(2)
    if (payload.subarray(0, 12).toString('ascii') !== 'KRAY.NETWORK' || payload[12] !== 0x01) continue
    return { blockNumber: payload.readUInt32BE(13), cascadeRoot: payload.subarray(17, 49).toString('hex') }
  }
  return null
}

/** Everything an offline verifier needs to re-prove one confirmed seal. */
export interface SealProof {
  rawTx: string // the anchor transaction, exact bytes, hex
  txoutproof: string // BIP-37 merkle block from `gettxoutproof`, hex
  headers: string[] // 80-byte headers, hex: the containing block, then each block on top
  /** THE COINBASE OF THE SEALING BLOCK, and its merkle path — how a light
   *  verifier learns the block's HEIGHT without asking anyone.
   *
   *  Bitcoin has committed the height inside the coinbase's scriptSig since
   *  BIP-34 (2012), so the height is not a number someone reports: it is bytes
   *  inside a transaction proven to be in a block proven to cost work. This is
   *  what lets the emission law be a CLOCK — an interval may only be settled once
   *  Bitcoin has actually reached the height that released it. */
  coinbaseTx?: string
  coinbaseProof?: string
}

export interface SealVerdict {
  ok: boolean
  reason?: string
  txid?: string
  confirmations?: number // how many blocks the proof shows on top
  /** THE REAL DEPTH: cumulative proof-of-work, as a BigInt. A count can be
   *  fabricated; this cannot. Fork choice must compare THIS. */
  work?: bigint
  /** false on regtest, where difficulty is trivial by design — so nobody
   *  mistakes a development number for Bitcoin's weight */
  powMeaningful?: boolean
  /** the sealing block's Bitcoin HEIGHT, proven from its coinbase (BIP-34).
   *  Absent when the proof carries no coinbase — and then no clock can be read
   *  from it, which the reducer treats as "released nothing". */
  btcHeight?: number
  sealedBlockNumber?: number
  sealedCascadeRoot?: string
}

/**
 * THE LEAST WORK A BLOCK ON THIS NETWORK MAY PLAUSIBLY HAVE COST.
 *
 * A powLimit floor alone was not enough, and an adversarial review found exactly
 * why: mainnet's powLimit IS difficulty 1, so a header costing 4,295,032,833
 * hashes passed — 43 MICROSECONDS on a single 100 TH/s ASIC. Fork choice survived
 * that (one real block outweighs 92 trillion such forgeries) but the CLOCK did
 * not: it counts confirmations and reads its height from a coinbase the same
 * attacker forges, so two fake headers claiming height 7,000,000 would have
 * released the entire emission ladder for less than a second of hashing.
 *
 * So a proof must now carry work per header comparable to what the network really
 * costs. These floors are set an order of magnitude BELOW current difficulty, so
 * they stay valid across decades of ordinary variation, while sitting trillions of
 * times above the difficulty-1 floor that made forgery free.
 *
 * Testnet is deliberately exempt: its 20-minute rule resets difficulty to 1 by
 * design, so a floor there would reject honest blocks. Regtest is exempt because
 * its work means nothing at all, which `powMeaningful` already says out loud.
 */
export const MIN_BLOCK_WORK: Record<string, bigint> = {
  // 2^74 ≈ 1.9e22 → difficulty ≈ 4.4e12, which mainnet passed in 2022 and is
  // ~25× below today. Forging one such header costs ~5 hours at 1 EH/s.
  main: 1n << 74n,
  // signet's real blocks carry ~2.06e8 ≈ 2^27.6 of work; this sits ~12× below.
  signet: 1n << 24n,
  test: 0n, // the 20-minute rule legitimately drops to difficulty 1
  regtest: 0n, // trivial by design
}

/** The easiest target each network permits — a target above this is invented
 *  difficulty, not Bitcoin's. */
export const POW_LIMIT: Record<string, bigint> = {
  // mainnet & testnet: 0x1d00ffff
  main: 0x00000000ffff0000000000000000000000000000000000000000000000000000n,
  test: 0x00000000ffff0000000000000000000000000000000000000000000000000000n,
  // signet: 0x1e0377ae
  signet: 0x00000377ae000000000000000000000000000000000000000000000000000000n,
  // regtest: 0x207fffff — trivial ON PURPOSE, which is why powMeaningful is false
  regtest: 0x7fffff0000000000000000000000000000000000000000000000000000000000n,
}

/**
 * DECODE nBits INTO A TARGET, exactly as Bitcoin does: an 8-bit exponent and a
 * 24-bit mantissa. A negative or overflowing encoding is refused rather than
 * clamped — a malformed target is an attempt, not an accident.
 */
export function targetFromBits(bits: number): bigint | null {
  const exponent = bits >>> 24
  const mantissa = BigInt(bits & 0x007fffff)
  if ((bits & 0x00800000) !== 0) return null // negative target: never valid
  if (mantissa === 0n) return null
  if (exponent <= 3) return mantissa >> (8n * BigInt(3 - exponent))
  if (exponent > 32) return null // beyond 256 bits
  return mantissa << (8n * BigInt(exponent - 3))
}

/** A block's work: how many hashes it cost, in expectation. ⌊2^256/(target+1)⌋ */
export function workOfTarget(target: bigint): bigint {
  if (target <= 0n) return 0n
  return (1n << 256n) / (target + 1n)
}

/** The header's own hash, read as Bitcoin reads it: a little-endian integer. */
export function hashAsNumber(headerBytes: Buffer): bigint {
  const be = Buffer.from(sha256d(headerBytes)).reverse()
  return BigInt('0x' + be.toString('hex'))
}

/**
 * DID THIS BLOCK REALLY COST WORK? Two questions, both necessary: does its hash
 * meet the target it declares, and is that target within what the network
 * permits? The first alone would let an attacker declare difficulty 1 and grind
 * cheap headers; the second alone would let them declare a hard target and never
 * meet it.
 */
export function checkProofOfWork(headerHex: string, net = 'main'): { ok: boolean; reason?: string; work: bigint; target?: bigint } {
  const bytes = Buffer.from(headerHex, 'hex')
  if (bytes.length !== 80) return { ok: false, reason: 'a header is exactly 80 bytes', work: 0n }
  const bits = bytes.readUInt32LE(72)
  const target = targetFromBits(bits)
  if (target === null) return { ok: false, reason: `nBits ${bits.toString(16)} is not a valid target`, work: 0n }
  const limit = POW_LIMIT[net] ?? POW_LIMIT.main
  if (target > limit) return { ok: false, reason: 'the declared difficulty is easier than this network allows — invented difficulty, not Bitcoin\'s', work: 0n }
  const hash = hashAsNumber(bytes)
  if (hash > target) return { ok: false, reason: 'the header\'s hash does not meet the target it declares — no work was spent', work: 0n }
  return { ok: true, work: workOfTarget(target), target }
}

/**
 * THE BLOCK'S OWN HEIGHT, READ FROM ITS COINBASE — BIP-34.
 *
 * Since 2012 every Bitcoin block commits its height as the first push of the
 * coinbase's scriptSig, minimally encoded as a signed little-endian script
 * number. So a light verifier can learn WHEN a block happened from the block
 * itself, with nobody to ask and nothing to trust. Without this, "Bitcoin's
 * clock" would be whatever number a node reported.
 *
 * Returns null on anything malformed — a height that cannot be read is not a
 * height, and the caller must treat it as no clock at all.
 */
export function bip34Height(rawCoinbaseTx: string): number | null {
  try {
    const tx = Buffer.from(rawCoinbaseTx, 'hex')
    let o = 4 // version
    if (tx[o] === 0x00 && tx[o + 1] === 0x01) o += 2 // segwit marker+flag
    const [nIn, afterCount] = readVarIntAt(tx, o)
    if (nIn !== 1n) return null // a coinbase has exactly one input
    o = afterCount + 32 + 4 // prevout hash (must be null) + index
    const [scriptLen, afterLen] = readVarIntAt(tx, o)
    o = afterLen
    if (scriptLen < 1n) return null
    const pushLen = tx[o]
    // OP_1..OP_16 encode heights 1..16 directly
    if (pushLen >= 0x51 && pushLen <= 0x60) return pushLen - 0x50
    if (pushLen < 1 || pushLen > 5) return null // a height needs 1..5 bytes
    const bytes = tx.subarray(o + 1, o + 1 + pushLen)
    if (bytes.length !== pushLen) return null
    let n = 0
    for (let i = bytes.length - 1; i >= 0; i--) n = n * 256 + bytes[i]
    return n
  } catch (_) { return null }
}

/** A varint at an offset: its value and the offset just past it. */
function readVarIntAt(b: Buffer, o: number): [bigint, number] {
  const first = b[o]
  if (first < 0xfd) return [BigInt(first), o + 1]
  if (first === 0xfd) return [BigInt(b.readUInt16LE(o + 1)), o + 3]
  if (first === 0xfe) return [BigInt(b.readUInt32LE(o + 1)), o + 5]
  return [b.readBigUInt64LE(o + 1), o + 9]
}

/**
 * THE SHARED BURIAL PROOF — the L1 foundation both the seal and the donation stand on.
 * A raw tx hashes to a txid; that txid is proven inside header[0]'s merkle tree; the
 * headers chain prev→hash; every header cost real work (PoW within the network's limit);
 * and the pile is deep enough AND heavy enough (a confirmation is a burial, never a count).
 * Returns the proven txid + cumulative work + the parsed headers, or the first reason it
 * is not proven. No Bitcoin node, no network, no trust — only bytes and arithmetic.
 */
export function proveTxBuried(
  rawTx: string,
  txoutproof: string,
  headersHex: string[],
  opts: { net: string; minConfirmations: number; minWork?: bigint },
):
  | { ok: true; txid: string; confirmations: number; work: bigint; powMeaningful: boolean; headers: BtcHeader[] }
  | { ok: false; reason: string } {
  if (!headersHex.length) return { ok: false, reason: 'no headers in the proof' }
  const txid = parseTx(rawTx).txidDisplay
  const headers = headersHex.map((h) => parseHeader(Buffer.from(h, 'hex')))
  const { header, provenTxids } = verifyTxOutProof(txoutproof)
  if (header.hashDisplay !== headers[0].hashDisplay) return { ok: false, reason: 'the merkle proof belongs to a different block than header[0]' }
  if (!provenTxids.includes(txid)) return { ok: false, reason: 'the merkle proof does not prove THIS txid' }
  for (let i = 1; i < headers.length; i++) {
    if (headers[i].prevDisplay !== headers[i - 1].hashDisplay) return { ok: false, reason: `header ${i} does not chain to header ${i - 1}` }
  }
  // EVERY header must have cost work. Without this the chain above is just a
  // linked list, and a linked list is free to make.
  const net = opts.net
  let work = 0n
  for (let i = 0; i < headersHex.length; i++) {
    const pow = checkProofOfWork(headersHex[i], net)
    if (!pow.ok) return { ok: false, reason: `header ${i}: ${pow.reason}` }
    work += pow.work
  }
  const confirmations = headers.length // containing block + each buried block on top
  if (confirmations < opts.minConfirmations) return { ok: false, reason: `proof shows only ${confirmations} confirmation(s), the law needs ${opts.minConfirmations}` }
  // THE FLOOR IS NOT OPTIONAL. Every header must have cost what this network's
  // headers really cost, or a confirmation is a number rather than a burial.
  const floor = opts.minWork ?? BigInt(confirmations) * (MIN_BLOCK_WORK[net] ?? MIN_BLOCK_WORK.main)
  if (work < floor) return { ok: false, reason: `the proof carries ${work} of work where ${net} demands at least ${floor} for ${confirmations} block(s) — a header nobody paid for is not a confirmation` }
  return { ok: true, txid, confirmations, work, powMeaningful: net !== 'regtest', headers }
}

/** Everything an offline verifier needs to re-prove ONE confirmed proof-of-donation:
 *  a real Bitcoin payment to the anchoring pot, buried under work, committing the donor. */
export interface DonationProof {
  rawTx: string // the donation transaction, exact bytes, hex (pays the pot + an OP_RETURN donor)
  txoutproof: string // BIP-37 merkle block proving the txid, hex (from `gettxoutproof`)
  headers: string[] // 80-byte headers: the containing block, then each block on top
}
export interface DonationVerdict {
  ok: boolean
  reason?: string
  outpoint?: string // txid:vout of the pot-paying output — the credit key (credited once, ever)
  sats?: bigint // the value paid to the pot — the PROVEN donation, read from the chain not a client
  donor?: string // the KRAY address to credit, committed in the tx's OP_RETURN
  confirmations?: number
  work?: bigint
}

/**
 * THE DONOR COMMITMENT — the exact OP_RETURN output a donation carries so the node knows whom
 * to credit: 0x6a <push> <ascii KRAY address>. verifyDonationProof reads precisely this back.
 * ONE construction, shared by the client that builds the payment and the node that verifies it,
 * so the two can never disagree — the immutable math ties both ends. A donor address that would
 * not fit a single-push OP_RETURN is refused rather than truncated (a truncated donor is a
 * different donor). Any wallet backend building the payment must emit these identical bytes.
 */
export function donorOpReturnScriptHex(donorAddress: string): string {
  const data = Buffer.from(donorAddress, 'ascii')
  if (data.length < 8 || data.length > 75) throw new Error(`donor address must be 8..75 bytes for a single-push OP_RETURN (got ${data.length})`)
  return '6a' + data.length.toString(16).padStart(2, '0') + data.toString('hex')
}

/**
 * THE PROOF-OF-DONATION, RE-PROVEN FROM BYTES — mirrors the rune deposit: value entering
 * from Bitcoin L1 is proven by L1's own work, never by an L2 signature. The tx is buried
 * under work (proveTxBuried); one of its outputs pays the anchoring pot (the sats minted are
 * that output's REAL value, not a number the client sent); and an OP_RETURN commits the KRAY
 * address to credit. The reducer then mints min(sats, deficit), credited once per outpoint.
 */
export function verifyDonationProof(
  proof: DonationProof,
  expect: { potScriptHex: string; minConfirmations: number; net: string; minWork?: bigint },
): DonationVerdict {
  try {
    const buried = proveTxBuried(proof.rawTx, proof.txoutproof, proof.headers, {
      net: expect.net, minConfirmations: expect.minConfirmations, minWork: expect.minWork,
    })
    if (!buried.ok) return { ok: false, reason: buried.reason }
    const { outputScripts, outputValues } = parseTx(proof.rawTx)
    // the sats minted are the REAL value of the output that pays the pot — not a client field
    const potScript = Buffer.from(expect.potScriptHex, 'hex')
    let potIdx = -1
    for (let i = 0; i < outputScripts.length; i++) { if (outputScripts[i].equals(potScript)) { potIdx = i; break } }
    if (potIdx < 0) return { ok: false, reason: 'no output pays the anchoring pot — this is not a donation to KRAY.NETWORK' }
    const sats = outputValues[potIdx]
    if (sats <= 0n) return { ok: false, reason: 'the pot output pays zero — a donation mints nothing' }
    // the donor's KRAY address is committed in an OP_RETURN (0x6a) as the ASCII bech32(m) address
    let donor: string | null = null
    for (const s of outputScripts) {
      if (s.length < 2 || s[0] !== 0x6a) continue // OP_RETURN only
      const pushLen = s[1]
      if (pushLen < 0x01 || pushLen > 0x4b) continue // a single direct data push
      const data = s.subarray(2, 2 + pushLen)
      if (data.length !== pushLen) continue
      const addr = data.toString('ascii')
      if (/^(bc1|tb1|bcrt1)[0-9a-z]{20,}$/.test(addr)) { donor = addr; break }
    }
    if (!donor) return { ok: false, reason: 'no donor KRAY address committed in an OP_RETURN — nobody to credit' }
    return { ok: true, outpoint: `${buried.txid}:${potIdx}`, sats, donor, confirmations: buried.confirmations, work: buried.work }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * THE WHOLE SEAL, RE-PROVEN FROM BYTES — no Bitcoin node, no network, no trust:
 * tx hashes to txid → txid proven inside header[0] → headers chain →
 * OP_RETURN carries the expected root at the expected KRAY height.
 */
export function verifySealProof(
  proof: SealProof,
  expect: { cascadeRoot: string; blockNumber: number; minConfirmations: number; net?: string; minWork?: bigint },
): SealVerdict {
  try {
    const txid = parseTx(proof.rawTx).txidDisplay
    // A KRAY seal is proven ONE OF TWO WAYS, and both are re-derived from the raw bytes here (never trusted):
    //   1) an OP_RETURN carrying KRAY.NETWORK|ver|blockNumber|cascadeRoot   (the operator anchor)
    //   2) an OUTPUT that pays the keyless NUMS key tweaked by (blockNumber, cascadeRoot)  (a self-anchoring burn
    //      donation — the anchor rides the output key, no OP_RETURN needed). Same burial law, same work, same weight.
    let sealedBlockNumber, sealedCascadeRoot
    const seal = extractKraySeal(proof.rawTx)
    if (seal) {
      if (seal.cascadeRoot !== expect.cascadeRoot.toLowerCase()) return { ok: false, reason: `sealed root ${seal.cascadeRoot.slice(0, 12)}… is not the promised ${expect.cascadeRoot.slice(0, 12)}…` }
      if (seal.blockNumber !== expect.blockNumber) return { ok: false, reason: `sealed height ${seal.blockNumber} is not the promised ${expect.blockNumber}` }
      sealedBlockNumber = seal.blockNumber; sealedCascadeRoot = seal.cascadeRoot
    } else {
      // self-anchor: recompute the exact burn script for the CLAIMED (blockNumber, root) and require an output to pay it.
      const root = expect.cascadeRoot.toLowerCase()
      let expectScript
      try { expectScript = selfAnchorScriptHex(BURN_INTERNAL_KEY, KrayAnchor.payload(expect.blockNumber, root)) } catch { return { ok: false, reason: 'malformed self-anchor expectation (blockNumber/root)' } }
      const pays = parseTx(proof.rawTx).outputScripts.some((s) => s.toString('hex') === expectScript)
      if (!pays) return { ok: false, reason: 'no KRAY.NETWORK OP_RETURN, and no self-anchor output commits this (blockNumber, root)' }
      sealedBlockNumber = expect.blockNumber; sealedCascadeRoot = root
    }
    // the merkle proof, the header chain, the work floor, the confirmations — the shared burial
    const net = expect.net ?? 'main'
    const buried = proveTxBuried(proof.rawTx, proof.txoutproof, proof.headers, { net, minConfirmations: expect.minConfirmations, minWork: expect.minWork })
    if (!buried.ok) return { ok: false, reason: buried.reason }
    const { confirmations, work, powMeaningful, headers } = buried
    // THE CLOCK, if the proof carries it: the coinbase must be proven to sit in
    // this very block, and its BIP-34 height is then Bitcoin's own statement of
    // when this happened. A coinbase proven against a different block, or one
    // whose height cannot be read, yields no clock at all rather than a guess.
    let btcHeight: number | undefined
    if (proof.coinbaseTx && proof.coinbaseProof) {
      const cbTxid = parseTx(proof.coinbaseTx).txidDisplay
      const cbProof = verifyTxOutProof(proof.coinbaseProof)
      if (cbProof.header.hashDisplay !== headers[0].hashDisplay) {
        return { ok: false, reason: 'the coinbase proof belongs to a different block than the seal' }
      }
      if (!cbProof.provenTxids.includes(cbTxid)) return { ok: false, reason: 'the coinbase proof does not prove the coinbase' }
      if (cbProof.positions?.[cbProof.provenTxids.indexOf(cbTxid)] !== 0) {
        return { ok: false, reason: 'the claimed coinbase is not at index 0 — only the first transaction of a block is its coinbase' }
      }
      const h = bip34Height(proof.coinbaseTx)
      if (h === null) return { ok: false, reason: 'the coinbase carries no readable BIP-34 height' }
      btcHeight = h
    }
    return { ok: true, txid, confirmations, work, powMeaningful, btcHeight, sealedBlockNumber, sealedCascadeRoot }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
