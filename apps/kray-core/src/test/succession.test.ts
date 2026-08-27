/**
 * THE PEN AS A RACE (ADR-3 · slice 3e) — when the writer falls silent, a successor is a checkable role.
 *
 *   node src/test/succession.test.ts
 *
 * Succession invents no new consensus — it composes the proven parts. This exam pins the one new pure
 * piece (the silence clock) and the two compositions (a successor's window is follower-checkable; N
 * claimants resolve by the live Bitcoin-work fork choice, deterministically):
 *
 *   · THE CLOCK — succession opens only after `silenceBlocks` of writer silence; a brief hiccup does not;
 *   · A VALID successor window (built by 3c order → 3a root → 3d commitment) is accepted; a tampered set,
 *     a smuggled invalid-signature act, or a fabricated commitment is REFUSED (a successor cannot lie);
 *   · N COMPETING heads reduce to ONE canonical winner via chooseCanonical, the SAME winner in any order
 *     (equivocation resolves by the deeper Bitcoin anchor / the deterministic tie-break — never a split).
 *
 * Pure — wired into no live path. Safety rests on chooseCanonical (already live and tested); this exam
 * proves the clock and the compositions, and states what only the live data-availability layer can add.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, verifySignature } from '../protocol/scheme.ts'
import { keyFromSignedMessage, orderWindow, type SignedAct, type WindowRules } from '../protocol/window-order.ts'
import { inclusionRoot } from '../protocol/inclusion-tree.ts'
import { windowCommitment } from '../protocol/censorship-evidence.ts'
import {
  successionWindow, validateSuccessorWindow, canonicalHead, DEFAULT_SILENCE_BLOCKS,
  strikeStands, censorshipOpensSuccession, chooseCanonicalWithConduct, type ConductStrike,
} from '../protocol/succession.ts'
import { chooseCanonical } from '../protocol/consensus.ts'
import type { HeadClaim } from '../protocol/consensus.ts'
import { KrayAnchor } from '../anchor/anchor.ts'
import { sha256d, toDisplayHex, checkProofOfWork } from '../anchor/spv.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

interface Wallet { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`succession|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const A = wallet('A'), B = wallet('B'), C = wallet('C')
type Act = SignedAct & Record<string, unknown>

function transfer(from: Wallet, to: Wallet, amount: bigint, nonce: number, signer: Wallet = from): Act {
  const msg = transferMessage(NET, from.addr, to.addr, amount, nonce)
  return { kind: 'transfer', from: from.addr, to: to.addr, amount: String(amount), nonce, publicKey: signer.pk, signature: _signKrayWallet(msg, signer.sk), scheme: 'kraywallet' }
}
const RULES: WindowRules<Act> = {
  nonceOf: () => 0,
  keyOf: (a) => keyFromSignedMessage(transferMessage(NET, a.from as string, a.to as string, BigInt(a.amount as string), a.nonce as number)),
  isValid: (a) => { try { return verifySignature(a.from as string, transferMessage(NET, a.from as string, a.to as string, BigInt(a.amount as string), a.nonce as number), a.signature as string, a.publicKey as string, (a.scheme as string) ?? 'kraywallet', BNET) } catch { return false } },
}
function shuffle<T>(arr: readonly T[], seed: number): T[] {
  const a = [...arr]; let s = seed >>> 0
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1);[a[i], a[j]] = [a[j], a[i]] }
  return a
}
const head = (height: number, tip: string): HeadClaim => ({ network: NET, height, chainTipHash: tip, cascadeRoot: createHash('sha256').update('root' + height + tip).digest('hex'), anchors: [] })

// ── a synthetic, fully valid Bitcoin seal (same shape as consensus.test.ts) — for the ANCHORED tiers ──
function buildRawTx(payloadHex: string): string {
  return ['01000000', '01', '00'.repeat(32), 'ffffffff', '00', 'ffffffff', '01', '00'.repeat(8), '33', '6a31' + payloadHex, '00000000'].join('')
}
function buildHeader(prevInternal: Buffer, merkleRootInternal: Buffer, nonce: number): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); merkleRootInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000, 68); h.writeUInt32LE(0x207fffff, 72)
  for (let n = nonce; n < nonce + 1_000_000; n++) { h.writeUInt32LE(n >>> 0, 76); if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h }
  throw new Error('could not mine a regtest header')
}
function seal(krayHeight: number, root: string, confirmations: number) {
  const rawTx = buildRawTx(KrayAnchor.payload(krayHeight, root))
  const txid = sha256d(Buffer.from(rawTx, 'hex'))
  const h1 = buildHeader(Buffer.alloc(32), txid, krayHeight)
  const headers = [h1]
  for (let i = 1; i < confirmations; i++) headers.push(buildHeader(sha256d(headers[i - 1]), Buffer.alloc(32, i), i))
  const txoutproof = Buffer.concat([h1, Buffer.from([1, 0, 0, 0]), Buffer.from([1]), txid, Buffer.from([1]), Buffer.from([0x01])]).toString('hex')
  return { height: krayHeight, cascadeRoot: root, txid: toDisplayHex(txid), proof: { rawTx, txoutproof, headers: headers.map((x) => x.toString('hex')) } }
}
const anchoredHead = (tip: string, anchor: ReturnType<typeof seal>): HeadClaim => ({ network: NET, height: 10, chainTipHash: tip, cascadeRoot: createHash('sha256').update(tip).digest('hex'), anchors: [anchor] })

function main() {
  console.log('\n╔═ THE PEN AS A RACE — the writer is a role, and Bitcoin picks the winner ═╗\n')

  // ── THE SILENCE CLOCK ──
  {
    ok(successionWindow(100, 100 + DEFAULT_SILENCE_BLOCKS - 1).open === false, `a ${DEFAULT_SILENCE_BLOCKS - 1}-block hiccup does NOT open succession — the writer is still within its window`)
    const struck = successionWindow(100, 100 + DEFAULT_SILENCE_BLOCKS)
    ok(struck.open === true && struck.silentBlocks === DEFAULT_SILENCE_BLOCKS, `${DEFAULT_SILENCE_BLOCKS} silent Bitcoin blocks opens succession to any node`)
    ok(successionWindow(100, 90).open === false && successionWindow(100, 90).silentBlocks === 0, 'a tip behind the last anchor is 0 silent blocks (never negative) — closed')
    ok(successionWindow(100, 100, 3).open === false, 'zero elapsed blocks is closed')
    ok(successionWindow(1.5, 100).open === false, 'a non-integer height fails closed')
    // the gameable input: an INFLATED lastAnchoredBtcHeight freezes succession shut (liveness denial) —
    // which is exactly why the contract requires it be SPV-verified, not taken from a peer's word
    ok(successionWindow(1000, 1000).open === false && successionWindow(1000, 1000).silentBlocks === 0,
      'an inflated lastAnchoredBtcHeight (= tip) reports 0 silent blocks → succession stays shut (why the contract demands an SPV-verified source)')
  }

  // ── A SUCCESSOR'S WINDOW is follower-checkable ──
  const SEAL = 200
  const set: Act[] = [transfer(A, B, 10n, 0), transfer(B, C, 5n, 0), transfer(C, A, 7n, 0)]
  const { ordered } = orderWindow(set, RULES)
  const root = inclusionRoot(ordered.map(RULES.keyOf))
  const commit = windowCommitment(SEAL, root)

  {
    const v = validateSuccessorWindow({ seal: SEAL, actSet: set, windowCommitment: commit }, RULES)
    ok(v.valid === true && v.inclusionRoot === root && v.rejectedCount === 0 && v.orderedCount === set.length,
      'a successor window built by the 3c/3a/3d rules validates — a follower re-derives the identical commitment')
  }
  {
    const tampered = [transfer(A, B, 999n, 0), ...set.slice(1)]   // a different set → a different commitment
    const v = validateSuccessorWindow({ seal: SEAL, actSet: tampered, windowCommitment: commit }, RULES)
    ok(v.valid === false && /does not match/.test(v.reason), 'a tampered act set → the re-derived commitment differs → REFUSED')
  }
  {
    const smuggled = [...set, transfer(A, C, 1n, 5, B)]           // an invalid-signature act (signed by B for A)
    // if the successor CLAIMS the honest commitment but ships the smuggled set, re-derivation drops the
    // invalid act and the commitment still matches — proving the smuggled act simply never counts
    const v = validateSuccessorWindow({ seal: SEAL, actSet: smuggled, windowCommitment: commit }, RULES)
    ok(v.valid === true && v.rejectedCount === 1 && v.orderedCount === set.length,
      'an invalid-signature act smuggled into the set is REJECTED at admission — it cannot enter the window or move the commitment')
  }
  {
    const v = validateSuccessorWindow({ seal: SEAL, actSet: set, windowCommitment: createHash('sha256').update('fake').digest('hex') }, RULES)
    ok(v.valid === false && /does not match/.test(v.reason), 'a fabricated commitment → REFUSED')
  }

  // ── N COMPETING HEADS reduce to ONE canonical winner, deterministically ──
  {
    ok(canonicalHead([]) === null, 'no claimants → null (nothing to choose)')
    const claims = [head(5, 'ffff'), head(9, 'aaaa'), head(9, '0000'), head(2, '1111')]
    // nothing is anchored here, so chooseCanonical decides by the taller chain, then the smaller tip hash:
    // height 9 beats all; between the two 9s, tip '0000' < 'aaaa' wins.
    const winner = canonicalHead(claims)!
    ok(winner.height === 9 && winner.chainTipHash === '0000', 'the taller chain wins; an equal-height tie breaks on the smaller tip hash — one rule, everywhere')
    let stable = true
    for (let seed = 0; seed <= 40; seed++) {
      const w = canonicalHead(shuffle(claims, seed))!
      if (w.height !== winner.height || w.chainTipHash !== winner.chainTipHash) stable = false
    }
    ok(stable, '40 orderings of the same claimants → the IDENTICAL winner (equivocation never becomes a permanent split)')
  }

  // ── THE ANCHORED TIER — a deeper Bitcoin anchor wins the reduce, order-invariantly (the headline case) ──
  {
    const deep = anchoredHead('zzzz', seal(9, createHash('sha256').update('deep').digest('hex'), 6))    // buried 6
    const shallow = anchoredHead('aaaa', seal(9, createHash('sha256').update('shallow').digest('hex'), 2)) // buried 2
    const proofless = head(9999, '0000')   // a tall but UNWITNESSED chain — must never outrank an anchored one
    const field = [deep, shallow, proofless]
    const winner = canonicalHead(field)!
    ok(winner === deep, 'among real anchored + proofless claims, the DEEPER Bitcoin anchor wins — not the taller unwitnessed chain (Bitcoin work outranks the free integer)')
    let anchoredStable = true
    for (let seed = 0; seed <= 30; seed++) if (canonicalHead(shuffle(field, seed)) !== deep) anchoredStable = false
    ok(anchoredStable, '30 orderings with real proofs → the same deepest-anchor winner (the reduce is order-invariant on the Bitcoin-work tier, not only the free tie-break)')
  }

  // ── MIXED NETWORK — a hostile off-network claim fails CLOSED (null), never an uncaught throw ──
  {
    const mixed: HeadClaim[] = [head(5, 'aaaa'), { ...head(5, 'bbbb'), network: 'signet' }]
    let threw = false, out: HeadClaim | null = null
    try { out = canonicalHead(mixed) } catch { threw = true }
    ok(!threw && out === null, 'a mixed-network claim list → null, fail-closed (one off-network claim cannot crash the reduce)')
  }

  // ── THE CONDUCT STRIKE — a proven censor loses fork choice and opens succession (ADR-3 enforced) ──
  {
    const censored: ConductStrike = {
      verdict: { censored: true, key: 'ab'.repeat(32), seal: 900, deadline: 850 },
      sealHeightReproven: true,
    }
    const unproven: ConductStrike = { ...censored, sealHeightReproven: false }
    const acquitted: ConductStrike = {
      verdict: { censored: false, reason: 'the act was not public until after its own deadline' },
      sealHeightReproven: true,
    }
    ok(strikeStands(censored) && !strikeStands(unproven) && !strikeStands(acquitted) && !strikeStands(null),
      'a strike stands ONLY as CENSORED + seal-height-re-proven — an unverified accusation or an acquittal moves nothing (fail-closed)')

    // the headline: the CENSORING INCUMBENT carries the deeper Bitcoin anchor — work alone would crown it
    const censor = anchoredHead('cccc', seal(9, createHash('sha256').update('censor').digest('hex'), 6))
    const honest = anchoredHead('hhhh', seal(9, createHash('sha256').update('honest').digest('hex'), 2))
    ok(chooseCanonical(censor, honest).winner === 'a',
      'without conduct, Bitcoin work crowns the heavier incumbent — exactly why the verdict needed teeth')
    const v1 = chooseCanonicalWithConduct(censor, honest, { a: censored })
    ok(v1.winner === 'b' && /CENSORING/.test(v1.why),
      'a standing strike DEMOTES the heavier censor — the honest history wins before any work is weighed')
    const v2 = chooseCanonicalWithConduct(censor, honest, { a: unproven })
    ok(v2.winner === 'a' && v2.why === chooseCanonical(censor, honest).why,
      'a strike WITHOUT the re-proven seal height does not stand — fork choice is byte-identical to the work ladder')
    const v3 = chooseCanonicalWithConduct(censor, honest, { a: censored, b: censored })
    ok(v3.winner === 'a' && v3.why === chooseCanonical(censor, honest).why,
      'both struck → work decides among sinners, byte-identical to chooseCanonical (the rung never invents a third rule)')
    const v4 = chooseCanonicalWithConduct(censor, honest, {})
    ok(v4.winner === 'a' && v4.why === chooseCanonical(censor, honest).why,
      'no strikes → byte-identical to chooseCanonical — the additive rung changes nothing for honest histories')
    let threwNet = false
    try { chooseCanonicalWithConduct(censor, { ...honest, network: 'signet' }, { a: censored }) } catch { threwNet = true }
    ok(threwNet, 'different networks still refuse — the conduct rung does not bypass the network wall')

    // censorship is not silence: the strike opens succession without waiting for the clock
    const clockClosed = successionWindow(100, 102)
    const opened = censorshipOpensSuccession(censored, clockClosed)
    ok(clockClosed.open === false && opened.open === true && /censorship is not silence/.test(opened.reason),
      'a standing strike opens succession IMMEDIATELY — a live-and-refusing writer cannot hide behind its heartbeat')
    ok(censorshipOpensSuccession(unproven, clockClosed).open === false,
      'an unproven strike leaves the clock verdict byte-identical — no accusation shortcut')
    const clockOpen = successionWindow(100, 100 + DEFAULT_SILENCE_BLOCKS)
    ok(censorshipOpensSuccession(censored, clockOpen) === clockOpen,
      'a window the clock already opened is untouched — the strike never rewrites the silence reason')
    // HEALING is structural: a chain that later includes the act cannot produce a current absence proof,
    // so the caller derives NO strike at the new root — pinned here as the no-strike branch above (v4).
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the pen is a role: the clock opens it, the rules check the successor, and Bitcoin's work picks the winner. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
