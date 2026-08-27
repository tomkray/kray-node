/**
 *   node src/test/pot-key-share.test.ts
 */
import { randomBytes } from 'node:crypto'
import { combineOwnerShares, parseOwnerShare, splitOwnerSecret } from '../protocol/pot-key-share.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`)
  process.exit(1)
}

const fixed = Buffer.alloc(32, 0x42)
const fixedShares = splitOwnerSecret(fixed)
ok(Buffer.from(combineOwnerShares([fixedShares[0], fixedShares[1]])).equals(fixed), 'constant secret 0x42 rebuilds')

const secret = randomBytes(32)
const shares = splitOwnerSecret(secret)
ok(shares.length === 3, '2-of-3 emits three shares')
ok(new Set(shares.map((s) => s.i)).size === 3, 'share indexes 1,2,3')

for (const pair of [[0, 1], [0, 2], [1, 2]] as const) {
  const got = Buffer.from(combineOwnerShares([shares[pair[0]], shares[pair[1]]]))
  ok(got.equals(secret), `shares ${pair[0] + 1}+${pair[1] + 1} rebuild the owner`)
}

let threw = false
try { combineOwnerShares([shares[0]]) } catch { threw = true }
ok(threw, 'one share refuses')

threw = false
try { combineOwnerShares([shares[0], shares[0]]) } catch { threw = true }
ok(threw, 'duplicate index refuses')

const bad = { ...shares[1], y: '00'.repeat(32) }
const other = combineOwnerShares([shares[0], bad])
ok(!Buffer.from(other).equals(secret), 'a flipped share does not yield the owner')

const round = parseOwnerShare(JSON.stringify(shares[2]))
ok(combineOwnerShares([shares[0], round]).length === 32, 'JSON round-trip share still combines')

console.log(`\n✓ ${pass} checks passed — SHAMIR 2-OF-3: any pair rebuilds the 32-byte owner; one share is not the pot.`)
