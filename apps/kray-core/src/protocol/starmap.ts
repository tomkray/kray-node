/**
 * The Star Registry — a star is BORN from fire.
 *
 * KRAYNET is a DUAL system:
 *   - KRAY is fungible fuel — a plain balance in the ledger. No numbers, no ranges,
 *     no FIFO. It moves as an amount, like Bitcoin.
 *   - A STAR is a non-fungible creation. It does not exist until someone CREATES it:
 *     an inscribe / origin / baptism BURNS 1 ₭ (in the ledger) and this registry mints
 *     the star, numbered by CREATION ORDER. There is no "own a star before writing" —
 *     the star is born from the act. One number: the creation number IS the star, and
 *     the inscription id `<signed event hash>i<index>` is its provenance (A10).
 *
 * DERIVED, NEVER AUTHORITATIVE: the ledger's fungible balances and its emit−burn
 * conservation are the source of truth. This registry tracks the created stars, is a
 * pure function of the journal, and re-derives byte-exact on every node.
 *
 * Design note: each creative act (inscribe / origin / name) mints its OWN star. A
 * content star and a named star are distinct creations. A future refinement may allow
 * one act to carry both content and a name; kept separate here for a clean,
 * born-from-fire core.
 */
import { createHash } from 'node:crypto'
import { readName, type NameReading } from './library.ts'
import {
  canonicalName, isValidName, starCollection, starTraits,
  type Inscription, type Baptism, type StarCollection, type StarTrait,
} from './star-lore.ts'
import type { KrayEvent } from './kray-primitives.ts'
import { canonicalCode, contractAddress } from './contract.ts'

const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/** v4 metadata — the exact JSON bytes, or absent (A3). */
function sealedMeta(e: KrayEvent): { meta?: string } {
  return e.meta && e.meta.length ? { meta: e.meta } : {}
}

/** Rarity — by CREATION ORDER: the earliest creations are the rarest. There is no
 *  emission schedule to grade against, so the first star is mythic and the founding
 *  galleries are the sacred early acts. */
export type StarRarity = 'mythic' | 'legendary' | 'epic' | 'rare' | 'uncommon' | 'common'
export function starRarity(no: bigint): StarRarity {
  if (no < 1n) return 'mythic'            // #0 — the first thing ever written
  if (no < 10n) return 'legendary'        // the first ten
  if (no < 100n) return 'epic'            // the founders' row
  if (no < 1_000n) return 'rare'
  if (no < 10_000n) return 'uncommon'
  return 'common'
}

/** A created star — the one identity is its creation number `no`. */
export interface Star {
  no: bigint
  owner: string
  id: string                 // `<signed event hash>i0` — the ordinals shape, derived from the signed act (A10)
  seq: number                // the journal event that created it
  by: string                 // the creator (immortal)
  contentHash?: string
  contentType?: string
  size?: number
  contentId?: string         // the CONTENT's own inscription id (`<inscribe hash>i0`); == id when born with content,
                             // distinct when content was added later onto a star born from a baptism
  name?: string              // display: the first writer's exact bytes, forever
  parent?: bigint            // KRAY family tree (a created star this author also owns)
  origin?: { l1InscriptionId: string; l1Txid: string } // L1 ordinals provenance
  /** MULTIPARENT (message v3) — the full signed lineage, order as signed. When present,
   *  `parent`/`origin` carry the FIRST element (scalar meaning never changes). Absent on
   *  every pre-v3 star, so every legacy merkle line stays byte-identical forever. */
  parents?: bigint[]
  origins?: { l1InscriptionId: string; l1Txid: string }[]
  /** Free JSON sealed with the inscription (v4). Absent on every pre-v4 star. */
  meta?: string
  /** Living law — keyless pot address. Absent on every star that never received a v2 contract. */
  contract?: string
}

export class StarRegistry {
  private readonly stars = new Map<string, Star>()          // creationNo → star
  private nextNo = 0n                                        // the creation counter (the star's number)
  private readonly contentSeen = new Map<string, string>()  // contentHash → creationNo (byte-unique forever)
  private readonly bodySeen = new Map<string, string>()     // bodyHash → creationNo (skeleton-unique; v5)
  private readonly nameToStar = new Map<string, string>()   // canonical name → creationNo
  private readonly starToName = new Map<string, string>()   // creationNo → display name
  private readonly children = new Map<string, string[]>()   // parentNo → child creationNos
  /** Bitcoin L1 inscription id → KRAY children. Same index as `children`, other blood. */
  private readonly originChildren = new Map<string, string[]>()
  private readonly byOwner = new Map<string, Set<string>>() // owner → creationNos held now
  private readonly allInscriptions: Inscription[] = []      // history (cursed included, flagged)
  private readonly allBaptisms: Baptism[] = []
  private readonly inscriptionById = new Map<string, Inscription>()
  private lastAppliedSeq = 0
  private rootCache: string | null = null

