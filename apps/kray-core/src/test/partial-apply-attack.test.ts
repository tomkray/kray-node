/**
 * PARTIAL-APPLY ATTACK — the three defects the adversarial swarm confirmed, now reproduced and
 * proven closed. Each is the same disease: a refused event must leave NO trace, or the live
 * cascade root silently forks from the journal (and from every honest node) and the Bitcoin
 * anchor commits a root no replay can reproduce.
 *
 *   C1 · a `name` whose value is a JSON NUMBER once burned 1 ₭ + bumped the nonce, THEN threw
 *        inside stars.applyLive (foldSeparators on a non-string) — partial state, never journaled.
 *   C3 · an `origin` whose l1InscriptionId is a NUMBER — same class (.split on a non-string).
 *   C2 · a durable-write failure after the reducer advanced in memory desynced the store and let
 *        the next event reuse a seq and journal-without-applying — now a hard fail-stop.
 *
 *   node src/test/partial-apply-attack.test.ts
 */
import { rmSync, mkdirSync, chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { LedgerStore } from '../protocol/store.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, nameMessageV2, originMessageV2 } from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const wallet = (tag: string) => { const sk = createHash('sha256').update('paa|' + tag).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk, addr: btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[toBtcNet(NET)]).address! } }

// a full snapshot of everything a refused event must NOT move
const snap = (L: KrayLedger, a: string) => ({ bal: L.balanceOf(a), nonce: L.nonceOf(a), emitted: L.totalEmitted, burned: L.totalBurned, root: L.cascadeRoot(), conserves: L.conserves() })
const same = (x: any, y: any) => x.bal === y.bal && x.nonce === y.nonce && x.emitted === y.emitted && x.burned === y.burned && x.root === y.root

function main() {
  console.log('\n╔═ PARTIAL-APPLY ATTACK — a refused event must leave no trace ═══╗')

  // ── C1 · a `name` field that is a JSON NUMBER ────────────────────────────
  console.log('\n─ C1 · name = 123 (a number, not a string) ─')
  {
    const w = wallet('c1')
    const L = new KrayLedger(undefined as any, NET)
    L.applyLive({ seq: 1, kind: 'donate', hash: 'h1', to: w.addr, amount: '100', outpoint: 'c1:0' } as KrayEvent)
    const before = snap(L, w.addr)
    ok(before.bal === 100n && before.nonce === 0 && before.burned === 0n, 'setup: funded 100 ₭, nonce 0, burned 0')
    // the attack: name is the NUMBER 123. The message builder coerces it to "123", so the attacker
    // signs a message that verifies — exactly the payload that used to slip past requireSig.
    const msg = nameMessageV2(NET, w.addr, 0, 123 as any, undefined)
    const evil = { seq: 2, kind: 'name', hash: 'h2', from: w.addr, nonce: 0, name: 123 as any, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet' } as unknown as KrayEvent
    let threw = false, why = ''
    try { L.applyLive(evil) } catch (e) { threw = true; why = (e as Error).message }
    ok(threw, 'the malformed name is REFUSED (throws)')
    ok(/must be a string/.test(why), 'refused by the shape gate, before any mutation — "' + why.slice(0, 60) + '…"')
    const after = snap(L, w.addr)
    ok(same(before, after), 'NO trace: balance, nonce, burned AND cascadeRoot are byte-identical to before')
    ok(after.conserves, 'conservation still holds (no silent drift)')
  }

  // ── C3 · an `origin` l1InscriptionId that is a NUMBER ────────────────────
  console.log('\n─ C3 · origin l1InscriptionId = 999 (a number) ─')
  {
    const w = wallet('c3')
    const L = new KrayLedger(undefined as any, NET)
    L.applyLive({ seq: 1, kind: 'donate', hash: 'h1', to: w.addr, amount: '100', outpoint: 'c3:0' } as KrayEvent)
    const before = snap(L, w.addr)
    const msg = originMessageV2(NET, w.addr, 999 as any, 'deadbeef', 'text/plain', 3, 0)
    const evil = { seq: 2, kind: 'origin', hash: 'h2', from: w.addr, nonce: 0, l1InscriptionId: 999 as any, contentHash: 'deadbeef', contentType: 'text/plain', size: 3, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet' } as unknown as KrayEvent
    let threw = false, why = ''
    try { L.applyLive(evil) } catch (e) { threw = true; why = (e as Error).message }
    ok(threw && /(must be|needs) a string/.test(why), 'the malformed origin is REFUSED by the shape gate — "' + why.slice(0, 50) + '…"')
    const after = snap(L, w.addr)
    ok(same(before, after), 'NO trace: balance, nonce, burned AND cascadeRoot unchanged')
    ok(after.conserves, 'conservation still holds')
  }

  // ── positive control — a WELL-FORMED name still works exactly as before ──
  console.log('\n─ control · a valid string name still baptizes normally ─')
  {
    const w = wallet('ctl')
    const L = new KrayLedger(undefined as any, NET)
    L.applyLive({ seq: 1, kind: 'donate', hash: 'h1', to: w.addr, amount: '100', outpoint: 'ctl:0' } as KrayEvent)
    const msg = nameMessageV2(NET, w.addr, 0, 'nova', undefined)
    const good = { seq: 2, kind: 'name', hash: 'h2', from: w.addr, nonce: 0, name: 'nova', publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet' } as unknown as KrayEvent
    let okApply = true; try { L.applyLive(good) } catch { okApply = false }
    ok(okApply, 'a valid name applies without error (the gate does not touch honest events)')
    ok(L.balanceOf(w.addr) === 99n && L.totalBurned === 1n && L.nonceOf(w.addr) === 1, 'it burned exactly 1 ₭, bumped the nonce — normal baptism')
    ok(L.conserves(), 'conservation holds')
  }

  // ── C2 · a durable-write failure must fail-stop, never desync ────────────
  console.log('\n─ C2 · a write failure after the reducer advanced → hard halt, journal stays clean ─')
  {
    const dir = join(tmpdir(), `kraynet-paa-${process.pid}`)
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    const jpath = join(dir, `kraynet-journal-${NET}.jsonl`)
    try {
      const S = new LedgerStore(dir, NET)
      const a = wallet('c2a').addr, b = wallet('c2b').addr
      S.append({ kind: 'donate', to: a, amount: '50', outpoint: 'c2:a' } as any)   // durable event #1
      const emittedAfter1 = S.ledger.totalEmitted
      ok(emittedAfter1 === 50n, 'event #1 (donate 50) is durable')

      chmodSync(jpath, 0o444)                                                       // make the journal unwritable
      let threw = false, why = ''
      try { S.append({ kind: 'donate', to: b, amount: '77', outpoint: 'c2:b' } as any) } catch (e) { threw = true; why = (e as Error).message }
      ok(threw && /DURABLE WRITE FAILED/.test(why), 'the write failure is caught and surfaced as a fatal — "' + why.slice(0, 45) + '…"')

      let secondThrew = false, why2 = ''
      try { S.append({ kind: 'donate', to: b, amount: '1', outpoint: 'c2:c' } as any) } catch (e) { secondThrew = true; why2 = (e as Error).message }
      ok(secondThrew && /HALTED/.test(why2), 'the store is POISONED — every later append is refused, so no seq is ever reused')

      chmodSync(jpath, 0o644)                                                       // restore for a clean restart
      const S2 = new LedgerStore(dir, NET)                                          // the restart: replay the durable journal
      ok(S2.ledger.totalEmitted === 50n, 'the RESTARTED node has only event #1 — the failed 77 never entered history (no phantom mint)')
      ok(S2.ledger.balanceOf(b) === 0n, 'the recipient of the failed event has nothing — the durable chain is consistent')
      ok(S2.ledger.conserves(), 'the restarted ledger conserves')
    } finally { try { chmodSync(jpath, 0o644) } catch {} rmSync(dir, { recursive: true, force: true }) }
  }

  // ── C4 · a torn write that drops only the trailing newline must not glue or lose events ──
  console.log('\n─ C4 · torn write (newline lost) → unterminated tail dropped, no gluing, no HALT ─')
  {
    const dir = join(tmpdir(), `kraynet-paa-torn-${process.pid}`)
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    const jpath = join(dir, `kraynet-journal-${NET}.jsonl`)
    try {
      const a = wallet('c4a').addr, b = wallet('c4b').addr
      const S1 = new LedgerStore(dir, NET)
      S1.append({ kind: 'donate', to: a, amount: '10', outpoint: 'c4:1' } as any)   // ev1 — acked, newline-terminated
      S1.append({ kind: 'donate', to: a, amount: '20', outpoint: 'c4:2' } as any)   // ev2 — we will tear its newline off
      writeFileSync(jpath, readFileSync(jpath, 'utf8').replace(/\n$/, ''))            // simulate the torn write: `{ev1}\n{ev2}` (ev2 unterminated)
      ok(!readFileSync(jpath, 'utf8').endsWith('\n'), 'setup: journal now ends WITHOUT a newline (a torn ev2)')

      const S2 = new LedgerStore(dir, NET)                                            // restart #1
      ok(S2.ledger.totalEmitted === 10n, 'the unterminated (torn) tail is DROPPED on restart — only the acked event #1 survives')
      ok(readFileSync(jpath, 'utf8').endsWith('\n'), 'the journal was re-normalized to end in a newline — a later append cannot glue')

      S2.append({ kind: 'donate', to: b, amount: '30', outpoint: 'c4:3' } as any)     // ev3 — must chain from ev1, not glue onto ev2
      const S3 = new LedgerStore(dir, NET)                                            // restart #2
      ok(S3.ledger.totalEmitted === 40n, 'after a post-torn append, a restart replays #1 + #3 cleanly — no gluing, no silent loss, no HALT')
      ok(S3.ledger.balanceOf(b) === 30n && S3.ledger.conserves(), 'the chain is intact and conserves')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — a refused event leaves no trace; a write failure halts instead of forking. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
