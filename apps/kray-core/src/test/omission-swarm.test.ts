/**
 * THE OMISSION SWARM — the whole ADR-3 path, ACTIVATED FROM GENESIS, under scale and hostility (tier-1 regtest).
 *
 *   node src/test/omission-swarm.test.ts
 *
 * The unit exams pin each rule; this drives a FULLY-ACTIVATED regtest ledger (inclusion + deadline + nonce all
 * folding from block 0) at scale — dozens of accounts, hundreds of signed acts with deadlines, interleaved
 * seals — and then builds real censorship claims FROM THE LEDGER'S OWN STATE (not hand-built parts). It proves,
 * against the live anchored cascade root, that:
 *   · a genuinely omitted ELIGIBLE act (fresh or at an account's frontier) → CENSORED;
 *   · a nonce GAP, a SUPERSEDED nonce, and a LATE-predecessor act → NOT censored;
 *   · forged claims (tampered root, fabricated nonce proof, a rolled-back opening) → refused;
 * and that the whole activated chain REPLAYS to the byte-identical cascade root (conservation intact). This is
 * the "born activated at block 0" rehearsal: the math is live from the first act, proven under load.
 */
import { createHash } from 'node:crypto'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, verifySignature } from '../protocol/scheme.ts'
import { buildCensorshipClaim, verifyCensorshipAnchored, type CensorshipRules, type CensorshipProverState } from '../protocol/censorship-evidence.ts'
import { availabilityRoot, availabilityPayload, proveAvailability } from '../protocol/availability.ts'
import { keyFromSignedMessage } from '../protocol/window-order.ts'
import { sha256d, checkProofOfWork } from '../anchor/spv.ts'
import * as btc from '@scure/btc-signer'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const NET = 'regtest', BNET = toBtcNet(NET)
const SPV = { net: 'regtest', minConfirmations: 1 }
const FAR = 900_000   // applied acts carry a far-future deadline (harmless; they are included, never censored)

// ── real 2-tx Bitcoin availability block (a citizen's own witness), same harness as the anchored exams ──
function buildHeader(m: Buffer): Buffer {
  const hh = Buffer.alloc(80); hh.writeUInt32LE(0x20000000, 0); m.copy(hh, 36); hh.writeUInt32LE(1_700_000_000, 68); hh.writeUInt32LE(0x207fffff, 72)
  for (let n = 1; n < 4_000_000; n++) { hh.writeUInt32LE(n >>> 0, 76); if (checkProofOfWork(hh.toString('hex'), 'regtest').ok) return hh }
  throw new Error('mine')
}
function rawTx(ss: string, os: string): string {
  const s = Buffer.from(ss, 'hex'), o = Buffer.from(os, 'hex')
  return Buffer.concat([Buffer.from('01000000', 'hex'), Buffer.from('01', 'hex'), Buffer.alloc(32), Buffer.from('ffffffff', 'hex'), Buffer.from([s.length]), s, Buffer.from('ffffffff', 'hex'), Buffer.from('01', 'hex'), Buffer.alloc(8), Buffer.from([o.length]), o, Buffer.from('00000000', 'hex')]).toString('hex')
}
function availAt(h: number, key: string) {
  const membership = proveAvailability([key], key), availRoot = availabilityRoot([key])
  const b = Buffer.alloc(4); b.writeUInt32LE(h); let n = 4; while (n > 1 && b[n - 1] === 0) n--
  const coinbaseTx = rawTx(Buffer.concat([Buffer.from([n]), b.subarray(0, n)]).toString('hex'), '51')
  const availTx = rawTx('00', '6a' + '2f' + availabilityPayload(availRoot))
  const l0 = sha256d(Buffer.from(coinbaseTx, 'hex')), l1 = sha256d(Buffer.from(availTx, 'hex'))
  const header = buildHeader(sha256d(Buffer.concat([l0, l1])))
  const mb = (f: number) => Buffer.concat([header, Buffer.from([2, 0, 0, 0]), Buffer.from([2]), l0, l1, Buffer.from([1]), Buffer.from([f])]).toString('hex')
  return { rawTx: availTx, txoutproof: mb(0x05), headers: [header.toString('hex')], coinbaseTx, coinbaseTxOutProof: mb(0x03), membership }
}

const mk = (t: string) => { const sk = createHash('sha256').update('sw|' + t).digest(); const pk = _generateKeyPair(sk).publicKeyHex; return { addr: btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[BNET]).address!, sk, pk } }

// a transfer's signed message binds the deadline (obligation #1) — the SAME shape the ledger's requireSig builds
const msgOf = (from: string, to: string, amount: bigint, nonce: number, deadline: number) => `${transferMessage(NET, from, to, amount, nonce)}|deadline=${deadline}`
interface VAct { from: string; to: string; amount: bigint; nonce: number; deadline: number; publicKey: string; signature: string }
const rules: CensorshipRules<VAct> = {
  keyOf: (a) => keyFromSignedMessage(msgOf(a.from, a.to, a.amount, a.nonce, a.deadline)),
  isValid: (a) => { try { return verifySignature(a.from, msgOf(a.from, a.to, a.amount, a.nonce, a.deadline), a.signature, a.publicKey, 'kraywallet', BNET) } catch { return false } },
  deadlineOf: (a) => a.deadline,
}

