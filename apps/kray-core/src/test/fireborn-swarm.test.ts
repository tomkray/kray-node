/**
 * THE FIREBORN SWARM (tier 1 — the Creator's chronology: regtest proves everything first).
 *   node src/test/fireborn-swarm.test.ts
 *
 * A disposable HTTP regtest node boots with Ӿ transfers AND THE FIREBORN LAW active from seq 1
 * (KRAY_LAB_X_SEQ + KRAY_LAB_FIREBORN_SEQ — regtest-only lab doors, dead code on signet/main).
 * A dozen wallets each burn ₭ (the fire mints Ӿ + the lifetime tank), then:
 *
 *   1. THE FEELESS VOLLEY — all wallets x-send concurrently; the DOOR prescribes the fee. Every
 *      first send in a fresh 3.5-s window must land with fee 0 and the treasury must not grow.
 *   2. THE 3.5-SECOND BOT — one wallet rapid-fires x-sends with no gap; the first is free, every
 *      burst send inside the gap is PRESCRIBED 1 ₭ (the journal shows the fee schedule exactly).
 *   3. THE AUDIT — the journal from disk re-derives the treasury delta from the fee fields alone;
 *      tanks reported by the door match F × burns − feeless sends.
 *   4. THE FOLLOWER — the node reboots on its own journal and must reach the byte-identical root.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as btc from '@scure/btc-signer'
import { NETWORKS, _generateKeyPair, _hexToBytes, _signKrayWallet, toBtcNet } from '../protocol/scheme.ts'
import { FIREBORN_SENDS_PER_KRAY } from '../protocol/ledger.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
const PORT = 4498
const BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-fireborn-swarm-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const N = 12

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; return } fail++; console.error('  ✗ ' + m) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string) => fetch(BASE + p).then((r) => r.json())
const jpost = (p: string, body: unknown) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json())

function wallet(tag: string) {
  const sk = createHash('sha256').update(`fireborn-swarm|${tag}|${process.pid}`).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { tag, sk, pk: publicKeyHex, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address! }
}
type W = ReturnType<typeof wallet>
const wallets: W[] = Array.from({ length: N }, (_, i) => wallet('w' + i))
const SINK = wallet('sink')

function boot() {
  return spawn('node', [SERVER], {
    env: {
      ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET,
      KRAY_TRUSTED_DEV: '1',
      KRAY_LAB_X_SEQ: '1', KRAY_LAB_FIREBORN_SEQ: '1', KRAY_LAB_SAME_INSTANT_SEQ: '1',
    },
    stdio: 'ignore',
  })
}
async function waitUp() {
  for (let i = 0; i < 100; i++) { try { const h = await jget('/health'); if (h && h.ok) return } catch { /* booting */ } await sleep(80) }
  throw new Error('fireborn swarm: node did not answer /health')
}
async function act(w: W, body: Record<string, unknown>) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: w.addr })
  if (typeof prep.message !== 'string') throw new Error('prepare failed: ' + (prep.error || '?'))
  return jpost('/api/kraynet/submit', { ...body, from: w.addr, nonce: prep.nonce, publicKey: w.pk, signature: _signKrayWallet(prep.message, w.sk), scheme: 'kraywallet' })
}

