/**
 * BODY HASH — live door exam on the regtest bench (:4477).
 *
 * Prepare → BIP-340 → submit against the official explorer. Swarm + race +
 * hostility. Same MPEG + other cover must 409 without a burn.
 *
 *   node src/test/body-hash-e2e.mjs
 *
 * Does not touch Signet / pot-signer. Reload :4477 after door edits (no --fresh).
 */
import { createHash } from 'node:crypto'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'
import { musicRelic, mpegBody } from '../../../kray-net/id3-cover.js'
import { bodyHashOf } from '../../../kray-net/body-hash.js'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'gene-e2e-' + Date.now().toString(36)
const N = 8

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))
const sha = (b) => createHash('sha256').update(b).digest('hex')
const supply = async () => {
  const s = await jget('/api/kraynet/supply')
  return { emitted: BigInt(s.emitted || '0'), burned: BigInt(s.burned || '0') }
}

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

const id = (t) => {
  const s = nsha(new TextEncoder().encode('body-hash-e2e|' + t + '|' + TAG))
  const x = Buffer.from(schnorr.getPublicKey(s)).toString('hex')
  return {
    t, s, x, a: btc.p2tr(Buffer.from(x, 'hex'), undefined, NETWORKS[NET]).address,
    sign: (m) => Buffer.from(schnorr.sign(nsha(new TextEncoder().encode(m)), s)).toString('hex'),
  }
}

