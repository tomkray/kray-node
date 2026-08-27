/**
 * THE INCLUSION ROOT IN THE CASCADE (ADR-3 · Slice A) — the writer commits WHO it included, or the past breaks.
 *
 *   node src/test/inclusion-cascade.test.ts
 *
 * A cumulative Sparse-Merkle root over the SIGNED-message key of every applied act folds into the cascade root,
 * gated by an activation seq (Article XIV). This exam pins the four laws the slice must hold:
 *
 *   1. A3 — a journal ENTIRELY BELOW activation reproduces TODAY's cascade root, byte-identically (a fixed
 *      journal hits a GOLDEN captured from the pre-slice code). No anchored root is orphaned.
 *   2. AT/AFTER activation the inclusion root ALWAYS folds — even EMPTY_ROOT when only unsigned acts applied —
 *      so a writer cannot hide that it committed a set at all.
 *   3. pin 1 — the leaf is the hash of the SIGNED message ONLY: the ledger's inclusionRoot equals an independent
 *      SMT rebuilt from the same signed messages; pin 2 — donate/settlement (no requireSig) are NOT leaves.
 *   4. HOSTILE — omitting one signed act changes the inclusion root; the omitted key proves IN against the full
 *      root and OUT against the omit root (an inclusion/exclusion proof rides the anchor). A signed act that is
 *      REFUSED after its signature (overspend) never becomes a leaf.
 *
 * This slice COMMITS the included set. It does NOT by itself make an omission EVIDENT — that is 3d (a signed
 * deadline + this root in the anchor). Nothing here is sold as 3d.
 */
import { rmSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayNode } from '../protocol/node.ts'
import { KrayLedger } from '../protocol/ledger.ts'
import { DEFAULT_POT_TARGET_SATS } from '../protocol/pot.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, inscribeMessageV2 } from '../protocol/scheme.ts'
import { keyFromSignedMessage } from '../protocol/window-order.ts'
import { inclusionRoot as buildInclusionRoot, EMPTY_ROOT, proveKey, verifyProof } from '../protocol/inclusion-tree.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
// GOLDEN — the cascade root of the fixed journal below, in the PRE-Slice-A format. If the inclusion
// fold ever leaks into a pre-activation history, this breaks (that is the A3 regression this pins).
// Re-captured 2026-08-26 under THE CHAIR LAW (pot target 21,000,000 = 2,100 × 10,000): the pot folds
// into the cascade root, so the target change moved every golden (pre-chair value: 65876acc…2ad3).
const GOLDEN = 'f48de5494e76479ce1a0d883885e69d1a5ff1a38dd3b422366f700073ff90f92'
const OFF = Number.MAX_SAFE_INTEGER   // activation above every seq → the pre-slice format, byte-identical
const ON = 0                          // activation at genesis → inclusion folds on every root

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const throws = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — did NOT throw') }
  catch (e) { const s = (e as Error).message; ok(re.test(s), m + (re.test(s) ? '' : ' — wrong error: ' + s)) }
}