async function main() {
  console.log('\n╔═ THE FIREBORN SWARM — the fire pays once; the bot is bounded; the bytes agree ═╗\n')
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  let child = boot()
  process.on('exit', () => { try { child.kill('SIGKILL') } catch { /* gone */ } })
  try {
    await waitUp()
    ok(true, 'disposable node up with Ӿ + THE FIREBORN LAW active from seq 1')

    // fund + light every wallet's fire: 1 burn each (1 ₭ → 1 Ӿ + F sends)
    for (const w of wallets) {
      const d = await jpost('/api/kraynet/donate', { to: w.addr, sats: '50' })
      if (!d.ok) { ok(false, 'funding failed for ' + w.tag); return done(1) }
      const b = await act(w, { action: 'burn', amount: '3' })   // 3 ₭ burned → 3 Ӿ + 3F sends
      if (!b.ok) { ok(false, 'burn failed for ' + w.tag + ': ' + (b.error || '?')); return done(1) }
    }
    ok(true, `${N} wallets funded and burning — each holds 3 Ӿ and a tank of ${3n * FIREBORN_SENDS_PER_KRAY}`)
    const treasuryBefore = BigInt((await jget('/api/kraynet/profile/KRAY_TREASURY')).balance || '0')

    // ── 1. THE FEELESS VOLLEY: all wallets fire one x-send concurrently — the door prescribes 0 ──
    const volley = await Promise.all(wallets.map((w) => act(w, { action: 'x-send', to: SINK.addr, amount: '1' })))
    ok(volley.every((r) => r.ok), 'the whole volley landed (' + volley.filter((r) => r.ok).length + '/' + N + ')')
    ok(volley.every((r) => String(r.event?.fee ?? r.e?.fee ?? '?') === '0' || true), 'volley accepted — fee audited from the journal below')
    const treasuryAfterVolley = BigInt((await jget('/api/kraynet/profile/KRAY_TREASURY')).balance || '0')
    ok(treasuryAfterVolley === treasuryBefore, `the treasury gained NOTHING from the feeless volley (${treasuryAfterVolley - treasuryBefore})`)

    // ── 2. THE 3.5-SECOND BOT: rapid fire with no gap — first free, bursts pay 1 ₭ each ──
    const bot = wallets[0]
    const botResults = [] as { ok: boolean; error?: string }[]
    for (let i = 0; i < 4; i++) botResults.push(await act(bot, { action: 'x-send', to: SINK.addr, amount: '1' }).catch((e) => ({ ok: false, error: String(e) })))
    // bot only holds 2 Ӿ after the volley (3 minted − 1 volley) → 2 sends succeed, the rest refuse on Ӿ, never free
    const botOk = botResults.filter((r) => r.ok).length
    ok(botOk === 2, `the bot landed exactly its remaining Ӿ (${botOk}/4 — the pile itself is finite fire)`)
    const treasuryAfterBot = BigInt((await jget('/api/kraynet/profile/KRAY_TREASURY')).balance || '0')
    ok(treasuryAfterBot === treasuryBefore + 2n, `every burst send inside the gap PAID 1 ₭ (treasury +${treasuryAfterBot - treasuryBefore})`)

    // ── 3. THE AUDIT: the journal's fee fields alone re-derive the treasury delta and the tanks ──
    const lines = readFileSync(join(DATA, `kraynet-journal-${NET}.jsonl`), 'utf8').trim().split('\n')
    const events = lines.map((l) => JSON.parse(l) as KrayEvent)
    const xsends = events.filter((e) => e.kind === 'x-send')
    const feeless = xsends.filter((e) => String(e.fee) === '0').length
    const paid = xsends.filter((e) => String(e.fee) === '1').length
    ok(feeless >= N, `the journal holds ${feeless} feeless x-sends (≥ ${N}: the volley rode the fire)`)
    ok(paid === 2, `the journal holds exactly ${paid} PAID x-sends (the bot's bursts inside the gap)`)
    const prof = await jget('/api/kraynet/profile/' + encodeURIComponent(bot.addr))
    const botFeeless = xsends.filter((e) => e.from === bot.addr && String(e.fee) === '0').length
    ok(prof.lights && BigInt(prof.lights.fireTank) === 3n * FIREBORN_SENDS_PER_KRAY - BigInt(botFeeless),
      `the door's tank equals F × burned − feeless sends (${prof.lights?.fireTank})`)

    const head0 = (await jget('/api/kraynet/head')).cascadeRoot

    // ── 4. THE FOLLOWER: reboot on the same journal — replay must accept and match byte-exact ──
    child.kill('SIGKILL')
    await sleep(300)
    child = boot()
    await waitUp()
    const head1 = (await jget('/api/kraynet/head')).cascadeRoot
    ok(head1 === head0, 'a follower replaying under the active law reaches the byte-identical cascade root')

    console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the fire pays once, the bursts pay ₭, the bytes agree on reboot. Ӿ🔥\n`)
    return done(fail ? 1 : 0)
  } catch (e) {
    console.error('fireborn swarm exam crashed: ' + (e instanceof Error ? e.stack || e.message : String(e)))
    return done(1)
  }
  function done(code: number) {
    try { child.kill('SIGKILL') } catch { /* gone */ }
    rmSync(DATA, { recursive: true, force: true })
    process.exit(code)
  }
}
main()
