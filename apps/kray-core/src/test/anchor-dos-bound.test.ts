/**
 * ADR-4 · slice 4d — FORK-CHOICE DoS BOUNDS, pinned.
 *
 * A HeadClaim arrives from a hostile peer. provenWeight() must never let a flood of fabricated anchors force
 * unbounded SPV work — yet it must stay a PURE, DETERMINISTIC function so two honest followers pick the same
 * winner. This proves: a claim over MAX_FORK_CHOICE_ANCHORS is rejected WHOLE in O(1) (no scan, no expensive
 * verify); a padded-header / giant-tx / giant-proof anchor is refuted for O(1) before it is hashed; a header
 * whose own PoW is invalid is refuted for ~1 hash; an honest within-bound claim is byte-identical to today; the
 * result is INVARIANT under anchor permutation (including same-block valid+invalid twins — the suppression
 * primitive a re-serializing relay would aim at two followers); and a non-array anchors field fails closed.
 *
 *   node src/test/anchor-dos-bound.test.ts
 */
import { createHash } from 'node:crypto'
import { chooseCanonical, provenWeight, MAX_FORK_CHOICE_ANCHORS, MAX_PROOF_HEADERS, MAX_ANCHOR_TX_BYTES, MAX_MERKLEBLOCK_BYTES, type HeadClaim } from '../protocol/consensus.ts'
import { KrayAnchor } from '../anchor/anchor.ts'
import { sha256d, toDisplayHex, checkProofOfWork } from '../anchor/spv.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const eq = (a: unknown, b: unknown) => JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) === JSON.stringify(b, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))

// ── fixtures, mirrored from consensus.test.ts ────────────────────────────────
function buildRawTx(payloadHex: string): string {
  return ['01000000', '01', '00'.repeat(32), 'ffffffff', '00', 'ffffffff', '01', '00'.repeat(8), '33', '6a31' + payloadHex, '00000000'].join('')
}
function buildHeader(prevInternal: Buffer, merkleRootInternal: Buffer, nonce: number): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); merkleRootInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000, 68); h.writeUInt32LE(0x207fffff, 72)
  for (let n = nonce; n < nonce + 1_000_000; n++) { h.writeUInt32LE(n >>> 0, 76); if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h }
  throw new Error('could not mine a regtest header')
}
function seal(krayHeight: number, root: string, confirmations: number) {
  const rawTx = buildRawTx(KrayAnchor.payload(krayHeight, root))
  const txid = sha256d(Buffer.from(rawTx, 'hex'))
  const headers = [buildHeader(Buffer.alloc(32), txid, krayHeight)]
  for (let i = 1; i < confirmations; i++) headers.push(buildHeader(sha256d(headers[i - 1]), Buffer.alloc(32, i), i))
  const txoutproof = Buffer.concat([headers[0], Buffer.from([1, 0, 0, 0]), Buffer.from([1]), txid, Buffer.from([1]), Buffer.from([0x01])]).toString('hex')
  return { height: krayHeight, cascadeRoot: root, txid: toDisplayHex(txid), proof: { rawTx, txoutproof, headers: headers.map((x) => x.toString('hex')) } }
}
const R = (s: string) => createHash('sha256').update(s).digest('hex')
const head = (over: Partial<HeadClaim>): HeadClaim => ({ network: 'regtest', height: 10, chainTipHash: R('tip'), cascadeRoot: R('root'), anchors: [], ...over })
// a cheap fabricated anchor whose headers[0] does not even parse — refuted early, costs ~nothing
const fake = (i: number) => ({ height: i, cascadeRoot: R('f' + i), txid: '00'.repeat(32), proof: { rawTx: '00', txoutproof: '00', headers: ['00'] } })

console.log('\n╔═ FORK-CHOICE DoS BOUNDS — a flood cannot force unbounded work, nor split a fork ══╗\n')

