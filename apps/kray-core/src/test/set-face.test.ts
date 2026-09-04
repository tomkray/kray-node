/**
 * CITIZEN FACE (set-face) — bind one OWNED star as the address's profile mouth.
 *   node src/test/set-face.test.ts
 *
 * Pins: genesis root untouched · owner-only · forge refused · fee 1 ₭ ·
 * lose-star clears face · replay reproduces root · conservation holds.
 */
import { createHash } from 'node:crypto'
import { KrayLedger } from '../protocol/ledger.ts'
import { TREASURY } from '../protocol/kray-primitives.ts'
import {
  NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes,
  inscribeMessageV2, setFaceMessage, clearFaceMessage, sendStarMessage,
} from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'
import * as btc from '@scure/btc-signer'

const NET = 'regtest', BNET = toBtcNet(NET)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); fail++; console.log('  ✗ FAIL (accepted!) — ' + m) }
  catch (e) {
    const s = e instanceof Error ? e.message : String(e)
    if (re.test(s)) { pass++; console.log('  ✓ ' + m) }
    else { fail++; console.log(`  ✗ FAIL (wrong refusal "${s}") — ` + m) }
  }
}

interface W { addr: string; sk: Uint8Array; pk: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`set-face|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)

/** Contiguous journal builder — seq only advances on successful apply. */
function book() {
  let seq = 0
  const journal: KrayEvent[] = []
  const L = new KrayLedger(undefined, NET)
  const apply = (e: Omit<KrayEvent, 'seq' | 'hash' | 'prevHash'> & { hash?: string }) => {
    const full = { ...e, seq: ++seq, hash: e.hash ?? ('h' + seq), prevHash: '' } as KrayEvent
    L.applyLive(full)
    journal.push(full)
    return full
  }
  const mint = (to: string, amt: string) =>
    apply({ kind: 'donate', at: seq + 1, to, amount: amt, outpoint: createHash('sha256').update('o' + (seq + 1)).digest('hex') + ':0' } as never)
  const born = (owner: W, tag: string): bigint => {
    const before = L.stars.createdSeq
    const nonce = L.nonceOf(owner.addr)
    const ch = createHash('sha256').update(tag).digest('hex')
    const msg = inscribeMessageV2(NET, owner.addr, ch, 'text/plain', tag.length, undefined, nonce)
    apply({
      kind: 'inscribe', at: 0, from: owner.addr, contentHash: ch, contentType: 'text/plain', size: tag.length,
      nonce, publicKey: owner.pk, signature: sign(msg, owner), scheme: 'kraywallet',
    } as never)
    return BigInt(before)
  }
  const face = (w: W, star: bigint, signer: W = w) => {
    const nonce = L.nonceOf(w.addr)
    return apply({
      kind: 'set-face', at: 0, from: w.addr, star: star.toString(), fee: '1', nonce,
      publicKey: signer.pk, signature: sign(setFaceMessage(NET, w.addr, star, nonce), signer), scheme: 'kraywallet',
    } as never)
  }
  const clearFace = (w: W, signer: W = w) => {
    const nonce = L.nonceOf(w.addr)
    return apply({
      kind: 'clear-face', at: 0, from: w.addr, fee: '1', nonce,
      publicKey: signer.pk, signature: sign(clearFaceMessage(NET, w.addr, nonce), signer), scheme: 'kraywallet',
    } as never)
  }
  const tryClearFace = (w: W, signer: W = w) => {
    const nonce = L.nonceOf(w.addr)
    const e = {
      seq: seq + 1, prevHash: '', hash: 'hx', at: 0, kind: 'clear-face' as const, from: w.addr,
      fee: '1', nonce, publicKey: signer.pk,
      signature: sign(clearFaceMessage(NET, w.addr, nonce), signer), scheme: 'kraywallet',
    } as KrayEvent
    L.applyLive(e)
  }
  const send = (w: W, star: bigint, to: string) => {
    const nonce = L.nonceOf(w.addr)
    return apply({
      kind: 'transfer-star', at: 0, from: w.addr, to, star: star.toString(), fee: '1', nonce,
      publicKey: w.pk, signature: sign(sendStarMessage(NET, w.addr, to, star, nonce), w), scheme: 'kraywallet',
    } as never)
  }
  const tryFace = (w: W, star: bigint, signer: W = w) => {
    const nonce = L.nonceOf(w.addr)
    const e = {
      seq: seq + 1, prevHash: '', hash: 'hx', at: 0, kind: 'set-face' as const, from: w.addr,
      star: star.toString(), fee: '1', nonce, publicKey: signer.pk,
      signature: sign(setFaceMessage(NET, w.addr, star, nonce), signer), scheme: 'kraywallet',
    } as KrayEvent
    L.applyLive(e) // may throw — seq counter stays
  }
  return { L, journal, mint, born, face, clearFace, tryClearFace, send, tryFace }
}

function main() {
  console.log('\n╔═ CITIZEN FACE — set-face · owner-only · cascade by presence ═╗\n')

  ok(new KrayLedger(undefined, NET).cascadeParts().faceCommitment === undefined,
    'no faces ⇒ faceCommitment absent (A3)')
  const g1 = new KrayLedger(undefined, NET).cascadeRoot()
  ok(new KrayLedger(undefined, NET).cascadeRoot() === g1,
    'empty ledgers share the genesis cascade root')

  const A = wallet('alice'), B = wallet('bob'), M = wallet('mallory')

  // ── happy path + replay ──
  const a = book()
  a.mint(A.addr, '100')
  a.mint(B.addr, '50')
  const s1 = a.born(A, 'face-star-one')
  const s2 = a.born(A, 'face-star-two')
  const rootBefore = a.L.cascadeRoot()
  const balBefore = a.L.balanceOf(A.addr)
  const treasBefore = a.L.balanceOf(TREASURY)
  a.face(A, s1)
  ok(a.L.faceOf(A.addr) === s1.toString(), 'Alice wears star #' + s1 + ' as face')
  ok(a.L.cascadeRoot() !== rootBefore, 'a set face folds into the cascade root')
  ok(a.L.balanceOf(A.addr) === balBefore - 1n && a.L.balanceOf(TREASURY) === treasBefore + 1n,
    'exactly 1 ₭ fee → Treasury')
  a.face(A, s2)
  ok(a.L.faceOf(A.addr) === s2.toString(), 'Alice rotated her face to star #' + s2)
  ok(a.L.conserves(), 'conservation holds after set-face')

  // ── clear-face (paid return to default) ──
  rejects(() => a.tryClearFace(A, M), /signature|signed/i,
    'Mallory cannot clear Alice’s face')
  const balMid = a.L.balanceOf(A.addr)
  const treasMid = a.L.balanceOf(TREASURY)
  const rootWithFace = a.L.cascadeRoot()
  a.clearFace(A)
  ok(a.L.faceOf(A.addr) === null, 'clear-face returns to default (no face)')
  ok(a.L.balanceOf(A.addr) === balMid - 1n && a.L.balanceOf(TREASURY) === treasMid + 1n,
    'clear-face costs exactly 1 ₭ → Treasury')
  ok(a.L.cascadeRoot() !== rootWithFace, 'clearing the face changes the cascade root')
  rejects(() => a.tryClearFace(A), /no face/i,
    'clear-face refused when already default')

  a.face(A, s1)
  ok(a.L.faceOf(A.addr) === s1.toString(), 'Alice can set face again after clear')

  const b = book()
  for (const e of a.journal) b.L.applyLive({ ...e })
  ok(b.L.cascadeRoot() === a.L.cascadeRoot() && b.L.faceOf(A.addr) === s1.toString(),
    'stranger replay of the same journal reproduces face + cascade root')

  // ── hostile ──
  rejects(() => a.tryFace(A, s1, M), /signature|signed/i,
    'Mallory cannot set Alice’s face (forged signature refused)')
  ok(a.L.faceOf(A.addr) === s1.toString(), 'Alice’s face unchanged after forge')

  const bobStar = a.born(B, 'bob-only')
  rejects(() => a.tryFace(A, bobStar), /owner/i,
    'Alice cannot wear Bob’s star as face (not owner)')

  // ── lose the face star → clear ──
  a.send(A, s1, B.addr)
  ok(a.L.faceOf(A.addr) === null, 'sending the face star away clears the face')
  ok(a.L.conserves(), 'conservation holds after face clear via send')

  console.log(`\n${pass} passed, ${fail} failed\n`)
  if (fail) process.exit(1)
}
main()
