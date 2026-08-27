/**
 * THE VITRINE FLOW — L1 wallet is the vault; the bakery pot is the L2 shop.
 *
 * Bridge KRAYNET sends metal straight into the shared pot (`pool: true`).
 * Credit is transferable from birth. Anyone who holds that credit can send
 * or exit/withdraw to their own Bitcoin address without the depositor —
 * no hostage, no Open bakery, no personal pantry.
 *
 *   node src/test/pot-vitrine-flow.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, runeSendMessage, runeExitMessage } from '../protocol/scheme.ts'
import { parseRuneKey } from '../economics/rune-book.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const halts = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong: ' + msg)) }
}

const NET = 'regtest', BNET = toBtcNet(NET)
const mk = (t: string) => {
  const sk = createHash('sha256').update(`pot-vitrine|${t}`).digest()
  const { publicKeyHex: pk } = _generateKeyPair(sk)
  return { sk, pk, addr: btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[BNET]).address! }
}
const A = mk('alice'), B = mk('bob'), C = mk('carol')
const RUNE = '317883:48', rid = parseRuneKey(RUNE)

function sendEv(seq: number, who: typeof A, to: string, amount: bigint, nonce: number): KrayEvent {
  const signature = _signKrayWallet(runeSendMessage(NET, who.addr, to, RUNE, amount, nonce), who.sk)
  return { seq, kind: 'rune-send', hash: seq.toString(16).padStart(64, '0'), runeId: RUNE, from: who.addr, to, amount: amount.toString(), fee: '1', nonce, publicKey: who.pk, signature, scheme: 'kraywallet' } as KrayEvent
}
function exitEv(seq: number, who: typeof A, amount: bigint, l1: string, nonce: number): KrayEvent {
  const signature = _signKrayWallet(runeExitMessage(NET, who.addr, RUNE, amount, l1, nonce), who.sk)
  return { seq, kind: 'rune-exit', hash: seq.toString(16).padStart(64, '0'), runeId: RUNE, from: who.addr, amount: amount.toString(), l1Address: l1, fee: '1', nonce, publicKey: who.pk, signature, scheme: 'kraywallet' } as KrayEvent
}

function main() {
  console.log('\n╔═ THE VITRINE — wallet → pot → send → anyone withdraws to L1, no hostage ══╗\n')

  const L = new KrayLedger(undefined, NET, undefined, true)
  const put = (e: KrayEvent) => L.applyLive(e)

  put({ seq: 1, kind: 'donate', hash: 'a'.repeat(64), to: A.addr, amount: '20' } as KrayEvent)
  put({ seq: 2, kind: 'donate', hash: 'b'.repeat(64), to: B.addr, amount: '20' } as KrayEvent)
  put({ seq: 3, kind: 'donate', hash: 'f'.repeat(64), to: C.addr, amount: '20' } as KrayEvent)

  // ── 1 · Bridge KRAYNET = pot deposit. Personal pantry stays empty. ──
  put({ seq: 4, kind: 'rune-deposit', hash: 'c'.repeat(64), runeId: RUNE, outpoint: 'aa'.repeat(32) + ':0', to: A.addr, amount: '10000', pool: true } as KrayEvent)
  ok(L.runes.balanceOf(rid, A.addr) === 10000n, '1a · A is credited 10000 from the pot payment')
  ok(L.runes.personalOf(rid, A.addr) === 0n, '1b · personal pantry is empty — Bitcoin wallet was the vault')
  ok(L.runes.transferableOf(rid, A.addr) === 10000n, '1c · all 10000 are sendable from birth — no Open bakery')
  ok(L.runesSolvent(), '1d · book solvent: credits == reserve')

  // ── 2 · A sells on the L2. B is not a hostage. ──
  put(sendEv(5, A, B.addr, 3000n, 0))
  ok(L.runes.balanceOf(rid, A.addr) === 7000n && L.runes.balanceOf(rid, B.addr) === 3000n, '2a · A kept 7000, B received 3000')
  ok(L.runes.personalOf(rid, B.addr) === 0n && L.runes.transferableOf(rid, B.addr) === 3000n, '2b · B\'s 3000 is pot-backed — B can send or exit without A')
  put(sendEv(6, B, C.addr, 500n, 0))
  ok(L.runes.balanceOf(rid, C.addr) === 500n && L.runes.transferableOf(rid, C.addr) === 500n, '2c · B paid C onward — credit circulates, still pot-backed')

  // ── 3 · B withdraws to B's own L1. A is not in the act. ──
  put(exitEv(7, B, 2500n, B.addr, 1))
  const lockB = L.runes.lockedOf(rid, B.addr)
  ok(!!lockB && lockB.amount === 2500n && lockB.l1Address === B.addr, '3a · B locked 2500 toward B\'s own Bitcoin address')
  ok(L.runes.balanceOf(rid, B.addr) === 0n, '3b · those 2500 left the spendable book — cannot be sent AND withdrawn')
  ok(L.runes.personalOf(rid, B.addr) === 0n, '3c · B never had a personal box — withdraw spends the shared pot')
  ok(L.runesSolvent(), '3d · lock + credits == reserve — the metal is still accounted')

  // ── 4 · A also exits from the same pot. Same door, no pantry. ──
  put(exitEv(8, A, 1000n, A.addr, 1))
  const lockA = L.runes.lockedOf(rid, A.addr)
  ok(!!lockA && lockA.amount === 1000n, '4a · A locked 1000 toward A\'s own L1 — the true vault')
  ok(L.runes.transferableOf(rid, A.addr) === 6000n, '4b · A still holds 6000 sendable in the shop')

  // ── 5 · attacks that would trap someone ──
  halts(() => L.applyLive(exitEv(9, C, 9999n, C.addr, 0)),
    /insufficient runes/, '5a · C cannot withdraw more than C holds')
  const personal = new KrayLedger(undefined, NET, undefined, true)
  personal.applyLive({ seq: 1, kind: 'donate', hash: 'd'.repeat(64), to: A.addr, amount: '10' } as KrayEvent)
  personal.applyLive({ seq: 2, kind: 'rune-deposit', hash: 'e'.repeat(64), runeId: RUNE, outpoint: 'bb'.repeat(32) + ':0', to: A.addr, amount: '10000' } as KrayEvent)
  ok(personal.runes.transferableOf(rid, A.addr) === 0n, '5b · a PERSONAL-vault deposit is NOT sendable (the old trap)')
  halts(() => personal.applyLive(sendEv(3, A, B.addr, 1n, 0)),
    /PERSONAL vault/, '5c · ATTACK: handing a hostage credit → REFUSED — the vitrine path never does this')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — wallet → pot → anyone with credit withdraws to L1, nobody waits. ₿₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
