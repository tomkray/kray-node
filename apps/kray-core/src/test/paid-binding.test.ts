/**
 * THE PAID BINDING — the folder proof already lives in bytes that are already paid.
 *   node src/test/paid-binding.test.ts
 *
 * A Bitcoin txid NAMES a 49-byte OP_RETURN. That OP_RETURN NAMES the cascade root.
 * The cascade opening NAMES laneRoot (and xRoot, fireRoot, …). The Groth16 body
 * lives on the journal act already paid 1 ₭. Stuffing the proof into the txid
 * is past Fano's bound. A second foldRoot beside cascadeRoot is Huffman-redundant.
 * Fold-seal is not a special L1 encoding (Newton — same chain at every zoom).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KrayAnchor } from '../anchor/anchor.ts'
import {
  ANCHOR_DIGEST_BYTES,
  ANCHOR_PAYLOAD_BYTES,
  PAID_BINDING_CHAIN,
  digestContainsBody,
  HEIGHT_CEILING,
  heightYearsAtCadence,
  PAID_BINDING_VERIFY,
  certificateDoor,
  certificateOrRefuse,
  isRefusedBinding,
  paidBinding,
  paidBindingView,
} from '../anchor/paid-binding.ts'
import { cascadeRootFromParts, type CascadeParts } from '../protocol/cascade-root.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const artifact = JSON.parse(readFileSync(join(HERE, '../../../kray-fold/proofs/fold-groth16-v2.json'), 'utf8')) as { proof: string }

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function parts(over: Partial<CascadeParts> = {}): CascadeParts {
  return {
    seq: 256,
    emitted: '0',
    burned: '2',
    moneyRoot: 'money',
    starsRoot: 'stars',
    potCommitment: 'pot:0',
    runesCommitment: 'runes',
    contractsRoot: 'contracts',
    xRoot: 'aa'.repeat(32),
    fireRoot: 'bb'.repeat(32),
    laneRoot: 'cc'.repeat(32),
    ...over,
  }
}

function main() {
  console.log('\n╔═ THE PAID BINDING — the txid names the fold; it does not hold it ═╗\n')

  console.log('TC-01 — THE CHAIN (the archetype)')
  ok(PAID_BINDING_CHAIN.join(' → ') === 'journal-act → subsystem-root → cascade-root → op-return-49 → bitcoin-txid',
    'one small rule, iterated: act ⊂ root ⊂ cascade ⊂ 49-byte OP_RETURN ⊂ Bitcoin txid')

  console.log('\nTC-02 — THE NAME (Huffman: 49 bytes is already complete)')
  const pre = parts({ laneRoot: '11'.repeat(32) })
  const post = parts({ laneRoot: '22'.repeat(32) })
  const A = paidBinding(pre, 800_000)
  const B = paidBinding(post, 800_000)
  ok(A.payloadHex.length === ANCHOR_PAYLOAD_BYTES * 2, 'the OP_RETURN payload is exactly 49 bytes')
  ok(A.commitment.root === A.cascadeRoot && A.commitment.blockNumber === 800_000, 'decode recovers the exact cascade root and height')
  ok(A.cascadeRoot !== B.cascadeRoot && A.payloadHex !== B.payloadHex, 'a different laneRoot flips the cascade AND the already-paid OP_RETURN')
  ok(A.commitment.root !== post.laneRoot!, 'the 32 bytes on Bitcoin are the CASCADE, not the lane root alone — money/stars/fire stay bound')

  console.log('\nTC-03 — FANO: the digest cannot contain the Groth16 body')
  const proofHex = artifact.proof.toLowerCase()
  const proofBytes = proofHex.length / 2
  ok(proofBytes > ANCHOR_DIGEST_BYTES, `the committed Groth16 body is ${proofBytes} bytes — larger than a 32-byte digest`)
  ok(!digestContainsBody(ANCHOR_DIGEST_BYTES, proofBytes), 'Fano: a 32-byte txid/root cannot CONTAIN the proof body')
  ok(!A.payloadHex.includes(proofHex) && !B.payloadHex.includes(proofHex.slice(0, 32)),
    'the real V2 Groth16 bytes are not a substring of the 49-byte payload')
  ok(KrayAnchor.decode(A.payloadHex + proofHex) === null, 'stuffing the proof after the 49 bytes is not a KRAY.NETWORK anchor (decode refuses)')
  ok(KrayAnchor.decode(proofHex.slice(0, 98)) === null, 'a 49-byte slice of the proof itself is not an anchor (no KRAY.NETWORK tag)')

  console.log('\nTC-04 — NEWTON: fold-seal is not a special L1 encoding')
  const C = paidBinding(parts({ xRoot: 'dd'.repeat(32) }), 800_000)
  const D = paidBinding(parts({ fireRoot: 'ee'.repeat(32) }), 800_000)
  ok(C.cascadeRoot !== A.cascadeRoot && D.cascadeRoot !== A.cascadeRoot,
    'xRoot and fireRoot flip the same 49-byte name — the chain is one law at every zoom')
  ok(cascadeRootFromParts(pre) === A.cascadeRoot, 'the opening IS the root law — paidBinding does not invent a parallel hash')

  console.log('\nTC-05 — HUFFMAN: a second foldRoot beside the cascade is a duplicate')
  const asLane = KrayAnchor.payload(800_000, post.laneRoot!)
  ok(asLane !== B.payloadHex, 'committing laneRoot INSTEAD of the cascade would unbind money/stars/fire — refused')
  ok(B.commitment.root === B.cascadeRoot, 'the one 32-byte field stays the cascade — one commitment, zero drift')

  console.log('\nTC-06 — THE CERTIFICATE (Ada: a named object a stranger can hold; two epochs, never mixed)')
  const V = paidBindingView({
    seq: 256, kind: 'fold-seal', hash: 'ab'.repeat(32),
    sealed: { cascadeRoot: A.cascadeRoot, blockNumber: 800_000, bitcoinTxid: 'cd'.repeat(32), named: true },
    tip: { seq: 999, cascadeRoot: B.cascadeRoot, laneRoot: post.laneRoot },
  })
  ok(V.chain === PAID_BINDING_CHAIN && V.bodyInTxid === false && V.bytes === 49, 'the certificate names the chain and refuses body-in-txid')
  ok(V.sealed!.named === true && V.sealed!.bitcoinTxid === 'cd'.repeat(32) && V.sealed!.payload === A.payloadHex, 'the covering seal names its OWN historical 49-byte payload')
  ok(V.tip.payload === KrayAnchor.payload(999, B.cascadeRoot) && V.tip.laneRoot === post.laneRoot, 'the tip opening carries TODAY\'s roots against TODAY\'s payload')
  ok(V.sealed!.cascadeRoot !== V.tip.cascadeRoot && V.sealed!.payload !== V.tip.payload, 'the two epochs stay separate — a blended certificate would invite a false re-hash')
  const unnamed = paidBindingView({ seq: 1, tip: { seq: 1, cascadeRoot: A.cascadeRoot } })
  ok(unnamed.sealed === null && unnamed.bodyInTxid === false, 'no covering seal yet → sealed is null, never a fake name — Fano still holds')
  ok(V.tip.named === false && unnamed.tip.named === false, 'the tip is NEVER a covering Bitcoin name — a payload without a txid is a preview, not a seal')
  ok(V.verify === PAID_BINDING_VERIFY && unnamed.verify === PAID_BINDING_VERIFY, 'every certificate carries the same verify sentence — one law, not one per door')

  console.log('\nTC-07 — THE HEIGHT CEILING (the gauntlet grain, now a named object)')
  ok(V.ceiling === HEIGHT_CEILING && unnamed.ceiling === HEIGHT_CEILING, 'every certificate carries the SAME ceiling — one law, not one per page')
  ok(V.ceiling.bits === 32 && V.ceiling.max === 0xffffffff && V.ceiling.failClosed === true && V.ceiling.version === 1,
    'v1 height is u32, fail-closed, version 1 — v2 widening is A3, not this object')
  ok(heightYearsAtCadence(3500) < 1000 && heightYearsAtCadence(3500) > 400, 'at 3.5s/block the field saturates before 1000 years — the asterisk stays named')
  ok(KrayAnchor.payload(HEIGHT_CEILING.max, A.cascadeRoot).length === ANCHOR_PAYLOAD_BYTES * 2, 'the last legal height still encodes')
  let threw = false
  try { heightYearsAtCadence(0) } catch { threw = true }
  ok(threw, 'a zero cadence is refused — the formula does not invent infinity')
  threw = false
  try { KrayAnchor.payload(HEIGHT_CEILING.max + 1, A.cascadeRoot) } catch { threw = true }
  ok(threw, 'past the ceiling the codec throws — it never wraps')
  ok(/THE PAID BINDING/.test(PAID_BINDING_VERIFY) && /THE HEIGHT CEILING/.test(PAID_BINDING_VERIFY)
    && PAID_BINDING_VERIFY.includes('uint' + HEIGHT_CEILING.bits) && PAID_BINDING_VERIFY.includes('fail-closed'),
    'the receipt sentence is derived from HEIGHT_CEILING — Fano and the asterisk, one law')

  console.log('\nTC-08 — THE PAGE PINS (the custody card reads the object; it never echoes a lying tip name)')
  ok(V.tip.named === false && V.tip.named !== true, 'the page may print "preview" iff tip.named === false — never "named on Bitcoin"')
  ok(!!V.verify && !!V.ceiling && V.bodyInTxid === false, 'the three pins a stranger sees are on the object: verify, ceiling, bodyInTxid')

  console.log('\nTC-09 — CERTIFICATE OR REFUSE (the codec break is a named object; the act is not missing)')
  const held = certificateOrRefuse({
    seq: 256, kind: 'fold-seal', hash: 'ab'.repeat(32),
    sealed: { cascadeRoot: A.cascadeRoot, blockNumber: 800_000, bitcoinTxid: 'cd'.repeat(32), named: true },
    tip: { seq: 999, cascadeRoot: B.cascadeRoot, laneRoot: post.laneRoot },
  })
  ok(!isRefusedBinding(held) && held.verify === PAID_BINDING_VERIFY, 'an honest opening is a certificate, not a refusal')
  const past = certificateOrRefuse({ seq: 1, tip: { seq: HEIGHT_CEILING.max + 1, cascadeRoot: A.cascadeRoot } })
  ok(isRefusedBinding(past) && past.bodyInTxid === false && past.tip.named === false && past.ceiling === HEIGHT_CEILING,
    'past the u32 height the object is REFUSED — never a missing event, never a covering name')
  ok(/out of range/i.test(past.reason) && past.verify === PAID_BINDING_VERIFY, 'the reason is the codec; the verify sentence still names the law')
  const badRoot = certificateOrRefuse({ seq: 1, tip: { seq: 1, cascadeRoot: 'zz' } })
  ok(isRefusedBinding(badRoot) && badRoot.reason.length > 0, 'a malformed root is refused the same way — one mouth, every break')

  console.log('\nTC-10 — THE CERTIFICATE DOOR (200 / 400 / 404 — refuse is never missing)')
  const liveDoor = certificateDoor(held)
  const refuseDoor = certificateDoor(past)
  const missDoor = certificateDoor(null)
  const emptyDoor = certificateDoor(null, 'the journal is empty')
  ok(liveDoor.status === 200 && liveDoor.body === held, 'a live certificate is HTTP 200 — the body is the object')
  ok(refuseDoor.status === 400 && /out of range/i.test(refuseDoor.error) && refuseDoor.error === past.reason,
    'a codec break is HTTP 400 with the codec reason — the certificate door stays fail-closed')
  ok(missDoor.status === 404 && missDoor.error === 'no such event', 'a missing seq is HTTP 404 — never a codec 400')
  ok(emptyDoor.status === 404 && emptyDoor.error === 'the journal is empty', 'an empty journal is the same 404 class, named honestly')
  ok(refuseDoor.status !== missDoor.status && refuseDoor.error !== missDoor.error,
    'refuse and missing cannot collapse — two statuses, two sentences')

  console.log('\nTC-11 — TWO OBJECTS, NEVER MIXED (the name is not the merkle walk)')
  const receiptSrc = readFileSync(join(HERE, '../protocol/receipt.ts'), 'utf8')
  ok(!/paid-binding/.test(receiptSrc), 'verifyReceipt never imports the Binding name — the walk stays in protocol')
  ok(!/verifyReceipt/.test(readFileSync(join(HERE, '../anchor/paid-binding.ts'), 'utf8')),
    'the Binding name never imports verifyReceipt — two modules, one law each')

  console.log(`\n═ paid-binding: ${pass} passed, ${fail} failed ═\n`)
  if (fail > 0) process.exit(1)
}
main()
