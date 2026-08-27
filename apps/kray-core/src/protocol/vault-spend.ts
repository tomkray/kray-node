/**
 * SPENDING THE VAULT — the transaction that closes the circle L1 → L2 → L1.
 *
 * The vault (vault.ts) is a derivation: it tells a depositor WHERE their rune
 * sits and WHAT can move it. This file is the moving itself — building the
 * Bitcoin transaction that spends a vault outpoint through one of its two
 * paths, collecting the signatures, and assembling the witness that Bitcoin's
 * consensus will actually execute.
 *
 *   COOPERATIVE   exactly t of the n sealed guardians sign. Not "at least":
 *                 the leaf ends in NUMEQUAL, so the accumulator must equal t
 *                 EXACTLY — one signature too many fails consensus just as one
 *                 too few does. The finalizer enforces this before Bitcoin has
 *                 to, and refuses with the numbers named.
 *
 *   UNILATERAL    the depositor alone, with nSequence carrying the timelock.
 *                 CHECKSEQUENCEVERIFY demands version ≥ 2 and a sequence that
 *                 encodes at least Δ blocks — both are set here, not left for
 *                 the caller to remember.
 *
 * Signatures are BIP-340 Schnorr over the BIP-341 sighash (SIGHASH_DEFAULT, so
 * 64 bytes, no appended type byte). Each guardian signs INDEPENDENTLY — there
 * is no ceremony, no shared state, no ordering requirement on who signs first;
 * the finalizer places each signature where the script expects it.
 *
 * ── THE WITNESS-ORDER LAW, because it is easy to get fatally wrong ─────────
 * Witness items are pushed onto the stack in order, so the LAST item sits on
 * top. The script pushes <g1> first and CHECKSIG pops <g1> plus the item under
 * it — the top of the initial stack. So g1's signature is the LAST witness
 * item, and the stack reads [sig_gn … sig_g2, sig_g1]: SIGNATURES IN REVERSE
 * KEY ORDER, an empty push for every guardian who did not sign. An empty
 * signature makes CHECKSIG(ADD) contribute 0 and continue; a WRONG non-empty
 * signature aborts the script immediately (BIP-342) — which is why the
 * finalizer verifies every signature against the sighash before it builds
 * anything.
 *
 * Pure: no I/O, no network, no keys held. The node never signs — guardians
 * and depositors do, wherever their keys live.
 */
import * as btc from '@scure/btc-signer'
import { schnorr } from '@noble/curves/secp256k1.js'
import { NETWORKS } from './scheme.ts'
import { deriveVault, toXOnly, type VaultParams } from './vault.ts'

/** An unspent vault output being spent. Amounts are integer satoshis. */
export interface VaultUtxo { txid: string; vout: number; amountSats: bigint }
/** Where the funds go. Give an `address` (any Bitcoin address on the vault's net) OR a raw `script`
 *  (hex scriptPubKey) — the latter lets a payout carry a runestone OP_RETURN that moves the runes to
 *  the owner. An OP_RETURN script may be 0-value; every other output must be positive. */
export interface SpendOutput { address?: string; script?: string; amountSats: bigint }

export interface VaultSpend {
  /** the unsigned transaction, serialized — what every signer commits to */
  unsignedTxHex: string
  /** one BIP-341 sighash per input, hex — the exact 32 bytes each key signs */
  sighashes: string[]
  /** which path this spend uses; it decides the witness shape */
  path: 'cooperative' | 'unilateral'
  /** the vault parameters, normalised by deriveVault — the single source */
  params: ReturnType<typeof deriveVault>['params']
  /** internal: what finalization needs (script + control block, hex) */
  leafScript: string
  controlBlock: string
  utxos: VaultUtxo[]
  outputs: SpendOutput[]
}

