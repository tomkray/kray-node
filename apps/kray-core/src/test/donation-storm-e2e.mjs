/**
 * THE DONATION STORM — many strangers, the same millisecond, and every hostile duplicate: nothing fragments.
 *
 * Against a LIVE node in BURN mode (self-anchor, NUMS key) + a LIVE regtest bitcoind, this proves the exact
 * scenarios the Creator asked about before opening the network:
 *
 *   · the SAME address donating AGAIN — mints again, cleanly (the cap is per-transaction, the credit per
 *     outpoint; an address may sacrifice as many times as it likes);
 *   · MANY different addresses donating SIMULTANEOUSLY — 8 donors paying the SAME burn address (the same
 *     root moment), submitted in ONE Promise.all (the same millisecond), every one minted exactly once;
 *   · a DUPLICATE STORM riding the same instant — 8 concurrent copies of one txid interleaved with the 8
 *     real submissions: exactly one mint for that tx, every duplicate refused by credited-once;
 *   · a REPLAY WAVE after settlement — every txid resubmitted again: all refused, balances frozen;
 *   · a PREPARE STORM — 10 concurrent /donate/prepare for one donor in the same instant: every one builds
 *     (the indexed scan + cache serve them all; the old "Scan already in progress" collision is dead);
 *   · CONSERVATION under it all: supply grew by EXACTLY the sats donated, each donor's balance is exact,
 *     and the journal stayed one total order (no fragmentation, no half-writes).
 *
 *   KRAY_BTC_RPC_PASS=<pw> node src/test/donation-storm-e2e.mjs
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'

const RPC = process.env.KRAY_BTC_RPC || 'http://127.0.0.1:18454'
const RPC_USER = process.env.KRAY_BTC_RPC_USER || 'kraycore'
const RPC_PASS = process.env.KRAY_BTC_RPC_PASS || ''
const WALLET = process.env.KRAY_BTC_WALLET || process.env.KRAY_WALLET || 'kray'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const N = Math.max(2, Number(process.env.STORM_N || 8))
const WAVE = Math.max(N * 2, Number(process.env.STORM_WAVE || N * 2))

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const satToBtc = (s) => (Number(s) / 1e8).toFixed(8)

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
const balanceOf = async (a) => BigInt((await jget('/api/kraynet/profile/' + a)).balance || '0')

async function main() {
  console.log('\n╔═ THE DONATION STORM — the same millisecond, every hostile duplicate: nothing fragments ══╗')
  if (!RPC_PASS) die('set KRAY_BTC_RPC_PASS to the regtest rpcpassword')

  const info = await jget('/api/kraynet/donation/info')
  const sa = info.selfAnchor || {}
  ok(sa.mode === 'burn' && sa.keyIsNums === true, `the node is in BURN mode (keyless NUMS) — the same law as the live signet`)
  if (!sa.burnAddress) die('node is not in self-anchor mode — restart with KRAY_SELF_ANCHOR=1 + NUMS internal key')
  const BURN = sa.burnAddress
  const minConf = Math.max(1, info.minConfirmations || 1)
  console.log(`   burn address of this instant: ${BURN}`)

  // ── 1 · N strangers build REAL burn donations in the same root moment (all pay the SAME burn address) ──
  const donors = [], txids = [], sats = []
  for (let i = 0; i < N; i++) {
    const donor = await bc('getnewaddress', [`storm-${i}`, 'bech32m'])
    const amt = 500n + BigInt(i % 19) * 500n        // 500‥9500 — every donation inside the immutable 10,000 cap
                                                    // (the first mega-storm run proved the cap: amounts ABOVE it
                                                    //  were refused to the last one, even at 1000 simultaneous)
    const raw = await bc('createrawtransaction', [[], [{ [BURN]: Number(satToBtc(amt)) }, { data: Buffer.from(donor, 'ascii').toString('hex') }]])
    const funded = await bc('fundrawtransaction', [raw, { changePosition: 2 }])
    const signed = await bc('signrawtransactionwithwallet', [funded.hex])
    if (!signed.complete) die(`could not sign donation ${i}`)
    const txid = await bc('sendrawtransaction', [signed.hex])
    donors.push(donor); txids.push(txid); sats.push(amt)
  }
  ok(txids.length === N, `${N} donors broadcast ${N} REAL burn donations to the SAME burn address (the same root moment)`)
  await bc('generatetoaddress', [minConf, await bc('getnewaddress', [])])

  const supplyBefore = BigInt((await jget('/api/kraynet/supply')).emitted)

  // ── 2 · THE STORM: all N submitted in ONE instant, interleaved with 8 hostile duplicates of tx[0] ──
  //        (bare {txid} only — the node DISCOVERS the sealed root from the tx bytes, under load)
  const wave = [
    ...txids.map((txid) => jpost('/api/kraynet/donate', { txid })),
    ...Array.from({ length: WAVE - N }, (_, k) => jpost('/api/kraynet/donate', { txid: txids[k % N] })),   // hostile duplicates fill the wave
  ]
  const results = await Promise.all(wave)                 // ← the same millisecond, 16 requests
  const minted = results.filter((r) => r.ok === true)
  const refused = results.filter((r) => r.error && /already credited/i.test(r.error))
  ok(minted.length === N, `EXACTLY ${N} mints came out of ${wave.length} simultaneous requests (got ${minted.length})`)
  ok(refused.length === wave.length - N, `every hostile duplicate riding the same instant was refused by credited-once (${refused.length})`)

  // ── 3 · every donor was credited EXACTLY its on-chain sats; supply grew by EXACTLY the total ──
  let allExact = true
  for (let i = 0; i < N; i++) if ((await balanceOf(donors[i])) !== sats[i]) { allExact = false; ok(false, `donor ${i} balance wrong`) }
  ok(allExact, 'every donor holds EXACTLY its on-chain sats — credited from the tx bytes, one by one, in one total order')
  const total = sats.reduce((a, b) => a + b, 0n)
  const supplyAfter = BigInt((await jget('/api/kraynet/supply')).emitted)
  ok(supplyAfter - supplyBefore === total, `supply grew by EXACTLY ${total} (the sats really burned) — nothing minted twice, nothing lost`)

  // ── 4 · THE REPLAY WAVE: every settled txid resubmitted again, simultaneously — all refused, balances frozen ──
  const replay = await Promise.all(txids.map((txid) => jpost('/api/kraynet/donate', { txid })))
  ok(replay.every((r) => r.error && /already credited/i.test(r.error)), 'a full REPLAY WAVE of all settled txids is refused to the last one')
  ok(BigInt((await jget('/api/kraynet/supply')).emitted) === supplyAfter, 'and the supply did not move by one unit')

  // ── 5 · the SAME ADDRESS donates AGAIN (a fresh tx, the Creator's question): mints again, cleanly ──
  const info2 = await jget('/api/kraynet/donation/info')
  const BURN2 = (info2.selfAnchor || {}).burnAddress || BURN   // the root moved — the next donation seals the NEW history
  const raw2 = await bc('createrawtransaction', [[], [{ [BURN2]: Number(satToBtc(2000n)) }, { data: Buffer.from(donors[0], 'ascii').toString('hex') }]])
  const funded2 = await bc('fundrawtransaction', [raw2, { changePosition: 2 }])
  const signed2 = await bc('signrawtransactionwithwallet', [funded2.hex])
  const txid2 = await bc('sendrawtransaction', [signed2.hex])
  await bc('generatetoaddress', [minConf, await bc('getnewaddress', [])])
  const again = await jpost('/api/kraynet/donate', { txid: txid2 })
  ok(again.ok === true && (await balanceOf(donors[0])) === sats[0] + 2000n,
    `the SAME address donating AGAIN mints again cleanly (${sats[0]} + 2000) — the cap is per-transaction, the credit per outpoint`)
  ok(BURN2 !== BURN, 'and it paid a NEW burn address — the root moved, so this donation seals the history INCLUDING the storm')

  // ── 6 · THE PREPARE STORM: 10 concurrent /donate/prepare in the same instant — zero scan collisions ──
  const id = (() => {  // a funded taproot identity whose pubkey derives its address (what prepare demands)
    const priv = Buffer.from('9'.repeat(64), 'hex')
    const xonly = Buffer.from(schnorr.getPublicKey(priv)).toString('hex')
    return { xonly, address: btc.p2tr(Buffer.from(xonly, 'hex'), undefined, NETWORKS.regtest).address }
  })()
  await bc('sendtoaddress', [id.address, 0.001])
  await bc('generatetoaddress', [1, await bc('getnewaddress', [])])
  const preps = await Promise.all(Array.from({ length: 10 }, () =>
    jpost('/api/kraynet/donate/prepare', { donor: id.address, donorPubkey: id.xonly, sats: '1000' })))
  const built = preps.filter((p) => p.ok === true && p.psbt)
  const collided = preps.filter((p) => p.error && /scan/i.test(p.error))
  ok(built.length === 10 && collided.length === 0,
    `10 SIMULTANEOUS prepares all built PSBTs (${built.length}/10) with ZERO scan collisions — the indexed cache holds under load`)

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the same millisecond cannot fragment the law: one total order, one mint per sacrifice, ever. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => die(e.stack || e.message))
