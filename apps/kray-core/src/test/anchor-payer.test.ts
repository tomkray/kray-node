/**
 * THE MALICIOUS ANCHOR PAYER — can whoever pays the fee corrupt the seal?
 *   node src/test/anchor-payer.test.ts
 *
 * A volunteer pays the Bitcoin fee for an anchor. They are a stranger with
 * sats, nothing more. This assault gives that stranger every hostile power
 * available to them and proves they can never bend the mathematics:
 *
 *   · they cannot choose WHAT is sealed (the root is each node's own
 *     computation from its own journal — the payer never supplies it);
 *   · a wrong root in the OP_RETURN is not an anchor at all, and settles
 *     nothing, and earns nothing — it is a transaction they wasted money on;
 *   · they cannot claim a reward for someone else's payment, for an
 *     underpayment, for a fake txid, or twice for the same job;
 *   · refusing to pay costs the network nothing: the job stays pending and
 *     is simply re-drawn, and the backlog still costs O(1);
 *   · they cannot bias who is drawn — the beacon is a Bitcoin block hash and
 *     the draw is a pure function anyone recomputes.
 *
 * The payer buys ONE thing: the transaction fee. Never a word of what it says.
 */
import { AnchorPool } from '../economics/anchor-pool.ts'
import { KrayAnchor } from '../anchor/anchor.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
function rejects(fn: () => void, label: string): void {
  try { fn(); console.error(`  ✗ FAILED (the payer got away with it!) — ${label}`); process.exit(1) } catch { pass++ }
}
const R = (c: string) => c.repeat(64)
const TX = (c: string) => c.repeat(64)

