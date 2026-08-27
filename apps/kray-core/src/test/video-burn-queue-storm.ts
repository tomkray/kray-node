/**
 * VIDEO + BYTE-BURN + 1000-ACT QUEUE STORM
 *
 * The size-burn law lives in the reducer (starBurnOf): 1 ₭ per started MB at the
 * era's rate, floor 1. This pin applies that law to video/mp4, then fires BLOCKS
 * waves of 1000 mixed signed acts through one ledger. A shadow book (emit / burn /
 * fee) must match the reducer. A refused attack leaves the cascade root untouched.
 * A stranger replay of the journal reproduces the root byte-exact.
 *
 *   BLOCKS=3 PER=1000 node apps/kray-core/src/test/video-burn-queue-storm.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  BLACK_HOLE, MAX_INSCRIPTION_BYTES, SEAL_CONTENT_BUDGET, starBurnOf, BYTES_PER_KRAY_BURN,
  type KrayEvent,
} from '../protocol/kray-primitives.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes,
  transferMessage, burnMessage, inscribeMessageV2, nameMessageV2, sendStarMessage,
} from '../protocol/scheme.ts'

const NET = 'regtest'
const BNET = toBtcNet(NET)
const BLOCKS = Math.max(1, Number(process.env.BLOCKS || 3))
const PER = Math.max(100, Number(process.env.PER || 1000))
const WALLETS = 48

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const H = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/** Video sizes that pin every started-MB boundary the law names. */
const VIDEO_SIZES = [1, 400, 999_999, 1_000_000, 1_000_001, 2_000_000, 3_200_000, 5_242_880] as const

