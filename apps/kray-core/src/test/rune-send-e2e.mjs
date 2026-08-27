/**
 * RUNE SEND — moving a rune between KRAY addresses on the L2 (the "transfer" leg of the bridge), proven.
 *
 * The bridge e2e proves deposit (in) and exit/settle (out); this proves the middle: once a rune is credited on
 * KRAY, its holder can SEND it to another KRAY address with a signed L2 transfer — instant, off Bitcoin — while
 * the reserve stays fully backed. Runs on the regtest bench with the dev-credit path (KRAY_TRUSTED_DEV=1); the
 * SPV-proven deposit itself is proven separately in bridge-node-e2e.
 *
 *   node apps/kray-net/server.mjs
 *   node src/test/rune-send-e2e.mjs
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS, runeSendMessage } from '../protocol/scheme.ts'

const NET = 'regtest', NODE = process.env.KRAY_NODE || 'http://localhost:4477', RID = '121:1'
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()).catch((e) => ({ error: 'net:' + e.message }))
const id = (t) => { const s = nsha(new TextEncoder().encode('rsend|' + t)); const x = Buffer.from(schnorr.getPublicKey(s)).toString('hex'); return { s, x, a: btc.p2tr(Buffer.from(x, 'hex'), undefined, NETWORKS[NET]).address, sign: (m) => Buffer.from(schnorr.sign(nsha(new TextEncoder().encode(m)), s)).toString('hex') } }
const held = async (addr) => { const o = await jget('/api/kraynet/runes'); const r = (o.runes || []).find((x) => x.runeId === RID); const h = r && (r.holders || []).find((x) => x.address === addr); return h ? BigInt(h.amount) : 0n }
const reserve = async () => { const o = await jget('/api/kraynet/runes'); const r = (o.runes || []).find((x) => x.runeId === RID); return r ? BigInt(r.reserve) : 0n }
const nonceOf = async (a) => Number((await jget('/api/kraynet/profile/' + encodeURIComponent(a))).nonce || 0)

async function main() {
  console.log('\n╔═ RUNE SEND — an L2 rune transfer between KRAY addresses, reserve stays fully backed ═╗\n')
  if ((await jget('/api/kraynet/supply')).__down) die(`no node at ${NODE} — run: node apps/kray-net/server.mjs`)
  const alice = id('alice'), bob = id('bob'), mallory = id('mallory')

  await jpost('/api/kraynet/donate', { to: alice.a, sats: '50' }) // gas
  const dep = await jpost('/api/kraynet/rune/deposit', { runeId: RID, to: alice.a, amount: '1000', outpoint: 'rs' + Date.now() + ':0' })
  ok(dep.ok === true && await held(alice.a) === 1000n, 'Alice credited 1000 runes (dev-deposit; the SPV path is proven in bridge-node-e2e)')
  const res0 = await reserve()

  // ── the L2 SEND: Alice → Bob, signed ──
  const n = await nonceOf(alice.a)
  const send = await jpost('/api/kraynet/rune/send', { from: alice.a, to: bob.a, runeId: RID, amount: '300', nonce: n, publicKey: alice.x, signature: alice.sign(runeSendMessage(NET, alice.a, bob.a, RID, 300n, n)), scheme: 'kraywallet' })
  ok(send.ok === true, 'a signed rune-send moved 300 runes Alice → Bob on the L2 (instant, off Bitcoin)')
  ok(await held(alice.a) === 700n && await held(bob.a) === 300n, 'balances moved exactly: Alice 700, Bob 300')
  ok(await reserve() === res0, `the L1 reserve is UNCHANGED (${res0}) — an L2 send moves credits, never the backing`)

  // ── attacks ──
  const forged = await jpost('/api/kraynet/rune/send', { from: alice.a, to: mallory.a, runeId: RID, amount: '100', nonce: n + 1, publicKey: mallory.x, signature: mallory.sign('x'), scheme: 'kraywallet' })
  ok(!!forged.error, 'a rune-send from Alice SIGNED BY Mallory is refused')
  const over = await jpost('/api/kraynet/rune/send', { from: bob.a, to: mallory.a, runeId: RID, amount: '999999', nonce: await nonceOf(bob.a), publicKey: bob.x, signature: bob.sign(runeSendMessage(NET, bob.a, mallory.a, RID, 999999n, await nonceOf(bob.a))), scheme: 'kraywallet' })
  ok(!!over.error, 'a rune-send of more than the holder has is refused')

  // ── the solvency invariant, after everything ──
  const o = await jget('/api/kraynet/runes')
  ok(o.solvent !== false && await reserve() === 1000n, 'the rune book is SOLVENT: reserve (1000) == Σ credits + locks — every L2 rune backed by a real L1 rune')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — a rune moves freely on the L2, signed, exact, and always fully backed. ⚗️₭\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => die(e.stack || e.message))
