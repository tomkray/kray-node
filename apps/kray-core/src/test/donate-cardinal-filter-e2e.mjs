/**
 * THE CARDINAL-ONLY DONATION — the LEI SUPREMA on the donate on-ramp: a donation is funded by pure BTC
 * ALONE and NEVER burns a donor's ordinal or rune. Mirrors the KrayWallet extension's own spend filter.
 *
 * A donor holds TWO UTXOs: pure BTC and a real Rune (sent by the harness's ord wallet). The node builds the
 * donation PSBT (/donate/prepare); the wallet signs; the node broadcasts. We then prove the RUNE UTXO was
 * NEVER selected — it is still unspent on-chain, its runes intact — and that /donate/prepare reported it as
 * a protected UTXO. Finally a donor whose ONLY coin is a rune is REFUSED at build time (409), never handed a
 * PSBT that would burn it.
 *
 *   node apps/kray-net/server.mjs                 # burn mode, ord wired (the harness has runes)
 *   KRAY_BTC_RPC_PASS=<pw> node src/test/donate-cardinal-filter-e2e.mjs
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _bytesToHex } from '../protocol/scheme.ts'

const RPC = process.env.KRAY_BTC_RPC || 'http://127.0.0.1:18454'
const RPC_USER = process.env.KRAY_BTC_RPC_USER || 'kraycore'
const RPC_PASS = process.env.KRAY_BTC_RPC_PASS || ''
const WALLET = process.env.KRAY_WALLET || 'kray'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const ORD = (process.env.KRAY_ORD_URL || 'http://127.0.0.1:8081').replace(/\/+$/, '')
const RUNE = process.env.RUNE || 'KRAYDIVISIBLETEST'
const HARNESS = process.env.HARNESS || join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/regtest-harness')
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
const jget = (p) => fetch(NODE + p).then((r) => r.json())
const jpost = (p, b) => fetch(NODE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))
const ordOut = (op) => fetch(`${ORD}/output/${op}`, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
const ordw = (...a) => JSON.parse(execFileSync(join(HARNESS, 'ordw'), a, { encoding: 'utf8' }))
const mine = async (n = 1) => bc('generatetoaddress', [n, await bc('getnewaddress', ['', 'bech32m'])])
const ordHeight = () => fetch(`${ORD}/blockheight`).then((r) => r.text()).then((t) => Number(t.trim())).catch(() => -1)
async function ordSync() { for (let i = 0; i < 60; i++) { const [b, o] = await Promise.all([bc('getblockcount').then(Number), ordHeight()]); if (o >= b) return; await new Promise((r) => setTimeout(r, 400)) } }
const freshDonor = (seed) => { const { publicKeyHex: xonly } = _generateKeyPair(createHash('sha256').update(seed).digest()); return { xonly, sk: createHash('sha256').update(seed).digest(), addr: btc.p2tr(_hexToBytes(xonly), undefined, NETWORKS[BNET]).address } }

// send RUNE to `addr` and return the rune outpoint {txid, vout}, once ord has indexed it
async function sendRune(addr) {
  await ordSync()                                                // ord must be in step with bitcoind before a wallet op
  const sent = ordw('send', '--fee-rate', '1', addr, `1:${RUNE}`)
  const rtxid = sent.txid
  await mine(3)
  await ordSync()
  for (let i = 0; i < 30; i++) {
    const rtx = await bc('getrawtransaction', [rtxid, true])
    for (const o of rtx.vout) {
      if (o.scriptPubKey.address !== addr) continue
      const oo = await ordOut(`${rtxid}:${o.n}`)
      if (oo && oo.runes && Object.keys(oo.runes).length) return { txid: rtxid, vout: o.n }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`ord did not index a rune output to ${addr} for tx ${rtxid}`)
}

async function main() {
  console.log('\n╔══ THE CARDINAL-ONLY DONATION — a donation never spends an ordinal/rune UTXO (Lei Suprema) ══╗')
  if (!RPC_PASS) die('set KRAY_BTC_RPC_PASS to the regtest rpcpassword')
  const info = await jget('/api/kraynet/donation/info')
  if (!info.configured) die('node has no pot configured')

  // ── 1 · a donor with BOTH a pure-BTC UTXO and a real Rune UTXO ──
  const D = freshDonor('cardinal|both|' + RUNE)
  await bc('sendtoaddress', [D.addr, 0.003]); await mine(1)        // 300k pure sats
  const ro = await sendRune(D.addr)                               // a real rune UTXO at D
  const runeUnspentBefore = await bc('gettxout', [ro.txid, ro.vout])
  ok(!!runeUnspentBefore, `donor holds a real ${RUNE} UTXO (${ro.txid.slice(0, 12)}…:${ro.vout}) alongside pure BTC`)

  // ── 2 · the node builds the donation PSBT — it must protect the rune UTXO ──
  const prep = await jpost('/api/kraynet/donate/prepare', { donor: D.addr, donorPubkey: D.xonly, sats: '10000' })
  ok(prep.ok === true, `node built the donation PSBT from the donor's PURE BTC (${prep.inputs} input, ${prep.change} change)${prep.error ? ' [' + prep.error + ']' : ''}`)
  ok((prep.protectedUtxos || 0) >= 1, `/donate/prepare reported it PROTECTED ${prep.protectedUtxos} asset UTXO(s) — the rune was excluded from funding`)

  // ── 3 · sign + broadcast the donation, then PROVE the rune UTXO was never touched ──
  const signer = btc.Transaction.fromPSBT(_hexToBytes(prep.psbt))
  signer.sign(D.sk, [btc.SigHash.ALL])
  const bcast = await jpost('/api/kraynet/donate/broadcast', { psbt: _bytesToHex(signer.toPSBT()) })
  ok(bcast.ok === true && /^[0-9a-f]{64}$/.test(bcast.txid || ''), `the donation broadcast (${String(bcast.txid).slice(0, 12)}…)${bcast.error ? ' [' + bcast.error + ']' : ''}`)
  await mine(1)
  await ordSync()
  const runeUnspentAfter = await bc('gettxout', [ro.txid, ro.vout])
  ok(!!runeUnspentAfter, `THE RUNE UTXO IS STILL UNSPENT after the donation — the donation NEVER selected it (${ro.txid.slice(0, 12)}…:${ro.vout} intact)`)
  const stillRune = await ordOut(`${ro.txid}:${ro.vout}`)
  ok(stillRune && stillRune.runes && Object.keys(stillRune.runes).length > 0, `ord confirms the rune is intact at the donor's untouched outpoint — nothing was burned`)

  // ── 4 · a donor whose ONLY coin is a rune is REFUSED at build time (never handed a burn) ──
  const E = freshDonor('cardinal|rune-only|' + RUNE)
  await sendRune(E.addr)                                          // E holds ONLY a rune (no pure BTC)
  const prepE = await jpost('/api/kraynet/donate/prepare', { donor: E.addr, donorPubkey: E.xonly, sats: '10000' })
  ok(prepE.ok !== true && /inscription|rune|pure BTC/i.test(prepE.error || ''), `a rune-ONLY donor is REFUSED at build time — never handed a PSBT that would burn it (${(prepE.error || '').slice(0, 64)}…)`)

  console.log(`\n╚══ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the donate on-ramp funds ONLY with pure BTC: a rune UTXO is protected, never selected, never burned, and a rune-only donor is refused before signing. The wallet's Lei Suprema now holds at the node too. ⛓₿ ══╝`)
  if (fail) process.exit(1)
}
main().catch((e) => die(e.stack || e.message))
