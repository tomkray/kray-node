/**
 * PORTA 2 — RUNE BOOK OPEN: all named nets born open at 0; MAX is a lab pin.
 *   node src/test/rune-book-open.test.ts
 *
 * Below the pin, rune-* and amm-* refuse before the case. ₭ donate is not
 * a rune-book kind. Creator ratified main = 0 (2026-09-01) — empty genesis.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _hexToBytes } from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const MAX = Number.MAX_SAFE_INTEGER
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const s = (e as Error).message; ok(re.test(s), m + (re.test(s) ? '' : ' — wrong: ' + s)) }
}

const DARK = /rune book is not open/
const deposit = (seq: number): KrayEvent =>
  ({ seq, kind: 'rune-deposit', hash: 'd', runeId: '840000:1', outpoint: 'aa'.repeat(32) + ':0', to: 'x', amount: '1' } as unknown as KrayEvent)
const amm = (seq: number): KrayEvent =>
  ({ seq, kind: 'amm-add', hash: 'a', from: 'x', runeId: '840000:1', krayIn: '1', runeIn: '1', minLp: '0', fee: '1', nonce: 0 } as unknown as KrayEvent)

/** 21st ctor arg = runeBookOpenSeq. */
const pinned = (net: string, open: number) =>
  new KrayLedger(undefined, net, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, open)

function main() {
  console.log('\n╔═ PORTA 2 — RUNE BOOK OPEN: named nets born open; MAX is a pin ═╗\n')

  rejects(
    () => new KrayLedger(undefined, 'main').applyLive(deposit(1)),
    /proof-mandatory activation a rune deposit/,
    'P2-01 default main enters the rune case — the book is open (proof-mandatory is the next gate)',
  )
  rejects(
    () => new KrayLedger(undefined, 'main').applyLive(amm(1)),
    /amm-add|insufficient|nonce|not on this L2|fee/,
    'P2-02 default main enters the amm case — not the dark-book sentence',
  )
  rejects(
    () => new KrayLedger(undefined, 'main').applyLive({ seq: 1, kind: 'rune-exit', hash: 'e', from: 'x', runeId: '840000:1', amount: '1', l1Address: 'bc1q', fee: '1', nonce: 0 } as unknown as KrayEvent),
    /rune-exit needs|l1Address|insufficient|nonce|supported signature/,
    'P2-03 default main enters rune-exit — the book is open',
  )

  rejects(
    () => new KrayLedger(undefined, 'regtest').applyLive({ seq: 1, kind: 'rune-deposit', hash: 'd' } as KrayEvent),
    /rune-deposit needs/,
    'P2-04 default regtest enters the rune case — the book is open',
  )
  rejects(
    () => new KrayLedger(undefined, 'signet').applyLive(deposit(1)),
    /proof-mandatory activation a rune deposit/,
    'P2-05 default signet enters the rune case — the test universe rehearses the bakery',
  )

  rejects(() => pinned('regtest', MAX).applyLive(deposit(1)), DARK, 'P2-06 injected MAX on regtest is dark (lab pin)')
  rejects(() => pinned('main', MAX).applyLive(deposit(1)), DARK, 'P2-07 injected MAX on main is dark — the pin is still a real gate')

  const sk = createHash('sha256').update('rbook|a').digest()
  const A = btc.p2tr(_hexToBytes(_generateKeyPair(sk).publicKeyHex), undefined, NETWORKS.regtest).address!
  const L = new KrayLedger(undefined, 'regtest')
  L.applyLive({ seq: 1, kind: 'donate', hash: 'k', to: A, amount: '10' } as KrayEvent)
  ok(L.balanceOf(A) === 10n && L.conserves(), 'P2-08 a ₭ donate still applies on the open bench')

  ok(new KrayLedger(undefined, 'main').runeBookIsOpen(1), 'P2-09 default main door/reducer share open')
  ok(new KrayLedger(undefined, 'signet').runeBookIsOpen(1), 'P2-10 default signet door/reducer share open')
  ok(new KrayLedger(undefined, 'regtest').runeBookIsOpen(1), 'P2-11 default regtest door/reducer share open')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n╚═ ${pass} passed — Porta 2 is open on named nets; MAX is a lab pin. ₭\n`)
}
main()
