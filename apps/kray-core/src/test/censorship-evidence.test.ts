/**
 * CENSORSHIP BECOMES PROOF (ADR-3 · slice 3d) — the fold of 3a + 3c + 3b into a checkable verdict.
 *
 *   node src/test/censorship-evidence.test.ts
 *
 * A writer that silently drops a valid, public, deadline-bound act can no longer hide it — and, just as
 * important, a FALSE accusation cannot be manufactured. This exam proves both directions:
 *
 *   · GENUINE censorship (valid act, public by its deadline, absent from the anchored window) → CENSORED;
 *   · an INVALID act absent → NOT censorship (a writer rightly excludes it);
 *   · an act with NO deadline → nothing was owed;
 *   · a FABRICATED inclusion root (commitment mismatch) → refused;
 *   · an act that is in fact INCLUDED → the absence proof fails, no false accusation;
 *   · a window BEFORE the deadline → inclusion not yet owed;
 *   · an act public only AFTER its deadline → innocent absence;
 *   · NO availability witness → absence alone is not censorship (the honest 3b/ADR-2 dependency);
 *   · a TAMPERED absence proof → refused.
 *
 * Pure — wired into no live path. This is the verdict 3e and the live wiring will call.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, verifySignature } from '../protocol/scheme.ts'
import { keyFromSignedMessage, type SignedAct } from '../protocol/window-order.ts'
import { inclusionRoot, proveKey } from '../protocol/inclusion-tree.ts'
import { windowCommitment, verifyCensorship, type CensorshipRules } from '../protocol/censorship-evidence.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

interface Wallet { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`censorship|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B'), C = wallet('C'), M = wallet('mallory')

type Act = SignedAct & Record<string, unknown>

// a deadline-bound signed message: the deadline is INSIDE what the author signs (so it is covered by the
// signature and by the 3c key). In the live wiring this is the per-kind message with a deadline field.
function msgOf(a: Act): string {
  return transferMessage(NET, a.from as string, a.to as string, BigInt(a.amount as string), a.nonce as number) + `|deadline=${a.deadlineSeal}`
}
function act(from: Wallet, to: Wallet, amount: bigint, nonce: number, deadlineSeal: number, signer: Wallet = from): Act {
  const a: Act = { kind: 'transfer', from: from.addr, to: to.addr, amount: String(amount), nonce, deadlineSeal, publicKey: signer.pk }
  a.signature = _signKrayWallet(msgOf(a), signer.sk)
  a.scheme = 'kraywallet'
  return a
}

const RULES: CensorshipRules<Act> = {
  keyOf: (a) => keyFromSignedMessage(msgOf(a)),
  isValid: (a) => { try { return verifySignature(a.from as string, msgOf(a), a.signature as string, a.publicKey as string, (a.scheme as string) ?? 'kraywallet', BNET) } catch { return false } },
  deadlineOf: (a) => (typeof a.deadlineSeal === 'number' ? a.deadlineSeal : null),
  // This exam predates the 3c ⋈ 3d eligibility seam and tests the OTHER gates (deadline, validity, root,
  // availability, absence, cumulative, signed-deadline). Make eligibility TRANSPARENT here — every act is
  // treated as sitting at its own frontier (nonce === expected) — so those gates remain the deciders; the
  // eligibility gate itself is exhaustively pinned by eligibility-censorship.test.ts.
  expectedNonceAt: (a) => (typeof a.nonce === 'number' ? a.nonce : null),
}

function main() {
  console.log('\n╔═ CENSORSHIP BECOMES PROOF — a valid, public, dropped act is undeniable ═╗\n')
  const SEAL = 100

  // the window the writer anchored at SEAL: it included A, B, C's acts — but NOT the censored one
  const included = [act(A, B, 10n, 0, SEAL), act(B, C, 5n, 0, SEAL), act(C, A, 7n, 0, SEAL)]
  const censored = act(M, A, 1n, 0, SEAL)                       // Mallory's valid act, owed by SEAL, dropped
  const keysIn = included.map(RULES.keyOf)
  const root = inclusionRoot(keysIn)
  const commit = windowCommitment(SEAL, root)
  const absence = proveKey(keysIn, RULES.keyOf(censored))       // 3a non-membership of the censored key

  const baseClaim = { act: censored, seal: SEAL, inclusionRoot: root, anchoredCommitment: commit, absenceProof: absence, availableBySeal: SEAL - 1 }

  // ── GENUINE CENSORSHIP ──
  {
    const v = verifyCensorship(baseClaim, RULES)
    ok(v.censored === true && v.key === RULES.keyOf(censored) && v.seal === SEAL && v.deadline === SEAL,
      'a valid act, public before its deadline, absent from the anchored window → CENSORED, with the act’s key')
  }

  // ── an INVALID act is not censorship ──
  {
    const forged = act(M, A, 1n, 0, SEAL, C)                    // Mallory's fields, signed by C — invalid for M
    const claim = { ...baseClaim, act: forged, absenceProof: proveKey(keysIn, RULES.keyOf(forged)) }
    const v = verifyCensorship(claim, RULES)
    ok(v.censored === false && /signature does not verify/.test(v.reason), 'an invalid-signature act absent → NOT censorship (a writer rightly excludes it)')
  }

  // ── an act with NO deadline owed nothing ──
  {
    const noDeadline: Act = { kind: 'transfer', from: M.addr, to: A.addr, amount: '1', nonce: 0, publicKey: M.pk }
    noDeadline.signature = _signKrayWallet(transferMessage(NET, M.addr, A.addr, 1n, 0) + '|deadline=undefined', M.sk)
    noDeadline.scheme = 'kraywallet'
    const v = verifyCensorship({ ...baseClaim, act: noDeadline }, RULES)
    ok(v.censored === false && /no inclusion deadline/.test(v.reason), 'an act with no deadline → nothing was owed by any seal')
  }

  // ── a FABRICATED inclusion root (commitment mismatch) is refused ──
  {
    const fakeRoot = inclusionRoot([...keysIn, RULES.keyOf(censored)])   // a root that DOES include the act
    const v = verifyCensorship({ ...baseClaim, inclusionRoot: fakeRoot }, RULES)   // but claim the anchored commit
    ok(v.censored === false && /not the one committed at this seal/.test(v.reason), 'a root that is not the anchored one → unfounded claim refused')
  }

  // ── an act that is actually INCLUDED cannot be spun as censored ──
  {
    const memberKeys = [...keysIn, RULES.keyOf(censored)]
    const rootWith = inclusionRoot(memberKeys)
    const commitWith = windowCommitment(SEAL, rootWith)
    // the accuser must present an ABSENCE proof, but the key is present → proveKey returns a membership proof
    const bogusAbsence = proveKey(memberKeys, RULES.keyOf(censored))
    const v = verifyCensorship({ act: censored, seal: SEAL, inclusionRoot: rootWith, anchoredCommitment: commitWith, absenceProof: bogusAbsence, availableBySeal: SEAL - 1 }, RULES)
    ok(v.censored === false && /absence proof does not verify/.test(v.reason), 'an act that is IN the window → no absence proof exists, no false accusation')
  }

  // ── a window BEFORE the deadline owed nothing yet ──
  {
    const late = act(M, A, 1n, 0, SEAL + 5)                     // deadline is later than this window
    const claim = { act: late, seal: SEAL, inclusionRoot: root, anchoredCommitment: commit, absenceProof: proveKey(keysIn, RULES.keyOf(late)), availableBySeal: SEAL - 1 }
    const v = verifyCensorship(claim, RULES)
    ok(v.censored === false && /predates the act’s deadline/.test(v.reason), 'a window before the deadline → inclusion was not yet owed')
  }

  // ── an act public only AFTER its deadline is an innocent absence ──
  {
    const v = verifyCensorship({ ...baseClaim, availableBySeal: SEAL + 1 }, RULES)
    ok(v.censored === false && /innocent absence/.test(v.reason), 'an act not public until after its deadline → innocent absence, not censorship')
  }

  // ── NO availability witness → absence alone is not censorship ──
  {
    const { availableBySeal: _drop, ...noWitness } = baseClaim
    void _drop
    const v = verifyCensorship(noWitness as typeof baseClaim, RULES)
    ok(v.censored === false && /availability is not/.test(v.reason), 'no availability witness → absence alone is not proof (the honest 3b/ADR-2 dependency)')
  }

  // ── a TAMPERED absence proof is refused ──
  {
    const bad = { present: absence.present, siblings: absence.siblings.slice() }
    bad.siblings[40] = createHash('sha256').update('tamper').digest('hex')
    const v = verifyCensorship({ ...baseClaim, absenceProof: bad }, RULES)
    ok(v.censored === false && /absence proof does not verify/.test(v.reason), 'a tampered absence proof → refused (no forged censorship verdict)')
  }

  // ── CUMULATIVE ROOT — a writer who included the act in an EARLIER window is NOT convicted later ──
  // (the council's most severe vector: seal >= deadline is sound only under a cumulative/monotone root)
  {
    const onTime = act(A, C, 9n, 5, SEAL)                        // Alice's act, owed by SEAL, included on time
    // a CUMULATIVE root at a LATER seal contains every key included through that seal — including onTime
    const cumulativeKeys = [...keysIn, RULES.keyOf(onTime)]      // window at SEAL+50 carries the earlier inclusion
    const laterSeal = SEAL + 50
    const cumRoot = inclusionRoot(cumulativeKeys)
    const cumCommit = windowCommitment(laterSeal, cumRoot)
    const proofAtLater = proveKey(cumulativeKeys, RULES.keyOf(onTime))   // a MEMBERSHIP proof — the key is present
    const claim = { act: onTime, seal: laterSeal, inclusionRoot: cumRoot, anchoredCommitment: cumCommit, absenceProof: proofAtLater, availableBySeal: SEAL - 1 }
    const v = verifyCensorship(claim, RULES)
    ok(v.censored === false && /absence proof does not verify/.test(v.reason),
      'an act included on time is PRESENT in every later cumulative root → cannot be framed as censored from a later window')
  }

  // ── SIGNED DEADLINE — stamping a new deadline onto a valid act breaks its signature (contract obligation) ──
  {
    const victim = act(A, B, 10n, 0, SEAL + 100)                 // Alice's act, real deadline far in the future
    const stamped = { ...victim, deadlineSeal: SEAL }            // a stranger stamps an aggressive deadline (no re-sign)
    // keyOf/isValid read the deadline from the SIGNED message, so the stamp does not match the signature
    const claim = { act: stamped, seal: SEAL, inclusionRoot: root, anchoredCommitment: commit, absenceProof: proveKey(keysIn, RULES.keyOf(stamped)), availableBySeal: SEAL - 1 }
    const v = verifyCensorship(claim, RULES)
    ok(v.censored === false && /signature does not verify/.test(v.reason),
      'a stranger cannot stamp a new deadline — the deadline is inside the signed bytes, so tampering it breaks isValid')
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — a valid public act dropped is undeniable; a false accusation is impossible. Censorship is evidence. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
