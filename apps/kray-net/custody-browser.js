/**
 * CUSTODY — browser twin of apps/kray-core/src/economics/custody.ts
 *
 * Byte-identical challenge / answer / pack / aggregate / claim.
 * The tab proves it HOLDS the atlas. The spending key never leaves KrayWallet.
 *
 * Domain strings and 6-byte BE modulo MUST stay locked to custody.ts.
 */
(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.KrayCustody = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  var K = 8
  var te = new TextEncoder()

  function hex(u8) {
    var s = ''
    for (var i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0')
    return s
  }

  function readUIntBE6(u8) {
    // custody.ts: hash.readUIntBE(0, 6) — 48-bit, exact in JS Number
    var n = 0
    for (var i = 0; i < 6; i++) n = n * 256 + u8[i]
    return n
  }

  async function sha256(buf) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
  }

  async function sha256Hex(buf) {
    return hex(await sha256(buf))
  }

  async function sha256Utf8(s) {
    return sha256(te.encode(s))
  }

  async function challenges(beacon, address, atlasSize, k) {
    if (k == null) k = K
    if (!/^[0-9a-f]{64}$/.test(beacon)) throw new Error('custody: the beacon must be a 32-byte Bitcoin block hash (hex)')
    if (!Number.isInteger(atlasSize) || atlasSize < 0) throw new Error('custody: atlasSize must be a whole count')
    if (atlasSize === 0) return []
    var out = []
    for (var i = 0; i < k; i++) {
      var h = await sha256Utf8('kray-core.custody-challenge.v1|' + beacon + '|' + address + '|' + i)
      out.push(readUIntBE6(h) % atlasSize)
    }
    return out
  }

  async function answer(bytes, beacon, address) {
    var salt = te.encode('|' + beacon + '|' + address)
    var cat = new Uint8Array(bytes.length + salt.length)
    cat.set(bytes, 0)
    cat.set(salt, bytes.length)
    return sha256Hex(cat)
  }

  function packHits(hits) {
    var out = new Uint8Array(Math.ceil(hits.length / 8))
    for (var i = 0; i < hits.length; i++) if (hits[i]) out[i >> 3] |= 1 << (i & 7)
    return hex(out)
  }

  async function aggregateAnswers(answers) {
    return sha256Hex(te.encode('kray-core.custody-aggregate.v1|' + answers.join('|')))
  }

  function toHex(claim) {
    return claim.hits + claim.aggregate
  }

  async function buildClaim(beacon, address, oracle, k) {
    if (k == null) k = K
    var idx = await challenges(beacon, address, oracle.contents.length, k)
    var hits = []
    var answers = []
    for (var i = 0; i < idx.length; i++) {
      var bytes = oracle.bytesOf(oracle.contents[idx[i]])
      hits.push(bytes != null)
      if (bytes != null) answers.push(await answer(bytes, beacon, address))
    }
    return { hits: packHits(hits), aggregate: await aggregateAnswers(answers) }
  }

  return {
    K: K,
    sha256Hex: sha256Hex,
    challenges: challenges,
    answer: answer,
    packHits: packHits,
    aggregateAnswers: aggregateAnswers,
    toHex: toHex,
    buildClaim: buildClaim,
  }
})
