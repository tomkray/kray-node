/**
 * THE PACKET MARKET, AGAINST AN INDEPENDENT MODEL — and a cold reboot from disk.
 *
 *   node src/test/packet-market-model.test.ts
 *
 * The other suites attack the reducer. This one DISAGREES with it: a second implementation of the market's
 * rules, written from the law (docs/DROP-AND-PACKET-MARKET.md) and not from `ledger.ts`, decides for every
 * generated act whether it should be accepted and what every book should hold afterwards. Then the reducer
 * runs the same act, and the two are compared — acceptance AND state, after every single act.
 *
 * A divergence is a finding either way round: if the model accepts what the law refuses, the law has a rule
 * the law was never told to have; if the law accepts what the model refuses, the model does. Both are worth
 * knowing, and neither can hide, because the comparison happens thousands of times per seed.
 *
 * Finally: a cold reboot through the REAL store (journal on disk, a fresh process-worth of state) must
 * re-derive the identical cascade root with live listings in the book.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { LedgerStore } from '../protocol/store.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, nameMessageV2, contractMessageV2, inscribeMessageV2 } from '../protocol/scheme.ts'
import { PacketMarket, packetListMessage, packetDelistMessage, packetTakeMessage, packetTermsHash, type PacketLane } from '../protocol/packet-market.ts'
import { canonicalCode } from '../protocol/contract.ts'
import { compileCut } from '../protocol/star-forms.ts'
import { sha256hex, TREASURY, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++ } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const say = (m: string) => { pass++; console.log('  ✓ ' + m) }
const shows = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

interface W { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`packet-model|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)
const RUNE = '840000:7'
const runeId = { block: 840000n, tx: 7n }
const LUZ_STAR = '0'

/** ── THE MODEL ────────────────────────────────────────────────────────────────────────────────────────
 *  A second reading of the same law, in plain arithmetic. It knows nothing about the reducer's code. */
interface Offer { seller: string; lane: PacketLane; asset: string; amount: bigint; price: bigint; to?: string; gate?: bigint; notBefore?: number }
class Model {
  readonly kray = new Map<string, bigint>()
  readonly luz = new Map<string, bigint>()
  readonly rune = new Map<string, bigint>()
  readonly offers = new Map<string, Offer>()
  readonly starOwner = new Map<string, string>()
  sealed = 0
  bal(m: Map<string, bigint>, a: string): bigint { return m.get(a) ?? 0n }
  book(lane: PacketLane): Map<string, bigint> { return lane === 'kray' ? this.kray : lane === 'luz' ? this.luz : this.rune }
  held(lane: PacketLane, a: string): bigint { return this.bal(this.book(lane), a) }
  key(lane: PacketLane, asset: string, seller: string): string { return `${lane}|${asset}|${seller}` }
  private pay(a: string, n: bigint): void { this.kray.set(a, this.bal(this.kray, a) + n) }

  /** Returns null when the act is lawful (and applies it), or the reason it is not. */
  list(from: string, lane: PacketLane, asset: string, amount: bigint, price: bigint, terms: { to?: string; gate?: bigint; notBefore?: number }): string | null {
    if (amount <= 0n) return 'amount'
    if (price < 0n) return 'price'
    if (terms.to === from) return 'self-named'
    if (this.bal(this.kray, from) < 1n) return 'fee'
    if (this.held(lane, asset === LUZ_STAR || lane !== 'luz' ? from : from) < amount) return 'holding'
    this.pay(from, -1n); this.pay(TREASURY, 1n)
    const o: Offer = { seller: from, lane, asset, amount, price }
    if (terms.to) o.to = terms.to
    if (terms.gate !== undefined) o.gate = terms.gate
    if (terms.notBefore !== undefined) o.notBefore = terms.notBefore
    this.offers.set(this.key(lane, asset, from), o)
    return null
  }
  delist(from: string, lane: PacketLane, asset: string): string | null {
    if (!this.offers.has(this.key(lane, asset, from))) return 'no offer'
    if (this.bal(this.kray, from) < 1n) return 'fee'
    this.pay(from, -1n); this.pay(TREASURY, 1n)
    this.offers.delete(this.key(lane, asset, from))
    return null
  }
  take(taker: string, seller: string, lane: PacketLane, asset: string, amount: bigint, price: bigint): string | null {
    if (taker === seller) return 'self'
    const o = this.offers.get(this.key(lane, asset, seller))
    if (!o) return 'no offer'
    if (o.amount !== amount) return 'amount'
    if (o.price !== price) return 'price'
    if (o.to && o.to !== taker) return 'named'
    if (o.gate !== undefined && this.starOwner.get(o.gate.toString()) !== taker) return 'gate'
    if (o.notBefore !== undefined && this.sealed < o.notBefore) return 'height'
    if (this.bal(this.kray, taker) < price + 1n) return 'balance'
    if (this.held(lane, seller) < amount) return 'stale'
    const b = this.book(lane)
    b.set(seller, this.bal(b, seller) - amount)
    b.set(taker, this.bal(b, taker) + amount)
    this.pay(taker, -price - 1n); this.pay(seller, price); this.pay(TREASURY, 1n)
    this.offers.delete(this.key(lane, asset, seller))
    return null
  }
  transfer(from: string, to: string, amount: bigint): string | null {
    if (from === to || amount <= 0n) return 'shape'
    if (this.bal(this.kray, from) < amount + 1n) return 'balance'
    this.pay(from, -amount - 1n); this.pay(to, amount); this.pay(TREASURY, 1n)
    return null
  }
}

