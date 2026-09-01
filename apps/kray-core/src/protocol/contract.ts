/**
 * KRAY CONTRACTS — programmability that cannot lie, cannot loop, and cannot mint.
 *
 * Every other chain buys expressiveness with danger: a Turing-complete machine
 * needs gas because a program might never stop, and it needs a virtual machine
 * whose bugs become consensus bugs. KRAY takes the opposite trade, on purpose.
 *
 * ── THE THREE LAWS OF THIS LANGUAGE ─────────────────────────────────────────
 *
 * 1 · TOTAL. There are no loops, no recursion, no jumps — an expression is a
 *     finite tree with a hard node budget, so every call terminates in bounded
 *     steps. Gas exists to price the risk of non-termination; remove the risk
 *     and the meter is unnecessary. Nothing here can hang a node.
 *
 * 2 · DETERMINISTIC. Integers only (BigInt), no clock, no randomness, no I/O.
 *     The only entropy available is the Bitcoin beacon already recorded in the
 *     journal, so a contract's whole history re-derives identically on every
 *     node, forever — and lands inside the cascade root that Bitcoin witnesses.
 *
 * 3 · CANNOT CREATE VALUE. A contract is an ACCOUNT. It pays only from what it
 *     holds, through the very movement primitives the ledger already proves, so
 *     KRAY conservation (circulating = emitted − burned) and per-rune solvency are
 *     untouchable from in here. The worst a
 *     broken contract can do is lose its own holdings — never the network's. The
 *     DAO drained a chain; the equivalent here drains one address.
 *
 * A contract is a set of GUARDED RULES: `when <expression> then <actions>`. A
 * signed call names a rule and its arguments; the guard is evaluated over the
 * contract's own state, the call's arguments and a small, journal-derived
 * context. If the guard is false the call is refused, and a refused call changes
 * NOTHING — the same all-or-nothing discipline as a settlement.
 *
 * Pure and total: no I/O, no clock, no network. Same inputs → same answer.
 */
import { createHash } from 'node:crypto'
import { isqrt } from '../economics/presence.ts'

/** The node budget for one call. Generous for real rules, fatal to abuse. */
export const MAX_NODES = 512
/** How deep an expression tree may nest — a second, independent bound. */
export const MAX_DEPTH = 32
/** How many rules a contract may declare, and how many actions each may take. */
export const MAX_RULES = 32
export const MAX_ACTIONS = 16
/** How many named state variables a contract may hold. */
export const MAX_VARS = 32
/**
 * THE IR BYTE CEILING — same spirit as the 10 MB star: what enters the book has size.
 * Desk compilers (living-16, list-8, raffle-8) sit under 4 KB. 16 KB is the middle of
 * 8–32. Born-strict: no sealed desk exceeds this, and a fat custom tree must not
 * land. If a live book already held a larger law, freeze below that seq (A3) —
 * do not tighten over history. Enforced in validateContract (door and reducer).
 */
export const MAX_CODE_BYTES = 16_384
/**
 * A literal / var integer may not hide a megabyte of digits in one leaf. 78 = 2^256.
 * N2 (2026-09-01): this IS the magnitude cap at the door. Newton is unchanged.
 * 843ms/seal was not reproduced at this width (isqrt-law.test.ts).
 * DIGIT_LAW_SEQ (2026-09-01): at/after the pin, `set` / `isqrt` / call args
 * also refuse past 78 digits — state cannot square across calls. Below the
 * pin the residual stays (regtest benches). Flag is `CallContext.digitLaw`.
 */
export const MAX_LIT_DIGITS = 78

/**
 * AN EXPRESSION. A finite tree of integers — that is the whole language.
 * `lit` a literal · `var` contract state · `arg` a call argument ·
 * `ctx` a journal-derived fact · `op` arithmetic, comparison or logic.
 */
