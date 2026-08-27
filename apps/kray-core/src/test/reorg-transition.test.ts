/**
 * ADR-4 · slice 4b — THE REORG TRANSITION, named and pinned.
 *
 * A Bitcoin reorg that un-buries an ANCHOR (the tx that committed a cascade root) is an EXPLICIT transition,
 * never undefined behavior: it lowers anchor-confidence and NOTHING else. Execution is NOT reverted — the
 * journal and its replay stand, because the ledger's root/supply/balances are a pure function of the journal
 * alone and never took the anchor as an input. Crane-finality (canonical-by-replay) is therefore invariant
 * across the reorg; only the probabilistic anchor tier drops (confirmed → seen → none) as the burial recedes.
 *
 * SCOPE: this is the ANCHOR-DEMOTE reorg (Lamport's self-loop on crane, tier-drop on anchor). The server
 * already performs it (server.mjs refreshAnchor: "DEMOTED (reorg/eviction)" mutates only the anchors Map,
 * never the ledger). This test proves the invariant the transition rests on. The DIFFERENT reorg — one that
 * un-buries a donation's own BURN tx, which fails ADR-1 re-verification and un-mints on replay — is slice 4c.
 *
 *   node src/test/reorg-transition.test.ts
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { KrayNode } from '../protocol/node.ts'
import { craneFinality, anchorConfidence, finalityView } from '../protocol/finality.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const supplyOf = (n: KrayNode) => { const s = n.supply(); return `${s.emitted}|${s.burned}|${s.circulating}` }

const NET = 'regtest'
const MAIN = { confirmed: 6, deep: 100, net: 'main' }   // classify against main's thresholds (the strict case)
const A = 'bcrt1pq3s93slfa5exrvjknnulw6s6hj024a2294t26e7ga9qal8vl75lqy8qj9p'
const B = 'bcrt1pc9u6kpmgue4c3pyexa9erld2c8s26rl0nv5z2cgsgxzuluten0cs5vduyq'

console.log('\n╔═ THE REORG TRANSITION — an un-buried anchor drops confidence, never execution ══╗\n')

const dir = join(tmpdir(), `kraynet-reorg-4b-${process.pid}`)
rmSync(dir, { recursive: true, force: true })

// ── build a real journal: two donations mint ₭ into real accounts — real execution on disk ──
const node = new KrayNode(dir, NET)
node.donate(A, 5000n)
node.donate(B, 3000n)
const R = node.cascadeRoot()
const S = supplyOf(node)
const balA = node.balanceOf(A).toString()
const balB = node.balanceOf(B).toString()
const circ0 = node.supply().circulating
const seq = node.seq
console.log(`─ 0 · a real journal exists: root ${R.slice(0, 16)}…, supply circulating locked in, seq ${seq} ─`)
ok(circ0 === 8000n && balA === '5000' && balB === '3000', 'execution ran: 5000 + 3000 minted 1:1 into A and B — a real journal with real balances')

// ── 1 · the anchor is buried deep — anchor-confidence is high, crane is final-by-replay ──
console.log('\n─ 1 · buried anchor: confidence "confirmed", crane "final" ─')
const craneBefore = craneFinality(R, seq)
const buried = finalityView(R, seq, { depth: 10, anchoredRoot: R, anchoredHeight: seq, provenAnchors: 1 }, MAIN)
ok(buried.anchor.tier === 'confirmed', 'depth 10 on main → anchor tier "confirmed"')
ok(buried.crane.final === true && buried.crane.root === R, 'crane is final-by-replay, mirroring the tip root')

// ── 2 · THE REORG un-buries the anchor: confidence drops, EXECUTION IS UNTOUCHED ──
console.log('\n─ 2 · a reorg recedes the burial: 10 → 1 → 0 conf ─')
const shallow = finalityView(R, seq, { depth: 1, anchoredRoot: R, anchoredHeight: seq, provenAnchors: 1 }, MAIN)
const evicted = finalityView(R, seq, { depth: 0, anchoredRoot: null, anchoredHeight: null, provenAnchors: 0 }, MAIN)
ok(shallow.anchor.tier === 'seen', 'un-buried to depth 1 → tier drops to "seen"')
ok(evicted.anchor.tier === 'none', 'fully evicted (depth 0, nothing proven) → tier drops to "none"')
// the ledger NEVER saw the anchor — its root/supply/balances cannot have moved
ok(node.cascadeRoot() === R, 'the cascade root is IDENTICAL after the reorg — execution was not reverted')
ok(supplyOf(node) === S, 'supply is IDENTICAL — the reorg minted nothing and burned nothing')
ok(node.balanceOf(A).toString() === balA && node.balanceOf(B).toString() === balB, 'every balance is IDENTICAL — a reorg is not a transaction')

// ── 3 · crane-finality is invariant across the whole reorg (the journal never moved) ──
console.log('\n─ 3 · crane-finality never regresses — the two facts are independent ─')
ok(eq(buried.crane, craneBefore) && eq(shallow.crane, craneBefore) && eq(evicted.crane, craneBefore), 'crane-finality is byte-identical at depth 10, 1, and 0 — only the anchor half changed')
ok(buried.anchor.tier !== shallow.anchor.tier && shallow.anchor.tier !== evicted.anchor.tier, 'only anchor-confidence moved — confirmed → seen → none — a NAMED transition, not undefined behavior')

// ── 4 · replay after the reorg re-derives the identical root (execution ⊥ anchor status) ──
console.log('\n─ 4 · a cold replay after the reorg yields the identical root ─')
const node2 = new KrayNode(dir, NET)   // constructor replays the durable journal
ok(node2.cascadeRoot() === R, 'the restarted node re-derives the SAME root from the journal — the anchor status lives nowhere in it')
ok(supplyOf(node2) === S, 'and the SAME supply — replay is a pure function of the journal, blind to Bitcoin burial')

// ── 5 · HOSTILE — a reorg cannot RAISE confidence, and eviction never un-mints ──
console.log('\n─ 5 · a forged re-burial weighs nothing; eviction never claws back a mint ─')
const forgedReburial = anchorConfidence({ depth: 50, anchoredRoot: R, anchoredHeight: seq, provenAnchors: 0 }, MAIN)
ok(forgedReburial.tier === 'none', 'a claimed depth 50 with provenAnchors 0 (forged re-burial) → still "none": only real, proven burial raises the tier')
ok(node.supply().circulating === circ0, 'through demotion and eviction the mint SURVIVES — an un-buried ANCHOR does not un-mint (that is the burn-tx reorg, slice 4c)')

rmSync(dir, { recursive: true, force: true })
console.log(`\n╚═ ${pass} passed${fail ? ', ' + fail + ' FAILED' : ''} — a reorg drops anchor-confidence and nothing else; execution and crane-finality stand, byte-exact, through it. ⚓₭\n`)
process.exit(fail ? 1 : 0)
