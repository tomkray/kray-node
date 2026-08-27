/* KRAY-SPV — the Bitcoin burial proof, re-proven in YOUR browser.
 *
 * A dependency-free port of the load-bearing core of apps/kray-core/src/anchor/spv.ts: a raw tx hashes to
 * its txid (the segwit trap handled — the txid is sha256d of the base serialization, not the wtxid); that
 * txid is proven inside a BIP-37 partial merkle tree (with the CVE-2012-2459 duplicate-node refusal
 * verbatim); every 80-byte header is WEIGHED, not counted (target from nBits, work = 2^256/(target+1),
 * capped at the network's powLimit); and proveTxBuried combines them — so a green check is earned by WORK
 * the browser recomputed, never a `confirmed` boolean an explorer reported.
 *
 * Uses only WebCrypto SHA-256 + Uint8Array, so ONE file runs identically in a <script type="module"> and in
 * Node (the parity test + the offline CLI). Guarded by apps/kray-core/src/test/kray-spv-parity.test.ts:
 * byte-identical verdicts to spv.ts — one algorithm, two runtimes, forever. No node, no network, no trust.
 */

// ── bytes ──────────────────────────────────────────────────────────────────────────────────────
const h2b = (hex) => { const n = hex.length >> 1, b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16); return b }
const b2h = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0'); return s }
const rev = (b) => { const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b[b.length - 1 - i]; return o }
export const toDisplayHex = (b) => b2h(rev(b))
const eq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true }
const concat = (...arrs) => { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let at = 0; for (const a of arrs) { o.set(a, at); at += a.length } return o }
const u16 = (b, at) => b[at] | (b[at + 1] << 8)
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
const u32be = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
const u64 = (b, at) => { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[at + i]); return v }
const sha256 = async (b) => new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', b))
export const sha256d = async (b) => sha256(await sha256(b))

// ── headers ────────────────────────────────────────────────────────────────────────────────────
export async function parseHeader(raw) {
  if (raw.length !== 80) throw new Error(`kray-spv: a Bitcoin header is exactly 80 bytes, got ${raw.length}`)
  return { hashDisplay: toDisplayHex(await sha256d(raw)), prevDisplay: toDisplayHex(raw.subarray(4, 36)), merkleRootDisplay: toDisplayHex(raw.subarray(36, 68)) }
}

function readVarInt(buf, at) {
  const first = buf[at]
  if (first < 0xfd) return { value: first, next: at + 1 }
  if (first === 0xfd) return { value: u16(buf, at + 1), next: at + 3 }
  if (first === 0xfe) return { value: u32(buf, at + 1), next: at + 5 }
  throw new Error('kray-spv: varint too large for a merkle block')
}

// ── BIP-37 partial merkle tree (gettxoutproof) ───────────────────────────────────────────────────
export async function verifyTxOutProof(proofHex) {
  const raw = h2b(proofHex)
  if (raw.length < 80 + 4 + 1 + 1) throw new Error('kray-spv: txoutproof too short')
  const header = await parseHeader(raw.subarray(0, 80))
  let at = 80
  const totalTx = u32(raw, at); at += 4
  if (totalTx === 0 || totalTx > 10_000_000) throw new Error('kray-spv: absurd tx count in proof')
  const nHashes = readVarInt(raw, at); at = nHashes.next
  const hashes = []
  for (let i = 0; i < nHashes.value; i++) { hashes.push(raw.subarray(at, at + 32)); at += 32 }
  const nFlagBytes = readVarInt(raw, at); at = nFlagBytes.next
  const flagBytes = raw.subarray(at, at + nFlagBytes.value); at += nFlagBytes.value
  if (at !== raw.length) throw new Error('kray-spv: trailing bytes after the merkle proof')
  const flags = []
  for (let i = 0; i < nFlagBytes.value * 8; i++) flags.push(((flagBytes[i >> 3] >> (i & 7)) & 1) === 1)
  let height = 0
  while ((1 << height) < totalTx) height++
  let flagAt = 0, hashAt = 0
  const proven = [], positions = []
  const widthAt = (h) => Math.max(1, Math.ceil(totalTx / (1 << h)))
  async function walk(h, i) {
    if (flagAt >= flags.length) throw new Error('kray-spv: flag bits exhausted — malformed proof')
    const flag = flags[flagAt++]
    if (h === 0 || !flag) {
      if (hashAt >= hashes.length) throw new Error('kray-spv: hashes exhausted — malformed proof')
      const hash = hashes[hashAt++]
      if (h === 0 && flag) { proven.push(toDisplayHex(hash)); positions.push(i) }
      return hash
    }
    const left = await walk(h - 1, i * 2)
    const right = i * 2 + 1 < widthAt(h - 1) ? await walk(h - 1, i * 2 + 1) : left
    if (i * 2 + 1 < widthAt(h - 1) && eq(left, right)) throw new Error('kray-spv: duplicate node pair (CVE-2012-2459 shape) — refused')
    return sha256d(concat(left, right))
  }
  const root = await walk(height, 0)
  if (toDisplayHex(root) !== header.merkleRootDisplay) throw new Error('kray-spv: reconstructed merkle root does not match the header')
  if (proven.length === 0) throw new Error('kray-spv: the proof proves no transaction at all')
  return { header, headerHex: b2h(raw.subarray(0, 80)), provenTxids: proven, positions }
}

