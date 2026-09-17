/**
 * THE GUARDIAN GO-LIVE CEREMONY — TIER 1, the whole runbook proven by breaking.
 *
 * Boots its OWN node (:4499, fresh journal, KRAY_GUARDIAN_SIGNER_URLS ON) + THREE real guardian-signer
 * daemons (lab dev-seed guardians, book = the node), then drives real pot withdraws through the REMOTE
 * co-signers and breaks them on purpose — the exact Tier-1 scenarios of docs/GUARDIAN-GO-LIVE-RUNBOOK.md:
 *
 *   S1 · all 3 daemons up      → a withdraw completes THROUGH the remote book-checking guardians;
 *   S2 · kill ONE (of 3)       → the next withdraw STILL completes (2-of-3 — the threshold IS the tolerance);
 *   (topology = the fleet's: each guardian reads its OWN follower book of the node, never the writer —
 *    a writer serves no /lineage, so a guardian pointed at it is a one-shot signer under rung 3;
 *    the books must have caught up to the exit's seq before a submit, exactly as the fleet lags)
 *   S3 · kill TWO              → the withdraw is HELD (fail-closed), the exit lock survives, funds never move;
 *   S4 · a STALE-book guardian → the same withdraw is HELD FOR SAFETY (a book NO is never routed around);
 *   S5 · restore a good daemon → the SAME held withdraw completes — holds are liveness, never loss.
 *
 * Isolation (nothing else is touched): own port/journal; the shared regtest chain is disposable; the rune
 * (GOLD•HUNDREDTH) was never credited on the :4477 bench node, so no coin-selection/watcher cross-talk; the
 * :4477 PID is asserted unchanged at the end. Tier-2 (real signet, separate boxes, own validating followers)
 * is the deliberate operator rite — this proves the MACHINERY, honestly labeled.
 *
 *   HARNESS=<dir> node src/test/guardian-golive-tier1-e2e.mjs
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, mkdtempSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _signKrayWallet, scriptOfAddress, runeExitMessage } from '../protocol/scheme.ts'
import { potCredit } from './dev-federation.mjs'

const HARNESS = process.env.HARNESS
if (!HARNESS || !existsSync(`${HARNESS}/bc`)) { console.error('✗ set HARNESS=<regtest harness dir with bc/ordw>'); process.exit(1) }
const SERVER = new URL('../../../kray-net/server.mjs', import.meta.url).pathname
const NODE_PORT = 4499
const NODE = `http://127.0.0.1:${NODE_PORT}`
const G_PORTS = [4493, 4494, 4495]
const B_PORTS = [4531, 4532, 4533]                    // one follower book per guardian (the fleet's topology)
const FROZEN_PORT = 4534                              // a book frozen at the deposit-era snapshot (S4: LAG ≠ THEFT)
const FOLLOW = new URL('../../../../scripts/follow/kray-follow.mjs', import.meta.url).pathname
const TOKEN = 'ceremony-tier1-token-0123456789'
const RUNE = process.env.RUNE || '146:1', RUNE_NAME = process.env.RUNE_NAME || 'GOLD•HUNDREDTH'   // env-overridable: a fresh regtest chain etches its own lab rune; never credited on the :4477 bench → zero cross-talk
const DEPOSIT_DISPLAY = 50n                            // div 2 → 5000 base units land
const EXIT = 2000n                                     // base units
const NET = 'regtest', BNET = toBtcNet(NET)
const NUMS = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0'

const bc = (...a) => execFileSync(`${HARNESS}/bc`, a, { encoding: 'utf8' }).trim()
const ordGet = (p) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081${p}`], { encoding: 'utf8' }))
const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
const sync = () => { const h = bc('getblockcount'); for (let i = 0; i < 40; i++) { try { if (String(ordGet('/r/blockheight')) === h) return } catch {} execFileSync('sleep', ['0.5']) } }
const jget = (p) => JSON.parse(execFileSync('curl', ['-s', NODE + p], { encoding: 'utf8' }))
const jpost = (p, b) => JSON.parse(execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(b), NODE + p], { encoding: 'utf8' }))
const sleep = (s) => execFileSync('sleep', [String(s)])
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const key = (t) => { const sk = createHash('sha256').update('ceremony|' + t).digest(); return { sk, pk: _generateKeyPair(sk).publicKeyHex } }
const gSecret = (i) => createHash('sha256').update(`kray-dev-vault-guardian-${i}`).digest('hex') // documented lab seeds

// ── the RPC creds come from the gitignored harness conf — never hardcoded, never printed ──
const conf = readFileSync(join(HARNESS, 'bitcoin/bitcoin.conf'), 'utf8')
const RPC_USER = (conf.match(/^rpcuser=(.+)$/m) || [])[1]?.trim() || 'kraycore'
const RPC_PASS = (conf.match(/^rpcpassword=(.+)$/m) || [])[1]?.trim()
if (!RPC_PASS) { console.error('✗ no rpcpassword in harness conf'); process.exit(1) }

const children = []
const DATA = mkdtempSync(join(tmpdir(), 'kray-ceremony-'))
const logOf = (name) => openSync(join(DATA, name + '.log'), 'a')
function cleanup() { for (const c of children) { try { c.kill('SIGKILL') } catch {} } }
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(1) })

async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (r.ok) return true } catch {}
    sleep(0.5)
  }
  return false
}

function spawnGuardian(port, seedIdx, bookUrl) {
  const child = spawn('node', [new URL('../../../../scripts/operator/guardian-signer.mjs', import.meta.url).pathname], {
    env: {
      ...process.env, KRAY_VAULT_GUARDIAN_SECRET: gSecret(seedIdx), KRAY_GUARDIAN_SIGNER_TOKEN: TOKEN,
      KRAY_GUARDIAN_BOOK_URL: bookUrl, KRAY_GUARDIAN_SIGNER_PORT: String(port),
      KRAY_GUARDIAN_HEAD_FILE: join(DATA, `guardian-${seedIdx}-head.json`),   // one memory per guardian, never shared
    },
    stdio: ['ignore', logOf(`guardian-${port}`), logOf(`guardian-${port}`)],
  })
  children.push(child)
  return child
}

/** A real follower of the ceremony node — the book a guardian reads (the fleet runs exactly this). */
function spawnFollower(port, name, cycleMs, rpc) {
  const child = spawn('node', [FOLLOW, '--from', NODE, '--dir', join(DATA, name), '--serve', String(port), '--watch'], {
    env: { ...process.env, ...rpc, KRAY_FOLLOW_CYCLE_MS: String(cycleMs), KRAY_FOLLOW_INBOX: '0' },
    stdio: ['ignore', logOf(name), logOf(name)],
  })
  children.push(child)
  return child
}

