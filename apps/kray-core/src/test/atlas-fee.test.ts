/**
 * THE ATLAS FEE (branch A, docs/ATLAS-FEE-DECISION.md) — the wall-toll beside the untouched fire.
 * Prove by breaking:
 *   node src/test/atlas-fee.test.ts
 *
 *   AF-01  DORMANT by default — a stock ledger charges burn ONLY; TREASURY earns nothing from an inscribe
 *   AF-02  THE BOUNDARY — below the activation seq no toll; at/after it the toll lands, to the ₭
 *   AF-03  SIZE-PRICED — the toll is max(1, ceil(size / rate)) at the era's rate, credited to TREASURY exactly
 *   AF-04  SPLIT-NEUTRAL — toll(A) + toll(B) == toll(A+B) (the Cauchy theorem: slicing changes nothing)
 *   AF-05  CONSERVED — the toll circulates (payer → TREASURY); ONLY the fire deflates; circulating == Σ balances
 *   AF-06  REFUSED WHOLE — a creator who covers the fire but not the toll burns NOTHING (no star, no nonce, no debit)
 *   AF-07  ZERO BYTES, ZERO TOLL — an empty act stays at the eternal 1 ₭ burn; the wall charges only for weight
 *   AF-08  REPLAY — a fresh ledger replays the same journal to the same root, same TREASURY, same balances
 *   AF-09  THE GATE IS THE ROOT — the same acts under a dormant ledger produce a DIFFERENT root than an active one,
 *          and the dormant root equals a stock ledger's (A3: below activation, history is byte-identical)
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, inscribeMessageV2 } from '../protocol/scheme.ts'
import { sha256hex, TREASURY, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
function wallet(tag: string) {
  const sk = createHash('sha256').update('atlas-fee|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const A = wallet('A')

/** a ledger with a chosen atlas-fee activation seq (MAX = dormant) + an auto-seq apply helper that journals */
function ledger(atlasSeq?: number) {
  const L = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, undefined, atlasSeq)
  const J: KrayEvent[] = []
  const ap = (e: Record<string, unknown>) => { const ev = { ...e, seq: J.length + 1 } as unknown as KrayEvent; L.applyLive(ev); J.push(ev); return ev }
  return { L, J, ap }
}
function inscribeEv(L: KrayLedger, w: typeof A, tag: string, size: number) {
  const ch = sha256hex(tag), n = L.nonceOf(w.addr)
  return {
    kind: 'inscribe', hash: tag, from: w.addr, contentHash: ch, contentType: 'text/plain', size,
    nonce: n, publicKey: w.pk, signature: _signKrayWallet(inscribeMessageV2(NET, w.addr, ch, 'text/plain', size, undefined, n), w.sk), scheme: 'kraywallet',
  } as Record<string, unknown>
}
const sumBalances = (L: KrayLedger, addrs: string[]) => addrs.reduce((s, a) => s + L.balanceOf(a), 0n)

