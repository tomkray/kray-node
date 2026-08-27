/**
 * CONTRACT EXAM — a dry run of the same IR the reducer will run.
 *
 * Not a second VM. Not a journal act. Not a ₭. The door (and the write studio)
 * call this BEFORE a seal so a broken paper never reaches a signature. The
 * reducer still validateContract + runCall on apply — enforced twice.
 *
 * A guard that is false under the exam fixture is not corruption: the machine
 * refused cleanly. Corruption is: not IR, invalid shape, or a throw the VM
 * cannot name. Solidity / Python / prose fail at parse. They never execute.
 */
import { sha256hex } from './kray-primitives.ts'
import { canonicalCode, runCall, validateContract, type ContractCode, type CallContext } from './contract.ts'

/** Keyless exam identity — not a wallet, not a pot. addressToInt just hashes it. */
export const EXAM_CALLER = 'KRAYEXAMOWNER'

export type ExamKind = 'pass' | 'fail' | 'quiet'

export interface ExamCheck {
  id: string
  ok: boolean
  kind: ExamKind
  label: string
  detail?: string
}

export interface ExamResult {
  ok: boolean
  /** validate passed and no rule crashed — the paper may be sealed */
  ready: boolean
  codeHash: string
  code: ContractCode
  checks: ExamCheck[]
}

function examContext(balance = 10_000n): CallContext {
  const callerInt = BigInt('0x' + sha256hex(EXAM_CALLER).slice(0, 16))
  return {
    caller: EXAM_CALLER,
    self: 'KRAY_CONTRACT_exam',
    balance,
    height: 64n,
    interval: 0n,
    at: 0n,
    beacon: 0n,
    star: 1n,
    holder: callerInt,
    holderAddress: EXAM_CALLER,
    args: {},
    addressToInt: (a: string) => BigInt('0x' + sha256hex(a).slice(0, 16)),
  }
}

function stateOf(code: ContractCode): Record<string, bigint> {
  const state: Record<string, bigint> = {}
  for (const [k, v] of Object.entries(code.vars ?? {})) state[k] = BigInt(v)
  return state
}

/**
 * Run every rule once against a fixed fixture. Never writes the journal.
 */
export function examContract(code: ContractCode): ExamResult {
  const checks: ExamCheck[] = []
  const v = validateContract(code)
  checks.push({
    id: 'validate',
    ok: v.ok,
    kind: v.ok ? 'pass' : 'fail',
    label: v.ok ? 'IR is total — the reducer will accept this shape' : 'IR is not valid',
    detail: v.reason,
  })
  if (!v.ok) {
    return { ok: false, ready: false, codeHash: '', code, checks }
  }
  const codeHash = sha256hex(canonicalCode(code))
  checks.push({
    id: 'codeHash',
    ok: true,
    kind: 'pass',
    label: 'codeHash is the 32 bytes a seal will sign',
    detail: codeHash,
  })
  const ctx = examContext()
  const base = stateOf(code)
  for (const rule of code.rules) {
    const r = runCall(code, rule.name, ctx, { ...base })
    if (r.ok) {
      const paid = r.payments.map((p) => `${p.amount}→${p.to}`).join(', ')
      checks.push({
        id: `rule:${rule.name}`,
        ok: true,
        kind: 'pass',
        label: `${rule.name} fired under the exam fixture`,
        detail: paid || (Object.keys(r.vars).length ? `set ${Object.keys(r.vars).join(', ')}` : 'no mutation'),
      })
      continue
    }
    const quiet = /guard of .* is false/i.test(r.reason || '')
      || /require failed/i.test(r.reason || '')
      || /missing argument/i.test(r.reason || '')
    checks.push({
      id: `rule:${rule.name}`,
      ok: true,
      kind: quiet ? 'quiet' : 'fail',
      label: quiet
        ? `${rule.name} refused cleanly — not corruption (fixture is not that mouth)`
        : `${rule.name} crashed`,
      detail: r.reason,
    })
  }
  const ready = checks.every((c) => c.kind !== 'fail')
  return { ok: ready, ready, codeHash, code, checks }
}

/** Parse a dropped/pasted blob. Only JSON IR enters. Anything else is named refuse. */
export function parseExamSource(raw: string): { ok: true; code: ContractCode } | { ok: false; reason: string } {
  const t = String(raw ?? '').trim()
  if (!t) return { ok: false, reason: 'empty paper — paste IR or drop a .json file' }
  if (/pragma solidity|fn |function |def |import |package /i.test(t) && t[0] !== '{') {
    return { ok: false, reason: 'not IR — Solidity, Python or other languages do not enter the reducer. Paste vars + rules JSON (or let a template compile).' }
  }
  try {
    const code = JSON.parse(t) as ContractCode
    if (!code || typeof code !== 'object' || !Array.isArray(code.rules)) {
      return { ok: false, reason: 'JSON must be an IR object with a rules array' }
    }
    return { ok: true, code }
  } catch {
    return { ok: false, reason: 'not JSON — the paper is vars + rules, not prose' }
  }
}
