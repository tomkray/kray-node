/**
 * THE FIREBORN LAW (stage 1) — burn once, move forever (within the tank). Prove by breaking:
 *   node src/test/fireborn-law.test.ts
 *
 *   FB-01  DORMANT by default — below the activation seq a fee-0 x-send is REFUSED; fee 1 works (byte-identical era)
 *   FB-02  TANK ACCRUAL — every ₭ burned mints F=1,000 lifetime feeless sends, accrued from genesis (retroactive)
 *   FB-03  THE FEELESS PATH — at/after activation the fee is PRESCRIBED 0: Ӿ moves with ZERO ₭ (a pure-Ӿ wallet
 *          pays nothing), the treasury gains nothing, the tank decrements, the gap clock arms
 *   FB-04  THE FEE IS NEVER A CHOICE — fee 1 when 0 is prescribed REFUSED; fee 0 when 1 is prescribed REFUSED
 *          (writer fee-flipping impossible in both directions)
 *   FB-05  THE GAP LAW — a second feeless send inside 3,500 ms is prescribed 1 ₭ (burst pays); at +3500 it is free
 *   FB-06  TIME TRAVEL PAYS — a feeless send whose `at` runs backwards is prescribed 1 ₭; a timeless act pays too
 *   FB-07  THE BOT EXAM — a bot storming one address consumes AT MOST its tank, one free send per 3.5 s; every
 *          byte beyond the fire is paid — Σ feeless ≤ F × burned, the atemporal bound holds exactly
 *   FB-08  CONSERVED — the fireborn tripwire (tanks + spent == F × burned) holds through mixed activity
 *   FB-09  IN THE ROOT — the tank folds at/after activation (dormant vs active roots differ only from the seq);
 *          a fresh ledger replays the journal to a byte-identical root, tank and gap clock
 *   FB-10  ACCUMULATION — a second burn refills the tank by another F (lifetime allowance is additive)
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger, FIREBORN_SENDS_PER_KRAY, FIREBORN_GAP_MS } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, inscribeMessageV2, transferMessage, xSendMessage } from '../protocol/scheme.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
function wallet(tag: string) {
  const sk = createHash('sha256').update('fireborn|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B'), C = wallet('C')

/** a ledger with Ӿ transfers active from seq 1 and a chosen FIREBORN activation seq (MAX = dormant) */
function ledger(fireSeq: number) {
  const L = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, 1, undefined, undefined, undefined, undefined, fireSeq)
  const J: KrayEvent[] = []
  const ap = (e: Record<string, unknown>) => { const ev = { ...e, seq: J.length + 1 } as unknown as KrayEvent; L.applyLive(ev); J.push(ev); return ev }
  return { L, J, ap }
}
function fund(ap: (e: Record<string, unknown>) => KrayEvent) {
  ap({ kind: 'donate', hash: 'dA', to: A.addr, amount: '100' })
  ap({ kind: 'donate', hash: 'dB', to: B.addr, amount: '20' })
}
/** an inscribe burns 1 ₭ → mints 1 Ӿ (and, under the law, F lifetime feeless sends) */
function inscribe(L: KrayLedger, ap: (e: Record<string, unknown>) => KrayEvent, w: typeof A, tag: string) {
  const ch = sha256hex(tag), n = L.nonceOf(w.addr)
  return ap({ kind: 'inscribe', hash: tag, from: w.addr, contentHash: ch, contentType: 'text/plain', size: 8, nonce: n, publicKey: w.pk, signature: _signKrayWallet(inscribeMessageV2(NET, w.addr, ch, 'text/plain', 8, undefined, n), w.sk), scheme: 'kraywallet' })
}
function xsendEv(L: KrayLedger, from: typeof A, to: string, amt: number, opts: { fee?: string; at?: number; tag?: string } = {}) {
  const n = L.nonceOf(from.addr)
  const sig = _signKrayWallet(xSendMessage(NET, from.addr, to, BigInt(amt), n), from.sk)
  return { kind: 'x-send', hash: sha256hex('fb|' + from.addr + '|' + to + '|' + amt + '|' + n + '|' + (opts.tag || '')), from: from.addr, to, amount: String(amt), fee: opts.fee ?? '1', nonce: n, publicKey: from.pk, signature: sig, scheme: 'kraywallet', ...(opts.at !== undefined ? { at: opts.at } : {}) } as Record<string, unknown>
}
function transferAll(L: KrayLedger, ap: (e: Record<string, unknown>) => KrayEvent, w: typeof A, to: string) {
  const amt = L.balanceOf(w.addr) - 1n   // keep exactly the 1-₭ fee
  const n = L.nonceOf(w.addr)
  return ap({ kind: 'transfer', hash: sha256hex('tx|' + w.addr + '|' + n), from: w.addr, to, amount: String(amt), fee: '1', nonce: n, publicKey: w.pk, signature: _signKrayWallet(transferMessage(NET, w.addr, to, amt, n), w.sk), scheme: 'kraywallet' })
}

