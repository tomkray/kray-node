/**
 * LAG ≠ THEFT (custody doctrine rung 2) — the guardian daemon on the wire, its book's clock in our hands.
 *   node src/test/guardian-lag-theft.test.ts
 *
 *   L-01  book BEHIND the exit's minSeal  → 503 { lagging } — retriable liveness, NEVER a refusal
 *   L-02  book UNREACHABLE + minSeal set  → 503 { lagging } — cannot judge yet, never silently signs
 *   L-03  book AT/PAST minSeal + balance OK → 200 signs (the normal path intact)
 *   L-04  book AT/PAST minSeal + CONTRADICTION → 403 refused (the safety gate untouched — a caught-up
 *         book that says NO still HOLDS the withdraw; lag courtesy never weakens theft refusal)
 *   L-05  no minSeal (an old writer) → back-compat: today's behavior, byte-identical
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
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
const keypair = (tag: string) => { const sk = createHash('sha256').update(tag).digest(); return { sk, pk: _generateKeyPair(sk).publicKeyHex } }

const NET = 'regtest'
const DPORT = 18500 + (process.pid % 400)          // the guardian daemon
const BPORT = DPORT + 401                           // OUR fake book (the follower we puppet)
const TOKEN = randomBytes(32).toString('hex')
const DEP = keypair('lag-owner'), USER = keypair('lag-exiter'), FUND = keypair('lag-fund')
const G = [keypair('lg1'), keypair('lg2'), keypair('lg3')]
const params = { guardians: G.map((g) => g.pk), threshold: 2, depositor: DEP.pk, timelock: 144, net: 'regtest' as const }
deriveVault(params)
const destAddr = addressOf(USER.pk, 'regtest')
const destPay = btc.p2tr(Buffer.from(USER.pk, 'hex'), undefined, NETWORKS.regtest)
const fundPay = btc.p2tr(Buffer.from(FUND.pk, 'hex'), undefined, NETWORKS.regtest)
const vaultUtxos = [{ txid: createHash('sha256').update('lv').digest('hex'), vout: 0, amountSats: 546n }]
const funding: FundingUtxo = { txid: createHash('sha256').update('lf').digest('hex'), vout: 1, amountSats: 20_000n, scriptHex: hex(fundPay.script!), internalKey: FUND.pk }
const plan: ExitPayoutPlan = {
  runeId: { block: 1n, tx: 1n }, exitAmount: 100n, totalVaultRunes: 700n,
  destScriptHex: hex(destPay.script!), destPostage: 330n, changePostage: 330n,
  satsChangeScriptHex: hex(fundPay.script!), feeSats: 2_000n, dust: 330n,
}
const payout = buildExitPayout(params, vaultUtxos, funding, plan)
const msg = runeExitMessage(NET, destAddr, '1:1', 100n, destAddr, 0)
const exit = { from: destAddr, runeId: '1:1', amount: '100', l1Address: destAddr, nonce: 0, publicKey: USER.pk, signature: _signKrayWallet(msg, USER.sk), scheme: 'kraywallet' }
const baseBundle = {
  network: NET, exit, params,
  vaultUtxos: vaultUtxos.map((u) => ({ ...u, amountSats: u.amountSats.toString() })),
  funding: { ...funding, amountSats: funding.amountSats.toString() },
  plan: planToWire(plan),
  claimedSighashes: payout.sighashes.slice(0, payout.vaultInputCount),
}

// ── OUR PUPPET BOOK: we set its seq and its balance answer per scenario ──
let bookSeq = 100
let bookBalance = '700'          // enough to cover the exit (100) → OK; set low for the contradiction case
let bookUp = true
const book = createServer((req, res) => {
  if (!bookUp) { req.socket.destroy(); return }
  res.setHeader('content-type', 'application/json')
  if (String(req.url).startsWith('/api/kraynet/head')) { res.end(JSON.stringify({ seq: bookSeq, network: NET })) ; return }
  // the balance the daemon pre-fetches — the follower's /runes/of shape (a runes list)
  res.end(JSON.stringify({ runes: [{ runeId: '1:1', amount: bookBalance }] }))
})

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/operator/guardian-signer.mjs')

/**
 * THE GUARDIAN'S SIGNER IS KEPT OFF THE PUBLIC CLONE ON PURPOSE — it handles keys, and `fix(door): keep the writer kit
 * and pen off git` took it out deliberately. So in a clone that does not carry it, this file must SKIP,
 * loudly, naming why: `node <missing file>` exits non-zero for the wrong reason, and a suite that stays
 * red by design teaches everyone to ignore red. Where the file IS present — the operator's own house —
 * every check below runs and every failure is real.
 */
