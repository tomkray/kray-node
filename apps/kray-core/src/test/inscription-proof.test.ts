/**
 * INSCRIPTION PROOF — an L1 inscription proven from bytes, every forgery refused.
 *   node src/test/inscription-proof.test.ts
 *
 * Buries a real reveal transaction in a mined regtest block (a header that
 * satisfies its own target, a BIP-37 merkle proof, burying headers that chain)
 * and proves proveInscription accepts the truth and names each lie: a shallow
 * burial, a header nobody mined, a txid the proof does not cover, and an index
 * that carries no envelope.
 */
import { createHash } from 'node:crypto'
import { proveInscription } from '../protocol/inscription-proof.ts'
import { parseTxWitness } from '../protocol/inscription.ts'
import { checkProofOfWork, sha256d } from '../anchor/spv.ts'
import type { ProvenTx } from '../protocol/rune-ancestry.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
const sha256hex = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

// ── envelope + reveal-tx builders (self-contained, like the other fixtures) ──
function push(data: Buffer): Buffer {
  const L = data.length
  if (L === 0) return Buffer.from([0x00])
  if (L <= 0x4b) return Buffer.concat([Buffer.from([L]), data])
  if (L <= 0xff) return Buffer.concat([Buffer.from([0x4c, L]), data])
  const p = Buffer.alloc(3); p[0] = 0x4d; p.writeUInt16LE(L, 1); return Buffer.concat([p, data])
}
function envelope(contentType: string, content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x63]), push(Buffer.from('ord')),
    push(Buffer.from([0x01])), push(Buffer.from(contentType, 'latin1')),
    Buffer.from([0x00]), push(content), Buffer.from([0x68]),
  ])
}
function varint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n])
  const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b
}
const witItem = (b: Buffer): Buffer => Buffer.concat([varint(b.length), b])
function revealTx(script: Buffer): string {
  const stack = [script, Buffer.concat([Buffer.from([0xc0]), Buffer.alloc(32, 0xef)])]
  const vin = Buffer.concat([varint(1), Buffer.alloc(32, 0x11), Buffer.from('00000000', 'hex'), varint(0), Buffer.from('ffffffff', 'hex')])
  const spk = Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, 0xcd)])
  const vout = Buffer.concat([varint(1), Buffer.alloc(8), varint(spk.length), spk])
  const witness = Buffer.concat([varint(stack.length), ...stack.map(witItem)])
  return Buffer.concat([Buffer.from('02000000', 'hex'), Buffer.from('0001', 'hex'), vin, vout, witness, Buffer.from('00000000', 'hex')]).toString('hex')
}
const scriptWith = (...envs: Buffer[]): Buffer => Buffer.concat([push(Buffer.alloc(32, 0xab)), Buffer.from([0xac]), ...envs])

// ── mine a regtest block burying the reveal tx, N confirmations deep ─────────
let salt = 0
function mine(prevInternal: Buffer, rootInternal: Buffer): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); rootInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000 + (salt++), 68); h.writeUInt32LE(0x207fffff, 72)
  for (let nonce = 0; nonce < 1_000_000; nonce++) { h.writeUInt32LE(nonce, 76); if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h }
  throw new Error('could not mine')
}
/** a single-tx block containing `rawTx`, with `confirmations` headers on top */
function bury(rawTx: string, confirmations: number): { bundle: ProvenTx[]; txid: string } {
  const txid = parseTxWitness(rawTx).txidDisplay
  const txidInternal = Buffer.from(txid, 'hex').reverse()
  const h0 = mine(Buffer.alloc(32), txidInternal) // 1-tx block: merkle root = the txid
  const headers = [h0]
  for (let i = 1; i < confirmations; i++) headers.push(mine(sha256d(headers[i - 1]), createHash('sha256').update(`${txid}:${i}`).digest()))
  const txoutproof = Buffer.concat([h0, Buffer.from('01000000', 'hex'), Buffer.from([0x01]), txidInternal, Buffer.from([0x01, 0x01])]).toString('hex')
  return { bundle: [{ rawTx, txoutproof, headers: headers.map((h) => h.toString('hex')) }], txid }
}

