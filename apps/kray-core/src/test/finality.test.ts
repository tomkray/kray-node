/**
 * ADR-4 · slice 4a — THE TWO FINALITIES, pinned.
 *
 * Crane-finality (canonical-by-replay, the only "final") and anchor-confidence (probabilistic burial depth,
 * top tier `deep`, never "final") are two different facts. This proves the pure classifier is TOTAL (never
 * throws on a hostile depth), that duplicated/forged anchors cannot inflate a tier, that a reorg that
 * un-buries an anchor drops confidence while crane stands unchanged, and that the word "final" lives ONLY
 * under crane.
 *
 *   node src/test/finality.test.ts
 */
import { anchorTier, anchorConfidence, craneFinality, finalityView } from '../protocol/finality.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const noThrow = (fn: () => void, m: string) => { try { fn(); ok(true, m) } catch (e) { ok(false, m + ' — threw: ' + (e as Error).message) } }

const SIGNET = { confirmed: 2, deep: 100, net: 'signet' }
const MAIN = { confirmed: 6, deep: 100, net: 'main' }
const REGTEST = { confirmed: 1, deep: 100, net: 'regtest' }

console.log('\n╔═ THE TWO FINALITIES — crane is final-by-replay; the anchor is only ever buried ═╗\n')

// ── 1 · crane-finality is unconditional, pure, and deterministic ─────────────
console.log('─ 1 · crane-finality: the one place "final" is earned ─')
ok(eq(craneFinality('abc', 42), { final: true, basis: 'replay', root: 'abc', seq: 42 }), 'craneFinality(root, seq) = { final:true, basis:"replay", root, seq } — a pure identity')
ok(eq(craneFinality('abc', 42), craneFinality('abc', 42)), 'deterministic — same bytes, same object, no Bitcoin input')
ok(craneFinality('x', 5.9).seq === 5 && craneFinality('x', NaN as unknown as number).seq === 0, 'seq is totalized (5.9 → 5, NaN → 0) — never a fractional or junk height')

// ── 2 · the tier bands, exact, at the network's own thresholds ───────────────
console.log('\n─ 2 · anchor tiers band by burial depth (signet: confirmed 2, deep 100) ─')
ok(anchorTier(0, SIGNET) === 'none', 'depth 0 → none (nothing witnessed)')
ok(anchorTier(1, SIGNET) === 'seen', 'depth 1 → seen (in a block, below the verified floor)')
ok(anchorTier(2, SIGNET) === 'confirmed', 'depth 2 → confirmed (at the verified floor)')
ok(anchorTier(99, SIGNET) === 'confirmed', 'depth 99 → confirmed (buried, not yet past ANCHOR_FINAL)')
ok(anchorTier(100, SIGNET) === 'deep', 'depth 100 → deep (past the watch floor)')
ok(anchorTier(101, SIGNET) === 'deep', 'depth 101 → deep')

// ── 3 · tiers are PER-NETWORK, not a magic constant ──────────────────────────
console.log('\n─ 3 · the same depth means different things on different networks ─')
ok(anchorTier(2, SIGNET) === 'confirmed' && anchorTier(2, MAIN) === 'seen', 'depth 2 is "confirmed" on signet but only "seen" on main — the floor is per-network')
ok(anchorTier(5, MAIN) === 'seen' && anchorTier(6, MAIN) === 'confirmed', 'main boundary is exact: depth 5 → seen, depth 6 → confirmed')
ok(anchorTier(1, REGTEST) === 'confirmed', 'regtest floor is 1: depth 1 → confirmed (self-mined seals)')

// ── 4 · HOSTILE depth can never fabricate a tier (totality) ──────────────────
console.log('\n─ 4 · a hostile depth clamps to "none" — it never inflates ─')
for (const bad of [NaN, -1, Infinity, -Infinity, '5' as unknown as number, null as unknown as number, undefined as unknown as number]) {
  ok(anchorTier(bad, SIGNET) === 'none', `anchorTier(${String(bad)}) → none (a junk depth witnesses nothing)`)
}
ok(anchorTier(1.9, SIGNET) === 'seen', 'depth 1.9 floors to 1 → seen (never rounds up into a higher tier)')

