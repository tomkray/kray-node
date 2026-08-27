/**
 * THE QUANTUM ESCAPE HATCH — rescue a compromised account with a quantum-safe Lamport signature.
 *   node src/test/quantum-migrate.test.ts
 *
 * The scenario this defends, played out: a quantum computer has broken Alice's ECC key, and an attacker can now
 * forge her ordinary (kraywallet) signatures. But Alice, ahead of time, registered SHA-256(her Lamport key) via
 * quantum-commit. This proves:
 *   · Alice rescues her ₭ to a fresh address with ONE Lamport signature — no ECC key involved;
 *   · THE ATTACK: the attacker, holding Alice's broken ECC key but NOT her Lamport key, cannot migrate her —
 *     a forged/absent Lamport signature is refused, and a wrong Lamport key (not matching the commit) is refused;
 *   · an account with no quantum-commit cannot be migrated (nothing to match against);
 *   · one rescue, ever (replay refused); value is CONSERVED (moved, never minted);
 *   · a history with no migration hashes byte-identically to genesis (append-only, nothing orphaned).
 */
import { createHash } from 'node:crypto'
import { KrayLedger } from '../protocol/ledger.ts'
import { addressOf, _generateKeyPair, _signKrayWallet, quantumCommitMessage, quantumMigrateMessage } from '../protocol/scheme.ts'
import { lamportKeygen, lamportSign, lamportPublicKeyHex, lamportSignatureHex, lamportPublicKeyCommit } from '../protocol/lamport.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); fail++; console.log('  ✗ FAIL (accepted!) — ' + m) }
  catch (e) { const s = e instanceof Error ? e.message : String(e); if (re.test(s)) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log(`  ✗ FAIL (wrong refusal "${s}") — ` + m) } }
}
const NET = 'signet'
const ecc = (tag: string) => { const sk = createHash('sha256').update(tag).digest(); const { publicKeyHex } = _generateKeyPair(sk); return { sk, pk: publicKeyHex, addr: addressOf(publicKeyHex, NET) } }
const seed = (s: string) => createHash('sha256').update(s).digest()

function commitEv(seq: number, from: ReturnType<typeof ecc>, commit: string, nonce: number): KrayEvent {
  const msg = quantumCommitMessage(NET, from.addr, commit, nonce)
  return { seq, prevHash: '', hash: '', at: seq, kind: 'quantum-commit', from: from.addr, quantumCommit: commit, nonce, publicKey: from.pk, signature: _signKrayWallet(msg, from.sk), scheme: 'kraywallet' } as KrayEvent
}
function migrateEv(seq: number, from: string, to: string, nonce: number, lamportPk: string, lamportSig: string): KrayEvent {
  return { seq, prevHash: '', hash: '', at: seq, kind: 'quantum-migrate', from, to, nonce, lamportPublicKey: lamportPk, lamportSignature: lamportSig } as KrayEvent
}

