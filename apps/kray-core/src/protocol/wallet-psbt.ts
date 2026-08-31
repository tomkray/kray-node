/**
 * THE WALLET's SEND PSBTs — built by the node from the sender's OWN UTXOs (no custody), signed by the
 * wallet (taproot key path). Two builders:
 *   · buildBtcSendPsbt  — a plain BTC payment + change.
 *   · buildInscriptionSendPsbt — moves ONE inscription outpoint: input 0 is the inscribed UTXO,
 *     output 0 pays the recipient its EXACT postage (the inscribed sat rides 0→0 by ordinal
 *     arithmetic), fee comes only from pure-BTC inputs the caller pre-filtered. The postage is
 *     never crushed to dust and never taxed for fee — the sat's home keeps its value.
 *   · buildRuneSendPsbt — a Runes transfer whose runestone allocates EVERY input rune EXPLICITLY:
 *     `amount` → the recipient, the remainder → the sender. Nothing is left to ord's default output or
 *     a pointer, so a mis-built change output can never silently route the runes into a burn. Rune
 *     conservation is the invariant; this builder proves it by construction and the test decodes it back.
 */
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _hexToBytes, _bytesToHex } from './scheme.ts'
import { encodeVarint, TAG } from './runestone.ts'

export interface Utxo { txid: string; vout: number; sats: bigint; xonly: string; runeAmount?: bigint }
/** An input carried by its on-chain scriptPubKey (no internal key needed — the wallet's signer
 *  matches its own key to the script, the same PSBT shape the kray-space builders emit). */
export interface ScriptUtxo { txid: string; vout: number; sats: bigint; script: Uint8Array }

/** BIP125 opt-in. Default nSequence is 0xffffffff (final) — that is why mempool showed RBF: no. */
export const SEQUENCE_RBF = 0xfffffffd

// OP_RETURN OP_13 <push payload> — the canonical Runes carrier (payload is a run of LEB128 varints)
function runestoneScript(fields: bigint[]): Uint8Array {
  const payload = Buffer.concat(fields.map((n) => Buffer.from(encodeVarint(n))))
  const prefix = payload.length < 0x4c ? Buffer.from([0x6a, 0x5d, payload.length]) : Buffer.from([0x6a, 0x5d, 0x4c, payload.length])
  return Uint8Array.from(Buffer.concat([prefix, payload]))
}
const addTaprootInput = (tx: btc.Transaction, u: Utxo, net: (typeof NETWORKS)[keyof typeof NETWORKS]) => {
  const spk = btc.p2tr(_hexToBytes(u.xonly), undefined, net).script
  tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: spk, amount: u.sats }, tapInternalKey: _hexToBytes(u.xonly), sequence: SEQUENCE_RBF })
}
const out = (r: { psbtHex: string; psbtB64: string; [k: string]: unknown }) => r

/** Key-path P2TR vsize (witness discounted). Used so feeRate × vsize is the fee that lands on-chain. */
export function taprootKeypathVsize(nIn: number, nOut: number): number {
  return 10 + nIn * 58 + nOut * 43
}

export function feeSatsAtRate(feeRate: number, nIn: number, nOut: number): bigint {
  const rate = Math.max(1, Math.min(500, Math.ceil(Number(feeRate) || 2)))
  return BigInt(Math.ceil(rate * taprootKeypathVsize(nIn, nOut)))
}

/** A plain BTC payment: pay `sats` to `to`, change back to `from`, funded largest-first. */
export function buildBtcSendPsbt(params: {
  net: string; from: string; to: string; sats: bigint; utxos: Utxo[]; feeSats: bigint; dust: bigint
}) {
  const { net, from, to, sats, utxos, feeSats, dust } = params
  if (sats <= 0n) throw new Error('a send must be a positive number of sats')
  const bnet = NETWORKS[toBtcNet(net)]
  const sorted = [...utxos].sort((a, z) => (z.sats > a.sats ? 1 : -1))
  const picked: Utxo[] = []; let sum = 0n
  for (const u of sorted) { picked.push(u); sum += u.sats; if (sum >= sats + feeSats + dust) break }
  if (sum < sats + feeSats) throw new Error(`insufficient funds: ${sum} sats, need at least ${sats + feeSats}`)
  const tx = new btc.Transaction({ allowUnknownOutputs: true })
  for (const u of picked) addTaprootInput(tx, u, bnet)
  tx.addOutputAddress(to, sats, bnet)
  const change = sum - sats - feeSats
  if (change >= dust) tx.addOutputAddress(from, change, bnet)
  const psbt = tx.toPSBT()
  return out({ psbtHex: _bytesToHex(psbt), psbtB64: Buffer.from(psbt).toString('base64'), fee: feeSats.toString(), change: (change >= dust ? change : 0n).toString(), inputs: picked.length })
}

