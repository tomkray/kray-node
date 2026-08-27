/**
 * THE LIVE CENSORSHIP VERDICT (ADR-3 3d, wired) — the four proven pieces unite into ONE trustless verdict.
 *
 *   node src/test/censorship-live.test.ts
 *
 * verifyCensorshipLive takes an act, its availability witness (a real 2-tx Bitcoin block, SPV-re-derived), the
 * cumulative inclusion root, a 3a absence proof, and the seal-window root with a membership proof — and returns
 * CENSORED only when EVERY link holds on Bitcoin: the act was public by height H ≤ its signed deadline (C +
 * availability), the seal committed exactly this inclusion root (3d-a window membership), the seal ≥ deadline,
 * and the act's key is provably ABSENT from that anchored root (3a). Every not-censored case names its reason.
 *
 * The one remaining trusted link is `windowSealsRoot` itself (the full cascade opening is owed) — every OTHER
 * link is trustless here. This proves the composition; it is honest about the last mechanical step.
 */
import { createHash } from 'node:crypto'
import { verifyCensorshipLive } from '../protocol/censorship-evidence.ts'
import { inclusionRoot, proveKey } from '../protocol/inclusion-tree.ts'
import { availabilityRoot, availabilityPayload, proveAvailability } from '../protocol/availability.ts'
import { windowCommitment } from '../protocol/censorship-evidence.ts'
import { sha256d, checkProofOfWork } from '../anchor/spv.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const key = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

// ── a synthetic, fully valid 2-tx Bitcoin block (coinbase@0 with a BIP-34 height + the availability tx@1) ──
function buildHeader(merkleRootInternal: Buffer): Buffer {
  const hh = Buffer.alloc(80)
  hh.writeUInt32LE(0x20000000, 0); merkleRootInternal.copy(hh, 36)
  hh.writeUInt32LE(1_700_000_000, 68); hh.writeUInt32LE(0x207fffff, 72)
  for (let n = 1; n < 4_000_000; n++) { hh.writeUInt32LE(n >>> 0, 76); if (checkProofOfWork(hh.toString('hex'), 'regtest').ok) return hh }
  throw new Error('could not mine a regtest header')
}
function rawTx(scriptSigHex: string, outScriptHex: string): string {
  const ss = Buffer.from(scriptSigHex, 'hex'), os = Buffer.from(outScriptHex, 'hex')
  return Buffer.concat([Buffer.from('01000000', 'hex'), Buffer.from('01', 'hex'), Buffer.alloc(32), Buffer.from('ffffffff', 'hex'),
    Buffer.from([ss.length]), ss, Buffer.from('ffffffff', 'hex'), Buffer.from('01', 'hex'), Buffer.alloc(8), Buffer.from([os.length]), os, Buffer.from('00000000', 'hex')]).toString('hex')
}
/** an availability proof putting `availRoot` on Bitcoin at coinbase height `h` (a real, buried 2-tx block). */
function availabilityProofAt(h: number, availRoot: string, membership: ReturnType<typeof proveAvailability>) {
  const heightPush = (() => { const b = Buffer.alloc(4); b.writeUInt32LE(h); let n = 4; while (n > 1 && b[n - 1] === 0) n--; return Buffer.concat([Buffer.from([n]), b.subarray(0, n)]).toString('hex') })()
  const coinbaseTx = rawTx(heightPush, '51')
  const availTx = rawTx('00', '6a' + '2f' + availabilityPayload(availRoot))   // OP_RETURN(0x6a) + push 47 + payload
  const leaf0 = sha256d(Buffer.from(coinbaseTx, 'hex')), leaf1 = sha256d(Buffer.from(availTx, 'hex'))
  const header = buildHeader(sha256d(Buffer.concat([leaf0, leaf1])))
  const mb = (flags: number) => Buffer.concat([header, Buffer.from([2, 0, 0, 0]), Buffer.from([2]), leaf0, leaf1, Buffer.from([1]), Buffer.from([flags])]).toString('hex')
  return { rawTx: availTx, txoutproof: mb(0x05), headers: [header.toString('hex')], coinbaseTx, coinbaseTxOutProof: mb(0x03), membership }
}

interface Act { key: string; deadline: number; valid: boolean }
const rules = { keyOf: (a: Act) => a.key, isValid: (a: Act) => a.valid, deadlineOf: (a: Act) => a.deadline }
const SPV = { net: 'regtest', minConfirmations: 1 }

/** Assemble a full live claim: act K anchored-available at height availH, absent from a root of `others`,
 *  under a seal committed in the window root. Returns the claim; the caller tweaks it to drive each gate. */
function scene(K: string, deadline: number, availH: number, seal: number, others: string[] = [key('other')]) {
  const R = inclusionRoot(others)                       // the cumulative inclusion root — WITHOUT K
  const absenceProof = proveKey(others, K)              // 3a: K is absent from R
  const wc = windowCommitment(seal, R)
  const windowSealsRoot = inclusionRoot([wc])           // the anchored seal-window root (3d-a)
  const windowMembership = proveKey([wc], wc)           // wc is a member of the window root
  const availRoot = availabilityRoot([K])
  const availabilityProof = availabilityProofAt(availH, availRoot, proveAvailability([K], K))
  return { act: { key: K, deadline, valid: true } as Act, seal, inclusionRoot: R, absenceProof, windowSealsRoot, windowMembership, availabilityProof }
}

