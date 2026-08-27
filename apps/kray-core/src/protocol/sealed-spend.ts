/**
 * COVERING SEAL — a READ of Bitcoin weight, not a spend lock.
 *
 * Article VI: anchors witness states; they do not create them. An exit is
 * real when it is signed and journaled. This module only answers: has a
 * verified donate/self-anchor (or a later cascade seal) already witnessed
 * the block that holds this seq? Explorers and auditors ask. The payout
 * door must not — that would tax every withdraw to re-create a right the
 * exit signature already granted, and invert the article.
 *
 * Pure: no I/O. Same walk-forward as server.mjs sealOf, with simulated
 * seals opt-in (regtest exams never bury).
 */
export interface SealBlock {
  number: number
  fromSeq: number
  toSeq: number
  cascadeRoot: string
}

export interface SealAnchor {
  blockNumber: number
  root: string
  verified: boolean
  simulated?: boolean
  real?: boolean
  txid?: string | null
}

export function blockOfSeq(seq: number, blocks: SealBlock[]): SealBlock | null {
  if (!Number.isInteger(seq) || seq < 1) return null
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (seq >= b.fromSeq && seq <= b.toSeq) return b
  }
  return null
}

/** The still-open rune-exit seq for (from, runeId), or null if none. */
export function openExitSeq(
  events: Array<{ seq: number; kind: string; from?: string; runeId?: string }>,
  from: string,
  runeId: string,
): number | null {
  let seq: number | null = null
  const wantFrom = String(from)
  const wantRune = String(runeId)
  for (const e of events) {
    if (e.from !== wantFrom || String(e.runeId) !== wantRune) continue
    if (e.kind === 'rune-exit') seq = e.seq
    if (e.kind === 'rune-settle' || e.kind === 'rune-cancel') seq = null
  }
  return seq
}

/**
 * Walk forward from the event's L2 block to the tip. The first verified,
 * root-matched, non-simulated Bitcoin seal covers every earlier block
 * (same law as server.mjs sealOf). Simulated seals are opt-in (regtest exams).
 */
export function coveringSeal(
  eventSeq: number,
  blocks: SealBlock[],
  anchors: SealAnchor[],
  opts: { allowSimulated?: boolean } = {},
): { ok: true; sealedBy: number; root: string; txid: string | null } | { ok: false; reason: string } {
  if (!Number.isInteger(eventSeq) || eventSeq < 1) {
    return { ok: false, reason: 'this event has no journal seq — nothing to witness' }
  }
  const blk = blockOfSeq(eventSeq, blocks)
  if (!blk) {
    return { ok: false, reason: 'this event is not yet in an L2 block — the next seal will witness it' }
  }
  const byN = new Map<number, SealAnchor>()
  for (const a of anchors) byN.set(a.blockNumber, a)
  const tip = blocks.length ? Math.max(...blocks.map((b) => b.number)) : -1
  for (let j = blk.number; j <= tip; j++) {
    const bj = blocks.find((b) => b.number === j)
    if (!bj) continue
    const a = byN.get(j)
    if (!a || a.root !== bj.cascadeRoot) continue
    const real = a.verified === true && a.real !== false && !a.simulated
    // regtest exams mark seals simulated + unverified (they never bury). Same
    // polarity as server.mjs sealOf: simulated counts only when the caller opts in.
    const sim = opts.allowSimulated === true && !!a.simulated
    if (real || sim) return { ok: true, sealedBy: j, root: a.root, txid: a.txid ?? null }
  }
  return { ok: false, reason: 'this event is not under a donate-sealed Bitcoin root yet — the next weighed donate will witness it' }
}
