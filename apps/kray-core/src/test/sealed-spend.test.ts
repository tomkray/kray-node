/**
 * COVERING SEAL — a read of Bitcoin weight (Article VI: witness, not a spend lock).
 *   node src/test/sealed-spend.test.ts
 */
import { coveringSeal, openExitSeq, blockOfSeq } from '../protocol/sealed-spend.ts'

let pass = 0
function ok(c: boolean, m: string) { if (c) { pass++; console.log('  ✓', m) } else { console.error('  ✗', m); process.exit(1) } }

const blocks = [
  { number: 0, fromSeq: 1, toSeq: 10, cascadeRoot: 'aa'.repeat(32) },
  { number: 1, fromSeq: 11, toSeq: 20, cascadeRoot: 'bb'.repeat(32) },
  { number: 2, fromSeq: 21, toSeq: 30, cascadeRoot: 'cc'.repeat(32) },
]

ok(blockOfSeq(15, blocks)?.number === 1, 'seq 15 lives in L2 block 1')
ok(blockOfSeq(31, blocks) === null, 'a seq past the tip is not in a block yet')

const sealed63 = coveringSeal(15, blocks, [
  { blockNumber: 1, root: 'bb'.repeat(32), verified: true, real: true, txid: 'd'.repeat(64) },
], {})
ok(sealed63.ok === true && sealed63.ok && sealed63.sealedBy === 1, 'an exit in a donate-sealed block is covered')

const laterCovers = coveringSeal(5, blocks, [
  { blockNumber: 2, root: 'cc'.repeat(32), verified: true, real: true, txid: 'e'.repeat(64) },
], {})
ok(laterCovers.ok === true && laterCovers.ok && laterCovers.sealedBy === 2, 'a later seal covers earlier unsealed blocks (cascade)')

const unsealed = coveringSeal(25, blocks, [
  { blockNumber: 1, root: 'bb'.repeat(32), verified: true, real: true, txid: 'd'.repeat(64) },
], {})
ok(unsealed.ok === false && /donate-sealed/.test(unsealed.reason || ''), 'an event AFTER the last donate is not yet witnessed on Bitcoin')

const wrongRoot = coveringSeal(15, blocks, [
  { blockNumber: 1, root: 'ff'.repeat(32), verified: true, real: true, txid: 'd'.repeat(64) },
], {})
ok(wrongRoot.ok === false, 'a seal whose root does not match the block is not a seal')

const fake = coveringSeal(15, blocks, [
  { blockNumber: 1, root: 'bb'.repeat(32), verified: true, simulated: true, real: false, txid: 'd'.repeat(64) },
], {})
ok(fake.ok === false, 'a simulated (regtest placeholder) seal is refused on the elite path')

const simOk = coveringSeal(15, blocks, [
  { blockNumber: 1, root: 'bb'.repeat(32), verified: false, simulated: true, real: false },
], { allowSimulated: true })
ok(simOk.ok === true, 'regtest exams may opt into simulated seals (they never bury)')

const events = [
  { seq: 12, kind: 'rune-exit', from: 'A', runeId: '1:1' },
  { seq: 18, kind: 'rune-cancel', from: 'A', runeId: '1:1' },
  { seq: 22, kind: 'rune-exit', from: 'A', runeId: '1:1' },
]
ok(openExitSeq(events, 'A', '1:1') === 22, 'open exit is the latest uncancelled rune-exit')
ok(openExitSeq(events, 'B', '1:1') === null, 'another address has no open exit')

console.log(`\n╚═ ${pass} passed — a donate witnesses the book; it does not unlock a withdraw. ₿₭`)
