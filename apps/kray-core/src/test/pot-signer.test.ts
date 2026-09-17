/**
 * POT SIGNER — the owner key signs only a rebuilt, exit-bound payout.
 *   node src/test/pot-signer.test.ts
 */
import { createHash, randomBytes } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { deriveVault, toXOnly } from '../protocol/vault.ts'
import { buildExitPayout, type FundingUtxo, type ExitPayoutPlan } from '../protocol/exit-payout.ts'
import { authorizePotSign, authorizeGuardianSign, mergeGuardianShares, decideGuardianQuorum, planToWire, planFromWire, fundingFromWire, utxosFromWire, paramsFromWire } from '../protocol/pot-signer.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, runeExitMessage, addressOf } from '../protocol/scheme.ts'

let pass = 0
function ok(c: boolean, m: string) { if (c) { pass++; console.log('  ✓', m) } else { console.error('  ✗', m); process.exit(1) } }

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const keypair = (tag: string) => {
  const sk = createHash('sha256').update(tag).digest()
  return { sk, pk: _generateKeyPair(sk).publicKeyHex }
}

const NET = 'regtest'
const G = [keypair('g1'), keypair('g2'), keypair('g3')]
const DEP = keypair('pot-owner')
const USER = keypair('exiter')
const FUND = keypair('fund')
const params = { guardians: G.map((g) => g.pk), threshold: 2, depositor: DEP.pk, timelock: 144, net: 'regtest' as const }
deriveVault(params)
const destAddr = addressOf(USER.pk, 'regtest')
const destPay = btc.p2tr(Buffer.from(USER.pk, 'hex'), undefined, NETWORKS.regtest)
const fundPay = btc.p2tr(Buffer.from(FUND.pk, 'hex'), undefined, NETWORKS.regtest)
const RUNE = { block: 1n, tx: 1n }
const vaultUtxos = [{ txid: createHash('sha256').update('v').digest('hex'), vout: 0, amountSats: 546n }]
const funding: FundingUtxo = {
  txid: createHash('sha256').update('f').digest('hex'), vout: 1, amountSats: 20_000n,
  scriptHex: hex(fundPay.script!), internalKey: FUND.pk,
}
const plan: ExitPayoutPlan = {
  runeId: RUNE, exitAmount: 100n, totalVaultRunes: 700n,
  destScriptHex: hex(destPay.script!), destPostage: 330n, changePostage: 330n,
  satsChangeScriptHex: hex(fundPay.script!), feeSats: 2_000n, dust: 330n,
}
const payout = buildExitPayout(params, vaultUtxos, funding, plan)
const msg = runeExitMessage(NET, destAddr, '1:1', 100n, destAddr, 0)
const exit = {
  from: destAddr, runeId: '1:1', amount: '100', l1Address: destAddr, nonce: 0,
  publicKey: USER.pk, signature: _signKrayWallet(msg, USER.sk), scheme: 'kraywallet',
}
const req = { network: NET, exit, params, vaultUtxos, funding, plan, claimedSighashes: payout.sighashes.slice(0, payout.vaultInputCount) }

const good = authorizePotSign(req, DEP.sk)
ok(good.ok === true && good.ok && good.depositorSigs.length === 1, 'a genuine sealed-shape payout is signed')

const badSig = authorizePotSign({ ...req, exit: { ...exit, signature: '00'.repeat(64) } }, DEP.sk)
ok(badSig.ok === false && /signature/.test(badSig.reason || ''), 'ATTACK: forged exit signature → refused')

const thief = addressOf(keypair('thief').pk, 'regtest')
const stealDest = authorizePotSign({ ...req, exit: { ...exit, l1Address: thief } }, DEP.sk)
ok(stealDest.ok === false, 'ATTACK: dest swapped after the user signed → refused')

const thiefPay = btc.p2tr(Buffer.from(keypair('thief').pk, 'hex'), undefined, NETWORKS.regtest)
const stealPlan = { ...plan, destScriptHex: hex(thiefPay.script!) }
const stealBuilt = buildExitPayout(params, vaultUtxos, funding, stealPlan)
const stealScript = authorizePotSign({ ...req, plan: stealPlan, claimedSighashes: stealBuilt.sighashes.slice(0, stealBuilt.vaultInputCount) }, DEP.sk)
ok(stealScript.ok === false && /SIGNED exit address/.test(stealScript.reason || ''), 'ATTACK: payout dest script ≠ signed exit address → refused')

const stealAmt = authorizePotSign({ ...req, plan: { ...plan, exitAmount: 700n }, claimedSighashes: buildExitPayout(params, vaultUtxos, funding, { ...plan, exitAmount: 700n }).sighashes.slice(0, 1) }, DEP.sk)
ok(stealAmt.ok === false && /signed lock/.test(stealAmt.reason || ''), 'ATTACK: payout amount ≠ signed lock → refused')

