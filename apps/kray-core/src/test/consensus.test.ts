/**
 * CONSENSUS — two histories, one Bitcoin, and a rule nobody can argue with.
 *   node src/test/consensus.test.ts
 *
 * The operator used to be trusted about WHICH past is real. Now Bitcoin decides
 * and every follower computes the same answer offline, from bytes. This proves
 * the fork choice is total, deterministic, and unbribable: forged proofs weigh
 * nothing (and mark the liar), unanchored history never outranks anchored
 * history, and a dead tie is broken identically everywhere on earth.
 */
import { createHash } from 'node:crypto'
import { chooseCanonical, provenWeight, type HeadClaim } from '../protocol/consensus.ts'
import { KrayAnchor } from '../anchor/anchor.ts'
import { sha256d, toDisplayHex, checkProofOfWork } from '../anchor/spv.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}

// ── a synthetic, fully valid Bitcoin seal (the same shape spv.test.ts proves) ──
function buildRawTx(payloadHex: string): string {
  return ['01000000', '01', '00'.repeat(32), 'ffffffff', '00', 'ffffffff', '01', '00'.repeat(8), '33', '6a31' + payloadHex, '00000000'].join('')
}
/**
 * A MINED header. Fork choice now weighs proof-of-work rather than counting
 * headers, so a fixture must satisfy the target it declares — the `nonce`
 * argument becomes a starting point rather than the answer.
 */
function buildHeader(prevInternal: Buffer, merkleRootInternal: Buffer, nonce: number): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); merkleRootInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000, 68); h.writeUInt32LE(0x207fffff, 72)
  for (let n = nonce; n < nonce + 1_000_000; n++) {
    h.writeUInt32LE(n >>> 0, 76)
    if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h
  }
  throw new Error('could not mine a regtest header — impossible in practice')
}
function seal(krayHeight: number, root: string, confirmations: number) {
  const rawTx = buildRawTx(KrayAnchor.payload(krayHeight, root))
  const txid = sha256d(Buffer.from(rawTx, 'hex'))
  const h1 = buildHeader(Buffer.alloc(32), txid, krayHeight)
  const headers = [h1]
  for (let i = 1; i < confirmations; i++) headers.push(buildHeader(sha256d(headers[i - 1]), Buffer.alloc(32, i), i))
  const txoutproof = Buffer.concat([h1, Buffer.from([1, 0, 0, 0]), Buffer.from([1]), txid, Buffer.from([1]), Buffer.from([0x01])]).toString('hex')
  return { height: krayHeight, cascadeRoot: root, txid: toDisplayHex(txid), proof: { rawTx, txoutproof, headers: headers.map((x) => x.toString('hex')) } }
}
const R = (s: string) => createHash('sha256').update(s).digest('hex')
const head = (over: Partial<HeadClaim>): HeadClaim => ({ network: 'regtest', height: 10, chainTipHash: R('tip'), cascadeRoot: R('root'), anchors: [], ...over })

