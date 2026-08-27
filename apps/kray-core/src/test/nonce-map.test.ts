/**
 * THE NONCE MAP — a committed account→(nonce,height) state a stranger proves against (ADR-3 · the eligibility opening).
 *
 *   node src/test/nonce-map.test.ts
 *
 * A light verifier, holding only the root and one proof, learns an account's expected nonce AND the Bitcoin
 * height that nonce first anchored, and CANNOT be lied to. A present account proves (nonce, height); an unseen
 * account proves (0, 0); the root is a pure function of the map; tampering value/height/present-bit/sibling is
 * refused; the domain is disjoint from the inclusion tree; and the O(256) incremental map is byte-identical to
 * the batch root at every step (so the anchor cannot be griefed).
 */
import { createHash } from 'node:crypto'
import {
  nonceMapRoot, proveNonce, verifyNonceProof, addrKey, IncrementalNonceMap,
  NMAP_EMPTY_ROOT, NMAP_DEPTH, _nmapLeafHash, _nmapNodeHash, type NonceEntry,
} from '../protocol/nonce-map.ts'
import { inclusionRoot } from '../protocol/inclusion-tree.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const eq = (a: { nonce: number; height: number } | null, n: number, hgt: number) => !!a && a.nonce === n && a.height === hgt

function shuffle<T>(arr: T[], seed: number): T[] {
  const a = arr.slice(); let s = seed >>> 0
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff }
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

