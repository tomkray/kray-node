/**
 * ORDINAL ANCESTRY — proof that a UTXO you control holds a given inscription, by
 * following its satoshi backward through Bitcoin to the reveal.
 *
 * An ordinal lives on ONE satoshi. To prove you control the inscription you must
 * prove that satoshi sits in a UTXO you control. Satoshis have no label, but they
 * have a POSITION: a transaction concatenates its input sats in order and pays
 * them out to its outputs in order (the excess is the fee). So a sat's place in an
 * output maps deterministically back to a place in one of the inputs — and, hop by
 * hop, all the way back to the transaction that inscribed it. Each hop is an
 * ordinary Bitcoin transaction, and KRAY already proves those from raw bytes
 * (`anchor/spv.ts`). The claimant carries the chain; the verifier checks it.
 *
 * This is the same discipline as `rune-ancestry.ts` — a backward, SPV-proven walk,
 * fail-closed — with one added piece of arithmetic: the sat's OFFSET, tracked
 * through each transaction's input/output value layout.
 *
 * ── WHAT IT PROVES, AND WHAT IT HONESTLY CANNOT ─────────────────────────────
 * PROVEN, from bytes, no indexer:
 *   · every transaction in the chain is real and buried to the required depth
 *   · the sat at the claimed (outpoint, offset) is the parent's inscription sat
 *   · that outpoint pays the author's own address — so the author's KRAY signature
 *     proves they control it, and therefore the parent
 *
 * NOT PROVABLE from SPV alone, and named rather than hidden:
 *   · that the holding UTXO is STILL UNSPENT right now. A light client cannot prove
 *     a UTXO unspent without the UTXO set (and the mempool). The reducer therefore
 *     proves control AS OF the holder burial — replay never re-asks "unspent", or
 *     every old child would HALT after a later sale. The LIVE door closes the
 *     pending-sale hole with two eyes: this node's `gettxout` (mempool) and, on
 *     main, the KRAY API outspend/satpoint KrayScan already uses. A sold parent
 *     — confirmed or only in the mempool — cannot father a new child.
 *
 * The reveal MUST carry an `ord` envelope at the claimed index
 * (`inscriptionAtLoose` — same numbering as `ord`). A rune etch (tag 13), a
 * parent tag, or metadata still IS an inscription; only delegate / content-
 * encoding rewrite the body and stay refused. No pointer → sat 0. Pointer
 * (tag 2) → land on that sat. `iN` without a pointer is refused
 * (sequential assignment is not guessed).
 */
import { MIN_BLOCK_WORK, checkProofOfWork, parseHeader, parseTx, verifyTxOutProof } from '../anchor/spv.ts'
import { inscriptionAtLoose, pointerSatOf, satpointInOutputs } from './inscription.ts'
import type { ProvenTx } from './rune-ancestry.ts'
import { scriptOfAddress, toBtcNet } from './scheme.ts'

/** One origin's SPV bag — aligned 1:1 with the signed `origins` list (or origin.v2 `l1InscriptionId`). */
export interface OriginControlProof {
  holderTxid: string
  holderVout: number
  /** sat offset in the holder output — decimal string, BigInt-safe */
  holderOffset: string
  bundle: ProvenTx[]
}

const TXID_RE = /^[0-9a-f]{64}$/
const OFFSET_RE = /^(0|[1-9]\d*)$/

export type ControlRefusal =
  | 'bad-parent-id' | 'malformed' | 'tx-unproven' | 'tx-shallow' | 'txid-mismatch'
  | 'holder-missing' | 'holder-not-authors' | 'offset-out-of-range'
  | 'input-missing' | 'input-value-unknown' | 'reveal-missing'
  | 'not-the-inscription-sat' | 'value-overflow' | 'too-deep' | 'no-inscription'

/** One backward hop of an inscription sat through a transaction's value layout. */
export type SatHop = { txid: string; vout: number; offset: bigint }

export function satHopBack(
  tx: { inputs: { txid: string; vout: number }[]; outputValues: readonly bigint[] },
  vout: number,
  offset: bigint,
  fundValue: (txid: string, vout: number) => bigint | null,
): { ok: true; hop: SatHop } | { ok: false; reason: ControlRefusal } {
  if (vout >= tx.outputValues.length) return { ok: false, reason: 'input-missing' }
  if (offset < 0n || offset >= tx.outputValues[vout]) return { ok: false, reason: 'offset-out-of-range' }
  let cumOut = 0n
  for (let k = 0; k < vout; k++) cumOut += tx.outputValues[k]
  const abs = cumOut + offset
  let cumIn = 0n
  for (const inp of tx.inputs) {
    const v = fundValue(inp.txid, inp.vout)
    if (v == null) return { ok: false, reason: 'input-value-unknown' }
    if (abs < cumIn + v) return { ok: true, hop: { txid: inp.txid, vout: inp.vout, offset: abs - cumIn } }
    cumIn += v
  }
  return { ok: false, reason: 'value-overflow' }
}

