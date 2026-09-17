/**
 * STAR-LIKE HTTP gauntlet — disposable regtest door.
 * prepare → forge refuse → tip none/kray → plate floor → freeze refuse →
 * analytics rank → chrome ♥ → reboot replay.
 *
 *   node src/test/star-like-http.test.ts
 *
 * Does not touch Signet / the Creator's :4477 journal.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as btc from '@scure/btc-signer'
import { NETWORKS, _generateKeyPair, _hexToBytes, _signKrayWallet, toBtcNet } from '../protocol/scheme.ts'
import { encodeKrayPlate, hashKrayPlate } from '../protocol/kray-plate.ts'

const NET = 'regtest'
const PORT = 4498
const BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-starlike-http-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m); return } fail++; console.error('  ✗ ' + m) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string) => fetch(BASE + p).then((r) => r.json())
const jpost = (p: string, body: unknown) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(async (r) => {
  const j = await r.json().catch(() => ({}))
  return { ...j, _http: r.status }
})

function wallet(tag: string) {
  const sk = createHash('sha256').update(`starlike-http|${tag}|${process.pid}`).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { sk, pk: publicKeyHex, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address!, tag }
}
type W = ReturnType<typeof wallet>

async function act(w: W, body: Record<string, unknown>) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: w.addr })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)), ...prep }
  const sub = await jpost('/api/kraynet/submit', {
    ...body, from: w.addr, nonce: prep.nonce,
    publicKey: w.pk, signature: _signKrayWallet(prep.message, w.sk), scheme: 'kraywallet',
  })
  return { ...sub, star: sub.star ?? prep.star, message: prep.message }
}

async function boot() {
  const child = spawn('node', [SERVER], {
    env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_TRUSTED_DEV: '1' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 120; i++) {
    try { const h = await jget('/health'); if (h && h.ok) return child } catch { /* coming up */ }
    await sleep(80)
  }
  try { child.kill('SIGKILL') } catch { /* */ }
  throw new Error('star-like-http: node did not answer /health')
}

