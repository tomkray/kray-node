#!/usr/bin/env node
/**
 * THE FOLLOWER (v2) — the second node: a copy of this network that proves itself, and trusts nobody.
 *
 *   node scripts/follow/kray-follow.mjs [--from http://host:4477] [--dir ./follower] [--watch]
 *   (stable door: node scripts/kray-follow.mjs)
 *
 * MOVEMENT 2. The v1 follower proved the money but could not reproduce the cascade root (it committed to
 * six datasets, most with no endpoint). The v2 root is a PURE FUNCTION OF THE JOURNAL — balances, stars,
 * the pot, the consumed-seal set, runes, contracts, all of it — so this follower now proves the WHOLE
 * commitment Bitcoin witnessed, from one downloadable file, or it keeps nothing.
 *
 * ── WHAT THIS FOLLOWER REFUSES TO TAKE ON TRUST ─────────────────────────────
 *   · the journal: pulled raw, replayed through the SAME consensus reducer — every signature, every nonce,
 *     the 10,000 mint cap, credited-once, the window law (one seal, one cap, once ever), the black-hole
 *     no-spend law. One broken line and the whole boot refuses (fail-stop).
 *   · the root: re-DERIVED here and required to equal the head the server claims — byte for byte.
 *   · the anchors: the server's list is only a HINT. Each seal is re-proven from the follower's OWN
 *     bitcoind — raw tx bytes, merkle path, chained headers, real proof-of-work — via the SAME
 *     verifySealProof consensus uses (both shapes: OP_RETURN and the donation-IS-the-anchor output).
 *   · the lineage of roots: a seal's claimed root must be a root THIS journal actually passes through
 *     (every prefix root is re-derived event by event) — a seal of a foreign history counts for nothing.
 *
 * If all of it holds: there are TWO copies of the truth, each able to prove itself with no operator alive.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, linkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KrayNode } from '../../apps/kray-core/src/protocol/node.ts'
import { KrayLedger } from '../../apps/kray-core/src/protocol/ledger.ts'
import { scriptOfAddress, toBtcNet } from '../../apps/kray-core/src/protocol/scheme.ts'
import { BURN_INTERNAL_KEY } from '../../apps/kray-core/src/protocol/self-anchor.ts'
import { verifySealProof, extractKraySeal } from '../../apps/kray-core/src/anchor/spv.ts'
import { FOLLOWER_CONTRACT } from '../../apps/kray-core/src/protocol/consensus.ts'
import { assertFollowNetworkIsolation } from '../../apps/kray-net/network-boot.mjs'
import { createInbox } from '../../apps/kray-net/inbox.mjs'
import { chunkJournal, chunkAddress, verifyChunk, verifyManifest, DEFAULT_CHUNK_SIZE } from '../../apps/kray-core/src/protocol/journal-chunks.ts'
import { createPeerBook, isPublicHttpHost } from '../../apps/kray-net/peer-book.mjs'
import { boundedJson } from '../../apps/kray-net/bounded-fetch.mjs'
import { atlasView, libraryView, lightsView, rankBooksView } from '../../apps/kray-net/state-views.mjs'
import { docsPack, docsFile } from '../../apps/kray-net/docs-pack.mjs'

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d }
const FROM = arg('--from', 'http://127.0.0.1:4477').replace(/\/$/, '')
const DIR = arg('--dir', join(process.cwd(), 'follower'))
const WATCH = process.argv.includes('--watch')
const SERVE = parseInt(arg('--serve', '0'), 10) || 0   // read-only mirror port (0 = off)
// The explorer chrome this mirror also GET-serves (static, from THIS clone's apps/kray-net/) so a follower is
// not a mouthless book: opening / paints the "prove it yourself" UI against this node's OWN re-derived state,
// same origin, no external dependency. Read-only; the API + atlas below stay the verified snapshot.
const UI_DIR = fileURLToPath(new URL('../../apps/kray-net/', import.meta.url))
// Same pretty doors the writer ships — a validator opens /rank/nyx /rank/glow against ITS OWN fold.
const UI_PRETTY = {
  '/': 'index.html', '/index.html': 'index.html',
  '/validate': 'validate.html', '/mine-live': 'validate.html',
  '/verify': 'verify.html', '/proof': 'proof.html', '/anchor': 'anchor.html',
  '/network': 'network.html', '/nodes': 'network.html',
  '/burn': 'burn.html', '/burn-proof': 'burn.html',
  '/blocks': 'blocks.html', '/chain': 'blocks.html',
  '/rank': 'rank.html',
  '/rank/kray': 'rank.html', '/rank/nyx': 'rank.html', '/rank/x': 'rank.html', '/rank/fenyx': 'rank.html',
  '/rank/glow': 'rank.html', '/rank/luz': 'rank.html', '/rank/rune': 'rank.html',
  '/rank/stars': 'rank.html', '/rank/works': 'rank.html',
  '/dashboard': 'dashboard.html', '/library': 'library.html',
  '/mind': 'mind.html',
  '/docs': 'docs.html', '/inscribe': 'inscribe.html', '/send': 'send.html',
  '/baptize': 'baptize.html', '/mine': 'mine.html', '/rune': 'rune.html', '/runes': 'rune.html',
  '/defi': 'defi.html', '/pool': 'pool.html',
  '/blackhole': 'blackhole.html',
  '/land3d': 'landcity.html', '/city': 'landcity.html', '/land': 'map.html',
}
const UI_PARAM = [
  [/^\/star\/\d+\/?$/, 'star.html'],
  [/^\/rank\/luz\/\d+\/?$/, 'rank.html'],
  [/^\/block\/\w+\/?$/, 'block.html'],
  [/^\/tx\/[0-9a-f]+/i, 'tx.html'],
  [/^\/profile\/\w+/, 'profile.html'],
  [/^\/(?:u|address)\/\w+/, 'profile.html'],
  [/^\/(?:land|parcel)\/\w+/, 'map.html'],
  [/^\/pool\/[^/]+/, 'pool.html'],
]
const UI_REDIRECT = {
  '/x': '/rank/nyx', '/nyx': '/rank/nyx', '/fenyx': '/rank/nyx',
  '/glow': '/rank/glow', '/lights': '/rank', '/two-lights': '/rank',
}
const uiPageOf = (p) => UI_PRETTY[p] || ((UI_PARAM.find(([rx]) => rx.test(p)) || [])[1] || null)
const UI_MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.wasm': 'application/wasm' }
// ADR-2 2a · --from-chunks pulls the journal in CONTENT-ADDRESSED pieces from a peer set (FROM + --peers),
// each chunk fetched from ANY peer that serves valid bytes and verified against the head — so a follower
// reconstructs even when the writer is down, from other followers, trusting no peer for the bytes.
const USE_CHUNKS = process.argv.includes('--from-chunks')
const PEERS = [FROM, ...String(arg('--peers', '')).split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)]
const PAGE = 2000
/** THE MIRROR STATE — the last snapshot that SURVIVED every check. The mirror serves this and only this:
 *  if the writer dies or starts lying, the mirror keeps serving the last VERIFIED truth, marked stale —
 *  availability without ever serving an unverified byte. Writes cannot exist here: only GET routes are
 *  constructed, so there is no write path to gate and none to forget. */
