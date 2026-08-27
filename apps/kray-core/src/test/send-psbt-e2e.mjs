/**
 * THE WALLET's L1 SEND, THROUGH THE NODE — build → sign → finalize → broadcast, all on the node's own
 * regtest. Proves the unified DevNet's write path: the node builds a send PSBT from the sender's OWN
 * UTXOs (/kraywallet/build-send-psbt), the WALLET signs it (taproot key path), the node finalizes +
 * broadcasts it (/kraywallet/finalize-psbt), and the recipient really receives the sats on-chain.
 *
 *   KRAY_BTC_RPC_PASS=<pw> node src/test/send-psbt-e2e.mjs
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _bytesToHex, scriptOfAddress } from '../protocol/scheme.ts'

const RPC = process.env.KRAY_BTC_RPC || 'http://127.0.0.1:18454'
const RPC_USER = process.env.KRAY_BTC_RPC_USER || 'kraycore'
const RPC_PASS = process.env.KRAY_BTC_RPC_PASS || ''
const WALLET = process.env.KRAY_WALLET || 'kray'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const BNET = toBtcNet('regtest')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
async function bc(method, params = []) {
  const r = await fetch(`${RPC}/wallet/${WALLET}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64') }, body: JSON.stringify({ jsonrpc: '1.0', id: 'kray', method, params }) }).then((x) => x.json())
  if (r.error) throw new Error(`bitcoind ${method}: ${r.error.message}`)
  return r.result
}
const jget = (path) => fetch(NODE + path).then((r) => r.json())
const jpost = (path, body) => fetch(NODE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())

async function main() {
  console.log('\n╔═ THE WALLET SEND — the node builds it, the wallet signs it, the chain settles it ══╗')
  if (!RPC_PASS) die('set KRAY_BTC_RPC_PASS')

  // a wallet key we control + a fresh recipient
  const sk = createHash('sha256').update('send-psbt|from|' + Date.now()).digest()
  const { publicKeyHex: xonly } = _generateKeyPair(sk)
  const from = btc.p2tr(_hexToBytes(xonly), undefined, NETWORKS[BNET]).address
  const to = await bc('getnewaddress', ['recipient', 'bech32m'])

  // fund the wallet on regtest
  await bc('sendtoaddress', [from, 0.003])
  await bc('generatetoaddress', [1, await bc('getnewaddress', ['', 'bech32m'])])
  const bal0 = (await jget('/api/wallet/' + from + '/balance')).balance
  ok(bal0 && bal0.confirmed === 300000, `node sees the wallet's local balance: ${bal0 && bal0.confirmed} sats`)

  // 1 · the node builds the send PSBT from the wallet's OWN UTXOs
  const prep = await jpost('/api/kraywallet/build-send-psbt', { fromAddress: from, fromPubkey: xonly, toAddress: to, amount: '120000', feeRate: 2 })
  ok(prep.success === true && prep.psbt, `node built the send PSBT (fee ${prep.fee}, change ${prep.change})${prep.error ? ' [' + prep.error + ']' : ''}`)

  // 2 · the WALLET signs it (taproot key path)
  const signer = btc.Transaction.fromPSBT(Buffer.from(prep.psbt, 'base64'))
  signer.sign(sk)
  const signedB64 = Buffer.from(signer.toPSBT()).toString('base64')

  // 3 · the node finalizes + broadcasts it
  const fin = await jpost('/api/kraywallet/finalize-psbt', { psbt: signedB64 })
  ok(fin.success === true && fin.broadcast === true && /^[0-9a-f]{64}$/.test(fin.txid || ''), `node finalized + broadcast the send (${String(fin.txid).slice(0, 16)}…)${fin.error ? ' [' + fin.error + ']' : ''}`)

  // 4 · the recipient really got the sats on-chain
  await bc('generatetoaddress', [1, await bc('getnewaddress', ['', 'bech32m'])])
  const recvBal = (await jget('/api/wallet/' + to + '/balance')).balance
  ok(recvBal && recvBal.confirmed === 120000, `the recipient received exactly 120000 sats on-chain (${recvBal && recvBal.confirmed})`)
  const back = (await jget('/api/wallet/' + from + '/balance')).balance
  ok(back && back.confirmed === 300000 - 120000 - Number(prep.fee), `the sender's change is exact: ${back && back.confirmed} sats (300000 − 120000 − ${prep.fee} fee)`)

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the wallet's L1 send runs entirely on the node's own regtest: built from the sender's coins, signed by the wallet, settled on Bitcoin. The DevNet is one chain. ₿`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => die(e.stack || e.message))
