/**
 * Two pens, two holes. Never two binds on one port.
 *
 *   primary hole  → 127.0.0.1:4579
 *   fallback hole → 127.0.0.1:4580
 *
 * The writer asks ONE hole. Primary alive → only primary. Primary dark → only fallback.
 * A live primary that REFUSES a payout never fails over (no signer-shopping).
 */
export const MAINNET_PEN_PRIMARY = 4579
export const MAINNET_PEN_FALLBACK = 4580
export const SIGNET_PEN = 4479

export function potSignerHoles(env = process.env) {
  const primary = String(env.KRAY_POT_SIGNER_URL || '').trim().replace(/\/+$/, '')
  const fallback = String(env.KRAY_POT_SIGNER_URL_FALLBACK || '').trim().replace(/\/+$/, '')
  return { primary: primary || '', fallback: fallback || '' }
}

export function potSignerConfigured(env = process.env) {
  const h = potSignerHoles(env)
  return !!(h.primary || h.fallback)
}

export function assertPotSignerLoopback(url, name = 'KRAY_POT_SIGNER_URL') {
  let parsed
  try { parsed = new URL(url) } catch {
    return { ok: false, reason: name + ' is not a valid URL' }
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    return { ok: false, reason: name + ' must be loopback (127.0.0.1) — the pot key never answers the public internet' }
  }
  return { ok: true, parsed }
}

/** Primary wins whenever it is alive. Fallback only when primary is dark. Never both. */
export function choosePotSignerHole({ primaryAlive, fallbackAlive }) {
  if (primaryAlive) return 'primary'
  if (fallbackAlive) return 'fallback'
  return null
}