let current = null   // { node, dataDir, lines, network, verifiedAt }
let staleSince = null
const BTC_RPC = process.env.KRAY_BTC_RPC || ''
const BTC_USER = process.env.KRAY_BTC_RPC_USER || 'kraycore'
const BTC_PASS = process.env.KRAY_BTC_RPC_PASS || ''
// ADR-3 3d-a · seal-height re-proof burial depth. Deep enough (≥ the writer's anchor-confirm threshold) that a
// SHALLOW reorg cannot RELOCATE a seal tx to a different-height block and flip an honest seal from unprovable to
// a false "lied height" (verify-council #2). A seal not yet this deep on MY node is weight-zero, never a lie.
const SEAL_CONF = Math.max(1, parseInt(process.env.KRAY_SEAL_CONF || '6', 10) || 6)

/** ADR-3 3b · THE MIRROR'S MAILBOX — the one POST a mirror may hold. It stores a citizen's SIGNED
 *  act and relays it to the writer; it never applies, never journals, never judges (only the
 *  writer's door does). This is exactly how an act survives a writer outage: any mirror that heard
 *  it holds it durably and mails it forward when the writer answers again. The mirror's read-only
 *  law is intact — no path here can touch the verified snapshot. KRAY_FOLLOW_INBOX=0 turns it off. */
const inbox = SERVE && process.env.KRAY_FOLLOW_INBOX !== '0' ? createInbox({ dir: join(DIR, 'inbox') }) : null
const INBOX_TTL_SEC = Math.max(3600, parseInt(process.env.KRAY_FOLLOW_INBOX_TTL_SEC || String(7 * 86400), 10) || 7 * 86400)
let _inboxHits = { t: 0, n: 0 }
function inboxFlooded() {
  const now = Date.now()
  if (now - _inboxHits.t > 60_000) _inboxHits = { t: now, n: 0 }
  return ++_inboxHits.n > 120
}
let _relaying = false
/** Mail pending acts to the writer's own inbox. Writer unreachable / inbox-full → stay pending,
 *  silently (the outage IS the use case). An explicit writer refusal (bad shape) → refused here too. */
