/**
 * STAR LAW — fittings that close the proof (additive, A3).
 *   node src/test/star-law-proof.test.ts
 *
 * v1 call stays frozen (beacon 0, unsigned at).
 * v2 call signs clock; beacon/interval re-derive from the last Bitcoin seal.
 * rune-send into a law pot is refused (IR pays only ₭).
 * v1 deploy still burns 0 ₭ — that is A3, not a bug.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessageV2, contractCallMessage, contractCallMessageV2,
} from '../protocol/scheme.ts'
import { canonicalCode, isContractPotAddress, type ContractCode } from '../protocol/contract.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
function wallet(tag: string) {
  const sk = createHash('sha256').update('star-law-proof|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}

const MARK: ContractCode = {
  vars: { b: '0', i: '0', t: '0' },
  rules: [{
    name: 'mark',
    when: { lit: '1' },
    then: [
      { set: { var: 'b', to: { ctx: 'beacon' } } },
      { set: { var: 'i', to: { ctx: 'interval' } } },
      { set: { var: 't', to: { ctx: 'at' } } },
    ],
  }],
}

function main() {
  console.log('\n╔═ STAR LAW PROOF — clock · seal beacon · rune pot closed ═╗\n')
  const A = wallet('A')
  const L = new KrayLedger(undefined, NET)
  L.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: A.addr, amount: '10000' } as KrayEvent)
  L.applyLive({
    seq: 2, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'proof', nonce: 0,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'proof'), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const codeHash = sha256hex(canonicalCode(MARK))
  L.applyLive({
    seq: 3, kind: 'contract', hash: 'c', from: A.addr, code: MARK, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, codeHash, 0n), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const pot = L.stars.star(0n)?.contract
  ok(!!pot && isContractPotAddress(pot), 'v2 law hangs on a keyless pot')
  if (!pot) throw new Error('no pot')

  const SEAL = 'ab'.repeat(32)
  L.applyLive({ seq: 4, kind: 'seal', hash: 's', l1Txid: SEAL, at: 0 } as KrayEvent)
  ok(L.lastBitcoinSeal === SEAL && L.bitcoinSeals === 1, 'the last Bitcoin seal is re-derived from the journal')

  L.applyLive({
    seq: 5, kind: 'contract-call', hash: 'v1', from: A.addr, contract: pot, rule: 'mark',
    callArgs: {}, fee: '1', nonce: 1, at: 42,
    publicKey: A.pk, signature: _signKrayWallet(contractCallMessage(NET, A.addr, pot, 'mark', {}, 1), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L.contractAt(pot)?.state.b === '0' && L.contractAt(pot)?.state.i === '0', 'A3 — a v1 call still sees beacon 0 / interval 0 after a seal')
  ok(L.contractAt(pot)?.state.t === '42', 'v1 ctx.at is the journaled e.at — not a signed clock')

  const clock = 1_700_000_000_000
  rejects(() => {
    L.applyLive({
      seq: 6, kind: 'contract-call', hash: 'badclock', from: A.addr, contract: pot, rule: 'mark',
      callArgs: {}, fee: '1', nonce: 2, clock,
      publicKey: A.pk, signature: _signKrayWallet(contractCallMessageV2(NET, A.addr, pot, 'mark', {}, 2, clock + 1), A.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /signature|does not verify/i, 'a v2 call with a tampered clock is refused')

  L.applyLive({
    seq: 6, kind: 'contract-call', hash: 'v2', from: A.addr, contract: pot, rule: 'mark',
    callArgs: {}, fee: '1', nonce: 2, clock,
    publicKey: A.pk, signature: _signKrayWallet(contractCallMessageV2(NET, A.addr, pot, 'mark', {}, 2, clock), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L.contractAt(pot)?.state.b === BigInt('0x' + SEAL).toString(), 'v2 beacon is the last seal txid as an integer')
  ok(L.contractAt(pot)?.state.i === '1', 'v2 interval is seals since genesis')
  ok(L.contractAt(pot)?.state.t === String(clock), 'v2 ctx.at is the signed clock')

  rejects(() => {
    L.applyLive({
      seq: 7, kind: 'rune-send', hash: 'rs', from: A.addr, to: pot, runeId: '1:1', amount: '1', fee: '1', nonce: 3,
    } as KrayEvent)
  }, /law pot|pays only/i, 'rune-send into a law pot is refused — the IR pays only ₭')

  ok(L.conserves(), 'conservation holds after the fittings')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — CLOCK SIGNED · SEAL BEACON RE-DERIVED · RUNE POT CLOSED. ⚖`)
}
main()
