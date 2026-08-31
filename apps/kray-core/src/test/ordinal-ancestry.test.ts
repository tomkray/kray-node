/**
 * ORDINAL ANCESTRY — a UTXO's control of an inscription proven by tracking its
 * satoshi backward to the reveal, and every forgery refused.
 *   node src/test/ordinal-ancestry.test.ts
 *
 * Builds real Bitcoin transaction chains that move an inscription's sat from a
 * reveal to a holder UTXO — including the case where a fee input SHIFTS the sat's
 * offset — and proves proveParentControl accepts the truth and names each lie: a
 * holder that does not pay the author, a broken chain, a wrong offset, a shallow
 * burial, and a parent id it does not support.
 */
import { createHash } from 'node:crypto'
import { krayOutspendGate, kraySatpointGate, liveHolderGate, parseSatpoint, proveParentControl } from '../protocol/ordinal-ancestry.ts'
import { parseTx, checkProofOfWork, sha256d } from '../anchor/spv.ts'
import type { ProvenTx } from '../protocol/rune-ancestry.ts'
import { revealWithEnvelope, revealWithRuneEnvelope, segwitTx, revealScript, ordEnvelope, REVEAL_CONTROL } from './ordinal-proof-fixture.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}

// ── raw (non-segwit) tx builder + mined-block burial ─────────────────────────
function varint(n: number): Buffer { if (n < 0xfd) return Buffer.from([n]); const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b }
function u32le(n: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
function u64le(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b }
function rawTx(ins: { txid: string; vout: number }[], outs: { value: bigint; script: Buffer }[]): string {
  const parts: Buffer[] = [Buffer.from('02000000', 'hex'), varint(ins.length)]
  for (const i of ins) parts.push(Buffer.from(i.txid, 'hex').reverse(), u32le(i.vout), varint(0), Buffer.from('ffffffff', 'hex'))
  parts.push(varint(outs.length))
  for (const o of outs) parts.push(u64le(o.value), varint(o.script.length), o.script)
  parts.push(Buffer.from('00000000', 'hex'))
  return Buffer.concat(parts).toString('hex')
}
const txidOf = (raw: string): string => parseTx(raw).txidDisplay
const p2tr = (fill: number): Buffer => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, fill)])

let salt = 0
function mine(prevInternal: Buffer, rootInternal: Buffer): Buffer {
  const h = Buffer.alloc(80); h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); rootInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000 + (salt++), 68); h.writeUInt32LE(0x207fffff, 72)
  for (let nonce = 0; nonce < 1_000_000; nonce++) { h.writeUInt32LE(nonce, 76); if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h }
  throw new Error('could not mine')
}
function proven(raw: string, confirmations: number): ProvenTx {
  const txid = txidOf(raw)
  const txidInternal = Buffer.from(txid, 'hex').reverse()
  const headers = [mine(Buffer.alloc(32), txidInternal)]
  for (let i = 1; i < confirmations; i++) headers.push(mine(sha256d(headers[i - 1]), createHash('sha256').update(`${txid}:${i}`).digest()))
  const txoutproof = Buffer.concat([headers[0], Buffer.from('01000000', 'hex'), Buffer.from([0x01]), txidInternal, Buffer.from([0x01, 0x01])]).toString('hex')
  return { rawTx: raw, txoutproof, headers: headers.map((h) => h.toString('hex')) }
}

const AUTHOR = p2tr(0x77)
const OTHER = p2tr(0x11)
const AUTHOR_HEX = AUTHOR.toString('hex')
const O = (conf = 6) => ({ minConfirmations: conf, net: 'regtest' })

