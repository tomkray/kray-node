/**
 * THE JOURNAL, IN PIECES, EACH PROVING ITSELF (ADR-2 · slice 2a).
 *
 *   node src/test/journal-chunks.test.ts
 *
 * "If every official server vanishes, the data + rules + Bitcoin still rebuild the truth." This proves
 * the foundation: a real journal cut into content-addressed chunks, where —
 *   · each chunk SELF-VERIFIES against a PRE-COMMITTED boundary (fetched from an untrusted peer for bytes);
 *   · the manifest reconstructs genesis → the anchored head, so a dropped/reordered/tampered chunk is refused;
 *   · a tampered field VALUE breaks BOTH the content address and the hash-chain;
 *   · a hash-consistent-but-non-monotonic-seq span (seq=[1,1,1]) is refused — parity with the store's guard;
 *   · a forged self-consistent chunk against an ATTACKER-chosen boundary passes on its own, but the manifest
 *     against the TRUE anchored head refuses it — authenticity lives in the head, not the isolated chunk;
 *   · the chunks REASSEMBLE into the exact journal — a fresh node replays them to the identical cascade root.
 *
 * The chunk chain reuses the store's own GENESIS_HASH/sha256hex/canonical AND its strictly-incrementing
 * seq rule; it does NOT run applyLive (signatures/economics) — that validity comes on reassembly + replay.
 * Pure — wired into no live path.
 */
import { rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayNode } from '../protocol/node.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, inscribeMessageV2 } from '../protocol/scheme.ts'
import { GENESIS_HASH, sha256hex, canonical } from '../protocol/kray-primitives.ts'
import { chunkJournal, verifyChunk, verifyChunkChain, verifyManifest, chunkAddress, type JournalChunk } from '../protocol/journal-chunks.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

