/**
 * THE PROOF-OF-DONATION, RE-PROVEN FROM BYTES — the mint gate, adversarially.
 *
 * A donation is a REAL Bitcoin payment to the anchoring pot, buried under work, committing
 * the donor's KRAY address in an OP_RETURN. This test builds one from raw bytes (no Bitcoin
 * node), proves it verifies, and then proves every forgery is REFUSED and NAMED:
 *   · no output pays the pot            · the pot output pays zero
 *   · the payment names a DIFFERENT pot · no donor address committed
 *   · the depth is too shallow          · the merkle proof proves a foreign txid
 *   · regtest work judged by mainnet    · a client cannot inflate the minted sats
 *
 * The sats minted are the pot output's REAL on-chain value — never a number the client sent —
 * so there is no field to inject, no double-mint (the reducer keys on the outpoint), no whale.
 *
 *   node src/test/donation-proof.test.ts
 */
import { verifyDonationProof, donorOpReturnScriptHex, parseTx, checkProofOfWork, sha256d, toDisplayHex } from '../anchor/spv.ts'
import { KrayLedger } from '../protocol/ledger.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; console.log('   ✓ ' + label) } else { fail++; console.log('   ✗ FAIL — ' + label) }
}
function refused(v: { ok: boolean; reason?: string }, why: RegExp, label: string): void {
  const good = !v.ok && why.test(v.reason ?? '')
  if (good) pass++; else fail++
  console.log(`   ${good ? '✓ REFUSED' : '✗ ACCEPTED (BUG!)'} — ${label}${good ? ` (“${String(v.reason).slice(0, 52)}…”)` : ` [${v.ok ? 'accepted' : 'wrong reason: ' + v.reason}]`}`)
}

// ── fixture builders (regtest, like spv.test) ────────────────────────────────
const u64le = (n: bigint): string => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b.toString('hex') }
const pushScript = (hex: string): string => (hex.length / 2).toString(16).padStart(2, '0') + hex
const POT_KEY = '11'.repeat(32) // the anchoring pot's x-only Taproot key (fixed, public)
const POT_SCRIPT = '5120' + POT_KEY // OP_1 <push32> key — a P2TR scriptPubKey
const DONOR = 'bcrt1pc9u6kpmgue4c3pyexa9erld2c8s26rl0nv5z2cgsgxzuluten0cs5vduyq' // a REAL regtest Taproot address (valid point) — the per-network gate rejects an all-zeros key, so the donor must be a genuine address

/** value→script outputs, serialized. Each: 8-byte LE value + varint(len) + script. */
function tx(outs: Array<{ sats: bigint; script: string }>): string {
  const outHex = outs.map((o) => u64le(o.sats) + pushScript(o.script)).join('')
  const count = outs.length.toString(16).padStart(2, '0')
  return ['01000000', '01', '00'.repeat(32), 'ffffffff', '00', 'ffffffff', count, outHex, '00000000'].join('')
}
function mineHeader(prevInternal: Buffer, merkleRootInternal: Buffer): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); merkleRootInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000, 68); h.writeUInt32LE(0x207fffff, 72) // regtest-easy bits
  for (let nonce = 0; nonce < 2_000_000; nonce++) { h.writeUInt32LE(nonce, 76); if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h }
  throw new Error('could not mine a regtest header')
}
/** BIP-37 merkleblock for a one-transaction block: the tree IS the txid. */
function txoutProof(header: Buffer, txidInternal: Buffer): string {
  return Buffer.concat([header, Buffer.from([1, 0, 0, 0]), Buffer.from([1]), txidInternal, Buffer.from([1]), Buffer.from([0x01])]).toString('hex')
}
/** wrap a raw tx into {rawTx, txoutproof, headers[]} at the requested depth. */
function bury(rawTx: string, depth = 3): { rawTx: string; txoutproof: string; headers: string[] } {
  const txidInternal = sha256d(Buffer.from(rawTx, 'hex'))
  const headers: Buffer[] = [mineHeader(Buffer.alloc(32), txidInternal)]
  for (let i = 1; i < depth; i++) headers.push(mineHeader(sha256d(headers[i - 1]), Buffer.alloc(32, i + 5)))
  return { rawTx, txoutproof: txoutProof(headers[0], txidInternal), headers: headers.map((h) => h.toString('hex')) }
}
const EXPECT = { potScriptHex: POT_SCRIPT, minConfirmations: 2, net: 'regtest' }

