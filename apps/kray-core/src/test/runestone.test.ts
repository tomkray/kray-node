/**
 * RUNESTONE — the official specification, checked line by line.
 *   node src/test/runestone.test.ts
 *
 * A bridge that mis-reads a runestone by one unit is a bridge that mints money
 * Bitcoin never moved, or burns money it did. So this suite works the way the
 * specification reads: every rule becomes an assertion, and every CENOTAPH
 * condition becomes a refusal — because a cenotaph burns the input runes, and
 * reading one as an ordinary transfer would credit an L2 with destroyed money.
 *
 * Includes the specification's own delta-encoding example, verbatim.
 */
import {
  TAG, FLAG, allocate, decipher, decodeVarint, encodeVarint, runeName, runeValue,
  runestonePayload, spacedRuneName, type Artifact, type RuneBalance,
} from '../protocol/runestone.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
const isCenotaph = (a: Artifact | null, flaw: string, label: string): void =>
  ok(a !== null && a.kind === 'cenotaph' && a.flaws.includes(flaw as never), `${label} → CENOTAPH (${flaw})`)

/** Build a runestone output script from a list of integers. */
function stone(ints: bigint[]): Uint8Array {
  const body: number[] = []
  for (const n of ints) body.push(...encodeVarint(n))
  const out = [0x6a, 0x5d] // OP_RETURN OP_13
  // data pushes, ≤75 bytes each (the direct-push range)
  for (let i = 0; i < body.length; i += 75) {
    const chunk = body.slice(i, i + 75)
    out.push(chunk.length, ...chunk)
  }
  return Uint8Array.from(out)
}
const P2TR = Uint8Array.from([0x51, 0x20, ...new Array(32).fill(0xab)]) // an ordinary output
const outs = (n: number, ...extra: Uint8Array[]): Uint8Array[] => [...new Array(n).fill(P2TR), ...extra]

