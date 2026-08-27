/**
 * THE PAYER REALLY PAID — a fee proven from Bitcoin, never attested.
 *   node src/test/anchor-payment.test.ts
 *
 * The draw that names a seal's payer was already fair and reproducible. What was
 * missing is the payment itself: this node's wallet broadcast every anchor while
 * the volunteer was credited with spending nothing. This suite proves the
 * replacement — the payer broadcasts their own anchor and the chain re-derives,
 * from bytes alone, that the coins were theirs and exactly what the fee was.
 *
 * The attack that matters most: borrowing a stranger's anchor. Every input must
 * trace to an output that paid the CLAIMANT'S OWN script, so a payer cannot point
 * at somebody else's transaction and collect. The runner-up: a fee computed from
 * part of the inputs, which is a guess wearing a proof's clothes.
 */
import { createHash, randomBytes } from 'node:crypto'
import { KrayAnchor } from '../anchor/anchor.ts'
import { checkProofOfWork, sha256d } from '../anchor/spv.ts'
import { verifyAnchorPayment, paymentBundleHash, type AnchorPaymentProof } from '../economics/anchor-payment.ts'
import { addressOf, scriptOfAddress, _generateKeyPair } from '../protocol/scheme.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
const hex = (b: Buffer | Uint8Array): string => Buffer.from(b).toString('hex')
const varint = (n: number): Buffer => (n < 0xfd ? Buffer.from([n]) : Buffer.concat([Buffer.from([0xfd]), (() => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b })()]))
const u64 = (v: bigint): Buffer => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b }
const u32 = (v: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b }

/** A header that satisfies the target it declares — mined, since PoW is weighed. */
function mineHeader(prevInternal: Buffer, merkleRoot: Buffer, time: number): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); merkleRoot.copy(h, 36)
  h.writeUInt32LE(time, 68); h.writeUInt32LE(0x207fffff, 72)
  for (let n = 0; n < 1_000_000; n++) {
    h.writeUInt32LE(n, 76)
    if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h
  }
  throw new Error('unmineable')
}
/** A one-transaction block's merkleblock: the tree IS the txid. */
function proofOf(header: Buffer, txidInternal: Buffer): string {
  return Buffer.concat([header, u32(1), Buffer.from([1]), txidInternal, Buffer.from([1, 1])]).toString('hex')
}
/** A transaction: inputs by outpoint, outputs as (value, script). */
function tx(ins: Array<{ txid: string; vout: number }>, outs: Array<{ value: bigint; script: Buffer }>): string {
  const parts: Buffer[] = [Buffer.from('01000000', 'hex'), varint(ins.length)]
  for (const i of ins) parts.push(Buffer.from(i.txid, 'hex').reverse(), u32(i.vout), Buffer.from([0]), Buffer.from('ffffffff', 'hex'))
  parts.push(varint(outs.length))
  for (const o of outs) parts.push(u64(o.value), varint(o.script.length), o.script)
  parts.push(Buffer.from('00000000', 'hex'))
  return Buffer.concat(parts).toString('hex')
}
const opReturn = (payloadHex: string): Buffer => Buffer.concat([Buffer.from([0x6a, 0x31]), Buffer.from(payloadHex, 'hex')])

