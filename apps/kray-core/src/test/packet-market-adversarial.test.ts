/**
 * THE PACKET MARKET — adversarial + swarm. Prove by breaking.
 *
 *   node src/test/packet-market-adversarial.test.ts
 *
 * The packet market moves ₭, the Luz of a star and a rune of the L2 under the star market's law. This file
 * attacks it the way a hostile relay, a greedy taker and a lying seller would: every field of the signed line
 * added, stripped and rewritten; lanes crossed; networks crossed; pots impersonated; offers replayed, raced,
 * front-run, taken in part, taken stale, taken early, taken by the wrong hand. Then a seeded storm across all
 * three lanes, each with a replay twin that must reach the identical cascade root.
 *
 * THE BAR: an accepted act is exactly the act that was signed, and a refused act leaves the books, the
 * balances and the root byte-identical — not even a fee moves (A1: conservation or HALT).
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, nameMessageV2, contractMessageV2, inscribeMessageV2, transferMessage } from '../protocol/scheme.ts'
import { packetListMessage, packetDelistMessage, packetTakeMessage, packetTermsHash, type PacketLane } from '../protocol/packet-market.ts'
import { contractAddress, canonicalCode } from '../protocol/contract.ts'
import { ammPoolAddress } from '../protocol/amm.ts'
import { compileCut } from '../protocol/star-forms.ts'
import type { ListingTerms } from '../protocol/star-market.ts'
import { sha256hex, BLACK_HOLE, TREASURY, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

interface W { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`packet-adv|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)

const RUNE = '840000:7'
const runeId = { block: 840000n, tx: 7n }
let seq = 0

function assetFields(lane: PacketLane, asset: string): Record<string, unknown> {
  if (lane === 'luz') return { star: asset }
  if (lane === 'rune') return { runeId: asset }
  return {}
}
/** A listing. `sign` twists ONLY the bytes that were signed (the relay attack); `wire` twists only what rides. */
function listEv(L: KrayLedger, w: W, lane: PacketLane, asset: string, amount: bigint, price: bigint, terms: ListingTerms = {}, twist?: {
  sign?: Partial<{ lane: PacketLane; asset: string; amount: bigint; price: bigint; terms: ListingTerms; net: string; from: string }>
  wire?: Record<string, unknown>; strip?: string[]; by?: W; fee?: string
}): KrayEvent {
  const nonce = L.nonceOf(w.addr), s = twist?.sign ?? {}, signer = twist?.by ?? w, sq = L.appliedSeq + 1
  const msg = packetListMessage(s.net ?? NET, s.from ?? w.addr, s.lane ?? lane, s.asset ?? asset, s.amount ?? amount, s.price ?? price, s.terms ?? terms, nonce)
  const e: Record<string, unknown> = {
    seq: sq, kind: 'packet-list', hash: 'h' + ++seq, at: seq, from: w.addr, lane, ...assetFields(lane, asset),
    amount: amount.toString(), price: price.toString(), fee: twist?.fee ?? '1', nonce, publicKey: signer.pk, signature: sign(msg, signer), scheme: 'kraywallet',
  }
  if (terms.to) e.to = terms.to
  if (terms.gate !== undefined) e.gateStar = terms.gate.toString()
  if (terms.notBefore !== undefined) e.notBefore = terms.notBefore
  Object.assign(e, twist?.wire ?? {})
  for (const k of twist?.strip ?? []) delete e[k]
  return e as unknown as KrayEvent
}
function delistEv(L: KrayLedger, w: W, lane: PacketLane, asset: string, twist?: { by?: W; fee?: string }): KrayEvent {
  const nonce = L.nonceOf(w.addr), signer = twist?.by ?? w, sq = L.appliedSeq + 1
  return {
    seq: sq, kind: 'packet-delist', hash: 'h' + ++seq, at: seq, from: w.addr, lane, ...assetFields(lane, asset),
    fee: twist?.fee ?? '1', nonce, publicKey: signer.pk, signature: sign(packetDelistMessage(NET, w.addr, lane, asset, nonce), signer), scheme: 'kraywallet',
  } as unknown as KrayEvent
}
/** The terms the book shows for this offer — what an honest taker declares they answered. */
const termsSeen = (L: KrayLedger, lane: PacketLane, asset: string, seller: string): string => packetTermsHash(L.packets.get(lane, asset, seller) ?? undefined)
function takeEv(L: KrayLedger, taker: W, seller: string, lane: PacketLane, asset: string, amount: bigint, price: bigint, twist?: {
  sign?: Partial<{ seller: string; lane: PacketLane; asset: string; amount: bigint; price: bigint; net: string; terms: string }>
  wire?: Record<string, unknown>; by?: W; fee?: string; nonce?: number; terms?: string
}): KrayEvent {
  const nonce = twist?.nonce ?? L.nonceOf(taker.addr), s = twist?.sign ?? {}, signer = twist?.by ?? taker, sq = L.appliedSeq + 1
  const declared = twist?.terms ?? termsSeen(L, lane, asset, seller)
  const msg = packetTakeMessage(s.net ?? NET, taker.addr, s.seller ?? seller, s.lane ?? lane, s.asset ?? asset, s.amount ?? amount, s.price ?? price, s.terms ?? declared, nonce)
  const e: Record<string, unknown> = {
    seq: sq, kind: 'packet-take', hash: 'h' + ++seq, at: seq, from: taker.addr, to: seller, lane, ...assetFields(lane, asset),
    amount: amount.toString(), price: price.toString(), fee: twist?.fee ?? '1', nonce, publicKey: signer.pk, signature: sign(msg, signer), scheme: 'kraywallet',
    ...(declared ? { termsHash: declared } : {}),
  }
  Object.assign(e, twist?.wire ?? {})
  return e as unknown as KrayEvent
}

