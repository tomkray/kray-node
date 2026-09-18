/**
 * POT SIGNER — the consolidation owner key lives HERE, never in the public node.
 *
 * The node builds a payout and asks this module to sign the vault leaf. We
 * rebuild the payout from the same inputs, refuse unless the dest and amount
 * are the ones inside the SIGNED rune-exit, and only then touch the secret.
 * A compromised explorer that still talks to this process cannot redirect
 * the metal: a stranger's dest fails the exit signature, a swapped sighash
 * fails the rebuild.
 *
 * Pure: the HTTP daemon (scripts/pot-signer.mjs) is just I/O around this.
 *
 * THE WIRE IS THE PLAN. Every field buildExitPayout reads MUST cross planToWire →
 * planFromWire unchanged, or a remote pen/guardian rebuilds a different transaction
 * and holds every withdraw (fail-closed, nothing lost — but nothing paid either).
 * The stated service output (withdraw door, 2026-09-01) was the field that did not
 * cross; found by the Tier-1 ceremony on 2026-09-17 and pinned in pot-signer.test.ts.
 */
import { buildExitPayout, signVaultSighash, type ExitPayoutPlan, type FundingUtxo } from './exit-payout.ts'
import { verifySignature, runeExitMessage, scriptOfAddress, toBtcNet, _generateKeyPair } from './scheme.ts'
import { toXOnly, type VaultParams } from './vault.ts'
import type { VaultUtxo } from './vault-spend.ts'
import { auditPayoutPolicy, type PayoutPolicy } from './payout-policy.ts'

/**
 * THE SIGNER LAW v2 (2026-09-18 gauntlet). Everything a signer must ask beyond "dest and amount are the
 * holder's": the plan pays the SAME rune the holder signed (P0); every other output is the pot's own or
 * the funder's own and every number has a ceiling (P1–P8, payout-policy.ts); the exit is OPEN in the
 * signer's book exactly as signed (the lock); one lock is delivered ONCE (the memory); a loaf never
 * carries the same exit twice; the wire's network is the signer's own. Absent options keep the pure
 * function byte-identical for older callers; the daemons pass every option.
 */
export interface SignedExitMemory {
  get(key: string): string | null
  set(key: string, spend: string): void
}
export function signedExitKey(network: string, e: SignedRuneExit): string {
  return `${network}|${String(e.from).toLowerCase()}|${e.runeId}|${Number(e.nonce)}`
}
export function spendSetOf(vaultUtxos: { txid: string; vout: number }[]): string {
  return vaultUtxos.map((u) => `${String(u.txid).toLowerCase()}:${Number(u.vout)}`).sort().join(',')
}
/** the OPEN lock the signer's book shows for (from, runeId): undefined = the book does not expose locks
 *  (a pre-v2 follower), null = no open lock, else the lock as replayed */
export type BookLockOf = (from: string, runeId: string) => { amount: bigint; l1Address: string } | null | undefined
export interface SignerOptions {
  policy?: PayoutPolicy
  memory?: SignedExitMemory
  lockOf?: BookLockOf
  /** the signer's OWN network: the wire's `network` and `params.net` must equal it */
  network?: string
}

export interface SignedRuneExit {
  from: string
  runeId: string
  amount: string
  l1Address: string
  nonce: number
  publicKey: string
  signature: string
  scheme: string
}

export interface PotSignRequest {
  network: string
  exit: SignedRuneExit
  /** Additive loaf: one signed exit per dest, in output order. Absent = single-exit path. */
  exits?: SignedRuneExit[]
  params: VaultParams
  vaultUtxos: VaultUtxo[]
  funding: FundingUtxo
  plan: ExitPayoutPlan
  claimedSighashes: string[]
}

function sameHex(a: string, b: string): boolean {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase()
}

/**
 * Signer ceiling on the stated service output. The writer states a flat 546 sats
 * (server.mjs · MINT_SERVICE_FEE_SATS); a "service fee" that swallows the exiter's
 * change or the pot's postage is a drain wearing a label. Mirrors P5 of the
 * withdrawal validation engine (payout-policy): when both run, the lower wins.
 */
export const MAX_SERVICE_FEE_SATS = 1_000n

