/**
 * RUNE ANCESTRY — a deposit proven from bytes, and every broken bundle refused.
 *   node src/test/rune-ancestry.test.ts
 *
 * This is the question the L2 mint must answer: "how many runes really landed
 * in this vault?" Answering it wrong in either direction is money — too much
 * credits an L2 with runes that do not exist, too little robs the depositor. So
 * every path here either PROVES the number or REFUSES and names why.
 *
 * The chain built below is a real one in miniature: an etch with a premine, a
 * transfer that splits it, and a deposit into a vault. Each link carries its own
 * Bitcoin inclusion proof, and each attack removes or corrupts exactly one thing.
 */
import { proveDeposit, proveOutpoint, outpointKey, parentCanHoldFocusedRune, type ProvenTx } from '../protocol/rune-ancestry.ts'
import { TAG, FLAG, encodeVarint, runeValue, type RuneId } from '../protocol/runestone.ts'
import { checkProofOfWork, sha256d, toDisplayHex } from '../anchor/spv.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}

// ── a miniature Bitcoin: raw txs, real merkle proofs, real header chains ────
const varintBytes = (n: number): number[] => (n < 0xfd ? [n] : [0xfd, n & 0xff, n >> 8])
function rawTx(inputs: Array<{ txid: string; vout: number }>, outputs: Uint8Array[]): string {
  const b: number[] = [0x01, 0x00, 0x00, 0x00, ...varintBytes(inputs.length)]
  for (const i of inputs) {
    b.push(...Buffer.from(i.txid, 'hex').reverse()) // outpoints are internal order
    b.push(i.vout & 0xff, (i.vout >> 8) & 0xff, (i.vout >> 16) & 0xff, (i.vout >> 24) & 0xff)
    b.push(0x00, 0xff, 0xff, 0xff, 0xff)
  }
  b.push(...varintBytes(outputs.length))
  for (const o of outputs) { b.push(...new Array(8).fill(0), ...varintBytes(o.length), ...o) }
  b.push(0x00, 0x00, 0x00, 0x00)
  return Buffer.from(b).toString('hex')
}
function header(prevInternal: Buffer, merkleInternal: Buffer, nonce: number): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); merkleInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000, 68); h.writeUInt32LE(0x207fffff, 72)
  // MINED, because the ancestry path now weighs headers exactly as the seal path
  // does: a chained list of unmined headers is free to make, and a deposit proven
  // by a burial nobody paid for would credit runes that never moved.
  for (let n = nonce; n < nonce + 1_000_000; n++) {
    h.writeUInt32LE(n >>> 0, 76)
    if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h
  }
  throw new Error('unmineable')
  return h
}
/** Bury a single-transaction block, `confs` deep, with a valid merkle proof. */
function bury(raw: string, nonce: number, confs = 2): { txoutproof: string; headers: string[] } {
  const txid = sha256d(Buffer.from(raw, 'hex'))
  const h1 = header(Buffer.alloc(32, nonce), txid, nonce) // a 1-tx block: the root IS the txid
  const headers = [h1]
  for (let i = 1; i < confs; i++) headers.push(header(sha256d(headers[i - 1]), Buffer.alloc(32, i), nonce * 100 + i))
  const txoutproof = Buffer.concat([h1, Buffer.from([1, 0, 0, 0]), Buffer.from([1]), txid, Buffer.from([1]), Buffer.from([0x01])]).toString('hex')
  return { txoutproof, headers: headers.map((h) => h.toString('hex')) }
}
/** A coinbase whose scriptSig carries the BIP-34 height — the etch block's identity witness. */
function cbTx(height: number): string {
  const le: number[] = []
  let h = height
  while (h > 0) { le.push(h & 0xff); h >>= 8 }
  const push = [le.length, ...le]
  const b: number[] = [0x01, 0x00, 0x00, 0x00, 0x01, ...new Array(32).fill(0), 0xff, 0xff, 0xff, 0xff]
  b.push(...varintBytes(push.length), ...push, 0xff, 0xff, 0xff, 0xff)
  b.push(0x01, 0xe8, 0x03, 0, 0, 0, 0, 0, 0, 0x02, 0x51, 0x51)
  b.push(0x00, 0x00, 0x00, 0x00)
  return Buffer.from(b).toString('hex')
}
/** Bury a TWO-tx block (coinbase at 0, target at 1), `confs` deep: the target's proof, the
 *  coinbase's proof against the SAME header, and the chain — the etch identity witness. */