interface Wallet { i: number; addr: string; sk: Uint8Array; pk: string }
function makeWallet(i: number): Wallet {
  const sk = createHash('sha256').update('video-storm|' + i, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { i, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}

function sign(w: Wallet, e: Record<string, unknown>, msg: string): KrayEvent {
  return { ...e, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet' } as KrayEvent
}

function main() {
  console.log('\n╔═ VIDEO + BYTE-BURN + 1000-ACT QUEUE STORM ═╗')
  console.log(`   ${BLOCKS} blocks × ${PER} mixed acts · video/mp4 pays 1 ₭ / started MB in the reducer\n`)

  // ── 0 · THE LAW IS ARITHMETIC (independent of the ledger) ─────────────────
  console.log('── 0 · starBurnOf is max(1, ceil(size / bytesPerKray))')
  const pin: Array<[number, number, bigint]> = [
    [0, BYTES_PER_KRAY_BURN, 1n],
    [1, BYTES_PER_KRAY_BURN, 1n],
    [999_999, BYTES_PER_KRAY_BURN, 1n],
    [1_000_000, BYTES_PER_KRAY_BURN, 1n],
    [1_000_001, BYTES_PER_KRAY_BURN, 2n],
    [2_000_000, BYTES_PER_KRAY_BURN, 2n],
    [2_000_001, BYTES_PER_KRAY_BURN, 3n],
    [5_242_880, BYTES_PER_KRAY_BURN, 6n],
    [MAX_INSCRIPTION_BYTES, BYTES_PER_KRAY_BURN, 21n],
    [10_000_000, 500_000, 20n], // after a heavy retarget: 1 ₭ per 500 KB
  ]
  for (const [size, rate, expect] of pin) {
    ok(starBurnOf(size, rate) === expect, `law(${size} B @ ${rate}) = ${expect} ₭`)
  }

  const people = Array.from({ length: WALLETS }, (_, i) => makeWallet(i))
  const L = new KrayLedger(undefined, NET)
  const journal: KrayEvent[] = []
  const nonce = new Array<number>(WALLETS).fill(0)
  const owned: string[][] = Array.from({ length: WALLETS }, () => [])
  let seq = 0
  let sealN = 0
  let sealBytes = 0
  let shadowEmit = 0n
  let shadowBurn = 0n
  const counts: Record<string, number> = {
    donate: 0, transfer: 0, video: 0, text: 0, name: 0, 'transfer-star': 0, seal: 0, sink: 0,
  }

  const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
  const nextSeq = () => { seq += 1; return seq }

  const seal = () => {
    sealN += 1
    const txid = H('seal|' + sealN).padEnd(64, '0').slice(0, 64)
    push({ seq: nextSeq(), kind: 'seal', hash: H('s' + sealN), l1Txid: txid } as KrayEvent)
    sealBytes = 0
    counts.seal++
  }
  const needRoom = (bytes: number) => {
    if (sealBytes + bytes > SEAL_CONTENT_BUDGET) seal()
  }

  for (let i = 0; i < WALLETS; i++) {
    for (let m = 0; m < 3; m++) {
      push({ seq: nextSeq(), kind: 'donate', hash: H(`fund|${i}|${m}`), to: people[i].addr, amount: '10000' } as KrayEvent)
      shadowEmit += 10000n
      counts.donate++
    }
  }
  ok(L.conserves() && L.totalEmitted === shadowEmit, `funded ${WALLETS} wallets × 50,000 ₭ — A1 holds`)

  const pick = (n: number) => people[n % WALLETS]
  const kinds = ['video', 'transfer', 'text', 'name', 'transfer-star', 'sink', 'donate'] as const

  for (let b = 0; b < BLOCKS; b++) {
    const beforeRoot = L.cascadeRoot()
    const beforeSeq = seq
    for (let k = 0; k < PER; k++) {
      const kind = kinds[(b * PER + k) % kinds.length]
      const w = pick(b * 17 + k)
      const i = w.i
      if (kind === 'video' || kind === 'text') {
        const size = kind === 'video' ? VIDEO_SIZES[(b + k) % VIDEO_SIZES.length] : 64 + (k % 200)
        needRoom(size)
        const ct = kind === 'video' ? 'video/mp4' : 'text/plain'
        const ch = H(`body|${b}|${k}|${ct}`)
        const burn = starBurnOf(size, L.bytesPerKray)
        if (L.balanceOf(w.addr) < burn) {
          push({ seq: nextSeq(), kind: 'donate', hash: H(`topup|${b}|${k}`), to: w.addr, amount: (burn + 20n).toString() } as KrayEvent)
          shadowEmit += burn + 20n
          counts.donate++
        }
        const ev = sign(w, {
          seq: nextSeq(), kind: 'inscribe', hash: H(`ins|${b}|${k}`), from: w.addr,
          contentHash: ch, contentType: ct, size, nonce: nonce[i],
        }, inscribeMessageV2(NET, w.addr, ch, ct, size, undefined, nonce[i]))
        push(ev)
        nonce[i]++
        shadowBurn += burn
        sealBytes += size
        owned[i].push((L.stars.createdSeq - 1n).toString())
        counts[kind === 'video' ? 'video' : 'text']++
      } else if (kind === 'transfer') {
        const to = pick(i + 1 + k)
        if (to.addr === w.addr || L.balanceOf(w.addr) < 3n) {
          push({ seq: nextSeq(), kind: 'donate', hash: H(`td|${b}|${k}`), to: w.addr, amount: '10' } as KrayEvent)
          shadowEmit += 10n
          counts.donate++
        } else {
          const amt = 1n + BigInt(k % 3)
          push(sign(w, {
            seq: nextSeq(), kind: 'transfer', hash: H(`t|${b}|${k}`), from: w.addr, to: to.addr,
            amount: amt.toString(), fee: '1', nonce: nonce[i],
          }, transferMessage(NET, w.addr, to.addr, amt, nonce[i])))
          nonce[i]++
          counts.transfer++
        }
      } else if (kind === 'name') {
        const name = `v${b}k${k}w${i}`
        const burn = starBurnOf(undefined, L.bytesPerKray)
        if (L.balanceOf(w.addr) < burn) {
          push({ seq: nextSeq(), kind: 'donate', hash: H(`ntop|${b}|${k}`), to: w.addr, amount: '20' } as KrayEvent)
          shadowEmit += 20n
          counts.donate++
        }
        push(sign(w, {
          seq: nextSeq(), kind: 'name', hash: H(`n|${b}|${k}`), from: w.addr, name, nonce: nonce[i],
        }, nameMessageV2(NET, w.addr, nonce[i], name)))
        nonce[i]++
        shadowBurn += burn
        owned[i].push((L.stars.createdSeq - 1n).toString())
        counts.name++
      } else if (kind === 'transfer-star') {
        const no = owned[i].pop()
        const to = pick(i + 7)
        if (!no || to.addr === w.addr || L.balanceOf(w.addr) < 1n) {
          if (no) owned[i].push(no)
          push({ seq: nextSeq(), kind: 'donate', hash: H(`sd|${b}|${k}`), to: w.addr, amount: '10' } as KrayEvent)
          shadowEmit += 10n
          counts.donate++
        } else {
          push(sign(w, {
            seq: nextSeq(), kind: 'transfer-star', hash: H(`ts|${b}|${k}`), from: w.addr, to: to.addr,
            star: no, fee: '1', nonce: nonce[i],
          }, sendStarMessage(NET, w.addr, to.addr, BigInt(no), nonce[i])))
          nonce[i]++
          owned[to.i].push(no)
          counts['transfer-star']++
        }
      } else if (kind === 'sink') {
        if (L.balanceOf(w.addr) < 2n) {
          push({ seq: nextSeq(), kind: 'donate', hash: H(`kd|${b}|${k}`), to: w.addr, amount: '10' } as KrayEvent)
          shadowEmit += 10n
          counts.donate++
          continue
        }
        // THE BURN LAW: the chosen death is the signed burn (₭ dies, Ӿ born 1:1) — never a hole transfer
        push(sign(w, {
          seq: nextSeq(), kind: 'burn', hash: H(`bh|${b}|${k}`), from: w.addr,
          amount: '1', fee: '1', nonce: nonce[i],
        }, burnMessage(NET, w.addr, 1n, nonce[i])))
        nonce[i]++
        shadowBurn += 1n           // the sink IS a true burn now (the burn law) — the shadow must count the death
        counts.sink++
      } else {
        push({ seq: nextSeq(), kind: 'donate', hash: H(`xd|${b}|${k}`), to: w.addr, amount: '5' } as KrayEvent)
        shadowEmit += 5n
        counts.donate++
      }
    }
    seal()
    const applied = seq - beforeSeq
    ok(applied >= PER, `block ${b + 1}: ≥ ${PER} journal lines (got ${applied} incl. top-ups/seal)`)
    ok(L.conserves() && L.totalBurned === shadowBurn && L.totalEmitted === shadowEmit,
      `block ${b + 1}: shadow burn ${shadowBurn} = reducer · emit ${shadowEmit} · A1`)
    ok(L.cascadeRoot() !== beforeRoot, `block ${b + 1}: cascade moved (the queue advanced)`)

    // ── attacks: nobody harms anybody ──────────────────────────────────────
    const rootHold = L.cascadeRoot()
    const burnedHold = L.totalBurned
    const thief = pick(0)
    const victim = pick(1)
    try {
      L.applyLive(sign(thief, {
        seq: seq + 1, kind: 'transfer', hash: H('replay|' + b), from: thief.addr, to: victim.addr,
        amount: '1', fee: '1', nonce: nonce[thief.i] - 1,
      }, transferMessage(NET, thief.addr, victim.addr, 1n, nonce[thief.i] - 1)))
      ok(false, `block ${b + 1}: stale-nonce replay MUST throw`)
    } catch (e) {
      ok(/nonce/.test((e as Error).message), `block ${b + 1}: stale nonce refused — ${(e as Error).message.slice(0, 60)}`)
    }
    const poor = makeWallet(9000 + b)
    L.applyLive({ seq: nextSeq(), kind: 'donate', hash: H('poor|' + b), to: poor.addr, amount: '1' } as KrayEvent)
    shadowEmit += 1n
    journal.push({ seq, kind: 'donate', hash: H('poor|' + b), to: poor.addr, amount: '1' } as KrayEvent)
    const vsize = 10_000_000
    const vch = H('unaffordable|' + b)
    try {
      L.applyLive(sign(poor, {
        seq: seq + 1, kind: 'inscribe', hash: H('poorvid|' + b), from: poor.addr,
        contentHash: vch, contentType: 'video/mp4', size: vsize, nonce: 0,
      }, inscribeMessageV2(NET, poor.addr, vch, 'video/mp4', vsize, undefined, 0)))
      ok(false, `block ${b + 1}: unaffordable 10 MB video MUST throw`)
    } catch (e) {
      ok(/insufficient ₭ to burn/.test((e as Error).message), `block ${b + 1}: 1 ₭ cannot buy a 10 ₭ video — refused whole`)
    }
    ok(L.balanceOf(poor.addr) === 1n && L.totalBurned === burnedHold,
      `block ${b + 1}: unaffordable video burned nothing; pauper still holds 1 ₭`)
    try {
      const over = MAX_INSCRIPTION_BYTES + 1
      const och = H('over|' + b)
      L.applyLive(sign(thief, {
        seq: seq + 1, kind: 'inscribe', hash: H('over|' + b), from: thief.addr,
        contentHash: och, contentType: 'video/mp4', size: over, nonce: nonce[thief.i],
      }, inscribeMessageV2(NET, thief.addr, och, 'video/mp4', over, undefined, nonce[thief.i])))
      ok(false, `block ${b + 1}: 21 MB + 1 video MUST throw`)
    } catch (e) {
      ok(/protocol ceiling/.test((e as Error).message), `block ${b + 1}: video above the 21 MB ceiling refused before burn`)
    }
    ok(L.conserves(), `block ${b + 1}: conservation after attacks`)
  }

  ok(counts.video >= 100, `video inscriptions landed: ${counts.video}`)
  ok(L.bytesPerKray === BYTES_PER_KRAY_BURN, `era still genesis rate (1 ₭ / MB) — got ${L.bytesPerKray}`)

  // ── stranger replay ───────────────────────────────────────────────────────
  const liveRoot = L.cascadeRoot()
  const R = new KrayLedger(undefined, NET)
  for (const e of journal) R.applyLive(e)
  ok(R.cascadeRoot() === liveRoot, `stranger replay = live cascade ${liveRoot.slice(0, 20)}…`)
  ok(R.totalBurned === L.totalBurned && R.totalEmitted === L.totalEmitted, 'replay burn/emit match live')
  ok(R.conserves(), 'replay conserves')

  const seqs = journal.map((e) => e.seq as number)
  const ordered = seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1)
  ok(ordered && seqs[0] === 1, `queue is a contiguous seq [1..${seqs[seqs.length - 1]}] — nobody cuts the line`)

  console.log(`\n   mix: ${JSON.stringify(counts)}`)
  console.log(`   Σ emit ${L.totalEmitted} − burn ${L.totalBurned} = circ ${L.circulating}`)
  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — video pays the byte law; the queue never crossed. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
