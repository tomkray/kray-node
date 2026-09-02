/**
 * BYTES-LAW GAUNTLET — one citizen story + every drain that story opens.
 *
 *   node src/test/bytes-law-gauntlet.test.ts
 *
 * Proves the ₭ book: list / buy / send / freeze clear the ask; hostile drains
 * refuse before mutation; a stranger replay matches the cascade root.
 *
 * Does NOT prove the bakery pot (federation residual) or writer delay.
 * Those are the other book — named at the end, not closed here.
 */
import { KrayLedger } from '../protocol/ledger.ts'
import { BLACK_HOLE, STAR_OFFER, TREASURY } from '../protocol/kray-primitives.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes,
  inscribeMessageV2, nameMessageV2, starListMessage, starDelistMessage, starBuyMessage,
  starOfferMessage, starOfferCancelMessage, sendStarMessage, transferMessage, burnMessage,
} from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'
import * as btc from '@scure/btc-signer'
import { createHash } from 'node:crypto'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const halts = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const s = (e as Error).message; ok(re.test(s), m + (re.test(s) ? '' : ' — wrong: ' + s)) }
}

interface W { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`bytes-law|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)

let seq = 0
const journal: KrayEvent[] = []
function apply(L: KrayLedger, e: KrayEvent): void {
  L.applyLive(e)
  journal.push(e)
}
const mint = (L: KrayLedger, to: string, amt: string) =>
  apply(L, { seq: ++seq, kind: 'donate', hash: 'h' + seq, to, amount: amt, outpoint: createHash('sha256').update('o' + seq).digest('hex') + ':0' } as unknown as KrayEvent)

function bornStar(L: KrayLedger, owner: W, tag: string): bigint {
  const before = L.stars.createdSeq
  const nonce = L.nonceOf(owner.addr)
  const ch = createHash('sha256').update(tag).digest('hex')
  const msg = inscribeMessageV2(NET, owner.addr, ch, 'text/plain', tag.length, undefined, nonce)
  apply(L, { seq: ++seq, kind: 'inscribe', hash: 'h' + seq, at: seq, from: owner.addr, contentHash: ch, contentType: 'text/plain', size: tag.length, nonce, publicKey: owner.pk, signature: sign(msg, owner), scheme: 'kraywallet' } as unknown as KrayEvent)
  return BigInt(before)
}
function nameOn(L: KrayLedger, w: W, star: bigint, name: string): KrayEvent {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'name', hash: 'h' + seq, at: seq, from: w.addr, star: star.toString(), name, nonce, publicKey: w.pk, signature: sign(nameMessageV2(NET, w.addr, nonce, name, star), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
function listEv(L: KrayLedger, w: W, star: bigint, price: bigint): KrayEvent {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'star-list', hash: 'h' + seq, at: seq, from: w.addr, star: star.toString(), amount: price.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(starListMessage(NET, w.addr, star, price, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
function delistEv(L: KrayLedger, w: W, star: bigint): KrayEvent {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'star-delist', hash: 'h' + seq, at: seq, from: w.addr, star: star.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(starDelistMessage(NET, w.addr, star, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
function buyEv(L: KrayLedger, buyer: W, star: bigint, price: bigint, seller: string, opts?: { bad?: W }): KrayEvent {
  const nonce = L.nonceOf(buyer.addr)
  const s = opts?.bad ?? buyer
  return { seq: ++seq, kind: 'star-buy', hash: 'h' + seq, at: seq, from: buyer.addr, to: seller, star: star.toString(), amount: price.toString(), fee: '1', nonce, publicKey: s.pk, signature: sign(starBuyMessage(NET, buyer.addr, star, price, seller, nonce), s), scheme: 'kraywallet' } as unknown as KrayEvent
}
function sendEv(L: KrayLedger, w: W, star: bigint, to: string): KrayEvent {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'transfer-star', hash: 'h' + seq, at: seq, from: w.addr, to, star: star.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(sendStarMessage(NET, w.addr, to, star, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
function payEv(L: KrayLedger, w: W, to: string, amt: bigint, from?: string): KrayEvent {
  const src = from ?? w.addr
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'transfer', hash: 'h' + seq, at: seq, from: src, to, amount: amt.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(transferMessage(NET, src, to, amt, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
function offerEv(L: KrayLedger, w: W, star: bigint, price: bigint): KrayEvent {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'star-offer', hash: 'h' + seq, at: seq, from: w.addr, star: star.toString(), amount: price.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(starOfferMessage(NET, w.addr, star, price, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
function cancelOfferEv(L: KrayLedger, w: W, star: bigint): KrayEvent {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'star-offer-cancel', hash: 'h' + seq, at: seq, from: w.addr, star: star.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(starOfferCancelMessage(NET, w.addr, star, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
function burnEv(L: KrayLedger, w: W, amt: bigint): KrayEvent {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'burn', hash: 'h' + seq, at: seq, from: w.addr, amount: amt.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(burnMessage(NET, w.addr, amt, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
function solvent(L: KrayLedger, m: string): void {
  ok(L.conserves() && L.balanceOf(STAR_OFFER) === L.offers.lockedTotal(), m)
}

function main() {
  console.log('\n╔═ BYTES-LAW GAUNTLET — citizen flow · drain · replay ══╗\n')
  const A = wallet('alice'), B = wallet('bob'), C = wallet('carol'), E = wallet('eve')
  const L = new KrayLedger(undefined, NET)
  mint(L, A.addr, '400'); mint(L, B.addr, '400'); mint(L, C.addr, '400')
  solvent(L, 'donate conserved')

  const star = bornStar(L, A, 'bytes-law-face')
  apply(L, nameOn(L, A, star, 'gauntletface'))
  ok(L.stars.ownerOf(star) === A.addr, `star #${star} born + baptized to Alice`)
  apply(L, listEv(L, A, star, 50n))
  ok(L.market.get(star)?.seller === A.addr && L.market.get(star)?.price === 50n, 'Alice listed — star still hers')
  solvent(L, 'after list')

