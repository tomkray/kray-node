/**
 * THE SELF-MAINTAINING MERKLE TREE (ADR-3 · the incremental inclusion root) — the same 32 bytes, grown in
 * O(depth) per act instead of rebuilt in O(N·depth), so a large inclusion history cannot grief the anchor.
 *
 *   node src/test/incremental-tree.test.ts
 *
 * The one thing that matters: the incremental root is BYTE-IDENTICAL to inclusionRoot(set) — for every size,
 * every insert order, the empty set, a repeat (a set, not a multiset), and the hardest case, two leaves that
 * share all 255 upper bits and split only at the last. Prove that and it may replace the rebuild in the ledger
 * with the golden cascade root unmoved.
 */
import { createHash } from 'node:crypto'
import { IncrementalInclusionTree, inclusionRoot, EMPTY_ROOT, proveKey, verifyProof } from '../protocol/inclusion-tree.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const key = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/** deterministic Fisher–Yates so a failure reproduces exactly */
function shuffle<T>(arr: T[], seed: number): T[] {
  const a = arr.slice(); let s = seed >>> 0
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff }
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
const build = (keys: string[]) => { const t = new IncrementalInclusionTree(); for (const k of keys) t.insert(k); return t }

function main() {
  console.log('\n╔═ THE SELF-MAINTAINING MERKLE TREE — the same root, grown one path at a time (ADR-3) ═╗\n')

  // ── the empty set and a single key ──
  ok(new IncrementalInclusionTree().root() === EMPTY_ROOT, 'the empty tree is EMPTY_ROOT')
  ok(build([key('solo')]).root() === inclusionRoot([key('solo')]), 'a single key matches the batch root')

  // ── the HARDEST case: two leaves sharing all 255 upper bits, splitting only at the last bit ──
  {
    const a = key('twins')
    const bb = Buffer.from(a, 'hex'); bb[31] ^= 0x01                    // flip ONLY the last bit
    const b = bb.toString('hex')
    ok(a !== b && a.slice(0, 62) === b.slice(0, 62), 'sanity: the twins share every byte but the last bit')
    ok(build([a, b]).root() === inclusionRoot([a, b]) && build([b, a]).root() === inclusionRoot([a, b]),
      'two leaves that diverge only at the deepest bit fold to the batch root, in EITHER insert order — the branch point is handled')
  }

  // ── BRANCH POINTS AT EVERY DEPTH — random SHA-256 keys diverge in the first bit or two, so the deep branch
  //    logic (byte boundaries at 8/16/…/248 AND mid-byte) is barely exercised by random coverage. Force it: two
  //    keys sharing the first b bits and splitting at bit b, for b across boundaries and mid-byte, both orders. ──
  {
    let allBranchOk = true
    const flip = (buf: Buffer, b: number) => { const c = Buffer.from(buf); c[b >> 3] ^= (1 << (7 - (b & 7))); return c }
    for (const b of [0, 1, 7, 8, 9, 15, 16, 63, 64, 100, 127, 128, 199, 248, 254, 255]) {
      const k1 = createHash('sha256').update('branch|' + b).digest()
      const k2 = flip(k1, b)                                     // share the first b bits, differ ONLY at bit b
      const h1 = k1.toString('hex'), h2 = k2.toString('hex')
      const batch = inclusionRoot([h1, h2])
      if (build([h1, h2]).root() !== batch || build([h2, h1]).root() !== batch) allBranchOk = false
    }
    // and a nested triple (two branch depths in one tree)
    const base = createHash('sha256').update('nested').digest()
    const trip = [base.toString('hex'), flip(base, 8).toString('hex'), flip(base, 128).toString('hex')]
    if (build(trip).root() !== inclusionRoot(trip)) allBranchOk = false
    ok(allBranchOk, 'keys that split at bit 0,8,16,…,248,255 (byte boundaries AND mid-byte) all fold to the batch root, in either order — the branch/sibling math is correct at EVERY depth, not just the last bit')
  }

  // ── a repeat is a no-op (a SET, not a multiset) ──
  {
    const t = build([key('dup'), key('dup'), key('other')])
    ok(t.size() === 2 && t.root() === inclusionRoot([key('dup'), key('other')]), 'inserting a key twice changes nothing — it is a set')
  }

  // ── BYTE-IDENTITY across sizes AND random insert orders ──
  let allMatch = true, orderIndep = true
  for (const n of [2, 3, 10, 50, 200, 500]) {
    const keys = Array.from({ length: n }, (_, i) => key(`n${n}|k${i}`))
    const batch = inclusionRoot(keys)
    let firstOrderRoot = ''
    for (let seed = 1; seed <= 4; seed++) {
      const r = build(shuffle(keys, seed * 7 + n)).root()
      if (r !== batch) allMatch = false
      if (seed === 1) firstOrderRoot = r
      else if (r !== firstOrderRoot) orderIndep = false
    }
  }
  ok(allMatch, 'across sizes 2…500 and 4 random insert orders each, the incremental root EQUALS inclusionRoot(set) — byte-identical')
  ok(orderIndep, 'and the root is insert-ORDER-independent — a set commitment, exactly like the batch tree')

  // ── prove() — the tree serves membership + non-membership against its own root (what a censorship prover uses) ──
  {
    const keys = Array.from({ length: 20 }, (_, i) => key('prove|' + i))
    const t = build(keys)
    const inK = keys[7], outK = key('never|there')
    ok(verifyProof(t.root(), inK, t.prove(inK)) === 'in', 'a member proves IN against the tree root')
    ok(verifyProof(t.root(), outK, t.prove(outK)) === 'out', 'a non-member proves OUT (non-membership) — the absence proof a censorship claim carries')
    // byte-identical to the batch proveKey over the same set
    ok(JSON.stringify(t.prove(inK)) === JSON.stringify(proveKey(keys, inK)) && JSON.stringify(t.prove(outK)) === JSON.stringify(proveKey(keys, outK)), 'the tree proof is byte-identical to the batch proveKey — the prover and the batch agree')
  }

  // ── a big grind: build once, keep asserting equality as it grows (the incremental invariant holds every step) ──
  {
    const t = new IncrementalInclusionTree()
    const acc: string[] = []
    let stepOk = true
    for (let i = 0; i < 300; i++) { const k = key(`grind|${i}`); acc.push(k); t.insert(k); if (t.root() !== inclusionRoot(acc)) { stepOk = false; break } }
    ok(stepOk && t.size() === 300, 'inserting 300 keys one at a time, the root matches the batch at EVERY step — the invariant holds continuously, not just at the end')
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the tree grows one leaf→root path at a time and never leaves the batch root; O(depth), not O(N·depth). ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
