/**
 * CITIZEN MOUTH HTTP — disposable door: prepare → sign → submit → profile.mouth → clear.
 *   node src/test/set-profile-http.test.ts
 *
 * Does not touch Signet / live journals. Fresh data dir; kills the child after.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as btc from '@scure/btc-signer'
import { NETWORKS, _generateKeyPair, _hexToBytes, _signKrayWallet, toBtcNet } from '../protocol/scheme.ts'

const NET = 'regtest'
const PORT = 4498
const BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-setprofile-http-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m); return } fail++; console.error('  ✗ ' + m) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string) => fetch(BASE + p).then((r) => r.json())
const jpost = (p: string, body: unknown) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json())

/** Distinct image bytes (GIF has no PNG skeleton gene — each file is unique by contentHash). */
function gifOf(tag: string) {
  const seed = createHash('sha256').update(`setprofile-gif|${tag}`).digest().subarray(0, 8)
  // Minimal 1×1 GIF89a + unique trailer so contentHash differs
  return Buffer.concat([
    Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
      0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
    ]),
    seed,
  ])
}

function wallet(tag: string) {
  const sk = createHash('sha256').update(`setprofile-http|${tag}|${process.pid}`).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { sk, pk: publicKeyHex, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address! }
}
type W = ReturnType<typeof wallet>

async function act(w: W, body: Record<string, unknown>) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: w.addr })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)), ...prep }
  const sub = await jpost('/api/kraynet/submit', {
    ...body, from: w.addr, nonce: prep.nonce,
    publicKey: w.pk, signature: _signKrayWallet(prep.message, w.sk), scheme: 'kraywallet',
  })
  return { ...sub, star: sub.star ?? prep.star }
}

