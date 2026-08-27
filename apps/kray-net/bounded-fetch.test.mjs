/**
 * BOUNDED FETCH — an untrusted peer cannot hang us or flood our memory (ADR-2 · shared).
 *
 *   node apps/kray-net/bounded-fetch.test.mjs
 *
 * Real in-process HTTP peers, each attacking a different way: a small honest body passes; a body that streams
 * PAST the ceiling is cut mid-stream; a body that DECLARES an oversized content-length is refused before a byte
 * is read; a slow-loris that never finishes is aborted by the timeout. The ceiling is the ACTUAL bytes, never
 * the peer's claim.
 */
import { createServer } from 'node:http'
import { boundedJson } from './bounded-fetch.mjs'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const refuses = async (p, re, m) => {
  try { await p; ok(false, m + ' — did NOT throw') }
  catch (e) { ok(re.test(e.message), m + (re.test(e.message) ? '' : ' — wrong error: ' + e.message)) }
}

function peer(handler) {
  return new Promise((resolve) => {
    const s = createServer(handler)
    s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${s.address().port}`, close: () => s.close() }))
  })
}

async function main() {
  console.log('\n╔═ BOUNDED FETCH — a stranger cannot hang us or flood our memory ═╗\n')

  // honest small body
  const honest = await peer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ head: 'a'.repeat(64) })) })
  const j = await boundedJson(honest.url, { timeoutMs: 2000, maxBytes: 64 * 1024 })
  ok(j.head === 'a'.repeat(64), 'an honest small JSON body is fetched and parsed')

  // streams PAST the ceiling without ever declaring content-length (chunked) — must be cut mid-stream
  const flood = await peer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    const junk = Buffer.alloc(16 * 1024, 0x20)          // 16KB per write
    let sent = 0
    const pump = () => {
      if (sent > 4 * 1024 * 1024) { res.end() ; return }  // would be 4MB if not cut
      sent += junk.length; res.write(junk); setImmediate(pump)
    }
    pump()
  })
  await refuses(boundedJson(flood.url, { timeoutMs: 5000, maxBytes: 64 * 1024 }), /exceeded the byte ceiling/, 'a chunked flood is CUT once the ACTUAL bytes pass the ceiling — content-length was never sent, so only streaming enforcement catches it')

  // DECLARES an oversized content-length — refused before reading the body
  const bigDeclared = await peer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.setHeader('content-length', String(999 * 1024 * 1024))
    res.end('{}')   // the actual body is tiny — the LIE is in the header, and we refuse on the claim
  })
  await refuses(boundedJson(bigDeclared.url, { timeoutMs: 2000, maxBytes: 64 * 1024 }), /over the byte ceiling \(declared\)/, 'an oversized DECLARED content-length is refused before a byte of the body is trusted')

  // slow-loris: opens, writes nothing, never ends — the timeout aborts it
  const slow = await peer((_req, _res) => { /* hold the socket open forever */ })
  await refuses(boundedJson(slow.url, { timeoutMs: 300, maxBytes: 64 * 1024 }), /abort|timeout|timed out|The operation was aborted/i, 'a slow-loris that never responds is aborted by the timeout, not left to hang')

  // non-2xx is an error, not silent
  const boom = await peer((_req, res) => { res.statusCode = 503; res.end('nope') })
  await refuses(boundedJson(boom.url, { timeoutMs: 2000, maxBytes: 64 * 1024 }), /HTTP 503/, 'a non-2xx status is surfaced as an error')

  // SSRF via redirect: a vetted public host 3xx-redirects toward ANOTHER host — must NOT be followed. Point the
  // Location at a live SENTINEL and assert it is NEVER dialed — this distinguishes "refused the redirect" from
  // "followed it and the second dial happened to fail" (a loose throw-matches-regex check cannot tell them apart).
  let sentinelHits = 0
  const sentinel = await peer((_req, res) => { sentinelHits++; res.end('{}') })
  const redir = await peer((_req, res) => { res.statusCode = 302; res.setHeader('location', sentinel.url + '/redirected'); res.end() })
  await refuses(boundedJson(redir.url, { timeoutMs: 2000, maxBytes: 64 * 1024 }), /redirect|3\d\d|failed|fetch/i, 'a 3xx redirect throws — boundedJson does not follow it')
  ok(sentinelHits === 0, 'the redirect target was NEVER dialed (sentinel got 0 hits) — redirect:error refuses AT the vetted host, it does not follow to a second host')

  honest.close(); flood.close(); bigDeclared.close(); slow.close(); boom.close(); redir.close(); sentinel.close()
  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — a discovered peer is bounded in time AND in bytes; its response is trusted only after it fits. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
