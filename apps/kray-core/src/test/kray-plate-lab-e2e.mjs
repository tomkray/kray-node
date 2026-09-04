/**
 * KRAY PLATE — live lab proof on the regtest bench (:4477).
 *
 *   node src/test/kray-plate-lab-e2e.mjs
 *
 * Requires the lab door to already run the plate code (restart after pull).
 * Does not wipe the journal. Does not touch Signet / pot-signer.
 * Proves: address plate + star plate + owner gate + clear-on-send + star API paint.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'
import { hashKrayPlate } from '../protocol/kray-plate.ts'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'plate-' + Date.now().toString(36)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))

const id = (t) => {
  const s = nsha(new TextEncoder().encode('kray-plate-lab|' + t + '|' + TAG))
  const x = Buffer.from(schnorr.getPublicKey(s)).toString('hex')
  return {
    s, x, a: btc.p2tr(Buffer.from(x, 'hex'), undefined, NETWORKS[NET]).address,
    sign: (m) => Buffer.from(schnorr.sign(nsha(new TextEncoder().encode(m)), s)).toString('hex'),
  }
}

async function act(who, body) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: who.a })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)), ...prep }
  const sub = await jpost('/api/kraynet/submit', {
    ...body, from: who.a, nonce: prep.nonce, publicKey: who.x,
    signature: who.sign(prep.message), scheme: 'kraywallet',
  })
  return { ...sub, star: sub.star ?? prep.star, plateHash: prep.plateHash }
}

async function main() {
  console.log('\n╔═ KRAY PLATE — live lab e2e on the bench ═╗\n')
  const health = await jget('/health')
  if (health.__down || !health.ok) die(`no node at ${NODE}`)
  ok(health.network === 'regtest', 'lab is regtest')

  const probe = await jpost('/api/kraynet/prepare', {
    action: 'set-kray-plate', from: id('probe').a, description: 'probe',
  })
  if (probe.error && /unknown action|not a regtest/i.test(String(probe.error)) && !/address/i.test(String(probe.error))) {
    die('lab door does not know set-kray-plate yet — restart :4477 on the new code (same KRAY_DATA, no wipe)')
  }
  // probe may fail on address — that still proves the action is registered
  ok(!/unknown action/i.test(String(probe.error || '')), 'door knows set-kray-plate')

  const head0 = await jget('/api/kraynet/head')
  const A = id('alice'), B = id('bob'), M = id('mallory')
  for (const w of [A, B]) {
    const mint = await jpost('/api/kraynet/donate', { to: w.a, sats: '400' })
    if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 — ' + (mint.error || ''))
    ok(mint.ok === true, `donate → ${w.a.slice(0, 12)}…`)
  }

  const born = await act(A, { action: 'name', name: (`plate${TAG}`).replace(/[^a-z0-9]/gi, '').slice(0, 20).toLowerCase() })
  if (!(born.ok === true && born.star != null)) {
    console.log('   · name refused:', born.error || JSON.stringify(born).slice(0, 200))
  }
  ok(born.ok === true && born.star != null, 'Alice baptises a star')
  if (!(born.ok && born.star != null)) die('cannot continue without a star')
  const star = String(born.star)

  const fields = {
    description: `lab plate ${TAG}`.slice(0, 40),
    url: 'https://example.com/lab',
    bannerUrl: '',
  }
  const want = hashKrayPlate(fields)

  const forged = await (async () => {
    const prep = await jpost('/api/kraynet/prepare', { action: 'set-kray-plate', from: A.a, ...fields })
    if (!prep.message) return { error: prep.error }
    return jpost('/api/kraynet/submit', {
      action: 'set-kray-plate', from: A.a, ...fields, nonce: prep.nonce,
      publicKey: M.x, signature: M.sign(prep.message), scheme: 'kraywallet',
    })
  })()
  ok(!!forged.error, 'forged address plate refused on lab')

  const setAddr = await act(A, { action: 'set-kray-plate', ...fields })
  ok(setAddr.ok === true, 'Alice seals address plate on lab')
  const prof = await jget('/api/kraynet/profile/' + encodeURIComponent(A.a))
  ok(prof.krayPlate && prof.krayPlate.hash === want, 'profile.krayPlate.hash matches')
  ok(prof.krayPlate && prof.krayPlate.held === true, 'profile.krayPlate.held')

  const starFields = {
    description: `star ${TAG}`.slice(0, 40),
    url: 'https://star.example/lab',
    bannerUrl: 'https://star.example/live',
  }
  const wantStar = hashKrayPlate(starFields)
  const setStar = await act(A, { action: 'set-kray-plate', star, ...starFields })
  ok(setStar.ok === true, 'Alice seals star plate on lab')

  const steal = await act(B, { action: 'set-kray-plate', star, ...starFields })
  ok(!!steal.error, 'Bob cannot seal Alice’s star plate')

  const sv = await jget('/api/kraynet/star/' + star)
  ok(sv.krayPlate && sv.krayPlate.hash === wantStar, 'star API exposes krayPlate.hash')
  ok(sv.krayPlate && sv.krayPlate.description === starFields.description, 'star API paints description')
  ok(sv.krayPlate && sv.krayPlate.url === starFields.url, 'star API paints url')

  const chrome = await fetch(NODE + '/star/' + star).then((r) => r.text())
  ok(/star-plate-edit|KRAY Plate/i.test(chrome), 'star.html chrome includes KRAY Plate editor')

  const send = await act(A, { action: 'sendstar', to: B.a, star })
  ok(send.ok === true, 'Alice sends star to Bob')
  const sv2 = await jget('/api/kraynet/star/' + star)
  ok(sv2.krayPlate == null, 'star plate cleared after send (no toxic inherit)')
  const prof2 = await jget('/api/kraynet/profile/' + encodeURIComponent(A.a))
  ok(prof2.krayPlate && prof2.krayPlate.hash === want, 'address plate survives star send')

  const clear = await act(A, { action: 'set-kray-plate', clear: true })
  ok(clear.ok === true, 'Alice clears address plate')
  const prof3 = await jget('/api/kraynet/profile/' + encodeURIComponent(A.a))
  ok(prof3.krayPlate == null, 'address plate gone after clear')

  const head1 = await jget('/api/kraynet/head')
  ok(Number(head1.seq) > Number(head0.seq), 'lab head advanced (journal grew)')
  ok(!!head1.cascadeRoot && head1.cascadeRoot !== head0.cascadeRoot, 'cascade moved after plates')

  console.log(`\n${fail === 0 ? '✅' : '❌'} kray-plate-lab-e2e: ${pass} passed, ${fail} failed · node ${NODE}\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
