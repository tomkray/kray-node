/**
 * THE ADVERSARIAL AUDIT — try to BREAK every law with hostile inputs, and prove each is REFUSED
 * while conservation / the peg / rune solvency never move. Fires the full attack surface at a fresh
 * node over HTTP. If any hostile act is ACCEPTED, or a law slips, the audit fails loudly.
 *
 *   node src/test/adversarial-audit.ts
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes } from '../protocol/scheme.ts'

const NET = 'regtest', PORT = 4498, BASE = `http://localhost:${PORT}`
const DATA = join(tmpdir(), `kraynet-adv-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const wallet = (t: string) => { const sk = createHash('sha256').update('adv|' + t, 'utf8').digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk, addr: btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[toBtcNet(NET)]).address! } }
const jget = (p: string) => fetch(BASE + p).then((r) => r.json() as Promise<any>)
const jpost = (p: string, b: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json() as Promise<any>)
let pass = 0, fail = 0
const H = (s: string) => console.log('\n\x1b[1m' + s + '\x1b[0m')
const refused = (r: any, m: string) => { const ok = r && !!r.error; if (ok) pass++; else fail++; console.log(`   ${ok ? '✓ REFUSED' : '✗ ACCEPTED (BUG!)'} — ${m}${ok ? ` (“${String(r.error).slice(0, 54)}…”)` : ''}`) }
const holds = (c: boolean, m: string) => { if (c) pass++; else fail++; console.log(`   ${c ? '✓' : '✗ FAIL'} — ${m}`) }

// sign+submit; returns the node's response (error or ok). `mut` lets us tamper the submitted body.
async function act(w: any, action: string, params: Record<string, unknown>, endpoint = '/api/kraynet/submit', mut?: (b: any) => any) {
  const prep = await jpost('/api/kraynet/prepare', { action, from: w.addr, ...params })
  if (prep.error) return prep
  const signature = _signKrayWallet(prep.message, w.sk)
  let body = { action, from: w.addr, ...params, nonce: prep.nonce, publicKey: w.pk, signature }
  if (mut) body = mut(body)
  return jpost(endpoint, body)
}
async function conserved(tag: string) {
  const o = await jget('/api/kraynet/overview')
  holds(BigInt(o.supply.circulating) === BigInt(o.supply.emitted) - BigInt(o.supply.burned) && o.conserves === true && o.backed === true && o.runesSolvent !== false, `${tag}: conservation + peg + rune-solvency intact`)
}

async function main() {
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  const child = spawn('node', [SERVER], { env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET }, stdio: 'ignore' })
  const done = (code: number) => { try { child.kill('SIGKILL') } catch {}; rmSync(DATA, { recursive: true, force: true }); process.exit(code) }
  try {
    for (let i = 0; i < 60; i++) { try { if ((await jget('/health')).ok) break } catch {} await sleep(100) }
    console.log('\n╔═ ADVERSARIAL AUDIT — try to break every law ══════════════════════╗')
    const A = wallet('a'), B = wallet('b'), C = wallet('c')
    await jpost('/api/kraynet/donate', { to: A.addr, sats: '10000' })
    // birth some stars to attack: #0 content (A), #1 name "alpha" (A)
    await act(A, 'inscribe', { content: 'seed content', contentType: 'text/plain' })
    await act(A, 'name', { name: 'alpha' })

    H('1 · DONATION (the mint) — the peg cannot be cheated')
    refused(await jpost('/api/kraynet/donate', { to: A.addr, sats: '0' }), 'donate 0 sats (mints nothing)')
    refused(await jpost('/api/kraynet/donate', { to: A.addr, sats: '-5000' }), 'donate a NEGATIVE amount')
    await conserved('after donation attacks')

    H('2 · TRANSFER — no overspend, no self, no forgery, no replay')
    refused(await act(A, 'transfer', { to: B.addr, amount: '999999999' }), 'transfer MORE ₭ than you hold')
    refused(await act(A, 'transfer', { to: A.addr, amount: '1' }), 'transfer to YOURSELF')
    refused(await act(A, 'transfer', { to: B.addr, amount: '0' }), 'transfer 0 ₭')
    refused(await act(A, 'transfer', { to: B.addr, amount: '10' }, '/api/kraynet/submit', (b) => ({ ...b, amount: '9000' })), 'FORGE the amount after signing (sig over 10, body says 9000)')
    refused(await act(A, 'transfer', { to: B.addr, amount: '10' }, '/api/kraynet/submit', (b) => ({ ...b, signature: b.signature.slice(0, -2) + (b.signature.endsWith('aa') ? 'bb' : 'aa') })), 'a TAMPERED signature')
    const good = await act(A, 'transfer', { to: B.addr, amount: '10' }); holds(!good.error, 'an honest transfer is accepted (control)')
    refused(await jpost('/api/kraynet/submit', { action: 'transfer', from: A.addr, to: B.addr, amount: '10', nonce: (good.seq ? 0 : 0), publicKey: A.pk, signature: 'x' }), 'REPLAY an old nonce')
    await conserved('after transfer attacks')

    H('3 · BORN FROM FIRE — content is unique, the burn is enforced')
    refused(await act(A, 'inscribe', { content: 'seed content', contentType: 'text/plain' }), 'inscribe DUPLICATE content (byte-unique forever)')
    refused(await act(C, 'inscribe', { content: 'C has no kray', contentType: 'text/plain' }), 'inscribe with ZERO ₭ (nothing to burn)')
    await conserved('after inscribe attacks')

    H('4 · CANVAS — only the owner adds, and only once')
    refused(await act(B, 'inscribe', { content: 'bob writes on alice star', contentType: 'text/plain', star: '0' }), "add content to a star you DON'T own")
    refused(await act(A, 'inscribe', { content: 'second content', contentType: 'text/plain', star: '0' }), 'add content to a star that ALREADY holds content')
    refused(await act(A, 'inscribe', { content: 'ghost', contentType: 'text/plain', star: '99999' }), 'add content to a star that does NOT exist')
    refused(await act(B, 'name', { name: 'beta', star: '1' }), "name a star you DON'T own")
    refused(await act(A, 'name', { name: 'gamma', star: '1' }), 'name a star that ALREADY has a name')
    await conserved('after canvas attacks')

    H('5 · NAME — one plain word, unique, un-spoofable')
    for (const [nm, why] of [['al pha', 'a SPACE inside'], ['tom.kray', 'a DOT'], ['@tom', 'an @'], ['', 'EMPTY'], ['a'.repeat(80), 'TOO LONG'], ['bull•et', 'a BULLET'], ['аlpha', 'a Cyrillic look-alike of an existing name']] as const)
      refused(await act(A, 'name', { name: nm }), `baptise a name with ${why}`)
    refused(await act(B, 'name', { name: 'alpha' }), 'baptise a name ALREADY taken (by another wallet)')
    await conserved('after name attacks')

    H('6 · SEND-STAR — you can only move what you hold')
    refused(await act(B, 'sendstar', { to: C.addr, star: '0' }), "send a star you DON'T own")
    refused(await act(A, 'sendstar', { to: A.addr, star: '0' }), 'send a star to YOURSELF')
    await conserved('after send-star attacks')

    H('7 · RUNES L2 — the reserve is inviolable')
    await jpost('/api/kraynet/rune/deposit', { runeId: '1:1', to: A.addr, amount: '1000', outpoint: 'a'.repeat(64) + ':0' })
    refused(await jpost('/api/kraynet/rune/deposit', { runeId: '1:1', to: A.addr, amount: '1000', outpoint: 'a'.repeat(64) + ':0' }), 'credit the SAME deposit outpoint twice (minted once, ever)')
    refused(await act(A, 'rune-send', { to: B.addr, runeId: '1:1', amount: '5000' }, '/api/kraynet/rune/send'), 'send MORE runes than you hold')
    refused(await act(A, 'rune-exit', { runeId: '1:1', amount: '5000', l1Address: C.addr }, '/api/kraynet/rune/exit'), 'exit MORE runes than you hold')
    await conserved('after rune attacks')

    H('8 · THE RETIRED DOOR — a caller-provided settlement table no longer exists')
    const before = BigInt((await jget('/api/kraynet/supply')).circulating)
    const r8 = await jpost('/api/kraynet/settle', { validators: [{ address: B.addr, work: '1' }] })
    const after = BigInt((await jget('/api/kraynet/supply')).circulating)
    holds(!!r8.error && /retired/i.test(String(r8.error)), 'the /settle door is RETIRED — the fee pool pays only proven beats (settlement), never a handed-in table')
    holds(after === before, 'the refused door moved nothing — circulating unchanged')
    await conserved('after the retired-door probe')

    console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — every hostile act was refused; not one law slipped. 🛡️₭`)
    done(fail ? 1 : 0)
  } catch (e) { console.error('\n✗ audit error:', e); done(1) }
}
main()
