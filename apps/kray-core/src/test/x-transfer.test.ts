/**
 * Ӿ TRANSFER (slice 2) — the transferable book + its GATED fold into the cascade root. Prove by breaking:
 *   node src/test/x-transfer.test.ts
 *
 *   XT-01  DORMANT by default — below the activation seq, x-send is REFUSED (HALT); no Ӿ moves before the network ratifies
 *   XT-02  GENESIS-SAFE — a dormant ledger folds NO xRoot: on the SAME burns its root differs from an active ledger's
 *          (the gate changes the root only at activation); the dormant ledger conserves and its root is the pre-Ӿ shape
 *   XT-03  the mint credits xBalance — xBalanceOf == xMintedOf until the first transfer
 *   XT-04  ACTIVE — at/after activation a SIGNED x-send moves xBalance (A→B); the lifetime xMinted record is UNTOUCHED
 *   XT-05  CONSERVED — Σ xBalance == burned after the transfer (moving conserves; the ₭ fee funds the validators)
 *   XT-06  HOSTILE — wrong-key sig / a ₭ signature replayed as Ӿ / overspend / self-send / wrong fee all REFUSED, book intact
 *   XT-07  IN THE ROOT — the cascade root CHANGES when Ӿ moves; a fresh ledger replays xBalance + root byte-exact
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, inscribeMessageV2, transferMessage, xSendMessage } from '../protocol/scheme.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
function wallet(tag: string) {
  const sk = createHash('sha256').update('x-transfer|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B')

/** a ledger with a chosen Ӿ-transfer activation seq (MAX_SAFE_INTEGER = dormant) + an auto-seq apply helper */
function ledger(xActSeq: number) {
  const L = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, xActSeq)
  const J: KrayEvent[] = []
  const ap = (e: Record<string, unknown>) => { const ev = { ...e, seq: J.length + 1 } as unknown as KrayEvent; L.applyLive(ev); J.push(ev); return ev }
  return { L, J, ap }
}
function fund(ap: (e: Record<string, unknown>) => KrayEvent) {
  ap({ kind: 'donate', hash: 'dA', to: A.addr, amount: '100' })
  ap({ kind: 'donate', hash: 'dB', to: B.addr, amount: '20' })
}
function inscribe(L: KrayLedger, ap: (e: Record<string, unknown>) => KrayEvent, w: typeof A, tag: string) {
  const ch = sha256hex(tag), n = L.nonceOf(w.addr)
  return ap({ kind: 'inscribe', hash: tag, from: w.addr, contentHash: ch, contentType: 'text/plain', size: 8, nonce: n, publicKey: w.pk, signature: _signKrayWallet(inscribeMessageV2(NET, w.addr, ch, 'text/plain', 8, undefined, n), w.sk), scheme: 'kraywallet' })
}
function xsendEv(L: KrayLedger, from: typeof A, to: string, amt: number, opts: { nonce?: number; sig?: string; fee?: string; tag?: string } = {}) {
  const n = opts.nonce !== undefined ? opts.nonce : L.nonceOf(from.addr)
  const sig = opts.sig || _signKrayWallet(xSendMessage(NET, from.addr, to, BigInt(amt), n), from.sk)
  return { kind: 'x-send', hash: sha256hex('xs|' + from.addr + '|' + to + '|' + amt + '|' + n + '|' + (opts.tag || '')), from: from.addr, to, amount: String(amt), fee: opts.fee || '1', nonce: n, publicKey: from.pk, signature: sig, scheme: 'kraywallet' } as Record<string, unknown>
}

