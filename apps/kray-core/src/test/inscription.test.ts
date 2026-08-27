/**
 * INSCRIPTION — the ordinals envelope decoded from raw witness bytes, and every
 * malformation refused.
 *   node src/test/inscription.test.ts
 *
 * Builds real reveal transactions from first principles — segwit, a taproot
 * script-path witness `[script, control block]` whose script carries an
 * `OP_FALSE OP_IF "ord" … OP_ENDIF` envelope — and proves the parser reads
 * exactly what ord would: content-type, body, id `<txid>i<index>`, multiple
 * inscriptions, the annex, and a key-path spend that carries nothing. The txid it
 * derives must equal the segwit-aware txid spv.parseTx computes.
 */
import { createHash } from 'node:crypto'
import { inscriptionsInTx, inscriptionAt, parseTxWitness, envelopesInScript, envelopesInScriptLoose, tapscriptOf, pointerSatOf } from '../protocol/inscription.ts'
import { parseTx } from '../anchor/spv.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
const sha256hex = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

// ── script + tx builders ─────────────────────────────────────────────────────
function push(data: Buffer): Buffer {
  const L = data.length
  if (L === 0) return Buffer.from([0x00])
  if (L <= 0x4b) return Buffer.concat([Buffer.from([L]), data])
  if (L <= 0xff) return Buffer.concat([Buffer.from([0x4c, L]), data])
  if (L <= 0xffff) { const p = Buffer.alloc(3); p[0] = 0x4d; p.writeUInt16LE(L, 1); return Buffer.concat([p, data]) }
  const p = Buffer.alloc(5); p[0] = 0x4e; p.writeUInt32LE(L, 1); return Buffer.concat([p, data])
}
/** an ord envelope: OP_FALSE OP_IF "ord" [tag1 content-type] OP_0 [body…] OP_ENDIF */
function envelope(contentType: string | null, content: Buffer): Buffer {
  const parts: Buffer[] = [Buffer.from([0x00, 0x63]), push(Buffer.from('ord', 'ascii'))]
  if (contentType !== null) parts.push(push(Buffer.from([0x01])), push(Buffer.from(contentType, 'latin1')))
  parts.push(Buffer.from([0x00])) // body separator
  // split into ≤520-byte chunks, like a real large inscription
  for (let o = 0; o < content.length || content.length === 0; o += 520) {
    parts.push(push(content.subarray(o, o + 520)))
    if (content.length === 0) break
  }
  parts.push(Buffer.from([0x68])) // OP_ENDIF
  return Buffer.concat(parts)
}
/** a plausible reveal tapscript: <32-byte pubkey> OP_CHECKSIG, then the envelope(s) */
function revealScript(...envs: Buffer[]): Buffer {
  return Buffer.concat([push(Buffer.alloc(32, 0xab)), Buffer.from([0xac]), ...envs])
}
function varint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n])
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b }
  const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b
}
const witItem = (b: Buffer): Buffer => Buffer.concat([varint(b.length), b])
/** a one-input segwit reveal tx whose single input carries `witnessStack`. */
function revealTx(witnessStack: Buffer[]): string {
  const version = Buffer.from('02000000', 'hex')
  const marker = Buffer.from('0001', 'hex')
  const vin = Buffer.concat([
    varint(1),
    Buffer.alloc(32, 0x11), Buffer.from('00000000', 'hex'), // outpoint txid:vout
    varint(0), // empty scriptSig
    Buffer.from('ffffffff', 'hex'),
  ])
  const spk = Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, 0xcd)]) // OP_1 push32 (P2TR)
  const vout = Buffer.concat([varint(1), Buffer.alloc(8), varint(spk.length), spk])
  const witness = Buffer.concat([varint(witnessStack.length), ...witnessStack.map(witItem)])
  const locktime = Buffer.from('00000000', 'hex')
  return Buffer.concat([version, marker, vin, vout, witness, locktime]).toString('hex')
}
const CONTROL = Buffer.concat([Buffer.from([0xc0]), Buffer.alloc(32, 0xef)]) // leaf version + internal key

