/**
 * THE FULL-CITIZENSHIP STACK — origin (blessing) + eternize on ONE star, no conflicts.
 *   node src/test/origin-eternize-stack.test.ts
 *
 * The flow the Creator asked to prove end-to-end (docs/ETERNIZE.md § stack):
 *   1 · Alice holds an L1 ordinal (two-hop blessing) whose carved bytes ARE the body.
 *   2 · The trunk star is born via origin: paternity proven from the SPV bag.
 *   3 · A fan eternizes the SAME star against the SAME inscription id, reusing the
 *       SAME ProvenTx (bundle[0] of the blessing) — one bag of bytes, two facts.
 *   4 · A child star derives from the trunk (KRAY lineage, own body).
 *   5 · The trunk sells; owner moves; origin + eternal survive untouched.
 *   6 · A cold replay re-proves BOTH proofs from the journal, byte-exact.
 * Broken in-stack: eternizing the child against the father's id (different bytes),
 * a second binding, a stranger's blessing theft after the eternize.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, scriptOfAddress,
  inscribeMessageV3, sendStarMessage, eternizeMessage,
} from '../protocol/scheme.ts'
import { sha256hex, TREASURY, type KrayEvent } from '../protocol/kray-primitives.ts'
import { authorHeldOriginProof } from './ordinal-proof-fixture.ts'
import type { ProvenTx } from '../protocol/rune-ancestry.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('stack|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
type W = ReturnType<typeof wallet>

function main() {
  console.log('\n╔═ ORIGIN + ETERNIZE STACK — one bag of proven bytes, two facts, zero conflicts ═╗\n')
  const A = wallet('alice'), B = wallet('buyer'), Fan = wallet('fan'), M = wallet('mallory')

  const L = new KrayLedger(undefined, NET)
  const journal: KrayEvent[] = []
  const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
  const sign = (w: W, fields: Record<string, unknown>, msg: (n: number) => string): KrayEvent => {
    const n = L.nonceOf(w.addr)
    return {
      seq: L.appliedSeq + 1, at: 0, from: w.addr, publicKey: w.pk,
      signature: _signKrayWallet(msg(n), w.sk), scheme: 'kraywallet',
      nonce: n, ...fields,
    } as unknown as KrayEvent
  }
  const tryBad = (e: KrayEvent, re: RegExp, m: string) => {
    const root = L.cascadeRoot()
    try { L.applyLive(e); ok(false, m + ' — DID NOT throw') }
    catch (err) {
      const msg = (err as Error).message
      ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg))
      ok(L.cascadeRoot() === root && L.conserves(), m + ' — cascade frozen')
    }
  }
  const eternizeEv = (w: W, star: string, id: string, bundle: ProvenTx[]): KrayEvent =>
    sign(w, { kind: 'eternize', hash: 'e|' + star + '|' + w.addr.slice(-4), star, l1InscriptionId: id, eternalProof: bundle, fee: '1' },
      (n) => eternizeMessage(NET, w.addr, BigInt(star), id, n))

  push({ seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '1000' } as KrayEvent)
  push({ seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '1000' } as KrayEvent)
  push({ seq: 3, kind: 'donate', hash: 'df', to: Fan.addr, amount: '100' } as KrayEvent)
  push({ seq: 4, kind: 'donate', hash: 'dm', to: M.addr, amount: '100' } as KrayEvent)

  // ── 1 · the L1 ordinal: carved bytes = the future star's body, blessed by the two-hop ──
  const SONG = 'genesis-song'   // the ordinal's carved content AND the trunk star's body
  const chSong = sha256hex(SONG)
  const sizeSong = Buffer.byteLength(SONG, 'utf8')
  const held = authorHeldOriginProof(scriptOfAddress(A.addr, NET), { confirmations: 1, salt: SONG })
  const revealProven = held.proof.bundle[0]   // the SAME ProvenTx will serve the eternize

  // ── 2 · trunk born via origin — paternity proven from the bag ──
  push(sign(A, {
    kind: 'inscribe', hash: 'trunk', contentHash: chSong, contentType: 'text/plain', size: sizeSong,
    origins: [held.parentId], originProofs: [held.proof],
  }, (n) => inscribeMessageV3(NET, A.addr, chSong, 'text/plain', sizeSong, [], [held.parentId], n)))
  ok(L.stars.star(0n)?.origins?.[0]?.l1InscriptionId === held.parentId, 'trunk is born of the L1 father — blessing proven in the reducer')
  ok(L.stars.star(0n)?.eternal === undefined, 'origin did NOT fill the eternal slot — separate facts, separate acts')

  // ── 3 · the fan eternizes the trunk against the SAME id, reusing the SAME proven reveal ──
  const rootBefore = L.cascadeRoot()
  push(eternizeEv(Fan, '0', held.parentId, [revealProven]))
  ok(L.stars.star(0n)?.eternal === held.parentId, 'eternal slot filled with the SAME id as origin — dual citizenship on one star')
  ok(L.stars.star(0n)?.origins?.[0]?.l1InscriptionId === held.parentId, 'origin untouched by the eternize — the slots never fight')
  ok(L.stars.star(0n)?.owner === A.addr, 'the fan paid the seal; Alice keeps the star')
  ok(L.cascadeRoot() !== rootBefore, 'the cascade folds the second fact')

  // ── 4 · a child derives from the trunk — its own body, KRAY lineage ──
  const chChild = sha256hex('remix-of-genesis')
  push(sign(A, {
    kind: 'inscribe', hash: 'child', contentHash: chChild, contentType: 'text/plain', size: 16, parents: ['0'],
  }, (n) => inscribeMessageV3(NET, A.addr, chChild, 'text/plain', 16, ['0'], [], n)))
  ok(L.stars.parentsOf(1n).map(String).join(',') === '0', 'the child shines under the trunk')
  ok(L.stars.star(1n)?.eternal === undefined, 'the child inherits NO eternal — availability is per-body, never per-lineage')

  // ── in-stack adversaries ──
  tryBad(eternizeEv(A, '1', held.parentId, [revealProven]), /byte-for-byte or nothing/i,
    'the child cannot wear the father\'s carving — its body is different bytes')
  tryBad(eternizeEv(B, '0', held.parentId, [revealProven]), /already eternal/i,
    'a second binding on the trunk is refused — even with the true bag')
  const chSteal = sha256hex('mallory-steal')
  tryBad(sign(M, {
    kind: 'inscribe', hash: 'steal', contentHash: chSteal, contentType: 'text/plain', size: 8,
    origins: [held.parentId], originProofs: [held.proof],
  }, (n) => inscribeMessageV3(NET, M.addr, chSteal, 'text/plain', 8, [], [held.parentId], n)),
    /not proven|holder-not-authors/i, 'after the eternize, a blessing theft still dies the same death')

  // ── 5 · the trunk sells — owner moves, both facts survive ──
  push(sign(A, { kind: 'transfer-star', hash: 'sale', to: B.addr, star: '0', fee: '1' },
    (n) => sendStarMessage(NET, A.addr, B.addr, 0n, n)))
  ok(L.stars.star(0n)?.owner === B.addr, 'the trunk moved to the buyer')
  ok(L.stars.star(0n)?.eternal === held.parentId && L.stars.star(0n)?.origins?.[0]?.l1InscriptionId === held.parentId,
    'origin + eternal ride with the star — facts about the body, not the holder')

  // ── 6 · a second trunk proves order-independence: born → sold → THEN eternized ──
  const SONG2 = 'second-anthem'
  const ch2 = sha256hex(SONG2)
  const held2 = authorHeldOriginProof(scriptOfAddress(A.addr, NET), { confirmations: 1, salt: SONG2 })
  push(sign(A, {
    kind: 'inscribe', hash: 'trunk2', contentHash: ch2, contentType: 'text/plain', size: Buffer.byteLength(SONG2),
    origins: [held2.parentId], originProofs: [held2.proof],
  }, (n) => inscribeMessageV3(NET, A.addr, ch2, 'text/plain', Buffer.byteLength(SONG2), [], [held2.parentId], n)))
  push(sign(A, { kind: 'transfer-star', hash: 'sale2', to: B.addr, star: '2', fee: '1' },
    (n) => sendStarMessage(NET, A.addr, B.addr, 2n, n)))
  push(eternizeEv(Fan, '2', held2.parentId, [held2.proof.bundle[0]]))
  ok(L.stars.star(2n)?.eternal === held2.parentId, 'eternize lands AFTER the sale too — anyone, anytime, once')

  // ── 7 · the cold replay re-proves the blessing AND the carving from the journal alone ──
  const R = new KrayLedger(undefined, NET)
  for (const e of journal) R.applyLive(e)
  ok(R.cascadeRoot() === L.cascadeRoot(), 'replay lands on the same cascade root — both SPV proofs re-verified from bytes')
  ok(R.stars.star(0n)?.eternal === held.parentId && R.stars.star(0n)?.origins?.[0]?.l1InscriptionId === held.parentId,
    'replay carries origin + eternal on the trunk')
  ok(R.stars.childrenOfOrigin(held.parentId).map(String).join(',') === '0', 'the L1 father still indexes his daughter')
  ok(R.stars.starOfEternal(held.parentId)?.toString() === '0' && R.stars.starOfEternal(held2.parentId)?.toString() === '2',
    'replay rebuilds the eternal index — the desk detects a taken carving on any node')
  ok(R.conserves() && L.conserves(), 'Σ conserves on both walks')

  console.log(`\n${fail === 0 ? '✅' : '❌'} origin+eternize stack — ${pass} passed, ${fail} failed\n`)
  if (fail > 0) process.exit(1)
}

main()
