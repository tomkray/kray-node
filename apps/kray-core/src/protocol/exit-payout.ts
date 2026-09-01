/**
 * THE EXIT PAYOUT — the user-funded vault spend that pays an OPEN rune exit.
 *
 * This closes the last mile of the bakery tab: the exiter taps "withdraw", the
 * node assembles THIS transaction, the exiter signs it (their vault leaf AND
 * their own sats), the guardians co-sign, anyone broadcasts, and the sacred
 * settle path burns the L2 lock against the proven delivery. No third party is
 * needed and none is trusted: the destination is already inside the exiter's
 * rune-exit signature, the amount is the lock, and the runestone is proven
 * safe by the SAME decoder the bridge uses before a single signature exists.
 *
 * ── THE SHAPE (fixed, so every signer can predict it) ───────────────────────
 *   inputs   [0..v-1]  the vault outpoint(s) — cooperative leaf (owner-first)
 *            [v]       the exiter's OWN sats UTXO — plain P2TR key path.
 *                      THE EXITER FUNDS the postage and the miner fee; the
 *                      vault pays only the runes that were always theirs.
 *   outputs  [0]       the SIGNED exit destination · exactly lock.amount runes
 *            [1]       the runestone (OP_RETURN, 0 sats): one edict amount→0,
 *                      pointer→2 — same law as vault-settlement.ts
 *            [2]       rune change → the plan's change script (default: the
 *                      SAME vault). The node door sets this to the canonical
 *                      consolidation vault so L2 recipients can later withdraw
 *                      from the shared pool — same remainder law as a
 *                      pre-signed settlement.
 *            [3]       optional stated service fee → platform P2TR (withdraw
 *                      only; absent → historic 4-output shape, byte-identical)
 *            [last]    sats change → the exiter (omitted when < dust; the
 *                      remainder then rides as fee, stated by omission)
 *                      changeVout stays destCount+1 so the runestone pointer
 *                      does not move when the service output is present.
 *
 * Fee logic lives in the CALLER (the node door quotes; the user picks the
 * rate): here outputs are stated exactly and the fee is what inputs exceed
 * outputs by — a builder that "helpfully" adjusts amounts is a builder a
 * signer can no longer predict (same law as vault-spend.ts).
 *
 * Pure and total: no I/O, no network, no keys held. The PSBT it emits carries
 * tapLeafScript on the vault inputs and tapInternalKey on the funding input,
 * so any BIP-174 taproot wallet (the KrayWallet signer included) can sign both
 * without ever learning anything this file did not already prove safe.
 */
import * as btc from '@scure/btc-signer'
import { schnorr } from '@noble/curves/secp256k1.js'
import { NETWORKS } from './scheme.ts'
import { deriveVault, type VaultParams } from './vault.ts'
import { verifySighash, type VaultUtxo, type SpendOutput } from './vault-spend.ts'
import { settlementRunestoneHex, batchSettlementRunestoneHex, auditSettlementSafety } from './vault-settlement.ts'
import type { RuneId } from './runestone.ts'

const SEQUENCE_FINAL_RBF = 0xfffffffd
const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** The exiter's plain P2TR sats UTXO that funds postage + fee. `scriptHex` is its
 *  scriptPubKey (5120…); `internalKey` the x-only key the wallet will sign with
 *  (needed in the PSBT so the signer knows to tweak — BIP-371 tapInternalKey). */
export interface FundingUtxo { txid: string; vout: number; amountSats: bigint; scriptHex: string; internalKey: string }

