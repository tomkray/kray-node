/**
 * Hermetic proof of the emission split (temp-free, pure math).
 *   node src/test/reward.test.ts
 *
 * Proves: the whole subsidy is distributed to the unit (Σ == subsidy, exact),
 * shares are LINEAR in the WORK done this interval (sybil-neutral — one worker of
 * work W earns EXACTLY what N workers splitting W earn, so splitting into many
 * names buys nothing), zero-work validators earn nothing, and edge cases
 * (empty / single / no worker) are safe. Bitcoin-standard: reward ∝ work now,
 * not accumulated reputation.
 */
import { splitSubsidy, totalRewarded, type Validator } from '../economics/reward.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
let seed = 987654321n
const MASK = (1n << 64n) - 1n
const rnd = (n: number): number => { seed = (seed * 6364136223846793005n + 1442695040888963407n) & MASK; return Number((seed >> 33n) % BigInt(n)) }

// 1 · conservation: the whole subsidy is distributed, exactly
const vals: Validator[] = [
  { id: 'a', weight: 400n }, { id: 'b', weight: 100n }, { id: 'c', weight: 2500n }, { id: 'd', weight: 0n },
]
const r = splitSubsidy(1_000_000n, vals)
ok(totalRewarded(r) === 1_000_000n, 'Σ rewards == subsidy exactly (largest-remainder closes the dust)')
ok(!r.some((x) => x.id === 'd'), 'a zero-work validator earns nothing')

// 2 · LINEAR weighting (sybil-neutral): 4× the work gives EXACTLY 4× the reward
const aw = splitSubsidy(1_000_000n, [{ id: 'big', weight: 400n }, { id: 'small', weight: 100n }])
const big = aw.find((x) => x.id === 'big')!.amount
const small = aw.find((x) => x.id === 'small')!.amount
ok(big + small === 1_000_000n, 'two-validator split conserves')
// weights 400 and 100 → 4:1, linear (√ would have paid 2:1 and rewarded self-splitting)
ok(big === 800_000n && small === 200_000n, `linear: 4× work → 4× reward (${Number(big)} vs ${Number(small)})`)

// 2b · SYBIL-NEUTRALITY, proven directly: one worker of weight 400 earns the SAME as four
// workers of 100 against the same rival — so an operator gains nothing by splitting into names.
const whole = splitSubsidy(1_000_000n, [{ id: 'one', weight: 400n }, { id: 'rival', weight: 400n }])
const split = splitSubsidy(1_000_000n, [{ id: 'a', weight: 100n }, { id: 'b', weight: 100n }, { id: 'c', weight: 100n }, { id: 'd', weight: 100n }, { id: 'rival', weight: 400n }])
const wholeShare = whole.find((x) => x.id === 'one')!.amount
const splitShare = split.filter((x) => ['a', 'b', 'c', 'd'].includes(x.id)).reduce((t, x) => t + x.amount, 0n)
ok(wholeShare === splitShare, `sybil-neutral: 1×400 == 4×100 vs the same rival (${Number(wholeShare)} == ${Number(splitShare)})`)

// 3 · edge cases
ok(splitSubsidy(0n, vals).length === 0, 'zero subsidy splits to nothing')
ok(splitSubsidy(1000n, []).length === 0, 'no validators → nothing to split')
ok(splitSubsidy(1000n, [{ id: 'x', weight: 0n }]).length === 0, 'only zero-work validators → nothing split (stays in the vault)')
const solo = splitSubsidy(777n, [{ id: 'solo', weight: 9n }])
ok(solo.length === 1 && solo[0].amount === 777n, 'a single working validator receives the whole subsidy')

// 4 · churn: conservation over many random subsidies + validator sets
for (let t = 0; t < 2000; t++) {
  const nv = 1 + rnd(12)
  const set: Validator[] = Array.from({ length: nv }, (_, i) => ({ id: 'v' + i, weight: BigInt(rnd(1_000_000)) }))
  const subsidy = BigInt(1 + rnd(5_000_000_000))
  const out = splitSubsidy(subsidy, set)
  const anyWork = set.some((v) => v.weight > 0n)
  if (anyWork) ok(totalRewarded(out) === subsidy, `random split ${t} conserves exactly`)
  else ok(out.length === 0, `random split ${t} with no work stays in the vault`)
}

console.log(`\n✓ ${pass} checks passed — emission split holds: LINEAR in work (sybil-neutral), zero-work earns nothing, Σ == subsidy exact.`)
process.exit(0)
