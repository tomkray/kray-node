/**
 * The KRAYNET Node — the clean surface the HTTP server and wallet talk to.
 *
 * It owns the durable LedgerStore (journal on disk) and exposes exactly two things:
 *   · WRITES — a submit path for signed user actions (transfer / transfer-star / inscribe /
 *     name / origin), plus the system paths (donate mints against the pot, anchor drains it,
 *     reward pays a validator from the fee pool). Every write goes through the store's
 *     hash-chained append, so the reducer validates it (the Supreme Law + every economic law)
 *     BEFORE a byte hits disk, and a reboot re-derives it exactly.
 *   · READS — the derived views a wallet/explorer render: balance, nonce, supply (emitted /
 *     burned / circulating), the anchoring pot, a star by its creation number (owner, name,
 *     content, Codex), a whole profile, and the cascade root that anchors to Bitcoin.
 *
 * No emission schedule, no premine, no fixed supply cap — KRAYNET is fungible ₭ + born-from-fire stars +
 * proof-of-donation. Everything here is a pure function of the journal.
 */
import { LedgerStore } from './store.ts'
import { craneFinality } from './finality.ts'   // ADR-4 4a: the pure-journal half of finality (crane); the anchor half lives where Bitcoin does (server/follower)
import { starRarity, type StarRarity, type Star } from './starmap.ts'
import { DEFAULT_POT_TARGET_SATS } from './pot.ts'
import type { StarCollection, StarTrait } from './star-lore.ts'
import type { KrayEvent } from './kray-primitives.ts'
import { TREASURY } from './kray-primitives.ts'
import { ammPoolAddress, ammRrPoolAddress, quoteOut, quoteAdd, quoteFirstMint, quoteRemove, rrPairKey } from './amm.ts'
import { parseRuneKey, canonicalRuneKey } from '../economics/rune-book.ts'
import { settleFromBeats } from '../economics/settlement.ts'
import { custodyFromHex, hitCount } from '../economics/custody.ts'
import { readPresenceTip } from '../economics/presence-window.ts'

/** the user-signed actions the submit path accepts (donate/anchor/reward/rune-deposit are system paths) */
const USER_KINDS = new Set(['transfer', 'transfer-star', 'burn', 'inscribe', 'name', 'origin', 'eternize', 'set-face', 'clear-face', 'set-profile', 'set-kray-plate', 'rune-send', 'rune-exit', 'rune-cancel', 'amm-add', 'amm-remove', 'amm-swap', 'amm-rr-add', 'amm-rr-remove', 'amm-rr-swap', 'quantum-commit', 'contract', 'contract-call', 'x-send', 'cut-send', 'lane-enter', 'lane-exit', 'fold-seal', 'star-list', 'star-delist', 'star-buy', 'star-offer', 'star-offer-cancel', 'star-offer-accept'])

export interface SupplyView { emitted: bigint; burned: bigint; circulating: bigint }
export interface PotView { held: bigint; target: bigint; deficit: bigint; donated: bigint; spent: bigint; minted: bigint; open: boolean }
export interface StarView {
  no: bigint; owner: string; by: string; id: string; seq: number
  name: string | null; contentHash: string | null; contentType: string | null
  parent: bigint | null; children: bigint[]
  origin: { l1InscriptionId: string; l1Txid: string } | null
  /** MULTIPARENT (v3, additive): the FULL signed lineage; the scalars keep first-of meaning. */
  parents: bigint[] | null
  origins: { l1InscriptionId: string; l1Txid: string }[] | null
  /** Free JSON sealed with the inscription (v4). Null on every pre-v4 star. */
  meta: string | null
  /** Living law pot (v2). Null on every star that never received a contract. */
  contract: string | null
  rarity: StarRarity; collection: StarCollection | null; traits: StarTrait[]
}
export interface ProfileView { address: string; balance: bigint; nonce: number; stars: bigint[]; starCount: number }

export class KrayNode {
  readonly store: LedgerStore

