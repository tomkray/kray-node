/**
 * THE ASYMMETRIC GOLDEN (audit 2026-08-28) — a frozen cascade root over a state where the
 * MARKET and OFFER conditional folds are BOTH present.
 *
 *   node src/test/cascade-golden-market.test.ts
 *
 * Why this exists: the genesis golden cannot see a reorder between two conditional folds that
 * are both ABSENT at genesis (market/offers). Swapping their `if` lines in cascadeRootFromParts
 * would pass every genesis pin and only explode on a live journal replay — orphaning anchored
 * roots. This golden holds a state that exercises both folds, so any reorder/relabel of the
 * market/offer tail fails EXIT 1 here, on the bench, before it can touch a writer.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { cascadeRootFromParts } from '../protocol/cascade-root.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, starListMessage, starOfferMessage, inscribeMessageV2 } from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update(`cascade-golden|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}

// Re-captured only when a RATIFIED consensus change moves the fold (state the change beside the new value).
// Captured 2026-08-28 on the escrowed-offers law (27abdfa): listing(50) + live bid(40) on star #0, regtest.
const RICH_GOLDEN = '539292f20f9465118a3ca6e7b6e354abd61f8b74e6d3eb61c9d488c262435c53'

function main() {
  console.log('\n╔═ ASYMMETRIC GOLDEN — market + offer folds BOTH present, root frozen ═╗\n')
  const A = wallet('alice'), B = wallet('bob')
  const L = new KrayLedger(undefined, NET)
  let seq = 0
  const donate = (to: string, amount: string) => L.applyLive({ seq: ++seq, kind: 'donate', hash: 'g' + seq, to, amount, outpoint: createHash('sha256').update('gold' + seq).digest('hex') + ':0' } as unknown as KrayEvent)

  donate(A.addr, '100'); donate(B.addr, '100')
  const tag = 'golden-star'
  const n0 = L.nonceOf(A.addr)
  L.applyLive({ seq: ++seq, kind: 'inscribe', hash: 'g' + seq, at: seq, from: A.addr, contentHash: tag, contentType: 'text/plain', size: tag.length, nonce: n0, publicKey: A.pk, signature: _signKrayWallet(inscribeMessageV2(NET, A.addr, tag, 'text/plain', tag.length, undefined, n0), A.sk), scheme: 'kraywallet' } as unknown as KrayEvent)
  const star = 0n
  const n1 = L.nonceOf(A.addr)
  L.applyLive({ seq: ++seq, kind: 'star-list', hash: 'g' + seq, at: seq, from: A.addr, star: '0', amount: '50', fee: '1', nonce: n1, publicKey: A.pk, signature: _signKrayWallet(starListMessage(NET, A.addr, star, 50n, n1), A.sk), scheme: 'kraywallet' } as unknown as KrayEvent)
  const n2 = L.nonceOf(B.addr)
  L.applyLive({ seq: ++seq, kind: 'star-offer', hash: 'g' + seq, at: seq, from: B.addr, star: '0', amount: '40', fee: '1', nonce: n2, publicKey: B.pk, signature: _signKrayWallet(starOfferMessage(NET, B.addr, star, 40n, n2), B.sk), scheme: 'kraywallet' } as unknown as KrayEvent)

  const p = L.cascadeParts()
  ok(p.marketCommitment !== undefined && p.offerCommitment !== undefined, 'the state exercises BOTH conditional folds (listing + live bid)')
  ok(L.conserves(), 'the golden state conserves (A1)')

  const root = L.cascadeRoot()
  ok(root === RICH_GOLDEN, `the market+offer cascade root is byte-frozen — any reorder/relabel of the conditional tail breaks this (got ${root})`)
  ok(cascadeRootFromParts(p) === RICH_GOLDEN, 'cascadeRootFromParts opens the same bytes — writer and verifier are one function')

  // the exact attack this pin exists for: feed the SAME two values through swapped labels —
  // the root MUST move, or a silent swap of the market/offer folds would orphan nothing visibly.
  const swapped = { ...p, marketCommitment: p.offerCommitment, offerCommitment: p.marketCommitment }
  ok(cascadeRootFromParts(swapped) !== root, 'swapping the market/offer fold values moves the root — the tail is order- and label-bound')

  console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed, ${fail} failed — the asymmetric tail is pinned.\n`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
