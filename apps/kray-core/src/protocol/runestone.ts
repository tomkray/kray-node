/**
 * RUNESTONE — the Runes protocol, decoded from raw bytes, byte for byte.
 *
 * This is KRAY's OWN implementation of the official Runes specification
 * (docs.ordinals.com/runes/specification.html). It exists because a bridge that
 * asks an indexer "how many runes moved here?" has replaced mathematics with a
 * phone call: the answer cannot be re-derived by a replay in ten years, and
 * whoever runs the indexer decides what is true.
 *
 * Runes are UTXO-native — a balance lives in the UTXO set, written by
 * runestones in OP_RETURN — so the whole question IS decidable from bytes. This
 * module decides it, and refuses when the bytes do not decide.
 *
 * ── THE DISCIPLINE ──────────────────────────────────────────────────────────
 * · u128 is BigInt. No Number ever touches an amount; overflow is checked, not
 *   hoped for (a silent wrap is how you mint runes that do not exist).
 * · Every CENOTAPH condition in the specification is implemented as a refusal,
 *   because a cenotaph BURNS the input runes: reading one as an ordinary
 *   transfer would credit an L2 with money Bitcoin destroyed.
 * · Unrecognized ODD tags are ignored and unrecognized EVEN tags are a cenotaph
 *   — the parity rule is how Runes evolves without a hard fork, and we honour it
 *   exactly rather than "being helpful".
 * · Pure and total: no I/O, no clock, no network. Same bytes → same answer, on
 *   any machine, forever.
 */

// ── tags, exactly as the specification numbers them ─────────────────────────
export const TAG = {
  Body: 0n,
  Flags: 2n,
  Rune: 4n,
  Premine: 6n,
  Cap: 8n,
  Amount: 10n,
  HeightStart: 12n,
  HeightEnd: 14n,
  OffsetStart: 16n,
  OffsetEnd: 18n,
  Mint: 20n,
  Pointer: 22n,
  Cenotaph: 126n,
  Divisibility: 1n,
  Spacers: 3n,
  Symbol: 5n,
  Nop: 127n,
} as const

/** Flag bit positions inside the Flags bitmap (value = 1 << position). */
export const FLAG = { Etching: 0n, Terms: 1n, Turbo: 2n, Cenotaph: 127n } as const

/** Why a runestone was refused. Named, because a refusal nobody can explain is
 *  indistinguishable from a bug. */
export type Flaw =
  | 'edict-output' | 'edict-rune-id' | 'invalid-script' | 'opcode'
  | 'supply-overflow' | 'trailing-integers' | 'truncated-field'
  | 'unrecognized-even-tag' | 'unrecognized-flag' | 'varint'

export interface RuneId { block: bigint; tx: bigint }
export interface Edict { id: RuneId; amount: bigint; output: number }
export interface Terms {
  amount?: bigint; cap?: bigint
  heightStart?: bigint; heightEnd?: bigint
  offsetStart?: bigint; offsetEnd?: bigint
}
export interface Etching {
  divisibility?: number; premine?: bigint; rune?: bigint
  spacers?: number; symbol?: string; terms?: Terms; turbo: boolean
}
export interface Runestone {
  kind: 'runestone'
  edicts: Edict[]
  etching?: Etching
  mint?: RuneId
  pointer?: number
}
export interface Cenotaph {
  kind: 'cenotaph'
  flaws: Flaw[]
  etching?: bigint // the rune name that will exist with supply zero
  mint?: RuneId // a mint inside a cenotaph still counts against the cap, and burns
}
export type Artifact = Runestone | Cenotaph

const U128_MAX = (1n << 128n) - 1n
const U64_MAX = (1n << 64n) - 1n
const U32_MAX = (1n << 32n) - 1n

// ── LEB128 over u128 — the specification's own integer encoding ─────────────
/**
 * Decode one 128-bit LEB128 varint. Returns null on ANY malformation the
 * specification calls a cenotaph: more than 18 bytes, an overflow of u128, or
 * a truncated sequence (the buffer ends with the continuation bit still set).
 */
