/* VERIFY KRAY YOURSELF — three proofs your own browser runs, trusting the KRAY node for none of them.
 *
 * Plain script, no dependencies. SHA-256 is the browser's own WebCrypto; the burn-address math is BurnProof
 * (burn-proof.js, ~40 lines of readable BigInt). The independence is the whole point: proof B asks Bitcoin
 * DIRECTLY (mempool.space, a third party the KRAY node does not control), and proof C recomputes the journal's
 * hash chain from the raw bytes. A doctored node cannot fake Bitcoin's own record or a SHA-256 chain.
 *
 * The TRULY zero-trust run is the second node — `node scripts/kray-follow.mjs` — which re-derives the entire
 * cascade root and re-proves every anchor from its OWN bitcoind. This page is the layman's on-ramp to that.
 */
(function () {
  'use strict'
  const enc = new TextEncoder()
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  async function sha256hex(str) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(str))) }

  // the reducer's exact canonicalisation: drop undefined, sort keys, JSON — must match kray-primitives.canonical
  function canonical(o) {
    return JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))))
  }
  const GENESIS_HASH = 'kray-ledger-genesis'

  const mempoolBase = (net) =>
    net === 'main' ? 'https://mempool.space/api'
    : net === 'signet' ? 'https://mempool.space/signet/api'
    : net === 'testnet' ? 'https://mempool.space/testnet/api'
    : null // regtest has no public explorer — proof B is signet/mainnet only

  /**
   * PROOF C — the journal is an unbroken SHA-256 hash chain. For every event: recompute
   * sha256(prevHash + canonical(body-without-hash)) and require it equals the event's own hash, and that its
   * prevHash equals the running hash. One tampered byte anywhere breaks the chain at that exact event.
   */
  async function verifyChain(lines) {
    let prev = GENESIS_HASH
    for (let i = 0; i < lines.length; i++) {
      let e
      try { e = JSON.parse(lines[i]) } catch { return { ok: false, at: i + 1, reason: 'event is not valid JSON' } }
      const { hash, ...body } = e
      if (e.prevHash !== prev) return { ok: false, at: i + 1, reason: `prevHash does not chain to event ${i} (tamper or gap)` }
      const expect = await sha256hex(prev + canonical(body))
      if (hash !== expect) return { ok: false, at: i + 1, reason: 'the event hash does not match its own content — this event was altered' }
      prev = hash
    }
    return { ok: true, count: lines.length, tip: prev }
  }

  globalThis.KrayVerify = { sha256hex, canonical, GENESIS_HASH, mempoolBase, verifyChain }
})()
