/**
 * In-memory mined Bitcoin chain that places an inscription sat in a UTXO
 * paying `authorScriptHex`. Used by reducer pins and live e2e — the bag is
 * self-contained SPV (no node's bitcoind).
 */
import { createHash } from 'node:crypto'
import { parseTx, checkProofOfWork, sha256d } from '../anchor/spv.ts'
import type { ProvenTx } from '../protocol/rune-ancestry.ts'
import type { OriginControlProof } from '../protocol/ordinal-ancestry.ts'

function varint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n])
  const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b
}
function u32le(n: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
function u64le(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b }

export function rawTx(ins: { txid: string; vout: number }[], outs: { value: bigint; script: Buffer }[]): string {
  const parts: Buffer[] = [Buffer.from('02000000', 'hex'), varint(ins.length)]
  for (const i of ins) parts.push(Buffer.from(i.txid, 'hex').reverse(), u32le(i.vout), varint(0), Buffer.from('ffffffff', 'hex'))
  parts.push(varint(outs.length))
  for (const o of outs) parts.push(u64le(o.value), varint(o.script.length), o.script)
  parts.push(Buffer.from('00000000', 'hex'))
  return Buffer.concat(parts).toString('hex')
}

function push(data: Buffer): Buffer {
  const L = data.length
  if (L === 0) return Buffer.from([0x00])
  if (L <= 0x4b) return Buffer.concat([Buffer.from([L]), data])
  if (L <= 0xff) return Buffer.concat([Buffer.from([0x4c, L]), data])
  throw new Error('fixture push too large')
}
function leSat(n: bigint): Buffer {
  if (n === 0n) return Buffer.from([0x00])
  const out: number[] = []
  let x = n
  while (x > 0n) { out.push(Number(x & 0xffn)); x >>= 8n }
  return Buffer.from(out)
}

/** `OP_FALSE OP_IF "ord" [tag1 type] [tag2 pointer] OP_0 body OP_ENDIF` */
export function ordEnvelope(contentType: string, content: Buffer, pointerSat?: bigint): Buffer {
  const parts: Buffer[] = [Buffer.from([0x00, 0x63]), push(Buffer.from('ord', 'ascii')), push(Buffer.from([0x01])), push(Buffer.from(contentType, 'latin1'))]
  if (pointerSat !== undefined) {
    parts.push(push(Buffer.from([0x02])), push(leSat(pointerSat)))
  }
  parts.push(Buffer.from([0x00]), push(content), Buffer.from([0x68]))
  return Buffer.concat(parts)
}

export function revealScript(...envs: Buffer[]): Buffer {
  return Buffer.concat([push(Buffer.alloc(32, 0xab)), Buffer.from([0xac]), ...envs])
}

export const REVEAL_CONTROL = Buffer.concat([Buffer.from([0xc0]), Buffer.alloc(32, 0xef)])
const witItem = (b: Buffer): Buffer => Buffer.concat([varint(b.length), b])

/** Segwit tx — `witnesses[i]` is the stack for input i (empty stack = `[]`). */
export function segwitTx(
  ins: { txid: string; vout: number }[],
  outs: { value: bigint; script: Buffer }[],
  witnesses: Buffer[][],
): string {
  if (witnesses.length !== ins.length) throw new Error('fixture: one witness stack per input')
  const parts: Buffer[] = [Buffer.from('02000000', 'hex'), Buffer.from('0001', 'hex'), varint(ins.length)]
  for (const i of ins) parts.push(Buffer.from(i.txid, 'hex').reverse(), u32le(i.vout), varint(0), Buffer.from('ffffffff', 'hex'))
  parts.push(varint(outs.length))
  for (const o of outs) parts.push(u64le(o.value), varint(o.script.length), o.script)
  for (const stack of witnesses) {
    parts.push(varint(stack.length), ...stack.map(witItem))
  }
  parts.push(Buffer.from('00000000', 'hex'))
  return Buffer.concat(parts).toString('hex')
}

/** One-input reveal that carries an `ord` envelope on a taproot script-path spend. */
export function revealWithEnvelope(
  ins: { txid: string; vout: number }[],
  outs: { value: bigint; script: Buffer }[],
  content: Buffer,
  pointerSat?: bigint,
): string {
  const script = revealScript(ordEnvelope('text/plain', content, pointerSat))
  const witnesses: Buffer[][] = ins.map((_, i) => (i === 0 ? [script, REVEAL_CONTROL] : []))
  return segwitTx(ins, outs, witnesses)
}

export const txidOf = (raw: string): string => parseTx(raw).txidDisplay

let salt = 0
export function mine(prevInternal: Buffer, rootInternal: Buffer): Buffer {
  const h = Buffer.alloc(80); h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); rootInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000 + (salt++), 68); h.writeUInt32LE(0x207fffff, 72)
  for (let nonce = 0; nonce < 1_000_000; nonce++) {
    h.writeUInt32LE(nonce, 76)
    if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h
  }
  throw new Error('could not mine')
}

