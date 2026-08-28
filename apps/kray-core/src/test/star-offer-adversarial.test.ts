/**
 * STAR OFFERS — adversarial + swarm. Prove by breaking.
 *
 *   node src/test/star-offer-adversarial.test.ts
 *
 * Forgery, double-spend of locked ₭, pot-credit, stale accept, listing race,
 * freeze, malformed price, then a seeded swarm of mixed list/buy/offer/cancel/accept.
 * After every accepted act: conservation AND pot == book. Replay twin matches the root.
 */
import { KrayLedger } from '../protocol/ledger.ts'
import { STAR_OFFER } from '../protocol/kray-primitives.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes,
  starOfferMessage, starOfferCancelMessage, starOfferAcceptMessage,
  starListMessage, starBuyMessage, sendStarMessage, transferMessage, inscribeMessageV2,
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

interface W { addr: string; sk: Uint8Array; pk: string; tag: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`star-offer-adv|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex, tag }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)

let seq = 0
const journal: KrayEvent[] = []
function apply(L: KrayLedger, e: KrayEvent): void {
  L.applyLive(e)
  journal.push(e)
}
const mint = (L: KrayLedger, to: string, amt: string) => apply(L, { seq: ++seq, kind: 'donate', hash: 'h' + seq, to, amount: amt, outpoint: createHash('sha256').update('o' + seq).digest('hex') + ':0' } as unknown as KrayEvent)
function bornStar(L: KrayLedger, owner: W, tag: string): bigint {
  const before = L.stars.createdSeq
  const nonce = L.nonceOf(owner.addr)
  const msg = inscribeMessageV2(NET, owner.addr, tag, 'text/plain', tag.length, undefined, nonce)
  apply(L, { seq: ++seq, kind: 'inscribe', hash: 'h' + seq, at: seq, from: owner.addr, contentHash: tag, contentType: 'text/plain', size: tag.length, nonce, publicKey: owner.pk, signature: sign(msg, owner), scheme: 'kraywallet' } as unknown as KrayEvent)
  return BigInt(before)
}
function offerEv(L: KrayLedger, w: W, star: bigint, price: bigint, extra?: Partial<KrayEvent>): KrayEvent {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'star-offer', hash: 'h' + seq, at: seq, from: w.addr, star: star.toString(), amount: price.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(starOfferMessage(NET, w.addr, star, price, nonce), w), scheme: 'kraywallet', ...extra } as unknown as KrayEvent
}
function cancelEv(L: KrayLedger, w: W, star: bigint): KrayEvent {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'star-offer-cancel', hash: 'h' + seq, at: seq, from: w.addr, star: star.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(starOfferCancelMessage(NET, w.addr, star, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
function acceptEv(L: KrayLedger, owner: W, star: bigint, price: bigint, bidder: string): KrayEvent {
  const nonce = L.nonceOf(owner.addr)
  return { seq: ++seq, kind: 'star-offer-accept', hash: 'h' + seq, at: seq, from: owner.addr, to: bidder, star: star.toString(), amount: price.toString(), fee: '1', nonce, publicKey: owner.pk, signature: sign(starOfferAcceptMessage(NET, owner.addr, star, price, bidder, nonce), owner), scheme: 'kraywallet' } as unknown as KrayEvent
}
function listEv(L: KrayLedger, w: W, star: bigint, price: bigint): KrayEvent {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'star-list', hash: 'h' + seq, at: seq, from: w.addr, star: star.toString(), amount: price.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(starListMessage(NET, w.addr, star, price, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
function buyEv(L: KrayLedger, buyer: W, star: bigint, price: bigint, seller: string): KrayEvent {
  const nonce = L.nonceOf(buyer.addr)
  return { seq: ++seq, kind: 'star-buy', hash: 'h' + seq, at: seq, from: buyer.addr, to: seller, star: star.toString(), amount: price.toString(), fee: '1', nonce, publicKey: buyer.pk, signature: sign(starBuyMessage(NET, buyer.addr, star, price, seller, nonce), buyer), scheme: 'kraywallet' } as unknown as KrayEvent
}
function sendEv(L: KrayLedger, w: W, star: bigint, to: string): KrayEvent {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'transfer-star', hash: 'h' + seq, at: seq, from: w.addr, to, star: star.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(sendStarMessage(NET, w.addr, to, star, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
function payEv(L: KrayLedger, w: W, to: string, amt: bigint): KrayEvent {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'transfer', hash: 'h' + seq, at: seq, from: w.addr, to, amount: amt.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(transferMessage(NET, w.addr, to, amt, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
function solvent(L: KrayLedger, m: string): void {
  ok(L.conserves() && L.balanceOf(STAR_OFFER) === L.offers.lockedTotal(), m)
}

function main() {
  console.log('\n╔═ STAR OFFERS ADVERSARIAL — forge · drain · swarm ══╗\n')
  const A = wallet('alice'), B = wallet('bob'), C = wallet('carol'), E = wallet('eve')
  const L = new KrayLedger(undefined, NET)
  mint(L, A.addr, '200'); mint(L, B.addr, '200'); mint(L, C.addr, '200')
  const star = bornStar(L, A, 'adv-star')

  // ── malformed / hostile doors ──
  const snap = L.cascadeRoot()
  halts(() => apply(L, offerEv(L, B, star, 10n, { amount: '10.5' })), /whole number/, 'decimal price refused')
  halts(() => apply(L, offerEv(L, B, star, 10n, { amount: '-10' })), /whole number|positive/, 'negative price refused')
  halts(() => apply(L, offerEv(L, B, 99999n, 10n)), /no such star/, 'offer on a missing star refused')
  ok(L.cascadeRoot() === snap, 'malformed offers mutate nothing')

  apply(L, offerEv(L, B, star, 40n))
  solvent(L, 'live offer is solvent')
  const locked = L.balanceOf(B.addr)
  halts(() => apply(L, payEv(L, B, C.addr, locked + 1n)), /insufficient/, 'locked ₭ cannot be transferred — no double-spend')
  halts(() => apply(L, offerEv(L, B, star, 11n)), /already have a live offer/, 'second bid on the same star refused')
  halts(() => apply(L, cancelEv(L, C, star)), /no live offer/, 'a stranger cannot unlock someone else\'s bid')
  halts(() => apply(L, acceptEv(L, C, star, 40n, B.addr)), /do not hold/, 'non-owner cannot accept')
  halts(() => apply(L, acceptEv(L, A, star, 39n, B.addr)), /offer price/, 'wrong accept price refused (Fano)')
  halts(() => apply(L, acceptEv(L, A, star, 40n, C.addr)), /no live offer/, 'accept of a phantom bidder refused')
  halts(() => apply(L, payEv(L, C, STAR_OFFER, 5n)), /star-offer pot|cannot credit/, 'transfer into the pot is refused')
  ok(L.cascadeRoot() !== snap && L.offers.get(star, B.addr)?.price === 40n, 'only the honest offer landed')
  solvent(L, 'gauntlet left pot == book')

  // ── listing + accept race: accept clears the ask ──
  apply(L, listEv(L, A, star, 99n))
  ok(!!L.market.get(star), 'star is listed')
  apply(L, acceptEv(L, A, star, 40n, B.addr))
  ok(L.stars.ownerOf(star) === B.addr && L.market.get(star) === null, 'accept moved the star and cleared the listing')
  solvent(L, 'accept after list is solvent')
  halts(() => apply(L, buyEv(L, C, star, 99n, A.addr)), /not listed/, 'stale buy after accept is refused')

  // ── leftover bid survives a list-buy; the new owner can accept it ──
  apply(L, offerEv(L, C, star, 22n))
  apply(L, listEv(L, B, star, 50n))
  apply(L, buyEv(L, A, star, 50n, B.addr))
  ok(L.stars.ownerOf(star) === A.addr && L.offers.get(star, C.addr)?.price === 22n, 'buy consumes the ask; the stranger bid lives')
  apply(L, acceptEv(L, A, star, 22n, C.addr))
  ok(L.stars.ownerOf(star) === C.addr && L.offers.empty(), 'new owner accepted the leftover bid')
  solvent(L, 'buy-then-accept leftover is solvent')

  // ── freeze: cannot offer; existing bid must be cancelled by the bidder ──
  const s2 = bornStar(L, C, 'freeze-me')
  apply(L, offerEv(L, A, s2, 8n))
  apply(L, sendEv(L, C, s2, 'KRAY_BLACK_HOLE'))
  halts(() => apply(L, offerEv(L, B, s2, 9n)), /frozen/, 'cannot bid on a frozen star')
  halts(() => apply(L, acceptEv(L, C, s2, 8n, A.addr)), /do not hold/, 'frozen owner cannot accept')
  apply(L, cancelEv(L, A, s2))
  ok(L.offers.get(s2, A.addr) === null && L.balanceOf(STAR_OFFER) === 0n, 'bidder unlocked after freeze')
  solvent(L, 'freeze + cancel is solvent')

  // ── cancel needs 1 liquid ₭ after a full lock ──
  const poor = wallet('poor')
  mint(L, poor.addr, '11')
  const s3 = bornStar(L, A, 'poor-bid')
  apply(L, offerEv(L, poor, s3, 10n))
  ok(L.balanceOf(poor.addr) === 0n, 'poor locked every spendable ₭')
  halts(() => apply(L, cancelEv(L, poor, s3)), /insufficient/, 'cancel without 1 liquid ₭ is refused — fee is never skipped')
  mint(L, poor.addr, '1')
  apply(L, cancelEv(L, poor, s3))
  ok(L.offers.get(s3, poor.addr) === null, 'cancel works once the fee is liquid')
  solvent(L, 'poor-cancel path is solvent')

  // ── SWARM — seeded mix of list / buy / offer / cancel / accept ──
  const swarm: W[] = [A, B, C, E, wallet('d'), wallet('f'), wallet('g'), wallet('h')]
  for (const w of swarm) mint(L, w.addr, '500')
  const stars: bigint[] = []
  for (let i = 0; i < 6; i++) stars.push(bornStar(L, swarm[i % swarm.length], 'swarm-' + i))
  let accepted = 0, offered = 0, cancelled = 0, listed = 0, bought = 0, refused = 0
  let tick = 0
  const rng = (n: number) => { const h = createHash('sha256').update('swarm|' + (++tick) + '|' + n).digest(); return h[0]! % n }
  for (let i = 0; i < 220; i++) {
    const actor = swarm[rng(swarm.length)]!
    const starI = stars[rng(stars.length)]!
    const owner = L.stars.ownerOf(starI)
    const op = rng(5)
    const before = L.cascadeRoot()
    try {
      if (op === 0 && owner === actor.addr) {
        apply(L, listEv(L, actor, starI, BigInt(10 + rng(40))))
        listed++
      } else if (op === 1 && owner && owner !== actor.addr && L.market.get(starI)) {
        const ask = L.market.get(starI)!
        apply(L, buyEv(L, actor, starI, ask.price, ask.seller))
        bought++
      } else if (op === 2 && owner && owner !== actor.addr && owner !== 'KRAY_BLACK_HOLE' && !L.offers.get(starI, actor.addr)) {
        apply(L, offerEv(L, actor, starI, BigInt(5 + rng(30))))
        offered++
      } else if (op === 3 && L.offers.get(starI, actor.addr)) {
        apply(L, cancelEv(L, actor, starI))
        cancelled++
      } else if (op === 4 && owner === actor.addr) {
        const bids = L.offers.onStar(starI)
        if (bids[0]) {
          apply(L, acceptEv(L, actor, starI, bids[0].price, bids[0].bidder))
          accepted++
        }
      }
    } catch {
      refused++
      if (L.cascadeRoot() !== before) { ok(false, 'swarm refuse #' + i + ' mutated the root'); break }
    }
    if (!L.conserves() || L.balanceOf(STAR_OFFER) !== L.offers.lockedTotal()) {
      ok(false, 'swarm broke conservation or pot≠book at step ' + i)
      break
    }
  }
  solvent(L, `swarm solvent after ${accepted} accept / ${offered} offer / ${cancelled} cancel / ${listed} list / ${bought} buy / ${refused} refuse`)
  ok(accepted + offered + cancelled + listed + bought > 20, `swarm actually moved state (${accepted + offered + cancelled + listed + bought} accepted acts)`)

  const live = L.cascadeRoot()
  const twin = new KrayLedger(undefined, NET)
  for (const e of journal) twin.applyLive(e)
  ok(twin.cascadeRoot() === live, 'stranger replay re-derives the identical cascade root')
  ok(twin.balanceOf(STAR_OFFER) === twin.offers.lockedTotal(), 'twin pot == book')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — offers hold under hostility and swarm. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
