/**
 * THE DEADLINE PRE-FLIGHT, run against the LIVE journals themselves — not a projection of them.
 * Pulls every content-addressed chunk, re-hashes each to confirm the node is not lying about its own
 * bytes, and then asks the one question the pin turns on: does any signed act carry a `deadline`?
 * Zero means DEADLINE_FREE_ORDER_SEQ may be born at 0 — the new order key is byte-identical to the old.
 */
import { createHash } from 'node:crypto'
const NODES = [['main', 'https://kray.network'], ['signet', 'https://signet.kray.network']]
const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(25_000) }); if (!r.ok) throw Error(`${r.status} ${u}`); return r.json() }

for (const [name, base] of NODES) {
  try {
    const manifest = await get(`${base}/api/kraynet/chunks`)
    let lines = [], verified = 0
    for (const c of manifest.chunks) {
      const { lines: span } = await get(`${base}/api/kraynet/chunk/${c.address}`)
      // the node's own address law: sha256 over the raw lines. A lying server is caught right here.
      const address = createHash('sha256').update(span.join('\n'), 'utf8').digest('hex')
      if (address !== c.address) { console.log(`  ✗ ${name}: chunk ${c.index} does NOT hash to its address — refusing to read further`); lines = null; break }
      verified++; lines = lines.concat(span)
    }
    if (!lines) continue
    const events = lines.map(l => JSON.parse(l))
    const withDeadline = events.filter(e => e.deadline !== undefined && e.deadline !== null)
    const signed = events.filter(e => e.signature)
    const market = events.filter(e => String(e.kind || '').startsWith('star-') || String(e.kind || '').startsWith('packet-') || String(e.kind || '').startsWith('claim-') || String(e.kind || '').startsWith('pool-'))
    const termed = events.filter(e => e.kind === 'star-list' && (e.to !== undefined || e.gateStar !== undefined || e.notBefore !== undefined))
    console.log(`\n  ${name.toUpperCase()} — ${base}`)
    console.log(`    journal        ${events.length} events, ${verified}/${manifest.chunks.length} chunks re-hashed clean (head ${String(manifest.head).slice(0, 12)}…)`)
    console.log(`    signed acts    ${signed.length}`)
    console.log(`    with deadline  ${withDeadline.length}   ${withDeadline.length === 0 ? '→ DEADLINE_FREE_ORDER_SEQ may be born at 0 (byte-identical)' : '→ PIN IT PAST THE TIP: ' + withDeadline.map(e => e.seq).join(',')}`)
    console.log(`    market acts    ${market.length}${market.length ? ' — ' + [...new Set(market.map(e => e.kind))].join(', ') : ''}`)
    console.log(`    star-list with a term  ${termed.length}   ${termed.length === 0 ? '→ this code replays this journal' : '→ REFUSED AT BOOT'}`)
  } catch (e) { console.log(`\n  ${name.toUpperCase()} — unreachable or refused: ${e.message}`) }
}
