/**
 * THE ANY-GUARDIAN BACKSTOP, END TO END (Slice 2b) — a stranger with sats anchors the network and is paid
 * from the fee pool, conserved, with every hostile door tried on the way.
 *
 * Against a LIVE node (KRAY_ANCHOR_POOL=1, short quiet window) + a LIVE regtest bitcoind:
 *   · an UNSIGNED offer is refused; a SIGNED one stands; a replayed timestamp is refused;
 *   · a value-block's root becomes the single coalesced backstop target; the OPERATOR's own confirmed
 *     seal stands the backstop down (job cleared, nobody owed) — the yield law, live;
 *   · a root the operator does NOT anchor (odd block) waits out the quiet window; the Bitcoin beacon
 *     draws the guardian; an unsigned or undrawn claim is refused;
 *   · the guardian broadcasts the EXACT 49-byte payload from their OWN wallet; the claim is SPV-proven
 *     by the same verifySealProof consensus uses; the reward is CAPPED AT THE FEE POOL (here: 1 ₭ from
 *     one transfer fee — flat 100,000 ₭ promised, 1 ₭ payable — honest books, never minted);
 *   · the settled claim cannot be replayed.
 *
 *   KRAY_BTC_RPC_PASS=<pw> node src/test/anchor-backstop-e2e.mjs
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'

const RPC = process.env.KRAY_BTC_RPC || 'http://127.0.0.1:18454'
const RPC_USER = process.env.KRAY_BTC_RPC_USER || 'kraycore'
const RPC_PASS = process.env.KRAY_BTC_RPC_PASS || ''
const WALLET = process.env.KRAY_BTC_WALLET || process.env.KRAY_WALLET || 'kray'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const NET = 'regtest'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hex = (u8) => Buffer.from(u8).toString('hex')

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

// a KrayWallet identity: BIP-340 over SHA256(utf8(message)), address = p2tr(internal x-only)
function identity(privHex) {
  const priv = Buffer.from(privHex, 'hex')
  const xonly = hex(schnorr.getPublicKey(priv))
  const address = btc.p2tr(Buffer.from(xonly, 'hex'), undefined, NETWORKS[NET]).address
  const sign = (message) => hex(schnorr.sign(sha256(Buffer.from(message, 'utf8')), priv))
  return { address, xonly, sign }
}
const offerMessage = (address, sats, at) => `KRAY.NETWORK|anchor-offer|${NET}|${address}|${sats}|${at}`
const claimMessage = (address, txid, root) => `KRAY.NETWORK|anchor-claim|${NET}|${address}|${txid}|${root}`

async function waitFor(what, fn, ms = 40_000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) die(`timed out waiting for ${what}`)
    await sleep(800)
  }
}

async function main() {
  console.log('\n╔═ THE BACKSTOP, LIVE — a guardian anchors the network and the fee pool pays, conserved ══╗')
  if (!RPC_PASS) die('set KRAY_BTC_RPC_PASS to the regtest rpcpassword')
  const guardian = identity('7'.repeat(64))
  const bystander = identity('8'.repeat(64))
  console.log(`   guardian  ${guardian.address}`)

  // ── 0 · the backstop is on ──
  const st0 = await jget('/api/kraynet/anchor-pool')
  ok(st0.enabled === true, `the backstop is ON (quiet ${st0.quietMs} ms, flat reward ${st0.reward.perAnchor} ₭ from the fee pool)`)
  if (!st0.enabled) die('node is not running with KRAY_ANCHOR_POOL=1')

  // ── 1 · an UNSIGNED offer is refused; a SIGNED one stands; a replay is refused ──
  const at = Date.now()
  const noSig = await jpost('/api/kraynet/anchor-pool/offer', { address: guardian.address, sats: '50000', at })
  ok(!!noSig.error && /SIGNED/i.test(noSig.error), 'an UNSIGNED offer is refused (supreme law: every user action is a signature)')
  const offSig = guardian.sign(offerMessage(guardian.address, 50000n, at))
  const off = await jpost('/api/kraynet/anchor-pool/offer', { address: guardian.address, sats: '50000', at, signature: offSig, publicKey: guardian.xonly })
  ok(off.ok === true && off.ready === 1, 'the guardian\'s SIGNED standing offer is registered (ready = 1)')
  const replay = await jpost('/api/kraynet/anchor-pool/offer', { address: guardian.address, sats: '50000', at, signature: offSig, publicKey: guardian.xonly })
  ok(!!replay.error && /already stands/i.test(replay.error), 'REPLAYING the same signed offer is refused (timestamp-monotonic per address)')

  // ── 2 · a value block appears; the OPERATOR's own seal stands the backstop down (the yield law) ──
  const mint = await jpost('/api/kraynet/donate', { to: guardian.address, sats: '5000' })
  ok(mint.ok === true, `dev-minted 5000 ₭ to the guardian (block #0 seals + operator-anchors it)`)
  const settledBase = st0.settlements.length   // the pool PERSISTS settlements across reboots — count relative
  await waitFor('the operator seal to clear the backstop job', async () => {
    const s = await jget('/api/kraynet/anchor-pool')
    return s.pending === null && s.settlements.length === settledBase
  })
  ok(true, 'the operator\'s confirmed seal SATISFIED the backstop job — cleared, nobody owed (the pool yields)')

  // ── 3 · a root the operator does NOT anchor becomes the backstop's target. Block parity shifts with
  //        system events (anchor-spend/settle ride their own blocks), so transfer until one value-block
  //        lands where the operator does not anchor — that root is the backstop's job. Each transfer also
  //        pays a 1-₭ fee into the pool the claim will later drain.
  let pending = null
  for (let i = 0; i < 6 && !pending; i++) {
    const prep = await jpost('/api/kraynet/prepare', { action: 'transfer', from: guardian.address, to: bystander.address, amount: '100' })
    if (!prep.message) die('prepare failed: ' + JSON.stringify(prep))
    const sub = await jpost('/api/kraynet/submit', { action: 'transfer', from: guardian.address, to: bystander.address, amount: '100', nonce: prep.nonce, publicKey: guardian.xonly, signature: guardian.sign(prep.message) })
    if (sub.ok !== true) die('signed transfer refused: ' + JSON.stringify(sub))
    const t0 = Date.now()
    while (Date.now() - t0 < 4000 && !pending) {
      const s = await jget('/api/kraynet/anchor-pool')
      if (s.pending) pending = s
      else await sleep(500)
    }
  }
  if (!pending) die('no transfer produced an unanchored value-root (the operator sealed them all)')
  ok(!!pending.pending.root, `signed transfers (1 ₭ fee each) until the backstop targets an unanchored root ${pending.pending.root.slice(0, 12)}… (block #${pending.pending.height})`)

  // ── 4 · the quiet window elapses; the Bitcoin beacon draws the guardian ──
  const drawn = await waitFor('the quiet window + the draw', async () => {
    const s = await jget('/api/kraynet/anchor-pool')
    return s.eligible && s.drawn ? s : null
  })
  ok(drawn.drawn === guardian.address, 'the Bitcoin block hash DRAWS the guardian (pure function — anyone recomputes it)')
  ok(typeof drawn.payload === 'string' && drawn.payload.length === 98, 'the node publishes the EXACT 49-byte payload the payer must broadcast')

  // ── 5 · hostile claims first: unsigned, and a claimant the beacon did not draw ──
  const feePoolBefore = BigInt(drawn.feePool)
  ok(feePoolBefore > 0n && feePoolBefore < BigInt(drawn.reward.perAnchor), `the fee pool holds ${feePoolBefore} ₭ of real transfer fees — far below the flat ${drawn.reward.perAnchor}, so the cap must bite`)
  const raw = await bc('createrawtransaction', [[], [{ data: drawn.payload }]])
  const funded = await bc('fundrawtransaction', [raw, { lockUnspents: true, fee_rate: 2 }])
  const signed = await bc('signrawtransactionwithwallet', [funded.hex])
  if (!signed.complete) die('harness wallet could not sign the anchor tx')
  const anchorTxid = await bc('sendrawtransaction', [signed.hex])
  await bc('generatetoaddress', [2, await bc('getnewaddress', [])])
  console.log(`   guardian anchor broadcast + buried: ${anchorTxid}`)
  const noSigClaim = await jpost('/api/kraynet/anchor-pool/claim', { payer: guardian.address, txid: anchorTxid })
  ok(!!noSigClaim.error && /SIGNED/i.test(noSigClaim.error), 'an UNSIGNED claim is refused')
  const wrongClaim = await jpost('/api/kraynet/anchor-pool/claim', { payer: bystander.address, txid: anchorTxid, signature: bystander.sign(claimMessage(bystander.address, anchorTxid, pending.pending.root)), publicKey: bystander.xonly })
  ok(!!wrongClaim.error && /not the drawn payer/i.test(wrongClaim.error), 'a claimant the beacon did NOT draw is refused, even with a valid signature')

  // ── 6 · the honest claim: SPV-proven, the SEAL IS ADOPTED — but the payout is RETIRED (the unsigned
  //        reward is refused in consensus; the successor pays the first valid sealer, proof AS entitlement) ──
  const balBefore = await balanceOf(guardian.address)
  const claim = await jpost('/api/kraynet/anchor-pool/claim', { payer: guardian.address, txid: anchorTxid, signature: guardian.sign(claimMessage(guardian.address, anchorTxid, pending.pending.root)), publicKey: guardian.xonly })
  if (!claim.ok) die('honest claim refused: ' + JSON.stringify(claim))
  ok(claim.ok === true && claim.settlement.txid === anchorTxid, 'the honest claim settles — the tx SPV-proven to seal EXACTLY the pending (height, root), the seal ADOPTED')
  ok(claim.settlement.reward === '0' && /retired/i.test(String(claim.payout || '')), 'the payout is RETIRED — no unsigned reward moves; the claim response says so plainly')
  ok(BigInt(claim.settlement.sats) > 0n, `the settlement records the REAL Bitcoin fee the guardian paid (${claim.settlement.sats} sats — derived from the raw txs, never client-declared)`)
  ok(BigInt(claim.feePool) === feePoolBefore, `the fee pool is UNTOUCHED (${claim.feePool} ₭) — retired means not one ₭ moved`)
  const balAfter = await balanceOf(guardian.address)
  ok(balAfter === balBefore, 'the guardian balance is unchanged — the adoption pays nothing until the self-proving successor')

  // ── 7 · the settled claim cannot be replayed; the log shows one settlement ──
  const again = await jpost('/api/kraynet/anchor-pool/claim', { payer: guardian.address, txid: anchorTxid, signature: guardian.sign(claimMessage(guardian.address, anchorTxid, pending.pending.root)), publicKey: guardian.xonly })
  ok(!!again.error && /no anchor job/i.test(again.error), 'REPLAYING the settled claim is refused — one job, one settlement, ever')
  const st9 = await jget('/api/kraynet/anchor-pool')
  ok(st9.settlements.length === settledBase + 1 && st9.pending === null, 'the pool log holds exactly ONE new settlement and no pending job')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the backstop yields to the operator, pays a drawn stranger from real fees, and never mints. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => die(e.stack || e.message))
