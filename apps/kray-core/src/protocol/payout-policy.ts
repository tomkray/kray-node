/**
 * PAYOUT POLICY — the signer-side Withdrawal Validation Engine (Liquid-class hardening).
 *
 * The lesson of the September 2026 Liquid incident: a federation loses funds when the component that
 * tells honest keys WHAT to sign can lie. In KRAY that component is the public writer, which assembles
 * the ExitPayoutPlan the pot-signer and every remote guardian rebuild. Before this module the signers
 * bound only the exiter's destination and amount (both inside the holder's signature) and left every
 * OTHER output of the payout to the writer's word: the rune "change" landing pad, the sats change, the
 * service fee, the miner fee, and the pot-outpoint set. A compromised writer could route the pot's whole
 * remainder to itself while every key stayed honest (federation-drain-sim.test.ts, S1–S4).
 *
 * This engine closes that: EVERY output of the payout must be explainable by (a) a holder's signature,
 * (b) the pot itself, or (c) the exiter's own funding script — and every number is ceilinged. It is pure,
 * deterministic, and runs INSIDE each signer, so it cannot be bypassed by a bad door. UNKNOWN = REFUSE.
 *
 * Invariants enforced (see docs/AUDIT-LIQUID-CLASS.md):
 *   P1 · RUNE CHANGE RETURNS HOME — plan.changeScriptHex ∈ { this vault's own script } ∪ allowedChangeScripts.
 *   P2 · SATS CHANGE RETURNS TO THE FUNDER — plan.satsChangeScriptHex == funding.scriptHex.
 *   P3 · FUNDING IS THE EXITER'S (strict mode) — funding.scriptHex == scriptOfAddress(exit.from).
 *   P8 · POT SATS STAY HOME — Σ vault sats − change postage ≤ maxPotSatsOut.
 *   P4 · FEE CEILING — plan.feeSats ≤ maxFeeSats, and the pot never pays more than its postage allowance.
 *   P5 · SERVICE FEE BOUNDED — sats ≤ maxServiceFeeSats; script ∈ serviceFeeScripts when configured.
 *   P6 · INPUT COUNT BOUNDED — vaultUtxos.length ≤ maxVaultInputs (a drain needs the whole pot in one tx).
 *   P7 · REMAINDER CEILING (optional) — totalVaultRunes − paid ≤ maxChangeRunes when configured.
 */
import { deriveVault, type VaultParams } from './vault.ts'
import { scriptOfAddress, toBtcNet } from './scheme.ts'
import type { ExitPayoutPlan, FundingUtxo } from './exit-payout.ts'

export interface PayoutPolicy {
  /** extra rune-change landing pads (hex scriptPubKeys) besides the vault's own — e.g. the consolidation pot */
  allowedChangeScripts?: string[]
  /** miner fee ceiling in sats (default 200_000 — 500 sat/vB × a 400-vB payout) */
  maxFeeSats?: bigint
  /** service fee ceiling in sats (default 1_000); 0 forbids a service output */
  maxServiceFeeSats?: bigint
  /** when non-empty, the service fee script must be one of these (hex scriptPubKeys) */
  serviceFeeScripts?: string[]
  /** how many vault outpoints one payout may consume (default 8) */
  maxVaultInputs?: number
  /** optional ceiling on the rune remainder a payout may move (undefined = unbounded, it returns to the pot) */
  maxChangeRunes?: bigint
  /** strict: the funding utxo must be the exiter's OWN script (the door already enforces it; on = the signer does too) */
  requireExiterFunding?: boolean
  /** how many of the pot's own sats one payout may release beyond the change postage (default 100_000) */
  maxPotSatsOut?: bigint
}

export const DEFAULT_PAYOUT_POLICY: Required<Pick<PayoutPolicy, 'maxFeeSats' | 'maxServiceFeeSats' | 'maxVaultInputs' | 'maxPotSatsOut'>> = {
  maxFeeSats: 200_000n,
  maxServiceFeeSats: 1_000n,
  maxVaultInputs: 8,
  maxPotSatsOut: 100_000n,
}

const lower = (s: unknown): string => String(s || '').toLowerCase()

/**
 * Judge a payout plan against the policy. Returns ok:false with the FIRST violated invariant named.
 * `initiatorFrom` is the L2 address of the exit that funds the payout (exit.from); its script is the
 * only place the exiter's sats may return to.
 */
