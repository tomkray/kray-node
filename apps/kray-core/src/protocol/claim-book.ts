/**
 * THE CLAIM ESCROW — one signature opens a harvest, and every hand that can prove its share takes it once.
 *
 * The Creator, 2026-09-20: *"tudo que nós criarmos no game vai ser token com prova matemática, ou em runes
 * L2 ou em luz… o objetivo é que tenhamos um escrow que possamos fazer isso de forma matematicamente segura:
 * quando o usuário de fato conquistar no game a asset, ele pode fazer o claim daquele token."*
 *
 * THE HONEST FRAME. No mathematics can know that somebody watered a bed — the chain cannot see the game, and
 * saying otherwise would be a lie dressed as a proof. What the chain CAN make irrefutable is everything
 * around that fact, and it is most of what matters:
 *
 *   · WHO attested — a BIP-340 signature over the exact root, so the attestation has an author forever;
 *   · WHAT they attested — the root is in the signed bytes, so the list cannot be edited afterwards;
 *   · that the promise is COVERED — the total leaves the giver's hand at the open, into a keyless pot;
 *   · that nobody is paid TWICE — a leaf is spendable once, and the chain commits who has taken;
 *   · that nobody is paid MORE than their leaf, or by anyone but the pot;
 *   · that a proven hand CANNOT be refused while the pot holds their share.
 *
 * The attestation itself is checkable off-chain by anyone: a land's farm is a pure reducer over a request
 * log, so a stranger replays it, recomputes the tally, rebuilds this root, and compares. A giver who signs a
 * root their own journal does not produce is caught by arithmetic, in public, forever.
 *
 * CUSTODY IS REAL HERE, unlike the packet market. A drop is a standing offer; a harvest is a promise to many
 * hands at once, and a promise that can be spent from behind is not a promise. `claim-open` moves the whole
 * total into `KRAY_CLAIM` — a keyless label no signature can ever reach — and only these three acts move it
 * out: a proven take, or the giver's own close after the height they named.
 */
import { createHash } from 'node:crypto'
import { buildMerkleRoot, merkleProof, verifyMerkleProof, type MerkleStep } from './block.ts'
import type { PacketLane } from './packet-market.ts'

/** The keyless pot every open harvest rests in. `KRAY_`-prefixed, so no key encodes to it, ever. */
export const CLAIM_POT = 'KRAY_CLAIM'

/** THE CLAIM ESCROW pin, per network — regtest is born with it; signet and main wait for their whole fleet.
 *  Below the pin every claim act is refused, so no pot fills, no root grows and no era forks (A3). */
export const CLAIM_ESCROW_SEQ: Record<string, number> = {
  regtest: 0,
  signet: 231,                          // ratified 2026-09-21 with the gift and the packet market
  // RATIFIED 2026-09-22 — main tip 81, so 82: the house's own rite, the same one POT_BINDING_SEQ used on
  // this very network (81→82). Opened at the tip's next act so the activation is ONE explicit, auditable
  // instant. All five market pins take this seq TOGETHER — the gift, the packet market, the claim escrow,
  // the mint, and the ungrindable tiebreak that must never lag behind them. signet carried every one of
  // them end to end first (opened, taken by more than one hand, and CLOSED), measured by scripts/mainnet-gate.mjs.
  main: 82,
}

/** THE MINT DROP pin, per network. A mint is a harvest whose root commits TERMS instead of NAMES, so
 *  below this pin `mint-open` and `mint-take` do not exist and an old node FREEZES rather than forks (A3).
 *  Mainnet has never opened a harvest or a drop — when its market opens, this is set to the SAME seq as
 *  PACKET_MARKET_SEQ and CLAIM_ESCROW_SEQ and the network begins with the whole law at once. */
export const MINT_DROP_SEQ: Record<string, number> = {
  regtest: 0,
  signet: 243,                          // ratified 2026-09-22 at seq 243 — the suites, the mint stampede and the
                                        // face were green, and the fleet carried the code before the pin moved
  // RATIFIED 2026-09-22 — main tip 81, so 82: the house's own rite, the same one POT_BINDING_SEQ used on
  // this very network (81→82). Opened at the tip's next act so the activation is ONE explicit, auditable
  // instant. All five market pins take this seq TOGETHER — the gift, the packet market, the claim escrow,
  // the mint, and the ungrindable tiebreak that must never lag behind them. signet carried every one of
  // them end to end first (opened, taken by more than one hand, and CLOSED), measured by scripts/mainnet-gate.mjs.
  main: 82,
}