/** The fleet lags: a book must have caught up to the node's head before a guardian may judge (minSeal). */
async function waitBooks(ports, tries = 90) {
  for (let i = 0; i < tries; i++) {
    let target = -1
    try { target = Number((await (await fetch(`${NODE}/api/kraynet/head`, { signal: AbortSignal.timeout(1500) })).json()).seq) } catch {}
    let agree = target >= 0
    for (const p of ports) {
      try {
        const h = await (await fetch(`http://127.0.0.1:${p}/api/kraynet/head`, { signal: AbortSignal.timeout(1500) })).json()
        if (h.stale || Number(h.seq) !== target) agree = false
      } catch { agree = false }
    }
    if (agree) return target
    sleep(0.5)
  }
  return -1
}

async function main() {
  console.log('\n╔═ THE GUARDIAN GO-LIVE CEREMONY — TIER 1: remote book-checking co-signers, proven by breaking ═╗')

  // ── 0 · the untouched-bench baseline (asserted again at the end) ──
  const benchPid = execFileSync('sh', ['-c', "lsof -tnP -iTCP:4477 -sTCP:LISTEN | head -1"], { encoding: 'utf8' }).trim()
  const benchRunes = JSON.parse(execFileSync('curl', ['-s', 'http://127.0.0.1:4477/api/kraynet/runes'], { encoding: 'utf8' }))
  ok(!((benchRunes.runes || []).some((r) => (r.runeId || r.id) === RUNE)), `isolation: the :4477 bench never credited ${RUNE_NAME} — zero cross-talk by construction`)

  // ── 1 · boot: the node with the flag ON, then three real guardian daemons — each on its OWN follower book ──
  const RPC = { KRAY_BTC_RPC: 'http://127.0.0.1:18454', KRAY_BTC_RPC_USER: RPC_USER, KRAY_BTC_RPC_PASS: RPC_PASS }
  const node = spawn('node', [SERVER], {
    env: {
      ...process.env,
      KRAY_NET: 'regtest', KRAY_PORT: String(NODE_PORT), KRAY_DATA: join(DATA, 'node'), ...RPC,
      KRAY_ORD_URL: 'http://127.0.0.1:8081',
      KRAY_POT_ADDRESS: 'bcrt1pjvnl3tq5mcpjmncpqwtr4lf5a0ukflvlj83jj3532hzl73rjyhvqqy5j2k',
      KRAY_SELF_ANCHOR: '1', KRAY_POT_INTERNAL_KEY: NUMS,
      KRAY_TRUSTED_DEV: '1', KRAY_DONATION_CONF: '1', KRAY_ANCHOR_EVERY: '999999',
      KRAY_GUARDIAN_SIGNER_URLS: G_PORTS.map((p) => `http://127.0.0.1:${p}`).join(','),
      KRAY_GUARDIAN_SIGNER_TOKEN: TOKEN,
    },
    stdio: ['ignore', logOf('node'), logOf('node')],
  })
  children.push(node)
  ok(await waitHttp(`${NODE}/api/kraynet/supply`), `ceremony node :${NODE_PORT} is up — fresh journal, KRAY_GUARDIAN_SIGNER_URLS ON (3 remotes)`)
  const g = [spawnGuardian(G_PORTS[0], 0, `http://127.0.0.1:${B_PORTS[0]}`), spawnGuardian(G_PORTS[1], 1, `http://127.0.0.1:${B_PORTS[1]}`), spawnGuardian(G_PORTS[2], 2, `http://127.0.0.1:${B_PORTS[2]}`)]
  for (const p of G_PORTS) ok(await waitHttp(`http://127.0.0.1:${p}/health`), `guardian daemon :${p} is up (loopback, token-gated, book-checking — its book is a follower, not the writer)`)
  const info = jget('/api/kraynet/donation/info')
  ok(info.configured === true, 'the node has bitcoind + the pot wired')

  // ── helpers: a full exiter (deposit → lock → build → wallet-sign), submit driven per scenario ──
  function realDonate(krayAddr, sats) {
    const dataHex = Buffer.from(krayAddr, 'ascii').toString('hex')
    const raw = bc('createrawtransaction', '[]', JSON.stringify([{ [info.potAddress]: Number((sats / 1e8).toFixed(8)) }, { data: dataHex }]))
    const funded = JSON.parse(bc('fundrawtransaction', raw, JSON.stringify({ changePosition: 2 })))
    const signed = JSON.parse(bc('signrawtransactionwithwallet', funded.hex))
    bcSend(signed.hex)
    mine(Math.max(1, info.minConfirmations))
    return jpost('/api/kraynet/donate', { txid: JSON.parse(bc('decoderawtransaction', signed.hex)).txid })
  }
  const bcSend = (hex) => bc('sendrawtransaction', hex)

  function prepareExiter(tag) {
    const OWNER = key('owner|' + tag)
    const DEST = key('dest|' + tag)
    const OWNER_ADDR = btc.p2tr(_hexToBytes(OWNER.pk), undefined, NETWORKS[BNET]).address
    const DEST_ADDR = btc.p2tr(_hexToBytes(DEST.pk), undefined, NETWORKS[BNET]).address
    const don = realDonate(OWNER_ADDR, 1000); sync()
    if (!don.ok) throw new Error('gas donation failed: ' + (don.error || '?'))
    const { dep, landed } = potCredit({ owner: OWNER, amount: DEPOSIT_DISPLAY, net: NET, harness: HARNESS, node: NODE, rune: RUNE, runeName: RUNE_NAME })
    if (!dep.ok) throw new Error('deposit failed: ' + (dep.error || '?'))
    const fundTxid = bc('sendtoaddress', OWNER_ADDR, '0.00050000'); mine(1); sync()
    const ownScript = scriptOfAddress(OWNER_ADDR, BNET)
    const fdec = JSON.parse(bc('getrawtransaction', fundTxid, 'true'))
    const fundVout = fdec.vout.findIndex((o) => (o.scriptPubKey?.hex || '').toLowerCase() === ownScript)
    const nonce = jget('/api/kraynet/profile/' + OWNER_ADDR).nonce
    const sig = _signKrayWallet(runeExitMessage(NET, OWNER_ADDR, RUNE, EXIT, DEST_ADDR, nonce), OWNER.sk)
    const exit = jpost('/api/kraynet/rune/exit', { from: OWNER_ADDR, runeId: RUNE, amount: EXIT.toString(), l1Address: DEST_ADDR, nonce, publicKey: OWNER.pk, signature: sig })
    if (!exit.ok) throw new Error('exit failed: ' + (exit.error || '?'))
    const built = jpost('/api/kraynet/rune/exit/payout-psbt', { from: OWNER_ADDR, runeId: RUNE, publicKey: OWNER.pk, feeRate: 2, funding: { txid: fundTxid, vout: fundVout } })
    if (!built.ok) throw new Error('payout-psbt failed: ' + (built.error || '?'))
    const wtx = btc.Transaction.fromPSBT(Buffer.from(built.psbt, 'base64'), { allowUnknownInputs: true, allowUnknownOutputs: true })
    for (let i = 0; i < wtx.inputsLength; i++) {
      const inp = wtx.getInput(i)
      const sh = inp.witnessUtxo && Buffer.from(inp.witnessUtxo.script).toString('hex')
      if (sh === ownScript) { try { wtx.signIdx(OWNER.sk, i) } catch {} }
    }
    return { OWNER_ADDR, DEST_ADDR, landed, signedPsbt: Buffer.from(wtx.toPSBT(0)).toString('base64') }
  }
  const submit = (x) => jpost('/api/kraynet/rune/exit/payout-submit', { from: x.OWNER_ADDR, runeId: RUNE, psbt: x.signedPsbt })
  // the fleet lags: only a book AT/PAST the exit's seq may judge (minSeal) — wait for the live books first
  const submitWith = async (x, books) => {
    const at = await waitBooks(books)
    ok(at >= 0, `the live books (:${books.join(', :')}) agree with the node at seq ${at} — a guardian judges only a caught-up book`)
    return submit(x)
  }
  const lockedOf = (addr) => {
    const r = (jget('/api/kraynet/runes/of/' + addr).runes || []).find((q) => q.runeId === RUNE)
    return r && r.locked != null ? BigInt(String(r.locked.amount != null ? r.locked.amount : r.locked || '0')) : 0n
  }
  const destGot = (txid) => { try { const o = ordGet(`/output/${txid}:0`); const r = o.runes && o.runes[RUNE_NAME]; return r ? BigInt((r.amount ?? r) || 0) : 0n } catch { return 0n } }

  // ── S1 · all three up: the withdraw completes THROUGH the remote book-checking guardians ──
  console.log('\n─ S1 · three remotes up — the machinery, live ─')
  const A = prepareExiter('alice')
  // the books are born now (history exists): three live followers + one FROZEN at this snapshot (S4)
  for (let i = 0; i < 3; i++) spawnFollower(B_PORTS[i], `book-${i}`, 1500, RPC)
  spawnFollower(FROZEN_PORT, 'book-frozen', 3_600_000, RPC)
  for (const p of [...B_PORTS, FROZEN_PORT]) ok(await waitHttp(`http://127.0.0.1:${p}/api/kraynet/head`), `follower book :${p} is up — replayed the node's history on its own`)
  const s1 = await submitWith(A, B_PORTS)
  ok(s1.ok === true && /^[0-9a-f]{64}$/.test(s1.txid || ''), `S1: withdraw BROADCAST through the remote guardians (${String(s1.txid).slice(0, 12)}…)${s1.ok ? '' : ' — error: ' + String(s1.error).slice(0, 220)}`)
  mine(Math.max(1, info.minConfirmations)); sync()
  ok(destGot(s1.txid) === EXIT, `S1: ord confirms the SIGNED destination received exactly ${EXIT} base units on L1`)

  // ── S2 · kill ONE of three: the threshold IS the fault tolerance ──
  console.log('\n─ S2 · one guardian DOWN (2-of-3) — the fallback ─')
  g[2].kill('SIGKILL'); sleep(1)
  const B = prepareExiter('bob')
  const s2 = await submitWith(B, [B_PORTS[0], B_PORTS[1]])
  ok(s2.ok === true && /^[0-9a-f]{64}$/.test(s2.txid || ''), `S2: one daemon dead → the other two cover — the withdraw STILL completes (bridge keeps working)${s2.ok ? '' : ' — error: ' + String(s2.error).slice(0, 220)}`)
  mine(Math.max(1, info.minConfirmations)); sync()

  // ── S3 · kill TWO: fail-closed hold, funds never move, the lock survives ──
  console.log('\n─ S3 · two guardians DOWN — fail-closed, never frozen ─')
  g[1].kill('SIGKILL'); sleep(1)
  const C = prepareExiter('carol')
  const s3 = await submitWith(C, [B_PORTS[0]])
  ok(!!s3.error && /held/.test(s3.error || ''), `S3: too few guardians → withdraw HELD (fail-closed): "${String(s3.error).slice(0, 72)}…"`)
  ok(lockedOf(C.OWNER_ADDR) === EXIT, 'S3: the exit lock SURVIVES the hold — funds never moved, nothing consumed (CSV backstop untouched)')

  // ── S4 · a LAGGING-book guardian (LAG ≠ THEFT): it answers 503, the quorum is short, the withdraw is HELD ──
  // (a book that CONTRADICTS — a NO on a caught-up book — is the hermetic pot-signer suite's job: it needs a forked writer)
  console.log('\n─ S4 · a lagging-book guardian — LAG ≠ THEFT: it cannot judge, so the withdraw waits ─')
  spawnGuardian(G_PORTS[1], 1, `http://127.0.0.1:${FROZEN_PORT}`)
  ok(await waitHttp(`http://127.0.0.1:${G_PORTS[1]}/health`), 'S4: a guardian is back on :4494 — but its book is FROZEN at the deposit-era snapshot (behind the exit)')
  const s4 = await submitWith(C, [B_PORTS[0]])
  ok(!!s4.error && /held/.test(s4.error || '') && /lagging|only 1 of 2/.test(s4.error || ''), `S4: the lagging book cannot judge → 503 → the withdraw is HELD (never routed around, never a loss): "${String(s4.error).slice(0, 140)}…"`)
  ok(lockedOf(C.OWNER_ADDR) === EXIT, 'S4: the exit lock still SURVIVES — a lag is a wait, the metal never moved')

  // ── S5 · restore a good daemon: the SAME held withdraw completes — holds are liveness, never loss ──
  console.log('\n─ S5 · recovery — the hold releases, nothing was lost ─')
  const lagging = children[children.length - 1]; lagging.kill('SIGKILL'); sleep(1)
  spawnGuardian(G_PORTS[1], 1, `http://127.0.0.1:${B_PORTS[1]}`)
  ok(await waitHttp(`http://127.0.0.1:${G_PORTS[1]}/health`), 'S5: a GOOD guardian is back on :4494 (book = its live follower again; its head memory from S2 still descends)')
  const s5 = await submitWith(C, [B_PORTS[0], B_PORTS[1]])
  ok(s5.ok === true && /^[0-9a-f]{64}$/.test(s5.txid || ''), 'S5: the SAME withdraw now completes — a hold is a wait, never a loss')
  mine(Math.max(1, info.minConfirmations)); sync()
  ok(destGot(s5.txid) === EXIT, `S5: ord confirms Carol's destination received exactly ${EXIT} — through the recovered quorum`)

  // ── conservation + solvency after the whole ceremony ──
  let settled = false
  for (let i = 0; i < 12 && !settled; i++) { sleep(5); if (lockedOf(C.OWNER_ADDR) === 0n) settled = true }
  ok(settled, 'the sweep settled the last exit automatically (locks burned, no manual settle)')
  const book = jget('/api/kraynet/runes')
  const entry = (book.runes || []).find((r) => r.runeId === RUNE)
  ok(!!entry && entry.solvent !== false && book.solvent !== false, `the rune book stays SOLVENT after the whole ceremony (reserve ${entry && entry.reserve})`)

  // ── the untouched-bench proof: :4477 same PID, still never saw the ceremony rune ──
  const benchPidAfter = execFileSync('sh', ['-c', "lsof -tnP -iTCP:4477 -sTCP:LISTEN | head -1"], { encoding: 'utf8' }).trim()
  const benchRunesAfter = JSON.parse(execFileSync('curl', ['-s', 'http://127.0.0.1:4477/api/kraynet/runes'], { encoding: 'utf8' }))
  ok(benchPidAfter === benchPid && benchPid !== '', `the :4477 bench is UNTOUCHED — same PID (${benchPid}) through the whole ceremony`)
  ok(!((benchRunesAfter.runes || []).some((r) => (r.runeId || r.id) === RUNE)), 'the :4477 book never saw the ceremony rune — perfect isolation, nothing else changed')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — TIER 1 PROVEN: remote book-checking guardians co-sign the pot, tolerate a death, hold fail-closed, and recover without loss. 🛡️₿⇄₭`)
  cleanup()
  try { rmSync(DATA, { recursive: true, force: true }) } catch {}
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('✗ ceremony aborted:', e.message); cleanup(); process.exit(1) })
