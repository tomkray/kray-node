/**
 * THE SPORADIC BURN + THE BURN LAW + THE THAW — the Creator's ratified law in the bytes. Prove by breaking:
 *   node src/test/x-burn.test.ts
 *
 *   B-01  the signed burn: balance −(amt+fee) · TREASURY +fee · burned +amt · Ӿ +amt to the burner; conserves()
 *   B-02  "burn 1000 → receive 1000" — proportional, per-burner, the fee never joins the burn
 *   B-03  HOSTILE burn: wrong-key sig / a transfer sig replayed as burn / pot sender / zero amount / wrong fee /
 *         overspend — all refused, state byte-identical
 *   B-04  THE LAW (regtest = from genesis): fungible ₭ aimed at the hole is REFUSED on EVERY user path —
 *         transfer, quantum-migrate is covered by design (whole balance), and the star freeze still WORKS (✦ law)
 *   B-05  PRE-LAW HISTORY (injected gate): below the law seq the old freeze applies byte-identically (A3) and
 *         holeDeposits accumulates per sender (two sends by one sender = one summed entry)
 *   B-06  THE THAW: one-shot transmutation — hole −Σ, burned +Σ, Ӿ to the ORIGINAL senders; the exact signet
 *         shape (multi-sender); a SECOND thaw throws; a PAYLOAD thaw throws; an EMPTY thaw throws (fail-closed)
 *   B-07  post-thaw conservation: every conserves() equality closes; non-transfer hole credits are untouched
 *   B-08  replay byte-exact: a fresh ledger re-derives the whole story (burn + law + thaw) and the same root
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, burnMessage, sendStarMessage, inscribeMessageV2 } from '../protocol/scheme.ts'
import { sha256hex, BLACK_HOLE, TREASURY, type KrayEvent } from '../protocol/kray-primitives.ts'
import { glowOf } from '../economics/glow-star.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
function wallet(tag: string) {
  const sk = createHash('sha256').update('x-burn|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B'), Eve = wallet('eve')

/** a ledger with an injectable burn-law seq (default undefined = the network law: regtest 1) + auto-seq apply */
function ledger(lawSeq?: number) {
  const L = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, lawSeq)
  const J: KrayEvent[] = []
  const ap = (e: Record<string, unknown>) => { const ev = { ...e, seq: J.length + 1 } as unknown as KrayEvent; L.applyLive(ev); J.push(ev); return ev }
  return { L, J, ap }
}
const donate = (ap: (e: Record<string, unknown>) => KrayEvent, to: string, amt: string, tag: string) => ap({ kind: 'donate', hash: 'd' + tag, to, amount: amt })
function burnEv(L: KrayLedger, w: typeof A, amt: number, opts: { sig?: string; fee?: string; tag?: string } = {}) {
  const n = L.nonceOf(w.addr)
  return { kind: 'burn', hash: sha256hex('b|' + w.addr + '|' + amt + '|' + n + '|' + (opts.tag || '')), from: w.addr, amount: String(amt), fee: opts.fee || '1', nonce: n, publicKey: w.pk, signature: opts.sig || _signKrayWallet(burnMessage(NET, w.addr, BigInt(amt), n), w.sk), scheme: 'kraywallet' } as Record<string, unknown>
}
function sendEv(L: KrayLedger, w: typeof A, to: string, amt: number, tag = '') {
  const n = L.nonceOf(w.addr)
  return { kind: 'transfer', hash: sha256hex('t|' + w.addr + '|' + to + '|' + amt + '|' + n + '|' + tag), from: w.addr, to, amount: String(amt), fee: '1', nonce: n, publicKey: w.pk, signature: _signKrayWallet(transferMessage(NET, w.addr, to, BigInt(amt), n), w.sk), scheme: 'kraywallet' } as Record<string, unknown>
}