// ── 1 · a clean linear chain: the sat stays at output 0, offset 0 ────────────
{
  const reveal = revealWithEnvelope([{ txid: 'ff'.repeat(32), vout: 0 }], [{ value: 10_000n, script: OTHER }], Buffer.from('e1'))
  const rid = txidOf(reveal)
  const t1 = rawTx([{ txid: rid, vout: 0 }], [{ value: 9_000n, script: OTHER }])
  const t1id = txidOf(t1)
  const t2 = rawTx([{ txid: t1id, vout: 0 }], [{ value: 8_000n, script: AUTHOR }]) // holder pays the author
  const t2id = txidOf(t2)
  const bundle = [proven(reveal, 6), proven(t1, 6), proven(t2, 6)]
  const v = proveParentControl(t2id, 0, 0n, AUTHOR_HEX, `${rid}i0`, bundle, O())
  ok(v.ok, 'a clean lineage to an author-held UTXO proves control')
  ok(v.hops === 2, 'two hops back to the reveal')

  // the holder does not pay the author → refused
  const bad = proveParentControl(t2id, 0, 0n, OTHER.toString('hex'), `${rid}i0`, bundle, O())
  ok(!bad.ok && bad.reason === 'holder-not-authors', 'a holder that does not pay the author is refused')

  // a missing intermediate tx → the value cannot be known → refused
  const gap = proveParentControl(t2id, 0, 0n, AUTHOR_HEX, `${rid}i0`, [proven(reveal, 6), proven(t2, 6)], O())
  ok(!gap.ok && gap.reason === 'input-value-unknown', 'a broken chain refuses (a missing hop)')

  const notThere = proveParentControl(t2id, 0, 0n, AUTHOR_HEX, `${rid}i7`, bundle, O())
  ok(!notThere.ok && notThere.reason === 'no-inscription', 'a claimed index with no envelope is refused')

  const bare = rawTx([{ txid: 'ee'.repeat(32), vout: 0 }], [{ value: 10_000n, script: OTHER }])
  const bareId = txidOf(bare)
  const bareHold = rawTx([{ txid: bareId, vout: 0 }], [{ value: 8_000n, script: AUTHOR }])
  const noEnv = proveParentControl(txidOf(bareHold), 0, 0n, AUTHOR_HEX, `${bareId}i0`, [proven(bare, 6), proven(bareHold, 6)], O())
  ok(!noEnv.ok && noEnv.reason === 'no-inscription', 'a reveal with no ord envelope is not a parent')

  // Live Signet bug: a WebP + rune etch (tag 13) is still an inscription. The
  // old lantern used inscriptionAt (strict) and painted no-inscription / yellow
  // Bless while a plain SVG (tag 1 only) went green. Control counts as ord does.
  const runeReveal = revealWithRuneEnvelope([{ txid: 'cc'.repeat(32), vout: 0 }], [{ value: 10_000n, script: OTHER }], Buffer.from('RIFF'))
  const runeId = txidOf(runeReveal)
  const runeHold = rawTx([{ txid: runeId, vout: 0 }], [{ value: 9_000n, script: AUTHOR }])
  const runeHoldId = txidOf(runeHold)
  const runeV = proveParentControl(runeHoldId, 0, 0n, AUTHOR_HEX, `${runeId}i0`, [proven(runeReveal, 6), proven(runeHold, 6)], O())
  ok(runeV.ok && runeV.hops === 1, 'a WebP+rune etch (tag 13) still fathers after a send-to-self')

  // a shallow burial → refused
  const shallow = proveParentControl(t2id, 0, 0n, AUTHOR_HEX, `${rid}i0`, [proven(reveal, 6), proven(t1, 6), proven(t2, 2)], O(6))
  ok(!shallow.ok && shallow.reason === 'tx-shallow', 'a shallow burial refuses')
}