const SEQUENCE_FINAL_RBF = 0xfffffffd
const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** Rebuild the taproot payment and pick out one leaf with its control block. */
function leafOf(params: VaultParams, which: 'cooperative' | 'unilateral') {
  const v = deriveVault(params)
  const payment = btc.p2tr(
    btc.TAPROOT_UNSPENDABLE_KEY,
    [{ script: hexToBytes(v.cooperativeScript) }, { script: hexToBytes(v.unilateralScript) }],
    NETWORKS[params.net],
    true,
  )
  const want = which === 'cooperative' ? v.cooperativeScript : v.unilateralScript
  for (const [cb, scriptWithVer] of payment.tapLeafScript ?? []) {
    const script = scriptWithVer.subarray(0, -1) // the last byte is the leaf version
    if (bytesToHex(script) === want) {
      return { vault: v, script, controlBlock: btc.TaprootControlBlock.encode(cb), outScript: payment.script! }
    }
  }
  /* c8 ignore next — deriveVault built both leaves; not finding one is impossible */
  throw new Error('vault-spend: the leaf is not in its own tree')
}

/**
 * BUILD THE UNSIGNED SPEND. Deterministic: the same inputs, outputs and path
 * produce the same transaction and the same sighashes on every machine — so a
 * guardian can rebuild it locally and refuse to sign anything that differs.
 *
 * No fee logic lives here on purpose: outputs are stated exactly, and the fee
 * is whatever the inputs exceed the outputs by. A function that "helpfully"
 * adjusts amounts is a function a signer can no longer predict.
 */
export function buildVaultSpend(
  params: VaultParams,
  utxos: VaultUtxo[],
  outputs: SpendOutput[],
  path: 'cooperative' | 'unilateral',
): VaultSpend {
  if (!utxos.length) throw new Error('vault-spend: nothing to spend')
  for (const u of utxos) if (typeof u.amountSats !== 'bigint') throw new Error('vault-spend: an amount must be a BigInt of satoshis — a float or a Number is not money')
  for (const o of outputs) if (typeof o.amountSats !== 'bigint') throw new Error('vault-spend: an amount must be a BigInt of satoshis — a float or a Number is not money')
  if (!outputs.length) throw new Error('vault-spend: a spend needs at least one output')
  // shape before economics: a malformed utxo is refused as malformed, not as poor
  const seen = new Set<string>()
  for (const u of utxos) {
    if (!/^[0-9a-f]{64}$/.test(u.txid)) throw new Error('vault-spend: a utxo txid must be 64 hex chars')
    if (u.amountSats <= 0n) throw new Error('vault-spend: a utxo must carry a positive amount')
    const op = `${u.txid}:${u.vout}`
    // the same outpoint twice inflates the input sum and signs a transaction the
    // network can only reject AFTER the whole threshold ceremony was spent on it
    if (seen.has(op)) throw new Error(`vault-spend: outpoint ${op.slice(0, 20)}… listed twice`)
    seen.add(op)
  }
  const inSum = utxos.reduce((t, u) => t + u.amountSats, 0n)
  const outSum = outputs.reduce((t, o) => t + o.amountSats, 0n)
  if (outSum > inSum) throw new Error(`vault-spend: outputs (${outSum}) exceed inputs (${inSum}) — a transaction cannot create satoshis`)
  for (const o of outputs) {
    if (!o.address === !o.script) throw new Error('vault-spend: each output needs exactly one of address or script')
    if (o.amountSats < 0n) throw new Error('vault-spend: an output amount cannot be negative')
    // 0-value is lawful only for a data carrier (OP_RETURN, 0x6a); every paid output must be positive
    const isOpReturn = !!o.script && o.script.length >= 2 && o.script.slice(0, 2).toLowerCase() === '6a'
    if (o.amountSats === 0n && !isOpReturn) throw new Error('vault-spend: a paid output must carry a positive amount — only an OP_RETURN may be 0')
  }

  const { vault, script, controlBlock, outScript } = leafOf(params, path)
  // CSV needs version ≥ 2; the unilateral input's sequence IS the timelock,
  // encoded as blocks (bit 22 clear). The cooperative path just stays RBF-able.
  const sequence = path === 'unilateral' ? vault.params.timelock : SEQUENCE_FINAL_RBF
  const tx = new btc.Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true, version: 2 })
  for (const u of utxos) {
    tx.addInput({
      txid: u.txid, index: u.vout, sequence,
      witnessUtxo: { script: outScript, amount: u.amountSats },
    })
  }
  const net = NETWORKS[params.net]
  for (const o of outputs) {
    if (o.script) tx.addOutput({ script: hexToBytes(o.script), amount: o.amountSats })
    else tx.addOutputAddress(o.address!, o.amountSats, net)
  }

  // the BIP-341 sighash for every input, committed to this exact leaf
  const prevScripts = utxos.map(() => outScript)
  const amounts = utxos.map((u) => u.amountSats)
  const sighashes = utxos.map((_, i) =>
    bytesToHex(tx.preimageWitnessV1(i, prevScripts, btc.SigHash.DEFAULT, amounts, undefined, script, 0xc0)))

  return {
    unsignedTxHex: bytesToHex(tx.toBytes(true, false)),
    sighashes, path, params: vault.params,
    leafScript: bytesToHex(script), controlBlock: bytesToHex(controlBlock),
    utxos, outputs,
  }
}

