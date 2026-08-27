/**
 * BODY HASH — live :4477 with REAL MP3 + real covers (SVG→PNG).
 *
 * ffmpeg 320 CBR → musicRelic (never re-encode) → BIP-340 → explorer.
 * Then the gene filter is pressed: same song, new cover must 409.
 *
 *   node src/test/body-hash-live-music-e2e.mjs
 *
 * Does not touch Signet. Writes a local proof page (audio + cover + tx links).
 */
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'
import { musicRelic, mpegBody, mpeg1L3BitrateKbps, hasApic, readApic } from '../../../kray-net/id3-cover.js'
import { bodyHashOf } from '../../../kray-net/body-hash.js'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'live-music-' + Date.now().toString(36)
const OUT = process.env.KRAY_MUSIC_OUT || join(tmpdir(), TAG)
const N = 6

const TRACKS = [
  { name: 'Amber Drift',     f1: 220, f2: 330, bg: '#1a0a2e', ink: '#e8c36a' },
  { name: 'Verdant Pulse',   f1: 261, f2: 329, bg: '#0b1f17', ink: '#5ee0a0' },
  { name: 'Violet Room',     f1: 293, f2: 440, bg: '#1a1020', ink: '#c97cff' },
  { name: 'Copper Horizon',  f1: 349, f2: 523, bg: '#201208', ink: '#ff8a4c' },
  { name: 'Ion Current',     f1: 392, f2: 587, bg: '#0a1628', ink: '#6ec8ff' },
  { name: 'Crimson Ember',   f1: 440, f2: 659, bg: '#2a0c14', ink: '#ff5d7a' },
]

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))
const sha = (b) => createHash('sha256').update(b).digest('hex')

