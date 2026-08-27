/**
 * THE RUNE BOOK — the L2 accounting of a Bitcoin rune, kept so it cannot lie.
 *
 * One invariant governs everything here, and it is checked after EVERY move:
 *
 *     Σ balances(R)  +  Σ locked(R)  ==  reserve(R)
 *
 * `reserve` only ever grows by a PROVEN deposit and only ever shrinks by a
 * PROVEN withdrawal, so the equation says: every credit on this L2 is backed by
 * runes sitting in the vault on Bitcoin L1, at all times, including mid-flight.
 * It is the same discipline that keeps KRAY conserved (emitted − burned) — the difference
 * between an L2 that is solvent and one that merely has not been checked.
 *
 * ── WHY EXITS ARE TWO-PHASE ─────────────────────────────────────────────────
 * The oldest bridge attack is to spend on L2 and claim the same coins on L1.
 * Here the exit REQUEST moves the credits out of the spendable book and into a
 * lock, before any L1 payout exists. From that instant they cannot be sent to
 * anyone, so the two claims cannot both happen — arithmetic, not a promise
 * about how operators behave. The lock resolves one of exactly two ways: the L1
 * payout is proven and the credits burn, or the request is cancelled and they
 * come back. Nothing is created, nothing is stranded.
 *
 * Pure, total, BigInt-only. Every refusal is named, because a refusal nobody can
 * explain is indistinguishable from a bug.
 */
import type { RuneId } from '../protocol/runestone.ts'

export const runeKey = (id: RuneId): string => `${id.block}:${id.tx}`
export const parseRuneKey = (k: string): RuneId => { const [b, t] = k.split(':'); return { block: BigInt(b), tx: BigInt(t) } }

/** Untrusted `block:tx` → the unique book key. `01:1` and `1:1` are the same rune.
 *  Strict decimal digits only — a space, a sign or a third field is an attempt, not an id. */
export function canonicalRuneKey(k: string): string {
  if (typeof k !== 'string' || !/^[0-9]+:[0-9]+$/.test(k)) {
    throw new Error('rune-book: rune id must be block:tx (decimal digits)')
  }
  return runeKey(parseRuneKey(k))
}

export interface RuneHolding { address: string; amount: bigint }
export interface PendingExit {
  address: string; amount: bigint; l1Address: string; at: number
  /** a PRE-SIGNED SETTLEMENT was lodged against this exit (journaled as `rune-lodge`). A co-signed
   *  hex cannot be un-signed, so an armed exit is UNCANCELLABLE — it completes only by settling
   *  (anyone may broadcast the public hex). Consensus state: replay re-derives it, forever. */
  armed?: boolean
  /** the canonical sorted POT-OUTPOINT SET (`txid:vout`, joined by ',') the armed payout spends —
   *  re-derived from the rune-lodge event's `outpoint` on replay. The pot commingles many outpoints
   *  and the node coin-selects, so — unlike a personal vault whose single outpoint is spent-in-mempool
   *  — a SECOND payout of one lock can spend a DIFFERENT pot outpoint and deliver twice (a pot drain).
   *  Binding the arm to this set lets the door refuse a second DISTINCT payout while still allowing an
   *  idempotent same-outpoint re-broadcast (RBF/liveness). NOT folded into the commitment (audit-trail
   *  metadata, not committed value) — so the anchored cascade root is byte-identical either way. */
  boundVault?: string
}

