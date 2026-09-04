/**
 * KRAY PLATE HTTP — disposable door: prepare → sign → submit → profile.krayPlate → clear · transfer.
 *   node src/test/kray-plate-http.test.ts
 *
 * Does not touch Signet / live journals. Fresh data dir; kills the child after.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as btc from '@scure/btc-signer'
import { NETWORKS, _generateKeyPair, _hexToBytes, _signKrayWallet, toBtcNet } from '../protocol/scheme.ts'
import { encodeKrayPlate, hashKrayPlate } from '../protocol/kray-plate.ts'

const NET = 'regtest'
const PORT = 4499
const BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-krayplate-http-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m); return } fail++; console.error('  ✗ ' + m) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string) => fetch(BASE + p).then((r) => r.json())
const jpost = (p: string, body: unknown) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json())

function wallet(tag: string) {
  const sk = createHash('sha256').update(`krayplate-http|${tag}|${process.pid}`).digest()
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
  return { ...sub, star: sub.star ?? prep.star, plateHash: prep.plateHash }
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
  throw new Error('kray-plate-http: node did not answer /health')
}

async function main() {
  console.log('\n╔═ KRAY PLATE HTTP — prepare · atlas · submit · profile · clear ═╗\n')
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

    const born = await act(A, { action: 'name', name: `platehttp${process.pid}` })
    ok(born.ok === true && born.star != null, 'Alice baptises a star')
    const star = String(born.star)

    const fields = {
      description: 'Plate on the book',
      url: 'https://example.com',
      bannerUrl: 'https://example.com/promo',
    }
    const wantHash = hashKrayPlate(fields)
    const plate = { action: 'set-kray-plate', ...fields }

    const prep = await jpost('/api/kraynet/prepare', { ...plate, from: A.addr })
    ok(!!prep.message && !prep.error, 'prepare set-kray-plate returns canonical message')
    ok(prep.plateHash === wantHash, 'prepare plateHash matches encode/hash')
    ok(prep.fee === '1', 'prepare quotes exactly 1 ₭')
    ok(prep._plateBuf == null, 'prepare does not leak plate bytes to the client')

    const forged = await jpost('/api/kraynet/submit', {
      ...plate, from: A.addr, nonce: prep.nonce,
      publicKey: M.pk, signature: _signKrayWallet(prep.message, M.sk), scheme: 'kraywallet',
    })
    ok(!!forged.error, 'forged set-kray-plate refused')

    const httpTry = await act(A, { ...plate, url: 'http://insecure.example' })
    ok(!!httpTry.error, 'http (non-https) site URL refused')

    const before = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    const bal0 = BigInt(String(before.balance || '0'))

    const set = await act(A, plate)
    ok(set.ok === true, 'Alice set-kray-plate succeeds')

    const atlasPath = join(DATA, 'content', wantHash)
    ok(existsSync(atlasPath), 'atlas holds plate bytes under sealed hash')
    ok(Buffer.compare(readFileSync(atlasPath), encodeKrayPlate(fields)) === 0, 'atlas bytes == canonical encode')

    const prof = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    ok(prof.krayPlate && prof.krayPlate.hash === wantHash, 'profile.krayPlate.hash')
    ok(prof.krayPlate && prof.krayPlate.held === true, 'profile.krayPlate.held')
    ok(prof.krayPlate && prof.krayPlate.description === fields.description, 'profile.krayPlate.description')
    ok(prof.krayPlate && prof.krayPlate.url === fields.url, 'profile.krayPlate.url')
    ok(BigInt(String(prof.balance || '0')) === bal0 - 1n, 'exactly 1 ₭ spent')

    const same = await act(A, plate)
    ok(!!same.error && /identical|unchanged/i.test(String(same.error)), 'identical plate refused (hygiene)')

    const rotated = { action: 'set-kray-plate', description: 'Rotated plate', url: 'https://a.example', bannerUrl: '' }
    const rot = await act(A, rotated)
    ok(rot.ok === true, 'Alice rotates plate')
    const want2 = hashKrayPlate({ description: 'Rotated plate', url: 'https://a.example', bannerUrl: '' })
    const prof2 = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    ok(prof2.krayPlate && prof2.krayPlate.hash === want2, 'tip plate is the rotated hash')

    const starPlate = {
      action: 'set-kray-plate', star,
      description: 'Star plate', url: 'https://star.example', bannerUrl: '',
    }
    const ss = await act(A, starPlate)
    ok(ss.ok === true, 'Alice seals star plate')

    const bobSteal = await act(B, starPlate)
    ok(!!bobSteal.error, 'Bob cannot seal Alice’s star plate')

    const send = await act(A, { action: 'sendstar', to: B.addr, star })
    ok(send.ok === true, 'Alice sends star to Bob')
    // Address plate must survive; star plate must clear (no toxic inherit).
    const prof3 = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    ok(prof3.krayPlate && prof3.krayPlate.hash === want2, 'address plate survives star send')

    const clear = await act(A, { action: 'set-kray-plate', clear: true })
    ok(clear.ok === true, 'Alice clears address plate')
    const prof4 = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    ok(prof4.krayPlate == null, 'profile.krayPlate gone after clear')

    const clear2 = await act(A, { action: 'set-kray-plate', clear: true })
    ok(!!clear2.error && /unchanged|nothing/i.test(String(clear2.error)), 'clear with nothing to clear refused')

    // Optional act block — invitation only; settle with existing transfer (not a paper).
    const tipFields = {
      description: 'Support the work',
      url: '',
      bannerUrl: '',
      actTo: A.addr,
      actHint: 'gift',
      actAmount: '2',
    }
    const tipHash = hashKrayPlate(tipFields)
    const tip = await act(A, { action: 'set-kray-plate', ...tipFields })
    ok(tip.ok === true, 'Alice seals plate with act invitation')
    const tipProf = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    ok(tipProf.krayPlate && tipProf.krayPlate.hash === tipHash, 'profile tip hash with act')
    ok(tipProf.krayPlate && tipProf.krayPlate.actTo === A.addr, 'profile exposes actTo')
    ok(tipProf.krayPlate && tipProf.krayPlate.actHint === 'gift', 'profile exposes actHint')

    const balB0 = BigInt(String((await jget('/api/kraynet/profile/' + encodeURIComponent(B.addr))).balance || '0'))
    const balA0 = BigInt(String((await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))).balance || '0'))
    const pay = await act(B, { action: 'transfer', to: A.addr, amount: '2' })
    ok(pay.ok === true, 'Bob settles plate act via transfer')
    const tipProf2 = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))
    const tipProfB = await jget('/api/kraynet/profile/' + encodeURIComponent(B.addr))
    ok(BigInt(String(tipProf2.balance || '0')) === balA0 + 2n, 'Alice received act amount')
    ok(BigInt(String(tipProfB.balance || '0')) === balB0 - 2n - 1n, 'Bob paid amount + 1 ₭ fee')

    const junkAct = await act(A, {
      action: 'set-kray-plate', description: 'x', url: '', bannerUrl: '',
      actTo: '', actHint: 'like', actAmount: '',
    })
    ok(!!junkAct.error, 'actHint without actTo refused at door')

    done(fail ? 1 : 0)
  } catch (e) {
    console.error(e)
    done(1)
  }
}
main()