export interface ControlVerdict {
  ok: boolean
  reason?: ControlRefusal
  /** how many hops back to the reveal — for the record, not for trust */
  hops?: number
}

/**
 * Live UTXO-set gate (door only). SPV cannot see a mempool sale; bitcoind can.
 * `headerOnThisChain === null` → this node does not have the holder block
 * (lab bags, foreign headers) — do not invent a spent-refuse.
 * Header on this chain + no UTXO (mempool included) → the parent is already sold.
 */
export type LiveHolderGate =
  | { ok: true; reason: 'unspent' | 'not-this-chain' }
  | { ok: false; reason: 'holder-spent' | 'holder-orphaned' }

export function liveHolderGate(opts: {
  headerOnThisChain: boolean | null
  headerConfirmations: number | null
  utxoPresent: boolean | null
}): LiveHolderGate {
  if (opts.headerOnThisChain !== true) return { ok: true, reason: 'not-this-chain' }
  if (opts.headerConfirmations != null && opts.headerConfirmations < 0) {
    return { ok: false, reason: 'holder-orphaned' }
  }
  if (opts.utxoPresent === true) return { ok: true, reason: 'unspent' }
  return { ok: false, reason: 'holder-spent' }
}

/**
 * Second live eye — the same Esplora outspend KrayScan uses (`/api/tx/…/outspends`).
 * `spent: true` includes a mempool sale. Missing/malformed row is not invented as a sale.
 */
export type KrayEyeGate =
  | { ok: true; reason: 'unspent' | 'eye-dark' }
  | { ok: false; reason: 'holder-spent' }

export function krayOutspendGate(row: unknown): KrayEyeGate {
  if (row == null || typeof row !== 'object') return { ok: true, reason: 'eye-dark' }
  const spent = (row as { spent?: unknown }).spent
  if (typeof spent !== 'boolean') return { ok: true, reason: 'eye-dark' }
  return spent ? { ok: false, reason: 'holder-spent' } : { ok: true, reason: 'unspent' }
}

/** ord / KRAY satpoint: `txid:vout` or `txid:vout:offset`. */
export function parseSatpoint(raw: unknown): { txid: string; vout: number; offset: bigint } | null {
  if (typeof raw !== 'string' || !raw) return null
  const m = /^([0-9a-f]{64}):(\d+)(?::(\d+))?$/i.exec(raw.trim())
  if (!m) return null
  return { txid: m[1].toLowerCase(), vout: Number(m[2]), offset: m[3] != null ? BigInt(m[3]) : 0n }
}

/** If KRAY/ord names a different outpoint, the inscription has already moved (pending or confirmed). */
export function kraySatpointGate(claimed: { txid: string; vout: number }, location: unknown): KrayEyeGate {
  const p = parseSatpoint(location)
  if (!p) return { ok: true, reason: 'eye-dark' }
  if (p.txid === claimed.txid.toLowerCase() && p.vout === claimed.vout) return { ok: true, reason: 'unspent' }
  return { ok: false, reason: 'holder-spent' }
}

export interface ControlOptions {
  /** how deep Bitcoin must have buried EVERY transaction in the chain */
  minConfirmations: number
  /** which Bitcoin this claims to come from — the work floor depends on it */
  net?: string
  /** refuse absurdly long lineages rather than walking forever */
  maxDepth?: number
  /**
   * WHERE THE BACKWARD WALK MUST LAND. Omitted → the reveal (the first sat, output
   * 0) — a FIRST claim, proving the holder descends from the inscription itself.
   * Given → a previously-recorded owner outpoint (the current KRAY-known tip) — a
   * TRANSFER claim, proving the sat moved FORWARD from that owner to the new holder.
   * This is what makes ownership LIVE: a new owner shows descent from the last one,
   * and a former owner (an ancestor of the tip, not a descendant) can never reach it.
   */
  target?: { txid: string; vout: number; offset: bigint }
}

/**
 * PROVE the author controls the parent ordinal: the sat at (holderTxid,
 * holderVout, holderOffset) traces back to the reveal of `parentInscriptionId`,
 * and that holder output pays `authorScriptHex` (the author's own address).
 *
 * Fail-closed everywhere: a missing transaction, an unproven one, a shallow
 * burial, a missing input value, an offset outside its output, or a sat that does
 * not reach the inscription — all refuse and say why.
 */
