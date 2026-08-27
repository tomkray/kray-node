/**
 * THE TK-FOLD IN CONSENSUS (Gate 2) — prove by breaking, with a REAL Groth16 fold proof:
 *   node src/test/tk-fold-consensus.test.ts
 *
 * The committed artifact `apps/kray-fold/proofs/fold-groth16-v2.json` is a REAL proof of golden
 * vector V2 (same-nonce rivals), generated at the forge and verified here by the vendored WASM
 * verifier inside the reducer — no stub, no mock, no false-green. The exam reconstructs V2's exact
 * pre lane state through CONSENSUS acts (burn → lane-enter), lands the proven breath, and then
 * attacks every wall:
 *
 *   TC-01  DORMANT — below the activation seq all three kinds are refused; the cascade root never grows
 *   TC-02  THE ENTRY — burn ₭ → Ӿ; lane-enter moves it: books change, conservation holds, the lane
 *          root equals the golden vector's preRoot (consensus reconstructs the proven state exactly)
 *   TC-03  THE PROVEN BREATH — the real fold-seal lands: proof verified in-reducer, diffs applied,
 *          lane root == the proven postRoot, the rival law's outcome visible in consensus balances
 *   TC-04  TAMPER — one flipped proof byte is refused
 *   TC-05  ALTERED DIFFS — diffs that do not hash to foldDiffsHash are refused (proof reuse is dead)
 *   TC-06  ONE STORY — public values disagreeing with the act are refused; a wrong-network fold is
 *          refused; a conservation lie (laneTotal ≠ the lane's total) is refused
 *   TC-07  STALE FOLD — the same proven breath cannot land twice (preRoot chains to the present)
 *   TC-08  THE EXIT — lane-exit returns Ӿ to the spendable book; an overdrawn exit is refused
 *   TC-09  IN THE ROOT — the lane folds into the cascade at/after activation; a fresh ledger replays
 *          the SAME journal (re-verifying the real proof on replay) to a byte-identical root
 *   TC-10  THE PIN — the artifact's vkey hash IS the consensus pin (a re-forged guest without a
 *          ratified re-pin breaks here first)
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, burnMessage, laneEnterMessage, laneExitMessage, foldSealMessage } from '../protocol/scheme.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'
import { TK_FOLD_VKEY_HASH } from '../protocol/fold-verifier.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}

// ── the frozen truth: golden vector V2 and its REAL Groth16 proof ──
interface Vector { name: string; pre: { balances: Array<[string, string]> }; expected: { preRoot: string; postRoot: string; diffsHash: string; diffs: { balances: Array<[string, string]>; nonces: Array<[string, number]> } } }
const vectors = JSON.parse(readFileSync(join(HERE, 'vectors', 'tk-fold.golden.json'), 'utf8')) as Vector[]
const V2 = vectors[1]
const artifact = JSON.parse(readFileSync(join(HERE, '../../../kray-fold/proofs/fold-groth16-v2.json'), 'utf8')) as { vector: string; proof: string; publicValues: string; vkeyHash: string }

// ── wallets: the SAME derivation as the golden vectors (so consensus can rebuild V2's pre state) ──
function wallet(seedDomain: string, tag: string) {
  const sk = createHash('sha256').update(seedDomain + '|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const A = wallet('tk-fold-vectors', 'A')           // the golden vectors' wallet A — V2's only lane account
const FOLDER = wallet('tk-fold-consensus', 'folder')

/** a ledger with Ӿ transfers active from seq 1 and a chosen TK-fold activation seq (MAX = dormant) */
function ledger(tkSeq: number) {
  const L = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, 1, undefined, undefined, undefined, undefined, undefined, tkSeq)
  const J: KrayEvent[] = []
  const ap = (e: Record<string, unknown>) => { const ev = { ...e, seq: J.length + 1 } as unknown as KrayEvent; L.applyLive(ev); J.push(ev); return ev }
  return { L, J, ap }
}
type W = ReturnType<typeof wallet>
function burnEv(L: KrayLedger, w: W, amt: bigint) {
  const n = L.nonceOf(w.addr)
  return { kind: 'burn', hash: sha256hex(`burn|${w.addr}|${n}`), from: w.addr, amount: String(amt), fee: '1', nonce: n, publicKey: w.pk, signature: _signKrayWallet(burnMessage(NET, w.addr, amt, n), w.sk), scheme: 'kraywallet' }
}
function laneEnterEv(L: KrayLedger, w: W, amt: string) {
  const n = L.nonceOf(w.addr)
  return { kind: 'lane-enter', hash: sha256hex(`lenter|${w.addr}|${amt}|${n}`), from: w.addr, amount: amt, fee: '1', nonce: n, publicKey: w.pk, signature: _signKrayWallet(laneEnterMessage(NET, w.addr, BigInt(amt), n), w.sk), scheme: 'kraywallet' }
}
function laneExitEv(L: KrayLedger, w: W, amt: string) {
  const n = L.nonceOf(w.addr)
  return { kind: 'lane-exit', hash: sha256hex(`lexit|${w.addr}|${amt}|${n}`), from: w.addr, amount: amt, fee: '1', nonce: n, publicKey: w.pk, signature: _signKrayWallet(laneExitMessage(NET, w.addr, BigInt(amt), n), w.sk), scheme: 'kraywallet' }
}
function foldSealEv(L: KrayLedger, w: W, fields: { foldPre: string; foldPost: string; foldDiffsHash: string; foldDiffs: unknown; foldProof: string; foldPublic: string }) {
  const n = L.nonceOf(w.addr)
  return {
    kind: 'fold-seal', hash: sha256hex(`fseal|${fields.foldPre}|${fields.foldPost}|${n}`), from: w.addr, fee: '1', nonce: n,
    ...fields,
    publicKey: w.pk, signature: _signKrayWallet(foldSealMessage(NET, w.addr, fields.foldPre, fields.foldPost, fields.foldDiffsHash, n), w.sk), scheme: 'kraywallet',
  }
}
/** bincode(String) of a JSON — for crafting HOSTILE public values (the real ones come from the artifact) */
function bincodeJson(obj: unknown): string {
  const body = Buffer.from(JSON.stringify(obj), 'utf8')
  const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(body.length))
  return Buffer.concat([len, body]).toString('hex')
}
const realPublic = () => {
  const buf = Buffer.from(artifact.publicValues, 'hex')
  return JSON.parse(buf.subarray(8).toString('utf8')) as Record<string, unknown>
}
const goodFields = () => ({
  foldPre: V2.expected.preRoot, foldPost: V2.expected.postRoot, foldDiffsHash: V2.expected.diffsHash,
  foldDiffs: V2.expected.diffs, foldProof: artifact.proof, foldPublic: artifact.publicValues,
})
/** fund + burn + enter: reconstruct V2's exact pre lane state ({A: 100}) through consensus acts */
function toPreState(l: ReturnType<typeof ledger>) {
  l.ap({ kind: 'donate', hash: 'dA', to: A.addr, amount: '200' })
  l.ap({ kind: 'donate', hash: 'dF', to: FOLDER.addr, amount: '10' })
  l.ap(burnEv(l.L, A, 100n))
  l.ap(laneEnterEv(l.L, A, '100'))
}

