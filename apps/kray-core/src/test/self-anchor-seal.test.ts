/**
 * THE SELF-ANCHOR IS A FIRST-CLASS ANCHOR (Slice 2a) — fork-choice weighs a burn donation exactly like an
 * operator OP_RETURN of the same root, and a fabricated self-anchor weighs nothing.
 *
 * A self-anchoring burn donation carries no KRAY.NETWORK OP_RETURN — the commitment rides its OUTPUT KEY
 * (pay-to-contract to the NUMS point tweaked by the root). This proves verifySealProof now re-derives that from
 * the raw bytes: it recomputes selfAnchorScriptHex(NUMS, payload(blockNumber, root)) and requires an output to pay
 * it, then applies the SAME burial law (merkle → headers → work) as an OP_RETURN anchor. So the network counts
 * "each donation IS the anchor" in consensus, with no operator, and no new attack surface: a claim whose output
 * does not commit the promised root is refuted, exactly as a wrong-root OP_RETURN is.
 *
 *   node src/test/self-anchor-seal.test.ts
 */
import { verifySealProof, parseTx, checkProofOfWork, sha256d, toDisplayHex } from '../anchor/spv.ts'
import { provenWeight } from '../protocol/consensus.ts'
import { KrayAnchor } from '../anchor/anchor.ts'
import { selfAnchorScriptHex, BURN_INTERNAL_KEY } from '../protocol/self-anchor.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const HEIGHT = 0
const ROOT = 'b35f059e984796031710529ac5537923e48cd1b85d21cf21378e7ef46f035b84'   // a historical root FIXTURE (the pre-reset 50M-era genesis) — any 32-byte value exercises the seal math
const OTHER = 'a'.repeat(64)

// ── fixture builders (regtest, mirrored from spv.test.ts) ──
function buildRawTxOut(scriptHex: string): string {
  const len = (scriptHex.length / 2).toString(16).padStart(2, '0')
  return '01000000' + '01' + '00'.repeat(32) + 'ffffffff' + '00' + 'ffffffff' + '01' + 'e803000000000000' + len + scriptHex + '00000000'
}
function buildRawTxOpReturn(payloadHex: string): string {
  return '01000000' + '01' + '00'.repeat(32) + 'ffffffff' + '00' + 'ffffffff' + '01' + '00'.repeat(8) + '33' + '6a31' + payloadHex + '00000000'
}
function buildHeader(prevInternal: Buffer, merkleRootInternal: Buffer): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); merkleRootInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000, 68); h.writeUInt32LE(0x207fffff, 72)
  for (let nonce = 0; nonce < 1_000_000; nonce++) { h.writeUInt32LE(nonce, 76); if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h }
  throw new Error('could not mine a regtest header')
}
function buildTxOutProof(header: Buffer, txidInternal: Buffer): string {
  return Buffer.concat([header, Buffer.from([1, 0, 0, 0]), Buffer.from([1]), txidInternal, Buffer.from([1]), Buffer.from([0x01])]).toString('hex')
}
function sealProofFor(rawTx: string): { rawTx: string; txoutproof: string; headers: string[] } {
  const txidInternal = sha256d(Buffer.from(rawTx, 'hex'))
  const h1 = buildHeader(Buffer.alloc(32), txidInternal), h2 = buildHeader(sha256d(h1), Buffer.alloc(32, 7)), h3 = buildHeader(sha256d(h2), Buffer.alloc(32, 9))
  return { rawTx, txoutproof: buildTxOutProof(h1, txidInternal), headers: [h1, h2, h3].map((h) => h.toString('hex')) }
}

function main() {
  console.log('\n╔═ THE SELF-ANCHOR IS A FIRST-CLASS ANCHOR — the donation IS the anchor, weighed like any other ═╗\n')

  // a self-anchoring burn output: pays NUMS tweaked by (HEIGHT, ROOT) — NO KRAY.NETWORK OP_RETURN
  const burnScript = selfAnchorScriptHex(BURN_INTERNAL_KEY, KrayAnchor.payload(HEIGHT, ROOT))
  ok(burnScript.startsWith('5120') && burnScript.length === 68, 'the self-anchor output is an ordinary taproot script (5120…) — invisible on-chain')
  const saProof = sealProofFor(buildRawTxOut(burnScript))
  const va = verifySealProof(saProof, { cascadeRoot: ROOT, blockNumber: HEIGHT, minConfirmations: 2, net: 'regtest' })
  ok(va.ok && va.sealedCascadeRoot === ROOT && va.sealedBlockNumber === HEIGHT, 'verifySealProof RECOGNISES the self-anchor from raw bytes and re-derives (blockNumber, root) — buried, no OP_RETURN needed')

  // an operator OP_RETURN anchor of the SAME root, same regtest burial
  const opProof = sealProofFor(buildRawTxOpReturn(KrayAnchor.payload(HEIGHT, ROOT)))
  const vo = verifySealProof(opProof, { cascadeRoot: ROOT, blockNumber: HEIGHT, minConfirmations: 2, net: 'regtest' })
  ok(vo.ok, 'the operator OP_RETURN anchor of the same root still verifies (nothing removed)')
  ok(va.work === vo.work && va.work! > 0n, `the self-anchor weighs EXACTLY the same Bitcoin work as the OP_RETURN anchor (${va.work}) — one law, two shapes`)

  // ── a FABRICATED self-anchor is refuted: the output commits ROOT, but the claim says OTHER ──
  const vFake = verifySealProof(saProof, { cascadeRoot: OTHER, blockNumber: HEIGHT, minConfirmations: 2, net: 'regtest' })
  ok(!vFake.ok && /no self-anchor output commits this/.test(vFake.reason || ''), 'a self-anchor claiming a root its output does NOT commit is REFUSED (no new attack surface)')

  // ── provenWeight (fork-choice): a self-anchor is COUNTED; a fabricated one is REFUTED, not counted ──
  const wReal = provenWeight({ network: 'regtest', cascadeRoot: ROOT, anchors: [{ height: HEIGHT, cascadeRoot: ROOT, proof: saProof }] } as never, 2)
  ok(wReal.provenAnchors === 1 && wReal.refuted === 0 && wReal.totalWork > 0n, 'fork-choice COUNTS the self-anchor: 1 proven, 0 refuted, real Bitcoin work behind it')
  const wFake = provenWeight({ network: 'regtest', cascadeRoot: OTHER, anchors: [{ height: HEIGHT, cascadeRoot: OTHER, proof: saProof }] } as never, 2)
  ok(wFake.provenAnchors === 0 && wFake.refuted === 1 && wFake.totalWork === 0n, 'a fabricated self-anchor weighs NOTHING and marks itself refuted — same discipline as a forged OP_RETURN')

  // ── a self-anchor and an OP_RETURN of the same root are ONE anchor of the same history (equal weight) ──
  const wBoth = provenWeight({ network: 'regtest', cascadeRoot: ROOT, anchors: [{ height: HEIGHT, cascadeRoot: ROOT, proof: saProof }, { height: HEIGHT, cascadeRoot: ROOT, proof: opProof }] } as never, 2)
  ok(wBoth.provenAnchors === 2 && wBoth.anchoredRoot === ROOT, 'both shapes prove the SAME root — the operator anchor is now provably redundant with the donation’s own anchor')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the donation’s own output is a proven Bitcoin anchor, weighed by work, forgery-proof. The operator is no longer needed to seal. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
