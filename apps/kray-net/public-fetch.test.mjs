/**
 * ATO C — PUBLIC FETCH: resolve, then refuse a private A/AAAA, then dial the pin.
 *   node apps/kray-net/public-fetch.test.mjs
 *
 * Door, not consensus. No live Internet — lookup and fetch are injected.
 */
import { createServer } from 'node:http'
import { fetchPublicUrl, pinPublicAddresses } from './public-fetch.mjs'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const refuses = async (p, re, m) => {
  try { await p; ok(false, m + ' — DID NOT throw') }
  catch (e) { ok(re.test(e.message), m + (re.test(e.message) ? '' : ' — wrong error: ' + e.message)) }
}

function listen(handler) {
  return new Promise((resolve) => {
    const s = createServer(handler)
    s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${s.address().port}`, close: () => s.close() }))
  })
}

async function main() {
  console.log('\n╔═ ATO C — PUBLIC FETCH: DNS cannot retarget the mint-art socket ═╗\n')

  await refuses(pinPublicAddresses('http://[::ffff:169.254.169.254]/latest/meta-data/'), /public/, 'C-20 mapped metadata is refused before any lookup')
  await refuses(pinPublicAddresses('http://127.0.0.1/x'), /public/, 'C-21 loopback literal is refused before any lookup')

  const rebind = async () => [{ address: '169.254.169.254', family: 4 }]
  await refuses(pinPublicAddresses('https://looks-public.example/art.png', rebind), /private/, 'C-22 a public name that resolves to metadata is refused')

  const loop = async () => [{ address: '127.0.0.1', family: 4 }]
  await refuses(pinPublicAddresses('https://looks-public.example/art.png', loop), /private/, 'C-23 a public name that resolves to loopback is refused')

  const mixed = async () => [{ address: '1.2.3.4', family: 4 }, { address: '10.0.0.1', family: 4 }]
  await refuses(pinPublicAddresses('https://cdn.example/art.png', mixed), /private/, 'C-24 one private A among public A is enough to refuse')

  const mapped6 = async () => [{ address: '::ffff:169.254.169.254', family: 6 }]
  await refuses(pinPublicAddresses('https://cdn.example/art.png', mapped6), /private/, 'C-25 a mapped AAAA of metadata is refused')

  const pins = await pinPublicAddresses('https://cdn.example/art.png', async () => [{ address: '1.2.3.4', family: 4 }])
  ok(pins.length === 1 && pins[0].address === '1.2.3.4', 'C-26 a public A is pinned')

  let hits = 0
  const sentinel = await listen((_req, res) => { hits++; res.end('stolen') })
  await refuses(
    fetchPublicUrl('https://looks-public.example/latest/meta-data/', {
      lookupFn: async () => [{ address: '127.0.0.1', family: 4 }],
      fetchImpl: async () => { hits++; return new Response('no') },
    }),
    /private/,
    'C-27 rebind is refused before fetchImpl — the pin is the gate',
  )
  ok(hits === 0, 'C-28 the loopback sentinel was never dialed')

  const art = await fetchPublicUrl('https://cdn.example/0.png', {
    lookupFn: async () => [{ address: '1.2.3.4', family: 4 }],
    fetchImpl: async (url, init) => {
      ok(init.redirect === 'error', 'C-29 production fetch never follows a 3xx')
      return new Response('PNG', { status: 200, headers: { 'content-type': 'image/png' } })
    },
  })
  ok(await art.text() === 'PNG', 'C-30 a pinned public name may fetch')

  await refuses(fetchPublicUrl(sentinel.url), /public/, 'C-31 pullMintArt cannot dial loopback even when the server is live')
  ok(hits === 0, 'C-32 the live loopback listener got zero hits')

  sentinel.close()
  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n╚═ ${pass} passed — resolve-then-check; the pin is the socket. ₭\n`)
}
main()
