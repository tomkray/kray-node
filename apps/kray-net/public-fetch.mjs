/**
 * PUBLIC FETCH — mint-art door. Resolve, refuse a private A/AAAA, then dial
 * only those pinned addresses. A name that looks public and rebinds to
 * 169.254.169.254 never reaches the socket.
 *
 * Not consensus. 3xx is refused so a redirect cannot walk around the pin.
 * Uses node:http / node:https (Host + SNI stay the name; the IP is the pin).
 */
import http from 'node:http'
import https from 'node:https'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isPublicAddress, isPublicHttpHost } from '../kray-core/src/protocol/public-host.ts'

/**
 * @param {string} url
 * @param {(hostname: string, opts: { all: true }) => Promise<{ address: string, family: number }[]>} [lookupFn]
 * @returns {Promise<{ address: string, family: number }[]>}
 */
export async function pinPublicAddresses(url, lookupFn) {
  if (!isPublicHttpHost(url)) throw new Error('art URL must be a public http(s) host')
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
  const family = isIP(host)
  if (family) {
    if (!isPublicAddress(host)) throw new Error('art host is not a public address')
    return [{ address: host, family }]
  }
  const resolve = lookupFn || ((name, opts) => dnsLookup(name, opts))
  const addrs = await resolve(host, { all: true })
  if (!Array.isArray(addrs) || !addrs.length) throw new Error('art host did not resolve')
  for (const a of addrs) {
    if (!isPublicAddress(a.address)) throw new Error('art host resolved to a private address')
  }
  return addrs.map((a) => ({ address: a.address, family: a.family }))
}

function requestPinned(url, pin, signal, timeoutMs) {
  const u = new URL(url)
  const lib = u.protocol === 'https:' ? https : http
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80)
  const name = u.hostname.replace(/^\[|\]$/g, '')
  return new Promise((resolve, reject) => {
    const req = lib.request({
      host: pin.address,
      port,
      method: 'GET',
      path: `${u.pathname || '/'}${u.search}`,
      headers: { Host: u.host },
      servername: name,
      timeout: timeoutMs,
    }, (res) => {
      const code = res.statusCode || 0
      if (code >= 300 && code < 400) {
        res.resume()
        reject(new Error('redirect refused'))
        return
      }
      const parts = []
      res.on('data', (c) => parts.push(c))
      res.on('end', () => {
        const headers = new Headers()
        for (const [k, v] of Object.entries(res.headers)) {
          if (v == null) continue
          headers.set(k, Array.isArray(v) ? v.join(', ') : String(v))
        }
        resolve(new Response(Buffer.concat(parts), { status: code, headers }))
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    const onAbort = () => { req.destroy(); reject(new Error('aborted')) }
    if (signal) {
      if (signal.aborted) { onAbort(); return }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    req.end()
  })
}

/**
 * Fetch `url` only after every resolved address is public. Connect uses the
 * first pinned address — a later DNS answer cannot retarget the socket.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number, signal?: AbortSignal, lookupFn?: Function, fetchImpl?: Function }} [opts]
 */
export async function fetchPublicUrl(url, opts = {}) {
  const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : 8000
  const pins = await pinPublicAddresses(url, opts.lookupFn)
  const signal = opts.signal || AbortSignal.timeout(timeoutMs)
  if (typeof opts.fetchImpl === 'function') {
    return opts.fetchImpl(url, { redirect: 'error', signal })
  }
  return requestPinned(url, pins[0], signal, timeoutMs)
}
