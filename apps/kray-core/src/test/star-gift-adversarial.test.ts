/**
 * THE GIFT AND ITS TERMS — adversarial + swarm. Prove by breaking.
 *
 *   node src/test/star-gift-adversarial.test.ts
 *
 * A listing may cost nothing (a drop), may name the one address it was left for, may open only for whoever HOLDS a
 * star (the right travels with the star, not with a name), and may wait for a Bitcoin height (a bequest). Every one
 * of those terms is SIGNED into the offer. This file tries to break each of them:
 *
 *   · a relay that ADDS a term, STRIPS a term, or REWRITES one (to itself, to a star it holds, to an earlier height)
 *   · the same signed act replayed twice, and an act signed for another network
 *   · a taker who is not the one named, who does not hold the key star, who is early, who is broke
 *   · the seller taking their own gift, listing a star they do not hold, gating an offer with itself
 *   · a gate on star #0 (a real star — the sentinel that once ate a whole condition)
 *   · a gate on a star nobody holds, and on a star given to the black hole
 *   · a stale offer after the star moved, and an offer re-listed under new terms
 *   · heights at and beyond the boundary, and heights that are not heights
 *
 * After every act, accepted or refused: conservation, and a refusal must leave the cascade root untouched. Then a
 * seeded swarm of mixed gifts, takes, re-lists and delists, and a replay twin that must reach the same root.
 */
import { KrayLedger } from '../protocol/ledger.ts'
import { BLACK_HOLE } from '../protocol/kray-primitives.ts'
import { starListV2Message, type ListingTerms } from '../protocol/star-market.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes,
  starListMessage, starDelistMessage, starBuyMessage, sendStarMessage, inscribeMessageV2,
} from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'
import * as btc from '@scure/btc-signer'
import { createHash } from 'node:crypto'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const halts = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') } catch (e) {
    const s = (e as Error).message
    ok(re.test(s), m + (re.test(s) ? '' : ` — wrong refusal: ${s.slice(0, 120)}`))
  }
}