// ── raw transaction (segwit-stripped txid) ───────────────────────────────────────────────────────
export async function parseTx(rawTxHex) {
  const raw = h2b(rawTxHex)
  let at = 4
  const segwit = raw[at] === 0x00 && raw[at + 1] === 0x01
  if (segwit) at += 2
  const nIn = readVarInt(raw, at); at = nIn.next
  const inputs = []
  for (let i = 0; i < nIn.value; i++) {
    inputs.push({ txid: toDisplayHex(raw.subarray(at, at + 32)), vout: u32(raw, at + 32) })
    at += 36
    const sl = readVarInt(raw, at); at = sl.next + sl.value
    at += 4
  }
  const outputScripts = [], outputValues = []
  const nOut = readVarInt(raw, at); at = nOut.next
  for (let i = 0; i < nOut.value; i++) {
    outputValues.push(u64(raw, at)); at += 8
    const sl = readVarInt(raw, at)
    outputScripts.push(raw.subarray(sl.next, sl.next + sl.value))
    at = sl.next + sl.value
  }
  const witnessStart = at
  if (segwit) {
    for (let i = 0; i < nIn.value; i++) {
      const items = readVarInt(raw, at); at = items.next
      for (let j = 0; j < items.value; j++) { const l = readVarInt(raw, at); at = l.next + l.value }
    }
  }
  if (at + 4 !== raw.length) throw new Error('kray-spv: transaction did not parse to its exact length')
  const base = segwit ? concat(raw.subarray(0, 4), raw.subarray(6, witnessStart), raw.subarray(raw.length - 4)) : raw
  return { txidDisplay: toDisplayHex(await sha256d(base)), outputScripts, outputValues, inputs }
}

/** The exact 49-byte KRAY seal from a parsed OP_RETURN output — or null. */
export async function extractKraySeal(rawTxHex) {
  const { outputScripts } = await parseTx(rawTxHex)
  for (const script of outputScripts) {
    if (script.length !== 51 || script[0] !== 0x6a || script[1] !== 0x31) continue
    const payload = script.subarray(2)
    let tag = ''; for (let i = 0; i < 12; i++) tag += String.fromCharCode(payload[i])
    if (tag !== 'KRAY.NETWORK' || payload[12] !== 0x01) continue
    return { blockNumber: u32be(payload, 13), cascadeRoot: b2h(payload.subarray(17, 49)) }
  }
  return null
}

