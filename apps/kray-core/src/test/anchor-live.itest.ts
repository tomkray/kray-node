/**
 * THE ANCHOR, LIVE ON THE ASYNC CLOCK — proves the seal path the way signet/mainnet actually behaves:
 * the node broadcasts the cascade root's OP_RETURN but does NOT mine it (KRAY_ANCHOR_SELF_MINE=0), so the
 * anchor sits BROADCAST-but-unverified in the mempool until the WORLD confirms it. The watch must then
 * promote it to `verified` ONLY once it is buried under KRAY_ANCHOR_CONF blocks — never a beat sooner.
 *
 * It asserts, against a real regtest bitcoind:
 *   · the seal is broadcast (a real txid, in the mempool) and its OP_RETURN carries the exact committed root
 *   · it is NOT verified while unconfirmed, and NOT verified at 1 conf when the law needs 2 (no premature seal)
 *   · the watch promotes it to verified exactly when it crosses the confirmation floor, with the real height
 *   · SPV re-proves the buried anchor from raw bytes (tx→txid→merkle→header→work)
 *   · a reboot reloads the same txid from the sidecar and never re-broadcasts (idempotent)
 *
 *   KRAY_BTC_RPC_PASS=<pw> node src/test/anchor-live.itest.ts
 */
import { spawn } from 'node:child_process'
import { rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { KrayAnchor } from '../anchor/anchor.ts'
import { proveTxBuried, parseTx } from '../anchor/spv.ts'

const NET = 'regtest', PORT = 4517, BASE = `http://localhost:${PORT}`
const DATA = join(tmpdir(), `kraynet-anchorlive-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const RPC = process.env.KRAY_BTC_RPC || 'http://127.0.0.1:18454'
const RPC_USER = process.env.KRAY_BTC_RPC_USER || 'kraycore'
/** Never print this. Env wins; else the gitignored harness conf (same door as `bc`). */
function rpcPassFromHarness(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const roots = [
    process.env.HARNESS,
    join(here, '../../../../kray-net/apps/kray-net/regtest-harness'),
    join(here, '../../../../../kray-net/apps/kray-net/regtest-harness'),
  ].filter(Boolean) as string[]
  for (const root of roots) {
    const conf = join(root, 'bitcoin/bitcoin.conf')
    if (!existsSync(conf)) continue
    const m = readFileSync(conf, 'utf8').match(/rpcpassword\s*=\s*(\S+)/)
    const pw = m ? m[1].trim() : ''
    if (pw) return pw
  }
  return ''
}
const RPC_PASS = process.env.KRAY_BTC_RPC_PASS || rpcPassFromHarness()
const WALLET = process.env.KRAY_BTC_WALLET || 'kray'
const ANCHOR_CONF = 2
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string) => fetch(BASE + p).then((r) => r.json() as Promise<any>)
const jpost = (p: string, b: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json() as Promise<any>)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }

async function rpc(url: string, method: string, params: unknown[] = []): Promise<any> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64') }, body: JSON.stringify({ jsonrpc: '1.0', id: 'x', method, params }) }).then((x) => x.json() as Promise<any>)
  if (r.error) throw new Error(`${method}: ${r.error.message}`)
  return r.result
}
const btc = (m: string, p: unknown[] = []) => rpc(RPC, m, p)
const wallet = (m: string, p: unknown[] = []) => rpc(`${RPC}/wallet/${WALLET}`, m, p)
const mine = async (n: number) => { const a = await wallet('getnewaddress'); return btc('generatetoaddress', [n, a]) }
const block0 = async () => { const bs = (await jget('/api/kraynet/blocks')).blocks || []; return bs.find((b: any) => b.h === 0) || null }
// wait until a block-0 anchor entry satisfies `cond`, mining nothing (the watch does the promoting).
async function waitAnchor(cond: (b: any) => boolean, ms = 12000): Promise<any> {
  for (let i = 0; i < ms / 300; i++) { const b = await block0(); if (b && cond(b)) return b; await sleep(300) }
  return await block0()
}

function spawnNode(): any {
  return spawn('node', [SERVER], {
    env: {
      ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_TRUSTED_DEV: '1',
      KRAY_BTC_RPC: RPC, KRAY_BTC_RPC_USER: RPC_USER, KRAY_BTC_RPC_PASS: RPC_PASS, KRAY_BTC_WALLET: WALLET,
      KRAY_ANCHOR_SELF_MINE: '0',      // ← behave like signet/main: broadcast, but let the WORLD mine it
      KRAY_ANCHOR_CONF: String(ANCHOR_CONF), KRAY_ANCHOR_EVERY: '2', KRAY_ANCHOR_WATCH_MS: '1200', KRAY_SEAL_MS: '900',
    }, stdio: 'ignore',
  })
}

async function main() {
  if (!RPC_PASS) {
    console.error('anchor-live: no RPC password — set KRAY_BTC_RPC_PASS or start the lab harness (regtest-harness/bitcoin/bitcoin.conf)')
    process.exit(2)
  }
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  let child = spawnNode()
  const done = (code: number) => { try { child.kill('SIGKILL') } catch {}; rmSync(DATA, { recursive: true, force: true }); process.exit(code) }
  try {
    let up = false
    for (let i = 0; i < 80; i++) { try { if ((await jget('/health')).ok) { up = true; break } } catch {} await sleep(100) }
    ok(up, 'the node booted (async-anchor mode: KRAY_ANCHOR_SELF_MINE=0, like signet/main)')

    console.log('\n╔═ THE ANCHOR ON THE ASYNC CLOCK — broadcast now, verified only when Bitcoin buries it ═╗')

    // ── 1 · make one event so a block seals and its cascade root anchors ─────────
    await jpost('/api/kraynet/donate', { to: 'bcrt1pjvnl3tq5mcpjmncpqwtr4lf5a0ukflvlj83jj3532hzl73rjyhvqqy5j2k', sats: '5000' })

    // ── 2 · the seal is BROADCAST (real txid, in the mempool) but NOT verified ───
    const b = await waitAnchor((x) => !!x.txid)
    ok(!!b && !!b.txid && /^[0-9a-f]{64}$/.test(b.txid), `anchor #0 broadcast a real txid (${b && b.txid ? b.txid.slice(0, 16) + '…' : 'none'})`)
    ok(b && b.anchored === true && b.verified === false && (b.conf === 0 || b.conf == null), 'it is BROADCAST but NOT verified — nothing is sealed until Bitcoin buries it')
    const mem = await btc('getrawmempool')
    ok(Array.isArray(mem) && mem.includes(b.txid), 'the anchor tx really sits in bitcoind\'s mempool (unconfirmed, the honest state)')

    // ── 3 · the mempool tx carries the EXACT committed OP_RETURN ─────────────────
    const raw = await btc('getrawtransaction', [b.txid])
    const parsed = parseTx(raw)
    const opret = parsed.outputScripts.map((s: Uint8Array) => Buffer.from(s).toString('hex')).find((h: string) => h.startsWith('6a31'))
    const decoded = opret ? KrayAnchor.decode(opret.slice(4)) : null
    ok(!!decoded && decoded.blockNumber === 0 && decoded.root === b.cascadeRoot, `its OP_RETURN commits (block 0, root ${(b.cascadeRoot || '').slice(0, 12)}…) — the true cascade root`)

    // ── 4 · one confirmation is NOT enough when the law needs two (no premature seal) ─
    await mine(1)
    const b1 = await waitAnchor((x) => x.conf >= 1)
    ok(b1 && b1.conf >= 1 && b1.verified === false, `at ${b1 ? b1.conf : '?'} confirmation the anchor is STILL not verified (the law needs ${ANCHOR_CONF}) — premature sealing is impossible`)

    // ── 5 · crossing the confirmation floor PROMOTES it to verified, with the real height ─
    await mine(1)
    const b2 = await waitAnchor((x) => x.verified === true)
    ok(b2 && b2.verified === true && b2.conf >= ANCHOR_CONF, `at ${b2 ? b2.conf : '?'} confirmations the watch PROMOTED it to verified — sealed on Bitcoin, exactly on time`)
    ok(b2 && Number.isInteger(b2.btcHeight), `the anchor now carries its real Bitcoin height (${b2 && b2.btcHeight})`)

    // ── 6 · a light client re-proves the buried anchor from raw bytes (SPV) ──────
    const info = await btc('getrawtransaction', [b2.txid, true])
    const txoutproof = await btc('gettxoutproof', [[b2.txid], info.blockhash])
    const headers: string[] = []
    let hash = info.blockhash
    for (let i = 0; i < ANCHOR_CONF && hash; i++) { const h = await btc('getblockheader', [hash, true]); headers.push(await btc('getblockheader', [hash, false])); hash = h.nextblockhash }
    const buried = proveTxBuried(raw, txoutproof, headers, { net: NET, minConfirmations: ANCHOR_CONF })
    ok(buried.ok === true && buried.txid === b2.txid, 'SPV re-proves the anchor from raw bytes: merkle-proven and buried under the required work')

    // ── 7 · a reboot reloads the SAME seal from the sidecar and never re-broadcasts ─
    const memBefore = (await btc('getrawmempool')).length
    child.kill('SIGKILL'); await sleep(400); child = spawnNode()
    for (let i = 0; i < 80; i++) { try { if ((await jget('/health')).ok) break } catch {} await sleep(100) }
    await sleep(1800) // give the watch a couple of ticks post-reboot
    const b3 = await block0()
    ok(b3 && b3.txid === b2.txid && b3.verified === true, 'after a reboot the anchor is the SAME txid, still verified — reloaded from the sidecar')
    const memAfter = (await btc('getrawmempool')).length
    ok(memAfter <= memBefore, 'the reboot broadcast NO new anchor tx (idempotent — one root, one seal, forever)')

    // ── 8 · a REORG that orphans the burying block DEMOTES verified → false (never a false seal) ──
    const bhash = (await btc('getrawtransaction', [b2.txid, true])).blockhash
    await btc('invalidateblock', [bhash])          // orphan the block that buried the anchor — its tx returns to the mempool
    const demoted = await waitAnchor((x) => x.verified === false, 10000)
    ok(demoted && demoted.verified === false && demoted.txid === b2.txid, 'a reorg that orphaned the anchor DEMOTED it to verified:false — `verified` means CURRENTLY buried, never once-buried')
    // ── 9 · once re-buried, the watch RE-PROMOTES it — the seal self-heals both ways ──
    await btc('reconsiderblock', [bhash])          // restore the chain
    await mine(ANCHOR_CONF)                          // ensure it is buried to the floor again
    const rebuilt = await waitAnchor((x) => x.verified === true, 12000)
    ok(rebuilt && rebuilt.verified === true, 'once re-buried the watch RE-PROMOTED it to verified — the anchor state tracks Bitcoin in BOTH directions')

    console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — on the async clock the node NEVER claims a seal it does not have: broadcast is broadcast, verified means CURRENTLY buried (a reorg demotes it, re-burial re-promotes it), and every seal is idempotent across reboots. Ready for signet. ⚓₿`)
    done(fail ? 1 : 0)
  } catch (e) { console.error('\n✗ anchor-live error:', e); done(1) }
}
main()
