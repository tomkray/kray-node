/**
 * THE MINT DROP — N equal pots, one per hand, nobody named in advance.
 *
 *   node src/test/mint-drop.test.ts
 *
 * A harvest commits a list of NAMES; a mint commits its TERMS. Everything expensive is the claim book's
 * already-proven machinery — the keyless pot, `taken` (one hand, one taking, forever), the giver's close at
 * a named height, conservation-or-HALT. What is new is `perHand`, a `hands` cap, and "whoever has not
 * taken" in place of a merkle proof.
 *
 * Two properties this file exists to defend above all others:
 *   · a chain with NO mint commits byte for byte what it commits today (fold by presence)
 *   · a take carries NO amount — a pot is what the GIVER signed, never what a taker asks for
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, verifyKrayWallet } from '../protocol/scheme.ts'
import { mintId, mintOpenMessage, mintTakeMessage, claimCloseMessage, claimRoot, claimOpenMessage, MINT_DROP_SEQ, CLAIM_MAX_HANDS, type MintTerms } from '../protocol/claim-book.ts'
import { signedMessageOfEvent } from '../protocol/signed-message.ts'
import { TREASURY, CLAIM_POT, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const halts = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const s = (e as Error).message; ok(re.test(s), m + (re.test(s) ? '' : ' — wrong: ' + s)) }
}
interface W { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`mint-drop|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)
function push(L: KrayLedger, e: KrayEvent): void {
  const before = L.appliedSeq
  L.applyLive(e)
  if (L.appliedSeq === before) throw new Error(`test: the ${e.kind} was silently skipped (stale seq)`)
}
const mintOpenEv = (L: KrayLedger, w: W, o: { perHand: bigint; hands: number; expires: number; gateChildOf?: string; gateStar?: string; by?: W; wire?: Record<string, unknown> }): KrayEvent => {
  const nonce = L.nonceOf(w.addr), signer = o.by ?? w
  const gate: MintTerms['gate'] = o.gateChildOf ? { kind: 'childOf', star: BigInt(o.gateChildOf) } : null
  const e: Record<string, unknown> = {
    seq: L.appliedSeq + 1, kind: 'mint-open', hash: 'h' + (L.appliedSeq + 1), at: 1, from: w.addr, lane: 'kray',
    perHand: o.perHand.toString(), hands: o.hands, expires: o.expires, fee: '1', nonce,
    publicKey: signer.pk, signature: sign(mintOpenMessage(NET, w.addr, 'kray', '', o.perHand, o.hands, gate, o.expires, nonce), signer), scheme: 'kraywallet',
  }
  if (o.gateChildOf) e.gateChildOf = o.gateChildOf
  if (o.gateStar) e.gateStar = o.gateStar
  Object.assign(e, o.wire ?? {})
  return e as unknown as KrayEvent
}
const mintTakeEv = (L: KrayLedger, w: W, root: string, star?: string, by?: W): KrayEvent => {
  const nonce = L.nonceOf(w.addr), signer = by ?? w
  const e: Record<string, unknown> = {
    seq: L.appliedSeq + 1, kind: 'mint-take', hash: 'h' + (L.appliedSeq + 1), at: 1, from: w.addr,
    claimRoot: root, fee: '1', nonce,
    publicKey: signer.pk, signature: sign(mintTakeMessage(NET, w.addr, root, star ? BigInt(star) : null, nonce), signer), scheme: 'kraywallet',
  }
  if (star) e.star = star
  return e as unknown as KrayEvent
}
const closeEv = (L: KrayLedger, w: W, root: string): KrayEvent => {
  const nonce = L.nonceOf(w.addr)
  return { seq: L.appliedSeq + 1, kind: 'claim-close', hash: 'h' + (L.appliedSeq + 1), at: 1, from: w.addr,
    claimRoot: root, fee: '1', nonce, publicKey: w.pk, signature: sign(claimCloseMessage(NET, w.addr, root, nonce), w), scheme: 'kraywallet' } as unknown as KrayEvent
}
const sealTo = (L: KrayLedger, h: number) => push(L, { seq: L.appliedSeq + 1, kind: 'seal', hash: 'seal' + h, at: 0, l1Txid: h.toString(16).padStart(64, '0'), l1Height: h, l1Root: L.cascadeRoot(), l1BlockNumber: 0 } as unknown as KrayEvent)
let outn = 0
const fund = (L: KrayLedger, w: W, amount: bigint) => push(L, { seq: L.appliedSeq + 1, kind: 'donate', hash: 'd' + (L.appliedSeq + 1), at: 1, to: w.addr, amount: amount.toString(),
  outpoint: createHash('sha256').update('mint-drop-out' + (++outn)).digest('hex') + ':0' } as unknown as KrayEvent)
const sumOf = (L: KrayLedger, ws: W[]) => ws.reduce((s, w) => s + L.balanceOf(w.addr), 0n)

function main(): void {
  console.log('\n╔═ THE MINT DROP — N equal pots, one per hand, nobody named ══╗\n')
  const giver = wallet('giver'), a = wallet('a'), b = wallet('b'), c = wallet('c'), d = wallet('d')
  const all = [giver, a, b, c, d]

  console.log('─ 0 · the fold: a chain with NO mint must commit what it commits today ─')
  {
    const L = new KrayLedger(undefined, NET)
    fund(L, giver, 1000n)
    const root = claimRoot([{ to: a.addr, amount: 5n }])
    const nonce = L.nonceOf(giver.addr)
    push(L, { seq: L.appliedSeq + 1, kind: 'claim-open', hash: 'co', at: 1, from: giver.addr, lane: 'kray',
      amount: '5', claimRoot: root, fee: '1', nonce, publicKey: giver.pk,
      signature: sign(claimOpenMessage(NET, giver.addr, 'kray', '', 5n, root, 0, nonce), giver), scheme: 'kraywallet' } as unknown as KrayEvent)
    const line = L.claims.commitment()
    ok(line.endsWith('|hand'), '0 · a harvest still commits exactly `…|takenChain|hand` — nothing appended')
    ok(!line.includes('mint='), '0 · and carries no mint field at all — the fold is by PRESENCE')
  }

  console.log('\n─ 1 · opening a mint ─')
  const L = new KrayLedger(undefined, NET)
  for (const w of all) fund(L, w, 1000n)
  const supplyBefore = sumOf(L, all) + L.balanceOf(TREASURY) + L.balanceOf(CLAIM_POT)

  halts(() => push(L, mintOpenEv(L, giver, { perHand: 100n, hands: 3, expires: 0 })),
    /may not say 0|closes at a Bitcoin height/, '1 · expires = 0 is REFUSED — with nobody named, unclaimed pots would lock forever')
  halts(() => push(L, mintOpenEv(L, giver, { perHand: 100n, hands: 0, expires: 900000 })),
    /at least one pot/, '1 · a mint of zero pots is refused')
  halts(() => push(L, mintOpenEv(L, giver, { perHand: 100n, hands: CLAIM_MAX_HANDS + 1, expires: 900000 })),
    /at most .* pots/, '1 · more pots than the book\'s one ceiling is refused')
  halts(() => push(L, mintOpenEv(L, giver, { perHand: 100n, hands: 3, expires: 900000, gateStar: '7' })),
    /gated on holding ONE star/, '1 · a single-star gate is REFUSED — every pot past the first would be unclaimable')
  halts(() => push(L, mintOpenEv(L, giver, { perHand: 100_000n, hands: 3, expires: 900000 })),
    /do not hold that mint/, '1 · promising what the giver has not got is refused')

  const root = mintId(NET, giver.addr, 'kray', '', 100n, 3, null, L.nonceOf(giver.addr))
  push(L, mintOpenEv(L, giver, { perHand: 100n, hands: 3, expires: 900000 }))
  const claim = L.claims.get(root)!
  ok(!!claim, '1 · the mint is open at the id derived from its own terms')
  ok(claim.total === 300n, '1 · the total is COMPUTED as perHand × hands (300), never supplied')
  ok(claim.mint!.perHand === 100n && claim.mint!.hands === 3, '1 · and the terms are what was signed')
  ok(L.packetHeld('kray', '', CLAIM_POT) === 300n, '1 · the whole total left the giver, into the keyless pot')
  ok(L.claims.potsLeft(root) === 3, '1 · three pots stand unclaimed')

  console.log('\n─ 2 · taking a pot ─')
  const beforeA = L.balanceOf(a.addr)
  push(L, mintTakeEv(L, a, root))
  ok(L.balanceOf(a.addr) === beforeA + 100n - 1n, '2 · one pot paid exactly perHand, minus the eternal fee')
  ok(L.claims.potsLeft(root) === 2, '2 · and one pot fewer stands')
  halts(() => push(L, mintTakeEv(L, a, root)), /already taken your pot/, '2 · the SAME hand is refused a second pot — jamais duplica')
  halts(() => push(L, mintTakeEv(L, d, root, '7')), /has no gate/, '2 · naming a star on an ungated mint is refused — no unread line may be signed')

  push(L, mintTakeEv(L, b, root))
  push(L, mintTakeEv(L, c, root))
  ok(L.claims.potsLeft(root) === 0, '2 · three hands, three pots, none left')
  halts(() => push(L, mintTakeEv(L, d, root)), /every pot of that mint is taken/, '2 · the fourth hand is refused by the CAP, not by arithmetic')
  ok(L.packetHeld('kray', '', CLAIM_POT) === 0n, '2 · the pot landed on zero')

  console.log('\n─ 3 · a harvest root is not a mint, and a mint id is not a harvest root ─')
  {
    const hRoot = claimRoot([{ to: a.addr, amount: 5n }])
    const nonce = L.nonceOf(giver.addr)
    push(L, { seq: L.appliedSeq + 1, kind: 'claim-open', hash: 'co2', at: 1, from: giver.addr, lane: 'kray',
      amount: '5', claimRoot: hRoot, fee: '1', nonce, publicKey: giver.pk,
      signature: sign(claimOpenMessage(NET, giver.addr, 'kray', '', 5n, hRoot, 0, nonce), giver), scheme: 'kraywallet' } as unknown as KrayEvent)
    halts(() => push(L, mintTakeEv(L, d, hRoot)), /is a harvest, not a mint/, '3 · mint-take against a harvest root is refused by name')
  }

  console.log('\n─ 4 · what no hand took comes back, and only at the height ─')
  {
    const M = new KrayLedger(undefined, NET)
    for (const w of all) fund(M, w, 1000n)
    const r2 = mintId(NET, giver.addr, 'kray', '', 50n, 4, null, M.nonceOf(giver.addr))
    push(M, mintOpenEv(M, giver, { perHand: 50n, hands: 4, expires: 900000 }))
    push(M, mintTakeEv(M, a, r2))
    halts(() => push(M, closeEv(M, giver, r2)), /the chain is sealed to/, '4 · the giver cannot close before the height they named')
    sealTo(M, 900000)
    const before = M.balanceOf(giver.addr)
    push(M, closeEv(M, giver, r2))
    ok(M.balanceOf(giver.addr) === before + 150n - 1n, '4 · exactly the three unclaimed pots came back (150), minus the fee')
    ok(M.claims.get(r2) === null, '4 · and the mint left the book')
    ok(M.packetHeld('kray', '', CLAIM_POT) === 0n, '4 · the pot is empty')
  }

  console.log('\n─ 5 · the pin: below it, the acts do not exist (A3) ─')
  {
    // THE POSITIONAL SLOTS ARE COUNTED, NOT EYEBALLED. A pin landing in the wrong slot is exactly how the
    // packet market's four checks once went red — build the argument list by index and name the one we set.
    const args: unknown[] = new Array(31).fill(undefined)
    args[1] = NET            // network
    args[3] = false          // backingGate
    args[30] = 1_000_000     // mintDropSeq — far above any seq this test reaches
    const P = new (KrayLedger as unknown as new (...a: unknown[]) => KrayLedger)(...args)
    fund(P, giver, 1000n)
    halts(() => push(P, mintOpenEv(P, giver, { perHand: 10n, hands: 2, expires: 900000 })),
      /not the law on this network yet/, '5 · below the pin a mint cannot be opened — an old node FREEZES, never forks')
    ok(MINT_DROP_SEQ.main === 82, '5 · and mainnet took it at 82 — the SAME seq as the gift, the packet market, the escrow and the tiebreak, exactly as the design required')
  }

  console.log('\n─ 5b · A VALID SIGNATURE OVER AN UNAFFORDABLE ACT ─')
  {
    // THE QUESTION THIS ANSWERS: is "you do not hold it" caught by the SIGNATURE, or after it?
    // A signature proves WHO wrote a line. It cannot know a balance — no signature over any bytes can.
    // So an unaffordable act can be signed perfectly, and is refused by the REDUCER, every time, on every
    // node, forever. This is the difference between "the door checked" and "no node can make it stick".
    const P = new KrayLedger(undefined, NET)
    fund(P, giver, 40n)                                    // 40 ₭, and the mint below promises 1,000
    const ev = mintOpenEv(P, giver, { perHand: 100n, hands: 10, expires: 900000 })

    // the signature is not merely present — it VERIFIES against the exact canonical line
    const line = signedMessageOfEvent(ev, NET)!
    const w = ev as unknown as { signature: string; publicKey: string }
    ok(verifyKrayWallet(giver.addr, line, w.signature, w.publicKey, BNET),
      '5b · the signature over the unaffordable mint is PERFECTLY VALID — it proves the author, nothing else')

    halts(() => push(P, ev), /do not hold that mint/,
      '5b · and the reducer refuses it anyway: a valid signature is not a balance')
    ok(P.claims.get(mintId(NET, giver.addr, 'kray', '', 100n, 10, null, 0)) === null, '5b · nothing was opened')
    ok(P.balanceOf(giver.addr) === 40n, '5b · and not one unit moved — not even the fee')

    // THE HALT: a hostile node that WROTE it into its journal cannot make any other node accept it.
    // Replay is the whole guarantee — every follower re-derives, and refuses the same way.
    const Q = new KrayLedger(undefined, NET)
    fund(Q, giver, 40n)
    halts(() => Q.applyLive(ev), /do not hold that mint/,
      '5b · a stranger REPLAYING a journal that carries it halts on the same line — no node can be made to accept it')
  }

  console.log('\n─ 6 · conservation ─')
  ok(sumOf(L, all) + L.balanceOf(TREASURY) + L.balanceOf(CLAIM_POT) === supplyBefore,
    '6 · Σ across every hand, the Treasury and the pot is exactly what it was — nothing minted, nothing lost')
  ok(L.conserves(), '6 · and the ledger says so itself')

  console.log('\n─ 7 · the signed lines ─')
  {
    const take = signedMessageOfEvent({ kind: 'mint-take', from: a.addr, claimRoot: root, nonce: 9 } as unknown as KrayEvent, NET)!
    ok(!/amount=/.test(take), '7 · a take carries NO amount — a pot is what the giver signed, never what a taker asks')
    ok(take.startsWith('kray-core.mint-take.v1|'), '7 · and it is domain-separated from every other line')
    const open = signedMessageOfEvent({ kind: 'mint-open', from: giver.addr, lane: 'kray', perHand: '100', hands: 3, expires: 900000, nonce: 9 } as unknown as KrayEvent, NET)!
    ok(/perHand=100\|hands=3\|gate=none\|expires=900000/.test(open), '7 · and an open carries every term that decides a payout')
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
  console.log('\n✓ THE MINT DROP HOLDS: one pot per hand forever, a cap that is counted not computed, a height always named, and a chain with no mint hashes exactly as it did. ⛓₭')
}
main()
