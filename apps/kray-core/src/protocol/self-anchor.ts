/**
 * SELF-ANCHORING DONATIONS — Phase 3, lever 1: dissolve the custodial anchor pot.
 *
 * THE PROBLEM IT REMOVES. Today a donation pays sats to a pooled address whose key the node operator holds, and
 * the node later spends those sats to fund a SEPARATE Bitcoin OP_RETURN anchor. Two custodial facts follow: the
 * pool is a hot wallet somebody controls, and anchoring depends on that somebody paying a fee. Neither is trustless.
 *
 * THE IDEA. Commit the anchor payload INTO the very output the donor already pays — pay-to-contract, BIP-341
 * style. The donation output is a bona-fide taproot key-path output whose internal key is the network's published
 * pot key P, tweaked by the anchor commitment c(payload). On-chain it is indistinguishable from any ordinary
 * taproot payment (maximum stealth, zero extra bytes, no OP_RETURN), yet ANYONE who knows P and the claimed
 * (blockNumber, root) can recompute the output key and PROVE that this donation sealed exactly that root. So:
 *
 *   · each donation IS an anchor — anchoring rides the sats the user already sacrifices, and costs nothing extra
 *   · there is no anchor-fee pot to drain, so the "does the operator keep paying?" dependency disappears
 *   · the sats still land at a key the pot holder can sweep (the reserve's custody is a SEPARATE concern → federation)
 *
 * THE CONSTRUCTION (all `verified` against @scure/btc-signer's own taproot tweak in self-anchor.test.ts):
 *
 *   c  = taggedHash("kray-core.self-anchor.v1", payload)           // 32-byte commitment, the taproot "merkle root" slot
 *   t  = int(taggedHash("TapTweak", P_xonly ‖ c)) mod n            // BIP-341 tweak, byte-for-byte the standard one
 *   Q  = lift_x(P) + t·G                                            // the committed output key
 *   output = P2TR(x(Q))                                            // a normal-looking witness-v1 output
 *
 * VERIFY: recompute Q from (P, payload); the on-chain output key must equal x(Q). SPEND: the holder of P's secret
 * d signs key-path with (d_even + t) mod n — schnorr handles the final parity, so no funds are ever stranded.
 *
 * Pure, offline, deterministic. It builds and verifies commitments; it never touches a wallet, a key store, or the
 * network. Nothing here is wired into the live anchor path — it is the proven primitive Phase 3 will activate behind
 * a flag, so the current pot/anchor flow keeps working untouched until this has earned its place adversarially.
 */
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'

const Point = secp256k1.Point
const N: bigint = Point.Fn.ORDER

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const b2h = (b: Uint8Array): string => Buffer.from(b).toString('hex')
const h2b = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'))
const isHex = (h: string, bytes?: number): boolean => /^[0-9a-f]*$/i.test(h) && h.length % 2 === 0 && (bytes == null || h.length === bytes * 2)
function cat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(len)
  let i = 0
  for (const p of parts) { out.set(p, i); i += p.length }
  return out
}
/** BIP-340 tagged hash: sha256(sha256(tag) ‖ sha256(tag) ‖ msg). */
function taggedHash(tag: string, msg: Uint8Array): Uint8Array {
  const t = sha256(enc(tag))
  return sha256(cat(t, t, msg))
}
const bytesToBig = (b: Uint8Array): bigint => { const h = b2h(b); return h ? BigInt('0x' + h) : 0n }

/** bech32m for witness v1 — kept local so this primitive has no address-scheme coupling. */
const HRP: Record<string, string> = { main: 'bc', mainnet: 'bc', testnet: 'tb', signet: 'tb', regtest: 'bcrt' }
/** Encode a 32-byte taproot output key as its witness-v1 Bech32m address (exported so the test can prove it
 *  equals @scure/btc-signer's own p2tr address for the same key). */
export function addressFromOutputKey(outputKeyHex: string, net: string): string {
  const hrp = HRP[net]
  if (!hrp) throw new Error(`self-anchor: unknown network '${net}'`)
  if (!isHex(outputKeyHex, 32)) throw new Error('self-anchor: output key must be 32-byte hex')
  // words = [witnessVersion=1, ...convert8to5(program)] — Bech32m, per BIP-350
  const words = [1, ...convertBits(h2b(outputKeyHex), 8, 5, true)]
  return bech32mEncode(hrp, words)
}

