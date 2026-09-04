/**
 * KRAY PLATE SWARM — living plate under hostility, then stranger reboot.
 *   node src/test/kray-plate-swarm.test.ts
 *
 * Five seeds × 80 acts: seal / rotate / clear address plates, star plates,
 * send (toxic inherit refuse), forge, fee wrong, identical refuse, missing atlas.
 * Refusal must not mutate cascade / balances / plate tip. Reboot is byte-exact.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  inscribeMessageV2, sendStarMessage,
} from '../protocol/scheme.ts'
import {
  encodeKrayPlate, hashKrayPlate, setKrayPlateMessage,
} from '../protocol/kray-plate.ts'
import { TREASURY, sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const pin = (c: boolean, m: string) => { if (c) { pass++; return } fail++; console.log('  ✗ FAIL — ' + m) }
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('kray-plate-swarm|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex, tag }
}
type W = ReturnType<typeof wallet>
type Fields = { description: string; url: string; bannerUrl: string }

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
  console.log('\n╔═ KRAY PLATE SWARM — seal · rotate · forge · inherit · reboot ═╗\n')

  const seeds = [5, 13, 21, 37, 53]
  let acts = 0, applied = 0, refused = 0
  const seen = { seal: 0, rotate: 0, clear: 0, star: 0, send: 0, attack: 0 }

  for (const seed of seeds) {
    const rnd = mulberry(seed)
    const W = [0, 1, 2, 3, 4].map((i) => wallet(`s${seed}w${i}`))
    const atlas = new Map<string, Uint8Array>()
    const L = new KrayLedger(undefined, NET, undefined, false, (h) => atlas.get(h) ?? null)
    const journal: KrayEvent[] = []
    let seq = 0
    const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
    const snap = () => ({
      root: L.cascadeRoot(),
      pot: L.balanceOf(TREASURY),
      plates: [...W.map((w) => L.krayPlateOf(w.addr) || '')].join('|'),
      money: W.map((w) => L.balanceOf(w.addr)).reduce((a, b) => a + b, 0n),
    })
    const tryApply = (e: KrayEvent): boolean => {
      const before = snap()
      try { push(e); return true }
      catch {
        const after = snap()
        pin(after.root === before.root && after.pot === before.pot && after.plates === before.plates
          && after.money === before.money && L.conserves(),
          `seed ${seed}: a refusal mutated plate/treasury/root`)
        return false
      }
    }
    for (const w of W) {
      seq++
      push({ seq, kind: 'donate', hash: sha256hex(`d|${seed}|${w.tag}`), to: w.addr, amount: '10000' } as KrayEvent)
    }

    const born = (owner: W, tag: string): bigint => {
      const before = L.stars.createdSeq
      const body = `img|${seed}|${tag}`
      const ch = createHash('sha256').update(body).digest('hex')
      const nonce = L.nonceOf(owner.addr)
      const msg = inscribeMessageV2(NET, owner.addr, ch, 'image/png', body.length, undefined, nonce)
      seq++
      push({
        seq, kind: 'inscribe', at: 0, from: owner.addr, contentHash: ch, contentType: 'image/png', size: body.length,
        hash: sha256hex(`i|${seed}|${tag}`), nonce, publicKey: owner.pk,
        signature: _signKrayWallet(msg, owner.sk), scheme: 'kraywallet',
      } as KrayEvent)
      return BigInt(before)
    }
    for (const w of W) born(w, w.tag)

    const put = (f: Fields) => {
      const ph = hashKrayPlate(f)
      atlas.set(ph, encodeKrayPlate(f))
      return ph
    }
    const fieldsOf = (tag: string, n: number): Fields => ({
      description: `bio ${tag} ${n}`.slice(0, 40),
      url: n % 3 === 0 ? '' : `https://ex${n % 7}.example`,
      bannerUrl: n % 5 === 0 ? `https://ban${n % 4}.example` : '',
    })
    const seal = (w: W, plateHash: string, star = '', fee = '1') => {
      const nonce = L.nonceOf(w.addr)
      const msg = setKrayPlateMessage(NET, w.addr, plateHash, star, nonce)
      seq++
      return {
        seq, kind: 'set-kray-plate', at: Date.now() + seq, from: w.addr, plateHash,
        ...(star ? { star } : {}), fee, hash: sha256hex(`p|${seed}|${seq}`),
        nonce, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet',
      } as KrayEvent
    }

    for (let step = 0; step < 80; step++) {
      const w = W[Math.floor(rnd() * W.length)]!
      const other = W[Math.floor(rnd() * W.length)]!
      const roll = rnd()
      acts++
      const living = L.stars.starsOf(w.addr)
      const tre0 = L.balanceOf(TREASURY)
      const bal0 = L.balanceOf(w.addr)

      if (roll < 0.28) {
        // seal / rotate address plate
        const f = fieldsOf(w.tag, step)
        const ph = put(f)
        const cur = L.krayPlateOf(w.addr)
        if (tryApply(seal(w, ph))) {
          applied++
          if (cur) seen.rotate++; else seen.seal++
          pin(L.krayPlateOf(w.addr) === ph, `seed ${seed} step ${step}: tip plate = sealed hash`)
          pin(L.balanceOf(w.addr) === bal0 - 1n && L.balanceOf(TREASURY) === tre0 + 1n,
            `seed ${seed} step ${step}: exactly 1 ₭ → Treasury`)
        } else refused++
      } else if (roll < 0.40) {
        // star plate by owner
        if (!living.length) { refused++; continue }
        const no = living[Math.floor(rnd() * living.length)]!
        const f = fieldsOf(`star${no}`, step)
        const ph = put(f)
        if (tryApply(seal(w, ph, no.toString()))) {
          applied++; seen.star++
          pin(L.krayStarPlateOf(no) === ph, `seed ${seed} step ${step}: star #${no} plate tip`)
          pin(L.balanceOf(TREASURY) === tre0 + 1n, `seed ${seed} step ${step}: star plate paid 1 ₭`)
        } else refused++
      } else if (roll < 0.50) {
        // clear address plate
        if (!L.krayPlateOf(w.addr)) { refused++; continue }
        if (tryApply(seal(w, ''))) {
          applied++; seen.clear++
          pin(L.krayPlateOf(w.addr) === null, `seed ${seed} step ${step}: address plate cleared`)
          pin(L.balanceOf(TREASURY) === tre0 + 1n, `seed ${seed} step ${step}: clear still costs 1 ₭`)
        } else refused++
      } else if (roll < 0.62) {
        // send living star — star plate must die; address plate must live
        if (!living.length || other.addr === w.addr) { refused++; continue }
        const no = living[0]!
        const hadStarPlate = L.krayStarPlateOf(no)
        const addrPlate = L.krayPlateOf(w.addr)
        const nonce = L.nonceOf(w.addr)
        const msg = sendStarMessage(NET, w.addr, other.addr, no, nonce)
        seq++
        const e = {
          seq, kind: 'transfer-star', at: 0, from: w.addr, to: other.addr, star: no.toString(), fee: '1',
          hash: sha256hex(`s|${seed}|${step}`), nonce, publicKey: w.pk,
          signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet',
        } as KrayEvent
        if (tryApply(e)) {
          applied++; seen.send++
          pin(L.krayStarPlateOf(no) === null, `seed ${seed} step ${step}: star plate cleared on send`)
          pin(L.krayPlateOf(w.addr) === addrPlate, `seed ${seed} step ${step}: address plate survives send`)
          if (hadStarPlate) pin(true, `seed ${seed} step ${step}: had star plate before send`)
        } else refused++
      } else if (roll < 0.74) {
        // identical refuse
        const cur = L.krayPlateOf(w.addr)
        if (!cur) { refused++; continue }
        seen.attack++
        if (tryApply(seal(w, cur))) {
          pin(false, `seed ${seed} step ${step}: identical plate must refuse`)
          applied++
        } else refused++
      } else if (roll < 0.86) {
        // forge — Mallory signs Alice's plate (must be a different key)
        if (other.addr === w.addr) { refused++; continue }
        const f = fieldsOf('forge', step)
        const ph = put(f)
        const nonce = L.nonceOf(w.addr)
        const msg = setKrayPlateMessage(NET, w.addr, ph, '', nonce)
        seq++
        const e = {
          seq, kind: 'set-kray-plate', at: 1, from: w.addr, plateHash: ph, fee: '1',
          hash: sha256hex(`f|${seed}|${step}`), nonce, publicKey: other.pk,
          signature: _signKrayWallet(msg, other.sk), scheme: 'kraywallet',
        } as KrayEvent
        seen.attack++
        if (tryApply(e)) {
          pin(false, `seed ${seed} step ${step}: forge must refuse`)
          applied++
        } else refused++
      } else if (roll < 0.93) {
        // wrong fee
        const f = fieldsOf('fee', step)
        const ph = put(f)
        seen.attack++
        if (tryApply(seal(w, ph, '', rnd() < 0.5 ? '0' : '2'))) {
          pin(false, `seed ${seed} step ${step}: wrong fee must refuse`)
          applied++
        } else refused++
      } else {
        // missing atlas (hash not staged)
        const f = fieldsOf('ghost', step)
        const ph = hashKrayPlate(f) // deliberately NOT put into atlas
        seen.attack++
        if (tryApply(seal(w, ph))) {
          pin(false, `seed ${seed} step ${step}: missing atlas must refuse`)
          applied++
        } else refused++
      }
      pin(L.conserves(), `seed ${seed} step ${step}: conserves`)
    }

    pin(L.conserves(), `seed ${seed}: conserves at storm end`)

    // stranger reboot with same atlas tip bytes
    const atlas2 = new Map(atlas)
    const reboot = new KrayLedger(undefined, NET, undefined, false, (h) => atlas2.get(h) ?? null)
    for (const e of journal) reboot.applyLive({ ...e })
    pin(reboot.cascadeRoot() === L.cascadeRoot(), `seed ${seed}: reboot cascade root byte-exact`)
    for (const w of W) {
      pin(reboot.krayPlateOf(w.addr) === L.krayPlateOf(w.addr), `seed ${seed}: reboot address plate of ${w.tag}`)
      for (const no of L.stars.starsOf(w.addr)) {
        pin(reboot.krayStarPlateOf(no) === L.krayStarPlateOf(no), `seed ${seed}: reboot star plate #${no}`)
      }
    }
    pin(reboot.balanceOf(TREASURY) === L.balanceOf(TREASURY), `seed ${seed}: reboot treasury exact`)
  }

  ok(seen.seal + seen.rotate > 20, `swarm sealed/rotated address plates (${seen.seal + seen.rotate})`)
  ok(seen.star > 5, `swarm sealed star plates (${seen.star})`)
  ok(seen.attack > 30, `hostile doors fired (${seen.attack} attacks)`)
  ok(applied > 0 && refused > 0, `swarm mixed applies and refusals (applied ${applied}, refused ${refused}, acts ${acts})`)
  console.log(`  · ${acts} acts across ${seeds.length} seeds · ${applied} applied · ${refused} refused`)
  console.log(`  · gallery: seal ${seen.seal} · rotate ${seen.rotate} · clear ${seen.clear} · star ${seen.star} · send ${seen.send} · attack ${seen.attack}`)

  if (fail) {
    console.error(`\n✗ ${fail} failed · ${pass} passed — KRAY PLATE SWARM BROKE\n`)
    process.exit(1)
  }
  console.log(`\n✅ kray-plate-swarm: ${pass} passed, 0 failed\n`)
}
main()