export type Expr =
  | { lit: string } // decimal string → BigInt (never a JS number)
  | { var: string }
  | { arg: string }
  | { ctx: 'caller' | 'height' | 'interval' | 'at' | 'beacon' | 'balance' | 'star' | 'holder' | 'glow' }
  | { op: OpName; args: Expr[] }

export type OpName =
  | 'add' | 'sub' | 'mul' | 'div' | 'mod' | 'min' | 'max' | 'isqrt' | 'neg'
  | 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge'
  | 'and' | 'or' | 'not' | 'if'

/** What a rule may DO. Deliberately tiny: move value, remember a number, refuse. */
export type Action =
  | { pay: { to: Expr | { addr: string } | { living: 'owner' | 'caller' } | { seat: Expr }; amount: Expr } } // from the contract's OWN balance
  | { take: { amount: Expr } } // from the CALLER into the pot — ticket, never a mint
  | { bind: { at: Expr } } // remember the caller's address at a seat (raffle roster)
  | { set: { var: string; to: Expr } }
  | { require: Expr } // a guard mid-way: false ⇒ the whole call is refused

export interface Rule { name: string; when: Expr; then: Action[] }
/** Optional Luz founder table. Absent ⇒ sealer holds the whole supply (A3). In the hash when present. */
export interface LuzGenesisRow { to: string; amount: string }
/** Sealed poll labels. Absent on every paper that is not a poll (A3). Order is the face index. */
export interface PollPaper { title?: string; choices: string[] }
export interface ContractCode {
  rules: Rule[]
  vars?: Record<string, string>
  genesis?: LuzGenesisRow[]
  poll?: PollPaper
}

export interface CallContext {
  /** who signed the call — as an integer, so addresses compare without strings */
  caller: string
  /** the contract's own address, and what it currently holds */
  self: string
  balance: bigint
  /** journal-derived facts. No clock: `at` is the calling EVENT's timestamp. */
  height: bigint
  interval: bigint
  at: bigint
  /** the Bitcoin beacon of the open seal, as an integer — the only entropy */
  beacon: bigint
  /** bound star number when this pot is a star's law (v2). Unbound / v1 → 0. Additive. */
  star?: bigint
  /** living star owner as the same integer `caller` uses. Unbound / v1 → 0. Re-derived from ownerOf each call. */
  holder?: bigint
  /** living star owner's address — `pay { living: 'owner' }` resolves here. Empty when unbound. */
  holderAddress?: string
  /**
   * ✦ glow of the signer — frozen-star count, journal-derived, never a balance.
   * Absent / 0 on a paper that does not read it (A3). The poll door requires > 0.
   */
  glow?: bigint
  /** the call's arguments, already parsed to integers */
  args: Record<string, bigint>
  /** address → integer, so a rule can compare identities without string ops */
  addressToInt: (addr: string) => bigint
  /**
   * DIGIT LAW — when true, `set` / `isqrt` refuse values past MAX_LIT_DIGITS.
   * Absent / false = the residual (benches below the pin). Not journaled (A3).
   */
  digitLaw?: boolean
}

export interface Payment { to: string; amount: bigint; seat?: bigint }
export interface SeatBind { at: bigint; addr: string }
export interface CallResult {
  ok: boolean
  /** the variables that changed, and their new values */
  vars: Record<string, bigint>
  /** what the contract must pay, in order — applied by the ledger, atomically */
  payments: Payment[]
  /** what the caller pays INTO the pot this call — 0 when the rule only speaks */
  take: bigint
  /** seats this call bound to the caller's address — the ledger writes the roster */
  binds: SeatBind[]
  /** how much of the budget the call actually used — measured, not estimated */
  nodes: number
  reason?: string
}

const ADDR_RE = /^[a-z0-9]{8,90}$/i

/** The canonical bytes of a contract — its identity, so the code cannot change
 *  under a state that was built by different rules. Also the size we refuse. */
