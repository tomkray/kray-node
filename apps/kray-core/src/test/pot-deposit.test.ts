/**
 * pot-deposit — the credit of a shared-pot L1 payment binds to the UNIQUE Taproot spender.
 * Prove by breaking: empty, mixed keys, non-taproot, case-fold, the happy one-owner path,
 * and the parent-tx hash bind (a swapped parent cannot steal the credit).
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { uniqueTaprootSpender, spendersFromParentTxs, creditOfPotDeposit } from '../protocol/pot-deposit.ts'
import { parseTx } from '../anchor/spv.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, addressOf, scriptOfAddress, addressOfScript } from '../protocol/scheme.ts'

let pass = 0, fail = 0
function ok(c: boolean, m: string) { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.error('  ✗', m) } }

const A = 'tb1pxd5snpedtrkqgmngclr4jk76g2xaf3aacawe37gqjkpvw6jcwyls09rm5u'
const B = 'tb1pt73mr87zjjxujnsu3uzhtjkmxn7sdtav3lkkawgk3fl0jhp3txmqqn97tv'

const one = uniqueTaprootSpender([A, A.toUpperCase(), A])
ok(one.ok === true && one.ok && one.address === A, 'many vins from one Taproot fold to that one address (case-insensitive)')

const empty = uniqueTaprootSpender([])
ok(empty.ok === false && /no spender/.test(empty.reason || ''), 'no vins → refuse — the node will not invent an owner')

const mixed = uniqueTaprootSpender([A, B])
ok(mixed.ok === false && /more than one spender/.test(mixed.reason || ''), 'two wallets in → refuse — Bob cannot share Alice\'s pot output')

const legacy = uniqueTaprootSpender(['tb1qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'])
ok(legacy.ok === false && /Taproot/.test(legacy.reason || ''), 'a non-Taproot spender → refuse — L2 credits are p2tr')

const blanks = uniqueTaprootSpender(['', A, '  '])
ok(blanks.ok === true && blanks.ok && blanks.address === A, 'blank prevouts are ignored — leftover change-less slots do not invent a second owner')

// ── parent-tx hash bind (regtest, real keys, real scripts) ───────────────────
const NET = 'regtest', BNET = toBtcNet(NET)
const mk = (t: string) => {
  const sk = createHash('sha256').update(`pot-deposit|${t}`).digest()
  const { publicKeyHex: pk } = _generateKeyPair(sk)
  return { pk, addr: addressOf(pk, BNET) }
}
const alice = mk('alice'), bob = mk('bob')

const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b.toString('hex') }
const pushScript = (hex: string) => (hex.length / 2).toString(16).padStart(2, '0') + hex
function tx(outs: Array<{ sats: bigint; script: string }>): string {
  const outHex = outs.map((o) => u64le(o.sats) + pushScript(o.script)).join('')
  return ['01000000', '01', '00'.repeat(32), 'ffffffff', '00', 'ffffffff', outs.length.toString(16).padStart(2, '0'), outHex, '00000000'].join('')
}
function txSpend(prevDisplay: string, vout: number, outs: Array<{ sats: bigint; script: string }>): string {
  const prevInternal = Buffer.from(prevDisplay, 'hex').reverse().toString('hex')
  const voutHex = Buffer.alloc(4); voutHex.writeUInt32LE(vout)
  const outHex = outs.map((o) => u64le(o.sats) + pushScript(o.script)).join('')
  return ['01000000', '01', prevInternal, voutHex.toString('hex'), '00', 'ffffffff', outs.length.toString(16).padStart(2, '0'), outHex, '00000000'].join('')
}

const aliceScript = scriptOfAddress(alice.addr, BNET)
ok(addressOfScript(aliceScript, BNET) === alice.addr, 'addressOfScript ∘ scriptOfAddress is the identity on a BIP-86 p2tr')

const parent = tx([{ sats: 10_000n, script: aliceScript }])
const parentTxid = parseTx(parent).txidDisplay
const potScript = scriptOfAddress(alice.addr, BNET) // any p2tr pot-shaped output — the bind is the vin
const deposit = txSpend(parentTxid, 0, [{ sats: 9_000n, script: potScript }])

const named = spendersFromParentTxs(deposit, [parent], NET)
ok(named.ok === true && named.ok && named.addresses.length === 1 && named.addresses[0] === alice.addr,
  'a deposit that spends Alice\'s parent names Alice — from bytes, not a client field')

const credited = creditOfPotDeposit(deposit, [parent], NET)
ok(credited.ok === true && credited.ok && credited.address === alice.addr,
  'creditOfPotDeposit folds the unique spender to Alice')

const missing = spendersFromParentTxs(deposit, [], NET)
ok(missing.ok === false && /no parent tx/.test(missing.reason || ''), 'no parent txs → refuse — the node will not invent a spender')

const bobParent = tx([{ sats: 10_001n, script: scriptOfAddress(bob.addr, BNET) }])
const swapped = spendersFromParentTxs(deposit, [bobParent], NET)
ok(swapped.ok === false && /no parent tx/.test(swapped.reason || ''),
  'a swapped parent (Bob\'s tx, Alice\'s vin) refuses — hash bind, not trust')

const steal = creditOfPotDeposit(deposit, [bobParent, parent], NET)
ok(steal.ok === true && steal.ok && steal.address === alice.addr,
  'an extra unused parent is ignored — only the vin-named parent can speak')

console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — a pot deposit credits the one Bitcoin spender, never a client field. ₿₭\n`)
process.exit(fail ? 1 : 0)