export function proveParentControl(
  holderTxid: string,
  holderVout: number,
  holderOffset: bigint,
  authorScriptHex: string,
  parentInscriptionId: string,
  bundle: ProvenTx[],
  opts: ControlOptions,
): ControlVerdict {
  const net = opts.net ?? 'main'
  const maxDepth = opts.maxDepth ?? 128
  const m = /^([0-9a-f]{64})i(\d+)$/.exec(parentInscriptionId)
  if (!m) return { ok: false, reason: 'bad-parent-id' }
  const revealTxid = m[1]
  const revealIndex = Number(m[2])
  if (!Number.isInteger(revealIndex) || revealIndex < 0) return { ok: false, reason: 'bad-parent-id' }

  // 1 · every transaction in the bundle must BE what it claims and be buried
  const byTxid = new Map<string, ReturnType<typeof parseTx>>()
  const rawByTxid = new Map<string, string>()
  for (const tx of bundle) {
    let parsed: ReturnType<typeof parseTx>
    try { parsed = parseTx(tx.rawTx) } catch (_) { return { ok: false, reason: 'malformed' } }
    let proof: ReturnType<typeof verifyTxOutProof>
    try { proof = verifyTxOutProof(tx.txoutproof) } catch (_) { return { ok: false, reason: 'tx-unproven' } }
    if (!proof.provenTxids.includes(parsed.txidDisplay)) return { ok: false, reason: 'txid-mismatch' }
    if (!tx.headers.length) return { ok: false, reason: 'tx-unproven' }
    try {
      const hs = tx.headers.map((h) => parseHeader(Buffer.from(h, 'hex')))
      if (hs[0].hashDisplay !== proof.header.hashDisplay) return { ok: false, reason: 'tx-unproven' }
      for (let i = 1; i < hs.length; i++) if (hs[i].prevDisplay !== hs[i - 1].hashDisplay) return { ok: false, reason: 'tx-unproven' }
      let work = 0n
      for (const h of tx.headers) { const pow = checkProofOfWork(h, net); if (!pow.ok) return { ok: false, reason: 'tx-unproven' }; work += pow.work }
      const floor = BigInt(tx.headers.length) * (MIN_BLOCK_WORK[net] ?? MIN_BLOCK_WORK.main)
      if (work < floor) return { ok: false, reason: 'tx-unproven' }
    } catch (_) { return { ok: false, reason: 'tx-unproven' } }
    if (tx.headers.length < opts.minConfirmations) return { ok: false, reason: 'tx-shallow' }
    byTxid.set(parsed.txidDisplay, parsed)
    rawByTxid.set(parsed.txidDisplay, tx.rawTx)
  }

  // the holder outpoint must exist and PAY THE AUTHOR — so the author's KRAY
  // signature (control of that address) is control of the parent's satoshi.
  const holder = byTxid.get(holderTxid)
  if (!holder || holderVout >= holder.outputScripts.length) return { ok: false, reason: 'holder-missing' }
  if (holder.outputScripts[holderVout].toString('hex') !== authorScriptHex.toLowerCase()) return { ok: false, reason: 'holder-not-authors' }
  if (holderOffset < 0n || holderOffset >= holder.outputValues[holderVout]) return { ok: false, reason: 'offset-out-of-range' }

  // WHERE THE WALK MUST LAND. A transfer claim stops at the previous owner (the
  // KRAY-recorded tip); a first claim stops at the reveal, where the inscription
  // sits at absolute sat offset 0 — the FIRST output holding any sats, at offset 0.
  let target: { txid: string; vout: number; offset: bigint }
  if (opts.target) {
    target = opts.target
  } else {
    const reveal = byTxid.get(revealTxid)
    const revealRaw = rawByTxid.get(revealTxid)
    if (!reveal || !revealRaw) return { ok: false, reason: 'reveal-missing' }
    let decoded
    try { decoded = inscriptionAtLoose(revealRaw, revealIndex) } catch (_) { return { ok: false, reason: 'malformed' } }
    if (!decoded) return { ok: false, reason: 'no-inscription' }
    const pointer = pointerSatOf(decoded.tags)
    if (pointer === null && revealIndex !== 0) return { ok: false, reason: 'bad-parent-id' }
    const abs = pointer ?? 0n
    const land = satpointInOutputs(reveal.outputValues, abs)
    if (!land) return { ok: false, reason: 'not-the-inscription-sat' }
    target = { txid: revealTxid, vout: land.vout, offset: land.offset }
  }

  // 2 · walk the sat backward, hop by hop, until it lands on the target
  let curTxid = holderTxid, curVout = holderVout, curOff = holderOffset
  for (let hop = 0; hop <= maxDepth; hop++) {
    if (curTxid === target.txid) {
      return (curVout === target.vout && curOff === target.offset)
        ? { ok: true, hops: hop }
        : { ok: false, reason: 'not-the-inscription-sat' }
    }
    const tx = byTxid.get(curTxid)
    if (!tx) return { ok: false, reason: 'input-missing' }
    const back = satHopBack(tx, curVout, curOff, (txid, vout) => {
      const fund = byTxid.get(txid)
      if (!fund || vout >= fund.outputValues.length) return null
      return fund.outputValues[vout]
    })
    if (!back.ok) return { ok: false, reason: back.reason }
    curTxid = back.hop.txid
    curVout = back.hop.vout
    curOff = back.hop.offset
  }
  return { ok: false, reason: 'too-deep' }
}

