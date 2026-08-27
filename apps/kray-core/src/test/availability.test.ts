/**
 * AVAILABILITY WITNESS (ADR-3 · the trustless half of 3d) — a citizen anchors their act on Bitcoin, and the
 * "it was public by its deadline" fact rests on nothing but Bitcoin (Route B, the Creator's ruling).
 *
 *   node src/test/availability.test.ts
 *
 * Pins the NEW logic (the SPV burial + BIP-34 height are the already-proven proveTxBuried / bip34Height, reused):
 *   1. the availability ROOT is an inclusion tree of the act keys — membership AND non-membership are 3a's proofs.
 *   2. the OP_RETURN commitment round-trips: payload → script → extractAvailabilityRoot → the same root; a tx with
 *      no KRAY.AVAILABLE carries none; the seal's KRAY.NETWORK tag is NOT mistaken for it.
 *   3. verifyAvailability refuses fail-closed: a bad key, a tx that is not buried, no commitment, a non-member.
 *   4. batching — one root protects many acts; each proves itself; an act NOT in the batch cannot borrow the anchor.
 *
 * This produces availableBySeal = H trustlessly; 3d checks H ≤ the SIGNED deadline. Not the whole 3d verdict.
 */
import { createHash } from 'node:crypto'
import { availabilityRoot, proveAvailability, verifyAvailabilityMembership, availabilityPayload, extractAvailabilityRoot, verifyAvailability } from '../protocol/availability.ts'
import { inclusionRoot, EMPTY_ROOT } from '../protocol/inclusion-tree.ts'
import { sha256d, checkProofOfWork } from '../anchor/spv.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const key = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/** A minimal legacy raw tx (one dummy input, one output) carrying `scriptHex` — enough for parseTx's outputs. */
function rawTxWithOutput(scriptHex: string): string {
  const script = Buffer.from(scriptHex, 'hex')
  return Buffer.concat([
    Buffer.from('02000000', 'hex'),   // version
    Buffer.from('01', 'hex'),         // 1 input
    Buffer.alloc(32),                 // prevout hash (dummy)
    Buffer.from('00000000', 'hex'),   // prevout index
    Buffer.from('00', 'hex'),         // scriptSig len 0
    Buffer.from('ffffffff', 'hex'),   // sequence
    Buffer.from('01', 'hex'),         // 1 output
    Buffer.alloc(8),                  // value 0
    Buffer.from([script.length]),     // script len (< 0xfd)
    script,
    Buffer.from('00000000', 'hex'),   // locktime
  ]).toString('hex')
}
const opReturn = (payloadHex: string) => '6a' + Buffer.from([payloadHex.length / 2]).toString('hex') + payloadHex

// ── a synthetic, fully valid Bitcoin block of TWO txs (coinbase@0 + the availability tx@1), so the SPV path of
//    verifyAvailability is exercised end-to-end (the council's coverage gap) and the index-0 fix is proven ──
function buildHeader(merkleRootInternal: Buffer): Buffer {
  const hh = Buffer.alloc(80)
  hh.writeUInt32LE(0x20000000, 0); merkleRootInternal.copy(hh, 36)
  hh.writeUInt32LE(1_700_000_000, 68); hh.writeUInt32LE(0x207fffff, 72)
  for (let n = 1; n < 4_000_000; n++) { hh.writeUInt32LE(n >>> 0, 76); if (checkProofOfWork(hh.toString('hex'), 'regtest').ok) return hh }
  throw new Error('could not mine a regtest header — impossible in practice')
}
/** a minimal legacy tx: one input (scriptSig, prevout null) + one output (script). */
function rawTx(scriptSigHex: string, outScriptHex: string): string {
  const ss = Buffer.from(scriptSigHex, 'hex'), os = Buffer.from(outScriptHex, 'hex')
  return Buffer.concat([
    Buffer.from('01000000', 'hex'), Buffer.from('01', 'hex'), Buffer.alloc(32), Buffer.from('ffffffff', 'hex'),
    Buffer.from([ss.length]), ss, Buffer.from('ffffffff', 'hex'),
    Buffer.from('01', 'hex'), Buffer.alloc(8), Buffer.from([os.length]), os, Buffer.from('00000000', 'hex'),
  ]).toString('hex')
}
/** the block header + BIP-37 merkle proofs for a 2-leaf tree: coinbase at index 0, avail tx at index 1. */
function twoTxBlock(coinbaseTx: string, availTx: string) {
  const leaf0 = sha256d(Buffer.from(coinbaseTx, 'hex'))   // coinbase txid (internal byte order)
  const leaf1 = sha256d(Buffer.from(availTx, 'hex'))       // avail txid (internal)
  const header = buildHeader(sha256d(Buffer.concat([leaf0, leaf1])))
  //   flags 0x05 = [root:recurse, left:hash leaf0, right:MATCH leaf1] → proves the avail tx at index 1
  //   flags 0x03 = [root:recurse, left:MATCH leaf0, right:hash leaf1] → proves the coinbase at index 0
  const mb = (flags: number) => Buffer.concat([header, Buffer.from([2, 0, 0, 0]), Buffer.from([2]), leaf0, leaf1, Buffer.from([1]), Buffer.from([flags])]).toString('hex')
  return { headers: [header.toString('hex')], availProof: mb(0x05), coinbaseProof: mb(0x03) }
}