/** The 32-byte commitment to an anchor payload — the value carried in the taproot merkle-root slot. */
export function anchorCommitment(payloadHex: string): string {
  if (!isHex(payloadHex) || payloadHex.length === 0) throw new Error('self-anchor: payload must be non-empty hex')
  return b2h(taggedHash('kray-core.self-anchor.v1', h2b(payloadHex)))
}

/**
 * The BIP-341 tweak of an x-only internal key by a 32-byte merkle root (empty → a standard single-key taproot).
 * Exposed so the test can prove it equals @scure/btc-signer's own p2tr tweak for the empty-root case.
 */
export function tweakKey(internalXOnlyHex: string, merkleRootHex: string): { outputKeyHex: string; parity: 0 | 1 } {
  if (!isHex(internalXOnlyHex, 32)) throw new Error('self-anchor: internal key must be 32-byte x-only hex')
  if (merkleRootHex !== '' && !isHex(merkleRootHex, 32)) throw new Error('self-anchor: merkle root must be empty or 32-byte hex')
  const Px = h2b(internalXOnlyHex)
  const rootBytes = merkleRootHex === '' ? new Uint8Array(0) : h2b(merkleRootHex)
  const t = bytesToBig(taggedHash('TapTweak', cat(Px, rootBytes))) % N
  if (t === 0n) throw new Error('self-anchor: degenerate tweak (t=0)')   // ~2^-256; never in practice
  const P = Point.fromHex('02' + internalXOnlyHex.toLowerCase())          // lift x-only to the even-Y point (BIP-340)
  const Q = P.add(Point.BASE.multiply(t))
  return { outputKeyHex: b2h(Q.toBytes(true).slice(1)), parity: Q.hasEvenY() ? 0 : 1 }
}

/** The taproot output key that COMMITS this anchor payload under the pot's internal key. */
export function commitAnchorKey(internalXOnlyHex: string, payloadHex: string): { outputKeyHex: string; parity: 0 | 1 } {
  return tweakKey(internalXOnlyHex, anchorCommitment(payloadHex))
}

/** The P2TR address a self-anchoring donation pays — a normal-looking taproot address that seals the payload. */
export function selfAnchorAddress(internalXOnlyHex: string, payloadHex: string, net: string): string {
  return addressFromOutputKey(commitAnchorKey(internalXOnlyHex, payloadHex).outputKeyHex, net)
}

/** The witness-v1 scriptPubKey (`OP_1 PUSH32 <output key>` = `5120…`) a self-anchoring donation pays — what the
 *  node checks the on-chain output against (the same shape verifyDonationProof already compares a pot script by). */
export function selfAnchorScriptHex(internalXOnlyHex: string, payloadHex: string): string {
  return '5120' + commitAnchorKey(internalXOnlyHex, payloadHex).outputKeyHex
}

/**
 * THE KEYLESS BURN — the answer to "and this key stays with nobody?". This is the BIP-341 Nothing-Up-My-Sleeve
 * point H = lift_x(0x50929b74…803ac0): a real curve point whose discrete log is UNKNOWN and, by construction,
 * unknowable (it is a hash of the generator, not `k·G` for any k anyone chose). Tweaking it by an anchor payload
 * gives an output that STILL commits the root (auditable by anyone) but has NO spendable key: to spend it you would
 * need H's discrete log, which does not exist for anyone. So a donation to a BURN self-anchor address is (1) a
 * proof-of-sacrifice — the sats are gone forever, provably, the purest backing there is; and (2) an anchor — the
 * root rides the very same transaction, for free. No pot, no federation, no key. Nobody pays, nobody holds.
 */
export const BURN_INTERNAL_KEY = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0'

/** THE AUTHORLESS-KEY PROOF, self-contained: recompute SHA256(uncompressed G) from Bitcoin's own generator and
 *  compare it to the burn key. Returns every intermediate so a verifier can PRINT the chain — no trust, no
 *  hardcoding on the caller's side. `matches === true` ⟺ the burn key is a hash of G, chosen by nobody. */
