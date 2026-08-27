/**
 * THE PRE-SIGNED SETTLEMENT, PROVEN — the safety property held by the SAME decoder the bridge uses.
 *
 * The residue attack: a depositor keeps runes they already sent away on the L2. The settlement caps
 * what they can keep at their book balance. This proves it purely — build the settlement's outputs,
 * run them through decipher + allocate (ord's rules), and assert: the depositor gets EXACTLY their
 * book balance, the remainder lands on consolidation, nothing burns, conservation holds. A settlement
 * that tried to overpay the depositor is REFUSED. No node, no funds — just the mathematics.
 *
 *   node src/test/vault-settlement.test.ts
 */
import { settlementOutputs, settlementRunestoneHex, batchSettlementRunestoneHex, batchRunestoneFits, auditSettlementSafety, potSettlementOutputs, RUNESTONE_SCRIPT_MAX } from '../protocol/vault-settlement.ts'
import { scriptOfAddress, NETWORKS, _generateKeyPair, _hexToBytes } from '../protocol/scheme.ts'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'

const NET = 'regtest'
const RID = { block: 2566n, tx: 1n }
// two distinct p2tr scripts (real x-only keys) to stand in for the depositor and the consolidation custody
const addrOf = (t: string) => { const { publicKeyHex } = _generateKeyPair(createHash('sha256').update(t).digest()); return btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[NET]).address }
const depScript = scriptOfAddress(addrOf('depositor'), NET)
const conScript = scriptOfAddress(addrOf('consolidation'), NET)

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const threw = (fn: () => unknown, why: RegExp, m: string) => { let t = false; try { fn() } catch (e) { t = why.test(String((e as Error).message)) } ok(t, m) }

/** Build the settlement outputs for (total in vault, book balance kept) and audit them. */
function settle(total: bigint, book: bigint, maxOverride?: bigint) {
  const { outputs, depositorOutput, consolidationOutput } = settlementOutputs({
    runeId: RID, totalVaultRunes: total, depositorBookRunes: book,
    depositorScriptHex: depScript, consolidationScriptHex: conScript,
    depositorSats: 330n, consolidationSats: 330n, dust: 330n,
  })
  const outputScriptsHex = outputs.map((o) => o.script!)  // all three are raw scripts here
  return auditSettlementSafety({
    runeId: RID, outputScriptsHex, inputRunes: total,
    depositorOutput, consolidationOutput, maxDepositorRunes: maxOverride ?? book,
  })
}