function main() {
  console.log('\n╔═ AVAILABILITY WITNESS — a citizen anchors their act on Bitcoin; the witness is trustless (ADR-3 Route B) ═╗\n')

  const acts = ['transfer|a', 'inscribe|b', 'name|c'].map(key)
  const root = availabilityRoot(acts)

  // ── 1 · the root is 3a's inclusion tree; membership + non-membership are 3a's proofs ──
  ok(root === inclusionRoot(acts), 'the availability root IS the inclusion tree of the anchored act keys — one commitment, one proof language as 3a/3d')
  ok(verifyAvailabilityMembership(root, acts[1], proveAvailability(acts, acts[1])), 'an anchored act PROVES a member of the root')
  const outsider = key('never|anchored')
  ok(!verifyAvailabilityMembership(root, outsider, proveAvailability(acts, outsider)), 'an act NOT in the batch is provably NON-member — it cannot borrow the anchor')

  // ── 2 · the OP_RETURN commitment round-trips ──
  {
    const rawTx = rawTxWithOutput(opReturn(availabilityPayload(root)))
    ok(extractAvailabilityRoot(rawTx) === root, 'payload → OP_RETURN → extractAvailabilityRoot recovers the exact committed root')
    ok(extractAvailabilityRoot(rawTxWithOutput('6a0401020304')) === null, 'a tx whose OP_RETURN is not a KRAY.AVAILABLE commitment carries no root')
    // the seal's KRAY.NETWORK OP_RETURN must not be read as an availability commitment
    const sealScript = '6a31' + Buffer.from('KRAY.NETWORK', 'ascii').toString('hex') + '01' + '00000000' + root
    ok(extractAvailabilityRoot(rawTxWithOutput(sealScript)) === null, 'a KRAY.NETWORK seal OP_RETURN is NOT mistaken for an availability commitment (distinct tag)')
  }

  // ── 3 · verifyAvailability refuses fail-closed (SPV re-derived; a non-buried tx never yields a height) ──
  {
    const rawTx = rawTxWithOutput(opReturn(availabilityPayload(root)))
    const dummyProof = { rawTx, txoutproof: '', headers: [], coinbaseTx: '', coinbaseTxOutProof: '', membership: proveAvailability(acts, acts[0]) }
    ok(verifyAvailability('not-hex', dummyProof, { net: 'main', minConfirmations: 6 }).ok === false, 'a malformed act key is refused')
    const v = verifyAvailability(acts[0], dummyProof, { net: 'main', minConfirmations: 6 })
    ok(v.ok === false && /not buried|headers/.test((v as { reason: string }).reason), 'a tx with no burial proof is refused — availability is NEVER asserted without real Bitcoin work (fail-closed)')
    // council: the SPV primitives THROW on garbage bytes; a verifier iterating hostile claims must get a VERDICT
    const garbled = verifyAvailability(acts[0], { rawTx: 'zz', txoutproof: 'zz', headers: ['00'], coinbaseTx: 'zz', coinbaseTxOutProof: 'zz', membership: proveAvailability(acts, acts[0]) }, { net: 'main', minConfirmations: 1 })
    ok(garbled.ok === false && /malformed|not buried|not proven/.test((garbled as { reason: string }).reason), 'a MALFORMED proof (garbage bytes) returns a NAMED refusal, never an uncaught throw — fail-closed for a batch/API verifier (a throw is never a false availability either)')
  }

  // ── 4 · batching — one root, many acts, each proves itself; the empty batch is EMPTY_ROOT ──
  {
    const many = Array.from({ length: 25 }, (_, i) => key('batch|' + i))
    const r = availabilityRoot(many)
    ok(many.every((k) => verifyAvailabilityMembership(r, k, proveAvailability(many, k))), 'all 25 batched acts prove members of the one anchored root — a single Bitcoin tx protects the whole batch')
    ok(availabilityRoot([]) === EMPTY_ROOT, 'the empty batch is EMPTY_ROOT')
  }

  // ── 5 · the TRUSTLESS SPV path end-to-end (council coverage gap) + the coinbase index-0 forgery is refused ──
  {
    const oneAct = [key('spv|act')]
    const root5 = availabilityRoot(oneAct)
    const coinbaseTx = rawTx('0350f80c', '51')                          // scriptSig pushes height 850000 (0x0cf850 LE); OP_TRUE out
    const availTx = rawTx('0340d10c', opReturn(availabilityPayload(root5)))   // a FAKE height 840000 in its scriptSig; OP_RETURN out
    const blk = twoTxBlock(coinbaseTx, availTx)
    const membership = proveAvailability(oneAct, oneAct[0])
    const opts = { net: 'regtest', minConfirmations: 1 }

    const good = verifyAvailability(oneAct[0], { rawTx: availTx, txoutproof: blk.availProof, headers: blk.headers, coinbaseTx, coinbaseTxOutProof: blk.coinbaseProof, membership }, opts)
    ok(good.ok === true && (good as { availableAtHeight: number }).availableAtHeight === 850_000, 'END-TO-END: a real buried availability tx yields the trustless BIP-34 height (850000) read from the coinbase at index 0 — every byte re-derived, no trust')
    ok(good.ok === true && (good as { root: string }).root === root5, 'and the committed availability root is recovered — the act is provably public by that height')

    // THE FORGERY the council found: present the availability tx (index 1, a fake 840000 in its OWN scriptSig) AS the coinbase
    const forged = verifyAvailability(oneAct[0], { rawTx: availTx, txoutproof: blk.availProof, headers: blk.headers, coinbaseTx: availTx, coinbaseTxOutProof: blk.availProof, membership }, opts)
    ok(forged.ok === false && /index 0/.test((forged as { reason: string }).reason), 'FORGERY REFUSED: a non-coinbase tx (merkle index 1) carrying a chosen BIP-34 height in its scriptSig CANNOT set the availability height — only index 0 is the coinbase (the council fix closes the false-CENSORED lever)')
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the availability witness is another Bitcoin anchor, the citizen's own; no mirror, no federation, no trust. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
