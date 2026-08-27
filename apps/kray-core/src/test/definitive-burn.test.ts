/**
 * ADR-4 · slice 4c — THE DEFINITIVE BURN (Path A), pinned.
 *
 * A donation IS a real Bitcoin L1 transaction — the proof of burn already exists on-chain. The only question
 * is how DEEP it must be buried before the mint credits ₭. slice 4c makes that depth PER-NETWORK, equal to
 * Bitcoin's own customary settlement (main 6 / signet 2 / testnet 2 / regtest 1) — the same atemporal ruler
 * ANCHOR_CONF and SEAL_CONFIRMATIONS already use. Then the FROZEN journal proof is safe BY CONSTRUCTION: to
 * un-bury an already-credited mint an attacker must out-work N real Bitcoin blocks (Satoshi's 51%-style reorg),
 * so no ₭ ever survives without a settlement-final burn — the reorg-inflation vector (reviewer #7) is closed.
 * Crucially this keeps replay a PURE FUNCTION OF THE JOURNAL (a fixed per-network N + the frozen snapshot are
 * deterministic) — never a live-chain read, which would let two honest followers diverge.
 *
 *   node src/test/definitive-burn.test.ts
 */
import { KrayLedger } from '../protocol/ledger.ts'
import { DONATION_PROOF_MIN_CONF, donationProofMinConf } from '../protocol/kray-primitives.ts'
import { verifyDonationProof, donorOpReturnScriptHex, checkProofOfWork, sha256d } from '../anchor/spv.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const halts = (fn: () => void, re: RegExp, m: string) => { try { fn(); ok(false, m + ' — DID NOT throw') } catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong: ' + msg)) } }

// ── fixture builders (regtest), mirrored from donate-consensus-proof.test.ts ─────────
const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b.toString('hex') }
const pushScript = (hex: string) => (hex.length / 2).toString(16).padStart(2, '0') + hex
const POT_SCRIPT = '5120' + '11'.repeat(32)
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
// build a proof for `rawTx` buried under exactly `depth` chained headers (depth confirmations)
function bury(rawTx: string, depth: number) {
  const txidInternal = sha256d(Buffer.from(rawTx, 'hex'))
  const headers: Buffer[] = [mineHeader(Buffer.alloc(32), txidInternal)]
  for (let i = 1; i < depth; i++) headers.push(mineHeader(sha256d(headers[i - 1]), Buffer.alloc(32, i + 5)))
  return { rawTx, txoutproof: txoutProof(headers[0], txidInternal), headers: headers.map((h) => h.toString('hex')) }
}

console.log('\n╔═ THE DEFINITIVE BURN — ₭ is born only from a settlement-final Bitcoin burn ═══╗\n')

// ── 1 · the depth is per-network, and it is Bitcoin's own settlement ruler ───
console.log('─ 1 · the per-network depth (main 6 / signet 2 / testnet 2 / regtest 1) ─')
ok(donationProofMinConf('main') === 6, 'main requires 6 confirmations — Bitcoin\'s customary settlement')
ok(donationProofMinConf('signet') === 2 && donationProofMinConf('testnet') === 2, 'signet & testnet require 2')
ok(donationProofMinConf('regtest') === 1, 'regtest requires 1 — self-mined, byte-identical to the old flat value')
ok(DONATION_PROOF_MIN_CONF.main === 6 && DONATION_PROOF_MIN_CONF.regtest === 1, 'the table is a plain per-network map — re-derivable by every follower, no env, no magic')

// ── 2 · FAIL-CLOSED — an unknown network demands the DEEPEST burial, never the shallowest ──
console.log('\n─ 2 · fail-closed: an unknown net gets the hardest bar (main = 6) ─')
for (const bad of ['mainnet', 'bitcoin', 'liquid', '', 'REGTEST', 'xyz']) {
  ok(donationProofMinConf(bad) === 6, `donationProofMinConf(${JSON.stringify(bad)}) → 6 — a liar/typo gets the deepest requirement, never a cheap mint`)
}

// ── 3 · THE DEPTH GATE — a shallow (reversible) burn cannot mint at the mainnet rule ──
console.log('\n─ 3 · at the mainnet depth (6), a burn buried only 3 is REFUSED ─')
const good = tx([{ sats: 10_000n, script: POT_SCRIPT }, { sats: 0n, script: donorOpReturnScriptHex(DONOR) }])
const shallow3 = bury(good, 3)   // buried only 3 deep — a 3-block reorg could un-bury it
const deep6 = bury(good, 6)      // buried 6 deep — settlement-final
const vShallow = verifyDonationProof(shallow3, { potScriptHex: POT_SCRIPT, minConfirmations: 6, net: 'regtest' })
ok(!vShallow.ok, `a 3-confirmation burn FAILS the 6-deep rule (${vShallow.reason || 'refused'}) — a reversible burn mints nothing`)
const vDeep = verifyDonationProof(deep6, { potScriptHex: POT_SCRIPT, minConfirmations: 6, net: 'regtest' })
ok(vDeep.ok && vDeep.sats === 10_000n && vDeep.donor === DONOR, 'a 6-confirmation burn PASSES — a settlement-final burn mints exactly 10,000 ₭ to the committed donor')

// ── 4 · REGTEST is byte-identical — the old flat rule (1 conf) is preserved exactly ──
console.log('\n─ 4 · regtest (N=1) mints from a 1-conf burn, exactly as before ─')
const shallow1 = bury(good, 1)
const v1 = verifyDonationProof(shallow1, { potScriptHex: POT_SCRIPT, minConfirmations: donationProofMinConf('regtest'), net: 'regtest' })
ok(v1.ok && v1.sats === 10_000n, 'on regtest a 1-conf burn verifies — nothing about the existing bench path changed')

// ── 5 · THE REDUCER derives N from the network — a genuine regtest mint still works ──
console.log('\n─ 5 · the reducer re-verifies at the network\'s own N (regtest = 1) and mints ─')
const OUT = v1.outpoint!
const L = new KrayLedger(undefined, 'regtest', POT_SCRIPT)
L.applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '10000', outpoint: OUT, proof: shallow1 } as unknown as KrayEvent)
ok(L.balanceOf(DONOR) === 10_000n && L.conserves(), 'a genuine 1-conf donation is re-verified in the reducer at regtest\'s N=1 and mints 10,000 ₭, conserving')

// ── 6 · HOSTILE — the reorg-inflation vector is closed: no ₭ from a reversible burn ──
console.log('\n─ 6 · reorg-inflation closed — a burn shallower than settlement never mints ─')
halts(() => verifyDonationProofOrThrow(shallow3, 6), /confirmation|bur|depth|shallow/i, 'a 3-conf burn under the 6-deep rule is refused — you cannot mint ₭ from a burn a cheap reorg could erase')
ok(donationProofMinConf('main') > donationProofMinConf('regtest'), 'main demands strictly deeper burial than regtest — value creation on the real network is the most conservative')

function verifyDonationProofOrThrow(proof: { rawTx: string; txoutproof: string; headers: string[] }, minConfirmations: number) {
  const v = verifyDonationProof(proof, { potScriptHex: POT_SCRIPT, minConfirmations, net: 'regtest' })
  if (!v.ok) throw new Error(v.reason || 'burn proof shows too few confirmations for the law')
}

console.log(`\n╚═ ${pass} passed${fail ? ', ' + fail + ' FAILED' : ''} — ₭ is born only from a burn buried to Bitcoin's own settlement depth; the frozen proof is safe by construction, replay stays pure. ⚰️₿→₭\n`)
process.exit(fail ? 1 : 0)
