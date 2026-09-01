/**
 * PEER BOOK (ADR-2 · slice 2c — peer discovery without a central index) — a node learns peers from gossip,
 * and ADMITS a peer as a candidate data source only once it CLAIMS the AUTHENTIC anchored head.
 *
 * WHAT THIS FILTERS, AND WHAT IT DOES NOT (stated honestly, after a soundness council):
 * · Discovery is permissionless because a directory decides nothing — the anchored head does. A gossiped
 *   hint is just a URL; a peer on a DIFFERENT chain, a fork, a fabricated address, or a node that is down
 *   never enters `peers()`. So the book filters CHAIN / LIVENESS / FABRICATION.
 · It does NOT prove a peer is honest or useful. The anchored head is PUBLIC (it is on Bitcoin), so any
 *   node can ECHO it for free while holding zero data. Such a head-echoer verifies and occupies a bounded
 *   slot until it stops echoing — the book admits who may SPEAK, never who will DELIVER. Byte-honesty is
 *   proven entirely DOWNSTREAM: the follower re-hashes every chunk (content address), re-chains it, and
 *   replays the result to the anchored root (ADR-2 2a + the reducer + the Bitcoin anchor). So no admitted
 *   peer is ever trusted for a byte — a lie about DATA is inert, exactly as a lie about the chain is.
 *
 * Bounded so a gossip FLOOD cannot grow the pool unboundedly (hard-capped at `maxPeers`). `refresh` EVICTS
 * only candidates that FAIL the head — a head-echoer is not evicted, so availability rests on the seed
 * (`--from`) + explicit peers + the cap, and the data-liveness signals below, NOT on eviction churning out
 * head-honest-but-useless peers. Pure: the head fetch is INJECTED, so the trust logic is provable with no
 * network — one algorithm the follower and the tests both call.
 *
 * THE TWO WIRE-TIME SIGNALS (2c-wire — byte-honesty made real, proven DOWNSTREAM by the chunk fetch):
 * · `prove(url)` — the follower fetched a VALID chunk from this peer (content-address + hash-chain checked),
 *   so it is a delivery-PROVEN source. Proven peers live in a PROTECTED tier: they are EXEMPT from the
 *   candidate flood cap (a flood of head-echoers can never crowd one out — that is the honest-peer HEADROOM)
 *   and `peers()` lists them FIRST (a reconstruction tries a proven deliverer before any mere head-echoer).
 * · `demote(url)` — the follower asked this peer for data and it did NOT deliver (a head-echoer that serves
 *   nothing, or a peer that served a byte-lie). It is dropped from every tier. Re-learnable via gossip, but
 *   it costs the attacker a round-trip each time and it fails delivery again. A proven peer that later FORKS
 *   (stops serving the authentic head) also loses its protection on the next `refresh`.
 */
import { isPublicHttpHost } from '../kray-core/src/protocol/public-host.ts'

export { isPublicHttpHost }

const HEX64 = /^[0-9a-f]{64}$/
/** Canonicalize a peer URL: lowercase scheme+host (both case-insensitive), drop the scheme's default port
 *  (80/443), strip a trailing slash. Returns '' for anything that is not a valid http(s) URL, so `add`
 *  rejects it. One canonical key closes BOTH the dedup holes (case/port variants → one slot) and the
 *  self-bypass (a case/port variant of `self` is caught). http:// and https:// stay distinct — they are
 *  genuinely different endpoints. */
const norm = (u) => {
  let p
  try { p = new URL(String(u == null ? '' : u).trim()) } catch { return '' }
  if (p.protocol !== 'http:' && p.protocol !== 'https:') return ''
  return (p.protocol + '//' + p.hostname + (p.port ? ':' + p.port : '') + p.pathname + p.search).replace(/\/+$/, '')
}
const headOf = (h) => String(h == null ? '' : h).trim().toLowerCase()

/**
 * @param {{ maxPeers?: number, self?: string }} opts
 *   maxPeers — the candidate-pool ceiling (a gossip flood cannot exceed it).
 *   self — this node's own URL, never added. Self-exclusion is CONDITIONAL: it only fires when `self` is a
 *          valid URL. If `self` is empty (KRAY_SELF_URL unset), the node MAY discover itself — harmless
 *          (it dials its own public URL, wasteful only), but the operator should set it to avoid the churn.
 */
