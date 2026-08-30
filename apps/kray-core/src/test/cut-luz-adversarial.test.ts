/**
 * LUZ / KRC-77 — adversarial exam. Prove by breaking. Same shape as Fenyx forms.
 *   node src/test/cut-luz-adversarial.test.ts
 *
 * Dest of supply, drain, forge, replay, wrong star, ₭/Ӿ cross-domain,
 * reseal, pot, freeze. Every refusal leaves cascade + CutBook untouched.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessageV2, contractCallMessage, transferMessage,
  sendStarMessage, cutSendMessage, xSendMessage,
} from '../protocol/scheme.ts'
import { canonicalCode, contractAddress } from '../protocol/contract.ts'
import { compileCut } from '../protocol/star-forms.ts'
import { sha256hex, BLACK_HOLE, TREASURY, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}

function wallet(tag: string) {
  const sk = createHash('sha256').update('luz-adv|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex, tag }
}
type W = ReturnType<typeof wallet>

function main() {
  console.log('\n╔═ LUZ / KRC-77 ADVERSARIAL — dest · drain · forge · replay ═╗\n')
  const A = wallet('A'), B = wallet('B'), C = wallet('C'), Eve = wallet('eve')
  const paper = compileCut({ supply: '100000' })
  rejects(() => compileCut({ supply: '0' }), /greater than 0/, 'supply 0 without infinite is refused')
  rejects(() => compileCut({ supply: '-1' }), /whole|greater/, 'negative supply is refused')
  rejects(() => compileCut({ supply: '10000001' }), /at most/, 'supply above the ceiling is refused')

  const L = new KrayLedger(undefined, NET)
  const journal: KrayEvent[] = []
  const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
  const snap = () => ({
    root: L.cascadeRoot(),
    cut: L.cuts.commitment(),
    a: L.cuts.of('0', A.addr).toString(),
    b: L.cuts.of('0', B.addr).toString(),
    eve: L.cuts.of('0', Eve.addr).toString(),
    ka: L.balanceOf(A.addr).toString(),
  })
  const frozen = (s: ReturnType<typeof snap>, m: string) => {
    const n = snap()
    ok(n.root === s.root && n.cut === s.cut && n.a === s.a && n.b === s.b && n.eve === s.eve && L.conserves() && L.cuts.conserves(), m)
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

  push({ seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '4000' } as KrayEvent)
  push({ seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '80' } as KrayEvent)
  push({ seq: 3, kind: 'donate', hash: 'dc', to: C.addr, amount: '80' } as KrayEvent)
  push({ seq: 4, kind: 'donate', hash: 'de', to: Eve.addr, amount: '80' } as KrayEvent)
  push(sign(A, { kind: 'name', hash: 'n0', name: 'luzface' }, nameMessageV2(NET, A.addr, 0, 'luzface'), 0))
  const ch = sha256hex(canonicalCode(paper))
  push(sign(A, { kind: 'contract', hash: 'c0', code: paper, star: '0' }, contractMessageV2(NET, A.addr, ch, 0n)))
  const pot = contractAddress(ch, A.addr, L.appliedSeq)

  ok(L.cuts.of('0', A.addr) === 100000n && L.cuts.of('0', Eve.addr) === 0n && L.cuts.of('0', B.addr) === 0n,
    'DESTINY: seal credits the sealer only — Eve and B get zero')
  ok(L.cuts.view('0')?.supply === '100000' && L.cuts.conserves(), 'Σ holders == sealed supply')
  ok(L.cuts.view('0')?.name === 'Luz', 'mouth is Luz')
  ok(L.cuts.catalog().length === 1 && L.cuts.catalog()[0].star === '0' && L.cuts.catalog()[0].holders.length === 1,
    'catalog lists the one sealed star — /rank#luz reads this fold')

  // ── nobody drains the pot or the book ───────────────────────────────────
  tryBad(sign(A, { kind: 'contract-call', hash: 'col', contract: pot, rule: 'collect', callArgs: {}, fee: '1' },
    contractCallMessage(NET, A.addr, pot, 'collect', {}, L.nonceOf(A.addr))), /no rule|refused/i, 'owner collect — no drain')
  tryBad(sign(A, { kind: 'contract-call', hash: 'hv', contract: pot, rule: 'harvest', callArgs: {}, fee: '1' },
    contractCallMessage(NET, A.addr, pot, 'harvest', {}, L.nonceOf(A.addr))), /no rule|refused/i, 'fake harvest')
  tryBad(sign(A, { kind: 'contract-call', hash: 'tg', contract: pot, rule: 'toggle_supply', callArgs: {}, fee: '1' },
    contractCallMessage(NET, A.addr, pot, 'toggle_supply', {}, L.nonceOf(A.addr))), /no rule|refused/i, 'toggle_supply — constitution has no mouth')
  tryBad(sign(A, { kind: 'transfer', hash: 'pdrain', to: Eve.addr, amount: '1', fee: '1', from: pot } as Record<string, unknown>,
    transferMessage(NET, pot, Eve.addr, 1n, 0), 0), /sig|key|scheme|from|protocol pot|cannot transfer/i, 'keyless pot cannot send ₭')

  const bigger = compileCut({ supply: '200000' })
  const bh = sha256hex(canonicalCode(bigger))
  tryBad(sign(A, { kind: 'contract', hash: 're', code: bigger, star: '0' }, contractMessageV2(NET, A.addr, bh, 0n)),
    /already carries a law|one leash/i, 'reseal a bigger supply — one leash forever')

  // ── forge / cross-domain / replay / wrong star ──────────────────────────
  const nA = L.nonceOf(A.addr)
  tryBad({
    seq: L.appliedSeq + 1, kind: 'cut-send', hash: 'fg', from: A.addr, to: Eve.addr, star: '0', amount: '1', fee: '1', nonce: nA,
    publicKey: Eve.pk, signature: _signKrayWallet(cutSendMessage(NET, A.addr, Eve.addr, 0n, 1n, nA), Eve.sk), scheme: 'kraywallet',
  } as KrayEvent, /signature|verify|key/i, 'Eve forges A\'s luz send')

  tryBad({
    seq: L.appliedSeq + 1, kind: 'cut-send', hash: 'x', from: A.addr, to: B.addr, star: '0', amount: '1', fee: '1', nonce: nA,
    publicKey: A.pk, signature: _signKrayWallet(xSendMessage(NET, A.addr, B.addr, 1n, nA), A.sk), scheme: 'kraywallet',
  } as KrayEvent, /signature|verify|message/i, 'Ӿ signature cannot move luz')

  tryBad({
    seq: L.appliedSeq + 1, kind: 'cut-send', hash: 'k', from: A.addr, to: B.addr, star: '0', amount: '1', fee: '1', nonce: nA,
    publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, B.addr, 1n, nA), A.sk), scheme: 'kraywallet',
  } as KrayEvent, /signature|verify|message/i, '₭ transfer signature cannot move luz')

  tryBad({
    seq: L.appliedSeq + 1, kind: 'cut-send', hash: 'amt', from: A.addr, to: Eve.addr, star: '0', amount: '99999', fee: '1', nonce: nA,
    publicKey: A.pk, signature: _signKrayWallet(cutSendMessage(NET, A.addr, Eve.addr, 0n, 1n, nA), A.sk), scheme: 'kraywallet',
  } as KrayEvent, /signature|verify|message/i, 'signed 1, journaled 99999 — amount is in the domain')

  tryBad({
    seq: L.appliedSeq + 1, kind: 'cut-send', hash: 'st', from: A.addr, to: B.addr, star: '1', amount: '1', fee: '1', nonce: nA,
    publicKey: A.pk, signature: _signKrayWallet(cutSendMessage(NET, A.addr, B.addr, 0n, 1n, nA), A.sk), scheme: 'kraywallet',
  } as KrayEvent, /signature|verify|message/i, 'signed ★0, journaled ★1 — star is in the domain')

  tryBad(sign(A, { kind: 'cut-send', hash: 'fee', to: B.addr, star: '0', amount: '1', fee: '2' },
    cutSendMessage(NET, A.addr, B.addr, 0n, 1n, L.nonceOf(A.addr))), /eternal 1-₭|exactly one/i, 'fee ≠ 1')

  tryBad(sign(A, { kind: 'cut-send', hash: 'self', to: A.addr, star: '0', amount: '1', fee: '1' },
    cutSendMessage(NET, A.addr, A.addr, 0n, 1n, L.nonceOf(A.addr))), /two different/i, 'send to self')

  tryBad(sign(A, { kind: 'cut-send', hash: 'hole', to: BLACK_HOLE, star: '0', amount: '1', fee: '1' },
    cutSendMessage(NET, A.addr, BLACK_HOLE, 0n, 1n, L.nonceOf(A.addr))), /protocol pot|cannot enter|cannot be frozen|only burned/i, 'luz cannot enter the hole')

  tryBad(sign(A, { kind: 'cut-send', hash: 'tre', to: TREASURY, star: '0', amount: '1', fee: '1' },
    cutSendMessage(NET, A.addr, TREASURY, 0n, 1n, L.nonceOf(A.addr))), /protocol pot|cannot enter/i, 'luz cannot enter treasury')

  tryBad(sign(A, { kind: 'cut-send', hash: 'cpot', to: pot, star: '0', amount: '1', fee: '1' },
    cutSendMessage(NET, A.addr, pot, 0n, 1n, L.nonceOf(A.addr))), /protocol pot|cannot enter/i, 'luz cannot enter the contract pot')

  tryBad(sign(Eve, { kind: 'cut-send', hash: 'ev', to: A.addr, star: '0', amount: '1', fee: '1' },
    cutSendMessage(NET, Eve.addr, A.addr, 0n, 1n, L.nonceOf(Eve.addr))), /insufficient Luz|insufficient Cut/i, 'Eve has no luz')

  tryBad(sign(A, { kind: 'cut-send', hash: 'ov', to: B.addr, star: '0', amount: '100001', fee: '1' },
    cutSendMessage(NET, A.addr, B.addr, 0n, 100001n, L.nonceOf(A.addr))), /insufficient Luz|insufficient Cut/i, 'over-supply send')

  tryBad(sign(B, { kind: 'cut-send', hash: 'ghost', to: C.addr, star: '1', amount: '1', fee: '1' },
    cutSendMessage(NET, B.addr, C.addr, 1n, 1n, L.nonceOf(B.addr))), /no Cut|insufficient/i, 'send on a star with no Luz paper')

  // ── honest send, then replay the same nonce ─────────────────────────────
  push(sign(A, { kind: 'cut-send', hash: 'ok1', to: B.addr, star: '0', amount: '40000', fee: '1' },
    cutSendMessage(NET, A.addr, B.addr, 0n, 40000n, L.nonceOf(A.addr))))
  ok(L.cuts.of('0', A.addr) === 60000n && L.cuts.of('0', B.addr) === 40000n, 'honest send: A 60000 · B 40000')

  tryBad(sign(A, { kind: 'cut-send', hash: 'rp', to: B.addr, star: '0', amount: '40000', fee: '1' },
    cutSendMessage(NET, A.addr, B.addr, 0n, 40000n, nA), nA), /nonce|signature|verify/i, 'replay the pre-send nonce')

  tryBad(sign(B, { kind: 'cut-send', hash: 'ovb', to: Eve.addr, star: '0', amount: '40001', fee: '1' },
    cutSendMessage(NET, B.addr, Eve.addr, 0n, 40001n, L.nonceOf(B.addr))), /insufficient Luz|insufficient Cut/i, 'B cannot send more than she holds')

  // ── freeze: face dies, book does not ────────────────────────────────────
  push(sign(A, { kind: 'transfer-star', hash: 'frz', to: BLACK_HOLE, star: '0', fee: '1' },
    sendStarMessage(NET, A.addr, BLACK_HOLE, 0n, L.nonceOf(A.addr))))
  ok(L.stars.ownerOf(0n) === BLACK_HOLE, 'face is at the hole')
  tryBad(sign(A, { kind: 'contract', hash: 're2', code: bigger, star: '0' }, contractMessageV2(NET, A.addr, bh, 0n)),
    /owner|already|hole|law/i, 'cannot reseal a frozen face')
  push(sign(B, { kind: 'cut-send', hash: 'post', to: C.addr, star: '0', amount: '10000', fee: '1' },
    cutSendMessage(NET, B.addr, C.addr, 0n, 10000n, L.nonceOf(B.addr))))
  ok(L.cuts.of('0', B.addr) === 30000n && L.cuts.of('0', C.addr) === 10000n && L.cuts.of('0', A.addr) === 60000n,
    'after freeze, holders still move — the book is not the face')
  ok(L.cuts.of('0', A.addr) + L.cuts.of('0', B.addr) + L.cuts.of('0', C.addr) === 100000n, 'Σ still 100000 after freeze+send')

  // ── infinite paper: no genesis units to steal ───────────────────────────
  push(sign(A, { kind: 'name', hash: 'ninf', name: 'openluz' }, nameMessageV2(NET, A.addr, L.nonceOf(A.addr), 'openluz')))
  const inf = compileCut({ infinite: true })
  const ih = sha256hex(canonicalCode(inf))
  const faceInf = L.stars.createdSeq - 1n
  push(sign(A, { kind: 'contract', hash: 'ci', code: inf, star: faceInf.toString() }, contractMessageV2(NET, A.addr, ih, faceInf)))
  ok(!L.cuts.has(faceInf.toString()) && L.cuts.of(faceInf.toString(), A.addr) === 0n, 'infinite seals no genesis credit')
  tryBad(sign(A, { kind: 'cut-send', hash: 'inf', to: B.addr, star: faceInf.toString(), amount: '1', fee: '1' },
    cutSendMessage(NET, A.addr, B.addr, faceInf, 1n, L.nonceOf(A.addr))), /no Cut|insufficient/i, 'nothing to send on infinite until a mint door exists')

  ok(L.conserves() && L.cuts.conserves(), 'conserves after the whole storm')
  const reboot = new KrayLedger(undefined, NET)
  for (const e of journal) reboot.applyLive(e)
  ok(reboot.cascadeRoot() === L.cascadeRoot(), 'reboot cascade is byte-exact')
  ok(reboot.cuts.commitment() === L.cuts.commitment(), 'reboot CutBook commitment is byte-exact')
  ok(reboot.cuts.of('0', A.addr) === 60000n && reboot.cuts.of('0', C.addr) === 10000n, 'holders survive replay — nobody minted extra')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks — supply has one destiny, no drain, no forged transit, refusals freeze the book, reboot is exact. ✧\n`)
}
main()