// ── proof of work (weight, never a count) ────────────────────────────────────────────────────────
export const MIN_BLOCK_WORK = { main: 1n << 74n, signet: 1n << 24n, test: 0n, regtest: 0n }
export const POW_LIMIT = {
  main: 0x00000000ffff0000000000000000000000000000000000000000000000000000n,
  test: 0x00000000ffff0000000000000000000000000000000000000000000000000000n,
  signet: 0x00000377ae000000000000000000000000000000000000000000000000000000n,
  regtest: 0x7fffff0000000000000000000000000000000000000000000000000000000000n,
}
export function targetFromBits(bits) {
  const exponent = bits >>> 24
  const mantissa = BigInt(bits & 0x007fffff)
  if ((bits & 0x00800000) !== 0) return null
  if (mantissa === 0n) return null
  if (exponent <= 3) return mantissa >> (8n * BigInt(3 - exponent))
  if (exponent > 32) return null
  return mantissa << (8n * BigInt(exponent - 3))
}
export function workOfTarget(target) {
  if (target <= 0n) return 0n
  return (1n << 256n) / (target + 1n)
}
export async function hashAsNumber(headerBytes) {
  const be = rev(await sha256d(headerBytes))
  return BigInt('0x' + b2h(be))
}
export async function checkProofOfWork(headerHex, net = 'main') {
  const bytes = h2b(headerHex)
  if (bytes.length !== 80) return { ok: false, reason: 'a header is exactly 80 bytes', work: 0n }
  const bits = u32(bytes, 72)
  const target = targetFromBits(bits)
  if (target === null) return { ok: false, reason: `nBits ${bits.toString(16)} is not a valid target`, work: 0n }
  const limit = POW_LIMIT[net] ?? POW_LIMIT.main
  if (target > limit) return { ok: false, reason: "the declared difficulty is easier than this network allows — invented difficulty, not Bitcoin's", work: 0n }
  const hash = await hashAsNumber(bytes)
  if (hash > target) return { ok: false, reason: "the header's hash does not meet the target it declares — no work was spent", work: 0n }
  return { ok: true, work: workOfTarget(target), target }
}

// ── the shared burial proof ──────────────────────────────────────────────────────────────────────
export async function proveTxBuried(rawTx, txoutproof, headersHex, opts) {
  if (!headersHex.length) return { ok: false, reason: 'no headers in the proof' }
  const txid = (await parseTx(rawTx)).txidDisplay
  const headers = []
  for (const h of headersHex) headers.push(await parseHeader(h2b(h)))
  const { header, provenTxids } = await verifyTxOutProof(txoutproof)
  if (header.hashDisplay !== headers[0].hashDisplay) return { ok: false, reason: 'the merkle proof belongs to a different block than header[0]' }
  if (!provenTxids.includes(txid)) return { ok: false, reason: 'the merkle proof does not prove THIS txid' }
  for (let i = 1; i < headers.length; i++) if (headers[i].prevDisplay !== headers[i - 1].hashDisplay) return { ok: false, reason: `header ${i} does not chain to header ${i - 1}` }
  const net = opts.net
  let work = 0n
  for (let i = 0; i < headersHex.length; i++) {
    const pow = await checkProofOfWork(headersHex[i], net)
    if (!pow.ok) return { ok: false, reason: `header ${i}: ${pow.reason}` }
    work += pow.work
  }
  const confirmations = headers.length
  if (confirmations < opts.minConfirmations) return { ok: false, reason: `proof shows only ${confirmations} confirmation(s), the law needs ${opts.minConfirmations}` }
  const floor = opts.minWork ?? BigInt(confirmations) * (MIN_BLOCK_WORK[net] ?? MIN_BLOCK_WORK.main)
  if (work < floor) return { ok: false, reason: `the proof carries ${work} of work where ${net} demands at least ${floor} for ${confirmations} block(s) — a header nobody paid for is not a confirmation` }
  return { ok: true, txid, confirmations, work, powMeaningful: net !== 'regtest', headers }
}

if (typeof globalThis !== 'undefined') {
  globalThis.KraySPV = { parseTx, parseHeader, verifyTxOutProof, extractKraySeal, targetFromBits, workOfTarget, hashAsNumber, checkProofOfWork, proveTxBuried, sha256d, toDisplayHex, MIN_BLOCK_WORK, POW_LIMIT }
}
