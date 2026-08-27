/**
 * PEER BOOK — discovery is permissionless because verification filters (ADR-2 · 2c).
 *
 *   node apps/kray-net/peer-book.test.mjs
 *
 * Pure (no network — the head fetch is injected). Proves what the book actually delivers: a peer on a
 * DIFFERENT chain / a fork / a fabricated URL / a down node never enters peers() (chain/liveness filter),
 * the book stays bounded, and — the honest boundary — a peer that ECHOES the public anchored head IS
 * admitted and is NOT evicted (byte-honesty is downstream, not the book's). Case/port URL variants collapse
 * to one peer, and no variant of self is ever added.
 */
import { createPeerBook, isPublicHttpHost } from './peer-book.mjs'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const HEAD = 'a'.repeat(64)          // the authentic anchored head
const OTHER = 'b'.repeat(64)         // a different chain / fork / lie
const sleep0 = () => Promise.resolve()

async function main() {
  console.log('\n╔═ PEER BOOK — a gossiped lie costs nothing; only the anchored head admits a peer ═╗\n')

  // ── add: shape, self, dedup, bound ──
  {
    const b = createPeerBook({ maxPeers: 3, self: 'https://me.example' })
    ok(b.add('https://a.example') && b.add('https://a.example/') === true, 'a valid URL is added; a trailing-slash dupe is the same peer')
    ok(b.size() === 1, 'the dupe did not grow the book')
    ok(!b.add('not-a-url') && !b.add('me.example') && !b.add('') && !b.add('https://me.example'), 'non-HTTP, bare host, empty, and SELF are all refused')
    b.add('https://c.example'); b.add('https://d.example')
    ok(!b.add('https://e.example'), 'the candidate pool is BOUNDED — a flood cannot grow it past maxPeers')
    ok(b.size() === 3, 'the book holds exactly maxPeers')
  }

  // ── dedup + self-bypass: case/port variants collapse; no variant of self is ever added ──
  {
    const b = createPeerBook({ maxPeers: 64, self: 'https://me.example' })
    b.add('https://a.example'); b.add('https://A.example'); b.add('https://a.example:443'); b.add('HTTPS://A.EXAMPLE/')
    ok(b.size() === 1, 'case + default-port + trailing-slash variants of ONE peer collapse to a single slot')
    ok(!b.add('https://ME.example') && !b.add('https://me.example:443') && !b.add('HTTPS://me.example/'), 'no case/port/scheme-case variant of SELF is ever added — the node cannot discover itself')
    ok(b.add('http://a.example') && b.size() === 2, 'http:// and https:// stay DISTINCT — genuinely different endpoints')
  }

  // ── refresh: only the authentic head admits a peer ──
  {
    const b = createPeerBook({ maxPeers: 64, self: '' })
    b.addMany(['https://honest.example', 'https://forked.example', 'https://down.example'])
    const heads = { 'https://honest.example': HEAD, 'https://forked.example': OTHER }   // down.example throws
    const fetchHead = async (u) => { await sleep0(); if (!(u in heads)) throw new Error('down'); return heads[u] }
    const v = await b.refresh(HEAD, fetchHead)
    ok(v.length === 1 && v[0] === 'https://honest.example', 'ONLY the peer serving the authentic head is verified')
    ok(!b.has('https://forked.example'), 'a peer on a DIFFERENT chain (fork/lie) is not verified — and was evicted')
    ok(!b.has('https://down.example'), 'a peer that is down is not verified — and was evicted')
    ok(b.candidates().length === 1, 'the failed candidates were EVICTED, freeing the pool for honest peers')
  }

  // ── WRONG-CHAIN flood is evicted; but a HEAD-ECHOER is admitted (the honest boundary) ──
  {
    const b = createPeerBook({ maxPeers: 1000 })
    const honest = ['https://h1.example', 'https://h2.example', 'https://h3.example']
    const echo = 'https://echo.example'                              // echoes the PUBLIC head, holds nothing
    const heads = Object.fromEntries(honest.map((u) => [u, HEAD]))
    heads[echo] = HEAD
    for (let i = 0; i < 400; i++) heads['https://liar' + i + '.example'] = (i % 2 ? OTHER : '')   // wrong head or throw
    b.addMany([...honest, echo, ...Object.keys(heads).filter((u) => !honest.includes(u) && u !== echo)])
    const fetchHead = async (u) => { if (!(u in heads) || !heads[u]) throw new Error('bad'); return heads[u] }
    await b.refresh(HEAD, fetchHead)
    ok(b.candidates().length === 4, 'the 400 head-FAILING liars (200 wrong-chain + 200 down) were all evicted — the book self-cleans junk that does not echo the authentic head')
    ok(honest.every((h) => b.has(h)), 'the 3 honest peers are admitted')
    ok(b.has(echo), 'HONEST BOUNDARY: a head-ECHOER (claims the public head, serves nothing) IS admitted — the book filters chain/liveness, not byte-honesty')
    // and it is NOT evicted on re-refresh (it keeps echoing) — its uselessness is invisible to the book
    await b.refresh(HEAD, fetchHead)
    ok(b.has(echo), 'the head-echoer is NOT evicted while it keeps echoing — byte-honesty/usefulness is proven downstream (chunk-fetch + replay + anchor), not here')
  }

  // ── a verified peer that LATER forks is dropped on re-refresh (liveness of the filter) ──
  {
    const b = createPeerBook({})
    b.add('https://p.example')
    let head = HEAD
    const fetchHead = async () => head
    await b.refresh(HEAD, fetchHead)
    ok(b.has('https://p.example'), 'p is verified while it serves the authentic head')
    head = OTHER   // p forks / starts lying
    await b.refresh(HEAD, fetchHead)
    ok(!b.has('https://p.example'), 'the moment p stops serving the authentic head, it is dropped — verification is continuous')
  }

  // ── no authentic head → trust NO ONE ──
  {
    const b = createPeerBook({})
    b.add('https://x.example')
    const v = await b.refresh('not-a-head', async () => HEAD)
    ok(v.length === 0 && b.verifiedCount() === 0, 'without a valid authentic head, the book trusts no peer at all')
  }

  // ── PROVE (2c-wire) — a delivery-proven peer is protected and tried FIRST (honest-peer headroom) ──
  {
    const b = createPeerBook({ maxPeers: 2 })                    // a TINY unproven pool, easy to flood
    b.add('https://deliverer.example')
    await b.refresh(HEAD, async () => HEAD)                      // it echoes the head → verified
    ok(b.prove('https://deliverer.example'), 'a peer that served a VALID chunk is proven')
    ok(b.provenCount() === 1 && b.size() === 0, 'the proven peer GRADUATES out of the capped pool into the protected tier')
    // now FLOOD the unproven pool to its cap with head-echoers
    b.add('https://echo1.example'); b.add('https://echo2.example')
    ok(!b.add('https://echo3.example'), 'the unproven pool is full at maxPeers — the flood is capped')
    ok(b.has('https://deliverer.example'), 'HEADROOM: the flood did NOT crowd out the proven deliverer — it never consumed a capped slot')
    await b.refresh(HEAD, async () => HEAD)                      // everyone echoes the head
    ok(b.peers()[0] === 'https://deliverer.example', 'HEADROOM: peers() lists the proven deliverer FIRST — a reconstruction tries it before any mere echoer')
    ok(b.peers().length === 3, 'proven + the two head-echoers are all offered as sources')
  }

  // ── DEMOTE (2c-wire) — a peer that echoes the head but does NOT deliver is dropped ──
  {
    const b = createPeerBook({ maxPeers: 64 })
    b.addMany(['https://echoer.example', 'https://real.example'])
    await b.refresh(HEAD, async () => HEAD)                      // both echo the head → both verified
    ok(b.has('https://echoer.example') && b.has('https://real.example'), 'both echo the head, so both are candidate sources')
    // downstream: real.example served a valid chunk; echoer.example served nothing
    b.prove('https://real.example')
    ok(b.demote('https://echoer.example'), 'the head-echoer that delivered NOTHING is demoted')
    ok(!b.has('https://echoer.example'), 'a demoted head-echoer is dropped from every tier — its uselessness is now visible (proven downstream, signalled back)')
    ok(b.has('https://real.example'), 'the real deliverer survives — byte-honesty is what separated them, exactly as promised')
    ok(!b.demote('https://never-known.example'), 'demoting an unknown peer is a no-op')
  }

  // ── SSRF GUARD (2c-wire council) — isPublicHttpHost rejects every internal target, accepts public ones ──
  {
    const internal = [
      'http://127.0.0.1:8332/', 'http://localhost:9200/', 'https://foo.localhost/', 'http://x.internal/', 'http://y.local/',
      'http://169.254.169.254/latest/meta-data/',                  // cloud metadata
      'http://10.0.0.5:6379/', 'http://172.16.0.1/', 'http://172.31.255.255/', 'http://192.168.1.1:8080/admin/reboot?x=',
      'http://100.64.0.1/', 'http://0.0.0.0/', 'http://255.255.255.255/',
      'http://[::1]/', 'http://[fe80::1]/', 'http://[fc00::1]/', 'http://[fd12::1]/', 'http://[::]/',
      'http://[::ffff:127.0.0.1]/', 'http://[::127.0.0.1]/',       // IPv4-mapped AND IPv4-compatible loopback
      'http://[2002:7f00:1::]/', 'http://[64:ff9b::7f00:1]/',      // 6to4 · NAT64 embedding 127.0.0.1
      'http://localhost./', 'http://metadata.google.internal./',   // trailing-dot FQDN (RFC 6761 still loopback/internal)
      'http://db.internal./', 'http://printer.local./', 'http://LOCALHOST../',
      'http://2130706433/', 'http://0x7f000001/', 'http://127.1/', // decimal / hex / short loopback (URL normalizes → caught)
      'ftp://1.2.3.4/', 'not-a-url', '',                           // non-http / garbage
    ]
    ok(internal.every((u) => !isPublicHttpHost(u)), 'every loopback / link-local / RFC1918 / CGNAT / ULA / mapped / compatible / 6to4 / NAT64 / trailing-dot-name / obfuscated-IP / non-http target is REFUSED as a public host')
    const publicOk = ['https://node.kray.network/', 'http://1.2.3.4/', 'https://8.8.8.8:443/', 'http://172.15.0.1/', 'http://172.32.0.1/', 'http://[2606:4700::1111]/', 'http://example.com/api/kraynet/head']
    ok(publicOk.every((u) => isPublicHttpHost(u)), 'genuine public http(s) hosts (incl. IPs just OUTSIDE the private ranges, e.g. 172.15 / 172.32) are ALLOWED')
  }

  // ── a PROVEN peer that later FORKS loses its protection on refresh (protection is not a permanent title) ──
  {
    const b = createPeerBook({})
    b.add('https://p.example')
    await b.refresh(HEAD, async () => HEAD)
    b.prove('https://p.example')
    ok(b.provenCount() === 1, 'p is proven')
    let head = HEAD
    const fetchHead = async () => head
    head = OTHER                                                 // p forks after having delivered
    await b.refresh(HEAD, fetchHead)
    ok(b.provenCount() === 0 && !b.has('https://p.example'), 'the proven peer that stops serving the authentic head loses protection and is dropped — verification stays continuous even for proven peers')
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — discovery is free but a wrong-chain lie is rejected by the book, and a data lie is inert downstream; the anchored head admits who may speak. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