function mpeg(tag) {
  return Uint8Array.from([0xff, 0xfb, 0xe0, 0x00, ...createHash('sha256').update('live-mpeg|' + TAG + '|' + tag).digest()])
}
function cover(tag) {
  return Uint8Array.from([...PNG, ...createHash('sha256').update('live-cover|' + TAG + '|' + tag).digest()])
}
function jpegWithApp(tag) {
  const app = Uint8Array.from(Buffer.from('EXIF|' + TAG + '|' + tag, 'utf8'))
  const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]
  const ent = [0xaa, 0xbb, 0xff, 0x00, 0xcc, ...createHash('sha256').update('live-jpeg|' + TAG).digest().subarray(0, 8)]
  const appSeg = [0xff, 0xe1, (2 + app.length) >> 8, (2 + app.length) & 0xff, ...app]
  return Uint8Array.from([0xff, 0xd8, ...appSeg, ...sof, ...sos, ...ent, 0xff, 0xd9])
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
  console.log('\n╔═ BODY HASH LIVE — :4477 swarm · race · hostility ═╗\n')
  const up = await jget('/api/kraynet/supply')
  if (up.__down) die('no node at ' + NODE + ' — start the official explorer on :4477 (do not touch Signet)')
  const ov0 = await jget('/api/kraynet/overview')
  ok(ov0.conserves === true, 'bench conserves before the exam')
  ok(ov0.network === 'regtest', 'this mouth is the regtest explorer')

  const probeMp3 = musicRelic(mpeg('stale'), cover('stale'), 'image/png')
  const stale = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: id('probe').a,
    content: Buffer.from(probeMp3).toString('base64'), encoding: 'base64', contentType: 'audio/mpeg',
  })
  if (!String(stale.message || '').startsWith('kraynet.inscribe.v5|')) {
    die('this :4477 process is stale — reload the official explorer so bodyHash / v5 is on the door (do not touch pot-signer / Signet)')
  }
  ok(stale.bodyHash === bodyHashOf(probeMp3, 'audio/mpeg'), 'door publishes the MPEG gene on prepare')
  ok(stale.bodyHash === sha(mpegBody(probeMp3)), 'prepare gene === sha256(mpegBody)')

  const wallets = Array.from({ length: N }, (_, i) => id('w' + i))
  for (const w of wallets) {
    const mint = await jpost('/api/kraynet/donate', { to: w.a, sats: '80' })
    if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 — ' + (mint.error || ''))
  }
  ok(true, `minted 80 ₭ → ${N} exam wallets`)

  const burned0 = (await supply()).burned
  const songs = wallets.map((w, i) => {
    const src = mpeg('s' + i)
    const relic = musicRelic(src, cover('c' + i), 'image/png')
    return { w, src, relic, hash: sha(relic), gene: bodyHashOf(relic, 'audio/mpeg') }
  })

  const born = await Promise.all(songs.map((s) => act(s.w, {
    action: 'inscribe',
    content: Buffer.from(s.relic).toString('base64'),
    encoding: 'base64',
    contentType: 'audio/mpeg',
    meta: JSON.stringify({ title: TAG + '-' + s.w.t }),
  })))
  ok(born.every((r) => r.ok === true), `swarm inscribed ${N} unique genes in parallel`)
  ok(born.every((r, i) => String(r._message || '').startsWith('kraynet.inscribe.v5|')), 'every swarm act signed v5')

  const clone = musicRelic(songs[0].src, cover('other'), 'image/png')
  ok(sha(clone) !== songs[0].hash, 'new cover → new relic hash')
  ok(bodyHashOf(clone, 'audio/mpeg') === songs[0].gene, 'new cover → SAME gene')
  const cloneAct = await act(wallets[1], {
    action: 'inscribe',
    content: Buffer.from(clone).toString('base64'),
    encoding: 'base64',
    contentType: 'audio/mpeg',
  })
  ok(/exact work|already inscribed/i.test(String(cloneAct.error || '')), 'same gene + other cover → 409 at the door')

  const exact = await act(wallets[0], {
    action: 'inscribe',
    content: Buffer.from(songs[0].relic).toString('base64'),
    encoding: 'base64',
    contentType: 'audio/mpeg',
  })
  ok(/already inscribed/i.test(String(exact.error || '')), 'byte-identical relic → 409')

  const lie = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: wallets[2].a,
    content: Buffer.from(clone).toString('base64'), encoding: 'base64', contentType: 'text/plain',
    bodyHash: '00'.repeat(32),
  })
  ok(/exact work|already inscribed/i.test(String(lie.error || '')), 'lying text/plain + fake bodyHash still hits the gene (magic)')

  const raceSrc = mpeg('race')
  const raceGene = bodyHashOf(musicRelic(raceSrc, cover('r0'), 'image/png'), 'audio/mpeg')
  const raced = await Promise.all(wallets.map((w, i) => act(w, {
    action: 'inscribe',
    content: Buffer.from(musicRelic(raceSrc, cover('r' + i), 'image/png')).toString('base64'),
    encoding: 'base64',
    contentType: 'audio/mpeg',
  })))
  const raceBorn = raced.filter((r) => r.ok === true && r.star != null)
  const raceDoor = raced.filter((r) => /exact work|already inscribed/i.test(String(r.error || '')))
  const raceCursed = raced.filter((r) => r.ok === true && r.star == null)
  ok(raceBorn.length === 1, `race: exactly one living star (born ${raceBorn.length})`)
  ok(raceDoor.length + raceCursed.length === N - 1, `race: the rest door-409 or cursed (${raceDoor.length} door, ${raceCursed.length} cursed)`)

  const trimRelic = musicRelic(Uint8Array.from([...songs[0].src, 0x99]), cover('trim'), 'image/png')
  ok(bodyHashOf(trimRelic, 'audio/mpeg') !== songs[0].gene, 'one extra MPEG byte is another gene')
  const trimAct = await act(wallets[0], {
    action: 'inscribe',
    content: Buffer.from(trimRelic).toString('base64'),
    encoding: 'base64',
    contentType: 'audio/mpeg',
  })
  ok(trimAct.ok === true, 'honest limit: trimmed MPEG is born')

  const j1 = jpegWithApp('alice')
  const j2 = jpegWithApp('bob')
  ok(sha(j1) !== sha(j2) && bodyHashOf(j1, 'image/jpeg') === bodyHashOf(j2, 'image/jpeg'), 'JPEGs differ by EXIF, share a gene')
  const jpg1 = await act(wallets[3], {
    action: 'inscribe', content: Buffer.from(j1).toString('base64'), encoding: 'base64', contentType: 'image/jpeg',
  })
  ok(jpg1.ok === true, 'first JPEG EXIF born')
  const jpg2 = await act(wallets[4], {
    action: 'inscribe', content: Buffer.from(j2).toString('base64'), encoding: 'base64', contentType: 'image/jpeg',
  })
  ok(/exact work|already inscribed/i.test(String(jpg2.error || '')), 'second JPEG (new EXIF, same pixels) → 409')

  const tagOnly = Uint8Array.of(0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0)
  const dead = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: wallets[0].a,
    content: Buffer.from(tagOnly).toString('base64'), encoding: 'base64', contentType: 'audio/mpeg',
  })
  ok(/usable MP3|skeleton/i.test(String(dead.error || '')), 'ID3 with no MPEG body is refused')

  const text = await act(wallets[0], { action: 'inscribe', content: 'plain-' + TAG, contentType: 'text/plain' })
  ok(text.ok === true, 'text still inscribes')
  ok(!String(text._message || '').includes('|body='), 'text stays off v5 — no gene field')

  const first = born[0]
  const star = await jget('/api/kraynet/star/' + (first.star ?? first._star))
  const rec = (star.inscriptions && star.inscriptions[0]) || {}
  ok(rec.contentHash === songs[0].hash, 'star contentHash is sha256(relic with cover)')
  const raw = new Uint8Array(await (await fetch(NODE + '/content/' + rec.contentHash)).arrayBuffer())
  ok(sha(raw) === songs[0].hash, '/content on :4477 is the relic — cover still inside')
  ok(sha(mpegBody(raw)) === sha(songs[0].src), '/content MPEG body is the dropped frames')
  const coverRes = await fetch(NODE + '/cover/' + rec.contentHash)
  ok(coverRes.ok === true, '/cover still serves the APIC on the live mouth')

  const burned1 = (await supply()).burned
  // songs + race winner + cursed race losers (paid to try) + trim + jpeg + text
  const expectBurn = BigInt(N + 1 + raceCursed.length + 1 + 1 + 1)
  ok(burned1 === burned0 + expectBurn, `fire Δ ${burned1 - burned0} === ${expectBurn} (clones/EXIF twin/door-losers did not burn)`)
  const ov1 = await jget('/api/kraynet/overview')
  ok(ov1.conserves === true, 'bench still conserves after the attack')

  if (fail) { console.log('\n  ' + fail + ' failed · ' + pass + ' passed\n'); process.exit(1) }
  console.log('\n  ' + pass + ' passed · live :4477 gene law holds under swarm + race\n')
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1) })
