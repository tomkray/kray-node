/**
 * THE ELIGIBILITY SEAM (ADR-3 · the join between 3c ordering and 3d censorship) — a writer is not a censor
 * for correctly WAITING on an act that cannot yet apply.
 *
 *   node src/test/eligibility-censorship.test.ts
 *
 * 3c `orderWindow` legitimately DEFERS an act whose nonce is not yet its account's expected nonce (a gap):
 * it is admitted (signature valid) but never eligible, so it is not applied — and, because the inclusion
 * root commits the ORDERED (applied) keys, the deferred act's key is ABSENT from that root. That absence is
 * HONEST: the writer could not apply a nonce-gapped act without forging the missing predecessors. The 3d
 * verdict must not convict on it — else a citizen who withholds their OWN earlier nonces manufactures a
 * false CENSORED against an honest writer (the "no party exploits another" violation the foundation forbids).
 *
 * An adversarial council ruled the fix (over two tempting-but-unsound variants): an eligibility gate in the
 * verdict, with STRICT equality, measured AT THE DEADLINE — `act.nonce === expectedNonceAt(from, deadline)`,
 * where the expected nonce is the account's next nonce in the APPLIED state as of the last seal ≤ the
 * deadline (re-derived by a follower from the anchored journal). Measuring at the deadline (symmetric with
 * `availableBySeal ≤ deadline`) excuses a gap whose predecessors apply only LATER; strict equality excuses a
 * losing double-signed sibling at an already-filled slot. This exam pins every case the council named.
 */
import { createHash } from 'node:crypto'
import { orderWindow, keyFromSignedMessage, type SignedAct, type WindowRules } from '../protocol/window-order.ts'
import { inclusionRoot, proveKey } from '../protocol/inclusion-tree.ts'
import { verifyCensorship, windowCommitment, type CensorshipClaim, type CensorshipRules } from '../protocol/censorship-evidence.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

// ── the signed-act model: a nonced act's signed message is `${from}#${nonce}|deadline=${D}` (its identity,
//    with the deadline a SIGNED field — obligation #1); a donation is nonce-free, keyed by its own outpoint.
//    Every act here is validly signed. ──
interface Act extends SignedAct { from?: string; nonce?: number; deadline: number; id?: string }
const signedMessage = (a: Act) =>
  typeof a.nonce === 'number' ? `${a.from}#${a.nonce}|deadline=${a.deadline}` : `donate|${a.id}|deadline=${a.deadline}`
const keyOf = (a: Act) => keyFromSignedMessage(signedMessage(a))
const START_NONCE = new Map<string, number>([['A', 0], ['B', 0], ['C', 0], ['D', 0], ['E', 0]])
const winRules: WindowRules<Act> = { nonceOf: (addr) => START_NONCE.get(addr) ?? 0, keyOf, isValid: () => true }

/** Build the censorship rules with a given eligibility oracle (the account's expected nonce as of a deadline). */
const rulesWith = (expectedNonceAt: (act: Act, deadline: number) => number | null): CensorshipRules<Act> =>
  ({ keyOf, isValid: () => true, deadlineOf: (a) => a.deadline, expectedNonceAt })

const SEAL = 950_000, PUBLIC_BY = 800_000

/** Assemble the honest 3d claim a citizen builds for `act` against a window committing exactly `includedKeys`. */
function claimFor(act: Act, includedKeys: string[], seal = SEAL, availableBySeal = PUBLIC_BY): CensorshipClaim<Act> {
  const root = inclusionRoot(includedKeys)
  return { act, seal, inclusionRoot: root, anchoredCommitment: windowCommitment(seal, root), absenceProof: proveKey(includedKeys, keyOf(act)), availableBySeal }
}

