/**
 * THE BACKING LAW IN CONSENSUS — no recipient is ever born a hostage.
 *
 * The Creator's bakery, as reducer law: A deposits 1000 into a PERSONAL vault
 * (only A's key opens it). Under the backing gate, A may hand out NOTHING —
 * a recipient's credit would need A's living key to reach Bitcoin, and KRAYNET
 * does not issue IOUs. One rune-rehome later (A co-signed the L1 move of the
 * coins into the shared pot), everything A holds is pot-backed: A pays B and C,
 * B pays onward, and every one of them can exit WITHOUT A, forever.
 *
 * Also proven here: the gate is flag-gated for replay compatibility (a journal
 * born before the law replays untouched with the flag off), the rehome event
 * refuses every malformed/hostile shape, a pool deposit is free from birth,
 * and a cold replay of the gated journal re-derives the byte-exact root.
 *
 *   node src/test/rune-rehome.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, runeSendMessage } from '../protocol/scheme.ts'
import { parseRuneKey } from '../economics/rune-book.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const halts = (fn: () => void, re: RegExp, m: string) => { try { fn(); ok(false, m + ' — DID NOT throw') } catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong: ' + msg)) } }

const NET = 'regtest', BNET = toBtcNet(NET)
const mk = (t: string) => { const sk = createHash('sha256').update(`rune-rehome|${t}`).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk, addr: btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[BNET]).address! } }
const A = mk('alice'), B = mk('bob'), C = mk('carol')
const RUNE = '840000:3', rid = parseRuneKey(RUNE)
const L1TX = 'ab'.repeat(32)

/** A SIGNED rune-send event — the exact shape the door submits. */
function sendEv(seq: number, who: { sk: Buffer; pk: string; addr: string }, to: string, amount: bigint, nonce: number): KrayEvent {
  const signature = _signKrayWallet(runeSendMessage(NET, who.addr, to, RUNE, amount, nonce), who.sk)
  return { seq, kind: 'rune-send', hash: seq.toString(16).padStart(64, '0'), runeId: RUNE, from: who.addr, to, amount: amount.toString(), fee: '1', nonce, publicKey: who.pk, signature, scheme: 'kraywallet' } as KrayEvent
}

