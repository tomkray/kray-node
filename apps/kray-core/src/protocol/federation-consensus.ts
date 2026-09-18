/**
 * THE FEDERATION, SEALED IN CONSENSUS — the pot each network's rune credits are backed by.
 *
 * Until this module existed, the reducer re-proved a rune deposit from bytes but took the VAULT
 * from the event itself: `deriveVault({ ...proof.vault })` was whatever params the writer
 * journaled. Only the writer's door (`consolidationVault().scriptHex` in server.mjs) checked that
 * a `pool:true` deposit had landed in the network's real consolidation pot. So a compromised
 * writer could pay real runes into a vault it alone controlled, journal the credit as `pool:true`,
 * and every honest replayer would re-prove the bytes, find them consistent, and mint pot-backed
 * transferable credit — the Liquid class (unbacked credit accepted by every verifier). For a
 * personal-vault deposit the same gap let an attacker-chosen guardian set ride in the proof.
 *
 * Here the federation is a CONSENSUS CONSTANT, per network: the pot address, the guardian set,
 * the threshold and the timelock the writer's door publishes at /api/kraynet/bridge/params — now
 * sealed in the book every replayer runs, not read from the event. At/after `POT_BINDING_SEQ` the
 * reducer refuses a pot deposit whose journaled vault does not derive to THIS pot's script, and a
 * personal-vault deposit whose federation is not THIS federation (the depositor stays the holder's
 * own key — that binding lives in rune-bridge.ts). Below the pin every journaled deposit replays
 * byte-identically (A3): the pin is born ABOVE the live heads (signet 226 → 227, main 81 → 82).
 *
 * Regtest has no sealed federation on purpose — the lab's dev federation is generated from seeds
 * and varies per bench — so the pin stays inactive there (MAX). A bench that forces the pin on a
 * network with no sealed federation refuses every proof-bearing deposit: fail-closed, never
 * silently open.
 *
 * Pure: no I/O, no env, no keys. Same inputs → same verdict on every machine, forever.
 */
import { deriveVault, toXOnly } from './vault.ts'
import { scriptOfAddress, toBtcNet } from './scheme.ts'

export interface SealedFederation {
  /** the consolidation pot — the ONE vault every `pool:true` deposit must land in */
  pot: string
  /** the guardians' x-only keys (the door's published order; compared as a set) */
  guardians: string[]
  threshold: number
  timelock: number
}

/** The live federations, byte-for-byte what each writer publishes (read 2026-09-18). */
export const FEDERATION_CONSENSUS: Record<string, SealedFederation> = {
  main: {
    pot: 'bc1prp9frm9e6wzfftx57k5xnmuxxrk8czj9eq2n83g79sexn00xm4aqchd3m5',
    guardians: [
      '6d7991cf5b47ba7ffc37a964ea9d59708d7df032df0d6008feb3b2a5652059c2',
      '525a84db038adffdec4b141483ca1dfe2233bec195b98d44eabd4cac7c48bd2e',
      'd9acfcc48c2d9ad774522676d227c3af81bc0e62fdae56644f497c9f5d697f0a',
    ],
    threshold: 2,
    timelock: 4320,
  },
  signet: {
    pot: 'tb1ppzcd09g7tznwy2dnxp0d8cza4t559sptsk9p6xy9xjdcvajyp9mq4jy4je',
    guardians: [
      '8d5fb41b393c6480e788afa472759fc427a3ac81538b5b72fe70cf7cde514510',
      'eddf1ba62a8d40f679b629dd365fb291c5691cabf2151d828e057aeb082f52ce',
      '9d392aba72f0eb7d3b29e0df02b02a700a913b4a6a828bd593484569923f783c',
    ],
    threshold: 2,
    timelock: 144,
  },
}

/** THE POT BINDING (2026-09-18) — at/after this seq the reducer binds every proof-bearing rune
 *  deposit's journaled vault to the sealed federation above. Pinned ABOVE the live heads at the
 *  rite (signet tip 226, main tip 81) so no existing event changes meaning or root (A3). Regtest
 *  stays MAX: the lab's federation is not sealed; a test injects 0 to exercise both sides. */
export const POT_BINDING_SEQ: Record<string, number> = {
  regtest: Number.MAX_SAFE_INTEGER,
  signet: 227,
  main: 82,
}

/** The sealed federation of a network, or null where none is sealed (regtest, unknown nets). */
export function sealedFederationOf(network: string): SealedFederation | null {
  return FEDERATION_CONSENSUS[network] ?? null
}

export type FederationBindingVerdict = { ok: true } | { ok: false; reason: string }

/** The journaled vault params of a rune-deposit proof (the shape rune-bridge.ts re-derives from). */
export interface JournaledVault { guardians: string[]; threshold: number; depositor: string; timelock: number }

const sameKeySet = (a: string[], b: string[]): boolean => {
  const na = [...new Set(a.map(toXOnly))].sort()
  const nb = [...new Set(b.map(toXOnly))].sort()
  // the journaled list must be a SET of exactly the sealed guardians — a duplicate is not a member
  if (na.length !== a.length || na.length !== nb.length) return false
  return na.every((k, i) => k === nb[i])
}

/**
 * THE BINDING — does this journaled vault belong to THIS network's sealed federation?
 *
 *   pool:true  → the vault re-derived from the journaled params must BE the consolidation pot
 *                (script equality on this network — an address that derives elsewhere is refused)
 *   pool:false → the journaled guardians must be exactly the sealed set (as x-only keys, order-
 *                insensitive), with the sealed threshold and timelock; the depositor is not judged
 *                here (rune-bridge.ts binds the credit to the vault's own depositor key)
 *
 * Fail-closed: a network with no sealed federation, a missing vault, or params that cannot be
 * derived all refuse. Never throws — the reducer owns the throw and the `ledger:` sentence.
 */
export function federationBindingVerdict(
  vault: JournaledVault | undefined,
  opts: { network: string; pool: boolean },
): FederationBindingVerdict {
  const fed = sealedFederationOf(opts.network)
  if (!fed) return { ok: false, reason: 'this network has no sealed federation — a bound rune deposit cannot be verified (refused)' }
  if (!vault) return { ok: false, reason: 'a rune-deposit consensus proof must carry the vault params the credit binds to' }
  try {
    if (opts.pool) {
      const net = toBtcNet(opts.network)
      const derived = deriveVault({ guardians: vault.guardians, threshold: vault.threshold, depositor: vault.depositor, timelock: vault.timelock, net })
      if (scriptOfAddress(derived.address, net) !== scriptOfAddress(fed.pot, net)) {
        return { ok: false, reason: 'a pot deposit must land in this network\'s consolidation pot — the journaled vault is not the pot (refused)' }
      }
      return { ok: true }
    }
    if (!Array.isArray(vault.guardians) || !sameKeySet(vault.guardians, fed.guardians)
      || vault.threshold !== fed.threshold || vault.timelock !== fed.timelock) {
      return { ok: false, reason: 'a personal vault must use this network\'s federation (guardians, threshold, timelock) — refused' }
    }
    return { ok: true }
  } catch (_) {
    // malformed keys / underivable params: not the pot, not the federation — refused either way
    return opts.pool
      ? { ok: false, reason: 'a pot deposit must land in this network\'s consolidation pot — the journaled vault is not the pot (refused)' }
      : { ok: false, reason: 'a personal vault must use this network\'s federation (guardians, threshold, timelock) — refused' }
  }
}
