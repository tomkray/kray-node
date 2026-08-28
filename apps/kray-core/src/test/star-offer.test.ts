/**
 * ESCROWED STAR OFFERS — the pot is a label; the reducer is the vault.
 *
 *   node src/test/star-offer.test.ts
 */
import { KrayLedger } from '../protocol/ledger.ts'
import { STAR_OFFER } from '../protocol/kray-primitives.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, starOfferMessage, starOfferCancelMessage, starOfferAcceptMessage, sendStarMessage, inscribeMessageV2 } from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'
import * as btc from '@scure/btc-signer'
import { createHash } from 'node:crypto'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const halts = (fn: () => void, re: RegExp, m: string) => { try { fn(); ok(false, m + ' — DID NOT throw') } catch (e) { const s = (e as Error).message; ok(re.test(s), m + (re.test(s) ? '' : ' — wrong: ' + s)) } }

interface W { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`star-offer|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)

let seq = 0
const mint = (L: KrayLedger, to: string, amt: string) => L.applyLive({ seq: ++seq, kind: 'donate', hash: 'h' + seq, to, amount: amt, outpoint: createHash('sha256').update('o' + seq).digest('hex') + ':0' } as unknown as KrayEvent)
function bornStar(L: KrayLedger, owner: W, tag: string): bigint {
  const before = L.stars.createdSeq
  const nonce = L.nonceOf(owner.addr)
  const msg = inscribeMessageV2(NET, owner.addr, tag, 'text/plain', tag.length, undefined, nonce)
  L.applyLive({ seq: ++seq, kind: 'inscribe', hash: 'h' + seq, at: seq, from: owner.addr, contentHash: tag, contentType: 'text/plain', size: tag.length, nonce, publicKey: owner.pk, signature: sign(msg, owner), scheme: 'kraywallet' } as unknown as KrayEvent)
  return BigInt(before)
}
const offerEv = (L: KrayLedger, w: W, star: bigint, price: bigint, opts?: { badSig?: W }): KrayEvent => {
  const nonce = L.nonceOf(w.addr)
  const signer = opts?.badSig ?? w
  return { seq: ++seq, kind: 'star-offer', hash: 'h' + seq, at: seq, from: w.addr, star: star.toString(), amount: price.toString(), fee: '1', nonce, publicKey: signer.pk, signature: sign(starOfferMessage(NET, w.addr, star, price, nonce), signer), scheme: 'kraywallet' } as unknown as KrayEvent
}
const cancelEv = (L: KrayLedger, w: W, star: bigint): KrayEvent => {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'star-offer-cancel', hash: 'h' + seq, at: seq, from: w.addr, star: star.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(starOfferCancelMessage(NET, w.addr, star, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
const acceptEv = (L: KrayLedger, owner: W, star: bigint, price: bigint, bidder: string, opts?: { badSig?: W }): KrayEvent => {
  const nonce = L.nonceOf(owner.addr)
  const signer = opts?.badSig ?? owner
  return { seq: ++seq, kind: 'star-offer-accept', hash: 'h' + seq, at: seq, from: owner.addr, to: bidder, star: star.toString(), amount: price.toString(), fee: '1', nonce, publicKey: signer.pk, signature: sign(starOfferAcceptMessage(NET, owner.addr, star, price, bidder, nonce), signer), scheme: 'kraywallet' } as unknown as KrayEvent
}

function main() {
  console.log('\n╔═ STAR OFFERS — escrowed bids, pot == book, atomic accept ══╗\n')
  const A = wallet('alice'), B = wallet('bob'), C = wallet('carol')

  const empty = new KrayLedger(undefined, NET)
  const genesis = empty.cascadeRoot()
  ok(empty.offers.empty() && !empty.cascadeParts().offerCommitment, 'empty offers fold nowhere (A3)')
  ok(empty.balanceOf(STAR_OFFER) === 0n && empty.conserves(), 'empty pot is zero and conserved')

  const L = new KrayLedger(undefined, NET)
  mint(L, A.addr, '100'); mint(L, B.addr, '100')
  const star = bornStar(L, A, 'bidstar')
  const rootBefore = L.cascadeRoot()
  const bob0 = L.balanceOf(B.addr), tre0 = L.balanceOf('KRAY_TREASURY')

  L.applyLive(offerEv(L, B, star, 40n))
  ok(L.offers.get(star, B.addr)?.price === 40n, '1 · live offer recorded')
  ok(L.balanceOf(B.addr) === bob0 - 41n, '1 · bidder locked price + 1 ₭ fee')
  ok(L.balanceOf(STAR_OFFER) === 40n && L.offers.lockedTotal() === 40n, '1 · pot == book')
  ok(L.balanceOf('KRAY_TREASURY') === tre0 + 1n, '1 · fee to treasury')
  ok(L.stars.ownerOf(star) === A.addr, '1 · star did not move')
  ok(!!L.cascadeParts().offerCommitment && L.cascadeRoot() !== rootBefore, '1 · offer book folds')
  ok(L.conserves(), '1 · conservation')

  const snap = L.cascadeRoot()
  halts(() => L.applyLive(offerEv(L, B, star, 50n)), /already have a live offer/, '2 · second offer on same star refused')
  halts(() => L.applyLive(offerEv(L, A, star, 10n)), /already hold/, '2 · owner cannot bid on self')
  ok(L.cascadeRoot() === snap, '2 · refused paths mutate nothing')

  const bob1 = L.balanceOf(B.addr)
  L.applyLive(cancelEv(L, B, star))
  ok(L.offers.get(star, B.addr) === null, '3 · cancel cleared the book')
  ok(L.balanceOf(STAR_OFFER) === 0n, '3 · pot emptied')
  ok(L.balanceOf(B.addr) === bob1 - 1n + 40n, '3 · price returned, cancel fee paid')
  ok(!L.cascadeParts().offerCommitment, '3 · empty book folds nowhere again')
  ok(L.conserves(), '3 · conservation after cancel')

  L.applyLive(offerEv(L, B, star, 25n))
  mint(L, C.addr, '80')
  L.applyLive(offerEv(L, C, star, 30n))
  ok(L.offers.onStar(star).length === 2 && L.balanceOf(STAR_OFFER) === 55n, '4 · two bids, pot is the sum')

  const alice0 = L.balanceOf(A.addr), pot0 = L.balanceOf(STAR_OFFER)
  L.applyLive(acceptEv(L, A, star, 30n, C.addr))
  ok(L.stars.ownerOf(star) === C.addr, '5 · star moved to the accepted bidder')
  ok(L.offers.get(star, C.addr) === null, '5 · accepted offer consumed')
  ok(L.offers.get(star, B.addr)?.price === 25n, '5 · the other bid survives')
  ok(L.balanceOf(A.addr) === alice0 - 1n + 30n, '5 · owner received price, paid 1 ₭')
  ok(L.balanceOf(STAR_OFFER) === pot0 - 30n, '5 · pot paid exactly that bid')
  ok(L.conserves(), '5 · conservation through accept')

  const snap2 = L.cascadeRoot()
  halts(() => L.applyLive(acceptEv(L, A, star, 30n, C.addr)), /do not hold|no live offer/, '6 · old owner cannot accept after sale')
  halts(() => L.applyLive(acceptEv(L, C, star, 26n, B.addr)), /offer price/, '6 · wrong price refused (Fano)')
  halts(() => L.applyLive(acceptEv(L, C, star, 25n, B.addr, { badSig: A })), /signature|signed/i, '6 · forged accept refused')
  ok(L.cascadeRoot() === snap2, '6 · attacks leave the root unchanged')

  const tnonce = L.nonceOf(C.addr)
  L.applyLive({ seq: ++seq, kind: 'transfer-star', hash: 'h' + seq, at: seq, from: C.addr, to: A.addr, star: star.toString(), fee: '1', nonce: tnonce, publicKey: C.pk, signature: sign(sendStarMessage(NET, C.addr, A.addr, star, tnonce), C), scheme: 'kraywallet' } as unknown as KrayEvent)
  ok(L.offers.get(star, B.addr)?.price === 25n, '7 · transfer-star does not evict a stranger bid')
  L.applyLive(acceptEv(L, A, star, 25n, B.addr))
  ok(L.stars.ownerOf(star) === B.addr && L.offers.empty(), '7 · new owner accepted the surviving bid')
  ok(L.conserves(), '7 · conserved')

  const replica = new KrayLedger(undefined, NET)
  ok(genesis === replica.cascadeRoot(), '8 · two empty ledgers share the no-offer genesis root')
  ok(/^[0-9a-f]{64}$/.test(L.cascadeRoot()), '8 · live root well-formed')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — pot == book, atomic accept, A3 empty fold. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
