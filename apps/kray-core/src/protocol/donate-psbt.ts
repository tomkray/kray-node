/**
 * THE DONATION PSBT — an UNSIGNED taproot payment to the anchoring pot that commits the donor in an
 * OP_RETURN, funded from the DONOR's OWN UTXOs. The wallet signs it (key path, its normal popup);
 * nobody custodies a key and the node builds nothing it could redirect. The OP_RETURN is
 * byte-identical to `donorOpReturnScriptHex`, so the node re-proves the SAME bytes on ingress — the
 * mint still happens only from the confirmed, SPV-proven txid. This helper just spares a wallet a
 * local indexer: it turns "here are the donor's UTXOs" into a PSBT the wallet can sign.
 */
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _hexToBytes, _bytesToHex } from './scheme.ts'
import { donorOpReturnScriptHex } from '../anchor/spv.ts'
import { selfAnchorAddress } from './self-anchor.ts'

export interface DonationUtxo { txid: string; vout: number; sats: bigint; scriptHex: string }

// generous vsize (vB) for a donation of N taproot inputs → pot + OP_RETURN(62-byte donor) + change.
// A 1-input donation measures ~285 vB on-chain; 205 + 80·N slightly over-estimates so the fee never lands
// BELOW the requested sat/vB (an under-fee is what stranded the first signet donation 25 blocks deep).
const donationVsize = (nInputs: number) => 205 + 80 * nInputs

export function buildDonationPsbt(params: {
  net: string
  potAddress: string
  donor: string
  donorXOnly: string // 32-byte x-only key (hex) — the taproot internal key, needed to sign key-path
  sats: bigint
  utxos: DonationUtxo[]
  feeRate: number // sat/vB — the fee TRACKS THE MARKET (feeRate × the real input count), never a flat guess
  dust: bigint
}): { psbtHex: string; psbtB64: string; fee: bigint; change: bigint; inputs: number; feeRate: number; vsize: number } {
  const { net, potAddress, donor, donorXOnly, sats, utxos, dust } = params
  if (sats <= 0n) throw new Error('a donation must be a positive number of sats')
  const rate = Math.max(1, Math.ceil(Number(params.feeRate) || 2)) // sat/vB, floored at 1 (a real fee, never 0)
  const opret = donorOpReturnScriptHex(donor) // throws if the donor cannot fit a single-push OP_RETURN
  const bnet = NETWORKS[toBtcNet(net)]
  // accept an x-only key (32 bytes) or a compressed key (33 bytes, 02/03-prefixed) → x-only
  const keyHex = /^0[23][0-9a-f]{64}$/i.test(donorXOnly) ? donorXOnly.slice(2) : donorXOnly
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('donorXOnly must be a 32-byte x-only (or 33-byte compressed) key')
  const xonly = _hexToBytes(keyHex)
  // FAIL-CLOSED: the key must be the INTERNAL taproot key that DERIVES the donor address (not the
  // tweaked output key in the scriptPubKey). If it does not, the wallet could never sign this PSBT
  // key-path — refuse now with a clear message instead of producing an unsignable transaction.
  const derived = btc.p2tr(xonly, undefined, bnet).address
  if (derived !== donor) throw new Error(`the pubkey does not derive the donor address (got ${derived}) — the wallet must send its INTERNAL taproot key, not the output key`)
  // largest-first coin selection — the fee is RE-COMPUTED as inputs are added (each input grows the vsize),
  // so the selection always covers its own market-rate fee no matter how many UTXOs it takes.
  const sorted = [...utxos].sort((a, z) => (z.sats > a.sats ? 1 : -1))
  const picked: DonationUtxo[] = []
  let sum = 0n
  for (const u of sorted) { picked.push(u); sum += u.sats; if (sum >= sats + BigInt(rate * donationVsize(picked.length)) + dust) break }
  const vsize = donationVsize(picked.length)
  const feeSats = BigInt(rate * vsize)
  if (sum < sats + feeSats) throw new Error(`insufficient funds: the donor has ${sum} sats, needs at least ${sats + feeSats} (donation + a ${rate} sat/vB fee)`)
  const tx = new btc.Transaction({ allowUnknownOutputs: true }) // the OP_RETURN is a non-address output
  // DECLARE SIGHASH_ALL on every input. Taproot key-path defaults to SIGHASH_DEFAULT (0x00, a 64-byte sig),
  // but the KrayWallet extension signs SIGHASH_ALL (0x01, a 65-byte sig). Without this field the PSBT is silent
  // about the sighash, so bitcoind's finalizepsbt sees a 65-byte sig it cannot reconcile and returns
  // complete:false ("not fully signed"). Pinning ALL makes the PSBT, the wallet, and bitcoind agree.
  // sequence 0xfffffffd ENABLES RBF, so a donation broadcast at too low a fee can be fee-bumped, never stranded.
  for (const u of picked) tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: _hexToBytes(u.scriptHex), amount: u.sats }, tapInternalKey: xonly, sighashType: btc.SigHash.ALL, sequence: 0xfffffffd })
  tx.addOutputAddress(potAddress, sats, bnet) // the donation → the pot
  tx.addOutput({ script: _hexToBytes(opret), amount: 0n }) // the donor commitment (OP_RETURN)
  const change = sum - sats - feeSats
  if (change >= dust) tx.addOutputAddress(donor, change, bnet)
  const psbt = tx.toPSBT()
  return { psbtHex: _bytesToHex(psbt), psbtB64: Buffer.from(psbt).toString('base64'), fee: feeSats, change: change >= dust ? change : 0n, inputs: picked.length, feeRate: rate, vsize }
}

/**
 * THE SELF-ANCHORING DONATION PSBT (Phase 3, lever 1) — identical to a normal donation, except output 0 pays the
 * pot's INTERNAL key tweaked by the anchor payload, so the donation output itself seals (blockNumber, root) on
 * Bitcoin: the donation IS the anchor (pay-to-contract), no OP_RETURN anchor and no fee pot to drain. The donor
 * commitment OP_RETURN is unchanged (the node still mints to the donor), and the sats still land at a key the pot
 * holder can sweep. This just points output 0 at `selfAnchorAddress(potInternalXOnly, payload)` — nothing else moves.
 */
export function buildSelfAnchorDonationPsbt(params: {
  net: string
  potInternalXOnly: string // the pot's x-only taproot INTERNAL key (P) — the network publishes it
  anchorPayloadHex: string // KrayAnchor.payload(blockNumber, cascadeRoot) — the 49 bytes to seal
  donor: string
  donorXOnly: string
  sats: bigint
  utxos: DonationUtxo[]
  feeRate: number
  dust: bigint
}): { psbtHex: string; psbtB64: string; fee: bigint; change: bigint; inputs: number; potAddress: string } {
  const potAddress = selfAnchorAddress(params.potInternalXOnly, params.anchorPayloadHex, params.net)
  const built = buildDonationPsbt({ net: params.net, potAddress, donor: params.donor, donorXOnly: params.donorXOnly, sats: params.sats, utxos: params.utxos, feeRate: params.feeRate, dust: params.dust })
  return { ...built, potAddress }
}