/**
 * THE INDEPENDENT PREDICATE: every exiter must actually HOLD >= what they withdraw, per THIS signer's own
 * book replay (spendable + locked). A forged over-balance exit drains the pot only if every signer skips
 * this check — so the signer refuses fail-closed (an unknown balance is a refusal). Run by every guardian
 * and, since 2026-09-18, by the pen: a pen that skipped it was a rubber stamp for anyone holding two
 * guardian keys and a local token.
 */
export function requireBookCovers(
  exits: SignedRuneExit[],
  bookBalanceOf: (from: string, runeId: string) => bigint | null,
  who: 'guardian' | 'pen' = 'guardian',
): { ok: true } | { ok: false; reason: string; lagging?: true } {
  const need = new Map<string, bigint>()
  for (const x of exits) {
    const k = String(x.from).toLowerCase() + '|' + String(x.runeId)
    need.set(k, (need.get(k) ?? 0n) + BigInt(x.amount))
  }
  for (const [k, amt] of need) {
    const sep = k.lastIndexOf('|')
    const from = k.slice(0, sep)
    const rid = k.slice(sep + 1)
    const have = bookBalanceOf(from, rid)
    if (have == null) {
      return { ok: false, lagging: true, reason: `the ${who} book cannot confirm the balance of ${from.slice(0, 12)}… for ${rid} — refused (fail-closed; the daemon answers 503 so the writer retries)` }
    }
    if (have < amt) {
      return { ok: false, reason: `exit amount ${amt} exceeds the exiter book balance ${have} for ${rid} — refused (over-balance drain blocked)` }
    }
  }
  return { ok: true }
}

const runeKeyOf = (id: { block: bigint; tx: bigint }): string => `${id.block}:${id.tx}`
const canonicalExitRune = (s: string): string => { const [b, t] = String(s).split(':'); return `${BigInt(b)}:${BigInt(t)}` }

/** The v2 law, identical for the pen and every guardian. Returns the first violated invariant. */
export function signerLawV2(
  req: PotSignRequest,
  allExits: SignedRuneExit[],
  opts: SignerOptions | undefined,
  who: 'guardian' | 'pen',
): { ok: true; spend: string } | { ok: false; reason: string; lagging?: true } {
  const e = allExits[0]
  // NETWORK PIN — the wire names a network; it must be THIS signer's, and the vault params must agree
  if (opts && opts.network) {
    if (String(req.network) !== opts.network) return { ok: false, reason: `the bundle names network ${req.network}; this ${who} signs only for ${opts.network} — refused` }
    if (String(req.params.net) !== opts.network) return { ok: false, reason: `the vault params name network ${req.params.net}; this ${who} signs only for ${opts.network} — refused` }
  }
  // P0 · THE RUNE IS THE SIGNED RUNE — the plan's runeId must be the one inside every signed exit
  const planRune = runeKeyOf(req.plan.runeId)
  for (const x of allExits) {
    let xr: string
    try { xr = canonicalExitRune(x.runeId) } catch { return { ok: false, reason: 'a signed exit names a malformed rune id — refused' } }
    if (xr !== planRune) return { ok: false, reason: `the payout moves rune ${planRune} but the holder signed for ${xr} — refused (the rune-id swap)` }
  }
  // NO EXIT TWICE — a loaf may not carry the same (from, rune, nonce) twice (one lock delivered twice in one tx)
  const seen = new Set<string>()
  for (const x of allExits) {
    const k = signedExitKey(String(req.network), x)
    if (seen.has(k)) return { ok: false, reason: `the same signed exit appears twice in the loaf (${String(x.from).slice(0, 12)}… nonce ${x.nonce}) — refused` }
    seen.add(k)
  }
  // P1–P8 · every output not inside a holder's signature is the pot's own or the funder's own; every number ceilinged
  if (opts && opts.policy) {
    const pol = auditPayoutPolicy({ network: req.network, params: req.params, vaultUtxos: req.vaultUtxos, funding: req.funding, plan: req.plan, initiatorFrom: e.from, policy: opts.policy })
    if (!pol.ok) return pol
  }
  // THE LOCK — the exit must be OPEN in this signer's book exactly as signed (amount + destination). A burned
  // or cancelled lock has no open lock; a tampered one does not match. A book that does not expose locks
  // (pre-v2 follower) answers undefined and the check is skipped — the balance predicate still runs.
  if (opts && opts.lockOf) {
    for (const x of allExits) {
      const lock = opts.lockOf(String(x.from), String(x.runeId))
      if (lock === undefined) continue
      if (lock === null) return { ok: false, reason: `the ${who} book shows NO open exit for ${String(x.from).slice(0, 12)}… on ${x.runeId} — refused (a burned, cancelled or never-journaled lock cannot be paid)` }
      if (lock.amount !== BigInt(x.amount) || String(lock.l1Address) !== String(x.l1Address)) {
        return { ok: false, reason: `the ${who} book's open exit (${lock.amount} → ${String(lock.l1Address).slice(0, 12)}…) is not the signed exit (${x.amount} → ${String(x.l1Address).slice(0, 12)}…) — refused` }
      }
    }
  }
  // ONE LOCK, ONE DELIVERY — a signed exit already signed over a DIFFERENT pot-outpoint set is a double
  // delivery (the book still shows the lock until settle). The identical set is an RBF re-sign: allowed.
  const spend = spendSetOf(req.vaultUtxos)
  if (opts && opts.memory) {
    for (const x of allExits) {
      const prior = opts.memory.get(signedExitKey(String(req.network), x))
      if (prior != null && prior !== spend) {
        return { ok: false, reason: `exit ${String(x.from).slice(0, 12)}… nonce ${x.nonce} was already signed over a different pot-outpoint set — one lock pays exactly once (refused)` }
      }
    }
  }
  return { ok: true, spend }
}

