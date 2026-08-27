/**
 * AMM V2 under storm — integer k, 1 ₭ fee, replay, refusals.
 *   node src/test/amm.sim.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { TREASURY } from '../protocol/kray-primitives.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes,
  transferMessage, runeSendMessage,
  ammAddMessage, ammRemoveMessage, ammSwapMessage,
  ammRrAddMessage, ammRrRemoveMessage, ammRrSwapMessage,
} from '../protocol/scheme.ts'
import { parseRuneKey, canonicalRuneKey } from '../economics/rune-book.ts'
import { ammPoolAddress, ammRrPoolAddress, parseAmmPotAddress, quoteOut, rrPairKey, MINIMUM_LIQUIDITY } from '../protocol/amm.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}

const NET = 'regtest'
const BNET = toBtcNet(NET)
const RUNE = '840000:9'
interface Wallet { addr: string; sk: Uint8Array; pk: string }
function makeWallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`kraynet-amm-sim|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const A = makeWallet('A')
const B = makeWallet('B')
const C = makeWallet('C')

function signAdd(L: KrayLedger, from: Wallet, krayIn: string, runeIn: string, minLp: string): KrayEvent {
  const nonce = L.nonceOf(from.addr)
  const msg = ammAddMessage(NET, from.addr, RUNE, BigInt(krayIn), BigInt(runeIn), BigInt(minLp), nonce)
  return {
    seq: L.appliedSeq + 1, kind: 'amm-add', hash: '0'.repeat(64), from: from.addr, runeId: RUNE,
    krayIn, runeIn, minLp, fee: '1', nonce, publicKey: from.pk, signature: _signKrayWallet(msg, from.sk), scheme: 'kraywallet',
  } as KrayEvent
}
function signSwap(L: KrayLedger, from: Wallet, side: 'kray' | 'rune', amount: string, minOut: string): KrayEvent {
  const nonce = L.nonceOf(from.addr)
  const msg = ammSwapMessage(NET, from.addr, RUNE, side, BigInt(amount), BigInt(minOut), nonce)
  return {
    seq: L.appliedSeq + 1, kind: 'amm-swap', hash: '0'.repeat(64), from: from.addr, runeId: RUNE,
    side, amount, minOut, fee: '1', nonce, publicKey: from.pk, signature: _signKrayWallet(msg, from.sk), scheme: 'kraywallet',
  } as KrayEvent
}
function signRemove(L: KrayLedger, from: Wallet, lp: string, minK: string, minR: string): KrayEvent {
  const nonce = L.nonceOf(from.addr)
  const msg = ammRemoveMessage(NET, from.addr, RUNE, BigInt(lp), BigInt(minK), BigInt(minR), nonce)
  return {
    seq: L.appliedSeq + 1, kind: 'amm-remove', hash: '0'.repeat(64), from: from.addr, runeId: RUNE,
    lp, minKrayOut: minK, minRuneOut: minR, fee: '1', nonce, publicKey: from.pk, signature: _signKrayWallet(msg, from.sk), scheme: 'kraywallet',
  } as KrayEvent
}

function fund(L: KrayLedger, to: string, kray: string, runeAmt: string, pool = true): void {
  L.applyLive({ seq: L.appliedSeq + 1, kind: 'donate', hash: 'd'.repeat(64), to, amount: kray } as KrayEvent)
  const op = createHash('sha256').update(`${to}|${L.appliedSeq}`).digest('hex') + ':0'
  L.applyLive({
    seq: L.appliedSeq + 1, kind: 'rune-deposit', hash: 'r'.repeat(64),
    runeId: RUNE, outpoint: op, to, amount: runeAmt, ...(pool ? { pool: true } : {}),
  } as KrayEvent)
}

function refuse(L: KrayLedger, e: KrayEvent, tag: string): void {
  const before = L.cascadeRoot()
  const nonce = e.from ? L.nonceOf(e.from) : 0
  let threw = false
  try { L.applyLive(e) } catch { threw = true }
  ok(threw, `${tag}: refused`)
  ok(L.cascadeRoot() === before, `${tag}: ledger byte-identical`)
  if (e.from) ok(L.nonceOf(e.from) === nonce, `${tag}: nonce intact (no partial apply)`)
}

function main(): void {
  const L = new KrayLedger(undefined, NET, undefined, true)
  const rid = parseRuneKey(RUNE)
  const pot = ammPoolAddress(RUNE)
  const root0 = L.cascadeRoot()
  ok(L.amm.empty() && L.ammSolvent(), 'empty AMM is solvent — no book to lie')

  fund(L, A.addr, '10000', '50000')
  fund(L, B.addr, '10000', '20000')
  ok(L.conserves() && L.runesSolvent() && L.ammSolvent(), 'fund: conserved + solvent')

  refuse(L, { ...signAdd(L, A, '4000', '8000', '0'), fee: '2' } as KrayEvent, 'fee≠1')
  const tampered = signAdd(L, A, '4000', '8000', '0')
  tampered.signature = 'ab'.repeat(32)
  refuse(L, tampered, 'forged sig')

  L.applyLive(signAdd(L, A, '4000', '8000', '1'))
  ok(L.amm.exists(RUNE), 'create: pool exists')
  ok(L.amm.commitment().split('\n').filter(Boolean).length === 1, 'create: one pair, one cascade line — star-name law')
  ok(L.balanceOf(pot) === 4000n, 'create: ₭ reserve')
  ok(L.runes.balanceOf(rid, pot) === 8000n, 'create: rune reserve')
  const lpA = L.amm.lpOf(RUNE, A.addr)
  ok(lpA > 0n && L.amm.supplyOf(RUNE) === lpA + MINIMUM_LIQUIDITY, 'create: dead shares + creator LP')
  ok(L.balanceOf(TREASURY) >= 1n, 'create: 1 ₭ gas to treasury')

  const lpBook = L.amm.commitment()
  const rootCreate = L.cascadeRoot()
  ok(!!lpBook && rootCreate !== root0, 'create: LP book folds into the cascade (append-only)')
  const want = quoteOut(4000n, 8000n, 1000n)
  ok(L.cascadeRoot() === rootCreate, 'quoteOut is a read — cascade byte-identical')
  const lied = signSwap(L, B, 'kray', '1000', want.toString())
  ;(lied as unknown as { amountOut: string }).amountOut = '999999'
  refuse(L, lied, 'journaled amountOut purged')

  L.applyLive(signSwap(L, B, 'kray', '1000', want.toString()))
  ok(L.runes.balanceOf(rid, B.addr) === 20000n + want, 'swap: B received rune out')
  ok(L.balanceOf(pot) === 5000n, 'swap: ₭ reserve grew')
  const kAfter = L.balanceOf(pot) * L.runes.balanceOf(rid, pot)
  ok(kAfter >= 4000n * 8000n, 'swap: k did not fall')
  ok(L.amm.commitment() === lpBook, 'swap does not mint LP — shares stay')
  ok(L.cascadeRoot() !== rootCreate, 'swap still moves the cascade (money + rune folds)')

  refuse(L, signSwap(L, B, 'kray', '10', '999999999'), 'minOut too high')
  refuse(L, signSwap(L, B, 'kray', '100000000', '1'), 'would drain / insufficient')
  refuse(L, { ...signAdd(L, A, '100', '100', '0'), fee: '0' } as KrayEvent, 'fee=0')
  refuse(L, { seq: L.appliedSeq + 1, kind: 'amm-add', hash: '0'.repeat(64), from: pot, runeId: RUNE, krayIn: '1', runeIn: '1', minLp: '0', fee: '1', nonce: 0 } as KrayEvent, 'pool label cannot sign')
  refuse(L, signAdd(L, A, '1', '1', '0'), 'first-mint-too-small / already exists too small')
  const badNonce = signAdd(L, A, '100', '200', '0')
  badNonce.nonce = 999
  refuse(L, badNonce, 'wrong nonce')
  refuse(L, { seq: L.appliedSeq + 1, kind: 'transfer', hash: '0'.repeat(64), from: pot, to: A.addr, amount: '1', fee: '1', nonce: 0, publicKey: A.pk, signature: 'ab'.repeat(32), scheme: 'kraywallet' } as KrayEvent, 'cannot spend from KRAY_AMM_')
  refuse(L, { seq: L.appliedSeq + 1, kind: 'donate', hash: 'g'.repeat(64), to: pot, amount: '50' } as KrayEvent, 'cannot mint onto the pot')
  {
    const nonce = L.nonceOf(A.addr)
    const msg = transferMessage(NET, A.addr, pot, 10n, nonce)
    refuse(L, {
      seq: L.appliedSeq + 1, kind: 'transfer', hash: '0'.repeat(64), from: A.addr, to: pot, amount: '10', fee: '1',
      nonce, publicKey: A.pk, signature: _signKrayWallet(msg, A.sk), scheme: 'kraywallet',
    } as KrayEvent, 'cannot transfer ₭ onto the pot')
  }
  {
    const nonce = L.nonceOf(A.addr)
    const msg = runeSendMessage(NET, A.addr, pot, RUNE, 10n, nonce)
    refuse(L, {
      seq: L.appliedSeq + 1, kind: 'rune-send', hash: '0'.repeat(64), from: A.addr, to: pot, runeId: RUNE, amount: '10', fee: '1',
      nonce, publicKey: A.pk, signature: _signKrayWallet(msg, A.sk), scheme: 'kraywallet',
    } as KrayEvent, 'cannot send runes onto the pot')
  }

  fund(L, C.addr, '2000', '5000', false)
  refuse(L, signAdd(L, C, '100', '5000', '0'), 'hostage rune cannot add')
  refuse(L, signSwap(L, C, 'rune', '5000', '1'), 'hostage rune cannot swap in')

  const runeWant = quoteOut(L.runes.balanceOf(rid, pot), L.balanceOf(pot), 200n)
  L.applyLive(signSwap(L, B, 'rune', '200', runeWant.toString()))
  ok(L.conserves() && L.runesSolvent() && L.ammSolvent(), 'rune-side swap: conserved + solvent')
  const kSeq = L.balanceOf(pot) * L.runes.balanceOf(rid, pot)

  for (let i = 0; i < 8; i++) {
    const inK = 20n + BigInt(i)
    const outI = quoteOut(L.balanceOf(pot), L.runes.balanceOf(rid, pot), inK)
    L.applyLive(signSwap(L, A, 'kray', inK.toString(), outI.toString()))
    ok(L.balanceOf(pot) * L.runes.balanceOf(rid, pot) >= kSeq, `swarm swap ${i}: k did not fall`)
  }
  ok(L.conserves() && L.runesSolvent() && L.ammSolvent(), 'swarm: conserved + solvent')

  const add = signAdd(L, B, '1100', '2000', '1')
  L.applyLive(add)
  ok(L.amm.lpOf(RUNE, B.addr) > 0n, 'add: B minted LP')

  const burn = L.amm.lpOf(RUNE, B.addr)
  L.applyLive(signRemove(L, B, burn.toString(), '1', '1'))
  ok(L.amm.lpOf(RUNE, B.addr) === 0n, 'remove: B LP gone')
  ok(L.conserves() && L.runesSolvent() && L.ammSolvent(), 'after remove: conserved + solvent')

  const snap = L.cascadeRoot()
  const replay = new KrayLedger(undefined, NET, undefined, true)
  fund(replay, A.addr, '10000', '50000')
  fund(replay, B.addr, '10000', '20000')
  replay.applyLive(signAdd(replay, A, '4000', '8000', '1'))
  replay.applyLive(signSwap(replay, B, 'kray', '1000', want.toString()))
  fund(replay, C.addr, '2000', '5000', false)
  replay.applyLive(signSwap(replay, B, 'rune', '200', quoteOut(replay.runes.balanceOf(rid, pot), replay.balanceOf(pot), 200n).toString()))
  for (let i = 0; i < 8; i++) {
    const inK = 20n + BigInt(i)
    replay.applyLive(signSwap(replay, A, 'kray', inK.toString(), quoteOut(replay.balanceOf(pot), replay.runes.balanceOf(rid, pot), inK).toString()))
  }
  replay.applyLive(signAdd(replay, B, '1100', '2000', '1'))
  replay.applyLive(signRemove(replay, B, burn.toString(), '1', '1'))
  ok(replay.cascadeRoot() === snap, 'replay: same cascade root')
  ok(replay.amm.commitment() === L.amm.commitment(), 'replay: same LP book')
  ok(root0 !== snap, 'amm fold changed the root (append-only once a pool exists)')

  storm2()
  stormCreate()
  stormRr()

  console.log(`\n✓ ${pass} checks passed — AMM V2: k holds, 1 ₭ fee, pot-backed only, replay byte-exact, partial-apply closed. ₿₭`)
}

/** Isolated hostile vectors — must not touch the golden replay tape above. */
function storm2(): void {
  const ALIAS = '0840000:9'
  const L = new KrayLedger(undefined, NET, undefined, true)
  const rid = parseRuneKey(RUNE)
  const pot = ammPoolAddress(RUNE)
  fund(L, A.addr, '10000', '40000')
  fund(L, B.addr, '10000', '20000')
  L.applyLive(signAdd(L, A, '4000', '8000', '1'))
  ok(L.amm.exists(RUNE) && L.amm.exists(ALIAS), 'alias spelling is the same book at the primitive')
  ok(ammPoolAddress(ALIAS) === pot, 'alias pot is the one canonical label')
  ok(parseAmmPotAddress(pot)?.kind === 'kray' && parseAmmPotAddress(pot)?.runeId === RUNE, 'pot label inverts to the canonical rune id')
  const rrPot = ammRrPoolAddress(RUNE, '840000:8')
  const rr = parseAmmPotAddress(rrPot)
  ok(!!rr && rr.kind === 'rr' && rr.a === '840000:8' && rr.b === RUNE, 'RR pot inverts to the ordered pair')
  ok(parseAmmPotAddress('bcrt1pnotapot') === null, 'a wallet address is not a pot')
  ok(L.amm.runeIds().join(',') === RUNE, 'the LP book stores one canonical key')

  const numAdd = signAdd(L, A, '100', '200', '0')
  ;(numAdd as unknown as { krayIn: number }).krayIn = 100
  ;(numAdd as unknown as { runeIn: number }).runeIn = 200
  refuse(L, numAdd, 'JSON-number krayIn/runeIn')

  const numId = signAdd(L, A, '100', '200', '0')
  ;(numId as unknown as { runeId: number }).runeId = 840000
  refuse(L, numId, 'JSON-number runeId')

  const held = L.amm.lpOf(RUNE, A.addr)
  refuse(L, signRemove(L, A, (held + 1n).toString(), '0', '0'), 'burn more LP than held')
  refuse(L, signRemove(L, B, held.toString(), '0', '0'), 'B cannot burn A’s LP')
  refuse(L, signRemove(L, A, L.amm.supplyOf(RUNE).toString(), '0', '0'), 'cannot burn dead shares (whole supply)')

  const tamper = signSwap(L, B, 'kray', '50', '1')
  tamper.minOut = '999999'
  refuse(L, tamper, 'minOut raised after the signature')
  const sideFlip = signSwap(L, B, 'kray', '50', '1')
  sideFlip.side = 'rune'
  refuse(L, sideFlip, 'side flipped after the signature')

  const noFee = signAdd(L, A, '100', '200', '0')
  delete (noFee as { fee?: string }).fee
  refuse(L, noFee, 'fee omitted')

  L.applyLive(signSwap(L, B, 'kray', '40', '0'))
  ok(L.conserves() && L.runesSolvent() && L.ammSolvent(), 'minOut=0 still conserves (economic gift, not a hole)')
  const kLoose = L.balanceOf(pot) * L.runes.balanceOf(rid, pot)
  ok(kLoose >= 4000n * 8000n, 'minOut=0: k did not fall')

  const aliasAdd: KrayEvent = (() => {
    const nonce = L.nonceOf(B.addr)
    const msg = ammAddMessage(NET, B.addr, ALIAS, 1100n, 2000n, 1n, nonce)
    return {
      seq: L.appliedSeq + 1, kind: 'amm-add', hash: '0'.repeat(64), from: B.addr, runeId: ALIAS,
      krayIn: '1100', runeIn: '2000', minLp: '1', fee: '1', nonce, publicKey: B.pk,
      signature: _signKrayWallet(msg, B.sk), scheme: 'kraywallet',
    } as KrayEvent
  })()
  L.applyLive(aliasAdd)
  ok(L.amm.runeIds().join(',') === RUNE, 'alias add merged into the one canonical pool')
  ok(L.amm.lpOf(RUNE, B.addr) > 0n && L.amm.lpOf(ALIAS, B.addr) === L.amm.lpOf(RUNE, B.addr), 'alias add minted LP on the real book')
  ok(L.balanceOf(pot) > 4000n, 'alias add landed on the real pot — no shadow reserve')
  ok(L.conserves() && L.runesSolvent() && L.ammSolvent(), 'alias add: conserved + solvent')

  {
    const GHOST = '1:1'
    ok(!L.runes.knows(parseRuneKey(GHOST)), 'ghost id is not a rune on this L2')
    const nonce = L.nonceOf(A.addr)
    const msg = ammAddMessage(NET, A.addr, GHOST, 4000n, 8000n, 1n, nonce)
    refuse(L, {
      seq: L.appliedSeq + 1, kind: 'amm-add', hash: '0'.repeat(64), from: A.addr, runeId: GHOST,
      krayIn: '4000', runeIn: '8000', minLp: '1', fee: '1', nonce, publicKey: A.pk,
      signature: _signKrayWallet(msg, A.sk), scheme: 'kraywallet',
    } as KrayEvent, 'ghost rune cannot birth a pool')
    ok(!L.amm.exists(GHOST), 'ghost: no shadow pool')
  }

  const last = new KrayLedger(undefined, NET, undefined, true)
  fund(last, A.addr, '8000', '20000')
  last.applyLive(signAdd(last, A, '4000', '8000', '1'))
  const live = last.amm.lpOf(RUNE, A.addr)
  last.applyLive(signRemove(last, A, live.toString(), '1', '1'))
  ok(last.amm.lpOf(RUNE, A.addr) === 0n, 'last live LP burned')
  ok(last.amm.supplyOf(RUNE) === MINIMUM_LIQUIDITY, 'dead shares remain')
  ok(last.balanceOf(ammPoolAddress(RUNE)) > 0n, 'dead shares keep a ₭ reserve — last LP cannot drain')
  ok(last.runes.balanceOf(rid, ammPoolAddress(RUNE)) > 0n, 'dead shares keep a rune reserve')
  refuse(last, signRemove(last, A, '1', '0', '0'), 'after exit, A has no LP left')
  ok(last.conserves() && last.runesSolvent() && last.ammSolvent(), 'last-LP: conserved + solvent')
}