function main() {
  console.log('\n╔═ Ӿ TRANSFER — the token moves by signature, folds into the root, dormant until ratified ═╗\n')

  console.log('XT-01 — DORMANT by default: below activation, x-send is refused')
  const D = ledger(Number.MAX_SAFE_INTEGER)
  fund(D.ap); inscribe(D.L, D.ap, A, 'd0')     // A burns 1 ₭ → 1 Ӿ minted
  ok(D.L.xMintedOf(A.addr) === 1n && D.L.xBalanceOf(A.addr) === 1n, 'the mint is live even while transfers sleep — A has 1 Ӿ')
  rejects(() => D.ap(xsendEv(D.L, A, B.addr, 1)), /not active|dormant/i, 'below the activation seq, x-send HALTS — no Ӿ moves')
  ok(D.L.conserves(), 'the dormant ledger conserves (Σ xBalance == burned)')

  console.log('XT-02 — GENESIS-SAFE: the dormant ledger folds no xRoot (the gate changes the root only at activation)')
  const G = ledger(1)                          // Ӿ active from seq 1
  fund(G.ap); inscribe(G.L, G.ap, A, 'd0')     // the SAME applied journal as D (fund + one inscribe)
  ok(D.L.appliedSeq === G.L.appliedSeq, 'both ledgers applied the same journal (the rejected x-send was never journaled)')
  ok(D.L.cascadeRoot() !== G.L.cascadeRoot(), 'active folds xRoot → a different root from the dormant one; below activation the root is the pre-Ӿ shape')

  console.log('XT-03 — the mint credits xBalance (== xMinted until the first transfer)')
  const { L, J, ap } = ledger(1)               // active
  fund(ap); inscribe(L, ap, A, 'a0'); inscribe(L, ap, A, 'a1')   // A burns 2 ₭ → 2 Ӿ
  ok(L.xBalanceOf(A.addr) === 2n && L.xMintedOf(A.addr) === 2n, 'A minted 2 Ӿ and its spendable balance is 2')

  console.log('XT-04 — a SIGNED x-send moves the spendable book; the lifetime mint record is untouched')
  const rootBefore = L.cascadeRoot()
  ap(xsendEv(L, A, B.addr, 1))
  ok(L.xBalanceOf(A.addr) === 1n && L.xBalanceOf(B.addr) === 1n, 'A sent 1 Ӿ → A 1, B 1 (spendable)')
  ok(L.xMintedOf(A.addr) === 2n && L.xMintedOf(B.addr) === 0n, 'the lifetime xMinted record is UNTOUCHED — A still minted 2, B minted 0')
  ok(L.balanceOf(A.addr) === 100n - 2n - 1n, 'A paid the eternal 1-₭ fee for the Ӿ move')

  console.log('XT-05 — conserved after the transfer')
  ok(L.conserves(), 'Σ xBalance == burned still holds (moving conserved the token; ₭ fee went to the validators)')

  console.log('XT-06 — hostile: every forgery / overspend / bad shape refused, the book intact')
  const sSeq = () => J.length + 1
  rejects(() => L.applyLive({ ...xsendEv(L, A, B.addr, 1, { tag: 'wk' }), seq: sSeq(), signature: _signKrayWallet(xSendMessage(NET, A.addr, B.addr, 1n, L.nonceOf(A.addr)), B.sk) } as KrayEvent), /signature/i, 'a wrong-key signature is refused')
  rejects(() => L.applyLive({ ...xsendEv(L, A, B.addr, 1, { tag: 'kd' }), seq: sSeq(), signature: _signKrayWallet(transferMessage(NET, A.addr, B.addr, 1n, L.nonceOf(A.addr)), A.sk) } as KrayEvent), /signature/i, 'a ₭-transfer signature cannot move Ӿ — the domains are separated')
  rejects(() => L.applyLive({ ...xsendEv(L, A, B.addr, 9999, { tag: 'os' }), seq: sSeq() } as KrayEvent), /insufficient Ӿ/i, 'overspending Ӿ is refused')
  rejects(() => L.applyLive({ ...xsendEv(L, A, A.addr, 1, { tag: 'ss' }), seq: sSeq() } as KrayEvent), /two different parties/i, 'a self-send is refused')
  rejects(() => L.applyLive({ ...xsendEv(L, A, B.addr, 1, { tag: 'wf', fee: '2' }), seq: sSeq() } as KrayEvent), /1-₭ fee/i, 'a wrong fee is refused')
  ok(L.xBalanceOf(A.addr) === 1n && L.xBalanceOf(B.addr) === 1n && L.conserves(), 'every refusal left the Ӿ book byte-identical')

  console.log('XT-07 — in the root + replay byte-exact')
  ok(L.cascadeRoot() !== rootBefore, 'the cascade root CHANGED when Ӿ moved — the xRoot folded the new balances')
  const L2 = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, 1)
  for (const e of J) L2.applyLive(e)
  ok(L2.xBalanceOf(A.addr) === 1n && L2.xBalanceOf(B.addr) === 1n, 'replay re-derives every wallet\'s spendable Ӿ, byte-exact')
  ok(L2.cascadeRoot() === L.cascadeRoot(), 'replay re-derives the cascade root (Ӿ book included) byte-exact')
  ok(L2.conserves(), 'replay conserves — the Ӿ book travels with the journal')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — Ӿ TRANSFER HOLDS: dormant until ratified (HALT below activation, byte-identical root), then Ӿ moves only by its own signature, conserved on the tripwire, folded into the anchored root, replay-exact. Ӿ→Ӿ 🔁`)
}
main()
