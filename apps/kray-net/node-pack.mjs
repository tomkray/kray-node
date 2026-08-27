/**
 * Pack the KRAYNET *source tree* a follower may write onto their clone.
 * Never packs journal, atlas, pot keys, operator maps, or node_modules.
 * The zip is what /validate "Update my node folder" writes — code only.
 */
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'

const SKIP_DIR = new Set([
  '.git', 'node_modules', 'follower', 'follower-main', 'ops', 'devnet', 'devnet-wallet',
  'guardian-atlas', 'logs', '.cursor', 'archive',
  // workshop — stays on the operator working tree, never the public clone or zip
  'exam', 'lab',
  // operator run-layer (cloudflared, launchd, writer wrappers) — gitignored AND unzipped
  'bin',
  // private scroll — keep on disk, never the public door or /validate zip
  'manifesto',
  // external tenant bridges — other houses, not the public node
  'adapter',
])
/** Operator-only universes at the repo root — never the public `networks/signet` recipes. */
const SKIP_ROOT = new Set(['signet', 'regtest', 'testnet', 'mainnet'])
const SKIP_PREFIX = [
  'apps/kray-api/', 'apps/kray-net/data', 'apps/kray-net/regtest-harness/',
  'apps/kray-net/signet-harness/', 'apps/kray-net/archive/', 'gauntlet-',
  'data-archive-', 'data-signet-local/', 'data-backup-',
]
const SKIP_FILE = new Set([
  '.ds_store', 'vault-keys.env', 'owner.box', 'node-hot.env', '.kray-sync-rev',
  // era leftovers on an additive vitrine disk — never ship them in the official zip
  'v2.html', 'kray-v2.js', 'kray-v2.css',
  // workshop shims + this-operator deploy — not a stranger's door
  'gauntlet.mjs', 'grand-exam.mjs', 'swarm-exam.mjs', 'eternal-exam.mjs',
  'final-check.mjs', 'library-sim.mjs', 'send-laws.mjs', 'rune-proof.mjs',
  'rune-diff.mjs', 'siege.mjs', 'speed-guard.mjs',
  'testnode.mjs', 'devnet.mjs', 'devnet-wallet.mjs', 'signet.mjs',
  'lab-data.mjs', 'btc-heartbeat.mjs', 'harness.md', 'travel.md',
  'sync-vitrine.sh', 'open-pot-tunnel.sh', 'point-vitrine-hot.sh',
  'workshop.md',
  '.oss-guard-local',
])

export function shouldPackPath(rel) {
  const p = String(rel || '').replace(/\\/g, '/')
  const parts = p.split('/').filter(Boolean)
  const base = (parts[parts.length - 1] || '').toLowerCase()
  // operator handoff (house names, deploy rite) — disk only
  if (parts[0] === 'docs' && base.startsWith('handoff-')) return false
  if (SKIP_FILE.has(base) || base.endsWith('.log') || base.endsWith('.redb')) return false
  if (base.endsWith('.bak') || base.includes('.bak-') || base.includes('.bak.')) return false
  if (parts[0] && SKIP_ROOT.has(parts[0])) return false
  if (parts.some((seg) => SKIP_DIR.has(seg))) return false
  if (SKIP_PREFIX.some((pre) => p === pre.slice(0, -1) || p.startsWith(pre))) return false
  return true
}

function skipRel(rel) {
  return !shouldPackPath(rel)
}

function walk(dir, root, out) {
  let names
  try { names = readdirSync(dir) } catch { return }
  for (const name of names) {
    const full = join(dir, name)
    const rel = relative(root, full).replace(/\\/g, '/')
    if (skipRel(rel)) continue
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) { walk(full, root, out); continue }
    if (!st.isFile() || st.size > 8 * 1024 * 1024) continue
    out.push({ name: rel, data: readFileSync(full) })
  }
}

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  }
  return (c ^ 0xffffffff) >>> 0
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }

function zipStore(files) {
  const locals = [], centrals = []
  let offset = 0
  for (const f of files) {
    const raw = f.data
    const deflated = deflateRawSync(raw)
    const crc = crc32(raw)
    const nameBuf = Buffer.from(f.name, 'utf8')
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
      u32(crc), u32(deflated.length), u32(raw.length), u16(nameBuf.length), u16(0),
      nameBuf, deflated,
    ])
    locals.push(local)
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
      u32(crc), u32(deflated.length), u32(raw.length), u16(nameBuf.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf,
    ]))
    offset += local.length
  }
  const central = Buffer.concat(centrals)
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(offset), u16(0),
  ])
  return Buffer.concat([...locals, central, end])
}

function commitOf(root) {
  const stamp = join(root, '.kray-sync-rev')
  if (existsSync(stamp)) {
    const s = readFileSync(stamp, 'utf8').trim().slice(0, 40)
    if (/^[0-9a-f]{7,40}$/i.test(s)) return s.toLowerCase()
  }
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 2000 }).trim().toLowerCase()
  } catch { return 'running' }
}

let cache = null
let headSeen = { at: 0, v: null }

// How long a HEAD reading is trusted before re-checking, so a polled version
// endpoint never spawns git per request. Overridable (0 in tests); default 5s.
const HEAD_TTL_MS = Number(process.env.KRAY_PACK_HEAD_TTL_MS ?? 5000)

// Re-read the checked-out commit, throttled. The pack (an in-memory zip of the
// whole tree) is then rebuilt ONLY when HEAD actually moved — so /downloads and
// /api/node-version always follow the latest pushed commit the operator has
// checked out, with no node restart. commitOf falls back to `git rev-parse HEAD`
// when no sync stamp is present, which is the writer's case.
function headNow(root) {
  const now = Date.now()
  if (headSeen.v && now - headSeen.at < HEAD_TTL_MS) return headSeen.v
  headSeen = { at: now, v: commitOf(root) }
  return headSeen.v
}

export function packNodeTree(repoRoot) {
  const head = headNow(repoRoot)
  if (cache && cache.v === head) return cache
  const files = []
  walk(repoRoot, repoRoot, files)
  files.sort((a, b) => (a.name < b.name ? -1 : 1))
  const zip = zipStore(files)
  const sha256 = createHash('sha256').update(zip).digest('hex')
  cache = {
    zip,
    sha256,
    bytes: zip.length,
    files: files.length,
    v: head,
    zip_path: '/downloads/kray-node.zip',
  }
  return cache
}

export const OFFICIAL_REPO = 'https://github.com/tomkray/kray-node'
export const OFFICIAL_BRANCH = 'main'

export function nodeVersionView(repoRoot) {
  const p = packNodeTree(repoRoot)
  return {
    v: p.v,
    sha256: p.sha256,
    bytes: p.bytes,
    files: p.files,
    zip: p.zip_path,
    repo: OFFICIAL_REPO,
    branch: OFFICIAL_BRANCH,
  }
}
