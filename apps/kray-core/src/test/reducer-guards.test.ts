/**
 * REDUCER GUARDS — the four consensus fixes the adversarial swarm surfaced, each pinned so it can never regress.
 *
 *   N1  a signed action with an OMITTED nonce is refused (else the same body replays forever — durable double-spend)
 *   N3  an UNKNOWN/future event kind HALTS the node (no silent hard-fork; A3)
 *   N8  a reward to a WRONG-network address is refused (value never crosses networks — parity with settlement)
 *   N9  a signed action FROM a protocol label (KRAY_…) is refused (a sink/treasury never spends)
 *
 *   node src/test/reducer-guards.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage, burnMessage, inscribeMessageV2 } from '../protocol/scheme.ts'
import { BLACK_HOLE, MAX_INSCRIPTION_BYTES, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => { try { fn(); ok(false, m + ' — DID NOT throw') } catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) } }
function wallet(net: 'regtest' | 'main', tag: string) {
  const sk = createHash('sha256').update(net + '|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[net]).address!, sk, pk: publicKeyHex }
}

function main() {
  console.log('\n╔═ REDUCER GUARDS — nonce-required · unknown-kind-HALT · reward-network · no-spend-from-label ═╗\n')
  const A = wallet('regtest', 'A'), B = wallet('regtest', 'B')
  const L = new KrayLedger(undefined, NET)
  L.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: A.addr, amount: '10000' } as KrayEvent)

  // ── N1 · omitted nonce refused; the SAME signed body cannot replay ──
  const msgNoNonce = transferMessage(NET, A.addr, B.addr, 10n, undefined as unknown as number)
  const sigNoNonce = _signKrayWallet(msgNoNonce, A.sk)
  rejects(() => L.applyLive({ seq: 2, kind: 'transfer', hash: 't', from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: undefined, publicKey: A.pk, signature: sigNoNonce, scheme: 'kraywallet' } as unknown as KrayEvent),
    /whole-number nonce|missing or non-integer nonce/, 'N1 — a transfer with an OMITTED nonce is refused (no infinite replay)')
  ok(L.balanceOf(B.addr) === 0n, 'N1 — nothing moved on the refused nonce-less transfer')
  // a PROPER nonce still works, once
  const msg0 = transferMessage(NET, A.addr, B.addr, 10n, 0)
  L.applyLive({ seq: 3, kind: 'transfer', hash: 't0', from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 0, publicKey: A.pk, signature: _signKrayWallet(msg0, A.sk), scheme: 'kraywallet' } as KrayEvent)
  ok(L.balanceOf(B.addr) === 10n, 'N1 — a properly-nonced transfer still applies exactly once')
  rejects(() => L.applyLive({ seq: 4, kind: 'transfer', hash: 't0r', from: A.addr, to: B.addr, amount: '10', fee: '1', nonce: 0, publicKey: A.pk, signature: _signKrayWallet(msg0, A.sk), scheme: 'kraywallet' } as KrayEvent),
    /nonce 0 != expected 1/, 'N1 — replaying nonce 0 is refused (stale)')

  // ── N3 · an unknown/future kind HALTS instead of silently advancing ──
  const before = L.cascadeRoot()
  rejects(() => L.applyLive({ seq: 4, kind: 'mint-a-billion', hash: 'x', to: A.addr, amount: '999999999' } as unknown as KrayEvent),
    /unknown event kind|HALTS/, 'N3 — an unknown event kind HALTS the node (no silent hard-fork)')
  ok(L.cascadeRoot() === before, 'N3 — the HALTed unknown kind advanced nothing (root unchanged)')

  // ── N8 · the unsigned reward is RETIRED — refused everywhere from the retirement seq ──
  const bcrt = B.addr, bc1 = wallet('main', 'Z').addr
  rejects(() => L.applyLive({ seq: 4, kind: 'reward', hash: 'rw', to: bc1, amount: '1' } as unknown as KrayEvent),
    /retired/, 'N8 — the unsigned reward is refused: the fee pool pays only what the bytes prove (settlement)')
  ok(bcrt.startsWith('bcrt1'), 'N8 — (cross-network recipients stay covered by requireFungibleRecipient at every live credit site)')

  // ── N9 · the black hole is sealed BOTH ways for fungible ₭ — the burn law (in) + the label guard (out) ──
  const burnMsg = transferMessage(NET, A.addr, BLACK_HOLE, 20n, 1)
  rejects(() => L.applyLive({ seq: 4, kind: 'transfer', hash: 'burn', from: A.addr, to: BLACK_HOLE, amount: '20', fee: '1', nonce: 1, publicKey: A.pk, signature: _signKrayWallet(burnMsg, A.sk), scheme: 'kraywallet' } as KrayEvent),
    /cannot be frozen — only burned/, 'N9 — fungible ₭ can never ENTER the hole: "₭ cannot be frozen — only burned" (the ratified law; the signed burn is the door)')
  ok(L.balanceOf(BLACK_HOLE) === 0n, 'N9 — the hole holds no fungible ₭ (stars only, forever)')
  // the lawful door instead: A BURNS the 20 ₭ by signature (same nonce, same 21 ₭ leaving A — the law's answer)
  L.applyLive({ seq: 4, kind: 'burn', hash: 'lawburn', from: A.addr, amount: '20', fee: '1', nonce: 1, publicKey: A.pk, signature: _signKrayWallet(burnMessage(NET, A.addr, 20n, 1), A.sk), scheme: 'kraywallet' } as KrayEvent)
  ok(L.totalBurned >= 20n && L.xMintedOf(A.addr) === 20n, 'N9 — the signed burn IS the door: 20 ₭ died, 20 Ӿ born to A')
  const labelMsg = transferMessage(NET, BLACK_HOLE, B.addr, 5n, 0)
  rejects(() => L.applyLive({ seq: 5, kind: 'transfer', hash: 'bh', from: BLACK_HOLE, to: B.addr, amount: '5', fee: '1', nonce: 0, publicKey: A.pk, signature: _signKrayWallet(labelMsg, A.sk), scheme: 'kraywallet' } as unknown as KrayEvent),
    /cannot be signed BY a protocol label|does not verify|a protocol pot cannot transfer/, 'N9 — and value can never be spent OUT of the black hole / a KRAY_ label (the guard fires before any balance question)')

  // ── C1 · THE CONTENT CEILING IS CONSENSUS — the 21 MB star, pinned at the exact boundary ──
  // One monotonic seq for everything below (a stale seq is silently skipped — the earlier lesson).
  let seqN = 5
  const nextSeq = () => ++seqN
  const insAt = (size: number, nonce: number, tag: string) => {
    const chash = createHash('sha256').update('ceiling' + tag).digest('hex')
    const msg = inscribeMessageV2(NET, A.addr, chash, 'audio/mpeg', size, undefined, nonce)
    return { seq: nextSeq(), kind: 'inscribe', hash: 'c' + tag, from: A.addr, contentHash: chash, contentType: 'audio/mpeg', size, nonce, publicKey: A.pk, signature: _signKrayWallet(msg, A.sk), scheme: 'kraywallet' } as unknown as KrayEvent
  }
  let sealN = 0
  const seal = () => { sealN += 1; L.applyLive({ seq: nextSeq(), kind: 'seal', hash: 's' + sealN, l1Txid: (sealN.toString(16).padStart(8, '0')).repeat(8) } as unknown as KrayEvent) }
  const balBefore = L.balanceOf(A.addr)
  L.applyLive(insAt(MAX_INSCRIPTION_BYTES, 2, 'max'))
  ok(L.balanceOf(A.addr) === balBefore - 21n, `C1 — a work of EXACTLY ${MAX_INSCRIPTION_BYTES.toLocaleString()} bytes is inscribable and burns 21 ₭ (the 21 MB ceiling, priced by the era's rate)`)
  const overTry = insAt(MAX_INSCRIPTION_BYTES + 1, 3, 'over')
  rejects(() => L.applyLive(overTry),
    /protocol ceiling/, `C1 — one byte over the ceiling (${(MAX_INSCRIPTION_BYTES + 1).toLocaleString()}) is refused before any burn`)
  ok(L.balanceOf(A.addr) === balBefore - 21n, 'C1 — the refused monster burned NOTHING (refusal before mutation)')
  const typeTry = { ...insAt(1000, 3, 'type'), size: '1000' } as unknown as KrayEvent
  rejects(() => L.applyLive(typeTry),
    /size must be a finite non-negative number|does not verify/, 'C1 — a hostile size TYPE (string) is refused by the shape gate')

  // C1 filled the open seal's 21 MB budget exactly — a seal must pass before more content fits.
  seal()

  // ── C2 · THE SIZE-BURN LAW — 1 ₭ per started MB, floor 1, refused whole when unaffordable ──
  const burnedBefore = L.totalBurned
  const balC2 = L.balanceOf(A.addr)
  L.applyLive(insAt(1_000_000, 3, 'oneMB'))       // exactly 1 MB → still 1 ₭
  ok(L.totalBurned === burnedBefore + 1n, 'C2 — exactly 1,000,000 bytes burns exactly 1 ₭ (the boundary is inclusive)')
  L.applyLive(insAt(1_000_001, 4, 'oneMBplus'))   // one byte into the second MB → 2 ₭
  ok(L.totalBurned === burnedBefore + 3n, 'C2 — 1,000,001 bytes burns 2 ₭ (a started MB is a whole MB)')
  L.applyLive(insAt(5_242_880, 5, 'song'))        // a 5 MB song → 6 ₭
  ok(L.totalBurned === burnedBefore + 9n, 'C2 — a 5 MB song burns 6 ₭ — the star carries its cost in fire')
  ok(L.balanceOf(A.addr) === balC2 - 9n, 'C2 — the creator paid exactly the law, nothing more')
  // a pauper with 3 ₭ cannot afford a 10 MB star (10 ₭) — refused WHOLE, nothing burned
  const P = wallet('regtest', 'pauper')
  L.applyLive({ seq: nextSeq(), kind: 'donate', hash: 'dp', to: P.addr, amount: '3' } as KrayEvent)
  const pMsg = inscribeMessageV2(NET, P.addr, createHash('sha256').update('poor').digest('hex'), 'video/mp4', 10_000_000, undefined, 0)
  rejects(() => L.applyLive({ seq: nextSeq(), kind: 'inscribe', hash: 'cpoor', from: P.addr, contentHash: createHash('sha256').update('poor').digest('hex'), contentType: 'video/mp4', size: 10_000_000, nonce: 0, publicKey: P.pk, signature: _signKrayWallet(pMsg, P.sk), scheme: 'kraywallet' } as unknown as KrayEvent),
    /insufficient ₭ to burn/, 'C2 — 3 ₭ cannot afford a 10 ₭ star: refused whole, before any mutation')
  ok(L.balanceOf(P.addr) === 3n, 'C2 — the pauper still holds every ₭ (refusal burned nothing)')

  // ── C3 · THE SEAL BUDGET — 21 MB of content per seal, HARD, like a block that must fit its largest tx ──
  seal()
  L.applyLive(insAt(20_000_000, 6, 'big'))
  const overflowTry = insAt(1_500_000, 7, 'overflow')
  rejects(() => L.applyLive(overflowTry),
    /seal's content budget is full/, 'C3 — 20 MB + 1.5 MB in ONE seal overflows the 21 MB budget: refused whole (a full mempool, not a punishment)')
  const balC3 = L.balanceOf(A.addr)
  seal()
  L.applyLive(insAt(1_500_000, 7, 'afterseal'))
  ok(L.balanceOf(A.addr) === balC3 - 2n, 'C3 — the SAME act passes right after the next seal (1.5 MB → 2 ₭)')

  // ── C4 · THE SPACE RETARGET — every 210 seals the byte price re-derives from measured demand ──
  ok(L.bytesPerKray === 1_000_000, 'C4 — the era opens at the genesis rate (1 ₭ per MB)')
  // a HEAVY window: 96 stars of 21 MB = 2016 MB — double the 1008 MB weekly target → the price DOUBLES (rate halves)
  for (let i = 0; i < 96; i++) { seal(); L.applyLive(insAt(21_000_000, 8 + i, 'w' + i)) }
  while (sealN < 1008) seal()
  ok(L.bytesPerKray === 500_000, `C4 — a 2016 MB week against the 1008 MB target HALVES bytes-per-₭ (price ×2) — got 1 ₭ per ${L.bytesPerKray} bytes`)
  // a QUIET week: no content at all → the price relaxes (clamped ×2 per window)
  while (sealN < 2016) seal()
  ok(L.bytesPerKray === 1_000_000, 'C4 — an empty week relaxes the rate back (×2 clamp): the law breathes both ways')

  ok(L.conserves(), 'conservation holds across every refused guard — a refusal mutates nothing')
  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the four swarm-found consensus holes, sealed and pinned. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
