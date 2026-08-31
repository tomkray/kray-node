/**
 * SPV — the seal re-proven from bytes, and every forgery refused.
 *   node src/test/spv.test.ts
 *
 * Builds a synthetic one-transaction Bitcoin block from first principles (raw
 * tx with the 49-byte KRAY.NETWORK OP_RETURN, header whose merkle root IS the
 * txid, a second header burying it) and proves verifySealProof accepts exactly
 * the truth and names every lie: wrong root, wrong height, broken header
 * chain, missing depth, a proof for a different tx, malformed bytes.
 */
import { createHash } from 'node:crypto'
import { MIN_BLOCK_WORK, POW_LIMIT, checkProofOfWork, targetFromBits, workOfTarget, parseTx, verifySealProof, verifyTxOutProof, extractKraySeal, sha256d, toDisplayHex } from '../anchor/spv.ts'
import { KrayAnchor } from '../anchor/anchor.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}

const ROOT = createHash('sha256').update('the universe at block seven').digest('hex')
const HEIGHT = 7

// ── a minimal, legal, non-segwit tx: one null input, one OP_RETURN output ──
function buildRawTx(payloadHex: string): string {
  const parts = [
    '01000000', // version
    '01', '00'.repeat(32), 'ffffffff', '00', 'ffffffff', // 1 input: null outpoint, empty script, max sequence
    '01', '00'.repeat(8), '33', '6a31' + payloadHex, // 1 output: 0 sats, OP_RETURN + push49 + payload
    '00000000', // locktime
  ]
  return parts.join('')
}

/**
 * A header that is MINED, not merely shaped. Since proof-of-work is now verified,
 * a fixture has to satisfy its own declared target — even at regtest difficulty,
 * where roughly half of all nonces fail. Two or three tries on average, and the
 * test material becomes a real block instead of eighty arbitrary bytes.
 */
function buildHeader(prevInternal: Buffer, merkleRootInternal: Buffer): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0) // version
  prevInternal.copy(h, 4)
  merkleRootInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000, 68) // time
  h.writeUInt32LE(0x207fffff, 72) // bits (regtest-easy)
  for (let nonce = 0; nonce < 1_000_000; nonce++) {
    h.writeUInt32LE(nonce, 76)
    if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h
  }
  throw new Error('could not mine a regtest header — impossible in practice')
}

/** A BIP-37 merkleblock for a ONE-transaction block: the tree IS the txid. */
function buildTxOutProof(header: Buffer, txidInternal: Buffer): string {
  return Buffer.concat([
    header,
    Buffer.from([1, 0, 0, 0]), // total transactions = 1 (uint32 LE)
    Buffer.from([1]), txidInternal, // one hash
    Buffer.from([1]), Buffer.from([0x01]), // one flag byte: matched leaf
  ]).toString('hex')
}