export class RuneBook {
  /** rune → address → spendable credits */
  private readonly balances = new Map<string, Map<string, bigint>>()
  /** rune → address → credits locked by an exit request (unspendable, unburned) */
  private readonly locks = new Map<string, Map<string, PendingExit>>()
  /** rune → what the L1 vault must be holding for this book to be honest */
  private readonly reserves = new Map<string, bigint>()
  /** every deposit outpoint already credited — a replayed proof mints nothing */
  private readonly credited = new Set<string>()
  /** every L1 payout already burned against — a replayed proof burns nothing.
   *  Keys: the whole txid (historic / solo) or txid:vout (a loaf's per-output delivery). */
  private readonly settled = new Set<string>()
  /** txids that burned at least one PER-OUTPUT delivery — a whole-tx settle of these is a replay */
  private readonly deliveredTx = new Set<string>()
  /**
   * THE BACKING LAW — rune → address → the slice of the reserve that physically sits in
   * that address's PERSONAL vault (owner-first: only their key opens it). A credit above
   * this line is backed by the SHARED consolidation pot, which any holder's exit can spend.
   * The law it powers: a transfer may only hand out POT-BACKED credits — a recipient must
   * never depend on the sender's living key to reach Bitcoin (no hostages, ever).
   *   personal grows on a personal-vault deposit, falls on a settle (the payout spent that
   *   vault first), and drops to ZERO on a rehome (the depositor moved the coins to the pot).
   */
  private readonly personal = new Map<string, Map<string, bigint>>()
  /** runes whose backing was ever pot-touched (a rehome or a pool deposit). The commitment
   *  folds personal-backing lines ONLY for these, so every pre-rehome history hashes
   *  byte-identically — no anchored root is ever orphaned (append-only, the ADR-1 discipline). */
  private readonly rehomedRunes = new Set<string>()

  private bal(rune: string): Map<string, bigint> {
    let m = this.balances.get(rune)
    if (!m) { m = new Map(); this.balances.set(rune, m) }
    return m
  }
  private lock(rune: string): Map<string, PendingExit> {
    let m = this.locks.get(rune)
    if (!m) { m = new Map(); this.locks.set(rune, m) }
    return m
  }
  private pers(rune: string): Map<string, bigint> {
    let m = this.personal.get(rune)
    if (!m) { m = new Map(); this.personal.set(rune, m) }
    return m
  }

  /**
   * A PROVEN DEPOSIT credits the recipient and raises the reserve by the same
   * amount. The outpoint is remembered forever: the same deposit can never be
   * claimed twice, however many times its proof is presented.
   */
  deposit(rune: RuneId, outpoint: string, amount: bigint, to: string, opts: { pool?: boolean } = {}): void {
    if (amount <= 0n) throw new Error('rune-book: a deposit must be positive')
    if (!to) throw new Error('rune-book: a deposit needs a recipient')
    if (this.credited.has(outpoint)) throw new Error(`rune-book: outpoint ${outpoint} was already credited — a deposit is minted once, ever`)
    const k = runeKey(rune)
    this.credited.add(outpoint)
    this.reserves.set(k, (this.reserves.get(k) ?? 0n) + amount)
    const m = this.bal(k)
    m.set(to, (m.get(to) ?? 0n) + amount)
    // BACKING: a personal-vault deposit is backed by the depositor's OWN key until rehomed;
    // a pot deposit (opts.pool — the coins landed straight in the shared consolidation vault)
    // backs anyone from day one and marks the rune pot-touched for the commitment fold.
    if (opts.pool) this.rehomedRunes.add(k)
    else { const pm = this.pers(k); pm.set(to, (pm.get(to) ?? 0n) + amount) }
    this.assertSolvent(k)
  }

  /**
   * REHOME — the depositor moved their vault's physical runes into the shared consolidation
   * pot on Bitcoin (one co-signed L1 act, verified at the door before this is journaled).
   * Their L2 credits DO NOT move — only the backing's location: personal drops to zero, so
   * everything they hold (and everything they later hand out) is pot-backed and every
   * recipient can exit without the depositor's living key. Reserve untouched: the same
   * coins, a different box.
   */
  rehome(rune: RuneId, address: string, amount?: bigint): bigint {
    const k = runeKey(rune)
    const pm = this.pers(k)
    const had = pm.get(address) ?? 0n
    if (had <= 0n) throw new Error('rune-book: nothing to rehome — this address has no personal-vault backing')
    // amount absent = the whole box (every rehome journaled before partial-rehome).
    // amount present = only the metal that L1 actually moved, so a later deposit that
    // confirmed while the bakery was in flight stays PERSONAL and can open again.
    const take = amount == null ? had : (amount > had ? had : amount)
    if (take <= 0n) throw new Error('rune-book: a rehome must move a positive amount')
    const left = had - take
    if (left > 0n) pm.set(address, left)
    else pm.delete(address)
    this.rehomedRunes.add(k)
    this.assertSolvent(k)
    return take
  }

