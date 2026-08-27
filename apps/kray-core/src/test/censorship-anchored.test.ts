/**
 * THE FULLY-ANCHORED CENSORSHIP VERDICT (ADR-3 3d, the last link closed) — the windowSealsRoot the verdict rests
 * on is now PROVEN to be what Bitcoin anchored, via the cascade OPENING, not asserted.
 *
 *   node src/test/censorship-anchored.test.ts
 *
 * Pins:
 *   1. THE OPENING IS FAITHFUL — a real ledger's parts re-hash (cascadeRootFromParts) to its own cascade root,
 *      even in the ACTIVATED state that folds the inclusion + window roots (so no drift from ledger.cascadeRoot()).
 *   2. THE LAST LINK CLOSES — verifyCensorshipAnchored returns CENSORED only when the revealed parts open to the
 *      anchored root; a FABRICATED window root (the exact false-CENSORED lever the live-3d council named) does NOT
 *      re-hash to the anchored root and is refused at the opening.
 */
import { createHash } from 'node:crypto'
import { KrayLedger } from '../protocol/ledger.ts'
import { DEFAULT_POT_TARGET_SATS } from '../protocol/pot.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage } from '../protocol/scheme.ts'
import * as btc from '@scure/btc-signer'
import { cascadeRootFromParts, type CascadeParts } from '../protocol/cascade-root.ts'
import { verifyCensorshipAnchored, buildCensorshipClaim, windowCommitment } from '../protocol/censorship-evidence.ts'
import { inclusionRoot, proveKey, IncrementalInclusionTree } from '../protocol/inclusion-tree.ts'
import { availabilityRoot, availabilityPayload, proveAvailability } from '../protocol/availability.ts'
import { sha256d, checkProofOfWork } from '../anchor/spv.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const key = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const NET = 'regtest', BNET = toBtcNet(NET)

// ── the same real 2-tx Bitcoin availability block as the other exams ──
function buildHeader(m: Buffer): Buffer {
  const hh = Buffer.alloc(80); hh.writeUInt32LE(0x20000000, 0); m.copy(hh, 36); hh.writeUInt32LE(1_700_000_000, 68); hh.writeUInt32LE(0x207fffff, 72)
  for (let n = 1; n < 4_000_000; n++) { hh.writeUInt32LE(n >>> 0, 76); if (checkProofOfWork(hh.toString('hex'), 'regtest').ok) return hh }
  throw new Error('mine')
}
function rawTx(ss: string, os: string): string {
  const s = Buffer.from(ss, 'hex'), o = Buffer.from(os, 'hex')
  return Buffer.concat([Buffer.from('01000000', 'hex'), Buffer.from('01', 'hex'), Buffer.alloc(32), Buffer.from('ffffffff', 'hex'), Buffer.from([s.length]), s, Buffer.from('ffffffff', 'hex'), Buffer.from('01', 'hex'), Buffer.alloc(8), Buffer.from([o.length]), o, Buffer.from('00000000', 'hex')]).toString('hex')
}
function availAt(h: number, availRoot: string, membership: ReturnType<typeof proveAvailability>) {
  const b = Buffer.alloc(4); b.writeUInt32LE(h); let n = 4; while (n > 1 && b[n - 1] === 0) n--
  const coinbaseTx = rawTx(Buffer.concat([Buffer.from([n]), b.subarray(0, n)]).toString('hex'), '51')
  const availTx = rawTx('00', '6a' + '2f' + availabilityPayload(availRoot))
  const l0 = sha256d(Buffer.from(coinbaseTx, 'hex')), l1 = sha256d(Buffer.from(availTx, 'hex'))
  const header = buildHeader(sha256d(Buffer.concat([l0, l1])))
  const mb = (f: number) => Buffer.concat([header, Buffer.from([2, 0, 0, 0]), Buffer.from([2]), l0, l1, Buffer.from([1]), Buffer.from([f])]).toString('hex')
  return { rawTx: availTx, txoutproof: mb(0x05), headers: [header.toString('hex')], coinbaseTx, coinbaseTxOutProof: mb(0x03), membership }
}

