// ── EXPLORER PARITY EXAM — a follower's read-only explorer must MATCH the writer's ──
//
// atlas + library + lights + rank books are listings of already-verified state, so a validator's
// own mirror must serve them in the IDENTICAL fold the writer does — otherwise /rank #nyx #glow
// paints a mouth, not mathematics. This exam proves, against a LIVE follower and the writer it
// mirrors, that atlas + library match, that ₭ / Ӿ / ✦ fold locally (no viaMirror), that /content
// is correctly typed, and that /render + the star lookup work.
//
// Run a follower first (scripts/follow/signet.sh, or --serve <port>), then:
//   KRAY_FOLLOWER=http://127.0.0.1:4480 KRAY_WRITER=https://signet.kray.network \
//     node scripts/follow/explorer-parity-exam.mjs
//
// Exit 0 = the mirror is a faithful explorer. Exit 1 = drift — align the shared view (state-views.mjs).

const F = process.env.KRAY_FOLLOWER || 'http://127.0.0.1:4480'
const W = process.env.KRAY_WRITER || 'https://signet.kray.network'
let fail = 0
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++ }

const grab = async (base, path) => {
  const r = await fetch(base + path, { redirect: 'manual' })
  const ct = r.headers.get('content-type') || ''
  const body = /json/.test(ct) ? await r.json().catch(() => null) : await r.text().catch(() => '')
  return { status: r.status, ct, loc: r.headers.get('location'), body }
}
// the mirror stamps every body with how-fresh-it-is; strip that before comparing to the writer
const stripMeta = (o) => { if (!o || typeof o !== 'object') return o; const { mirror, of, verifiedAt, verifiedHeight, verifiedRoot, stale, staleSince, height, ...rest } = o; return rest }

console.log(`\nfollower ${F}  vs  writer ${W}\n`)

// 1 · ATLAS parity (order-independent — it is a set of held content hashes)
const fa = stripMeta((await grab(F, '/api/kraynet/atlas')).body) || {}
const wa = (await grab(W, '/api/kraynet/atlas')).body || {}
const normAtlas = (o) => JSON.stringify({ size: o.size, k: o.k, contents: [...(o.contents || [])].sort() })
ok(normAtlas(fa) === normAtlas(wa), `atlas matches the writer (size=${fa.size}, k=${JSON.stringify(fa.k)})`)

// 2 · LIBRARY parity — the rich shape byte-for-byte (census, shelves, works, laws, entries)
const fl = stripMeta((await grab(F, '/api/kraynet/library')).body) || {}
const wl = (await grab(W, '/api/kraynet/library')).body || {}
ok(JSON.stringify(fl) === JSON.stringify(wl), `library matches the writer byte-for-byte (names=${fl.count}, works=${fl.workCount}, shelves=${(fl.shelves || []).length})`)
if (JSON.stringify(fl) !== JSON.stringify(wl)) for (const k of new Set([...Object.keys(fl), ...Object.keys(wl)])) if (JSON.stringify(fl[k]) !== JSON.stringify(wl[k])) console.log(`      ↳ differs at "${k}"`)

// 3 · /content serves the SIGNED type (so an image paints in the grid), same as the writer
const hash = (fa.contents || [])[0]
if (hash) {
  const fc = await grab(F, '/content/' + hash), wc = await grab(W, '/content/' + hash)
  ok(fc.status === 200 && !/octet-stream/.test(fc.ct) && fc.ct === wc.ct, `/content typed "${fc.ct}" — matches the writer`)
}

// 4 · /render — markdown gets the reading room; every other type 302s to the typed /content
const works = wl.works || []
const md = works.find((w) => /markdown/i.test(w.contentType || ''))
if (md) { const h = md.url.replace('/content/', ''); const r = await grab(F, '/render/' + h); ok(r.status === 200 && /text\/html/.test(r.ct) && /data-mdview/.test(r.body), `/render markdown #${md.star} → reading-room shell`) }
const other = works.find((w) => !/markdown/i.test(w.contentType || ''))
if (other) { const h = other.url.replace('/content/', ''); const r = await grab(F, '/render/' + h); ok(r.status === 302 && r.loc === '/content/' + h, `/render #${other.star} → 302 to typed /content`) }