  console.log('\n── hostile drains (must refuse, root frozen) ──')
  const snap = L.cascadeRoot()
  const aliceK = L.balanceOf(A.addr)
  const bobK = L.balanceOf(B.addr)
  halts(() => L.applyLive(listEv(L, E, star, 1n)), /do not hold/, 'Eve cannot list Alice\'s star')
  halts(() => L.applyLive(delistEv(L, E, star)), /do not hold/, 'Eve cannot delist Alice\'s ask')
  halts(() => L.applyLive(buyEv(L, B, star, 49n, A.addr)), /listing price|signed buy/, 'wrong price — no phantom')
  halts(() => L.applyLive(buyEv(L, B, star, 50n, A.addr, { bad: E })), /signature|signed/i, 'forged buy refused')
  halts(() => L.applyLive(payEv(L, E, E.addr, 1n, TREASURY)), /protocol pot|cannot transfer/, 'cannot drain TREASURY')
  halts(() => L.applyLive(payEv(L, E, E.addr, 1n, STAR_OFFER)), /protocol pot|cannot transfer|cannot credit/, 'cannot drain STAR_OFFER')
  halts(() => L.applyLive(payEv(L, E, E.addr, 1n, BLACK_HOLE)), /protocol pot|cannot transfer|black hole/, 'cannot spend the hole')
  ok(L.cascadeRoot() === snap, 'every refused drain left the root untouched')
  ok(L.balanceOf(A.addr) === aliceK && L.balanceOf(B.addr) === bobK && L.balanceOf(E.addr) === 0n, 'no ₭ moved on a refused drain')
  ok(L.market.get(star)?.price === 50n, 'ask still Alice\'s after the barrage')
  solvent(L, 'hostile barrage conserved')

