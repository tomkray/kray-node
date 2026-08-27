/**
 * ML-DSA (FIPS-204, "Dilithium") — the NIST-standardized, MANY-TIME post-quantum signature.
 *
 * This is the everyday quantum-safe signing scheme: unlike the one-time Lamport escape hatch, an ML-DSA key
 * signs an unbounded number of transactions. It is a lattice scheme, so we do NOT hand-roll it — we use the
 * audited `@noble/post-quantum` implementation, the post-quantum sibling of the very `@noble/curves` that
 * already provides KRAY's secp256k1/Schnorr. We wrap only the KRAY-specific parts: the address binding and the
 * hex (de)serialization, so `ml-dsa` plugs into the existing `verifySignature` scheme dispatch as one more case.
 *
 * ML-DSA-44 (the NIST Level-2 parameter set): public key 1312 bytes, signature ~2420 bytes. Larger than a
 * 64-byte Schnorr signature — the honest price of post-quantum security — but ordinary for a journal event.
 */
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js'
import { createHash } from 'node:crypto'
import type { BtcNet } from './scheme.ts'

const sha256hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
const hexToBytes = (h: string): Uint8Array => { if (!/^[0-9a-f]*$/i.test(h) || h.length % 2) throw new Error('mldsa: bad hex'); const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return u }
const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** deterministic keygen from a 32-byte seed — a wallet re-derives it, never stores 3.9 KB. */
export function mldsaKeygen(seed: Uint8Array): { publicKeyHex: string; secretKey: Uint8Array } {
  const kp = ml_dsa44.keygen(seed.length === 32 ? seed : createHash('sha256').update(seed).digest())
  return { publicKeyHex: bytesToHex(kp.publicKey), secretKey: kp.secretKey }
}

/** sign a UTF-8 message with an ML-DSA secret key → signature hex. */
export function mldsaSign(message: string, secretKey: Uint8Array): string {
  return bytesToHex(ml_dsa44.sign(new TextEncoder().encode(message), secretKey))
}

/** THE KRAY ADDRESS of an ML-DSA account: a distinct hash-committed identity, `kq1` + SHA-256(public key). It
 *  is not a taproot address (an ML-DSA key is 1312 bytes, not a 32-byte x-only point), so it gets its own,
 *  unmistakable prefix. The public key is revealed only when the account signs — until then only its hash is
 *  ever on chain, which is itself quantum-safe. */
export function mldsaAddress(publicKeyHex: string): string {
  return 'kq1' + sha256hex(hexToBytes(publicKeyHex))
}
export function isMldsaAddress(addr: string): boolean {
  return /^kq1[0-9a-f]{64}$/.test(String(addr))
}

/** Verify an ML-DSA signature the KRAY way: the address MUST be `kq1 + SHA-256(publicKey)` (anti-spoof binding,
 *  exactly like taproot re-derivation for kraywallet), then the lattice signature must verify over the message.
 *  Fail-closed on every malformed input — never throws. `net` is accepted for a uniform scheme signature; the
 *  network is bound by the signed message, as with kraywallet. */
export function verifyMldsa(address: string, message: string, signatureHex: string, publicKeyHex: string | undefined, _net: BtcNet): boolean {
  try {
    if (!publicKeyHex || !isMldsaAddress(address)) return false
    if (mldsaAddress(publicKeyHex) !== address) return false // the key must re-derive to exactly this address
    return ml_dsa44.verify(hexToBytes(signatureHex), new TextEncoder().encode(message), hexToBytes(publicKeyHex))
  } catch {
    return false
  }
}
