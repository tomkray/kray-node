/**
 * PROOF MANDATORY (audit 2026-08-28, ratified with the twin rebirth) — at/after the activation
 * seq the REDUCER refuses an L1-peg event without its embedded SPV proof.
 *
 *   node src/test/proof-mandatory.test.ts
 *
 * Pins:
 *   P-01  regtest default (MAX): the lab dev-mint (proofless donate) still applies — bench law unchanged
 *   P-02  born-strict (H=0): a proofless donate is REFUSED by the reducer, no mutation
 *   P-03  born-strict: a donate WITH proof + outpoint passes the structural gate (verification polarity
 *         unchanged — it runs wherever the node holds the pot script/key, exactly as before)
 *   P-04  born-strict: a proofless rune-deposit is REFUSED
 *   P-05  born-strict: a proofless rune-settle is REFUSED (before the lock lookup — fail fast)
 *   P-06  A3: with H=3, a proofless donate at seq<3 applies and the SAME shape at seq≥3 is refused —
 *         the pre-activation history replays byte-identically
 *   P-07  THE TABLE ITSELF: a DEFAULT signet ledger (no injection) refuses a proofless donate — born strict
 *   P-08  THE TABLE ITSELF: a DEFAULT main ledger refuses a proofless donate;
 *         a rune-deposit is refused by Porta 2 (RUNE_BOOK_OPEN_SEQ.main is MAX)
 *   P-09  THE BENCH LIFT LAW: KRAY_LAB_PROOF_MANDATORY_SEQ lifts a TRUSTED_DEV signet bench
 *         (openKrayLedger), and the SAME env is DEAD on main — nothing lifts born-strict there
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { openKrayLedger } from '../protocol/store.ts'
import { NETWORKS, _generateKeyPair, _hexToBytes } from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const s = (e as Error).message; ok(re.test(s), m + (re.test(s) ? '' : ' — wrong error: ' + s)) }
}
function addr(tag: string): string {
  const sk = createHash('sha256').update('proof-mandatory|' + tag).digest()
  return btc.p2tr(_hexToBytes(_generateKeyPair(sk).publicKeyHex), undefined, NETWORKS.regtest).address!
}
const outpoint = (tag: string) => createHash('sha256').update('op|' + tag).digest('hex') + ':0'
// a strict ledger: regtest network, proofMandatorySeq injected (the 16th ctor param)
const strict = (h: number) => new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, h)

function main() {
  console.log('\n╔═ PROOF MANDATORY — the reducer refuses a proofless L1-peg event at/after H ═╗\n')
  const A = addr('A')

  // P-01 · lab law unchanged
  const lab = new KrayLedger(undefined, NET)
  lab.applyLive({ seq: 1, kind: 'donate', hash: 'p1', to: A, amount: '100' } as KrayEvent)
  ok(lab.balanceOf(A) === 100n && lab.conserves(), 'P-01 regtest default: the proofless dev-mint still applies (bench law)')

  // P-02 · born strict refuses the same event
  const L0 = strict(0)
  rejects(
    () => L0.applyLive({ seq: 1, kind: 'donate', hash: 'p2', to: A, amount: '100' } as KrayEvent),
    /proof-mandatory activation a donation/,
    'P-02 born-strict: a proofless donate is REFUSED in the reducer',
  )
  ok(L0.balanceOf(A) === 0n && L0.totalEmitted === 0n && L0.conserves(), 'P-02 nothing mutated — no ₭ exists without its burn')

  // P-03 · with proof + outpoint the structural gate passes (no pot script here ⇒ verification skipped, as today)
  const L1 = strict(0)
  L1.applyLive({ seq: 1, kind: 'donate', hash: 'p3', to: A, amount: '100', outpoint: outpoint('p3'), proof: { rawTx: '00', txoutproof: '00', headers: [] } } as unknown as KrayEvent)
  ok(L1.balanceOf(A) === 100n && L1.conserves(), 'P-03 born-strict: a donate that EMBEDS proof + outpoint applies (verification polarity unchanged)')

  // P-04 · proofless rune-deposit refused
  rejects(
    () => strict(0).applyLive({ seq: 1, kind: 'rune-deposit', hash: 'p4', runeId: '840000:1', outpoint: outpoint('p4'), to: A, amount: '10' } as unknown as KrayEvent),
    /proof-mandatory activation a rune deposit/,
    'P-04 born-strict: a proofless rune-deposit is REFUSED',
  )

  // P-05 · proofless rune-settle refused (fail fast, before any lock lookup)
  rejects(
    () => strict(0).applyLive({ seq: 1, kind: 'rune-settle', hash: 'p5', runeId: '840000:1', from: A, amount: '10', l1Txid: 'a'.repeat(64) } as unknown as KrayEvent),
    /proof-mandatory activation a rune settle/,
    'P-05 born-strict: a proofless rune-settle is REFUSED',
  )

  // P-06 · A3 — below H the old law replays byte-identically; at H the gate closes
  const L3 = strict(3)
  L3.applyLive({ seq: 1, kind: 'donate', hash: 'p6a', to: A, amount: '50' } as KrayEvent)
  L3.applyLive({ seq: 2, kind: 'donate', hash: 'p6b', to: A, amount: '50' } as KrayEvent)
  ok(L3.balanceOf(A) === 100n, 'P-06 below H: proofless history applies exactly as before (A3)')
  rejects(
    () => L3.applyLive({ seq: 3, kind: 'donate', hash: 'p6c', to: A, amount: '1' } as KrayEvent),
    /proof-mandatory activation/,
    'P-06 at H: the same shape is refused — the activation is the boundary',
  )
  ok(L3.conserves() && L3.haltedReason() === null, 'P-06 a refused act mutates nothing and does not halt the book')

  // P-07 / P-08 · THE TABLE ITSELF — no injection: the per-network constant is the law
  const tb1 = btc.p2tr(_hexToBytes(_generateKeyPair(createHash('sha256').update('pm|tb').digest()).publicKeyHex), undefined, NETWORKS.signet).address!
  const bc1 = btc.p2tr(_hexToBytes(_generateKeyPair(createHash('sha256').update('pm|bc').digest()).publicKeyHex), undefined, NETWORKS.main).address!
  rejects(
    () => new KrayLedger(undefined, 'signet').applyLive({ seq: 1, kind: 'donate', hash: 'p7', to: tb1, amount: '100' } as KrayEvent),
    /proof-mandatory activation a donation/,
    'P-07 a DEFAULT signet ledger refuses a proofless donate — PROOF_MANDATORY_SEQ.signet is 0, pinned',
  )
  rejects(
    () => new KrayLedger(undefined, 'main').applyLive({ seq: 1, kind: 'donate', hash: 'p8a', to: bc1, amount: '100' } as KrayEvent),
    /proof-mandatory activation a donation/,
    'P-08 a DEFAULT main ledger refuses a proofless donate — PROOF_MANDATORY_SEQ.main is 0, pinned',
  )
  rejects(
    () => new KrayLedger(undefined, 'main').applyLive({ seq: 1, kind: 'rune-deposit', hash: 'p8b', runeId: '840000:1', outpoint: outpoint('p8b'), to: bc1, amount: '10' } as unknown as KrayEvent),
    /rune book is not open/,
    'P-08 a DEFAULT main ledger refuses a rune-deposit — Porta 2 is dark (RUNE_BOOK_OPEN_SEQ.main is MAX)',
  )

  // P-09 · THE BENCH LIFT LAW — the ONE named env exception (store.ts): a TRUSTED_DEV signet
  // bench lifts; main ignores the same env entirely (born strict is not liftable there).
  const envBefore = { dev: process.env.KRAY_TRUSTED_DEV, pin: process.env.KRAY_LAB_PROOF_MANDATORY_SEQ }
  process.env.KRAY_TRUSTED_DEV = '1'
  process.env.KRAY_LAB_PROOF_MANDATORY_SEQ = String(Number.MAX_SAFE_INTEGER)
  try {
    const bench = openKrayLedger('signet')
    bench.applyLive({ seq: 1, kind: 'donate', hash: 'p9a', to: tb1, amount: '100' } as KrayEvent)
    ok(bench.balanceOf(tb1) === 100n && bench.conserves(), 'P-09 a TRUSTED_DEV signet BENCH with the lab pin applies the proofless fixture (the signet-actions exam path)')
    rejects(
      () => openKrayLedger('main').applyLive({ seq: 1, kind: 'donate', hash: 'p9b', to: bc1, amount: '100' } as KrayEvent),
      /proof-mandatory activation a donation/,
      'P-09 the SAME env is DEAD on main — a mis-set var can never lift born-strict where value is real',
    )
  } finally {
    if (envBefore.dev === undefined) delete process.env.KRAY_TRUSTED_DEV; else process.env.KRAY_TRUSTED_DEV = envBefore.dev
    if (envBefore.pin === undefined) delete process.env.KRAY_LAB_PROOF_MANDATORY_SEQ; else process.env.KRAY_LAB_PROOF_MANDATORY_SEQ = envBefore.pin
  }

  console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed, ${fail} failed — the peg re-derives from bytes, never from the door.\n`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
