/**
 * THE MOUTH MUST PARSE — every explorer HTML inline script, or the page lies
 * ("reading the chain…" forever). The constellation paints donate from the
 * book's selfAnchor field, never a second clock.
 *   node apps/kray-net/blocks-chrome.test.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const pages = readdirSync(here).filter((n) => n.endsWith('.html')).sort()

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

let scripts = 0
for (const name of pages) {
  const html = readFileSync(join(here, name), 'utf8')
  const found = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim()).filter(Boolean)
  for (let i = 0; i < found.length; i++) {
    try { new Script(found[i]); scripts++ }
    catch (e) { ok(false, name + '[' + i + '] — ' + (e instanceof Error ? e.message : e)) }
  }
}
ok(pages.includes('blocks.html'), 'the constellation page is in the mouth set')
ok(scripts >= 30 && fail === 0, 'every explorer inline script parses (' + scripts + ')')

const blocks = readFileSync(join(here, 'blocks.html'), 'utf8')
ok(!/color:col,\s*\}/.test(blocks), 'block node object is not closed after color')
ok(/var donate=!!b\.selfAnchor/.test(blocks), 'constellation donate hue reads the book field selfAnchor')
ok(/var sealed=!!\(b\.verified\|\|b\.simulated\)/.test(blocks), 'gold is verified-or-simulated — Bitcoin burial, not a CSS lie')
ok(/kind:'chain'/.test(blocks), 'fast-block chain edges are drawn — chronology, not loose dots')
ok(/seals:\(w\.seals\|\|\[\]\)/.test(blocks), 'constellation consumes /world.seals — one neuron per Bitcoin donate')
ok(/KEEP IN LOCKSTEP with neuron-seals\.mjs/.test(blocks), 'master ranges stay locked to the shared spine')

const door = readFileSync(join(here, 'server.mjs'), 'utf8')
ok(/from '\.\/seal-chronology\.mjs'/.test(door), 'the door imports the shared seal clock')
ok(/sortPendingSeals\(pending\)/.test(door), 'missing seals journal in Bitcoin-height order from the shared clock')
ok(/donateSealAtOf\(selfAnchors\.values\(\), anchors, blockNumber\)/.test(door), 'donate cube tag is the shared donateSealAt')

console.log(fail ? ('FAIL ' + fail + '/' + (pass + fail)) : ('ok  ' + pass + '/' + (pass + fail) + '  explorer mouth parses · paint follows the book'))
if (fail) process.exit(1)