  constructor(dataDir: string, network = 'regtest', potTarget: bigint = DEFAULT_POT_TARGET_SATS, potScriptHex?: string, backingGate = false, potInternalKeyHex?: string) {
    // ADR-1: pass the pot's Bitcoin script down to the ledger so the reducer can RE-VERIFY a
    // donation's SPV proof on replay (only fires when an event carries a proof; byte-identical otherwise).
    // ADR-1 extended: the pot's x-only INTERNAL key lets the reducer re-derive a SELF-ANCHOR burn
    // script from the event's sealed (anchorBlock, anchorRoot) and re-prove that proof too.
    // backingGate (KRAY_BACKING_GATE, unset = ON): the reducer re-enforces the no-hostage send law.
    // Force 0 only to replay a pre-law journal (hostage sends the gate would refuse). The door always gates.
    this.store = new LedgerStore(dataDir, network, potTarget, potScriptHex, backingGate, potInternalKeyHex)
  }

  get ledger() { return this.store.ledger }
  get network() { return this.ledger.network }
  get head(): string { return this.store.head }
  get seq(): number { return this.store.seq }

  // ── WRITES ─────────────────────────────────────────────────────────────────
  /** Submit a signed user action. The store's append applies it through the reducer, which
   *  re-verifies the BIP-340 signature and every economic precondition and THROWS (nothing
   *  written) if anything is off. Returns the sealed event (with its journal hash = star id). */
  submit(action: Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'>): KrayEvent {
    if (!USER_KINDS.has(action.kind)) throw new Error(`node: ${action.kind} is not a submittable user action`)
    return this.store.append(action)
  }

