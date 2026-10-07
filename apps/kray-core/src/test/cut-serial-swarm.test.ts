/**
 * KRC-7777 SERIAL LUZ — prove by breaking, then reboot.
 *   node src/test/cut-serial-swarm.test.ts
 *
 * In-memory. Does not touch Signet, main, or the living journal.
 * Knob-off paper stays byte-identical. Pin refuses off-regtest. Σ of units
 * is supply. A fungible cut-send cannot move a serial unit.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessageV2, cutSendMessage, cutSendUnitMessage, xSendMessage,
} from '../protocol/scheme.ts'
import { canonicalCode } from '../protocol/contract.ts'
import { compileCut, compileForm, isCutPaper, isSerialCutPaper } from '../protocol/star-forms.ts'
import { CutBook, SERIAL_LUZ_SEQ, MAX_SERIAL_CUT_SUPPLY } from '../protocol/cut-book.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}

function wallet(tag: string) {
  const sk = createHash('sha256').update('serial-luz|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex, tag }
}
type W = ReturnType<typeof wallet>

function main() {
  console.log('\n╔═ KRC-7777 SERIAL LUZ — knob · pin · unit · reboot ═╗\n')

  const fungible = compileCut({ supply: '100000' })
  const alsoFungible = compileForm({ kind: 'luz', supply: '100000' })
  ok(isCutPaper(fungible) && !isSerialCutPaper(fungible), 'KRC-77 paper has no serial knob')
  ok(canonicalCode(fungible) === canonicalCode(alsoFungible), 'compileCut without serial is the same sealed paper')
  ok(fungible.vars?.serial === undefined, 'absent serial field — A3, not serial:0')

  rejects(() => compileCut({ serial: true, infinite: true }), /infinite/, 'serial + infinite is refused')
  rejects(() => compileCut({ serial: true, supply: String(MAX_SERIAL_CUT_SUPPLY + 1) }), /at most/, 'serial above the ceiling is refused')
  ok(compileCut({ serial: true, supply: String(MAX_SERIAL_CUT_SUPPLY) }).vars?.supply === String(MAX_SERIAL_CUT_SUPPLY), 'the ceiling itself is a legal supply')
  const ceilingBook = new CutBook()
  ceilingBook.genesisSerial('9', BigInt(MAX_SERIAL_CUT_SUPPLY), [{ to: 'A', amount: BigInt(MAX_SERIAL_CUT_SUPPLY) }])
  ok(ceilingBook.conserves()
    && ceilingBook.ownerOfUnit('9', 1n) === 'A'
    && ceilingBook.ownerOfUnit('9', BigInt(MAX_SERIAL_CUT_SUPPLY)) === 'A'
    && ceilingBook.commitment().split('\n').length === MAX_SERIAL_CUT_SUPPLY,
    '21,000 ids, one owner line each, Σ holds')
  ok(compileForm({ kind: 'cut-serial', supply: '10000' }).vars?.supply === '10000', '10,000 copies fit under the 21,000 ceiling')

  const paper = compileCut({ serial: true, supply: '6' })
  const fromForm = compileForm({ kind: 'cut-serial', supply: '6' })
  ok(isSerialCutPaper(paper) && paper.vars?.serial === '1' && paper.vars?.supply === '6', 'KRC-7777 paper seals serial=1 · supply 6')
  ok(canonicalCode(paper) === canonicalCode(fromForm), 'two mouths, one compiler')
  ok(canonicalCode(paper) !== canonicalCode(fungible), 'serial paper is a different sealed hash')

  ok(SERIAL_LUZ_SEQ.regtest === 0 && SERIAL_LUZ_SEQ.signet === 0 && SERIAL_LUZ_SEQ.main === 0,
    'all three networks are born with the law — an empty or fungible book adds no serial line')

  const empty = new KrayLedger(undefined, NET)
  ok(!empty.cascadeParts().cutCommitment, 'empty book is still absent from the cascade (A3)')

  const A = wallet('A'), B = wallet('B'), C = wallet('C'), Eve = wallet('eve')
  const L = new KrayLedger(undefined, NET)
  const journal: KrayEvent[] = []
  const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
  const snap = () => ({
    root: L.cascadeRoot(),
    cut: L.cuts.commitment(),
    a: L.cuts.of('0', A.addr).toString(),
    owner3: L.cuts.ownerOfUnit('0', 3n),
  })
  const frozen = (s: ReturnType<typeof snap>, m: string) => {
    const n = snap()
    ok(n.root === s.root && n.cut === s.cut && n.a === s.a && n.owner3 === s.owner3 && L.conserves() && L.cuts.conserves(), m)
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
  push(sign(A, { kind: 'name', hash: 'n0', name: 'serialsix' }, nameMessageV2(NET, A.addr, 0, 'serialsix'), 0))
  const ch = sha256hex(canonicalCode(paper))
  push(sign(A, { kind: 'contract', hash: 'c0', code: paper, star: '0' }, contractMessageV2(NET, A.addr, ch, 0n)))

  ok(L.cuts.isSerial('0') && L.cuts.of('0', A.addr) === 6n, 'DESTINY: sealer holds units 1..6')
  ok(L.cuts.ownerOfUnit('0', 1n) === A.addr && L.cuts.ownerOfUnit('0', 6n) === A.addr, 'every id 1..6 is A')
  ok(L.cuts.view('0')?.serial === true && (L.cuts.view('0')?.units || []).length === 6, 'view lists six unit ids')
  ok(L.cuts.conserves() && L.cascadeParts().cutCommitment?.includes('|u|'), 'serial commitment uses the u tag')

  const nA = L.nonceOf(A.addr)
  tryBad(sign(A, { kind: 'cut-send', hash: 'fung', to: B.addr, star: '0', amount: '1', fee: '1' },
    cutSendMessage(NET, A.addr, B.addr, 0n, 1n, nA)), /serial|unit/i, 'fungible cut-send cannot move a serial book')

  tryBad({
    seq: L.appliedSeq + 1, kind: 'cut-send-unit', hash: 'fg', from: A.addr, to: Eve.addr, star: '0', unit: '3', fee: '1', nonce: nA,
    publicKey: Eve.pk, signature: _signKrayWallet(cutSendUnitMessage(NET, A.addr, Eve.addr, 0n, 3n, nA), Eve.sk), scheme: 'kraywallet',
  } as KrayEvent, /signature|verify|key/i, 'Eve forges A\'s unit send')

  tryBad({
    seq: L.appliedSeq + 1, kind: 'cut-send-unit', hash: 'x', from: A.addr, to: B.addr, star: '0', unit: '3', fee: '1', nonce: nA,
    publicKey: A.pk, signature: _signKrayWallet(xSendMessage(NET, A.addr, B.addr, 1n, nA), A.sk), scheme: 'kraywallet',
  } as KrayEvent, /signature|verify|message/i, 'Ӿ signature cannot move a serial unit')

  tryBad({
    seq: L.appliedSeq + 1, kind: 'cut-send-unit', hash: 'cs', from: A.addr, to: B.addr, star: '0', unit: '3', fee: '1', nonce: nA,
    publicKey: A.pk, signature: _signKrayWallet(cutSendMessage(NET, A.addr, B.addr, 0n, 1n, nA), A.sk), scheme: 'kraywallet',
  } as KrayEvent, /signature|verify|message/i, 'cut-send.v1 cannot authorize cut-send-unit')

  tryBad({
    seq: L.appliedSeq + 1, kind: 'cut-send-unit', hash: 'u4', from: A.addr, to: B.addr, star: '0', unit: '4', fee: '1', nonce: nA,
    publicKey: A.pk, signature: _signKrayWallet(cutSendUnitMessage(NET, A.addr, B.addr, 0n, 3n, nA), A.sk), scheme: 'kraywallet',
  } as KrayEvent, /signature|verify|message/i, 'signed unit 3, journaled unit 4')

  tryBad(sign(Eve, { kind: 'cut-send-unit', hash: 'ev', to: A.addr, star: '0', unit: '3', fee: '1' },
    cutSendUnitMessage(NET, Eve.addr, A.addr, 0n, 3n, L.nonceOf(Eve.addr))), /not yours|insufficient/i, 'Eve does not own unit 3')

  push(sign(A, { kind: 'cut-send-unit', hash: 'ok3', to: B.addr, star: '0', unit: '3', fee: '1' },
    cutSendUnitMessage(NET, A.addr, B.addr, 0n, 3n, L.nonceOf(A.addr))))
  ok(L.cuts.ownerOfUnit('0', 3n) === B.addr && L.cuts.of('0', A.addr) === 5n && L.cuts.of('0', B.addr) === 1n,
    'honest send: unit 3 is B · A holds 5')
  ok(L.cuts.conserves() && L.cuts.view('0')?.circulating === '6', 'Σ still 6 after one unit moved')

  tryBad(sign(A, { kind: 'cut-send-unit', hash: 'rp', to: B.addr, star: '0', unit: '3', fee: '1' },
    cutSendUnitMessage(NET, A.addr, B.addr, 0n, 3n, nA), nA), /nonce|signature|not yours|insufficient/i, 'replay the pre-send nonce / unit')

  tryBad(sign(A, { kind: 'cut-send-unit', hash: 'gone', to: C.addr, star: '0', unit: '3', fee: '1' },
    cutSendUnitMessage(NET, A.addr, C.addr, 0n, 3n, L.nonceOf(A.addr))), /not yours|insufficient/i, 'A cannot send unit 3 twice')

  push(sign(B, { kind: 'cut-send-unit', hash: 'ok3b', to: C.addr, star: '0', unit: '3', fee: '1' },
    cutSendUnitMessage(NET, B.addr, C.addr, 0n, 3n, L.nonceOf(B.addr))))
  ok(L.cuts.ownerOfUnit('0', 3n) === C.addr, 'B hands unit 3 to C')

  // founders: B=2, C=1, remainder 3 to A — units 1..2 B, 3 C, 4..6 A
  push(sign(A, { kind: 'name', hash: 'nfound', name: 'serfound' }, nameMessageV2(NET, A.addr, L.nonceOf(A.addr), 'serfound')))
  const table = compileCut({ serial: true, supply: '6', founders: [{ to: B.addr, amount: '2' }, { to: C.addr, amount: '1' }] })
  const fh = sha256hex(canonicalCode(table))
  const faceF = L.stars.createdSeq - 1n
  push(sign(A, { kind: 'contract', hash: 'cf', code: table, star: faceF.toString() }, contractMessageV2(NET, A.addr, fh, faceF)))
  const fk = faceF.toString()
  ok(L.cuts.isSerial(fk) && L.cuts.ownerOfUnit(fk, 1n) === B.addr && L.cuts.ownerOfUnit(fk, 2n) === B.addr,
    'founder B takes units 1..2')
  ok(L.cuts.ownerOfUnit(fk, 3n) === C.addr && L.cuts.ownerOfUnit(fk, 4n) === A.addr,
    'founder C takes unit 3 · remainder 4..6 to sealer')
  ok(L.cuts.of(fk, A.addr) === 3n && L.cuts.conserves(), 'founder table Σ == 6')

  // pin: a second ledger with the live dormant pin refuses serial seal
  // serialLuzSeq is the last ctor pin on this line — every earlier slot stays the network default.
  const dormant = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, Number.MAX_SAFE_INTEGER)
  dormant.applyLive({ seq: 1, kind: 'donate', hash: 'dx', to: A.addr, amount: '4000' } as KrayEvent)
  const n0 = dormant.nonceOf(A.addr)
  dormant.applyLive({
    seq: 2, kind: 'name', hash: 'np', from: A.addr, name: 'pinface', publicKey: A.pk,
    signature: _signKrayWallet(nameMessageV2(NET, A.addr, n0, 'pinface'), A.sk), scheme: 'kraywallet', nonce: n0, at: 0,
  } as unknown as KrayEvent)
  const pinMsg = contractMessageV2(NET, A.addr, ch, 0n)
  const beforePin = dormant.cascadeRoot()
  try {
    dormant.applyLive({
      seq: 3, kind: 'contract', hash: 'cpin', from: A.addr, code: paper, star: '0', publicKey: A.pk,
      signature: _signKrayWallet(pinMsg, A.sk), scheme: 'kraywallet', nonce: dormant.nonceOf(A.addr), at: 0,
    } as unknown as KrayEvent)
    ok(false, 'dormant pin must refuse a serial seal')
  } catch (e) {
    ok(/not the law|serial/i.test((e as Error).message), 'dormant pin refuses a serial seal')
    ok(dormant.cascadeRoot() === beforePin && !dormant.cuts.has('0'), 'dormant pin — no serial root grew')
  }

  ok(L.conserves() && L.cuts.conserves(), 'conserves after the serial storm')
  const reboot = new KrayLedger(undefined, NET)
  for (const e of journal) reboot.applyLive(e)
  ok(reboot.cascadeRoot() === L.cascadeRoot(), 'reboot cascade is byte-exact')
  ok(reboot.cuts.commitment() === L.cuts.commitment(), 'reboot serial commitment is byte-exact')
  ok(reboot.cuts.ownerOfUnit('0', 3n) === C.addr && reboot.cuts.of('0', A.addr) === 5n, 'unit 3 survives replay — nobody minted extra')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks — knob-off intact, pin dormant, unit 3 moves, refusals freeze, reboot is exact. ✧\n`)
}
main()