// ── 1 · a lawful inscription, round-trip ─────────────────────────────────────
{
  const content = Buffer.from('hello, origin', 'utf8')
  const tx = revealTx([revealScript(envelope('text/plain;charset=utf-8', content)), CONTROL])
  const found = inscriptionsInTx(tx)
  ok(found.length === 1, 'exactly one inscription decoded')
  ok(found[0].contentType === 'text/plain;charset=utf-8', 'content-type read from tag 1')
  ok(found[0].content.equals(content), 'body reconstructed exactly')
  ok(found[0].contentHash === sha256hex(content), 'contentHash is sha256 of the body')
  ok(found[0].size === content.length, 'size is the body length')
  ok(found[0].id.endsWith('i0'), 'the id ends i0')
  ok(inscriptionAt(tx, 0)?.contentHash === sha256hex(content), 'inscriptionAt(0) finds it')
  ok(inscriptionAt(tx, 1) === null, 'no inscription at index 1')
}

// ── 2 · the id uses the SAME segwit-aware txid spv.parseTx computes ───────────
{
  const tx = revealTx([revealScript(envelope('image/png', Buffer.from([1, 2, 3, 4]))), CONTROL])
  const viaWitness = parseTxWitness(tx).txidDisplay
  const viaSpv = parseTx(tx).txidDisplay
  ok(viaWitness === viaSpv, 'witness-retaining txid == spv.parseTx txid')
  ok(inscriptionsInTx(tx)[0].id === `${viaSpv}i0`, 'the id is <reveal txid>i0')
}

// ── 3 · two envelopes in one script → i0, i1 in order ────────────────────────
{
  const tx = revealTx([revealScript(
    envelope('text/plain', Buffer.from('first', 'utf8')),
    envelope('text/plain', Buffer.from('second', 'utf8')),
  ), CONTROL])
  const found = inscriptionsInTx(tx)
  ok(found.length === 2, 'two inscriptions decoded')
  ok(found[0].content.toString() === 'first' && found[0].id.endsWith('i0'), 'first is i0')
  ok(found[1].content.toString() === 'second' && found[1].id.endsWith('i1'), 'second is i1')
}

// ── 4 · a key-path spend (single witness item) carries no inscription ────────
{
  const tx = revealTx([Buffer.alloc(64, 0x99)]) // just a signature
  ok(inscriptionsInTx(tx).length === 0, 'a key-path spend yields no inscription')
  ok(tapscriptOf([Buffer.alloc(64)]) === null, 'tapscriptOf refuses a one-item stack')
}

// ── 5 · the annex is stripped, the inscription still found ───────────────────
{
  const annex = Buffer.concat([Buffer.from([0x50]), Buffer.alloc(8, 0x00)])
  const tx = revealTx([revealScript(envelope('text/plain', Buffer.from('annexed', 'utf8'))), CONTROL, annex])
  const found = inscriptionsInTx(tx)
  ok(found.length === 1 && found[0].content.toString() === 'annexed', 'annex stripped, envelope decoded')
}

// ── 6 · an envelope with no content-type → contentType '' ────────────────────
{
  const tx = revealTx([revealScript(envelope(null, Buffer.from('typeless', 'utf8'))), CONTROL])
  const found = inscriptionsInTx(tx)
  ok(found.length === 1 && found[0].contentType === '' && found[0].content.toString() === 'typeless', 'typeless envelope decoded, contentType empty')
}

// ── 7 · a malformed envelope (never closed) is skipped, not half-decoded ──────
{
  const broken = Buffer.concat([Buffer.from([0x00, 0x63]), push(Buffer.from('ord')), push(Buffer.from([0x01])), push(Buffer.from('text/plain')), Buffer.from([0x00]), push(Buffer.from('no endif'))]) // no OP_ENDIF
  ok(envelopesInScript(broken).length === 0, 'an unclosed envelope decodes to nothing')
  const notOrd = Buffer.concat([Buffer.from([0x00, 0x63]), push(Buffer.from('xyz')), Buffer.from([0x68])])
  ok(envelopesInScript(notOrd).length === 0, 'OP_IF without the "ord" marker is not an envelope')
}

