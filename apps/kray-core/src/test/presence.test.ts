/**
 * PRESENCE — the split that pays for BEING THERE, and sums to the budget exactly.
 *   node src/test/presence.test.ts
 */
import { isqrt, packPresence, unpackPresence, presenceFromHex, presenceToHex, splitSeal, verifySettlement, type Participant, type SettlementClaim } from '../economics/presence.ts'
let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
function rng(seed: number) { let x = seed >>> 0; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 } }
const sum = (m: Map<string, bigint>) => [...m.values()].reduce((t, v) => t + v, 0n)

function main() {
  // ── 1 · THE TWO READINGS ARE DIFFERENT NUMBERS ───────────────────────────
  const r = splitSeal(1000n, 2, [
    { address: 'X', work: 1n, present: [true, true] },   // there for both
    { address: 'Y', work: 2n, present: [true, false] },  // same total work, one burst
  ])
  // The split is LINEAR in work now (the only sybil-neutral curve), so the
  // numbers moved — but the property this test exists for is untouched and even
  // sharper: X did HALF the total work of Y and still earns twice as much,
  // because it was THERE for both blocks. An aggregate reading would have paid
  // Y 667 and X 333, exactly inverted.
  ok(r.get('X') === 667n && r.get('Y') === 333n, 'presence beats burst: 667 / 333 — the aggregate reading would have inverted it to 333 / 667')
  ok(sum(r) === 1000n, 'and the two halves are the budget EXACTLY')

  // ── 2 · EXACTNESS UNDER FUZZ — the property that cannot bend ─────────────
  // A network leaking one unit per seal leaks a fortune over a century; one that
  // creates a unit breaks conservation. So: never off by one, ever.
  const rnd = rng(0xC0FFEE)
  for (let t = 0; t < 400; t++) {
    const blocks = 1 + Math.floor(rnd() * 200)
    const n = 1 + Math.floor(rnd() * 12)
    const who: Participant[] = Array.from({ length: n }, (_, i) => ({
      address: 'v' + String(i).padStart(2, '0'),
      work: BigInt(Math.floor(rnd() * 1_000_000)),
      present: Array.from({ length: blocks }, () => rnd() < 0.6),
    }))
    const budget = BigInt(1 + Math.floor(rnd() * 5_000_000_000))
    const paid = splitSeal(budget, blocks, who)
    const anyone = who.some((p) => p.work > 0n && p.present.some(Boolean))
    ok(sum(paid) === (anyone ? budget : 0n), `round ${t}: the split sums to the budget exactly (${blocks} blocks, ${n} validators)`)
    for (const [, v] of paid) ok(v > 0n, `  …and no zero row is written`)
    for (const p of who) if (!p.present.some(Boolean) || p.work === 0n) ok(!paid.has(p.address), `  …and absent or idle earns nothing`)
  }

  // ── 3 · DETERMINISTIC — every node on earth computes the same table ───────
  const who: Participant[] = [
    { address: 'bcrt1pb', work: 7n, present: [true, true, false] },
    { address: 'bcrt1pa', work: 7n, present: [true, true, false] }, // identical work: the tie
    { address: 'bcrt1pc', work: 3n, present: [false, true, true] },
  ]
  const a = splitSeal(999_999n, 3, who)
  const b = splitSeal(999_999n, 3, [...who].reverse())
  const show = (m: Map<string, bigint>) => [...m].map(([k, v]) => `${k}=${v}`).sort().join('|')
  ok(show(a) === show(b), 'the input ORDER cannot change the payout — ties break by address, so replay agrees')
  ok(sum(a) === 999_999n, 'and an odd budget across 3 blocks still sums exactly')

  // ── 4 · EMPTY BLOCKS PAY NOTHING, AND STRAND NOTHING ─────────────────────
  const gap = splitSeal(100n, 4, [{ address: 'only', work: 5n, present: [false, true, false, false] }])
  ok(gap.get('only') === 100n, 'blocks nobody attended pay nothing, and their share returns to the pot rather than being stranded')
  ok(splitSeal(100n, 4, [{ address: 'nobody', work: 5n, present: [false, false, false, false] }]).size === 0,
    'a seal nobody worked under pays NOBODY — the subsidy simply stays in the vault')
  ok(splitSeal(0n, 4, who).size === 0 && splitSeal(100n, 0, who).size === 0, 'zero budget and zero blocks are answered, never thrown on')

  // ── 5 · THE BITMAP ROUND-TRIPS, AND SAYS ITS OWN LENGTH ──────────────────
  for (const len of [1, 7, 8, 9, 63, 171, 1029]) {
    const bits = Array.from({ length: len }, (_, i) => (i * 7 + 3) % 5 === 0)
    const packed = packPresence(bits)
    ok(packed.length === Math.ceil(len / 8), `${len} blocks pack into ${Math.ceil(len / 8)} bytes`)
    ok(JSON.stringify(unpackPresence(packed, len)) === JSON.stringify(bits), `  …and unpack identically`)
    ok(JSON.stringify(unpackPresence(presenceFromHex(presenceToHex(packed)), len)) === JSON.stringify(bits), `  …through hex too, which is what the journal carries`)
  }
  ok(packPresence(Array.from({ length: 171 }, () => true)).length === 22, '171 fast blocks — a Bitcoin block\'s worth — cost 22 bytes per validator')
  let threw = false
  try { presenceFromHex('xyz') } catch (_) { threw = true }
  ok(threw, 'a malformed bitmap is refused, never silently read as absence')

  // ── 6 · INTEGER MATH ONLY ────────────────────────────────────────────────
  ok(isqrt(0n) === 0n && isqrt(1n) === 1n && isqrt(2n) === 1n && isqrt(4n) === 2n && isqrt(1_000_000n) === 1000n, 'isqrt is exact on the boundaries')
  ok(isqrt(10n ** 30n) === 10n ** 15n, 'and exact at a scale no float could hold')
  const big = splitSeal(5_000_000_000n, 171, [{ address: 'a', work: 10n ** 18n, present: Array(171).fill(true) }])
  ok(big.get('a') === 5_000_000_000n, 'a whole genesis-era seal to a single validator arrives whole')

  // ── 7 · THE VERIFIER — an operator cannot hand one validator another's share ─
  // This is the difference between BOUNDED and PROVEN. A cap and a solvency check
  // stop theft of more than the curve allows and stop nothing else. With work and
  // presence written down there is exactly ONE table the law can produce.
  const bm = (b: boolean[]) => presenceToHex(packPresence(b))
  const crew: Participant[] = [
    { address: 'bcrt1pa', work: 900n, present: [true, true, false, true] },
    { address: 'bcrt1pb', work: 400n, present: [true, false, true, true] },
    { address: 'bcrt1pc', work: 100n, present: [false, true, true, false] },
  ]
  const truth = splitSeal(4_000_000n, 4, crew)
  const honest: SettlementClaim[] = crew.map((p) => ({
    address: p.address, work: p.work.toString(), presence: bm(p.present), paid: (truth.get(p.address) ?? 0n).toString(),
  }))
  ok(verifySettlement(4_000_000n, 4, honest).exact, 'an honest table verifies — recomputed line by line from work and presence')

  // every way an operator could bend it, and each refused BY NAME
  const skim = honest.map((r) => r.address === 'bcrt1pa'
    ? { ...r, paid: (BigInt(r.paid) - 1n).toString() }
    : r.address === 'bcrt1pb' ? { ...r, paid: (BigInt(r.paid) + 1n).toString() } : r)
  const sv = verifySettlement(4_000_000n, 4, skim)
  ok(!sv.exact && sv.reason === 'mismatch', 'moving ONE unit between two validators is caught — the total still sums, and it is still a lie')
  ok(sv.wrong.length === 2 && sv.wrong.every((w) => w.written !== w.expected), '…and the verdict NAMES who was short and by how much')

  ok(!verifySettlement(4_000_000n, 4, honest.map((r) => r.address === 'bcrt1pc' ? { ...r, presence: bm([true, true, true, true]) } : r)).exact,
    'inflating your OWN presence changes the table you must match — caught')
  ok(!verifySettlement(4_000_000n, 4, honest.map((r) => r.address === 'bcrt1pc' ? { ...r, work: '999999' } : r)).exact,
    'inflating your OWN work is caught the same way')
  ok(!verifySettlement(4_000_000n, 4, honest.filter((r) => r.address !== 'bcrt1pc')).exact,
    'OMITTING a validator the law would pay is a difference too — silence is not an escape')
  ok(!verifySettlement(4_000_000n, 4, [...honest, { address: 'bcrt1pz', work: '500', presence: bm([true, true, true, true]), paid: '0' }]).exact,
    'adding a validator who was not in the seal shifts everyone — caught')

  ok(verifySettlement(4_000_000n, 4, honest.map((r) => ({ ...r, presence: 'zz' }))).reason === 'bad-presence',
    'a malformed bitmap FAILS CLOSED — never read as absence, which would quietly unpay somebody who was there')
  ok(verifySettlement(4_000_000n, 4, honest.map((r) => ({ ...r, paid: '-1' }))).reason === 'bad-amount', 'a negative amount is refused')
  ok(verifySettlement(4_000_000n, 4, honest.map((r) => ({ ...r, paid: '1.5' }))).reason === 'bad-amount', 'a fractional amount is refused — money is integers')
  ok(verifySettlement(4_000_000n, 4, honest.map((r) => ({ ...r, paid: '99999999' }))).reason === 'over-budget', 'a table over the budget is refused before anything else is even computed')

  // and it must agree with itself no matter how the rows are ordered
  ok(verifySettlement(4_000_000n, 4, [...honest].reverse()).exact, 'row ORDER cannot change the verdict — replay on any node agrees')

  // ── SYBIL-NEUTRALITY, WHICH IS A THEOREM AND NOW A TEST ──────────────────
  // The split weighed √work until it was measured against a free identity: one
  // machine split into 16 names went from 50% of a contested pot to 80%, because
  // N·√(W/N) = √(NW) > √W. Only a LINEAR weight satisfies N·f(W/N) = f(W), so
  // only linear is neutral — and measuring the work does not help, because the
  // defect is in the CURVE. Concavity would be safe again the day identity costs
  // something scarce; until then this is the choice with a proof behind it.
  {
    const rival = { address: 'z'.repeat(20), work: 10_000n, present: [true] }
    const solo = splitSeal(1_000_000n, 1, [{ address: 'a'.repeat(20), work: 10_000n, present: [true] }, rival])
    const soloShare = solo.get('a'.repeat(20)) ?? 0n
    for (const N of [2, 4, 16, 64]) {
      const split = Array.from({ length: N }, (_, i) => ({ address: 'a' + String(i).padStart(19, '0'), work: 10_000n / BigInt(N), present: [true] }))
      const many = splitSeal(1_000_000n, 1, [...split, rival])
      let got = 0n
      for (const [k, v] of many) if (k[0] === 'a') got += v
      // THE LAW IS "NEVER MORE". Splitting can pay slightly LESS, because
      // dividing the work into N integer parts discards the remainder — an
      // honest cost of integers, and one that points the incentive the right way.
      ok(got <= soloShare,
        `splitting one machine into ${String(N).padStart(2)} free identities pays ${got} where one paid ${soloShare} — sybil buys NOTHING (it costs ${soloShare - got}, the work lost to integer division), and under the old √ curve 16 identities took 80% against 50%`)
    }
    ok(soloShare * 2n <= 1_000_000n + 2n && soloShare * 2n >= 1_000_000n - 2n,
      'and equal work against an equal rival still splits the pot in half — linearity pays exactly what was contributed, so a small validator is never diluted by an honest large one')
  }

  console.log(`\n✓ ${pass} checks passed — PRESENCE IS WHAT IS PAID FOR: the budget is split per fast block among those actually THERE, so being present for every block beats the same total work done in one burst (667 vs 333, where the aggregate reading would have INVERTED it to 333/667). Across 400 randomised rounds the payouts sum to the budget EXACTLY — never one unit created, never one leaked — with largest remainder twice and ties broken by address so every node computes the identical table. Blocks nobody attended pay nothing and strand nothing; a seal nobody worked under pays nobody and the subsidy stays in the vault. A Bitcoin block's worth of presence costs 22 bytes per validator, round-trips through the hex the journal carries, and every amount is exact integer arithmetic. AND THE TABLE IS VERIFIABLE: with work and presence written down there is exactly ONE table the law can produce, so moving a single unit between two validators — where the total still sums perfectly — is caught and NAMED; inflating your own work or presence, omitting somebody the law would pay, or adding somebody who was not there are all caught; and a malformed bitmap fails closed rather than being read as absence, which would quietly unpay somebody who was there. Bounded became proven. ₭`)
}
main()
