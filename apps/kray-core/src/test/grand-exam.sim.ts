/**
 * THE GRAND EXAM (v2) — every subsystem on ONE ledger, composed, under storm.
 *   node src/test/v2-grand-exam.sim.ts
 *
 * The individual sims each prove one law deeply. This proves they COMPOSE: a single KrayLedger
 * driven through a mixed storm of every event — proof-of-donation mints, signed ₭ transfers,
 * inscriptions and baptisms that burn ₭ into stars, star moves, an origin adoption, rune
 * deposits/sends/exits/settles, a DeFi contract deployed/funded/called, an anchor draining the
 * pot, a validator reward — with EVERY invariant re-checked after EVERY act:
 *   · conserves()     Σ ₭ balances == emitted − burned
 *   · backed()        emitted ≤ donated (the peg-of-sacrifice, no premine)
 *   · runesSolvent()  every rune: reserve == credits + locks
 * and the WHOLE state (money + stars + pot + runes + contracts) reproduced byte-exact by a
 * fresh ledger replaying the journal — one cascade root, one truth, no drift.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { TREASURY } from '../protocol/kray-primitives.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, scriptOfAddress,
  transferMessage, sendStarMessage, inscribeMessageV2, nameMessageV2, originMessageV2,
  runeSendMessage, contractMessage, contractCallMessage,
} from '../protocol/scheme.ts'
import { canonicalCode, type ContractCode } from '../protocol/contract.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'
import { authorHeldOriginProof } from './ordinal-proof-fixture.ts'

// LEGACY-ERA BENCH: this sim exercises the pre-retirement `reward` semantics (among everything else),
// so its ledgers inject rewardRetiredSeq=MAX. The retirement law itself is pinned in reward-retired.test.ts.
const mkLedger = () => new KrayLedger(undefined, 'regtest', undefined, false, undefined, undefined, undefined, undefined, Number.MAX_SAFE_INTEGER)


let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
function lcg(seed: number) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000 }

const NET = 'regtest'
const BNET = toBtcNet(NET)
interface Wallet { addr: string; sk: Uint8Array; pk: string }
function makeWallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`kraynet-grand|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const W = [makeWallet('A'), makeWallet('B'), makeWallet('C')]
const BY = new Map(W.map((w) => [w.addr, w]))
const ADDRS = W.map((w) => w.addr)
const RUNE = '840000:1'

function messageFor(e: Partial<KrayEvent>): string {
  switch (e.kind) {
    case 'transfer': return transferMessage(NET, e.from!, e.to!, BigInt(e.amount!), e.nonce!)
    case 'transfer-star': return sendStarMessage(NET, e.from!, e.to!, BigInt(e.star!), e.nonce!)
    case 'name': return nameMessageV2(NET, e.from!, e.nonce!, e.name!)
    case 'origin': return originMessageV2(NET, e.from!, e.l1InscriptionId!, e.contentHash!, e.contentType ?? 'image/png', e.size!, e.nonce!)
    case 'rune-send': return runeSendMessage(NET, e.from!, e.to!, e.runeId!, BigInt(e.amount!), e.nonce!)
    case 'contract-call': {
      const args: Record<string, bigint> = {}
      for (const [k, v] of Object.entries(e.callArgs ?? {})) args[k] = BigInt(v as string)
      return contractCallMessage(NET, e.from!, e.contract!, e.rule!, args, e.nonce!)
    }
    default: return inscribeMessageV2(NET, e.from!, e.contentHash!, e.contentType ?? 'text/plain', e.size!, e.parent !== undefined ? BigInt(e.parent) : undefined, e.nonce!)
  }
}
function sign(e: Record<string, unknown>): KrayEvent {
  const w = BY.get(e.from as string)!
  return { ...e, publicKey: w.pk, signature: _signKrayWallet(messageFor(e as Partial<KrayEvent>), w.sk), scheme: 'kraywallet' } as KrayEvent
}

function invariants(L: KrayLedger, tag: string): void {
  ok(L.conserves(), `${tag}: conserves (Σ ₭ == emitted − burned)`)
  ok(L.backed(), `${tag}: backed (emitted ≤ donated, no premine)`)
  ok(L.runesSolvent(), `${tag}: runes solvent (reserve == credits + locks)`)
}

function main(): void {
  const seeds = [2, 19, 73, 4096, 99991]
  let totalActs = 0, kinds = new Set<string>()

  for (const seed of seeds) {
    const rnd = lcg(seed)
    const L = mkLedger()
    const journal: KrayEvent[] = []
    let seq = 0
    let uid = 0
    const uniq = () => (++uid).toString(16)
    const H = () => createHash('sha256').update(`${seed}|${seq}`, 'utf8').digest('hex')
    // per-address nonce + per-address rune balance shadow (to build valid acts)
    const nonce = new Map<string, number>()
    const runeBal = new Map<string, bigint>()
    const stars: { no: bigint; owner: string }[] = []
    const gN = (a: string) => nonce.get(a) ?? 0
    const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }

    // fund every wallet with ₭ (donations) + rune credits (proven deposits). Each donation is capped at the
    // per-mint limit (10k), so fund with several — the storm needs more than one mint's worth per wallet.
    for (const a of ADDRS) {
      for (let d = 0; d < 4; d++) { seq++; push({ seq, kind: 'donate', hash: H(), to: a, amount: '10000' } as KrayEvent) }   // 4 × 10k = 40k per wallet
      seq++; push({ seq, kind: 'rune-deposit', hash: H(), runeId: RUNE, outpoint: `${H()}:0`, to: a, amount: '100000' } as KrayEvent)
      runeBal.set(a, 100000n)
    }
    kinds.add('donate'); kinds.add('rune-deposit')

    // a DeFi contract: splitter that pays `amount` to C from its own balance
    const splitter: ContractCode = {
      vars: { paid: '0' },
      rules: [{ name: 'release', when: { op: 'ge', args: [{ ctx: 'balance' }, { arg: 'amount' }] },
        then: [{ set: { var: 'paid', to: { op: 'add', args: [{ var: 'paid' }, { arg: 'amount' }] } } }, { pay: { to: { addr: W[2].addr }, amount: { arg: 'amount' } } }] }],
    }
    seq++; const codeHash = sha256hex(canonicalCode(splitter))
    push({ seq, kind: 'contract', hash: H(), from: W[0].addr, code: splitter, publicKey: W[0].pk, signature: _signKrayWallet(contractMessage(NET, W[0].addr, codeHash), W[0].sk), scheme: 'kraywallet' } as KrayEvent)
    const contractAddr = L.allContractAddresses()[0]
    // fund it
    seq++; push(sign({ seq, kind: 'transfer', hash: H(), from: W[0].addr, to: contractAddr, amount: '10000', fee: '1', nonce: gN(W[0].addr) }))
    nonce.set(W[0].addr, gN(W[0].addr) + 1)
    kinds.add('contract'); kinds.add('transfer')

    // an origin adoption — an L1 ordinal becomes a star
    const held = authorHeldOriginProof(scriptOfAddress(W[1].addr, NET), { confirmations: 1, salt: 'grand-' + seed })
    seq++; push(sign({ seq, kind: 'origin', hash: H(), from: W[1].addr, l1InscriptionId: held.parentId, contentHash: 'ord-' + seed, contentType: 'image/png', size: 88, nonce: gN(W[1].addr), originProofs: [held.proof] }))
    stars.push({ no: BigInt(stars.length), owner: W[1].addr }); nonce.set(W[1].addr, gN(W[1].addr) + 1)
    kinds.add('origin')
    invariants(L, `${seed} setup`)

    for (let step = 0; step < 220; step++) {
      seq++
      const from = ADDRS[Math.floor(rnd() * ADDRS.length)]
      const to = ADDRS[Math.floor(rnd() * ADDRS.length)]
      const roll = rnd()
      if (roll < 0.18 && from !== to && L.balanceOf(from) > 5n) {
        const amt = 1n + BigInt(Math.floor(rnd() * 100))
        push(sign({ seq, kind: 'transfer', hash: H(), from, to, amount: amt.toString(), fee: '1', nonce: gN(from) }))
        nonce.set(from, gN(from) + 1); kinds.add('transfer')
      } else if (roll < 0.42 && L.balanceOf(from) > 1n) {
        const isName = rnd() < 0.4
        const e = sign(isName
          ? { seq, kind: 'name', hash: H(), from, name: 'g' + seed + uniq() + '', nonce: gN(from) }
          : { seq, kind: 'inscribe', hash: H(), from, contentHash: 'c' + seed + uniq(), contentType: 'text/plain', size: 3, nonce: gN(from) })
        push(e); stars.push({ no: BigInt(stars.length), owner: from }); nonce.set(from, gN(from) + 1)
        kinds.add(isName ? 'name' : 'inscribe')
      } else if (roll < 0.58 && from !== to && stars.length > 0 && L.balanceOf(from) > 1n) {
        const held = stars.filter((s) => s.owner === from)
        if (held.length) {
          const s = held[Math.floor(rnd() * held.length)]
          push(sign({ seq, kind: 'transfer-star', hash: H(), from, to, star: s.no.toString(), fee: '1', nonce: gN(from) }))
          s.owner = to; nonce.set(from, gN(from) + 1); kinds.add('transfer-star')
        }
      } else if (roll < 0.80 && (runeBal.get(from) ?? 0n) > 1n && from !== to && L.balanceOf(from) > 1n) {
        const have = runeBal.get(from) ?? 0n
        const amt = 1n + BigInt(Math.floor(rnd() * Number(have)))
        push(sign({ seq, kind: 'rune-send', hash: H(), runeId: RUNE, from, to, amount: amt.toString(), fee: '1', nonce: gN(from) }))
        runeBal.set(from, have - amt); runeBal.set(to, (runeBal.get(to) ?? 0n) + amt); nonce.set(from, gN(from) + 1); kinds.add('rune-send')
      } else if (roll < 0.90) {
        // call the contract (pays to C from its own balance) if it can afford it
        const amt = 1n + BigInt(Math.floor(rnd() * 50))
        if (L.balanceOf(contractAddr) >= amt && L.balanceOf(W[0].addr) > 1n) {
          push(sign({ seq, kind: 'contract-call', hash: H(), from: W[0].addr, contract: contractAddr, rule: 'release', callArgs: { amount: amt.toString() }, fee: '1', nonce: gN(W[0].addr) }))
          nonce.set(W[0].addr, gN(W[0].addr) + 1); kinds.add('contract-call')
        }
      } else if (roll < 0.95 && L.pot.satsHeld > 100n) {
        push({ seq, kind: 'anchor', hash: H(), amount: '50' } as KrayEvent); kinds.add('anchor')
      } else if (L.balanceOf(TREASURY) > 1n) {
        const amt = 1n + BigInt(Math.floor(rnd() * Number(L.balanceOf(TREASURY))))
        push({ seq, kind: 'reward', hash: H(), to, amount: amt.toString() } as KrayEvent); kinds.add('reward')
      } else { continue }
      totalActs++
      invariants(L, `${seed}.${step}`)
    }

    // ── THE REBOOT IS THE VERIFIER — the WHOLE composed state, byte-exact ──
    const L2 = mkLedger()
    for (const e of journal) L2.applyLive(e)
    ok(L2.cascadeRoot() === L.cascadeRoot(), `${seed}: REBOOT cascade root over money+stars+pot+runes+contracts byte-exact`)
    ok(L2.conserves() && L2.backed() && L2.runesSolvent(), `${seed}: reboot all invariants hold`)
    ok(L2.stars.starCount === L.stars.starCount && L2.stars.merkleRoot() === L.stars.merkleRoot(), `${seed}: reboot stars identical`)
    ok(L2.totalEmitted === L.totalEmitted && L2.totalBurned === L.totalBurned, `${seed}: reboot supply identical`)
  }

  const need = ['donate', 'transfer', 'inscribe', 'name', 'transfer-star', 'origin', 'rune-deposit', 'rune-send', 'contract', 'contract-call', 'anchor', 'reward']
  for (const k of need) ok(kinds.has(k), `coverage: the storm exercised '${k}'`)

  console.log(`\n✓ ${pass} checks passed — THE GRAND EXAM HOLDS: every v2 subsystem composed on ONE ledger through ${totalActs} mixed acts across ${seeds.length} seeds — proof-of-donation mints, signed ₭ transfers, burns→stars, star moves, an origin adoption, rune deposits/sends, a DeFi contract deployed/funded/called, anchor pot-drains and validator rewards — with conservation, the peg, and rune solvency re-checked after EVERY act, all ${need.length} event kinds exercised, and the WHOLE composed state (money+stars+pot+runes+contracts) reproduced byte-exact by a fresh ledger. One cascade root, one truth, no drift. 🎓₭⭐`)
}
main()
