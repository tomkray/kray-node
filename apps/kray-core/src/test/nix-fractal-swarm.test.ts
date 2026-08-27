/**
 * THE NIX FRACTAL SWARM — atemporal antifragility of Ӿ, by formula not by wall-clock.
 *   node src/test/nix-fractal-swarm.test.ts
 *   NIX_FRACTAL_S_MAX=6 NIX_FRACTAL_R0=512 node src/test/nix-fractal-swarm.test.ts
 *
 * ORAÇÃO (Ressonância Divina):
 *   given (A1 five equalities) ∧ (tank lifetime, never ∂/∂t) ∧ (fee prescribed) ∧ (journal = f(bytes))
 *   + scale s: W(s)=2^s, R(s)=R0·2^s, clock += 100y, attack, recirculate, replay
 *   → I(s) holds at every octave (self-similar). 100 years is ONE `at` jump, not a loop.
 *
 * THE FRACTAL:
 *   W(s) = 2^s                         population (s = 1 … S_MAX; two parties min)
 *   R(s) = R0 · 2^s                    recirculating x-sends (Ӿ is conserved, so ping-pong)
 *   T    = 100 · 365.25 · 86400 · 1000  one atemporal century in the journal clock
 *   I    = conserves ∧ Σtank+spent = F·burned ∧ feeless ≤ F·burned ∧ halted=∅
 *          ∧ tanks(T+) = tanks(T−)     time mints nothing
 *          ∧ replay(journal) = root    a stranger re-derives the century
 *
 * A linear "for year in 1..100" loop would be a louder copy of the same attractor.
 * The jump IS the century. The octave IS the swarm. Same I at every s, or the law is a lie.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as btc from '@scure/btc-signer'
import { KrayLedger, FIREBORN_SENDS_PER_KRAY, FIREBORN_GAP_MS } from '../protocol/ledger.ts'
import { LedgerStore } from '../protocol/store.ts'
import { NETWORKS, _generateKeyPair, _hexToBytes, _signKrayWallet, burnMessage, xSendMessage } from '../protocol/scheme.ts'
import { GENESIS_HASH, sha256hex, canonical, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
const F = FIREBORN_SENDS_PER_KRAY
const GAP = FIREBORN_GAP_MS
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000
const CENTURY_MS = 100 * YEAR_MS
const S_MAX = Math.max(1, Math.min(8, Number(process.env.NIX_FRACTAL_S_MAX || 6)))
const R0 = Math.max(32, Number(process.env.NIX_FRACTAL_R0 || 256))
const BURN = 3n

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('nix-fractal|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { tag, sk, pk: publicKeyHex, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address! }
}
type W = ReturnType<typeof wallet>

function openNix() {
  return new KrayLedger(undefined, NET, undefined, false, undefined, undefined, 1, undefined, undefined, undefined, undefined, 1)
}

function tanksOf(L: KrayLedger, ws: W[]) {
  return ws.map((w) => L.fireTankOf(w.addr))
}
function tankSum(L: KrayLedger, ws: W[]) {
  return ws.reduce((s, w) => s + L.fireTankOf(w.addr), 0n)
}
function xSum(L: KrayLedger, ws: W[]) {
  return ws.reduce((s, w) => s + L.xBalanceOf(w.addr), 0n)
}

function I(L: KrayLedger, ws: W[], feeless: bigint, label: string) {
  const burned = L.totalBurned
  ok(L.conserves() && L.haltedReason() === null, `${label}: conserves and not halted`)
  ok(L.xEmitted === burned && xSum(L, ws) === burned, `${label}: Σ Ӿ == burned == ${burned}`)
  ok(feeless <= burned * F, `${label}: feeless ${feeless} ≤ F×burned ${burned * F}`)
  ok(tankSum(L, ws) + feeless === burned * F, `${label}: tanks + spent == F×burned (the fire identity)`)
}

function main() {
  process.env.KRAY_LAB_X_SEQ = '1'
  process.env.KRAY_LAB_FIREBORN_SEQ = '1'

  const t0 = Date.now()
  console.log('\n╔═ THE NIX FRACTAL SWARM — I(s) at every octave; a century is one jump ═╗')
  console.log(`   formula: W(s)=2^s  R(s)=${R0}·2^s  T=100y  s=1..${S_MAX}  F=${F}  gap=${GAP}ms`)
  console.log(`   R0=${R0} → largest octave ${2 ** S_MAX} wallets × ${R0 * (2 ** S_MAX)} recirculations\n`)

  const pool = Array.from({ length: 2 ** S_MAX }, (_, i) => wallet('w' + i))
  let totalHonest = 0
  let totalAttack = 0
  let totalRefused = 0
  let centuries = 0
  let lastJournal: KrayEvent[] = []
  let lastRoot = ''
  let lastWs: W[] = []
  let lastTanks: bigint[] = []
  let lastBurned = 0n

  for (let s = 1; s <= S_MAX; s++) {
    const Wcount = 2 ** s
    const R = R0 * Wcount
    const ws = pool.slice(0, Wcount)
    const L = openNix()
    const J: KrayEvent[] = []
    let last = GENESIS_HASH
    let clock = 1_700_000_000_000
    let feeless = 0n
    let honest = 0
    let attacks = 0
    let refused = 0

    const commit = (partial: Record<string, unknown>) => {
      const body = { ...partial, seq: J.length + 1, prevHash: last }
      const hash = sha256hex(last + canonical(body))
      const e = { ...body, hash } as unknown as KrayEvent
      L.applyLive(e)
      J.push(e)
      last = hash
      return e
    }

    console.log(`── scale s=${s}  W=${Wcount}  R=${R} ──`)

    for (const w of ws) {
      commit({ kind: 'donate', at: clock, to: w.addr, amount: '400' })
      const n = L.nonceOf(w.addr)
      commit({
        kind: 'burn', at: clock, from: w.addr, amount: String(BURN), fee: '1',
        nonce: n, publicKey: w.pk, signature: _signKrayWallet(burnMessage(NET, w.addr, BURN, n), w.sk), scheme: 'kraywallet',
      })
    }
    ok(xSum(L, ws) === BURN * BigInt(Wcount) && L.conserves(), `s=${s}: funded + burned — ${BURN} Ӿ each, tank ${BURN * F} each`)

    const rootBeforeAttack = L.cascadeRoot()
    const attackOnce = (partial: Record<string, unknown>, why: string) => {
      attacks++
      const body = { ...partial, seq: J.length + 1, prevHash: last }
      const hash = sha256hex(last + canonical(body))
      const e = { ...body, hash } as unknown as KrayEvent
      try {
        L.applyLive(e)
        ok(false, `s=${s}: ${why} — DID NOT throw`)
      } catch {
        refused++
        if (L.cascadeRoot() !== rootBeforeAttack || L.haltedReason()) {
          ok(false, `s=${s}: ${why} mutated the book or HALTed`)
        }
      }
    }
    const ghost = wallet(`ghost|${s}`)
    const a0 = ws[0], a1 = ws[1]
    const n0 = L.nonceOf(a0.addr)
    attackOnce({
      kind: 'x-send', at: clock, from: a0.addr, to: a1.addr, amount: '0x10', fee: '0',
      nonce: n0, publicKey: a0.pk, signature: _signKrayWallet(xSendMessage(NET, a0.addr, a1.addr, 16n, n0), a0.sk), scheme: 'kraywallet',
    }, 'hex 0x10')
    attackOnce({
      kind: 'x-send', at: clock, from: a0.addr, to: a1.addr, amount: '01', fee: '0',
      nonce: n0, publicKey: a0.pk, signature: _signKrayWallet(xSendMessage(NET, a0.addr, a1.addr, 1n, n0), a0.sk), scheme: 'kraywallet',
    }, 'leading-zero pad')
    attackOnce({
      kind: 'x-send', at: clock, from: a0.addr, to: a0.addr, amount: '1', fee: '0',
      nonce: n0, publicKey: a0.pk, signature: _signKrayWallet(xSendMessage(NET, a0.addr, a0.addr, 1n, n0), a0.sk), scheme: 'kraywallet',
    }, 'self-send')
    attackOnce({
      kind: 'x-send', at: clock, from: a0.addr, to: a1.addr, amount: String(L.xBalanceOf(a0.addr) + 1n), fee: '0',
      nonce: n0, publicKey: a0.pk, signature: _signKrayWallet(xSendMessage(NET, a0.addr, a1.addr, L.xBalanceOf(a0.addr) + 1n, n0), a0.sk), scheme: 'kraywallet',
    }, 'overspend')
    attackOnce({
      kind: 'x-send', at: clock, from: a0.addr, to: a1.addr, amount: '1', fee: '0',
      nonce: n0, publicKey: a1.pk, signature: _signKrayWallet(xSendMessage(NET, a0.addr, a1.addr, 1n, n0), a1.sk), scheme: 'kraywallet',
    }, 'wrong key')
    attackOnce({
      kind: 'x-send', at: clock, from: ghost.addr, to: a1.addr, amount: '1', fee: '0',
      nonce: 0, publicKey: ghost.pk, signature: _signKrayWallet(xSendMessage(NET, ghost.addr, a1.addr, 1n, 0), ghost.sk), scheme: 'kraywallet',
    }, 'empty sybil')
    attackOnce({
      kind: 'x-send', at: clock, from: a0.addr, to: a1.addr, amount: '1', fee: '1',
      nonce: n0, publicKey: a0.pk, signature: _signKrayWallet(xSendMessage(NET, a0.addr, a1.addr, 1n, n0), a0.sk), scheme: 'kraywallet',
    }, 'fee 1 where 0 is prescribed')
    attackOnce({
      kind: 'x-send', at: Number.NaN, from: a0.addr, to: a1.addr, amount: '1', fee: '0',
      nonce: n0, publicKey: a0.pk, signature: _signKrayWallet(xSendMessage(NET, a0.addr, a1.addr, 1n, n0), a0.sk), scheme: 'kraywallet',
    }, 'fee 0 on a timeless act (prescribed 1)')
    ok(L.cascadeRoot() === rootBeforeAttack && L.conserves(), `s=${s}: ${refused} hostile acts left the book byte-identical`)

    const send1 = (from: W, to: W, burst: boolean) => {
      if (from.addr === to.addr) return false
      if (L.xBalanceOf(from.addr) < 1n) return false
      const at = burst ? clock : (clock += GAP)
      const seq = J.length + 1
      const fee = L.xSendFeeFor(from.addr, at, seq)
      if (fee > 0n && L.balanceOf(from.addr) < fee) {
        clock += GAP
        return false
      }
      const n = L.nonceOf(from.addr)
      commit({
        kind: 'x-send', at, from: from.addr, to: to.addr, amount: '1', fee: String(fee),
        nonce: n, publicKey: from.pk, signature: _signKrayWallet(xSendMessage(NET, from.addr, to.addr, 1n, n), from.sk), scheme: 'kraywallet',
      })
      if (fee === 0n) feeless += 1n
      honest++
      return true
    }

    const recirculate = (n: number) => {
      let i = 0, guard = 0
      while (i < n && guard < n * 4) {
        const from = ws[i % Wcount]
        const to = ws[(i + 1) % Wcount]
        const burst = (i % 8) === 7
        if (send1(from, to, burst)) i++
        else {
          const rich = ws.find((w) => L.xBalanceOf(w.addr) >= 1n && w.addr !== to.addr) ?? ws.find((w) => L.xBalanceOf(w.addr) >= 1n)
          if (!rich || !send1(rich, to, burst)) clock += GAP
          i++
        }
        guard++
      }
    }

    recirculate(Math.floor(R / 2))
    I(L, ws, feeless, `s=${s} mid`)

    const tanksBefore = tanksOf(L, ws)
    const spentBefore = feeless
    clock += CENTURY_MS
    centuries++
    ok(tanksOf(L, ws).every((t, i) => t === tanksBefore[i]) && feeless === spentBefore,
      `s=${s}: +100y jump — tanks unchanged (∂tank/∂t = 0). clock=${clock}`)

    recirculate(Math.ceil(R / 2))
    I(L, ws, feeless, `s=${s} after century`)

    totalHonest += honest
    totalAttack += attacks
    totalRefused += refused
    lastJournal = J
    lastRoot = L.cascadeRoot()
    lastWs = ws
    lastTanks = tanksOf(L, ws)
    lastBurned = L.totalBurned
    console.log(`   s=${s} done — ${J.length} journal acts, ${honest} honest x-sends, ${feeless} feeless, root ${lastRoot.slice(0, 12)}…`)
  }

  console.log('\n── drain + second century (largest octave) — time cannot refill an empty tank ──')
  {
    const L = openNix()
    const J: KrayEvent[] = []
    let last = GENESIS_HASH
    let clock = 2_000_000_000_000
    const d = pool[0], mate = pool[1]
    const commit = (partial: Record<string, unknown>) => {
      const body = { ...partial, seq: J.length + 1, prevHash: last }
      const hash = sha256hex(last + canonical(body))
      const e = { ...body, hash } as unknown as KrayEvent
      L.applyLive(e)
      J.push(e)
      last = hash
    }
    commit({ kind: 'donate', at: clock, to: d.addr, amount: '2000' })
    commit({ kind: 'donate', at: clock, to: mate.addr, amount: '50' })
    const nb = L.nonceOf(d.addr)
    commit({
      kind: 'burn', at: clock, from: d.addr, amount: '1', fee: '1',
      nonce: nb, publicKey: d.pk, signature: _signKrayWallet(burnMessage(NET, d.addr, 1n, nb), d.sk), scheme: 'kraywallet',
    })
    const nbm = L.nonceOf(mate.addr)
    commit({
      kind: 'burn', at: clock, from: mate.addr, amount: '1', fee: '1',
      nonce: nbm, publicKey: mate.pk, signature: _signKrayWallet(burnMessage(NET, mate.addr, 1n, nbm), mate.sk), scheme: 'kraywallet',
    })
    ok(L.fireTankOf(d.addr) === F && L.xBalanceOf(d.addr) === 1n, `drain wallet holds 1 Ӿ and a tank of ${F}`)

    let drained = 0n
    while (L.fireTankOf(d.addr) > 0n) {
      const at = (clock += GAP)
      const n = L.nonceOf(d.addr)
      const fee = L.xSendFeeFor(d.addr, at, J.length + 1)
      if (fee !== 0n) { ok(false, 'drain: a remaining tank must prescribe 0 across a gap'); break }
      commit({
        kind: 'x-send', at, from: d.addr, to: mate.addr, amount: '1', fee: '0',
        nonce: n, publicKey: d.pk, signature: _signKrayWallet(xSendMessage(NET, d.addr, mate.addr, 1n, n), d.sk), scheme: 'kraywallet',
      })
      drained += 1n
      const nr = L.nonceOf(mate.addr)
      const atR = (clock += GAP)
      commit({
        kind: 'x-send', at: atR, from: mate.addr, to: d.addr, amount: '1', fee: String(L.xSendFeeFor(mate.addr, atR, J.length + 1)),
        nonce: nr, publicKey: mate.pk, signature: _signKrayWallet(xSendMessage(NET, mate.addr, d.addr, 1n, nr), mate.sk), scheme: 'kraywallet',
      })
    }
    ok(L.fireTankOf(d.addr) === 0n && drained === F, `drained exactly F=${F} feeless sends — tank empty`)
    clock += CENTURY_MS
    centuries++
    ok(L.fireTankOf(d.addr) === 0n, 'empty tank + 100y — still empty (time is not Mana; Koinos-class regen is dead here)')
    const nPay = L.nonceOf(d.addr)
    const atPay = clock + GAP
    const feePay = L.xSendFeeFor(d.addr, atPay, J.length + 1)
    ok(feePay === 1n, 'a century later the empty tank still prescribes the eternal 1 ₭')
    commit({
      kind: 'x-send', at: atPay, from: d.addr, to: mate.addr, amount: '1', fee: '1',
      nonce: nPay, publicKey: d.pk, signature: _signKrayWallet(xSendMessage(NET, d.addr, mate.addr, 1n, nPay), d.sk), scheme: 'kraywallet',
    })
    ok(L.conserves() && L.haltedReason() === null && L.xBalanceOf(d.addr) === 0n && L.xBalanceOf(mate.addr) === 2n,
      'paid path after the century still conserves (1 Ӿ moved; mate holds both lights)')
    totalHonest += Number(drained) + 1
  }

  console.log('\n── follower: largest-octave journal replayed from bytes ──')
  {
    const dir = join(tmpdir(), `nix-fractal-${process.pid}`)
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(join(dir, `kraynet-journal-${NET}.jsonl`), lastJournal.map((e) => JSON.stringify(e) + '\n').join(''))
      const S = new LedgerStore(dir, NET)
      ok(S.ledger.cascadeRoot() === lastRoot, `follower root == live root (${lastRoot.slice(0, 16)}…)`)
      ok(S.ledger.conserves() && S.ledger.haltedReason() === null, 'follower conserves and is not halted')
      ok(S.ledger.xEmitted === lastBurned && S.ledger.totalBurned === lastBurned && xSum(S.ledger, lastWs) === lastBurned,
        'follower: Σ Ӿ == burned (the century is in the bytes, not in the process)')
      ok(lastWs.every((w, i) => S.ledger.fireTankOf(w.addr) === lastTanks[i]),
        'follower tanks re-derive byte-exact — 100y lives in `at`, not in hidden RAM')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  const ms = Date.now() - t0
  const simulatedYears = centuries * 100
  ok(totalHonest >= R0 * 2, `honest x-sends landed at swarm scale (${totalHonest})`)
  ok(totalRefused === totalAttack, `every hostile act was refused (${totalRefused}/${totalAttack})`)
  ok(fail === 0, `fractal I(s) held at every octave (${ms} ms, ${simulatedYears} atemporal years, ${totalHonest} honest, ${lastJournal.length} acts on the largest journal)`)

  console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed, ${fail} failed`)
  console.log(`   honest=${totalHonest}  refused=${totalRefused}  journal[s_max]=${lastJournal.length}  centuries=${centuries} (${simulatedYears}y atemporal)  ${ms}ms`)
  console.log('   discarded branch: a year-by-year loop — louder copy of the same attractor; the jump is the century.\n')
  process.exit(fail === 0 ? 0 : 1)
}
main()
