/**
 * THE PLENITUDE GUARDIAN — the eternal 1-₭ fee is UNIVERSAL, and stays universal forever.
 *
 * Not a spot-check of one kind: a completeness watchdog. It reads the reducer's own source, enumerates
 * EVERY `case` the ledger handles, and refuses to pass unless each one is classified — so a future kind
 * added without the Supreme fee (or without a named byte-proof) BREAKS this test until it is faced.
 *
 *   FC-1  CATALOG    — every reducer `case` is classified (value / no-value / system); an UNCATALOGUED kind fails
 *   FC-2  STATIC     — every SIGNED VALUE port carries the Supreme enforcement in its body (MIN_FEE / prescribed / burn 1 ₭)
 *   FC-3  LIVE FEE   — a real transfer with fee 0 / 2 / 1e9 is refused; fee 1 applies (the gas form, proven live)
 *   FC-4  LIVE BURN  — a real inscribe with no ₭ is refused; with ₭ it burns EXACTLY 1 and conserves (the fire form)
 *
 * Prove by breaking:  node src/test/eternal-fee-completeness.test.ts
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, inscribeMessageV2 } from '../protocol/scheme.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong guard: ' + msg)) }
}

// ── THE CATALOG — every reducer case, classified. The Creator's law: a value act pays the Supreme 1 ₭
//    (as gas, as a prescribed fee, or as a 1-₭ burn); a system/bridge act is proven by OTHER bytes
//    (Bitcoin SPV, an L1 co-signature, a re-derived PoW table) and does not sit in the user fee-queue. ──

/** SIGNED value ports → the enforcement token that MUST appear in the case body */
const SIGNED_VALUE: Record<string, 'MIN_FEE' | 'prescribed' | 'burn1'> = {
  transfer: 'MIN_FEE', 'transfer-star': 'MIN_FEE',
  'star-list': 'MIN_FEE', 'star-delist': 'MIN_FEE', 'star-buy': 'MIN_FEE',
  'star-offer': 'MIN_FEE', 'star-offer-cancel': 'MIN_FEE', 'star-offer-accept': 'MIN_FEE',
  'cut-send': 'MIN_FEE', 'lane-enter': 'MIN_FEE', 'lane-exit': 'MIN_FEE',
  'fold-seal': 'MIN_FEE', burn: 'MIN_FEE',
  'rune-send': 'MIN_FEE', 'rune-exit': 'MIN_FEE', 'rune-cancel': 'MIN_FEE',
  'amm-add': 'MIN_FEE', 'amm-remove': 'MIN_FEE', 'amm-swap': 'MIN_FEE',
  'amm-rr-add': 'MIN_FEE', 'amm-rr-remove': 'MIN_FEE', 'amm-rr-swap': 'MIN_FEE',
  'contract-call': 'MIN_FEE', eternize: 'MIN_FEE', 'set-face': 'MIN_FEE', 'clear-face': 'MIN_FEE', 'set-profile': 'MIN_FEE', 'set-kray-plate': 'MIN_FEE', 'star-like': 'MIN_FEE',
  'x-send': 'prescribed',                                   // THE FIREBORN LAW — prescribed 1 ₭ (or 0 by allowance), never a choice
  inscribe: 'burn1', origin: 'burn1', name: 'burn1',        // BORN FROM FIRE — 1 ₭ burned into a permanent star
  contract: 'burn1',                                        // v2 burns 1 ₭ to seal a law on a star
}
/** SIGNED but moves NO value — legitimately fee-free (records a commitment only) */
const SIGNED_NO_VALUE: Record<string, string> = {
  'quantum-commit': 'records SHA-256 of a future PQC key; touches no balance',
}
/** SYSTEM / BRIDGE / SPECIAL — proven by OTHER bytes, not the user signature fee-queue */
const SYSTEM: Record<string, string> = {
  genesis: 'network bootstrap',
  donate: 'Bitcoin SPV — keyed by the L1 outpoint, not a fee-queue slot',
  anchor: 'writer L1 anchor of the cascade root',
  seal: 'writer seal (protocol event)',
  'quantum-migrate': 'Lamport rescue — one-shot, authorized by the hash-based key, no fee',
  'burn-thaw': 'unsigned one-shot, whole effect re-derived from the journal',
  reward: 'RETIRED — refused at/after its seq (settlement re-derives payouts)',
  'rune-deposit': 'Bitcoin SPV + ancestry proof — the L1 bytes are the proof',
  'rune-rehome': 'L1 co-signature inside the Bitcoin transaction',
  'rune-lodge': 'L1 co-signature (door-proven against Bitcoin)',
  'rune-settle': 'Bitcoin SPV payout — one delivery, one burn',
  settlement: 're-derived from PoW beats; conserved, operator cannot forge',
  'quantum-commit': SIGNED_NO_VALUE['quantum-commit'],     // listed for the union check
}