function main() {
  console.log('\n╔═ THE FIREBORN LAW — burn once, move forever (within the tank) ═╗\n')
  const F = FIREBORN_SENDS_PER_KRAY

  console.log('FB-01 — DORMANT by default: fee 0 refused below activation; fee 1 is the era\'s only truth')
  const D = ledger(Number.MAX_SAFE_INTEGER)
  fund(D.ap); inscribe(D.L, D.ap, A, 'd0')
  rejects(() => D.ap(xsendEv(D.L, A, B.addr, 1, { fee: '0', at: 1_000_000 })), /eternal 1-₭ fee/, 'dormant: a fee-0 x-send is refused')
  D.ap(xsendEv(D.L, A, B.addr, 1, { fee: '1', at: 1_000_000, tag: 'paid' }))
  ok(D.L.xBalanceOf(B.addr) === 1n, 'dormant: the paid path still moves Ӿ (history unchanged)')

  console.log('\nFB-02 — TANK ACCRUAL: the fire mints F=1,000 sends per ₭, from genesis, even while dormant')
  ok(D.L.fireTankOf(A.addr) === F, `the dormant ledger already accrued A's tank (${F} — retroactive: the fire always paid)`)

  console.log('\nFB-03 — THE FEELESS PATH: prescribed 0 — Ӿ moves with zero ₭, treasury gains nothing')
  const T0 = 10_000_000
  const V = ledger(1)                       // fireborn active from seq 1
  fund(V.ap)
  inscribe(V.L, V.ap, A, 'v0a'); inscribe(V.L, V.ap, A, 'v0b'); inscribe(V.L, V.ap, A, 'v0c')  // A burns 3 ₭ → 3 Ӿ + 3F sends
  transferAll(V.L, V.ap, A, C.addr)         // A empties its ₭ — a pure-Ӿ wallet remains
  ok(V.L.balanceOf(A.addr) === 0n, 'A holds ZERO ₭ (only Ӿ and its tank)')
  const treas0 = V.L.balanceOf('KRAY_TREASURY')
  V.ap(xsendEv(V.L, A, B.addr, 1, { fee: '0', at: T0, tag: 'free1' }))
  ok(V.L.xBalanceOf(B.addr) === 1n, 'the Ӿ moved — with NO ₭ anywhere in the act')
  ok(V.L.balanceOf('KRAY_TREASURY') === treas0, 'the treasury gained NOTHING (the fire already paid)')
  ok(V.L.fireTankOf(A.addr) === 3n * F - 1n, 'the tank decremented by exactly one')
  ok(V.L.fireLastAtOf(A.addr) === T0, 'the gap clock armed at the act\'s instant')

  console.log('\nFB-04 — THE FEE IS NEVER A CHOICE (prescription kills fee-flipping in both directions)')
  rejects(() => V.ap(xsendEv(V.L, A, B.addr, 1, { fee: '1', at: T0 + FIREBORN_GAP_MS, tag: 'flip1' })), /prescribes fee 0/, 'fee 1 where 0 is prescribed: refused (writer cannot steal a ₭)')
  rejects(() => V.ap(xsendEv(V.L, A, B.addr, 1, { fee: '0', at: T0 + 1, tag: 'flip0' })), /eternal 1-₭ fee/, 'fee 0 inside the gap: refused (free bursts cannot exist)')

  console.log('\nFB-05 — THE GAP LAW: 3,499 ms pays; 3,500 ms is free')
  rejects(() => V.ap(xsendEv(V.L, A, B.addr, 1, { fee: '0', at: T0 + FIREBORN_GAP_MS - 1, tag: 'g1' })), /eternal 1-₭ fee/, 'at +3,499 ms the free path is refused')
  V.ap(xsendEv(V.L, A, B.addr, 1, { fee: '0', at: T0 + FIREBORN_GAP_MS, tag: 'g2' }))
  ok(V.L.fireTankOf(A.addr) === 3n * F - 2n, 'at +3,500 ms the send is free — the cadence is the fast block\'s')

  console.log('\nFB-06 — TIME TRAVEL PAYS: a backwards `at` is prescribed 1 ₭; so is a timeless act')
  rejects(() => V.ap(xsendEv(V.L, A, B.addr, 1, { fee: '0', at: T0, tag: 'back' })), /eternal 1-₭ fee/, 'an `at` behind the gap clock cannot ride free')
  rejects(() => V.ap(xsendEv(V.L, A, B.addr, 1, { fee: '0', tag: 'noat' })), /eternal 1-₭ fee/, 'an act with NO timestamp cannot ride free (the clock must arm)')

  console.log('\nFB-07 — THE BOT EXAM: the 3.5-second bot is bounded by fire, exactly')
  const W = ledger(1)
  W.ap({ kind: 'donate', hash: 'wA', to: A.addr, amount: '10' })
  W.ap({ kind: 'donate', hash: 'wB', to: B.addr, amount: '5' })
  inscribe(W.L, W.ap, A, 'w0')              // tank = F
  // the bot fires as fast as the law allows — one free send per 3,500 ms — until the tank dies
  let at = 1_000_000, freeSends = 0n
  const tank0 = W.L.fireTankOf(A.addr)
  for (let i = 0; i < 1_005; i++) {
    if (W.L.xBalanceOf(A.addr) < 1n) break            // the bot ran out of Ӿ — the pile itself is finite fire
    const fee = W.L.xSendFeeFor(A.addr, at, W.J.length + 1)
    W.ap(xsendEv(W.L, A, B.addr, 1, { fee: String(fee), at, tag: 'bot' + i }))
    if (fee === 0n) freeSends++
    at += FIREBORN_GAP_MS
  }
  ok(freeSends <= tank0, `the bot's free sends (${freeSends}) never exceed the fire it paid (${tank0})`)
  ok(W.L.fireTankOf(A.addr) === tank0 - freeSends, 'the tank accounts for every free send, exactly')

  console.log('\nFB-08 — CONSERVED: the fireborn tripwire holds through mixed activity')
  ok(V.L.conserves(), 'ledger V conserves (tanks + spent == F × burned)')
  ok(W.L.conserves(), 'ledger W conserves after the bot')
  ok(D.L.conserves(), 'the dormant ledger conserves too')

  console.log('\nFB-09 — IN THE ROOT: the tank folds at/after activation; a fresh ledger replays byte-exact')
  const R = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, 1, undefined, undefined, undefined, undefined, 1)
  for (const ev of V.J) R.applyLive(ev)
  ok(R.cascadeRoot() === V.L.cascadeRoot(), 'replay: byte-identical cascade root (tank + gap clock re-derived)')
  ok(R.fireTankOf(A.addr) === V.L.fireTankOf(A.addr) && R.fireLastAtOf(A.addr) === V.L.fireLastAtOf(A.addr), 'replay: identical tank and gap clock')
  // the A3 boundary: two ledgers on the SAME pre-activation journal — the dormant and the not-yet-crossed agree
  const E1 = ledger(Number.MAX_SAFE_INTEGER), E2 = ledger(50)
  fund(E1.ap); fund(E2.ap); inscribe(E1.L, E1.ap, A, 'e0'); inscribe(E2.L, E2.ap, A, 'e0')
  ok(E1.L.cascadeRoot() === E2.L.cascadeRoot(), 'below the activation seq the fold is ABSENT — byte-identical history (A3)')
  const E3 = ledger(3)                       // crosses at seq 3 (the inscribe)
  fund(E3.ap); inscribe(E3.L, E3.ap, A, 'e0')
  ok(E3.L.cascadeRoot() !== E1.L.cascadeRoot(), 'at/after the seq the fireRoot folds — the root declares the law')

  console.log('\nFB-10 — ACCUMULATION: a second burn refills the tank by another F (lifetime, additive)')
  inscribe(V.L, V.ap, B, 'v1')              // B burns 1 ₭ (B still holds ₭)
  ok(V.L.fireTankOf(B.addr) === F, 'B\'s first fire filled a fresh tank')
  inscribe(V.L, V.ap, B, 'v2')
  ok(V.L.fireTankOf(B.addr) === 2n * F, 'B\'s second fire stacked another F on top')

  console.log(`\n═ fireborn-law: ${pass} passed, ${fail} failed ═\n`)
  if (fail > 0) process.exit(1)
}
main()
