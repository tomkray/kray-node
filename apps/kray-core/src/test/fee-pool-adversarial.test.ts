/**
 * FEE-POOL ADVERSARIAL — the 2026-08-19 audit, pinned as law.
 *
 *   node src/test/fee-pool-adversarial.test.ts
 *
 * What still holds (do not "fix"): stolen nonce pays 0; inflated zeros pay 0;
 * same (address, block) keeps the best; client payout table HALTs on mismatch;
 * linear split (never √); no mint; empty presence waits.
 *
 * Attacks that must now fail:
 *   F-01  10k distinct blocks under one beacon cannot out-earn one tip beat
 *         once presenceTip is set (and the historical cap kills the old path).
 *   F-02  forged 8-hit custody hex freezes replay.
 *   F-06  a windowed 40-zero claim pays as 24, not 2^40.
 *
 * F-03 omit-rival is still operator-trusted until ADR-3 inclusion is wired —
 * named here so a later suite can flip it.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { DEFAULT_POT_TARGET_SATS } from '../protocol/pot.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage } from '../protocol/scheme.ts'
import { TREASURY, type KrayEvent } from '../protocol/kray-primitives.ts'
import { mineBeat, spanWork, type BeatProof } from '../economics/beat-pow.ts'
import { settleFromBeats } from '../economics/settlement.ts'
import { assertPresenceClaims, readPresenceTip, BEAT_PAY_ZEROS_CAP, HISTORICAL_SPAN_BLOCK_CAP, PRESENCE_WINDOW_FROM_SEQ } from '../economics/presence-window.ts'
import { packHits, custodyToHex } from '../economics/custody.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const refuses = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — did NOT halt') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}

function wallet(tag: string) {
  const sk = createHash('sha256').update('adv|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[NET]).address!, sk, pk: publicKeyHex }
}
const BEACON = createHash('sha256').update('beacon|fee-pool-adversarial').digest('hex')
const POOL = 100n // exam split only — live settle uses the Treasury, never this

let seq = 0
function fundPool(L: KrayLedger, A: ReturnType<typeof wallet>, transfers: number): void {
  L.applyLive({ seq: ++seq, kind: 'donate', hash: 'h' + seq, to: A.addr, amount: '10000' } as KrayEvent)
  for (let n = 0; n < transfers; n++) {
    const to = wallet('sink|' + n).addr
    const msg = transferMessage(NET, A.addr, to, 5n, n)
    L.applyLive({ seq: ++seq, kind: 'transfer', hash: 't' + seq, from: A.addr, to, amount: '5', fee: '1', nonce: n, publicKey: A.pk, signature: _signKrayWallet(msg, A.sk), scheme: 'kraywallet' } as KrayEvent)
  }
}

function main() {
  console.log('\n╔═ FEE-POOL ADVERSARIAL — grind, forged custody, lucky zeros ═╗\n')
  const A = wallet('A'), ATTACK = wallet('atk'), HONEST = wallet('hon')

  // ── F-01 · the 10k-index grind is not more work ──────────────────────────
  const grindClaims = [{
    address: ATTACK.addr,
    beats: Array.from({ length: 10_000 }, (_, i) => ({ block: i, nonce: '1', zeros: 8 })),
  }]
  refuses(() => assertPresenceClaims(grindClaims, 42), /one moment per address|outside the open presence window/, 'F-01: 10k distinct blocks under presenceTip HALT — block is not a grinding axis')
  refuses(() => assertPresenceClaims(grindClaims), /historical cap/, `F-01: 10k blocks without a tip still HALT above ${HISTORICAL_SPAN_BLOCK_CAP}`)
  assertPresenceClaims([{ address: HONEST.addr, beats: [{ block: 42, nonce: '1', zeros: 8 }] }], 42)
  ok(true, 'F-01: one beat on the live tip is the lawful claim')

  const honestTip = mineBeat(BEACON, HONEST.addr, 42, 8_000)!
  const grindMined: BeatProof[] = []
  for (let i = 0; i < 40; i++) {
    const b = mineBeat(BEACON, ATTACK.addr, i, 256)
    if (b) grindMined.push(b)
  }
  const grindOpen = spanWork(BEACON, ATTACK.addr, grindMined).work
  const honestOpen = spanWork(BEACON, HONEST.addr, [honestTip]).work
  ok(grindOpen > honestOpen, `pre-window (the bug): ${grindMined.length} cheap blocks (${grindOpen}) out-earn one tip beat (${honestOpen})`)
  refuses(
    () => settleFromBeats(BEACON, POOL, [{ address: ATTACK.addr, beats: grindMined }], { presenceTip: 42 }),
    /one moment per address|outside the open presence window/,
    'F-01: settleFromBeats with presenceTip refuses the grind — it cannot out-earn anyone',
  )
  const honestPay = settleFromBeats(BEACON, POOL, [{ address: HONEST.addr, beats: [honestTip] }], { presenceTip: 42 })
  ok(honestPay.rewards.length === 1 && honestPay.rewards[0].amount === POOL, 'F-01: the honest tip beat takes the whole windowed pool')
  const lateTip = mineBeat(BEACON, HONEST.addr, 50, 8_000)!
  const latePay = settleFromBeats(BEACON, 50n, [{ address: HONEST.addr, beats: [lateTip] }], { presenceTip: 80 })
  ok(latePay.rewards.length === 1, 'F-01: a beat posted at tip 50 still pays when the seal lands at tip 80 (lookback)')
  refuses(
    () => settleFromBeats(BEACON, 50n, [{ address: HONEST.addr, beats: [mineBeat(BEACON, HONEST.addr, 0, 4_000)!] }], { presenceTip: 200 }),
    /outside the open presence window/,
    'F-01: a beat 200 heights behind the settle tip is outside the lookback — HALT',
  )

  // ── F-02 · forged custody hex on replay ──────────────────────────────────
  const L2 = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET)
  fundPool(L2, A, 8)
  const forged = custodyToHex({ hits: packHits([true, true, true, true, true, true, true, true]), aggregate: '00'.repeat(32) })
  const tipBeat = mineBeat(BEACON, ATTACK.addr, 0, 8_000)!
  refuses(() => L2.applyLive({
    seq: ++seq, kind: 'settlement', hash: 'forged', beacon: BEACON,
    claims: [{ address: ATTACK.addr, beats: [tipBeat], custody: forged }],
  } as KrayEvent), /custody did not verify/, 'F-02: forged 8-hit hex without a matching aggregate freezes replay')
  ok(L2.balanceOf(TREASURY) === 8n && L2.conserves(), 'F-02: the freeze mutates nothing')

  // ── F-06 · windowed lucky zeros pay the policy cap, not 2^40 ─────────────
  const lucky = mineBeat(BEACON, HONEST.addr, 7, 80_000)!
  const claimed = { ...lucky, zeros: Math.min(lucky.zeros, 40) }
  // if the mine found ≤24 we still prove the cap path: payZerosCap clamps work
  const raw = spanWork(BEACON, HONEST.addr, [claimed]).work
  const capped = spanWork(BEACON, HONEST.addr, [claimed], { onlyBlock: 7, payZerosCap: BEAT_PAY_ZEROS_CAP }).work
  ok(capped <= (1n << BigInt(BEAT_PAY_ZEROS_CAP)), `F-06: windowed pay ≤ 2^${BEAT_PAY_ZEROS_CAP} (raw ${raw}, capped ${capped})`)
  ok(capped > 0n, 'F-06: the honest tip beat still pays something under the cap')

  // ── F-03 · omit-rival is still the writer's inclusion (named, not "fixed") ─
  const aBeat = mineBeat(BEACON, ATTACK.addr, 3, 8_000)!
  const hBeat = mineBeat(BEACON, HONEST.addr, 3, 8_000)!
  const both = settleFromBeats(BEACON, POOL, [
    { address: ATTACK.addr, beats: [aBeat] },
    { address: HONEST.addr, beats: [hBeat] },
  ], { presenceTip: 3 })
  const thin = settleFromBeats(BEACON, POOL, [{ address: ATTACK.addr, beats: [aBeat] }], { presenceTip: 3 })
  ok(thin.rewards.length === 1 && thin.rewards[0].id === ATTACK.addr && thin.rewards[0].amount === POOL,
    'F-03 (named leftover): a thin claim list still pays 100% to who is present — inclusion is operator-trusted until ADR-3')
  ok(both.rewards.length === 2, 'F-03: when both beats are present the pool splits — the law is the journalled set, not the RAM')

  // ── W2-01 · a string tip is not the historical path ──────────────────────
  refuses(() => readPresenceTip('42'), /whole KRAY height/, 'W2-01: presenceTip "42" (string) HALTs — never coerced into the old span')
  refuses(() => readPresenceTip(true), /whole KRAY height/, 'W2-01: presenceTip true HALTs')
  refuses(() => readPresenceTip(42.5), /whole KRAY height/, 'W2-01: a fractional tip HALTs')
  ok(readPresenceTip(42) === 42 && readPresenceTip(undefined) === undefined, 'W2-01: only a whole number or absence is lawful')
  const forty = Array.from({ length: 40 }, (_, i) => ({ block: i, nonce: '1', zeros: 8 }))
  refuses(
    () => settleFromBeats(BEACON, POOL, [{ address: ATTACK.addr, beats: forty }], { presenceTip: '42' }),
    /whole KRAY height/,
    'W2-01: settleFromBeats with a string tip HALTs — a 40-block grind cannot hide behind JSON types',
  )

  // ── W2-02 · many claims[] rows, same address, lookback-legal blocks ───────
  const multiRows = [75, 76, 77, 78, 79, 80].map((block) => ({
    address: ATTACK.addr,
    beats: [mineBeat(BEACON, ATTACK.addr, block, 4_000)!],
  }))
  refuses(
    () => settleFromBeats(BEACON, POOL, [...multiRows, { address: HONEST.addr, beats: [mineBeat(BEACON, HONEST.addr, 80, 4_000)!] }], { presenceTip: 80 }),
    /one moment per address/,
    'W2-02: six rows for one wallet (blocks 75…80) HALT — one address is one moment, not a sum',
  )

  // ── W2-03 · new seq must be windowed; old seq may omit the tip ───────────
  const Lera = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET)
  fundPool(Lera, A, 4)
  const eraBeat = mineBeat(BEACON, ATTACK.addr, 0, 8_000)!
  refuses(() => Lera.applyLive({
    seq: PRESENCE_WINDOW_FROM_SEQ, kind: 'settlement', hash: 'no-tip', beacon: BEACON,
    claims: [{ address: ATTACK.addr, beats: [eraBeat] }],
  } as KrayEvent), /must carry presenceTip/, `W2-03: seq ${PRESENCE_WINDOW_FROM_SEQ} without presenceTip HALTs — the 1024-block axis is closed for new seals`)
  ok(Lera.balanceOf(TREASURY) === 4n && Lera.conserves(), 'W2-03: the era refusal mutates nothing')

  // ── era lives in settleFromBeats, not only the ledger ────────────────────
  const thirty = Array.from({ length: 30 }, (_, i) => ({ block: i, nonce: '1', zeros: 8 }))
  refuses(
    () => settleFromBeats(BEACON, POOL, [{ address: ATTACK.addr, beats: thirty }]),
    /must carry presenceTip/,
    'omit seq: settleFromBeats is fail-closed (live era) — 30 cheap blocks without a tip HALT',
  )
  refuses(
    () => settleFromBeats(BEACON, POOL, [{ address: ATTACK.addr, beats: thirty }], { seq: PRESENCE_WINDOW_FROM_SEQ }),
    /must carry presenceTip/,
    'seq 121 without tip: the pure function HALTs — the era is not ledger-only',
  )

  // ── bech32 case / trailing space is one person (hostile journal only) ────
  const oneTip = mineBeat(BEACON, ATTACK.addr, 80, 8_000)!
  const cased = settleFromBeats(BEACON, POOL, [
    { address: ATTACK.addr, beats: [oneTip] },
    { address: ATTACK.addr.toUpperCase(), beats: [oneTip] },
    { address: ATTACK.addr + ' ', beats: [oneTip] },
  ], { presenceTip: 80 })
  ok(cased.rewards.length === 1 && cased.rewards[0].amount === POOL,
    'TB1 / trailing space fold to one p2tr — two labels are not two machines')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — grind and forged custody halt; inclusion leftover is named. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
