/**
 * STAR LAW — live creative gallery on the regtest bench (:4477).
 *
 * Three beings, a muse who pulses, a sale that does not drain.
 *   node src/test/star-law-swarm-e2e.mjs
 *
 * Does not touch Signet / pot-signer. Reload :4477 after door edits.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'gallery-' + Date.now().toString(36)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))

const id = (t) => {
  const s = nsha(new TextEncoder().encode('star-law-gallery|' + t + '|' + TAG))
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
  return { ...sub, _star: prep.star ?? sub.star, _message: prep.message, _address: sub.address, _code: prep.code }
}

async function main() {
  console.log('\n╔═ STAR LAW GALLERY — live beings on the bench ═╗\n')
  const up = await jget('/api/kraynet/donation/info')
  if (up.__down) die(`no node at ${NODE}`)
  if (up.contractStarBurn == null) die('stale :4477 — reload the official explorer (do not touch pot-signer / Signet)')
  if (up.contractLivingMouth == null) die('stale :4477 — reload so the living mouth is on the door (do not touch pot-signer / Signet)')

  const poet = id('poet'), muse = id('muse'), keeper = id('keeper')
  for (const w of [poet, muse, keeper]) {
    const mint = await jpost('/api/kraynet/donate', { to: w.a, sats: '60' })
    if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 — ' + (mint.error || ''))
  }

  const orpheus = await act(poet, { action: 'name', name: ('orpheus' + TAG.slice(-6)).replace(/\W/g, '') })
  const vault = await act(keeper, { action: 'name', name: ('vault' + TAG.slice(-6)).replace(/\W/g, '') })
  const sprite = await act(poet, { action: 'name', name: ('sprite' + TAG.slice(-6)).replace(/\W/g, '') })
  ok(orpheus.ok && vault.ok && sprite.ok, `three faces born — #${orpheus._star} Orpheus · #${vault._star} vault · #${sprite._star} sprite`)

  const lawO = await act(poet, {
    action: 'contract', star: String(orpheus._star),
    living: { flags: [{ name: 'alive', on: true }, { name: 'sing', on: false }, { name: 'agent', on: true }] },
  })
  const lawV = await act(keeper, {
    action: 'contract', star: String(vault._star),
    living: { flags: [{ name: 'open', on: true }, { name: 'alive', on: true }] },
  })
  const lawS = await act(poet, {
    action: 'contract', star: String(sprite._star),
    living: { flags: [{ name: 'alive', on: true }, { name: 'dream', on: true }, { name: 'agent', on: false }] },
  })
  ok(lawO.ok && lawV.ok && lawS.ok, 'three laws sealed — poet / vault / sprite (1 ₭ each)')

  const tip = await act(muse, { action: 'transfer', to: lawO._address, amount: '9' })
  ok(tip.ok, 'the muse tipped 9 ₭ into Orpheus — value on the being')
  const breath = await act(muse, { action: 'contract-call', contract: lawO._address, rule: 'pulse', args: {} })
  ok(breath.ok, 'the muse pulsed Orpheus — an agent in the vacuum, 1 ₭ fee, nothing minted')
  const voice = await act(poet, { action: 'contract-call', contract: lawO._address, rule: 'toggle_sing', args: {} })
  ok(voice.ok, 'the poet flipped sing=true — the being found a voice')

  const sleep = await act(poet, { action: 'contract-call', contract: lawS._address, rule: 'toggle_alive', args: {} })
  ok(sleep.ok, 'sprite alive→false — the dreamer sleeps')
  const deadPulse = await act(muse, { action: 'contract-call', contract: lawS._address, rule: 'pulse', args: {} })
  ok(!!deadPulse.error, 'pulse while asleep is refused — the law is the leash')

  const sale = await act(poet, { action: 'sendstar', to: muse.a, star: String(orpheus._star) })
  ok(sale.ok, 'Orpheus sold — the face left the poet')
  const ghost = await act(poet, { action: 'contract-call', contract: lawO._address, rule: 'toggle_sing', args: {} })
  ok(!!ghost.error, 'the poet lost the mouth — toggle refuses')
  const museFlip = await act(muse, { action: 'contract-call', contract: lawO._address, rule: 'toggle_agent', args: {} })
  ok(museFlip.ok, 'the muse flipped agent on the star she now holds')
  const take = await act(muse, { action: 'contract-call', contract: lawO._address, rule: 'collect', args: {} })
  ok(take.ok, 'the muse collected — 9 ₭ went to the living owner, not the sealer')

  const vO = await jget('/api/kraynet/star/' + orpheus._star)
  const vV = await jget('/api/kraynet/star/' + vault._star)
  const vS = await jget('/api/kraynet/star/' + sprite._star)
  ok(vO.owner === muse.a && vO.law.state.sing === '1' && vO.law.balance === '0', `Orpheus #${orpheus._star} belongs to the muse; pot emptied to her`)
  ok(vV.law.rules.includes('collect') && vV.law.state.open === '1', `vault #${vault._star} is open — collect pays whoever holds the star`)
  ok(vS.law.state.alive === '0' && vS.law.state.dream === '1', `sprite #${sprite._star} sleeps and still dreams`)

  const ov = await jget('/api/kraynet/overview')
  ok(ov.conserves === true, 'bench conserves after the gallery')

  console.log('\n   gallery (open on the explorer):')
  console.log(`   · /star/${orpheus._star}  Orpheus   pot ${lawO._address}`)
  console.log(`   · /star/${vault._star}  vault     pot ${lawV._address}`)
  console.log(`   · /star/${sprite._star}  sprite    pot ${lawS._address}`)

  if (fail) { console.error(`\n✗ ${fail} failed`); process.exit(1) }
  console.log(`\n╚═ ${pass} checks — three beings live on the bench. Strangers breathe; sleep refuses; ₭ sits in a pot no key encodes to. ⚖⭐`)
}
main().catch((e) => { console.error(e); process.exit(1) })