function readReducerSource(): string {
  return readFileSync(new URL('../protocol/ledger.ts', import.meta.url), 'utf8')
}
/** brace-balanced body of a case (fall-through labels share the block that opens after the last label) */
function caseBody(src: string, kind: string): string | null {
  const idx = src.indexOf(`case '${kind}':`)
  if (idx < 0) return null
  const open = src.indexOf('{', idx)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1) }
  }
  return src.slice(open)
}

function wallet(tag: string) {
  const sk = createHash('sha256').update('plenitude|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
function ledger() {
  const L = new KrayLedger(undefined, NET, undefined, false)   // same-instant dormant on regtest default → no `at` needed
  const J: KrayEvent[] = []
  const ap = (e: Record<string, unknown>) => { const ev = { ...e, seq: J.length + 1 } as unknown as KrayEvent; L.applyLive(ev); J.push(ev); return ev }
  return { L, J, ap }
}

function main() {
  console.log('\n╔═ THE PLENITUDE GUARDIAN — the Supreme 1 ₭ is universal, now and forever ═╗\n')
  const src = readReducerSource()

  // ── FC-1 · CATALOG: every reducer case is classified ──
  console.log('FC-1 — catalog: every reducer `case` is classified (no kind escapes the law unseen)')
  const found = new Set<string>()
  for (const m of src.matchAll(/case '([a-z0-9][a-z0-9-]*)':/g)) found.add(m[1])
  const catalog = new Set<string>([...Object.keys(SIGNED_VALUE), ...Object.keys(SIGNED_NO_VALUE), ...Object.keys(SYSTEM)])
  const uncatalogued = [...found].filter((k) => !catalog.has(k))
  const stale = [...catalog].filter((k) => !found.has(k))
  ok(found.size > 30, `read ${found.size} reducer cases straight from ledger.ts source`)
  ok(uncatalogued.length === 0, uncatalogued.length === 0
    ? 'every reducer case is classified — none escapes the law'
    : `UNCATALOGUED kind(s): ${uncatalogued.join(', ')} — classify as SIGNED_VALUE (enforce 1 ₭) or SYSTEM (name the byte-proof) before shipping`)
  ok(stale.length === 0, stale.length === 0
    ? 'no stale catalog entries — the guardian matches the reducer exactly'
    : `catalog names kinds the reducer no longer has: ${stale.join(', ')}`)

  // ── FC-2 · STATIC: every signed VALUE port carries the Supreme enforcement in its body ──
  console.log('\nFC-2 — static: every signed VALUE port enforces the Supreme 1 ₭ in its own body')
  let missing = 0
  for (const [kind, token] of Object.entries(SIGNED_VALUE)) {
    // the brace-balanced case body is exact (fall-through labels share their block), so searching the
    // WHOLE body cannot leak into the next case — a future value port with no guard fails honestly here.
    const hay = caseBody(src, kind) ?? ''
    const held = token === 'MIN_FEE' ? /!==\s*MIN_FEE/.test(hay)
      : token === 'prescribed' ? /!==\s*prescribed/.test(hay)
      : /need 1 to/.test(hay)   // burn1: "insufficient ₭ to burn (need 1 to …)"
    if (!held) { missing++; console.log(`      ✗ ${kind} (${token}) — enforcement NOT found in body`) }
  }
  ok(missing === 0, `all ${Object.keys(SIGNED_VALUE).length} signed value ports carry the Supreme enforcement (MIN_FEE · prescribed · burn 1 ₭)`)

  // ── FC-2b · MIN_FEE is the eternal constant, exact (never a floor) ──
  const prim = readFileSync(new URL('../protocol/kray-primitives.ts', import.meta.url), 'utf8')
  ok(/export const MIN_FEE = 1n/.test(prim), 'MIN_FEE = 1n is a compiled core constant (kray-primitives.ts) — replicated byte-identical on every node')
  ok(!/fee\s*>=\s*MIN_FEE/.test(src), 'no port treats the fee as a floor (`>= MIN_FEE`) — it is exact equality everywhere, so no bid can outrank another')

  // ── FC-3 · LIVE: the gas form — a real transfer refuses any fee ≠ 1 ──
  console.log('\nFC-3 — live: a real transfer refuses fee 0 / 2 / 1,000,000,000; fee 1 applies')
  {
    const W = wallet('payer')
    const mk = (fee: string, nonce: number) => {
      const msg = transferMessage(NET, W.addr, wallet('sink').addr, 5n, nonce)
      return { kind: 'transfer', hash: `t-${fee}-${nonce}`, from: W.addr, to: wallet('sink').addr, amount: '5',
        fee, nonce, publicKey: W.pk, signature: _signKrayWallet(msg, W.sk), scheme: 'kraywallet' }
    }
    for (const bad of ['0', '2', '1000000000']) {
      const S = ledger(); S.ap({ kind: 'donate', hash: 'f-' + bad, to: W.addr, amount: '100' })
      rejects(() => S.ap(mk(bad, 0)), /eternal 1-₭ fee — exactly one, never more/, `fee=${bad} refused`)
    }
    const S = ledger(); S.ap({ kind: 'donate', hash: 'f-ok', to: W.addr, amount: '100' })
    S.ap(mk('1', 0))
    ok(S.L.balanceOf(W.addr) === 94n, 'fee=1 applied — 100 − 5 (sent) − 1 (Supreme fee) = 94')
  }

  // ── FC-4 · LIVE: the fire form — a real inscribe burns EXACTLY 1 ₭, or is refused with none ──
  console.log('\nFC-4 — live: a real inscribe burns EXACTLY 1 ₭ (born from fire); with none it is refused')
  {
    const W = wallet('carver')
    const chash = sha256hex('plenitude-fire-' + Math.random())
    const mkInscribe = (nonce: number) => {
      const msg = inscribeMessageV2(NET, W.addr, chash, 'text/plain', 9, undefined, nonce)
      return { kind: 'inscribe', hash: 'ins-' + nonce, from: W.addr, contentHash: chash, contentType: 'text/plain',
        size: 9, nonce, publicKey: W.pk, signature: _signKrayWallet(msg, W.sk), scheme: 'kraywallet' }
    }
    const S0 = ledger()
    rejects(() => S0.ap(mkInscribe(0)), /insufficient ₭ to burn/, 'no ₭ → the fire is refused (you cannot inscribe for free)')
    const S = ledger(); S.ap({ kind: 'donate', hash: 'fund-fire', to: W.addr, amount: '5' })
    const before = S.L.balanceOf(W.addr)
    S.ap(mkInscribe(0))
    const after = S.L.balanceOf(W.addr)
    ok(before - after === 1n, `inscribe burned EXACTLY 1 ₭ (${before} → ${after}) — the Supreme magnitude, charged by fire`)
    ok(S.L.conserves(), 'conservation tripwire green — the burned ₭ is accounted (Σ balances == emitted − burned)')
  }

  console.log(`\n═ eternal-fee-completeness: ${pass} passed, ${fail} failed ═\n`)
  if (fail > 0) process.exit(1)
}
main()
