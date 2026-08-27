/**
 * THE VERIFIABLE RECEIPT — the thing no high-throughput chain can hand you.
 *
 * A receipt is a small, self-contained bundle that proves ONE action really
 * happened, all the way down to the 49-byte commitment on Bitcoin — WITHOUT
 * downloading the network, trusting an RPC provider, or asking anyone's
 * permission. Save the JSON; verify it on a phone, in ten years, offline,
 * against a Bitcoin node you rent for one query.
 *
 * The chain of custody it carries:
 *
 *   your event  ──merkle proof──▶  block.merkleRoot
 *   block fields ──hash──────────▶  block.hash
 *   block.hash  ──prevHash links─▶  the anchored chain tip
 *   tip + the 4 sibling roots ───▶  cascadeRoot
 *   cascadeRoot ─────────────────▶  the OP_RETURN Bitcoin sealed
 *
 * Every step is recomputed here from the receipt's own bytes. `verifyReceipt`
 * is PURE — no I/O, no clock, no network — so a light client is a few hundred
 * lines and a hash function. That is the difference between "the network says
 * so" and "the mathematics says so, and Bitcoin agrees".
 */
import { createHash } from 'node:crypto'
import { blockHash, buildMerkleRoot, verifyMerkleProof, type KrayBlock, type MerkleStep } from './block.ts'
import type { KrayEvent } from './kray-primitives.ts'

const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/** The ledger's canonical encoding — key-sorted, undefined dropped. Must match
 *  `canonical` in kray-primitives.ts byte for byte, forever: it defines the event hash. */
function canonical(o: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))))
}

/**
 * Recompute an event's hash FROM ITS OWN BODY — the law the ledger applied when
 * it wrote the event: hash = sha256(prevHash + canonical(everything-but-hash)).
 *
 * This is the step that makes a receipt unforgeable. Without it, an attacker
 * could edit the amount or the recipient and keep the original hash, and the
 * merkle proof (which only ever sees the hash) would still pass. WITH it, any
 * edited field changes the recomputed hash, the leaf no longer matches, and the
 * proof collapses. Found by receipt.test.ts before it could ever matter.
 */
export function eventHashOf(e: KrayEvent): string {
  if (!e || typeof e !== 'object') throw new Error('receipt: eventHashOf needs an event — a missing receipt is not a hash (exam hygiene: do not hash undefined)')
  const { hash, ...body } = e as KrayEvent & Record<string, unknown>
  return sha256hex(String(e.prevHash) + canonical(body))
}

/** The domain-separated roots that compile into the cascade root. */
export interface CascadeParts {
  ledgerRoot: string // every balance and nonce — the money
  chainTipHash: string // every block, hence every event that ever happened
  starRoot: string // holdings, inscriptions, baptisms — ownership and content
  govRoot: string // proposals, votes, the used-star set
  attestRoot: string // mirrored tenant histories
  /** soulbound reputation earned by work. Absent ONLY in promises made before
   *  Glow joined the cascade — those still verify under the rule in force when
   *  they were made (a commitment is never re-judged by a later rule). */
  glowRoot?: string
  /** the root of every contract's code and state — present only once a chain
   *  actually has contracts, so older roots are untouched */
  contractRoot?: string
}

/** A block header as a receipt carries it (the full KrayBlock is the header). */
export type ReceiptHeader = KrayBlock

export interface KrayReceipt {
  version: 1
  network: string
  /** the exact journal event being proven (its own hash is the merkle leaf) */
  event: KrayEvent
  /** siblings that rebuild the block's merkle root from the event hash */
  proof: MerkleStep[]
  /** the block that sealed the event */
  block: ReceiptHeader
  /** headers from block+1 up to the tip that was anchored (may be empty) */
  headers: ReceiptHeader[]
  /** the 5 roots as they stood at the anchored tip */
  cascade: CascadeParts
  /** the cascade root those parts compile to — what Bitcoin sealed */
  cascadeRoot: string
  /** where it was sealed, when known (null while the anchor is still pending) */
  anchor: { blockNumber: number; txid: string | null } | null
}

export interface ReceiptVerdict {
  valid: boolean
  /** every step, so a UI can show exactly what was checked */
  steps: Array<{ step: string; ok: boolean; detail?: string }>
  /** the cascade root the receipt's own bytes compile to */
  computedCascadeRoot: string | null
}

/**
 * Recompute the cascade root from its parts — the same law as the node.
 *
 * THE MERKLE OF MERKLES: each subsystem compiles its whole state into one
 * root; those roots are domain-separated (so a hash from one can never be
 * replayed as another's), order-fixed, and merkled again into the single
 * 32 bytes Bitcoin seals. Verify that one number and you have verified every
 * balance, every block, every star, every vote, every mirrored tenant event —
 * and, from the day it joined, every unit of earned reputation.
 *
 * A promise made under the 5-root rule keeps verifying under the 5-root rule:
 * `glowRoot` absent means the commitment predates Glow's inclusion, and it is
 * judged by the law that was in force when Bitcoin witnessed it. That is not
 * ambiguity — it is the only honest way a commitment can ever be re-checked.
 */
