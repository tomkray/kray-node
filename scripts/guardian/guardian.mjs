#!/usr/bin/env node
/**
 * BE A GUARDIAN — one command, any computer, primed and mining.
 *
 *   node scripts/guardian.mjs [nodeUrl]        (default: http://localhost:4477)
 *
 * The paradigm every other network imposes: days of chain sync, hundreds of GB, dedicated
 * hardware — BEFORE you may participate. KRAYNET inverts it. This command:
 *
 *   1 · MEASURES your machine (cores, RAM, free disk) — nothing is assumed;
 *   2 · asks the node how big the network's ATLAS is (every inscribed content, the bytes
 *       a master guardian keeps) and projects the worst case honestly;
 *   3 · PICKS YOUR TIER from what actually fits:
 *         · atlas fits  → MASTER GUARDIAN: download + verify every content (sha256 against
 *           the journaled consensus hash — a lying server cannot feed junk), custody proven
 *           every seal → up to 3× the reward;
 *         · tight disk  → LIGHT GUARDIAN: pure presence mining, base 1× — custody only ever
 *           ADDS, it is never a barrier;
 *   4 · starts the miner (kray-miner.mjs) already wired: beats bound to the Bitcoin beacon,
 *       signed by your own key, paid from the fee pool by PROVEN work — linear, sybil-neutral.
 *
 * Identity: set KRAY_MINER_SK (64-hex) only for a DEDICATED miner key — never the daily
 * KrayWallet spend key. Easy 3× is /validate → Hold the library (key stays in the wallet).
 * Unset, a deterministic demo identity is used (fine for the bench, NOT for real earning).
 */
import os from 'node:os'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NODE = (process.argv[2] || process.env.KRAY_NODE || 'http://localhost:4477').replace(/\/+$/, '')
const ATLAS_DIR = process.env.KRAY_ATLAS_DIR || join(process.cwd(), 'guardian-atlas')
const j = async (p) => { try { const r = await fetch(NODE + p, { signal: AbortSignal.timeout(6000) }); return r.ok ? r.json() : null } catch { return null } }
const gb = (n) => (n / 1e9).toFixed(1) + ' GB'
const line = (s = '') => console.log('  ' + s)

console.log('\n⛏  BE A GUARDIAN — measuring, priming, mining\n')

// ── 1 · the machine, measured ──────────────────────────────────────────────
const cores = os.cpus().length
const ram = os.totalmem()
let diskFree = 0
try { const out = execFileSync('df', ['-k', process.cwd()], { encoding: 'utf8' }).trim().split('\n').pop().split(/\s+/); diskFree = Number(out[3]) * 1024 } catch { /* unknown → treated as tight */ }
line(`machine: ${cores} cores · ${gb(ram)} RAM · ${gb(diskFree)} free disk`)

// ── 2 · the network, asked ─────────────────────────────────────────────────
const st = await j('/api/state')
if (!st) { console.error(`\n✗ no KRAYNET node answering at ${NODE} — pass its URL: node scripts/guardian.mjs http://host:4477\n`); process.exit(1) }
const atlas = await j('/api/kraynet/atlas')
const info = await j('/api/kraynet/donation/info')
const contents = (atlas && atlas.contents) || []
const contentMax = (info && info.contentMax) || 400000
const atlasWorstCase = contents.length * contentMax          // every content at the max size — honest ceiling
let atlasHeld = 0
try { if (existsSync(ATLAS_DIR)) for (const f of readdirSync(ATLAS_DIR)) atlasHeld += statSync(join(ATLAS_DIR, f)).size } catch { /* fresh */ }
line(`network: ${st.network} · supply ${st.supply.circulating} ₭ · ${st.starCount} star(s)`)
line(`atlas: ${contents.length} content(s) · worst case ${gb(atlasWorstCase)} · you already hold ${gb(atlasHeld)}`)

// ── 3 · the tier, picked from what FITS (custody adds, never bars) ─────────
const custodyFits = diskFree > atlasWorstCase * 2            // 2× headroom — never brick a disk
const tier = custodyFits ? 'MASTER (custody → up to 3×)' : 'LIGHT (presence → 1×, zero download)'
line(`tier: ${tier}`)
if (custodyFits && contents.length) { mkdirSync(ATLAS_DIR, { recursive: true }); line(`atlas dir: ${ATLAS_DIR} (each byte verified against the journaled hash before guarding)`) }
if (!custodyFits) line(`(free ${gb(atlasWorstCase * 2)}+ and rerun to upgrade — the atlas is the 3× door)`)

// ── 4 · mine — already wired ───────────────────────────────────────────────
line(''); line('starting the miner (Ctrl-C stops; your key never leaves this machine)…\n')
const env = { ...process.env, KRAY_ATLAS_DIR: custodyFits ? ATLAS_DIR : join(os.tmpdir(), 'kray-atlas-off-' + process.pid) }
const child = spawn('node', [join(ROOT, 'apps/kray-net/kray-miner.mjs'), NODE], { env, stdio: 'inherit' })
child.on('exit', (c) => process.exit(c ?? 0))
