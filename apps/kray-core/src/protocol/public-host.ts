/**
 * PUBLIC HOST — one door judge for a stranger URL.
 *
 * Not consensus. The journal never stores an art URL (ledger refuses `e.shelf`).
 * Gossip, mint-shelf parse, and the mint-art fetch all call this same
 * classifier so a mapped/compatible/6to4 literal cannot slip one guard
 * and fail another.
 *
 * Literal + name only. A DNS name that later resolves private is closed
 * at fetch by pinPublicAddresses (public-fetch.mjs), not here.
 */

export function isPublicV4(ip: string): boolean {
  const o = ip.split('.').map((s) => Number(s))
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = o
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 255) return false
  return true
}

function isPublicV6(h: string): boolean {
  if (h === '::1' || h === '::') return false
  if (/^2002:/.test(h) || /^64:ff9b:/.test(h)) return false
  const dot = h.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/)
  if (dot) return isPublicV4(dot[1])
  const hex = h.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const hi = parseInt(hex[1], 16)
    const lo = parseInt(hex[2], 16)
    return isPublicV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  if (/^fe[89ab]/.test(h)) return false
  if (/^f[cd]/.test(h)) return false
  return true
}

/** Strip IPv6 brackets and trailing FQDN dots (`localhost.` is still loopback). */
export function normalizeHost(host: string): string {
  return String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
}

/** A resolved A/AAAA (or a literal IP). Names return false — pin those via DNS first. */
export function isPublicAddress(ip: string): boolean {
  const h = normalizeHost(ip)
  if (!h) return false
  if (h.includes(':')) return isPublicV6(h)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return isPublicV4(h)
  return false
}

/** Hostname of an http(s) URL. A DNS name is allowed here; rebinding is the fetch pin. */
export function isPublicHostname(host: string): boolean {
  const h = normalizeHost(host)
  if (!h) return false
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false
  if (h.includes(':')) return isPublicV6(h)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return isPublicV4(h)
  return true
}

export function isPublicHttpHost(url: unknown): boolean {
  let p: URL
  try { p = new URL(String(url == null ? '' : url).trim()) } catch { return false }
  if (p.protocol !== 'http:' && p.protocol !== 'https:') return false
  return isPublicHostname(p.hostname)
}
