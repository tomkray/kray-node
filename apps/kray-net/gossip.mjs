/**
 * GOSSIP TICK (ADR-2 · slice 2c-wire) — the loop that turns the peer-book from a hand-typed list into a
 * LEARNED one, so a node discovers where the journal lives without any central directory.
 *
 * One tick, two moves, both bounded:
 *   1. LEARN — ask every already-known peer for ITS /peers list and fold the URLs in. `book.addMany` rejects
 *      self, non-HTTP, and anything past the flood cap, and we bound how many a single peer may contribute in
 *      one tick, so no one source can steer our whole book.
 *   2. VERIFY — refresh every candidate (and every proven peer) against OUR OWN anchored head. A peer that
 *      claims a DIFFERENT head is on another chain and is evicted; only same-chain peers remain as sources.
 *
 * The node trusts ITS OWN head as authentic (it replayed the journal to it). Every network read is INJECTED
 * (`fetchJson`) and MUST be bounded (see bounded-fetch.mjs) — so this whole discovery algorithm is provable
 * with no sockets, and a discovered stranger can neither hang the tick nor flood its memory.
 */

/**
 * Run one discovery tick against the live `book`.
 * @param {ReturnType<import('./peer-book.mjs').createPeerBook>} book
 * @param {{
 *   authenticHead: string | (() => (string | Promise<string>)),  // OUR own anchored head (the chain we admit)
 *   fetchJson: (url: string) => Promise<any>,                     // a BOUNDED json fetch (time + bytes)
 *   maxLearnPerPeer?: number,                                     // cap a single peer's influence per tick
 *   allowLearned?: (url: string) => boolean,                      // SSRF guard on LEARNED urls (see isPublicHttpHost)
 * }} deps
 * @returns {Promise<string[]>} the verified peer list after this tick (proven-first).
 *
 * SSRF (2c-wire council): a LEARNED url is chosen by strangers, so on a public node `allowLearned` rejects
 * private/loopback/link-local targets BEFORE the url can enter the book — one filter covers both fetch sites
 * (the /peers learn AND the /head verify), because a url that never enters candidates is never dialed. Seeds
 * (KRAY_PEERS) are added by the operator directly on the book and are deliberately NOT filtered here.
 */
export async function gossipTick(book, { authenticHead, fetchJson, maxLearnPerPeer = 32, allowLearned } = {}) {
  if (typeof fetchJson !== 'function') throw new Error('gossipTick: fetchJson (bounded) is required')

  // 1 · LEARN — every known peer is a possible directory; a peer that won't share is simply not one this tick
  const known = [...new Set([...book.proven(), ...book.candidates()])]
  for (const peer of known) {
    try {
      const j = await fetchJson(peer + '/api/kraynet/peers')
      let list = Array.isArray(j && j.peers) ? j.peers.slice(0, maxLearnPerPeer) : []
      if (typeof allowLearned === 'function') list = list.filter(allowLearned)   // SSRF: no internal targets from the mesh
      book.addMany(list)   // add() enforces self-exclusion, http-only, and the flood cap
    } catch { /* down / silent / oversized / not a gossip node — skip it as a source this tick */ }
  }

  // 2 · VERIFY — only peers claiming OUR authentic head survive; a fork/lie/down peer is evicted
  const auth = typeof authenticHead === 'function' ? await authenticHead() : authenticHead
  return book.refresh(auth, async (u) => {
    const h = await fetchJson(u + '/api/kraynet/head')
    return h && h.head
  })
}
