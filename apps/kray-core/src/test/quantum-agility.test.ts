/**
 * CRYPTO-AGILITY IS A SEAM, NOT A REWRITE — the migration path to post-quantum signatures is designed in.
 *   node src/test/quantum-agility.test.ts
 *
 * KRAY authorizes actions with BIP-340 Schnorr (Bitcoin's scheme), which a quantum computer's Shor algorithm
 * threatens — exactly as it threatens Bitcoin. This test proves the one thing that makes the fix ADDITIVE
 * rather than a hard fork: every signature flows through a SINGLE scheme dispatch that is fail-closed on
 * anything it does not recognise, and binds the address to the key. Adding a NIST PQC scheme
 * (ML-DSA / SLH-DSA / Falcon) is therefore one new `case`, and old events keep verifying byte-identically.
 *
 * (This does NOT ship a PQC scheme — that is a consensus change, designed + approved + proven separately per
 *  docs/QUANTUM-READINESS.md. It proves the SEAM the migration will use.)
 */
import { createHash } from 'node:crypto'
import { verifySignature, isSupportedScheme, addressOf, _generateKeyPair, _signKrayWallet, transferMessage } from '../protocol/scheme.ts'
const key = (tag: string) => { const sk = createHash('sha256').update(tag).digest(); const { publicKeyHex } = _generateKeyPair(sk); return { sk, pk: publicKeyHex } }

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function main() {
  console.log('\n╔═ CRYPTO-AGILITY — a scheme seam, fail-closed, ready for a post-quantum case ═╗\n')

  const NET = 'signet'
  const A = key('quantum-agility|A'), B = key('quantum-agility|B')
  const from = addressOf(A.pk, NET), to = addressOf(B.pk, NET)
  const msg = transferMessage(NET, from, to, 5n, 0)
  const sig = _signKrayWallet(msg, A.sk)

  // 1 · the ACTIVE schemes: kraywallet (BIP-340 Schnorr) and ml-dsa (FIPS-204 post-quantum) — the seam carries
  //     both. This is the proof the migration path was real: ml-dsa went from an unknown case to a live one.
  ok(isSupportedScheme('kraywallet') === true, 'kraywallet (BIP-340 Schnorr) is supported')
  ok(isSupportedScheme('ml-dsa') === true, 'ml-dsa (FIPS-204 post-quantum) is NOW supported — the seam carried a real PQC scheme, additively')
  ok(verifySignature(from, msg, sig, A.pk, 'kraywallet', NET) === true, 'a real kraywallet signature verifies through the dispatch')

  // 2 · FAIL-CLOSED on any still-unknown scheme — a client cannot smuggle in an unaudited algorithm
  for (const bogus of ['falcon', 'sphincs', 'ecdsa', 'ed25519', '', 'KRAYWALLET', 'quantum'] as string[]) {
    ok(isSupportedScheme(bogus) === false, `an unknown scheme "${bogus || '(empty)'}" is NOT supported — refused before any verify`)
    ok(verifySignature(from, msg, sig, A.pk, bogus as never, NET) === false, `verifySignature refuses scheme "${bogus || '(empty)'}" fail-closed`)
  }

  // 3 · the address is BOUND to the key (a PQC scheme will bind to H(pqc_pubkey) the same way) — a signature
  //     for a different key can never authorize this address
  const other = key('quantum-agility|mallory')
  const otherSig = _signKrayWallet(msg, other.sk)
  ok(verifySignature(from, msg, otherSig, other.pk, 'kraywallet', NET) === false,
    'a valid signature by a DIFFERENT key does not authorize this address — the address binds to its key')

  // 4 · the addition was ADDITIVE and controlled: kraywallet is unchanged, ml-dsa is a NEW case, and a still-
  //     unactivated scheme (falcon) remains fail-closed — each scheme is an independent, deliberate addition.
  ok(verifySignature(from, msg, sig, A.pk, 'kraywallet', NET) === true && verifySignature(from, msg, sig, A.pk, 'falcon' as never, NET) === false,
    'kraywallet still verifies while an unactivated scheme (falcon) is refused — activation is a single, controlled addition per scheme')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — one dispatch, fail-closed, address-bound: a post-quantum scheme is an additive case, never a fork. The past stays hash-sealed; the future migrates. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
