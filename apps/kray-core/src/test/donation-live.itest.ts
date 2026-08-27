/**
 * THE MINT GATE, LIVE OVER HTTP — on a network with NO proof-of-work floor (regtest/test), a real
 * server configured with an anchoring-pot address refuses EVERY forgeable on-ramp and mints nothing
 * from a client's word. It proves the HTTP boundary of the mint gate:
 *   · the dev {to, sats} shortcut is disabled (only a proof mints)      → refused
 *   · a client-supplied {proof} is forgeable-for-free on a zero-work net → refused, points to {txid}
 *   · nothing minted: the donor's balance never moves
 * The node-fetched {txid} path (re-proven against the node's OWN bitcoind) is the only trustworthy
 * source here; the REAL mint over HTTP is proven live against a real regtest bitcoind by
 * `donate-node-e2e.mjs`, and the proof-verification LOGIC (accept a real donation, refuse every
 * forgery, credit once per outpoint) by the standalone `donation-proof.test.ts`. This test guards the
 * one thing those two cannot: that the wire itself never trusts a fabricated proof on a free network.
 *
 *   node src/test/donation-live.itest.ts
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _hexToBytes, _generateKeyPair, scriptOfAddress } from '../protocol/scheme.ts'
import { checkProofOfWork, sha256d, donorOpReturnScriptHex } from '../anchor/spv.ts'

const NET = 'regtest', PORT = 4502, BASE = `http://localhost:${PORT}`
const DATA = join(tmpdir(), `kraynet-donlive-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string) => fetch(BASE + p).then((r) => r.json() as Promise<any>)
const jpost = (p: string, b: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json() as Promise<any>)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const refused = (r: any, m: string) => { const good = r && !!r.error; if (good) pass++; else fail++; console.log(`   ${good ? '✓ REFUSED' : '✗ ACCEPTED (BUG!)'} — ${m}${good ? ` (“${String(r.error).slice(0, 56)}…”)` : ''}`) }

// ── the pot + a donor, as real regtest Taproot addresses (valid x-only keys) ──
const { publicKeyHex: POT_KEY } = _generateKeyPair(createHash('sha256').update('donlive|pot').digest())
const { publicKeyHex: DONOR_KEY } = _generateKeyPair(createHash('sha256').update('donlive|donor').digest())
const POT_ADDR = btc.p2tr(_hexToBytes(POT_KEY), undefined, NETWORKS[toBtcNet(NET)]).address!
const DONOR_ADDR = btc.p2tr(_hexToBytes(DONOR_KEY), undefined, NETWORKS[toBtcNet(NET)]).address!
const POT_SCRIPT = scriptOfAddress(POT_ADDR, toBtcNet(NET))

// ── fixture builders (regtest), identical shape to donation-proof.test ────────
const u64le = (n: bigint): string => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b.toString('hex') }
const pushScript = (hex: string): string => (hex.length / 2).toString(16).padStart(2, '0') + hex
function tx(outs: Array<{ sats: bigint; script: string }>): string {
  const outHex = outs.map((o) => u64le(o.sats) + pushScript(o.script)).join('')
  return ['01000000', '01', '00'.repeat(32), 'ffffffff', '00', 'ffffffff', outs.length.toString(16).padStart(2, '0'), outHex, '00000000'].join('')
}
function mineHeader(prevInternal: Buffer, merkleRootInternal: Buffer): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); merkleRootInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000, 68); h.writeUInt32LE(0x207fffff, 72)
  for (let nonce = 0; nonce < 2_000_000; nonce++) { h.writeUInt32LE(nonce, 76); if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h }
  throw new Error('could not mine a regtest header')
}
function txoutProof(header: Buffer, txidInternal: Buffer): string {
  return Buffer.concat([header, Buffer.from([1, 0, 0, 0]), Buffer.from([1]), txidInternal, Buffer.from([1]), Buffer.from([0x01])]).toString('hex')
}
function bury(rawTx: string, depth = 3): { rawTx: string; txoutproof: string; headers: string[] } {
  const txidInternal = sha256d(Buffer.from(rawTx, 'hex'))
  const headers: Buffer[] = [mineHeader(Buffer.alloc(32), txidInternal)]
  for (let i = 1; i < depth; i++) headers.push(mineHeader(sha256d(headers[i - 1]), Buffer.alloc(32, i + 5)))
  return { rawTx, txoutproof: txoutProof(headers[0], txidInternal), headers: headers.map((h) => h.toString('hex')) }
}

async function main() {
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  const child = spawn('node', [SERVER], { env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_POT_ADDRESS: POT_ADDR, KRAY_DONATION_CONF: '2' }, stdio: 'ignore' })
  const done = (code: number) => { try { child.kill('SIGKILL') } catch {}; rmSync(DATA, { recursive: true, force: true }); process.exit(code) }
  try {
    for (let i = 0; i < 60; i++) { try { if ((await jget('/health')).ok) break } catch {} await sleep(100) }
    console.log('\n╔═ THE MINT GATE, LIVE — on a free network, no word mints ══════════╗')
    console.log(`   pot ${POT_ADDR.slice(0, 18)}…  donor ${DONOR_ADDR.slice(0, 18)}…`)

    // ── 0 · the donation contract the node publishes to clients ──────────────
    const info = await jget('/api/kraynet/donation/info')
    ok(info.configured === true && info.potAddress === POT_ADDR && info.proofRequired === true && info.minConfirmations === 2,
      'the node publishes the donation contract: pot address, proof-required (no dev shortcut), min-confirmations')

    // ── 1 · the dev {to, sats} mint is DISABLED (value from a client field) ──
    refused(await jpost('/api/kraynet/donate', { to: DONOR_ADDR, sats: '100000' }), 'the dev {to, sats} mint (value invented from a client field, no proof)')

    // ── 2 · a PERFECT client-supplied {proof} is refused on a zero-work net ──
    // it pays the real pot, commits the donor, is buried 3 deep — flawless. And still refused, because
    // on a network with no PoW floor those headers cost nothing to fabricate: a proof is only as good as
    // the work behind it. The only trustworthy source here is the node's OWN bitcoind, via {txid}.
    const perfect = tx([{ sats: 100_000n, script: POT_SCRIPT }, { sats: 0n, script: donorOpReturnScriptHex(DONOR_ADDR) }])
    const r = await jpost('/api/kraynet/donate', { proof: bury(perfect) })
    refused(r, 'a FLAWLESS but client-supplied {proof} (forgeable-for-free on a zero-work network)')
    ok(/proof-of-work floor|forged for free|send the confirmed \{txid\}/i.test(String(r.error || '')), 'the refusal names the remedy: send the confirmed {txid} and the node re-proves it against its own bitcoind')

    // ── 3 · nothing minted — the donor's balance never moved ─────────────────
    const bal = (await jget('/api/kraynet/profile/' + encodeURIComponent(DONOR_ADDR))).balance
    ok(bal === '0' || bal === 0, 'the refused proof minted NOTHING — the donor balance is still 0')
    const o = await jget('/api/kraynet/overview')
    ok(BigInt(o.supply.emitted) === 0n, 'total emitted is 0 — not one ₭ was invented from an unbacked proof')

    console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — over HTTP on a free network, both dev on-ramps are closed and no client's word mints a ₭; only a {txid} the node re-proves against its own bitcoind can. The REAL proof-mint is proven live in donate-node-e2e; the proof LOGIC in donation-proof.test. ₿→₭🛡️`)
    done(fail ? 1 : 0)
  } catch (e) { console.error('\n✗ live donate error:', e); done(1) }
}
main()
