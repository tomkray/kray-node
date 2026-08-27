/**
 * STAR SPEAK — free hold proof. No journal. No ₭.
 *   node src/test/star-speak.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
} from '../protocol/scheme.ts'
import {
  speakMessage, parseSpeakMessage, verifySpeak, speakId, SPEAK_PREFIX, type SpeakProof,
} from '../protocol/star-speak.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update('star-speak|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}

function main() {
  console.log('\n╔═ STAR SPEAK — free hold · BIP-340 · no journal ═╗\n')
  const A = wallet('holder')
  const B = wallet('stranger')
  const now = 1_700_000_000
  const challenge = {
    network: 'regtest',
    star: '42',
    owner: A.addr,
    audience: 'car',
    nonce: 'ab'.repeat(16),
    exp: now + 60,
  }
  const message = speakMessage(challenge)
  ok(message.startsWith(SPEAK_PREFIX), 'domain-separated speak message')
  const parsed = parseSpeakMessage(message)
  ok(!('ok' in parsed && parsed.ok === false) && (parsed as { star: string }).star === '42', 'message round-trips')

  const sig = _signKrayWallet(message, A.sk)
  const proof: SpeakProof = { ...challenge, message, signature: sig, publicKey: A.pk, scheme: 'kraywallet' }
  const good = verifySpeak(proof, A.addr, now)
  ok(good.ok === true, 'the living owner speaks — the car lock would open')

  const thief = verifySpeak({ ...proof, signature: _signKrayWallet(message, B.sk), publicKey: B.pk }, A.addr, now)
  ok(thief.ok === false, 'a stranger key cannot speak for the face')

  const stale = verifySpeak(proof, A.addr, now + 120)
  ok(stale.ok === false && /expired/i.test(stale.reason || ''), 'an expired challenge is refused')

  const wrongOwner = verifySpeak(proof, B.addr, now)
  ok(wrongOwner.ok === false, 'a sold face — the old key no longer speaks')

  const long = verifySpeak({ ...proof, exp: now + 10_000, message: speakMessage({ ...challenge, exp: now + 10_000 }) }, A.addr, now)
  ok(long.ok === false && /too long/i.test(long.reason || ''), 'a challenge that lives too long is refused')

  const net = verifySpeak(proof, A.addr, now, 'signet')
  ok(net.ok === false && /network/i.test(net.reason || ''), 'a speak on the wrong network is refused')
  ok(speakId(message).length === 64, 'speakId is a 32-byte hex the lock can store')
  const again = verifySpeak(proof, A.addr, now)
  ok(again.ok === true, 'the protocol does not consume the nonce — the lock does (A2: Speak is not a journal act)')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — SPEAK HOLDS: the star id is the lock, the living key is the mouth, a stranger re-derives from bytes, nothing is journaled. ⚖`)
}
main()