export function auditPayoutPolicy(args: {
  network: string
  params: VaultParams
  vaultUtxos: { txid: string; vout: number; amountSats?: bigint }[]
  funding: FundingUtxo
  plan: ExitPayoutPlan
  initiatorFrom: string
  policy?: PayoutPolicy
}): { ok: true } | { ok: false; reason: string } {
  const pol = args.policy || {}
  const net = toBtcNet(args.network)
  const maxFee = pol.maxFeeSats ?? DEFAULT_PAYOUT_POLICY.maxFeeSats
  const maxSvc = pol.maxServiceFeeSats ?? DEFAULT_PAYOUT_POLICY.maxServiceFeeSats
  const maxInputs = pol.maxVaultInputs ?? DEFAULT_PAYOUT_POLICY.maxVaultInputs

  // P1 · the rune remainder returns HOME — never to a script the writer chose
  let ownScript: string
  try { ownScript = lower(scriptOfAddress(deriveVault(args.params).address, net)) }
  catch (e) { return { ok: false, reason: 'payout-policy: cannot derive this vault\'s own script — ' + (e instanceof Error ? e.message : String(e)) } }
  const allowedChange = new Set([ownScript, ...(pol.allowedChangeScripts || []).map(lower)])
  const change = lower(args.plan.changeScriptHex || ownScript)
  if (!allowedChange.has(change)) {
    return { ok: false, reason: `payout-policy: the rune change pad ${change.slice(0, 16)}… is neither this vault nor an allowed pot — the remainder must return home (P1)` }
  }

  // P2 · sats change returns to the script that FUNDED the payout — never to a script the writer chose
  if (lower(args.plan.satsChangeScriptHex) !== lower(args.funding.scriptHex)) {
    return { ok: false, reason: 'payout-policy: the sats change script is not the funding script — the sats go back where they came from (P2)' }
  }
  // P3 (strict mode) · the funding input is the EXITER's own key-path output
  if (pol.requireExiterFunding) {
    let exiterScript: string
    try { exiterScript = lower(scriptOfAddress(args.initiatorFrom, net)) }
    catch { return { ok: false, reason: 'payout-policy: the initiator address does not decode on this network (P3)' } }
    if (lower(args.funding.scriptHex) !== exiterScript) {
      return { ok: false, reason: 'payout-policy: the funding utxo is not the exiter\'s own script — the exiter pays their own postage and fee (P3)' }
    }
  }

  // P8 · the pot's own sats may not leave beyond a postage allowance (a sats drain wearing a payout)
  const maxPotOut = pol.maxPotSatsOut ?? DEFAULT_PAYOUT_POLICY.maxPotSatsOut
  const vaultSats = args.vaultUtxos.reduce((t, u) => t + (u.amountSats ?? 0n), 0n)
  const potSatsOut = vaultSats - args.plan.changePostage
  if (potSatsOut > maxPotOut) {
    return { ok: false, reason: `payout-policy: ${potSatsOut} sats would leave the pot (ceiling ${maxPotOut}) — the pot pays runes, not satoshis (P8)` }
  }

  // P4 · fee ceiling
  if (args.plan.feeSats > maxFee) {
    return { ok: false, reason: `payout-policy: the miner fee ${args.plan.feeSats} exceeds the ceiling ${maxFee} sats (P4)` }
  }

  // P5 · service fee bounded and, when configured, pinned to a known script
  if (args.plan.serviceFee) {
    if (maxSvc <= 0n) return { ok: false, reason: 'payout-policy: a service fee output is forbidden by this signer (P5)' }
    if (args.plan.serviceFee.sats > maxSvc) {
      return { ok: false, reason: `payout-policy: the service fee ${args.plan.serviceFee.sats} exceeds the ceiling ${maxSvc} sats (P5)` }
    }
    const svcAllowed = (pol.serviceFeeScripts || []).map(lower)
    if (svcAllowed.length && !svcAllowed.includes(lower(args.plan.serviceFee.scriptHex))) {
      return { ok: false, reason: 'payout-policy: the service fee script is not one this signer recognises (P5)' }
    }
  }

  // P6 · a drain needs the whole pot in one transaction — cap the inputs
  if (args.vaultUtxos.length > maxInputs) {
    return { ok: false, reason: `payout-policy: ${args.vaultUtxos.length} vault inputs exceed the ceiling ${maxInputs} — one payout may not consume the pot (P6)` }
  }

  // P7 · optional remainder ceiling
  if (pol.maxChangeRunes != null) {
    const dests = args.plan.dests && args.plan.dests.length ? args.plan.dests : [{ exitAmount: args.plan.exitAmount }]
    const paid = dests.reduce((t, d) => t + d.exitAmount, 0n)
    const remainder = args.plan.totalVaultRunes - paid
    if (remainder > pol.maxChangeRunes) {
      return { ok: false, reason: `payout-policy: the rune remainder ${remainder} exceeds the ceiling ${pol.maxChangeRunes} (P7)` }
    }
  }
  return { ok: true }
}

/** Parse a policy from a daemon's environment (names only; values are numbers/scripts, never secrets). */
export function policyFromEnv(env: Record<string, string | undefined>): PayoutPolicy {
  const list = (v: string | undefined) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[0-9a-f]+$/.test(s))
  const big = (v: string | undefined) => (v != null && /^\d+$/.test(String(v).trim()) ? BigInt(String(v).trim()) : undefined)
  const int = (v: string | undefined) => (v != null && /^\d+$/.test(String(v).trim()) ? parseInt(String(v).trim(), 10) : undefined)
  const out: PayoutPolicy = {}
  const ac = list(env.KRAY_PAYOUT_ALLOWED_CHANGE_SCRIPTS); if (ac.length) out.allowedChangeScripts = ac
  const sf = list(env.KRAY_PAYOUT_SERVICE_FEE_SCRIPTS); if (sf.length) out.serviceFeeScripts = sf
  const mf = big(env.KRAY_PAYOUT_MAX_FEE_SATS); if (mf != null) out.maxFeeSats = mf
  const ms = big(env.KRAY_PAYOUT_MAX_SERVICE_FEE_SATS); if (ms != null) out.maxServiceFeeSats = ms
  const mc = big(env.KRAY_PAYOUT_MAX_CHANGE_RUNES); if (mc != null) out.maxChangeRunes = mc
  const mi = int(env.KRAY_PAYOUT_MAX_VAULT_INPUTS); if (mi != null) out.maxVaultInputs = mi
  const mp = big(env.KRAY_PAYOUT_MAX_POT_SATS_OUT); if (mp != null) out.maxPotSatsOut = mp
  if (String(env.KRAY_PAYOUT_REQUIRE_EXITER_FUNDING || '').trim() === '1') out.requireExiterFunding = true
  return out
}
