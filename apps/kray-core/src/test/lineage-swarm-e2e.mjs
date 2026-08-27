/**
 * LINEAGE SWARM — live :4477. Prove by breaking.
 *
 * Every steal of a KRAY parent must refuse without a burn. Ownership flips
 * with sendstar. Metadata cannot write a family. Concurrent Mallory cannot
 * sneak a child. Conservation holds.
 *
 *   node src/test/lineage-swarm-e2e.mjs
 *
 * Does not touch Signet. L1 parentage is SPV (proveParentControl) — a signed
 * claim without the bag is a steal, same as a KRAY parent you do not hold.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS, scriptOfAddress } from '../protocol/scheme.ts'
import { authorHeldOriginProof } from './ordinal-proof-fixture.ts'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'lin-swarm-' + Date.now().toString(36)
const N = Number(process.env.KRAY_SWARM_N || 24)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))
const unique = (w) => TAG + ' ' + w + ' ' + Math.random().toString(16).slice(2)

function id(t) {
  const s = nsha(new TextEncoder().encode('lineage-swarm|' + t + '|' + TAG))
  const x = Buffer.from(schnorr.getPublicKey(s)).toString('hex')
  return {
    t, s, x, a: btc.p2tr(Buffer.from(x, 'hex'), undefined, NETWORKS[NET]).address,
    sign: (m) => Buffer.from(schnorr.sign(nsha(new TextEncoder().encode(m)), s)).toString('hex'),
  }
}

async function act(who, body) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: who.a })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)), _prep: prep, ok: false }
  const sub = await jpost('/api/kraynet/submit', {
    ...body, from: who.a, nonce: prep.nonce, clock: prep.clock, publicKey: who.x,
    signature: who.sign(prep.message), scheme: 'kraywallet',
  })
  return { ...sub, _star: prep.star ?? sub.star, _message: prep.message, _prep: prep }
}
const refused = (r) => !r.ok && !!r.error
const ownerErr = (r) => /only the owner/i.test(String(r.error || r._prep?.error || ''))

async function main() {
  console.log('\n╔═ LINEAGE SWARM — steal the father · ' + N + ' concurrent lies · live :4477 ═╗\n')
  const ov0 = await jget('/api/kraynet/overview')
  if (ov0.__down) die('no node at ' + NODE)
  ok(ov0.conserves === true && ov0.network === 'regtest', `bench is regtest and conserves (seq ${ov0.seq})`)

  const alice = id('alice'), bob = id('bob'), mallory = id('mallory')
  for (const [w, sats] of [[alice, '200'], [bob, '80'], [mallory, '80']]) {
    const mint = await jpost('/api/kraynet/donate', { to: w.a, sats })
    if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 — ' + (mint.error || ''))
  }
  ok(true, 'minted Alice · Bob · Mallory (Mallory is funded — the refuse is ownership, not poverty)')

  const aP = await act(alice, { action: 'inscribe', content: unique('P'), contentType: 'text/plain' })
  const bQ = await act(bob, { action: 'inscribe', content: unique('Q'), contentType: 'text/plain' })
  const P = String(aP.star ?? aP._star), Q = String(bQ.star ?? bQ._star)
  ok(aP.ok && bQ.ok, `roots born · Alice #${P} · Bob #${Q}`)

  const burned0 = BigInt((await jget('/api/kraynet/supply')).burned || '0')
  const seq0 = Number((await jget('/api/kraynet/overview')).seq)

  console.log('\n── 1 · every steal of a KRAY parent ──')
  const stealV3 = await act(mallory, { action: 'inscribe', content: unique('m-v3'), contentType: 'text/plain', parents: [P] })
  ok(refused(stealV3) && ownerErr(stealV3), 'Mallory v3 parents:[P] refused')
  const stealV2 = await act(mallory, { action: 'inscribe', content: unique('m-v2'), contentType: 'text/plain', parent: P })
  ok(refused(stealV2) && ownerErr(stealV2), 'Mallory v2 singular parent refused')
  const stealBoth = await act(mallory, { action: 'inscribe', content: unique('m-pq'), contentType: 'text/plain', parents: [P, Q] })
  ok(refused(stealBoth) && ownerErr(stealBoth), 'Mallory claiming both strangers refused')
  const partial = await act(alice, { action: 'inscribe', content: unique('partial'), contentType: 'text/plain', parents: [P, Q] })
  ok(refused(partial) && ownerErr(partial), 'Alice + Bob\'s star in one list — the whole act refuses')
  const ghost = await act(alice, { action: 'inscribe', content: unique('ghost'), contentType: 'text/plain', parents: ['999999'] })
  ok(refused(ghost) && /does not exist/i.test(String(ghost.error || ghost._prep?.error || '')), 'unborn parent refused')
  const dup = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: alice.a, content: unique('dup'), contentType: 'text/plain', parents: [P, P],
  })
  ok(/duplicate/i.test(String(dup.error || '')), 'duplicate parents refused at the door')
  const bothForms = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: alice.a, content: unique('both'), contentType: 'text/plain', parent: P, parents: [P],
  })
  ok(/EITHER|never both|one statement/i.test(String(bothForms.error || '')), 'v2 parent + v3 list together refused')

  const trapPrep = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: alice.a, content: unique('trap'), contentType: 'text/plain',
  })
  const trap = await jpost('/api/kraynet/submit', {
    action: 'inscribe', from: alice.a, content: unique('trap'), contentType: 'text/plain',
    parents: [P],
    nonce: trapPrep.nonce, clock: trapPrep.clock, publicKey: alice.x,
    signature: alice.sign(trapPrep.message), scheme: 'kraywallet',
  })
  ok(!!trap.error, 'parent list injected after sign refused')

  const lie = await act(alice, {
    action: 'inscribe', content: unique('meta-lie'), contentType: 'text/plain',
    meta: JSON.stringify({ parents: [P, Q], note: 'this is not lineage' }),
  })
  const lieNo = lie.star ?? lie._star
  const lieView = lie.ok ? await jget('/api/kraynet/star/' + lieNo) : {}
  ok(lie.ok === true && (!lieView.parents || lieView.parents.length === 0),
    `meta may say parents — star #${lieNo} is still a ROOT`)

  console.log('\n── 2 · concurrent Mallory (' + N + ' at once) ──')
  const wave = await Promise.all(Array.from({ length: N }, (_, i) =>
    act(mallory, { action: 'inscribe', content: unique('storm-' + i), contentType: 'text/plain', parents: [P] })))
  const sneaks = wave.filter((r) => r.ok && (r.star != null || r._star != null))
  ok(wave.every(refused) && sneaks.length === 0, N + '/' + N + ' concurrent steals refused — zero children born')
  ok(wave.every(ownerErr), 'every refusal names ownership (not a vague 500)')

  const burned1 = BigInt((await jget('/api/kraynet/supply')).burned || '0')
  ok(burned1 === burned0 + 1n, `fire Δ ${burned1 - burned0} === 1 (only the meta-lie root burned; every steal was free)`)

  console.log('\n── 3 · the right travels with the star ──')
  const sent = await act(bob, { action: 'sendstar', to: alice.a, star: Q })
  ok(sent.ok === true, `Bob sent #${Q} to Alice`)
  const bobAfter = await act(bob, { action: 'inscribe', content: unique('bob-ex'), contentType: 'text/plain', parents: [Q] })
  ok(refused(bobAfter) && ownerErr(bobAfter), 'ex-owner Bob cannot father from #Q')
  const honest = await act(alice, { action: 'inscribe', content: unique('two'), contentType: 'text/plain', parents: [P, Q] })
  const kid = honest.star ?? honest._star
  ok(honest.ok === true && kid != null, `Alice, holding both, fathers #${kid}`)
  const kidView = await jget('/api/kraynet/star/' + kid)
  ok(Array.isArray(kidView.parents) && kidView.parents.map(String).join(',') === P + ',' + Q, 'signed parents list is the family')
  ok(Array.isArray(kidView.family && kidView.family.immediate) && kidView.family.immediate.length === 2,
    'constellation immediate has both parents side by side')
  ok(!kidView.meta, 'no metadata on the honest child')

  const toM = await act(alice, { action: 'sendstar', to: mallory.a, star: P })
  ok(toM.ok === true, `Alice sent #${P} to Mallory`)
  const aliceEx = await act(alice, { action: 'inscribe', content: unique('alice-ex'), contentType: 'text/plain', parents: [P] })
  ok(refused(aliceEx) && ownerErr(aliceEx), 'after the send, Alice cannot father from #P')
  const malloryNow = await act(mallory, { action: 'inscribe', content: unique('m-now'), contentType: 'text/plain', parents: [P] })
  ok(malloryNow.ok === true, `Mallory, now holding #${P}, can father — the right is the wallet, not a name`)

  console.log('\n── 4 · L1 origin · SPV or refuse ──')
  const held = authorHeldOriginProof(scriptOfAddress(alice.a, NET), { confirmations: 1, salt: 'swarm-' + TAG })
  const l1 = held.parentId
  const badL1 = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: alice.a, content: unique('bad-l1'), contentType: 'text/plain', origins: ['nope'],
  })
  ok(/not a Bitcoin L1 ordinal/i.test(String(badL1.error || '')), 'malformed origin id refused')
  const noBag = await act(alice, { action: 'inscribe', content: unique('alice-nobag'), contentType: 'text/plain', origins: [l1] })
  ok(refused(noBag) && /SPV control proof/i.test(String(noBag.error || noBag._prep?.error || '')),
    'Alice without an SPV bag is refused (DEV-TRUST is not ownership)')
  const mL1 = await act(mallory, { action: 'inscribe', content: unique('mallory-l1'), contentType: 'text/plain', origins: [l1] })
  ok(refused(mL1), 'Mallory + the same L1 id and no bag — refused')
  const mSteal = await act(mallory, {
    action: 'inscribe', content: unique('mallory-bag'), contentType: 'text/plain',
    origins: [l1], originProofs: [held.proof],
  })
  ok(refused(mSteal) && /not proven|holder-not-authors/i.test(String(mSteal.error || mSteal._prep?.error || '')),
    'Mallory + Alice\'s bag — holder does not pay Mallory')
  const aL1 = await act(alice, {
    action: 'inscribe', content: unique('alice-l1'), contentType: 'text/plain',
    origins: [l1], originProofs: [held.proof],
  })
  ok(aL1.ok === true, `Alice + SPV bag → star #${aL1.star ?? aL1._star}`)
  const metaL1 = await act(alice, {
    action: 'inscribe', content: unique('meta-l1'), contentType: 'text/plain',
    meta: JSON.stringify({ origins: [l1] }),
  })
  const metaL1v = metaL1.ok ? await jget('/api/kraynet/star/' + (metaL1.star ?? metaL1._star)) : {}
  ok(metaL1.ok && (!metaL1v.origins || metaL1v.origins.length === 0), 'meta.origins does not write family.origins')

  const ov1 = await jget('/api/kraynet/overview')
  ok(ov1.conserves === true, 'bench still conserves')
  ok(Number(ov1.seq) > seq0, 'honest acts moved the journal; steals did not')

  console.log('\n   LOOK  two-parent child  ' + NODE + '/star/' + kid)
  console.log('   LOOK  Mallory\'s lawful child after receiving #P  ' + NODE + '/star/' + (malloryNow.star ?? malloryNow._star) + '\n')

  if (fail) { console.log('  ' + fail + ' failed · ' + pass + ' passed\n'); process.exit(1) }
  console.log('  ' + pass + ' passed — KRAY parentage is owned; L1 parentage is SPV.\n')
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1) })