/** Create pool is the first signed add. Empty history must not fold `amm:` (A3). One pair, one book (A5). */
function stormCreate(): void {
  const emptyA = new KrayLedger(undefined, NET, undefined, true)
  const emptyB = new KrayLedger(undefined, NET, undefined, true)
  ok(emptyA.amm.empty() && emptyA.cascadeRoot() === emptyB.cascadeRoot(), 'create: empty AMM never folds — genesis cascade byte-identical')

  const funded = new KrayLedger(undefined, NET, undefined, true)
  fund(funded, A.addr, '10000', '20000')
  const fundedRoot = funded.cascadeRoot()
  ok(funded.amm.empty(), 'create: deposits alone leave the AMM book empty')

  const twin = new KrayLedger(undefined, NET, undefined, true)
  fund(twin, A.addr, '10000', '20000')
  ok(twin.cascadeRoot() === fundedRoot, 'create: two funded journals with no pool share the same cascade (A3)')

  twin.applyLive(signAdd(twin, A, '4000', '8000', '1'))
  ok(!twin.amm.empty() && twin.cascadeRoot() !== fundedRoot, 'create: first signed add writes amm: into the cascade')
  ok(twin.amm.commitment().split('\n').filter(Boolean).length === 1, 'create: one pair, one commitment line')
  ok(twin.amm.exists('0840000:9') && twin.amm.runeIds().join(',') === RUNE, 'create: alias spelling is the same book')

  fund(twin, B.addr, '10000', '20000')
  const afterFirst = twin.amm.commitment()
  twin.applyLive(signAdd(twin, B, '2000', '4000', '1'))
  ok(twin.amm.runeIds().join(',') === RUNE, 'create: second wallet is add-LP, not a second pool')
  ok(twin.amm.commitment().split('\n').filter(Boolean).length === 1, 'create: still one cascade line after the second add')
  ok(twin.amm.commitment() !== afterFirst, 'create: add-LP changes the holders line, never the pair key')
  ok(twin.amm.lpOf(RUNE, A.addr) > 0n && twin.amm.lpOf(RUNE, B.addr) > 0n, 'create: both holders sit on the one book')
  ok(twin.conserves() && twin.runesSolvent() && twin.ammSolvent(), 'create: conserved + solvent')

  const replay = new KrayLedger(undefined, NET, undefined, true)
  fund(replay, A.addr, '10000', '20000')
  replay.applyLive(signAdd(replay, A, '4000', '8000', '1'))
  fund(replay, B.addr, '10000', '20000')
  replay.applyLive(signAdd(replay, B, '2000', '4000', '1'))
  ok(replay.cascadeRoot() === twin.cascadeRoot(), 'create: replay of birth + add-LP is byte-exact')
}

