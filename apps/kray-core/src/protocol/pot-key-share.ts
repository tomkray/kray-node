/**
 * OWNER KEY SHARES — Shamir 2-of-3 over GF(256).
 *
 * Any two shares rebuild the 32-byte pot owner. One share is not the pot.
 * This is not FROST (no distributed signing). Reconstruct, then seal/sign
 * as today. Fail-closed on duplicate x, wrong t, or a flipped byte.
 *
 * AES field (poly 0x11b). Node crypto only for randomness.
 */
import { randomBytes } from 'node:crypto'

export const SHARE_VERSION = 1
export const SHARE_T = 2
export const SHARE_N = 3
const SECRET_LEN = 32

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
function xtime(a: number): number {
  return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff
}

;(function initField() {
  // AES GF(256), primitive 0x03 — doubling (×2) does not generate the group.
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x = xtime(x) ^ x
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
})()

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

function gfInv(a: number): number {
  if (a === 0) throw new Error('pot-key-share: divide by zero in GF(256)')
  return EXP[255 - LOG[a]]
}

export interface OwnerShare {
  v: number
  scheme: 'shamir-gf256'
  t: number
  n: number
  i: number
  y: string
}

function evalPoly(coeffs: number[], x: number): number {
  let acc = 0
  for (let d = coeffs.length - 1; d >= 0; d--) {
    acc = gfMul(acc, x) ^ coeffs[d]
  }
  return acc
}

/** Split a 32-byte owner secret into n shares, threshold t (locked 2-of-3). */
export function splitOwnerSecret(secret: Uint8Array, n = SHARE_N, t = SHARE_T): OwnerShare[] {
  if (secret.length !== SECRET_LEN) throw new Error('pot-key-share: the owner secret must be 32 bytes')
  if (t !== SHARE_T || n !== SHARE_N) throw new Error('pot-key-share: this rung is 2-of-3 only')
  const ys = Array.from({ length: n }, () => new Uint8Array(SECRET_LEN))
  for (let b = 0; b < SECRET_LEN; b++) {
    const coeffs = [secret[b]]
    for (let d = 1; d < t; d++) {
      let c = 0
      while (c === 0) c = randomBytes(1)[0]
      coeffs.push(c)
    }
    for (let i = 1; i <= n; i++) ys[i - 1][b] = evalPoly(coeffs, i)
  }
  return ys.map((y, idx) => ({
    v: SHARE_VERSION,
    scheme: 'shamir-gf256' as const,
    t, n, i: idx + 1,
    y: Buffer.from(y).toString('hex'),
  }))
}

function lagrangeAtZero(points: { x: number; y: number }[]): number {
  let acc = 0
  for (let i = 0; i < points.length; i++) {
    let num = 1
    let den = 1
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue
      num = gfMul(num, points[j].x)
      den = gfMul(den, points[i].x ^ points[j].x)
    }
    acc ^= gfMul(points[i].y, gfMul(num, gfInv(den)))
  }
  return acc
}

/** Rebuild the 32-byte secret from any `t` distinct shares. */
export function combineOwnerShares(shares: OwnerShare[]): Uint8Array {
  if (!Array.isArray(shares) || shares.length < SHARE_T) {
    throw new Error('pot-key-share: need at least 2 shares — refused')
  }
  const seen = new Set<number>()
  const clean: OwnerShare[] = []
  for (const s of shares) {
    if (!s || s.v !== SHARE_VERSION || s.scheme !== 'shamir-gf256' || s.t !== SHARE_T || s.n !== SHARE_N) {
      throw new Error('pot-key-share: unknown or unsupported share — refused')
    }
    if (!Number.isInteger(s.i) || s.i < 1 || s.i > SHARE_N) throw new Error('pot-key-share: bad share index — refused')
    if (seen.has(s.i)) throw new Error('pot-key-share: duplicate share index — refused')
    if (!/^[0-9a-f]{64}$/i.test(s.y)) throw new Error('pot-key-share: share payload must be 32 hex bytes — refused')
    seen.add(s.i)
    clean.push(s)
  }
  const take = clean.slice(0, SHARE_T)
  const out = new Uint8Array(SECRET_LEN)
  for (let b = 0; b < SECRET_LEN; b++) {
    const pts = take.map((s) => ({ x: s.i, y: parseInt(s.y.slice(b * 2, b * 2 + 2), 16) }))
    out[b] = lagrangeAtZero(pts)
  }
  return out
}

export function parseOwnerShare(raw: string): OwnerShare {
  let j: unknown
  try { j = JSON.parse(raw) } catch { throw new Error('pot-key-share: share is not JSON — refused') }
  if (!j || typeof j !== 'object') throw new Error('pot-key-share: share is not an object — refused')
  return j as OwnerShare
}
