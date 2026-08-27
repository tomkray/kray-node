/**
 * THE PAYER REALLY PAID — proven from Bitcoin's bytes, not attested.
 *
 * A citizen signs a standing offer of satoshis and a fair draw names them the one
 * who pays for a seal. Everything after that used to be bookkeeping: this node's
 * own wallet broadcast the anchor, and the volunteer was CREDITED with a payment
 * they never made. Nothing leaked, because no KRAY was credited either — the two
 * legs were unattached symmetrically. But a reward may only ever be attached to a
 * payment that can be PROVEN, or the reward is free money the moment somebody
 * wires it up.
 *
 * So the payer broadcasts the anchor themselves, from their own keys, and then
 * proves all of it from Bitcoin:
 *
 *   1 · the anchor transaction is real and buried    (sha256d → merkle → headers,
 *                                                     every header weighed by PoW)
 *   2 · it carries THIS network's commitment          (KRAY.NETWORK OP_RETURN with
 *                                                     the exact root and height)
 *   3 · EVERY input was funded by an output paying     (each funding transaction
 *       the payer's own address                        proven the same way, and its
 *                                                      prevout script matched by
 *                                                      SCRIPT, never by claim)
 *   4 · the fee is Σ inputs − Σ outputs                arithmetic on proven numbers
 *
 * Step 3 is the one that makes this a payment rather than a story. Matching by
 * script means a payer cannot borrow a stranger's transaction: to claim the fee
 * they must show that the coins spent came from outputs that paid THEM. And step 4
 * needs every input, not one — a fee computed from a subset is not a fee, it is a
 * guess, so a bundle missing any input is refused rather than estimated.
 *
 * What this deliberately does NOT do: decide what the reward is or where it comes
 * from. Conservation is not negotiable — ₭ is emitted − burned — so a reward can only ever be
 * moved from somewhere that already holds it, never minted. That choice belongs to
 * the network's economics; this file only settles whether a payment happened, and
 * for exactly how much.
 *
 * Pure and total: no I/O, no clock, no network, integers only.
 */
import { createHash } from 'node:crypto'
import { checkProofOfWork, extractKraySeal, parseHeader, parseTx, verifyTxOutProof, type SealProof } from '../anchor/spv.ts'
import { scriptOfAddress, type BtcNet } from '../protocol/scheme.ts'

/** One transaction, proven to be in Bitcoin: the bytes plus its merkle path. */
export interface ProvenFunding { rawTx: string; txoutproof: string }

export interface AnchorPaymentProof extends SealProof {
  /** the funding transaction behind EVERY input of the anchor — each proven in
   *  the same block-chained way, so its outputs' scripts and amounts are facts */
  fundings: ProvenFunding[]
}

export interface PaymentVerdict {
  ok: boolean
  reason?: string
  /** the anchor transaction's id, recomputed from its own bytes */
  txid?: string
  /** what the payer actually spent in fees, to the satoshi */
  feeSats?: bigint
  /** Σ of the inputs proven to belong to the payer */
  fundedSats?: bigint
  /** the KRAY height and root the anchor committed to */
  sealedBlockNumber?: number
  sealedCascadeRoot?: string
}

/** The canonical hash of a payment bundle, so a journal can name the bytes an
 *  auditor must be handed without carrying them inline. */