/**
 * ONE SIGNATURE, from wherever the key lives. BIP-340 over the stated sighash,
 * SIGHASH_DEFAULT — 64 bytes, nothing appended. This is the only function that
 * touches a secret, and it holds it for exactly one call.
 */
export function signSighash(sighashHex: string, secretKey: Uint8Array): string {
  if (!/^[0-9a-f]{64}$/.test(sighashHex)) throw new Error('vault-spend: a sighash is 32 bytes of hex')
  return bytesToHex(schnorr.sign(hexToBytes(sighashHex), secretKey))
}

/** Does this signature really open this sighash under this x-only key? */
export function verifySighash(sighashHex: string, signatureHex: string, xonlyHex: string): boolean {
  try { return schnorr.verify(hexToBytes(signatureHex), hexToBytes(sighashHex), hexToBytes(xonlyHex)) }
  catch (_) { return false }
}

/**
 * FINALIZE THE COOPERATIVE SPEND. Takes the signatures however they arrived —
 * keyed by guardian x-only key — verifies EVERY one against the input's
 * sighash, and refuses unless exactly t verify: NUMEQUAL will fail on t−1 and
 * on t+1 alike, so the finalizer fails first, with the numbers named, before a
 * broken witness ever reaches the network.
 *
 * Returns the fully signed transaction, ready to broadcast.
 */
export function finalizeCooperative(
  spend: VaultSpend,
  signaturesByKey: Array<Map<string, string>> | Map<string, string>,
  depositorSignature: string[] | string,
): { txHex: string; txid: string } {
  if (spend.path !== 'cooperative') throw new Error('vault-spend: this spend was built for the unilateral path')
  const perInput = Array.isArray(signaturesByKey) ? signaturesByKey : spend.utxos.map(() => signaturesByKey)
  if (perInput.length !== spend.utxos.length) throw new Error('vault-spend: one signature set per input')
  // THE OWNER CO-SIGNS — the cooperative leaf is <depositor> CHECKSIGVERIFY … so without the
  // depositor's own signature no threshold of guardians can spend. One per input, verified here.
  const depSigs = Array.isArray(depositorSignature) ? depositorSignature : spend.utxos.map(() => depositorSignature)
  if (depSigs.length !== spend.utxos.length) throw new Error('vault-spend: one depositor signature per input')
  const { guardians, threshold } = spend.params
  const tx = btc.Transaction.fromRaw(hexToBytes(spend.unsignedTxHex), { allowUnknownInputs: true, allowUnknownOutputs: true })

  for (let i = 0; i < spend.utxos.length; i++) {
    const sigs = perInput[i]
    // the SAME normalisation rule as everywhere else: a guardian who identifies
    // by their sealed 33-byte compressed key is the same guardian, not a stranger
    const provided = [...sigs.keys()].map((k) => toXOnly(k))
    for (const k of provided) if (!guardians.includes(k)) throw new Error(`vault-spend: ${k.slice(0, 12)}… is not in this vault's federation`)
    // verify first, count second: a wrong signature in a CHECKSIGADD witness
    // aborts the whole script on-chain, so it must never leave this function
    const valid = new Map<string, string>()
    for (const [k, sig] of sigs) {
      const key = toXOnly(k)
      if (!verifySighash(spend.sighashes[i], sig, key)) throw new Error(`vault-spend: the signature from ${key.slice(0, 12)}… does not open input ${i}'s sighash — refused before it can poison the witness`)
      valid.set(key, sig.toLowerCase())
    }
    if (valid.size !== threshold) throw new Error(`vault-spend: the cooperative leaf needs EXACTLY ${threshold} signatures (NUMEQUAL, not a minimum) — got ${valid.size}`)
    // the witness-order law: [sig_gn … sig_g1], empty push for non-signers, then the
    // depositor's signature ON TOP — CHECKSIGVERIFY runs first and consumes it first.
    const stack: Uint8Array[] = []
    for (let g = guardians.length - 1; g >= 0; g--) {
      const sig = valid.get(guardians[g])
      stack.push(sig ? hexToBytes(sig) : new Uint8Array(0))
    }
    const depSig = depSigs[i]
    if (!verifySighash(spend.sighashes[i], depSig, spend.params.depositor)) {
      throw new Error(`vault-spend: the depositor's signature does not open input ${i}'s sighash — the owner must co-sign the cooperative path (no threshold of guardians can move funds alone)`)
    }
    stack.push(hexToBytes(depSig))
    tx.updateInput(i, { finalScriptWitness: [...stack, hexToBytes(spend.leafScript), hexToBytes(spend.controlBlock)] }, true)
  }
  const raw = tx.toBytes(true, true)
  return { txHex: bytesToHex(raw), txid: tx.id }
}

