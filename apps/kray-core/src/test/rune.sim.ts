/**
 * THE RUNE L2 (v2) UNDER STORM — the cascade check for the ported rune capability.
 *   node src/test/rune.sim.ts
 *
 * The v2 ledger reuses the model-agnostic RuneBook (never duplicated): every credit is
 * backed by a proven L1 deposit, every exit by a proven L1 payout, and a rune transfer is
 * signed and pays the eternal 1-₭ fee. This drives thousands of random deposits, signed
 * sends, exit locks and settlements across real-key wallets and re-asserts after EVERY act:
 *   · SOLVENCY   reserve == spendable credits + locked exits, per rune (the book's tripwire)
 *   · ₭ CONSERVATION unaffected — a rune fee moves within Σ balances to the Treasury
 *   · an INDEPENDENT rune shadow — every rune balance/lock/reserve recomputed by hand
 * Then a byte-exact reboot (which re-verifies every rune signature). It fires every door:
 * a replayed deposit outpoint (mints nothing), an over-send, an unsigned/forged/tampered
 * rune-send, a double exit, a settlement whose amount ≠ its lock, and the cancel doors
 * (cancel of nothing, unsigned/foreign-key/inflated-fee cancel, double cancel) — each refused.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { TREASURY } from '../protocol/kray-primitives.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes,
  runeSendMessage, runeExitMessage, runeCancelMessage,
} from '../protocol/scheme.ts'
import { parseRuneKey } from '../economics/rune-book.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
function lcg(seed: number) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000 }

const NET = 'regtest'
const BNET = toBtcNet(NET)
interface Wallet { addr: string; sk: Uint8Array; pk: string }
function makeWallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`kraynet-rune-sim|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const WALLETS = [makeWallet('A'), makeWallet('B'), makeWallet('C')]
const WBY = new Map(WALLETS.map((w) => [w.addr, w]))
const ADDRS = WALLETS.map((w) => w.addr)
const RUNES = ['840000:1', '840010:7'] // two runes riding the L2

function signSend(e: Record<string, unknown>): KrayEvent {
  const w = WBY.get(e.from as string)!
  const msg = runeSendMessage(NET, e.from as string, e.to as string, e.runeId as string, BigInt(e.amount as string), e.nonce as number)
  return { ...e, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet' } as KrayEvent
}
function signExit(e: Record<string, unknown>): KrayEvent {
  const w = WBY.get(e.from as string)!
  const msg = runeExitMessage(NET, e.from as string, e.runeId as string, BigInt(e.amount as string), e.l1Address as string, e.nonce as number)
  return { ...e, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet' } as KrayEvent
}
function signCancel(e: Record<string, unknown>): KrayEvent {
  const w = WBY.get(e.from as string)!
  const msg = runeCancelMessage(NET, e.from as string, e.runeId as string, e.nonce as number)
  return { ...e, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet' } as KrayEvent
}

interface Shadow {
  bal: Map<string, bigint>          // `${rune}|${addr}` → spendable
  lock: Map<string, bigint>          // `${rune}|${addr}` → locked amount
  reserve: Map<string, bigint>       // rune → reserve
  nonce: Map<string, number>
}
const k = (rune: string, addr: string) => `${rune}|${addr}`
const gBal = (s: Shadow, rune: string, a: string) => s.bal.get(k(rune, a)) ?? 0n
const gLock = (s: Shadow, rune: string, a: string) => s.lock.get(k(rune, a)) ?? 0n
const gRes = (s: Shadow, rune: string) => s.reserve.get(rune) ?? 0n
const gN = (s: Shadow, a: string) => s.nonce.get(a) ?? 0

function assertRunes(L: KrayLedger, s: Shadow, tag: string): void {
  ok(L.runesSolvent(), `${tag}: SOLVENCY — reserve == credits + locks (every rune)`)
  ok(L.conserves() && L.backed(), `${tag}: ₭ conservation + peg unaffected by rune ops`)
  for (const rune of RUNES) {
    const rid = parseRuneKey(rune)
    ok(L.runes.reserveOf(rid) === gRes(s, rune), `${tag}: reserve ${rune}`)
    let spend = 0n, locked = 0n
    for (const a of ADDRS) {
      ok(L.runes.balanceOf(rid, a) === gBal(s, rune, a), `${tag}: rune ${rune} balance ${a}`)
      const lk = L.runes.lockedOf(rid, a)
      ok((lk?.amount ?? 0n) === gLock(s, rune, a), `${tag}: rune ${rune} lock ${a}`)
      spend += gBal(s, rune, a); locked += gLock(s, rune, a)
    }
    ok(spend + locked === gRes(s, rune), `${tag}: shadow solvency ${rune}`)
  }
}

function attempt(L: KrayLedger, journal: KrayEvent[], e: KrayEvent, valid: boolean, mutate: () => void, tag: string): void {
  const before = L.cascadeRoot()
  let threw = false
  try { L.applyLive(e) } catch { threw = true }
  if (valid) { ok(!threw, `${tag}: valid ${e.kind} applied`); journal.push(e); mutate() }
  else { ok(threw, `${tag}: invalid ${e.kind} refused`); ok(L.cascadeRoot() === before, `${tag}: refused → byte-identical`) }
}

function main(): void {
  const seeds = [11, 29, 404, 8191, 123457]
  let totalActs = 0, deposits = 0, sends = 0, exits = 0, settles = 0, cancels = 0, refused = 0
  let uid = 0
  const uniq = () => (++uid).toString(16).padStart(2, '0')

  for (const seed of seeds) {
    const rnd = lcg(seed)
    const L = new KrayLedger()
    const s: Shadow = { bal: new Map(), lock: new Map(), reserve: new Map(), nonce: new Map() }
    const journal: KrayEvent[] = []
    let seq = 0
    const H = () => createHash('sha256').update(`${seed}|${seq}`, 'utf8').digest('hex')

    // fund every wallet with ₭ (donations) so they can pay rune-send gas
    for (const a of ADDRS) { seq++; const e = { seq, kind: 'donate', hash: H(), to: a, amount: '10000' } as KrayEvent; L.applyLive(e); journal.push(e) }

    for (let step = 0; step < 240; step++) {
      seq++
      const rune = RUNES[Math.floor(rnd() * RUNES.length)]
      const rid = parseRuneKey(rune)
      const from = ADDRS[Math.floor(rnd() * ADDRS.length)]
      const to = ADDRS[Math.floor(rnd() * ADDRS.length)]
      const roll = rnd()

      if (roll < 0.35) {
        // DEPOSIT — proven L1 credit (unsigned; SPV at ingress). Sometimes replay an outpoint.
        const replay = rnd() < 0.15 && uid > 0
        const outpoint = replay ? `${'a'.repeat(64)}:0` : `${H()}:${uniq()}`
        const amt = 1n + BigInt(Math.floor(rnd() * 5000))
        const first = !L.runes.wasCredited(outpoint)
        const e = { seq, kind: 'rune-deposit', hash: H(), runeId: rune, outpoint, to, amount: amt.toString() } as KrayEvent
        // pre-seed a known replayable outpoint once
        if (replay && first) { /* first use of the shared outpoint credits */ }
        attempt(L, journal, e, first, () => { s.bal.set(k(rune, to), gBal(s, rune, to) + amt); s.reserve.set(rune, gRes(s, rune) + amt) }, `${seed}.${step}`)
        if (first) deposits++; else refused++
      } else if (roll < 0.68) {
        // SEND — signed, pays 1 ₭ gas. Sometimes over-send (→ refused).
        const have = gBal(s, rune, from)
        const over = rnd() < 0.15
        const amt = over || have === 0n ? have + 1n : 1n + BigInt(Math.floor(rnd() * Number(have)))
        const valid = from !== to && have > 0n && amt <= have
        const e = signSend({ seq, kind: 'rune-send', hash: H(), runeId: rune, from, to, amount: amt.toString(), fee: '1', nonce: gN(s, from) })
        attempt(L, journal, e, valid, () => {
          s.bal.set(k(rune, from), gBal(s, rune, from) - amt); s.bal.set(k(rune, to), gBal(s, rune, to) + amt)
          s.nonce.set(from, gN(s, from) + 1)
        }, `${seed}.${step}`)
        if (valid) sends++; else refused++
      } else if (roll < 0.85) {
        // EXIT — signed lock. Refused if an exit is already open or balance is short.
        const have = gBal(s, rune, from)
        const hasOpen = gLock(s, rune, from) > 0n
        const amt = have === 0n ? 1n : 1n + BigInt(Math.floor(rnd() * Number(have)))
        const valid = !hasOpen && have > 0n && amt <= have
        const e = signExit({ seq, kind: 'rune-exit', hash: H(), runeId: rune, from, amount: amt.toString(), l1Address: from, fee: '1', nonce: gN(s, from) })
        attempt(L, journal, e, valid, () => {
          s.bal.set(k(rune, from), gBal(s, rune, from) - amt); s.lock.set(k(rune, from), amt)
          s.nonce.set(from, gN(s, from) + 1)
        }, `${seed}.${step}`)
        if (valid) exits++; else refused++
      } else if (roll < 0.93) {
        // SETTLE — proven L1 payout burns the lock. Amount must equal the lock exactly.
        const locked = gLock(s, rune, from)
        const l1Txid = createHash('sha256').update(`settle|${seed}|${seq}|${uniq()}`).digest('hex')
        const valid = locked > 0n
        const e = { seq, kind: 'rune-settle', hash: H(), runeId: rune, from, amount: locked.toString(), l1Txid } as KrayEvent
        attempt(L, journal, e, valid, () => {
          s.lock.delete(k(rune, from)); s.reserve.set(rune, gRes(s, rune) - locked)
        }, `${seed}.${step}`)
        if (valid) settles++; else refused++
      } else {
        // CANCEL — the signed withdrawal of an open exit: credits come back, reserve untouched.
        const locked = gLock(s, rune, from)
        const valid = locked > 0n
        const e = signCancel({ seq, kind: 'rune-cancel', hash: H(), runeId: rune, from, fee: '1', nonce: gN(s, from) })
        attempt(L, journal, e, valid, () => {
          s.lock.delete(k(rune, from)); s.bal.set(k(rune, from), gBal(s, rune, from) + locked)
          s.nonce.set(from, gN(s, from) + 1)
        }, `${seed}.${step}`)
        if (valid) cancels++; else refused++
      }
      totalActs++
      assertRunes(L, s, `${seed}.${step}`)
    }

    // ── THE REBOOT IS THE VERIFIER — replay re-verifies every rune signature ──
    const L2 = new KrayLedger()
    for (const e of journal) L2.applyLive(e)
    ok(L2.cascadeRoot() === L.cascadeRoot(), `${seed}: REBOOT cascade root (with the rune L2) byte-exact`)
    ok(L2.runesSolvent() && L2.conserves(), `${seed}: reboot solvent + conserves`)
  }

  // ── THE ADVERSARIAL DOORS ──
  const [A, B] = WALLETS
  const L = new KrayLedger()
  L.applyLive({ seq: 1, kind: 'donate', hash: 'a'.repeat(64), to: A.addr, amount: '100' } as KrayEvent)
  L.applyLive({ seq: 2, kind: 'donate', hash: '9'.repeat(64), to: B.addr, amount: '100' } as KrayEvent) // B needs ₭ to pay its exit fee
  const RUNE = '840000:1', rid = parseRuneKey(RUNE)
  L.applyLive({ seq: 3, kind: 'rune-deposit', hash: 'b'.repeat(64), runeId: RUNE, outpoint: 'op1:0', to: A.addr, amount: '1000' } as KrayEvent)
  ok(L.runes.balanceOf(rid, A.addr) === 1000n && L.runesSolvent(), 'DEPOSIT credited 1000 runes, solvent')
  // replayed outpoint mints nothing
  let root = L.cascadeRoot()
  try { L.applyLive({ seq: 4, kind: 'rune-deposit', hash: 'c'.repeat(64), runeId: RUNE, outpoint: 'op1:0', to: A.addr, amount: '1000' } as KrayEvent); ok(false, 'replay should throw') } catch { ok(true, 'ATTACK replayed deposit outpoint → refused (mints once, ever)') }
  ok(L.cascadeRoot() === root, 'replayed deposit → byte-identical')
  // unsigned rune-send refused
  try { L.applyLive({ seq: 4, kind: 'rune-send', hash: 'd'.repeat(64), runeId: RUNE, from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 0 } as KrayEvent); ok(false, 'unsigned should throw') } catch { ok(true, 'SUPREME LAW: unsigned rune-send refused') }
  // tampered rune-send (sign 10, submit 900) refused
  const sig10 = _signKrayWallet(runeSendMessage(NET, A.addr, B.addr, RUNE, 10n, 0), A.sk)
  try { L.applyLive({ seq: 4, kind: 'rune-send', hash: 'e'.repeat(64), runeId: RUNE, from: A.addr, to: B.addr, amount: '900', fee: '1', nonce: 0, publicKey: A.pk, signature: sig10, scheme: 'kraywallet' } as KrayEvent); ok(false, 'tampered should throw') } catch { ok(true, 'SUPREME LAW: tampered rune-send (10→900) refused') }
  // over-send refused
  const sigOver = _signKrayWallet(runeSendMessage(NET, A.addr, B.addr, RUNE, 99999n, 0), A.sk)
  try { L.applyLive({ seq: 4, kind: 'rune-send', hash: 'f'.repeat(64), runeId: RUNE, from: A.addr, to: B.addr, amount: '99999', fee: '1', nonce: 0, publicKey: A.pk, signature: sigOver, scheme: 'kraywallet' } as KrayEvent); ok(false, 'over-send should throw') } catch { ok(true, 'ATTACK over-send more runes than held → refused') }
  // a forged (inflated) fee is refused — the fee is a fixed 1 ₭, never more (front-run guard)
  const sig400 = _signKrayWallet(runeSendMessage(NET, A.addr, B.addr, RUNE, 400n, 0), A.sk)
  try { L.applyLive({ seq: 4, kind: 'rune-send', hash: '8'.repeat(64), runeId: RUNE, from: A.addr, to: B.addr, amount: '400', fee: '50', nonce: 0, publicKey: A.pk, signature: sig400, scheme: 'kraywallet' } as KrayEvent); ok(false, 'inflated fee should throw') } catch { ok(true, 'ATTACK inflate the (unsigned) fee to 50 → refused (the fee is exactly 1, never more)') }
  // a valid signed send works
  L.applyLive(signSend({ seq: 4, kind: 'rune-send', hash: '1'.repeat(64), runeId: RUNE, from: A.addr, to: B.addr, amount: '400', fee: '1', nonce: 0 }))
  ok(L.runes.balanceOf(rid, A.addr) === 600n && L.runes.balanceOf(rid, B.addr) === 400n, 'valid rune-send moved 400; A=600 B=400')
  ok(L.balanceOf(TREASURY) === 1n, 'the rune-send paid the eternal 1-₭ fee to the Treasury')
  ok(L.runesSolvent() && L.conserves(), 'after the send: solvent + ₭ conserved')
  // ATTACK — exit to a WRONG-NETWORK L1 destination (a mainnet bc1p… on this regtest chain). It is a
  // signed, own-balance exit, so it is not theft — but the payout could never match it, and with no
  // cancel the runes would STRAND forever. The reducer must refuse it before it locks anything.
  const mainAddr = btc.p2tr(_hexToBytes(B.pk), undefined, btc.NETWORK).address!   // valid MAINNET, not regtest
  try { L.applyLive(signExit({ seq: 5, kind: 'rune-exit', hash: '9'.repeat(64), runeId: RUNE, from: B.addr, amount: '400', l1Address: mainAddr, fee: '1', nonce: 0 })); ok(false, 'wrong-network exit destination should throw') }
  catch { ok(true, 'ATTACK exit to a wrong-network L1 address → refused (it could never settle; runes would strand)') }
  ok(L.runes.balanceOf(rid, B.addr) === 400n && L.runes.lockedOf(rid, B.addr) === null, '…and it locked NOTHING — the refused exit left the book byte-identical')
  // FEATURE — exit to ANOTHER address (A's, a different but valid on-network address). A depositor may pay
  // anyone on L1; only their OWN signed balance is ever spent, so this is utility, not a leak. It settles
  // exactly like a self-exit. (l1Address = A.addr, the sender is B.)
  L.applyLive(signExit({ seq: 5, kind: 'rune-exit', hash: '2'.repeat(64), runeId: RUNE, from: B.addr, amount: '400', l1Address: A.addr, fee: '1', nonce: 0 }))
  ok(L.runes.balanceOf(rid, B.addr) === 0n && L.runes.lockedOf(rid, B.addr)?.amount === 400n && L.runes.lockedOf(rid, B.addr)?.l1Address === A.addr,
    'EXIT to another valid address locked 400 for B, destination = A (paying someone on L1 is a feature, not a leak)')
  ok(L.balanceOf(TREASURY) === 2n, 'the EXIT paid the eternal 1-₭ fee to the validators too — Treasury now 2')
  try { L.applyLive({ seq: 6, kind: 'rune-settle', hash: '3'.repeat(64), runeId: RUNE, from: B.addr, amount: '300', l1Txid: 'a'.repeat(64) } as KrayEvent); ok(false, 'wrong-amount settle should throw') } catch { ok(true, 'ATTACK settle amount ≠ lock → refused (matches exactly)') }
  // ── THE CANCEL DOOR — an open exit is withdrawable by ITS OWN HOLDER, and nobody else ──
  // cancel with no open exit → refused, byte-identical
  root = L.cascadeRoot()
  try { L.applyLive(signCancel({ seq: 6, kind: 'rune-cancel', hash: 'a1'.repeat(32), runeId: RUNE, from: A.addr, fee: '1', nonce: 1 })); ok(false, 'cancel of nothing should throw') }
  catch { ok(true, 'ATTACK cancel with no open exit → refused') }
  ok(L.cascadeRoot() === root, 'refused cancel → byte-identical')
  // unsigned cancel of B's real lock → refused (Supreme Law)
  try { L.applyLive({ seq: 6, kind: 'rune-cancel', hash: 'a2'.repeat(32), runeId: RUNE, from: B.addr, fee: '1', nonce: 1 } as KrayEvent); ok(false, 'unsigned cancel should throw') }
  catch { ok(true, 'SUPREME LAW: unsigned rune-cancel refused') }
  // A cannot cancel B's lock by signing as A (from must be the lock's holder; A has no lock)
  const sigForged = _signKrayWallet(runeCancelMessage(NET, B.addr, RUNE, 1), A.sk)
  try { L.applyLive({ seq: 6, kind: 'rune-cancel', hash: 'a3'.repeat(32), runeId: RUNE, from: B.addr, fee: '1', nonce: 1, publicKey: A.pk, signature: sigForged, scheme: 'kraywallet' } as KrayEvent); ok(false, 'foreign-key cancel should throw') }
  catch { ok(true, 'ATTACK cancel someone else\'s exit with your own key → refused') }
  // an inflated cancel fee is refused — the fee is exactly 1 ₭, never more
  try { L.applyLive(signCancel({ seq: 6, kind: 'rune-cancel', hash: 'a4'.repeat(32), runeId: RUNE, from: B.addr, fee: '50', nonce: 1 })); ok(false, 'inflated cancel fee should throw') }
  catch { ok(true, 'ATTACK inflate the cancel fee to 50 → refused (exactly 1, never more)') }
  // the VALID cancel: B withdraws the open 400 exit — credits return, reserve untouched, fee paid
  const treasuryBeforeCancel = L.balanceOf(TREASURY)
  L.applyLive(signCancel({ seq: 6, kind: 'rune-cancel', hash: 'a5'.repeat(32), runeId: RUNE, from: B.addr, fee: '1', nonce: 1 }))
  ok(L.runes.balanceOf(rid, B.addr) === 400n && L.runes.lockedOf(rid, B.addr) === null, 'CANCEL returned the locked 400 to B, lock closed')
  ok(L.runes.reserveOf(rid) === 1000n, '…and the reserve never moved (nothing entered or left Bitcoin)')
  ok(L.balanceOf(TREASURY) === treasuryBeforeCancel + 1n, '…and the cancel paid the eternal 1-₭ fee to the validators')
  ok(L.runesSolvent() && L.conserves(), 'after the cancel: solvent + ₭ conserved')
  // double cancel → refused (the lock is gone)
  try { L.applyLive(signCancel({ seq: 7, kind: 'rune-cancel', hash: 'a6'.repeat(32), runeId: RUNE, from: B.addr, fee: '1', nonce: 2 })); ok(false, 'double cancel should throw') }
  catch { ok(true, 'ATTACK cancel the same exit twice → refused (no open exit)') }
  // the road reopens: B exits again after the cancel — the lock is fresh, then a payout settles it
  L.applyLive(signExit({ seq: 7, kind: 'rune-exit', hash: 'a7'.repeat(32), runeId: RUNE, from: B.addr, amount: '400', l1Address: A.addr, fee: '1', nonce: 2 }))
  ok(L.runes.lockedOf(rid, B.addr)?.amount === 400n, 'RE-EXIT after cancel locked 400 again — cancel closes nothing forever')
  // ── THE LODGE DOOR — a pre-signed settlement ARMS the exit; armed = uncancellable, in CONSENSUS ──
  try { L.applyLive({ seq: 8, kind: 'rune-lodge', hash: 'b1'.repeat(32), runeId: RUNE, from: A.addr } as KrayEvent); ok(false, 'lodge of nothing should throw') }
  catch { ok(true, 'ATTACK lodge against an address with no open exit → refused') }
  L.applyLive({ seq: 8, kind: 'rune-lodge', hash: 'b2'.repeat(32), runeId: RUNE, from: B.addr } as KrayEvent)
  ok(L.runes.lockedOf(rid, B.addr)?.armed === true, 'LODGE armed the open exit — journaled, replay re-derives it')
  try { L.applyLive({ seq: 9, kind: 'rune-lodge', hash: 'b3'.repeat(32), runeId: RUNE, from: B.addr } as KrayEvent); ok(false, 'double lodge should throw') }
  catch { ok(true, 'ATTACK arm the same exit twice → refused (one settlement, one arming)') }
  root = L.cascadeRoot()
  try { L.applyLive(signCancel({ seq: 9, kind: 'rune-cancel', hash: 'b4'.repeat(32), runeId: RUNE, from: B.addr, fee: '1', nonce: 3 })); ok(false, 'cancel of an ARMED exit should throw') }
  catch { ok(true, 'REDUCER LAW: cancelling an ARMED exit → refused (a co-signed hex cannot be un-signed)') }
  ok(L.cascadeRoot() === root, 'refused armed-cancel → byte-identical')
  L.applyLive({ seq: 9, kind: 'rune-settle', hash: '4'.repeat(64), runeId: RUNE, from: B.addr, amount: '400', l1Txid: 'b'.repeat(64) } as KrayEvent)
  ok(L.runes.reserveOf(rid) === 600n && L.runes.lockedOf(rid, B.addr) === null, 'SETTLE burned the 400 lock (armed exits complete by settling), reserve fell to 600')
  // one payout, one burn (seq 10 — a fresh event, not a stale-seq replay applyLive would skip)
  try { L.applyLive({ seq: 10, kind: 'rune-settle', hash: '5'.repeat(64), runeId: RUNE, from: B.addr, amount: '400', l1Txid: 'b'.repeat(64) } as KrayEvent); ok(false, 'reused l1Txid should throw') } catch { ok(true, 'ATTACK reuse an L1 payout to burn twice → refused') }
  ok(L.runesSolvent(), 'after every rune attack: still solvent')

  console.log(`\n✓ ${pass} checks passed — THE RUNE L2 HOLDS UNDER STORM: ${totalActs} acts across ${seeds.length} seeds (${deposits} deposits, ${sends} signed sends, ${exits} exit locks, ${settles} settlements, ${cancels} signed cancels, ${refused} refused), solvency (reserve == credits + locks) re-checked against an independent shadow after EVERY act, ₭ conservation + the peg unaffected, every door refused (replayed deposit, over-send, unsigned/forged/tampered send, double exit, wrong-amount + reused-payout settle, cancel of nothing / foreign key / double cancel), and a byte-exact reboot proving the rune L2 is a signature-bound pure function of the journal — reused, never duplicated. ⚗️₭`)
}
main()
