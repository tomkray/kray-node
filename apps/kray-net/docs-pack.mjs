/**
 * Public /docs pack for the Mind.
 * Reads only this clone's docs/*.md (and canon). Never env, never vault, never journal.
 * GET /docs/pack.json — the mouth fetches this. No user secret ever enters this file.
 */
import { readdirSync, readFileSync, existsSync, statSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DOCS = join(ROOT, 'docs')
const CANON_DIR = join(ROOT, 'apps', 'kray-net', 'canon')
const CANON = join(CANON_DIR, 'CANON.md')
const SKELETON = [
  'indole', 'canon', 'foundation', 'divine', 'algorithm', 'kray',
  'bitcoin', 'fenyx', 'consensus', 'diretriz', 'consciousness', 'lightdoor',
]

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/
const SECRET_LINE = /rpcpassword|private[_ -]?key|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE|vault-keys|node-hot\.env/i
/** Operator / handoff notes may sit on a backup disk. Never a public mouth. */
const PACK_SKIP = /^(operator-ship|handoff([.-].*)?)$/i

function slugOf(name) {
  return String(name || '').replace(/\.md$/i, '').toLowerCase()
}

function scrub(text) {
  return String(text || '')
    .split('\n')
    .map((line) => (SECRET_LINE.test(line) ? '[redacted]' : line))
    .join('\n')
}

function under(dir, abs) {
  try {
    const root = realpathSync(dir)
    const real = realpathSync(abs)
    return real === root || real.startsWith(root + '/')
  } catch {
    return false
  }
}

function readNamed(abs, id, title, path) {
  if (!existsSync(abs) || !statSync(abs).isFile()) return null
  const text = scrub(readFileSync(abs, 'utf8'))
  if (!text.trim()) return null
  return { id, title, path, bytes: text.length, text }
}

export function docsFile(slug) {
  const want = slugOf(String(slug || ''))
  if (!SLUG_RE.test(want) || PACK_SKIP.test(want)) return null
  if (SKELETON.includes(want)) {
    const abs = want === 'canon' ? CANON : join(CANON_DIR, want + '.md')
    if (existsSync(abs) && under(CANON_DIR, abs)) {
      return readNamed(abs, want, want, '/docs/' + want + '.md')
    }
  }
  if (!existsSync(DOCS)) return null
  let hit = null
  for (const name of readdirSync(DOCS)) {
    if (!name.toLowerCase().endsWith('.md')) continue
    if (slugOf(name) === want) { hit = name; break }
  }
  if (!hit) return null
  const abs = join(DOCS, hit)
  if (!under(DOCS, abs)) return null
  return readNamed(abs, slugOf(hit), hit.replace(/\.md$/i, ''), '/docs/' + slugOf(hit) + '.md')
}

let cache = { t: 0, pack: null }

export function docsPack() {
  const now = Date.now()
  if (cache.pack && now - cache.t < 60_000) return cache.pack
  const files = []
  const seen = new Set()
  for (const name of SKELETON) {
    const f = docsFile(name)
    if (f && !seen.has(f.id)) { files.push(f); seen.add(f.id) }
  }
  if (existsSync(DOCS)) {
    const names = readdirSync(DOCS).filter((n) => n.toLowerCase().endsWith('.md')).sort((a, b) => a.localeCompare(b))
    for (const name of names) {
      const f = docsFile(slugOf(name))
      if (f && !seen.has(f.id)) { files.push(f); seen.add(f.id) }
    }
  }
  const pack = { v: 1, kind: 'kray-docs', n: files.length, files }
  cache = { t: now, pack }
  return pack
}

export const DOCS_CORE = [
  'indole', 'canon', 'kray', 'consciousness', 'foundation',
  'axioms', 'book-and-apps', 'krayos-mind', 'run-node', 'folder-law',
  'tokenomics', 'security', 'contracts', 'consensus-constitution',
]

export function docsPick(files, query, budget) {
  const list = Array.isArray(files) ? files : []
  const cap = Math.max(4000, Number(budget) || 28000)
  const q = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
  const core = new Set(DOCS_CORE)
  const scored = list.map((f) => {
    const id = String(f && f.id || '')
    const body = String(f && f.text || '')
    let score = core.has(id) ? 1000 : 0
    const hay = (id + ' ' + String(f && f.title || '') + ' ' + body.slice(0, 2000)).toLowerCase()
    for (const w of q) if (hay.includes(w)) score += 8
    return { f, score }
  }).sort((a, b) => b.score - a.score)

  const out = []
  let used = 0
  for (const row of scored) {
    const id = row.f.id
    const title = row.f.title || id
    const chunk = '## ' + id + '\n' + String(row.f.text || '').trim()
    if (used && used + chunk.length > cap) continue
    if (!used && chunk.length > cap) {
      out.push(chunk.slice(0, cap))
      used = cap
      break
    }
    out.push(chunk)
    used += chunk.length + 2
    if (used >= cap) break
  }
  return { text: out.join('\n\n'), n: out.length, used }
}
