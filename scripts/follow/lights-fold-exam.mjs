// ── LIGHTS FOLD EXAM — Ӿ / Nyx / Fenyx / ✦ glow re-derive from a replayed ledger ──
//
// No writer, no network. A mock node + two freeze acts must produce the same books a
// stranger folds after replay. Exit 0 = the shared view is wired. Exit 1 = drift.

import { lightsView, rankBooksView, blackHoleBooksView } from '../../apps/kray-net/state-views.mjs'
import { BLACK_HOLE } from '../../apps/kray-core/src/protocol/kray-primitives.ts'
import { FIREBORN_SENDS_PER_KRAY } from '../../apps/kray-core/src/protocol/ledger.ts'
import { GLOW_SYMBOL } from '../../apps/kray-core/src/economics/glow-star.ts'

let fail = 0
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++ }

const events = [
  { kind: 'inscribe', from: 'tb1qalice', star: 1, amount: '1', at: 1, hash: 'aa' },
  { kind: 'transfer-star', to: BLACK_HOLE, from: 'tb1qalice', star: 1, at: 2, hash: 'bb' },
  { kind: 'transfer-star', to: BLACK_HOLE, from: 'tb1qalice', star: 2, at: 3, hash: 'cc' },
  { kind: 'burn', from: 'tb1qalice', amount: '2', at: 4, hash: 'dd' },
]

const node = {
  network: 'signet',
  seq: 4,
  cascadeRoot: () => 'ab'.repeat(32),
  supply: () => ({ emitted: 10n, burned: 5n, circulating: 5n }),
  pot: () => ({ held: 0n, target: 1n, deficit: 1n, donated: 0n, spent: 0n, minted: 0n, open: true }),
  star: (no) => ({
    no, owner: BLACK_HOLE, by: 'tb1qalice', name: null, contentHash: null,
    contentType: null, rarity: 'common', size: 0,
  }),
  ledger: {
    xBooks: () => [{ address: 'tb1qalice', minted: 5n, spendable: 3n, lane: 2n, tank: 4999n }],
    totalBurned: 5n,
    xEmitted: 5n,
    conserves: () => true,
    backed: () => true,
    thawHasRun: true,
    balances: new Map([['tb1qalice', 5n], [BLACK_HOLE, 0n]]),
    stars: {
      starCount: 2,
      inscriptions: () => [],
      baptisms: () => [],
      starsOf: (a) => (a === BLACK_HOLE ? [1n, 2n] : []),
    },
  },
}

console.log('\nlights-fold-exam — Nyx / Fenyx / glow from bytes\n')

const lights = lightsView({ node, events, top: null })
ok(lights.glow.symbol === GLOW_SYMBOL && lights.glow.total === 2 && lights.glow.holders === 1, `✦ glow = ${lights.glow.total} on ${lights.glow.holders} address`)
ok(lights.x.symbol === 'Ӿ' && lights.x.name === 'Nyx' && lights.x.hybrid === 'Fenyx', 'Ӿ is named Nyx; hybrid is Fenyx')
ok(lights.x.total === '5' && lights.x.totalSpendable === '3' && lights.x.totalLane === '2', `Ӿ books spendable=${lights.x.totalSpendable} lane=${lights.x.totalLane}`)
ok(lights.x.tankBudget === (5n * FIREBORN_SENDS_PER_KRAY).toString(), `Fireborn tank budget = burned × ${FIREBORN_SENDS_PER_KRAY}`)
ok(lights.conservation.ok === true && lights.conservation.xMinted === '5', 'conservation tripwire holds on the fold')

const books = rankBooksView({ node, events, network: 'signet' })
ok(books.lights.x.name === 'Nyx' && books.rank.length === 1 && books.rank[0].glow === '2', 'rank books carry ₭ standing + glow 2')
ok(books.chain.cascadeRoot === node.cascadeRoot() && books.work.local === true, 'cascadeRoot is local; beat-work is not invented')

const hole = blackHoleBooksView({ node, events })
ok(hole.stars === 2 && hole.frozen.length === 2 && hole.fire.into.sporadic === '2', `black hole: ${hole.stars} frozen, sporadic burn ${hole.fire.into.sporadic}`)

console.log(fail ? `\nFAIL — ${fail} check(s) failed\n` : '\nPASS — a stranger folds Ӿ / Nyx / Fenyx / ✦ from the journal alone\n')
process.exit(fail ? 1 : 0)