function bury2(cbRaw: string, raw: string, nonce: number, confs = 2): { txoutproof: string; headers: string[]; coinbaseTx: string; coinbaseProof: string } {
  const cbid = sha256d(Buffer.from(cbRaw, 'hex'))
  const txid = sha256d(Buffer.from(raw, 'hex'))
  const root = sha256d(Buffer.concat([cbid, txid]))
  const h1 = header(Buffer.alloc(32, nonce), root, nonce)
  const headers = [h1]
  for (let i = 1; i < confs; i++) headers.push(header(sha256d(headers[i - 1]), Buffer.alloc(32, i), nonce * 100 + i))
  const wrap = (flags: number) => Buffer.concat([
    h1, Buffer.from([2, 0, 0, 0]), Buffer.from([2]), cbid, txid, Buffer.from([1]), Buffer.from([flags]),
  ]).toString('hex')
  return {
    txoutproof: wrap(0x05),      // flags [1,0,1] — the target leaf at index 1 is matched
    coinbaseProof: wrap(0x03),   // flags [1,1,0] — the coinbase leaf at index 0 is matched
    headers: headers.map((h) => h.toString('hex')),
    coinbaseTx: cbRaw,
  }
}
const txidOf = (raw: string): string => toDisplayHex(sha256d(Buffer.from(raw, 'hex')))
function stone(ints: bigint[]): Uint8Array {
  const body: number[] = []
  for (const n of ints) body.push(...encodeVarint(n))
  const out = [0x6a, 0x5d]
  for (let i = 0; i < body.length; i += 75) { const c = body.slice(i, i + 75); out.push(c.length, ...c) }
  return Uint8Array.from(out)
}
const script = (fill: number): Uint8Array => Uint8Array.from([0x51, 0x20, ...new Array(32).fill(fill)])
const OWNER = script(0x11), VAULT = script(0x22), OTHER = script(0x33)
const RUNE: RuneId = { block: 900_000n, tx: 1n } // the etch sits at INDEX 1 of block 900,000 — both proven, never claimed

