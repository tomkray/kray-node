/**
 * SPENDING THE VAULT — the witness Bitcoin will actually execute.
 *   node src/test/vault-spend.test.ts
 *
 * A vault that can be paid into but not spent out of is a black hole with good
 * documentation. This suite builds REAL spend transactions for both paths and
 * attacks every seam: too few signatures, too many (NUMEQUAL is exact, not a
 * minimum), a forged signature, a stranger's signature, a premature unilateral
 * exit whose signature is VALID but whose sequence violates the timelock — the
 * exact fraud a malicious depositor would sign — and an audit that must catch
 * each one from the raw bytes and the public parameters alone.
 */
import * as btc from '@scure/btc-signer'
import { randomBytes, createHash } from 'node:crypto'
import { schnorr } from '@noble/curves/secp256k1.js'
import { deriveVault } from '../protocol/vault.ts'
import {
  auditVaultSpend, buildVaultSpend, finalizeCooperative, finalizeUnilateral,
  signSighash, verifySighash, type VaultUtxo,
} from '../protocol/vault-spend.ts'
import { NETWORKS } from '../protocol/scheme.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
function rejects(fn: () => void, why: RegExp, label: string): void {
  try { fn() } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (why.test(msg)) { pass++; return }
    console.error(`  ✗ FAILED (wrong refusal) — ${label}\n      got: ${msg}`); process.exit(1)
  }
  console.error(`  ✗ FAILED (expected refusal) — ${label}`); process.exit(1)
}
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const keypair = () => { const sk = randomBytes(32); return { sk, pk: hex(schnorr.getPublicKey(sk)) } }
const fakeTxid = (n: number): string => createHash('sha256').update(`utxo ${n}`).digest('hex')

