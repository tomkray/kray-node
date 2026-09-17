/**
 * KRAY Social like (star-like) — fee 1 → Treasury · optional tip · star-named.
 *   node src/test/star-like.test.ts
 *
 * Pins: tip none / kray / x · self-like taxed · black hole refuse · fee forge ·
 * conservation · message binds star.
 */
import { createHash } from 'node:crypto'
import { KrayLedger } from '../protocol/ledger.ts'
import { TREASURY, BLACK_HOLE, MIN_FEE } from '../protocol/kray-primitives.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes,
  inscribeMessageV2, starLikeMessage, sendStarMessage, burnMessage,
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
  const sk = createHash('sha256').update(`star-like|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)

function book() {
  let seq = 0
  const journal: KrayEvent[] = []
  // xTransferActivationSeq = 0 so tip=x works on regtest exams
  const L = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, 0)
  const apply = (e: Omit<KrayEvent, 'seq' | 'hash' | 'prevHash'> & { hash?: string }) => {
    const full = { ...e, seq: ++seq, hash: e.hash ?? ('h' + seq), prevHash: '' } as KrayEvent
    L.applyLive(full)
    journal.push(full)
    return full
  }
  const mint = (to: string, amt: string) =>
    apply({ kind: 'donate', at: seq + 1, to, amount: amt, outpoint: createHash('sha256').update('o' + (seq + 1)).digest('hex') + ':0' } as never)
  const born = (owner: W, tag: string): bigint => {
    const before = L.stars.createdSeq
    const nonce = L.nonceOf(owner.addr)
    const ch = createHash('sha256').update(tag).digest('hex')
    const msg = inscribeMessageV2(NET, owner.addr, ch, 'text/plain', tag.length, undefined, nonce)
    apply({
      kind: 'inscribe', at: 0, from: owner.addr, contentHash: ch, contentType: 'text/plain', size: tag.length,
      nonce, publicKey: owner.pk, signature: sign(msg, owner), scheme: 'kraywallet',
    } as never)
    return BigInt(before)
  }
  const like = (w: W, star: bigint, tip: 'none' | 'kray' | 'x' | 'rune', amount?: string, runeId?: string) => {
    const nonce = L.nonceOf(w.addr)
    const tipAmt = tip === 'none' ? null : BigInt(amount!)
    const rid = tip === 'rune' ? (runeId ?? null) : null
    const msg = starLikeMessage(NET, w.addr, star, tip, tipAmt, rid, nonce)
    return apply({
      kind: 'star-like', at: 0, from: w.addr, star: star.toString(), fee: '1', nonce,
      tipAsset: tip === 'none' ? undefined : tip,
      amount: tip === 'none' ? undefined : amount,
      runeId: tip === 'rune' ? runeId : undefined,
      publicKey: w.pk, signature: sign(msg, w), scheme: 'kraywallet',
    } as never)
  }
  const tryLike = (w: W, star: bigint, tip: 'none' | 'kray' | 'x', amount?: string, fee = '1') => {
    const nonce = L.nonceOf(w.addr)
    const tipAmt = tip === 'none' ? null : BigInt(amount!)
    const msg = starLikeMessage(NET, w.addr, star, tip, tipAmt, null, nonce)
    const e = {
      seq: seq + 1, prevHash: '', hash: 'hx', at: 0, kind: 'star-like' as const, from: w.addr,
      star: star.toString(), fee, nonce,
      tipAsset: tip === 'none' ? undefined : tip,
      amount: tip === 'none' ? undefined : amount,
      publicKey: w.pk, signature: sign(msg, w), scheme: 'kraywallet',
    } as KrayEvent
    L.applyLive(e)
  }
  const freeze = (w: W, star: bigint) => {
    const nonce = L.nonceOf(w.addr)
    return apply({
      kind: 'transfer-star', at: 0, from: w.addr, to: BLACK_HOLE, star: star.toString(), fee: '1', nonce,
      publicKey: w.pk, signature: sign(sendStarMessage(NET, w.addr, BLACK_HOLE, star, nonce), w), scheme: 'kraywallet',
    } as never)
  }
  const sendStar = (from: W, to: string, star: bigint) => {
    const nonce = L.nonceOf(from.addr)
    return apply({
      kind: 'transfer-star', at: 0, from: from.addr, to, star: star.toString(), fee: '1', nonce,
      publicKey: from.pk, signature: sign(sendStarMessage(NET, from.addr, to, star, nonce), from), scheme: 'kraywallet',
    } as never)
  }
  const burn = (w: W, amt: string) => {
    const nonce = L.nonceOf(w.addr)
    const a = BigInt(amt)
    return apply({
      kind: 'burn', at: 0, from: w.addr, amount: amt, fee: '1', nonce,
      publicKey: w.pk, signature: sign(burnMessage(NET, w.addr, a, nonce), w), scheme: 'kraywallet',
    } as never)
  }
  return { L, journal, mint, born, like, tryLike, freeze, sendStar, burn }
}

function main() {
  console.log('\n╔═ STAR-LIKE — fee→Treasury · tip optional · star-named ═╗\n')

  const A = wallet('alice'), B = wallet('bob'), M = wallet('mallory')

  // tip none — fee only
  {
    const a = book()
    a.mint(A.addr, '20')
    a.mint(B.addr, '20')
    const s1 = a.born(A, 'post-one')
    const t0 = a.L.balanceOf(TREASURY)
    const b0 = a.L.balanceOf(B.addr)
    const o0 = a.L.balanceOf(A.addr)
    a.like(B, s1, 'none')
    ok(a.L.balanceOf(TREASURY) === t0 + MIN_FEE, 'tip none: fee 1 → Treasury')
    ok(a.L.balanceOf(B.addr) === b0 - MIN_FEE, 'tip none: liker pays fee only')
    ok(a.L.balanceOf(A.addr) === o0, 'tip none: owner balance unchanged')
    ok(a.L.conserves(), 'tip none: conserves')
  }

  // tip kray
  {
    const a = book()
    a.mint(A.addr, '20')
    a.mint(B.addr, '20')
    const s1 = a.born(A, 'post-tip')
    const t0 = a.L.balanceOf(TREASURY)
    const o0 = a.L.balanceOf(A.addr)
    a.like(B, s1, 'kray', '3')
    ok(a.L.balanceOf(TREASURY) === t0 + 1n, 'tip kray: fee → Treasury')
    ok(a.L.balanceOf(A.addr) === o0 + 3n, 'tip kray: owner +3')
    ok(a.L.conserves(), 'tip kray: conserves')
  }

  // self-like tip none — vanity tax
  {
    const a = book()
    a.mint(A.addr, '20')
    const s1 = a.born(A, 'self-post')
    const a0 = a.L.balanceOf(A.addr)
    a.like(A, s1, 'none')
    ok(a.L.balanceOf(A.addr) === a0 - 1n, 'self-like tip none: −1 ₭ fee')
  }

  // self-like tip kray — tip loops, fee burns
  {
    const a = book()
    a.mint(A.addr, '30')
    const s1 = a.born(A, 'self-tip')
    const a0 = a.L.balanceOf(A.addr)
    a.like(A, s1, 'kray', '5')
    ok(a.L.balanceOf(A.addr) === a0 - 1n, 'self-like tip kray: net −1 ₭ (tip loops)')
  }

  // tip Ӿ (after burn)
  {
    const a = book()
    a.mint(A.addr, '20')
    a.mint(B.addr, '30')
    const s1 = a.born(A, 'x-post')
    a.burn(B, '5')
    ok(a.L.xBalanceOf(B.addr) === 5n, 'burn minted Ӿ to liker')
    const xo0 = a.L.xBalanceOf(A.addr)
    a.like(B, s1, 'x', '2')
    ok(a.L.xBalanceOf(A.addr) === xo0 + 2n, 'tip x: owner +2 Ӿ')
    ok(a.L.xBalanceOf(B.addr) === 3n, 'tip x: liker −2 Ӿ')
    ok(a.L.conserves(), 'tip x: conserves')
  }

  // black hole refuse
  {
    const a = book()
    a.mint(A.addr, '20')
    a.mint(B.addr, '10')
    const s1 = a.born(A, 'frozen')
    a.freeze(A, s1)
    rejects(() => a.tryLike(B, s1, 'none'), /frozen|black|cannot receive/i, 'like on frozen star refused')
  }

  // fee forge
  {
    const a = book()
    a.mint(A.addr, '20')
    a.mint(B.addr, '10')
    const s1 = a.born(A, 'fee-forge')
    rejects(() => a.tryLike(B, s1, 'none', undefined, '0'), /exactly 1|fee/i, 'fee 0 refused')
    rejects(() => a.tryLike(B, s1, 'none', undefined, '2'), /exactly 1|fee/i, 'fee 2 refused')
  }

  // living tip: after sale, tip credits the NEW owner (signed message names star, not to)
  {
    const a = book()
    a.mint(A.addr, '30')
    a.mint(B.addr, '30')
    a.mint(M.addr, '30')
    const s1 = a.born(A, 'living-tip')
    a.sendStar(A, B.addr, s1)   // Alice sells → Bob holds
    ok(a.L.stars.ownerOf(s1) === B.addr, 'star now lives with Bob')
    const a0 = a.L.balanceOf(A.addr)
    const b0 = a.L.balanceOf(B.addr)
    const m0 = a.L.balanceOf(M.addr)
    // Mallory tips 5 ₭ — signed bytes have no `to`; reducer resolves living owner at apply
    a.like(M, s1, 'kray', '5')
    ok(a.L.balanceOf(B.addr) === b0 + 5n, 'tip 5 ₭ → living owner Bob (buyer)')
    ok(a.L.balanceOf(A.addr) === a0, 'prior owner Alice receives 0 tip after sale')
    ok(a.L.balanceOf(M.addr) === m0 - 5n - 1n, 'liker pays tip + fee')
    ok(!/\|to=/.test(starLikeMessage(NET, M.addr, s1, 'kray', 5n, null, 0)),
      'signed like message never binds a tip destination address')
    ok(a.L.conserves(), 'living tip: conserves')
  }

  // once-ever: one address × one star
  {
    const a = book()
    a.mint(A.addr, '20')
    a.mint(B.addr, '20')
    const s1 = a.born(A, 'once-ever')
    a.like(B, s1, 'none')
    ok(a.L.hasStarLiked(s1, B.addr) === true, 'hasStarLiked after first like')
    rejects(() => a.tryLike(B, s1, 'kray', '1'), /already liked|one like/i, 'second like from same wallet refused')
    rejects(() => a.tryLike(B, s1, 'none'), /already liked|one like/i, 'second fee-only like refused')
    a.like(A, s1, 'none')
    ok(a.L.starLikeStatsOf(s1).count === 2, 'different wallet may like once')
    ok(a.L.starLikeStatsOf(s1).feeOnly === 2 && a.L.starLikeStatsOf(s1).tipCount === 0, 'two fee-only likes, no tips')
    // stranger reboot keeps the once book
    const R = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, 0)
    for (const e of a.journal) R.applyLive(e)
    ok(R.hasStarLiked(s1, B.addr) && R.hasStarLiked(s1, A.addr), 'once-ever re-derives on cold replay')
  }

  // wrong tip amount signed
  {
    const a = book()
    a.mint(A.addr, '20')
    a.mint(B.addr, '20')
    const s1 = a.born(A, 'msg-bind')
    const nonce = a.L.nonceOf(B.addr)
    const msg = starLikeMessage(NET, B.addr, s1, 'kray', 1n, null, nonce)
    rejects(() => {
      a.L.applyLive({
        seq: 99, prevHash: '', hash: 'hx', at: 0, kind: 'star-like', from: B.addr,
        star: s1.toString(), fee: '1', tipAsset: 'kray', amount: '9', nonce,
        publicKey: B.pk, signature: sign(msg, B), scheme: 'kraywallet',
      } as KrayEvent)
    }, /signature|message|refused|invalid/i, 'amount tamper after sign refused')
  }

  // message names the star
  {
    const m = starLikeMessage(NET, A.addr, 13n, 'none', null, null, 7)
    ok(/star=13/.test(m) && /star-like\.v1/.test(m) && !/\|tip=/.test(m), 'fee-only message names star, omits tip (A3)')
    const m2 = starLikeMessage(NET, A.addr, 13n, 'kray', 2n, null, 8)
    ok(/tip=kray\|amount=2/.test(m2), 'kray tip fields present when tipped')
  }

  console.log(`\n── ${pass} passed · ${fail} failed ──\n`)
  if (fail) process.exit(1)
}

main()
