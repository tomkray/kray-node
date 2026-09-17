/**
 * THE STALE LAW — a mirror never dies on a history that does not replay: it keeps serving the last
 * VERIFIED snapshot, marked stale with the reason, and retries; one-shot mode still exits 1.
 * (Fleet precondition 0a of the 2026-09-17 audit: a guardian's book must degrade to "lagging",
 *  never to a crash loop under Restart=always.)
 *
 *   node apps/kray-net/follow-stale-path.test.mjs
 *
 * Hermetic. A mock writer on loopback serves three histories in turn, and the follower CLI is driven as a
 * black box exactly the way the fleet runs it (--serve --watch, plus one-shot):
 *   A · one valid regtest event (verifies)
 *   B · A + one hash-chained line of an UNKNOWN kind — the reducer HALTs on it; this is what a stricter
 *       pin, a new era, or a hostile writer looks like from a follower that does not know the kind
 *   C · an EMPTY valid history — shorter than A: a prefix break (a rewrite as seen from this box)
 * Proves: alive + stale + reason on B; recovery on A; prefix break labelled (warn) or refused (refuse)
 * on C; one-shot exit 1 on B and exit 0 on A.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { KrayNode } from '../kray-core/src/protocol/node.ts'
import { _generateKeyPair, addressOf, toBtcNet } from '../kray-core/src/protocol/scheme.ts'
import { sha256hex, canonical } from '../kray-core/src/protocol/kray-primitives.ts'

const NET = 'regtest'
const FOLLOW = fileURLToPath(new URL('../../scripts/follow/kray-follow.mjs', import.meta.url))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms, every = 150) {
  const t0 = Date.now()
  for (;;) { try { const v = await fn(); if (v) return v } catch { /* not yet */ } if (Date.now() - t0 > ms) return null; await sleep(every) }
}
// one-shot runs are awaited, never spawnSync: the mock writer lives in THIS process and a blocking
// child would starve it (the follower would then wait on /head until the fetch timeout — a harness lie).
function runOneShot(dir) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [FOLLOW, '--from', FROM, '--dir', dir], { env: { ...process.env, KRAY_FOLLOW_INBOX: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    let out = ''
    child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { out += d })
    const t = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } }, 60_000)
    child.on('exit', (code) => { clearTimeout(t); res({ status: code, out }) })
  })
}
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })

const TMP = mkdtempSync(join(tmpdir(), 'kray-follow-stale-'))
const children = []
const cleanup = () => { for (const c of children) { try { c.kill('SIGKILL') } catch { /* gone */ } } try { rmSync(TMP, { recursive: true, force: true }) } catch { /* best effort */ } }
process.on('exit', cleanup)

// ── fixtures ──
const sk = createHash('sha256').update('follow-stale-path|donor', 'utf8').digest()
const donor = addressOf(_generateKeyPair(sk).publicKeyHex, toBtcNet(NET))
const linesOf = (dir) => readFileSync(join(dir, `kraynet-journal-${NET}.jsonl`), 'utf8').split('\n').filter(Boolean)
const headOf = (node) => ({ network: NET, seq: node.seq, height: node.seq, head: node.head, cascadeRoot: node.cascadeRoot(), v: 'follow-stale-path-test' })

const nA = new KrayNode(join(TMP, 'writer-a'), NET); nA.donate(donor, 10_000n)
const A = { lines: linesOf(join(TMP, 'writer-a')), head: headOf(nA) }
const nC = new KrayNode(join(TMP, 'writer-c'), NET)
const C = { lines: [], head: headOf(nC) }
// B = A + one hash-chained line of an unknown kind (the chain verifies; the reducer refuses the kind)
const lastA = JSON.parse(A.lines[A.lines.length - 1])
const bogusBody = { kind: 'bogus-era-kind', at: 7, from: donor, seq: lastA.seq + 1, prevHash: lastA.hash }
const bogusHash = sha256hex(lastA.hash + canonical(bogusBody))
const B = { lines: [...A.lines, JSON.stringify({ ...bogusBody, hash: bogusHash })], head: { ...A.head, seq: lastA.seq + 1, height: lastA.seq + 1, head: bogusHash, cascadeRoot: 'ff'.repeat(32) } }
const FIX = { A, B, C }
let state = 'A'

// ── the mock writer ──
const writer = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  // Connection: close — the real writer sits behind a proxy that closes idle connections; a bare mock that
  // keeps them alive would hold a one-shot follower's event loop open (undici keep-alive), which is the
  // client's socket pool, not the follower's verdict. Close, so exit codes mean what they say.
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(body)) }
  const f = FIX[state]
  if (url.pathname === '/api/kraynet/head') return send(200, f.head)
  if (url.pathname === '/api/kraynet/replica') {
    const from = Math.max(1, parseInt(url.searchParams.get('from') || '1', 10) || 1)
    const limit = Math.max(1, parseInt(url.searchParams.get('limit') || '2000', 10) || 2000)
    return send(200, { file: 'journal', network: NET, total: f.lines.length, from, lines: f.lines.slice(from - 1, from - 1 + limit) })
  }
  if (url.pathname === '/api/kraynet/anchors') return send(200, { anchors: [] })
  if (url.pathname === '/api/kraynet/peers') return send(200, { peers: [] })
  return send(404, { error: 'no such route on the mock writer' })
})
const WPORT = await new Promise((res) => writer.listen(0, '127.0.0.1', () => res(writer.address().port)))
const FROM = `http://127.0.0.1:${WPORT}`

