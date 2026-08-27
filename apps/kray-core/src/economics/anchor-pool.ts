/**
 * THE VOLUNTARY ANCHOR POOL (VAP) — decentralized funding of the Bitcoin anchor.
 *
 * Founder's paradigm break: KRAY blocks run FAST and FREE (sealing a block is pure
 * local merkle — zero sats). Committing the consolidated CASCADE ROOT to Bitcoin
 * costs one tx fee in sats. Instead of a single funded anchor wallet (a central
 * dependency), ANYONE may volunteer sats to pay the anchor, and a FAIR, PUBLICLY
 * VERIFIABLE RANDOM DRAW picks who pays — exactly the spirit of KRILL's ceremony:
 * the system keeps running; the settlement waits for a willing payer and never loses.
 *
 * The four guarantees, all proven in anchor-pool.test.ts:
 *   1 · COALESCING  — there is ONE pending anchor target: the LATEST cascade root
 *       (which already consolidates all prior state). A backlog costs O(1), never
 *       O(n): one anchor seals everything accumulated at once.
 *   2 · FAIR DRAW   — the payer is drawn with an UNBIASABLE beacon (a Bitcoin block
 *       hash): pick = H(beacon|jobId|root|sortedVolunteers) mod n. Anyone recomputes
 *       it from public inputs; no one can rig it. `AnchorPool.pick` is static + pure.
 *   3 · PENDING-NEVER-LOST — empty pool → the job stays pending (blocks keep flowing).
 *       The instant a volunteer appears, the next draw includes them and it anchors.
 *       Over any horizon someone eventually volunteers → 10,000-year liveness.
 *   4 · GRIEF-PROOF + REWARDED — a drawn payer who fails to pay is EXCLUDED and the
 *       job re-draws (reconcile-or-HALT, KRILL-style); nothing lost, they just forfeit
 *       the reward. Only a CONFIRMED anchor (right root, real sats) earns the KRAY
 *       reward — so Sybil volunteers gain nothing (reward ∝ real sats actually spent).
 *
 * This module is the pure, deterministic WHO-PAYS logic (fully hermetic-testable).
 * The actual sat-spending ceremony (build/sign/broadcast the OP_RETURN tx) is the
 * job of `anchor/anchor.ts` (KrayAnchor) — the drawn payer runs it with their wallet.
 */
import { createHash } from 'node:crypto'

const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/** A volunteer's standing offer to pay anchor fees, in available satoshis. */
export interface Offer { address: string; sats: bigint; seq: number }
/** The single pending anchor target (the latest consolidated cascade root). */
export interface AnchorJob { jobId: number; root: string; height: number; failed: string[] }
/** A confirmed, rewarded anchor payment. */
export interface Settlement { jobId: number; payer: string; txid: string; sats: bigint; reward: bigint; root: string; height: number }
/**
 * THE REWARD IS FOR THE SERVICE, NOT FOR THE SPEND.
 *
 * It used to be `sats × perSat + premium`, and an adversarial economist found the
 * shape fatal rather than the constants: profit = P·min(sats+100, 10⁶) − sats, so
 * above one satoshi per KRAY the argmax jumps straight to sats = 999,900. The
 * rational volunteer would bid the Bitcoin fee to ~0.01 BTC per seal — roughly
 * 1.44 BTC a day at block cadence — as pure deadweight to Bitcoin miners, purely
 * to farm KRAY. Below parity, every volunteer loses on every seal. There is no
 * price at which a fee-proportional reward behaves, because paying MORE for
 * WASTING MORE is backwards at every valuation.
 *
 * What the network actually buys is binary: the root reached Bitcoin, or it did
 * not. So the reward is FLAT, and the arithmetic inverts:
 *
 *     profit = P · perAnchor − feeSats          strictly DECREASING in the fee
 *
 * The rational fee is now the minimum that confirms — at every price, with no
 * tuning — which is exactly what the network wants and exactly what the panel
 * already promises: offering more buys a fair chance, never influence and never a
 * larger reward. A standing offer becomes a declaration of CAPACITY (what I can
 * afford) rather than a bid, and the draw already filters candidates by the
 * minimum fee.
 *
 * `maxFeeSats` is a griefing guard, not a policy: an anchor costing more than
 * 0.01 BTC is not an anchor, it is a statement, and the network does not pay for
 * statements. It sits far above any honest fee, including a real spike.
 */
