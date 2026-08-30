/**
 * SEALED FORMS — escrow, tunnel, vest, scroll, raffle, mint, cut. Same total IR as living law.
 *
 * Not a second VM. A catalog of beings that compile to contract.ts.
 * Hang on a star (v2, burn 1 ₭) or stand alone (v1, frozen, no burn).
 *
 * Living-mouth tools (toggle_*, collect, stamp, draw, skip) stay with ownerOf(N).
 * Form doors follow the IR: the sealed buyer accepts; anyone may refund
 * after the journal deadline; vest `release` pays the beneficiary;
 * scroll `claim` pays the living caller; raffle `enter` / `settle` are public;
 * mint `mint` is not a call — the reducer runs it as the blessing on an inscribe
 * (take price → pay the sealed dest or living owner → taken++).
 */
import { callerInt } from './star-law.ts'
import { validateContract, type ContractCode, type Expr } from './contract.ts'

const ADDR_RE = /^[a-z0-9]{8,90}$/i
const WHOLE = /^(0|[1-9]\d*)$/

export type FormKind = 'escrow' | 'tunnel' | 'vest' | 'scroll' | 'raffle' | 'mint' | 'cut' | 'luz'

/** Seats in one raffle window — the IR has no list type; each face is a bind. */
export const MAX_RAFFLE_SEATS = 8
/** Default draw: every 100 Bitcoin seals on this journal (ctx.interval). */
export const DEFAULT_RAFFLE_PERIOD = 100
/** One drop — editions on one face. Hard cap so a mint cannot be an unbounded loop. */
export const MAX_MINT_EDITION = 256
/** KRC-77 Cut — max sealed supply (same ceiling as the old L2 share token). 0 + uncapped = infinite. */
export const MAX_CUT_SUPPLY = 10_000_000
/** MasterChef scale — integer only. Hidden; the desk does not let a user pick it. */
export const CUT_PRECISION = '1000000000000'
/** Art URL the desk pulls at the mint act. NOT IR (vars are integers) and NOT journaled — the reducer refuses
 *  `e.shelf` (ledger.ts: "an art URL does not ride the journal — a stranger would steal the file"); it is a
 *  writer's-desk field kept off consensus (SSRF-guarded parse below). Bound only so the desk cannot store junk. */
export const MAX_MINT_SHELF = 512
export type ScrollGate = 'open' | 'stamp' | 'list'

export const MAX_SCROLL_ALLOW = 8

export type ContractForm =
  | { kind: 'escrow'; buyer: string; seller: string; deadline: string }
  | { kind: 'tunnel'; dest?: string }
  | { kind: 'vest'; beneficiary: string; start: string; duration: string; total: string }
  | { kind: 'scroll'; each: string; max: string; locked?: boolean; gate?: ScrollGate; allow?: string[] }
  | { kind: 'raffle'; price: string; period?: string; seats?: string }
  | { kind: 'mint'; price: string; max: string; payTo?: string }
  | { kind: 'cut'; supply?: string; infinite?: boolean }
  | { kind: 'luz'; supply?: string; infinite?: boolean }

function addr(a: string, name: string): string {
  const s = String(a || '').trim()
  if (!ADDR_RE.test(s)) throw new Error(`form: ${name} must be a sealed address`)
  return s
}
function whole(v: string, name: string): string {
  const s = String(v ?? '').trim()
  if (!WHOLE.test(s)) throw new Error(`form: ${name} must be a whole number`)
  return s
}
function finish(code: ContractCode): ContractCode {
  const v = validateContract(code)
  if (!v.ok) throw new Error(`form: compiled IR is not valid (${v.reason})`)
  return code
}

const callerIs = (id: Expr): Expr => ({ op: 'eq', args: [{ ctx: 'caller' }, id] })
const callerIsHolder: Expr = { op: 'eq', args: [{ ctx: 'caller' }, { ctx: 'holder' }] }