/**
 * FINALIZE THE UNILATERAL SPEND — the depositor alone, after the wait. The
 * sequence was already set to the timelock at build time; this verifies the
 * depositor's signature and assembles the one-item witness.
 */
export function finalizeUnilateral(spend: VaultSpend, signatures: string[] | string): { txHex: string; txid: string } {
  if (spend.path !== 'unilateral') throw new Error('vault-spend: this spend was built for the cooperative path')
  const perInput = Array.isArray(signatures) ? signatures : spend.utxos.map(() => signatures)
  if (perInput.length !== spend.utxos.length) throw new Error('vault-spend: one signature per input')
  const tx = btc.Transaction.fromRaw(hexToBytes(spend.unsignedTxHex), { allowUnknownInputs: true, allowUnknownOutputs: true })
  for (let i = 0; i < spend.utxos.length; i++) {
    if (!verifySighash(spend.sighashes[i], perInput[i], spend.params.depositor)) {
      throw new Error(`vault-spend: the depositor's signature does not open input ${i}'s sighash`)
    }
    tx.updateInput(i, { finalScriptWitness: [hexToBytes(perInput[i]), hexToBytes(spend.leafScript), hexToBytes(spend.controlBlock)] }, true)
  }
  const raw = tx.toBytes(true, true)
  return { txHex: bytesToHex(raw), txid: tx.id }
}

/**
 * AUDIT A FINAL SPEND — what a stranger (or the L2's reducer, matching a burn)
 * runs against the broadcast bytes. Re-derives the vault, re-computes every
 * sighash from the raw transaction, and re-verifies every signature in the
 * witness. Nothing is taken from the spend object; only the bytes and the
 * public parameters speak.
 */
