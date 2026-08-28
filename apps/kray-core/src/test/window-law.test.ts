/**
 * THE WINDOW LAW (Slice 2c) — the mint window is metered by Bitcoin's own proven heartbeat.
 *   node src/test/window-law.test.ts
 *
 * With the operator retired, nothing "spends the pot" to reopen minting. The new law: a CONFIRMED Bitcoin
 * seal — any shape — reopens EXACTLY one mint-cap (WINDOW_PER_SEAL_SATS = MINT_CAP_SATS) of capacity, once
 * per Bitcoin txid, EVER. This pins every border of that law in the consensus reducer:
 *
 *   · one seal reopens exactly 10,000 — no more, no less; a second seal reopens another 10,000;
 *   · the SAME txid can never reopen twice (replayed, reordered, or re-submitted — refused);
 *   · a malformed txid is refused before any mutation;
 *   · a seal on an EMPTY pot is consumed but reopens nothing (already fully open — defined no-op);
 *   · the full cycle: pot at target (minting CLOSED) → donation refused → seal confirms → exactly one
 *     mint-cap reopens → a 10,000 burn mints again → conserved + backed the whole way;
 *   · the consumed-seal set folds into the cascade root — two histories that consumed different seals can
 *     never share a root, and a replay of the same journal reproduces the root byte-for-byte;
 *   · a whale needs N seals for N mints: capacity never exceeds seals × cap (no seal, no reopen).
 */
import { KrayLedger } from '../protocol/ledger.ts'
import { WINDOW_PER_SEAL_SATS, MINT_CAP_SATS } from '../protocol/pot.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); fail++; console.log('  ✗ FAIL (accepted!) — ' + m) }
  catch (e) { const s = e instanceof Error ? e.message : String(e); if (re.test(s)) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log(`  ✗ FAIL (wrong refusal "${s}") — ` + m) } }
}
const TX = (c: string) => c.repeat(64)
let seqNo = 0
// Born-active signet (v1.0.0 genesis reset): a seal after inclusion activation must carry its
// Bitcoin height (3d-a binds the window to it) — the fixture stamps a fixed positive height.
const ev = (partial: Partial<KrayEvent>): KrayEvent => ({ seq: ++seqNo, prevHash: '', hash: '', at: 0, kind: 'seal', l1Height: 850_000, ...partial } as KrayEvent)
const DONOR = () => 'tb1p' + 'q'.repeat(58) // not validated by donate (network gate applies to signed kinds)

