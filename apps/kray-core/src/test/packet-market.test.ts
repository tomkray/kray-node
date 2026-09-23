/**
 * THE PACKET MARKET — the star market's law, applied to ₭, to the Luz of a star, and to a rune of the L2.
 *
 *   node src/test/packet-market.test.ts
 *
 * The Creator, 2026-09-19: *"é só fazer o market também aceitar vender pacotes de tokens… todas as vezes que
 * escolher listar alguma coisa por 0 valor seria o escrow ou drop."* So this proves the same four things the
 * star market proves, on three books at once: list / delist / atomic take; a price of ZERO is the drop (the
 * taker pays the eternal gas and no price); the terms (a name, a star that opens it, a Bitcoin height) are
 * signed into the line and re-proven at the instant of the take; and the book folds into the cascade root BY
 * PRESENCE, so every history anchored before this law opens byte-identically (A3).
 *
 * Every refusal must leave the books, the balances and the cascade root exactly as they were.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, nameMessageV2, contractMessageV2, inscribeMessageV2, transferMessage } from '../protocol/scheme.ts'
import { packetListMessage, packetDelistMessage, packetTakeMessage, packetTermsHash, PACKET_MARKET_SEQ, type PacketLane } from '../protocol/packet-market.ts'
import { signedMessageOfEvent } from '../protocol/signed-message.ts'
import type { ListingTerms } from '../protocol/star-market.ts'
import { canonicalCode } from '../protocol/contract.ts'
import { compileCut } from '../protocol/star-forms.ts'
import { sha256hex, TREASURY, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const halts = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const s = (e as Error).message; ok(re.test(s), m + (re.test(s) ? '' : ' — wrong error: ' + s)) }
}

interface W { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`packet-market|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)

const RUNE = '840000:7'
const runeId = { block: 840000n, tx: 7n }

let seq = 0
const journal: KrayEvent[] = []
function push(L: KrayLedger, e: KrayEvent): void { L.applyLive(e); journal.push(e) }
const mint = (L: KrayLedger, to: string, amt: string) =>
  push(L, { seq: ++seq, kind: 'donate', hash: 'h' + seq, at: seq, to, amount: amt, outpoint: createHash('sha256').update('o' + seq).digest('hex') + ':0' } as unknown as KrayEvent)

/** The asset fields a lane carries on the wire — `star` for Luz, `runeId` for a rune, neither for ₭. */
function assetFields(lane: PacketLane, asset: string): Record<string, unknown> {
  if (lane === 'luz') return { star: asset }
  if (lane === 'rune') return { runeId: asset }
  return {}
}
const listEv = (L: KrayLedger, w: W, lane: PacketLane, asset: string, amount: bigint, price: bigint, terms: ListingTerms = {}, twist?: { sign?: Partial<{ lane: PacketLane; asset: string; amount: bigint; price: bigint; terms: ListingTerms }>; by?: W }): KrayEvent => {
  const nonce = L.nonceOf(w.addr)
  const s = twist?.sign ?? {}
  const msg = packetListMessage(NET, w.addr, s.lane ?? lane, s.asset ?? asset, s.amount ?? amount, s.price ?? price, s.terms ?? terms, nonce)
  const signer = twist?.by ?? w
  const e: Record<string, unknown> = {
    seq: ++seq, kind: 'packet-list', hash: 'h' + seq, at: seq, from: w.addr, lane, ...assetFields(lane, asset),
    amount: amount.toString(), price: price.toString(), fee: '1', nonce, publicKey: signer.pk, signature: sign(msg, signer), scheme: 'kraywallet',
  }
  if (terms.to) e.to = terms.to
  if (terms.gate !== undefined) e.gateStar = terms.gate.toString()
  if (terms.notBefore !== undefined) e.notBefore = terms.notBefore
  return e as unknown as KrayEvent
}
const delistEv = (L: KrayLedger, w: W, lane: PacketLane, asset: string): KrayEvent => {
  const nonce = L.nonceOf(w.addr)
  return {
    seq: ++seq, kind: 'packet-delist', hash: 'h' + seq, at: seq, from: w.addr, lane, ...assetFields(lane, asset),
    fee: '1', nonce, publicKey: w.pk, signature: sign(packetDelistMessage(NET, w.addr, lane, asset, nonce), w), scheme: 'kraywallet',
  } as unknown as KrayEvent
}
/** What the book says this offer carries right now — the declaration an honest taker makes. */
const termsSeen = (L: KrayLedger, lane: PacketLane, asset: string, seller: string): string => packetTermsHash(L.packets.get(lane, asset, seller) ?? undefined)
const takeEv = (L: KrayLedger, taker: W, seller: string, lane: PacketLane, asset: string, amount: bigint, price: bigint, twist?: { sign?: Partial<{ seller: string; lane: PacketLane; asset: string; amount: bigint; price: bigint; terms: string }>; by?: W; terms?: string }): KrayEvent => {
  const nonce = L.nonceOf(taker.addr)
  const s = twist?.sign ?? {}
  const signer = twist?.by ?? taker
  const declared = twist?.terms ?? termsSeen(L, lane, asset, seller)
  const msg = packetTakeMessage(NET, taker.addr, s.seller ?? seller, s.lane ?? lane, s.asset ?? asset, s.amount ?? amount, s.price ?? price, s.terms ?? declared, nonce)
  return {
    seq: ++seq, kind: 'packet-take', hash: 'h' + seq, at: seq, from: taker.addr, to: seller, lane, ...assetFields(lane, asset),
    amount: amount.toString(), price: price.toString(), fee: '1', nonce, publicKey: signer.pk, signature: sign(msg, signer), scheme: 'kraywallet',
    ...(declared ? { termsHash: declared } : {}),
  } as unknown as KrayEvent
}