  /** An L2 transfer: cheap, instant, and it can never change the reserve. */
  send(rune: RuneId, from: string, to: string, amount: bigint): void {
    if (amount <= 0n) throw new Error('rune-book: a transfer must be positive')
    if (from === to) throw new Error('rune-book: a transfer needs two different parties')
    const k = runeKey(rune)
    const m = this.bal(k)
    const have = m.get(from) ?? 0n
    if (have < amount) throw new Error(`rune-book: insufficient runes (have ${have}, need ${amount})`)
    m.set(from, have - amount)
    m.set(to, (m.get(to) ?? 0n) + amount)
    this.assertSolvent(k)
  }

  /**
   * PHASE ONE OF AN EXIT — the credits leave the spendable book NOW, before any
   * L1 payout exists. This is what makes spending on L2 and claiming on L1
   * mutually exclusive by arithmetic. One open request per address per rune:
   * two overlapping locks would make the burn ambiguous, and an ambiguous burn
   * is a hole.
   */
  requestExit(rune: RuneId, from: string, amount: bigint, l1Address: string, at: number): void {
    if (amount <= 0n) throw new Error('rune-book: an exit must be positive')
    if (!l1Address) throw new Error('rune-book: an exit needs an L1 destination')
    const k = runeKey(rune)
    if (this.lock(k).has(from)) throw new Error('rune-book: this address already has an open exit — settle or cancel it first')
    const m = this.bal(k)
    const have = m.get(from) ?? 0n
    if (have < amount) throw new Error(`rune-book: insufficient runes to exit (have ${have}, need ${amount})`)
    m.set(from, have - amount)
    this.lock(k).set(from, { address: from, amount, l1Address, at })
    this.assertSolvent(k)
  }

  /** ARM an open exit — a pre-signed settlement was lodged against it (the door verified the
   *  co-signed hex against Bitcoin; the journal records the FACT so replay re-derives it). */
  armExit(rune: RuneId, from: string, boundVault?: string): void {
    const k = runeKey(rune)
    const pending = this.lock(k).get(from)
    if (!pending) throw new Error('rune-book: no open exit to arm')
    if (pending.armed) throw new Error('rune-book: this exit is already armed — one settlement, one arming')
    this.lock(k).set(from, { ...pending, armed: true, ...(boundVault ? { boundVault } : {}) })
    this.assertSolvent(k)
  }

  /** The request is withdrawn: the credits come back, untouched. An ARMED exit refuses —
   *  a co-signed settlement hex cannot be un-signed; cancelling under it would let the stale
   *  hex pay the old balance on L1 while the credits respend on L2. Fire or settle instead. */
  cancelExit(rune: RuneId, from: string): void {
    const k = runeKey(rune)
    const pending = this.lock(k).get(from)
    if (!pending) throw new Error('rune-book: no open exit for this address')
    if (pending.armed) throw new Error('rune-book: a pre-signed settlement is ARMED against this exit — it cannot be cancelled, only settled (anyone may broadcast the public hex)')
    this.lock(k).delete(from)
    const m = this.bal(k)
    m.set(from, (m.get(from) ?? 0n) + pending.amount)
    this.assertSolvent(k)
  }

