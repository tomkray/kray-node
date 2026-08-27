/**
 * BOUNDED JSON FETCH (ADR-2 · shared) — a stranger's response is hostile until it fits inside a hard ceiling.
 *
 * A peer we discovered by gossip is untrusted for BYTES as much as for the chain. Two ways an untrusted peer
 * attacks a fetch: (1) it never finishes — a slow-loris stream that hangs the caller forever; (2) it finishes
 * huge — a multi-GB body that exhausts memory. This bounds BOTH: an AbortSignal timeout caps wall time, and a
 * streamed byte counter caps size (the declared content-length is checked first, then the ACTUAL bytes as they
 * arrive, because content-length is a claim). One helper the follower's chunk pull AND the node's gossip both
 * call, so the discipline is written once and proven once.
 *
 *   · gossip head/peers → small ceiling (a head is 64 hex + a little JSON; a "head" of 64MB is an attack)
 *   · chunk pull        → large ceiling (a chunk may carry a ~21MB inscription; 64MB gives headroom)
 */

/**
 * Fetch `url` and parse JSON, refusing to spend more than `timeoutMs` or read more than `maxBytes`.
 * @param {string} url
 * @param {{ timeoutMs: number, maxBytes: number, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<any>} the parsed JSON, or throws (HTTP status, timeout, over-ceiling, bad JSON).
 */
export async function boundedJson(url, { timeoutMs, maxBytes, fetchImpl } = {}) {
  if (!(timeoutMs > 0) || !(maxBytes > 0)) throw new Error('boundedJson: timeoutMs and maxBytes are required and positive')
  const doFetch = fetchImpl || fetch
  // SSRF (2c-wire council): refuse to FOLLOW redirects. A host that passed the public-host guard could still
  // 3xx to http://169.254.169.254 or a loopback service, and fetch would follow it — re-opening the exact
  // vector the guard closed. `redirect: 'error'` makes any 3xx throw, so only the vetted host is ever dialed.
  const r = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  // the DECLARED size is a claim — reject an oversized declaration early, but never trust it as the truth
  if (Number(r.headers.get('content-length') || 0) > maxBytes) throw new Error('response over the byte ceiling (declared)')
  const reader = r.body.getReader()
  let total = 0
  const parts = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) { try { await reader.cancel() } catch { /* already closing */ } throw new Error('response exceeded the byte ceiling') }
    parts.push(Buffer.from(value))
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}
