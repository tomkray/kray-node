/**
 * Site-card unfurl — paint only. Never a journal act. Never a second ₭.
 *
 * Browser cannot read og:image (CORS). The mouth fetches the sealed HTTPS page,
 * reads Open Graph / Twitter tags, and returns a card. SSRF is fail-closed:
 * https only · no credentials · no private / link-local / metadata IPs ·
 * DNS checked before connect · redirects re-checked · size + time caps.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_URL = 512
const MAX_HTML = 262144
const MAX_HOPS = 3
const TIMEOUT_MS = 5000
const CACHE_MS = 30 * 60 * 1000
const cache = new Map()

export function isPrivateIp(ip) {
  const raw = String(ip || '').trim().toLowerCase()
  if (!raw) return true
  if (raw.includes(':')) {
    if (raw === '::1' || raw === '::') return true
    if (raw.startsWith('fe80:') || raw.startsWith('fc') || raw.startsWith('fd')) return true
    const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateIp(mapped[1])
    return false
  }
  const p = raw.split('.').map((n) => Number(n))
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true
  if (p[0] === 169 && p[1] === 254) return true
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
  if (p[0] === 192 && p[1] === 168) return true
  return false
}

function blockedHost(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '')
  if (!h) return true
  if (h === 'localhost' || h === '0.0.0.0' || h === '[::1]') return true
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h.endsWith('.home') || h === 'metadata.google.internal') return true
  if (isIP(h)) return isPrivateIp(h)
  return false
}

/** Sync URL shape — used for og:image we hand to the browser (no DNS). */
export function assertHttpsShape(raw, { allowPort = false } = {}) {
  const s = String(raw || '').trim()
  if (!s || s.length > MAX_URL) throw new Error('unfurl: url too long or empty')
  let u
  try { u = new URL(s) } catch { throw new Error('unfurl: not a URL') }
  if (u.protocol !== 'https:') throw new Error('unfurl: https only')
  if (u.username || u.password) throw new Error('unfurl: no credentials')
  if (u.port && u.port !== '443' && !allowPort) throw new Error('unfurl: port refused')
  if (blockedHost(u.hostname)) throw new Error('unfurl: host refused')
  return u
}

export async function assertPublicHttps(raw) {
  const u = assertHttpsShape(raw)
  const addrs = await lookup(u.hostname, { all: true })
  if (!addrs.length) throw new Error('unfurl: host unresolved')
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error('unfurl: private address refused')
  }
  return u
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n).trim() : t
}

function metaContent(html, names) {
  const src = String(html || '')
  for (const name of names) {
    const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(
      `<meta\\b[^>]*?(?:property|name|itemprop)\\s*=\\s*["']${n}["'][^>]*?\\bcontent\\s*=\\s*["']([^"']+)["'][^>]*>`,
      'i',
    )
    const reFlip = new RegExp(
      `<meta\\b[^>]*?\\bcontent\\s*=\\s*["']([^"']+)["'][^>]*?(?:property|name|itemprop)\\s*=\\s*["']${n}["'][^>]*>`,
      'i',
    )
    const m = src.match(re) || src.match(reFlip)
    if (m && m[1]) return decodeEntities(m[1]).trim()
  }
  return ''
}

function linkHref(html, rels) {
  const src = String(html || '')
  for (const rel of rels) {
    const n = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(
      `<link\\b[^>]*?\\brel\\s*=\\s*["'][^"']*\\b${n}\\b[^"']*["'][^>]*?\\bhref\\s*=\\s*["']([^"']+)["'][^>]*>`,
      'i',
    )
    const reFlip = new RegExp(
      `<link\\b[^>]*?\\bhref\\s*=\\s*["']([^"']+)["'][^>]*?\\brel\\s*=\\s*["'][^"']*\\b${n}\\b[^"']*["'][^>]*>`,
      'i',
    )
    const m = src.match(re) || src.match(reFlip)
    if (m && m[1]) return decodeEntities(m[1]).trim()
  }
  return ''
}

function safeImageUrl(raw, pageUrl) {
  if (!raw) return ''
  let abs
  try { abs = new URL(raw, pageUrl).toString() } catch { return '' }
  try {
    assertHttpsShape(abs, { allowPort: false })
    return abs
  } catch {
    return ''
  }
}

/** Parse a page into a card. html is untrusted. */
export function parsePagePreview(html, pageUrl) {
  const host = (() => {
    try { return new URL(pageUrl).hostname.replace(/^www\./, '') } catch { return '' }
  })()
  const title = clip(
    metaContent(html, ['og:title', 'twitter:title']) ||
      decodeEntities((String(html).match(/<title[^>]*>([^<]{1,200})/i) || [])[1] || ''),
    180,
  )
  const description = clip(
    metaContent(html, ['og:description', 'twitter:description', 'description']),
    240,
  )
  const image = safeImageUrl(
    metaContent(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) ||
      linkHref(html, ['apple-touch-icon', 'apple-touch-icon-precomposed']),
    pageUrl,
  )
  return { host, title, description, image }
}

async function readCapped(res, max) {
  const reader = res.body && res.body.getReader ? res.body.getReader() : null
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.subarray(0, max).toString('utf8')
  }
  const chunks = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.byteLength
    chunks.push(Buffer.from(value))
    if (n >= max) break
  }
  try { reader.cancel() } catch { /* */ }
  return Buffer.concat(chunks).subarray(0, max).toString('utf8')
}

async function fetchPublicHtml(raw, hops = 0) {
  const u = await assertPublicHttps(raw)
  const r = await fetch(u, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      'user-agent': 'KRAY-Unfurl/1 (site card; +https://www.kray.network)',
    },
  })
  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get('location')
    if (!loc || hops >= MAX_HOPS) throw new Error('unfurl: redirect refused')
    return fetchPublicHtml(new URL(loc, u).toString(), hops + 1)
  }
  if (r.status < 200 || r.status >= 300) throw new Error('unfurl: page refused')
  const ct = String(r.headers.get('content-type') || '').toLowerCase()
  if (ct && !/text\/html|application\/xhtml|xml/.test(ct) && !/text\/plain/.test(ct)) {
    throw new Error('unfurl: not html')
  }
  return { finalUrl: u.toString(), html: await readCapped(r, MAX_HTML) }
}

export async function unfurlHttps(raw) {
  const key = String(raw || '').trim()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body
  let body
  try {
    const u = assertHttpsShape(key)
    const page = await fetchPublicHtml(u.toString())
    const preview = parsePagePreview(page.html, page.finalUrl)
    body = {
      ok: true,
      url: u.toString(),
      host: preview.host,
      title: preview.title,
      description: preview.description,
      image: preview.image,
    }
  } catch (e) {
    body = { ok: false, error: e && e.message ? e.message : 'unfurl refused' }
  }
  cache.set(key, { at: Date.now(), body })
  if (cache.size > 400) {
    const now = Date.now()
    for (const [k, v] of cache) {
      if (now - v.at > CACHE_MS) cache.delete(k)
    }
  }
  return body
}
