/**
 * THE PRE-SIGNED SETTLEMENT — the reflex the watcher triggers, so the escape fails on its own.
 *
 * The residue (vault.ts): after the timelock a depositor can sweep their vault's PHYSICAL total
 * even if their L2 book balance has since dropped — the runes they sent to others on the L2 still
 * sit in their vault on L1. The watcher (vault-watch.ts) is the EYE that sees such a sweep. This is
 * the REFLEX: a cooperative settlement, co-signed by the depositor at transfer time, that splits
 * their vault so the depositor keeps EXACTLY their current book balance and the remainder goes to a
 * consolidation destination that backs everyone else's claim.
 *
 * Why it wins — the HONEST claim (verified 2026-08-23; the earlier "always confirms first / auto-failing"
 * was an overclaim). BELOW the CSV delay Δ the escape is BIP-68 non-final: bitcoind rejects it and no miner
 * may include it (CONSENSUS), so the no-timelock settlement relays + confirms UNOPPOSED — a true win. AT/AFTER
 * Δ both signal RBF and it becomes a fee AUCTION: the settlement's fee is fixed (pre-signed), so a higher-fee
 * escape can replace it or be mined direct-to-miner past the reactive watcher — the settlement can LOSE. For
 * a PERSONAL vault this is bounded (one depositor, small outpoint, the fee-ladder + a refresh keep it below Δ)
 * and the depositor SIGNS the settlement (energy flows, the exchange stays exact); the guarantee is
 * consensus-grade only while the outpoint stays below Δ, degrading to a fee auction after.
 *
 * ── THE SAFETY PROPERTY, PROVEN BY THE SAME DECODER THE BRIDGE USES ─────────────────────────────
 * A settlement is a RUNESTONE, and a malformed one BURNS. So this module never asserts safety — it
 * builds the runestone and then runs it through `decipher` + `allocate` (runestone.ts, matched to
 * ord) and refuses unless: nothing is burned, conservation holds, and the depositor output receives
 * NO MORE than their book balance. One edict moves the depositor's share to their output; the
 * runestone POINTER routes the remainder to the consolidation output — one edict, no cenotaph.
 *
 * Pure and total: no I/O, no keys, no node. The cooperative spend itself is built and co-signed by
 * the existing, proven vault-spend.ts machinery — this only decides the OUTPUTS and proves them safe.
 */
import { TAG, encodeVarint, decipher, allocate, type RuneId } from './runestone.ts'
import type { SpendOutput } from './vault-spend.ts'

const OP_RETURN = 0x6a
const OP_13 = 0x5d
const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** BIP-110 / Core standardness: the WHOLE runestone scriptPubKey, not the inner payload. */
export const RUNESTONE_SCRIPT_MAX = 83
const OP_PUSHDATA1 = 0x4c

/** A minimal single-byte-length push (payloads here are always < 76 bytes; a settlement carries one
 *  edict + a pointer, well under the limit). Larger payloads would need OP_PUSHDATA1 — not reachable here. */
function pushData(payload: Uint8Array): Uint8Array {
  if (payload.length >= 0x4c) throw new Error('vault-settlement: runestone payload unexpectedly large — a settlement is one edict + pointer')
  return Uint8Array.from([payload.length, ...payload])
}

function encodeRunestoneScript(payload: Uint8Array): string {
  const prefix = payload.length < OP_PUSHDATA1
    ? Uint8Array.from([OP_RETURN, OP_13, payload.length])
    : Uint8Array.from([OP_RETURN, OP_13, OP_PUSHDATA1, payload.length])
  const script = Uint8Array.from([...prefix, ...payload])
  if (script.length > RUNESTONE_SCRIPT_MAX) {
    throw new Error(`vault-settlement: the runestone script is ${script.length} bytes — BIP-110 / relay cap is ${RUNESTONE_SCRIPT_MAX}; split the loaf`)
  }
  return bytesToHex(script)
}

/**
 * BUILD THE RUNESTONE that keeps `depositorRunes` of the rune on the depositor's output and routes
 * everything else (via the pointer) to the consolidation output. Fields (Pointer) come BEFORE the
 * Body/edicts, exactly as the decoder reads them.
 */