function main() {
  console.log('\n╔═ PROOF-OF-DONATION — the mint gate, re-proven from bytes ══════════╗')

  // ── 1 · an honest donation verifies ───────────────────────────────────────
  const good = tx([{ sats: 100_000n, script: POT_SCRIPT }, { sats: 0n, script: donorOpReturnScriptHex(DONOR) }, { sats: 42_000n, script: '0014' + '22'.repeat(20) }])
  const v = verifyDonationProof(bury(good), EXPECT)
  ok(v.ok === true, 'an honest donation (pays the pot, commits the donor, buried 3 deep) VERIFIES')
  ok(v.sats === 100_000n, `the minted sats == the pot output's REAL on-chain value (${v.sats})`)
  ok(v.donor === DONOR, 'the credited address is the donor committed in the OP_RETURN')
  const expectedTxid = toDisplayHex(sha256d(Buffer.from(good, 'hex')))
  ok(v.outpoint === expectedTxid + ':0', 'the outpoint is txid:0 (the pot-paying output) — the credit-once key')

  // ── 2 · the sats are chain-derived, not client-claimed ─────────────────────
  const realValue = parseTx(good).outputValues[0]
  ok(v.sats === realValue, 'there is NO client sats field — the amount IS the output value; a client cannot inflate it')

  console.log('\n─ forgeries — each refused and named ─────────────────────────────')
  // ── 3 · no output pays the pot ─────────────────────────────────────────────
  const noPot = tx([{ sats: 0n, script: donorOpReturnScriptHex(DONOR) }, { sats: 100_000n, script: '0014' + '33'.repeat(20) }])
  refused(verifyDonationProof(bury(noPot), EXPECT), /no output pays the anchoring pot/, 'a tx that pays SOMEONE ELSE, not the pot')

  // ── 4 · pays a DIFFERENT pot key ───────────────────────────────────────────
  const otherPot = tx([{ sats: 100_000n, script: '5120' + '99'.repeat(32) }, { sats: 0n, script: donorOpReturnScriptHex(DONOR) }])
  refused(verifyDonationProof(bury(otherPot), EXPECT), /no output pays the anchoring pot/, 'a payment to a LOOK-ALIKE pot (different key)')

  // ── 5 · the pot output pays zero ───────────────────────────────────────────
  const zeroPot = tx([{ sats: 0n, script: POT_SCRIPT }, { sats: 0n, script: donorOpReturnScriptHex(DONOR) }])
  refused(verifyDonationProof(bury(zeroPot), EXPECT), /pays zero/, 'a pot output of ZERO sats (mints nothing)')

  // ── 6 · no donor committed ─────────────────────────────────────────────────
  const noDonor = tx([{ sats: 100_000n, script: POT_SCRIPT }, { sats: 42_000n, script: '0014' + '44'.repeat(20) }])
  refused(verifyDonationProof(bury(noDonor), EXPECT), /no donor/, 'a payment that names NOBODY to credit')

  // ── 7 · too shallow ────────────────────────────────────────────────────────
  refused(verifyDonationProof(bury(good, 1), EXPECT), /only 1 confirmation/, 'a donation buried only 1 deep where the law needs 2')

  // ── 8 · regtest work judged by MAINNET's ruler ─────────────────────────────
  refused(verifyDonationProof(bury(good), { ...EXPECT, net: 'main' }), /easier than this network allows|at least/, 'regtest headers judged as MAINNET — invented difficulty, not Bitcoin\'s')

  // ── 9 · the merkle proof proves a FOREIGN txid ─────────────────────────────
  const honest = bury(good)
  const foreign = tx([{ sats: 100_000n, script: POT_SCRIPT }, { sats: 0n, script: donorOpReturnScriptHex(DONOR) }, { sats: 1n, script: '00' }]) // different bytes → different txid
  refused(verifyDonationProof({ ...honest, rawTx: foreign }, EXPECT), /does not prove THIS txid/, 'a real proof stapled to a DIFFERENT tx (merkle proves the wrong txid)')

  // ── 10 · a broken header chain ─────────────────────────────────────────────
  const p = bury(good)
  const swapped = { ...p, headers: [p.headers[0], p.headers[2] ?? p.headers[1], p.headers[1]] }
  refused(verifyDonationProof(swapped, EXPECT), /does not chain/, 'headers that do not chain prev→hash (a shuffled pile)')

  console.log('\n─ the canonical donor commitment — one construction, both ends ───')
  // ── 11 · the shared OP_RETURN builder is what the verifier reads back ──────
  ok(donorOpReturnScriptHex(DONOR) === '6a' + (DONOR.length).toString(16).padStart(2, '0') + Buffer.from(DONOR, 'ascii').toString('hex'),
    'donorOpReturnScriptHex builds 0x6a <push> <ascii address> — the exact bytes the node reads')
  let rej = false
  try { donorOpReturnScriptHex('bc1p' + 'q'.repeat(90)) } catch { rej = true }
  ok(rej, 'a donor too long for a single-push OP_RETURN is REFUSED, never truncated (a truncated donor is a different donor)')

  console.log('\n─ the ledger mints a proven donation ONCE per outpoint ───────────')
  // ── 11 · credited once, ever — a replayed outpoint mints nothing ───────────
  const L = new KrayLedger()
  const OUT = 'a'.repeat(64) + ':0'
  L.applyLive({ seq: 1, kind: 'donate', hash: 'h1', to: DONOR, amount: '5000', outpoint: OUT } as KrayEvent)
  ok(L.balanceOf(DONOR) === 5000n, 'a proven donation (outpoint) credits the donor its sats')
  let threw = false
  try { L.applyLive({ seq: 2, kind: 'donate', hash: 'h2', to: DONOR, amount: '5000', outpoint: OUT } as KrayEvent) } catch { threw = true }
  ok(threw && L.balanceOf(DONOR) === 5000n, 'REPLAYING the same outpoint is REFUSED and mints NOTHING — a donation mints once, ever')
  // a DIFFERENT outpoint from the same payer credits again (independent proofs)
  L.applyLive({ seq: 3, kind: 'donate', hash: 'h3', to: DONOR, amount: '3000', outpoint: 'b'.repeat(64) + ':1' } as KrayEvent)
  ok(L.balanceOf(DONOR) === 8000n, 'a DIFFERENT outpoint credits again — each proven payment mints once, on its own')

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the mint gate accepts a real, buried, pot-paying, donor-committing payment, refuses every forgery, and mints once per outpoint. No node, no trust. ₿→₭`)
  process.exit(fail ? 1 : 0)
}
main()
