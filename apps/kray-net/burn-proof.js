/* THE BURN PROOF, IN YOUR OWN BROWSER — the complete chain from Bitcoin's generator point to the burn address,
 * recomputed in-page from open, readable math (view source; the truly zero-trust run is the local CLI
 * apps/kray-net/burn-verify.mjs, since a doctored node could serve tampered JS). Plain script, no dependencies: SHA-256 comes
 * from the browser's own WebCrypto, and the secp256k1 curve math is right here in ~40 lines of BigInt, readable
 * by any auditor. The SAME file runs under Node for the byte-exactness test — one source of truth, two runtimes.
 *
 * Exposes globalThis.BurnProof = { derive(blockNumber, rootHex, net) } → every intermediate value of the chain:
 *   G → SHA256(G)=NUMS → payload → commit → tweak → output key → bech32m address
 * If derive(...).address equals the address a donation actually paid, that donation's sats sit behind a key
 * that PROVABLY exists for nobody (spending would need the discrete log of a SHA-256 output).
 */
(function () {
  'use strict'

  // ── secp256k1, the curve Bitcoin itself runs on (public constants, fixed since 2009) ──
  const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn // field prime
  const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n // group order
  const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n
  const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n

  const mod = (a, m) => ((a % m) + m) % m
  function modpow(b, e, m) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n } return r }
  const modinv = (a, m) => modpow(mod(a, m), m - 2n, m) // m prime (Fermat)

  // affine point ops — clarity over speed; a proof page runs this once
  function pointDouble(pt) {
    if (!pt) return null
    const l = mod(3n * pt.x * pt.x * modinv(2n * pt.y, P), P)
    const x = mod(l * l - 2n * pt.x, P)
    return { x, y: mod(l * (pt.x - x) - pt.y, P) }
  }
  function pointAdd(a, b) {
    if (!a) return b
    if (!b) return a
    if (a.x === b.x) { if (mod(a.y + b.y, P) === 0n) return null; return pointDouble(a) }
    const l = mod((b.y - a.y) * modinv(b.x - a.x, P), P)
    const x = mod(l * l - a.x - b.x, P)
    return { x, y: mod(l * (a.x - x) - a.y, P) }
  }
  function pointMul(k, pt) { let r = null, q = pt; k = mod(k, N); while (k > 0n) { if (k & 1n) r = pointAdd(r, q); q = pointDouble(q); k >>= 1n } return r }
  /** BIP-340 lift_x: the even-Y point with this x (y² = x³ + 7). */
  function liftX(x) {
    const y2 = mod(x * x * x + 7n, P)
    let y = modpow(y2, (P + 1n) / 4n, P) // P ≡ 3 (mod 4)
    if (mod(y * y, P) !== y2) throw new Error('not a curve point')
    if (y & 1n) y = P - y
    return { x, y }
  }

  // ── bytes + hashing (SHA-256 from the platform's own WebCrypto — browser or Node) ──
  const h2b = (h) => { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o }
  const b2h = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  const big = (h) => BigInt('0x' + h)
  const hex32 = (n2) => n2.toString(16).padStart(64, '0')
  const cat = (...as) => { const t = as.reduce((s, a) => s + a.length, 0), o = new Uint8Array(t); let i = 0; for (const a of as) { o.set(a, i); i += a.length } return o }
  async function sha256(bytes) { return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)) }
  async function taggedHash(tag, bytes) { const t = await sha256(new TextEncoder().encode(tag)); return sha256(cat(t, t, bytes)) }

  // ── bech32m (BIP-350) — the address encoding, in the open ──
  const CS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
  function polymod(vs) { const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; let c = 1; for (const v of vs) { const t = c >>> 25; c = ((c & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((t >>> i) & 1) c ^= GEN[i] } return c }
  function hrpExpand(h) { const o = []; for (let i = 0; i < h.length; i++) o.push(h.charCodeAt(i) >>> 5); o.push(0); for (let i = 0; i < h.length; i++) o.push(h.charCodeAt(i) & 31); return o }
  function convertBits(data, from, to) { let acc = 0, bits = 0; const o = [], max = (1 << to) - 1; for (const v of data) { acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; o.push((acc >>> bits) & max) } } if (bits > 0) o.push((acc << (to - bits)) & max); return o }
  function bech32m(hrp, words) { const vals = [...hrpExpand(hrp), ...words]; const m = polymod([...vals, 0, 0, 0, 0, 0, 0]) ^ 0x2bc830a3; let out = hrp + '1'; const ck = []; for (let i = 0; i < 6; i++) ck.push((m >>> (5 * (5 - i))) & 31); for (const d of [...words, ...ck]) out += CS[d]; return out }

  const HRP = { main: 'bc', mainnet: 'bc', signet: 'tb', testnet: 'tb', regtest: 'bcrt' }

  /** The whole chain, every intermediate exposed. Nothing here trusts the server that served this file. */
  async function derive(blockNumber, rootHex, net) {
    if (!/^[0-9a-f]{64}$/i.test(rootHex)) throw new Error('root must be 64 hex chars')
    if (!Number.isInteger(blockNumber) || blockNumber < 0) throw new Error('blockNumber must be a whole number')
    const hrp = HRP[net || 'signet']; if (!hrp) throw new Error('unknown network')

    // STEP 1-2 · Bitcoin's generator, hashed → the NUMS key (chosen by nobody)
    const id = await numsIdentity()
    const numsX = id.numsX
    const numsIsHashOfG = id.numsIsHashOfG
    const H = liftX(big(numsX)) // a REAL curve point — lift_x succeeds

    // STEP 3 · the public anchor bytes ("KRAY.NETWORK" | v1 | block | root) — same 49 bytes KRAY always anchors
    const payload = b2h(new TextEncoder().encode('KRAY.NETWORK'))
      + '01' + blockNumber.toString(16).padStart(8, '0') + rootHex.toLowerCase()

    // STEP 4 · commit + the standard BIP-341 tweak: Q = H + t·G
    const commit = b2h(await taggedHash('kray-core.self-anchor.v1', h2b(payload)))
    const t = mod(big(b2h(await taggedHash('TapTweak', h2b(numsX + commit)))), N)
    const Q = pointAdd(H, pointMul(t, { x: GX, y: GY }))
    const outputKey = hex32(Q.x)

    // STEP 5 · plain bech32m of that key — the burn address
    const address = bech32m(hrp, [1, ...convertBits(h2b(outputKey), 8, 5)])

    return { gx: id.gx, gy: id.gy, uncompressedG: id.uncompressedG, numsX, numsIsHashOfG, payload, commit, tweak: hex32(t), outputKey, address }
  }

  // BIP-341 § note: the taproot NUMS point is SHA256 of uncompressed G. No human chose the bytes.
  const BIP341_NUMS = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0'

  /** NUMS identity alone — no block, no root, no server. SHA256(uncompressed G) ≟ BIP-341 constant. */
  async function numsIdentity() {
    const uncompressedG = h2b('04' + hex32(GX) + hex32(GY))
    const numsX = b2h(await sha256(uncompressedG))
    return {
      gx: hex32(GX),
      gy: hex32(GY),
      uncompressedG: b2h(uncompressedG),
      numsX,
      bip341: BIP341_NUMS,
      numsIsHashOfG: numsX === BIP341_NUMS,
    }
  }

  globalThis.BurnProof = { derive, numsIdentity, BIP341_NUMS }
})()
