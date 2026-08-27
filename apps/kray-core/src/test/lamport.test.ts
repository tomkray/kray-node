/**
 * LAMPORT ONE-TIME SIGNATURES — the quantum-safe primitive must be PERFECT before it is wired anywhere.
 *   node src/test/lamport.test.ts
 *
 * Proves: a signature verifies; every tamper (message, signature byte, wrong key) fails; keygen is
 * deterministic from a seed (a wallet can re-derive it); the serialization round-trips byte-exact; the
 * public-key commitment is stable; and the one-time property is real (reusing a key across two messages
 * reveals both branches for a differing bit — demonstrated, so the discipline is documented in a test).
 */
import { createHash } from 'node:crypto'
import {
  lamportKeygen, lamportSign, lamportVerify, lamportPublicKeyHex, lamportPublicKeyFromHex,
  lamportSignatureHex, lamportSignatureFromHex, lamportPublicKeyCommit,
} from '../protocol/lamport.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const seed = (s: string) => createHash('sha256').update(s).digest()

function main() {
  console.log('\n╔═ LAMPORT — a real, quantum-safe signature from SHA-256 alone. It must be perfect. ═╗\n')

  const kp = lamportKeygen(seed('lamport-test|alice'))
  const msg = 'kray-core.quantum-migrate.v1|net=signet|from=tb1p…|to=tb1q…|nonce=7'
  const sig = lamportSign(msg, kp.secret)

  // 1 · a genuine signature verifies
  ok(lamportVerify(msg, sig, kp.publicKey) === true, 'a genuine Lamport signature verifies against its public key')
  ok(sig.length === 256 && sig.every((s) => s.length === 32), 'the signature is 256 revealed 32-byte secrets (8192 bytes)')
  ok(kp.publicKey.length === 256, 'the public key is 256 hash-pairs')

  // 2 · TAMPER — every alteration is caught
  ok(lamportVerify(msg + 'x', sig, kp.publicKey) === false, 'a changed message does NOT verify (the signed digest differs)')
  const flipped = sig.map((s, i) => (i === 100 ? Buffer.from(s).fill(0) : s))
  ok(lamportVerify(msg, flipped, kp.publicKey) === false, 'a single altered signature secret does NOT verify')
  const short = sig.slice(0, 255)
  ok(lamportVerify(msg, short, kp.publicKey) === false, 'a truncated signature does NOT verify')

  // 3 · WRONG KEY — a signature from a different key never authorizes this public key
  const other = lamportKeygen(seed('lamport-test|mallory'))
  const otherSig = lamportSign(msg, other.secret)
  ok(lamportVerify(msg, otherSig, kp.publicKey) === false, 'a signature by a DIFFERENT key does not verify against Alice’s public key')
  ok(lamportVerify(msg, sig, other.publicKey) === false, 'Alice’s signature does not verify against a DIFFERENT public key')

  // 4 · DETERMINISM — same seed → same keypair (a wallet re-derives it, never stores 16 KB)
  const kp2 = lamportKeygen(seed('lamport-test|alice'))
  ok(lamportPublicKeyHex(kp.publicKey) === lamportPublicKeyHex(kp2.publicKey), 'keygen is deterministic from the seed — re-derivable, nothing to store')
  ok(lamportPublicKeyHex(lamportKeygen(seed('lamport-test|alice-2')).publicKey) !== lamportPublicKeyHex(kp.publicKey), 'a different seed yields a different key')

  // 5 · SERIALIZATION round-trips byte-exact (it must ride a journal event as one hex field)
  const pkHex = lamportPublicKeyHex(kp.publicKey)
  ok(pkHex.length === 32768 && lamportPublicKeyHex(lamportPublicKeyFromHex(pkHex)) === pkHex, 'public key hex is 16384 bytes and round-trips exactly')
  const sHex = lamportSignatureHex(sig)
  ok(sHex.length === 16384 && lamportVerify(msg, lamportSignatureFromHex(sHex), kp.publicKey) === true, 'signature hex is 8192 bytes and re-verifies after a round-trip')
  ok(lamportVerify(msg, lamportSignatureFromHex(sHex), lamportPublicKeyFromHex(pkHex)) === true, 'a fully re-serialized (key + sig) pair verifies — this is exactly what the node stores + checks')

  // 6 · THE COMMITMENT is a stable SHA-256 of the public key (quantum-safe, registered ahead via quantum-commit)
  const commit = lamportPublicKeyCommit(kp.publicKey)
  ok(/^[0-9a-f]{64}$/.test(commit) && commit === lamportPublicKeyCommit(kp2.publicKey), 'the public-key commitment is a stable 64-hex SHA-256 — this is what quantum-commit stores')
  ok(commit === createHash('sha256').update(Buffer.from(pkHex, 'utf8')).digest('hex'), 'the commitment is exactly SHA-256(public-key-hex) — a verifier re-derives it with no trust')

  // 7 · the ONE-TIME discipline is real: signing two DIFFERENT messages with one key reveals both branches for
  //     a differing bit — so a key authorizes exactly one act. (Documented as a test, not a vulnerability: KRAY
  //     uses one key for one migration, then commits a fresh one.)
  const m1 = 'message-A', m2 = 'message-B'
  const s1 = lamportSign(m1, kp.secret), s2 = lamportSign(m2, kp.secret)
  let leakedBoth = false
  const b1 = digestBitsForTest(m1), b2 = digestBitsForTest(m2)
  for (let i = 0; i < 256; i++) if (b1[i] !== b2[i]) { leakedBoth = !s1[i].equals(s2[i]); break }
  ok(leakedBoth === true, 'reusing one key on two messages reveals both branches of a differing bit — one-time by design (KRAY signs once, then rotates)')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — a correct, quantum-safe, hash-only signature, ready to authorize a migration no quantum computer can forge. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
function digestBitsForTest(m: string): number[] {
  const d = createHash('sha256').update(Buffer.from(m, 'utf8')).digest(); const bits: number[] = []
  for (const byte of d) for (let k = 0x80; k > 0; k >>= 1) bits.push(byte & k ? 1 : 0)
  return bits
}
main()
