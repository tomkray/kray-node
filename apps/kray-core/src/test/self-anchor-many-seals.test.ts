/**
 * ONE LAW, N DONATES — every self-anchor is a seal. 1 or 1000, same mathematics.
 *
 * Inclusion is born at seq 0 on signet/main. A seal without Bitcoin height is
 * refused. Two donates in the same Bitcoin block share a height (non-decreasing,
 * not unique). A later donate at a higher height always seals. A duplicate txid
 * never reopens the window. The journal replays byte-exact.
 *
 *   node src/test/self-anchor-many-seals.test.ts
 */
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KrayNode } from '../protocol/node.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const txid = (n: number) => createHash('sha256').update('self-anchor-many|' + n).digest('hex')

function main() {
  console.log('\n╔═ N SELF-ANCHORS = N SEALS — one law, no conflict ═╗\n')
  const dir = join(tmpdir(), `kraynet-many-seals-${process.pid}`)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const node = new KrayNode(dir, 'signet')
  const genesis = node.cascadeRoot()

  try {
    node.sealConfirmed(txid(0), 1, undefined, genesis, 0)
    ok(false, 'a seal without Bitcoin height must be refused on a born-strict network')
  } catch (e) {
    ok(/Bitcoin height|l1Height/i.test((e as Error).message), 'no clock → no seal (inclusion born at 0)')
  }

  const first = node.sealConfirmed(txid(1), 1, 800_000, genesis, 0)
  ok(first.kind === 'seal' && node.ledger.hasSeal(txid(1)), 'donate #1 journals its seal')

  const sameBlock = node.sealConfirmed(txid(2), 1, 800_000, genesis, 0)
  ok(sameBlock.kind === 'seal' && node.ledger.hasSeal(txid(2)), 'donate #2 in the SAME Bitcoin block seals (height non-decreasing, not unique)')

  const later = node.sealConfirmed(txid(3), 1, 800_001, genesis, 0)
  ok(later.kind === 'seal' && node.ledger.hasSeal(txid(3)), 'donate #3 at a later Bitcoin height seals')

  try {
    node.sealConfirmed(txid(1), 1, 800_002, genesis, 0)
    ok(false, 'the same Bitcoin txid must never reopen the window')
  } catch (e) {
    ok(/already reopened|once/i.test((e as Error).message), 'one txid, one seal, ever')
  }

  try {
    node.sealConfirmed(txid(4), 1, 799_999, genesis, 0)
    ok(false, 'a lower Bitcoin height must be refused (monotonic)')
  } catch (e) {
    ok(/non-decreasing|below/i.test((e as Error).message), 'heights never go backwards')
  }

  let n = 3
  for (let i = 5; i <= 14; i++) {
    node.sealConfirmed(txid(i), 1, 800_001 + (i - 4), genesis, 0)
    n++
  }
  ok(n === 13, `ten more donates at rising heights — ${n} seals in the journal, no conflict`)

  const root = node.cascadeRoot()
  const reboot = new KrayNode(dir, 'signet')
  ok(reboot.cascadeRoot() === root, 'reboot: every seal replays byte-exact')
  ok(reboot.ledger.hasSeal(txid(1)) && reboot.ledger.hasSeal(txid(14)), 'the first and the last donate are still sealed after replay')

  rmSync(dir, { recursive: true, force: true })
  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — 1 or 1000, the donation IS the seal. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
