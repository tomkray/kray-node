/**
 * THE RECORD — live :4477 provenance.
 *
 * Sleeve (image star) + named tracks as children. Two writers: Bob sends his
 * face to Alice, then one v5 act claims album + both faces + an L1 origin.
 * Gene filter still 409. Stranger cannot father from the sleeve.
 *
 *   node src/test/body-hash-album-e2e.mjs
 *
 * Does not touch Signet. Lineage is the existing parents/origins law — not a new kind.
 */
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS, scriptOfAddress } from '../protocol/scheme.ts'
import { authorHeldOriginProof } from './ordinal-proof-fixture.ts'
import { musicRelic, mpegBody, mpeg1L3BitrateKbps } from '../../../kray-net/id3-cover.js'
import { bodyHashOf } from '../../../kray-net/body-hash.js'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'album-' + Date.now().toString(36)
const SUF = TAG.replace(/[^a-z0-9]/g, '').slice(-8)
const OUT = process.env.KRAY_ALBUM_OUT || join(tmpdir(), TAG)

const TRACKS = [
  { name: 'Amber Drift',    key: 'amber' + SUF,  f1: 220, f2: 330, bg: '#1a0a2e', ink: '#e8c36a' },
  { name: 'Verdant Pulse',  key: 'verdant' + SUF, f1: 261, f2: 329, bg: '#0b1f17', ink: '#5ee0a0' },
  { name: 'Violet Room',    key: 'violet' + SUF,  f1: 293, f2: 440, bg: '#1a1020', ink: '#c97cff' },
  { name: 'Ion Current',    key: 'ion' + SUF,     f1: 392, f2: 587, bg: '#0a1628', ink: '#6ec8ff' },
]
const DUET = { name: 'Four Hands', key: 'fourhands' + SUF, f1: 349, f2: 523, bg: '#201208', ink: '#ff8a4c' }

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))
const sha = (b) => createHash('sha256').update(b).digest('hex')

function id(t) {
  const s = nsha(new TextEncoder().encode('body-hash-album|' + t + '|' + TAG))
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

function paintPng(path, title, bg, ink, sub) {
  const py = join(OUT, '_sleeve.py')
  writeFileSync(py, `
from PIL import Image, ImageDraw, ImageFont
import os, sys
bg, ink = sys.argv[2], sys.argv[3]
def hexcol(h):
  h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
im = Image.new("RGB", (512, 512), hexcol(bg))
d = ImageDraw.Draw(im)
font = ImageFont.load_default()
for p in ("/System/Library/Fonts/Supplemental/Georgia.ttf", "/System/Library/Fonts/NewYork.ttf"):
  if os.path.exists(p):
    font = ImageFont.truetype(p, 40); break
c = hexcol(ink)
d.ellipse((96, 72, 416, 392), outline=c, width=10)
d.polygon([(256,88),(284,200),(400,200),(308,264),(340,376),(256,308),(172,376),(204,264),(112,200),(228,200)], fill=c)
d.text((256, 428), sys.argv[4], fill=c, font=font, anchor="mm")
d.text((256, 472), sys.argv[5], fill=c, font=font, anchor="mm")
im.save(sys.argv[1], "PNG")
`)
  execFileSync('python3', [py, path, bg, ink, title, sub || 'KRAY'])
}

function writeMp3(path, f1, f2) {
  const expr = `0.32*sin(2*PI*${f1}*t)*(0.65+0.35*sin(2*PI*2.5*t))+0.22*sin(2*PI*${f2}*t)`
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `aevalsrc=${expr}:s=44100:d=4`,
    '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100', '-ac', '1', path,
  ])
}