  console.log('\n── send clears the ask ──')
  apply(L, sendEv(L, A, star, B.addr))
  ok(L.stars.ownerOf(star) === B.addr && L.market.get(star) === null, 'send → Bob owns, listing gone')
  halts(() => L.applyLive(buyEv(L, C, star, 50n, A.addr)), /not listed/, 'stale buy after send refused')
  solvent(L, 'after send')

  console.log('\n── buy consumes the ask ──')
  apply(L, listEv(L, B, star, 30n))
  apply(L, buyEv(L, A, star, 30n, B.addr))
  ok(L.stars.ownerOf(star) === A.addr && L.market.get(star) === null, 'buy → Alice owns, listing consumed')
  halts(() => L.applyLive(buyEv(L, C, star, 30n, B.addr)), /not listed/, 'second buy on a consumed list refused')
  solvent(L, 'after buy')

  // nonce replay of the successful buy event (last journaled star-buy)
  const lastBuy = journal.filter((e) => e.kind === 'star-buy').at(-1)!
  halts(() => L.applyLive({ ...lastBuy, seq: ++seq, hash: 'replay' } as KrayEvent), /nonce|already/, 'replayed buy nonce refused')

  console.log('\n── bid pot is not the ask; send does not unlock it ──')
  apply(L, listEv(L, A, star, 80n))
  apply(L, offerEv(L, C, star, 20n))
  ok(L.balanceOf(STAR_OFFER) === 20n, 'Carol\'s bid locked in the pot')
  apply(L, sendEv(L, A, star, B.addr))
  ok(L.market.get(star) === null, 'send cleared the ask')
  ok(L.offers.get(star, C.addr)?.price === 20n && L.balanceOf(STAR_OFFER) === 20n, 'bid still locked — residual named, not a drain')
  apply(L, cancelOfferEv(L, C, star))
  ok(L.offers.get(star, C.addr) === null && L.balanceOf(STAR_OFFER) === 0n, 'only Carol unlocks her bid')
  solvent(L, 'after bid cancel')

  console.log('\n── freeze clears the ask; ₭-burn does not ──')
  const frozen = bornStar(L, A, 'bytes-law-ice')
  apply(L, listEv(L, A, frozen, 12n))
  apply(L, sendEv(L, A, frozen, BLACK_HOLE))
  ok(L.stars.ownerOf(frozen) === BLACK_HOLE && L.market.get(frozen) === null, 'freeze → hole holds, listing gone')
  ok(L.glowOf(A.addr) >= 1, 'freeze minted glow to Alice')
  halts(() => L.applyLive(offerEv(L, C, frozen, 5n)), /frozen|black hole|cannot buy/, 'new bid on a frozen star refused')
  const listed = bornStar(L, B, 'bytes-law-keep')
  apply(L, listEv(L, B, listed, 7n))
  apply(L, burnEv(L, B, 2n))
  ok(L.market.get(listed)?.price === 7n, 'burning ₭ does not delist a star you still hold')
  solvent(L, 'after freeze + burn')

  console.log('\n── stranger replay ──')
  const live = L.cascadeRoot()
  const twin = new KrayLedger(undefined, NET)
  for (const e of journal) twin.applyLive(e)
  ok(twin.cascadeRoot() === live, 'twin replay matches the cascade root')
  ok(twin.conserves() && twin.market.get(star) === null && twin.stars.ownerOf(frozen) === BLACK_HOLE, 'twin re-derives owners and empty asks')
  solvent(twin, 'twin conserved')

  console.log('\n── residual (not this book) ──')
  ok(true, 'bakery pot / writer delay are the other book — this gauntlet does not close them')

  console.log(`\n${fail === 0 ? '✓' : '✗'} bytes-law-gauntlet: ${pass} passed, ${fail} failed\n`)
  if (fail) process.exit(1)
}

main()
