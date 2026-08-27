/**
 * THE SEAL PAYS PROVEN WORK — node.settleBeats journals the beats a beacon gathered as ONE settlement, and
 * the node pays the fee pool across the validators by that work, conserved and byte-exact on reboot. This is
 * the wire the live seal fires in place of the solo hardcoded reward.
 *
 *   node src/test/settle-beats-node.test.ts
 */
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { KrayNode } from '../protocol/node.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage } from '../protocol/scheme.ts'
import { mineBeat, spanWork, type BeatProof } from '../economics/beat-pow.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
function wallet(tag: string) { const sk = createHash('sha256').update('sb|' + tag).digest(); const { publicKeyHex } = _generateKeyPair(sk); return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex } }
const A = wallet('A'), V1 = wallet('v1'), V2 = wallet('v2')
const BEACON = createHash('sha256').update('beacon|settle-beats-node').digest('hex')
const beatsFor = (address: string, blocks: number[], budget: number): BeatProof[] => blocks.map((b) => mineBeat(BEACON, address, b, budget)).filter((x): x is BeatProof => x != null)
function transfer(to: string, nonce: number): KrayEvent {
  const msg = transferMessage(NET, A.addr, to, 3n, nonce)
  return { kind: 'transfer', at: 0, from: A.addr, to, amount: '3', fee: '1', nonce, publicKey: A.pk, signature: _signKrayWallet(msg, A.sk), scheme: 'kraywallet' } as never
}

function main() {
  console.log('\n╔═ THE SEAL PAYS PROVEN WORK — node.settleBeats over a real pool ═╗\n')
  const dir = join(tmpdir(), `kraynet-sb-${process.pid}`)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const node = new KrayNode(dir, NET)

  for (let d = 0; d < 10; d++) node.donate(A.addr, 10_000n)   // 10 × 10k = 100k, each within the 10k per-mint cap
  for (let n = 0; n < 15; n++) node.submit(transfer(wallet('to|' + n).addr, n))
  const pool = node.feePool()
  ok(pool === 15n, 'fifteen fee-paying transfers accrued a 15-₭ pool')

  const claims = [
    { address: V1.addr, beats: beatsFor(V1.addr, [0, 1, 2, 3], 20000) },   // more compute
    { address: V2.addr, beats: beatsFor(V2.addr, [0, 1, 2, 3], 2000) },
  ]
  const wV1 = spanWork(BEACON, V1.addr, claims[0].beats).work, wV2 = spanWork(BEACON, V2.addr, claims[1].beats).work

  node.settleBeats(BEACON, claims)
  ok(node.feePool() === 0n, 'the settlement emptied the fee pool')
  ok(node.balanceOf(V1.addr) + node.balanceOf(V2.addr) === pool, 'the whole pool went to the validators, to the unit')
  ok(node.balanceOf(V1.addr) >= node.balanceOf(V2.addr), `more proven work → more reward (V1 ${node.balanceOf(V1.addr)} [w=${wV1}] ≥ V2 ${node.balanceOf(V2.addr)} [w=${wV2}])`)
  ok(node.conserves() && node.backed(), 'conservation + backing hold — ₭ moved from the Treasury, none minted')

  const root = node.cascadeRoot()
  const reboot = new KrayNode(dir, NET)
  ok(reboot.cascadeRoot() === root, 'reboot: the settlement replays byte-exact — the payout is provable from the journal')
  ok(reboot.balanceOf(V1.addr) === node.balanceOf(V1.addr), 'the rebooted node agrees on every validator balance')

  rmSync(dir, { recursive: true, force: true })
  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the seal pays proven work, conserved, replayable. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