export function auditVaultSpend(
  txHex: string,
  params: VaultParams,
  utxos: VaultUtxo[],
): { ok: boolean; path?: 'cooperative' | 'unilateral'; paths?: Array<'cooperative' | 'unilateral'>; signers?: string[]; outpoints?: string[]; reason?: string } {
  try {
    const v = deriveVault(params)
    for (const u of utxos) {
      if (typeof u.amountSats !== 'bigint') return { ok: false, reason: 'an amount must be a BigInt of satoshis — a float or a Number is not money' }
      if (u.amountSats <= 0n) return { ok: false, reason: 'a utxo must carry a positive amount' }
      if (!/^[0-9a-f]{64}$/.test(u.txid)) return { ok: false, reason: 'a utxo txid must be 64 hex chars' }
    }
    const tx = btc.Transaction.fromRaw(hexToBytes(txHex), { allowUnknownInputs: true, allowUnknownOutputs: true })
    if (tx.inputsLength !== utxos.length) return { ok: false, reason: 'the utxo list does not match the transaction' }
    // BIND THE CLAIM TO THE TRANSACTION. BIP-341 commits to outpoints through
    // sha_prevouts computed from the transaction itself, so caller-supplied
    // txid/vout are otherwise UNUSED — and a spend of vault utxo X would answer
    // "yes" to a question about utxo Y whenever the amounts happened to match,
    // which is the normal case for uniform deposits. One on-chain release could
    // then be credited against two L2 peg-outs. The audit must answer the
    // question a reducer actually asks: "was THIS outpoint released?"
    for (let i = 0; i < utxos.length; i++) {
      const inp = tx.getInput(i)
      const gotTxid = inp.txid ? bytesToHex(inp.txid) : ''
      if (gotTxid !== utxos[i].txid || inp.index !== utxos[i].vout) {
        return { ok: false, reason: `input ${i} spends ${gotTxid.slice(0, 16)}…:${inp.index}, not the claimed ${utxos[i].txid.slice(0, 16)}…:${utxos[i].vout}` }
      }
      // a native witness program REQUIRES an empty scriptSig; a non-empty one is
      // consensus-invalid yet changes the txid, so blessing it would record a
      // settlement reference that can never confirm while the real spend does
      if (inp.finalScriptSig && inp.finalScriptSig.length > 0) {
        return { ok: false, reason: `input ${i} carries a non-empty scriptSig — invalid for a witness program, and a txid-malleated mutant of a real spend` }
      }
    }
    // a transaction cannot create satoshis; an audit that never checks this would
    // bless one that does
    const inSum = utxos.reduce((t, u) => t + u.amountSats, 0n)
    let outSum = 0n
    for (let o = 0; o < tx.outputsLength; o++) outSum += tx.getOutput(o).amount ?? 0n
    if (outSum > inSum) return { ok: false, reason: `outputs (${outSum}) exceed the vault inputs (${inSum})` }

    const coopLeaf = leafOf(params, 'cooperative')
    const soloLeaf = leafOf(params, 'unilateral')
    const prevScripts = utxos.map(() => coopLeaf.outScript)
    const amounts = utxos.map((u) => u.amountSats)
    const paths: Array<'cooperative' | 'unilateral'> = []
    const signers = new Set<string>()

    for (let i = 0; i < tx.inputsLength; i++) {
      let witness = tx.getInput(i).finalScriptWitness
      if (!witness || witness.length < 2) return { ok: false, reason: `input ${i} has no script-path witness` }
      // THE ANNEX (BIP-341): with ≥ 2 witness elements, a last element starting
      // 0x50 is the annex — stripped before locating script and control block,
      // but COMMITTED in the sighash. An audit that forgot this would call a
      // consensus-valid spend unlawful, and the L2 would refuse to recognise a
      // burn that really happened on L1. This finalizer never emits an annex;
      // the audit exists for OTHER people's transactions too.
      let annex: Uint8Array | undefined
      if (witness[witness.length - 1].length > 0 && witness[witness.length - 1][0] === 0x50) {
        annex = witness[witness.length - 1]
        witness = witness.slice(0, -1)
      }
      if (witness.length < 3) return { ok: false, reason: `input ${i} has no script-path witness` }
      const script = bytesToHex(witness[witness.length - 2])
      const isCoop = script === v.cooperativeScript
      const isSolo = script === v.unilateralScript
      if (!isCoop && !isSolo) return { ok: false, reason: `input ${i} spends a script that is not one of this vault's two leaves` }
      const thisPath: 'cooperative' | 'unilateral' = isCoop ? 'cooperative' : 'unilateral'
      // ── THE CONTROL BLOCK, WHICH IS THE WHOLE POINT OF A SCRIPT PATH ──────
      // BIP-341 validation IS the control block: it carries the leaf version and
      // the internal key's parity, and folding tapleaf_hash through its path
      // must reproduce the taproot output key. Skipping it means approving a
      // spend whose leaf was never proven to be in THIS tree — Bitcoin would
      // reject it while the audit said yes. In a two-leaf tree the control block
      // for a given leaf is UNIQUE, so requiring the exact bytes we derive
      // ourselves is a complete check: version, parity and tree membership at
      // once, with no hash folding of our own to get subtly wrong. It is also
      // what makes the hardcoded 0xc0 leaf version below correct rather than
      // assumed — a control block declaring any other version cannot match.
      const expectedCb = thisPath === 'cooperative' ? coopLeaf.controlBlock : soloLeaf.controlBlock
      const gotCb = witness[witness.length - 1]
      if (bytesToHex(gotCb) !== bytesToHex(expectedCb)) {
        return { ok: false, reason: `input ${i}: the control block does not prove this leaf belongs to this vault's tap tree — Bitcoin's consensus would reject this spend` }
      }
      paths.push(thisPath)
      // A TAPROOT SIGNATURE IS 64 OR 65 BYTES (BIP-342): 64 means SIGHASH_DEFAULT;
      // 65 carries an explicit type byte, which must not be 0x00 and changes the
      // preimage. Another wallet's lawful spend may use either form.
      const preimage = (hashType: number) =>
        bytesToHex(tx.preimageWitnessV1(i, prevScripts, hashType, amounts, undefined, hexToBytes(script), 0xc0, annex))
      const checkSig = (sig: Uint8Array, keyHex: string): boolean => {
        try {
          if (sig.length === 64) return verifySighash(preimage(btc.SigHash.DEFAULT), bytesToHex(sig), keyHex)
          if (sig.length !== 65) return false
          const ht = sig[64]
          if (![0x01, 0x02, 0x03, 0x81, 0x82, 0x83].includes(ht)) return false // explicit 0x00 is invalid by law
          return verifySighash(preimage(ht), bytesToHex(sig.subarray(0, 64)), keyHex)
        } catch (_) { return false }
      }

      if (isCoop) {
        const stack = witness.slice(0, -2)
        // <depositor> CHECKSIGVERIFY <g1> CHECKSIG … : the depositor's sig sits ON TOP (last),
        // the n guardian slots below it — exactly guardians.length + 1 stack items.
        if (stack.length !== v.params.guardians.length + 1) return { ok: false, reason: `input ${i}: ${stack.length} witness slots for the depositor + ${v.params.guardians.length} guardians` }
        // the depositor MUST have co-signed, or CHECKSIGVERIFY fails the whole leaf: this is
        // what makes guardian collusion impossible rather than merely visible.
        if (!checkSig(stack[stack.length - 1], v.params.depositor)) return { ok: false, reason: `input ${i}: the depositor did not co-sign the cooperative leaf — no threshold of guardians can move funds alone` }
        signers.add(v.params.depositor)
        let count = 0
        for (let g = 0; g < v.params.guardians.length; g++) {
          const sig = stack[stack.length - 2 - g] // reverse order below the depositor — g1's slot is just under the top
          if (sig.length === 0) continue
          if (!checkSig(sig, v.params.guardians[g])) return { ok: false, reason: `input ${i}: the signature in guardian ${g}'s slot does not verify` }
          signers.add(v.params.guardians[g])
          count++
        }
        if (count !== v.params.threshold) return { ok: false, reason: `input ${i}: ${count} valid guardian signatures where NUMEQUAL demands exactly ${v.params.threshold}` }
      } else {
        // THE TOP OF THE STACK, NOT THE BOTTOM. Witness items are pushed
        // bottom-first, so CHECKSIGVERIFY pops the LAST pre-script item — and
        // BIP-342 enforces cleanstack, so there must be exactly one. Reading
        // witness[0] passed a spend consensus rejects and rejected one it
        // accepts: wrong in both directions.
        const stack = witness.slice(0, -2)
        if (stack.length !== 1) return { ok: false, reason: `input ${i}: the unilateral path takes exactly one stack item, got ${stack.length} — BIP-342 enforces cleanstack` }
        if (!checkSig(stack[0], v.params.depositor)) return { ok: false, reason: `input ${i}: the depositor's signature does not verify` }
        const seq = tx.getInput(i).sequence ?? 0
        // consensus reads nVersion as UNSIGNED (a sign-bit version still satisfies
        // CSV); comparing it signed would reject a spend Bitcoin accepts
        if ((tx.version >>> 0) < 2) return { ok: false, reason: 'CSV needs transaction version ≥ 2' }
        if (seq >= 0x80000000 || (seq & 0x400000) !== 0 || (seq & 0xffff) < v.params.timelock) {
          return { ok: false, reason: `input ${i}: sequence ${seq} does not encode ≥ ${v.params.timelock} blocks — CHECKSEQUENCEVERIFY would reject it` }
        }
        signers.add(v.params.depositor)
      }
    }
    // a sweep may lawfully use both leaves in one transaction; report per input
    // rather than refusing a movement Bitcoin would accept
    const uniform = paths.every((p) => p === paths[0]) ? paths[0] : undefined
    return { ok: true, path: uniform, paths, signers: [...signers], outpoints: utxos.map((u) => `${u.txid}:${u.vout}`) }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'malformed spend' }
  }
}
