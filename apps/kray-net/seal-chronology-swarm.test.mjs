/**
 * SEAL CHRONOLOGY SWARM — every shape of Bitcoin seal, one clock.
 *   node apps/kray-net/seal-chronology-swarm.test.mjs
 *
 * Attacks the door sort + the constellation paint + the born-strict reducer
 * with 1000 mixed anchors (donate, operator, guardian, junk, duplicates,
 * same height, reversed arrival). The train holds or this fails.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KrayNode } from '../kray-core/src/protocol/node.ts'
import { considerSeal, sortPendingSeals, donateSealAt, paintCube } from './seal-chronology.mjs'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

const txid = (tag) => createHash('sha256').update('seal-chrono|' + tag).digest('hex')
const root = (tag) => createHash('sha256').update('seal-root|' + tag).digest('hex')
const shuffle = (arr, seed) => {
  const out = arr.slice()
  let x = seed >>> 0
  for (let i = out.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    const j = x % (i + 1)
    const t = out[i]; out[i] = out[j]; out[j] = t
  }
  return out
}

function main() {
  console.log('\n╔═ SEAL CHRONOLOGY SWARM — Bitcoin height is the only clock ═╗\n')

  ok(considerSeal('nope', 1, root(1), 0) === null, 'a short txid is not a seal')
  ok(considerSeal(txid(1), 0, root(1), 0) === null, 'height 0 is not a seal')
  ok(considerSeal(txid(1), 1.5, root(1), 0) === null, 'a fractional height is not a seal')
  ok(considerSeal(txid(1), 100, 'zz', 0) === null, 'a non-hex root is not a seal')
  ok(!!considerSeal(txid(1), 100, root(1), 7), 'a complete row is a seal')

  const honest = []
  for (let i = 0; i < 1000; i++) {
    honest.push(considerSeal(txid('h' + i), 700_000 + Math.floor(i / 3), root('h' + i), i % 40))
  }
  const junk = [
    considerSeal('short', 800_000, root('j1'), 1),
    considerSeal(txid('j2'), -1, root('j2'), 1),
    considerSeal(txid('j3'), 800_000, 'not-a-root', 1),
    null,
    considerSeal(txid('h0'), 700_000, root('dup-same-txid'), 99),
  ]
  const mixed = honest.concat(junk)
  const orders = [0, 1, 7, 99, 12345, 999_999].map((s) => sortPendingSeals(shuffle(mixed, s)))
  const key = (rows) => rows.map((r) => r.txid + '@' + r.height + '#' + r.blockNumber).join('|')
  ok(orders.every((r) => r.length === 1000), 'junk and the duplicate txid drop — 1000 honest seals remain')
  ok(orders.every((r) => key(r) === key(orders[0])), 'every shuffle of the same set sorts to the same chronology')
  ok(orders[0].every((r, i) => i === 0 || r.height > orders[0][i - 1].height || (r.height === orders[0][i - 1].height && (r.blockNumber > orders[0][i - 1].blockNumber || (r.blockNumber === orders[0][i - 1].blockNumber && r.txid >= orders[0][i - 1].txid)))), 'sorted: height, then block, then txid — never backwards')

  const dir = join(tmpdir(), `kraynet-seal-chrono-${process.pid}`)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const node = new KrayNode(dir, 'signet')
  const genesis = node.cascadeRoot()

  const reversed = honest.slice().sort((a, b) => b.height - a.height || b.blockNumber - a.blockNumber)
  try {
    node.sealConfirmed(reversed[0].txid, 1, reversed[0].height, genesis, reversed[0].blockNumber)
    const late = reversed[reversed.length - 1]
    try {
      node.sealConfirmed(late.txid, 1, late.height, genesis, late.blockNumber)
      ok(false, 'an unsorted late lower height must be refused')
    } catch (e) {
      ok(/non-decreasing|below/i.test((e instanceof Error ? e.message : String(e))), 'unsorted arrival: a lower Bitcoin height after a higher one is refused — the sort is load-bearing')
    }
  } catch (e) {
    ok(false, 'first reversed seal should land — ' + (e instanceof Error ? e.message : e))
  }

  const dir2 = join(tmpdir(), `kraynet-seal-chrono-ok-${process.pid}`)
  rmSync(dir2, { recursive: true, force: true }); mkdirSync(dir2, { recursive: true })
  const live = new KrayNode(dir2, 'signet')
  const g2 = live.cascadeRoot()
  const sorted = sortPendingSeals(shuffle(honest, 42))
  const journaled = sorted.slice(0, 128)
  let sealed = 0
  for (const p of journaled) {
    live.sealConfirmed(p.txid, 1, p.height, g2, p.blockNumber)
    sealed++
  }
  ok(sorted.length === 1000 && sealed === 128 && live.ledger.hasSeal(journaled[0].txid) && live.ledger.hasSeal(journaled[127].txid), '1000-set sorts; 128 donates journal in that order — first and last present')
  const after = live.cascadeRoot()
  const reboot = new KrayNode(dir2, 'signet')
  ok(reboot.cascadeRoot() === after, 'reboot: the journaled chronology replays byte-exact')

  try {
    live.sealConfirmed(sorted[0].txid, 1, sorted[999].height + 1, g2, 0)
    ok(false, 'the same txid must never reopen')
  } catch (e) {
    ok(/already reopened|once/i.test((e instanceof Error ? e.message : String(e))), 'one Bitcoin txid, one seal, ever')
  }

  const donate = { blockNumber: 32, txid: txid('donate-32'), selfAnchor: true }
  const anchors = new Map([
    [31, { txid: donate.txid, selfAnchor: false, verified: true }],
    [32, { txid: donate.txid, selfAnchor: true, verified: true }],
  ])
  ok(donateSealAt([donate], anchors, 32) === donate, 'donateSealAt names the cube the burn committed')
  ok(donateSealAt([donate], anchors, 31) === null, 'a cascade-covered cube is not a donate')
  ok(donateSealAt([], anchors, 32)?.selfAnchor === true, 'the anchor map still names a self-anchor cube')

  const cubes = []
  for (let h = 20; h <= 36; h++) {
    const isDonate = h === 32
    const covered = h <= 32
    cubes.push(paintCube({
      h,
      selfAnchor: !!donateSealAt([donate], anchors, h),
      verified: covered,
      simulated: false,
      anchored: covered,
      txid: covered ? donate.txid : null,
    }))
  }
  ok(cubes.every((c, i) => {
    const h = 20 + i
    if (h === 32) return c.donateGold && !c.cascadeGold
    if (h < 32) return c.cascadeGold && !c.donate
    return c.pending && !c.sealed
  }), 'paint follows the book: donate-gold only at the burn cube, cascade gold before it, pending after')
  ok(paintCube({ verified: false, anchored: true, txid: txid('seen'), selfAnchor: false }).seen, 'a broadcast covering tx that is not yet buried is seen, not gold')

  rmSync(dir, { recursive: true, force: true })
  rmSync(dir2, { recursive: true, force: true })
  console.log(fail
    ? `\n╚═ FAIL ${fail}/${pass + fail} — the clock slipped.\n`
    : `\n╚═ ${pass}/${pass + fail} — 1 or 1000, height order, one txid, donate-gold only where the burn was born. ⛓₭\n`)
  if (fail) process.exit(1)
}
main()
