/**
 * KRAY CONTRACTS — programmability that cannot loop, cannot lie, cannot mint.
 *   node src/test/contract.test.ts
 *
 * Every smart-contract disaster in history came from one of three places: a
 * program that did not terminate, a machine whose behaviour differed between
 * nodes, or a contract that could reach money it did not own. This suite attacks
 * all three, plus the ordinary bugs — division by zero, a negative payment, a
 * half-applied call — and demands a NAMED refusal for each.
 *
 * Three real contracts are exercised end to end: a vesting schedule, an escrow,
 * and a fair lottery drawn from the Bitcoin beacon.
 */
import { MAX_CODE_BYTES, MAX_LIT_DIGITS, MAX_NODES, canonicalCode, runCall, validateContract, type ContractCode, type CallContext } from '../protocol/contract.ts'
import { createHash } from 'node:crypto'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
const ALICE = 'bcrt1p' + 'a'.repeat(58), BOB = 'bcrt1p' + 'b'.repeat(58), EVE = 'bcrt1p' + 'c'.repeat(58)
const SELF = 'bcrt1p' + 'f'.repeat(58)
const addrInt = (a: string): bigint => BigInt('0x' + createHash('sha256').update(a).digest('hex').slice(0, 16))
const ctx = (over: Partial<CallContext> = {}): CallContext => ({
  caller: ALICE, self: SELF, balance: 10_000n, height: 100n, interval: 5n, at: 1_700_000_000_000n,
  beacon: BigInt('0x' + 'ab'.repeat(8)), args: {}, addressToInt: addrInt, ...over,
})