function main() {
  console.log('\n╔═ THE PACKET MARKET vs AN INDEPENDENT MODEL — and a cold reboot ══╗\n')

  let divergences = 0, acts = 0, applied = 0
  for (const seed of [3, 19, 47, 101, 233]) {
    const L = new KrayLedger(undefined, NET)
    const M = new Model()
    const crowd = ['a', 'b', 'c', 'd'].map(t => wallet(`m-${seed}-${t}`))
    let hashN = 0
    const ev = (o: Record<string, unknown>): KrayEvent => ({ seq: L.appliedSeq + 1, hash: `m${seed}-${++hashN}`, at: hashN, ...o } as unknown as KrayEvent)

    // ── the same opening in both worlds ──
    for (const w of crowd) {
      const e = ev({ kind: 'donate', to: w.addr, amount: '4000', outpoint: createHash('sha256').update(`m${seed}-${w.addr}`).digest('hex') + ':0' })
      L.applyLive(e); M.kray.set(w.addr, 4000n)
    }
    const host = crowd[0]!
    L.applyLive(ev({ kind: 'name', from: host.addr, name: `model${seed}`, nonce: L.nonceOf(host.addr), publicKey: host.pk, signature: sign(nameMessageV2(NET, host.addr, L.nonceOf(host.addr), `model${seed}`), host), scheme: 'kraywallet' }))
    M.kray.set(host.addr, M.bal(M.kray, host.addr) - 1n)   // a name burns the eternal 1 ₭
    M.starOwner.set(LUZ_STAR, host.addr)
    const paper = compileCut({ supply: '100000' })
    L.applyLive(ev({ kind: 'contract', from: host.addr, code: paper, star: LUZ_STAR, nonce: L.nonceOf(host.addr), publicKey: host.pk, signature: sign(contractMessageV2(NET, host.addr, sha256hex(canonicalCode(paper)), 0n), host), scheme: 'kraywallet' }))
    M.kray.set(host.addr, M.bal(M.kray, host.addr) - 1n)   // sealing a paper burns 1 ₭ too
    M.luz.set(host.addr, 100000n)
    for (const w of crowd) { L.runes.deposit(runeId, createHash('sha256').update(`mr${seed}-${w.addr}`).digest('hex') + ':0', 5000n, w.addr, { pool: true }); M.rune.set(w.addr, 5000n) }
    // a key star for the gate, born to the last wallet
    const keyHolder = crowd[3]!
    const keyStar = (() => {
      const before = L.stars.createdSeq, nonce = L.nonceOf(keyHolder.addr)
      L.applyLive(ev({ kind: 'inscribe', from: keyHolder.addr, contentHash: 'k' + seed, contentType: 'text/plain', size: 3, nonce, publicKey: keyHolder.pk, signature: sign(inscribeMessageV2(NET, keyHolder.addr, 'k' + seed, 'text/plain', 3, undefined, nonce), keyHolder), scheme: 'kraywallet' }))
      M.kray.set(keyHolder.addr, M.bal(M.kray, keyHolder.addr) - 1n)
      M.starOwner.set(String(before), keyHolder.addr)
      return BigInt(before)
    })()

    const compare = (what: string) => {
      const mismatch: string[] = []
      for (const w of crowd) {
        if (L.balanceOf(w.addr) !== M.bal(M.kray, w.addr)) mismatch.push(`₭ ${w.addr.slice(-6)}: law ${L.balanceOf(w.addr)} ≠ model ${M.bal(M.kray, w.addr)}`)
        if (L.cuts.of(LUZ_STAR, w.addr) !== M.bal(M.luz, w.addr)) mismatch.push(`✧ ${w.addr.slice(-6)}: law ${L.cuts.of(LUZ_STAR, w.addr)} ≠ model ${M.bal(M.luz, w.addr)}`)
        if (L.runes.balanceOf(runeId, w.addr) !== M.bal(M.rune, w.addr)) mismatch.push(`rune ${w.addr.slice(-6)}: law ${L.runes.balanceOf(runeId, w.addr)} ≠ model ${M.bal(M.rune, w.addr)}`)
      }
      if (L.balanceOf(TREASURY) !== M.bal(M.kray, TREASURY)) mismatch.push(`treasury: law ${L.balanceOf(TREASURY)} ≠ model ${M.bal(M.kray, TREASURY)}`)
      const lawBook = JSON.stringify(L.packets.all())
      const modelBook = JSON.stringify([...M.offers.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, o]) => ({
        lane: o.lane, asset: o.asset, seller: o.seller, amount: o.amount.toString(), price: o.price.toString(),
        ...(o.to ? { to: o.to } : {}), ...(o.gate !== undefined ? { gate: o.gate.toString() } : {}), ...(o.notBefore !== undefined ? { notBefore: o.notBefore } : {}),
      })))
      if (lawBook !== modelBook) mismatch.push(`book:\n      law   ${lawBook}\n      model ${modelBook}`)
      if (mismatch.length) { divergences++; ok(false, `seed ${seed} after ${what}: ${mismatch.join(' | ')}`) }
      return mismatch.length === 0
    }
    ok(compare('the opening'), `seed ${seed}: the model and the law start from the same world`)

    let state = seed * 7919
    const rnd = (n: number): number => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state % n }
    const lanes: PacketLane[] = ['kray', 'luz', 'rune']
    const assetOf = (lane: PacketLane) => lane === 'luz' ? LUZ_STAR : lane === 'rune' ? RUNE : ''
    const fields = (lane: PacketLane, asset: string) => lane === 'luz' ? { star: asset } : lane === 'rune' ? { runeId: asset } : {}

    for (let step = 0; step < 400 && divergences === 0; step++) {
      const w = crowd[rnd(crowd.length)]!, other = crowd[rnd(crowd.length)]!
      const move = rnd(10)
      acts++
      if (move < 4) {
        const lane = lanes[rnd(lanes.length)]!, asset = assetOf(lane)
        const held = M.held(lane, w.addr)
        const amount = held > 1n ? 1n + BigInt(rnd(Number(held > 300n ? 300n : held))) : 1n
        const price = rnd(3) === 0 ? BigInt(1 + rnd(9)) : 0n
        const terms: { to?: string; gate?: bigint; notBefore?: number } = {}
        const which = rnd(6)
        if (which === 0 && other.addr !== w.addr) terms.to = other.addr
        else if (which === 1) terms.gate = keyStar
        else if (which === 2) terms.notBefore = 1 + rnd(3)
        const nonce = L.nonceOf(w.addr)
        const msg = packetListMessage(NET, w.addr, lane, asset, amount, price, terms, nonce)
        const e = ev({ kind: 'packet-list', from: w.addr, lane, ...fields(lane, asset), amount: amount.toString(), price: price.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(msg, w), scheme: 'kraywallet', ...(terms.to ? { to: terms.to } : {}), ...(terms.gate !== undefined ? { gateStar: terms.gate.toString() } : {}), ...(terms.notBefore !== undefined ? { notBefore: terms.notBefore } : {}) })
        const modelSaid = M.list(w.addr, lane, asset, amount, price, terms)
        let lawSaid: string | null = null
        try { L.applyLive(e); applied++ } catch (err) { lawSaid = (err as Error).message }
        if ((modelSaid === null) !== (lawSaid === null)) { divergences++; ok(false, `seed ${seed} step ${step} LIST: model ${modelSaid ?? 'accepts'} / law ${lawSaid ?? 'accepts'} (${lane} ${amount}@${price} ${JSON.stringify(terms)})`) }
        else compare(`list ${lane}`)
      } else if (move < 5) {
        const lane = lanes[rnd(lanes.length)]!, asset = assetOf(lane)
        const nonce = L.nonceOf(w.addr)
        const e = ev({ kind: 'packet-delist', from: w.addr, lane, ...fields(lane, asset), fee: '1', nonce, publicKey: w.pk, signature: sign(packetDelistMessage(NET, w.addr, lane, asset, nonce), w), scheme: 'kraywallet' })
        const modelSaid = M.delist(w.addr, lane, asset)
        let lawSaid: string | null = null
        try { L.applyLive(e); applied++ } catch (err) { lawSaid = (err as Error).message }
        if ((modelSaid === null) !== (lawSaid === null)) { divergences++; ok(false, `seed ${seed} step ${step} DELIST: model ${modelSaid ?? 'accepts'} / law ${lawSaid ?? 'accepts'}`) }
        else compare('delist')
      } else if (move < 9) {
        const rows = [...M.offers.values()]
        if (!rows.length) continue
        const o = rows[rnd(rows.length)]!
        const namedHand = o.to ? crowd.find(c => c.addr === o.to) : undefined
        const hand = namedHand && rnd(4) !== 0 ? namedHand : (w.addr === o.seller ? other : w)
        const nonce = L.nonceOf(hand.addr)
        // the taker declares the terms the MODEL says the offer carries — if the law disagrees about what
        // is on offer, the signature itself says so
        const declared = packetTermsHash(o.to || o.gate !== undefined || o.notBefore !== undefined ? { ...(o.to ? { to: o.to } : {}), ...(o.gate !== undefined ? { gate: o.gate } : {}), ...(o.notBefore !== undefined ? { notBefore: o.notBefore } : {}) } : undefined)
        const msg = packetTakeMessage(NET, hand.addr, o.seller, o.lane, o.asset, o.amount, o.price, declared, nonce)
        const e = ev({ kind: 'packet-take', from: hand.addr, to: o.seller, lane: o.lane, ...fields(o.lane, o.asset), amount: o.amount.toString(), price: o.price.toString(), fee: '1', nonce, publicKey: hand.pk, signature: sign(msg, hand), scheme: 'kraywallet', ...(declared ? { termsHash: declared } : {}) })
        const modelSaid = M.take(hand.addr, o.seller, o.lane, o.asset, o.amount, o.price)
        let lawSaid: string | null = null
        try { L.applyLive(e); applied++ } catch (err) { lawSaid = (err as Error).message }
        if ((modelSaid === null) !== (lawSaid === null)) { divergences++; ok(false, `seed ${seed} step ${step} TAKE: model ${modelSaid ?? 'accepts'} / law ${lawSaid ?? 'accepts'} (${o.lane} ${o.amount}@${o.price})`) }
        else compare(`take ${o.lane}`)
      } else {
        const amt = 1n + BigInt(rnd(50))
        const nonce = L.nonceOf(w.addr)
        const e = ev({ kind: 'transfer', from: w.addr, to: other.addr, amount: amt.toString(), fee: '1', nonce, publicKey: w.pk, signature: sign(transferMessage(NET, w.addr, other.addr, amt, nonce), w), scheme: 'kraywallet' })
        const modelSaid = M.transfer(w.addr, other.addr, amt)
        let lawSaid: string | null = null
        try { L.applyLive(e); applied++ } catch (err) { lawSaid = (err as Error).message }
        if ((modelSaid === null) !== (lawSaid === null)) { divergences++; ok(false, `seed ${seed} step ${step} TRANSFER: model ${modelSaid ?? 'accepts'} / law ${lawSaid ?? 'accepts'}`) }
        else compare('transfer')
      }
      if (!L.conserves()) { ok(false, `seed ${seed} step ${step}: conservation broke`); divergences++ }
    }
    if (divergences === 0) say(`seed ${seed}: the law and an independent model agreed on every act`)
  }
  ok(divergences === 0, `${acts} acts across five seeds, ${applied} applied — zero divergences between the law and a second reading of it`)
  console.log(`  · ${acts} acts compared, ${applied} applied, ${divergences} divergences`)

  // ── THE BOOK MUST NOT TAX EVERY FUTURE EVENT ──────────────────────────────────────────────────
  // `cascadeRoot()` runs after EVERY accepted act. While the committed line was rebuilt on each call, one
  // listing with a very wide price — bought for the eternal 1 ₭ — made every later act on the whole chain
  // slower for as long as it stood, and only its lister could sweep it. The line is remembered now.
  {
    const bk = new PacketMarket()
    for (let i = 0; i < 2_000; i++) bk.list('kray', '', 'bcrt1p' + String(i).padStart(58, '0'), BigInt(i + 1), 10n ** 38n)
    const first = bk.commitment()
    const t0 = Date.now()
    for (let i = 0; i < 500; i++) if (bk.commitment().length !== first.length) { ok(false, 'the remembered line changed without a write'); break }
    const ms = Date.now() - t0
    shows(ms < 100, `500 readings of a 2,000-line book cost ${ms} ms — the line is remembered, not rebuilt for every act`)
    bk.list('kray', '', 'bcrt1pNEW', 7n, 7n)
    shows(bk.commitment() !== first && bk.commitment().includes('bcrt1pNEW'), 'and a write forgets it at once — never a stale commitment')
    bk.remove('kray', '', 'bcrt1pNEW')
    shows(bk.commitment() === first, 'removing it restores the identical line, byte for byte')
  }

  // ── THE COLD REBOOT — the journal on disk, re-read by a node that was never there ──────────────
  {
    const dir = mkdtempSync(join(tmpdir(), 'packet-cold-'))
    try {
      const A = wallet('cold-a'), B = wallet('cold-b')
      const store = new LedgerStore(dir, NET)
      store.append({ kind: 'donate', at: 0, to: A.addr, amount: '900', outpoint: '11'.repeat(32) + ':0' } as never)
      store.append({ kind: 'donate', at: 0, to: B.addr, amount: '900', outpoint: '22'.repeat(32) + ':0' } as never)
      const listNonce = store.ledger.nonceOf(A.addr)
      store.append({ kind: 'packet-list', at: 0, from: A.addr, lane: 'kray', amount: '300', price: '7', fee: '1', nonce: listNonce, to: B.addr, publicKey: A.pk, signature: sign(packetListMessage(NET, A.addr, 'kray', '', 300n, 7n, { to: B.addr }, listNonce), A), scheme: 'kraywallet' } as never)
      const hot = store.ledger.cascadeRoot(), hotBook = store.ledger.packets.commitment()
      shows(!!hotBook && store.ledger.packets.size === 1, 'the live node holds one named packet offer, folded into its root')

      const reborn = new LedgerStore(dir, NET)   // a node that never saw the act — only the journal on disk
      shows(reborn.ledger.cascadeRoot() === hot, 'a COLD REBOOT from the journal re-derives the identical cascade root')
      shows(reborn.ledger.packets.commitment() === hotBook, 'and the identical packet book, line for line')
      const row = reborn.ledger.packets.get('kray', '', A.addr)
      shows(row?.amount === 300n && row?.price === 7n && row?.to === B.addr, 'with the offer\'s terms intact across the reboot')
      // and the reborn node can still close it
      const takeNonce = reborn.ledger.nonceOf(B.addr)
      const rebornTerms = packetTermsHash(reborn.ledger.packets.get('kray', '', A.addr) ?? undefined)
      reborn.append({ kind: 'packet-take', at: 0, from: B.addr, to: A.addr, lane: 'kray', amount: '300', price: '7', fee: '1', nonce: takeNonce, termsHash: rebornTerms, publicKey: B.pk, signature: sign(packetTakeMessage(NET, B.addr, A.addr, 'kray', '', 300n, 7n, rebornTerms, takeNonce), B), scheme: 'kraywallet' } as never)
      shows(reborn.ledger.balanceOf(B.addr) === 900n - 7n - 1n + 300n && reborn.ledger.packets.empty() && reborn.ledger.conserves(),
        'and the heir closes it on the rebooted node — the drop survived the power cut')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the law agrees with an independent reading of itself, and survives a reboot. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