  // ── ownership index helpers ───────────────────────────────────────────────
  private own(owner: string, no: string): void {
    let s = this.byOwner.get(owner); if (!s) { s = new Set(); this.byOwner.set(owner, s) }
    s.add(no)
  }
  private disown(owner: string, no: string): void {
    const s = this.byOwner.get(owner); if (s) { s.delete(no); if (!s.size) this.byOwner.delete(owner) }
  }

  // ── THE APPLY — a pure function of the journal ─────────────────────────────
  // Only the CREATIVE and the STAR-MOVING events touch the registry. Every fungible
  // ₭ event (transfer, emit, reward, rune-send, contract-call, settlement…) moves no
  // star and is a no-op here: KRAY lives in the ledger, not the registry.
  applyLive(e: KrayEvent, hint?: { mintParents?: readonly string[] }): void {
    if (e.seq <= this.lastAppliedSeq) return
    switch (e.kind) {
      case 'inscribe':
      case 'origin':
        // e.star set (inscribe only) → add content to an existing owned star; else a new star is born
        if (e.kind === 'inscribe' && e.star != null) this.addContentToStar(e)
        else this.createContentStar(e, hint?.mintParents)
        break
      case 'name':
        // e.star set → baptise an existing owned star; else a new star is born carrying the name
        if (e.star != null) this.addNameToStar(e)
        else this.createNamedStar(e)
        break
      case 'transfer-star':
        this.moveStar(e)
        break
      case 'star-buy':
        // THE ATOMIC BUY (star leg) — the ledger has already proven the seller (e.to) is the current owner and
        // debited/credited the ₭; here the star moves from its current owner to the BUYER (e.from). Armor: only
        // a star the seller actually holds moves (a stale buy never reaches here — the ledger refuses it first).
        this.moveStarTo(e)
        break
      case 'star-offer-accept':
        // Owner (e.from) accepted bidder (e.to) — same move as transfer-star. Ledger already paid from the pot.
        this.moveStar(e)
        break
      case 'contract':
        // v2 only: e.star set. The pot address is derived here the same way the ledger does.
        // Transfer of the star does NOT move the pot (moveStar never touches this pointer).
        this.bindLawToStar(e)
        break
      default:
        // every other kind carries no star — nothing to do (KRAY is fungible in the ledger)
        break
    }
    this.lastAppliedSeq = e.seq
    this.rootCache = null
  }

