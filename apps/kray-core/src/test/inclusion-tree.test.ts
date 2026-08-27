/**
 * INCLUSION / ABSENCE — the accumulator that makes censorship provable (ADR-3 · slice 3a).
 *
 *   node src/test/inclusion-tree.test.ts
 *
 * A window's act set folds into ONE root that proves both directions and cannot be forged:
 *   · a key IN the set has a verifiable membership proof; a key OUT has a verifiable ABSENCE proof;
 *   · you cannot prove a present key absent, nor an absent key present (the whole point);
 *   · tampering any sibling, or swapping present/absent, is refused;
 *   · leaf-identity binding — one key's siblings cannot verify a different key;
 *   · domain separation is exercised directly (leaf tag ≠ node tag): the tags are distinct, the leaf
 *     and node hashes of the same payload differ, and the check regresses if the tags are ever equalised
 *     (the structural closure of the second-preimage pitfall — a live forge would need to invert SHA-256);
 *   · the root is INJECTIVE (under SHA-256) over the set and ORDER-INDEPENDENT (the complement of 3c);
 *   · the keys are real 3c signed-message hashes, so position = the act's own ungrindable identity.
 *
 * Pure — wired into no live path. This is the primitive slice 3d (inclusion deadlines → proof-of-
 * absence) will stand on, proven before it carries weight.
 */
import { createHash } from 'node:crypto'
import {
  inclusionRoot, proveKey, verifyInclusion, verifyExclusion, verifyProof, EMPTY_ROOT, SMT_DEPTH,
  _LEAF_TAG, _NODE_TAG, _leafHash, _nodeHash, type MerkleProof,
} from '../protocol/inclusion-tree.ts'
import { keyFromSignedMessage } from '../protocol/window-order.ts'
import { transferMessage } from '../protocol/scheme.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

// a realistic act-key set: 3c signed-message hashes for a handful of transfers
function keyFor(from: string, to: string, amount: bigint, nonce: number): string {
  return keyFromSignedMessage(transferMessage('regtest', from, to, amount, nonce))
}