interface Act { key: string; deadline: number; valid: boolean }
const rules = { keyOf: (a: Act) => a.key, isValid: (a: Act) => a.valid, deadlineOf: (a: Act) => a.deadline }
const SPV = { net: 'regtest', minConfirmations: 1 }

function main() {
  console.log('\n╔═ THE FULLY-ANCHORED CENSORSHIP VERDICT — the last link closed by the cascade opening (ADR-3 3d) ═╗\n')

  // ── 1 · RICH GOLDEN — the exact BYTES of the conditional folds (seals + inclusion + window), frozen. The base
  //    fields are pinned by 65876acc (inclusion-cascade); this pins the folds this ADR-3 work added/touches, so a
  //    future reorder/relabel of cascadeParts() that would silently orphan an anchored root fails EXIT 1 (council:
  //    a bare cascadeRootFromParts(cascadeParts())===cascadeRoot() is a tautology — cascadeRoot() IS that call). ──
  {
    // Re-captured 2026-08-26 under THE CHAIR LAW (pot target 21,000,000 = 2,100 × 10,000): the pot folds
    // into the cascade root, so the target change moved this golden (pre-chair value: 54ba4af2…5a52).
    const RICH_GOLDEN = '3a1ebcdf4c133ca9a6561063311a59b276d9f67ab0e74e5cf44d607dfd645643'
    const mk = (t: string) => { const sk = createHash('sha256').update('rich|' + t).digest(); const pk = _generateKeyPair(sk).publicKeyHex; return { addr: btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[BNET]).address!, sk, pk } }
    const A = mk('A'), B = mk('B')
    const led = new KrayLedger(undefined, NET, undefined, false, undefined, 0)   // inclusion + window ACTIVE
    led.applyLive({ kind: 'donate', at: 0, to: A.addr, amount: '10000', seq: 1, prevHash: 'x', hash: 'y', outpoint: 'rich:donate:0' } as unknown as KrayEvent)
    led.applyLive({ action: 'transfer', kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 0, publicKey: A.pk, signature: _signKrayWallet(transferMessage(NET, A.addr, B.addr, 10n, 0), A.sk), scheme: 'kraywallet', seq: 2, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
    led.applyLive({ kind: 'seal', at: 0, l1Txid: 'f'.repeat(64), l1Height: 850_000, l1Root: led.cascadeRoot(), l1BlockNumber: 0, seq: 3, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
    const p = led.cascadeParts()
    ok(p.seals !== undefined && p.inclusionRoot !== undefined && p.windowRoot !== undefined && p.nonceRoot !== undefined, 'the state exercises the seals + inclusion + window + nonce conditional folds')
    ok(led.cascadeRoot() === RICH_GOLDEN, 'the ACTIVATED, seal-bearing cascade root (now folding the nonce root LAST, append-only) is byte-frozen — any reorder/relabel of the conditional folds breaks this golden (a real oracle, not the tautology of cascadeRoot() === cascadeRootFromParts(cascadeParts()))')
    ok(cascadeRootFromParts(p) === RICH_GOLDEN, 'and cascadeRootFromParts opens those exact bytes — the verifier and the writer are one function over the frozen parts')
  }

  // ── 2 · the anchored verdict: CENSORED only when the parts OPEN to the anchored root ──
  {
    const K = key('victim|nonce7')
    const R = inclusionRoot([key('other')])                     // the inclusion root at the seal — WITHOUT K
    const seal = 950_000
    const wc = windowCommitment(seal, R)
    const windowRoot = inclusionRoot([wc])
    const parts: CascadeParts = {                                // a minimal valid opening whose window root holds wc
      seq: 42, emitted: '10000', burned: '0', moneyRoot: key('money'), starsRoot: key('stars'),
      potCommitment: 'pot:whatever', runesCommitment: key('runes'), contractsRoot: '',
      inclusionRoot: key('current-incl'), windowRoot,
    }
    const anchoredCascadeRoot = cascadeRootFromParts(parts)      // = the 32 bytes Bitcoin would seal
    const availabilityProof = availAt(850_000, availabilityRoot([K]), proveAvailability([K], K))
    const claim = {
      act: { key: K, deadline: 900_000, valid: true } as Act, seal, inclusionRoot: R,
      absenceProof: proveKey([key('other')], K), windowMembership: proveKey([wc], wc),
      availabilityProof, cascadeParts: parts, anchoredCascadeRoot,
    }
    const v = verifyCensorshipAnchored(claim, rules, SPV)
    ok(v.censored === true, 'CENSORED: the revealed parts re-hash to the anchored root, so the window root is ANCHORED — every link is now a Bitcoin fact, windowSealsRoot no longer trusted')

    // THE LAST-LINK ATTACK the live-3d council named: a FABRICATED window root that excludes an included act.
    const fakeWindowRoot = inclusionRoot([windowCommitment(seal, inclusionRoot([key('a-root-never-sealed')]))])
    const forged = { ...claim, cascadeParts: { ...parts, windowRoot: fakeWindowRoot } }   // anchoredCascadeRoot unchanged
    const vf = verifyCensorshipAnchored(forged, rules, SPV)
    ok(vf.censored === false && /do not re-hash to the anchored root/.test((vf as { reason: string }).reason), 'FABRICATED window root REFUSED: parts with an attacker-chosen window root no longer re-hash to the anchored root — the false-CENSORED lever the council named is CLOSED')

    // a well-typed but garbage opening fails closed, never throws
    const bad = { ...claim, cascadeParts: { ...parts, moneyRoot: undefined as unknown as string } }
    const vb = verifyCensorshipAnchored(bad, rules, SPV)
    ok(vb.censored === false, 'a malformed opening fails closed to a verdict, never a crash')
  }

  // ── 3 · THE PROVER/VERIFIER SYMMETRY — buildCensorshipClaim GENERATES the evidence, verifyCensorshipAnchored
  //    checks it. What a citizen runs to make the case, and what anyone runs to confirm it — one round trip. ──
  {
    const K = key('prover|victim')
    const tree = new IncrementalInclusionTree()                 // the inclusion tree AT the seal — WITHOUT K
    tree.insert(key('someone|else')); tree.insert(key('another|act'))
    const seal = 950_000
    const wc = windowCommitment(seal, tree.root())
    const windowSeals = [wc]
    const parts: CascadeParts = {
      seq: 99, emitted: '10000', burned: '0', moneyRoot: key('m'), starsRoot: key('s'),
      potCommitment: 'pot:x', runesCommitment: key('r'), contractsRoot: '',
      inclusionRoot: tree.root(), windowRoot: inclusionRoot(windowSeals),
    }
    const state = { seal, inclusionTree: tree, windowSeals, cascadeParts: parts, anchoredCascadeRoot: cascadeRootFromParts(parts) }
    const availabilityProof = availAt(850_000, availabilityRoot([K]), proveAvailability([K], K))
    const act = { key: K, deadline: 900_000, valid: true } as Act

    const claim = buildCensorshipClaim(act, availabilityProof, state, rules)   // the PROVER assembles the evidence
    const v = verifyCensorshipAnchored(claim, rules, SPV)                       // the VERIFIER checks it
    ok(v.censored === true, 'PROVER→VERIFIER: buildCensorshipClaim assembles the evidence straight from the chain state, and verifyCensorshipAnchored returns CENSORED — the omission path is usable end to end (generate AND check)')
    // and the prover is honest: if K IS in the tree, the same round trip returns NOT censored (absence proof fails)
    tree.insert(K)
    const parts2: CascadeParts = { ...parts, inclusionRoot: tree.root(), windowRoot: inclusionRoot([windowCommitment(seal, tree.root())]) }
    const state2 = { seal, inclusionTree: tree, windowSeals: [windowCommitment(seal, tree.root())], cascadeParts: parts2, anchoredCascadeRoot: cascadeRootFromParts(parts2) }
    const claim2 = buildCensorshipClaim(act, availabilityProof, state2, rules)
    ok(verifyCensorshipAnchored(claim2, rules, SPV).censored === false, 'and once K IS included, the prover builds a claim the verifier rightly REJECTS — a citizen cannot manufacture a false CENSORED from an included act')
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the window root is proven anchored by the cascade opening; every link of the verdict is re-derived from bytes, the only external input being the anchoredCascadeRoot the (already-proven) anchor SPV hands over. No trusted window root, no second pen. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
