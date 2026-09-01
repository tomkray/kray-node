/**
 * N2 — ISQRT LAW: the door cap is 78 digits; Newton is unchanged.
 *   node src/test/isqrt-law.test.ts
 *
 * Measured on this machine (2026-09-01): 78-digit ~0.03ms; 156-digit product
 * ~0.05ms; 1000× 78-digit ~14ms. The swarm 843ms/seal claim is not this width.
 * DIGIT_LAW_SEQ closes the residual at/after the pin (`CallContext.digitLaw`).
 */
import { createHash } from 'node:crypto'
import { isqrt } from '../economics/presence.ts'
import { MAX_LIT_DIGITS, runCall, validateContract, type CallContext, type ContractCode } from '../protocol/contract.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

const ALICE = 'bcrt1p' + 'a'.repeat(58)
const SELF = 'bcrt1p' + 'f'.repeat(58)
const addrInt = (a: string): bigint => BigInt('0x' + createHash('sha256').update(a).digest('hex').slice(0, 16))
const ctx = (): CallContext => ({
  caller: ALICE, self: SELF, balance: 0n, height: 1n, interval: 1n, at: 0n,
  beacon: 0n, args: {}, addressToInt: addrInt,
})

function main() {
  console.log('\n╔═ N2 — ISQRT LAW: 78 digits is the door; Newton is not rewritten ═╗\n')

  ok(isqrt(0n) === 0n && isqrt(1n) === 1n && isqrt(2n) === 1n && isqrt(4n) === 2n, 'N2-01 Newton is exact on the small boundaries')
  ok(isqrt(10n ** 76n) === 10n ** 38n, 'N2-02 a 77-digit perfect square (inside the door) is exact')

  const n78 = 10n ** 77n
  const r78 = isqrt(n78)
  ok(r78 * r78 <= n78 && (r78 + 1n) * (r78 + 1n) > n78, 'N2-03 a 78-digit operand floors exactly')

  const n156 = n78 * n78
  const r156 = isqrt(n156)
  ok(r156 === n78, 'N2-04 isqrt of one legal mul (156 digits) is exact — Newton not rewritten')

  const t0 = performance.now()
  for (let i = 0; i < 1000; i++) isqrt(n78)
  const burst = performance.now() - t0
  ok(burst < 500, `N2-05 1000× 78-digit isqrt is ${burst.toFixed(1)}ms — not 843ms per call`)
  console.log(`     (1000× 78-digit: ${burst.toFixed(1)}ms)`)

  const fatLit: ContractCode = {
    vars: { x: '0' },
    rules: [{ name: 'r', when: { lit: '1' }, then: [{ set: { var: 'x', to: { lit: '1'.repeat(MAX_LIT_DIGITS + 1) } } }] }],
  }
  const fatV = validateContract(fatLit)
  ok(!fatV.ok && /digits/.test(fatV.reason ?? ''), 'N2-06 a 79-digit literal is refused at the door')

  const legal: ContractCode = {
    vars: { x: '0' },
    rules: [{ name: 'r', when: { lit: '1' }, then: [{ set: { var: 'x', to: { op: 'isqrt', args: [{ lit: '1'.repeat(MAX_LIT_DIGITS) }] } } }] }],
  }
  ok(validateContract(legal).ok, 'N2-07 a 78-digit isqrt paper validates')
  const call = runCall(legal, 'r', ctx(), { x: 0n })
  ok(call.ok && typeof call.vars.x === 'bigint', 'N2-08 a 78-digit isqrt call terminates')

  const sq: ContractCode = {
    vars: { x: '0' },
    rules: [{ name: 'sq', when: { lit: '1' }, then: [{ set: { var: 'x', to: { op: 'mul', args: [{ var: 'x' }, { var: 'x' }] } } }] }],
  }
  let x = n78
  for (let i = 0; i < 5; i++) {
    const r = runCall(sq, 'sq', ctx(), { x })
    if (!r.ok) { ok(false, 'N2-09 square-the-var refused unexpectedly'); x = 0n; break }
    x = r.vars.x
  }
  ok(x.toString().length > MAX_LIT_DIGITS, `N2-09 residual below the pin: five squares grow state to ${x.toString().length} digits`)

  const law = (): CallContext => ({ ...ctx(), digitLaw: true })
  const first = runCall(sq, 'sq', law(), { x: n78 })
  ok(!first.ok && /digits/.test(first.reason ?? ''), 'N2-10 at the pin, squaring a 78-digit var is refused')

  const ok78 = runCall(legal, 'r', law(), { x: 0n })
  ok(ok78.ok, 'N2-11 at the pin, a 78-digit isqrt still terminates')

  const fatIsqrt: ContractCode = {
    vars: { x: '0' },
    rules: [{ name: 'r', when: { lit: '1' }, then: [{ set: { var: 'x', to: { op: 'isqrt', args: [{ op: 'mul', args: [{ lit: '1'.repeat(MAX_LIT_DIGITS) }, { lit: '1'.repeat(MAX_LIT_DIGITS) }] }] } } }] }],
  }
  const fatV2 = validateContract(fatIsqrt)
  ok(fatV2.ok, 'N2-12 a mul-then-isqrt paper still validates (lits are 78)')
  const fatCall = runCall(fatIsqrt, 'r', law(), { x: 0n })
  ok(!fatCall.ok && /digits/.test(fatCall.reason ?? ''), 'N2-13 at the pin, isqrt of a 156-digit product is refused')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n╚═ ${pass} passed — N2 ratified; Newton untouched; digit law closes the residual at the pin. ₭\n`)
}
main()
