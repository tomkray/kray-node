/**
 * BODY HASH — the genetics of a work (A5, additive).
 *
 * The relic on disk is NEVER rewritten. This module looks past the clothes
 * (ID3 / APIC / EXIF / PNG ancillary) and SHA-256s the skeleton:
 *   audio/mpeg  → MPEG frames (mpegBody)
 *   image/jpeg  → JPEG without APPn / COM
 *   image/png   → PNG without ancillary chunks
 *
 * Magic bytes win over a lying Content-Type. No decoder. No float.
 * Presentation / door only — the reducer stores the hex; it does not re-parse.
 */
import { createHash } from 'node:crypto'
import { mpegBody, isMp3 } from './id3-cover.js'

export const BODY_HASH_RE = /^[0-9a-f]{64}$/

const JPEG_SOI = (b) => b && b.length >= 2 && b[0] === 0xff && b[1] === 0xd8
const PNG_SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

function looksPng(b) {
  if (!b || b.length < 8) return false
  for (let i = 0; i < 8; i++) if (b[i] !== PNG_SIG[i]) return false
  return true
}

function sha(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** JPEG bitstream minus APPn (0xE0–0xEF) and COM (0xFE). Null if hostile / truncated. */
export function jpegSkeleton(file) {
  if (!JPEG_SOI(file)) return null
  const out = [0xff, 0xd8]
  let i = 2
  while (i < file.length) {
    if (file[i] !== 0xff) return null
    while (i < file.length && file[i] === 0xff) i++
    if (i >= file.length) return null
    const marker = file[i++]
    if (marker === 0xd9) {
      out.push(0xff, 0xd9)
      return Uint8Array.from(out)
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      out.push(0xff, marker)
      continue
    }
    if (i + 1 >= file.length) return null
    const len = (file[i] << 8) | file[i + 1]
    if (len < 2 || i + len > file.length) return null
    const skip = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe
    if (!skip) {
      out.push(0xff, marker)
      for (let k = 0; k < len; k++) out.push(file[i + k])
    }
    i += len
    if (marker === 0xda) {
      const start = i
      while (i + 1 < file.length) {
        if (file[i] === 0xff && file[i + 1] !== 0x00 && (file[i + 1] < 0xd0 || file[i + 1] > 0xd7)) {
          if (file[i + 1] === 0xd9) {
            for (let k = start; k < i; k++) out.push(file[k])
            out.push(0xff, 0xd9)
            return Uint8Array.from(out)
          }
          return null
        }
        i++
      }
      return null
    }
  }
  return null
}

/** PNG signature + critical chunks only (IHDR / PLTE / IDAT / IEND). */
export function pngSkeleton(file) {
  if (!looksPng(file)) return null
  const out = [file[0], file[1], file[2], file[3], file[4], file[5], file[6], file[7]]
  let i = 8
  let sawIend = false
  while (i + 12 <= file.length) {
    const len = ((file[i] << 24) | (file[i + 1] << 16) | (file[i + 2] << 8) | file[i + 3]) >>> 0
    if (i + 12 + len > file.length) return null
    const t0 = file[i + 4]
    const critical = (t0 & 0x20) === 0
    if (critical) {
      for (let k = 0; k < 12 + len; k++) out.push(file[i + k])
    }
    const type = String.fromCharCode(file[i + 4], file[i + 5], file[i + 6], file[i + 7])
    i += 12 + len
    if (type === 'IEND') { sawIend = true; break }
  }
  return sawIend ? Uint8Array.from(out) : null
}

function looksMp3(bytes, type) {
  if (isMp3(bytes, '', type) && !JPEG_SOI(bytes) && !looksPng(bytes)) return true
  if (!bytes || bytes.length < 3) return false
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return true
  return false
}

/**
 * Skeleton bytes the law hashes. Null when this drop has no genetics map
 * (text, pdf, …). Throws when the type/magic claims a map we cannot form.
 */
export function skeletonBytes(file, contentType) {
  const t = String(contentType || '').toLowerCase().split(';')[0].trim()
  // Magic first — a lying Content-Type cannot hide the work's genetics.
  if (JPEG_SOI(file)) {
    const sk = jpegSkeleton(file)
    if (!sk) throw new Error('cannot read a JPEG skeleton — the file is not a usable JPEG')
    return sk
  }
  if (looksPng(file)) {
    const sk = pngSkeleton(file)
    if (!sk) throw new Error('cannot read a PNG skeleton — the file is not a usable PNG')
    return sk
  }
  if (looksMp3(file, '')) {
    const sk = mpegBody(file)
    if (!sk || !sk.length) throw new Error('cannot read an MPEG skeleton — the file is not a usable MP3')
    return sk
  }
  if (t === 'image/jpeg' || t === 'image/jpg') {
    const sk = jpegSkeleton(file)
    if (!sk) throw new Error('cannot read a JPEG skeleton — the file is not a usable JPEG')
    return sk
  }
  if (t === 'image/png') {
    const sk = pngSkeleton(file)
    if (!sk) throw new Error('cannot read a PNG skeleton — the file is not a usable PNG')
    return sk
  }
  if (t === 'audio/mpeg' || t === 'audio/mp3' || t === 'audio/x-mpeg') {
    const sk = mpegBody(file)
    if (!sk || !sk.length) throw new Error('cannot read an MPEG skeleton — the file is not a usable MP3')
    return sk
  }
  return null
}

/** sha256(skeleton) or null when the type has no body law. */
export function bodyHashOf(file, contentType) {
  const sk = skeletonBytes(file, contentType)
  return sk ? sha(sk) : null
}

const api = { BODY_HASH_RE, jpegSkeleton, pngSkeleton, skeletonBytes, bodyHashOf }
if (typeof window !== 'undefined') {
  window.KRAY = window.KRAY || {}
  window.KRAY.body = api
}
