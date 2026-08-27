/**
 * ADR-1 · THE RUNE PEG IN CONSENSUS — the reducer re-proves a rune deposit/settle from bytes.
 *
 * When a rune-deposit event carries { rawTx, txoutproof, headers, vault, inputRunes }, the reducer
 * re-proves on every apply/replay: buried under work, the EXACT claimed outpoint, the runestone
 * allocation delivers EXACTLY the claimed amount to the vault re-derived from the journaled params,
 * and the credit binds to that vault's own depositor. A rune-settle proof re-proves the payout is
 * the claimed l1Txid and pays the exit's SIGNED destination. A forged proof, a tampered amount, a
 * swapped recipient, a look-alike vault — each HALTs. Absent proof is byte-identical to before.
 *
 *   node src/test/rune-consensus-proof.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { verifyRuneDepositProof, verifyRuneSettleProof } from '../protocol/rune-bridge.ts'
import { parseTx } from '../anchor/spv.ts'
import { checkProofOfWork, sha256d } from '../anchor/spv.ts'
import { deriveVault } from '../protocol/vault.ts'
import { settlementRunestoneHex } from '../protocol/vault-settlement.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, addressOf, scriptOfAddress, runeExitMessage } from '../protocol/scheme.ts'
import { parseRuneKey } from '../economics/rune-book.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const halts = (fn: () => void, re: RegExp, m: string) => { try { fn(); ok(false, m + ' — DID NOT throw') } catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong: ' + msg)) } }

// ── fixture builders (regtest), mirrored from donate-consensus-proof.test.ts ─
const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b.toString('hex') }
const pushScript = (hex: string) => (hex.length / 2).toString(16).padStart(2, '0') + hex
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
function bury(rawTx: string, depth = 3) {
  const txidInternal = sha256d(Buffer.from(rawTx, 'hex'))
  const headers: Buffer[] = [mineHeader(Buffer.alloc(32), txidInternal)]
  for (let i = 1; i < depth; i++) headers.push(mineHeader(sha256d(headers[i - 1]), Buffer.alloc(32, i + 5)))
  return { rawTx, txoutproof: txoutProof(headers[0], txidInternal), headers: headers.map((h) => h.toString('hex')) }
}
const txidOf = (rawTx: string) => Buffer.from(sha256d(Buffer.from(rawTx, 'hex'))).reverse().toString('hex')

// ── the cast: a real depositor, real guardians, a re-derivable vault ─────────
const NET = 'regtest', BNET = toBtcNet(NET)
const mk = (t: string) => { const sk = createHash('sha256').update(`rune-consensus|${t}`).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk, addr: btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[BNET]).address! } }
const alice = mk('alice'), g1 = mk('g1'), g2 = mk('g2'), mallory = mk('mallory')
const VPARAMS = { guardians: [g1.pk, g2.pk], threshold: 2, depositor: alice.pk, timelock: 16 }
const vault = deriveVault({ ...VPARAMS, net: BNET })
const RUNE = '840000:1', rid = parseRuneKey(RUNE)
const AMT = 500n

function main() {
  console.log('\n╔═ ADR-1 · THE RUNE PEG IN CONSENSUS — deposits and settles re-proven from bytes ══╗\n')

  // the deposit tx: out0 = the vault (rune-bearing), out1 = runestone (edict 500→out0, pointer→2), out2 = change
  const stone = settlementRunestoneHex(rid, AMT, 0, 2)
  const depTx = tx([
    { sats: 10_000n, script: scriptOfAddress(vault.address, BNET) },
    { sats: 0n, script: stone },
    { sats: 5_000n, script: scriptOfAddress(mallory.addr, BNET) },
  ])
  const depProof = { ...bury(depTx), vault: { ...vault.params, net: undefined as never }, inputRunes: [{ id: RUNE, amount: AMT.toString() }] }
  delete (depProof.vault as Record<string, unknown>).net
  const OUTPOINT = `${txidOf(depTx)}:0`

  const fx = verifyRuneDepositProof(depProof, { runeId: rid, outpoint: OUTPOINT, to: alice.addr, amount: AMT, net: NET, minConfirmations: 1 })
  ok(fx.ok === true, `fixture: the deposit proof itself verifies (500 to the derived vault, bound to Alice)${fx.ok ? '' : ' — ' + fx.reason}`)

  // ── 1 · a proof-bearing deposit is re-verified in consensus and credits ──
  const L = new KrayLedger(undefined, NET)
  const journal: KrayEvent[] = []
  const put = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
  put({ seq: 1, kind: 'donate', hash: 'a'.repeat(64), to: alice.addr, amount: '100' } as KrayEvent)
  put({ seq: 2, kind: 'rune-deposit', hash: 'b'.repeat(64), runeId: RUNE, outpoint: OUTPOINT, to: alice.addr, amount: AMT.toString(), proof: depProof } as KrayEvent)
  ok(L.runes.balanceOf(rid, alice.addr) === AMT && L.runesSolvent(), '1 · a genuine proof-bearing deposit is RE-VERIFIED in consensus and credits 500')

  // ── 2 · the claimed amount DISAGREES with what the runestone delivers → HALT ──
  halts(() => L.applyLive({ seq: 3, kind: 'rune-deposit', hash: 'c'.repeat(64), runeId: RUNE, outpoint: txidOf(depTx) + ':9', to: alice.addr, amount: '600', proof: { ...depProof, inputRunes: [{ id: RUNE, amount: '600' }] } } as KrayEvent),
    /received 500 of the rune, not the 600/, '2 · a deposit claiming 600 while the runestone delivers 500 is refused')

  // ── 3 · the claimed OUTPOINT is not where the proof buries the runes → HALT ──
  halts(() => L.applyLive({ seq: 3, kind: 'rune-deposit', hash: 'd'.repeat(64), runeId: RUNE, outpoint: `${txidOf(depTx)}:2`, to: alice.addr, amount: AMT.toString(), proof: depProof } as KrayEvent),
    /buries outpoint .*:0, not the claimed .*:2/, '3 · a deposit claiming a different outpoint than the proven one is refused')

  // ── 4 · the credit names someone other than the vault's own depositor → HALT ──
  // (a FRESH tx — the credited-once guard must not shadow the binding check)
  const depTx2 = tx([
    { sats: 10_000n, script: scriptOfAddress(vault.address, BNET) },
    { sats: 0n, script: stone },
    { sats: 5_001n, script: scriptOfAddress(mallory.addr, BNET) },
  ])
  const depProof2 = { ...bury(depTx2), vault: { ...VPARAMS }, inputRunes: [{ id: RUNE, amount: AMT.toString() }] }
  const OUTPOINT2 = `${txidOf(depTx2)}:0`
  halts(() => L.applyLive({ seq: 3, kind: 'rune-deposit', hash: 'e'.repeat(64), runeId: RUNE, outpoint: OUTPOINT2, to: mallory.addr, amount: AMT.toString(), proof: depProof2 } as KrayEvent),
    /binds depositor .* not the credited/, '4 · a deposit crediting Mallory against Alice\'s vault is refused')

  // ── 5 · a LOOK-ALIKE vault (different guardians in the journaled params) → HALT ──
  const fakeVault = { guardians: [mallory.pk, g2.pk], threshold: 2, depositor: alice.pk, timelock: 16 }
  halts(() => L.applyLive({ seq: 3, kind: 'rune-deposit', hash: 'f'.repeat(64), runeId: RUNE, outpoint: OUTPOINT2, to: alice.addr, amount: AMT.toString(), proof: { ...depProof2, vault: fakeVault } } as KrayEvent),
    /no output matches the target script/, '5 · a proof whose journaled vault params derive a DIFFERENT vault is refused')

  // ── 6 · a proof whose runestone is a CENOTAPH → HALT (fail-closed, it would have burned) ──
  const cenotaphStone = '6a5d' + '02' + 'ff7f'   // tag 127 (unrecognized ODD tag ⇒ cenotaph per spec ordering rules) — malformed on purpose
  const cenoTx = tx([
    { sats: 10_000n, script: scriptOfAddress(vault.address, BNET) },
    { sats: 0n, script: cenotaphStone },
  ])
  const cenoProof = { ...bury(cenoTx), vault: { ...VPARAMS }, inputRunes: [{ id: RUNE, amount: AMT.toString() }] }
  halts(() => L.applyLive({ seq: 3, kind: 'rune-deposit', hash: '9'.repeat(64), runeId: RUNE, outpoint: `${txidOf(cenoTx)}:0`, to: alice.addr, amount: AMT.toString(), proof: cenoProof } as KrayEvent),
    /CENOTAPH|BURNS|received 0 of the rune/, '6 · a proof whose runestone burns (cenotaph/misroute) is refused')

  // ── 7 · byte-identical when the proof is absent (the door remains the gate) ──
  const L2 = new KrayLedger(undefined, NET)
  L2.applyLive({ seq: 1, kind: 'rune-deposit', hash: '1'.repeat(64), runeId: RUNE, outpoint: 'aa'.repeat(32) + ':0', to: alice.addr, amount: '77' } as KrayEvent)
  ok(L2.runes.balanceOf(rid, alice.addr) === 77n, '7 · a deposit with NO proof still credits (byte-identical to before)')

  // ── 8 · THE SETTLE, re-proven: exit (signed) → payout proof pays the SIGNED destination ──
  const exitSig = _signKrayWallet(runeExitMessage(NET, alice.addr, RUNE, 400n, alice.addr, 0), alice.sk)
  put({ seq: 3, kind: 'rune-exit', hash: '2'.repeat(64), runeId: RUNE, from: alice.addr, amount: '400', l1Address: alice.addr, fee: '1', nonce: 0, publicKey: alice.pk, signature: exitSig, scheme: 'kraywallet' } as KrayEvent)
  const payTx = tx([
    { sats: 10_000n, script: scriptOfAddress(alice.addr, BNET) },
    { sats: 0n, script: settlementRunestoneHex(rid, 400n, 0, 2) },
    { sats: 5_000n, script: scriptOfAddress(vault.address, BNET) },
  ])
  const payProof = { ...bury(payTx), inputRunes: [{ id: RUNE, amount: '400' }] }
  // 8a · a settle claiming a DIFFERENT txid than the proof buries → HALT
  halts(() => L.applyLive({ seq: 4, kind: 'rune-settle', hash: '3'.repeat(64), runeId: RUNE, from: alice.addr, amount: '400', l1Txid: 'e'.repeat(64), proof: payProof } as KrayEvent),
    /buries .* not the claimed payout/, '8a · a settle naming a txid the proof does not bury is refused')
  // 8b · a payout that pays the WRONG destination (not the signed one) → HALT
  const wrongTx = tx([
    { sats: 10_000n, script: scriptOfAddress(mallory.addr, BNET) },
    { sats: 0n, script: settlementRunestoneHex(rid, 400n, 0, 2) },
    { sats: 5_000n, script: scriptOfAddress(vault.address, BNET) },
  ])
  halts(() => L.applyLive({ seq: 4, kind: 'rune-settle', hash: '4'.repeat(64), runeId: RUNE, from: alice.addr, amount: '400', l1Txid: txidOf(wrongTx), proof: { ...bury(wrongTx), inputRunes: [{ id: RUNE, amount: '400' }] } } as KrayEvent),
    /no output matches the target script/, '8b · a payout paying Mallory instead of the SIGNED destination is refused')
  // 8c · the genuine settle burns the lock
  put({ seq: 4, kind: 'rune-settle', hash: '5'.repeat(64), runeId: RUNE, from: alice.addr, amount: '400', l1Txid: txidOf(payTx), proof: payProof } as KrayEvent)
  ok(L.runes.reserveOf(rid) === 100n && L.runes.lockedOf(rid, alice.addr) === null, '8c · the proven settle burned the 400 lock — reserve fell to 100')

  // ── 9 · THE COLD REPLAY re-proves every proof; a tampered journal HALTs ──
  const R = new KrayLedger(undefined, NET)
  for (const e of journal) R.applyLive(e)
  ok(R.cascadeRoot() === L.cascadeRoot() && R.runesSolvent(), '9 · cold replay re-verified every rune proof — cascade root byte-exact')
  const T = new KrayLedger(undefined, NET)
  const tampered = journal.map((e) => (e.kind === 'rune-deposit' ? { ...e, amount: '501' } : e))
  halts(() => { for (const e of tampered) T.applyLive(e) },
    /received 500 of the rune, not the 501|proof does not verify/, '9b · a journal whose deposit amount was tampered (500→501) HALTs on replay')

  // ── 10 · POT DEPOSIT — credit binds to the unique Taproot spender, not the pot's depositor ──
  // Fresh ledger: the pot's depositor is a NETWORK key (g1). Alice spends into that pot.
  // Crediting g1 would mint to the network. Crediting Mallory would steal Alice's payment.
  const potParams = { guardians: [g1.pk, g2.pk], threshold: 2, depositor: g1.pk, timelock: 16 }
  const pot = deriveVault({ ...potParams, net: BNET })
  const parent = tx([{ sats: 10_000n, script: scriptOfAddress(alice.addr, BNET) }])
  const parentTxid = parseTx(parent).txidDisplay
  const voutHex = Buffer.alloc(4); voutHex.writeUInt32LE(0)
  const prevInternal = Buffer.from(parentTxid, 'hex').reverse().toString('hex')
  const potOuts = [
    { sats: 10_000n, script: scriptOfAddress(pot.address, BNET) },
    { sats: 0n, script: stone },
    { sats: 5_000n, script: scriptOfAddress(mallory.addr, BNET) },
  ]
  const potOutHex = potOuts.map((o) => u64le(o.sats) + pushScript(o.script)).join('')
  const potTx = ['01000000', '01', prevInternal, voutHex.toString('hex'), '00', 'ffffffff', '03', potOutHex, '00000000'].join('')
  const potProof = { ...bury(potTx), vault: { ...potParams }, inputRunes: [{ id: RUNE, amount: AMT.toString() }], parentTxs: [parent], pool: true as const }
  const POT_OUT = `${txidOf(potTx)}:0`

  const potOk = verifyRuneDepositProof(potProof, { runeId: rid, outpoint: POT_OUT, to: alice.addr, amount: AMT, net: NET, minConfirmations: 1, pool: true })
  ok(potOk.ok === true, `10a · a pot-deposit proof credits Alice the spender${potOk.ok ? '' : ' — ' + potOk.reason}`)

  const LP = new KrayLedger(undefined, NET)
  LP.applyLive({ seq: 1, kind: 'rune-deposit', hash: 'c'.repeat(64), runeId: RUNE, outpoint: POT_OUT, to: alice.addr, amount: AMT.toString(), pool: true, proof: potProof } as KrayEvent)
  ok(LP.runes.balanceOf(rid, alice.addr) === AMT && LP.runes.transferableOf(rid, alice.addr) === AMT && LP.runes.personalOf(rid, alice.addr) === 0n,
    '10b · a pot deposit is pot-backed from birth — transferable immediately, personal 0')

  const steal = verifyRuneDepositProof(potProof, { runeId: rid, outpoint: POT_OUT, to: mallory.addr, amount: AMT, net: NET, minConfirmations: 1, pool: true })
  ok(steal.ok === false && /unique spender/.test(steal.reason || ''), '10c · crediting Mallory against Alice\'s pot payment is refused')

  const noParents = { ...potProof, parentTxs: [] as string[] }
  const noP = verifyRuneDepositProof(noParents, { runeId: rid, outpoint: POT_OUT, to: alice.addr, amount: AMT, net: NET, minConfirmations: 1, pool: true })
  ok(noP.ok === false && /parent txs/.test(noP.reason || ''), '10d · a pot proof with no parent txs refuses — the spender cannot be named')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the rune peg is re-proven in the reducer, from bytes. ⛓⚗️₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
