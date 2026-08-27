/**
 * CONTRACT EXAM — the dry run that gates a seal.
 *   node src/test/contract-exam.test.ts
 */
import { examContract, parseExamSource } from '../protocol/contract-exam.ts'
import { compileLivingLaw, callerInt } from '../protocol/star-law.ts'
import { compileTunnel, compileRaffle, compileMint } from '../protocol/star-forms.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function main() {
  console.log('\n╔═ CONTRACT EXAM — dry run · no journal · no ₭ ═╗\n')
  const living = compileLivingLaw({
    owner: callerInt('bcrt1pexam'),
    flags: [
      { name: 'alive', on: true, motion: 'toggle' },
      { name: 'valid', on: true, motion: 'once' },
    ],
  })
  const e = examContract(living)
  ok(e.ready && e.ok && /^[0-9a-f]{64}$/.test(e.codeHash), 'a living pass is ready — the paper may be sealed')
  ok(e.checks.some((c) => c.id === 'rule:once_valid' && c.kind === 'pass'), 'once_valid fires under the owner fixture')
  ok(e.checks.some((c) => c.id === 'rule:toggle_alive' && c.kind === 'pass'), 'toggle_alive fires under the owner fixture')
  ok(e.checks.every((c) => c.kind !== 'fail'), 'no rule crashed — a clean refuse is not corruption')

  const junk = examContract({ vars: {}, rules: [] })
  ok(!junk.ready && junk.checks.some((c) => c.id === 'validate' && c.kind === 'fail'), 'empty IR is not ready')

  const sol = parseExamSource('pragma solidity ^0.8.0; contract X {}')
  ok(!sol.ok && /not IR/i.test(sol.reason), 'Solidity is refused at parse — it never touches runCall')
  const prose = parseExamSource('this is my ticket contract please')
  ok(!prose.ok, 'prose is refused — not JSON')
  const parsed = parseExamSource(JSON.stringify(living))
  ok(parsed.ok, 'a dropped JSON file of the same IR parses')

  const mark = examContract({
    vars: { hit: '0' },
    rules: [{ name: 'mark', when: { lit: '1' }, then: [{ set: { var: 'hit', to: { lit: '1' } } }] }],
  })
  ok(mark.ready && mark.checks.some((c) => c.id === 'rule:mark' && c.kind === 'pass' && /hit/.test(c.detail || '')),
    'raw mark fires and names the mutation')

  const pipe = examContract(compileTunnel({}))
  ok(pipe.ready && pipe.checks.some((c) => c.id === 'rule:punch' && c.kind === 'quiet'),
    'tunnel punch without amount is quiet — the paper is not corrupt')

  const wheel = examContract(compileRaffle({ price: '5' }))
  ok(wheel.ready && !wheel.checks.some((c) => c.kind === 'fail'),
    'raffle knobs compile to a paper that may be sealed — no star needed for the dry run')
  ok(wheel.checks.some((c) => c.id === 'rule:enter' && c.kind === 'pass'),
    'enter fires under the exam fixture (due is 0 — the first window is open)')
  ok(wheel.checks.some((c) => c.id === 'rule:settle' && c.kind === 'quiet'),
    'settle is quiet before the seals — a clean refuse, not a broken paper')
  ok(!(wheel.code.rules || []).some((r) => r.name === 'collect'),
    'the exam paper has no collect')

  const drop = examContract(compileMint({ price: '5', max: '8' }))
  ok(drop.ready && !drop.checks.some((c) => c.kind === 'fail'),
    'mint knobs compile to a paper that may be sealed — the blessing is dry-run, not a journal act')
  ok(drop.checks.some((c) => c.id === 'rule:mint' && c.kind === 'pass'),
    'mint fires under the exam fixture (open and room)')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — EXAM HOLDS: valid paper is ready, foreign languages never run, a clean refuse is not a crash. ⚖`)
}
main()