export function proven(raw: string, confirmations: number): ProvenTx {
  const txid = txidOf(raw)
  const txidInternal = Buffer.from(txid, 'hex').reverse()
  const headers = [mine(Buffer.alloc(32), txidInternal)]
  for (let i = 1; i < confirmations; i++) {
    headers.push(mine(sha256d(headers[i - 1]), createHash('sha256').update(`${txid}:${i}`).digest()))
  }
  const txoutproof = Buffer.concat([
    headers[0], Buffer.from('01000000', 'hex'), Buffer.from([0x01]), txidInternal, Buffer.from([0x01, 0x01]),
  ]).toString('hex')
  return { rawTx: raw, txoutproof, headers: headers.map((h) => h.toString('hex')) }
}

export function p2trFill(fill: number): Buffer {
  return Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, fill)])
}

export type AuthorHeldOrigin = {
  parentId: string
  proof: OriginControlProof
}

/** Linear two-hop: reveal → transfer → holder paying `authorScriptHex`. */
export function authorHeldOriginProof(authorScriptHex: string, opts?: { confirmations?: number; salt?: string }): AuthorHeldOrigin {
  const conf = opts?.confirmations ?? 1
  const tag = opts?.salt ?? 'origin'
  const other = p2trFill(0x11)
  const author = Buffer.from(authorScriptHex, 'hex')
  const coin = createHash('sha256').update('fixture-coin|' + tag).digest('hex')
  const reveal = revealWithEnvelope([{ txid: coin, vout: 0 }], [{ value: 10_000n, script: other }], Buffer.from(tag, 'utf8'))
  const rid = txidOf(reveal)
  const mid = rawTx([{ txid: rid, vout: 0 }], [{ value: 9_000n, script: other }])
  const midId = txidOf(mid)
  const hold = rawTx([{ txid: midId, vout: 0 }], [{ value: 8_000n, script: author }])
  const hid = txidOf(hold)
  return {
    parentId: `${rid}i0`,
    proof: {
      holderTxid: hid,
      holderVout: 0,
      holderOffset: '0',
      bundle: [proven(reveal, conf), proven(mid, conf), proven(hold, conf)],
    },
  }
}

/** hops===0 — the reveal still holds the sat. Casey refuses this as a child blessing. */
export function revealHeldOriginProof(authorScriptHex: string, opts?: { confirmations?: number; salt?: string }): AuthorHeldOrigin {
  const conf = opts?.confirmations ?? 1
  const tag = opts?.salt ?? 'reveal-hold'
  const author = Buffer.from(authorScriptHex, 'hex')
  const coin = createHash('sha256').update('fixture-coin|' + tag).digest('hex')
  const reveal = revealWithEnvelope([{ txid: coin, vout: 0 }], [{ value: 10_000n, script: author }], Buffer.from(tag, 'utf8'))
  const rid = txidOf(reveal)
  return {
    parentId: `${rid}i0`,
    proof: {
      holderTxid: rid,
      holderVout: 0,
      holderOffset: '0',
      bundle: [proven(reveal, conf)],
    },
  }
}