/** After a REAL signature: remember the outpoint set every exit was delivered over. */
export function rememberDelivery(req: PotSignRequest, allExits: SignedRuneExit[], memory: SignedExitMemory | undefined, spend: string): void {
  if (!memory) return
  for (const x of allExits) memory.set(signedExitKey(String(req.network), x), spend)
}

function serviceFeeWithinCeiling(plan: ExitPayoutPlan): { ok: true } | { ok: false; reason: string } {
  if (!plan.serviceFee) return { ok: true }
  if (plan.serviceFee.sats > MAX_SERVICE_FEE_SATS) {
    return { ok: false, reason: `the stated service fee ${plan.serviceFee.sats} sats is above the signer ceiling ${MAX_SERVICE_FEE_SATS} — refused (a fee that drains is a theft)` }
  }
  return { ok: true }
}

/**
 * The service output on the wire: absent → the historic 4-output plan; present →
 * { scriptHex, sats } with sats stringified (JSON cannot carry bigint). Malformed →
 * throw, which the daemons answer as 400 (fail-closed, never a silent drop).
 */
function serviceFeeFromWire(raw: unknown): Pick<ExitPayoutPlan, 'serviceFee'> {
  if (raw == null) return {}
  if (typeof raw !== 'object') throw new Error('wire: serviceFee must be { scriptHex, sats } — refused')
  const w = raw as Record<string, unknown>
  if (typeof w.scriptHex !== 'string' || w.sats == null) throw new Error('wire: serviceFee must be { scriptHex, sats } — refused')
  return { serviceFee: { scriptHex: w.scriptHex, sats: BigInt(String(w.sats)) } }
}

function bindSignedExit(
  e: SignedRuneExit,
  network: string,
): { ok: true; amt: bigint; dest: string } | { ok: false; reason: string } {
  if (!e || !e.from || !e.runeId || !e.l1Address || e.amount == null || e.nonce == null) {
    return { ok: false, reason: 'a pot sign needs the SIGNED rune-exit (from, runeId, amount, l1Address, nonce, signature)' }
  }
  const amt = BigInt(e.amount)
  if (amt <= 0n) return { ok: false, reason: 'the signed exit amount must be positive' }
  const net = toBtcNet(network)
  const msg = runeExitMessage(network, e.from, e.runeId, amt, e.l1Address, Number(e.nonce))
  const scheme = e.scheme === 'ml-dsa' ? 'ml-dsa' : 'kraywallet'
  if (!verifySignature(e.from, msg, e.signature, e.publicKey, scheme, net)) {
    return { ok: false, reason: 'the rune-exit signature does not verify — refused (forged, wrong key, or tampered dest)' }
  }
  return { ok: true, amt, dest: scriptOfAddress(e.l1Address, net) }
}

