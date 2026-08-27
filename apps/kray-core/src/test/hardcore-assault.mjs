/**
 * THE 10,000-YEAR ASSAULT — seven levels of escalating same-instant storms, 3 → 2,187 users.
 *
 * The hermetic concurrency proof (concurrency-proof.ts) already proves the queue is safe at one
 * scale. This assault proves the LAW DOES NOT BEND AS THE CROWD GROWS: it re-runs the full proof
 * at 3^1, 3^2 … 3^7 concurrent users — each level a fresh in-memory node, each level demanding
 * the same perfection (unique contiguous star births, exact conservation, one total order, a
 * perfect block partition, byte-exact replay). A law that survives 3 users but frays at 2,187
 * is not a law; this is where it would fray first.
 *
 * Hermetic: spins its own instances, touches no live node, needs no infrastructure.
 *
 *   npm run test:hardcore          (in apps/kray-core)
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LEVELS = [3, 9, 27, 81, 243, 729, 2187]

console.log(`\n╔═ THE 10,000-YEAR ASSAULT — ${LEVELS.length} levels, ${LEVELS[0]} → ${LEVELS[LEVELS.length - 1]} users, the same law demanded at every scale ═╗\n`)
const t0 = Date.now()

for (const [i, n] of LEVELS.entries()) {
  console.log(`── level ${i + 1}/${LEVELS.length} — ${n} concurrent users, ${2 * n} mixed-act storm ──`)
  const r = spawnSync('node', [join(HERE, 'concurrency-proof.ts')], {
    stdio: 'inherit',
    env: { ...process.env, CONC_N: String(n), CONC_STORM: String(2 * n) },
  })
  if (r.status !== 0) {
    console.error(`\n╚═ ASSAULT FAILED at level ${i + 1} (${n} users) — the law frayed under crowd. ✗`)
    process.exit(r.status ?? 1)
  }
}

console.log(`\n╚═ ASSAULT SURVIVED — all ${LEVELS.length} levels green in ${((Date.now() - t0) / 1000).toFixed(0)}s. The law does not bend as the crowd grows. ⛓₭`)
