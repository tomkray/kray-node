/**
 * Ӿ MINT — the transferable token BORN FROM BURNED ₭ (slice 1: the birth). Prove by breaking:
 *   node src/test/x-mint.test.ts
 *
 *   X-01  every ₭ burn mints Ӿ 1:1 to the BURNER — an inscription burns starBurnOf(size) ₭ → exactly that much Ӿ
 *   X-02  CONSERVED — Σ xMinted == totalBurned, always; the strengthened tripwire conserves() pins it
 *   X-03  "burn 1000 → receive 1000" — 1000 unit burns by one address = 1000 Ӿ, exact, proportional to the AMOUNT
 *   X-04  PER-BURNER — the 2nd burn site (a law on a star) mints too; B's burns are B's Ӿ, A's stay A's (no cross-credit)
 *   X-05  TWO BOOKS DON'T CROSS — a FREEZE (star → black hole) mints ✦ glow and ZERO Ӿ; a burn mints Ӿ, not glow
 *   X-06  ₭ → black hole is a FREEZE of ₭ (a credit to the dead address), NOT a burn → mints NO Ӿ
 *   X-07  PERMANENT + re-derivable — replay re-derives every wallet's Ӿ byte-exact; the cascade root is UNCHANGED by
 *         Ӿ (genesis-safe: slice 1 does not fold Ӿ into the root — the whole existing suite stays byte-identical)
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  inscribeMessageV2, contractMessageV2, transferMessage, sendStarMessage,
} from '../protocol/scheme.ts'
import { canonicalCode } from '../protocol/contract.ts'
import { compileMint } from '../protocol/star-forms.ts'
import { sha256hex, starBurnOf, BLACK_HOLE, type KrayEvent } from '../protocol/kray-primitives.ts'
import { glowOf, frozenStarGlow } from '../economics/glow-star.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('x-mint|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B')
const J: KrayEvent[] = []
function apply(L: KrayLedger, e: KrayEvent) { L.applyLive(e); J.push(e) }

/** a bare inscription — burns starBurnOf(size) ₭ and births a star owned by the inscriber */
function inscribe(L: KrayLedger, w: typeof A, tag: string, size = 8): KrayEvent {
  const ch = sha256hex(tag)
  const n = L.nonceOf(w.addr)
  return {
    seq: J.length + 1, kind: 'inscribe', hash: tag, from: w.addr, contentHash: ch, contentType: 'text/plain', size,
    nonce: n, publicKey: w.pk, signature: _signKrayWallet(inscribeMessageV2(NET, w.addr, ch, 'text/plain', size, undefined, n), w.sk), scheme: 'kraywallet',
  } as KrayEvent
}
/** seal a law on an owned star — the 2nd ₭-burn site (burns exactly 1 ₭) */
function lawOn(L: KrayLedger, w: typeof A, star: bigint): KrayEvent {
  const code = compileMint({ price: '5', max: '3' })
  const h = sha256hex(canonicalCode(code))
  return {
    seq: J.length + 1, kind: 'contract', hash: 'law|' + star, from: w.addr, code, star: star.toString(),
    publicKey: w.pk, signature: _signKrayWallet(contractMessageV2(NET, w.addr, h, star), w.sk), scheme: 'kraywallet',
  } as KrayEvent
}
/** freeze a star — send it to the keyless black hole forever (mints ✦ glow, burns NO ₭) */
function freeze(L: KrayLedger, w: typeof A, star: bigint): KrayEvent {
  const n = L.nonceOf(w.addr)
  return {
    seq: J.length + 1, kind: 'transfer-star', hash: sha256hex('freeze|' + star), from: w.addr, to: BLACK_HOLE, star: star.toString(), fee: '1',
    nonce: n, publicKey: w.pk, signature: _signKrayWallet(sendStarMessage(NET, w.addr, BLACK_HOLE, star, n), w.sk), scheme: 'kraywallet',
  } as KrayEvent
}
/** send fungible ₭ to the black hole — a FREEZE of ₭ (a credit to the dead address), never a burn */
function sendToHole(L: KrayLedger, w: typeof A, amount: bigint): KrayEvent {
  const n = L.nonceOf(w.addr)
  return {
    seq: J.length + 1, kind: 'transfer', hash: sha256hex('hole|' + amount + '|' + n), from: w.addr, to: BLACK_HOLE, amount: amount.toString(), fee: '1',
    nonce: n, publicKey: w.pk, signature: _signKrayWallet(transferMessage(NET, w.addr, BLACK_HOLE, amount, n), w.sk), scheme: 'kraywallet',
  } as KrayEvent
}