export interface RewardPolicy { perAnchor: bigint; maxFeeSats: bigint }
/** 0.01 BTC. Above this, `rewardFor` pays 0 — a statement, not an anchor. */
export const MAX_ANCHOR_FEE_SATS = 1_000_000n
export const DEFAULT_REWARD: RewardPolicy = { perAnchor: 100_000n, maxFeeSats: MAX_ANCHOR_FEE_SATS }

/** V5 (dormant): weight the anchor draw by sats offered (sybil-neutral) instead of uniform per address. The
 *  draw is a LIVE operator coordination, NOT replayed consensus (offers are not journaled), so this is a
 *  per-operator switch, not a seq-gate. Default false keeps today's uniform draw byte-identical; flip to true
 *  to activate the fix. See docs/RESIDUAL-VECTORS.md · V5. */
export const ANCHOR_DRAW_SATS_WEIGHTED = false

export function rewardFor(sats: bigint, p: RewardPolicy = DEFAULT_REWARD): bigint {
  if (sats <= 0n) return 0n // no fee paid means no anchor was bought
  if (sats > p.maxFeeSats) return 0n // beyond this it is deadweight, not a service
  return p.perAnchor
}

export class AnchorPool {
  private readonly offers = new Map<string, Offer>() // address → latest standing offer
  private job: AnchorJob | null = null // the single coalesced pending target
  private readonly settled: Settlement[] = []
  private nextJobId = 0
  private seq = 0

  /** Volunteer (or update) available sats. sats = 0 withdraws from the pool. */
  offer(address: string, sats: bigint): void {
    if (sats < 0n) throw new Error('anchor-pool: sats cannot be negative')
    if (sats === 0n) { this.offers.delete(address); return }
    this.offers.set(address, { address, sats, seq: this.seq++ })
  }

  /** The ready volunteers (sats ≥ minFee), minus any who already failed THIS job,
   *  in a deterministic order — the exact candidate list the draw commits to. */
  candidates(minFee: bigint): string[] {
    const failed = new Set(this.job?.failed ?? [])
    return [...this.offers.values()]
      .filter((o) => o.sats >= minFee && !failed.has(o.address))
      .map((o) => o.address)
      .sort()
  }

  /**
   * Advance the single pending anchor target to the latest cascade root. Called as
   * blocks accumulate — COALESCES, because the newest root already consolidates all
   * prior state, so a delayed anchor still seals the whole backlog in one commitment.
   */
  advance(root: string, height: number): number {
    if (!/^[0-9a-f]{64}$/i.test(root)) throw new Error('anchor-pool: root must be 32-byte hex')
    if (this.job === null) this.job = { jobId: this.nextJobId++, root: root.toLowerCase(), height, failed: [] }
    else { this.job.root = root.toLowerCase(); this.job.height = height } // coalesce, keep the same jobId + failed set
    return this.job.jobId
  }

  /** Is there a pending anchor waiting for a payer? */
  get pending(): AnchorJob | null { return this.job ? { ...this.job, failed: [...this.job.failed] } : null }

  /**
   * FAIR, VERIFIABLE DRAW — pick the payer for the pending job from a Bitcoin block
   * hash `beacon`. Returns the payer address, or null if the pool is empty (the job
   * stays pending — never lost). Pure function of public inputs: anyone re-runs
   * `AnchorPool.pick(beacon, jobId, root, candidates)` and gets the identical answer.
   */
  draw(beacon: string, minFee: bigint): string | null {
    if (this.job === null) return null
    const cands = this.candidates(minFee)
    // V5 (dormant): sats-weighted is sybil-neutral; uniform (default) is byte-identical to today.
    if (ANCHOR_DRAW_SATS_WEIGHTED) return AnchorPool.pickWeighted(beacon, this.job.jobId, this.job.root, cands, (a) => this.offers.get(a)?.sats ?? 0n)
    return AnchorPool.pick(beacon, this.job.jobId, this.job.root, cands)
  }

  /** The unbiasable selection itself — static + pure so any auditor can verify it. */
  static pick(beacon: string, jobId: number, root: string, sortedCandidates: string[]): string | null {
    if (sortedCandidates.length === 0) return null
    const h = sha256hex(`kray-anchor-draw|${beacon}|${jobId}|${root}|${sortedCandidates.join(',')}`)
    const idx = Number(BigInt('0x' + h.slice(0, 16)) % BigInt(sortedCandidates.length))
    return sortedCandidates[idx]
  }

