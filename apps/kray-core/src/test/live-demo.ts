/**
 * KRAYNET v2 — a LIVE end-to-end demo over real HTTP (human-readable, not a pass/fail test).
 *   node src/test/v2-live-demo.ts
 * Boots server on a throwaway port + data dir, then drives the full wallet flow and prints
 * the network coming alive: a donation mints ₭, a signed transfer moves it, an inscribe burns
 * 1 ₭ to birth a mythic star, a baptism names another, and the whole state commits to one
 * Bitcoin-ready anchor. The server is killed at the end.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes } from '../protocol/scheme.ts'

const NET = 'regtest', PORT = 4493, BASE = `http://localhost:${PORT}`
const DATA = join(tmpdir(), `kraynet-demo-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const wallet = (tag: string) => { const sk = createHash('sha256').update('kraynet-demo|' + tag, 'utf8').digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk, addr: btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[toBtcNet(NET)]).address! } }
const jget = (p: string) => fetch(BASE + p).then((r) => r.json() as Promise<any>)
const jpost = (p: string, b: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json() as Promise<any>)
const n = (v: unknown) => Number(v).toLocaleString()
const line = (s = '') => console.log(s)

async function signedSubmit(w: { sk: Uint8Array; pk: string; addr: string }, action: string, params: Record<string, unknown>) {
  const prep = await jpost('/api/kraynet/prepare', { action, from: w.addr, ...params })
  if (prep.error) throw new Error('prepare: ' + prep.error)
  const signature = _signKrayWallet(prep.message, w.sk)
  const out = await jpost('/api/kraynet/submit', { action, from: w.addr, ...params, nonce: prep.nonce, publicKey: w.pk, signature })
  if (out.error) throw new Error('submit: ' + out.error)
  return { prep, out }
}

async function main() {
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  const child = spawn('node', [SERVER], { env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET }, stdio: 'ignore' })
  const done = (code: number) => { try { child.kill('SIGKILL') } catch {} rmSync(DATA, { recursive: true, force: true }); process.exit(code) }
  try {
    for (let i = 0; i < 60; i++) { try { if ((await jget('/health')).ok) break } catch {} await sleep(100) }
    const A = wallet('alice'), B = wallet('bob')
    line('\n╔══════════════════════════════════════════════════════════════╗')
    line('║   KRAYNET v2 — LIVE, over HTTP, on a fresh journal            ║')
    line('╚══════════════════════════════════════════════════════════════╝')
    line(`  node: ${BASE}   ·   alice ${A.addr.slice(0, 16)}…   bob ${B.addr.slice(0, 16)}…`)

    line('\n─ 1 · PROOF OF DONATION ─────────────────────────────────────────')
    const d = await jpost('/api/kraynet/donate', { to: A.addr, sats: '5000' })
    line(`  alice donates 5,000 sats → mints ${n((await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr))).balance)} ₭   (1 sat = 1 ₭, no premine)`)
    line(`  the anchoring pot now holds ${n(d.pot.held)} sats · minted ${n(d.pot.minted)} ₭`)

    line('\n─ 2 · A SIGNED ₭ TRANSFER (the Supreme Law) ─────────────────────')
    await signedSubmit(A, 'transfer', { to: B.addr, amount: '100' })
    const pa = await jget('/api/kraynet/profile/' + encodeURIComponent(A.addr)), pb = await jget('/api/kraynet/profile/' + encodeURIComponent(B.addr))
    line(`  alice → bob: 100 ₭ (+1 ₭ fee to the Treasury)`)
    line(`  alice ${n(pa.balance)} ₭   ·   bob ${n(pb.balance)} ₭`)

    line('\n─ 3 · BORN FROM FIRE (inscribe burns 1 ₭ → a star) ──────────────')
    await signedSubmit(A, 'inscribe', { content: 'Hello, KRAYNET — born from fire.', contentType: 'text/plain' })
    const s0 = await jget('/api/kraynet/star/0')
    line(`  alice inscribes → star #${s0.no} is born · rarity ${s0.rarity.toUpperCase()} (the first ever written)`)
    line(`  content hash ${String(s0.contentHash).slice(0, 24)}…  owned by ${String(s0.owner).slice(0, 16)}…`)

    line('\n─ 4 · A BAPTISM (a name, unique forever) ────────────────────────')
    await signedSubmit(B, 'name', { name: 'bob' })
    const s1 = await jget('/api/kraynet/star/1')
    line(`  bob baptises → star #${s1.no} carries the name “${s1.name}” · ${s1.rarity.toUpperCase()}`)

    line('\n─ 5 · THE WHOLE NETWORK, PROVEN ─────────────────────────────────')
    const o = await jget('/api/kraynet/overview')
    line(`  supply:   ${n(o.supply.circulating)} ₭ circulating  =  ${n(o.supply.emitted)} emitted − ${n(o.supply.burned)} burned`)
    line(`  stars:    ${n(o.starCount)} born from fire`)
    line(`  laws:     conserves=${o.conserves}  ·  backed=${o.backed} (every ₭ from a real sat)`)
    line(`  cascade:  ${o.cascadeRoot}`)
    const anc = await jget('/api/kraynet/anchor/payload')
    line(`  anchor:   ${anc.payload}`)
    line(`            └ the exact 49-byte OP_RETURN — ready to write to Bitcoin`)

    line('\n─ 6 · THE WEB EXPLORER ──────────────────────────────────────────')
    for (const [path, name] of [['/', 'network'], ['/profile/' + encodeURIComponent(A.addr), 'profile'], ['/star/0', 'star #0'], ['/runes', 'runes'], ['/docs', 'docs']] as const) {
      const r = await fetch(BASE + path); line(`  ${r.status === 200 ? '✓' : '✗'} ${String(name).padEnd(9)} ${BASE}${path.length > 40 ? path.slice(0, 40) + '…' : path}`)
    }

    line('\n─ 7 · REBOOT FROM DISK (the verifier) ───────────────────────────')
    child.kill('SIGKILL'); await sleep(400)
    const child2 = spawn('node', [SERVER], { env: { ...process.env, KRAY_PORT: String(PORT + 1), KRAY_DATA: DATA, KRAY_NET: NET }, stdio: 'ignore' })
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT + 1}/health`).then((r) => r.json())).ok) break } catch {} await sleep(100) }
    const o2 = await fetch(`http://localhost:${PORT + 1}/api/kraynet/overview`).then((r) => r.json())
    line(`  a fresh node replayed the journal from disk:`)
    line(`  cascade root ${o2.cascadeRoot === o.cascadeRoot ? 'IDENTICAL ✓  (byte-exact)' : 'DIVERGED ✗'}   ·   ${n(o2.starCount)} stars   ·   ${n(o2.supply.circulating)} ₭`)
    try { child2.kill('SIGKILL') } catch {}

    line('\n╚═ KRAYNET v2 is live, proven, and atemporal. ₭⭐ ═══════════════╝\n')
    done(0)
  } catch (e) { console.error('\n✗ demo error:', e); done(1) }
}
main()
