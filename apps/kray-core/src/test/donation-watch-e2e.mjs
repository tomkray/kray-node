/**
 * THE DONATION WATCH — the writer reads Bitcoin itself; the wallet never has to "claim" a burn.
 *
 * The real-world failure this closes: a donor signs + broadcasts, closes the popup before the last
 * confirmation, and the book never learns the burn confirmed (mainnet Land 2, 2026-09-12, needed a
 * hand-sent txid). Here the "wallet" prepares, signs, broadcasts — and then goes SILENT. No POST
 * /donate. Bitcoin buries the tx; the writer's own donation watch must mint the ₭ and (in burn mode)
 * journal the seal, with nobody asking.
 *
 * Run against a writer booted with KRAY_DONATION_WATCH_MS small (e.g. 5000):
 *   KRAY_BTC_RPC_PASS=<pw> KRAY_NODE=http://127.0.0.1:4499 node src/test/donation-watch-e2e.mjs
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _bytesToHex } from '../protocol/scheme.ts'

const RPC = process.env.KRAY_BTC_RPC || 'http://127.0.0.1:18454'
const RPC_USER = process.env.KRAY_BTC_RPC_USER || 'kraycore'
const RPC_PASS = process.env.KRAY_BTC_RPC_PASS || ''
const WALLET = process.env.KRAY_WALLET || 'kray'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const SATS = BigInt(process.env.SATS || '7000')
const WAIT_MS = parseInt(process.env.WAIT_MS || '90000', 10)
const BNET = toBtcNet('regtest')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
async function bc(method, params = []) {
  const r = await fetch(`${RPC}/wallet/${WALLET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64') },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'kray', method, params }),
  }).then((x) => x.json())
  if (r.error) throw new Error(`bitcoind ${method}: ${r.error.message}`)
  return r.result
}
const jget = (path) => fetch(NODE + path).then((r) => r.json())
const jpost = (path, body) => fetch(NODE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mine = async (n) => bc('generatetoaddress', [n, await bc('getnewaddress', ['', 'bech32m'])])

async function main() {
  console.log('\n╔═ THE DONATION WATCH — the wallet goes silent; the book still mints and seals ══╗')
  if (!RPC_PASS) die('set KRAY_BTC_RPC_PASS to the regtest rpcpassword')
  const info = await jget('/api/kraynet/donation/info')
  ok(info.configured === true, `writer has the pot + bitcoind wired (${String(info.potAddress).slice(0, 18)}…)`)
  const head0 = await jget('/api/kraynet/head')

  // ── 1 · a fresh wallet key, funded ──────────────────────────────────────────
  const sk = createHash('sha256').update('donation-watch|' + info.potAddress + '|' + Date.now()).digest()
  const { publicKeyHex: xonly } = _generateKeyPair(sk)
  const donor = btc.p2tr(_hexToBytes(xonly), undefined, NETWORKS[BNET]).address
  await bc('sendtoaddress', [donor, 0.005])
  await mine(1)
  const balBefore = BigInt((await jget('/api/kraynet/profile/' + donor)).balance || '0')

  // ── 2 · prepare → sign → broadcast (exactly the extension), then SILENCE ────
  const prep = await jpost('/api/kraynet/donate/prepare', { donor, donorPubkey: xonly, sats: SATS.toString() })
  ok(prep.ok === true && prep.psbt, `writer built the PSBT paying ${SATS} sats to ${String(prep.pot).slice(0, 16)}…${prep.error ? ' [' + prep.error + ']' : ''}`)
  if (!prep.ok) die('prepare failed')
  const signer = btc.Transaction.fromPSBT(_hexToBytes(prep.psbt))
  signer.sign(sk, [btc.SigHash.ALL])
  const bcast = await jpost('/api/kraynet/donate/broadcast', { psbt: _bytesToHex(signer.toPSBT()) })
  ok(bcast.ok === true && /^[0-9a-f]{64}$/.test(bcast.txid || ''), `broadcast ${String(bcast.txid).slice(0, 16)}… — and now the "wallet" closes. No POST /donate will ever be sent.`)
  if (!bcast.ok) die('broadcast failed')
  const outpoint = bcast.txid + ':0'

  // ── 3 · not buried yet → the watch must NOT mint (fail-closed on depth) ─────
  await sleep(7000)
  const shallow = BigInt((await jget('/api/kraynet/profile/' + donor)).balance || '0')
  ok(shallow === balBefore, 'unconfirmed: the watch minted nothing (a burn credits only once Bitcoin buried it)')

  // ── 4 · Bitcoin buries it; nobody tells the writer ───────────────────────────
  await mine(Math.max(1, info.minConfirmations))
  const t0 = Date.now(); let minted = false, seqAt = null
  while (Date.now() - t0 < WAIT_MS) {
    const bal = BigInt((await jget('/api/kraynet/profile/' + donor)).balance || '0')
    if (bal - balBefore === SATS) { minted = true; break }
    await sleep(2500)
  }
  ok(minted, `the writer minted ${SATS} ₭ to the donor BY ITSELF within ${Math.round((Date.now() - t0) / 1000)}s of burial — no client, no claim`)

  // ── 5 · the journal carries the proof + (burn mode) the seal ────────────────
  const head1 = await jget('/api/kraynet/head')
  const events = []
  for (let s = (head0.seq || 0) + 1; s <= head1.seq; s++) { const r = await jget('/api/kraynet/receipt/' + s); if (r && r.event) events.push(r.event) }
  const donate = events.find((e) => e.kind === 'donate' && e.outpoint === outpoint)
  ok(!!donate && !!donate.proof, `journal seq ${donate ? donate.seq : '?'}: donate event names the outpoint and embeds its SPV proof`)
  if (donate) seqAt = donate.seq
  const seal = events.find((e) => e.kind === 'seal' && e.l1Txid === bcast.txid)
  const burnMode = prep.pot !== info.potAddress
  if (burnMode) ok(!!seal, `journal seq ${seal ? seal.seq : '?'}: the seal rode in — window reopened by the donation's own anchor, unasked`)
  else ok(true, 'reserve mode (plain pot): no self-anchor seal expected on this writer')

  // ── 6 · idempotence: more blocks, more sweeps, no double credit ─────────────
  await mine(2); await sleep(12000)
  const balFinal = BigInt((await jget('/api/kraynet/profile/' + donor)).balance || '0')
  ok(balFinal - balBefore === SATS, `after 2 more blocks and further sweeps the balance is still +${SATS} — one outpoint, one mint, ever`)
  const dup = await jpost('/api/kraynet/donate', { txid: bcast.txid })
  ok(dup.ok !== true && /already credited/.test(dup.error || ''), 'a late wallet claim on the same txid is refused by the ledger (same door, same judge)')

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — seq ${seqAt ?? '?'}: the book read Bitcoin on its own. ═╝\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => die(e.stack || e.message))
