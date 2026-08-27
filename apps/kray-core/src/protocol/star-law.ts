/**
 * LIVING LAW — a desk that compiles to the existing total IR (contract.ts).
 *
 * Not a second VM. Not a language in consensus. A human (and later an agent)
 * writes clauses as named true/false flags; this module emits the same
 * `when`/`then` tree the reducer already runs. Source in any language can be
 * the relic; what runs is this IR.
 *
 * Sealed rules (always present):
 *   toggle_<flag> — living owner, motion toggle: true ↔ false, forever
 *   once_<flag>   — living owner, motion once: true → false, one call, never back
 *   pulse         — anyone, if `alive` is on: public breath (A3: already journaled; tools are not this)
 *   collect       — the living owner empties the pot to themselves, if `open`
 *
 * Mouth language is true/false. The journal stores 1 and 0. The creator picks
 * each clause's motion. The mouth travels with the face (A9).
 *
 * The pot stays KRAY_CONTRACT_ (keyless). Transfer-star does not drain it.
 * The mouth travels with the face: ownerOf(N) is re-derived every call (A9).
 */
import { sha256hex } from './kray-primitives.ts'
import { validateContract, type Action, type ContractCode, type Expr, type Rule } from './contract.ts'

const FLAG_RE = /^[a-z][a-z0-9_]{0,23}$/
const RESERVED = new Set(['owner'])
export const MAX_LIVING_FLAGS = 16

/** How a clause moves. Toggle is bidirectional. Once is monotone: true → false. */
export type LivingMotion = 'toggle' | 'once'

export interface LivingFlag {
  name: string
  /** mouth language: true/false. Journal stores 1/0. */
  on: boolean
  /** omitted → toggle (frozen desks that never sent motion still compile) */
  motion?: LivingMotion
}

export interface LivingLawInput {
  /** first-writer identity, stored in vars for provenance — the GATE uses ctx.holder */
  owner: string
  /** ignored: collect pays the living owner. Kept so existing desks still compile. */
  payout?: string
  flags: LivingFlag[]
}

/** Same integer the ledger uses for `ctx.caller` / owner compares. */
export function callerInt(addr: string): string {
  return BigInt('0x' + sha256hex(addr).slice(0, 16)).toString()
}

/** Living mouth — the address that currently owns the star, not the sealer. */
const callerIsOwner: Expr = { op: 'eq', args: [{ ctx: 'caller' }, { ctx: 'holder' }] }
const balGt0: Expr = { op: 'gt', args: [{ ctx: 'balance' }, { lit: '0' }] }

function toggleExpr(name: string): Expr {
  return {
    op: 'if',
    args: [
      { op: 'eq', args: [{ var: name }, { lit: '1' }] },
      { lit: '0' },
      { lit: '1' },
    ],
  }
}

/**
 * Compile a flag desk into IR the reducer already understands.
 * Throws a named reason — never a truncated or silent default.
 */
export function compileLivingLaw(input: LivingLawInput): ContractCode {
  if (!input || typeof input.owner !== 'string' || !/^-?\d+$/.test(input.owner)) {
    throw new Error('living law: owner must be a whole-number identity')
  }
  if (input.payout != null && input.payout !== '' && !/^[a-z0-9]{8,90}$/i.test(input.payout)) {
    throw new Error('living law: payout must be a sealed address')
  }
  if (!Array.isArray(input.flags) || input.flags.length === 0) {
    throw new Error('living law: at least one flag')
  }
  if (input.flags.length > MAX_LIVING_FLAGS) {
    throw new Error(`living law: at most ${MAX_LIVING_FLAGS} flags`)
  }
  const vars: Record<string, string> = { owner: input.owner }
  const rules: Rule[] = []
  const seen = new Set<string>(RESERVED)
  let hasAlive = false
  let hasOpen = false
  for (const f of input.flags) {
    if (!f || typeof f.name !== 'string' || !FLAG_RE.test(f.name) || RESERVED.has(f.name)) {
      throw new Error(`living law: bad flag "${f?.name ?? ''}"`)
    }
    if (seen.has(f.name)) throw new Error(`living law: duplicate flag "${f.name}"`)
    seen.add(f.name)
    if (f.name === 'alive') hasAlive = true
    if (f.name === 'open') hasOpen = true
    vars[f.name] = f.on ? '1' : '0'
    const motion: LivingMotion = f.motion === 'once' ? 'once' : 'toggle'
    if (motion === 'once') {
      if (!f.on) throw new Error(`living law: once "${f.name}" must start true — a false latch can never fire`)
      rules.push({
        name: `once_${f.name}`,
        when: { op: 'and', args: [callerIsOwner, { op: 'eq', args: [{ var: f.name }, { lit: '1' }] }] },
        then: [{ set: { var: f.name, to: { lit: '0' } } }],
      })
    } else {
      rules.push({
        name: `toggle_${f.name}`,
        when: callerIsOwner,
        then: [{ set: { var: f.name, to: toggleExpr(f.name) } }],
      })
    }
  }
  if (hasAlive) {
    rules.push({
      name: 'pulse',
      when: { op: 'eq', args: [{ var: 'alive' }, { lit: '1' }] },
      then: [{ require: { lit: '1' } }],
    })
  }
  const collectWhen: Expr = hasOpen
    ? { op: 'and', args: [callerIsOwner, { op: 'eq', args: [{ var: 'open' }, { lit: '1' }] }, balGt0] }
    : { op: 'and', args: [callerIsOwner, balGt0] }
  const collectThen: Action[] = [{ pay: { to: { living: 'owner' }, amount: { ctx: 'balance' } } }]
  rules.push({ name: 'collect', when: collectWhen, then: collectThen })
  const code: ContractCode = { vars, rules }
  const v = validateContract(code)
  if (!v.ok) throw new Error(`living law: compiled IR is not valid (${v.reason})`)
  return code
}

/** Default being — ready to live, open to receive, agent flag off until flipped. */
export function defaultLivingFlags(): LivingFlag[] {
  return [
    { name: 'alive', on: true, motion: 'toggle' },
    { name: 'open', on: true, motion: 'toggle' },
    { name: 'agent', on: false, motion: 'toggle' },
  ]
}
