/**
 * STAR SPEAK — the living mouth proves it holds a face. No journal. No ₭.
 *
 * The star number is the master id a lock names (car, house, vault).
 * The key that signs is ownerOf(N) — A9: the address is the user.
 * Anyone re-derives the verdict from the proof bytes + ownerOf(N).
 * The door is a convenience checker, not consensus (Supreme Law).
 *
 * A2 is intact: nothing is appended. A paid latch on the cascade is a
 * contract-call (once_ / toggle) and still costs 1 ₭.
 */
import { createHash } from 'node:crypto'
import { toBtcNet, verifySignature, type SchemeId } from './scheme.ts'

export const SPEAK_PREFIX = 'kray-core.star.speak.v1|'
export const SPEAK_TTL_SEC = 90
export const SPEAK_MAX_TTL_SEC = 300

const AUDIENCE_RE = /^[a-z][a-z0-9._-]{0,31}$/
const NONCE_RE = /^[0-9a-f]{32}$/
const STAR_RE = /^(0|[1-9]\d*)$/

export interface SpeakChallenge {
  network: string
  star: string
  owner: string
  audience: string
  nonce: string
  exp: number
}

export interface SpeakProof extends SpeakChallenge {
  message: string
  signature: string
  publicKey: string
  scheme: SchemeId
}

export function readAudience(raw: string | null | undefined): string {
  const a = String(raw ?? 'hold').trim().toLowerCase() || 'hold'
  if (!AUDIENCE_RE.test(a)) throw new Error('speak: audience is a short name — car, house, vault, hold')
  return a
}

/** Stable consume key for a lock. Not a journal id — Speak never appends (A2). */
export function speakId(message: string): string {
  return createHash('sha256').update(String(message ?? ''), 'utf8').digest('hex')
}

export function speakMessage(c: SpeakChallenge): string {
  if (!STAR_RE.test(c.star)) throw new Error('speak: star must be a creation number')
  if (!c.owner || typeof c.owner !== 'string') throw new Error('speak: owner is required')
  if (!NONCE_RE.test(c.nonce)) throw new Error('speak: nonce must be 16 bytes hex')
  const exp = Number(c.exp)
  if (!Number.isFinite(exp) || exp <= 0) throw new Error('speak: exp must be a unix second')
  const audience = readAudience(c.audience)
  return `${SPEAK_PREFIX}net=${c.network}|star=${c.star}|owner=${c.owner}|audience=${audience}|nonce=${c.nonce}|exp=${exp}`
}

export function parseSpeakMessage(raw: string): SpeakChallenge | { ok: false; reason: string } {
  const t = String(raw ?? '')
  if (!t.startsWith(SPEAK_PREFIX)) return { ok: false, reason: 'speak: not a speak message' }
  const parts = t.slice(SPEAK_PREFIX.length).split('|')
  const got: Record<string, string> = {}
  for (const p of parts) {
    const i = p.indexOf('=')
    if (i <= 0) return { ok: false, reason: 'speak: malformed field' }
    got[p.slice(0, i)] = p.slice(i + 1)
  }
  const need = ['net', 'star', 'owner', 'audience', 'nonce', 'exp']
  for (const k of need) if (got[k] == null || got[k] === '') return { ok: false, reason: `speak: missing ${k}` }
  try {
    const c: SpeakChallenge = {
      network: got.net,
      star: got.star,
      owner: got.owner,
      audience: readAudience(got.audience),
      nonce: got.nonce,
      exp: Number(got.exp),
    }
    if (speakMessage(c) !== t) return { ok: false, reason: 'speak: message is not canonical' }
    return c
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'speak: parse refused' }
  }
}

/**
 * Re-derive the hold from bytes. Caller supplies the living owner (from their own replay).
 */
export function verifySpeak(
  proof: SpeakProof,
  livingOwner: string,
  now = Math.floor(Date.now() / 1000),
  expectedNetwork?: string,
): { ok: true; message: string; challenge: SpeakChallenge } | { ok: false; reason: string } {
  if (!livingOwner) return { ok: false, reason: 'speak: this star has no living owner' }
  if (livingOwner === 'KRAY_BLACK_HOLE') return { ok: false, reason: 'speak: a frozen star has no mouth' }
  if (expectedNetwork && proof.network !== expectedNetwork) return { ok: false, reason: 'speak: wrong network' }
  let message: string
  try {
    message = speakMessage(proof)
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'speak: bad challenge' }
  }
  if (proof.message && proof.message !== message) return { ok: false, reason: 'speak: signed message does not match the challenge' }
  if (proof.owner !== livingOwner) return { ok: false, reason: 'speak: owner in the message is not the living holder' }
  if (now > proof.exp) return { ok: false, reason: 'speak: challenge expired' }
  if (proof.exp - now > SPEAK_MAX_TTL_SEC) return { ok: false, reason: 'speak: challenge lives too long' }
  const scheme = (proof.scheme || 'kraywallet') as SchemeId
  if (!verifySignature(livingOwner, message, proof.signature, proof.publicKey, scheme, toBtcNet(proof.network))) {
    return { ok: false, reason: 'speak: signature does not prove the living owner' }
  }
  return { ok: true, message, challenge: {
    network: proof.network,
    star: proof.star,
    owner: proof.owner,
    audience: proof.audience,
    nonce: proof.nonce,
    exp: proof.exp,
  } }
}