function main() {
  console.log('\n╔═ THE PACKET MARKET — adversarial · every field, every lane, every hand ══╗\n')
  const A = wallet('alice'), B = wallet('bob'), C = wallet('carol'), E = wallet('eve')

  const L = new KrayLedger(undefined, NET)
  const journal: KrayEvent[] = []
  const push = (e: KrayEvent) => {
    const before = L.appliedSeq
    L.applyLive(e)
    // `applyLive` returns silently for an event at or below the applied seq (idempotent replay, by design).
    // In a test that silence would look like success, so here it is a hard failure.
    if (L.appliedSeq === before) throw new Error(`test: the ${e.kind} at seq ${e.seq} was silently skipped — the ledger is already at ${before}`)
    journal.push(e)
  }
  const snap = () => JSON.stringify({
    root: L.cascadeRoot(), book: L.packets.commitment(), cut: L.cuts.commitment(),
    bal: [A, B, C, E].map(w => L.balanceOf(w.addr).toString()), tre: L.balanceOf(TREASURY).toString(),
    runes: [A, B, C, E].map(w => L.runes.balanceOf(runeId, w.addr).toString()),
  })
  /** An attack must throw with the RIGHT reason and leave the whole world byte-identical — not even a fee. */
  const attack = (e: () => KrayEvent, re: RegExp, m: string) => {
    const before = snap()
    let built: KrayEvent | null = null
    try { built = e() } catch (err) { ok(re.test((err as Error).message), m + ' (refused while building)'); return }
    const at = L.appliedSeq
    try {
      L.applyLive(built)
      ok(false, m + (L.appliedSeq === at ? ' — the ledger SKIPPED it (stale seq); the attack never ran' : ' — DID NOT throw'))
    }
    catch (err) {
      const msg = (err as Error).message
      ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg))
      ok(snap() === before && L.conserves(), m + ' — and the world is byte-identical')
    }
  }
  const mint = (to: string, amt: string) =>
    push({ seq: L.appliedSeq + 1, kind: 'donate', hash: 'h' + ++seq, at: seq, to, amount: amt, outpoint: createHash('sha256').update('o' + seq).digest('hex') + ':0' } as unknown as KrayEvent)

  mint(A.addr, '9000'); mint(B.addr, '900'); mint(C.addr, '900'); mint(E.addr, '900')
  push({ seq: L.appliedSeq + 1, kind: 'name', hash: 'h' + ++seq, at: seq, from: A.addr, name: 'packetadv', nonce: L.nonceOf(A.addr), publicKey: A.pk, signature: sign(nameMessageV2(NET, A.addr, L.nonceOf(A.addr), 'packetadv'), A), scheme: 'kraywallet' } as unknown as KrayEvent)
  const paper = compileCut({ supply: '100000' })
  push({ seq: L.appliedSeq + 1, kind: 'contract', hash: 'h' + ++seq, at: seq, from: A.addr, code: paper, star: '0', nonce: L.nonceOf(A.addr), publicKey: A.pk, signature: sign(contractMessageV2(NET, A.addr, sha256hex(canonicalCode(paper)), 0n), A), scheme: 'kraywallet' } as unknown as KrayEvent)
  L.runes.deposit(runeId, 'aa'.repeat(32) + ':0', 9000n, A.addr, { pool: true })

  // ── 1 · THE SIGNED LINE — a relay may not add, strip or rewrite a single field ──────────────────
  console.log('\n─ 1 · the signed line: add · strip · rewrite ─')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { sign: { price: 1n } }), /signature|verify|mirror/i, '1 · a price rewritten after signing')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { sign: { amount: 1n } }), /signature|verify|mirror/i, '1 · an amount rewritten after signing')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { sign: { lane: 'luz' } }), /signature|verify|mirror/i, '1 · a lane rewritten after signing')
  attack(() => listEv(L, A, 'luz', '0', 100n, 10n, {}, { sign: { asset: '1' } }), /signature|verify|mirror/i, '1 · an asset rewritten after signing')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, { to: B.addr }, { sign: { terms: {} } }), /signature|verify|mirror/i, '1 · a NAME added by the relay')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { sign: { terms: { to: E.addr } } }), /signature|verify|mirror/i, '1 · a name STRIPPED by the relay')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, { to: B.addr }, { wire: { to: E.addr } }), /signature|verify|mirror/i, '1 · a name REDIRECTED by the relay')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, { gate: 0n }, { strip: ['gateStar'] }), /signature|verify|mirror/i, '1 · a key star stripped by the relay')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, { notBefore: 800_000 }, { strip: ['notBefore'] }), /signature|verify|mirror/i, '1 · a waiting height stripped by the relay')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { wire: { gateStar: '0' } }), /signature|verify|mirror/i, '1 · a key star ADDED by the relay')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { wire: { notBefore: 800_000 } }), /signature|verify|mirror/i, '1 · a waiting height ADDED by the relay')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { sign: { net: 'main' } }), /signature|verify|mirror/i, '1 · an offer signed for MAIN cannot be replayed on regtest')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { by: E }), /signature|verify|key/i, '1 · Eve cannot sign in Alice\'s name')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { fee: '2' }), /eternal 1-₭ fee/, '1 · the eternal fee cannot be inflated')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { fee: '0' }), /eternal 1-₭ fee/, '1 · nor waived')

  // ── 2 · THE SHAPE OF A PACKET ──────────────────────────────────────────────────────────────────
  console.log('\n─ 2 · the shape of a packet ─')
  attack(() => listEv(L, A, 'kray', '', 0n, 10n), /positive amount/, '2 · a packet of nothing is refused')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { wire: { amount: '-5' } }), /whole number/, '2 · a negative amount is refused')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { wire: { price: '-1' } }), /whole number/, '2 · a negative price is refused')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { wire: { amount: '0x64' } }), /whole number/, '2 · a hex amount is refused (no twin spelling)')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { wire: { amount: '1e3' } }), /whole number/, '2 · an exponent is not a number of base units')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { wire: { amount: ' 100' } }), /whole number/, '2 · a padded amount is refused')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { wire: { amount: 100 } }), /whole number/, '2 · a JSON number is not a decimal string')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { wire: { lane: 'gold' } }), /unknown packet lane/, '2 · a lane that does not exist')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { strip: ['lane'] }), /unknown packet lane/, '2 · no lane at all')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { wire: { lane: 'KRAY' } }), /unknown packet lane/, '2 · a lane in the wrong case is a different word')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, {}, { wire: { star: '0' } }), /carries no other asset field/, '2 · a star smuggled onto a ₭ packet')
  attack(() => listEv(L, A, 'luz', '0', 100n, 10n, {}, { wire: { runeId: RUNE } }), /carries no other asset field/, '2 · a rune smuggled onto a Luz packet')
  attack(() => listEv(L, A, 'luz', '0', 100n, 10n, {}, { strip: ['star'] }), /canonical star number/, '2 · a Luz packet with no star')
  attack(() => listEv(L, A, 'rune', RUNE, 100n, 10n, {}, { strip: ['runeId'] }), /block:tx|rune/i, '2 · a rune packet with no rune')
  attack(() => listEv(L, A, 'rune', RUNE, 100n, 10n, {}, { wire: { runeId: '840000:7:1' } }), /block:tx|rune/i, '2 · a third field is an attempt, not an id')
  attack(() => listEv(L, A, 'luz', '0', 100n, 10n, {}, { wire: { star: 0 } }), /must be a string/, '2 · a JSON number where a star belongs (RegExp would coerce it — typeof first)')
  attack(() => listEv(L, A, 'rune', RUNE, 100n, 10n, {}, { wire: { runeId: 840000 } }), /must be a string/, '2 · a JSON number where a rune id belongs')

  // ── 3 · WHO MAY OFFER, WHO MAY TAKE ────────────────────────────────────────────────────────────
  console.log('\n─ 3 · who may offer, who may take ─')
  attack(() => listEv(L, E, 'kray', '', 100_000n, 1n), /do not hold that packet/, '3 · offering ₭ you have not got')
  attack(() => listEv(L, E, 'luz', '0', 1n, 1n), /do not hold that packet/, '3 · offering Luz you have not got')
  attack(() => listEv(L, E, 'rune', RUNE, 1n, 1n), /do not hold that packet/, '3 · offering runes you have not got')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, { to: A.addr }), /nobody's offer/, '3 · an offer named for yourself')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, { to: BLACK_HOLE }), /protocol pot|cannot be frozen|black hole|only burned/i, '3 · an offer left to the black hole')
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, { to: TREASURY }), /protocol pot/, '3 · an offer left to the treasury — a pot has no key to take it with')
  {
    // THE COMMITMENT MUST NAME ONE MARKET. A `KRAY_` label skips the address charset check, so a name
    // carrying the book's own separators would let two different books write the SAME committed line — and
    // the 32 bytes anchored to Bitcoin would stop naming a single state. Refused before it can be written.
    attack(() => listEv(L, A, 'kray', '', 100n, 10n, { to: 'KRAY_x\n' + A.addr + '|9|9' }), /protocol pot/, '3 · a name carrying the book\'s own separators cannot enter the commitment')
    attack(() => listEv(L, A, 'kray', '', 100n, 10n, { to: 'KRAY_TREASURY_NOT_REAL' }), /protocol pot/, '3 · nor any other unchecked KRAY_ label')
  }
  attack(() => listEv(L, A, 'kray', '', 100n, 10n, { to: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' }), /network|address/i, '3 · an offer left to an address of another network')
  {
    const pot = contractAddress(sha256hex(canonicalCode(paper)), A.addr, 7)
    const potW: W = { ...A, addr: pot }
    attack(() => listEv(L, potW, 'kray', '', 1n, 1n), /protocol pot|signature|verify|key/i, '3 · a law pot cannot list — it has no key to sign with')
    const ammW: W = { ...A, addr: ammPoolAddress(RUNE) }
    attack(() => listEv(L, ammW, 'kray', '', 1n, 1n), /protocol pot|signature|verify|key/i, '3 · an AMM pool cannot list either')
    const treW: W = { ...A, addr: TREASURY }
    attack(() => listEv(L, treW, 'kray', '', 1n, 1n), /protocol pot|signature|verify|key/i, '3 · nor the treasury')
  }

  // ── 4 · THE TAKE — stale, raced, partial, early, wrong hand ────────────────────────────────────
  console.log('\n─ 4 · the take: stale · raced · partial · early · wrong hand ─')
  push(listEv(L, A, 'kray', '', 500n, 50n))
  attack(() => takeEv(L, A, A.addr, 'kray', '', 500n, 50n), /already yours|different seller/, '4 · the seller cannot take their own offer')
  attack(() => takeEv(L, B, A.addr, 'kray', '', 500n, 49n), /≠ the signed take price|price/, '4 · a take at a price the offer never named')
  attack(() => takeEv(L, B, A.addr, 'kray', '', 499n, 50n), /≠ the signed take|whole or nothing/, '4 · a partial take')
  attack(() => takeEv(L, B, A.addr, 'kray', '', 501n, 50n), /≠ the signed take|whole or nothing/, '4 · a take of more than was offered')
  attack(() => takeEv(L, B, C.addr, 'kray', '', 500n, 50n), /not listed/, '4 · a take pointed at an innocent bystander')
  attack(() => takeEv(L, B, A.addr, 'luz', '0', 500n, 50n), /not listed/, '4 · a take that crosses into another lane')
  attack(() => takeEv(L, E, A.addr, 'kray', '', 500n, 50n, { wire: { fee: '1', amount: '500' }, by: B }), /signature|verify|key/i, '4 · a take forged in another citizen\'s name')
  {
    const poor = wallet('poor')
    push({ seq: L.appliedSeq + 1, kind: 'donate', hash: 'h' + ++seq, at: seq, to: poor.addr, amount: '10', outpoint: createHash('sha256').update('poor').digest('hex') + ':0' } as unknown as KrayEvent)
    attack(() => takeEv(L, poor, A.addr, 'kray', '', 500n, 50n), /insufficient balance/, '4 · a taker who cannot pay price + gas')
  }
  // the race: the first take consumes the offer, the second finds nothing
  const bBefore = L.balanceOf(B.addr)
  push(takeEv(L, B, A.addr, 'kray', '', 500n, 50n))
  ok(L.balanceOf(B.addr) === bBefore - 50n - 1n + 500n && L.conserves(), '4 · the winner of the race got exactly the packet, for exactly the price + gas')
  attack(() => takeEv(L, C, A.addr, 'kray', '', 500n, 50n), /not listed/, '4 · the loser of the race gets nothing — the offer was consumed once')
  // replay of the winning take: the nonce refuses it
  attack(() => takeEv(L, B, A.addr, 'kray', '', 500n, 50n, { nonce: L.nonceOf(B.addr) - 1 }), /nonce/i, '4 · replaying the winning take is refused by the nonce')

  // the stale offer: the seller spends what they offered
  push(listEv(L, A, 'kray', '', 4000n, 1n))
  {
    const nonce = L.nonceOf(A.addr), amount = L.balanceOf(A.addr) - 10n
    push({ seq: L.appliedSeq + 1, kind: 'transfer', hash: 'h' + ++seq, at: seq, from: A.addr, to: C.addr, amount: amount.toString(), fee: '1', nonce, publicKey: A.pk, signature: sign(transferMessage(NET, A.addr, C.addr, amount, nonce), A), scheme: 'kraywallet' } as unknown as KrayEvent)
  }
  attack(() => takeEv(L, B, A.addr, 'kray', '', 4000n, 1n), /no longer holds|stale/, '4 · a stale offer is refused, and the taker loses nothing')
  push(delistEv(L, A, 'kray', ''))

  {
    // A SELLER CANNOT RE-AIM AN OFFER UNDER A SIGNATURE. Amount and price were always signed; the TERMS
    // were not, so the same untouched bytes used to close whichever offer happened to stand at that
    // (lane, asset, seller) — including one re-listed with somebody else's name on it. The taker now
    // declares the terms they read, and the law refuses anything else.
    mint(A.addr, '2000'); mint(B.addr, '600')
    push(listEv(L, A, 'kray', '', 120n, 5n))
    const inFlight = takeEv(L, B, A.addr, 'kray', '', 120n, 5n)     // signed against the offer as it stands
    push(listEv(L, A, 'kray', '', 120n, 5n, { to: C.addr }))        // the seller re-aims it for 1 ₭
    attack(() => ({ ...inFlight, seq: L.appliedSeq + 1 } as KrayEvent), /no longer carries the terms you answered/, '4 · a re-aimed offer refutes a take signed against the old one')
    push(listEv(L, A, 'kray', '', 120n, 5n))                        // …and back again
    const b4 = L.balanceOf(B.addr)
    push(takeEv(L, B, A.addr, 'kray', '', 120n, 5n))
    ok(L.balanceOf(B.addr) === b4 - 5n - 1n + 120n && L.conserves(), '4 · and a take signed against THIS offer closes exactly it')
  }

  // ── 5 · THE TERMS — the name, the key star, the height ─────────────────────────────────────────
  console.log('\n─ 5 · the terms: the name · the key star · the height ─')
  mint(A.addr, '4000')
  push(listEv(L, A, 'kray', '', 300n, 0n, { to: B.addr }))
  attack(() => takeEv(L, C, A.addr, 'kray', '', 300n, 0n), /left for another address/, '5 · a named drop refuses every other hand')
  attack(() => takeEv(L, E, A.addr, 'kray', '', 300n, 0n), /left for another address/, '5 · including Eve\'s')
  push(takeEv(L, B, A.addr, 'kray', '', 300n, 0n))
  ok(!L.packets.get('kray', '', A.addr), '5 · the named hand took it, once')

  const keyStar = (() => {
    const before = L.stars.createdSeq, nonce = L.nonceOf(C.addr)
    push({ seq: L.appliedSeq + 1, kind: 'inscribe', hash: 'h' + ++seq, at: seq, from: C.addr, contentHash: 'k', contentType: 'text/plain', size: 1, nonce, publicKey: C.pk, signature: sign(inscribeMessageV2(NET, C.addr, 'k', 'text/plain', 1, undefined, nonce), C), scheme: 'kraywallet' } as unknown as KrayEvent)
    return BigInt(before)
  })()
  push(listEv(L, A, 'kray', '', 200n, 0n, { gate: keyStar }))
  attack(() => takeEv(L, B, A.addr, 'kray', '', 200n, 0n), /opens only for whoever holds star/, '5 · a key-star drop refuses whoever does not hold the key')
  attack(() => takeEv(L, E, A.addr, 'kray', '', 200n, 0n), /opens only for whoever holds star/, '5 · and Eve cannot mint herself a key')
  const c5 = L.balanceOf(C.addr)
  push(takeEv(L, C, A.addr, 'kray', '', 200n, 0n))
  ok(L.balanceOf(C.addr) === c5 - 1n + 200n, '5 · the key-holder took it for the gas alone')

  push(listEv(L, A, 'kray', '', 150n, 0n, { notBefore: 1 }))
  attack(() => takeEv(L, B, A.addr, 'kray', '', 150n, 0n), /opens at Bitcoin height/, '5 · a bequest at height 1 waits — the chain is sealed to nothing yet')
  {
    // Height ZERO is the ABSENT field, not a waiting height — the same law the gift listing follows, so a
    // wallet that spells "no height" as 0 signs and applies exactly the line an offer with no height signs.
    push(listEv(L, A, 'kray', '', 10n, 0n, { notBefore: 0 }))
    ok(L.packets.get('kray', '', A.addr)?.notBefore === undefined, '5 · height zero IS the absent field — the offer waits for nothing (it re-listed the waiting one)')
  }
  // AN ILL-FORMED TERM IS ABSENT, NEVER FATAL. The signed line renders a negative height exactly as it
  // renders no height at all (`notBefore=0`), so if the law branched on the raw field a relay could append
  // one to an honest act and kill it. It is read as absent instead — inert. A term that DOES change the
  // line (a fraction, an impossible height, a negative star) simply fails its signature: the law never
  // built those bytes. Both doors shut, and the citizen's own typo is caught loudly at the public door.
  push(listEv(L, A, 'kray', '', 10n, 0n, { notBefore: -1 }))
  ok(L.packets.get('kray', '', A.addr)?.notBefore === undefined, '5 · a negative height is INERT — the offer waits for nothing, and nothing was killed')
  attack(() => listEv(L, A, 'kray', '', 10n, 0n, { notBefore: 1.5 }), /signature|verify|mirror/i, '5 · a fractional height is not a height — the law never signed it')
  attack(() => listEv(L, A, 'kray', '', 10n, 0n, { notBefore: 21_000_001 }), /signature|verify|mirror/i, '5 · nor a height beyond the last block Bitcoin will ever have')
  attack(() => listEv(L, A, 'kray', '', 10n, 0n, { gate: -1n }), /signature|verify|mirror/i, '5 · nor a negative key star')
  push(delistEv(L, A, 'kray', ''))

  // ── 6 · THE LANES DO NOT LEAK ──────────────────────────────────────────────────────────────────
  console.log('\n─ 6 · the lanes do not leak ─')
  push(listEv(L, A, 'luz', '0', 1000n, 5n))
  push(listEv(L, A, 'rune', RUNE, 1000n, 5n))
  ok(!!L.packets.get('luz', '0', A.addr) && !!L.packets.get('rune', RUNE, A.addr) && !L.packets.get('kray', '', A.addr),
    '6 · one seller holds three independent offers, one per lane and asset')
  attack(() => takeEv(L, B, A.addr, 'luz', '0', 1000n, 5n, { sign: { lane: 'rune', asset: RUNE } }), /signature|verify|mirror/i, '6 · a take signed for the rune lane cannot lift the Luz offer')
  attack(() => takeEv(L, B, A.addr, 'luz', '1', 1000n, 5n), /not listed/, '6 · the Luz of another star is another packet entirely')
  {
    const luzA = L.cuts.of('0', A.addr), runeA = L.runes.balanceOf(runeId, A.addr)
    push(takeEv(L, B, A.addr, 'luz', '0', 1000n, 5n))
    ok(L.cuts.of('0', A.addr) === luzA - 1000n && L.runes.balanceOf(runeId, A.addr) === runeA, '6 · taking the Luz packet left the rune packet untouched')
    ok(!!L.packets.get('rune', RUNE, A.addr) && L.cuts.conserves(), '6 · and the rune offer still stands, the Luz book still conserves')
    push(takeEv(L, C, A.addr, 'rune', RUNE, 1000n, 5n))
    ok(L.runes.balanceOf(runeId, C.addr) === 1000n && L.runes.solvent(), '6 · the rune packet moved to its own taker, and the book is solvent')
  }

  // ── 7 · THE SWARM — 3 seeds × 360 mixed acts across all three lanes ────────────────────────────
  console.log('\n─ 7 · the swarm: 3 seeds × 360 mixed acts, three lanes ─')
  for (const seedN of [17, 41, 97]) {
    const S = new KrayLedger(undefined, NET)
    const sJournal: KrayEvent[] = []
    let sSeq = 500_000 + seedN * 1_000
    const crowd = ['a', 'b', 'c', 'd', 'e'].map(t => wallet(`swarm-${seedN}-${t}`))
    const apply = (e: KrayEvent): boolean => {
      const root = S.cascadeRoot()
      const before = S.appliedSeq
      try {
        S.applyLive(e)
        if (S.appliedSeq === before) { ok(false, `seed ${seedN}: a ${e.kind} at seq ${e.seq} was silently skipped`); return false }
        sJournal.push(e); return true
      }
      catch { if (S.cascadeRoot() !== root) ok(false, `seed ${seedN}: a REFUSED act moved the root`); return false }
    }
    const donate = (to: string, amt: string) => { const tag = `s${seedN}-${++sSeq}`; return apply({ seq: S.appliedSeq + 1, kind: 'donate', hash: tag, at: sSeq, to, amount: amt, outpoint: createHash('sha256').update(tag).digest('hex') + ':0' } as unknown as KrayEvent) }
    for (const w of crowd) donate(w.addr, '3000')
    const host = crowd[0]!
    apply({ seq: S.appliedSeq + 1, kind: 'name', hash: `n${seedN}-${++sSeq}`, at: sSeq, from: host.addr, name: `swarm${seedN}`, nonce: S.nonceOf(host.addr), publicKey: host.pk, signature: sign(nameMessageV2(NET, host.addr, S.nonceOf(host.addr), `swarm${seedN}`), host), scheme: 'kraywallet' } as unknown as KrayEvent)
    apply({ seq: S.appliedSeq + 1, kind: 'contract', hash: `c${seedN}-${++sSeq}`, at: sSeq, from: host.addr, code: paper, star: '0', nonce: S.nonceOf(host.addr), publicKey: host.pk, signature: sign(contractMessageV2(NET, host.addr, sha256hex(canonicalCode(paper)), 0n), host), scheme: 'kraywallet' } as unknown as KrayEvent)
    const seedRunes = new Map<string, bigint>()
    for (const w of crowd) { S.runes.deposit(runeId, createHash('sha256').update(`r${seedN}-${w.addr}`).digest('hex') + ':0', 5000n, w.addr, { pool: true }); seedRunes.set(w.addr, 5000n) }

    let state = seedN * 7919
    const rnd = (n: number): number => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state % n }
    const lanes: PacketLane[] = ['kray', 'luz', 'rune']
    const assetOf = (lane: PacketLane) => lane === 'luz' ? '0' : lane === 'rune' ? RUNE : ''
    const heldOf = (lane: PacketLane, w: W): bigint =>
      lane === 'kray' ? S.balanceOf(w.addr) : lane === 'luz' ? S.cuts.of('0', w.addr) : S.runes.balanceOf(runeId, w.addr)
    let taken = 0, listed = 0, refused = 0
    for (let step = 0; step < 360; step++) {
      const w = crowd[rnd(crowd.length)]!, other = crowd[rnd(crowd.length)]!
      const lane = lanes[rnd(lanes.length)]!, asset = assetOf(lane)
      const move = rnd(10) < 4 ? 0 : rnd(10) < 7 ? 2 : rnd(2) === 0 ? 1 : 3
      if (move === 0) {
        const held = heldOf(lane, w)
        if (held <= 2n) { refused++; continue }
        const amount = 1n + BigInt(rnd(Number(held > 400n ? 400n : held - 1n)))
        const terms: ListingTerms = rnd(4) === 0 && other.addr !== w.addr ? { to: other.addr } : {}
        if (apply(listEv(S, w, lane, asset, amount, rnd(4) === 0 ? BigInt(1 + rnd(9)) : 0n, terms))) listed++; else refused++
      } else if (move === 1) {
        if (!apply(delistEv(S, w, lane, asset))) refused++
      } else if (move === 2) {
        // Bias the storm at the path that matters: take a LIVE offer. Most of the time the named hand comes
        // for a named offer; the rest of the time a stranger does, and must be refused with nothing moved.
        const rows = S.packets.all()
        if (!rows.length) { refused++; continue }
        const row = rows[rnd(rows.length)]!
        const namedHand = row.to ? crowd.find(c => c.addr === row.to) : undefined
        const hand = namedHand && rnd(4) !== 0 ? namedHand : (w.addr === row.seller ? other : w)
        if (hand.addr === row.seller) { refused++; continue }
        const rLane = row.lane as PacketLane, rAsset = row.asset
        const seller = crowd.find(c => c.addr === row.seller)!
        const listing = S.packets.get(rLane, rAsset, row.seller)!
        const laneOf = rLane, sellerHeld = heldOf(laneOf, seller), takerHeld = heldOf(laneOf, hand), takerKray = S.balanceOf(hand.addr)
        const w2 = hand, lane2 = laneOf, asset2 = rAsset
        if (apply(takeEv(S, w2, seller.addr, lane2, asset2, listing.amount, listing.price))) {
          taken++
          ok(heldOf(lane2, seller) === sellerHeld - listing.amount + (lane2 === 'kray' ? listing.price : 0n), `seed ${seedN}: the seller parted with exactly the packet and was paid in the same step`)
          if (lane2 !== 'kray') ok(heldOf(lane2, w2) === takerHeld + listing.amount, `seed ${seedN}: the taker received exactly the packet`)
          else ok(S.balanceOf(w2.addr) === takerKray - listing.price - 1n + listing.amount, `seed ${seedN}: the ₭ taker paid price + gas and got the packet`)
          if (listing.to) ok(listing.to === w2.addr, `seed ${seedN}: only the named hand took a named offer`)
          ok(!S.packets.get(lane2, asset2, seller.addr), `seed ${seedN}: the offer was consumed, once`)
        } else refused++
      } else {
        const amt = 1n + BigInt(rnd(40))
        if (S.balanceOf(w.addr) > amt + 1n && other.addr !== w.addr) {
          const nonce = S.nonceOf(w.addr)
          apply({ seq: S.appliedSeq + 1, kind: 'transfer', hash: `t${seedN}-${++sSeq}`, at: sSeq, from: w.addr, to: other.addr, amount: amt.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(transferMessage(NET, w.addr, other.addr, amt, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent)
        } else refused++
      }
      if (!S.conserves() || !S.cuts.conserves() || !S.runes.solvent()) { ok(false, `seed ${seedN} step ${step}: a book broke`); break }
    }
    ok(S.conserves() && S.cuts.conserves() && S.runes.solvent(), `seed ${seedN}: ${listed} listed, ${taken} taken, ${refused} refused — every book holds`)
    ok(taken > 0 && listed > 0, `seed ${seedN}: the storm really exercised the market (${taken} takes)`)
    const twin = new KrayLedger(undefined, NET)
    for (const w of crowd) twin.runes.deposit(runeId, createHash('sha256').update(`r${seedN}-${w.addr}`).digest('hex') + ':0', 5000n, w.addr, { pool: true })
    for (const e of sJournal) twin.applyLive(e)
    ok(twin.cascadeRoot() === S.cascadeRoot(), `seed ${seedN}: a replay twin reaches the SAME cascade root`)
    ok(twin.packets.commitment() === S.packets.commitment(), `seed ${seedN}: and the identical packet book`)
    ok(JSON.stringify(twin.packets.all()) === JSON.stringify(S.packets.all()), `seed ${seedN}: line for line, terms and all`)
  }

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the packet market held every field, every lane and every hand. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
