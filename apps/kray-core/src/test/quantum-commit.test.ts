/**
 * QUANTUM RECOVERY COMMITMENT (opt-in, additive) — an account registers SHA-256(future post-quantum key),
 * so it can migrate to that key later WITHOUT ever relying on its exposed ECC key. This pins every law:
 *   node src/test/quantum-commit.test.ts
 *
 *   · the commitment is a HASH (quantum-safe today), registered under the CURRENT signature (authentic while
 *     ECC is safe), bound to the address + network + nonce (non-replayable, non-hijackable);
 *   · THE ATTACK: registering a commitment for an address you do not own → refused (bad signature);
 *   · it moves NO value — balances, supply, conservation untouched;
 *   · it folds into the cascade root APPEND-ONLY: a history with no commitment hashes byte-identically to
 *     before, so the genesis root and every buried anchor still re-derive (nothing is orphaned);
 *   · an owner may rotate their commitment (latest signed one stands); a replayed nonce is refused;
 *   · a malformed commit (not 64-hex) is refused before any mutation; a replay reproduces the byte-exact root.
 */
import { createHash } from 'node:crypto'
import { KrayLedger } from '../protocol/ledger.ts'
import { addressOf, _generateKeyPair, _signKrayWallet, quantumCommitMessage } from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); fail++; console.log('  ✗ FAIL (accepted!) — ' + m) }
  catch (e) { const s = e instanceof Error ? e.message : String(e); if (re.test(s)) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log(`  ✗ FAIL (wrong refusal "${s}") — ` + m) } }
}
const NET = 'signet'
const key = (tag: string) => { const sk = createHash('sha256').update(tag).digest(); const { publicKeyHex } = _generateKeyPair(sk); return { sk, pk: publicKeyHex, addr: addressOf(publicKeyHex, NET) } }
type Id = ReturnType<typeof key>
// build a quantum-commit event with an EXPLICIT seq; sign as `signer` (defaults to the owner)
const commitEv = (seq: number, from: Id, commit: string, nonce: number, signer: Id = from): KrayEvent =>
  ({ seq, prevHash: '', hash: '', at: seq, kind: 'quantum-commit', from: from.addr, quantumCommit: commit, nonce,
     publicKey: signer.pk, signature: _signKrayWallet(quantumCommitMessage(NET, from.addr, commit, nonce), signer.sk), scheme: 'kraywallet' }) as KrayEvent
// a stand-in for a real PQC public key; the ledger only ever stores its SHA-256, never the key itself
const pqcHash = (seed: string) => createHash('sha256').update('pqc-pubkey|' + seed).digest('hex')

function main() {
  console.log('\n╔═ QUANTUM RECOVERY — a hash-committed post-quantum key, opt-in, additive, hijack-proof ═╗\n')

  // ── the genesis root is UNCHANGED by this feature (the no-breakage guarantee) ──
  ok(new KrayLedger(undefined, NET).cascadeRoot() === '9d3b2de322cad91a420243c87fa3b6fce0d6bd90f1b2a1fce216b47e750030ac',
    'a ledger with NO quantum commitment hashes to the exact genesis root the first real burn sealed — nothing orphaned')

  const alice = key('qc|alice'), bob = key('qc|bob'), mallory = key('qc|mallory')
  const aCommit = pqcHash('alice-dilithium'), aCommit2 = pqcHash('alice-sphincs-rotated'), bCommit = pqcHash('bob-falcon')

  // ── the canonical journal (three successful, contiguous events) ──
  const journal = [commitEv(1, alice, aCommit, 0), commitEv(2, alice, aCommit2, 1), commitEv(3, bob, bCommit, 0)]

  const L = new KrayLedger(undefined, NET)
  const rootBefore = L.cascadeRoot()
  L.applyLive(journal[0])
  ok(L.quantumCommitOf(alice.addr) === aCommit, 'Alice registered her SHA-256(post-quantum key) under her own signature')
  ok(L.cascadeRoot() !== rootBefore, 'the commitment folds into the cascade root — anchored to Bitcoin like everything else')
  ok(L.conserves() && L.totalEmitted === 0n, 'it moved NO value — supply and conservation untouched')

  // ── THE ATTACK: Mallory registers a commitment FOR Alice's address (to hijack her migration). High seq so
  //    it reaches the reducer; it must be refused by the signature, leaving Alice's commitment intact. ──
  // Mallory uses Alice's CORRECT next nonce (1) so it clears the nonce gate — only the SIGNATURE can stop it
  rejects(() => L.applyLive(commitEv(900, alice, pqcHash('mallory-key'), 1, mallory)), /signature|signed/i,
    'Mallory registering a commitment FOR Alice’s address (signed by Mallory) is REFUSED — the signature binds it to the owner')
  ok(L.quantumCommitOf(alice.addr) === aCommit, 'Alice’s commitment is unchanged after the hijack attempt')

  // ── a malformed commit is refused before any mutation ──
  rejects(() => L.applyLive(commitEv(901, alice, 'nothex', 5)), /64-hex|SHA-256/i, 'a malformed (non-64-hex) commitment is refused before any mutation')

  // ── an owner ROTATES their commitment (a newer signed one stands) ──
  L.applyLive(journal[1])
  ok(L.quantumCommitOf(alice.addr) === aCommit2, 'the owner rotated to a new post-quantum commitment (latest signed one stands)')
  // ── a replayed nonce is refused ──
  rejects(() => L.applyLive(commitEv(902, alice, aCommit, 0)), /nonce/i, 'replaying Alice’s nonce-0 commitment is refused')

  // ── Bob registers his own; the two are independent, both in the root ──
  L.applyLive(journal[2])
  ok(L.quantumCommitOf(bob.addr) === bCommit && L.quantumCommitOf(alice.addr) === aCommit2, 'each address owns its own commitment, independently')

  // ── determinism: a fresh ledger replaying the SAME journal reproduces the SAME root (pure function) ──
  const L2 = new KrayLedger(undefined, NET)
  for (const e of journal) L2.applyLive(e)
  ok(L2.cascadeRoot() === L.cascadeRoot(), 'a replay of the same commitments reproduces the byte-exact cascade root — pure function')
  ok(L.conserves() && L2.conserves(), 'both ledgers still conserve — the feature is purely additive record-keeping')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — a quantum-safe recovery commitment, signed by its owner, in the root, moving nothing, breaking nothing. The future migrates; the past is untouched. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
