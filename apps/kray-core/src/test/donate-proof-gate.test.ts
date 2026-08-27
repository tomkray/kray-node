/**
 * DONATE PROOF GATE — a client-supplied {proof} may mint ₭ ONLY where forging its headers costs
 * real, non-resettable proof-of-work: mainnet alone. On signet (blocks secured by a signature, not
 * work), testnet (resettable difficulty) or regtest (no work), SPV-by-work verifies neither, so a
 * client {proof} is forgeable and would mint UNBACKED ₭ up to the whole pot deficit — a Supreme-Law
 * violation. This proves the gate refuses it there and still lets the trustworthy {txid} path through.
 *
 *   node src/test/donate-proof-gate.test.ts
 */
import { spawn } from 'node:child_process'
import { rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const PORT = 4497, BASE = `http://localhost:${PORT}`
const DATA = join(tmpdir(), `kraynet-pgate-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const POT = 'tb1pgen56j86d8lm8364plkh22s645hpwh94lqy2gvlznzvv9vympndqyx6664' // a real signet pot address
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jpost = (p: string, b: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(15000) }).then((r) => r.json() as Promise<any>).catch((e) => ({ error: String(e?.message || e) }))
const jget = (p: string) => fetch(BASE + p, { signal: AbortSignal.timeout(15000) }).then((r) => r.json() as Promise<any>).catch((e) => ({ error: String(e?.message || e) }))

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

async function main() {
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  // signet node, a pot configured, NO bitcoind and NO trusted-dev — the pure production proof gate
  const child = spawn('node', [SERVER], { env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: 'signet', KRAY_POT_ADDRESS: POT }, stdio: 'ignore' })
  const done = (code: number) => { try { child.kill('SIGKILL') } catch {} rmSync(DATA, { recursive: true, force: true }); process.exit(code) }
  try {
    for (let i = 0; i < 80; i++) { try { if ((await jget('/health')).ok) break } catch {} await sleep(100) }
    console.log('\n╔═ DONATE PROOF GATE — no unbacked mint from a forgeable proof ══╗\n')

    // ── a forged client {proof} on signet must be REFUSED before any SPV math ──
    const forged = { proof: { rawTx: '00', txoutproof: '00', headers: ['00'.repeat(80)] } }
    const r1 = await jpost('/api/kraynet/donate', forged)
    ok(!!r1.error, 'a client-supplied {proof} on signet is REFUSED (returns an error, mints nothing)')
    ok(/mainnet|forgeable|unbacked|\{txid\}/.test(String(r1.error)), 'refused for the right reason — "' + String(r1.error).slice(0, 70) + '…"')

    // ── the trustworthy {txid} path is NOT blocked by the gate (it re-proves via the node's bitcoind) ──
    const r2 = await jpost('/api/kraynet/donate', { txid: 'ff'.repeat(32) })
    ok(!!r2.error, 'a {txid} without a bitcoind cannot be proven here (expected in this test — no node bitcoind)')
    ok(!/only on mainnet|client-supplied|forgeable/.test(String(r2.error)), 'but {txid} PASSED the proof gate — it fails later at the fetch, a DIFFERENT error, so the secure path is open')

    // ── nothing was minted by any of it ──
    const sup = await jget('/api/kraynet/supply')
    ok(String(sup.emitted) === '0' && String(sup.circulating) === '0', 'the pot is untouched — emitted 0, circulating 0: the forgery minted zero ₭')

    console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — a forgeable proof mints nothing; only mainnet PoW or the node's own bitcoind is trusted. ⛓₭\n`)
    done(fail ? 1 : 0)
  } catch (e) { console.error('\n✗ proof-gate error:', e); done(1) }
}
main()
