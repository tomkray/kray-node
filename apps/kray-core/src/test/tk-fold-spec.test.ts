/**
 * THE TK-FOLD SPEC EXAMS (Gate 0) — the lane's mathematics proven by breaking:
 *   node src/test/tk-fold-spec.test.ts
 *
 *   TF-01  PERMUTATION INVARIANCE — any arrival order yields the identical schedule, diffs and roots
 *          (the folder assembles; mathematics orders; nobody chooses)
 *   TF-02  THE RE-SYNC LAW — the post state rebuilt from the diffs ALONE equals the applied state,
 *          root byte-for-byte (no transfer data needed — the Creator's requirement)
 *   TF-03  CONSERVATION — Σ lane balances invariant under storm; refused acts mutate nothing
 *   TF-04  FORGED SIGNATURE — excluded at admission; never occupies a nonce slot, honest chain unharmed
 *   TF-05  THE NONCE LAW — same-nonce rivals: exactly one wins (by hash order); overdraft refused
 *          deterministically and its account's later acts defer, never corrupt
 *   TF-06  FORGED DIFF — one tampered diff line flips the root: verifyFold refuses
 *   TF-07  WITHHELD DIFF — one missing diff line flips the root: verifyFold refuses
 *   TF-08  CROSS-DOMAIN REPLAY — a journal x-send signature dies at the lane's door (own domain)
 *   TF-09  DEGENERATE ACTS — zero amount, self-send, unparseable amount: refused, state intact
 *   TF-10  THE CREATOR'S BOT — thousands of sends between 2 addresses fold to EXACTLY 2 balance
 *          diff lines: bytes scale per touched address, never per transfer
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, xSendMessage } from '../protocol/scheme.ts'
import { emptyLane, cloneLane, laneRoot, laneTotal, foldBreath, applyFoldDiffs, verifyFold, tkFoldSendMessage, foldDiffsHash, type LaneTransfer, type LaneState } from '../protocol/tk-fold.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('tk-fold|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B'), C = wallet('C'), D = wallet('D')

function signed(w: ReturnType<typeof wallet>, to: string, amount: bigint, nonce: number): LaneTransfer {
  const sig = _signKrayWallet(tkFoldSendMessage(NET, w.addr, to, amount, nonce), w.sk)
  return { from: w.addr, to, amount: amount.toString(), nonce, publicKey: w.pk, signature: sig, scheme: 'kraywallet' }
}
function seedLane(entries: Array<[string, bigint]>): LaneState {
  const s = emptyLane()
  for (const [a, b] of entries) s.balances.set(a, b)
  return s
}
/** deterministic shuffle — every permutation reproducible */
function shuffled<T>(arr: T[], seed: number): T[] {
  const a = [...arr]; let s = seed >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

function main() {
  console.log('\n╔═ THE TK-FOLD — total knowledge, folded: the lane\'s mathematics proven by breaking ═╗\n')

  console.log('TF-01 — PERMUTATION INVARIANCE: 40 transfers, 20 arrival orders, one truth')
  const pre1 = seedLane([[A.addr, 1000n], [B.addr, 1000n], [C.addr, 1000n], [D.addr, 1000n]])
  const ws = [A, B, C, D]
  const batch: LaneTransfer[] = []
  for (let i = 0; i < 40; i++) {
    const w = ws[i % 4], to = ws[(i + 1 + (i % 3)) % 4]
    batch.push(signed(w, to.addr === w.addr ? ws[(i + 2) % 4].addr : to.addr, BigInt(1 + (i % 7)), Math.floor(i / 4)))
  }
  const golden = foldBreath(NET, pre1, batch)
  let invariant = true
  for (let p = 1; p <= 20; p++) {
    const r = foldBreath(NET, pre1, shuffled(batch, 0xF01D + p))
    if (r.postRoot !== golden.postRoot || r.diffsHash !== golden.diffsHash
      || r.applied.length !== golden.applied.length) invariant = false
  }
  ok(invariant, `20 permutations → identical postRoot ${golden.postRoot.slice(0, 12)}… and diffsHash (${golden.applied.length} applied)`)
  ok(golden.preRoot !== golden.postRoot, 'the breath moved the root (value really moved)')

  console.log('\nTF-02 — THE RE-SYNC LAW: the diffs alone rebuild the exact state')
  const rebuilt = applyFoldDiffs(pre1, golden.diffs)
  ok(laneRoot(rebuilt) === golden.postRoot, 'applyFoldDiffs(pre, diffs) reaches the byte-identical post root — no transfer data needed')
  ok(verifyFold(pre1, golden.diffs, golden.postRoot), 'verifyFold accepts the honest breath')
  let balancesEqual = true
  for (const [a, b] of golden.state.balances) if ((rebuilt.balances.get(a) ?? 0n) !== b) balancesEqual = false
  ok(balancesEqual, 'every single balance re-derived exactly (the Creator\'s re-sync law)')

  console.log('\nTF-03 — CONSERVATION: Σ invariant under storm; refusals mutate nothing')
  ok(laneTotal(golden.state) === laneTotal(pre1), `Σ lane Ӿ unchanged (${laneTotal(pre1)})`)
  const preFrozen = cloneLane(pre1)
  foldBreath(NET, pre1, batch)
  ok(laneRoot(pre1) === laneRoot(preFrozen), 'the pre state is never mutated (pure function)')

  console.log('\nTF-04 — FORGED SIGNATURE: excluded at admission, nonce slot unharmed')
  const preF = seedLane([[A.addr, 100n], [B.addr, 100n]])
  const forged: LaneTransfer = { ...signed(A, B.addr, 50n, 0), signature: '00'.repeat(64) }
  const honest = signed(A, B.addr, 10n, 0)
  const rF = foldBreath(NET, preF, [forged, honest])
  ok(rF.refused.some((x) => /signature/.test(x.reason)) && rF.applied.length === 1, 'the forgery is refused; the honest act with the SAME nonce still lands')
  ok((rF.state.balances.get(B.addr) ?? 0n) === 110n, 'value moved only by the honest signature')

  console.log('\nTF-05 — THE NONCE LAW: same-nonce rivals collapse to one; overdraft defers the chain')
  const preN = seedLane([[A.addr, 100n], [B.addr, 0n], [C.addr, 0n]])
  const rival1 = signed(A, B.addr, 30n, 0), rival2 = signed(A, C.addr, 30n, 0)   // a true double-spend: two messages, one nonce
  const rN = foldBreath(NET, preN, [rival1, rival2])
  ok(rN.applied.length === 1 && rN.deferred.length === 1, 'exactly ONE same-nonce rival wins (hash order), the other defers — no double-spend')
  const preO = seedLane([[A.addr, 10n], [B.addr, 0n]])
  const over = signed(A, B.addr, 999n, 0), then = signed(A, B.addr, 5n, 1)
  const rO = foldBreath(NET, preO, [over, then])
  ok(rO.refused.some((x) => /insufficient/.test(x.reason)) && rO.deferred.includes(then), 'the overdraft is refused WITHOUT advancing the nonce; its successor defers deterministically')
  ok((rO.state.balances.get(A.addr) ?? 0n) === 10n, 'a refused breath leg mutates nothing')

  console.log('\nTF-06 — FORGED DIFF: one tampered line, the root refuses')
  const tampered = { balances: golden.diffs.balances.map(([a, b], i) => (i === 0 ? [a, (BigInt(b) + 1n).toString()] : [a, b]) as [string, string]), nonces: golden.diffs.nonces }
  ok(!verifyFold(pre1, tampered, golden.postRoot), 'a +1 forged balance diff is refused — the root sees everything')
  ok(foldDiffsHash(tampered) !== golden.diffsHash, 'the diffsHash public input also flips — a real proof could never cover it')

  console.log('\nTF-07 — WITHHELD DIFF: one missing line, the root refuses')
  const withheld = { balances: golden.diffs.balances.slice(1), nonces: golden.diffs.nonces }
  ok(!verifyFold(pre1, withheld, golden.postRoot), 'a withheld diff line is refused — omission is as loud as forgery')

  console.log('\nTF-08 — CROSS-DOMAIN REPLAY: a journal x-send signature dies at the lane door')
  const preX = seedLane([[A.addr, 100n], [B.addr, 0n]])
  const xsig = _signKrayWallet(xSendMessage(NET, A.addr, B.addr, 50n, 0), A.sk)   // valid for the JOURNAL lane
  const replay: LaneTransfer = { from: A.addr, to: B.addr, amount: '50', nonce: 0, publicKey: A.pk, signature: xsig, scheme: 'kraywallet' }
  const rX = foldBreath(NET, preX, [replay])
  ok(rX.applied.length === 0 && rX.refused.length === 1, 'the lane refuses a journal-domain signature — the domains never bleed')

  console.log('\nTF-09 — DEGENERATE ACTS: zero, self-send, garbage — refused, state intact')
  const preD = seedLane([[A.addr, 100n]])
  const rD = foldBreath(NET, preD, [
    signed(A, B.addr, 0n, 0),          // zero amount — refused at apply
    signed(A, A.addr, 5n, 1),          // self-send — refused at apply
    { from: A.addr, to: B.addr, amount: 'not-a-number', nonce: 2, publicKey: A.pk, signature: 'ff', scheme: 'kraywallet' },
  ])
  ok(rD.applied.length === 0 && rD.refused.length >= 2 && rD.preRoot === rD.postRoot, 'nothing degenerate lands; the root does not move')

  console.log('\nTF-11 — THE CANONICAL-DECIMAL LAW: encodings BigInt would accept, the lane refuses')
  const preC = seedLane([[A.addr, 100n]])
  const hostileAmounts = ['0x10', ' 5', '5 ', '+5', '007', '00', '', '5.0', (2n ** 128n).toString()]
  const hostile: LaneTransfer[] = hostileAmounts.map((amount, i) => ({
    from: A.addr, to: B.addr, amount, nonce: i, publicKey: A.pk, signature: '11'.repeat(64), scheme: 'kraywallet',
  }))
  hostile.push({ ...signed(A, B.addr, 5n, 0), nonce: -1 as number })
  hostile.push({ ...signed(A, B.addr, 5n, 0), nonce: 1.5 as number })
  hostile.push({ ...signed(A, B.addr, 5n, 0), nonce: 2 ** 60 })
  const rC = foldBreath(NET, preC, hostile)
  ok(rC.applied.length === 0 && rC.refused.length === hostile.length && rC.preRoot === rC.postRoot,
    `all ${hostile.length} hostile encodings refused at admission — one canonical form, two implementations, one verdict`)
  ok(rC.refused.every((x) => /canonical/.test(x.reason)), 'every refusal names the canonical law')

  console.log('\nTF-10 — THE CREATOR\'S BOT: 3,000 sends between 2 addresses = 2 balance diff lines')
  const preB = seedLane([[A.addr, 5000n], [B.addr, 5000n]])
  let state = preB
  let totalApplied = 0
  const allDiffBalances = new Set<string>()
  let chainOk = true
  for (let breath = 0; breath < 3; breath++) {                       // 3 breaths × 1,000 sends
    const acts: LaneTransfer[] = []
    for (let i = 0; i < 500; i++) {
      acts.push(signed(A, B.addr, 1n, (state.nonces.get(A.addr) ?? 0) + i))
      acts.push(signed(B, A.addr, 1n, (state.nonces.get(B.addr) ?? 0) + i))
    }
    const r = foldBreath(NET, state, acts)
    totalApplied += r.applied.length
    for (const [a] of r.diffs.balances) allDiffBalances.add(a)
    if (!verifyFold(state, r.diffs, r.postRoot)) chainOk = false
    if (r.diffs.balances.length !== 2) chainOk = false
    state = r.state
  }
  ok(totalApplied === 3000, `the bot landed all ${totalApplied} sends (feeless, in-lane)`) 
  ok(allDiffBalances.size === 2 && chainOk, 'EVERY breath folded to exactly 2 balance diff lines — bytes per touched address, never per transfer')
  ok(laneTotal(state) === 10000n, 'conservation held through 3,000 sends')

  console.log(`\n═ tk-fold-spec: ${pass} passed, ${fail} failed ═\n`)
  if (fail > 0) process.exit(1)
}
main()