  /**
   * PHASE TWO — the L1 payout is proven, so the locked credits BURN and the
   * reserve falls by exactly the same amount. The L1 transaction is remembered:
   * one payout can never burn two locks.
   *
   * THE LOAF GENERALIZATION (custody rung 5 — per-recipient settlement routing): ONE pot
   * transaction may pay MANY signed exits, each recipient on its OWN output. The dedup law
   * then keys on the DELIVERY OUTPOINT (`deliveryKey` = txid:vout), not the whole txid —
   * "one delivery, one burn". Absent (every settle journaled before the loaf) the key is
   * the txid, byte-identical to the historic law; a replayed same-delivery proof still
   * refuses either way.
   */
  settleExit(rune: RuneId, from: string, amount: bigint, l1Txid: string, deliveryKey?: string): void {
    const k = runeKey(rune)
    const pending = this.lock(k).get(from)
    if (!pending) throw new Error('rune-book: no open exit to settle')
    if (pending.amount !== amount) throw new Error(`rune-book: the payout is ${amount} but the locked exit is ${pending.amount} — a settlement matches its lock exactly`)
    const dk = deliveryKey || l1Txid
    if (this.settled.has(dk)) throw new Error(`rune-book: delivery ${dk} already settled an exit — one delivery, one burn`)
    // a loaf's per-output settles coexist under one txid, but a WHOLE-TX (no-vout) settle and
    // per-output settles of the SAME txid are the same replay attack in either direction: refuse.
    if (dk !== l1Txid && this.settled.has(l1Txid)) throw new Error(`rune-book: L1 transaction ${l1Txid} was already consumed by a whole-tx settle — refused`)
    if (dk === l1Txid && this.deliveredTx.has(l1Txid)) throw new Error(`rune-book: L1 transaction ${l1Txid} already burned per-output deliveries — a whole-tx settle of it is a replay, refused`)
    this.settled.add(dk)
    if (dk !== l1Txid) this.deliveredTx.add(l1Txid)
    this.lock(k).delete(from)
    const reserve = this.reserves.get(k) ?? 0n
    if (reserve < amount) throw new Error('rune-book: the reserve cannot go negative — refused')
    this.reserves.set(k, reserve - amount)
    // BACKING follows the metal: the payout spends the exiter's PERSONAL vault first (the
    // door's own preference), so their personal backing falls with the reserve — floored at
    // zero because a pool-path payout touches no personal box. Conservative by construction:
    // the book may UNDERSTATE pot backing (refusing a send it could allow), never overstate it.
    const pm = this.pers(k)
    const pHad = pm.get(from) ?? 0n
    if (pHad > 0n) { const left = pHad - amount; if (left > 0n) pm.set(from, left); else pm.delete(from) }
    this.assertSolvent(k)
  }

  /** THE TRIPWIRE. Credits plus locks must equal the reserve, exactly, always. */
  private assertSolvent(rune: string): void {
    if (!this.solventFor(rune)) {
      throw new Error(`rune-book: SOLVENCY BROKEN for rune ${rune} — the L2 would hold more than the vault. HALT`)
    }
  }

  solventFor(rune: string): boolean {
    let sum = 0n
    for (const v of this.balances.get(rune)?.values() ?? []) sum += v
    for (const p of this.locks.get(rune)?.values() ?? []) sum += p.amount
    return sum === (this.reserves.get(rune) ?? 0n)
  }
  /** Every rune this book knows is solvent — what an auditor checks in one call. */
  solvent(): boolean {
    for (const rune of this.reserves.keys()) if (!this.solventFor(rune)) return false
    return true
  }

