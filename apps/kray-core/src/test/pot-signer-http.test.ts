/**
 * POT SIGNER over HTTP — the daemon on 127.0.0.1, attacked on the wire.
 *   node src/test/pot-signer-http.test.ts
 */
import { createHash, randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

/**
 * THE PEN IS KEPT OFF THE PUBLIC CLONE ON PURPOSE — it handles keys, and `fix(door): keep the writer kit
 * and pen off git` took it out deliberately. So in a clone that does not carry it, this file must SKIP,
 * loudly, naming why: `node <missing file>` exits non-zero for the wrong reason, and a suite that stays
 * red by design teaches everyone to ignore red. Where the file IS present — the operator's own house —
 * every check below runs and every failure is real.
 */
if (!existsSync(SCRIPT)) {
  console.log(`\n⊘ SKIPPED — scripts/pot-signer.mjs is not in this clone (kept off git on purpose: it handles keys).`)
  console.log('  This suite runs in the operator house, where the file lives. Nothing here is unproven;')
  console.log('  it is simply not testable from a clone that deliberately does not carry the thing.\n')
  process.exit(0)
}
// THE PEN'S OWN BOOK (2026-09-18): a mock follower the daemon must consult before every signature
const BOOK_PORT = 4489
const book = { seq: 50, root: 'ab'.repeat(32), balance: 100n, up: true }
const bookServer = createServer((req, res) => {
  if (!book.up) { req.socket.destroy(); return }
  const u = req.url || '/'
  res.setHeader('content-type', 'application/json')
  if (u === '/api/kraynet/head') { res.end(JSON.stringify({ seq: book.seq, cascadeRoot: book.root, network: NET })); return }
  const lin = /^\/api\/kraynet\/lineage\/([0-9a-f]{64})$/.exec(u)
  if (lin) { res.end(JSON.stringify({ root: lin[1], known: lin[1] === book.root, seq: book.seq, head: { seq: book.seq, root: book.root }, lastProvenAnchor: null })); return }
  if (u.startsWith('/api/kraynet/runes/of/')) { res.end(JSON.stringify({ runes: [{ id: '1:1', amount: book.balance.toString(), locked: '0' }] })); return }
  res.statusCode = 404; res.end('{}')
})
const HEAD_FILE = join(tmpdir(), `kray-pen-head-${process.pid}.json`)
const child = spawn('node', [SCRIPT], {
  env: {
    ...process.env,
    KRAY_CONSOLIDATION_SECRET: Buffer.from(DEP.sk).toString('hex'),
    KRAY_POT_SIGNER_TOKEN: TOKEN,
    KRAY_POT_SIGNER_PORT: String(PORT),
    KRAY_POT_SIGNER_BOOK_URL: `http://127.0.0.1:${BOOK_PORT}`,
    KRAY_POT_SIGNER_HEAD_FILE: HEAD_FILE,
    KRAY_POT_SIGNER_MEMORY_FILE: HEAD_FILE.replace('head', 'memory'),
  },
  stdio: 'ignore',
})
process.on('exit', () => { try { child.kill('SIGKILL') } catch { /* already gone */ } })

const BASE = `http://127.0.0.1:${PORT}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await new Promise<void>((r) => bookServer.listen(BOOK_PORT, '127.0.0.1', () => r()))
  // a pen WITHOUT a book must refuse to start — the rubber stamp is gone
  const noBook = spawnSync('node', [SCRIPT], { env: { ...process.env, KRAY_CONSOLIDATION_SECRET: Buffer.from(DEP.sk).toString('hex'), KRAY_POT_SIGNER_TOKEN: TOKEN, KRAY_POT_SIGNER_PORT: String(PORT + 1), KRAY_POT_SIGNER_BOOK_URL: '' }, encoding: 'utf8', timeout: 8000 })
  ok(noBook.status !== 0 && /KRAY_POT_SIGNER_BOOK_URL/.test(noBook.stderr || ''), 'a pen without a book REFUSES TO START (no rubber stamp, ever)')
  const remoteBook = spawnSync('node', [SCRIPT], { env: { ...process.env, KRAY_CONSOLIDATION_SECRET: Buffer.from(DEP.sk).toString('hex'), KRAY_POT_SIGNER_TOKEN: TOKEN, KRAY_POT_SIGNER_PORT: String(PORT + 1), KRAY_POT_SIGNER_BOOK_URL: 'http://10.0.0.5:4480' }, encoding: 'utf8', timeout: 8000 })
  ok(remoteBook.status !== 0, 'a pen pointed at a book OFF this box refuses to start — the book must be one this box replayed')
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
  ok(noAuth.status === 401, 'ATTACK: no token → 401' + ' ← ' + noAuth.status + ' ' + JSON.stringify(noAuth.body).slice(0, 160))

  const badTok = await fetch(BASE + '/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + '00'.repeat(32) },
    body: JSON.stringify(bundle),
  })
  ok(badTok.status === 401, 'ATTACK: wrong token → 401' + ' ← ' + badTok.status + ' ' + JSON.stringify(badTok.body).slice(0, 160))

  const good = await fetch(BASE + '/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify(bundle),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
  ok(good.status === 200 && good.body.ok === true && Array.isArray(good.body.depositorSigs) && good.body.depositorSigs.length === 1, 'a genuine rebuild bundle is signed over HTTP — the pen consulted its book (balance 100 ≥ exit 100)' + ' ← ' + good.status + ' ' + JSON.stringify(good.body).slice(0, 160))
  ok(existsSync(HEAD_FILE) && JSON.parse(readFileSync(HEAD_FILE, 'utf8')).root === book.root, 'the pen persisted the head it signed against (monotonic memory)')
  const h2 = await fetch(BASE + '/health').then((r) => r.json())
  ok(h2.book === `http://127.0.0.1:${BOOK_PORT}` && h2.monotonicHead && h2.monotonicHead.root === book.root, '/health names the book and the remembered head')
  // THE DRAIN the pen used to carimba: a self-signed exit above the book balance
  book.balance = 99n
  const overBalance = await fetch(BASE + '/sign', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(bundle),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
  ok(overBalance.status === 403 && /over-balance/.test(overBalance.body.reason || ''), 'ATTACK: exit 100 vs book 99 → 403 over-balance (the pen refuses on its OWN book)' + ' ← ' + overBalance.status + ' ' + JSON.stringify(overBalance.body).slice(0, 160))
  book.balance = 100n
  // lag ≠ theft: the exit's journal seq is past the book → 503 retriable, never a signature
  const lag = await fetch(BASE + '/sign', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ ...bundle, minSeal: 60 }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
  ok(lag.status === 503 && lag.body.lagging === true && lag.body.bookSeq === 50, 'a book behind the exit (seq 50 < 60) → 503 lagging, retried by the writer' + ' ← ' + lag.status + ' ' + JSON.stringify(lag.body).slice(0, 160))
  // a rewrite: the book\'s history no longer passes through the remembered head → 403 that never auto-clears
  const oldRoot = book.root; book.root = 'cd'.repeat(32); book.seq = 51
  const rewrite = await fetch(BASE + '/sign', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(bundle),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
  ok(rewrite.status === 403 && rewrite.body.equivocation === true, 'a book whose history abandons the remembered head → 403 EQUIVOCATION (held until a person inspects)' + ' ← ' + rewrite.status + ' ' + JSON.stringify(rewrite.body).slice(0, 160))
  book.root = oldRoot; book.seq = 50
  // the book goes dark → 503, never a signature on a guess
  book.up = false
  const dark = await fetch(BASE + '/sign', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(bundle),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
  ok(dark.status === 503 && dark.body.lagging === true, 'an unreachable book → 503 (the pen cannot judge; it does not sign)' + ' ← ' + dark.status + ' ' + JSON.stringify(dark.body).slice(0, 160))
  book.up = true

  const steal = await fetch(BASE + '/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ ...bundle, plan: { ...bundle.plan, destScriptHex: hex(btc.p2tr(Buffer.from(keypair('http-thief').pk, 'hex'), undefined, NETWORKS.regtest).script!) } }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
  ok(steal.status === 403 && /SIGNED exit address/.test(steal.body.reason || ''), 'ATTACK: dest swapped on the wire → 403' + ' ← ' + steal.status + ' ' + JSON.stringify(steal.body).slice(0, 160))

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
  ok(drain.status === 403 && /ceiling/.test(drain.body.reason || ''), 'ATTACK: a 50 000-sat "service fee" on the wire → 403 (the ceiling holds over HTTP)' + ' ← ' + drain.status + ' ' + JSON.stringify(drain.body).slice(0, 160))
  const garbage = await fetch(BASE + '/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ ...feeBundle, plan: { ...feeBundle.plan, serviceFee: 'yes' } }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
  ok(garbage.status === 400 && /serviceFee must be/.test(garbage.body.reason || ''), 'a malformed service output on the wire → 400, the daemon stays up' + ' ← ' + garbage.status + ' ' + JSON.stringify(garbage.body).slice(0, 160))

  console.log(`\n╚═ ${pass} passed — the pot-signer on 127.0.0.1 signs only an exit-bound rebuild. ₿₭`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => { try { child.kill('SIGKILL') } catch { /* already gone */ } try { bookServer.close() } catch { /* already closed */ } try { rmSync(HEAD_FILE, { force: true }); rmSync(HEAD_FILE.replace('head', 'memory'), { force: true }) } catch { /* gone */ } })
