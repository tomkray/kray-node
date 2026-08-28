/**
 * SIGNET ACTIONS — every signed user action works end-to-end on a SIGNET node with tb1 addresses,
 * the exact path the explorer (kray.js KRAY.act) + KrayWallet extension drive: the node builds
 * the message (prepare), the key signs it (BIP-340), the node re-verifies p2tr(pubkey, signet)==from
 * and applies it (submit). Proves the network-aware connect fix makes the whole action surface work
 * on signet, and that a WRONG-network (bcrt1) `from` is refused.
 *
 *   node src/test/signet-actions.test.ts
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, verifySignature } from '../protocol/scheme.ts'

const NET = 'signet', PORT = 4499, BASE = `http://localhost:${PORT}`
const DATA = join(tmpdir(), `kraynet-signet-act-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const POT = 'tb1pgen56j86d8lm8364plkh22s645hpwh94lqy2gvlznzvv9vympndqyx6664'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string) => fetch(BASE + p, { signal: AbortSignal.timeout(15000) }).then((r) => r.json() as Promise<any>).catch((e) => ({ error: String(e?.message || e) }))
const jpost = (p: string, b: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(15000) }).then((r) => r.json() as Promise<any>).catch((e) => ({ error: String(e?.message || e) }))

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
// a signet wallet — tb1 address, exactly what the explorer links after the connect fix
const wallet = (tag: string) => { const sk = createHash('sha256').update('signet-act|' + tag).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { tag, sk, pk, addr: btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[toBtcNet(NET)]).address! } }

// the ONE action path the frontend uses: prepare (node builds the message) → sign → submit
async function act(w: { sk: Uint8Array; pk: string; addr: string }, action: string, params: Record<string, unknown>, fromOverride?: string) {
  const from = fromOverride || w.addr
  const prep = await jpost('/api/kraynet/prepare', { action, from, ...params })
  if (prep.error) return { error: prep.error }
  const signature = _signKrayWallet(prep.message, w.sk)
  const body: any = { action, from, ...params, nonce: prep.nonce, publicKey: w.pk, signature }
  if (prep.star != null && (params as any).star != null) body.star = prep.star   // mirror KRAY.act: echo star only when a specific star was targeted
  return jpost('/api/kraynet/submit', body)
}

async function main() {
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  // a real signet node (TRUSTED_DEV only funds the test wallets; the ACTIONS never depend on it).
  // KRAY_LAB_PROOF_MANDATORY_SEQ lifts born-strict on this DISPOSABLE bench (store.ts, the one
  // named exception — signet needs TRUSTED_DEV too, main ignores it): the exam storms the tb1
  // action surface, not the peg; proof-mandatory.test.ts pins the peg law itself.
  const child = spawn('node', [SERVER], { env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_POT_ADDRESS: POT, KRAY_TRUSTED_DEV: '1', KRAY_LAB_PROOF_MANDATORY_SEQ: String(Number.MAX_SAFE_INTEGER), KRAY_SEAL_MS: '600' }, stdio: 'ignore' })
  const done = (code: number) => { try { child.kill('SIGKILL') } catch {} rmSync(DATA, { recursive: true, force: true }); process.exit(code) }
  try {
    for (let i = 0; i < 80; i++) { try { if ((await jget('/health')).ok) break } catch {} await sleep(100) }
    console.log('\n╔═ SIGNET ACTIONS — every action, end-to-end, with tb1 addresses ══╗\n')

    const A = wallet('A'), B = wallet('B')
    ok(A.addr.startsWith('tb1p') && B.addr.startsWith('tb1p'), `the wallets are signet taproot (tb1p…) — ${A.addr.slice(0, 12)}… / ${B.addr.slice(0, 12)}…`)

    // fund A (test fixture) — the node runs on signet, the account is a tb1 address
    await jpost('/api/kraynet/donate', { to: A.addr, sats: '100' })
    ok(Number((await jget('/api/kraynet/account/' + encodeURIComponent(A.addr))).balance) === 100, 'A is funded (100 ₭) on the signet node')

    // ── INSCRIBE — born from fire, a star with content ──
    const r1 = await act(A, 'inscribe', { content: 'aurora-signet', contentType: 'text/plain' })
    ok(!r1.error && r1.star != null, `INSCRIBE works on signet → star #${r1.star} (from ${A.addr.slice(0, 10)}…)`)

    // ── NAME — a baptism ──
    const r2 = await act(A, 'name', { name: 'novasignet' })
    ok(!r2.error, 'NAME (baptism) works on signet')

    // ── TRANSFER — send ₭ to another tb1 ──
    const r3 = await act(A, 'transfer', { to: B.addr, amount: '10' })
    ok(!r3.error, 'TRANSFER ₭ to a tb1 recipient works on signet')
    ok(Number((await jget('/api/kraynet/account/' + encodeURIComponent(B.addr))).balance) === 10, 'B received exactly 10 ₭')

    // ── SENDSTAR — move a created star (the NFT) ──
    const r4 = await act(A, 'sendstar', { to: B.addr, star: String(r1.star) })
    ok(!r4.error, 'SENDSTAR (move the NFT) works on signet')
    const st = await jget('/api/kraynet/star/' + r1.star)
    ok(st && st.owner === B.addr, `the star now belongs to B (${B.addr.slice(0, 10)}…) — ownership moved on signet`)

    // ── THE NETWORK GUARD, both layers. Since the per-network law, value cannot even ARRIVE on a
    //    wrong-network address (so the old "fund it first" staging is impossible — BY LAW, which is the point):
    const bcrtFrom = _swapToBcrt(A.addr)
    // layer 1 · the mint itself refuses a bcrt1 recipient on signet — ₭ never crosses Bitcoin networks
    const fund = await jpost('/api/kraynet/donate', { to: bcrtFrom, sats: '50' })
    ok(!!fund.error && /not a signet address|never cross|network/i.test(String(fund.error)), `funding a bcrt1 on signet is REFUSED by the per-network law — "${String(fund.error).slice(0, 50)}…"`)
    // layer 2 · the SIGNATURE law itself: on a signet node, a bcrt1 `from` can never verify — the key derives tb1
    ok(verifySignature(bcrtFrom, transferMessage(NET, bcrtFrom, B.addr, 1n, 0), _signKrayWallet(transferMessage(NET, bcrtFrom, B.addr, 1n, 0), A.sk), A.pk, 'kraywallet', toBtcNet(NET)) === false,
      'a bcrt1 (regtest) address is REFUSED on signet — the key derives tb1, its signature cannot verify as bcrt1')
    // layer 3 · and end-to-end, a submit from that bcrt1 is refused by the node with NOTHING mutated
    const bBefore = Number((await jget('/api/kraynet/account/' + encodeURIComponent(B.addr))).balance)
    const wrongMsg = transferMessage(NET, bcrtFrom, B.addr, 1n, 0)
    const bad = await jpost('/api/kraynet/submit', { action: 'transfer', from: bcrtFrom, to: B.addr, amount: '1', nonce: 0, publicKey: A.pk, signature: _signKrayWallet(wrongMsg, A.sk), scheme: 'kraywallet' })
    const bAfter = Number((await jget('/api/kraynet/account/' + encodeURIComponent(B.addr))).balance)
    ok(!!bad.error && bAfter === bBefore, `a submit from the bcrt1 is REFUSED end-to-end and mutates nothing — "${String(bad.error).slice(0, 44)}…" (a wrong-net from can also never be funded, by layer 1)`)

    // ── conservation holds after the whole signet session ──
    const o = await jget('/api/kraynet/overview')
    ok(o.network === 'signet', 'the node reports network: signet (what the explorer reads to link tb1)')
    ok(o.conserves === true, 'conservation holds after every signet action')

    console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — every action works on signet with tb1 addresses; wrong-network is refused. ⛓₭\n`)
    done(fail ? 1 : 0)
  } catch (e) { console.error('\n✗ signet-actions error:', e); done(1) }
}

// re-encode a tb1/bc1 address to bcrt1 (regtest) — same key, to prove the node refuses the wrong network
function _swapToBcrt(addr: string): string {
  const CS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l', GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3], B32M = 0x2bc830a3
  const pmod = (v: number[]) => { let c = 1; for (const x of v) { const t = c >> 25; c = ((c & 0x1ffffff) << 5) ^ x; for (let i = 0; i < 5; i++) if ((t >> i) & 1) c ^= GEN[i] } return c }
  const hexp = (h: string) => { const o: number[] = []; for (let i = 0; i < h.length; i++) o.push(h.charCodeAt(i) >> 5); o.push(0); for (let i = 0; i < h.length; i++) o.push(h.charCodeAt(i) & 31); return o }
  const cksum = (h: string, d: number[], con: number) => { const v = hexp(h).concat(d).concat([0, 0, 0, 0, 0, 0]), m = pmod(v) ^ con, r: number[] = []; for (let i = 0; i < 6; i++) r.push((m >> (5 * (5 - i))) & 31); return r }
  const a = addr.toLowerCase(), pos = a.lastIndexOf('1'), dp = a.slice(pos + 1)
  const data: number[] = []; for (const ch of dp) data.push(CS.indexOf(ch))
  const payload = data.slice(0, data.length - 6), full = payload.concat(cksum('bcrt', payload, B32M))
  let out = 'bcrt1'; for (const f of full) out += CS.charAt(f); return out
}
main()