interface Wallet { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`journal-chunks|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B')
const sign = (msg: string, w: Wallet) => _signKrayWallet(msg, w.sk)
function transfer(node: KrayNode, from: Wallet, to: Wallet, amount: bigint, nonce: number) {
  node.submit({ action: 'transfer', kind: 'transfer', at: 0, from: from.addr, to: to.addr, amount: String(amount), fee: '1', nonce, publicKey: from.pk, signature: sign(transferMessage(NET, from.addr, to.addr, amount, nonce), from), scheme: 'kraywallet' } as unknown as Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'>)
}

function buildJournal(dir: string): { lines: string[]; head: string; root: string } {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const node = new KrayNode(dir, NET)
  node.donate(A.addr, 10_000n); node.donate(B.addr, 10_000n)
  for (let i = 0; i < 6; i++) transfer(node, A, B, 10n, i)
  transfer(node, B, A, 5n, 0)
  node.submit({ action: 'inscribe', kind: 'inscribe', at: 0, from: A.addr, contentHash: 'aurora-chunk', contentType: 'text/plain', size: 12, nonce: 6, publicKey: A.pk, signature: sign(inscribeMessageV2(NET, A.addr, 'aurora-chunk', 'text/plain', 12, undefined, 6), A), scheme: 'kraywallet' } as unknown as Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'>)
  const lines = readFileSync(join(dir, `kraynet-journal-${NET}.jsonl`), 'utf8').split('\n').filter(Boolean)
  const head = (JSON.parse(lines[lines.length - 1]) as { hash: string }).hash
  return { lines, head, root: node.cascadeRoot() }
}

function main() {
  console.log('\n╔═ THE JOURNAL, IN PIECES — each chunk proves itself against the anchored head ═╗\n')
  const { lines, head, root } = buildJournal(join(tmpdir(), `jc-src-${process.pid}`))
  const { chunks, head: reHead, genesis } = chunkJournal(lines, 3)

  ok(lines.length >= 9, `built a real journal of ${lines.length} events`)
  ok(reHead === head && genesis === GENESIS_HASH, 'chunkJournal reconstructs the exact head, and the first chunk chains onto GENESIS_HASH')
  ok(chunks[0].startPrevHash === GENESIS_HASH, 'chunk 0 starts at genesis')
  ok(chunks.every((c) => c.address === chunkAddress(c.lines)), 'every chunk is addressed by the SHA-256 of its own bytes')

  // ── each chunk self-verifies against its boundary (as if fetched from an untrusted peer) ──
  let allSelf = true
  for (const c of chunks) { const v = verifyChunk({ lines: c.lines, startPrevHash: c.startPrevHash, startSeq: c.startSeq, address: c.address, endHash: c.endHash }); if (!v.ok || v.endHash !== c.endHash) allSelf = false }
  ok(allSelf, `all ${chunks.length} chunks SELF-VERIFY from bytes + boundary alone — no peer is trusted for the bytes`)
  ok(verifyManifest(chunks, head).ok, 'the manifest reconstructs genesis → the anchored head')

  // ── the untrusted-peer story: ONE chunk in the middle, verified against its anchored boundary ──
  {
    const mid = chunks[Math.floor(chunks.length / 2)]
    ok(verifyChunk({ lines: mid.lines, startPrevHash: mid.startPrevHash, startSeq: mid.startSeq, address: mid.address, endHash: mid.endHash }).ok, 'a single chunk fetched from a stranger verifies against its pre-committed boundary — bytes trusted to no one')
  }

  // helper: forge a fully SELF-CONSISTENT event (its hash honestly recomputed) — the attacker's best case
  const forgeEvent = (prev: string, seq: number, body: Record<string, unknown>): string => {
    const rest = { ...body, seq, prevHash: prev }
    return JSON.stringify({ ...rest, hash: sha256hex(prev + canonical(rest)) })
  }

  // ── SEQ MONOTONICITY — a hash-consistent span with non-incrementing seq is refused (store parity) ──
  {
    const e1 = forgeEvent(GENESIS_HASH, 1, { kind: 'x', a: 1 })
    const e2 = forgeEvent(JSON.parse(e1).hash, 1, { kind: 'x', a: 2 })   // seq stays 1 — the [1,1,…] forgery
    ok(verifyChunkChain([e1], GENESIS_HASH, 1).ok, 'a single self-consistent event verifies (control)')
    ok(!verifyChunkChain([e1, e2], GENESIS_HASH, 1).ok, 'a hash-consistent span whose seq does NOT strictly increment (1,1) is REFUSED — the store\'s own guard, now in the chunk verifier')
  }

  // ── FORGERY vs the ANCHORED HEAD — a fully self-consistent forged chunk passes ALONE, but the manifest
  //    against the TRUE head refuses it: authenticity lives in the head, not the isolated chunk ──
  {
    const fe = forgeEvent(GENESIS_HASH, 1, { kind: 'lie', stolen: 'everything' })
    ok(verifyChunkChain([fe], GENESIS_HASH, 1).ok, 'a fabricated but self-consistent chunk verifies on its OWN — self-consistency is not authenticity')
    const forgedChunk: JournalChunk = { index: 0, startSeq: 1, endSeq: 1, startPrevHash: GENESIS_HASH, endHash: JSON.parse(fe).hash, address: chunkAddress([fe]), lines: [fe] }
    ok(!verifyManifest([forgedChunk], head).ok, 'the SAME forged chunk is refused by the manifest against the true anchored head — it reconstructs a different tip')
  }

  // ── TAMPER: a tampered field VALUE breaks BOTH the address and the chain ──
  {
    const c = chunks[1]
    const bad = c.lines.slice(); bad[0] = bad[0].slice(0, 25) + (bad[0][25] === 'a' ? 'b' : 'a') + bad[0].slice(26)
    ok(!verifyChunk({ lines: bad, startPrevHash: c.startPrevHash, startSeq: c.startSeq, address: c.address }).ok, 'a tampered byte breaks the CONTENT ADDRESS — refused')
    ok(!verifyChunk({ lines: bad, startPrevHash: c.startPrevHash, startSeq: c.startSeq, address: chunkAddress(bad) }).ok, 're-addressing the tampered bytes does not help — the HASH-CHAIN breaks')
    const tamperedManifest = chunks.map((x, i) => i === 1 ? { ...x, lines: bad, address: chunkAddress(bad) } : x)
    ok(!verifyManifest(tamperedManifest as JournalChunk[], head).ok, 'a tampered chunk makes the whole manifest refuse')
  }

  // ── DROP / REORDER: the boundary chain refuses a missing or swapped chunk ──
  ok(!verifyManifest(chunks.filter((_, i) => i !== 2), head).ok, 'dropping a chunk breaks the boundary chain — refused')
  {
    const swapped = chunks.slice(); const t = swapped[1]; swapped[1] = swapped[2]; swapped[2] = t
    ok(!verifyManifest(swapped, head).ok, 'reordering two chunks breaks the boundary chain — refused')
  }
  ok(!verifyManifest(chunks, 'f'.repeat(64)).ok, 'the true chunks against a FORGED head are refused — they reconstruct a different tip')

  // ── REASSEMBLE: the verified chunks ARE the journal — a fresh node replays them to the same root ──
  {
    const reLines = chunks.flatMap((c) => c.lines)
    ok(reLines.length === lines.length && reLines.every((l, i) => l === lines[i]), 'the chunks reassemble to the byte-identical journal')
    const dir2 = join(tmpdir(), `jc-re-${process.pid}`)
    rmSync(dir2, { recursive: true, force: true }); mkdirSync(dir2, { recursive: true })
    writeFileSync(join(dir2, `kraynet-journal-${NET}.jsonl`), reLines.join('\n') + '\n')
    const reNode = new KrayNode(dir2, NET)
    ok(reNode.cascadeRoot() === root, 'a fresh node built from the reassembled chunks replays to the IDENTICAL cascade root — the pieces are the truth')
    rmSync(dir2, { recursive: true, force: true })
  }

  rmSync(join(tmpdir(), `jc-src-${process.pid}`), { recursive: true, force: true })
  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the journal is fetchable in pieces from anyone, each proving itself; the network preserves the evidence. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
