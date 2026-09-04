/**
 * CITIZEN FACE HTTP — disposable door: prepare → sign → submit → profile.face → clear on send.
 *   node src/test/set-face-http.test.ts
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
const PORT = 4497
const BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-setface-http-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m); return } fail++; console.error('  ✗ ' + m) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string) => fetch(BASE + p).then((r) => r.json())
const jpost = (p: string, body: unknown) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json())

function wallet(tag: string) {
  const sk = createHash('sha256').update(`setface-http|${tag}|${process.pid}`).digest()
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
  throw new Error('set-face-http: node did not answer /health')
}

async function main() {
  console.log('\n╔═ CITIZEN FACE HTTP — prepare · submit · profile · clear ═╗\n')
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
      const d = await jpost('/api/kraynet/donate', { to: w.addr, sats: '400' })
      ok(d.ok === true, `donate → ${w.addr.slice(0, 12)}…`)
    }

    // baptism births a named star (same door as freeze-http)
    const born = await act(A, { action: 'name', name: `facehttp${process.pid}` })
    ok(born.ok === true && born.star != null, 'Alice baptises a star')
    const star = String(born.star)

    const prep = await jpost('/api/kraynet/prepare', { action: 'set-face', from: A.addr, star })
    ok(!!prep.message && !prep.error, 'prepare set-face returns canonical message')

    const forged = await jpost('/api/kraynet/submit', {
      action: 'set-face', from: A.addr, star, nonce: prep.nonce,
      publicKey: M.pk, signature: _signKrayWallet(prep.message, M.sk), scheme: 'kraywallet',
    })
    ok(!!forged.error, 'forged set-face refused')

    const set = await act(A, { action: 'set-face', star })
    ok(set.ok === true, 'Alice set-face succeeds')

    const prof = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    ok(prof.face && String(prof.face.star) === star, 'profile.face = star #' + star)
    ok(prof.face && prof.face.name === `facehttp${process.pid}`, 'profile.face carries baptism name')

    const bobTry = await act(B, { action: 'set-face', star })
    ok(!!bobTry.error, 'Bob cannot wear Alice’s star')

    const send = await act(A, { action: 'sendstar', to: B.addr, star })
    ok(send.ok === true, 'Alice sends face star to Bob')
    const prof2 = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    ok(prof2.face == null, 'Alice face cleared after send')

    const bobSet = await act(B, { action: 'set-face', star })
    ok(bobSet.ok === true, 'Bob (new owner) sets the same star as face')
    const profB = await jget('/api/kraynet/profile/' + encodeURIComponent(B.addr))
    ok(profB.face && String(profB.face.star) === star, 'Bob profile.face is that star')

    const html = await fetch(BASE + '/u/' + encodeURIComponent(A.addr)).then((r) => r.text())
    ok(html.includes('set-face') && html.includes('clear-face') && html.includes('paintCitizenFace'), 'profile page chrome includes set-face + clear-face')

    // reboot: face re-derives from journal
    child.kill('SIGKILL')
    await sleep(200)
    child = await boot()
    const profR = await jget('/api/kraynet/profile/' + encodeURIComponent(B.addr))
    ok(profR.face && String(profR.face.star) === star, 'after reboot Bob still wears the face (journal replay)')
    const profAR = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    ok(profAR.face == null, 'after reboot Alice still has no face')

    done(fail ? 1 : 0)
  } catch (e) {
    console.error(e)
    done(1)
  }
}
main()