export function compileEscrow(input: { buyer: string; seller: string; deadline: string }): ContractCode {
  const buyer = addr(input.buyer, 'buyer')
  const seller = addr(input.seller, 'seller')
  if (buyer === seller) throw new Error('form: escrow buyer and seller must differ')
  const deadline = whole(input.deadline, 'deadline')
  return finish({
    vars: {
      buyer: callerInt(buyer),
      seller: callerInt(seller),
      deadline,
      settled: '0',
    },
    rules: [
      {
        name: 'accept',
        when: { op: 'and', args: [callerIs({ var: 'buyer' }), { op: 'eq', args: [{ var: 'settled' }, { lit: '0' }] }] },
        then: [
          { set: { var: 'settled', to: { lit: '1' } } },
          { pay: { to: { addr: seller }, amount: { ctx: 'balance' } } },
        ],
      },
      {
        name: 'refund',
        when: {
          op: 'and',
          args: [
            { op: 'gt', args: [{ ctx: 'height' }, { var: 'deadline' }] },
            { op: 'eq', args: [{ var: 'settled' }, { lit: '0' }] },
          ],
        },
        then: [
          { set: { var: 'settled', to: { lit: '1' } } },
          { pay: { to: { addr: buyer }, amount: { ctx: 'balance' } } },
        ],
      },
    ],
  })
}

/**
 * A pipe. Anyone may fund it (transfer). The living owner opens/closes the tap.
 * Punch sends `amount` to the sealed dest, or to the living owner if dest is absent
 * (the corridor follows the face).
 */
export function compileTunnel(input: { dest?: string } = {}): ContractCode {
  const dest = input.dest != null && input.dest !== '' ? addr(input.dest, 'dest') : ''
  const payTo = dest ? { addr: dest } : { living: 'owner' as const }
  return finish({
    vars: { open: '1' },
    rules: [
      {
        name: 'toggle_open',
        when: callerIsHolder,
        then: [{
          set: {
            var: 'open',
            to: {
              op: 'if',
              args: [
                { op: 'eq', args: [{ var: 'open' }, { lit: '1' }] },
                { lit: '0' },
                { lit: '1' },
              ],
            },
          },
        }],
      },
      {
        name: 'punch',
        when: {
          op: 'and',
          args: [
            callerIsHolder,
            { op: 'eq', args: [{ var: 'open' }, { lit: '1' }] },
            { op: 'gt', args: [{ arg: 'amount' }, { lit: '0' }] },
            { op: 'ge', args: [{ ctx: 'balance' }, { arg: 'amount' }] },
          ],
        },
        then: [{ pay: { to: payTo, amount: { arg: 'amount' } } }],
      },
    ],
  })
}

/** Vesting — journal height (seq), not wall clock. Pays only the beneficiary. */
export function compileVest(input: { beneficiary: string; start: string; duration: string; total: string }): ContractCode {
  const beneficiary = addr(input.beneficiary, 'beneficiary')
  const start = whole(input.start, 'start')
  const duration = whole(input.duration, 'duration')
  const total = whole(input.total, 'total')
  if (duration === '0') throw new Error('form: vest duration must be greater than 0')
  if (total === '0') throw new Error('form: vest total must be greater than 0')
  const elapsed: Expr = { op: 'sub', args: [{ ctx: 'height' }, { var: 'start' }] }
  const capped: Expr = { op: 'min', args: [elapsed, { var: 'duration' }] }
  const vested: Expr = { op: 'div', args: [{ op: 'mul', args: [{ var: 'total' }, capped] }, { var: 'duration' }] }
  const due: Expr = { op: 'sub', args: [vested, { var: 'released' }] }
  const payAmt: Expr = { op: 'min', args: [due, { ctx: 'balance' }] }
  return finish({
    vars: { released: '0', total, start, duration },
    rules: [{
      name: 'release',
      when: { op: 'and', args: [{ op: 'gt', args: [due, { lit: '0' }] }, { op: 'gt', args: [{ ctx: 'balance' }, { lit: '0' }] }] },
      then: [
        { pay: { to: { addr: beneficiary }, amount: payAmt } },
        // credit only what left — an underfunded pot must not burn the remainder of the schedule
        { set: { var: 'released', to: { op: 'add', args: [{ var: 'released' }, payAmt] } } },
      ],
    }],
  })
}

