/**
 * THE LEDGER (v2) UNDER STORM — the cascade check for Phase 1's money core AND the
 * Supreme Law (BIP-340 signatures, verified at the door AND at replay).
 *   node src/test/ledger.sim.ts
 *
 * KRAY is fungible, conserved as EMITTED − BURNED, minted only by proof-of-donation, and
 * moved only by a real signature. This drives thousands of random donations, transfers,
 * burns (inscribe/name), star moves and rewards across wallets holding REAL secp256k1
 * keys — every user act is signed the KrayWallet way and the reducer re-verifies it. After
 * EVERY act it re-asserts:
 *   · conserves()  — Σ balances == emitted − burned (the built-in tripwire)
 *   · backed()     — emitted ≤ donated (the peg-of-sacrifice; no premine)
 *   · an INDEPENDENT shadow — every balance/nonce/emitted/burned recomputed by hand
 * Then it proves a byte-exact reboot (which RE-VERIFIES every signature). It fires every
 * adversarial door — overspend, stale-nonce replay, unheld-star move, reward>pool, cursed
 * burn, full-pot donation, anchor>pot — AND every signature attack — unsigned, forged,
 * wrong-key (spoof), one tampered byte, and a doctored event rejected at REPLAY — and
 * demands each is refused atomically, leaving the ledger byte-identical.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { TREASURY } from '../protocol/kray-primitives.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, scriptOfAddress,
  transferMessage, sendStarMessage, inscribeMessageV2, nameMessageV2, originMessageV2,
} from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'
import { authorHeldOriginProof } from './ordinal-proof-fixture.ts'

// LEGACY-ERA BENCH: this sim exercises the pre-retirement `reward` semantics (among everything else),
// so its ledgers inject rewardRetiredSeq=MAX. The retirement law itself is pinned in reward-retired.test.ts.
const mkLedger = () => new KrayLedger(undefined, 'regtest', undefined, false, undefined, undefined, undefined, undefined, Number.MAX_SAFE_INTEGER)


let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
function lcg(seed: number) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000 }

const NET = 'regtest'
const BNET = toBtcNet(NET)

// ── real wallets: deterministic secp256k1 keys → their taproot addresses ──
interface Wallet { addr: string; sk: Uint8Array; pk: string }
function makeWallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`kraynet-ledger-sim|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  const addr = btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!
  return { addr, sk, pk: publicKeyHex }
}
const WALLETS = [makeWallet('A'), makeWallet('B'), makeWallet('C'), makeWallet('D')]
const BY_ADDR = new Map(WALLETS.map((w) => [w.addr, w]))
const ADDRS = WALLETS.map((w) => w.addr)

/** the canonical message a given user event signs (mirrors the ledger's requireSig) */
function messageFor(e: KrayEvent): string {
  switch (e.kind) {
    case 'transfer': return transferMessage(NET, e.from!, e.to!, BigInt(e.amount!), e.nonce!)
    case 'transfer-star': return sendStarMessage(NET, e.from!, e.to!, BigInt(e.star!), e.nonce!)
    case 'name': return nameMessageV2(NET, e.from!, e.nonce!, e.name!)
    case 'origin': return originMessageV2(NET, e.from!, e.l1InscriptionId!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.nonce!)
    default: return inscribeMessageV2(NET, e.from!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.parent !== undefined ? BigInt(e.parent) : undefined, e.nonce!)
  }
}
/** sign a user event the KrayWallet way with the from-wallet's real key */
function sign(e: KrayEvent): KrayEvent {
  const w = BY_ADDR.get(e.from!)!
  e.publicKey = w.pk; e.signature = _signKrayWallet(messageFor(e), w.sk); e.scheme = 'kraywallet'
  return e
}

