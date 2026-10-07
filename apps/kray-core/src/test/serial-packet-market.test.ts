/**
 * KRC-7777 UNIT MARKET — the packet law on one serial id.
 *   node src/test/serial-packet-market.test.ts
 *
 * Prove by breaking: list / take / delist; take moves THAT id; a second take finds nothing;
 * packet-list.v1 cannot list a serial amount; a send while listed kills the offer;
 * empty book is absent from the cascade (A3); reboot is byte-exact.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessageV2, cutSendUnitMessage,
} from '../protocol/scheme.ts'
import {
  packetListMessage, packetTakeMessage,
} from '../protocol/packet-market.ts'
import {
  serialPacketListMessage, serialPacketDelistMessage, serialPacketTakeMessage, serialPacketTermsHash,
} from '../protocol/serial-packet-market.ts'
import { signedMessageOfEvent } from '../protocol/signed-message.ts'
import { canonicalCode } from '../protocol/contract.ts'
import { compileCut } from '../protocol/star-forms.ts'
import { sha256hex, TREASURY, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('serial-packet|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
type W = ReturnType<typeof wallet>

function main() {
  console.log('\n╔═ KRC-7777 UNIT MARKET — list · take · no twin · A3 ═╗\n')

  const A = wallet('A'), B = wallet('B'), C = wallet('C'), Eve = wallet('eve')
  const L = new KrayLedger(undefined, NET)
  const journal: KrayEvent[] = []
  const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
  const snap = () => ({
    root: L.cascadeRoot(),
    cut: L.cuts.commitment(),
    book: L.serialPackets.commitment(),
    owner3: L.cuts.ownerOfUnit('0', 3n),
    aK: L.balanceOf(A.addr).toString(),
    bK: L.balanceOf(B.addr).toString(),
  })
  const frozen = (s: ReturnType<typeof snap>, m: string) => {
    const n = snap()
    ok(n.root === s.root && n.cut === s.cut && n.book === s.book && n.owner3 === s.owner3 && n.aK === s.aK && n.bK === s.bK && L.conserves() && L.cuts.conserves(), m)
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

  ok(!L.cascadeParts().serialPacketCommitment, 'empty serial-packet book is absent from the cascade (A3)')

  push({ seq: 1, kind: 'donate', hash: 'da', to: A.addr, amount: '4000' } as KrayEvent)
  push({ seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '80' } as KrayEvent)
  push({ seq: 3, kind: 'donate', hash: 'dc', to: C.addr, amount: '80' } as KrayEvent)
  push({ seq: 4, kind: 'donate', hash: 'de', to: Eve.addr, amount: '80' } as KrayEvent)
  push(sign(A, { kind: 'name', hash: 'n0', name: 'serialsix' }, nameMessageV2(NET, A.addr, 0, 'serialsix'), 0))
  const paper = compileCut({ serial: true, supply: '6' })
  const ch = sha256hex(canonicalCode(paper))
  push(sign(A, { kind: 'contract', hash: 'c0', code: paper, star: '0' }, contractMessageV2(NET, A.addr, ch, 0n)))
  ok(L.cuts.ownerOfUnit('0', 3n) === A.addr, 'A holds unit 3 at genesis')

  const emptyAfterSeal = L.cascadeParts().serialPacketCommitment
  ok(emptyAfterSeal === undefined, 'a serial seal alone still folds no market field')

  const nA = L.nonceOf(A.addr)
  tryBad(sign(A, { kind: 'packet-list', hash: 'fung', lane: 'luz', star: '0', amount: '1', price: '10', fee: '1' },
    packetListMessage(NET, A.addr, 'luz', '0', 1n, 10n, {}, nA)), /serial|unit/i, 'packet-list.v1 cannot list a serial amount')

  const list3 = sign(A, { kind: 'packet-list-unit', hash: 'l3', star: '0', unit: '3', price: '7', fee: '1' },
    serialPacketListMessage(NET, A.addr, '0', 3n, 7n, {}, L.nonceOf(A.addr)))
  ok(signedMessageOfEvent(list3, NET) === serialPacketListMessage(NET, A.addr, '0', 3n, 7n, {}, list3.nonce!),
    'mirror == reducer line for packet-list-unit')
  push(list3)
  ok(!!L.cascadeParts().serialPacketCommitment, 'listing folds into the cascade by presence')
  ok(L.serialPackets.get('0', 3n)?.seller === A.addr && L.serialPackets.get('0', 3n)?.price === 7n, 'unit 3 is listed at 7 ₭')
  ok(L.cuts.ownerOfUnit('0', 3n) === A.addr, 'listing moved nothing — A still holds unit 3')

  tryBad(sign(Eve, { kind: 'packet-list-unit', hash: 'eve', star: '0', unit: '3', price: '1', fee: '1' },
    serialPacketListMessage(NET, Eve.addr, '0', 3n, 1n, {}, L.nonceOf(Eve.addr))), /not yours|hold that unit/i, 'Eve cannot list a unit she does not hold')

  tryBad(sign(Eve, { kind: 'packet-take-unit', hash: 'forge', star: '0', unit: '3', price: '7', fee: '1', to: A.addr },
    serialPacketTakeMessage(NET, A.addr, A.addr, '0', 3n, 7n, '', L.nonceOf(Eve.addr))), /signature|from|already yours|seller/i, 'Eve cannot take with A\'s identity')

  tryBad({
    seq: L.appliedSeq + 1, kind: 'packet-take-unit', hash: 'wrongd', at: 0, from: B.addr, to: A.addr,
    star: '0', unit: '3', price: '7', fee: '1', nonce: L.nonceOf(B.addr), publicKey: B.pk,
    signature: _signKrayWallet(packetTakeMessage(NET, B.addr, A.addr, 'luz', '0', 1n, 7n, '', L.nonceOf(B.addr)), B.sk),
    scheme: 'kraywallet',
  } as KrayEvent, /signature|verify|message/i, 'packet-take.v1 cannot authorize a unit take')

  tryBad(sign(B, { kind: 'packet-take-unit', hash: 'cheap', star: '0', unit: '3', price: '1', fee: '1', to: A.addr },
    serialPacketTakeMessage(NET, B.addr, A.addr, '0', 3n, 1n, '', L.nonceOf(B.addr))), /price|phantom/i, 'a cheaper signed take is a phantom price')

  const beforeTake = { a: L.balanceOf(A.addr), b: L.balanceOf(B.addr), t: L.balanceOf(TREASURY) }
  const take3 = sign(B, { kind: 'packet-take-unit', hash: 't3', star: '0', unit: '3', price: '7', fee: '1', to: A.addr },
    serialPacketTakeMessage(NET, B.addr, A.addr, '0', 3n, 7n, serialPacketTermsHash(L.serialPackets.get('0', 3n) ?? undefined), L.nonceOf(B.addr)))
  push(take3)
  ok(L.cuts.ownerOfUnit('0', 3n) === B.addr, 'atomic take moved unit 3 to B')
  ok(L.serialPackets.get('0', 3n) === null && L.serialPackets.empty(), 'the offer was consumed, once')
  ok(L.balanceOf(A.addr) === beforeTake.a + 7n, 'A received the 7 ₭ price')
  ok(L.balanceOf(B.addr) === beforeTake.b - 7n - 1n, 'B paid price + the eternal fee')
  ok(L.balanceOf(TREASURY) === beforeTake.t + 1n, 'fee went to the treasury')
  ok(L.cuts.conserves() && L.conserves(), 'Σ of units and ₭ held after the take')
  ok(!L.cascadeParts().serialPacketCommitment, 'an empty book drops out of the cascade again (A3)')

  tryBad(sign(C, { kind: 'packet-take-unit', hash: 'twice', star: '0', unit: '3', price: '7', fee: '1', to: A.addr },
    serialPacketTakeMessage(NET, C.addr, A.addr, '0', 3n, 7n, '', L.nonceOf(C.addr))), /not listed/i, 'a second take finds nothing — no twin')

  const list4 = sign(A, { kind: 'packet-list-unit', hash: 'l4', star: '0', unit: '4', price: '0', fee: '1' },
    serialPacketListMessage(NET, A.addr, '0', 4n, 0n, {}, L.nonceOf(A.addr)))
  push(list4)
  ok(L.serialPackets.get('0', 4n)?.price === 0n, 'price 0 is a drop — the unit stays with A until taken')

  push(sign(A, { kind: 'cut-send-unit', hash: 'send4', to: C.addr, star: '0', unit: '4', fee: '1' },
    cutSendUnitMessage(NET, A.addr, C.addr, 0n, 4n, L.nonceOf(A.addr))))
  ok(L.cuts.ownerOfUnit('0', 4n) === C.addr && L.serialPackets.get('0', 4n) === null,
    'sending a listed unit kills the offer — the book never held it')

  tryBad(sign(B, { kind: 'packet-take-unit', hash: 'stale', star: '0', unit: '4', price: '0', fee: '1', to: A.addr },
    serialPacketTakeMessage(NET, B.addr, A.addr, '0', 4n, 0n, '', L.nonceOf(B.addr))), /not listed|stale/i, 'a stale take after the unit moved is refused')

  const list5 = sign(A, { kind: 'packet-list-unit', hash: 'l5', star: '0', unit: '5', price: '3', fee: '1', to: B.addr },
    serialPacketListMessage(NET, A.addr, '0', 5n, 3n, { to: B.addr }, L.nonceOf(A.addr)))
  push(list5)
  const namedTerms = serialPacketTermsHash(L.serialPackets.get('0', 5n) ?? undefined)
  tryBad(sign(C, { kind: 'packet-take-unit', hash: 'named', star: '0', unit: '5', price: '3', fee: '1', to: A.addr, termsHash: namedTerms },
    serialPacketTakeMessage(NET, C.addr, A.addr, '0', 5n, 3n, namedTerms, L.nonceOf(C.addr))),
    /another address|left for/i, 'a named offer refuses every other hand')

  push(sign(A, { kind: 'packet-delist-unit', hash: 'd5', star: '0', unit: '5', fee: '1' },
    serialPacketDelistMessage(NET, A.addr, '0', 5n, L.nonceOf(A.addr))))
  ok(L.serialPackets.get('0', 5n) === null, 'A withdrew unit 5 — nothing ever moved')
  tryBad(sign(B, { kind: 'packet-take-unit', hash: 'gone', star: '0', unit: '5', price: '3', fee: '1', to: A.addr },
    serialPacketTakeMessage(NET, B.addr, A.addr, '0', 5n, 3n, serialPacketTermsHash({ to: B.addr }), L.nonceOf(B.addr))),
    /not listed/i, 'a withdrawn unit cannot be taken')

  ok(L.conserves() && L.cuts.conserves(), 'conserves after the market storm')
  const reboot = new KrayLedger(undefined, NET)
  for (const e of journal) reboot.applyLive(e)
  ok(reboot.cascadeRoot() === L.cascadeRoot(), 'reboot cascade is byte-exact')
  ok(reboot.serialPackets.commitment() === L.serialPackets.commitment(), 'reboot unit-market commitment is byte-exact')
  ok(reboot.cuts.ownerOfUnit('0', 3n) === B.addr && reboot.cuts.ownerOfUnit('0', 4n) === C.addr,
    'unit 3 is still B · unit 4 is still C — nobody minted extra')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks — take moves the id, twins refuse, 77 intact, reboot is exact.\n`)
}
main()
