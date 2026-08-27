/**
 * THE KRAYNET NODE (v2) — the cascade check for the server-facing surface.
 *   node src/test/node.sim.ts
 *
 * Boots a node on a real on-disk journal, runs a full signed lifecycle (donate → transfer →
 * inscribe → name → transfer-star → anchor → reward), and proves the READ API the wallet and
 * explorer depend on returns exactly the right derived views — balance, supply (emitted/
 * burned/circulating), the anchoring pot, a star by creation number (owner, content, Codex),
 * a profile, and the overview. Then it proves the submit facade refuses a non-user action,
 * and that a fresh node re-derives the whole overview + cascade root byte-exact from disk.
 */
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { KrayNode } from '../protocol/node.ts'
import { DEFAULT_POT_TARGET_SATS } from '../protocol/pot.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes,
  transferMessage, sendStarMessage, inscribeMessageV2, nameMessageV2,
} from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}

const NET = 'regtest'
const BNET = toBtcNet(NET)
interface Wallet { addr: string; sk: Uint8Array; pk: string }
function makeWallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`kraynet-node-sim|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const A = makeWallet('A'), B = makeWallet('B')
const WBY = new Map([[A.addr, A], [B.addr, B]])
function messageFor(e: Partial<KrayEvent>): string {
  switch (e.kind) {
    case 'transfer': return transferMessage(NET, e.from!, e.to!, BigInt(e.amount!), e.nonce!)
    case 'transfer-star': return sendStarMessage(NET, e.from!, e.to!, BigInt(e.star!), e.nonce!)
    case 'name': return nameMessageV2(NET, e.from!, e.nonce!, e.name!)
    default: return inscribeMessageV2(NET, e.from!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.parent !== undefined ? BigInt(e.parent) : undefined, e.nonce!)
  }
}
function sign(e: Record<string, unknown>): Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'> {
  const w = WBY.get(e.from as string)!
  return { ...e, publicKey: w.pk, signature: _signKrayWallet(messageFor(e as Partial<KrayEvent>), w.sk), scheme: 'kraywallet' } as never
}

function main(): void {
  const dir = join(tmpdir(), `kraynet-node-sim-${process.pid}`)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })

  const node = new KrayNode(dir, NET)
  node.donate(A.addr, 1000n)
  node.donate(B.addr, 500n)
  node.submit(sign({ kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '100', fee: '1', nonce: 0 }))
  node.submit(sign({ kind: 'inscribe', at: 0, from: A.addr, contentHash: 'aurora', contentType: 'image/png', size: 42, nonce: 1 })) // star #0
  node.submit(sign({ kind: 'name', at: 0, from: B.addr, name: 'bee', nonce: 0 }))                                            // star #1
  node.submit(sign({ kind: 'transfer-star', at: 0, from: A.addr, to: B.addr, star: '0', fee: '1', nonce: 2 }))                    // #0 → B

  // ── READ API — balances & supply ──
  ok(node.balanceOf(A.addr) === 1000n - 100n - 1n - 1n - 1n, 'balance A = 1000 − 100 − fee − burn − fee')
  ok(node.balanceOf(B.addr) === 500n + 100n - 1n, 'balance B = 500 + 100 − burn(name)')
  const sup = node.supply()
  ok(sup.emitted === 1500n && sup.burned === 2n && sup.circulating === 1498n, 'supply: emitted 1500, burned 2, circulating 1498')

  // ── READ API — the anchoring pot ──
  let p = node.pot()
  ok(p.donated === 1500n && p.held === 1500n && p.minted === 1500n && p.open === true, 'pot: donated=held=minted=1500, open')
  ok(p.deficit === DEFAULT_POT_TARGET_SATS - 1500n, 'pot deficit = live target − held')

  // ── READ API — a star by creation number ──
  const s0 = node.star(0n)!
  ok(s0.owner === B.addr && s0.by === A.addr, 'star #0: owned by B now, created by A (immortal author)')
  ok(s0.contentHash === 'aurora' && s0.contentType === 'image/png', 'star #0 carries its content')
  ok(s0.rarity === 'mythic', 'star #0 is mythic (the first creation)')
  const s1 = node.star(1n)!
  ok(s1.name === 'bee' && s1.owner === B.addr, 'star #1 is the named star, owned by B')
  ok(node.star(99n) === null, 'an unborn star reads null')

  // ── READ API — profile & overview ──
  const profB = node.profile(B.addr)
  ok(profB.starCount === 2 && profB.stars.map(String).join(',') === '0,1', 'B holds stars #0 and #1')
  const ov = node.overview()
  ok(ov.starCount === 2 && ov.conserves && ov.backed, 'overview: 2 stars, conserves + backed')
  ok(ov.cascadeRoot === node.cascadeRoot(), 'overview carries the live cascade root')

  // ── the anchor drains the pot → deficit grows; a reward pays from the fee pool ──
  const treasuryBefore = node.balanceOf('KRAY_TREASURY')
  ok(treasuryBefore === 2n, 'the fee pool collected 2 ₭ (one transfer fee + one star-move fee; burns pay no fee)')
  node.anchorSpend(200n)
  ok(node.pot().held === 1300n && node.pot().spent === 200n, 'anchor drained 200 sats from the pot')
  // the unsigned reward is RETIRED — the reducer refuses it; the pool pays only via settleBeats (proven work)
  let rewardThrew = false
  try { node.store.append({ kind: 'reward', at: 0, to: A.addr, amount: '2' } as never) } catch { rewardThrew = true }
  ok(rewardThrew, 'the retired unsigned reward is REFUSED by the reducer — the pool pays only what the bytes prove')
  ok(node.balanceOf('KRAY_TREASURY') === 2n, 'the fee pool is untouched by the refused reward (state byte-identical)')

  // ── the submit facade refuses a non-user action ──
  let threw = false
  try { node.submit({ kind: 'donate', at: 0, to: A.addr, amount: '5' } as never) } catch { threw = true }
  ok(threw, 'submit() REFUSES a donate (system path, not a user action)')
  threw = false
  try { node.submit(sign({ kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '5', fee: '1', nonce: 999 })) } catch { threw = true }
  ok(threw, 'submit() REFUSES a stale-nonce transfer (the reducer gates it)')

  // ── THE REBOOT IS THE VERIFIER — a fresh node re-derives from disk ──
  const before = JSON.stringify(node.overview(), (_k, v) => typeof v === 'bigint' ? v.toString() : v)
  const node2 = new KrayNode(dir, NET)
  const after = JSON.stringify(node2.overview(), (_k, v) => typeof v === 'bigint' ? v.toString() : v)
  ok(before === after, 'REBOOT FROM DISK: the whole overview re-derives byte-exact')
  ok(node2.cascadeRoot() === node.cascadeRoot(), 'reboot cascade root (the Bitcoin anchor) identical')
  ok(node2.star(0n)!.owner === B.addr && node2.star(1n)!.name === 'bee', 'reboot: stars re-derived exactly')

  rmSync(dir, { recursive: true, force: true })
  console.log(`\n✓ ${pass} checks passed — THE KRAYNET NODE (v2) HOLDS: a full signed lifecycle over a real on-disk journal, the read API returning exact derived views (balance, supply emitted/burned/circulating, the anchoring pot, a star by creation number with owner/content/Codex, profile, overview), the submit facade refusing system paths and stale nonces, and a fresh node re-deriving the whole overview + cascade root byte-exact from disk. The surface the wallet talks to is proven. ⭐🛰️`)
}
main()