export interface ExitPayoutPlan {
  runeId: RuneId
  /** the LOCKED amount — the settle path demands EXACTLY this at the destination */
  exitAmount: bigint
  /** what the vault outpoint(s) physically hold, per ord — conservation input */
  totalVaultRunes: bigint
  /** scriptPubKey (hex) of the SIGNED l1Address from the rune-exit */
  destScriptHex: string
  /** sats riding on the destination output — ≥ dust (330 at today's P2TR floor) */
  destPostage: bigint
  /** sats riding on the rune-change output — ≥ dust; the change returns to the vault */
  changePostage: bigint
  /** optional scriptPubKey (hex) for output 2. Default: the same vault. The
   *  node door sets the canonical consolidation vault so a recipient who only
   *  holds L2 credits can later be paid from the shared pool. */
  changeScriptHex?: string
  /** scriptPubKey (hex) for the exiter's sats change */
  satsChangeScriptHex: string
  /** the miner fee, chosen by the exiter (rate × estimated vsize, computed by the door) */
  feeSats: bigint
  /** the network's current dust floor for a P2TR output (dust.ts) */
  dust: bigint
  /**
   * Additive loaf. Absent or length 1 → the historic one-dest shape (byte-identical).
   * When longer, dests[0] MUST equal destScriptHex/exitAmount (the initiator).
   */
  dests?: Array<{ destScriptHex: string; exitAmount: bigint }>
  /**
   * Optional stated platform fee on THIS payout only (withdraw door).
   * Absent → historic bytes. Present → one P2TR output after the pointer pad,
   * before sats change. changeVout does not move. Guardians rebuild from plan.
   */
  serviceFee?: { scriptHex: string; sats: bigint }
}

export interface ExitPayout {
  unsignedTxHex: string
  /** one BIP-341 sighash per input: [0..v-1] vault (cooperative leaf), [v] funding (key path) */
  sighashes: string[]
  vaultInputCount: number
  leafScript: string
  controlBlock: string
  params: ReturnType<typeof deriveVault>['params']
  utxos: VaultUtxo[]
  funding: FundingUtxo
  outputs: SpendOutput[]
  runestoneHex: string
  /** BIP-174, base64 — tapLeafScript on vault inputs, tapInternalKey on the funding input */
  psbtBase64: string
  /** rune-change output index — 2 on the historic one-dest loaf, N+1 when N dests ride */
  changeVout: number
  destCount: number
}

/** Rebuild the taproot payment and pick the cooperative leaf with its control block. */
function cooperativeLeaf(params: VaultParams) {
  const v = deriveVault(params)
  const payment = btc.p2tr(
    btc.TAPROOT_UNSPENDABLE_KEY,
    [{ script: hexToBytes(v.cooperativeScript) }, { script: hexToBytes(v.unilateralScript) }],
    NETWORKS[params.net],
    true,
  )
  for (const [cb, scriptWithVer] of payment.tapLeafScript ?? []) {
    const script = scriptWithVer.subarray(0, -1)
    if (bytesToHex(script) === v.cooperativeScript) {
      return { vault: v, script, controlBlock: btc.TaprootControlBlock.encode(cb), outScript: payment.script!, tapLeafEntry: [cb, scriptWithVer] as const }
    }
  }
  /* c8 ignore next — deriveVault built both leaves; not finding one is impossible */
  throw new Error('exit-payout: the cooperative leaf is not in its own tree')
}

/**
 * BUILD THE UNSIGNED PAYOUT. Deterministic: same vault, funding, and plan →
 * same transaction and sighashes on every machine, so the exiter's wallet, the
 * guardians and any stranger can each rebuild it and refuse anything that
 * differs. Refuses loudly before economics can lie:
 *   · the runestone is proven safe (no cenotaph, no burn, exact delivery)
 *   · conservation Σ runes in == Σ runes out, destination gets EXACTLY the lock
 *   · every rune-bearing output clears the dust
 *   · sats in == sats out + the STATED fee (a fee nobody stated is a theft)
 */
