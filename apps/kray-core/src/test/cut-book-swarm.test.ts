/**
 * LUZ SWARM — the holder book under hostility, then reboot.
 *   node src/test/cut-book-swarm.test.ts
 *
 * In-memory. Does not touch Signet, main, or the living lab journal.
 * Seal a Cut, send Luz, forge, over-send, freeze, conserve, replay byte-exact.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  nameMessageV2, contractMessageV2, cutSendMessage, xSendMessage, sendStarMessage,
} from '../protocol/scheme.ts'
import { canonicalCode } from '../protocol/contract.ts'
import { compileCut, isCutPaper } from '../protocol/star-forms.ts'
import { sha256hex, BLACK_HOLE, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const pin = (c: boolean, m: string) => { if (c) { pass++; return } fail++; console.log('  ✗ FAIL — ' + m) }
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('cut-swarm|' + tag).digest()
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
  console.log('\n╔═ LUZ SWARM — seal · send · forge · freeze · reboot ═╗\n')
  const empty = new KrayLedger(undefined, NET)
  ok(!empty.cascadeParts().cutCommitment, 'empty book is absent from the cascade (A3)')
  ok(empty.cuts.empty() && empty.cuts.conserves(), 'empty CutBook conserves')

  const paper = compileCut({ supply: '100000' })
  ok(isCutPaper(paper) && !paper.rules.some((r) => r.name === 'collect'), 'Cut paper is Luz — no drain')

  const seeds = [3, 11, 23, 47, 101]
  let sends = 0, refused = 0, frozenSends = 0

  for (const seed of seeds) {
    const rnd = mulberry(seed)
    const A = wallet(`s${seed}a`)
    const B = wallet(`s${seed}b`)
    const C = wallet(`s${seed}c`)
    const eve = wallet(`s${seed}eve`)
    const L = new KrayLedger(undefined, NET)
    const journal: KrayEvent[] = []
    let seq = 0
    const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
    const tryApply = (e: KrayEvent): boolean => {
      const root = L.cascadeRoot()
      try { push(e); return true }
      catch {
        pin(L.cascadeRoot() === root && L.conserves() && L.cuts.conserves(), `seed ${seed}: a refusal mutated state`)
        return false
      }
    }
    for (const w of [A, B, C, eve]) {
      seq++
      push({ seq, kind: 'donate', hash: sha256hex(`d|${seed}|${w.tag}`), to: w.addr, amount: '9000' } as KrayEvent)
    }
    const next = (w: W, fields: Record<string, unknown>, msgOf: (nonce: number) => string): KrayEvent => {
      const n = L.nonceOf(w.addr)
      return {
        seq: ++seq, at: 0, from: w.addr,
        publicKey: w.pk, signature: _signKrayWallet(msgOf(n), w.sk), scheme: 'kraywallet',
        ...fields, nonce: n,
      } as unknown as KrayEvent
    }

    const name = `luz${seed}face`.slice(0, 12)
    push(next(A, { kind: 'name', hash: sha256hex(`n|${seed}`), name }, (n) => nameMessageV2(NET, A.addr, n, name)))
    const ch = sha256hex(canonicalCode(paper))
    push(next(A, { kind: 'contract', hash: sha256hex(`c|${seed}`), code: paper, star: '0' }, () => contractMessageV2(NET, A.addr, ch, 0n)))
    pin(L.cuts.of('0', A.addr) === 100000n && L.cuts.view('0')?.name === 'Luz', `seed ${seed}: seal credits A — mouth is Luz`)
    pin(!!L.cascadeParts().cutCommitment, `seed ${seed}: Luz folds by presence after genesis`)

    for (let step = 0; step < 40; step++) {
      const roll = rnd()
      const from = roll < 0.55 ? A : roll < 0.85 ? B : C
      const to = [A, B, C].filter((w) => w.addr !== from.addr)[Math.floor(rnd() * 2)]
      const have = L.cuts.of('0', from.addr)
      if (roll < 0.12) {
        const stole = !tryApply(next(eve, { kind: 'cut-send', hash: sha256hex(`atk|${seed}|${step}`), to: A.addr, star: '0', amount: '1', fee: '1' },
          (n) => cutSendMessage(NET, eve.addr, A.addr, 0n, 1n, n)))
        if (stole) { refused++; continue }
        pin(false, `seed ${seed}: Eve must not send`)
        return
      }
      if (roll < 0.20 && have > 0n) {
        const n = L.nonceOf(from.addr)
        const forged = !tryApply({
          seq: ++seq, kind: 'cut-send', hash: sha256hex(`fg|${seed}|${step}`), from: from.addr, to: eve.addr,
          star: '0', amount: '1', fee: '1', nonce: n,
          publicKey: eve.pk, signature: _signKrayWallet(cutSendMessage(NET, from.addr, eve.addr, 0n, 1n, n), eve.sk), scheme: 'kraywallet',
        } as KrayEvent)
        if (forged) { refused++; continue }
        pin(false, `seed ${seed}: forge must refuse`)
        return
      }
      if (roll < 0.28 && have > 0n) {
        const n = L.nonceOf(from.addr)
        const xsig = !tryApply({
          seq: ++seq, kind: 'cut-send', hash: sha256hex(`x|${seed}|${step}`), from: from.addr, to: to.addr,
          star: '0', amount: '1', fee: '1', nonce: n,
          publicKey: from.pk, signature: _signKrayWallet(xSendMessage(NET, from.addr, to.addr, 1n, n), from.sk), scheme: 'kraywallet',
        } as KrayEvent)
        if (xsig) { refused++; continue }
        pin(false, `seed ${seed}: Ӿ sig must not move Luz`)
        return
      }
      if (roll < 0.36) {
        const over = have + 1n
        const blocked = !tryApply(next(from, { kind: 'cut-send', hash: sha256hex(`ov|${seed}|${step}`), to: to.addr, star: '0', amount: over.toString(), fee: '1' },
          (n) => cutSendMessage(NET, from.addr, to.addr, 0n, over, n)))
        if (blocked) { refused++; continue }
        pin(false, `seed ${seed}: over-send must refuse`)
        return
      }
      if (have <= 0n) { refused++; continue }
      const amt = 1n + BigInt(Math.floor(rnd() * Number(have > 500n ? 500n : have)))
      if (amt > have) { refused++; continue }
      const frozen = L.stars.ownerOf(0n) === BLACK_HOLE
      if (tryApply(next(from, { kind: 'cut-send', hash: sha256hex(`s|${seed}|${step}`), to: to.addr, star: '0', amount: amt.toString(), fee: '1' },
        (n) => cutSendMessage(NET, from.addr, to.addr, 0n, amt, n)))) {
        sends++
        if (frozen) frozenSends++
      } else refused++
      pin(L.cuts.conserves() && L.conserves(), `seed ${seed} step ${step}: conserves`)
    }

    if (L.stars.ownerOf(0n) !== BLACK_HOLE) {
      push(next(A, { kind: 'transfer-star', hash: sha256hex(`fr|${seed}`), to: BLACK_HOLE, star: '0', fee: '1' },
        (n) => sendStarMessage(NET, A.addr, BLACK_HOLE, 0n, n)))
    }
    const holder = [A, B, C].find((w) => L.cuts.of('0', w.addr) > 0n) || B
    if (L.cuts.of('0', holder.addr) > 0n) {
      const dest = [A, B, C].find((w) => w.addr !== holder.addr)!
      if (tryApply(next(holder, { kind: 'cut-send', hash: sha256hex(`post|${seed}`), to: dest.addr, star: '0', amount: '1', fee: '1' },
        (n) => cutSendMessage(NET, holder.addr, dest.addr, 0n, 1n, n)))) frozenSends++
    }
    pin(L.stars.ownerOf(0n) === BLACK_HOLE, `seed ${seed}: face is at the hole`)
    pin(L.cuts.conserves() && L.conserves(), `seed ${seed}: conserves after freeze`)

    const reboot = new KrayLedger(undefined, NET)
    for (const e of journal) reboot.applyLive(e)
    pin(reboot.cascadeRoot() === L.cascadeRoot(), `seed ${seed}: reboot cascade is byte-exact`)
    pin(reboot.cuts.of('0', A.addr) === L.cuts.of('0', A.addr)
      && reboot.cuts.of('0', B.addr) === L.cuts.of('0', B.addr)
      && reboot.cuts.of('0', C.addr) === L.cuts.of('0', C.addr), `seed ${seed}: holders survive replay`)
    pin(reboot.cuts.view('0')?.name === 'Luz', `seed ${seed}: mouth is still Luz after reboot`)
  }

  ok(sends > 0 && refused > 0, `swarm mixed Luz sends and refusals (sent ${sends}, refused ${refused})`)
  ok(frozenSends > 0, `Luz still moved after freeze (${frozenSends} post-hole sends)`)

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks — Luz seals, Luz moves on its own domain, forges die, freeze keeps the hair, reboot is exact. ✧\n`)
}
main()