function main() {
  console.log('\n╔═ Ӿ MINT — burned ₭ condenses into the transferable light ═╗\n')
  const L = new KrayLedger(undefined, NET)
  apply(L, { seq: 1, kind: 'donate', hash: 'dA', to: A.addr, amount: '2000' } as KrayEvent)
  apply(L, { seq: 2, kind: 'donate', hash: 'dB', to: B.addr, amount: '50' } as KrayEvent)

  console.log('X-01 — every ₭ burn mints Ӿ 1:1 to the burner')
  const b0 = L.totalBurned
  apply(L, inscribe(L, A, 'a-0'))
  const burn1 = L.totalBurned - b0
  ok(burn1 === starBurnOf(8) && burn1 === 1n, `the inscription burned ${burn1} ₭ (starBurnOf(8) = 1)`)
  ok(L.xMintedOf(A.addr) === 1n, 'the inscriber received exactly that much Ӿ — 1:1')
  ok(L.xMintedOf(B.addr) === 0n, 'a non-burner holds 0 Ӿ')

  console.log('X-02 — conserved: Σ xMinted == totalBurned; the tripwire holds')
  ok(L.xEmitted === L.totalBurned, 'xEmitted == totalBurned')
  ok(L.conserves(), 'the strengthened tripwire holds (Σ xMinted == burned AND ₭ conserves)')

  console.log('X-03 — "burn 1000 → receive 1000" (proportional to the amount, no sybil/whale lever)')
  for (let i = 1; i < 1000; i++) apply(L, inscribe(L, A, 'a-' + i))   // 999 more unit burns → 1000 total
  ok(L.xMintedOf(A.addr) === 1000n, 'A burned 1000 ₭ across 1000 acts → A holds exactly 1000 Ӿ')
  ok(L.totalBurned === 1000n && L.xEmitted === 1000n, 'total burned 1000, total Ӿ 1000 — conserved')
  ok(L.conserves(), 'conservation after the thousand burns')

  console.log('X-04 — the 2nd burn site (a law) mints too; per-burner attribution')
  apply(L, lawOn(L, A, 0n))                                            // seal a law on star #0 → burns 1 ₭
  ok(L.xMintedOf(A.addr) === 1001n, 'sealing a law burned 1 ₭ → +1 Ӿ (the 2nd burn site mints too)')
  apply(L, inscribe(L, B, 'b-0'))
  ok(L.xMintedOf(B.addr) === 1n, "B's burn is B's Ӿ (its own book)")
  ok(L.xMintedOf(A.addr) === 1001n, "A's Ӿ is untouched by B's burn — no cross-credit, no sybil/whale lever")
  ok(L.conserves(), 'conservation across both burners')

  console.log('X-05 — two books do not cross: a FREEZE mints ✦ glow and ZERO Ӿ')
  const xA5 = L.xMintedOf(A.addr), b5 = L.totalBurned
  apply(L, freeze(L, A, 5n))                                           // freeze one of A's stars (no law on it)
  ok(L.stars.ownerOf(5n) === BLACK_HOLE, 'star #5 is frozen forever at the black hole')
  ok(L.totalBurned === b5, 'a freeze burns NO ₭ (it pays a fee to the validators, not a burn)')
  ok(L.xMintedOf(A.addr) === xA5, 'the freeze minted ZERO Ӿ — Ӿ is the burned ₭, not the frozen star')
  ok(glowOf(J, A.addr) === 1, 'the freeze minted 1 ✦ glow on A — the OTHER light, the OTHER book')
  ok(L.conserves(), 'conservation after the freeze')

  console.log('X-06 — THE BURN LAW: ₭ can never reach the hole (₭ never freezes — only burns) → no false Ӿ path')
  const xA6 = L.xMintedOf(A.addr), b6 = L.totalBurned
  try { L.applyLive(sendToHole(L, A, 5n)); ok(false, '₭ → hole should be REFUSED — DID NOT throw') }
  catch (e) { ok(/cannot be frozen — only burned/i.test((e as Error).message), '₭ → hole REFUSED: "₭ cannot be frozen — only burned" (the ratified law, from genesis on regtest)') }
  ok(L.balanceOf(BLACK_HOLE) === 0n, 'the hole holds NO fungible ₭ — the law kept it star-only')
  ok(L.totalBurned === b6 && L.xMintedOf(A.addr) === xA6, 'the refusal minted nothing, burned nothing — state byte-identical')
  ok(L.conserves(), 'conservation after the refused freeze (the pre-law freeze semantics are proven in x-burn B-05)')

  console.log('X-07 — permanent + re-derivable; the cascade root is unchanged by Ӿ (genesis-safe)')
  const L2 = new KrayLedger(undefined, NET)
  for (const e of J) L2.applyLive(e)
  ok(L2.xMintedOf(A.addr) === L.xMintedOf(A.addr) && L2.xMintedOf(B.addr) === L.xMintedOf(B.addr), "replay re-derives every wallet's Ӿ, byte-exact")
  ok(L2.xEmitted === L.xEmitted && L2.totalBurned === L.totalBurned, 'replay re-derives the totals')
  ok(L2.cascadeRoot() === L.cascadeRoot(), 'the cascade root replays byte-exact (Ӿ rides the journal, not new trust)')
  ok(L2.conserves(), 'replay conserves — the Ӿ invariant travels with the journal')

  console.log('X-08 — the leaderboard source: xEntries ranks Ӿ by minted, frozenStarGlow ranks ✦ by count')
  const xRank = L.xEntries().sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
  ok(xRank[0][0] === A.addr && xRank[0][1] === 1001n, 'Ӿ rank #1 is A with 1001 Ӿ (1000 inscriptions + 1 law)')
  ok(xRank[1][0] === B.addr && xRank[1][1] === 1n, 'Ӿ rank #2 is B with 1 Ӿ')
  const glowMap = frozenStarGlow(J)
  ok(glowMap.get(A.addr) === 1 && glowMap.size === 1, 'glow rank: A is the sole freezer with 1 ✦')
  ok(L.xEntries().reduce((s, [, v]) => s + v, 0n) === L.xEmitted, 'the leaderboard sums to the total Ӿ — nothing minted off-book')
  const books = L.xBooks()
  ok(books.length === xRank.length, 'xBooks unions the same fire-touched addresses as xEntries on a mint-only journal')
  const bookA = books.find((r) => r.address === A.addr)
  ok(bookA && bookA.minted === 1001n && bookA.spendable === 1001n && bookA.lane === 0n && bookA.tank === 1001n * 1000n,
    'xBooks: A minted = spendable, tank = F × minted, lane empty (no fold yet)')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — Ӿ MINT HOLDS: every burned ₭ condenses 1:1 into Ӿ for the burner, conserved on the tripwire, per-burner, the two lights never cross, and replay is byte-exact. ₭→Ӿ ⚱️→✨`)
}
main()