function main() {
  console.log('\n╔═ INCLUSION / ABSENCE — one root proves both, and forges neither ═╗\n')

  const IN = [
    keyFor('alice', 'bob', 10n, 0), keyFor('alice', 'carol', 20n, 1),
    keyFor('bob', 'carol', 15n, 0), keyFor('carol', 'alice', 12n, 0),
    keyFor('carol', 'bob', 4n, 1),
  ]
  const OUT = [
    keyFor('mallory', 'bob', 99n, 0),          // never added — the censored act
    keyFor('alice', 'bob', 11n, 0),            // a near-miss (different amount → different key)
    sha('a key that is simply not here'),
  ]
  const root = inclusionRoot(IN)
  ok(/^[0-9a-f]{64}$/.test(root), 'the inclusion root is a 32-byte commitment')
  ok(inclusionRoot([]) === EMPTY_ROOT, 'the empty set has the fixed EMPTY_ROOT every node agrees on')

  // ── MEMBERSHIP — every key in the set proves IN ──
  let allIn = true
  for (const k of IN) { const p = proveKey(IN, k); if (!verifyInclusion(root, k, p) || p.siblings.length !== SMT_DEPTH) allIn = false }
  ok(allIn, `all ${IN.length} member keys carry a valid ${SMT_DEPTH}-level membership proof`)

  // ── ABSENCE — every key out of the set proves OUT ──
  let allOut = true
  for (const k of OUT) { const p = proveKey(IN, k); if (!verifyExclusion(root, k, p)) allOut = false }
  ok(allOut, 'every absent key carries a valid NON-membership (proof-of-absence) proof')

  // ── SOUNDNESS — you cannot prove the false direction ──
  {
    const memberK = IN[0], absentK = OUT[0]
    // (a) claim an ABSENT key is present: flip present=true on its (empty-leaf) proof
    const forgedPresent: MerkleProof = { ...proveKey(IN, absentK), present: true }
    ok(!verifyInclusion(root, absentK, forgedPresent) && verifyProof(root, absentK, forgedPresent) === null,
      'an absent key CANNOT be forged present — flipping the flag breaks the recompute')
    // (b) claim a PRESENT key is absent: flip present=false on its (present-leaf) proof
    const forgedAbsent: MerkleProof = { ...proveKey(IN, memberK), present: false }
    ok(!verifyExclusion(root, memberK, forgedAbsent) && verifyProof(root, memberK, forgedAbsent) === null,
      'a present key CANNOT be forged absent — the writer cannot deny a member')
  }

  // ── TAMPER — any altered sibling is refused ──
  {
    const k = IN[2], p = proveKey(IN, k)
    for (const lvl of [0, 128, SMT_DEPTH - 1]) {
      const bad = { present: p.present, siblings: p.siblings.slice() }
      bad.siblings[lvl] = sha('tampered@' + lvl)
      ok(verifyProof(root, k, bad) === null, `a flipped sibling at level ${lvl} is refused`)
    }
    ok(verifyProof(root, k, { present: p.present, siblings: p.siblings.slice(0, 10) }) === null, 'a short proof (wrong length) is refused')
  }

  // ── LEAF-IDENTITY BINDING — one key's siblings cannot verify a DIFFERENT key ──
  {
    const k = IN[1], p = proveKey(IN, k)
    const spoof: MerkleProof = { present: true, siblings: p.siblings.slice() }
    ok(verifyInclusion(root, k, p) === true, 'the honest member proof verifies (control)')
    ok(!verifyInclusion(root, sha('not-' + k), spoof), 'the SAME siblings do NOT verify a different key — the leaf is bound to the key, and the path to its bits')
  }

  // ── DOMAIN SEPARATION — the tags are distinct, exercised directly, and regress if equalised ──
  {
    ok(_LEAF_TAG !== _NODE_TAG, 'the leaf tag and the node tag are DISTINCT (this assertion fails the instant they are equalised — the regression catcher)')
    // leaf(k) and node(k,k) of the same key payload differ (by tag AND by preimage length)
    const k = IN[0]
    ok(_leafHash(k) !== _nodeHash(k, k), 'H(0x00‖k) ≠ H(0x01‖k‖k) — a leaf and an internal node of the same payload never collide')
    // the three canonical shapes an SMT hash can take are pairwise distinct 32-byte values
    const emptyLeafHex = '00'.repeat(32)
    const memberLeaf = _leafHash(k)
    const internalNode = _nodeHash(memberLeaf, emptyLeafHex)   // a real internal node value
    const shapes = new Set([emptyLeafHex, memberLeaf, internalNode])
    ok(shapes.size === 3, 'empty leaf, a member leaf, and an internal node are three pairwise-distinct values — no shape can masquerade as another')
    // and the API never lets an internal-node value sit at a leaf position: the verifier derives the leaf
    // from the key (leafOf), so presenting a node hash as a "key" that is not a real member proves OUT/refused
    ok(verifyProof(root, memberLeaf, proveKey(IN, memberLeaf)) !== 'in', 'an internal/among-tree hash value, used as a key, is not a member — the leaf is always key-derived, never caller-injected')
  }

  // ── INJECTIVITY + ORDER-INDEPENDENCE — the root is a SET commitment ──
  {
    ok(inclusionRoot(IN) === inclusionRoot([...IN].reverse()), 'the root is ORDER-INDEPENDENT — a commitment to the SET, not a list (complements 3c)')
    ok(inclusionRoot([...IN, IN[0]]) === root, 'a duplicate key does not change the set — the root is idempotent on repeats')
    const plusOne = inclusionRoot([...IN, OUT[0]])
    ok(plusOne !== root, 'adding one act CHANGES the root — under SHA-256 collision resistance, two different sets do not share a commitment')
    const minusOne = inclusionRoot(IN.slice(1))
    ok(minusOne !== root, 'removing one act changes the root — censorship of a member is not hideable in the commitment')
  }

  // ── a censored act, end to end: absent under this root, present the moment it is included ──
  {
    const censored = OUT[0]
    ok(verifyExclusion(root, censored, proveKey(IN, censored)), 'the censored act proves ABSENT against the published root (this is the 3d evidence)')
    const root2 = inclusionRoot([...IN, censored])
    ok(verifyInclusion(root2, censored, proveKey([...IN, censored], censored)), 'once included, the very same act proves PRESENT against the new root')
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — one root proves inclusion AND absence, forges neither, and injectively commits the set. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
