/**
 * CITIZEN MOUTH (set-profile) — paid identity seal (1 ₭) + hygiene on the journal.
 *   node src/test/set-profile.test.ts
 *
 * Pins: genesis root untouched · owner-only · forge refused · exactly 1 ₭ → Treasury ·
 * banner must be owned image · lose-banner-star clears banner · clear-all
 * drops profileCommitment · 160-byte bio · 1/day cooldown · identical refused ·
 * replay reproduces root · conservation holds.
 */
import { createHash } from 'node:crypto'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes,
  inscribeMessageV2, setProfileMessage, sendStarMessage, PROFILE_COOLDOWN_MS,
} from '../protocol/scheme.ts'
import { TREASURY } from '../protocol/kray-primitives.ts'
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
  let clock = 1_700_000_000_000
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
    fields: { description?: string; url?: string; bannerStar?: string; bannerUrl?: string; at?: number; fee?: string },
    signer: W = w,
  ) => {
    const description = fields.description ?? ''
    const url = fields.url ?? ''
    const bannerStar = fields.bannerStar ?? ''
    const bannerUrl = fields.bannerUrl ?? ''
    const at = fields.at ?? (clock += PROFILE_COOLDOWN_MS)
    const fee = fields.fee ?? '1'
    const nonce = L.nonceOf(w.addr)
    return apply({
      kind: 'set-profile', at, from: w.addr, fee,
      description, url, bannerStar, bannerUrl, nonce,
      publicKey: signer.pk,
      signature: sign(setProfileMessage(NET, w.addr, description, url, bannerStar, bannerUrl, nonce), signer),
      scheme: 'kraywallet',
    } as never)
  }
  const tryMouth = (
    w: W,
    fields: { description?: string; url?: string; bannerStar?: string; bannerUrl?: string; at?: number; fee?: string },
    signer: W = w,
  ) => {
    const description = fields.description ?? ''
    const url = fields.url ?? ''
    const bannerStar = fields.bannerStar ?? ''
    const bannerUrl = fields.bannerUrl ?? ''
    const at = fields.at ?? (clock + PROFILE_COOLDOWN_MS)
    const fee = fields.fee ?? '1'
    const nonce = L.nonceOf(w.addr)
    const e = {
      seq: seq + 1, prevHash: '', hash: 'hx', at, kind: 'set-profile' as const, from: w.addr, fee,
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
  return { L, journal, mint, born, mouth, tryMouth, send, get clock() { return clock } }
}

function main() {
  console.log('\n╔═ CITIZEN MOUTH — set-profile · 1 ₭ · owner-only · 160B · 1/day · cascade by presence ═╗\n')

  ok(new KrayLedger(undefined, NET).cascadeParts().profileCommitment === undefined,
    'no mouths ⇒ profileCommitment absent (A3)')
  const g1 = new KrayLedger(undefined, NET).cascadeRoot()
  ok(new KrayLedger(undefined, NET).cascadeRoot() === g1,
    'empty ledgers share the genesis cascade root')
  ok(new KrayLedger(undefined, NET).profileValueActive(1) === true,
    'regtest PROFILE_VALUE_SEQ = 0 (paid law born active)')

  const A = wallet('alice'), B = wallet('bob'), M = wallet('mallory')

  const a = book()
  a.mint(A.addr, '100')
  a.mint(B.addr, '100')
  const banner = a.born(A, 'alice-banner')
  const textStar = a.born(A, 'alice-text', 'text/plain')

  const balBefore = a.L.balanceOf(A.addr)
  const treBefore = a.L.balanceOf(TREASURY)
  a.mouth(A, {
    description: 'Hello book',
    url: 'https://example.com',
    bannerStar: banner.toString(),
    bannerUrl: 'https://example.com/promo',
  })
  const mouth = a.L.profileOf(A.addr)
  ok(!!mouth && mouth.description === 'Hello book' && mouth.url === 'https://example.com'
    && mouth.bannerStar === banner.toString() && mouth.bannerUrl === 'https://example.com/promo',
    'Alice mouth sealed')
  ok(a.L.balanceOf(A.addr) === balBefore - 1n, 'set-profile took exactly 1 ₭')
  ok(a.L.balanceOf(TREASURY) === treBefore + 1n, '1 ₭ landed in Treasury (byte-proven fee)')
  ok(a.L.conserves(), 'conservation holds after set-profile')
  ok(a.L.profileNextAtOf(A.addr) === (a.L.profileLastAtOf(A.addr)! + PROFILE_COOLDOWN_MS),
    'nextAt = lastAt + 1 day')

  rejects(() => a.tryMouth(A, {
    description: 'Hello book',
    url: 'https://example.com',
    bannerStar: banner.toString(),
    bannerUrl: 'https://example.com/promo',
    at: a.clock + PROFILE_COOLDOWN_MS,
  }), /identical|unchanged/i, 'identical mouth refused')

  rejects(() => a.tryMouth(A, {
    description: 'too soon',
    url: '',
    bannerStar: '',
    bannerUrl: '',
    at: a.L.profileLastAtOf(A.addr)!,
  }), /cooldown/i, 'rewrite inside the same day refused')

  rejects(() => a.tryMouth(A, { description: 'no pay', fee: '0', at: a.clock + PROFILE_COOLDOWN_MS }),
    /exactly 1/, 'fee 0 refused under paid law')
  rejects(() => a.tryMouth(A, { description: 'overpay', fee: '2', at: a.clock + PROFILE_COOLDOWN_MS }),
    /exactly 1/, 'fee 2 refused under paid law')

  a.mouth(A, { description: 'Rotated bio', url: '', bannerStar: '', bannerUrl: '' })
  ok(a.L.profileOf(A.addr)?.description === 'Rotated bio' && a.L.profileOf(A.addr)?.bannerStar === '',
    'Alice rotates after cooldown (pays 1 ₭ again)')

  rejects(() => a.tryMouth(A, { description: 'hijack' }, M), /signature|signed/i,
    'Mallory cannot set Alice’s mouth (forged signature refused)')
  ok(a.L.profileOf(A.addr)?.description === 'Rotated bio', 'Alice’s mouth unchanged after forge')

  rejects(() => a.tryMouth(A, { url: 'http://insecure.example' }), /https/i,
    'http (non-https) site URL refused')
  rejects(() => a.tryMouth(A, { description: 'pipe|bad' }), /\| or newlines/i,
    'description with | refused')
  rejects(() => a.tryMouth(A, { description: 'x'.repeat(161) }), /cap is 160/i,
    'description over 160 bytes (X bio) refused')
  rejects(() => a.tryMouth(A, { bannerStar: textStar.toString() }), /image star/i,
    'non-image star refused as banner')

  const bobBanner = a.born(B, 'bob-banner')
  rejects(() => a.tryMouth(A, { bannerStar: bobBanner.toString() }), /owner/i,
    'Alice cannot wear Bob’s star as banner')

  a.mouth(A, {
    description: 'keep me',
    url: 'https://example.com',
    bannerStar: banner.toString(),
    bannerUrl: 'https://example.com/x',
  })
  a.send(A, banner, B.addr)
  ok(a.L.profileOf(A.addr)?.bannerStar === '' && a.L.profileOf(A.addr)?.description === 'keep me',
    'sending the banner star clears only the banner binding')

  a.mouth(A, { description: '', url: '', bannerStar: '', bannerUrl: '' })
  ok(a.L.profileOf(A.addr) === null, 'clear-all deletes the mouth')
  ok(a.L.cascadeParts().profileCommitment === undefined,
    'empty mouth book ⇒ profileCommitment absent again')
  ok(a.L.profileLastAtOf(A.addr) != null, 'gap clock survives clear (anti-spam)')

  const b = book()
  for (const e of a.journal) b.L.applyLive({ ...e })
  ok(b.L.cascadeRoot() === a.L.cascadeRoot() && b.L.profileOf(A.addr) === null,
    'stranger replay reproduces cascade root + cleared mouth')
  ok(b.L.profileNextAtOf(A.addr) === a.L.profileNextAtOf(A.addr),
    'stranger replay reproduces mouth gap clock')

  console.log(`\n${pass} passed, ${fail} failed\n`)
  if (fail) process.exit(1)
}
main()
