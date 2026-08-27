/**
 * THE BEAT PROOF — work the network can measure instead of believe.
 *   node src/test/beat-pow.test.ts
 *
 * Presence was a constant: a hundred idle processes claimed a hundred times the
 * work of one honest machine, because "work" measured a timer and an open port.
 * This suite proves the replacement measures compute, is bound to the seal, the
 * person and the moment, and refuses every way of claiming effort nobody spent.
 *
 * It also measures the thing the module is honest about: measuring work does NOT
 * by itself make identity scarce. That number is printed here rather than hidden,
 * because a network should know the shape of its own incentives.
 */
import {
  BEAT_MAX_ZEROS, BEAT_MIN_ZEROS, beatHash, beatWork, leadingZeroBits,
  mineBeat, spanWork, verifyBeat, type BeatProof,
} from '../economics/beat-pow.ts'
import { isqrt } from '../economics/presence.ts'
import { createHash, randomBytes } from 'node:crypto'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
const BEACON = createHash('sha256').update('a real bitcoin block').digest('hex')
const ALICE = 'bcrt1p' + 'a'.repeat(58)
const BOB = 'bcrt1p' + 'b'.repeat(58)

function main() {
  // ── 1 · THE MEASURE IS HASHES, AND IT SHOWS ──────────────────────────────
  ok(leadingZeroBits(Buffer.from('00000fff' + '00'.repeat(28), 'hex')) === 20, 'leading zero BITS are counted, not bytes — 0x00000f… is 20 bits')
  ok(leadingZeroBits(Buffer.from('80' + '00'.repeat(31), 'hex')) === 0, 'a top bit set is zero work, however many zeros follow')
  ok(leadingZeroBits(Buffer.alloc(32)) === 256, 'an all-zero digest is 256 bits — the impossible ceiling')
  ok(beatWork(16) === 65_536n && beatWork(20) === 1_048_576n, 'work is 2^zeros — the expected number of hashes behind the nonce (16 bits → 65,536)')
  ok(beatWork(BEAT_MIN_ZEROS - 1) === 0n, `below the ${BEAT_MIN_ZEROS}-bit floor a beat proves NOTHING — the zero-effort claim is worth zero`)
  ok(beatWork(1000) === 1n << BigInt(BEAT_MAX_ZEROS), 'work is capped, so one impossibly lucky hash cannot claim the universe')

  // more hashes really do buy more measured work — the property the law rests on
  const small = mineBeat(BEACON, ALICE, 1, 500)
  const large = mineBeat(BEACON, ALICE, 1, 60_000)
  ok(small !== null && large !== null, 'both a small and a large hash budget find a solution above the floor')
  ok(large!.zeros >= small!.zeros, `a bigger budget finds a better nonce — ${small!.zeros} bits from 500 hashes, ${large!.zeros} from 60,000`)
  ok(beatWork(large!.zeros) >= beatWork(small!.zeros), '…and therefore proves at least as much work: the measure tracks the spending')

  // ── 2 · BOUND TO THE SEAL, THE PERSON AND THE MOMENT ─────────────────────
  const mine = mineBeat(BEACON, ALICE, 7, 40_000)!
  ok(verifyBeat(BEACON, ALICE, mine) > 0n, 'an honest beat verifies in ONE hash')
  ok(verifyBeat(BEACON, BOB, mine) === 0n, 'ATTACK: the same nonce claimed by ANOTHER address → worth 0. Work cannot be bought, copied or shared')
  ok(verifyBeat(BEACON, ALICE, { ...mine, block: mine.block + 1 }) === 0n, 'ATTACK: replaying a solution into a DIFFERENT block → worth 0. Presence is a fact about a moment')
  const otherBeacon = createHash('sha256').update('a different bitcoin block').digest('hex')
  ok(verifyBeat(otherBeacon, ALICE, mine) === 0n, 'ATTACK: a solution from another seal → worth 0. Nobody grinds before Bitcoin reveals the beacon, so work cannot be stockpiled')

  // ── 3 · CLAIMING MORE THAN YOU FOUND IS WORTH NOTHING ────────────────────
  ok(verifyBeat(BEACON, ALICE, { ...mine, zeros: mine.zeros + 8 }) === 0n, 'ATTACK: inflating the claimed difficulty → REFUSED entirely, not merely discounted')
  const modest = { ...mine, zeros: BEAT_MIN_ZEROS }
  ok(verifyBeat(BEACON, ALICE, modest) === beatWork(BEAT_MIN_ZEROS), '…while claiming LESS than you found is allowed and simply pays less — so lying downward is never profitable either')
  for (const [label, bad] of [
    ['a nonce that is not a number', { block: 1, nonce: 'ff', zeros: 16 }],
    ['a negative block', { block: -1, nonce: '1', zeros: 16 }],
    ['zeros below the floor', { block: 1, nonce: '1', zeros: 1 }],
    ['zeros beyond a digest', { block: 1, nonce: '1', zeros: 300 }],
  ] as Array<[string, BeatProof]>) {
    ok(verifyBeat(BEACON, ALICE, bad) === 0n, `a malformed claim (${label}) proves 0 — data, never an exception`)
  }
  ok(verifyBeat('not-a-beacon', ALICE, mine) === 0n, 'a malformed beacon proves 0')

  // ── 4 · A SPAN COUNTS EACH MOMENT ONCE ───────────────────────────────────
  const proofs = [1, 2, 3].map((b) => mineBeat(BEACON, ALICE, b, 20_000)!)
  const span = spanWork(BEACON, ALICE, proofs)
  ok(span.blocks.length === 3 && span.work > 0n, `three blocks attested → ${span.work} of work across ${span.blocks.length} moments`)
  const doubled = spanWork(BEACON, ALICE, [...proofs, ...proofs])
  ok(doubled.work === span.work, 'ATTACK: submitting every beat TWICE → the same work. A block claimed twice counts once')
  const withJunk = spanWork(BEACON, ALICE, [...proofs, { block: 9, nonce: '1', zeros: 200 }])
  ok(withJunk.work === span.work && !withJunk.blocks.includes(9), 'a forged beat inside an honest span adds nothing and its block is not counted as attended')
  const windowed = spanWork(BEACON, ALICE, proofs, { onlyBlock: 2 })
  ok(windowed.blocks.length === 1 && windowed.blocks[0] === 2, 'windowed span pays only the open tip — extra block indices are not a grinding axis')

  // ── 5 · DETERMINISM — every node reads the same effort ───────────────────
  const readings = new Set([1, 2, 3, 4, 5].map(() => verifyBeat(BEACON, ALICE, mine).toString()))
  ok(readings.size === 1, 'five verifications, one answer — the measure is a pure function of the bytes')
  ok(beatHash(BEACON, ALICE, 7, 1n).equals(beatHash(BEACON, ALICE, 7, 1n)), 'the challenge is deterministic: same inputs, same digest, forever')

  // ── 6 · WHAT THIS DOES *NOT* FIX, MEASURED HONESTLY ──────────────────────
  // A file that quietly implied it solved sybil would be worse than no file. The
  // √-weighted split multiplies a split machine's weight by ≈√N whether the work
  // is measured or invented, because only a LINEAR weight satisfies
  // N·f(W/N) = f(W). This prints the shape of that so nobody has to rediscover it.
  const W = 1_048_576n, rival = 1_048_576n
  const shareUnder = (weight: bigint) => Number(weight * 1000n / (weight + isqrt(rival))) / 10
  const solo = shareUnder(isqrt(W))
  const split16 = shareUnder(16n * isqrt(W / 16n))
  ok(solo === 50, 'one honest machine against an equal rival takes 50% under the √ split')
  ok(split16 > 75, `the SAME machine split into 16 free identities takes ${split16}% — concavity rewards splitting, and measuring work does not change that`)
  const linear = Number(W * 1000n / (W + rival)) / 10
  const linearSplit = Number((16n * (W / 16n)) * 1000n / ((16n * (W / 16n)) + rival)) / 10
  ok(linear === 50 && linearSplit === 50, 'under a LINEAR weight the same split takes 50% either way — only linearity is sybil-neutral, and that is a choice about economics, not about this module')

  console.log(`\n✓ ${pass} checks passed — WORK IS MEASURED, NOT BELIEVED: a beat is 2^(leading zeros) of a single hash bound to the Bitcoin beacon (so nothing can be ground in advance), to the guardian's own address (so nothing can be bought, copied or shared) and to the KRAY block (so nothing can be replayed into another moment). One nonce, one hash to verify, and the number that comes out is the compute that stood behind it. Inflating a claim is refused outright, claiming less pays less, a block attested twice counts once, and a malformed claim proves zero rather than throwing. And the limit is stated rather than hidden: measured work does not make identity scarce — under a √ split, 16 free identities still take ${split16}% where one takes 50%, because only a linear weight is sybil-neutral. ₭`)
}
main()