interface W { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`star-gift|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)

let seq = 0
const mint = (L: KrayLedger, to: string, amt: string) =>
  L.applyLive({ seq: ++seq, kind: 'donate', hash: 'g' + seq, to, amount: amt, outpoint: createHash('sha256').update('go' + seq).digest('hex') + ':0' } as unknown as KrayEvent)
function bornStar(L: KrayLedger, owner: W, tag: string, journal?: KrayEvent[]): bigint {
  const before = L.stars.createdSeq
  const nonce = L.nonceOf(owner.addr)
  const msg = inscribeMessageV2(NET, owner.addr, tag, 'text/plain', tag.length, undefined, nonce)
  const e = { seq: ++seq, kind: 'inscribe', hash: 'g' + seq, at: seq, from: owner.addr, contentHash: tag, contentType: 'text/plain', size: tag.length, nonce, publicKey: owner.pk, signature: sign(msg, owner), scheme: 'kraywallet', fee: '0' } as unknown as KrayEvent
  L.applyLive(e)
  journal?.push(e)
  return BigInt(before)
}
/** A listing with terms. `carry` rewrites what TRAVELS after the signature — the relay's hands. */
function listEv(L: KrayLedger, w: W, star: bigint, price: bigint, terms: ListingTerms = {}, carry?: Partial<{ to: string; gateStar: string; notBefore: number; signNet: string; signTerms: ListingTerms | null; strip: ('to' | 'gateStar' | 'notBefore')[] }>): KrayEvent {
  const nonce = L.nonceOf(w.addr)
  const signNet = carry?.signNet ?? NET
  const signed = carry?.signTerms === null
    ? starListMessage(signNet, w.addr, star, price, nonce)
    : starListV2Message(signNet, w.addr, star, price, carry?.signTerms ?? terms, nonce)
  const hasAny = !!terms.to || terms.gate !== undefined || (terms.notBefore ?? 0) > 0
  const e: Record<string, unknown> = {
    seq: ++seq, kind: 'star-list', hash: 'g' + seq, at: seq, from: w.addr, star: star.toString(), amount: price.toString(),
    fee: '1', nonce, publicKey: w.pk, signature: sign(hasAny || carry?.signTerms === null ? signed : starListMessage(signNet, w.addr, star, price, nonce), w), scheme: 'kraywallet',
  }
  if (terms.to) e.to = terms.to
  if (terms.gate !== undefined) e.gateStar = terms.gate.toString()
  if (terms.notBefore !== undefined) e.notBefore = terms.notBefore
  if (carry?.to !== undefined) e.to = carry.to
  if (carry?.gateStar !== undefined) e.gateStar = carry.gateStar
  if (carry?.notBefore !== undefined) e.notBefore = carry.notBefore
  for (const field of carry?.strip ?? []) delete e[field]   // the relay's scissors: a term removed in flight
  return e as unknown as KrayEvent
}
const delistEv = (L: KrayLedger, w: W, star: bigint): KrayEvent => {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'star-delist', hash: 'g' + seq, at: seq, from: w.addr, star: star.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(starDelistMessage(NET, w.addr, star, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
const buyEv = (L: KrayLedger, buyer: W, star: bigint, price: bigint, seller: string): KrayEvent => {
  const nonce = L.nonceOf(buyer.addr)
  return { seq: ++seq, kind: 'star-buy', hash: 'g' + seq, at: seq, from: buyer.addr, to: seller, star: star.toString(), amount: price.toString(), fee: '1', nonce, publicKey: buyer.pk, signature: sign(starBuyMessage(NET, buyer.addr, star, price, seller, nonce), buyer), scheme: 'kraywallet' } as unknown as KrayEvent
}
const sendStarEv = (L: KrayLedger, w: W, to: string, star: bigint): KrayEvent => {
  const nonce = L.nonceOf(w.addr)
  return { seq: ++seq, kind: 'transfer-star', hash: 'g' + seq, at: seq, from: w.addr, to, star: star.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(sendStarMessage(NET, w.addr, to, star, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}

function main(): void {
  console.log('\n╔═ THE GIFT AND ITS TERMS — every hostile vector, fired ══╗\n')
  const giver = wallet('giver'), heir = wallet('heir'), thief = wallet('thief')

  // ── 1 · THE RELAY'S HANDS — a term is worth nothing unless the signature covers it ──
  {
    const L = new KrayLedger(undefined, NET)
    mint(L, giver.addr, '50'); mint(L, heir.addr, '50'); mint(L, thief.addr, '50')
    const star = bornStar(L, giver, 'relay-subject')
    const thiefStar = bornStar(L, thief, 'thief-key')
    const root = L.cascadeRoot()

    halts(() => L.applyLive(listEv(L, giver, star, 0n, { to: heir.addr }, { signTerms: null })), /signature/i,
      '1 · a name ADDED after the signature is refused (the relay cannot invent a condition)')
    halts(() => L.applyLive(listEv(L, giver, star, 0n, { to: heir.addr }, { to: thief.addr })), /signature/i,
      '1 · a name REWRITTEN to the relay is refused')
    halts(() => L.applyLive(listEv(L, giver, star, 0n, { to: heir.addr }, { strip: ['to'] })), /signature/i,
      '1 · a name STRIPPED from a signed offer is refused (the referee rebuilds the v1 line and it no longer matches)')
    halts(() => L.applyLive(listEv(L, giver, star, 0n, { to: heir.addr, notBefore: 900_000 }, { strip: ['notBefore'] })), /signature/i,
      '1 · a bequest\'s height STRIPPED in flight is refused — nobody can make an heir\'s date arrive early')
    halts(() => L.applyLive(listEv(L, giver, star, 0n, { gate: 0n }, { strip: ['gateStar'] })), /signature/i,
      '1 · the key star STRIPPED in flight is refused — a gated offer cannot be opened to everyone')
    halts(() => L.applyLive(listEv(L, giver, star, 0n, { gate: 0n }, { gateStar: thiefStar.toString() })), /signature/i,
      '1 · the key star REWRITTEN to one the relay holds is refused')
    halts(() => L.applyLive(listEv(L, giver, star, 0n, { to: heir.addr, notBefore: 900_000 }, { notBefore: 1 })), /signature/i,
      '1 · a bequest\'s height LOWERED in flight is refused')
    halts(() => L.applyLive(listEv(L, giver, star, 0n, { to: heir.addr }, { signNet: 'main' })), /signature/i,
      '1 · an offer signed for another network is refused here (the net is inside the message)')
    ok(L.cascadeRoot() === root && !L.market.get(star) && L.conserves(), '1 · not one refusal moved a byte of state')
  }

  // ── 2 · THE NAMED GIFT — only that hand, and nobody pays for being refused ──
  {
    const L = new KrayLedger(undefined, NET)
    mint(L, giver.addr, '50'); mint(L, heir.addr, '50'); mint(L, thief.addr, '50')
    const star = bornStar(L, giver, 'named-subject')
    L.applyLive(listEv(L, giver, star, 0n, { to: heir.addr }))
    const thiefBefore = L.balanceOf(thief.addr), root = L.cascadeRoot()
    halts(() => L.applyLive(buyEv(L, thief, star, 0n, giver.addr)), /left for another address/, '2 · the thief is refused')
    ok(L.balanceOf(thief.addr) === thiefBefore && L.cascadeRoot() === root, '2 · the refused thief paid nothing and moved nothing')
    halts(() => L.applyLive(buyEv(L, giver, star, 0n, giver.addr)), /already belongs to you/, '2 · the giver cannot take their own gift')
    // The same signed take, applied twice: the nonce law refuses the second.
    const take = buyEv(L, heir, star, 0n, giver.addr)
    L.applyLive(take)
    ok(L.stars.ownerOf(star) === heir.addr, '2 · the heir took it')
    const replay = { ...take, seq: ++seq, hash: 'g' + seq } as KrayEvent
    halts(() => L.applyLive(replay), /not listed|nonce/i, '2 · the same signed take replayed is refused')
    ok(L.conserves(), '2 · conservation holds')
  }

  // ── 3 · THE KEY STAR — the right travels with the star, and star #0 is a real star ──
  {
    const L = new KrayLedger(undefined, NET)
    mint(L, giver.addr, '60'); mint(L, heir.addr, '60'); mint(L, thief.addr, '60')
    const zero = bornStar(L, heir, 'star-zero')          // the first star of this ledger IS #0
    ok(zero === 0n, '3 · fixture: the first star of a ledger is #0 — a real star, never a sentinel')
    const prize = bornStar(L, giver, 'gated-by-zero')
    L.applyLive(listEv(L, giver, prize, 0n, { gate: zero }))
    ok(L.market.get(prize)?.gate === 0n, '3 · an offer gated by star #0 keeps its condition (the sentinel bug stays dead)')
    halts(() => L.applyLive(buyEv(L, thief, prize, 0n, giver.addr)), /whoever holds star 0/, '3 · a stranger cannot open a #0-gated offer')
    L.applyLive(buyEv(L, heir, prize, 0n, giver.addr))
    ok(L.stars.ownerOf(prize) === heir.addr, '3 · the holder of star #0 opens it')

    // A GATE ON A GHOST IS REFUSED AT BIRTH. Such an offer could never be taken by any hand on earth, and
    // only its lister could sweep it — so it would sit in the cascade root forever for the price of one ₭.
    // The key must be a star that exists, so the right it carries can actually reach somebody.
    const ghost = 999_999n
    const stranded = bornStar(L, giver, 'gated-by-a-ghost')
    halts(() => L.applyLive(listEv(L, giver, stranded, 0n, { gate: ghost })), /does not exist/, '3 · an offer gated by a star nobody holds is refused at birth')
    ok(!L.market.get(stranded) && L.stars.ownerOf(stranded) === giver.addr, '3 · nothing was written, and the star is still the giver\'s')

    // A key given to the fire opens nothing: the black hole is nobody's hand.
    const burnedKey = bornStar(L, heir, 'key-to-burn')
    const behind = bornStar(L, giver, 'behind-the-burned-key')
    L.applyLive(listEv(L, giver, behind, 0n, { gate: burnedKey }))
    L.applyLive(sendStarEv(L, heir, BLACK_HOLE, burnedKey))
    halts(() => L.applyLive(buyEv(L, heir, behind, 0n, giver.addr)), /whoever holds star/, '3 · a key given to the black hole opens nothing, for anyone')
    ok(L.conserves(), '3 · conservation holds')
  }

  // ── 4 · THE BEQUEST — the chain's own height, at and beyond the boundary ──
  {
    const L = new KrayLedger(undefined, NET)
    mint(L, giver.addr, '60'); mint(L, heir.addr, '60')
    const estate = bornStar(L, giver, 'estate')
    // AN ILL-FORMED HEIGHT IS ABSENT, NEVER FATAL — the one reader drops it, so the law's line carries no
    // height at all. A term that changes the line (a fraction, an impossible height) fails its signature;
    // one that does NOT change it (a negative, which already renders as `notBefore=0`) is simply inert, so
    // a relay cannot kill somebody's honest, correctly signed act by appending one to it.
    halts(() => L.applyLive(listEv(L, giver, estate, 0n, { to: heir.addr, notBefore: 21_000_001 })), /signature|verify|mirror/i, '4 · a height beyond the last block Bitcoin will ever have is not a height')
    halts(() => L.applyLive(listEv(L, giver, estate, 0n, { to: heir.addr, notBefore: 1.5 })), /signature|verify|mirror/i, '4 · nor a fractional one')
    L.applyLive(listEv(L, giver, estate, 0n, { to: heir.addr, notBefore: -1 }))
    ok(L.market.get(estate)?.notBefore === undefined && L.market.get(estate)?.to === heir.addr,
      '4 · a negative height is INERT — the named offer stands, and nothing was killed')
    L.applyLive(listEv(L, giver, estate, 0n, { to: heir.addr, notBefore: 21_000_000 }))
    ok(L.market.get(estate)?.notBefore === 21_000_000, '4 · the last honest height is accepted')
    const heirBefore = L.balanceOf(heir.addr)
    halts(() => L.applyLive(buyEv(L, heir, estate, 0n, giver.addr)), /opens at Bitcoin height/, '4 · the heir waits — the chain has sealed nothing near it')
    ok(L.balanceOf(heir.addr) === heirBefore, '4 · waiting costs the heir nothing')
    // The living hand rules: re-list without the height, and the bequest becomes a gift now.
    L.applyLive(listEv(L, giver, estate, 0n, { to: heir.addr }))
    L.applyLive(buyEv(L, heir, estate, 0n, giver.addr))
    ok(L.stars.ownerOf(estate) === heir.addr && L.conserves(), '4 · the giver lifted the date and the heir took it')
  }

  // ── 5 · THE OFFER ITSELF — ownership, self-gating, staleness, and a broke taker ──
  {
    const L = new KrayLedger(undefined, NET)
    mint(L, giver.addr, '60'); mint(L, heir.addr, '2'); mint(L, thief.addr, '60')
    const star = bornStar(L, giver, 'offer-subject')
    halts(() => L.applyLive(listEv(L, thief, star, 0n, { to: heir.addr })), /do not hold/, '5 · nobody lists a star they do not hold, gift or not')
    halts(() => L.applyLive(listEv(L, giver, star, 0n, { gate: star })), /very star it offers/, '5 · an offer cannot be opened by the very star it offers')
    halts(() => L.applyLive(listEv(L, giver, star, 0n, { to: giver.addr })), /nobody/i, '5 · an offer named for yourself is nobody\'s offer')
    halts(() => L.applyLive(listEv(L, giver, star, -1n)), /zero or more/, '5 · a negative price is refused')

    L.applyLive(listEv(L, giver, star, 0n, { to: heir.addr }))
    L.applyLive(sendStarEv(L, giver, thief.addr, star))   // the giver hands the star away: the offer is now stale
    halts(() => L.applyLive(buyEv(L, heir, star, 0n, giver.addr)), /not listed|no longer holds/, '5 · a stale gift is refused after the star moved')
    ok(L.stars.ownerOf(star) === thief.addr && L.conserves(), '5 · and nothing moved on that refusal')

    // A taker with no ₭ at all cannot even pay the eternal fee — and pays nothing trying.
    const broke = wallet('broke')
    const free = bornStar(L, giver, 'free-for-the-broke')
    L.applyLive(listEv(L, giver, free, 0n, { to: broke.addr }))
    halts(() => L.applyLive(buyEv(L, broke, free, 0n, giver.addr)), /insufficient balance/, '5 · a taker who cannot pay the eternal fee is refused')
    ok(L.balanceOf(broke.addr) === 0n && L.stars.ownerOf(free) === giver.addr, '5 · the broke taker moved nothing')
  }

  // ── 5b · THE THREE TERMS AT ONCE — they are an AND, never an OR ──
  {
    const L = new KrayLedger(undefined, NET)
    mint(L, giver.addr, '60'); mint(L, heir.addr, '60'); mint(L, thief.addr, '60')
    const key = bornStar(L, heir, 'all-three-key')
    const prize = bornStar(L, giver, 'all-three-prize')
    L.applyLive(listEv(L, giver, prize, 0n, { to: heir.addr, gate: key, notBefore: 900_000 }))
    const l = L.market.get(prize)
    ok(l?.to === heir.addr && l?.gate === key && l?.notBefore === 900_000, '5b · an offer can carry all three terms at once')
    halts(() => L.applyLive(buyEv(L, thief, prize, 0n, giver.addr)), /left for another address/, '5b · the wrong hand is refused first')
    halts(() => L.applyLive(buyEv(L, heir, prize, 0n, giver.addr)), /opens at Bitcoin height/, '5b · the right hand holding the key still waits for the height')
    L.applyLive(listEv(L, giver, prize, 0n, { to: heir.addr, gate: key }))
    L.applyLive(sendStarEv(L, heir, thief.addr, key))     // the heir gives the key away
    halts(() => L.applyLive(buyEv(L, heir, prize, 0n, giver.addr)), /whoever holds star/, '5b · the named hand without the key is refused too — every term must hold')
    ok(L.conserves(), '5b · conservation holds')
  }

  // ── 5c · A NAME THAT IS NOT A HAND — a label can never sign, so it can never take ──
  {
    const L = new KrayLedger(undefined, NET)
    mint(L, giver.addr, '40')
    const star = bornStar(L, giver, 'named-for-a-label')
    let listed = true
    try { L.applyLive(listEv(L, giver, star, 0n, { to: BLACK_HOLE })) } catch { listed = false }
    // Either the ledger refuses the label outright, or the offer stands and opens for nobody — never for a stranger.
    if (listed) {
      halts(() => L.applyLive(buyEv(L, heir, star, 0n, giver.addr)), /left for another address/, '5c · an offer named for the black hole opens for no living hand')
      L.applyLive(delistEv(L, giver, star))
      ok(!L.market.get(star) && L.stars.ownerOf(star) === giver.addr, '5c · and the giver takes it back')
    } else ok(true, '5c · the ledger refuses an offer named for a protocol label outright')
    ok(L.conserves(), '5c · conservation holds')
  }

  // ── 6 · THE COMMITMENT — terms are IN the root, so no node can quietly forget one ──
  {
    const A = new KrayLedger(undefined, NET), B = new KrayLedger(undefined, NET)
    const journalA: KrayEvent[] = [], journalB: KrayEvent[] = []
    const record = (L: KrayLedger, j: KrayEvent[], e: KrayEvent) => { L.applyLive(e); j.push(e) }
    for (const [L, j] of [[A, journalA], [B, journalB]] as const) {
      seq = 10_000 + (L === A ? 0 : 5_000)
      record(L, j, { seq: ++seq, kind: 'donate', hash: 'c' + seq, to: giver.addr, amount: '40', outpoint: createHash('sha256').update('c' + seq).digest('hex') + ':0' } as unknown as KrayEvent)
      const s = bornStar(L, giver, 'commitment-subject', j)
      record(L, j, listEv(L, giver, s, 0n, L === A ? { to: heir.addr } : {}))
    }
    ok(A.cascadeRoot() !== B.cascadeRoot(), '6 · a named gift and an open gift do NOT fold to the same root — the name is committed')
    const twin = new KrayLedger(undefined, NET)
    for (const e of journalA) twin.applyLive(e)
    ok(twin.cascadeRoot() === A.cascadeRoot(), '6 · a stranger replaying the journal reaches the same root, terms and all')
    ok(JSON.stringify(twin.market.all()) === JSON.stringify(A.market.all()), '6 · and the same market page, terms and all')
  }

  // ── 7 · THE SWARM — 3 seeds × 160 mixed acts, every one either applied or refused with no trace ──
  for (const seed of [11, 29, 83]) {
    const L = new KrayLedger(undefined, NET)
    const journal: KrayEvent[] = []
    const apply = (e: KrayEvent): boolean => { const root = L.cascadeRoot(); try { L.applyLive(e); journal.push(e); return true } catch { if (L.cascadeRoot() !== root) { ok(false, `seed ${seed}: a refusal moved the root`); throw new Error('halt') } return false } }
    seq = 100_000 + seed * 1_000
    const crowd = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((t) => wallet(`swarm-${seed}-${t}`))
    for (const w of crowd) apply({ seq: ++seq, kind: 'donate', hash: `s${seed}-${seq}`, to: w.addr, amount: '200', outpoint: createHash('sha256').update(`s${seed}-${seq}`).digest('hex') + ':0' } as unknown as KrayEvent)
    const stars: bigint[] = []
    for (const w of crowd) stars.push(bornStar(L, w, `swarm-${seed}-${w.addr.slice(-6)}`, journal))
    let state = seed * 7919
    const rnd = (n: number): number => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state % n }
    let taken = 0, refused = 0
    for (let step = 0; step < 420; step++) {
      const w = crowd[rnd(crowd.length)]!, other = crowd[rnd(crowd.length)]!
      // Bias the storm at the paths that matter: something is usually listed, and a take usually meets a LIVE offer.
      const live = stars.filter((s) => !!L.market.get(s))
      const mine = stars.filter((s) => L.stars.ownerOf(s) === w.addr)
      const move = rnd(10) < 4 ? 0 : rnd(10) < 7 ? 2 : rnd(2) === 0 ? 1 : 3
      const star = move === 2 && live.length ? live[rnd(live.length)]! : mine.length ? mine[rnd(mine.length)]! : stars[rnd(stars.length)]!
      const owner = L.stars.ownerOf(star)
      if (move === 0 && owner === w.addr) {
        const terms: ListingTerms = rnd(3) === 0 ? { to: other.addr } : rnd(3) === 0 ? { gate: stars[rnd(stars.length)]! } : {}
        if (terms.to === w.addr || terms.gate === star) { refused++; continue }
        apply(listEv(L, w, star, rnd(4) === 0 ? BigInt(1 + rnd(3)) : 0n, terms))   // mostly gifts: the feature under attack
      } else if (move === 1 && owner === w.addr) {
        apply(delistEv(L, w, star))
      } else if (move === 2) {
        const listing = L.market.get(star)
        if (!listing) { refused++; continue }
        const before = L.stars.ownerOf(star)
        if (apply(buyEv(L, w, star, listing.price, listing.seller))) {
          taken++
          ok(L.stars.ownerOf(star) === w.addr, `seed ${seed}: an accepted take moved the star`)
          if (listing.to) ok(listing.to === w.addr, `seed ${seed}: only the named hand took a named offer`)
          if (listing.gate !== undefined) ok(L.stars.ownerOf(listing.gate) === w.addr || listing.gate === star, `seed ${seed}: only the key-holder took a gated offer`)
        } else { refused++; ok(L.stars.ownerOf(star) === before, `seed ${seed}: a refused take moved nothing`) }
      } else if (owner === w.addr) {
        apply(sendStarEv(L, w, other.addr, star))
      } else refused++
      if (!L.conserves()) { ok(false, `seed ${seed} step ${step}: conservation broke`); break }
    }
    ok(L.conserves(), `seed ${seed}: ${taken} takes, ${refused} refusals — conservation holds at the end of the storm`)
    // One star, one owner, always: no take ever duplicated a star or left one ownerless.
    const owners = stars.map((s) => L.stars.ownerOf(s))
    ok(owners.every((o) => typeof o === 'string' && o.length > 0), `seed ${seed}: every star still has exactly one owner`)
    // A STRANGER re-derives the same world from the bytes alone — terms, offers, owners and all.
    const twin = new KrayLedger(undefined, NET)
    for (const e of journal) twin.applyLive(e)
    ok(twin.cascadeRoot() === L.cascadeRoot(), `seed ${seed}: a replay twin reaches the same cascade root`)
    ok(twin.stars.merkleRoot() === L.stars.merkleRoot(), `seed ${seed}: and the same star merkle root`)
    ok(JSON.stringify(twin.market.all()) === JSON.stringify(L.market.all()), `seed ${seed}: and the same live offers, with their terms`)
  }

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the gift, its name, its key star and its height held every attack. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