function main() {
  console.log('\n╔═ THE ELIGIBILITY SEAM — a writer that WAITS on a nonce gap is not a censor (3c ⋈ 3d) ═╗\n')

  const D = 900_000

  // ── 1 · COMPOSITION (real 3c) — A#0 is eligible; A#5 is a GAP (nonces 1..4 never arrived) → DEFERRED. The
  //    inclusion root commits the applied keys; the deferred act's key is absent. Expected nonce derived from
  //    the applied set. ──
  {
    const a0: Act = { from: 'A', nonce: 0, deadline: D }
    const gap: Act = { from: 'A', nonce: 5, deadline: D }
    const { ordered, deferred } = orderWindow([a0, gap], winRules)
    ok(ordered.length === 1 && ordered[0].nonce === 0, '3c: A#0 is applied (eligible at the expected nonce)')
    ok(deferred.length === 1 && deferred[0].nonce === 5, '3c: A#5 is DEFERRED — a nonce gap, admitted but never eligible, so never applied')

    const includedKeys = ordered.map(keyOf)
    // expected nonce as of the deadline, from the applied set (contiguous from the start)
    const expected = rulesWith((act) => START_NONCE.get(act.from!)! + ordered.filter((o) => o.from === act.from).length)

    const vGap = verifyCensorship(claimFor(gap, includedKeys), expected)
    ok(vGap.censored === false, 'PIN 1 — a DEFERRED nonce-gapped act (A#5, expected 1) is NOT censored: the writer honestly waited on the missing predecessors, not censorship')

    // CONTROL: B#0 is eligible at once (B's expected nonce is 0) yet left out → the verdict rightly fires.
    const b0: Act = { from: 'B', nonce: 0, deadline: D }
    const vCtrl = verifyCensorship(claimFor(b0, includedKeys), expected)
    ok(vCtrl.censored === true, 'PIN 5 (CONTROL) — an ELIGIBLE act (B#0 at its expected nonce) left out of the window IS censored: the seam does not go blind')
  }

  // ── 2 · DEADLINE, not SEAL — C#1's predecessor C#0 applies only AFTER C#1's own deadline. At the deadline
  //    C was still at nonce 0, so C#1 was a gap it could not fill; a seal-measured gate would wrongly convict
  //    (expected@seal == 1 == nonce). Measured at the deadline, expected == 0 → not owed. ──
  {
    const c1: Act = { from: 'C', nonce: 1, deadline: D }
    // expected('C') is 0 as of the deadline (C#0 applied only at a later seal), 1 as of the accusing seal
    const oracle = rulesWith((act, deadline) => (deadline <= D ? 0 : 1))
    const v = verifyCensorship(claimFor(c1, [keyOf({ from: 'Z', nonce: 0, deadline: D })]), oracle)
    ok(v.censored === false && /GAP above/.test((v as { reason: string }).reason),
      'PIN 2 — a gap whose predecessors apply only AFTER its deadline is NOT censored: eligibility is measured at the deadline, not the accusing seal (a seal-measured gate would falsely convict)')
  }

  // ── 3 · DOUBLE-SIGN losing sibling — D signs two distinct acts at nonce 0 (different messages → different
  //    keys). 3c applies the min-key one; the loser is DEFERRED. After applying one, D's expected is 1, so the
  //    loser (nonce 0) is a filled slot — a `<=` gate would wrongly convict; strict equality excuses it. ──
  {
    const dx: Act = { from: 'D', nonce: 0, deadline: D, id: 'x' }   // id only perturbs nothing for nonced (message ignores id)
    const dy: Act = { from: 'D', nonce: 0, deadline: D, id: 'y' }
    // force two DISTINCT signed identities at the same nonce via a benign message salt
    const saltedMsg = (a: Act) => `${a.from}#${a.nonce}|deadline=${a.deadline}|v=${a.id}`
    const saltKey = (a: Act) => keyFromSignedMessage(saltedMsg(a))
    const winR: WindowRules<Act> = { nonceOf: (addr) => START_NONCE.get(addr) ?? 0, keyOf: saltKey, isValid: () => true }
    const { ordered, deferred } = orderWindow([dx, dy], winR)
    ok(ordered.length === 1 && deferred.length === 1, '3c: of two acts at one nonce, one applies and the loser DEFERS (the smaller key wins)')
    const loser = deferred[0]
    const includedKeys = ordered.map(saltKey)
    const oracle: CensorshipRules<Act> = { keyOf: saltKey, isValid: () => true, deadlineOf: (a) => a.deadline, expectedNonceAt: () => 1 }
    const claim: CensorshipClaim<Act> = { act: loser, seal: SEAL, inclusionRoot: inclusionRoot(includedKeys), anchoredCommitment: windowCommitment(SEAL, inclusionRoot(includedKeys)), absenceProof: proveKey(includedKeys, saltKey(loser)), availableBySeal: PUBLIC_BY }
    const v = verifyCensorship(claim, oracle)
    ok(v.censored === false && /already been filled|already filled|below the account/.test((v as { reason: string }).reason),
      'PIN 3 — the LOSING double-signed sibling (nonce 0, slot already filled, expected 1) is NOT censored: strict equality excuses a superseded slot (a `<=` gate would falsely convict)')
  }

  // ── 4 · ABSENCE STILL BINDS — a NONCE-FREE donation that the writer DID include is present in the root, so
  //    the absence proof fails: not censored (no false negative from skipping the eligibility gate). ──
  {
    const don: Act = { deadline: D, id: 'included-donation' }
    const includedKeys = [keyOf(don), keyOf({ deadline: D, id: 'other' })]
    const oracle = rulesWith(() => null)   // never consulted — donation is nonce-free
    const v = verifyCensorship(claimFor(don, includedKeys), oracle)
    ok(v.censored === false && /may in fact be included/.test((v as { reason: string }).reason),
      'PIN 4 — an INCLUDED nonce-free donation is NOT censored: the absence proof shows it present (the gate is skipped, but absence still binds)')
  }

  // ── 6 · FRONTIER FUNNEL — E refuses everything. E#0 is eligible (expected 0) and absent → CENSORED. Its
  //    downstream waiter E#1 is a gap (expected 0) → NOT censored. Conviction funnels to the FRONTIER act; a
  //    writer that refuses the predecessor to keep expected low is convicted on THAT predecessor. ──
  {
    const e0: Act = { from: 'E', nonce: 0, deadline: D }
    const e1: Act = { from: 'E', nonce: 1, deadline: D }
    const includedKeys = [keyOf({ from: 'Z', nonce: 0, deadline: D })]   // neither E act included
    const oracle = rulesWith(() => 0)   // E has applied nothing → expected 0
    const vFrontier = verifyCensorship(claimFor(e0, includedKeys), oracle)
    const vWaiter = verifyCensorship(claimFor(e1, includedKeys), oracle)
    ok(vFrontier.censored === true, 'PIN 6a — the FRONTIER refused-eligible act (E#0, expected 0) IS censored: a hostile writer cannot escape by starving the account')
    ok(vWaiter.censored === false, 'PIN 6b — its downstream waiter (E#1, a gap at expected 0) is NOT censored: conviction funnels to the frontier, not the waiters')
  }

  // ── 7 · NONCE-FREE donation refused — an absent, available, past-deadline donation IS censored (donations
  //    are always eligible; the gate is skipped). ──
  {
    const don: Act = { deadline: D, id: 'refused-donation' }
    const includedKeys = [keyOf({ deadline: D, id: 'someone-else' })]
    const oracle = rulesWith(() => null)
    const v = verifyCensorship(claimFor(don, includedKeys), oracle)
    ok(v.censored === true, 'PIN 7 — a refused nonce-free donation (always eligible) IS censored: the gate does not blind the verdict to real omission of donations')
  }

  // ── 8 · FAIL-CLOSED — a nonced act with NO eligibility oracle (or an oracle that cannot answer) is never
  //    convicted: without the account's anchored nonce state, deferral is indistinguishable from refusal. ──
  {
    const a0: Act = { from: 'A', nonce: 0, deadline: D }
    const includedKeys = [keyOf({ from: 'Z', nonce: 0, deadline: D })]
    const noOracle: CensorshipRules<Act> = { keyOf, isValid: () => true, deadlineOf: (a) => a.deadline }   // expectedNonceAt undefined
    const vNone = verifyCensorship(claimFor(a0, includedKeys), noOracle)
    ok(vNone.censored === false && /eligibility cannot be checked/.test((vNone as { reason: string }).reason),
      'PIN 8 — a nonced act with no eligibility oracle is NOT convicted (fail-closed): eligibility must be re-derived from the anchored state, never assumed')
    const nullOracle = rulesWith(() => null)
    ok(verifyCensorship(claimFor(a0, includedKeys), nullOracle).censored === false, 'and an oracle that returns null (unknown) likewise fails closed')
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — omission convicts only what the writer COULD have applied by the deadline; a nonce gap, a late predecessor, and a losing double-sign are the citizen's own, not the writer's censorship. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