  /** inscribe / origin — a star is born carrying content. */
  private createContentStar(e: KrayEvent, mintParents?: readonly string[]): void {
    const duplicate = this.contentSeen.has(e.contentHash!) || !!(e.bodyHash && this.bodySeen.has(e.bodyHash))
    // MULTIPARENT (v3): the signed lists, order as signed; the scalar path is the frozen v2.
    // EVERY declared KRAY parent must be a created star this author owns — unless the
    // ledger already ran the mint blessing on that face (hint.mintParents). One bad
    // parent curses the whole act. The hint is replay-identical: only the reducer
    // calls applyLive, after runCall('mint').
    const listParents = e.parents !== undefined ? e.parents.map((p) => BigInt(p).toString()) : undefined
    const listOrigins = e.origins !== undefined ? e.origins.map((id) => ({ l1InscriptionId: id, l1Txid: id.split('i')[0] })) : undefined
    const scalarParent = e.parent !== undefined ? BigInt(e.parent).toString() : undefined
    const claimedParents = listParents ?? (scalarParent !== undefined ? [scalarParent] : [])
    const blessed = new Set(mintParents ?? [])
    const badParent = claimedParents.some((p) => {
      const st = this.stars.get(p)
      if (!st) return true
      if (st.owner === e.from) return false
      return !blessed.has(p)
    })
    const cursed = duplicate || badParent
    const no = cursed ? undefined : this.nextNo
    const noKey = no !== undefined ? no.toString() : ''
    const isOrigin = e.kind === 'origin'
    const revealTxid = isOrigin ? e.l1InscriptionId!.split('i')[0] : undefined
    // scalar fields keep their meaning forever: FIRST parent / FIRST origin (parity law)
    const firstParent = badParent ? undefined : claimedParents[0]
    const firstOrigin = isOrigin ? { l1InscriptionId: e.l1InscriptionId!, l1Txid: revealTxid! } : listOrigins?.[0]
    const ins: Inscription = {
      star: noKey, id: `${e.hash}i0`,
      number: cursed ? undefined : Number(this.nextNo),
      contentHash: e.contentHash!, contentType: e.contentType ?? 'application/octet-stream',
      size: e.size!, seq: e.seq, by: e.from!,
      parent: firstParent,
      origin: firstOrigin,
      parents: badParent ? undefined : listParents,
      origins: listOrigins,
      ...sealedMeta(e),
      cursed, cursedReason: duplicate ? 'duplicate' : badParent ? 'badparent' : undefined,
    }
    this.allInscriptions.push(ins)
    if (cursed) return
    this.stars.set(noKey, {
      no: this.nextNo, owner: e.from!, id: ins.id, seq: e.seq, by: e.from!,
      contentHash: e.contentHash!, contentType: ins.contentType, size: e.size!, contentId: ins.id,
      parent: firstParent !== undefined ? BigInt(firstParent) : undefined,
      origin: firstOrigin,
      parents: listParents !== undefined ? listParents.map((p) => BigInt(p)) : undefined,
      origins: listOrigins,
      ...sealedMeta(e),
    })
    this.own(e.from!, noKey)
    this.inscriptionById.set(ins.id, ins)
    this.contentSeen.set(e.contentHash!, noKey)         // these bytes are unique forever
    if (e.bodyHash) this.bodySeen.set(e.bodyHash, noKey) // this skeleton is unique forever (v5)
    for (const p of claimedParents) {                    // a multiparent child shines under EVERY parent
      const kids = this.children.get(p) ?? []; kids.push(noKey); this.children.set(p, kids)
    }
    const originKeys = listOrigins && listOrigins.length
      ? listOrigins.map((o) => o.l1InscriptionId.toLowerCase())
      : (firstOrigin ? [firstOrigin.l1InscriptionId.toLowerCase()] : [])
    for (const id of new Set(originKeys)) {
      const kids = this.originChildren.get(id) ?? []
      kids.push(noKey)
      this.originChildren.set(id, kids)
    }
    this.nextNo += 1n
  }

  /** baptism — a star is born carrying a name, unique in the universe forever. */
  private createNamedStar(e: KrayEvent): void {
    const invalid = !isValidName(e.name!)
    const canon = invalid ? '' : canonicalName(e.name!)
    const nameTaken = !invalid && this.nameToStar.has(canon)
    const impersonates = !invalid && !nameTaken && this.impersonates(e.name!) !== null
    const cursed = invalid || nameTaken || impersonates
    const noKey = cursed ? '' : this.nextNo.toString()
    const bap: Baptism = {
      star: noKey, name: e.name!, seq: e.seq, by: e.from!,
      cursed, cursedReason: invalid ? 'invalid-name' : nameTaken ? 'name-taken' : impersonates ? 'impersonates' : undefined,
    }
    this.allBaptisms.push(bap)
    if (cursed) return
    this.stars.set(noKey, { no: this.nextNo, owner: e.from!, id: `${e.hash}i0`, seq: e.seq, by: e.from!, name: e.name! })
    this.own(e.from!, noKey)
    this.nameToStar.set(canon, noKey)                    // identity key: the universal-keyboard form
    this.starToName.set(noKey, e.name!)                  // display: first writer's exact bytes
    this.nextNo += 1n
  }