const swappedHash = authorizePotSign({ ...req, claimedSighashes: [randomBytes(32).toString('hex')] }, DEP.sk)
ok(swappedHash.ok === false && /rebuilt/.test(swappedHash.reason || ''), 'ATTACK: sighashes that are not the rebuilt payout → refused')

const wrongKey = authorizePotSign(req, keypair('stranger').sk)
ok(wrongKey.ok === false && /does not hold the pot owner/.test(wrongKey.reason || ''), 'ATTACK: a stranger secret cannot sign this pot')

const wired = authorizePotSign({
  ...req,
  params: paramsFromWire({ ...params, net: 'regtest' }),
  vaultUtxos: utxosFromWire(vaultUtxos.map((u) => ({ ...u, amountSats: u.amountSats.toString() }))),
  funding: fundingFromWire({ ...funding, amountSats: funding.amountSats.toString() }),
  plan: planFromWire(planToWire(plan)),
}, DEP.sk)
ok(wired.ok === true, 'the HTTP wire (stringified bigints) rebuilds the same authorized payout')

const USER2 = keypair('exiter-2')
const dest2Addr = addressOf(USER2.pk, 'regtest')
const dest2Pay = btc.p2tr(Buffer.from(USER2.pk, 'hex'), undefined, NETWORKS.regtest)
const loafPlan = {
  ...plan,
  dests: [
    { destScriptHex: plan.destScriptHex, exitAmount: 100n },
    { destScriptHex: hex(dest2Pay.script!), exitAmount: 200n },
  ],
}
const loafPayout = buildExitPayout(params, vaultUtxos, funding, loafPlan)
const msg2 = runeExitMessage(NET, dest2Addr, '1:1', 200n, dest2Addr, 1)
const exit2 = {
  from: dest2Addr, runeId: '1:1', amount: '200', l1Address: dest2Addr, nonce: 1,
  publicKey: USER2.pk, signature: _signKrayWallet(msg2, USER2.sk), scheme: 'kraywallet',
}
const loafReq = {
  ...req, plan: loafPlan, exits: [exit, exit2],
  claimedSighashes: loafPayout.sighashes.slice(0, loafPayout.vaultInputCount),
}
const loafGood = authorizePotSign(loafReq, DEP.sk)
ok(loafGood.ok === true, 'a two-dest loaf is signed when EACH dest is inside its own rune-exit')
const stealRider = authorizePotSign({
  ...loafReq,
  plan: { ...loafPlan, dests: [loafPlan.dests[0], { destScriptHex: hex(thiefPay.script!), exitAmount: 200n }] },
  claimedSighashes: buildExitPayout(params, vaultUtxos, funding, {
    ...loafPlan, dests: [loafPlan.dests[0], { destScriptHex: hex(thiefPay.script!), exitAmount: 200n }],
  }).sighashes.slice(0, 1),
}, DEP.sk)
ok(stealRider.ok === false, 'ATTACK: loaf dest 1 redirected after the rider signed → refused')
const noExits = authorizePotSign({ ...loafReq, exits: undefined }, DEP.sk)
ok(noExits.ok === false && /loaf needs one SIGNED exit/.test(noExits.reason || ''), 'ATTACK: a loaf without the rider signatures → refused')

// ── GUARDIAN CO-SIGN — the balance-replaying co-signer (additive; the owner path above is untouched) ──
const bookOf = (m: Record<string, bigint>) => (from: string, rid: string): bigint | null =>
  (rid === '1:1' && Object.prototype.hasOwnProperty.call(m, from) ? m[from] : null)
const G0 = G[0]

const gGood = authorizeGuardianSign(req, G0.sk, bookOf({ [destAddr]: 100n }))
ok(gGood.ok === true && gGood.ok && gGood.guardianSigs.length === 1 && gGood.guardianKey === toXOnly(G0.pk),
  'guardian signs when its OWN book confirms balance >= the signed exit')

const gExact = authorizeGuardianSign(req, G0.sk, bookOf({ [destAddr]: 100n }))
ok(gExact.ok === true, 'guardian signs at EXACT balance (100 book vs 100 exit — boundary passes)')

const gOver = authorizeGuardianSign(req, G0.sk, bookOf({ [destAddr]: 50n }))
ok(gOver.ok === false && /over-balance/.test(gOver.reason || ''),
  'ATTACK: a validly-signed OVER-BALANCE exit (writer forges 100 vs book 50) → guardian REFUSES (the drain closed)')