export function decodeVarint(buf: Uint8Array, at: number): { value: bigint; next: number } | null {
  let value = 0n
  for (let i = 0; i < 19; i++) {
    if (at + i >= buf.length) return null // truncated
    const byte = BigInt(buf[at + i])
    if (i === 18 && byte >= 0x04) return null // the 19th byte cannot fit in u128
    value |= (byte & 0x7fn) << (7n * BigInt(i))
    if (value > U128_MAX) return null // overflow
    if ((byte & 0x80n) === 0n) return { value, next: at + i + 1 }
  }
  return null // more than 18 bytes
}

/** Encode a u128 as LEB128 — the inverse, so tests can round-trip. */
export function encodeVarint(n: bigint): Uint8Array {
  if (n < 0n || n > U128_MAX) throw new Error('runestone: varint out of u128 range')
  const out: number[] = []
  let v = n
  while (v > 0x7fn) { out.push(Number((v & 0x7fn) | 0x80n)); v >>= 7n }
  out.push(Number(v))
  return Uint8Array.from(out)
}

// ── the payload: OP_RETURN OP_13, then data pushes only ────────────────────
const OP_RETURN = 0x6a
const OP_13 = 0x5d
const OP_PUSHDATA1 = 0x4c, OP_PUSHDATA2 = 0x4d, OP_PUSHDATA4 = 0x4e
/** Opcode 79 (OP_1NEGATE) and above are not data pushes — the spec's own line. */
const FIRST_NON_DATA_PUSH = 79

/**
 * Extract the runestone payload from a scriptPubKey, or say why not.
 * `null` = this output is simply not a runestone (no OP_RETURN OP_13).
 */
export function runestonePayload(script: Uint8Array): { payload: Uint8Array } | { flaw: Flaw } | null {
  if (script.length < 2 || script[0] !== OP_RETURN || script[1] !== OP_13) return null
  const chunks: number[] = []
  let i = 2
  while (i < script.length) {
    const op = script[i]
    if (op >= FIRST_NON_DATA_PUSH) return { flaw: 'opcode' } // a cenotaph, per the spec
    let len: number, from: number
    if (op < OP_PUSHDATA1) { len = op; from = i + 1 }
    else if (op === OP_PUSHDATA1) { if (i + 1 >= script.length) return { flaw: 'invalid-script' }; len = script[i + 1]; from = i + 2 }
    else if (op === OP_PUSHDATA2) { if (i + 2 >= script.length) return { flaw: 'invalid-script' }; len = script[i + 1] | (script[i + 2] << 8); from = i + 3 }
    else if (op === OP_PUSHDATA4) { if (i + 4 >= script.length) return { flaw: 'invalid-script' }; len = script[i + 1] | (script[i + 2] << 8) | (script[i + 3] << 16) | (script[i + 4] << 24); from = i + 5 }
    else return { flaw: 'invalid-script' } // 0x4f..0x4e are covered above; unreachable
    if (from + len > script.length) return { flaw: 'invalid-script' }
    for (let k = 0; k < len; k++) chunks.push(script[from + k])
    i = from + len
  }
  return { payload: Uint8Array.from(chunks) }
}

/** RuneId delta arithmetic, exactly as the specification defines `next`. */
function nextRuneId(prev: RuneId, blockDelta: bigint, txValue: bigint): RuneId | null {
  const block = prev.block + blockDelta
  if (block > U64_MAX) return null
  // a zero block delta means the tx value is a DELTA; otherwise it is ABSOLUTE
  const tx = blockDelta === 0n ? prev.tx + txValue : txValue
  if (tx > U32_MAX) return null
  return { block, tx }
}

/**
 * DECIPHER a transaction's runestone.
 *
 * `outputScripts` are every output's scriptPubKey, in order — the count matters
 * (an edict or pointer past the last output is a cenotaph, and "one past the
 * end" is the specification's own "spread across all outputs" idiom).
 *
 * Returns null when the transaction simply carries no runestone.
 */