function main() {
  // ── 1 · A VESTING SCHEDULE — the simplest useful contract ─────────────────
  const vesting: ContractCode = {
    vars: { released: '0', total: '9000', start: '100', duration: '900' },
    rules: [{
      name: 'release',
      // vested = total × min(elapsed, duration) / duration
      when: { op: 'gt', args: [
        { op: 'sub', args: [
          { op: 'div', args: [{ op: 'mul', args: [{ var: 'total' }, { op: 'min', args: [{ op: 'sub', args: [{ ctx: 'height' }, { var: 'start' }] }, { var: 'duration' }] }] }, { var: 'duration' }] },
          { var: 'released' },
        ] },
        { lit: '0' },
      ] },
      then: [
        { set: { var: 'released', to: { op: 'div', args: [{ op: 'mul', args: [{ var: 'total' }, { op: 'min', args: [{ op: 'sub', args: [{ ctx: 'height' }, { var: 'start' }] }, { var: 'duration' }] }] }, { var: 'duration' }] } } },
        { pay: { to: { addr: BOB }, amount: { op: 'sub', args: [{ var: 'released' }, { lit: '0' }] } } },
      ],
    }],
  }
  ok(validateContract(vesting).ok, 'a vesting contract validates')
  const state = { released: 0n, total: 9000n, start: 100n, duration: 900n }
  const half = runCall(vesting, 'release', ctx({ height: 550n }), state)
  ok(half.ok && half.vars.released === 4500n, 'halfway through the schedule, exactly half has vested — 4,500 of 9,000')
  ok(half.payments.length === 1 && half.payments[0].amount === 4500n && half.payments[0].to === BOB, '…and it pays exactly that, to exactly the named address')
  const early = runCall(vesting, 'release', ctx({ height: 100n }), state)
  ok(!early.ok && /guard/.test(early.reason ?? ''), 'at the very start nothing has vested — the guard refuses, and a refused call changes NOTHING')
  const done = runCall(vesting, 'release', ctx({ height: 99_999n }), state)
  ok(done.ok && done.vars.released === 9000n, 'long after the end it is capped at the total — never more, however late the call')

  // ── 2 · ESCROW — two parties, one arbiter, no trust in the contract author ──
  const escrow: ContractCode = {
    vars: { buyer: addrInt(ALICE).toString(), seller: addrInt(BOB).toString(), deadline: '200', settled: '0' },
    rules: [
      { name: 'accept', when: { op: 'and', args: [{ op: 'eq', args: [{ ctx: 'caller' }, { var: 'buyer' }] }, { op: 'eq', args: [{ var: 'settled' }, { lit: '0' }] }] },
        then: [{ set: { var: 'settled', to: { lit: '1' } } }, { pay: { to: { addr: BOB }, amount: { ctx: 'balance' } } }] },
      { name: 'refund', when: { op: 'and', args: [{ op: 'gt', args: [{ ctx: 'height' }, { var: 'deadline' }] }, { op: 'eq', args: [{ var: 'settled' }, { lit: '0' }] }] },
        then: [{ set: { var: 'settled', to: { lit: '1' } } }, { pay: { to: { addr: ALICE }, amount: { ctx: 'balance' } } }] },
    ],
  }
  ok(validateContract(escrow).ok, 'an escrow with two rules validates')
  const esState = { buyer: addrInt(ALICE), seller: addrInt(BOB), deadline: 200n, settled: 0n }
  const byEve = runCall(escrow, 'accept', ctx({ caller: EVE }), esState)
  ok(!byEve.ok, 'ATTACK: a stranger calling `accept` → REFUSED (the guard compares the caller\'s identity)')
  const byBuyer = runCall(escrow, 'accept', ctx({ caller: ALICE }), esState)
  ok(byBuyer.ok && byBuyer.payments[0].to === BOB && byBuyer.payments[0].amount === 10_000n, 'the buyer accepts and the seller is paid the whole balance')
  const earlyRefund = runCall(escrow, 'refund', ctx({ height: 150n }), esState)
  ok(!earlyRefund.ok, 'a refund before the deadline → REFUSED')
  const lateRefund = runCall(escrow, 'refund', ctx({ height: 201n }), esState)
  ok(lateRefund.ok && lateRefund.payments[0].to === ALICE, 'after the deadline the buyer can always be refunded — no arbiter needed')
  const alreadySettled = runCall(escrow, 'refund', ctx({ height: 201n }), { ...esState, settled: 1n })
  ok(!alreadySettled.ok, 'once settled, neither rule fires again — paid twice is the oldest contract bug there is')

  // ── 3 · A FAIR LOTTERY — the only entropy is the Bitcoin beacon ───────────
  const lottery: ContractCode = {
    vars: { players: '3', prize: '3000' },
    rules: [{
      name: 'draw',
      when: { op: 'eq', args: [{ op: 'mod', args: [{ ctx: 'beacon' }, { var: 'players' }] }, { arg: 'seat' }] },
      then: [{ pay: { to: { addr: ALICE }, amount: { var: 'prize' } } }],
    }],
  }
  ok(validateContract(lottery).ok, 'a lottery drawn from the Bitcoin beacon validates')
  const seat = BigInt('0x' + 'ab'.repeat(8)) % 3n
  const won = runCall(lottery, 'draw', ctx({ args: { seat } }), { players: 3n, prize: 3000n })
  const lost = runCall(lottery, 'draw', ctx({ args: { seat: (seat + 1n) % 3n } }), { players: 3n, prize: 3000n })
  ok(won.ok && !lost.ok, 'the winning seat is decided by the Bitcoin block hash — nobody, including the node, can steer it')

  // ── 4 · TERMINATION AND DETERMINISM, THE TWO HARD GUARANTEES ─────────────
  // an expression built to be enormous: the budget stops it, nothing hangs
  let bomb: import('../protocol/contract.ts').Expr = { lit: '1' }
  for (let i = 0; i < 40; i++) bomb = { op: 'add', args: [bomb, bomb] } // 2^40 nodes if evaluated naively
  const bombContract: ContractCode = { vars: { x: '0' }, rules: [{ name: 'boom', when: { lit: '1' }, then: [{ set: { var: 'x', to: bomb } }] }] }
  const v = validateContract(bombContract)
  ok(!v.ok && /deeper/.test(v.reason ?? ''), 'ATTACK: an exponentially large expression → REFUSED AT VALIDATION (nesting bound), so it never even reaches a node')
  const wide: import('../protocol/contract.ts').Expr = { op: 'add', args: new Array(600).fill({ lit: '1' }) }
  const wideContract: ContractCode = { vars: { x: '0' }, rules: [{ name: 'w', when: { lit: '1' }, then: [{ set: { var: 'x', to: wide } }] }] }
  const wideV = validateContract(wideContract)
  ok(!wideV.ok && /nodes/.test(wideV.reason ?? ''), `ATTACK: a ${600}-wide tree → REFUSED AT VALIDATION (node bound), so it never seals`)
  const fatLit: ContractCode = { vars: { x: '0' }, rules: [{ name: 'f', when: { lit: '1' }, then: [{ set: { var: 'x', to: { lit: '1'.repeat(MAX_LIT_DIGITS + 1) } } }] }] }
  const fatLitV = validateContract(fatLit)
  ok(!fatLitV.ok && /digits/.test(fatLitV.reason ?? ''), `ATTACK: a ${MAX_LIT_DIGITS + 1}-digit literal → REFUSED AT VALIDATION, before a seal`)
  const fatVar: ContractCode = { vars: { x: '1'.repeat(MAX_LIT_DIGITS + 1) }, rules: [{ name: 'f', when: { lit: '1' }, then: [{ set: { var: 'x', to: { lit: '1' } } }] }] }
  const fatVarV = validateContract(fatVar)
  ok(!fatVarV.ok && /digits/.test(fatVarV.reason ?? ''), 'ATTACK: a fat variable seed → REFUSED AT VALIDATION')
  const bulky: import('../protocol/contract.ts').Expr = { op: 'add', args: new Array(500).fill({ lit: '1'.repeat(30) }) }
  const bulkyContract: ContractCode = { vars: { x: '0' }, rules: [{ name: 'b', when: { lit: '1' }, then: [{ set: { var: 'x', to: bulky } }] }] }
  const bulkyBytes = canonicalCode(bulkyContract).length
  const bulkyV = validateContract(bulkyContract)
  ok(bulkyBytes > MAX_CODE_BYTES && !bulkyV.ok && /bytes/.test(bulkyV.reason ?? ''),
    `ATTACK: a ${bulkyBytes}-byte IR (under the node bound) → REFUSED AT VALIDATION (ceiling ${MAX_CODE_BYTES})`)
  // two legal trees that share one call budget — validation passes; the meter still stops mid-flight
  const chunk: import('../protocol/contract.ts').Expr = { op: 'add', args: new Array(300).fill({ lit: '1' }) }
  const split: ContractCode = { vars: { x: '0' }, rules: [{ name: 'w', when: chunk, then: [{ set: { var: 'x', to: chunk } }] }] }
  ok(validateContract(split).ok, 'two 300-node trees are each legal…')
  const wr = runCall(split, 'w', ctx(), { x: 0n })
  ok(!wr.ok && /budget/.test(wr.reason ?? ''), `…and the shared ${MAX_NODES}-node call budget stops them mid-flight — every call terminates, so no gas is needed`)
  const measured = runCall(vesting, 'release', ctx({ height: 550n }), state)
  ok(measured.nodes > 0 && measured.nodes < MAX_NODES, `cost is MEASURED, not estimated — the vesting call used ${measured.nodes} nodes`)

  // ── 5 · A CONTRACT CANNOT REACH MONEY IT DOES NOT OWN ────────────────────
  const greedy: ContractCode = { vars: { x: '0' }, rules: [{ name: 'grab', when: { lit: '1' }, then: [{ pay: { to: { addr: EVE }, amount: { lit: '999999' } } }] }] }
  const g = runCall(greedy, 'grab', ctx({ balance: 10n }), { x: 0n })
  ok(!g.ok && /holds 10/.test(g.reason ?? ''), 'ATTACK: paying more than the contract holds → REFUSED, and the refusal says the exact numbers')
  const drainer: ContractCode = { vars: { x: '0' }, rules: [{ name: 'd', when: { lit: '1' }, then: [
    { pay: { to: { addr: EVE }, amount: { lit: '6000' } } }, { pay: { to: { addr: EVE }, amount: { lit: '6000' } } },
  ] }] }
  const d = runCall(drainer, 'd', ctx({ balance: 10_000n }), { x: 0n })
  ok(!d.ok && /would pay 12000/.test(d.reason ?? ''), 'ATTACK: two payments that TOGETHER exceed the balance → the whole call is refused, not the first half applied')
  const negative: ContractCode = { vars: { x: '0' }, rules: [{ name: 'n', when: { lit: '1' }, then: [{ pay: { to: { addr: EVE }, amount: { lit: '-5' } } }] }] }
  ok(!runCall(negative, 'n', ctx(), { x: 0n }).ok, 'ATTACK: a NEGATIVE payment (the classic sign-flip drain) → REFUSED')

  // ── 6 · NOTHING IS EVER HALF-APPLIED ─────────────────────────────────────
  const halfway: ContractCode = {
    vars: { a: '0', b: '0' },
    rules: [{ name: 'mid', when: { lit: '1' }, then: [
      { set: { var: 'a', to: { lit: '1' } } },
      { require: { lit: '0' } }, // fails here
      { set: { var: 'b', to: { lit: '1' } } },
    ] }],
  }
  const h = runCall(halfway, 'mid', ctx(), { a: 0n, b: 0n })
  ok(!h.ok && Object.keys(h.vars).length === 0 && h.payments.length === 0, 'a `require` that fails halfway leaves NO variable written and NO payment queued — all or nothing, like a settlement')

  // ── 7 · MALFORMED CONTRACTS NEVER ENTER THE CHAIN ────────────────────────
  const bads: Array<[unknown, RegExp, string]> = [
    [{ rules: [] }, /at least one rule/, 'a contract with no rules'],
    [{ rules: [{ name: 'x', when: { lit: '1' }, then: [] }] }, /does nothing/, 'a rule that does nothing'],
    [{ rules: [{ name: 'x', when: { op: 'nope', args: [{ lit: '1' }] }, then: [{ require: { lit: '1' } }] }] }, /unknown operation/, 'an unknown operation'],
    [{ rules: [{ name: 'x', when: { var: 'ghost' }, then: [{ require: { lit: '1' } }] }] }, /unknown variable/, 'a rule reading a variable that does not exist'],
    [{ vars: { a: 'oops' }, rules: [{ name: 'x', when: { lit: '1' }, then: [{ require: { lit: '1' } }] }] }, /whole number/, 'a variable that is not a whole number'],
    [{ rules: [{ name: 'x', when: { lit: '1' }, then: [{ set: { var: 'nope', to: { lit: '1' } } }] }] }, /undeclared variable/, 'writing an undeclared variable'],
    [{ rules: [{ name: 'x', when: { op: 'div', args: [{ lit: '1' }] }, then: [{ require: { lit: '1' } }] }] }, /takes 2 arguments/, 'wrong arity'],
    [{ rules: [{ name: 'a', when: { lit: '1' }, then: [{ require: { lit: '1' } }] }, { name: 'a', when: { lit: '1' }, then: [{ require: { lit: '1' } }] }] }, /duplicate rule/, 'two rules with the same name'],
  ]
  for (const [code, why, label] of bads) {
    const r = validateContract(code as ContractCode)
    ok(!r.ok && why.test(r.reason ?? ''), `REFUSED AT THE GATE: ${label} — ${r.reason}`)
  }
  const zero: ContractCode = { vars: { x: '0' }, rules: [{ name: 'z', when: { lit: '1' }, then: [{ set: { var: 'x', to: { op: 'div', args: [{ lit: '1' }, { lit: '0' }] } } }] }] }
  ok(!runCall(zero, 'z', ctx(), { x: 0n }).ok, 'division by zero REFUSES the call — a contract with a bug must stop, never improvise')

  // ── 8 · THE SAME CODE IS THE SAME CONTRACT, FOREVER ──────────────────────
  const a1 = canonicalCode(vesting), a2 = canonicalCode({ ...vesting, vars: { duration: '900', released: '0', start: '100', total: '9000' } })
  ok(a1 === a2, 'the canonical form is order-independent — the same rules hash to the same identity however they were typed')
  const runs = new Set(Array.from({ length: 20 }, () => JSON.stringify(runCall(vesting, 'release', ctx({ height: 550n }), state), (_, x) => (typeof x === 'bigint' ? x.toString() : x))))
  ok(runs.size === 1, 'twenty identical calls produce ONE identical result — determinism, which is what lets every node replay a contract forever')

  // ── 9 · A FUZZ STORM: thousands of random contracts and calls ─────────────
  // The suite above proves the cases I thought of. This proves the ones I did
  // not: random rules, random guards, random payments, all asserting the three
  // laws that must never bend — it always terminates, it never pays more than it
  // holds, and a failed call never writes anything.
  let seed = 987654321
  const rnd = (n: number): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n }
  const randExpr = (depth: number): import('../protocol/contract.ts').Expr => {
    if (depth <= 0 || rnd(3) === 0) {
      const leaf = rnd(4)
      if (leaf === 0) return { lit: String(rnd(10_000)) }
      if (leaf === 1) return { var: ['a', 'b', 'c'][rnd(3)] }
      if (leaf === 2) return { arg: 'x' }
      return { ctx: (['caller', 'height', 'interval', 'at', 'beacon', 'balance'] as const)[rnd(6)] }
    }
    const ops = ['add', 'sub', 'mul', 'div', 'mod', 'min', 'max', 'isqrt', 'neg', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'and', 'or', 'not', 'if'] as const
    const op = ops[rnd(ops.length)]
    const n = op === 'if' ? 3 : ['isqrt', 'neg', 'not'].includes(op) ? 1 : ['add', 'mul', 'min', 'max', 'and', 'or'].includes(op) ? 1 + rnd(3) : 2
    return { op, args: Array.from({ length: n }, () => randExpr(depth - 1)) }
  }
  let ran = 0, applied = 0, refused = 0, overspend = 0
  for (let i = 0; i < 3000; i++) {
    const actions: import('../protocol/contract.ts').Action[] = Array.from({ length: 1 + rnd(4) }, () => {
      const k = rnd(3)
      if (k === 0) return { pay: { to: { addr: [ALICE, BOB, EVE][rnd(3)] }, amount: randExpr(3) } }
      if (k === 1) return { set: { var: ['a', 'b', 'c'][rnd(3)], to: randExpr(3) } }
      return { require: randExpr(3) }
    })
    const code: ContractCode = { vars: { a: String(rnd(1000)), b: String(rnd(1000)), c: '0' }, rules: [{ name: 'r', when: randExpr(4), then: actions }] }
    if (!validateContract(code).ok) continue
    const balance = BigInt(rnd(20_000))
    const st = { a: BigInt(code.vars.a), b: BigInt(code.vars.b), c: 0n }
    const r = runCall(code, 'r', ctx({ balance, args: { x: BigInt(rnd(5000)) } }), st)
    ran++
    if (r.ok) {
      applied++
      const paid = r.payments.reduce((t, p) => t + p.amount, 0n)
      if (paid > balance) { console.error(`  ✗ FAILED — a call paid ${paid} from a balance of ${balance}`); process.exit(1) }
      if (r.payments.some((p) => p.amount <= 0n)) { console.error('  ✗ FAILED — a zero or negative payment was queued'); process.exit(1) }
      if (r.nodes > MAX_NODES) { console.error('  ✗ FAILED — a call exceeded the node budget without being stopped'); process.exit(1) }
    } else {
      refused++
      if (Object.keys(r.vars).length !== 0 || r.payments.length !== 0) { console.error('  ✗ FAILED — a REFUSED call left state behind'); process.exit(1) }
      if (/holds/.test(r.reason ?? '')) overspend++
    }
  }
  const scrollPay: ContractCode = {
    vars: { each: '5' },
    rules: [{ name: 'claim', when: { lit: '1' }, then: [{ pay: { to: { living: 'caller' }, amount: { var: 'each' } } }] }],
  }
  ok(validateContract(scrollPay).ok, 'pay-to-caller validates — the living claimant is a legal dest')
  const paidCaller = runCall(scrollPay, 'claim', ctx({ caller: EVE, balance: 20n }), { each: 5n })
  ok(paidCaller.ok && paidCaller.payments[0].to === EVE && paidCaller.payments[0].amount === 5n,
    'claim pays the caller, not a sealed dest')
  const noCaller = runCall(scrollPay, 'claim', ctx({ caller: '', balance: 20n }), { each: 5n })
  ok(!noCaller.ok, 'pay-to-caller without a caller is refused')

  ok(ran > 1500, `${ran} random contracts executed (${applied} applied, ${refused} refused, ${overspend} of them for trying to overspend)`)
  ok(true, 'in every one: it terminated, it never paid more than it held, no payment was zero or negative, and a refusal left NOTHING behind')

  console.log(`\n✓ ${pass} checks passed — PROGRAMMABILITY WITHOUT THE DANGER: contracts are TOTAL (no loops, a hard node budget, so every call terminates and no gas meter is needed), DETERMINISTIC (integers only, no clock, the Bitcoin beacon as the sole entropy — twenty runs, one answer), and INCAPABLE OF CREATING VALUE (a contract pays only from what it holds; overspending, negative payments and half-applied calls are all refused). Vesting, escrow and a beacon-drawn lottery all work; an exponential expression, a fat literal, a wide tree and an oversized IR are refused at validation — the same spirit as the 10 MB star: what enters the book has size. The worst a broken contract can do here is lose its own holdings. ₭`)
}
main()
