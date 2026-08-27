/**
 * BUILD THE POT'S PRE-SIGNED SPLIT — compose the pot settlement outputs into a real COOPERATIVE vault spend.
 *
 * Pure and total: given the pot's book snapshot (each holder + their L2/taproot address + their book balance),
 * the pot's vault params, and the pot outpoint, it resolves each holder's L1 script (option A — the holder's
 * own taproot address, self-custody) and assembles the UNSIGNED cooperative spend + its sighashes — the exact
 * tx the owner + a threshold of guardians co-sign.
 *
 * What it does to the owner sweep — the HONEST claim (council + adversary verified 2026-08-23, the earlier
 * "AUTO-FAILS" wording was an overclaim). The cooperative leaf has NO timelock; the owner's unilateral sweep
 * leaf carries a CSV delay Δ. So:
 *   • BELOW Δ (outpoint younger than the delay): the sweep is BIP-68 non-final — bitcoind REJECTS it and no
 *     miner may include it (CONSENSUS, not policy). The armed split relays + confirms UNOPPOSED. A true win.
 *   • AT/AFTER Δ: both txs signal RBF, so same-input conflict resolves by fee REPLACEMENT, not first-seen. The
 *     split's fee is FIXED (pre-signed); a higher-fee sweep can replace it, or the thief can submit direct to
 *     a miner the reactive watcher never sees. So post-Δ it is a fee AUCTION the split can LOSE — NOT auto-fail.
 * The discipline that makes the guarantee consensus-grade: keep every pot outpoint BELOW Δ (a periodic pot→pot
 * cooperative REFRESH resets the CSV clock so the auction never opens; a DEADMAN broadcast fires the split
 * while the sweep still cannot relay). WHAT THIS DOES NOT DEFEND: a compromised OWNER key — every re-arm and
 * refresh needs the owner to co-sign, so a dishonest owner simply stops (that threat needs FROST-on-owner, a
 * later rung). It DOES defend a compromised WRITER (owner honest) and guardian liveness: each holder then
 * holds a standing, consensus-valid-below-Δ exit — Ark's ceiling, censor-never-steal. NEVER "trustless". The
 * rune allocation is
 * provable-safe by auditSettlementSafety (the same decipher + allocate the bridge trusts): each holder
 * receives EXACTLY their book, conservation holds, nothing burns. No node, no keys, no I/O — this only
 * ASSEMBLES the tx; the owner + guardian co-signatures are added by the proven signing machinery, and the
 * node audits the result before arming it.
 */
import { potSettlementOutputs } from './vault-settlement.ts'
import { buildVaultSpend, type VaultUtxo } from './vault-spend.ts'
import { scriptOfAddress } from './scheme.ts'
import type { VaultParams } from './vault.ts'
import type { RuneId } from './runestone.ts'

export interface PotBookHolder {
  address: string    // the holder's L2/taproot address — where their book balance is paid (they control the key)
  bookRunes: bigint  // their current L2 book balance of this rune
}

export interface PotSettlementSpend {
  unsignedTxHex: string
  sighashes: string[]
  path: 'cooperative' | 'unilateral'
  dests: Array<{ output: number; amount: bigint }>
  consolidationOutput: number
  runestoneHex: string
  outputScriptsHex: string[]
}

export function buildPotSettlement(args: {
  runeId: RuneId
  potParams: VaultParams   // the consolidation vault's params (guardians, threshold, depositor = the pot owner key, timelock)
  potUtxos: VaultUtxo[]    // the pot outpoint(s) holding this rune's backing — the pot COMMINGLES, so coin-select all needed (from ord, never a client number)
  potTotalRunes: bigint    // what ord says the pot outpoint holds
  holders: PotBookHolder[] // every pot-backed holder + their book balance (the loaf; keep under the 83-byte runestone cap)
  remainderAddress: string // where any UNBACKED remainder lands — the pot's OWN address (0 when solvent)
  dust?: bigint
  holderSats?: bigint
}): PotSettlementSpend {
  const net = args.potParams.net
  const dust = args.dust ?? 330n
  const holderSats = args.holderSats ?? 330n
  const holders = args.holders.map((h) => ({
    scriptHex: scriptOfAddress(h.address, net),
    bookRunes: h.bookRunes,
    sats: holderSats,
  }))
  const { outputs, dests, consolidationOutput, runestoneHex } = potSettlementOutputs({
    runeId: args.runeId,
    potTotalRunes: args.potTotalRunes,
    holders,
    remainderScriptHex: scriptOfAddress(args.remainderAddress, net),
    remainderSats: dust,
    dust,
  })
  if (!args.potUtxos.length) throw new Error('pot-settlement: a pot settlement needs at least one pot outpoint')
  // the COOPERATIVE leaf — owner-first + guardians, no timelock, RBF-able → always beats the unilateral sweep.
  // The pot commingles, so buildVaultSpend consumes every selected pot outpoint (one sighash per input).
  const spend = buildVaultSpend(args.potParams, args.potUtxos, outputs, 'cooperative')
  return {
    unsignedTxHex: spend.unsignedTxHex,
    sighashes: spend.sighashes,
    path: spend.path,
    dests,
    consolidationOutput,
    runestoneHex,
    outputScriptsHex: outputs.map((o) => o.script!),
  }
}
