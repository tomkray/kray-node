/**
 * LINEAGE — live :4477.
 *
 * Two sealed statements, existing law only (no new kind):
 *   1) one Bitcoin L1 ordinal as origin (no KRAY parent)
 *   2) two KRAY parent stars (one writer must hold both)
 *
 *   node src/test/lineage-e2e.mjs
 *
 * Does not touch Signet. L1 parentage is an SPV control proof (proveParentControl).
 * A signed claim without the bag is refused — DEV-TRUST is not ownership.
 */
import { createHash } from 'node:crypto'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS, scriptOfAddress } from '../protocol/scheme.ts'
import { authorHeldOriginProof } from './ordinal-proof-fixture.ts'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'lineage-' + Date.now().toString(36)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))
const unique = (w) => TAG + ' ' + w
const sha = (s) => createHash('sha256').update(s).digest('hex')

function id(t) {
  const s = nsha(new TextEncoder().encode('lineage-e2e|' + t + '|' + TAG))
  const x = Buffer.from(schnorr.getPublicKey(s)).toString('hex')
  return {
    t, s, x, a: btc.p2tr(Buffer.from(x, 'hex'), undefined, NETWORKS[NET]).address,
    sign: (m) => Buffer.from(schnorr.sign(nsha(new TextEncoder().encode(m)), s)).toString('hex'),
  }
}

async function act(who, body) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: who.a })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)), _prep: prep }
  const sub = await jpost('/api/kraynet/submit', {
    ...body, from: who.a, nonce: prep.nonce, clock: prep.clock, publicKey: who.x,
    signature: who.sign(prep.message), scheme: 'kraywallet',
  })
  return { ...sub, _star: prep.star ?? sub.star, _message: prep.message, _prep: prep }
}

