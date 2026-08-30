/**
 * THE CONSTELLATION SPINE — one master neuron per Bitcoin seal.
 *
 * /world.seals is the honest list (every verified/simulated donate, including
 * barren ones that mint no land). /world.lands is the city register (stars
 * born under a seal). FORMING is only the tip after the last seal.
 *
 * Keep the paint in blocks.html in lockstep with this function.
 */

export function masterRanges(seals, maxH) {
  const out = []
  const list = (seals || []).slice().sort((a, b) => Number(a.height) - Number(b.height))
  let prev = 0
  for (const s of list) {
    const h = Number(s.height)
    if (!Number.isFinite(h)) continue
    const land = s.land == null || s.land === '' ? null : Number(s.land)
    const hasLand = land != null && Number.isFinite(land)
    out.push({
      fromBlock: prev,
      toBlock: h,
      height: h,
      land: hasLand ? land : null,
      barren: !hasLand,
      forming: false,
      txid: s.txid || null,
      confirmations: s.confirmations ?? null,
      blocks: h - prev + 1,
    })
    prev = h + 1
  }
  const tip = Number(maxH)
  if (Number.isFinite(tip) && tip >= prev) {
    out.push({
      fromBlock: prev,
      toBlock: tip,
      height: null,
      land: null,
      barren: false,
      forming: true,
      txid: null,
      confirmations: null,
      blocks: tip - prev + 1,
    })
  }
  return out
}
