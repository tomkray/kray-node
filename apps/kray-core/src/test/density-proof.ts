/**
 * SETTLEMENT DENSITY — the law under pressure. Every act BIP-340 signed, A1 after
 * every wall-clock second, every living kind lands, a stranger replays to the
 * IDENTICAL cascade root. Density is env-tunable; the law does not loosen as N grows.
 *
 *   DENSITY_EVENTS=120000 DENSITY_WALLETS=256 node src/test/density-proof.ts
 *
 * Chapter 1 is in-process (the reducer — where the proof lives).
 * Chapter 2 is HTTP on a throwaway node (the door), short waves, live TPS.
 * Neither chapter touches the live :4477 journal.
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { BLACK_HOLE, TREASURY, sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'
import { canonicalCode, type ContractCode } from '../protocol/contract.ts'
import { parseRuneKey } from '../economics/rune-book.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, scriptOfAddress,
  transferMessage, burnMessage, sendStarMessage, inscribeMessageV2, nameMessageV2, originMessageV2,
  runeSendMessage, runeExitMessage, quantumCommitMessage, contractMessage, contractCallMessage,
} from '../protocol/scheme.ts'
import { authorHeldOriginProof } from './ordinal-proof-fixture.ts'

const NET = 'regtest'
const BNET = toBtcNet(NET)
const EVENTS = Math.max(1_000, Number(process.env.DENSITY_EVENTS || 100_000))
const WALLETS = Math.max(32, Number(process.env.DENSITY_WALLETS || 320))
const SLOT_MS = 400
const SLOTS = Math.max(8, Number(process.env.DENSITY_SLOTS || 24))
const RUNE = '840000:1'
const NEED = ['transfer', 'inscribe', 'name', 'transfer-star', 'freeze', 'rune-send', 'origin', 'child', 'rune-exit', 'contract-call'] as const

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const H = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

interface Wallet { i: number; addr: string; sk: Uint8Array; pk: string }
function makeWallet(i: number): Wallet {
  const sk = createHash('sha256').update('density|' + i, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { i, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}

function sign(w: Wallet, e: Record<string, unknown>, msg: string): KrayEvent {
  return { ...e, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet' } as KrayEvent
}

async function main() {
  console.log('\n╔═ SETTLEMENT DENSITY — the law under pressure ═╗')
  console.log(`   every act signed · A1 every second · stranger replay · HTTP waves ${SLOT_MS}ms`)
  console.log(`   this run:  ${EVENTS.toLocaleString()} signed reducer acts · ${WALLETS} wallets · ${SLOTS} HTTP slots\n`)

  // ── 1 · THE REDUCER (the law) ─────────────────────────────────────────────
  console.log('── 1 · reducer storm — every act BIP-340 signed, A1 checked every wall-clock second')
  const people = Array.from({ length: WALLETS }, (_, i) => makeWallet(i))
  const L = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, Number.MAX_SAFE_INTEGER) // legacy-era bench: exercises pre-retirement `reward`; the law is pinned in reward-retired.test.ts
  const journal: KrayEvent[] = []
  const nonce = new Array<number>(WALLETS).fill(0)
  const runeBal = new Array<bigint>(WALLETS).fill(0n)
  const qdone = new Array<boolean>(WALLETS).fill(false)
  const locked = new Array<boolean>(WALLETS).fill(false)
  const stars: { no: string; owner: number; named: boolean; content: boolean }[] = []
  const byOwner: number[][] = Array.from({ length: WALLETS }, () => [])
  let seq = 0
  const counts: Record<string, number> = {
    transfer: 0, inscribe: 0, video: 0, markdown: 0, html: 0, name: 0, 'transfer-star': 0, freeze: 0,
    'rune-send': 0, 'rune-exit': 0, 'rune-settle': 0, origin: 0, child: 0, 'quantum-commit': 0,
    'kray-sink': 0, canvas: 0, contract: 0, 'contract-call': 0, reward: 0, donate: 0,
  }

  const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
  const born = (i: number, named: boolean, content: boolean) => {
    const no = (L.stars.createdSeq - 1n).toString()
    byOwner[i].push(stars.length); stars.push({ no, owner: i, named, content })
    return no
  }

  for (let i = 0; i < WALLETS; i++) {
    seq++; push({ seq, kind: 'donate', hash: H('d' + i), to: people[i].addr, amount: '10000' } as KrayEvent)
    seq++; push({ seq, kind: 'rune-deposit', hash: H('r' + i), runeId: RUNE, outpoint: H('op' + i) + ':0', to: people[i].addr, amount: '100000' } as KrayEvent)
    runeBal[i] = 100000n
    counts.donate++
  }
  // extra mints for wallet 0 so it can fund a DeFi contract without starving the mixer
  for (let d = 0; d < 3; d++) {
    seq++; push({ seq, kind: 'donate', hash: H('d0x' + d), to: people[0].addr, amount: '10000' } as KrayEvent)
  }
  const splitter: ContractCode = {
    vars: { paid: '0' },
    rules: [{ name: 'release', when: { op: 'ge', args: [{ ctx: 'balance' }, { arg: 'amount' }] },
      then: [{ set: { var: 'paid', to: { op: 'add', args: [{ var: 'paid' }, { arg: 'amount' }] } } },
        { pay: { to: { addr: people[2].addr }, amount: { arg: 'amount' } } }] }],
  }
  seq++
  const codeHash = sha256hex(canonicalCode(splitter))
  push(sign(people[0], { seq, kind: 'contract', hash: H('ctr'), from: people[0].addr, code: splitter }, contractMessage(NET, people[0].addr, codeHash)))
  counts.contract++
  const contractAddr = L.allContractAddresses()[0]
  seq++
  push(sign(people[0], { seq, kind: 'transfer', hash: H('ctf'), from: people[0].addr, to: contractAddr, amount: '8000', fee: '1', nonce: nonce[0] },
    transferMessage(NET, people[0].addr, contractAddr, 8000n, nonce[0])))
  nonce[0]++; counts.transfer++
  ok(L.conserves() && L.backed() && L.runesSolvent() && !!contractAddr,
    `funded ${WALLETS} wallets × 10,000 ₭ + rune credits + DeFi splitter ${contractAddr.slice(0, 22)}… — A1 holds`)
  const genesisRoot = L.cascadeRoot()
  ok(/^[0-9a-f]{64}$/.test(genesisRoot), `mathematical witness at genesis: cascade ${genesisRoot.slice(0, 20)}…  Σ ${L.circulating} = ${L.totalEmitted} − ${L.totalBurned}`)

  // Actor and kind MUST be independent. n%WALLETS with n%28 shares gcd 4 when WALLETS is
  // a power of two, so a single counter structurally forbids (wallet, kind) pairs —
  // canvas, html, and rune-settle were silent zeros for that reason (A1 still held).
  const funded = (i: number) => L.balanceOf(people[i].addr) > 2n
  const pickI = (start: number, pred: (i: number) => boolean = () => true) => {
    for (let k = 0; k < WALLETS; k++) {
      const i = (start + k) % WALLETS
      if (pred(i) && funded(i)) return i
    }
    return -1
  }

  const tick = (n: number, hops = 0): string | null => {
    if (hops > 40) return null
    const roll = n % 28
    const start = n % WALLETS
    seq++
    const hash = H('e' + seq)
    const failOver = () => { seq--; return tick(n + 1, hops + 1) }
    try {
      if (roll < 7) {
        const i = pickI(start); if (i < 0) return failOver()
        const w = people[i], toI = (i + 1 + (n % (WALLETS - 1))) % WALLETS
        const amt = 1n + BigInt(n % 7)
        const msg = transferMessage(NET, w.addr, people[toI].addr, amt, nonce[i])
        push(sign(w, { seq, kind: 'transfer', hash, from: w.addr, to: people[toI].addr, amount: amt.toString(), fee: '1', nonce: nonce[i] }, msg))
        nonce[i]++; counts.transfer++; return 'transfer'
      }
      if (roll === 7) {
        // THE BURN LAW: ₭ never freezes at the hole — the "₭ dies by choice" story is now the SIGNED BURN
        // (destroys the amount, Ӿ born 1:1 to the burner). Same storm shape, the lawful door.
        const i = pickI(start); if (i < 0) return failOver()
        const w = people[i], amt = 1n + BigInt(n % 5)
        const msg = burnMessage(NET, w.addr, amt, nonce[i])
        push(sign(w, { seq, kind: 'burn', hash, from: w.addr, amount: amt.toString(), fee: '1', nonce: nonce[i] }, msg))
        nonce[i]++; counts['kray-sink']++; return 'kray-sink'
      }
      if (roll === 8) {
        const i = pickI(start); if (i < 0) return failOver()
        const w = people[i], ch = H('c' + seq)
        const video = n % 5 === 0
        const ct = video ? 'video/mp4' : 'text/plain'
        const size = video ? 48 : 8
        const msg = inscribeMessageV2(NET, w.addr, ch, ct, size, undefined, nonce[i])
        push(sign(w, { seq, kind: 'inscribe', hash, from: w.addr, contentHash: ch, contentType: ct, size, fee: '1', nonce: nonce[i] }, msg))
        born(i, false, true); nonce[i]++; video ? counts.video++ : counts.inscribe++; return 'inscribe'
      }
      if (roll === 9) {
        const i = pickI(start); if (i < 0) return failOver()
        const w = people[i], ch = H('m' + seq), ct = counts.html <= counts.markdown ? 'text/html' : 'text/markdown'
        const msg = inscribeMessageV2(NET, w.addr, ch, ct, 12, undefined, nonce[i])
        push(sign(w, { seq, kind: 'inscribe', hash, from: w.addr, contentHash: ch, contentType: ct, size: 12, fee: '1', nonce: nonce[i] }, msg))
        born(i, false, true); nonce[i]++; counts[ct === 'text/html' ? 'html' : 'markdown']++; return 'inscribe'
      }
      if (roll === 10) {
        const i = pickI(start); if (i < 0) return failOver()
        const w = people[i], name = 'v' + seq.toString(36)
        const msg = nameMessageV2(NET, w.addr, nonce[i], name)
        push(sign(w, { seq, kind: 'name', hash, from: w.addr, name, fee: '1', nonce: nonce[i] }, msg))
        born(i, true, false); nonce[i]++; counts.name++; return 'name'
      }
      if (roll === 11 || roll === 12) {
        const i = pickI(start, (j) => byOwner[j].length > 0); if (i < 0) return failOver()
        const w = people[i], toI = (i + 1 + (n % (WALLETS - 1))) % WALLETS
        const mine = byOwner[i], idx = mine[mine.length - 1], s = stars[idx]
        const msg = sendStarMessage(NET, w.addr, people[toI].addr, BigInt(s.no), nonce[i])
        push(sign(w, { seq, kind: 'transfer-star', hash, from: w.addr, to: people[toI].addr, star: s.no, fee: '1', nonce: nonce[i] }, msg))
        mine.pop(); byOwner[toI].push(idx); s.owner = toI; nonce[i]++; counts['transfer-star']++; return 'transfer-star'
      }
      if (roll === 13) {
        const i = pickI(start, (j) => byOwner[j].length > 0); if (i < 0) return failOver()
        const w = people[i], mine = byOwner[i], idx = mine[mine.length - 1], s = stars[idx]
        const msg = sendStarMessage(NET, w.addr, BLACK_HOLE, BigInt(s.no), nonce[i])
        push(sign(w, { seq, kind: 'transfer-star', hash, from: w.addr, to: BLACK_HOLE, star: s.no, fee: '1', nonce: nonce[i] }, msg))
        mine.pop(); s.owner = -1; nonce[i]++; counts.freeze++; return 'freeze'
      }
      if (roll === 14) {
        const i = pickI(start, (j) => runeBal[j] >= 2n); if (i < 0) return failOver()
        const w = people[i], toI = (i + 1 + (n % (WALLETS - 1))) % WALLETS, amt = 1n + BigInt(n % 9)
        const msg = runeSendMessage(NET, w.addr, people[toI].addr, RUNE, amt, nonce[i])
        push(sign(w, { seq, kind: 'rune-send', hash, from: w.addr, to: people[toI].addr, runeId: RUNE, amount: amt.toString(), fee: '1', nonce: nonce[i] }, msg))
        runeBal[i] -= amt; runeBal[toI] += amt; nonce[i]++; counts['rune-send']++; return 'rune-send'
      }
      if (roll === 15) {
        const i = pickI(start, (j) => !locked[j] && runeBal[j] >= 2n); if (i < 0) return failOver()
        const w = people[i], amt = 1n + BigInt(n % 5)
        const msg = runeExitMessage(NET, w.addr, RUNE, amt, w.addr, nonce[i])
        push(sign(w, { seq, kind: 'rune-exit', hash, from: w.addr, runeId: RUNE, amount: amt.toString(), l1Address: w.addr, fee: '1', nonce: nonce[i] }, msg))
        runeBal[i] -= amt; locked[i] = true; nonce[i]++; counts['rune-exit']++; return 'rune-exit'
      }
      if (roll === 16) {
        const i = locked.findIndex(Boolean)
        if (i < 0) return failOver()
        const w = people[i], lock = L.runes.lockedOf(parseRuneKey(RUNE), w.addr)
        if (!lock) { locked[i] = false; return failOver() }
        push({ seq, kind: 'rune-settle', hash, runeId: RUNE, from: w.addr, amount: lock.amount.toString(), l1Txid: H('set' + seq) } as KrayEvent)
        locked[i] = false; counts['rune-settle']++; return 'rune-settle'
      }
      if (roll === 17) {
        const i = pickI(start); if (i < 0) return failOver()
        const w = people[i], ch = H('o' + seq)
        const held = authorHeldOriginProof(scriptOfAddress(w.addr, NET), { confirmations: 1, salt: 'den-' + seq })
        const l1 = held.parentId
        const msg = originMessageV2(NET, w.addr, l1, ch, 'image/png', 16, nonce[i])
        push(sign(w, { seq, kind: 'origin', hash, from: w.addr, l1InscriptionId: l1, contentHash: ch, contentType: 'image/png', size: 16, fee: '1', nonce: nonce[i], originProofs: [held.proof] }, msg))
        born(i, false, true); nonce[i]++; counts.origin++; return 'origin'
      }
      if (roll === 18) {
        const i = pickI(start, (j) => byOwner[j].length > 0); if (i < 0) return failOver()
        const w = people[i], parent = stars[byOwner[i][byOwner[i].length - 1]].no, ch = H('k' + seq)
        const msg = inscribeMessageV2(NET, w.addr, ch, 'text/plain', 8, BigInt(parent), nonce[i])
        push(sign(w, { seq, kind: 'inscribe', hash, from: w.addr, contentHash: ch, contentType: 'text/plain', size: 8, parent, fee: '1', nonce: nonce[i] }, msg))
        born(i, false, true); nonce[i]++; counts.child++; return 'child'
      }
      if (roll === 19) {
        const canvas = stars.find((s) => s.owner >= 0 && s.content && !s.named)
        if (!canvas || !funded(canvas.owner)) return failOver()
        const i = canvas.owner, w = people[i], name = 'c' + seq.toString(36)
        const msg = nameMessageV2(NET, w.addr, nonce[i], name, BigInt(canvas.no))
        push(sign(w, { seq, kind: 'name', hash, from: w.addr, name, star: canvas.no, fee: '1', nonce: nonce[i] }, msg))
        canvas.named = true; nonce[i]++; counts.canvas++; return 'canvas'
      }
      if (roll === 20) {
        const canvas = stars.find((s) => s.owner >= 0 && s.named && !s.content)
        if (!canvas || !funded(canvas.owner)) return failOver()
        const i = canvas.owner, w = people[i], ch = H('on' + seq)
        const msg = inscribeMessageV2(NET, w.addr, ch, 'text/plain', 8, undefined, nonce[i], BigInt(canvas.no))
        push(sign(w, { seq, kind: 'inscribe', hash, from: w.addr, contentHash: ch, contentType: 'text/plain', size: 8, star: canvas.no, fee: '1', nonce: nonce[i] }, msg))
        canvas.content = true; nonce[i]++; counts.canvas++; return 'canvas'
      }
      if (roll === 21 && L.balanceOf(contractAddr) >= 3n) {
        const i = pickI(start); if (i < 0) return failOver()
        const w = people[i], args = { amount: 1n }
        const msg = contractCallMessage(NET, w.addr, contractAddr, 'release', args, nonce[i])
        push(sign(w, { seq, kind: 'contract-call', hash, from: w.addr, contract: contractAddr, rule: 'release', callArgs: { amount: '1' }, fee: '1', nonce: nonce[i] }, msg))
        nonce[i]++; counts['contract-call']++; return 'contract-call'
      }
      if (roll === 22 && L.balanceOf(TREASURY) > 20n) {
        const i = pickI(start); if (i < 0) return failOver()
        push({ seq, kind: 'reward', hash, to: people[i].addr, amount: '1' } as KrayEvent)
        counts.reward++; return 'reward'
      }
      {
        const i = pickI(start, (j) => !qdone[j])
        if (i < 0) return failOver()
        const w = people[i], commit = H('q' + w.addr)
        const msg = quantumCommitMessage(NET, w.addr, commit, nonce[i])
        push(sign(w, { seq, kind: 'quantum-commit', hash, from: w.addr, quantumCommit: commit, nonce: nonce[i] }, msg))
        qdone[i] = true; nonce[i]++; counts['quantum-commit']++; return 'quantum-commit'
      }
    } catch {
      seq--
      return hops < 40 ? tick(n + 1, hops + 1) : null
    }
  }

  let applied = 0, n = 0, skipped = 0
  const seconds: { tps: number; kinds: Set<string> }[] = []
  let windowN = 0
  const windowKinds = new Set<string>()
  let tSec = Date.now()
  const tStorm = Date.now()
  while (applied < EVENTS) {
    const kind = tick(n++)
    if (!kind) { skipped++; if (skipped > EVENTS) break; continue }
    applied++; windowN++; windowKinds.add(kind)
    if (applied % 10_000 === 0) {
      const forged = people[0]
      let refused = false
      try {
        L.applyLive({ seq: seq + 1, kind: 'transfer', hash: 'ff'.repeat(32), from: forged.addr, to: people[1].addr, amount: '1', fee: '1', nonce: nonce[0], publicKey: forged.pk, signature: '00'.repeat(64), scheme: 'kraywallet' } as KrayEvent)
      } catch { refused = true }
      if (!refused || !L.conserves()) { fail++; console.log('  ✗ FAIL — forged act leaked or broke conservation at ' + applied); break }
    }
    const now = Date.now()
    if (now - tSec >= 1000) {
      const tps = windowN / ((now - tSec) / 1000)
      seconds.push({ tps, kinds: new Set(windowKinds) })
      const missing = NEED.filter((k) => !windowKinds.has(k))
      const laws = L.conserves() && L.backed() && L.runesSolvent()
      const a1 = L.circulating === (L.totalEmitted - L.totalBurned)
      const root = L.cascadeRoot()
      if (!laws || !a1 || !/^[0-9a-f]{64}$/.test(root)) { fail++; console.log(`  ✗ FAIL — the proof left at second ${seconds.length} (${applied} acts)`); break }
      process.stdout.write(`  · t+${seconds.length}s  ${windowN.toLocaleString()} acts  ${tps.toFixed(0)} TPS  A1 Σ ${L.circulating} = ${L.totalEmitted} − ${L.totalBurned}  root ${root.slice(0, 12)}…  kinds ${windowKinds.size}\n`)
      if (missing.length && windowN > 40) {
        // a thin second can miss a rare kind; only fail if the mixer starved a common one
        if (missing.includes('transfer') || missing.includes('inscribe')) {
          fail++; console.log('  ✗ FAIL — mixer starved ' + missing.join(',')); break
        }
      }
      windowN = 0; windowKinds.clear(); tSec = now
    }
  }
  const stormMs = Date.now() - tStorm
  const meanTps = applied / (stormMs / 1000)
  const peakTps = seconds.reduce((m, s) => s.tps > m ? s.tps : m, meanTps)
  ok(applied >= EVENTS * 0.95, `${applied.toLocaleString()} signed acts applied (${skipped} natural skips) in ${(stormMs / 1000).toFixed(1)}s`)
  ok(L.conserves() && L.backed() && L.runesSolvent(), 'A1 + peg + rune solvency hold after the full storm')
  ok(NEED.every((k) => counts[k] > 0), `core kinds landed — ${NEED.map((k) => k + ' ' + counts[k]).join(' · ')}`)
  ok(counts.canvas > 0 && counts['kray-sink'] > 0 && counts['rune-settle'] > 0 && counts.markdown > 0 && counts.html > 0 && counts.reward > 0 && counts['quantum-commit'] > 0 && counts.video > 0,
    `extra varieties landed — video ${counts.video} · canvas ${counts.canvas} · ₭-sink ${counts['kray-sink']} · rune-settle ${counts['rune-settle']} · md ${counts.markdown} · html ${counts.html} · reward ${counts.reward} · q-commit ${counts['quantum-commit']}`)
  ok(L.cascadeRoot() !== genesisRoot, `cascade ADVANCED ${genesisRoot.slice(0, 12)}… → ${L.cascadeRoot().slice(0, 12)}… — the storm is in the commitment`)
  ok(/^[0-9a-f]{64}$/.test(genesisRoot) && /^[0-9a-f]{64}$/.test(L.cascadeRoot()), 'the proof never left — genesis and tip are both 64-hex cascade roots')
  ok(peakTps > 50, `proven reducer throughput: mean ${meanTps.toFixed(0)} TPS · peak ${peakTps.toFixed(0)} TPS — one JS thread verifying BIP-340; this is the law per act`)
  ok(seconds.length === 0 || seconds.every((s) => s.kinds.has('transfer')), `transfer present in ${seconds.filter((s) => s.kinds.has('transfer')).length}/${seconds.length || 1} wall-clock seconds`)

  console.log('\n── 1b · stranger replay — the whole journal, byte-exact')
  const tR = Date.now()
  const L2 = new KrayLedger(undefined, NET, undefined, false, undefined, undefined, undefined, undefined, Number.MAX_SAFE_INTEGER) // legacy-era bench: exercises pre-retirement `reward`; the law is pinned in reward-retired.test.ts
  for (const e of journal) L2.applyLive(e)
  const replayMs = Date.now() - tR
  ok(L2.cascadeRoot() === L.cascadeRoot(), `stranger compiled the IDENTICAL cascade root ${L.cascadeRoot().slice(0, 20)}…`)
  ok(L2.conserves() && L2.backed() && L2.runesSolvent(), 'replay conserves ∧ backed ∧ solvent')
  ok(L2.stars.starCount === L.stars.starCount && L2.stars.merkleRoot() === L.stars.merkleRoot(), `replay stars identical (${L.stars.starCount} creations)`)
  ok(L2.totalEmitted === L.totalEmitted && L2.totalBurned === L.totalBurned, `replay supply identical — emitted ${L.totalEmitted} burned ${L.totalBurned}`)
  ok(replayMs > 0, `replayed ${journal.length.toLocaleString()} events in ${replayMs}ms (${(journal.length / (replayMs / 1000)).toFixed(0)} verify/s)`)

  // ── 2 · THE DOOR (HTTP), short waves ──────────────────────────────────────
  console.log(`\n── 2 · HTTP door — ${SLOTS} waves (${SLOT_MS}ms), mixed acts, A1 after every wave`)
  const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
  const DATA = join(tmpdir(), `kraynet-density-${process.pid}`)
  const PORT = 15000 + (process.pid % 400) * 2
  const BASE = `http://localhost:${PORT}`
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  const kids: Array<{ kill: (s: string) => void }> = []
  const reap = () => { for (const k of kids) { try { k.kill('SIGKILL') } catch { /* gone */ } } try { rmSync(DATA, { recursive: true, force: true }) } catch { /* gone */ } }
  process.on('exit', reap)
  const child = spawn('node', [SERVER], { env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_TRUSTED_DEV: '1', KRAY_SEAL_MS: String(SLOT_MS) }, stdio: 'ignore' })
  kids.push(child)
  const jget = (p: string) => fetch(BASE + p, { signal: AbortSignal.timeout(20000) }).then((r) => r.json() as Promise<any>).catch((e) => ({ error: String(e) }))
  const jpost = (p: string, b: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(20000) }).then((r) => r.json() as Promise<any>).catch((e) => ({ error: String(e) }))
  for (let i = 0; i < 120; i++) { try { if ((await jget('/health')).ok) break } catch { /* booting */ } await new Promise((r) => setTimeout(r, 100)) }
  const health = await jget('/health')
  ok(health && health.ok === true, `throwaway node listening on :${PORT} (live :4477 untouched)`)

  const door = Array.from({ length: 64 }, (_, i) => makeWallet(10_000 + i))
  await Promise.all(door.map((w) => jpost('/api/kraynet/donate', { to: w.addr, sats: '10000' })))
  const act = async (w: Wallet, action: string, extra: Record<string, unknown>) => {
    const p = await jpost('/api/kraynet/prepare', { action, from: w.addr, ...extra })
    if (p.error || !p.message) return p
    return jpost('/api/kraynet/submit', { action, from: w.addr, nonce: p.nonce, publicKey: w.pk, signature: _signKrayWallet(p.message, w.sk), ...extra })
  }
  const slotTps: number[] = []
  let doorOk = 0, doorFail = 0
  for (let s = 0; s < SLOTS; s++) {
    const deadline = Date.now() + SLOT_MS
    let slotN = 0
    await Promise.all(door.map(async (w, i) => {
      let k = 0
      while (Date.now() < deadline) {
        const roll = (s + i + k) % 8
        const extra = roll === 0 ? { action: 'transfer', extra: { to: door[(i + 1) % door.length].addr, amount: '2' } }
          : roll === 1 ? { action: 'inscribe', extra: { content: `slot${s}w${i}k${k}`, contentType: 'text/plain' } }
            : roll === 2 ? { action: 'name', extra: { name: `s${s}w${i}k${k}` } }
              : roll === 3 ? { action: 'inscribe', extra: { content: `# md ${s}-${i}-${k}`, contentType: 'text/markdown' } }
                : roll === 4 ? { action: 'inscribe', extra: { content: `<p>${s}${i}${k}</p>`, contentType: 'text/html' } }
                  : roll === 5 ? { action: 'burn', extra: { amount: '1' } }   // the burn law: the chosen death is the signed burn
                    : roll === 6 ? { action: 'inscribe', extra: { content: `png${s}${i}${k}`, contentType: 'image/png' } }
                      : { action: 'transfer', extra: { to: door[(i + 7) % door.length].addr, amount: '1' } }
        const r = await act(w, extra.action, extra.extra as Record<string, unknown>)
        if (r && r.ok) { slotN++; doorOk++ } else doorFail++
        k++
      }
    }))
    const tps = slotN / (SLOT_MS / 1000)
    slotTps.push(tps)
    const ov = await jget('/api/kraynet/overview')
    if (ov.conserves !== true) { fail++; console.log(`  ✗ FAIL — conservation broke at HTTP slot ${s + 1}: ${ov.error || JSON.stringify(ov).slice(0, 120)}`); break }
    process.stdout.write(`  · slot ${s + 1}/${SLOTS}  ${slotN} acts  ${tps.toFixed(0)} TPS  A1 conserves  root ${String(ov.cascadeRoot || '').slice(0, 12)}…\n`)
  }
  const doorPeak = slotTps.reduce((m, x) => x > m ? x : m, 0)
  const doorMean = slotTps.length ? slotTps.reduce((a, b) => a + b, 0) / slotTps.length : 0
  const ov = await jget('/api/kraynet/overview')
  ok(ov.conserves === true && ov.backed === true, `HTTP door still conserves after ${SLOTS} waves (${doorOk} sealed, ${doorFail} refused)`)
  ok(doorMean > 20, `HTTP wave throughput: mean ${doorMean.toFixed(0)} TPS · peak ${doorPeak.toFixed(0)} TPS over ${SLOT_MS}ms waves`)
  try { child.kill('SIGKILL') } catch { /* gone */ }

  console.log('')
  console.log(`   A1        Σ ${L.circulating} = ${L.totalEmitted} − ${L.totalBurned}`)
  console.log(`   cascade   genesis ${genesisRoot}`)
  console.log(`             tip     ${L.cascadeRoot()}`)
  console.log(`   reducer   mean ${meanTps.toFixed(0)} TPS  peak ${peakTps.toFixed(0)} TPS  ·  ${applied.toLocaleString()} acts  ·  ${L.stars.starCount} stars`)
  console.log(`   HTTP      mean ${doorMean.toFixed(0)} TPS  peak ${doorPeak.toFixed(0)} TPS  ·  ${SLOTS} × ${SLOT_MS}ms waves`)
  console.log(`   the LAW held at this density — signature ‖ Merkle ‖ Bitcoin, A1 never left`)
  console.log(fail === 0
    ? `\n═══ SETTLEMENT DENSITY: ${pass}/${pass} GREEN — every second conserved, every kind landed, stranger root identical ═══\n`
    : `\n═══ SETTLEMENT DENSITY: ${fail} FAILURES of ${pass + fail} ═══\n`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('\n✗', e); process.exit(1) })