async function main() {
  console.log('\n╔═ LINEAGE — L1 origin · two star parents · live :4477 ═╗\n')

  const ov0 = await jget('/api/kraynet/overview')
  if (ov0.__down) die('no node at ' + NODE + ' — start the official explorer (no --fresh, no Signet)')
  ok(ov0.conserves === true && ov0.network === 'regtest', `bench is regtest and conserves (seq ${ov0.seq})`)

  const page = await fetch(NODE + '/star/0').then((r) => r.text()).catch(() => '')
  ok(/Bitcoin L1 ordinal/.test(page) && /✦ #/.test(page), 'star.html still paints L1 ₿ nodes and parent-star chips')

  const alice = id('alice'), bob = id('bob'), mallory = id('mallory')
  for (const [w, sats] of [[alice, '80'], [bob, '40'], [mallory, '20']]) {
    const mint = await jpost('/api/kraynet/donate', { to: w.a, sats })
    if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 — ' + (mint.error || ''))
  }
  ok(true, 'minted exam wallets')
  const burned0 = BigInt((await jget('/api/kraynet/supply')).burned || '0')

  // ── 1 · one L1 ordinal parent (origins only) — SPV bag required ──
  console.log('\n── 1 · Bitcoin L1 ordinal as the only parent ──')
  const held = authorHeldOriginProof(scriptOfAddress(alice.a, NET), { confirmations: 1, salt: 'e2e-' + TAG })
  const l1 = held.parentId
  ok(/^[0-9a-f]{64}i0$/.test(l1), 'origin id is a v2 <txid>i0')

  const badId = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: alice.a, content: unique('bad-l1'), contentType: 'text/plain', origins: ['not-an-ordinal'],
  })
  ok(/not a Bitcoin L1 ordinal/i.test(String(badId.error || '')), 'FILTER · malformed origin id is refused at the door (no burn)')

  const noBag = await act(alice, {
    action: 'inscribe', content: unique('no-bag'), contentType: 'text/plain', origins: [l1],
  })
  ok(/SPV control proof/i.test(String(noBag.error || noBag._prep?.error || '')),
    'FILTER · origins without an SPV bag are refused (DEV-TRUST is not ownership)')

  const malloryBag = await act(mallory, {
    action: 'inscribe', content: unique('mallory-steal'), contentType: 'text/plain',
    origins: [l1], originProofs: [held.proof],
  })
  ok(/not proven|holder-not-authors/i.test(String(malloryBag.error || malloryBag._prep?.error || '')),
    'FILTER · Mallory cannot use Alice\'s bag (holder does not pay Mallory)')

  const l1Act = await act(alice, {
    action: 'inscribe',
    content: unique('child-of-l1'),
    contentType: 'text/plain',
    origins: [l1],
    originProofs: [held.proof],
  })
  const l1Star = l1Act.star ?? l1Act._star
  const l1Ok = l1Act.ok === true && l1Star != null
  ok(l1Ok, l1Ok
    ? `L1 child born as star #${l1Star} (SPV control proven)`
    : 'L1 origin refused — ' + (l1Act.error || l1Act._prep?.error || ''))
  if (!l1Ok) die('this exam needs the SPV L1 path on :4477')

  ok(/^kraynet\.inscribe\.v[345]\|/.test(String(l1Act._message || '')), 'L1 child signed a multiparent inscribe (v3+; lineage is the lists, not meta)')
  ok(/\|parents=\|/.test(String(l1Act._message || '')), 'L1 child signed an empty KRAY parents list')
  ok(String(l1Act._message || '').includes('|origins=' + l1 + '|'), 'L1 child signed the ordinal id')

  const l1View = await jget('/api/kraynet/star/' + l1Star)
  ok(Array.isArray(l1View.origins) && l1View.origins[0] === l1, 'star.origins lists the L1 id')
  ok(!l1View.parents || l1View.parents.length === 0, 'star.parents is empty — the parent is Bitcoin, not a star')
  const recOrigins = await jget('/r/origins/' + l1Star)
  const recParents = await jget('/r/parents/' + l1Star)
  ok(Array.isArray(recOrigins.origins) && recOrigins.origins[0] === l1, '/r/origins names the same ordinal')
  ok(Array.isArray(recParents.parents) && recParents.parents.length === 0, '/r/parents is empty for an L1-only child')
  ok(!l1View.meta, 'L1 child has no metadata — the ordinal is origins, not a document field')
  ok(Array.isArray(l1View.family && l1View.family.immediate) && l1View.family.immediate.length === 1 && l1View.family.immediate[0].l1,
    'constellation immediate is the L1 node (not a metadata row)')

  const trapPrep = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: alice.a, content: unique('l1-trap'), contentType: 'text/plain',
  })
  const trap = await jpost('/api/kraynet/submit', {
    action: 'inscribe', from: alice.a, content: unique('l1-trap'), contentType: 'text/plain',
    origins: [l1],
    nonce: trapPrep.nonce, clock: trapPrep.clock, publicKey: alice.x,
    signature: alice.sign(trapPrep.message), scheme: 'kraywallet',
  })
  ok(!!trap.error, 'FILTER · an origin cannot appear on submit if it was not in the signed message')

  // ── 2 · two KRAY parent stars ──
  console.log('\n── 2 · two KRAY parent stars (one writer holds both) ──')
  const aAct = await act(alice, { action: 'inscribe', content: unique('parent-a'), contentType: 'text/plain', meta: '{"role":"parent-a"}' })
  const bAct = await act(bob, { action: 'inscribe', content: unique('parent-b'), contentType: 'text/plain', meta: '{"role":"parent-b"}' })
  const aNo = aAct.star ?? aAct._star
  const bNo = bAct.star ?? bAct._star
  ok(aAct.ok === true && aNo != null, `parent A born as star #${aNo} (Alice)`)
  ok(bAct.ok === true && bNo != null, `parent B born as star #${bNo} (Bob)`)

  const stealBefore = await act(alice, {
    action: 'inscribe', content: unique('steal-before'), contentType: 'text/plain',
    parents: [String(aNo), String(bNo)],
  })
  ok(/only the owner of star #/.test(String(stealBefore.error || stealBefore._prep?.error || '')),
    `FILTER · Alice cannot claim Bob's #${bNo} before she holds it`)

  const sent = await act(bob, { action: 'sendstar', to: alice.a, star: String(bNo) })
  ok(sent.ok === true, `Bob sent #${bNo} to Alice — one writer now holds both parents`)
  ok((await jget('/api/kraynet/star/' + bNo)).owner === alice.a, 'parent B is at Alice')

  const dup = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: alice.a, content: unique('dup-parent'), contentType: 'text/plain',
    parents: [String(aNo), String(aNo)],
  })
  ok(/duplicate parents/i.test(String(dup.error || '')), 'FILTER · the same star cannot be claimed twice')

  const both = await act(alice, {
    action: 'inscribe',
    content: unique('child-of-two'),
    contentType: 'text/plain',
    parents: [String(aNo), String(bNo)],
  })
  const bothNo = both.star ?? both._star
  ok(both.ok === true && bothNo != null, `two-parent child born as star #${bothNo}`)
  ok(/^kraynet\.inscribe\.v[345]\|/.test(String(both._message || '')), 'two-parent child signed a multiparent inscribe (v3+; lineage is the lists, not meta)')
  ok(String(both._message || '').includes('|parents=' + aNo + ',' + bNo + '|'), 'two-parent child signed both star numbers, in order')
  ok(/\|origins=\|/.test(String(both._message || '')), 'two-parent child signed an empty origins list')

  const bothView = await jget('/api/kraynet/star/' + bothNo)
  ok(Array.isArray(bothView.parents) && bothView.parents.map(String).join(',') === aNo + ',' + bNo,
    'star.parents lists both KRAY parents in signed order')
  ok(!bothView.origins || bothView.origins.length === 0, 'star.origins is empty — this child has no L1 parent')
  ok(!bothView.meta, 'two-parent child has no metadata — the family is parents, not a document field')
  ok(Array.isArray(bothView.family && bothView.family.immediate) && bothView.family.immediate.length === 2
    && String(bothView.family.immediate[0].star) === String(aNo) && String(bothView.family.immediate[1].star) === String(bNo),
    'constellation immediate has both parent stars side by side')

  const listed = await jget('/r/parents/' + bothNo)
  ok(Array.isArray(listed.parents) && listed.parents.join(',') === aNo + ',' + bNo, '/r/parents returns both numbers')
  const kidsA = await jget('/r/children/' + aNo)
  const kidsB = await jget('/r/children/' + bNo)
  ok((kidsA.children || []).map(String).includes(String(bothNo)), `child shines under A (#${aNo})`)
  ok((kidsB.children || []).map(String).includes(String(bothNo)), `child shines under B (#${bNo})`)

  const steal = await act(mallory, {
    action: 'inscribe', content: unique('mallory'), contentType: 'text/plain',
    parents: [String(aNo), String(bNo)],
  })
  ok(/only the owner/i.test(String(steal.error || steal._prep?.error || '')),
    'FILTER · Mallory cannot father from stars she does not hold')

  const burned1 = BigInt((await jget('/api/kraynet/supply')).burned || '0')
  // L1 child + parent A + parent B + two-parent child = 4 burns. sendstar / filters do not burn.
  ok(burned1 === burned0 + 4n, `fire Δ ${burned1 - burned0} === 4 (sendstar and refusals did not burn)`)
  ok((await jget('/api/kraynet/overview')).conserves === true, 'bench still conserves')

  console.log('\n   LOOK')
  console.log(`   L1 child     ${NODE}/star/${l1Star}`)
  console.log(`   L1 origin    ${l1}`)
  console.log(`   parent A     ${NODE}/star/${aNo}`)
  console.log(`   parent B     ${NODE}/star/${bNo}`)
  console.log(`   two-parent   ${NODE}/star/${bothNo}`)
  console.log(`   L1 tx        ${NODE}/tx/${l1Act.hash}`)
  console.log(`   two-parent tx ${NODE}/tx/${both.hash}\n`)

  if (fail) { console.log('  ' + fail + ' failed · ' + pass + ' passed\n'); process.exit(1) }
  console.log('  ' + pass + ' passed · lineage is on :4477 — open the two children\n')
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1) })
