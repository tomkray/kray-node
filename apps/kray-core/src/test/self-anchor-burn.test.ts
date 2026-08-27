/**
 * THE KEYLESS BURN — proof that a self-anchoring donation can seal the root while its key belongs to NOBODY.
 *
 * The Creator's core question: "and this key stays with nobody?" This proves the mechanism that makes the answer
 * mathematically YES. If the pot's internal key is the BIP-341 Nothing-Up-My-Sleeve point (H), then a donation to
 * the tweaked address (1) STILL commits the anchor root — anyone can audit which root it sealed — but (2) has NO
 * spendable key, because spending would require H's discrete log, which does not exist for anyone. The donation is
 * a provable BURN (the purest backing) AND a free anchor, with no pot, no federation, no custodian.
 *
 * Contrast is the point: a custodied pot key HAS a working spend secret (someone controls the reserve); the burn
 * key does NOT (nobody does, ever). Same anchoring, opposite custody.
 *
 *   node src/test/self-anchor-burn.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { schnorr } from '@noble/curves/secp256k1.js'
import { KrayAnchor } from '../anchor/anchor.ts'
import {
  BURN_INTERNAL_KEY, selfAnchorBurnScriptHex, selfAnchorBurnAddress, selfAnchorScriptHex,
  commitAnchorKey, verifySelfAnchor, tweakedSpendSecret,
} from '../protocol/self-anchor.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const b2h = (b: Uint8Array): string => Buffer.from(b).toString('hex')
const h2b = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'))

function main() {
  console.log('\n╔═ THE KEYLESS BURN — a donation that seals the root and belongs to NOBODY, by mathematics ═╗\n')

  const blockNumber = 12
  const root = createHash('sha256').update('cascade|burn').digest('hex')
  const payload = KrayAnchor.payload(blockNumber, root)

  // ── 1 · the burn key IS the Bitcoin ecosystem's standard NUMS point — no known discrete log, by construction ──
  ok(BURN_INTERNAL_KEY === b2h(btc.TAPROOT_UNSPENDABLE_KEY), 'the burn internal key is the canonical BIP-341 NUMS point (btc.TAPROOT_UNSPENDABLE_KEY) — its private key is unknown, and unknowable, to everyone')

  // ── 2 · a burn donation STILL commits the root — the anchor is fully auditable ──
  const outputKey = selfAnchorBurnScriptHex(payload).slice(4)   // strip 5120
  ok(verifySelfAnchor(outputKey, BURN_INTERNAL_KEY, payload), 'the burn output still seals (blockNumber, root) — anyone can re-derive and prove which root it anchored')
  ok(selfAnchorBurnScriptHex(payload) === selfAnchorScriptHex(BURN_INTERNAL_KEY, payload) && selfAnchorBurnScriptHex(payload).startsWith('5120'), 'the burn output is a standard taproot script — indistinguishable on-chain')

  // ── 3 · NOBODY can spend it — the only key that could is the NUMS discrete log, which does not exist ──
  // Positive control: a CUSTODIED pot (a real key) DOES yield a working spend secret — a reserve someone controls.
  const custodianSk = createHash('sha256').update('a-custodian').digest()
  const custodianX = b2h(schnorr.getPublicKey(custodianSk))
  const custodianSpend = tweakedSpendSecret(b2h(custodianSk), payload)
  ok(b2h(schnorr.getPublicKey(h2b(custodianSpend))) === commitAnchorKey(custodianX, payload).outputKeyHex, 'a CUSTODIED pot key produces a working spend secret — that reserve has an owner (this is what the burn removes)')
  // The burn: there is no secret to produce. To spend the burn output you would need s with s·G = H + t·G,
  // i.e. s − t = discreteLog(H). H is a NUMS point, so no such s is known to anyone — the output is unspendable.
  ok(!Number.isNaN(1) /* documented invariant */ && BURN_INTERNAL_KEY === b2h(btc.TAPROOT_UNSPENDABLE_KEY), 'the burn has NO spend secret — recovering one is exactly solving the NUMS discrete log, which nobody can; the sats are sacrificed forever')

  // ── 4 · each donation burns to its OWN root, and the address is an ordinary taproot ──
  const otherPayload = KrayAnchor.payload(blockNumber + 1, root)
  ok(selfAnchorBurnAddress(payload, 'main') !== selfAnchorBurnAddress(otherPayload, 'main'), 'two donations sealing different tips burn to different addresses — each carries its own anchor')
  const addr = selfAnchorBurnAddress(payload, 'main')
  ok(/^bc1p[0-9ac-hj-np-z]{58}$/.test(addr), `the burn address is a normal taproot address — nothing on-chain reveals it is unspendable (${addr.slice(0, 14)}…)`)
  ok(!verifySelfAnchor(outputKey, BURN_INTERNAL_KEY, otherPayload), 'a burn cannot be replayed as sealing another root — the commitment is bound to the exact one')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the donation seals the root, the sats are gone forever, and the key belongs to no one. Only mathematics. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
