/**
 * Byte-for-byte proof that a KRAY-CORE account address IS the Bitcoin taproot
 * address of the same key — not one letter, not one byte different.
 *   node src/test/address-parity.test.ts
 *
 * Two INDEPENDENT ground truths, neither relying on trusting @scure:
 *  (A) ENCODING — the published BIP-86 (address ↔ output-key) pair. We decode
 *      the official Bitcoin address to its output key and re-encode it, and both
 *      match the spec exactly → our bech32m is Bitcoin's bech32m.
 *  (B) THE TWEAK — we recompute the BIP-341 taproot tweak BY HAND from the spec
 *      formula (taggedHash "TapTweak", point add) with @noble, and assert it
 *      equals @scure's p2tr output for hundreds of random keys → our internal→
 *      output derivation is Bitcoin's BIP-341.
 * Encoding(Bitcoin) ∘ Tweak(Bitcoin) = our address = the Bitcoin address.
 */
import * as btc from '@scure/btc-signer'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { createHash, randomBytes } from 'node:crypto'
import { addressOf, verifyKrayWallet, NETWORKS, _generateKeyPair, _signKrayWallet, transferMessage } from '../protocol/scheme.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const sha = (b: Uint8Array | Buffer) => new Uint8Array(createHash('sha256').update(b).digest())

// hand-rolled BIP-341 key-path taproot tweak (no script tree), straight from the spec
const Pt = secp256k1.Point
const N = Pt.Fn.ORDER
function taggedHash(tag: string, msg: Uint8Array): Uint8Array {
  const t = sha(Buffer.from(tag, 'utf8'))
  return sha(Buffer.concat([Buffer.from(t), Buffer.from(t), Buffer.from(msg)]))
}
function bip341OutputKey(internalXonlyHex: string): string {
  const P = Pt.fromHex('02' + internalXonlyHex) // lift_x → even-y internal point
  const th = taggedHash('TapTweak', Buffer.from(internalXonlyHex, 'hex'))
  const t = BigInt('0x' + Buffer.from(th).toString('hex')) % N
  const Q = P.add(Pt.BASE.multiply(t)) // Q = P + t·G
  return Q.toHex(true).slice(2) // x-only output key (drop the 02/03 prefix)
}

// ── official BIP-86 vector (bitcoin/bips bip-0086), Account 0, address 0 ──────
const BIP86_ADDR = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr'
const BIP86_OUT = 'a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c'

function main() {
  // A · ENCODING is byte-for-byte Bitcoin (published BIP-86 address ↔ output key)
  const dec = btc.Address(NETWORKS.main).decode(BIP86_ADDR) as { type: string; pubkey?: Uint8Array }
  ok(dec.type === 'tr' && hex(dec.pubkey!) === BIP86_OUT, 'decode(official BIP-86 address) === the official output key, exactly')
  const reEnc = btc.Address(NETWORKS.main).encode({ type: 'tr', pubkey: Buffer.from(BIP86_OUT, 'hex') } as never)
  ok(reEnc === BIP86_ADDR, 'encode(official output key) === the official BIP-86 address, exactly (our bech32m IS Bitcoin\'s)')

  // B · THE TWEAK is BIP-341 — hand-computed spec formula == @scure p2tr, for many keys
  let tweakChecks = 0
  for (let i = 0; i < 300; i++) {
    const xonly = schnorr.getPublicKey(randomBytes(32)) // a BIP-340 x-only internal key
    const xhex = hex(xonly)
    const mine = bip341OutputKey(xhex)
    const scure = hex(btc.p2tr(xonly, undefined, NETWORKS.main).tweakedPubkey)
    if (mine !== scure) { console.error(`  ✗ tweak mismatch at ${i}: ${mine} != ${scure}`); process.exit(1) }
    tweakChecks++
  }
  ok(tweakChecks === 300, 'the BIP-341 tweak matches the hand-computed spec formula for 300 random keys')

  // C · the FULL chain, tied end to end: our address → decode → output key == hand-computed tweak
  for (let i = 0; i < 50; i++) {
    const xonly = schnorr.getPublicKey(randomBytes(32))
    const xhex = hex(xonly)
    const addr = addressOf(xhex, 'main') // OUR address for this key
    const back = btc.Address(NETWORKS.main).decode(addr) as { pubkey?: Uint8Array }
    ok(hex(back.pubkey!) === bip341OutputKey(xhex), `full chain #${i}: our bc1p address decodes to the exact BIP-341 output key`)
  }

  // D · addressOf is LITERALLY p2tr(key) — no re-hash, no prefix, no KRAY-specific twist
  const k = _generateKeyPair(randomBytes(32))
  ok(addressOf(k.publicKeyHex, 'main') === btc.p2tr(Buffer.from(k.publicKeyHex, 'hex'), undefined, NETWORKS.main).address, 'addressOf(key) === btc.p2tr(key).address — zero KRAY transform')

  // E · same KEY, network-scoped string: mainnet is the literal wallet address;
  //     the isolated regtest is the SAME key, only a different network prefix
  const mainAddr = addressOf(k.publicKeyHex, 'main')
  const regAddr = addressOf(k.publicKeyHex, 'regtest')
  ok(mainAddr.startsWith('bc1p') && regAddr.startsWith('bcrt1p') && mainAddr !== regAddr, 'mainnet=bc1p (the Bitcoin/wallet address), regtest=bcrt1p (same key)')
  const dm = btc.Address(NETWORKS.main).decode(mainAddr) as { pubkey?: Uint8Array }
  const dr = btc.Address(NETWORKS.regtest).decode(regAddr) as { pubkey?: Uint8Array }
  ok(hex(dm.pubkey!) === hex(dr.pubkey!), 'mainnet & regtest strings hold the IDENTICAL taproot output key (same coin identity)')

  // F · round-trip: a KrayWallet Schnorr signature verifies bound to that exact address
  const msg = transferMessage('mainnet', mainAddr, mainAddr, 1n, 0)
  ok(verifyKrayWallet(mainAddr, msg, _signKrayWallet(msg, k.secretKey), k.publicKeyHex, 'main'), 'a KrayWallet signature verifies against that exact taproot address')

  console.log(`\n✓ ${pass} checks passed — a KRAY account address IS the Bitcoin taproot address of the same key: bech32m encoding proven against the official BIP-86 vector, and the BIP-341 tweak proven against the hand-computed spec formula (300 keys). On mainnet it is byte-for-byte the wallet's bc1p… address; the regtest bcrt1p… form is the same key, only the network prefix differs. Zero KRAY transform.`)
  process.exit(0)
}
main()