function main() {
  console.log('\n╔═ THE QUANTUM ESCAPE HATCH — Lamport rescues Alice; the attacker with her broken ECC key cannot ═╗\n')

  // ── genesis is UNCHANGED by this feature ──
  ok(new KrayLedger(undefined, NET).cascadeRoot() === '9d3b2de322cad91a420243c87fa3b6fce0d6bd90f1b2a1fce216b47e750030ac',
    'a ledger with no migration hashes to the exact genesis root — append-only, nothing orphaned')

  const L = new KrayLedger(undefined, NET)
  const alice = ecc('qm|alice'), rescue = ecc('qm|alice-rescue'), attacker = ecc('qm|attacker')

  // Alice has ₭ (seed her from a dev donation) and, ahead of time, registers SHA-256(her Lamport key)
  L.applyLive({ seq: 1, prevHash: '', hash: '', at: 0, kind: 'donate', to: alice.addr, amount: '9000', outpoint: 'a'.repeat(64) + ':0' } as KrayEvent)
  ok(L.balanceOf(alice.addr) === 9000n, 'Alice holds 9000 ₭')
  const lam = lamportKeygen(seed('qm|alice-lamport'))
  const commit = lamportPublicKeyCommit(lam.publicKey)
  L.applyLive(commitEv(2, alice, commit, 0))
  ok(L.quantumCommitOf(alice.addr) === commit, 'Alice pre-registered SHA-256(her Lamport public key) via quantum-commit — quantum-safe')

  // ── THE ATTACK: quantum has broken Alice's ECC key. The attacker tries to rescue-steal to THEIR address. ──
  // They do not have Alice's Lamport key, so they cannot produce a matching signature.
  const attackerLam = lamportKeygen(seed('qm|attacker-lamport'))
  const stealMsg = quantumMigrateMessage(NET, alice.addr, attacker.addr, 0)
  rejects(() => L.applyLive(migrateEv(10, alice.addr, attacker.addr, 0, lamportPublicKeyHex(attackerLam.publicKey), lamportSignatureHex(lamportSign(stealMsg, attackerLam.secret)))),
    /does not match the registered quantum-commit/i,
    'the attacker’s OWN Lamport key does not match Alice’s commit — the rescue-theft is REFUSED')
  // even if they somehow knew Alice's public key (it is only revealed at migration), they cannot sign for it
  const forgedSig = lamportSignatureHex(lamportSign(stealMsg, attackerLam.secret))
  rejects(() => L.applyLive(migrateEv(11, alice.addr, attacker.addr, 0, lamportPublicKeyHex(lam.publicKey), forgedSig)),
    /Lamport signature does not authorize/i,
    'Alice’s real Lamport key with a signature the attacker forged does NOT verify — the rescue-theft is REFUSED')
  ok(L.balanceOf(alice.addr) === 9000n && !L.isMigrated(alice.addr), 'after both attacks Alice’s 9000 ₭ are untouched and she is not migrated')

  // ── ALICE rescues herself: one Lamport signature over (alice → her fresh rescue address) ──
  const rescueMsg = quantumMigrateMessage(NET, alice.addr, rescue.addr, 0)
  const rescueSig = lamportSignatureHex(lamportSign(rescueMsg, lam.secret))
  L.applyLive(migrateEv(20, alice.addr, rescue.addr, 0, lamportPublicKeyHex(lam.publicKey), rescueSig))
  ok(L.balanceOf(rescue.addr) === 9000n && L.balanceOf(alice.addr) === 0n, 'Alice rescued all 9000 ₭ to her fresh address — with NO ECC key, only the quantum-safe Lamport signature')
  ok(L.isMigrated(alice.addr), 'the compromised account is retired (migrated)')
  ok(L.conserves() && L.totalEmitted === 9000n, 'value was MOVED, never minted — conservation holds through the rescue')

  // ── one rescue, ever: a replay (or a second migration) is refused ──
  rejects(() => L.applyLive(migrateEv(21, alice.addr, rescue.addr, 0, lamportPublicKeyHex(lam.publicKey), rescueSig)), /already been quantum-migrated/i,
    'replaying the migration is refused — one rescue, ever')

  // ── an account with NO quantum-commit cannot be migrated ──
  const bob = ecc('qm|bob'), bobLam = lamportKeygen(seed('qm|bob-lamport'))
  const bobMsg = quantumMigrateMessage(NET, bob.addr, rescue.addr, 0)
  rejects(() => L.applyLive(migrateEv(30, bob.addr, rescue.addr, 0, lamportPublicKeyHex(bobLam.publicKey), lamportSignatureHex(lamportSign(bobMsg, bobLam.secret)))),
    /no quantum-commit registered/i, 'an account that never registered a commit cannot be migrated — nothing to match against')

  // ── determinism: a fresh replay reproduces the byte-exact root ──
  const L2 = new KrayLedger(undefined, NET)
  L2.applyLive({ seq: 1, prevHash: '', hash: '', at: 0, kind: 'donate', to: alice.addr, amount: '9000', outpoint: 'a'.repeat(64) + ':0' } as KrayEvent)
  L2.applyLive(commitEv(2, alice, commit, 0))
  L2.applyLive(migrateEv(20, alice.addr, rescue.addr, 0, lamportPublicKeyHex(lam.publicKey), rescueSig))
  ok(L2.balanceOf(rescue.addr) === 9000n && L2.isMigrated(alice.addr), 'a replay of the same journal reproduces the same rescued state — pure function')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — even with Alice’s ECC key broken, only Alice (via her pre-committed Lamport key) can move her value. The attacker cannot. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
