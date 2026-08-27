/**
 * SIZE-PROPORTION SWARM — the live law (1 ₭ / 10 KB, 10 MB) under hostility at scale.
 *   node src/test/size-proportion-swarm.test.ts
 *
 *   SW-0  landmark table: every 3-6-9 / boundary size × fire × atlas
 *   SW-1  every 10 KB bucket edge from 0 → 10 MB (inclusive and +1)
 *   SW-2  8 seeds × 12 wallets × 100 acts: random sizes, names, seals, paupers
 *   SW-3  ceiling / budget / funds / hostile type: refuse whole, mutate nothing
 *   SW-4  6 MB + 6 MB in one seal overflows the 10 MB budget
 *   SW-5  500 random Cauchy pairs: split never cheaper
 *   SW-6  stranger replay = live cascade, A1 after every apply
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, inscribeMessageV2, nameMessageV2 } from '../protocol/scheme.ts'
import {
  starBurnOf, BYTES_PER_KRAY_PROPORTION, MAX_INSCRIPTION_PROPORTION, TREASURY, type KrayEvent,
} from '../protocol/kray-primitives.ts'

const NET = 'regtest'
const R = BYTES_PER_KRAY_PROPORTION
const CAP = MAX_INSCRIPTION_PROPORTION
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const pin = (c: boolean, m: string) => { if (c) { pass++; return } fail++; console.log('  ✗ FAIL — ' + m) }

function H(s: string) { return createHash('sha256').update(s).digest('hex') }
function mulberry(seed: number) {
  let a = seed >>> 0
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function wallet(tag: string) {
  const sk = createHash('sha256').update('size-proportion-swarm|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex, tag }
}
type W = ReturnType<typeof wallet>

/** The live law: pin 0 + atlas 0 — mainnet-shaped, injected on regtest. */
function liveLaw() {
  return new KrayLedger(
    undefined, NET, undefined, false, undefined,
    undefined, undefined, undefined, undefined, 0,
    undefined, undefined, undefined, 0,
  )
}
function priceAt(size: number | undefined, rate: number): { fire: bigint, atlas: bigint } {
  const s = Number(size ?? 0)
  if (!Number.isFinite(s) || s <= 0) return { fire: 1n, atlas: 0n }
  const fire = starBurnOf(s, rate)
  return { fire, atlas: fire }
}
function price(size: number | undefined): { fire: bigint, atlas: bigint } { return priceAt(size, R) }

