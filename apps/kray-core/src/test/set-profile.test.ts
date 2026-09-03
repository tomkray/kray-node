/**
 * CITIZEN MOUTH (set-profile) — feeless bio / site URL / banner on the journal.
 *   node src/test/set-profile.test.ts
 *
 * Pins: genesis root untouched · owner-only · forge refused · no ₭ moved ·
 * banner must be owned image · lose-banner-star clears banner · clear-all
 * drops profileCommitment · replay reproduces root · conservation holds.
 */
import { createHash } from 'node:crypto'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes,
  inscribeMessageV2, setProfileMessage, sendStarMessage,
} from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'
import * as btc from '@scure/btc-signer'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); fail++; console.log('  ✗ FAIL (accepted!) — ' + m) }
  catch (e) {
    const s = e instanceof Error ? e.message : String(e)
    if (re.test(s)) { pass++; console.log('  ✓ ' + m) }
    else { fail++; console.log(`  ✗ FAIL (wrong refusal "${s}") — ` + m) }
  }
}

interface W { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`set-profile|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)

function book() {
  let seq = 0
  const journal: KrayEvent[] = []
  const L = new KrayLedger(undefined, NET)
  const apply = (e: Omit<KrayEvent, 'seq' | 'hash' | 'prevHash'> & { hash?: string }) => {
    const full = { ...e, seq: ++seq, hash: e.hash ?? ('h' + seq), prevHash: '' } as KrayEvent
    L.applyLive(full)
    journal.push(full)
    return full
  }
  const mint = (to: string, amt: string) =>
    apply({ kind: 'donate', at: seq + 1, to, amount: amt, outpoint: createHash('sha256').update('o' + (seq + 1)).digest('hex') + ':0' } as never)
  const born = (owner: W, tag: string, ctype = 'image/png'): bigint => {
    const before = L.stars.createdSeq
    const nonce = L.nonceOf(owner.addr)
    const body = tag
    const ch = createHash('sha256').update(body).digest('hex')
    const msg = inscribeMessageV2(NET, owner.addr, ch, ctype, body.length, undefined, nonce)
    apply({
      kind: 'inscribe', at: 0, from: owner.addr, contentHash: ch, contentType: ctype, size: body.length,
      nonce, publicKey: owner.pk, signature: sign(msg, owner), scheme: 'kraywallet',
    } as never)
    return BigInt(before)
  }
  const mouth = (
    w: W,
    fields: { description?: string; url?: string; bannerStar?: string; bannerUrl?: string },
    signer: W = w,
  ) => {
    const description = fields.description ?? ''
    const url = fields.url ?? ''
    const bannerStar = fields.bannerStar ?? ''
    const bannerUrl = fields.bannerUrl ?? ''
    const nonce = L.nonceOf(w.addr)
    return apply({
      kind: 'set-profile', at: 0, from: w.addr,
      description, url, bannerStar, bannerUrl, nonce,
      publicKey: signer.pk,
      signature: sign(setProfileMessage(NET, w.addr, description, url, bannerStar, bannerUrl, nonce), signer),
      scheme: 'kraywallet',
    } as never)
  }
  const tryMouth = (
    w: W,
    fields: { description?: string; url?: string; bannerStar?: string; bannerUrl?: string },
    signer: W = w,
  ) => {
    const description = fields.description ?? ''
    const url = fields.url ?? ''
    const bannerStar = fields.bannerStar ?? ''
    const bannerUrl = fields.bannerUrl ?? ''
    const nonce = L.nonceOf(w.addr)
    const e = {
      seq: seq + 1, prevHash: '', hash: 'hx', at: 0, kind: 'set-profile' as const, from: w.addr,
      description, url, bannerStar, bannerUrl, nonce, publicKey: signer.pk,
      signature: sign(setProfileMessage(NET, w.addr, description, url, bannerStar, bannerUrl, nonce), signer),
      scheme: 'kraywallet',
    } as KrayEvent
    L.applyLive(e)
  }
  const send = (w: W, star: bigint, to: string) => {
    const nonce = L.nonceOf(w.addr)
    return apply({
      kind: 'transfer-star', at: 0, from: w.addr, to, star: star.toString(), fee: '1', nonce,
      publicKey: w.pk, signature: sign(sendStarMessage(NET, w.addr, to, star, nonce), w), scheme: 'kraywallet',
    } as never)
  }
  return { L, journal, mint, born, mouth, tryMouth, send }
}

function main() {
  console.log('\n╔═ CITIZEN MOUTH — set-profile · feeless · owner-only · cascade by presence ═╗\n')

  ok(new KrayLedger(undefined, NET).cascadeParts().profileCommitment === undefined,
    'no mouths ⇒ profileCommitment absent (A3)')
  const g1 = new KrayLedger(undefined, NET).cascadeRoot()
  ok(new KrayLedger(undefined, NET).cascadeRoot() === g1,
    'empty ledgers share the genesis cascade root')

  const A = wallet('alice'), B = wallet('bob'), M = wallet('mallory')

  const a = book()
  a.mint(A.addr, '100')
  a.mint(B.addr, '50')
  const banner = a.born(A, 'banner-png')
  const textStar = a.born(A, 'not-an-image', 'text/plain')
  const rootBefore = a.L.cascadeRoot()
  const balBefore = a.L.balanceOf(A.addr)

  a.mouth(A, {
    description: 'Builder on the book',
    url: 'https://example.com',
    bannerStar: banner.toString(),
    bannerUrl: 'https://example.com/promo',
  })
  const mouth = a.L.profileOf(A.addr)
  ok(!!mouth && mouth.description === 'Builder on the book' && mouth.url === 'https://example.com'
    && mouth.bannerStar === banner.toString() && mouth.bannerUrl === 'https://example.com/promo',
    'Alice mouth lands on the journal')
  ok(a.L.cascadeRoot() !== rootBefore, 'a set mouth folds into the cascade root')
  ok(a.L.balanceOf(A.addr) === balBefore, 'set-profile moved NO ₭')
  ok(a.L.conserves(), 'conservation holds after set-profile')

  // rotate / clear fields
  a.mouth(A, { description: 'Rotated bio', url: '', bannerStar: '', bannerUrl: '' })
  ok(a.L.profileOf(A.addr)?.description === 'Rotated bio' && a.L.profileOf(A.addr)?.bannerStar === '',
    'owner may rotate / clear fields')

  // hostile
  rejects(() => a.tryMouth(A, { description: 'hijack' }, M), /signature|signed/i,
    'Mallory cannot set Alice’s mouth (forged signature refused)')
  ok(a.L.profileOf(A.addr)?.description === 'Rotated bio', 'Alice’s mouth unchanged after forge')

  rejects(() => a.tryMouth(A, { url: 'http://insecure.example' }), /https/i,
    'http (non-https) site URL refused')
  rejects(() => a.tryMouth(A, { description: 'pipe|bad' }), /\| or newlines/i,
    'description with | refused')
  rejects(() => a.tryMouth(A, { bannerStar: textStar.toString() }), /image star/i,
    'non-image star refused as banner')

  const bobBanner = a.born(B, 'bob-banner')
  rejects(() => a.tryMouth(A, { bannerStar: bobBanner.toString() }), /owner/i,
    'Alice cannot wear Bob’s star as banner')

  // restore banner then lose it via send
  a.mouth(A, {
    description: 'keep me',
    url: 'https://example.com',
    bannerStar: banner.toString(),
    bannerUrl: 'https://example.com/x',
  })
  a.send(A, banner, B.addr)
  ok(a.L.profileOf(A.addr)?.bannerStar === '' && a.L.profileOf(A.addr)?.description === 'keep me',
    'sending the banner star clears only the banner binding')

  // clear all → drop from cascade
  a.mouth(A, { description: '', url: '', bannerStar: '', bannerUrl: '' })
  ok(a.L.profileOf(A.addr) === null, 'clear-all deletes the mouth')
  ok(a.L.cascadeParts().profileCommitment === undefined,
    'empty mouth book ⇒ profileCommitment absent again')

  // replay
  const b = book()
  for (const e of a.journal) b.L.applyLive({ ...e })
  ok(b.L.cascadeRoot() === a.L.cascadeRoot() && b.L.profileOf(A.addr) === null,
    'stranger replay reproduces cascade root + cleared mouth')

  console.log(`\n${pass} passed, ${fail} failed\n`)
  if (fail) process.exit(1)
}
main()
