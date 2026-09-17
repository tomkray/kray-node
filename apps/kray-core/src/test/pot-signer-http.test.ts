/**
 * POT SIGNER over HTTP — the daemon on 127.0.0.1, attacked on the wire.
 *   node src/test/pot-signer-http.test.ts
 */
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as btc from '@scure/btc-signer'
import { deriveVault } from '../protocol/vault.ts'
import { buildExitPayout, type FundingUtxo, type ExitPayoutPlan } from '../protocol/exit-payout.ts'
import { planToWire } from '../protocol/pot-signer.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, runeExitMessage, addressOf } from '../protocol/scheme.ts'

let pass = 0
function ok(c: boolean, m: string) { if (c) { pass++; console.log('  ✓', m) } else { console.error('  ✗', m); process.exit(1) } }

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const keypair = (tag: string) => {
  const sk = createHash('sha256').update(tag).digest()
  return { sk, pk: _generateKeyPair(sk).publicKeyHex }
}

const NET = 'regtest'
const PORT = 18000 + (process.pid % 1000)
const TOKEN = randomBytes(32).toString('hex')
const DEP = keypair('pot-owner-http')
const USER = keypair('exiter-http')
const FUND = keypair('fund-http')
const G = [keypair('hg1'), keypair('hg2'), keypair('hg3')]
const params = { guardians: G.map((g) => g.pk), threshold: 2, depositor: DEP.pk, timelock: 144, net: 'regtest' as const }
deriveVault(params)
const destAddr = addressOf(USER.pk, 'regtest')
const destPay = btc.p2tr(Buffer.from(USER.pk, 'hex'), undefined, NETWORKS.regtest)
const fundPay = btc.p2tr(Buffer.from(FUND.pk, 'hex'), undefined, NETWORKS.regtest)
const vaultUtxos = [{ txid: createHash('sha256').update('hv').digest('hex'), vout: 0, amountSats: 546n }]
const funding: FundingUtxo = {
  txid: createHash('sha256').update('hf').digest('hex'), vout: 1, amountSats: 20_000n,
  scriptHex: hex(fundPay.script!), internalKey: FUND.pk,
}
const plan: ExitPayoutPlan = {
  runeId: { block: 1n, tx: 1n }, exitAmount: 100n, totalVaultRunes: 700n,
  destScriptHex: hex(destPay.script!), destPostage: 330n, changePostage: 330n,
  satsChangeScriptHex: hex(fundPay.script!), feeSats: 2_000n, dust: 330n,
}
const payout = buildExitPayout(params, vaultUtxos, funding, plan)
const msg = runeExitMessage(NET, destAddr, '1:1', 100n, destAddr, 0)
const exit = {
  from: destAddr, runeId: '1:1', amount: '100', l1Address: destAddr, nonce: 0,
  publicKey: USER.pk, signature: _signKrayWallet(msg, USER.sk), scheme: 'kraywallet',
}
const bundle = {
  network: NET, exit, params,
  vaultUtxos: vaultUtxos.map((u) => ({ ...u, amountSats: u.amountSats.toString() })),
  funding: { ...funding, amountSats: funding.amountSats.toString() },
  plan: planToWire(plan),
  claimedSighashes: payout.sighashes.slice(0, payout.vaultInputCount),
}

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/pot-signer.mjs')
const child = spawn('node', [SCRIPT], {
  env: {
    ...process.env,
    KRAY_CONSOLIDATION_SECRET: Buffer.from(DEP.sk).toString('hex'),
    KRAY_POT_SIGNER_TOKEN: TOKEN,
    KRAY_POT_SIGNER_PORT: String(PORT),
  },
  stdio: 'ignore',
})
process.on('exit', () => { try { child.kill('SIGKILL') } catch { /* already gone */ } })

const BASE = `http://127.0.0.1:${PORT}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  let up = false
  for (let i = 0; i < 40; i++) {
    try {
      const h = await fetch(BASE + '/health', { signal: AbortSignal.timeout(400) })
      if (h.ok) { up = true; break }
    } catch { /* still booting */ }
    await sleep(50)
  }
  ok(up, 'pot-signer answers /health on loopback')

  const health = await fetch(BASE + '/health').then((r) => r.json())
  ok(health.ok === true && !JSON.stringify(health).includes(TOKEN.slice(0, 12)), 'health never leaks the token')

  const noAuth = await fetch(BASE + '/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) })
  ok(noAuth.status === 401, 'ATTACK: no token → 401')

  const badTok = await fetch(BASE + '/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + '00'.repeat(32) },
    body: JSON.stringify(bundle),
  })
  ok(badTok.status === 401, 'ATTACK: wrong token → 401')

  const good = await fetch(BASE + '/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify(bundle),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
  ok(good.status === 200 && good.body.ok === true && Array.isArray(good.body.depositorSigs) && good.body.depositorSigs.length === 1, 'a genuine rebuild bundle is signed over HTTP')

  const steal = await fetch(BASE + '/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ ...bundle, plan: { ...bundle.plan, destScriptHex: hex(btc.p2tr(Buffer.from(keypair('http-thief').pk, 'hex'), undefined, NETWORKS.regtest).script!) } }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
  ok(steal.status === 403 && /SIGNED exit address/.test(steal.body.reason || ''), 'ATTACK: dest swapped on the wire → 403')

  // the 2026-09-17 regression, over the REAL daemon: the withdraw door's stated 546-sat service output
  // must cross the HTTP wire, or the pen rebuilds a 4-output payout and holds every withdraw.
  const platPay = btc.p2tr(Buffer.from(keypair('http-platform').pk, 'hex'), undefined, NETWORKS.regtest)
  const feePlan: ExitPayoutPlan = { ...plan, serviceFee: { scriptHex: hex(platPay.script!), sats: 546n } }
  const feePayout = buildExitPayout(params, vaultUtxos, funding, feePlan)
  const feeBundle = { ...bundle, plan: planToWire(feePlan), claimedSighashes: feePayout.sighashes.slice(0, feePayout.vaultInputCount) }
  const fee = await fetch(BASE + '/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify(feeBundle),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
  ok(fee.status === 200 && fee.body.ok === true && fee.body.depositorSigs.length === 1, 'REGRESSION: the stated service output crosses the HTTP wire — the pen rebuilds the node\'s 5-output payout and signs')
  const drain = await fetch(BASE + '/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ ...feeBundle, plan: { ...feeBundle.plan, serviceFee: { scriptHex: hex(platPay.script!), sats: '50000' } } }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
  ok(drain.status === 403 && /signer ceiling/.test(drain.body.reason || ''), 'ATTACK: a 50 000-sat "service fee" on the wire → 403 (the ceiling holds over HTTP)')
  const garbage = await fetch(BASE + '/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ ...feeBundle, plan: { ...feeBundle.plan, serviceFee: 'yes' } }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
  ok(garbage.status === 400 && /serviceFee must be/.test(garbage.body.reason || ''), 'a malformed service output on the wire → 400, the daemon stays up')

  console.log(`\n╚═ ${pass} passed — the pot-signer on 127.0.0.1 signs only an exit-bound rebuild. ₿₭`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => { try { child.kill('SIGKILL') } catch { /* already gone */ } })