const RB = '840001:1'
function fundRune(L: KrayLedger, to: string, runeId: string, amt: string, pool = true): void {
  const op = createHash('sha256').update(`${to}|${runeId}|${L.appliedSeq}`).digest('hex') + ':0'
  L.applyLive({
    seq: L.appliedSeq + 1, kind: 'rune-deposit', hash: 'r'.repeat(64),
    runeId, outpoint: op, to, amount: amt, ...(pool ? { pool: true } : {}),
  } as KrayEvent)
}
function signRrAdd(L: KrayLedger, from: Wallet, a: string, b: string, aIn: string, bIn: string, minLp: string): KrayEvent {
  const pair = rrPairKey(a, b)
  const nonce = L.nonceOf(from.addr)
  const inA = canonicalRuneKey(a) === pair.a ? aIn : bIn
  const inB = canonicalRuneKey(a) === pair.a ? bIn : aIn
  const msg = ammRrAddMessage(NET, from.addr, pair.a, pair.b, BigInt(inA), BigInt(inB), BigInt(minLp), nonce)
  return {
    seq: L.appliedSeq + 1, kind: 'amm-rr-add', hash: '0'.repeat(64), from: from.addr,
    runeId: pair.a, otherRuneId: pair.b, runeIn: inA, otherIn: inB, minLp, fee: '1',
    nonce, publicKey: from.pk, signature: _signKrayWallet(msg, from.sk), scheme: 'kraywallet',
  } as KrayEvent
}
function signRrSwap(L: KrayLedger, from: Wallet, a: string, b: string, pay: string, amount: string, minOut: string): KrayEvent {
  const pair = rrPairKey(a, b)
  const paid = canonicalRuneKey(pay)
  const nonce = L.nonceOf(from.addr)
  const msg = ammRrSwapMessage(NET, from.addr, pair.a, pair.b, paid, BigInt(amount), BigInt(minOut), nonce)
  return {
    seq: L.appliedSeq + 1, kind: 'amm-rr-swap', hash: '0'.repeat(64), from: from.addr,
    runeId: pair.a, otherRuneId: pair.b, payRuneId: paid, amount, minOut, fee: '1',
    nonce, publicKey: from.pk, signature: _signKrayWallet(msg, from.sk), scheme: 'kraywallet',
  } as KrayEvent
}

