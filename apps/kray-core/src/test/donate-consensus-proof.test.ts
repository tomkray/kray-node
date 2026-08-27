/**
 * ADR-1 · PROOF-OF-BURN IN CONSENSUS — the reducer re-verifies a donation's own SPV proof.
 *
 * When a donate event carries { rawTx, txoutproof, headers } AND the ledger knows the pot script,
 * the reducer re-proves the burn FROM BYTES on every apply/replay: pays the pot, buried deep enough,
 * and the sats/outpoint/donor it proves MATCH the event's claims — or it HALTs. A forged proof, a
 * mismatched amount, a wrong recipient are all refused. Absent proof (or absent pot script) is
 * byte-identical to before. This is the keystone: a stranger with only the journal re-verifies the peg.
 *
 *   node src/test/donate-consensus-proof.test.ts
 */
import { KrayLedger } from '../protocol/ledger.ts'
import { verifyDonationProof, donorOpReturnScriptHex, checkProofOfWork, sha256d } from '../anchor/spv.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const halts = (fn: () => void, re: RegExp, m: string) => { try { fn(); ok(false, m + ' — DID NOT throw') } catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong: ' + msg)) } }

// ── fixture builders (regtest), mirrored from donation-proof.test.ts ─────────
const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b.toString('hex') }
const pushScript = (hex: string) => (hex.length / 2).toString(16).padStart(2, '0') + hex
const POT_KEY = '11'.repeat(32)
const POT_SCRIPT = '5120' + POT_KEY
const LOOKALIKE_POT = '5120' + '22'.repeat(32)
const DONOR = 'bcrt1pc9u6kpmgue4c3pyexa9erld2c8s26rl0nv5z2cgsgxzuluten0cs5vduyq'
function tx(outs: Array<{ sats: bigint; script: string }>): string {
  const outHex = outs.map((o) => u64le(o.sats) + pushScript(o.script)).join('')
  return ['01000000', '01', '00'.repeat(32), 'ffffffff', '00', 'ffffffff', outs.length.toString(16).padStart(2, '0'), outHex, '00000000'].join('')
}
function mineHeader(prevInternal: Buffer, merkleRootInternal: Buffer): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); merkleRootInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000, 68); h.writeUInt32LE(0x207fffff, 72)
  for (let nonce = 0; nonce < 2_000_000; nonce++) { h.writeUInt32LE(nonce, 76); if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h }
  throw new Error('could not mine a regtest header')
}
function txoutProof(header: Buffer, txidInternal: Buffer): string {
  return Buffer.concat([header, Buffer.from([1, 0, 0, 0]), Buffer.from([1]), txidInternal, Buffer.from([1]), Buffer.from([0x01])]).toString('hex')
}
function bury(rawTx: string, depth = 3) {
  const txidInternal = sha256d(Buffer.from(rawTx, 'hex'))
  const headers: Buffer[] = [mineHeader(Buffer.alloc(32), txidInternal)]
  for (let i = 1; i < depth; i++) headers.push(mineHeader(sha256d(headers[i - 1]), Buffer.alloc(32, i + 5)))
  return { rawTx, txoutproof: txoutProof(headers[0], txidInternal), headers: headers.map((h) => h.toString('hex')) }
}

function main() {
  console.log('\n╔═ ADR-1 · PROOF-OF-BURN IN CONSENSUS — the reducer re-proves the peg ══╗\n')

  // an honest 10,000-sat donation (within the mint cap), paying the pot + committing the donor
  const good = tx([{ sats: 10_000n, script: POT_SCRIPT }, { sats: 0n, script: donorOpReturnScriptHex(DONOR) }])
  const proof = bury(good)
  const v = verifyDonationProof(proof, { potScriptHex: POT_SCRIPT, minConfirmations: 1, net: 'regtest' })
  ok(v.ok && v.sats === 10_000n && v.donor === DONOR, 'fixture: the proof itself verifies (10,000 sats, donor committed)')
  const OUT = v.outpoint!

  // ── 1 · a ledger that KNOWS the pot: a proof-bearing donation is re-verified and mints ──
  const L = new KrayLedger(undefined, 'regtest', POT_SCRIPT)
  L.applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '10000', outpoint: OUT, proof } as unknown as KrayEvent)
  ok(L.balanceOf(DONOR) === 10_000n, '1 · a genuine proof-bearing donation is RE-VERIFIED in consensus and mints 10,000 ₭')
  ok(L.conserves(), '1 · conservation holds')

  // ── 2 · a FORGED proof (pays a look-alike pot) HALTs ──
  const forged = bury(tx([{ sats: 10_000n, script: LOOKALIKE_POT }, { sats: 0n, script: donorOpReturnScriptHex(DONOR) }]))
  halts(() => L.applyLive({ seq: 2, kind: 'donate', to: DONOR, amount: '10000', proof: forged } as unknown as KrayEvent),
    /SPV proof does not verify|pays the anchoring pot/, '2 · a proof paying a LOOK-ALIKE pot is refused on replay')

  // ── 3 · the claimed amount DISAGREES with the proven pot value → HALT ──
  halts(() => L.applyLive({ seq: 2, kind: 'donate', to: DONOR, amount: '5000', proof } as unknown as KrayEvent),
    /proven pot payment .* ≠ the claimed/, '3 · a donation claiming 5,000 while the proof pays 10,000 is refused')

  // ── 4 · the claimed recipient is NOT the committed donor → HALT ──
  const other = 'bcrt1pg4ylp8sgnh6d93x6yar8yvvwrfuem4rtr46454mmc9gsvusa7jaq5reh4g'
  halts(() => L.applyLive({ seq: 2, kind: 'donate', to: other, amount: '10000', proof } as unknown as KrayEvent),
    /commits donor .* not the claimed recipient/, '4 · a donation crediting someone other than the proof\'s donor is refused')

  // ── 5 · BYTE-IDENTICAL when the proof is absent (today's path) ──
  const L2 = new KrayLedger(undefined, 'regtest', POT_SCRIPT)
  L2.applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '9000', outpoint: 'aa'.repeat(32) + ':0' } as unknown as KrayEvent)
  ok(L2.balanceOf(DONOR) === 9_000n, '5 · a donation with NO proof still mints (byte-identical to before — the door is the gate)')

  // ── 6 · a node WITHOUT the pot script skips re-verify (byte-identical), even with a proof present ──
  const L3 = new KrayLedger(undefined, 'regtest')   // no potScriptHex
  L3.applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '10000', outpoint: OUT, proof } as unknown as KrayEvent)
  ok(L3.balanceOf(DONOR) === 10_000n, '6 · a node without the pot script skips re-verify (byte-identical) — enforcement is opt-in')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the burn is re-proven in the reducer, from bytes. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