if (!existsSync(SCRIPT)) {
  console.log(`\n⊘ SKIPPED — scripts/operator/guardian-signer.mjs is not in this clone (kept off git on purpose: it handles keys).`)
  console.log('  This suite runs in the operator house, where the file lives. Nothing here is unproven;')
  console.log('  it is simply not testable from a clone that deliberately does not carry the thing.\n')
  process.exit(0)
}
const child = spawn('node', [SCRIPT], {
  env: {
    ...process.env,
    KRAY_VAULT_GUARDIAN_SECRET: Buffer.from(G[0].sk).toString('hex'),
    KRAY_GUARDIAN_SIGNER_TOKEN: TOKEN,
    KRAY_GUARDIAN_SIGNER_PORT: String(DPORT),
    KRAY_GUARDIAN_BOOK_URL: `http://127.0.0.1:${BPORT}`,
  },
  stdio: 'ignore',
})
process.on('exit', () => { try { child.kill('SIGKILL') } catch { /* gone */ } book.close() })

const BASE = `http://127.0.0.1:${DPORT}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sign = async (bundle: Record<string, unknown>) => {
  const r = await fetch(BASE + '/sign', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(bundle) })
  return { status: r.status, j: await r.json().catch(() => ({})) as Record<string, unknown> }
}

async function main() {
  console.log('\n╔═ LAG ≠ THEFT — the guardian judges only from a caught-up book ═╗\n')
  await new Promise<void>((r) => book.listen(BPORT, '127.0.0.1', () => r()))
  for (let i = 0; i < 40; i++) { try { const h = await fetch(BASE + '/health', { signal: AbortSignal.timeout(300) }); if (h.ok) break } catch { /* boot */ } await sleep(250) }

  console.log('L-01 — book BEHIND the exit → 503 lagging (retriable), never a refusal')
  bookSeq = 100; bookBalance = '700'
  const behind = await sign({ ...baseBundle, minSeal: 150 })
  ok(behind.status === 503 && behind.j.lagging === true, `book at 100 < exit 150 → 503 lagging (got ${behind.status})`)
  ok(behind.j.bookSeq === 100 && behind.j.minSeal === 150, 'the answer names the numbers — the writer can retry with truth')

  console.log('L-02 — book UNREACHABLE + minSeal → 503 lagging (cannot judge, never silently signs)')
  bookUp = false
  const dark = await sign({ ...baseBundle, minSeal: 150 })
  ok(dark.status === 503 && dark.j.lagging === true, 'an unreachable book is a liveness fault, not a verdict')
  bookUp = true

  console.log('L-03 — book AT/PAST the exit + balance OK → 200 signs (the normal path intact)')
  bookSeq = 150
  const good = await sign({ ...baseBundle, minSeal: 150 })
  ok(good.status === 200 && good.j.ok === true && Array.isArray(good.j.guardianSigs), `caught-up book + healthy balance → the guardian signs (got ${good.status})`)

  console.log('L-04 — caught-up book + CONTRADICTION → 403 refused (the safety gate untouched)')
  bookSeq = 200; bookBalance = '1'          // the book says the exiter has 1 — the exit claims 100
  const theft = await sign({ ...baseBundle, minSeal: 150 })
  ok(theft.status === 403 && theft.j.ok === false, `a caught-up book that says NO still refuses hard (got ${theft.status}) — lag courtesy never weakens the theft gate`)

  console.log('L-05 — no minSeal (an old writer) → back-compat, today\'s behavior')
  bookSeq = 100; bookBalance = '700'
  const legacy = await sign({ ...baseBundle })
  ok(legacy.status === 200 && legacy.j.ok === true, 'without minSeal the daemon behaves exactly as before (byte-identical path)')

  console.log(`\n✓ ${pass} checks passed — LAG ≠ THEFT: a behind/blind book answers "syncing, retry"; only a caught-up book may judge, and its NO still holds. 🛡️⏳`)
  process.exit(0)
}
main()
