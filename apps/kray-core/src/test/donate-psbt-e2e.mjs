/**
 * THE DONATE PSBT, AS THE EXTENSION DOES IT — the node builds the payment, the WALLET signs it.
 *
 * This is the real user's on-ramp end to end: a fresh taproot key (the wallet's key) is funded on
 * regtest, then the node builds an UNSIGNED PSBT paying the pot + committing the donor
 * (/donate/prepare — from the donor's OWN UTXOs, no custody), the key SIGNS it (key path, exactly
 * what the wallet's sign popup does), the node FINALIZES + BROADCASTS it (/donate/broadcast), and
 * after one confirmation the node MINTS from the SPV-proven {txid} (/donate). The node never holds a
 * key; it only ever assembles bytes the wallet approves and re-proves the chain.
 *
 *   KRAY_BTC_RPC_PASS=<pw> node src/test/donate-psbt-e2e.mjs
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _bytesToHex, scriptOfAddress } from '../protocol/scheme.ts'

const RPC = process.env.KRAY_BTC_RPC || 'http://127.0.0.1:18454'
const RPC_USER = process.env.KRAY_BTC_RPC_USER || 'kraycore'
const RPC_PASS = process.env.KRAY_BTC_RPC_PASS || ''
const WALLET = process.env.KRAY_WALLET || 'kray'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const SATS = BigInt(process.env.SATS || '10000') // one mint-cap (MINT_CAP_SATS): the max a single donation mints — larger amounts split across donations
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

async function main() {
  console.log('\n╔═ THE DONATE PSBT — the node builds it, the WALLET signs it, the chain proves it ══╗')
  if (!RPC_PASS) die('set KRAY_BTC_RPC_PASS to the regtest rpcpassword')
  const info = await jget('/api/kraynet/donation/info')
  ok(info.configured === true, `node has the pot + bitcoind wired (${String(info.potAddress).slice(0, 18)}…)`)

  // ── 1 · the wallet's key — a fresh taproot identity, its own address ────────
  const sk = createHash('sha256').update('donate-psbt|' + info.potAddress).digest()
  const { publicKeyHex: xonly } = _generateKeyPair(sk)
  const donor = btc.p2tr(_hexToBytes(xonly), undefined, NETWORKS[BNET]).address
  const balBefore = BigInt((await jget('/api/kraynet/profile/' + donor)).balance || '0')

  // ── 2 · fund the wallet on regtest (as if the user already held BTC) ────────
  await bc('sendtoaddress', [donor, 0.005]) // 500k sats
  await bc('generatetoaddress', [1, await bc('getnewaddress', ['', 'bech32m'])])
  ok(true, `wallet ${donor.slice(0, 20)}… funded with 500000 sats on regtest`)

  // ── 3 · the NODE builds the unsigned donation PSBT (no key, no custody) ─────
  const prep = await jpost('/api/kraynet/donate/prepare', { donor, donorPubkey: xonly, sats: SATS.toString() })
  ok(prep.ok === true && prep.psbt, `node built the PSBT paying ${SATS} to the pot + the donor OP_RETURN (${prep.inputs} input, ${prep.change} change, ${prep.fee} fee)${prep.error ? ' [' + prep.error + ']' : ''}`)

  // ── 4 · the WALLET signs it (taproot key path — exactly the sign popup) ─────
  const signer = btc.Transaction.fromPSBT(_hexToBytes(prep.psbt))
  signer.sign(sk, [btc.SigHash.ALL])   // SIGHASH_ALL — EXACTLY what the KrayWallet extension does (a 65-byte key-path sig), not @scure's DEFAULT
  const signedPsbt = _bytesToHex(signer.toPSBT()) // signed, NOT finalized — the node finalizes
  ok(signedPsbt !== prep.psbt, 'the wallet signed the PSBT (a BIP-340 key-path signature over the exact bytes it saw)')

  // ── 5 · the node FINALIZES + BROADCASTS it on its own bitcoind ──────────────
  const bcast = await jpost('/api/kraynet/donate/broadcast', { psbt: signedPsbt })
  ok(bcast.ok === true && /^[0-9a-f]{64}$/.test(bcast.txid || ''), `node finalized + broadcast the donation (${String(bcast.txid).slice(0, 16)}…)${bcast.error ? ' [' + bcast.error + ']' : ''}`)

  // the broadcast tx really pays the pot the exact sats, and commits the donor
  const dtx = await bc('getrawtransaction', [bcast.txid, true])
  // prep.pot is the destination the NODE built for THIS donation: the plain pot in reserve mode, or the
  // keyless self-anchor address (NUMS-tweaked with the cascade root) in burn mode — so this holds in BOTH
  // modes and proves the exact output the wallet signed reached the chain unchanged.
  const potScript = scriptOfAddress(prep.pot, BNET)
  const paysPot = dtx.vout.some((o) => o.scriptPubKey.hex === potScript && BigInt(Math.round(o.value * 1e8)) === SATS)
  const commits = dtx.vout.some((o) => o.scriptPubKey.hex === '6a' + (donor.length).toString(16).padStart(2, '0') + Buffer.from(donor, 'ascii').toString('hex'))
  ok(paysPot && commits, `the broadcast tx pays the anchor output (pot / self-anchor) EXACTLY ${SATS} sats and commits the donor in an OP_RETURN — byte-identical to what the node will re-prove`)

  // ── 6 · one confirmation, then the node MINTS from the SPV-proven txid ──────
  await bc('generatetoaddress', [Math.max(1, info.minConfirmations), await bc('getnewaddress', ['', 'bech32m'])])
  const mint = await jpost('/api/kraynet/donate', { txid: bcast.txid })
  ok(mint.ok === true && mint.credited === donor && mint.sats === SATS.toString(), `node MINTED ${SATS} ₭ to the donor from the SPV-proven txid — the same key that paid, signed, and now holds the ₭${mint.error ? ' [' + mint.error + ']' : ''}`)
  const balAfter = BigInt((await jget('/api/kraynet/profile/' + donor)).balance || '0')
  ok(balAfter - balBefore === SATS, `the wallet's ₭ balance rose by exactly ${SATS} (${balBefore} → ${balAfter})`)

  const ov = await jget('/api/kraynet/overview')
  ok(ov.conserves !== false && ov.backed !== false, 'the net still conserves — every minted ₭ backed by the real sat the wallet just paid')

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the real user's on-ramp, end to end: the node assembled the payment, the WALLET signed it (never a key leaving the user), the chain buried it, and the node minted 1:1 from the proof. No custody, no trust — the extension's exact donate. ₿→₭🛡️`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => die(e.stack || e.message))