/**
 * Boundary parse — hostile JSON. Throws a short English reason (the caller prefixes
 * `ledger:` / the door). Empty array is malformed: a claimed proof era with nothing in it.
 */
export function parseOriginProofs(raw: unknown): OriginControlProof[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('originProofs must be a non-empty array')
  const out: OriginControlProof[] = []
  for (const row of raw) {
    if (row == null || typeof row !== 'object') throw new Error('originProofs entries must be objects')
    const r = row as Record<string, unknown>
    const holderTxid = typeof r.holderTxid === 'string' ? r.holderTxid.toLowerCase() : ''
    if (!TXID_RE.test(holderTxid)) throw new Error('originProofs.holderTxid must be 64 lowercase hex')
    const holderVout = r.holderVout
    if (typeof holderVout !== 'number' || !Number.isInteger(holderVout) || holderVout < 0) {
      throw new Error('originProofs.holderVout must be a non-negative integer')
    }
    const holderOffset = typeof r.holderOffset === 'string' ? r.holderOffset : (typeof r.holderOffset === 'number' && Number.isInteger(r.holderOffset) ? String(r.holderOffset) : '')
    if (!OFFSET_RE.test(holderOffset)) throw new Error('originProofs.holderOffset must be a decimal integer string')
    if (!Array.isArray(r.bundle) || r.bundle.length === 0) throw new Error('originProofs.bundle must be a non-empty ProvenTx list')
    const bundle: ProvenTx[] = []
    for (const tx of r.bundle) {
      if (tx == null || typeof tx !== 'object') throw new Error('originProofs.bundle entries must be objects')
      const t = tx as Record<string, unknown>
      if (typeof t.rawTx !== 'string' || !t.rawTx) throw new Error('originProofs.bundle.rawTx must be hex')
      if (typeof t.txoutproof !== 'string' || !t.txoutproof) throw new Error('originProofs.bundle.txoutproof must be hex')
      if (!Array.isArray(t.headers) || t.headers.length === 0 || t.headers.some((h) => typeof h !== 'string' || !h)) {
        throw new Error('originProofs.bundle.headers must be a non-empty hex list')
      }
      bundle.push({ rawTx: t.rawTx, txoutproof: t.txoutproof, headers: t.headers as string[] })
    }
    out.push({ holderTxid, holderVout, holderOffset, bundle })
  }
  return out
}

/**
 * Re-prove every signed L1 parent from bytes: the holder UTXO pays `authorAddress`,
 * and that sat traces to each claimed `<txid>iN` whose envelope exists on the
 * reveal (pointer lands on that sat). Fail-closed.
 */
export function verifyOriginProofs(
  authorAddress: string,
  net: string,
  originIds: readonly string[],
  proofs: OriginControlProof[],
  minConfirmations: number,
): { ok: true } | { ok: false; reason: string } {
  if (proofs.length !== originIds.length) return { ok: false, reason: 'originProofs must align 1:1 with the origins list' }
  let authorScript: string
  try { authorScript = scriptOfAddress(authorAddress, toBtcNet(net)) }
  catch { return { ok: false, reason: 'cannot derive the author script from `from`' } }
  for (let i = 0; i < originIds.length; i++) {
    const p = proofs[i]
    let offset: bigint
    try { offset = BigInt(p.holderOffset) }
    catch { return { ok: false, reason: 'holderOffset is not an integer' } }
    const v = proveParentControl(p.holderTxid, p.holderVout, offset, authorScript, originIds[i], p.bundle, {
      minConfirmations, net,
    })
    if (!v.ok) return { ok: false, reason: `${originIds[i]} — ${v.reason}` }
    // Casey / ord provenance (docs.ordinals.com/inscriptions/provenance.html):
    // the parent sat MUST be spent as an input of the blessing tx. hops===0 is
    // the reveal sitting still — not a child. A sale of that UTXO is a double-spend
    // against any later blessing. Each child needs its own send-to-self.
    if ((v.hops ?? 0) < 1) return { ok: false, reason: `${originIds[i]} — parent-not-spent` }
  }
  return { ok: true }
}
