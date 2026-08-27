/**
 * INSCRIPTION METADATA — live door exam on the regtest bench (:4477).
 *
 * The in-process swarm pins the reducer. This file is the exam the Creator
 * watches: prepare → BIP-340 → submit against the running official explorer,
 * then GET the star and read the sealed JSON. Hostile bodies must refuse
 * without a burn.
 *
 *   node apps/kray-net/server.mjs          # :4477, KRAY_TRUSTED_DEV=1
 *   node src/test/inscription-meta-e2e.mjs
 *
 * Does not touch Signet / pot-signer. Reload :4477 after door edits.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS, scriptOfAddress } from '../protocol/scheme.ts'
import { authorHeldOriginProof } from './ordinal-proof-fixture.ts'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'meta-e2e-' + Date.now() + '-' + Math.random().toString(16).slice(2)

let pass = 0, fail = 0, section = ''
const S = (s) => { section = s; console.log(`\n── ${s} ──`) }
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))
const bal = async (a) => BigInt((await jget('/api/kraynet/profile/' + encodeURIComponent(a))).balance || '0')
const supply = async () => {
  const s = await jget('/api/kraynet/supply')
  return { emitted: BigInt(s.emitted || '0'), burned: BigInt(s.burned || '0') }
}
const unique = (w) => `${TAG} ${w} ${section}`

const id = (t) => {
  const s = nsha(new TextEncoder().encode('inscription-meta-e2e|' + t))
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
    ...body, from: who.a, nonce: prep.nonce, publicKey: who.x,
    signature: who.sign(prep.message), scheme: 'kraywallet',
  })
  return { ...sub, _star: prep.star, _message: prep.message }
}

async function main() {
  console.log('\n╔═ INSCRIPTION METADATA — live door on the regtest bench ═╗\n')

  const up = await jget('/api/kraynet/supply')
  if (up.__down) die(`no node at ${NODE} — start the official explorer on :4477 (do not touch pot-signer / Signet)`)
  const ov0 = await jget('/api/kraynet/overview')
  ok(ov0.conserves === true, 'bench conserves before the exam')
  ok(ov0.network === 'regtest', 'this mouth is the regtest explorer')

  const alice = id('alice'), mallory = id('mallory')
  const stale = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: alice.a, content: unique('stale-probe'), contentType: 'text/plain', meta: 'not json',
  })
  if (!/must be JSON/i.test(stale.error || '')) {
    die('this :4477 process is stale — reload the official explorer so inscribe v4 / readInscriptionMeta is on the door (do not touch pot-signer / Signet)')
  }
  ok(true, 'door is live: non-JSON metadata is refused before a signature')
  const capInfo = await jget('/api/kraynet/donation/info')
  if (capInfo.inscriptionMetaMax == null) {
    die('this :4477 process is stale — reload the official explorer so donation/info publishes inscriptionMetaMax (do not touch pot-signer / Signet)')
  }
  ok(Number(capInfo.inscriptionMetaMax) === 8192, 'door publishes the consensus document cap (8,192 UTF-8 bytes)')
  const rawMd = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: alice.a, content: unique('raw-md'), contentType: 'text/plain', meta: '# lore\n\nnot json',
  })
  ok(!!rawMd.error && /must be JSON/i.test(rawMd.error), 'raw markdown at the HTTP door is refused — the page wrap is not consensus')

  const mint = await jpost('/api/kraynet/donate', { to: alice.a, sats: '200' })
  if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 on this throwaway regtest to mint for the exam — ' + (mint.error || ''))
  ok(await bal(alice.a) >= 200n, 'Alice minted 200 ₭ on the bench')

  // ═══ 1 · free JSON seals with the relic ═══
  S('1 · Inscribe with free JSON — sealed bytes on the star')
  const blob = '{"name":"Aurora","traits":{"medium":"oil"},"note":"any shape"}'
  const burned0 = (await supply()).burned
  const bal0 = await bal(alice.a)
  const first = await act(alice, { action: 'inscribe', content: unique('aurora'), contentType: 'image/png', meta: blob })
  const star = first._star
  ok(first.ok === true && star != null, `star #${star} inscribed with metadata (1 ₭ burned)`)
  ok(String(first._message || '').startsWith('kraynet.inscribe.v4|'), 'prepare signed the v4 domain (v2/v3 stay frozen)')
  ok(String(first._message || '').endsWith('|meta=' + blob), 'the JSON rides LAST on the signed message')
  const view = await jget('/api/kraynet/star/' + star)
  ok(view.meta === blob, 'GET /star returns the exact sealed JSON')
  ok((view.inscriptions || [])[0]?.meta === blob, 'the inscription record carries the same bytes')
  ok(await bal(alice.a) === bal0 - 1n, 'exactly 1 ₭ burned — refuse paths must not move this')
  ok((await supply()).burned === burned0 + 1n, 'supply.burned advanced by 1')

  // ═══ 2 · pretty JSON + API object convenience ═══
  S('2 · Pretty JSON and an object body — still exact bytes')
  const pretty = '{\n  "k": 1,\n  "pipe": "a|b"\n}'
  const prettyAct = await act(alice, { action: 'inscribe', content: unique('pretty'), contentType: 'text/plain', meta: pretty })
  const prettyStar = await jget('/api/kraynet/star/' + prettyAct._star)
  ok(prettyAct.ok === true && prettyStar.meta === pretty, 'pretty-printed JSON with newlines and pipes seals byte-exact')

  const obj = { any: true, n: 2, list: ['x', 'y'] }
  const canon = JSON.stringify(obj)
  const objAct = await act(alice, { action: 'inscribe', content: unique('object'), contentType: 'text/plain', meta: obj })
  const objStar = await jget('/api/kraynet/star/' + objAct._star)
  ok(objAct.ok === true && objStar.meta === canon, 'an object in the API body is sealed as JSON.stringify bytes')

  const md = '# Aurora\n\nA relic for the model.\n\n- lore\n- not the contract'
  const mdSealed = JSON.stringify(md)
  const mdAct = await act(alice, { action: 'inscribe', content: unique('markdown'), contentType: 'image/png', meta: mdSealed })
  const mdStar = await jget('/api/kraynet/star/' + mdAct._star)
  ok(mdAct.ok === true && mdStar.meta === mdSealed && JSON.parse(mdStar.meta) === md,
    `markdown is a JSON string value on star #${mdAct._star} — v4, no fork`)

  // ═══ 3 · absence stays on frozen v2 ═══
  S('3 · Empty metadata is absence — frozen v2')
  const bare = await act(alice, { action: 'inscribe', content: unique('bare'), contentType: 'text/plain' })
  ok(bare.ok === true && String(bare._message || '').startsWith('kraynet.inscribe.v2|'), 'no meta field → v2 message')
  ok((await jget('/api/kraynet/star/' + bare._star)).meta == null, 'a v2 star carries no metadata')
  const blank = await act(alice, { action: 'inscribe', content: unique('blank'), contentType: 'text/plain', meta: '   ' })
  ok(blank.ok === true && String(blank._message || '').startsWith('kraynet.inscribe.v2|'), 'whitespace-only meta is absence, not a blank v4')

  // ═══ 4 · add-to-star + parent list ═══
  S('4 · Two canvases + a signed parent')
  const nm = ('metaexam' + String(Date.now()).slice(-8)).replace(/\W/g, '')
  const named = await act(alice, { action: 'name', name: nm })
  ok(named.ok === true, `name "${nm}" baptized`)
  const song = '{"bpm":120,"verse":"first"}'
  const add = await act(alice, {
    action: 'inscribe', star: String(named._star), content: unique('add-on-name'), contentType: 'audio/mpeg', meta: song,
  })
  const namedView = await jget('/api/kraynet/star/' + named._star)
  ok(add.ok === true && namedView.name === nm && namedView.meta === song,
    `add-to-star #${named._star} seals JSON on the same number — name and content stay two canvases`)

  const childBlob = '{"child":true,"of":' + JSON.stringify(String(star)) + '}'
  const child = await act(alice, {
    action: 'inscribe', content: unique('child'), contentType: 'text/plain', parent: String(star), meta: childBlob,
  })
  const childView = await jget('/api/kraynet/star/' + child._star)
  ok(child.ok === true && String(child._message || '').startsWith('kraynet.inscribe.v4|'), 'a single v2 parent + JSON becomes a signed v4 parents list')
  ok(childView.meta === childBlob && String((childView.parents || [])[0] || childView.parent) === String(star),
    `child #${child._star} keeps the parent and the exact JSON`)

  // ═══ 5 · attacks — refuse, no burn ═══
  S('5 · Attacks — bad JSON, oversize, tamper, forgery')
  const balBeforeAttack = await bal(alice.a)
  const burnedBeforeAttack = (await supply()).burned

  const badJson = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: alice.a, content: unique('bad-json'), contentType: 'text/plain', meta: 'not json',
  })
  ok(!!badJson.error && /must be JSON/i.test(badJson.error), 'non-JSON is refused at prepare (no signature, no burn)')

  const over = '{"x":"' + 'a'.repeat(8200) + '"}'
  const overPrep = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: alice.a, content: unique('oversize'), contentType: 'text/plain', meta: over,
  })
  ok(!!overPrep.error && /cap is|8192/i.test(overPrep.error), 'JSON over the 8 KB cap is refused at the door')

  const honest = '{"name":"Honest"}'
  const lie = '{"name":"LIE"}'
  const tamperPrep = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: alice.a, content: unique('tamper'), contentType: 'text/plain', meta: honest,
  })
  const tampered = await jpost('/api/kraynet/submit', {
    action: 'inscribe', from: alice.a, content: unique('tamper'), contentType: 'text/plain', meta: lie,
    nonce: tamperPrep.nonce, publicKey: alice.x, signature: alice.sign(tamperPrep.message), scheme: 'kraywallet',
  })
  ok(!!tampered.error && /verif|signat|message/i.test(tampered.error || ''), 'tampering the JSON after sign is refused')

  const forged = await act(mallory, { action: 'inscribe', content: unique('forge'), contentType: 'text/plain', meta: '{"thief":true}' })
  ok(!!forged.error, 'Mallory cannot inscribe without a funded signed path of her own')

  // Sign v4 with empty parents, then inject a singular parent on submit — unsigned lineage.
  const trapPrep = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: alice.a, content: unique('parent-trap'), contentType: 'text/plain', meta: '{"k":1}',
  })
  const trap = await jpost('/api/kraynet/submit', {
    action: 'inscribe', from: alice.a, content: unique('parent-trap'), contentType: 'text/plain',
    meta: '{"k":1}', parent: String(star),
    nonce: trapPrep.nonce, publicKey: alice.x, signature: alice.sign(trapPrep.message), scheme: 'kraywallet',
  })
  ok(!!trap.error, 'v4 signed without a parent cannot grow a singular parent on submit')

  ok(await bal(alice.a) === balBeforeAttack, 'attacks burned nothing')
  ok((await supply()).burned === burnedBeforeAttack, 'supply.burned unchanged by the refused acts')

  const held = authorHeldOriginProof(scriptOfAddress(alice.a, NET), { confirmations: 1, salt: 'meta-' + TAG })
  const l1 = held.parentId
  const originMeta = await act(alice, {
    action: 'inscribe', content: unique('origin-meta'), contentType: 'text/plain',
    meta: '{"from":"L1"}', origins: [l1], originProofs: [held.proof],
  })
  const originView = originMeta.ok ? await jget('/api/kraynet/star/' + originMeta._star) : null
  ok(
    originMeta.ok === true && originView?.meta === '{"from":"L1"}' && (originView.origins || []).includes(l1),
    originMeta.ok
      ? `inscribe v4 + origins + JSON sealed on star #${originMeta._star} (SPV L1 parent)`
      : 'inscribe v4 + origins refused — ' + (originMeta.error || originMeta._prep?.error || ''),
  )

  // ═══ 6 · invariants ═══
  S('6 · Invariants after the live door')
  const ov1 = await jget('/api/kraynet/overview')
  ok(ov1.conserves === true, 'the ledger CONSERVES after every live act')
  ok(ov1.cascadeRoot && ov1.cascadeRoot !== ov0.cascadeRoot, 'real inscriptions moved the cascade root')
  const still = await jget('/api/kraynet/star/' + star)
  ok(still.meta === blob, 'the first star still holds Aurora exactly (A3 — sealed, not rewritten)')

  const page = await fetch(NODE + '/star/' + star).then((r) => r.text()).catch(() => '')
  ok(/<dt>metadata/.test(page), 'star.html has the Metadata pane (JSON or Markdown, filled from the sealed document)')
  console.log(`   → look: ${NODE}/star/${star}`)

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — metadata on the live regtest door, attacks refused, conserved. ₿₭\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => die(e.stack || e.message))
