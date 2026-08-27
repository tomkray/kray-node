/**
 * AVAILABILITY WITNESS (ADR-3 · the trustless half of 3d) — proof that a signed act was PUBLIC by its deadline,
 * resting on nothing but Bitcoin. This is the honest dependency 3d's verdict names: without it, "the writer
 * left my act out" cannot be told apart from "I never sent it." The Creator's ruling (Route B): the witness is
 * NOT a federation of mirrors that could collude — it is JUST ANOTHER BITCOIN ANCHOR, the citizen's own.
 *
 * THE SHAPE. A citizen who fears censorship commits a Merkle root of the act keys they want protected into a
 * Bitcoin OP_RETURN and lets it bury. Then "act X was public by height H" is: a tx carrying availabilityPayload
 * (KRAY.AVAILABLE + root) is buried under real work in a block whose BIP-34 coinbase height is H, and X's key is
 * a member of that root. Every input is re-derived from raw bytes — the tx, the merkle path, the header work,
 * the coinbase height (BIP-34), the membership path — so no party is trusted. It composes with the rest:
 *   C   gives the SIGNED deadline D;   this gives availableBySeal = H (H ≤ D ⇒ inclusion was owed and possible);
 *   3a  gives the absence proof;        3d-a gives the anchored inclusion root at a seal ≥ D.
 * verifyCensorship then returns CENSORED with no trusted party anywhere.
 *
 * OPT-IN + BATCHED (the honest price): most acts trust the writer via the cheap 3b inbox; only an act that
 * fears omission pays a Bitcoin fee to anchor its availability, and one root batches many act keys (one tx,
 * one membership proof per act). The writer, which already watches Bitcoin for seals, is obliged to include an
 * act published on Bitcoin before its deadline — so it either includes you or is provably caught.
 *
 * The availability ROOT is an inclusion tree of the act keys (3a's SMT reused), so membership AND non-membership
 * are the same proofs 3a/3d already speak. Pure; wired into no live path — the value 3d's availableBySeal reads.
 */
import { inclusionRoot, proveKey, verifyProof, type MerkleProof } from './inclusion-tree.ts'
import { parseTx } from '../anchor/spv.ts'
import { provenBlockHeight, type BlockHeightProof } from './bitcoin-height.ts'

const AVAIL_TAG = 'KRAY.AVAILABLE'                                  // 14 ascii bytes — distinct from the seal's KRAY.NETWORK
const AVAIL_TAG_HEX = Buffer.from(AVAIL_TAG, 'ascii').toString('hex')
const AVAIL_VERSION = '01'
const HEX32 = /^[0-9a-f]{64}$/
const PAYLOAD_LEN = AVAIL_TAG.length + 1 + 32                       // tag(14) + version(1) + root(32) = 47 bytes

/** The Merkle root a citizen commits on Bitcoin — a set commitment over the act keys they are anchoring. */
export function availabilityRoot(actKeys: Iterable<string>): string {
  return inclusionRoot(actKeys)
}
/** Membership / non-membership of an act key in an availability root — 3a's proofs, reused verbatim. */
export function proveAvailability(actKeys: Iterable<string>, actKey: string): MerkleProof {
  return proveKey(actKeys, actKey)
}
export function verifyAvailabilityMembership(rootHex: string, actKey: string, proof: MerkleProof): boolean {
  return verifyProof(rootHex, actKey, proof) === 'in'
}

/** The OP_RETURN payload (no script prefix): KRAY.AVAILABLE + version + the 32-byte availability root. */
export function availabilityPayload(rootHex: string): string {
  if (!HEX32.test(rootHex.toLowerCase())) throw new Error('availability: root must be 32-byte hex')
  return AVAIL_TAG_HEX + AVAIL_VERSION + rootHex.toLowerCase()
}
/** Read the committed availability root back from a raw transaction's OP_RETURN, or null if it carries none. */
export function extractAvailabilityRoot(rawTxHex: string): string | null {
  for (const script of parseTx(rawTxHex).outputScripts) {
    // OP_RETURN (0x6a) + push PAYLOAD_LEN + payload
    if (script.length !== PAYLOAD_LEN + 2 || script[0] !== 0x6a || script[1] !== PAYLOAD_LEN) continue
    const payload = script.subarray(2)
    if (payload.subarray(0, AVAIL_TAG.length).toString('ascii') !== AVAIL_TAG || payload[AVAIL_TAG.length] !== 0x01) continue
    return payload.subarray(AVAIL_TAG.length + 1, AVAIL_TAG.length + 33).toString('hex')
  }
  return null
}

export interface AvailabilityProof extends BlockHeightProof {
  // rawTx (here: the citizen's tx carrying the KRAY.AVAILABLE OP_RETURN) + txoutproof + headers + coinbaseTx +
  // coinbaseTxOutProof come from BlockHeightProof — the same bytes that prove the block's height.
  membership: MerkleProof       // proof that `actKey` is a member of the committed availability root
}
export type AvailabilityVerdict =
  | { ok: true; availableAtHeight: number; root: string }
  | { ok: false; reason: string }

/**
 * The trustless witness: is `actKey` provably public by some Bitcoin height? The block's height is the shared,
 * fail-closed `provenBlockHeight` (burial under work + the BIP-34 coinbase bound to merkle index 0); then the
 * tx must commit an availability root and `actKey` must be a member of it. Returns the absolute height H; 3d
 * checks H ≤ the signed deadline. Every byte re-derived — no party trusted.
 */
export function verifyAvailability(
  actKey: string,
  proof: AvailabilityProof,
  opts: { net: string; minConfirmations: number; minWork?: bigint },
): AvailabilityVerdict {
  if (!HEX32.test(String(actKey).toLowerCase())) return { ok: false, reason: 'actKey must be 32-byte hex' }
  const h = provenBlockHeight(proof, opts)   // burial + coinbase-index-0 + BIP-34 height, fail-closed inside
  if (!h.ok) return { ok: false, reason: `availability not proven: ${h.reason}` }
  // the tx (already proven to parse + be buried) commits an availability root, and the act key is a member of it
  const root = extractAvailabilityRoot(proof.rawTx)
  if (!root) return { ok: false, reason: 'the tx carries no KRAY.AVAILABLE commitment' }
  if (!verifyAvailabilityMembership(root, actKey, proof.membership)) return { ok: false, reason: 'the act key is not a member of the committed availability root' }
  return { ok: true, availableAtHeight: h.height, root }
}
