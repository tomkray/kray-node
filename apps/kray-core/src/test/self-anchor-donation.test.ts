/**
 * SELF-ANCHORING DONATION — the activation, proven end-to-end OFFLINE (no broadcast, no live money).
 *
 * A donor builds an ordinary donation PSBT, except output 0 pays the pot's internal key TWEAKED by the current
 * anchor payload. This test proves the whole activation path without touching the live server: (1) the PSBT's
 * output 0 is exactly the self-anchoring taproot script that seals (blockNumber, root); (2) that script is a
 * standard P2TR — @scure decodes the same address; (3) the node's audit re-derives the sealed root and rejects any
 * tamper; (4) the donor commitment OP_RETURN is intact, so the mint still credits the donor; (5) the sats are
 * spendable by the pot key holder. The donation IS the anchor — keyless, free, standard.
 *
 *   node src/test/self-anchor-donation.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { schnorr } from '@noble/curves/secp256k1.js'
import { NETWORKS } from '../protocol/scheme.ts'
import { KrayAnchor } from '../anchor/anchor.ts'
import { donorOpReturnScriptHex } from '../anchor/spv.ts'
import { buildSelfAnchorDonationPsbt } from '../protocol/donate-psbt.ts'
import { selfAnchorScriptHex, selfAnchorAddress, verifySelfAnchor, tweakedSpendSecret } from '../protocol/self-anchor.ts'

const NET = 'signet'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const b2h = (b: Uint8Array): string => Buffer.from(b).toString('hex')
const h2b = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'))
const seed = (t: string): Uint8Array => createHash('sha256').update('sa-donation|' + t).digest()

function main() {
  console.log('\n╔═ SELF-ANCHORING DONATION — the donation IS the anchor, proven build → audit → mint → spend ═╗\n')
  const bnet = NETWORKS[NET]

  // the pot: the network publishes P (x-only internal key); its secret d is the reserve's custody (a federation, later)
  const potSk = seed('pot')
  const potX = b2h(schnorr.getPublicKey(potSk))

  // the donor and one funded UTXO (built offline; no bitcoind)
  const donorSk = seed('donor')
  const donorX = b2h(schnorr.getPublicKey(donorSk))
  const donorP2tr = btc.p2tr(h2b(donorX), undefined, bnet)
  const donor = donorP2tr.address!
  const utxo = { txid: 'a'.repeat(64), vout: 0, sats: 25_000n, scriptHex: b2h(donorP2tr.script) }

  // the CURRENT tip the donation will seal
  const blockNumber = 7
  const root = createHash('sha256').update('cascade|tip7').digest('hex')
  const payload = KrayAnchor.payload(blockNumber, root)
  const sats = 20_000n

  const built = buildSelfAnchorDonationPsbt({ net: NET, potInternalXOnly: potX, anchorPayloadHex: payload, donor, donorXOnly: donorX, sats, utxos: [utxo], feeRate: 4, dust: 330n })

  // ── decode the PSBT and read its outputs (what will actually land on Bitcoin) ──
  const tx = btc.Transaction.fromPSBT(h2b(built.psbtHex))
  const outs: { script: string; amount: bigint }[] = []
  for (let i = 0; i < tx.outputsLength; i++) { const o = tx.getOutput(i); outs.push({ script: b2h(o.script as Uint8Array), amount: o.amount as bigint }) }

  // ── 1 · output 0 IS the self-anchoring taproot script sealing (blockNumber, root), for exactly `sats` ──
  const expectScript = selfAnchorScriptHex(potX, payload)
  ok(outs[0].script === expectScript && outs[0].amount === sats, 'output 0 pays the self-anchoring taproot script for the exact donation amount — the donation output seals the root')
  ok(expectScript.startsWith('5120') && expectScript.length === 68, 'the pot output is a standard witness-v1 taproot script (OP_1 PUSH32 <key>) — indistinguishable on-chain')

  // ── 2 · that script is a real P2TR — @scure derives the identical address ──
  ok(built.potAddress === selfAnchorAddress(potX, payload, NET), 'the PSBT paid the address the primitive derives for (P, payload)')
  const scriptFromAddr = b2h(btc.OutScript.encode(btc.Address(bnet).decode(built.potAddress)))
  ok(scriptFromAddr === expectScript, '@scure decodes the pot address to the very same script — standard taproot, not a bespoke output')

  // ── 3 · the node's AUDIT re-derives the sealed root, and rejects any tamper ──
  const outputKey = outs[0].script.slice(4)   // strip 5120 → the 32-byte x-only output key
  ok(verifySelfAnchor(outputKey, potX, payload), 'the node re-derives the committed key from (P, blockNumber, root) — the anchor verifies from the on-chain output alone')
  ok(!verifySelfAnchor(outputKey, potX, KrayAnchor.payload(blockNumber, createHash('sha256').update('other').digest('hex'))), 'a donation cannot be replayed as sealing a DIFFERENT root — the commitment is bound to this exact root')
  ok(!verifySelfAnchor(outputKey, potX, KrayAnchor.payload(blockNumber + 1, root)), 'nor a different block height — height is sealed too')

  // ── 4 · the donor commitment is intact — the mint still credits the donor ──
  const opret = donorOpReturnScriptHex(donor)
  ok(outs.some((o) => o.script === opret && o.amount === 0n), 'the donor OP_RETURN is present and unchanged — the node still mints ₭ to the donor, exactly as today')
  ok(outs.some((o, i) => i > 0 && o.script === b2h(donorP2tr.script)), 'change returns to the donor — nothing is stranded or misdirected')

  // ── 5 · the sats are SPENDABLE by the pot key holder (the reserve is never lost) ──
  const spendSk = tweakedSpendSecret(b2h(potSk), payload)
  ok(b2h(schnorr.getPublicKey(h2b(spendSk))) === outputKey, 'the pot key holder can sweep the donation output — the tweaked spend key matches the output key')
  const msg = createHash('sha256').update('sweep').digest()
  ok(schnorr.verify(schnorr.sign(msg, h2b(spendSk)), msg, h2b(outputKey)), 'a Schnorr key-path signature validates against the output — the reserve is truly controllable (and, later, federated)')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — build → seal → audit → mint → sweep, all offline, all standard, nothing custodial. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