export function settlementRunestoneHex(runeId: RuneId, depositorRunes: bigint, depositorOutput: number, consolidationOutput: number): string {
  if (depositorRunes < 0n) throw new Error('vault-settlement: the depositor share cannot be negative')
  const parts: Uint8Array[] = []
  // Pointer FIELD first (tag 22 → the consolidation output catches the unallocated remainder)
  parts.push(encodeVarint(TAG.Pointer), encodeVarint(BigInt(consolidationOutput)))
  // Body + ONE edict moves the depositor's share to their output — BUT an edict amount of 0 means
  // "all of it" in Runes, so when the depositor keeps NOTHING we emit NO edict and let the pointer
  // route the whole balance to consolidation. Emitting a 0-amount edict would hand them everything.
  if (depositorRunes > 0n) {
    parts.push(encodeVarint(TAG.Body), encodeVarint(runeId.block), encodeVarint(runeId.tx), encodeVarint(depositorRunes), encodeVarint(BigInt(depositorOutput)))
  }
  const payload = Uint8Array.from(parts.flatMap((p) => [...p]))
  const script = Uint8Array.from([OP_RETURN, OP_13, ...pushData(payload)])
  return bytesToHex(script)
}

export interface BatchEdict { amount: bigint; output: number }

/**
 * Many dests, one pointer. N=1 is BYTE-IDENTICAL to `settlementRunestoneHex`
 * (same edict + pointer). Extra dests are same-rune deltas (0,0) after the first
 * edict. Refuses a script over the 83-byte runestone cap — a loaf that cannot
 * relay is not a loaf.
 */
export function batchSettlementRunestoneHex(runeId: RuneId, dests: BatchEdict[], consolidationOutput: number): string {
  if (!dests.length) throw new Error('vault-settlement: a batch runestone needs at least one destination edict')
  if (dests.length === 1) return settlementRunestoneHex(runeId, dests[0].amount, dests[0].output, consolidationOutput)
  const parts: Uint8Array[] = []
  parts.push(encodeVarint(TAG.Pointer), encodeVarint(BigInt(consolidationOutput)))
  parts.push(encodeVarint(TAG.Body))
  for (let i = 0; i < dests.length; i++) {
    const d = dests[i]
    if (d.amount <= 0n) throw new Error('vault-settlement: a batch edict amount of 0 means ALL in Runes — refused (it would steal the loaf)')
    if (d.output < 0) throw new Error('vault-settlement: a batch edict output cannot be negative')
    const blockDelta = i === 0 ? runeId.block : 0n
    const txValue = i === 0 ? runeId.tx : 0n
    parts.push(encodeVarint(blockDelta), encodeVarint(txValue), encodeVarint(d.amount), encodeVarint(BigInt(d.output)))
  }
  return encodeRunestoneScript(Uint8Array.from(parts.flatMap((p) => [...p])))
}

/** True when these amounts encode into a relay-legal runestone (pointer after the dests + OP_RETURN). */
export function batchRunestoneFits(runeId: RuneId, amounts: bigint[]): boolean {
  if (!amounts.length) return false
  try {
    batchSettlementRunestoneHex(runeId, amounts.map((amount, output) => ({ amount, output })), amounts.length + 1)
    return true
  } catch {
    return false
  }
}

export interface SettlementPlan {
  runeId: RuneId
  totalVaultRunes: bigint       // what the vault outpoint physically holds (from ord)
  depositorBookRunes: bigint    // the depositor's CURRENT L2 balance — the cap on what they keep
  depositorScriptHex: string    // the depositor's L1 output scriptPubKey (hex)
  consolidationScriptHex: string// where the remainder goes — the network's backing custody (hex)
  depositorSats: bigint         // sats on the depositor output (≥ dust)
  consolidationSats: bigint      // sats on the consolidation output (≥ dust)
  dust: bigint
}

/**
 * The canonical OUTPUT set for a settlement: [depositor, runestone(OP_RETURN, 0-sat), consolidation].
 * Feed these straight into buildVaultSpend(params, [vaultUtxo], outputs, 'cooperative').
 */
