/**
 * STAR-LIKE live lab exam — hits the Creator's regtest :4477 (mutates lab only).
 *   KRAY_NODE=http://127.0.0.1:4477 node src/test/star-like-live.test.ts
 *
 * Refuse to run if network ≠ regtest.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, _generateKeyPair, _hexToBytes, _signKrayWallet, toBtcNet } from '../protocol/scheme.ts'

const BASE = (process.env.KRAY_NODE || 'http://127.0.0.1:4477').replace(/\/$/, '')
const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m); return } fail++; console.error('  ✗ ' + m) }
const jget = (p: string) => fetch(BASE + p).then((r) => r.json())
const jpost = (p: string, body: unknown) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json())

function wallet(tag: string) {
  const sk = createHash('sha256').update(`starlike-live|${tag}|${process.pid}|${Date.now()}`).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return {
    sk, pk: publicKeyHex, tag,
    addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address!,
  }
}
type W = ReturnType<typeof wallet>

async function act(w: W, body: Record<string, unknown>) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: w.addr }) as Record<string, unknown>
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)), ...prep }
  return jpost('/api/kraynet/submit', {
    ...body, from: w.addr, nonce: prep.nonce,
    publicKey: w.pk, signature: _signKrayWallet(String(prep.message), w.sk), scheme: 'kraywallet',
  }) as Promise<Record<string, unknown>>
}

async function main() {
  console.log('\n╔═ STAR-LIKE LIVE · regtest lab ' + BASE + ' ═╗\n')
  const head = await jget('/api/kraynet/head').catch((e) => ({ error: String(e) })) as Record<string, unknown>
  ok(head && head.network === 'regtest' && !head.error, 'lab answers as regtest')
  if (head.error || head.network !== 'regtest') {
    console.error('refusing — not regtest')
    process.exit(1)
  }
  ok(typeof head.seq === 'number', 'lab seq=' + head.seq)

  const probe = await jpost('/api/kraynet/prepare', {
    action: 'star-like',
    from: 'bcrt1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqll5zk',
    star: '1', tipAsset: 'none',
  }) as Record<string, unknown>
  const probeErr = String(probe.error || '')
  if (/unknown action/i.test(probeErr)) {
    console.error('\n✗ LIVE LAB STALE — writer on ' + BASE + ' does not know action \"star-like\".')
    console.error('  Restart the regtest writer with the current tree (same KRAY_DATA), then re-run:')
    console.error('  KRAY_NODE=' + BASE + ' node src/test/star-like-live.test.ts\n')
    process.exit(2)
  }
  ok(!/unsupported|not implemented/i.test(probeErr), 'prepare knows star-like')

  const A = wallet('alice'), B = wallet('bob'), C = wallet('carol'), M = wallet('mallory')
  for (const w of [A, B, C]) {
    const d = await jpost('/api/kraynet/donate', { to: w.addr, sats: '600' }) as Record<string, unknown>
    ok(d.ok === true, `donate → ${w.tag}`)
  }

  const born = await act(A, { action: 'name', name: `livelike${process.pid}${Date.now() % 1e6}` })
  ok(born.ok === true && born.star != null, 'baptise living star #' + born.star)
  const star = String(born.star)

  const prep = await jpost('/api/kraynet/prepare', {
    action: 'star-like', from: B.addr, star, tipAsset: 'none',
  }) as Record<string, unknown>
  ok(!!prep.message && /star-like\.v1/.test(String(prep.message)), 'prepare star-like message')
  ok(!/\|tip=/.test(String(prep.message)), 'A3: tip omitted when none')

  const forged = await jpost('/api/kraynet/submit', {
    action: 'star-like', from: B.addr, star, tipAsset: 'none', nonce: prep.nonce,
    publicKey: M.pk, signature: _signKrayWallet(String(prep.message), M.sk), scheme: 'kraywallet',
  }) as Record<string, unknown>
  ok(!!forged.error, 'forge refused on live lab')

  const before = await jget('/api/kraynet/star/' + star) as Record<string, any>
  const like = await act(B, { action: 'star-like', star, tipAsset: 'none' })
  ok(like.ok === true, 'fee-only like applied on live lab')
  const after = await jget('/api/kraynet/star/' + star) as Record<string, any>
  ok(after.social && Number(after.social.count) === Number((before.social && before.social.count) || 0) + 1,
    'live star.social.count +1')

  const twice = await act(B, { action: 'star-like', star, tipAsset: 'kray', amount: '2' })
  ok(!!twice.error, 'same wallet cannot like twice (once-ever)')

  const tip = await act(C, { action: 'star-like', star, tipAsset: 'kray', amount: '2' })
  ok(tip.ok === true, 'tip 2 ₭ like on live lab (fresh wallet)')
  const afterTip = await jget('/api/kraynet/star/' + star) as Record<string, any>
  ok(afterTip.social && BigInt(afterTip.social.tipKray || 0) >= 2n, 'live tipKray raised')

  const an = await jget('/api/kraynet/analytics') as Record<string, any>
  ok(an.likes && Array.isArray(an.likes.rank), 'live analytics.likes present')
  if (an.likes && Array.isArray(an.likes.rank)) {
    ok(an.likes.rank.some((r: { star: string }) => String(r.star) === star), 'liked star on likes book')
  } else {
    ok(false, 'liked star on likes book')
  }

  const html = await fetch(BASE + '/star/' + star).then((r) => r.text())
  ok(html.includes('star-like-go') && html.includes('♥'), 'live chrome ♥ on /star/' + star)
  ok(html.includes('no tip') || html.includes('tip ·'), 'live tip badge visible')

  const flow = await jget('/api/kraynet/act-flow') as Record<string, any>
  ok(Array.isArray(flow.flow) && flow.flow.some((a: { kind: string; family: string }) => a.kind === 'star-like' && a.family === 'social'),
    'act-flow hangs star-like · family social')

  console.log(`\n── live lab: ${pass} passed · ${fail} failed · star #${star} ──\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