export function authorizePotSign(
  req: PotSignRequest,
  depositorSecret: Uint8Array,
  bookBalanceOf?: (from: string, runeId: string) => bigint | null,
  opts?: SignerOptions,
): { ok: true; depositorSigs: string[] } | { ok: false; reason: string; lagging?: true } {
  try {
    const e = req.exit
    if (!e || !e.from || !e.runeId || !e.l1Address || e.amount == null || e.nonce == null) {
      return { ok: false, reason: 'a pot sign needs the SIGNED rune-exit (from, runeId, amount, l1Address, nonce, signature)' }
    }
    const bound = bindSignedExit(e, req.network)
    if (!bound.ok) return bound
    if (!sameHex(req.plan.destScriptHex, bound.dest)) {
      return { ok: false, reason: 'the payout dest is not the SIGNED exit address — refused' }
    }
    if (req.plan.exitAmount !== bound.amt) {
      return { ok: false, reason: `the payout amount ${req.plan.exitAmount} is not the signed lock ${bound.amt} — refused` }
    }
    const loaf = req.plan.dests && req.plan.dests.length > 1 ? req.plan.dests : null
    const loafExits = req.exits && req.exits.length > 1 ? req.exits : null
    if (loaf || loafExits) {
      if (!loaf || !loafExits || loaf.length !== loafExits.length) {
        return { ok: false, reason: 'a loaf needs one SIGNED exit per dest, in output order — refused' }
      }
      for (let i = 0; i < loaf.length; i++) {
        const b = bindSignedExit(loafExits[i], req.network)
        if (!b.ok) return { ok: false, reason: `loaf dest ${i}: ${b.reason}` }
        if (!sameHex(loaf[i].destScriptHex, b.dest)) {
          return { ok: false, reason: `loaf dest ${i} is not that exit's SIGNED address — refused` }
        }
        if (loaf[i].exitAmount !== b.amt) {
          return { ok: false, reason: `loaf dest ${i} amount ${loaf[i].exitAmount} is not the signed lock ${b.amt} — refused` }
        }
        if (loafExits[i].runeId !== e.runeId) {
          return { ok: false, reason: 'every loaf dest must be the SAME rune — refused' }
        }
      }
      if (!sameHex(loaf[0].destScriptHex, req.plan.destScriptHex) || loaf[0].exitAmount !== req.plan.exitAmount) {
        return { ok: false, reason: 'loaf dest 0 must be the initiator — refused' }
      }
    }
    // THE PEN'S OWN BOOK (2026-09-18): when the daemon hands over a book, the pen runs the guardians'
    // predicate itself — every exiter must HOLD what they withdraw per a book THIS pen replayed. Without it
    // the owner key was a rubber stamp for anyone holding two guardian keys and the local token.
    const penExits = loafExits && loafExits.length ? loafExits : [e]
    const law = signerLawV2(req, penExits, opts, 'pen')
    if (!law.ok) return law
    if (bookBalanceOf) {
      const covered = requireBookCovers(penExits, bookBalanceOf, 'pen')
      if (!covered.ok) return covered
    }
    const derived = _generateKeyPair(depositorSecret).publicKeyHex
    if (toXOnly(req.params.depositor) !== derived) {
      return { ok: false, reason: 'this signer does not hold the pot owner key for these vault params — refused' }
    }
    const svc = serviceFeeWithinCeiling(req.plan)
    if (!svc.ok) return svc
    const rebuilt = buildExitPayout(req.params, req.vaultUtxos, req.funding, req.plan)
    if (rebuilt.vaultInputCount !== req.claimedSighashes.length) {
      return { ok: false, reason: 'claimed sighash count does not match the rebuilt vault inputs — refused' }
    }
    for (let i = 0; i < rebuilt.vaultInputCount; i++) {
      if (!sameHex(rebuilt.sighashes[i], req.claimedSighashes[i])) {
        return { ok: false, reason: 'claimed sighashes do not match the rebuilt payout — refused (the node cannot redirect the metal)' }
      }
    }
    const depositorSigs = rebuilt.sighashes.slice(0, rebuilt.vaultInputCount).map((sh) => signVaultSighash(sh, depositorSecret))
    rememberDelivery(req, penExits, opts && opts.memory, law.spend)
    return { ok: true, depositorSigs }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * GUARDIAN CO-SIGN — a guardian share, gated on the guardian's OWN book replay.
 *
 * Runs the IDENTICAL authorization core as authorizePotSign (verify the signed rune-exit, bind dest+amount,
 * validate the loaf, rebuild the payout, match the claimed sighashes) PLUS the one predicate the owner signer
 * never ran: re-check, against THIS guardian's INDEPENDENT cascade replay (`bookBalanceOf`), that every exiter
 * actually holds >= the amount they withdraw. A compromised writer that forges a validly-signed OVER-BALANCE
 * exit gets no guardian share — the guardian's own book refuses. Fail-CLOSED: an unknown balance (null) is a
 * refusal, never a pass. Signs with a GUARDIAN secret (which must be one of params.guardians), never the owner
 * key. Additive: authorizePotSign is untouched; this is a NEW, independent co-signer.
 */
export function authorizeGuardianSign(
  req: PotSignRequest,
  guardianSecret: Uint8Array,
  bookBalanceOf: (from: string, runeId: string) => bigint | null,
  opts?: SignerOptions,
): { ok: true; guardianKey: string; guardianSigs: string[] } | { ok: false; reason: string; lagging?: true } {
  try {
    const e = req.exit
    if (!e || !e.from || !e.runeId || !e.l1Address || e.amount == null || e.nonce == null) {
      return { ok: false, reason: 'a guardian sign needs the SIGNED rune-exit (from, runeId, amount, l1Address, nonce, signature)' }
    }
    const bound = bindSignedExit(e, req.network)
    if (!bound.ok) return bound
    if (!sameHex(req.plan.destScriptHex, bound.dest)) {
      return { ok: false, reason: 'the payout dest is not the SIGNED exit address — refused' }
    }
    if (req.plan.exitAmount !== bound.amt) {
      return { ok: false, reason: `the payout amount ${req.plan.exitAmount} is not the signed lock ${bound.amt} — refused` }
    }
    const loaf = req.plan.dests && req.plan.dests.length > 1 ? req.plan.dests : null
    const loafExits = req.exits && req.exits.length > 1 ? req.exits : null
    if (loaf || loafExits) {
      if (!loaf || !loafExits || loaf.length !== loafExits.length) {
        return { ok: false, reason: 'a loaf needs one SIGNED exit per dest, in output order — refused' }
      }
      for (let i = 0; i < loaf.length; i++) {
        const b = bindSignedExit(loafExits[i], req.network)
        if (!b.ok) return { ok: false, reason: `loaf dest ${i}: ${b.reason}` }
        if (!sameHex(loaf[i].destScriptHex, b.dest)) {
          return { ok: false, reason: `loaf dest ${i} is not that exit's SIGNED address — refused` }
        }
        if (loaf[i].exitAmount !== b.amt) {
          return { ok: false, reason: `loaf dest ${i} amount ${loaf[i].exitAmount} is not the signed lock ${b.amt} — refused` }
        }
        if (loafExits[i].runeId !== e.runeId) {
          return { ok: false, reason: 'every loaf dest must be the SAME rune — refused' }
        }
      }
      if (!sameHex(loaf[0].destScriptHex, req.plan.destScriptHex) || loaf[0].exitAmount !== req.plan.exitAmount) {
        return { ok: false, reason: 'loaf dest 0 must be the initiator — refused' }
      }
    }
    // THE INDEPENDENT PREDICATE: every exiter must actually HOLD >= what they withdraw, per THIS guardian's
    // own book replay (shared with the pen since 2026-09-18 — requireBookCovers).
    const allExits = loafExits && loafExits.length ? loafExits : [e]
    const law = signerLawV2(req, allExits, opts, 'guardian')
    if (!law.ok) return law
    const covered = requireBookCovers(allExits, bookBalanceOf, 'guardian')
    if (!covered.ok) return covered
    // Bind a GUARDIAN secret — it must be one of the vault's sealed guardians, never the owner key.
    const gx = toXOnly(_generateKeyPair(guardianSecret).publicKeyHex)
    if (!req.params.guardians.some((g) => { try { return toXOnly(g) === gx } catch { return false } })) {
      return { ok: false, reason: 'this signer does not hold a guardian key for these vault params — refused' }
    }
    const svc = serviceFeeWithinCeiling(req.plan)
    if (!svc.ok) return svc
    const rebuilt = buildExitPayout(req.params, req.vaultUtxos, req.funding, req.plan)
    if (rebuilt.vaultInputCount !== req.claimedSighashes.length) {
      return { ok: false, reason: 'claimed sighash count does not match the rebuilt vault inputs — refused' }
    }
    for (let i = 0; i < rebuilt.vaultInputCount; i++) {
      if (!sameHex(rebuilt.sighashes[i], req.claimedSighashes[i])) {
        return { ok: false, reason: 'claimed sighashes do not match the rebuilt payout — refused (the node cannot redirect the metal)' }
      }
    }
    const guardianSigs = rebuilt.sighashes.slice(0, rebuilt.vaultInputCount).map((sh) => signVaultSighash(sh, guardianSecret))
    rememberDelivery(req, allExits, opts && opts.memory, law.spend)
    return { ok: true, guardianKey: gx, guardianSigs }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Combine remote (book-checked) guardian shares with locally-held lab shares into finalizeExitPayout's
 * per-input maps, PREFERRING the remote shares so a remote's balanceOf gate actually gates the withdraw
 * (else the threshold could be met by rubber-stamp lab keys and the remote would never matter). `labSig`
 * returns a lab signature for a guardian this process still holds, or null. Fewer than threshold sigs on any
 * input yields a short map, and finalizeExitPayout then fails — fail-closed by construction.
 */
export function mergeGuardianShares(
  payout: { sighashes: string[]; vaultInputCount: number; params: VaultParams },
  remoteShares: { guardianKey: string; guardianSigs: string[] }[],
  labSig: (guardianKey: string, inputIndex: number) => string | null,
): Map<string, string>[] {
  const guardians = payout.params.guardians
  const threshold = payout.params.threshold
  const out: Map<string, string>[] = []
  for (let i = 0; i < payout.vaultInputCount; i++) {
    const m = new Map<string, string>()
    // remote (book-checked) shares FIRST — matched to the vault's guardian keys, one sig per input
    for (const rs of remoteShares) {
      if (m.size >= threshold) break
      const g = guardians.find((gk) => { try { return toXOnly(gk) === toXOnly(rs.guardianKey) } catch { return false } })
      if (g && !m.has(g) && rs.guardianSigs[i]) m.set(g, rs.guardianSigs[i])
    }
    // only then fill with lab shares for guardians no remote covered, up to threshold
    for (const g of guardians) {
      if (m.size >= threshold) break
      if (m.has(g)) continue
      const s = labSig(g, i)
      if (s) m.set(g, s)
    }
    out.push(m)
  }
  return out
}

/**
 * Decide the guardian quorum from each configured guardian's outcome — the fault-tolerance policy.
 *
 * - A guardian that REFUSED on its OWN book (a safety verdict — over-balance, forged, etc.) HOLDS the
 *   withdraw. We never route around a book that says NO; for a legitimate withdraw no synced guardian says no.
 * - A guardian that was UNREACHABLE is TOLERATED: the vault threshold IS the fault tolerance, so run more
 *   guardians than the threshold and any (configured − threshold) may be down while withdraws still proceed.
 * - The OWNER is a separate, always-required key and is NOT part of this quorum — it is never a
 *   guardian and never a fallback for one. If too few guardians are reachable the withdraw simply waits;
 *   funds are never frozen because the depositor's CSV unilateral escape never depends on the guardians.
 *
 * Returns exactly `threshold` distinct-guardian shares, or a reason to hold.
 */
export function decideGuardianQuorum(
  outcomes: ({ ok: true; share: { guardianKey: string; guardianSigs: string[] } } | { ok: false; refused: boolean; reason: string })[],
  threshold: number,
): { ok: true; shares: { guardianKey: string; guardianSigs: string[] }[] } | { ok: false; reason: string } {
  const refusal = outcomes.find((o) => !o.ok && o.refused)
  if (refusal && !refusal.ok) {
    return { ok: false, reason: 'a guardian refused on its own book (held for safety): ' + refusal.reason }
  }
  const seen = new Set<string>()
  const shares: { guardianKey: string; guardianSigs: string[] }[] = []
  for (const o of outcomes) {
    if (!o.ok) continue
    let key: string
    try { key = toXOnly(o.share.guardianKey) } catch { continue }
    if (seen.has(key)) continue // one daemon, one guardian — never double-count a key toward the threshold
    seen.add(key)
    shares.push(o.share)
  }
  if (shares.length < threshold) {
    return { ok: false, reason: `only ${shares.length} of ${threshold} guardians confirmed (the rest unreachable) — withdraw held; funds stay safe (the CSV unilateral escape never depends on the guardians)` }
  }
  return { ok: true, shares: shares.slice(0, threshold) }
}

/** Wire helper: JSON cannot carry bigint. The daemon and the node share this shape. */
export function planFromWire(w: Record<string, unknown>): ExitPayoutPlan {
  const rid = String(w.runeId || '')
  const [block, tx] = rid.split(':')
  const destsRaw = Array.isArray(w.dests) ? w.dests : null
  return {
    runeId: { block: BigInt(block), tx: BigInt(tx) },
    exitAmount: BigInt(String(w.exitAmount)),
    totalVaultRunes: BigInt(String(w.totalVaultRunes)),
    destScriptHex: String(w.destScriptHex),
    destPostage: BigInt(String(w.destPostage)),
    changePostage: BigInt(String(w.changePostage)),
    changeScriptHex: w.changeScriptHex != null ? String(w.changeScriptHex) : undefined,
    satsChangeScriptHex: String(w.satsChangeScriptHex),
    feeSats: BigInt(String(w.feeSats)),
    dust: BigInt(String(w.dust)),
    ...serviceFeeFromWire(w.serviceFee),
    ...(destsRaw ? {
      dests: destsRaw.map((d) => {
        const x = d as Record<string, unknown>
        return { destScriptHex: String(x.destScriptHex), exitAmount: BigInt(String(x.exitAmount)) }
      }),
    } : {}),
  }
}

export function planToWire(p: ExitPayoutPlan): Record<string, unknown> {
  return {
    runeId: `${p.runeId.block}:${p.runeId.tx}`,
    exitAmount: p.exitAmount.toString(),
    totalVaultRunes: p.totalVaultRunes.toString(),
    destScriptHex: p.destScriptHex,
    destPostage: p.destPostage.toString(),
    changePostage: p.changePostage.toString(),
    ...(p.changeScriptHex ? { changeScriptHex: p.changeScriptHex } : {}),
    satsChangeScriptHex: p.satsChangeScriptHex,
    feeSats: p.feeSats.toString(),
    dust: p.dust.toString(),
    ...(p.serviceFee ? { serviceFee: { scriptHex: p.serviceFee.scriptHex, sats: p.serviceFee.sats.toString() } } : {}),
    ...(p.dests && p.dests.length > 1 ? {
      dests: p.dests.map((d) => ({ destScriptHex: d.destScriptHex, exitAmount: d.exitAmount.toString() })),
    } : {}),
  }
}

export function fundingFromWire(w: Record<string, unknown>): FundingUtxo {
  return {
    txid: String(w.txid),
    vout: Number(w.vout),
    amountSats: BigInt(String(w.amountSats)),
    scriptHex: String(w.scriptHex),
    internalKey: String(w.internalKey),
  }
}

export function utxosFromWire(list: unknown): VaultUtxo[] {
  if (!Array.isArray(list)) return []
  return list.map((u) => {
    const x = u as Record<string, unknown>
    return { txid: String(x.txid), vout: Number(x.vout), amountSats: BigInt(String(x.amountSats)) }
  })
}

export function paramsFromWire(w: Record<string, unknown>): VaultParams {
  const guardians = Array.isArray(w.guardians) ? w.guardians.map((g) => String(g)) : []
  return {
    guardians,
    threshold: Number(w.threshold),
    depositor: String(w.depositor),
    timelock: w.timelock != null ? Number(w.timelock) : undefined,
    net: toBtcNet(String(w.net || 'regtest')),
  }
}
