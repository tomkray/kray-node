/**
 * THE SIZE-PROPORTION ERA — 1 ₭ / 10_000 bytes, 10 MB ceiling, ceil, atlas beside the fire.
 * Prove by breaking:
 *   node src/test/size-proportion.test.ts
 *
 *   SP-01  the function: floor 1, boundaries 10_000 / 10_001, 3 MB = 300, 10 MB = 1_000
 *   SP-02  a name / empty star stays 1 ₭ (baptism untouched)
 *   SP-03  donate-only cascade is identical whether the era is on or off (A3 — mainnet seq 1)
 *   SP-04  after activation: 3 MB = 300 fire + 300 atlas; 470 B SVG = 1 + 1
 *   SP-05  10 MB is accepted; 10 MB + 1 is refused before any burn
 *   SP-06  21 MB (old ceiling) is refused after activation
 *   SP-07  below the pin a 1 MB star still burns 1 ₭ (Signet history)
 *   SP-08  at the pin the rate snaps; replay matches
 *   SP-09  ceil is Cauchy-safe: split never cheaper
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, inscribeMessageV2, nameMessageV2 } from '../protocol/scheme.ts'
import {
  starBurnOf, retargetBytesPerKray, BYTES_PER_KRAY_PROPORTION, BYTES_PER_KRAY_MIN, BYTES_PER_KRAY_MIN_PROPORTION,
  MAX_INSCRIPTION_PROPORTION, SIZE_PROPORTION_ACTIVATION_SEQ, RETARGET_WINDOW_SEALS, TARGET_BYTES_PER_SEAL,
  TREASURY, type KrayEvent,
} from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
function wallet(tag: string) {
  const sk = createHash('sha256').update('size-proportion|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const A = wallet('A')
function walletMain(tag: string) {
  const sk = createHash('sha256').update('size-proportion|main|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.main).address! }
}
function mainEra(proportionSeq?: number) {
  return new KrayLedger(
    undefined, 'main', undefined, false, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, proportionSeq,
  )
}

/** sizeProportion last; atlas at 0 so the wall-toll rides (mainnet-shaped). */
function era(proportionSeq: number, atlasSeq = 0) {
  const L = new KrayLedger(
    undefined, NET, undefined, false, undefined,
    undefined, undefined, undefined, undefined, atlasSeq,
    undefined, undefined, undefined, proportionSeq,
  )
  const J: KrayEvent[] = []
  const ap = (e: Record<string, unknown>) => {
    const ev = { ...e, seq: J.length + 1 } as unknown as KrayEvent
    L.applyLive(ev)
    J.push(ev)
    return ev
  }
  return { L, J, ap }
}
function inscribeEv(L: KrayLedger, tag: string, size: number) {
  const ch = createHash('sha256').update(tag).digest('hex')
  const n = L.nonceOf(A.addr)
  return {
    kind: 'inscribe', hash: tag, from: A.addr, contentHash: ch, contentType: 'audio/mpeg', size,
    nonce: n, publicKey: A.pk,
    signature: _signKrayWallet(inscribeMessageV2(NET, A.addr, ch, 'audio/mpeg', size, undefined, n), A.sk),
    scheme: 'kraywallet',
  } as Record<string, unknown>
}

