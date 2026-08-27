/**
 * STAR FREEZE — live door on a disposable HTTP node, then reboot.
 *   node src/test/star-freeze-http.test.ts
 *
 * Parallel freeze, race, dead mouth, speak refused, register exact.
 * Does not touch Signet.
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
const PORT = 4495
const BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-freeze-http-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const HOLE = 'KRAY_BLACK_HOLE'
const N = 10

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; return } fail++; console.error('  ✗ ' + m) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string) => fetch(BASE + p).then((r) => r.json())
const jpost = (p: string, body: unknown) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json())

function wallet(tag: string) {
  const sk = createHash('sha256').update(`freeze-http|${tag}|${process.pid}`).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { tag, sk, pk: publicKeyHex, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address! }
}
type W = ReturnType<typeof wallet>

async function act(w: W, body: Record<string, unknown>) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: w.addr })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)), _prep: prep, star: prep.star }
  const sub = await jpost('/api/kraynet/submit', {
    ...body, from: w.addr, code: prep.code || body.code, nonce: prep.nonce, clock: prep.clock,
    publicKey: w.pk, signature: _signKrayWallet(prep.message, w.sk), scheme: 'kraywallet',
  })
  return { ...sub, star: sub.star ?? prep.star, _address: sub.address }
}

async function view() {
  const s = await jget('/api/kraynet/supply')
  const a = await jget('/api/kraynet/analytics')
  return { supply: s, fire: s.fire || a.blackHole?.fire, bh: a.blackHole, chain: a.chain }
}

async function boot() {
  const child = spawn('node', [SERVER], {
    env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_TRUSTED_DEV: '1' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 80; i++) {
    try { const h = await jget('/health'); if (h && h.ok) return child } catch { /* coming up */ }
    await sleep(80)
  }
  try { child.kill('SIGKILL') } catch { /* already dead */ }
  throw new Error('freeze-http: node did not answer /health')
}

async function main() {
  console.log('\n╔═ STAR FREEZE HTTP — parallel ice · race · dead mouth · reboot ═╗\n')
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
    const eve = wallet('eve')
    for (const w of [...wallets, eve]) {
      const d = await jpost('/api/kraynet/donate', { to: w.addr, sats: '400' })
      ok(d.ok === true, `mint → ${w.tag}`)
    }

    const born = await Promise.all(wallets.map((w, i) =>
      act(w, { action: 'name', name: `ice${process.pid}${i}` })))
    const stars = born.map((r) => r.star).filter((s) => s != null)
    ok(born.every((r) => r.ok === true) && stars.length === N, `${N} faces born`)

    const lawA = await act(wallets[0], {
      action: 'contract', star: String(stars[0]),
      living: { flags: [{ name: 'alive', on: true }, { name: 'open', on: true }] },
    })
    const lawB = await act(wallets[1], {
      action: 'contract', star: String(stars[1]),
      living: { flags: [{ name: 'alive', on: true }, { name: 'open', on: true }] },
    })
    ok(lawA.ok && lawB.ok, 'two living laws sealed')
    const tip = await act(wallets[0], { action: 'transfer', to: lawA._address, amount: '8' })
    ok(tip.ok, '8 ₭ sat in the first pot')

    const before = await view()
    const burned0 = BigInt(before.fire.destroyed)
    ok(Number(before.bh.stars) === 0, 'nothing frozen yet')

    const toIce = stars.slice(0, 8)
    const iced = await Promise.all(toIce.map((no, i) =>
      act(wallets[i], { action: 'sendstar', to: HOLE, star: String(no) })))
    ok(iced.every((r) => r.ok === true), `parallel freeze of ${toIce.length} stars`)

    const after = await view()
    ok(Number(after.bh.stars) === 8, 'register counts 8 frozen stars')
    ok(BigInt(after.fire.destroyed) === burned0, 'the freeze swarm burned no extra ₭')
    ok((after.bh.frozen || []).every((s: { star: string }) => toIce.map(String).includes(String(s.star))),
      'every frozen row is one of the iced stars')
    for (const no of toIce) {
      const st = await jget('/api/kraynet/star/' + no)
      ok(st.owner === HOLE, `#${no} owner is the hole`)
      ok(!!st.name, `#${no} kept its name on the ice`)
    }
    const living = await jget('/api/kraynet/star/' + stars[8])
    ok(living.owner === wallets[8].addr, `#${stars[8]} is still living`)

    const raced = await Promise.all([
      act(wallets[8], { action: 'sendstar', to: HOLE, star: String(stars[8]) }),
      act(eve, { action: 'sendstar', to: HOLE, star: String(stars[8]) }),
    ])
    const wins = raced.filter((r) => r.ok === true).length
    const losses = raced.filter((r) => r.error).length
    ok(wins === 1 && losses === 1, 'race to freeze #8: exactly one winner')
    const racedStar = await jget('/api/kraynet/star/' + stars[8])
    ok(racedStar.owner === HOLE, 'the raced star ended at the hole')

    const steal = await act(eve, { action: 'sendstar', to: HOLE, star: String(stars[9]) })
    ok(!!steal.error, 'Eve cannot freeze a living star she does not hold')
    const again = await act(wallets[0], { action: 'sendstar', to: HOLE, star: String(stars[0]) })
    ok(!!again.error, 're-freeze is refused')
    const write = await act(wallets[0], { action: 'inscribe', star: String(stars[0]), content: 'no', contentType: 'text/plain' })
    ok(!!write.error, 'write on ice is refused')
    const collect = await act(wallets[0], { action: 'contract-call', contract: lawA._address, rule: 'collect', args: {} })
    ok(!!collect.error, 'collect after freeze is refused — the mouth is dead')
    const speak = await jget('/api/kraynet/speak?star=' + stars[0])
    ok(!!speak.error && /living mouth/i.test(String(speak.error)), 'speak on ice is refused')

    const pulse = await act(eve, { action: 'contract-call', contract: lawA._address, rule: 'pulse', args: {} })
    ok(pulse.ok === true, 'pulse on ice still breathes — public, not a mouth')

    const mid = await view()
    ok(Number(mid.bh.stars) === 9, 'register is 8 parallel + 1 race')
    ok(mid.chain.conserves === true, 'conserves after the attack wave')

    const page = await fetch(BASE + '/blackhole').then((r) => r.text())
    ok(/the freeze/.test(page), '/blackhole has the freeze tab')

    const frozenIds = (mid.bh.frozen || []).map((s: { star: string }) => String(s.star)).sort()
    child.kill('SIGKILL')
    await sleep(200)
    child = await boot()
    const reboot = await view()
    const rebootIds = (reboot.bh.frozen || []).map((s: { star: string }) => String(s.star)).sort()
    ok(Number(reboot.bh.stars) === 9, 'reboot freeze count exact')
    ok(JSON.stringify(rebootIds) === JSON.stringify(frozenIds), 'reboot freeze set byte-exact')
    ok(BigInt(reboot.fire.destroyed) === BigInt(mid.fire.destroyed), 'reboot burned exact')
    ok(reboot.chain.conserves === true, 'conserves after reboot')

    if (fail) {
      console.error(`\n✗ ${fail} failed · ${pass} passed — FREEZE HTTP BROKE\n`)
      done(1)
      return
    }
    console.log(`\n✓ ${pass} checks — parallel ice, exclusive race, dead mouth, reboot exact. ❄\n`)
    done(0)
  } catch (e) {
    console.error('freeze-http error:', e)
    done(1)
  }
}
main()