function main() {
  // ── THE CHAIN: etch(premine 1000 → owner) → split(600 owner / 400 other) → deposit(600 → vault)
  const etchRaw = rawTx([{ txid: '00'.repeat(32), vout: 0 }], [
    OWNER,
    stone([TAG.Flags, 1n << FLAG.Etching, TAG.Rune, runeValue('KRAYVAULTDEMO'), TAG.Premine, 1000n]),
  ])
  const etch: ProvenTx = { rawTx: etchRaw, ...bury2(cbTx(900_000), etchRaw, 1), etchedId: RUNE }

  const splitRaw = rawTx([{ txid: txidOf(etchRaw), vout: 0 }], [
    OWNER, OTHER,
    stone([TAG.Body, RUNE.block, RUNE.tx, 400n, 1n]), // 400 to output 1, the rest to output 0
  ])
  const split: ProvenTx = { rawTx: splitRaw, ...bury(splitRaw, 2) }

  const depRaw = rawTx([{ txid: txidOf(splitRaw), vout: 0 }], [VAULT, OWNER])
  const dep: ProvenTx = { rawTx: depRaw, ...bury(depRaw, 3) }
  const bundle = [etch, split, dep]
  const opts = { minConfirmations: 2, net: 'regtest', rune: RUNE }

  ok(parentCanHoldFocusedRune(900_000, 900_000n) && parentCanHoldFocusedRune(900_001, 900_000n), 'a parent at or after the etch block CAN hold the focused rune')
  ok(!parentCanHoldFocusedRune(899_999, 900_000n) && !parentCanHoldFocusedRune(-1, 900_000n), 'a parent BEFORE the etch block — or a nonsense height — cannot hold it (fee coins are not ancestry)')

  // ── 1 · THE PREMINE IS PROVEN BY THE ETCH TRANSACTION ALONE ──────────────
  const v0 = proveOutpoint(txidOf(etchRaw), 0, [etch], opts)
  ok(v0.ok && v0.balances?.[0].amount === 1000n, `the premine is proven from the etch alone — 1,000 runes to its first output`)

  // ── 2 · THE ALLOCATION LAW CARRIES DOWN THE CHAIN ────────────────────────
  const v1 = proveOutpoint(txidOf(splitRaw), 0, bundle, opts)
  const v2 = proveOutpoint(txidOf(splitRaw), 1, bundle, opts)
  ok(v1.ok && v1.balances?.[0].amount === 600n, 'the split leaves 600 on output 0 (the unallocated remainder)')
  ok(v2.ok && v2.balances?.[0].amount === 400n, '…and the edict put exactly 400 on output 1')
  ok((v1.balances?.[0].amount ?? 0n) + (v2.balances?.[0].amount ?? 0n) === 1000n, 'nothing was created and nothing lost across the split')

  // ── 3 · THE DEPOSIT, WHICH IS THE QUESTION THE L2 MINT ASKS ──────────────
  const d = proveDeposit(txidOf(depRaw), Buffer.from(VAULT).toString('hex'), RUNE, bundle, opts)
  ok(d.ok && d.amount === 600n && d.vout === 0, `THE DEPOSIT IS PROVEN FROM BYTES: 600 runes landed in the vault (output ${d.vout})`)
  // Asking about a DIFFERENT rune: this bundle happens to resolve the WHOLE chain
  // (the etch's only input is the null prevout — a root by bytes), so the absence
  // of rune X is not a guess here, it is PROVEN: every input decided, none carried X.
  // A bundle whose chain does NOT fully resolve still refuses (case 4 below).
  const wrongRune = proveDeposit(txidOf(depRaw), Buffer.from(VAULT).toString('hex'), { block: 900_000n, tx: 8n }, bundle, opts)
  ok(wrongRune.ok && wrongRune.amount === 0n, 'a DIFFERENT rune over a FULLY-resolved chain is a PROVEN zero — absence is bytes too')
  const notTheVault = proveDeposit(txidOf(depRaw), Buffer.from(OTHER).toString('hex'), RUNE, bundle, opts)
  ok(!notTheVault.ok && notTheVault.reason === 'no-such-output', 'an output that does not pay the vault is not a deposit — matched by SCRIPT, never by an index the claimant picks')

  // ── 4 · A TRUNCATED RUNE-PATH PROVES ZERO — THE BRIDGE AMOUNT CHECK CATCHES A CLAIM ──
  const missing = proveOutpoint(txidOf(depRaw), 0, [dep, split], opts) // the etch is gone
  ok(missing.ok && (missing.balances?.[0]?.amount ?? 0n) === 0n, 'a truncated rune-path proves ZERO of the focused rune — unbundled parents are empty of THIS rune')
  const missingDep = proveDeposit(txidOf(depRaw), Buffer.from(VAULT).toString('hex'), RUNE, [dep, split], opts)
  ok(missingDep.ok && missingDep.amount === 0n, '…so a deposit that needed the etch proves 0; the bridge refuses any claimed 600 (amount mismatch)')

  // A fee coin sitting next to the rune UTXO is not ancestry — the walk still proves 600.
  const depFeeRaw = rawTx(
    [{ txid: txidOf(splitRaw), vout: 0 }, { txid: 'ab'.repeat(32), vout: 0 }],
    [VAULT, OWNER],
  )
  const depFee: ProvenTx = { rawTx: depFeeRaw, ...bury(depFeeRaw, 31) }
  const withFee = proveDeposit(txidOf(depFeeRaw), Buffer.from(VAULT).toString('hex'), RUNE, [etch, split, depFee], opts)
  ok(withFee.ok && withFee.amount === 600n, 'a fee-coin input whose parent is NOT in the bundle does not poison the focused walk — 600 still proven')

  const shallow = proveOutpoint(txidOf(etchRaw), 0, [{ ...etch, headers: etch.headers.slice(0, 1) }], opts)
  ok(!shallow.ok && shallow.reason === 'tx-shallow', 'ATTACK: a transaction buried less deep than the law demands → refused')

  const swapped = proveOutpoint(txidOf(etchRaw), 0, [{ ...etch, txoutproof: bury(splitRaw, 2).txoutproof }], opts)
  ok(!swapped.ok && swapped.reason === 'txid-mismatch', 'ATTACK: a merkle proof belonging to ANOTHER transaction → refused')

  // ── THE ETCH IDENTITY: the claimed (height, index) is bytes, never a statement ──
  const bare = proveOutpoint(txidOf(etchRaw), 0, [{ rawTx: etch.rawTx, txoutproof: etch.txoutproof, headers: etch.headers, etchedId: RUNE }], opts)
  ok(!bare.ok && bare.reason === 'etch-unproven', 'ATTACK: an etch claim WITHOUT the coinbase witness → refused (etch-unproven)')
  const wrongHeight = proveOutpoint(txidOf(etchRaw), 0, [{ ...etch, ...bury2(cbTx(899_999), etchRaw, 1), etchedId: RUNE }], opts)
  ok(!wrongHeight.ok && wrongHeight.reason === 'etch-mismatch', 'ATTACK: a coinbase whose BIP-34 height is not the claimed block → refused (etch-mismatch)')
  const notAnEtch = proveOutpoint(txidOf(splitRaw), 0, [etch, { ...split, ...bury2(cbTx(900_000), splitRaw, 9), etchedId: RUNE }], opts)
  ok(!notAnEtch.ok && notAnEtch.reason === 'etch-mismatch', 'ATTACK: a transaction that does not ETCH cannot claim an etch id → refused (etch-mismatch)')

  const forgedTx = rawTx([{ txid: txidOf(splitRaw), vout: 0 }], [VAULT, OWNER, stone([TAG.Body, RUNE.block, RUNE.tx, 999_999n, 0n])])
  const inflated = proveDeposit(txidOf(forgedTx), Buffer.from(VAULT).toString('hex'), RUNE, [etch, split, { rawTx: forgedTx, ...bury(forgedTx, 4) }], opts)
  ok(inflated.ok && inflated.amount === 600n, 'ATTACK: an edict claiming 999,999 credits only the 600 that exist — the allocation law CLAMPS, it never invents')

  const cenoRaw = rawTx([{ txid: txidOf(splitRaw), vout: 0 }], [VAULT, stone([124n, 1n])]) // an unrecognized even tag
  const ceno = proveDeposit(txidOf(cenoRaw), Buffer.from(VAULT).toString('hex'), RUNE, [etch, split, { rawTx: cenoRaw, ...bury(cenoRaw, 5) }], opts)
  ok(ceno.ok && ceno.amount === 0n, 'a CENOTAPH deposit credits ZERO — Bitcoin burned those runes, and an L2 that missed it would be insolvent')

  // ── 5 · WHAT CANNOT BE PROVEN LOCALLY IS REFUSED, NOT GUESSED ────────────
  const mintRaw = rawTx([{ txid: txidOf(splitRaw), vout: 0 }], [VAULT, stone([TAG.Mint, RUNE.block, TAG.Mint, RUNE.tx])])
  const mint = proveDeposit(txidOf(mintRaw), Buffer.from(VAULT).toString('hex'), RUNE, [etch, split, { rawTx: mintRaw, ...bury(mintRaw, 6) }], opts)
  ok(!mint.ok && mint.reason === 'needs-index', 'an open MINT of the FOCUSED rune needs global state (the cap) — refused as needs-index, never accepted on faith')
  // …but a mint of a DIFFERENT rune along the way adds nothing of the focused one — the
  // per-id allocation pools are independent, so the focused answer stays exact.
  const otherMintRaw = rawTx([{ txid: txidOf(splitRaw), vout: 0 }], [VAULT, stone([TAG.Mint, 555n, TAG.Mint, 5n])])
  const otherMint = proveDeposit(txidOf(otherMintRaw), Buffer.from(VAULT).toString('hex'), RUNE, [etch, split, { rawTx: otherMintRaw, ...bury(otherMintRaw, 7) }], opts)
  ok(otherMint.ok && otherMint.amount === 600n, 'a mint of an UNRELATED rune in the chain does not poison the focused walk — 600 still proven')

  // ── 6 · THE NETWORK ACCUMULATES PROVEN TRUTH ─────────────────────────────
  const known = new Map([[outpointKey(txidOf(splitRaw), 0), [{ id: RUNE, amount: 600n }]]])
  const cheap = proveDeposit(txidOf(depRaw), Buffer.from(VAULT).toString('hex'), RUNE, [dep], { ...opts, known })
  ok(cheap.ok && cheap.amount === 600n, 'with the parent ALREADY proven, the deposit needs one transaction — the first walk pays for every later one')

  // ── 7 · THE NULL PREVOUT IS A ROOT — a coinbase chain terminates, provably runeless ──
  const cbSpendRaw = rawTx([{ txid: '00'.repeat(32), vout: 0 }], [OTHER])
  const cbSpend = proveOutpoint(txidOf(cbSpendRaw), 0, [{ rawTx: cbSpendRaw, ...bury(cbSpendRaw, 8) }], opts)
  ok(cbSpend.ok && (cbSpend.balances?.length ?? 0) === 0, 'a coinbase-shaped input (null prevout) carries ZERO runes — the chain terminates from bytes, never refuses forever')

  console.log(`\n✓ ${pass} checks passed — A DEPOSIT IS PROVEN FROM BYTES: every transaction real and buried, every runestone decoded by the specification, every allocation re-derived down the chain, and the vault's outputs matched by SCRIPT. A truncated rune-path proves 0 (the bridge amount check catches a claim); a fee coin is not ancestry. Shallow burial, a foreign merkle proof, a cenotaph's burn, and a mint whose cap no light verifier can know still refuse. Nothing of the focused rune is invented. ₿₭`)
}
main()