function main() {
  console.log('\n╔═ THE PRE-SIGNED SETTLEMENT — the depositor keeps only their book balance, proven ═╗')

  // ── 1 · the honest split: deposit 1000, sent 600 away, keep 400 ────────────
  const v = settle(1000n, 400n)
  ok(v.ok === true, 'a settlement that keeps the depositor at their 400 book balance is SAFE (decipher + allocate agree)')
  ok(v.depositorGot === 400n, 'the depositor output receives EXACTLY 400 — their current book balance, not their 1000 deposit')
  ok(v.consolidationGot === 600n, 'the remaining 600 lands on consolidation — backing everyone the depositor paid on the L2')
  ok(v.burned === 0n, 'nothing is burned — the runestone is clean (no cenotaph), proven by ord\'s own decoder')

  // ── 2 · conservation across the whole range ────────────────────────────────
  for (const [total, book] of [[1000n, 0n], [1000n, 1000n], [500n, 1n], [777n, 776n], [2n, 1n]] as const) {
    const r = settle(total, book)
    ok(r.ok && r.depositorGot === book && r.consolidationGot === total - book && r.burned === 0n,
      `deposit ${total}, keep ${book} → depositor ${r.depositorGot}, consolidation ${r.consolidationGot}, conserved`)
  }

  // ── 3 · THE ATTACK — a settlement that tries to pay the depositor MORE than their book is refused ─
  // hand-forge a runestone that moves 1000 to the depositor while the book cap is only 400
  const greedy = settlementRunestoneHex(RID, 1000n, 0, 2)
  const attack = auditSettlementSafety({
    runeId: RID, outputScriptsHex: [depScript, greedy, conScript], inputRunes: 1000n,
    depositorOutput: 0, consolidationOutput: 2, maxDepositorRunes: 400n,
  })
  ok(attack.ok === false && /residue attack/.test(attack.reason || ''),
    'a settlement paying the depositor 1000 when their book is 400 is REFUSED — the residue attack cannot pass the audit')
  ok(attack.depositorGot === 1000n, 'the audit SEES the overpayment (1000) — it refuses on the number, not on trust')

  // ── 4 · a settlement that BURNS (edict past the outputs / cenotaph) is refused ─
  // an edict pointing one-past-the-last-output with a non-spread amount is a cenotaph → burns
  const burnStone = settlementRunestoneHex(RID, 400n, 9, 2) // output 9 does not exist → edict-output flaw
  const burnAudit = auditSettlementSafety({
    runeId: RID, outputScriptsHex: [depScript, burnStone, conScript], inputRunes: 1000n,
    depositorOutput: 0, consolidationOutput: 2, maxDepositorRunes: 400n,
  })
  ok(burnAudit.ok === false && /(CENOTAPH|BURN)/i.test(burnAudit.reason || ''),
    'a settlement whose edict names a non-existent output is a CENOTAPH — refused before it can burn the runes')

  // ── 5 · guards: a book that exceeds the vault, and dust, are refused at build time ─
  threw(() => settlementOutputs({ runeId: RID, totalVaultRunes: 100n, depositorBookRunes: 200n, depositorScriptHex: depScript, consolidationScriptHex: conScript, depositorSats: 330n, consolidationSats: 330n, dust: 330n }),
    /exceeds the vault/, 'a book balance larger than the vault is refused at build (the book can never out-credit the vault)')
  threw(() => settlementOutputs({ runeId: RID, totalVaultRunes: 1000n, depositorBookRunes: 400n, depositorScriptHex: depScript, consolidationScriptHex: conScript, depositorSats: 1n, consolidationSats: 330n, dust: 330n }),
    /dust/, 'a below-dust rune output is refused at build (it would not relay and the runes would strand)')

  const one = settlementRunestoneHex(RID, 400n, 0, 2)
  const oneBatch = batchSettlementRunestoneHex(RID, [{ amount: 400n, output: 0 }], 2)
  ok(one === oneBatch, 'N=1 loaf runestone is BYTE-IDENTICAL to the historic settlement stone — old paths do not fork')
  ok(one.length / 2 <= RUNESTONE_SCRIPT_MAX, 'the historic stone stays under the 83-byte BIP-110 script cap')
  ok(batchRunestoneFits(RID, [1400n, 1100n]), 'two dests of a Signet-sized rune still encode under the relay cap')
  ok(!batchRunestoneFits(RID, Array.from({ length: 40 }, () => 100n)), 'a 40-dest loaf is refused by the 83-byte cap — split, do not smash the decoder')

  // ── 6 · THE POT'S OWN SPLIT — each pot-backed holder gets EXACTLY their book (the sweep-defeating reflex) ─
  const potSettle = (potTotal: bigint, books: bigint[], remainderScriptHex = conScript) => {
    const holders = books.map((bookRunes, i) => ({ scriptHex: scriptOfAddress(addrOf('holder-' + i), NET), bookRunes, sats: 330n }))
    const { outputs, dests, consolidationOutput } = potSettlementOutputs({
      runeId: RID, potTotalRunes: potTotal, holders, remainderScriptHex, remainderSats: 330n, dust: 330n,
    })
    return auditSettlementSafety({ runeId: RID, outputScriptsHex: outputs.map((o) => o.script!), inputRunes: potTotal, depositorOutput: 0, consolidationOutput, maxDepositorRunes: 0n, dests })
  }

  const potSolvent = potSettle(1000n, [400n, 300n, 300n])   // 400+300+300 == 1000: fully backed
  ok(potSolvent.ok === true, 'a POT split paying three holders 400/300/300 of a 1000 pot is SAFE — each gets exactly their book, conserved')
  ok(potSolvent.burned === 0n, 'the pot split burns nothing — proven by ord\'s own decoder, not asserted')

  const potPartial = potSettle(1000n, [400n, 300n])         // 700 backed, 300 unbacked remainder parks in the pot
  ok(potPartial.ok === true && potPartial.consolidationGot === 300n,
    'a partly-backed pot split pays holders their book and parks the 300 unbacked remainder — conservation holds')

  // THE RESIDUE ATTACK, pot flavour: a hand-forged runestone paying a holder MORE than their book is REFUSED
  const holder0 = scriptOfAddress(addrOf('holder-0'), NET)
  const greedyPot = batchSettlementRunestoneHex(RID, [{ amount: 900n, output: 0 }], 2) // pays holder0 900; book is 400
  const potAttack = auditSettlementSafety({
    runeId: RID, outputScriptsHex: [holder0, greedyPot, conScript], inputRunes: 1000n,
    depositorOutput: 0, consolidationOutput: 2, maxDepositorRunes: 0n, dests: [{ output: 0, amount: 400n }],
  })
  ok(potAttack.ok === false && /not the 400/.test(potAttack.reason || ''),
    'a pot split overpaying a holder (900 vs their 400 book) is REFUSED — the same audit that guards the depositor guards the pool')

  // guard: the holders' books can never exceed the pot (it cannot credit more than it physically holds)
  threw(() => potSettlementOutputs({
    runeId: RID, potTotalRunes: 500n,
    holders: [{ scriptHex: depScript, bookRunes: 400n, sats: 330n }, { scriptHex: conScript, bookRunes: 200n, sats: 330n }],
    remainderScriptHex: conScript, remainderSats: 330n, dust: 330n,
  }), /exceed the pot/, 'a pot split whose books (600) exceed the pot (500) is refused at build — the pool never out-credits itself')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the depositor keeps only what the book says; the residue attack cannot pass; and the pot pays each holder exactly their book. ⚖₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
