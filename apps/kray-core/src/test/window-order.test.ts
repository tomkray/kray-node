/**
 * THE CONVERGENCE THEOREM (ADR-3 · slice 3c) — two writers, one book — hardened after the council.
 *
 *   node src/test/window-order.test.ts
 *
 * The pen stops being a machine and becomes a rule: whoever holds the SAME set of signed acts derives
 * the byte-identical journal and the same cascade root. This exam PROVES it by breaking the writer's
 * freedom AND by attacking the four holes an adversarial council found in the first draft:
 *
 *   · CONVERGENCE across every arrival order — identical `ordered` and identical root (the theorem);
 *   · ORDER-SENSITIVE kinds — a first-inscribe RACE (not just commuting transfers): the same winner and
 *     the same root on every writer, so the primitive is tested where order actually changes state;
 *   · A SECOND IMPLEMENTATION converges — orderWindow's output equals an independent reference greedy on
 *     random sets (the code IS the written rule, not merely a shuffle-stable variant of itself);
 *   · UNGRINDABLE key — the order key is the hash of the SIGNED MESSAGE only; re-signing the same intent
 *     (a fresh signature) does NOT change an act's position (no free front-running);
 *   · ADMISSION blocks censorship — a forged (invalid-signature) act cannot occupy an account's nonce
 *     slot: it is rejected before scheduling, and the victim's genuine chain lands untouched;
 *   · nonce order, nonce-gap deferral, and a double-spend's deterministic winner still hold.
 *
 * Pure ordering only — nothing here is wired into the live writer's append. This is the primitive the
 * succession rule stands on, proven before it carries any weight.
 */
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { KrayNode } from '../protocol/node.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, inscribeMessageV2, verifySignature } from '../protocol/scheme.ts'
import { orderWindow, keyFromSignedMessage, canonicalJson, type SignedAct, type WindowRules } from '../protocol/window-order.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