export function decipher(outputScripts: Uint8Array[]): Artifact | null {
  let payload: Uint8Array | null = null
  const flaws = new Set<Flaw>()
  for (const script of outputScripts) {
    const r = runestonePayload(script)
    if (r === null) continue
    if ('flaw' in r) return { kind: 'cenotaph', flaws: [r.flaw] } // the FIRST runestone output decides
    payload = r.payload
    break
  }
  if (payload === null) return null

  // 1 · payload → integers
  const integers: bigint[] = []
  let at = 0
  while (at < payload.length) {
    const v = decodeVarint(payload, at)
    if (!v) return { kind: 'cenotaph', flaws: ['varint'] }
    integers.push(v.value)
    at = v.next
  }

  // 2 · integers → fields and edicts
  const fields = new Map<bigint, bigint[]>()
  const edicts: Edict[] = []
  const numOutputs = outputScripts.length
  for (let i = 0; i < integers.length; i += 2) {
    const tag = integers[i]
    if (tag === TAG.Body) {
      // everything after Body is edicts, in groups of four
      let id: RuneId = { block: 0n, tx: 0n }
      for (let j = i + 1; j < integers.length; j += 4) {
        if (j + 3 >= integers.length) { flaws.add('trailing-integers'); break }
        const next = nextRuneId(id, integers[j], integers[j + 1])
        if (!next) { flaws.add('edict-rune-id'); break }
        // block 0 with a non-zero tx is not a rune that can exist
        if (next.block === 0n && next.tx > 0n) { flaws.add('edict-rune-id'); break }
        const amount = integers[j + 2]
        const outputBig = integers[j + 3]
        if (outputBig > BigInt(numOutputs)) { flaws.add('edict-output'); break }
        id = next
        edicts.push({ id: next, amount, output: Number(outputBig) })
      }
      break
    }
    if (i + 1 >= integers.length) { flaws.add('truncated-field'); break }
    const list = fields.get(tag)
    if (list) list.push(integers[i + 1])
    else fields.set(tag, [integers[i + 1]])
  }

  // 3 · fields → the runestone, consuming what is recognized
  const take = (tag: bigint, n: number, build: (v: bigint[]) => unknown | undefined): unknown | undefined => {
    const list = fields.get(tag)
    if (!list || list.length < n) return undefined
    const built = build(list.slice(0, n))
    if (built === undefined) return undefined // not consumed: an even tag left behind is a cenotaph
    list.splice(0, n)
    if (list.length === 0) fields.delete(tag)
    return built
  }
  let flags = (take(TAG.Flags, 1, ([v]) => v) as bigint | undefined) ?? 0n
  const hasFlag = (bit: bigint): boolean => {
    const mask = 1n << bit
    if ((flags & mask) === 0n) return false
    flags &= ~mask
    return true
  }
  const isEtching = hasFlag(FLAG.Etching)
  const hasTerms = hasFlag(FLAG.Terms)
  const turbo = hasFlag(FLAG.Turbo)

  let etching: Etching | undefined
  if (isEtching) {
    const divisibility = take(TAG.Divisibility, 1, ([v]) => (v <= 38n ? Number(v) : undefined)) as number | undefined
    const rune = take(TAG.Rune, 1, ([v]) => v) as bigint | undefined
    const spacers = take(TAG.Spacers, 1, ([v]) => (v <= 0b111_1111_1111_1111_1111_1111_1111n ? Number(v) : undefined)) as number | undefined
    const symbol = take(TAG.Symbol, 1, ([v]) => (v <= 0x10ffffn ? String.fromCodePoint(Number(v)) : undefined)) as string | undefined
    const premine = take(TAG.Premine, 1, ([v]) => v) as bigint | undefined
    const terms: Terms | undefined = hasTerms ? {
      amount: take(TAG.Amount, 1, ([v]) => v) as bigint | undefined,
      cap: take(TAG.Cap, 1, ([v]) => v) as bigint | undefined,
      heightStart: take(TAG.HeightStart, 1, ([v]) => (v <= U64_MAX ? v : undefined)) as bigint | undefined,
      heightEnd: take(TAG.HeightEnd, 1, ([v]) => (v <= U64_MAX ? v : undefined)) as bigint | undefined,
      offsetStart: take(TAG.OffsetStart, 1, ([v]) => (v <= U64_MAX ? v : undefined)) as bigint | undefined,
      offsetEnd: take(TAG.OffsetEnd, 1, ([v]) => (v <= U64_MAX ? v : undefined)) as bigint | undefined,
    } : undefined
    etching = { divisibility, premine, rune, spacers, symbol, terms, turbo }
    // supply must fit in u128 — a supply that overflows is a cenotaph, never a wrap
    const cap = terms?.cap ?? 0n, amt = terms?.amount ?? 0n, pre = premine ?? 0n
    if (pre + cap * amt > U128_MAX) flaws.add('supply-overflow')
  }

  const mint = take(TAG.Mint, 2, ([block, tx]) => (block <= U64_MAX && tx <= U32_MAX ? { block, tx } : undefined)) as RuneId | undefined
  const pointer = take(TAG.Pointer, 1, ([v]) => (v < BigInt(numOutputs) ? Number(v) : undefined)) as number | undefined

  // 4 · what is left decides: an unknown flag, or ANY even tag still standing
  if (flags !== 0n) flaws.add('unrecognized-flag')
  for (const tag of fields.keys()) if (tag % 2n === 0n) { flaws.add('unrecognized-even-tag'); break }

  if (flaws.size > 0) {
    return { kind: 'cenotaph', flaws: [...flaws].sort(), etching: etching?.rune, mint }
  }
  return { kind: 'runestone', edicts, etching, mint, pointer }
}