const gUnknown = authorizeGuardianSign(req, G0.sk, () => null)
ok(gUnknown.ok === false && /fail-closed/.test(gUnknown.reason || ''),
  'FAIL-CLOSED: an unknown book balance → guardian refuses (never a pass)')

const gWrongKey = authorizeGuardianSign(req, DEP.sk, bookOf({ [destAddr]: 100n }))
ok(gWrongKey.ok === false && /guardian key/.test(gWrongKey.reason || ''),
  'ATTACK: the OWNER key is not a guardian → refused (the guardian leg is a SEPARATE trust domain)')

const gForged = authorizeGuardianSign({ ...req, exit: { ...exit, signature: '00'.repeat(64) } }, G0.sk, bookOf({ [destAddr]: 100n }))
ok(gForged.ok === false && /signature/.test(gForged.reason || ''),
  'ATTACK: forged exit signature → guardian refuses (the owner core is inherited)')

const gLoafGood = authorizeGuardianSign(loafReq, G0.sk, bookOf({ [destAddr]: 100n, [dest2Addr]: 200n }))
ok(gLoafGood.ok === true, 'guardian signs a two-dest loaf when EACH exiter is book-covered')

const gLoafOver = authorizeGuardianSign(loafReq, G0.sk, bookOf({ [destAddr]: 100n, [dest2Addr]: 199n }))
ok(gLoafOver.ok === false && /over-balance/.test(gLoafOver.reason || ''),
  'ATTACK: loaf where one exiter withdraws 200 over a book of 199 → refused (per-exiter conservation)')

const ownerStill = authorizePotSign(req, DEP.sk)
ok(ownerStill.ok === true, 'the OWNER signer is UNTOUCHED — still signs the same rebuilt payout (the change is purely additive)')

// ── mergeGuardianShares — the remote (book-checked) share is PREFERRED, then lab fills to threshold ──
const g1x = toXOnly(G[0].pk)
const AA = 'aa'.repeat(32)
const merged = mergeGuardianShares(payout, [{ guardianKey: g1x, guardianSigs: [AA] }], () => 'bb'.repeat(32))
ok(merged.length === 1 && merged[0].size === 2, 'mergeGuardianShares fills each input to threshold (one remote + one lab)')
ok(merged[0].get(G[0].pk) === AA, "the REMOTE book-checked share is used for its guardian — lab never overwrites it (so the remote's balanceOf gate actually gates)")

const emptyMerge = mergeGuardianShares(payout, [], () => null)
ok(emptyMerge[0].size === 0, 'no remote and no lab share → an empty map → finalizeExitPayout fails (fail-closed)')

let labCalled = false
const fullRemote = mergeGuardianShares(payout,
  [{ guardianKey: toXOnly(G[0].pk), guardianSigs: ['a1'.repeat(32)] }, { guardianKey: toXOnly(G[1].pk), guardianSigs: ['a2'.repeat(32)] }],
  () => { labCalled = true; return 'cc'.repeat(32) })
ok(fullRemote[0].size === 2 && labCalled === false, 'when remote shares meet the threshold, lab keys are NEVER consulted (the writer cannot substitute its own rubber-stamp)')

// ── decideGuardianQuorum — the fault-tolerance policy: tolerate a guardian DOWN, HOLD on a book NO ──
const share = (g) => ({ ok: true, share: { guardianKey: toXOnly(g.pk), guardianSigs: [AA] } })
const down = { ok: false, refused: false, reason: 'unreachable' }
const bookNo = { ok: false, refused: true, reason: 'over-balance' }

const q3 = decideGuardianQuorum([share(G[0]), share(G[1]), share(G[2])], 2)
ok(q3.ok === true && q3.shares.length === 2, 'quorum: 3 guardians up, threshold 2 → exactly 2 distinct shares')

const qDown = decideGuardianQuorum([share(G[0]), down, share(G[2])], 2)
ok(qDown.ok === true && qDown.shares.length === 2, 'FALLBACK: one guardian DOWN, the other two cover → withdraw proceeds (2-of-3, bridge keeps working)')

const qTooFew = decideGuardianQuorum([share(G[0]), down, down], 2)
ok(qTooFew.ok === false && /withdraw held/.test(qTooFew.reason || ''), 'too few reachable (1 < 2) → held; never frozen (the CSV escape never depends on guardians)')

const qNo = decideGuardianQuorum([bookNo, share(G[1]), share(G[2])], 2)
ok(qNo.ok === false && /held for safety/.test(qNo.reason || ''), 'SAFETY: a guardian book says NO → held, never routed around (even though two others would sign)')