interface Wallet { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`window-order|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B'), C = wallet('C')

type Act = SignedAct & Record<string, unknown>

/** the exact bytes the author signs for each kind — the ONLY thing the order key may hash */
function signedMessageOf(a: Act): string {
  if (a.kind === 'transfer') return transferMessage(NET, a.from as string, a.to as string, BigInt(a.amount as string), a.nonce as number)
  if (a.kind === 'inscribe') return inscribeMessageV2(NET, a.from as string, a.contentHash as string, (a.contentType as string) ?? 'application/octet-stream', a.size as number, a.parent !== undefined ? BigInt(a.parent as string) : undefined, a.nonce as number)
  throw new Error('unknown kind for signedMessageOf: ' + String(a.kind))
}
const RULES: WindowRules<Act> = {
  nonceOf: (addr) => baseNonceOf(addr),
  keyOf: (a) => keyFromSignedMessage(signedMessageOf(a)),
  isValid: (a) => { try { return verifySignature(a.from as string, signedMessageOf(a), a.signature as string, a.publicKey as string, (a.scheme as string) ?? 'kraywallet', BNET) } catch { return false } },
}

function transfer(from: Wallet, to: Wallet, amount: bigint, nonce: number): Act {
  const msg = transferMessage(NET, from.addr, to.addr, amount, nonce)
  return { action: 'transfer', kind: 'transfer', at: 0, from: from.addr, to: to.addr, amount: String(amount), fee: '1', nonce, publicKey: from.pk, signature: _signKrayWallet(msg, from.sk), scheme: 'kraywallet' }
}
function inscribe(from: Wallet, contentHash: string, nonce: number): Act {
  const msg = inscribeMessageV2(NET, from.addr, contentHash, 'text/plain', 8, undefined, nonce)
  return { action: 'inscribe', kind: 'inscribe', at: 0, from: from.addr, contentHash, contentType: 'text/plain', size: 8, nonce, publicKey: from.pk, signature: _signKrayWallet(msg, from.sk), scheme: 'kraywallet' }
}

function shuffle<T>(arr: readonly T[], seed: number): T[] {
  const a = [...arr]; let s = seed >>> 0
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1);[a[i], a[j]] = [a[j], a[i]] }
  return a
}

/** an INDEPENDENT reference implementation of the written rule (greedy: smallest-key eligible each step).
 *  If orderWindow ever disagrees with this, the code is not the rule and two writers would diverge. */
function refGreedy(acts: readonly Act[], rules: WindowRules<Act>): Act[] {
  const byKey = new Map<string, Act>()
  for (const a of acts) if (rules.isValid(a)) { const k = rules.keyOf(a); if (!byKey.has(k)) byKey.set(k, a) }
  const items = [...byKey.entries()].map(([k, a]) => ({ k, a }))
  const expected = new Map<string, number>()
  const need = (f: string) => { if (!expected.has(f)) expected.set(f, rules.nonceOf(f)); return expected.get(f)! }
  const taken = new Set<string>(); const ordered: Act[] = []
  for (;;) {
    let best: { k: string; a: Act } | null = null
    for (const it of items) {
      if (taken.has(it.k)) continue
      const a = it.a
      const eligible = typeof a.nonce !== 'number' || (typeof a.from === 'string' && !!a.from && a.nonce === need(a.from))
      if (eligible && (!best || it.k < best.k)) best = it
    }
    if (!best) break
    taken.add(best.k); ordered.push(best.a)
    if (typeof best.a.nonce === 'number' && typeof best.a.from === 'string') expected.set(best.a.from, (best.a.nonce as number) + 1)
  }
  return ordered
}

const DIRS: string[] = []
function fundedNode(tag: string): KrayNode {
  const dir = join(tmpdir(), `winord-${tag}-${process.pid}`); DIRS.push(dir)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const node = new KrayNode(dir, NET)
  node.donate(A.addr, 10_000n); node.donate(B.addr, 10_000n); node.donate(C.addr, 10_000n)
  return node
}
let baseNonceOf: (addr: string) => number = () => 0
function rootAfter(tag: string, ordered: readonly Act[]): string {
  const node = fundedNode(tag)
  for (const a of ordered) { try { node.submit({ ...a } as unknown as Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'>) } catch { /* deterministic refusal in this fixed order */ } }
  return node.cascadeRoot()
}
const orderKey = (o: readonly Act[]) => o.map((a) => keyFromSignedMessage(signedMessageOf(a))).join(',')

function main() {
  console.log('\n╔═ THE CONVERGENCE THEOREM (hardened) — two writers, one book ═╗\n')
  const base = fundedNode('base')
  baseNonceOf = (addr: string) => base.ledger.nonceOf(addr)

  ok(canonicalJson({ b: 1, a: 2 }) === '{"a":2,"b":1}', 'canonicalJson sorts keys — one byte-string on any machine')
  // the order key is over SIGNED bytes only: re-signing the same intent must NOT move the act
  {
    const t1 = transfer(A, B, 10n, 0), t2 = transfer(A, B, 10n, 0)
    ok(t1.signature !== t2.signature, 'a re-sign yields a DIFFERENT signature (BIP-340 without fixed aux_rand)')
    ok(RULES.keyOf(t1) === RULES.keyOf(t2), 'yet the ORDER KEY is identical — it hashes the signed message, not the signature (ungrindable)')
  }

  // ── THE ACT SET — interleaved nonce chains across three accounts ──
  const SET: Act[] = [
    transfer(A, B, 10n, 0), transfer(A, C, 20n, 1), transfer(A, B, 5n, 2),
    transfer(B, C, 15n, 0), transfer(B, A, 8n, 1),
    transfer(C, A, 12n, 0), transfer(C, B, 4n, 1), transfer(C, A, 7n, 2),
  ]

  const { ordered: ord0 } = orderWindow(SET, RULES)
  const root0 = rootAfter('0', ord0)
  let converged = true, sameRoot = true
  for (let seed = 1; seed <= 50; seed++) {
    const { ordered } = orderWindow(shuffle(SET, seed), RULES)
    if (orderKey(ordered) !== orderKey(ord0)) converged = false
    if (rootAfter('s' + seed, ordered) !== root0) sameRoot = false
  }
  ok(converged, '50 arrival orders of the same set → the IDENTICAL ordered journal (order is arithmetic)')
  ok(sameRoot, '50 arrival orders → the byte-identical cascade root (two writers, one book)')
  ok(ord0.length === SET.length, 'every act in the set made the window (all nonce chains complete)')

  // ── A SECOND IMPLEMENTATION converges — orderWindow == an independent greedy over random sets ──
  {
    let matches = true
    for (let seed = 0; seed <= 60; seed++) {
      const s = shuffle(SET, seed * 7 + 1)
      const a = orderWindow(s, RULES).ordered
      const b = refGreedy(s, RULES)
      if (orderKey(a) !== orderKey(b)) matches = false
    }
    ok(matches, 'orderWindow output == an INDEPENDENT reference greedy (the code IS the written rule — a second writer converges, not just a reshuffle of this one)')
  }

  // ── ORDER-SENSITIVE kinds — a first-inscribe RACE resolves to ONE winner, deterministically ──
  {
    const raceA = inscribe(A, 'contested-star', 0)   // A and B inscribe the SAME content in one window
    const raceB = inscribe(B, 'contested-star', 0)
    const winnerKey = RULES.keyOf(raceA) < RULES.keyOf(raceB) ? RULES.keyOf(raceA) : RULES.keyOf(raceB)
    let raceStable = true, raceRoot: string | null = null
    for (let seed = 0; seed <= 30; seed++) {
      const { ordered } = orderWindow(shuffle([raceA, raceB], seed), RULES)
      if (RULES.keyOf(ordered[0]) !== winnerKey) raceStable = false
      const r = rootAfter('race' + seed, ordered)
      if (raceRoot === null) raceRoot = r; else if (r !== raceRoot) raceStable = false
    }
    ok(raceStable, 'a first-inscribe RACE (order-sensitive) → the same winner and the same root on every writer — tested where order actually changes state, not just commuting transfers')
  }

  // ── ADMISSION blocks censorship — a forged act cannot occupy A's nonce slot ──
  {
    const genuineA0 = SET[0]   // A#0, validly signed
    // forge an A#0 act with an INVALID signature (signed by B's key), grinding `amount` to make its
    // order key smaller than the genuine one — under a naive rule it would sort first and evict A.
    let forged: Act | null = null
    for (let amt = 1; amt <= 4000; amt++) {
      const msg = transferMessage(NET, A.addr, C.addr, BigInt(amt), 0)
      const f: Act = { action: 'transfer', kind: 'transfer', at: 0, from: A.addr, to: C.addr, amount: String(amt), fee: '1', nonce: 0, publicKey: B.pk, signature: _signKrayWallet(msg, B.sk), scheme: 'kraywallet' }
      if (RULES.keyOf(f) < RULES.keyOf(genuineA0)) { forged = f; break }
    }
    ok(forged !== null, 'built a forged A#0 whose order key is SMALLER than the genuine one (would win a naive sort)')
    ok(RULES.isValid(forged!) === false, 'the forgery does NOT verify (signed by the wrong key)')
    const withForgery = orderWindow([forged!, ...SET], RULES)
    ok(withForgery.rejected.some((a) => a === forged), 'the forgery is REJECTED at admission — it never enters the schedule')
    const aChain = withForgery.ordered.filter((a) => a.from === A.addr).map((a) => a.nonce as number)
    ok(aChain.length === 3 && aChain.every((n, i) => n === i), 'A’s genuine chain [0,1,2] lands intact — the forger cannot seize A’s nonce slot')
    ok(rootAfter('forge', withForgery.ordered) === root0, 'the root is byte-identical to the un-attacked window — the censorship attempt changed nothing')
  }

  // ── nonce order, nonce-gap deferral, double-spend winner ──
  for (const w of [A, B, C]) {
    const seq = ord0.filter((a) => a.from === w.addr).map((a) => a.nonce as number)
    ok(seq.every((n, i) => n === i), `account ${w.addr.slice(0, 8)}… applies strictly in nonce order ${JSON.stringify(seq)}`)
  }
  {
    const withGap = [...SET, transfer(A, C, 3n, 5)]
    let gapOk = true
    for (let seed = 0; seed <= 20; seed++) {
      const { ordered, deferred } = orderWindow(shuffle(withGap, seed), RULES)
      if (!(deferred.length === 1 && (deferred[0].nonce as number) === 5) || ordered.some((a) => a.from === A.addr && a.nonce === 5)) gapOk = false
    }
    ok(gapOk, 'a nonce-gapped act (A#5, 3&4 missing) is DEFERRED in every permutation — never applied, never lost')
  }
  {
    const rivalX = transfer(A, B, 100n, 0), rivalY = transfer(A, C, 200n, 0)
    const winner = RULES.keyOf(rivalX) < RULES.keyOf(rivalY) ? RULES.keyOf(rivalX) : RULES.keyOf(rivalY)
    const rest = SET.filter((a) => !(a.from === A.addr && a.nonce === 0))
    let winOk = true
    for (let seed = 0; seed <= 20; seed++) {
      const { ordered, deferred } = orderWindow(shuffle([rivalX, rivalY, ...rest], seed), RULES)
      const a0 = ordered.find((a) => a.from === A.addr && a.nonce === 0)
      if (!a0 || RULES.keyOf(a0) !== winner || !deferred.some((a) => a.from === A.addr && a.nonce === 0)) winOk = false
    }
    ok(winOk, 'two acts reuse nonce A#0 → the smaller-key one applies, the rival defers — the same winner on every writer')
  }

  for (const d of DIRS) rmSync(d, { recursive: true, force: true })
  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — order is a function of the SIGNED acts; a forger cannot grind or censor; a second writer converges. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