// ── rune names: the specification's modified base-26 ───────────────────────
/** A rune's u128 value → its letters (A–Z, no separators). */
export function runeName(n: bigint): string {
  if (n < 0n || n > U128_MAX) throw new Error('runestone: rune value out of range')
  let v = n + 1n
  let out = ''
  while (v > 0n) {
    out = String.fromCharCode(Number((v - 1n) % 26n) + 65) + out
    v = (v - 1n) / 26n
  }
  return out
}
/** Its letters → the u128 value. Rejects anything that is not A–Z. */
export function runeValue(name: string): bigint {
  let v = 0n
  for (const ch of name) {
    const c = ch.charCodeAt(0)
    if (c < 65 || c > 90) throw new Error('runestone: a rune name is A–Z only')
    v = v * 26n + BigInt(c - 65) + 1n
  }
  return v - 1n
}
/** The spaced, human form — `KRILL•FREE` — from the name and its spacer bits. */
export function spacedRuneName(n: bigint, spacers = 0): string {
  const name = runeName(n)
  let out = ''
  for (let i = 0; i < name.length; i++) {
    out += name[i]
    if (i < name.length - 1 && (spacers & (1 << i)) !== 0) out += '•'
  }
  return out
}

// ── the transfer law: which runes end up in which output ───────────────────
export interface RuneBalance { id: RuneId; amount: bigint }
const idKey = (id: RuneId): string => `${id.block}:${id.tx}`
const keyId = (k: string): RuneId => { const [b, t] = k.split(':'); return { block: BigInt(b), tx: BigInt(t) } }

export interface AllocationInput {
  /** every output's scriptPubKey, in order */
  outputScripts: Uint8Array[]
  /** the rune balances the transaction's inputs carried in */
  inputs: RuneBalance[]
  /** what a mint of that rune yields here, if the artifact mints (caller supplies
   *  it: the amount comes from the etching's terms, which live in another tx) */
  mintAmount?: bigint
  /** the id assigned to a rune etched in THIS transaction, if any */
  etchedId?: RuneId
}

export interface Allocation {
  /** output index → the runes it carries out */
  outputs: Map<number, RuneBalance[]>
  /** what this transaction destroyed — a cenotaph burns everything it touched */
  burned: RuneBalance[]
}

/**
 * APPLY THE RUNESTONE — the specification's allocation algorithm, exactly.
 *
 * A cenotaph burns every rune the transaction took in. Otherwise: mint and
 * premine join the unallocated pool, edicts move runes out of it in order
 * (clamped by what is left — never inventing), `amount = 0` means "all of it",
 * `output = numOutputs` means "spread across every non-OP_RETURN output" (with
 * the remainder going to the first R of them, so nothing is lost to rounding),
 * and whatever is still unallocated lands on the pointer output, or on the
 * first non-OP_RETURN output when there is no pointer.
 */
