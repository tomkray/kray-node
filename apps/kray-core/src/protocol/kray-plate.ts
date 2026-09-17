/**
 * KRAY PLATE — living plate beside the relic (A5 untouched).
 *
 * Journal seals only a SHA-256 commitment; payload bytes live content-addressed
 * in the atlas (filename = hash). Update = new seal + 1 ₭; old plaintext need not
 * stay on hot disk (GC when no tip pointer). Owner-only. Domain-separated message.
 *
 * Canonical payload (UTF-8, LF, frozen field order — never JSON key-order drift):
 *   kray-plate.v1\n
 *   desc=<…>\n
 *   url=<…>\n
 *   bannerUrl=<…>\n
 *   [optional] bannerStar=<decimal>\n   — omit entirely when empty (A3: tips without it stay byte-identical)
 *   [optional action block — omitted entirely when actTo is empty (A3: old tips byte-identical)]
 *   actTo=<bech32 address>\n
 *   actHint=<≤32 B label>\n
 *   actAmount=<decimal ₭ suggestion or empty>\n
 *   [optional like tip block — omitted when likeTip empty (A3: default = fee-only like, no floor)]
 *   likeTip=<none|kray|x|rune>\n
 *   likeAmount=<decimal floor; 0/empty with none>\n
 *   [optional] likeRune=<runeId>\n   — only when likeTip=rune
 *
 * Banner visual (product): https media URL (YouTube / video / image) via bannerUrl.
 * Optional bannerStar remains in the byte grammar (A3) so any tip sealed with it still
 * replays byte-identically; the living mouth uses bannerUrl. Action block is an invitation
 * only: chrome may prepare a `transfer` to actTo. It is NOT a paper/contract.
 * Like tip block is the owner's sealed floor for star-like (set via plate · 1 ₭).
 */
import { createHash } from 'node:crypto'
import { assertHttpsOrEmpty, assertProfileText, PROFILE_DESC_MAX_BYTES, PROFILE_URL_MAX_BYTES } from './scheme.ts'