  /** THE MINT — a proven donation mints ₭ against the pot deficit (SPV proof gates this at
   *  ingress once wired; the amount is the PROVEN satoshis). */
  donate(to: string, sats: bigint, at = 0, outpoint?: string, proof?: { rawTx: string; txoutproof: string; headers: string[] }, seal?: { blockNumber: number; root: string }): KrayEvent {
    // outpoint present ⇒ a PROVEN donation (SPV-verified L1 payment), credited once by that outpoint.
    // proof present (ADR-1) ⇒ the SPV proof rides IN the journal, so a cold replay re-verifies the burn
    // from bytes (not the operator's word) and the anchored root commits the cause. Below the
    // PROOF_MANDATORY activation, absent ⇒ byte-identical to before (append-only). AT/AFTER it —
    // signet and main are BORN STRICT at 0 — the reducer REFUSES a donate without proof + outpoint:
    // the proof is no longer optional there, it is the mint's own cause riding in the journal.
    // seal present (ADR-1 extended) ⇒ the donation paid a SELF-ANCHOR output sealing (blockNumber, root);
    // the reducer re-derives that tweaked script from the configured pot internal key and re-proves the
    // proof against it. Only meaningful WITH a proof; additive/optional like everything above.
    return this.store.append({ kind: 'donate', at, to, amount: sats.toString(), ...(outpoint ? { outpoint } : {}), ...(proof ? { proof } : {}), ...(seal ? { anchorBlock: seal.blockNumber, anchorRoot: seal.root.toLowerCase() } : {}) })
  }
  /** A PROVEN L1 rune deposit credits L2 (the SPV proof gates this at ingress, like a donation;
   *  the reducer enforces credited-once + per-rune solvency via the RuneBook). When `proof` rides
   *  (ADR-1 extended), a cold replay re-proves the deposit from bytes and the root commits the cause.
   *  At/after PROOF_MANDATORY (signet/main born strict) the reducer refuses a deposit without it. */
  runeDeposit(runeId: string, outpoint: string, to: string, amount: bigint, at = 0, proof?: KrayEvent['proof'], pool = false): KrayEvent {
    return this.store.append({ kind: 'rune-deposit', at, runeId, outpoint, to, amount: amount.toString(), ...(proof ? { proof } : {}), ...(pool ? { pool: true } : {}) })
  }
  /** THE BAKERY OPENS — journal the depositor's rehome: their vault's physical runes moved to the
   *  shared consolidation pot in a confirmed, door-verified L1 transaction they co-signed themselves
   *  (owner-first: nobody can rehome anyone else's box). Credits stay put; only the backing's home
   *  changes, so every recipient can exit without the depositor's living key. */
  runeRehome(runeId: string, from: string, l1Txid: string, outpoint?: string, at = 0, amount?: bigint): KrayEvent {
    return this.store.append({ kind: 'rune-rehome', at, runeId, from, l1Txid, ...(outpoint ? { outpoint } : {}), ...(amount != null ? { amount: amount.toString() } : {}) })
  }
  /** THE EXIT, SETTLED — phase two. After the co-signed L1 payout is SPV-proven (the same H2
   *  mirror as a donation), BURN the matching L2 lock and drop the reserve by exactly the same
   *  amount. The reducer enforces it: the lock must exist, the amount must match it, and the
   *  l1Txid credits once (one payout, one burn, forever). */
  /** `deliveryVout` (custody rung 5): set on a LOAF payout so this burn keys on its own delivery
   *  outpoint (l1Txid:vout) — one pot tx pays many exits, one delivery one burn. Absent on a solo
   *  payout, keeping every historic settle byte-identical. */
  runeSettle(runeId: string, from: string, amount: bigint, l1Txid: string, at = 0, proof?: KrayEvent['proof'], deliveryVout?: number): KrayEvent {
    return this.store.append({ kind: 'rune-settle', at, runeId, from, amount: amount.toString(), l1Txid, ...(deliveryVout != null ? { outpoint: `${l1Txid}:${deliveryVout}` } : {}), ...(proof ? { proof } : {}) })
  }
  /** A PRE-SIGNED SETTLEMENT lodged against an open exit — journal the arming so replay re-derives
   *  the exit's uncancellability (the co-signed hex was door-verified against Bitcoin; the
   *  depositor's authorization is their own co-signature inside it). `outpoint` is the audit trail. */
  runeLodge(runeId: string, from: string, outpoint?: string, at = 0): KrayEvent {
    return this.store.append({ kind: 'rune-lodge', at, runeId, from, ...(outpoint ? { outpoint } : {}) })
  }
  /** Anchoring drains the pot to pay a Bitcoin anchor fee — reopens the mint deficit. */
  anchorSpend(sats: bigint, at = 0): KrayEvent {
    return this.store.append({ kind: 'anchor', at, amount: sats.toString() })
  }
  /** THE WINDOW LAW (Slice 2c) — journal a CONFIRMED Bitcoin seal; the reducer reopens exactly one
   *  mint-cap of capacity, once per txid, ever. Call only after the seal is verified buried.
   *  `l1Height` is the Bitcoin block height that buried the seal (from the caller's own SPV/RPC check). It is
   *  IGNORED below the inclusion activation seq (A3: pre-activation seals hash byte-identically whether or not
   *  it is present, since the reducer never reads it there), and REQUIRED at/after activation — 3d-a binds the
   *  window to it, and without it the first post-activation seal is refused (the mint window never reopens). So
   *  threading it here is what lets the chain be born/upgraded activated. A lied height is caught by the
   *  reducer's monotonicity check and, once wired, the follower's BIP-34 seal-height SPV.
   *  `l1Root` / `l1BlockNumber` are the cascade root and KRAY block number the anchor tx ACTUALLY commits
   *  (a block-boundary root at the tip when the anchor was built — `seq_anchor <= this seal's seq`). The reducer
   *  binds the height to the inclusion root of THAT root (via its own producedRoots map), not to the current
   *  one, so a writer cannot pair a stale height with the current rich inclusion set (the old-anchor-reuse a
   *  design council closed). All three ride the event ONLY at/after activation (A3 byte-identical below). */
  sealConfirmed(txid: string, at = 0, l1Height?: number, l1Root?: string, l1BlockNumber?: number): KrayEvent {
    return this.store.append({
      kind: 'seal', at, l1Txid: String(txid).toLowerCase(),
      ...(Number.isInteger(l1Height) ? { l1Height } : {}),
      ...(typeof l1Root === 'string' && /^[0-9a-f]{64}$/i.test(l1Root) ? { l1Root: l1Root.toLowerCase() } : {}),
      ...(Number.isInteger(l1BlockNumber) ? { l1BlockNumber } : {}),
    })
  }
  /** QUANTUM RECOVERY (opt-in) — register a signed SHA-256 of a future post-quantum key. Moves no value;
   *  lets the account migrate to that key later without ever relying on its exposed ECC key. */
  quantumCommit(from: string, commit: string, nonce: number, publicKey: string, signature: string, scheme = 'kraywallet', at = 0): KrayEvent {
    return this.store.append({ kind: 'quantum-commit', at, from, quantumCommit: String(commit).toLowerCase(), nonce, publicKey, signature, scheme } as never)
  }
  /** CITIZEN MOUTH — bio / site / banner binding. At/after PROFILE_VALUE_SEQ pays fee:'1'. */
  setProfile(
    from: string,
    description: string, url: string, bannerStar: string, bannerUrl: string,
    nonce: number, publicKey: string, signature: string, scheme = 'kraywallet', at = 0,
    fee: string | null = null,
  ): KrayEvent {
    return this.store.append({
      kind: 'set-profile', at, from,
      description, url, bannerStar, bannerUrl,
      ...(fee != null ? { fee } : {}),
      nonce, publicKey, signature, scheme,
    } as never)
  }
  /** KRAY PLATE — living plate (hash in journal, bytes in atlas). Exactly 1 ₭. star='' = address plate. */
  setKrayPlate(
    from: string,
    plateHash: string,
    star: string,
    nonce: number, publicKey: string, signature: string, scheme = 'kraywallet', at = 0,
  ): KrayEvent {
    return this.store.append({
      kind: 'set-kray-plate', at, from,
      plateHash, star: star || undefined, fee: '1',
      nonce, publicKey, signature, scheme,
    } as never)
  }
  /** THE QUANTUM ESCAPE HATCH — rescue a compromised account, authorized by a hash-based Lamport signature
   *  (not an ECC key), matching the pre-registered quantum-commit. The reducer verifies it (pure hashing). */
  quantumMigrate(from: string, to: string, nonce: number, lamportPublicKey: string, lamportSignature: string, at = 0): KrayEvent {
    return this.store.append({ kind: 'quantum-migrate', at, from, to, nonce, lamportPublicKey: String(lamportPublicKey).toLowerCase(), lamportSignature: String(lamportSignature).toLowerCase() } as never)
  }
  // `reward(to, amount)` is GONE (2026-08-23): the unsigned payout is RETIRED in the reducer — the fee pool
  // pays only through the self-proving `settlement` (settleBeats). If the anchor backstop is ever lit, its
  // successor pays the first valid sealer with the SPV proof AS the entitlement (never a writer-worded reward).
  /** THE ONE-SHOT BURN-THAW (the operator's rite) — journal the protocol event that transmutes the pre-law
   *  fungible ₭ frozen at the hole into a true burn, Ӿ born 1:1 to the ORIGINAL senders. Carries no payload;
   *  the reducer re-derives its whole effect and enforces once-ever + the law seq (a second call throws). */
  burnThaw(at = 0): KrayEvent {
    return this.store.append({ kind: 'burn-thaw', at } as never)
  }
  // `settle(validators)` is GONE with it — a handed-in work table let the caller name who gets the pool.
  // The ONLY payout is settleBeats below: the ledger trusts the beats, never a table.
  /** THE v2 VALIDATOR REWARD, PROVEN — journal the beats gathered for a seal's beacon as ONE settlement
   *  event; the reducer re-derives the whole payout from them (settleFromBeats) and pays it from the fee
   *  pool. Conserved, refutable, sybil-neutral — the ledger trusts the beats, never a handed-in table. */
  settleBeats(beacon: string, claims: Array<{ address: string; beats: Array<{ block: number; nonce: string; zeros: number }>; custody?: string }>, at = 0, presenceTip?: number): KrayEvent {
    const tip = readPresenceTip(presenceTip)
    const windowed = tip !== undefined
    const mapped = claims.map((c) => ({
      address: c.address,
      beats: c.beats,
      hits: c.custody ? hitCount(custodyFromHex(c.custody)) : 0,
    }))
    const { rewards } = settleFromBeats(beacon, this.feePool(), mapped, windowed ? { presenceTip: tip, seq: this.seq + 1 } : { seq: this.seq + 1 })
    const payouts = rewards.map((r) => [r.id, '0', r.amount.toString()])
    return this.store.append({
      kind: 'settlement', at, beacon, claims, payouts,
      ...(windowed ? { presenceTip: tip } : {}),
    } as never)
  }
  /** The fee pool waiting to be settled to validators (the Treasury's collected fees). */
  feePool(): bigint { return this.ledger.balanceOf(TREASURY) }

