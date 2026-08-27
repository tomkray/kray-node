/**
 * SELF-ANCHORING DONATIONS — Phase 3 lever 1, PROVEN before it is ever wired.
 *
 * The claim: a donation output can COMMIT the anchor payload in its own taproot key (pay-to-contract), so each
 * donation is simultaneously a proof-of-donation and an anchor of the KRAY root — no OP_RETURN, no custodial fee
 * pot, no extra bytes. This test proves the primitive is (1) standard BIP-341 taproot — byte-identical to
 * @scure/btc-signer's own tweak, so it is consensus/relay/wallet-compatible; (2) an honest commitment — a verifier
 * with (P, blockNumber, root) can re-derive the exact output key, and any tampered payload fails; (3) SPENDABLE —
 * the pot key holder can always sweep the sats, so nothing is ever stranded; (4) stealth — the address is an
 * ordinary taproot address, indistinguishable on-chain.
 *
 *   node src/test/self-anchor.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { schnorr } from '@noble/curves/secp256k1.js'
import { NETWORKS } from '../protocol/scheme.ts'
import { KrayAnchor } from '../anchor/anchor.ts'
import {
  anchorCommitment, tweakKey, commitAnchorKey, selfAnchorAddress,
  verifySelfAnchor, tweakedSpendSecret, addressFromOutputKey,
} from '../protocol/self-anchor.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const b2h = (b: Uint8Array): string => Buffer.from(b).toString('hex')
const h2b = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'))
const seed = (tag: string): Uint8Array => createHash('sha256').update('self-anchor|' + tag).digest()
const rootFrom = (tag: string): string => createHash('sha256').update('root|' + tag).digest('hex')

function main() {
  console.log('\n╔═ SELF-ANCHORING DONATIONS — the donation IS the anchor: standard, honest, spendable, stealth ═╗\n')

  // a pot key (the network publishes P; the secret d lives with the reserve's custody — a federation, in the end)
  const potSk = seed('pot')
  const potX = b2h(schnorr.getPublicKey(potSk))   // x-only internal key P

  // ── 1 · STANDARD BIP-341 — my tweak equals @scure/btc-signer's, so it is real taproot ──
  {
    let all = true, addrAll = true
    for (const tag of ['a', 'b', 'c', 'd']) {
      const x = b2h(schnorr.getPublicKey(seed('k|' + tag)))
      const mine = tweakKey(x, '').outputKeyHex                       // empty root = a plain single-key taproot
      const ref = b2h(btc.p2tr(h2b(x)).tweakedPubkey)
      if (mine !== ref) all = false
      // and the address encoder matches @scure for the same output key, on every network
      for (const net of ['main', 'signet', 'regtest'] as const) {
        if (addressFromOutputKey(ref, net) !== btc.p2tr(h2b(x), undefined, NETWORKS[net]).address) addrAll = false
      }
    }
    ok(all, 'the key tweak is byte-identical to @scure/btc-signer — this IS a standard BIP-341 taproot output')
    ok(addrAll, 'the Bech32m address encoder matches @scure exactly on main / signet / regtest')
  }

  // ── 2 · COMMIT → VERIFY — a donor's output seals exactly one (blockNumber, root) ──
  const blockNumber = 42
  const root = rootFrom('block42')
  const payload = KrayAnchor.payload(blockNumber, root)               // the 49-byte anchor commitment bytes
  const out = commitAnchorKey(potX, payload)
  ok(verifySelfAnchor(out.outputKeyHex, potX, payload), 'a full-node auditor re-derives the committed key from (P, blockNumber, root) — the anchor verifies')
  ok(anchorCommitment(payload).length === 64 && out.outputKeyHex.length === 64, 'the commitment is 32 bytes and the output key is a 32-byte x-only taproot key')

  // ── 3 · TAMPER — any change to what was anchored breaks the proof ──
  ok(!verifySelfAnchor(out.outputKeyHex, potX, KrayAnchor.payload(blockNumber, rootFrom('other'))), 'a different root does NOT verify against this output — the commitment is bound to the exact root')
  ok(!verifySelfAnchor(out.outputKeyHex, potX, KrayAnchor.payload(blockNumber + 1, root)), 'a different block number does NOT verify — height is committed too')
  const otherPotX = b2h(schnorr.getPublicKey(seed('pot2')))
  ok(!verifySelfAnchor(out.outputKeyHex, otherPotX, payload), "another pot key does NOT verify this output — the seal is bound to THIS network's key")

  // ── 4 · SPENDABLE — the pot key holder can always sweep; no sats are ever stranded ──
  const spendSk = tweakedSpendSecret(b2h(potSk), payload)
  const spendPub = b2h(schnorr.getPublicKey(h2b(spendSk)))
  ok(spendPub === out.outputKeyHex, 'the tweaked spend key’s public key equals the output key — the funds are controllable')
  const msg = createHash('sha256').update('spend-the-self-anchor').digest()
  const sig = schnorr.sign(msg, h2b(spendSk))
  ok(schnorr.verify(sig, msg, h2b(out.outputKeyHex)), 'a key-path Schnorr signature with the tweaked key validates against the output — the donation is truly spendable')

  // ── 5 · DETERMINISTIC + ISOLATED + STEALTH ──
  ok(selfAnchorAddress(potX, payload, 'signet') === selfAnchorAddress(potX, payload, 'signet'), 'the same (P, payload) always yields the same address — reproducible for the donor and the auditor')
  ok(selfAnchorAddress(potX, payload, 'signet') !== selfAnchorAddress(potX, KrayAnchor.payload(43, root), 'signet'), 'two different anchors pay two different addresses — no collision across seals')
  const addr = selfAnchorAddress(potX, payload, 'main')
  ok(/^bc1p[0-9ac-hj-np-z]{58}$/.test(addr), `the address is an ordinary taproot address — indistinguishable on-chain (${addr.slice(0, 14)}…)`)
  ok(selfAnchorAddress(potX, payload, 'regtest').startsWith('bcrt1p') && selfAnchorAddress(potX, payload, 'signet').startsWith('tb1p'), 'network HRPs are correct — bcrt1p / tb1p / bc1p')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the donation carries the anchor in its own key: standard, honest, spendable, invisible. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
