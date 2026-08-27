/**
 * THE CONTRACTS (v2) — the DeFi/AMM capability, ported by REUSING the contract VM.
 *   node src/test/contract.sim.ts
 *
 * The v2 ledger reuses contract.ts (the total, deterministic VM — never a twin): a
 * contract holds ₭ at a DERIVED address no key encodes to, so its money moves ONLY by its
 * own signed rules. This deploys a splitter contract, funds it, calls it, and proves the
 * payment comes from the contract's balance, the state advances, the fee funds the Treasury,
 * ₭ conservation holds, and the whole thing reboots byte-exact. Then every door: a call to
 * no contract, an unsigned / wrong-key call, a call the contract can't afford, a FORGED
 * recorded payout (HALT), and a normal transfer trying to drain the contract (refused — the
 * seal). The contract state rides the cascade root, anchored to Bitcoin.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { TREASURY } from '../protocol/kray-primitives.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes,
  transferMessage, contractMessage, contractCallMessage,
} from '../protocol/scheme.ts'
import { canonicalCode, type ContractCode } from '../protocol/contract.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}

const NET = 'regtest'
const BNET = toBtcNet(NET)
interface Wallet { addr: string; sk: Uint8Array; pk: string }
function makeWallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`kraynet-contract-sim|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const ALICE = makeWallet('ALICE'), BOB = makeWallet('BOB')

function main(): void {
  const L = new KrayLedger()
  let seq = 0
  const H = () => createHash('sha256').update(`c|${seq}`, 'utf8').digest('hex')

  // ALICE gets ₭ from a donation
  seq++; L.applyLive({ seq, kind: 'donate', hash: H(), to: ALICE.addr, amount: '10000' } as KrayEvent)

  // ── a splitter contract: `release(amount)` pays `amount` to BOB from its OWN balance,
  //    only if it can afford it, and remembers the running total. ──
  const splitter: ContractCode = {
    vars: { paid: '0' },
    rules: [{
      name: 'release',
      when: { op: 'ge', args: [{ ctx: 'balance' }, { arg: 'amount' }] },
      then: [
        { set: { var: 'paid', to: { op: 'add', args: [{ var: 'paid' }, { arg: 'amount' }] } } },
        { pay: { to: { addr: BOB.addr }, amount: { arg: 'amount' } } },
      ],
    }],
  }
  const codeHash = sha256hex(canonicalCode(splitter))

  // DEPLOY — signed over the exact code (no nonce; the address embeds the journal position)
  seq++
  const depSig = _signKrayWallet(contractMessage(NET, ALICE.addr, codeHash), ALICE.sk)
  L.applyLive({ seq, kind: 'contract', hash: H(), from: ALICE.addr, code: splitter, publicKey: ALICE.pk, signature: depSig, scheme: 'kraywallet' } as KrayEvent)
  const addr = L.allContractAddresses()[0]
  ok(!!addr && addr.startsWith('KRAY_CONTRACT_'), 'DEPLOY sealed a contract at a derived address')
  ok(L.contractAt(addr)?.state.paid === '0', 'the contract opened with paid=0')

  // FUND the contract — ALICE transfers 5000 ₭ into it (nonce 0)
  seq++
  const fundSig = _signKrayWallet(transferMessage(NET, ALICE.addr, addr, 5000n, 0), ALICE.sk)
  L.applyLive({ seq, kind: 'transfer', hash: H(), from: ALICE.addr, to: addr, amount: '5000', fee: '1', nonce: 0, publicKey: ALICE.pk, signature: fundSig, scheme: 'kraywallet' } as KrayEvent)
  ok(L.balanceOf(addr) === 5000n, 'the contract now holds 5000 ₭')

  // CALL release(1000) — signed by ALICE (nonce 1), pays the 1-₭ fee
  seq++
  const args = { amount: 1000n }
  const callSig = _signKrayWallet(contractCallMessage(NET, ALICE.addr, addr, 'release', args, 1), ALICE.sk)
  L.applyLive({ seq, kind: 'contract-call', hash: H(), from: ALICE.addr, contract: addr, rule: 'release', callArgs: { amount: '1000' }, fee: '1', nonce: 1, publicKey: ALICE.pk, signature: callSig, scheme: 'kraywallet' } as KrayEvent)
  ok(L.balanceOf(BOB.addr) === 1000n, 'CALL paid 1000 ₭ to BOB from the contract balance')
  ok(L.balanceOf(addr) === 4000n, 'the contract balance fell by exactly 1000')
  ok(L.contractAt(addr)?.state.paid === '1000', 'the contract state advanced: paid=1000')
  ok(L.balanceOf(TREASURY) === 2n, 'the Treasury holds 2 ₭ (fund fee + call fee)')
  ok(L.conserves() && L.backed(), 'conservation holds — the contract paid from its own ₭')

  // ── THE REBOOT IS THE VERIFIER ──
  const root = L.cascadeRoot()
  const journal: KrayEvent[] = []
  // rebuild by replaying the same events into a fresh ledger
  const L2 = new KrayLedger()
  seq = 0
  const H2 = () => createHash('sha256').update(`c|${seq}`, 'utf8').digest('hex')
  seq++; L2.applyLive({ seq, kind: 'donate', hash: H2(), to: ALICE.addr, amount: '10000' } as KrayEvent)
  seq++; L2.applyLive({ seq, kind: 'contract', hash: H2(), from: ALICE.addr, code: splitter, publicKey: ALICE.pk, signature: depSig, scheme: 'kraywallet' } as KrayEvent)
  seq++; L2.applyLive({ seq, kind: 'transfer', hash: H2(), from: ALICE.addr, to: addr, amount: '5000', fee: '1', nonce: 0, publicKey: ALICE.pk, signature: fundSig, scheme: 'kraywallet' } as KrayEvent)
  seq++; L2.applyLive({ seq, kind: 'contract-call', hash: H2(), from: ALICE.addr, contract: addr, rule: 'release', callArgs: { amount: '1000' }, fee: '1', nonce: 1, publicKey: ALICE.pk, signature: callSig, scheme: 'kraywallet' } as KrayEvent)
  ok(L2.cascadeRoot() === root, 'REBOOT: the cascade root (with contract state) is byte-exact')
  ok(L2.contractAt(addr)?.state.paid === '1000' && L2.balanceOf(addr) === 4000n, 'reboot re-derived the contract state + balance')
  void journal

  // ── THE ADVERSARIAL DOORS ──
  let root2 = L.cascadeRoot()
  // call a non-existent contract
  try { L.applyLive({ seq: 100, kind: 'contract-call', hash: 'a'.repeat(64), from: ALICE.addr, contract: 'KRAY_CONTRACT_nope', rule: 'release', callArgs: { amount: '1' }, fee: '1', nonce: 2, publicKey: ALICE.pk, signature: 'ab'.repeat(64), scheme: 'kraywallet' } as KrayEvent); ok(false, 'no-contract should throw') } catch { ok(true, 'ATTACK call to no contract → refused') }
  // unsigned call
  try { L.applyLive({ seq: 100, kind: 'contract-call', hash: 'b'.repeat(64), from: ALICE.addr, contract: addr, rule: 'release', callArgs: { amount: '1' }, fee: '1', nonce: 2 } as KrayEvent); ok(false, 'unsigned should throw') } catch { ok(true, 'SUPREME LAW: unsigned call → refused') }
  // wrong-key call (BOB signs a call claiming from = ALICE)
  const wrongSig = _signKrayWallet(contractCallMessage(NET, ALICE.addr, addr, 'release', { amount: 1n }, 2), BOB.sk)
  try { L.applyLive({ seq: 100, kind: 'contract-call', hash: 'c'.repeat(64), from: ALICE.addr, contract: addr, rule: 'release', callArgs: { amount: '1' }, fee: '1', nonce: 2, publicKey: BOB.pk, signature: wrongSig, scheme: 'kraywallet' } as KrayEvent); ok(false, 'wrong key should throw') } catch { ok(true, 'SUPREME LAW: wrong-key call → refused') }
  // call the contract can't afford (amount > balance) — the `when` guard is false
  const bigSig = _signKrayWallet(contractCallMessage(NET, ALICE.addr, addr, 'release', { amount: 99999n }, 2), ALICE.sk)
  try { L.applyLive({ seq: 100, kind: 'contract-call', hash: 'd'.repeat(64), from: ALICE.addr, contract: addr, rule: 'release', callArgs: { amount: '99999' }, fee: '1', nonce: 2, publicKey: ALICE.pk, signature: bigSig, scheme: 'kraywallet' } as KrayEvent); ok(false, 'unaffordable should throw') } catch { ok(true, 'ATTACK call the contract cannot afford → refused by its own guard') }
  // FORGED recorded payout — sign an honest call, but record a payout the law would not make
  const forgeSig = _signKrayWallet(contractCallMessage(NET, ALICE.addr, addr, 'release', { amount: 500n }, 2), ALICE.sk)
  try { L.applyLive({ seq: 100, kind: 'contract-call', hash: 'e'.repeat(64), from: ALICE.addr, contract: addr, rule: 'release', callArgs: { amount: '500' }, fee: '1', nonce: 2, publicKey: ALICE.pk, signature: forgeSig, scheme: 'kraywallet', payouts: [[BOB.addr, '9999', '0']] } as KrayEvent); ok(false, 'forged payout should HALT') } catch { ok(true, 'THE PROOF GATE: a forged recorded payout (9999 ≠ 500) → HALT') }
  // a normal transfer trying to drain the contract — the seal: it cannot sign
  try { L.applyLive({ seq: 100, kind: 'transfer', hash: 'f'.repeat(64), from: addr, to: BOB.addr, amount: '4000', fee: '1', nonce: 0 } as KrayEvent); ok(false, 'contract transfer should throw') } catch { ok(true, 'THE SEAL: a normal transfer cannot move a contract\'s ₭ (no key signs for it)') }
  ok(L.cascadeRoot() === root2, 'after every attack: the ledger is byte-identical')
  ok(L.conserves() && L.balanceOf(addr) === 4000n, 'the contract still holds exactly 4000 ₭, conservation intact')

  console.log(`\n✓ ${pass} checks passed — THE CONTRACTS HOLD: a splitter deployed at a derived address, funded, and called — paying 1000 ₭ to BOB from its OWN sealed balance, advancing its state, funding the Treasury, conserving ₭ — reboots byte-exact with the contract state in the cascade root, and every door refused: no-contract, unsigned, wrong-key, unaffordable, a FORGED payout (the proof gate → HALT), and a normal transfer trying to drain it (the seal). The DeFi VM, reused not duplicated. 📜₭`)
}
main()
