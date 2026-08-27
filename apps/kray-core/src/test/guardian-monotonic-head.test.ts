/**
 * MONOTONIC HEAD (custody doctrine rung 3) — writer equivocation dies at the guardian's own memory.
 *   node src/test/guardian-monotonic-head.test.ts
 *
 * The guardian daemon co-signs ONLY against a book whose current verified history still passes through the
 * last head it co-signed against (and the last anchored root it saw). We puppet the book and attack:
 *
 *   M-01  bootstrap (no head file) → signs, and PLANTS the memory (head + anchored root persisted)
 *   M-02  honest advance → signs; the persisted head RATCHETS forward (head + deeper anchor)
 *   M-03  EQUIVOCATION (tail rewrite — history no longer passes the co-signed root) → 403 hard, file unchanged
 *   M-04  stale replay (an OLD genuine history re-served to resurrect balances) → 403 — same lever, caught
 *   M-05  anchored-root regression (history passes the head but abandons a Bitcoin-anchored root) → 403
 *   M-06  book unreachable with a persisted head → 503 lagging (LAG ≠ THEFT — liveness, never a silent sign)
 *   M-07  pre-rung-3 book (no /lineage route) with a persisted head → 503 "update the follower", retriable
 *   M-08  snapshot swaps MID-REQUEST (gate ≠ balances snapshot) → 503 retriable (anti-TOCTOU), file unchanged
 *   M-09  the operator rite (delete the head file consciously) → signs again, replants the memory
 *   M-10  pre-rung-3 book + NO head file → back-compat bootstrap via /head (persists, no anchor claimed)
 */
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs'
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
const keypair = (tag: string) => { const sk = createHash('sha256').update(tag).digest(); return { sk, pk: _generateKeyPair(sk).publicKeyHex } }
const rootOf = (tag: string) => createHash('sha256').update(tag).digest('hex')

const NET = 'regtest'
const DPORT = 19100 + (process.pid % 400)          // the guardian daemon
const BPORT = DPORT + 401                           // OUR puppet book (the follower we control)
const TOKEN = randomBytes(32).toString('hex')
const DEP = keypair('mh-owner'), USER = keypair('mh-exiter'), FUND = keypair('mh-fund')
const G = [keypair('mg1'), keypair('mg2'), keypair('mg3')]
const params = { guardians: G.map((g) => g.pk), threshold: 2, depositor: DEP.pk, timelock: 144, net: 'regtest' as const }
deriveVault(params)
const destAddr = addressOf(USER.pk, 'regtest')
const destPay = btc.p2tr(Buffer.from(USER.pk, 'hex'), undefined, NETWORKS.regtest)
const fundPay = btc.p2tr(Buffer.from(FUND.pk, 'hex'), undefined, NETWORKS.regtest)
const vaultUtxos = [{ txid: createHash('sha256').update('mv').digest('hex'), vout: 0, amountSats: 546n }]
const funding: FundingUtxo = { txid: createHash('sha256').update('mf').digest('hex'), vout: 1, amountSats: 20_000n, scriptHex: hex(fundPay.script!), internalKey: FUND.pk }
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

// ── the histories we puppet (roots are just distinct 64-hex values; membership IS the contract) ──
const R100 = rootOf('R100'), R150 = rootOf('R150'), R200 = rootOf('R200'), R210 = rootOf('R210'), R211 = rootOf('R211')
const X160 = rootOf('X160-fork'), R90 = rootOf('R90-stale')
const A50 = rootOf('A50-anchor'), A120 = rootOf('A120-anchor')

