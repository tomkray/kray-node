/**
 * GOSSIP TICK — a node LEARNS where the journal lives, and a liar teaches it nothing (ADR-2 · 2c-wire).
 *
 *   node apps/kray-net/gossip.test.mjs
 *
 * A simulated little network (no sockets — the bounded fetch is injected). From a single seed, the node
 * discovers the honest peers that share the SAME anchored head; a peer on a FORK is learned-but-evicted; a
 * FLOOD peer that advertises 10k junk URLs cannot grow the book past its cap nor past the per-peer limit; and
 * a peer that is DOWN teaches nothing. Discovery converges to exactly the same-chain, live peers.
 */
import { createPeerBook, isPublicHttpHost } from './peer-book.mjs'
import { gossipTick } from './gossip.mjs'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

const HEAD = 'a'.repeat(64)
const FORK = 'b'.repeat(64)

// a fake network: url -> { head, peers[] }. A url absent from the map is "down" (fetch throws).
function network(nodes) {
  return async (url) => {
    const m = url.match(/^(https?:\/\/[^/]+)(\/.*)$/)
    if (!m) throw new Error('bad url')
    const [, base, path] = m
    const n = nodes[base]
    if (!n) throw new Error('down')
    if (path === '/api/kraynet/head') return { head: n.head }
    if (path === '/api/kraynet/peers') return { peers: n.peers || [] }
    throw new Error('404')
  }
}

async function main() {
  console.log('\n╔═ GOSSIP TICK — from one seed, a node finds its same-chain peers; a liar teaches it nothing ═╗\n')

  // honest mesh on HEAD, a fork on FORK, a down node, and a flood advertiser
  const flood = Array.from({ length: 10_000 }, (_, i) => `https://junk${i}.example`)
  const nodes = {
    // seed advertises 'me.example' too, so the LEARN path actually gossips SELF and add()'s self-branch is exercised
    'https://seed.example': { head: HEAD, peers: ['https://me.example', 'https://h1.example', 'https://h2.example', 'https://fork.example', 'https://down.example'] },
    'https://h1.example': { head: HEAD, peers: ['https://h3.example', 'https://flood.example'] },
    'https://h2.example': { head: HEAD, peers: [] },
    'https://h3.example': { head: HEAD, peers: [] },
    'https://fork.example': { head: FORK, peers: ['https://h1.example'] },   // different chain
    'https://flood.example': { head: HEAD, peers: flood },                    // advertises 10k junk (all down)
    // down.example is absent → fetch throws
  }
  const fetchJson = network(nodes)

  const book = createPeerBook({ maxPeers: 64, self: 'https://me.example' })
  book.add('https://seed.example')   // ONE seed

  // a few ticks let discovery propagate hop by hop
  for (let i = 0; i < 4; i++) await gossipTick(book, { authenticHead: HEAD, fetchJson })

  const peers = book.peers()
  ok(peers.includes('https://seed.example'), 'the seed is verified (same head)')
  ok(['https://h1.example', 'https://h2.example', 'https://h3.example'].every((u) => peers.includes(u)), 'the honest same-chain mesh (h1,h2,h3) was DISCOVERED transitively from one seed')
  ok(!book.has('https://fork.example'), 'the FORK peer was learned from the seed but EVICTED — it serves a different head')
  ok(!book.has('https://down.example'), 'a peer that is down never verifies')
  ok(book.has('https://flood.example'), 'the flood advertiser itself echoes our head, so it is a (useless-until-it-delivers) candidate')
  ok(book.size() <= 64, `the 10k junk URLs never grew the book past its cap (size=${book.size()})`)
  ok(book.candidates().every((u) => u !== 'https://me.example'), 'the node never discovered ITSELF, no matter who advertised it')

  // a per-peer learn cap: even in ONE tick, a single flooder cannot contribute more than maxLearnPerPeer.
  // The advertised urls must SURVIVE verify (echo HEAD) so the LEARN cap is the SOLE limiter — otherwise the
  // assertion is vacuous (down urls get evicted regardless of the cap).
  {
    const many = Array.from({ length: 100 }, (_, i) => `https://cap${i}.example`)
    const capNodes = { 'https://flooder.example': { head: HEAD, peers: many } }
    for (const u of many) capNodes[u] = { head: HEAD, peers: [] }   // each echoes HEAD → would survive verify
    const capFetch = network(capNodes)
    const b2 = createPeerBook({ maxPeers: 10_000 })                 // cap is NOT the limiter here
    b2.add('https://flooder.example')
    await gossipTick(b2, { authenticHead: HEAD, fetchJson: capFetch, maxLearnPerPeer: 5 })
    const learned = b2.candidates().filter((u) => u.startsWith('https://cap')).length
    ok(learned === 5, `a single peer contributes EXACTLY maxLearnPerPeer=5 candidates per tick, though it advertised 100 that ALL pass verify (learned ${learned})`)
  }

  // ── SSRF (council) — a malicious peer advertises INTERNAL urls; allowLearned keeps them out of the book AND
  //    off the wire: the guard filters at INGESTION, so the node never even DIALS an internal target ──
  {
    const evil = ['http://127.0.0.1:8332/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5:6379/', 'http://192.168.1.1/admin', 'https://real-public.example']
    const evilNodes = { 'https://attacker.example': { head: HEAD, peers: evil }, 'https://real-public.example': { head: HEAD, peers: [] } }
    const raw = network(evilNodes)
    const dialed = []
    const evilFetch = async (url) => { dialed.push(url); return raw(url) }
    const b = createPeerBook({ maxPeers: 64 })
    b.add('https://attacker.example')
    await gossipTick(b, { authenticHead: HEAD, fetchJson: evilFetch, allowLearned: isPublicHttpHost })
    const isInternal = (u) => /127\.0\.0\.1|169\.254|10\.0\.0|192\.168/.test(u)
    ok(!b.candidates().some(isInternal), 'SSRF: not one internal url the attacker advertised entered the book')
    ok(!dialed.some(isInternal), 'SSRF: the node NEVER dialed an internal target — the guard filters at ingestion, before any fetch fires (blind-SSRF vector closed)')
    ok(b.has('https://real-public.example'), 'a genuine PUBLIC url the same attacker advertised is still learned — the guard blocks internal targets, not discovery itself')
  }

  // no authentic head → the tick admits no one (fail closed)
  {
    const b3 = createPeerBook({})
    b3.add('https://seed.example')
    const v = await gossipTick(b3, { authenticHead: 'not-a-head', fetchJson })
    ok(v.length === 0, 'without a valid authentic head, a gossip tick admits no peer')
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — discovery is permissionless and self-limiting: same-chain peers converge, liars and floods do not. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
