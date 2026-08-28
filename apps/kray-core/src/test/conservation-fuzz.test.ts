/**
 * A1 CONSERVATION FUZZ — random honest journals stay conserved; one inject still HALTs.
 *   node src/test/conservation-fuzz.test.ts
 *
 * Additive. Does not touch a live writer. Pins that the tripwire is not only the hand-built
 * H-01..H-07 cases: a seeded swarm of donate + transfer still obeys Σ = emitted − burned,
 * and a single hostile credit still freezes the next apply.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _hexToBytes, _signKrayWallet, transferMessage } from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
const ROUNDS = 64
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('a1-fuzz|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}

function nextU32(state: Buffer): [number, Buffer] {
  const h = createHash('sha256').update(state).digest()
  return [h.readUInt32BE(0), h]
}

function main() {
  console.log('\n╔═ A1 CONSERVATION FUZZ — random honest journal, then one inject ═╗\n')
  const W = [wallet('A'), wallet('B'), wallet('C')]
  const L = new KrayLedger(undefined, NET)
  let state = createHash('sha256').update('a1-fuzz|seed').digest()
  let seq = 0
  let donated = 0n

  for (let i = 0; i < ROUNDS; i++) {
    let n: number
    ;[n, state] = nextU32(state)
    const richest = W.reduce((a, b) => L.balanceOf(a.addr) >= L.balanceOf(b.addr) ? a : b)
    const canSend = L.balanceOf(richest.addr) >= 2n
    if (!canSend || (n & 1) === 0) {
      const to = W[n % 3]
      const amount = BigInt((n % 50) + 1)
      seq++
      L.applyLive({ seq, kind: 'donate', hash: 'fz-d' + seq, to: to.addr, amount: String(amount) } as KrayEvent)
      donated += amount
    } else {
      const to = W[(W.indexOf(richest) + 1 + (n % 2)) % 3]
      const maxSend = L.balanceOf(richest.addr) - 1n
      const amount = 1n + BigInt(n % Number(maxSend > 10n ? 10n : maxSend))
      if (amount + 1n > L.balanceOf(richest.addr)) continue
      const nonce = L.nonceOf(richest.addr)
      seq++
      L.applyLive({
        action: 'transfer', kind: 'transfer', at: 0,
        from: richest.addr, to: to.addr, amount: String(amount), fee: '1',
        nonce, publicKey: richest.pk,
        signature: _signKrayWallet(transferMessage(NET, richest.addr, to.addr, amount, nonce), richest.sk),
        scheme: 'kraywallet', seq, prevHash: 'x', hash: 'fz-t' + seq,
      } as unknown as KrayEvent)
    }
    if (!L.conserves() || L.haltedReason() !== null) {
      ok(false, `honest round ${i} broke conservation or halted: ${L.haltedReason()}`)
      process.exit(1)
    }
  }

  ok(seq > 0 && L.conserves() && L.haltedReason() === null, `honest swarm of ${seq} acts conserves`)
  ok(L.totalEmitted === donated, 'emitted equals the sum of honest donate amounts')
  let bookSum = 0n
  for (const b of L.balances.values()) bookSum += b
  ok(bookSum === L.totalEmitted - L.totalBurned, 'Σ every account (wallets + the 1 ₭ fee sink) == emitted − burned')

  L.balances.set(W[0].addr, L.balanceOf(W[0].addr) + 1n)
  ok(!L.conserves(), 'one injected satoshi makes conserves() false')
  let halted = false
  try {
    L.applyLive({ seq: seq + 1, kind: 'donate', hash: 'fz-lie', to: W[1].addr, amount: '1' } as KrayEvent)
  } catch (e) {
    halted = /conservation broke|HALTED/.test((e as Error).message)
  }
  ok(halted && typeof L.haltedReason() === 'string', 'the next apply HALTs — the tripwire is not only the hand-built cases')

  console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed, ${fail} failed — A1 holds under a seeded swarm.\n`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