// ── OUR PUPPET BOOK — we set its history, head, anchor, and failure modes per scenario ──
let bookUp = true
let lineageOn = true                                  // false = a pre-rung-3 follower (404 on /lineage)
let headSeq = 100
let headRoot = R100
let knownRoots = new Map<string, number>()
let anchor: { root: string; seq: number } | null = null
let swapAfterLineageCalls: number | null = null       // after N lineage answers, the head root becomes R211
let lineageCalls = 0
const book = createServer((req, res) => {
  if (!bookUp) { req.socket.destroy(); return }
  res.setHeader('content-type', 'application/json')
  const u = String(req.url)
  const lm = /^\/api\/kraynet\/lineage\/([0-9a-f]{64})/.exec(u)
  if (lm) {
    if (!lineageOn) { res.statusCode = 404; res.end(JSON.stringify({ error: 'no route' })); return }
    lineageCalls++
    const hr = swapAfterLineageCalls !== null && lineageCalls > swapAfterLineageCalls ? R211 : headRoot
    const seq = knownRoots.has(lm[1]) ? knownRoots.get(lm[1]) : undefined
    res.end(JSON.stringify({ root: lm[1], known: seq !== undefined, seq: seq ?? null, head: { seq: headSeq, root: hr }, lastProvenAnchor: anchor }))
    return
  }
  if (u.startsWith('/api/kraynet/head')) { res.end(JSON.stringify({ seq: headSeq, cascadeRoot: headRoot, network: NET })); return }
  res.end(JSON.stringify({ runes: [{ runeId: '1:1', amount: '700' }] }))   // balances always healthy — this exam attacks the HEAD, not the balance
})

const TMP = mkdtempSync(join(tmpdir(), 'kray-mh-'))
const HEAD_FILE = join(TMP, 'guardian-head.json')
const readHead = () => JSON.parse(readFileSync(HEAD_FILE, 'utf8'))

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/operator/guardian-signer.mjs')
const child = spawn('node', [SCRIPT], {
  env: {
    ...process.env,
    KRAY_VAULT_GUARDIAN_SECRET: Buffer.from(G[0].sk).toString('hex'),
    KRAY_GUARDIAN_SIGNER_TOKEN: TOKEN,
    KRAY_GUARDIAN_SIGNER_PORT: String(DPORT),
    KRAY_GUARDIAN_BOOK_URL: `http://127.0.0.1:${BPORT}`,
    KRAY_GUARDIAN_HEAD_FILE: HEAD_FILE,
  },
  stdio: 'ignore',
})
process.on('exit', () => { try { child.kill('SIGKILL') } catch { /* gone */ } book.close(); try { rmSync(TMP, { recursive: true, force: true }) } catch { /* tmp */ } })

