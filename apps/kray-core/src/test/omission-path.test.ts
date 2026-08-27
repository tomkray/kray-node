/**
 * THE OMISSION PATH, END TO END (ADR-3 · the fifth link — proven LIVE, not just per-piece) — every primitive
 * built across the pen-decentralization slices, composed into ONE realistic window and one anchored verdict.
 *
 *   node src/test/omission-path.test.ts
 *
 * Each piece was proven ALONE (window-order 18/18, inclusion-tree/cascade, window-commitment, availability,
 * censorship-live/anchored, eligibility 13/13). This exam proves they INTERLOCK — that a single assembled
 * window flows through the SAME keys the whole way:
 *
 *   3c orderWindow (B)  →  ordered/deferred, the writer's applied set
 *      ↓ (the applied keys)
 *   3a inclusionRoot (A)  →  the committed set  →  3d windowCommitment  →  folded into a cascade root
 *      ↓ (opened)                                                            ↓ (anchored to Bitcoin)
 *   buildCensorshipClaim (the prover)  →  verifyCensorshipAnchored (the verifier)  →  a Bitcoin-checkable verdict
 *      with the eligibility oracle (the 3c ⋈ 3d seam) derived from the SAME orderWindow output.
 *
 * ONE window, ONE cascade opening, ONE availability layer. The verdict must be right for FOUR absent acts at once:
 *   · an ELIGIBLE act the writer refused          → CENSORED (real omission is undeniable)
 *   · a refused nonce-free donation               → CENSORED (donations are always eligible)
 *   · a nonce-GAP act 3c honestly deferred        → NOT censored (the writer could not apply it)
 *   · a LOSING double-signed sibling              → NOT censored (its slot was filled)
 * All from the same anchored bytes, the eligibility read from the window's own applied order. The pieces are one.
 */
import { createHash } from 'node:crypto'
import { orderWindow, keyFromSignedMessage, type SignedAct, type WindowRules } from '../protocol/window-order.ts'
import { IncrementalInclusionTree, inclusionRoot } from '../protocol/inclusion-tree.ts'
import { IncrementalNonceMap } from '../protocol/nonce-map.ts'
import { buildCensorshipClaim, verifyCensorshipAnchored, windowCommitment, type CensorshipRules, type CensorshipProverState } from '../protocol/censorship-evidence.ts'
import { availabilityRoot, availabilityPayload, proveAvailability } from '../protocol/availability.ts'
import { cascadeRootFromParts, type CascadeParts } from '../protocol/cascade-root.ts'
import { sha256d, checkProofOfWork } from '../anchor/spv.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const SPV = { net: 'regtest', minConfirmations: 1 }

// ── the same real 2-tx Bitcoin availability block harness the anchored exam uses ──
function buildHeader(m: Buffer): Buffer {
  const hh = Buffer.alloc(80); hh.writeUInt32LE(0x20000000, 0); m.copy(hh, 36); hh.writeUInt32LE(1_700_000_000, 68); hh.writeUInt32LE(0x207fffff, 72)
  for (let n = 1; n < 4_000_000; n++) { hh.writeUInt32LE(n >>> 0, 76); if (checkProofOfWork(hh.toString('hex'), 'regtest').ok) return hh }
  throw new Error('mine')
}
function rawTx(ss: string, os: string): string {
  const s = Buffer.from(ss, 'hex'), o = Buffer.from(os, 'hex')
  return Buffer.concat([Buffer.from('01000000', 'hex'), Buffer.from('01', 'hex'), Buffer.alloc(32), Buffer.from('ffffffff', 'hex'), Buffer.from([s.length]), s, Buffer.from('ffffffff', 'hex'), Buffer.from('01', 'hex'), Buffer.alloc(8), Buffer.from([o.length]), o, Buffer.from('00000000', 'hex')]).toString('hex')
}
/** anchor `availKey` in a real regtest block at height `h` (the citizen's own availability witness) */
function availAt(h: number, availKey: string) {
  const availRoot = availabilityRoot([availKey])
  const membership = proveAvailability([availKey], availKey)
  const b = Buffer.alloc(4); b.writeUInt32LE(h); let n = 4; while (n > 1 && b[n - 1] === 0) n--
  const coinbaseTx = rawTx(Buffer.concat([Buffer.from([n]), b.subarray(0, n)]).toString('hex'), '51')
  const availTx = rawTx('00', '6a' + '2f' + availabilityPayload(availRoot))
  const l0 = sha256d(Buffer.from(coinbaseTx, 'hex')), l1 = sha256d(Buffer.from(availTx, 'hex'))
  const header = buildHeader(sha256d(Buffer.concat([l0, l1])))
  const mb = (f: number) => Buffer.concat([header, Buffer.from([2, 0, 0, 0]), Buffer.from([2]), l0, l1, Buffer.from([1]), Buffer.from([f])]).toString('hex')
  return { rawTx: availTx, txoutproof: mb(0x05), headers: [header.toString('hex')], coinbaseTx, coinbaseTxOutProof: mb(0x03), membership }
}