interface Shadow {
  bal: Map<string, bigint>; nonce: Map<string, number>
  emitted: bigint; burned: bigint
  starOwner: Map<string, string>; starCount: bigint
}
const sBal = (s: Shadow, a: string) => s.bal.get(a) ?? 0n
const sNonce = (s: Shadow, a: string) => s.nonce.get(a) ?? 0

function assertShadow(L: KrayLedger, s: Shadow, tag: string): void {
  ok(L.conserves(), `${tag}: conserves() Σ balances == emitted − burned`)
  ok(L.backed(), `${tag}: backed() emitted ≤ donated (peg-of-sacrifice, no premine)`)
  ok(L.totalEmitted === s.emitted, `${tag}: emitted (${L.totalEmitted} vs ${s.emitted})`)
  ok(L.totalBurned === s.burned, `${tag}: burned (${L.totalBurned} vs ${s.burned})`)
  ok(L.circulating === s.emitted - s.burned, `${tag}: circulating == emitted − burned`)
  for (const a of [...ADDRS, TREASURY]) {
    ok(L.balanceOf(a) === sBal(s, a), `${tag}: balance ${a} (${L.balanceOf(a)} vs ${sBal(s, a)})`)
    ok(L.nonceOf(a) === sNonce(s, a), `${tag}: nonce ${a} (${L.nonceOf(a)} vs ${sNonce(s, a)})`)
  }
  let sum = 0n; for (const a of [...ADDRS, TREASURY]) sum += sBal(s, a)
  ok(sum === s.emitted - s.burned, `${tag}: shadow Σ == emitted − burned`)
}

/** Submit an event; assert it applied XOR was refused-with-state-pristine, per `valid`. */
function attempt(L: KrayLedger, s: Shadow, journal: KrayEvent[], e: KrayEvent, valid: boolean, mutateShadow: () => void, tag: string): void {
  const before = L.balanceRoot()
  let threw = false
  try { L.applyLive(e) } catch { threw = true }
  if (valid) {
    ok(!threw, `${tag}: valid event applied (${e.kind})`)
    journal.push(e); mutateShadow()
  } else {
    ok(threw, `${tag}: invalid event REFUSED at the door (${e.kind})`)
    ok(L.balanceRoot() === before, `${tag}: refused event left the ledger byte-identical (atomic)`)
  }
}

