/**
 * THE WINDOW COMMITMENT IN THE CASCADE (ADR-3 · Slice 3d-a) — the anchored fact 3d's verdict rests on.
 *
 *   node src/test/window-commitment.test.ts
 *
 * 3d can rule "the writer left my act out" only if a stranger can hold, FROM THE ANCHOR, the statement "at
 * Bitcoin seal height H the cumulative inclusion root was R". This slice records windowCommitment(H, R) at every
 * seal once the inclusion regime is active and folds their SMT into the cascade root. It pins:
 *   1. A3 — below activation a seal needs no Bitcoin height and nothing is folded (the past is byte-identical;
 *      the Slice-A golden already proves the activation-OFF cascade root is unchanged).
 *   2. AT/AFTER activation a seal MUST carry its Bitcoin height (l1Height), or it is refused.
 *   3. the recorded commitment is EXACTLY windowCommitment(H, cumulative inclusion root at that seal) — the same
 *      value 3d's CensorshipClaim.anchoredCommitment re-derives — and it is provably a MEMBER of the folded root.
 *   4. determinism — a fresh replay reproduces the identical window root and cascade root.
 *
 * This makes 3d's anchoredCommitment an ANCHORED fact instead of an input. It does NOT by itself judge omission:
 * the availability witness (the act was public by its deadline) is still the honest 3b/ADR-2 dependency. Not 3d.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { DEFAULT_POT_TARGET_SATS } from '../protocol/pot.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage } from '../protocol/scheme.ts'
import { keyFromSignedMessage } from '../protocol/window-order.ts'
import { inclusionRoot as buildInclusionRoot, EMPTY_ROOT, proveKey, verifyProof } from '../protocol/inclusion-tree.ts'
import { windowCommitment } from '../protocol/censorship-evidence.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
const OFF = Number.MAX_SAFE_INTEGER
const TXID = 'a'.repeat(64)   // a valid-format Bitcoin txid (the reducer trusts the door's SPV; here we replay)
const H_BTC = 850_000         // the seal's Bitcoin height

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const throws = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — did NOT throw') }
  catch (e) { const s = (e as Error).message; ok(re.test(s), m + (re.test(s) ? '' : ' — wrong error: ' + s)) }
}

interface Wallet { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`window|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B')
const sign = (m: string, w: Wallet) => _signKrayWallet(m, w.sk)
const transferMsg = transferMessage(NET, A.addr, B.addr, 10n, 0)

/** donate → one signed transfer (an included act) → ready for a seal at seq 3. Deadline stays OFF (default MAX),
 *  so the pre-C transfer shape is used and inclusion (Slice A) is the only regime under test. */
