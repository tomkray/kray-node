/**
 * THE CREATOR'S OWN EXIT, FROZEN AND ATTACKED — the live signet withdraw of 2026-09-18, byte-faithful.
 *
 *   node src/test/live-exit-230-adversarial.test.ts
 *
 * On 2026-09-18 a real holder moved DOG•GO•TO•THE•MOON on L2, asked the pot to pay 50,000,000 of it to a
 * Bitcoin address, and the federation delivered it in tx 62cdbcd4…7cd0. Journal seq 228 (rune-exit) → 229
 * (rune-lodge) → 230 (rune-settle) records the act; the settle carries its own SPV bundle, so ANY stranger
 * re-proves the payout from the bytes alone. This suite freezes those three journal lines
 * (`vectors/live-signet-exit-230.golden.json`, verified by SHA-256 so an edit is loud) and then attacks the
 * settle the way a thief would:
 *
 *   · claim a different txid          · pay a different destination      · claim a larger amount
 *   · point the delivery at the pot's own change output (steal the remainder into the burn)
 *   · tamper one byte of the raw payout · tamper the merkle branch       · tamper the header chain
 *   · drop the ancestry bundle (the byte-pure input state) · forge an ancestry parent
 *
 * Every one must be REFUSED by `verifyRuneSettleProof`, the exact function the reducer calls on every
 * replay — so a follower that rebuilds the world from this journal reaches the same verdict as the writer,
 * and a lying journal never survives the rebuild. The honest bundle must still verify, or the law is broken.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyRuneSettleProof } from '../protocol/rune-bridge.ts'
import { parseRuneKey } from '../economics/rune-book.ts'
import type { RuneBalance } from '../economics/rune-book.ts'
import { donationProofMinConf } from '../protocol/kray-primitives.ts'
import { parseTx } from '../anchor/spv.ts'
import { scriptOfAddress, toBtcNet } from '../protocol/scheme.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

const HERE = dirname(fileURLToPath(import.meta.url))
const GOLDEN = join(HERE, 'vectors/live-signet-exit-230.golden.json')
const SHA256_OF_LINES = '0fb06b3993c0d18853bef3dadfe34598ba0e89065540a87259b5d039de5442dd'
const NET = 'signet'
const RUNE = '244701:81'
const TXID = '62cdbcd43e6c6f4fb88b145473d77990c12ac572f499d04f228b467a035a7cd0'
const EXITER = 'tb1p54yh37n92tteq9ad0c9ef2uumq6hxkseuk5ew4s984asynjugnzq7e3yfw'
const AMOUNT = 50_000_000n

type Line = Record<string, any>
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { lines: string[]; sha256OfLines: string; headSeq: number }
const lines = golden.lines.map((l) => JSON.parse(l) as Line)
const exit = lines.find((l) => l.kind === 'rune-exit')!
const lodge = lines.find((l) => l.kind === 'rune-lodge')!
const settle = lines.find((l) => l.kind === 'rune-settle')!

console.log('\n₭  THE CREATOR\'S OWN EXIT — frozen at signet seq ' + golden.headSeq + ', then attacked\n')

// ── 1 · the fixture is the live journal, unedited ──────────────────────────
const digest = createHash('sha256').update(golden.lines.join('\n') + '\n').digest('hex')
ok(digest === SHA256_OF_LINES && digest === golden.sha256OfLines, 'the frozen lines hash to the recorded SHA-256 — nobody edited the evidence')
ok(exit.seq === 228 && exit.kind === 'rune-exit' && exit.runeId === RUNE && exit.amount === '50000000' && exit.l1Address === EXITER,
  'seq 228 is the SIGNED exit: 50,000,000 DOG to the holder\'s own Bitcoin address')
ok(lodge.seq === 229 && lodge.outpoint === 'b07737677a3f96bba4f40853b2c9b13a9c9c80a1d2a51f45ef74e53e78a1609f:0' && lodge.from === exit.from,
  'seq 229 lodges the pot outpoint the payout will spend — the lock names its coin before anything is signed')
ok(settle.seq === 230 && settle.l1Txid === TXID && settle.amount === exit.amount && settle.from === exit.from,
  'seq 230 settles exactly the locked amount against the broadcast payout')
ok(typeof settle.proof?.rawTx === 'string' && typeof settle.proof?.txoutproof === 'string' && Array.isArray(settle.proof?.headers) && Array.isArray(settle.proof?.ancestry),
  'the settle embeds its own SPV bundle — raw payout, merkle branch, header chain, ancestry (no oracle, no trust)')

// ── 2 · THE WALK IS JOURNAL-RELATIVE — bytes alone never mint ──────────────
// The payout's input state is not asserted: the ancestry walk must terminate at an outpoint THIS journal
// already proved from Bitcoin. Here that floor is the pot coin credited by the rune-deposit at seq 76 and
// named by the lock at seq 229 — the reducer hands it to the verifier as `known`. Without it the very same
// honest bytes prove nothing, which is the point: a stranger cannot fabricate a credit out of a raw tx.
const rid = parseRuneKey(RUNE)
const expectBase = { runeId: rid, l1Txid: TXID, l1Address: EXITER, amount: AMOUNT, net: NET, minConfirmations: donationProofMinConf(toBtcNet(NET)), allowMintWitness: true }
const floor = golden.knownPotOutpoint
ok(floor.outpoint === lodge.outpoint && floor.provenBySeq === 76 && floor.lodgedBySeq === 229,
  'the walk\'s floor is the pot coin proven by the deposit at seq 76 and named by the lock at seq 229')
const naked = verifyRuneSettleProof(settle.proof, expectBase)
ok(naked.ok === false, 'WITHOUT the journal\'s proven-outpoint memo the same honest bytes are REFUSED — a settle proof is journal-relative, never context-free')
const known = new Map<string, RuneBalance[]>([[floor.outpoint, [{ id: parseRuneKey(floor.runeId), amount: BigInt(floor.amount) }]]])
const honest = verifyRuneSettleProof(settle.proof, expectBase, known)
ok(honest.ok === true, 'WITH it, THE LIVE PAYOUT RE-PROVES FROM BYTES — buried, the claimed txid, 50,000,000 DOG to the SIGNED destination' + (honest.ok ? '' : ' — ' + honest.reason))
const dest = scriptOfAddress(EXITER, toBtcNet(NET)).toLowerCase()
const parsed = parseTx(settle.proof.rawTx)
const scripts = parsed.outputScripts.map((b: Uint8Array) => Buffer.from(b).toString('hex').toLowerCase())
ok(scripts[0] === dest, 'output 0 of the real transaction pays the holder\'s signed address, nothing else')
ok((honest.provenOutputs ?? []).some((o) => o.vout === 0 && o.amount === AMOUNT), 'the ancestry walk credits output 0 with exactly the locked 50,000,000')
const change = (honest.provenOutputs ?? []).find((o) => o.vout !== 0)
ok(!!change && change.vout === 2 && change.amount === 299_950_000_000n, 'the remainder (299,950,000,000 DOG) is proven onto the pot\'s own change output — the reserve never leaves custody')
ok(BigInt(floor.amount) === AMOUNT + 299_950_000_000n + 0n, 'nothing appears and nothing vanishes: the proven pot coin equals the payout plus the change, to the unit')

// ── 3 · the attacks · each must be refused ─────────────────────────────────
// Each attack runs WITH the honest memo in hand — the thief is given every advantage the reducer gives
// an honest settle, and must still be refused.
const V = (proof: any, expect: any) => verifyRuneSettleProof(proof, expect, known)
const attacks: Array<{ name: string; run: () => { ok: boolean; reason?: string } }> = [
  { name: 'a thief claims the burn against a DIFFERENT transaction', run: () => V(settle.proof, { ...expectBase, l1Txid: TXID.slice(0, 63) + (TXID.endsWith('0') ? '1' : '0') }) },
  { name: 'a thief swaps the destination for an address the holder never signed', run: () => V(settle.proof, { ...expectBase, l1Address: 'tb1pxd5snpedtrkqgmngclr4jk76g2xaf3aacawe37gqjkpvw6jcwyls09rm5u' }) },
  { name: 'a thief inflates the settled amount above the lock', run: () => V(settle.proof, { ...expectBase, amount: AMOUNT + 1n }) },
  { name: 'a thief deflates the settled amount below the lock', run: () => V(settle.proof, { ...expectBase, amount: AMOUNT - 1n }) },
  { name: 'a thief points the delivery at the POT\'S CHANGE (burn 50M, walk away with 299,950,000,000)', run: () => V(settle.proof, { ...expectBase, deliveryVout: 2 }) },
  { name: 'a thief points the delivery at the service output', run: () => V(settle.proof, { ...expectBase, deliveryVout: 1 }) },
  { name: 'one byte of the raw payout is tampered', run: () => { const p = { ...settle.proof, rawTx: flipHex(settle.proof.rawTx, 40) }; return V(p, expectBase) } },
  { name: 'one byte of the merkle branch is tampered', run: () => { const p = { ...settle.proof, txoutproof: flipHex(settle.proof.txoutproof, 200) }; return V(p, expectBase) } },
  { name: 'one byte of the header chain is tampered (the work no longer covers it)', run: () => { const hs = [...settle.proof.headers]; hs[0] = flipHex(hs[0], 100); return V({ ...settle.proof, headers: hs }, expectBase) } },
  { name: 'the header chain is truncated below the burial depth', run: () => V({ ...settle.proof, headers: [] }, expectBase) },
  { name: 'the ancestry bundle is forged (a parent transaction is tampered)', run: () => { const a = settle.proof.ancestry.map((x: any) => (typeof x === 'string' ? x : { ...x })); const i = a.length - 1; if (typeof a[i] === 'string') a[i] = flipHex(a[i], 60); else if (typeof a[i]?.rawTx === 'string') a[i].rawTx = flipHex(a[i].rawTx, 60); return V({ ...settle.proof, ancestry: a }, expectBase) } },
  { name: 'the whole proof is dropped and the wire says "trust me"', run: () => V({ ...settle.proof, rawTx: '', txoutproof: '', headers: [], ancestry: undefined, inputRunes: undefined } as any, expectBase) },
  { name: 'the proof is replayed against the WRONG NETWORK (mainnet reducer, signet bytes)', run: () => V(settle.proof, { ...expectBase, net: 'main', minConfirmations: donationProofMinConf('main') }) },
  { name: 'the proof is replayed against a DIFFERENT RUNE id', run: () => V(settle.proof, { ...expectBase, runeId: parseRuneKey('244701:82') }) },
]
function flipHex(hex: string, at: number): string {
  const i = Math.min(at, Math.max(0, hex.length - 1))
  const c = hex[i]
  return hex.slice(0, i) + (c === '0' ? '1' : '0') + hex.slice(i + 1)
}
for (const a of attacks) {
  let v: { ok: boolean; reason?: string }
  try { v = a.run() } catch (e) { v = { ok: false, reason: (e as Error).message } }
  ok(v.ok === false, a.name + ' → REFUSED' + (v.ok ? ' — IT PASSED, THE LAW IS BROKEN' : ' (' + String(v.reason).slice(0, 96) + ')'))
}

// ── 4 · the honest bundle still verifies after every attack (no state carried) ──
const again = V(settle.proof, expectBase)
ok(again.ok === true, 'after every hostile mutation the untouched bundle still verifies — the verifier holds no state a thief can poison')

console.log(`\n╚═ ${pass} passed, ${fail} failed — the live exit re-proves from its own bytes; ${attacks.length} attacks on it refused. 🔐₭\n`)
if (fail) process.exit(1)