function main() {
  console.log('\n╔═ THE NONCE MAP — account→(nonce,height), committed, provable to a stranger (ADR-3) ═╗\n')

  // ── the empty map: every account is at nonce 0 ──
  ok(nonceMapRoot([]) === NMAP_EMPTY_ROOT, 'the empty map is NMAP_EMPTY_ROOT')
  {
    const p = proveNonce([], 'bc1qnever')
    ok(eq(verifyNonceProof(NMAP_EMPTY_ROOT, 'bc1qnever', p), 0, 0) && p.present === false,
      'an account in the empty map proves (0,0) — non-membership, the ledger default for an unseen account')
  }

  // ── a real map: (address, nonce ≥ 1, anchor height) ──
  const entries: NonceEntry[] = [['alice', 3, 800_100], ['bob', 1, 0], ['carol', 42, 799_000], ['dave', 7, 800_100]]
  const root = nonceMapRoot(entries)

  // MEMBERSHIP — each present account proves its exact (nonce, height)
  {
    let allOk = true
    for (const [addr, nonce, height] of entries) {
      const p = proveNonce(entries, addr)
      if (!eq(verifyNonceProof(root, addr, p), nonce, height) || p.present !== true) allOk = false
    }
    ok(allOk, 'every present account proves its EXACT (nonce, first-anchor height) against the root — bob carries the 0 sentinel (advanced mid-stream, unsealed)')
  }

  // NON-MEMBERSHIP — an unseen account proves (0,0) against the SAME populated root
  {
    const p = proveNonce(entries, 'mallory')
    ok(eq(verifyNonceProof(root, 'mallory', p), 0, 0) && p.present === false,
      'an unseen account proves (0,0) against the populated root — one root yields both membership and non-membership')
  }

  // ── ORDER-INDEPENDENCE + snapshot semantics ──
  {
    let orderInvariant = true
    for (let seed = 1; seed <= 5; seed++) if (nonceMapRoot(shuffle(entries, seed)) !== root) orderInvariant = false
    ok(orderInvariant, 'the root is insert-order-independent — a map commitment, byte-identical on every node')
  }
  ok(nonceMapRoot([['alice', 1, 700_000], ['alice', 3, 800_100], ['bob', 1, 0], ['carol', 42, 799_000], ['dave', 7, 800_100]]) === root,
    'a repeated address takes its LAST (nonce,height) — the map is a snapshot, not a multiset')
  ok(nonceMapRoot([...entries, ['zoe', 0, 12345]]) === root, 'an entry with nonce 0 is the default (absent) — it does not occupy a leaf, height ignored')

  // ── the STAMP matters: same nonce, different anchor height → different root (the height is committed) ──
  ok(nonceMapRoot([['alice', 3, 800_100]]) !== nonceMapRoot([['alice', 3, 800_101]]),
    'the same nonce at a different first-anchor height commits a DIFFERENT root — the deadline-binding stamp is part of the commitment')

  // ── TAMPERING is refused ──
  {
    const p = proveNonce(entries, 'alice')   // alice = (3, 800100)
    ok(verifyNonceProof(root, 'alice', { ...p, nonce: 99 }) === null, 'a LIED nonce (alice at 99 on her real path) → refused')
    ok(verifyNonceProof(root, 'alice', { ...p, height: 799_999 }) === null, 'a LIED anchor height (alice stamped earlier to dodge a deadline) → refused')
    ok(verifyNonceProof(root, 'alice', { present: false, nonce: 0, height: 0, siblings: p.siblings }) === null, 'claiming a PRESENT account is absent → refused')
    const bad = p.siblings.slice(); bad[100] = createHash('sha256').update('tamper').digest('hex')
    ok(verifyNonceProof(root, 'alice', { ...p, siblings: bad }) === null, 'a tampered sibling → refused')
    ok(verifyNonceProof(root, 'alice', { ...p, present: true, nonce: 0 }) === null, 'a present leaf claiming nonce 0 → refused')
    ok(verifyNonceProof(root, 'bob', p) === null, 'alice’s path proves nothing about bob — the key binds the proof to one account')
  }

  // ── DOMAIN SEPARATION from the inclusion tree ──
  {
    const k = addrKey('alice')
    ok(nonceMapRoot([['alice', 1, 5]]) !== inclusionRoot([k]), 'a one-account nonce map and a one-key inclusion tree at the same key have DIFFERENT roots (distinct domain tags)')
    ok(_nmapLeafHash(k, 1, 5) !== _nmapNodeHash(k, k), 'the value leaf hash ≠ the node hash of the same bytes — leaf/node domain boundary holds')
  }

  // ── THE INCREMENTAL MAP — byte-identical to the batch root at EVERY step (O(256), not O(N)) ──
  {
    const m = new IncrementalNonceMap()
    ok(m.root() === NMAP_EMPTY_ROOT, 'the empty incremental map is NMAP_EMPTY_ROOT')
    // a realistic sequence: accounts advance (sentinel height 0), then a seal flush stamps a real height, then
    // one advances again — the map must track the LATEST (nonce,height) and match a batch rebuild every time.
    const latest = new Map<string, [number, number]>()
    const steps: [string, number, number][] = [
      ['alice', 1, 0], ['bob', 1, 0], ['alice', 2, 0],          // mid-stream advances (sentinel)
      ['alice', 2, 800_050], ['bob', 1, 800_050],               // seal flush → real heights (same nonce, new stamp)
      ['carol', 1, 0], ['alice', 3, 0], ['carol', 1, 800_100],  // more advances + next flush
      ['dave', 5, 0], ['alice', 3, 800_100],
    ]
    let stepOk = true
    for (const [addr, nonce, height] of steps) {
      m.update(addr, nonce, height)
      latest.set(addr, [nonce, height])
      const batch = nonceMapRoot([...latest.entries()].map(([a, [n, hgt]]) => [a, n, hgt] as NonceEntry))
      if (m.root() !== batch) { stepOk = false; break }
    }
    ok(stepOk, 'the incremental root equals a batch rebuild at EVERY update — advances AND sentinel→real-height promotions, O(256) per step')

    // the incremental map serves its own proof, and it verifies against its root
    const pa = m.prove('alice')
    ok(eq(verifyNonceProof(m.root(), 'alice', pa), 3, 800_100) && verifyNonceProof(m.root(), 'zed', m.prove('zed')) !== null && m.prove('zed').present === false,
      'the incremental map proves its own membership (alice=3@800100) and non-membership (zed absent) against its root')

    // clearing back to nonce 0 returns to absent (defensive — nonces never actually decrease live)
    const m2 = new IncrementalNonceMap(); m2.update('x', 4, 10); m2.update('x', 0, 0)
    ok(m2.root() === NMAP_EMPTY_ROOT, 'setting a leaf back to nonce 0 restores the empty default (the map is a true key→value store)')
  }

  ok(proveNonce(entries, 'alice').siblings.length === NMAP_DEPTH, `a proof carries exactly NMAP_DEPTH (${NMAP_DEPTH}) siblings`)

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the account nonce AND its first-anchor height are committed facts a stranger reads from one root and one path; neither can be lied. The eligibility gate has a single-opening trustless input. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
