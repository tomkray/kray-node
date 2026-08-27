/**
 * THE ATEMPORAL SETTLEMENT PROOF — the indivisible fee split can NEVER leak, invent, or fork.
 *
 * KRAY has divisibility 0: a fee pool cannot always divide evenly among the validators. splitFeePool is the
 * largest-remainder (Hamilton) apportionment that resolves it. This hammers it (and splitSeal) over hundreds
 * of thousands of random + adversarial scenarios and asserts, EVERY time, the invariants a value network can
 * never violate:
 *   · CONSERVATION — Σ paid == pool EXACTLY (never a unit created, never a unit stranded)
 *   · BOUNDED      — each share is within one indivisible unit of its exact proportional share
 *   · DETERMINISM  — the result is order-free (shuffle the validators → byte-identical table), so every node agrees
 *   · NO PHANTOM   — only a validator that proved positive work is ever paid
 *   · SYBIL-NEUTRAL— one whale of work W earns what N sybils of W/N together earn (linear ⇒ splitting buys nothing)
 * Reproducible: a failure prints its SEED so the exact scenario re-runs. Pure functions — no chain needed.
 *
 *   node src/test/settlement-atemporal.test.ts            # default 200k scenarios
 *   SCEN=1000000 node src/test/settlement-atemporal.test.ts
 */
import { splitFeePool } from '../economics/reward.ts'
import { splitSeal, type Participant } from '../economics/presence.ts'

let pass = 0, fail = 0, checks = 0
const firstFails: string[] = []
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; if (firstFails.length < 20) firstFails.push(m) } }

// deterministic PRNG (LCG) so any failure reproduces from its SEED
let seed = (Number(process.env.SEED) || 0x1234567) >>> 0
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const rint = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
const rbig = (maxBytes: number) => { let v = 0n; const n = 1 + Math.floor(rnd() * maxBytes); for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(Math.floor(rnd() * 256)); return v }
const shuffle = <T>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[s[i], s[j]] = [s[j], s[i]] } return s }

type V = { id: string; weight: bigint }

// the core invariant check on splitFeePool for one scenario
function checkPool(pool: bigint, vals: V[], tag: string) {
  checks++
  const r = splitFeePool(pool, vals)
  const total = r.reduce((a, x) => a + x.amount, 0n)
  const posW = vals.filter((v) => v.weight > 0n)
  const totalW = posW.reduce((a, v) => a + v.weight, 0n)
  const S = `[seed=${seed} ${tag}] pool=${pool} n=${vals.length}`

  if (pool <= 0n || totalW === 0n) { ok(r.length === 0, `${S} must pay NOTHING when pool<=0 or no work`); return r }

  ok(total === pool, `${S} CONSERVATION Σpaid=${total} != pool=${pool}`)                       // never leak, never invent
  ok(r.every((x) => x.amount > 0n), `${S} a paid share must be > 0`)                            // no zero rows
  const ids = new Set(posW.map((v) => v.id))
  ok(r.every((x) => ids.has(x.id)), `${S} NO PHANTOM — a payee must have proved work`)          // no invented winner
  ok(new Set(r.map((x) => x.id)).size === r.length, `${S} a validator appears at most once`)

  const amap = new Map(r.map((x) => [x.id, x.amount]))
  // aggregate identical ids should not exist; each posW within [floor, floor+1] of exact share
  for (const v of posW) {
    const fl = (pool * v.weight) / totalW
    const a = amap.get(v.id) ?? 0n
    ok(a >= fl && a <= fl + 1n, `${S} BOUNDED ${v.id}: paid ${a} not in [${fl}, ${fl + 1n}]`)   // ≤ 1 indivisible unit off exact
  }
  // determinism: shuffle → identical table
  const r2 = splitFeePool(pool, shuffle(vals))
  const m2 = new Map(r2.map((x) => [x.id, x.amount]))
  ok(amap.size === m2.size && [...amap].every(([k, vv]) => m2.get(k) === vv), `${S} DETERMINISM broke — order changed the table`)
  return r
}