async function relayPending(limit = 50) {
  if (!inbox || _relaying) return
  _relaying = true
  try {
    inbox.sweep(INBOX_TTL_SEC)
    for (const env of inbox.pending(limit)) {
      try {
        const r = await fetch(FROM + '/api/kraynet/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(env.act) })
        const out = await r.json().catch(() => ({}))
        if (r.ok && out && out.ok) inbox.markApplied(env.id, { relayed: true, writer: FROM, writerId: out.id ?? null, applied: out.applied ?? out.duplicate ?? false, seq: out.seq ?? null })
        else if (r.status === 429 || r.status >= 500) break            // writer busy/full — retry next cycle, in order
        else inbox.markRefused(env.id, `the writer refused this act at its own inbox — ${(out && out.error) || `HTTP ${r.status}`}`)
      } catch { break }                                                 // writer unreachable — the mailbox holds; next cycle
    }
  } finally { _relaying = false }
}

// ADR-2 2a hardening (council): every peer fetch has a wall-clock TIMEOUT — so a connected-but-silent
// (slowloris) peer can never hang the sequential fallback loop — and a response-body BYTE CEILING — so a
// peer cannot OOM the follower with a giant body before verification even runs. A follower is a client:
// bounds, not proofs. Authenticity still lives in the replay + root + --from head + Bitcoin anchor.
const FETCH_TIMEOUT_MS = parseInt(process.env.KRAY_FOLLOW_FETCH_TIMEOUT_MS || '180000', 10) || 180000
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024   // a chunk may carry a 10 MB inscription (base64 ~14 MB) — 64 MB gives headroom
// one bounded fetch, shared byte-for-byte with the node's gossip (apps/kray-net/bounded-fetch.mjs) — the
// discipline (timeout + streamed byte ceiling) is written once and proven once (bounded-fetch.test.mjs).
const fetchBoundedJson = (url) => boundedJson(url, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_RESPONSE_BYTES })
const get = (path) => fetchBoundedJson(FROM + path)
async function btc(method, params = []) {
  const r = await fetch(BTC_RPC, {
    method: 'POST', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${BTC_USER}:${BTC_PASS}`).toString('base64') },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'follower', method, params }),
  }).then((x) => x.json())
  if (r.error) throw new Error(`bitcoind ${method}: ${r.error.message}`)
  return r.result
}

/** Build the SPV proof of a seal txid from the follower's OWN bitcoind — never from the server. */
async function proofFromMyBitcoin(txid, minHeaders = 1) {
  const rawTx = await btc('getrawtransaction', [txid, false])
  const txoutproof = await btc('gettxoutproof', [[txid]])
  const v = await btc('getrawtransaction', [txid, true])
  const h0 = await btc('getblockheader', [v.blockhash, true])
  const tip = await btc('getblockcount', [])
  const headers = []
  for (let i = 0; i < Math.max(minHeaders, 2) && h0.height + i <= tip; i++) {
    headers.push(await btc('getblockheader', [await btc('getblockhash', [h0.height + i]), false]))
  }
  return { rawTx, txoutproof, headers }
}

/** ADR-3 3d-a · the seal SPV proof PLUS the block's coinbase (merkle index 0), so verifySealProof can re-derive
 *  the BIP-34 height — the seal's journaled l1Height, re-proven against MY OWN Bitcoin. */
async function heightProofFromMyBitcoin(txid, minHeaders = 1) {
  const base = await proofFromMyBitcoin(txid, minHeaders)
  const v = await btc('getrawtransaction', [txid, true])
  const blk = await btc('getblock', [v.blockhash, 1])
  const coinbaseTx = await btc('getrawtransaction', [blk.tx[0], false, v.blockhash])
  const coinbaseProof = await btc('gettxoutproof', [[blk.tx[0]], v.blockhash])
  return { ...base, coinbaseTx, coinbaseProof }
}

/** ADR-2 2a · reconstruct the journal from CONTENT-ADDRESSED chunks across a peer set, trusting no peer
 *  for the bytes: the manifest comes from any peer whose head matches the AUTHENTIC head (from --from, the
 *  operator's trust choice + the anchor); each chunk is fetched from ANY peer that serves bytes whose SHA-256
 *  matches the address AND whose chain verifies against its boundary; the whole manifest must reconstruct
 *  genesis → that head. Every fetch is timeout- and size-bounded, so a peer that is down, lying, silent, or
 *  serving a giant/forged body costs nothing — the loop falls back to an honest peer. Authenticity is never
 *  the peers': the follower still replays the result and checks the root against --from + Bitcoin.
 *
 *  2c-wire — the byte-honesty the peer-book promised is DECIDED here and signalled back: a peer that serves a
 *  VALID chunk is `prove`d (a protected, tried-first source next time — honest-peer headroom); a peer that
 *  serves an INVALID chunk (bytes whose address/chain do not verify) is a definitive byte-LIE and is `demote`d.
 *  Silence/down is liveness noise, NOT a lie — it is left to the book's own head refresh, so a transient blip
 *  never strips an honest peer of its proven status. Peers are TRIED in the book's order (proven first). */
async function reconstructFromChunks(peers, expectedHead, book = null) {
  const getFrom = (base, path) => fetchBoundedJson(base + path)
  const order = book && book.peers().length ? book.peers() : peers   // proven deliverers first
  let manifest = null
  for (const peer of order) {
    try {
      const m = await getFrom(peer, '/api/kraynet/chunks')
      // accept a manifest ONLY if its head is the authentic one — a forged manifest is discarded at
      // selection time (not merely caught by the downstream replay), and an honest peer's manifest is tried.
      if (m && Array.isArray(m.chunks) && /^[0-9a-f]{64}$/.test(String(m.head)) && (!expectedHead || m.head === expectedHead)) { manifest = m; break }
    } catch { /* down / silent / oversized / forged — try the next peer */ }
  }
  if (!manifest) throw new Error(expectedHead ? 'no peer served a chunk manifest matching the authentic head' : 'no peer served a chunk manifest')
  const chunks = []
  for (const c of manifest.chunks) {
    let got = null
    for (const peer of order) {
      try {
        const r = await getFrom(peer, '/api/kraynet/chunk/' + c.address)
        if (r && Array.isArray(r.lines) && chunkAddress(r.lines) === c.address &&
            verifyChunk({ lines: r.lines, startPrevHash: c.startPrevHash, startSeq: c.startSeq, address: c.address, endHash: c.endHash }).ok) {
          got = r.lines; if (book) book.prove(peer); break        // a valid chunk → this peer is a proven deliverer
        } else if (r && Array.isArray(r.lines) && book) {
          book.demote(peer)   // it answered with bytes that do NOT verify — a definitive byte-lie, drop it
        }
      } catch { /* down / silent — liveness noise, not a lie; the head refresh judges it */ }
    }
    if (!got) throw new Error(`no peer served a valid chunk for ${String(c.address).slice(0, 12)}…`)
    chunks.push({ index: c.index, startSeq: c.startSeq, endSeq: c.endSeq, startPrevHash: c.startPrevHash, endHash: c.endHash, address: c.address, lines: got })
  }
  const mv = verifyManifest(chunks, manifest.head)
  if (!mv.ok) throw new Error(`the reconstructed chunks do not reach the head — ${mv.reason}`)
  return { lines: chunks.flatMap((c) => c.lines), head: manifest.head }
}

/** ADR-2 2c-wire · turn --from + --peers into a LEARNED, head-verified source set. We seed a peer-book with the
 *  hand-given peers, ask --from for its /peers list (bounded), then verify every candidate against the AUTHENTIC
 *  head (from --from + the anchor). The reconstruction then prefers proven deliverers. If discovery finds
 *  nothing (an old node with no /peers), we fall back to exactly the hand-given peers — never worse than before. */
async function discoverPeers(seedPeers, authenticHead) {
  const book = createPeerBook({ maxPeers: 64, self: '' })
  book.addMany(seedPeers)                          // operator-chosen seeds (--from + --peers) are trusted, never filtered
  // SSRF guard (council): if --from is a PUBLIC host the operator is following a public mesh, so LEARNED peers
  // must be public too (no loopback/metadata/RFC1918). If --from is local (regtest/dev), keep loopback discovery.
  const filterLearned = isPublicHttpHost(FROM)
  try {
    const j = await fetchBoundedJson(FROM + '/api/kraynet/peers')
    if (j && Array.isArray(j.peers)) {
      let learned = j.peers.slice(0, 64)
      if (filterLearned) learned = learned.filter(isPublicHttpHost)
      book.addMany(learned)
    }
  } catch { /* --from has no discovery endpoint — the seed peers still stand */ }
  await book.refresh(authenticHead, async (u) => {
    const h = await fetchBoundedJson(u + '/api/kraynet/head'); return h && h.head
  })
  return book
}

async function main() {
  console.log(`\n₭  THE SECOND NODE — verifying ${FROM}, trusting none of it\n`)
  const head = await get('/api/kraynet/head')
  const network = head.network
  try { assertFollowNetworkIsolation({ from: FROM, dir: DIR, writerNetwork: network }) }
  catch (e) { console.error(`  ✗ ${(e && e.message) || e}\n`); process.exit(1) }
  // persist (--watch or --serve) → each cycle builds in its OWN run dir and becomes `current`
  // only if every check survives (the live snapshot is never wiped underneath a reader).
  // one-shot → classic rebuilt-from-scratch single dir.
  const persist = SERVE || WATCH
  const runRoot = persist ? join(DIR, `run-${Date.now()}`) : DIR
  const dataDir = join(runRoot, `node-${network}`)
  if (!persist && existsSync(DIR)) rmSync(DIR, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })

  // ── 1 · pull the ONE consensus dataset: the raw journal ──
  const lines = []
  if (USE_CHUNKS) {
    // multi-peer, content-addressed: fetch each verified chunk from ANY peer that has it (writer OR another
    // follower), so reconstruction survives any single peer being down — the availability the network exists for.
    // 2c-wire: discover peers (seed + --from's /peers, all head-verified), then prefer proven deliverers.
    const book = await discoverPeers(PEERS, String(head.head || ''))
    const rc = await reconstructFromChunks(PEERS, String(head.head || ''), book)
    lines.push(...rc.lines)
    console.log(`  reconstructed ${lines.length} event(s) from ${book.peers().length || PEERS.length} verified peer(s) in content-addressed chunks — each self-proven against the head ${String(rc.head).slice(0, 16)}…, no peer trusted for the bytes\n`)
  } else {
    let from = 1, total = Infinity
    while (from <= total) {
      const page = await get(`/api/kraynet/replica?from=${from}&limit=${PAGE}`)
      total = page.total
      if (!page.lines?.length) break
      lines.push(...page.lines)
      from += page.lines.length
    }
  }
  writeFileSync(join(dataDir, `kraynet-journal-${network}.jsonl`), lines.length ? lines.join('\n') + '\n' : '')
  console.log(`  pulled ${lines.length} journal event(s) — the server claims height ${head.height}, root ${String(head.cascadeRoot).slice(0, 16)}…, none of which is believed\n`)

  // ── 1b · THE ATLAS FIRST — windowed-settlement custody is verified against the INSCRIBED BYTES
  //          (store.ts reads DATA_DIR/content on apply), so a follower MUST hold them BEFORE it can
  //          replay. Pull + sha256-check every inscribed content NOW; the KrayNode replay below AND the
  //          prefix-root ledger then read them through this same atlas. Ordering it after the replay is
  //          exactly what fail-closed a fresh Signet clone: the first windowed settlement HALTs on the
  //          bytes it does not yet hold. (Watch mode reuses what a prior run already verified.) ──
  const atlasBytes = (h) => { try { const p = join(dataDir, 'content', h); return existsSync(p) ? new Uint8Array(readFileSync(p)) : null } catch { return null } }
  const wantContent = new Set()
  for (const line of lines) { const e = JSON.parse(line); if ((e.kind === 'inscribe' || e.kind === 'origin') && /^[0-9a-f]{64}$/.test(String(e.contentHash || ''))) wantContent.add(e.contentHash) }
  let atlasHeld = 0, atlasJunk = 0, atlasMissing = 0, atlasReused = 0
  if (wantContent.size) {
    const contentDir = join(dataDir, 'content'); mkdirSync(contentDir, { recursive: true })
    // Reuse already-verified bytes from the PREVIOUS run instead of re-downloading the whole atlas every
    // 30s watch cycle — from this session's `current`, or the CURRENT pointer on disk after a restart. A
    // byte is reused only if it STILL hashes to its journaled name; a corrupt/edited file falls back to a fetch.
    let priorContentDir = null
    try {
      const pd = (current && current.dataDir) || (existsSync(join(DIR, 'CURRENT')) ? readFileSync(join(DIR, 'CURRENT'), 'utf8').trim() : null)
      if (pd && pd !== dataDir && existsSync(join(pd, 'content'))) priorContentDir = join(pd, 'content')
    } catch { /* no prior — fetch everything */ }
    for (const h of wantContent) {
      if (existsSync(join(contentDir, h))) { atlasHeld++; continue }   // already in THIS run
      if (priorContentDir && existsSync(join(priorContentDir, h))) {   // reuse the prior verified copy, re-hashed
        // Content is immutable and hash-named, so instead of COPYING the prior run's bytes we HARDLINK them:
        // the new run gets a second name for the very same inode — nothing is duplicated on disk, and the
        // atlas is stored exactly once no matter how many run-* coexist. Re-hash first so a corrupted prior
        // self-heals (mismatch → fetch fresh). Fall back to a plain write only if the FS refuses the link.
        try { const pp = join(priorContentDir, h); const pb = readFileSync(pp); if (createHash('sha256').update(pb).digest('hex') === h) { try { linkSync(pp, join(contentDir, h)) } catch { writeFileSync(join(contentDir, h), pb) } atlasHeld++; atlasReused++; continue } } catch { /* fall through to fetch */ }
      }
      try {
        const r = await fetch(FROM + '/content/' + h, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        if (!r.ok) { atlasMissing++; continue }
        const buf = Buffer.from(await r.arrayBuffer())
        if (createHash('sha256').update(buf).digest('hex') !== h) { atlasJunk++; console.log(`  ✗ content ${h.slice(0, 12)}… served bytes that do NOT hash to the journaled hash — junk refused`); continue }
        writeFileSync(join(contentDir, h), buf); atlasHeld++
      } catch { atlasMissing++ }
    }
    if (atlasMissing || atlasJunk) {
      console.error(`\n  ✗ THE ATLAS IS INCOMPLETE — ${atlasHeld}/${wantContent.size} held (${atlasMissing} missing, ${atlasJunk} junk). A follower cannot replay windowed settlements without the inscribed bytes, and a partial replica would serve a history it never verified. Fail-closed.\n`)
      if (persist) { staleSince = staleSince ?? Date.now(); if (existsSync(runRoot)) rmSync(runRoot, { recursive: true, force: true }); return false }
      process.exit(1)
    }
  }

  // ── 2 · THE REPLAY IS THE AUDIT — the same consensus reducer, every law, or nothing ──
  // ADR-1 opt-in, now OPEN to followers too: KRAY_POT_ADDRESS arms the fixed-pot proof re-verify;
  // KRAY_POT_INTERNAL_KEY (public — NUMS on a burn network, so `nums` is accepted as a name) arms the
  // SELF-ANCHOR re-derive. Set them and this follower re-proves every journaled burn from bytes on
  // replay; unset, the replay is byte-identical to before (the writer's door remains the gate).
  let node
  const potScript = process.env.KRAY_POT_ADDRESS ? scriptOfAddress(process.env.KRAY_POT_ADDRESS, toBtcNet(network)) : undefined
  const rawFollowKey = (process.env.KRAY_POT_INTERNAL_KEY || '').toLowerCase()
  const potInternalKey = rawFollowKey === 'nums' ? BURN_INTERNAL_KEY
    : /^0[23][0-9a-f]{64}$/.test(rawFollowKey) ? rawFollowKey.slice(2)
    : /^[0-9a-f]{64}$/.test(rawFollowKey) ? rawFollowKey : undefined
  try { node = new KrayNode(dataDir, network, undefined, potScript, false, potInternalKey) }
  catch (e) { console.error(`  ✗ THE HISTORY DOES NOT REPLAY — this follower keeps nothing.\n    ${e.message}\n`); process.exit(1) }
  if (potScript || potInternalKey) console.log(`  · ADR-1 re-verify armed on this follower (${potScript ? 'pot script' : ''}${potScript && potInternalKey ? ' + ' : ''}${potInternalKey ? 'self-anchor internal key' : ''})`)

  const checks = []
  const check = (ok, label) => { checks.push({ ok, label }); console.log(`  ${ok ? '✓' : '✗'} ${label}`); return ok }

  const L = node.ledger
  check(node.seq === lines.length, `the hash chain accepted all ${lines.length} event(s), in order (fail-stop on one torn line)`)
  check(L.conserves(), 'the ledger CONSERVES after every single event — nothing appears, nothing vanishes')
  check(L.backed(), `the PEG-OF-SACRIFICE holds: every ₭ emitted is backed by a real satoshi donated (${L.totalEmitted} ≤ ${L.pot.satsDonated})`)
  const mine = node.cascadeRoot()
  check(mine === String(head.cascadeRoot).toLowerCase(),
    `the cascade root RE-DERIVED HERE equals the head the server claims — ${mine.slice(0, 16)}… (the WHOLE commitment, from the journal alone)`)

  // ── 3 · every prefix root, re-derived — the set of roots this history actually passes through.
  //        Kept as root → seq so the mirror can also answer LINEAGE (custody doctrine rung 3): a guardian
  //        daemon asks "does your current history still pass through the root I last co-signed against?" —
  //        membership here IS descendance, because the cascade root at seq S commits events 1..S. ──
  const rootSeq = new Map()
  {
    const fresh = new KrayLedger(undefined, network, undefined, false, atlasBytes)   // same atlas as §1b, or windowed settlements HALT here too
    rootSeq.set(fresh.cascadeRoot().toLowerCase(), 0)           // the genesis root
    let s = 0
    for (const line of lines) {
      fresh.applyLive(JSON.parse(line)); s++
      const r = fresh.cascadeRoot().toLowerCase()
      if (!rootSeq.has(r)) rootSeq.set(r, s)
    }
  }

  // ── 3b · every DONATION re-proven from MY OWN Bitcoin — the minted amount must BE the on-chain
  //         output value at the journaled outpoint. This closes the last door on a lying server: even a
  //         forger who rebuilt the whole hash chain cannot invent a satoshi Bitcoin never saw burned. ──
  if (BTC_RPC && BTC_PASS) {
    let dProven = 0, dRefuted = 0
    for (const line of lines) {
      const e = JSON.parse(line)
      if (e.kind !== 'donate' || !e.outpoint) continue
      try {
        const [txid, voutStr] = String(e.outpoint).split(':')
        const v = await btc('getrawtransaction', [txid, true])
        const out = v.vout?.[Number(voutStr)]
        const sats = out ? BigInt(Math.round(out.value * 1e8)) : -1n
        if (sats === BigInt(e.amount) && (v.confirmations ?? 0) >= 1) dProven++
        else { dRefuted++; console.log(`  ✗ donate ${String(txid).slice(0, 12)}… journals ${e.amount} but Bitcoin holds ${sats} (${v.confirmations ?? 0} conf) — forged value`) }
      } catch (err) { dRefuted++; console.log(`  ✗ donate outpoint ${String(e.outpoint).slice(0, 16)}… not provable from MY bitcoind — ${err.message}`) }
    }
    check(dRefuted === 0, `${dProven} donation(s) re-proven against Bitcoin itself — every minted ₭ maps to a satoshi really burned (a lying server cannot invent one)`)
  }

  // ── 4 · the anchors — every seal re-proven from MY OWN Bitcoin, both shapes ──
  let proven = 0, refuted = 0, foreign = 0, skipped = 0
  // rung 3 · the deepest PROVEN anchor root of this history (by seq) — a guardian daemon may also pin
  // descendance from it. Named only when THIS box re-proved it on its own bitcoind; never a server hint.
  let lastProvenAnchor = null
  const hints = (await get('/api/kraynet/anchors').catch(() => ({ anchors: [] }))).anchors || []
  if (!BTC_RPC || !BTC_PASS) {
    if (hints.length) console.log(`  ⚠ ${hints.length} anchor(s) known but NO bitcoind configured here (KRAY_BTC_RPC/_PASS) — a follower without its own Bitcoin cannot weigh them; skipping, honestly.`)
    skipped = hints.length
  } else {
    for (const a of hints) {
      if (!rootSeq.has(String(a.root).toLowerCase())) { foreign++; console.log(`  ✗ anchor ${String(a.txid).slice(0, 12)}… seals a root this journal NEVER produces — foreign history, counts for nothing`); continue }
      try {
        const proof = await proofFromMyBitcoin(a.txid)
        const v = verifySealProof(proof, { cascadeRoot: String(a.root).toLowerCase(), blockNumber: a.blockNumber, minConfirmations: 1, net: network })
        if (v.ok) {
          proven++
          const ar = String(a.root).toLowerCase(), as = rootSeq.get(ar)
          if (as !== undefined && (!lastProvenAnchor || as > lastProvenAnchor.seq)) lastProvenAnchor = { root: ar, seq: as }
        }
        else { refuted++; console.log(`  ✗ anchor ${String(a.txid).slice(0, 12)}… REFUTED from raw bytes: ${v.reason}`) }
      } catch (e) { refuted++; console.log(`  ✗ anchor ${String(a.txid).slice(0, 12)}… could not be proven from MY bitcoind — ${e.message}`) }
    }
    // THE FORK-CHOICE POLICY, not panic: a refuted or foreign hint weighs ZERO and is reported — it can
    // never poison the copy (else one junk entry would let a malicious server DoS every follower). What IS
    // fatal: the server claims anchors and NONE survives — a history whose every seal refutes is not served.
    check(proven > 0 || hints.length === 0,
      `${proven}/${hints.length} Bitcoin seal(s) re-proven from MY OWN node — raw bytes, merkle path, real work${refuted + foreign ? ` (${refuted + foreign} hint(s) refuted/foreign — weight ZERO, reported, never served as proof)` : ''}`)
  }

  // ── 4b · ADR-3 3d-a — every ACTIVATED seal's l1Height RE-PROVEN from MY OWN Bitcoin, bound to the root its
  //          anchor commits (l1Root), straight from the JOURNAL — NO server hint (the mirror serves no /anchors).
  //          The journal-internal binding (l1Root is a root THIS history produced, seq_anchor monotonic, the
  //          windowCommitment fold) is already discharged by the replay above: the reducer THROWS on a bad l1Root,
  //          so a surviving snapshot has it. Section 4b adds ONLY the Bitcoin binding — l1Txid really commits
  //          l1Root, buried at l1Height. So the writer cannot pair a stale height with the current inclusion set.
  //          ONLY A PROVEN CONTRADICTION IS FATAL (a readable OP_RETURN root ≠ l1Root, or a proven btcHeight ≠
  //          l1Height); unprovable / node-behind / pruned / a POT-key self-anchor I cannot reconstruct = WEIGHT
  //          ZERO + reported (a server withholding proof material DoSes nobody). Pre-activation seals carry no
  //          l1Root, so they are skipped here (their anchors are the tolerant section-4 hint re-proof). ──
  if (BTC_RPC && BTC_PASS) {
    let hProven = 0, hLied = 0, hSoft = 0
    for (const line of lines) {
      const e = JSON.parse(line)
      if (e.kind !== 'seal' || !Number.isInteger(e.l1Height) || !Number.isInteger(e.l1BlockNumber)) continue
      if (!/^[0-9a-f]{64}$/i.test(String(e.l1Txid || '')) || !/^[0-9a-f]{64}$/i.test(String(e.l1Root || ''))) continue
      const txid = String(e.l1Txid).toLowerCase(), l1Root = String(e.l1Root).toLowerCase()
      let proof
      try { proof = await heightProofFromMyBitcoin(txid, SEAL_CONF) }
      catch (err) { hSoft++; console.log(`  · seal ${txid.slice(0, 12)}… height unprovable from MY bitcoind (${err.message}) — weight zero`); continue }
      // OP_RETURN readable-root pre-check: a READABLE committed root that differs from l1Root is a PROVEN lie.
      const opret = extractKraySeal(proof.rawTx)
      if (opret && (opret.cascadeRoot !== l1Root || opret.blockNumber !== e.l1BlockNumber)) {
        hLied++; console.log(`  ✗ seal ${txid.slice(0, 12)}… OP_RETURN commits (${opret.cascadeRoot.slice(0, 12)}…, blk ${opret.blockNumber}) but journals (${l1Root.slice(0, 12)}…, blk ${e.l1BlockNumber}) — binding falsehood`); continue
      }
      const v = verifySealProof(proof, { cascadeRoot: l1Root, blockNumber: e.l1BlockNumber, minConfirmations: SEAL_CONF, net: network })
      if (v.ok && Number.isInteger(v.btcHeight)) {
        if (v.btcHeight === e.l1Height) hProven++
        else { hLied++; console.log(`  ✗ seal ${txid.slice(0, 12)}… commits its root at Bitcoin height ${v.btcHeight}, but journals l1Height ${e.l1Height} — a SHIFTED omission boundary, refused`) }
      } else { hSoft++ }   // root not bound from my view / not yet ${SEAL_CONF}-deep / height unreadable / a POT-key or keyless self-anchor with an unmatched root — weight zero
    }
    if (hProven + hLied > 0) {
      // honest scope (verify-council #4): the "trustless" claim covers the seals PROVEN here (OP_RETURN + keyless
      // burn with a matched root); a weight-zero seal is UNPROVEN, not asserted. A self-anchor whose committed
      // root cannot be reconstructed (a pot-key shape, or a not-yet-deep tx) is reported, never a lie or a proof.
      check(hLied === 0, `${hProven} activated seal height(s) BITCOIN-BOUND from MY OWN node via BIP-34 (each height paired to the root its anchor commits) — for those, the 3d-a censorship boundary is the writer's word no longer${hSoft ? `; ${hSoft} weight-zero (unproven from my node, never asserted, never a lie)` : ''}`)
    }
  }

  // ── 5 · THE ATLAS was pulled + sha256-checked BEFORE the replay (§1b) — the only order in which a
  //         windowed settlement can verify its custody against real bytes. Assert its completeness in
  //         the audit list here (the fetch already fail-closed above if anything was missing/junk). ──
  if (wantContent.size) {
    check(atlasJunk === 0 && atlasMissing === 0 && atlasHeld === wantContent.size,
      `THE ATLAS: ${atlasHeld}/${wantContent.size} inscribed content(s) held and hash-checked${atlasReused ? ` (${atlasReused} reused from the prior run, ${atlasHeld - atlasReused} fetched)` : ''} — a validator replica keeps the same stars as the writer`)
  }

  console.log('\n  THE FOLLOWER CONTRACT')
  for (const rule of FOLLOWER_CONTRACT) console.log(`   · ${rule}`)

  const failed = checks.filter((c) => !c.ok)
  if (failed.length) {
    console.error(`\n  ✗ ${failed.length} check(s) failed — this follower SERVES NOTHING new. A replica that would serve an unverified history turns one operator's mistake into consensus.\n`)
    if (persist) { staleSince = staleSince ?? Date.now(); if (existsSync(runRoot)) rmSync(runRoot, { recursive: true, force: true }); return false }
    process.exit(1)
  }
  console.log(`\n  ✓ VERIFIED, AND NOW THERE ARE TWO. ${lines.length} event(s) replayed under every law this network has, the whole cascade root re-derived from the journal alone, and ${proven} Bitcoin seal(s) re-proven against a chain nobody here controls${skipped ? ` (${skipped} skipped — no local bitcoind)` : ''}. This copy can prove it is the real history to anyone, forever, with no operator alive. Kept at ${dataDir} ₭\n`)
  if (persist) {
    const prev = current
    current = {
      node, dataDir, runRoot, lines, network, verifiedAt: Date.now(), rootSeq, lastProvenAnchor,
      events: lines.map((l) => JSON.parse(l)),
    }
    staleSince = null
    try { writeFileSync(join(DIR, 'CURRENT'), dataDir + '\n') } catch { /* pointer is convenience, not consensus */ }
    // The atomic swap is complete: `current` (and CURRENT on disk) now point at the run just VERIFIED, and
    // the read-only mirror serves EVERY byte through `current` — /content reads current.dataDir SYNCHRONOUSLY
    // (no await between capturing current and readFileSync), so a request can never span the swap and only
    // ever reads the run we keep. Release the previous run's lock, then sweep every run-* that is NOT the
    // verified one — the prev this session AND any orphan a killed/restarted watch left behind. Best-effort:
    // a dir still in use is left for the next cycle. inbox/ is never a run-* and is never touched. A failed
    // cycle returns BEFORE this, so CURRENT never regresses — the mirror keeps serving the last fully-proven
    // snapshot no matter what happens here. (So this house-keeping cannot cause a read to miss anything.)
    if (prev) { try { prev.node.lock?.release?.() } catch { /* held only by us */ } }
    try { for (const name of readdirSync(DIR)) { if (name.startsWith('run-') && join(DIR, name) !== runRoot) { try { rmSync(join(DIR, name), { recursive: true, force: true }) } catch { /* still in use — next cycle */ } } } } catch { /* DIR unreadable — skip */ }
  }
  return true
}

