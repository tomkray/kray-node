/**
 * THE NONCE FOLD, IN THE LEDGER (ADR-3 · the eligibility opening wired) — the reducer maintains the account
 * nonce map from genesis, stamps each advance with a 0 sentinel, promotes it to the real Bitcoin height at the
 * next seal (sticky), and folds the root into the cascade ONLY post-activation.
 *
 *   node src/test/nonce-fold.test.ts
 *
 * This proves the WIRING (sub-slice 3), the counterpart to nonce-map.test.ts (the pure primitive): that the
 * ledger's own nonceRoot is exactly what a light censorship verifier needs — real nonces, deadline-binding
 * heights, sticky across seals — and that below activation the cascade is byte-identical (A3).
 */
import { createHash } from 'node:crypto'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage } from '../protocol/scheme.ts'
import { verifyNonceProof } from '../protocol/nonce-map.ts'
import * as btc from '@scure/btc-signer'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const NET = 'regtest', BNET = toBtcNet(NET)
const mk = (t: string) => { const sk = createHash('sha256').update('nf|' + t).digest(); const pk = _generateKeyPair(sk).publicKeyHex; return { addr: btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[BNET]).address!, sk, pk } }

const A = mk('A'), B = mk('B'), C = mk('C')
let seq = 0
const next = () => ++seq

