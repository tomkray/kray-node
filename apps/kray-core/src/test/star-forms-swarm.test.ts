/**
 * SEALED FORMS SWARM — catalog under hostility, then reboot.
 *   node src/test/star-forms-swarm.test.ts
 *
 * Five seeds × 90 acts: baptize, seal a form, fund, call every door,
 * sell the face, and the attacks that must refuse. Conservation after
 * every apply. Cascade root byte-exact on replay.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessageV2, contractCallMessage, transferMessage, sendStarMessage,
} from '../protocol/scheme.ts'
import { canonicalCode } from '../protocol/contract.ts'
import { compileEscrow, compileScroll, compileTunnel, compileVest } from '../protocol/star-forms.ts'
import { callerInt } from '../protocol/star-law.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const pin = (c: boolean, m: string) => { if (c) { pass++; return } fail++; console.log('  ✗ FAIL — ' + m) }
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('forms-swarm|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex, tag }
}
type W = ReturnType<typeof wallet>

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a += 0x6D2B79F5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickForm(rnd: () => number, W: W[], seq: number) {
  const roll = rnd()
  const buyer = W[Math.floor(rnd() * W.length)]
  const seller = W[Math.floor(rnd() * W.length)]
  if (roll < 0.22) {
    if (buyer.addr === seller.addr) return compileTunnel({})
    return compileEscrow({ buyer: buyer.addr, seller: seller.addr, deadline: String(seq + 8 + Math.floor(rnd() * 40)) })
  }
  if (roll < 0.40) return compileTunnel(rnd() < 0.5 ? {} : { dest: seller.addr })
  if (roll < 0.55) {
    return compileVest({ beneficiary: seller.addr, start: String(seq), duration: String(2 + Math.floor(rnd() * 12)), total: String(8 + Math.floor(rnd() * 20)) })
  }
  const gate = (['open', 'stamp', 'list'] as const)[Math.floor(rnd() * 3)]
  const locked = rnd() < 0.55
  if (gate === 'list') {
    const allow = [buyer.addr, seller.addr].filter((a, i, xs) => xs.indexOf(a) === i)
    return compileScroll({ each: '2', gate: 'list', locked, allow })
  }
  return compileScroll({ each: '2', max: String(2 + Math.floor(rnd() * 6)), locked, gate })
}

function doorsOf(rules: string[]): string[] {
  return rules.filter((r) => r === 'claim' || r === 'accept' || r === 'refund' || r === 'release' || /^claim_\d+$/.test(r))
}
function mouthOf(rules: string[]): string[] {
  return rules.filter((r) => r === 'collect' || r === 'stamp' || r === 'punch' || r.startsWith('toggle_'))
}

function main() {
  console.log('\n╔═ STAR FORMS SWARM — catalog · doors · face-sale · reboot ═╗\n')
  const seeds = [3, 11, 23, 47, 101]
  let acts = 0, applied = 0, refused = 0
  const seen = { seal: 0, door: 0, mouth: 0, fund: 0, move: 0, attack: 0 }

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
      push({ seq, kind: 'donate', hash: sha256hex(`d|${seed}|${w.tag}`), to: w.addr, amount: '9000' } as KrayEvent)
    }
    const sign = (w: W, fields: Record<string, unknown>, msg: string, nonce?: number): KrayEvent => {
      seq++
      const n = nonce ?? L.nonceOf(w.addr)
      return {
        seq, at: 0, from: w.addr, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet',
        ...fields, nonce: n,
      } as unknown as KrayEvent
    }

    for (let step = 0; step < 90; step++) {
      const w = W[Math.floor(rnd() * W.length)]
      const other = W[Math.floor(rnd() * W.length)]
      const roll = rnd()
      acts++
      const held = L.stars.starsOf(w.addr)
      const bare = held.filter((n) => !L.stars.star(n)?.contract)
      const living = held.filter((n) => !!L.stars.star(n)?.contract)
      const pots = L.allContractAddresses()

      if (roll < 0.10) {
        const name = `fs${seed}${step}${w.tag.slice(-3)}`.replace(/[^a-z0-9]/gi, '').slice(0, 20).toLowerCase()
        const n = L.nonceOf(w.addr)
        if (tryApply(sign(w, { kind: 'name', hash: sha256hex(`n|${seed}|${step}`), name }, nameMessageV2(NET, w.addr, n, name), n))) applied++
        else refused++
      } else if (roll < 0.26) {
        if (!bare.length) { refused++; continue }
        const no = bare[Math.floor(rnd() * bare.length)]
        const code = pickForm(rnd, W, seq)
        const h = sha256hex(canonicalCode(code))
        if (tryApply(sign(w, { kind: 'contract', hash: sha256hex(`c|${seed}|${step}`), code, star: no.toString() }, contractMessageV2(NET, w.addr, h, no)))) {
          applied++; seen.seal++
        } else refused++
      } else if (roll < 0.40) {
        if (!pots.length || L.balanceOf(w.addr) < 12n) { refused++; continue }
        const pot = pots[Math.floor(rnd() * pots.length)]
        const n = L.nonceOf(w.addr)
        if (tryApply(sign(w, { kind: 'transfer', hash: sha256hex(`f|${seed}|${step}`), to: pot, amount: '4', fee: '1' }, transferMessage(NET, w.addr, pot, 4n, n), n))) {
          applied++; seen.fund++
        } else refused++
      } else if (roll < 0.58) {
        if (!pots.length) { refused++; continue }
        const pot = pots[Math.floor(rnd() * pots.length)]
        const rules = doorsOf(L.contractAt(pot)?.rules ?? [])
        if (!rules.length) { refused++; continue }
        const rule = rules[Math.floor(rnd() * rules.length)]
        const n = L.nonceOf(w.addr)
        if (tryApply(sign(w, { kind: 'contract-call', hash: sha256hex(`d|${seed}|${step}`), contract: pot, rule, callArgs: {}, fee: '1' },
          contractCallMessage(NET, w.addr, pot, rule, {}, n), n))) { applied++; seen.door++ }
        else refused++
      } else if (roll < 0.72) {
        if (!living.length) { refused++; continue }
        const no = living[Math.floor(rnd() * living.length)]
        const pot = L.stars.star(no)!.contract!
        const rules = mouthOf(L.contractAt(pot)?.rules ?? [])
        if (!rules.length) { refused++; continue }
        const rule = rules[Math.floor(rnd() * rules.length)]
        const args = rule === 'punch' ? { amount: 1n } : rule === 'stamp' ? { id: BigInt(callerInt(other.addr)) } : {}
        const callArgs = rule === 'punch' ? { amount: '1' } : rule === 'stamp' ? { id: callerInt(other.addr) } : {}
        const n = L.nonceOf(w.addr)
        if (tryApply(sign(w, { kind: 'contract-call', hash: sha256hex(`m|${seed}|${step}`), contract: pot, rule, callArgs, fee: '1' },
          contractCallMessage(NET, w.addr, pot, rule, args, n), n))) { applied++; seen.mouth++ }
        else refused++
      } else if (roll < 0.80) {
        if (!held.length || other.addr === w.addr) { refused++; continue }
        const no = held[Math.floor(rnd() * held.length)]
        const n = L.nonceOf(w.addr)
        if (tryApply(sign(w, { kind: 'transfer-star', hash: sha256hex(`mv|${seed}|${step}`), to: other.addr, star: no.toString(), fee: '1' },
          sendStarMessage(NET, w.addr, other.addr, no, n), n))) { applied++; seen.move++ }
        else refused++
      } else if (roll < 0.86) {
        if (!pots.length) { refused++; continue }
        const pot = pots[0]
        const n = L.nonceOf(w.addr)
        const froze = !tryApply(sign(w, { kind: 'transfer', hash: sha256hex(`atk|drain|${step}`), to: other.addr, amount: '1', fee: '1', from: pot } as Record<string, unknown>,
          transferMessage(NET, pot, other.addr, 1n, 0), 0))
        if (froze) { refused++; seen.attack++ }
        else { pin(false, `seed ${seed} step ${step}: pot drain must refuse`); return }
      } else if (roll < 0.92) {
        if (!pots.length) { refused++; continue }
        const pot = pots[0]
        const n = L.nonceOf(w.addr)
        const froze = !tryApply({
          seq: ++seq, kind: 'contract-call', hash: sha256hex(`atk|u|${step}`), from: w.addr, contract: pot, rule: 'claim',
          callArgs: {}, fee: '1', nonce: n,
        } as KrayEvent)
        if (froze) { refused++; seen.attack++ }
        else { pin(false, `seed ${seed} step ${step}: unsigned call must refuse`); return }
      } else {
        if (!pots.length) { refused++; continue }
        const pot = pots[0]
        const view = L.contractAt(pot)
        const rule = (view?.rules ?? []).includes('claim') ? 'claim' : (view?.rules ?? ['accept'])[0]
        const n = L.nonceOf(w.addr)
        const froze = !tryApply(sign(w, {
          kind: 'contract-call', hash: sha256hex(`atk|p|${step}`), contract: pot, rule, callArgs: {}, fee: '1',
          payouts: [[other.addr, '999', '0']],
        }, contractCallMessage(NET, w.addr, pot, rule, {}, n), n))
        if (froze) { refused++; seen.attack++ }
        else { pin(false, `seed ${seed} step ${step}: forged payout must refuse`); return }
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
      pin(!!a && !!b && JSON.stringify(a.state) === JSON.stringify(b.state) && a.star === b.star && L.balanceOf(addr) === reboot.balanceOf(addr),
        `seed ${seed}: pot ${addr.slice(13, 21)} survives reboot`)
    }
    for (let n = 0n; n < L.stars.createdSeq; n++) {
      const a = L.stars.star(n), b = reboot.stars.star(n)
      if (!a) continue
      pin(!!b && a.contract === b.contract && a.owner === b.owner, `seed ${seed}: star #${n} law+owner survive`)
    }
  }

  ok(applied > 0 && refused > 0, `swarm mixed applies and refusals (applied ${applied}, refused ${refused}, acts ${acts})`)
  ok(seen.seal > 0 && seen.door + seen.mouth > 0, `catalog moved — sealed ${seen.seal} · doors ${seen.door} · mouth ${seen.mouth}`)
  ok(seen.attack > 0, `hostile doors fired ${seen.attack} times and every one froze`)
  console.log(`  · ${acts} acts across ${seeds.length} seeds · ${applied} applied · ${refused} refused`)
  console.log(`  · gallery: seal ${seen.seal} · door ${seen.door} · mouth ${seen.mouth} · fund ${seen.fund} · move ${seen.move} · attack ${seen.attack}`)

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — THE CATALOG SWARM HOLDS: forms sealed, doors and mouths mixed with sales, every drain/forgery refused, reboot byte-exact. ⚖⭐`)
}
main()
