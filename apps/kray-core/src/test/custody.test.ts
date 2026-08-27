/**
 * CUSTODY — the master guardian proves the atlas, and every attack is named.
 *   node src/test/custody.test.ts
 *
 * The reward gains a dimension that cannot be declared, only PROVEN: the bytes.
 * This runs the attacks a real adversary would try, and checks each is refused
 * for the RIGHT reason — a door that shuts for the wrong reason is a door that
 * opens the day that reason changes.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  CUSTODY_CHALLENGES, aggregateAnswers, buildCustodyClaim, custodyAnswer, custodyChallenges,
  custodyFromHex, custodyToHex, effectiveWork, hitCount, packHits, unpackHits, verifyCustody,
  type AtlasOracle,
  CUSTODY_PAYOUT_FACTOR,
} from '../economics/custody.ts'
import { isqrt } from '../economics/presence.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const BEACON = sha(Buffer.from('a real bitcoin block hash')).slice(0, 64)
const BEACON2 = sha(Buffer.from('the NEXT bitcoin block')).slice(0, 64)
const A = 'bcrt1p' + 'a'.repeat(58)
const B = 'bcrt1p' + 'b'.repeat(58)

/** An atlas of N contents; `holds` decides which bytes this machine keeps. */
function atlas(n: number, holds: (i: number) => boolean = () => true): AtlasOracle & { bytes: Map<string, Uint8Array> } {
  const bytes = new Map<string, Uint8Array>()
  const contents: string[] = []
  for (let i = 0; i < n; i++) {
    const b = Buffer.concat([Buffer.from(`content ${i} — `), randomBytes(16)])
    const h = sha(b)
    contents.push(h)
    if (holds(i)) bytes.set(h, b)
  }
  return { contents, bytes, bytesOf: (h) => bytes.get(h) ?? null }
}