async function main() {
  console.log('\n╔═ THE RECORD — sleeve + children + four-hands + L1 on :4477 ═╗\n')
  if (!spawnSync('which', ['ffmpeg'], { encoding: 'utf8' }).stdout.trim()) die('ffmpeg required')
  mkdirSync(OUT, { recursive: true })

  const ov0 = await jget('/api/kraynet/overview')
  if (ov0.__down) die('no node at ' + NODE)
  ok(ov0.conserves === true && ov0.network === 'regtest', `bench is regtest and conserves (seq ${ov0.seq})`)

  const alice = id('alice'), bob = id('bob'), mallory = id('mallory')
  for (const [w, sats] of [[alice, '240'], [bob, '80'], [mallory, '40']]) {
    const mint = await jpost('/api/kraynet/donate', { to: w.a, sats })
    if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 — ' + (mint.error || ''))
  }
  ok(true, 'minted exam wallets (Alice holds the sleeve; Bob writes a face)')

  const burned0 = BigInt((await jget('/api/kraynet/supply')).burned || '0')

  const sleevePath = join(OUT, 'sleeve.png')
  paintPng(sleevePath, 'ION CYCLE', '#100818', '#e8c36a', 'THE RECORD')
  const sleevePng = new Uint8Array(readFileSync(sleevePath))
  const sleeveAct = await act(alice, {
    action: 'inscribe',
    content: Buffer.from(sleevePng).toString('base64'), encoding: 'base64',
    contentType: 'image/png',
    meta: JSON.stringify({ title: 'ION CYCLE', kind: 'sleeve', note: 'the parent of the record' }),
  })
  const album = sleeveAct.star ?? sleeveAct._star
  ok(sleeveAct.ok === true && album != null, `sleeve born as star #${album}`)
  const named = await act(alice, { action: 'name', name: 'ioncycle' + SUF, star: String(album) })
  ok(named.ok === true, `sleeve baptised ioncycle${SUF}`)

  const aliceFace = join(OUT, 'alice.png')
  const bobFace = join(OUT, 'bob.png')
  paintPng(aliceFace, 'ALICE', '#0b1f17', '#5ee0a0', 'COMPOSER')
  paintPng(bobFace, 'BOB', '#0a1628', '#6ec8ff', 'COMPOSER')
  const aliceStarAct = await act(alice, {
    action: 'inscribe',
    content: Buffer.from(readFileSync(aliceFace)).toString('base64'), encoding: 'base64',
    contentType: 'image/png',
    meta: JSON.stringify({ title: 'Alice', role: 'composer' }),
  })
  const aliceFaceNo = aliceStarAct.star ?? aliceStarAct._star
  ok(aliceStarAct.ok === true, `Alice face #${aliceFaceNo}`)
  ok((await act(alice, { action: 'name', name: 'alice' + SUF, star: String(aliceFaceNo) })).ok === true, 'Alice face baptised')

  const bobStarAct = await act(bob, {
    action: 'inscribe',
    content: Buffer.from(readFileSync(bobFace)).toString('base64'), encoding: 'base64',
    contentType: 'image/png',
    meta: JSON.stringify({ title: 'Bob', role: 'composer' }),
  })
  const bobFaceNo = bobStarAct.star ?? bobStarAct._star
  ok(bobStarAct.ok === true, `Bob face #${bobFaceNo} (held by Bob)`)
  ok((await act(bob, { action: 'name', name: 'bob' + SUF, star: String(bobFaceNo) })).ok === true, 'Bob face baptised')

  const sent = await act(bob, { action: 'sendstar', to: alice.a, star: String(bobFaceNo) })
  ok(sent.ok === true, `Bob sent his face to Alice — one writer can now claim both parents`)
  const bobHeld = await jget('/api/kraynet/star/' + bobFaceNo)
  ok(bobHeld.owner === alice.a, 'Bob face is now at Alice (law: every KRAY parent must be yours)')

  const held = authorHeldOriginProof(scriptOfAddress(alice.a, NET), { confirmations: 1, salt: 'album-' + TAG })
  const l1 = held.parentId
  const kids = []
  for (const tr of TRACKS) {
    const mp3 = join(OUT, tr.key + '.mp3')
    const cover = join(OUT, tr.key + '.png')
    writeMp3(mp3, tr.f1, tr.f2)
    paintPng(cover, tr.name, tr.bg, tr.ink, 'ION CYCLE')
    const relic = musicRelic(new Uint8Array(readFileSync(mp3)), new Uint8Array(readFileSync(cover)), 'image/png')
    ok(mpeg1L3BitrateKbps(relic) === 320, `${tr.name}: 320 CBR relic`)
    const born = await act(alice, {
      action: 'inscribe',
      content: Buffer.from(relic).toString('base64'), encoding: 'base64',
      contentType: 'audio/mpeg',
      parents: [String(album)],
      meta: JSON.stringify({ title: tr.name, album: 'ION CYCLE', track: kids.length + 1 }),
    })
    const no = born.star ?? born._star
    ok(born.ok === true && String(born._message || '').startsWith('kraynet.inscribe.v5|'), `${tr.name} signed v5`)
    ok(String(born._message || '').includes('|parents=' + album + '|'), `${tr.name} signed the sleeve as parent`)
    ok((await act(alice, { action: 'name', name: tr.key, star: String(no) })).ok === true, `${tr.name} baptised ${tr.key}`)
    kids.push({ tr, relic, no, hash: born.hash, gene: bodyHashOf(relic, 'audio/mpeg') })
    console.log(`   → ${tr.name}  star #${no}  child of #${album}`)
    console.log(`      play  ${NODE}/render/${sha(relic)}`)
    console.log(`      tx    ${NODE}/tx/${born.hash}`)
  }

  const duetMp3 = join(OUT, 'duet.mp3'), duetCover = join(OUT, 'duet.png')
  writeMp3(duetMp3, DUET.f1, DUET.f2)
  paintPng(duetCover, DUET.name, DUET.bg, DUET.ink, 'ALICE · BOB')
  const duetRelic = musicRelic(new Uint8Array(readFileSync(duetMp3)), new Uint8Array(readFileSync(duetCover)), 'image/png')
  const duet = await act(alice, {
    action: 'inscribe',
    content: Buffer.from(duetRelic).toString('base64'), encoding: 'base64',
    contentType: 'audio/mpeg',
    parents: [String(album), String(aliceFaceNo), String(bobFaceNo)],
    origins: [l1],
    originProofs: [held.proof],
    meta: JSON.stringify({
      title: DUET.name, album: 'ION CYCLE',
      writers: ['Alice', 'Bob'],
      origin: l1,
      note: 'four hands — album + both faces + one L1 ordinal in one signature',
    }),
  })
  const duetNo = duet.star ?? duet._star
  ok(duet.ok === true, `four-hands born as star #${duetNo}`)
  ok(String(duet._message || '').includes('|parents=' + [album, aliceFaceNo, bobFaceNo].join(',') + '|'), 'duet signed three KRAY parents')
  ok(String(duet._message || '').includes('|origins=' + l1 + '|'), 'duet signed the Bitcoin L1 origin')
  ok((await act(alice, { action: 'name', name: DUET.key, star: String(duetNo) })).ok === true, 'duet baptised')

  const sleeve = await jget('/api/kraynet/star/' + album)
  const childNos = (sleeve.family && sleeve.family.children || []).map((c) => String(c.star))
  ok(childNos.length === TRACKS.length + 1, `sleeve constellation has ${TRACKS.length + 1} children (got ${childNos.length})`)
  ok(kids.every((k) => childNos.includes(String(k.no))) && childNos.includes(String(duetNo)), 'every track shines under the sleeve')
  ok(sleeve.name && sleeve.name.toLowerCase().startsWith('ioncycle'), 'sleeve still carries its baptism')
  ok((sleeve.inscriptions || [])[0]?.contentType === 'image/png', 'sleeve is a common image relic')

  const duetView = await jget('/api/kraynet/star/' + duetNo)
  ok(Array.isArray(duetView.parents) && duetView.parents.map(String).join(',') === [album, aliceFaceNo, bobFaceNo].join(','), 'duet star lists all three KRAY parents')
  ok(Array.isArray(duetView.origins) && duetView.origins[0] === l1, 'duet star lists the L1 origin')
  const aliceKids = ((await jget('/api/kraynet/star/' + aliceFaceNo)).family || {}).children || []
  const bobKids = ((await jget('/api/kraynet/star/' + bobFaceNo)).family || {}).children || []
  ok(aliceKids.some((c) => String(c.star) === String(duetNo)), 'duet shines under Alice')
  ok(bobKids.some((c) => String(c.star) === String(duetNo)), 'duet shines under Bob')

  const steal = await act(mallory, {
    action: 'inscribe',
    content: 'stolen-' + TAG, contentType: 'text/plain',
    parents: [String(album)],
  })
  ok(/only the owner/i.test(String(steal.error || '')), 'FILTER · Mallory cannot father a child from Alice\'s sleeve')

  const clone = musicRelic(mpegBody(kids[0].relic), new Uint8Array(readFileSync(join(OUT, TRACKS[1].key + '.png'))), 'image/png')
  const cloneAct = await act(alice, {
    action: 'inscribe',
    content: Buffer.from(clone).toString('base64'), encoding: 'base64',
    contentType: 'audio/mpeg',
    parents: [String(album)],
  })
  ok(/exact work|already inscribed/i.test(String(cloneAct.error || '')), 'FILTER · same gene + other cover still 409 (lineage does not bypass genetics)')

  const burned1 = BigInt((await jget('/api/kraynet/supply')).burned || '0')
  // sleeve + name, 2 faces + 2 names, 4 tracks + 4 names, duet + name
  const expectBurn = 2n + 4n + 8n + 2n
  ok(burned1 === burned0 + expectBurn, `fire Δ ${burned1 - burned0} === ${expectBurn} (sendstar/clones/Mallory did not burn)`)
  ok((await jget('/api/kraynet/overview')).conserves === true, 'bench still conserves')

  console.log('\n   THE RECORD')
  console.log(`   sleeve  ${NODE}/star/${album}`)
  console.log(`   alice   ${NODE}/star/${aliceFaceNo}`)
  console.log(`   bob     ${NODE}/star/${bobFaceNo}`)
  console.log(`   duet    ${NODE}/star/${duetNo}  ·  ${NODE}/tx/${duet.hash}`)
  console.log(`   play    ${NODE}/render/${sha(duetRelic)}`)
  console.log(`   L1      ${l1}  (signed origin; this bench accepted the claim)\n`)

  if (fail) { console.log('  ' + fail + ' failed · ' + pass + ' passed\n'); process.exit(1) }
  console.log('  ' + pass + ' passed · the record is on :4477 — open the sleeve\n')
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1) })
