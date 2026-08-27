/**
 * STAR LAW (contract v2) — third canvas on a star.
 *   node src/test/star-law.test.ts
 *
 * Pins: living-desk → IR; v1 frozen (no burn, no star); v2 burns 1 ₭;
 * living mouth travels with the face; transfer-star does not drain the pot;
 * A3 merkle; hostile doors.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessage, contractMessageV2, contractCallMessage, transferMessage, sendStarMessage,
} from '../protocol/scheme.ts'
import { canonicalCode, contractAddress, runCall, validateContract, type ContractCode } from '../protocol/contract.ts'
import { compileLivingLaw, callerInt, defaultLivingFlags } from '../protocol/star-law.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
function wallet(tag: string) {
  const sk = createHash('sha256').update('star-law|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}

function main() {
  console.log('\n╔═ STAR LAW — living desk · v2 burn · living mouth ═╗\n')
  const A = wallet('A')
  const B = wallet('B')

  const flags = defaultLivingFlags()
  const living = compileLivingLaw({ owner: callerInt(A.addr), payout: A.addr, flags })
  ok(validateContract(living).ok, 'default living law compiles to valid IR')
  ok(!!living.vars && living.vars.alive === '1' && living.vars.agent === '0', 'alive on, agent off — 1 and 0, no second type')
  ok(living.rules.some((r) => r.name === 'toggle_alive') && living.rules.some((r) => r.name === 'pulse') && living.rules.some((r) => r.name === 'collect'),
    'desk emits toggle_*, pulse, collect — not a new opcode')
  rejects(() => compileLivingLaw({ owner: callerInt(A.addr), payout: A.addr, flags: [] }), /at least one flag/, 'empty desk is refused')
  rejects(() => compileLivingLaw({ owner: callerInt(A.addr), payout: A.addr, flags: [{ name: 'owner', on: true }] }), /bad flag/, 'owner is reserved')

  const passFlags = [
    { name: 'alive', on: true, motion: 'toggle' as const },
    { name: 'valid', on: true, motion: 'once' as const },
  ]
  const passLaw = compileLivingLaw({ owner: callerInt(A.addr), flags: passFlags })
  ok(passLaw.rules.some((r) => r.name === 'once_valid') && !passLaw.rules.some((r) => r.name === 'toggle_valid'),
    'motion once compiles to once_<flag> — not a toggle')
  ok(passLaw.rules.some((r) => r.name === 'toggle_alive'), 'a sibling toggle still compiles beside an once clause')
  rejects(() => compileLivingLaw({ owner: callerInt(A.addr), flags: [{ name: 'valid', on: false, motion: 'once' }] }),
    /must start true/, 'once starting false is refused — a dead latch cannot fire')
  const ctxA = {
    caller: A.addr, self: 'KRAY_CONTRACT_x', balance: 0n, height: 1n, interval: 0n, at: 0n, beacon: 0n, star: 1n,
    holder: BigInt(callerInt(A.addr)), holderAddress: A.addr,
    args: {}, addressToInt: (a: string) => BigInt('0x' + sha256hex(a).slice(0, 16)),
  }
  const spent = runCall(passLaw, 'once_valid', ctxA, { owner: BigInt(callerInt(A.addr)), alive: 1n, valid: 1n })
  ok(spent.ok && spent.vars.valid === 0n, 'once_valid spends true → false')
  const again = runCall(passLaw, 'once_valid', ctxA, { owner: BigInt(callerInt(A.addr)), alive: 1n, valid: 0n })
  ok(!again.ok, 'a second once_valid is refused — the latch does not return')
  const thief = runCall(passLaw, 'once_valid', { ...ctxA, caller: B.addr, holder: BigInt(callerInt(A.addr)) },
    { owner: BigInt(callerInt(A.addr)), alive: 1n, valid: 1n })
  ok(!thief.ok, 'a stranger cannot spend an once clause — the mouth is the living owner')

  const pulse = runCall(living, 'pulse', {
    caller: B.addr, self: 'KRAY_CONTRACT_x', balance: 0n, height: 1n, interval: 0n, at: 0n, beacon: 0n, star: 0n,
    holder: BigInt(callerInt(A.addr)), holderAddress: A.addr,
    args: {}, addressToInt: (a) => BigInt('0x' + sha256hex(a).slice(0, 16)),
  }, { owner: BigInt(callerInt(A.addr)), alive: 1n, open: 1n, agent: 0n })
  ok(pulse.ok, 'anyone may pulse while alive — public breath; tools are not this')
  const flipStranger = runCall(living, 'toggle_alive', {
    caller: B.addr, self: 'KRAY_CONTRACT_x', balance: 0n, height: 1n, interval: 0n, at: 0n, beacon: 0n, star: 0n,
    holder: BigInt(callerInt(A.addr)), holderAddress: A.addr,
    args: {}, addressToInt: (a) => BigInt('0x' + sha256hex(a).slice(0, 16)),
  }, { owner: BigInt(callerInt(A.addr)), alive: 1n, open: 1n, agent: 0n })
  ok(!flipStranger.ok, 'toggle requires ctx.holder === caller — a stranger has no mouth')
  const flipHolder = runCall(living, 'toggle_alive', {
    caller: B.addr, self: 'KRAY_CONTRACT_x', balance: 0n, height: 1n, interval: 0n, at: 0n, beacon: 0n, star: 0n,
    holder: BigInt(callerInt(B.addr)), holderAddress: B.addr,
    args: {}, addressToInt: (a) => BigInt('0x' + sha256hex(a).slice(0, 16)),
  }, { owner: BigInt(callerInt(A.addr)), alive: 1n, open: 1n, agent: 0n })
  ok(flipHolder.ok && flipHolder.vars.alive === 0n, 'the living holder flips — first-writer var.owner is not the gate')
  const dead = runCall(living, 'pulse', {
    caller: B.addr, self: 'KRAY_CONTRACT_x', balance: 0n, height: 1n, interval: 0n, at: 0n, beacon: 0n,
    args: {}, addressToInt: (a) => BigInt('0x' + sha256hex(a).slice(0, 16)),
  }, { owner: BigInt(callerInt(A.addr)), alive: 0n, open: 1n, agent: 0n })
  ok(!dead.ok, 'pulse while alive=false → refused, nothing moves')

  const L = new KrayLedger(undefined, NET)
  L.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: A.addr, amount: '10000' } as KrayEvent)
  let seq = 1
  const next = () => ++seq
  const signName = (ledger: KrayLedger, name: string) => {
    const n = ledger.nonceOf(A.addr)
    return {
      seq: next(), at: 0, from: A.addr, publicKey: A.pk,
      signature: _signKrayWallet(nameMessageV2(NET, A.addr, n, name), A.sk),
      scheme: 'kraywallet', kind: 'name', name, nonce: n, hash: 'n' + seq,
    } as unknown as KrayEvent
  }
  L.applyLive(signName(L, 'lawstar'))
  ok(L.stars.star(0n)?.name === 'lawstar', 'star #0 exists — the face')
  const merkleBare = L.stars.merkleRoot()
  const burned0 = L.totalBurned
  const bal0 = L.balanceOf(A.addr)

  const splitter: ContractCode = {
    vars: { paid: '0' },
    rules: [{
      name: 'release',
      when: { op: 'ge', args: [{ ctx: 'balance' }, { arg: 'amount' }] },
      then: [
        { set: { var: 'paid', to: { op: 'add', args: [{ var: 'paid' }, { arg: 'amount' }] } } },
        { pay: { to: { addr: B.addr }, amount: { arg: 'amount' } } },
      ],
    }],
  }
  const v1Hash = sha256hex(canonicalCode(splitter))
  seq++
  L.applyLive({
    seq, kind: 'contract', hash: 'v1', from: A.addr, code: splitter,
    publicKey: A.pk, signature: _signKrayWallet(contractMessage(NET, A.addr, v1Hash), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const v1addr = L.allContractAddresses()[0]
  ok(!!v1addr && !L.contractAt(v1addr)?.star, 'v1 deploy still seals a pot with no star')
  ok(L.totalBurned === burned0 && L.balanceOf(A.addr) === bal0, 'A3 — v1 burns nothing (frozen path)')
  ok(L.stars.merkleRoot() === merkleBare, 'A3 — a v1 pot does not touch the star merkle')

  const codeHash = sha256hex(canonicalCode(living))
  ok(contractMessageV2(NET, A.addr, codeHash, 0n).startsWith('kray-core.contract.v2|'), 'v2 domain is separate — v1 stays frozen')
  seq++
  L.applyLive({
    seq, kind: 'contract', hash: 'v2', from: A.addr, code: living, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, codeHash, 0n), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const pot = contractAddress(codeHash, A.addr, seq)
  ok(L.stars.star(0n)?.contract === pot, 'star #0 points at the keyless pot')
  ok(L.contractAt(pot)?.star === '0', 'the pot remembers the bound star')
  ok(L.contractAt(pot)?.codeHash === codeHash, 'the public view names the signed codeHash')
  ok(!!L.contractAt(pot)?.code?.rules?.length, 'the public view is the sealed IR — not only rule names')
  ok(L.totalBurned === burned0 + 1n && L.balanceOf(A.addr) === bal0 - 1n, 'v2 burns exactly 1 ₭ — the law is born from fire')
  ok(L.stars.merkleRoot() !== merkleBare, 'binding the law extends the star merkle')
  ok(L.conserves(), 'conservation holds after the burn')

  const Lbare = new KrayLedger(undefined, NET)
  Lbare.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: A.addr, amount: '10000' } as KrayEvent)
  Lbare.applyLive({
    seq: 2, kind: 'name', hash: 'n2', at: 0, from: A.addr, name: 'lawstar', nonce: 0,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'lawstar'), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(Lbare.stars.merkleRoot() === merkleBare, 'A3 — a twin journal that never saw v2 keeps the pre-law merkle')

  seq++
  L.applyLive({
    seq, kind: 'contract', hash: 'again', from: A.addr, code: living, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, codeHash, 0n), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(false, 'second law on the same star should refuse')
}
try { main() } catch (e) {
  if (!/already carries a law/.test((e as Error).message)) {
    console.error(e)
    process.exit(1)
  }
  pass++
  console.log('  ✓ second law on the same star → refused')
}

function rest() {
  const A = wallet('A')
  const B = wallet('B')
  const L = new KrayLedger(undefined, NET)
  L.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: A.addr, amount: '10000' } as KrayEvent)
  let seq = 1
  const next = () => ++seq
  L.applyLive({
    seq: next(), kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'face', nonce: 0,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'face'), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const living = compileLivingLaw({ owner: callerInt(A.addr), payout: A.addr, flags: defaultLivingFlags() })
  const codeHash = sha256hex(canonicalCode(living))
  const here: ContractCode = {
    vars: { hit: '99' },
    rules: [{
      name: 'here',
      when: { op: 'eq', args: [{ ctx: 'star' }, { lit: '0' }] },
      then: [{ set: { var: 'hit', to: { ctx: 'star' } } }],
    }],
  }
  const hereHash = sha256hex(canonicalCode(here))
  L.applyLive({
    seq: next(), kind: 'contract', hash: 'here', from: A.addr, code: here, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, hereHash, 0n), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const potHere = contractAddress(hereHash, A.addr, seq)
  L.applyLive({
    seq: next(), kind: 'contract-call', hash: 'call', from: A.addr, contract: potHere, rule: 'here',
    callArgs: {}, fee: '1', nonce: 1,
    publicKey: A.pk, signature: _signKrayWallet(contractCallMessage(NET, A.addr, potHere, 'here', {}, 1), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L.contractAt(potHere)?.state.hit === '0', 'ctx.star is the bound creation number — the being knows its face')

  const L2 = new KrayLedger(undefined, NET)
  L2.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: A.addr, amount: '10000' } as KrayEvent)
  L2.applyLive({ seq: 2, kind: 'donate', hash: 'db', to: B.addr, amount: '50' } as KrayEvent)
  L2.applyLive({
    seq: 3, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'move', nonce: 0,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'move'), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  L2.applyLive({
    seq: 4, kind: 'contract', hash: 'v2', from: A.addr, code: living, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, codeHash, 0n), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const pot = contractAddress(codeHash, A.addr, 4)
  L2.applyLive({
    seq: 5, kind: 'transfer', hash: 'fund', from: A.addr, to: pot, amount: '50', fee: '1', nonce: 1,
    publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, pot, 50n, 1), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L2.balanceOf(pot) === 50n, 'value added on the star — ₭ sits in the keyless pot')
  L2.applyLive({
    seq: 6, kind: 'transfer-star', hash: 'mv', from: A.addr, to: B.addr, star: '0', fee: '1', nonce: 2,
    publicKey: A.pk, signature: _signKrayWallet(sendStarMessage(NET, A.addr, B.addr, 0n, 2), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L2.stars.star(0n)?.owner === B.addr, 'the face moved')
  ok(L2.stars.star(0n)?.contract === pot && L2.balanceOf(pot) === 50n, 'transfer-star does not drain the pot — the value stays keyless')
  ok(L2.contractAt(pot)?.star === '0', 'the leash still names star #0')

  rejects(() => {
    L2.applyLive({
      seq: 7, kind: 'contract-call', hash: 'sold', from: A.addr, contract: pot, rule: 'toggle_alive',
      callArgs: {}, fee: '1', nonce: 3,
      publicKey: A.pk, signature: _signKrayWallet(contractCallMessage(NET, A.addr, pot, 'toggle_alive', {}, 3), A.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /living owner|mouth travels/i, 'seller lost the mouth — toggle refuses after the sale')
  L2.applyLive({
    seq: 7, kind: 'contract-call', hash: 'buyflip', from: B.addr, contract: pot, rule: 'toggle_agent',
    callArgs: {}, fee: '1', nonce: 0,
    publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, pot, 'toggle_agent', {}, 0), B.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L2.contractAt(pot)?.state.agent === '1', 'buyer flipped agent — the received key runs the tools')
  rejects(() => {
    L2.applyLive({
      seq: 8, kind: 'contract-call', hash: 'soldk', from: A.addr, contract: pot, rule: 'collect',
      callArgs: {}, fee: '1', nonce: 3,
      publicKey: A.pk, signature: _signKrayWallet(contractCallMessage(NET, A.addr, pot, 'collect', {}, 3), A.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /living owner|mouth travels/i, 'seller cannot collect — the pot is no longer their mouth')
  const buyerBal = L2.balanceOf(B.addr)
  L2.applyLive({
    seq: 8, kind: 'contract-call', hash: 'out', from: B.addr, contract: pot, rule: 'collect',
    callArgs: {}, fee: '1', nonce: 1,
    publicKey: B.pk, signature: _signKrayWallet(contractCallMessage(NET, B.addr, pot, 'collect', {}, 1), B.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L2.balanceOf(pot) === 0n && L2.balanceOf(B.addr) === buyerBal - 1n + 50n, 'collect pays the living owner — 50 ₭ to the buyer, not the sealer')
  ok(L2.conserves(), 'living-mouth sale conserves')
  ok(L2.stars.ownerOf(0n) === B.addr && L2.stars.star(0n)?.contract === pot, 'ownerOf is the mathematical mouth — BIP-340 of B + p2tr(B) === star.owner')

  rejects(() => {
    L2.applyLive({
      seq: 9, kind: 'contract', hash: 'thief', from: B.addr, code: living, star: '0',
      publicKey: B.pk, signature: _signKrayWallet(contractMessageV2(NET, B.addr, codeHash, 0n), B.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /already carries a law/, 'new holder cannot overwrite the leash')

  const L3 = new KrayLedger(undefined, NET)
  L3.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: A.addr, amount: '10000' } as KrayEvent)
  L3.applyLive({
    seq: 2, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'door', nonce: 0,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'door'), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  rejects(() => {
    L3.applyLive({
      seq: 3, kind: 'contract', hash: 'x', from: A.addr, code: living, star: '0',
      publicKey: A.pk, signature: _signKrayWallet(contractMessage(NET, A.addr, codeHash), A.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /verif|signat|message|Supreme/i, 'v1 signature on a v2 body (star set) → refused')
  rejects(() => {
    L3.applyLive({
      seq: 3, kind: 'contract', hash: 'x', from: B.addr, code: living, star: '0',
      publicKey: B.pk, signature: _signKrayWallet(contractMessageV2(NET, B.addr, codeHash, 0n), B.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /only the owner/, 'a stranger cannot put a law on your star')
  rejects(() => {
    L3.applyLive({
      seq: 3, kind: 'contract', hash: 'x', from: A.addr, code: living, star: '99',
      publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, codeHash, 99n), A.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /does not exist/, 'law on an unborn star → refused')
  ok(L3.conserves() && L3.stars.star(0n)?.contract == null, 'every refused door left the face without a law')

  const L4 = new KrayLedger(undefined, NET)
  L4.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: A.addr, amount: '10000' } as KrayEvent)
  L4.applyLive({
    seq: 2, kind: 'name', hash: 'n', at: 0, from: A.addr, name: 'pass', nonce: 0,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, 0, 'pass'), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const latch = compileLivingLaw({
    owner: callerInt(A.addr),
    flags: [
      { name: 'alive', on: true, motion: 'toggle' },
      { name: 'valid', on: true, motion: 'once' },
    ],
  })
  const latchHash = sha256hex(canonicalCode(latch))
  L4.applyLive({
    seq: 3, kind: 'contract', hash: 'latch', from: A.addr, code: latch, star: '0',
    publicKey: A.pk, signature: _signKrayWallet(contractMessageV2(NET, A.addr, latchHash, 0n), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const latchPot = L4.stars.star(0n)!.contract!
  L4.applyLive({
    seq: 4, kind: 'contract-call', hash: 'once1', from: A.addr, contract: latchPot, rule: 'once_valid',
    callArgs: {}, fee: '1', nonce: 1,
    publicKey: A.pk, signature: _signKrayWallet(contractCallMessage(NET, A.addr, latchPot, 'once_valid', {}, 1), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L4.contractAt(latchPot)?.state.valid === '0', 'ledger once_valid spends the latch — journal is 0')
  rejects(() => {
    L4.applyLive({
      seq: 5, kind: 'contract-call', hash: 'once2', from: A.addr, contract: latchPot, rule: 'once_valid',
      callArgs: {}, fee: '1', nonce: 2,
      publicKey: A.pk, signature: _signKrayWallet(contractCallMessage(NET, A.addr, latchPot, 'once_valid', {}, 2), A.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }, /guard|refused/, 'second once_valid on the ledger is refused — the latch does not return')
  ok(L4.conserves(), 'once motion conserves')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — STAR LAW HOLDS: desk→IR, toggle + once motions, v1 frozen, v2 burns 1 ₭, living mouth travels with the face, collect pays the buyer, every hostile door refused. ⚖⭐`)
}
rest()