export function canonicalCode(code: ContractCode): string {
  const rules = code.rules.map((r) => ({ name: r.name, when: r.when, then: r.then }))
  const vars = Object.fromEntries(Object.entries(code.vars ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)))
  const genesis = Array.isArray(code.genesis) && code.genesis.length > 0
    ? [...code.genesis]
      .map((r) => ({ to: String(r.to ?? '').trim(), amount: String(r.amount ?? '').trim() }))
      .sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : a.amount < b.amount ? -1 : 1))
    : undefined
  const poll = code.poll && Array.isArray(code.poll.choices) && code.poll.choices.length > 0
    ? {
        ...(code.poll.title && String(code.poll.title).trim() ? { title: String(code.poll.title).trim() } : {}),
        choices: code.poll.choices.map((c) => String(c).trim()),
      }
    : undefined
  if (poll && genesis) return JSON.stringify({ rules, vars, genesis, poll })
  if (poll) return JSON.stringify({ rules, vars, poll })
  return JSON.stringify(genesis ? { rules, vars, genesis } : { rules, vars })
}

function litDigits(s: string): number {
  return s.startsWith('-') ? s.length - 1 : s.length
}

/**
 * VALIDATE A CONTRACT before it can ever be sealed. A contract that cannot be
 * checked must not enter the chain: after that it is history, and history is
 * forever. Every limit is a refusal, never a truncation.
 */
