/* BE A VALIDATOR IN YOUR BROWSER — the beat is one SHA-256 and a signature, so your browser can mine it.
 *
 * No install, no download, no bitcoind, no chain sync. The validator's whole job is: hash to find a nonce with
 * enough leading zeros (proof of presence), sign it with your KrayWallet key (a powerless, domain-separated
 * "I was here" — it can move no money), and post it. The node re-verifies both and pays your share of the fee
 * pool, LINEAR in proven work (sybil-neutral — the same rule Bitcoin uses: hashrate share = reward share).
 *
 * This mirrors apps/kray-net/kray-miner.mjs exactly; the difference is only the front door. The math below is
 * byte-identical to apps/kray-core/src/economics/beat-pow.ts, so a beat mined here verifies there.
 */
(function () {
  'use strict'
  const enc = new TextEncoder()
  const hexByte = (n) => n.toString(16).padStart(2, '0')

  // the beat message the PoW hashes — EXACTLY beat-pow.ts beatMessage(). The address is bound INTO the hash,
  // so a beat mined for you can never be replayed for anyone else — work is non-transferable.
  const beatMessage = (beacon, address, block, nonce) => `kray-core.beat.v1|${beacon}|${address}|${block}|${nonce}`

  async function sha256(str) { return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str))) }

  // leading zero BITS of the digest — EXACTLY beat-pow.ts leadingZeroBits()
  function leadingZeroBits(d) {
    let bits = 0
    for (const byte of d) {
      if (byte === 0) { bits += 8; continue }
      for (let m = 0x80; m > 0; m >>= 1) { if (byte & m) return bits; bits++ }
      return bits
    }
    return bits
  }

  /**
   * Mine the best beat you can inside a time budget. Returns { nonce, zeros } — the nonce with the most leading
   * zeros found (≥ minZeros), which is the most work, which is the most reward. Yields to the UI between batches
   * so the page never freezes. This is the entire validator: a SHA-256 loop, in your browser.
   */
  async function mineBeat(beacon, address, block, { minZeros = 8, budgetMs = 2500, onProgress } = {}) {
    const t0 = performance.now()
    let best = null, tried = 0, nonce = BigInt(Math.floor((performance.now() % 1) * 1e6)) // vary the start; determinism is not needed
    while (performance.now() - t0 < budgetMs) {
      for (let i = 0; i < 400; i++) {
        const d = await sha256(beatMessage(beacon, address, block, nonce))
        const z = leadingZeroBits(d)
        if (z >= minZeros && (!best || z > best.zeros)) best = { nonce: nonce.toString(), zeros: z }
        nonce++; tried++
      }
      if (onProgress) onProgress({ tried, best })
    }
    return { best, tried, ms: Math.round(performance.now() - t0) }
  }

  globalThis.KrayValidate = { beatMessage, sha256, leadingZeroBits, mineBeat }
})()