  /**
   * SATS-WEIGHTED DRAW (the V5 fix) — chance proportional to sats OFFERED (the declared anchoring capacity),
   * so the draw is SYBIL-NEUTRAL: splitting one offer of S into K offers of S/K keeps the total interval S,
   * hence the same total probability. (Plain `pick` above is uniform per address, so K minFee identities beat
   * one K×minFee offer K-to-1 — same capital, K× the anchors; see docs/RESIDUAL-VECTORS.md · V5.) Still
   * unbiasable (the draw is fixed by the Bitcoin beacon) and pure. A zero/negative offer floors to 1 so the
   * modulus is never zero. The reward stays flat (`perAnchor`), so weighting changes WHO is picked, never HOW
   * MUCH they earn — a whale wins ∝ capacity but earns the same per anchor, and the anchor is a trustless
   * commodity (whoever pays, the root reaches Bitcoin and every node verifies it), so concentrating WHO pays
   * carries no power. Honest limit: offers are not escrowed, so a liar can over-offer to dominate ONE draw and
   * then fail — bounded, since `markFailed` excludes them and the job re-draws (one wasted pick, recoverable).
   */
  static pickWeighted(beacon: string, jobId: number, root: string, sortedCandidates: string[], satsOf: (address: string) => bigint): string | null {
    if (sortedCandidates.length === 0) return null
    const weights = sortedCandidates.map((a) => { const s = satsOf(a); return s > 0n ? s : 1n })
    const total = weights.reduce((a, b) => a + b, 0n)
    const draw = BigInt('0x' + sha256hex(`kray-anchor-draw.v2|${beacon}|${jobId}|${root}|${sortedCandidates.join(',')}`).slice(0, 16)) % total
    let acc = 0n
    for (let i = 0; i < sortedCandidates.length; i++) { acc += weights[i]; if (draw < acc) return sortedCandidates[i] }
    return sortedCandidates[sortedCandidates.length - 1]
  }

  /** The drawn payer failed to broadcast — exclude them and keep the job pending
   *  for a re-draw (reconcile, KRILL-style: nothing is lost, only their reward). */
  markFailed(payer: string): void {
    if (this.job && !this.job.failed.includes(payer)) this.job.failed.push(payer)
  }

  /**
   * An anchor from OUTSIDE the pool — a self-anchoring donation, or an operator seal — already carried the
   * pending root onto Bitcoin. The job is done and nobody here is owed a reward (the network bought nothing
   * from the pool). Clears the target ONLY on an exact root match, so a stale external seal can never cancel
   * a NEWER pending target that still needs anchoring.
   */
  satisfied(root: string): boolean {
    if (this.job === null || String(root).toLowerCase() !== this.job.root) return false
    this.job = null
    return true
  }

  /** Serializable snapshot of the whole pool (offers + pending job + settlements) — a node persists this
   *  across restarts so standing offers survive a reboot. Pure data; restore() reproduces an identical pool
   *  (same candidates, same draw, same jobId sequence — proven in anchor-backstop.test.ts). */
  snapshot(): unknown {
    return {
      offers: [...this.offers.values()].map((o) => ({ address: o.address, sats: o.sats.toString(), seq: o.seq })),
      job: this.job ? { ...this.job, failed: [...this.job.failed] } : null,
      settled: this.settled.map((s) => ({ ...s, sats: s.sats.toString(), reward: s.reward.toString() })),
      nextJobId: this.nextJobId,
      seq: this.seq,
    }
  }