interface Wallet { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`inclusion-golden|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B')
const sign = (m: string, w: Wallet) => _signKrayWallet(m, w.sk)

/** Build the FIXED journal (identical bytes to the golden capture) and return its lines + the door's root. */
function buildFixedJournal(): { lines: string[]; doorRoot: string } {
  const dir = join(tmpdir(), `inc-src-${process.pid}`)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const node = new KrayNode(dir, NET)
  node.donate(A.addr, 10_000n); node.donate(B.addr, 10_000n)
  for (let i = 0; i < 4; i++) node.submit({ action: 'transfer', kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: i, publicKey: A.pk, signature: sign(transferMessage(NET, A.addr, B.addr, 10n, i), A), scheme: 'kraywallet' } as unknown as Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'>)
  node.submit({ action: 'inscribe', kind: 'inscribe', at: 0, from: A.addr, contentHash: 'aurora-golden', contentType: 'text/plain', size: 12, nonce: 4, publicKey: A.pk, signature: sign(inscribeMessageV2(NET, A.addr, 'aurora-golden', 'text/plain', 12, undefined, 4), A), scheme: 'kraywallet' } as unknown as Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'>)
  const doorRoot = node.cascadeRoot()
  const lines = readFileSync(join(dir, `kraynet-journal-${NET}.jsonl`), 'utf8').split('\n').filter(Boolean)
  rmSync(dir, { recursive: true, force: true })
  return { lines, doorRoot }
}

/** Replay journal lines into a FRESH ledger with a chosen activation seq — the reducer path, exactly as boot does. */
function replay(lines: string[], activation: number): KrayLedger {
  const led = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET, undefined, false, undefined, activation)
  for (const line of lines) led.applyLive(JSON.parse(line) as KrayEvent)
  return led
}

// the six signed messages this journal commits (the leaves the SMT must hold — and ONLY these)
const SIGNED_MESSAGES = [
  ...[0, 1, 2, 3].map((n) => transferMessage(NET, A.addr, B.addr, 10n, n)),
  inscribeMessageV2(NET, A.addr, 'aurora-golden', 'text/plain', 12, undefined, 4),
]
const SIGNED_KEYS = SIGNED_MESSAGES.map(keyFromSignedMessage)

function main() {
  console.log('\n╔═ THE INCLUSION ROOT IN THE CASCADE — the writer commits who it included (ADR-3 Slice A) ═╗\n')
  const { lines, doorRoot } = buildFixedJournal()

  // ── 1 · A3 — below activation, byte-identical to TODAY (the door AND the reducer hit the golden) ──
  ok(doorRoot === GOLDEN, 'the DOOR (KrayNode, default = not-yet-activated) reproduces the pre-slice GOLDEN cascade root — A3')
  ok(replay(lines, OFF).cascadeRoot() === GOLDEN, 'the REDUCER (fresh replay, activation OFF) reproduces the SAME golden — enforced at door AND replay, and no anchored root is orphaned')

  // ── 2 · at/after activation the inclusion root ALWAYS folds ──
  const on = replay(lines, ON)
  ok(on.cascadeRoot() !== GOLDEN, 'at/after activation the cascade root DIFFERS — the inclusion component is now folded in')
  ok(on.inclusionRoot() !== EMPTY_ROOT, 'with signed acts applied, the inclusion root is non-empty')
  // FROM-H — collection itself is gated: acts BEFORE the activation seq are not leaves (the regime starts at H,
  // so below H the feature is fully inert — no fold AND no accumulation). Journal seqs: 1,2 donate; 3..6 transfers
  // n0..n3; 7 inscribe. Activation at seq 5 keeps only the signed acts at seq>=5 (transfers n2,n3 + inscribe).
  ok(replay(lines, 5).inclusionRoot() === buildInclusionRoot(SIGNED_KEYS.slice(2)), 'from-H: with activation at seq 5, ONLY signed acts at seq>=5 are leaves — acts before H predate the inclusion regime and are never collected')

  // ── 3 · pin 1 (leaf = signed message only) + pin 2 (donate/inscribe: only requireSig kinds are leaves) ──
  ok(on.inclusionRoot() === buildInclusionRoot(SIGNED_KEYS), 'the ledger inclusion root EQUALS an independent SMT rebuilt from the SIGNED MESSAGES alone — the leaf is the signed bytes, nothing else (pin 1)')
  // donate is unsigned: a ledger of ONLY the two donate lines has an EMPTY inclusion root, yet still folds it post-H
  const donateLines = lines.filter((l) => (JSON.parse(l) as KrayEvent).kind === 'donate')
  const onlyDonates = replay(donateLines, ON)
  ok(onlyDonates.inclusionRoot() === EMPTY_ROOT, 'donate carries no signature (no requireSig) → it is NOT a leaf; the inclusion root stays EMPTY_ROOT (pin 2)')
  ok(onlyDonates.cascadeRoot() !== replay(donateLines, OFF).cascadeRoot(), 'EMPTY_ROOT still FOLDS post-activation — an all-unsigned history is committed as an empty set, not as "no set" (a writer cannot hide the commitment)')

  // ── 4 · HOSTILE — omit one signed act: the inclusion root changes; the key proves IN/OUT against the roots ──
  // Drop the inscribe (nonce 4, the LAST act) — omitting it leaves A's transfer nonce chain 0..3 intact, so the
  // omission is a pure censorship of a valid signed act, not a nonce-gap the reducer would refuse anyway.
  const kOmit = keyFromSignedMessage(inscribeMessageV2(NET, A.addr, 'aurora-golden', 'text/plain', 12, undefined, 4))
  const omitLines = lines.filter((l) => (JSON.parse(l) as KrayEvent).kind !== 'inscribe')
  const omitted = replay(omitLines, ON)
  ok(omitted.inclusionRoot() !== on.inclusionRoot(), 'omitting ONE signed act changes the inclusion root — the anchored root carries WHICH acts were included')
  ok(omitted.cascadeRoot() !== on.cascadeRoot(), 'and the cascade root differs too — the omission reaches the anchored commitment (here via BOTH the dropped act\'s state AND the inclusion root; the EMPTY_ROOT-folds check above isolates the fold alone)')
  // the omitted key is provably IN the full set and OUT of the omit set (an inclusion/exclusion proof)
  const inProof = proveKey(SIGNED_KEYS, kOmit)
  const outKeys = SIGNED_KEYS.filter((k) => k !== kOmit)
  const outProof = proveKey(outKeys, kOmit)
  ok(verifyProof(on.inclusionRoot(), kOmit, inProof) === 'in', 'the omitted act PROVES IN against the full inclusion root')
  ok(verifyProof(omitted.inclusionRoot(), kOmit, outProof) === 'out', 'the SAME key PROVES OUT (non-membership) against the omit inclusion root — absence is committed, not merely missing')
  ok(omitted.inclusionRoot() === buildInclusionRoot(outKeys), 'the omit root equals the independent SMT of the surviving signed keys — exact')

  // a signed act REFUSED after its signature (overspend) never becomes a leaf ──
  {
    const led = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET, undefined, false, undefined, ON)
    led.applyLive({ kind: 'donate', at: 0, to: A.addr, amount: '100', seq: 1, prevHash: 'x', hash: 'y', outpoint: 'op:refused-test:0' } as unknown as KrayEvent)
    const good = transferMessage(NET, A.addr, B.addr, 10n, 0)
    led.applyLive({ action: 'transfer', kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 0, publicKey: A.pk, signature: sign(good, A), scheme: 'kraywallet', seq: 2, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
    const afterGood = led.inclusionRoot()
    ok(afterGood === buildInclusionRoot([keyFromSignedMessage(good)]), 'a valid signed transfer became the single leaf')
    const over = transferMessage(NET, A.addr, B.addr, 1_000_000n, 1)   // signature is VALID, but A cannot afford it
    throws(() => led.applyLive({ action: 'transfer', kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '1000000', fee: '1', nonce: 1, publicKey: A.pk, signature: sign(over, A), scheme: 'kraywallet', seq: 3, prevHash: 'x', hash: 'y' } as unknown as KrayEvent), /insufficient|balance|cannot|exceed/i, 'the overspend is REFUSED after its signature verifies')
    ok(led.inclusionRoot() === afterGood, 'the refused overspend leaves the inclusion root unchanged')
    // apply one more valid act so the incremental tree advances, then assert against the INDEPENDENT SMT of
    // EXACTLY the two lawful keys — so a leaked overspend key could never hide (the tree only ever inserts on
    // full success; there is no memo/cache to mask a wrongly-added leaf).
    const good2 = transferMessage(NET, A.addr, B.addr, 10n, 1)
    led.applyLive({ action: 'transfer', kind: 'transfer', at: 0, from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 1, publicKey: A.pk, signature: sign(good2, A), scheme: 'kraywallet', seq: 4, prevHash: 'x', hash: 'y' } as unknown as KrayEvent)
    ok(led.inclusionRoot() === buildInclusionRoot([keyFromSignedMessage(good), keyFromSignedMessage(good2)]), 'the incremental inclusion tree holds EXACTLY the two lawful keys — the refused overspend was never inserted, provably absent (pin 2 / commit-on-success)')
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — below H the past is byte-identical; at/after H the anchored root commits exactly the signed set. A commits WHO; evidence of omission is 3d. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