function spawnMirror(name, prefixMode) {
  const port = null
  return (async () => {
    const mport = await freePort()
    const child = spawn(process.execPath, [FOLLOW, '--from', FROM, '--dir', join(TMP, name), '--serve', String(mport), '--watch'],
      { env: { ...process.env, KRAY_FOLLOW_CYCLE_MS: '1200', KRAY_FOLLOW_INBOX: '0', KRAY_FOLLOW_PREFIX: prefixMode }, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    const head = async () => { const r = await fetch(`http://127.0.0.1:${mport}/api/kraynet/head`); return { status: r.status, body: await r.json().catch(() => ({})) } }
    return { child, head, log: () => out, port: mport }
  })()
}

async function main() {
  console.log('\n╔═ THE STALE LAW — a mirror serves the last verified truth, marked stale; it never crash-loops ═╗\n')
  console.log(`  mock writer at ${FROM} · fixture A = ${A.lines.length} event(s), B = A + 1 unknown-kind line, C = empty\n`)

  // ── persist mode, default (warn) ──
  {
    const m = await spawnMirror('mirror-warn', 'warn')
    const h1 = await until(async () => { const h = await m.head(); return h.status === 200 && h.body.verifiedHeight === 1 ? h : null }, 20_000)
    ok(!!h1, `A · the mirror verified history A (seq 1) and serves it${h1 ? '' : ' — log:\n' + m.log()}`)
    ok(h1 && !h1.body.stale && !h1.body.staleReason, 'A · a fresh verified snapshot carries no stale mark')

    state = 'B'
    const h2 = await until(async () => { const h = await m.head(); return h.status === 200 && h.body.stale === true ? h : null }, 12_000)
    ok(!!h2, `B · the history stops replaying (unknown kind): the mirror marks itself STALE${h2 ? '' : ' — log:\n' + m.log()}`)
    ok(m.child.exitCode === null, 'B · the follower process is STILL ALIVE (no process.exit in persist mode)')
    ok(h2 && h2.body.verifiedHeight === 1 && h2.body.verifiedRoot === A.head.cascadeRoot, 'B · it still serves the LAST VERIFIED snapshot (seq 1, root A) — nothing unverified')
    ok(h2 && /does not replay/i.test(String(h2.body.staleReason)) && /unknown/i.test(String(h2.body.staleReason)), `B · staleReason names the cause: ${h2 ? JSON.stringify(h2.body.staleReason).slice(0, 140) : '—'}`)
    ok(/DOES NOT REPLAY/.test(m.log()) && /retrying in/.test(m.log()), 'B · the log says DOES NOT REPLAY … retrying (visible, never silent)')

    state = 'A'
    const h3 = await until(async () => { const h = await m.head(); return h.status === 200 && !h.body.stale ? h : null }, 12_000)
    ok(!!h3 && h3.body.verifiedHeight === 1 && !h3.body.staleReason, `A again · the stale mark CLEARS once the writer's history replays again${h3 ? '' : ' — log:\n' + m.log()}`)

    state = 'C'
    const h4 = await until(async () => { const h = await m.head(); return h.status === 200 && h.body.prefixBreak ? h : null }, 12_000)
    ok(!!h4, `C · a verified history that does NOT extend the snapshot is LABELLED prefixBreak${h4 ? '' : ' — log:\n' + m.log()}`)
    ok(h4 && h4.body.verifiedHeight === 0 && h4.body.prefixBreak.mode === 'warn' && h4.body.prefixBreak.prevHeight === 1 && h4.body.prefixBreak.newHeight === 0, 'C · warn (default) ADOPTS it (seq 0 served) and records prev seq 1 → new seq 0 — today\'s behaviour plus evidence')
    ok(/PREFIX BREAK/.test(m.log()), 'C · the log shouts PREFIX BREAK')
    m.child.kill('SIGTERM')
  }

  // ── persist mode, KRAY_FOLLOW_PREFIX=refuse ──
  {
    state = 'A'
    const m = await spawnMirror('mirror-refuse', 'refuse')
    const h1 = await until(async () => { const h = await m.head(); return h.status === 200 && h.body.verifiedHeight === 1 ? h : null }, 20_000)
    ok(!!h1, `refuse · verified history A first${h1 ? '' : ' — log:\n' + m.log()}`)
    state = 'C'
    const h2 = await until(async () => { const h = await m.head(); return h.status === 200 && h.body.stale === true ? h : null }, 12_000)
    ok(!!h2 && h2.body.verifiedHeight === 1 && /prefix break/i.test(String(h2.body.staleReason)) && h2.body.prefixBreak?.mode === 'refuse',
      `refuse · the shorter history is REFUSED: still seq 1, stale, reason = prefix break${h2 ? '' : ' — log:\n' + m.log()}`)
    ok(m.child.exitCode === null, 'refuse · the follower stays alive')
    m.child.kill('SIGTERM')
  }

  // ── one-shot mode keeps the clear verdict ──
  {
    state = 'B'
    const r = await runOneShot(join(TMP, 'oneshot-b'))
    ok(r.status === 1 && /DOES NOT REPLAY/.test(r.out), `one-shot · history B → exit 1 with DOES NOT REPLAY (exit ${r.status})`)
    state = 'A'
    const r2 = await runOneShot(join(TMP, 'oneshot-a'))
    ok(r2.status === 0 && /VERIFIED, AND NOW THERE ARE TWO/.test(r2.out), `one-shot · history A → exit 0, verified (exit ${r2.status})`)
  }

  writer.close()
  console.log(`\n  ${pass} passed, ${fail} FAILED\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
