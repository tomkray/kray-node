/**
 * SEALED FORMS — live door on the regtest bench (:4477).
 *   node src/test/star-forms-e2e.mjs
 * Does not touch Signet / pot-signer.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'forms-' + Date.now().toString(36)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))
const bal = async (a) => BigInt((await jget('/api/kraynet/profile/' + encodeURIComponent(a))).balance || '0')

const id = (t) => {
  const s = nsha(new TextEncoder().encode('star-forms-e2e|' + t + '|' + TAG))
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
  return { ...sub, _star: prep.star ?? sub.star, _address: sub.address, _code: prep.code }
}

async function main() {
  console.log('\n╔═ STAR FORMS — live escrow · tunnel · vest · scroll ═╗\n')
  const info = await jget('/api/kraynet/donation/info')
  if (info.__down) die('no node at ' + NODE)
  if (info.contractForms == null || info.contractScroll == null) die('stale :4477 — reload the official explorer (do not touch pot-signer / Signet)')
  ok(info.contractForms === true, 'door publishes the form catalog')
  ok(info.contractScroll === true, 'door publishes the proven scroll')

  const paper = id('paper'), buyer = id('buyer'), seller = id('seller'), eve = id('eve')
  for (const w of [paper, buyer, seller, eve]) {
    const mint = await jpost('/api/kraynet/donate', { to: w.a, sats: '200' })
    if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 — ' + (mint.error || ''))
  }

  const named = await act(paper, { action: 'name', name: ('deal' + TAG.slice(-6)).replace(/\W/g, '') })
  ok(named.ok && named._star != null, `paper star #${named._star}`)
  const face = String(named._star)

  const escrow = await act(paper, {
    action: 'contract', star: face,
    form: { kind: 'escrow', buyer: buyer.a, seller: seller.a, lock: '64' },
  })
  ok(escrow.ok && (escrow.rules || []).includes('accept'), `escrow sealed at ${escrow._address}`)
  const fund = await act(paper, { action: 'transfer', to: escrow._address, amount: '30' })
  ok(fund.ok, '30 ₭ sat in the deal pot')

  const thief = await act(eve, { action: 'contract-call', contract: escrow._address, rule: 'accept', args: {} })
  ok(!!thief.error, 'Eve cannot accept')
  const ownerTry = await act(paper, { action: 'contract-call', contract: escrow._address, rule: 'accept', args: {} })
  ok(!!ownerTry.error, 'the star owner cannot accept — the face is not the buyer')
  const s0 = await bal(seller.a)
  const yes = await act(buyer, { action: 'contract-call', contract: escrow._address, rule: 'accept', args: {} })
  ok(yes.ok === true, 'the sealed buyer accepted')
  ok(await bal(seller.a) === s0 + 30n, '30 ₭ paid the sealed seller — not the paper, not the caller')

  const pipe = await act(paper, { action: 'name', name: ('pipe' + TAG.slice(-6)).replace(/\W/g, '') })
  const tun = await act(paper, { action: 'contract', star: String(pipe._star), form: { kind: 'tunnel' } })
  ok(tun.ok && (tun.rules || []).includes('punch'), `tunnel on #${pipe._star}`)
  await act(paper, { action: 'transfer', to: tun._address, amount: '20' })
  const ghost = await act(eve, { action: 'contract-call', contract: tun._address, rule: 'punch', args: { amount: '5' } })
  ok(!!ghost.error, 'a stranger cannot punch')
  const punch = await act(paper, { action: 'contract-call', contract: tun._address, rule: 'punch', args: { amount: '6' } })
  ok(punch.ok === true, 'the living owner punched 6 ₭ through (follows the face)')

  const vestStar = await act(paper, { action: 'name', name: ('vest' + TAG.slice(-6)).replace(/\W/g, '') })
  const vest = await act(paper, {
    action: 'contract', star: String(vestStar._star),
    form: { kind: 'vest', beneficiary: seller.a, duration: '1', total: '12' },
  })
  ok(vest.ok && (vest.rules || []).includes('release'), `vest on #${vestStar._star}`)
  await act(paper, { action: 'transfer', to: vest._address, amount: '12' })
  const s1 = await bal(seller.a)
  const rel = await act(eve, { action: 'contract-call', contract: vest._address, rule: 'release', args: {} })
  ok(rel.ok === true, 'Eve released — she is not the payee')
  ok(await bal(seller.a) === s1 + 12n, 'the beneficiary received the vest, not Eve')

  const scrollStar = await act(paper, { action: 'name', name: ('scrl' + TAG.slice(-6)).replace(/\W/g, '') })
  const scroll = await act(paper, {
    action: 'contract', star: String(scrollStar._star),
    form: { kind: 'scroll', each: '5', max: '2', locked: true, gate: 'open' },
  })
  ok(scroll.ok && (scroll.rules || []).includes('claim') && !(scroll.rules || []).includes('collect'),
    `locked scroll on #${scrollStar._star} — claim, no collect`)
  await act(paper, { action: 'transfer', to: scroll._address, amount: '10' })
  const drain = await act(paper, { action: 'contract-call', contract: scroll._address, rule: 'collect', args: {} })
  ok(!!drain.error, 'locked scroll refuses collect — ₭ leaves only through claim')
  const e0 = await bal(eve.a)
  const take = await act(eve, { action: 'contract-call', contract: scroll._address, rule: 'claim', args: {} })
  ok(take.ok === true, 'Eve claimed the open scroll')
  ok(await bal(eve.a) === e0 - 1n + 5n, 'claim paid the caller 5 ₭')

  const stampStar = await act(paper, { action: 'name', name: ('stmp' + TAG.slice(-6)).replace(/\W/g, '') })
  const stamped = await act(paper, {
    action: 'contract', star: String(stampStar._star),
    form: { kind: 'scroll', each: '6', max: '1', locked: true, gate: 'stamp' },
  })
  ok(stamped.ok && (stamped.rules || []).includes('stamp'), `stamp scroll on #${stampStar._star}`)
  await act(paper, { action: 'transfer', to: stamped._address, amount: '6' })
  const hex = Buffer.from(nsha(new TextEncoder().encode(buyer.a))).toString('hex')
  const ticket = BigInt('0x' + hex.slice(0, 16)).toString()
  const ghostStamp = await act(eve, { action: 'contract-call', contract: stamped._address, rule: 'stamp', args: { id: ticket } })
  ok(!!ghostStamp.error, 'Eve cannot stamp')
  const mark = await act(paper, { action: 'contract-call', contract: stamped._address, rule: 'stamp', args: { id: ticket } })
  ok(mark.ok === true, 'the living owner stamped the buyer')
  const eveTry = await act(eve, { action: 'contract-call', contract: stamped._address, rule: 'claim', args: {} })
  ok(!!eveTry.error, 'Eve is not the ticket')
  const b0 = await bal(buyer.a)
  const win = await act(buyer, { action: 'contract-call', contract: stamped._address, rule: 'claim', args: {} })
  ok(win.ok === true, 'the stamped buyer claimed')
  ok(await bal(buyer.a) === b0 - 1n + 6n, 'stamp claim paid the caller')

  const ov = await jget('/api/kraynet/overview')
  ok(ov.conserves === true, 'bench conserves after the catalog')

  if (fail) { console.error(`\n✗ ${fail} failed`); process.exit(1) }
  console.log(`\n╚═ ${pass} checks — escrow · tunnel · vest · scroll live on the bench. Same IR. The expanse is a catalog, not a second machine. ⚖⭐`)
}
main().catch((e) => { console.error(e); process.exit(1) })
