/**
 * MINT — a drop on the face. The birth IS the mint.
 *   node src/test/star-mint.test.ts
 *
 * A stranger inscribes a child with this star as parent. The reducer runs
 * rule `mint` (take price → pay seller → taken++) as the father's blessing. A standalone
 * contract-call `mint` is refused. A parent without mint paper still
 * requires ownership. Replay re-derives taken + pot + cascade.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessageV2, contractCallMessage, contractCallMessageV2,
  inscribeMessageV2, inscribeMessageV3, transferMessage,
} from '../protocol/scheme.ts'
import { canonicalCode, isContractPotAddress, validateContract } from '../protocol/contract.ts'
import { compileForm, compileMint, isMintPaper, isLivingTool, MAX_MINT_EDITION, parseMintShelf, resolveMintShelf, optionalMintShelf, requireMintShelf } from '../protocol/star-forms.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
function wallet(tag: string) {
  const sk = createHash('sha256').update('star-mint|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}

const A = wallet('A'), B = wallet('B'), C = wallet('C'), Eve = wallet('eve')

function fund(L: KrayLedger, journal: KrayEvent[]) {
  const evs: KrayEvent[] = [
    { seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '800' } as KrayEvent,
    { seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '200' } as KrayEvent,
    { seq: 3, kind: 'donate', hash: 'dc', to: C.addr, amount: '200' } as KrayEvent,
    { seq: 4, kind: 'donate', hash: 'de', to: Eve.addr, amount: '80' } as KrayEvent,
    {
      seq: 5, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'drop', nonce: 0,
      publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'drop'), A.sk), scheme: 'kraywallet',
    } as KrayEvent,
  ]
  for (const e of evs) { L.applyLive(e); journal.push(e) }
}
function hang(L: KrayLedger, journal: KrayEvent[], price = '5', max = '3', star = '0', payTo?: string) {
  const code = compileMint({ price, max, ...(payTo ? { payTo } : {}) })
  const h = sha256hex(canonicalCode(code))
  const e = {
    seq: journal.length + 1, kind: 'contract' as const, hash: 'mint' + star, from: A.addr, code, star,
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, h, BigInt(star)), A.sk), scheme: 'kraywallet' as const,
  }
  L.applyLive(e as KrayEvent)
  journal.push(e as KrayEvent)
  const pot = L.stars.star(BigInt(star))?.contract
  if (!pot) throw new Error('no pot')
  return pot
}
function child(L: KrayLedger, w: ReturnType<typeof wallet>, parent: string, tag: string, seq: number, lists?: { parents: string[] }) {
  const ch = sha256hex(tag)
  const n = L.nonceOf(w.addr)
  if (lists) {
    return {
      seq, kind: 'inscribe' as const, hash: tag, from: w.addr, contentHash: ch, contentType: 'text/plain', size: 8,
      parents: lists.parents, origins: [] as string[], nonce: n,
      publicKey: w.pk, signature: _signKrayWallet(inscribeMessageV3(NET, w.addr, ch, 'text/plain', 8, lists.parents, [], n), w.sk),
      scheme: 'kraywallet' as const,
    }
  }
  return {
    seq, kind: 'inscribe' as const, hash: tag, from: w.addr, contentHash: ch, contentType: 'text/plain', size: 8,
    parent, nonce: n,
    publicKey: w.pk, signature: _signKrayWallet(inscribeMessageV2(NET, w.addr, ch, 'text/plain', 8, BigInt(parent), n), w.sk),
    scheme: 'kraywallet' as const,
  }
}
function apply(L: KrayLedger, journal: KrayEvent[], e: KrayEvent) {
  L.applyLive(e)
  journal.push(e)
}

function main() {
  console.log('\n╔═ STAR MINT — blessing · sold out · replay ═╗\n')
  const paper = compileMint({ price: '5', max: '8' })
  ok(validateContract(paper).ok, 'compiled IR validates')
  ok(isMintPaper(paper), 'isMintPaper sees mint and not enter')
  ok(!isMintPaper(compileForm({ kind: 'raffle', price: '5' })), 'a raffle is not mint paper')
  ok(paper.rules.map((r) => r.name).join(',') === 'toggle_open,mint,collect', 'desk is toggle + mint + collect')
  ok(isLivingTool('collect') && isLivingTool('toggle_open') && !isLivingTool('mint'), 'collect/toggle are mouth; mint is not a call')
  ok(compileMint({ price: '0', max: '1' }).vars?.price === '0', 'price 0 is an airdrop — the blessing still runs')
  const paid = compileMint({ price: '5', max: '2', payTo: Eve.addr })
  ok(JSON.stringify(paid.rules.find((r) => r.name === 'mint')).includes(Eve.addr), 'payTo seals the seller address in the IR')
  rejects(() => compileMint({ price: '5', max: '1', payTo: 'not-an-address' }), /payTo/, 'a junk payTo is refused at compile')
  rejects(() => compileMint({ price: '5', max: '0' }), /max/, 'max 0 is refused')
  rejects(() => compileMint({ price: '5', max: String(MAX_MINT_EDITION + 1) }), /256/, 'an unbounded drop is refused')
  rejects(() => compileForm({ kind: 'mint', price: '5', max: '0' }), /max/, 'compileForm mint refuses max 0')
  ok(parseMintShelf('https://cdn.example/{n}.png') === 'https://cdn.example/{n}.png', 'art URL with {n} is accepted')
  ok(resolveMintShelf('https://cdn.example/{n}.png', 3) === 'https://cdn.example/3.png', '{n} is the edition about to be born')
  ok(resolveMintShelf('https://cdn.example/{i}.png', 0) === 'https://cdn.example/1.png', '{i} is 1-based')
  ok(optionalMintShelf('') == null && optionalMintShelf('  ') == null, 'empty art URL is absent from an unfinished draft')
  ok(requireMintShelf('https://cdn.example/{n}.png', 8) === 'https://cdn.example/{n}.png', 'a multi-edition drop requires the slot in the URL')
  rejects(() => requireMintShelf('', 3), /empty/, 'a mint without artist art is refused')
  rejects(() => requireMintShelf('https://cdn.example/one.png', 8), /unique bytes|\{n\}/, 'eight copies of one file are refused — each child is unique bytes')
  ok(requireMintShelf('https://cdn.example/one.png', 1) === 'https://cdn.example/one.png', 'a 1/1 may be a single file')
  rejects(() => parseMintShelf('http://127.0.0.1/x.png'), /public/, 'loopback art URL is refused')
  rejects(() => parseMintShelf('http://[::ffff:169.254.169.254]/x.png'), /public/, 'IPv4-mapped link-local art URL is refused')
  rejects(() => parseMintShelf('ftp://cdn.example/x.png'), /http/, 'non-http art URL is refused')

  // A3 — omit/0 drop keeps classic IR; drop>0 is an additive paper
  const classic = compileMint({ price: '5', max: '8' })
  const classic0 = compileMint({ price: '5', max: '8', drop: '0' })
  ok(canonicalCode(classic) === canonicalCode(classic0), 'drop omitted|0 is byte-identical classic mint (A3)')
  ok(classic.vars?.drop === undefined, 'classic mint has no drop var')
  const withDrop = compileMint({ price: '5', max: '4', drop: '10' })
  ok(withDrop.vars?.drop === '10', 'drop seals into vars')
  ok(isMintPaper(withDrop), 'drop mint is still mint paper')
  ok(JSON.stringify(withDrop.rules.find((r) => r.name === 'mint')).includes('caller'), 'drop pays the living caller')
  rejects(() => compileMint({ price: '5', max: '2', drop: '-1' }), /drop|whole/, 'negative drop is refused')

  const J: KrayEvent[] = []
  const L = new KrayLedger(undefined, NET)
  fund(L, J)
  rejects(() => {
    const code = compileMint({ price: '5', max: '3' })
    const h = sha256hex(canonicalCode(code))
    L.applyLive({
      seq: 6, kind: 'contract', hash: 'leak', from: A.addr, code, star: '0',
      shelf: 'https://cdn.example/{n}.png',
      publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, h, 0n), A.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /journal|steal/i, 'the art URL cannot ride the journal — a replica would leak the drop')
  const pot = hang(L, J)
  ok(isContractPotAddress(pot), 'mint hangs on a keyless pot')
  ok(L.contractAt(pot)?.shelf == null, 'the public paper does not name the art URL')
  ok(L.stars.ownerOf(0n) === A.addr, 'Alice still holds the mint face')

  rejects(() => {
    L.applyLive({
      seq: 7, kind: 'contract-call', hash: 'call', from: B.addr, contract: pot, rule: 'mint',
      callArgs: {}, fee: '1', nonce: 0,
      publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, pot, 'mint', {}, 0), B.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /birth|inscribe/i, 'a standalone mint call is refused — the birth is the mint')
  rejects(() => {
    L.applyLive({
      seq: 7, kind: 'contract-call', hash: 'v2m', from: B.addr, contract: pot, rule: 'mint',
      callArgs: {}, fee: '1', nonce: 0, clock: 1,
      publicKey: B.pk, signature: _signKrayWallet(contractCallMessageV2(NET, B.addr, pot, 'mint', {}, 0, 1), B.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /birth|inscribe/i, 'a v2 mint call is also refused')

  const beforeB = L.balanceOf(B.addr)
  const beforeA = L.balanceOf(A.addr)
  apply(L, J, child(L, B, '0', 'kid-b', 7) as unknown as KrayEvent)
  ok(L.stars.ownerOf(1n) === B.addr, 'Bob owns the child he inscribed')
  ok(L.stars.star(1n)?.parent === 0n, 'the mint face is the parent — the family tree grew')
  ok(L.stars.childrenOf(0n).map(String).join(',') === '1', 'childrenOf the mint face lists the child')
  ok(L.contractAt(pot)?.state.taken === '1', 'taken incremented by the blessing')
  ok(L.balanceOf(pot) === 0n, 'the pot does not keep the mint price — it paid through')
  ok(L.balanceOf(B.addr) === beforeB - 1n - 5n, 'Bob paid burn + price — no extra 1 ₭ call fee')
  ok(L.balanceOf(A.addr) === beforeA + 5n, 'the living owner received the mint price in the same act')
  ok(L.conserves(), 'conservation after the first mint')

  const frozenTaken = L.contractAt(pot)!.state.taken
  const frozenB = L.balanceOf(B.addr)
  const frozenA = L.balanceOf(A.addr)
  const frozenCount = L.stars.starCount
  rejects(() => { L.applyLive(child(L, C, '0', 'kid-b', 8) as unknown as KrayEvent) }, /already inscribed|unique/i, 'same bytes refuse — no curse, no second charge')
  ok(L.contractAt(pot)?.state.taken === frozenTaken, 'taken stays frozen on a duplicate')
  ok(L.balanceOf(B.addr) === frozenB && L.balanceOf(A.addr) === frozenA, 'duplicate mint moves no ₭')
  ok(L.stars.starCount === frozenCount, 'duplicate mint births no star')
  ok(L.conserves(), 'conservation after a refused duplicate')

  apply(L, J, child(L, A, '0', 'kid-a', 8) as unknown as KrayEvent)
  ok(L.contractAt(pot)?.state.taken === '2', 'the living owner also consumes an edition — no bypass')
  ok(L.stars.ownerOf(2n) === A.addr, 'Alice owns the child she inscribed')
  ok(L.balanceOf(pot) === 0n, 'owner mint pays herself — pot stays empty')

  apply(L, J, child(L, C, '0', 'kid-c', 9, { parents: ['0'] }) as unknown as KrayEvent)
  ok(L.contractAt(pot)?.state.taken === '3', 'v3 parents list walks the same blessing')
  ok(L.stars.ownerOf(3n) === C.addr, 'Carol owns the v3 child')

  rejects(() => { L.applyLive(child(L, Eve, '0', 'sold', 10) as unknown as KrayEvent) }, /blessing refused|taken|guard/i, 'sold out — the blessing dies')
  ok(L.stars.starCount === 4, 'sold-out inscribe burned nothing (name + 3 children)')

  apply(L, J, (() => {
    const n = L.nonceOf(A.addr)
    return {
      seq: 10, kind: 'transfer', hash: 'gift', from: A.addr, to: pot, amount: '7', fee: '1', nonce: n,
      publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, pot, 7n, n), A.sk), scheme: 'kraywallet',
    } as KrayEvent
  })())
  ok(L.balanceOf(pot) === 7n, 'a gift can sit in the pot')
  apply(L, J, (() => {
    const n = L.nonceOf(A.addr)
    return {
      seq: 11, kind: 'contract-call', hash: 'col', from: A.addr, contract: pot, rule: 'collect',
      callArgs: {}, fee: '1', nonce: n,
      publicKey: A.pk, signature: _signKrayWallet(contractCallMessage(NET, A.addr, pot, 'collect', {}, n), A.sk), scheme: 'kraywallet',
    } as KrayEvent
  })())
  ok(L.balanceOf(pot) === 0n, 'living mouth still collects leftover pot')
  ok(L.conserves(), 'conservation after collect')

  const L2 = new KrayLedger(undefined, NET)
  for (const e of J) L2.applyLive(e)
  ok(L2.cascadeRoot() === L.cascadeRoot(), 'replay re-derives the cascade')
  ok(L2.contractAt(pot)?.state.taken === '3' && L2.balanceOf(pot) === 0n, 'replay re-derives taken and the empty pot')
  ok(L2.contractAt(pot)?.shelf == null, 'replay still does not know the art URL — it was never journaled')
  ok(L2.stars.childrenOf(0n).length === 3, 'replay re-derives the family')

  // ── closed door · fake parent · two mint parents ──
  const Pj: KrayEvent[] = []
  const P = new KrayLedger(undefined, NET)
  fund(P, Pj)
  const ppot = hang(P, Pj, '5', '8')
  apply(P, Pj, {
    seq: 7, kind: 'contract-call', hash: 'tog', from: A.addr, contract: ppot, rule: 'toggle_open',
    callArgs: {}, fee: '1', nonce: 1,
    publicKey: A.pk, signature: _signKrayWallet(contractCallMessage(NET, A.addr, ppot, 'toggle_open', {}, 1), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  rejects(() => { P.applyLive(child(P, B, '0', 'closed', 8) as unknown as KrayEvent) }, /blessing refused|open|guard/i, 'closed mint refuses a stranger')
  apply(P, Pj, {
    seq: 8, kind: 'contract-call', hash: 'opn', from: A.addr, contract: ppot, rule: 'toggle_open',
    callArgs: {}, fee: '1', nonce: 2,
    publicKey: A.pk, signature: _signKrayWallet(contractCallMessage(NET, A.addr, ppot, 'toggle_open', {}, 2), A.sk), scheme: 'kraywallet',
  } as KrayEvent)

  const chBare = sha256hex('bare')
  apply(P, Pj, {
    seq: 9, kind: 'inscribe', hash: 'bare', from: A.addr, contentHash: chBare, contentType: 'text/plain', size: 8,
    nonce: 3, publicKey: A.pk, signature: _signKrayWallet(inscribeMessageV2(NET, A.addr, chBare, 'text/plain', 8, undefined, 3), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(P.stars.ownerOf(1n) === A.addr, 'a bare star has no mint paper')
  rejects(() => { P.applyLive(child(P, Eve, '1', 'steal', 10) as unknown as KrayEvent) }, /only the owner/i, 'a parent without mint paper still requires ownership')

  const chTwo = sha256hex('two')
  apply(P, Pj, {
    seq: 10, kind: 'inscribe', hash: 'two', from: A.addr, contentHash: chTwo, contentType: 'text/plain', size: 8,
    nonce: 4, publicKey: A.pk, signature: _signKrayWallet(inscribeMessageV2(NET, A.addr, chTwo, 'text/plain', 8, undefined, 4), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  hang(P, Pj, '1', '8', '2')
  rejects(() => { P.applyLive(child(P, B, '0', 'duo', 12, { parents: ['0', '2'] }) as unknown as KrayEvent) }, /one mint parent/i, 'two mint parents on one birth are refused')

  // ── cannot afford price + burn ──
  const Poor = new KrayLedger(undefined, NET)
  const Q: KrayEvent[] = []
  apply(Poor, Q, { seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '40' } as KrayEvent)
  apply(Poor, Q, { seq: 2, kind: 'donate', hash: 'db', to: Eve.addr, amount: '3' } as KrayEvent)
  apply(Poor, Q, {
    seq: 3, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'poor', nonce: 0,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'poor'), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  hang(Poor, Q, '5', '2')
  rejects(() => { Poor.applyLive(child(Poor, Eve, '0', 'broke', Q.length + 1) as unknown as KrayEvent) }, /insufficient/i, 'burn + mint price is one affordability check')

  // ── sealed payTo (not the living owner) ──
  const Pay: KrayEvent[] = []
  const Pl = new KrayLedger(undefined, NET)
  fund(Pl, Pay)
  const pp = hang(Pl, Pay, '5', '2', '0', Eve.addr)
  const eve0 = Pl.balanceOf(Eve.addr)
  const alice0 = Pl.balanceOf(A.addr)
  apply(Pl, Pay, child(Pl, B, '0', 'pay-eve', Pay.length + 1) as unknown as KrayEvent)
  ok(Pl.balanceOf(Eve.addr) === eve0 + 5n, 'sealed payTo receives the mint price')
  ok(Pl.balanceOf(A.addr) === alice0, 'living owner does not receive when payTo is sealed')
  ok(Pl.balanceOf(pp) === 0n, 'payTo pot does not keep the price')
  ok(Pl.conserves(), 'conservation after payTo mint')


  // ── escrow drop: fund pot → each mint pays caller `drop` ₭ ──
  console.log('\n· escrow drop (pot → perPack to minter)')
  const Dj: KrayEvent[] = []
  const D = new KrayLedger(undefined, NET)
  fund(D, Dj)
  const dcode = compileMint({ price: '5', max: '2', drop: '10' })
  const dh = sha256hex(canonicalCode(dcode))
  apply(D, Dj, {
    seq: 6, kind: 'contract', hash: 'mdrop', from: A.addr, code: dcode, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, dh, 0n), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const dpot = D.stars.star(0n)!.contract!
  rejects(() => { D.applyLive(child(D, B, '0', 'nodrop', 7) as unknown as KrayEvent) }, /blessing refused|guard|afford|balance/i, 'unfunded drop pot refuses the blessing')
  apply(D, Dj, (() => {
    const n = D.nonceOf(A.addr)
    return {
      seq: 7, kind: 'transfer', hash: 'fund', from: A.addr, to: dpot, amount: '20', fee: '1', nonce: n,
      publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, dpot, 20n, n), A.sk), scheme: 'kraywallet',
    } as KrayEvent
  })())
  ok(D.balanceOf(dpot) === 20n, 'artist funded 20 ₭ escrow (2 packs × 10)')
  const b0 = D.balanceOf(B.addr)
  const a0 = D.balanceOf(A.addr)
  apply(D, Dj, child(D, B, '0', 'drop-b', 8) as unknown as KrayEvent)
  ok(D.contractAt(dpot)?.state.taken === '1', 'taken++ with drop')
  ok(D.balanceOf(dpot) === 10n, 'pot paid 10 drop · price passed through')
  ok(D.balanceOf(B.addr) === b0 - 1n - 5n + 10n, 'Bob paid burn+price and received the 10 ₭ drop — escrow drop pays the minter')
  ok(D.balanceOf(A.addr) === a0 + 5n, 'Alice received the mint price')
  ok(D.conserves(), 'conservation after drop mint')
  apply(D, Dj, child(D, C, '0', 'drop-c', 9) as unknown as KrayEvent)
  ok(D.balanceOf(dpot) === 0n, 'second pack empties the escrow')
  rejects(() => { D.applyLive(child(D, Eve, '0', 'drop-x', 10) as unknown as KrayEvent) }, /blessing refused|guard|sold|taken/i, 'sold out or empty pot — no third pack')
  const D2 = new KrayLedger(undefined, NET)
  for (const e of Dj) D2.applyLive(e)
  ok(D2.cascadeRoot() === D.cascadeRoot(), 'drop mint replay re-derives cascade')
  ok(D2.balanceOf(dpot) === 0n && D2.contractAt(dpot)?.state.taken === '2', 'replay re-derives empty pot + taken')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — MINT HOLDS: blessing take→pay in one act, unique bytes refuse before charge, no standalone mint call, sold out dies, owner consumes an edition, lineage without paper stays owned, replay is byte-exact. ⚖⭐`)
}
main()