export function settlementOutputs(plan: SettlementPlan): { outputs: SpendOutput[]; depositorOutput: number; consolidationOutput: number; runestoneHex: string } {
  if (plan.depositorBookRunes > plan.totalVaultRunes) throw new Error('vault-settlement: the book balance exceeds the vault — the book would be crediting more than the vault holds')
  if (plan.depositorSats < plan.dust || plan.consolidationSats < plan.dust) throw new Error('vault-settlement: every rune-bearing output must clear the dust or it would not relay')
  const depositorOutput = 0, consolidationOutput = 2
  const runestoneHex = settlementRunestoneHex(plan.runeId, plan.depositorBookRunes, depositorOutput, consolidationOutput)
  const outputs: SpendOutput[] = [
    { script: plan.depositorScriptHex, amountSats: plan.depositorSats },       // out 0 — the depositor keeps their book balance
    { script: runestoneHex, amountSats: 0n },                                  // out 1 — the runestone (edict + pointer)
    { script: plan.consolidationScriptHex, amountSats: plan.consolidationSats }, // out 2 — the remainder, backing everyone else
  ]
  return { outputs, depositorOutput, consolidationOutput, runestoneHex }
}

export interface PotSettlementPlan {
  runeId: RuneId
  potTotalRunes: bigint          // what the POT outpoint physically holds (from ord)
  holders: Array<{ scriptHex: string; bookRunes: bigint; sats: bigint }>  // each pot-backed holder → their L1 output + book balance
  remainderScriptHex: string     // where any UNBACKED remainder lands (the pot's own key; 0 when solvent)
  remainderSats: bigint
  dust: bigint
}

/**
 * THE POT'S OWN PRE-SIGNED SPLIT — the same reflex as settlementOutputs, but for the SHARED pot: it pays
 * EACH current pot-backed holder EXACTLY their book balance to their own output. Armed (owner + guardians
 * co-sign, no timelock) and published, it makes the owner's unilateral CSV sweep CONSENSUS-INVALID while the
 * pot outpoint is below Δ (BIP-68 non-final — cannot relay), and a fee-auction contest at/after Δ (NOT
 * auto-fail — see the header: fixed-fee split can be replaced or out-mined; the pot→pot refresh keeps
 * outpoints below Δ so the auction never opens). It hands every holder a standing exit that is consensus-valid
 * below Δ (Ark's ceiling: operators may censor, never steal). NOTE the residual owner-key dependency: re-arm
 * needs the owner to co-sign, so this does not defend a compromised owner key (a later FROST-on-owner rung).
 * Pure and total — it only decides the OUTPUTS; the
 * cooperative spend is built + co-signed by the proven vault-spend.ts machinery, and every split is proven
 * safe by auditSettlementSafety (same decipher + allocate the bridge trusts) before it is armed.
 */
export function potSettlementOutputs(plan: PotSettlementPlan): { outputs: SpendOutput[]; dests: Array<{ output: number; amount: bigint }>; consolidationOutput: number; runestoneHex: string } {
  if (!plan.holders.length) throw new Error('vault-settlement: a pot settlement needs at least one holder')
  let sumBook = 0n
  for (const h of plan.holders) {
    if (h.bookRunes <= 0n) throw new Error('vault-settlement: a pot-backed holder must have a positive book balance')
    if (h.sats < plan.dust) throw new Error('vault-settlement: every holder output must clear the dust or it would not relay')
    sumBook += h.bookRunes
  }
  if (sumBook > plan.potTotalRunes) throw new Error('vault-settlement: the holders’ books exceed the pot — the pot would credit more than it holds')
  if (plan.remainderSats < plan.dust) throw new Error('vault-settlement: the remainder output must clear the dust')
  // outputs: [holder0 … holderN-1, runestone, remainder]. The pointer routes any unbacked remainder to the
  // remainder output; when the pot is solvent (Σ book == pot) that output receives 0.
  const consolidationOutput = plan.holders.length + 1
  const dests = plan.holders.map((h, i) => ({ output: i, amount: h.bookRunes }))
  const runestoneHex = batchSettlementRunestoneHex(plan.runeId, dests, consolidationOutput)
  const outputs: SpendOutput[] = [
    ...plan.holders.map((h) => ({ script: h.scriptHex, amountSats: h.sats })),  // out i — holder i keeps their book balance
    { script: runestoneHex, amountSats: 0n },                                   // out N — the runestone (edicts + pointer)
    { script: plan.remainderScriptHex, amountSats: plan.remainderSats },        // out N+1 — the unbacked remainder (0 when solvent)
  ]
  return { outputs, dests, consolidationOutput, runestoneHex }
}