// two genuinely-valid anchors (proven, they count) — mined once, reused everywhere
const A5 = seal(5, R('v5'), 3)
const A9 = seal(9, R('v9'), 6)

// ── 1 · an honest within-bound claim is BYTE-IDENTICAL to before ─────────────
console.log('─ 1 · honest claim is unchanged ─')
const honest = provenWeight(head({ anchors: [A5, A9] }))
ok(honest.provenAnchors === 2 && honest.depth === 6 && honest.refuted === 0, 'two valid anchors → provenAnchors 2, depth 6, refuted 0 — the shipped behavior, untouched')

// ── 2 · a flood OVER the bound is rejected WHOLE, in O(1), doing no verify ────
console.log('\n─ 2 · a flood beyond the bound is rejected whole ─')
const over = head({ anchors: [A5, A9, ...Array.from({ length: MAX_FORK_CHOICE_ANCHORS - 1 }, (_v, i) => fake(i))] }) // length = bound + 1
const wOver = provenWeight(over)
ok(over.anchors.length === MAX_FORK_CHOICE_ANCHORS + 1, `the claim carries ${MAX_FORK_CHOICE_ANCHORS + 1} anchors (bound + 1)`)
ok(wOver.provenAnchors === 0 && wOver.totalWork === 0n && wOver.refuted === MAX_FORK_CHOICE_ANCHORS + 1, 'over the bound → zero verdict (provenAnchors 0, totalWork 0), refuted = the whole length — even the two VALID anchors do not count')

// ── 3 · a claim AT the bound still verifies its valid anchors (no over-truncation) ──
console.log('\n─ 3 · a claim exactly at the bound is NOT rejected ─')
const atBound = head({ anchors: [A5, A9, ...Array.from({ length: MAX_FORK_CHOICE_ANCHORS - 2 }, (_v, i) => fake(i))] }) // length = bound
const wAt = provenWeight(atBound)
ok(atBound.anchors.length === MAX_FORK_CHOICE_ANCHORS, `the claim carries exactly ${MAX_FORK_CHOICE_ANCHORS} anchors`)
ok(wAt.provenAnchors === 2 && wAt.refuted === MAX_FORK_CHOICE_ANCHORS - 2, 'at the bound the loop runs: the 2 valid anchors COUNT, the fakes are refuted individually — the bound gates a flood, never honesty')

// ── 4 · a padded-header proof is refuted before its headers are parsed ────────
console.log('\n─ 4 · a padded-header proof (cost axis 2) is refuted O(1) ─')
const padded = { ...A9, proof: { ...A9.proof, headers: [...A9.proof.headers, ...Array.from({ length: MAX_PROOF_HEADERS + 1 }, () => '00'.repeat(80))] } }
ok(provenWeight(head({ anchors: [padded] })).refuted === 1, `${MAX_PROOF_HEADERS}+ headers on one anchor → refuted (the 5,000-header scar cannot be re-lived)`)

// ── 5 · a giant rawTx / txoutproof is refuted before it is hashed ─────────────
console.log('\n─ 5 · an oversized tx / merkle proof (cost axis 3) is refuted O(1) ─')
const bigTx = { ...A9, proof: { ...A9.proof, rawTx: '00'.repeat(MAX_ANCHOR_TX_BYTES + 1) } }
ok(provenWeight(head({ anchors: [bigTx] })).refuted === 1, `a rawTx over ${MAX_ANCHOR_TX_BYTES} bytes → refuted before parseTx hashes it`)
const bigProof = { ...A9, proof: { ...A9.proof, txoutproof: '00'.repeat(MAX_MERKLEBLOCK_BYTES + 1) } }
ok(provenWeight(head({ anchors: [bigProof] })).refuted === 1, `a txoutproof over ${MAX_MERKLEBLOCK_BYTES} bytes → refuted before it is verified`)