/**
 * SCROLL — the Dev Scroll, proven. A pot with mathematical exit clauses.
 *
 * Space's scroll_key is a secret the game server holds. Here there is no secret:
 *   open  — anyone claims `each` until `max` (the 1 ₭ fee is the sybil tax)
 *   stamp — the living owner writes a callerInt ticket; that person claims once
 *   list  — sealed addresses, one claim each
 * locked — no collect (is_contract): ₭ leaves only through claim.
 *
 * The quest itself stays in the vacuum (A7). The journal only sees the claim.
 */
export function compileScroll(input: {
  each: string; max: string; locked?: boolean; gate?: ScrollGate; allow?: string[]
}): ContractCode {
  const each = whole(input.each, 'each')
  if (each === '0') throw new Error('form: scroll each must be greater than 0')
  const gate: ScrollGate = input.gate ?? 'open'
  const locked = !!input.locked
  const openOn: Expr = { op: 'eq', args: [{ var: 'open' }, { lit: '1' }] }
  const canPay: Expr = { op: 'ge', args: [{ ctx: 'balance' }, { var: 'each' }] }
  const payCaller = { pay: { to: { living: 'caller' as const }, amount: { var: 'each' } } }
  const toggleOpen = {
    name: 'toggle_open',
    when: callerIsHolder,
    then: [{
      set: {
        var: 'open',
        to: {
          op: 'if',
          args: [
            { op: 'eq', args: [{ var: 'open' }, { lit: '1' }] },
            { lit: '0' },
            { lit: '1' },
          ],
        },
      },
    }],
  }
  const collect = {
    name: 'collect',
    when: { op: 'and', args: [callerIsHolder, { op: 'gt', args: [{ ctx: 'balance' }, { lit: '0' }] }] },
    then: [{ pay: { to: { living: 'owner' as const }, amount: { ctx: 'balance' } } }],
  }

  if (gate === 'list') {
    const allow = Array.isArray(input.allow) ? input.allow : []
    if (allow.length === 0) throw new Error('form: list scroll needs at least one address')
    if (allow.length > MAX_SCROLL_ALLOW) throw new Error(`form: at most ${MAX_SCROLL_ALLOW} allowlisted addresses`)
    if (input.max != null && String(input.max).trim() !== '') {
      const listed = whole(input.max, 'max')
      if (listed !== String(allow.length)) throw new Error('form: list scroll max must equal the allow list length')
    }
    const vars: Record<string, string> = { each, open: '1' }
    const rules: ContractCode['rules'] = [toggleOpen]
    const seen = new Set<string>()
    allow.forEach((raw, i) => {
      const a = addr(raw, `allow[${i}]`)
      if (seen.has(a)) throw new Error(`form: duplicate allow address ${a}`)
      seen.add(a)
      vars[`w${i}`] = callerInt(a)
      vars[`c${i}`] = '0'
      rules.push({
        name: `claim_${i}`,
        when: {
          op: 'and',
          args: [
            openOn,
            canPay,
            callerIs({ var: `w${i}` }),
            { op: 'eq', args: [{ var: `c${i}` }, { lit: '0' }] },
          ],
        },
        then: [{ set: { var: `c${i}`, to: { lit: '1' } } }, payCaller],
      })
    })
    if (!locked) rules.push(collect)
    return finish({ vars, rules })
  }

  const max = whole(input.max, 'max')
  if (max === '0') throw new Error('form: scroll max must be greater than 0')
  const room: Expr = { op: 'lt', args: [{ var: 'taken' }, { var: 'max' }] }
  if (gate === 'stamp') {
    const vars = { each, max, taken: '0', open: '1', ticket: '0' }
    const rules: ContractCode['rules'] = [
      toggleOpen,
      {
        name: 'stamp',
        when: callerIsHolder,
        then: [{ set: { var: 'ticket', to: { arg: 'id' } } }],
      },
      {
        name: 'claim',
        when: {
          op: 'and',
          args: [
            openOn, canPay, room,
            { op: 'ne', args: [{ var: 'ticket' }, { lit: '0' }] },
            { op: 'eq', args: [{ ctx: 'caller' }, { var: 'ticket' }] },
          ],
        },
        then: [
          payCaller,
          { set: { var: 'ticket', to: { lit: '0' } } },
          { set: { var: 'taken', to: { op: 'add', args: [{ var: 'taken' }, { lit: '1' }] } } },
        ],
      },
    ]
    if (!locked) rules.push(collect)
    return finish({ vars, rules })
  }

  if (gate !== 'open') throw new Error(`form: unknown scroll gate "${gate}"`)
  const vars = { each, max, taken: '0', open: '1' }
  const rules: ContractCode['rules'] = [
    toggleOpen,
    {
      name: 'claim',
      when: { op: 'and', args: [openOn, canPay, room] },
      then: [
        payCaller,
        { set: { var: 'taken', to: { op: 'add', args: [{ var: 'taken' }, { lit: '1' }] } } },
      ],
    },
  ]
  if (!locked) rules.push(collect)
  return finish({ vars, rules })
}

