/**
 * ID3 COVER — MPEG body stays byte-identical; APIC round-trips; hostile tags
 * fail closed. No encoder. No reducer.
 *   node apps/kray-net/id3-cover.test.mjs
 */
import {
  mpegBody, writeApic, readApic, hasApic, isMp3, id3TagTotalLength, MAX_STAR_BYTES,
} from './id3-cover.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn, re, m) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { ok(re.test(String(e && e.message)), m + (re.test(String(e && e.message)) ? '' : ' — wrong error: ' + e.message)) }
}

const PNG_1x1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])
const JPEG_STUB = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, 0x11, 0x22, 0x33])
const MPEG = Uint8Array.from([0xff, 0xfb, 0x90, 0x00, ...Array.from({ length: 240 }, (_, i) => (i * 17) & 0xff)])

function u32be(n) {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
}
function syncsafe(n) {
  return Uint8Array.of((n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f)
}
function ascii(s) {
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}
function cat(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
function same(a, b) {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function id3v23(frames) {
  const body = cat(...frames)
  return cat(ascii('ID3'), Uint8Array.of(0x03, 0x00, 0x00), syncsafe(body.length), body)
}
function frame23(id, body) {
  return cat(ascii(id), u32be(body.length), Uint8Array.of(0x00, 0x00), body)
}

console.log('\n╔═ ID3 COVER — MPEG identity · APIC · fail-closed ═╗\n')

ok(!readApic(MPEG), 'bare MPEG has no cover')
ok(!hasApic(MPEG), 'hasApic is false without a tag')
ok(isMp3(MPEG, 'x.mp3', ''), 'sync-word + .mp3 is music')
ok(isMp3(MPEG, '', 'audio/mpeg'), 'audio/mpeg is music')
ok(!isMp3(cat(ascii('RIFF'), new Uint8Array(20)), 'x.mp3', 'audio/mpeg'), 'RIFF is refused even if named .mp3')
ok(!isMp3(cat(new Uint8Array(4), ascii('ftyp'), new Uint8Array(8)), 'a.m4a', 'audio/mp4'), 'ftyp / M4A is not MP3')

const muxed = writeApic(MPEG, PNG_1x1, 'image/png')
ok(same(mpegBody(muxed), MPEG), 'write leaves MPEG frames byte-identical')
ok(hasApic(muxed), 'muxed file reports a cover')
const got = readApic(muxed)
ok(!!got && got.mime === 'image/png' && same(got.bytes, PNG_1x1), 'APIC PNG round-trips lossless')

const again = writeApic(muxed, JPEG_STUB, 'image/jpeg')
ok(same(mpegBody(again), MPEG), 'rewriting APIC still leaves MPEG identical')
const gotJ = readApic(again)
ok(!!gotJ && gotJ.mime === 'image/jpeg' && same(gotJ.bytes, JPEG_STUB), 'second write replaces the cover')

const tagged = cat(
  id3v23([
    frame23('TIT2', cat(Uint8Array.of(0x00), ascii('old title'))),
    frame23('APIC', cat(Uint8Array.of(0x00), ascii('image/jpeg'), Uint8Array.of(0x00, 0x03, 0x00), JPEG_STUB)),
  ]),
  MPEG,
  ascii('TAG'),
  new Uint8Array(125),
)
ok(same(mpegBody(tagged), MPEG), 'strips ID3v2 + ID3v1, MPEG remains')
const replaced = writeApic(tagged, PNG_1x1, 'image/png')
ok(same(mpegBody(replaced), MPEG), 'mux from a tagged file does not touch frames')
ok(readApic(replaced).mime === 'image/png', 'old APIC is replaced (title may be dropped — name lives on the star)')

const v24Body = cat(
  ascii('APIC'),
  syncsafe(1 + 9 + 1 + 1 + 1 + PNG_1x1.length), // enc + image/png\0 + type + desc\0 + png
  Uint8Array.of(0x00, 0x00),
  Uint8Array.of(0x00),
  ascii('image/png'),
  Uint8Array.of(0x00, 0x03, 0x00),
  PNG_1x1,
)
const v24 = cat(ascii('ID3'), Uint8Array.of(0x04, 0x00, 0x00), syncsafe(v24Body.length), v24Body, MPEG)
ok(!!readApic(v24) && same(readApic(v24).bytes, PNG_1x1), 'reads ID3v2.4 syncsafe APIC')

const picBody = cat(Uint8Array.of(0x00), ascii('PNG'), Uint8Array.of(0x03, 0x00), PNG_1x1)
const v22Head = cat(
  ascii('ID3'), Uint8Array.of(0x02, 0x00, 0x00),
  syncsafe(6 + picBody.length),
  ascii('PIC'),
  Uint8Array.of((picBody.length >> 16) & 0xff, (picBody.length >> 8) & 0xff, picBody.length & 0xff),
  picBody,
)
ok(!!readApic(cat(v22Head, MPEG)) && same(readApic(cat(v22Head, MPEG)).bytes, PNG_1x1), 'reads ID3v2.2 PIC')

const unsyncInner = Uint8Array.of(0xff, 0x00, 0xe0)
const unsyncTag = cat(
  ascii('ID3'), Uint8Array.of(0x03, 0x00, 0x80),
  syncsafe(unsyncInner.length),
  unsyncInner,
)
ok(id3TagTotalLength(unsyncTag) === 10 + unsyncInner.length, 'unsync flag still yields a finite tag length')

ok(readApic(MPEG.subarray(0, 4)) == null, 'truncated prefix is not a cover')
const huge = new Uint8Array(10)
huge.set(ascii('ID3'))
huge[3] = 3
huge.set(Uint8Array.of(0x7f, 0x7f, 0x7f, 0x7f), 6) // 0x0fffffff
ok(id3TagTotalLength(huge) == null, 'impossible tag size is refused')

ok(readApic(writeApic(MPEG, PNG_1x1, 'image/png')).bytes[0] === 0x89, 'prefix-only read still finds APIC (library tile path)')

rejects(() => writeApic(MPEG, PNG_1x1, 'image/svg+xml'), /png or image\/jpeg/, 'SVG cover is refused')
rejects(() => writeApic(MPEG, new Uint8Array(0), 'image/png'), /empty/, 'empty cover is refused')
rejects(() => writeApic(cat(ascii('fLaC'), MPEG), PNG_1x1, 'image/png'), /MP3 only/, 'FLAC is not muxed')
rejects(() => writeApic(cat(ascii('ID3'), Uint8Array.of(0x03, 0x00, 0x00), syncsafe(4), new Uint8Array(4)), PNG_1x1, 'image/png'), /usable MP3/, 'tag-only file has no MPEG body')

const fat = new Uint8Array(MAX_STAR_BYTES - 80)
fat.set(MPEG, 0)
rejects(() => writeApic(fat, PNG_1x1, 'image/png'), /10 MB/, 'mux that would breach the star ceiling is refused')

if (fail) {
  console.log('\n  ' + fail + ' failed · ' + pass + ' passed\n')
  process.exit(1)
}
console.log('\n  ' + pass + ' passed\n')