function main() {
  console.log('\n╔═ SIZE PROPORTION — 1 ₭ / 10 KB · 10 MB ceiling · donate-identical ═╗\n')

  console.log('SP-01 — starBurnOf arithmetic at the proportion rate')
  const R = BYTES_PER_KRAY_PROPORTION
  ok(starBurnOf(undefined, R) === 1n, 'empty / name → 1')
  ok(starBurnOf(0, R) === 1n, 'size 0 → 1')
  ok(starBurnOf(1, R) === 1n, '1 byte → 1')
  ok(starBurnOf(470, R) === 1n, 'k.svg 470 B → 1')
  ok(starBurnOf(10_000, R) === 1n, 'exactly 10_000 → 1 (inclusive)')
  ok(starBurnOf(10_001, R) === 2n, '10_001 → 2')
  ok(starBurnOf(1_000_000, R) === 100n, '1 MB → 100 (the 3-6-9 first column)')
  ok(starBurnOf(3_000_000, R) === 300n, '3 MB → 300')
  ok(starBurnOf(9_000_000, R) === 900n, '9 MB → 900')
  ok(starBurnOf(9_000_001, R) === 901n, '9 MB + 1 → 901 (ceil, never a silent floor)')
  ok(starBurnOf(10_000_000, R) === 1000n, '10 MB → 1_000')
  ok(starBurnOf(1, 0) === 1n, 'hostile rate 0 fails closed to the 1 ₭ floor')
  ok(SIZE_PROPORTION_ACTIVATION_SEQ.main === 0, 'main is born in the era (pin 0)')
  ok(SIZE_PROPORTION_ACTIVATION_SEQ.regtest === Number.MAX_SAFE_INTEGER, 'regtest goldens stay on the genesis rate')
  ok(SIZE_PROPORTION_ACTIVATION_SEQ.signet > 0 && SIZE_PROPORTION_ACTIVATION_SEQ.signet < Number.MAX_SAFE_INTEGER, 'signet is gated (A3) — not a silent rewrite of 57 stars')

  console.log('\nSP-02 — baptism is still 1 ₭, no atlas')
  const N = era(0)
  N.ap({ kind: 'donate', hash: 'd', to: A.addr, amount: '100' })
  const nm = 'liberdade', nonce = N.L.nonceOf(A.addr)
  N.ap({
    kind: 'name', hash: 'n1', from: A.addr, name: nm, nonce,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, nonce, nm), A.sk), scheme: 'kraywallet',
  })
  ok(N.L.balanceOf(A.addr) === 99n, 'name burned exactly 1 ₭')
  ok(N.L.balanceOf(TREASURY) === 0n, 'baptism pays no atlas')

  console.log('\nSP-02b — a name over 64 bytes is refused before any burn (shape, not curse)')
  const G = era(0)
  G.ap({ kind: 'donate', hash: 'd', to: A.addr, amount: '100' })
  const giant = 'a'.repeat(65)
  const gNonce = G.L.nonceOf(A.addr)
  rejects(() => G.ap({
    kind: 'name', hash: 'giant', from: A.addr, name: giant, nonce: gNonce,
    publicKey: A.pk, signature: _signKrayWallet(nameMessageV2(NET, A.addr, gNonce, giant), A.sk), scheme: 'kraywallet',
  }), /64 bytes/, '65 ASCII letters refused — not cursed, not journaled')
  ok(G.L.balanceOf(A.addr) === 100n, 'monster name burned nothing')
  ok(G.L.conserves(), 'A1 holds after the refuse')

  console.log('\nSP-03 — donate-only cascade does not move when the era is on (mainnet seq 1)')
  const Off = era(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  const On = era(0, 0)
  Off.ap({ kind: 'donate', hash: 'd', to: A.addr, amount: '10000' })
  On.ap({ kind: 'donate', hash: 'd', to: A.addr, amount: '10000' })
  ok(Off.L.cascadeRoot() === On.L.cascadeRoot(), 'donate-only: proportion on or off → same cascade root')
  ok(Off.L.balanceOf(A.addr) === 10000n && On.L.balanceOf(A.addr) === 10000n, 'donate minted 10_000 ₭ on both')
  ok(On.L.bytesPerKray === 10_000, 'main-shaped ledger starts at 10_000 bytes/₭')
  ok(Off.L.bytesPerKray === 1_000_000, 'genesis-era ledger stays at 1_000_000 bytes/₭')
  const M = walletMain('donor')
  const MainOn = mainEra()
  const MainOff = mainEra(Number.MAX_SAFE_INTEGER)
  MainOn.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: M.addr, amount: '10000' } as KrayEvent)
  MainOff.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: M.addr, amount: '10000' } as KrayEvent)
  ok(MainOn.cascadeRoot() === MainOff.cascadeRoot(), 'network=main donate-only: pin 0 vs MAX → same cascade (the live seq-1 root does not move)')
  ok(MainOn.bytesPerKray === 10_000 && MainOff.bytesPerKray === 1_000_000, 'main pin 0 already quotes 10_000; the unused rate is not in the root')
  ok(MainOn.conserves() && MainOff.conserves(), 'A1 holds on both sides of the donate-only fork')

  console.log('\nSP-04 — live prices: SVG 2 ₭, song 600 ₭')
  const P = era(0)
  P.ap({ kind: 'donate', hash: 'd', to: A.addr, amount: '10000' })
  P.ap(inscribeEv(P.L, 'svg', 470))
  ok(P.L.balanceOf(TREASURY) === 1n, '470 B atlas = 1')
  ok(P.L.balanceOf(A.addr) === 10000n - 1n - 1n, '470 B total 2 ₭')
  P.ap(inscribeEv(P.L, 'song', 3_000_000))
  ok(P.L.balanceOf(TREASURY) === 1n + 300n, '3 MB atlas = 300')
  ok(P.L.balanceOf(A.addr) === 10000n - 2n - 600n, '3 MB total 600 ₭ (300 fire + 300 wall)')
  ok(P.L.conserves(), 'A1: circulating == emitted − burned after SVG + song')

  console.log('\nSP-05 / SP-06 — 10 MB ceiling')
  const C = era(0)
  C.ap({ kind: 'donate', hash: 'd', to: A.addr, amount: '10000' })
  const before = { bal: C.L.balanceOf(A.addr), root: C.L.cascadeRoot() }
  C.ap(inscribeEv(C.L, 'max', MAX_INSCRIPTION_PROPORTION))
  ok(C.L.balanceOf(A.addr) === before.bal - 2000n, 'exactly 10 MB costs 1_000 fire + 1_000 atlas')
  rejects(() => C.ap(inscribeEv(C.L, 'over', MAX_INSCRIPTION_PROPORTION + 1)), /0 ≤ size ≤/, 'probe of ¬(size ≤ 10 MB): 10_000_001 refused — the law is ≤, not a +1 formula')
  rejects(() => C.ap(inscribeEv(C.L, 'old21', 21_000_000)), /0 ≤ size ≤/, '21 MB (old ceiling) refused — ¬(size ≤ 10 MB)')
  ok(C.L.cascadeRoot() !== before.root, 'the 10 MB star did land (size ≤ 10 MB includes equality)')
  ok(C.L.balanceOf(A.addr) === before.bal - 2000n, 'refused monsters burned nothing more')

  console.log('\nSP-11 — declared integer size: omit and float are holes, closed')
  const H = era(0)
  H.ap({ kind: 'donate', hash: 'd', to: A.addr, amount: '10000' })
  const omitCh = createHash('sha256').update('omit').digest('hex')
  const omitN = H.L.nonceOf(A.addr)
  rejects(() => H.ap({
    kind: 'inscribe', hash: 'omit', from: A.addr, contentHash: omitCh, contentType: 'text/plain',
    nonce: omitN, publicKey: A.pk,
    signature: _signKrayWallet(inscribeMessageV2(NET, A.addr, omitCh, 'text/plain', undefined as unknown as number, undefined, omitN), A.sk),
    scheme: 'kraywallet',
  }), /declared|0 ≤ size ≤/, 'omitting size is refused (would have priced as 0 and paid 1 ₭)')
  rejects(() => H.ap(inscribeEv(H.L, 'float', 10.5)), /0 ≤ size ≤|integer/, '10.5 bytes is not an integer — no float sneak past ≤')
  H.ap(inscribeEv(H.L, 'explicit-zero', 0))
  ok(H.L.balanceOf(A.addr) === 9999n && H.L.balanceOf(TREASURY) === 0n, 'explicit size 0 is a declared empty star (1 ₭, no atlas) — not an omit')

  console.log('\nSP-07 / SP-08 — the pin: old 1 MB rate below, snap at the seq, replay matches')
  const S = era(4, Number.MAX_SAFE_INTEGER) // no atlas — isolate the fire
  S.ap({ kind: 'donate', hash: 'd', to: A.addr, amount: '10000' })
  S.ap(inscribeEv(S.L, 'old', 1_000_000))
  ok(S.L.balanceOf(A.addr) === 9999n, 'seq 2 (below pin 4): 1 MB still burns 1 ₭')
  S.ap({ kind: 'donate', hash: 'd2', to: A.addr, amount: '1' })
  S.ap(inscribeEv(S.L, 'new', 1_000_000))
  ok(S.L.bytesPerKray === 10_000, 'at seq 4 the rate snapped to 10_000')
  ok(S.L.balanceOf(A.addr) === 10000n + 1n - 1n - 100n, 'seq 4: 1 MB burns 100 ₭ at the new rate')
  const S2 = era(4, Number.MAX_SAFE_INTEGER)
  for (const ev of S.J) S2.L.applyLive(ev)
  ok(S2.L.cascadeRoot() === S.L.cascadeRoot(), 'replay of the crossing journal is byte-identical')

  console.log('\nSP-09 — ceil is split-safe')
  ok(starBurnOf(10_000, R) + starBurnOf(10_000, R) >= starBurnOf(20_000, R), '10K+10K >= 20K')
  ok(starBurnOf(10_001, R) + starBurnOf(9_999, R) >= starBurnOf(20_000, R), '10_001+9_999 >= 20K')
  const Q1 = era(0), Q2 = era(0)
  Q1.ap({ kind: 'donate', hash: 'd', to: A.addr, amount: '10000' })
  Q2.ap({ kind: 'donate', hash: 'd', to: A.addr, amount: '10000' })
  Q1.ap(inscribeEv(Q1.L, 'a', 10_000)); Q1.ap(inscribeEv(Q1.L, 'b', 10_000))
  Q2.ap(inscribeEv(Q2.L, 'c', 20_000))
  ok(Q1.L.balanceOf(TREASURY) >= Q2.L.balanceOf(TREASURY), 'splitting never pays less atlas than one piece')

  console.log('\nSP-10 — retarget band after the snap: the old 100_000 floor must never undo 10_000')
  const flood = MAX_INSCRIPTION_PROPORTION * RETARGET_WINDOW_SEALS
  const siege = retargetBytesPerKray(10_000, flood, BYTES_PER_KRAY_MIN_PROPORTION)
  ok(siege === 5_000, `proportion siege halves 10_000 → 5_000 (got ${siege})`)
  ok(retargetBytesPerKray(10_000, flood, BYTES_PER_KRAY_MIN) === 100_000, 'old genesis min would jump 10_000 → 100_000 and erase the era — why the floor is era-aware')
  ok(TARGET_BYTES_PER_SEAL === 1_000_000, 'economic target stays 1 MB/seal (the retarget aim, not the hard ceiling)')

  console.log(`\n${fail === 0 ? '✅' : '❌'} size-proportion: ${pass} passed, ${fail} failed\n`)
  if (fail > 0) process.exit(1)
}
main()
