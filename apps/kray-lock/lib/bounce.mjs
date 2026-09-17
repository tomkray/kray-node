/**
 * Sealed bounce URI — eternal bytes for every wire (QR / NFC / BLE / Wi‑Fi).
 */
export function buildPairUri(policy, star, host, port, keyRow) {
  const q = new URLSearchParams()
  q.set('star', String(star))
  q.set('door', String(policy.name || policy.id || 'Door').slice(0, 64))
  if (policy.audience && policy.audience !== 'hold') q.set('audience', policy.audience)
  const base = `http://${host}:${port}`
  q.set('unlock', `${base}/unlock`)
  q.set('challenge', `${base}/challenge?star=${encodeURIComponent(star)}`)
  if (keyRow && keyRow.label) q.set('label', String(keyRow.label).slice(0, 64))
  return `kraylock:1?${q.toString()}`
}

export function parseStarFromMessage(message) {
  const m = /\|star=(\d+)\|/.exec(String(message || ''))
  return m ? m[1] : ''
}