  // ── READS ──────────────────────────────────────────────────────────────────
  balanceOf(a: string): bigint { return this.ledger.balanceOf(a) }
  nonceOf(a: string): number { return this.ledger.nonceOf(a) }
  cascadeRoot(): string { return this.ledger.cascadeRoot() }
  conserves(): boolean { return this.ledger.conserves() }
  backed(): boolean { return this.ledger.backed() }

  supply(): SupplyView {
    return { emitted: this.ledger.totalEmitted, burned: this.ledger.totalBurned, circulating: this.ledger.circulating }
  }

  pot(): PotView {
    const p = this.ledger.pot
    return { held: p.satsHeld, target: p.target, deficit: p.deficit(), donated: p.satsDonated, spent: p.satsSpent, minted: p.krayMinted, open: p.isOpen() }
  }

  /** One star by its creation number — everything a star page renders, or null if unborn. */
  star(no: bigint): StarView | null {
    const s: Star | null = this.ledger.stars.star(no)
    if (!s) return null
    const codex = this.ledger.stars.codexOf(no)
    return {
      no: s.no, owner: s.owner, by: s.by, id: s.id, seq: s.seq,
      name: s.name ?? null, contentHash: s.contentHash ?? null, contentType: s.contentType ?? null,
      parent: s.parent ?? null, children: this.ledger.stars.childrenOf(no),
      origin: s.origin ?? null,
      parents: s.parents ?? null, origins: s.origins ?? null,
      meta: s.meta ?? null,
      contract: s.contract ?? null,
      rarity: codex.rarity, collection: codex.collection, traits: codex.traits,
    }
  }