function main() {
  // ── 1 · LEB128, the specification's integer encoding ─────────────────────
  for (const n of [0n, 1n, 127n, 128n, 300n, 2n ** 64n, (1n << 128n) - 1n]) {
    const enc = encodeVarint(n)
    const dec = decodeVarint(enc, 0)
    ok(dec !== null && dec.value === n && dec.next === enc.length, `varint round-trips: ${n}`)
  }
  ok(decodeVarint(Uint8Array.from([0x80]), 0) === null, 'a TRUNCATED varint decodes to nothing — never to a guess')
  ok(decodeVarint(Uint8Array.from(new Array(19).fill(0x80)), 0) === null, 'more than 18 bytes → refused (the spec\'s own limit)')
  ok(decodeVarint(Uint8Array.from([...new Array(18).fill(0x80), 0x40]), 0) === null, 'a varint that would OVERFLOW u128 → refused, never wrapped')

  // ── 2 · the payload: data pushes only ────────────────────────────────────
  ok(runestonePayload(Uint8Array.from([0x51, 0x20])) === null, 'an ordinary output is not a runestone (no OP_RETURN OP_13)')
  ok(runestonePayload(Uint8Array.from([0x6a, 0x5d, 0x02, 0x01, 0x02])) !== null, 'OP_RETURN OP_13 + a push IS a runestone payload')
  const nonPush = runestonePayload(Uint8Array.from([0x6a, 0x5d, 0x51])) // OP_1 = opcode 81
  ok(nonPush !== null && 'flaw' in nonPush && nonPush.flaw === 'opcode', 'a NON-DATA-PUSH inside the runestone → cenotaph (opcode ≥ 79)')

  // ── 3 · THE SPECIFICATION'S OWN EDICT EXAMPLE, verbatim ──────────────────
  // edicts at (10:5), (10:5), (10:7), (50:1) encode as:
  const spec = [10n, 5n, 5n, 1n, 0n, 0n, 10n, 3n, 0n, 2n, 1n, 8n, 40n, 1n, 25n, 4n]
  const a1 = decipher([...outs(9), stone([TAG.Body, ...spec])])
  ok(a1 !== null && a1.kind === 'runestone', 'the specification\'s example deciphers as a runestone')
  const e1 = (a1 as { edicts: Array<{ id: { block: bigint; tx: bigint }; amount: bigint; output: number }> }).edicts
  ok(e1.length === 4, 'four edicts, as the example says')
  ok(e1[0].id.block === 10n && e1[0].id.tx === 5n && e1[0].amount === 5n && e1[0].output === 1, 'edict 1 = (10:5) amount 5 → output 1')
  ok(e1[1].id.block === 10n && e1[1].id.tx === 5n && e1[1].amount === 10n && e1[1].output === 3, 'edict 2 = (10:5) again — a zero block delta means the tx value is a DELTA')
  ok(e1[2].id.block === 10n && e1[2].id.tx === 7n && e1[2].amount === 1n && e1[2].output === 8, 'edict 3 = (10:7) — delta 2 on the tx')
  ok(e1[3].id.block === 50n && e1[3].id.tx === 1n && e1[3].amount === 25n && e1[3].output === 4, 'edict 4 = (50:1) — a non-zero block delta means the tx value is ABSOLUTE')

  // ── 4 · EVERY CENOTAPH CONDITION IS A REFUSAL ────────────────────────────
  isCenotaph(decipher([...outs(2), stone([TAG.Body, 1n, 1n, 1n, 9n])]), 'edict-output', 'an edict pointing past the last output')
  isCenotaph(decipher([...outs(2), stone([TAG.Body, 0n, 1n, 1n, 0n])]), 'edict-rune-id', 'a rune id with block 0 and a non-zero tx')
  isCenotaph(decipher([...outs(2), stone([TAG.Body, 1n, 1n, 1n])]), 'trailing-integers', 'integers left over that cannot form an edict')
  isCenotaph(decipher([...outs(2), stone([TAG.Flags])]), 'truncated-field', 'a tag with no value after it')
  isCenotaph(decipher([...outs(2), stone([124n, 1n])]), 'unrecognized-even-tag', 'an unrecognized EVEN tag')
  isCenotaph(decipher([...outs(2), stone([TAG.Flags, 1n << 30n])]), 'unrecognized-flag', 'an unrecognized FLAG bit')
  isCenotaph(decipher([...outs(2), stone([TAG.Pointer, 9n])]), 'unrecognized-even-tag', 'a pointer past the last output (the even tag survives)')
  isCenotaph(decipher([...outs(2), stone([TAG.Cenotaph, 0n])]), 'unrecognized-even-tag', 'the Cenotaph tag itself')
  // an unrecognized ODD tag is IGNORED — this is how Runes evolves without a fork
  const odd = decipher([...outs(2), stone([125n, 7n, TAG.Body, 1n, 1n, 5n, 0n])])
  ok(odd !== null && odd.kind === 'runestone' && odd.edicts.length === 1, 'an unrecognized ODD tag is IGNORED, not fatal — the parity rule, honoured exactly')

  // ── 5 · ETCHING, MINT, POINTER ───────────────────────────────────────────
  const etch = decipher([...outs(2), stone([
    TAG.Flags, (1n << FLAG.Etching) | (1n << FLAG.Terms) | (1n << FLAG.Turbo),
    TAG.Rune, runeValue('KRILLFREE'), TAG.Divisibility, 2n, TAG.Spacers, 0b10000n, TAG.Symbol, BigInt('₭'.codePointAt(0)!),
    TAG.Premine, 1000n, TAG.Amount, 10n, TAG.Cap, 100n, TAG.Pointer, 1n,
  ])])
  ok(etch !== null && etch.kind === 'runestone' && !!etch.etching, 'an etching with terms deciphers')
  const et = (etch as { etching: { rune: bigint; divisibility?: number; spacers?: number; symbol?: string; premine?: bigint; turbo: boolean; terms?: { amount?: bigint; cap?: bigint } } }).etching
  ok(et.divisibility === 2 && et.symbol === '₭' && et.premine === 1000n && et.turbo === true, 'divisibility, symbol, premine and the turbo flag all read back exactly')
  ok(et.terms?.amount === 10n && et.terms?.cap === 100n, 'the open-mint terms read back exactly')
  ok(spacedRuneName(et.rune, et.spacers ?? 0) === 'KRILL•FREE', 'the rune name round-trips through base-26 AND its spacers: KRILL•FREE')
  ok((etch as { pointer?: number }).pointer === 1, 'the pointer reads back')
  // a multi-value tag repeats its OWN tag before each value — the spec's encoding
  const mint = decipher([...outs(2), stone([TAG.Mint, 840000n, TAG.Mint, 3n])])
  ok(mint !== null && mint.kind === 'runestone' && mint.mint?.block === 840000n && mint.mint?.tx === 3n, 'a mint reads back its rune id')
  // a supply that would overflow u128 is a cenotaph, never a silent wrap
  isCenotaph(decipher([...outs(2), stone([TAG.Flags, (1n << FLAG.Etching) | (1n << FLAG.Terms), TAG.Premine, (1n << 128n) - 1n, TAG.Amount, 2n, TAG.Cap, 2n])]), 'supply-overflow', 'an etching whose supply overflows u128')

  // ── 6 · rune names ───────────────────────────────────────────────────────
  ok(runeName(0n) === 'A' && runeName(25n) === 'Z' && runeName(26n) === 'AA', 'base-26 names march A, …, Z, AA')
  for (const n of ['A', 'Z', 'AA', 'KRILLFREE', 'UNCOMMONGOODS']) ok(runeName(runeValue(n)) === n, `the name ${n} round-trips`)

  // ── 7 · THE ALLOCATION LAW — where the money actually lands ──────────────
  const R: RuneBalance[] = [{ id: { block: 10n, tx: 5n }, amount: 1000n }]
  const scripts = outs(3, stone([TAG.Body, 10n, 5n, 400n, 1n]))
  const al = allocate(decipher(scripts), { outputScripts: scripts, inputs: R })
  ok(al.outputs.get(1)?.[0].amount === 400n, 'an edict moves exactly what it says — 400 to output 1')
  ok(al.outputs.get(0)?.[0].amount === 600n, '…and the rest lands on the first non-OP_RETURN output (no pointer given)')

  const s2 = outs(3, stone([TAG.Pointer, 2n, TAG.Body, 10n, 5n, 400n, 1n]))
  const a2 = allocate(decipher(s2), { outputScripts: s2, inputs: R })
  ok(a2.outputs.get(2)?.[0].amount === 600n, 'with a POINTER, the remainder lands where it points')

  const s3 = outs(3, stone([TAG.Body, 10n, 5n, 0n, 4n])) // amount 0, output == numOutputs
  const a3 = allocate(decipher(s3), { outputScripts: s3, inputs: R })
  const spread = [0, 1, 2].map((i) => a3.outputs.get(i)?.[0].amount ?? 0n)
  ok(spread.reduce((x, y) => x + y, 0n) === 1000n, 'spread across every eligible output loses NOTHING — 1,000 in, 1,000 out')
  ok(spread[0] === 334n && spread[1] === 333n && spread[2] === 333n, '…and the remainder goes to the FIRST R outputs, exactly as the spec says (334/333/333)')

  const s4 = outs(2, stone([TAG.Body, 10n, 5n, 99999n, 1n]))
  const a4 = allocate(decipher(s4), { outputScripts: s4, inputs: R })
  ok(a4.outputs.get(1)?.[0].amount === 1000n, 'an edict asking for MORE than exists is CLAMPED to what exists — runes are never invented')

  // a cenotaph burns everything the transaction took in
  const s5 = outs(2, stone([124n, 1n]))
  const a5 = allocate(decipher(s5), { outputScripts: s5, inputs: R })
  ok(a5.outputs.size === 0 && a5.burned[0]?.amount === 1000n, 'a CENOTAPH burns every input rune — an L2 that missed this would credit destroyed money')

  // no eligible output at all: the runes are destroyed, never quietly kept
  const s6 = [stone([TAG.Body, 10n, 5n, 10n, 0n])]
  const a6 = allocate(decipher(s6), { outputScripts: s6, inputs: R })
  ok(a6.burned.reduce((t, b) => t + b.amount, 0n) === 1000n, 'a transaction with nowhere to land destroys the runes — and says so')

  console.log(`\n✓ ${pass} checks passed — THE RUNES SPECIFICATION, IMPLEMENTED FROM BYTES: LEB128 with its exact refusals, data-push-only payloads, the delta-encoded edicts of the spec's own example, every cenotaph condition as a refusal (including the parity rule that lets Runes evolve without a fork), etchings with terms, base-26 names with spacers, and the allocation law to the unit — clamped, spread with its remainder, and burned when Bitcoin burns it. No indexer, no trust: bytes decide. ₿`)
}
main()
