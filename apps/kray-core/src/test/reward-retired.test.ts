/**
 * THE REWARD RETIREMENT — the last writer-trusted payout is refused everywhere. Prove by breaking:
 *   node src/test/reward-retired.test.ts
 *
 *   R-01  a DEFAULT ledger (every network) refuses `reward` — the retired message, state byte-identical
 *   R-02  the LEGACY era (injected seq) still applies the historical semantics — pool-bounded, conserved
 *   R-03  THE A3 EQUIVALENCE: a journal with NO reward events replays to the IDENTICAL cascade root under
 *         the default gate and the legacy gate — the proof that retiring at seq 1 orphans nothing anchored
 *         (the live signet journal has zero `reward` events; this pins the equivalence that makes it safe)
 *   R-04  the node layer has no unsigned payout door left (settle/reward methods are gone)
 *   R-05  the self-proving path still pays: settleBeats moves the pool by PROVEN work after the retirement
 */
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { KrayNode } from '../protocol/node.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage } from '../protocol/scheme.ts'
import { mineBeat } from '../economics/beat-pow.ts'
import { TREASURY, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
function wallet(tag: string) {
  const sk = createHash('sha256').update('reward-retired|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B')
const LEGACY = Number.MAX_SAFE_INTEGER
const mk = (net: string, retiredSeq?: number) => new KrayLedger(undefined, net, undefined, false, undefined, undefined, undefined, undefined, retiredSeq)

/** a small fee-generating story with NO reward events — donate + a fee-paying transfer */
function story(L: KrayLedger): KrayEvent[] {
  const J: KrayEvent[] = []
  const ap = (e: Record<string, unknown>) => { const ev = { ...e, seq: J.length + 1 } as unknown as KrayEvent; L.applyLive(ev); J.push(ev) }
  ap({ kind: 'donate', hash: 'd', to: A.addr, amount: '100' })
  const n = L.nonceOf(A.addr)
  ap({ kind: 'transfer', hash: 't', from: A.addr, to: B.addr, amount: '5', fee: '1', nonce: n, publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, B.addr, 5n, n), A.sk), scheme: 'kraywallet' })
  return J
}

function main() {
  console.log('\n╔═ THE REWARD RETIREMENT — the pool pays only what the bytes prove ═╗\n')

  console.log('R-01 — every network refuses the unsigned reward by default')
  for (const net of ['regtest', 'signet', 'main']) {
    const L = mk(net)
    const rootBefore = L.cascadeRoot()
    let threw = ''
    try { L.applyLive({ seq: 1, kind: 'reward', hash: 'r', to: A.addr, amount: '1' } as KrayEvent) } catch (e) { threw = (e as Error).message }
    ok(/retired/.test(threw), `${net}: refused with the retirement reason`)
    ok(L.cascadeRoot() === rootBefore && L.conserves(), `${net}: the refusal left the ledger byte-identical`)
  }

  console.log('R-02 — the legacy era (injected) still applies the historical semantics')
  const H = mk(NET, LEGACY)
  story(H)
  ok(H.balanceOf(TREASURY) === 1n, 'the story accrued a 1-₭ fee pool')
  H.applyLive({ seq: 3, kind: 'reward', hash: 'r', to: B.addr, amount: '1' } as KrayEvent)
  ok(H.balanceOf(TREASURY) === 0n && H.balanceOf(B.addr) === 6n, 'below the injected gate the historical reward applies (pool → validator)')
  let over = ''
  try { H.applyLive({ seq: 4, kind: 'reward', hash: 'r2', to: B.addr, amount: '999' } as KrayEvent) } catch (e) { over = (e as Error).message }
  ok(/exceeds the fee pool/.test(over), 'the historical bound still holds: a reward past the pool throws')
  ok(H.conserves(), 'the legacy era conserves')

  console.log('R-03 — A3 equivalence: a reward-free journal replays IDENTICAL under default vs legacy gates')
  const D = mk(NET)          // default: retired from seq 1
  const G = mk(NET, LEGACY)  // legacy: never retired
  const J = story(D)
  for (const e of J) G.applyLive(e)
  ok(D.cascadeRoot() === G.cascadeRoot(), 'identical roots — retiring at seq 1 orphans NOTHING in a reward-free history (the live signet has zero reward events)')
  ok(D.conserves() && G.conserves(), 'both conserve')

  console.log('R-04 — the node layer has no unsigned payout door left')
  const dir = join(tmpdir(), `kraynet-rr-${process.pid}`)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const node = new KrayNode(dir, NET)
  ok(typeof (node as unknown as Record<string, unknown>).reward === 'undefined', 'node.reward() is gone')
  ok(typeof (node as unknown as Record<string, unknown>).settle === 'undefined', 'node.settle(table) is gone — no caller-provided work table can ever name who gets the pool')
  let doorThrew = false
  try { node.store.append({ kind: 'reward', at: 0, to: A.addr, amount: '1' } as never) } catch { doorThrew = true }
  ok(doorThrew, 'even a raw append of a reward is refused by the reducer')

  console.log('R-05 — the self-proving path still pays: settleBeats moves the pool by PROVEN work')
  node.donate(A.addr, 10_000n)
  const n0 = node.nonceOf(A.addr)
  node.submit({ kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '5', fee: '1', nonce: n0, publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, B.addr, 5n, n0), A.sk), scheme: 'kraywallet' } as never)
  ok(node.feePool() === 1n, 'a 1-₭ fee accrued')
  const BEACON = createHash('sha256').update('beacon|reward-retired').digest('hex')
  const beats = [0, 1].map((b) => mineBeat(BEACON, B.addr, b, 20000)).filter((x) => x != null)
  ok(beats.length > 0, 'B ground real beats (proof-of-work)')
  node.settleBeats(BEACON, [{ address: B.addr, beats }])
  ok(node.feePool() === 0n && node.balanceOf(B.addr) === 6n, 'settleBeats paid the pool to PROVEN work — the only payout that exists now')
  ok(node.conserves(), 'the node conserves after the proven settlement')
  rmSync(dir, { recursive: true, force: true })

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — THE RETIREMENT HOLDS: the unsigned reward is refused on every network, history without it replays byte-identical, the node has no unsigned payout door, and the pool pays only proven work. ⚖️🔥`)
}
main()