/** One inscription outpoint → the recipient, postage preserved exactly; fee from pure inputs only. */
export function buildInscriptionSendPsbt(params: {
  net: string; from: string; to: string; inscriptionUtxo: ScriptUtxo; feeUtxos: ScriptUtxo[]; feeSats: bigint; dust: bigint
}) {
  const { net, from, to, inscriptionUtxo, feeUtxos, feeSats, dust } = params
  if (inscriptionUtxo.sats <= 0n) throw new Error('the inscription outpoint has no value')
  const bnet = NETWORKS[toBtcNet(net)]
  // Pin SIGHASH_ALL on every input — the donate builder already proved this.
  // The KrayWallet popup signs ALL (65-byte key-path). Without the field the
  // PSBT is silent, bitcoind finalizepsbt sees a 65-byte sig it cannot
  // reconcile, returns complete:false, and a "signed" bag never broadcasts.
  const addScriptInput = (tx: btc.Transaction, u: ScriptUtxo) =>
    tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: u.script, amount: u.sats }, sighashType: btc.SigHash.ALL, sequence: SEQUENCE_RBF })
  // fee is paid ONLY by the pure inputs — the postage is the inscribed sat's home, never the purse
  const picked: ScriptUtxo[] = []; let sum = 0n
  for (const u of [...feeUtxos].sort((a, z) => (z.sats > a.sats ? 1 : -1))) {
    if (sum >= feeSats + dust) break
    picked.push(u); sum += u.sats
  }
  if (sum < feeSats) throw new Error(`insufficient pure BTC for the fee: have ${sum} sats, need ${feeSats}`)
  const tx = new btc.Transaction({ allowUnknownOutputs: true })
  addScriptInput(tx, inscriptionUtxo)                       // input 0 — the inscribed outpoint
  for (const u of picked) addScriptInput(tx, u)             // inputs 1.. — the fee purse
  tx.addOutputAddress(to, inscriptionUtxo.sats, bnet)       // output 0 — exact postage to the recipient
  const change = sum - feeSats
  if (change >= dust) tx.addOutputAddress(from, change, bnet)
  const psbt = tx.toPSBT()
  return out({ psbtHex: _bytesToHex(psbt), psbtB64: Buffer.from(psbt).toString('base64'), fee: feeSats.toString(), change: (change >= dust ? change : 0n).toString(), inputs: 1 + picked.length })
}

/** An open-mint claim (Runestone Tag 20, twice: etching block then tx — ord's Tag::Mint takes two
 *  values). Output shape mirrors the kray-space mainnet builder byte-for-byte so the wallet verifies
 *  ONE contract on every network:
 *    out 0 — the minter's postage (first non-OP_RETURN output: ord's default allocation → the minted
 *            runes land here), out 1 — the mint runestone, [out 2 — the fixed service fee],
 *    [out last — BTC change]. Inputs are pure-BTC ScriptUtxos the caller pre-verified (no rune, no
 *  inscription), signed SIGHASH_ALL by the wallet's own key — a mint can never melt an artifact. */
export function buildRuneMintPsbt(params: {
  net: string
  runeId: { block: bigint; tx: bigint }
  to: string                 // the minter — receives the postage (runes) + BTC change
  feeUtxos: ScriptUtxo[]     // pure-BTC purse, pre-verified by the caller
  feeSats: bigint
  dust: bigint               // postage + change floor (330 for p2tr at today's relay floor)
  serviceFee?: { script: Uint8Array; sats: bigint }   // the platform's fixed fee output, if any
}) {
  const { net, runeId, to, feeUtxos, feeSats, dust, serviceFee } = params
  if (runeId.block < 0n || runeId.tx < 0n) throw new Error('a rune id is block:tx, both non-negative')
  const bnet = NETWORKS[toBtcNet(net)]
  const stone = runestoneScript([TAG.Mint, runeId.block, TAG.Mint, runeId.tx])
  const svcSats = serviceFee ? serviceFee.sats : 0n
  const need = dust + svcSats + feeSats
  const picked: ScriptUtxo[] = []; let sum = 0n
  for (const u of [...feeUtxos].sort((a, z) => (z.sats > a.sats ? 1 : -1))) {
    if (sum >= need + dust) break
    picked.push(u); sum += u.sats
  }
  if (sum < need) throw new Error(`insufficient pure BTC for the mint: have ${sum} sats, need at least ${need}`)
  const tx = new btc.Transaction({ allowUnknownOutputs: true })
  for (const u of picked) tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: u.script, amount: u.sats }, sighashType: btc.SigHash.ALL, sequence: SEQUENCE_RBF })
  tx.addOutputAddress(to, dust, bnet)                       // out 0 — postage: the minted runes land here
  tx.addOutput({ script: stone, amount: 0n })               // out 1 — the mint runestone
  if (serviceFee) tx.addOutput({ script: serviceFee.script, amount: serviceFee.sats })
  const change = sum - need
  if (change >= dust) tx.addOutputAddress(to, change, bnet) // out last — BTC change (sub-dust rides as fee)
  const psbt = tx.toPSBT()
  return out({
    psbtHex: _bytesToHex(psbt), psbtB64: Buffer.from(psbt).toString('base64'),
    fee: (change >= dust ? feeSats : feeSats + change).toString(),
    runestoneHex: _bytesToHex(stone), postage: dust.toString(), serviceFee: svcSats.toString(),
    change: (change >= dust ? change : 0n).toString(), inputs: picked.length,
  })
}