function main() {
  console.log('\n╔═ SIZE-PROPORTION SWARM — live law · every bucket · hostility · replay ═╗\n')

  console.log('SW-0 — landmark table (fire + atlas = total)')
  const landmarks: [number | undefined, bigint, bigint][] = [
    [undefined, 1n, 0n],
    [0, 1n, 0n],
    [1, 1n, 1n],
    [470, 1n, 1n],
    [9_999, 1n, 1n],
    [10_000, 1n, 1n],
    [10_001, 2n, 2n],
    [20_000, 2n, 2n],
    [1_000_000, 100n, 100n],
    [3_000_000, 300n, 300n],
    [9_000_000, 900n, 900n],
    [9_000_001, 901n, 901n],
    [10_000_000, 1000n, 1000n],
  ]
  for (const [size, fire, atlas] of landmarks) {
    const p = price(size)
    pin(p.fire === fire && p.atlas === atlas, `landmark ${size ?? 'name'} → fire ${fire} atlas ${atlas} (got ${p.fire}/${p.atlas})`)
  }
  ok(fail === 0, `${landmarks.length} landmark prices match the 3-6-9 / 10 KB lock`)

  console.log('\nSW-1 — every 10 KB bucket edge, 0 → 10 MB, applied and conserved')
  {
    const L = liveLaw()
    const w = wallet('sweep')
    const J: KrayEvent[] = []
    let seq = 0
    let sealN = 0
    let sealBytes = 0
    let shadowFire = 0n
    let shadowAtlas = 0n
    const push = (e: KrayEvent) => { L.applyLive(e); J.push(e) }
    const seal = () => {
      sealN += 1
      seq += 1
      push({ seq, kind: 'seal', hash: H('sweep-seal|' + sealN), l1Txid: H('st|' + sealN) } as KrayEvent)
      sealBytes = 0
    }
    const need = (bytes: number) => { if (sealBytes + bytes > CAP) seal() }
    seq += 1
    push({ seq, kind: 'donate', hash: H('sweep-d'), to: w.addr, amount: '10000' } as KrayEvent)
    const applySize = (size: number, tag: string) => {
      need(size)
      const p2 = priceAt(size, L.bytesPerKray)
      let tops = 0
      while (L.balanceOf(w.addr) < p2.fire + p2.atlas && tops < 4) {
        seq += 1
        push({ seq, kind: 'donate', hash: H('sweep-top|' + tag + '|' + tops), to: w.addr, amount: '10000' } as KrayEvent)
        tops++
      }
      const n = L.nonceOf(w.addr)
      const ch = H('sweep|' + tag)
      seq += 1
      const before = { bal: L.balanceOf(w.addr), burn: L.totalBurned, t: L.balanceOf(TREASURY), root: L.cascadeRoot() }
      push({
        seq, kind: 'inscribe', hash: H('si|' + tag), from: w.addr, contentHash: ch, contentType: 'application/octet-stream', size,
        nonce: n, publicKey: w.pk, signature: _signKrayWallet(inscribeMessageV2(NET, w.addr, ch, 'application/octet-stream', size, undefined, n), w.sk), scheme: 'kraywallet',
      } as unknown as KrayEvent)
      pin(L.balanceOf(w.addr) === before.bal - p2.fire - p2.atlas, `sweep ${tag}: paid fire+atlas @ ${L.bytesPerKray}`)
      pin(L.totalBurned === before.burn + p2.fire, `sweep ${tag}: only fire deflates`)
      pin(L.balanceOf(TREASURY) === before.t + p2.atlas, `sweep ${tag}: atlas → TREASURY`)
      pin(L.cascadeRoot() !== before.root && L.conserves(), `sweep ${tag}: root moved, A1 holds`)
      shadowFire += p2.fire
      shadowAtlas += p2.atlas
      sealBytes += size
    }
    let edges = 0
    applySize(0, 'zero')
    edges++
    for (let i = 0; i <= 1000; i++) {
      applySize(i * R, `b${i}`)
      edges++
      if (i < 1000) {
        applySize(i * R + 1, `b${i}+`)
        edges++
      }
    }
    pin(L.totalBurned === shadowFire, 'sweep shadow fire == reducer')
    pin(L.balanceOf(TREASURY) === shadowAtlas, 'sweep shadow atlas == TREASURY')
    const reboot = liveLaw()
    for (const e of J) reboot.applyLive(e)
    ok(reboot.cascadeRoot() === L.cascadeRoot(), `SW-1 replay of ${edges} bucket-edge stars is byte-identical`)
    ok(L.conserves() && reboot.conserves(), `SW-1 A1 after ${edges} edges`)
    ok(L.bytesPerKray === 10_000 || L.bytesPerKray === 5_000 || L.bytesPerKray === 20_000,
      `SW-1 live rate stayed on the ×2 clamp (${L.bytesPerKray} bytes/₭) — never jumped to the old 100_000 floor`)
  }

  console.log('\nSW-4 — 10 MB seal budget (6 + 6 overflows; after seal it lands)')
  {
    const L = liveLaw()
    const w = wallet('budget')
    let seq = 0
    const push = (e: KrayEvent) => { L.applyLive(e); seq = e.seq }
    push({ seq: 1, kind: 'donate', hash: H('bd'), to: w.addr, amount: '10000' } as KrayEvent)
    const ins = (size: number, tag: string, s: number) => {
      const n = L.nonceOf(w.addr)
      const ch = H('bd|' + tag)
      return {
        seq: s, kind: 'inscribe', hash: H('bi|' + tag), from: w.addr, contentHash: ch, contentType: 'video/mp4', size,
        nonce: n, publicKey: w.pk, signature: _signKrayWallet(inscribeMessageV2(NET, w.addr, ch, 'video/mp4', size, undefined, n), w.sk), scheme: 'kraywallet',
      } as unknown as KrayEvent
    }
    push(ins(6_000_000, 'a', 2))
    const root = L.cascadeRoot()
    const bal = L.balanceOf(w.addr)
    let refused = false
    try { L.applyLive(ins(6_000_000, 'b', 3)) } catch (e) {
      refused = /seal's content budget is full/.test((e as Error).message)
    }
    ok(refused, '6 MB + 6 MB in one 10 MB seal is refused')
    ok(L.cascadeRoot() === root && L.balanceOf(w.addr) === bal, 'the overflow burned nothing')
    push({ seq: 3, kind: 'seal', hash: H('bs'), l1Txid: H('bst') } as KrayEvent)
    push(ins(6_000_000, 'b', 4))
    ok(L.conserves() && L.balanceOf(w.addr) === bal - 1200n, 'after the seal the same 6 MB lands (600 fire + 600 atlas)')
  }

  console.log('\nSW-3 — ceiling, funds, hostile type: refuse whole')
  {
    const L = liveLaw()
    const w = wallet('hostile')
    const p = wallet('pauper')
    L.applyLive({ seq: 1, kind: 'donate', hash: H('hd'), to: w.addr, amount: '10000' } as KrayEvent)
    L.applyLive({ seq: 2, kind: 'donate', hash: H('hp'), to: p.addr, amount: '3' } as KrayEvent)
    const tryIns = (who: W, size: number, tag: string, seq: number, sizeOverride?: unknown) => {
      const n = L.nonceOf(who.addr)
      const ch = H('h|' + tag)
      const signedSize = typeof sizeOverride === 'number' ? sizeOverride : size
      return {
        seq, kind: 'inscribe', hash: H('hi|' + tag), from: who.addr, contentHash: ch, contentType: 'video/mp4', size: sizeOverride === undefined ? size : sizeOverride,
        nonce: n, publicKey: who.pk,
        signature: _signKrayWallet(inscribeMessageV2(NET, who.addr, ch, 'video/mp4', signedSize, undefined, n), who.sk),
        scheme: 'kraywallet',
      } as unknown as KrayEvent
    }
    const snap = () => ({ root: L.cascadeRoot(), bal: L.balanceOf(w.addr), p: L.balanceOf(p.addr), burn: L.totalBurned, t: L.balanceOf(TREASURY) })
    const mustRefuse = (fn: () => void, re: RegExp, m: string) => {
      const s = snap()
      try { fn(); ok(false, m + ' — DID NOT throw') }
      catch (e) {
        const msg = (e as Error).message
        ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg))
      }
      const a = snap()
      pin(a.root === s.root && a.bal === s.bal && a.p === s.p && a.burn === s.burn && a.t === s.t, m + ' — state frozen')
    }
    mustRefuse(() => L.applyLive(tryIns(w, CAP + 1, 'over', 3)), /protocol ceiling/, '10 MB + 1 refused')
    mustRefuse(() => L.applyLive(tryIns(w, 21_000_000, 'old21', 3)), /protocol ceiling/, '21 MB (old ceiling) refused')
    mustRefuse(() => L.applyLive(tryIns(p, 1_000_000, 'poor', 3)), /insufficient ₭/, '3 ₭ cannot buy a 200 ₭ (1 MB) star')
    mustRefuse(() => L.applyLive(tryIns(w, 8, 'nan', 3, Number.NaN)), /size must be a finite/, 'NaN size refused')
    mustRefuse(() => L.applyLive(tryIns(w, 8, 'neg', 3, -1)), /size must be a finite/, 'negative size refused')
    mustRefuse(() => L.applyLive(tryIns(w, 8, 'str', 3, '1000' as unknown as number)), /size must be a finite|does not verify/, 'string size refused')
  }

  console.log('\nSW-5 — 500 random Cauchy pairs: split never cheaper')
  {
    const rnd = mulberry(20260825)
    let pairs = 0
    for (let i = 0; i < 500; i++) {
      const a = 1 + Math.floor(rnd() * (CAP / 2))
      const b = 1 + Math.floor(rnd() * (CAP - a))
      const left = starBurnOf(a, R) + starBurnOf(b, R)
      const right = starBurnOf(a + b, R)
      pin(left >= right, `Cauchy ${a}+${b} >= ${a + b} (${left} >= ${right})`)
      pairs++
    }
    ok(pairs === 500, '500 random splits never cheaper than the whole')
  }

  console.log('\nSW-2 — 8 seeds × 12 wallets × 100 acts, then reboot')
  const seeds = [3, 11, 17, 29, 41, 53, 71, 99]
  let acts = 0, applied = 0, refused = 0
  const seen = { inscribe: 0, name: 0, empty: 0, ceiling: 0, budget: 0, poor: 0, seal: 0 }
  for (const seed of seeds) {
    const rnd = mulberry(seed)
    const W = Array.from({ length: 12 }, (_, i) => wallet(`s${seed}w${i}`))
    const L = liveLaw()
    const J: KrayEvent[] = []
    let seq = 0
    let sealN = 0
    let sealBytes = 0
    let shadowFire = 0n
    let shadowAtlas = 0n
    let shadowEmit = 0n
    const push = (e: KrayEvent) => { L.applyLive(e); J.push(e) }
    const seal = () => {
      sealN += 1
      seq += 1
      push({ seq, kind: 'seal', hash: H(`seal|${seed}|${sealN}`), l1Txid: H(`st|${seed}|${sealN}`) } as KrayEvent)
      sealBytes = 0
      seen.seal++
    }
    for (const w of W) {
      seq += 1
      push({ seq, kind: 'donate', hash: H(`d|${seed}|${w.tag}`), to: w.addr, amount: '10000' } as KrayEvent)
      shadowEmit += 10000n
    }
    const pauper = wallet(`s${seed}poor`)
    seq += 1
    push({ seq, kind: 'donate', hash: H(`d|${seed}|poor`), to: pauper.addr, amount: '2' } as KrayEvent)
    shadowEmit += 2n

    for (let step = 0; step < 100; step++) {
      const w = W[Math.floor(rnd() * W.length)]
      const roll = rnd()
      acts++
      const root = L.cascadeRoot()
      const burned = L.totalBurned
      const treas = L.balanceOf(TREASURY)
      const tryApply = (e: KrayEvent): boolean => {
        try { push(e); return true }
        catch {
          pin(L.cascadeRoot() === root && L.totalBurned === burned && L.balanceOf(TREASURY) === treas && L.conserves(), `seed ${seed} step ${step}: refusal mutated`)
          return false
        }
      }

      if (roll < 0.08) {
        const n = L.nonceOf(w.addr)
        const name = `s${seed}n${step}${w.tag.slice(-3)}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
        seq += 1
        if (tryApply({
          seq, kind: 'name', hash: H(`n|${seed}|${step}`), from: w.addr, name, nonce: n,
          publicKey: w.pk, signature: _signKrayWallet(nameMessageV2(NET, w.addr, n, name), w.sk), scheme: 'kraywallet',
        } as unknown as KrayEvent)) {
          applied++; seen.name++; shadowFire += 1n
        } else refused++
      } else if (roll < 0.14) {
        const n = L.nonceOf(pauper.addr)
        const size = 3_000_000
        const ch = H(`poor|${seed}|${step}`)
        seq += 1
        if (tryApply({
          seq, kind: 'inscribe', hash: H(`pi|${seed}|${step}`), from: pauper.addr, contentHash: ch, contentType: 'audio/mpeg', size,
          nonce: n, publicKey: pauper.pk, signature: _signKrayWallet(inscribeMessageV2(NET, pauper.addr, ch, 'audio/mpeg', size, undefined, n), pauper.sk), scheme: 'kraywallet',
        } as unknown as KrayEvent)) { applied++ } else { refused++; seen.poor++ }
      } else if (roll < 0.20) {
        const n = L.nonceOf(w.addr)
        const size = CAP + 1 + Math.floor(rnd() * 11_000_000)
        const ch = H(`over|${seed}|${step}`)
        seq += 1
        if (tryApply({
          seq, kind: 'inscribe', hash: H(`oi|${seed}|${step}`), from: w.addr, contentHash: ch, contentType: 'video/mp4', size,
          nonce: n, publicKey: w.pk, signature: _signKrayWallet(inscribeMessageV2(NET, w.addr, ch, 'video/mp4', size, undefined, n), w.sk), scheme: 'kraywallet',
        } as unknown as KrayEvent)) { applied++ } else { refused++; seen.ceiling++ }
      } else {
        let size = 0
        if (roll < 0.26) size = 0
        else if (roll < 0.40) size = 1 + Math.floor(rnd() * 20_000)
        else if (roll < 0.55) size = [470, 9_999, 10_000, 10_001, 1_000_000, 3_000_000, 9_000_000][Math.floor(rnd() * 7)]
        else if (roll < 0.70) size = 1_000_000 + Math.floor(rnd() * 8_000_000)
        else size = 9_000_000 + Math.floor(rnd() * (CAP - 9_000_000 + 1))
        if (sealBytes + size > CAP) seal()
        const p = priceAt(size, L.bytesPerKray)
        if (L.balanceOf(w.addr) < p.fire + p.atlas) {
          seq += 1
          try {
            push({ seq, kind: 'donate', hash: H(`top|${seed}|${step}`), to: w.addr, amount: '10000' } as KrayEvent)
            shadowEmit += 10000n
          } catch { refused++; continue }
        }
        const n = L.nonceOf(w.addr)
        const ch = H(`in|${seed}|${step}|${size}`)
        seq += 1
        if (tryApply({
          seq, kind: 'inscribe', hash: H(`ii|${seed}|${step}`), from: w.addr, contentHash: ch, contentType: 'text/plain', size,
          nonce: n, publicKey: w.pk, signature: _signKrayWallet(inscribeMessageV2(NET, w.addr, ch, 'text/plain', size, undefined, n), w.sk), scheme: 'kraywallet',
        } as unknown as KrayEvent)) {
          applied++
          shadowFire += p.fire
          shadowAtlas += p.atlas
          sealBytes += size
          if (size === 0) seen.empty++; else seen.inscribe++
        } else {
          refused++
          if (sealBytes + size > CAP) seen.budget++
        }
      }
      pin(L.conserves(), `seed ${seed} step ${step}: A1`)
    }
    pin(L.totalBurned === shadowFire, `seed ${seed}: shadow fire == reducer (${shadowFire})`)
    pin(L.balanceOf(TREASURY) === shadowAtlas, `seed ${seed}: shadow atlas == TREASURY (${shadowAtlas})`)
    pin(L.totalEmitted === shadowEmit, `seed ${seed}: shadow emit == reducer`)
    const reboot = liveLaw()
    for (const e of J) reboot.applyLive(e)
    pin(reboot.cascadeRoot() === L.cascadeRoot(), `seed ${seed}: reboot cascade byte-exact`)
    pin(reboot.totalBurned === L.totalBurned && reboot.balanceOf(TREASURY) === L.balanceOf(TREASURY), `seed ${seed}: reboot fire+atlas`)
    pin(reboot.conserves(), `seed ${seed}: reboot A1`)
  }
  ok(applied > 0 && refused > 0, `swarm mixed applies and refusals (applied ${applied}, refused ${refused}, acts ${acts})`)
  ok(seen.inscribe > 0 && seen.name > 0 && seen.empty > 0, `life: ${seen.inscribe} inscribed · ${seen.name} named · ${seen.empty} empty`)
  ok(seen.ceiling > 0 && seen.poor > 0, `hostility landed: ${seen.ceiling} ceiling · ${seen.poor} pauper`)
  ok(seen.seal > 0, `seals reopened the 10 MB budget (${seen.seal})`)

  console.log(`\n  · ${acts} random acts across ${seeds.length} seeds · ${applied} applied · ${refused} refused`)
  console.log(`  · inscribe ${seen.inscribe} · name ${seen.name} · empty ${seen.empty} · ceiling ${seen.ceiling} · poor ${seen.poor} · seal ${seen.seal}`)
  console.log(`\n${fail === 0 ? '✅' : '❌'} size-proportion-swarm: ${pass} passed, ${fail} failed\n`)
  if (fail > 0) process.exit(1)
}
main()