function main() {
  const payload = KrayAnchor.payload(HEIGHT, ROOT)
  const rawTx = buildRawTx(payload)
  const txidInternal = sha256d(Buffer.from(rawTx, 'hex'))
  const txid = toDisplayHex(txidInternal)

  // ── the pieces, individually ─────────────────────────────────────────────
  ok(parseTx(rawTx).txidDisplay === txid, 'parseTx: a non-segwit tx hashes whole (txid == sha256d of all bytes)')
  const seal = extractKraySeal(rawTx)
  ok(!!seal && seal.blockNumber === HEIGHT && seal.cascadeRoot === ROOT, 'extractKraySeal: the 49-byte OP_RETURN decodes to height + root, structurally')

  const h1 = buildHeader(Buffer.alloc(32), txidInternal) // merkle root of a 1-tx block IS the txid
  const h2 = buildHeader(sha256d(h1), Buffer.alloc(32, 7))
  const h3 = buildHeader(sha256d(h2), Buffer.alloc(32, 9))
  const proofHex = buildTxOutProof(h1, txidInternal)
  const tv = verifyTxOutProof(proofHex)
  ok(tv.provenTxids.length === 1 && tv.provenTxids[0] === txid, 'verifyTxOutProof: the partial merkle tree proves exactly this txid')

  // ── the whole proof, true ────────────────────────────────────────────────
  const proof = { rawTx, txoutproof: proofHex, headers: [h1.toString('hex'), h2.toString('hex'), h3.toString('hex')] }
  // net: 'regtest' — these fixtures are regtest headers, and saying so is the
  // point: the same bytes judged with mainnet's ruler are REFUSED, because
  // regtest difficulty is easier than mainnet permits. Declaring the network is
  // now load-bearing rather than decorative.
  const v = verifySealProof(proof, { cascadeRoot: ROOT, blockNumber: HEIGHT, minConfirmations: 2, net: 'regtest' })
  ok(v.ok === true && v.txid === txid && v.confirmations === 3, `THE SEAL RE-PROVES FROM BYTES ALONE — txid, inclusion, ${v.confirmations} confs, root, height`)

  // ── every forgery, named ─────────────────────────────────────────────────
  const cases: Array<[string, Parameters<typeof verifySealProof>, RegExp]> = [
    ['wrong root', [proof, { cascadeRoot: 'ab'.repeat(32), blockNumber: HEIGHT, minConfirmations: 2, net: 'regtest' }], /not the promised/],
    ['wrong height', [proof, { cascadeRoot: ROOT, blockNumber: HEIGHT + 1, minConfirmations: 2, net: 'regtest' }], /not the promised/],
    ['depth short of the law', [{ ...proof, headers: proof.headers.slice(0, 1) }, { cascadeRoot: ROOT, blockNumber: HEIGHT, minConfirmations: 2, net: 'regtest' }], /only 1 confirmation/],
    ['broken header chain', [{ ...proof, headers: [proof.headers[0], proof.headers[2]] }, { cascadeRoot: ROOT, blockNumber: HEIGHT, minConfirmations: 2, net: 'regtest' }], /does not chain/],
    ['proof for a DIFFERENT tx', [{ ...proof, txoutproof: buildTxOutProof(h1, Buffer.alloc(32, 5)) }, { cascadeRoot: ROOT, blockNumber: HEIGHT, minConfirmations: 2, net: 'regtest' }], /merkle root does not match|does not prove/],
    ['header swapped under the proof', [{ ...proof, headers: [h2.toString('hex'), h3.toString('hex')] }, { cascadeRoot: ROOT, blockNumber: HEIGHT, minConfirmations: 2, net: 'regtest' }], /different block/],
    ['no OP_RETURN at all', [{ ...proof, rawTx: buildRawTx(payload).replace('6a31', '6a32') }, { cascadeRoot: ROOT, blockNumber: HEIGHT, minConfirmations: 2, net: 'regtest' }], /./],
  ]
  for (const [label, args, why] of cases) {
    const r = verifySealProof(...args)
    ok(!r.ok && why.test(r.reason ?? ''), `FORGERY REFUSED: ${label} — ${String(r.reason).slice(0, 60)}`)
  }

  // ── PROOF OF WORK — the attack that broke this file, now its law ─────────
  // An adversarial review fabricated 5,000 chained headers in TEN MILLISECONDS
  // with zero hashpower and the verifier accepted them, because depth was a
  // COUNT. A count is free to manufacture. These tests pin the fix.
  {
    // headers chained to nothing, declaring regtest-easy difficulty, unmined
    const forge = (n: number): string[] => {
      const out: string[] = []
      let prev = Buffer.alloc(32)
      for (let i = 0; i < n; i++) {
        const h = Buffer.alloc(80)
        h.writeUInt32LE(0x20000000, 0); prev.copy(h, 4)
        h.writeUInt32LE(1_700_000_000, 68); h.writeUInt32LE(0x207fffff, 72); h.writeUInt32LE(i, 76)
        out.push(h.toString('hex')); prev = sha256d(h)
      }
      return out
    }
    const t0 = Date.now()
    const fabricated = forge(200)
    ok(Date.now() - t0 < 2000, `200 headers fabricated in ${Date.now() - t0}ms with zero hashpower — manufacturing a COUNT is free, which is exactly why depth may never be one`)

    // 1 · mainnet's ruler refuses regtest-easy difficulty outright
    const asMain = checkProofOfWork(proof.headers[0], 'main')
    ok(!asMain.ok && /easier than this network allows/.test(asMain.reason ?? ''), 'a regtest header judged by MAINNET → REFUSED: difficulty easier than the network permits is invented difficulty, not Bitcoin\'s')

    // 2 · an unmined header is refused even at regtest difficulty
    const unmined = fabricated.find((h) => !checkProofOfWork(h, 'regtest').ok)
    ok(unmined !== undefined, 'among fabricated headers, some do not even meet the trivial regtest target — and those are REFUSED: a header must satisfy the target it declares')

    // 3 · a proof made of fabricated headers is refused, however long
    const forgedProof = { ...proof, headers: [proof.headers[0], ...fabricated] }
    const fv = verifySealProof(forgedProof, { cascadeRoot: ROOT, blockNumber: HEIGHT, minConfirmations: 2, net: 'regtest' })
    ok(!fv.ok, `a proof padded with ${fabricated.length} fabricated headers → REFUSED (${(fv.reason ?? '').slice(0, 54)}…)`)

    // 4 · WORK, not length, is what the verdict reports
    const honest = verifySealProof(proof, { cascadeRoot: ROOT, blockNumber: HEIGHT, minConfirmations: 2, net: 'regtest' })
    ok(honest.ok && typeof honest.work === 'bigint' && honest.work > 0n, `the verdict carries cumulative WORK (${honest.work}), not merely a header count`)
    ok(honest.powMeaningful === false, 'and on regtest it says out loud that the work means nothing — a development number must never be mistaken for Bitcoin\'s weight')

    // 5 · the arithmetic that makes forgery pointless on a real network
    const d1 = targetFromBits(0x1d00ffff)!, real = targetFromBits(0x17030ecd)!
    const ratio = workOfTarget(real) / workOfTarget(d1)
    ok(ratio > 1_000_000_000_000n, `ONE real mainnet block outweighs ${ratio} minimum-difficulty blocks — so a chain that cost nothing wins nothing, however long it is`)
    ok(targetFromBits(0x00000000) === null && targetFromBits(0x1d800000) === null, 'a zero mantissa and a negative-sign target are REFUSED rather than clamped — a malformed target is an attempt, not an accident')

    // ── THE FORGERY THAT SURVIVED THE FIRST FIX — a difficulty-1 chain ──────
    // Weighing headers saved fork choice but not the CLOCK, which counts
    // confirmations and reads its height from a coinbase the same attacker
    // forges. Mainnet's powLimit IS difficulty 1, so two headers costing 43
    // MICROSECONDS of ASIC time would have released the whole emission ladder.
    // The floor is what closes it, and it must never be optional again.
    const d1Work = workOfTarget(targetFromBits(0x1d00ffff)!)
    ok(MIN_BLOCK_WORK.main / d1Work > 1_000_000_000_000n,
      `mainnet's work floor is ${MIN_BLOCK_WORK.main / d1Work} times a difficulty-1 block — forging one now costs hours at an exahash, not microseconds`)
    ok(MIN_BLOCK_WORK.test === 0n && MIN_BLOCK_WORK.regtest === 0n,
      'testnet and regtest are exempt on purpose: testnet\'s 20-minute rule legitimately drops to difficulty 1, and regtest work means nothing at all')
    ok(MIN_BLOCK_WORK.signet === workOfTarget(POW_LIMIT.signet),
      `signet's floor (${MIN_BLOCK_WORK.signet}) IS workOfTarget(powLimit) — Bitcoin Signet's own minimum, never a recent-typical`)
    ok(MIN_BLOCK_WORK.signet < 206_097_345n,
      `signet's floor (${MIN_BLOCK_WORK.signet}) sits below the work a REAL recent signet block carries (206,097,345), so honest proofs pass`)
    // THE HISTORICAL ETCH THAT 2^24 REFUSED — DOG•GO•TO•THE•MOON at Signet 244701.
    // Its header is Bitcoin's (hash meets nBits, nBits inside powLimit) and its
    // work (13,408,187) sits between powLimit-work and the old 2^24 floor.
    // A floor that refuses an honest etch makes every mint-ancestry deposit of
    // that rune un-proveable; the live door named it `tx-unproven at 163c303c…`.
    {
      const dogEtch = '0000002011303bd3010218b13caeb1e3785f20f48add937dc8144ea1c689dfbe6b000000cbbadc62f80e9b8088aee9ffce6c8e6cdb452501970d9e24899d19700693189bb49105685340011eb41a2600'
      const dog = checkProofOfWork(dogEtch, 'signet')
      ok(dog.ok && dog.work === 13_408_187n, 'the DOG etch header is a real Signet block (PoW ok, work 13,408,187)')
      ok(dog.work >= MIN_BLOCK_WORK.signet, 'that honest historical work CLEARS the floor — a mint-ancestry deposit can bury the etch')
      ok(dog.work < (1n << 24n), 'the old 2^24 floor sat ABOVE this block — that was the hole, not a missing rite')
    }
    const asSignet = verifySealProof(proof, { cascadeRoot: ROOT, blockNumber: HEIGHT, minConfirmations: 2, net: 'signet' })
    ok(!asSignet.ok, 'regtest headers judged as SIGNET → REFUSED: their work cannot reach a real network\'s floor, so the floor cannot be dodged by mislabelling the network')
  }

  console.log(`\n✓ ${pass} checks passed — SPV: a confirmed seal re-proves itself from raw bytes with no Bitcoin node (tx→txid, txid→merkle→header, header→chain→depth, OP_RETURN→the exact promised root), and every forgery — wrong root, wrong height, short depth, broken chain, foreign tx, swapped header — is refused and NAMED. Bitcoin's mathematics, portable forever. ₿`)
}
main()