  balanceOf(rune: RuneId, address: string): bigint { return this.balances.get(runeKey(rune))?.get(address) ?? 0n }
  lockedOf(rune: RuneId, address: string): PendingExit | null { return this.locks.get(runeKey(rune))?.get(address) ?? null }
  /** The slice of this address's holdings still backed by their PERSONAL vault (needs their key on L1). */
  personalOf(rune: RuneId, address: string): bigint { return this.personal.get(runeKey(rune))?.get(address) ?? 0n }
  /**
   * THE BACKING GATE's arithmetic — how much this address may hand to a THIRD PARTY right now.
   * A send of `amt` must leave balance + locked ≥ personal (you can never hold fewer credits
   * than your personal box backs — otherwise someone else's credit would need YOUR key).
   * Per-sender local check, global theorem: if every address obeys it, the pot exactly covers
   * every non-personal credit (Σ(bal+lock−personal) = reserve − Σ personal = pooled).
   */
  transferableOf(rune: RuneId, address: string): bigint {
    const bal = this.balanceOf(rune, address)
    const locked = this.lockedOf(rune, address)?.amount ?? 0n
    const free = bal + locked - this.personalOf(rune, address)
    const t = free < 0n ? 0n : free
    return t < bal ? t : bal
  }
  reserveOf(rune: RuneId): bigint { return this.reserves.get(runeKey(rune)) ?? 0n }
  /** A proven deposit wrote this key. A well-formed `block:tx` that never hit the vault is a ghost — not a rune on this L2. */
  knows(rune: RuneId): boolean { return this.reserves.has(runeKey(rune)) }
  wasCredited(outpoint: string): boolean { return this.credited.has(outpoint) }
  wasSettled(l1Txid: string): boolean { return this.settled.has(l1Txid) }
  /** Every holder of a rune, for the explorer and for any auditor. */
  holders(rune: RuneId): RuneHolding[] {
    return [...(this.balances.get(runeKey(rune)) ?? new Map())]
      .filter(([, a]) => a > 0n)
      .map(([address, amount]) => ({ address, amount }))
      .sort((x, y) => (y.amount > x.amount ? 1 : y.amount < x.amount ? -1 : x.address < y.address ? -1 : 1))
  }
  /** Every holder whose credits are backed by the SHARED pot — their balance MINUS their personal-vault
   *  slice — and by how much. This is the exact book the pot's pre-signed split pays, each holder to their
   *  own address: a holder's own deposit sits in their personal vault (pot-backed 0), while a pot deposit,
   *  a received credit, or a rehomed one is pot-backed. Pure derived view; Σ is the pooled backing the pot's
   *  outpoints hold. (balance − personal is clamped at 0: the door's transferable gate keeps it non-negative
   *  in production, and the filter drops any residual.) */
  potBackedHolders(rune: RuneId): RuneHolding[] {
    return this.holders(rune)
      .map(({ address, amount }) => ({ address, amount: amount - this.personalOf(rune, address) }))
      .filter((h) => h.amount > 0n)
      .sort((x, y) => (y.amount > x.amount ? 1 : y.amount < x.amount ? -1 : x.address < y.address ? -1 : 1))
  }
  /** Every OPEN exit for a rune — the credits locked, waiting for their L1 payout. For the explorer/auditor. */
  locksOf(rune: RuneId): PendingExit[] {
    return [...(this.locks.get(runeKey(rune)) ?? new Map()).values()]
      .filter((p) => p.amount > 0n)
      .sort((x, y) => (y.amount > x.amount ? 1 : y.amount < x.amount ? -1 : x.address < y.address ? -1 : 1))
  }
  /** Every rune with a book here — derived, never a curated list. */
  runes(): RuneId[] { return [...this.reserves.keys()].map(parseRuneKey) }

  /** A deterministic commitment over the WHOLE book — reserves, spendable balances, and
   *  locked exits, in canonical order — so a node can fold the rune L2 into its cascade root
   *  and anchor it to Bitcoin. Pure function of the applied journal; byte-identical everywhere. */
  commitment(): string {
    const parts: string[] = []
    for (const rune of [...this.reserves.keys()].sort()) {
      parts.push(`rune:${rune}|reserve:${this.reserves.get(rune) ?? 0n}`)
      const bals = [...(this.balances.get(rune) ?? new Map<string, bigint>())].filter(([, a]) => a > 0n).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      for (const [addr, amt] of bals) parts.push(`b|${rune}|${addr}:${amt}`)
      const locks = [...(this.locks.get(rune) ?? new Map<string, PendingExit>())].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      // APPEND-ONLY: the `:armed` suffix folds in ONLY when an exit is armed, so every history
      // without a lodge hashes byte-identically to before — no anchored root is ever orphaned.
      for (const [addr, p] of locks) parts.push(`l|${rune}|${addr}:${p.amount}:${p.l1Address}${p.armed ? ':armed' : ''}`)
      // APPEND-ONLY (same law): personal-backing lines fold ONLY once a rune was pot-touched
      // (a rune-rehome or a pool deposit — both NEW event shapes). Every pre-rehome history
      // hashes byte-identically to before; after the first rehome, the backing map is committed
      // so two histories with different backing can never share an anchored root.
      if (this.rehomedRunes.has(rune)) {
        const pers = [...(this.personal.get(rune) ?? new Map<string, bigint>())].filter(([, a]) => a > 0n).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        for (const [addr, amt] of pers) parts.push(`p|${rune}|${addr}:${amt}`)
      }
    }
    return parts.join('\n')
  }
}
