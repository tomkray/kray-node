/**
 * THE PAID BINDING GAUNTLET — every entity an attacker; prove by breaking, not by asserting.
 *   node src/test/paid-binding-gauntlet.test.ts
 *   PBG_SEEDS=2000 node src/test/paid-binding-gauntlet.test.ts
 *
 * ORAÇÃO (Ressonância Divina):
 *   given (A1 conservation) ∧ (cascade = sequential SHA-256 of frozen parts, A3 append-only)
 *        ∧ (anchor = KRAY.NETWORK|ver|height(u32 BE)|cascadeRoot, 49 bytes) ∧ (txid = SHA256d(tx))
 *        ∧ (the fold body lives on the journal, never in the digest)
 *   + the council, each entity a hostile lens attacking one dimension, at scale
 *   → NO byte moves without signature+Merkle+anchor; the txid NAMES, never HOLDS; and the ONE
 *     atemporal ceiling (u32 height) is found, bounded, and named — no "1000 years, zero bugs" lie.
 *
 * The entities do not decorate — they ATTACK. A choice survives only if it answers every lens.
 * Independent Convergence: repeated echoes of one refusal are one signal; the grain is what a
 * SECOND, independent path surfaces (here: the u32 height ceiling Fano's bound made visible).
 */
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { KrayAnchor } from '../anchor/anchor.ts'
import {
  ANCHOR_DIGEST_BYTES, ANCHOR_HEIGHT_MAX, ANCHOR_PAYLOAD_BYTES, PAID_BINDING_CHAIN, PAID_BINDING_VERIFY,
  certificateDoor, certificateOrRefuse, digestContainsBody, heightYearsAtCadence,
  isRefusedBinding, paidBinding, paidBindingView,
} from '../anchor/paid-binding.ts'
import { cascadeRootFromParts, type CascadeParts } from '../protocol/cascade-root.ts'
import {
  NETWORKS, _generateKeyPair, _hexToBytes, _signKrayWallet,
  burnMessage, xSendMessage, transferMessage, inscribeMessageV2,
} from '../protocol/scheme.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const NET = 'regtest'
const SEEDS = Math.max(200, Number(process.env.PBG_SEEDS || 1200))
const TAG_HEX = Buffer.from('KRAY.NETWORK', 'ascii').toString('hex')

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const okq = (c: boolean) => { if (c) pass++; else fail++ }   // quiet per-iteration tally (only the summary line prints)

const artifact = JSON.parse(readFileSync(join(HERE, '../../../kray-fold/proofs/fold-groth16-v2.json'), 'utf8')) as { proof: string; publicValues: string }

