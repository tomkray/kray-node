/**
 * THE CLAIM ESCROW — one signed root, many proven hands, custody in a keyless pot.
 *
 *   node src/test/claim-escrow.test.ts
 *
 * The Creator's aim: everything a citizen earns inside KRAYVERSE becomes a token they can claim, proven in
 * the bytes. No mathematics can know that somebody watered a bed — so this proves everything around it: who
 * attested, what they attested, that the promise is covered by value that already left their hand, that a
 * proven hand cannot be refused, that nobody is paid twice or more than their leaf, and that what no hand
 * claimed returns only to the giver and only at the height they named.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, nameMessageV2, contractMessageV2, transferMessage } from '../protocol/scheme.ts'
import { claimRoot, claimProof, claimOpenMessage, claimTakeMessage, claimCloseMessage, CLAIM_ESCROW_SEQ, type ClaimShare } from '../protocol/claim-book.ts'
import type { PacketLane } from '../protocol/packet-market.ts'
import { canonicalCode } from '../protocol/contract.ts'
import { compileCut } from '../protocol/star-forms.ts'
import { sha256hex, TREASURY, CLAIM_POT, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const halts = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const s = (e as Error).message; ok(re.test(s), m + (re.test(s) ? '' : ' — wrong: ' + s)) }
}

interface W { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`claim-escrow|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)
const RUNE = '840000:7'
const runeId = { block: 840000n, tx: 7n }
const LUZ_STAR = '0'

const journal: KrayEvent[] = []
function push(L: KrayLedger, e: KrayEvent): void {
  const before = L.appliedSeq
  L.applyLive(e)
  if (L.appliedSeq === before) throw new Error(`test: the ${e.kind} was silently skipped (stale seq)`)
  journal.push(e)
}
const assetFields = (lane: PacketLane, asset: string): Record<string, unknown> =>
  lane === 'luz' ? { star: asset } : lane === 'rune' ? { runeId: asset } : {}

const openEv = (L: KrayLedger, w: W, lane: PacketLane, asset: string, total: bigint, root: string, expires = 0, twist?: { sign?: Partial<{ total: bigint; root: string; expires: number; lane: PacketLane }>; by?: W; wire?: Record<string, unknown> }): KrayEvent => {
  const nonce = L.nonceOf(w.addr), s = twist?.sign ?? {}, signer = twist?.by ?? w
  const msg = claimOpenMessage(NET, w.addr, s.lane ?? lane, asset, s.total ?? total, s.root ?? root, s.expires ?? expires, nonce)
  const e: Record<string, unknown> = {
    seq: L.appliedSeq + 1, kind: 'claim-open', hash: 'h' + (L.appliedSeq + 1), at: 1, from: w.addr, lane, ...assetFields(lane, asset),
    amount: total.toString(), claimRoot: root, fee: '1', nonce, publicKey: signer.pk, signature: sign(msg, signer), scheme: 'kraywallet',
  }
  if (expires) e.expires = expires
  Object.assign(e, twist?.wire ?? {})
  return e as unknown as KrayEvent
}
const takeEv = (L: KrayLedger, w: W, root: string, amount: bigint, proof: unknown, twist?: { sign?: Partial<{ root: string; amount: bigint }>; by?: W }): KrayEvent => {
  const nonce = L.nonceOf(w.addr), s = twist?.sign ?? {}, signer = twist?.by ?? w
  return {
    seq: L.appliedSeq + 1, kind: 'claim-take', hash: 'h' + (L.appliedSeq + 1), at: 1, from: w.addr,
    claimRoot: root, amount: amount.toString(), claimProof: proof, fee: '1', nonce,
    publicKey: signer.pk, signature: sign(claimTakeMessage(NET, w.addr, s.root ?? root, s.amount ?? amount, nonce), signer), scheme: 'kraywallet',
  } as unknown as KrayEvent
}
const closeEv = (L: KrayLedger, w: W, root: string, twist?: { by?: W }): KrayEvent => {
  const nonce = L.nonceOf(w.addr), signer = twist?.by ?? w
  return {
    seq: L.appliedSeq + 1, kind: 'claim-close', hash: 'h' + (L.appliedSeq + 1), at: 1, from: w.addr,
    claimRoot: root, fee: '1', nonce, publicKey: signer.pk, signature: sign(claimCloseMessage(NET, w.addr, root, nonce), signer), scheme: 'kraywallet',
  } as unknown as KrayEvent
}
const sealTo = (L: KrayLedger, h: number) => push(L, { seq: L.appliedSeq + 1, kind: 'seal', hash: 'seal' + h, at: 0, l1Txid: h.toString(16).padStart(64, '0'), l1Height: h, l1Root: L.cascadeRoot(), l1BlockNumber: 0 } as unknown as KrayEvent)

function main() {
  console.log('\n╔═ THE CLAIM ESCROW — one root, many proven hands, a keyless pot ══╗\n')
  const farmer = wallet('farmer'), ana = wallet('ana'), bo = wallet('bo'), cy = wallet('cy'), eve = wallet('eve')

  // ── 0 · an empty book folds NOWHERE (A3) ──
  const E = new KrayLedger(undefined, NET)
  ok(E.claims.empty() && E.cascadeParts().claimCommitment === undefined, '0 · an empty claim book folds nowhere — the field is absent (A3)')
  // Ratified 2026-09-21: signet at 231 (its tip 230, plus one), main still shut — a law is proven alive on
  // the test universe before it opens where a mistake costs somebody's real value.
  ok(CLAIM_ESCROW_SEQ.regtest === 0 && CLAIM_ESCROW_SEQ.signet === 231 && CLAIM_ESCROW_SEQ.main === 82,
    '0 · the pin is open on regtest, ratified on signet at 231 and on MAIN at 82 — after signet carried a harvest end to end, close included (A3)')

  const L = new KrayLedger(undefined, NET)
  let seq = 0
  const mint = (to: string, amt: string) => push(L, { seq: L.appliedSeq + 1, kind: 'donate', hash: 'd' + (++seq), at: seq, to, amount: amt, outpoint: createHash('sha256').update('o' + seq).digest('hex') + ':0' } as unknown as KrayEvent)
  mint(farmer.addr, '9000'); mint(ana.addr, '50'); mint(bo.addr, '50'); mint(cy.addr, '50'); mint(eve.addr, '50')

  // the harvest the land attested: three hands, three different shares
  const shares: ClaimShare[] = [{ to: ana.addr, amount: 120n }, { to: bo.addr, amount: 45n }, { to: cy.addr, amount: 5n }]
  const root = claimRoot(shares)
  const total = 170n
  const rootBefore = L.cascadeRoot(), farmer0 = L.balanceOf(farmer.addr), tre0 = L.balanceOf(TREASURY)

  // ── 1 · OPEN — the total LEAVES the giver's hand, into a pot no key can reach ──
  push(L, openEv(L, farmer, 'kray', '', total, root))
  ok(L.balanceOf(farmer.addr) === farmer0 - total - 1n, '1 · the whole harvest left the giver, and the eternal 1 ₭ with it')
  ok(L.balanceOf(CLAIM_POT) === total, '1 · and it rests in the keyless pot — this is what the word escrow promises')
  ok(L.balanceOf(TREASURY) === tre0 + 1n && L.conserves(), '1 · the validators got exactly one ₭, Σ conserved, the pot backed')
  ok(L.cascadeRoot() !== rootBefore && !!L.cascadeParts().claimCommitment, '1 · the open harvest folds into the cascade root')
  ok(L.claims.get(root)?.total === total && L.claims.get(root)?.paid === 0n, '1 · the book knows what it owes')
  halts(() => L.applyLive(openEv(L, farmer, 'kray', '', 10n, root)), /already open/, '1 · one root, one escrow — the same harvest cannot be opened twice')

  // ── 2 · NOBODY MAY FILL THE POT BUT THIS LAW ──
  {
    const nonce = L.nonceOf(farmer.addr)
    halts(() => L.applyLive({ seq: L.appliedSeq + 1, kind: 'transfer', hash: 'x', at: 1, from: farmer.addr, to: CLAIM_POT, amount: '5', fee: '1', nonce, publicKey: farmer.pk, signature: sign(transferMessage(NET, farmer.addr, CLAIM_POT, 5n, nonce), farmer), scheme: 'kraywallet' } as unknown as KrayEvent),
      /cannot credit the claim pot/, '2 · a transfer into the pot is refused — a lie in the pot would halt every node')
    ok(L.balanceOf(CLAIM_POT) === total && L.conserves(), '2 · and the pot is exactly what the book says, still')
  }

  // ── 3 · A PROVEN HAND TAKES ITS SHARE, ONCE ──
  const ana0 = L.balanceOf(ana.addr)
  push(L, takeEv(L, ana, root, 120n, claimProof(shares, 0)))
  ok(L.balanceOf(ana.addr) === ana0 + 120n - 1n, '3 · the proven hand received exactly its leaf, and paid the eternal gas')
  ok(L.balanceOf(CLAIM_POT) === total - 120n && L.conserves(), '3 · the pot paid exactly that, and the tripwire still holds')
  halts(() => L.applyLive(takeEv(L, ana, root, 120n, claimProof(shares, 0))), /already taken/, '3 · and that hand cannot take twice')

  // ── 4 · EVERY WAY OF NOT BEING IN THE ROOT ──
  halts(() => L.applyLive(takeEv(L, eve, root, 120n, claimProof(shares, 0))), /does not put your hand/, '4 · a stranger cannot borrow somebody else\'s proof')
  halts(() => L.applyLive(takeEv(L, bo, root, 46n, claimProof(shares, 1))), /does not put your hand/, '4 · nor take one ₭ more than their leaf')
  halts(() => L.applyLive(takeEv(L, bo, root, 44n, claimProof(shares, 1))), /does not put your hand/, '4 · nor one less (the leaf is the exact pair, not a ceiling)')
  halts(() => L.applyLive(takeEv(L, bo, root, 45n, claimProof(shares, 2))), /does not put your hand/, '4 · nor climb by another leaf\'s path')
  halts(() => L.applyLive(takeEv(L, bo, root, 45n, [])), /does not put your hand/, '4 · nor with no path at all')
  {
    const tampered = claimProof(shares, 1).map((s, i) => (i === 0 ? { ...s, hash: 'f'.repeat(64) } : s))
    halts(() => L.applyLive(takeEv(L, bo, root, 45n, tampered)), /does not put your hand/, '4 · a tampered path simply fails to rebuild the root')
    const flipped = claimProof(shares, 1).map((s, i) => (i === 0 ? { ...s, siblingIsRight: !s.siblingIsRight } : s))
    halts(() => L.applyLive(takeEv(L, bo, root, 45n, flipped)), /does not put your hand/, '4 · and so does a path walked on the wrong side')
    halts(() => L.applyLive(takeEv(L, bo, root, 45n, Array.from({ length: 41 }, () => ({ hash: 'a'.repeat(64), siblingIsRight: true })))), /at most 40 steps/, '4 · an endless path is refused before it is walked')
    halts(() => L.applyLive(takeEv(L, bo, 'b'.repeat(64), 45n, claimProof(shares, 1))), /no harvest is open/, '4 · and a root nobody opened holds nothing')
  }
  halts(() => L.applyLive(takeEv(L, bo, root, 45n, claimProof(shares, 1), { sign: { amount: 1n } })), /signature|verify|mirror/i, '4 · a share signed smaller than the one taken is refused')
  halts(() => L.applyLive(takeEv(L, bo, root, 45n, claimProof(shares, 1), { by: eve })), /signature|verify|key/i, '4 · and a forged signature never reaches the proof')

  // ── 5 · THE REST OF THE HANDS, AND AN EMPTY POT ──
  const bo0 = L.balanceOf(bo.addr), cy0 = L.balanceOf(cy.addr)
  push(L, takeEv(L, bo, root, 45n, claimProof(shares, 1)))
  push(L, takeEv(L, cy, root, 5n, claimProof(shares, 2)))
  ok(L.balanceOf(bo.addr) === bo0 + 45n - 1n && L.balanceOf(cy.addr) === cy0 + 5n - 1n, '5 · each hand took its own share, and no other')
  ok(L.balanceOf(CLAIM_POT) === 0n && L.claims.get(root)?.paid === total, '5 · the harvest is fully claimed and the pot is empty')
  ok(L.conserves(), '5 · Σ conserved across the whole harvest')

  // ── 6 · A HARVEST WITH NO HEIGHT IS A GIFT FOREVER ──
  halts(() => L.applyLive(closeEv(L, farmer, root)), /named no closing height/, '6 · the giver cannot take back a harvest they left open-ended')

  // ── 7 · THE CLOSING HEIGHT — only the giver, only at the height they named ──
  const shares2: ClaimShare[] = [{ to: ana.addr, amount: 60n }, { to: bo.addr, amount: 40n }]
  const root2 = claimRoot(shares2)
  push(L, openEv(L, farmer, 'kray', '', 100n, root2, 900_000))
  halts(() => L.applyLive(closeEv(L, eve, root2)), /only the hand that opened/, '7 · a stranger cannot close somebody else\'s harvest')
  halts(() => L.applyLive(closeEv(L, farmer, root2)), /closes at Bitcoin height/, '7 · nor the giver, before the height they named')
  push(L, takeEv(L, ana, root2, 60n, claimProof(shares2, 0)))
  sealTo(L, 899_999)
  halts(() => L.applyLive(closeEv(L, farmer, root2)), /closes at Bitcoin height/, '7 · one block short, and it is still the hands\'')
  sealTo(L, 900_000)
  const farmerBefore = L.balanceOf(farmer.addr)
  push(L, closeEv(L, farmer, root2))
  ok(L.balanceOf(farmer.addr) === farmerBefore + 40n - 1n, '7 · at the height, exactly what NO hand claimed comes back')
  ok(L.balanceOf(CLAIM_POT) === 0n && !L.claims.get(root2) && L.conserves(), '7 · the pot is empty, the book is closed, Σ conserved')
  halts(() => L.applyLive(takeEv(L, bo, root2, 40n, claimProof(shares2, 1))), /no harvest is open/, '7 · and the hand that slept finds nothing — the height was the warning')

  // ── 8 · THE OTHER TWO LANES ──
  push(L, { seq: L.appliedSeq + 1, kind: 'name', hash: 'nm', at: 1, from: farmer.addr, name: 'harvest', nonce: L.nonceOf(farmer.addr), publicKey: farmer.pk, signature: sign(nameMessageV2(NET, farmer.addr, L.nonceOf(farmer.addr), 'harvest'), farmer), scheme: 'kraywallet' } as unknown as KrayEvent)
  const paper = compileCut({ supply: '100000' })
  push(L, { seq: L.appliedSeq + 1, kind: 'contract', hash: 'ct', at: 1, from: farmer.addr, code: paper, star: LUZ_STAR, nonce: L.nonceOf(farmer.addr), publicKey: farmer.pk, signature: sign(contractMessageV2(NET, farmer.addr, sha256hex(canonicalCode(paper)), 0n), farmer), scheme: 'kraywallet' } as unknown as KrayEvent)
  {
    // Luz — the tomato of the farm: a star's own light, claimed by the hands that grew it
    const luz: ClaimShare[] = [{ to: ana.addr, amount: 2500n }, { to: bo.addr, amount: 1500n }]
    const luzRoot = claimRoot(luz)
    const farmerLuz = L.cuts.of(LUZ_STAR, farmer.addr)
    push(L, openEv(L, farmer, 'luz', LUZ_STAR, 4000n, luzRoot))
    ok(L.cuts.of(LUZ_STAR, farmer.addr) === farmerLuz - 4000n && L.cuts.of(LUZ_STAR, CLAIM_POT) === 4000n, '8 · a Luz harvest rests in the same keyless pot')
    push(L, takeEv(L, ana, luzRoot, 2500n, claimProof(luz, 0)))
    ok(L.cuts.of(LUZ_STAR, ana.addr) === 2500n && L.cuts.conserves() && L.conserves(), '8 · and a proven hand carries its light away')
    push(L, takeEv(L, bo, luzRoot, 1500n, claimProof(luz, 1)))
    ok(L.cuts.of(LUZ_STAR, CLAIM_POT) === 0n && L.claims.empty() === false, '8 · the Luz pot empties exactly')
  }
  {
    L.runes.deposit(runeId, 'aa'.repeat(32) + ':0', 9000n, farmer.addr, { pool: true })
    const rn: ClaimShare[] = [{ to: cy.addr, amount: 800n }]
    const rnRoot = claimRoot(rn)
    push(L, openEv(L, farmer, 'rune', RUNE, 800n, rnRoot))
    ok(L.runes.balanceOf(runeId, CLAIM_POT) === 800n, '8 · a rune harvest rests there too')
    push(L, takeEv(L, cy, rnRoot, 800n, claimProof(rn, 0)))
    ok(L.runes.balanceOf(runeId, cy.addr) === 800n && L.runes.solvent() && L.conserves(), '8 · and the rune book stays solvent through the claim')
  }

  // ── 9 · WHAT THE GIVER CANNOT DO ──
  halts(() => L.applyLive(openEv(L, farmer, 'kray', '', 1_000_000n, 'c'.repeat(64))), /do not hold that harvest/, '9 · promising what you have not got is refused')
  halts(() => L.applyLive(openEv(L, farmer, 'kray', '', 10n, 'not-a-root')), /merkle root/, '9 · a harvest needs a real root')
  halts(() => L.applyLive(openEv(L, farmer, 'kray', '', 0n, 'd'.repeat(64))), /positive total/, '9 · a harvest of nothing is refused')
  halts(() => L.applyLive(openEv(L, farmer, 'kray', '', 10n, 'e'.repeat(64), 21_000_001)), /Bitcoin height/, '9 · and a closing height Bitcoin will never reach')
  {
    const potW: W = { ...farmer, addr: CLAIM_POT }
    halts(() => L.applyLive(openEv(L, potW, 'kray', '', 1n, 'f'.repeat(64))), /protocol pot|signature|verify|key/i, '9 · the pot cannot open a harvest for itself')
  }

  // ── 10 · BELOW THE PIN, THE ESCROW DOES NOT EXIST ──
  {
    const O = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, Number.MAX_SAFE_INTEGER)
    let s2 = 0
    O.applyLive({ seq: ++s2, kind: 'donate', hash: 'p1', at: s2, to: farmer.addr, amount: '100', outpoint: 'dd'.repeat(32) + ':0' } as unknown as KrayEvent)
    const before = O.cascadeRoot(), nonce = O.nonceOf(farmer.addr)
    halts(() => O.applyLive({ seq: ++s2, kind: 'claim-open', hash: 'p2', at: s2, from: farmer.addr, lane: 'kray', amount: '10', claimRoot: 'a'.repeat(64), fee: '1', nonce, publicKey: farmer.pk, signature: sign(claimOpenMessage(NET, farmer.addr, 'kray', '', 10n, 'a'.repeat(64), 0, nonce), farmer), scheme: 'kraywallet' } as unknown as KrayEvent),
      /not the law on this network yet/, '10 · below the pin a harvest cannot be opened')
    ok(O.cascadeRoot() === before && O.claims.empty() && O.conserves(), '10 · and nothing moved, so no era forks (A3)')
  }

  // ── 11 · THE REPLAY TWIN — a stranger re-derives the same world, pot and all ──
  {
    const R = new KrayLedger(undefined, NET)
    R.runes.deposit(runeId, 'aa'.repeat(32) + ':0', 9000n, farmer.addr, { pool: true })
    for (const e of journal) R.applyLive(e)
    ok(R.cascadeRoot() === L.cascadeRoot(), '11 · a stranger replays the journal and reaches the SAME cascade root')
    ok(R.claims.commitment() === L.claims.commitment(), '11 · and the identical claim book, with the chain of hands that took')
    ok(R.balanceOf(CLAIM_POT) === L.balanceOf(CLAIM_POT) && R.conserves() && R.claimsBacked(), '11 · the pot, the tripwire and Σ all agree on the rebuilt node')
  }

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — a harvest is attested once and taken only by the hands inside it. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