async function boot() {
  const child = spawn('node', [SERVER], {
    env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_TRUSTED_DEV: '1' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 100; i++) {
    try { const h = await jget('/health'); if (h && h.ok) return child } catch { /* coming up */ }
    await sleep(80)
  }
  try { child.kill('SIGKILL') } catch { /* */ }
  throw new Error('set-profile-http: node did not answer /health')
}

async function main() {
  console.log('\n╔═ CITIZEN MOUTH HTTP — prepare · submit · profile.mouth · clear ═╗\n')
  rmSync(DATA, { recursive: true, force: true })
  mkdirSync(DATA, { recursive: true })
  let child = await boot()
  const done = (code: number) => {
    try { child.kill('SIGKILL') } catch { /* */ }
    rmSync(DATA, { recursive: true, force: true })
    console.log(`\n${pass} passed, ${fail} failed\n`)
    process.exit(code)
  }
  try {
    const A = wallet('alice'), B = wallet('bob'), M = wallet('mallory')

    for (const w of [A, B]) {
      const d = await jpost('/api/kraynet/donate', { to: w.addr, sats: '800' })
      ok(d.ok === true, `donate → ${w.addr.slice(0, 12)}…`)
    }

    const img = await act(A, {
      action: 'inscribe',
      content: gifOf('alice').toString('base64'),
      encoding: 'base64',
      contentType: 'image/gif',
    })
    ok(img.ok === true && img.star != null, 'Alice inscribes an image star')
    const bannerStar = String(img.star)

    const text = await act(A, {
      action: 'inscribe',
      content: `not-image-${process.pid}`,
      contentType: 'text/plain',
    })
    ok(text.ok === true && text.star != null, 'Alice inscribes a text star (not a banner)')

    const mouth = {
      action: 'set-profile',
      description: 'Builder on the book',
      url: 'https://example.com',
      bannerStar,
      bannerUrl: 'https://example.com/promo',
    }

    const prep = await jpost('/api/kraynet/prepare', { ...mouth, from: A.addr })
    ok(!!prep.message && !prep.error, 'prepare set-profile returns canonical message')

    const forged = await jpost('/api/kraynet/submit', {
      ...mouth, from: A.addr, nonce: prep.nonce,
      publicKey: M.pk, signature: _signKrayWallet(prep.message, M.sk), scheme: 'kraywallet',
    })
    ok(!!forged.error, 'forged set-profile refused')

    const httpTry = await act(A, { ...mouth, url: 'http://insecure.example' })
    ok(!!httpTry.error, 'http (non-https) site URL refused at the door')

    const set = await act(A, mouth)
    ok(set.ok === true, 'Alice set-profile succeeds (1 ₭ identity seal)')

    const balBefore = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    const bal1 = BigInt(String(balBefore.balance || '0'))
    ok(balBefore.mouthPaid === true && balBefore.mouthFee === '1', 'profile.mouthPaid / mouthFee = paid law')
    ok(typeof balBefore.mouthNextAt === 'number' && balBefore.mouthNextAt > Date.now(),
      'profile.mouthNextAt is in the future after seal')
    ok(balBefore.mouthDescMax === 160, 'profile.mouthDescMax is 160 (X bio)')

    const set2 = await act(A, {
      action: 'set-profile',
      description: 'Rotated bio',
      url: 'https://example.com',
      bannerStar,
      bannerUrl: 'https://example.com/promo',
    })
    ok(!!set2.error && /cooldown/i.test(String(set2.error)), 'Alice rotate inside cooldown refused at the door')
    const balAfter = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    ok(BigInt(String(balAfter.balance || '0')) === bal1, 'refused rotate moved NO ₭')

    const prof = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    ok(prof.mouth && prof.mouth.description === 'Builder on the book', 'profile.mouth.description (first seal)')
    ok(prof.mouth && prof.mouth.url === 'https://example.com', 'profile.mouth.url')
    ok(prof.mouth && String(prof.mouth.bannerStar) === bannerStar, 'profile.mouth.bannerStar')
    ok(prof.mouth && prof.mouth.banner && prof.mouth.banner.url, 'profile.mouth.banner paints content URL')

    const bobBanner = await act(B, {
      action: 'inscribe',
      content: gifOf('bob').toString('base64'),
      encoding: 'base64',
      contentType: 'image/gif',
    })
    ok(bobBanner.ok === true, 'Bob inscribes his own image')
    const steal = await act(A, {
      action: 'set-profile', description: 'x', url: '', bannerStar: String(bobBanner.star), bannerUrl: '',
    })
    ok(!!steal.error, 'Alice cannot wear Bob’s star as banner (or still in cooldown)')

    const badType = await act(A, {
      action: 'set-profile', description: '', url: '', bannerStar: String(text.star), bannerUrl: '',
    })
    ok(!!badType.error, 'non-image star refused as banner (or still in cooldown)')

    const send = await act(A, { action: 'sendstar', to: B.addr, star: bannerStar })
    ok(send.ok === true, 'Alice sends banner star to Bob')
    const prof2 = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    ok(prof2.mouth && prof2.mouth.bannerStar === '' && !prof2.mouth.banner, 'banner cleared after send; bio kept')
    ok(prof2.mouth && prof2.mouth.description === 'Builder on the book', 'bio survives banner clear')

    const clear = await act(A, {
      action: 'set-profile', description: '', url: '', bannerStar: '', bannerUrl: '',
    })
    ok(!!clear.error && /cooldown/i.test(String(clear.error)), 'Alice clear inside cooldown refused')
    const prof3 = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    ok(prof3.mouth && prof3.mouth.description === 'Builder on the book', 'mouth still present after refused clear')

    const html = await fetch(BASE + '/u/' + encodeURIComponent(A.addr)).then((r) => r.text())
    ok(html.includes('set-profile') && html.includes('paintCitizenMouth'), 'profile page chrome includes mouth editor')

    const bobMouth = await act(B, {
      action: 'set-profile',
      description: 'Bob mouth',
      url: 'https://bob.example',
      bannerStar: bannerStar,
      bannerUrl: '',
    })
    ok(bobMouth.ok === true, 'Bob sets mouth with the image he now owns (pays 1 ₭)')

    child.kill('SIGKILL')
    await sleep(200)
    child = await boot()
    const profR = await jget('/api/kraynet/profile/' + encodeURIComponent(B.addr))
    ok(profR.mouth && profR.mouth.description === 'Bob mouth' && String(profR.mouth.bannerStar) === bannerStar,
      'after reboot Bob mouth re-derives from the journal')
    const profAR = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    ok(profAR.mouth && profAR.mouth.description === 'Builder on the book', 'after reboot Alice mouth still sealed')
    ok(typeof profAR.mouthNextAt === 'number' && profAR.mouthNextAt > 0, 'after reboot gap clock re-derives')

    done(fail ? 1 : 0)
  } catch (e) {
    console.error(e)
    done(1)
  }
}
main()