function main() {
  console.log('\n╔═ THE BACKING LAW — a send may only hand out pot-backed credits (no hostages, ever) ══╗\n')

  // ── 1 · the bakery under the gate: personal backing gates the send ─────────
  const L = new KrayLedger(undefined, NET, undefined, true)
  ok(L.backingGate === true, '1 · a network born under the law carries the gate in its reducer')
  const journal: KrayEvent[] = []
  const put = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
  put({ seq: 1, kind: 'donate', hash: 'a'.repeat(64), to: A.addr, amount: '100' } as KrayEvent)
  put({ seq: 2, kind: 'donate', hash: 'b'.repeat(64), to: B.addr, amount: '100' } as KrayEvent)
  put({ seq: 3, kind: 'rune-deposit', hash: 'c'.repeat(64), runeId: RUNE, outpoint: 'dd'.repeat(32) + ':0', to: A.addr, amount: '1000' } as KrayEvent)
  ok(L.runes.personalOf(rid, A.addr) === 1000n && L.runes.transferableOf(rid, A.addr) === 0n, '1a · A deposited 1000 into a personal vault — personal backing 1000, transferable 0')

  halts(() => L.applyLive(sendEv(4, A, B.addr, 150n, 0)),
    /PERSONAL vault/, '1b · ATTACK (the hostage): A pays B while the coins sit in A\'s personal box → REFUSED by the reducer')

  // ── 2 · the rehome event refuses every hostile shape ───────────────────────
  halts(() => L.applyLive({ seq: 4, kind: 'rune-rehome', hash: '1'.repeat(64), runeId: RUNE, from: A.addr } as KrayEvent),
    /needs runeId \+ from \+ l1Txid/, '2a · a rehome with no L1 transaction → REFUSED (the box move is a Bitcoin fact, not a wish)')
  halts(() => L.applyLive({ seq: 4, kind: 'rune-rehome', hash: '2'.repeat(64), runeId: RUNE, from: A.addr, l1Txid: 'zz' } as KrayEvent),
    /32-byte hex/, '2b · a malformed txid → REFUSED')
  halts(() => L.applyLive({ seq: 4, kind: 'rune-rehome', hash: '3'.repeat(64), runeId: RUNE, from: B.addr, l1Txid: L1TX } as KrayEvent),
    /no personal-vault backing/, '2c · B (never deposited) rehoming → REFUSED — you cannot move a box you do not have')

  // ── 3 · the genuine rehome opens the bakery ────────────────────────────────
  const rootBefore = L.cascadeRoot()
  put({ seq: 4, kind: 'rune-rehome', hash: '4'.repeat(64), runeId: RUNE, from: A.addr, l1Txid: L1TX, outpoint: L1TX + ':0' } as KrayEvent)
  ok(L.runes.personalOf(rid, A.addr) === 0n && L.runes.balanceOf(rid, A.addr) === 1000n, '3a · the rehome zeroed A\'s personal backing — credits untouched (same coins, different box)')
  ok(L.runes.reserveOf(rid) === 1000n && L.runesSolvent(), '3b · the reserve never moved and the book is solvent — a rehome is neither a deposit nor a settle')
  ok(L.cascadeRoot() !== rootBefore, '3c · the rehome is COMMITTED — two histories with different backing can never share a root')
  halts(() => L.applyLive({ seq: 5, kind: 'rune-rehome', hash: '5'.repeat(64), runeId: RUNE, from: A.addr, l1Txid: 'cd'.repeat(32) } as KrayEvent),
    /no personal-vault backing/, '3d · a second rehome with nothing left → REFUSED (one box move, one event)')

  // ── 4 · the bakery pays, and nobody is a hostage ───────────────────────────
  put(sendEv(5, A, B.addr, 150n, 0))
  put(sendEv(6, A, C.addr, 150n, 1))
  ok(L.runes.balanceOf(rid, B.addr) === 150n && L.runes.balanceOf(rid, C.addr) === 150n && L.runes.balanceOf(rid, A.addr) === 700n, '4a · A paid B 150 and C 150, keeps 700 — the Creator\'s bakery, exactly')
  put(sendEv(7, B, C.addr, 50n, 0))
  ok(L.runes.balanceOf(rid, C.addr) === 200n, '4b · B pays C onward — a recipient\'s credit is pot-backed, so it circulates freely')
  ok(L.runes.transferableOf(rid, A.addr) === 700n, '4c · everything A still holds is pot-backed — A may pay anyone, or exit, whenever')

  // ── 5 · a later personal deposit is gated AGAIN (fresh coins, fresh box) ───
  put({ seq: 8, kind: 'rune-deposit', hash: 'e'.repeat(64), runeId: RUNE, outpoint: 'dd'.repeat(32) + ':1', to: A.addr, amount: '300' } as KrayEvent)
  halts(() => L.applyLive(sendEv(9, A, B.addr, 800n, 2)),
    /PERSONAL vault/, '5 · after a NEW personal deposit, A may hand out only the pot-backed 700 — 800 is refused')

  // ── 6 · a POOL deposit is pot-backed from birth — free immediately ─────────
  put({ seq: 9, kind: 'rune-deposit', hash: 'f'.repeat(64), runeId: RUNE, outpoint: 'ee'.repeat(32) + ':0', to: B.addr, amount: '500', pool: true } as KrayEvent)
  put(sendEv(10, B, C.addr, 500n, 1))
  ok(L.runes.balanceOf(rid, C.addr) === 700n, '6 · a deposit straight into the pot needs no rehome — transferable from the first block')

  // ── 7 · COLD REPLAY of the gated journal re-derives the byte-exact root ────
  const R = new KrayLedger(undefined, NET, undefined, true)
  for (const e of journal) R.applyLive(e)
  ok(R.cascadeRoot() === L.cascadeRoot() && R.runesSolvent(), '7 · cold replay under the gate — every send re-gated, every rehome re-applied, root byte-exact')

  // ── 8 · the flag is the era: a pre-law journal replays untouched with it OFF ──
  const OLD = new KrayLedger(undefined, NET) // gate off — today's live networks
  OLD.applyLive({ seq: 1, kind: 'donate', hash: 'a'.repeat(64), to: A.addr, amount: '100' } as KrayEvent)
  OLD.applyLive({ seq: 2, kind: 'rune-deposit', hash: 'b'.repeat(64), runeId: RUNE, outpoint: 'aa'.repeat(32) + ':0', to: A.addr, amount: '1000' } as KrayEvent)
  OLD.applyLive(sendEv(3, A, B.addr, 150n, 0))
  ok(OLD.runes.balanceOf(rid, B.addr) === 150n, '8a · gate OFF: a pre-law journal (personal-backed sends) replays exactly as it always did')
  ok(!OLD.runes.commitment().includes('p|'), '8b · APPEND-ONLY: a never-rehomed book folds no backing lines — no anchored root is ever orphaned')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — transferable credit is pot-backed credit: nobody waits for the depositor, and nobody spends the depositor's box. ₿₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
