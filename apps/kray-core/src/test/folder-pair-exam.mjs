/**
 * Folder pair — content + sidecar JSON become one star body + document.
 * Runs against the official explorer File helper (no node, no journal).
 *
 *   node src/test/folder-pair-exam.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const BATCH = join(here, '../../../kray-net/inscribe-batch.js')
const require = createRequire(import.meta.url)
const { File } = require('node:buffer')

const ctx = {
  window: {},
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  TextEncoder,
  TextDecoder,
  crypto: webcrypto,
  URL: Object.assign(URL, {
    createObjectURL: URL.createObjectURL || (() => 'blob:exam'),
    revokeObjectURL: URL.revokeObjectURL || (() => {}),
  }),
  File,
  console,
}
ctx.globalThis = ctx.window
vm.runInNewContext(readFileSync(BATCH, 'utf8'), ctx, { filename: 'inscribe-batch.js' })
const B = ctx.window.KrayInscribeBatch
if (!B) {
  console.error('✗ KrayInscribeBatch missing')
  process.exit(1)
}

function f(name, body, folder) {
  const file = new File([body], name, { type: name.endsWith('.json') ? 'application/json' : 'text/plain' })
  const rel = folder ? folder + '/' + name : name
  try { Object.defineProperty(file, 'webkitRelativePath', { value: rel }) } catch { file.__rel = rel }
  return file
}

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }

const files = [
  f('cover.png', 'PNGBYTES', 'drop'),
  f('cover.json', '{"name":"Cover","n":1}', 'drop'),
  f('a.txt', 'hello-a', 'drop/kids'),
  f('a.json', '{"name":"A"}', 'drop/kids'),
  f('b.txt', 'hello-b', 'drop/kids'),
  f('loose.json', '{"solo":true}', 'drop'),
  f('.DS_Store', 'junk', 'drop'),
]

const got = await B.ingest(files)
const names = got.items.map((it) => it.name).sort()
ok(got.items.length === 4, `organized ${got.items.length} stars (cover + a + b + loose json)`)
ok(names.includes('cover.png') && names.includes('a.txt') && names.includes('b.txt') && names.includes('loose.json'), 'relics kept, junk out')
const cover = got.items.find((it) => it.name === 'cover.png')
ok(cover && cover.sidecar === 'cover.json' && /Cover/.test(cover.meta || ''), 'cover.png seated its sidecar JSON')
const a = got.items.find((it) => it.name === 'a.txt')
ok(a && a.sidecar === 'a.json', 'kids/a.txt seated a.json')
const b = got.items.find((it) => it.name === 'b.txt')
ok(b && !b.sidecar, 'kids/b.txt has no sidecar — own star')
ok(got.skipped.some((s) => /DS_Store/.test(s.path)), '.DS_Store skipped')
ok(B.burnsOf(got.items, 1000000) === 4, 'cost is 4 ₭ — one per star, no discount')

function bare(name, type) {
  return new File([new Uint8Array(12)], name, { type: type || '' })
}
ok(B.mimeOf(bare('track.mp3')) === 'audio/mpeg', 'empty-type .mp3 → audio/mpeg')
ok(B.mimeOf(bare('song.wav', 'application/octet-stream')) === 'audio/wav', 'octet .wav → audio/wav')
ok(B.mimeOf(bare('clip.mp4')) === 'video/mp4', 'empty-type .mp4 → video/mp4')
ok(B.mimeOf(bare('figure.gltf', 'application/json')) === 'model/gltf+json', '.gltf is a model, not a JSON sidecar')
ok(B.mimeOf(bare('figure.glft')) === 'model/gltf+json', '.glft typo still maps to glTF')
ok(B.mimeOf(bare('mesh.glb')) === 'model/gltf-binary', '.glb → model/gltf-binary')
ok(B.mimeOf(bare('photo.png', 'image/png')) === 'image/png', 'real image type stays')

const staged = B.stage([
  new File([new Uint8Array(145740)], 'drop.wav', { type: '' }),
  new File([new Uint8Array(12_000_000)], 'film.mp4', { type: '' }),
])
const wav = staged.items.find((it) => it.name === 'drop.wav')
const film = staged.items.find((it) => it.name === 'film.mp4')
ok(wav && wav.size === 145740 && wav.type === 'audio/wav' && !wav.sha, 'stage quotes wav size before hash')
ok(B.burnsOf([wav], 10000) === 15, '145740 B @ 10 KB/₭ = 15 fire')
ok(film && film.blocked === 'over' && film.size === 12_000_000, '12 MB mp4 stays visible as OVER — not a silent skip')
ok(staged.skipped.some((s) => /film\.mp4/.test(s.path)), 'over-ceiling is named on the skip note')

ok(Array.isArray(B.SKELETON) && B.SKELETON[0] === 'indole' && B.SKELETON[1] === 'canon' && B.SKELETON.length === 12, 'spine is the twelve — filename is the name, list is the when')
const numbered = [
  f('05-algorithm.md', '4', 'canon'),
  f('12-lightdoor.md', '11', 'canon'),
  f('02-canon.md', '1', 'canon'),
  f('01-indole.md', '0', 'canon'),
  f('03-foundation.md', '2', 'canon'),
  f('14-donation.md', 'd', 'later'),
  f('13-satoshi.md', 's', 'later'),
]
const byName = B.organize(numbered).files.map((x) => x.name)
ok(JSON.stringify(byName) === JSON.stringify([
  '01-indole.md', '02-canon.md', '03-foundation.md', '05-algorithm.md',
  '12-lightdoor.md', '13-satoshi.md', '14-donation.md',
]), '01-indole then 02-canon — the filename number is the birth order')

console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — folder organizes itself ₭\n`)
process.exit(fail ? 1 : 0)
