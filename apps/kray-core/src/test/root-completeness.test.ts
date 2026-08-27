/**
 * NADA FORA DA ROOT — the whole state, and nothing but the state, folds into ONE 32-byte cascade
 * root that is written to Bitcoin. This proves the Supreme Law's completeness invariant: every
 * value-bearing subsystem (money, stars, star-names, the rune L2, the AMM LP book, the anchoring pot, emitted/
 * burned) moves the root, two nodes on the same journal produce the byte-identical root, a reboot
 * reproduces it, and every event moves it — so no value can exist outside the anchored proof.
 *
 *   node src/test/root-completeness.test.ts
 */
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { KrayNode } from '../protocol/node.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, sendStarMessage, inscribeMessageV2, nameMessageV2, ammAddMessage } from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
interface Wallet { addr: string; sk: Uint8Array; pk: string }
function makeWallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`root-completeness|${tag}`, 'utf8').digest()
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
    case 'amm-add': return ammAddMessage(NET, e.from!, e.runeId!, BigInt(e.krayIn!), BigInt(e.runeIn!), BigInt(e.minLp!), e.nonce!)
    default: return inscribeMessageV2(NET, e.from!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.parent !== undefined ? BigInt(e.parent) : undefined, e.nonce!)
  }
}
function sign(e: Record<string, unknown>): Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'> {
  const w = WBY.get(e.from as string)!
  return { ...e, publicKey: w.pk, signature: _signKrayWallet(messageFor(e as Partial<KrayEvent>), w.sk), scheme: 'kraywallet' } as never
}

// drive the SAME rich, multi-subsystem history onto a fresh node — returns the root after each step
function build(dir: string): { roots: string[]; node: KrayNode } {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const node = new KrayNode(dir, NET)
  const roots: string[] = [node.cascadeRoot()]                                             // [0] empty
  node.donate(A.addr, 1000n);                                              roots.push(node.cascadeRoot()) // [1] money+pot+emitted
  node.submit(sign({ kind: 'inscribe', at: 0, from: A.addr, contentHash: 'aurora', contentType: 'image/png', size: 42, nonce: 0 })); roots.push(node.cascadeRoot()) // [2] stars
  node.submit(sign({ kind: 'name', at: 0, from: A.addr, name: 'nova', nonce: 1 }));         roots.push(node.cascadeRoot()) // [3] star-names
  node.runeDeposit('840000:1', 'deadbeefcafe:0', A.addr, 5000n);                            roots.push(node.cascadeRoot()) // [4] rune L2
  node.submit(sign({ kind: 'amm-add', at: 0, from: A.addr, runeId: '840000:1', krayIn: '400', runeIn: '4000', minLp: '1', fee: '1', nonce: 2 })); roots.push(node.cascadeRoot()) // [5] create pool
  return { roots, node }
}

function main() {
  console.log('\n╔═ NADA FORA DA ROOT — the whole state folds into one anchored root ═╗\n')
  const { roots, node } = build(join(tmpdir(), `kraynet-rootc-a-${process.pid}`))

  // ── EACH value-bearing subsystem MOVES the root (so each is committed, none is hidden) ──
  ok(roots[1] !== roots[0], 'money + pot + emitted fold into the root — a donation moves it')
  ok(roots[2] !== roots[1], 'the star registry folds into the root — an inscription moves it')
  ok(roots[3] !== roots[2], 'star names fold into the root — a baptism moves it')
  ok(roots[4] !== roots[3], 'the rune L2 folds into the root — a proven rune deposit moves it')
  ok(roots[5] !== roots[4], 'Create pool folds into the root — the first signed amm-add writes amm: (star-name law)')
  ok(node.ledger.amm.exists('840000:1') && node.ledger.amm.runeIds().length === 1, 'Create pool: one pair, one book — a second spelling cannot exist')
  ok(new Set(roots).size === roots.length, 'every step produced a DISTINCT root — no state change is silently swallowed')

  // ── DETERMINISM — a second node on the SAME journal derives the byte-identical root at every step ──
  const { roots: roots2 } = build(join(tmpdir(), `kraynet-rootc-b-${process.pid}`))
  ok(roots.every((r, i) => r === roots2[i]), 'two independent nodes, same journal → byte-identical root at every step (pure function, no hidden state)')

  // ── REBOOT — the whole multi-subsystem root reproduces from disk alone ──
  const reboot = new KrayNode(join(tmpdir(), `kraynet-rootc-a-${process.pid}`), NET)
  ok(reboot.cascadeRoot() === roots[5], 'a reboot re-derives money+stars+runes+pot+AMM from the journal — Create pool is in the proof')

  // ── NOTHING IGNORED — one more signed event still moves the root ──
  reboot.submit(sign({ kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 3 }))
  ok(reboot.cascadeRoot() !== roots[5], 'every event moves the root — a transfer is never invisible to the anchor')

  // ── THE THREE TRIPWIRES — no value lives outside the books ──
  ok(reboot.conserves(), 'conservation: Σ balances == emitted − burned (no ₭ minted or lost outside the rules)')
  ok(reboot.backed(), 'backed: every ₭ emitted is backed by a real donated satoshi (no premine can satisfy this)')
  ok(reboot.ledger.runesSolvent(), 'runes solvent: reserve == credits + locks for every rune')
  ok(reboot.ledger.ammSolvent(), 'AMM solvent: supply === Σ holders + dead shares — the LP book cannot drift')
  ok(reboot.pot().donated === 1000n && reboot.supply().emitted === 1000n, 'the pot and the mint agree — 1000 sats sacrificed, 1000 ₭ emitted, one-to-one')

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the whole state folds into one root, byte-exact on every node; nothing of value lives outside it. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
