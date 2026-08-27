// ── SHARED READ-ONLY STATE VIEWS — one shape for the writer AND every follower mirror ──
//
// atlas + library + lights + rank books are pure LISTINGS of already-verified state: the journal replay
// (same consensus reducer) validated every byte, so exposing them needs no POST, no
// key, and no second pen. A follower that replayed the history holds the identical
// KrayNode ledger the writer does, so these functions — fed that node — return the
// identical JSON. Keeping the shape HERE (not inlined per server) is what stops the
// recurring "thin endpoint blanks a rich page" drift: the explorer sees the same body
// whether it is talking to the writer or to a validator's own mirror.
//
// Read-only by construction: every method called is a getter on the replayed ledger.

import { readName, categoryOf, CATEGORIES } from '../kray-core/src/protocol/library.ts'
import { CUSTODY_CHALLENGES } from '../kray-core/src/economics/custody.ts'
import { FIREBORN_SENDS_PER_KRAY } from '../kray-core/src/protocol/ledger.ts'
import { frozenStarGlow, GLOW_SYMBOL } from '../kray-core/src/economics/glow-star.ts'
import { TREASURY, BLACK_HOLE } from '../kray-core/src/protocol/kray-primitives.ts'

// empty contentType = a star with no bytes (a name lot). Otherwise the protocol shelf —
// code, markup, vector… must not collapse into "text" (library.ts CATEGORIES).
export function catOf(ct) {
  if (!ct) return 'name'
  return categoryOf(ct)
}

// display-only: the glyph + label each shelf shows. Never consensus.
export const SHELF_SPEC = {
  image: { glyph: '▣', label: 'Image' }, vector: { glyph: '◈', label: 'Vector' },
  video: { glyph: '▶', label: 'Video' }, audio: { glyph: '♪', label: 'Audio' },
  code: { glyph: '⌘', label: 'Code' }, markup: { glyph: '❰', label: 'Markup' },
  document: { glyph: '▤', label: 'Document' }, data: { glyph: '⛁', label: 'Data' },
  text: { glyph: '¶', label: 'Text' }, model: { glyph: '◉', label: '3D' },
  font: { glyph: 'A', label: 'Font' }, archive: { glyph: '▦', label: 'Archive' },
  file: { glyph: '◇', label: 'File' },
  law: { glyph: '⚖', label: 'Law' },
}

// THE ATLAS — every inscribed content this node holds and hash-checked, by SHA-256.
export function atlasView(node) {
  const contents = node.ledger.stars.inscriptions().filter((x) => !x.cursed).map((x) => x.contentHash)
  return { size: contents.length, contents, k: CUSTODY_CHALLENGES }
}