function which(bin) {
  const r = spawnSync('which', [bin], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

function id(t) {
  const s = nsha(new TextEncoder().encode('body-hash-live-music|' + t + '|' + TAG))
  const x = Buffer.from(schnorr.getPublicKey(s)).toString('hex')
  return {
    t, s, x, a: btc.p2tr(Buffer.from(x, 'hex'), undefined, NETWORKS[NET]).address,
    sign: (m) => Buffer.from(schnorr.sign(nsha(new TextEncoder().encode(m)), s)).toString('hex'),
  }
}

function svgArt(tr, i) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${tr.bg}"/>
  <circle cx="256" cy="236" r="148" fill="none" stroke="${tr.ink}" stroke-width="8"/>
  <circle cx="256" cy="236" r="88" fill="${tr.ink}" fill-opacity="0.18"/>
  <polygon points="256,96 276,196 376,196 296,252 324,352 256,292 188,352 216,252 136,196 236,196"
           fill="${tr.ink}" fill-opacity="0.92"/>
  <text x="256" y="430" text-anchor="middle" fill="${tr.ink}"
        font-family="Georgia, serif" font-size="28">${tr.name}</text>
  <text x="256" y="462" text-anchor="middle" fill="${tr.ink}" fill-opacity="0.7"
        font-family="monospace" font-size="14">KRAY · ${String(i + 1).padStart(2, '0')}</text>
</svg>
`
}

function writeCovers(dir) {
  const py = join(dir, '_paint.py')
  writeFileSync(py, `
from PIL import Image, ImageDraw, ImageFont
import json, os, sys
root = sys.argv[1]
tracks = json.loads(sys.argv[2])
font_big = font_sm = ImageFont.load_default()
for p in (
  "/System/Library/Fonts/Supplemental/Georgia.ttf",
  "/Library/Fonts/Georgia.ttf",
  "/System/Library/Fonts/NewYork.ttf",
):
  if os.path.exists(p):
    font_big = ImageFont.truetype(p, 36)
    font_sm = ImageFont.truetype(p, 18)
    break
def hexcol(h):
  h = h.lstrip("#")
  return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
for i, t in enumerate(tracks):
  bg, ink = hexcol(t["bg"]), hexcol(t["ink"])
  im = Image.new("RGB", (512, 512), bg)
  d = ImageDraw.Draw(im)
  d.ellipse((108, 88, 404, 384), outline=ink, width=8)
  inner = tuple(int(bg[k] * 0.55 + ink[k] * 0.45) for k in range(3))
  d.ellipse((168, 148, 344, 324), fill=inner)
  d.polygon([(256,96),(276,196),(376,196),(296,252),(324,352),(256,292),(188,352),(216,252),(136,196),(236,196)], fill=ink)
  d.text((256, 408), t["name"], fill=ink, font=font_big, anchor="mm")
  d.text((256, 452), "KRAY · %02d" % (i + 1), fill=ink, font=font_sm, anchor="mm")
  im.save(os.path.join(root, "cover-%d.png" % i), "PNG")
  # a JPEG twin of cover 0 (same pixels, different quant) — used only as an extra art file
  if i == 0:
    im.save(os.path.join(root, "cover-0.jpg"), "JPEG", quality=92)
print("ok")
`)
  execFileSync('python3', [py, dir, JSON.stringify(TRACKS)], { stdio: 'inherit' })
}

function writeMp3(path, f1, f2) {
  const expr = `0.32*sin(2*PI*${f1}*t)*(0.65+0.35*sin(2*PI*2.5*t))+0.22*sin(2*PI*${f2}*t)`
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `aevalsrc=${expr}:s=44100:d=5`,
    '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100', '-ac', '1',
    path,
  ])
}

function probe(path) {
  const raw = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,bit_rate,sample_rate,duration',
    '-of', 'json', path,
  ], { encoding: 'utf8' })
  const s = JSON.parse(raw).streams?.[0] || {}
  return {
    codec: s.codec_name,
    bitrate: Number(s.bit_rate || 0),
    rate: Number(s.sample_rate || 0),
    duration: Number(s.duration || 0),
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

function writeProof(dir, rows, extra) {
  const cards = rows.map((r) => `
    <article class="card">
      <img src="${NODE}/cover/${r.hash}" alt="">
      <div class="meta">
        <h2>${r.title}</h2>
        <p>star <a href="${NODE}/star/${r.star}">#${r.star}</a>
          · tx <a href="${NODE}/tx/${r.tx}">${r.tx.slice(0, 12)}…</a></p>
        <p class="mono">content ${r.hash}<br>gene ${r.gene}</p>
        <p>
          <a href="${NODE}/render/${r.hash}">play + cover</a>
          · <a href="${NODE}/content/${r.hash}">bytes</a>
          · <a href="${NODE}/cover/${r.hash}">cover png</a>
        </p>
      </div>
      <audio controls preload="metadata" src="${NODE}/content/${r.hash}"></audio>
    </article>`).join('\n')
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>KRAY live music proof · ${TAG}</title>
<style>
  :root { --bg:#0c0b10; --ink:#f4efe6; --dim:#9a9286; --line:#2a2730; }
  html,body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 Georgia, serif; }
  main { max-width: 720px; margin: 32px auto 96px; padding: 0 16px; }
  h1 { font-size: 28px; font-weight: 500; }
  .sub { color: var(--dim); margin: 0 0 24px; }
  .card { border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin: 0 0 24px; }
  img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; display: block; }
  audio { width: 100%; margin-top: 12px; }
  .mono { font: 12px/1.45 ui-monospace, monospace; word-break: break-all; color: var(--dim); }
  a { color: #e8c36a; }
</style></head><body><main>
  <h1>Live music relics on :4477</h1>
  <p class="sub">${TAG} · ${rows.length} songs · gene filter pressed · Signet untouched</p>
  ${cards}
  ${extra || ''}
</main></body></html>
`
  const file = join(dir, 'PROOF.html')
  writeFileSync(file, html)
  return file
}

async function main() {
  console.log('\n╔═ LIVE MUSIC · real MP3 + covers · gene filter on :4477 ═╗\n')
  mkdirSync(OUT, { recursive: true })
  const ffmpeg = which('ffmpeg'), ffprobe = which('ffprobe')
  if (!ffmpeg || !ffprobe) die('ffmpeg/ffprobe required to mint a real 320 CBR MP3')

  const ov0 = await jget('/api/kraynet/overview')
  if (ov0.__down) die('no node at ' + NODE)
  ok(ov0.conserves === true && ov0.network === 'regtest', `bench is regtest and conserves (seq ${ov0.seq})`)

  const probeW = id('probe')
  const stale = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: probeW.a, content: 'v5-probe-' + TAG, contentType: 'text/plain',
  })
  ok(!!stale.message, 'door answers prepare')

  TRACKS.forEach((tr, i) => writeFileSync(join(OUT, `cover-${i}.svg`), svgArt(tr, i)))
  writeCovers(OUT)
  ok(true, `wrote ${N} SVG masters + PNG rasters in ${OUT}`)

  const songs = []
  for (let i = 0; i < N; i++) {
    const tr = TRACKS[i]
    const mp3Path = join(OUT, `track-${i}.mp3`)
    writeMp3(mp3Path, tr.f1, tr.f2)
    const raw = new Uint8Array(readFileSync(mp3Path))
    const info = probe(mp3Path)
    ok(info.codec === 'mp3' && info.bitrate >= 310000 && info.duration >= 4.5, `${tr.name}: real MP3 ~320k ${info.duration.toFixed(1)}s`)
    const png = new Uint8Array(readFileSync(join(OUT, `cover-${i}.png`)))
    ok(png[0] === 0x89 && png[1] === 0x50, `${tr.name}: PNG cover`)
    const relic = musicRelic(raw, png, 'image/png')
    const kbps = mpeg1L3BitrateKbps(relic)
    ok(kbps === 320, `${tr.name}: mux kept 320 CBR (got ${kbps})`)
    ok(sha(mpegBody(relic)) === sha(mpegBody(raw)), `${tr.name}: MPEG bytes untouched by APIC`)
    ok(hasApic(relic) && readApic(relic).mime === 'image/png', `${tr.name}: APIC is the PNG`)
    writeFileSync(join(OUT, `relic-${i}.mp3`), relic)
    songs.push({
      i, tr, raw, png, relic,
      hash: sha(relic),
      gene: bodyHashOf(relic, 'audio/mpeg'),
    })
  }
  ok(new Set(songs.map((s) => s.gene)).size === N, `${N} distinct MPEG genes`)
  ok(new Set(songs.map((s) => s.hash)).size === N, `${N} distinct relic hashes`)

  const svgBytes = Buffer.from(svgArt(TRACKS[0], 0))
  let svgRefused = false
  try { musicRelic(songs[0].raw, svgBytes, 'image/svg+xml') } catch (e) {
    svgRefused = /png or image\/jpeg/i.test(String(e.message))
  }
  ok(svgRefused, 'SVG cannot ride APIC — filter refuses at mux (PNG/JPEG only)')

  const wallets = Array.from({ length: N }, (_, i) => id('w' + i))
  for (const w of wallets) {
    const mint = await jpost('/api/kraynet/donate', { to: w.a, sats: '80' })
    if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 — ' + (mint.error || ''))
  }
  ok(true, `minted 80 ₭ → ${N} wallets`)

  const burned0 = BigInt((await jget('/api/kraynet/supply')).burned || '0')
  const born = await Promise.all(songs.map((s, i) => act(wallets[i], {
    action: 'inscribe',
    content: Buffer.from(s.relic).toString('base64'),
    encoding: 'base64',
    contentType: 'audio/mpeg',
    meta: JSON.stringify({ title: s.tr.name, album: 'KRAY live gene', track: i + 1 }),
  })))
  ok(born.every((r) => r.ok === true && r.star != null && r.hash), `swarm inscribed ${N} real songs`)
  ok(born.every((r) => String(r._message || '').startsWith('kraynet.inscribe.v5|')), 'every act signed v5')

  const rows = []
  for (let i = 0; i < N; i++) {
    const r = born[i], s = songs[i]
    const starNo = r.star ?? r._star
    const star = await jget('/api/kraynet/star/' + starNo)
    const rec = (star.inscriptions && star.inscriptions[0]) || {}
    const tx = await jget('/api/kraynet/tx/' + r.hash)
    const content = new Uint8Array(await (await fetch(NODE + '/content/' + s.hash)).arrayBuffer())
    const coverRes = await fetch(NODE + '/cover/' + s.hash)
    const coverBuf = new Uint8Array(await coverRes.arrayBuffer())
    const render = await fetch(NODE + '/render/' + s.hash)
    const renderHtml = await render.text()
    ok(rec.contentHash === s.hash, `#${starNo} contentHash is the relic`)
    ok(tx.hash === r.hash && tx.contentHash === s.hash, `tx ${r.hash.slice(0, 8)}… carries the relic`)
    ok(sha(content) === s.hash && content[0] === 0x49 && content[1] === 0x44 && content[2] === 0x33, `/content #${starNo} is the ID3 relic`)
    ok(coverRes.ok && coverBuf[0] === 0x89, `/cover #${starNo} is the PNG`)
    ok(sha(coverBuf) === sha(s.png), `/cover #${starNo} matches the painted art`)
    ok(/<audio[\s>]/.test(renderHtml) && renderHtml.includes('/cover/' + s.hash), `/render #${starNo} has player + cover`)
    rows.push({ title: s.tr.name, star: starNo, tx: r.hash, hash: s.hash, gene: s.gene })
    console.log(`   → ${s.tr.name}  star #${starNo}`)
    console.log(`      tx     ${NODE}/tx/${r.hash}`)
    console.log(`      play   ${NODE}/render/${s.hash}`)
    console.log(`      star   ${NODE}/star/${starNo}`)
  }

  const newCover = new Uint8Array(readFileSync(join(OUT, 'cover-1.png')))
  const clone = musicRelic(songs[0].raw, newCover, 'image/png')
  ok(sha(clone) !== songs[0].hash, 'new cover → new relic hash')
  ok(bodyHashOf(clone, 'audio/mpeg') === songs[0].gene, 'new cover → SAME gene')
  const cloneAct = await act(wallets[1], {
    action: 'inscribe',
    content: Buffer.from(clone).toString('base64'),
    encoding: 'base64',
    contentType: 'audio/mpeg',
  })
  ok(/exact work|already inscribed/i.test(String(cloneAct.error || '')), 'FILTER · same song + other cover → 409')

  const exact = await act(wallets[0], {
    action: 'inscribe',
    content: Buffer.from(songs[0].relic).toString('base64'),
    encoding: 'base64',
    contentType: 'audio/mpeg',
  })
  ok(/already inscribed/i.test(String(exact.error || '')), 'FILTER · byte-identical relic → 409')

  const swarmFilter = await Promise.all(wallets.map((w, i) => {
    const other = musicRelic(songs[0].raw, new Uint8Array(readFileSync(join(OUT, `cover-${i}.png`))), 'image/png')
    return act(w, {
      action: 'inscribe',
      content: Buffer.from(other).toString('base64'),
      encoding: 'base64',
      contentType: 'audio/mpeg',
    })
  }))
  const refused = swarmFilter.filter((r) => /exact work|already inscribed/i.test(String(r.error || '')))
  ok(refused.length === N, `FILTER swarm · ${N} parallel same-gene covers all 409 (got ${refused.length})`)
  ok(swarmFilter.every((r) => r.star == null && r.ok !== true), 'FILTER swarm · no living star slipped through')

  const lie = await jpost('/api/kraynet/prepare', {
    action: 'inscribe', from: wallets[2].a,
    content: Buffer.from(clone).toString('base64'), encoding: 'base64', contentType: 'text/plain',
    bodyHash: '00'.repeat(32),
  })
  ok(/exact work|already inscribed/i.test(String(lie.error || '')), 'FILTER · lying text/plain + fake bodyHash still hits the gene')

  const svgStar = await act(wallets[0], {
    action: 'inscribe',
    content: svgArt(TRACKS[0], 0),
    contentType: 'image/svg+xml',
    meta: JSON.stringify({ title: TRACKS[0].name + ' · SVG master', note: 'vector source — not the APIC' }),
  })
  ok(svgStar.ok === true && svgStar.star != null, `standalone SVG born as its own star #${svgStar.star} (not a music cover)`)
  if (svgStar.hash) {
    console.log(`   → SVG master  star #${svgStar.star}`)
    console.log(`      tx     ${NODE}/tx/${svgStar.hash}`)
    console.log(`      star   ${NODE}/star/${svgStar.star}`)
  }

  const burned1 = BigInt((await jget('/api/kraynet/supply')).burned || '0')
  ok(burned1 === burned0 + BigInt(N + 1), `fire Δ ${burned1 - burned0} === ${N}+1 (songs + SVG; clones did not burn)`)
  const ov1 = await jget('/api/kraynet/overview')
  ok(ov1.conserves === true, 'bench still conserves')

  const extra = svgStar.ok
    ? `<article class="card"><p>SVG master (own star, not APIC): <a href="${NODE}/star/${svgStar.star}">#${svgStar.star}</a> · <a href="${NODE}/tx/${svgStar.hash}">tx</a></p></article>`
    : ''
  const proof = writeProof(OUT, rows, extra)
  console.log('\n   proof page  file://' + proof)
  console.log('   artifacts   ' + OUT + '\n')

  if (fail) { console.log('  ' + fail + ' failed · ' + pass + ' passed\n'); process.exit(1) }
  console.log('  ' + pass + ' passed · real audio + covers on :4477, gene filter holds\n')
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1) })
