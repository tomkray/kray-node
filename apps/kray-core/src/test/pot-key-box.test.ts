/**
 * OWNER KEY BOX — encrypt at rest; wrong phrase / tamper refuse.
 *   node src/test/pot-key-box.test.ts
 */
import { randomBytes } from 'node:crypto'
import { sealOwnerSecret, openOwnerSecret, parseOwnerBox } from '../protocol/pot-key-box.ts'

let pass = 0
function ok(c: boolean, m: string) { if (c) { pass++; console.log('  ✓', m) } else { console.error('  ✗', m); process.exit(1) } }

const secret = randomBytes(32)
const phrase = 'a-lab-passphrase-16+'

const box = sealOwnerSecret(secret, phrase)
const opened = openOwnerSecret(box, phrase)
ok(Buffer.from(opened).equals(secret), 'the right passphrase opens the same 32 bytes')

const again = sealOwnerSecret(secret, phrase)
ok(again.salt !== box.salt && again.ct !== box.ct, 'each seal is fresh (new salt and nonce)')

try {
  openOwnerSecret(box, 'a-wrong-passphrase-16+')
  ok(false, 'wrong passphrase must refuse')
} catch (e) {
  ok(/wrong passphrase or tampered/.test((e as Error).message), 'ATTACK: wrong passphrase → refused')
}

try {
  sealOwnerSecret(secret, 'short')
  ok(false, 'short passphrase must refuse')
} catch (e) {
  ok(/at least 16/.test((e as Error).message), 'a short phrase is not a lock')
}

const tampered = { ...box, ct: box.ct.replace(/[0-9a-f]$/i, (c) => (c === '0' ? '1' : '0')) }
try {
  openOwnerSecret(tampered, phrase)
  ok(false, 'tampered box must refuse')
} catch (e) {
  ok(/wrong passphrase or tampered/.test((e as Error).message), 'ATTACK: flipped ciphertext bit → refused')
}

const weak = { ...box, N: 1024 }
try {
  openOwnerSecret(weak, phrase)
  ok(false, 'weak KDF must refuse')
} catch (e) {
  ok(/too weak/.test((e as Error).message), 'ATTACK: weakened scrypt params → refused')
}

const round = parseOwnerBox(JSON.stringify(box))
ok(Buffer.from(openOwnerSecret(round, phrase)).equals(secret), 'a JSON-round-tripped box still opens')

console.log(`\n╚═ ${pass} passed — a stolen box without the phrase is not the pot. ₿₭`)
