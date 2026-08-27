/**
 * THE ANCHOR (v2) — the v2 cascade root IS a valid, auditable Bitcoin commitment.
 *   node src/test/anchor.sim.ts
 *
 * The KrayAnchor OP_RETURN transport is model-agnostic (reused, never duplicated): it takes a
 * plain 32-byte root. This proves the v2 KrayLedger.cascadeRoot() feeds it cleanly — for many
 * states, KrayAnchor.payload(blockNumber, cascadeRoot) round-trips through KrayAnchor.decode
 * back to the EXACT (blockNumber, root), the payload is the canonical 49 bytes, and changing a
 * single byte of the root or the block number flips it (tamper-evident). It also proves the
 * anchor CYCLE: an `anchor` event spends pot sats to pay the L1 fee, draining the pot and
 * reopening the mint deficit — the self-regulating loop. (The live Bitcoin broadcast is the
 * one piece that needs a regtest node; the payload it would carry is proven here.)
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { KrayAnchor } from '../anchor/anchor.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, inscribeMessageV2,
} from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}

const NET = 'regtest'
const sk = createHash('sha256').update('kraynet-anchor-sim|A', 'utf8').digest()
const { publicKeyHex: pk } = _generateKeyPair(sk)
const ADDR = btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[toBtcNet(NET)]).address!

function main(): void {
  // ── many states → the cascade root anchors + round-trips exactly ──
  for (let n = 0; n < 40; n++) {
    const L = new KrayLedger()
    let seq = 0
    const H = () => createHash('sha256').update(`a|${n}|${seq}`, 'utf8').digest('hex')
    seq++; L.applyLive({ seq, kind: 'donate', hash: H(), to: ADDR, amount: (100 + n * 7).toString() } as KrayEvent)
    if (n % 2 === 0) {
      seq++
      const msg = inscribeMessageV2(NET, ADDR, 'art-' + n, 'text/plain', 5, undefined, 0)
      L.applyLive({ seq, kind: 'inscribe', hash: H(), from: ADDR, contentHash: 'art-' + n, contentType: 'text/plain', size: 5, nonce: 0, publicKey: pk, signature: _signKrayWallet(msg, sk), scheme: 'kraywallet' } as KrayEvent)
    }
    const root = L.cascadeRoot()
    ok(/^[0-9a-f]{64}$/.test(root), `state ${n}: cascade root is 32-byte hex`)
    const blockNumber = 800000 + n
    const payload = KrayAnchor.payload(blockNumber, root)
    ok(payload.length === 98, `state ${n}: OP_RETURN payload is the canonical 49 bytes`)
    const decoded = KrayAnchor.decode(payload)
    ok(decoded !== null, `state ${n}: payload decodes as a KRAY.NETWORK anchor`)
    ok(decoded!.root === root, `state ${n}: decode recovers the EXACT cascade root`)
    ok(decoded!.blockNumber === blockNumber, `state ${n}: decode recovers the exact block number`)
  }

  // ── tamper-evidence: one byte off ⇒ a different (or invalid) anchor ──
  const L = new KrayLedger()
  L.applyLive({ seq: 1, kind: 'donate', hash: 'a'.repeat(64), to: ADDR, amount: '100' } as KrayEvent)
  const root = L.cascadeRoot()
  const payload = KrayAnchor.payload(770000, root)
  const flipped = root.slice(0, 63) + (root[63] === 'a' ? 'b' : 'a')
  ok(KrayAnchor.payload(770000, flipped) !== payload, 'TAMPER: one flipped byte of the root ⇒ a different OP_RETURN')
  ok(KrayAnchor.payload(770001, root) !== payload, 'TAMPER: a different block number ⇒ a different OP_RETURN')
  ok(KrayAnchor.decode('00'.repeat(49)) === null, 'a non-KRAY payload decodes to null (an auditor rejects it)')

  // ── the anchor CYCLE: an anchor spend drains the pot and reopens the mint deficit ──
  const M = new KrayLedger(1000n)                 // small pot target
  M.applyLive({ seq: 1, kind: 'donate', hash: 'b'.repeat(64), to: ADDR, amount: '5000' } as KrayEvent) // overfills; deficit 0
  ok(!M.pot.isOpen(), 'pot full after a donation past target — mint closed')
  const beforeRoot = M.cascadeRoot()
  M.applyLive({ seq: 2, kind: 'anchor', hash: 'c'.repeat(64), amount: '200' } as KrayEvent)             // pay a 200-sat L1 anchor fee
  ok(M.pot.satsHeld === 4800n && M.pot.satsSpent === 200n, 'ANCHOR spent 200 sats from the pot')
  ok(M.pot.isOpen() === false, 'pot still above target (4800 > 1000) — mint stays closed')
  M.applyLive({ seq: 3, kind: 'anchor', hash: 'd'.repeat(64), amount: '4000' } as KrayEvent)            // drain deeper
  ok(M.pot.isOpen() && M.pot.deficit() === 200n, 'anchoring drained the pot below target → mint REOPENED (deficit 200)')
  ok(M.cascadeRoot() !== beforeRoot, 'each anchor spend flips the cascade root (the pot is in the commitment)')
  ok(M.conserves() && M.backed(), 'anchoring never touches ₭ conservation or the peg')

  console.log(`\n✓ ${pass} checks passed — THE ANCHOR HOLDS: the v2 cascade root feeds the reused KrayAnchor OP_RETURN cleanly — 40 states each round-tripped payload→decode back to the EXACT (blockNumber, root), the payload is the canonical 49 bytes, one flipped byte flips the commitment (tamper-evident), a non-KRAY payload is rejected, and the anchor cycle (spend pot sats → drain → reopen the mint deficit) holds without ever touching ₭ conservation. The proof on Bitcoin is ready; only the live broadcast needs a regtest node. ⛓₭`)
}
main()
