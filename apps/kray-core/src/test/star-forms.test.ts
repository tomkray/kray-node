/**
 * SEALED FORMS — escrow · tunnel · vest · scroll on the same IR.
 *   node src/test/star-forms.test.ts
 *
 * A star may wear a deal. The living owner keeps toggle/collect/stamp.
 * The sealed buyer accepts. A scroll pays the caller. A stranger cannot steal.
 * Reboot is byte-exact.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessageV2, contractCallMessage, transferMessage, sendStarMessage,
} from '../protocol/scheme.ts'
import { canonicalCode, contractAddress, validateContract } from '../protocol/contract.ts'
import { compileEscrow, compileTunnel, compileVest, compileScroll, compileForm, compileMint, isMintPaper, isLivingTool } from '../protocol/star-forms.ts'
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
  const sk = createHash('sha256').update('star-forms|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}

function main() {
  console.log('\n╔═ STAR FORMS — escrow · tunnel · vest · scroll ═╗\n')
  const A = wallet('A'), B = wallet('B'), C = wallet('C'), Eve = wallet('eve')

  const esc = compileEscrow({ buyer: B.addr, seller: C.addr, deadline: '20' })
  ok(validateContract(esc).ok && esc.rules.map((r) => r.name).join(',') === 'accept,refund', 'escrow compiles to accept + refund')
  rejects(() => compileEscrow({ buyer: B.addr, seller: B.addr, deadline: '20' }), /differ/, 'escrow refuses buyer === seller')
  const tun = compileTunnel({})
  ok(tun.rules.some((r) => r.name === 'punch') && tun.rules.some((r) => r.name === 'toggle_open'), 'tunnel compiles to tap + punch')
  const vest = compileVest({ beneficiary: C.addr, start: '10', duration: '10', total: '100' })
  ok(vest.rules[0].name === 'release', 'vest compiles to release')
  rejects(() => compileForm({ kind: 'nope' } as never), /unknown kind/, 'unknown form is refused')
  ok(isMintPaper(compileMint({ price: '1', max: '4' })) && compileForm({ kind: 'mint', price: '1', max: '4' }).rules.some((r) => r.name === 'mint'), 'mint compiles on the same IR')

  const L = new KrayLedger(undefined, NET)
  L.applyLive({ seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '500' } as KrayEvent)
  L.applyLive({ seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '40' } as KrayEvent)
  L.applyLive({ seq: 3, kind: 'donate', hash: 'de', to: Eve.addr, amount: '10' } as KrayEvent)
  L.applyLive({
    seq: 4, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'deal', nonce: 0,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'deal'), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const eh = sha256hex(canonicalCode(esc))
  L.applyLive({
    seq: 5, kind: 'contract', hash: 'esc', from: A.addr, code: esc, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, eh, 0n), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const pot = contractAddress(eh, A.addr, 5)
  L.applyLive({
    seq: 6, kind: 'transfer', hash: 'fund', from: A.addr, to: pot, amount: '80', fee: '1', nonce: 1,
    publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, pot, 80n, 1), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L.balanceOf(pot) === 80n, 'the deal pot holds 80 ₭ — keyless')

  rejects(() => {
    L.applyLive({
      seq: 7, kind: 'contract-call', hash: 'eve', from: Eve.addr, contract: pot, rule: 'accept',
      callArgs: {}, fee: '1', nonce: 0,
      publicKey: Eve.pk, signature: _signKrayWallet(contractCallMessage(NET, Eve.addr, pot, 'accept', {}, 0), Eve.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /refused|guard/i, 'Eve cannot accept — she is not the sealed buyer')
  rejects(() => {
    L.applyLive({
      seq: 7, kind: 'contract-call', hash: 'own', from: A.addr, contract: pot, rule: 'accept',
      callArgs: {}, fee: '1', nonce: 2,
      publicKey: A.pk, signature: _signKrayWallet(contractCallMessage(NET, A.addr, pot, 'accept', {}, 2), A.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /refused|guard/i, 'the star owner cannot accept — the face is not the buyer')

  const c0 = L.balanceOf(C.addr)
  L.applyLive({
    seq: 7, kind: 'contract-call', hash: 'ok', from: B.addr, contract: pot, rule: 'accept',
    callArgs: {}, fee: '1', nonce: 0,
    publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, pot, 'accept', {}, 0), B.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L.balanceOf(pot) === 0n && L.balanceOf(C.addr) === c0 + 80n, 'buyer accepted — 80 ₭ paid the sealed seller')
  ok(L.contractAt(pot)?.state.settled === '1', 'settled is 1 — paid twice is refused forever')
  rejects(() => {
    L.applyLive({
      seq: 8, kind: 'contract-call', hash: 'again', from: B.addr, contract: pot, rule: 'accept',
      callArgs: {}, fee: '1', nonce: 1,
      publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, pot, 'accept', {}, 1), B.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /refused|guard/i, 'second accept is refused')

  // tunnel that follows the face
  const T = new KrayLedger(undefined, NET)
  T.applyLive({ seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '400' } as KrayEvent)
  T.applyLive({ seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '30' } as KrayEvent)
  T.applyLive({
    seq: 3, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'pipe', nonce: 0,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'pipe'), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const follow = compileTunnel({})
  const th = sha256hex(canonicalCode(follow))
  T.applyLive({
    seq: 4, kind: 'contract', hash: 'tun', from: A.addr, code: follow, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, th, 0n), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const tpot = contractAddress(th, A.addr, 4)
  T.applyLive({
    seq: 5, kind: 'transfer', hash: 'in', from: A.addr, to: tpot, amount: '60', fee: '1', nonce: 1,
    publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, tpot, 60n, 1), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  rejects(() => {
    T.applyLive({
      seq: 6, kind: 'contract-call', hash: 'thief', from: B.addr, contract: tpot, rule: 'punch',
      callArgs: { amount: '10' }, fee: '1', nonce: 0,
      publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, tpot, 'punch', { amount: 10n }, 0), B.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /refused|guard/i, 'a stranger cannot punch the tunnel')
  const a0 = T.balanceOf(A.addr)
  T.applyLive({
    seq: 6, kind: 'contract-call', hash: 'p', from: A.addr, contract: tpot, rule: 'punch',
    callArgs: { amount: '15' }, fee: '1', nonce: 2,
    publicKey: A.pk, signature: _signKrayWallet(contractCallMessage(NET, A.addr, tpot, 'punch', { amount: 15n }, 2), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(T.balanceOf(tpot) === 45n && T.balanceOf(A.addr) === a0 - 1n + 15n, 'owner punched 15 ₭ to themselves — the corridor follows the face')
  T.applyLive({
    seq: 7, kind: 'transfer-star', hash: 'sale', from: A.addr, to: B.addr, star: '0', fee: '1', nonce: 3,
    publicKey: A.pk, signature: _signKrayWallet(sendStarMessage(NET, A.addr, B.addr, 0n, 3), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  rejects(() => {
    T.applyLive({
      seq: 8, kind: 'contract-call', hash: 'ghost', from: A.addr, contract: tpot, rule: 'punch',
      callArgs: { amount: '10' }, fee: '1', nonce: 4,
      publicKey: A.pk, signature: _signKrayWallet(contractCallMessage(NET, A.addr, tpot, 'punch', { amount: 10n }, 4), A.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /refused|guard/i, 'seller lost the tap — punch refuses')
  const b0 = T.balanceOf(B.addr)
  T.applyLive({
    seq: 8, kind: 'contract-call', hash: 'new', from: B.addr, contract: tpot, rule: 'punch',
    callArgs: { amount: '20' }, fee: '1', nonce: 0,
    publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, tpot, 'punch', { amount: 20n }, 0), B.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(T.balanceOf(tpot) === 25n && T.balanceOf(B.addr) === b0 - 1n + 20n, 'the buyer punched — the mouth travelled with the face')
  ok(T.conserves(), 'tunnel sale conserves')

  // vest — half at mid height
  const V = new KrayLedger(undefined, NET)
  const vFund: KrayEvent[] = [
    { seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '400' } as KrayEvent,
    { seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '20' } as KrayEvent,
    { seq: 3, kind: 'donate', hash: 'de', to: Eve.addr, amount: '20' } as KrayEvent,
  ]
  for (const e of vFund) V.applyLive(e)
  V.applyLive({
    seq: 4, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'vest', nonce: 0,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'vest'), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const vc = compileVest({ beneficiary: C.addr, start: '5', duration: '10', total: '100' })
  const vh = sha256hex(canonicalCode(vc))
  V.applyLive({
    seq: 5, kind: 'contract', hash: 'v', from: A.addr, code: vc, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, vh, 0n), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const vpot = contractAddress(vh, A.addr, 5)
  V.applyLive({
    seq: 6, kind: 'transfer', hash: 'in', from: A.addr, to: vpot, amount: '100', fee: '1', nonce: 1,
    publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, vpot, 100n, 1), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  V.applyLive({
    seq: 10, kind: 'contract-call', hash: 'rel', from: B.addr, contract: vpot, rule: 'release',
    callArgs: {}, fee: '1', nonce: 0,
    publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, vpot, 'release', {}, 0), B.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(V.balanceOf(C.addr) === 50n && V.balanceOf(vpot) === 50n, 'mid-schedule release pays exactly half to the beneficiary — the caller is not the payee')
  V.applyLive({
    seq: 20, kind: 'contract-call', hash: 'rel2', from: Eve.addr, contract: vpot, rule: 'release',
    callArgs: {}, fee: '1', nonce: 0,
    publicKey: Eve.pk, signature: _signKrayWallet(contractCallMessage(NET, Eve.addr, vpot, 'release', {}, 0), Eve.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(V.balanceOf(C.addr) === 100n && V.balanceOf(vpot) === 0n, 'later release pays the rest — still to C, never to the caller')
  ok(V.conserves(), 'vest conserves')

  const reboot = new KrayLedger(undefined, NET)
  const journal: KrayEvent[] = [
    ...vFund,
    {
      seq: 4, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'vest', nonce: 0,
      publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'vest'), A.sk), scheme: 'kraywallet',
    } as KrayEvent,
    {
      seq: 5, kind: 'contract', hash: 'v', from: A.addr, code: vc, star: '0',
      publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, vh, 0n), A.sk), scheme: 'kraywallet',
    } as KrayEvent,
    {
      seq: 6, kind: 'transfer', hash: 'in', from: A.addr, to: vpot, amount: '100', fee: '1', nonce: 1,
      publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, vpot, 100n, 1), A.sk), scheme: 'kraywallet',
    } as KrayEvent,
    {
      seq: 10, kind: 'contract-call', hash: 'rel', from: B.addr, contract: vpot, rule: 'release',
      callArgs: {}, fee: '1', nonce: 0,
      publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, vpot, 'release', {}, 0), B.sk), scheme: 'kraywallet',
    } as KrayEvent,
    {
      seq: 20, kind: 'contract-call', hash: 'rel2', from: Eve.addr, contract: vpot, rule: 'release',
      callArgs: {}, fee: '1', nonce: 0,
      publicKey: Eve.pk, signature: _signKrayWallet(contractCallMessage(NET, Eve.addr, vpot, 'release', {}, 0), Eve.sk), scheme: 'kraywallet',
    } as KrayEvent,
  ]
  for (const e of journal) reboot.applyLive(e)
  ok(reboot.cascadeRoot() === V.cascadeRoot(), 'vest reboot cascade is byte-exact')
  ok(reboot.balanceOf(C.addr) === 100n, 'beneficiary balance survives replay')

  ok(isLivingTool('stamp') && isLivingTool('toggle_open') && isLivingTool('once_valid') && isLivingTool('collect') && !isLivingTool('claim'),
    'stamp / toggle_* / once_* / collect are living mouth; claim is a door')
  const openLocked = compileScroll({ each: '4', max: '2', locked: true, gate: 'open' })
  ok(validateContract(openLocked).ok && openLocked.rules.map((r) => r.name).join(',') === 'toggle_open,claim',
    'locked open scroll has no collect — ₭ leaves only through claim')
  rejects(() => compileScroll({ each: '0', max: '2', gate: 'open' }), /greater than 0/, 'each=0 is refused')
  rejects(() => compileScroll({ each: '1', max: '1', gate: 'list', allow: [] }), /at least one/, 'empty list is refused')
  rejects(() => compileScroll({ each: '1', max: '1', gate: 'list', allow: [B.addr, C.addr] }), /equal the allow/, 'list max must match allow length')
  const listed = compileScroll({ each: '3', gate: 'list', locked: true, allow: [B.addr, C.addr] })
  ok(listed.rules.some((r) => r.name === 'claim_0') && listed.rules.some((r) => r.name === 'claim_1') && !listed.rules.some((r) => r.name === 'collect'),
    'list scroll compiles one claim door per sealed address')

  const S = new KrayLedger(undefined, NET)
  S.applyLive({ seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '400' } as KrayEvent)
  S.applyLive({ seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '20' } as KrayEvent)
  S.applyLive({ seq: 3, kind: 'donate', hash: 'de', to: Eve.addr, amount: '20' } as KrayEvent)
  S.applyLive({
    seq: 4, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'scroll', nonce: 0,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'scroll'), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const sh = sha256hex(canonicalCode(openLocked))
  S.applyLive({
    seq: 5, kind: 'contract', hash: 'sc', from: A.addr, code: openLocked, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, sh, 0n), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const spot = contractAddress(sh, A.addr, 5)
  S.applyLive({
    seq: 6, kind: 'transfer', hash: 'in', from: A.addr, to: spot, amount: '8', fee: '1', nonce: 1,
    publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, spot, 8n, 1), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  rejects(() => {
    S.applyLive({
      seq: 7, kind: 'contract-call', hash: 'nocol', from: A.addr, contract: spot, rule: 'collect',
      callArgs: {}, fee: '1', nonce: 2,
      publicKey: A.pk, signature: _signKrayWallet(contractCallMessage(NET, A.addr, spot, 'collect', {}, 2), A.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /no rule|refused/i, 'locked scroll has no collect — the owner cannot drain the pot')
  const eve0 = S.balanceOf(Eve.addr)
  S.applyLive({
    seq: 7, kind: 'contract-call', hash: 'cl1', from: Eve.addr, contract: spot, rule: 'claim',
    callArgs: {}, fee: '1', nonce: 0,
    publicKey: Eve.pk, signature: _signKrayWallet(contractCallMessage(NET, Eve.addr, spot, 'claim', {}, 0), Eve.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(S.balanceOf(Eve.addr) === eve0 - 1n + 4n && S.balanceOf(spot) === 4n, 'open claim pays the caller 4 ₭ — not a sealed dest')
  const b0s = S.balanceOf(B.addr)
  S.applyLive({
    seq: 8, kind: 'contract-call', hash: 'cl2', from: B.addr, contract: spot, rule: 'claim',
    callArgs: {}, fee: '1', nonce: 0,
    publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, spot, 'claim', {}, 0), B.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(S.balanceOf(B.addr) === b0s - 1n + 4n && S.balanceOf(spot) === 0n, 'second claim empties the pot at max')
  rejects(() => {
    S.applyLive({
      seq: 9, kind: 'contract-call', hash: 'cl3', from: Eve.addr, contract: spot, rule: 'claim',
      callArgs: {}, fee: '1', nonce: 1,
      publicKey: Eve.pk, signature: _signKrayWallet(contractCallMessage(NET, Eve.addr, spot, 'claim', {}, 1), Eve.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /refused|guard/i, 'a third claim is refused — taken == max')
  ok(S.conserves(), 'open scroll conserves')

  const T2 = new KrayLedger(undefined, NET)
  T2.applyLive({ seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '300' } as KrayEvent)
  T2.applyLive({ seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '20' } as KrayEvent)
  T2.applyLive({ seq: 3, kind: 'donate', hash: 'de', to: Eve.addr, amount: '10' } as KrayEvent)
  T2.applyLive({
    seq: 4, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'ticket', nonce: 0,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'ticket'), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const stamped = compileScroll({ each: '7', max: '1', locked: true, gate: 'stamp' })
  const sth = sha256hex(canonicalCode(stamped))
  T2.applyLive({
    seq: 5, kind: 'contract', hash: 'st', from: A.addr, code: stamped, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, sth, 0n), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const tpot2 = contractAddress(sth, A.addr, 5)
  T2.applyLive({
    seq: 6, kind: 'transfer', hash: 'in', from: A.addr, to: tpot2, amount: '7', fee: '1', nonce: 1,
    publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, tpot2, 7n, 1), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  rejects(() => {
    T2.applyLive({
      seq: 7, kind: 'contract-call', hash: 'ghost', from: Eve.addr, contract: tpot2, rule: 'stamp',
      callArgs: { id: callerInt(Eve.addr) }, fee: '1', nonce: 0,
      publicKey: Eve.pk, signature: _signKrayWallet(contractCallMessage(NET, Eve.addr, tpot2, 'stamp', { id: BigInt(callerInt(Eve.addr)) }, 0), Eve.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /living owner|mouth|refused/i, 'Eve cannot stamp — the mouth travels with the face')
  rejects(() => {
    T2.applyLive({
      seq: 7, kind: 'contract-call', hash: 'early', from: B.addr, contract: tpot2, rule: 'claim',
      callArgs: {}, fee: '1', nonce: 0,
      publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, tpot2, 'claim', {}, 0), B.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /refused|guard/i, 'claim before stamp is refused')
  T2.applyLive({
    seq: 7, kind: 'contract-call', hash: 'mark', from: A.addr, contract: tpot2, rule: 'stamp',
    callArgs: { id: callerInt(B.addr) }, fee: '1', nonce: 2,
    publicKey: A.pk, signature: _signKrayWallet(contractCallMessage(NET, A.addr, tpot2, 'stamp', { id: BigInt(callerInt(B.addr)) }, 2), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  rejects(() => {
    T2.applyLive({
      seq: 8, kind: 'contract-call', hash: 'wrong', from: Eve.addr, contract: tpot2, rule: 'claim',
      callArgs: {}, fee: '1', nonce: 0,
      publicKey: Eve.pk, signature: _signKrayWallet(contractCallMessage(NET, Eve.addr, tpot2, 'claim', {}, 0), Eve.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /refused|guard/i, 'the ticket is B — Eve cannot claim')
  const b1 = T2.balanceOf(B.addr)
  T2.applyLive({
    seq: 8, kind: 'contract-call', hash: 'win', from: B.addr, contract: tpot2, rule: 'claim',
    callArgs: {}, fee: '1', nonce: 0,
    publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, tpot2, 'claim', {}, 0), B.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(T2.balanceOf(B.addr) === b1 - 1n + 7n && T2.balanceOf(tpot2) === 0n, 'stamped winner claimed — paid the caller')
  ok(T2.contractAt(tpot2)?.state.ticket === '0', 'ticket clears after claim')
  ok(T2.conserves(), 'stamp scroll conserves')

  const L2 = new KrayLedger(undefined, NET)
  L2.applyLive({ seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '200' } as KrayEvent)
  L2.applyLive({ seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '10' } as KrayEvent)
  L2.applyLive({ seq: 3, kind: 'donate', hash: 'de', to: Eve.addr, amount: '10' } as KrayEvent)
  L2.applyLive({
    seq: 4, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'list', nonce: 0,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'list'), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const lh = sha256hex(canonicalCode(listed))
  L2.applyLive({
    seq: 5, kind: 'contract', hash: 'ls', from: A.addr, code: listed, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, lh, 0n), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const lpot = contractAddress(lh, A.addr, 5)
  L2.applyLive({
    seq: 6, kind: 'transfer', hash: 'in', from: A.addr, to: lpot, amount: '6', fee: '1', nonce: 1,
    publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, lpot, 6n, 1), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  rejects(() => {
    L2.applyLive({
      seq: 7, kind: 'contract-call', hash: 'no', from: Eve.addr, contract: lpot, rule: 'claim_0',
      callArgs: {}, fee: '1', nonce: 0,
      publicKey: Eve.pk, signature: _signKrayWallet(contractCallMessage(NET, Eve.addr, lpot, 'claim_0', {}, 0), Eve.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /refused|guard/i, 'Eve is not on the list')
  const b2 = L2.balanceOf(B.addr)
  L2.applyLive({
    seq: 7, kind: 'contract-call', hash: 'yes', from: B.addr, contract: lpot, rule: 'claim_0',
    callArgs: {}, fee: '1', nonce: 0,
    publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, lpot, 'claim_0', {}, 0), B.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L2.balanceOf(B.addr) === b2 - 1n + 3n && L2.contractAt(lpot)?.state.c0 === '1', 'listed address claimed once')
  rejects(() => {
    L2.applyLive({
      seq: 8, kind: 'contract-call', hash: 'twice', from: B.addr, contract: lpot, rule: 'claim_0',
      callArgs: {}, fee: '1', nonce: 1,
      publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, lpot, 'claim_0', {}, 1), B.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /refused|guard/i, 'a second claim on the same slot is refused')
  ok(L2.conserves(), 'list scroll conserves')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — FORMS HOLD: escrow pays the seller only when the buyer signs; the tunnel tap travels with the face; vest pays the beneficiary on journal height; a scroll pays the caller through a mathematical door — never a secret key. Same IR. No second machine. ⚖⭐`)
}
main()
