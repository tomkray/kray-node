/**
 * THE VAULT — an address the depositor can verify before parting with a coin.
 *   node src/test/vault.test.ts
 *
 * Every bridge asks the user to send funds somewhere and trust that the right
 * thing can move them. This suite proves the depositor never has to: the address
 * is DERIVED from readable parameters, the derivation is deterministic to the
 * byte, the key path is provably unspendable, and changing ANY parameter — one
 * guardian, the threshold, the timelock, the network — yields a different
 * address, so a swapped vault cannot hide.
 */
import * as btc from '@scure/btc-signer'
import { randomBytes } from 'node:crypto'
import {
  VAULT_TIMELOCK_BLOCKS, cooperativeScript, deriveVault, keyPathIsUnspendable,
  unilateralScript, verifyVault,
} from '../protocol/vault.ts'
import { _generateKeyPair } from '../protocol/scheme.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
function rejects(fn: () => void, why: RegExp, label: string): void {
  try { fn() } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (why.test(msg)) { pass++; return }
    console.error(`  ✗ FAILED (wrong refusal) — ${label}\n      got: ${msg}`); process.exit(1)
  }
  console.error(`  ✗ FAILED (expected refusal) — ${label}`); process.exit(1)
}
const xonly = (): string => _generateKeyPair(randomBytes(32)).publicKeyHex
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