export function buildExitPayout(
  params: VaultParams,
  vaultUtxos: VaultUtxo[],
  funding: FundingUtxo,
  plan: ExitPayoutPlan,
): ExitPayout {
  if (!vaultUtxos.length) throw new Error('exit-payout: nothing to spend from the vault')
  if (plan.exitAmount <= 0n) throw new Error('exit-payout: the exit amount must be positive')
  const dests = plan.dests && plan.dests.length ? plan.dests : [{ destScriptHex: plan.destScriptHex, exitAmount: plan.exitAmount }]
  if (dests[0].destScriptHex.toLowerCase() !== plan.destScriptHex.toLowerCase() || dests[0].exitAmount !== plan.exitAmount) {
    throw new Error('exit-payout: dests[0] must be the initiator dest/amount — a silent swap is a theft')
  }
  const paidRunes = dests.reduce((t, d) => t + d.exitAmount, 0n)
  if (paidRunes <= 0n) throw new Error('exit-payout: the loaf pays nothing')
  if (paidRunes > plan.totalVaultRunes) throw new Error('exit-payout: the loaf exceeds what the vault physically holds')
  if (plan.exitAmount > plan.totalVaultRunes) throw new Error('exit-payout: the exit exceeds what the vault physically holds')
  // output 2 ALWAYS exists (the pointer's landing pad), so it must ALWAYS clear the dust —
  // a sub-dust output would not relay even when it carries zero runes
  if (plan.destPostage < plan.dust || plan.changePostage < plan.dust) {
    throw new Error('exit-payout: every output must clear the dust or it would not relay')
  }
  if (plan.feeSats <= 0n) throw new Error('exit-payout: the miner fee must be positive and STATED — a fee by surprise is a theft')
  if (!/^[0-9a-f]{64}$/.test(funding.txid)) throw new Error('exit-payout: the funding txid must be 64 hex chars')
  if (funding.amountSats <= 0n) throw new Error('exit-payout: the funding utxo must carry a positive amount')
  if (!/^5120[0-9a-f]{64}$/.test(funding.scriptHex.toLowerCase())) throw new Error('exit-payout: the funding utxo must be a plain P2TR output (5120…) — the exiter\'s own key path')
  if (!/^[0-9a-f]{64}$/.test(funding.internalKey.toLowerCase())) throw new Error('exit-payout: the funding internal key must be 32-byte x-only hex')
  for (const u of vaultUtxos) if (`${u.txid}:${u.vout}` === `${funding.txid}:${funding.vout}`) throw new Error('exit-payout: the funding utxo cannot be a vault outpoint')

  const { vault, script, controlBlock, outScript, tapLeafEntry } = cooperativeLeaf(params)
  const vaultSats = vaultUtxos.reduce((t, u) => t + u.amountSats, 0n)
  const inSum = vaultSats + funding.amountSats
  // default: remainder stays under the same two leaves. The door may redirect it
  // to the consolidation vault (a different P2TR) so L2 recipients can withdraw.
  const changeScriptHex = (plan.changeScriptHex || bytesToHex(outScript)).toLowerCase()
  if (!/^5120[0-9a-f]{64}$/.test(changeScriptHex)) {
    throw new Error('exit-payout: the rune-change script must be a plain P2TR output (5120…) — a wrong pad is a cenotaph risk')
  }
  const destCount = dests.length
  const changeVout = destCount + 1
  let serviceSats = 0n
  let serviceScriptHex: string | null = null
  if (plan.serviceFee) {
    serviceScriptHex = plan.serviceFee.scriptHex.toLowerCase()
    if (!/^5120[0-9a-f]{64}$/.test(serviceScriptHex)) {
      throw new Error('exit-payout: the service fee script must be a plain P2TR output (5120…) — a wrong pad is a theft')
    }
    if (plan.serviceFee.sats < plan.dust) {
      throw new Error('exit-payout: the service fee must clear the dust or it would not relay')
    }
    serviceSats = plan.serviceFee.sats
  }
  const runestoneHex = destCount === 1
    ? settlementRunestoneHex(plan.runeId, dests[0].exitAmount, 0, 2)
    : batchSettlementRunestoneHex(plan.runeId, dests.map((d, i) => ({ amount: d.exitAmount, output: i })), changeVout)
  const outputs: SpendOutput[] = [
    ...dests.map((d) => ({ script: d.destScriptHex, amountSats: plan.destPostage })),
    { script: runestoneHex, amountSats: 0n },
    // the pointer pad ALWAYS exists (even at 0 remainder): a missing pad is a CENOTAPH
    { script: changeScriptHex, amountSats: plan.changePostage },
  ]
  // service fee sits AFTER the pointer pad so changeVout (and the runestone
  // pointer) stay lawful. Absent → historic output list, byte-identical.
  if (serviceScriptHex) {
    outputs.push({ script: serviceScriptHex, amountSats: serviceSats })
  }
  let outSum = plan.destPostage * BigInt(destCount) + plan.changePostage + serviceSats
  const satsChange = inSum - outSum - plan.feeSats
  if (satsChange < 0n) throw new Error(`exit-payout: the funding utxo is short — inputs carry ${inSum} sats, outputs + fee need ${outSum + plan.feeSats}`)
  if (satsChange >= plan.dust) {
    outputs.push({ script: plan.satsChangeScriptHex, amountSats: satsChange })
    outSum += satsChange
  } // a sub-dust remainder rides as extra fee — stated here, not hidden

  // ── PROVE THE RUNESTONE SAFE before anything is signed (same decoder as the bridge) ──
  const verdict = auditSettlementSafety({
    runeId: plan.runeId,
    outputScriptsHex: outputs.map((o) => o.script!),
    inputRunes: plan.totalVaultRunes,
    depositorOutput: 0,
    consolidationOutput: changeVout,
    maxDepositorRunes: destCount === 1 ? plan.exitAmount : paidRunes,
    ...(destCount > 1 ? { dests: dests.map((d, i) => ({ output: i, amount: d.exitAmount })) } : {}),
  })
  if (!verdict.ok) throw new Error(`exit-payout: unsafe runestone — ${verdict.reason}`)
  if (destCount === 1 && verdict.depositorGot !== plan.exitAmount) throw new Error(`exit-payout: the destination would receive ${verdict.depositorGot}, not the ${plan.exitAmount} the exit locked — the settle would refuse it, so this builder does first`)
  if (destCount > 1 && verdict.depositorGot !== paidRunes) throw new Error(`exit-payout: the loaf would deliver ${verdict.depositorGot}, not the ${paidRunes} the signed exits locked`)

  // ── the transaction: vault inputs (script path) + the exiter's funding input (key path) ──
  const tx = new btc.Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true, version: 2 })
  for (const u of vaultUtxos) {
    tx.addInput({
      txid: u.txid, index: u.vout, sequence: SEQUENCE_FINAL_RBF,
      witnessUtxo: { script: outScript, amount: u.amountSats },
      // BIP-371: the PSBT carries the leaf + control block so the wallet can sign the script path
      tapLeafScript: [tapLeafEntry] as never,
    })
  }
  tx.addInput({
    txid: funding.txid, index: funding.vout, sequence: SEQUENCE_FINAL_RBF,
    witnessUtxo: { script: hexToBytes(funding.scriptHex), amount: funding.amountSats },
    tapInternalKey: hexToBytes(funding.internalKey.toLowerCase()),
  })
  for (const o of outputs) tx.addOutput({ script: hexToBytes(o.script!), amount: o.amountSats })

  // BIP-341 sighashes — every input commits to ALL prevouts (scripts + amounts)
  const prevScripts = [...vaultUtxos.map(() => outScript), hexToBytes(funding.scriptHex)]
  const amounts = [...vaultUtxos.map((u) => u.amountSats), funding.amountSats]
  const sighashes: string[] = []
  for (let i = 0; i < vaultUtxos.length; i++) {
    sighashes.push(bytesToHex(tx.preimageWitnessV1(i, prevScripts, btc.SigHash.DEFAULT, amounts, undefined, script, 0xc0)))
  }
  sighashes.push(bytesToHex(tx.preimageWitnessV1(vaultUtxos.length, prevScripts, btc.SigHash.DEFAULT, amounts)))

  return {
    unsignedTxHex: bytesToHex(tx.toBytes(true, false)),
    sighashes,
    vaultInputCount: vaultUtxos.length,
    leafScript: bytesToHex(script),
    controlBlock: bytesToHex(controlBlock),
    params: vault.params,
    utxos: vaultUtxos,
    funding,
    outputs,
    runestoneHex,
    psbtBase64: Buffer.from(tx.toPSBT(0)).toString('base64'),
    changeVout,
    destCount,
  }
}