export const KRAY_PLATE_CONTENT_TYPE = 'application/kray-plate'
/** Hard ceiling on atlas payload size (desc+urls+headers+optional act). */
export const KRAY_PLATE_MAX_BYTES = 1600
export const KRAY_PLATE_HASH_RE = /^[0-9a-f]{64}$/
export const KRAY_PLATE_ACT_HINT_MAX_BYTES = 32
/** Suggested amount: empty (visitor chooses) or canonical non-negative decimal ≤ 19 digits. */
export const KRAY_PLATE_ACT_AMOUNT_RE = /^(0|[1-9]\d{0,18})?$/
/** Citizen-shaped bech32 / bech32m — network checked at transfer time. */
const ACT_TO_RE = /^(bc1|tb1|bcrt1)[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{14,120}$/i

export type KrayPlateFields = {
  description: string
  url: string
  bannerUrl: string
  /** Optional owned image star as the plate cinema (promo / market). Empty ⇒ omitted from bytes. */
  bannerStar?: string
  /** Optional pay invitation destination. Empty ⇒ no action block in bytes. */
  actTo?: string
  /** Short UI label (like | gift | tip | support | …). */
  actHint?: string
  /** Suggested ₭ amount; empty or "0" ⇒ visitor chooses at confirm. */
  actAmount?: string
  /**
   * Sealed like tip floor for star-like (β′). Omit ⇒ no floor (chrome default tip 0 / fee-only).
   * none = fee-only likes only; kray|x|rune + likeAmount = minimum tip of that asset.
   */
  likeTip?: string
  likeAmount?: string
  likeRune?: string
}

function assertActToOrEmpty(a: string): void {
  assertProfileText(a, 128, 'actTo')
  if (a === '') return
  if (!ACT_TO_RE.test(a)) {
    throw new Error('kray-plate: actTo must be a bech32 address (bc1 / tb1 / bcrt1)')
  }
}

function assertActHintOrEmpty(h: string): void {
  assertProfileText(h, KRAY_PLATE_ACT_HINT_MAX_BYTES, 'actHint')
}

function assertActAmountOrEmpty(a: string): void {
  assertProfileText(a, 20, 'actAmount')
  if (!KRAY_PLATE_ACT_AMOUNT_RE.test(a)) {
    throw new Error('kray-plate: actAmount must be empty or a canonical non-negative decimal')
  }
}

function assertBannerStarOrEmpty(s: string): void {
  assertProfileText(s, 24, 'bannerStar')
  if (s === '') return
  if (!/^(0|[1-9]\d*)$/.test(s)) {
    throw new Error('kray-plate: bannerStar must be a star number or empty')
  }
}

function normalizeLikeTip(fields: KrayPlateFields): { likeTip: string; likeAmount: string; likeRune: string } {
  const likeTip = (fields.likeTip ?? '').trim()
  const likeAmount = fields.likeAmount ?? ''
  const likeRune = (fields.likeRune ?? '').trim()
  assertProfileText(likeTip, 8, 'likeTip')
  assertActAmountOrEmpty(likeAmount)
  assertProfileText(likeRune, 128, 'likeRune')
  if (likeTip === '') {
    if (likeAmount !== '' || likeRune !== '') {
      throw new Error('kray-plate: likeAmount / likeRune require likeTip')
    }
    return { likeTip: '', likeAmount: '', likeRune: '' }
  }
  if (likeTip !== 'none' && likeTip !== 'kray' && likeTip !== 'x' && likeTip !== 'rune') {
    throw new Error('kray-plate: likeTip must be none, kray, x, or rune')
  }
  if (likeTip === 'none') {
    if (likeRune !== '') throw new Error('kray-plate: likeRune requires likeTip=rune')
    return { likeTip: 'none', likeAmount: likeAmount === '' ? '0' : likeAmount, likeRune: '' }
  }
  if (likeTip === 'rune') {
    if (!likeRune) throw new Error('kray-plate: likeTip=rune needs likeRune')
  } else if (likeRune !== '') {
    throw new Error('kray-plate: likeRune only when likeTip=rune')
  }
  const floor = likeAmount === '' ? '0' : likeAmount
  if (floor === '0') throw new Error('kray-plate: like tip floor must be ≥ 1 when likeTip is kray, x, or rune')
  return { likeTip, likeAmount: floor, likeRune }
}

function normalizeAct(fields: KrayPlateFields): { actTo: string; actHint: string; actAmount: string } {
  const actTo = fields.actTo ?? ''
  const actHint = fields.actHint ?? ''
  const actAmount = fields.actAmount ?? ''
  assertActToOrEmpty(actTo)
  assertActHintOrEmpty(actHint)
  assertActAmountOrEmpty(actAmount)
  if (actTo === '') {
    if (actHint !== '' || actAmount !== '') {
      throw new Error('kray-plate: actHint / actAmount require actTo')
    }
    return { actTo: '', actHint: '', actAmount: '' }
  }
  return { actTo, actHint, actAmount }
}

/** Encode the living-plate packet — one canonical byte string for the whole network. */
export function encodeKrayPlate(fields: KrayPlateFields): Buffer {
  const description = fields.description ?? ''
  const url = fields.url ?? ''
  const bannerUrl = fields.bannerUrl ?? ''
  const bannerStar = fields.bannerStar ?? ''
  assertProfileText(description, PROFILE_DESC_MAX_BYTES, 'description')
  assertHttpsOrEmpty(url, 'url')
  assertHttpsOrEmpty(bannerUrl, 'bannerUrl')
  assertBannerStarOrEmpty(bannerStar)
  const { actTo, actHint, actAmount } = normalizeAct(fields)
  const { likeTip, likeAmount, likeRune } = normalizeLikeTip(fields)
  let body =
    'kray-plate.v1\n' +
    `desc=${description}\n` +
    `url=${url}\n` +
    `bannerUrl=${bannerUrl}\n`
  if (bannerStar !== '') body += `bannerStar=${bannerStar}\n`
  if (actTo !== '') {
    body +=
      `actTo=${actTo}\n` +
      `actHint=${actHint}\n` +
      `actAmount=${actAmount}\n`
  }
  if (likeTip !== '') {
    body += `likeTip=${likeTip}\n` + `likeAmount=${likeAmount}\n`
    if (likeTip === 'rune') body += `likeRune=${likeRune}\n`
  }
  const buf = Buffer.from(body, 'utf8')
  if (buf.length > KRAY_PLATE_MAX_BYTES) {
    throw new Error(`kray-plate: payload is ${buf.length} bytes — cap is ${KRAY_PLATE_MAX_BYTES}`)
  }
  return buf
}

export function hashKrayPlate(fields: KrayPlateFields): string {
  return createHash('sha256').update(encodeKrayPlate(fields)).digest('hex')
}

/** True when the plate invites a paid action (transfer). */
export function krayPlateHasAct(fields: KrayPlateFields): boolean {
  return !!(fields.actTo && fields.actTo.length > 0)
}

/** Parse + re-validate atlas bytes; returns fields or throws (fail-closed). */
export function decodeKrayPlate(buf: Uint8Array | Buffer): KrayPlateFields {
  if (buf.length > KRAY_PLATE_MAX_BYTES) {
    throw new Error(`kray-plate: payload is ${buf.length} bytes — cap is ${KRAY_PLATE_MAX_BYTES}`)
  }
  const text = Buffer.from(buf).toString('utf8')
  const lines = text.split('\n')
  if (lines[0] !== 'kray-plate.v1') throw new Error('kray-plate: unknown packet version')
  if (lines.length < 4) throw new Error('kray-plate: truncated packet')
  const grab = (prefix: string, line: string) => {
    if (!line.startsWith(prefix)) throw new Error(`kray-plate: expected ${prefix}`)
    return line.slice(prefix.length)
  }
  const description = grab('desc=', lines[1]!)
  const url = grab('url=', lines[2]!)
  const bannerUrl = grab('bannerUrl=', lines[3]!)
  let bannerStar = ''
  let actTo = ''
  let actHint = ''
  let actAmount = ''
  let likeTip = ''
  let likeAmount = ''
  let likeRune = ''
  let i = 4
  // Optional bannerStar (A3 — absent on tips sealed before this field).
  if (i < lines.length && lines[i]!.startsWith('bannerStar=')) {
    bannerStar = grab('bannerStar=', lines[i]!)
    i++
  }
  // Allow a single trailing empty from the final LF; refuse mid-packet blanks / junk.
  if (i < lines.length && lines[i]!.startsWith('actTo=')) {
    actTo = grab('actTo=', lines[i]!)
    i++
    if (i >= lines.length) throw new Error('kray-plate: truncated action block')
    actHint = grab('actHint=', lines[i]!)
    i++
    if (i >= lines.length) throw new Error('kray-plate: truncated action block')
    actAmount = grab('actAmount=', lines[i]!)
    i++
  }
  // Optional like tip floor (A3 — absent on tips sealed before social like).
  if (i < lines.length && lines[i]!.startsWith('likeTip=')) {
    likeTip = grab('likeTip=', lines[i]!)
    i++
    if (i >= lines.length) throw new Error('kray-plate: truncated like tip block')
    likeAmount = grab('likeAmount=', lines[i]!)
    i++
    if (likeTip === 'rune') {
      if (i >= lines.length) throw new Error('kray-plate: truncated like tip block')
      likeRune = grab('likeRune=', lines[i]!)
      i++
    }
  }
  while (i < lines.length) {
    if (lines[i] !== '') throw new Error('kray-plate: unexpected trailing content')
    i++
  }
  assertProfileText(description, PROFILE_DESC_MAX_BYTES, 'description')
  assertHttpsOrEmpty(url, 'url')
  assertHttpsOrEmpty(bannerUrl, 'bannerUrl')
  assertBannerStarOrEmpty(bannerStar)
  normalizeAct({ description, url, bannerUrl, bannerStar, actTo, actHint, actAmount })
  const like = normalizeLikeTip({ description, url, bannerUrl, likeTip, likeAmount, likeRune })
  const out: KrayPlateFields = { description, url, bannerUrl }
  if (bannerStar !== '') out.bannerStar = bannerStar
  if (actTo !== '') {
    out.actTo = actTo
    out.actHint = actHint
    out.actAmount = actAmount
  }
  if (like.likeTip !== '') {
    out.likeTip = like.likeTip
    out.likeAmount = like.likeAmount
    if (like.likeRune) out.likeRune = like.likeRune
  }
  return out
}

/** Verify atlas bytes match a sealed hash (paint / door). */
export function assertKrayPlateBytes(hash: string, buf: Uint8Array | Buffer): KrayPlateFields {
  if (!KRAY_PLATE_HASH_RE.test(hash)) throw new Error('kray-plate: plate hash must be 64 hex')
  const fields = decodeKrayPlate(buf)
  const got = createHash('sha256').update(Buffer.from(buf)).digest('hex')
  if (got !== hash) throw new Error('kray-plate: atlas bytes do not match sealed hash — refuse')
  // Re-encode must be byte-identical (canonical lock)
  const round = encodeKrayPlate(fields)
  if (createHash('sha256').update(round).digest('hex') !== hash) {
    throw new Error('kray-plate: non-canonical payload — refuse')
  }
  return fields
}

/** Signed message — address plate when star is empty; star plate when star is set. */
export function setKrayPlateMessage(
  network: string,
  from: string,
  plateHash: string,
  star: string,
  nonce: number,
): string {
  const h = plateHash === '' ? '' : plateHash.toLowerCase()
  if (h !== '' && !KRAY_PLATE_HASH_RE.test(h)) throw new Error('kray-plate: plate hash must be 64 hex or empty (clear)')
  if (star !== '' && !/^(0|[1-9]\d*)$/.test(star)) throw new Error('kray-plate: star must be a decimal star number or empty')
  return `kray-core.set-kray-plate.v1|net=${network}|from=${from}|plate=${h}|star=${star}|nonce=${nonce}`
}