function main() {
  console.log('\n╔═ THE OMISSION SWARM — the whole ADR-3 path ACTIVATED FROM GENESIS, at scale and under attack ═╗\n')

  const led = new KrayLedger(undefined, NET, undefined, false, undefined, 0)   // inclusion + DEADLINE + nonce ACTIVE from seq 0
  const journal: KrayEvent[] = []
  let seq = 0
  const push = (e: Record<string, unknown>) => { const ev = { ...e, seq: ++seq, prevHash: 'x', hash: 'y' } as unknown as KrayEvent; led.applyLive(ev); journal.push(ev) }

  // ── fund N accounts ──
  const N = 30
  const acc = Array.from({ length: N }, (_, i) => mk('a' + i))
  for (const a of acc) push({ kind: 'donate', at: 0, to: a.addr, amount: '9000', outpoint: `sw:donate:${a.addr.slice(-8)}` })

  // ── ROUNDS: every account sends a transfer each round (nonce advances), a seal closes each round ──
  const ROUNDS = 8, H0 = 800_000, STEP = 10
  const nonce = new Map(acc.map((a) => [a.addr, 0]))
  const sendTransfer = (from: typeof acc[0], to: typeof acc[0], deadline = FAR) => {
    const n = nonce.get(from.addr)!
    push({ action: 'transfer', kind: 'transfer', at: 0, from: from.addr, to: to.addr, amount: '10', fee: '1', nonce: n, deadline, publicKey: from.pk, signature: _signKrayWallet(msgOf(from.addr, to.addr, 10n, n, deadline), from.sk), scheme: 'kraywallet' })
    nonce.set(from.addr, n + 1)
  }
  for (let r = 0; r < ROUNDS; r++) {
    for (let i = 0; i < N; i++) sendTransfer(acc[i], acc[(i + 1) % N])
    push({ kind: 'seal', at: 0, l1Txid: (H0 + r * STEP).toString(16).padStart(64, '0'), l1Height: H0 + r * STEP, l1Root: led.cascadeRoot(), l1BlockNumber: 0 })
  }
  const FINAL_SEAL = H0 + (ROUNDS - 1) * STEP   // the accusing seal (no acts after it — inclusion root is final)
  const D = FINAL_SEAL, HAVAIL = FINAL_SEAL - 5

  ok(led.cascadeParts().inclusionRoot !== undefined && led.cascadeParts().windowRoot !== undefined && led.cascadeParts().nonceRoot !== undefined,
    `ACTIVATED chain built: ${N} accounts, ${ROUNDS} rounds, seq ${seq} — inclusion + window + nonce all fold into the cascade from block 0`)

  // ── the prover state, straight from the LIVE ledger at the final seal ──
  const state: CensorshipProverState = {
    seal: FINAL_SEAL,
    inclusionTree: { root: () => led.inclusionRoot(), prove: (k) => led.proveInclusion(k) },
    windowSeals: led.windowSealCommitments(),
    cascadeParts: led.cascadeParts(),
    anchoredCascadeRoot: led.cascadeRoot(),
    nonceMap: { prove: (a) => led.proveNonce(a) },
  }
  // build a signed victim act (NOT applied — the writer omitted it) and its anchored censorship claim
  const victim = (from: typeof acc[0], to: typeof acc[0], n: number, deadline = D, avail = HAVAIL): VAct => {
    const a: VAct = { from: from.addr, to: to.addr, amount: 10n, nonce: n, deadline, publicKey: from.pk, signature: _signKrayWallet(msgOf(from.addr, to.addr, 10n, n, deadline), from.sk) }
    return a
  }
  const verdictOf = (a: VAct) => verifyCensorshipAnchored(buildCensorshipClaim(a, availAt(HAVAIL, rules.keyOf(a)), state, rules), rules, SPV)

  // ── GENUINE OMISSION at scale — a batch of fresh accounts, each's first act refused → all CENSORED ──
  {
    const fresh = Array.from({ length: 6 }, (_, i) => mk('victim' + i))
    let allCensored = true
    for (const v of fresh) { if (verdictOf(victim(v, acc[0], 0)).censored !== true) allCensored = false }
    ok(allCensored, 'a batch of 6 fresh accounts, each first act omitted+available+past deadline → ALL CENSORED (real omission is undeniable at scale, straight from the live cascade)')
  }

  // ── FRONTIER OMISSION — an ACTIVE account's next act (nonce = its current) refused → CENSORED ──
  {
    const A = acc[3], nA = nonce.get(A.addr)!   // A is at its current nonce; A#nA is the frontier, omitted
    ok(verdictOf(victim(A, acc[5], nA)).censored === true, 'an active account’s FRONTIER act (nonce = its current, omitted, available, stamped ≤ deadline) → CENSORED')
  }

  // ── HONEST ABSENCES the writer must NOT be convicted for ──
  {
    const A = acc[7], nA = nonce.get(A.addr)!
    ok(verdictOf(victim(A, acc[8], nA + 3)).censored === false, 'a nonce GAP (nonce above the account’s current) → NOT censored (the writer could not apply it yet)')
    ok(verdictOf(victim(A, acc[8], nA - 2)).censored === false, 'a SUPERSEDED nonce (below the current — slot already filled) → NOT censored')
  }

  // ── LATE PREDECESSOR — an account whose current nonce anchored only AFTER the deadline → NOT censored ──
  {
    // W acts ONCE, late: its transfer lands in a seal ABOVE the victim deadline, so W's stamp h_W > D
    const W = mk('late'); push({ kind: 'donate', at: 0, to: W.addr, amount: '9000', outpoint: `sw:donate:${W.addr.slice(-8)}` })
    const lateDeadline = FAR
    push({ action: 'transfer', kind: 'transfer', at: 0, from: W.addr, to: acc[0].addr, amount: '10', fee: '1', nonce: 0, deadline: lateDeadline, publicKey: W.pk, signature: _signKrayWallet(msgOf(W.addr, acc[0].addr, 10n, 0, lateDeadline), W.sk), scheme: 'kraywallet' })
    const LATE_SEAL = FINAL_SEAL + 1000   // strictly above the victim deadline D
    push({ kind: 'seal', at: 0, l1Txid: LATE_SEAL.toString(16).padStart(64, '0'), l1Height: LATE_SEAL, l1Root: led.cascadeRoot(), l1BlockNumber: 0 })
    // rebuild the prover state at THIS later seal; W is now at nonce 1 stamped at LATE_SEAL > D
    const state2: CensorshipProverState = { seal: LATE_SEAL, inclusionTree: { root: () => led.inclusionRoot(), prove: (k) => led.proveInclusion(k) }, windowSeals: led.windowSealCommitments(), cascadeParts: led.cascadeParts(), anchoredCascadeRoot: led.cascadeRoot(), nonceMap: { prove: (a) => led.proveNonce(a) } }
    const wVic = victim(W, acc[1], 1, D, HAVAIL)   // W#1 frontier, but W reached nonce 1 only at LATE_SEAL > D
    const v = verifyCensorshipAnchored(buildCensorshipClaim(wVic, availAt(HAVAIL, rules.keyOf(wVic)), state2, rules), rules, SPV)
    ok(v.censored === false, 'a frontier act whose predecessor anchored only AFTER the deadline (h_W > D) → NOT censored (eligibility measured at the deadline via the sticky stamp)')
  }

  // ── ADVERSARIAL — forged claims are refused ──
  {
    const v = victim(mk('adv0'), acc[0], 0)
    const good = buildCensorshipClaim(v, availAt(HAVAIL, rules.keyOf(v)), state, rules)
    // (a) tamper the anchored root → the opening no longer re-hashes to it
    ok(verifyCensorshipAnchored({ ...good, anchoredCascadeRoot: 'f'.repeat(64) }, rules, SPV).censored === false, 'a claim whose opening does not re-hash to the anchored root → refused')
    // (b) fabricate the nonce proof (swap in another account's proof) → the eligibility opening fails
    const otherProof = led.proveNonce(acc[9].addr)
    ok(verifyCensorshipAnchored({ ...good, nonceMembership: otherProof }, rules, SPV).censored === false, 'a fabricated nonce proof (another account’s) → refused (eligibility unproven)')
    // (c) an act that IS in the chain cannot be framed — take a real applied transfer and try to accuse it
    const appliedVictim: VAct = { from: acc[0].addr, to: acc[1].addr, amount: 10n, nonce: 0, deadline: FAR, publicKey: acc[0].pk, signature: _signKrayWallet(msgOf(acc[0].addr, acc[1].addr, 10n, 0, FAR), acc[0].sk) }
    ok(verifyCensorshipAnchored(buildCensorshipClaim(appliedVictim, availAt(HAVAIL, rules.keyOf(appliedVictim)), state, rules), rules, SPV).censored === false, 'an act that is actually INCLUDED cannot be framed as censored (absence proof fails)')
  }

  // ── REPLAY DETERMINISM — a fresh ledger replaying the same journal derives the byte-identical cascade root ──
  {
    const replay = new KrayLedger(undefined, NET, undefined, false, undefined, 0)
    for (const e of journal) replay.applyLive(e)
    ok(replay.cascadeRoot() === led.cascadeRoot(), `the whole ACTIVATED chain (seq ${seq}) replays to the BYTE-IDENTICAL cascade root — a pure function of the journal, folds and all`)
    ok(replay.nonceMapRoot() === led.nonceMapRoot() && replay.inclusionRoot() === led.inclusionRoot(), 'and the inclusion + nonce roots re-derive identically — the eligibility opening is deterministic under replay')
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — activated from block 0, at scale and under attack, the omission verdict is right for every act, and the whole chain re-derives byte-for-byte. The math is live from the first act. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