  starsOf(a: string): bigint[] { return this.ledger.stars.starsOf(a) }

  /** Every rune on the L2 — its reserve and its holders, for the explorer. */
  runes(): { runeId: string; reserve: bigint; holders: { address: string; amount: bigint }[] }[] {
    return this.ledger.runes.runes().map((rid) => ({
      runeId: `${rid.block}:${rid.tx}`,
      reserve: this.ledger.runes.reserveOf(rid),
      holders: this.ledger.runes.holders(rid).map((h) => ({ address: h.address, amount: h.amount })),
    }))
  }

  /** An address's rune L2 holdings — spendable, locked, and the BACKING split (personal vs pot). */
  runesOf(a: string): { runeId: string; amount: bigint; locked: bigint; personal: bigint; transferable: bigint }[] {
    const out: { runeId: string; amount: bigint; locked: bigint; personal: bigint; transferable: bigint }[] = []
    for (const rid of this.ledger.runes.runes()) {
      const amount = this.ledger.runes.balanceOf(rid, a)
      const locked = this.ledger.runes.lockedOf(rid, a)?.amount ?? 0n
      if (amount > 0n || locked > 0n) {
        out.push({
          runeId: `${rid.block}:${rid.tx}`, amount, locked,
          personal: this.ledger.runes.personalOf(rid, a),
          transferable: this.ledger.runes.transferableOf(rid, a),
        })
      }
    }
    return out
  }

  profile(a: string): ProfileView {
    const stars = this.starsOf(a)
    return { address: a, balance: this.balanceOf(a), nonce: this.nonceOf(a), stars, starCount: stars.length }
  }