function main() {
  const G = Array.from({ length: 5 }, xonly)
  const DEP = xonly()
  const base = { guardians: G, threshold: 3, depositor: DEP, net: 'main' as const }

  // ── 1 · THE ADDRESS IS DERIVED, AND ANYONE CAN RE-DERIVE IT ──────────────
  const v = deriveVault(base)
  ok(v.address.startsWith('bc1p'), `the vault is a taproot address — ${v.address.slice(0, 18)}…`)
  ok(deriveVault(base).address === v.address, 'DETERMINISTIC: the same parameters give the same address, every time')
  ok(deriveVault({ ...base, guardians: [...G].reverse() }).address === v.address, 'the guardian SET is sorted, so the order somebody listed keys in cannot change the vault')
  ok(verifyVault(v.address, base).ok, 'a depositor can VERIFY the address against the parameters before sending a coin')

  // ── 2 · CHANGE ANYTHING AND THE ADDRESS CHANGES — a swap cannot hide ─────
  const variants: Array<[string, Parameters<typeof deriveVault>[0]]> = [
    ['one guardian replaced', { ...base, guardians: [...G.slice(0, 4), xonly()] }],
    ['a guardian added', { ...base, guardians: [...G, xonly()] }],
    ['the threshold raised', { ...base, threshold: 4 }],
    ['the timelock changed', { ...base, timelock: 1000 }],
    ['a different depositor', { ...base, depositor: xonly() }],
    ['a different network', { ...base, net: 'regtest' as const }],
  ]
  for (const [label, p] of variants) {
    const other = deriveVault(p)
    ok(other.address !== v.address, `${label} → a DIFFERENT address, so a swapped vault is visible immediately`)
    ok(!verifyVault(v.address, p).ok, `…and verifying the original against those parameters REFUSES`)
  }

  // ── 3 · THE KEY PATH IS PROVABLY UNSPENDABLE ─────────────────────────────
  ok(keyPathIsUnspendable(hex(btc.TAPROOT_UNSPENDABLE_KEY)), 'the internal key is the NUMS point — no private key exists for it')
  ok(!keyPathIsUnspendable(DEP), '…and any real key is correctly rejected as an internal key')
  ok(v.tapMerkleRoot.length === 64, 'the tap merkle root is published, so the address can be rebuilt by hand from the two scripts')

  // ── 4 · THE TWO SCRIPTS SAY EXACTLY WHAT THEY SHOULD ─────────────────────
  const coop = cooperativeScript('99'.repeat(32), ['ab'.repeat(32), 'cd'.repeat(32)], 2)
  const ch = hex(coop)
  ok(ch.startsWith('20' + '99'.repeat(32) + 'ad'), 'the cooperative path starts with the DEPOSITOR and OP_CHECKSIGVERIFY — the owner co-signs; no threshold of guardians moves funds alone')
  ok(ch.includes('20' + 'ab'.repeat(32) + 'ac'), '…then the first guardian and OP_CHECKSIG')
  ok(ch.includes('20' + 'cd'.repeat(32) + 'ba'), '…then every further key with OP_CHECKSIGADD — taproot\'s own k-of-n, no FROST ceremony needed')
  ok(ch.endsWith('529c'), '…and ends with the threshold and OP_NUMEQUAL (OP_2, then NUMEQUAL)')
  const solo = hex(unilateralScript('ef'.repeat(32), 4320))
  ok(solo.startsWith('20' + 'ef'.repeat(32) + 'ad'), 'the unilateral path starts with the DEPOSITOR\'s key and OP_CHECKSIGVERIFY')
  ok(solo.endsWith('02e010' + 'b2'), '…then the timelock and OP_CHECKSEQUENCEVERIFY (4320 as a minimal push, then CSV)')
  ok(hex(unilateralScript('ef'.repeat(32), 5)).endsWith('55b2'), 'a small timelock uses the minimal opcode form (OP_5, then CSV)')

  // ── 5 · MALFORMED PARAMETERS NEVER PRODUCE AN ADDRESS ────────────────────
  rejects(() => deriveVault({ ...base, threshold: 0 }), /threshold must be/, 'a threshold of zero → REFUSED (a vault anyone can open is not a vault)')
  rejects(() => deriveVault({ ...base, threshold: 6 }), /threshold must be/, 'a threshold larger than the guardian set → REFUSED (unspendable by the cooperative path, forever)')
  rejects(() => deriveVault({ ...base, guardians: [] }), /at least one guardian/, 'no guardians at all → REFUSED')
  rejects(() => deriveVault({ ...base, guardians: [G[0], G[0], G[1]] }), /duplicate guardian/, 'the same guardian counted twice → REFUSED (it would fake a threshold)')
  rejects(() => deriveVault({ ...base, guardians: ['nothex', ...G.slice(1)] }), /x-only hex/, 'a malformed guardian key → REFUSED')
  rejects(() => deriveVault({ ...base, depositor: 'short' }), /depositor key/, 'a malformed depositor key → REFUSED')
  rejects(() => deriveVault({ ...base, timelock: 0 }), /timelock must be/, 'a zero timelock → REFUSED (it would open the unilateral path immediately)')
  rejects(() => deriveVault({ ...base, timelock: 999_999 }), /timelock must be/, 'a timelock beyond what a relative CSV height can express → REFUSED')
  ok(!verifyVault('bc1pnotarealaddress', base).ok, 'verifying nonsense refuses rather than throwing')

  // ── 5b · THE CHAIN'S OWN KEY FORMS ARE ACCEPTED, AND COUNTED ONCE ────────
  // A wallet may seal a 33-byte compressed key or a 32-byte x-only one, and the
  // address derivation accepts both — so a vault built from SEALED guardian keys
  // must accept both, by the same rule, or the federation in the chain and the
  // federation in the script would be different sets. Found by wiring this to a
  // live network whose first guardian had sealed a compressed key.
  const compressed = '02' + G[0]
  ok(deriveVault({ ...base, guardians: [compressed, ...G.slice(1)] }).address === v.address, 'a COMPRESSED guardian key derives the identical vault — one rule, applied in one place')
  ok(deriveVault({ ...base, depositor: '03' + DEP }).address === v.address, '…and so does a compressed DEPOSITOR key')
  rejects(() => deriveVault({ ...base, guardians: [compressed, G[0], ...G.slice(1)] }), /duplicate guardian/, 'the same key in BOTH forms is ONE guardian, and counting it twice → REFUSED (it would fake a threshold)')

  // ── 6 · THE DEFAULT IS HONEST ────────────────────────────────────────────
  ok(deriveVault({ ...base, timelock: VAULT_TIMELOCK_BLOCKS }).address === v.address, `the default timelock is ${VAULT_TIMELOCK_BLOCKS} blocks (~30 days) — long enough that an honest federation always settles first, short enough that nobody's money is ever hostage`)
  ok(deriveVault({ ...base, guardians: [G[0]], threshold: 1 }).address !== v.address, 'a 1-of-1 vault is a legal shape — and it is a DIFFERENT address, so nobody can quietly shrink a federation')

  console.log(`\n✓ ${pass} checks passed — THE VAULT IS A SCRIPT, NOT A PROMISE: the address is DERIVED from readable parameters and re-derivable by anyone, so a depositor verifies the vault before parting with a coin; the internal key is the NUMS point, so the key path can never be spent and the only ways out are a THRESHOLD of sealed guardians (taproot's own CHECKSIGADD, no FROST ceremony) or the DEPOSITOR ALONE after the timelock — no federation, no permission. Changing one guardian, the threshold, the timelock or the network changes the address, so a swapped vault cannot hide; and every malformed parameter refuses instead of producing something unspendable. ₿`)
}
main()