// ── 8 · a large body via OP_PUSHDATA2, split across pushes ────────────────────
{
  const big = Buffer.alloc(1300)
  for (let i = 0; i < big.length; i++) big[i] = i & 0xff
  const tx = revealTx([revealScript(envelope('application/octet-stream', big)), CONTROL])
  const found = inscriptionsInTx(tx)
  ok(found.length === 1 && found[0].content.equals(big), '1300-byte body reconstructed across chunks')
  ok(found[0].contentHash === sha256hex(big), 'large contentHash matches')
}

// ── 9 · parser hardening (from the adversarial review) ───────────────────────
{
  // pointer (tag 2) is the inscription sat — kept, not skipped
  const withPointer = Buffer.concat([Buffer.from([0x00, 0x63]), push(Buffer.from('ord')), push(Buffer.from([0x01])), push(Buffer.from('text/plain')), push(Buffer.from([0x02])), push(Buffer.from([0x05])), Buffer.from([0x00]), push(Buffer.from('body')), Buffer.from([0x68])])
  const ptrEnvs = envelopesInScript(withPointer)
  ok(ptrEnvs.length === 1 && ptrEnvs[0].content.toString() === 'body', 'a pointer envelope is a real inscription (the sat is named, the body is not rewritten)')
  ok(pointerSatOf(ptrEnvs[0].tags) === 5n, 'tag 2 decodes as little-endian sat offset 5')

  // tag 13 (rune etch) — consensus still skips; the explorer loose reader keeps the WebP body
  const withRune = Buffer.concat([Buffer.from([0x00, 0x63]), push(Buffer.from('ord')), push(Buffer.from([0x01])), push(Buffer.from('image/webp')), push(Buffer.from([0x0d])), push(Buffer.from('abcdef')), Buffer.from([0x00]), push(Buffer.from('RIFF')), Buffer.from([0x68])])
  ok(envelopesInScript(withRune).length === 0, 'a rune-tagged envelope is not an origin-proof inscription')
  const loose = envelopesInScriptLoose(withRune)
  ok(loose.length === 1 && loose[0].contentType === 'image/webp' && loose[0].content.toString() === 'RIFF', 'explorer loose reader keeps a rune-tagged body')

  // real etch style: OP_1 / OP_13, not a one-byte push of 0x01 / 0x0d
  const withPushnum = Buffer.concat([
    Buffer.from([0x00, 0x63]), push(Buffer.from('ord')),
    Buffer.from([0x51]), push(Buffer.from('image/webp')),
    Buffer.from([0x5d]), push(Buffer.from('abcdef')),
    Buffer.from([0x00]), push(Buffer.from('RIFF')), Buffer.from([0x68]),
  ])
  ok(envelopesInScript(withPushnum).length === 0, 'OP_1+OP_13 etch is still skipped for origin proofs')
  const looseNum = envelopesInScriptLoose(withPushnum)
  ok(looseNum.length === 1 && looseNum[0].contentType === 'image/webp' && looseNum[0].content.toString() === 'RIFF', 'OP_1/OP_13 tags decode for the explorer face')

  // a push over the 520-byte tapscript element limit → refused
  const oversized = Buffer.concat([Buffer.from([0x00, 0x63]), push(Buffer.from('ord')), push(Buffer.from([0x01])), push(Buffer.from('text/plain')), Buffer.from([0x00]), push(Buffer.alloc(521, 0x41)), Buffer.from([0x68])])
  ok(envelopesInScript(oversized).length === 0, 'a push over 520 bytes is refused')

  // a truncated OP_PUSHDATA4 near the end → NO throw out of the parser, no inscription
  const truncated = Buffer.concat([Buffer.from([0x00, 0x63]), push(Buffer.from('ord')), Buffer.from([0x00]), Buffer.from([0x4e, 0x01, 0x02])])
  let threw = false
  try { ok(envelopesInScript(truncated).length === 0, 'a truncated push yields no inscription') } catch (_) { threw = true }
  ok(!threw, 'a truncated push does NOT throw out of the parser — a crafted script is an attempt, not a crash')
}

console.log(`\n✓ ${pass} checks passed — THE ORDINALS ENVELOPE, DECODED FROM BYTES: content-type, body and id <txid>i<index> read exactly as ord reads them, across multiple inscriptions, past a taproot annex, from the same segwit-aware txid the seal path uses; a key-path spend carries nothing and a malformed envelope decodes to nothing rather than a guess. The proof of an inscription's existence needs no indexer. ⌘`)
