/**
 * THE TK-FOLD SWARM (tier 1 — the Creator's chronology: regtest proves everything first, LIVE).
 *   node src/test/tk-fold-swarm.test.ts
 *
 * A disposable HTTP regtest node boots with Ӿ transfers AND THE TK-FOLD active from seq 1
 * (KRAY_LAB_X_SEQ + KRAY_LAB_TK_FOLD_SEQ — regtest-only lab doors, dead code on signet/main).
 * The golden vectors' wallet A walks the LIVE door to the exact pre state of golden vector V2
 * (burn ₭ → Ӿ, lane-enter 100), and then the REAL committed Groth16 fold proof lands over HTTP:
 *
 *   1. THE ENTRY — donate → burn → lane-enter; the profile lights show the books change
 *   2. THE PROVEN BREATH — the fold-seal (real proof, real diffs) is accepted by the live door
 *   3. THE WALLS — a second landing refuses (stale), a tampered proof refuses, all over HTTP
 *   4. THE EXIT — lane-exit returns Ӿ to the spendable book; lights agree
 *   5. THE FOLLOWER — the node reboots on its own journal: the replay RE-VERIFIES the Groth16
 *      proof from bytes alone and reaches the byte-identical cascade root
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as btc from '@scure/btc-signer'
import { NETWORKS, _generateKeyPair, _hexToBytes, _signKrayWallet, toBtcNet } from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
const PORT = 4499
const BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-tk-fold-swarm-${process.pid}`)
const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = join(HERE, '../../../kray-net/server.mjs')

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.error('  ✗ FAIL — ' + m) } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string) => fetch(BASE + p).then((r) => r.json())
const jpost = (p: string, body: unknown) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json())

// the golden vectors' wallet A — the SAME derivation, so the live lane reaches V2's exact pre state
function wallet(seedDomain: string, tag: string) {
  const sk = createHash('sha256').update(seedDomain + '|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { sk, pk: publicKeyHex, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address! }
}
const A = wallet('tk-fold-vectors', 'A')
const FOLDER = wallet('tk-fold-swarm', 'folder')

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
  throw new Error('tk-fold swarm: node did not answer /health')
}
type W = ReturnType<typeof wallet>
async function act(w: W, body: Record<string, unknown>) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: w.addr })
  if (typeof prep.message !== 'string') return { ok: false, error: 'prepare failed: ' + (prep.error || '?') }
  return jpost('/api/kraynet/submit', { ...body, from: w.addr, nonce: prep.nonce, publicKey: w.pk, signature: _signKrayWallet(prep.message, w.sk), scheme: 'kraywallet' })
}
const lightsOf = async (addr: string) => (await jget('/api/kraynet/profile/' + encodeURIComponent(addr))).lights as { xSpendable: string; laneX: string }

async function main() {
  console.log('\n╔═ THE TK-FOLD SWARM — the real fold proof crosses the LIVE regtest door ═╗\n')
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  let child = boot()
  process.on('exit', () => { try { child.kill('SIGKILL') } catch { /* gone */ } })
  try {
    await waitUp()
    ok(true, 'disposable node up with Ӿ + THE TK-FOLD active from seq 1')

    // ── 1. THE ENTRY: consensus walks to golden V2's exact pre state, over HTTP ──
    const d1 = await jpost('/api/kraynet/donate', { to: A.addr, sats: '200' })
    const d2 = await jpost('/api/kraynet/donate', { to: FOLDER.addr, sats: '10' })
    ok(d1.ok && d2.ok, 'wallets funded (A 200 ₭, folder 10 ₭)')
    const b = await act(A, { action: 'burn', amount: '100' })
    ok(b.ok === true || !b.error, 'A burned 100 ₭ → 100 Ӿ' + (b.error ? ' — ' + b.error : ''))
    const enter = await act(A, { action: 'lane-enter', amount: '100' })
    ok(!enter.error, 'lane-enter accepted by the live door' + (enter.error ? ' — ' + enter.error : ''))
    const l1 = await lightsOf(A.addr)
    ok(l1.xSpendable === '0' && l1.laneX === '100', `the lights agree: spendable ${l1.xSpendable}, lane ${l1.laneX}`)

    // ── 2. THE PROVEN BREATH: the REAL Groth16 proof lands over HTTP ──
    const seal = await act(FOLDER, { action: 'fold-seal', ...sealFields() })
    ok(!seal.error, 'THE FOLD-SEAL LANDED — the real Groth16 proof verified inside the live reducer' + (seal.error ? ' — ' + seal.error : ''))
    const l2 = await lightsOf(A.addr)
    ok(l2.laneX === '70', `the rival law's outcome is live consensus: A's lane Ӿ is now ${l2.laneX}`)

    // ── 3. THE WALLS, over HTTP ──
    const again = await act(FOLDER, { action: 'fold-seal', ...sealFields() })
    ok(typeof again.error === 'string' && /does not chain/.test(again.error), 'a second landing refuses at the door (stale fold): ' + (again.error || 'accepted?!'))
    const tampered = sealFields()
    tampered.foldProof = tampered.foldProof.slice(0, -2) + (tampered.foldProof.endsWith('00') ? '01' : '00')
    const bad = await act(FOLDER, { action: 'fold-seal', ...tampered })
    ok(typeof bad.error === 'string' && /does not verify|does not chain/.test(bad.error), 'a tampered proof refuses at the door: ' + (bad.error || 'accepted?!'))

    // ── 4. THE EXIT ──
    const exit = await act(A, { action: 'lane-exit', amount: '50' })
    ok(!exit.error, 'lane-exit accepted' + (exit.error ? ' — ' + exit.error : ''))
    const l3 = await lightsOf(A.addr)
    ok(l3.xSpendable === '50' && l3.laneX === '20', `the books after exit: spendable ${l3.xSpendable}, lane ${l3.laneX}`)

    // the journal's own word: exactly one fold-seal, carrying proof + diffs
    const lines = readFileSync(join(DATA, `kraynet-journal-${NET}.jsonl`), 'utf8').trim().split('\n')
    const events = lines.map((l) => JSON.parse(l) as KrayEvent)
    const seals = events.filter((e) => e.kind === 'fold-seal')
    ok(seals.length === 1 && typeof seals[0].foldProof === 'string' && seals[0].foldPost === V2.expected.postRoot,
      'the journal carries ONE fold-seal with the proof and the proven postRoot (the re-sync law rides the bytes)')

    const head0 = (await jget('/api/kraynet/head')).cascadeRoot

    // ── 5. THE FOLLOWER: reboot — the replay RE-VERIFIES the Groth16 proof from bytes alone ──
    child.kill('SIGKILL')
    await sleep(300)
    child = boot()
    await waitUp()
    const head1 = (await jget('/api/kraynet/head')).cascadeRoot
    ok(head1 === head0, 'the reboot replayed the journal — real proof re-verified — to the byte-identical cascade root')

    console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the lane lives at the door, the proof re-verifies on reboot. Ӿ⚡\n`)
    return done(fail ? 1 : 0)
  } catch (e) {
    console.error('tk-fold swarm exam crashed: ' + (e instanceof Error ? e.stack || e.message : String(e)))
    return done(1)
  }
  function done(code: number) {
    try { child.kill('SIGKILL') } catch { /* gone */ }
    rmSync(DATA, { recursive: true, force: true })
    process.exit(code)
  }
}
main()
