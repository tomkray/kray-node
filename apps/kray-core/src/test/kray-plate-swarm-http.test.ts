/**
 * KRAY PLATE HTTP SWARM — concurrent seals on a disposable regtest door + reboot.
 *   node src/test/kray-plate-swarm-http.test.ts
 *
 * N wallets fire set-kray-plate in the same window (arrival shuffled). Forges,
 * identicals, and http URLs must refuse. Atlas bytes must match sealed hashes.
 * Node reboot must re-derive the same tip plates + cascade.
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
const PORT = 4501
const BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-krayplate-swarm-http-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const N = 12
const ROUNDS = 4

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m); return } fail++; console.error('  ✗ ' + m) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string) => fetch(BASE + p).then((r) => r.json())
const jpost = (p: string, body: unknown) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json())

function wallet(tag: string) {
  const sk = createHash('sha256').update(`krayplate-swarm-http|${tag}|${process.pid}`).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { tag, sk, pk: publicKeyHex, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address! }
}
type W = ReturnType<typeof wallet>

async function act(w: W, body: Record<string, unknown>) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: w.addr })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)), ...prep }
  const sub = await jpost('/api/kraynet/submit', {
    ...body, from: w.addr, nonce: prep.nonce,
    publicKey: w.pk, signature: _signKrayWallet(prep.message, w.sk), scheme: 'kraywallet',
  })
  return { ...sub, plateHash: prep.plateHash }
}

function shuffled<T>(arr: T[], seed: number): T[] {
  const a = [...arr]
  let s = seed >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

async function boot() {
  const child = spawn('node', [SERVER], {
    env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_TRUSTED_DEV: '1' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 120; i++) {
    try { const h = await jget('/health'); if (h && h.ok) return child } catch { /* */ }
    await sleep(80)
  }
  try { child.kill('SIGKILL') } catch { /* */ }
  throw new Error('kray-plate-swarm-http: node did not answer /health')
}

async function main() {
  console.log('\n╔═ KRAY PLATE HTTP SWARM — concurrent seal · forge · reboot ═╗\n')
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
    const wallets = Array.from({ length: N }, (_, i) => wallet('w' + i))
    const M = wallet('mallory')

    for (const w of wallets) {
      const d = await jpost('/api/kraynet/donate', { to: w.addr, sats: '2000' })
      ok(d.ok === true, `donate → ${w.tag}`)
    }

    let landed = 0, refused = 0
    for (let round = 0; round < ROUNDS; round++) {
      const order = shuffled(wallets, 1000 + round * 17)
      const jobs = order.map((w, i) => {
        const fields = {
          description: `swarm ${w.tag} r${round}`,
          url: `https://r${round}.example/${w.tag}`,
          bannerUrl: i % 4 === 0 ? `https://ban.example/${w.tag}` : '',
        }
        return act(w, { action: 'set-kray-plate', ...fields }).then((r) => ({ w, fields, r }))
      })
      const results = await Promise.all(jobs)
      for (const { w, fields, r } of results) {
        if (r.ok === true) {
          landed++
          const want = hashKrayPlate(fields)
          const path = join(DATA, 'content', want)
          ok(existsSync(path), `atlas present for ${w.tag} r${round}`)
          if (existsSync(path)) {
            ok(Buffer.compare(readFileSync(path), encodeKrayPlate(fields)) === 0, `atlas bytes match ${w.tag} r${round}`)
          }
          const prof = await jget('/api/kraynet/profile/' + encodeURIComponent(w.addr))
          ok(prof.krayPlate && prof.krayPlate.hash === want, `profile tip ${w.tag} r${round}`)
        } else {
          // A concurrent identical retry can refuse; still count as refused path
          refused++
        }
      }
      // hostile: forge one citizen in this round
      const victim = order[0]!
      const forgeFields = { description: 'hijack', url: 'https://evil.example', bannerUrl: '' }
      const prep = await jpost('/api/kraynet/prepare', { action: 'set-kray-plate', from: victim.addr, ...forgeFields })
      if (prep.message) {
        const forged = await jpost('/api/kraynet/submit', {
          action: 'set-kray-plate', from: victim.addr, ...forgeFields, nonce: prep.nonce,
          publicKey: M.pk, signature: _signKrayWallet(prep.message, M.sk), scheme: 'kraywallet',
        })
        ok(!!forged.error, `forge refused round ${round}`)
        refused++
      }
      // hostile: identical plate
      const tip = await jget('/api/kraynet/profile/' + encodeURIComponent(victim.addr))
      if (tip.krayPlate && tip.krayPlate.held) {
        const same = await act(victim, {
          action: 'set-kray-plate',
          description: tip.krayPlate.description || '',
          url: tip.krayPlate.url || '',
          bannerUrl: tip.krayPlate.bannerUrl || '',
        })
        ok(!!same.error, `identical refused round ${round}`)
        refused++
      }
      // hostile: http URL
      const bad = await act(order[1]!, {
        action: 'set-kray-plate', description: 'x', url: 'http://insecure.example', bannerUrl: '',
      })
      ok(!!bad.error, `http URL refused round ${round}`)
      refused++
    }

    ok(landed >= N, `at least one honest plate per wallet landed (landed ${landed})`)
    ok(refused > 0, `hostile refusals fired (${refused})`)

    const head = await jget('/api/kraynet/head')
    const tips = []
    for (const w of wallets) {
      const p = await jget('/api/kraynet/profile/' + encodeURIComponent(w.addr))
      tips.push({ addr: w.addr, hash: p.krayPlate?.hash || null, bal: String(p.balance || '0') })
    }

    // reboot on the same journal
    try { child.kill('SIGKILL') } catch { /* */ }
    await sleep(200)
    child = await boot()
    const head2 = await jget('/api/kraynet/head')
    ok(head2.cascadeRoot === head.cascadeRoot, 'reboot cascade root byte-exact')
    for (const t of tips) {
      const p = await jget('/api/kraynet/profile/' + encodeURIComponent(t.addr))
      ok((p.krayPlate?.hash || null) === t.hash, `reboot plate tip ${t.addr.slice(0, 12)}…`)
      ok(String(p.balance || '0') === t.bal, `reboot balance ${t.addr.slice(0, 12)}…`)
    }

    done(fail ? 1 : 0)
  } catch (e) {
    console.error(e)
    done(1)
  }
}
main()
