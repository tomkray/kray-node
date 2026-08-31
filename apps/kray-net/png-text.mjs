/**
 * PNG ancillary text — iTXt (UTF-8) before IEND.
 * Ancillary: pngSkeleton / bodyHash ignore it. File sha256 does not.
 * Keyword default `radiola` — same namespace as L2 metadata.type.
 */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function assertPng(file) {
  const buf = Buffer.isBuffer(file) ? file : Buffer.from(file)
  if (buf.length < 20 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG')
  return buf
}

function findIend(buf) {
  let i = 8
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i)
    const type = buf.toString('latin1', i + 4, i + 8)
    if (type === 'IEND') return i
    i += 12 + len
  }
  throw new Error('PNG has no IEND')
}

/** Last ```json … ``` fence in an MD body. Prose is everything before it. */
export function parseRadiolaMd(md) {
  const text = String(md)
  const fence = '\n```json\n'
  const at = text.lastIndexOf(fence)
  if (at < 0) throw new Error('radiola MD needs a trailing ```json fence')
  const close = text.indexOf('\n```', at + fence.length)
  if (close < 0) throw new Error('radiola MD JSON fence is unclosed')
  const raw = text.slice(at + fence.length, close)
  const metadata = JSON.parse(raw)
  return { prose: text.slice(0, at).trimEnd(), metadata, raw, fenceStart: at }
}

const RADIOLA_CHILD = new Set(['radiola_track', 'radiola_album'])

/** Stamp the immediate parent (artist → single|album, album → song). */
export function injectRadiolaParent(md, { parentId, parentStar }) {
  const { prose, metadata } = parseRadiolaMd(md)
  if (!RADIOLA_CHILD.has(metadata.type)) throw new Error('not a radiola child MD')
  metadata.parent_inscription_id = parentId
  if (parentStar != null) metadata.parent_star = String(parentStar)
  return prose + '\n\n```json\n' + JSON.stringify(metadata, null, 2) + '\n```\n'
}

export function injectTrackParent(md, args) {
  return injectRadiolaParent(md, args)
}

export function pngPutITxt(png, text, keyword = 'radiola') {
  const buf = assertPng(png)
  if (!/^[A-Za-z][A-Za-z0-9]{0,78}$/.test(keyword)) throw new Error('bad iTXt keyword')
  const payload = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(String(text), 'utf8'),
  ])
  const typed = Buffer.concat([Buffer.from('iTXt', 'latin1'), payload])
  const head = Buffer.alloc(4)
  head.writeUInt32BE(payload.length)
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(typed))
  const chunk = Buffer.concat([head, typed, tail])
  const iend = findIend(buf)
  return Buffer.concat([buf.subarray(0, iend), chunk, buf.subarray(iend)])
}

export function pngReadITxt(png, keyword = 'radiola') {
  const buf = assertPng(png)
  let i = 8
  let found = null
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i)
    const type = buf.toString('latin1', i + 4, i + 8)
    const data = buf.subarray(i + 8, i + 8 + len)
    if (type === 'iTXt') {
      const z = data.indexOf(0)
      if (z > 0 && data.toString('latin1', 0, z) === keyword && data[z + 1] === 0) {
        found = data.subarray(z + 5).toString('utf8')
      }
    }
    i += 12 + len
    if (type === 'IEND') break
  }
  return found
}