// 5 · the search box's backend — star by number
const s0 = await grab(F, '/api/kraynet/star/0')
ok(s0.status === 200 && s0.body && s0.body.no === '0', `search backend /star/0 → "${(s0.body && s0.body.name) || '?'}"`)

// 6 · the explorer page is served (static chrome, before the snapshot gate)
const idx = await grab(F, '/')
ok(idx.status === 200 && /node explorer/i.test(idx.body) && /searchform/.test(idx.body), 'GET / → the explorer page (with search)')

// 7 · /rank chrome + the two-lights redirects (Nyx / glow bookmarks never 404 on a validator)
const rankPage = await grab(F, '/rank')
ok(rankPage.status === 200 && /KRAY\.NETWORK · Rank/.test(rankPage.body), 'GET /rank → the rank books page')
const xRedir = await grab(F, '/x')
ok(xRedir.status === 302 && /\/rank\/nyx/.test(xRedir.loc || ''), 'GET /x → 302 /rank/nyx')
const glowRedir = await grab(F, '/glow')
ok(glowRedir.status === 302 && /\/rank\/glow/.test(glowRedir.loc || ''), 'GET /glow → 302 /rank/glow')

// 8 · LIGHTS fold — Ӿ Nyx / Fenyx + ✦ glow from THIS replay, never viaMirror
const lightsCore = (o) => {
  const L = (o && o.lights) || o || {}
  const dropWho = (rows) => (rows || []).map((r) => ({ rank: r.rank, address: r.address, glow: r.glow, spendable: r.spendable, minted: r.minted, lane: r.lane, tank: r.tank }))
  return JSON.stringify({
    glow: { symbol: L.glow && L.glow.symbol, total: L.glow && L.glow.total, holders: L.glow && L.glow.holders, rank: dropWho(L.glow && L.glow.rank) },
    x: {
      symbol: L.x && L.x.symbol, name: L.x && L.x.name, hybrid: L.x && L.x.hybrid,
      total: L.x && L.x.total, totalSpendable: L.x && L.x.totalSpendable, totalLane: L.x && L.x.totalLane,
      tankTotal: L.x && L.x.tankTotal, tankBudget: L.x && L.x.tankBudget,
      rank: dropWho(L.x && L.x.rank),
    },
    conservation: L.conservation,
  })
}
const flights = stripMeta((await grab(F, '/api/kraynet/lights')).body) || {}
const wlights = (await grab(W, '/api/kraynet/lights')).body || {}
ok(!flights.viaMirror, 'lights is a local fold (no viaMirror — the validator does not trust the writer\'s JSON)')
ok(lightsCore(flights) === lightsCore(wlights), `lights matches the writer (Ӿ=${(flights.x && flights.x.total) || 0}, ✦=${(flights.glow && flights.glow.total) || 0})`)
if (lightsCore(flights) !== lightsCore(wlights)) {
  console.log('      ↳ follower conservation', flights.conservation)
  console.log('      ↳ writer conservation', wlights.conservation)
}

// 9 · ANALYTICS rank books — ₭ standing + the same lights, local fold
const rankCore = (o) => JSON.stringify((o.rank || []).map((r) => ({
  address: r.address, balance: String(r.balance), glow: String(r.glow || 0), stars: r.stars, works: r.works, names: r.names,
})))
const fbooks = stripMeta((await grab(F, '/api/kraynet/analytics')).body) || {}
const wbooks = (await grab(W, '/api/kraynet/analytics')).body || {}
ok(!fbooks.viaMirror, 'analytics is a local fold (no viaMirror)')
ok(rankCore(fbooks) === rankCore(wbooks), `₭ rank matches the writer (${(fbooks.rank || []).length} holders)`)
ok(lightsCore(fbooks) === lightsCore(wbooks), 'analytics.lights matches the writer (Nyx / Fenyx / glow)')
ok(fbooks.chain && wbooks.chain && String(fbooks.chain.cascadeRoot).toLowerCase() === String(wbooks.chain.cascadeRoot).toLowerCase(), 'analytics cascadeRoot matches the writer')

console.log(fail ? `\nFAIL — ${fail} check(s) failed\n` : '\nPASS — this mirror is a faithful explorer of the chain it follows\n')
process.exit(fail ? 1 : 0)