function base(inclusionActivation: number): KrayLedger {
  const led = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET, undefined, false, undefined, inclusionActivation)
  led.applyLive({ kind: 'donate', at: 0, to: A.addr, amount: '10000', seq: 1, prevHash: 'x', hash: 'y', outpoint: 'op:wc:0' } as unknown as KrayEvent)
  led.applyLive({ action: 'transfer', kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 0, publicKey: A.pk, signature: sign(transferMsg, A), scheme: 'kraywallet', seq: 2, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
  return led
}
// the seal binds to the cascade root its anchor commits (l1Root); in these synchronous tests the anchor commits
// the root JUST BEFORE the seal (seq_anchor == seq-1), so l1Root = led.cascadeRoot() captured at call time.
const sealEvent = (led: KrayLedger, withHeight: boolean) => ({ kind: 'seal', at: 0, l1Txid: TXID, ...(withHeight ? { l1Height: H_BTC, l1Root: led.cascadeRoot(), l1BlockNumber: 0 } : {}), seq: 3, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)

function main() {
  console.log('\n╔═ THE WINDOW COMMITMENT IN THE CASCADE — the anchored fact 3d rests on (ADR-3 Slice 3d-a) ═╗\n')

  // ── 1 · A3 — below activation a seal needs no Bitcoin height, and nothing is folded ──
  {
    const led = base(OFF)
    led.applyLive(sealEvent(led, false))   // a classic seal, no l1Height — the pre-3d-a shape
    ok(led.windowSealsRoot() === EMPTY_ROOT, 'below activation a seal records NO window commitment — the window root stays EMPTY (nothing folds, so the past is byte-identical; Slice-A golden pins the OFF cascade root)')
  }

  // ── 2 · at/after activation a seal MUST carry its Bitcoin height ──
  {
    const led = base(0)
    throws(() => led.applyLive(sealEvent(led, false)), /must carry its Bitcoin height|l1Height/, 'after activation a seal WITHOUT its Bitcoin height is REFUSED — 3d-a has no clock to bind the window to')
    led.applyLive(sealEvent(led, true))
    ok(led.windowSealsRoot() !== EMPTY_ROOT, 'after activation a seal WITH its Bitcoin height records a window commitment — the window root is non-empty')
  }

  // ── 2b · at/after activation a seal MUST also carry l1Root AND l1BlockNumber (verify-council #3) — the follower
  //          binds the Bitcoin height THROUGH l1BlockNumber, so a seal it cannot verify must FAIL-STOP replay here ──
  {
    const led = base(0)
    throws(() => led.applyLive({ kind: 'seal', at: 0, l1Txid: TXID, l1Height: H_BTC, l1BlockNumber: 0, seq: 3, prevHash: 'x', hash: 'y' } as unknown as KrayEvent), /must carry l1Root/, 'a seal with its height but NO l1Root is REFUSED — the height must bind to the inclusion set its anchor committed')
    const led2 = base(0)
    throws(() => led2.applyLive({ kind: 'seal', at: 0, l1Txid: TXID, l1Height: H_BTC, l1Root: led2.cascadeRoot(), seq: 3, prevHash: 'x', hash: 'y' } as unknown as KrayEvent), /must carry l1BlockNumber/, 'a seal with its height+root but NO l1BlockNumber is REFUSED — else the follower would silently SKIP it and a fabricated height would enter unverified (the HIGH the verify council caught)')
  }

  // ── 3 · the recorded commitment is EXACTLY windowCommitment(H, cumulative inclusion root) + provably a member ──
  {
    const led = base(0)
    const rAtSeal = led.inclusionRoot()   // the cumulative root just before the seal — the transfer is the only leaf
    ok(rAtSeal === buildInclusionRoot([keyFromSignedMessage(transferMsg)]), 'sanity: the cumulative inclusion root at the seal is the one signed act')
    led.applyLive(sealEvent(led, true))
    const wc = windowCommitment(H_BTC, rAtSeal)   // the value 3d's CensorshipClaim.anchoredCommitment re-derives
    ok(led.windowSealsRoot() === buildInclusionRoot([wc]), 'the folded window root is the SMT of windowCommitment(H, R) — the SAME function 3d re-derives, so C→A→3d-a→3d compose on one value')
    const proof = proveKey([wc], wc)
    ok(verifyProof(led.windowSealsRoot(), wc, proof) === 'in', 'windowCommitment(H, R) PROVES IN against the folded window root — a stranger can show it was anchored (the anchoredCommitment 3d needs is now a FACT, not an input)')
    // a DIFFERENT height or a DIFFERENT root yields a different commitment → not a member (no false anchoring)
    ok(verifyProof(led.windowSealsRoot(), windowCommitment(H_BTC + 1, rAtSeal), proveKey([wc], windowCommitment(H_BTC + 1, rAtSeal))) === 'out', 'a commitment for a DIFFERENT seal height is provably NOT anchored — the binding is exact on height')
    ok(verifyProof(led.windowSealsRoot(), windowCommitment(H_BTC, EMPTY_ROOT), proveKey([wc], windowCommitment(H_BTC, EMPTY_ROOT))) === 'out', 'a commitment for the SAME height but a DIFFERENT (empty) root is provably NOT anchored — the binding is exact on the ROOT too')
  }

  // ── 4 · determinism — a fresh replay reproduces the identical window root AND cascade root ──
  {
    const l1Root = base(0).cascadeRoot()   // the root the seal's anchor commits (seq_anchor = 2, synchronous)
    const events = [
      { kind: 'donate', at: 0, to: A.addr, amount: '10000', seq: 1, prevHash: 'x', hash: 'y', outpoint: 'op:wc:0' },
      { action: 'transfer', kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 0, publicKey: A.pk, signature: sign(transferMsg, A), scheme: 'kraywallet', seq: 2, prevHash: 'x', hash: 'y' },
      { kind: 'seal', at: 0, l1Txid: TXID, l1Height: H_BTC, l1Root, l1BlockNumber: 0, seq: 3, prevHash: 'x', hash: 'y' },
    ] as unknown as KrayEvent[]
    const build = () => { const l = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET, undefined, false, undefined, 0); for (const e of events) l.applyLive(e); return l }
    const a = build(), b = build()
    ok(a.windowSealsRoot() === b.windowSealsRoot() && a.cascadeRoot() === b.cascadeRoot(), 'a fresh replay reproduces the identical window root and cascade root — door AND reducer agree (the anchored fact is re-derivable)')
  }

  // ── 5 · the window root REALLY reaches the cascade — two seals identical but for their Bitcoin height differ ──
  {
    const rootFor = (height: number) => { const l = base(0); l.applyLive({ kind: 'seal', at: 0, l1Txid: TXID, l1Height: height, l1Root: l.cascadeRoot(), l1BlockNumber: 0, seq: 3, prevHash: 'x', hash: 'y' } as unknown as KrayEvent); return l.cascadeRoot() }
    ok(rootFor(850_000) !== rootFor(860_000), 'two seals differing ONLY in Bitcoin height yield DIFFERENT cascade roots — l1Height provably enters the ANCHORED commitment via the window fold (not a dead field)')
  }

  // ── 6 · MONOTONICITY (council) — a seal height BELOW the previous is REFUSED ──
  {
    const led = base(0)
    led.applyLive({ kind: 'seal', at: 0, l1Txid: 'b'.repeat(64), l1Height: 860_000, l1Root: led.cascadeRoot(), l1BlockNumber: 0, seq: 3, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
    throws(() => led.applyLive({ kind: 'seal', at: 0, l1Txid: 'c'.repeat(64), l1Height: 850_000, seq: 4, prevHash: 'x', hash: 'y' } as unknown as KrayEvent), /non-decreasing|below the last seal/, 'a seal whose Bitcoin height is BELOW the previous one is REFUSED — the writer cannot anchor a low-height subset root after a high-height one (the false-CENSORED lever is closed)')
  }

  // ── 7 · SAME-HEIGHT FINALITY (council) — two seals in one block keep only the FINAL, most-inclusive root ──
  {
    const led = base(0)   // inclusion after seq 2 = {transfer nonce 0}
    led.applyLive({ kind: 'seal', at: 0, l1Txid: 'd'.repeat(64), l1Height: H_BTC, l1Root: led.cascadeRoot(), l1BlockNumber: 0, seq: 3, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
    const r1 = led.inclusionRoot()
    const t1 = transferMessage(NET, A.addr, B.addr, 10n, 1)
    led.applyLive({ action: 'transfer', kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 1, publicKey: A.pk, signature: sign(t1, A), scheme: 'kraywallet', seq: 4, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
    led.applyLive({ kind: 'seal', at: 0, l1Txid: 'e'.repeat(64), l1Height: H_BTC, l1Root: led.cascadeRoot(), l1BlockNumber: 0, seq: 5, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)   // SAME height, more-inclusive root — REPLACES
    const r2 = led.inclusionRoot()
    ok(r2 !== r1, 'sanity: the act between the two same-height seals grew the inclusion root')
    ok(led.windowSealsRoot() === buildInclusionRoot([windowCommitment(H_BTC, r2)]), 'same-height FINALITY: only the LATER, most-inclusive root at height H is committed — the final root wins')
    const wcSubset = windowCommitment(H_BTC, r1)
    ok(verifyProof(led.windowSealsRoot(), wcSubset, proveKey([windowCommitment(H_BTC, r2)], wcSubset)) === 'out', 'the EARLIER subset root at the SAME height is provably NOT anchored — an attacker cannot convict an honest writer from it')
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — every seal binds its Bitcoin height to the inclusion root, anchored; 3d's commitment is a fact. The availability witness is still 3b/ADR-2. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