function main() {
  console.log('\n╔═ THE TK-FOLD IN CONSENSUS — a real proof meets the reducer, then every wall is attacked ═╗\n')

  console.log('TC-10 — THE PIN (first: everything below rests on it)')
  ok(artifact.vkeyHash === TK_FOLD_VKEY_HASH, 'the artifact was proven by THE pinned guest program (vkey hash matches the consensus constant)')
  ok(artifact.vector === V2.name, 'the artifact proves golden vector V2 — the exact breath this exam lands')

  console.log('\nTC-01 — DORMANT: below the activation seq the lane does not exist')
  const D = ledger(Number.MAX_SAFE_INTEGER)
  D.ap({ kind: 'donate', hash: 'dA', to: A.addr, amount: '200' })
  D.ap(burnEv(D.L, A, 100n))
  rejects(() => D.ap(laneEnterEv(D.L, A, '100')), /not active/, 'lane-enter refused while dormant')
  rejects(() => D.ap(laneExitEv(D.L, A, '1')), /not active/, 'lane-exit refused while dormant')
  rejects(() => D.ap(foldSealEv(D.L, A, goodFields())), /not active/, 'fold-seal refused while dormant')
  ok(D.L.laneTotalNow() === 0n && D.L.conserves(), 'the lane holds nothing; conservation intact')
  const dormantParts = D.L.cascadeParts() as Record<string, unknown>
  ok(dormantParts.laneRoot === undefined, 'the lane root folds NOWHERE below activation (A3 — anchored history byte-identical)')

  console.log('\nTC-02 — THE ENTRY: consensus reconstructs the golden vector\'s pre state exactly')
  const V = ledger(1)
  toPreState(V)
  ok(V.L.xBalanceOf(A.addr) === 0n && V.L.laneBalanceOf(A.addr) === 100n, 'Ӿ changed books: spendable 0, lane 100')
  ok(V.L.conserves(), 'the extended tripwire holds (Σ spendable + Σ lane == burned)')
  ok(V.L.laneRootNow() === V2.expected.preRoot, `the lane root IS the golden preRoot (${V2.expected.preRoot.slice(0, 12)}…) — one commitment, zero drift`)

  console.log('\nTC-03 — THE PROVEN BREATH: the real Groth16 proof lands in consensus')
  const t0 = process.hrtime.bigint()
  V.ap(foldSealEv(V.L, FOLDER, goodFields()))
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  ok(V.L.laneRootNow() === V2.expected.postRoot, `the lane root moved to the proven postRoot (verified in-reducer in ${ms.toFixed(0)} ms)`)
  const winner = V2.expected.diffs.balances.find(([a]) => a !== A.addr)!
  ok(V.L.laneBalanceOf(A.addr) === 70n && V.L.laneBalanceOf(winner[0]) === 30n, `the rival law's outcome is consensus: A 70, the hash-order winner ${winner[0].slice(0, 12)}… 30`)
  ok(V.L.conserves() && V.L.laneTotalNow() === 100n, 'a breath only rearranges — conservation exact')

  console.log('\nTC-04 — TAMPER: one flipped proof byte')
  const stale = ledger(1); toPreState(stale)
  const tampered = goodFields()
  tampered.foldProof = tampered.foldProof.slice(0, -2) + (tampered.foldProof.endsWith('00') ? '01' : '00')
  rejects(() => stale.ap(foldSealEv(stale.L, FOLDER, tampered)), /does not verify/, 'a tampered proof does not exist')

  console.log('\nTC-05 — ALTERED DIFFS: proof reuse over different diffs is dead')
  const altered = goodFields()
  altered.foldDiffs = { balances: [[A.addr, '100']], nonces: [] }   // pay nobody, keep it all
  rejects(() => stale.ap(foldSealEv(stale.L, FOLDER, altered)), /do not hash to foldDiffsHash/, 'diffs that do not hash to the proven diffsHash are refused')

  console.log('\nTC-06 — ONE STORY: public values, network wall, conservation lie')
  const rp = realPublic()
  const liarStory = goodFields()
  liarStory.foldPublic = bincodeJson({ ...rp, postRoot: '11'.repeat(32) })
  liarStory.foldPost = '11'.repeat(32)   // act matches its own lie — but then the PROOF was not over these values
  rejects(() => stale.ap(foldSealEv(stale.L, FOLDER, liarStory)), /does not verify/, 'public values the proof never committed are refused by the proof itself')
  const wrongNet = goodFields()
  wrongNet.foldPublic = bincodeJson({ ...rp, network: 'signet' })
  rejects(() => stale.ap(foldSealEv(stale.L, FOLDER, wrongNet)), /another network/, 'a fold proven for another network is refused (the domain wall)')
  const lie = goodFields()
  lie.foldPublic = bincodeJson({ ...rp, laneTotal: '101' })
  rejects(() => stale.ap(foldSealEv(stale.L, FOLDER, lie)), /conserved total/, 'a laneTotal lie is refused before the proof is even consulted')

  console.log('\nTC-07 — STALE FOLD: the same breath can never land twice')
  rejects(() => V.ap(foldSealEv(V.L, FOLDER, goodFields())), /does not chain/, 'the second landing refuses — preRoot is no longer the lane\'s present')

  console.log('\nTC-08 — THE EXIT: lane Ӿ returns to the spendable book')
  V.ap(laneExitEv(V.L, A, '50'))
  ok(V.L.xBalanceOf(A.addr) === 50n && V.L.laneBalanceOf(A.addr) === 20n, 'A exited 50: spendable 50, lane 20')
  ok(V.L.conserves(), 'conservation holds across the exit')
  rejects(() => V.ap(laneExitEv(V.L, A, '21')), /insufficient lane/, 'an overdrawn exit is refused')

  console.log('\nTC-09 — IN THE ROOT, AND ON REPLAY: a stranger re-verifies the proof from bytes alone')
  const activeParts = V.L.cascadeParts() as Record<string, unknown>
  ok(activeParts.laneRoot === V.L.laneRootNow(), 'the lane root folds into the cascade at/after activation')
  const R = ledger(1)
  for (const e of V.J) R.L.applyLive(e)
  ok(R.L.cascadeRoot() === V.L.cascadeRoot(), 'a fresh ledger replays the SAME journal — real proof re-verified on replay — to a byte-identical root')
  ok(R.L.laneBalanceOf(A.addr) === 20n && R.L.laneBalanceOf(winner[0]) === 30n, 'every lane balance re-derives exactly (the Creator\'s re-sync law)')

  console.log(`\n═ tk-fold-consensus: ${pass} passed, ${fail} failed ═\n`)
  if (fail > 0) process.exit(1)
}
main()
