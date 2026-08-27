/**
 * THE TRUSTLESS BITCOIN HEIGHT (ADR-3 · shared) — the absolute block height of the block a transaction is buried
 * in, re-derived from raw bytes and NOTHING else. A Bitcoin header carries no height; the height lives in the
 * block's coinbase scriptSig (BIP-34, since 2012). So the honest way to learn "this tx is at height H" is: prove
 * the tx is buried under real work (proveTxBuried), prove the coinbase is in the SAME block AT MERKLE INDEX 0
 * (only the first tx of a block is its coinbase — any other single-input tx's scriptSig is attacker bytes), and
 * read the BIP-34 height from that coinbase. One primitive, two callers with the same need:
 *   · the availability witness — "the citizen's act root was public by height H" (availability.ts);
 *   · the seal-height re-proof — "the seal the writer journalled with l1Height=H is truly at Bitcoin height H",
 *     so 3d-a's windowCommitment(H, root) binds the REAL height a follower can check, not the writer's word.
 * Fail-closed: the SPV primitives THROW on malformed bytes; every throw becomes a named refusal, never a crash.
 */
import { proveTxBuried, bip34Height, parseTx, verifyTxOutProof } from '../anchor/spv.ts'

export interface BlockHeightProof {
  rawTx: string                 // the transaction whose block height we want, exact bytes, hex
  txoutproof: string            // BIP-37 merkle block proving rawTx's txid is in the block
  headers: string[]             // 80-byte headers: the containing block, then each block of burial on top
  coinbaseTx: string            // the block's coinbase — its BIP-34 scriptSig carries the absolute height
  coinbaseTxOutProof: string    // merkle block proving the coinbase is in the SAME block, at index 0
}
export type BlockHeightVerdict = { ok: true; height: number } | { ok: false; reason: string }

/** The absolute Bitcoin height of the block `proof.rawTx` is buried in — re-derived from bytes, trusting no one. */
export function provenBlockHeight(
  proof: BlockHeightProof,
  opts: { net: string; minConfirmations: number; minWork?: bigint },
): BlockHeightVerdict {
  try {
    const buried = proveTxBuried(proof.rawTx, proof.txoutproof, proof.headers, opts)
    if (!buried.ok) return { ok: false, reason: `tx is not buried: ${buried.reason}` }
    const cbInBlock = verifyTxOutProof(proof.coinbaseTxOutProof)
    if (cbInBlock.header.hashDisplay !== buried.headers[0].hashDisplay) return { ok: false, reason: 'the coinbase proof belongs to a different block than the burial' }
    const cbTxid = parseTx(proof.coinbaseTx).txidDisplay
    if (!cbInBlock.provenTxids.includes(cbTxid)) return { ok: false, reason: 'the coinbase proof does not prove THIS coinbase' }
    // BIP-34 height is a CONSENSUS fact ONLY for the tx at merkle index 0 (the coinbase); any other single-input
    // tx's scriptSig is attacker-chosen. Only leaf 0 can be the coinbase — this is the whole trust of the height.
    if (cbInBlock.positions[cbInBlock.provenTxids.indexOf(cbTxid)] !== 0) return { ok: false, reason: 'the claimed coinbase is not at merkle index 0 — only the FIRST transaction of a block is its coinbase (a forged height is rejected)' }
    const height = bip34Height(proof.coinbaseTx)
    if (height === null) return { ok: false, reason: 'the coinbase carries no readable BIP-34 height' }
    return { ok: true, height }
  } catch (e) {
    return { ok: false, reason: `malformed block-height proof: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/**
 * ADR-3 3d-a · the seal-height re-proof — a follower verifies that a seal it is about to trust with l1Height=H
 * is TRULY at Bitcoin height H, so the writer cannot journal a lied height and shift the "inclusion owed by H"
 * boundary a censorship verdict compares against. (Monotonicity of the height across seals is enforced in the
 * reducer; THIS is the per-seal truth.)
 *
 * INTEGRATION CONTRACT (council): this proves the height of the block `proof.rawTx` is in — the caller MUST pass
 * the SEAL'S OWN transaction as `proof.rawTx` (the one whose sealed root/blockNumber verifySealProof binds), or
 * route both through verifySealProof, else the height could be satisfied by any unrelated tx buried at H. The
 * door/follower wiring closes this binding; the primitive alone does not.
 */
export function verifySealHeight(
  claimedHeight: number,
  proof: BlockHeightProof,
  opts: { net: string; minConfirmations: number; minWork?: bigint },
): { ok: true; height: number } | { ok: false; reason: string } {
  if (!Number.isInteger(claimedHeight) || claimedHeight <= 0) return { ok: false, reason: 'the claimed seal height must be a positive integer' }
  const h = provenBlockHeight(proof, opts)
  if (!h.ok) return h
  if (h.height !== claimedHeight) return { ok: false, reason: `the seal's block is at Bitcoin height ${h.height}, not the journalled l1Height ${claimedHeight} — a lied height is refused` }
  return { ok: true, height: h.height }
}