function main() {
  // ── 1 · WEIGHT IS MEASURED IN BITCOIN, NOT IN ASSERTIONS ─────────────────
  const honest = head({ anchors: [seal(5, R('a5'), 3), seal(9, R('a9'), 6)] })
  const w = provenWeight(honest)
  ok(w.provenAnchors === 2 && w.depth === 6 && w.anchoredHeight === 9 && w.work > 0n,
    `both anchors re-proved from bytes — heaviest carries ${w.work} of WORK across ${w.depth} confirmations at KRAY #${w.anchoredHeight}`)
  ok(w.refuted === 0, 'and nothing was refuted — an honest history says so in mathematics')

  // ── 2 · THE DEEPEST BITCOIN ANCHOR WINS ──────────────────────────────────
  const shallow = head({ chainTipHash: R('shallow'), anchors: [seal(9, R('b9'), 2)] })
  const v1 = chooseCanonical(honest, shallow)
  // the rule is WORK now, not a header count: a count was forgeable in
  // milliseconds, and the whole 'Bitcoin is the referee' claim rested on it
  ok(v1.winner === 'a' && /work/i.test(v1.why), `BITCOIN IS THE REFEREE — ${v1.why}`)
  ok(chooseCanonical(shallow, honest).winner === 'b', 'and the verdict does not depend on argument order — it is a function, not an opinion')

  // ── 3 · A TALLER, UNANCHORED HISTORY LOSES TO A WITNESSED ONE ────────────
  const tallLiar = head({ height: 10_000, chainTipHash: R('tall'), anchors: [] })
  const v2 = chooseCanonical(tallLiar, shallow)
  ok(v2.winner === 'b', 'a chain 1,000× taller but UNWITNESSED loses to one Bitcoin saw — length is not proof')

  // ── 4 · FORGED PROOFS WEIGH NOTHING, AND NAME THE LIAR ───────────────────
  const forged = seal(9, R('b9'), 6)
  const swapped = { ...forged, cascadeRoot: R('a-root-i-never-anchored') } // claim a different root under a real proof
  const cheat = head({ chainTipHash: R('cheat'), anchors: [swapped] })
  const wc = provenWeight(cheat)
  ok(wc.provenAnchors === 0 && wc.refuted === 1 && wc.depth === 0, 'a FORGED anchor proves nothing and is COUNTED as refuted — a liar is lighter, never heavier')
  ok(chooseCanonical(honest, cheat).winner === 'a', 'so the forger loses the fork outright')

  // truncating the burying headers below the law's depth is also worthless
  const shallowProof = { ...forged, proof: { ...forged.proof, headers: forged.proof.headers.slice(0, 1) } }
  ok(provenWeight(head({ anchors: [shallowProof] })).refuted === 1, 'an anchor buried less deep than the law demands → refuted, not merely ignored')

  // ── 5 · EVERY TIE IS BROKEN IDENTICALLY, EVERYWHERE ──────────────────────
  const t1 = head({ chainTipHash: 'aa'.repeat(32), anchors: [seal(9, R('same'), 6)] })
  const t2 = head({ chainTipHash: 'bb'.repeat(32), anchors: [seal(9, R('same'), 6)] })
  const tie = chooseCanonical(t1, t2)
  ok(tie.winner === 'a' && chooseCanonical(t2, t1).winner === 'b', 'a DEAD TIE resolves to the same head from both sides — no coin flip, no permanent split')
  const taller = head({ height: 20, chainTipHash: R('taller'), anchors: [seal(9, R('same'), 6)] })
  ok(chooseCanonical(taller, t1).winner === 'a' && /taller/.test(chooseCanonical(taller, t1).why), 'equally witnessed histories are separated by height — and only then')

  // ── 6 · TOTALITY — the rule always answers, and never mixes networks ─────
  ok(chooseCanonical(honest, honest).winner === 'a', 'the same history against itself: nothing to choose, still an answer')
  ok(chooseCanonical(head({ anchors: [] }), head({ chainTipHash: R('x'), anchors: [] })).winner !== undefined, 'two unwitnessed histories still resolve — the function is TOTAL')
  try { chooseCanonical(honest, { ...shallow, network: 'signet' }); ok(false, 'unreachable') } catch (e) {
    ok(/different networks/.test((e as Error).message), 'heads from different networks are refused, not silently compared')
  }

  // ── THE FORGED CHAIN MUST LOSE — the attack that broke fork choice ────────
  // 5,000 chained headers were fabricated in TEN MILLISECONDS with zero
  // hashpower, and the old rule — which compared header COUNTS — preferred them
  // over an honest chain. Anyone could rewrite history for free. Now the rule is
  // cumulative work, so a chain that cost nothing wins nothing.
  {
    const forged = (() => {
      const out: string[] = []
      let prev = Buffer.alloc(32)
      for (let i = 0; i < 300; i++) {
        const h = Buffer.alloc(80)
        h.writeUInt32LE(0x20000000, 0); prev.copy(h, 4)
        h.writeUInt32LE(1_700_000_000, 68); h.writeUInt32LE(0x207fffff, 72); h.writeUInt32LE(i, 76)
        out.push(h.toString('hex')); prev = sha256d(h)
      }
      return out
    })()
    const honestHead = head({ height: 10, anchors: [seal(9, R('root'), 3)] })
    const attacker = head({
      height: 10,
      anchors: [{ ...seal(9, R('evil'), 1), proof: { ...seal(9, R('evil'), 1).proof!, headers: [seal(9, R('evil'), 1).proof!.headers[0], ...forged] } }],
    })
    const wAtk = provenWeight(attacker)
    ok(wAtk.provenAnchors === 0 && wAtk.refuted === 1 && wAtk.work === 0n,
      `a chain of ${forged.length} FABRICATED headers weighs NOTHING and is marked refuted — an unmined header is not a confirmation, however many follow it`)
    const verdict = chooseCanonical(honestHead, attacker)
    ok(verdict.winner === 'a', 'the honest chain WINS against 300 free headers — under the old count-based rule it lost, and history was rewritable by anyone with a for-loop')
  }

  // ── THE FREE INTEGER MUST NOT DECIDE ─────────────────────────────────────
  // `anchoredHeight` is the KRAY height inside an anchor's OP_RETURN. It IS
  // committed to Bitcoin — and committed is not EARNED: one cheap transaction
  // declares any number, and nothing ties "I sealed height 999,999" to having
  // lived 999,999 blocks. So the ladder is ranked by price, and a lone anchor
  // claiming a colossal height must lose to a history Bitcoin attended more.
  {
    const honest = head({ height: 10, anchors: [seal(3, R('h1'), 3), seal(6, R('h2'), 3), seal(9, R('h3'), 3)] })
    const liar = head({ height: 10, anchors: [seal(999_999, R('evil'), 3)] })
    const v = chooseCanonical(honest, liar)
    ok(v.winner === 'a', 'a lone anchor claiming KRAY height 999,999 LOSES to three honestly anchored ones — the height is free, the anchors are not')
    ok(/attended one MORE in total/.test(v.why), `…and the reason names the costly quantity: ${v.why.slice(0, 72)}…`)
    const wH = provenWeight(honest)
    ok(wH.totalWork > provenWeight(liar).totalWork, `summed work ${wH.totalWork} vs ${provenWeight(liar).totalWork} — every unit bought with a transaction in a block`)
    // and among genuine equals the height still breaks the tie, which is its job
    const twinA = head({ height: 10, anchors: [seal(9, R('t1'), 3)] })
    const twinB = head({ height: 10, anchors: [seal(4, R('t2'), 3)] })
    const vt = chooseCanonical(twinA, twinB)
    ok(vt.winner === 'a' && /free integer/.test(vt.why), 'among equals that Bitcoin priced identically, the claimed height still decides — it only ever breaks ties, never outranks a paid rung')
  }

  // ── A COPIED ANCHOR IS NOT A PAID ANCHOR ─────────────────────────────────
  // The Stacks comparison found this: provenWeight iterated the anchor list with
  // no deduplication, so pasting the same valid anchor N times multiplied
  // totalWork by N at zero cost — falsifying the comment three lines above it on
  // the very day it was written. Weight must be denominated in something an
  // attacker has to buy.
  {
    const one = seal(9, R('dup'), 3)
    const honest = head({ height: 10, anchors: [one] })
    const copier = head({ height: 10, anchors: [one, one, one, one, one, one, one, one] })
    const wH = provenWeight(honest), wC = provenWeight(copier)
    ok(wC.totalWork === wH.totalWork, `eight copies of one anchor weigh exactly what one weighs (${wC.totalWork}) — a copied array entry costs nothing, so it buys nothing`)
    ok(wC.provenAnchors === 1, 'and it counts as ONE proven anchor, because Bitcoin produced one block')
    ok(chooseCanonical(honest, copier).winner === 'a' || chooseCanonical(honest, copier).why.includes('same history'),
      'so a copier never outranks the history it copied from')
  }

  console.log(`\n✓ ${pass} checks passed — CONSENSUS WITHOUT A VOTE: the canonical history is the one BITCOIN ATTENDED MOST — summed proof of work across every proven anchor, each unit of it bought with a real transaction in a real block, measured from raw bytes by every follower independently. The ladder is ranked by PRICE, so the one value an attacker can declare for free (the KRAY height inside an anchor) sits at the bottom and only ever breaks ties among histories Bitcoin priced identically. A forged anchor weighs nothing and marks its author; a taller unwitnessed chain never outranks a witnessed one; every tie breaks identically on every machine on earth. The operator no longer decides which past is real — Bitcoin does, and anyone can check. ₿₭`)
}
main()
