/**
 * BODY HASH LAW (v5) — skeleton uniqueness, A3 grandfather, curse+burn on bypass.
 *   node src/test/body-hash-law.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  inscribeMessageV2, inscribeMessageV4, inscribeMessageV5, BODY_HASH_RE,
} from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'
import { musicRelic } from '../../../kray-net/id3-cover.js'
import { bodyHashOf } from '../../../kray-net/body-hash.js'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}

function wallet(tag: string) {
  const sk = createHash('sha256').update('body-hash-law|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

function main() {
  console.log('\n╔═ BODY HASH LAW — v5 · A3 · curse+burn ═╗\n')
  ok(BODY_HASH_RE.test('a'.repeat(64)), 'BODY_HASH_RE accepts 64 hex')
  ok(!BODY_HASH_RE.test('A'.repeat(64)), 'uppercase hex is refused')

  const A = wallet('A')
  const L = new KrayLedger(undefined, NET)
  L.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: A.addr, amount: '10000' } as KrayEvent)
  let seq = 1
  const next = () => ++seq
  const sign = (fields: Record<string, unknown>, build: (n: number) => string) => {
    const n = L.nonceOf(A.addr)
    return {
      seq: next(), at: 0, from: A.addr, publicKey: A.pk, signature: _signKrayWallet(build(n), A.sk), scheme: 'kraywallet',
      ...fields, nonce: n,
    } as unknown as KrayEvent
  }

  const root0 = L.cascadeRoot()
  const chV4 = createHash('sha256').update('v4-audio-grandfather').digest('hex')
  L.applyLive(sign({
    kind: 'inscribe', hash: 'v4a', contentHash: chV4, contentType: 'audio/mpeg', size: 8,
  }, (n) => inscribeMessageV2(NET, A.addr, chV4, 'audio/mpeg', 8, undefined, n)))
  ok(L.stars.star(0n)?.contentHash === chV4, 'A3 — v2 audio/mpeg without bodyHash still born')
  ok(!L.stars.isBodyTaken(chV4), 'grandfathered audio is not in bodySeen')

  const L2 = new KrayLedger(undefined, NET)
  L2.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: A.addr, amount: '10000' } as KrayEvent)
  L2.applyLive({
    seq: 2, kind: 'inscribe', hash: 'v4a', at: 0, from: A.addr, contentHash: chV4, contentType: 'audio/mpeg', size: 8,
    nonce: 0, publicKey: A.pk, signature: _signKrayWallet(inscribeMessageV2(NET, A.addr, chV4, 'audio/mpeg', 8, undefined, 0), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L.stars.merkleRoot() === L2.stars.merkleRoot(), 'A3 — two v2 audio journals share the star merkle (no body line)')
  ok(root0 !== L.cascadeRoot(), 'a new star moves the cascade (as any inscribe would)')

  const mpeg = Uint8Array.from([0xff, 0xfb, 0xe0, 0x00, ...createHash('sha256').update('law-mpeg').digest()])
  const relic1 = musicRelic(mpeg, Uint8Array.from([...PNG, 1]), 'image/png')
  const relic2 = musicRelic(mpeg, Uint8Array.from([...PNG, 2]), 'image/png')
  const h1 = createHash('sha256').update(relic1).digest('hex')
  const h2 = createHash('sha256').update(relic2).digest('hex')
  const gene = bodyHashOf(relic1, 'audio/mpeg')!
  ok(gene === bodyHashOf(relic2, 'audio/mpeg'), 'both relics share a gene')
  ok(h1 !== h2, 'covers differ so contentHash differs')

  const burned0 = L.totalBurned
  L.applyLive(sign({
    kind: 'inscribe', hash: 'm1', contentHash: h1, contentType: 'audio/mpeg', size: relic1.length, bodyHash: gene,
  }, (n) => inscribeMessageV5(NET, A.addr, h1, 'audio/mpeg', relic1.length, [], [], gene, n)))
  ok(L.stars.isBodyTaken(gene), 'first writer owns the gene')
  ok(L.stars.starOfBody(gene) === 1n, 'starOfBody points at the living star')

  const cursed = L.stars.inscriptions().length
  L.applyLive(sign({
    kind: 'inscribe', hash: 'm2', contentHash: h2, contentType: 'audio/mpeg', size: relic2.length, bodyHash: gene,
  }, (n) => inscribeMessageV5(NET, A.addr, h2, 'audio/mpeg', relic2.length, [], [], gene, n)))
  ok(L.stars.inscriptions().length === cursed + 1, 'bypass records a cursed inscription')
  ok(L.stars.inscriptions().at(-1)?.cursed === true && L.stars.inscriptions().at(-1)?.cursedReason === 'duplicate', 'same gene is cursed duplicate')
  ok(L.stars.starCount === 2, 'cursed clone did not mint a star (v2 audio + first music)')
  ok(L.totalBurned === burned0 + 2n, 'reducer curse+burn — paid to try, same as contentSeen')

  const trimmed = Uint8Array.from([...mpeg, 0x99])
  const relicT = musicRelic(trimmed, PNG, 'image/png')
  const hT = createHash('sha256').update(relicT).digest('hex')
  const geneT = bodyHashOf(relicT, 'audio/mpeg')!
  ok(geneT !== gene, 'one extra MPEG byte is another gene')
  L.applyLive(sign({
    kind: 'inscribe', hash: 'mt', contentHash: hT, contentType: 'audio/mpeg', size: relicT.length, bodyHash: geneT,
  }, (n) => inscribeMessageV5(NET, A.addr, hT, 'audio/mpeg', relicT.length, [], [], geneT, n)))
  ok(L.stars.isBodyTaken(geneT), 'honest limit: a trimmed work is born')

  const blob = '{"title":"x"}'
  ok(inscribeMessageV5(NET, A.addr, h1, 'audio/mpeg', 8, [], [], gene, 0, undefined, blob).includes('|meta='), 'v5 may carry meta LAST')
  ok(!inscribeMessageV5(NET, A.addr, h1, 'audio/mpeg', 8, [], [], gene, 0).includes('|meta='), 'v5 without JSON has no meta field')

  rejects(() => L.applyLive(sign({
    kind: 'inscribe', hash: 'bad', contentHash: 'ab'.repeat(32), contentType: 'audio/mpeg', size: 4, bodyHash: 'ZZ',
  }, (n) => {
    void n
    return 'not-used'
  })), /bodyHash must be 64|does not verify|signature/, 'malformed bodyHash is refused before a clean apply')

  const L3 = new KrayLedger(undefined, NET)
  L3.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: A.addr, amount: '10000' } as KrayEvent)
  const burned3 = L3.totalBurned
  rejects(() => L3.applyLive({
    seq: 2, kind: 'inscribe', hash: 'p', at: 0, from: A.addr,
    contentHash: h1, contentType: 'audio/mpeg', size: relic1.length, bodyHash: gene, parent: '0',
    nonce: 0, publicKey: A.pk,
    signature: _signKrayWallet(inscribeMessageV2(NET, A.addr, h1, 'audio/mpeg', relic1.length, 0n, 0), A.sk),
    scheme: 'kraywallet',
  } as KrayEvent), /v5 body hash and the v2 singular parent|does not verify/, 'v5 cannot carry an unsigned v2 parent')
  ok(L3.totalBurned === burned3, 'refused v5+parent burned nothing')

  const chMeta = createHash('sha256').update('still-v4-png').digest('hex')
  L.applyLive(sign({
    kind: 'inscribe', hash: 'v4p', contentHash: chMeta, contentType: 'image/png', size: 16, meta: blob,
  }, (n) => inscribeMessageV4(NET, A.addr, chMeta, 'image/png', 16, [], [], blob, n)))
  ok(L.stars.star(L.stars.createdSeq - 1n)?.meta === blob, 'v4 without bodyHash stays on the frozen v4 path')

  if (fail) { console.log('\n  ' + fail + ' failed · ' + pass + ' passed\n'); process.exit(1) }
  console.log('\n  ' + pass + ' passed\n')
}

main()
