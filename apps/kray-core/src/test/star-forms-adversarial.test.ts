/**
 * SEALED FORMS — adversarial exam. Prove by breaking.
 *   node src/test/star-forms-adversarial.test.ts
 *
 * Forgery, replay, drain, underfund, sybil, sale-of-face, wrong door,
 * tampered payouts. Every refusal must leave the cascade and the pot untouched.
 * Reboot must be byte-exact.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessage, contractMessageV2, contractCallMessage, transferMessage, sendStarMessage,
} from '../protocol/scheme.ts'
import { canonicalCode, contractAddress, validateContract } from '../protocol/contract.ts'
import { compileEscrow, compileScroll, compileTunnel, compileVest, MAX_SCROLL_ALLOW } from '../protocol/star-forms.ts'
import { callerInt } from '../protocol/star-law.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}

function wallet(tag: string) {
  const sk = createHash('sha256').update('forms-adv|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex, tag }
}
type W = ReturnType<typeof wallet>

function main() {
  console.log('\n╔═ STAR FORMS ADVERSARIAL — forge · drain · sybil · reboot ═╗\n')
  const A = wallet('A'), B = wallet('B'), C = wallet('C'), Eve = wallet('eve')

  // ── compile: hostile desks ──────────────────────────────────────────────
  rejects(() => compileScroll({ each: '1.5', max: '1', gate: 'open' }), /whole/, 'decimal each is refused')
  rejects(() => compileScroll({ each: '-1', max: '1', gate: 'open' }), /whole|greater/, 'negative each is refused')
  rejects(() => compileScroll({ each: '1', max: '0', gate: 'open' }), /greater than 0/, 'max=0 is refused')
  rejects(() => compileScroll({ each: '1', max: '1', gate: 'weird' as never }), /unknown scroll gate/, 'unknown gate is refused')
  rejects(() => compileScroll({ each: '1', gate: 'list', allow: Array.from({ length: MAX_SCROLL_ALLOW + 1 }, (_, i) => wallet('x' + i).addr) }), /at most/, '9 allowlisted addresses are refused')
  rejects(() => compileScroll({ each: '1', gate: 'list', allow: [B.addr, B.addr] }), /duplicate/, 'duplicate allow is refused')
  rejects(() => compileVest({ beneficiary: C.addr, start: '0', duration: '0', total: '10' }), /duration/, 'zero vest duration is refused')
  rejects(() => compileEscrow({ buyer: 'not-an-address', seller: C.addr, deadline: '1' }), /sealed address/, 'garbage buyer is refused')
  rejects(() => compileTunnel({ dest: '!!' }), /sealed address/, 'garbage tunnel dest is refused')

  const L = new KrayLedger(undefined, NET)
  const journal: KrayEvent[] = []
  const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
  const snapshot = () => ({ root: L.cascadeRoot(), burned: L.totalBurned, merkle: L.stars.merkleRoot() })
  const unchanged = (s: ReturnType<typeof snapshot>, m: string) => {
    ok(L.cascadeRoot() === s.root && L.totalBurned === s.burned && L.stars.merkleRoot() === s.merkle && L.conserves(), m)
  }
  const tryBad = (e: KrayEvent, re: RegExp, m: string) => {
    const s = snapshot()
    try { L.applyLive(e); ok(false, m + ' — DID NOT throw') }
    catch (err) {
      ok(re.test((err as Error).message), m + (re.test((err as Error).message) ? '' : ' — wrong error: ' + (err as Error).message))
      unchanged(s, m + ' — state frozen')
    }
  }
  const sign = (w: W, fields: Record<string, unknown>, msg: string, nonce?: number): KrayEvent => {
    const n = nonce ?? L.nonceOf(w.addr)
    return {
      seq: L.appliedSeq + 1, at: 0, from: w.addr, publicKey: w.pk,
      signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet',
      nonce: n, ...fields,
    } as unknown as KrayEvent
  }

  push({ seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '4000' } as KrayEvent)
  push({ seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '80' } as KrayEvent)
  push({ seq: 3, kind: 'donate', hash: 'dc', to: C.addr, amount: '80' } as KrayEvent)
  push({ seq: 4, kind: 'donate', hash: 'de', to: Eve.addr, amount: '80' } as KrayEvent)
  push(sign(A, { kind: 'name', hash: 'n0', name: 'paper' }, nameMessageV2(NET, A.addr, 0, 'paper'), 0))

  // ── vest underfund (the lock-forever bug) ─────────────────────────────
  const vest = compileVest({ beneficiary: C.addr, start: '6', duration: '1', total: '20' })
  const vh = sha256hex(canonicalCode(vest))
  push(sign(A, { kind: 'contract', hash: 'v', code: vest, star: '0' }, contractMessageV2(NET, A.addr, vh, 0n)))
  const vpot = contractAddress(vh, A.addr, L.appliedSeq)
  push(sign(A, { kind: 'transfer', hash: 'vf', to: vpot, amount: '8', fee: '1' }, transferMessage(NET, A.addr, vpot, 8n, L.nonceOf(A.addr))))
  const c0 = L.balanceOf(C.addr)
  push(sign(Eve, { kind: 'contract-call', hash: 'vr1', contract: vpot, rule: 'release', callArgs: {}, fee: '1' },
    contractCallMessage(NET, Eve.addr, vpot, 'release', {}, L.nonceOf(Eve.addr))))
  ok(L.balanceOf(C.addr) === c0 + 8n && L.contractAt(vpot)?.state.released === '8',
    'underfunded vest pays 8 and records released=8 — not the full 20')
  push(sign(A, { kind: 'transfer', hash: 'vf2', to: vpot, amount: '12', fee: '1' }, transferMessage(NET, A.addr, vpot, 12n, L.nonceOf(A.addr))))
  push(sign(Eve, { kind: 'contract-call', hash: 'vr2', contract: vpot, rule: 'release', callArgs: {}, fee: '1' },
    contractCallMessage(NET, Eve.addr, vpot, 'release', {}, L.nonceOf(Eve.addr))))
  ok(L.balanceOf(C.addr) === c0 + 20n && L.balanceOf(vpot) === 0n, 'top-up then release pays the remainder to C — never to Eve')
  ok(L.conserves(), 'underfunded vest conserves')

  // ── locked open scroll ──────────────────────────────────────────────────
  push(sign(A, { kind: 'name', hash: 'n1', name: 'open' }, nameMessageV2(NET, A.addr, L.nonceOf(A.addr), 'open')))
  const open = compileScroll({ each: '5', max: '3', locked: true, gate: 'open' })
  const oh = sha256hex(canonicalCode(open))
  const face1 = L.stars.createdSeq - 1n
  push(sign(A, { kind: 'contract', hash: 'so', code: open, star: face1.toString() }, contractMessageV2(NET, A.addr, oh, face1)))
  const spot = contractAddress(oh, A.addr, L.appliedSeq)
  push(sign(A, { kind: 'transfer', hash: 'sf', to: spot, amount: '10', fee: '1' }, transferMessage(NET, A.addr, spot, 10n, L.nonceOf(A.addr))))
  tryBad(sign(A, { kind: 'contract-call', hash: 'col', contract: spot, rule: 'collect', callArgs: {}, fee: '1' },
    contractCallMessage(NET, A.addr, spot, 'collect', {}, L.nonceOf(A.addr))), /no rule|refused/i, 'locked scroll: owner collect')
  tryBad(sign(A, { kind: 'transfer', hash: 'drain', to: Eve.addr, amount: '1', fee: '1', from: spot } as Record<string, unknown>,
    transferMessage(NET, spot, Eve.addr, 1n, 0), 0), /sig|key|scheme|from|protocol pot|cannot transfer/i, 'keyless pot cannot transfer')

  push(sign(A, { kind: 'contract-call', hash: 'off', contract: spot, rule: 'toggle_open', callArgs: {}, fee: '1' },
    contractCallMessage(NET, A.addr, spot, 'toggle_open', {}, L.nonceOf(A.addr))))
  ok(L.contractAt(spot)?.state.open === '0', 'owner closed the scroll')
  tryBad(sign(B, { kind: 'contract-call', hash: 'shut', contract: spot, rule: 'claim', callArgs: {}, fee: '1' },
    contractCallMessage(NET, B.addr, spot, 'claim', {}, L.nonceOf(B.addr))), /refused|guard/i, 'claim while closed')
  push(sign(A, { kind: 'contract-call', hash: 'on', contract: spot, rule: 'toggle_open', callArgs: {}, fee: '1' },
    contractCallMessage(NET, A.addr, spot, 'toggle_open', {}, L.nonceOf(A.addr))))

  const b0 = L.balanceOf(B.addr)
  push(sign(B, { kind: 'contract-call', hash: 'c1', contract: spot, rule: 'claim', callArgs: {}, fee: '1' },
    contractCallMessage(NET, B.addr, spot, 'claim', {}, L.nonceOf(B.addr))))
  ok(L.balanceOf(B.addr) === b0 - 1n + 5n && L.balanceOf(spot) === 5n, 'open claim pays the caller — dest was not rewritten to the holder')
  push(sign(C, { kind: 'contract-call', hash: 'c2', contract: spot, rule: 'claim', callArgs: {}, fee: '1' },
    contractCallMessage(NET, C.addr, spot, 'claim', {}, L.nonceOf(C.addr))))
  ok(L.balanceOf(spot) === 0n, 'second claim empties a 10 ₭ pot at each=5')
  tryBad(sign(Eve, { kind: 'contract-call', hash: 'c3', contract: spot, rule: 'claim', callArgs: {}, fee: '1' },
    contractCallMessage(NET, Eve.addr, spot, 'claim', {}, L.nonceOf(Eve.addr))), /refused|guard/i, 'third claim — pot < each (taken still < max)')

  // ── stamp: mouth, cancel, overwrite after sale ──────────────────────────
  push(sign(A, { kind: 'name', hash: 'n2', name: 'tkt' }, nameMessageV2(NET, A.addr, L.nonceOf(A.addr), 'tkt')))
  const stamped = compileScroll({ each: '6', max: '2', locked: true, gate: 'stamp' })
  const sth = sha256hex(canonicalCode(stamped))
  const face2 = L.stars.createdSeq - 1n
  push(sign(A, { kind: 'contract', hash: 'st', code: stamped, star: face2.toString() }, contractMessageV2(NET, A.addr, sth, face2)))
  const tpot = contractAddress(sth, A.addr, L.appliedSeq)
  push(sign(A, { kind: 'transfer', hash: 'tf', to: tpot, amount: '12', fee: '1' }, transferMessage(NET, A.addr, tpot, 12n, L.nonceOf(A.addr))))
  tryBad(sign(Eve, { kind: 'contract-call', hash: 'gs', contract: tpot, rule: 'stamp', callArgs: { id: callerInt(Eve.addr) }, fee: '1' },
    contractCallMessage(NET, Eve.addr, tpot, 'stamp', { id: BigInt(callerInt(Eve.addr)) }, L.nonceOf(Eve.addr))), /living owner|mouth/i, 'stranger stamp')
  tryBad(sign(A, { kind: 'contract-call', hash: 'noid', contract: tpot, rule: 'stamp', callArgs: {}, fee: '1' },
    contractCallMessage(NET, A.addr, tpot, 'stamp', {}, L.nonceOf(A.addr))), /missing argument|refused/i, 'stamp without id')
  push(sign(A, { kind: 'contract-call', hash: 'z', contract: tpot, rule: 'stamp', callArgs: { id: '0' }, fee: '1' },
    contractCallMessage(NET, A.addr, tpot, 'stamp', { id: 0n }, L.nonceOf(A.addr))))
  tryBad(sign(B, { kind: 'contract-call', hash: 'zclaim', contract: tpot, rule: 'claim', callArgs: {}, fee: '1' },
    contractCallMessage(NET, B.addr, tpot, 'claim', {}, L.nonceOf(B.addr))), /refused|guard/i, 'ticket 0 is a cancel — claim refuses')
  push(sign(A, { kind: 'contract-call', hash: 'mk', contract: tpot, rule: 'stamp', callArgs: { id: callerInt(B.addr) }, fee: '1' },
    contractCallMessage(NET, A.addr, tpot, 'stamp', { id: BigInt(callerInt(B.addr)) }, L.nonceOf(A.addr))))
  push(sign(A, { kind: 'transfer-star', hash: 'sale', to: Eve.addr, star: face2.toString(), fee: '1' },
    sendStarMessage(NET, A.addr, Eve.addr, face2, L.nonceOf(A.addr))))
  ok(L.stars.ownerOf(face2) === Eve.addr && L.balanceOf(tpot) === 12n, 'sale does not drain the scroll pot')
  tryBad(sign(A, { kind: 'contract-call', hash: 'ghost', contract: tpot, rule: 'stamp', callArgs: { id: callerInt(C.addr) }, fee: '1' },
    contractCallMessage(NET, A.addr, tpot, 'stamp', { id: BigInt(callerInt(C.addr)) }, L.nonceOf(A.addr))), /living owner|mouth/i, 'seller lost stamp')
  push(sign(Eve, { kind: 'contract-call', hash: 'ow', contract: tpot, rule: 'stamp', callArgs: { id: callerInt(C.addr) }, fee: '1' },
    contractCallMessage(NET, Eve.addr, tpot, 'stamp', { id: BigInt(callerInt(C.addr)) }, L.nonceOf(Eve.addr))))
  tryBad(sign(B, { kind: 'contract-call', hash: 'old', contract: tpot, rule: 'claim', callArgs: {}, fee: '1' },
    contractCallMessage(NET, B.addr, tpot, 'claim', {}, L.nonceOf(B.addr))), /refused|guard/i, 'overwritten ticket — old winner is refused')
  const c1 = L.balanceOf(C.addr)
  push(sign(C, { kind: 'contract-call', hash: 'win', contract: tpot, rule: 'claim', callArgs: {}, fee: '1' },
    contractCallMessage(NET, C.addr, tpot, 'claim', {}, L.nonceOf(C.addr))))
  ok(L.balanceOf(C.addr) === c1 - 1n + 6n && L.contractAt(tpot)?.state.ticket === '0', 'new ticket claimed; ticket clears')

  // ── list: wrong slot / double ───────────────────────────────────────────
  push(sign(A, { kind: 'name', hash: 'n3', name: 'lst' }, nameMessageV2(NET, A.addr, L.nonceOf(A.addr), 'lst')))
  const listed = compileScroll({ each: '4', gate: 'list', locked: true, allow: [B.addr, C.addr] })
  const lh = sha256hex(canonicalCode(listed))
  const face3 = L.stars.createdSeq - 1n
  push(sign(A, { kind: 'contract', hash: 'ls', code: listed, star: face3.toString() }, contractMessageV2(NET, A.addr, lh, face3)))
  const lpot = contractAddress(lh, A.addr, L.appliedSeq)
  push(sign(A, { kind: 'transfer', hash: 'lf', to: lpot, amount: '8', fee: '1' }, transferMessage(NET, A.addr, lpot, 8n, L.nonceOf(A.addr))))
  tryBad(sign(B, { kind: 'contract-call', hash: 'slot', contract: lpot, rule: 'claim_1', callArgs: {}, fee: '1' },
    contractCallMessage(NET, B.addr, lpot, 'claim_1', {}, L.nonceOf(B.addr))), /refused|guard/i, 'B cannot claim C\'s slot')
  tryBad(sign(Eve, { kind: 'contract-call', hash: 'nope', contract: lpot, rule: 'claim_0', callArgs: {}, fee: '1' },
    contractCallMessage(NET, Eve.addr, lpot, 'claim_0', {}, L.nonceOf(Eve.addr))), /refused|guard/i, 'Eve is not on the list')
  push(sign(B, { kind: 'contract-call', hash: 'b0', contract: lpot, rule: 'claim_0', callArgs: {}, fee: '1' },
    contractCallMessage(NET, B.addr, lpot, 'claim_0', {}, L.nonceOf(B.addr))))
  tryBad(sign(B, { kind: 'contract-call', hash: 'b00', contract: lpot, rule: 'claim_0', callArgs: {}, fee: '1' },
    contractCallMessage(NET, B.addr, lpot, 'claim_0', {}, L.nonceOf(B.addr))), /refused|guard/i, 'double list claim')
  tryBad(sign(B, { kind: 'contract-call', hash: 'xclaim', contract: lpot, rule: 'claim', callArgs: {}, fee: '1' },
    contractCallMessage(NET, B.addr, lpot, 'claim', {}, L.nonceOf(B.addr))), /no rule|refused/i, 'open claim does not exist on a list scroll')

  // ── escrow doors ────────────────────────────────────────────────────────
  push(sign(A, { kind: 'name', hash: 'n4', name: 'deal' }, nameMessageV2(NET, A.addr, L.nonceOf(A.addr), 'deal')))
  const esc = compileEscrow({ buyer: B.addr, seller: C.addr, deadline: String(L.appliedSeq + 50) })
  const eh = sha256hex(canonicalCode(esc))
  const face4 = L.stars.createdSeq - 1n
  push(sign(A, { kind: 'contract', hash: 'es', code: esc, star: face4.toString() }, contractMessageV2(NET, A.addr, eh, face4)))
  const epot = contractAddress(eh, A.addr, L.appliedSeq)
  push(sign(A, { kind: 'transfer', hash: 'ef', to: epot, amount: '15', fee: '1' }, transferMessage(NET, A.addr, epot, 15n, L.nonceOf(A.addr))))
  tryBad(sign(C, { kind: 'contract-call', hash: 'sel', contract: epot, rule: 'accept', callArgs: {}, fee: '1' },
    contractCallMessage(NET, C.addr, epot, 'accept', {}, L.nonceOf(C.addr))), /refused|guard/i, 'seller cannot accept')
  tryBad(sign(A, { kind: 'contract-call', hash: 'own', contract: epot, rule: 'accept', callArgs: {}, fee: '1' },
    contractCallMessage(NET, A.addr, epot, 'accept', {}, L.nonceOf(A.addr))), /refused|guard/i, 'paper cannot accept')
  tryBad(sign(Eve, { kind: 'contract-call', hash: 'er', contract: epot, rule: 'refund', callArgs: {}, fee: '1' },
    contractCallMessage(NET, Eve.addr, epot, 'refund', {}, L.nonceOf(Eve.addr))), /refused|guard/i, 'refund before deadline')
  tryBad(sign(B, { kind: 'contract-call', hash: 'xrel', contract: epot, rule: 'release', callArgs: {}, fee: '1' },
    contractCallMessage(NET, B.addr, epot, 'release', {}, L.nonceOf(B.addr))), /no rule|refused/i, 'vest door on an escrow')
  push(sign(B, { kind: 'contract-call', hash: 'ok', contract: epot, rule: 'accept', callArgs: {}, fee: '1' },
    contractCallMessage(NET, B.addr, epot, 'accept', {}, L.nonceOf(B.addr))))
  tryBad(sign(B, { kind: 'contract-call', hash: 'again', contract: epot, rule: 'accept', callArgs: {}, fee: '1' },
    contractCallMessage(NET, B.addr, epot, 'accept', {}, L.nonceOf(B.addr))), /refused|guard/i, 'second accept')
  ok(L.balanceOf(epot) === 0n, 'escrow emptied to the sealed seller')

  // ── tunnel: zero, over, closed, sealed dest stays sealed ─────────────────
  push(sign(A, { kind: 'name', hash: 'n5', name: 'pipe' }, nameMessageV2(NET, A.addr, L.nonceOf(A.addr), 'pipe')))
  const tun = compileTunnel({ dest: C.addr })
  const th = sha256hex(canonicalCode(tun))
  const face5 = L.stars.createdSeq - 1n
  push(sign(A, { kind: 'contract', hash: 'tn', code: tun, star: face5.toString() }, contractMessageV2(NET, A.addr, th, face5)))
  const pipe = contractAddress(th, A.addr, L.appliedSeq)
  push(sign(A, { kind: 'transfer', hash: 'pf', to: pipe, amount: '20', fee: '1' }, transferMessage(NET, A.addr, pipe, 20n, L.nonceOf(A.addr))))
  tryBad(sign(A, { kind: 'contract-call', hash: 'zamt', contract: pipe, rule: 'punch', callArgs: { amount: '0' }, fee: '1' },
    contractCallMessage(NET, A.addr, pipe, 'punch', { amount: 0n }, L.nonceOf(A.addr))), /refused|guard/i, 'punch 0')
  tryBad(sign(A, { kind: 'contract-call', hash: 'big', contract: pipe, rule: 'punch', callArgs: { amount: '99' }, fee: '1' },
    contractCallMessage(NET, A.addr, pipe, 'punch', { amount: 99n }, L.nonceOf(A.addr))), /refused|guard/i, 'punch over balance')
  tryBad(sign(Eve, { kind: 'contract-call', hash: 'thief', contract: pipe, rule: 'punch', callArgs: { amount: '1' }, fee: '1' },
    contractCallMessage(NET, Eve.addr, pipe, 'punch', { amount: 1n }, L.nonceOf(Eve.addr))), /refused|guard|mouth/i, 'stranger punch')
  const c2 = L.balanceOf(C.addr)
  push(sign(A, { kind: 'contract-call', hash: 'p1', contract: pipe, rule: 'punch', callArgs: { amount: '7' }, fee: '1' },
    contractCallMessage(NET, A.addr, pipe, 'punch', { amount: 7n }, L.nonceOf(A.addr))))
  ok(L.balanceOf(C.addr) === c2 + 7n, 'sealed dest tunnel pays C, not the living owner')
  push(sign(A, { kind: 'transfer-star', hash: 'psale', to: Eve.addr, star: face5.toString(), fee: '1' },
    sendStarMessage(NET, A.addr, Eve.addr, face5, L.nonceOf(A.addr))))
  const c3 = L.balanceOf(C.addr)
  push(sign(Eve, { kind: 'contract-call', hash: 'p2', contract: pipe, rule: 'punch', callArgs: { amount: '3' }, fee: '1' },
    contractCallMessage(NET, Eve.addr, pipe, 'punch', { amount: 3n }, L.nonceOf(Eve.addr))))
  ok(L.balanceOf(C.addr) === c3 + 3n, 'after sale the sealed dest is still C — the tap moved, the dest did not')

  // ── protocol forgeries ──────────────────────────────────────────────────
  const nA = L.nonceOf(A.addr)
  tryBad({
    seq: L.appliedSeq + 1, kind: 'contract-call', hash: 'u', from: A.addr, contract: spot, rule: 'claim',
    callArgs: {}, fee: '1', nonce: nA,
  } as KrayEvent, /sig|scheme|signature/i, 'unsigned claim')
  tryBad(sign(A, { kind: 'contract-call', hash: 'fee2', contract: spot, rule: 'claim', callArgs: {}, fee: '2' },
    contractCallMessage(NET, A.addr, spot, 'claim', {}, nA), nA), /eternal 1|fee/i, 'fee 2')
  tryBad(sign(A, { kind: 'contract-call', hash: 'fee0', contract: spot, rule: 'claim', callArgs: {}, fee: '0' },
    contractCallMessage(NET, A.addr, spot, 'claim', {}, nA), nA), /eternal 1|fee/i, 'fee 0')
  const replay = sign(B, { kind: 'contract-call', hash: 'rp', contract: spot, rule: 'claim', callArgs: {}, fee: '1' },
    contractCallMessage(NET, B.addr, spot, 'claim', {}, 0), 0)
  tryBad(replay, /nonce/i, 'replayed nonce')
  tryBad(sign(Eve, {
    kind: 'contract-call', hash: 'forge', contract: pipe, rule: 'punch', callArgs: { amount: '1' }, fee: '1',
    payouts: [[Eve.addr, '999', '0']],
  }, contractCallMessage(NET, Eve.addr, pipe, 'punch', { amount: 1n }, L.nonceOf(Eve.addr))), /recorded|HALT|law/i, 'forged payouts on a call that would succeed')
  const v1code = compileScroll({ each: '1', max: '1', locked: true, gate: 'open' })
  const v1h = sha256hex(canonicalCode(v1code))
  tryBad(sign(A, { kind: 'contract', hash: 'mix', code: v1code, star: face1.toString() },
    contractMessage(NET, A.addr, v1h)), /v2|star|already|signature|scheme/i, 'v1 signature on a faced star')
  tryBad(sign(A, { kind: 'contract', hash: 'two', code: open, star: face1.toString() },
    contractMessageV2(NET, A.addr, oh, face1)), /already|leash/i, 'second law on the same star')
  tryBad(sign(A, { kind: 'contract-call', hash: 'badarg', contract: tpot, rule: 'stamp', callArgs: { id: '1.2' }, fee: '1' },
    contractCallMessage(NET, A.addr, tpot, 'stamp', { id: 1n }, L.nonceOf(A.addr))), /whole number|argument/i, 'fractional call arg')

  // ── unlocked scroll: collect travels with the face ───────────────────────
  push(sign(A, { kind: 'name', hash: 'n6', name: 'bag' }, nameMessageV2(NET, A.addr, L.nonceOf(A.addr), 'bag')))
  const bag = compileScroll({ each: '2', max: '9', locked: false, gate: 'open' })
  const bh = sha256hex(canonicalCode(bag))
  const face6 = L.stars.createdSeq - 1n
  push(sign(A, { kind: 'contract', hash: 'bg', code: bag, star: face6.toString() }, contractMessageV2(NET, A.addr, bh, face6)))
  const bpot = contractAddress(bh, A.addr, L.appliedSeq)
  push(sign(A, { kind: 'transfer', hash: 'bf', to: bpot, amount: '9', fee: '1' }, transferMessage(NET, A.addr, bpot, 9n, L.nonceOf(A.addr))))
  tryBad(sign(Eve, { kind: 'contract-call', hash: 'steal', contract: bpot, rule: 'collect', callArgs: {}, fee: '1' },
    contractCallMessage(NET, Eve.addr, bpot, 'collect', {}, L.nonceOf(Eve.addr))), /living owner|mouth/i, 'stranger collect on unlocked scroll')
  push(sign(A, { kind: 'transfer-star', hash: 'bsale', to: B.addr, star: face6.toString(), fee: '1' },
    sendStarMessage(NET, A.addr, B.addr, face6, L.nonceOf(A.addr))))
  tryBad(sign(A, { kind: 'contract-call', hash: 'oldc', contract: bpot, rule: 'collect', callArgs: {}, fee: '1' },
    contractCallMessage(NET, A.addr, bpot, 'collect', {}, L.nonceOf(A.addr))), /living owner|mouth/i, 'seller collect after sale')
  const b1 = L.balanceOf(B.addr)
  push(sign(B, { kind: 'contract-call', hash: 'take', contract: bpot, rule: 'collect', callArgs: {}, fee: '1' },
    contractCallMessage(NET, B.addr, bpot, 'collect', {}, L.nonceOf(B.addr))))
  ok(L.balanceOf(bpot) === 0n && L.balanceOf(B.addr) === b1 - 1n + 9n, 'buyer collected — mouth travelled; dest rewritten to living owner')

  // ── sybil: eight callers, conservation ──────────────────────────────────
  const sybils = Array.from({ length: 8 }, (_, i) => wallet('sy' + i))
  const S = new KrayLedger(undefined, NET)
  S.applyLive({ seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '500' } as KrayEvent)
  sybils.forEach((w, i) => S.applyLive({ seq: 2 + i, kind: 'donate', hash: 'd' + i, to: w.addr, amount: '5' } as KrayEvent))
  S.applyLive({
    seq: 10, kind: 'name', hash: 'ns', at: 0, from: A.addr, name: 'sybil', nonce: 0,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'sybil'), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const sy = compileScroll({ each: '3', max: '8', locked: true, gate: 'open' })
  const syh = sha256hex(canonicalCode(sy))
  S.applyLive({
    seq: 11, kind: 'contract', hash: 'sy', from: A.addr, code: sy, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, syh, 0n), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const sypot = contractAddress(syh, A.addr, 11)
  S.applyLive({
    seq: 12, kind: 'transfer', hash: 'in', from: A.addr, to: sypot, amount: '24', fee: '1', nonce: 1,
    publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, sypot, 24n, 1), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  sybils.forEach((w, i) => {
    S.applyLive({
      seq: 13 + i, kind: 'contract-call', hash: 'sy' + i, from: w.addr, contract: sypot, rule: 'claim',
      callArgs: {}, fee: '1', nonce: 0,
      publicKey: w.pk, signature: _signKrayWallet(contractCallMessage(NET, w.addr, sypot, 'claim', {}, 0), w.sk), scheme: 'kraywallet',
    } as KrayEvent)
  })
  ok(S.balanceOf(sypot) === 0n && S.contractAt(sypot)?.state.taken === '8', 'eight sybils each paid 1 ₭ and took 3 — pot empty at max')
  ok(S.conserves(), 'sybil storm conserves (fees to treasury, claims from the pot)')

  ok(L.conserves(), 'main play conserves')
  ok(validateContract(open).ok && validateContract(stamped).ok && validateContract(listed).ok, 'every compiled scroll still validates')

  const reboot = new KrayLedger(undefined, NET)
  for (const e of journal) reboot.applyLive(e)
  ok(reboot.cascadeRoot() === L.cascadeRoot(), 'adversarial journal reboot is byte-exact')
  ok(reboot.stars.merkleRoot() === L.stars.merkleRoot(), 'star merkle survives reboot')
  for (const addr of [vpot, spot, tpot, lpot, epot, pipe, bpot]) {
    const a = L.contractAt(addr), b = reboot.contractAt(addr)
    ok(!!a && !!b && JSON.stringify(a.state) === JSON.stringify(b.state) && L.balanceOf(addr) === reboot.balanceOf(addr),
      `pot ${addr.slice(13, 21)} state+balance survive`)
  }

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — ADVERSARIAL HOLDS: underfunded vest unlocks after top-up; locked scroll cannot collect; stamp mouth travels; list slots are sealed; every forgery freezes the cascade; eight sybils cannot mint; reboot is byte-exact. ⚖⭐`)
}
main()
