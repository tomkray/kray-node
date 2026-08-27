/**
 * THE TRUSTLESS BITCOIN HEIGHT (ADR-3 · shared) — a block's absolute height, from its BIP-34 coinbase, re-derived
 * from bytes; and the seal-height re-proof that catches a writer who journals a LIED l1Height.
 *
 *   node src/test/bitcoin-height.test.ts
 *
 * Pins: provenBlockHeight reads the height from the coinbase at merkle INDEX 0 (a non-coinbase tx claiming a
 * height is refused); verifySealHeight accepts a seal whose l1Height matches the real block height and REFUSES a
 * lied one; both fail closed on garbage. This is the l1Height half of 3d-a made a fact a follower can check.
 */
import { provenBlockHeight, verifySealHeight } from '../protocol/bitcoin-height.ts'
import { sha256d, checkProofOfWork } from '../anchor/spv.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const SPV = { net: 'regtest', minConfirmations: 1 }

function buildHeader(m: Buffer): Buffer {
  const hh = Buffer.alloc(80); hh.writeUInt32LE(0x20000000, 0); m.copy(hh, 36); hh.writeUInt32LE(1_700_000_000, 68); hh.writeUInt32LE(0x207fffff, 72)
  for (let n = 1; n < 4_000_000; n++) { hh.writeUInt32LE(n >>> 0, 76); if (checkProofOfWork(hh.toString('hex'), 'regtest').ok) return hh }
  throw new Error('mine')
}
function rawTx(ss: string, os: string): string {
  const s = Buffer.from(ss, 'hex'), o = Buffer.from(os, 'hex')
  return Buffer.concat([Buffer.from('01000000', 'hex'), Buffer.from('01', 'hex'), Buffer.alloc(32), Buffer.from('ffffffff', 'hex'), Buffer.from([s.length]), s, Buffer.from('ffffffff', 'hex'), Buffer.from('01', 'hex'), Buffer.alloc(8), Buffer.from([o.length]), o, Buffer.from('00000000', 'hex')]).toString('hex')
}
const heightPush = (h: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(h); let n = 4; while (n > 1 && b[n - 1] === 0) n--; return Buffer.concat([Buffer.from([n]), b.subarray(0, n)]).toString('hex') }

/** a real 2-tx block: coinbase@0 (BIP-34 height h) + a seal/anchor tx@1. */
function block(h: number) {
  const coinbaseTx = rawTx(heightPush(h), '51')
  const sealTx = rawTx('0340d10c', '6a04deadbeef')   // an ordinary tx (a fake 840000 in its scriptSig — must not be read)
  const l0 = sha256d(Buffer.from(coinbaseTx, 'hex')), l1 = sha256d(Buffer.from(sealTx, 'hex'))
  const header = buildHeader(sha256d(Buffer.concat([l0, l1])))
  const mb = (f: number) => Buffer.concat([header, Buffer.from([2, 0, 0, 0]), Buffer.from([2]), l0, l1, Buffer.from([1]), Buffer.from([f])]).toString('hex')
  return { sealTx, coinbaseTx, headers: [header.toString('hex')], sealProof: mb(0x05), coinbaseProof: mb(0x03) }
}

function main() {
  console.log('\n╔═ THE TRUSTLESS BITCOIN HEIGHT — the seal height is a fact from the coinbase, not the writer\'s word ═╗\n')
  const b = block(850_000)
  const proof = { rawTx: b.sealTx, txoutproof: b.sealProof, headers: b.headers, coinbaseTx: b.coinbaseTx, coinbaseTxOutProof: b.coinbaseProof }

  // ── provenBlockHeight reads the real height from the coinbase at index 0 ──
  const h = provenBlockHeight(proof, SPV)
  ok(h.ok === true && (h as { height: number }).height === 850_000, 'provenBlockHeight reads 850000 from the BIP-34 coinbase at merkle index 0 — every byte re-derived')

  // ── a non-coinbase tx (index 1) claiming to be the coinbase is refused (its scriptSig is attacker bytes) ──
  const forged = provenBlockHeight({ ...proof, coinbaseTx: b.sealTx, coinbaseTxOutProof: b.sealProof }, SPV)
  ok(forged.ok === false && /index 0/.test((forged as { reason: string }).reason), 'a non-coinbase tx (index 1) with a chosen height in its scriptSig is REFUSED — only merkle index 0 is the coinbase')

  // ── verifySealHeight: a matching l1Height passes; a LIED one is refused ──
  ok(verifySealHeight(850_000, proof, SPV).ok === true, 'a seal whose journalled l1Height MATCHES its real Bitcoin height verifies')
  const lied = verifySealHeight(840_000, proof, SPV)
  ok(lied.ok === false && /not the journalled l1Height|is at Bitcoin height/.test((lied as { reason: string }).reason), 'a seal journalled with a LIED l1Height (840000) is REFUSED — the block is really at 850000; a follower cannot be fooled into a wrong window boundary')
  ok(verifySealHeight(0, proof, SPV).ok === false && verifySealHeight(-5, proof, SPV).ok === false, 'a non-positive claimed height is refused')

  // ── fail-closed on garbage ──
  const garbled = verifySealHeight(850_000, { rawTx: 'zz', txoutproof: 'zz', headers: ['00'], coinbaseTx: 'zz', coinbaseTxOutProof: 'zz' }, SPV)
  ok(garbled.ok === false && /malformed|not buried/.test((garbled as { reason: string }).reason), 'a malformed proof returns a NAMED refusal, never an uncaught throw (fail-closed)')

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the seal's height is the coinbase's BIP-34 bytes, checkable by any follower; a lied l1Height cannot survive. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