function main() {
  console.log('\n╔═ THE PACKET MARKET — ₭ · Luz · runes, one law, proven in the bytes ══╗\n')
  const A = wallet('alice'), B = wallet('bob'), C = wallet('carol')

  // ── 0 · an empty book folds NOWHERE (A3: every root anchored before this law is byte-identical) ──
  const E = new KrayLedger(undefined, NET)
  ok(E.packets.empty() && E.cascadeParts().packetCommitment === undefined, '0 · an empty packet book folds nowhere — the field is absent (A3)')
  // Ratified 2026-09-21: signet opens at 231 (its tip 230, plus one — the house's own rite). Main stays
  // shut until signet has carried a harvest end to end. The shape is what matters here, not the number:
  // regtest born open, signet at a REAL seq past its tip, main not yet law. The catalog pins the values.
  ok(PACKET_MARKET_SEQ.regtest === 0 && PACKET_MARKET_SEQ.signet === 231 && PACKET_MARKET_SEQ.main === 82,
    '0 · the pin is open on regtest, ratified on signet at 231 and on MAIN at 82 — each at its own tip\'s next act, so every activation is one auditable instant (A3)')

  const L = new KrayLedger(undefined, NET)
  mint(L, A.addr, '5000'); mint(L, B.addr, '400'); mint(L, C.addr, '400')

  // Luz: A seals a cut paper on its own star, and holds every ✧ of it.
  push(L, { seq: ++seq, kind: 'name', hash: 'h' + seq, at: seq, from: A.addr, name: 'packetface', nonce: L.nonceOf(A.addr), publicKey: A.pk, signature: sign(nameMessageV2(NET, A.addr, L.nonceOf(A.addr), 'packetface'), A), scheme: 'kraywallet' } as unknown as KrayEvent)
  const paper = compileCut({ supply: '100000' })
  const paperHash = sha256hex(canonicalCode(paper))
  push(L, { seq: ++seq, kind: 'contract', hash: 'h' + seq, at: seq, from: A.addr, code: paper, star: '0', nonce: L.nonceOf(A.addr), publicKey: A.pk, signature: sign(contractMessageV2(NET, A.addr, paperHash, 0n), A), scheme: 'kraywallet' } as unknown as KrayEvent)
  ok(L.cuts.of('0', A.addr) === 100000n, 'fixture · Alice holds 100,000 ✧ of star 0')

  // Runes: a pot-backed credit, the only kind a send may ever hand out.
  L.runes.deposit(runeId, 'aa'.repeat(32) + ':0', 9000n, A.addr, { pool: true })
  ok(L.runes.balanceOf(runeId, A.addr) === 9000n && L.runes.solvent(), 'fixture · Alice holds 9,000 runes, pot-backed')

  const tre = () => L.balanceOf(TREASURY)
  const rootBefore = L.cascadeRoot()

  // ── 1 · LIST a ₭ packet — a signed offer that moves NOTHING and holds NOTHING ──
  const a0 = L.balanceOf(A.addr), t0 = tre()
  push(L, listEv(L, A, 'kray', '', 1000n, 250n))
  const live = L.packets.get('kray', '', A.addr)
  ok(live?.amount === 1000n && live?.price === 250n && live?.seller === A.addr, '1 · the ₭ packet is listed (1,000 ₭ at 250 ₭)')
  ok(L.balanceOf(A.addr) === a0 - 1n && tre() === t0 + 1n, '1 · the eternal 1-₭ fee went to the validators, and nothing else moved')
  ok(L.cascadeRoot() !== rootBefore && !!L.cascadeParts().packetCommitment, '1 · the book now folds into the cascade root')
  ok(L.conserves(), '1 · Σ conserved — the market never holds value')

  // ── 2 · THE ATOMIC TAKE — both legs in one step ──
  const aBefore = L.balanceOf(A.addr), bBefore = L.balanceOf(B.addr), tBefore = tre()
  push(L, takeEv(L, B, A.addr, 'kray', '', 1000n, 250n))
  ok(L.balanceOf(B.addr) === bBefore - 250n - 1n + 1000n, '2 · the taker paid price + gas and received the whole packet')
  ok(L.balanceOf(A.addr) === aBefore + 250n - 1000n, '2 · the seller was paid and parted with the packet, in the same step')
  ok(tre() === tBefore + 1n && L.conserves(), '2 · the validators got exactly one ₭, and Σ is conserved')
  ok(!L.packets.get('kray', '', A.addr), '2 · the offer was consumed, once')
  halts(() => L.applyLive(takeEv(L, C, A.addr, 'kray', '', 1000n, 250n)), /not listed/, '2 · a second taker finds nothing — no double take')

  // ── 3 · THE DROP — a listing at price ZERO: the taker pays the gas and no price ──
  const cBefore = L.balanceOf(C.addr), aDrop = L.balanceOf(A.addr)
  push(L, listEv(L, A, 'kray', '', 100n, 0n))
  push(L, takeEv(L, C, A.addr, 'kray', '', 100n, 0n))
  ok(L.balanceOf(C.addr) === cBefore - 1n + 100n, '3 · THE DROP — the taker paid 1 ₭ of gas and no price, and carried the packet away')
  ok(L.balanceOf(A.addr) === aDrop - 1n - 100n && L.conserves(), '3 · the giver paid their own 1 ₭ to leave it, and gave the packet away')

  // ── 4 · DELIST — withdraw your own offer ──
  push(L, listEv(L, A, 'kray', '', 50n, 5n))
  const aDelist = L.balanceOf(A.addr)
  push(L, delistEv(L, A, 'kray', ''))
  ok(!L.packets.get('kray', '', A.addr) && L.balanceOf(A.addr) === aDelist - 1n, '4 · the offer is withdrawn for the eternal fee, and nothing else moved')
  halts(() => L.applyLive(delistEv(L, A, 'kray', '')), /nothing to cancel/, '4 · withdrawing what is not there is refused')
  halts(() => L.applyLive(delistEv(L, B, 'kray', '')), /nothing to cancel/, '4 · a stranger cannot withdraw another citizen\'s offer')

  // ── 5 · A STALE OFFER — the seller spent it while the offer stood ──
  push(L, listEv(L, A, 'kray', '', 3000n, 1n))
  const spend = (amount: bigint) => {
    const nonce = L.nonceOf(A.addr)
    push(L, { seq: ++seq, kind: 'transfer', hash: 'h' + seq, at: seq, from: A.addr, to: C.addr, amount: amount.toString(), fee: '1', nonce, publicKey: A.pk, signature: sign(transferMessage(NET, A.addr, C.addr, amount, nonce), A), scheme: 'kraywallet' } as unknown as KrayEvent)
  }
  spend(L.balanceOf(A.addr) - 10n)
  const frozenRoot = L.cascadeRoot(), frozenB = L.balanceOf(B.addr)
  halts(() => L.applyLive(takeEv(L, B, A.addr, 'kray', '', 3000n, 1n)), /no longer holds|stale/, '5 · a stale offer is refused — the seller no longer holds the packet')
  ok(L.cascadeRoot() === frozenRoot && L.balanceOf(B.addr) === frozenB && L.conserves(), '5 · and the refusal moved nothing at all — not even a fee')
  push(L, delistEv(L, A, 'kray', ''))

  // ── 6 · THE LUZ LANE — ✧ of one star, sold as a whole packet ──
  mint(L, A.addr, '500')
  push(L, listEv(L, A, 'luz', '0', 25000n, 40n))
  const luzA = L.cuts.of('0', A.addr), luzB = L.cuts.of('0', B.addr)
  push(L, takeEv(L, B, A.addr, 'luz', '0', 25000n, 40n))
  ok(L.cuts.of('0', A.addr) === luzA - 25000n && L.cuts.of('0', B.addr) === luzB + 25000n, '6 · the Luz packet moved, whole, to the taker')
  ok(L.cuts.conserves() && L.conserves(), '6 · the Luz book and Σ both conserve')
  halts(() => L.applyLive(listEv(L, C, 'luz', '0', 1n, 1n)), /do not hold/, '6 · offering Luz you have not got is refused')
  halts(() => L.applyLive(listEv(L, A, 'luz', '007', 1n, 1n)), /canonical star number/, '6 · a twin-fork star key is refused (007 is not 7)')

  // ── 7 · THE RUNE LANE — and THE BACKING GATE it must never bypass ──
  push(L, listEv(L, A, 'rune', RUNE, 4000n, 60n))
  const runeA = L.runes.balanceOf(runeId, A.addr), runeC = L.runes.balanceOf(runeId, C.addr)
  push(L, takeEv(L, C, A.addr, 'rune', RUNE, 4000n, 60n))
  ok(L.runes.balanceOf(runeId, A.addr) === runeA - 4000n && L.runes.balanceOf(runeId, C.addr) === runeC + 4000n, '7 · the rune packet moved, whole, to the taker')
  ok(L.runes.solvent() && L.conserves(), '7 · the rune book stays solvent and Σ conserves')
  halts(() => L.applyLive(listEv(L, A, 'rune', '0840000:7', 1n, 1n)), /canonical|rune/i, '7 · a twin-fork rune key is refused (0840000:7 is not 840000:7)')
  for (const gateFlag of [true, false]) {
    // BOTH WAYS. The backing gate is a node-local flag, so a consensus rule must not read it: a packet of
    // credits backed by the seller's own vault is unsellable on EVERY node, however that node is configured.
    const G = new KrayLedger(undefined, NET, undefined, gateFlag)
    let s2 = 0
    const ev = (e: Record<string, unknown>) => ({ seq: ++s2, hash: 'g' + s2, at: s2, ...e } as unknown as KrayEvent)
    G.applyLive(ev({ kind: 'donate', to: A.addr, amount: '100', outpoint: 'bb'.repeat(32) + ':0' }))
    G.runes.deposit(runeId, 'cc'.repeat(32) + ':0', 500n, A.addr)          // PERSONAL vault — not pot-backed
    const nonce = G.nonceOf(A.addr)
    halts(() => G.applyLive(ev({ kind: 'packet-list', from: A.addr, lane: 'rune', runeId: RUNE, amount: '500', price: '1', fee: '1', nonce, publicKey: A.pk, signature: sign(packetListMessage(NET, A.addr, 'rune', RUNE, 500n, 1n, {}, nonce), A), scheme: 'kraywallet' })),
      /do not hold/, `7 · THE BACKING GATE holds with the node flag ${gateFlag}: a credit backed by the seller's own vault cannot be listed`)
  }

  {
    // PORTA 2 — a rune packet is a rune act. On a network whose rune book is still shut, the market is not
    // a side door into it: the act is refused, exactly as `rune-send` is.
    const shut = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, Number.MAX_SAFE_INTEGER)
    let s4 = 0
    shut.applyLive({ seq: ++s4, kind: 'donate', hash: 'r1', at: s4, to: A.addr, amount: '100', outpoint: 'ee'.repeat(32) + ':0' } as unknown as KrayEvent)
    shut.runes.deposit(runeId, 'ff'.repeat(32) + ':0', 500n, A.addr, { pool: true })
    const nonce = shut.nonceOf(A.addr)
    halts(() => shut.applyLive({ seq: ++s4, kind: 'packet-list', hash: 'r2', at: s4, from: A.addr, lane: 'rune', runeId: RUNE, amount: '100', price: '1', fee: '1', nonce, publicKey: A.pk, signature: sign(packetListMessage(NET, A.addr, 'rune', RUNE, 100n, 1n, {}, nonce), A), scheme: 'kraywallet' } as unknown as KrayEvent),
      /rune book is not open/, '7 · PORTA 2 holds: a rune packet is refused while that network\'s rune book is shut')
    ok(shut.packets.empty(), '7 · and nothing was listed')
  }

  // ── 8 · THE TERMS — a name, a star that opens it, a Bitcoin height ──
  const heir = wallet('heir')
  mint(L, heir.addr, '100'); mint(L, A.addr, '2000')
  push(L, listEv(L, A, 'kray', '', 500n, 0n, { to: heir.addr }))
  halts(() => L.applyLive(takeEv(L, B, A.addr, 'kray', '', 500n, 0n)), /left for another address/, '8 · a named drop refuses every other hand')
  const heir0 = L.balanceOf(heir.addr)
  push(L, takeEv(L, heir, A.addr, 'kray', '', 500n, 0n))
  ok(L.balanceOf(heir.addr) === heir0 - 1n + 500n, '8 · the named heir takes it for the gas alone (the testament)')

  const keyStar = (() => {
    const before = L.stars.createdSeq, nonce = L.nonceOf(B.addr)
    push(L, { seq: ++seq, kind: 'inscribe', hash: 'h' + seq, at: seq, from: B.addr, contentHash: 'key', contentType: 'text/plain', size: 3, nonce, publicKey: B.pk, signature: sign(inscribeMessageV2(NET, B.addr, 'key', 'text/plain', 3, undefined, nonce), B), scheme: 'kraywallet' } as unknown as KrayEvent)
    return BigInt(before)
  })()
  push(L, listEv(L, A, 'kray', '', 300n, 0n, { gate: keyStar }))
  halts(() => L.applyLive(takeEv(L, C, A.addr, 'kray', '', 300n, 0n)), /opens only for whoever holds star/, '8 · a key-star drop refuses whoever does not hold the key')
  const b8 = L.balanceOf(B.addr)
  push(L, takeEv(L, B, A.addr, 'kray', '', 300n, 0n))
  ok(L.balanceOf(B.addr) === b8 - 1n + 300n, '8 · whoever HOLDS the key star takes it — the right travels with the star')

  push(L, listEv(L, A, 'kray', '', 200n, 0n, { notBefore: 900_000 }))
  halts(() => L.applyLive(takeEv(L, C, A.addr, 'kray', '', 200n, 0n)), /opens at Bitcoin height/, '8 · a bequest waits for the chain\'s own clock, not a wall clock')
  {
    // AND IT OPENS. The clock is the journal's own sealed Bitcoin height — on EVERY network, not only where
    // the inclusion-window regime is active (that one never moves on regtest, which would have left every
    // bequest sealed shut forever on the one net where this law is switched on).
    const seal = (h: number) => push(L, { seq: L.appliedSeq + 1, kind: 'seal', hash: 'seal' + h, at: 0, l1Txid: h.toString(16).padStart(64, '0'), l1Height: h, l1Root: L.cascadeRoot(), l1BlockNumber: 0 } as unknown as KrayEvent)
    seal(899_999)
    ok(L.sealedHeight() === 899_999, '8 · the chain\'s clock ticks with the seals, on this network too')
    halts(() => L.applyLive(takeEv(L, C, A.addr, 'kray', '', 200n, 0n)), /opens at Bitcoin height/, '8 · one block short, and the bequest is still shut')
    seal(900_000)
    const c8 = L.balanceOf(C.addr)
    push(L, takeEv(L, C, A.addr, 'kray', '', 200n, 0n))
    ok(L.balanceOf(C.addr) === c8 - 1n + 200n && L.conserves(), '8 · at the height it named, the bequest OPENS and the heir takes it')
  }
  push(L, listEv(L, A, 'kray', '', 100n, 0n))
  push(L, delistEv(L, A, 'kray', ''))
  // THE RELAY'S LAST DOOR, SHUT. An ill-formed term is ABSENT to the law, so the line it builds is the
  // termless one — a relay that appends `notBefore: -1` (or a height Bitcoin can never reach) to somebody's
  // honest act changes nothing and kills nothing, and an act that SIGNED such a term fails its signature.
  halts(() => L.applyLive(listEv(L, A, 'kray', '', 10n, 0n, { notBefore: 21_000_001 })), /signature|verify|mirror/i, '8 · a height beyond the last block Bitcoin will ever have is not a height')
  {
    const honest = listEv(L, A, 'kray', '', 10n, 0n)                 // signed with NO terms at all
    ;(honest as unknown as Record<string, unknown>).notBefore = -1   // the relay appends an ill-formed height
    push(L, honest)
    ok(L.packets.get('kray', '', A.addr)?.notBefore === undefined, '8 · a relay cannot kill an honest act by appending an ill-formed height — it is inert')
    push(L, delistEv(L, A, 'kray', ''))
  }
  halts(() => L.applyLive(listEv(L, A, 'kray', '', 10n, 0n, { to: A.addr })), /nobody's offer/, '8 · an offer named for yourself is nobody\'s offer')

  // ── 9 · THE SIGNED BYTES — a relay may not add, strip or rewrite one field ──
  push(L, listEv(L, A, 'kray', '', 700n, 70n))
  halts(() => L.applyLive(takeEv(L, B, A.addr, 'kray', '', 700n, 70n, { sign: { price: 1n } })), /signature|verify|mirror/i, '9 · a take signed for a cheaper price is refused')
  halts(() => L.applyLive(takeEv(L, B, A.addr, 'kray', '', 700n, 7n)), /≠ the signed take price|price/i, '9 · a take that names a different price than the offer is refused')
  halts(() => L.applyLive(takeEv(L, B, A.addr, 'kray', '', 1n, 70n)), /≠ the signed take|whole or nothing/i, '9 · a partial take is refused — a packet is whole or nothing')
  halts(() => L.applyLive(takeEv(L, B, A.addr, 'kray', '', 700n, 70n, { by: C })), /signature|verify|key/i, '9 · a forged signature is refused')
  halts(() => L.applyLive(listEv(L, A, 'kray', '', 700n, 70n, { to: B.addr }, { sign: { terms: {} } })), /signature|verify|mirror/i, '9 · a relay that ADDS a name to a signed offer is refused')
  {
    const named = listEv(L, A, 'kray', '', 700n, 70n, { to: B.addr })
    delete (named as unknown as Record<string, unknown>).to                 // the relay STRIPS the name it cannot forge
    halts(() => L.applyLive(named), /signature|verify|mirror/i, '9 · a relay that STRIPS the name from a signed offer is refused')
  }
  {
    const wrongNet = takeEv(L, B, A.addr, 'kray', '', 700n, 70n)
    const nonce = L.nonceOf(B.addr)
    ;(wrongNet as unknown as Record<string, unknown>).signature = sign(packetTakeMessage('main', B.addr, A.addr, 'kray', '', 700n, 70n, nonce), B)
    halts(() => L.applyLive(wrongNet), /signature|verify|mirror/i, '9 · a take signed for another network is refused here (the bytes name their net)')
  }
  halts(() => L.applyLive({ ...takeEv(L, B, A.addr, 'kray', '', 700n, 70n), lane: 'gold' } as unknown as KrayEvent), /unknown packet lane|lane/i, '9 · a lane this market does not know is refused')
  push(L, takeEv(L, B, A.addr, 'kray', '', 700n, 70n))

  // ── 10 · THE MIRROR — the reducer's line and the signed-bytes mirror are the same bytes, per kind ──
  for (const kind of ['packet-list', 'packet-delist', 'packet-take'] as const) {
    const sample = journal.filter(e => e.kind === kind).at(-1)!
    ok(typeof signedMessageOfEvent(sample, NET) === 'string' && signedMessageOfEvent(sample, NET)!.startsWith(`kray-core.${kind}.v1|net=${NET}|`),
      `10 · the mirror builds ${kind}'s line from the act alone (the referee re-proves it on every apply)`)
  }

  // ── 11 · BELOW THE PIN — a network whose fleet has not adopted the law refuses every packet act ──
  {
    const O = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, Number.MAX_SAFE_INTEGER)
    let s3 = 0
    O.applyLive({ seq: ++s3, kind: 'donate', hash: 'p1', at: s3, to: A.addr, amount: '100', outpoint: 'dd'.repeat(32) + ':0' } as unknown as KrayEvent)
    const nonce = O.nonceOf(A.addr), before = O.cascadeRoot()
    halts(() => O.applyLive({ seq: ++s3, kind: 'packet-list', hash: 'p2', at: s3, from: A.addr, lane: 'kray', amount: '10', price: '1', fee: '1', nonce, publicKey: A.pk, signature: sign(packetListMessage(NET, A.addr, 'kray', '', 10n, 1n, {}, nonce), A), scheme: 'kraywallet' } as unknown as KrayEvent),
      /not the law on this network yet/, '11 · below the pin the packet market does not exist — the act is refused')
    ok(O.cascadeRoot() === before && O.packets.empty() && O.conserves(), '11 · and nothing moved, so no root grows and no era forks (A3)')
  }

  // ── 12 · THE REPLAY TWIN — a stranger re-derives the identical root from the journal alone ──
  {
    const R = new KrayLedger(undefined, NET)
    // The bridge credit is a FIXTURE, not a journal act (a real one rides `rune-deposit` with its SPV proof),
    // so the stranger is handed the same opening book — everything after it is re-derived from the journal.
    R.runes.deposit(runeId, 'aa'.repeat(32) + ':0', 9000n, A.addr, { pool: true })
    for (const e of journal) R.applyLive(e)
    ok(R.cascadeRoot() === L.cascadeRoot(), '12 · a stranger replays the journal and reaches the SAME cascade root')
    ok(R.packets.commitment() === L.packets.commitment(), '12 · and the identical packet book, line for line')
    ok(R.conserves() && R.cuts.conserves() && R.runes.solvent(), '12 · conserved, solvent, and byte-exact on the rebuilt node')
  }

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — ₭, Luz and runes trade by the same law the stars do. ⛓₭\n`)
  if (fail) process.exit(1)
}
main()