  /** transfer-star — a created star travels whole to a new owner (the NFT move). */
  /** ADD CONTENT onto a star that already exists (born earlier from a baptism) — SAME number + birth id.
   *  The content is a new signed inscription with its OWN id; the star keeps its identity and gains a
   *  contentHash. No new star is born (nextNo does not advance). The ledger already checked ownership +
   *  that the star had no content; the guard here is belt-and-suspenders for a hostile replay. */
  private addContentToStar(e: KrayEvent): void {
    const noKey = BigInt(e.star!).toString()
    const st = this.stars.get(noKey)
    if (!st || st.owner !== e.from || st.contentHash) return
    const duplicate = this.contentSeen.has(e.contentHash!) || !!(e.bodyHash && this.bodySeen.has(e.bodyHash))
    const ins: Inscription = {
      star: duplicate ? '' : noKey, id: `${e.hash}i0`,
      number: duplicate ? undefined : Number(st.no),
      contentHash: e.contentHash!, contentType: e.contentType ?? 'application/octet-stream',
      size: e.size!, seq: e.seq, by: e.from!,
      ...sealedMeta(e),
      cursed: duplicate, cursedReason: duplicate ? 'duplicate' : undefined,
    }
    this.allInscriptions.push(ins)
    if (duplicate) return
    st.contentHash = e.contentHash!; st.contentType = ins.contentType; st.size = e.size!; st.contentId = ins.id
    Object.assign(st, sealedMeta(e))
    this.inscriptionById.set(ins.id, ins)
    this.contentSeen.set(e.contentHash!, noKey)          // these bytes are unique forever
    if (e.bodyHash) this.bodySeen.set(e.bodyHash, noKey)
  }

  /** ADD A NAME onto a star that already exists (born earlier from an inscription) — SAME number + id.
   *  Unique in the universe forever (canonical, universal-keyboard). No new star is born. */
  private addNameToStar(e: KrayEvent): void {
    const noKey = BigInt(e.star!).toString()
    const st = this.stars.get(noKey)
    if (!st || st.owner !== e.from || st.name) return
    const invalid = !isValidName(e.name!)
    const canon = invalid ? '' : canonicalName(e.name!)
    const nameTaken = !invalid && this.nameToStar.has(canon)
    const impersonates = !invalid && !nameTaken && this.impersonates(e.name!) !== null
    const cursed = invalid || nameTaken || impersonates
    this.allBaptisms.push({
      star: cursed ? '' : noKey, name: e.name!, seq: e.seq, by: e.from!,
      cursed, cursedReason: invalid ? 'invalid-name' : nameTaken ? 'name-taken' : impersonates ? 'impersonates' : undefined,
    })
    if (cursed) return
    st.name = e.name!
    this.nameToStar.set(canon, noKey)                    // identity key: the universal-keyboard form
    this.starToName.set(noKey, e.name!)                  // display: first writer's exact bytes
  }

  /** Third canvas — one law per star, forever. The pointer is the pot, not the relic. */
  private bindLawToStar(e: KrayEvent): void {
    if (e.star == null || !e.code || !e.from) return
    const noKey = BigInt(e.star).toString()
    const st = this.stars.get(noKey)
    if (!st || st.owner !== e.from || st.contract) return
    const codeHash = sha256hex(canonicalCode(e.code))
    st.contract = contractAddress(codeHash, e.from, e.seq)
  }

  private moveStar(e: KrayEvent): void {
    const noKey = BigInt(e.star!).toString()
    const s = this.stars.get(noKey)
    if (!s || s.owner !== e.from) return                 // replay armor: only a held star moves
    this.disown(s.owner, noKey)
    s.owner = e.to!
    this.own(e.to!, noKey)
  }

  /** star-buy leg — move a star from its current owner (the proven seller, e.to) to the buyer (e.from). */
  private moveStarTo(e: KrayEvent): void {
    const noKey = BigInt(e.star!).toString()
    const s = this.stars.get(noKey)
    if (!s || s.owner !== e.to) return                   // replay armor: only the seller's held star moves to the buyer
    this.disown(s.owner, noKey)
    s.owner = e.from!
    this.own(e.from!, noKey)
  }