// ── 2 · a FEE INPUT shifts the sat's offset — the arithmetic must follow it ───
{
  const reveal = revealWithEnvelope([{ txid: 'aa'.repeat(32), vout: 0 }], [{ value: 10_000n, script: OTHER }], Buffer.from('e2'))
  const rid = txidOf(reveal)
  const funding = rawTx([{ txid: 'bb'.repeat(32), vout: 0 }], [{ value: 5_000n, script: OTHER }]) // a plain 5000-sat input, BEFORE the inscription input
  const fid = txidOf(funding)
  // input 0 = the 5000-sat funding, input 1 = the reveal (the inscription). The
  // inscription sat is now at absolute offset 5000 → output 0, offset 5000.
  const holder = rawTx([{ txid: fid, vout: 0 }, { txid: rid, vout: 0 }], [{ value: 14_000n, script: AUTHOR }])
  const hid = txidOf(holder)
  const bundle = [proven(reveal, 6), proven(funding, 6), proven(holder, 6)]

  const v = proveParentControl(hid, 0, 5_000n, AUTHOR_HEX, `${rid}i0`, bundle, O())
  ok(v.ok, 'the sat is tracked through a fee input to offset 5000 — control proven')
  ok(v.hops === 1, 'one hop back to the reveal')

  // claiming offset 0 (the funding sats, not the inscription) → refused
  const wrong = proveParentControl(hid, 0, 0n, AUTHOR_HEX, `${rid}i0`, bundle, O())
  ok(!wrong.ok, 'offset 0 (the fee input, not the inscription) does NOT prove control')

  // an offset past the output → refused
  const oob = proveParentControl(hid, 0, 14_000n, AUTHOR_HEX, `${rid}i0`, bundle, O())
  ok(!oob.ok && oob.reason === 'offset-out-of-range', 'an offset past the output is refused')
}

// ── 3 · a longer chain, inscription riding output 0 with fees each hop ────────
{
  const reveal = revealWithEnvelope([{ txid: 'cc'.repeat(32), vout: 0 }], [{ value: 20_000n, script: OTHER }], Buffer.from('e3'))
  const rid = txidOf(reveal)
  let prev = rid, chain: ProvenTx[] = [proven(reveal, 6)], val = 20_000n
  for (let i = 0; i < 5; i++) { // five transfers, each paying a 500-sat fee, inscription stays at offset 0
    val -= 500n
    const raw = rawTx([{ txid: prev, vout: 0 }], [{ value: val, script: i === 4 ? AUTHOR : OTHER }])
    chain.push(proven(raw, 6)); prev = txidOf(raw)
  }
  const v = proveParentControl(prev, 0, 0n, AUTHOR_HEX, `${rid}i0`, chain, O())
  ok(v.ok && v.hops === 5, 'a five-hop lineage tracks the sat home')
}

// ── 4 · pointer (tag 2) is the sat — holding the first sat is not enough ─────
{
  const reveal = revealWithEnvelope(
    [{ txid: 'dd'.repeat(32), vout: 0 }],
    [{ value: 5_000n, script: OTHER }, { value: 5_000n, script: OTHER }],
    Buffer.from('ptr'),
    5_000n,
  )
  const rid = txidOf(reveal)
  const hold = rawTx([{ txid: rid, vout: 1 }], [{ value: 4_000n, script: AUTHOR }])
  const hid = txidOf(hold)
  const bundle = [proven(reveal, 6), proven(hold, 6)]
  const v = proveParentControl(hid, 0, 0n, AUTHOR_HEX, `${rid}i0`, bundle, O())
  ok(v.ok && v.hops === 1, 'pointer 5000 lands on output 1 — control proven')

  const wrongOut = rawTx([{ txid: rid, vout: 0 }], [{ value: 4_000n, script: AUTHOR }])
  const steal = proveParentControl(txidOf(wrongOut), 0, 0n, AUTHOR_HEX, `${rid}i0`, [proven(reveal, 6), proven(wrongOut, 6)], O())
  ok(!steal.ok && steal.reason === 'not-the-inscription-sat', 'holding the first sat does not prove a pointer-5000 inscription')
}

