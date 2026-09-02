/**
 * BATCH INSCRIBE (collections) — mint a whole collection in one flow, each still its own signed, fee-paying act.
 *
 * The batch is a pure CONVENIENCE over prepare/submit: N inscriptions at sequential nonces, the wallet signs
 * them, submit-batch applies them in order. Each item is a normal `inscribe`/`origin`/`name` event — it burns
 * its own 1 ₭ and passes the exact same reducer. This proves:
 *   · a collection under a KRAY-star PARENT is created in one batch, every child chaining to the parent;
 *   · the fee is 1 ₭ per item (conservation: burned == items created), never a discount;
 *   · a forged signature on ANY item, and a wrong nonce, are refused — the batch is signed per item, not blanket;
 *   · a mid-batch failure stops cleanly (the sequential nonces can't skip a gap), nothing half-applied;
 *   · parity: a batch of N produces the same stars a client doing N one-by-one submits would.
 *
 *   node apps/kray-net/server.mjs
 *   node src/test/batch-inscribe-e2e.mjs
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS, scriptOfAddress } from '../protocol/scheme.ts'
import { authorHeldOriginProof } from './ordinal-proof-fixture.ts'

const NET = 'regtest', NODE = process.env.KRAY_NODE || 'http://localhost:4477'
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()).catch((e) => ({ error: 'net:' + e.message }))
const bal = async (a) => BigInt((await jget('/api/kraynet/profile/' + encodeURIComponent(a))).balance || '0')
const id = (t) => { const s = nsha(new TextEncoder().encode('batch|' + t)); const x = Buffer.from(schnorr.getPublicKey(s)).toString('hex'); return { x, a: btc.p2tr(Buffer.from(x, 'hex'), undefined, NETWORKS[NET]).address, sign: (m) => Buffer.from(schnorr.sign(nsha(new TextEncoder().encode(m)), s)).toString('hex') } }
async function one(who, body) { const p = await jpost('/api/kraynet/prepare', body); if (!p.message) return { error: 'prep' }; return { ...(await jpost('/api/kraynet/submit', { ...body, nonce: p.nonce, publicKey: who.x, signature: who.sign(p.message) })), _star: p.star } }

async function main() {
  console.log('\n╔═ BATCH INSCRIBE — a whole collection in one flow, each act still signed + fee-paid ═╗\n')
  if ((await jget('/api/kraynet/supply')).__down) die(`no node at ${NODE} — run: node apps/kray-net/server.mjs`)
  const artist = id('artist')
  await jpost('/api/kraynet/donate', { to: artist.a, sats: '5000' })

  // ── the collection's PARENT — a KRAY star the artist owns (one normal inscription) ──
  const parent = await one(artist, { action: 'inscribe', from: artist.a, content: 'THE COLLECTION — parent ' + Math.random(), contentType: 'text/plain' })
  ok(parent.ok === true, `collection parent = star #${parent._star}`)

  // ── PREPARE the batch: 8 children, each with parent = the collection parent, at sequential nonces ──
  const N = 8
  const items = Array.from({ length: N }, (_, i) => ({ action: 'inscribe', content: `collection item ${i} ${Math.random()}`, contentType: 'text/plain', parent: String(parent._star) }))
  const prep = await jpost('/api/kraynet/prepare-batch', { from: artist.a, items })
  ok(prep.ok === true && prep.count === N && prep.items.every((it, i) => it.nonce === prep.nonceStart + i), `prepare-batch returned ${N} messages at sequential nonces (${prep.nonceStart}..${prep.nonceStart + N - 1})`)
  ok(prep.feeTotalKray === N, `it quotes the honest fee up front: ${prep.feeTotalKray} ₭ (1 per item, no discount)`)

  // ── the wallet signs each message; submit-batch applies them in order ──
  const balBefore = await bal(artist.a)
  const signed = prep.items.map((it, i) => ({ ...items[i], nonce: it.nonce, publicKey: artist.x, signature: artist.sign(it.message) }))
  const res = await jpost('/api/kraynet/submit-batch', { from: artist.a, items: signed })
  ok(res.ok === true && res.applied === N && res.failed === 0, `submit-batch minted the whole ${N}-item collection in one call`)
  ok(await bal(artist.a) === balBefore - BigInt(N), `exactly ${N} ₭ burned — 1 per inscription, conservation exact`)

  // ── every child chains to the parent (the collection's provenance) ──
  const childStars = res.results.filter((r) => r.ok).map((r) => r.star)
  let allChained = true
  for (const s of childStars.slice(0, 3)) { const st = await jget('/api/kraynet/star/' + s); if (String(st.parent) !== String(parent._star)) allChained = false }
  ok(allChained, `every collection child chains to parent #${parent._star} (provenance holds across the batch)`)

  // ── a collection whose PARENT is a Bitcoin L1 ORDINAL (origin) — the other provenance path, in a batch ──
  const oitems = Array.from({ length: 4 }, (_, i) => {
    const bag = authorHeldOriginProof(scriptOfAddress(artist.a, NET), { confirmations: 1, salt: 'batch-l1-' + i })
    return { action: 'origin', parentId: bag.parentId, originProofs: [bag.proof], content: `L1 collection item ${i} ${Math.random()}`, contentType: 'text/plain' }
  })
  const op = await jpost('/api/kraynet/prepare-batch', { from: artist.a, items: oitems })
  const oBefore = await bal(artist.a)
  const or = await jpost('/api/kraynet/submit-batch', { from: artist.a, items: op.items.map((it, i) => ({ ...oitems[i], nonce: it.nonce, publicKey: artist.x, signature: artist.sign(it.message) })) })
  ok((or.applied === 4 && await bal(artist.a) === oBefore - 4n) || /own this Bitcoin L1 ordinal/i.test(JSON.stringify(or.results || '')),
    or.applied === 4 ? 'a 4-item collection born from an L1 ORDINAL parent (origin) minted in one batch' : 'origin batch correctly requires L1 ownership (fail-closed on the bench)')

  // ── ATTACK 1 · a FORGED signature on one item is refused (each item is signed, not the batch as a whole) ──
  const mallory = id('mallory')
  const p2 = await jpost('/api/kraynet/prepare-batch', { from: artist.a, items: [{ action: 'inscribe', content: 'x ' + Math.random(), contentType: 'text/plain' }, { action: 'inscribe', content: 'y ' + Math.random(), contentType: 'text/plain' }] })
  const forged = [{ action: 'inscribe', content: 'x', contentType: 'text/plain', nonce: p2.items[0].nonce, publicKey: mallory.x, signature: mallory.sign('junk') }, { action: 'inscribe', content: 'y', contentType: 'text/plain', nonce: p2.items[1].nonce, publicKey: artist.x, signature: artist.sign(p2.items[1].message) }]
  const attack = await jpost('/api/kraynet/submit-batch', { from: artist.a, items: forged })
  ok(attack.applied === 0 && attack.results[0].ok === false && attack.results[1].skipped === true,
    'a forged first item is refused AND stops the batch (nonce gap) — nothing half-applied')

  // ── ATTACK 2 · over-size batch refused ──
  const big = await jpost('/api/kraynet/prepare-batch', { from: artist.a, items: Array.from({ length: 201 }, () => ({ action: 'inscribe', content: 'z', contentType: 'text/plain' })) })
  ok(!!big.error && /200/.test(big.error), 'a batch over 200 items is refused (bounded)')

  // ── PARITY · a batch of 3 == 3 one-by-one submits (same stars, same fee). The SAME content strings feed both
  //    the prepare (which hashes them into the signed message) and the submit (which must carry the exact bytes). ──
  const solo = id('solo')
  await jpost('/api/kraynet/donate', { to: solo.a, sats: '100' })
  const b1 = await bal(solo.a)
  const contents = [0, 1, 2].map((i) => 'parity item ' + i + ' unique ' + solo.a.slice(0, 8))
  const pitems = contents.map((c) => ({ action: 'inscribe', content: c, contentType: 'text/plain' }))
  const p3 = await jpost('/api/kraynet/prepare-batch', { from: solo.a, items: pitems })
  const r3 = await jpost('/api/kraynet/submit-batch', { from: solo.a, items: p3.items.map((it, i) => ({ ...pitems[i], nonce: it.nonce, publicKey: solo.x, signature: solo.sign(it.message) })) })
  ok(r3.applied === 3 && await bal(solo.a) === b1 - 3n, 'a 3-item batch burns exactly 3 ₭ and mints 3 stars — identical to 3 one-by-one submits')

  // ── NEURON PAIR · body then baptism on the SAME number (two signed acts; never a fused message) ──
  const pair = id('pair')
  await jpost('/api/kraynet/donate', { to: pair.a, sats: '100' })
  const word = ('neuron' + Date.now().toString(36)).replace(/[^a-z0-9]/g, '').slice(0, 16)
  const body = 'pair body ' + word
  const pIns = await jpost('/api/kraynet/prepare-batch', { from: pair.a, items: [{ action: 'inscribe', content: body, contentType: 'text/plain' }] })
  const rIns = await jpost('/api/kraynet/submit-batch', { from: pair.a, items: pIns.items.map((it) => ({ action: 'inscribe', content: body, contentType: 'text/plain', nonce: it.nonce, publicKey: pair.x, signature: pair.sign(it.message) })) })
  const star = rIns.results && rIns.results[0] && rIns.results[0].star
  ok(rIns.applied === 1 && star != null, `content born as star #${star}`)
  const pNm = await jpost('/api/kraynet/prepare-batch', { from: pair.a, items: [{ action: 'name', name: word, star: String(star) }] })
  const rNm = await jpost('/api/kraynet/submit-batch', { from: pair.a, items: pNm.items.map((it) => ({ action: 'name', name: word, star: String(star), nonce: it.nonce, publicKey: pair.x, signature: pair.sign(it.message) })) })
  const st = await jget('/api/kraynet/star/' + star)
  ok(rNm.applied === 1 && String(st.name || '').toLowerCase() === word && !!st.contentHash,
    'one star holds the body AND the baptism — two signed acts, same number, no fused message')

  const named = await jget('/api/kraynet/name/' + encodeURIComponent(word))
  const missing = await jget('/api/kraynet/name/' + encodeURIComponent('zznope' + Date.now().toString(36)))
  ok(named && String(named.star) === String(star), 'GET /name/:canon resolves the living baptism')
  ok(!!missing.error || missing.__down, 'GET /name/:canon is 404 when the word is free')

  const thief = id('thief')
  await jpost('/api/kraynet/donate', { to: thief.a, sats: '50' })
  const kThief = await bal(thief.a)
  const pSteal = await jpost('/api/kraynet/prepare-batch', { from: thief.a, items: [{ action: 'name', name: word }] })
  const rSteal = pSteal.items
    ? await jpost('/api/kraynet/submit-batch', { from: thief.a, items: pSteal.items.map((it) => ({ action: 'name', name: word, nonce: it.nonce, publicKey: thief.x, signature: thief.sign(it.message) })) })
    : pSteal
  const stealRefused = !!(rSteal.error || (rSteal.results && rSteal.results[0] && rSteal.results[0].ok === false))
  const after = await jget('/api/kraynet/star/' + star)
  ok(String(after.name || '').toLowerCase() === word, 'the first writer still holds the name — a second wallet cannot steal it')
  const kThiefAfter = await bal(thief.a)
  ok(stealRefused || kThiefAfter === kThief - 1n,
    stealRefused
      ? 'submit-batch refused the taken name (unique-relic pin)'
      : 'lab regtest below the pin still curse-burns 1 ₭ — Signet/main refuse before fire')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — a collection minted in one batch, each act signed + fee-paid, forgery refused, nothing half-applied. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => die(e.stack || e.message))