export interface SettlementVerdict {
  ok: boolean
  depositorGot: bigint
  consolidationGot: bigint
  burned: bigint
  reason?: string
}

/**
 * PROVE A SETTLEMENT SAFE, from its output scripts alone — the check a guardian runs before co-signing
 * and the L2 runs before storing. Runs the SAME decipher + allocate the bridge trusts, so a cenotaph
 * or any burn fails here first. The safety property: the depositor output receives NO MORE than
 * `maxDepositorRunes` (their book balance), the rest lands on consolidation, and nothing is burned.
 */
export function auditSettlementSafety(args: {
  runeId: RuneId
  outputScriptsHex: string[]     // every output script of the settlement tx, in order (hex)
  inputRunes: bigint             // the runes the vault outpoint carries (what the spend consumes)
  depositorOutput: number
  consolidationOutput: number
  maxDepositorRunes: bigint      // the depositor's book balance — the cap
  /** Additive loaf: each dest must receive EXACTLY this amount. Absent = single-dest path. */
  dests?: Array<{ output: number; amount: bigint }>
}): SettlementVerdict {
  try {
    const scripts = args.outputScriptsHex.map((h) => Uint8Array.from(Buffer.from(h, 'hex')))
    const artifact = decipher(scripts)
    if (artifact && artifact.kind === 'cenotaph') {
      return { ok: false, depositorGot: 0n, consolidationGot: 0n, burned: args.inputRunes, reason: `the settlement runestone is a CENOTAPH (${artifact.flaws.join(', ')}) — it would BURN the runes` }
    }
    const alloc = allocate(artifact, { outputScripts: scripts, inputs: [{ id: args.runeId, amount: args.inputRunes }] })
    const at = (out: number): bigint => (alloc.outputs.get(out) ?? []).filter((b) => b.id.block === args.runeId.block && b.id.tx === args.runeId.tx).reduce((t, b) => t + b.amount, 0n)
    const depositorGot = at(args.depositorOutput)
    const consolidationGot = at(args.consolidationOutput)
    const burned = alloc.burned.filter((b) => b.id.block === args.runeId.block && b.id.tx === args.runeId.tx).reduce((t, b) => t + b.amount, 0n)
    if (burned > 0n) return { ok: false, depositorGot, consolidationGot, burned, reason: `the settlement BURNS ${burned} of the rune — refused` }
    if (args.dests && args.dests.length) {
      let paid = 0n
      for (const d of args.dests) {
        const got = at(d.output)
        if (got !== d.amount) {
          return { ok: false, depositorGot: got, consolidationGot, burned, reason: `output ${d.output} would receive ${got}, not the ${d.amount} its signed exit locked — refused` }
        }
        paid += got
      }
      if (paid + consolidationGot !== args.inputRunes) {
        return { ok: false, depositorGot: paid, consolidationGot, burned, reason: `the loaf conserves ${paid + consolidationGot} of ${args.inputRunes} — runes cannot vanish` }
      }
      return { ok: true, depositorGot: paid, consolidationGot, burned }
    }
    // THE SAFETY PROPERTY: the depositor can never keep more than their book balance
    if (depositorGot > args.maxDepositorRunes) {
      return { ok: false, depositorGot, consolidationGot, burned, reason: `the settlement pays the depositor ${depositorGot}, above their ${args.maxDepositorRunes} book balance — this is the residue attack, refused` }
    }
    // CONSERVATION: every rune the vault held must land somewhere (depositor + consolidation), none lost
    if (depositorGot + consolidationGot !== args.inputRunes) {
      return { ok: false, depositorGot, consolidationGot, burned, reason: `the settlement conserves ${depositorGot + consolidationGot} of ${args.inputRunes} — runes cannot vanish` }
    }
    return { ok: true, depositorGot, consolidationGot, burned }
  } catch (e) {
    return { ok: false, depositorGot: 0n, consolidationGot: 0n, burned: 0n, reason: e instanceof Error ? e.message : String(e) }
  }
}