export function numsAuthorlessProof(): { gxHex: string; gyHex: string; uncompressedGHex: string; sha256OfG: string; burnKey: string; matches: boolean } {
  const G = Point.BASE
  const gxHex = G.x.toString(16).padStart(64, '0')
  const gyHex = G.y.toString(16).padStart(64, '0')
  const uncompressedGHex = '04' + gxHex + gyHex
  const sha256OfG = b2h(sha256(h2b(uncompressedGHex)))
  return { gxHex, gyHex, uncompressedGHex, sha256OfG, burnKey: BURN_INTERNAL_KEY, matches: sha256OfG === BURN_INTERNAL_KEY }
}

/** The scriptPubKey of a KEYLESS BURN self-anchor — commits the payload under the NUMS point (unspendable). */
export function selfAnchorBurnScriptHex(payloadHex: string): string {
  return selfAnchorScriptHex(BURN_INTERNAL_KEY, payloadHex)
}
/** The address of a KEYLESS BURN self-anchor — a normal taproot address nobody can ever spend from. */
export function selfAnchorBurnAddress(payloadHex: string, net: string): string {
  return selfAnchorAddress(BURN_INTERNAL_KEY, payloadHex, net)
}

/**
 * PROVE an on-chain output anchors this payload: recompute the committed key from (P, payload) and compare.
 * This is the whole auditor's check — no Bitcoin node, no trust, just the same tweak anyone can redo.
 */
export function verifySelfAnchor(outputKeyHex: string, internalXOnlyHex: string, payloadHex: string): boolean {
  if (!isHex(outputKeyHex, 32)) return false
  try { return commitAnchorKey(internalXOnlyHex, payloadHex).outputKeyHex === outputKeyHex.toLowerCase() }
  catch { return false }
}

/**
 * The private key that spends a self-anchoring output — (d_even + t) mod n, so the pot holder can always sweep the
 * reserve. schnorr.getPublicKey of this equals the output key, and schnorr.sign with it validates against it.
 */
export function tweakedSpendSecret(internalSecretHex: string, payloadHex: string): string {
  if (!isHex(internalSecretHex, 32)) throw new Error('self-anchor: secret must be 32-byte hex')
  const d0 = bytesToBig(h2b(internalSecretHex)) % N
  if (d0 === 0n) throw new Error('self-anchor: secret out of range')
  const dEven = Point.BASE.multiply(d0).hasEvenY() ? d0 : N - d0     // BIP-340 even-Y representative
  const Px = schnorr.getPublicKey(h2b(internalSecretHex))            // x-only internal (already even-Y)
  const c = h2b(anchorCommitment(payloadHex))
  const t = bytesToBig(taggedHash('TapTweak', cat(Px, c))) % N
  const dTweaked = (dEven + t) % N
  if (dTweaked === 0n) throw new Error('self-anchor: degenerate spend key')
  return dTweaked.toString(16).padStart(64, '0')
}

// ── minimal, self-contained Bech32m (BIP-173/350) — no external base coupling ──
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const top = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]
  }
  return chk
}
function hrpExpand(hrp: string): number[] {
  const out: number[] = []
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5)
  out.push(0)
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31)
  return out
}
function convertBits(data: Uint8Array, from: number, to: number, pad: boolean): number[] {
  let acc = 0, bits = 0
  const out: number[] = []
  const maxv = (1 << to) - 1
  for (const value of data) {
    acc = (acc << from) | value
    bits += from
    while (bits >= to) { bits -= to; out.push((acc >>> bits) & maxv) }
  }
  if (pad) { if (bits > 0) out.push((acc << (to - bits)) & maxv) }
  return out
}
function bech32mEncode(hrp: string, data: number[]): string {
  const BECH32M_CONST = 0x2bc830a3
  const values = [...hrpExpand(hrp), ...data]
  const mod = polymod([...values, 0, 0, 0, 0, 0, 0]) ^ BECH32M_CONST
  const checksum: number[] = []
  for (let i = 0; i < 6; i++) checksum.push((mod >>> (5 * (5 - i))) & 31)
  let out = hrp + '1'
  for (const d of [...data, ...checksum]) out += CHARSET[d]
  return out
}
