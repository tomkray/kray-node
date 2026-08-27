/**
 * GATE 3c — TWO HOUSES, ONE ROLE. Prove by breaking:
 *   node src/test/folder-two-houses.test.ts
 *
 * A disposable HTTP regtest node. Two unrelated keys. Neither is allow-listed.
 *   H-01  a house with 0 ₭ fails preflight (A2 — do not forge)
 *   H-02  house A and house B both pass preflight (same role, two keys)
 *   H-03  house A lands the proven breath (existing Groth16 artifact — no second forge)
 *   H-04  house B's copy of the same seal is REFUSED as stale, not as "not the folder"
 *   H-05  the journal names A's address as the sealer — B was never privileged, never banned
 *
 * This is the second-house brick: the folder is a role. A missing ₭ is a HALT
 * before compute. A second key is not a second writer.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as btc from '@scure/btc-signer'
import { NETWORKS, _generateKeyPair, _hexToBytes, _signKrayWallet, toBtcNet } from '../protocol/scheme.ts'
import { folderPreflight } from '../../../../scripts/folder/preflight.mjs'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
const PORT = 4502
const BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-folder-houses-${process.pid}`)
const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = join(HERE, '../../../kray-net/server.mjs')

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.error('  ✗ FAIL — ' + m) } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string) => fetch(BASE + p).then((r) => r.json())
const jpost = (p: string, body: unknown) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json())

function wallet(seedDomain: string, tag: string) {
  const sk = createHash('sha256').update(seedDomain + '|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { sk, pk: publicKeyHex, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address!, hex: Buffer.from(sk).toString('hex') }
}
const A = wallet('tk-fold-vectors', 'A')
const HOUSE_A = wallet('folder-two-houses', 'A')
const HOUSE_B = wallet('folder-two-houses', 'B')
const POOR = wallet('folder-two-houses', 'poor')

interface Vector { name: string; expected: { preRoot: string; postRoot: string; diffsHash: string; diffs: { balances: Array<[string, string]>; nonces: Array<[string, number]> } } }
const V2 = (JSON.parse(readFileSync(join(HERE, 'vectors', 'tk-fold.golden.json'), 'utf8')) as Vector[])[1]
const artifact = JSON.parse(readFileSync(join(HERE, '../../../kray-fold/proofs/fold-groth16-v2.json'), 'utf8')) as { proof: string; publicValues: string }
const sealFields = () => ({
  foldPre: V2.expected.preRoot, foldPost: V2.expected.postRoot, foldDiffsHash: V2.expected.diffsHash,
  foldDiffs: V2.expected.diffs, foldProof: artifact.proof, foldPublic: artifact.publicValues,
})

function boot() {
  return spawn('node', [SERVER], {
    env: {
      ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET,
      KRAY_TRUSTED_DEV: '1',
      KRAY_LAB_X_SEQ: '1', KRAY_LAB_TK_FOLD_SEQ: '1', KRAY_LAB_SAME_INSTANT_SEQ: '1',
    },
    stdio: 'ignore',
  })
}
async function waitUp() {
  for (let i = 0; i < 100; i++) { try { const h = await jget('/health'); if (h && h.ok) return } catch { /* booting */ } await sleep(80) }
  throw new Error('folder-two-houses: node did not answer /health')
}
type W = ReturnType<typeof wallet>
async function act(w: W, body: Record<string, unknown>) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: w.addr })
  if (typeof prep.message !== 'string') return { ok: false, error: 'prepare failed: ' + (prep.error || '?') }
  return jpost('/api/kraynet/submit', { ...body, from: w.addr, nonce: prep.nonce, publicKey: w.pk, signature: _signKrayWallet(prep.message, w.sk), scheme: 'kraywallet' })
}

async function main() {
  console.log('\n╔═ GATE 3c — two houses, one role; the folder is not a person ═╗\n')
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  let child = boot()
  process.on('exit', () => { try { child.kill('SIGKILL') } catch { /* gone */ } })
  try {
    await waitUp()
    ok(true, 'disposable node up with the lane live from seq 1')

    const dA = await jpost('/api/kraynet/donate', { to: A.addr, sats: '200' })
    const dHa = await jpost('/api/kraynet/donate', { to: HOUSE_A.addr, sats: '10' })
    const dHb = await jpost('/api/kraynet/donate', { to: HOUSE_B.addr, sats: '10' })
    ok(dA.ok && dHa.ok && dHb.ok, 'citizen A funded; two folder houses funded (10 ₭ each); the poor house is unfunded')

    const poor = await folderPreflight({ nodeUrl: BASE, sk: POOR.hex, requireForge: false })
    ok(poor.ok === false && poor.errors.some((e) => /1 ₭|holds 0/.test(e)), 'H-01 a house with 0 ₭ fails preflight — do not forge')

    const noSk = await folderPreflight({ nodeUrl: BASE, sk: '', requireForge: false })
    ok(noSk.ok === false && noSk.errors.some((e) => /KRAY_FOLDER_SK/.test(e)), 'no key is not a folder — fail-closed')

    const pa = await folderPreflight({ nodeUrl: BASE, sk: HOUSE_A.hex, requireForge: false })
    const pb = await folderPreflight({ nodeUrl: BASE, sk: HOUSE_B.hex, requireForge: false })
    ok(pa.ok && pb.ok && pa.from === HOUSE_A.addr && pb.from === HOUSE_B.addr,
      'H-02 house A and house B both pass preflight — two keys, one role')
    ok(pa.from !== pb.from, 'the two houses are distinct addresses (no hidden singleton)')

    const burn = await act(A, { action: 'burn', amount: '100' })
    ok(!burn.error, 'citizen burned 100 ₭ → 100 Ӿ')
    const enter = await act(A, { action: 'lane-enter', amount: '100' })
    ok(!enter.error, 'lane-enter — golden V2 pre state')

    const sealA = await act(HOUSE_A, { action: 'fold-seal', ...sealFields() })
    ok(!sealA.error, 'H-03 house A landed the breath' + (sealA.error ? ' — ' + sealA.error : ''))

    const sealB = await act(HOUSE_B, { action: 'fold-seal', ...sealFields() })
    ok(typeof sealB.error === 'string' && /does not chain/.test(sealB.error),
      'H-04 house B is refused as STALE, not as an unofficial folder: ' + (sealB.error || 'accepted?!'))
    ok(!/folder|allow|official|permission/i.test(String(sealB.error)),
      'the refusal does not name a privileged folder')

    const lines = readFileSync(join(DATA, `kraynet-journal-${NET}.jsonl`), 'utf8').trim().split('\n')
    const seals = lines.map((l) => JSON.parse(l) as KrayEvent).filter((e) => e.kind === 'fold-seal')
    ok(seals.length === 1 && seals[0].from === HOUSE_A.addr,
      'H-05 the journal names house A as the sealer — whoever paid 1 ₭, not an allow-list')

    console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — two houses, one role. Ӿ\n`)
    return done(fail ? 1 : 0)
  } catch (e) {
    console.error('folder-two-houses crashed: ' + (e instanceof Error ? e.stack || e.message : String(e)))
    return done(1)
  }
  function done(code: number) {
    try { child.kill('SIGKILL') } catch { /* gone */ }
    rmSync(DATA, { recursive: true, force: true })
    process.exit(code)
  }
}
main()