function stormRr(): void {
  const L = new KrayLedger(undefined, NET, undefined, true)
  const pair = rrPairKey(RUNE, RB)
  const pot = ammRrPoolAddress(pair.a, pair.b)
  const ridA = parseRuneKey(pair.a)
  const ridB = parseRuneKey(pair.b)
  const krayPot = ammPoolAddress(RUNE)

  L.applyLive({ seq: L.appliedSeq + 1, kind: 'donate', hash: 'd'.repeat(64), to: A.addr, amount: '8000' } as KrayEvent)
  L.applyLive({ seq: L.appliedSeq + 1, kind: 'donate', hash: 'd'.repeat(64), to: A.addr, amount: '8000' } as KrayEvent)
  L.applyLive({ seq: L.appliedSeq + 1, kind: 'donate', hash: 'd'.repeat(64), to: B.addr, amount: '8000' } as KrayEvent)
  L.applyLive({ seq: L.appliedSeq + 1, kind: 'donate', hash: 'd'.repeat(64), to: B.addr, amount: '8000' } as KrayEvent)
  fundRune(L, A.addr, RUNE, '80000')
  fundRune(L, A.addr, RB, '80000')
  fundRune(L, B.addr, RUNE, '40000')
  fundRune(L, B.addr, RB, '40000')

  let threw = false
  try { rrPairKey(RUNE, RUNE) } catch { threw = true }
  ok(threw, 'RR: same rune refused at the pair key')

  const unordered = signRrAdd(L, A, pair.b, pair.a, '4000', '8000', '1')
  // signRrAdd always stores ordered ids — flip them after the signature to prove the reducer fail-closes
  const flipped = { ...unordered, runeId: pair.b, otherRuneId: pair.a } as KrayEvent
  refuse(L, flipped, 'RR: unordered pair in the journal')

  const withKray = signRrAdd(L, A, RUNE, RB, '4000', '8000', '1')
  ;(withKray as unknown as { krayIn: string }).krayIn = '10'
  refuse(L, withKray, 'RR: krayIn on a rune/rune add is purged')

  L.applyLive(signAdd(L, A, '3000', '6000', '1'))
  const krayBook = L.amm.commitment()
  ok(!krayBook.includes('RR|'), 'RR: ₭-only book has no RR line (cascade-identical shape)')
  ok(L.balanceOf(krayPot) === 3000n, 'RR: ₭ pair pot is the old label')

  L.applyLive(signRrAdd(L, A, RUNE, RB, '4000', '8000', '1'))
  ok(L.amm.existsRr(RUNE, RB) && L.amm.existsRr(RB, RUNE), 'RR: create — order does not birth two pots')
  ok(L.runes.balanceOf(ridA, pot) === (pair.a === RUNE ? 4000n : 8000n), 'RR: reserve A')
  ok(L.runes.balanceOf(ridB, pot) === (pair.b === RUNE ? 4000n : 8000n), 'RR: reserve B')
  ok(L.amm.commitment().startsWith(krayBook + '\nRR|'), 'RR: ₭ lines stay; RR appends')
  ok(L.balanceOf(krayPot) === 3000n, 'RR: ₭ pair reserves untouched')
  ok(L.amm.exists(RUNE), 'RR: ₭+rune pool still lives next to the rune/rune book')
  ok(L.conserves() && L.runesSolvent() && L.ammSolvent(), 'RR create: conserved + solvent')

  const pay = pair.a
  const rin0 = L.runes.balanceOf(parseRuneKey(pay), pot)
  const rout0 = L.runes.balanceOf(parseRuneKey(pay === pair.a ? pair.b : pair.a), pot)
  const want = quoteOut(rin0, rout0, 500n)
  const lied = signRrSwap(L, B, RUNE, RB, pay, '500', want.toString())
  ;(lied as unknown as { amountOut: string }).amountOut = '999999'
  refuse(L, lied, 'RR: journaled amountOut purged')

  L.applyLive(signRrSwap(L, B, RUNE, RB, pay, '500', want.toString()))
  const kAfter = L.runes.balanceOf(ridA, pot) * L.runes.balanceOf(ridB, pot)
  ok(kAfter >= rin0 * rout0, 'RR swap: k did not fall')
  ok(L.conserves() && L.runesSolvent() && L.ammSolvent(), 'RR swap: conserved + solvent')

  refuse(L, signRrSwap(L, B, RUNE, RB, pay, '10', '999999999'), 'RR: minOut too high')
  fundRune(L, C.addr, pair.a, '5000', false)
  fundRune(L, C.addr, pair.b, '5000', false)
  L.applyLive({ seq: L.appliedSeq + 1, kind: 'donate', hash: 'd'.repeat(64), to: C.addr, amount: '50' } as KrayEvent)
  refuse(L, signRrAdd(L, C, RUNE, RB, '100', '100', '0'), 'RR: hostage cannot add')
  refuse(L, signRrSwap(L, C, RUNE, RB, pair.a, '100', '1'), 'RR: hostage cannot swap in')

  const kSeq = L.runes.balanceOf(ridA, pot) * L.runes.balanceOf(ridB, pot)
  for (let i = 0; i < 16; i++) {
    const inn = 11n + BigInt(i)
    const side = i % 2 === 0 ? pair.a : pair.b
    const rin = L.runes.balanceOf(parseRuneKey(side), pot)
    const rout = L.runes.balanceOf(parseRuneKey(side === pair.a ? pair.b : pair.a), pot)
    const outI = quoteOut(rin, rout, inn)
    L.applyLive(signRrSwap(L, A, RUNE, RB, side, inn.toString(), outI.toString()))
    ok(L.runes.balanceOf(ridA, pot) * L.runes.balanceOf(ridB, pot) >= kSeq, `RR swarm ${i}: k did not fall`)
  }
  ok(L.conserves() && L.runesSolvent() && L.ammSolvent(), 'RR swarm: conserved + solvent')

  L.applyLive(signRrAdd(L, B, RB, RUNE, '2000', '1100', '1'))
  ok(L.amm.lpOfRr(RUNE, RB, B.addr) > 0n, 'RR add: B minted LP (input order flipped)')
  const burn = L.amm.lpOfRr(RUNE, RB, B.addr)
  const nonce = L.nonceOf(B.addr)
  const rmMsg = ammRrRemoveMessage(NET, B.addr, pair.a, pair.b, burn, 1n, 1n, nonce)
  L.applyLive({
    seq: L.appliedSeq + 1, kind: 'amm-rr-remove', hash: '0'.repeat(64), from: B.addr,
    runeId: pair.a, otherRuneId: pair.b, lp: burn.toString(), minRuneOut: '1', minOtherOut: '1',
    fee: '1', nonce, publicKey: B.pk, signature: _signKrayWallet(rmMsg, B.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L.amm.lpOfRr(RUNE, RB, B.addr) === 0n, 'RR remove: B LP gone')
  ok(L.conserves() && L.runesSolvent() && L.ammSolvent(), 'RR after remove: conserved + solvent')

  const snap = L.cascadeRoot()
  const replay = new KrayLedger(undefined, NET, undefined, true)
  replay.applyLive({ seq: replay.appliedSeq + 1, kind: 'donate', hash: 'd'.repeat(64), to: A.addr, amount: '8000' } as KrayEvent)
  replay.applyLive({ seq: replay.appliedSeq + 1, kind: 'donate', hash: 'd'.repeat(64), to: A.addr, amount: '8000' } as KrayEvent)
  replay.applyLive({ seq: replay.appliedSeq + 1, kind: 'donate', hash: 'd'.repeat(64), to: B.addr, amount: '8000' } as KrayEvent)
  replay.applyLive({ seq: replay.appliedSeq + 1, kind: 'donate', hash: 'd'.repeat(64), to: B.addr, amount: '8000' } as KrayEvent)
  fundRune(replay, A.addr, RUNE, '80000')
  fundRune(replay, A.addr, RB, '80000')
  fundRune(replay, B.addr, RUNE, '40000')
  fundRune(replay, B.addr, RB, '40000')
  replay.applyLive(signAdd(replay, A, '3000', '6000', '1'))
  replay.applyLive(signRrAdd(replay, A, RUNE, RB, '4000', '8000', '1'))
  replay.applyLive(signRrSwap(replay, B, RUNE, RB, pay, '500', want.toString()))
  fundRune(replay, C.addr, pair.a, '5000', false)
  fundRune(replay, C.addr, pair.b, '5000', false)
  replay.applyLive({ seq: replay.appliedSeq + 1, kind: 'donate', hash: 'd'.repeat(64), to: C.addr, amount: '50' } as KrayEvent)
  for (let i = 0; i < 16; i++) {
    const inn = 11n + BigInt(i)
    const side = i % 2 === 0 ? pair.a : pair.b
    const rin = replay.runes.balanceOf(parseRuneKey(side), pot)
    const rout = replay.runes.balanceOf(parseRuneKey(side === pair.a ? pair.b : pair.a), pot)
    replay.applyLive(signRrSwap(replay, A, RUNE, RB, side, inn.toString(), quoteOut(rin, rout, inn).toString()))
  }
  replay.applyLive(signRrAdd(replay, B, RB, RUNE, '2000', '1100', '1'))
  const rNonce = replay.nonceOf(B.addr)
  const rRm = ammRrRemoveMessage(NET, B.addr, pair.a, pair.b, burn, 1n, 1n, rNonce)
  replay.applyLive({
    seq: replay.appliedSeq + 1, kind: 'amm-rr-remove', hash: '0'.repeat(64), from: B.addr,
    runeId: pair.a, otherRuneId: pair.b, lp: burn.toString(), minRuneOut: '1', minOtherOut: '1',
    fee: '1', nonce: rNonce, publicKey: B.pk, signature: _signKrayWallet(rRm, B.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(replay.cascadeRoot() === snap, 'RR replay: same cascade root')
  ok(replay.amm.commitment() === L.amm.commitment(), 'RR replay: same LP book')
}

main()