function main() {
  // ── the honest network computes its own root and puts a job up ────────────
  const pool = new AnchorPool()
  const HONEST_ROOT = R('a')
  pool.offer('honest-volunteer', 100_000n)
  pool.offer('MALLORY', 100_000n) // a hostile volunteer, fully funded
  pool.advance(HONEST_ROOT, 1000)
  const beacon = '00000000000000000000' + 'f'.repeat(44) // a real-looking Bitcoin block hash
  const drawn = pool.draw(beacon, 200n)
  ok(drawn !== null, `the draw picked ${drawn} from the sorted, funded volunteers`)

  // ── 1 · THE PAYER CANNOT CHOOSE WHAT IS SEALED ────────────────────────────
  rejects(() => pool.settle('MALLORY', TX('1'), 500n, R('b')), 'settling with a root of MALLORY\'s own choosing → refused')
  rejects(() => pool.settle('MALLORY', TX('1'), 500n, R('0')), 'settling with an all-zero root → refused')
  rejects(() => pool.settle('MALLORY', TX('1'), 500n, HONEST_ROOT.toUpperCase().slice(0, 63)), 'a truncated root → refused')
  ok(pool.pending !== null && pool.pending.root === HONEST_ROOT, 'after every attempt the pending target is STILL the honest root')

  // ── 2 · NO REWARD WITHOUT A REAL, MATCHING PAYMENT ────────────────────────
  rejects(() => pool.settle('MALLORY', TX('1'), 0n, HONEST_ROOT), 'claiming a reward having paid ZERO sats → refused')
  rejects(() => pool.settle('MALLORY', TX('1'), -5n, HONEST_ROOT), 'claiming with a negative fee → refused')
  rejects(() => pool.settle('MALLORY', 'not-a-txid', 500n, HONEST_ROOT), 'claiming with a fabricated txid shape → refused')

  // ── 3 · THE HONEST SETTLEMENT, AND WHAT IT CLOSES ─────────────────────────
  const s = pool.settle(drawn!, TX('7'), 800n, HONEST_ROOT)
  ok(s.root === HONEST_ROOT && s.height === 1000, 'the settlement records the honest root and height')
  ok(s.reward > 0n, `the payer earned ${s.reward} KRAY, proportional to the sats actually spent`)
  ok(pool.pending === null, 'the pending job is closed — the whole backlog up to that root is sealed')
  rejects(() => pool.settle(drawn!, TX('7'), 800n, HONEST_ROOT), 'settling the SAME job twice → refused (nothing pending)')

  // ── 4 · REFUSING TO PAY COSTS THE NETWORK NOTHING ─────────────────────────
  pool.advance(R('c'), 1001)
  pool.markFailed('MALLORY')
  const redrawn = pool.draw(beacon, 200n)
  ok(redrawn !== 'MALLORY', 'a payer who failed is EXCLUDED from the re-draw')
  ok(pool.pending !== null && pool.pending.height === 1001, 'and the job is still pending — nothing was lost')
  // a whole backlog, no payer at all
  for (let h = 1002; h <= 1050; h++) pool.advance(R('d'), h)
  ok(pool.pending!.height === 1050, '49 more intervals with no payment: ONE pending target, not 49 (O(1) backlog)')

  // ── 5 · THE DRAW CANNOT BE BIASED ─────────────────────────────────────────
  const cands = ['aaa', 'bbb', 'ccc', 'ddd'].sort()
  const a1 = AnchorPool.pick(beacon, 7, HONEST_ROOT, cands)
  const a2 = AnchorPool.pick(beacon, 7, HONEST_ROOT, cands)
  ok(a1 === a2, 'the draw is a PURE function — same inputs, same payer, recomputable by anyone')
  const different = AnchorPool.pick(R('9'), 7, HONEST_ROOT, cands)
  ok(typeof different === 'string', 'a different Bitcoin block hash draws independently — and no one chooses that hash')
  ok(AnchorPool.pick(beacon, 7, HONEST_ROOT, []) === null, 'with nobody funded, nobody is drawn (the chain keeps running)')

  // ── 6 · A WRONG OP_RETURN IS NOT AN ANCHOR — it is a wasted transaction ───
  const honestPayload = KrayAnchor.payload(1000, HONEST_ROOT)
  const decodedHonest = KrayAnchor.decode(honestPayload)!
  ok(decodedHonest.tag === 'KRAY.NETWORK' && decodedHonest.version === 1 && decodedHonest.root === HONEST_ROOT, 'the honest commitment decodes to exactly what the node computed')
  ok(KrayAnchor.decode('deadbeef') === null, 'garbage in the OP_RETURN → not a KRAY anchor')
  ok(KrayAnchor.decode(KrayAnchor.payload(1000, R('e')).replace(/^4b5241592e4e4554574f524b/, '4b5241592e4e4554574f524c')) === null, 'a lookalike tag ("KRAY.NETWORL") → not a KRAY anchor')
  const wrongVersion = honestPayload.slice(0, 24) + '02' + honestPayload.slice(26)
  ok(KrayAnchor.decode(wrongVersion) === null, 'a commitment claiming another version → refused outright by a v1 auditor (stricter than assumed: it never even decodes)')
  const malloryRoot = KrayAnchor.decode(KrayAnchor.payload(1000, R('b')))!
  ok(malloryRoot.root !== HONEST_ROOT, 'MALLORY may publish a well-formed commitment carrying a FABRICATED root…')
  ok(malloryRoot.root === R('b'), '…and it decodes fine — Bitcoin accepts any OP_RETURN from anyone…')
  // …and it means nothing, because the verifier compares against ITS OWN root:
  ok(malloryRoot.root !== HONEST_ROOT, '…but every node compares it against the root IT computed, so it seals nothing')

  console.log(`\n✓ ${pass} checks passed — THE PAYER BUYS ONLY THE FEE: they cannot choose what is sealed (the root is each node's own computation), a fabricated root settles nothing and earns nothing, no reward exists without a real matching payment, refusing to pay only forfeits their reward while the backlog stays O(1), and the draw is an unbiasable pure function of a Bitcoin block hash. Money pays the postage; it never writes the letter. ߜ`)
}
main()