  /** a contract's public view (creator + state), or null */
  contract(addr: string) { return this.ledger.contractAt(addr) }
  /** every deployed contract — for the DeFi explorer */
  contracts() { return this.ledger.allContractAddresses().map((a) => this.ledger.contractAt(a)) }

  ammPools() {
    const kray = this.ledger.amm.runeIds().map((runeId) => this.ammPool(runeId)).filter(Boolean)
    const rr = this.ledger.amm.rrPairs().map((p) => this.ammRrPool(p.a, p.b)).filter(Boolean)
    return [...kray, ...rr]
  }

  ammPool(runeId: string) {
    const id = canonicalRuneKey(runeId)
    if (!this.ledger.amm.exists(id)) return null
    const pot = ammPoolAddress(id)
    const rid = parseRuneKey(id)
    const kray = this.ledger.balanceOf(pot)
    const rune = this.ledger.runes.balanceOf(rid, pot)
    const supply = this.ledger.amm.supplyOf(id)
    return {
      kind: 'kray' as const, runeId: id, pot, krayReserve: kray.toString(), runeReserve: rune.toString(),
      lpSupply: supply.toString(), k: (kray * rune).toString(),
      holders: this.ledger.amm.holders(id).map((h) => ({
        address: h.address, lp: h.lp.toString(),
        share: supply > 0n ? Number((h.lp * 10000n) / supply) / 100 : 0,
      })),
    }
  }

  ammRrPool(runeA: string, runeB: string) {
    const pair = rrPairKey(runeA, runeB)
    if (!this.ledger.amm.existsRr(pair.a, pair.b)) return null
    const pot = ammRrPoolAddress(pair.a, pair.b)
    const ridA = parseRuneKey(pair.a)
    const ridB = parseRuneKey(pair.b)
    const a = this.ledger.runes.balanceOf(ridA, pot)
    const b = this.ledger.runes.balanceOf(ridB, pot)
    const supply = this.ledger.amm.supplyOfRr(pair.a, pair.b)
    return {
      kind: 'rr' as const, runeId: pair.a, otherRuneId: pair.b, pot,
      reserveA: a.toString(), reserveB: b.toString(),
      lpSupply: supply.toString(), k: (a * b).toString(),
      holders: this.ledger.amm.holdersRr(pair.a, pair.b).map((h) => ({
        address: h.address, lp: h.lp.toString(),
        share: supply > 0n ? Number((h.lp * 10000n) / supply) / 100 : 0,
      })),
    }
  }

  ammQuote(runeId: string, side: 'kray' | 'rune', amountIn: bigint) {
    const p = this.ammPool(runeId)
    if (!p) throw new Error('no pool for that rune')
    const kray = BigInt(p.krayReserve)
    const rune = BigInt(p.runeReserve)
    const out = side === 'kray' ? quoteOut(kray, rune, amountIn) : quoteOut(rune, kray, amountIn)
    return { op: 'swap', kind: 'kray' as const, runeId: p.runeId, side, amountIn: amountIn.toString(), amountOut: out.toString() }
  }

  ammQuoteAdd(runeId: string, krayIn: bigint, runeIn: bigint) {
    const id = canonicalRuneKey(runeId)
    if (!this.ledger.runes.knows(parseRuneKey(id))) {
      throw new Error(`${id} is not on this L2 — a pool cannot be quoted from a ghost`)
    }
    if (!this.ledger.amm.exists(id)) {
      const q = quoteFirstMint(krayIn, runeIn)
      return { op: 'add', kind: 'kray' as const, runeId: id, first: true, krayIn: krayIn.toString(), runeIn: runeIn.toString(), minted: q.minted.toString(), supply: q.supply.toString() }
    }
    const p = this.ammPool(id)
    if (!p) throw new Error('no pool for that rune')
    const q = quoteAdd(BigInt(p.krayReserve), BigInt(p.runeReserve), BigInt(p.lpSupply), krayIn, runeIn)
    return { op: 'add', kind: 'kray' as const, runeId: id, first: false, krayIn: krayIn.toString(), runeIn: runeIn.toString(), minted: q.minted.toString() }
  }