function main() {
  console.log('\n╔═ THE SPORADIC BURN — ₭ never freezes, ₭ only burns; the thaw redeems the frozen ═╗\n')

  console.log('B-01 — the signed burn: exact mutation, conserved')
  const { L, J, ap } = ledger()                       // regtest: the law from genesis
  donate(ap, A.addr, '2000', 'A'); donate(ap, B.addr, '50', 'B')
  const t0 = L.balanceOf(TREASURY)
  ap(burnEv(L, A, 100))
  ok(L.balanceOf(A.addr) === 2000n - 101n, 'A paid amt+fee (100 burned + 1 gas)')
  ok(L.balanceOf(TREASURY) === t0 + 1n, 'the fee funds the validators — never joins the burn')
  ok(L.totalBurned === 100n && L.xMintedOf(A.addr) === 100n && L.xBalanceOf(A.addr) === 100n, '100 ₭ died → 100 Ӿ born to the burner, 1:1')
  ok(L.conserves(), 'every tripwire equality holds after the burn')

  console.log('B-02 — proportional, per-burner')
  ap(burnEv(L, A, 900, { tag: '2' }))
  ok(L.xMintedOf(A.addr) === 1000n, 'A burned 1000 total → 1000 Ӿ ("burn 1000 → receive 1000")')
  ap(burnEv(L, B, 3, { tag: '3' }))
  ok(L.xMintedOf(B.addr) === 3n && L.xMintedOf(A.addr) === 1000n, "B's 3 are B's; A untouched — per-burner, no pooling")
  ok(L.totalBurned === 1003n && L.xEmitted === 1003n && L.conserves(), 'Σ Ӿ == burned == 1003, conserved')

  console.log('B-03 — hostile burns all refused, state intact')
  const snapRoot = L.cascadeRoot()
  const sSeq = () => J.length + 1
  rejects(() => L.applyLive({ ...burnEv(L, A, 5, { tag: 'wk', sig: _signKrayWallet(burnMessage(NET, A.addr, 5n, L.nonceOf(A.addr)), B.sk) }), seq: sSeq() } as KrayEvent), /signature/i, 'a wrong-key burn is refused')
  rejects(() => L.applyLive({ ...burnEv(L, A, 5, { tag: 'xd', sig: _signKrayWallet(transferMessage(NET, A.addr, B.addr, 5n, L.nonceOf(A.addr)), A.sk) }), seq: sSeq() } as KrayEvent), /signature/i, 'a transfer signature can never burn — own domain')
  rejects(() => L.applyLive({ ...burnEv(L, A, 0, { tag: 'z' }), seq: sSeq() } as KrayEvent), /positive/i, 'a zero burn is refused')
  rejects(() => L.applyLive({ ...burnEv(L, A, 5, { tag: 'wf', fee: '2' }), seq: sSeq() } as KrayEvent), /1-₭ fee/i, 'a wrong fee is refused')
  rejects(() => L.applyLive({ ...burnEv(L, B, 99999, { tag: 'ov' }), seq: sSeq() } as KrayEvent), /insufficient/i, 'an overspend burn is refused')
  rejects(() => L.applyLive({ kind: 'burn', hash: 'pot', from: TREASURY, amount: '1', fee: '1', nonce: 0, seq: sSeq() } as KrayEvent), /pot cannot burn/i, 'a protocol pot can never burn')
  ok(L.cascadeRoot() === snapRoot && L.conserves(), 'every refusal left the ledger byte-identical')

  console.log('B-04 — THE LAW from genesis: fungible ₭ can NEVER reach the hole; the star freeze still works')
  rejects(() => L.applyLive({ ...sendEv(L, A, BLACK_HOLE, 10, 'law'), seq: sSeq() } as KrayEvent), /cannot be frozen — only burned/i, 'transfer → hole REFUSED: "₭ cannot be frozen — only burned"')
  // the star freeze is the ratified law — inscribe a star, then freeze it: ✦ must still shine
  const ch = sha256hex('law-star'); const n4 = L.nonceOf(A.addr)
  ap({ kind: 'inscribe', hash: 'ins', from: A.addr, contentHash: ch, contentType: 'text/plain', size: 8, nonce: n4, publicKey: A.pk, signature: _signKrayWallet(inscribeMessageV2(NET, A.addr, ch, 'text/plain', 8, undefined, n4), A.sk), scheme: 'kraywallet' })
  const starNo = 0n
  const n5 = L.nonceOf(A.addr)
  ap({ kind: 'transfer-star', hash: 'frz', from: A.addr, to: BLACK_HOLE, star: starNo.toString(), fee: '1', nonce: n5, publicKey: A.pk, signature: _signKrayWallet(sendStarMessage(NET, A.addr, BLACK_HOLE, starNo, n5), A.sk), scheme: 'kraywallet' })
  ok(L.stars.ownerOf(starNo) === BLACK_HOLE, 'the star freeze STILL WORKS — ✦ never blinks (the law is fungible-only)')
  ok(glowOf(J, A.addr) === 1, 'the freezer earned 1 ✦ glow')
  rejects(() => L.applyLive({ kind: 'burn-thaw', hash: 'nt', seq: sSeq() } as KrayEvent), /nothing to thaw/i, 'a clean network refuses an empty thaw (fail-closed)')
  ok(L.conserves(), 'conservation after the law chapter')

  console.log('B-05 — pre-law history (injected gate): the freeze applies; holeDeposits accumulates per sender')
  const H = ledger(7)                                  // the law only from seq 7 — seqs 1..6 are "history"
  donate(H.ap, A.addr, '300', 'hA'); donate(H.ap, B.addr, '60', 'hB')
  H.ap(sendEv(H.L, A, BLACK_HOLE, 40, 'h1'))           // seq 3: A freezes 40 (pre-law)
  H.ap(sendEv(H.L, A, BLACK_HOLE, 60, 'h2'))           // seq 4: A freezes 60 more — MUST accumulate to 100
  H.ap(sendEv(H.L, B, BLACK_HOLE, 5, 'h3'))            // seq 5: B freezes 5
  ok(H.L.balanceOf(BLACK_HOLE) === 105n, 'pre-law: the hole holds 105 (A 100 + B 5) — history applies as it always did')
  ok(H.L.totalBurned === 0n && H.L.xEmitted === 0n, 'a freeze is not a burn: burned 0, Ӿ 0 (the old world, byte-identical)')
  H.ap({ kind: 'transfer', hash: 'n2n', from: A.addr, to: B.addr, amount: '1', fee: '1', nonce: H.L.nonceOf(A.addr), publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, B.addr, 1n, H.L.nonceOf(A.addr)), A.sk), scheme: 'kraywallet' })  // seq 6: normal life
  rejects(() => H.L.applyLive({ ...sendEv(H.L, A, BLACK_HOLE, 1, 'post'), seq: 7 } as KrayEvent), /cannot be frozen/i, 'at seq 7 the law bites: no new freeze ever again')

  console.log('B-06 — THE THAW: one-shot, multi-sender, exact')
  const preThawRoot = H.L.cascadeRoot()
  H.ap({ kind: 'burn-thaw', hash: 'thaw' })            // seq 7: the transmutation
  ok(H.L.balanceOf(BLACK_HOLE) === 0n, 'the hole fungible balance is 0 — every frozen ₭ transmuted')
  ok(H.L.totalBurned === 105n, 'burned 0 → 105: the frozen ₭ truly died')
  ok(H.L.xMintedOf(A.addr) === 100n && H.L.xMintedOf(B.addr) === 5n, 'Ӿ born to the ORIGINAL senders — A 100 (40+60 accumulated), B 5. The fire reaches them late, but exact')
  ok(H.L.cascadeRoot() !== preThawRoot, 'the thaw is a real event — the root moved (a new act, never a rewrite)')
  rejects(() => H.L.applyLive({ kind: 'burn-thaw', hash: 't2', seq: 8 } as KrayEvent), /already ran/i, 'a SECOND thaw throws — once, ever')
  rejects(() => H.L.applyLive({ kind: 'burn-thaw', hash: 't3', from: Eve.addr, seq: 8 } as KrayEvent), /carries no from/i, 'a PAYLOAD thaw throws — nothing can steer it')

  console.log('B-07 — post-thaw conservation, exact equalities')
  ok(H.L.conserves(), 'Σ balances == emitted − burned AND Σ Ӿ == burned — all equalities close post-thaw')
  ok(H.L.xEmitted === H.L.totalBurned && H.L.totalBurned === 105n, 'Ӿ total == burned == 105')

  console.log('B-08 — replay byte-exact: the whole story re-derives')
  const R = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, 7)
  for (const e of H.J) R.applyLive(e)
  ok(R.cascadeRoot() === H.L.cascadeRoot(), 'a fresh ledger replays burn+law+thaw to the SAME root')
  ok(R.xMintedOf(A.addr) === 100n && R.balanceOf(BLACK_HOLE) === 0n && R.conserves(), 'replay re-derives the thaw exactly (holeDeposits is a pure journal fold)')
  const R2 = new KrayLedger(undefined, NET)             // and the first ledger's journal too (law from genesis)
  for (const e of J) R2.applyLive(e)
  ok(R2.cascadeRoot() === L.cascadeRoot() && R2.conserves(), 'the genesis-law journal replays byte-exact too')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — THE BURN LAW HOLDS: ₭ never freezes (every path refused), the signed burn destroys and births 1:1, the thaw redeems the pre-law frozen to their original senders once-ever, and the whole story replays byte-exact. 🔥Ӿ`)
}
main()
