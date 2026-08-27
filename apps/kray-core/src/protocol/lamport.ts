/**
 * LAMPORT ONE-TIME SIGNATURES — a REAL, quantum-safe signature, built from SHA-256 alone.
 *
 * Not invented here: this is Leslie Lamport's 1979 hash-based signature, the primitive NIST's SLH-DSA
 * (SPHINCS+, FIPS-205) is built on. Its security reduces to the preimage/2nd-preimage resistance of the hash —
 * which a quantum computer attacks only with Grover (a quadratic speedup, ~128-bit residual on SHA-256). So it
 * is post-quantum by construction, and it introduces NO new cryptographic assumption: KRAY already trusts
 * SHA-256 everywhere (the cascade root, the anchor, the burn). We do not hand-roll lattice math; we use the
 * one post-quantum scheme whose whole definition is "hash things."
 *
 * ONE-TIME: a private key signs exactly ONE message — reusing it leaks the key. This is not a limitation for
 * KRAY's use: it authorizes a RECOVERY / MIGRATION, which happens once. The account commits SHA-256(publicKey)
 * ahead of time (a quantum-safe hash, the `quantum-commit` event); when it must migrate, it reveals the public
 * key and one signature, proving ownership without EVER relying on its exposed ECC key.
 *
 *   keypair  : 256 bit-positions × 2 secrets (0/1 branch), each 32 random bytes → 512 secrets
 *   public   : the 512 hashes  H(secret[i][b])
 *   sign(m)  : h = SHA-256(m); reveal secret[i][ h_bit(i) ] for every bit i  → 256 × 32 bytes
 *   verify   : h = SHA-256(m); require H(sig[i]) == public[i][ h_bit(i) ] for every i
 */
import { createHash, randomBytes } from 'node:crypto'

const H = (b: Buffer): Buffer => createHash('sha256').update(b).digest()
const N = 256 // one branch per bit of the SHA-256 message digest

export interface LamportKeypair { secret: Buffer[][]; publicKey: Buffer[][] }

/** Deterministic keygen from a 32-byte seed (so a wallet can re-derive it), or random when omitted. Each of the
 *  256 bit-positions gets two independent 32-byte secrets, derived by domain-separated hashing of the seed. */
export function lamportKeygen(seed?: Buffer): LamportKeypair {
  const root = seed && seed.length >= 32 ? Buffer.from(seed) : randomBytes(32)
  const secret: Buffer[][] = [], publicKey: Buffer[][] = []
  for (let i = 0; i < N; i++) {
    const s0 = H(Buffer.concat([root, Buffer.from(`lamport|${i}|0`, 'utf8')]))
    const s1 = H(Buffer.concat([root, Buffer.from(`lamport|${i}|1`, 'utf8')]))
    secret.push([s0, s1])
    publicKey.push([H(s0), H(s1)])
  }
  return { secret, publicKey }
}

/** the message's bits, MSB-first per byte — the exact order verify reads. */
function digestBits(message: string | Buffer): number[] {
  const d = H(Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8'))
  const bits: number[] = []
  for (const byte of d) for (let m = 0x80; m > 0; m >>= 1) bits.push(byte & m ? 1 : 0)
  return bits // length 256
}

/** Sign a message ONCE with a Lamport secret key → 256 revealed 32-byte secrets (8192 bytes). */
export function lamportSign(message: string | Buffer, secret: Buffer[][]): Buffer[] {
  const bits = digestBits(message)
  return bits.map((b, i) => secret[i][b])
}

/** Verify a Lamport signature against the public key. Pure hashing; fail-closed on any shape error. */
export function lamportVerify(message: string | Buffer, signature: Buffer[], publicKey: Buffer[][]): boolean {
  try {
    if (!Array.isArray(signature) || signature.length !== N || !Array.isArray(publicKey) || publicKey.length !== N) return false
    const bits = digestBits(message)
    for (let i = 0; i < N; i++) {
      const s = signature[i]
      if (!Buffer.isBuffer(s) || s.length !== 32) return false
      const expect = publicKey[i][bits[i]]
      if (!Buffer.isBuffer(expect) || expect.length !== 32) return false
      if (!H(s).equals(expect)) return false
    }
    return true
  } catch { return false }
}

// ── serialization: a public key / signature is a flat hex string, so it rides a journal event as one field ──
export function lamportPublicKeyHex(publicKey: Buffer[][]): string {
  return publicKey.map((p) => p[0].toString('hex') + p[1].toString('hex')).join('')
}
export function lamportPublicKeyFromHex(hex: string): Buffer[][] {
  if (!/^[0-9a-f]{32768}$/i.test(hex)) throw new Error('lamport: a public key is 256×2×32 = 16384 bytes (32768 hex)')
  const pk: Buffer[][] = []
  for (let i = 0; i < N; i++) pk.push([Buffer.from(hex.slice(i * 128, i * 128 + 64), 'hex'), Buffer.from(hex.slice(i * 128 + 64, i * 128 + 128), 'hex')])
  return pk
}
export function lamportSignatureHex(signature: Buffer[]): string { return signature.map((s) => s.toString('hex')).join('') }
export function lamportSignatureFromHex(hex: string): Buffer[] {
  if (!/^[0-9a-f]{16384}$/i.test(hex)) throw new Error('lamport: a signature is 256×32 = 8192 bytes (16384 hex)')
  const sig: Buffer[] = []
  for (let i = 0; i < N; i++) sig.push(Buffer.from(hex.slice(i * 64, i * 64 + 64), 'hex'))
  return sig
}

/** THE COMMITMENT an account registers ahead of time (quantum-commit): SHA-256 of the Lamport public key.
 *  A hash — quantum-safe — so the account can reveal the key later and prove it matches, with no ECC reliance. */
export function lamportPublicKeyCommit(publicKey: Buffer[][]): string {
  return H(Buffer.from(lamportPublicKeyHex(publicKey), 'utf8')).toString('hex')
}
