/**
 * KRAY PLATE — living plate: hash in journal, bytes in atlas, 1 ₭, owner-only.
 *   node --experimental-strip-types src/test/kray-plate.test.ts
 */
import { createHash } from 'node:crypto'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes,
  inscribeMessageV2, sendStarMessage,
} from '../protocol/scheme.ts'
import {
  encodeKrayPlate, hashKrayPlate, setKrayPlateMessage, assertKrayPlateBytes,
} from '../protocol/kray-plate.ts'
import { TREASURY, type KrayEvent } from '../protocol/kray-primitives.ts'
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
type Fields = { description: string; url: string; bannerUrl: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`kray-plate|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)

function main() {
  console.log('\n╔═ KRAY PLATE — hash seal · 1 ₭ · owner-only · cascade by presence ═╗\n')

  const fields: Fields = { description: 'Hello plate', url: 'https://example.com', bannerUrl: '' }
  const buf = encodeKrayPlate(fields)
  const h = hashKrayPlate(fields)
  ok(h.length === 64, 'plate hash is 64 hex')
  ok(assertKrayPlateBytes(h, buf).description === 'Hello plate', 'assertKrayPlateBytes round-trip')
  ok(Buffer.compare(buf, Buffer.from(
    'kray-plate.v1\ndesc=Hello plate\nurl=https://example.com\nbannerUrl=\n', 'utf8',
  )) === 0, 'no-act payload byte-identical to pre-act v1 (A3)')
  rejects(() => assertKrayPlateBytes(h, Buffer.from('tampered')), /match|refuse|version/i, 'tampered atlas refused')
  rejects(() => encodeKrayPlate({
    description: 'x', url: '', bannerUrl: '', actTo: '', actHint: 'like', actAmount: '',
  }), /require actTo/i, 'actHint without actTo refused')
  rejects(() => encodeKrayPlate({
    description: 'x', url: '', bannerUrl: '', actTo: 'not-an-address', actHint: '', actAmount: '',
  }), /bech32|actTo/i, 'junk actTo refused')

  const atlas = new Map<string, Uint8Array>()
  const A = wallet('alice'), B = wallet('bob'), M = wallet('mallory')

  const withAct = {
    description: 'Tip jar', url: '', bannerUrl: '',
    actTo: B.addr, actHint: 'gift', actAmount: '3',
  }
  const actBuf = encodeKrayPlate(withAct)
  const actH = hashKrayPlate(withAct)
  ok(assertKrayPlateBytes(actH, actBuf).actTo === B.addr, 'act block round-trips')
  ok(actBuf.includes(Buffer.from('actTo=' + B.addr)), 'actTo present in bytes when set')
  ok(!encodeKrayPlate(fields).includes(Buffer.from('actTo=')), 'actTo omitted when empty')
  ok(!encodeKrayPlate(fields).includes(Buffer.from('bannerStar=')), 'bannerStar omitted when empty (A3)')
  const withStar = { description: 'Promo', url: '', bannerUrl: '', bannerStar: '12' }
  const starBuf = encodeKrayPlate(withStar)
  ok(assertKrayPlateBytes(hashKrayPlate(withStar), starBuf).bannerStar === '12', 'bannerStar round-trips')
  ok(starBuf.includes(Buffer.from('bannerStar=12\n')), 'bannerStar present when set')
  rejects(() => encodeKrayPlate({
    description: 'x', url: '', bannerUrl: '', bannerStar: '01',
  }), /star number/i, 'leading-zero bannerStar refused')
  let seq = 0
  const journal: KrayEvent[] = []
  const L = new KrayLedger(undefined, NET, undefined, false, (hash) => atlas.get(hash) ?? null)
  const apply = (e: Omit<KrayEvent, 'seq' | 'hash' | 'prevHash'>) => {
    const full = { ...e, seq: ++seq, hash: 'h' + seq, prevHash: '' } as KrayEvent
    L.applyLive(full)
    journal.push(full)
    return full
  }
  const mint = (to: string) => apply({
    kind: 'donate', at: 1, to, amount: '10000',
    outpoint: createHash('sha256').update('o' + seq).digest('hex') + ':0',
  } as never)
  mint(A.addr); mint(B.addr)

  const born = (owner: W, tag: string): bigint => {
    const before = L.stars.createdSeq
    const body = tag
    const ch = createHash('sha256').update(body).digest('hex')
    const nonce = L.nonceOf(owner.addr)
    const msg = inscribeMessageV2(NET, owner.addr, ch, 'image/png', body.length, undefined, nonce)
    apply({
      kind: 'inscribe', at: 0, from: owner.addr, contentHash: ch, contentType: 'image/png', size: body.length,
      nonce, publicKey: owner.pk, signature: sign(msg, owner), scheme: 'kraywallet',
    } as never)
    return BigInt(before)
  }
  const star = born(A, 'alice-img')

  const put = (f: Fields) => {
    const ph = hashKrayPlate(f)
    atlas.set(ph, encodeKrayPlate(f))
    return ph
  }
  const seal = (w: W, plateHash: string, starNo = '', fee = '1') => {
    const nonce = L.nonceOf(w.addr)
    const msg = setKrayPlateMessage(NET, w.addr, plateHash, starNo, nonce)
    return apply({
      kind: 'set-kray-plate', at: Date.now(), from: w.addr, plateHash, star: starNo || undefined, fee,
      nonce, publicKey: w.pk, signature: sign(msg, w), scheme: 'kraywallet',
    } as never)
  }

  ok(L.cascadeParts().krayPlateCommitment === undefined, 'no plates ⇒ commitment absent (A3)')
  const g0 = L.cascadeRoot()

  const bal0 = L.balanceOf(A.addr)
  const tre0 = L.balanceOf(TREASURY)
  const h1 = put(fields)
  seal(A, h1)
  ok(L.krayPlateOf(A.addr) === h1, 'address plate sealed')
  ok(L.balanceOf(A.addr) === bal0 - 1n && L.balanceOf(TREASURY) === tre0 + 1n, 'exactly 1 ₭ → Treasury')
  ok(L.conserves(), 'conservation holds')
  ok(L.cascadeParts().krayPlateCommitment !== undefined, 'plate folds into cascade')
  ok(L.cascadeRoot() !== g0, 'cascade moves when plate appears')

  rejects(() => seal(A, h1), /identical|unchanged/i, 'identical plate refused')
  rejects(() => {
    const ph = put({ description: 'x', url: '', bannerUrl: '' })
    seal(A, ph, '', '0')
  }, /exactly 1/, 'fee 0 refused')

  rejects(() => {
    const ph = put({ description: 'hijack', url: '', bannerUrl: '' })
    const nonce = L.nonceOf(A.addr)
    const msg = setKrayPlateMessage(NET, A.addr, ph, '', nonce)
    apply({
      kind: 'set-kray-plate', at: 1, from: A.addr, plateHash: ph, fee: '1',
      nonce, publicKey: M.pk, signature: sign(msg, M), scheme: 'kraywallet',
    } as never)
  }, /signature|signed/i, 'Mallory cannot seal Alice address plate')

  const rotated = { description: 'Rotated', url: 'https://a.example', bannerUrl: '' }
  const h2 = put(rotated)
  seal(A, h2)
  ok(L.krayPlateOf(A.addr) === h2, 'address plate rotated (old hash not in tip)')

  const starFields = { description: 'Star post', url: 'https://star.example', bannerUrl: '' }
  const hs = put(starFields)
  seal(A, hs, star.toString())
  ok(L.krayStarPlateOf(star) === hs, 'star plate sealed by owner')

  rejects(() => seal(B, hs, star.toString()), /owner/i, 'Bob cannot seal Alice’s star plate')

  const nonceS = L.nonceOf(A.addr)
  apply({
    kind: 'transfer-star', at: 0, from: A.addr, to: B.addr, star: star.toString(), fee: '1',
    nonce: nonceS, publicKey: A.pk,
    signature: sign(sendStarMessage(NET, A.addr, B.addr, star, nonceS), A), scheme: 'kraywallet',
  } as never)
  ok(L.krayStarPlateOf(star) === null, 'star plate cleared on transfer (no toxic inherit)')

  seal(A, '')
  ok(L.krayPlateOf(A.addr) === null, 'address plate cleared')
  ok(L.cascadeParts().krayPlateCommitment === undefined, 'empty plate book ⇒ commitment absent')

  const atlas2 = new Map(atlas)
  const L2 = new KrayLedger(undefined, NET, undefined, false, (hash) => atlas2.get(hash) ?? null)
  for (const e of journal) L2.applyLive({ ...e })
  ok(L2.cascadeRoot() === L.cascadeRoot(), 'stranger replay reproduces cascade root')
  ok(L2.krayPlateOf(A.addr) === null && L2.krayStarPlateOf(star) === null, 'replay tip plates match')

  rejects(() => {
    const f = { description: 'ghost', url: '', bannerUrl: '' }
    const ph = hashKrayPlate(f)
    seal(A, ph)
  }, /atlas bytes missing/i, 'missing atlas bytes refused when atlasBytes wired')

  console.log(`\n${pass} passed, ${fail} failed\n`)
  if (fail) process.exit(1)
}
main()
