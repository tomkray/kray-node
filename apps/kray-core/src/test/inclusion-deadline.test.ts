/**
 * THE SIGNED INCLUSION DEADLINE (ADR-3 · Slice C) — the OPT-IN clock a citizen signs to DEMAND when inclusion was
 * owed, so no one else can stamp it.
 *
 *   node src/test/inclusion-deadline.test.ts
 *
 * An act MAY carry `deadline` = the Bitcoin height by which it demands inclusion. It is OPT-IN — never mandatory:
 * a deadline does not move value (the Supreme Law does not require it), and the 3d verdict treats a missing
 * deadline as "nothing was owed". So the network runs with today's wallet from block 0, and a citizen adds a
 * deadline only to demand censorship protection. It rides INSIDE the signed bytes (appended `|deadline=D` at the
 * one requireSig choke point), so:
 *   1. A3 — an act WITHOUT a deadline signs byte-identically to a no-deadline act (today's wallet unchanged).
 *   2. OPT-IN — an act WITH or WITHOUT a deadline applies, on ANY seq (there is no deadline activation height;
 *      only the inclusion/window/nonce FOLD is activation-gated, the live-upgrade mechanism).
 *   3. the deadline is BOUND to the signature — signing D=100 but shipping D=200 fails (a stranger cannot stamp
 *      an aggressive deadline on someone else's act — the 3d false-CENSORED lever, closed here).
 *   4. whenever present it must be a positive integer height (0/negative/fractional refused).
 *   5. the deadline enters the act's IDENTITY — the inclusion leaf is keyFromSignedMessage(msg|deadline), exactly
 *      the key 3d's deadlineOf will read. donate (no requireSig) needs no deadline.
 *   6. MALLEABILITY (council) — the reserved-marker guard runs for EVERY signed act, ALWAYS: a free-text field
 *      that ABSORBS `|deadline=` is refused whether or not a deadline is set, so one signature never authorizes two.
 *
 * C carries the CLOCK. The censorship VERDICT is 3d. Nothing here is sold as 3d.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { DEFAULT_POT_TARGET_SATS } from '../protocol/pot.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, nameMessageV2 } from '../protocol/scheme.ts'
import { keyFromSignedMessage } from '../protocol/window-order.ts'
import { inclusionRoot as buildInclusionRoot } from '../protocol/inclusion-tree.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
const OFF = Number.MAX_SAFE_INTEGER

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const throws = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — did NOT throw') }
  catch (e) { const s = (e as Error).message; ok(re.test(s), m + (re.test(s) ? '' : ' — wrong error: ' + s)) }
}

interface Wallet { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`deadline|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B')
const sign = (m: string, w: Wallet) => _signKrayWallet(m, w.sk)

/** A ledger funded so A can pay; the inclusion FOLD activation is injected (deadline itself is never gated). */
function ledgerWith(inclusionActivation = OFF): KrayLedger {
  const led = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET, undefined, false, undefined, inclusionActivation)
  led.applyLive({ kind: 'donate', at: 0, to: A.addr, amount: '10000', seq: 1, prevHash: 'x', hash: 'y', outpoint: 'op:deadline:0' } as unknown as KrayEvent)
  return led
}
/** Build a transfer event. `carry` = the deadline written on the event; `signWith` = the deadline actually
 *  signed (defaults to carry — set differently to forge). */
function tx(nonce: number, seq: number, carry?: number, signWith: number | undefined = carry): KrayEvent {
  const base = transferMessage(NET, A.addr, B.addr, 10n, nonce)
  const signedMsg = signWith !== undefined ? `${base}|deadline=${signWith}` : base
  const e: Record<string, unknown> = { action: 'transfer', kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '10', fee: '1', nonce, publicKey: A.pk, signature: sign(signedMsg, A), scheme: 'kraywallet', seq, prevHash: 'x', hash: 'y' }
  if (carry !== undefined) e.deadline = carry
  return e as unknown as KrayEvent
}

