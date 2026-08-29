/**
 * THE WALLET SEND PSBTs — a rune transfer allocates EVERY input rune explicitly, so nothing burns.
 * Builds a rune send with change, decodes the runestone back, and proves: `amount` → the recipient
 * (output 0), the remainder → the sender (output 2), it is a runestone (never a cenotaph), and the
 * total allocated equals the total in (conservation). Also checks the no-change case and a BTC send.
 *
 *   node src/test/wallet-psbt.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { buildRuneSendPsbt, buildBtcSendPsbt, buildInscriptionSendPsbt, taprootKeypathVsize, feeSatsAtRate, SEQUENCE_RBF } from '../protocol/wallet-psbt.ts'
import { decipher, allocate } from '../protocol/runestone.ts'
import { NETWORKS, _hexToBytes, _generateKeyPair } from '../protocol/scheme.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }

const NET = 'regtest', bnet = NETWORKS.regtest
const RUNE = { block: 840000n, tx: 9n }
const XS = _generateKeyPair(createHash('sha256').update('wallet-psbt|sender').digest()).publicKeyHex
const XR = _generateKeyPair(createHash('sha256').update('wallet-psbt|recipient').digest()).publicKeyHex
const from = btc.p2tr(_hexToBytes(XS), undefined, bnet).address
const to = btc.p2tr(_hexToBytes(XR), undefined, bnet).address
const scriptsOf = (psbtHex: string): Uint8Array[] => {
  const tx = btc.Transaction.fromPSBT(_hexToBytes(psbtHex))
  const s: Uint8Array[] = []
  for (let i = 0; i < tx.outputsLength; i++) s.push(Uint8Array.from(tx.getOutput(i).script!))
  return s
}
const allocOf = (art: ReturnType<typeof decipher>, scripts: Uint8Array[]) =>
  allocate(art, { outputScripts: scripts, inputs: [{ id: RUNE, amount: 1000n }] })
const sumAt = (a: ReturnType<typeof allocate>, i: number) => (a.outputs.get(i) || []).reduce((t, r) => t + r.amount, 0n)

function main() {
  console.log('\n╔═ THE WALLET SEND PSBTs — a rune transfer never burns a rune ══════╗')

  const runeUtxos = [{ txid: '11'.repeat(32), vout: 0, sats: 10000n, xonly: XS, runeAmount: 1000n }]
  const feeUtxos = [{ txid: '22'.repeat(32), vout: 1, sats: 100000n, xonly: XS }]

  // ── 1 · a rune send WITH change (send 300 of 1000) ─────────────────────────
  const b1 = buildRuneSendPsbt({ net: NET, runeId: RUNE, amount: 300n, to, from, runeUtxos, feeUtxos, feeSats: 400n, dust: 330n })
  const s1 = scriptsOf(b1.psbtHex), art1 = decipher(s1)
  ok(!!art1 && art1.kind === 'runestone', 'the transfer is a RUNESTONE, never a cenotaph')
  const eds = art1 && art1.kind === 'runestone' ? art1.edicts : []
  ok(eds.length === 2 && eds[0].amount === 300n && eds[0].output === 0 && eds[1].amount === 700n && eds[1].output === 2,
    `two explicit edicts: 300 → recipient (out 0), 700 change → sender (out 2) [${JSON.stringify(eds.map((e) => [e.amount.toString(), e.output]))}]`)
  ok(b1.runeChange === '700', 'runeChange reported = 700')

  // ── 2 · allocation CONSERVES — recipient 300, sender 700, nothing burned ───
  const a1 = allocOf(art1, s1)
  const burned = (a1.burned || []).reduce((t, r) => t + r.amount, 0n)
  ok(sumAt(a1, 0) === 300n && sumAt(a1, 2) === 700n && burned === 0n, 'ord allocation: out 0 = 300, out 2 = 700, burned = 0 — CONSERVED (in 1000 == out 1000)')

  // ── 3 · a rune send with NO change (send the whole 1000) ───────────────────
  const b2 = buildRuneSendPsbt({ net: NET, runeId: RUNE, amount: 1000n, to, from, runeUtxos, feeUtxos, feeSats: 400n, dust: 330n })
  const s2 = scriptsOf(b2.psbtHex), art2 = decipher(s2), a2 = allocOf(art2, s2)
  const eds2 = art2 && art2.kind === 'runestone' ? art2.edicts : []
  ok(eds2.length === 1 && eds2[0].amount === 1000n && sumAt(a2, 0) === 1000n && (a2.burned || []).length === 0,
    'the whole balance moves: one edict 1000 → recipient (out 0), no change output, nothing burned')

  // ── 3.5 · a CO-RESIDENT rune (Y sharing the spent UTXO) goes HOME to the sender, never leaks ──
  const RUNE_Y = { block: 840001n, tx: 5n }
  const b3 = buildRuneSendPsbt({ net: NET, runeId: RUNE, amount: 300n, to, from, runeUtxos, feeUtxos, feeSats: 400n, dust: 330n })
  const s3 = scriptsOf(b3.psbtHex), art3 = decipher(s3)
  // the spent UTXO ALSO carried 50 of a second rune Y the builder never knew about
  const a3 = allocate(art3, { outputScripts: s3, inputs: [{ id: RUNE, amount: 1000n }, { id: RUNE_Y, amount: 50n }] })
  const idAt = (i, id) => (a3.outputs.get(i) || []).filter((r) => r.id.block === id.block && r.id.tx === id.tx).reduce((t, r) => t + r.amount, 0n)
  ok(!!art3 && art3.kind === 'runestone' && art3.pointer === 2, 'the runestone carries a POINTER → output 2 (the sender)')
  ok(idAt(0, RUNE) === 300n && idAt(0, RUNE_Y) === 0n, 'the recipient (out 0) gets EXACTLY 300 X and ZERO of the co-resident rune Y')
  ok(idAt(2, RUNE_Y) === 50n && idAt(2, RUNE) === 700n, 'the co-resident rune Y (50) went HOME to the sender (out 2) with the 700 X change — no silent leak')

  // ── 4 · insufficient runes is refused (never a silent short-send) ──────────
  let refused = false
  try { buildRuneSendPsbt({ net: NET, runeId: RUNE, amount: 2000n, to, from, runeUtxos, feeUtxos, feeSats: 400n, dust: 330n }) } catch { refused = true }
  ok(refused, 'sending more than you hold is REFUSED (no short-send)')

  // ── 5 · a plain BTC send pays the recipient + changes back ─────────────────
  const b5 = buildBtcSendPsbt({ net: NET, from, to, sats: 50000n, utxos: feeUtxos, feeSats: 400n, dust: 330n })
  const tx5 = btc.Transaction.fromPSBT(_hexToBytes(b5.psbtHex))
  ok(tx5.outputsLength === 2 && b5.change === String(100000n - 50000n - 400n), 'BTC send: pays 50000, change 49600 back to sender')
  const rbfOk = (hex: string) => {
    const tx = btc.Transaction.fromPSBT(_hexToBytes(hex))
    for (let i = 0; i < tx.inputsLength; i++) {
      if (((tx.getInput(i).sequence ?? 0xffffffff) >>> 0) !== SEQUENCE_RBF) return false
    }
    return tx.inputsLength > 0
  }
  ok(rbfOk(b1.psbtHex) && rbfOk(b5.psbtHex), 'wallet sends opt into BIP125 RBF (sequence 0xfffffffd) — a stuck fee can be replaced')

  // ── 6 · an inscription send: postage preserved, input 0 is the inscribed outpoint ──
  const scriptOf = (a: string) => btc.OutScript.encode(btc.Address(bnet).decode(a))
  const inscriptionUtxo = { txid: '33'.repeat(32), vout: 0, sats: 600n, script: scriptOf(from) }
  const pureFee = [{ txid: '44'.repeat(32), vout: 2, sats: 20000n, script: scriptOf(from) }]
  const b6 = buildInscriptionSendPsbt({ net: NET, from, to, inscriptionUtxo, feeUtxos: pureFee, feeSats: 500n, dust: 330n })
  const tx6 = btc.Transaction.fromPSBT(_hexToBytes(b6.psbtHex))
  const in0 = tx6.getInput(0)
  ok(Buffer.from(in0.txid!).toString('hex') === '33'.repeat(32) && in0.index === 0, 'input 0 IS the inscribed outpoint — the sat rides 0 → 0')
  const out0 = tx6.getOutput(0)
  ok(out0.amount === 600n && Buffer.from(out0.script!).toString('hex') === Buffer.from(scriptOf(to)).toString('hex'),
    'output 0 pays the recipient the EXACT postage (600) — never crushed, never taxed')
  ok(tx6.outputsLength === 2 && b6.change === String(20000n - 500n), 'fee comes ONLY from the pure input; change 19500 back to sender')
  ok(rbfOk(b6.psbtHex), 'the inscription send opts into RBF too')
  // ── 6b · fee cannot raid the postage: no pure input rich enough → REFUSED ──
  let noFee = false
  try { buildInscriptionSendPsbt({ net: NET, from, to, inscriptionUtxo, feeUtxos: [], feeSats: 500n, dust: 330n }) } catch { noFee = true }
  ok(noFee, 'with no pure fee input the send is REFUSED — the postage is never the purse')

  ok(taprootKeypathVsize(3, 4) === 10 + 3 * 58 + 4 * 43, '3-in/4-out rune send vsize is ~356, not the old 160 guess')
  ok(feeSatsAtRate(4, 3, 4) === BigInt(4 * (10 + 3 * 58 + 4 * 43)), 'High 4 sat/vB on that shape pays 4×vsize — not 640 from 4×160')

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — every rune in is a rune out; the transfer allocates the send and the change by explicit edict, so a wallet send can never strand or burn a coin. ⚗️₭`)
  process.exit(fail ? 1 : 0)
}
main()