/**
 * THE READ-ONLY MIRROR — availability without a single unverified byte. Serves ONLY the last snapshot
 * that survived every check above; every response names the height/root it was verified at (a reader
 * always knows how fresh the truth is). No write path EXISTS by construction — any POST is refused with
 * the writer's address, so the mirror can never fork the history it mirrors.
 */
// content-type for a held hash, from the replayed ledger (a follower keeps no <hash>.json
// sidecar — the inscription's signed type IS the truth). Cached per verified snapshot so a hot
// atlas never re-scans. Read-only: the type only decides how the byte-exact /content door labels
// the SAME sealed bytes — so an image paints in the explorer, and a page still cannot run a script.
let _ctIndex = { root: null, map: null }
function contentTypeOf(node, hash) {
  const root = node.cascadeRoot()
  if (_ctIndex.root !== root) {
    const map = new Map()
    for (const x of node.ledger.stars.inscriptions()) map.set(x.contentHash, x.contentType)
    _ctIndex = { root, map }
  }
  return _ctIndex.map.get(hash) || 'application/octet-stream'
}

function startMirror(port) {
  const BIND = process.env.KRAY_FOLLOW_BIND || '127.0.0.1'
  const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers }); res.end(JSON.stringify(body, (_k, v) => typeof v === 'bigint' ? v.toString() : v)) }
  const meta = () => current ? { mirror: true, of: FROM, verifiedAt: current.verifiedAt, verifiedHeight: current.node.seq, verifiedRoot: current.node.cascadeRoot(), ...(staleSince ? { stale: true, staleSince } : {}) } : null
  const readBody = (req) => new Promise((resolve) => {
    let b = ''
    req.on('data', (c) => { b += c; if (b.length > 32 * 1024 * 1024) req.destroy() })
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}) } catch { resolve(null) } })
  })
  createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${port}`)
      const p = url.pathname
      // ADR-3 3b · the ONE POST a mirror holds: a signed act into the mailbox (works even before the
      // first verified snapshot — a mirror born during an outage is exactly when the mailbox matters).
      if (inbox && p === '/api/kraynet/inbox' && req.method === 'POST') {
        if (inboxFlooded()) return send(res, 429, { error: 'too many acts this minute — the mailbox is paced' })
        const body = await readBody(req)
        if (body === null) return send(res, 400, { error: 'invalid JSON body' })
        const took = inbox.accept(body)
        if (!took.ok) return send(res, took.code, { error: took.error })
        relayPending().catch(() => {})   // try to mail it forward right now; failure keeps it held
        return send(res, 200, { ok: true, id: took.id, stored: true, duplicate: !!took.duplicate, mirror: true, writer: FROM, note: took.duplicate ? 'already held here' : 'held on this mirror — it will be relayed to the writer, and survives the writer being down' })
      }
      if (inbox && p === '/api/kraynet/inbox' && req.method === 'GET') {
        return send(res, 200, { ok: true, mirror: true, of: FROM, ...inbox.status() })
      }
      // EARN — relay the presence beat (PoW) to the writer, so a validator earns from its OWN node's /validate.
      // A beat is not consensus state (the mirror stays read-only for STATE) — it's a signed presence claim the
      // writer credits at settlement; the follower carries it forward like the mailbox and returns the writer's
      // verdict. The GET beat/challenge already relays; this is the POST that submits the mined beat.
      if (p === '/api/kraynet/beat' && req.method === 'POST') {
        const body = await readBody(req)
        if (body === null) return send(res, 400, { error: 'invalid JSON body' })
        try {
          const r = await fetch(FROM + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
          const j = await r.json().catch(() => ({}))
          return send(res, r.status, { ...j, viaMirror: FROM })
        } catch { return send(res, 502, { error: `the writer (${FROM}) is unreachable — the beat was not delivered`, mirror: true, of: FROM }) }
      }
      if (req.method !== 'GET') return send(res, 403, { error: `this is a READ-ONLY mirror — it verifies, it never writes. Send writes to the writer node (${FROM}), or mail a SIGNED act to POST /api/kraynet/inbox here; the mirror relays, it never applies.` })
      if (p === '/docs/pack.json') {
        const pack = docsPack()
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' })
        return res.end(JSON.stringify(pack))
      }
      {
        const dm = /^\/docs\/([a-z0-9][a-z0-9._-]{0,80})\.md$/i.exec(p)
        if (dm) {
          const f = docsFile(dm[1])
          if (!f) return send(res, 404, { error: 'not found' })
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60' })
          return res.end(f.text)
        }
      }
      if (UI_REDIRECT[p]) { res.writeHead(302, { Location: UI_REDIRECT[p], 'Cache-Control': 'no-store' }); return res.end() }
      if (/^\/(?:profile|u|address)\/KRAY_BLACK_HOLE\/?$/.test(p)) { res.writeHead(302, { Location: '/blackhole', 'Cache-Control': 'no-store' }); return res.end() }
      // ── the explorer chrome (static, from THIS clone) — served BEFORE the snapshot gate so the page paints
      // immediately; its own JS then hits the verified /api + /content below (same origin). Read-only, no key.
      {
        const uiName = uiPageOf(p) || (/^\/(?:[a-z0-9._-]+\.(?:css|js|svg|png|ico|webp)|model-viewer\.min\.js|vendor\/(?:draco|basis)\/[a-z0-9._-]+\.(?:js|wasm)|vendor\/[a-z0-9._-]+\.js)$/i.test(p) ? p.slice(1) : null)
        if (uiName) {
          const abs = join(UI_DIR, uiName)
          if (abs.startsWith(UI_DIR) && existsSync(abs)) {
            res.writeHead(200, { 'Content-Type': UI_MIME[extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' })
            return res.end(readFileSync(abs))
          }
        }
      }
      if (!current) return send(res, 503, { error: 'the mirror has not verified a snapshot yet — try again shortly' })
      const n = current.node
      if (p === '/api/kraynet/head') { const o = n.overview(); return send(res, 200, { ...o, height: o.seq, ...meta() }) }
      // LINEAGE (custody doctrine rung 3) — "does YOUR verified history still pass through this root?"
      // One snapshot, one atomic answer: membership (with the seq the root first appears at), this
      // snapshot's own head, and the deepest anchor THIS box re-proved on its own bitcoind. A guardian
      // daemon grounds its monotonic-head gate here — never in the writer's word. Read-only, pure.
      {
        const lm = /^\/api\/kraynet\/lineage\/([0-9a-fA-F]{64})$/.exec(p)
        if (lm) {
          const root = lm[1].toLowerCase()
          const seq = current.rootSeq ? current.rootSeq.get(root) : undefined
          return send(res, 200, {
            root, known: seq !== undefined, seq: seq !== undefined ? seq : null,
            head: { seq: n.seq, root: n.cascadeRoot().toLowerCase() },
            lastProvenAnchor: current.lastProvenAnchor || null,
            ...meta(),
          })
        }
      }
      if (p === '/api/kraynet/supply') return send(res, 200, { emitted: n.ledger.totalEmitted.toString(), burned: n.ledger.totalBurned.toString(), circulating: n.ledger.circulating.toString(), ...meta() })
      // THE ATLAS + THE LIBRARY — listings of state THIS mirror already verified by replay (same
      // reducer, same bytes hash-checked). Pure reads from the shared view: no POST, no key, no
      // second pen — identical JSON shape to the writer's door, so the explorer renders the same.
      if (p === '/api/kraynet/atlas') return send(res, 200, { ...atlasView(n), ...meta() })
      if (p === '/api/kraynet/library') return send(res, 200, { ...libraryView(n), ...meta() })
      // THE TWO LIGHTS + THE RANK BOOKS — same shared fold as the writer. A validator that replayed
      // the journal MUST paint ₭ / Nyx (Ӿ) / Fenyx tank / ✦ glow from THIS node, never from a mouth.
      if (p === '/api/kraynet/lights') {
        const raw = url.searchParams.get('top')
        const top = raw == null || raw === '' ? null : Math.min(500, Math.max(1, Number(raw) || 100))
        return send(res, 200, { network: current.network, ...lightsView({ node: n, events: current.events, top }), ...meta() })
      }
      if (p === '/api/kraynet/analytics') {
        return send(res, 200, { ...rankBooksView({ node: n, events: current.events, network: current.network }), ...meta() })
      }
      // THE NETWORK MAP (council DATA LAW A6: /overview + /status + /presence, never /peers).
      // Overview is THIS replay. Presence + status stay writer-live (beat book), labelled viaMirror.
      if (p === '/api/kraynet/overview') return send(res, 200, { ...n.overview(), ...meta() })
      if (p === '/api/kraynet/status' || p === '/api/kraynet/presence') {
        try {
          const r = await fetch(FROM + p, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
          if (!r.ok) return send(res, 502, { error: `the writer (${FROM}) is unreachable for this live view`, mirror: true, of: FROM })
          const j = await r.json()
          return send(res, 200, { ...j, viaMirror: FROM })
        } catch { return send(res, 502, { error: `the writer (${FROM}) is unreachable for this live view`, mirror: true, of: FROM }) }
      }
      let m
      if ((m = /^\/api\/kraynet\/profile\/(.+)$/.exec(p))) {
        const addr = decodeURIComponent(m[1])
        return send(res, 200, { address: addr, balance: n.balanceOf(addr).toString(), stars: n.starsOf(addr).map(String), ...meta() })
      }
      if ((m = /^\/api\/kraynet\/runes\/of\/(.+)$/.exec(p))) {
        // THE GUARDIAN'S BOOK — every rune this address holds, from the follower's OWN replayed ledger
        // (never proxied). This is the endpoint a guardian-signer daemon points KRAY_GUARDIAN_BOOK_URL at:
        // its refusal/approval of a pot withdraw is then grounded in THIS mirror's independent replay of the
        // Supreme Law, not in the writer's word. Amounts are base units, same shape as the writer's door.
        const addr = decodeURIComponent(m[1])
        const out = []
        for (const rid of n.ledger.runes.runes()) {
          const bal = n.ledger.runes.balanceOf(rid, addr)
          const lock = n.ledger.runes.lockedOf(rid, addr)
          if (bal > 0n || lock) {
            out.push({ runeId: `${rid.block}:${rid.tx}`, amount: bal.toString(), ...(lock ? { locked: { amount: lock.amount.toString(), l1Address: lock.l1Address } } : {}) })
          }
        }
        return send(res, 200, { runes: out, ...meta() })
      }
      if ((m = /^\/api\/kraynet\/star\/(\d+)$/.exec(p))) {
        const s = n.star(BigInt(m[1]))
        if (!s) return send(res, 404, { error: 'no such star' })
        return send(res, 200, { no: String(s.no), owner: s.owner, by: s.by, name: s.name, contentHash: s.contentHash, contentType: s.contentType, parent: s.parent != null ? String(s.parent) : null, children: (s.children || []).map(String), origin: s.origin ?? null, url: s.contentHash ? '/content/' + s.contentHash : null, ...meta() })
      }
      if (p === '/api/kraynet/replica') {
        // mirrors are CHAINABLE: this re-serves the verified journal, so a follower can follow a mirror
        const from = Math.max(1, parseInt(url.searchParams.get('from') || '1', 10) || 1)
        const limit = Math.min(5000, Math.max(1, parseInt(url.searchParams.get('limit') || '2000', 10) || 2000))
        return send(res, 200, { file: 'journal', network: current.network, total: current.lines.length, from, lines: current.lines.slice(from - 1, from - 1 + limit), ...meta() })
      }
      // ADR-2 2a — this VERIFIED mirror also serves its journal in content-addressed chunks, so a fresh
      // follower can reconstruct from THIS peer (not only the writer) and verify each chunk against the head.
      if (p === '/api/kraynet/chunks') {
        if (!current.lines.length) return send(res, 200, { network: current.network, head: current.node.cascadeRoot(), chunkSize: DEFAULT_CHUNK_SIZE, total: 0, chunks: [], ...meta() })
        const { chunks, head, genesis } = chunkJournal(current.lines, DEFAULT_CHUNK_SIZE)
        return send(res, 200, { network: current.network, head, genesis, chunkSize: DEFAULT_CHUNK_SIZE, total: current.lines.length, chunks: chunks.map((c) => ({ index: c.index, startSeq: c.startSeq, endSeq: c.endSeq, startPrevHash: c.startPrevHash, endHash: c.endHash, address: c.address })), ...meta() })
      }
      if ((m = /^\/api\/kraynet\/chunk\/([0-9a-f]{64})$/.exec(p))) {
        for (let s = 0; s < current.lines.length; s += DEFAULT_CHUNK_SIZE) { const span = current.lines.slice(s, s + DEFAULT_CHUNK_SIZE); if (chunkAddress(span) === m[1]) return send(res, 200, { address: m[1], lines: span, ...meta() }) }
        return send(res, 404, { error: 'no chunk with that content address here' })
      }
      if ((m = /^\/content\/([0-9a-f]{64})$/.exec(p))) {
        const f = join(current.dataDir, 'content', m[1])
        if (!existsSync(f)) return send(res, 404, { error: 'content not held here' })
        // serve the SEALED bytes under their signed content-type (from the replayed ledger), with the
        // writer's exact cage: sandbox neutralises any script, img/media/style are allowed so an image
        // or page paints. Same door, same bytes, same protection — just no longer blind octet-stream.
        const ct = contentTypeOf(n, m[1])
        res.writeHead(200, { 'Content-Type': ct, 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self' data:; style-src 'unsafe-inline'", 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' })
        return res.end(readFileSync(f))
      }
      if ((m = /^\/render\/([0-9a-f]{64})$/.exec(p))) {
        // THE RENDER DOOR — markdown gets the reading room (the same static shell the writer serves:
        // kray.js fetches the sealed bytes and mounts them inert, the only script the CSP allows).
        // Every other type falls through to the byte-exact /content door, now correctly typed.
        const hash = m[1]
        if (!existsSync(join(current.dataDir, 'content', hash))) return send(res, 404, { error: 'content not held here' })
        const ct = contentTypeOf(n, hash)
        if (/markdown/i.test(ct) || /^text\/(x-)?md\b/i.test(ct)) {
          const shell = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>markdown star · KRAY.NETWORK</title></head>'
            + `<body data-mdview="${hash}"><script src="/kray.js"></script></body></html>`
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' data: blob:; style-src 'unsafe-inline'; font-src 'self' data:" })
          return res.end(shell)
        }
        if (/^model\//i.test(ct)) {
          // 3D's render door — model-viewer (self-hosted, in this clone) paints the sealed bytes.
          const shell = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>3D star · KRAY.NETWORK</title>'
            + '<style>html,body{margin:0;height:100%;background:#08090a}model-viewer{width:100vw;height:100dvh;--poster-color:transparent}</style>'
            + '<script type="module" src="/model-viewer.min.js?v=2"></script></head>'
            + `<body><model-viewer src="/content/${hash}" alt="3D star" camera-controls auto-rotate touch-action="pan-y" shadow-intensity="1" exposure="1"></model-viewer></body></html>`
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:" })
          return res.end(shell)
        }
        res.writeHead(302, { Location: '/content/' + hash, 'Cache-Control': 'no-store' }); return res.end()
      }
      // LAST RESORT — a read-only view this mirror doesn't derive itself (the writer's LIVE state:
      // node-version, donation address, settlements, the beat challenge…). GET only. /stream and /peers
      // are NEVER relayed. ₭ / Ӿ / ✦ already folded above — last-resort must not steal those doors.
      if (/^\/(?:api\/|downloads\/)/.test(p) && !/(?:\/stream$|\/peers$)/.test(p)) {
        try {
          const r = await fetch(FROM + p + (url.search || ''), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
          const ctype = r.headers.get('content-type') || 'application/octet-stream'
          const buf = Buffer.from(await r.arrayBuffer())
          res.writeHead(r.status, { 'Content-Type': ctype, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' })
          return res.end(buf)
        } catch { return send(res, 502, { error: `the writer (${FROM}) is unreachable for this view`, mirror: true, of: FROM }) }
      }
      return send(res, 404, { error: 'no such route on this mirror (verified locally: head, supply, atlas, library, lights, analytics, profile/:addr, star/:no, replica, content/:hash, render/:hash; live presence/status relayed from the writer)' })
    } catch (e) { return send(res, 500, { error: e instanceof Error ? e.message : String(e) }) }
  }).listen(port, BIND, () => {
    console.log(`\n🪞  READ-ONLY MIRROR on http://${BIND}:${port} — serving only what survived every proof (set KRAY_FOLLOW_BIND=0.0.0.0 to listen on all interfaces)`)
    console.log(`\n   Explorer (this node): http://${BIND === '0.0.0.0' ? '127.0.0.1' : BIND}:${port}/\n`)
  })
}

if (SERVE) {
  // serving implies watching: the mirror re-verifies continuously; a failed cycle (writer dead, writer
  // lying) keeps the LAST VERIFIED snapshot online, marked stale — availability, never unverified truth.
  startMirror(SERVE)
  const loop = async () => {
    try { await main() } catch (e) { staleSince = staleSince ?? Date.now(); console.error('  ✗ ' + (e?.message || e) + (current ? ' — still serving the last verified snapshot (stale)' : '')) }
    await relayPending().catch(() => {})   // every cycle, mail held acts forward — the writer returning drains the world's mailboxes
    setTimeout(loop, 30_000)
  }
  loop()
} else if (WATCH) {
  const loop = async () => {
    try { await main() } catch (e) { console.error('  ✗ ' + (e?.message || e)) }
    setTimeout(loop, 30_000)
  }
  loop()
} else {
  main().catch((e) => { console.error('\n  ✗ ' + (e?.stack || e)); process.exit(1) })
}