/**
 * RAFFLE — a looping pot. People buy a seat (public `enter`). After `period`
 * Bitcoin seals the window is due. Two mouths can close it:
 *
 *   · `draw`  — living owner. Full pot to beacon % taken. Owner pays the 1 ₭ fee.
 *   · `settle` — anyone. The signer verifies and signs; the pot pays them 1 ₭
 *     (the fee, economically) and the rest to the named seat.
 *
 * Fewer than two tickets is not a raffle: pot + roster stay. `enter` stays
 * open on an overdue thin field (otherwise the desk freezes until a 1 ₭ roll).
 * A late first ticket restarts `due`; a late second keeps `due` in the past
 * so `settle` can fire on the same seal. `settle` / `skip` also roll the clock.
 * Winner is mathematics. No collect. Needs a v2 call so the seal is the clock.
 */
export function compileRaffle(input: { price: string; period?: string; seats?: string }): ContractCode {
  const price = whole(input.price, 'price')
  if (price === '0') throw new Error('form: raffle price must be greater than 0')
  const period = input.period != null && String(input.period).trim() !== ''
    ? whole(input.period, 'period')
    : String(DEFAULT_RAFFLE_PERIOD)
  if (period === '0') throw new Error('form: raffle period must be greater than 0')
  const seatsRaw = input.seats != null && String(input.seats).trim() !== ''
    ? whole(input.seats, 'seats')
    : String(MAX_RAFFLE_SEATS)
  const seats = Number(seatsRaw)
  if (!Number.isInteger(seats) || seats < 2 || seats > MAX_RAFFLE_SEATS) {
    throw new Error(`form: raffle seats must be 2–${MAX_RAFFLE_SEATS}`)
  }
  const openOn: Expr = { op: 'eq', args: [{ var: 'open' }, { lit: '1' }] }
  const inWindow: Expr = { op: 'or', args: [
    { op: 'eq', args: [{ var: 'due' }, { lit: '0' }] },
    { op: 'lt', args: [{ ctx: 'interval' }, { var: 'due' }] },
  ] }
  const dueNow: Expr = { op: 'and', args: [
    { op: 'ne', args: [{ var: 'due' }, { lit: '0' }] },
    { op: 'ge', args: [{ ctx: 'interval' }, { var: 'due' }] },
  ] }
  // overdue + 0–1 tickets: still gathering. 2+ tickets overdue: field is closed, settle/draw only.
  const gathering: Expr = { op: 'and', args: [
    dueNow,
    { op: 'lt', args: [{ var: 'taken' }, { lit: '2' }] },
  ] }
  const mayEnter: Expr = { op: 'or', args: [inWindow, gathering] }
  const room: Expr = { op: 'lt', args: [{ var: 'taken' }, { var: 'seats' }] }
  const winnerSeat: Expr = { op: 'mod', args: [{ ctx: 'beacon' }, { var: 'taken' }] }
  const prizeReady: Expr = { op: 'and', args: [
    { op: 'ge', args: [{ var: 'taken' }, { lit: '2' }] },
    { op: 'ge', args: [{ ctx: 'balance' }, { lit: '2' }] },
  ] }
  const nextDue: Expr = { op: 'add', args: [{ ctx: 'interval' }, { var: 'period' }] }
  const restartDue: Expr = { op: 'or', args: [
    { op: 'eq', args: [{ var: 'due' }, { lit: '0' }] },
    { op: 'and', args: [dueNow, { op: 'lt', args: [{ var: 'taken' }, { lit: '2' }] }] },
  ] }
  return finish({
    vars: { price, period, seats: String(seats), taken: '0', due: '0', open: '1' },
    rules: [
      {
        name: 'toggle_open',
        when: callerIsHolder,
        then: [{
          set: {
            var: 'open',
            to: {
              op: 'if',
              args: [
                { op: 'eq', args: [{ var: 'open' }, { lit: '1' }] },
                { lit: '0' },
                { lit: '1' },
              ],
            },
          },
        }],
      },
      {
        name: 'enter',
        when: { op: 'and', args: [openOn, mayEnter, room] },
        then: [
          { take: { amount: { var: 'price' } } },
          { bind: { at: { var: 'taken' } } },
          { set: { var: 'taken', to: { op: 'add', args: [{ var: 'taken' }, { lit: '1' }] } } },
          {
            set: {
              var: 'due',
              to: {
                op: 'if',
                args: [restartDue, nextDue, { var: 'due' }],
              },
            },
          },
        ],
      },
      {
        name: 'settle',
        when: dueNow,
        then: [
          { pay: { to: { living: 'caller' }, amount: { op: 'if', args: [prizeReady, { lit: '1' }, { lit: '0' }] } } },
          { pay: { to: { seat: winnerSeat }, amount: { op: 'if', args: [prizeReady, { op: 'sub', args: [{ ctx: 'balance' }, { lit: '1' }] }, { lit: '0' }] } } },
          { set: { var: 'taken', to: { op: 'if', args: [prizeReady, { lit: '0' }, { var: 'taken' }] } } },
          { set: { var: 'due', to: nextDue } },
        ],
      },
      {
        name: 'draw',
        when: { op: 'and', args: [
          callerIsHolder,
          dueNow,
          prizeReady,
        ] },
        then: [
          { pay: { to: { seat: winnerSeat }, amount: { ctx: 'balance' } } },
          { set: { var: 'taken', to: { lit: '0' } } },
          { set: { var: 'due', to: nextDue } },
        ],
      },
      {
        name: 'skip',
        when: { op: 'and', args: [callerIsHolder, dueNow, { op: 'le', args: [{ var: 'taken' }, { lit: '1' }] }] },
        then: [{ set: { var: 'due', to: nextDue } }],
      },
    ],
  })
}

