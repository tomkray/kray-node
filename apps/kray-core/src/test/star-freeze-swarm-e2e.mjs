/**
 * STAR FREEZE — live swarm on the regtest bench (:4477).
 *
 *   node src/test/star-freeze-swarm-e2e.mjs
 *
 * Does not touch Signet / pot-signer.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'ice-' + Date.now().toString(36)
const HOLE = 'KRAY_BLACK_HOLE'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))

const id = (t) => {
  const s = nsha(new TextEncoder().encode('star-freeze-live|' + t + '|' + TAG))
  const x = Buffer.from(schnorr.getPublicKey(s)).toString('hex')
  return {
    s, x, a: btc.p2tr(Buffer.from(x, 'hex'), undefined, NETWORKS[NET]).address,
    sign: (m) => Buffer.from(schnorr.sign(nsha(new TextEncoder().encode(m)), s)).toString('hex'),
  }
}

async function act(who, body) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: who.a })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)), _star: prep.star }
  const sub = await jpost('/api/kraynet/submit', {
    ...body, from: who.a, code: prep.code || body.code, nonce: prep.nonce, clock: prep.clock, publicKey: who.x,
    signature: who.sign(prep.message), scheme: 'kraywallet',
  })
  return { ...sub, _star: sub.star ?? prep.star, _address: sub.address }
}

async function main() {
  console.log('\n╔═ STAR FREEZE — live swarm on the bench ═╗\n')
  const up = await jget('/api/kraynet/donation/info')
  if (up.__down) die(`no node at ${NODE}`)
  if (up.contractStarBurn == null) die('stale :4477 — reload the official explorer (do not touch pot-signer / Signet)')

  const before = await jget('/api/kraynet/analytics')
  const frozen0 = Number((before.blackHole && before.blackHole.stars) || 0)
  const burned0 = BigInt((before.supply && before.supply.burned) || '0')
  ok(before.chain && before.chain.conserves === true, 'bench conserves before the ice')

  const crew = [0, 1, 2, 3, 4].map((i) => id('w' + i))
  const eve = id('eve')
  for (const w of [...crew, eve]) {
    const mint = await jpost('/api/kraynet/donate', { to: w.a, sats: '80' })
    if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 — ' + (mint.error || ''))
  }

  const born = await Promise.all(crew.map((w, i) => act(w, { action: 'name', name: ('ice' + TAG.slice(-5) + i).replace(/\W/g, '') })))
  const stars = born.map((r) => r._star).filter((s) => s != null)
  ok(born.every((r) => r.ok) && stars.length === 5, `five faces born — ${stars.map((n) => '#' + n).join(' · ')}`)

  const iced = await Promise.all(stars.slice(0, 4).map((no, i) =>
    act(crew[i], { action: 'sendstar', to: HOLE, star: String(no) })))
  ok(iced.every((r) => r.ok), 'parallel freeze of four stars')

  const after = await jget('/api/kraynet/analytics')
  ok(Number(after.blackHole.stars) === frozen0 + 4, `freeze register +4 (now ${after.blackHole.stars})`)
  ok(BigInt(after.supply.burned) === burned0 + 5n, 'only the five baptisms burned — the freezes did not')
  ok((after.blackHole.frozen || []).filter((s) => stars.slice(0, 4).map(String).includes(String(s.star))).length === 4,
    'the four iced faces sit on the freeze register')

  const keep = await jget('/api/kraynet/star/' + stars[4])
  ok(keep.owner === crew[4].a, `#${stars[4]} stayed living`)
  const dead = await jget('/api/kraynet/star/' + stars[0])
  ok(dead.owner === HOLE && dead.name, `#${stars[0]} is frozen and still named`)

  const steal = await act(eve, { action: 'sendstar', to: HOLE, star: String(stars[4]) })
  ok(!!steal.error, 'Eve cannot freeze the living spare')
  const again = await act(crew[0], { action: 'sendstar', to: HOLE, star: String(stars[0]) })
  ok(!!again.error, 're-freeze is refused')
  const speak = await jget('/api/kraynet/speak?star=' + stars[0])
  ok(!!speak.error && /living mouth/i.test(String(speak.error)), 'speak on ice is refused')

  const end = await jget('/api/kraynet/analytics')
  ok(Number(end.blackHole.stars) === frozen0 + 4, 'attacks added no extra ice')
  ok(end.chain.conserves === true, 'bench conserves after the ice')

  if (fail) {
    console.error(`\n✗ ${fail} failed · ${pass} passed — LIVE FREEZE BROKE\n`)
    process.exit(1)
  }
  console.log(`\n╚═ ${pass} checks — four faces iced on the bench, one still living, attacks froze nothing. ❄\n`)
  console.log(`   register: /blackhole  ·  iced ${stars.slice(0, 4).map((n) => '#' + n).join(' · ')}  ·  living #${stars[4]}`)
}

main()
