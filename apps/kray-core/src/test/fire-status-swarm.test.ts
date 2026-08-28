/**
 * FIRE / FREEZE SWARM — prove the two sinks under hostility, then reboot.
 *   node src/test/fire-status-swarm.test.ts
 *
 * Disposable HTTP regtest node. Stars freeze. Fungible ₭ burns.
 * Conservation after every batch. Cascade + fire tallies byte-exact on reboot.
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
const PORT = 4494
const BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-fire-swarm-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const HOLE = 'KRAY_BLACK_HOLE'
const N = 8

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; return } fail++; console.error('  ✗ ' + m) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string) => fetch(BASE + p).then((r) => r.json())
const jpost = (p: string, body: unknown) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json())

function wallet(tag: string) {
  const sk = createHash('sha256').update(`fire-swarm|${tag}|${process.pid}`).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { tag, sk, pk: publicKeyHex, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address! }
}
type W = ReturnType<typeof wallet>

async function act(w: W, body: Record<string, unknown>) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: w.addr })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)), _prep: prep }
  return jpost('/api/kraynet/submit', {
    ...body, from: w.addr, code: prep.code || body.code, nonce: prep.nonce, clock: prep.clock,
    publicKey: w.pk, signature: _signKrayWallet(prep.message, w.sk), scheme: 'kraywallet',
  })
}

async function fireOf() {
  const s = await jget('/api/kraynet/supply')
  const a = await jget('/api/kraynet/analytics')
  return {
    supply: s,
    fire: s.fire || a.blackHole?.fire,
    bh: a.blackHole,
    chain: a.chain,
    circulating: BigInt(s.circulating || '0'),
    emitted: BigInt(s.emitted || '0'),
    burned: BigInt(s.burned || '0'),
  }
}

function snap(f: Awaited<ReturnType<typeof fireOf>>) {
  return {
    destroyed: String(f.fire.destroyed),
    chosen: String(f.fire.chosen),
    total: String(f.fire.total),
    acts: Number(f.fire.acts),
    inscribe: String(f.fire.into.inscribe),
    name: String(f.fire.into.name),
    law: String(f.fire.into.law),
    frozen: Number(f.bh.stars),
    circulating: f.circulating.toString(),
    burned: f.burned.toString(),
    emitted: f.emitted.toString(),
  }
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
  throw new Error('fire-swarm: node did not answer /health')
}

async function main() {
  console.log('\n╔═ FIRE / FREEZE SWARM — inscribe · hole · forge · reboot ═╗\n')
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
      ok(d.ok === true, `mint 400 ₭ → ${w.tag}`)
    }

    const before = await fireOf()
    ok(before.chain.conserves === true, 'conserves before the storm')
    ok(before.fire.tallyMatches === true, 'tally matches ledger before the storm')
    ok(BigInt(before.fire.destroyed) === before.burned, 'fire.destroyed is ledger.totalBurned')
    ok(BigInt(before.fire.total) === before.burned + BigInt(before.fire.chosen), 'fire.total = destroyed + chosen')

    // ── swarm: 8 unique inscriptions in parallel ──
    const born = await Promise.all(wallets.map((w, i) =>
      act(w, { action: 'inscribe', content: `fire-art-${process.pid}-${i}`, contentType: 'text/plain' })))
    const stars = born.map((r) => r.star).filter((s) => s != null)
    ok(born.every((r) => r.ok === true) && stars.length === N, `swarm inscribed ${N} unique works`)

    const afterIns = await fireOf()
    ok(afterIns.burned === before.burned + BigInt(N), `destroyed advanced by ${N}`)
    ok(BigInt(afterIns.fire.into.inscribe) === BigInt(before.fire.into.inscribe) + BigInt(N), 'into.inscribe counts the swarm')
    ok(Number(afterIns.bh.stars) === 0, 'an inscribed star is NOT frozen')
    ok((afterIns.bh.frozen || []).length === 0, 'freeze register empty after inscriptions')
    ok(!(afterIns.fire.log || []).some((x: { kind: string }) => x.kind === 'chosen'), 'no chosen-send in the fire log yet')
    ok(afterIns.fire.tallyMatches === true, 'tally matches after the inscription swarm')
    ok(afterIns.circulating === afterIns.emitted - afterIns.burned, 'circulating = emitted − burned after inscriptions')

    // ── baptisms + one law (more fire, still no freeze) ──
    const named = await act(wallets[0], { action: 'name', name: `fw${process.pid}a`, star: String(stars[0]) })
    const law = await act(wallets[1], {
      action: 'contract', star: String(stars[1]),
      living: { flags: [{ name: 'alive', on: true }, { name: 'open', on: true }] },
    })
    ok(named.ok === true, 'baptism burned 1 ₭ into a living star')
    ok(law.ok === true, 'v2 law burned 1 ₭ onto a living star')
    const afterLaw = await fireOf()
    ok(afterLaw.burned === afterIns.burned + 2n, 'name + law each destroyed 1 ₭')
    ok(BigInt(afterLaw.fire.into.name) === BigInt(afterIns.fire.into.name) + 1n, 'into.name advanced')
    ok(BigInt(afterLaw.fire.into.law) === BigInt(afterIns.fire.into.law) + 1n, 'into.law advanced')
    ok(Number(afterLaw.bh.stars) === 0, 'a baptised / law star is still living — not frozen')

    // ── THE BURN LAW: fungible ₭ can never reach the hole — the chosen path is now the signed burn ──
    const circ0 = afterLaw.circulating
    const burned0 = afterLaw.burned
    const send = await act(wallets[2], { action: 'transfer', to: HOLE, amount: '7' })
    ok(send.ok !== true && /cannot be frozen|only burned/i.test(String(send.error || '')), '₭ → hole REFUSED: "₭ cannot be frozen — only burned" (the ratified law)')
    const afterChosen = await fireOf()
    ok(afterChosen.burned === burned0, 'the refusal burned nothing (state byte-identical)')
    ok(afterChosen.circulating === circ0, 'the refusal moved nothing — circulating intact')
    ok(BigInt(afterChosen.fire.chosen) === BigInt(afterLaw.fire.chosen), 'fire.chosen did NOT advance — the freeze path is sealed for ₭')
    ok(BigInt(afterChosen.fire.total) === afterChosen.burned + BigInt(afterChosen.fire.chosen), 'total still destroyed + chosen (the historical chosen stays counted)')
    ok(!(afterChosen.fire.log || []).some((x: { kind: string; amount: string }) => x.kind === 'chosen' && x.amount === '7'),
      'no new chosen entry in the fire log — the law held at the door AND the reducer')

    // ── freeze: one written star goes to the hole ──
    const freeze = await act(wallets[3], { action: 'sendstar', to: HOLE, star: String(stars[3]) })
    ok(freeze.ok === true, `star #${stars[3]} frozen`)
    const afterFreeze = await fireOf()
    ok(Number(afterFreeze.bh.stars) === 1, 'exactly one star is frozen')
    ok((afterFreeze.bh.frozen || []).some((s: { star: string }) => String(s.star) === String(stars[3])),
      'the freeze register names that star')
    ok(afterFreeze.burned === afterChosen.burned, 'freezing a star does not burn ₭')
    const frozenStar = await jget('/api/kraynet/star/' + stars[3])
    ok(frozenStar.owner === HOLE, 'ownerOf the frozen star is the hole')
    const living = await jget('/api/kraynet/star/' + stars[0])
    ok(living.owner === wallets[0].addr, 'a living star is not at the hole')

    // ── attacks: every refusal must leave fire + freeze + root untouched ──
    const root = afterFreeze.chain.cascadeRoot
    const pinned = snap(afterFreeze)

    const tamperPrep = await jpost('/api/kraynet/prepare', { action: 'transfer', from: eve.addr, to: HOLE, amount: '3' })
    const tamper = await jpost('/api/kraynet/submit', {
      action: 'transfer', from: eve.addr, to: HOLE, amount: '30', nonce: tamperPrep.nonce,
      publicKey: eve.pk, signature: _signKrayWallet(tamperPrep.message, eve.sk), scheme: 'kraywallet',
    })
    ok(!!tamper.error && /signature/i.test(String(tamper.error)), 'tampered chosen-send (3→30) is refused')

    const steal = await act(eve, { action: 'sendstar', to: HOLE, star: String(stars[0]) })
    ok(!!steal.error, 'stranger cannot freeze a star they do not hold')

    const twice = await act(wallets[3], { action: 'sendstar', to: HOLE, star: String(stars[3]) })
    ok(!!twice.error, 're-freeze of an already-frozen star is refused')

    const writeFrozen = await act(wallets[3], { action: 'name', name: `fw${process.pid}z`, star: String(stars[3]) })
    ok(!!writeFrozen.error, 'the original owner cannot write on a frozen star')

    const replay = await jpost('/api/kraynet/submit', {
      action: 'transfer', from: wallets[2].addr, to: HOLE, amount: '7', nonce: 0,
      publicKey: wallets[2].pk, signature: '00'.repeat(64), scheme: 'kraywallet',
    })
    ok(!!replay.error, 'garbage signature on a chosen-send is refused')

    const afterAtk = await fireOf()
    const now = snap(afterAtk)
    ok(afterAtk.chain.cascadeRoot === root, 'cascade root unchanged by every refused attack')
    ok(JSON.stringify(now) === JSON.stringify(pinned), 'fire + freeze + supply unchanged by every refused attack')
    ok(afterAtk.chain.conserves === true, 'conservation holds after the attack wave')

    // ── race: two more inscriptions at the same instant ──
    const raced = await Promise.all([
      act(wallets[4], { action: 'inscribe', content: `fire-race-a-${process.pid}`, contentType: 'text/plain' }),
      act(wallets[5], { action: 'inscribe', content: `fire-race-b-${process.pid}`, contentType: 'text/plain' }),
    ])
    ok(raced.every((r) => r.ok === true), 'two simultaneous inscriptions both applied')
    const afterRace = await fireOf()
    ok(afterRace.burned === afterAtk.burned + 2n, 'race burned exactly 2 ₭')
    ok(afterRace.fire.tallyMatches === true, 'tally matches after the race')
    ok(Number(afterRace.bh.stars) === 1, 'the race did not freeze anything')

    const page = await fetch(BASE + '/blackhole').then((r) => r.text())
    // pinned on the SINK DEFINITIONS (substance), not headline cosmetics — the compact-rail
    // chrome (70220f2) rephrased the headline and this pin went stale against a page that
    // still told the truth. Both sinks must stay named and distinguished.
    ok(/Fungible ₭ destroyed in the fire/.test(page) && /Star frozen in the black hole/.test(page), '/blackhole names both sinks')

    const beforeReboot = snap(afterRace)

    // ── reboot: same journal, same fire, same freeze ──
    child.kill('SIGKILL')
    await sleep(200)
    child = await boot()
    const afterReboot = await fireOf()
    ok(JSON.stringify(snap(afterReboot)) === JSON.stringify(beforeReboot),
      'reboot re-derives fire + freeze + supply byte-exact from the journal')
    ok(afterReboot.fire.tallyMatches === true, 'tally still matches after reboot')
    ok(afterReboot.chain.conserves === true, 'conservation holds after reboot')
    const frozenAgain = await jget('/api/kraynet/star/' + stars[3])
    ok(frozenAgain.owner === HOLE, 'the frozen star is still at the hole after reboot')

    if (fail) {
      console.error(`\n✗ ${fail} failed · ${pass} passed — FIRE / FREEZE SWARM BROKE\n`)
      done(1)
      return
    }
    console.log(`\n✓ ${pass} checks — fire burns ₭, freeze holds stars, attacks mutate nothing, reboot is exact. 🔥\n`)
    done(0)
  } catch (e) {
    console.error('fire-swarm error:', e)
    done(1)
  }
}
main()