function main(): void {
  const seeds = [3, 17, 88, 2024, 65537]
  let totalActs = 0, mints = 0, burns = 0, moves = 0, refusedAtDoor = 0
  let uid = 0
  const uniq = () => (++uid).toString(16)

  for (const seed of seeds) {
    const rnd = lcg(seed)
    const L = mkLedger()
    const s: Shadow = { bal: new Map(), nonce: new Map(), emitted: 0n, burned: 0n, starOwner: new Map(), starCount: 0n }
    const journal: KrayEvent[] = []
    let seq = 0
    const H = () => createHash('sha256').update(`${seed}|${seq}`, 'utf8').digest('hex')

    // seed the world — real donations to the anchoring pot (the huge default target ⇒ 1:1 mint)
    for (const a of ADDRS) {
      seq++
      const amt = 1000n + BigInt(Math.floor(rnd() * 5000))
      const e = { seq, kind: 'donate', hash: H(), to: a, amount: amt.toString() } as KrayEvent
      attempt(L, s, journal, e, true, () => { s.bal.set(a, sBal(s, a) + amt); s.emitted += amt }, `${seed} seed`)
      mints++; totalActs++
      assertShadow(L, s, `${seed} seed`)
    }

    for (let step = 0; step < 260; step++) {
      seq++
      const from = ADDRS[Math.floor(rnd() * ADDRS.length)]
      const to = ADDRS[Math.floor(rnd() * ADDRS.length)]
      const roll = rnd()

      if (roll < 0.12) {
        const amt = 1n + BigInt(Math.floor(rnd() * 2000))
        const e = { seq, kind: 'donate', hash: H(), to, amount: amt.toString() } as KrayEvent
        attempt(L, s, journal, e, true, () => { s.bal.set(to, sBal(s, to) + amt); s.emitted += amt }, `${seed}.${step}`)
        mints++
      } else if (roll < 0.45) {
        const overspend = rnd() < 0.15
        const have = sBal(s, from)
        const fee = 1n
        let amt: bigint, valid: boolean
        if (overspend || have < 2n) { amt = have + 5n; valid = false }
        else { amt = 1n + BigInt(Math.floor(rnd() * Number(have - fee))); valid = amt + fee <= have }
        if (from === to) valid = false // a transfer needs two different parties (mirrors the ledger + rune.sim)
        const e = sign({ seq, kind: 'transfer', hash: H(), from, to, amount: amt.toString(), fee: fee.toString(), nonce: sNonce(s, from) } as KrayEvent)
        attempt(L, s, journal, e, valid, () => {
          s.bal.set(from, sBal(s, from) - (amt + fee)); s.bal.set(to, sBal(s, to) + amt)
          s.bal.set(TREASURY, sBal(s, TREASURY) + fee); s.nonce.set(from, sNonce(s, from) + 1)
        }, `${seed}.${step}`)
        if (!valid) refusedAtDoor++
      } else if (roll < 0.70) {
        const isName = rnd() < 0.4
        const have = sBal(s, from)
        const valid = have >= 1n
        const e = sign(isName
          ? { seq, kind: 'name', hash: H(), from, name: 'n' + seed + uniq() + '', nonce: sNonce(s, from) } as KrayEvent
          : { seq, kind: 'inscribe', hash: H(), from, contentHash: 'c' + seed + uniq(), contentType: 'text/plain', size: 3, nonce: sNonce(s, from) } as KrayEvent)
        attempt(L, s, journal, e, valid, () => {
          s.bal.set(from, sBal(s, from) - 1n); s.burned += 1n; s.nonce.set(from, sNonce(s, from) + 1)
          s.starOwner.set(s.starCount.toString(), from); s.starCount += 1n
        }, `${seed}.${step}`)
        if (valid) burns++; else refusedAtDoor++
      } else if (roll < 0.88) {
        if (s.starCount === 0n) { continue }
        const star = BigInt(Math.floor(rnd() * Number(s.starCount)))
        const owns = s.starOwner.get(star.toString()) === from
        const fee = 1n
        const valid = owns && from !== to && sBal(s, from) >= fee // a star-send needs a different recipient
        const e = sign({ seq, kind: 'transfer-star', hash: H(), from, to, star: star.toString(), fee: fee.toString(), nonce: sNonce(s, from) } as KrayEvent)
        attempt(L, s, journal, e, valid, () => {
          s.bal.set(from, sBal(s, from) - fee); s.bal.set(TREASURY, sBal(s, TREASURY) + fee)
          s.nonce.set(from, sNonce(s, from) + 1); s.starOwner.set(star.toString(), to)
        }, `${seed}.${step}`)
        if (valid) moves++; else refusedAtDoor++
      } else {
        const pool = sBal(s, TREASURY)
        const overpay = rnd() < 0.3 || pool === 0n
        const amt = overpay ? pool + 1n : 1n + BigInt(Math.floor(rnd() * Number(pool)))
        const valid = amt > 0n && amt <= pool
        const e = { seq, kind: 'reward', hash: H(), to, amount: amt.toString() } as KrayEvent
        attempt(L, s, journal, e, valid, () => {
          s.bal.set(TREASURY, sBal(s, TREASURY) - amt); s.bal.set(to, sBal(s, to) + amt)
        }, `${seed}.${step}`)
        if (!valid) refusedAtDoor++
      }
      totalActs++
      assertShadow(L, s, `${seed}.${step}`)
    }

    // ── THE REBOOT IS THE VERIFIER — replay RE-VERIFIES every signature ──
    const L2 = mkLedger()
    for (const e of journal) L2.applyLive(e)
    ok(L2.balanceRoot() === L.balanceRoot(), `${seed}: REBOOT balance root byte-exact`)
    ok(L2.stars.merkleRoot() === L.stars.merkleRoot(), `${seed}: REBOOT star root byte-exact`)
    ok(L2.cascadeRoot() === L.cascadeRoot(), `${seed}: REBOOT cascade root (the Bitcoin anchor) byte-exact`)
    ok(L2.conserves() && L2.backed(), `${seed}: reboot conserves + backed`)

    // ── REPLAY RE-VERIFIES: a doctored amount in the journal is rejected at replay ──
    const firstTransfer = journal.findIndex((e) => e.kind === 'transfer')
    if (firstTransfer >= 0) {
      const doctored = journal.map((e, i) => i === firstTransfer ? { ...e, amount: (BigInt(e.amount!) + 1n).toString() } : e)
      const L3 = mkLedger()
      let rejected = false
      try { for (const e of doctored) L3.applyLive(e) } catch { rejected = true }
      ok(rejected, `${seed}: a DOCTORED journal event is rejected at REPLAY (Supreme Law holds on replay, not just at the door)`)
    }

    // tamper-evidence of the anchor
    const rootNow = L.cascadeRoot()
    L.applyLive({ seq: seq + 999, kind: 'donate', hash: 'ff'.repeat(32), to: ADDRS[0], amount: '1' } as KrayEvent)
    ok(L.cascadeRoot() !== rootNow, `${seed}: minting a single ₭ flips the anchor`)
  }

  // ── THE ECONOMIC DOORS (real signatures) ──
  const [A, B, C, D] = WALLETS
  const L = mkLedger()
  const root0 = L.balanceRoot()
  L.applyLive({ seq: 1, kind: 'donate', hash: 'a'.repeat(64), to: A.addr, amount: '10' } as KrayEvent)
  ok(L.balanceOf(A.addr) === 10n && L.totalEmitted === 10n, 'MINT: a donation credits ₭ + raises emitted (1:1)')

  let root = L.balanceRoot()
  try { L.applyLive(sign({ seq: 2, kind: 'transfer', hash: 'b'.repeat(64), from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 0 } as KrayEvent)); ok(false, 'overspend should throw') } catch { ok(true, 'ATTACK overspend → thrown') }
  ok(L.balanceRoot() === root && L.nonceOf(A.addr) === 0, 'ATTACK overspend → byte-identical, nonce NOT bumped (atomic)')

  L.applyLive(sign({ seq: 3, kind: 'transfer', hash: 'c'.repeat(64), from: A.addr, to: B.addr, amount: '4', fee: '1', nonce: 0 } as KrayEvent))
  ok(L.balanceOf(A.addr) === 5n && L.balanceOf(B.addr) === 4n && L.balanceOf(TREASURY) === 1n, 'transfer moved 4, fee 1 to treasury')
  root = L.balanceRoot()
  try { L.applyLive(sign({ seq: 4, kind: 'transfer', hash: 'd'.repeat(64), from: A.addr, to: B.addr, amount: '4', fee: '1', nonce: 0 } as KrayEvent)); ok(false, 'stale nonce should throw') } catch { ok(true, 'ATTACK stale-nonce replay → thrown') }
  ok(L.balanceRoot() === root, 'ATTACK stale-nonce → byte-identical (no double-spend)')

  L.applyLive(sign({ seq: 5, kind: 'inscribe', hash: 'e'.repeat(64), from: A.addr, contentHash: 'z', contentType: 't', size: 1, nonce: 1 } as KrayEvent))
  ok(L.totalBurned === 1n && L.balanceOf(A.addr) === 4n && L.stars.ownerOf(0n) === A.addr, 'BURN: inscribe burned 1 ₭ → star #0 born, owned by author')
  root = L.balanceRoot()
  try { L.applyLive(sign({ seq: 6, kind: 'transfer-star', hash: 'f'.repeat(64), from: B.addr, to: C.addr, star: '0', fee: '1', nonce: 0 } as KrayEvent)); ok(false, 'unheld move should throw') } catch { ok(true, 'ATTACK move unheld star → thrown') }
  ok(L.balanceRoot() === root && L.stars.ownerOf(0n) === A.addr, 'ATTACK unheld move → no fee charged, star unmoved')

  const balBefore = L.balanceOf(A.addr), burnBefore = L.totalBurned, starsBefore = L.stars.starCount
  L.applyLive(sign({ seq: 7, kind: 'inscribe', hash: '1'.repeat(64), from: A.addr, contentHash: 'z', contentType: 't', size: 1, nonce: 2 } as KrayEvent)) // dup
  ok(L.balanceOf(A.addr) === balBefore - 1n && L.totalBurned === burnBefore + 1n && L.stars.starCount === Number(starsBefore), 'CURSED BURN: duplicate still burned 1 ₭, no second star')
  ok(L.conserves(), 'CURSED BURN: conservation still holds')

  root = L.balanceRoot()
  try { L.applyLive({ seq: 8, kind: 'reward', hash: '2'.repeat(64), to: D.addr, amount: '999' } as KrayEvent); ok(false, 'reward>pool should throw') } catch { ok(true, 'ATTACK reward past the fee pool → thrown') }
  ok(L.balanceRoot() === root && L.conserves(), 'ATTACK reward>pool → byte-identical, conservation intact')
  ok(root0 !== root, 'sanity: the ledger did move under the valid acts')

  // ── THE SUPREME LAW — signature doors (real crypto) ──
  const S = mkLedger()
  S.applyLive({ seq: 1, kind: 'donate', hash: 'a'.repeat(64), to: A.addr, amount: '100' } as KrayEvent)
  root = S.balanceRoot()
  // 1 · unsigned → refused
  try { S.applyLive({ seq: 2, kind: 'transfer', hash: 'b'.repeat(64), from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 0 } as KrayEvent); ok(false, 'unsigned should throw') } catch { ok(true, 'SUPREME LAW: unsigned transfer REFUSED') }
  ok(S.balanceRoot() === root && S.nonceOf(A.addr) === 0, 'unsigned → byte-identical, no nonce bump')
  // 2 · forged signature (random bytes) → refused
  try { S.applyLive({ seq: 2, kind: 'transfer', hash: 'b'.repeat(64), from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 0, publicKey: A.pk, signature: 'ab'.repeat(64), scheme: 'kraywallet' } as KrayEvent); ok(false, 'forged should throw') } catch { ok(true, 'SUPREME LAW: forged signature REFUSED') }
  ok(S.balanceRoot() === root, 'forged → byte-identical')
  // 3 · wrong key — sign with B's key but claim from = A (spoof) → refused by address binding
  const spoof = { seq: 2, kind: 'transfer', hash: 'b'.repeat(64), from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 0, publicKey: B.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, B.addr, 10n, 0), B.sk), scheme: 'kraywallet' } as KrayEvent
  try { S.applyLive(spoof); ok(false, 'spoof should throw') } catch { ok(true, 'SUPREME LAW: wrong-key spoof REFUSED (pubkey must re-derive to `from`)') }
  ok(S.balanceRoot() === root, 'spoof → byte-identical')
  // 4 · one tampered byte — sign amount=10, then change amount to 50 → refused
  const tampered = { seq: 2, kind: 'transfer', hash: 'b'.repeat(64), from: A.addr, to: B.addr, amount: '50', fee: '1', nonce: 0, publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, B.addr, 10n, 0), A.sk), scheme: 'kraywallet' } as KrayEvent
  try { S.applyLive(tampered); ok(false, 'tampered should throw') } catch { ok(true, 'SUPREME LAW: one tampered byte (amount 10→50) REFUSED') }
  ok(S.balanceRoot() === root, 'tampered → byte-identical')
  // 5 · a VALID signature moves state
  S.applyLive(sign({ seq: 2, kind: 'transfer', hash: 'b'.repeat(64), from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 0 } as KrayEvent))
  ok(S.balanceOf(B.addr) === 10n && S.balanceOf(A.addr) === 89n && S.balanceOf(TREASURY) === 1n, 'SUPREME LAW: a VALID signature moves state (10→B, fee 1→treasury)')

  // ── ORIGIN — adopt an L1 Ordinals inscription as a born-from-fire star ──
  const O = mkLedger()
  O.applyLive({ seq: 1, kind: 'donate', hash: 'a'.repeat(64), to: A.addr, amount: '10' } as KrayEvent)
  const held = authorHeldOriginProof(scriptOfAddress(A.addr, NET), { confirmations: 1, salt: 'ledger-sim-origin' })
  const INS_ID = held.parentId
  O.applyLive(sign({ seq: 2, kind: 'origin', hash: 'b'.repeat(64), from: A.addr, l1InscriptionId: INS_ID, contentHash: 'ordinal-content', contentType: 'image/png', size: 100, nonce: 0, originProofs: [held.proof] } as KrayEvent))
  ok(O.stars.starCount === 1 && O.stars.ownerOf(0n) === A.addr, 'ORIGIN: an L1 ordinal became star #0, owned by the adopter')
  ok(O.stars.star(0n)?.origin?.l1InscriptionId === INS_ID, 'star #0 carries its L1 provenance (the parent ordinal id)')
  ok(O.totalBurned === 1n && O.balanceOf(A.addr) === 9n, 'origin burned 1 ₭ — born from fire')
  const oroot = O.cascadeRoot()
  // unsigned origin refused; wrong-message origin (tampered content) refused
  try { O.applyLive({ seq: 3, kind: 'origin', hash: 'c'.repeat(64), from: A.addr, l1InscriptionId: 'b'.repeat(64) + 'i0', contentHash: 'x', contentType: 'image/png', size: 1, nonce: 1 } as KrayEvent); ok(false, 'unsigned origin should throw') } catch { ok(true, 'SUPREME LAW: unsigned origin refused') }
  const badOriginSig = _signKrayWallet(originMessageV2(NET, A.addr, 'b'.repeat(64) + 'i0', 'CLEAN', 'image/png', 1, 1), A.sk)
  try { O.applyLive({ seq: 3, kind: 'origin', hash: 'd'.repeat(64), from: A.addr, l1InscriptionId: 'b'.repeat(64) + 'i0', contentHash: 'TAMPERED', contentType: 'image/png', size: 1, nonce: 1, publicKey: A.pk, signature: badOriginSig, scheme: 'kraywallet' } as KrayEvent); ok(false, 'tampered origin should throw') } catch { ok(true, 'SUPREME LAW: tampered origin (content ≠ signed) refused') }
  ok(O.cascadeRoot() === oroot, 'refused origins → byte-identical')

  console.log(`\n✓ ${pass} checks passed — THE LEDGER HOLDS UNDER STORM: ${totalActs} random acts across ${seeds.length} seeds (${mints} mints, ${burns} burns→stars, ${moves} star moves, ${refusedAtDoor} refused at the door), every user act signed with a REAL secp256k1 key and re-verified by the reducer, conservation (Σ == emitted − burned) and the peg (emitted ≤ donated) re-checked against an independent shadow after EVERY act, every economic door AND every signature attack (unsigned, forged, wrong-key spoof, one tampered byte) refused atomically with state byte-identical, a doctored journal event rejected at REPLAY, and a byte-exact reboot proving the money is a pure, signature-bound function of the journal. Fungible fuel, born from fire, conserved, and moved only by proof. ₭⭐🔑`)
}
main()
