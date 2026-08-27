/**
 * THE DONATE, END TO END, THROUGH THE NODE — a real Bitcoin payment mints real ₭, proven by SPV.
 *
 * No fixtures, no dev {to, sats}. The harness builds a REAL regtest transaction that pays the
 * anchoring pot and commits the donor's KRAY address in an OP_RETURN (the exact bytes
 * `donorOpReturnScriptHex` emits), broadcasts it, mines it, then hands the NODE only the confirmed
 * {txid}. The node fetches the SPV proof from its OWN bitcoind, re-proves it with
 * `verifyDonationProof` (pot output value = sats, buried under work, donor read from the OP_RETURN),
 * and mints to the donor. We then read the donor's balance back and the pot/supply — the whole
 * chain (Bitcoin payment → SPV → mint) is exercised against the live node, not a stub.
 *
 *   KRAY_BTC_RPC_PASS=<pw> node src/test/donate-node-e2e.mjs
 */
const RPC = process.env.KRAY_BTC_RPC || 'http://127.0.0.1:18454'
const RPC_USER = process.env.KRAY_BTC_RPC_USER || 'kraycore'
const RPC_PASS = process.env.KRAY_BTC_RPC_PASS || ''
const WALLET = process.env.KRAY_WALLET || 'kray'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const SATS = BigInt(process.env.SATS || '10000') // one mint-cap: 10k sats → 10k ₭ (1 ₭ / sat; MINT_CAP_SATS, the max a single donation mints)

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
const satToBtc = (s) => (Number(s) / 1e8).toFixed(8)

async function main() {
  console.log('\n╔═ THE DONATE — a real Bitcoin payment mints ₭, SPV-proven by the node itself ══╗')
  if (!RPC_PASS) die('set KRAY_BTC_RPC_PASS to the regtest rpcpassword')

  // ── 0 · the node must have the pot configured (else it cannot verify a proof) ──
  const info = await jget('/api/kraynet/donation/info')
  ok(info.configured === true && info.potAddress, `node has the anchoring pot configured (${String(info.potAddress).slice(0, 18)}…, minConf ${info.minConfirmations})`)
  if (!info.configured) die('node has no pot configured — restart it with KRAY_POT_ADDRESS')
  const POT = info.potAddress
  const before = await jget('/api/kraynet/supply')

  // ── 1 · the donor — a fresh KRAY address (any valid bcrt1 identity on the L2) ──
  const donor = await bc('getnewaddress', ['donor', 'bech32m'])
  const mineAddr = await bc('getnewaddress', ['', 'bech32m'])
  const dataHex = Buffer.from(donor, 'ascii').toString('hex') // {data} → OP_RETURN 6a<len><ascii> == donorOpReturnScriptHex
  ok(donor.startsWith('bcrt1') && dataHex.length / 2 >= 8 && dataHex.length / 2 <= 75, `donor KRAY address fits a single-push OP_RETURN (${dataHex.length / 2} bytes)`)
  const donorBalBefore = BigInt((await jget('/api/kraynet/profile/' + donor)).balance || '0')

  // ── 2 · build the REAL donation tx: pay the pot + commit the donor (OP_RETURN) ──
  const raw = await bc('createrawtransaction', [[], [{ [POT]: Number(satToBtc(SATS)) }, { data: dataHex }]])
  const funded = await bc('fundrawtransaction', [raw, { changePosition: 2 }]) // keep pot@0, OP_RETURN@1
  const signed = await bc('signrawtransactionwithwallet', [funded.hex])
  if (!signed.complete) die('the wallet could not fully sign the donation tx')
  const txid = await bc('sendrawtransaction', [signed.hex])
  ok(!!txid, `donation tx broadcast (${txid.slice(0, 16)}… pays ${SATS} sats to the pot)`)

  // ── 3 · bury it under one block (the node needs minConf confirmations) ──
  await bc('generatetoaddress', [Math.max(1, info.minConfirmations), mineAddr])

  // ── 4 · hand the NODE only the txid — it fetches the proof from its bitcoind + re-proves it ──
  const res = await jpost('/api/kraynet/donate', { txid })
  ok(res.ok === true, `node accepted the donation from just {txid} — it fetched the SPV proof from its own bitcoind and re-proved it${res.error ? ' [' + res.error + ']' : ''}`)
  ok(res.credited === donor, `node credited the DONOR read from the on-chain OP_RETURN (${String(res.credited).slice(0, 18)}…)`)
  ok(res.sats === String(SATS), `minted exactly the on-chain pot output value — ${res.sats} sats (never a client field)`)

  // ── 5 · read the donor's balance back + the pot/supply moved ──
  const donorBalAfter = BigInt((await jget('/api/kraynet/profile/' + donor)).balance || '0')
  ok(donorBalAfter - donorBalBefore === SATS, `donor's ₭ balance rose by exactly ${SATS} (${donorBalBefore} → ${donorBalAfter})`)
  const after = await jget('/api/kraynet/supply')
  ok(BigInt(after.emitted) - BigInt(before.emitted) === SATS, `total ₭ emitted rose by exactly ${SATS} (${before.emitted} → ${after.emitted})`)

  // ── 6 · the SAME txid cannot mint twice (credited once, ever, by the outpoint) ──
  const dup = await jpost('/api/kraynet/donate', { txid })
  const donorBalDup = BigInt((await jget('/api/kraynet/profile/' + donor)).balance || '0')
  ok(donorBalDup === donorBalAfter, `re-submitting the same txid does NOT double-mint (balance still ${donorBalAfter}) — the outpoint is credited once, ever`)

  // ── 7 · the whole net still conserves + is backed by real satoshis ──
  const ov = await jget('/api/kraynet/overview')
  ok(ov.conserves !== false && ov.backed !== false, 'the net still conserves — Σ balances == emitted − burned, every ₭ backed by a real satoshi')

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — a real Bitcoin donation, buried under work, was SPV-proven by the node against its own bitcoind and minted 1:1 to the donor committed on-chain; it cannot mint twice. The mint is math, not trust. ⚗️₿`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => die(e.stack || e.message))
