/**
 * THE STANDING POOL — adversarial + swarm. Prove by breaking.
 *
 *   node src/test/claim-pool-adversarial.test.ts
 *
 * A pool holds a whole supply, so its three numbers ARE the promise: held, committed, free. This attacks
 * every way of making one of them lie — over-committing, double-drawing, draining what a season still
 * needs, shortening a horizon, draining somebody else's pool, paying a season twice out of one commitment —
 * and then storms it with seeded crowds of owners, epochs and hands.
 *
 * THE BAR: after every single act the keyless pot holds EXACTLY what both books say, every pool's committed
 * equals what its live seasons still owe, and a refused act leaves the world byte-identical.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage } from '../protocol/scheme.ts'
import { claimRoot, claimProof, claimTakeMessage, claimCloseMessage, type ClaimShare } from '../protocol/claim-book.ts'
import { poolFundMessage, poolSeasonMessage, poolCloseMessage } from '../protocol/pool-book.ts'
import { TREASURY, CLAIM_POT, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
interface W { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`pool-adv|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)

function fundEv(L: KrayLedger, w: W, amount: bigint, expires: number, twist?: { sign?: Partial<{ amount: bigint; expires: number }>; by?: W; fee?: string; wire?: Record<string, unknown> }): KrayEvent {
  const nonce = L.nonceOf(w.addr), s = twist?.sign ?? {}, signer = twist?.by ?? w
  const e: Record<string, unknown> = {
    seq: L.appliedSeq + 1, kind: 'pool-fund', hash: 'f' + L.appliedSeq, at: 1, from: w.addr, lane: 'kray',
    amount: amount.toString(), fee: twist?.fee ?? '1', nonce, publicKey: signer.pk,
    signature: sign(poolFundMessage(NET, w.addr, 'kray', '', s.amount ?? amount, s.expires ?? expires, nonce), signer), scheme: 'kraywallet',
  }
  if (expires) e.expires = expires
  Object.assign(e, twist?.wire ?? {})
  return e as unknown as KrayEvent
}
function seasonEv(L: KrayLedger, w: W, ceiling: bigint, root: string, expires: number, twist?: { sign?: Partial<{ ceiling: bigint; root: string }>; by?: W; fee?: string }): KrayEvent {
  const nonce = L.nonceOf(w.addr), s = twist?.sign ?? {}, signer = twist?.by ?? w
  const e: Record<string, unknown> = {
    seq: L.appliedSeq + 1, kind: 'pool-season', hash: 's' + L.appliedSeq, at: 1, from: w.addr, lane: 'kray',
    amount: ceiling.toString(), claimRoot: root, fee: twist?.fee ?? '1', nonce, publicKey: signer.pk,
    signature: sign(poolSeasonMessage(NET, w.addr, 'kray', '', s.ceiling ?? ceiling, s.root ?? root, expires, nonce), signer), scheme: 'kraywallet',
  }
  if (expires) e.expires = expires
  return e as unknown as KrayEvent
}
const drainEv = (L: KrayLedger, w: W, amount: bigint, twist?: { by?: W; sign?: Partial<{ amount: bigint }> }): KrayEvent => {
  const nonce = L.nonceOf(w.addr), signer = twist?.by ?? w
  return {
    seq: L.appliedSeq + 1, kind: 'pool-close', hash: 'c' + L.appliedSeq, at: 1, from: w.addr, lane: 'kray',
    amount: amount.toString(), fee: '1', nonce, publicKey: signer.pk,
    signature: sign(poolCloseMessage(NET, w.addr, 'kray', '', twist?.sign?.amount ?? amount, nonce), signer), scheme: 'kraywallet',
  } as unknown as KrayEvent
}
const takeEv = (L: KrayLedger, w: W, root: string, amount: bigint, proof: unknown): KrayEvent => ({
  seq: L.appliedSeq + 1, kind: 'claim-take', hash: 't' + L.appliedSeq, at: 1, from: w.addr, claimRoot: root,
  amount: amount.toString(), claimProof: proof, fee: '1', nonce: L.nonceOf(w.addr), publicKey: w.pk,
  signature: sign(claimTakeMessage(NET, w.addr, root, amount, L.nonceOf(w.addr)), w), scheme: 'kraywallet',
} as unknown as KrayEvent)
const closeSeasonEv = (L: KrayLedger, w: W, root: string): KrayEvent => ({
  seq: L.appliedSeq + 1, kind: 'claim-close', hash: 'x' + L.appliedSeq, at: 1, from: w.addr, claimRoot: root, fee: '1',
  nonce: L.nonceOf(w.addr), publicKey: w.pk, signature: sign(claimCloseMessage(NET, w.addr, root, L.nonceOf(w.addr)), w), scheme: 'kraywallet',
} as unknown as KrayEvent)

function main() {
  console.log('\n╔═ THE STANDING POOL — adversarial · held · committed · free ══╗\n')
  const owner = wallet('owner'), other = wallet('other'), a = wallet('a'), b = wallet('b'), eve = wallet('eve')

  const L = new KrayLedger(undefined, NET)
  const push = (e: KrayEvent) => {
    const at = L.appliedSeq
    L.applyLive(e)
    if (L.appliedSeq === at) throw new Error('test: silently skipped')
    if (!L.conserves() || !L.claimsBacked()) throw new Error(`test: the pot or Σ broke after ${e.kind}`)
  }
  const snap = () => JSON.stringify({
    root: L.cascadeRoot(), pools: L.pools.commitment(), claims: L.claims.commitment(),
    pot: L.balanceOf(CLAIM_POT).toString(), bal: [owner, other, a, b, eve].map((w) => L.balanceOf(w.addr).toString()), tre: L.balanceOf(TREASURY).toString(),
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
      ok(snap() === before && L.conserves() && L.claimsBacked(), m + ' — and the world is byte-identical, both books backed')
    }
  }
  let n = 0
  const mint = (to: string, amt: string) => push({ seq: L.appliedSeq + 1, kind: 'donate', hash: 'd' + (++n), at: n, to, amount: amt, outpoint: createHash('sha256').update('o' + n).digest('hex') + ':0' } as unknown as KrayEvent)
  for (const w of [owner, other, a, b, eve]) mint(w.addr, '9000')
  const sealTo = (h: number) => push({ seq: L.appliedSeq + 1, kind: 'seal', hash: 'sl' + h, at: 0, l1Txid: h.toString(16).padStart(64, '0'), l1Height: h, l1Root: L.cascadeRoot(), l1BlockNumber: 0 } as unknown as KrayEvent)

  push(fundEv(L, owner, 5000n, 900_000))
  const pool = () => L.pools.get('kray', '', owner.addr)!

  // ── 1 · THE THREE NUMBERS CANNOT BE MADE TO LIE ──────────────────────────────────────────────
  console.log('\n─ 1 · held · committed · free ─')
  const e1: ClaimShare[] = [{ to: a.addr, amount: 300n }, { to: b.addr, amount: 200n }]
  const r1 = claimRoot(e1)
  attack(() => seasonEv(L, owner, 5001n, r1, 0), /free and the season asks/, '1 · a season larger than the pool')
  attack(() => seasonEv(L, other, 10n, r1, 0), /no pool of that asset/, '1 · a season on a pool you do not own')
  attack(() => seasonEv(L, owner, 0n, r1, 0), /positive ceiling/, '1 · a season of nothing')
  attack(() => seasonEv(L, owner, 10n, 'not-a-root', 0), /merkle root/, '1 · a season with no real root')
  push(seasonEv(L, owner, 500n, r1, 800_000))
  attack(() => seasonEv(L, owner, 10n, claimRoot([{ to: eve.addr, amount: 9n }]), 0, { sign: { ceiling: 1n } }), /signature|verify|mirror/i, '1 · a ceiling signed smaller than the one asked')
  attack(() => seasonEv(L, owner, 4501n, claimRoot([{ to: a.addr, amount: 1n }]), 0), /free and the season asks/, '1 · a second season cannot reach what the first committed')
  push(seasonEv(L, owner, 4500n, claimRoot([{ to: b.addr, amount: 4500n }]), 0))
  ok(pool().committed === 5000n && L.pools.free('kray', '', owner.addr) === 0n, '1 · two seasons committed the pool to the last unit')
  attack(() => seasonEv(L, owner, 1n, claimRoot([{ to: eve.addr, amount: 1n }]), 0), /free and the season asks/, '1 · and not one unit more')

  // ── 2 · THE SIGNATURE ────────────────────────────────────────────────────────────────────────
  console.log('\n─ 2 · the signature around a pool ─')
  attack(() => fundEv(L, owner, 100n, 0, { sign: { amount: 1n } }), /signature|verify|mirror/i, '2 · a pour signed smaller than the one made')
  attack(() => fundEv(L, owner, 100n, 0, { sign: { expires: 999_999 } }), /signature|verify|mirror/i, '2 · a horizon signed other than the one sent')
  attack(() => fundEv(L, owner, 100n, 0, { by: eve }), /signature|verify|key/i, '2 · a forged pour')
  attack(() => fundEv(L, owner, 100n, 0, { fee: '2' }), /eternal 1-₭ fee/, '2 · an inflated fee')

  // ── 3 · THE HORIZON ──────────────────────────────────────────────────────────────────────────
  console.log('\n─ 3 · the horizon cannot be pulled closer ─')
  attack(() => fundEv(L, owner, 10n, 100_000), /pushed forward, never pulled closer/, '3 · a later pour shortening the promise')
  attack(() => drainEv(L, owner, 1n), /stands until Bitcoin height/, '3 · drawing before the horizon')
  attack(() => drainEv(L, eve, 1n), /no pool of that asset/, '3 · drawing from a pool that is not yours')

  // ── 4 · A SEASON IS PAID ONCE, OUT OF ONE COMMITMENT ─────────────────────────────────────────
  console.log('\n─ 4 · one commitment, one payment ─')
  const heldBefore = pool().held
  push(takeEv(L, a, r1, 300n, claimProof(e1, 0)))
  ok(pool().held === heldBefore - 300n && pool().committed === 4700n, '4 · a take lowered held and committed together')
  attack(() => takeEv(L, a, r1, 300n, claimProof(e1, 0)), /already taken/, '4 · and the same hand cannot be paid twice')
  attack(() => takeEv(L, eve, r1, 300n, claimProof(e1, 0)), /does not put your hand/, '4 · nor a hand outside the root')
  sealTo(799_999)
  attack(() => closeSeasonEv(L, owner, r1), /closes at Bitcoin height/, '4 · a season cannot go home early')
  sealTo(800_000)
  const potBefore = L.balanceOf(CLAIM_POT), ownerBefore = L.balanceOf(owner.addr)
  push(closeSeasonEv(L, owner, r1))
  ok(L.balanceOf(CLAIM_POT) === potBefore && L.balanceOf(owner.addr) === ownerBefore - 1n, '4 · the unclaimed 200 did NOT leave the pot — only the fee moved')
  ok(pool().committed === 4500n && L.pools.free('kray', '', owner.addr) === 200n, '4 · it became free again inside the pool')

  // ── 5 · DRAWING BACK ─────────────────────────────────────────────────────────────────────────
  console.log('\n─ 5 · drawing back what no season can reach ─')
  sealTo(900_000)
  attack(() => drainEv(L, owner, 201n), /a live season still needs the rest/, '5 · one unit more than free is refused')
  attack(() => drainEv(L, other, 100n), /no pool of that asset/, '5 · and a stranger draws nothing')
  attack(() => drainEv(L, owner, 200n, { sign: { amount: 1n } }), /signature|verify|mirror/i, '5 · a draw signed smaller than the one taken')
  const back = L.balanceOf(owner.addr)
  push(drainEv(L, owner, 200n))
  ok(L.balanceOf(owner.addr) === back + 200n - 1n && L.pools.free('kray', '', owner.addr) === 0n, '5 · exactly the free part came home')
  ok(pool().held === 4500n && pool().committed === 4500n && L.claimsBacked(), '5 · and the pool still holds precisely what its last season owes')

  // ── 6 · NOBODY MAY FILL OR SIGN THE POT ──────────────────────────────────────────────────────
  console.log('\n─ 6 · the pot ─')
  {
    const nonce = L.nonceOf(owner.addr)
    attack(() => ({ seq: L.appliedSeq + 1, kind: 'transfer', hash: 'z1', at: 1, from: owner.addr, to: CLAIM_POT, amount: '5', fee: '1', nonce, publicKey: owner.pk, signature: sign(transferMessage(NET, owner.addr, CLAIM_POT, 5n, nonce), owner), scheme: 'kraywallet' } as unknown as KrayEvent),
      /cannot credit the claim pot/, '6 · nobody may pour into the pot but a signed pool-fund')
    const potW: W = { ...owner, addr: CLAIM_POT }
    attack(() => fundEv(L, potW, 1n, 0), /protocol pot|signature|verify|key/i, '6 · the pot cannot fund a pool of its own')
    attack(() => drainEv(L, potW, 1n), /no pool of that asset|protocol pot|signature|verify|key/i, '6 · nor draw one')
  }

  // ── 7 · THE SWARM ────────────────────────────────────────────────────────────────────────────
  console.log('\n─ 7 · the swarm: 3 seeds × owners, epochs and hands ─')
  for (const seed of [23, 71, 167]) {
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
    const owners = ['o1', 'o2'].map((t) => wallet(`sw-${seed}-${t}`))
    const hands = ['h1', 'h2', 'h3', 'h4'].map((t) => wallet(`sw-${seed}-${t}`))
    for (const w of [...owners, ...hands]) apply({ seq: S.appliedSeq + 1, kind: 'donate', hash: `sd${seed}-${++m}`, at: m, to: w.addr, amount: '9000', outpoint: createHash('sha256').update(`sd${seed}-${m}`).digest('hex') + ':0' } as unknown as KrayEvent)
    let state = seed * 7919
    const rnd = (k: number): number => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state % k }
    const seasons: Array<{ root: string; shares: ClaimShare[]; owner: W; taken: Set<string> }> = []
    let poured = 0, attested = 0, claimed = 0, drawn = 0
    for (let step = 0; step < 400; step++) {
      const move = rnd(10)
      const o = owners[rnd(owners.length)]!
      if (move < 2) {
        if (apply(fundEv(S, o, BigInt(50 + rnd(500)), 700_000))) poured++
      } else if (move < 5) {
        const p = S.pools.get('kray', '', o.addr)
        if (!p) continue
        const free = p.held - p.committed
        if (free <= 1n) continue
        const picked = [...new Set([hands[rnd(hands.length)]!, hands[rnd(hands.length)]!])]
        const sh: ClaimShare[] = picked.map((w) => ({ to: w.addr, amount: 1n + BigInt(rnd(Number(free > 100n ? 100n : free) || 1)) }))
        const sum = sh.reduce((t, x) => t + x.amount, 0n)
        if (sum > free) continue
        const r = claimRoot(sh)
        if (S.claims.get(r)) continue
        if (apply(seasonEv(S, o, sum, r, rnd(2) === 0 ? 700_000 : 0))) { attested++; seasons.push({ root: r, shares: sh, owner: o, taken: new Set() }) }
      } else if (move < 9) {
        const live = seasons.filter((x) => S.claims.get(x.root) && x.shares.some((sh2) => !x.taken.has(sh2.to)))
        if (!live.length) continue
        const se = live[rnd(live.length)]!
        const open = se.shares.map((sh2, i) => (se.taken.has(sh2.to) ? -1 : i)).filter((i) => i >= 0)
        const idx = open[rnd(open.length)]!
        const share = se.shares[idx]!
        const who = hands.find((w) => w.addr === share.to)!
        const p0 = S.pools.get('kray', '', se.owner.addr)!
        if (apply(takeEv(S, who, se.root, share.amount, claimProof(se.shares, idx)))) {
          claimed++; se.taken.add(share.to)
          const p1 = S.pools.get('kray', '', se.owner.addr)
          ok(!p1 || (p1.held === p0.held - share.amount && p1.committed === p0.committed - share.amount),
            `seed ${seed}: held and committed fell together by exactly the leaf`)
        }
      } else {
        const p = S.pools.get('kray', '', o.addr)
        if (!p) continue
        if (apply(drainEv(S, o, p.held - p.committed > 0n ? p.held - p.committed : 1n))) drawn++
      }
      if (!S.conserves() || !S.claimsBacked()) { ok(false, `seed ${seed} step ${step}: a book broke`); break }
    }
    // the clock moves, seasons go home, owners draw back
    apply({ seq: S.appliedSeq + 1, kind: 'seal', hash: `ss${seed}`, at: 0, l1Txid: (700_000).toString(16).padStart(64, '0'), l1Height: 700_000, l1Root: S.cascadeRoot(), l1BlockNumber: 0 } as unknown as KrayEvent)
    for (const se of seasons) if (S.claims.get(se.root)) apply(closeSeasonEv(S, se.owner, se.root))
    for (const o of owners) { const p = S.pools.get('kray', '', o.addr); if (p && p.held - p.committed > 0n && apply(drainEv(S, o, p.held - p.committed))) drawn++ }
    ok(S.conserves() && S.claimsBacked(), `seed ${seed}: ${poured} pours, ${attested} seasons, ${claimed} claims, ${drawn} draws — both books hold`)
    ok(attested > 0 && claimed > 0, `seed ${seed}: the storm really exercised the pool (${claimed} claims)`)
    const twin = new KrayLedger(undefined, NET)
    for (const e of sJournal) twin.applyLive(e)
    ok(twin.cascadeRoot() === S.cascadeRoot(), `seed ${seed}: a replay twin reaches the SAME cascade root`)
    ok(twin.pools.commitment() === S.pools.commitment() && twin.balanceOf(CLAIM_POT) === S.balanceOf(CLAIM_POT), `seed ${seed}: and the identical pool book and pot`)
  }

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — a pool's three numbers held against every hand. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
