/**
 * ID3 COVER HTTP SWARM — disposable regtest node. Inscribe muxed MP3s,
 * prove /cover reads the APIC, /content MPEG sha256 matches the drop,
 * 320 nibble survives, hostility 404s, reboot re-derives.
 * Disk + journal: sha256(file) === event.contentHash, prepare writes nothing,
 * A5 duplicate is 409 and does not burn, reboot appends no journal line.
 *
 *   node src/test/id3-cover-http.test.ts
 *
 * Does not touch Signet. Does not use :4477.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as btc from '@scure/btc-signer'
import { NETWORKS, _generateKeyPair, _hexToBytes, _signKrayWallet, toBtcNet } from '../protocol/scheme.ts'
import { musicRelic, mpegBody, mpeg1L3BitrateKbps, readApic } from '../../../kray-net/id3-cover.js'

const NET = 'regtest'
const PORT = 4497
const BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-id3-http-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const N = 8

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; return } fail++; console.error('  ✗ ' + m) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sha = (b: Uint8Array | Buffer) => createHash('sha256').update(b).digest('hex')
const jget = (p: string) => fetch(BASE + p).then((r) => r.json())
const jpost = (p: string, body: unknown) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json())

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])
function mpeg320(tag: string) {
  const pay = createHash('sha256').update('http-mpeg|' + tag).digest()
  return Uint8Array.from([0xff, 0xfb, 0xe0, 0x00, ...pay])
}
function coverOf(tag: string) {
  return Uint8Array.from([...PNG, ...createHash('sha256').update('http-cover|' + tag).digest()])
}

function wallet(tag: string) {
  const sk = createHash('sha256').update(`id3-http|${tag}|${process.pid}`).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { tag, sk, pk: publicKeyHex, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address! }
}
type W = ReturnType<typeof wallet>

async function act(w: W, body: Record<string, unknown>) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: w.addr })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)) }
  return jpost('/api/kraynet/submit', {
    ...body, from: w.addr, nonce: prep.nonce, clock: prep.clock,
    publicKey: w.pk, signature: _signKrayWallet(prep.message, w.sk), scheme: 'kraywallet',
  })
}

async function boot() {
  const child = spawn('node', [SERVER], {
    env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_TRUSTED_DEV: '1' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 80; i++) {
    try { const h = await jget('/health'); if (h && h.ok) return child } catch { /* still coming up */ }
    await sleep(80)
  }
  try { child.kill('SIGKILL') } catch { /* already dead */ }
  throw new Error('id3-http: node did not answer /health')
}

