/**
 * ID3 COVER — one MP3, one hash, one relic (A5).
 *
 * The audio frames are NEVER re-encoded. A cover rides inside ID3v2 APIC
 * (front cover). Title may live on the star name or in v4 JSON — this module
 * does not invent a second inscription.
 *
 * Write path: strip existing ID3v2/v1, prepend a clean ID3v2.3 APIC, keep the
 * MPEG body byte-identical. Read path: parse v2.2 PIC / v2.3 / v2.4 APIC,
 * fail-closed on a truncated or hostile tag.
 *
 * Presentation only — not a reducer rule, not a new era.
 */
export const MAX_ID3_TAG = 8_000_000
export const MAX_STAR_BYTES = 10_000_000
export const WRITE_MIMES = Object.freeze(['image/png', 'image/jpeg', 'image/gif'])
export const READ_MIMES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

const WRITE_OK = new Set(WRITE_MIMES)
const READ_OK = new Set(READ_MIMES)

function u32be(b, i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
}

function putU32be(n) {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
}

function syncsafe(b, i) {
  return ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f)
}

function putSyncsafe(n) {
  if (n < 0 || n > 0x0fffffff) throw new Error('id3 size out of range')
  return Uint8Array.of((n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f)
}

function concat(parts) {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

function deunsync(buf) {
  const out = new Uint8Array(buf.length)
  let o = 0
  for (let i = 0; i < buf.length; i++) {
    out[o++] = buf[i]
    if (buf[i] === 0xff && buf[i + 1] === 0x00) i++
  }
  return out.subarray(0, o)
}

function ascii(s) {
  const b = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff
  return b
}

function eq3(b, i, a, c, d) {
  return b[i] === a && b[i + 1] === c && b[i + 2] === d
}

function looksLikeForeignAudio(bytes) {
  if (!bytes || bytes.length < 12) return false
  if (eq3(bytes, 0, 0x52, 0x49, 0x46) && bytes[3] === 0x46) return true // RIFF
  if (eq3(bytes, 0, 0x66, 0x4c, 0x61) && bytes[3] === 0x43) return true // fLaC
  if (eq3(bytes, 0, 0x4f, 0x67, 0x67) && bytes[3] === 0x53) return true // OggS
  if (eq3(bytes, 4, 0x66, 0x74, 0x79) && bytes[7] === 0x70) return true // ftyp
  return false
}

/** True when the drop is an MP3 we can mux — never M4A / FLAC / WAV / Ogg. */
export function isMp3(bytes, name, type) {
  if (looksLikeForeignAudio(bytes)) return false
  const t = String(type || '').toLowerCase().split(';')[0].trim()
  if (t === 'audio/mpeg' || t === 'audio/mp3' || t === 'audio/x-mpeg') return true
  if (/\.mp3$/i.test(String(name || ''))) return true
  if (!bytes || bytes.length < 3) return false
  if (eq3(bytes, 0, 0x49, 0x44, 0x33)) return true
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return true
  return false
}

/**
 * Byte length of the ID3v2 prefix (header + tag [+ footer]). Null if absent
 * or the size claim is hostile / past MAX_ID3_TAG.
 */
export function id3TagTotalLength(header10) {
  if (!header10 || header10.length < 10) return null
  if (!eq3(header10, 0, 0x49, 0x44, 0x33)) return null
  const major = header10[3]
  if (major < 2 || major > 4) return null
  const size = syncsafe(header10, 6)
  if (size <= 0 || size > MAX_ID3_TAG) return null
  let total = 10 + size
  if (major >= 4 && (header10[5] & 0x10)) total += 10
  if (total > MAX_ID3_TAG + 20) return null
  return total
}

function stripId3v1(bytes) {
  if (!bytes || bytes.length < 128) return bytes
  const i = bytes.length - 128
  if (eq3(bytes, i, 0x54, 0x41, 0x47)) return bytes.subarray(0, i)
  return bytes
}

function stripId3v2(bytes) {
  const n = id3TagTotalLength(bytes)
  if (n == null) return bytes
  if (n >= bytes.length) return null
  return bytes.subarray(n)
}

/** MPEG body only — ID3v2 prefix and ID3v1 tail removed. Null if the tag ate the file. */
export function mpegBody(file) {
  const stripped = stripId3v2(file)
  if (stripped == null) return null
  return stripId3v1(stripped)
}

function skipEncodedString(buf, i, enc) {
  if (enc === 0 || enc === 3) {
    while (i < buf.length && buf[i] !== 0) i++
    return i + 1
  }
  while (i + 1 < buf.length && (buf[i] !== 0 || buf[i + 1] !== 0)) i += 2
  return i + 2
}

function skipCString(buf, i) {
  while (i < buf.length && buf[i] !== 0) i++
  return i + 1
}

function normalizeMime(raw) {
  const m = String(raw || '').toLowerCase().trim()
  if (m === 'image/jpg' || m === 'jpg' || m === 'jpeg') return 'image/jpeg'
  if (m === 'png') return 'image/png'
  if (m === 'gif') return 'image/gif'
  if (m === 'webp') return 'image/webp'
  return m
}

function parseApicBody(body) {
  if (!body || body.length < 4) return null
  const enc = body[0]
  if (enc > 3) return null
  let i = 1
  const mimeEnd = skipCString(body, i)
  if (mimeEnd <= i || mimeEnd > body.length) return null
  const mime = normalizeMime(new TextDecoder('latin1').decode(body.subarray(i, mimeEnd - 1)))
  if (!READ_OK.has(mime)) return null
  i = mimeEnd
  if (i >= body.length) return null
  const picType = body[i++]
  i = skipEncodedString(body, i, enc)
  if (i > body.length) return null
  const bytes = body.subarray(i)
  if (!bytes.length) return null
  return { mime, bytes, picType }
}

function parsePicBody(body) {
  if (!body || body.length < 6) return null
  const enc = body[0]
  if (enc > 3) return null
  const fmt = normalizeMime(String.fromCharCode(body[1], body[2], body[3]))
  const mime = fmt === 'image/jpeg' || fmt === 'image/png' || fmt === 'image/gif' ? fmt : null
  if (!mime || !READ_OK.has(mime)) return null
  const picType = body[4]
  let i = skipEncodedString(body, 5, enc)
  if (i > body.length) return null
  const bytes = body.subarray(i)
  if (!bytes.length) return null
  return { mime, bytes, picType }
}

function frameId(buf, i, len) {
  let s = ''
  for (let k = 0; k < len; k++) {
    const c = buf[i + k]
    if ((c < 0x30 || c > 0x39) && (c < 0x41 || c > 0x5a)) return ''
    s += String.fromCharCode(c)
  }
  return s
}

function walkFrames(tagBody, major) {
  const frames = []
  let i = 0
  const idLen = major === 2 ? 3 : 4
  const hdr = major === 2 ? 6 : 10
  while (i + hdr <= tagBody.length) {
    if (tagBody[i] === 0) break
    const id = frameId(tagBody, i, idLen)
    if (!id) break
    let size
    if (major === 2) size = (tagBody[i + 3] << 16) | (tagBody[i + 4] << 8) | tagBody[i + 5]
    else if (major === 4) size = syncsafe(tagBody, i + 4)
    else size = u32be(tagBody, i + 4)
    if (size < 0 || i + hdr + size > tagBody.length) break
    const flags = major === 2 ? 0 : (tagBody[i + 8] << 8) | tagBody[i + 9]
    frames.push({ id, flags, body: tagBody.subarray(i + hdr, i + hdr + size) })
    i += hdr + size
  }
  return frames
}

function skipExtended(tagBody, major, flags) {
  if (!(flags & 0x40) || tagBody.length < 4) return tagBody
  if (major >= 4) {
    const n = syncsafe(tagBody, 0)
    if (n < 4 || n > tagBody.length) return tagBody.subarray(0, 0)
    return tagBody.subarray(n)
  }
  const n = u32be(tagBody, 0)
  if (n > tagBody.length - 4) return tagBody.subarray(0, 0)
  return tagBody.subarray(4 + n)
}

function decodeFrameBody(frame, major) {
  let body = frame.body
  if (major >= 4) {
    const fmt = frame.flags & 0xff
    if (fmt & 0x08 || fmt & 0x04) return null
    if (fmt & 0x02) body = deunsync(body)
    if (fmt & 0x01) {
      if (body.length < 4) return null
      body = body.subarray(4)
    }
  } else if (major === 3) {
    if (frame.flags & 0x0080 || frame.flags & 0x0040) return null
  }
  return body
}

function pickCover(found) {
  if (!found.length) return null
  const front = found.find((x) => x.picType === 3)
  if (front) return { mime: front.mime, bytes: front.bytes }
  const other = found.find((x) => x.picType === 0)
  if (other) return { mime: other.mime, bytes: other.bytes }
  return { mime: found[0].mime, bytes: found[0].bytes }
}

/** First usable APIC/PIC, or null. A prefix that is only the ID3 tag is enough. */
export function readApic(file) {
  if (!file || file.length < 10) return null
  const total = id3TagTotalLength(file)
  if (total == null) return null
  const take = Math.min(total, file.length)
  if (take < 10) return null
  const major = file[3]
  const flags = file[5]
  let body = file.subarray(10, take - ((major >= 4 && (flags & 0x10) && take >= total) ? 10 : 0))
  if (flags & 0x80) body = deunsync(body)
  body = skipExtended(body, major, flags)
  const found = []
  for (const fr of walkFrames(body, major)) {
    const raw = decodeFrameBody(fr, major)
    if (!raw) continue
    const pic = fr.id === 'APIC' ? parseApicBody(raw) : fr.id === 'PIC' ? parsePicBody(raw) : null
    if (pic) found.push(pic)
  }
  return pickCover(found)
}

export function hasApic(file) {
  return readApic(file) != null
}

function buildId3v23Apic(image, mime) {
  if (!WRITE_OK.has(mime)) throw new Error('cover mime must be image/png, image/jpeg, or image/gif')
  if (!image || !image.length) throw new Error('cover is empty')
  const mimeBytes = ascii(mime)
  const frameBody = concat([
    Uint8Array.of(0x00),
    mimeBytes,
    Uint8Array.of(0x00, 0x03, 0x00),
    image,
  ])
  const frame = concat([ascii('APIC'), putU32be(frameBody.length), Uint8Array.of(0x00, 0x00), frameBody])
  return concat([ascii('ID3'), Uint8Array.of(0x03, 0x00, 0x00), putSyncsafe(frame.length), frame])
}

/**
 * Prepend a clean ID3v2.3 APIC. Existing tags are stripped. MPEG bytes after
 * the old tag are copied, never decoded. Throws if the result would exceed
 * the 10 MB star ceiling or the file is not a usable MP3 body.
 */
export function writeApic(file, image, mime) {
  if (looksLikeForeignAudio(file)) throw new Error('cover mux is MP3 only — audio frames stay as dropped')
  const mpeg = mpegBody(file)
  if (mpeg == null || mpeg.length === 0) throw new Error('cannot find MPEG body — file is not a usable MP3')
  const tag = buildId3v23Apic(image, mime)
  const out = concat([tag, mpeg])
  if (out.length > MAX_STAR_BYTES) throw new Error('music file exceeds the 10 MB star ceiling')
  return out
}

/** The Music relic: one MP3 + one cover → one audio/mpeg. Never a second inscription. */
export function musicRelic(mp3, cover, mime) {
  return writeApic(mp3, cover, mime)
}

/**
 * MPEG-1 Layer III bitrate of the first frame, or null. Used to prove a 320 kbps
 * drop stays 320 after mux — we copy frames, we never LAME-encode.
 */
export function mpeg1L3BitrateKbps(mpeg) {
  const body = mpegBody(mpeg) || mpeg
  if (!body || body.length < 4) return null
  if (body[0] !== 0xff || (body[1] & 0xe0) !== 0xe0) return null
  if (((body[1] >> 3) & 3) !== 3) return null
  if (((body[1] >> 1) & 3) !== 1) return null
  const table = [null, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, null]
  return table[(body[2] >> 4) & 0xf] ?? null
}

const api = {
  MAX_ID3_TAG, MAX_STAR_BYTES, WRITE_MIMES, READ_MIMES,
  isMp3, id3TagTotalLength, mpegBody, readApic, hasApic, writeApic, musicRelic, mpeg1L3BitrateKbps,
}

if (typeof window !== 'undefined') {
  window.KRAY = window.KRAY || {}
  window.KRAY.id3 = api
}
