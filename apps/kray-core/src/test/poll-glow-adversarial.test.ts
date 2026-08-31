/**
 * POLL · ✦ — adversarial exam. Prove by breaking.
 *   node src/test/poll-glow-adversarial.test.ts
 *
 * Zero glow, double vote, v1 call, closed latch, bad face, replay, weight lock.
 * Glow never moves. 1 ₭ is the seal. Cascade frozen on every refuse.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessageV2, contractCallMessage, contractCallMessageV2,
  inscribeMessageV2, sendStarMessage,
} from '../protocol/scheme.ts'
import { canonicalCode } from '../protocol/contract.ts'
import { compilePoll, compileCut, isPollPaper } from '../protocol/star-forms.ts'
import { examContract } from '../protocol/contract-exam.ts'
import { sha256hex, BLACK_HOLE, type KrayEvent } from '../protocol/kray-primitives.ts'
import { glowOf } from '../economics/glow-star.ts'

const NET = 'regtest'
const clock = 1_700_000_000_000
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}

function wallet(tag: string) {
  const sk = createHash('sha256').update('poll-adv|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
type W = ReturnType<typeof wallet>

function main() {
  console.log('\n╔═ POLL · ✦ ADVERSARIAL — glow · once · seal · replay ═╗\n')
  const A = wallet('A'), B = wallet('B'), C = wallet('C'), Eve = wallet('eve')
  const paper = compilePoll({ title: 'Open the east gate?', choices: ['Yes', 'No', 'Wait'] })
  ok(isPollPaper(paper) && paper.poll?.choices.length === 3, 'paper seals three faces')
  ok(!paper.rules.some((r) => r.name === 'collect'), 'no collect — honor is not a pot to drain')
  const exam = examContract(paper)
  ok(exam.ready && exam.checks.some((c) => c.id === 'rule:vote' && c.kind === 'pass'), 'exam is ready — vote fires under the glow fixture')
  ok(canonicalCode(compileCut({ supply: '100000' })).includes('"luz"'), 'Luz paper still hashes as itself')

  const L = new KrayLedger(undefined, NET)
  const journal: KrayEvent[] = []
  const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
  const snap = () => ({
    root: L.cascadeRoot(),
    ballots: L.polls.view('0')?.ballots ?? 0,
    yes: L.polls.view('0')?.tallies[0] ?? 0,
    ka: L.balanceOf(A.addr).toString(),
    kb: L.balanceOf(B.addr).toString(),
  })
  const frozen = (s: ReturnType<typeof snap>, m: string) => {
    const n = snap()
    ok(n.root === s.root && n.ballots === s.ballots && n.yes === s.yes && L.conserves(), m)
  }
  const tryBad = (e: KrayEvent, re: RegExp, m: string) => {
    const s = snap()
    try { L.applyLive(e); ok(false, m + ' — DID NOT throw') }
    catch (err) {
      ok(re.test((err as Error).message), m + (re.test((err as Error).message) ? '' : ' — wrong error: ' + (err as Error).message))
      frozen(s, m + ' — book + cascade frozen')
    }
  }
  const sign = (w: W, fields: Record<string, unknown>, msg: string, nonce?: number): KrayEvent => {
    const n = nonce ?? L.nonceOf(w.addr)
    return {
      seq: L.appliedSeq + 1, at: 0, from: w.addr, publicKey: w.pk,
      signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet',
      nonce: n, ...fields,
    } as unknown as KrayEvent
  }
  const inscribe = (w: W, tag: string): KrayEvent => {
    const ch = sha256hex(tag)
    const n = L.nonceOf(w.addr)
    const size = 8
    return sign(w, {
      kind: 'inscribe', hash: tag, contentHash: ch, contentType: 'text/plain', size,
    }, inscribeMessageV2(NET, w.addr, ch, 'text/plain', size, undefined, n), n)
  }
  const v2vote = (w: W, pot: string, face: string) => {
    const n = L.nonceOf(w.addr)
    const args = { face }
    return sign(w, {
      kind: 'contract-call', hash: 'v|' + w.addr.slice(-6) + '|' + face, contract: pot, rule: 'vote',
      callArgs: args, fee: '1', clock,
    }, contractCallMessageV2(NET, w.addr, pot, 'vote', { face: BigInt(face) }, n, clock), n)
  }

  push({ seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '4000' } as KrayEvent)
  push({ seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '400' } as KrayEvent)
  push({ seq: 3, kind: 'donate', hash: 'dc', to: C.addr, amount: '200' } as KrayEvent)
  push({ seq: 4, kind: 'donate', hash: 'de', to: Eve.addr, amount: '80' } as KrayEvent)
  push(sign(A, { kind: 'name', hash: 'n0', name: 'pollface' }, nameMessageV2(NET, A.addr, 0, 'pollface'), 0))
  const ch = sha256hex(canonicalCode(paper))
  push(sign(A, { kind: 'contract', hash: 'c0', code: paper, star: '0' }, contractMessageV2(NET, A.addr, ch, 0n)))
  const pot = L.stars.star(0n)?.contract
  if (!pot) throw new Error('no pot')
  ok(L.polls.has('0') && L.polls.view('0')?.choices[0] === 'Yes', 'seal opens the poll book on ★0')
  ok(L.glowOf(A.addr) === 0 && L.glowOf(B.addr) === 0, 'nobody has frozen a star yet')

  push(inscribe(B, 'b-1'))
  push(inscribe(B, 'b-2'))
  const s1 = L.stars.createdSeq - 2n
  const s2 = L.stars.createdSeq - 1n
  push(sign(B, { kind: 'transfer-star', hash: 'fr1', to: BLACK_HOLE, star: s1.toString(), fee: '1' },
    sendStarMessage(NET, B.addr, BLACK_HOLE, s1, L.nonceOf(B.addr))))
  push(sign(B, { kind: 'transfer-star', hash: 'fr2', to: BLACK_HOLE, star: s2.toString(), fee: '1' },
    sendStarMessage(NET, B.addr, BLACK_HOLE, s2, L.nonceOf(B.addr))))
  ok(L.glowOf(B.addr) === 2 && glowOf(journal, B.addr) === 2, 'B froze two stars — ledger glow matches the derivation')

  tryBad(sign(Eve, {
    kind: 'contract-call', hash: 'v1', contract: pot, rule: 'vote', callArgs: { face: '0' }, fee: '1',
  }, contractCallMessage(NET, Eve.addr, pot, 'vote', { face: 0n }, L.nonceOf(Eve.addr))),
    /v2 call|glow is a journal/i, 'a v1 vote is refused')

  tryBad(v2vote(Eve, pot, '0'), /glow|freeze|guard/i, 'Eve has ₭ and 0 ✦ — vote refused, 1 ₭ unspent')
  tryBad(v2vote(A, pot, '0'), /glow|freeze|guard/i, 'the sealer with 0 glow cannot vote')
  tryBad(v2vote(B, pot, '9'), /face|refused|guard/i, 'face 9 is not on this paper')

  const feeBefore = L.balanceOf(B.addr)
  push(v2vote(B, pot, '0'))
  ok(L.polls.view('0')?.ballots === 1 && L.polls.view('0')?.tallies[0] === 2, 'B votes Yes with weight 2')
  ok(L.balanceOf(B.addr) === feeBefore - 1n, 'the eternal 1 ₭ fee left B — glow did not move')
  ok(L.glowOf(B.addr) === 2, 'glow is still 2 after the vote — it is not a spend')

  tryBad(v2vote(B, pot, '1'), /already voted/i, 'a second ballot is refused — even a different face')

  push(inscribe(B, 'b-3'))
  const s3 = L.stars.createdSeq - 1n
  push(sign(B, { kind: 'transfer-star', hash: 'fr3', to: BLACK_HOLE, star: s3.toString(), fee: '1' },
    sendStarMessage(NET, B.addr, BLACK_HOLE, s3, L.nonceOf(B.addr))))
  ok(L.glowOf(B.addr) === 3 && L.polls.view('0')?.tallies[0] === 2, 'later freezes do not rewrite a locked ballot')

  push(inscribe(C, 'c-1'))
  const sc = L.stars.createdSeq - 1n
  push(sign(C, { kind: 'transfer-star', hash: 'frc', to: BLACK_HOLE, star: sc.toString(), fee: '1' },
    sendStarMessage(NET, C.addr, BLACK_HOLE, sc, L.nonceOf(C.addr))))
  push(v2vote(C, pot, '1'))
  ok(L.polls.view('0')?.tallies[1] === 1 && L.polls.view('0')?.ballots === 2, 'C votes No with weight 1')

  const nA = L.nonceOf(A.addr)
  push(sign(A, {
    kind: 'contract-call', hash: 'close', contract: pot, rule: 'toggle_open', callArgs: {}, fee: '1', clock,
  }, contractCallMessageV2(NET, A.addr, pot, 'toggle_open', {}, nA, clock), nA))
  ok(L.contractAt(pot)?.state.open === '0', 'owner closed the latch')

  push(inscribe(Eve, 'e-1'))
  const se = L.stars.createdSeq - 1n
  push(sign(Eve, { kind: 'transfer-star', hash: 'fre', to: BLACK_HOLE, star: se.toString(), fee: '1' },
    sendStarMessage(NET, Eve.addr, BLACK_HOLE, se, L.nonceOf(Eve.addr))))
  tryBad(v2vote(Eve, pot, '2'), /refused|guard|open/i, 'a closed poll refuses a new ballot')

  const R = new KrayLedger(undefined, NET)
  for (const e of journal) R.applyLive(e)
  const live = L.polls.view('0')!
  const replay = R.polls.view('0')!
  ok(R.cascadeRoot() === L.cascadeRoot(), 'replay matches the live cascade')
  ok(replay.ballots === live.ballots && replay.tallies.join(',') === live.tallies.join(','), 'replay matches the poll book')
  ok(R.glowOf(B.addr) === L.glowOf(B.addr) && R.conserves(), 'replay glow and conservation hold')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — POLL HOLDS: glow weights, once, 1 ₭, closed latch, replay. ✦`)
}
main()