  ammQuoteRemove(runeId: string, lp: bigint) {
    const p = this.ammPool(runeId)
    if (!p) throw new Error('no pool for that rune')
    const q = quoteRemove(BigInt(p.krayReserve), BigInt(p.runeReserve), BigInt(p.lpSupply), lp)
    return { op: 'remove', kind: 'kray' as const, runeId: p.runeId, lp: lp.toString(), krayOut: q.krayOut.toString(), runeOut: q.runeOut.toString() }
  }

  ammRrQuote(runeA: string, runeB: string, payRuneId: string, amountIn: bigint) {
    const p = this.ammRrPool(runeA, runeB)
    if (!p) throw new Error('no rune/rune pool for that pair')
    const pay = canonicalRuneKey(payRuneId)
    if (pay !== p.runeId && pay !== p.otherRuneId) throw new Error('payRuneId must be one side of the pair')
    const rin = pay === p.runeId ? BigInt(p.reserveA) : BigInt(p.reserveB)
    const rout = pay === p.runeId ? BigInt(p.reserveB) : BigInt(p.reserveA)
    const out = quoteOut(rin, rout, amountIn)
    return { op: 'swap', kind: 'rr' as const, runeId: p.runeId, otherRuneId: p.otherRuneId, payRuneId: pay, amountIn: amountIn.toString(), amountOut: out.toString() }
  }

  ammRrQuoteAdd(runeA: string, runeB: string, amountA: bigint, amountB: bigint) {
    const pair = rrPairKey(runeA, runeB)
    if (!this.ledger.runes.knows(parseRuneKey(pair.a)) || !this.ledger.runes.knows(parseRuneKey(pair.b))) {
      throw new Error('a rune/rune pool needs two runes already on this L2')
    }
    const aIn = canonicalRuneKey(runeA) === pair.a ? amountA : amountB
    const bIn = canonicalRuneKey(runeA) === pair.a ? amountB : amountA
    if (!this.ledger.amm.existsRr(pair.a, pair.b)) {
      const q = quoteFirstMint(aIn, bIn)
      return { op: 'add', kind: 'rr' as const, runeId: pair.a, otherRuneId: pair.b, first: true, runeIn: aIn.toString(), otherIn: bIn.toString(), minted: q.minted.toString(), supply: q.supply.toString() }
    }
    const p = this.ammRrPool(pair.a, pair.b)
    if (!p) throw new Error('no rune/rune pool for that pair')
    const q = quoteAdd(BigInt(p.reserveA), BigInt(p.reserveB), BigInt(p.lpSupply), aIn, bIn)
    return { op: 'add', kind: 'rr' as const, runeId: pair.a, otherRuneId: pair.b, first: false, runeIn: aIn.toString(), otherIn: bIn.toString(), minted: q.minted.toString() }
  }

  ammRrQuoteRemove(runeA: string, runeB: string, lp: bigint) {
    const p = this.ammRrPool(runeA, runeB)
    if (!p) throw new Error('no rune/rune pool for that pair')
    const q = quoteRemove(BigInt(p.reserveA), BigInt(p.reserveB), BigInt(p.lpSupply), lp)
    return { op: 'remove', kind: 'rr' as const, runeId: p.runeId, otherRuneId: p.otherRuneId, lp: lp.toString(), runeOut: q.krayOut.toString(), otherOut: q.runeOut.toString() }
  }

  /** The whole-network summary a dashboard leads with. */
  overview() {
    return {
      network: this.network, seq: this.seq, head: this.head,
      cascadeRoot: this.cascadeRoot(),
      supply: this.supply(), pot: this.pot(),
      starCount: this.ledger.stars.starCount,
      bitcoinSeals: this.ledger.bitcoinSeals,
      conserves: this.conserves(), backed: this.backed(),
      // ADR-4 4a — the tip is canonical BY REPLAY the instant it exists (pure journal, no Bitcoin dependency).
      // This is the crane half only; anchor-confidence needs Bitcoin burial and is surfaced where that lives.
      craneFinality: craneFinality(this.cascadeRoot(), this.seq),
    }
  }
}
