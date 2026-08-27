/**
 * THE POT PRE-SIGNED SPLIT, ASSEMBLED — a book snapshot becomes a real COOPERATIVE spend, proven safe.
 *
 * Composes the proven pieces: resolve each holder's L1 script (their own taproot address, self-custody) →
 * potSettlementOutputs → buildVaultSpend('cooperative'). Proves the assembled tx is the no-timelock
 * cooperative leaf (so it wins the RBF race against the owner's unilateral sweep) and that its rune
 * allocation passes auditSettlementSafety — each holder gets EXACTLY their book, conserved, nothing burned.
 *
 *   node src/test/pot-settlement.test.ts
 */
import { createHash } from 'node:crypto'
import { deriveVault } from '../protocol/vault.ts'
import { buildPotSettlement } from '../protocol/pot-settlement.ts'
import { auditSettlementSafety } from '../protocol/vault-settlement.ts'
import { addressOf, _generateKeyPair } from '../protocol/scheme.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const threw = (fn: () => unknown, why: RegExp, m: string) => { let t = false; try { fn() } catch (e) { t = why.test(String((e as Error).message)) } ok(t, m) }
const kp = (t: string) => { const sk = createHash('sha256').update(t).digest(); return { sk, pk: _generateKeyPair(sk).publicKeyHex } }

const NET = 'regtest' as const
const RID = { block: 121n, tx: 1n }
const G = [kp('pot-g1'), kp('pot-g2'), kp('pot-g3')]
const OWNER = kp('the-pot-owner')
const potParams = { guardians: G.map((g) => g.pk), threshold: 2, depositor: OWNER.pk, timelock: 144, net: NET }
const pot = deriveVault(potParams)
const potUtxo = { txid: createHash('sha256').update('pot').digest('hex'), vout: 0, amountSats: 10_000n }
const holderAddr = (t: string) => addressOf(kp(t).pk, NET)

console.log('\n╔═ THE POT PRE-SIGNED SPLIT — a book snapshot assembles into a cooperative spend, proven ═╗')

// three pot-backed holders, fully backed: 400 + 300 + 300 == 1000
const r = buildPotSettlement({
  runeId: RID, potParams, potUtxos: [potUtxo], potTotalRunes: 1000n,
  holders: [
    { address: holderAddr('h0'), bookRunes: 400n },
    { address: holderAddr('h1'), bookRunes: 300n },
    { address: holderAddr('h2'), bookRunes: 300n },
  ],
  remainderAddress: pot.address,
})

ok(r.path === 'cooperative', 'the pot split is the COOPERATIVE leaf — no timelock, RBF-able, so it beats the owner\'s timelocked unilateral sweep (the sweep auto-fails)')
ok(r.sighashes.length === 1, 'one pot input → one sighash for the owner + a threshold of guardians to co-sign')
ok(typeof r.unsignedTxHex === 'string' && r.unsignedTxHex.length > 0, 'it assembles a real unsigned Bitcoin transaction')
ok(r.outputScriptsHex.length === 5, 'the outputs are [3 holders, runestone, remainder] — one paid output per holder')

const audit = auditSettlementSafety({
  runeId: RID, outputScriptsHex: r.outputScriptsHex, inputRunes: 1000n,
  depositorOutput: 0, consolidationOutput: r.consolidationOutput, maxDepositorRunes: 0n, dests: r.dests,
})
ok(audit.ok === true,
  'the assembled cooperative spend is proven SAFE by ord\'s own decoder — each holder gets EXACTLY their book, conservation holds, nothing burns')

// the pot COMMINGLES: two pot outpoints are both consumed — one sighash per input for the owner + guardians
const potUtxo2 = { txid: createHash('sha256').update('pot2').digest('hex'), vout: 1, amountSats: 6_000n }
const rm = buildPotSettlement({
  runeId: RID, potParams, potUtxos: [potUtxo, potUtxo2], potTotalRunes: 1000n,
  holders: [
    { address: holderAddr('h0'), bookRunes: 400n },
    { address: holderAddr('h1'), bookRunes: 300n },
    { address: holderAddr('h2'), bookRunes: 300n },
  ],
  remainderAddress: pot.address,
})
ok(rm.sighashes.length === 2, 'the pot COMMINGLES — a split over two pot outpoints consumes BOTH (one sighash per input to co-sign)')
const auditM = auditSettlementSafety({ runeId: RID, outputScriptsHex: rm.outputScriptsHex, inputRunes: 1000n, depositorOutput: 0, consolidationOutput: rm.consolidationOutput, maxDepositorRunes: 0n, dests: rm.dests })
ok(auditM.ok === true, 'the two-input pot split is still proven SAFE — each holder gets their book, conservation holds across both inputs')

// a partly-backed pot (700 of 1000 backed) — the 300 unbacked remainder parks back in the pot
const rp = buildPotSettlement({
  runeId: RID, potParams, potUtxos: [potUtxo], potTotalRunes: 1000n,
  holders: [{ address: holderAddr('h0'), bookRunes: 400n }, { address: holderAddr('h1'), bookRunes: 300n }],
  remainderAddress: pot.address,
})
const auditP = auditSettlementSafety({ runeId: RID, outputScriptsHex: rp.outputScriptsHex, inputRunes: 1000n, depositorOutput: 0, consolidationOutput: rp.consolidationOutput, maxDepositorRunes: 0n, dests: rp.dests })
ok(auditP.ok === true && auditP.consolidationGot === 300n, 'a partly-backed pot pays holders their book and parks the 300 unbacked remainder back in the pot — conservation holds')

// guard: holders' books can never exceed the pot (the pool never out-credits itself)
threw(() => buildPotSettlement({
  runeId: RID, potParams, potUtxos: [potUtxo], potTotalRunes: 500n,
  holders: [{ address: holderAddr('h0'), bookRunes: 400n }, { address: holderAddr('h1'), bookRunes: 200n }],
  remainderAddress: pot.address,
}), /exceed the pot/, 'a book (600) exceeding the pot (500) is refused at assembly — the pool never out-credits itself')

console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the book assembles into a safe, no-timelock cooperative spend that beats the sweep. ⚖₭\n`)
process.exit(fail ? 1 : 0)