/**
 * READ THE WALLET'S SIGNATURES back out of the signed PSBT: the depositor's
 * tapScriptSig on every vault input (BIP-371) and the key-path signature on the
 * funding input. Refuses anything that does not verify — a wrong signature in a
 * CHECKSIG(ADD) witness aborts the whole script on-chain, so it must never
 * travel further than this function.
 */
export function extractWalletSignatures(
  payout: ExitPayout,
  signedPsbtBase64: string,
  opts: { walletSignsVault?: boolean } = {},
): { depositorSigs: string[]; fundingSig: string } {
  const tx = btc.Transaction.fromPSBT(Buffer.from(signedPsbtBase64, 'base64'), { allowUnknownInputs: true, allowUnknownOutputs: true })
  if (tx.inputsLength !== payout.vaultInputCount + 1) throw new Error('exit-payout: the signed PSBT does not match the built payout (input count)')
  const walletSignsVault = opts.walletSignsVault !== false
  const depositor = payout.params.depositor
  const depositorSigs: string[] = []
  // consolidation path: the vault's "depositor" is the network pool key (the node
  // signs it). The wallet only funds postage — demanding its leaf sig here would
  // make every recipient exit impossible (they do not hold that key).
  if (!walletSignsVault) {
    const fIdx = payout.vaultInputCount
    const fin = tx.getInput(fIdx)
    let fundingSig = ''
    if (fin.tapKeySig && fin.tapKeySig.length >= 64) fundingSig = bytesToHex(fin.tapKeySig.subarray(0, 64))
    else if (fin.finalScriptWitness && fin.finalScriptWitness.length === 1 && fin.finalScriptWitness[0].length >= 64) {
      fundingSig = bytesToHex(fin.finalScriptWitness[0].subarray(0, 64))
    }
    if (!fundingSig) throw new Error('exit-payout: the wallet did not sign the funding input — the exiter pays the postage and the fee, so their sats must co-sign')
    const outputKey = payout.funding.scriptHex.toLowerCase().slice(4)
    if (!schnorr.verify(hexToBytes(fundingSig), hexToBytes(payout.sighashes[fIdx]), hexToBytes(outputKey))) {
      throw new Error('exit-payout: the funding signature does not open its key-path sighash')
    }
    return { depositorSigs, fundingSig }
  }
  for (let i = 0; i < payout.vaultInputCount; i++) {
    const inp = tx.getInput(i)
    let found = ''
    for (const [keyInfo, sig] of inp.tapScriptSig ?? []) {
      if (bytesToHex(keyInfo.pubKey) === depositor) { found = bytesToHex(sig); break }
    }
    // some BIP-371 signers FINALIZE what they sign — the signature then lives in the witness
    // instead of tapScriptSig. Recover it by testing every 64-byte item against the sighash:
    // a Schnorr signature either opens it under the depositor's key or it is not the one.
    if (!found && inp.finalScriptWitness) {
      for (const item of inp.finalScriptWitness) {
        if (item.length !== 64) continue
        const cand = bytesToHex(item)
        if (verifySighash(payout.sighashes[i], cand, depositor)) { found = cand; break }
      }
    }
    if (!found) throw new Error(`exit-payout: the wallet did not sign vault input ${i}'s cooperative leaf — the owner's signature is REQUIRED (no threshold of guardians can move funds alone)`)
    // BIP-341 commits the hash type INSIDE the preimage: a 65-byte signature (explicit type)
    // was made over different bytes than the DEFAULT sighash this builder stated and showed.
    // Only the 64-byte DEFAULT form can ever verify here — anything else is refused by shape.
    if (found.length !== 128) throw new Error(`exit-payout: vault input ${i}'s signature must be the 64-byte SIGHASH_DEFAULT form — ask the wallet to sign with DEFAULT (0x00)`)
    if (!verifySighash(payout.sighashes[i], found, depositor)) throw new Error(`exit-payout: the depositor's signature does not open vault input ${i}'s sighash`)
    depositorSigs.push(found)
  }
  const fIdx = payout.vaultInputCount
  const fin = tx.getInput(fIdx)
  let fundingSig = ''
  if (fin.tapKeySig && fin.tapKeySig.length >= 64) fundingSig = bytesToHex(fin.tapKeySig.subarray(0, 64))
  else if (fin.finalScriptWitness && fin.finalScriptWitness.length === 1 && fin.finalScriptWitness[0].length >= 64) {
    fundingSig = bytesToHex(fin.finalScriptWitness[0].subarray(0, 64))
  }
  if (!fundingSig) throw new Error('exit-payout: the wallet did not sign the funding input — the exiter pays the postage and the fee, so their sats must co-sign')
  // key-path: the signature verifies against the OUTPUT key — the witness program itself
  const outputKey = payout.funding.scriptHex.toLowerCase().slice(4)
  if (!schnorr.verify(hexToBytes(fundingSig), hexToBytes(payout.sighashes[fIdx]), hexToBytes(outputKey))) {
    throw new Error('exit-payout: the funding signature does not open its key-path sighash')
  }
  return { depositorSigs, fundingSig }
}