export function cascadeRootOf(p: CascadeParts): string {
  const leaves = [
    sha256hex(`cascade.ledger|${p.ledgerRoot}`),
    sha256hex(`cascade.chain|${p.chainTipHash}`),
    sha256hex(`cascade.stars|${p.starRoot}`),
    sha256hex(`cascade.gov|${p.govRoot}`),
    sha256hex(`cascade.attest|${p.attestRoot}`),
  ]
  if (p.glowRoot !== undefined) leaves.push(sha256hex(`cascade.glow|${p.glowRoot}`))
  // CONTRACTS JOIN THE COMMITMENT the same way Glow did: appended, and only when
  // they exist. A chain that has never deployed one compiles the identical root
  // it always did, so adding programmability changes nothing that Bitcoin has
  // already witnessed — a format anchored on Bitcoin may only ever GROW.
  if (p.contractRoot !== undefined) leaves.push(sha256hex(`cascade.contracts|${p.contractRoot}`))
  return buildMerkleRoot(leaves)
}

/**
 * Verify a receipt end to end. PURE: it reads nothing but its arguments.
 *
 * Pass `onChainRoot` (the 32-byte root decoded from the Bitcoin OP_RETURN, via
 * `KrayAnchor.decode`) to close the last link. Without it every internal step
 * is still checked and the verdict reports that Bitcoin was not consulted.
 */
export function verifyReceipt(r: KrayReceipt, onChainRoot?: string): ReceiptVerdict {
  const steps: ReceiptVerdict['steps'] = []
  const add = (step: string, ok: boolean, detail?: string) => { steps.push({ step, ok, detail }); return ok }
  let allOk = true
  const req = (step: string, ok: boolean, detail?: string) => { if (!add(step, ok, detail)) allOk = false; return ok }

  // 0 · shape
  if (!req('receipt is a version-1 KRAY receipt', r && r.version === 1 && !!r.event && !!r.block)) {
    return { valid: false, steps, computedCascadeRoot: null }
  }

  // 1 · THE EVENT'S HASH IS RECOMPUTED FROM ITS OWN BODY — no field can be
  //     edited and still hash the same; only then is it used as the merkle leaf.
  const claimed = r.event.hash
  req('the event carries a 32-byte hash', /^[0-9a-f]{64}$/.test(claimed || ''))
  const recomputed = eventHashOf(r.event)
  req('the event hashes to exactly what it claims (nothing was edited)', recomputed === claimed, `${recomputed.slice(0, 16)}…`)
  const leaf = recomputed
  req('the merkle proof rebuilds the block root from the event', verifyMerkleProof(leaf, r.proof ?? [], r.block.merkleRoot), `root ${r.block.merkleRoot?.slice(0, 16)}…`)
  req('the event sits inside the block\'s sealed range', r.event.seq >= r.block.fromSeq && r.event.seq <= r.block.toSeq, `seq ${r.event.seq} in [${r.block.fromSeq}, ${r.block.toSeq}]`)

  // 2 · the block header hashes to its own id
  req('the block header hashes to its own id', blockHash(r.block) === r.block.hash, `#${r.block.number}`)

  // 3 · the header chain links, unbroken, up to the anchored tip
  let prev = r.block
  let linked = true
  for (const h of r.headers ?? []) {
    if (blockHash(h) !== h.hash) { linked = false; break }
    if (h.prevHash !== prev.hash || h.number !== prev.number + 1) { linked = false; break }
    prev = h
  }
  req('the header chain links unbroken to the anchored tip', linked, `${(r.headers ?? []).length} header(s) after block #${r.block.number}`)
  req('that tip is the chain root inside the cascade', prev.hash === r.cascade?.chainTipHash, `tip #${prev.number}`)

  // 4 · the 5 parts compile to the receipt's cascade root
  const computed = r.cascade ? cascadeRootOf(r.cascade) : null
  req('the five roots compile to the cascade root', !!computed && computed === r.cascadeRoot, `${String(computed).slice(0, 16)}…`)

  // 5 · Bitcoin — the last link, if the caller brought it
  if (onChainRoot != null) {
    req('the cascade root equals the root sealed on Bitcoin', onChainRoot.toLowerCase() === String(r.cascadeRoot).toLowerCase(), `on-chain ${onChainRoot.slice(0, 16)}…`)
  } else {
    add('Bitcoin was not consulted (pass the OP_RETURN root to close the chain)', true)
  }

  return { valid: allOk, steps, computedCascadeRoot: computed }
}
