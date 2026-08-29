/**
 * ID3 COVER SWARM — prove by breaking, then by hashing.
 *
 *   node apps/kray-net/id3-cover-swarm.test.mjs
 *
 * Mathematical pins (SHA-256 identity):
 *   sha256(mpegBody(musicRelic(mp3, cover))) === sha256(mpegBody(mp3))
 *   sha256(readApic(relic).bytes) === sha256(cover)
 *   same inputs → same relic hash (pure function)
 *   MPEG-1 L3 bitrate nibble survives (320 stays 320)
 *
 * Adversarial: foreign containers, SVG, empty, tag-only, ceiling, truncated,
 * parallel unique relics, rewrite-APIC-twice. No encoder. No reducer. No Signet.
 */
import { createHash } from 'node:crypto'
import {
  musicRelic, mpegBody, readApic, mpeg1L3BitrateKbps, isMp3, id3TagTotalLength,
  MAX_STAR_BYTES,
} from './id3-cover.js'

const N = 64
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; return } fail++; console.log('  ✗ FAIL — ' + m) }
const sha = (b) => createHash('sha256').update(b).digest('hex')
const same = (a, b) => a && b && a.length === b.length && sha(a) === sha(b)

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

/** MPEG-1 Layer III, 320 kbps, 44100 Hz — header only + unique payload. */
function mpeg320(tag) {
  const pay = createHash('sha256').update('mpeg320|' + tag).digest()
  return Uint8Array.from([0xff, 0xfb, 0xe0, 0x00, ...pay])
}

function coverOf(tag) {
  return Uint8Array.from([...PNG, ...createHash('sha256').update('cover|' + tag).digest()])
}

function refuses(fn, re) {
  try { fn(); return false }
  catch (e) { return re.test(String(e && e.message)) }
}

console.log('\n╔═ ID3 COVER SWARM — SHA-256 identity · 320 · hostility ═╗\n')

ok(mpeg1L3BitrateKbps(mpeg320('probe')) === 320, 'crafted frame reads as 320 kbps')

const hashes = new Set()
for (let i = 0; i < N; i++) {
  const src = mpeg320('body-' + i)
  const art = coverOf('art-' + i)
  const relic = musicRelic(src, art, 'image/png')
  const body = mpegBody(relic)
  const apic = readApic(relic)
  ok(sha(body) === sha(src), 'swarm[' + i + '] MPEG sha256 unchanged')
  ok(apic && sha(apic.bytes) === sha(art), 'swarm[' + i + '] APIC sha256 is the cover')
  ok(mpeg1L3BitrateKbps(relic) === 320, 'swarm[' + i + '] bitrate nibble still 320')
  ok(sha(musicRelic(src, art, 'image/png')) === sha(relic), 'swarm[' + i + '] musicRelic is deterministic')
  hashes.add(sha(relic))
}
ok(hashes.size === N, N + ' unique relics — no collision from unique MPEG bodies')

const a = mpeg320('det')
const c = coverOf('det')
ok(sha(musicRelic(a, c, 'image/png')) === sha(musicRelic(a, c, 'image/png')), 'same inputs → same relic hash')
const once = musicRelic(a, c, 'image/png')
const twice = musicRelic(once, coverOf('second'), 'image/png')
ok(sha(mpegBody(twice)) === sha(a), 'second APIC rewrite still leaves MPEG sha256')
ok(sha(readApic(twice).bytes) === sha(coverOf('second')), 'second cover replaces the first')

const parallel = Array.from({ length: N }, (_, i) => {
  const src = mpeg320('par-' + i)
  const art = coverOf('par-' + i)
  return { src, art, relic: musicRelic(src, art, 'image/png') }
})
ok(parallel.every((x) => sha(mpegBody(x.relic)) === sha(x.src) && sha(readApic(x.relic).bytes) === sha(x.art)),
  'parallel construction: every pair is MPEG-identical and APIC-exact')

ok(refuses(() => musicRelic(mpeg320('x'), PNG, 'image/svg+xml'), /png, image\/jpeg, or image\/gif/), 'SVG cover refused')
ok(refuses(() => musicRelic(mpeg320('x'), new Uint8Array(0), 'image/png'), /empty/), 'empty cover refused')
ok(refuses(() => musicRelic(Uint8Array.from([0x52, 0x49, 0x46, 0x46, ...mpeg320('w')]), PNG, 'image/png'), /MP3 only/), 'WAV/RIFF refused')
ok(refuses(() => musicRelic(Uint8Array.from([0x66, 0x4c, 0x61, 0x43, ...mpeg320('f')]), PNG, 'image/png'), /MP3 only/), 'FLAC refused')
ok(refuses(() => musicRelic(Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]), PNG, 'image/png'), /MP3 only/), 'M4A/ftyp refused')
ok(!isMp3(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]), 'x.mp3', 'audio/mpeg'), 'named .mp3 but RIFF is not music')
ok(id3TagTotalLength(Uint8Array.of(0x49, 0x44, 0x33, 3, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f)) == null, 'hostile tag size is not a cover')
ok(readApic(mpeg320('bare')) == null, 'bare 320 has no APIC — File tab would seal it as-is')

const fat = new Uint8Array(MAX_STAR_BYTES - 40)
fat.set(mpeg320('fat'), 0)
ok(refuses(() => musicRelic(fat, PNG, 'image/png'), /10 MB/), 'star ceiling fail-closes before a lie is sealed')

if (fail) {
  console.log('\n  ' + fail + ' failed · ' + pass + ' passed\n')
  process.exit(1)
}
console.log('  ' + pass + ' passed · ' + N + '× MPEG sha256 identity · 320 nibble holds · hostility refused\n')