/**
 * MINT — one drop on this face. People inscribe a child with this star as parent.
 * The reducer runs rule `mint` as the blessing: take the service price, pay it
 * now to `payTo` (or the living owner), taken++. You do not need to own the face.
 * When taken == max the blessing dies. Not a contract-call — the birth IS the mint.
 * Collect remains the mouth for leftover pot (gifts), not the mint price.
 */
export function compileMint(input: { price: string; max: string; payTo?: string }): ContractCode {
  const price = whole(input.price, 'price')
  const max = whole(input.max, 'max')
  if (max === '0') throw new Error('form: mint max must be greater than 0')
  const n = Number(max)
  if (!Number.isInteger(n) || n > MAX_MINT_EDITION) {
    throw new Error(`form: mint max is at most ${MAX_MINT_EDITION} editions`)
  }
  const dest = input.payTo != null && input.payTo !== '' ? addr(input.payTo, 'payTo') : ''
  const payTo = dest ? { addr: dest } : { living: 'owner' as const }
  const openOn: Expr = { op: 'eq', args: [{ var: 'open' }, { lit: '1' }] }
  const room: Expr = { op: 'lt', args: [{ var: 'taken' }, { var: 'max' }] }
  return finish({
    vars: { price, max, taken: '0', open: '1' },
    rules: [
      {
        name: 'toggle_open',
        when: callerIsHolder,
        then: [{
          set: {
            var: 'open',
            to: {
              op: 'if',
              args: [
                { op: 'eq', args: [{ var: 'open' }, { lit: '1' }] },
                { lit: '0' },
                { lit: '1' },
              ],
            },
          },
        }],
      },
      {
        name: 'mint',
        when: { op: 'and', args: [openOn, room] },
        then: [
          { take: { amount: { var: 'price' } } },
          { pay: { to: payTo, amount: { var: 'price' } } },
          { set: { var: 'taken', to: { op: 'add', args: [{ var: 'taken' }, { lit: '1' }] } } },
        ],
      },
      {
        name: 'collect',
        when: { op: 'and', args: [callerIsHolder, { op: 'gt', args: [{ ctx: 'balance' }, { lit: '0' }] }] },
        then: [{ pay: { to: { living: 'owner' as const }, amount: { ctx: 'balance' } } }],
      },
    ],
  })
}