function main() {
  console.log('\n╔══ THE ATEMPORAL SETTLEMENT PROOF — the indivisible split never leaks, invents, or forks ══╗')

  // ── 0 · the NAMED cases the question is about ─────────────────────────────────────────────
  const c1 = splitFeePool(1n, [{ id: 'guardian', weight: 32768n }, { id: 'second', weight: 16384n }])
  ok(c1.length === 1 && c1[0].id === 'guardian' && c1[0].amount === 1n, `1 ₭ between work 32768 vs 16384 → the HIGHER-work guardian gets the 1 ₭, second gets 0 (got ${JSON.stringify(c1.map((r) => [r.id, r.amount.toString()]))})`)
  // 1 ₭ among 3 EQUAL → exactly one gets it, deterministically (tie broken by id, lexicographic)
  const c2 = splitFeePool(1n, [{ id: 'ccc', weight: 5n }, { id: 'aaa', weight: 5n }, { id: 'bbb', weight: 5n }])
  ok(c2.length === 1 && c2.reduce((a, r) => a + r.amount, 0n) === 1n, `1 ₭ among 3 EQUAL → exactly ONE deterministic winner (${JSON.stringify(c2.map((r) => [r.id, r.amount.toString()]))})`)
  // 2 ₭ among 3 equal → two distinct winners, sum 2
  const c3 = splitFeePool(2n, [{ id: 'a', weight: 5n }, { id: 'b', weight: 5n }, { id: 'c', weight: 5n }])
  ok(c3.reduce((a, r) => a + r.amount, 0n) === 2n && c3.length === 2, `2 ₭ among 3 equal → 2 distinct winners, Σ=2`)
  // single validator takes the whole pool
  ok(splitFeePool(7n, [{ id: 'solo', weight: 3n }])[0].amount === 7n, `a single validator takes the whole pool`)
  // negative / zero weights are dropped, never crash
  ok(splitFeePool(10n, [{ id: 'a', weight: -5n }, { id: 'b', weight: 0n }, { id: 'c', weight: 10n }])[0].amount === 10n, `negative & zero weights are dropped, the worker takes it`)
  ok(splitFeePool(5n, []).length === 0 && splitFeePool(0n, [{ id: 'a', weight: 1n }]).length === 0, `no validators OR zero pool → pays nothing (accumulates)`)
  // HARDENING — a DUPLICATE id is merged to ONE participant whose weight is the sum (never two rows, never a
  // non-antisymmetric-comparator path). a(3+3)=6 vs b=4 of a pool of 10 → a:6, b:4, conserved, a appears once.
  const dup = splitFeePool(10n, [{ id: 'a', weight: 3n }, { id: 'a', weight: 3n }, { id: 'b', weight: 4n }])
  ok(dup.length === 2 && dup.find((r) => r.id === 'a')?.amount === 6n && dup.find((r) => r.id === 'b')?.amount === 4n, `duplicate id MERGES (a 3+3→6, b→4) — ${JSON.stringify(dup.map((r) => [r.id, r.amount.toString()]))}`)
  ok(new Set(dup.map((r) => r.id)).size === dup.length && dup.reduce((s, r) => s + r.amount, 0n) === 10n, `a merged id appears ONCE and the split still conserves`)
  // duplicate ids that also straddle the dust: 1 ₭ between a(dup) and b, a's merged weight wins the unit deterministically
  const dupDust = splitFeePool(1n, [{ id: 'zz', weight: 1n }, { id: 'aa', weight: 1n }, { id: 'aa', weight: 1n }])
  ok(dupDust.length === 1 && dupDust[0].id === 'aa' && dupDust[0].amount === 1n, `duplicate id merged (aa=2) beats zz=1 for the indivisible unit — ${JSON.stringify(dupDust.map((r) => [r.id, r.amount.toString()]))}`)

  // ── 1 · SYBIL-NEUTRALITY — one whale of W earns what N sybils of W/N together earn ──────────
  for (let t = 0; t < 20000; t++) {
    const others = Array.from({ length: rint(0, 6) }, (_, i) => ({ id: 'o' + i, weight: rbig(3) + 1n }))
    const N = rint(2, 12), unit = rbig(3) + 1n, W = unit * BigInt(N)
    const pool = rbig(4) + 1n
    const whaleTbl = splitFeePool(pool, [{ id: 'whale', weight: W }, ...others])
    const sybilTbl = splitFeePool(pool, [...Array.from({ length: N }, (_, i) => ({ id: 'syb' + i, weight: unit })), ...others])
    const whaleGot = whaleTbl.filter((r) => r.id === 'whale').reduce((a, r) => a + r.amount, 0n)
    const sybilGot = sybilTbl.filter((r) => r.id.startsWith('syb')).reduce((a, r) => a + r.amount, 0n)
    const slack = BigInt(N + others.length + 2)   // integer rounding across the extra rows, never more than the row count
    checks++
    ok(whaleGot >= sybilGot - slack && whaleGot <= sybilGot + slack, `[seed=${seed}] SYBIL-NEUTRAL: whale ${whaleGot} vs ${N} sybils ${sybilGot} (slack ${slack}) — splitting yourself must buy nothing`)
    // and both conserve
    ok(whaleTbl.reduce((a, r) => a + r.amount, 0n) === pool && sybilTbl.reduce((a, r) => a + r.amount, 0n) === pool, `[seed=${seed}] both sybil-scenarios conserve to the pool`)
  }

  // ── 2 · RANDOM fuzz — arbitrary pools, counts, weight magnitudes ───────────────────────────
  const SCEN = Number(process.env.SCEN) || 120000
  for (let t = 0; t < SCEN; t++) {
    const n = rint(1, 40)
    const vals: V[] = Array.from({ length: n }, (_, i) => ({ id: 'v' + String(i).padStart(3, '0'), weight: rnd() < 0.05 ? 0n : rbig(rint(1, 8)) }))
    checkPool(rbig(rint(1, 6)), vals, 'rand')
  }

  // ── 3 · ADVERSARIAL families — ties, whales, dust, pool=1, pool<N ──────────────────────────
  for (let t = 0; t < 20000; t++) {
    const n = rint(2, 30)
    // all-equal (maximal ties)
    checkPool(rbig(3) + 1n, Array.from({ length: n }, (_, i) => ({ id: 'e' + String(i).padStart(3, '0'), weight: 7n })), 'ties')
    // whale + dust crowd
    checkPool(rbig(4) + 1n, [{ id: 'whale', weight: rbig(8) + 1n }, ...Array.from({ length: n }, (_, i) => ({ id: 'd' + String(i).padStart(3, '0'), weight: 1n }))], 'whale')
    // pool == 1 (the sharpest indivisible case) among n
    checkPool(1n, Array.from({ length: n }, (_, i) => ({ id: 'p' + String(i).padStart(3, '0'), weight: rbig(3) + 1n })), 'pool=1')
    // pool < n (dust everywhere)
    checkPool(BigInt(rint(1, n - 1)), Array.from({ length: n }, (_, i) => ({ id: 'q' + String(i).padStart(3, '0'), weight: rbig(2) + 1n })), 'pool<n')
  }

  // ── 4 · splitSeal — the per-block presence split conserves too (with empty blocks) ──────────
  for (let t = 0; t < 20000; t++) {
    const blocks = rint(1, 8), n = rint(1, 12)
    const who: Participant[] = Array.from({ length: n }, (_, i) => ({
      address: 'a' + String(i).padStart(3, '0'),
      work: rnd() < 0.1 ? 0n : rbig(rint(1, 5)) + 1n,
      present: Array.from({ length: blocks }, () => rnd() < 0.6),
    }))
    const budget = rbig(rint(1, 5)) + 1n
    const out = splitSeal(budget, blocks, who)
    const total = [...out.values()].reduce((a, v) => a + v, 0n)
    const anyLive = who.some((p) => p.work > 0n && p.present.some(Boolean))
    checks++
    if (anyLive) ok(total === budget, `[seed=${seed}] splitSeal CONSERVATION Σ=${total} != budget=${budget}`)
    else ok(total === 0n, `[seed=${seed}] splitSeal pays nothing when no one is present with work`)
    ok([...out.values()].every((v) => v > 0n), `[seed=${seed}] splitSeal never records a zero share`)
    // determinism: shuffle participants → identical map
    const out2 = splitSeal(budget, blocks, shuffle(who))
    ok(out.size === out2.size && [...out].every(([k, v]) => out2.get(k) === v), `[seed=${seed}] splitSeal DETERMINISM broke under shuffle`)
  }

  console.log(`\n  scenarios checked: ${checks.toLocaleString()}  ·  assertions: ${(pass + fail).toLocaleString()}`)
  if (fail) { console.log(`\n  ✗ ${fail} FAILED — first offenders:`); firstFails.forEach((m) => console.log('     · ' + m)) }
  console.log(`\n╚══ ${fail === 0 ? `ALL GREEN — over ${checks.toLocaleString()} scenarios the indivisible split ALWAYS conserved, stayed within one unit of exact, was order-free, and paid only proven work. It cannot leak, invent, or fork. ⚖️⛓₭` : `${fail} assertions broke — the split is NOT atemporal`} ══╝`)
  if (fail) process.exit(1)
}
main()