const BASE = `http://127.0.0.1:${DPORT}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sign = async () => {
  const r = await fetch(BASE + '/sign', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ ...baseBundle }) })
  return { status: r.status, j: await r.json().catch(() => ({})) as Record<string, unknown> }
}

async function main() {
  console.log('\n╔═ MONOTONIC HEAD — the guardian remembers, the writer cannot equivocate ═╗\n')
  await new Promise<void>((r) => book.listen(BPORT, '127.0.0.1', () => r()))
  for (let i = 0; i < 40; i++) { try { const h = await fetch(BASE + '/health', { signal: AbortSignal.timeout(300) }); if (h.ok) break } catch { /* boot */ } await sleep(250) }

  console.log('M-01 — bootstrap: no memory yet → signs, and PLANTS the head')
  headSeq = 100; headRoot = R100
  knownRoots = new Map([[R100, 100], [A50, 50]])
  anchor = { root: A50, seq: 50 }
  const boot = await sign()
  ok(boot.status === 200 && boot.j.ok === true, `first co-sign passes (got ${boot.status}) — the rung is born additive, no memory to hold yet`)
  ok(existsSync(HEAD_FILE), 'the head file exists after the first co-sign — the memory is planted')
  {
    const h = readHead()
    ok(h.root === R100 && h.seq === 100 && h.anchoredRoot === A50, `persisted { seq 100, head ${R100.slice(0, 8)}…, anchor ${A50.slice(0, 8)}… } — head AND anchored root remembered`)
  }

  console.log('M-02 — honest advance: the history grows, the memory ratchets forward')
  headSeq = 150; headRoot = R150
  knownRoots = new Map([[R100, 100], [R150, 150], [A50, 50], [A120, 120]])
  anchor = { root: A120, seq: 120 }
  const adv = await sign()
  ok(adv.status === 200 && adv.j.ok === true, `history still passes the co-signed root → signs (got ${adv.status})`)
  {
    const h = readHead()
    ok(h.root === R150 && h.seq === 150 && h.anchoredRoot === A120, 'the head advanced to seq 150 and the anchored root ratcheted DEEPER (A50 → A120)')
  }

  console.log('M-03 — EQUIVOCATION: a rewritten tail (history no longer passes the co-signed root) → 403 hard')
  headSeq = 160; headRoot = X160
  knownRoots = new Map([[R100, 100], [A120, 120], [X160, 160]])   // R150 is GONE — the writer forked
  const forked = await sign()
  ok(forked.status === 403 && forked.j.equivocation === true, `the fork is refused HARD (got ${forked.status}) — a rewrite is a verdict, never a retry`)
  {
    const h = readHead()
    ok(h.root === R150 && h.seq === 150, 'the memory did NOT advance onto the lying book — the head file is unchanged')
  }

  console.log('M-04 — stale replay: an OLD genuine history cannot resurrect spent balances')
  headSeq = 100; headRoot = R100
  knownRoots = new Map([[R100, 100], [A50, 50]])                  // genuine, but BEFORE the co-signed head
  anchor = { root: A50, seq: 50 }
  const stale = await sign()
  ok(stale.status === 403 && stale.j.equivocation === true, `an old history (head seq 100 < co-signed 150) is refused (got ${stale.status}) — replaying the past buys nothing`)

  console.log('M-05 — anchored-root regression: passes the head but abandons a Bitcoin-anchored root → 403')
  headSeq = 200; headRoot = R200
  knownRoots = new Map([[R100, 100], [R150, 150], [R200, 200]])   // A120 is GONE — a rewrite below an anchor
  anchor = null
  const deanchored = await sign()
  ok(deanchored.status === 403 && deanchored.j.equivocation === true, `a history that abandons the anchored root is refused (got ${deanchored.status}) — A3 at the co-sign door`)

  console.log('M-06 — book unreachable with a persisted head → 503 lagging (liveness, never a silent sign)')
  bookUp = false
  const dark = await sign()
  ok(dark.status === 503 && dark.j.lagging === true, `an unreachable book cannot judge descendance → 503 retriable (got ${dark.status})`)
  bookUp = true

  console.log('M-07 — pre-rung-3 book (no /lineage) with a persisted head → 503 "update the follower"')
  lineageOn = false
  const old = await sign()
  ok(old.status === 503 && old.j.lagging === true && /update the follower/.test(String(old.j.reason)), `a book without the lineage route is a liveness fault, not a verdict (got ${old.status})`)
  lineageOn = true

  console.log('M-08 — snapshot swaps MID-REQUEST → 503 retriable (the gate and the balances must agree)')
  headSeq = 210; headRoot = R210
  knownRoots = new Map([[R100, 100], [R150, 150], [A120, 120], [R210, 210], [R211, 211]])
  anchor = { root: A120, seq: 120 }
  lineageCalls = 0; swapAfterLineageCalls = 2                     // gate sees R210; the confirm sees R211
  const swapped = await sign()
  ok(swapped.status === 503 && swapped.j.lagging === true, `a mid-request snapshot swap forces a clean retry (got ${swapped.status}) — anti-TOCTOU, never a sign across two snapshots`)
  {
    const h = readHead()
    ok(h.root === R150, 'the memory did not advance on the aborted attempt')
  }
  swapAfterLineageCalls = null

  console.log('M-09 — the operator rite: delete the head file consciously → signs again, replants')
  rmSync(HEAD_FILE)
  const rite = await sign()
  ok(rite.status === 200 && rite.j.ok === true, `after the conscious reset the guardian co-signs again (got ${rite.status})`)
  {
    const h = readHead()
    ok(h.root === R210 && h.anchoredRoot === A120, 'the memory is replanted at the current head — the rite is a reset, never a hole')
  }

  console.log('M-10 — pre-rung-3 book + NO head file → back-compat bootstrap via /head')
  rmSync(HEAD_FILE)
  lineageOn = false
  const compat = await sign()
  ok(compat.status === 200 && compat.j.ok === true, `an old mirror still bootstraps (got ${compat.status}) — deploy order cannot brick a box`)
  {
    const h = readHead()
    ok(h.root === R210 && h.anchoredRoot === null, 'persisted from /head alone — no anchor CLAIMED where none was proven (never overclaim)')
  }
  lineageOn = true

  console.log(`\n✓ ${pass} checks passed — MONOTONIC HEAD: the guardian's own memory makes writer equivocation a refusal, not a theft. 🛡️⛓️\n`)
  process.exit(0)
}
main()
