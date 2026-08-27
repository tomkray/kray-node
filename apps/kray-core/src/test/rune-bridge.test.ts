/**
 * THE RUNE BRIDGE VERIFIER, ADVERSARIALLY — a rune moves L1↔L2 only if the runestone is perfect.
 * Builds real transactions (a runestone OP_RETURN + a target output) and proves: a correct movement
 * VERIFIES, and every way a rune could be BURNED or misrouted is REFUSED — a cenotaph, a burn, the
 * wrong output, a short amount, a sub-dust output. Reuses the canonical decoder + the live dust knob.
 *
 *   node src/test/rune-bridge.test.ts
 */
import { verifyRuneMovement } from '../protocol/rune-bridge.ts'
import { encodeVarint, TAG } from '../protocol/runestone.ts'
import { dustFor } from '../protocol/dust.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const refused = (v: { ok: boolean; reason?: string }, why: RegExp, m: string) => {
  const good = !v.ok && why.test(v.reason ?? '')
  if (good) pass++; else fail++
  console.log(`   ${good ? '✓ REFUSED' : '✗ ACCEPTED (BUG!)'} — ${m}${good ? ` (“${String(v.reason).slice(0, 50)}…”)` : ` [${v.ok ? 'accepted' : 'reason: ' + v.reason}]`}`)
}

// ── fixtures ─────────────────────────────────────────────────────────────────
const u64le = (n: bigint): string => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b.toString('hex') }
const push = (hex: string): string => (hex.length / 2).toString(16).padStart(2, '0') + hex
const TARGET = '5120' + '11'.repeat(32)      // the vault / owner output (P2TR), where the runes must land
const OTHER = '0014' + '22'.repeat(20)       // some other output (P2WPKH)
const runestone = (ints: bigint[]): string => '6a5d' + push(Buffer.concat(ints.map((n) => Buffer.from(encodeVarint(n)))).toString('hex'))
function tx(outs: Array<{ sats: bigint; script: string }>): string {
  const outHex = outs.map((o) => u64le(o.sats) + push(o.script)).join('')
  return ['01000000', '01', '00'.repeat(32), 'ffffffff', '00', 'ffffffff', outs.length.toString(16).padStart(2, '0'), outHex, '00000000'].join('')
}
const RUNE = { block: 840000n, tx: 9n }
const DUST = dustFor('p2tr')                 // 330
const IN = [{ id: RUNE, amount: 500n }]      // the vault UTXO holds 500 of the rune
const base = { runeId: RUNE, amount: 500n, targetScriptHex: TARGET, inputRunes: IN, dust: DUST }

function main() {
  console.log('\n╔═ THE RUNE BRIDGE — a movement verifies only if no rune can burn ══╗')

  // ── 1 · a correct payout — edict moves 500 to the target, ≥ dust ──────────
  const good = tx([{ sats: 330n, script: TARGET }, { sats: 0n, script: runestone([TAG.Body, RUNE.block, RUNE.tx, 500n, 0n]) }])
  const v = verifyRuneMovement({ ...base, rawTx: good })
  ok(v.ok === true && v.outputIndex === 0 && v.sats === 330n, 'a correct runestone moving 500 to the owner output (≥ dust) VERIFIES')

  // ── 2 · the DEFAULT allocation (no runestone) still lands the runes ───────
  const noStone = tx([{ sats: 330n, script: TARGET }])
  ok(verifyRuneMovement({ ...base, rawTx: noStone }).ok === true, 'no runestone → ord\'s default sends the runes to the first output (the target) → VERIFIES')

  console.log('\n─ every way a rune could burn or misroute — refused ──────────────')
  // ── 3 · a CENOTAPH (edict points past the last output) → burns → refuse ──
  const ceno = tx([{ sats: 330n, script: TARGET }, { sats: 0n, script: runestone([TAG.Body, RUNE.block, RUNE.tx, 500n, 9n]) }])
  refused(verifyRuneMovement({ ...base, rawTx: ceno }), /CENOTAPH/, 'a CENOTAPH (edict output past the end) — it would BURN the runes')

  // ── 4 · a NON-DATA-PUSH in the runestone → cenotaph → refuse ─────────────
  const opcode = tx([{ sats: 330n, script: TARGET }, { sats: 0n, script: '6a5d51' }]) // OP_RETURN OP_13 OP_1 (non-push)
  refused(verifyRuneMovement({ ...base, rawTx: opcode }), /CENOTAPH/, 'a non-data-push inside the runestone (opcode) → CENOTAPH, refused')

  // ── 5 · the runes go to the WRONG output (not the target) ────────────────
  const wrong = tx([{ sats: 330n, script: TARGET }, { sats: 330n, script: OTHER }, { sats: 0n, script: runestone([TAG.Body, RUNE.block, RUNE.tx, 500n, 1n]) }])
  refused(verifyRuneMovement({ ...base, rawTx: wrong }), /received 0 .*not the 500/, 'the edict routes the runes to a DIFFERENT output → the target got 0 → refused')

  // ── 6 · a SHORT amount reaches the target (the leftover defaults ELSEWHERE) ─
  // OTHER is output 0 (the first eligible), so ord's default sweeps the un-edicted 200 there;
  // the edict sends only 300 to the target at output 1 → the owner is shorted → refused.
  const short = tx([{ sats: 330n, script: OTHER }, { sats: 330n, script: TARGET }, { sats: 0n, script: runestone([TAG.Body, RUNE.block, RUNE.tx, 300n, 1n]) }])
  refused(verifyRuneMovement({ ...base, rawTx: short }), /received 300 .*not the 500/, 'the edict moves only 300 of the 500 to the owner (the rest defaults to another output) → refused')

  // ── 7 · the target output is BELOW the dust → would not relay ────────────
  const subdust = tx([{ sats: 100n, script: TARGET }, { sats: 0n, script: runestone([TAG.Body, RUNE.block, RUNE.tx, 500n, 0n]) }])
  refused(verifyRuneMovement({ ...base, rawTx: subdust }), /below the 330-sat dust/, 'the rune output pays 100 sats < 330 dust → it would not relay → refused')

  // ── 8 · the dust knob is LIVE — pin it to 1 and the same 100-sat output passes ─
  ok(verifyRuneMovement({ ...base, rawTx: subdust, dust: 1n }).ok === true, 'pin the dust to 1 sat → the same 100-sat output now clears it → VERIFIES (the limit is a live knob)')

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — a rune crosses L1↔L2 only through a perfect runestone; a cenotaph, a burn, a misroute, a short amount or a sub-dust output is refused before it can strand a coin. ⚗️₿`)
  process.exit(fail ? 1 : 0)
}
main()
