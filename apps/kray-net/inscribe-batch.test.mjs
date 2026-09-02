/**
 * Tray baptism helpers — the door guesses 01-indole.md → indole.
 * Consensus is unchanged: this never fuses inscribe + name.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'inscribe-batch.js'), 'utf8')
new Function(src)()
const B = globalThis.KrayInscribeBatch
if (!B) {
  console.error('KrayInscribeBatch did not load')
  process.exit(1)
}

let pass = 0
let fail = 0
function ok(c, m) {
  if (c) { pass++; console.log('   ✓ ' + m) }
  else { fail++; console.log('   ✗ ' + m) }
}

ok(B.stemKey('canon/01-indole.md') === 'indole', '01-indole.md → indole')
ok(B.guessBaptism('canon/01-indole.md') === 'indole', 'guess baptizes the twelve')
ok(B.guessBaptism('logos/k-disc-512.png') === '', 'hyphenated logo is not a name')
ok(B.guessBaptism('logos/bitcoin-mark.png') === '', 'bitcoin-mark is not a name')
ok(B.isBaptismName('indole') && !B.isBaptismName('tom.kray'), 'letters/digits only')
ok(B.isBaptismName('Indole') && !B.isBaptismName('indo le'), 'case folds; inner space refuses')
ok(B.spineGuessOnly([
  { path: 'canon/01-indole.md' },
  { path: 'canon/12-lightdoor.md' },
  { path: 'logos/k-disc-512.png' },
]), 'spine drop auto-baptizes even with a nameless logo')
ok(!B.spineGuessOnly([{ path: 'photo.png' }, { path: 'cat.png' }]), 'random photos do not auto-baptize')
ok(B.baptismCount([
  { path: '01-indole.md', baptism: 'indole' },
  { path: 'k-disc-512.png', baptism: '' },
]) === 1, 'empty word is content-only')

const dups = B.baptismPlan([
  { path: 'a.md', baptism: 'indole' },
  { path: 'b.md', baptism: 'Indole' },
])
ok(dups.dup.includes('indole'), 'duplicate identity (Indole / indole) is caught before fire')

function doorBlocked(queue, baptize) {
  if (!baptize || !queue.length) return false
  if (B.baptismTaken(queue).length) return true
  return queue.some((it) => {
    const st = B.baptismState(it)
    return st && !st.empty && !st.ok
  })
}
const tray = [
  { path: '01-indole.md', baptism: 'indole', taken: { star: '17' } },
  { path: '05-algorithm.md', baptism: 'algorithm' },
]
ok(doorBlocked(tray, true), 'a taken name locks the seal')
const afterX = tray.slice()
afterX.splice(0, 1)
ok(!doorBlocked(afterX, true) && afterX[0].path === '05-algorithm.md', '✕ splice drops the relic and unlocks the rest')
const split = B.dropTaken([
  { path: '01-indole.md', taken: { star: '17' } },
  { path: '05-algorithm.md', baptism: 'algorithm' },
  { path: '06-kray.md', taken: { star: '22' } },
])
ok(split.queue.length === 1 && split.queue[0].path === '05-algorithm.md' && split.dropped.length === 2, 'dropTaken keeps only free names')
ok(B.looksText('text/markdown', '01-indole.md') && !B.looksText('image/png', 'k.png'), 'markdown is text; a png is not')
ok(B.clipPreview('a'.repeat(900)).endsWith('…') && B.clipPreview('short') === 'short', 'preview clips long prose')
ok(B.previewOfBytes(new TextEncoder().encode('# Indole\n\nthe first star'), 'text/markdown', '01-indole.md').indexOf('Indole') >= 0,
  'bytes of a canon file become the tray preview')

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ''} — tray names stay a guess; the reducer still baptizes.\n`)
process.exit(fail ? 1 : 0)