export function validateContract(code: ContractCode): { ok: boolean; reason?: string } {
  if (!code || !Array.isArray(code.rules) || code.rules.length === 0) return { ok: false, reason: 'a contract needs at least one rule' }
  if (code.rules.length > MAX_RULES) return { ok: false, reason: `at most ${MAX_RULES} rules` }
  const names = new Set<string>()
  const vars = new Set(Object.keys(code.vars ?? {}))
  if (vars.size > MAX_VARS) return { ok: false, reason: `at most ${MAX_VARS} variables` }
  for (const [k, v] of Object.entries(code.vars ?? {})) {
    if (!/^[a-z][a-z0-9_]{0,23}$/.test(k)) return { ok: false, reason: `bad variable name "${k}"` }
    if (!/^-?\d+$/.test(v)) return { ok: false, reason: `variable "${k}" must be a whole number` }
    if (litDigits(v) > MAX_LIT_DIGITS) return { ok: false, reason: `variable "${k}" may have at most ${MAX_LIT_DIGITS} digits` }
  }
  for (const r of code.rules) {
    if (!r || !/^[a-z][a-z0-9_]{0,23}$/.test(r.name ?? '')) return { ok: false, reason: 'bad rule name' }
    if (names.has(r.name)) return { ok: false, reason: `duplicate rule "${r.name}"` }
    names.add(r.name)
    if (!Array.isArray(r.then) || r.then.length === 0) return { ok: false, reason: `rule "${r.name}" does nothing` }
    if (r.then.length > MAX_ACTIONS) return { ok: false, reason: `rule "${r.name}": at most ${MAX_ACTIONS} actions` }
    const g = checkExpr(r.when, vars, 0, { nodes: MAX_NODES })
    if (!g.ok) return { ok: false, reason: `rule "${r.name}" guard: ${g.reason}` }
    for (const a of r.then) {
      if ('pay' in a) {
        const to = a.pay.to
        if (typeof to === 'object' && 'living' in to) {
          if (to.living !== 'owner' && to.living !== 'caller') return { ok: false, reason: 'living payment must name the owner or the caller' }
        } else if (typeof to === 'object' && 'seat' in to) {
          const s = checkExpr(to.seat, vars, 0, { nodes: MAX_NODES })
          if (!s.ok) return { ok: false, reason: `payment seat: ${s.reason}` }
        } else if (typeof to === 'object' && 'addr' in to) { if (!ADDR_RE.test(to.addr)) return { ok: false, reason: 'bad payment address' } }
        else { const t = checkExpr(to as Expr, vars, 0, { nodes: MAX_NODES }); if (!t.ok) return { ok: false, reason: `payment target: ${t.reason}` } }
        const amt = checkExpr(a.pay.amount, vars, 0, { nodes: MAX_NODES })
        if (!amt.ok) return { ok: false, reason: `payment amount: ${amt.reason}` }
      } else if ('take' in a) {
        const amt = checkExpr(a.take.amount, vars, 0, { nodes: MAX_NODES })
        if (!amt.ok) return { ok: false, reason: `take amount: ${amt.reason}` }
      } else if ('bind' in a) {
        const at = checkExpr(a.bind.at, vars, 0, { nodes: MAX_NODES })
        if (!at.ok) return { ok: false, reason: `bind seat: ${at.reason}` }
      } else if ('set' in a) {
        if (!vars.has(a.set.var)) return { ok: false, reason: `rule "${r.name}" sets undeclared variable "${a.set.var}"` }
        const e = checkExpr(a.set.to, vars, 0, { nodes: MAX_NODES })
        if (!e.ok) return { ok: false, reason: `set ${a.set.var}: ${e.reason}` }
      } else if ('require' in a) {
        const e = checkExpr(a.require, vars, 0, { nodes: MAX_NODES })
        if (!e.ok) return { ok: false, reason: `require: ${e.reason}` }
      } else return { ok: false, reason: 'unknown action' }
    }
  }
  if (code.genesis !== undefined) {
    if (!Array.isArray(code.genesis)) return { ok: false, reason: 'genesis must be a list' }
    if (code.vars?.luz !== '1') return { ok: false, reason: 'genesis is a Luz table — this paper is not KRC-77' }
    if (String(code.vars?.capped) !== '1') return { ok: false, reason: 'infinite Luz has no genesis table' }
    if (code.genesis.length === 0) return { ok: false, reason: 'empty genesis is absence — omit the field' }
    if (code.genesis.length > 8) return { ok: false, reason: 'at most 8 founders' }
    const supply = code.vars?.supply
    if (!supply || !/^[1-9]\d*$/.test(supply)) return { ok: false, reason: 'a genesis table needs a capped supply' }
    const cap = BigInt(supply)
    const seen = new Set<string>()
    let sum = 0n
    for (const row of code.genesis) {
      if (!row || typeof row !== 'object') return { ok: false, reason: 'a founder row needs to + amount' }
      const to = String(row.to ?? '').trim()
      const amount = String(row.amount ?? '').trim()
      if (!ADDR_RE.test(to)) return { ok: false, reason: 'a founder needs a sealed address' }
      if (to.startsWith('KRAY_') || isContractPotAddress(to)) return { ok: false, reason: 'a founder cannot be a protocol pot' }
      if (!/^[1-9]\d*$/.test(amount)) return { ok: false, reason: 'a founder amount must be a whole number greater than 0' }
      if (litDigits(amount) > MAX_LIT_DIGITS) return { ok: false, reason: 'a founder amount is too wide' }
      if (seen.has(to)) return { ok: false, reason: `duplicate founder ${to}` }
      seen.add(to)
      sum += BigInt(amount)
      if (sum > cap) return { ok: false, reason: 'founders take more than supply' }
    }
  }
  if (code.poll !== undefined || code.vars?.poll === '1') {
    if (code.vars?.poll !== '1') return { ok: false, reason: 'poll labels need the sealed poll paper' }
    if (code.genesis !== undefined) return { ok: false, reason: 'a poll is not a Luz table' }
    if (!code.poll || !Array.isArray(code.poll.choices)) return { ok: false, reason: 'a poll needs sealed choices' }
    if (code.poll.choices.length < 2) return { ok: false, reason: 'a poll needs at least two choices' }
    if (code.poll.choices.length > 8) return { ok: false, reason: 'at most 8 poll choices' }
    if (code.poll.title !== undefined && String(code.poll.title).trim() === '') {
      return { ok: false, reason: 'empty poll title is absence — omit the field' }
    }
    if (code.poll.title != null) {
      const title = String(code.poll.title).trim()
      if (title.length > 80) return { ok: false, reason: 'poll title is too long' }
      if (/[\x00-\x1f<>]/.test(title)) return { ok: false, reason: 'poll title has a forbidden character' }
    }
    const seen = new Set<string>()
    for (const raw of code.poll.choices) {
      const label = String(raw ?? '').trim()
      if (!label) return { ok: false, reason: 'a poll choice is empty' }
      if (label.length > 48) return { ok: false, reason: 'a poll choice is too long' }
      if (/[\x00-\x1f<>]/.test(label)) return { ok: false, reason: 'a poll choice has a forbidden character' }
      if (seen.has(label)) return { ok: false, reason: `duplicate poll choice "${label}"` }
      seen.add(label)
    }
  }
  const bytes = canonicalCode(code).length
  if (bytes > MAX_CODE_BYTES) return { ok: false, reason: `contract code is ${bytes} bytes — at most ${MAX_CODE_BYTES}` }
  return { ok: true }
}