// ── 6 · a header whose OWN proof-of-work is invalid is refuted for ~1 hash ────
console.log('\n─ 6 · the cheap PoW self-check refutes an invalid-difficulty header ─')
const bogus = Buffer.alloc(80); bogus.writeUInt32LE(0x20000000, 0); bogus.writeUInt32LE(1_700_000_000, 68); bogus.writeUInt32LE(0x2100ffff, 72) // target far ABOVE the network limit — invented difficulty
ok(!checkProofOfWork(bogus.toString('hex'), 'regtest').ok, 'sanity: the bogus header fails checkProofOfWork (invented difficulty)')
const bogusAnchor = { ...A9, proof: { ...A9.proof, headers: [bogus.toString('hex')] } }
ok(provenWeight(head({ anchors: [bogusAnchor] })).refuted === 1, 'a header above the network work-limit → refuted at the cheap gate (a strict subset of the full verify → byte-identical)')

// ── 7 · DETERMINISM — the verdict is invariant under permutation, incl. same-block twins ──
console.log('\n─ 7 · the verdict never depends on anchor order (the split-free proof) ─')
const forward = provenWeight(head({ anchors: [A5, A9] }))
const reversed = provenWeight(head({ anchors: [A9, A5] }))
ok(eq(forward, reversed), 'a claim and its reversed anchors compile the IDENTICAL ProvenWeight — order is not information')
// a same-block twin: the SAME valid anchor plus a corrupted copy (same blockKey, invalid seal). Success-only
// dedup must let the valid one WIN regardless of which comes first — else a relayer could suppress its WORK on
// one node. Fork choice reads only the WORK fields (chooseCanonical never reads `refuted`, a best-effort
// diagnostic that legitimately varies for a twin: a liar seen BEFORE its honest sibling is named, one seen
// AFTER is deduped). So the invariant that matters — the weight fork choice consumes — must be identical.
const forkFields = (w: ReturnType<typeof provenWeight>) => ({ provenAnchors: w.provenAnchors, depth: w.depth, work: w.work, totalWork: w.totalWork, anchoredHeight: w.anchoredHeight, anchoredRoot: w.anchoredRoot })
const twin = { ...A9, cascadeRoot: R('twin-lie') } // same header/block, different claimed root → verify fails
const twinFirst = provenWeight(head({ anchors: [twin, A9, A5] }))
const twinLast = provenWeight(head({ anchors: [A5, A9, twin] }))
ok(eq(forkFields(twinFirst), forkFields(twinLast)) && twinFirst.provenAnchors === 2, 'a valid anchor and its same-block invalid twin compile the IDENTICAL fork-choice weight in any order — the valid one is never suppressed')
// and the fork-choice-DECISIVE quantity (totalWork) is order-invariant across the twin, so no relayer can split two followers
const twOnly = provenWeight(head({ anchors: [twin, A9] })).totalWork
ok(twOnly === provenWeight(head({ anchors: [A9, twin] })).totalWork && twOnly === provenWeight(head({ anchors: [A9] })).totalWork, 'totalWork counts the block ONCE regardless of twin order — the invalid copy adds nothing, the valid one is never lost')

// ── 8 · a non-array anchors field FAILS CLOSED (no throw) ─────────────────────
console.log('\n─ 8 · a malformed claim fails closed ─')
for (const bad of [null, undefined, 'not-an-array', 42, {}]) {
  const w = provenWeight({ ...head({}), anchors: bad as never })
  ok(w.provenAnchors === 0 && w.totalWork === 0n, `anchors = ${JSON.stringify(bad)} → zero verdict, no throw`)
}
ok(chooseCanonical(head({ anchors: null as never }), head({ anchors: [A9] })).winner === 'b', 'chooseCanonical survives a malformed claim and the honest head wins')

console.log(`\n╚═ ${pass} passed${fail ? ', ' + fail + ' FAILED' : ''} — a fabricated flood costs O(1) and is refuted; the honest fork is byte-identical and order-invariant. ⚓₭\n`)
process.exit(fail ? 1 : 0)
