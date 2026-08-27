/**
 * THE GUARDIAN SWARM — N independent validators on ONE machine, no extra browsers or wallets needed.
 *
 *   node scripts/guardian-swarm.mjs [count] [nodeUrl]        (defaults: 5 guardians, http://localhost:4477)
 *
 * Spawns N copies of the real CLI guardian miner (apps/kray-net/kray-miner.mjs), each with its OWN
 * deterministic identity (a distinct taproot address), each independently joining, mining presence beats
 * (real per-beat proof-of-work over the Bitcoin beacon), signing every receipt, and earning its share of
 * the fee pool when a seal settles — linear in proven work, sybil-neutral (N identities on one CPU split
 * the same total work one identity would have; the swarm buys you nothing, which is exactly the theorem).
 *
 * TESTNET SIMULATION ONLY: the seeds are deterministic strings, so these identities are PUBLIC — never
 * fund them with anything real. Ctrl-C stops the whole swarm.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const N = Math.max(1, Math.min(64, Number(process.argv[2] || 5)))
const NODE = (process.argv[3] || process.env.KRAY_NODE || 'http://localhost:4477').replace(/\/+$/, '')
const TICKS = process.env.KRAY_MINE_TICKS || ''   // bound the run (e.g. 10 beats) or run forever

console.log(`\n⛏  GUARDIAN SWARM — ${N} independent validators → ${NODE}${TICKS ? ` (${TICKS} beats each)` : ' (Ctrl-C to stop)'}\n`)
const kids = []
for (let i = 0; i < N; i++) {
  const sk = createHash('sha256').update(`kray-guardian-swarm-${i}`).digest('hex')
  const env = {
    ...process.env,
    KRAY_MINER_SK: sk,
    KRAY_MINE_MS: String(2500 + i * 173),            // desynchronized cadences — like real, independent machines
    KRAY_MINE_BUDGET: process.env.KRAY_MINE_BUDGET || '30000',
    ...(TICKS ? { KRAY_MINE_TICKS: TICKS } : {}),
  }
  const child = spawn('node', [join(ROOT, 'apps/kray-net/kray-miner.mjs'), NODE], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => `  [g${i}] ${l}`).join('\n') + '\n'))
  child.stderr.on('data', (d) => process.stderr.write(`  [g${i}!] ${d}`))
  child.on('exit', (code) => { console.log(`  [g${i}] exited (${code})`); if (kids.every((k) => k.exitCode !== null)) process.exit(0) })
  kids.push(child)
}
const stop = () => { console.log('\nstopping the swarm…'); for (const k of kids) k.kill('SIGTERM') }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
