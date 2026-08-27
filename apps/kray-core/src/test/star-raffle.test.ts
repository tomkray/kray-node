/**
 * RAFFLE — every branch the desk promised, proven by breaking it.
 *   node src/test/star-raffle.test.ts
 *
 * enter (ticket + 1 ₭) · public settle (1 ₭ from the pot) · owner draw (full pot)
 * 0–1 tickets accumulate · overdue thin field still accepts enter (no freeze)
 * 2+ overdue refuses enter · mouth cannot name a winner · no collect · replay
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessageV2, contractCallMessage, contractCallMessageV2,
} from '../protocol/scheme.ts'
import { canonicalCode, isContractPotAddress, validateContract } from '../protocol/contract.ts'
import { compileForm, compileRaffle, isLivingTool, DEFAULT_RAFFLE_PERIOD } from '../protocol/star-forms.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
function wallet(tag: string) {
  const sk = createHash('sha256').update('star-raffle|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}

const A = wallet('A'), B = wallet('B'), C = wallet('C'), Eve = wallet('eve')
const clock = 1_700_000_000_000
const SEAL = 'cd'.repeat(32)

function fund(L: KrayLedger, journal: KrayEvent[]) {
  const evs: KrayEvent[] = [
    { seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '800' } as KrayEvent,
    { seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '200' } as KrayEvent,
    { seq: 3, kind: 'donate', hash: 'dc', to: C.addr, amount: '200' } as KrayEvent,
    { seq: 4, kind: 'donate', hash: 'de', to: Eve.addr, amount: '80' } as KrayEvent,
    {
      seq: 5, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'wheel', nonce: 0,
      publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'wheel'), A.sk), scheme: 'kraywallet',
    } as KrayEvent,
  ]
  for (const e of evs) { L.applyLive(e); journal.push(e) }
}
function hang(L: KrayLedger, journal: KrayEvent[], seats = '4') {
  const code = compileRaffle({ price: '5', period: '2', seats })
  const h = sha256hex(canonicalCode(code))
  const e = {
    seq: 6, kind: 'contract' as const, hash: 'raf', from: A.addr, code, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, h, 0n), A.sk), scheme: 'kraywallet' as const,
  }
  L.applyLive(e as KrayEvent)
  journal.push(e as KrayEvent)
  const pot = L.stars.star(0n)?.contract
  if (!pot) throw new Error('no pot')
  return pot
}
function v2(pot: string, w: ReturnType<typeof wallet>, rule: string, nonce: number, seq: number) {
  return {
    seq, kind: 'contract-call' as const, hash: 'x' + seq, from: w.addr, contract: pot, rule,
    callArgs: {}, fee: '1', nonce, clock,
    publicKey: w.pk,
    signature: _signKrayWallet(contractCallMessageV2(NET, w.addr, pot, rule, {}, nonce, clock), w.sk),
    scheme: 'kraywallet' as const,
  }
}
function apply(L: KrayLedger, journal: KrayEvent[], e: KrayEvent) {
  L.applyLive(e)
  journal.push(e)
}
function facesOf(L: KrayLedger, pot: string) {
  return (L.contractAt(pot)?.faces || []).filter(Boolean)
}
function rosterOk(L: KrayLedger, pot: string, m: string) {
  const taken = Number(L.contractAt(pot)?.state.taken || '0')
  ok(facesOf(L, pot).length === taken, m)
}

function main() {
  console.log('\n╔═ STAR RAFFLE — every promised branch, attacked ═╗\n')
  const def = compileRaffle({ price: '5' })
  ok(validateContract(def).ok, 'compiled IR validates')
  ok(!def.rules.some((r) => r.name === 'collect'), 'no collect — the owner cannot drain the pot')
  ok(def.vars?.period === String(DEFAULT_RAFFLE_PERIOD), 'default period is 100 Bitcoin seals')
  ok(def.rules.map((r) => r.name).join(',') === 'toggle_open,enter,settle,draw,skip', 'desk is toggle + enter + settle + draw + skip')
  ok(isLivingTool('draw') && isLivingTool('skip') && !isLivingTool('enter') && !isLivingTool('settle'), 'draw/skip are mouth; enter/settle are public')
  rejects(() => compileRaffle({ price: '0' }), /price/, 'price 0 is refused')
  rejects(() => compileRaffle({ price: '5', seats: '1' }), /seats/, 'one seat is refused')
  rejects(() => compileForm({ kind: 'raffle', price: '5', period: '0' }), /period/, 'period 0 is refused')

  // ── public settle: 3 tickets, pot pays 1 ₭ to the signer, rest to the beacon seat ──
  const J: KrayEvent[] = []
  const L = new KrayLedger(undefined, NET)
  fund(L, J)
  const pot = hang(L, J)
  ok(isContractPotAddress(pot), 'raffle hangs on a keyless pot')

  rejects(() => {
    L.applyLive({
      seq: 7, kind: 'contract-call', hash: 'v1', from: B.addr, contract: pot, rule: 'enter',
      callArgs: {}, fee: '1', nonce: 0,
      publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, pot, 'enter', {}, 0), B.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /v2 call|Bitcoin seal/i, 'a v1 enter is refused')
  rejects(() => {
    L.applyLive({
      seq: 7, kind: 'contract-call', hash: 'v1s', from: C.addr, contract: pot, rule: 'settle',
      callArgs: {}, fee: '1', nonce: 0,
      publicKey: C.pk, signature: _signKrayWallet(contractCallMessage(NET, C.addr, pot, 'settle', {}, 0), C.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /v2 call|Bitcoin seal/i, 'a v1 settle is refused')
  rejects(() => {
    L.applyLive(v2(pot, A, 'collect', 1, 7) as unknown as KrayEvent)
  }, /no rule/i, 'collect is not a rule — even the living owner cannot drain the pot')

  apply(L, J, v2(pot, B, 'enter', 0, 7) as unknown as KrayEvent)
  apply(L, J, v2(pot, C, 'enter', 0, 8) as unknown as KrayEvent)
  apply(L, J, v2(pot, Eve, 'enter', 0, 9) as unknown as KrayEvent)
  ok(L.balanceOf(pot) === 15n && L.contractAt(pot)?.state.taken === '3', 'three tickets — 15 ₭ in the pot')
  rosterOk(L, pot, 'roster length equals taken after three enters')

  rejects(() => { L.applyLive(v2(pot, A, 'draw', 1, 10) as unknown as KrayEvent) }, /refused|guard/i, 'draw before the seals is refused')
  rejects(() => { L.applyLive(v2(pot, Eve, 'draw', 1, 10) as unknown as KrayEvent) }, /living owner|mouth/i, 'a stranger cannot draw')
  rejects(() => { L.applyLive(v2(pot, Eve, 'skip', 1, 10) as unknown as KrayEvent) }, /living owner|mouth/i, 'a stranger cannot skip')
  rejects(() => { L.applyLive(v2(pot, C, 'settle', 1, 10) as unknown as KrayEvent) }, /refused|guard/i, 'settle before the seals is refused')

  apply(L, J, { seq: 10, kind: 'seal', hash: 's1', l1Txid: 'ab'.repeat(32), at: 0 } as KrayEvent)
  apply(L, J, { seq: 11, kind: 'seal', hash: 's2', l1Txid: SEAL, at: 0 } as KrayEvent)
  ok(L.bitcoinSeals === 2, 'two Bitcoin seals — the window is due')

  const seat = Number(BigInt('0x' + SEAL) % 3n)
  const winner = facesOf(L, pot)[seat]
  ok(!!winner && [B.addr, C.addr, Eve.addr].includes(winner), 'winner is beacon % taken — nobody named them')

  rejects(() => { L.applyLive(v2(pot, Eve, 'enter', 1, 12) as unknown as KrayEvent) }, /refused|guard/i, 'overdue field with 2+ tickets refuses enter — settle or draw only')

  const b0 = L.balanceOf(B.addr), c0 = L.balanceOf(C.addr), e0 = L.balanceOf(Eve.addr)
  apply(L, J, v2(pot, C, 'settle', 1, 12) as unknown as KrayEvent)
  ok(L.balanceOf(pot) === 0n, 'settle empties the pot')
  ok(L.contractAt(pot)?.state.taken === '0', 'roster resets')
  rosterOk(L, pot, 'faces wipe after a paying settle')
  if (winner === C.addr) ok(L.balanceOf(C.addr) === c0 + 14n, 'settler-winner nets 14 ₭ (fee back + prize)')
  else {
    ok(L.balanceOf(C.addr) === c0, 'settler is made whole — pot paid their 1 ₭ fee')
    ok(L.balanceOf(winner) === (winner === B.addr ? b0 : e0) + 14n, 'named seat received pot − 1 ₭')
  }
  ok(L.conserves(), 'conservation after public settle')

  rejects(() => { L.applyLive(v2(pot, C, 'settle', 2, 13) as unknown as KrayEvent) }, /refused|guard/i, 'settle twice in the new window is refused — due is in the future')

  apply(L, J, v2(pot, B, 'enter', 1, 13) as unknown as KrayEvent)
  ok(L.balanceOf(pot) === 5n && L.contractAt(pot)?.state.taken === '1', 'next window accepts a ticket — the loop is open')
  rosterOk(L, pot, 'one face after the next enter')
  ok(L.conserves(), 'conservation on the loop')

  const reboot = new KrayLedger(undefined, NET)
  for (const e of J) reboot.applyLive(e)
  ok(reboot.cascadeRoot() === L.cascadeRoot(), 'cold replay is byte-exact')
  ok(reboot.balanceOf(pot) === L.balanceOf(pot), 'pot survives replay')
  ok(reboot.contractAt(pot)?.state.taken === L.contractAt(pot)?.state.taken, 'taken survives replay')

  // ── owner draw pays the FULL pot ──
  const Oj: KrayEvent[] = []
  const Own = new KrayLedger(undefined, NET)
  fund(Own, Oj)
  const opot = hang(Own, Oj)
  apply(Own, Oj, v2(opot, B, 'enter', 0, 7) as unknown as KrayEvent)
  apply(Own, Oj, v2(opot, C, 'enter', 0, 8) as unknown as KrayEvent)
  apply(Own, Oj, v2(opot, Eve, 'enter', 0, 9) as unknown as KrayEvent)
  apply(Own, Oj, { seq: 10, kind: 'seal', hash: 's1', l1Txid: '11'.repeat(32), at: 0 } as KrayEvent)
  apply(Own, Oj, { seq: 11, kind: 'seal', hash: 's2', l1Txid: SEAL, at: 0 } as KrayEvent)
  const ow = facesOf(Own, opot)[Number(BigInt('0x' + SEAL) % 3n)]
  const ow0 = Own.balanceOf(ow)
  apply(Own, Oj, v2(opot, A, 'draw', 1, 12) as unknown as KrayEvent)
  ok(Own.balanceOf(opot) === 0n && Own.balanceOf(ow) === ow0 + 15n, 'owner draw pays the full 15 ₭ — no keeper cut')
  ok(Own.conserves(), 'conservation after owner draw')

  // ── 1 ticket: not a raffle. owner draw refuses. settle accumulates. ──
  const Tj: KrayEvent[] = []
  const Thin = new KrayLedger(undefined, NET)
  fund(Thin, Tj)
  const tpot = hang(Thin, Tj)
  apply(Thin, Tj, v2(tpot, B, 'enter', 0, 7) as unknown as KrayEvent)
  apply(Thin, Tj, { seq: 8, kind: 'seal', hash: 't1', l1Txid: '22'.repeat(32), at: 0 } as KrayEvent)
  apply(Thin, Tj, { seq: 9, kind: 'seal', hash: 't2', l1Txid: '33'.repeat(32), at: 0 } as KrayEvent)
  rejects(() => { Thin.applyLive(v2(tpot, A, 'draw', 1, 10) as unknown as KrayEvent) }, /refused|guard/i, 'owner cannot draw a one-ticket pot')
  const tb = Thin.balanceOf(B.addr), te = Thin.balanceOf(Eve.addr)
  apply(Thin, Tj, v2(tpot, Eve, 'settle', 0, 10) as unknown as KrayEvent)
  ok(Thin.balanceOf(tpot) === 5n && Thin.contractAt(tpot)?.state.taken === '1', 'one ticket accumulates — pot and seat stay')
  ok(facesOf(Thin, tpot)[0] === B.addr, 'the lonely face is still on the roster')
  ok(Thin.balanceOf(B.addr) === tb, 'the lone ticket did not win')
  ok(Thin.balanceOf(Eve.addr) === te - 1n, 'rolling a thin field costs the signer their own 1 ₭')
  ok(Thin.contractAt(tpot)?.state.due === '4', 'due rolls to interval + period')
  apply(Thin, Tj, v2(tpot, C, 'enter', 0, 11) as unknown as KrayEvent)
  ok(Thin.contractAt(tpot)?.state.taken === '2' && Thin.balanceOf(tpot) === 10n, 'a second ticket joins the accumulated pot')
  rosterOk(Thin, tpot, 'two faces after the join')
  ok(Thin.conserves(), 'conservation across accumulate')

  // ── FREEZE: overdue + 0 tickets must still accept enter (no settle required) ──
  const Ij: KrayEvent[] = []
  const Ice = new KrayLedger(undefined, NET)
  fund(Ice, Ij)
  const ipot = hang(Ice, Ij)
  apply(Ice, Ij, v2(ipot, B, 'enter', 0, 7) as unknown as KrayEvent)
  apply(Ice, Ij, v2(ipot, C, 'enter', 0, 8) as unknown as KrayEvent)
  apply(Ice, Ij, { seq: 9, kind: 'seal', hash: 'i1', l1Txid: '44'.repeat(32), at: 0 } as KrayEvent)
  apply(Ice, Ij, { seq: 10, kind: 'seal', hash: 'i2', l1Txid: '55'.repeat(32), at: 0 } as KrayEvent)
  apply(Ice, Ij, v2(ipot, Eve, 'settle', 0, 11) as unknown as KrayEvent)
  ok(Ice.contractAt(ipot)?.state.taken === '0' && Ice.balanceOf(ipot) === 0n, 'paid out — empty field, due is in the future')
  apply(Ice, Ij, { seq: 12, kind: 'seal', hash: 'i3', l1Txid: '66'.repeat(32), at: 0 } as KrayEvent)
  apply(Ice, Ij, { seq: 13, kind: 'seal', hash: 'i4', l1Txid: '77'.repeat(32), at: 0 } as KrayEvent)
  ok(Ice.bitcoinSeals === 4 && Ice.contractAt(ipot)?.state.due === '4', 'empty field is now overdue — this used to freeze enter')
  apply(Ice, Ij, v2(ipot, B, 'enter', 1, 14) as unknown as KrayEvent)
  ok(Ice.contractAt(ipot)?.state.taken === '1' && Ice.balanceOf(ipot) === 5n, 'overdue empty field still accepts enter — the desk did not freeze')
  ok(Ice.contractAt(ipot)?.state.due === '6', 'a late first ticket restarts the clock (interval + period)')
  rosterOk(Ice, ipot, 'one face after the unfreeze enter')
  ok(Ice.conserves(), 'conservation after unfreeze enter')

  // ── overdue + 1 ticket: second enter keeps due in the past, settle fires now ──
  const Lj: KrayEvent[] = []
  const Late = new KrayLedger(undefined, NET)
  fund(Late, Lj)
  const lpot = hang(Late, Lj)
  apply(Late, Lj, v2(lpot, B, 'enter', 0, 7) as unknown as KrayEvent)
  apply(Late, Lj, { seq: 8, kind: 'seal', hash: 'l1', l1Txid: '88'.repeat(32), at: 0 } as KrayEvent)
  apply(Late, Lj, { seq: 9, kind: 'seal', hash: 'l2', l1Txid: SEAL, at: 0 } as KrayEvent)
  ok(Late.contractAt(lpot)?.state.due === '2' && Late.bitcoinSeals === 2, 'one ticket, window due')
  apply(Late, Lj, v2(lpot, C, 'enter', 0, 10) as unknown as KrayEvent)
  ok(Late.contractAt(lpot)?.state.taken === '2' && Late.contractAt(lpot)?.state.due === '2', 'late second ticket keeps due in the past — settle is due now')
  const lateSeat = Number(BigInt('0x' + SEAL) % 2n)
  const lateWin = facesOf(Late, lpot)[lateSeat]
  const lw0 = Late.balanceOf(lateWin)
  const eve0 = Late.balanceOf(Eve.addr)
  apply(Late, Lj, v2(lpot, Eve, 'settle', 0, 11) as unknown as KrayEvent)
  ok(Late.balanceOf(lpot) === 0n, 'settle after the late join empties the pot')
  if (lateWin === Eve.addr) ok(Late.balanceOf(Eve.addr) === eve0 + 9n, 'settler-winner received 9 ₭')
  else {
    ok(Late.balanceOf(Eve.addr) === eve0, 'settler made whole from the pot')
    ok(Late.balanceOf(lateWin) === lw0 + 9n, 'winner received pot − 1 ₭')
  }
  ok(Late.conserves(), 'conservation after late-join settle')

  // ── owner skip on 1 ticket rolls the clock; same address may buy two seats ──
  const Sj: KrayEvent[] = []
  const Skip = new KrayLedger(undefined, NET)
  fund(Skip, Sj)
  const spot = hang(Skip, Sj, '2')
  apply(Skip, Sj, v2(spot, B, 'enter', 0, 7) as unknown as KrayEvent)
  apply(Skip, Sj, { seq: 8, kind: 'seal', hash: 'k1', l1Txid: '99'.repeat(32), at: 0 } as KrayEvent)
  apply(Skip, Sj, { seq: 9, kind: 'seal', hash: 'k2', l1Txid: 'aa'.repeat(32), at: 0 } as KrayEvent)
  apply(Skip, Sj, v2(spot, A, 'skip', 1, 10) as unknown as KrayEvent)
  ok(Skip.contractAt(spot)?.state.taken === '1' && Skip.balanceOf(spot) === 5n, 'owner skip on one ticket keeps the pot')
  ok(Skip.contractAt(spot)?.state.due === '4', 'skip rolls due')
  apply(Skip, Sj, v2(spot, B, 'enter', 1, 11) as unknown as KrayEvent)
  ok(Skip.contractAt(spot)?.state.taken === '2' && facesOf(Skip, spot).every((a) => a === B.addr), 'same face may hold two seats')
  rejects(() => { Skip.applyLive(v2(spot, C, 'enter', 0, 12) as unknown as KrayEvent) }, /refused|guard/i, 'seats are full — a third enter is refused')
  ok(Skip.conserves(), 'conservation on two-seat paper')

  // ── mouth can pause enter; settle still delivers ──
  const Pj: KrayEvent[] = []
  const Pause = new KrayLedger(undefined, NET)
  fund(Pause, Pj)
  const ppot = hang(Pause, Pj)
  apply(Pause, Pj, v2(ppot, B, 'enter', 0, 7) as unknown as KrayEvent)
  apply(Pause, Pj, v2(ppot, C, 'enter', 0, 8) as unknown as KrayEvent)
  apply(Pause, Pj, v2(ppot, A, 'toggle_open', 1, 9) as unknown as KrayEvent)
  ok(Pause.contractAt(ppot)?.state.open === '0', 'owner closed the door')
  rejects(() => { Pause.applyLive(v2(ppot, Eve, 'enter', 0, 10) as unknown as KrayEvent) }, /refused|guard/i, 'enter refuses while closed')
  apply(Pause, Pj, { seq: 10, kind: 'seal', hash: 'p1', l1Txid: 'b1'.repeat(32), at: 0 } as KrayEvent)
  apply(Pause, Pj, { seq: 11, kind: 'seal', hash: 'p2', l1Txid: SEAL, at: 0 } as KrayEvent)
  apply(Pause, Pj, v2(ppot, Eve, 'settle', 0, 12) as unknown as KrayEvent)
  ok(Pause.balanceOf(ppot) === 0n, 'settle still delivers while enter is closed — the pot cannot freeze')
  ok(Pause.conserves(), 'conservation after closed-door settle')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — RAFFLE HOLDS UNDER EVERY BRANCH: public settle, owner draw, 0–1 accumulate, overdue enter does not freeze, 2+ overdue closes enter, mouth cannot steal or name a winner, replay is byte-exact. ⚖⭐`)
}
main()
