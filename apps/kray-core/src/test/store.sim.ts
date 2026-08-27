/**
 * THE LEDGER STORE (v2) — the cascade check for durability: state that survives a reboot
 * FROM DISK, byte-exact.  node src/test/store.sim.ts
 *
 * Appends a real signed history to a JSONL journal on disk, then boots a FRESH store from
 * that file and proves the whole v2 state re-derives byte-exact (cascade root, balances,
 * star owners, chain head). Then it fires the durability adversaries:
 *   · an INVALID append (overspend) throws and writes NOTHING (the journal never records a
 *     transition the reducer refused), and the chain keeps going
 *   · a DOCTORED middle line is caught at replay (hash-chain broken → HALT)
 *   · a TORN final line (crash mid-append) is truncated and the store boots to the last
 *     acknowledged state
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { LedgerStore } from '../protocol/store.ts'
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
  const sk = createHash('sha256').update(`kraynet-store-sim|${tag}`, 'utf8').digest()
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
function sign(e: Record<string, unknown>): Record<string, unknown> {
  const w = WBY.get(e.from as string)!
  return { ...e, publicKey: w.pk, signature: _signKrayWallet(messageFor(e as Partial<KrayEvent>), w.sk), scheme: 'kraywallet' }
}

/** a small fingerprint of the whole v2 state, for byte-exact comparison across reboots */
function fingerprint(store: LedgerStore): string {
  const L = store.ledger
  return [
    `head:${store.head}`, `seq:${store.seq}`,
    `cascade:${L.cascadeRoot()}`,
    `A:${L.balanceOf(A.addr)}`, `B:${L.balanceOf(B.addr)}`,
    `emitted:${L.totalEmitted}`, `burned:${L.totalBurned}`,
    `stars:${L.stars.starCount}`, `own0:${L.stars.ownerOf(0n)}`,
    `pot:${L.pot.satsHeld}/${L.pot.satsDonated}`,
  ].join('|')
}

function main(): void {
  const dir = join(tmpdir(), `kraynet-store-sim-${process.pid}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  // ── build a real signed history through the store (persisted to disk) ──
  const s1 = new LedgerStore(dir, NET)
  s1.append({ kind: 'donate', at: 0, to: A.addr, amount: '1000' } as never)     // mint to A
  s1.append({ kind: 'donate', at: 0, to: B.addr, amount: '500' } as never)      // mint to B
  s1.append(sign({ kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '100', fee: '1', nonce: 0 }) as never)
  s1.append(sign({ kind: 'inscribe', at: 0, from: A.addr, contentHash: 'hello', contentType: 'text/plain', size: 5, nonce: 1 }) as never) // burn → star #0
  s1.append(sign({ kind: 'name', at: 0, from: B.addr, name: 'bee', nonce: 0 }) as never)                                            // burn → star #1
  s1.append(sign({ kind: 'transfer-star', at: 0, from: A.addr, to: B.addr, star: '0', fee: '1', nonce: 2 }) as never)                    // move star #0 to B
  s1.append({ kind: 'anchor', at: 0, amount: '10' } as never)                   // an anchor spend drains the pot

  const before = fingerprint(s1)
  ok(s1.ledger.stars.ownerOf(0n) === B.addr, 'star #0 moved to B in the live store')
  ok(s1.ledger.conserves() && s1.ledger.backed(), 'live store conserves + backed')

  // ── THE REBOOT IS THE VERIFIER — a fresh store replays the SAME journal from disk ──
  const s2 = new LedgerStore(dir, NET)
  ok(fingerprint(s2) === before, 'REBOOT FROM DISK: the whole v2 state re-derives byte-exact')
  ok(s2.ledger.cascadeRoot() === s1.ledger.cascadeRoot(), 'reboot cascade root (the Bitcoin anchor) identical')
  ok(s2.head === s1.head && s2.seq === s1.seq, 'reboot chain head + seq identical')

  // ── an INVALID append writes nothing, and the chain keeps going ──
  const lenBefore = readFileSync(s2.journalPath, 'utf8').split('\n').filter((l) => l.trim()).length
  let threw = false
  try { s2.append(sign({ kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '999999', fee: '1', nonce: 3 }) as never) } catch { threw = true }
  ok(threw, 'INVALID append (overspend) threw')
  const lenAfter = readFileSync(s2.journalPath, 'utf8').split('\n').filter((l) => l.trim()).length
  ok(lenAfter === lenBefore, 'INVALID append wrote NOTHING to the journal (no half-record)')
  // a valid append still chains correctly after the rejected one
  const e = s2.append(sign({ kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '5', fee: '1', nonce: 3 }) as never)
  ok(e.seq === s1.seq + 1 && e.prevHash === before.match(/head:([0-9a-f]+)/)![1], 'the chain resumed cleanly after the rejected event')
  const s3 = new LedgerStore(dir, NET)
  ok(s3.ledger.cascadeRoot() === s2.ledger.cascadeRoot(), 'reboot after the resumed chain still byte-exact')

  // ── a DOCTORED middle line is caught at replay ──
  const dir2 = join(tmpdir(), `kraynet-store-tamper-${process.pid}`)
  rmSync(dir2, { recursive: true, force: true }); mkdirSync(dir2, { recursive: true })
  const t = new LedgerStore(dir2, NET)
  t.append({ kind: 'donate', at: 0, to: A.addr, amount: '1000' } as never)
  t.append(sign({ kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '100', fee: '1', nonce: 0 }) as never)
  t.append(sign({ kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '50', fee: '1', nonce: 1 }) as never)
  const jp = t.journalPath
  const lines = readFileSync(jp, 'utf8').split('\n').filter((l) => l.trim())
  const doctored = JSON.parse(lines[1]); doctored.amount = '900'                 // change a signed transfer's amount
  lines[1] = JSON.stringify(doctored)
  writeFileSync(jp, lines.join('\n') + '\n')
  threw = false
  try { new LedgerStore(dir2, NET) } catch { threw = true }
  ok(threw, 'DOCTORED middle line CAUGHT at replay (hash-chain broken → HALT)')

  // ── a TORN final line is truncated; the store boots to the last acknowledged state ──
  const dir3 = join(tmpdir(), `kraynet-store-torn-${process.pid}`)
  rmSync(dir3, { recursive: true, force: true }); mkdirSync(dir3, { recursive: true })
  const u = new LedgerStore(dir3, NET)
  u.append({ kind: 'donate', at: 0, to: A.addr, amount: '1000' } as never)
  u.append(sign({ kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '100', fee: '1', nonce: 0 }) as never)
  const good = fingerprint(u)
  writeFileSync(u.journalPath, readFileSync(u.journalPath, 'utf8') + '{"kind":"transfer","seq":3,"prev') // half a line, as a crash would leave mid-append
  const u2 = new LedgerStore(dir3, NET)
  ok(fingerprint(u2) === good, 'TORN final line truncated → store booted to the last acknowledged state')

  // cleanup
  for (const d of [dir, dir2, dir3]) rmSync(d, { recursive: true, force: true })
  ok(!existsSync(dir), 'temp journals cleaned up')

  console.log(`\n✓ ${pass} checks passed — THE LEDGER STORE HOLDS: a real signed history persisted to a JSONL journal on disk, re-derived byte-exact by a fresh store (cascade root, balances, star owners, chain head all identical), an invalid append wrote nothing and the chain resumed cleanly, a doctored middle line was caught at replay (hash-chain HALT), and a torn final line was truncated to the last acknowledged state. The v2 state survives reboots — durable, tamper-evident, atemporal. 💾⭐`)
}
main()
