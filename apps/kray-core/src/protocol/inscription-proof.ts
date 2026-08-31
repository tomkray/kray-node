/**
 * INSCRIPTION PROOF — an L1 inscription's EXISTENCE and CONTENT, proven from bytes.
 *
 * The rune bridge proves a balance by walking ancestry; an inscription needs no
 * ancestry — the reveal transaction IS the inscription. So this proves less and
 * proves it directly: the reveal tx is real and buried in Bitcoin to the required
 * depth (every header weighed by proof-of-work, exactly as the seal and rune
 * paths are), and its witness decodes to the claimed inscription id and content.
 *
 * ── WHAT IT PROVES, AND WHAT IT HONESTLY DOES NOT ───────────────────────────
 * PROVEN, from bytes, no indexer, no trust:
 *   · the reveal transaction is real and buried ≥ minConfirmations
 *   · every burying header cost the work this network's headers cost
 *   · the envelope at index N decodes to this content-type and this content
 *   · therefore inscriptionId = <reveal_txid>iN and contentHash = sha256(content)
 *
 * ALSO EXPOSED (for eternize, not for current custody): `paidScriptHex` —
 * the reveal output that received the inscribed sat at birth. Who holds
 * the sat *now* is still not proven here (see docs/ORIGIN.md).
 *
 * Fail-closed: a missing tx, an unproven one, a shallow burial, a header nobody
 * paid for, or an envelope that is not there — all refuse and say which. Reuses
 * ProvenTx + bundleHash from the rune path so the off-chain proof oracle is one
 * mechanism, not two.
 */
import { MIN_BLOCK_WORK, checkProofOfWork, parseHeader, parseTx, verifyTxOutProof } from '../anchor/spv.ts'
import { inscriptionAtLoose, pointerSatOf, satpointInOutputs } from './inscription.ts'
import type { ProvenTx } from './rune-ancestry.ts'

export type InscriptionRefusal =
  | 'tx-missing' | 'tx-malformed' | 'tx-unproven' | 'tx-shallow' | 'txid-mismatch' | 'no-inscription'

export interface InscriptionVerdict {
  ok: boolean
  reason?: InscriptionRefusal
  /** `<reveal_txid>iN`, when proven */
  inscriptionId?: string
  contentType?: string
  contentHash?: string
  size?: number
  /** the raw content bytes, for a caller that stores them for custody */
  content?: Buffer
  /** how many blocks the proof shows burying the reveal */
  confirmations?: number
  /** scriptPubKey hex of the reveal output that received the inscription sat */
  paidScriptHex?: string
}

export interface InscriptionProofOptions {
  /** how deep Bitcoin must have buried the reveal (same depth as a rune deposit) */
  minConfirmations: number
  /** which Bitcoin this claims to come from — the work floor depends on it */
  net?: string
}

/**
 * PROVE THE INSCRIPTION at `<revealTxid>i<index>` from `bundle`. The bundle
 * carries the reveal transaction (and only it is needed) as a ProvenTx: its raw
 * bytes, its BIP-37 merkle proof, and the headers that bury it.
 */
export function proveInscription(
  revealTxid: string,
  index: number,
  bundle: ProvenTx[],
  opts: InscriptionProofOptions,
): InscriptionVerdict {
  const net = opts.net ?? 'main'
  // find the reveal transaction in the bundle, by its own txid — never by position
  const entry = bundle
    .map((t) => ({ t, p: (() => { try { return parseTx(t.rawTx) } catch (_) { return null } })() }))
    .find((x) => x.p?.txidDisplay === revealTxid)
  if (!entry || !entry.p) return { ok: false, reason: 'tx-missing' }
  const tx = entry.t

  // 1 · the reveal is exactly these bytes, and Bitcoin buried it
  let proof: ReturnType<typeof verifyTxOutProof>
  try { proof = verifyTxOutProof(tx.txoutproof) } catch (_) { return { ok: false, reason: 'tx-unproven' } }
  if (!proof.provenTxids.includes(revealTxid)) return { ok: false, reason: 'txid-mismatch' }
  if (!tx.headers.length) return { ok: false, reason: 'tx-unproven' }
  // header[0] is the block the merkle proof belongs to; each header after chains;
  // and EVERY header must have cost the work this network's headers cost — a
  // chained list is free to make, so a burial nobody paid for is not a burial.
  try {
    const hs = tx.headers.map((h) => parseHeader(Buffer.from(h, 'hex')))
    if (hs[0].hashDisplay !== proof.header.hashDisplay) return { ok: false, reason: 'tx-unproven' }
    for (let i = 1; i < hs.length; i++) if (hs[i].prevDisplay !== hs[i - 1].hashDisplay) return { ok: false, reason: 'tx-unproven' }
    let work = 0n
    for (const h of tx.headers) {
      const pow = checkProofOfWork(h, net)
      if (!pow.ok) return { ok: false, reason: 'tx-unproven' }
      work += pow.work
    }
    const floor = BigInt(tx.headers.length) * (MIN_BLOCK_WORK[net] ?? MIN_BLOCK_WORK.main)
    if (work < floor) return { ok: false, reason: 'tx-unproven' }
  } catch (_) { return { ok: false, reason: 'tx-unproven' } }
  if (tx.headers.length < opts.minConfirmations) return { ok: false, reason: 'tx-shallow' }

  // 2 · the envelope at the claimed index — decoded from the reveal's own witness
  let decoded
  try { decoded = inscriptionAtLoose(tx.rawTx, index) } catch (_) { return { ok: false, reason: 'tx-malformed' } }
  if (!decoded) return { ok: false, reason: 'no-inscription' }

  // WHICH OUTPUT received the inscribed sat at birth (pointer, or sat 0).
  // Eternize requires this script to BE the eternizer's — not "whoever owns
  // the star later". A clone paid to another key cannot bind.
  const abs = pointerSatOf(decoded.tags) ?? 0n
  const land = satpointInOutputs(entry.p.outputValues, abs)
  if (!land) return { ok: false, reason: 'no-inscription' }
  const paidScriptHex = entry.p.outputScripts[land.vout].toString('hex')

  return {
    ok: true,
    inscriptionId: decoded.id,
    contentType: decoded.contentType,
    contentHash: decoded.contentHash,
    size: decoded.size,
    content: decoded.content,
    confirmations: tx.headers.length,
    paidScriptHex,
  }
}
