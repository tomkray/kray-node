/**
 * ML-DSA (FIPS-204) — the many-time post-quantum signature is a first-class KRAY scheme.
 *   node src/test/mldsa.test.ts
 *
 * This is the everyday quantum-safe account: unlike the one-time Lamport escape hatch, an ML-DSA key signs
 * unbounded transactions. Proven end-to-end through the consensus reducer:
 *   · a `kq1…` account (address = SHA-256(ML-DSA key)) signs a transfer with a real NIST ML-DSA signature and
 *     the reducer accepts it, moving ₭;
 *   · a tampered message, a wrong key, and a wrong address are all refused;
 *   · value can flow TO an ml-dsa account (the network-gate exempts kq1, like a protocol label);
 *   · the addition is additive: kraywallet accounts are untouched and the genesis root is byte-identical.
 */
import { createHash } from 'node:crypto'
import { KrayLedger } from '../protocol/ledger.ts'
import { transferMessage } from '../protocol/scheme.ts'
import { mldsaKeygen, mldsaSign, mldsaAddress } from '../protocol/mldsa.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); fail++; console.log('  ✗ FAIL (accepted!) — ' + m) }
  catch (e) { const s = e instanceof Error ? e.message : String(e); if (re.test(s)) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log(`  ✗ FAIL (wrong refusal "${s}") — ` + m) } }
}
const NET = 'signet'
const mldsa = (tag: string) => { const { publicKeyHex, secretKey } = mldsaKeygen(createHash('sha256').update(tag).digest()); return { pk: publicKeyHex, sk: secretKey, addr: mldsaAddress(publicKeyHex) } }
let seqNo = 0
const donate = (to: string, amt: string): KrayEvent => ({ seq: ++seqNo, prevHash: '', hash: '', at: 0, kind: 'donate', to, amount: amt, outpoint: createHash('sha256').update('o' + seqNo).digest('hex') + ':0' }) as KrayEvent
const mldsaTransfer = (from: { pk: string; sk: Uint8Array; addr: string }, to: string, amt: bigint, nonce: number, signWith = from): KrayEvent => {
  const msg = transferMessage(NET, from.addr, to, amt, nonce)
  return { seq: ++seqNo, prevHash: '', hash: '', at: seqNo, kind: 'transfer', from: from.addr, to, amount: amt.toString(), fee: '1', nonce, publicKey: signWith.pk, signature: mldsaSign(msg, signWith.sk), scheme: 'ml-dsa' } as KrayEvent
}

function main() {
  console.log('\n╔═ ML-DSA (FIPS-204) — a NIST post-quantum account transacts, verified by the reducer ═╗\n')

  ok(new KrayLedger(undefined, NET).cascadeRoot() === '9d3b2de322cad91a420243c87fa3b6fce0d6bd90f1b2a1fce216b47e750030ac',
    'the genesis root is byte-identical — adding ML-DSA orphaned nothing')

  // ML-DSA is the law under exam, not the peg — lift proof-mandatory (born strict on the real
  // signet) for the bare funding donates; proof-mandatory.test.ts pins that law.
  const bench = () => new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, Number.MAX_SAFE_INTEGER)
  const L = bench()
  const alice = mldsa('mldsa|alice'), bob = mldsa('mldsa|bob'), mallory = mldsa('mldsa|mallory')
  ok(/^kq1[0-9a-f]{64}$/.test(alice.addr), `an ML-DSA account has a kq1 address = SHA-256(its 1312-byte key) — ${alice.addr.slice(0, 16)}…`)
  ok(mldsa('mldsa|alice').addr === alice.addr, 'keygen is deterministic from the seed — the wallet re-derives it')

  // fund Alice (a donation just credits — no signature), then she spends with a REAL ML-DSA signature
  L.applyLive(donate(alice.addr, '5000'))
  ok(L.balanceOf(alice.addr) === 5000n, 'value flows TO a kq1 account — the network-gate exempts it like a label')

  const before = L.cascadeRoot()
  L.applyLive(mldsaTransfer(alice, bob.addr, 100n, 0))
  ok(L.balanceOf(alice.addr) === 4899n && L.balanceOf(bob.addr) === 100n, 'Alice sent 100 ₭ (−1 fee) with a NIST ML-DSA signature the reducer verified')
  ok(L.cascadeRoot() !== before, 'the post-quantum-signed transfer is in the cascade root — sealed to Bitcoin like any other')

  // ── TAMPER / FORGERY — every alteration is refused by the lattice verification ──
  rejects(() => { const e = mldsaTransfer(alice, bob.addr, 50n, 1); (e as { amount: string }).amount = '999'; L.applyLive(e) }, /signature|balance/i,
    'a transfer whose amount was changed after signing is refused (the signed message no longer matches)')
  rejects(() => L.applyLive(mldsaTransfer(alice, bob.addr, 50n, 1, mallory)), /signature|verified/i,
    'a transfer for Alice’s address SIGNED BY Mallory’s key is refused — the address binds to its ML-DSA key')
  ok(L.balanceOf(alice.addr) === 4899n, 'after the forgeries Alice’s balance is unchanged')

  // ── the honest next transfer still works (a many-time key signs again) ──
  L.applyLive(mldsaTransfer(alice, bob.addr, 200n, 1))
  ok(L.balanceOf(bob.addr) === 300n, 'the SAME ML-DSA key signed a SECOND transfer — many-time, unlike the one-time Lamport hatch')

  // ── nonce replay refused, conservation holds ──
  rejects(() => L.applyLive(mldsaTransfer(alice, bob.addr, 10n, 0)), /nonce/i, 'a replayed nonce is refused, exactly as for kraywallet')
  ok(L.conserves(), 'conservation holds across every post-quantum-signed move')

  // ── determinism: a replay reproduces the byte-exact root ──
  const L2 = bench(); seqNo = 0
  L2.applyLive(donate(alice.addr, '5000'))
  L2.applyLive(mldsaTransfer(alice, bob.addr, 100n, 0))
  L2.applyLive(mldsaTransfer(alice, bob.addr, 200n, 1))
  // rebuild L with matching seqs for a fair root comparison
  const L3 = bench(); seqNo = 0
  L3.applyLive(donate(alice.addr, '5000'))
  L3.applyLive(mldsaTransfer(alice, bob.addr, 100n, 0))
  L3.applyLive(mldsaTransfer(alice, bob.addr, 200n, 1))
  ok(L2.cascadeRoot() === L3.cascadeRoot(), 'a replay of the same ML-DSA-signed journal reproduces the byte-exact root — pure function')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — a real NIST FIPS-204 post-quantum account lives, spends, and is verified by consensus. The everyday quantum-safe signature is here. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
