/**
 * THE SETTLEMENT HOLDS — verified beats become a reward table, and only real, address-bound, non-replayable
 * work is ever paid. Mines REAL beats (PoW), settles them, and proves: the settled work is exactly spanWork,
 * the pool is conserved to the unit, more proven work earns more, a forged over-claim earns nothing, a
 * validator's beats are worthless under anyone else's address (work cannot be copied — sybil-proof), a block
 * claimed twice counts once, and the table is deterministic.
 *
 *   node src/test/settlement.test.ts
 */
import { createHash } from 'node:crypto'
import { mineBeat, spanWork, type BeatProof } from '../economics/beat-pow.ts'
import { settleFromBeats } from '../economics/settlement.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

const BEACON = createHash('sha256').update('beacon|signet-block-316788').digest('hex')   // a real Bitcoin block hash is 64 hex
const beatsFor = (address: string, blocks: number[], budget: number): BeatProof[] =>
  blocks.map((b) => mineBeat(BEACON, address, b, budget)).filter((x): x is BeatProof => x != null)

function main() {
  console.log('\n╔═ THE SETTLEMENT HOLDS — only real, address-bound, non-replayable work is paid ═╗\n')
  const A = 'val-A', B = 'val-B', C = 'val-C'
  const beatsA = beatsFor(A, [0, 1, 2, 3], 20000)   // most compute
  const beatsB = beatsFor(B, [0, 1, 2, 3], 2000)
  const beatsC = beatsFor(C, [0, 1, 2, 3], 200)     // least
  const budget = 100n // exam split only — live settle uses the Treasury
  const OLD = { seq: 1 }   // pre-window journal shape — 4 blocks, no presenceTip

  const { rewards, lines } = settleFromBeats(BEACON, budget, [{ address: A, beats: beatsA }, { address: B, beats: beatsB }, { address: C, beats: beatsC }], OLD)
  const paidOf = new Map(rewards.map((r) => [r.id, r.amount]))

  // 1 · the settled BASE work is EXACTLY spanWork — the composition is honest (work is base × K with no custody)
  for (const [addr, beats] of [[A, beatsA], [B, beatsB], [C, beatsC]] as const) {
    const sw = spanWork(BEACON, addr, beats).work
    const line = lines.find((l) => l.address === addr)
    ok(!!line && line.base === sw, `${addr}: settled base work == spanWork (${sw})`)
  }

  // 2 · conservation: the whole pool is paid, to the unit
  const totalPaid = rewards.reduce((t, r) => t + r.amount, 0n)
  ok(totalPaid === budget, `Σ paid == budget exactly (${totalPaid})`)

  // 3 · more proven work → more reward (monotone with work, a linear split)
  const sorted = [...lines].sort((a, b) => (a.work < b.work ? -1 : a.work > b.work ? 1 : 0))
  let monotone = true
  for (let i = 1; i < sorted.length; i++) if ((paidOf.get(sorted[i].address) ?? 0n) < (paidOf.get(sorted[i - 1].address) ?? 0n)) monotone = false
  ok(monotone, `more proven work → at least as much reward (A ${paidOf.get(A)} ≥ B ${paidOf.get(B)} ≥ C ${paidOf.get(C)})`)

  // 4 · a FORGED beat — claiming more leading zeros than the nonce actually has — proves 0
  const forged: BeatProof[] = [{ block: 0, nonce: '1', zeros: 64 }]
  const r2 = settleFromBeats(BEACON, budget, [{ address: A, beats: forged }], OLD)
  ok(r2.rewards.length === 0 && r2.lines.length === 0, 'a forged over-claim proves 0 work → no reward, no line')

  // 5 · SYBIL-PROOF: a validator's beats prove NOTHING under another address — work cannot be copied,
  //     bought off the wire, or shared. To earn under N names a machine must mine N times (÷ hashrate).
  ok(spanWork(BEACON, B, beatsA).work === 0n, "A's own beats submitted under B's address prove 0 — work is address-bound")
  const stolen = settleFromBeats(BEACON, budget, [{ address: B, beats: beatsA }], OLD)
  ok(stolen.rewards.length === 0, "settling B with A's beats pays B nothing — stolen work earns nothing")

  // 6 · a block claimed twice counts ONCE (presence is a fact about a moment, not a repeatable quantity)
  const one = beatsFor(A, [0], 5000)
  const twice = [...one, ...one]
  ok(spanWork(BEACON, A, twice).work === spanWork(BEACON, A, one).work, 'a block claimed twice counts once — never doubled')

  // 7 · deterministic — same beacon + beats + budget → identical table, on every node
  const again = settleFromBeats(BEACON, budget, [{ address: A, beats: beatsA }, { address: B, beats: beatsB }, { address: C, beats: beatsC }], OLD)
  const key = (rs: { id: string; amount: bigint }[]) => rs.map((r) => r.id + ':' + r.amount.toString()).join('|')
  ok(key(again.rewards) === key(rewards), 'deterministic: the same inputs always yield the same table')

  // 8 · CUSTODY scales the weight — (K + 2·hits): 0 hits → × K (the cancelling baseline), K hits → × 3K (3×)
  const cx = settleFromBeats(BEACON, budget, [
    { address: 'cpu', beats: beatsFor('cpu', [0, 1, 2, 3], 5000), hits: 0 },
    { address: 'full', beats: beatsFor('full', [0, 1, 2, 3], 5000), hits: 8 },
  ], OLD)
  const cpu = cx.lines.find((l) => l.address === 'cpu')!, full = cx.lines.find((l) => l.address === 'full')!
  ok(cpu.work === cpu.base * 8n, 'CPU guardian (0 hits): effective work = base × K, the cancelling baseline')
  ok(full.work === full.base * 24n, 'full-atlas guardian (K hits): effective = base × 3K → 3× the CPU weight')
  ok(cx.rewards.reduce((t, r) => t + r.amount, 0n) === budget, 'custody split still conserves the whole pool to the unit')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — verified work in, a provable payout out. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