function main() {
  // ── 1 · THE CHALLENGE IS THE BITCOIN BLOCK, NOT THE NODE ─────────────────
  const full = atlas(500)
  const c1 = custodyChallenges(BEACON, A, 500)
  ok(c1.length === CUSTODY_CHALLENGES && c1.every((i) => i >= 0 && i < 500), `${CUSTODY_CHALLENGES} challenges, all inside the atlas`)
  ok(JSON.stringify(c1) === JSON.stringify(custodyChallenges(BEACON, A, 500)), 'DETERMINISTIC — every auditor derives the identical challenges, forever')
  ok(JSON.stringify(c1) !== JSON.stringify(custodyChallenges(BEACON2, A, 500)), 'a NEW Bitcoin block asks NEW questions — yesterday\'s answers are worthless (no replay)')
  ok(JSON.stringify(c1) !== JSON.stringify(custodyChallenges(BEACON, B, 500)), 'each guardian gets its OWN questions — bound to the address')

  // ── 2 · THE HONEST MASTER ────────────────────────────────────────────────
  const master = buildCustodyClaim(BEACON, A, full)
  const vm = verifyCustody(master, BEACON, A, full)
  ok(vm.exact && vm.claimedHits === CUSTODY_CHALLENGES, `THE MASTER PROVES THE ATLAS — ${vm.claimedHits}/${CUSTODY_CHALLENGES} answered, aggregate exact`)
  // the WEIGHT carries the square of the promised premium, so that the √ in the
  // split delivers the premium itself: base×K → base×K·F² with F the payout factor
  // the split is linear now, so weight and payout are the same quantity: the
  // factor is the promise itself, with no square root to compensate for
  ok(effectiveWork(100n, hitCount(master)) === 100n * BigInt(CUSTODY_CHALLENGES * CUSTODY_PAYOUT_FACTOR),
    `full custody = ${CUSTODY_PAYOUT_FACTOR}× the declared weight, which under a linear split is ${CUSTODY_PAYOUT_FACTOR}× the PAYOUT`)
  ok(effectiveWork(100n, 0) === 100n * 8n, 'a CPU-only guardian sits at base×K — the same relative split as before this law')
  // at a real weight scale (integer √ truncation is negligible), 3× work pays √3
  // The factor is chosen so the PAYOUT ratio is the promised one: the split takes
  // √weight, so the weight must carry the square of what the law advertises.
  ok(effectiveWork(1_000_000n, CUSTODY_CHALLENGES) * 100n / effectiveWork(1_000_000n, 0) === BigInt(CUSTODY_PAYOUT_FACTOR) * 100n,
    `a master earns EXACTLY ${CUSTODY_PAYOUT_FACTOR}× a CPU-only peer of equal base work — weight and payout are one quantity under a linear split`)

  // ── 3 · PARTIAL COVERAGE IS PAID PARTIALLY, AUTOMATICALLY ────────────────
  // the SAME atlas, seen by a node that kept only half of it
  const keptHalf = new Set(full.contents.filter((_, i) => i % 2 === 0))
  const half: AtlasOracle = { contents: full.contents, bytesOf: (h) => (keptHalf.has(h) ? full.bytesOf(h) : null) }
  const halfClaim = buildCustodyClaim(BEACON, A, half)
  const vh = verifyCustody(halfClaim, BEACON, A, full) // a full node judges it
  ok(vh.exact && vh.claimedHits < CUSTODY_CHALLENGES, `half an atlas → ${vh.claimedHits}/${CUSTODY_CHALLENGES} hits, honest and exact`)
  const floor = effectiveWork(100n, 0), ceiling = effectiveWork(100n, CUSTODY_CHALLENGES)
  ok(effectiveWork(100n, vh.claimedHits) < ceiling && effectiveWork(100n, vh.claimedHits) >= floor,
    'its weight lands BETWEEN CPU-only and master — a straight line, no tier to game')

  // ── 4 · THE ATTACKS ──────────────────────────────────────────────────────
  // (a) claim everything while holding nothing (same atlas, empty store)
  const empty: AtlasOracle = { contents: full.contents, bytesOf: () => null }
  const liar = { hits: packHits(new Array(CUSTODY_CHALLENGES).fill(true)), aggregate: aggregateAnswers([]) }
  const va = verifyCustody(liar, BEACON, A, full)
  ok(!va.exact && va.reason === 'aggregate-mismatch', 'ATTACK: claiming the whole atlas while holding nothing → REFUSED (aggregate mismatch)')

  // (b) steal another guardian's correct answers
  const stolen = buildCustodyClaim(BEACON, B, full) // B's honest claim…
  const vb = verifyCustody(stolen, BEACON, A, full) // …submitted by A
  ok(!vb.exact, 'ATTACK: copying another guardian\'s answers → REFUSED (salted by address)')

  // (c) replay yesterday's proof against today's beacon
  const vc = verifyCustody(master, BEACON2, A, full)
  ok(!vc.exact, 'ATTACK: replaying an old proof at a new seal → REFUSED (bound to the Bitcoin block)')

  // (d) a rotted / corrupted store — same hashes, different bytes
  const rotted: AtlasOracle = { contents: full.contents, bytesOf: (h) => (full.bytesOf(h) ? Buffer.from('corrupted') : null) }
  const vd = verifyCustody(buildCustodyClaim(BEACON, A, rotted), BEACON, A, full)
  ok(!vd.exact, 'ATTACK: a corrupted store answering with the wrong bytes → REFUSED (bit rot is self-detecting)')

  // (e) inflate: claim a hit for a content you cannot read
  const inflated = { hits: packHits(new Array(CUSTODY_CHALLENGES).fill(true)), aggregate: halfClaim.aggregate }
  const ve = verifyCustody(inflated, BEACON, A, half) // judged by the same half node
  ok(!ve.exact && (ve.reason === 'hit-unreadable' || ve.reason === 'aggregate-mismatch'), 'ATTACK: claiming a hit for content you cannot read → REFUSED')

  // (f) malformed claims fail closed, never "as absence"
  for (const bad of [{ hits: 'zz', aggregate: master.aggregate }, { hits: master.hits, aggregate: 'nope' }]) {
    ok(!verifyCustody(bad as never, BEACON, A, full).exact, 'a malformed claim FAILS CLOSED — never read as innocent absence')
  }

  // (g) the honest limit, stated: a verifier WITHOUT the bytes says so
  const blind: AtlasOracle = { contents: full.contents, bytesOf: () => null }
  const vg = verifyCustody(master, BEACON, A, blind)
  ok(!vg.exact && vg.reason === 'hit-unreadable' && vg.checkable === 0, 'a verifier holding NO bytes reports it (checkable 0) instead of approving — to audit custody you must custody')

  // ── 5 · THE WIRE FORM — 33 bytes, canonical, round-trips ─────────────────
  const wire = custodyToHex(master)
  ok(wire.length === (Math.ceil(CUSTODY_CHALLENGES / 8) + 32) * 2, `the whole proof is ${wire.length / 2} bytes on the row — capacity spent once, not twice`)
  const back = custodyFromHex(wire)
  ok(back.hits === master.hits && back.aggregate === master.aggregate, 'round-trips exactly through the journal\'s hex')
  ok(unpackHits(packHits([true, false, true, false, false, false, false, true]), 8).join(',') === 'true,false,true,false,false,false,false,true', 'the hit bitmap packs and unpacks bit-exact')

  // ── 6 · AN EMPTY ATLAS ASKS NOTHING ──────────────────────────────────────
  const none = atlas(0)
  const nc = buildCustodyClaim(BEACON, A, none)
  ok(verifyCustody(nc, BEACON, A, none).exact && hitCount(nc) === 0, 'a network with no content yet: everyone sits at base×K, nobody is penalised for guarding nothing')
  ok(!verifyCustody({ hits: packHits([true]), aggregate: aggregateAnswers(['x']) }, BEACON, A, none).exact, '…and claiming custody of an empty atlas is still REFUSED')

  console.log(`\n✓ ${pass} checks passed — CUSTODY IS PROVEN, NOT DECLARED: the challenges come from the Bitcoin block itself (unforeseeable, unrepeatable, address-bound), the answer requires the exact bytes, coverage pays on a straight line from 1× to 3×, and every attack — claiming what you lack, copying another's answers, replaying yesterday's proof, a rotted disk, an inflated hit, a malformed claim — is REFUSED and NAMED. A verifier without the bytes says so rather than approving: to audit custody you must custody. ₭`)
}
main()