export function allocate(artifact: Artifact | null, input: AllocationInput): Allocation {
  const outputs = new Map<number, RuneBalance[]>()
  const unallocated = new Map<string, bigint>()
  for (const b of input.inputs) unallocated.set(idKey(b.id), (unallocated.get(idKey(b.id)) ?? 0n) + b.amount)

  const burnAll = (): Allocation => ({
    outputs,
    burned: [...unallocated].filter(([, a]) => a > 0n).map(([k, amount]) => ({ id: keyId(k), amount })),
  })
  if (artifact !== null && artifact.kind === 'cenotaph') {
    // a cenotaph's mint still counts against the cap upstream, and still burns
    if (artifact.mint && input.mintAmount) unallocated.set(idKey(artifact.mint), (unallocated.get(idKey(artifact.mint)) ?? 0n) + input.mintAmount)
    return burnAll()
  }

  const isOpReturn = (s: Uint8Array): boolean => s.length > 0 && s[0] === OP_RETURN
  const eligible: number[] = []
  for (let i = 0; i < input.outputScripts.length; i++) if (!isOpReturn(input.outputScripts[i])) eligible.push(i)

  if (artifact !== null) {
    if (artifact.mint && input.mintAmount) unallocated.set(idKey(artifact.mint), (unallocated.get(idKey(artifact.mint)) ?? 0n) + input.mintAmount)
    if (artifact.etching?.premine && input.etchedId) {
      unallocated.set(idKey(input.etchedId), (unallocated.get(idKey(input.etchedId)) ?? 0n) + artifact.etching.premine)
    }
  }

  const give = (out: number, id: RuneId, amount: bigint): void => {
    if (amount <= 0n) return
    const list = outputs.get(out) ?? []
    const found = list.find((b) => idKey(b.id) === idKey(id))
    if (found) found.amount += amount
    else list.push({ id, amount })
    outputs.set(out, list)
  }

  if (artifact !== null && artifact.kind === 'runestone') {
    for (const edict of artifact.edicts) {
      // id 0:0 inside an etching transaction means the rune being etched here
      const id = edict.id.block === 0n && edict.id.tx === 0n ? input.etchedId : edict.id
      if (!id) continue // an etch-relative edict with nothing etched allocates nothing
      const key = idKey(id)
      const have = unallocated.get(key) ?? 0n
      if (have <= 0n && edict.amount !== 0n) continue

      if (edict.output === input.outputScripts.length) {
        // "one past the end" — spread across every eligible output
        if (eligible.length === 0) continue
        if (edict.amount === 0n) {
          const per = have / BigInt(eligible.length)
          let rest = have - per * BigInt(eligible.length) // the remainder, to the FIRST R outputs
          for (const out of eligible) {
            const extra = rest > 0n ? 1n : 0n
            if (rest > 0n) rest -= 1n
            give(out, id, per + extra)
          }
          unallocated.set(key, 0n)
        } else {
          let left = have
          for (const out of eligible) {
            const amount = edict.amount < left ? edict.amount : left // clamp: never invent
            give(out, id, amount)
            left -= amount
            if (left <= 0n) break
          }
          unallocated.set(key, left)
        }
      } else {
        const amount = edict.amount === 0n ? have : (edict.amount < have ? edict.amount : have)
        give(edict.output, id, amount)
        unallocated.set(key, have - amount)
      }
    }
  }

  // whatever is left goes to the pointer, or to the first eligible output
  const target = artifact !== null && artifact.kind === 'runestone' && artifact.pointer !== undefined
    ? artifact.pointer
    : (eligible.length > 0 ? eligible[0] : undefined)
  const burned: RuneBalance[] = []
  for (const [k, amount] of unallocated) {
    if (amount <= 0n) continue
    if (target === undefined) burned.push({ id: keyId(k), amount }) // nowhere to land: destroyed
    else give(target, keyId(k), amount)
  }
  // RUNES SENT TO AN OP_RETURN ARE BURNED. An edict may name an unspendable
  // output, and the runes that land there are gone — counting them as a balance
  // would leave an L2 backed by money that no longer exists on Bitcoin.
  for (const [out, list] of [...outputs]) {
    if (!isOpReturn(input.outputScripts[out])) continue
    for (const b of list) burned.push(b)
    outputs.delete(out)
  }
  return { outputs, burned }
}
