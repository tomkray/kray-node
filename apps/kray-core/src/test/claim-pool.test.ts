/**
 * THE STANDING POOL — a supply committed once, attested season after season.
 *
 *   node src/test/claim-pool.test.ts
 *
 * The Creator wanted the whole supply visibly committed and draining, not a slice locked per epoch. A season
 * alone could not do it: a harvest pays only the names in its own root, so escrowing a supply against one
 * epoch's list FREEZES the remainder until its closing height, and a merkle root hides its own sum, so the
 * view would promise billions and mean thousands.
 *
 * The pool splits that one number into three that are each true — HELD, COMMITTED, FREE — and this proves
 * they stay true through funding, attesting, claiming, a season going home unclaimed, and the owner's own
 * horizon. After every act the keyless pot must hold exactly what both books say, or the node halts.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes } from '../protocol/scheme.ts'
import { claimRoot, claimProof, claimTakeMessage, claimCloseMessage, type ClaimShare } from '../protocol/claim-book.ts'
import { poolFundMessage, poolSeasonMessage, poolCloseMessage } from '../protocol/pool-book.ts'
import type { PacketLane } from '../protocol/packet-market.ts'
import { TREASURY, CLAIM_POT, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const halts = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const s = (e as Error).message; ok(re.test(s), m + (re.test(s) ? '' : ' — wrong: ' + s)) }
}
interface W { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`claim-pool|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)
const RUNE = '840000:7'
const runeId = { block: 840000n, tx: 7n }

const journal: KrayEvent[] = []
function push(L: KrayLedger, e: KrayEvent): void {
  const before = L.appliedSeq
  L.applyLive(e)
  if (L.appliedSeq === before) throw new Error(`test: the ${e.kind} was silently skipped (stale seq)`)
  journal.push(e)
  if (!L.conserves() || !L.claimsBacked()) throw new Error(`test: the pot or Σ broke after ${e.kind}`)
}
const fields = (lane: PacketLane, asset: string) => lane === 'luz' ? { star: asset } : lane === 'rune' ? { runeId: asset } : {}
const fundEv = (L: KrayLedger, w: W, lane: PacketLane, asset: string, amount: bigint, expires: number, twist?: { sign?: Partial<{ amount: bigint; expires: number }>; by?: W }): KrayEvent => {
  const nonce = L.nonceOf(w.addr), s = twist?.sign ?? {}, signer = twist?.by ?? w
  const e: Record<string, unknown> = {
    seq: L.appliedSeq + 1, kind: 'pool-fund', hash: 'f' + L.appliedSeq, at: 1, from: w.addr, lane, ...fields(lane, asset),
    amount: amount.toString(), fee: '1', nonce, publicKey: signer.pk,
    signature: sign(poolFundMessage(NET, w.addr, lane, asset, s.amount ?? amount, s.expires ?? expires, nonce), signer), scheme: 'kraywallet',
  }
  if (expires) e.expires = expires
  return e as unknown as KrayEvent
}
const seasonEv = (L: KrayLedger, w: W, lane: PacketLane, asset: string, ceiling: bigint, root: string, expires: number, twist?: { sign?: Partial<{ ceiling: bigint; root: string }>; by?: W }): KrayEvent => {
  const nonce = L.nonceOf(w.addr), s = twist?.sign ?? {}, signer = twist?.by ?? w
  const e: Record<string, unknown> = {
    seq: L.appliedSeq + 1, kind: 'pool-season', hash: 's' + L.appliedSeq, at: 1, from: w.addr, lane, ...fields(lane, asset),
    amount: ceiling.toString(), claimRoot: root, fee: '1', nonce, publicKey: signer.pk,
    signature: sign(poolSeasonMessage(NET, w.addr, lane, asset, s.ceiling ?? ceiling, s.root ?? root, expires, nonce), signer), scheme: 'kraywallet',
  }
  if (expires) e.expires = expires
  return e as unknown as KrayEvent
}
const drainEv = (L: KrayLedger, w: W, lane: PacketLane, asset: string, amount: bigint, twist?: { by?: W }): KrayEvent => {
  const nonce = L.nonceOf(w.addr), signer = twist?.by ?? w
  return {
    seq: L.appliedSeq + 1, kind: 'pool-close', hash: 'c' + L.appliedSeq, at: 1, from: w.addr, lane, ...fields(lane, asset),
    amount: amount.toString(), fee: '1', nonce, publicKey: signer.pk,
    signature: sign(poolCloseMessage(NET, w.addr, lane, asset, amount, nonce), signer), scheme: 'kraywallet',
  } as unknown as KrayEvent
}
const takeEv = (L: KrayLedger, w: W, root: string, amount: bigint, proof: unknown): KrayEvent => {
  const nonce = L.nonceOf(w.addr)
  return {
    seq: L.appliedSeq + 1, kind: 'claim-take', hash: 't' + L.appliedSeq, at: 1, from: w.addr, claimRoot: root,
    amount: amount.toString(), claimProof: proof, fee: '1', nonce, publicKey: w.pk,
    signature: sign(claimTakeMessage(NET, w.addr, root, amount, nonce), w), scheme: 'kraywallet',
  } as unknown as KrayEvent
}
const closeSeasonEv = (L: KrayLedger, w: W, root: string): KrayEvent => {
  const nonce = L.nonceOf(w.addr)
  return {
    seq: L.appliedSeq + 1, kind: 'claim-close', hash: 'x' + L.appliedSeq, at: 1, from: w.addr, claimRoot: root, fee: '1',
    nonce, publicKey: w.pk, signature: sign(claimCloseMessage(NET, w.addr, root, nonce), w), scheme: 'kraywallet',
  } as unknown as KrayEvent
}
const sealTo = (L: KrayLedger, h: number) => push(L, { seq: L.appliedSeq + 1, kind: 'seal', hash: 'seal' + h, at: 0, l1Txid: h.toString(16).padStart(64, '0'), l1Height: h, l1Root: L.cascadeRoot(), l1BlockNumber: 0 } as unknown as KrayEvent)

function main() {
  console.log('\n╔═ THE STANDING POOL — held · committed · free, all three true ══╗\n')
  const radiola = wallet('radiola'), l1 = wallet('listener-1'), l2 = wallet('listener-2'), l3 = wallet('listener-3'), eve = wallet('eve')

  const E = new KrayLedger(undefined, NET)
  ok(E.pools.empty() && E.cascadeParts().poolCommitment === undefined, '0 · an empty pool book folds nowhere — the field is absent (A3)')

  const L = new KrayLedger(undefined, NET)
  let n = 0
  const mint = (to: string, amt: string) => push(L, { seq: L.appliedSeq + 1, kind: 'donate', hash: 'd' + (++n), at: n, to, amount: amt, outpoint: createHash('sha256').update('o' + n).digest('hex') + ':0' } as unknown as KrayEvent)
  for (const w of [radiola, l1, l2, l3, eve]) mint(w.addr, '9000')
  // radiola's own 2,000,000,000 — the etched rune, already bridged in
  L.runes.deposit(runeId, 'aa'.repeat(32) + ':0', 2_000_000_010n, radiola.addr, { pool: true })   // ten kept in hand, for §6
  const SUPPLY = 2_000_000_000n

  // ── 1 · THE WHOLE SUPPLY GOES IN, ONCE ──
  const rootBefore = L.cascadeRoot()
  push(L, fundEv(L, radiola, 'rune', RUNE, SUPPLY, 900_000))
  const pool = () => L.pools.get('rune', RUNE, radiola.addr)!
  ok(L.runes.balanceOf(runeId, radiola.addr) === 10n && L.runes.balanceOf(runeId, CLAIM_POT) === SUPPLY, '1 · the whole supply left radiola into the keyless pot')
  ok(pool().held === SUPPLY && pool().committed === 0n && L.pools.free('rune', RUNE, radiola.addr) === SUPPLY, '1 · held is the supply, committed is nothing, free is everything')
  ok(L.cascadeRoot() !== rootBefore && !!L.cascadeParts().poolCommitment, '1 · and the pool folds into the cascade root')

  // ── 2 · ONE EPOCH, ATTESTED ──
  const epoch1: ClaimShare[] = [{ to: l1.addr, amount: 1200n }, { to: l2.addr, amount: 800n }]
  const r1 = claimRoot(epoch1)
  push(L, seasonEv(L, radiola, 'rune', RUNE, 2000n, r1, 800_000))
  ok(pool().held === SUPPLY && pool().committed === 2000n, '2 · attesting moved NOTHING — it only stopped 2,000 being free')
  ok(L.claims.get(r1)?.total === 2000n && L.claims.get(r1)?.fromPool === true, '2 · and the season knows it drinks from the pool')
  halts(() => L.applyLive(seasonEv(L, radiola, 'rune', RUNE, SUPPLY, claimRoot([{ to: l3.addr, amount: 1n }]), 0)), /free and the season asks/, '2 · a season may never ask for more than the pool holds free')

  // ── 3 · A LISTENER CLAIMS ──
  const l1Before = L.runes.balanceOf(runeId, l1.addr)
  push(L, takeEv(L, l1, r1, 1200n, claimProof(epoch1, 0)))
  ok(L.runes.balanceOf(runeId, l1.addr) === l1Before + 1200n, '3 · the listener received exactly its leaf')
  ok(pool().held === SUPPLY - 1200n && pool().committed === 800n, '3 · held and committed fell together — the three numbers stay true')
  halts(() => L.applyLive(takeEv(L, l1, r1, 1200n, claimProof(epoch1, 0))), /already taken/, '3 · and cannot come back')

  // ── 4 · AN EPOCH NOBODY FINISHED GOES HOME TO THE POOL ──
  sealTo(L, 799_999)
  halts(() => L.applyLive(closeSeasonEv(L, radiola, r1)), /closes at Bitcoin height/, '4 · a season cannot be closed before its height')
  sealTo(L, 800_000)
  const potBefore = L.runes.balanceOf(runeId, CLAIM_POT), radiolaBefore = L.runes.balanceOf(runeId, radiola.addr)
  push(L, closeSeasonEv(L, radiola, r1))
  ok(L.runes.balanceOf(runeId, CLAIM_POT) === potBefore && L.runes.balanceOf(runeId, radiola.addr) === radiolaBefore, '4 · the 800 nobody claimed did NOT leave the chain')
  ok(pool().committed === 0n && L.pools.free('rune', RUNE, radiola.addr) === SUPPLY - 1200n, '4 · it went back to the pool and is free again — the mint refills itself')
  halts(() => L.applyLive(takeEv(L, l2, r1, 800n, claimProof(epoch1, 1))), /no harvest is open/, '4 · and the hand that slept through its epoch finds nothing')

  // ── 5 · THE MINT KEEPS RUNNING ──
  const epoch2: ClaimShare[] = [{ to: l2.addr, amount: 500n }, { to: l3.addr, amount: 250n }]
  const r2 = claimRoot(epoch2)
  push(L, seasonEv(L, radiola, 'rune', RUNE, 750n, r2, 0))
  push(L, takeEv(L, l2, r2, 500n, claimProof(epoch2, 0)))
  push(L, takeEv(L, l3, r2, 250n, claimProof(epoch2, 1)))
  ok(pool().committed === 0n && pool().held === SUPPLY - 1200n - 750n, '5 · a second epoch drew on the same pool, and the pool is exact')
  ok(L.claims.get(r2)?.paid === 750n, '5 · both listeners of that epoch were paid in full')

  // ── 6 · THE HORIZON ──
  halts(() => L.applyLive(fundEv(L, radiola, 'rune', RUNE, 10n, 700_000)), /pushed forward, never pulled closer/, '6 · a later pour cannot shorten the promise')
  push(L, fundEv(L, radiola, 'rune', RUNE, 0n + 1n, 950_000))
  ok(pool().expires === 950_000, '6 · but it may push the horizon further out')

  // ── 7 · THE OWNER DRAWS BACK, AT THE HORIZON AND NEVER BEFORE ──
  halts(() => L.applyLive(drainEv(L, radiola, 'rune', RUNE, 100n)), /stands until Bitcoin height/, '7 · not before the horizon')
  const epoch3: ClaimShare[] = [{ to: l1.addr, amount: 400n }]
  const r3 = claimRoot(epoch3)
  push(L, seasonEv(L, radiola, 'rune', RUNE, 400n, r3, 0))
  sealTo(L, 950_000)
  halts(() => L.applyLive(drainEv(L, eve, 'rune', RUNE, 100n)), /no pool of that asset/, '7 · and never by a hand that owns no pool')
  const free = L.pools.free('rune', RUNE, radiola.addr)
  halts(() => L.applyLive(drainEv(L, radiola, 'rune', RUNE, free + 1n)), /a live season still needs the rest/, '7 · a live season\'s share is untouchable, even by the owner at their horizon')
  const back = L.runes.balanceOf(runeId, radiola.addr)
  push(L, drainEv(L, radiola, 'rune', RUNE, free))
  ok(L.runes.balanceOf(runeId, radiola.addr) === back + free, '7 · exactly the free part came home')
  ok(pool().held === 400n && pool().committed === 400n && L.pools.free('rune', RUNE, radiola.addr) === 0n, '7 · and the pool still holds precisely what its last season owes')
  push(L, takeEv(L, l1, r3, 400n, claimProof(epoch3, 0)))
  ok(!L.pools.get('rune', RUNE, radiola.addr) && L.runes.balanceOf(runeId, CLAIM_POT) === 0n, '7 · the last hand emptied it, and the pool is gone')

  // ── 8 · A POOL WITH NO HORIZON BELONGS TO ITS SEASONS, FOREVER ──
  {
    push(L, fundEv(L, radiola, 'kray', '', 500n, 0))
    halts(() => L.applyLive(drainEv(L, radiola, 'kray', '', 100n)), /named no horizon/, '8 · a pool opened with no horizon can never be drawn back')
    ok(L.balanceOf(CLAIM_POT) === 500n && L.claimsBacked(), '8 · and the pot holds it, exactly')
  }

  // ── 9 · BELOW THE PIN ──
  {
    const O = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, Number.MAX_SAFE_INTEGER)
    let s2 = 0
    O.applyLive({ seq: ++s2, kind: 'donate', hash: 'p1', at: s2, to: radiola.addr, amount: '100', outpoint: 'dd'.repeat(32) + ':0' } as unknown as KrayEvent)
    const nonce = O.nonceOf(radiola.addr), before = O.cascadeRoot()
    halts(() => O.applyLive({ seq: ++s2, kind: 'pool-fund', hash: 'p2', at: s2, from: radiola.addr, lane: 'kray', amount: '10', fee: '1', nonce, publicKey: radiola.pk, signature: sign(poolFundMessage(NET, radiola.addr, 'kray', '', 10n, 0, nonce), radiola), scheme: 'kraywallet' } as unknown as KrayEvent),
      /not the law on this network yet/, '9 · below the pin no pool can be funded')
    ok(O.cascadeRoot() === before && O.pools.empty(), '9 · and nothing moved (A3)')
  }

  // ── 10 · THE REPLAY TWIN ──
  {
    const R = new KrayLedger(undefined, NET)
    R.runes.deposit(runeId, 'aa'.repeat(32) + ':0', SUPPLY + 10n, radiola.addr, { pool: true })
    for (const e of journal) R.applyLive(e)
    ok(R.cascadeRoot() === L.cascadeRoot(), '10 · a stranger replays the journal and reaches the SAME cascade root')
    ok(R.pools.commitment() === L.pools.commitment() && R.claims.commitment() === L.claims.commitment(), '10 · and the identical pool and claim books')
    ok(R.claimsBacked() && R.conserves() && R.runes.solvent(), '10 · pot backed, Σ conserved, runes solvent on the rebuilt node')
  }

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — a supply committed once, and three numbers that never lie. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