// ── the one signed-act model, used by EVERY primitive (this is the point — the keys are the same all the way) ──
interface Act extends SignedAct { from?: string; nonce?: number; deadline: number; salt?: string; label: string }
const signedMessage = (a: Act) =>
  typeof a.nonce === 'number' ? `${a.from}#${a.nonce}|deadline=${a.deadline}|v=${a.salt ?? ''}` : `donate|${a.label}|deadline=${a.deadline}`
const keyOf = (a: Act) => keyFromSignedMessage(signedMessage(a))
const START = new Map<string, number>([['A', 0], ['D', 0], ['V', 0]])

function main() {
  console.log('\n╔═ THE OMISSION PATH, END TO END — every ADR-3 primitive as ONE anchored verdict (the fifth link) ═╗\n')

  const DEADLINE = 900_000, SEAL = 950_000, PUBLIC_AT = 850_000

  // ── the window the writer assembles. Admitted (validly signed) acts; 3c decides what applies. ──
  const a0: Act = { from: 'A', nonce: 0, deadline: DEADLINE, label: 'A#0' }         // applies
  const aGap: Act = { from: 'A', nonce: 5, deadline: DEADLINE, label: 'A#5-gap' }   // deferred (gap)
  const dX: Act = { from: 'D', nonce: 0, deadline: DEADLINE, salt: 'x', label: 'D#0-x' }  // one of a double-sign
  const dY: Act = { from: 'D', nonce: 0, deadline: DEADLINE, salt: 'y', label: 'D#0-y' }  // the other
  const admitted = [a0, aGap, dX, dY]

  const winRules: WindowRules<Act> = { nonceOf: (addr) => START.get(addr) ?? 0, keyOf, isValid: () => true }
  const { ordered, deferred } = orderWindow(admitted, winRules)
  ok(ordered.length === 2, '3c (B): the window applies exactly the eligible acts (A#0 and one D#0 sibling)')
  ok(deferred.some((a) => a.label === 'A#5-gap') && deferred.some((a) => a.label.startsWith('D#0')), '3c (B): the nonce gap AND the losing double-sign sibling are DEFERRED (admitted, not applied)')
  const dWinner = ordered.find((a) => a.from === 'D')!, dLoser = deferred.find((a) => a.from === 'D')!

  // ── 3a (A): the inclusion tree over the APPLIED keys; 3d: the window commitment; the eligibility opening: the
  //    nonce map over the applied accounts, stamped at a seal ≤ the deadline; all fold into one cascade root. ──
  const tree = new IncrementalInclusionTree()
  for (const a of ordered) tree.insert(keyOf(a))
  const windowSeals = [windowCommitment(SEAL, tree.root())]
  const appliedCount = (from: string) => ordered.filter((a) => a.from === from).length
  const STAMP = 850_000   // the seal height that anchored these nonces — ≤ DEADLINE, so expected@deadline = the map nonce
  const nonceMap = new IncrementalNonceMap()
  for (const from of new Set(ordered.map((a) => a.from).filter((f): f is string => !!f))) {
    nonceMap.update(from, (START.get(from) ?? 0) + appliedCount(from), STAMP)   // A→(1,850k), D→(1,850k)
  }
  nonceMap.update('W', 1, 970_000)   // W reached nonce 1 only at a seal AFTER the deadline (a late predecessor)
  const parts: CascadeParts = {
    seq: 7, emitted: '10000', burned: '0', moneyRoot: 'money', starsRoot: 'stars',
    potCommitment: 'pot', runesCommitment: 'runes', contractsRoot: '',
    inclusionRoot: tree.root(), windowRoot: inclusionRoot(windowSeals), nonceRoot: nonceMap.root(),
  }
  const anchoredCascadeRoot = cascadeRootFromParts(parts)   // = the 32 bytes Bitcoin would seal
  const state: CensorshipProverState = { seal: SEAL, inclusionTree: tree, windowSeals, cascadeParts: parts, anchoredCascadeRoot, nonceMap }

  // ── the rules carry NO caller eligibility oracle — verifyCensorshipAnchored DERIVES expected@deadline
  //    trustlessly from the anchored nonce root (the whole point of the opening). ──
  const rules: CensorshipRules<Act> = { keyOf, isValid: () => true, deadlineOf: (a) => a.deadline }

  // ── the VICTIMS (absent from the window). Each is anchored available by PUBLIC_AT ≤ DEADLINE, then run
  //    through the PROVER → the ANCHORED VERIFIER. One window, one cascade, one availability layer. ──
  const verdict = (act: Act) => verifyCensorshipAnchored(buildCensorshipClaim(act, availAt(PUBLIC_AT, keyOf(act)), state, rules), rules, SPV)

  // 1 · an ELIGIBLE act the writer refused (V#0, V's expected nonce is 0) → CENSORED
  const vic: Act = { from: 'V', nonce: 0, deadline: DEADLINE, label: 'V#0-refused' }
  const vVic = verdict(vic)
  ok(vVic.censored === true, 'CENSORED — an ELIGIBLE act the writer refused (V#0) is undeniable: prover assembles from the window state, the anchored verifier confirms from Bitcoin bytes')

  // 2 · a refused nonce-free donation → CENSORED (always eligible)
  const don: Act = { deadline: DEADLINE, label: 'donation-refused' }
  ok(verdict(don).censored === true, 'CENSORED — a refused nonce-free donation is undeniable too (donations are always eligible; the gate does not blind real omission)')

  // 3 · the nonce-GAP act 3c deferred → NOT censored (the writer could not apply nonce 5)
  const vGap = verdict(aGap)
  ok(vGap.censored === false && /GAP above/.test((vGap as { reason: string }).reason), 'NOT censored — the nonce-gap act 3c deferred (A#5) is excused by the eligibility seam: the writer honestly waited, not censorship')

  // 4 · the LOSING double-signed sibling → NOT censored (its nonce slot was filled)
  const vLoser = verdict(dLoser)
  ok(vLoser.censored === false && /already been filled|already filled|below the account/.test((vLoser as { reason: string }).reason), 'NOT censored — the losing double-signed sibling (D#0 loser) is excused: its slot was filled by the winner')

  // 5 · and the coherence check: the winner IS in the tree, so even anchored it cannot be framed (absence fails)
  const vWinner = verdict(dWinner)
  ok(vWinner.censored === false, 'NOT censored — the APPLIED double-sign winner is present in the anchored inclusion root, so no absence proof frames it')

  // 6 · DEADLINE, not accusing-seal — W#1's predecessor W#0 anchored only AFTER the deadline (h_W = 970k > D),
  //     so W#1 was not yet eligible by D. The sticky first-anchor height, read from the SAME anchored opening,
  //     acquits it — a seal-measured gate would falsely convict. This is the whole reason for the stamp.
  const late: Act = { from: 'W', nonce: 1, deadline: DEADLINE, label: 'W#1-late-predecessor' }
  ok(verdict(late).censored === false, 'NOT censored — a frontier act whose predecessor anchored only AFTER the deadline (h_A > D) is acquitted: eligibility is measured at the deadline via the sticky stamp, not the accusing seal')

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the pen-decentralization primitives are ONE path: a single window's applied order feeds the inclusion root, the cascade opening, and the eligibility gate, and the anchored verdict is right for every absent act at once. The fifth link holds. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