// THE LIBRARY — every claimed name (the census) and every work (the shelves), classified by
// the pure reading. Identical fold to the writer's door, so the explorer renders the same.
export function libraryView(node) {
  const L = node.ledger
  const bps = L.stars.baptisms().filter((x) => !x.cursed)       // every claimed name, claim order
  const inscs = L.stars.inscriptions().filter((x) => !x.cursed) // every work, creation order (oldest-first)
  // a star's rarity — BigInt-safe and never throwing (a bad number reads as no rarity)
  const rarityOf = (star) => { try { return node.star(BigInt(star))?.rarity ?? null } catch { return null } }
  const nameByStar = new Map(bps.map((bp) => [String(bp.star), bp.name]))
  const workByStar = new Map(inscs.map((x) => [String(x.star), x]))

  // ── the census: every claimed name classified by the pure reading (readName) ──
  const census = { domain: 0, handle: 0, name: 0 }
  const tlds = {}
  const entries = bps.map((bp) => {
    const r = readName(bp.name)
    census[r.kind] = (census[r.kind] || 0) + 1
    if (r.kind === 'domain' && r.tld) tlds[r.tld] = (tlds[r.tld] || 0) + 1
    const w = workByStar.get(String(bp.star))
    return {
      star: String(bp.star), name: bp.name, canonical: r.canonical, kind: r.kind,
      tld: r.tld ?? null, lookalike: r.lookalike, lookalikeReason: r.lookalikeReason ?? null,
      rarity: rarityOf(bp.star),
      inscription: w ? { contentType: w.contentType, category: catOf(w.contentType), url: '/content/' + w.contentHash, size: w.size } : null,
    }
  })

  // ── the shelves: protocol reading order (library.ts CATEGORIES) ──
  const shelfCount = {}
  for (const c of CATEGORIES) shelfCount[c.id] = 0
  shelfCount.law = 0
  const works = inscs.map((x) => {
    const category = catOf(x.contentType)
    shelfCount[category] = (shelfCount[category] || 0) + 1
    return {
      star: String(x.star), number: x.number ?? null, category, url: '/content/' + x.contentHash,
      contentType: x.contentType, size: x.size,
      name: nameByStar.get(String(x.star)) ?? null, rarity: rarityOf(x.star),
    }
  }).reverse()   // inscriptions() ascends by number (oldest-first); the page reads newest-first
  const laws = []
  for (let i = 0; i < L.stars.starCount; i++) {
    const s = L.stars.star(BigInt(i))
    if (!s || !s.contract) continue
    const no = String(s.no)
    laws.push({
      star: no, number: null, category: 'law', url: '/star/' + no + '#lawcard',
      contentType: 'application/kray-law', size: 0,
      name: nameByStar.get(no) ?? null, rarity: rarityOf(s.no),
      contract: s.contract,
    })
  }
  shelfCount.law = laws.length
  // first-class media + craft stay on the rail even at zero; rare empty shelves stay hidden
  const always = new Set(['image', 'video', 'audio', 'text', 'code', 'law'])
  const order = CATEGORIES.map((c) => c.id)
  const codeAt = order.indexOf('code')
  order.splice(codeAt + 1, 0, 'law')
  const shelves = order.filter((id) => always.has(id) || (shelfCount[id] || 0) > 0).map((id) => ({
    id, glyph: (SHELF_SPEC[id] || {}).glyph || '◇', label: (SHELF_SPEC[id] || {}).label || id,
  }))

  return {
    count: bps.length, census, tlds,
    law: 'A name is claimed by its first writer and is theirs forever; every keyboard variation of a name is the same name, so nothing can be spoofed.',
    workCount: works.length, shelfCount, shelves, works, laws, lawCount: laws.length, entries,
  }
}