async function main() {
  console.log('\n╔═ ID3 COVER HTTP — inscribe · /cover · 320 · reboot ═╗\n')
  rmSync(DATA, { recursive: true, force: true })
  mkdirSync(DATA, { recursive: true })
  let child = await boot()
  const done = (code: number) => {
    try { child.kill('SIGKILL') } catch { /* already dead */ }
    rmSync(DATA, { recursive: true, force: true })
    process.exit(code)
  }
  try {
    const wallets = Array.from({ length: N }, (_, i) => wallet('w' + i))
    for (const w of wallets) {
      const d = await jpost('/api/kraynet/donate', { to: w.addr, sats: '50' })
      ok(d.ok === true, `mint → ${w.tag}`)
    }
    const before = await jget('/api/kraynet/overview')
    ok(before.conserves === true, 'conserves before the music swarm')
    const burned0 = BigInt((await jget('/api/kraynet/supply')).burned || '0')

    const songs = wallets.map((w, i) => {
      const src = mpeg320('s' + i)
      const art = coverOf('s' + i)
      const relic = musicRelic(src, art, 'image/png')
      return { w, src, art, relic, hash: sha(relic) }
    })

    const ghost = musicRelic(mpeg320('prepare-only'), coverOf('prepare-only'), 'image/png')
    const ghostHash = sha(ghost)
    const prepOnly = await jpost('/api/kraynet/prepare', {
      action: 'inscribe', from: wallets[0].addr,
      content: Buffer.from(ghost).toString('base64'), encoding: 'base64', contentType: 'audio/mpeg',
    })
    ok(prepOnly.contentHash === ghostHash, 'prepare hashes the real bytes, never a client-asserted hash')
    ok(String(prepOnly.message || '').includes(ghostHash), 'the signed message commits the relic sha256')
    ok(prepOnly.bodyHash === sha(mpegBody(ghost)!), 'prepare bodyHash is sha256 of the MPEG skeleton — clothes ignored')
    ok(String(prepOnly.message || '').startsWith('kraynet.inscribe.v5|'), 'audio with a gene is v5')
    ok(!existsSync(join(DATA, 'content', ghostHash)), 'prepare writes NOTHING — disk stays clean until a signature lands')

    const born = await Promise.all(songs.map((s) => act(s.w, {
      action: 'inscribe',
      content: Buffer.from(s.relic).toString('base64'),
      encoding: 'base64',
      contentType: 'audio/mpeg',
      meta: JSON.stringify({ title: 'swarm-' + s.w.tag }),
    })))
    ok(born.every((r) => r.ok === true), `swarm inscribed ${N} music relics`)

    const dup = await act(wallets[0], {
      action: 'inscribe',
      content: Buffer.from(songs[0].relic).toString('base64'),
      encoding: 'base64',
      contentType: 'audio/mpeg',
    })
    ok(/already inscribed/i.test(String(dup.error || '')), 'A5: the same relic cannot be inscribed twice — ₭ not burned')

    const cloneRelic = musicRelic(songs[0].src, coverOf('other-cover'), 'image/png')
    ok(sha(cloneRelic) !== songs[0].hash, 'a new cover makes a new relic hash')
    const clonePrep = await jpost('/api/kraynet/prepare', {
      action: 'inscribe', from: wallets[1].addr,
      content: Buffer.from(cloneRelic).toString('base64'), encoding: 'base64', contentType: 'audio/mpeg',
    })
    ok(/exact work|already inscribed/i.test(String(clonePrep.error || '')), 'same MPEG gene + other cover is 409 at prepare — ₭ not burned')
    ok(!clonePrep.message, 'prepare does not hand a signature for a taken gene')

    for (let i = 0; i < N; i++) {
      const s = songs[i]
      const star = await jget('/api/kraynet/star/' + born[i].star)
      const rec = (star.inscriptions && star.inscriptions[0]) || {}
      ok(rec.contentType === 'audio/mpeg', `star #${born[i].star} is audio/mpeg`)
      ok(rec.contentHash === s.hash, `star #${born[i].star} contentHash is sha256(relic)`)
      ok(Number(rec.size) === s.relic.length, `star #${born[i].star} size is the relic length`)

      const onDisk = join(DATA, 'content', s.hash)
      ok(existsSync(onDisk), `content store holds ${s.hash.slice(0, 8)}…`)
      ok(sha(readFileSync(onDisk)) === s.hash, 'disk bytes sha256 === journal contentHash — no corruption')
      const side = JSON.parse(readFileSync(onDisk + '.json', 'utf8'))
      ok(side.contentType === 'audio/mpeg' && Number(side.size) === s.relic.length, 'sidecar type+size match the relic')

      const coverRes = await fetch(BASE + '/cover/' + s.hash)
      ok(coverRes.ok === true && (coverRes.headers.get('content-type') || '').startsWith('image/png'),
        `/cover/${s.hash.slice(0, 8)}… serves the APIC`)
      const coverBytes = new Uint8Array(await coverRes.arrayBuffer())
      ok(sha(coverBytes) === sha(s.art), `/cover sha256 is the dropped cover`)

      const rawRes = await fetch(BASE + '/content/' + s.hash)
      const raw = new Uint8Array(await rawRes.arrayBuffer())
      ok(sha(raw) === s.hash, '/content bytes are the relic')
      ok(sha(mpegBody(raw)!) === sha(s.src), '/content MPEG sha256 === dropped MP3 body')
      ok(mpeg1L3BitrateKbps(raw) === 320, '/content bitrate nibble is still 320')
      ok(sha(readApic(raw)!.bytes) === sha(s.art), '/content APIC sha256 === cover')

      const stage = await fetch(BASE + '/render/' + s.hash)
      const html = await stage.text()
      ok(stage.ok === true && /text\/html/.test(stage.headers.get('content-type') || ''), '/render is a player page, not the raw MP3')
      ok(html.includes('/cover/' + s.hash) && html.includes('/content/' + s.hash), '/render embeds cover + sealed audio')
      ok(!/script/i.test(html), '/render is zero-script — any phone browser can open it')
    }

    const text = await act(wallets[0], { action: 'inscribe', content: 'not-music-' + process.pid, contentType: 'text/plain' })
    ok(text.ok === true, 'a text relic still inscribes')
    const textStar = await jget('/api/kraynet/star/' + text.star)
    const textHash = textStar.inscriptions?.[0]?.contentHash
    const noCover = await fetch(BASE + '/cover/' + textHash)
    ok(noCover.status === 404, '/cover on a text star is 404')

    const bad = await fetch(BASE + '/cover/not-a-hash')
    ok(bad.status === 400 || bad.status === 404, 'hostile cover path is refused')
    const missing = await fetch(BASE + '/cover/' + '0'.repeat(64))
    ok(missing.status === 404, 'unknown hash is 404')

    const journalPath = join(DATA, 'kraynet-journal-regtest.jsonl')
    const journal = readFileSync(journalPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    const audioEv = journal.filter((e: { kind?: string; contentType?: string }) => e.kind === 'inscribe' && e.contentType === 'audio/mpeg')
    ok(audioEv.length === N, `journal holds exactly ${N} audio/mpeg inscribes — ghost + duplicate never landed`)
    ok(!journal.some((e: { contentHash?: string }) => e.contentHash === ghostHash), 'unsigned prepare-only hash is absent from the journal')
    for (let i = 1; i < journal.length; i++) {
      ok(journal[i].prevHash === journal[i - 1].hash, `journal hash-chain holds at seq ${journal[i].seq}`)
    }
    for (const e of audioEv) {
      const raw = readFileSync(join(DATA, 'content', e.contentHash))
      ok(sha(raw) === e.contentHash, `journal contentHash ${e.contentHash.slice(0, 8)}… === sha256(disk)`)
      ok(Number(e.size) === raw.length, 'journal size === disk length — no padding, no truncation')
      ok(e.bodyHash === sha(mpegBody(raw)!), 'journal bodyHash === sha256(mpegBody(disk)) — gene matches the store')
    }

    const after = await jget('/api/kraynet/overview')
    ok(after.conserves === true, 'conserves after the music swarm')
    const burned1 = BigInt((await jget('/api/kraynet/supply')).burned || '0')
    ok(burned1 === burned0 + BigInt(N + 1), `fire advanced by ${N} songs + 1 text — duplicate did not burn`)
    const root = after.cascadeRoot

    const journalLines = journal.length
    try { child.kill('SIGKILL') } catch { /* reboot */ }
    await sleep(200)
    child = await boot()
    const again = await jget('/api/kraynet/overview')
    ok(again.conserves === true, 'conserves after reboot')
    ok(again.cascadeRoot === root, 'cascade root byte-identical after reboot')
    const journalAgain = readFileSync(journalPath, 'utf8').trim().split('\n')
    ok(journalAgain.length === journalLines, 'reboot appends nothing — replay only, journal bytes stay the history')
    const cover2 = await fetch(BASE + '/cover/' + songs[0].hash)
    const art2 = new Uint8Array(await cover2.arrayBuffer())
    ok(cover2.ok === true && sha(art2) === sha(songs[0].art), '/cover re-derives from disk after reboot')
    for (const s of songs) {
      ok(sha(readFileSync(join(DATA, 'content', s.hash))) === s.hash, `reboot: ${s.hash.slice(0, 8)}… still byte-identical on disk`)
    }
    ok(!existsSync(join(DATA, 'content', ghostHash)), 'unsigned prepare-only relic never appeared on disk')

    if (fail) { console.log('\n  ' + fail + ' failed · ' + pass + ' passed\n'); done(1) }
    console.log('\n  ' + pass + ' passed · cover door · 320 · reboot\n')
    done(0)
  } catch (e) {
    console.error('  ✗ ' + ((e as Error).stack || (e as Error).message))
    done(1)
  }
}

main()
