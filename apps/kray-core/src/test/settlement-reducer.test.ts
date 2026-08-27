/**
 * THE SETTLEMENT EVENT HOLDS — the ledger pays validators by PROVEN work, re-derived from the beats the event
 * carries, and refuses any table the beats do not produce. Accrues a real fee pool, settles it by mined beats,
 * and proves: the pool empties into the validators by their work (conserved, none minted), more work earns more,
 * a payout table that lies is HALTED, and beats stolen under another address earn nothing.
 *
 *   node src/test/settlement-reducer.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { DEFAULT_POT_TARGET_SATS } from '../protocol/pot.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, inscribeMessageV2 } from '../protocol/scheme.ts'
import { TREASURY, type KrayEvent } from '../protocol/kray-primitives.ts'
import { mineBeat, spanWork, type BeatProof } from '../economics/beat-pow.ts'
import { packHits, custodyToHex, buildCustodyClaim } from '../economics/custody.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const refuses = (fn: () => void, re: RegExp, m: string) => { try { fn(); ok(false, m + ' — did NOT halt') } catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('settle|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[NET]).address!, sk, pk: publicKeyHex }
}
const BEACON = createHash('sha256').update('beacon|settlement-reducer').digest('hex')
const beatsFor = (address: string, blocks: number[], budget: number): BeatProof[] =>
  blocks.map((b) => mineBeat(BEACON, address, b, budget)).filter((x): x is BeatProof => x != null)

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
  console.log('\n╔═ THE SETTLEMENT EVENT — the ledger pays proven work, and refutes what the beats do not produce ═╗\n')
  const A = wallet('A'), V1 = wallet('v1'), V2 = wallet('v2')
  const beatsV1 = beatsFor(V1.addr, [0, 1, 2, 3], 20000)   // more compute
  const beatsV2 = beatsFor(V2.addr, [0, 1, 2, 3], 2000)    // less

  // ── 1 · a real fee pool, settled by beats ────────────────────────────────────
  const L = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET)
  fundPool(L, A, 12)
  const pool = L.balanceOf(TREASURY)
  ok(pool === 12n, 'twelve fee-paying transfers accrued a 12-₭ pool in the Treasury')
  L.applyLive({ seq: ++seq, kind: 'settlement', hash: 's' + seq, beacon: BEACON, claims: [{ address: V1.addr, beats: beatsV1 }, { address: V2.addr, beats: beatsV2 }] } as KrayEvent)
  ok(L.balanceOf(TREASURY) === 0n, 'the settlement emptied the fee pool')
  ok(L.balanceOf(V1.addr) + L.balanceOf(V2.addr) === pool, 'the whole pool went to the validators, to the unit')
  ok(L.balanceOf(V1.addr) >= L.balanceOf(V2.addr), `more proven work → more reward (V1 ${L.balanceOf(V1.addr)} ≥ V2 ${L.balanceOf(V2.addr)})`)
  ok(L.conserves(), 'conservation holds — ₭ moved from the Treasury, none minted')

  // ── 2 · a payout table that LIES is HALTED ───────────────────────────────────
  const L2 = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET)
  fundPool(L2, A, 12)
  refuses(() => L2.applyLive({ seq: seq + 1, kind: 'settlement', hash: 'lie', beacon: BEACON,
    claims: [{ address: V1.addr, beats: beatsV1 }, { address: V2.addr, beats: beatsV2 }],
    payouts: [[V1.addr, '0', '999999']] } as KrayEvent),
    /not the one the beats produce|HALT/, 'a recorded payout table that does not follow from the beats is HALTED')
  ok(L2.balanceOf(TREASURY) === 12n && L2.conserves(), 'the halted settlement left the pool untouched — a refusal mutates nothing')

  // ── 3 · beats are ADDRESS-BOUND: crediting V2 with V1's beats pays nothing ────
  const L3 = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET)
  fundPool(L3, A, 12)
  L3.applyLive({ seq: ++seq, kind: 'settlement', hash: 'steal', beacon: BEACON, claims: [{ address: V2.addr, beats: beatsV1 }] } as KrayEvent)
  ok(L3.balanceOf(V2.addr) === 0n && L3.balanceOf(TREASURY) === 12n, "settling V2 with V1's beats pays 0 — work is address-bound, so stolen work earns nothing")
  ok(spanWork(BEACON, V2.addr, beatsV1).work === 0n, "spanWork agrees: V1's beats prove 0 under V2's address")

  // ── 4 · a malformed beacon is refused before any mutation ────────────────────
  const L4 = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET)
  fundPool(L4, A, 12)
  refuses(() => L4.applyLive({ seq: seq + 1, kind: 'settlement', hash: 'bad', beacon: 'not-a-hash', claims: [{ address: V1.addr, beats: beatsV1 }] } as KrayEvent),
    /64-hex Bitcoin beacon/, 'a settlement without a real 64-hex Bitcoin beacon is refused')

  // ── 5 · FORGED custody hex (8-hit bitmap, zero aggregate) HALTs — bits are not a proof ──
  const L5 = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET)
  fundPool(L5, A, 12)
  const forgedCustody = custodyToHex({ hits: packHits([true, true, true, true, true, true, true, true]), aggregate: '00'.repeat(32) })
  refuses(() => L5.applyLive({ seq: seq + 1, kind: 'settlement', hash: 'forged-cust', beacon: BEACON, claims: [
    { address: V1.addr, beats: beatsFor(V1.addr, [0, 1, 2, 3], 8000), custody: forgedCustody },
    { address: V2.addr, beats: beatsFor(V2.addr, [0, 1, 2, 3], 8000) },
  ] } as KrayEvent), /custody did not verify|HALT/, 'forged 8-hit custody without a matching aggregate HALTs replay — bits alone are not a proof')
  ok(L5.balanceOf(TREASURY) === 12n && L5.conserves(), 'the halted forged-custody settlement left the pool untouched')

  // ── 6 · REAL custody + atlas bytes: a full-atlas guardian out-earns a CPU-only peer of equal beats ──
  const atlasBytes = new Map<string, Uint8Array>()
  const L6 = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET, undefined, false, (h) => atlasBytes.get(h) ?? null)
  fundPool(L6, A, 12)
  for (let i = 0; i < 16; i++) {
    const body = Buffer.from(`atlas-settlement-${i}`)
    const ch = createHash('sha256').update(body).digest('hex')
    atlasBytes.set(ch, new Uint8Array(body))
    const n = L6.nonceOf(A.addr)
    L6.applyLive({
      seq: ++seq, kind: 'inscribe', hash: 'ia' + seq, at: 0, from: A.addr,
      contentHash: ch, contentType: 'text/plain', size: body.length, nonce: n,
      publicKey: A.pk, signature: _signKrayWallet(inscribeMessageV2(NET, A.addr, ch, 'text/plain', body.length, undefined, n), A.sk), scheme: 'kraywallet',
    } as KrayEvent)
  }
  const oracle = {
    contents: L6.stars.inscriptions().filter((x) => !x.cursed).map((x) => x.contentHash),
    bytesOf: (h: string) => atlasBytes.get(h) ?? null,
  }
  const realCustody = custodyToHex(buildCustodyClaim(BEACON, V1.addr, oracle))
  const beatsEq1 = beatsFor(V1.addr, [0, 1, 2, 3], 8000)
  const beatsEq2 = beatsFor(V2.addr, [0, 1, 2, 3], 8000)
  L6.applyLive({ seq: ++seq, kind: 'settlement', hash: 'cust', beacon: BEACON, claims: [
    { address: V1.addr, beats: beatsEq1, custody: realCustody },
    { address: V2.addr, beats: beatsEq2 },
  ] } as KrayEvent)
  ok(L6.balanceOf(V1.addr) > L6.balanceOf(V2.addr), `proven custody in consensus: the full-atlas guardian out-earns the CPU-only one (${L6.balanceOf(V1.addr)} > ${L6.balanceOf(V2.addr)})`)
  ok(L6.balanceOf(TREASURY) === 0n && L6.conserves(), 'the proven-custody settlement still empties the pool and conserves — nothing minted')

  // ── 7 · WINDOW: a grind of foreign block indices HALTs when presenceTip is set ──
  const L7 = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET)
  fundPool(L7, A, 12)
  refuses(() => L7.applyLive({
    seq: seq + 1, kind: 'settlement', hash: 'grind', beacon: BEACON, presenceTip: 42,
    claims: [{ address: V1.addr, beats: beatsFor(V1.addr, [0, 1, 2, 3], 2000) }],
    payouts: [[V1.addr, '0', '12']],
  } as KrayEvent), /outside the open presence window|HALT/, 'presenceTip=42 refuses beats mined on 0..3 — block is not a free grinding axis')
  ok(L7.balanceOf(TREASURY) === 12n && L7.conserves(), 'the halted grind left the pool untouched')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — proven work is paid, invented work is refused, and the pool always balances. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
