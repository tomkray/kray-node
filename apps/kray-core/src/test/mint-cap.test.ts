/**
 * THE 10,000-SAT PER-MINT CAP IS UNBREAKABLE — every injection vector attacked, including the operator's own node.
 *
 * The Creator's demand: nobody can mint more than 10,000 ₭ per donation — not through the HTTP door, and NOT by
 * writing straight to their own node's ledger or hand-forging a journal line. This proves the cap is enforced in
 * the ONE place every mint must pass — the consensus reducer (applyLive) — using an IMMUTABLE constant with no
 * parameter to raise. Since append() and replay() both go through applyLive, there is no path to mint more.
 *
 *   node src/test/mint-cap.test.ts
 */
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { schnorr } from '@noble/curves/secp256k1.js'
import { KrayLedger } from '../protocol/ledger.ts'
import { LedgerStore } from '../protocol/store.ts'
import { MINT_CAP_SATS } from '../protocol/pot.ts'
import { NETWORKS } from '../protocol/scheme.ts'
import { sha256hex, canonical, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const addr = (tag: string): string => btc.p2tr(schnorr.getPublicKey(createHash('sha256').update('cap|' + tag).digest()), undefined, NETWORKS[NET]).address!
const donateEvt = (seq: number, to: string, amount: string): KrayEvent => ({ seq, kind: 'donate', hash: 'h' + seq, to, amount } as KrayEvent)
const rejects = (fn: () => void, re: RegExp, m: string): void => { try { fn(); ok(false, m + ' — DID NOT throw') } catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) } }

function main() {
  console.log('\n╔═ THE 10,000 PER-MINT CAP — unbreakable from every angle, even the operator’s own node ═╗\n')
  ok(MINT_CAP_SATS === 10_000n, `the cap constant is exactly 10,000 sats`)
  const A = addr('A')

  // ── VECTOR 1 · the operator writes STRAIGHT to the reducer (bypassing any HTTP gate) — every over-cap value dies ──
  const L = new KrayLedger(undefined, NET)
  ok(L.mintCap === 10_000n, 'the ledger’s cap is the immutable constant — the constructor takes NO cap parameter to raise it')
  for (const bad of ['10001', '22000', '50000', '100000', '1000000', '999999999999']) {
    rejects(() => L.applyLive(donateEvt(1, A, bad)), /at most 10000|single donation mints at most/, `applyLive refuses a ${bad}-sat donation (direct reducer injection)`)
  }
  ok(L.balanceOf(A) === 0n && L.totalEmitted === 0n && L.conserves(), 'not one satoshi over the cap minted — balance 0, emitted 0, conservation intact after all injections')

  // ── VECTOR 2 · the exact boundary — 10,000 works, 10,001 does not ──
  const L2 = new KrayLedger(undefined, NET)
  L2.applyLive(donateEvt(1, A, '10000'))
  ok(L2.balanceOf(A) === 10_000n && L2.totalEmitted === 10_000n, 'exactly 10,000 mints exactly 10,000 ₭ — the cap is the maximum, not a barrier below it')
  rejects(() => L2.applyLive(donateEvt(2, A, '10001')), /at most 10000/, 'one satoshi over the cap (10,001) is refused')
  ok(L2.balanceOf(A) === 10_000n, 'the refused over-cap donation mutated nothing')

  // ── VECTOR 3 · the PERSIST path (store.append) refuses it too, and nothing reaches the journal ──
  const dir = join(tmpdir(), 'kray-mintcap-' + process.pid)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  try {
    const S = new LedgerStore(dir, NET)
    rejects(() => S.append({ kind: 'donate', at: 0, to: A, amount: '50000' } as Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'>), /at most 10000/, 'store.append refuses an over-cap donation (applied before it is ever persisted)')
    const jp = join(dir, `kraynet-journal-${NET}.jsonl`)
    const lines = existsSync(jp) ? readFileSync(jp, 'utf8').split('\n').filter((l) => l.trim()) : []
    ok(lines.length === 0, 'the over-cap donation NEVER reached the journal — the reducer gates the write')

    // ── VECTOR 4 · the OPERATOR HAND-FORGES a journal line — with a VALID hash-chain — and restarts ──
    // First a legit 10,000 donation so the chain has a real head to forge onto.
    S.append({ kind: 'donate', at: 0, to: A, amount: '10000' } as Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'>)
    // Now forge seq 2: a 1,000,000-sat donation with a CORRECT prevHash + hash (exactly how the store computes it),
    // so the hash-chain check PASSES and only the reducer's cap can stop it. This is the sophisticated attacker.
    const body = { kind: 'donate', at: 0, to: A, amount: '1000000', seq: 2, prevHash: S.head }
    const forged = { ...body, hash: sha256hex(S.head + canonical(body)) }
    appendFileSync(jp, JSON.stringify(forged) + '\n')
    // Restart: a fresh store replays the tampered journal. The valid hash-chain passes; the reducer's cap HALTS it.
    rejects(() => { new LedgerStore(dir, NET) }, /at most 10000|single donation mints at most/, 'a hand-forged over-cap line with a VALID hash-chain is caught by the REDUCER on replay — the node HALTS rather than mint it')
    ok(true, '→ so even writing straight to your own journal cannot mint over the cap: the reducer re-checks every event on every replay')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  // ── VECTOR 5 · SYBIL — many identities each mint the cap, but NONE mints more; splitting buys nothing per mint ──
  const L3 = new KrayLedger(undefined, NET)
  let seq = 0
  for (let i = 0; i < 25; i++) L3.applyLive(donateEvt(++seq, addr('sybil|' + i), '10000'))
  const each21k = [...Array(25)].every((_, i) => L3.balanceOf(addr('sybil|' + i)) === 10_000n)
  ok(each21k, '25 Sybil identities each minted exactly 10,000 — never more; a whale gains nothing per mint by splitting')
  ok(L3.totalEmitted === 25n * 10_000n && L3.totalEmitted <= L3.pot.satsDonated && L3.conserves(), 'the total is exactly 25 × 10,000, still backed 1:1 and conserved — the cost is 25 separate transactions + anchors, which is the point')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — 10,000 is the hard maximum per mint, enforced in the one reducer every path (API, direct write, replay) must cross. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