/** A harvest may name at most this many hands. Bounded because the giver pays one fee for all of them, and
 *  an unbounded list would let one act commit a tree nobody can hold in memory to prove against. */
export const CLAIM_MAX_HANDS = 100_000
/** The proof a taker carries: log2(100,000) ≈ 17 steps, so 40 is slack, not a limit anyone meets honestly. */
export const CLAIM_MAX_PROOF = 40

export interface ClaimShare { readonly to: string; readonly amount: bigint }

export interface Claim {
  readonly giver: string
  readonly lane: PacketLane
  readonly asset: string
  /** What the giver escrowed, in the lane's own units. */
  readonly total: bigint
  /** What proven hands have taken so far. `total - paid` is what the pot still owes this root. */
  readonly paid: bigint
  /** The Bitcoin height at or after which the giver may close what is left. 0 = never; the pot keeps it. */
  readonly expires: number
  /** Every hand that has taken, chained in journal order — O(1) to extend, and it commits the whole list. */
  readonly takenChain: string
  /** True when this season draws on a STANDING POOL: its money came from the pool and its leftovers go
   *  back to the pool rather than to the giver's hand (see pool-book.ts). */
  readonly fromPool: boolean
  /** A MINT, present only when this is one. A harvest commits a list of names; a mint commits terms —
   *  `hands` pots of `perHand` each, one to any hand that has not taken, while pots remain. Absent on
   *  every harvest, which is what keeps the commitment of a chain with no mints byte-identical. */
  readonly mint?: MintTerms
}

/** What a mint promises. `total` is always exactly `perHand × hands` — computed, never supplied. */
export interface MintTerms {
  readonly perHand: bigint
  readonly hands: number
  /** The gate, or null for a public mint. `childOf` names a LAND: any hand holding a star whose parent is
   *  that star may take one pot. A single-star gate is refused at the door — see the design doc. */
  readonly gate: { readonly kind: 'childOf'; readonly star: bigint } | null
}

const H = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
export const NO_HANDS = '0'.repeat(64)

/**
 * THE LEAF — one hand, one amount, in a line that can be nothing else. Domain-separated by its own label,
 * and then again by `block.ts`'s `\x00` leaf prefix, so a leaf can never be read as an inner node nor as any
 * other kind of line in this protocol.
 */
export function claimLeaf(to: string, amount: bigint): string {
  return `kray-core.claim.leaf.v1|to=${to}|amount=${amount}`
}

/**
 * THE MINT ID. A harvest's root is a Merkle root; a mint's is a hash of its own terms, so a stranger
 * recomputes it from what was signed and checks the chain holds it.
 *
 * IT CANNOT COLLIDE WITH A HARVEST ROOT, and not merely because the label differs: `block.ts` prefixes
 * every hash it takes (`hashLeaf = H('\x00' + raw)`, `hashNode = H('\x01' + a + b)`), so EVERY harvest
 * root is sha256 of a preimage whose first byte is 0x00 or 0x01. This preimage's first byte is 'k'. The
 * two spaces are disjoint by construction — there is no structured collision to look for.
 */
export function mintId(
  network: string, giver: string, lane: PacketLane, asset: string,
  perHand: bigint, hands: number, gate: MintTerms['gate'], nonce: number,
): string {
  const g = gate === null ? 'none' : `childOf:${gate.star}`
  return H(`kray-core.mint.id.v1|net=${network}|giver=${giver}|lane=${lane}|asset=${asset}`
    + `|perHand=${perHand}|hands=${hands}|gate=${g}|nonce=${nonce}`)
}

/** The root of a harvest. The shares are taken IN THE ORDER GIVEN — the giver's list is the giver's list. */
export function claimRoot(shares: readonly ClaimShare[]): string {
  return buildMerkleRoot(shares.map((s) => claimLeaf(s.to, s.amount)))
}

/** The path one hand needs to prove its share. Built by whoever publishes the list, never by the chain. */
export function claimProof(shares: readonly ClaimShare[], index: number): MerkleStep[] {
  return merkleProof(shares.map((s) => claimLeaf(s.to, s.amount)), index)
}

/** Is this hand's share really in that root? The whole of the chain's verdict on a claim. */
export function claimProves(root: string, to: string, amount: bigint, proof: readonly MerkleStep[]): boolean {
  if (!/^[0-9a-f]{64}$/.test(root)) return false
  if (proof.length > CLAIM_MAX_PROOF) return false
  for (const step of proof) if (typeof step?.hash !== 'string' || !/^[0-9a-f]{64}$/.test(step.hash) || typeof step.siblingIsRight !== 'boolean') return false
  return verifyMerkleProof(claimLeaf(to, amount), proof as MerkleStep[], root)
}

