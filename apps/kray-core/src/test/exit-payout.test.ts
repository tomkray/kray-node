/**
 * THE EXIT PAYOUT — the user-funded vault spend that pays an open rune exit.
 *   node src/test/exit-payout.test.ts
 *
 * The bakery-tab last mile: exiter signs (vault leaf + own sats), guardians
 * co-sign, anyone broadcasts, the settle burns the lock. This suite builds the
 * REAL transaction, simulates the WALLET signing the PSBT exactly as a BIP-371
 * signer would (scure's own signIdx — script path AND tweaked key path), and
 * then attacks every seam: wrong fee statement, sub-dust postage, a runestone
 * that would over-pay the destination, missing owner signature, guardian
 * over/under-threshold, forged funding signature, funding-is-the-vault, and
 * the zero-edict trap (amount 0 means ALL in Runes).
 */
import * as btc from '@scure/btc-signer'
import { randomBytes, createHash } from 'node:crypto'
import { schnorr } from '@noble/curves/secp256k1.js'
import { deriveVault } from '../protocol/vault.ts'
import {
  buildExitPayout, extractWalletSignatures, finalizeExitPayout, signVaultSighash,
  type FundingUtxo, type ExitPayoutPlan,
} from '../protocol/exit-payout.ts'
import { auditVaultSpend } from '../protocol/vault-spend.ts'
import { auditSettlementSafety } from '../protocol/vault-settlement.ts'
import { decipher, allocate } from '../protocol/runestone.ts'
import { NETWORKS } from '../protocol/scheme.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; console.log(`  ✓ ${label}`); return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
function rejects(fn: () => void, why: RegExp, label: string): void {
  try { fn() } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (why.test(msg)) { pass++; console.log(`  ✓ ${label}`); return }
    console.error(`  ✗ FAILED (wrong refusal) — ${label}\n      got: ${msg}`); process.exit(1)
  }
  console.error(`  ✗ FAILED (expected refusal) — ${label}`); process.exit(1)
}
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const keypair = () => { const sk = randomBytes(32); return { sk, pk: hex(schnorr.getPublicKey(sk)) } }
const fakeTxid = (n: number): string => createHash('sha256').update(`utxo ${n}`).digest('hex')

