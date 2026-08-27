/**
 * BODY HASH — skeleton identity. No reducer.
 *   node apps/kray-net/body-hash.test.mjs
 */
import { createHash } from 'node:crypto'
import { bodyHashOf, jpegSkeleton, pngSkeleton, skeletonBytes } from './body-hash.js'
import { musicRelic, mpegBody } from './id3-cover.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const sha = (b) => createHash('sha256').update(b).digest('hex')

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

function jpegWithApp(tag) {
  const app = Uint8Array.from(Buffer.from('EXIF|' + tag, 'utf8'))
  const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]
  const ent = [0xaa, 0xbb, 0xff, 0x00, 0xcc]
  const appSeg = [0xff, 0xe1, (2 + app.length) >> 8, (2 + app.length) & 0xff, ...app]
  return Uint8Array.from([0xff, 0xd8, ...appSeg, ...sof, ...sos, ...ent, 0xff, 0xd9])
}

function pngWithText(png, text) {
  const iend = png.length - 12
  const data = Uint8Array.from(Buffer.from('k\0' + text, 'utf8'))
  const n = data.length
  const chunk = Uint8Array.from([
    (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff,
    0x74, 0x45, 0x58, 0x74, ...data, 0, 0, 0, 0,
  ])
  const out = new Uint8Array(iend + chunk.length + 12)
  out.set(png.subarray(0, iend), 0)
  out.set(chunk, iend)
  out.set(png.subarray(iend), iend + chunk.length)
  return out
}

console.log('\n╔═ BODY HASH — MPEG / JPEG / PNG skeleton ═╗\n')

ok(bodyHashOf(Uint8Array.from([0x61, 0x62, 0x63]), 'text/plain') === null, 'text has no body law')

const mpeg = Uint8Array.from([0xff, 0xfb, 0xe0, 0x00, 1, 2, 3, 4, 5, 6, 7, 8])
const coverA = Uint8Array.from([...PNG, 0x11])
const coverB = Uint8Array.from([...PNG, 0x22])
const relicA = musicRelic(mpeg, coverA, 'image/png')
const relicB = musicRelic(mpeg, coverB, 'image/png')
ok(sha(relicA) !== sha(relicB), 'different covers → different relic sha256')
ok(bodyHashOf(relicA, 'audio/mpeg') === bodyHashOf(relicB, 'audio/mpeg'), 'same MPEG skeleton → same bodyHash')
ok(bodyHashOf(relicA, 'audio/mpeg') === sha(mpegBody(relicA)), 'bodyHash is sha256(mpegBody)')
ok(bodyHashOf(relicA, 'text/plain') === bodyHashOf(relicA, 'audio/mpeg'), 'magic MP3 wins over a lying text/plain')

const j1 = jpegWithApp('alice')
const j2 = jpegWithApp('bob')
ok(sha(j1) !== sha(j2), 'different EXIF → different file hash')
ok(!!jpegSkeleton(j1) && sha(jpegSkeleton(j1)) === sha(jpegSkeleton(j2)), 'JPEG skeleton ignores APP1')
ok(bodyHashOf(j1, 'image/jpeg') === bodyHashOf(j2, 'application/octet-stream'), 'magic JPEG wins over a lying type')

const p2 = pngWithText(PNG, 'copyright-bob')
ok(sha(PNG) !== sha(p2), 'tEXt changes the file hash')
ok(sha(pngSkeleton(PNG)) === sha(pngSkeleton(p2)), 'PNG skeleton drops tEXt')
ok(bodyHashOf(PNG, 'image/png') === bodyHashOf(p2, 'image/png'), 'same PNG gene after ancillary')

try {
  skeletonBytes(Uint8Array.of(0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0), 'audio/mpeg')
  ok(false, 'ID3 tag with no MPEG body must throw')
} catch {
  ok(true, 'ID3 tag with no MPEG body is refused')
}

if (fail) { console.log('\n  ' + fail + ' failed · ' + pass + ' passed\n'); process.exit(1) }
console.log('\n  ' + pass + ' passed\n')
