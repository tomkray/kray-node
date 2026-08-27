/**
 * THE VAULT WATCHER — the eye that never blinks. Read-only, by law.
 *
 * The bridge's honest residue (vault.ts): Bitcoin script is carved at deposit time and cannot
 * read the L2 book, so after the timelock a depositor could sweep their vault's PHYSICAL total
 * even if their book balance has since dropped. The timelock window only protects if someone is
 * WATCHING. This module is the watching, made law:
 *
 *   · every PROVEN deposit registers its vault outpoint — the exact satoshis backing the book;
 *   · every PROVEN settle RELEASES the outpoints its payout actually spent (read from the
 *     payout's own inputs — never from a claim);
 *   · a registered outpoint that the chain shows SPENT without a settle releasing it is an
 *     ALARM: the backing moved outside the book. Visible, named, undeniable.
 *
 * The watcher has eyes and no hands: it holds no keys, signs nothing, mutates no ledger state.
 * It cannot be turned against the network because there is nothing to turn — the worst a
 * compromised watcher can do is stay silent, which is exactly the world before it existed.
 * (Its successor, the pre-signed settlement, will give the network a REFLEX; this is the eye
 * that will trigger it.)
 *
 * Pure and total: verdicts are functions of (registry, chain answers). All I/O — RPC calls,
 * persistence, scheduling — belongs to the caller (the node). Same inputs → same verdicts,
 * on any machine, forever.
 */

/** One outpoint the book counts as backing — a per-depositor vault, or the shared consolidation pool. */
export interface WatchedOutpoint {
  outpoint: string       // "txid:vout" — the vault UTXO the deposit created
  runeId: string         // "block:tx" — which rune book it backs
  vault: string          // the vault address (derived, never assigned)
  amount: string         // the rune amount credited from it (decimal string — JSON-safe)
  depositor: string      // the x-only key the vault binds the credit to ('' for a consolidation pool — federation custody has no single owner)
  at: number             // unix ms when registered (observability only, never consensus)
  /** 'vault' (default) = a per-depositor deposit; 'consolidation' = the shared pool a settlement fed */
  kind?: 'vault' | 'consolidation'
  /** set when a PROVEN settle's payout spent this outpoint — the lawful release */
  releasedBy?: string    // the settle's L1 txid
}

/** What the chain says about one outpoint right now. */
export interface ChainAnswer {
  outpoint: string
  /** true = the UTXO still exists (gettxout found it); false = it was spent */
  unspent: boolean
}

export type VaultVerdict =
  | { outpoint: string; state: 'backed' }                          // on-chain, still backing the book
  | { outpoint: string; state: 'released'; by: string }            // spent by a proven settle — lawful
  | { outpoint: string; state: 'ALARM'; runeId: string; vault: string; amount: string; depositor: string; reason: string }

const OUTPOINT_RE = /^[0-9a-f]{64}:\d+$/

/** Validate a registration before it enters the registry — junk in the registry becomes
 *  junk verdicts, and a watcher whose alarms can be garbage is a watcher nobody believes. */
export function validateWatch(w: WatchedOutpoint): { ok: boolean; reason?: string } {
  if (!OUTPOINT_RE.test(w.outpoint)) return { ok: false, reason: 'an outpoint is txid:vout (64-hex : index)' }
  if (!/^\d+:\d+$/.test(w.runeId)) return { ok: false, reason: 'a runeId is block:tx' }
  if (!w.vault) return { ok: false, reason: 'a watch needs the vault address' }
  if (!/^\d+$/.test(w.amount) || BigInt(w.amount) <= 0n) return { ok: false, reason: 'a watch needs a positive decimal amount' }
  // a per-depositor vault binds to a depositor key (the derivation is its authentication); the shared
  // consolidation pool is federation custody with no single owner, so it carries no depositor key.
  if (w.kind === 'consolidation') { if (w.depositor) return { ok: false, reason: 'a consolidation watch has no single depositor — leave it empty' } }
  else if (!/^[0-9a-f]{64}$/.test(w.depositor)) return { ok: false, reason: 'a watch needs the depositor x-only key' }
  return { ok: true }
}

/**
 * JUDGE one watched outpoint against the chain. The whole law in one function:
 *
 *   unspent                    → backed    (the satoshis are where the book says)
 *   spent + released by settle → released  (a proven payout moved them — the book burned in step)
 *   spent + NOT released       → ALARM     (the backing moved OUTSIDE the book — a drain)
 *
 * Fail-closed by construction: an outpoint the chain cannot vouch for is never called backed.
 */
export function judgeOutpoint(w: WatchedOutpoint, chain: ChainAnswer): VaultVerdict {
  if (chain.outpoint !== w.outpoint) {
    // a mismatched answer judges nothing — treating it as anything else would let a caller
    // bug silently mark a drained vault "backed"
    return { outpoint: w.outpoint, state: 'ALARM', runeId: w.runeId, vault: w.vault, amount: w.amount, depositor: w.depositor, reason: 'the chain answer names a different outpoint — the sweep is broken, treat as unverified' }
  }
  if (w.releasedBy) return { outpoint: w.outpoint, state: 'released', by: w.releasedBy }
  if (chain.unspent) return { outpoint: w.outpoint, state: 'backed' }
  return {
    outpoint: w.outpoint, state: 'ALARM', runeId: w.runeId, vault: w.vault, amount: w.amount, depositor: w.depositor,
    reason: 'the vault outpoint was SPENT on L1 but no proven settle released it — the backing moved outside the book',
  }
}

/**
 * MARK RELEASES from a proven payout's own inputs. Called at settle time with the outpoints
 * the payout transaction ACTUALLY spent (parsed from its raw bytes) — never with a claim.
 * Returns the updated registry entries (pure — the caller persists).
 */
export function markReleased(registry: WatchedOutpoint[], spentOutpoints: string[], settleTxid: string): WatchedOutpoint[] {
  if (!/^[0-9a-f]{64}$/.test(settleTxid)) throw new Error('vault-watch: a settle txid is 32-byte hex')
  const spent = new Set(spentOutpoints)
  return registry.map((w) => {
    if (!spent.has(w.outpoint)) return w
    // first release wins and is permanent: one payout, one release, forever — re-marking with a
    // different txid would let a later fake "settle" repaint history
    if (w.releasedBy && w.releasedBy !== settleTxid) return w
    return { ...w, releasedBy: settleTxid }
  })
}

/** SWEEP the whole registry against the chain answers. Pure aggregation of judgeOutpoint. */
export function sweep(registry: WatchedOutpoint[], answers: ChainAnswer[]): { verdicts: VaultVerdict[]; backed: number; released: number; alarms: VaultVerdict[] } {
  const byOutpoint = new Map(answers.map((a) => [a.outpoint, a]))
  const verdicts: VaultVerdict[] = []
  for (const w of registry) {
    const a = byOutpoint.get(w.outpoint)
    // no answer at all = the caller did not ask the chain about this outpoint; fail closed
    verdicts.push(a ? judgeOutpoint(w, a) : (w.releasedBy
      ? { outpoint: w.outpoint, state: 'released', by: w.releasedBy }
      : { outpoint: w.outpoint, state: 'ALARM', runeId: w.runeId, vault: w.vault, amount: w.amount, depositor: w.depositor, reason: 'no chain answer for this outpoint this sweep — unverified backing is treated as missing, never as fine' }))
  }
  const alarms = verdicts.filter((v) => v.state === 'ALARM')
  return {
    verdicts,
    backed: verdicts.filter((v) => v.state === 'backed').length,
    released: verdicts.filter((v) => v.state === 'released').length,
    alarms,
  }
}