// ── 1 · a lawfully buried inscription proves clean ───────────────────────────
{
  const content = Buffer.from('proven from bytes', 'utf8')
  const rawTx = revealTx(scriptWith(envelope('text/plain', content)))
  const { bundle, txid } = bury(rawTx, 6)
  const v = proveInscription(txid, 0, bundle, { minConfirmations: 6, net: 'regtest' })
  ok(v.ok, 'a buried inscription proves ok')
  ok(v.inscriptionId === `${txid}i0`, 'the id is <reveal txid>i0')
  ok(v.contentType === 'text/plain', 'content-type proven')
  ok(v.contentHash === sha256hex(content), 'contentHash proven from bytes')
  ok(v.confirmations === 6, 'confirmations reported')
}

// ── 2 · a shallow burial is refused ──────────────────────────────────────────
{
  const rawTx = revealTx(scriptWith(envelope('text/plain', Buffer.from('shallow'))))
  const { bundle, txid } = bury(rawTx, 2)
  const v = proveInscription(txid, 0, bundle, { minConfirmations: 6, net: 'regtest' })
  ok(!v.ok && v.reason === 'tx-shallow', 'a 2-deep burial refuses when the law needs 6')
}

// ── 3 · a header nobody mined is refused (deterministic: invalid nBits) ───────
{
  const rawTx = revealTx(scriptWith(envelope('text/plain', Buffer.from('unmined'))))
  const txid = parseTxWitness(rawTx).txidDisplay
  const txidInternal = Buffer.from(txid, 'hex').reverse()
  // a header shaped but NEVER mined: its nBits (exponent 33) is not a valid
  // target, so checkProofOfWork rejects it with certainty. It is used in BOTH
  // the merkle proof and the header list, so the refusal is the PoW gate itself,
  // not a chain mismatch.
  const h0 = Buffer.alloc(80); h0.writeUInt32LE(0x20000000, 0); txidInternal.copy(h0, 36); h0.writeUInt32LE(0x21ffffff, 72)
  const txoutproof = Buffer.concat([h0, Buffer.from('01000000', 'hex'), Buffer.from([0x01]), txidInternal, Buffer.from([0x01, 0x01])]).toString('hex')
  const broken: ProvenTx[] = [{ rawTx, txoutproof, headers: [h0.toString('hex')] }]
  const v = proveInscription(txid, 0, broken, { minConfirmations: 1, net: 'regtest' })
  ok(!v.ok && v.reason === 'tx-unproven', 'a header that fails its own target refuses')
}

// ── 4 · querying a txid the bundle does not carry ────────────────────────────
{
  const rawTx = revealTx(scriptWith(envelope('text/plain', Buffer.from('elsewhere'))))
  const { bundle } = bury(rawTx, 6)
  const v = proveInscription('ab'.repeat(32), 0, bundle, { minConfirmations: 6, net: 'regtest' })
  ok(!v.ok && v.reason === 'tx-missing', 'a txid not in the bundle is tx-missing')
}

// ── 5 · an index with no envelope ────────────────────────────────────────────
{
  const rawTx = revealTx(scriptWith(envelope('text/plain', Buffer.from('only one'))))
  const { bundle, txid } = bury(rawTx, 6)
  const v = proveInscription(txid, 3, bundle, { minConfirmations: 6, net: 'regtest' })
  ok(!v.ok && v.reason === 'no-inscription', 'index 3 with no envelope is no-inscription')
}

console.log(`\n✓ ${pass} checks passed — AN L1 INSCRIPTION, PROVEN FROM BYTES: the reveal is exactly its bytes, buried in a block that cost work to the required depth, and its envelope decodes to the claimed id and content — or it refuses and says which. Existence proven, ownership not claimed. ⌘`)