// THE TWO LIGHTS — ✦ glow (frozen stars, soulbound) and Ӿ Nyx / Fenyx (burn-born money + Fireborn tank).
// Pure fold of the replayed ledger + journal events. Writer and follower MUST call this — a validator
// that relays the writer's /lights is trusting a mouth, not re-deriving the books.
export function lightsView({ node, events, labelOf, top } = {}) {
  const cap = top == null ? Number.MAX_SAFE_INTEGER : Math.min(5000, Math.max(1, Number(top) || 100))
  const whoOf = typeof labelOf === 'function' ? labelOf : () => null
  const glowMap = frozenStarGlow(events || [])
  const glowTotal = [...glowMap.values()].reduce((s, v) => s + v, 0)
  const glowRank = [...glowMap.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
    .slice(0, cap)
    .map(([address, glow], i) => ({
      rank: i + 1, address, who: (whoOf(address) || {}).label || null,
      glow, share: glowTotal > 0 ? Math.round((glow / glowTotal) * 10000) / 100 : 0,
    }))
  const L = node.ledger
  const books = L.xBooks()
  let spendSum = 0n, laneSum = 0n, tankSum = 0n, mintedHolders = 0, liveHolders = 0
  for (const r of books) {
    spendSum += r.spendable
    laneSum += r.lane
    tankSum += r.tank
    if (r.minted > 0n) mintedHolders++
    if (r.spendable > 0n || r.lane > 0n) liveHolders++
  }
  const xRank = books
    .filter((r) => r.spendable > 0n || r.minted > 0n || r.lane > 0n)
    .sort((a, b) => (b.spendable !== a.spendable ? (b.spendable > a.spendable ? 1 : -1) : a.address < b.address ? -1 : 1))
    .slice(0, cap)
    .map((r, i) => ({
      rank: i + 1, address: r.address, who: (whoOf(r.address) || {}).label || null,
      spendable: r.spendable.toString(), minted: r.minted.toString(), lane: r.lane.toString(), tank: r.tank.toString(),
      x: r.spendable.toString(),
      share: spendSum > 0n ? Number((r.spendable * 1000000n) / spendSum) / 10000 : 0,
    }))
  const burned = L.totalBurned
  const fireBudget = burned * FIREBORN_SENDS_PER_KRAY
  return {
    glow: { symbol: GLOW_SYMBOL, total: glowTotal, holders: glowMap.size, rank: glowRank, rankTotal: glowMap.size },
    x: {
      symbol: 'Ӿ', name: 'Nyx', hybrid: 'Fenyx', aliases: ['Nyx', 'Fenyx', 'X'], law: 'FIREBORN',
      sendsPerKray: FIREBORN_SENDS_PER_KRAY.toString(),
      total: L.xEmitted.toString(), totalSpendable: spendSum.toString(), totalLane: laneSum.toString(),
      tankTotal: tankSum.toString(), tankBudget: fireBudget.toString(),
      holders: liveHolders, mintedHolders, rank: xRank, rankTotal: liveHolders,
    },
    conservation: {
      ok: L.conserves(),
      burned: burned.toString(),
      xMinted: L.xEmitted.toString(),
      xSpendable: spendSum.toString(),
      xLane: laneSum.toString(),
      tank: tankSum.toString(),
      fireBudget: fireBudget.toString(),
    },
  }
}

// THE RANK BOOKS a /rank page reads — ₭ holders + the two lights + supply + stars.
// Beat-window `work` is writer-live presence (not a journal book) — a follower leaves it empty
// and labelled, rather than relaying a mouth. Land needs sealed Bitcoin anchors this fold does
// not invent. Labels (`who`) are display-only; pass labelOf on the writer, omit on a mirror.
export function rankBooksView({ node, events, labelOf, network } = {}) {
  const L = node.ledger
  const whoOf = typeof labelOf === 'function' ? labelOf : () => null
  const PROTOCOL = new Set([TREASURY, BLACK_HOLE])
  const citizens = [...L.balances.entries()].filter(([a, b]) => !PROTOCOL.has(a) && b > 0n).map(([address, balance]) => ({ address, balance }))
  const totalHeld = citizens.reduce((t, a) => t + a.balance, 0n)
  const liveIns = L.stars.inscriptions().filter((x) => !x.cursed)
  const liveNames = L.stars.baptisms().filter((x) => !x.cursed)
  const insBy = new Map(), nameBy = new Map()
  for (const x of liveIns) insBy.set(x.by, (insBy.get(x.by) || 0) + 1)
  for (const bp of liveNames) nameBy.set(bp.by, (nameBy.get(bp.by) || 0) + 1)
  const glowMap = frozenStarGlow(events || [])
  const lights = lightsView({ node, events, labelOf: whoOf, top: null })
  const rank = citizens.map((a) => ({
    address: a.address, who: (whoOf(a.address) || {}).label || null, simulated: false, founder: false,
    balance: a.balance, share: totalHeld > 0n ? Number((a.balance * 1000000n) / totalHeld) / 10000 : 0,
    stars: L.stars.starsOf(a.address).length, works: insBy.get(a.address) || 0, names: nameBy.get(a.address) || 0,
    glow: String(glowMap.get(a.address) || 0), validating: false,
  })).sort((x, y) => (y.balance > x.balance ? 1 : y.balance < x.balance ? -1 : 0))
  const sup = node.supply()
  const shelves = {}; let writtenBytes = 0
  for (const x of liveIns) { const c = catOf(x.contentType); shelves[c] = (shelves[c] || 0) + 1; writtenBytes += x.size || 0 }
  const hole = blackHoleBooksView({ node, events })
  return {
    tip: node.seq, at: Date.now(), network: network || node.network, simulation: false, rankTotal: rank.length,
    chain: {
      conserves: L.conserves() && L.backed(), cascadeRoot: node.cascadeRoot(),
      height: node.seq, events: node.seq, interval: 0, blocksPerMin: 0,
    },
    supply: {
      total: sup.circulating, emitted: sup.emitted, burned: sup.burned, circulating: sup.circulating,
      treasury: L.balances.get(TREASURY) || 0n, vault: 0n, heldByCitizens: totalHeld, holders: citizens.length, fire: hole.fire,
    },
    pot: node.pot(), citizens: citizens.length, totalHeld,
    work: {
      windowSeals: 0, distinctProvers: 0, provenWork: '0', seals: 0, lastSealAt: null, local: true,
      note: 'Beat-window work is writer-live presence, not a journal book. ₭ · Ӿ · ✦ fold here from replay.',
    },
    rank,
    lights,
    stars: { total: L.stars.starCount, written: liveIns.length, named: liveNames.length },
    library: { works: liveIns.length, names: liveNames.length, bytes: writtenBytes, shelves, census: shelves },
    land: { totalLands: 0, totalLots: 0, local: true },
    blackHole: hole,
  }
}

// THE BLACK-HOLE REGISTER — frozen stars + the fire log, derived from the same journal the
// cascade already committed. /blackhole reads analytics.blackHole; a follower must not relay it.
export function blackHoleBooksView({ node, events } = {}) {
  const L = node.ledger
  const ev = events || []
  const freezeActs = new Map()
  const into = { inscribe: 0n, origin: 0n, name: 0n, law: 0n, sporadic: 0n }
  let acts = 0
  const log = []
  for (let i = ev.length - 1; i >= 0; i--) {
    const e = ev[i]
    if (e.kind === 'transfer-star' && e.to === BLACK_HOLE && e.star != null && !freezeActs.has(String(e.star))) {
      freezeActs.set(String(e.star), e)
    }
    if (e.kind === 'transfer' && e.to === BLACK_HOLE) {
      if (log.length < 48) log.push({
        kind: 'chosen', amount: String(e.amount ?? '0'), by: e.from ?? null, at: e.at ?? null,
        txHash: e.hash, star: null, name: null, size: null, contentType: null,
      })
      continue
    }
    if (e.kind === 'burn') {
      const amt = BigInt(e.amount ?? 0)
      into.sporadic += amt; acts++
      if (log.length < 48) log.push({
        kind: 'sporadic', amount: String(amt), by: e.from ?? null, at: e.at ?? null,
        txHash: e.hash, star: null, name: null, size: null, contentType: null,
      })
      continue
    }
    if (e.kind === 'contract') {
      into.law += 1n; acts++
      if (log.length < 48) log.push({
        kind: 'law', amount: '1', by: e.from ?? null, at: e.at ?? null,
        txHash: e.hash, star: e.star != null ? String(e.star) : null, name: null, size: null, contentType: null,
      })
      continue
    }
    if (e.kind === 'inscribe' || e.kind === 'origin' || e.kind === 'name') {
      const amt = BigInt(e.burn ?? e.amount ?? 1)
      into[e.kind] += amt; acts++
      if (log.length < 48) log.push({
        kind: e.kind, amount: String(amt), by: e.from ?? null, at: e.at ?? null,
        txHash: e.hash, star: e.star != null ? String(e.star) : null,
        name: e.name ?? null, size: e.size ?? null, contentType: e.contentType ?? null,
      })
    }
  }
  const entombed = L.stars.starsOf(BLACK_HOLE).map((no) => {
    const s = node.star(typeof no === 'bigint' ? no : BigInt(no))
    if (!s) return null
    const act = freezeActs.get(String(s.no))
    return {
      star: String(s.no), name: s.name || null,
      kind: (s.contentHash || s.name) ? 'relic' : 'star',
      category: s.contentHash ? catOf(s.contentType) : (s.name ? 'name' : 'work'),
      contentType: s.contentType || null, rarity: s.rarity || 'common',
      size: s.size || 0,
      url: s.contentHash ? '/content/' + s.contentHash : null,
      at: act ? act.at : null, by: act ? act.from : null, txHash: act ? act.hash : null,
    }
  }).filter(Boolean)
  const holeKray = L.balances.get(BLACK_HOLE) || 0n
  const fire = {
    destroyed: L.totalBurned.toString(),
    chosen: holeKray.toString(),
    total: (L.totalBurned + holeKray).toString(),
    acts,
    into: {
      inscribe: into.inscribe.toString(), origin: into.origin.toString(),
      name: into.name.toString(), law: into.law.toString(), sporadic: into.sporadic.toString(),
    },
    thawed: L.thawHasRun === true,
    tallyMatches: true,
    log,
    law: 'Fungible ₭ burns in the fire. A star sent to the hole freezes — that is ✦. circulating ₭ = emitted − burned.',
  }
  return {
    kray: holeKray.toString(), balance: holeKray, stars: entombed.length,
    entombed, relics: entombed, frozen: entombed, address: BLACK_HOLE, entombedCount: entombed.length,
    fire,
    law: 'The black hole is keyless — no signature can move anything out. Stars freeze. Fungible ₭ burns.',
    note: 'Stars freeze. Fungible ₭ burns. The register keeps every frozen star; the fire keeps every ₭ that died.',
  }
}
