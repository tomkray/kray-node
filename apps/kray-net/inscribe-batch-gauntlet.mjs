/**
 * Adversarial gauntlet for the File-tab baptism tray.
 * Chrome only — never loads ledger / scheme / server.
 *
 *   node apps/kray-net/inscribe-batch-gauntlet.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'inscribe-batch.js'), 'utf8')
const css = readFileSync(join(here, 'kray.css'), 'utf8')
const html = readFileSync(join(here, 'inscribe.html'), 'utf8')
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
console.log('\n╔═ INSCRIBE TRAY GAUNTLET — chrome door, book untouched ═╗\n')

ok(!!B.dropTaken && !!B.baptismTaken && !!B.paint && !!B.seal, 'tray API is present')
ok(!/ledger\.ts|scheme\.ts/.test(src), 'batch module does not import the book')

function doorBlocked(queue, baptize) {
  if (!baptize || !queue.length) return false
  if (B.baptismTaken(queue).length) return true
  return queue.some((it) => {
    const st = B.baptismState(it)
    return st && !st.empty && !st.ok
  })
}

// ── X / dropTaken ──
const twelve = [
  { path: '01-indole.md', baptism: 'indole', taken: { star: '17' }, size: 100 },
  { path: '02-canon.md', baptism: 'canon', taken: { star: '18' }, size: 100 },
  { path: '05-algorithm.md', baptism: 'algorithm', size: 100 },
  { path: '11-consciousness.md', baptism: 'consciousness', size: 100 },
]
ok(doorBlocked(twelve, true), 'mixed tray locks the seal')
const oneX = twelve.slice()
oneX.splice(0, 1)
ok(doorBlocked(oneX, true), 'one remaining relic still locks')
const gone = B.dropTaken(twelve)
ok(gone.dropped.length === 2 && gone.queue.length === 2, 'dropTaken peels both relics')
ok(gone.queue.every((it) => !it.taken) && !doorBlocked(gone.queue, true), 'after dropTaken the seal unlocks')
ok(twelve.length === 4 && twelve[0].taken, 'dropTaken does not mutate the input tray')
ok(B.dropTaken([]).queue.length === 0 && B.dropTaken(null).dropped.length === 0, 'empty / null tray is a no-op')
ok(B.dropTaken(gone.queue).dropped.length === 0, 'a clean tray drops nothing')
ok(B.dropTaken(twelve.filter((it) => it.taken)).queue.length === 0, 'all-relic tray becomes empty')

const mid = [
  { path: 'a.md', baptism: 'freeone' },
  { path: 'b.md', baptism: 'indole', taken: { star: '1' } },
  { path: 'c.md', baptism: 'freetwo' },
]
mid.splice(1, 1)
ok(mid.map((it) => it.path).join(',') === 'a.md,c.md' && !doorBlocked(mid, true), '✕ in the middle keeps order and unlocks')

// ── proto pollution ──
const proto = Object.prototype
const hadTaken = Object.prototype.hasOwnProperty.call(proto, 'taken')
const prevTaken = proto.taken
proto.taken = { star: '999' }
try {
  const clean = [{ path: '05-algorithm.md', baptism: 'algorithm' }]
  ok(B.baptismTaken(clean).length === 0, 'inherited .taken is not a relic')
  ok(B.dropTaken(clean).queue.length === 1, 'dropTaken ignores prototype taken')
  ok(!doorBlocked(clean, true), 'door does not lock on inherited taken')
} finally {
  if (hadTaken) proto.taken = prevTaken
  else delete proto.taken
}

const hadBaptism = Object.prototype.hasOwnProperty.call(proto, 'baptism')
const prevBaptism = proto.baptism
proto.baptism = 'indole'
try {
  const guessed = B.baptismState({ path: '05-algorithm.md' })
  ok(guessed.name === 'algorithm', 'inherited .baptism does not steal the stem')
} finally {
  if (hadBaptism) proto.baptism = prevBaptism
  else delete proto.baptism
}

// ── name hostility ──
ok(!B.isBaptismName('indo le'), 'inner space refuses')
ok(!B.isBaptismName('tom.kray'), 'dot refuses')
ok(!B.isBaptismName('k-ray'), 'hyphen refuses')
ok(!B.isBaptismName('indole\u200b'), 'zero-width space refuses')
ok(!B.isBaptismName('indole\u202e'), 'RTL override refuses')
ok(!B.isBaptismName('\u00adindole'), 'soft hyphen refuses')
ok(!B.isBaptismName('a'.repeat(65)), '65 ASCII letters refuse')
ok(B.isBaptismName('a'.repeat(64)), '64 ASCII letters pass the door')
ok(B.isBaptismName('INDOLE') && B.baptismState({ baptism: 'INDOLE' }).name === 'indole', 'case folds to one identity')
ok(B.isBaptismName('İ') === false || B.baptismState({ baptism: 'İ' }).ok === false, 'Turkish İ is not a latin name')
ok(B.baptismState({ baptism: '  ' }).empty, 'whitespace-only is content-only')
ok(B.guessBaptism('logos/k-disc-512.png') === '', 'hyphenated logo is not a baptism')
ok(B.guessBaptism('01-indole.md') === 'indole', 'spine file still guesses')

const dups = B.baptismPlan([
  { path: 'a.md', baptism: 'Indole' },
  { path: 'b.md', baptism: 'indole' },
])
ok(dups.dup.includes('indole'), 'Indole / indole is one name')
ok(B.baptismPlan([{ path: 'a.md', baptism: 'nope!' }]).bad.length === 1, 'bad punctuation is refused before fire')

// ── seal backstop (fetch mocked — no writer) ──
const prevFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.includes('/name/indole')) {
    return { status: 200, ok: true, json: async () => ({ star: '17', name: 'indole' }) }
  }
  return { status: 404, ok: false, json: async () => ({ error: 'free' }) }
}
try {
  let refused = false
  try {
    await B.seal({
      from: 'bcrt1qgauntlet',
      queue: [{ path: '01-indole.md', name: '01-indole.md', baptism: 'indole', size: 12, type: 'text/markdown', b64: 'YQ==' }],
      baptize: true,
      extra: {},
      sign: () => '00',
    })
  } catch (e) {
    refused = /already baptized/.test(String(e && e.message))
  }
  ok(refused, 'seal refuses a taken name before any prepare-batch')

  let unlocked = false
  const rest = B.dropTaken([
    { path: '01-indole.md', baptism: 'indole', taken: { star: '17' }, size: 12, type: 'text/plain', b64: 'YQ==' },
    { path: '05-algorithm.md', baptism: 'algorithm', size: 12, type: 'text/plain', b64: 'YQ==' },
  ]).queue
  ok(!doorBlocked(rest, true), 'dropped relics leave a free plan')
  try {
    await B.seal({
      from: 'bcrt1qgauntlet',
      queue: rest,
      baptize: true,
      extra: {},
      sign: () => { throw new Error('sign-not-reached-if-name-taken') },
    })
  } catch (e) {
    unlocked = !/already baptized/.test(String(e && e.message))
  }
  ok(unlocked, 'seal does not trip unique-relic after dropTaken (fetch 404)')
} finally {
  if (prevFetch) globalThis.fetch = prevFetch
  else delete globalThis.fetch
}

// ── paint XSS / overflow ──
function fakeHost() {
  return { hidden: true, innerHTML: '', querySelectorAll() { return [] } }
}
const host = fakeHost()
B.paint(host, [{
  path: '"><img src=x onerror=alert(1)>.md',
  name: '<script>alert(1)</script>',
  baptism: 'indole',
  taken: { star: '17' },
  size: 100,
  type: 'text/markdown',
  folder: '<svg onload=alert(1)>',
}], function () {}, { baptize: true, onDropTaken: function () {}, faceFirst: true })
ok(host.hidden === false, 'a loaded tray is visible')
ok(!/<script>/i.test(host.innerHTML) && !/<img /i.test(host.innerHTML) && /&lt;script&gt;/.test(host.innerHTML),
  'paint escapes path / name / folder — no raw HTML')
ok(/class="ibatch-card[^"]*\btaken\b/.test(host.innerHTML), 'taken card wears the taken class')
ok(/ibatch-drop-taken/.test(host.innerHTML) && /Drop 1 already baptized/.test(host.innerHTML),
  'drop-all control appears when a relic is on the tray')
ok(/already baptized · #17/.test(host.innerHTML), 'taken plate prints the living star number')
ok(!/size="/.test(host.innerHTML), 'baptism input has no native size= that bursts the card')

const freeHost = fakeHost()
B.paint(freeHost, [{
  path: '05-algorithm.md',
  name: '05-algorithm.md',
  baptism: 'algorithm',
  size: 50,
  type: 'text/markdown',
}], function () {}, { baptize: true, onDropTaken: function () {} })
ok(!/ibatch-drop-taken/.test(freeHost.innerHTML) && /ibatch-card/.test(freeHost.innerHTML) && !/ibatch-card taken/.test(freeHost.innerHTML),
  'a free name has no drop-all button and no taken class')

B.paint(host, [], null, {})
ok(host.hidden === true && host.innerHTML === '', 'empty tray hides the plate')
B.paint(null, twelve, null, { baptize: true })
ok(true, 'paint(null) is a defined no-op')

const longHost = fakeHost()
B.paint(longHost, [{
  path: '11-consciousness.md',
  name: '11-consciousness.md',
  baptism: 'consciousness',
  size: 1,
  type: 'text/markdown',
}], function () {}, { baptize: true })
ok(/value="consciousness"/.test(longHost.innerHTML), 'consciousness is not chopped by size=10')

const srcHost = fakeHost()
B.paint(srcHost, [{
  path: '01-indole.md',
  name: '01-indole.md',
  type: 'text/markdown',
  preview: '# Indole\n<script>alert(1)</script>\nthe first star',
  baptism: 'indole',
  size: 40,
}], function () {}, { baptize: true })
ok(/ibatch-src/.test(srcHost.innerHTML) && /# Indole/.test(srcHost.innerHTML) && /&lt;script&gt;/.test(srcHost.innerHTML) && !/<script>/i.test(srcHost.innerHTML),
  'the card shows the file prose escaped — never raw HTML')
ok(B.looksText('text/markdown', '01-indole.md') && B.previewOfBytes(new Uint8Array([0, 0, 0, 0, 1]), 'text/plain', 'x.txt') === '',
  'NUL-heavy bytes stay a diamond, not a fake poem')

// ── merge / waves / burns ──
const merged = B.mergeQueue(
  [{ path: 'a.md', sha: 'aa', size: 10 }],
  [{ path: 'a.md', sha: 'bb', size: 10 }, { path: 'b.md', sha: 'aa', size: 10 }, { path: 'c.md', sha: 'cc', size: 10 }],
)
ok(merged.queue.length === 2 && merged.skipped.length === 2, 'same path or same bytes do not double the tray')
ok(B.blockedOf([{ path: 'x', blocked: true }, { path: 'y' }]).length === 1, 'blockedOf sees only own blocked')
ok(B.burnsOf([{ size: 1 }, { size: 10000 }], 10000) === 2, 'tiny + 10KB = 2 ₭ fire')
ok(B.baptismCount(twelve) === 4 && B.baptismCount(gone.queue) === 2, 'baptismCount follows the live tray')

// ── CSS / door wiring ──
ok(/padding:var\(--s4\)/.test(css) && /\.ibatch-card\{[^}]*padding:var\(--s4\)/.test(css.replace(/\s+/g, '')),
  'cards inset on the 16px token')
ok(/\.ibatch-taken\{[^}]*background:var\(--crit\)/.test(css.replace(/\s+/g, '')), 'taken plate is a crit fill, not pale ink')
ok(/\.ibatch-src\{/.test(css), 'the card plate has a source preview style')
ok(/minmax\(208px,1fr\)/.test(css), 'named grid is wide enough for consciousness')
ok(/data-drop-taken/.test(src) && /onDropTaken/.test(html), 'drop-all is wired in paint and on the File tab')
ok(/B\.baptismTaken\(fileQueue\)/.test(html), 'the File tab locks on baptismTaken, not inherited .taken')
ok(/chrome rite/.test(readFileSync(join(here, '../../scripts/operator/sync-vitrine-chrome.sh'), 'utf8')) || /vitrine/.test(readFileSync(join(here, '../../scripts/operator/sync-vitrine-chrome.sh'), 'utf8')),
  'vitrine rite script is still the chrome door')

console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — tray chrome survived the gauntlet. Book untouched. ═╝\n`)
process.exit(fail ? 1 : 0)
