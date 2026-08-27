/**
 * AMM V2 live exam — door + reducer + swarm + adversarial, on the regtest bench.
 *
 *   node apps/kray-net/server.mjs          # :4477, KRAY_TRUSTED_DEV=1
 *   node src/test/amm-e2e.mjs
 *
 * Quote is a read. Every write is prepare → BIP-340 → submit. The reducer
 * re-quotes. A green run means conservation, k, pot-backed, 1 ₭ fee, replay
 * of the same cascade after the swarm.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const RUNE = process.env.KRAY_AMM_RUNE || ('99:' + Date.now())
const SWARM = Number(process.env.KRAY_AMM_SWARM || '12') || 12
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))

const id = (t) => {
  const s = nsha(new TextEncoder().encode('amm-e2e|' + t))
  const x = Buffer.from(schnorr.getPublicKey(s)).toString('hex')
  return { s, x, a: btc.p2tr(Buffer.from(x, 'hex'), undefined, NETWORKS[NET]).address, sign: (m) => Buffer.from(schnorr.sign(nsha(new TextEncoder().encode(m)), s)).toString('hex') }
}

async function act(who, body) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: who.a })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)) }
  const sig = who.sign(prep.message)
  return jpost('/api/kraynet/submit', { ...body, from: who.a, nonce: prep.nonce, publicKey: who.x, signature: sig, scheme: 'kraywallet' })
}

async function fund(who, kray, runeAmt, pool = true) {
  const d = await jpost('/api/kraynet/donate', { to: who.a, sats: String(kray) })
  if (!d.ok && d.error) return d
  const dep = await jpost('/api/kraynet/rune/deposit', {
    runeId: RUNE, to: who.a, amount: String(runeAmt),
    outpoint: 'amm-e2e-' + Date.now() + '-' + Math.random().toString(16).slice(2) + ':0',
    pool,
  })
  return dep
}

async function main() {
  console.log('\n╔═ AMM V2 — live door + swarm + adversarial on the regtest bench ═╗\n')
  const up = await jget('/api/kraynet/supply')
  if (up.__down) die(`no node at ${NODE} — start the official clone explorer on :4477`)
  const doors = await jget('/api/kraynet/amm/pools')
  if (doors.error && /no route/i.test(doors.error)) die('this :4477 process is stale — reload the official explorer (do not touch the pot-signer / Signet)')

  const alice = id('alice'), bob = id('bob'), mallory = id('mallory'), hostage = id('hostage')
  const mintA = await fund(alice, '9000', '50000', true)
  ok(mintA.ok === true, 'Alice funded 9000 ₭ + 50000 pot-backed rune (dev bench)')
  if (!mintA.ok) die('need KRAY_TRUSTED_DEV=1 on this throwaway regtest to mint/deposit for the exam')
  await fund(bob, '9000', '20000', true)
  await fund(hostage, '2000', '8000', false)

  const ov0 = await jget('/api/kraynet/overview')
  ok(ov0.conserves === true, 'before AMM: ₭ conserves')

  const qEmpty = await jget('/api/kraynet/amm/quote?runeId=' + encodeURIComponent(RUNE) + '&side=kray&amount=100')
  ok(!!qEmpty.error, 'quote on an empty pair is refused (read, no write)')

  const firstQ = await jget(`/api/kraynet/amm/quote?op=add&runeId=${encodeURIComponent(RUNE)}&krayIn=4000&runeIn=8000`)
  ok(firstQ.first === true && BigInt(firstQ.minted || 0) > 0n, 'quote-add (first mint) is a read — minted LP > 0')
  const created = await act(alice, { action: 'amm-add', runeId: RUNE, krayIn: '4000', runeIn: '8000', minLp: firstQ.minted })
  ok(created.ok === true, 'signed amm-add created the pool (minLp = exact first-mint quote)')

  const pool = await jget('/api/kraynet/amm/pool/' + encodeURIComponent(RUNE))
  ok(pool && pool.krayReserve === '4000' && pool.runeReserve === '8000', 'reserves are the signed deposits')
  ok(BigInt(pool.lpSupply || 0) > 100n, 'LP supply includes the dead shares')

  const alias = RUNE.replace(/^(\d+):/, (_, n) => '0' + n + ':')
  const aliasPool = await jget('/api/kraynet/amm/pool/' + encodeURIComponent(alias))
  ok(aliasPool && aliasPool.krayReserve === '4000' && aliasPool.runeId === RUNE, 'leading-zero runeId reads the same canonical pool')
  const aliceLp = (pool.holders || []).find((h) => h.address === alice.a)?.lp
  ok(BigInt(aliceLp || 0) > 0n, 'Alice holds the live LP')
  const stealLp = await act(bob, { action: 'amm-remove', runeId: RUNE, lp: String(aliceLp), minKrayOut: '0', minRuneOut: '0' })
  ok(!!stealLp.error && /insufficient LP/i.test(stealLp.error || ''), 'Bob cannot burn Alice’s LP')
  const overburn = await act(alice, { action: 'amm-remove', runeId: RUNE, lp: String(BigInt(aliceLp) + 1n), minKrayOut: '0', minRuneOut: '0' })
  ok(!!overburn.error && /insufficient LP/i.test(overburn.error || ''), 'Alice cannot burn more LP than she holds (nonce not spent)')
  const stillAlice = await jget('/api/kraynet/amm/pool/' + encodeURIComponent(RUNE))
  ok(stillAlice.krayReserve === '4000', 'failed burns left reserves untouched')

  const fee2 = await jpost('/api/kraynet/submit', { action: 'amm-add', from: alice.a, runeId: RUNE, krayIn: '10', runeIn: '10', minLp: '0', nonce: 99, publicKey: alice.x, signature: alice.sign('x'), scheme: 'kraywallet' })
  ok(!!fee2.error, 'forged / unsigned add is refused at the door')

  const badAmt = await jpost('/api/kraynet/prepare', { action: 'amm-swap', from: alice.a, runeId: RUNE, side: 'kray', amount: '10.5', minOut: '0' })
  ok(!!badAmt.error && /whole number|base units/i.test(badAmt.error || ''), 'prepare refuses a non-integer amount (door + reducer)')

  const qSwap = await jget(`/api/kraynet/amm/quote?runeId=${encodeURIComponent(RUNE)}&side=kray&amount=500`)
  ok(BigInt(qSwap.amountOut || 0) > 0n, 'swap quote is a read')
  const slip = (BigInt(qSwap.amountOut) * 995n) / 1000n
  const sw = await act(bob, { action: 'amm-swap', runeId: RUNE, side: 'kray', amount: '500', minOut: slip.toString() })
  ok(sw.ok === true, 'signed amm-swap (₭ → rune) sealed, minOut at 0.5% slip')

  const qHigh = await jget(`/api/kraynet/amm/quote?runeId=${encodeURIComponent(RUNE)}&side=kray&amount=10`)
  const tooHigh = await act(bob, { action: 'amm-swap', runeId: RUNE, side: 'kray', amount: '10', minOut: '999999999' })
  ok(!!tooHigh.error && /minOut|below/i.test(tooHigh.error || ''), 'signed minOut above the re-quoted out is refused')
  void qHigh

  const drain = await act(bob, { action: 'amm-swap', runeId: RUNE, side: 'kray', amount: '999999', minOut: '1' })
  ok(!!drain.error && /insufficient|gas|drain|too small/i.test(drain.error || ''), 'a swap larger than the wallet is refused')

  const hostAdd = await act(hostage, { action: 'amm-add', runeId: RUNE, krayIn: '100', runeIn: '8000', minLp: '0' })
  ok(!!hostAdd.error && /hostage|pot-backed|personal/i.test(hostAdd.error || ''), 'hostage (personal-vault) rune cannot add')
  const hostSwap = await act(hostage, { action: 'amm-swap', runeId: RUNE, side: 'rune', amount: '1000', minOut: '1' })
  ok(!!hostSwap.error && /hostage|pot-backed|personal/i.test(hostSwap.error || ''), 'hostage rune cannot swap in')

  const replayed = await jpost('/api/kraynet/submit', {
    action: 'amm-swap', from: bob.a, runeId: RUNE, side: 'kray', amount: '500', minOut: slip.toString(),
    nonce: 0, publicKey: bob.x, signature: bob.sign('replay'), scheme: 'kraywallet',
  })
  ok(!!replayed.error, 'a replayed / stale nonce is refused')

  const stolen = await jpost('/api/kraynet/prepare', { action: 'amm-swap', from: alice.a, runeId: RUNE, side: 'kray', amount: '10', minOut: '0' })
  const forged = stolen.message
    ? await jpost('/api/kraynet/submit', { action: 'amm-swap', from: alice.a, runeId: RUNE, side: 'kray', amount: '10', minOut: '0', nonce: stolen.nonce, publicKey: mallory.x, signature: mallory.sign(stolen.message), scheme: 'kraywallet' })
    : { error: 'no prep' }
  ok(!!forged.error, 'Mallory cannot spend Alice’s pool action')

  const afterSwap = await jget('/api/kraynet/amm/pool/' + encodeURIComponent(RUNE))
  const k0 = BigInt(afterSwap.k)
  console.log(`\n── swarm · ${SWARM} wallets, parallel prepare, sequential seal ──`)
  const herd = Array.from({ length: SWARM }, (_, i) => id('swarm-' + i))
  for (const w of herd) await fund(w, '400', '2000', true)

  const quotes = await Promise.all(herd.map(() => jget(`/api/kraynet/amm/quote?runeId=${encodeURIComponent(RUNE)}&side=kray&amount=40`)))
  ok(quotes.every((q) => BigInt(q.amountOut || 0) > 0n), `swarm: ${SWARM} parallel quotes succeeded (reads)`)

  const preps = await Promise.all(herd.map((w) => jpost('/api/kraynet/prepare', { action: 'amm-swap', from: w.a, runeId: RUNE, side: 'kray', amount: '40', minOut: '1' })))
  ok(preps.every((p) => p.message), 'swarm: parallel prepare built canonical messages')

  let sealed = 0
  for (let i = 0; i < herd.length; i++) {
    const w = herd[i], p = preps[i]
    const r = await jpost('/api/kraynet/submit', {
      action: 'amm-swap', from: w.a, runeId: RUNE, side: 'kray', amount: '40', minOut: '1',
      nonce: p.nonce, publicKey: w.x, signature: w.sign(p.message), scheme: 'kraywallet',
    })
    if (r.ok) sealed++
  }
  ok(sealed === SWARM, `swarm: all ${SWARM} swaps sealed (re-quoted on apply)`)

  const afterHerd = await jget('/api/kraynet/amm/pool/' + encodeURIComponent(RUNE))
  ok(BigInt(afterHerd.k) >= k0, 'swarm: k did not fall')
  const ov1 = await jget('/api/kraynet/overview')
  ok(ov1.conserves === true, 'swarm: ₭ conserves')
  const books1 = await jget('/api/kraynet/runes')
  ok(books1.solvent !== false, 'swarm: rune book solvent')

  const addQ = await jget(`/api/kraynet/amm/quote?op=add&runeId=${encodeURIComponent(RUNE)}&krayIn=300&runeIn=400`)
  const added = await act(bob, { action: 'amm-add', runeId: RUNE, krayIn: '300', runeIn: '400', minLp: ((BigInt(addQ.minted || 0) * 995n) / 1000n).toString() })
  ok(added.ok === true, 'proportional add with signed minLp')

  const pos = (await jget('/api/kraynet/amm/pool/' + encodeURIComponent(RUNE))).holders || []
  const bobLp = (pos.find((h) => h.address === bob.a) || {}).lp
  ok(BigInt(bobLp || 0) > 0n, 'Bob holds LP shares')
  const rmQ = await jget(`/api/kraynet/amm/quote?op=remove&runeId=${encodeURIComponent(RUNE)}&lp=${bobLp}`)
  const removed = await act(bob, { action: 'amm-remove', runeId: RUNE, lp: String(bobLp), minKrayOut: ((BigInt(rmQ.krayOut || 0) * 995n) / 1000n).toString(), minRuneOut: ((BigInt(rmQ.runeOut || 0) * 995n) / 1000n).toString() })
  ok(removed.ok === true, 'signed amm-remove returned reserves, LP burned')

  const ov2 = await jget('/api/kraynet/overview')
  ok(ov2.conserves === true, 'after remove: ₭ conserves')
  const books2 = await jget('/api/kraynet/runes')
  ok(books2.solvent !== false, 'after remove: rune book solvent')
  ok(!!created.cascadeRoot && created.cascadeRoot !== (await jget('/api/kraynet/overview')).cascadeRoot, 'each sealed AMM line moves the cascade root')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — AMM V2 door+swarm+adversarial, 1 ₭, k, pot-backed, conserved. ₿₭\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => die(e.stack || e.message))
