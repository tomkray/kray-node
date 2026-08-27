/**
 * ADR-1 EXTENDED · SELF-ANCHORING BURN IN CONSENSUS — the reducer re-derives the burn script.
 *
 * A donate event may name the seal its output rode (anchorBlock + anchorRoot) alongside its SPV
 * proof. The reducer then RE-DERIVES the expected script — the pot's internal key tweaked by
 * KrayAnchor.payload(anchorBlock, anchorRoot), BIP-341 pay-to-contract (NUMS key = keyless burn) —
 * and re-proves the proof against the DERIVED script on every apply and replay. A claim never
 * chooses the script; mathematics does. Present-but-false HALTs; absent fields are byte-identical;
 * verification is opt-in per node config (potInternalKeyHex), the exact ADR-1 polarity.
 *
 *   node src/test/self-anchor-consensus-proof.test.ts
 */
import { KrayLedger } from '../protocol/ledger.ts'
import { verifyDonationProof, donorOpReturnScriptHex, checkProofOfWork, sha256d } from '../anchor/spv.ts'
import { BURN_INTERNAL_KEY, selfAnchorBurnScriptHex } from '../protocol/self-anchor.ts'
import { KrayAnchor } from '../anchor/anchor.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const halts = (fn: () => void, re: RegExp, m: string) => { try { fn(); ok(false, m + ' — DID NOT throw') } catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong: ' + msg)) } }