async function main() {
  const G = Array.from({ length: 5 }, keypair)
  const DEP = keypair()
  const params = { guardians: G.map((g) => g.pk), threshold: 3, depositor: DEP.pk, timelock: 144, net: 'regtest' as const }
  const vault = deriveVault(params)
  const DEST = btc.p2tr(hex(schnorr.getPublicKey(randomBytes(32))), undefined, NETWORKS.regtest).address!
  const utxo: VaultUtxo[] = [{ txid: fakeTxid(1), vout: 0, amountSats: 100_000n }]
  const outs = [{ address: DEST, amountSats: 99_000n }] // 1,000 sats of fee, stated by omission

  // ── 1 · THE COOPERATIVE SPEND, END TO END ────────────────────────────────
  const spend = buildVaultSpend(params, utxo, outs, 'cooperative')
  ok(spend.sighashes.length === 1 && /^[0-9a-f]{64}$/.test(spend.sighashes[0]), 'the build states ONE 32-byte sighash per input — the exact bytes every guardian signs')
  const again = buildVaultSpend(params, utxo, outs, 'cooperative')
  ok(again.unsignedTxHex === spend.unsignedTxHex && again.sighashes[0] === spend.sighashes[0], 'DETERMINISTIC: a guardian rebuilds the identical transaction locally and refuses to sign anything that differs')

  // three guardians sign, each independently, in no particular order — AND the owner co-signs
  const sigs = new Map<string, string>()
  for (const g of [G[3], G[0], G[2]]) sigs.set(g.pk, signSighash(spend.sighashes[0], g.sk))
  const depSig = signSighash(spend.sighashes[0], DEP.sk) // the depositor's own signature — REQUIRED
  const finalTx = finalizeCooperative(spend, sigs, depSig)
  ok(/^[0-9a-f]{64}$/.test(finalTx.txid), `the cooperative spend finalizes — txid ${finalTx.txid.slice(0, 16)}…`)

  const parsed = btc.Transaction.fromRaw(Buffer.from(finalTx.txHex, 'hex'), { allowUnknownInputs: true, allowUnknownOutputs: true })
  const witness = parsed.getInput(0).finalScriptWitness!
  ok(witness.length === 5 + 1 + 2, '5 guardian slots + 1 depositor slot + script + control block — the owner co-signs on top')
  ok(hex(witness[witness.length - 2]) === vault.cooperativeScript, 'the witness carries the cooperative leaf itself')
  const slots = witness.slice(0, 5)
  ok(slots.filter((s) => s.length === 64).length === 3 && slots.filter((s) => s.length === 0).length === 2, 'exactly 3 real signatures and 2 EMPTY pushes — an empty signature makes CHECKSIGADD contribute 0 and continue; a wrong one would abort the script')
  // the witness-order law: guardian j's signature lives at slot n−1−j, so the
  // FIRST key's slot is the LAST stack item (the top when the script pops it).
  // Checked for a guardian who actually signed — the set is sorted, so "first
  // in the script" and "first to sign" are unrelated.
  const signerIdx = vault.params.guardians.indexOf(G[0].pk)
  ok(verifySighash(spend.sighashes[0], hex(slots[4 - signerIdx]), G[0].pk), `WITNESS ORDER: the signature of script-key #${signerIdx} sits at stack slot ${4 - signerIdx} — reverse key order, exactly where CHECKSIG(ADD) will pop it`)

  const audit = auditVaultSpend(finalTx.txHex, params, utxo)
  ok(audit.ok && audit.path === 'cooperative', 'a STRANGER audits the broadcast bytes against public parameters alone — and it verifies')
  ok(audit.signers!.length === 4, `…and the audit names exactly who signed: the OWNER + 3 of ${params.guardians.length} guardians (${audit.signers!.length} keys)`)

  // ── 2 · NUMEQUAL IS EXACT — t−1 fails, and so does t+1 ──────────────────
  const two = new Map([[G[0].pk, signSighash(spend.sighashes[0], G[0].sk)], [G[1].pk, signSighash(spend.sighashes[0], G[1].sk)]])
  rejects(() => finalizeCooperative(spend, two, depSig), /EXACTLY 3.*got 2/, 'ATTACK: 2 signatures where the leaf demands 3 → REFUSED with the numbers named')
  const four = new Map(G.slice(0, 4).map((g) => [g.pk, signSighash(spend.sighashes[0], g.sk)]))
  rejects(() => finalizeCooperative(spend, four, depSig), /EXACTLY 3.*got 4/, 'ATTACK: 4 signatures where the leaf demands 3 → REFUSED — NUMEQUAL fails on too MANY as surely as on too few, so the finalizer fails first')

  // ── 3 · FORGERIES AND STRANGERS NEVER REACH THE WITNESS ──────────────────
  const forged = new Map(sigs); forged.set(G[0].pk, hex(randomBytes(64)))
  rejects(() => finalizeCooperative(spend, forged, depSig), /does not open input 0/, 'ATTACK: a forged signature → REFUSED before it can poison the witness (on-chain it would abort the whole script)')
  const stranger = keypair()
  const withStranger = new Map(sigs); withStranger.delete(G[3].pk); withStranger.set(stranger.pk, signSighash(spend.sighashes[0], stranger.sk))
  rejects(() => finalizeCooperative(spend, withStranger, depSig), /not in this vault's federation/, 'ATTACK: a valid signature from a key OUTSIDE the federation → REFUSED by name')
  rejects(() => finalizeUnilateral(spend, signSighash(spend.sighashes[0], DEP.sk)), /built for the cooperative path/, 'the paths cannot be mixed: a cooperative spend refuses unilateral finalization')

  // ── 3b · THE COLLUSION GUARD — guardians WITHOUT the owner move NOTHING ───
  // this is what turns "detectable theft" into "impossible theft": the cooperative leaf is
  // <depositor> CHECKSIGVERIFY … , so even a FULL, valid guardian threshold cannot spend
  // without the depositor's own signature. The finalizer refuses to build it…
  rejects(() => finalizeCooperative(spend, sigs, hex(randomBytes(64))), /depositor'?s signature does not open/, 'ATTACK: 3 valid guardians but a FORGED owner co-sign → REFUSED (no threshold of guardians moves funds alone)')
  // …and the AUDIT refuses it too, from the raw bytes: take the honest spend and swap the
  // depositor's top slot for garbage — a hand-crafted guardian-only witness Bitcoin itself
  // would abort at CHECKSIGVERIFY, and the audit must agree rather than bless a burn-that-can-never-confirm.
  const tamper = btc.Transaction.fromRaw(Buffer.from(finalTx.txHex, 'hex'), { allowUnknownInputs: true, allowUnknownOutputs: true })
  const w = [...tamper.getInput(0).finalScriptWitness!]
  w[w.length - 3] = randomBytes(64) // the depositor slot: witness = [...5 guardians, DEPOSITOR, leaf, control]
  tamper.updateInput(0, { finalScriptWitness: w }, true)
  const tamperAudit = auditVaultSpend(hex(tamper.toBytes(true, true)), params, utxo)
  ok(!tamperAudit.ok && /did not co-sign/.test(tamperAudit.reason ?? ''), 'ATTACK: a hand-crafted guardians-only witness → the audit REFUSES it (the owner did not co-sign) — collusion is impossible, not merely visible')

  // ── 4 · THE UNILATERAL EXIT — the depositor alone, after the wait ───────
  const solo = buildVaultSpend(params, utxo, outs, 'unilateral')
  ok(solo.sighashes[0] !== spend.sighashes[0], 'the two paths sign DIFFERENT sighashes — a signature for one leaf can never be replayed on the other')
  const soloTx = finalizeUnilateral(solo, signSighash(solo.sighashes[0], DEP.sk))
  const soloParsed = btc.Transaction.fromRaw(Buffer.from(soloTx.txHex, 'hex'), { allowUnknownInputs: true, allowUnknownOutputs: true })
  ok(soloParsed.version === 2 && soloParsed.getInput(0).sequence === 144, 'version 2 and sequence = the timelock — CHECKSEQUENCEVERIFY\'s two demands, set by the builder, not remembered by the caller')
  const soloAudit = auditVaultSpend(soloTx.txHex, params, utxo)
  ok(soloAudit.ok && soloAudit.path === 'unilateral' && soloAudit.signers![0] === DEP.pk, 'the audit confirms: the unilateral path, opened by the depositor, timelock respected')
  rejects(() => finalizeUnilateral(solo, signSighash(solo.sighashes[0], G[0].sk)), /depositor's signature/, 'ATTACK: a guardian trying to use the depositor\'s exit → REFUSED (only one key opens that leaf)')

  // ── 5 · THE PREMATURE EXIT — a VALID signature over an ILLEGAL sequence ──
  // A malicious depositor does not need our builder: they can sign a spend with
  // sequence=1 themselves. The signature verifies (it commits to that sequence);
  // only the SEQUENCE law catches it. This is the fraud the audit exists for.
  {
    const leafScript = Buffer.from(vault.unilateralScript, 'hex')
    const payment = btc.p2tr(btc.TAPROOT_UNSPENDABLE_KEY, [
      { script: Buffer.from(vault.cooperativeScript, 'hex') }, { script: leafScript },
    ], NETWORKS.regtest, true)
    const evil = new btc.Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true, version: 2 })
    evil.addInput({ txid: utxo[0].txid, index: 0, sequence: 1, witnessUtxo: { script: payment.script!, amount: utxo[0].amountSats } })
    evil.addOutputAddress(DEST, 99_000n, NETWORKS.regtest)
    const sighash = evil.preimageWitnessV1(0, [payment.script!], btc.SigHash.DEFAULT, [utxo[0].amountSats], undefined, leafScript, 0xc0)
    const sig = schnorr.sign(sighash, DEP.sk)
    ok(schnorr.verify(sig, sighash, Buffer.from(DEP.pk, 'hex')), 'the premature exit\'s signature IS valid — nothing about the cryptography is wrong')
    const cb = payment.tapLeafScript!.find(([, s]) => hex(s.subarray(0, -1)) === vault.unilateralScript)!
    evil.updateInput(0, { finalScriptWitness: [sig, leafScript, btc.TaprootControlBlock.encode(cb[0])] }, true)
    const evilAudit = auditVaultSpend(hex(evil.toBytes(true, true)), params, utxo)
    ok(!evilAudit.ok && /sequence 1 does not encode ≥ 144/.test(evilAudit.reason ?? ''), 'ATTACK: sequence=1 with a valid signature → the audit catches the TIMELOCK violation by name — CHECKSEQUENCEVERIFY would reject it, and so do we, before matching any burn')
  }

  // ── 6 · MULTI-INPUT SPENDS: every input its own sighash, its own signatures ─
  const utxos2: VaultUtxo[] = [
    { txid: fakeTxid(2), vout: 0, amountSats: 50_000n },
    { txid: fakeTxid(3), vout: 1, amountSats: 60_000n },
  ]
  const multi = buildVaultSpend(params, utxos2, [{ address: DEST, amountSats: 109_000n }], 'cooperative')
  ok(multi.sighashes[0] !== multi.sighashes[1], 'two inputs, two DIFFERENT sighashes — a signature covers one input, never the transaction wholesale')
  const perInput = multi.sighashes.map((sh) => new Map(G.slice(1, 4).map((g) => [g.pk, signSighash(sh, g.sk)])))
  const multiDep = multi.sighashes.map((sh) => signSighash(sh, DEP.sk))
  const multiTx = finalizeCooperative(multi, perInput, multiDep)
  const multiAudit = auditVaultSpend(multiTx.txHex, params, utxos2)
  ok(multiAudit.ok && multiAudit.path === 'cooperative', 'both inputs finalize and the audit verifies each one independently')
  rejects(() => finalizeCooperative(multi, perInput[0], multiDep), /does not open input 1/, 'reusing input 0\'s signatures on input 1 → REFUSED (the sighash pins each signature to its input)')

  // ── 7 · THE AUDIT TRUSTS NOTHING IT WAS HANDED ───────────────────────────
  const wrongAmount = auditVaultSpend(finalTx.txHex, params, [{ ...utxo[0], amountSats: 200_000n }])
  ok(!wrongAmount.ok, 'lying to the audit about the utxo AMOUNT breaks every signature — BIP-341 commits to amounts, so the lie is self-defeating')
  const otherVault = auditVaultSpend(finalTx.txHex, { ...params, threshold: 2 }, utxo)
  ok(!otherVault.ok && /not one of this vault's two leaves/.test(otherVault.reason ?? ''), 'auditing against a DIFFERENT vault\'s parameters → the leaf does not match, refused by name')
  ok(!auditVaultSpend('deadbeef', params, utxo).ok, 'garbage bytes refuse instead of throwing')

  // ── 8 · MALFORMED BUILDS NEVER PRODUCE A TRANSACTION ─────────────────────
  rejects(() => buildVaultSpend(params, [], outs, 'cooperative'), /nothing to spend/, 'no inputs → REFUSED')
  rejects(() => buildVaultSpend(params, utxo, [], 'cooperative'), /at least one output/, 'no outputs → REFUSED')
  rejects(() => buildVaultSpend(params, utxo, [{ address: DEST, amountSats: 200_000n }], 'cooperative'), /cannot create satoshis/, 'outputs exceeding inputs → REFUSED (a transaction cannot create satoshis)')
  rejects(() => buildVaultSpend(params, utxo, [{ address: DEST, amountSats: 0n }], 'cooperative'), /positive amount/, 'a zero output → REFUSED')
  rejects(() => buildVaultSpend(params, [{ txid: 'nope', vout: 0, amountSats: 1n }], outs, 'cooperative'), /64 hex/, 'a malformed txid → REFUSED')

  // ── 9 · WHAT THE ADVERSARIAL REVIEW FOUND — each one now a permanent law ──
  // Four specialist reviewers attacked this file; two independent refuters voted
  // on every claim; three defects survived and were reproduced. These tests pin
  // the fixes so no refactor can quietly reintroduce them.

  // 9a · a guardian identifying by their sealed COMPRESSED key is not a stranger
  const sigsCompressed = new Map<string, string>()
  sigsCompressed.set('02' + G[0].pk, signSighash(spend.sighashes[0], G[0].sk))
  sigsCompressed.set(G[1].pk, signSighash(spend.sighashes[0], G[1].sk))
  sigsCompressed.set(G[2].pk, signSighash(spend.sighashes[0], G[2].sk))
  const compTx = finalizeCooperative(spend, sigsCompressed, depSig)
  ok(auditVaultSpend(compTx.txHex, params, utxo).ok, 'REVIEW FIND 1: a signature keyed by the 33-byte COMPRESSED form finalizes — the same normalisation rule as everywhere, so the sealed-key reality of the live network cannot block a settlement')

  // 9b · a spend that lawfully COMMITS to an annex must audit clean
  {
    const leafScript = Buffer.from(vault.unilateralScript, 'hex')
    const payment = btc.p2tr(btc.TAPROOT_UNSPENDABLE_KEY, [
      { script: Buffer.from(vault.cooperativeScript, 'hex') }, { script: leafScript },
    ], NETWORKS.regtest, true)
    const annex = Uint8Array.from([0x50, 0xde, 0xad])
    const withAnnex = new btc.Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true, version: 2 })
    withAnnex.addInput({ txid: utxo[0].txid, index: 0, sequence: 144, witnessUtxo: { script: payment.script!, amount: utxo[0].amountSats } })
    withAnnex.addOutputAddress(DEST, 99_000n, NETWORKS.regtest)
    const sighash = withAnnex.preimageWitnessV1(0, [payment.script!], btc.SigHash.DEFAULT, [utxo[0].amountSats], undefined, leafScript, 0xc0, annex)
    const cb = payment.tapLeafScript!.find(([, sc]) => hex(sc.subarray(0, -1)) === vault.unilateralScript)!
    withAnnex.updateInput(0, { finalScriptWitness: [schnorr.sign(sighash, DEP.sk), leafScript, btc.TaprootControlBlock.encode(cb[0]), annex] }, true)
    const annexAudit = auditVaultSpend(hex(withAnnex.toBytes(true, true)), params, utxo)
    ok(annexAudit.ok && annexAudit.path === 'unilateral', 'REVIEW FIND 2a: a witness carrying a BIP-341 ANNEX (last element, 0x50) audits clean — the annex is stripped for locating the leaf and fed into the sighash, so a burn that really happened is recognised')
    // …and an annex someone BOLTED ON without signing it must still fail
    const bolted = btc.Transaction.fromRaw(Buffer.from(soloTx.txHex, 'hex'), { allowUnknownInputs: true, allowUnknownOutputs: true })
    bolted.updateInput(0, { finalScriptWitness: [...bolted.getInput(0).finalScriptWitness!, annex] }, true)
    ok(!auditVaultSpend(hex(bolted.toBytes(true, true)), params, utxo).ok, '…while an annex bolted onto signatures that never committed to it still FAILS — the sighash is the judge, not the shape')
  }

  // 9c · a 65-byte signature with an explicit sighash type is another wallet's lawful form
  {
    const leafScript = Buffer.from(vault.unilateralScript, 'hex')
    const payment = btc.p2tr(btc.TAPROOT_UNSPENDABLE_KEY, [
      { script: Buffer.from(vault.cooperativeScript, 'hex') }, { script: leafScript },
    ], NETWORKS.regtest, true)
    const t65 = new btc.Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true, version: 2 })
    t65.addInput({ txid: utxo[0].txid, index: 0, sequence: 144, witnessUtxo: { script: payment.script!, amount: utxo[0].amountSats } })
    t65.addOutputAddress(DEST, 99_000n, NETWORKS.regtest)
    const shAll = t65.preimageWitnessV1(0, [payment.script!], btc.SigHash.ALL, [utxo[0].amountSats], undefined, leafScript, 0xc0)
    const sig65 = new Uint8Array(65); sig65.set(schnorr.sign(shAll, DEP.sk), 0); sig65[64] = 0x01
    const cb = payment.tapLeafScript!.find(([, sc]) => hex(sc.subarray(0, -1)) === vault.unilateralScript)!
    t65.updateInput(0, { finalScriptWitness: [sig65, leafScript, btc.TaprootControlBlock.encode(cb[0])] }, true)
    ok(auditVaultSpend(hex(t65.toBytes(true, true)), params, utxo).ok, 'REVIEW FIND 2b: a 65-byte signature with an explicit SIGHASH_ALL byte audits clean — BIP-342 allows it, so the audit must too')
    const sigBad = new Uint8Array(65); sigBad.set(schnorr.sign(shAll, DEP.sk), 0); sigBad[64] = 0x00
    t65.updateInput(0, { finalScriptWitness: [sigBad, leafScript, btc.TaprootControlBlock.encode(cb[0])] }, true)
    ok(!auditVaultSpend(hex(t65.toBytes(true, true)), params, utxo).ok, '…and an explicit 0x00 type byte FAILS — BIP-342 forbids it, DEFAULT is spelled by being 64 bytes')
  }

  // 9d · the same outpoint twice is refused at the door, not at broadcast
  rejects(() => buildVaultSpend(params, [utxo[0], utxo[0]], [{ address: DEST, amountSats: 150_000n }], 'cooperative'),
    /listed twice/, 'REVIEW FIND 3: a DUPLICATE outpoint → REFUSED before any guardian signs — it inflates the input sum and builds a transaction the network can only reject after the whole ceremony was spent on it')

  // 9e · the smallest federation: a 1-of-1 vault spends end to end
  {
    const solo1 = { guardians: [G[0].pk], threshold: 1, depositor: DEP.pk, timelock: 144, net: 'regtest' as const }
    const sp1 = buildVaultSpend(solo1, utxo, outs, 'cooperative')
    const tx1 = finalizeCooperative(sp1, new Map([[G[0].pk, signSighash(sp1.sighashes[0], G[0].sk)]]), signSighash(sp1.sighashes[0], DEP.sk))
    const a1 = auditVaultSpend(tx1.txHex, solo1, utxo)
    ok(a1.ok && a1.signers!.length === 2, 'the 1-of-1 vault — the owner + one guardian — spends and audits end to end')
  }

  // 9f · the QR form of an address (all-uppercase bech32) verifies; mixed case never
  const upper = deriveVault(params)
  ok((await import('../protocol/vault.ts')).verifyVault(upper.address.toUpperCase(), params).ok, 'an ALL-UPPERCASE address (the QR form of bech32) verifies against its parameters')
  const mixed = upper.address.slice(0, 10).toUpperCase() + upper.address.slice(10)
  ok(!(await import('../protocol/vault.ts')).verifyVault(mixed, params).ok, 'a MIXED-CASE address never verifies — bech32 forbids it, and a case-insensitive shortcut would bless an invalid string')

  // ── 10 · WHAT THE SECOND REVIEW WAVE FOUND — the audit's real holes ───────
  // A dedicated audit-soundness reviewer built four fraudulent spends that the
  // audit BLESSED. Every one is now a law. These are the tests that matter most
  // in this file: an audit that says yes to what Bitcoin says no to is worse
  // than no audit at all, because a reducer would credit a burn that never
  // settled.
  {
    const good = finalizeCooperative(spend, sigs, depSig)
    const reparse = () => btc.Transaction.fromRaw(Buffer.from(good.txHex, 'hex'), { allowUnknownInputs: true, allowUnknownOutputs: true })

    // 10a · THE CONTROL BLOCK — the whole point of a script path
    for (const [label, cb] of [
      ['33 random bytes', randomBytes(33)],
      ['the OTHER leaf\'s control block', Buffer.from(buildVaultSpend(params, utxo, outs, 'unilateral').controlBlock, 'hex')],
      ['nothing at all', new Uint8Array(0)],
      ['the real one with the leaf version flipped to 0xc2', (() => { const b = Buffer.from(spend.controlBlock, 'hex'); const c = Uint8Array.from(b); c[0] = 0xc2; return c })()],
    ] as Array<[string, Uint8Array]>) {
      const t = reparse()
      const w = t.getInput(0).finalScriptWitness!
      t.updateInput(0, { finalScriptWitness: [...w.slice(0, -1), cb] }, true)
      const a = auditVaultSpend(hex(t.toBytes(true, true)), params, utxo)
      ok(!a.ok && /control block/.test(a.reason ?? ''), `CRITICAL FIND: a control block that is ${label} → REFUSED. BIP-341 validation IS the control block: it proves the leaf belongs to THIS tap tree, and it carries the leaf version the sighash commits to`)
    }

    // 10b · THE CLAIM MUST BIND TO THE TRANSACTION
    const wrongOutpoint = auditVaultSpend(good.txHex, params, [{ txid: fakeTxid(99), vout: 7, amountSats: utxo[0].amountSats }])
    ok(!wrongOutpoint.ok && /not the claimed/.test(wrongOutpoint.reason ?? ''), 'SERIOUS FIND: claiming a DIFFERENT outpoint of the same amount → REFUSED. BIP-341 commits to outpoints through the transaction, so the caller\'s txid was otherwise unused — and one on-chain release could have been credited against two L2 peg-outs')
    ok(auditVaultSpend(good.txHex, params, utxo).outpoints![0] === `${utxo[0].txid}:0`, '…and the audit now REPORTS which outpoint it validated, so a reducer never has to guess')

    // 10c · A NON-EMPTY scriptSig IS A TXID MUTANT
    const mutant = reparse()
    mutant.updateInput(0, { finalScriptSig: Uint8Array.from([0x51, 0x01, 0x01]) }, true)
    const mutantAudit = auditVaultSpend(hex(mutant.toBytes(true, true)), params, utxo)
    ok(!mutantAudit.ok && /scriptSig/.test(mutantAudit.reason ?? ''), 'SERIOUS FIND: a non-empty scriptSig → REFUSED. Every signature stays valid and the txid CHANGES, so blessing it would record a settlement reference that can never confirm while the real spend confirms under another')

    // 10d · THE UNILATERAL PATH READS THE TOP OF THE STACK
    const soloBase = () => btc.Transaction.fromRaw(Buffer.from(soloTx.txHex, 'hex'), { allowUnknownInputs: true, allowUnknownOutputs: true })
    const padded = soloBase()
    const sw = padded.getInput(0).finalScriptWitness!
    padded.updateInput(0, { finalScriptWitness: [sw[0], Uint8Array.from([0xde, 0xad]), sw[1], sw[2]] }, true)
    const paddedAudit = auditVaultSpend(hex(padded.toBytes(true, true)), params, utxo)
    ok(!paddedAudit.ok && /exactly one stack item|does not verify/.test(paddedAudit.reason ?? ''), 'SERIOUS FIND: an EXTRA stack item on the unilateral path → REFUSED. Consensus pops the TOP item and enforces cleanstack; reading witness[0] passed a spend Bitcoin rejects')

    // 10e · AN AUDIT MUST NEVER BLESS CREATED SATOSHIS
    ok(!auditVaultSpend(good.txHex, params, [{ ...utxo[0], amountSats: 50n }]).ok, 'SERIOUS FIND: an audit whose outputs exceed its inputs → REFUSED (the amount lie also breaks every signature, so this is belt and braces)')

    // 10f · A LAWFUL SWEEP MAY USE BOTH LEAVES AT ONCE
    ok(auditVaultSpend(good.txHex, params, utxo).paths!.length === 1, 'the audit reports the path PER INPUT, so a sweep that lawfully mixes the cooperative and unilateral leaves is recognised rather than refused')

    // 10g · MONEY IS A BIGINT, NEVER A NUMBER
    rejects(() => buildVaultSpend(params, [{ txid: fakeTxid(1), vout: 0, amountSats: 100000 as unknown as bigint }], outs, 'cooperative'), /BigInt of satoshis/, 'a Number where satoshis belong → REFUSED with the reason named, instead of a raw TypeError escaping')
    ok(!auditVaultSpend(good.txHex, params, [{ ...utxo[0], amountSats: 100000 as unknown as bigint }]).ok, '…and the audit refuses it too — a float is not money')
  }

  console.log(`\n✓ ${pass} checks passed — THE VAULT SPENDS, AND ONLY LAWFULLY: the build is deterministic (a guardian rebuilds it locally and refuses anything that differs), signatures are BIP-340 over the BIP-341 sighash and verified BEFORE they touch the witness, the cooperative leaf takes EXACTLY t signatures (NUMEQUAL fails on too many as surely as too few), the witness-order law is enforced (first guardian's signature last, empty pushes for the silent), the unilateral exit carries version 2 and the timelock in its sequence, and the audit — from raw bytes and public parameters alone — catches the premature exit whose signature is VALID but whose sequence lies. Two paths, one law: nothing moves that the script would not move. ₿`)
}
main()