/**
 * FINALIZE — guardian signatures (exactly threshold, verified) + the wallet's
 * two signatures become the witnesses Bitcoin executes. Same witness-order law
 * as vault-spend.ts: guardian sigs in REVERSE key order with empty pushes for
 * non-signers, the depositor's signature ON TOP (CHECKSIGVERIFY pops it first),
 * then leaf script and control block. The funding input is one Schnorr sig.
 */
export function finalizeExitPayout(
  payout: ExitPayout,
  guardianSigsByKey: Array<Map<string, string>> | Map<string, string>,
  depositorSigs: string[],
  fundingSig: string,
): { txHex: string; txid: string } {
  const { guardians, threshold } = payout.params
  if (depositorSigs.length !== payout.vaultInputCount) throw new Error('exit-payout: one depositor signature per vault input')
  // each vault input has its OWN sighash — one signature set per input (a single map is
  // accepted only as shorthand for the common one-outpoint vault)
  const perInput = Array.isArray(guardianSigsByKey)
    ? guardianSigsByKey
    : Array.from({ length: payout.vaultInputCount }, () => guardianSigsByKey)
  if (perInput.length !== payout.vaultInputCount) throw new Error('exit-payout: one guardian signature set per vault input')

  const tx = btc.Transaction.fromRaw(hexToBytes(payout.unsignedTxHex), { allowUnknownInputs: true, allowUnknownOutputs: true })
  for (let i = 0; i < payout.vaultInputCount; i++) {
    const valid = new Map<string, string>()
    for (const [k, sig] of perInput[i]) {
      const key = k.toLowerCase()
      if (!guardians.includes(key)) throw new Error(`exit-payout: ${key.slice(0, 12)}… is not in this vault's federation`)
      if (!verifySighash(payout.sighashes[i], sig, key)) throw new Error(`exit-payout: the signature from ${key.slice(0, 12)}… does not open input ${i}'s sighash — refused before it can poison the witness`)
      valid.set(key, sig.toLowerCase())
    }
    if (valid.size !== threshold) throw new Error(`exit-payout: the cooperative leaf needs EXACTLY ${threshold} guardian signatures (NUMEQUAL, not a minimum) — got ${valid.size}`)
    if (!verifySighash(payout.sighashes[i], depositorSigs[i], payout.params.depositor)) {
      throw new Error(`exit-payout: the depositor's signature does not open vault input ${i}'s sighash — the owner must co-sign (guardian collusion is impossible, not just visible)`)
    }
    const stack: Uint8Array[] = []
    for (let g = guardians.length - 1; g >= 0; g--) {
      const sig = valid.get(guardians[g])
      stack.push(sig ? hexToBytes(sig) : new Uint8Array(0))
    }
    stack.push(hexToBytes(depositorSigs[i]))
    tx.updateInput(i, { finalScriptWitness: [...stack, hexToBytes(payout.leafScript), hexToBytes(payout.controlBlock)] }, true)
  }
  const fIdx = payout.vaultInputCount
  const outputKey = payout.funding.scriptHex.toLowerCase().slice(4)
  if (!schnorr.verify(hexToBytes(fundingSig), hexToBytes(payout.sighashes[fIdx]), hexToBytes(outputKey))) {
    throw new Error('exit-payout: the funding signature does not open its key-path sighash')
  }
  tx.updateInput(fIdx, { finalScriptWitness: [hexToBytes(fundingSig)] }, true)
  const raw = tx.toBytes(true, true)
  return { txHex: bytesToHex(raw), txid: tx.id }
}

/** ONE GUARDIAN SIGNATURE per sighash — a thin, explicit wrapper so the lab door
 *  and a future remote co-signer share the exact same bytes-in, bytes-out contract. */
export function signVaultSighash(sighashHex: string, secretKey: Uint8Array): string {
  if (!/^[0-9a-f]{64}$/.test(sighashHex)) throw new Error('exit-payout: a sighash is 32 bytes of hex')
  return bytesToHex(schnorr.sign(hexToBytes(sighashHex), secretKey))
}