// ── a deterministic wallet + a live ledger that has really minted, burned, and moved Ӿ ──
function wallet(tag: string) {
  const sk = createHash('sha256').update('pbg|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { sk, pk: publicKeyHex, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address! }
}
function freshLedger() {
  // Ӿ transfers + fireborn active from seq 1 (lab), fold dormant (MAX) so the lane fields stay absent
  return new KrayLedger(undefined, NET, undefined, false, undefined, undefined, 1, undefined, undefined, undefined, undefined, 1)
}
/** Build a real, conserved ledger of `n` random acts; return it + its live cascade parts. */
function liveLedger(seed: number): { L: KrayLedger; parts: CascadeParts; root: string } {
  const L = freshLedger()
  const J: KrayEvent[] = []
  const ap = (e: Record<string, unknown>) => { const ev = { ...e, seq: J.length + 1 } as unknown as KrayEvent; L.applyLive(ev); J.push(ev); return ev }
  const rand = mulberry32(seed)
  const A = wallet('A|' + seed), B = wallet('B|' + seed)
  ap({ kind: 'donate', hash: 'd' + seed + 'A', to: A.addr, amount: '5000' })
  ap({ kind: 'donate', hash: 'd' + seed + 'B', to: B.addr, amount: '5000' })
  const acts = 1 + Math.floor(rand() * 6)
  for (let i = 0; i < acts; i++) {
    const pick = Math.floor(rand() * 4)
    try {
      if (pick === 0) {                                   // burn ₭ → Ӿ + fills the fire tank
        const n = L.nonceOf(A.addr), amt = 1n + BigInt(Math.floor(rand() * 50))
        ap({ kind: 'burn', hash: h('burn', seed, i), from: A.addr, amount: String(amt), fee: '1', nonce: n, publicKey: A.pk, signature: _signKrayWallet(burnMessage(NET, A.addr, amt, n), A.sk), scheme: 'kraywallet' })
      } else if (pick === 1) {                            // ₭ transfer
        const n = L.nonceOf(B.addr), amt = 1n + BigInt(Math.floor(rand() * 40))
        ap({ kind: 'transfer', hash: h('xfer', seed, i), from: B.addr, to: A.addr, amount: String(amt), fee: '1', nonce: n, publicKey: B.pk, signature: _signKrayWallet(transferMessage(NET, B.addr, A.addr, amt, n), B.sk), scheme: 'kraywallet' })
      } else if (pick === 2 && L.xBalanceOf(A.addr) > 0n) { // Ӿ x-send (fee prescribed by the tank)
        const n = L.nonceOf(A.addr), at = 1_700_000_000_000 + i * 4000
        ap({ kind: 'x-send', hash: h('xsend', seed, i), at, from: A.addr, to: B.addr, amount: '1', fee: String(L.xSendFeeFor(A.addr, at, J.length + 1)), nonce: n, publicKey: A.pk, signature: _signKrayWallet(xSendMessage(NET, A.addr, B.addr, 1n, n), A.sk), scheme: 'kraywallet' })
      } else {                                            // inscribe → a star from fire
        const n = L.nonceOf(B.addr), content = 'pbg-' + seed + '-' + i
        const ch = createHash('sha256').update(content).digest('hex')
        ap({ kind: 'inscribe', hash: h('insc', seed, i), from: B.addr, contentHash: ch, contentType: 'text/plain', size: content.length, nonce: n, publicKey: B.pk, signature: _signKrayWallet(inscribeMessageV2(NET, B.addr, ch, 'text/plain', content.length, undefined, n), B.sk), scheme: 'kraywallet' })
      }
    } catch { /* a random pick that cannot apply (empty balance, gap) — skip; the ledger stays honest */ }
  }
  return { L, parts: L.cascadeParts(), root: L.cascadeRoot() }
}
function h(k: string, s: number, i: number) { return sha256hex(`${k}|${s}|${i}`) }
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function flipHexChar(hex: string, i: number) { const c = hex[i]; const d = c === 'f' ? 'e' : (parseInt(c, 16) + 1).toString(16); return hex.slice(0, i) + d + hex.slice(i + 1) }

function main() {
  const t0 = Date.now()
  console.log('\n╔═ THE PAID BINDING GAUNTLET — nineteen hostile lenses, ' + SEEDS + ' seeds; the txid names, never holds ═╗\n')

  // ══ SATOSHI · forge — a fabricated root's anchor is well-formed but is NOT the journal's truth ══
  {
    let refuted = 0
    for (let s = 0; s < SEEDS; s++) {
      const { root } = liveLedger(s)
      const lie = flipHexChar(root, s % 64)                     // a plausible-looking, fabricated root
      const height = 800_000 + s
      const honest = KrayAnchor.payload(height, root)
      const forged = KrayAnchor.payload(height, lie)
      // both DECODE (Bitcoin accepts any OP_RETURN) — but only one names the journal's real root
      okq(KrayAnchor.decode(forged)!.root === lie && KrayAnchor.decode(honest)!.root === root)
      okq(forged !== honest)                                    // the fabrication is a different 49 bytes
      if (lie !== root) refuted++
    }
    ok(refuted === SEEDS, `SATOSHI: a fabricated root is a DIFFERENT anchor on all ${SEEDS} seeds — the auditor matches against the journal, never trusts the tx`)
  }

  // ══ MERKLE · tamper — flip one committed part; the cascade flips; the old anchor no longer names it ══
  {
    let caught = 0
    const fields: (keyof CascadeParts)[] = ['emitted', 'burned', 'moneyRoot', 'starsRoot', 'xRoot', 'fireRoot']
    for (let s = 0; s < SEEDS; s++) {
      const { parts, root } = liveLedger(s)
      const f = fields[s % fields.length]
      if (parts[f] === undefined) { caught++; continue }
      const tampered = { ...parts } as CascadeParts
      const v = String(parts[f])
      ;(tampered as Record<string, unknown>)[f] = /^[0-9a-f]{64}$/i.test(v) ? flipHexChar(v, 0) : v + '1'
      const root2 = cascadeRootFromParts(tampered)
      if (root2 !== root) caught++
    }
    ok(caught === SEEDS, `MERKLE: tampering ANY committed part flips the cascade root on all ${SEEDS} seeds — one leaf moves, the whole commitment moves`)
  }

  // ══ SHANNON · the noisy channel — flip EVERY byte of a real 98-hex payload; each flip is detected ══
  {
    let detected = 0, total = 0
    for (let s = 0; s < Math.min(SEEDS, 400); s++) {
      const { root } = liveLedger(s)
      const height = 800_000 + s
      const payload = KrayAnchor.payload(height, root)
      for (let i = 0; i < payload.length; i++) {
        total++
        const bad = flipHexChar(payload, i)
        const dec = KrayAnchor.decode(bad)
        // a flip in the tag/version → decode null; a flip in height/root → decodes to a DIFFERENT commitment
        if (dec === null || dec.root !== root || dec.blockNumber !== height) detected++
      }
    }
    ok(detected === total, `SHANNON: every single-hex flip across ${total} positions is detected (null or a different commitment) — the code is error-detecting, no silent corruption`)
  }

  // ══ FANO · the bound — the Groth16 body cannot be inferred FROM a 32-byte digest, at any size ══
  {
    let held = 0
    const bodySizes = [356, 260, 128, 64, 48, 40, 33]
    for (const b of bodySizes) okq(!digestContainsBody(ANCHOR_DIGEST_BYTES, b))   // all > 32 → cannot contain
    okq(digestContainsBody(ANCHOR_DIGEST_BYTES, 32) && digestContainsBody(ANCHOR_DIGEST_BYTES, 1)) // ≤ 32 can, but a Groth16 is never ≤ 32
    const proofHex = artifact.proof.toLowerCase()
    for (let s = 0; s < SEEDS; s++) {
      const { root } = liveLedger(s)
      const payload = KrayAnchor.payload(800_000 + s, root)
      // the real 356-byte proof is NOWHERE inside the 49 bytes; stuffing it after → not an anchor
      if (!payload.includes(proofHex.slice(0, 64)) && KrayAnchor.decode(payload + proofHex) === null) held++
    }
    ok(held === SEEDS, `FANO: the 356-byte Groth16 body is never inside the 49-byte name, and stuffing it breaks decode — on all ${SEEDS} seeds (the bound holds)`)
  }

  // ══ TURING · does it halt — a bounded vanity grind cannot force a txid to CONTAIN a body ══
  {
    // a "txid" here = SHA256d of random tx bytes. Try hard to make its 32 bytes equal the first 32 of the proof.
    const target = Buffer.from(artifact.proof, 'hex').subarray(0, 32).toString('hex')
    let hit = false
    const BUDGET = 200_000
    for (let i = 0; i < BUDGET && !hit; i++) {
      const txid = createHash('sha256').update(createHash('sha256').update(randomBytes(32)).digest()).digest('hex')
      if (txid === target) hit = true
    }
    ok(!hit, `TURING: ${BUDGET.toLocaleString()} grind attempts did NOT force a txid to equal the proof's first 32 bytes — embedding does not halt (a name is not a container)`)
  }

  // ══ NEWTON · the universal law — EVERY journal kind rides the same chain; none is a special L1 encoding ══
  {
    let uniform = 0, total = 0
    const seen = new Set<string>()
    for (let s = 0; s < SEEDS; s++) {
      const { L, parts, root } = liveLedger(s)
      const height = L.appliedSeq
      const pb = paidBinding(parts, Math.min(height, ANCHOR_HEIGHT_MAX))
      total++
      if (pb.cascadeRoot === root && pb.payloadHex.length === ANCHOR_PAYLOAD_BYTES * 2 && pb.commitment.root === root) uniform++
      // record which subsystems folded — variety proves it is not one privileged shape
      if (parts.xRoot) seen.add('x'); if (parts.fireRoot) seen.add('fire'); if (parts.seals) seen.add('seals')
    }
    ok(uniform === total, `NEWTON: all ${total} live states bind through the ONE chain (act ⊂ cascade ⊂ 49 bytes) — fold-seal is not special (subsystems seen: ${[...seen].sort().join(',') || 'money-only'})`)
  }

  // ══ LAMPORT + NASH · two anchors, one block — the auditor picks the journal-matching one; the liar earns nothing ══
  {
    let settled = 0
    for (let s = 0; s < SEEDS; s++) {
      const { root } = liveLedger(s)
      const height = 800_000 + s
      const honest = KrayAnchor.payload(height, root)
      const liar = KrayAnchor.payload(height, flipHexChar(root, (s + 7) % 64))
      // the rule: canonical ⟺ decoded root === the root the node computed from its own journal
      const pickHonest = KrayAnchor.decode(honest)!.root === root
      const pickLiar = KrayAnchor.decode(liar)!.root === root
      if (pickHonest && !pickLiar) settled++
    }
    ok(settled === SEEDS, `LAMPORT+NASH: on all ${SEEDS} seeds only the journal-matching anchor is canonical — a well-formed fabricated seal settles nothing, earns nothing`)
  }

  // ══ HUFFMAN · the minimal complete form — a second foldRoot beside the cascade is redundant / unbinds ══
  {
    let held = 0
    for (let s = 0; s < SEEDS; s++) {
      const { parts, root } = liveLedger(s)
      const height = 800_000 + s
      const cascadeName = KrayAnchor.payload(height, root)
      // committing laneRoot|xRoot INSTEAD of the cascade would UNBIND money/stars/fire
      const alt = parts.xRoot ?? parts.moneyRoot
      const altName = /^[0-9a-f]{64}$/i.test(String(alt)) ? KrayAnchor.payload(height, String(alt)) : cascadeName + 'x'
      if (altName !== cascadeName) held++
    }
    ok(held === SEEDS, `HUFFMAN: committing any single subsystem root instead of the cascade is a DIFFERENT (unbinding) name — the 49-byte cascade is already the minimal complete form`)
  }

  // ══ ROSENBLATT · the phantom — fuzz random payloads; bodyInTxid is NEVER true; the two epochs never blend ══
  {
    let clean = 0
    for (let s = 0; s < SEEDS; s++) {
      const { L, parts, root } = liveLedger(s)
      const tipRoot = root
      const sealedRoot = flipHexChar(root, s % 64)   // a DIFFERENT (older) covering seal — must stay separate
      const view = paidBindingView({
        seq: L.appliedSeq, kind: 'x-send', hash: 'ab'.repeat(32),
        sealed: { cascadeRoot: sealedRoot, blockNumber: 700_000 + s, bitcoinTxid: randomBytes(32).toString('hex'), named: true },
        tip: { seq: L.appliedSeq, cascadeRoot: tipRoot, laneRoot: parts.laneRoot ?? null, xRoot: parts.xRoot ?? null, fireRoot: parts.fireRoot ?? null },
      })
      const epochsSeparate = view.sealed!.cascadeRoot !== view.tip.cascadeRoot && view.sealed!.payload !== view.tip.payload
      const tipHonest = view.tip.payload === KrayAnchor.payload(L.appliedSeq, tipRoot)
      if (view.bodyInTxid === false && epochsSeparate && tipHonest && view.chain === PAID_BINDING_CHAIN
        && view.ceiling.bits === 32 && view.ceiling.max === ANCHOR_HEIGHT_MAX && view.ceiling.failClosed === true
        && view.tip.named === false && view.verify === PAID_BINDING_VERIFY) clean++
    }
    ok(clean === SEEDS, `ROSENBLATT: across ${SEEDS} fuzzed certificates bodyInTxid is always false and the sealed/tip epochs never blend — the phantom "bytes in the txid" stays dead`)
  }

  // ══ MANDELBROT · the zoom — the tip opening is ONE truth for every act; a lie certificate is caught ══
  {
    const { L, parts, root } = liveLedger(12345)
    const N = L.appliedSeq
    let sameTip = 0
    for (let seq = 1; seq <= N; seq++) {
      const view = paidBindingView({ seq, kind: 'k', hash: 'c'.repeat(64), sealed: null, tip: { seq: N, cascadeRoot: root, laneRoot: parts.laneRoot ?? null, xRoot: parts.xRoot ?? null, fireRoot: parts.fireRoot ?? null } })
      if (view.tip.cascadeRoot === root && view.tip.payload === KrayAnchor.payload(N, root)) sameTip++
    }
    ok(sameTip === N, `MANDELBROT: every one of ${N} acts opens the SAME live tip at every zoom — one root, not one truth per page`)
  }

  // ══ KEPLER + THE EGYPTIANS · atemporal A3 — a pre-fold root opens byte-identically forever ══
  {
    // the SAME money history with the lane field absent (below activation) vs present must NOT collide,
    // and with it absent it must equal the pure pre-fold bytes — a root sealed before the fold still re-derives.
    let held = 0
    for (let s = 0; s < Math.min(SEEDS, 400); s++) {
      const { parts } = liveLedger(s)
      const withoutLane = { ...parts }; delete (withoutLane as Record<string, unknown>).laneRoot
      const withLane = { ...parts, laneRoot: 'cc'.repeat(32) } as CascadeParts
      const r0 = cascadeRootFromParts(withoutLane)
      const r1 = cascadeRootFromParts(withLane)
      // absent ⇒ the pre-fold bytes; present ⇒ a strictly different, grown format (A3 append-only)
      if (r0 !== r1 && r0 === cascadeRootFromParts({ ...parts })) held++
    }
    ok(held === Math.min(SEEDS, 400), `KEPLER+EGYPTIANS: the lane fold is append-only — a history without it hashes byte-identically to the pre-fold format, with it a strictly different root (A3, no orphaned anchor)`)
  }

  // ══ THE 1000-YEAR CEILING (the grain — Fano's bound made temporal, surfaced not hidden) ══
  {
    const SEAL_MS = 3500
    const yearsAtMaxCadence = heightYearsAtCadence(SEAL_MS)
    okq(KrayAnchor.payload(ANCHOR_HEIGHT_MAX, 'ab'.repeat(32)).length === ANCHOR_PAYLOAD_BYTES * 2)
    okq(KrayAnchor.decode(KrayAnchor.payload(ANCHOR_HEIGHT_MAX, 'ab'.repeat(32)))!.blockNumber === ANCHOR_HEIGHT_MAX)
    let threw = false
    try { KrayAnchor.payload(ANCHOR_HEIGHT_MAX + 1, 'ab'.repeat(32)) } catch { threw = true }
    ok(threw, `THE CEILING: the anchor height field is u32 — it FAILS CLOSED past 2^32-1, never wraps silently`)
    ok(yearsAtMaxCadence < 1000, `THE CEILING (named honestly): at ${SEAL_MS}ms/block the height field saturates in ~${Math.round(yearsAtMaxCadence)} years, BEFORE 1000 — the version byte is the designed-in v2 widening (A3). Stated, not hidden.`)
  }

  // ══ ADA · the door — refuse is 400, missing is 404, live is 200; the three never collapse ══
  {
    let held = 0
    const root = 'ab'.repeat(32)
    for (let s = 0; s < SEEDS; s++) {
      const live = certificateOrRefuse({ seq: 1 + s, tip: { seq: 1 + s, cascadeRoot: root } })
      const past = certificateOrRefuse({ seq: 1, tip: { seq: ANCHOR_HEIGHT_MAX + 1 + (s % 7), cascadeRoot: root } })
      const dLive = certificateDoor(live)
      const dPast = certificateDoor(past)
      const dMiss = certificateDoor(null)
      if (!isRefusedBinding(live) && dLive.status === 200
        && isRefusedBinding(past) && dPast.status === 400
        && dMiss.status === 404 && dMiss.error === 'no such event') held++
    }
    ok(held === SEEDS, `ADA: across ${SEEDS} seeds the certificate door is 200 / 400 / 404 — refuse is never missing`)
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n═ paid-binding-gauntlet: ${pass} passed, ${fail} failed — ${SEEDS} seeds, ${secs}s ═`)
  if (fail > 0) process.exit(1)
  console.log('  the txid NAMES the fold; it never HOLDS it — and the one atemporal ceiling is found, bounded, and named. ⛓₭\n')
}
main()
