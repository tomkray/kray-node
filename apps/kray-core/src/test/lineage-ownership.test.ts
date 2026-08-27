/**
 * LINEAGE OWNERSHIP — the parent is yours, or the child is not born.
 *
 * The HTTP door is courtesy. This file is the reducer: a signed lie about
 * parentage throws BEFORE any burn, and the cascade root stays byte-identical.
 * Replay of the honest journal re-derives the same root (Supreme Law).
 *
 *   node src/test/lineage-ownership.test.ts
 *
 * L1 ordinal parentage is proveParentControl from Bitcoin bytes — a signed
 * origins list without the SPV bag never applies (live or replay).
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, scriptOfAddress,
  inscribeMessageV2, inscribeMessageV3, inscribeMessageV4, inscribeMessageV6, originCohortRootOf, sendStarMessage,
} from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'
import { authorHeldOriginProof, revealHeldOriginProof } from './ordinal-proof-fixture.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
function wallet(tag: string) {
  const sk = createHash('sha256').update('lineage-own|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function main() {
  console.log('\n╔═ LINEAGE OWNERSHIP — reducer proof · cascade root frozen under attack ═╗\n')
  const A = wallet('alice'), B = wallet('bob'), M = wallet('mallory')
  const L = new KrayLedger(undefined, NET)
  const journal: KrayEvent[] = []
  let seq = 0
  const donate = (to: string, amount: string, tag: string) => {
    const e = { seq: ++seq, kind: 'donate', hash: sha('d|' + tag), to, amount } as KrayEvent
    L.applyLive(e); journal.push(e)
  }
  const signA = (fields: Record<string, unknown>, buildMsg: (n: number) => string) => {
    const n = L.nonceOf(A.addr)
    return {
      seq: ++seq, at: 0, from: A.addr, publicKey: A.pk, signature: _signKrayWallet(buildMsg(n), A.sk), scheme: 'kraywallet',
      ...fields, nonce: n,
    } as unknown as KrayEvent
  }
  const signW = (w: ReturnType<typeof wallet>, fields: Record<string, unknown>, buildMsg: (n: number) => string) => {
    const n = L.nonceOf(w.addr)
    return {
      seq: ++seq, at: 0, from: w.addr, publicKey: w.pk, signature: _signKrayWallet(buildMsg(n), w.sk), scheme: 'kraywallet',
      ...fields, nonce: n,
    } as unknown as KrayEvent
  }
  const applyHonest = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }

  donate(A.addr, '100', 'A')
  donate(B.addr, '100', 'B')
  donate(M.addr, '100', 'M')

  const chP = sha('parent-a')
  applyHonest(signA({ kind: 'inscribe', hash: 'pA', contentHash: chP, contentType: 'text/plain', size: 8 },
    (n) => inscribeMessageV2(NET, A.addr, chP, 'text/plain', 8, undefined, n)))
  const chQ = sha('parent-b')
  applyHonest(signW(B, { kind: 'inscribe', hash: 'pB', contentHash: chQ, contentType: 'text/plain', size: 8 },
    (n) => inscribeMessageV2(NET, B.addr, chQ, 'text/plain', 8, undefined, n)))
  ok(L.stars.ownerOf(0n) === A.addr && L.stars.ownerOf(1n) === B.addr, 'Alice holds #0 · Bob holds #1')
  ok(L.conserves(), 'conserves after the two roots')

  const snap = () => ({ root: L.cascadeRoot(), burned: L.totalBurned, stars: L.stars.starCount, created: L.stars.createdSeq })
  const frozen = (before: ReturnType<typeof snap>, m: string) => {
    const after = snap()
    ok(after.root === before.root && after.burned === before.burned && after.stars === before.stars && after.created === before.created, m)
  }

  // ── every steal is a signed lie — the root does not move ──
  const s0 = snap()
  const chSteal = sha('steal-v3')
  rejects(() => L.applyLive(signW(M, {
    kind: 'inscribe', hash: 'st3', contentHash: chSteal, contentType: 'text/plain', size: 8, parents: ['0'],
  }, (n) => inscribeMessageV3(NET, M.addr, chSteal, 'text/plain', 8, ['0'], [], n))),
    /only the owner of star #0/, 'Mallory v3 parents:[0] — reducer throws')
  frozen(s0, 'Mallory v3 steal → cascade root / fire / createdSeq byte-identical')

  const chV2 = sha('steal-v2')
  rejects(() => L.applyLive(signW(M, {
    kind: 'inscribe', hash: 'st2', contentHash: chV2, contentType: 'text/plain', size: 8, parent: '0',
  }, (n) => inscribeMessageV2(NET, M.addr, chV2, 'text/plain', 8, 0n, n))),
    /only the owner of star #0/, 'Mallory v2 singular parent #0 — reducer throws')
  frozen(s0, 'Mallory v2 steal → still frozen')

  const chMix = sha('mix')
  rejects(() => L.applyLive(signA({
    kind: 'inscribe', hash: 'mix', contentHash: chMix, contentType: 'text/plain', size: 8, parents: ['0', '1'],
  }, (n) => inscribeMessageV3(NET, A.addr, chMix, 'text/plain', 8, ['0', '1'], [], n))),
    /only the owner of star #1/, 'Alice claiming Bob\'s #1 in the same list — the whole act refuses')
  frozen(s0, 'partial claim (one owned, one not) → no child, no burn')

  const chGhost = sha('ghost')
  rejects(() => L.applyLive(signA({
    kind: 'inscribe', hash: 'gh', contentHash: chGhost, contentType: 'text/plain', size: 8, parents: ['99'],
  }, (n) => inscribeMessageV3(NET, A.addr, chGhost, 'text/plain', 8, ['99'], [], n))),
    /does not exist/, 'a parent that was never born is refused')
  frozen(s0, 'ghost parent → frozen')

  const chDup = sha('dup')
  rejects(() => L.applyLive(signA({
    kind: 'inscribe', hash: 'dup', contentHash: chDup, contentType: 'text/plain', size: 8, parents: ['0', '0'],
  }, (n) => inscribeMessageV3(NET, A.addr, chDup, 'text/plain', 8, ['0', '0'], [], n))),
    /duplicate/, 'the same parent twice is malformed — refused before ownership')
  frozen(s0, 'duplicate parents → frozen')

  // sign empty lineage, submit with a parent list — the signed string does not match
  const chInj = sha('inject')
  const nInj = L.nonceOf(A.addr)
  const inj = {
    seq: ++seq, at: 0, from: A.addr, publicKey: A.pk, scheme: 'kraywallet', nonce: nInj,
    kind: 'inscribe', hash: 'inj', contentHash: chInj, contentType: 'text/plain', size: 8,
    parents: ['0'],
    signature: _signKrayWallet(inscribeMessageV3(NET, A.addr, chInj, 'text/plain', 8, [], [], nInj), A.sk),
  } as unknown as KrayEvent
  rejects(() => L.applyLive(inj), /verif|signat|message/i, 'unsigned parent list on submit — signature fails')
  frozen(s0, 'lineage injection → frozen')

  // metadata is not lineage
  const metaLie = '{"parents":["0","1"],"origin":"aa"}'
  const chMeta = sha('meta-lie')
  applyHonest(signA({
    kind: 'inscribe', hash: 'ml', contentHash: chMeta, contentType: 'text/plain', size: 8, meta: metaLie,
  }, (n) => inscribeMessageV4(NET, A.addr, chMeta, 'text/plain', 8, [], [], metaLie, n)))
  const metaStar = L.stars.star(2n)
  ok(metaStar != null && metaStar.meta === metaLie, 'a document may TALK about parents')
  ok(!metaStar!.parents && metaStar!.parent == null, '…but the star is a ROOT — meta never writes the family')

  // ── the owner moves, the right to father moves ──
  applyHonest(signW(B, {
    kind: 'transfer-star', hash: 'mv', to: A.addr, star: '1', fee: '1',
  }, (n) => sendStarMessage(NET, B.addr, A.addr, 1n, n)))
  ok(L.stars.ownerOf(1n) === A.addr, 'Bob sent #1 to Alice — she now holds both parents')

  const s1 = snap()
  const chOld = sha('bob-after')
  rejects(() => L.applyLive(signW(B, {
    kind: 'inscribe', hash: 'bo', contentHash: chOld, contentType: 'text/plain', size: 8, parents: ['1'],
  }, (n) => inscribeMessageV3(NET, B.addr, chOld, 'text/plain', 8, ['1'], [], n))),
    /only the owner of star #1/, 'after the send, Bob can no longer father from #1')
  frozen(s1, 'ex-owner steal → frozen')

  const chKid = sha('two-hands')
  applyHonest(signA({
    kind: 'inscribe', hash: 'kid', contentHash: chKid, contentType: 'text/plain', size: 8, parents: ['0', '1'],
  }, (n) => inscribeMessageV3(NET, A.addr, chKid, 'text/plain', 8, ['0', '1'], [], n)))
  const kid = L.stars.star(3n)
  ok(kid != null && (kid.parents || []).map(String).join(',') === '0,1', 'Alice, holding both, fathers the child — parents are the signed list')
  ok(L.stars.childrenOf(0n).map(String).includes('3') && L.stars.childrenOf(1n).map(String).includes('3'),
    'the child shines under BOTH parents')

  // ── L1 ordinal parent — SPV control, or it is not a parent ──
  const aliceScript = scriptOfAddress(A.addr, 'regtest')
  const held = authorHeldOriginProof(aliceScript, { confirmations: 1, salt: 'alice-l1' })
  const l1 = held.parentId
  const sL1 = snap()

  const chBare = sha('l1-bare')
  rejects(() => L.applyLive(signW(M, {
    kind: 'inscribe', hash: 'l1b', contentHash: chBare, contentType: 'text/plain', size: 8, origins: [l1],
  }, (n) => inscribeMessageV3(NET, M.addr, chBare, 'text/plain', 8, [], [l1], n))),
    /SPV control proof/, 'live apply of origins without a bag — reducer throws')
  frozen(sL1, 'unsigned L1 claim → cascade root / fire / createdSeq byte-identical')

  const chStealL1 = sha('l1-steal')
  rejects(() => L.applyLive(signW(M, {
    kind: 'inscribe', hash: 'l1s', contentHash: chStealL1, contentType: 'text/plain', size: 8,
    origins: [l1], originProofs: [held.proof],
  }, (n) => inscribeMessageV3(NET, M.addr, chStealL1, 'text/plain', 8, [], [l1], n))),
    /not proven|holder-not-authors/, 'Mallory + Alice\'s valid bag — holder does not pay Mallory')
  frozen(sL1, 'Mallory L1 steal → frozen')

  const chL1 = sha('l1-honest')
  applyHonest(signA({
    kind: 'inscribe', hash: 'l1', contentHash: chL1, contentType: 'text/plain', size: 8,
    origins: [l1], originProofs: [held.proof],
  }, (n) => inscribeMessageV3(NET, A.addr, chL1, 'text/plain', 8, [], [l1], n)))
  ok(L.stars.star(4n)?.origins?.[0]?.l1InscriptionId === l1,
    'Alice + SPV bag → L1 child is born (proveParentControl in the reducer)')

  const chReuse = sha('l1-reuse')
  applyHonest(signA({
    kind: 'inscribe', hash: 'l1r', contentHash: chReuse, contentType: 'text/plain', size: 8,
    origins: [l1], originProofs: [held.proof],
  }, (n) => inscribeMessageV3(NET, A.addr, chReuse, 'text/plain', 8, [], [l1], n)))
  ok(L.stars.star(5n)?.origins?.[0]?.l1InscriptionId === l1,
    'the same send-to-self fathers a second L1 child — one blessing, many envelopes (unique content)')
  ok(L.stars.childrenOfOrigin(l1).map(String).join(',') === '4,5',
    'one L1 father indexes both daughters — the constellation is one family')

  const heldC = authorHeldOriginProof(aliceScript, { confirmations: 1, salt: 'alice-cohort' })
  const l1c = heldC.parentId
  const chC1 = sha('cohort-a'), chC2 = sha('cohort-b'), chC3 = sha('cohort-outsider')
  const cohortRoot = originCohortRootOf([chC1, chC2])
  applyHonest(signA({
    kind: 'inscribe', hash: 'c1', contentHash: chC1, contentType: 'text/plain', size: 8,
    origins: [l1c], originProofs: [heldC.proof], originCohort: [chC1, chC2], originCohortRoot: cohortRoot,
  }, (n) => inscribeMessageV6(NET, A.addr, chC1, 'text/plain', 8, [], [l1c], cohortRoot, n)))
  ok(L.stars.star(6n)?.origins?.[0]?.l1InscriptionId === l1c, 'opening act + SPV + cohort root → first L1 sibling')
  applyHonest(signA({
    kind: 'inscribe', hash: 'c2', contentHash: chC2, contentType: 'text/plain', size: 8,
    origins: [l1c], originCohortRoot: cohortRoot,
  }, (n) => inscribeMessageV6(NET, A.addr, chC2, 'text/plain', 8, [], [l1c], cohortRoot, n)))
  ok(L.stars.star(7n)?.origins?.[0]?.l1InscriptionId === l1c, 'sibling signs only the cohort root — derived L1 child, no second blessing')
  ok(L.stars.childrenOfOrigin(l1c).map(String).join(',') === '6,7',
    'cohort siblings share the same L1 children index')
  const sEcho = snap()
  rejects(() => L.applyLive(signA({
    kind: 'inscribe', hash: 'c2echo', contentHash: sha('cohort-echo'), contentType: 'text/plain', size: 8,
    origins: [l1c], originCohort: [chC1, chC2], originCohortRoot: cohortRoot,
  }, (n) => inscribeMessageV6(NET, A.addr, sha('cohort-echo'), 'text/plain', 8, [], [l1c], cohortRoot, n))),
    /only the opening act journals the origin cohort leaf list/,
    'a sibling that re-sends the leaf list (bodiesOf copy) is refused — the door must strip it')
  frozen(sEcho, 'echoed sibling leaf list → cascade frozen')
  const sCohort = snap()
  rejects(() => L.applyLive(signA({
    kind: 'inscribe', hash: 'c3', contentHash: chC3, contentType: 'text/plain', size: 8,
    origins: [l1c], originCohortRoot: cohortRoot,
  }, (n) => inscribeMessageV6(NET, A.addr, chC3, 'text/plain', 8, [], [l1c], cohortRoot, n))),
    /not in the blessed origin cohort/, 'a hash outside the committed set cannot ride the blessing')
  frozen(sCohort, 'outsider cohort leaf → cascade frozen')

  const sit = revealHeldOriginProof(aliceScript, { confirmations: 1, salt: 'sit-still' })
  const chSit = sha('l1-sit')
  rejects(() => L.applyLive(signA({
    kind: 'inscribe', hash: 'l1sit', contentHash: chSit, contentType: 'text/plain', size: 8,
    origins: [sit.parentId], originProofs: [sit.proof],
  }, (n) => inscribeMessageV3(NET, A.addr, chSit, 'text/plain', 8, [], [sit.parentId], n))),
    /parent-not-spent/, 'the reveal sitting still is not a blessing — the parent sat must be spent (send-to-self)')

  // genesis — a journal line with origins and no bag HALTs on a fresh walk too
  const Hostile = new KrayLedger(undefined, NET)
  for (const e of journal) Hostile.applyLive(e)
  const chEra = sha('l1-era')
  const oldId = 'cd'.repeat(32) + 'i0'
  const nEra = Hostile.nonceOf(A.addr)
  const oldShape = {
    seq: Hostile.appliedSeq + 1, at: 0, from: A.addr, publicKey: A.pk, scheme: 'kraywallet', nonce: nEra,
    kind: 'inscribe', hash: 'era', contentHash: chEra, contentType: 'text/plain', size: 8,
    origins: [oldId],
    signature: _signKrayWallet(inscribeMessageV3(NET, A.addr, chEra, 'text/plain', 8, [], [oldId], nEra), A.sk),
  } as unknown as KrayEvent
  const hostileBefore = Hostile.cascadeRoot()
  rejects(() => Hostile.applyLive(oldShape), /SPV control proof/, 'a journal line with origins and no bag HALTs — live or replay')
  ok(Hostile.cascadeRoot() === hostileBefore && Hostile.cascadeRoot() === L.cascadeRoot(),
    'the hostile line left the walker byte-identical to the honest journal')

  ok(L.conserves(), 'conserves after honest births and every refused steal')
  const reboot = new KrayLedger(undefined, NET)
  for (const e of journal) reboot.applyLive(e)
  ok(reboot.cascadeRoot() === L.cascadeRoot(), 'replay → cascade root byte-exact')
  ok(reboot.stars.merkleRoot() === L.stars.merkleRoot(), 'replay → star merkle byte-exact')
  ok(reboot.stars.ownerOf(1n) === A.addr && reboot.stars.star(3n)?.parents?.map(String).join(',') === '0,1',
    'replay → ownership and the two-parent child survive')
  ok(reboot.stars.star(2n)?.parent == null, 'replay → the meta-lie star is still a root')
  ok(reboot.stars.star(4n)?.origins?.[0]?.l1InscriptionId === l1, 'replay → proven L1 child survives')

  if (fail) { console.log('\n  ' + fail + ' failed · ' + pass + ' passed\n'); process.exit(1) }
  console.log('\n  ' + pass + ' passed — KRAY parentage and L1 ordinal control are reducer theorems.\n')
}
main()