async function main() {
  console.log('\n╔═ STAR-LIKE HTTP GAUNTLET — prepare · forge · tip · plate · freeze · reboot ═╗\n')
  rmSync(DATA, { recursive: true, force: true })
  mkdirSync(DATA, { recursive: true })
  let child = await boot()
  const done = (code: number) => {
    try { child.kill('SIGKILL') } catch { /* */ }
    rmSync(DATA, { recursive: true, force: true })
    console.log(`\n── ${pass} passed · ${fail} failed ──\n`)
    process.exit(code)
  }
  try {
    const A = wallet('alice'), B = wallet('bob'), C = wallet('carol'), D = wallet('dave'), M = wallet('mallory')

    for (const w of [A, B, C, D]) {
      const d = await jpost('/api/kraynet/donate', { to: w.addr, sats: '800' })
      ok(d.ok === true, `donate → ${w.tag}`)
    }

    const born = await act(A, { action: 'name', name: `likehttp${process.pid}` })
    ok(born.ok === true && born.star != null, 'Alice baptises a living star')
    const star = String(born.star)

    // ── fee-only like (default tip none) ──
    const prep0 = await jpost('/api/kraynet/prepare', {
      action: 'star-like', from: B.addr, star, tipAsset: 'none',
    })
    ok(!!prep0.message && !prep0.error, 'prepare star-like tip=none returns message')
    ok(typeof prep0.message === 'string' && /star-like\.v1/.test(prep0.message) && !/\|tip=/.test(prep0.message),
      'fee-only message names star, omits tip (A3)')

    const forged = await jpost('/api/kraynet/submit', {
      action: 'star-like', from: B.addr, star, tipAsset: 'none', nonce: prep0.nonce,
      publicKey: M.pk, signature: _signKrayWallet(prep0.message, M.sk), scheme: 'kraywallet',
    })
    ok(!!forged.error, 'forged star-like refused')

    const balB0 = BigInt((await jget('/api/kraynet/account/' + encodeURIComponent(B.addr))).balance || '0')
    const balA0 = BigInt((await jget('/api/kraynet/account/' + encodeURIComponent(A.addr))).balance || '0')
    const treas0 = BigInt((await jget('/api/kraynet/analytics')).supply?.treasury || '0')

    const like0 = await act(B, { action: 'star-like', star, tipAsset: 'none' })
    ok(like0.ok === true, 'Bob fee-only like succeeds')

    const balB1 = BigInt((await jget('/api/kraynet/account/' + encodeURIComponent(B.addr))).balance || '0')
    const balA1 = BigInt((await jget('/api/kraynet/account/' + encodeURIComponent(A.addr))).balance || '0')
    const treas1 = BigInt((await jget('/api/kraynet/analytics')).supply?.treasury || '0')
    ok(balB1 === balB0 - 1n, 'liker paid exactly 1 ₭ fee')
    ok(balA1 === balA0, 'owner balance unchanged on tip=none')
    ok(treas1 === treas0 + 1n, 'fee 1 → Treasury')

    const view0 = await jget('/api/kraynet/star/' + star)
    ok(view0.social && view0.social.count === 1, 'star.social.count = 1')
    ok(view0.social && view0.social.fees === '1', 'star.social.fees = 1')
    ok(view0.social && view0.social.tipKray === '0', 'star.social.tipKray = 0')
    ok(view0.social && view0.social.feeOnly === 1 && view0.social.tipCount === 0, 'first like is fee-only')

    // ── tip ₭ from a fresh wallet (once-ever: Bob already liked) ──
    const likeK = await act(C, { action: 'star-like', star, tipAsset: 'kray', amount: '3' })
    ok(likeK.ok === true, 'Carol tip 3 ₭ like succeeds')
    const viewK = await jget('/api/kraynet/star/' + star)
    ok(viewK.social && viewK.social.count === 2, 'star.social.count = 2 after tip like')
    ok(viewK.social && viewK.social.tipKray === '3', 'star.social.tipKray = 3')
    ok(viewK.social && viewK.social.tipCount === 1 && viewK.social.feeOnly === 1, 'one tip like + one fee-only')
    const balA2 = BigInt((await jget('/api/kraynet/account/' + encodeURIComponent(A.addr))).balance || '0')
    ok(balA2 === balA1 + 3n, 'owner +3 ₭ from tip')

    // ── once-ever refuse ──
    const twice = await act(B, { action: 'star-like', star, tipAsset: 'kray', amount: '1' })
    ok(!!twice.error, 'Bob cannot like the same star twice')

    // ── self-like fee-only ──
    const self = await act(A, { action: 'star-like', star, tipAsset: 'none' })
    ok(self.ok === true, 'owner self-like fee-only succeeds')

    // ── plate tip floor: seal tip=kray amount=2, then refuse tip=none / wrong amount ──
    const floor = { description: 'like floor exam', url: '', bannerUrl: '', likeTip: 'kray', likeAmount: '2', likeRune: '' }
    const plate = await act(A, { action: 'set-kray-plate', star, ...floor })
    ok(plate.ok === true, 'owner seals like tip floor (kray · 2) via plate · 1 ₭')
    const ph = hashKrayPlate(floor)
    const atlasPath = join(DATA, 'content', ph)
    ok(Buffer.compare(readFileSync(atlasPath), encodeKrayPlate(floor)) === 0, 'atlas bytes carry likeTip block')

    const refuseNone = await act(D, { action: 'star-like', star, tipAsset: 'none' })
    ok(!!refuseNone.error, 'plate floor refuses tip=none')

    const refuseAmt = await act(D, { action: 'star-like', star, tipAsset: 'kray', amount: '1' })
    ok(!!refuseAmt.error, 'plate floor refuses tip amount below floor')

    const okFloor = await act(D, { action: 'star-like', star, tipAsset: 'kray', amount: '2' })
    ok(okFloor.ok === true, 'like at sealed tip floor succeeds')

    const viewP = await jget('/api/kraynet/star/' + star)
    ok(viewP.krayPlate && viewP.krayPlate.likeTip === 'kray' && viewP.krayPlate.likeAmount === '2',
      'star view exposes plate likeTip · likeAmount')

    // ── analytics /rank/likes book ──
    const an = await jget('/api/kraynet/analytics')
    ok(an.likes && Array.isArray(an.likes.rank) && an.likes.rank.some((r: { star: string }) => String(r.star) === star),
      'analytics.likes.rank includes the liked star')
    ok(an.likes && Number(an.likes.totalLikes) >= 4, 'analytics.likes.totalLikes ≥ 4')

    // ── freeze → like refused ──
    const freeze = await act(A, { action: 'sendstar', to: 'KRAY_BLACK_HOLE', star })
    ok(freeze.ok === true, 'Alice freezes the star')
    const E = wallet('erin')
    await jpost('/api/kraynet/donate', { to: E.addr, sats: '400' })
    const likeDead = await act(E, { action: 'star-like', star, tipAsset: 'kray', amount: '2' })
    ok(!!likeDead.error, 'like on frozen star refused')

    // ── chrome ──
    const starHtml = await fetch(BASE + '/star/' + star).then((r) => r.text())
    ok(starHtml.includes('star-like-go') && starHtml.includes('♥'), 'star.html chrome has ♥ like button')
    ok(starHtml.includes('no tip') || starHtml.includes('tip ·') || starHtml.includes('sl-tip'), 'star.html shows tip status face')
    const rankHtml = await fetch(BASE + '/rank/likes').then((r) => r.text())
    ok(rankHtml.includes('likes') && rankHtml.includes('tableLikes') || rankHtml.includes('/rank/likes'),
      'rank/likes drawer serves')
    const krayJs = await fetch(BASE + '/kray.js').then((r) => r.text())
    ok(krayJs.includes('likeStar') && krayJs.includes("star-like"), 'kray.js exposes likeStar → star-like')
    ok(krayJs.includes("'star-like': 'social'") || krayJs.includes('star-like\': \'social\''), 'kray.js ACT_FAMILY social')

    // ── reboot: social book re-derives ──
    child.kill('SIGKILL')
    await sleep(250)
    child = await boot()
    const viewR = await jget('/api/kraynet/star/' + star)
    ok(viewR.owner === 'KRAY_BLACK_HOLE', 'after reboot star still frozen')
    ok(viewR.social && Number(viewR.social.count) >= 4, 'after reboot like count re-derives from journal')

    const anR = await jget('/api/kraynet/analytics')
    ok(anR.likes && Number(anR.likes.totalLikes) >= 4, 'after reboot analytics.likes survives')

    done(fail ? 1 : 0)
  } catch (e) {
    console.error(e)
    done(1)
  }
}
main()
