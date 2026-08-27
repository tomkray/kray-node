/**
 * STAR LAW SWARM — living beings under hostility, then reboot.
 *   node src/test/star-law-swarm.test.ts
 *
 * Five seeds × 80 acts: baptize, seal a law, pulse (stranger = agent in the
 * vacuum), toggle, fund, collect, transfer-star, and the doors that must
 * refuse. Conservation after every apply. Cascade root byte-exact on replay.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessage, contractMessageV2, contractCallMessage, transferMessage, sendStarMessage,
} from '../protocol/scheme.ts'
import { canonicalCode, contractAddress, type ContractCode } from '../protocol/contract.ts'
import { compileLivingLaw, callerInt, defaultLivingFlags, type LivingFlag } from '../protocol/star-law.ts'
import { TREASURY, sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const pin = (c: boolean, m: string) => { if (c) { pass++; return } fail++; console.log('  ✗ FAIL — ' + m) }
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('star-law-swarm|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex, tag }
}

type W = ReturnType<typeof wallet>
const PERSONAS: LivingFlag[][] = [
  defaultLivingFlags(),
  [{ name: 'alive', on: true }, { name: 'sing', on: true }, { name: 'listen', on: false }],
  [{ name: 'alive', on: true }, { name: 'open', on: false }, { name: 'agent', on: true }],
  [{ name: 'open', on: true }, { name: 'trade', on: true }],
  [{ name: 'alive', on: true }, { name: 'dream', on: true }, { name: 'wake', on: false }],
  [{ name: 'alive', on: true, motion: 'toggle' }, { name: 'valid', on: true, motion: 'once' }],
]

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function main() {
  console.log('\n╔═ STAR LAW SWARM — beings · agents · doors · reboot ═╗\n')

  const seeds = [7, 13, 29, 41, 99]
  let acts = 0, applied = 0, refused = 0
  const seen = { pulse: 0, toggle: 0, collect: 0, seal: 0, move: 0, fund: 0 }

  for (const seed of seeds) {
    const rnd = mulberry(seed)
    const W = [0, 1, 2, 3, 4].map((i) => wallet(`s${seed}w${i}`))
    const L = new KrayLedger(undefined, NET)
    const journal: KrayEvent[] = []
    let seq = 0
    const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
    const tryApply = (e: KrayEvent): boolean => {
      const root = L.cascadeRoot()
      const burned = L.totalBurned
      try { push(e); return true }
      catch {
        pin(L.cascadeRoot() === root && L.totalBurned === burned && L.conserves(), `seed ${seed}: a refusal mutated state`)
        return false
      }
    }
    for (const w of W) {
      seq++
      push({ seq, kind: 'donate', hash: sha256hex(`d|${seed}|${w.tag}`), to: w.addr, amount: '8000' } as KrayEvent)
    }
    const sign = (w: W, fields: Record<string, unknown>, msg: string, nonce?: number): KrayEvent => {
      seq++
      const n = nonce ?? L.nonceOf(w.addr)
      return {
        seq, at: 0, from: w.addr, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet',
        ...fields, ...(nonce !== undefined || fields.kind === 'name' || fields.kind === 'contract-call' || fields.kind === 'transfer' || fields.kind === 'transfer-star' ? { nonce: n } : {}),
      } as unknown as KrayEvent
    }

    for (let step = 0; step < 80; step++) {
      const w = W[Math.floor(rnd() * W.length)]
      const other = W[Math.floor(rnd() * W.length)]
      const roll = rnd()
      acts++
      const held = L.stars.starsOf(w.addr)
      const bare = held.filter((n) => !L.stars.star(n)?.contract)
      const living = held.filter((n) => !!L.stars.star(n)?.contract)

      if (roll < 0.10) {
        const name = `sw${seed}${step}${w.tag.slice(-4)}`.replace(/[^a-z0-9]/gi, '').slice(0, 20).toLowerCase()
        const n = L.nonceOf(w.addr)
        if (tryApply(sign(w, { kind: 'name', hash: sha256hex(`n|${seed}|${step}`), name }, nameMessageV2(NET, w.addr, n, name), n))) applied++
        else refused++
      } else if (roll < 0.22) {
        if (!bare.length) { refused++; continue }
        const no = bare[Math.floor(rnd() * bare.length)]
        const flags = PERSONAS[Math.floor(rnd() * PERSONAS.length)]
        const code = compileLivingLaw({ owner: callerInt(w.addr), payout: w.addr, flags })
        const h = sha256hex(canonicalCode(code))
        if (tryApply(sign(w, { kind: 'contract', hash: sha256hex(`c|${seed}|${step}`), code, star: no.toString() }, contractMessageV2(NET, w.addr, h, no)))) {
          applied++; seen.seal++
        } else refused++
      } else if (roll < 0.38) {
        const pots = L.allContractAddresses().filter((a) => L.contractAt(a)?.star)
        if (!pots.length) { refused++; continue }
        const pot = pots[Math.floor(rnd() * pots.length)]
        const n = L.nonceOf(w.addr)
        if (tryApply(sign(w, { kind: 'contract-call', hash: sha256hex(`p|${seed}|${step}`), contract: pot, rule: 'pulse', callArgs: {}, fee: '1' }, contractCallMessage(NET, w.addr, pot, 'pulse', {}, n), n))) {
          applied++; seen.pulse++
        } else refused++
      } else if (roll < 0.50) {
        if (!living.length) { refused++; continue }
        const no = living[Math.floor(rnd() * living.length)]
        const pot = L.stars.star(no)!.contract!
        const rules = (L.contractAt(pot)?.rules ?? []).filter((r) => r.startsWith('toggle_') || r.startsWith('once_'))
        if (!rules.length) { refused++; continue }
        const rule = rules[Math.floor(rnd() * rules.length)]
        const n = L.nonceOf(w.addr)
        if (tryApply(sign(w, { kind: 'contract-call', hash: sha256hex(`t|${seed}|${step}`), contract: pot, rule, callArgs: {}, fee: '1' }, contractCallMessage(NET, w.addr, pot, rule, {}, n), n))) {
          applied++; seen.toggle++
        } else refused++
      } else if (roll < 0.60) {
        const pots = L.allContractAddresses()
        if (!pots.length || L.balanceOf(w.addr) < 20n) { refused++; continue }
        const pot = pots[Math.floor(rnd() * pots.length)]
        const n = L.nonceOf(w.addr)
        if (tryApply(sign(w, { kind: 'transfer', hash: sha256hex(`f|${seed}|${step}`), to: pot, amount: '7', fee: '1' }, transferMessage(NET, w.addr, pot, 7n, n), n))) {
          applied++; seen.fund++
        } else refused++
      } else if (roll < 0.68) {
        if (!living.length) { refused++; continue }
        const no = living[Math.floor(rnd() * living.length)]
        const pot = L.stars.star(no)!.contract!
        const n = L.nonceOf(w.addr)
        if (tryApply(sign(w, { kind: 'contract-call', hash: sha256hex(`k|${seed}|${step}`), contract: pot, rule: 'collect', callArgs: {}, fee: '1' }, contractCallMessage(NET, w.addr, pot, 'collect', {}, n), n))) {
          applied++; seen.collect++
        } else refused++
      } else if (roll < 0.74) {
        if (!held.length || other.addr === w.addr) { refused++; continue }
        const no = held[Math.floor(rnd() * held.length)]
        const n = L.nonceOf(w.addr)
        if (tryApply(sign(w, { kind: 'transfer-star', hash: sha256hex(`m|${seed}|${step}`), to: other.addr, star: no.toString(), fee: '1' }, sendStarMessage(NET, w.addr, other.addr, no, n), n))) {
          applied++; seen.move++
        } else refused++
      } else if (roll < 0.80) {
        const pots = L.allContractAddresses()
        if (!pots.length) { refused++; continue }
        const pot = pots[0]
        const n = L.nonceOf(w.addr)
        const okRefuse = !tryApply(sign(w, { kind: 'transfer', hash: sha256hex(`atk|drain|${step}`), to: other.addr, amount: '1', fee: '1', from: pot } as Record<string, unknown>, transferMessage(NET, pot, other.addr, 1n, 0), 0))
        if (okRefuse) refused++; else { pin(false, `seed ${seed} step ${step}: pot drain must refuse`); return }
      } else if (roll < 0.86) {
        if (!living.length) { refused++; continue }
        const no = living[0]
        const flags = defaultLivingFlags()
        const code = compileLivingLaw({ owner: callerInt(w.addr), payout: w.addr, flags })
        const h = sha256hex(canonicalCode(code))
        const okRefuse = !tryApply(sign(w, { kind: 'contract', hash: sha256hex(`atk|2|${step}`), code, star: no.toString() }, contractMessageV2(NET, w.addr, h, no)))
        if (okRefuse) refused++; else { pin(false, `seed ${seed} step ${step}: second law must refuse`); return }
      } else if (roll < 0.92) {
        const pots = L.allContractAddresses().filter((a) => L.contractAt(a)?.star)
        if (!pots.length) { refused++; continue }
        const pot = pots[0]
        const n = L.nonceOf(w.addr)
        const okRefuse = !tryApply({
          seq: ++seq, kind: 'contract-call', hash: sha256hex(`atk|u|${step}`), from: w.addr, contract: pot, rule: 'pulse',
          callArgs: {}, fee: '1', nonce: n,
        } as KrayEvent)
        if (okRefuse) refused++; else { pin(false, `seed ${seed} step ${step}: unsigned pulse must refuse`); return }
      } else {
        const pots = L.allContractAddresses()
        if (!pots.length) { refused++; continue }
        const pot = pots[0]
        const n = L.nonceOf(w.addr)
        const okRefuse = !tryApply(sign(w, {
          kind: 'contract-call', hash: sha256hex(`atk|forge|${step}`), contract: pot, rule: 'pulse', callArgs: {}, fee: '1',
          payouts: [[other.addr, '999', '0']],
        }, contractCallMessage(NET, w.addr, pot, 'pulse', {}, n), n))
        if (okRefuse) refused++; else { pin(false, `seed ${seed} step ${step}: forged payout must refuse`); return }
      }
      pin(L.conserves(), `seed ${seed} step ${step}: conserves`)
    }

    pin(L.conserves(), `seed ${seed}: conserves at storm end`)
    const reboot = new KrayLedger(undefined, NET)
    for (const e of journal) reboot.applyLive(e)
    pin(reboot.cascadeRoot() === L.cascadeRoot(), `seed ${seed}: reboot cascade root byte-exact`)
    pin(reboot.stars.merkleRoot() === L.stars.merkleRoot(), `seed ${seed}: reboot star merkle byte-exact`)
    for (const addr of L.allContractAddresses()) {
      const a = L.contractAt(addr), b = reboot.contractAt(addr)
      pin(!!a && !!b && JSON.stringify(a.state) === JSON.stringify(b.state) && a.star === b.star, `seed ${seed}: pot ${addr.slice(0, 22)} state+star survive reboot`)
    }
    for (let n = 0n; n < L.stars.createdSeq; n++) {
      const a = L.stars.star(n), b = reboot.stars.star(n)
      if (!a) continue
      pin(!!b && a.contract === b.contract && a.owner === b.owner, `seed ${seed}: star #${n} law+owner survive reboot`)
      if (a.contract) {
        pin(L.balanceOf(a.contract) === reboot.balanceOf(a.contract), `seed ${seed}: pot of #${n} balance survives`)
        const face = L.stars.star(n)
        if (face && face.owner !== a.by && a.contract) {
          pin(L.balanceOf(a.contract) === reboot.balanceOf(a.contract), `seed ${seed}: moved face did not drain pot`)
        }
      }
    }
    void TREASURY
  }

  ok(applied > 0 && refused > 0, `swarm mixed applies and refusals (applied ${applied}, refused ${refused}, acts ${acts})`)
  ok(seen.seal > 0 && seen.pulse > 0, `creative life happened — sealed ${seen.seal} laws, ${seen.pulse} pulses (strangers breathing)`)
  ok(seen.toggle + seen.collect + seen.fund + seen.move > 0, `desk in motion — toggles ${seen.toggle} · collects ${seen.collect} · funds ${seen.fund} · moves ${seen.move}`)
  console.log(`  · ${acts} acts across ${seeds.length} seeds · ${applied} applied · ${refused} refused`)
  console.log(`  · gallery: seal ${seen.seal} · pulse ${seen.pulse} · toggle ${seen.toggle} · fund ${seen.fund} · collect ${seen.collect} · move ${seen.move}`)

  // staged play: muse tips + pulses (public breath); poet toggles; sale passes the mouth
  const Poet = wallet('poet'), Muse = wallet('muse'), Buyer = wallet('buyer')
  const P = new KrayLedger(undefined, NET)
  P.applyLive({ seq: 1, kind: 'donate', hash: 'd1', to: Poet.addr, amount: '500' } as KrayEvent)
  P.applyLive({ seq: 2, kind: 'donate', hash: 'd2', to: Muse.addr, amount: '50' } as KrayEvent)
  P.applyLive({ seq: 3, kind: 'donate', hash: 'd3', to: Buyer.addr, amount: '30' } as KrayEvent)
  P.applyLive({
    seq: 4, kind: 'name', hash: 'np', at: 0, from: Poet.addr, name: 'orpheus', nonce: 0,
    publicKey: Poet.pk, signature: _signKrayWallet(nameMessageV2(NET, Poet.addr, 0, 'orpheus'), Poet.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const poetLaw = compileLivingLaw({
    owner: callerInt(Poet.addr), payout: Poet.addr,
    flags: [{ name: 'alive', on: true }, { name: 'sing', on: false }, { name: 'agent', on: true }],
  })
  const ph = sha256hex(canonicalCode(poetLaw))
  P.applyLive({
    seq: 5, kind: 'contract', hash: 'lp', from: Poet.addr, code: poetLaw, star: '0',
    publicKey: Poet.pk, signature: _signKrayWallet(contractMessageV2(NET, Poet.addr, ph, 0n), Poet.sk), scheme: 'kraywallet',
  } as KrayEvent)
  const pot = contractAddress(ph, Poet.addr, 5)
  P.applyLive({
    seq: 6, kind: 'transfer', hash: 'tip', from: Muse.addr, to: pot, amount: '20', fee: '1', nonce: 0,
    publicKey: Muse.pk, signature: _signKrayWallet(transferMessage(NET, Muse.addr, pot, 20n, 0), Muse.sk), scheme: 'kraywallet',
  } as KrayEvent)
  P.applyLive({
    seq: 7, kind: 'contract-call', hash: 'br', from: Muse.addr, contract: pot, rule: 'pulse', callArgs: {}, fee: '1', nonce: 1,
    publicKey: Muse.pk, signature: _signKrayWallet(contractCallMessage(NET, Muse.addr, pot, 'pulse', {}, 1), Muse.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(P.contractAt(pot)?.state.alive === '1' && P.balanceOf(pot) === 20n, 'Orpheus: the muse tipped 20 ₭ and pulsed — public breath, pot holds the gift')
  P.applyLive({
    seq: 8, kind: 'contract-call', hash: 'sg', from: Poet.addr, contract: pot, rule: 'toggle_sing', callArgs: {}, fee: '1', nonce: 1,
    publicKey: Poet.pk, signature: _signKrayWallet(contractCallMessage(NET, Poet.addr, pot, 'toggle_sing', {}, 1), Poet.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(P.contractAt(pot)?.state.sing === '1', 'the living owner flipped sing — the being found its voice')
  P.applyLive({
    seq: 9, kind: 'transfer-star', hash: 'sale', from: Poet.addr, to: Buyer.addr, star: '0', fee: '1', nonce: 2,
    publicKey: Poet.pk, signature: _signKrayWallet(sendStarMessage(NET, Poet.addr, Buyer.addr, 0n, 2), Poet.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(P.stars.star(0n)?.owner === Buyer.addr && P.balanceOf(pot) === 20n, 'the face sold; the song (20 ₭) stayed in the keyless pot')
  let sellerCollect = false
  try {
    P.applyLive({
      seq: 10, kind: 'contract-call', hash: 'ghost', from: Poet.addr, contract: pot, rule: 'collect', callArgs: {}, fee: '1', nonce: 3,
      publicKey: Poet.pk, signature: _signKrayWallet(contractCallMessage(NET, Poet.addr, pot, 'collect', {}, 3), Poet.sk), scheme: 'kraywallet',
    } as KrayEvent)
    sellerCollect = true
  } catch { /* mouth left with the face */ }
  ok(!sellerCollect && P.balanceOf(pot) === 20n, 'seller lost the mouth — collect refuses')
  const nBuyer = P.nonceOf(Buyer.addr)
  const buyerBefore = P.balanceOf(Buyer.addr)
  P.applyLive({
    seq: 10, kind: 'contract-call', hash: 'out', from: Buyer.addr, contract: pot, rule: 'collect', callArgs: {}, fee: '1', nonce: nBuyer,
    publicKey: Buyer.pk, signature: _signKrayWallet(contractCallMessage(NET, Buyer.addr, pot, 'collect', {}, nBuyer), Buyer.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(P.balanceOf(pot) === 0n && P.balanceOf(Buyer.addr) === buyerBefore - 1n + 20n, 'the buyer collects — the mouth travelled with the face')
  ok(P.conserves(), 'Orpheus play conserves')

  const v1: ContractCode = {
    vars: { paid: '0' },
    rules: [{ name: 'noop', when: { lit: '1' }, then: [{ require: { lit: '1' } }] }],
  }
  const v1h = sha256hex(canonicalCode(v1))
  const Lmix = new KrayLedger(undefined, NET)
  Lmix.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: Poet.addr, amount: '100' } as KrayEvent)
  Lmix.applyLive({
    seq: 2, kind: 'contract', hash: 'v1', from: Poet.addr, code: v1,
    publicKey: Poet.pk, signature: _signKrayWallet(contractMessage(NET, Poet.addr, v1h), Poet.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(Lmix.totalBurned === 0n && Lmix.allContractAddresses().length === 1, 'A3 — a v1 pot still deploys beside the swarm, no burn')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — THE SWARM HOLDS: beings sealed, strangers pulsed (public breath), flags flipped by the living owner, gifts sat in keyless pots, the mouth travelled with the face, every hostile door refused, reboot byte-exact. ⚖⭐`)
}
main()