// ── fixture builders (regtest), mirrored from donate-consensus-proof.test.ts ─────────
const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b.toString('hex') }
const pushScript = (hex: string) => (hex.length / 2).toString(16).padStart(2, '0') + hex
const DONOR = 'bcrt1pc9u6kpmgue4c3pyexa9erld2c8s26rl0nv5z2cgsgxzuluten0cs5vduyq'
const POT_SCRIPT = '5120' + '11'.repeat(32)   // the classic fixed pot, for the regression case
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
  console.log('\n╔═ ADR-1 EXT · SELF-ANCHORING BURN — the reducer derives the script, never trusts a claim ══╗\n')

  // THE SEAL — a real (blockNumber, root) pair; the burn script is the NUMS key tweaked by its payload.
  const SEAL = { blockNumber: 273, root: 'd075bab7e6140030536ded94cfd6003b01e31b843b4565a6387527261ea57249' }
  const BURN_SCRIPT = selfAnchorBurnScriptHex(KrayAnchor.payload(SEAL.blockNumber, SEAL.root))

  // an honest 10,000-sat self-anchoring burn: pays the tweaked NUMS output + commits the donor
  const good = tx([{ sats: 10_000n, script: BURN_SCRIPT }, { sats: 0n, script: donorOpReturnScriptHex(DONOR) }])
  const proof = bury(good)
  const v = verifyDonationProof(proof, { potScriptHex: BURN_SCRIPT, minConfirmations: 1, net: 'regtest' })
  ok(v.ok && v.sats === 10_000n && v.donor === DONOR, 'fixture: the self-anchor proof verifies against the tweaked NUMS script')
  const OUT = v.outpoint!

  const mk = () => new KrayLedger(undefined, 'regtest', POT_SCRIPT, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, BURN_INTERNAL_KEY)

  // ── 1 · a ledger that KNOWS the pot internal key: the sealed burn is re-derived, re-proven, mints ──
  const L = mk()
  L.applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '10000', outpoint: OUT, proof, anchorBlock: SEAL.blockNumber, anchorRoot: SEAL.root } as unknown as KrayEvent)
  ok(L.balanceOf(DONOR) === 10_000n, '1 · a sealed NUMS burn is RE-DERIVED + RE-PROVEN in consensus and mints 10,000 ₭')
  ok(L.conserves(), '1 · conservation holds')

  // ── 2 · the tx pays a DIFFERENT script while claiming the seal → derived script mismatch → HALT ──
  const elsewhere = bury(tx([{ sats: 10_000n, script: '5120' + '22'.repeat(32) }, { sats: 0n, script: donorOpReturnScriptHex(DONOR) }]))
  halts(() => mk().applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '10000', proof: elsewhere, anchorBlock: SEAL.blockNumber, anchorRoot: SEAL.root } as unknown as KrayEvent),
    /SPV proof does not verify|pays the anchoring pot/, '2 · a proof paying ELSEWHERE while claiming a seal is refused')

  // ── 3 · a TAMPERED root (one hex flipped) derives a different script → the honest proof fails → HALT ──
  const tampered = SEAL.root.slice(0, 63) + (SEAL.root.endsWith('9') ? 'a' : '9')
  halts(() => mk().applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '10000', proof, anchorBlock: SEAL.blockNumber, anchorRoot: tampered } as unknown as KrayEvent),
    /SPV proof does not verify|pays the anchoring pot/, '3 · a donation lying about WHICH root it sealed is refused (the tweak refutes it)')

  // ── 4 · a tampered BLOCK NUMBER is refused the same way ──
  halts(() => mk().applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '10000', proof, anchorBlock: SEAL.blockNumber + 1, anchorRoot: SEAL.root } as unknown as KrayEvent),
    /SPV proof does not verify|pays the anchoring pot/, '4 · a donation lying about WHICH block it sealed is refused')

  // ── 5 · a MALFORMED seal claim HALTs everywhere, config or not ──
  halts(() => mk().applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '10000', proof, anchorBlock: 1.5, anchorRoot: SEAL.root } as unknown as KrayEvent),
    /anchorBlock as a uint32/, '5a · a fractional anchorBlock is refused at the shape gate')
  halts(() => new KrayLedger(undefined, 'regtest').applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '10000', proof, anchorBlock: SEAL.blockNumber, anchorRoot: 'zz' } as unknown as KrayEvent),
    /anchorRoot as 32-byte/, '5b · a malformed anchorRoot HALTs even on an UNCONFIGURED node (shape is config-free)')

  // ── 6 · byte-identical skips: no internal key configured → sealed proof is skipped, mints (opt-in) ──
  const L6 = new KrayLedger(undefined, 'regtest', POT_SCRIPT)   // potScriptHex only, no internal key
  L6.applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '10000', outpoint: OUT, proof, anchorBlock: SEAL.blockNumber, anchorRoot: SEAL.root } as unknown as KrayEvent)
  ok(L6.balanceOf(DONOR) === 10_000n, '6 · without the pot internal key, a sealed proof is skipped (byte-identical) — enforcement is opt-in')

  // ── 7 · REGRESSION: the classic fixed-pot proof (no seal fields) still verifies against potScriptHex ──
  const classic = bury(tx([{ sats: 9_000n, script: POT_SCRIPT }, { sats: 0n, script: donorOpReturnScriptHex(DONOR) }]))
  const vc = verifyDonationProof(classic, { potScriptHex: POT_SCRIPT, minConfirmations: 1, net: 'regtest' })
  const L7 = mk()
  L7.applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '9000', outpoint: vc.outpoint!, proof: classic } as unknown as KrayEvent)
  ok(L7.balanceOf(DONOR) === 9_000n, '7 · a classic pot donation (no seal fields) still verifies against potScriptHex — nothing moved')
  halts(() => L7.applyLive({ seq: 2, kind: 'donate', to: DONOR, amount: '9000', proof } as unknown as KrayEvent),
    /SPV proof does not verify|pays the anchoring pot/, '7b · and a SEALED burn WITHOUT its seal fields cannot pass as a pot payment (no downgrade path)')

  // ── 8 · a donation with NO proof and NO seal is byte-identical to before ──
  const L8 = mk()
  L8.applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '5000', outpoint: 'aa'.repeat(32) + ':0' } as unknown as KrayEvent)
  ok(L8.balanceOf(DONOR) === 5_000n, '8 · a proofless donation still mints (the door is the gate) — the past replays unchanged')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the seal is re-derived from bytes; a lie cannot choose its own judge. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
