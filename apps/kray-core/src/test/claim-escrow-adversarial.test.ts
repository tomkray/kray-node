/**
 * THE CLAIM ESCROW — adversarial + swarm. Prove by breaking.
 *
 *   node src/test/claim-escrow-adversarial.test.ts
 *
 * A harvest holds real value in a keyless pot, and its only door is a merkle proof. So this attacks the
 * proof itself (borrowed, tampered, flipped, truncated, padded, duplicated, second-preimage), the signature
 * around it (forged, cross-network, replayed, re-rooted), the pot (credited, signed, drained, over-paid),
 * the close (wrong hand, too early, twice) — and then storms all of it with seeded crowds.
 *
 * THE BAR: an accepted act pays exactly one leaf to exactly that hand, once; a refused act leaves the books,
 * the balances, the pot and the root byte-identical; and after every single act the pot holds EXACTLY what
 * the open harvests still owe (A1: conservation or HALT).
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage } from '../protocol/scheme.ts'
import { claimRoot, claimProof, claimProves, claimLeaf, claimOpenMessage, claimTakeMessage, claimCloseMessage, CLAIM_MAX_PROOF, type ClaimShare } from '../protocol/claim-book.ts'
import { TREASURY, CLAIM_POT, BLACK_HOLE, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

interface W { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`claim-adv|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)

function openEv(L: KrayLedger, w: W, total: bigint, root: string, expires = 0, twist?: {
  sign?: Partial<{ total: bigint; root: string; expires: number; net: string; from: string }>
  wire?: Record<string, unknown>; by?: W; fee?: string
}): KrayEvent {
  const nonce = L.nonceOf(w.addr), s = twist?.sign ?? {}, signer = twist?.by ?? w
  const msg = claimOpenMessage(s.net ?? NET, s.from ?? w.addr, 'kray', '', s.total ?? total, s.root ?? root, s.expires ?? expires, nonce)
  const e: Record<string, unknown> = {
    seq: L.appliedSeq + 1, kind: 'claim-open', hash: 'o' + L.appliedSeq, at: 1, from: w.addr, lane: 'kray',
    amount: total.toString(), claimRoot: root, fee: twist?.fee ?? '1', nonce, publicKey: signer.pk, signature: sign(msg, signer), scheme: 'kraywallet',
  }
  if (expires) e.expires = expires
  Object.assign(e, twist?.wire ?? {})
  return e as unknown as KrayEvent
}
function takeEv(L: KrayLedger, w: W, root: string, amount: bigint, proof: unknown, twist?: {
  sign?: Partial<{ root: string; amount: bigint; net: string }>; by?: W; fee?: string; nonce?: number; wire?: Record<string, unknown>
}): KrayEvent {
  const nonce = twist?.nonce ?? L.nonceOf(w.addr), s = twist?.sign ?? {}, signer = twist?.by ?? w
  const e: Record<string, unknown> = {
    seq: L.appliedSeq + 1, kind: 'claim-take', hash: 't' + L.appliedSeq, at: 1, from: w.addr,
    claimRoot: root, amount: amount.toString(), claimProof: proof, fee: twist?.fee ?? '1', nonce,
    publicKey: signer.pk, signature: sign(claimTakeMessage(s.net ?? NET, w.addr, s.root ?? root, s.amount ?? amount, nonce), signer), scheme: 'kraywallet',
  }
  Object.assign(e, twist?.wire ?? {})
  return e as unknown as KrayEvent
}
const closeEv = (L: KrayLedger, w: W, root: string, twist?: { by?: W }): KrayEvent => ({
  seq: L.appliedSeq + 1, kind: 'claim-close', hash: 'c' + L.appliedSeq, at: 1, from: w.addr, claimRoot: root, fee: '1',
  nonce: L.nonceOf(w.addr), publicKey: (twist?.by ?? w).pk, signature: sign(claimCloseMessage(NET, w.addr, root, L.nonceOf(w.addr)), twist?.by ?? w), scheme: 'kraywallet',
} as unknown as KrayEvent)
const sealTo = (L: KrayLedger, h: number) => L.applyLive({ seq: L.appliedSeq + 1, kind: 'seal', hash: 's' + h, at: 0, l1Txid: h.toString(16).padStart(64, '0'), l1Height: h, l1Root: L.cascadeRoot(), l1BlockNumber: 0 } as unknown as KrayEvent)

function main() {
  console.log('\n╔═ THE CLAIM ESCROW — adversarial · the proof, the pot, the close ══╗\n')
  const giver = wallet('giver'), a = wallet('a'), b = wallet('b'), c = wallet('c'), eve = wallet('eve')

  const L = new KrayLedger(undefined, NET)
  const journal: KrayEvent[] = []
  const push = (e: KrayEvent) => { const at = L.appliedSeq; L.applyLive(e); if (L.appliedSeq === at) throw new Error('test: silently skipped'); journal.push(e) }
  const snap = () => JSON.stringify({
    root: L.cascadeRoot(), claims: L.claims.commitment(), pot: L.balanceOf(CLAIM_POT).toString(),
    bal: [giver, a, b, c, eve].map((w) => L.balanceOf(w.addr).toString()), tre: L.balanceOf(TREASURY).toString(),
  })
  const attack = (build: () => KrayEvent, re: RegExp, m: string) => {
    const before = snap()
    let e: KrayEvent
    try { e = build() } catch (err) { ok(re.test((err as Error).message), m + ' (refused while building)'); return }
    const at = L.appliedSeq
    try {
      L.applyLive(e)
      ok(false, m + (L.appliedSeq === at ? ' — the ledger SKIPPED it (stale seq)' : ' — DID NOT throw'))
    } catch (err) {
      const msg = (err as Error).message
      ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong: ' + msg))
      ok(snap() === before && L.conserves() && L.claimsBacked(), m + ' — and the world is byte-identical, the pot still backed')
    }
  }
  let n = 0
  const mint = (to: string, amt: string) => push({ seq: L.appliedSeq + 1, kind: 'donate', hash: 'd' + (++n), at: n, to, amount: amt, outpoint: createHash('sha256').update('o' + n).digest('hex') + ':0' } as unknown as KrayEvent)
  for (const w of [giver, a, b, c, eve]) mint(w.addr, '9000')

  const shares: ClaimShare[] = [{ to: a.addr, amount: 120n }, { to: b.addr, amount: 45n }, { to: c.addr, amount: 5n }]
  const root = claimRoot(shares)
  push(openEv(L, giver, 170n, root))

  // ── 1 · THE PROOF ──────────────────────────────────────────────────────────────────────────────
  console.log('\n─ 1 · the proof: borrowed · tampered · flipped · truncated · padded ─')
  attack(() => takeEv(L, eve, root, 120n, claimProof(shares, 0)), /does not put your hand/, '1 · a stranger with a real path')
  attack(() => takeEv(L, a, root, 121n, claimProof(shares, 0)), /does not put your hand/, '1 · the right hand, one unit too much')
  attack(() => takeEv(L, a, root, 119n, claimProof(shares, 0)), /does not put your hand/, '1 · the right hand, one unit too little')
  attack(() => takeEv(L, a, root, 120n, claimProof(shares, 0).slice(1)), /does not put your hand/, '1 · a path with a step cut out')
  attack(() => takeEv(L, a, root, 120n, [...claimProof(shares, 0), { hash: 'a'.repeat(64), siblingIsRight: true }]), /does not put your hand/, '1 · a path with a step added')
  attack(() => takeEv(L, a, root, 120n, claimProof(shares, 0).reverse()), /does not put your hand/, '1 · a path walked backwards')
  attack(() => takeEv(L, a, root, 120n, claimProof(shares, 0).map((s) => ({ ...s, siblingIsRight: !s.siblingIsRight }))), /does not put your hand/, '1 · every step on the wrong side')
  attack(() => takeEv(L, a, root, 120n, [{ hash: 'not hex', siblingIsRight: true }]), /does not put your hand|32 bytes|hex/i, '1 · a step that is not a hash')
  attack(() => takeEv(L, a, root, 120n, 'a string, not a path'), /does not put your hand/, '1 · a path that is not even a list')
  attack(() => takeEv(L, a, root, 120n, Array.from({ length: CLAIM_MAX_PROOF + 1 }, () => ({ hash: 'a'.repeat(64), siblingIsRight: true }))), /at most/, '1 · a path longer than any honest tree')
  {
    // THE CLASSIC MERKLE FORGERY: pass an INNER node off as a leaf. `block.ts` prefixes a leaf with \x00 and
    // a node with \x01, so the two hash spaces never meet — the forgery cannot even be constructed.
    const inner = createHash('sha256').update('\x01' + 'a'.repeat(64) + 'b'.repeat(64), 'utf8').digest('hex')
    const asLeaf = createHash('sha256').update('\x00' + claimLeaf(a.addr, 120n), 'utf8').digest('hex')
    ok(inner !== asLeaf, '1 · an inner node and a leaf can never be the same hash — the tree is domain-separated')
  }

  {
    // THE DUPLICATED-LEAF AMBIGUITY (the old Bitcoin CVE). An odd level duplicates its last hash, so the
    // list [a,b,c] and the list [a,b,c,c] have the SAME root — a forger can always present the longer one.
    // It buys nothing here: the extra leaf is the SAME hand and the SAME amount, and a hand takes once.
    const padded: ClaimShare[] = [...shares, shares[2]!]
    ok(claimRoot(padded) === root, '1 · a duplicated last leaf gives the identical root (the old Bitcoin ambiguity is real)')
    ok(claimProves(root, c.addr, 5n, claimProof(padded, 3)), '1 · and the duplicate proves, exactly as the original does')
    ok(!claimProves(root, eve.addr, 5n, claimProof(padded, 3)), '1 · but it is still THAT hand and no other — the ambiguity carries no new name')
  }

  // ── 2 · THE SIGNATURE AROUND IT ────────────────────────────────────────────────────────────────
  console.log('\n─ 2 · the signature: forged · re-rooted · re-priced · cross-network · replayed ─')
  attack(() => takeEv(L, a, root, 120n, claimProof(shares, 0), { by: eve }), /signature|verify|key/i, '2 · a forged taker')
  attack(() => takeEv(L, a, root, 120n, claimProof(shares, 0), { sign: { root: 'b'.repeat(64) } }), /signature|verify|mirror/i, '2 · a take signed against another root')
  attack(() => takeEv(L, a, root, 120n, claimProof(shares, 0), { sign: { amount: 1n } }), /signature|verify|mirror/i, '2 · a share signed smaller than the one taken')
  attack(() => takeEv(L, a, root, 120n, claimProof(shares, 0), { sign: { net: 'main' } }), /signature|verify|mirror/i, '2 · a take signed for another network')
  attack(() => takeEv(L, a, root, 120n, claimProof(shares, 0), { fee: '2' }), /eternal 1-₭ fee/, '2 · an inflated fee')
  attack(() => openEv(L, giver, 10n, 'c'.repeat(64), 0, { sign: { total: 1n } }), /signature|verify|mirror/i, '2 · a harvest signed smaller than the one opened')
  attack(() => openEv(L, giver, 10n, 'c'.repeat(64), 0, { sign: { root: 'd'.repeat(64) } }), /signature|verify|mirror/i, '2 · a harvest signed against another root')
  attack(() => openEv(L, giver, 10n, 'c'.repeat(64), 900_000, { wire: { expires: 800_000 } }), /signature|verify|mirror/i, '2 · a closing height rewritten by a relay')
  attack(() => openEv(L, giver, 10n, 'c'.repeat(64), 0, { wire: { expires: 900_000 } }), /signature|verify|mirror/i, '2 · or added by one')

  // ── 3 · THE POT ────────────────────────────────────────────────────────────────────────────────
  console.log('\n─ 3 · the pot: credited · signed · drained ─')
  {
    const nonce = L.nonceOf(giver.addr)
    attack(() => ({ seq: L.appliedSeq + 1, kind: 'transfer', hash: 'x1', at: 1, from: giver.addr, to: CLAIM_POT, amount: '5', fee: '1', nonce, publicKey: giver.pk, signature: sign(transferMessage(NET, giver.addr, CLAIM_POT, 5n, nonce), giver), scheme: 'kraywallet' } as unknown as KrayEvent),
      /cannot credit the claim pot/, '3 · nobody may put ₭ into the pot but a signed claim-open')
    const potW: W = { ...giver, addr: CLAIM_POT }
    attack(() => takeEv(L, potW, root, 120n, claimProof(shares, 0)), /protocol pot|signature|verify|key/i, '3 · the pot cannot take a share')
    attack(() => openEv(L, potW, 1n, 'e'.repeat(64)), /protocol pot|signature|verify|key/i, '3 · nor open a harvest of its own')
    attack(() => closeEv(L, potW, root), /only the hand that opened|protocol pot|signature|verify|key/i, '3 · nor close one')
  }

  // ── 4 · THE HANDS, IN ORDER ────────────────────────────────────────────────────────────────────
  console.log('\n─ 4 · the hands: once each, never more than the harvest ─')
  push(takeEv(L, a, root, 120n, claimProof(shares, 0)))
  ok(L.balanceOf(CLAIM_POT) === 50n && L.claims.get(root)?.paid === 120n && L.claimsBacked(), '4 · the first hand took its leaf and the pot owes the rest')
  attack(() => takeEv(L, a, root, 120n, claimProof(shares, 0)), /already taken/, '4 · and cannot come back')
  attack(() => takeEv(L, a, root, 120n, claimProof(shares, 0), { nonce: L.nonceOf(a.addr) - 1 }), /nonce|already taken/i, '4 · nor replay the winning act')
  push(takeEv(L, b, root, 45n, claimProof(shares, 1)))
  push(takeEv(L, c, root, 5n, claimProof(shares, 2)))
  ok(L.balanceOf(CLAIM_POT) === 0n && L.claims.get(root)?.paid === 170n && L.conserves(), '4 · the harvest is exactly spent, to the unit')
  attack(() => closeEv(L, giver, root), /named no closing height/, '4 · and an open-ended harvest is never the giver\'s again')

  // ── 5 · A HARVEST THAT PROMISES MORE THAN IT HOLDS ─────────────────────────────────────────────
  console.log('\n─ 5 · a harvest that promises more than it holds ─')
  {
    // The root says 200; the giver escrows only 60. The law pays leaves until the escrow is gone and
    // refuses the rest — it can never pay from another harvest's pot, nor from the giver's own hand.
    const big: ClaimShare[] = [{ to: a.addr, amount: 150n }, { to: b.addr, amount: 50n }]
    const shortRoot = claimRoot(big)
    push(openEv(L, giver, 60n, shortRoot))
    attack(() => takeEv(L, a, shortRoot, 150n, claimProof(big, 0)), /cannot pay more than it holds/, '5 · a leaf bigger than the whole escrow is refused')
    push(takeEv(L, b, shortRoot, 50n, claimProof(big, 1)))
    ok(L.balanceOf(CLAIM_POT) === 10n && L.claimsBacked(), '5 · the hand that fitted was paid, and the pot holds exactly the remainder')
    attack(() => takeEv(L, a, shortRoot, 150n, claimProof(big, 0)), /cannot pay more than it holds/, '5 · the hand that did not fit is refused, not half-paid')
  }

  // ── 6 · THE CLOSE ──────────────────────────────────────────────────────────────────────────────
  console.log('\n─ 6 · the close: wrong hand · too early · twice ─')
  {
    const late: ClaimShare[] = [{ to: a.addr, amount: 30n }]
    const lateRoot = claimRoot(late)
    push(openEv(L, giver, 30n, lateRoot, 800_000))
    attack(() => closeEv(L, eve, lateRoot), /only the hand that opened/, '6 · a stranger cannot close it')
    attack(() => closeEv(L, giver, lateRoot), /closes at Bitcoin height/, '6 · nor the giver, one block early')
    sealTo(L, 800_000)
    const g0 = L.balanceOf(giver.addr)
    push(closeEv(L, giver, lateRoot))
    ok(L.balanceOf(giver.addr) === g0 + 30n - 1n && L.claimsBacked(), '6 · at the height, what no hand took comes back')
    attack(() => closeEv(L, giver, lateRoot), /no harvest is open/, '6 · and it cannot be closed twice')
    attack(() => takeEv(L, a, lateRoot, 30n, claimProof(late, 0)), /no harvest is open/, '6 · the sleeping hand finds nothing')
  }

  // ── 7 · THE SWARM ──────────────────────────────────────────────────────────────────────────────
  console.log('\n─ 7 · the swarm: 3 seeds × 5 harvests × many hands ─')
  for (const seed of [13, 61, 151]) {
    const S = new KrayLedger(undefined, NET)
    const sJournal: KrayEvent[] = []
    const apply = (e: KrayEvent): boolean => {
      const at = S.appliedSeq, root0 = S.cascadeRoot()
      try {
        S.applyLive(e)
        if (S.appliedSeq === at) { ok(false, `seed ${seed}: an act was silently skipped`); return false }
        sJournal.push(e); return true
      } catch { if (S.cascadeRoot() !== root0) ok(false, `seed ${seed}: a REFUSED act moved the root`); return false }
    }
    let m = 0
    const crowd = ['g', 'h', 'i', 'j', 'k', 'l'].map((t) => wallet(`sw-${seed}-${t}`))
    for (const w of crowd) apply({ seq: S.appliedSeq + 1, kind: 'donate', hash: `sd${seed}-${++m}`, at: m, to: w.addr, amount: '8000', outpoint: createHash('sha256').update(`sd${seed}-${m}`).digest('hex') + ':0' } as unknown as KrayEvent)
    let state = seed * 7919
    const rnd = (n2: number): number => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state % n2 }
    const live: Array<{ root: string; shares: ClaimShare[]; giver: W; taken: Set<string> }> = []
    let opened = 0, taken = 0, refused = 0, skipped = 0
    for (let step = 0; step < 500; step++) {
      const move = rnd(10)
      if (move < 3 || !live.length) {
        const g = crowd[rnd(crowd.length)]!
        const hands = 1 + rnd(4)
        const picked = Array.from({ length: hands }, (_, i) => crowd[(rnd(crowd.length) + i) % crowd.length]!)
        const uniq = [...new Map(picked.map((w) => [w.addr, w])).values()].filter((w) => w.addr !== g.addr)
        if (!uniq.length) { skipped++; continue }
        const sh: ClaimShare[] = uniq.map((w) => ({ to: w.addr, amount: BigInt(1 + rnd(400)) }))
        const total = sh.reduce((t, s) => t + s.amount, 0n)
        const r = claimRoot(sh)
        if (S.claims.get(r) || S.balanceOf(g.addr) < total + 1n) { skipped++; continue }
        if (apply(openEv(S, g, total, r, rnd(3) === 0 ? 700_000 : 0))) { opened++; live.push({ root: r, shares: sh, giver: g, taken: new Set() }) }
        else refused++
      } else if (move < 9) {
        // Bias the storm at the path that matters: most of the time reach for a hand that has NOT taken,
        // so the escrow is really exercised; the rest of the time reach anywhere, and be refused.
        const withRoom = live.filter((x) => x.shares.some((sh2) => !x.taken.has(sh2.to)))
        const h = (rnd(5) === 0 || !withRoom.length) ? live[rnd(live.length)]! : withRoom[rnd(withRoom.length)]!
        const openIdx = h.shares.map((sh2, i) => (h.taken.has(sh2.to) ? -1 : i)).filter((i) => i >= 0)
        const idx = (rnd(5) === 0 || !openIdx.length) ? rnd(h.shares.length) : openIdx[rnd(openIdx.length)]!
        const share = h.shares[idx]!
        const who = crowd.find((w) => w.addr === share.to)!
        const potBefore = S.balanceOf(CLAIM_POT), hisBefore = S.balanceOf(who.addr)
        const already = h.taken.has(share.to)
        if (apply(takeEv(S, who, h.root, share.amount, claimProof(h.shares, idx)))) {
          taken++; h.taken.add(share.to)
          ok(!already, `seed ${seed}: a hand never took twice`)
          ok(S.balanceOf(who.addr) === hisBefore + share.amount - 1n, `seed ${seed}: it received exactly its leaf`)
          ok(S.balanceOf(CLAIM_POT) === potBefore - share.amount, `seed ${seed}: and the pot paid exactly that`)
        } else refused++
      } else {
        const h = live[rnd(live.length)]!
        if (apply(closeEv(S, h.giver, h.root))) { live.splice(live.indexOf(h), 1) } else refused++
      }
      if (!S.conserves() || !S.claimsBacked()) { ok(false, `seed ${seed} step ${step}: the pot or Σ broke`); break }
    }
    // the clock moves and every closeable harvest goes home — THROUGH the journal, or the replay twin
    // would never learn what time it is and would refuse every close the live node accepted
    apply({ seq: S.appliedSeq + 1, kind: 'seal', hash: `ss${seed}`, at: 0, l1Txid: (700_000).toString(16).padStart(64, '0'), l1Height: 700_000, l1Root: S.cascadeRoot(), l1BlockNumber: 0 } as unknown as KrayEvent)
    for (const h of [...live]) if (apply(closeEv(S, h.giver, h.root))) live.splice(live.indexOf(h), 1)
    ok(S.conserves() && S.claimsBacked(), `seed ${seed}: ${opened} harvests, ${taken} hands, ${refused} refused, ${skipped} skipped — the pot holds exactly what is owed`)
    ok(opened > 0 && taken > 0, `seed ${seed}: the storm really exercised the escrow (${taken} claims)`)
    const twin = new KrayLedger(undefined, NET)
    for (const e of sJournal) twin.applyLive(e)
    ok(twin.cascadeRoot() === S.cascadeRoot(), `seed ${seed}: a replay twin reaches the SAME cascade root`)
    ok(twin.claims.commitment() === S.claims.commitment() && twin.balanceOf(CLAIM_POT) === S.balanceOf(CLAIM_POT), `seed ${seed}: and the identical book and pot`)
  }

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the proof, the pot and the close held every hand. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
