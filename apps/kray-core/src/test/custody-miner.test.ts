/**
 * THE GUARDIAN'S CUSTODY PROOF — the miner builds what the node audits, and a LIE never survives the round-trip.
 *
 * A master guardian downloads the atlas (the network's inscribed content), keeps the bytes, and each seal answers
 * an address-salted, beacon-fresh challenge with buildCustodyClaim. The node re-derives the SAME challenge and
 * checks the ONE aggregate with verifyCustody. This proves the exact contract the miner and node share:
 *   · a guardian who holds the atlas earns the full 3× (effectiveWork = base × (K + 2·hits))
 *   · a guardian who holds nothing earns the plain 1× — an honest partial claim still verifies
 *   · claiming content you do NOT hold (wrong bytes, or a forged aggregate) is caught — exact:false
 *   · a claim is address-bound: another guardian's proof pays you nothing
 *
 *   node src/test/custody-miner.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, _generateKeyPair, _hexToBytes } from '../protocol/scheme.ts'
import {
  buildCustodyClaim, verifyCustody, custodyToHex, custodyFromHex, hitCount, effectiveWork,
  CUSTODY_CHALLENGES, CUSTODY_FULL_FACTOR, type AtlasOracle,
} from '../economics/custody.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function addr(tag: string): string {
  const sk = createHash('sha256').update('custody-miner|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[NET]).address!
}
const BEACON = createHash('sha256').update('beacon|custody-miner').digest('hex')

// an atlas of N inscribed contents, with their real bytes — the thing a guardian must actually keep
const N = 12
const store = new Map<string, Uint8Array>()
const contents: string[] = []
for (let i = 0; i < N; i++) {
  const b = Buffer.from(`kray-atlas.v1|content#${i}|` + 'x'.repeat(40 + i), 'utf8')
  const h = createHash('sha256').update(b).digest('hex')
  contents.push(h); store.set(h, new Uint8Array(b))
}
// four kinds of guardian, same atlas LIST, different possession of the BYTES:
const full: AtlasOracle = { contents, bytesOf: (h) => store.get(h) ?? null }               // keeps everything
const none: AtlasOracle = { contents, bytesOf: () => null }                                 // pure CPU, holds nothing
const wrong: AtlasOracle = { contents, bytesOf: (h) => new Uint8Array(Buffer.from('IMPOSTOR|' + h, 'utf8')) } // "has" every hash, but wrong bytes

function main() {
  console.log('\n╔═ THE GUARDIAN CUSTODY PROOF — the miner builds it, the node audits it, and a lie cannot pass ═╗\n')
  const A = addr('A'), B = addr('B')

  // ── 1 · a full-atlas guardian: the claim it builds VERIFIES, at full hits ────
  const claimFull = buildCustodyClaim(BEACON, A, full)
  const vFull = verifyCustody(claimFull, BEACON, A, full)
  ok(vFull.exact && vFull.claimedHits === CUSTODY_CHALLENGES, `a full-atlas guardian proves all ${CUSTODY_CHALLENGES} challenges (exact, ${vFull.claimedHits} hits)`)
  ok(custodyToHex(claimFull).length === 66 && hitCount(custodyFromHex(custodyToHex(claimFull))) === CUSTODY_CHALLENGES, 'the claim serializes to the canonical 33-byte row and round-trips to full hits')

  // ── 2 · a CPU-only guardian: an honest EMPTY claim still verifies, at zero hits ──
  const claimNone = buildCustodyClaim(BEACON, A, none)
  const vNone = verifyCustody(claimNone, BEACON, A, full)   // audited by a full node
  ok(vNone.exact && vNone.claimedHits === 0, 'a guardian holding no bytes makes an honest zero-hit claim that still verifies (no lie, just no bonus)')

  // ── 3 · the PAYOUT gap is exactly 3× — full custody vs pure CPU, integer-exact ──
  const base = 1000n
  const earnFull = effectiveWork(base, vFull.claimedHits)
  const earnNone = effectiveWork(base, vNone.claimedHits)
  ok(earnNone === base * BigInt(CUSTODY_CHALLENGES), `CPU-only effective work is base × K (${earnNone})`)
  ok(earnFull === base * BigInt(CUSTODY_CHALLENGES * CUSTODY_FULL_FACTOR), `full-atlas effective work is base × 3K (${earnFull})`)
  ok(earnFull === earnNone * BigInt(CUSTODY_FULL_FACTOR), `keeping the atlas pays exactly ${CUSTODY_FULL_FACTOR}× the pure machine, to the unit`)

  // ── 4 · a LIE is caught — claiming content you don't truly hold ──────────────
  const claimLie = buildCustodyClaim(BEACON, A, wrong)      // "holds" every hash, but the bytes are impostors
  const vLie = verifyCustody(claimLie, BEACON, A, full)     // audited against the REAL bytes
  ok(!vLie.exact && vLie.reason === 'aggregate-mismatch', 'claiming custody with the wrong bytes is REFUSED — the aggregate breaks (aggregate-mismatch)')
  const forged = custodyToHex({ hits: claimFull.hits, aggregate: 'ab'.repeat(32) })   // full hits, invented aggregate
  const vForged = verifyCustody(custodyFromHex(forged), BEACON, A, full)
  ok(!vForged.exact, 'a hand-forged aggregate over real hits is REFUSED — you cannot fake the answer you never computed')

  // ── 5 · a claim is ADDRESS-BOUND — a peer's proof earns YOU nothing ──────────
  const vStolen = verifyCustody(claimFull, BEACON, B, full)   // A's genuine claim, presented under B
  ok(!vStolen.exact, "another guardian's valid custody proof does NOT verify under your address — challenges and answers are address-salted")

  // ── 6 · a full node auditing a full node with an EMPTY atlas asks nothing ────
  const emptyList: AtlasOracle = { contents: [], bytesOf: () => null }
  const claimEmptyAtlas = buildCustodyClaim(BEACON, A, emptyList)
  const vEmptyAtlas = verifyCustody(claimEmptyAtlas, BEACON, A, emptyList)
  ok(vEmptyAtlas.exact && vEmptyAtlas.claimedHits === 0, 'with no atlas to guard, custody is a no-op that still verifies (base × K for everyone)')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the miner proves what it holds, the node believes only what it can re-derive. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