const ARITY: Record<OpName, number | 'any'> = {
  add: 'any', sub: 2, mul: 'any', div: 2, mod: 2, min: 'any', max: 'any', isqrt: 1, neg: 1,
  eq: 2, ne: 2, lt: 2, le: 2, gt: 2, ge: 2,
  and: 'any', or: 'any', not: 1, if: 3,
}

function checkExpr(e: Expr, vars: Set<string>, depth: number, budget: { nodes: number }): { ok: boolean; reason?: string } {
  if (depth > MAX_DEPTH) return { ok: false, reason: `nested deeper than ${MAX_DEPTH}` }
  if (!e || typeof e !== 'object') return { ok: false, reason: 'not an expression' }
  if (--budget.nodes < 0) return { ok: false, reason: `expression has more than ${MAX_NODES} nodes` }
  if ('lit' in e) {
    if (!/^-?\d+$/.test(e.lit)) return { ok: false, reason: 'a literal must be a whole number' }
    if (litDigits(e.lit) > MAX_LIT_DIGITS) return { ok: false, reason: `a literal may have at most ${MAX_LIT_DIGITS} digits` }
    return { ok: true }
  }
  if ('var' in e) return vars.has(e.var) ? { ok: true } : { ok: false, reason: `unknown variable "${e.var}"` }
  if ('arg' in e) return /^[a-z][a-z0-9_]{0,23}$/.test(e.arg) ? { ok: true } : { ok: false, reason: 'bad argument name' }
  if ('ctx' in e) return ['caller', 'height', 'interval', 'at', 'beacon', 'balance', 'star', 'holder', 'glow'].includes(e.ctx) ? { ok: true } : { ok: false, reason: `unknown context "${e.ctx}"` }
  if ('op' in e) {
    const arity = ARITY[e.op]
    if (arity === undefined) return { ok: false, reason: `unknown operation "${e.op}"` }
    if (!Array.isArray(e.args) || e.args.length === 0) return { ok: false, reason: `"${e.op}" needs arguments` }
    if (arity !== 'any' && e.args.length !== arity) return { ok: false, reason: `"${e.op}" takes ${arity} arguments` }
    for (const a of e.args) { const r = checkExpr(a, vars, depth + 1, budget); if (!r.ok) return r }
    return { ok: true }
  }
  return { ok: false, reason: 'not an expression' }
}

/** Thrown inside evaluation; every one becomes a NAMED refusal, never a crash. */
class Refuse extends Error {}

function assertLitWidth(n: bigint, what: string): void {
  if (litDigits(n.toString()) > MAX_LIT_DIGITS) throw new Refuse(`${what} exceeds ${MAX_LIT_DIGITS} digits`)
}

/**
 * EVALUATE ONE EXPRESSION. Integers in, one integer out. Booleans are 1 and 0,
 * so there is one type and no coercion surprises. Division or modulo by zero
 * REFUSES rather than producing anything — a contract that divides by zero has a
 * bug, and a bug must stop, not improvise.
 */