export function createPeerBook({ maxPeers = 64, self = '' } = {}) {
  const selfN = norm(self)
  const candidates = new Set()   // every known UNPROVEN URL awaiting / holding verification (bounded by maxPeers)
  const verified = new Map()     // url -> the authentic head it last proved (a subset of candidates)
  const proven = new Set()       // delivery-PROVEN sources — a PROTECTED tier, exempt from the flood cap (headroom)

  /** Add one candidate URL. Rejects non-HTTP, self, and (when the UNPROVEN pool is full) new entries — never
   *  evicts to fit. A proven peer is already tracked (and does not consume the cap), so re-adding it is a no-op. */
  function add(url) {
    const u = norm(url)
    if (!u || u === selfN) return false
    if (proven.has(u) || candidates.has(u)) return true
    if (candidates.size >= maxPeers) return false
    candidates.add(u)
    return true
  }
  /** Add many (from a gossip response). Returns how many NEW candidates were accepted. */
  function addMany(urls) { let n = 0; if (Array.isArray(urls)) for (const u of urls) if (add(u)) n++; return n }

  /**
   * Check every candidate against the AUTHENTIC head. `fetchHead(url)` returns that peer's CLAIMED head
   * (a 64-hex string) or throws. A candidate whose claim === authenticHead becomes/stays admitted; any
   * OTHER head, an error, or a down peer is DROPPED (evicted — freeing a slot for an honest peer). A peer
   * that echoes the (public) head is admitted and NOT evicted here — its uselessness is not visible to the
   * book; only a wire-time data-liveness signal or its ceasing to echo removes it. If the authentic head is
   * missing/invalid, trust NO ONE. Returns the admitted URL list.
   */
  async function refresh(authenticHead, fetchHead) {
    const auth = headOf(authenticHead)
    if (!HEX64.test(auth) || typeof fetchHead !== 'function') { verified.clear(); proven.clear(); return [] }
    for (const u of [...candidates]) {
      let h = null
      try { h = headOf(await fetchHead(u)) } catch { h = null }
      if (h === auth) { verified.set(u, h) }
      else { verified.delete(u); candidates.delete(u) }   // failed the head → evict, freeing a slot for an honest peer
    }
    // a PROVEN peer keeps its protection only while it still serves the authentic head — a proven peer that
    // forks or dies is dropped too (verification is continuous, protection is not a permanent title)
    for (const u of [...proven]) {
      let h = null
      try { h = headOf(await fetchHead(u)) } catch { h = null }
      if (h !== auth) proven.delete(u)
    }
    return peersList()
  }

  /** Proven deliverers FIRST (headroom — tried before any head-echoer), then head-verified candidates. */
  function peersList() {
    const out = [...proven]
    for (const u of verified.keys()) if (!proven.has(u)) out.push(u)
    return out
  }

  /** The follower fetched a VALID chunk from `url` → promote it to the protected proven tier (headroom). */
  function prove(url) {
    const u = norm(url)
    if (!u || u === selfN) return false
    candidates.delete(u); verified.delete(u)   // it graduates out of the capped pool into the protected tier
    proven.add(u)
    return true
  }
  /** `url` was asked for data and did not deliver (head-echoer or byte-lie) → drop it from every tier. */
  function demote(url) {
    const u = norm(url)
    const inC = candidates.delete(u), inV = verified.delete(u), inP = proven.delete(u)
    return inC || inV || inP
  }

  return {
    add, addMany, refresh, prove, demote,
    /** proven deliverers first, then head-verified peers — the byte-honesty of what a NON-proven peer serves
     *  is decided downstream by the chunk content-address + hash-chain + replay + anchor, never by the book */
    peers: peersList,
    /** the delivery-proven, flood-exempt tier */
    proven: () => [...proven],
    /** every known UNPROVEN candidate (verified or awaiting) */
    candidates: () => [...candidates],
    size: () => candidates.size,
    verifiedCount: () => verified.size,
    provenCount: () => proven.size,
    has: (url) => { const u = norm(url); return verified.has(u) || proven.has(u) },
  }
}