// ── 5 · a misconfigured deep < confirmed never throws, never inverts ─────────
console.log('\n─ 5 · deep is normalized ≥ confirmed — an operator KRAY_ANCHOR_FINAL=1 cannot break /api ─')
noThrow(() => anchorTier(6, { confirmed: 6, deep: 1, net: 'main' }), 'anchorTier(6, {confirmed:6, deep:1}) does not throw on the hot path')
ok(anchorTier(6, { confirmed: 6, deep: 1, net: 'main' }) === 'deep', 'deep clamps up to confirmed (6): depth 6 → deep, ladder never inverts')
{
  const c = anchorConfidence({ depth: 6, anchoredRoot: 'r', anchoredHeight: 3, provenAnchors: 1 }, { confirmed: 6, deep: 1, net: 'main' })
  ok(c.thresholds.deep === 6, 'the echoed thresholds are normalized (deep = 6), so any reader audits the real boundary')
}

// ── 6 · duplicated / forged anchors weigh nothing ────────────────────────────
console.log('\n─ 6 · only real burial counts — dup/forge cannot inflate ─')
{
  const c = anchorConfidence({ depth: 2, anchoredRoot: 'r', anchoredHeight: 3, provenAnchors: 5 }, SIGNET)
  ok(c.tier === 'confirmed' && c.depth === 2, 'provenAnchors 5 at depth 2 → tier follows DEPTH (2 → confirmed), not the count — a copied anchor is not a buried one')
}
{
  const c = anchorConfidence({ depth: 0, anchoredRoot: 'a-lie', anchoredHeight: 9, provenAnchors: 0 }, MAIN)
  ok(c.tier === 'none' && c.anchoredRoot === null && c.anchoredHeight === null, 'nothing proven (provenAnchors 0) → none, and the claimed root/height are nulled — a forged anchor proves nothing')
}
{
  const c = anchorConfidence({ depth: 0, anchoredRoot: 'a-lie', anchoredHeight: 9, provenAnchors: 3 }, MAIN)
  ok(c.tier === 'none' && c.anchoredRoot === null, 'anchors present but depth 0 (in mempool) → none, root nulled')
}

// ── 7 · a reorg un-buries an anchor: confidence drops, CRANE stands ──────────
console.log('\n─ 7 · a reorg drops anchor-confidence but never touches crane-finality ─')
{
  const crane = craneFinality('root7', 7)
  const buried = anchorConfidence({ depth: 8, anchoredRoot: 'root7', anchoredHeight: 7, provenAnchors: 1 }, MAIN)
  const shallow = anchorConfidence({ depth: 1, anchoredRoot: 'root7', anchoredHeight: 7, provenAnchors: 1 }, MAIN)
  const gone = anchorConfidence({ depth: 0, anchoredRoot: null, anchoredHeight: null, provenAnchors: 0 }, MAIN)
  ok(buried.tier === 'confirmed' && shallow.tier === 'seen' && gone.tier === 'none', 'depth 8 → confirmed, un-buried to 1 → seen, to 0 → none: the tier drops with the burial')
  ok(eq(craneFinality('root7', 7), crane), 'crane-finality is IDENTICAL through all three — the journal never moved, so replay-canonicality never moved')
}

// ── 8 · "final" means EXACTLY one thing (da Vinci law) ───────────────────────
console.log('\n─ 8 · the word "final" lives ONLY under crane ─')
{
  const f = finalityView('root9', 9, { depth: 8, anchoredRoot: 'root9', anchoredHeight: 9, provenAnchors: 1 }, MAIN)
  ok(f.crane.final === true && f.crane.basis === 'replay', 'crane carries final:true, scoped by basis:"replay" right beside it')
  ok(!JSON.stringify(f.anchor).includes('final'), 'the emitted anchor object contains NO substring "final" — the top tier is "deep"')
  ok((JSON.stringify(f).match(/final/g) || []).length === 1, 'across the whole finality view, "final" appears exactly once — the crane key')
  ok(f.crane.root === 'root9' && f.crane.seq === 9, 'crane mirrors the tip (root/seq) — the /api head guarantee that finality.crane.root === cascadeRoot')
}

console.log(`\n╚═ ${pass} passed${fail ? ', ' + fail + ' FAILED' : ''} — crane is final-by-replay; the anchor is only ever buried; a reorg names its transition, never undefined behavior. ⚓₭\n`)
process.exit(fail ? 1 : 0)
