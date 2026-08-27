/**
 * THE VAULT WATCHER, PROVEN — every verdict pinned, every hostile path refused.
 *
 * The watcher is read-only law: backed / released / ALARM, nothing else. This pins that the law is
 * TOTAL (no input reaches an undefined verdict) and FAIL-CLOSED (anything unverifiable is treated as
 * missing backing, never as fine). Pure arithmetic; no node, no funds.
 *
 *   node src/test/vault-watch.test.ts
 */
import { validateWatch, judgeOutpoint, markReleased, sweep, type WatchedOutpoint } from '../protocol/vault-watch.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const threw = (fn: () => unknown, why: RegExp, m: string) => { let t = false; try { fn() } catch (e) { t = why.test(String((e as Error).message)) } ok(t, m) }

const T = 'a'.repeat(64)
const W = (over: Partial<WatchedOutpoint> = {}): WatchedOutpoint => ({
  outpoint: `${T}:0`, runeId: '121:1', vault: 'bcrt1pvault', amount: '1000', depositor: 'b'.repeat(64), at: 1, ...over,
})

function main() {
  console.log('\n╔═ THE VAULT WATCHER — backed · released · ALARM, total and fail-closed ═╗')

  // ── 1 · junk never enters the registry ─────────────────────────────────────
  ok(validateWatch(W()).ok === true, 'a well-formed watch is accepted')
  ok(validateWatch(W({ outpoint: 'nope' })).ok === false, 'a malformed outpoint is refused')
  ok(validateWatch(W({ runeId: 'x' })).ok === false, 'a malformed runeId is refused')
  ok(validateWatch(W({ vault: '' })).ok === false, 'a missing vault is refused')
  ok(validateWatch(W({ amount: '0' })).ok === false, 'a zero amount is refused')
  ok(validateWatch(W({ amount: '-5' })).ok === false, 'a negative-looking amount is refused')
  ok(validateWatch(W({ depositor: 'zz' })).ok === false, 'a bad depositor key is refused')
  // the shared consolidation pool is federation custody — no single depositor key
  ok(validateWatch(W({ kind: 'consolidation', depositor: '' })).ok === true, 'a consolidation watch (the shared pool) is accepted with NO depositor key')
  ok(validateWatch(W({ kind: 'consolidation', depositor: 'b'.repeat(64) })).ok === false, 'a consolidation watch WITH a depositor is refused — the pool has no single owner')
  const cAlarm = judgeOutpoint(W({ kind: 'consolidation', depositor: '' }), { outpoint: `${T}:0`, unspent: false })
  ok(cAlarm.state === 'ALARM', 'a drained consolidation pool ALARMS just like a vault — the shared backing is watched too')

  // ── 2 · the whole law in one function ──────────────────────────────────────
  ok(judgeOutpoint(W(), { outpoint: `${T}:0`, unspent: true }).state === 'backed', 'unspent → BACKED (the satoshis are where the book says)')
  const rel = judgeOutpoint(W({ releasedBy: 'c'.repeat(64) }), { outpoint: `${T}:0`, unspent: false })
  ok(rel.state === 'released' && rel.state === 'released' && rel.by === 'c'.repeat(64), 'spent + released by a settle → RELEASED (lawful payout)')
  const alarm = judgeOutpoint(W(), { outpoint: `${T}:0`, unspent: false })
  ok(alarm.state === 'ALARM' && /outside the book/.test(alarm.state === 'ALARM' ? alarm.reason : ''), 'spent + NOT released → ALARM (the drain this watcher exists for)')
  ok(judgeOutpoint(W({ releasedBy: 'c'.repeat(64) }), { outpoint: `${T}:0`, unspent: true }).state === 'released', 'a released outpoint stays released even if the chain still shows it unspent (mempool lag)')
  ok(judgeOutpoint(W(), { outpoint: `${'d'.repeat(64)}:0`, unspent: true }).state === 'ALARM', 'a MISMATCHED chain answer ALARMS — a broken sweep can never bless a vault')

  // ── 3 · a release comes only from a payout's own inputs ────────────────────
  const marked = markReleased([W(), W({ outpoint: `${'e'.repeat(64)}:1` })], [`${T}:0`], 'f'.repeat(64))
  ok(marked[0].releasedBy === 'f'.repeat(64) && marked[1].releasedBy === undefined, 'markReleased marks exactly the spent outpoints, leaves the rest untouched')
  ok(markReleased([W({ releasedBy: '1'.repeat(64) })], [`${T}:0`], '2'.repeat(64))[0].releasedBy === '1'.repeat(64), 'the first release is permanent — a later txid cannot repaint history')
  threw(() => markReleased([W()], [`${T}:0`], 'junk'), /32-byte hex/, 'a malformed settle txid is refused')
  const reg = [W()]; markReleased(reg, [`${T}:0`], 'f'.repeat(64))
  ok(reg[0].releasedBy === undefined, 'markReleased is PURE — the input registry is never mutated')

  // ── 4 · fail-closed aggregation ────────────────────────────────────────────
  const s1 = sweep([
    W(),
    W({ outpoint: `${'e'.repeat(64)}:1`, releasedBy: 'c'.repeat(64) }),
    W({ outpoint: `${'d'.repeat(64)}:2` }),
  ], [
    { outpoint: `${T}:0`, unspent: true },
    { outpoint: `${'e'.repeat(64)}:1`, unspent: false },
    { outpoint: `${'d'.repeat(64)}:2`, unspent: false },
  ])
  ok(s1.backed === 1 && s1.released === 1 && s1.alarms.length === 1, 'sweep counts backed / released / alarms exactly')
  const s2 = sweep([W()], [])
  ok(s2.alarms.length === 1 && /unverified/.test(s2.alarms[0].state === 'ALARM' ? s2.alarms[0].reason : ''), 'a MISSING chain answer ALARMS — unverified backing is treated as missing, never as fine')
  const s3 = sweep([W({ releasedBy: 'c'.repeat(64) })], [])
  ok(s3.released === 1 && s3.alarms.length === 0, 'a missing answer for an already-released outpoint stays released (its story is closed)')
  const s4 = sweep([], [])
  ok(s4.verdicts.length === 0 && s4.alarms.length === 0, 'an empty registry sweeps clean')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the eye's verdicts are total and fail-closed. 👁₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