export function isMintPaper(code: { rules?: { name: string }[] } | null | undefined): boolean {
  const names = (code?.rules || []).map((r) => r.name)
  return names.includes('mint') && !names.includes('enter')
}

/**
 * LUZ ✧ (K-7) — the objective token law on a star. The word is IN the bytes:
 * sealed var `luz=1`. A stranger reading the paper sees Luz. Not chrome.
 *
 * Ethereum's ERC-20 / Solana's SPL, smaller: this paper seals the supply
 * (a max, or infinite) and accepts ₭ into the pot. It does not store a
 * holder map (the IR has none) and it does not collect — the owner cannot
 * drain royalties. Harvest waits for the share book (`ctx.shares`).
 *
 *   capped=1, supply=N  — max N units (Radiola default 100000)
 *   capped=0, supply=0  — infinite (uncapped constitution)
 */
export function compileCut(input: { supply?: string; infinite?: boolean } = {}): ContractCode {
  const infinite = !!input.infinite
  let supply = '0'
  let capped = '0'
  if (!infinite) {
    const raw = input.supply != null && String(input.supply).trim() !== ''
      ? String(input.supply).trim()
      : '100000'
    supply = whole(raw, 'supply')
    if (supply === '0') throw new Error('form: cut supply must be greater than 0 (or pick infinite)')
    const n = Number(supply)
    if (!Number.isInteger(n) || n < 1 || n > MAX_CUT_SUPPLY) {
      throw new Error(`form: cut supply is at most ${MAX_CUT_SUPPLY}`)
    }
    capped = '1'
  }
  const bump: Expr = {
    op: 'if',
    args: [
      { op: 'eq', args: [{ var: 'capped' }, { lit: '1' }] },
      { op: 'div', args: [
        { op: 'mul', args: [{ arg: 'amount' }, { var: 'prec' }] },
        { var: 'supply' },
      ] },
      { lit: '0' },
    ],
  }
  // Sealed constitution — no toggle_*, no collect. Deposit is the public door.
  return finish({
    vars: { luz: '1', supply, capped, acc_rps: '0', deposited: '0', prec: CUT_PRECISION },
    rules: [
      {
        name: 'deposit',
        when: { op: 'gt', args: [{ arg: 'amount' }, { lit: '0' }] },
        then: [
          { take: { amount: { arg: 'amount' } } },
          { set: { var: 'deposited', to: { op: 'add', args: [{ var: 'deposited' }, { arg: 'amount' }] } } },
          { set: { var: 'acc_rps', to: { op: 'add', args: [{ var: 'acc_rps' }, bump] } } },
        ],
      },
    ],
  })
}