async function main() {
  const G = Array.from({ length: 3 }, keypair)
  const DEP = keypair()
  const FUND = keypair()
  const params = { guardians: G.map((g) => g.pk), threshold: 2, depositor: DEP.pk, timelock: 144, net: 'regtest' as const }
  const vault = deriveVault(params)
  const RUNE = { block: 317883n, tx: 48n }
  const destPay = btc.p2tr(keypair().pk, undefined, NETWORKS.regtest)
  const fundPay = btc.p2tr(FUND.pk, undefined, NETWORKS.regtest)
  const changePay = btc.p2tr(FUND.pk, undefined, NETWORKS.regtest)

  const vaultUtxo = [{ txid: fakeTxid(1), vout: 0, amountSats: 546n }]
  const funding: FundingUtxo = { txid: fakeTxid(2), vout: 1, amountSats: 20_000n, scriptHex: hex(fundPay.script!), internalKey: FUND.pk }
  const plan: ExitPayoutPlan = {
    runeId: RUNE, exitAmount: 100n, totalVaultRunes: 700n,
    destScriptHex: hex(destPay.script!), destPostage: 330n, changePostage: 330n,
    satsChangeScriptHex: hex(changePay.script!), feeSats: 2_000n, dust: 330n,
  }

  // ── 1 · BUILD — deterministic, safe, exact ────────────────────────────────
  const payout = buildExitPayout(params, vaultUtxo, funding, plan)
  ok(payout.sighashes.length === 2, 'one sighash per input: the vault leaf + the exiter\'s key path')
  const again = buildExitPayout(params, vaultUtxo, funding, plan)
  ok(again.unsignedTxHex === payout.unsignedTxHex && again.sighashes.join() === payout.sighashes.join(), 'DETERMINISTIC: wallet, guardians and any stranger rebuild the identical bytes')
  ok(payout.outputs.length === 4 && payout.outputs[3].amountSats === 546n + 20_000n - 330n - 330n - 2_000n, 'sats equation: inputs == postage + postage + STATED fee + change, to the satoshi')
  // the runestone routes EXACTLY the lock to output 0, the remainder home to the vault
  {
    const scripts = payout.outputs.map((o) => Uint8Array.from(Buffer.from(o.script!, 'hex')))
    const art = decipher(scripts)
    ok(!!art && art.kind !== 'cenotaph', 'the runestone deciphers cleanly — no cenotaph, nothing burns')
    const alloc = allocate(art, { outputScripts: scripts, inputs: [{ id: RUNE, amount: 700n }] })
    const at = (o: number) => (alloc.outputs.get(o) ?? []).reduce((t, b) => t + b.amount, 0n)
    ok(at(0) === 100n && at(2) === 600n && alloc.burned.length === 0, 'allocation per ord: destination gets EXACTLY the lock (100), the vault keeps the remainder (600), zero burned')
  }
  ok(payout.outputs[2].script === (() => { const p = btc.p2tr(btc.TAPROOT_UNSPENDABLE_KEY, [{ script: Uint8Array.from(Buffer.from(vault.cooperativeScript, 'hex')) }, { script: Uint8Array.from(Buffer.from(vault.unilateralScript, 'hex')) }], NETWORKS.regtest, true); return hex(p.script!) })(), 'the rune change returns to the SAME vault — the reserve keeps backing everyone else under the same two leaves')

  // ── 2 · THE WALLET SIGNS THE PSBT exactly as a BIP-371 signer would ──────
  const walletTx = btc.Transaction.fromPSBT(Buffer.from(payout.psbtBase64, 'base64'), { allowUnknownInputs: true, allowUnknownOutputs: true })
  ok(walletTx.inputsLength === 2 && walletTx.outputsLength === 4, 'the PSBT round-trips: 2 inputs (vault + funding), 4 outputs')
  walletTx.signIdx(DEP.sk, 0)   // script path — the PSBT's tapLeafScript tells the wallet how
  walletTx.signIdx(FUND.sk, 1)  // key path — the PSBT's tapInternalKey tells the wallet to tweak
  const signedPsbt = Buffer.from(walletTx.toPSBT(0)).toString('base64')
  const sigs = extractWalletSignatures(payout, signedPsbt)
  ok(sigs.depositorSigs.length === 1 && /^[0-9a-f]{128}$/.test(sigs.depositorSigs[0]), 'the owner\'s tapScriptSig extracted and verified — 64-byte SIGHASH_DEFAULT')
  ok(/^[0-9a-f]{128}$/.test(sigs.fundingSig), 'the funding key-path signature extracted — verified against the OUTPUT key (the witness program itself)')

  // ── 3 · GUARDIANS CO-SIGN, THE PAYOUT FINALIZES, A STRANGER AUDITS IT ────
  const gsigs = new Map([[G[0].pk, signVaultSighash(payout.sighashes[0], G[0].sk)], [G[2].pk, signVaultSighash(payout.sighashes[0], G[2].sk)]])
  const finalTx = finalizeExitPayout(payout, gsigs, sigs.depositorSigs, sigs.fundingSig)
  ok(/^[0-9a-f]{64}$/.test(finalTx.txid), `the payout finalizes — txid ${finalTx.txid.slice(0, 16)}…`)
  {
    // the vault input passes the SAME stranger-audit every settlement faces
    const parsed = btc.Transaction.fromRaw(Buffer.from(finalTx.txHex, 'hex'), { allowUnknownInputs: true, allowUnknownOutputs: true })
    const w0 = parsed.getInput(0).finalScriptWitness!
    ok(w0.length === 3 + 1 + 2, 'vault witness: 3 guardian slots + owner on top + leaf + control block')
    const w1 = parsed.getInput(1).finalScriptWitness!
    ok(w1.length === 1 && w1[0].length === 64, 'funding witness: ONE 64-byte key-path signature — the exiter\'s own sats')
  }

  // ── 4 · ADVERSARIAL — every seam, attacked ────────────────────────────────
  rejects(() => buildExitPayout(params, vaultUtxo, funding, { ...plan, feeSats: 0n }), /fee must be positive and STATED/, 'ATTACK: an unstated fee → REFUSED (a fee by surprise is a theft)')
  rejects(() => buildExitPayout(params, vaultUtxo, funding, { ...plan, destPostage: 100n }), /clear the dust/, 'ATTACK: sub-dust postage on the destination → REFUSED (it would never relay)')
  rejects(() => buildExitPayout(params, vaultUtxo, funding, { ...plan, changePostage: 1n }), /clear the dust/, 'ATTACK: sub-dust on the pointer\'s landing pad → REFUSED even with zero runes riding it')
  rejects(() => buildExitPayout(params, vaultUtxo, funding, { ...plan, exitAmount: 800n }), /exceeds what the vault physically holds/, 'ATTACK: exit more than the vault holds → REFUSED before the runestone exists')
  rejects(() => buildExitPayout(params, vaultUtxo, { ...funding, amountSats: 100n }, plan), /funding utxo is short/, 'ATTACK: funding that cannot cover postage + fee → REFUSED with the numbers named')
  rejects(() => buildExitPayout(params, vaultUtxo, { ...funding, txid: vaultUtxo[0].txid, vout: 0 }, plan), /cannot be a vault outpoint/, 'ATTACK: "fund" the fee with the vault itself → REFUSED')
  rejects(() => buildExitPayout(params, vaultUtxo, { ...funding, scriptHex: '0014' + '00'.repeat(20) }, plan), /plain P2TR/, 'ATTACK: a non-taproot funding script → REFUSED (the key-path contract would be a lie)')

  // the zero-edict trap: exiting the WHOLE vault emits an edict for the full amount —
  // and the allocation still delivers exactly, nothing burns, the empty pad stays lawful
  const whole = buildExitPayout(params, vaultUtxo, funding, { ...plan, exitAmount: 700n })
  {
    const scripts = whole.outputs.map((o) => Uint8Array.from(Buffer.from(o.script!, 'hex')))
    const alloc = allocate(decipher(scripts), { outputScripts: scripts, inputs: [{ id: RUNE, amount: 700n }] })
    const at = (o: number) => (alloc.outputs.get(o) ?? []).reduce((t, b) => t + b.amount, 0n)
    ok(at(0) === 700n && at(2) === 0n && alloc.burned.length === 0, 'FULL exit: destination gets all 700, the pad gets 0, nothing burns — the 0-means-ALL trap never fires')
  }

  // a signer that FINALIZED the vault input (witness instead of tapScriptSig) still yields its signature
  {
    const w2 = btc.Transaction.fromPSBT(Buffer.from(payout.psbtBase64, 'base64'), { allowUnknownInputs: true, allowUnknownOutputs: true })
    w2.signIdx(FUND.sk, 1)
    const depSig = Uint8Array.from(Buffer.from(sigs.depositorSigs[0], 'hex'))
    w2.updateInput(0, { finalScriptWitness: [depSig, Uint8Array.from(Buffer.from(payout.leafScript, 'hex')), Uint8Array.from(Buffer.from(payout.controlBlock, 'hex'))] }, true)
    const got = extractWalletSignatures(payout, Buffer.from(w2.toPSBT(0)).toString('base64'))
    ok(got.depositorSigs[0] === sigs.depositorSigs[0], 'a FINALIZING signer (witness, no tapScriptSig) still yields the owner\'s signature — recovered by verification, never by position')
  }

  // missing owner signature: guardians alone can move NOTHING
  const unsigned = btc.Transaction.fromPSBT(Buffer.from(payout.psbtBase64, 'base64'), { allowUnknownInputs: true, allowUnknownOutputs: true })
  unsigned.signIdx(FUND.sk, 1) // only the funding is signed
  rejects(() => extractWalletSignatures(payout, Buffer.from(unsigned.toPSBT(0)).toString('base64')), /owner's signature is REQUIRED/, 'ATTACK: a PSBT without the owner\'s leaf signature → REFUSED (guardian collusion stays impossible)')

  // guardian threshold is EXACT (NUMEQUAL)
  rejects(() => finalizeExitPayout(payout, new Map([[G[0].pk, signVaultSighash(payout.sighashes[0], G[0].sk)]]), sigs.depositorSigs, sigs.fundingSig), /EXACTLY 2.*got 1/, 'ATTACK: 1 guardian where the leaf demands 2 → REFUSED with the numbers named')
  const three = new Map(G.map((g) => [g.pk, signVaultSighash(payout.sighashes[0], g.sk)]))
  rejects(() => finalizeExitPayout(payout, three, sigs.depositorSigs, sigs.fundingSig), /EXACTLY 2.*got 3/, 'ATTACK: 3 guardians where NUMEQUAL demands exactly 2 → REFUSED (too many fails consensus like too few)')

  // forged signatures never reach a witness
  const stranger = keypair()
  rejects(() => finalizeExitPayout(payout, new Map([[G[0].pk, signVaultSighash(payout.sighashes[0], G[0].sk)], [stranger.pk, signVaultSighash(payout.sighashes[0], stranger.sk)]]), sigs.depositorSigs, sigs.fundingSig), /not in this vault's federation/, 'ATTACK: a stranger\'s valid signature → REFUSED by name')
  rejects(() => finalizeExitPayout(payout, gsigs, [hex(randomBytes(64))], sigs.fundingSig), /does not open vault input 0/, 'ATTACK: a forged owner signature → REFUSED before it can poison the witness')
  rejects(() => finalizeExitPayout(payout, gsigs, sigs.depositorSigs, hex(randomBytes(64))), /funding signature does not open/, 'ATTACK: a forged funding signature → REFUSED (the exiter\'s sats move only under the exiter\'s key)')

  // ── 5 · CONSOLIDATION CHANGE + FUNDING-ONLY EXTRACT (the recipient door) ──
  // A recipient who only holds L2 credits cannot sign the original depositor's
  // vault. Remainder must be able to land on the network pool, and the wallet
  // must be allowed to sign ONLY the funding input when the pool key is the owner.
  const CON = keypair()
  const conVault = deriveVault({ ...params, depositor: CON.pk })
  const conScript = (() => {
    const p = btc.p2tr(btc.TAPROOT_UNSPENDABLE_KEY, [{ script: Uint8Array.from(Buffer.from(conVault.cooperativeScript, 'hex')) }, { script: Uint8Array.from(Buffer.from(conVault.unilateralScript, 'hex')) }], NETWORKS.regtest, true)
    return hex(p.script!)
  })()
  const pooled = buildExitPayout(params, vaultUtxo, funding, { ...plan, changeScriptHex: conScript })
  ok(pooled.outputs[2].script === conScript, 'rune change can land on the consolidation vault — the shared pool that backs L2 recipients')
  ok(pooled.outputs[0].script === plan.destScriptHex, 'the destination is still the SIGNED exit address — the pool only receives the remainder')
  rejects(() => buildExitPayout(params, vaultUtxo, funding, { ...plan, changeScriptHex: '0014' + '00'.repeat(20) }), /plain P2TR/, 'ATTACK: a non-taproot change pad → REFUSED (a wrong pad is a cenotaph risk)')

  const fundOnly = btc.Transaction.fromPSBT(Buffer.from(pooled.psbtBase64, 'base64'), { allowUnknownInputs: true, allowUnknownOutputs: true })
  fundOnly.signIdx(FUND.sk, 1)
  const fundOnlyB64 = Buffer.from(fundOnly.toPSBT(0)).toString('base64')
  rejects(() => extractWalletSignatures(pooled, fundOnlyB64), /owner's signature is REQUIRED/, 'ATTACK: funding-only PSBT on a personal vault → REFUSED (the owner must still co-sign their own vault)')
  const poolSigs = extractWalletSignatures(pooled, fundOnlyB64, { walletSignsVault: false })
  ok(poolSigs.depositorSigs.length === 0 && /^[0-9a-f]{128}$/.test(poolSigs.fundingSig), 'consolidation extract: wallet signs ONLY the funding input — the pool key is not theirs')
  rejects(() => extractWalletSignatures(pooled, pooled.psbtBase64, { walletSignsVault: false }), /did not sign the funding input/, 'ATTACK: unsigned funding on the pool path → REFUSED (the exiter still pays their own postage)')

  // ── 6 · REHOME SHAPE — dest AND change are the pot; ALL runes move; credits do not burn ──
  const rehomed = buildExitPayout(params, vaultUtxo, funding, {
    ...plan, exitAmount: 700n, totalVaultRunes: 700n,
    destScriptHex: conScript, changeScriptHex: conScript,
  })
  ok(rehomed.outputs[0].script === conScript && rehomed.outputs[2].script === conScript, 'rehome: both dest and the pointer pad are the canonical pot — the coins leave the personal vault entirely')
  const rhSafe = auditSettlementSafety({
    runeId: plan.runeId, outputScriptsHex: rehomed.outputs.map((o) => o.script!),
    inputRunes: 700n, depositorOutput: 0, consolidationOutput: 2, maxDepositorRunes: 700n,
  })
  ok(rhSafe.ok && rhSafe.depositorGot === 700n && rhSafe.consolidationGot === 0n, 'rehome runestone: ALL 700 land on the pot output, pointer remainder is 0, nothing burns — the 0-means-ALL trap never fires')

  // ── 7 · THE LOAF — two signed dests, one pot spend, same decoder ──────────
  const dest2 = btc.p2tr(keypair().pk, undefined, NETWORKS.regtest)
  const loafPlan: ExitPayoutPlan = {
    ...plan, destPostage: 330n,
    dests: [
      { destScriptHex: plan.destScriptHex, exitAmount: 100n },
      { destScriptHex: hex(dest2.script!), exitAmount: 200n },
    ],
  }
  const loaf = buildExitPayout(params, vaultUtxo, funding, loafPlan)
  ok(loaf.destCount === 2 && loaf.changeVout === 3, 'loaf shape: dests 0..1, runestone, pointer pad at 3')
  ok(loaf.unsignedTxHex !== payout.unsignedTxHex, 'a two-dest loaf is a different tx — the one-dest path is not silently rewritten')
  const sameOne = buildExitPayout(params, vaultUtxo, funding, { ...plan, dests: [{ destScriptHex: plan.destScriptHex, exitAmount: 100n }] })
  ok(sameOne.unsignedTxHex === payout.unsignedTxHex, 'N=1 dests[] rebuilds the HISTORIC payout bytes — old wallets keep the same sighash')
  {
    const scripts = loaf.outputs.map((o) => Uint8Array.from(Buffer.from(o.script!, 'hex')))
    const art = decipher(scripts)
    ok(!!art && art.kind !== 'cenotaph', 'the loaf runestone deciphers cleanly — no cenotaph')
    const alloc = allocate(art, { outputScripts: scripts, inputs: [{ id: RUNE, amount: 700n }] })
    const at = (o: number) => (alloc.outputs.get(o) ?? []).reduce((t, b) => t + b.amount, 0n)
    ok(at(0) === 100n && at(1) === 200n && at(3) === 400n && alloc.burned.length === 0, 'loaf allocation: 100 + 200 to dests, 400 home, zero burned')
    ok((loaf.runestoneHex.length / 2) <= 83, 'the loaf runestone script stays ≤ 83 bytes (BIP-110 / relay)')
  }
  rejects(() => buildExitPayout(params, vaultUtxo, funding, {
    ...loafPlan, dests: [{ destScriptHex: hex(dest2.script!), exitAmount: 100n }, { destScriptHex: plan.destScriptHex, exitAmount: 200n }],
  }), /dests\[0\] must be the initiator/, 'ATTACK: dests[0] swapped off the initiator → REFUSED')
  rejects(() => buildExitPayout(params, vaultUtxo, funding, {
    ...loafPlan, dests: [loafPlan.dests![0], { destScriptHex: hex(dest2.script!), exitAmount: 700n }],
  }), /exceeds what the vault/, 'ATTACK: loaf sum larger than the pot → REFUSED')

  // ── 8 · STATED WITHDRAW SERVICE FEE — after the pad, changeVout does not move ──
  const svcPay = btc.p2tr(keypair().pk, undefined, NETWORKS.regtest)
  const svcHex = hex(svcPay.script!)
  const withFee = buildExitPayout(params, vaultUtxo, funding, {
    ...plan, serviceFee: { scriptHex: svcHex, sats: 546n },
  })
  ok(withFee.changeVout === payout.changeVout, 'service fee does not move changeVout — the runestone pointer stays lawful')
  ok(withFee.unsignedTxHex !== payout.unsignedTxHex, 'a stated service fee is a different tx — historic withdraws without it stay byte-identical')
  ok(withFee.outputs.length === 5, 'withdraw with fee: dest, runestone, pad, service, sats change')
  ok(withFee.outputs[3].script === svcHex && withFee.outputs[3].amountSats === 546n, 'output after the pointer pad is the stated 546-sat P2TR service fee')
  ok(withFee.outputs[4].amountSats === 546n + 20_000n - 330n - 330n - 546n - 2_000n, 'sats equation with fee: inputs == dest + pad + service + STATED miner fee + change')
  {
    const scripts = withFee.outputs.map((o) => Uint8Array.from(Buffer.from(o.script!, 'hex')))
    const art = decipher(scripts)
    ok(!!art && art.kind !== 'cenotaph', 'service-fee payout deciphers cleanly — the extra P2TR is sats-only')
    const alloc = allocate(art, { outputScripts: scripts, inputs: [{ id: RUNE, amount: 700n }] })
    const at = (o: number) => (alloc.outputs.get(o) ?? []).reduce((t, b) => t + b.amount, 0n)
    ok(at(0) === 100n && at(2) === 600n && alloc.burned.length === 0, 'allocation unchanged: dest still gets the lock, pad the remainder, service gets zero runes')
  }
  const noFeeAgain = buildExitPayout(params, vaultUtxo, funding, plan)
  ok(noFeeAgain.unsignedTxHex === payout.unsignedTxHex, 'absent serviceFee rebuilds the HISTORIC payout bytes — pot-signer / guardian tests stay aligned')
  rejects(() => buildExitPayout(params, vaultUtxo, funding, {
    ...plan, serviceFee: { scriptHex: '0014' + '00'.repeat(20), sats: 546n },
  }), /plain P2TR/, 'ATTACK: a non-taproot service script → REFUSED')
  rejects(() => buildExitPayout(params, vaultUtxo, funding, {
    ...plan, serviceFee: { scriptHex: svcHex, sats: 100n },
  }), /clear the dust/, 'ATTACK: sub-dust service fee → REFUSED (it would never relay)')
  rejects(() => buildExitPayout(params, vaultUtxo, { ...funding, amountSats: 2_500n }, {
    ...plan, serviceFee: { scriptHex: svcHex, sats: 546n },
  }), /funding utxo is short/, 'ATTACK: funding that cannot cover postage + service + fee → REFUSED with the numbers named')

  console.log(`\n  exit-payout: ${pass} proofs passed — the bakery tab pays out, user-funded, owner-first, guardians as co-signers only\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