export class ClaimBook {
  private readonly open = new Map<string, Claim>()          // root → the harvest it opened
  private readonly taken = new Map<string, Set<string>>()   // root → the hands that have taken
  private _commitment: string | null = null

  get size(): number { return this.open.size }
  empty(): boolean { return this.open.size === 0 }

  /** The live harvest at that root, or null — a copy, so no caller edits the book by holding its row. */
  get(root: string): Claim | null {
    const c = this.open.get(root)
    return c ? { ...c } : null
  }
  /** Has this hand already taken from that root? One leaf, one taking, forever. */
  hasTaken(root: string, to: string): boolean {
    return this.taken.get(root)?.has(to) === true
  }
  /** What the pot still owes this root. */
  owed(root: string): bigint {
    const c = this.open.get(root)
    return c ? c.total - c.paid : 0n
  }
  /**
   * What the pot owes open harvests of one lane and asset — the tripwire's other side. A season drawn on a
   * STANDING POOL is excluded: its value is already counted in that pool's `held`, and counting it twice
   * would trip the very wire it is meant to prove.
   */
  owedIn(lane: PacketLane, asset: string, opts: { readonly poolBacked?: boolean } = {}): bigint {
    let sum = 0n
    for (const c of this.open.values()) {
      if (c.lane !== lane || c.asset !== asset) continue
      if (opts.poolBacked !== undefined && c.fromPool !== opts.poolBacked) continue
      sum += c.total - c.paid
    }
    return sum
  }
  /** Every lane and asset any open harvest touches, so a tripwire can walk them all. */
  assets(): Array<{ lane: PacketLane; asset: string }> {
    const seen = new Map<string, { lane: PacketLane; asset: string }>()
    for (const c of this.open.values()) seen.set(`${c.lane}|${c.asset}`, { lane: c.lane, asset: c.asset })
    return [...seen.values()]
  }

  /** Every live harvest, for a reader — canonical order, so two nodes print the same page. */
  all(): Array<{ root: string; giver: string; lane: string; asset: string; total: string; paid: string; expires: number; hands: number }> {
    return [...this.open.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([root, c]) => ({
        root, giver: c.giver, lane: c.lane, asset: c.asset,
        total: c.total.toString(), paid: c.paid.toString(), expires: c.expires,
        fromPool: c.fromPool, hands: this.taken.get(root)?.size ?? 0,
        ...(c.mint ? { mint: {
          perHand: c.mint.perHand.toString(),
          pots: c.mint.hands,
          potsLeft: Math.max(0, c.mint.hands - (this.taken.get(root)?.size ?? 0)),
          gate: c.mint.gate === null ? null : { kind: 'childOf', star: c.mint.gate.star.toString() },
        } } : {}),
      }))
  }

  /** Open a harvest. The reducer has ALREADY proven the giver held it and moved it into the pot. */
  openClaim(root: string, giver: string, lane: PacketLane, asset: string, total: bigint, expires: number, fromPool = false): void {
    this._commitment = null
    this.open.set(root, { giver, lane, asset, total, paid: 0n, expires, takenChain: NO_HANDS, fromPool })
  }

  /**
   * Open a MINT. The reducer has ALREADY proven the giver held `perHand × hands` and moved it into the pot.
   * `total` is computed here from the terms and never accepted from a caller — a mint that promises a
   * different number than its own arithmetic is not a thing this book can represent.
   */
  openMint(root: string, giver: string, lane: PacketLane, asset: string, terms: MintTerms, expires: number): void {
    this._commitment = null
    const total = terms.perHand * BigInt(terms.hands)
    this.open.set(root, { giver, lane, asset, total, paid: 0n, expires, takenChain: NO_HANDS, fromPool: false, mint: terms })
  }

  /** How many pots of a mint are still unclaimed. Not a view: the cap the reducer itself enforces. */
  potsLeft(root: string): number {
    const c = this.open.get(root)
    if (!c || !c.mint) return 0
    return Math.max(0, c.mint.hands - (this.taken.get(root)?.size ?? 0))
  }

