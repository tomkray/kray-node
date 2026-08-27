/**
 * THE SELF-SUSTAINING LEDGER — donations fund the anchoring, the guardian earns the fees, and every
 * satoshi and every ₭ is conserved through all of it. This proves the two economic wires the node
 * fires on each real Bitcoin anchor: node.anchorSpend (the pot pays the anchor, reopening the mint
 * deficit) and node.settle (the fee pool goes to the guardian running the node).
 *
 *   node src/test/economics-guardian.test.ts
 */
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { KrayNode } from '../protocol/node.ts'
import { mineBeat } from '../economics/beat-pow.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage } from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
interface W { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): W { const sk = createHash('sha256').update('econ|' + tag).digest(); const { publicKeyHex } = _generateKeyPair(sk); return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex } }
const A = wallet('A'), B = wallet('B'), GUARDIAN = wallet('guardian')
function signTransfer(from: W, to: string, amount: bigint, nonce: number): Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'> {
  const msg = transferMessage(NET, from.addr, to, amount, nonce)
  return { kind: 'transfer', at: 0, from: from.addr, to, amount: amount.toString(), fee: '1', nonce, publicKey: from.pk, signature: _signKrayWallet(msg, from.sk), scheme: 'kraywallet' } as never
}

function main() {
  console.log('\n╔═ THE SELF-SUSTAINING LEDGER — donations pay anchors, the guardian earns fees ═╗\n')
  const dir = join(tmpdir(), `kraynet-econ-${process.pid}`)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const node = new KrayNode(dir, NET)

  // ── 1 · A DONATION fills the pot and mints ₭ (1 per sat), backed ──────────
  for (let d = 0; d < 10; d++) node.donate(A.addr, 10_000n)   // 10 × 10k = 100k, each within the 10k per-mint cap
  const p0 = node.pot()
  ok(p0.donated === 100_000n && p0.held === 100_000n && p0.spent === 0n, 'donation: the pot holds 100,000 sats, 0 spent yet')
  ok(node.balanceOf(A.addr) === 100_000n && String(node.supply().emitted) === '100000', 'the donor minted 100,000 ₭ — one per sacrificed satoshi')
  ok(node.backed(), 'backed: every ₭ is backed by a donated satoshi')
  const deficit0 = p0.deficit

  // ── 2 · USER ACTIONS pay the eternal 1-₭ fee into the pool (TREASURY) ─────
  node.submit(signTransfer(A, B.addr, 10n, 0))
  node.submit(signTransfer(A, B.addr, 10n, 1))
  node.submit(signTransfer(A, B.addr, 10n, 2))
  ok(node.feePool() === 3n, 'fees: three transfers → 3 ₭ accrued in the fee pool')
  ok(node.balanceOf(B.addr) === 30n, 'the recipient got the 30 ₭ moved, the fee is separate')

  // ── 3 · ANCHORING IS PAID BY THE POT — and the mint deficit REOPENS ♻ ─────
  node.anchorSpend(500n)              // the node fires this on each real Bitcoin anchor (the ~500-sat fee)
  const p1 = node.pot()
  ok(p1.spent === 500n, 'anchorSpend: the DONATIONS paid 500 sats to carry the anchor onto Bitcoin')
  ok(p1.held === 100_000n - 500n, 'the pot drained by exactly the anchor fee')
  ok(p1.deficit > deficit0, 'the mint deficit REOPENED — fresh donations can mint again (self-sustaining ♻)')
  ok(String(node.supply().emitted) === '100000' && String(node.supply().burned) === '0', 'anchorSpend is sats-side only — it mints and burns no ₭')

  // ── 4 · THE GUARDIAN EARNS THE FEE POOL — through PROVEN WORK (the unsigned settle/reward is
  //        RETIRED: the pool pays only what the bytes prove — the guardian grinds real beats) ──────
  const poolBefore = node.feePool()
  const BEACON = createHash('sha256').update('beacon|economics-guardian').digest('hex')
  const beats = [0, 1, 2].map((b) => mineBeat(BEACON, GUARDIAN.addr, b, 20000)).filter((x) => x != null)
  ok(beats.length > 0, 'the guardian ground real beats — laptop-grade proof-of-work, no permission needed')
  node.settleBeats(BEACON, [{ address: GUARDIAN.addr, beats }])
  ok(node.balanceOf(GUARDIAN.addr) === poolBefore, `settleBeats: the guardian earned the whole fee pool (${poolBefore} ₭) by PROVEN work — re-derived by every replayer`)
  ok(node.feePool() === 0n, 'the fee pool emptied into the guardian — nothing left unassigned')

  // ── 5 · CONSERVATION HOLDS through every wire ─────────────────────────────
  ok(node.conserves(), 'conservation: Σ balances == emitted − burned, exactly')
  ok(node.backed(), 'backed still holds: emitted ≤ donated, and the pot books balance (donated == spent + held)')

  // ── 6 · IT ALL REPLAYS — the self-sustaining events are journaled, byte-exact ──
  const root = node.cascadeRoot()
  const reboot = new KrayNode(dir, NET)
  ok(reboot.cascadeRoot() === root, 'reboot: anchorSpend + settle replay byte-exact — the economy is provable')
  ok(reboot.balanceOf(GUARDIAN.addr) === poolBefore && reboot.pot().spent === 500n, 'the rebooted node agrees: guardian paid, pot spent')

  rmSync(dir, { recursive: true, force: true })
  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — donations fund the anchors, the guardian earns the fees, conservation never breaks. ⛓₭♻\n`)
  process.exit(fail ? 1 : 0)
}
main()
