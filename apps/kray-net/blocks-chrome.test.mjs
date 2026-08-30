/**
 * /blocks chrome must parse. A premature object close kills the whole IIFE:
 * the strip stays on "reading the chain…" and the constellation never boots.
 *   node apps/kray-net/blocks-chrome.test.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'blocks.html'), 'utf8')
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim()).filter(Boolean)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

ok(scripts.length >= 1, 'blocks.html has an inline script')
ok(!/color:col,\s*\}/.test(html), 'block node object is not closed after color')
for (let i = 0; i < scripts.length; i++) {
  try { new Script(scripts[i]); ok(true, 'inline script[' + i + '] parses') }
  catch (e) { ok(false, 'inline script[' + i + '] — ' + (e instanceof Error ? e.message : e)) }
}

console.log(fail ? ('FAIL ' + fail + '/' + (pass + fail)) : ('ok  ' + pass + '/' + (pass + fail) + '  blocks chrome parses'))
if (fail) process.exit(1)
