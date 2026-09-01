/**
 * PORTA 2 — RUNE BOOK OPEN: main is dark; signet and regtest stay open.
 *   node src/test/rune-book-open.test.ts
 *
 * Below the pin, rune-* and amm-* refuse before the case. ₭ donate is not
 * a rune-book kind. Signet/regtest default 0 = living benches do not fork (A3).
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
  console.log('\n╔═ PORTA 2 — RUNE BOOK OPEN: main dark, benches live ═╗\n')

  rejects(() => new KrayLedger(undefined, 'main').applyLive(deposit(1)), DARK, 'P2-01 default main refuses rune-deposit')
  rejects(() => new KrayLedger(undefined, 'main').applyLive(amm(1)), DARK, 'P2-02 default main refuses amm-add')
  rejects(
    () => new KrayLedger(undefined, 'main').applyLive({ seq: 1, kind: 'rune-exit', hash: 'e', from: 'x', runeId: '840000:1', amount: '1', l1Address: 'bc1q', fee: '1', nonce: 0 } as unknown as KrayEvent),
    DARK,
    'P2-03 default main refuses rune-exit',
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
  rejects(
    () => pinned('main', 0).applyLive(deposit(1)),
    /proof-mandatory activation a rune deposit/,
    'P2-07 main forced open still hits proof-mandatory — dark is the first gate, not a rewrite of the peg',
  )

  const sk = createHash('sha256').update('rbook|a').digest()
  const A = btc.p2tr(_hexToBytes(_generateKeyPair(sk).publicKeyHex), undefined, NETWORKS.regtest).address!
  const L = new KrayLedger(undefined, 'regtest')
  L.applyLive({ seq: 1, kind: 'donate', hash: 'k', to: A, amount: '10' } as KrayEvent)
  ok(L.balanceOf(A) === 10n && L.conserves(), 'P2-08 a ₭ donate still applies on the open bench')

  ok(!new KrayLedger(undefined, 'main').runeBookIsOpen(1), 'P2-09 default main door/reducer share dark')
  ok(new KrayLedger(undefined, 'signet').runeBookIsOpen(1), 'P2-10 default signet door/reducer share open')
  ok(new KrayLedger(undefined, 'regtest').runeBookIsOpen(1), 'P2-11 default regtest door/reducer share open')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n╚═ ${pass} passed — Porta 2 is dark on main; signet/regtest replay unchanged. ₭\n`)
}
main()
