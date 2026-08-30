/**
 * THE SEAL CLOCK — one law the door and the constellation share.
 *
 * Bitcoin height first, then the KRAY block the seal commits, then txid.
 * One txid one seal. A row without a positive integer height is not a seal.
 * The explorer paints donate-gold only where a self-anchor was born; cascade
 * gold is the covering seal, never a second donate.
 *
 * The reducer already refuses a backwards height. This module is the door's
 * sort so 1 or 1000 pending donates never collide before they reach it.
 */

export function considerSeal(txid, height, root, blockNumber) {
  if (!txid || !/^[0-9a-f]{64}$/i.test(String(txid))) return null
  if (!Number.isInteger(height) || height <= 0) return null
  if (typeof root !== 'string' || !/^[0-9a-f]{64}$/i.test(root)) return null
  return {
    txid: String(txid).toLowerCase(),
    height,
    root: String(root).toLowerCase(),
    blockNumber: Number.isInteger(blockNumber) ? blockNumber : 0,
  }
}

export function sortPendingSeals(pending) {
  const rows = (pending || []).filter(Boolean).slice()
  rows.sort((a, b) => a.height - b.height || a.blockNumber - b.blockNumber || (a.txid < b.txid ? -1 : 1))
  const seen = new Set()
  const out = []
  for (const p of rows) {
    if (seen.has(p.txid)) continue
    seen.add(p.txid)
    out.push(p)
  }
  return out
}

export function donateSealAt(selfAnchors, anchors, blockNumber) {
  const n = Number(blockNumber)
  for (const s of selfAnchors || []) {
    if (Number(s.blockNumber) === n) return s
  }
  if (!anchors) return null
  const a = typeof anchors.get === 'function'
    ? (anchors.get(n) || anchors.get(String(n)))
    : (anchors[n] || anchors[String(n)])
  return (a && a.selfAnchor) ? a : null
}

/** The constellation's only hues — derived from the book's fields, never invented. */
export function paintCube(block) {
  const donate = !!block.selfAnchor
  const sealed = !!(block.verified || block.simulated)
  const seen = !!(!sealed && block.anchored && block.txid)
  return {
    donate,
    sealed,
    donateGold: donate && sealed,
    cascadeGold: sealed && !donate,
    seen,
    pending: !sealed && !seen,
  }
}