export function paymentBundleHash(proof: AnchorPaymentProof): string {
  const canonical = JSON.stringify({
    rawTx: proof.rawTx, txoutproof: proof.txoutproof, headers: proof.headers,
    fundings: proof.fundings.map((f) => ({ rawTx: f.rawTx, txoutproof: f.txoutproof })),
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/**
 * DID THIS ADDRESS PAY FOR THIS SEAL? Every answer comes from bytes the caller
 * supplied and the verifier re-derived; nothing is taken on trust, and every
 * refusal names itself so a payer can see exactly what their bundle lacks.
 */
export function verifyAnchorPayment(
  payer: string,
  proof: AnchorPaymentProof,
  expect: { cascadeRoot: string; blockNumber: number; minConfirmations: number; net: BtcNet; chainNet?: string },
): PaymentVerdict {
  try {
    if (!proof || typeof proof.rawTx !== 'string' || !Array.isArray(proof.headers) || !Array.isArray(proof.fundings)) {
      return { ok: false, reason: 'a payment proof needs the anchor transaction, its headers and its fundings' }
    }
    // ── 1 · THE ANCHOR IS REAL, AND BURIED UNDER WORK ─────────────────────
    if (!proof.headers.length) return { ok: false, reason: 'no headers in the proof' }
    const chainNet = expect.chainNet ?? 'main'
    for (let i = 0; i < proof.headers.length; i++) {
      const pow = checkProofOfWork(proof.headers[i], chainNet)
      if (!pow.ok) return { ok: false, reason: `header ${i}: ${pow.reason}` }
    }
    const headers = proof.headers.map((h) => parseHeader(Buffer.from(h, 'hex')))
    for (let i = 1; i < headers.length; i++) {
      if (headers[i].prevDisplay !== headers[i - 1].hashDisplay) return { ok: false, reason: `header ${i} does not chain to header ${i - 1}` }
    }
    if (headers.length < expect.minConfirmations) {
      return { ok: false, reason: `the anchor shows only ${headers.length} confirmation(s), the law needs ${expect.minConfirmations}` }
    }
    const anchor = parseTx(proof.rawTx)
    const inclusion = verifyTxOutProof(proof.txoutproof)
    if (inclusion.header.hashDisplay !== headers[0].hashDisplay) return { ok: false, reason: 'the merkle proof belongs to a different block than header[0]' }
    if (!inclusion.provenTxids.includes(anchor.txidDisplay)) return { ok: false, reason: 'the merkle proof does not prove the anchor transaction' }

    // ── 2 · IT COMMITS TO THIS NETWORK'S HISTORY ──────────────────────────
    const seal = extractKraySeal(proof.rawTx)
    if (!seal) return { ok: false, reason: 'the transaction carries no KRAY.NETWORK seal — this is somebody else\'s transaction' }
    if (seal.cascadeRoot !== expect.cascadeRoot.toLowerCase()) return { ok: false, reason: `the anchor sealed root ${seal.cascadeRoot.slice(0, 12)}…, not the expected ${expect.cascadeRoot.slice(0, 12)}…` }
    if (seal.blockNumber !== expect.blockNumber) return { ok: false, reason: `the anchor sealed KRAY #${seal.blockNumber}, not the expected #${expect.blockNumber}` }

    // ── 3 · EVERY INPUT CAME FROM AN OUTPUT THAT PAID THE PAYER ───────────
    // Matched by SCRIPT, derived from the address here — never by anything the
    // claimant says about it. This is what makes borrowing a stranger's
    // transaction impossible: the coins have to have been theirs.
    let payerScript: string
    try { payerScript = scriptOfAddress(payer, expect.net).toLowerCase() } catch (_) {
      return { ok: false, reason: 'the payer address does not decode on this network' }
    }
    const funded = new Map<string, { script: string; value: bigint }>()
    for (const f of proof.fundings) {
      const ftx = parseTx(f.rawTx)
      const fInc = verifyTxOutProof(f.txoutproof)
      // A FUNDING'S BLOCK MUST HAVE COST WORK TOO. Its amounts are the numbers
      // the fee is computed from, so a header nobody mined would let a payer
      // invent the value of their own coins. A funding normally sits in an
      // EARLIER block than the anchor, so it carries its own header and that
      // header is weighed here on its own merits.
      const pow = checkProofOfWork(fInc.headerHex, chainNet)
      if (!pow.ok) return { ok: false, reason: `the funding ${ftx.txidDisplay.slice(0, 12)}… is buried under a header that proves no work: ${pow.reason}` }
      if (!fInc.provenTxids.includes(ftx.txidDisplay)) return { ok: false, reason: `the merkle proof does not prove funding ${ftx.txidDisplay.slice(0, 12)}…` }
      for (let v = 0; v < ftx.outputScripts.length; v++) {
        funded.set(`${ftx.txidDisplay}:${v}`, { script: ftx.outputScripts[v].toString('hex').toLowerCase(), value: ftx.outputValues[v] })
      }
    }
    let fundedSats = 0n
    for (const inp of anchor.inputs) {
      const key = `${inp.txid}:${inp.vout}`
      const prev = funded.get(key)
      // A FEE FROM A SUBSET IS NOT A FEE. Every input must be present, or the
      // arithmetic below would be a guess dressed as a proof.
      if (!prev) return { ok: false, reason: `input ${key.slice(0, 20)}… has no proven funding transaction — a fee computed from part of the inputs is a guess, not a payment` }
      if (prev.script !== payerScript) {
        return { ok: false, reason: `input ${key.slice(0, 20)}… was funded by an output that did not pay ${payer.slice(0, 16)}… — the coins spent must have been the payer's own` }
      }
      fundedSats += prev.value
    }
    if (anchor.inputs.length === 0) return { ok: false, reason: 'a transaction with no inputs pays nothing' }

    // ── 4 · THE FEE, FROM PROVEN NUMBERS ONLY ─────────────────────────────
    let spent = 0n
    for (const v of anchor.outputValues) spent += v
    if (spent > fundedSats) return { ok: false, reason: 'the outputs exceed the proven inputs — these bytes are not a valid transaction' }
    const feeSats = fundedSats - spent
    if (feeSats <= 0n) return { ok: false, reason: 'the anchor paid no fee at all, so there is nothing to be rewarded for' }

    return {
      ok: true, txid: anchor.txidDisplay, feeSats, fundedSats,
      sealedBlockNumber: seal.blockNumber, sealedCascadeRoot: seal.cascadeRoot,
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'malformed payment proof' }
  }
}