/** A Runes transfer: `amount` of the rune → `to`, the rune remainder → `from`, both by explicit edict. */
export function buildRuneSendPsbt(params: {
  net: string
  runeId: { block: bigint; tx: bigint }
  amount: bigint
  to: string          // recipient (receives `amount` of the rune)
  from: string        // sender (receives the rune change + BTC change)
  runeUtxos: Utxo[]   // UTXOs holding the rune (each with runeAmount)
  feeUtxos: Utxo[]    // pure-BTC UTXOs for the fee + dust
  feeSats: bigint
  dust: bigint
}) {
  const { net, runeId, amount, to, from, runeUtxos, feeUtxos, feeSats, dust } = params
  // POSTAGE — the sats each rune-bearing output carries — is the network's CURRENT minimum, resolved from
  // Bitcoin Core's own dust formula (dust.ts) and passed in. It is 330 at today's 3000 sat/kvB relay floor,
  // but it FALLS automatically as relays/miners lower the dust-relay fee (down to 1 sat, or 0 where a relay
  // has no floor) — we always ride the smallest postage the network will accept, never a hardcoded number.
  if (amount <= 0n) throw new Error('a rune send must be positive')
  if (!runeUtxos.length) throw new Error('no UTXOs hold this rune')
  const bnet = NETWORKS[toBtcNet(net)]
  const totalRune = runeUtxos.reduce((t, u) => t + (u.runeAmount ?? 0n), 0n)
  if (totalRune < amount) throw new Error(`insufficient runes: have ${totalRune}, need ${amount}`)
  const runeChange = totalRune - amount
  // outputs: 0 = recipient (dust, gets exactly `amount`), 1 = OP_RETURN, 2 = sender (dust) — ALWAYS
  // present as the POINTER target, [last = BTC change]. Output 2 always exists so a runestone pointer
  // can send EVERY un-edicted rune home to the sender: the target-rune change AND any OTHER rune that
  // happened to share a spent UTXO (a multi-rune UTXO), which ord would otherwise default to output 0
  // (the recipient) — a silent leak. With the pointer, nothing the sender did not name reaches the recipient.
  const nDustOuts = 2n
  const needSats = dust * nDustOuts + feeSats
  const inputs = [...runeUtxos]; let sum = runeUtxos.reduce((t, u) => t + u.sats, 0n)
  for (const u of feeUtxos.sort((a, z) => (z.sats > a.sats ? 1 : -1))) { if (sum >= needSats + dust) break; inputs.push(u); sum += u.sats }
  if (sum < needSats) throw new Error(`insufficient sats for the transfer: have ${sum}, need ${needSats}`)
  // the runestone: POINTER → output 2 (strays home), Body edict moves exactly `amount` → output 0, and
  // (if any) the target-rune change → output 2 explicitly. TAG.Pointer must precede TAG.Body.
  const fields = [TAG.Pointer, 2n, TAG.Body, runeId.block, runeId.tx, amount, 0n]
  if (runeChange > 0n) fields.push(0n, 0n, runeChange, 2n)
  const tx = new btc.Transaction({ allowUnknownOutputs: true })
  for (const u of inputs) addTaprootInput(tx, u, bnet)
  tx.addOutputAddress(to, dust, bnet)                    // out 0 — recipient, gets exactly `amount`
  tx.addOutput({ script: runestoneScript(fields), amount: 0n }) // out 1 — the runestone
  tx.addOutputAddress(from, dust, bnet)                  // out 2 — sender, the pointer target (change + strays)
  const btcChange = sum - dust * nDustOuts - feeSats
  if (btcChange >= dust) tx.addOutputAddress(from, btcChange, bnet) // out last — BTC change
  const psbt = tx.toPSBT()
  return out({ psbtHex: _bytesToHex(psbt), psbtB64: Buffer.from(psbt).toString('base64'), fee: feeSats.toString(), runeChange: runeChange.toString(), inputs: inputs.length })
}