export function isCutPaper(code: { rules?: { name: string }[]; vars?: Record<string, string> } | null | undefined): boolean {
  const names = (code?.rules || []).map((r) => r.name)
  return code?.vars?.luz === '1'
    && names.includes('deposit') && !names.includes('mint') && !names.includes('enter')
    && code?.vars?.prec != null && code?.vars?.capped != null
}

/** Same paper. Mouth is Luz; compiler kind may still say cut. */
export const isLuzPaper = isCutPaper
export const compileLuz = compileCut

function assertPublicHost(host: string): void {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!h || h === 'localhost' || h === '0.0.0.0' || h.endsWith('.local') || h === 'metadata.google.internal') {
    throw new Error('form: art URL must be a public http(s) host')
  }
  if (h === '::1' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) {
    throw new Error('form: art URL must be a public http(s) host')
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) throw new Error('form: art URL must be a public http(s) host')
}

/** Artist's art source. `{n}` = taken (0-based next edition), `{i}` = taken+1. Not consensus. */
export function parseMintShelf(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) throw new Error('form: art URL is empty — paste a real https address (the grey hint in the box is not a value)')
  if (s.length > MAX_MINT_SHELF) throw new Error('form: art URL is too long')
  const probe = s.replace(/\{n\}/g, '0').replace(/\{i\}/g, '1')
  let u: URL
  try { u = new URL(probe) } catch { throw new Error('form: art URL must be http(s)') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('form: art URL must be http(s)')
  assertPublicHost(u.hostname)
  return s
}

export function optionalMintShelf(raw: unknown): string | undefined {
  if (raw == null || String(raw).trim() === '') return undefined
  return parseMintShelf(raw)
}

/**
 * A mint paper MUST name the artist's art. The buyer never uploads.
 * max > 1 needs {n} or {i}: every child is unique bytes (A5) — not eight copies of one file.
 */
export function requireMintShelf(raw: unknown, max: number): string {
  const src = parseMintShelf(raw)
  const n = Number(max)
  if (!Number.isInteger(n) || n < 1) throw new Error('form: mint max must be greater than 0')
  if (n > 1 && !src.includes('{n}') && !src.includes('{i}')) {
    throw new Error('form: more than one edition needs {n} or {i} in the art URL — each child must carry unique bytes')
  }
  return src
}

export function resolveMintShelf(shelf: string, taken: number): string {
  const src = parseMintShelf(shelf)
  const n = Number(taken)
  if (!Number.isInteger(n) || n < 0) throw new Error('form: taken must be a whole number')
  return src.replace(/\{n\}/g, String(n)).replace(/\{i\}/g, String(n + 1))
}

export function compileForm(form: ContractForm): ContractCode {
  if (!form || typeof form !== 'object' || !form.kind) throw new Error('form: kind is required')
  if (form.kind === 'escrow') return compileEscrow(form)
  if (form.kind === 'tunnel') return compileTunnel(form)
  if (form.kind === 'vest') return compileVest(form)
  if (form.kind === 'scroll') return compileScroll(form)
  if (form.kind === 'raffle') return compileRaffle(form)
  if (form.kind === 'mint') return compileMint(form)
  if (form.kind === 'cut' || form.kind === 'luz') return compileCut(form)
  throw new Error(`form: unknown kind "${(form as { kind: string }).kind}"`)
}

/** Owner tools — the mouth travels with the face. `stamp` / `draw` / `skip` are mouth. */
export function isLivingTool(rule: string): boolean {
  return rule === 'collect' || rule === 'stamp' || rule === 'draw' || rule === 'skip'
    || rule.startsWith('toggle_') || rule.startsWith('once_')
}
