/**
 * THE TK-FOLD GOLDEN VECTORS (Gate 1a) — the bridge every second implementation must cross:
 *   node src/test/tk-fold-vectors.test.ts            verify the frozen vectors (the suite's mode)
 *   node src/test/tk-fold-vectors.test.ts --regen    regenerate (ONLY after a ratified spec change)
 *
 * The frozen file `vectors/tk-fold.golden.json` carries REAL signed transfers (schnorr over the
 * lane's own domain) and the byte-exact outputs the spec produces: preRoot, postRoot, diffsHash,
 * the sorted diffs, and the applied/refused/deferred counts. The Gate 1 exit criterion is that the
 * zkVM guest (Rust, SP1) reproduces EVERY field of EVERY vector byte-for-byte — one spec, two
 * implementations, zero drift. Until then, this exam guards the TypeScript reference itself:
 * any accidental change to ordering, hashing, refusal law or diff shape breaks a vector loudly.
 *
 * Signatures are frozen IN the file (BIP340 uses aux randomness, so re-signing yields different
 * bytes — but the fold's outputs never depend on signature bytes, only on the SIGNED MESSAGE:
 * the order key is `sha256(message)`. Regeneration therefore changes signatures but must NOT
 * change any root/diff/count unless the spec itself changed — `--regen` prints a diff verdict.)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, xSendMessage } from '../protocol/scheme.ts'
import { emptyLane, foldBreath, tkFoldSendMessage, type LaneTransfer, type LaneState } from '../protocol/tk-fold.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const GOLDEN = join(HERE, 'vectors', 'tk-fold.golden.json')
const NET = 'regtest'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('tk-fold-vectors|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B'), C = wallet('C'), D = wallet('D')

function signed(w: ReturnType<typeof wallet>, to: string, amount: bigint, nonce: number): LaneTransfer {
  const sig = _signKrayWallet(tkFoldSendMessage(NET, w.addr, to, amount, nonce), w.sk)
  return { from: w.addr, to, amount: amount.toString(), nonce, publicKey: w.pk, signature: sig, scheme: 'kraywallet' }
}

interface VectorPre { balances: Array<[string, string]>; nonces: Array<[string, number]> }
interface Vector {
  name: string
  network: string
  pre: VectorPre
  transfers: LaneTransfer[]
  expected: {
    preRoot: string; postRoot: string; diffsHash: string
    applied: number; refused: number; deferred: number
    diffs: { balances: Array<[string, string]>; nonces: Array<[string, number]> }
  }
}

const toState = (p: VectorPre): LaneState => {
  const s = emptyLane()
  for (const [a, b] of p.balances) s.balances.set(a, BigInt(b))
  for (const [a, n] of p.nonces) s.nonces.set(a, n)
  return s
}
const preOf = (entries: Array<[string, bigint]>): VectorPre =>
  ({ balances: entries.map(([a, b]) => [a, b.toString()] as [string, string]), nonces: [] })

/** Build the six scenarios — real keys, real signatures, every refusal law exercised. */
function buildScenarios(): Array<{ name: string; pre: VectorPre; transfers: LaneTransfer[] }> {
  // V1 — a plain breath: chains across 4 accounts
  const v1: LaneTransfer[] = [
    signed(A, B.addr, 25n, 0), signed(A, C.addr, 10n, 1),
    signed(B, D.addr, 40n, 0), signed(C, A.addr, 5n, 0),
    signed(D, B.addr, 15n, 0), signed(A, D.addr, 1n, 2),
  ]
  // V2 — same-nonce rivals: a true double-spend, exactly one may win (by hash order)
  const v2: LaneTransfer[] = [signed(A, B.addr, 30n, 0), signed(A, C.addr, 30n, 0)]
  // V3 — the refusal laws: forged signature, overdraft, zero amount, self-send
  const v3: LaneTransfer[] = [
    { ...signed(A, B.addr, 50n, 0), signature: '00'.repeat(64) },   // forged
    signed(A, B.addr, 10n, 0),                                      // honest, same nonce — must land
    signed(B, C.addr, 999999n, 0),                                  // overdraft
    signed(C, D.addr, 0n, 0),                                       // zero amount
    signed(D, D.addr, 5n, 0),                                       // self-send
  ]
  // V4 — the Creator's bot, compact edition: 100 ping-pong sends, 2 diff lines
  const v4: LaneTransfer[] = []
  for (let i = 0; i < 50; i++) { v4.push(signed(A, B.addr, 1n, i)); v4.push(signed(B, A.addr, 1n, i)) }
  // V5 — an empty breath: the root must not move
  // V6 — cross-domain replay: a JOURNAL x-send signature at the lane door
  const xsig = _signKrayWallet(xSendMessage(NET, A.addr, B.addr, 50n, 0), A.sk)
  const v6: LaneTransfer[] = [{ from: A.addr, to: B.addr, amount: '50', nonce: 0, publicKey: A.pk, signature: xsig, scheme: 'kraywallet' }]

  const rich = preOf([[A.addr, 100n], [B.addr, 100n], [C.addr, 100n], [D.addr, 100n]])
  return [
    { name: 'V1 plain breath — chains across 4 accounts', pre: rich, transfers: v1 },
    { name: 'V2 same-nonce rivals — one wins by hash order', pre: preOf([[A.addr, 100n]]), transfers: v2 },
    { name: 'V3 refusal laws — forged/overdraft/zero/self', pre: rich, transfers: v3 },
    { name: 'V4 the bot — 100 sends between 2 addresses', pre: preOf([[A.addr, 500n], [B.addr, 500n]]), transfers: v4 },
    { name: 'V5 empty breath — the root does not move', pre: rich, transfers: [] },
    { name: 'V6 cross-domain replay — journal signature refused', pre: preOf([[A.addr, 100n]]), transfers: v6 },
  ]
}