function main() {
  console.log('\n╔═ THE ATLAS FEE — the wall-toll beside the fire, dormant below the ratified seq ═╗\n')

  console.log('AF-01 — dormant by default: a stock ledger charges the fire only')
  const S = ledger()   // no injection → regtest default MAX
  S.ap({ kind: 'donate', hash: 'd1', to: A.addr, amount: '100' })
  S.ap(inscribeEv(S.L, A, 's1', 8))
  ok(S.L.balanceOf(TREASURY) === 0n, 'TREASURY earned nothing below activation')
  ok(S.L.balanceOf(A.addr) === 99n, 'the 8-byte star cost exactly the 1 ₭ fire (99 left of 100)')
  ok(S.L.atlasFeeOf(8) === 0n, 'the door quote agrees: atlasFeeOf(8) == 0 while dormant')

  console.log('\nAF-02 — the boundary: seq 3 pays nothing (below 4), seq 4 pays the toll')
  const B4 = ledger(4)
  B4.ap({ kind: 'donate', hash: 'd1', to: A.addr, amount: '100' })   // seq 1
  B4.ap({ kind: 'donate', hash: 'd2', to: A.addr, amount: '10' })    // seq 2
  B4.ap(inscribeEv(B4.L, A, 'b1', 8))                                // seq 3 — below the gate
  ok(B4.L.balanceOf(TREASURY) === 0n, 'seq 3 (below activation): no toll')
  ok(B4.L.atlasFeeOf(8) === 1n, 'the door quote flips BEFORE the next act: atlasFeeOf(8) == 1 when the next seq activates')
  B4.ap(inscribeEv(B4.L, A, 'b2', 8))                                // seq 4 — the gate
  ok(B4.L.balanceOf(TREASURY) === 1n, 'seq 4 (at activation): 1 ₭ toll landed in TREASURY')
  ok(B4.L.balanceOf(A.addr) === 110n - 1n - 1n - 1n, 'A paid fire+fire+toll (107 left of 110)')

  console.log('\nAF-03 — size-priced at the era rate: 1.5 MB costs 2 ₭ fire + 2 ₭ toll')
  const P = ledger(1)
  P.ap({ kind: 'donate', hash: 'd1', to: A.addr, amount: '100' })
  P.ap(inscribeEv(P.L, A, 'p1', 1_500_000))
  ok(P.L.balanceOf(TREASURY) === 2n, 'toll(1.5MB) == 2 ₭ (ceil at the genesis 1 ₭/MB rate)')
  ok(P.L.balanceOf(A.addr) === 100n - 2n - 2n, 'A paid 2 fire + 2 toll (96 left)')

  console.log('\nAF-04 — split-neutral: two 600 KB works cost the same toll as one 1.2 MB work')
  const S1 = ledger(1)
  S1.ap({ kind: 'donate', hash: 'd1', to: A.addr, amount: '100' })
  S1.ap(inscribeEv(S1.L, A, 'x1', 600_000)); S1.ap(inscribeEv(S1.L, A, 'x2', 600_000))
  const S2 = ledger(1)
  S2.ap({ kind: 'donate', hash: 'd1', to: A.addr, amount: '100' })
  S2.ap(inscribeEv(S2.L, A, 'y1', 1_200_000))
  ok(S1.L.balanceOf(TREASURY) === S2.L.balanceOf(TREASURY) && S1.L.balanceOf(TREASURY) === 2n,
    'toll(600K)+toll(600K) == toll(1.2M) == 2 ₭ — slicing buys nothing')

  console.log('\nAF-05 — conserved: the toll circulates, only the fire deflates')
  ok(P.L.circulating === 100n - 2n, 'circulating fell by the FIRE only (the toll moved, it did not die)')
  ok(sumBalances(P.L, [A.addr, TREASURY]) === P.L.circulating, 'Σ balances == circulating (the tripwire arithmetic, explicit)')

  console.log('\nAF-06 — refused whole: covering the fire but not the toll burns NOTHING')
  const R = ledger(1)
  R.ap({ kind: 'donate', hash: 'd1', to: A.addr, amount: '2' })      // 1.5 MB needs 2 fire + 2 toll = 4
  const before = { bal: R.L.balanceOf(A.addr), nonce: R.L.nonceOf(A.addr), root: R.L.cascadeRoot(), t: R.L.balanceOf(TREASURY) }
  rejects(() => R.ap(inscribeEv(R.L, A, 'r1', 1_500_000)), /atlas fee/, 'the refusal names the atlas fee')
  ok(R.L.balanceOf(A.addr) === before.bal && R.L.nonceOf(A.addr) === before.nonce, 'no debit, no nonce — nothing mutated')
  ok(R.L.balanceOf(TREASURY) === before.t && R.L.cascadeRoot() === before.root, 'no toll, same root — the act failed WHOLE')

  console.log('\nAF-07 — zero bytes, zero toll: an empty act stays at the eternal 1 ₭')
  const Z = ledger(1)
  Z.ap({ kind: 'donate', hash: 'd1', to: A.addr, amount: '10' })
  Z.ap(inscribeEv(Z.L, A, 'z1', 0))
  ok(Z.L.balanceOf(TREASURY) === 0n, 'size 0: no toll (the wall charges only for weight)')
  ok(Z.L.balanceOf(A.addr) === 9n, 'the empty star still burned its eternal 1 ₭')

  console.log('\nAF-08 — replay: a fresh ledger replays the journal to the same truth')
  const P2 = ledger(1)
  for (const ev of P.J) P2.L.applyLive(ev)
  ok(P2.L.cascadeRoot() === P.L.cascadeRoot(), 'same journal → same cascade root')
  ok(P2.L.balanceOf(TREASURY) === P.L.balanceOf(TREASURY) && P2.L.balanceOf(A.addr) === P.L.balanceOf(A.addr), 'same TREASURY, same balances')

  console.log('\nAF-09 — the gate is the root: dormant == stock (A3), active differs')
  const D9 = ledger(Number.MAX_SAFE_INTEGER), A9 = ledger(1), C9 = ledger()
  for (const src of [D9, A9, C9]) {
    src.ap({ kind: 'donate', hash: 'd1', to: A.addr, amount: '100' })
    src.ap(inscribeEv(src.L, A, 'g1', 8))
  }
  ok(D9.L.cascadeRoot() === C9.L.cascadeRoot(), 'dormant injected == stock default — byte-identical history (A3)')
  ok(A9.L.cascadeRoot() !== D9.L.cascadeRoot(), 'the active ledger tells a different (tolled) truth — the gate is real')

  console.log(`\n${fail === 0 ? '✅' : '❌'} atlas-fee: ${pass} passed, ${fail} failed\n`)
  if (fail > 0) process.exit(1)
}
main()
