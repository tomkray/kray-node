/**
 * RAFFLE SWARM — prove by breaking. The hostile remainder.
 *   node src/test/star-raffle-swarm.test.ts
 *
 * star-raffle.test.ts pins the promised branches. This file attacks
 * everything else: fee, nonce, signature, v1 pot, empty draw, skip on a
 * full field, fake payouts, pot drain, race settle, catalog knobs,
 * random seeds, cold replay.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessage, contractMessageV2, contractCallMessageV2, transferMessage,
} from '../protocol/scheme.ts'
import { canonicalCode, contractAddress } from '../protocol/contract.ts'
import { examContract } from '../protocol/contract-exam.ts'
import { compileForm, compileRaffle } from '../protocol/star-forms.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
function wallet(tag: string) {
  const sk = createHash('sha256').update('star-raffle-swarm|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
type W = ReturnType<typeof wallet>

const A = wallet('A'), B = wallet('B'), C = wallet('C'), Eve = wallet('eve')
const clock = 1_700_000_000_000
const SEAL = 'cd'.repeat(32)

function fund(L: KrayLedger, journal: KrayEvent[]) {
  const evs: KrayEvent[] = [
    { seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '900' } as KrayEvent,
    { seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '80' } as KrayEvent,
    { seq: 3, kind: 'donate', hash: 'dc', to: C.addr, amount: '80' } as KrayEvent,
    { seq: 4, kind: 'donate', hash: 'de', to: Eve.addr, amount: '40' } as KrayEvent,
    {
      seq: 5, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'swarmwheel', nonce: 0,
      publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'swarmwheel'), A.sk), scheme: 'kraywallet',
    } as KrayEvent,
  ]
  for (const e of evs) { L.applyLive(e); journal.push(e) }
}
function hang(L: KrayLedger, journal: KrayEvent[], seats = '4', period = '2') {
  const code = compileRaffle({ price: '5', period, seats })
  const h = sha256hex(canonicalCode(code))
  const seq = L.appliedSeq + 1
  const e = {
    seq, kind: 'contract' as const, hash: 'raf' + seq, from: A.addr, code, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, h, 0n), A.sk), scheme: 'kraywallet' as const,
  }
  L.applyLive(e as KrayEvent)
  journal.push(e as KrayEvent)
  const pot = L.stars.star(0n)?.contract
  if (!pot) throw new Error('no pot')
  return pot
}
function v2(pot: string, w: W, rule: string, nonce: number, seq: number, extra?: { fee?: string; payouts?: [string, string][] }) {
  const fee = extra?.fee ?? '1'
  const e: Record<string, unknown> = {
    seq, kind: 'contract-call', hash: 'x' + seq, from: w.addr, contract: pot, rule,
    callArgs: {}, fee, nonce, clock,
    publicKey: w.pk,
    signature: _signKrayWallet(contractCallMessageV2(NET, w.addr, pot, rule, {}, nonce, clock), w.sk),
    scheme: 'kraywallet',
  }
  if (extra?.payouts) e.payouts = extra.payouts
  return e as unknown as KrayEvent
}
function apply(L: KrayLedger, journal: KrayEvent[], e: KrayEvent) {
  L.applyLive(e)
  journal.push(e)
}
function faces(L: KrayLedger, pot: string) {
  return (L.contractAt(pot)?.faces || []).filter(Boolean)
}
function nxt(L: KrayLedger) { return L.appliedSeq + 1 }

function main() {
  console.log('\n╔═ STAR RAFFLE SWARM — hostile remainder · catalog · seeds ═╗\n')

  const dry = examContract(compileRaffle({ price: '5', period: '100', seats: '8' }))
  ok(dry.ready && dry.checks.every((c) => c.kind !== 'fail'), 'exam of the catalog knobs is ready — no crash')
  ok(!(dry.code.rules || []).some((r) => r.name === 'collect'), 'exam paper still has no collect')
  rejects(() => compileForm({ kind: 'raffle', price: '5', seats: '9' }), /seats/, 'nine seats is refused')
  rejects(() => compileForm({ kind: 'raffle', price: '-1' }), /whole|price|form/i, 'negative ticket is refused')
  rejects(() => compileForm({ kind: 'raffle', price: '5', period: '1.5' }), /whole|period|form/i, 'fractional period is refused')

  const J: KrayEvent[] = []
  const L = new KrayLedger(undefined, NET)
  fund(L, J)
  const pot = hang(L, J)
  const root0 = L.cascadeRoot()
  ok(L.conserves(), 'conservation after hang')

  rejects(() => { L.applyLive(v2(pot, B, 'enter', 0, nxt(L), { fee: '0' })) }, /1-₭ fee|exactly one/i, 'enter with fee 0 is refused')
  rejects(() => { L.applyLive(v2(pot, B, 'enter', 0, nxt(L), { fee: '2' })) }, /1-₭ fee|exactly one/i, 'enter with fee 2 is refused')
  ok(L.cascadeRoot() === root0 && L.conserves(), 'bad fees leave the journal untouched')

  const enterB = v2(pot, B, 'enter', 0, nxt(L))
  apply(L, J, enterB)
  rejects(() => { L.applyLive(v2(pot, B, 'enter', 0, nxt(L))) }, /nonce/i, 'the same nonce cannot buy a second seat')

  const forged = {
    ...v2(pot, C, 'enter', 0, nxt(L)),
    signature: _signKrayWallet(contractCallMessageV2(NET, Eve.addr, pot, 'enter', {}, 0, clock), Eve.sk),
  } as KrayEvent
  rejects(() => { L.applyLive(forged) }, /signature|forged|wrong key/i, 'a stolen signature does not enter')

  const broke = wallet('broke')
  rejects(() => { L.applyLive(v2(pot, broke, 'enter', 0, nxt(L))) }, /gas|ticket|insufficient/i, 'an empty wallet cannot buy a seat')
  rejects(() => { L.applyLive(v2(pot, Eve, 'toggle_open', 0, nxt(L))) }, /living owner|mouth|guard/i, 'a stranger cannot close the door')

  const v1code = compileRaffle({ price: '5', period: '2', seats: '3' })
  const v1h = sha256hex(canonicalCode(v1code))
  const v1e = {
    seq: nxt(L), kind: 'contract' as const, hash: 'v1p', from: A.addr, code: v1code,
    publicKey: A.pk, signature: _signKrayWallet(contractMessage(NET, A.addr, v1h), A.sk), scheme: 'kraywallet' as const,
  }
  apply(L, J, v1e as KrayEvent)
  const v1pot = contractAddress(v1h, A.addr, v1e.seq)
  ok(!!L.contractAt(v1pot) && L.stars.star(0n)?.contract === pot, 'v1 raffle IR sealed as a keyless pot — the live face still holds the v2 wheel')
  rejects(() => { L.applyLive(v2(v1pot, C, 'enter', 0, nxt(L))) }, /needs a star/i, 'a v1 raffle pot refuses enter — no face, no clock, no mouth')

  apply(L, J, v2(pot, C, 'enter', 0, nxt(L)))
  ok(L.contractAt(pot)?.state.taken === '2' && L.balanceOf(pot) === 10n, 'two tickets on the live pot')

  apply(L, J, { seq: nxt(L), kind: 'seal', hash: 's1', l1Txid: 'ab'.repeat(32), at: 0 } as KrayEvent)
  apply(L, J, { seq: nxt(L), kind: 'seal', hash: 's2', l1Txid: SEAL, at: 0 } as KrayEvent)

  rejects(() => { L.applyLive(v2(pot, A, 'skip', 1, nxt(L))) }, /guard|refused/i, 'owner skip on a 2-ticket field is refused — that is a prize')
  rejects(() => { L.applyLive(v2(pot, Eve, 'settle', 0, nxt(L), { payouts: [[Eve.addr, '10']] })) }, /recorded|HALT/i, 'a journaled fake winner HALTs — the reducer re-derives the pays')

  const drain = {
    seq: nxt(L), kind: 'transfer' as const, hash: 'drain', from: pot, to: Eve.addr, amount: '10', fee: '1', nonce: 0,
    publicKey: Eve.pk, signature: _signKrayWallet(transferMessage(NET, pot, Eve.addr, 10n, 0), Eve.sk), scheme: 'kraywallet' as const,
  }
  rejects(() => { L.applyLive(drain as KrayEvent) }, /protocol pot|cannot transfer|own rules/i, 'nobody can transfer from the pot — only its rules move ₭')

  const winSeat = Number(BigInt('0x' + SEAL) % 2n)
  const winner = faces(L, pot)[winSeat]
  const eve0 = L.balanceOf(Eve.addr)
  const w0 = L.balanceOf(winner)
  apply(L, J, v2(pot, Eve, 'settle', 0, nxt(L)))
  ok(L.balanceOf(pot) === 0n, 'honest settle empties the pot')
  if (winner === Eve.addr) ok(L.balanceOf(Eve.addr) === eve0 + 9n, 'settler-winner nets pot − 1 ₭')
  else {
    ok(L.balanceOf(Eve.addr) === eve0, 'settler is made whole')
    ok(L.balanceOf(winner) === w0 + 9n, 'beacon seat received pot − 1 ₭')
  }
  ok(L.conserves(), 'conservation after honest settle')

  rejects(() => { L.applyLive(v2(pot, Eve, 'settle', 1, nxt(L))) }, /guard|refused/i, 'second settle in the new window is refused')
  rejects(() => { L.applyLive(v2(pot, A, 'draw', 1, nxt(L))) }, /guard|refused/i, 'draw on an empty field is refused')

  const reboot = new KrayLedger(undefined, NET)
  for (const e of J) reboot.applyLive(e)
  ok(reboot.cascadeRoot() === L.cascadeRoot(), 'cold replay of the attack journal is byte-exact')
  ok(reboot.conserves() && reboot.balanceOf(pot) === L.balanceOf(pot), 'replay conserves and the pot matches')

  // ── empty field: draw refused, settle pays 0, enter still sits ──
  const Ej: KrayEvent[] = []
  const Empty = new KrayLedger(undefined, NET)
  fund(Empty, Ej)
  const epot = hang(Empty, Ej)
  apply(Empty, Ej, v2(epot, B, 'enter', 0, nxt(Empty)))
  apply(Empty, Ej, { seq: nxt(Empty), kind: 'seal', hash: 'e1', l1Txid: '11'.repeat(32), at: 0 } as KrayEvent)
  apply(Empty, Ej, { seq: nxt(Empty), kind: 'seal', hash: 'e2', l1Txid: '22'.repeat(32), at: 0 } as KrayEvent)
  apply(Empty, Ej, v2(epot, A, 'skip', 1, nxt(Empty)))
  ok(Empty.balanceOf(epot) === 5n && Empty.contractAt(epot)?.state.taken === '1', 'skip keeps the lonely ticket')
  apply(Empty, Ej, { seq: nxt(Empty), kind: 'seal', hash: 'e3', l1Txid: '33'.repeat(32), at: 0 } as KrayEvent)
  apply(Empty, Ej, { seq: nxt(Empty), kind: 'seal', hash: 'e4', l1Txid: '44'.repeat(32), at: 0 } as KrayEvent)
  apply(Empty, Ej, v2(epot, Eve, 'settle', 0, nxt(Empty)))
  ok(Empty.balanceOf(epot) === 5n && Empty.contractAt(epot)?.state.taken === '1', 'settle on one ticket pays nothing — the pot accumulates')
  rejects(() => { Empty.applyLive(v2(epot, A, 'draw', 2, nxt(Empty))) }, /guard|refused/i, 'draw still refuses a one-ticket pot')
  ok(Empty.conserves(), 'conservation on the thin field')

  // ── random seeds: hang, fill, seal, settle or draw, never mint ──
  const seeds = [3, 11, 23, 47, 101]
  let acts = 0
  for (const seed of seeds) {
    const Sj: KrayEvent[] = []
    const S = new KrayLedger(undefined, NET)
    fund(S, Sj)
    const spot = hang(S, Sj, String(2 + (seed % 5)), '2')
    const sitters = [B, C, Eve]
    for (const w of sitters) {
      apply(S, Sj, v2(spot, w, 'enter', 0, nxt(S)))
      acts++
    }
    apply(S, Sj, { seq: nxt(S), kind: 'seal', hash: 'z1' + seed, l1Txid: ('a' + (seed % 9)).repeat(32), at: 0 } as KrayEvent)
    apply(S, Sj, { seq: nxt(S), kind: 'seal', hash: 'z2' + seed, l1Txid: (seed % 2 === 0 ? SEAL : 'ef'.repeat(32)), at: 0 } as KrayEvent)
    if (seed % 2 === 0) apply(S, Sj, v2(spot, Eve, 'settle', 1, nxt(S)))
    else apply(S, Sj, v2(spot, A, 'draw', 1, nxt(S)))
    acts++
    ok(S.balanceOf(spot) === 0n && S.conserves(), `seed ${seed} — pot empty, conserved`)
    const cold = new KrayLedger(undefined, NET)
    for (const e of Sj) cold.applyLive(e)
    ok(cold.cascadeRoot() === S.cascadeRoot(), `seed ${seed} — replay is byte-exact`)
  }
  ok(acts === seeds.length * 4, `five seeds × 3 enters + 1 close = ${acts} live acts`)

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — SWARM HOLDS: fee/nonce/sig, v1 pot has no clock, fake payout HALTs, pot has no key, thin field accumulates, five seeds replay. ⚖⭐`)
}
main()
