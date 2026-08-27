/**
 * CHOSEN ₭ BURN — the user sends fungible ₭ into the fire.
 *   node src/test/star-chosen-burn-e2e.mjs
 *
 * It must appear on /blackhole under THE FIRE (sent by choice), never as a frozen star.
 * Does not touch Signet.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'burn-' + Date.now().toString(36)
const HOLE = 'KRAY_BLACK_HOLE'
const AMT = '13'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))

const id = (t) => {
  const s = nsha(new TextEncoder().encode('chosen-burn|' + t + '|' + TAG))
  const x = Buffer.from(schnorr.getPublicKey(s)).toString('hex')
  return {
    s, x, a: btc.p2tr(Buffer.from(x, 'hex'), undefined, NETWORKS[NET]).address,
    sign: (m) => Buffer.from(schnorr.sign(nsha(new TextEncoder().encode(m)), s)).toString('hex'),
  }
}

async function act(who, body) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: who.a })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)) }
  return jpost('/api/kraynet/submit', {
    ...body, from: who.a, nonce: prep.nonce, clock: prep.clock, publicKey: who.x,
    signature: who.sign(prep.message), scheme: 'kraywallet',
  })
}

async function main() {
  console.log('\n╔═ CHOSEN ₭ — user burn must land on /blackhole · the fire ═╗\n')
  const up = await jget('/api/kraynet/supply')
  if (up.__down) die(`no node at ${NODE}`)
  if (!up.fire) die('stale :4477 — reload so /supply publishes fire (do not touch pot-signer / Signet)')

  const beforeA = await jget('/api/kraynet/analytics')
  const fire0 = beforeA.blackHole.fire
  const frozen0 = Number(beforeA.blackHole.stars || 0)
  const chosen0 = BigInt(fire0.chosen || '0')
  const destroyed0 = BigInt(fire0.destroyed || '0')
  ok(beforeA.chain.conserves === true, 'bench conserves before the burn')
  ok(chosen0 === BigInt(beforeA.blackHole.kray || '0'), 'chosen ₭ is the hole balance (not a freeze)')

  const who = id('user')
  const mint = await jpost('/api/kraynet/donate', { to: who.a, sats: '80' })
  if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 — ' + (mint.error || ''))

  const send = await act(who, { action: 'transfer', to: HOLE, amount: AMT })
  ok(send.ok === true && send.hash, `user sent ${AMT} ₭ to the hole — hash ${send.hash}`)

  const afterA = await jget('/api/kraynet/analytics')
  const fire = afterA.blackHole.fire
  ok(BigInt(fire.chosen) === chosen0 + BigInt(AMT), `fire.chosen ${chosen0} → ${fire.chosen} (+${AMT})`)
  ok(BigInt(afterA.blackHole.kray) === chosen0 + BigInt(AMT), `hole ₭ balance is now ${afterA.blackHole.kray}`)
  ok(BigInt(fire.destroyed) === destroyed0, 'destroyed-into-stars did NOT move — this is not an inscribe')
  ok(Number(afterA.blackHole.stars) === frozen0, 'no star was frozen')
  ok(!(afterA.blackHole.frozen || []).some((s) => s.kind === 'kray'), 'freeze register has no ₭ rows')
  const row = (fire.log || []).find((x) => x.kind === 'chosen' && x.amount === AMT && x.txHash === send.hash)
  ok(!!row, 'fire log lists this send as kind=chosen')
  ok(row && row.by === who.a, 'the row names the user who burned')
  ok(row && !row.star, 'a chosen ₭ burn has no star number')
  ok(BigInt(fire.total) === BigInt(fire.destroyed) + BigInt(fire.chosen), 'the fire monument is destroyed + chosen')
  ok(afterA.chain.conserves === true, 'circulating = emitted − burned still holds (chosen ₭ sits at the hole)')

  const page = await fetch(NODE + '/blackhole').then((r) => r.text())
  ok(/the fire/.test(page) && /sent by choice/.test(page), '/blackhole copy has the fire + sent-by-choice')
  ok(/the freeze/.test(page), '/blackhole still has the freeze tab — stars only')

  const tx = await jget('/api/kraynet/tx/' + send.hash)
  ok(tx && (tx.to === HOLE || (tx.event && tx.event.to === HOLE) || JSON.stringify(tx).includes(HOLE)),
    'the tx page can be opened for this burn')

  if (fail) {
    console.error(`\n✗ ${fail} failed · ${pass} passed — CHOSEN BURN DID NOT SHOW\n`)
    process.exit(1)
  }
  console.log(`\n╚═ ${pass} checks — the user's ${AMT} ₭ is on /blackhole → THE FIRE → “sent by choice”.`)
  console.log(`   open  ${NODE}/blackhole`)
  console.log(`   act   ${NODE}/tx/${send.hash}`)
  console.log(`   chosen now ${fire.chosen} ₭ · destroyed ${fire.destroyed} ₭ · frozen stars ${afterA.blackHole.stars}`)
}

main()