function main() {
  console.log('\n╔═ THE SIGNED INCLUSION DEADLINE — the author’s OPT-IN clock for when inclusion was owed (ADR-3 Slice C) ═╗\n')

  // ── 1 · OPT-IN — with the fold ACTIVE, an act WITH or WITHOUT a deadline both apply (never mandatory) ──
  {
    const led = ledgerWith(0)      // inclusion fold active from genesis
    led.applyLive(tx(0, 2))        // NO deadline — accepted (opt-in, not refused)
    ok(led.nonceOf(A.addr) === 1, 'a deadline-LESS act APPLIES even with the fold active — the deadline is opt-in, never mandatory (today’s wallet runs unchanged)')
    led.applyLive(tx(1, 3, 850_000))   // WITH a deadline — also accepted
    ok(led.nonceOf(A.addr) === 2, 'a deadline-BEARING act from the same signer also applies — a citizen opts in to demand protection')
  }

  // ── 2 · A3 — a deadline-less act signs byte-identically to a no-deadline act, on any seq ──
  {
    const led = ledgerWith(OFF)    // fold OFF too — the pre-activation shape
    led.applyLive(tx(0, 2))        // no deadline — the bare message
    ok(led.nonceOf(A.addr) === 1, 'below the fold activation, a deadline-less act applies — its signed bytes are exactly the bare message (A3)')
  }

  // ── 3 · the deadline is BOUND to the signature — a shipped deadline that differs from the SIGNED one fails ──
  {
    const led = ledgerWith(0)
    throws(() => led.applyLive(tx(0, 2, 850_000, 900_000)), /signature does not verify/, 'signing deadline=900000 but shipping deadline=850000 FAILS verification — a stranger cannot re-stamp the deadline (the 3d false-CENSORED lever is closed)')
  }

  // ── 4 · a present deadline must be a positive integer height (0 / negative / fractional refused) ──
  {
    const led = ledgerWith(0)
    for (const bad of [0, -5, 1.5]) {
      throws(() => led.applyLive(tx(0, 2, bad)), /deadline, when present, must be a positive integer/, `a deadline of ${bad} is REFUSED — not a valid Bitcoin height`)
    }
  }

  // ── 5 · the deadline enters the act IDENTITY — the Slice-A leaf is keyFromSignedMessage(msg|deadline) ──
  {
    const led = ledgerWith(0)      // inclusion active — the leaf is collected
    led.applyLive(tx(0, 2, 850_000))
    const expectedKey = keyFromSignedMessage(`${transferMessage(NET, A.addr, B.addr, 10n, 0)}|deadline=850000`)
    ok(led.inclusionRoot() === buildInclusionRoot([expectedKey]), 'the inclusion leaf is the hash of the signed message INCLUDING the deadline — exactly the key 3d will read, so C and 3d compose')
    // and a no-deadline act keys WITHOUT the suffix — proving the suffix is the only difference
    const ledB = ledgerWith(0)
    ledB.applyLive(tx(0, 2))
    ok(ledB.inclusionRoot() === buildInclusionRoot([keyFromSignedMessage(transferMessage(NET, A.addr, B.addr, 10n, 0))]), 'a deadline-less act keys on the bare message — the |deadline suffix is the sole, append-only difference')
  }

  // ── 6 · OPT-IN is UNGATED — a deadline-bearing act applies even BELOW the fold activation (no "forbidden") ──
  {
    const led = ledgerWith(OFF)    // fold OFF — a deadline is STILL allowed (opt-in has no activation height)
    led.applyLive(tx(0, 2, 850_000))
    ok(led.nonceOf(A.addr) === 1, 'a deadline is allowed on ANY seq — opt-in is never gated (its verdict is simply inert until the fold activates, but the demand is always signable)')
  }

  // ── 7 · MALLEABILITY (council) — the reserved-marker guard runs ALWAYS, gate or no gate ──
  // The attack: `…|name=Zoe|deadline=D` (deadline set) is byte-identical to name='Zoe|deadline=D' with NO
  // deadline, so one signature would authorize two acts. The guard refuses ANY signed message that already
  // contains the marker — with a deadline set OR not, and with the fold ON or OFF — restoring injectivity.
  {
    const badName = 'Zoe|deadline=850000'
    // (a) with the marker absorbed AND a deadline set, fold ACTIVE → refused
    const led = ledgerWith(0)
    const eWith = { kind: 'name', at: 0, from: A.addr, name: badName, nonce: 0, deadline: 850_000, publicKey: A.pk, signature: sign(`${nameMessageV2(NET, A.addr, 0, badName)}|deadline=850000`, A), scheme: 'kraywallet', seq: 2, prevHash: 'x', hash: 'y' }
    throws(() => led.applyLive(eWith as unknown as KrayEvent), /reserved \|deadline= marker/, 'a name that ABSORBS the |deadline= marker (deadline set) is REFUSED — one signature can never authorize two acts')
    // (b) the same absorption WITHOUT a deadline field, fold OFF → STILL refused (the guard is unconditional)
    const led2 = ledgerWith(OFF)
    const eNo = { kind: 'name', at: 0, from: A.addr, name: badName, nonce: 0, publicKey: A.pk, signature: sign(nameMessageV2(NET, A.addr, 0, badName), A), scheme: 'kraywallet', seq: 2, prevHash: 'x', hash: 'y' }
    throws(() => led2.applyLive(eNo as unknown as KrayEvent), /reserved \|deadline= marker/, 'the SAME absorbed marker with NO deadline field and the fold OFF is STILL refused — the guard is UNCONDITIONAL (opt-in’s load-bearing invariant)')
  }

  // ── 8 · donate signs via no requireSig, so it needs NO deadline ──
  {
    const led = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET, undefined, false, undefined, 0)   // fold active
    led.applyLive({ kind: 'donate', at: 0, to: A.addr, amount: '5000', seq: 1, prevHash: 'x', hash: 'y', outpoint: 'op:deadline:donate' } as unknown as KrayEvent)
    ok(true, 'a donate (no requireSig) applies with no deadline — pin 2 holds for the clock too')
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the deadline is the author’s own OPT-IN signed clock: always signable, never mandatory, bound to the signature, and the marker guard is unconditional. The verdict is 3d. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
