/**
 * THE BITCOIN POLARITY (0a-ii) — "unprovable from MY bitcoind" is never "refuted".
 *
 *   node apps/kray-net/follow-bitcoin-polarity.test.mjs
 *
 * Hermetic: a mock writer (one regtest donate with an outpoint) and a mock bitcoind JSON-RPC on loopback,
 * the follower CLI driven one-shot as a black box with KRAY_BTC_RPC set. Modes of the mock node:
 *   txindexless · getrawtransaction refuses (no -txindex), gettxout knows nothing  → SKIPPED, exit 0
 *   utxo        · getrawtransaction refuses, gettxout holds the burn output          → PROVEN via the UTXO set
 *   wrongvalue  · the tx is present with a different output value                   → REFUTED, exit 1
 *   down        · no RPC listening at all                                            → SKIPPED, exit 0
 * Anchors: an in-lineage hint that cannot be proven here is skipped (exit 0); a foreign-root hint with
 * nothing proven stays fatal (exit 1). The banner says "forever" only when a seal was re-proven here.
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

const NET = 'regtest'
const FOLLOW = fileURLToPath(new URL('../../scripts/follow/kray-follow.mjs', import.meta.url))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const TMP = mkdtempSync(join(tmpdir(), 'kray-follow-polarity-'))
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }) } catch { /* best effort */ } })

// ── fixture: one regtest donate with an L1 outpoint (no proof — regtest is below PROOF_MANDATORY) ──
const sk = createHash('sha256').update('follow-polarity|donor', 'utf8').digest()
const donor = addressOf(_generateKeyPair(sk).publicKeyHex, toBtcNet(NET))
const TXID = 'ab'.repeat(32), SATS = 10_000n
const node = new KrayNode(join(TMP, 'writer'), NET); node.donate(donor, SATS, 0, `${TXID}:0`)
const lines = readFileSync(join(TMP, 'writer', `kraynet-journal-${NET}.jsonl`), 'utf8').split('\n').filter(Boolean)
const head = { network: NET, seq: node.seq, height: node.seq, head: node.head, cascadeRoot: node.cascadeRoot(), v: 'polarity-test' }
const genesisRoot = new KrayNode(join(TMP, 'empty'), NET).cascadeRoot()

// ── mock writer ──
let anchors = []
const writer = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(body)) }
  if (url.pathname === '/api/kraynet/head') return send(200, head)
  if (url.pathname === '/api/kraynet/replica') { const from = Math.max(1, parseInt(url.searchParams.get('from') || '1', 10) || 1); return send(200, { file: 'journal', network: NET, total: lines.length, from, lines: lines.slice(from - 1) }) }
  if (url.pathname === '/api/kraynet/anchors') return send(200, { anchors })
  if (url.pathname === '/api/kraynet/peers') return send(200, { peers: [] })
  return send(404, { error: 'no such route' })
})
const WPORT = await new Promise((r) => writer.listen(0, '127.0.0.1', () => r(writer.address().port)))
const FROM = `http://127.0.0.1:${WPORT}`

// ── mock bitcoind (JSON-RPC over HTTP) ──
let mode = 'txindexless'
const rpcErr = (code, message) => ({ result: null, error: { code, message } })
const bitcoind = createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => {
    let q = {}; try { q = JSON.parse(b) } catch { /* ignore */ }
    const reply = (o) => { res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify({ id: q.id, ...o })) }
    const m = q.method, p = q.params || []
    if (mode === 'wrongvalue' && m === 'getrawtransaction' && p[0] === TXID && p[1] === true) return reply({ result: { txid: TXID, vout: [{ value: 0.00005, n: 0 }], confirmations: 3 }, error: null })
    if (m === 'getrawtransaction') return reply(rpcErr(-5, 'No such mempool transaction. Use -txindex or provide a block hash to enable blockchain transaction queries. Use gettransaction for wallet transactions.'))
    if (m === 'gettxout') {
      if (mode === 'utxo' && p[0] === TXID && p[1] === 0) return reply({ result: { value: 0.0001, confirmations: 3, scriptPubKey: { hex: '5120' + '00'.repeat(32) } }, error: null })
      return reply({ result: null, error: null })
    }
    if (m === 'gettxoutproof') return reply(rpcErr(-5, 'Transaction not yet in block'))
    if (m === 'getblockcount') return reply({ result: 100, error: null })
    return reply(rpcErr(-32601, 'Method not found'))
  })
})
const BPORT = await new Promise((r) => bitcoind.listen(0, '127.0.0.1', () => r(bitcoind.address().port)))
const deadPort = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })

function run(name, rpcUrl) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [FOLLOW, '--from', FROM, '--dir', join(TMP, name)], { env: { ...process.env, KRAY_FOLLOW_INBOX: '0', KRAY_BTC_RPC: rpcUrl, KRAY_BTC_RPC_PASS: 'x', KRAY_BTC_RPC_USER: 'u' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''; child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { out += d })
    const t = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } }, 90_000)
    child.on('exit', (code) => { clearTimeout(t); res({ code, out }) })
  })
}

async function main() {
  console.log('\n╔═ THE BITCOIN POLARITY — unprovable is never refuted; only a contradiction refuses ═╗\n')
  const RPC = `http://127.0.0.1:${BPORT}`

  mode = 'txindexless'; anchors = []
  let r = await run('a-txindexless', RPC)
  ok(r.code === 0, `txindexless node, no anchors → the copy VERIFIES (exit ${r.code})`)
  ok(/unprovable from this node/.test(r.out) && /1 unprovable from this node \(skipped/.test(r.out), 'the donation is SKIPPED and printed — weight zero, never a lie')
  ok(!/forever/.test(r.out) && /not yet re-proven on this node/.test(r.out), 'with 0 seals re-proven the banner does NOT say "forever"')

  mode = 'utxo'
  r = await run('b-utxo', RPC)
  ok(r.code === 0 && /1 donation\(s\) re-proven/.test(r.out), `pruned/txindex-less node with the burn in its UTXO set → PROVEN via gettxout (exit ${r.code})`)

  mode = 'wrongvalue'
  r = await run('c-wrongvalue', RPC)
  ok(r.code === 1 && /a contradiction, refused/.test(r.out), `the tx is present with a different value → a CONTRADICTION refutes, exit 1 (exit ${r.code})`)

  mode = 'txindexless'
  r = await run('d-down', `http://127.0.0.1:${deadPort}`)
  ok(r.code === 0 && /unprovable from MY bitcoind/.test(r.out), `RPC unreachable → skipped, the copy still verifies (exit ${r.code})`)

  anchors = [{ txid: 'cd'.repeat(32), root: genesisRoot, blockNumber: 0, kind: 'operator' }]
  r = await run('e-anchor-skipped', RPC)
  ok(r.code === 0 && /0\/1 Bitcoin seal\(s\)/.test(r.out) && /1 unprovable here — skipped/.test(r.out), `an in-lineage anchor hint that cannot be proven here → SKIPPED, exit 0 (exit ${r.code})`)

  anchors = [{ txid: 'ef'.repeat(32), root: 'ff'.repeat(32), blockNumber: 0, kind: 'operator' }]
  r = await run('f-anchor-foreign', RPC)
  ok(r.code === 1 && /foreign history/.test(r.out), `a FOREIGN-root hint with nothing proven stays fatal, exit 1 (exit ${r.code})`)

  writer.close(); bitcoind.close()
  console.log(`\n  ${pass} passed, ${fail} FAILED\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
