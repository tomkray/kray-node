/**
 * OWNER KEY BOX — encrypt the pot owner secret AT REST for the private signer.
 *
 * This is a real rung: a stolen vault-keys file is not the pot, if the
 * passphrase is not in that file. It is NOT a theorem against a running
 * signer (the key is open in RAM while the process is up) and it is NOT
 * for the public node — encrypting there is theater (the attacker already
 * has the process that decrypts).
 *
 * scrypt → AES-256-GCM. Wrong passphrase or a flipped bit → refuse.
 * Pure enough: Node crypto only, no network, never logs the secret.
 */
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto'

export const BOX_VERSION = 1
const KDF = 'scrypt'
const ALG = 'aes-256-gcm'
const KEY_LEN = 32
const NONCE_LEN = 12
const SALT_LEN = 16
const N = 16384
const R = 8
const P = 1
const MAXMEM = 64 * 1024 * 1024

export interface OwnerBox {
  v: number
  kdf: string
  N: number
  r: number
  p: number
  salt: string
  alg: string
  nonce: string
  ct: string
  tag: string
}

function hex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex')
}

function derive(passphrase: string, salt: Uint8Array, n: number, r: number, p: number): Buffer {
  if (typeof passphrase !== 'string' || passphrase.length < 16) {
    throw new Error('pot-key-box: passphrase must be at least 16 characters — a short phrase is not a lock')
  }
  return scryptSync(passphrase, Buffer.from(salt), KEY_LEN, { N: n, r, p, maxmem: MAXMEM })
}

/** Seal a 32-byte owner secret. Never returns the secret. */
export function sealOwnerSecret(secret: Uint8Array, passphrase: string): OwnerBox {
  if (secret.length !== 32) throw new Error('pot-key-box: the owner secret must be 32 bytes')
  const salt = randomBytes(SALT_LEN)
  const nonce = randomBytes(NONCE_LEN)
  const key = derive(passphrase, salt, N, R, P)
  const cipher = createCipheriv(ALG, key, nonce)
  const ct = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()])
  const tag = cipher.getAuthTag()
  key.fill(0)
  return {
    v: BOX_VERSION, kdf: KDF, N, r: R, p: P,
    salt: hex(salt), alg: ALG, nonce: hex(nonce), ct: hex(ct), tag: hex(tag),
  }
}

/** Open a box. Wrong passphrase or tamper → throw (fail-closed). */
export function openOwnerSecret(box: OwnerBox, passphrase: string): Uint8Array {
  if (!box || box.v !== BOX_VERSION || box.kdf !== KDF || box.alg !== ALG) {
    throw new Error('pot-key-box: unknown or unsupported box — refused')
  }
  if (!/^[0-9a-f]+$/i.test(box.salt) || !/^[0-9a-f]+$/i.test(box.nonce) || !/^[0-9a-f]+$/i.test(box.ct) || !/^[0-9a-f]+$/i.test(box.tag)) {
    throw new Error('pot-key-box: box fields must be hex — refused')
  }
  const n = Number(box.N), r = Number(box.r), p = Number(box.p)
  if (n < 16384 || r < 8 || p < 1) throw new Error('pot-key-box: KDF parameters too weak — refused')
  const salt = Buffer.from(box.salt, 'hex')
  const nonce = Buffer.from(box.nonce, 'hex')
  const ct = Buffer.from(box.ct, 'hex')
  const tag = Buffer.from(box.tag, 'hex')
  if (nonce.length !== NONCE_LEN || tag.length !== 16) throw new Error('pot-key-box: malformed nonce or tag — refused')
  const key = derive(passphrase, salt, n, r, p)
  try {
    const decipher = createDecipheriv(ALG, key, nonce)
    decipher.setAuthTag(tag)
    const pt = Buffer.concat([decipher.update(ct), decipher.final()])
    if (pt.length !== 32) throw new Error('pot-key-box: opened payload is not a 32-byte key — refused')
    return new Uint8Array(pt)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/not a 32-byte/.test(msg)) throw e
    throw new Error('pot-key-box: wrong passphrase or tampered box — refused')
  } finally {
    key.fill(0)
  }
}

export function parseOwnerBox(raw: string): OwnerBox {
  let j: unknown
  try { j = JSON.parse(raw) } catch { throw new Error('pot-key-box: box is not JSON — refused') }
  if (!j || typeof j !== 'object') throw new Error('pot-key-box: box is not an object — refused')
  return j as OwnerBox
}