  /** Rebuild a pool from snapshot(). Hostile-input hardened: a malformed snapshot yields an EMPTY pool
   *  (fail-closed — offers re-register; nothing of value depends on this file). */
  static restore(snap: unknown): AnchorPool {
    const pool = new AnchorPool()
    try {
      const s = snap as { offers?: unknown[]; job?: unknown; settled?: unknown[]; nextJobId?: number; seq?: number }
      if (!s || typeof s !== 'object') return pool
      for (const o of Array.isArray(s.offers) ? (s.offers as Array<{ address: string; sats: string; seq: number }>) : []) {
        if (o && typeof o.address === 'string' && /^\d+$/.test(String(o.sats))) pool.offers.set(o.address, { address: o.address, sats: BigInt(o.sats), seq: Number(o.seq) || 0 })
      }
      const j = s.job as { jobId: number; root: string; height: number; failed: string[] } | null
      if (j && Number.isInteger(j.jobId) && /^[0-9a-f]{64}$/i.test(String(j.root || ''))) {
        pool.job = { jobId: j.jobId, root: String(j.root).toLowerCase(), height: Number(j.height) || 0, failed: Array.isArray(j.failed) ? j.failed.filter((f) => typeof f === 'string') : [] }
      }
      for (const t of Array.isArray(s.settled) ? (s.settled as Array<Settlement & { sats: string; reward: string }>) : []) {
        if (t && /^[0-9a-f]{64}$/i.test(String(t.txid || '')) && /^\d+$/.test(String(t.sats)) && /^\d+$/.test(String(t.reward))) {
          pool.settled.push({ jobId: Number(t.jobId) || 0, payer: String(t.payer), txid: String(t.txid).toLowerCase(), sats: BigInt(t.sats), reward: BigInt(t.reward), root: String(t.root).toLowerCase(), height: Number(t.height) || 0 })
        }
      }
      pool.nextJobId = Number.isInteger(s.nextJobId) ? (s.nextJobId as number) : pool.settled.length + (pool.job ? 1 : 0)
      pool.seq = Number.isInteger(s.seq) ? (s.seq as number) : pool.offers.size
    } catch { return new AnchorPool() }
    return pool
  }

  /**
   * A payer's anchor tx CONFIRMED with the correct root — settle the job, reward the
   * payer (∝ real sats spent), and clear the pending target. `root` MUST equal the
   * pending job's root (the auditor's readback check) or the settlement is refused —
   * so no fake/underpaying tx can claim a reward. Returns the recorded Settlement.
   */
  settle(payer: string, txid: string, sats: bigint, root: string, policy: RewardPolicy = DEFAULT_REWARD): Settlement {
    if (this.job === null) throw new Error('anchor-pool: no pending anchor to settle')
    if (root.toLowerCase() !== this.job.root) throw new Error('anchor-pool: settlement root does not match the pending cascade root — refused')
    if (sats <= 0n) throw new Error('anchor-pool: a real (positive) sat fee must have been paid')
    if (!/^[0-9a-f]{64}$/i.test(txid)) throw new Error('anchor-pool: txid must be a 32-byte hex')
    const s: Settlement = { jobId: this.job.jobId, payer, txid: txid.toLowerCase(), sats, reward: rewardFor(sats, policy), root: this.job.root, height: this.job.height }
    this.settled.push(s)
    this.job = null // the whole backlog up to this root is now sealed on Bitcoin
    return s
  }

  /** All confirmed anchor settlements, in order. */
  settlements(): Settlement[] { return [...this.settled] }
  get settledCount(): number { return this.settled.length }
  /** Σ KRAY paid out to volunteer anchor-payers. */
  totalRewarded(): bigint { return this.settled.reduce((a, s) => a + s.reward, 0n) }
  /** Σ satoshis volunteers have actually spent anchoring KRAY to Bitcoin. */
  totalSatsPaid(): bigint { return this.settled.reduce((a, s) => a + s.sats, 0n) }
  readyCount(minFee: bigint): number { return this.candidates(minFee).length }

  /** Anchorable merkle root of the pool state — the settled anchors + pending target,
   *  so the VAP's own history is itself Bitcoin-sealable, born indexed. */
  merkleRoot(): string {
    const leaves: string[] = []
    for (const s of this.settled) leaves.push(sha256hex(`vap|${s.jobId}|${s.payer}|${s.txid}|${s.sats}|${s.reward}|${s.root}|${s.height}`))
    if (this.job) leaves.push(sha256hex(`vap-pending|${this.job.jobId}|${this.job.root}|${this.job.height}|${[...this.job.failed].sort().join(',')}`))
    if (leaves.length === 0) return sha256hex('kray-anchor-pool-empty')
    let level = leaves
    while (level.length > 1) {
      const next: string[] = []
      for (let i = 0; i < level.length; i += 2) next.push(sha256hex(level[i] + (i + 1 < level.length ? level[i + 1] : level[i])))
      level = next
    }
    return level[0]
  }
}
