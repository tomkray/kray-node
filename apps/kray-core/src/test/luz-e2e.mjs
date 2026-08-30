/**
 * LUZ / KRC-77 — live door on the regtest bench (:4477).
 *   node src/test/luz-e2e.mjs
 * Does not touch Signet / pot-signer. Does not --fresh the lab journal.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'luz-' + Date.now().toString(36)
const SUPPLY = '100000'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))

const id = (t) => {
  const s = nsha(new TextEncoder().encode('luz-e2e|' + t + '|' + TAG))
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
  return { ...sub, _star: prep.star ?? sub.star, _address: sub.address }
}

function luzOf(profile, star) {
  const row = (profile.luz || []).find((h) => String(h.star) === String(star))
  return row ? BigInt(row.amount) : 0n
}

async function main() {
  console.log('\n╔═ LUZ / KRC-77 — live seal · send · forge on :4477 ═╗\n')
  const head = await jget('/health')
  if (head.__down || !head.ok) die('no node at ' + NODE)
  ok(head.network === 'regtest', `lab is up (seq ${head.seq})`)

  const A = id('A'), B = id('B'), eve = id('eve')
  for (const w of [A, B, eve]) {
    const mint = await jpost('/api/kraynet/donate', { to: w.a, sats: '200' })
    if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 — ' + (mint.error || ''))
  }

  const named = await act(A, { action: 'name', name: ('luz' + TAG.slice(-6)).replace(/\W/g, '').slice(0, 12) })
  ok(named.ok && named._star != null, `star #${named._star} baptised`)
  const star = String(named._star)

  const sealed = await act(A, { action: 'contract', star, form: { kind: 'cut', supply: SUPPLY } })
  ok(sealed.ok === true, 'KRC-77 paper sealed on that star' + (sealed.ok ? '' : ' — ' + (sealed.error || JSON.stringify(sealed._prep || sealed).slice(0, 180))))

  const face = await jget('/api/kraynet/star/' + star)
  ok(face.luz && face.luz.name === 'Luz' && face.luz.supply === SUPPLY && face.luz.unportioned === false,
    `star #${star} names Luz · supply ${SUPPLY}`)

  const profA = await jget('/api/kraynet/profile/' + encodeURIComponent(A.a))
  ok(luzOf(profA, star) === 100000n && (profA.luz || [])[0]?.glyph === '✧',
    'seal credits A with 100000 luz ✧')
  ok(profA.balance != null && String(profA.balance) !== '0', 'profile still paints the ₭')

  const send = await act(A, { action: 'cut-send', to: B.a, star, amount: '40000' })
  ok(send.ok === true, 'A sent 40000 luz ✧ to B')
  const profA2 = await jget('/api/kraynet/profile/' + encodeURIComponent(A.a))
  const profB2 = await jget('/api/kraynet/profile/' + encodeURIComponent(B.a))
  ok(luzOf(profA2, star) === 60000n && luzOf(profB2, star) === 40000n, 'holders 60000 / 40000')

  const steal = await act(eve, { action: 'cut-send', to: eve.a, star, amount: '1' })
  ok(!!steal.error, 'Eve cannot send luz she does not hold')

  const desk = await fetch(NODE + '/inscribe').then((r) => r.text())
  ok(/data-lkind="cut"/.test(desk) && /KRC-77/.test(desk) && /luz ✧/.test(desk) && !/Cadent/i.test(desk),
    'LAW desk: KRC-77 / luz ✧ — no Cadent')

  if (fail) { console.error(`\n✗ ${fail} failed · ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks — Luz lives on star #${star} of the lab journal. ✧\n`)
}
main()
