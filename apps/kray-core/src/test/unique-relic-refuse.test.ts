/**
 * THE UNIQUE-RELIC LAW — a lost uniqueness race refuses BEFORE fire (the Buy fractal).
 *   node src/test/unique-relic-refuse.test.ts
 *
 *   UR-01  DORMANT by default — a stock regtest ledger still curse-burns a duplicate (A3)
 *   UR-02  BYTES at/after the pin — second inscribe throws; loser ₭ + nonce untouched
 *   UR-03  NAME at/after the pin — second baptism throws; the name stays with the first writer
 *   UR-04  SAME-TICK NAME RACE — two wallets, one word: first apply wins, second not-taken-debit
 *   UR-05  SAME-TICK BYTE RACE — two wallets, one hash: first apply wins, second not-burned
 *   UR-06  REPLAY — a cursed-burn journal replays byte-identical on a dormant ledger;
 *          the same journal HALTs under a retroactive pin (the gate is real)
 *   UR-07  CONSERVATION on every path
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, inscribeMessageV2, nameMessageV2 } from '../protocol/scheme.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}

function wallet(tag: string) {
  const sk = createHash('sha256').update('unique-relic|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B')

/** 18th ctor arg = uniqueRelicRefuseSeq (undefined → regtest MAX, dormant). */
function ledger(relicSeq?: number) {
  const L = new KrayLedger(
    undefined, NET, undefined, false, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, relicSeq,
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

function donate(to: string, amount: string, tag: string) {
  return { kind: 'donate', hash: tag, to, amount, outpoint: sha256hex(tag) + ':0' } as Record<string, unknown>
}
function inscribeEv(L: KrayLedger, w: typeof A, tag: string) {
  const ch = sha256hex(tag), n = L.nonceOf(w.addr)
  return {
    kind: 'inscribe', hash: tag, from: w.addr, contentHash: ch, contentType: 'text/plain', size: tag.length,
    nonce: n, publicKey: w.pk,
    signature: _signKrayWallet(inscribeMessageV2(NET, w.addr, ch, 'text/plain', tag.length, undefined, n), w.sk),
    scheme: 'kraywallet',
  } as Record<string, unknown>
}
function nameEv(L: KrayLedger, w: typeof A, name: string, tag: string) {
  const n = L.nonceOf(w.addr)
  return {
    kind: 'name', hash: tag, from: w.addr, name,
    nonce: n, publicKey: w.pk,
    signature: _signKrayWallet(nameMessageV2(NET, w.addr, n, name), w.sk),
    scheme: 'kraywallet',
  } as Record<string, unknown>
}

function replay(J: KrayEvent[], relicSeq?: number) {
  const R = new KrayLedger(
    undefined, NET, undefined, false, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, relicSeq,
  )
  for (const e of J) R.applyLive(e)
  return R
}

function main() {
  console.log('\n╔═ THE UNIQUE-RELIC LAW — refuse before fire; A3 below the pin ═╗\n')

  console.log('UR-01 — dormant by default: a stock ledger still curse-burns a duplicate')
  const D = ledger()
  D.ap(donate(A.addr, '20', 'd0'))
  D.ap(inscribeEv(D.L, A, 'relic-a'))
  const kAfterFirst = D.L.balanceOf(A.addr)
  const burned0 = D.L.totalBurned
  const stars0 = D.L.stars.starCount
  D.ap(inscribeEv(D.L, A, 'relic-a'))   // same bytes — cursed birth, fire still taken
  ok(D.L.balanceOf(A.addr) === kAfterFirst - 1n, 'below the pin: the duplicate burned 1 ₭')
  ok(D.L.totalBurned === burned0 + 1n && D.L.stars.starCount === stars0, 'below the pin: no second star — the scar is the burn')
  ok(D.L.conserves(), 'UR-01 conservation')

  console.log('\nUR-02 — bytes at/after the pin: second inscribe throws; loser untouched')
  const I = ledger(1)
  I.ap(donate(A.addr, '20', 'd1'))
  I.ap(inscribeEv(I.L, A, 'relic-b'))
  const kI = I.L.balanceOf(A.addr)
  const nI = I.L.nonceOf(A.addr)
  const burnedI = I.L.totalBurned
  const rootI = I.L.cascadeRoot()
  rejects(() => I.ap(inscribeEv(I.L, A, 'relic-b')), /already inscribed/, 'UR-02 second inscribe refused')
  ok(I.L.balanceOf(A.addr) === kI && I.L.nonceOf(A.addr) === nI, 'UR-02 loser ₭ + nonce intact')
  ok(I.L.totalBurned === burnedI && I.L.stars.starCount === 1, 'UR-02 no second burn, one star')
  ok(I.L.cascadeRoot() === rootI, 'UR-02 refused act left the cascade byte-identical')
  ok(I.L.conserves(), 'UR-02 conservation')

  console.log('\nUR-03 — name at/after the pin: second baptism throws; first writer keeps the word')
  const N = ledger(1)
  N.ap(donate(A.addr, '20', 'dn'))
  N.ap(donate(B.addr, '20', 'dn2'))
  N.ap(nameEv(N.L, A, 'Quire', 'n1'))
  ok(N.L.stars.starOfName('Quire') != null, 'UR-03 Alice holds Quire')
  const kB = N.L.balanceOf(B.addr)
  const nB = N.L.nonceOf(B.addr)
  rejects(() => N.ap(nameEv(N.L, B, 'quire', 'n2')), /already taken/, 'UR-03 canonical collision refused (quire == Quire)')
  ok(N.L.balanceOf(B.addr) === kB && N.L.nonceOf(B.addr) === nB, 'UR-03 Bob lost nothing')
  ok(N.L.stars.starOfName('Quire') != null && N.L.stars.starCount === 1, 'UR-03 one named star, Alice still holds it')
  ok(N.L.conserves(), 'UR-03 conservation')

  console.log('\nUR-04 — same-tick name race: first apply wins, second not-debited')
  const R = ledger(1)
  R.ap(donate(A.addr, '20', 'dr1'))
  R.ap(donate(B.addr, '20', 'dr2'))
  const aName = nameEv(R.L, A, 'LeafCut', 'r-a')
  const bName = nameEv(R.L, B, 'LeafCut', 'r-b')
  R.ap(aName)
  const kLoser = R.L.balanceOf(B.addr)
  rejects(() => R.ap(bName), /already taken/, 'UR-04 Bob refused after Alice applied')
  ok(R.L.balanceOf(B.addr) === kLoser, 'UR-04 Bob ₭ untouched')
  ok(R.L.stars.ownerOf(0n) === A.addr, 'UR-04 star #0 is Alice')

  console.log('\nUR-05 — same-tick byte race: first apply wins, second not-burned')
  const C = ledger(1)
  C.ap(donate(A.addr, '20', 'dc1'))
  C.ap(donate(B.addr, '20', 'dc2'))
  const aIns = inscribeEv(C.L, A, 'same-bytes')
  const bIns = inscribeEv(C.L, B, 'same-bytes')
  C.ap(aIns)
  const kC = C.L.balanceOf(B.addr)
  const burnedC = C.L.totalBurned
  rejects(() => C.ap(bIns), /already inscribed/, 'UR-05 Bob refused after Alice inscribed the bytes')
  ok(C.L.balanceOf(B.addr) === kC && C.L.totalBurned === burnedC, 'UR-05 Bob ₭ untouched, TREASURY/burn unchanged')
  ok(C.L.stars.starCount === 1 && C.L.stars.ownerOf(0n) === A.addr, 'UR-05 one star, Alice')
  ok(C.L.conserves(), 'UR-05 conservation')

  console.log('\nUR-06 — replay: cursed journal is A3 on dormant; retroactive pin HALTs')
  const cursedRoot = D.L.cascadeRoot()
  const twin = replay(D.J)
  ok(twin.cascadeRoot() === cursedRoot, 'UR-06 dormant replay is byte-identical')
  let halted = false
  try { replay(D.J, 1) } catch { halted = true }
  ok(halted, 'UR-06 retroactive pin refuses the cursed scar — the gate is real, not decorative')

  console.log('\nUR-07 — conservation already asserted on every live path')
  ok(D.L.conserves() && I.L.conserves() && N.L.conserves() && R.L.conserves() && C.L.conserves(), 'UR-07 every ledger conserves')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — unique relics refuse before fire; history below the pin is untouched. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