  /** A proven hand takes its share, once. The reducer has ALREADY verified the proof and paid from the pot. */
  take(root: string, to: string, amount: bigint): void {
    const c = this.open.get(root)
    if (!c) throw new Error('claim-book: no such harvest')
    if (this.hasTaken(root, to)) throw new Error('claim-book: that hand has already taken')
    if (c.mint) {
      // THE CAP, in the book itself. `paid + amount > total` would catch it too, but only as arithmetic;
      // a mint's promise is COUNTED, and the count is the thing a stampede races for.
      if ((this.taken.get(root)?.size ?? 0) >= c.mint.hands) throw new Error('claim-book: every pot of that mint is taken')
      if (amount !== c.mint.perHand) throw new Error('claim-book: a mint pays one whole pot, never a part of one')
    }
    if (c.paid + amount > c.total) throw new Error('claim-book: a harvest cannot pay more than it holds')
    this._commitment = null
    // The chain of hands is order-dependent, and journal order is the same on every node — so this commits
    // WHO has taken, and in what order, for one hash of work per take rather than a rebuilt list.
    this.open.set(root, { ...c, paid: c.paid + amount, takenChain: H(`${c.takenChain}|${to}|${amount}`) })
    const set = this.taken.get(root) ?? new Set<string>()
    set.add(to)
    this.taken.set(root, set)
  }

  /** The giver closes what is left after the height they named. The reducer has ALREADY paid them back. */
  close(root: string): void {
    this._commitment = null
    this.open.delete(root)
    this.taken.delete(root)
  }

  /**
   * The book's committed value for the cascade root — sorted by root, each line naming the harvest, what it
   * has paid, and the chain of hands that took it. Remembered until a write, because `cascadeRoot()` runs
   * after every accepted act and a rebuilt string would tax the whole chain.
   */
  commitment(): string {
    if (this._commitment !== null) return this._commitment
    this._commitment = [...this.open.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      // FOLDED BY PRESENCE. A mint appends its terms; a harvest appends NOTHING, so a chain that carries
      // no mint hashes byte for byte what it hashes today. That is what lets this enter the cascade root
      // without moving a single live harvest — signet's 242/242 cold replay must not shift by one bit.
      .map(([root, c]) => `${root}|${c.giver}|${c.lane}|${c.asset}|${c.total}|${c.paid}|${c.expires}|${c.takenChain}|${c.fromPool ? 'pool' : 'hand'}`
        + (c.mint ? `|mint=${c.mint.perHand}x${c.mint.hands}|gate=${c.mint.gate === null ? 'none' : `childOf:${c.mint.gate.star}`}` : ''))
      .join('\n')
    return this._commitment
  }
}

/** The line a giver signs to open a harvest. Every field is in it, so no relay can change one. */
export function claimOpenMessage(network: string, from: string, lane: PacketLane, asset: string, total: bigint, root: string, expires: number, nonce: number): string {
  return `kray-core.claim-open.v1|net=${network}|from=${from}|lane=${lane}|asset=${asset}|total=${total}|root=${root}|expires=${expires}|nonce=${nonce}`
}
/** The line a hand signs to take its share. The PROOF is not signed — it proves itself against the root, and
 *  a tampered path simply fails to rebuild it (a witness, exactly like an SPV bag). */
export function claimTakeMessage(network: string, from: string, root: string, amount: bigint, nonce: number): string {
  return `kray-core.claim-take.v1|net=${network}|from=${from}|root=${root}|amount=${amount}|nonce=${nonce}`
}
/** The line a giver signs to take back what no hand claimed. */
/**
 * WHAT A GIVER SIGNS TO OPEN A MINT. Every term that decides a payout is in the line, so the id derived
 * from it is the id the chain holds — nothing about the promise can be edited after the signature.
 */
export function mintOpenMessage(
  network: string, from: string, lane: PacketLane, asset: string,
  perHand: bigint, hands: number, gate: MintTerms['gate'], expires: number, nonce: number,
): string {
  const g = gate === null ? 'none' : `childOf:${gate.star}`
  return `kray-core.mint-open.v1|net=${network}|from=${from}|lane=${lane}|asset=${asset}`
    + `|perHand=${perHand}|hands=${hands}|gate=${g}|expires=${expires}|nonce=${nonce}`
}

/**
 * WHAT A HAND SIGNS TO TAKE ONE POT. THERE IS NO AMOUNT IN THIS LINE — it cannot be haggled, because the
 * payout comes from the terms the giver signed, not from anything the taker says. `star` is present only
 * for a gated mint and names the star the taker claims to hold; the reducer proves owner and parent.
 */
export function mintTakeMessage(network: string, from: string, root: string, star: bigint | null, nonce: number): string {
  return `kray-core.mint-take.v1|net=${network}|from=${from}|root=${root}|star=${star === null ? 'none' : star}|nonce=${nonce}`
}

export function claimCloseMessage(network: string, from: string, root: string, nonce: number): string {
  return `kray-core.claim-close.v1|net=${network}|from=${from}|root=${root}|nonce=${nonce}`
}
