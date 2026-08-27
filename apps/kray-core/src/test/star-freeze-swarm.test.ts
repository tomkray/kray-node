/**
 * STAR FREEZE SWARM — the hole under hostility, then reboot.
 *   node src/test/star-freeze-swarm.test.ts
 *
 * Five seeds × 70 acts: birth, seal a law, freeze, and the doors that must
 * refuse (stranger freeze, re-freeze, write on ice, collect after freeze).
 * Freezing a star does not burn ₭. Reboot is byte-exact.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessageV2, contractCallMessage, sendStarMessage,
} from '../protocol/scheme.ts'
import { canonicalCode } from '../protocol/contract.ts'
import { compileLivingLaw, callerInt, defaultLivingFlags } from '../protocol/star-law.ts'
import { BLACK_HOLE, sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const pin = (c: boolean, m: string) => { if (c) { pass++; return } fail++; console.log('  ✗ FAIL — ' + m) }
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('star-freeze-swarm|' + tag).digest()
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

function main() {
  console.log('\n╔═ STAR FREEZE SWARM — ice · stranger · mouth-dead · reboot ═╗\n')

  const seeds = [3, 11, 19, 31, 47]
  let acts = 0, applied = 0, refused = 0
  const seen = { freeze: 0, birth: 0, seal: 0, pulse: 0, attack: 0 }

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
      const ice = L.stars.starsOf(BLACK_HOLE).length
      try { push(e); return true }
      catch {
        pin(L.cascadeRoot() === root && L.totalBurned === burned && L.stars.starsOf(BLACK_HOLE).length === ice && L.conserves(),
          `seed ${seed}: a refusal mutated freeze/burn/root`)
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
        ...fields, ...(nonce !== undefined || fields.kind === 'name' || fields.kind === 'contract-call' || fields.kind === 'transfer-star' ? { nonce: n } : {}),
      } as unknown as KrayEvent
    }

    for (let step = 0; step < 70; step++) {
      const w = W[Math.floor(rnd() * W.length)]
      const other = W[Math.floor(rnd() * W.length)]
      const roll = rnd()
      acts++
      const living = L.stars.starsOf(w.addr)
      const frozen = L.stars.starsOf(BLACK_HOLE)
      const burnedBefore = L.totalBurned

      if (roll < 0.16) {
        const name = `fz${seed}${step}${w.tag.slice(-3)}`.replace(/[^a-z0-9]/gi, '').slice(0, 20).toLowerCase()
        const n = L.nonceOf(w.addr)
        if (tryApply(sign(w, { kind: 'name', hash: sha256hex(`n|${seed}|${step}`), name }, nameMessageV2(NET, w.addr, n, name), n))) {
          applied++; seen.birth++
          pin(L.totalBurned === burnedBefore + 1n, `seed ${seed} step ${step}: a birth burns 1 ₭`)
        } else refused++
      } else if (roll < 0.26) {
        const bare = living.filter((n) => !L.stars.star(n)?.contract)
        if (!bare.length) { refused++; continue }
        const no = bare[Math.floor(rnd() * bare.length)]
        const code = compileLivingLaw({ owner: callerInt(w.addr), payout: w.addr, flags: defaultLivingFlags() })
        const h = sha256hex(canonicalCode(code))
        if (tryApply(sign(w, { kind: 'contract', hash: sha256hex(`c|${seed}|${step}`), code, star: no.toString() }, contractMessageV2(NET, w.addr, h, no)))) {
          applied++; seen.seal++
          pin(L.totalBurned === burnedBefore + 1n, `seed ${seed} step ${step}: a law burns 1 ₭`)
        } else refused++
      } else if (roll < 0.50) {
        if (!living.length) { refused++; continue }
        const no = living[Math.floor(rnd() * living.length)]
        const n = L.nonceOf(w.addr)
        if (tryApply(sign(w, { kind: 'transfer-star', hash: sha256hex(`z|${seed}|${step}`), to: BLACK_HOLE, star: no.toString(), fee: '1' }, sendStarMessage(NET, w.addr, BLACK_HOLE, no, n), n))) {
          applied++; seen.freeze++
          pin(L.stars.ownerOf(no) === BLACK_HOLE, `seed ${seed} step ${step}: ownerOf(#${no}) is the hole`)
          pin(L.totalBurned === burnedBefore, `seed ${seed} step ${step}: a freeze does not burn ₭`)
          const st = L.stars.star(no)
          pin(!!st && (st.name != null || st.contract != null), `seed ${seed} step ${step}: the frozen star kept what was written`)
        } else refused++
      } else if (roll < 0.62) {
        if (!living.length || other.addr === w.addr) { refused++; continue }
        const no = living[0]
        const n = L.nonceOf(other.addr)
        const froze = !tryApply(sign(other, { kind: 'transfer-star', hash: sha256hex(`atk|steal|${step}`), to: BLACK_HOLE, star: no.toString(), fee: '1' }, sendStarMessage(NET, other.addr, BLACK_HOLE, no, n), n))
        if (froze) { refused++; seen.attack++ }
        else { pin(false, `seed ${seed} step ${step}: stranger freeze must refuse`); return }
      } else if (roll < 0.72) {
        if (!frozen.length) { refused++; continue }
        const no = frozen[Math.floor(rnd() * frozen.length)]
        const n = L.nonceOf(w.addr)
        const froze = !tryApply(sign(w, { kind: 'transfer-star', hash: sha256hex(`atk|again|${step}`), to: BLACK_HOLE, star: no.toString(), fee: '1' }, sendStarMessage(NET, w.addr, BLACK_HOLE, no, n), n))
        if (froze) { refused++; seen.attack++ }
        else { pin(false, `seed ${seed} step ${step}: re-freeze must refuse`); return }
      } else if (roll < 0.80) {
        if (!frozen.length) { refused++; continue }
        const no = frozen[0]
        const name = `ice${seed}${step}`.slice(0, 20)
        const n = L.nonceOf(w.addr)
        const froze = !tryApply(sign(w, { kind: 'name', hash: sha256hex(`atk|write|${step}`), name, star: no.toString() }, nameMessageV2(NET, w.addr, n, name, no), n))
        if (froze) { refused++; seen.attack++ }
        else { pin(false, `seed ${seed} step ${step}: write on ice must refuse`); return }
      } else if (roll < 0.88) {
        const iced = frozen.map((n) => L.stars.star(n)).filter((s) => s?.contract)
        if (!iced.length) { refused++; continue }
        const st = iced[0]!
        const n = L.nonceOf(w.addr)
        const froze = !tryApply(sign(w, { kind: 'contract-call', hash: sha256hex(`atk|col|${step}`), contract: st.contract!, rule: 'collect', callArgs: {}, fee: '1' }, contractCallMessage(NET, w.addr, st.contract!, 'collect', {}, n), n))
        if (froze) { refused++; seen.attack++ }
        else { pin(false, `seed ${seed} step ${step}: collect on a frozen mouth must refuse`); return }
      } else {
        const iced = frozen.map((n) => L.stars.star(n)).filter((s) => s?.contract)
        if (!iced.length) { refused++; continue }
        const st = iced[0]!
        const n = L.nonceOf(w.addr)
        if (tryApply(sign(w, { kind: 'contract-call', hash: sha256hex(`p|${seed}|${step}`), contract: st.contract!, rule: 'pulse', callArgs: {}, fee: '1' }, contractCallMessage(NET, w.addr, st.contract!, 'pulse', {}, n), n))) {
          applied++; seen.pulse++
          pin(L.totalBurned === burnedBefore, `seed ${seed} step ${step}: pulse on ice is breath, not fire`)
        } else refused++
      }
      pin(L.conserves(), `seed ${seed} step ${step}: conserves`)
    }

    const ice = L.stars.starsOf(BLACK_HOLE)
    pin(ice.length > 0, `seed ${seed}: at least one star froze`)
    for (const no of ice) {
      pin(L.stars.ownerOf(no) === BLACK_HOLE, `seed ${seed}: #${no} still at the hole`)
    }
    pin(L.conserves(), `seed ${seed}: conserves at storm end`)

    const reboot = new KrayLedger(undefined, NET)
    for (const e of journal) reboot.applyLive(e)
    pin(reboot.cascadeRoot() === L.cascadeRoot(), `seed ${seed}: reboot cascade root byte-exact`)
    pin(reboot.stars.merkleRoot() === L.stars.merkleRoot(), `seed ${seed}: reboot star merkle byte-exact`)
    pin(reboot.stars.starsOf(BLACK_HOLE).length === ice.length, `seed ${seed}: reboot freeze count exact`)
    pin(reboot.totalBurned === L.totalBurned, `seed ${seed}: reboot burned exact`)
    for (const no of ice) {
      const a = L.stars.star(no), b = reboot.stars.star(no)
      pin(!!b && b.owner === BLACK_HOLE && a?.name === b.name && a?.contract === b.contract,
        `seed ${seed}: frozen #${no} name+law+owner survive reboot`)
    }
  }

  ok(seen.freeze > 10, `swarm froze stars (${seen.freeze} freezes across seeds)`)
  ok(seen.attack > 20, `hostile doors fired (${seen.attack} refused attacks)`)
  ok(applied > 0 && refused > 0, `swarm mixed applies and refusals (applied ${applied}, refused ${refused}, acts ${acts})`)
  console.log(`  · ${acts} acts across ${seeds.length} seeds · ${applied} applied · ${refused} refused`)
  console.log(`  · gallery: freeze ${seen.freeze} · birth ${seen.birth} · seal ${seen.seal} · pulse-on-ice ${seen.pulse} · attack ${seen.attack}`)

  if (fail) {
    console.error(`\n✗ ${fail} failed · ${pass} passed — FREEZE SWARM BROKE\n`)
    process.exit(1)
  }
  console.log(`\n✓ ${pass} checks — stars freeze, ₭ does not burn, strangers cannot ice a face, reboot is exact. ❄\n`)
}

main()
