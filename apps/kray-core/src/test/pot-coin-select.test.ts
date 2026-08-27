/**
 * POT COIN SELECT — closest match, proven.
 *   node src/test/pot-coin-select.test.ts
 */
import { selectRuneCoins, type RuneCoin } from '../protocol/pot-coin-select.ts'

let pass = 0
function ok(c: boolean, m: string) { if (c) { pass++; console.log('  ✓', m) } else { console.error('  ✗', m); process.exit(1) } }
function rejects(fn: () => void, why: RegExp, m: string) {
  try { fn() } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (why.test(msg)) { pass++; console.log('  ✓', m); return }
    console.error('  ✗ wrong refusal', m, msg); process.exit(1)
  }
  console.error('  ✗ expected refusal', m); process.exit(1)
}

const coin = (n: number, runes: bigint, sats = 330n): RuneCoin => ({
  txid: n.toString(16).padStart(64, '0'), vout: 0, amountSats: sats, runes,
})

const a = coin(1, 1000n)
const b = coin(2, 1100n)
const c = coin(3, 5000n)
const d = coin(4, 400n)
const e = coin(5, 400n)

ok(selectRuneCoins([a, b, c], 1100n).selected[0].txid === b.txid, 'EXACT: the 1100 lock picks the 1100 coin — not the 5000')
{
  const r = selectRuneCoins([a, c], 1100n)
  ok(r.selected.length === 1 && r.selected[0].txid === c.txid && r.totalRunes === 5000n, 'CLOSEST ABOVE: 1100 with 1000+5000 picks the 5000 (smallest that covers), leaves the 1000')
}
{
  const r = selectRuneCoins([a, b, c], 900n)
  ok(r.selected.length === 1 && r.selected[0].txid === a.txid, 'CLOSEST ABOVE: 900 picks 1000, not 1100 or 5000')
}
{
  const r = selectRuneCoins([d, e, a], 800n)
  ok(r.selected.length === 2 && r.totalRunes === 800n, 'COMBO: 400+400 covers 800 exactly — does not eat the 1000')
  ok(r.selected.every((x) => x.runes === 400n), 'COMBO: both 400s, the leftover 1000 stays for the next exit')
}
{
  const r = selectRuneCoins([coin(1, 90n), coin(2, 80n), coin(3, 30n)], 100n)
  ok(r.totalRunes === 110n && r.selected.length === 2, 'COMBO: 80+30 = 110 beats 90+80 = 170 (least waste)')
}
rejects(() => selectRuneCoins([a], 2000n), /holds 1000/, 'ATTACK: lock larger than the pool → refused')
{
  const once = selectRuneCoins([c, a, b], 1100n)
  const twice = selectRuneCoins([b, c, a], 1100n)
  ok(once.selected[0].txid === twice.selected[0].txid, 'DETERMINISTIC: shuffled input order still picks the same coin')
}

console.log(`\n╚═ ${pass} passed — the pot spends the closest coin, not the whole bakery. ₿₭`)