function main() {
  console.log('\n╔═ THE WINDOW LAW — Bitcoin\'s proven heartbeat meters the mint, one seal = one cap, once ever ═╗\n')
  ok(WINDOW_PER_SEAL_SATS === MINT_CAP_SATS && WINDOW_PER_SEAL_SATS === 10_000n,
    'the law\'s constant: one confirmed seal reopens exactly one mint-cap (10,000)')

  // ── THE GENESIS ROOT IS PINNED. Re-ratified 2026-08-26 with THE CHAIR LAW (target = 2,100 × 10,000
  //    = 21,000,000) AND the born-active signet (the old chain's activation pins 149–255 retired with
  //    its journal): the Creator reset both universes at v1.0.0. The pre-reset roots (the old empty
  //    root b35f059e…, sealed by the first real burn 39f5825b… under the illustrative 50M target)
  //    belong to the retired chains — orphaned by explicit ratification, kept named here as history.
  //    Signet and main are now BORN IDENTICAL — same laws, same height, the SAME genesis root; this is
  //    the root the new first burns seal on Bitcoin. If it drifts, a genesis replay broke.
  ok(new KrayLedger(undefined, 'signet').cascadeRoot() === '9d3b2de322cad91a420243c87fa3b6fce0d6bd90f1b2a1fce216b47e750030ac',
    'the signet empty-ledger root under the chair law + born-active laws is the pinned genesis root')
  ok(new KrayLedger(undefined, 'main').cascadeRoot() === '9d3b2de322cad91a420243c87fa3b6fce0d6bd90f1b2a1fce216b47e750030ac',
    'the mainnet empty-ledger root is the SAME pinned genesis root — the two universes are born identical')

  // a small pot (target 25,000) so the window borders are near
  // the window law is under exam, not the peg — lift proof-mandatory (born strict on the real
  // signet) for the bare funding donates; proof-mandatory.test.ts pins that law.
  const bench = () => new KrayLedger(25_000n, 'signet', undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, Number.MAX_SAFE_INTEGER)
  const L = bench()
  const donor = 'tb1pxd5snpedtrkqgmngclr4jk76g2xaf3aacawe37gqjkpvw6jcwyls09rm5u'

  // ── fill the pot to target: minting CLOSES ──
  L.applyLive(ev({ kind: 'donate', to: donor, amount: '10000', outpoint: TX('a') + ':0' }))
  L.applyLive(ev({ kind: 'donate', to: donor, amount: '10000', outpoint: TX('b') + ':0' }))
  L.applyLive(ev({ kind: 'donate', to: donor, amount: '5000', outpoint: TX('c') + ':0' }))
  ok(L.pot.deficit() === 0n && !L.pot.isOpen(), 'the pot reached its target — minting is CLOSED')
  rejects(() => L.applyLive(ev({ kind: 'donate', to: donor, amount: '1', outpoint: TX('d') + ':0' })), /full|refused/i,
    'a donation while the window is closed is REFUSED (no satoshi taken for a zero mint)')

  // ── one confirmed seal reopens EXACTLY one mint-cap ──
  const rootClosed = L.cascadeRoot()
  L.applyLive(ev({ kind: 'seal', l1Txid: TX('1'), l1Root: L.cascadeRoot(), l1BlockNumber: 0 }))
  ok(L.pot.deficit() === WINDOW_PER_SEAL_SATS, `one confirmed seal reopens EXACTLY ${WINDOW_PER_SEAL_SATS} — no more, no less`)
  ok(L.cascadeRoot() !== rootClosed, 'the reopen is committed — the cascade root changed (the window state is anchored)')

  // ── the SAME txid can never reopen twice ──
  rejects(() => L.applyLive(ev({ kind: 'seal', l1Txid: TX('1'), l1Root: L.cascadeRoot(), l1BlockNumber: 0 })), /already reopened/i,
    'REPLAYING the same seal txid is REFUSED — one seal, one reopen, ever')
  rejects(() => L.applyLive(ev({ kind: 'seal', l1Txid: TX('1').toUpperCase(), l1Root: L.cascadeRoot(), l1BlockNumber: 0 })), /already reopened/i,
    'the same txid in UPPERCASE is the same seal — refused (canonical lowercase)')
  ok(L.pot.deficit() === WINDOW_PER_SEAL_SATS, 'after every replay attempt the window is unchanged')

  // ── malformed txids are refused before any mutation ──
  for (const bad of ['', 'xyz', TX('1').slice(0, 63), TX('1') + 'aa']) {
    rejects(() => L.applyLive(ev({ kind: 'seal', l1Txid: bad, l1Root: L.cascadeRoot(), l1BlockNumber: 0 })), /32-byte hex/i, `a malformed seal txid ("${bad.slice(0, 12)}…") is refused`)
  }

  // ── the reopened window mints again — exactly one cap, conserved + backed ──
  const balBefore = L.balanceOf(donor)
  L.applyLive(ev({ kind: 'donate', to: donor, amount: '10000', outpoint: TX('e') + ':0' }))
  ok(L.balanceOf(donor) === balBefore + 10_000n, 'the reopened window admits EXACTLY one full 10,000 mint')
  ok(L.pot.deficit() === 0n, 'and then the window is CLOSED again — capacity never exceeds seals × cap')
  rejects(() => L.applyLive(ev({ kind: 'donate', to: donor, amount: '1', outpoint: TX('f') + ':0' })), /full|refused/i,
    'a whale needs N seals for N mints: with no fresh seal, the next donation is refused')
  ok(L.conserves() && L.backed(), 'conserved + backed (peg-of-sacrifice) hold through close → seal → mint → close')

  // ── a second, DIFFERENT seal reopens another cap ──
  L.applyLive(ev({ kind: 'seal', l1Txid: TX('2'), l1Root: L.cascadeRoot(), l1BlockNumber: 0 }))
  ok(L.pot.deficit() === WINDOW_PER_SEAL_SATS, 'a second, different confirmed seal reopens another mint-cap')

  // ── a seal on an EMPTY pot is consumed but reopens nothing (defined no-op, never throws) ──
  const E = bench()
  E.applyLive(ev({ kind: 'seal', l1Txid: TX('9'), l1Root: E.cascadeRoot(), l1BlockNumber: 0 }))
  ok(E.pot.deficit() === 25_000n && E.pot.satsHeld === 0n, 'a seal on an empty pot changes nothing (already fully open) — defined no-op')
  rejects(() => E.applyLive(ev({ kind: 'seal', l1Txid: TX('9'), l1Root: E.cascadeRoot(), l1BlockNumber: 0 })), /already reopened/i,
    'yet the txid IS consumed — it can never be replayed later when the pot has sats')

  // ── the consumed-seal set is part of the root: different seals ⇒ different histories. Fresh ledgers with
  //    IDENTICAL journals except for the seal txid — same seq, same everything — must diverge on the txid alone.
  const g25 = bench().cascadeRoot()   // the shared genesis root of the 25k fixture shape
  const seal3 = { seq: 1, prevHash: '', hash: '', at: 0, kind: 'seal', l1Height: 850_000, l1Root: g25, l1BlockNumber: 0, l1Txid: TX('3') } as KrayEvent
  const seal4 = { seq: 1, prevHash: '', hash: '', at: 0, kind: 'seal', l1Height: 850_000, l1Root: g25, l1BlockNumber: 0, l1Txid: TX('4') } as KrayEvent
  const A = bench(); A.applyLive(seal3)
  const B = bench(); B.applyLive(seal4)
  ok(A.cascadeRoot() !== B.cascadeRoot(), 'two histories that consumed DIFFERENT seals can never share a cascade root (txid alone diverges it)')
  const A2 = bench(); A2.applyLive(seal3)
  ok(A.cascadeRoot() === A2.cascadeRoot(), 'a replay of the same journal reproduces the root byte-for-byte (pure function)')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the mint window beats with Bitcoin: one buried seal, one cap, once ever. Nobody's spend involved. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
