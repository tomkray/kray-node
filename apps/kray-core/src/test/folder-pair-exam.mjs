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
  URL,
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

console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — folder organizes itself ₭\n`)
process.exit(fail ? 1 : 0)