function main() {
  console.log('\n╔═ THE NONCE FOLD, IN THE LEDGER — sentinel → sticky Bitcoin height, folded post-activation (ADR-3) ═╗\n')

  const led = new KrayLedger(undefined, NET, undefined, false, undefined, 0)   // inclusion + eligibility ACTIVE from genesis
  const donate = (to: string) => led.applyLive({ kind: 'donate', at: 0, to, amount: '10000', seq: next(), prevHash: 'x', hash: 'y', outpoint: `nf:donate:${to.slice(-6)}:${seq}` } as unknown as KrayEvent)
  const transfer = (w: typeof A, to: typeof A, nonce: number) => led.applyLive({ action: 'transfer', kind: 'transfer', at: 0, from: w.addr, to: to.addr, amount: '10', fee: '1', nonce, publicKey: w.pk, signature: _signKrayWallet(transferMessage(NET, w.addr, to.addr, 10n, nonce), w.sk), scheme: 'kraywallet', seq: next(), prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
  const seal = (h: number) => led.applyLive({ kind: 'seal', at: 0, l1Txid: h.toString(16).padStart(64, '0'), l1Height: h, l1Root: led.cascadeRoot(), l1BlockNumber: 0, seq: next(), prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
  const proven = (addr: string) => verifyNonceProof(led.nonceMapRoot(), addr, led.proveNonce(addr))

  donate(A.addr); donate(C.addr)

  // ── an unseen account is absent ⇒ (0,0) ──
  ok(JSON.stringify(proven(B.addr)) === JSON.stringify({ nonce: 0, height: 0 }), 'a never-acted account proves (0,0) from the ledger nonce root')

  // ── an advance BEFORE any seal carries the 0 SENTINEL (unanchored) ──
  transfer(A, B, 0)   // A → nonce 1
  transfer(C, B, 0)   // C → nonce 1
  ok(JSON.stringify(proven(A.addr)) === JSON.stringify({ nonce: 1, height: 0 }), 'an advance before a seal carries the 0 sentinel (unanchored — a mid-stream opening is acquit-biased, never a false convict)')

  // ── the SEAL promotes every pending advance to its Bitcoin height ──
  seal(850_000)
  ok(JSON.stringify(proven(A.addr)) === JSON.stringify({ nonce: 1, height: 850_000 }), 'the seal PROMOTES A’s nonce 1 to the real seal height 850000 (the deadline-binding stamp)')
  ok(JSON.stringify(proven(C.addr)) === JSON.stringify({ nonce: 1, height: 850_000 }), 'and C’s nonce 1 likewise')

  // ── a NEW advance re-arms the sentinel; C, not re-advanced, stays STICKY at its first-anchor height ──
  transfer(A, B, 1)   // A → nonce 2 (sentinel again)
  ok(JSON.stringify(proven(A.addr)) === JSON.stringify({ nonce: 2, height: 0 }), 'a further advance re-arms the 0 sentinel for the NEW nonce')
  seal(850_010)
  ok(JSON.stringify(proven(A.addr)) === JSON.stringify({ nonce: 2, height: 850_010 }), 'the next seal stamps A’s nonce 2 with 850010 (its own first-anchor height)')
  ok(JSON.stringify(proven(C.addr)) === JSON.stringify({ nonce: 1, height: 850_000 }), 'C, not re-advanced, KEEPS its 850000 stamp across the later seal — the stamp is STICKY (first-anchor, per nonce value)')

  // ── the nonce root FOLDS into the cascade only post-activation (A3 below it) ──
  ok(led.cascadeParts().nonceRoot === led.nonceMapRoot() && led.cascadeParts().nonceRoot !== undefined, 'the ACTIVE ledger folds nonceRoot into cascadeParts (= its live nonce map root)')
  {
    const off = new KrayLedger(undefined, NET)   // default activation = MAX (OFF)
    off.applyLive({ kind: 'donate', at: 0, to: A.addr, amount: '10000', seq: 1, prevHash: 'x', hash: 'y', outpoint: 'off:donate:0' } as unknown as KrayEvent)
    off.applyLive({ action: 'transfer', kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 0, publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, B.addr, 10n, 0), A.sk), scheme: 'kraywallet', seq: 2, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
    ok(off.cascadeParts().nonceRoot === undefined, 'below activation the cascade has NO nonceRoot — the pre-A format is byte-identical (A3), even though the ledger still maintains the map underneath')
  }

  // ── REPLAY DETERMINISM — a fresh ledger replaying the same journal derives the identical nonce root ──
  {
    const replay = new KrayLedger(undefined, NET, undefined, false, undefined, 0)
    replay.applyLive({ kind: 'donate', at: 0, to: A.addr, amount: '10000', seq: 1, prevHash: 'x', hash: 'y', outpoint: `nf:donate:${A.addr.slice(-6)}:1` } as unknown as KrayEvent)
    replay.applyLive({ kind: 'donate', at: 0, to: C.addr, amount: '10000', seq: 2, prevHash: 'x', hash: 'y', outpoint: `nf:donate:${C.addr.slice(-6)}:2` } as unknown as KrayEvent)
    replay.applyLive({ action: 'transfer', kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 0, publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, B.addr, 10n, 0), A.sk), scheme: 'kraywallet', seq: 3, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
    replay.applyLive({ action: 'transfer', kind: 'transfer', at: 0, from: C.addr, to: B.addr, amount: '10', fee: '1', nonce: 0, publicKey: C.pk, signature: _signKrayWallet(transferMessage(NET, C.addr, B.addr, 10n, 0), C.sk), scheme: 'kraywallet', seq: 4, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
    replay.applyLive({ kind: 'seal', at: 0, l1Txid: (850_000).toString(16).padStart(64, '0'), l1Height: 850_000, l1Root: replay.cascadeRoot(), l1BlockNumber: 0, seq: 5, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
    replay.applyLive({ action: 'transfer', kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 1, publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, B.addr, 10n, 1), A.sk), scheme: 'kraywallet', seq: 6, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
    replay.applyLive({ kind: 'seal', at: 0, l1Txid: (850_010).toString(16).padStart(64, '0'), l1Height: 850_010, l1Root: replay.cascadeRoot(), l1BlockNumber: 0, seq: 7, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
    ok(replay.nonceMapRoot() === led.nonceMapRoot(), 'a fresh ledger replaying the same journal derives the BYTE-IDENTICAL nonce root — the map is a pure function of the journal (enforced at door AND replay)')
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the ledger stamps each nonce with the first seal that anchored it, keeps it sticky, and folds the root only post-activation; the eligibility opening a light verifier reads is a pure function of the journal. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