function evalExpr(e: Expr, ctx: CallContext, state: Record<string, bigint>, budget: { nodes: number }, depth = 0): bigint {
  if (--budget.nodes < 0) throw new Refuse(`the call exceeded its ${MAX_NODES}-node budget`)
  if (depth > MAX_DEPTH) throw new Refuse('expression nested too deep')
  if ('lit' in e) return BigInt(e.lit)
  if ('var' in e) { const v = state[e.var]; if (v === undefined) throw new Refuse(`unknown variable "${e.var}"`); return v }
  if ('arg' in e) { const v = ctx.args[e.arg]; if (v === undefined) throw new Refuse(`the call is missing argument "${e.arg}"`); return v }
  if ('ctx' in e) {
    switch (e.ctx) {
      case 'caller': return ctx.addressToInt(ctx.caller)
      case 'height': return ctx.height
      case 'interval': return ctx.interval
      case 'at': return ctx.at
      case 'beacon': return ctx.beacon
      case 'balance': return ctx.balance
      case 'star': return ctx.star ?? 0n
      case 'holder': return ctx.holder ?? 0n
      case 'glow': return ctx.glow ?? 0n
    }
  }
  const a = (i: number): bigint => evalExpr(e.op ? (e as { args: Expr[] }).args[i] : e, ctx, state, budget, depth + 1)
  const all = (): bigint[] => (e as { args: Expr[] }).args.map((x) => evalExpr(x, ctx, state, budget, depth + 1))
  switch ((e as { op: OpName }).op) {
    case 'add': return all().reduce((x, y) => x + y, 0n)
    case 'mul': return all().reduce((x, y) => x * y, 1n)
    case 'sub': return a(0) - a(1)
    case 'div': { const d = a(1); if (d === 0n) throw new Refuse('division by zero'); return a(0) / d }
    case 'mod': { const d = a(1); if (d === 0n) throw new Refuse('modulo by zero'); return a(0) % d }
    case 'min': return all().reduce((x, y) => (y < x ? y : x))
    case 'max': return all().reduce((x, y) => (y > x ? y : x))
    case 'isqrt': {
      const v = a(0)
      if (v < 0n) throw new Refuse('the square root of a negative number')
      if (ctx.digitLaw) assertLitWidth(v, 'isqrt')
      return isqrt(v)
    }
    case 'neg': return -a(0)
    case 'eq': return a(0) === a(1) ? 1n : 0n
    case 'ne': return a(0) !== a(1) ? 1n : 0n
    case 'lt': return a(0) < a(1) ? 1n : 0n
    case 'le': return a(0) <= a(1) ? 1n : 0n
    case 'gt': return a(0) > a(1) ? 1n : 0n
    case 'ge': return a(0) >= a(1) ? 1n : 0n
    case 'and': return all().every((x) => x !== 0n) ? 1n : 0n
    case 'or': return all().some((x) => x !== 0n) ? 1n : 0n
    case 'not': return a(0) === 0n ? 1n : 0n
    case 'if': return a(0) !== 0n ? a(1) : a(2)
    default: throw new Refuse('unknown operation')
  }
}

/**
 * RUN ONE CALL — the whole execution model, and it fits in a page.
 *
 * The guard is evaluated; false means refused and NOTHING happens. Otherwise the
 * actions run in order against a COPY of the state, so a `require` that fails
 * halfway leaves no partial write. Payments are collected but not applied here:
 * the ledger applies them, through the primitives that already keep ₭ conserved
 * (emitted − burned), and
 * refuses the whole call if the contract cannot afford them. A contract can lose
 * what it holds; it can never create a unit or spend another account's.
 */