  // ── queries ────────────────────────────────────────────────────────────────
  /** A read-only view of one star by its creation number — everything a page shows. */
  star(no: bigint): Star | null { const s = this.stars.get(no.toString()); return s ? { ...s } : null }
  ownerOf(no: bigint): string | null { return this.stars.get(no.toString())?.owner ?? null }
  ownedBy(owner: string, no: bigint): boolean { return this.stars.get(no.toString())?.owner === owner }
  exists(no: bigint): boolean { return this.stars.has(no.toString()) }
  isInscribed(no: bigint): boolean { return this.stars.get(no.toString())?.contentHash !== undefined }
  isNamed(no: bigint): boolean { return this.starToName.has(no.toString()) }
  isContentTaken(contentHash: string): boolean { return this.contentSeen.has(contentHash) }
  starOfContent(contentHash: string): bigint | null { const k = this.contentSeen.get(contentHash); return k === undefined ? null : BigInt(k) }
  isBodyTaken(bodyHash: string): boolean { return this.bodySeen.has(bodyHash) }
  starOfBody(bodyHash: string): bigint | null { const k = this.bodySeen.get(bodyHash); return k === undefined ? null : BigInt(k) }
  nameOfStar(no: bigint): string | null { return this.starToName.get(no.toString()) ?? null }
  starOfName(name: string): bigint | null { const k = this.nameToStar.get(canonicalName(name)); return k === undefined ? null : BigInt(k) }
  isNameTaken(name: string): boolean { return this.nameToStar.has(canonicalName(name)) }
  inscription(id: string): Inscription | null { return this.inscriptionById.get(id) ?? null }
  inscriptions(): Inscription[] { return [...this.allInscriptions] }
  baptisms(): Baptism[] { return [...this.allBaptisms] }
  parentOf(no: bigint): bigint | null { return this.stars.get(no.toString())?.parent ?? null }
  /** The FULL signed lineage (v3 lists; falls back to the scalar for legacy stars). */
  parentsOf(no: bigint): bigint[] { const s = this.stars.get(no.toString()); return s?.parents ?? (s?.parent != null ? [s.parent] : []) }
  originsOf(no: bigint): string[] { const s = this.stars.get(no.toString()); return (s?.origins ?? (s?.origin ? [s.origin] : [])).map((o) => o.l1InscriptionId) }
  childrenOf(no: bigint): bigint[] { return (this.children.get(no.toString()) ?? []).map((k) => BigInt(k)) }
  /** Every KRAY star that signed this Bitcoin L1 ordinal as origin — one father, many daughters. */
  childrenOfOrigin(l1Id: string): bigint[] {
    return (this.originChildren.get(String(l1Id).toLowerCase()) ?? []).map((k) => BigInt(k))
  }
  starsOf(owner: string): bigint[] { return [...(this.byOwner.get(owner) ?? [])].map((k) => BigInt(k)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) }
  get starCount(): number { return this.stars.size }
  get createdSeq(): bigint { return this.nextNo }
  get appliedSeq(): number { return this.lastAppliedSeq }

  /** The Codex — rarity (by creation order), founding gallery, and sacred-geometry
   *  traits, all computed from the ONE number. */
  codexOf(no: bigint): { rarity: StarRarity; collection: StarCollection | null; traits: StarTrait[] } {
    return { rarity: starRarity(no), collection: starCollection(no), traits: starTraits(no) }
  }

  /** A near-miss of an already-registered identifier (impersonation guard). */
  impersonates(name: string): bigint | null {
    const r: NameReading = readName(name)
    if (!r.lookalike || !r.resembles) return null
    const k = this.nameToStar.get(canonicalName(r.resembles))
    return k === undefined ? null : BigInt(k)
  }

  /** 32-byte commitment over the created stars, in creation order — its slot in the
   *  cascade root that anchors to Bitcoin. */
  merkleRoot(): string {
    if (this.rootCache !== null) return this.rootCache
    const h = createHash('sha256')
    // creation order is the natural, deterministic order (nextNo is monotonic)
    const keys = [...this.stars.keys()].map((k) => BigInt(k)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    for (const no of keys) {
      const s = this.stars.get(no.toString())!
      // MULTIPARENT lines EXTEND, never edit: a star without lists hashes the exact legacy
      // line, so every pre-v3 journal replays to the same root and every historical Bitcoin
      // anchor keeps matching. Only v3-born stars carry the extension — deterministically.
      const ext = (s.parents?.length || s.origins?.length)
        ? `|parents=${(s.parents ?? []).join(',')}|origins=${(s.origins ?? []).map((o) => o.l1InscriptionId).join(',')}`
        : ''
      // METADATA lines EXTEND the same way: a star without JSON hashes the exact pre-v4
      // line, so every historical Bitcoin anchor keeps matching (A3). The merkle commits
      // the hash of the JSON (newlines/pipes stay out of the line); the journal holds the bytes.
      const meta = s.meta ? `|meta=${sha256hex(s.meta)}` : ''
      // LAW lines EXTEND the same way: a star without a pot hashes the exact pre-law
      // line (A3). The address has no pipes; the journal holds the code.
      const law = s.contract ? `|law=${s.contract}` : ''
      h.update(`${s.no}|${s.owner}|${s.contentHash ?? ''}|${s.name ?? ''}|${s.parent ?? ''}|${s.origin?.l1InscriptionId ?? ''}${ext}${meta}${law}\n`, 'utf8')
    }
    return (this.rootCache = h.digest('hex'))
  }
}
