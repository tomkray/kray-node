/**
 * A1 IS A HALT, NOT A REPORT — prove by breaking:
 *   node src/test/conservation-halt.test.ts
 *
 *   H-01  an honest donate conserves; applyLive does not throw
 *   H-02  a hostile inject (₭ credited with no emission) makes conserves() false
 *   H-03  the NEXT apply throws conservation-HALT and the ledger stays halted
 *   H-04  store.append of that next act never reaches the journal
 *   H-05  the store is poisoned — a later append is refused
 *   H-06  restart replays only the durable honest line and conserves
 *   H-07  x-send refuses hex / padded amounts (canonical-decimal law — JS/Rust twin-fork)
 */
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { LedgerStore } from '../protocol/store.ts'
import { NETWORKS, _generateKeyPair, _hexToBytes, _signKrayWallet, inscribeMessageV2, xSendMessage } from '../protocol/scheme.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string): void => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
function wallet(tag: string) {
  const sk = createHash('sha256').update('a1-halt|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}

function main() {
  console.log('\n╔═ A1 CONSERVATION-OR-HALT — the tripwire is a freeze, not a boolean ═╗\n')
  const A = wallet('A')
  const B = wallet('B')

  console.log('H-01 — an honest donate conserves')
  const L = new KrayLedger(undefined, NET)
  L.applyLive({ seq: 1, kind: 'donate', hash: 'd1', to: A.addr, amount: '100' } as KrayEvent)
  ok(L.conserves() && L.haltedReason() === null && L.balanceOf(A.addr) === 100n, 'honest donate: conserved, not halted')

  console.log('\nH-02 — a hostile inject breaks the books (the only way to trip A1 without a reducer bug)')
  L.balances.set(A.addr, L.balanceOf(A.addr) + 1n)
  ok(!L.conserves() && L.haltedReason() === null, 'inject made conserves() false; HALT has not fired yet')

  console.log('\nH-03 — the next apply HALTs and stays halted')
  rejects(
    () => L.applyLive({ seq: 2, kind: 'donate', hash: 'd2', to: B.addr, amount: '10' } as KrayEvent),
    /conservation broke at seq 2/,
    'applyLive throws A1 HALT after the inject',
  )
  ok(typeof L.haltedReason() === 'string' && /seq 2/.test(L.haltedReason()!), 'the ledger records why it froze')
  rejects(
    () => L.applyLive({ seq: 3, kind: 'donate', hash: 'd3', to: B.addr, amount: '1' } as KrayEvent),
    /HALTED/,
    'every later apply is refused — dirty RAM cannot keep serving',
  )

  console.log('\nH-04/H-05/H-06 — store never journals the lie; poison; restart is clean')
  const dir = join(tmpdir(), 'kray-a1-halt-' + process.pid)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  try {
    const S = new LedgerStore(dir, NET)
    S.append({ kind: 'donate', at: 0, to: A.addr, amount: '100' } as Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'>)
    S.ledger.balances.set(A.addr, S.ledger.balanceOf(A.addr) + 1n)
    ok(!S.ledger.conserves(), 'the live book is lying before the next append')
    rejects(
      () => S.append({ kind: 'donate', at: 0, to: B.addr, amount: '10' } as Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'>),
      /conservation broke/,
      'store.append surfaces the A1 HALT',
    )
    const jp = join(dir, `kraynet-journal-${NET}.jsonl`)
    const lines = existsSync(jp) ? readFileSync(jp, 'utf8').split('\n').filter((l) => l.trim()) : []
    ok(lines.length === 1, 'the conservation-breaking act NEVER reached the journal')
    rejects(
      () => S.append({ kind: 'donate', at: 0, to: B.addr, amount: '1' } as Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'>),
      /HALTED/,
      'the store is poisoned — the next seq cannot ride a dirty book',
    )
    const S2 = new LedgerStore(dir, NET)
    ok(S2.ledger.conserves() && S2.ledger.balanceOf(A.addr) === 100n && S2.ledger.balanceOf(B.addr) === 0n && S2.ledger.haltedReason() === null,
      'restart replays only the durable honest donate — conserved, not halted')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  console.log('\nH-07 — x-send amounts are the same canonical-decimal law as the lane (no JS/Rust twin-fork)')
  const W = wallet('X')
  const Z = wallet('Z')
  const X = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, 1) // Ӿ transfers live from seq 1
  X.applyLive({ seq: 1, kind: 'donate', hash: 'dx', to: W.addr, amount: '50' } as KrayEvent)
  const ch = sha256hex('a1-inscribe')
  const n0 = X.nonceOf(W.addr)
  X.applyLive({
    seq: 2, kind: 'inscribe', hash: 'ins', from: W.addr, contentHash: ch, contentType: 'text/plain', size: 8,
    nonce: n0, publicKey: W.pk, signature: _signKrayWallet(inscribeMessageV2(NET, W.addr, ch, 'text/plain', 8, undefined, n0), W.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(X.xBalanceOf(W.addr) === 1n && X.conserves(), 'inscribe minted 1 Ӿ; books still conserve')
  const n1 = X.nonceOf(W.addr)
  const hexEvt = {
    seq: 3, kind: 'x-send', hash: 'hex', from: W.addr, to: Z.addr, amount: '0x10', fee: '1',
    nonce: n1, publicKey: W.pk, signature: _signKrayWallet(xSendMessage(NET, W.addr, Z.addr, 16n, n1), W.sk), scheme: 'kraywallet',
  } as KrayEvent
  rejects(() => X.applyLive(hexEvt), /canonical decimal/, 'x-send refuses 0x10 — BigInt would have accepted 16')
  rejects(
    () => X.applyLive({ ...hexEvt, amount: '01', signature: _signKrayWallet(xSendMessage(NET, W.addr, Z.addr, 1n, n1), W.sk) } as KrayEvent),
    /canonical decimal/,
    'x-send refuses a leading-zero pad',
  )
  const honest = {
    seq: 3, kind: 'x-send', hash: 'ok', from: W.addr, to: Z.addr, amount: '1', fee: '1',
    nonce: n1, publicKey: W.pk, signature: _signKrayWallet(xSendMessage(NET, W.addr, Z.addr, 1n, n1), W.sk), scheme: 'kraywallet',
  } as KrayEvent
  X.applyLive(honest)
  ok(X.xBalanceOf(Z.addr) === 1n && X.conserves() && X.haltedReason() === null, 'canonical x-send of 1 applies; tripwire quiet')

  console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed, ${fail} failed — A1 is a freeze.\n`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