export function runCall(code: ContractCode, ruleName: string, ctx: CallContext, state: Record<string, bigint>): CallResult {
  const budget = { nodes: MAX_NODES }
  const rule = code.rules.find((r) => r.name === ruleName)
  if (!rule) return { ok: false, vars: {}, payments: [], take: 0n, binds: [], nodes: 0, reason: `no rule "${ruleName}"` }
  const next = { ...state }
  const payments: Payment[] = []
  const binds: SeatBind[] = []
  let take = 0n
  try {
    if (evalExpr(rule.when, ctx, next, budget) === 0n) {
      return { ok: false, vars: {}, payments: [], take: 0n, binds: [], nodes: MAX_NODES - budget.nodes, reason: `the guard of "${ruleName}" is false` }
    }
    let spent = 0n
    for (const action of rule.then) {
      if ('require' in action) {
        if (evalExpr(action.require, ctx, next, budget) === 0n) throw new Refuse('a require failed — the whole call is refused')
      } else if ('set' in action) {
        const nextVal = evalExpr(action.set.to, ctx, next, budget)
        if (ctx.digitLaw) assertLitWidth(nextVal, 'set')
        next[action.set.var] = nextVal
      } else if ('take' in action) {
        const amount = evalExpr(action.take.amount, ctx, next, budget)
        if (amount < 0n) throw new Refuse('a take cannot be negative')
        take += amount
      } else if ('bind' in action) {
        const at = evalExpr(action.bind.at, ctx, next, budget)
        if (at < 0n) throw new Refuse('a seat cannot be negative')
        if (!ctx.caller) throw new Refuse('bind needs a caller')
        binds.push({ at, addr: ctx.caller })
      } else {
        const amount = evalExpr(action.pay.amount, ctx, next, budget)
        if (amount < 0n) throw new Refuse('a payment cannot be negative')
        if (amount === 0n) continue // paying nothing is not an error, it is nothing
        spent += amount
        // take is incoming in this same call — the pot may pay what the caller just funded
        if (spent > ctx.balance + take) throw new Refuse(`the contract holds ${ctx.balance} plus take ${take} and the call would pay ${spent}`)
        const to = action.pay.to
        let addr: string | null = null
        let seat: bigint | undefined
        if (typeof to === 'object' && 'living' in to) {
          if (to.living === 'owner') {
            if (!ctx.holderAddress) throw new Refuse('collect pays the living owner — no holder on this call')
            addr = ctx.holderAddress
          } else if (to.living === 'caller') {
            if (!ctx.caller) throw new Refuse('claim pays the caller — no caller on this call')
            addr = ctx.caller
          } else throw new Refuse('living payment must name the owner or the caller')
        } else if (typeof to === 'object' && 'seat' in to) {
          seat = evalExpr(to.seat, ctx, next, budget)
          if (seat < 0n) throw new Refuse('a seat cannot be negative')
          addr = ''
        } else if (typeof to === 'object' && 'addr' in to) {
          addr = to.addr
        }
        if (addr === null) throw new Refuse('a payment target must be a literal address, the living owner, the caller, or a seat')
        payments.push(seat !== undefined ? { to: addr, amount, seat } : { to: addr, amount })
      }
    }
  } catch (err) {
    const reason = err instanceof Refuse ? err.message : 'the call failed'
    return { ok: false, vars: {}, payments: [], take: 0n, binds: [], nodes: MAX_NODES - budget.nodes, reason }
  }
  // only the variables that actually changed — a diff, so the journal stays small
  const changed: Record<string, bigint> = {}
  for (const [k, v] of Object.entries(next)) if (state[k] !== v) changed[k] = v
  return { ok: true, vars: changed, payments, take, binds, nodes: MAX_NODES - budget.nodes }
}

/** Derived pot address — no key encodes to it. Replay-identical from (code, creator, seq). */
export function contractAddress(codeHash: string, from: string, seq: number): string {
  return 'KRAY_CONTRACT_' + createHash('sha256').update(`${codeHash}|${from}|${seq}`, 'utf8').digest('hex').slice(0, 40)
}

/** A law pot is a protocol label. The IR pays only ₭ — runes that land here stick. */
export function isContractPotAddress(addr: string): boolean {
  return typeof addr === 'string' && addr.startsWith('KRAY_CONTRACT_')
}
