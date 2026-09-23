/**
 * THE COLD REPLAY — a stranger rebuilds each live network from its own public bytes, on THIS code.
 *
 * Pulls every content-addressed chunk from a live node, re-hashes each against the address that node
 * published (so a lying server is caught before a line is read), then feeds the journal — in order, from
 * an empty ledger — through `openKrayLedger`, the same opener every node uses. If the cascade root the
 * replay lands on equals the root the node publishes at /api/kraynet/audit, this code re-derives that
 * network's entire history byte for byte, and deploying it cannot fork the chain (A3).
 *
 *   node scripts/cold-replay.mjs
 */
import { createHash } from 'node:crypto'
import { openKrayLedger } from '../apps/kray-core/src/protocol/store.ts'

const NODES = [['main', 'https://kray.network'], ['signet', 'https://signet.kray.network']]
const get = async (u) => {
  const r = await fetch(u, { signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw Error(`${r.status} ${u}`)
  return r.json()
}

let failed = 0
for (const [net, base] of NODES) {
  try {
    const manifest = await get(`${base}/api/kraynet/chunks`)
    const audit = await get(`${base}/api/kraynet/audit`)
    let lines = []
    for (const c of manifest.chunks) {
      const { lines: span } = await get(`${base}/api/kraynet/chunk/${c.address}`)
      const address = createHash('sha256').update(span.join('\n'), 'utf8').digest('hex')
      if (address !== c.address) throw Error(`chunk ${c.index} does not hash to its published address`)
      lines = lines.concat(span)
    }
    const events = lines.map((l) => JSON.parse(l))
    const L = openKrayLedger(net)
    let applied = 0, halted = null
    for (const e of events) {
      try { L.applyLive(e); applied++ }
      catch (err) { halted = `seq ${e.seq} (${e.kind}): ${err.message.slice(0, 150)}`; break }
    }
    const mine = L.cascadeRoot(), theirs = audit.cascadeRoot
    const match = mine === theirs
    console.log(`\n  ${net.toUpperCase()} — ${base}`)
    console.log(`    chunks        ${manifest.chunks.length} re-hashed clean`)
    console.log(`    events        ${applied}/${events.length} applied${halted ? `  HALTED at ${halted}` : ''}`)
    console.log(`    live root     ${theirs}`)
    console.log(`    replay root   ${mine}`)
    console.log(`    verdict       ${match && !halted ? '✓ THIS CODE RE-DERIVES THIS NETWORK BYTE FOR BYTE' : '✗ DIVERGED — do not deploy'}`)
    if (!match || halted) failed++
  } catch (e) {
    console.log(`\n  ${net.toUpperCase()} — could not be read: ${e.message}`)
    failed++
  }
}
console.log(`\n  ${failed ? `${failed} network(s) did not re-derive` : 'every live network re-derives on this code'}\n`)
process.exit(failed ? 1 : 0)