const qDupe = decideGuardianQuorum([share(G[0]), share(G[0]), share(G[2])], 2)
ok(qDupe.ok === true && qDupe.shares.length === 2, 'one daemon, one guardian: a repeated key is not double-counted toward the threshold')

// ── THE SERVICE OUTPUT CROSSES THE WIRE — the 2026-09-17 Tier-1 finding, pinned ──────────────────
// The withdraw door states a flat 546-sat platform output on the plan (2026-09-01). Until this pin the
// wire dropped it: the node claimed sighashes over 5 outputs, every remote pen/guardian rebuilt 4, and
// every withdraw was held (fail-closed — nothing lost, nothing paid). Never again.
const platPay = btc.p2tr(Buffer.from(keypair('platform').pk, 'hex'), undefined, NETWORKS.regtest)
const feePlan: ExitPayoutPlan = { ...plan, serviceFee: { scriptHex: hex(platPay.script!), sats: 546n } }
const feePayout = buildExitPayout(params, vaultUtxos, funding, feePlan)
ok(feePayout.outputs.length === 5 && payout.outputs.length === 4, 'fixture: the stated service output makes a 5-output payout (historic plan stays 4)')
const feeWire = planToWire(feePlan)
ok(typeof feeWire.serviceFee === 'object' && (feeWire.serviceFee as { sats: string }).sats === '546', 'planToWire ships the service output with stringified sats')
const feeReq = { ...req, plan: planFromWire(feeWire), claimedSighashes: feePayout.sighashes.slice(0, feePayout.vaultInputCount) }
const penFee = authorizePotSign(feeReq, DEP.sk)
ok(penFee.ok === true, 'REGRESSION: the pen rebuilds the node\'s 5-output payout from the wire and signs')
const gFee = authorizeGuardianSign(feeReq, G0.sk, bookOf({ [destAddr]: 100n }))
ok(gFee.ok === true, 'REGRESSION: a guardian rebuilds the node\'s 5-output payout from the wire and co-signs')
const { serviceFee: _dropped, ...hidden } = feeWire
const penHidden = authorizePotSign({ ...feeReq, plan: planFromWire(hidden) }, DEP.sk)
ok(penHidden.ok === false && /rebuilt/.test(penHidden.reason || ''), 'a wire that hides the service output cannot borrow the node\'s sighashes → refused (the old hold, now a deliberate one)')
const drainPlan: ExitPayoutPlan = { ...plan, serviceFee: { scriptHex: hex(platPay.script!), sats: 1_001n } }
const drainBuilt = buildExitPayout(params, vaultUtxos, funding, drainPlan)
const drainReq = { ...req, plan: planFromWire(planToWire(drainPlan)), claimedSighashes: drainBuilt.sighashes.slice(0, drainBuilt.vaultInputCount) }
const penDrain = authorizePotSign(drainReq, DEP.sk)
ok(penDrain.ok === false && /signer ceiling/.test(penDrain.reason || ''), 'ATTACK: a "service fee" above the signer ceiling (1 001 > 1 000) → the pen refuses')
const gDrain = authorizeGuardianSign(drainReq, G0.sk, bookOf({ [destAddr]: 100n }))
ok(gDrain.ok === false && /signer ceiling/.test(gDrain.reason || ''), 'ATTACK: the same drain → a guardian refuses (independent execution of the same ceiling)')
const ceilPlan: ExitPayoutPlan = { ...plan, serviceFee: { scriptHex: hex(platPay.script!), sats: 1_000n } }
const ceilBuilt = buildExitPayout(params, vaultUtxos, funding, ceilPlan)
ok(authorizePotSign({ ...req, plan: planFromWire(planToWire(ceilPlan)), claimedSighashes: ceilBuilt.sighashes.slice(0, ceilBuilt.vaultInputCount) }, DEP.sk).ok === true, 'boundary: exactly the ceiling (1 000) still signs')
let malformed = ''
try { planFromWire({ ...feeWire, serviceFee: { sats: '546' } }) } catch (e) { malformed = e instanceof Error ? e.message : String(e) }
ok(/serviceFee must be/.test(malformed), 'a malformed service output on the wire throws (the daemon answers 400 — fail-closed, never a silent drop)')
let notANumber = ''
try { planFromWire({ ...feeWire, serviceFee: { scriptHex: hex(platPay.script!), sats: 'five' } }) } catch (e) { notANumber = e instanceof Error ? e.message : String(e) }
ok(notANumber.length > 0, 'a non-numeric service sats on the wire throws (never coerced)')

console.log(`\n╚═ ${pass} passed — the owner signs only the exit-bound payout, the guardian re-checks the book, remote shares beat lab, and the quorum tolerates a guardian down but holds on a book NO. ₿₭`)