// ── 5 · iN without a pointer is not guessed ──────────────────────────────────
{
  const script = revealScript(ordEnvelope('text/plain', Buffer.from('a')), ordEnvelope('text/plain', Buffer.from('b')))
  const reveal = segwitTx(
    [{ txid: 'ee'.repeat(32), vout: 0 }],
    [{ value: 10_000n, script: OTHER }],
    [[script, REVEAL_CONTROL]],
  )
  const rid = txidOf(reveal)
  const hold = rawTx([{ txid: rid, vout: 0 }], [{ value: 8_000n, script: AUTHOR }])
  const hid = txidOf(hold)
  const bundle = [proven(reveal, 6), proven(hold, 6)]
  const i0 = proveParentControl(hid, 0, 0n, AUTHOR_HEX, `${rid}i0`, bundle, O())
  ok(i0.ok, 'i0 without a pointer still lands on the first sat')
  const i1 = proveParentControl(hid, 0, 0n, AUTHOR_HEX, `${rid}i1`, bundle, O())
  ok(!i1.ok && i1.reason === 'bad-parent-id', 'i1 without a pointer is refused — sequential sats are not guessed')
}

// ── 6 · live door: a mempool (or confirmed) spend of the holder is a sale ──
{
  const sold = liveHolderGate({ headerOnThisChain: true, headerConfirmations: 6, utxoPresent: false })
  ok(!sold.ok && sold.reason === 'holder-spent', 'holder on this chain and gettxout empty — sold, even if only in the mempool')
  const live = liveHolderGate({ headerOnThisChain: true, headerConfirmations: 6, utxoPresent: true })
  ok(live.ok && live.reason === 'unspent', 'holder still in the UTXO set (mempool included) — may father')
  const lab = liveHolderGate({ headerOnThisChain: null, headerConfirmations: null, utxoPresent: null })
  ok(lab.ok && lab.reason === 'not-this-chain', 'headers this node does not have are not invented as a sale')
  const orphan = liveHolderGate({ headerOnThisChain: true, headerConfirmations: -1, utxoPresent: true })
  ok(!orphan.ok && orphan.reason === 'holder-orphaned', 'an orphaned holder block is not this Bitcoin')
}

// ── 7 · KRAY API / KrayScan outspend + satpoint (pending UTXO point) ──
{
  const pending = krayOutspendGate({ spent: true, txid: 'ab', status: { confirmed: false } })
  ok(!pending.ok && pending.reason === 'holder-spent', 'KRAY outspend spent=true is a sale — pending or confirmed')
  const free = krayOutspendGate({ spent: false })
  ok(free.ok && free.reason === 'unspent', 'KRAY outspend spent=false — this eye still sees the holder')
  const dark = krayOutspendGate(null)
  ok(dark.ok && dark.reason === 'eye-dark', 'a silent KRAY eye is not invented as a sale')
  ok(parseSatpoint('aa'.repeat(32) + ':1:0')?.vout === 1, 'ord satpoint txid:vout:offset')
  const moved = kraySatpointGate({ txid: 'aa'.repeat(32), vout: 0 }, 'bb'.repeat(32) + ':0:0')
  ok(!moved.ok && moved.reason === 'holder-spent', 'inscription satpoint on another outpoint — already moved')
  const same = kraySatpointGate({ txid: 'aa'.repeat(32), vout: 2 }, 'AA'.repeat(32) + ':2:500')
  ok(same.ok && same.reason === 'unspent', 'satpoint still names the claimed holder')
}

console.log(`\n✓ ${pass} checks passed — CONTROL OF AN ORDINAL, PROVEN BY ITS SATOSHI: the reveal must carry an ord envelope; a pointer is the sat; the inscription's sat is followed backward through real, buried Bitcoin transactions — through a fee input that shifts its offset, across many hops — to that sat, and the holding UTXO is shown to pay the author. A holder that isn't the author's, a broken chain, a wrong offset, a shallow burial, a missing envelope, a mempool sale of the holder — every one refused. Control proven from bytes, not an indexer's word. ₿⌘`)
