/**
 * STAR-LIKE SWARM — fee→Treasury · tip optional · forge · freeze · reboot.
 *   node src/test/star-like-swarm.test.ts
 *
 * Five seeds × 100 acts: like none/kray/x, self-like, wrong fee, forge tip,
 * freeze+like, insufficient balance. Refusal must not mutate. Stranger reboot
 * byte-exact cascade + like stats.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  inscribeMessageV2, starLikeMessage, sendStarMessage, burnMessage,
} from '../protocol/scheme.ts'
import { TREASURY, BLACK_HOLE, sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const pin = (c: boolean, m: string) => { if (c) { pass++; return } fail++; console.log('  ✗ FAIL — ' + m) }
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('star-like-swarm|' + tag).digest()
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
  console.log('\n╔═ STAR-LIKE SWARM — like · tip · forge · freeze · reboot ═╗\n')

  const seeds = [5, 13, 21, 37, 53]
  let acts = 0, applied = 0, refused = 0
  const seen = { none: 0, kray: 0, x: 0, self: 0, attack: 0, freeze: 0 }

  for (const seed of seeds) {
    const rnd = mulberry(seed)
    const W = [0, 1, 2, 3, 4].map((i) => wallet(`s${seed}w${i}`))
    const L = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, 0)
    const journal: KrayEvent[] = []
    let seq = 0
    const stars: bigint[] = []

    const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
    const snap = () => ({
      root: L.cascadeRoot(),
      pot: L.balanceOf(TREASURY),
      money: W.map((w) => L.balanceOf(w.addr)).reduce((a, b) => a + b, 0n),
      x: W.map((w) => L.xBalanceOf(w.addr)).reduce((a, b) => a + b, 0n),
      likes: typeof L.starLikeStatsOf === 'function'
        ? JSON.stringify(stars.map((s) => L.starLikeStatsOf(s.toString())))
        : '',
    })
    const tryApply = (e: KrayEvent): boolean => {
      const before = snap()
      try { push(e); return true }
      catch {
        const after = snap()
        pin(after.root === before.root && after.pot === before.pot && after.money === before.money
          && after.x === before.x && after.likes === before.likes && L.conserves(),
          `seed ${seed}: refusal mutated state`)
        return false
      }
    }

    for (const w of W) {
      seq++
      push({ seq, kind: 'donate', hash: sha256hex(`d|${seed}|${w.tag}`), to: w.addr, amount: '5000', at: seq } as KrayEvent)
    }
    for (let i = 0; i < 3; i++) {
      const w = W[i]!
      const nonce = L.nonceOf(w.addr)
      const before = L.stars.createdSeq
      const ch = createHash('sha256').update(`star|${seed}|${i}`).digest('hex')
      const msg = inscribeMessageV2(NET, w.addr, ch, 'text/plain', 8, undefined, nonce)
      seq++
      push({
        seq, kind: 'inscribe', hash: sha256hex(`i|${seed}|${i}`), at: 0, from: w.addr,
        contentHash: ch, contentType: 'text/plain', size: 8, nonce,
        publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet',
      } as KrayEvent)
      stars.push(BigInt(before))
    }
    // give W[3] some Ӿ for tip-x acts
    {
      const w = W[3]!
      const nonce = L.nonceOf(w.addr)
      const amt = 20n
      seq++
      push({
        seq, kind: 'burn', hash: sha256hex(`b|${seed}`), at: 0, from: w.addr, amount: String(amt), fee: '1', nonce,
        publicKey: w.pk, signature: _signKrayWallet(burnMessage(NET, w.addr, amt, nonce), w.sk), scheme: 'kraywallet',
      } as KrayEvent)
    }

    for (let round = 0; round < 100; round++) {
      acts++
      const pick = rnd()
      const liker = W[Math.floor(rnd() * W.length)]!
      const star = stars[Math.floor(rnd() * stars.length)]!
      const owner = L.stars.star(star)?.owner

      if (pick < 0.08 && owner && owner !== BLACK_HOLE) {
        // freeze attempt by owner
        const ow = W.find((w) => w.addr === owner)
        if (ow && L.balanceOf(ow.addr) >= 1n) {
          const nonce = L.nonceOf(ow.addr)
          const msg = sendStarMessage(NET, ow.addr, BLACK_HOLE, star, nonce)
          seq++
          const e = {
            seq, kind: 'transfer-star' as const, hash: sha256hex(`f|${seed}|${round}`), at: 0,
            from: ow.addr, to: BLACK_HOLE, star: star.toString(), fee: '1', nonce,
            publicKey: ow.pk, signature: _signKrayWallet(msg, ow.sk), scheme: 'kraywallet',
          } as KrayEvent
          if (tryApply(e)) { applied++; seen.freeze++ } else refused++
          continue
        }
      }

      if (pick < 0.22) {
        // attack: wrong fee / forge amount / like frozen
        seen.attack++
        const tip: 'none' | 'kray' = rnd() < 0.5 ? 'none' : 'kray'
        const tipAmt = tip === 'none' ? null : 1n
        const nonce = L.nonceOf(liker.addr)
        const msg = starLikeMessage(NET, liker.addr, star, tip, tipAmt, null, nonce)
        const fee = rnd() < 0.5 ? '0' : '2'
        const amount = tip === 'kray' && rnd() < 0.5 ? '99' : (tip === 'kray' ? '1' : undefined)
        seq++
        const e = {
          seq, kind: 'star-like' as const, hash: sha256hex(`a|${seed}|${round}`), at: 0,
          from: liker.addr, star: star.toString(), fee, nonce,
          tipAsset: tip === 'none' ? undefined : tip,
          amount,
          publicKey: liker.pk, signature: _signKrayWallet(msg, liker.sk), scheme: 'kraywallet',
        } as KrayEvent
        if (tryApply(e)) { applied++ } else refused++
        continue
      }

      // happy / self like
      let tip: 'none' | 'kray' | 'x' = 'none'
      let amount: string | undefined
      if (pick < 0.55) { tip = 'none'; seen.none++ }
      else if (pick < 0.85) { tip = 'kray'; amount = String(1 + Math.floor(rnd() * 3)); seen.kray++ }
      else { tip = 'x'; amount = '1'; seen.x++ }

      if (owner === liker.addr) seen.self++
      const tipAmt = tip === 'none' ? null : BigInt(amount!)
      const nonce = L.nonceOf(liker.addr)
      let msg: string
      try { msg = starLikeMessage(NET, liker.addr, star, tip, tipAmt, null, nonce) }
      catch { refused++; continue }
      seq++
      const e = {
        seq, kind: 'star-like' as const, hash: sha256hex(`l|${seed}|${round}`), at: 0,
        from: liker.addr, star: star.toString(), fee: '1', nonce,
        tipAsset: tip === 'none' ? undefined : tip,
        amount,
        publicKey: liker.pk, signature: _signKrayWallet(msg, liker.sk), scheme: 'kraywallet',
      } as KrayEvent
      if (tryApply(e)) applied++
      else refused++
    }

    ok(L.conserves(), `seed ${seed}: conserves after swarm`)
    // stranger reboot
    const R = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, 0)
    for (const e of journal) R.applyLive(e)
    ok(R.cascadeRoot() === L.cascadeRoot(), `seed ${seed}: stranger cascade root matches`)
    ok(R.balanceOf(TREASURY) === L.balanceOf(TREASURY), `seed ${seed}: treasury matches reboot`)
    if (typeof L.starLikeStatsOf === 'function' && typeof R.starLikeStatsOf === 'function') {
      for (const s of stars) {
        pin(JSON.stringify(R.starLikeStatsOf(s.toString())) === JSON.stringify(L.starLikeStatsOf(s.toString())),
          `seed ${seed}: like stats reboot ★${s}`)
      }
    }
  }

  ok(acts === seeds.length * 100, `ran ${acts} acts`)
  ok(refused > 0 && applied > 0, `mixed applied=${applied} refused=${refused}`)
  ok(seen.none > 0 && seen.kray > 0 && seen.attack > 0, `coverage none=${seen.none} kray=${seen.kray} x=${seen.x} attack=${seen.attack} freeze=${seen.freeze}`)

  console.log(`\n── ${pass} passed · ${fail} failed · applied ${applied} · refused ${refused} ──\n`)
  if (fail) process.exit(1)
}

main()