function main() {
  console.log('\n╔═ THE LIVE CENSORSHIP VERDICT — four pieces, one trustless call (ADR-3 3d wired) ═╗\n')
  const K = key('victim|transfer|nonce7')

  // ── 1 · the whole thing holds → CENSORED, on Bitcoin, with no trusted party ──
  {
    const claim = scene(K, 900_000, 850_000, 950_000)   // public by 850k ≤ deadline 900k; seal 950k ≥ 900k; absent
    const v = verifyCensorshipLive(claim, rules, SPV)
    ok(v.censored === true, 'CENSORED: signed act, publicly anchored by its deadline, the seal committed this inclusion root, seal past the deadline, act provably ABSENT — every link re-derived from Bitcoin EXCEPT the windowSealsRoot the cascade opening still has to anchor (the one honest, owed link)')
  }

  // ── 2 · availability not proven (no real burial) → NOT censorship ──
  {
    const claim = scene(K, 900_000, 850_000, 950_000)
    const broken = { ...claim, availabilityProof: { ...claim.availabilityProof, headers: [] } }
    const v = verifyCensorshipLive(broken, rules, SPV)
    ok(v.censored === false && /availability not proven/.test((v as { reason: string }).reason), 'without a REAL Bitcoin burial of the act, absence is not censorship — availability is never asserted on faith')
  }

  // ── 3 · the seal did not commit this inclusion root (window membership fails) → NOT censorship ──
  {
    const claim = scene(K, 900_000, 850_000, 950_000)
    const wrong = { ...claim, windowSealsRoot: inclusionRoot([windowCommitment(950_000, inclusionRoot([key('a-root-never-sealed')]))]) }
    const v = verifyCensorshipLive(wrong, rules, SPV)
    ok(v.censored === false && /not a member of the anchored seal-window root/.test((v as { reason: string }).reason), 'if the seal never committed THIS inclusion root, the claim is unfounded — a fabricated window is refused')
  }

  // ── 4 · the act was public only AFTER its deadline → innocent absence ──
  {
    const claim = scene(K, 840_000, 850_000, 950_000)   // availH 850k > deadline 840k
    const v = verifyCensorshipLive(claim, rules, SPV)
    ok(v.censored === false && /after its own deadline|innocent/.test((v as { reason: string }).reason), 'an act made public only AFTER its deadline is innocently absent, not censored')
  }

  // ── 5 · the seal predates the deadline → inclusion was not yet owed ──
  {
    const claim = scene(K, 900_000, 850_000, 880_000)   // seal 880k < deadline 900k
    const v = verifyCensorshipLive(claim, rules, SPV)
    ok(v.censored === false && /predates|not yet owed/.test((v as { reason: string }).reason), 'a seal that predates the deadline owes nothing — no censorship yet')
  }

  // ── 6 · the act is actually INCLUDED (absence proof fails against a root that holds K) → NOT censorship ──
  {
    const R = inclusionRoot([K, key('other')])          // K IS in the root
    const wc = windowCommitment(950_000, R)
    const claim = {
      act: { key: K, deadline: 900_000, valid: true } as Act, seal: 950_000, inclusionRoot: R,
      absenceProof: proveKey([K, key('other')], K),     // this proves PRESENCE, not absence
      windowSealsRoot: inclusionRoot([wc]), windowMembership: proveKey([wc], wc),
      availabilityProof: availabilityProofAt(850_000, availabilityRoot([K]), proveAvailability([K], K)),
    }
    const v = verifyCensorshipLive(claim, rules, SPV)
    ok(v.censored === false && /may in fact be included/.test((v as { reason: string }).reason), 'if the act IS in the anchored root, there is nothing to censor — the absence proof cannot lie')
  }

  // ── 7 · an INVALID signature is not censorship (a writer rightly excludes it) ──
  {
    const claim = scene(K, 900_000, 850_000, 950_000)
    const v = verifyCensorshipLive({ ...claim, act: { ...claim.act, valid: false } }, rules, SPV)
    ok(v.censored === false && /signature does not verify/.test((v as { reason: string }).reason), 'a writer rightly excludes an invalid act — that is not censorship')
  }

  // ── 8 · a MALFORMED availability proof fails CLOSED to a verdict, never an uncaught throw (council) ──
  {
    const claim = scene(K, 900_000, 850_000, 950_000)
    const garbled = { ...claim, availabilityProof: { ...claim.availabilityProof, rawTx: 'zz', coinbaseTx: 'zz' } }
    const v = verifyCensorshipLive(garbled, rules, SPV)
    ok(v.censored === false && /availability not proven/.test((v as { reason: string }).reason), 'a garbage availability proof returns a NAMED not-censored verdict, never a crash — a batch verifier over hostile claims cannot be DoS-ed')
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — "the writer left my act out" is a fact a stranger derives from Bitcoin (once the windowSealsRoot is anchored by the cascade opening), or an honest not-censored reason. No second pen. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