function computeVector(s: { name: string; pre: VectorPre; transfers: LaneTransfer[] }): Vector {
  const r = foldBreath(NET, toState(s.pre), s.transfers)
  return {
    name: s.name, network: NET, pre: s.pre, transfers: s.transfers,
    expected: {
      preRoot: r.preRoot, postRoot: r.postRoot, diffsHash: r.diffsHash,
      applied: r.applied.length, refused: r.refused.length, deferred: r.deferred.length,
      diffs: r.diffs,
    },
  }
}

function main() {
  const regen = process.argv.includes('--regen')
  console.log('\n╔═ THE TK-FOLD GOLDEN VECTORS — one spec, every implementation, zero drift ═╗\n')

  if (regen || !existsSync(GOLDEN)) {
    const fresh = buildScenarios().map(computeVector)
    if (existsSync(GOLDEN)) {
      // Regeneration verdict: signatures may differ (BIP340 aux randomness); the MATHEMATICS must not.
      const old = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Vector[]
      const drift = fresh.some((v, i) => !old[i] || old[i].expected.postRoot !== v.expected.postRoot
        || old[i].expected.diffsHash !== v.expected.diffsHash)
      console.log(drift
        ? '  ⚠ REGENERATED WITH ROOT DRIFT — the spec changed; this must be a ratified change or a bug'
        : '  regenerated — signatures refreshed, every root and diff byte-identical (no spec drift)')
    }
    mkdirSync(dirname(GOLDEN), { recursive: true })
    writeFileSync(GOLDEN, JSON.stringify(fresh, null, 1) + '\n')
    console.log(`  wrote ${fresh.length} vectors → ${GOLDEN}\n`)
  }

  const vectors = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Vector[]
  for (const v of vectors) {
    const r = foldBreath(v.network, toState(v.pre), v.transfers)
    const e = v.expected
    const match = r.preRoot === e.preRoot && r.postRoot === e.postRoot && r.diffsHash === e.diffsHash
      && r.applied.length === e.applied && r.refused.length === e.refused && r.deferred.length === e.deferred
      && JSON.stringify(r.diffs) === JSON.stringify(e.diffs)
    ok(match, `${v.name} → postRoot ${e.postRoot.slice(0, 12)}… (${e.applied} applied, ${e.refused} refused, ${e.deferred} deferred)`)
  }

  // The vectors must themselves obey the laws they exist to pin:
  const v2 = vectors[1], v5 = vectors[4], v6 = vectors[5]
  ok(v2.expected.applied === 1 && v2.expected.deferred === 1, 'V2 pins the rival law: exactly one same-nonce act lands')
  ok(v5.expected.preRoot === v5.expected.postRoot && v5.expected.applied === 0, 'V5 pins the empty breath: root unmoved')
  ok(v6.expected.applied === 0 && v6.expected.refused === 1, 'V6 pins the domain wall: a journal signature never enters the lane')
  const v4 = vectors[3]
  ok(v4.expected.applied === 100 && v4.expected.diffs.balances.length === 2, 'V4 pins the fold: 100 sends → 2 balance diff lines')

  console.log(`\n═ tk-fold-vectors: ${pass} passed, ${fail} failed ═\n`)
  if (fail > 0) process.exit(1)
}
main()
