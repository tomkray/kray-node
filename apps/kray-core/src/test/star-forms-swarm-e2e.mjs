/**
 * SEALED FORMS — live adversarial + race on the regtest bench (:4477).
 *   node src/test/star-forms-swarm-e2e.mjs
 * Does not touch Signet / pot-signer.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'fadv-' + Date.now().toString(36)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))
const bal = async (a) => BigInt((await jget('/api/kraynet/profile/' + encodeURIComponent(a))).balance || '0')

const id = (t) => {
  const s = nsha(new TextEncoder().encode('forms-adv-e2e|' + t + '|' + TAG))
  const x = Buffer.from(schnorr.getPublicKey(s)).toString('hex')
  return {
    s, x, a: btc.p2tr(Buffer.from(x, 'hex'), undefined, NETWORKS[NET]).address,
    sign: (m) => Buffer.from(schnorr.sign(nsha(new TextEncoder().encode(m)), s)).toString('hex'),
  }
}

async function act(who, body) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: who.a })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)), _prep: prep }
  const sub = await jpost('/api/kraynet/submit', {
    ...body, from: who.a, code: prep.code || body.code, nonce: prep.nonce, clock: prep.clock, publicKey: who.x,
    signature: who.sign(prep.message), scheme: 'kraywallet',
  })
  return { ...sub, _star: prep.star ?? sub.star, _address: sub.address, _code: prep.code, _message: prep.message, _nonce: prep.nonce }
}

async function main() {
  console.log('\n╔═ STAR FORMS LIVE ATTACK — door · race · vest top-up ═╗\n')
  const info = await jget('/api/kraynet/donation/info')
  if (info.__down) die('no node at ' + NODE)
  if (info.contractScroll == null) die('stale :4477 — reload the official explorer (do not touch pot-signer / Signet)')
  ok(info.contractScroll === true && info.contractForms === true, 'door publishes scroll + catalog')

  const paper = id('paper'), buyer = id('buyer'), seller = id('seller'), eve = id('eve')
  const pack = [paper, buyer, seller, eve]
  for (const w of pack) {
    const mint = await jpost('/api/kraynet/donate', { to: w.a, sats: '250' })
    if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 — ' + (mint.error || ''))
  }

  const named = await act(paper, { action: 'name', name: ('adv' + TAG.slice(-6)).replace(/\W/g, '') })
  ok(named.ok && named._star != null, `paper #${named._star}`)
  const face = String(named._star)

  const garb = await jpost('/api/kraynet/prepare', {
    action: 'contract', from: paper.a, star: face,
    form: { kind: 'scroll', each: '0', max: '1', locked: true, gate: 'open' },
  })
  ok(!!garb.error, 'door refuses each=0')
  const nine = await jpost('/api/kraynet/prepare', {
    action: 'contract', from: paper.a, star: face,
    form: { kind: 'scroll', each: '1', gate: 'list', locked: true, allow: pack.concat(id('x1'), id('x2'), id('x3'), id('x4'), id('x5')).map((w) => w.a) },
  })
  ok(!!nine.error, 'door refuses a 9-address list')
  const v1unlock = await jpost('/api/kraynet/prepare', {
    action: 'contract', from: paper.a,
    form: { kind: 'scroll', each: '1', max: '1', locked: false, gate: 'open' },
  })
  ok(!!v1unlock.error, 'door refuses v1 unlocked scroll (needs a star)')

  const vestStar = await act(paper, { action: 'name', name: ('vadv' + TAG.slice(-6)).replace(/\W/g, '') })
  const vest = await act(paper, {
    action: 'contract', star: String(vestStar._star),
    form: { kind: 'vest', beneficiary: seller.a, duration: '1', total: '20' },
  })
  ok(vest.ok, `vest on #${vestStar._star}`)
  await act(paper, { action: 'transfer', to: vest._address, amount: '8' })
  const s0 = await bal(seller.a)
  const r1 = await act(eve, { action: 'contract-call', contract: vest._address, rule: 'release', args: {} })
  ok(r1.ok === true && await bal(seller.a) === s0 + 8n, 'underfunded vest paid 8 to the beneficiary')
  await act(paper, { action: 'transfer', to: vest._address, amount: '12' })
  const r2 = await act(eve, { action: 'contract-call', contract: vest._address, rule: 'release', args: {} })
  ok(r2.ok === true && await bal(seller.a) === s0 + 20n, 'top-up release paid the remaining 12 — pot did not lock forever')

  const scStar = await act(paper, { action: 'name', name: ('scad' + TAG.slice(-6)).replace(/\W/g, '') })
  const scroll = await act(paper, {
    action: 'contract', star: String(scStar._star),
    form: { kind: 'scroll', each: '5', max: '1', locked: true, gate: 'open' },
  })
  ok(scroll.ok && !(scroll.rules || []).includes('collect'), 'locked open scroll, one claim')
  await act(paper, { action: 'transfer', to: scroll._address, amount: '5' })

  const unsigned = await jpost('/api/kraynet/submit', {
    action: 'contract-call', from: eve.a, contract: scroll._address, rule: 'claim', args: {},
  })
  ok(!!unsigned.error, 'unsigned claim is refused at the door')
  const replayPrep = await jpost('/api/kraynet/prepare', {
    action: 'contract-call', from: buyer.a, contract: scroll._address, rule: 'claim', args: {},
  })
  const first = await jpost('/api/kraynet/submit', {
    action: 'contract-call', from: buyer.a, contract: scroll._address, rule: 'claim', args: {},
    nonce: replayPrep.nonce, clock: replayPrep.clock, publicKey: buyer.x, signature: buyer.sign(replayPrep.message), scheme: 'kraywallet',
  })
  ok(first.ok === true, 'first racer claimed the last unit')
  const replay = await jpost('/api/kraynet/submit', {
    action: 'contract-call', from: buyer.a, contract: scroll._address, rule: 'claim', args: {},
    nonce: replayPrep.nonce, clock: replayPrep.clock, publicKey: buyer.x, signature: buyer.sign(replayPrep.message), scheme: 'kraywallet',
  })
  ok(!!replay.error, 'replayed nonce is refused')

  const raceStar = await act(paper, { action: 'name', name: ('race' + TAG.slice(-6)).replace(/\W/g, '') })
  const race = await act(paper, {
    action: 'contract', star: String(raceStar._star),
    form: { kind: 'scroll', each: '4', max: '1', locked: true, gate: 'open' },
  })
  await act(paper, { action: 'transfer', to: race._address, amount: '4' })
  const e0 = await bal(eve.a)
  const b0 = await bal(buyer.a)
  const raced = await Promise.all([
    act(eve, { action: 'contract-call', contract: race._address, rule: 'claim', args: {} }),
    act(buyer, { action: 'contract-call', contract: race._address, rule: 'claim', args: {} }),
  ])
  const wins = raced.filter((r) => r.ok === true).length
  const losses = raced.filter((r) => r.error).length
  ok(wins === 1 && losses === 1, 'parallel last-claim: exactly one winner')
  const e1 = await bal(eve.a)
  const b1 = await bal(buyer.a)
  const moved = (e1 - e0) + (b1 - b0)
  ok(moved === 3n, 'race accounting: winner +4 −1 fee; the refused call charges nothing')

  const drainPrep = await jpost('/api/kraynet/prepare', { action: 'transfer', from: race._address, to: eve.a, amount: '1' })
  if (drainPrep.message) {
    const drain = await jpost('/api/kraynet/submit', {
      action: 'transfer', from: race._address, to: eve.a, amount: '1',
      nonce: drainPrep.nonce, publicKey: eve.x, signature: eve.sign(drainPrep.message), scheme: 'kraywallet',
    })
    ok(!!drain.error, 'Eve cannot sign a transfer out of the keyless pot')
  } else {
    ok(true, 'door refuses a transfer whose from is a keyless pot')
  }
  const collect = await act(paper, { action: 'contract-call', contract: race._address, rule: 'collect', args: {} })
  ok(!!collect.error, 'locked scroll refuses collect at the live door')
  const stealStamp = await act(paper, {
    action: 'contract', star: String(scStar._star),
    form: { kind: 'scroll', each: '1', max: '1', locked: true, gate: 'stamp' },
  })
  ok(!!stealStamp.error, 'second law on the same star is refused')

  const listStar = await act(paper, { action: 'name', name: ('lst' + TAG.slice(-6)).replace(/\W/g, '') })
  const listed = await act(paper, {
    action: 'contract', star: String(listStar._star),
    form: { kind: 'scroll', each: '3', max: '2', locked: true, gate: 'list', allow: [buyer.a, seller.a] },
  })
  ok(listed.ok && (listed.rules || []).includes('claim_0'), 'list scroll sealed')
  await act(paper, { action: 'transfer', to: listed._address, amount: '6' })
  const wrong = await act(eve, { action: 'contract-call', contract: listed._address, rule: 'claim_0', args: {} })
  ok(!!wrong.error, 'Eve cannot take a listed slot')
  const slot = await act(buyer, { action: 'contract-call', contract: listed._address, rule: 'claim_0', args: {} })
  ok(slot.ok === true, 'listed buyer claimed slot 0')
  const twice = await act(buyer, { action: 'contract-call', contract: listed._address, rule: 'claim_0', args: {} })
  ok(!!twice.error, 'double list claim is refused')

  const ov = await jget('/api/kraynet/overview')
  ok(ov.conserves === true, 'bench conserves after the live attack')

  if (fail) { console.error(`\n✗ ${fail} failed`); process.exit(1) }
  console.log(`\n╚═ ${pass} checks — live door refuses garbage, v1-unlock, unsigned, replay, drain, second law; vest top-up unlocks; last-claim race is exclusive; list slots stay sealed. ⚖⭐`)
}
main().catch((e) => { console.error(e); process.exit(1) })
