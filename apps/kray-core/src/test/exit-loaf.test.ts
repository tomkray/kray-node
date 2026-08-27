/**
 * THE EXIT LOAF — one pot payout, many signed exits, ONE DELIVERY ONE BURN (custody rung 5).
 *
 * Per-recipient settlement routing: a single pot transaction pays EVERY compatible open exit
 * of a rune, each recipient on its own output. The settle law then keys each burn on its own
 * DELIVERY OUTPOINT (l1Txid:vout), not the whole txid. This exam proves the law BY BREAKING:
 *
 *   · three exits settle against three outputs of ONE txid — all burn, the book stays solvent
 *   · a REPLAYED delivery outpoint is refused (one delivery, one burn)
 *   · a whole-tx settle of a txid that already burned per-output deliveries is refused
 *   · the HISTORIC law is byte-identical: a no-outpoint settle still consumes its whole txid,
 *     a second no-outpoint settle of it still refuses, and per-output on a consumed txid refuses
 *   · at the consensus layer: a malformed / mismatched delivery outpoint refuses the event,
 *     a replayed delivery refuses with the root byte-identical, and a cold reboot replay of the
 *     whole journal (loaf settles included) re-derives the same cascade root
 *
 *   node src/test/exit-loaf.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { RuneBook } from '../economics/rune-book.ts'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, runeExitMessage } from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const threw = (fn: () => unknown, why: RegExp, m: string) => {
  let t = false
  try { fn() } catch (e) { t = why.test(String((e as Error).message)) }
  ok(t, m)
}

const NET = 'regtest'
const BNET = toBtcNet(NET)
const RID = { block: 840000n, tx: 1n }
const RUNE = '840000:1'
const txidOf = (tag: string) => createHash('sha256').update(tag).digest('hex')

interface Wallet { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`exit-loaf|${tag}`).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const A = wallet('alice'), B = wallet('bob'), C = wallet('carol')

function bookLaw() {
  console.log('\n── the RuneBook law: one delivery, one burn ──')
  const book = new RuneBook()
  book.deposit(RID, `${txidOf('d1')}:0`, 100n, A.addr, { pool: true })
  book.deposit(RID, `${txidOf('d2')}:0`, 200n, B.addr, { pool: true })
  book.deposit(RID, `${txidOf('d3')}:0`, 300n, C.addr, { pool: true })
  book.requestExit(RID, A.addr, 100n, A.addr, 0)
  book.requestExit(RID, B.addr, 200n, B.addr, 0)
  book.requestExit(RID, C.addr, 300n, C.addr, 0)

  // ── THE LOAF: one txid, three deliveries — each lock burns against its OWN outpoint ──
  const loafTx = txidOf('the-loaf')
  book.settleExit(RID, A.addr, 100n, loafTx, `${loafTx}:0`)
  book.settleExit(RID, B.addr, 200n, loafTx, `${loafTx}:1`)
  book.settleExit(RID, C.addr, 300n, loafTx, `${loafTx}:2`)
  ok(book.reserveOf(RID) === 0n && book.solvent(), 'three exits settled against THREE outputs of ONE txid — all burned, book solvent')

  // ── REPLAY ATTACKS, both directions ──
  book.deposit(RID, `${txidOf('d4')}:0`, 50n, A.addr, { pool: true })
  book.requestExit(RID, A.addr, 50n, A.addr, 0)
  threw(() => book.settleExit(RID, A.addr, 50n, loafTx, `${loafTx}:1`), /already settled/, 'ATTACK: a replayed delivery outpoint is refused — one delivery, one burn')
  threw(() => book.settleExit(RID, A.addr, 50n, loafTx), /already burned per-output/, 'ATTACK: a whole-tx settle of a txid that already burned per-output deliveries is refused')

  // ── THE HISTORIC LAW, byte-identical ──
  const soloTx = txidOf('the-solo')
  book.settleExit(RID, A.addr, 50n, soloTx)
  ok(book.reserveOf(RID) === 0n && book.solvent(), 'a no-outpoint (historic/solo) settle still consumes its whole txid')
  book.deposit(RID, `${txidOf('d5')}:0`, 10n, B.addr, { pool: true })
  book.requestExit(RID, B.addr, 10n, B.addr, 0)
  threw(() => book.settleExit(RID, B.addr, 10n, soloTx), /already settled/, 'ATTACK: a second whole-tx settle of a consumed txid still refuses (historic law intact)')
  threw(() => book.settleExit(RID, B.addr, 10n, soloTx, `${soloTx}:0`), /whole-tx settle/, 'ATTACK: a per-output settle on a whole-tx-consumed txid refuses (replay in the other direction)')
}

function consensusLaw() {
  console.log('\n── the consensus law: the rune-settle event carries its delivery outpoint ──')
  const L = new KrayLedger()
  const journal: KrayEvent[] = []
  let seq = 0
  const H = () => createHash('sha256').update(`loaf-ledger|${seq}`).digest('hex')
  const apply = (e: Record<string, unknown>) => { const ev = e as KrayEvent; L.applyLive(ev); journal.push(ev) }
  const nonces = new Map<string, number>()
  const signedExit = (w: Wallet, amount: bigint, l1Address: string) => {
    const nonce = nonces.get(w.addr) ?? 0
    nonces.set(w.addr, nonce + 1)
    const msg = runeExitMessage(NET, w.addr, RUNE, amount, l1Address, nonce)
    return { seq, kind: 'rune-exit', hash: H(), runeId: RUNE, from: w.addr, amount: amount.toString(), l1Address, fee: '1', nonce, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet' }
  }

  for (const w of [A, B, C]) { seq++; apply({ seq, kind: 'donate', hash: H(), to: w.addr, amount: '100' }) }
  seq++; apply({ seq, kind: 'rune-deposit', hash: H(), runeId: RUNE, outpoint: `${txidOf('L1')}:0`, to: A.addr, amount: '100' })
  seq++; apply({ seq, kind: 'rune-deposit', hash: H(), runeId: RUNE, outpoint: `${txidOf('L2')}:0`, to: B.addr, amount: '200' })
  seq++; apply({ seq, kind: 'rune-deposit', hash: H(), runeId: RUNE, outpoint: `${txidOf('L3')}:0`, to: C.addr, amount: '300' })
  seq++; apply(signedExit(A, 100n, A.addr))
  seq++; apply(signedExit(B, 200n, B.addr))
  seq++; apply(signedExit(C, 300n, C.addr))

  const loafTx = txidOf('ledger-loaf')
  seq++; apply({ seq, kind: 'rune-settle', hash: H(), runeId: RUNE, from: A.addr, amount: '100', l1Txid: loafTx, outpoint: `${loafTx}:0` })
  seq++; apply({ seq, kind: 'rune-settle', hash: H(), runeId: RUNE, from: B.addr, amount: '200', l1Txid: loafTx, outpoint: `${loafTx}:1` })
  seq++; apply({ seq, kind: 'rune-settle', hash: H(), runeId: RUNE, from: C.addr, amount: '300', l1Txid: loafTx, outpoint: `${loafTx}:2` })
  ok(L.runesSolvent() && L.runes.reserveOf(RID) === 0n, 'three loaf settles of ONE txid apply at the reducer — solvent, reserve exactly burned')

  // a fresh exit so the refusal doors have a live lock to aim at
  seq++; apply({ seq, kind: 'rune-deposit', hash: H(), runeId: RUNE, outpoint: `${txidOf('L4')}:0`, to: A.addr, amount: '40' })
  seq++; apply(signedExit(A, 40n, A.addr))

  const rootBefore = L.cascadeRoot()
  seq++
  threw(() => L.applyLive({ seq, kind: 'rune-settle', hash: H(), runeId: RUNE, from: A.addr, amount: '40', l1Txid: loafTx, outpoint: `${loafTx}:1` } as KrayEvent),
    /already settled/, 'ATTACK: a replayed delivery outpoint refuses at the reducer')
  threw(() => L.applyLive({ seq, kind: 'rune-settle', hash: H(), runeId: RUNE, from: A.addr, amount: '40', l1Txid: txidOf('other-tx'), outpoint: `${loafTx}:3` } as KrayEvent),
    /different transaction/, 'ATTACK: a delivery outpoint naming a different tx than l1Txid refuses (no cross-tx aliasing)')
  threw(() => L.applyLive({ seq, kind: 'rune-settle', hash: H(), runeId: RUNE, from: A.addr, amount: '40', l1Txid: txidOf('other-tx'), outpoint: 'not-an-outpoint' } as KrayEvent),
    /txid:vout/, 'ATTACK: a malformed delivery outpoint refuses by shape')
  ok(L.cascadeRoot() === rootBefore, 'every refusal left the cascade root byte-identical (refuse-before-mutate)')

  // the historic settle shape still applies untouched, after loaf settles exist in the same book
  seq++; apply({ seq, kind: 'rune-settle', hash: H(), runeId: RUNE, from: A.addr, amount: '40', l1Txid: txidOf('plain-solo') })
  ok(L.runesSolvent(), 'a historic (no-outpoint) settle still applies after loaf settles exist — append-only law')

  // ── THE COLD REBOOT IS THE VERIFIER — a follower re-derives the same root from bytes alone ──
  const L2 = new KrayLedger()
  for (const e of journal) L2.applyLive(e)
  ok(L2.cascadeRoot() === L.cascadeRoot(), 'REBOOT: a cold replay of the journal (loaf settles included) re-derives the cascade root byte-exact')
}

console.log('\n╔═ THE EXIT LOAF — one pot payout pays many exits; one delivery, one burn ═╗')
bookLaw()
consensusLaw()
console.log(`\n   ${pass} passed · ${fail} failed`)
if (fail) process.exit(1)
console.log('   the loaf never over-burns — per-recipient settlement routing holds ✔\n')
