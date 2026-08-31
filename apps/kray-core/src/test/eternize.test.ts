/**
 * ETERNIZE — adversarial exam (docs/ETERNIZE.md · S1). Prove by breaking.
 *   node src/test/eternize.test.ts
 *
 * The eternal door: a star's exact bytes carved as a Bitcoin ordinal inscription,
 * SPV-proven from raw transactions inside the reducer, bound once, forever.
 * Broken here: wrong bytes, missing proof, tampered burial, wrong fee, bodyless
 * star, missing star, wrong index, double binding, a stranger's injected seal,
 * a clone paid to another key.
 * Proven here: only the owner may eternize, the reveal paid that eternizer,
 * ownership never moves, the cascade folds the binding, and a cold replay
 * re-proves the carving byte-exact.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, scriptOfAddress,
  nameMessageV2, inscribeMessageV2, eternizeMessage,
} from '../protocol/scheme.ts'
import { sha256hex, TREASURY, type KrayEvent } from '../protocol/kray-primitives.ts'
import { signedMessageOfEvent } from '../protocol/signed-message.ts'
import { proven, revealWithEnvelope, txidOf, p2trFill } from './ordinal-proof-fixture.ts'
import type { ProvenTx } from '../protocol/rune-ancestry.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('eternize-adv|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
type W = ReturnType<typeof wallet>

function main() {
  console.log('\n╔═ ETERNIZE ADVERSARIAL — the stone bought for one star\'s body ═╗\n')
  const A = wallet('A'), Eve = wallet('eve')

  // ── the body, and its true L1 carving (regtest PoW, mined by the fixture forge) ──
  const BODY = 'the-first-song — carved on the stone, alive in the cascade'
  const bodyHashHex = sha256hex(BODY)
  const coin = sha256hex('eternize-fixture-coin')
  const aScript = Buffer.from(scriptOfAddress(A.addr, 'regtest'), 'hex')
  const eveScript = Buffer.from(scriptOfAddress(Eve.addr, 'regtest'), 'hex')
  const reveal = revealWithEnvelope([{ txid: coin, vout: 0 }], [{ value: 10_000n, script: aScript }], Buffer.from(BODY, 'utf8'))
  const ID = `${txidOf(reveal)}i0`
  const BUNDLE: ProvenTx[] = [proven(reveal, 1)]
  // a second carving with DIFFERENT bytes — proven, buried, and still worthless for star #0
  const liar = revealWithEnvelope([{ txid: sha256hex('liar-coin'), vout: 0 }], [{ value: 10_000n, script: p2trFill(0x33) }], Buffer.from('a louder copy', 'utf8'))
  const LIAR_ID = `${txidOf(liar)}i0`
  const LIAR_BUNDLE: ProvenTx[] = [proven(liar, 1)]
  // SAME bytes, paid to Eve — a clone. Bitcoin allows it; the book does not bind it.
  const clone = revealWithEnvelope([{ txid: sha256hex('clone-coin'), vout: 0 }], [{ value: 10_000n, script: eveScript }], Buffer.from(BODY, 'utf8'))
  const CLONE_ID = `${txidOf(clone)}i0`
  const CLONE_BUNDLE: ProvenTx[] = [proven(clone, 1)]

  const L = new KrayLedger(undefined, NET)
  const journal: KrayEvent[] = []
  const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
  const sign = (w: W, fields: Record<string, unknown>, msg: string, nonce?: number): KrayEvent => {
    const n = nonce ?? L.nonceOf(w.addr)
    return {
      seq: L.appliedSeq + 1, at: 0, from: w.addr, publicKey: w.pk,
      signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet',
      nonce: n, ...fields,
    } as unknown as KrayEvent
  }
  const eternizeEv = (w: W, star: string, id: string, bundle: ProvenTx[], fee = '1'): KrayEvent => {
    const n = L.nonceOf(w.addr)
    return sign(w, {
      kind: 'eternize', hash: 'e|' + star + '|' + id.slice(0, 8) + '|' + fee, star,
      l1InscriptionId: id, eternalProof: bundle, fee,
    }, eternizeMessage(NET, w.addr, BigInt(star), id, n), n)
  }
  const snap = () => ({
    root: L.cascadeRoot(),
    eternal: L.stars.star(0n)?.eternal,
    treasury: L.balanceOf(TREASURY).toString(),
  })
  const tryBad = (e: KrayEvent, re: RegExp, m: string) => {
    const s = snap()
    try { L.applyLive(e); ok(false, m + ' — DID NOT throw') }
    catch (err) {
      const msg = (err as Error).message
      ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg))
      const n = snap()
      ok(n.root === s.root && n.eternal === s.eternal && n.treasury === s.treasury && L.conserves(), m + ' — book + cascade frozen')
    }
  }

  // ── seed: fuel, one content star (#0), one baptism-only star (#1) ──
  push({ seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '100' } as KrayEvent)
  push({ seq: 2, kind: 'donate', hash: 'de', to: Eve.addr, amount: '10' } as KrayEvent)
  const size = Buffer.byteLength(BODY, 'utf8')
  push(sign(A, { kind: 'inscribe', hash: 'i0', contentHash: bodyHashHex, contentType: 'text/plain', size },
    inscribeMessageV2(NET, A.addr, bodyHashHex, 'text/plain', size, undefined, 0), 0))
  push(sign(A, { kind: 'name', hash: 'n1', name: 'bodylessmuse' }, nameMessageV2(NET, A.addr, 1, 'bodylessmuse'), 1))
  ok(L.stars.star(0n)?.contentHash === bodyHashHex, 'star #0 carries the body\'s hash')
  ok(L.stars.star(1n) !== null && L.stars.star(1n)?.contentHash === undefined, 'star #1 was born baptism-only — a name, no bytes')

  // ── the mirror knows the act (same-instant law parity) ──
  const probe = eternizeEv(A, '0', ID, BUNDLE)
  ok(signedMessageOfEvent(probe, NET) === eternizeMessage(NET, A.addr, 0n, ID, probe.nonce!), 'signed-message mirror rebuilds the eternize bytes verbatim')

  // ── break it, every way ──
  tryBad(eternizeEv(A, '7', ID, BUNDLE), /does not exist/i, 'a star that was never born cannot be eternized')
  tryBad(eternizeEv(A, '1', ID, BUNDLE), /carve the body first/i, 'a baptism-only star has no bytes to eternize')
  tryBad(eternizeEv(A, '0', ID, BUNDLE, '2'), /exactly 1 ₭/, 'an overpaid seal is refused — the fee is law, not a tip')
  tryBad(eternizeEv(A, '0', ID, BUNDLE, '0'), /exactly 1 ₭/, 'a free eternity is refused')
  tryBad(eternizeEv(A, '0', ID, []), /no proof, no eternity/i, 'an empty bundle is refused — the proof rides the event')
  tryBad(eternizeEv(A, '0', LIAR_ID, LIAR_BUNDLE), /byte-for-byte or nothing/i, 'a proven carving of DIFFERENT bytes is refused')
  tryBad(eternizeEv(A, '0', ID, [{ ...BUNDLE[0], headers: [] }]), /not proven/i, 'a tampered burial (stripped headers) is refused')
  tryBad(eternizeEv(A, '0', `${txidOf(reveal)}i1`, BUNDLE), /not proven/i, 'a wrong envelope index is refused — the id names ONE carving')
  tryBad(eternizeEv(A, '0', 'not-an-ordinal-id', BUNDLE), /inscription id/i, 'a malformed id is refused at the shape gate')
  tryBad(eternizeEv(Eve, '0', ID, BUNDLE), /only the owner/i, 'a stranger cannot inject the seal — even with the true carving and 1 ₭')
  tryBad(eternizeEv(A, '0', CLONE_ID, CLONE_BUNDLE), /not paid to the eternizer/i,
    'a clone of the same bytes paid to another key cannot bind — only the eternizer\'s birth script')
  tryBad(eternizeEv(Eve, '0', CLONE_ID, CLONE_BUNDLE), /only the owner/i,
    'the clone holder is still not the owner — two holes, two refusals')

  // ── the door opens: the OWNER pays the seal ──
  const before = snap()
  const ownerBalance = L.balanceOf(A.addr)
  push(eternizeEv(A, '0', ID, BUNDLE))
  ok(L.stars.star(0n)?.eternal === ID, 'star #0 now wears its eternal binding — the L1 carving id')
  ok(L.stars.star(0n)?.owner === A.addr, 'ownership never moved — the seal buys availability, not the star')
  ok(L.balanceOf(A.addr) === ownerBalance - 1n, 'the owner paid the eternal 1-₭ seal')
  ok(L.balanceOf(TREASURY).toString() === (BigInt(before.treasury) + 1n).toString(), 'the seal funds the guardians — 1 ₭ to the Treasury')
  ok(L.cascadeRoot() !== before.root, 'the cascade root folds the binding — the network remembers')
  ok(L.stars.starOfEternal(ID)?.toString() === '0', 'the desk index answers: this carving is eternal on star #0')
  ok(L.stars.starOfEternal(LIAR_ID) === null, 'an unbound carving indexes nowhere')
  ok(L.conserves(), 'Σ conserves — nothing minted, nothing lost')

  // ── one binding, forever ──
  tryBad(eternizeEv(A, '0', ID, BUNDLE), /already eternal/i, 'a second binding is refused — even by the owner, even with the true proof')

  // ── the cold replay re-proves the carving from the journal alone ──
  const R = new KrayLedger(undefined, NET)
  for (const e of journal) R.applyLive(e)
  ok(R.cascadeRoot() === L.cascadeRoot(), 'replay lands on the same cascade root — the SPV bundle re-verified from bytes')
  ok(R.stars.star(0n)?.eternal === ID, 'replay carries the eternal binding')
  ok(R.conserves(), 'replay conserves')

  console.log(`\n${fail === 0 ? '✅' : '❌'} eternize adversarial — ${pass} passed, ${fail} failed\n`)
  if (fail > 0) process.exit(1)
}

main()