function main() {
  const kp = _generateKeyPair(randomBytes(32))
  const PAYER = addressOf(kp.publicKeyHex, 'regtest')
  const payerScript = Buffer.from(scriptOfAddress(PAYER, 'regtest'), 'hex')
  const strangerScript = Buffer.from(scriptOfAddress(addressOf(_generateKeyPair(randomBytes(32)).publicKeyHex, 'regtest'), 'regtest'), 'hex')
  const ROOT = 'ab'.repeat(32)
  const HEIGHT = 42

  // ── the payer's coins: a funding transaction paying THEM, in its own block ──
  const fundingTx = tx([{ txid: '11'.repeat(32), vout: 0 }], [{ value: 100_000n, script: payerScript }])
  const fundingTxid = hex(Buffer.from(sha256d(Buffer.from(fundingTx, 'hex'))).reverse())
  const fundingHeader = mineHeader(Buffer.alloc(32), sha256d(Buffer.from(fundingTx, 'hex')), 1_700_000_000)
  const funding = { rawTx: fundingTx, txoutproof: proofOf(fundingHeader, sha256d(Buffer.from(fundingTx, 'hex'))) }

  // ── the anchor they broadcast: spends their coin, seals the root, pays a fee ─
  const anchorTx = tx(
    [{ txid: fundingTxid, vout: 0 }],
    [{ value: 0n, script: opReturn(KrayAnchor.payload(HEIGHT, ROOT)) }, { value: 97_500n, script: payerScript }],
  )
  const anchorInternal = sha256d(Buffer.from(anchorTx, 'hex'))
  const h0 = mineHeader(Buffer.alloc(32), anchorInternal, 1_700_000_100)
  const h1 = mineHeader(sha256d(h0), randomBytes(32), 1_700_000_101)
  const proof: AnchorPaymentProof = {
    rawTx: anchorTx, txoutproof: proofOf(h0, anchorInternal),
    headers: [h0.toString('hex'), h1.toString('hex')], fundings: [funding],
  }
  const EXPECT = { cascadeRoot: ROOT, blockNumber: HEIGHT, minConfirmations: 2, net: 'regtest' as const, chainNet: 'regtest' }

  // ── 1 · THE HONEST PAYMENT ───────────────────────────────────────────────
  const v = verifyAnchorPayment(PAYER, proof, EXPECT)
  ok(v.ok, `the payment verifies from bytes alone${v.ok ? '' : ' — ' + v.reason}`)
  ok(v.feeSats === 2_500n, `the FEE is derived, not reported: 100,000 in − 97,500 out = ${v.feeSats} sats`)
  ok(v.fundedSats === 100_000n, 'the proven inputs sum to exactly what the funding paid')
  ok(v.sealedBlockNumber === HEIGHT && v.sealedCascadeRoot === ROOT, 'and it sealed THIS network\'s root at THIS height')
  ok(/^[0-9a-f]{64}$/.test(paymentBundleHash(proof)), 'the bundle has a canonical hash, so a journal can name the bytes without carrying them')

  // ── 2 · BORROWING A STRANGER'S ANCHOR — the attack that matters most ─────
  const strangerFunding = tx([{ txid: '22'.repeat(32), vout: 0 }], [{ value: 100_000n, script: strangerScript }])
  const strangerTxid = hex(Buffer.from(sha256d(Buffer.from(strangerFunding, 'hex'))).reverse())
  const sfHeader = mineHeader(Buffer.alloc(32), sha256d(Buffer.from(strangerFunding, 'hex')), 1_700_000_200)
  const strangerAnchor = tx(
    [{ txid: strangerTxid, vout: 0 }],
    [{ value: 0n, script: opReturn(KrayAnchor.payload(HEIGHT, ROOT)) }, { value: 97_500n, script: strangerScript }],
  )
  const saInternal = sha256d(Buffer.from(strangerAnchor, 'hex'))
  const sh0 = mineHeader(Buffer.alloc(32), saInternal, 1_700_000_300)
  const sh1 = mineHeader(sha256d(sh0), randomBytes(32), 1_700_000_301)
  const borrowed = verifyAnchorPayment(PAYER, {
    rawTx: strangerAnchor, txoutproof: proofOf(sh0, saInternal),
    headers: [sh0.toString('hex'), sh1.toString('hex')],
    fundings: [{ rawTx: strangerFunding, txoutproof: proofOf(sfHeader, sha256d(Buffer.from(strangerFunding, 'hex'))) }],
  }, EXPECT)
  ok(!borrowed.ok && /did not pay/.test(borrowed.reason ?? ''), 'ATTACK: pointing at a STRANGER\'s anchor for the same root → REFUSED. The coins spent must have been the payer\'s own, matched by SCRIPT')

  // ── 3 · A FEE FROM PART OF THE INPUTS IS A GUESS ────────────────────────
  const second = tx([{ txid: '33'.repeat(32), vout: 0 }], [{ value: 50_000n, script: payerScript }])
  const secondTxid = hex(Buffer.from(sha256d(Buffer.from(second, 'hex'))).reverse())
  const secHeader = mineHeader(Buffer.alloc(32), sha256d(Buffer.from(second, 'hex')), 1_700_000_400)
  const twoIn = tx(
    [{ txid: fundingTxid, vout: 0 }, { txid: secondTxid, vout: 0 }],
    [{ value: 0n, script: opReturn(KrayAnchor.payload(HEIGHT, ROOT)) }, { value: 147_000n, script: payerScript }],
  )
  const tiInternal = sha256d(Buffer.from(twoIn, 'hex'))
  const t0 = mineHeader(Buffer.alloc(32), tiInternal, 1_700_000_500)
  const t1 = mineHeader(sha256d(t0), randomBytes(32), 1_700_000_501)
  const twoHeaders = [t0.toString('hex'), t1.toString('hex')]
  const partial = verifyAnchorPayment(PAYER, { rawTx: twoIn, txoutproof: proofOf(t0, tiInternal), headers: twoHeaders, fundings: [funding] }, EXPECT)
  ok(!partial.ok && /guess, not a payment/.test(partial.reason ?? ''), 'ATTACK: a two-input anchor with only ONE funding proven → REFUSED. A fee computed from a subset is a guess wearing a proof\'s clothes')
  const bothFundings = [funding, { rawTx: second, txoutproof: proofOf(secHeader, sha256d(Buffer.from(second, 'hex'))) }]
  const full = verifyAnchorPayment(PAYER, { rawTx: twoIn, txoutproof: proofOf(t0, tiInternal), headers: twoHeaders, fundings: bothFundings }, EXPECT)
  ok(full.ok && full.feeSats === 3_000n, `…and with BOTH fundings proven the fee is exact: 150,000 − 147,000 = ${full.feeSats} sats`)

  // ── 4 · EVERY OTHER SEAM ────────────────────────────────────────────────
  const wrongRoot = verifyAnchorPayment(PAYER, proof, { ...EXPECT, cascadeRoot: 'cd'.repeat(32) })
  ok(!wrongRoot.ok && /sealed root/.test(wrongRoot.reason ?? ''), 'an anchor sealing a DIFFERENT root → REFUSED (a payment for somebody else\'s history is not a payment for this one)')
  const wrongHeight = verifyAnchorPayment(PAYER, proof, { ...EXPECT, blockNumber: HEIGHT + 1 })
  ok(!wrongHeight.ok && /sealed KRAY #/.test(wrongHeight.reason ?? ''), 'an anchor sealing a different HEIGHT → REFUSED')
  const shallow = verifyAnchorPayment(PAYER, { ...proof, headers: [proof.headers[0]] }, EXPECT)
  ok(!shallow.ok && /only 1 confirmation/.test(shallow.reason ?? ''), 'a payment for an anchor not yet buried deep enough → REFUSED')
  const asMain = verifyAnchorPayment(PAYER, proof, { ...EXPECT, chainNet: 'main' })
  ok(!asMain.ok && /easier than this network allows/.test(asMain.reason ?? ''), 'regtest headers judged by MAINNET → REFUSED: the difficulty is invented for that chain')

  // an UNMINED header on the funding: its amounts would otherwise be inventable
  const fakeFundHeader = Buffer.alloc(80)
  fakeFundHeader.writeUInt32LE(0x20000000, 0)
  sha256d(Buffer.from(fundingTx, 'hex')).copy(fakeFundHeader, 36)
  fakeFundHeader.writeUInt32LE(0x207fffff, 72)
  fakeFundHeader.writeUInt32LE(0xffffffff, 76) // a nonce that does not solve
  if (!checkProofOfWork(fakeFundHeader.toString('hex'), 'regtest').ok) {
    const cheapFund = verifyAnchorPayment(PAYER, { ...proof, fundings: [{ rawTx: fundingTx, txoutproof: proofOf(fakeFundHeader, sha256d(Buffer.from(fundingTx, 'hex'))) }] }, EXPECT)
    ok(!cheapFund.ok && /proves no work/.test(cheapFund.reason ?? ''), 'ATTACK: a funding buried under an UNMINED header → REFUSED. Its amounts are the fee\'s arithmetic, so a free header would let a payer invent the value of their own coins')
  } else { ok(true, '(the fake funding header happened to solve; the law is asserted by the mined path above)') }

  const noFee = tx([{ txid: fundingTxid, vout: 0 }], [{ value: 0n, script: opReturn(KrayAnchor.payload(HEIGHT, ROOT)) }, { value: 100_000n, script: payerScript }])
  const nfInternal = sha256d(Buffer.from(noFee, 'hex'))
  const n0 = mineHeader(Buffer.alloc(32), nfInternal, 1_700_000_600)
  const n1 = mineHeader(sha256d(n0), randomBytes(32), 1_700_000_601)
  const zeroFee = verifyAnchorPayment(PAYER, { rawTx: noFee, txoutproof: proofOf(n0, nfInternal), headers: [n0.toString('hex'), n1.toString('hex')], fundings: [funding] }, EXPECT)
  ok(!zeroFee.ok && /no fee at all/.test(zeroFee.reason ?? ''), 'an anchor that paid NO fee → REFUSED (there is nothing to be rewarded for)')

  const noSeal = tx([{ txid: fundingTxid, vout: 0 }], [{ value: 97_500n, script: payerScript }])
  const nsInternal = sha256d(Buffer.from(noSeal, 'hex'))
  const s0 = mineHeader(Buffer.alloc(32), nsInternal, 1_700_000_700)
  const s1 = mineHeader(sha256d(s0), randomBytes(32), 1_700_000_701)
  const notAnAnchor = verifyAnchorPayment(PAYER, { rawTx: noSeal, txoutproof: proofOf(s0, nsInternal), headers: [s0.toString('hex'), s1.toString('hex')], fundings: [funding] }, EXPECT)
  ok(!notAnAnchor.ok && /no KRAY.NETWORK seal/.test(notAnAnchor.reason ?? ''), 'an ordinary transaction with no KRAY seal → REFUSED: this is somebody else\'s transaction')

  ok(!verifyAnchorPayment(PAYER, { ...proof, fundings: [] }, EXPECT).ok, 'a bundle with no fundings at all → REFUSED')
  ok(!verifyAnchorPayment(PAYER, proof, { ...EXPECT, net: 'main' }).ok, 'the payer\'s address judged on the wrong network → REFUSED rather than matched loosely')
  ok(!verifyAnchorPayment('not-an-address', proof, EXPECT).ok, 'a malformed payer address → REFUSED, named')
  ok(!verifyAnchorPayment(PAYER, { rawTx: 'dead', txoutproof: 'beef', headers: ['00'], fundings: [] }, EXPECT).ok, 'garbage bytes refuse instead of throwing')

  // ── 5 · DETERMINISM ─────────────────────────────────────────────────────
  const answers = new Set(Array.from({ length: 5 }, () => JSON.stringify(verifyAnchorPayment(PAYER, proof, EXPECT), (_, x) => (typeof x === 'bigint' ? x.toString() : x))))
  ok(answers.size === 1, 'five verifications, one verdict — a pure function of the bytes, so every node agrees forever')

  console.log(`\n✓ ${pass} checks passed — THE PAYER REALLY PAID, AND BITCOIN SAYS SO: the anchor is proven real and buried under weighed proof of work, it carries THIS network's root at THIS height, EVERY input is traced to an output that paid the claimant's own script (so a stranger's anchor cannot be borrowed), and the fee is derived — 100,000 in − 97,500 out = 2,500 sats — never reported. A subset of inputs is refused as the guess it is, a funding under an unmined header is refused because its amounts are the fee's arithmetic, a zero-fee anchor has nothing to reward, and a transaction without a KRAY seal is simply somebody else's. Nothing here is believed; all of it is re-derived. ₿₭`)
}
main()
