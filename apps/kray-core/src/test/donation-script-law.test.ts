/**
 * ATO B — DONATION-SCRIPT LAW. Expected burn script is not env.
 *   node src/test/donation-script-law.test.ts
 *
 * At/after the pin: a sealed donate re-derives from BIP-341 NUMS (in the book).
 * A classic fixed-pot donate is refused (that script was never journaled).
 * Two ledgers, same event, with and without KRAY_POT_* ctor args — same verdict (A3).
 * Below the pin: ADR-1 opt-in skip is byte-identical on regtest benches.
 * Signet is a test universe — same pin as main (0).
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { verifyDonationProof, donorOpReturnScriptHex, checkProofOfWork, sha256d } from '../anchor/spv.ts'
import { BURN_INTERNAL_KEY, selfAnchorBurnScriptHex } from '../protocol/self-anchor.ts'
import { KrayAnchor } from '../anchor/anchor.ts'
import { NETWORKS, _generateKeyPair, _hexToBytes } from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const s = (e as Error).message; ok(re.test(s), m + (re.test(s) ? '' : ' — wrong: ' + s)) }
}

const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b.toString('hex') }
const pushScript = (hex: string) => (hex.length / 2).toString(16).padStart(2, '0') + hex
const DONOR = 'bcrt1pc9u6kpmgue4c3pyexa9erld2c8s26rl0nv5z2cgsgxzuluten0cs5vduyq'
const POT_SCRIPT = '5120' + '11'.repeat(32)
function tx(outs: Array<{ sats: bigint; script: string }>): string {
  const outHex = outs.map((o) => u64le(o.sats) + pushScript(o.script)).join('')
  return ['01000000', '01', '00'.repeat(32), 'ffffffff', '00', 'ffffffff', outs.length.toString(16).padStart(2, '0'), outHex, '00000000'].join('')
}
function mineHeader(prevInternal: Buffer, merkleRootInternal: Buffer): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); merkleRootInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000, 68); h.writeUInt32LE(0x207fffff, 72)
  for (let nonce = 0; nonce < 2_000_000; nonce++) {
    h.writeUInt32LE(nonce, 76)
    if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h
  }
  throw new Error('could not mine a regtest header')
}
function bury(rawTx: string, depth = 3) {
  const txidInternal = sha256d(Buffer.from(rawTx, 'hex'))
  const headers: Buffer[] = [mineHeader(Buffer.alloc(32), txidInternal)]
  for (let i = 1; i < depth; i++) headers.push(mineHeader(sha256d(headers[i - 1]), Buffer.alloc(32, i + 5)))
  return {
    rawTx,
    txoutproof: Buffer.concat([headers[0], Buffer.from([1, 0, 0, 0]), Buffer.from([1]), txidInternal, Buffer.from([1]), Buffer.from([0x01])]).toString('hex'),
    headers: headers.map((h) => h.toString('hex')),
  }
}
function addr(net: 'regtest' | 'signet' | 'main', tag: string): string {
  const sk = createHash('sha256').update('dscript|' + tag).digest()
  return btc.p2tr(_hexToBytes(_generateKeyPair(sk).publicKeyHex), undefined, NETWORKS[net]).address!
}

/** Inject donation-script pin as the last ctor arg. */
const law = (h: number, potScript?: string, potKey?: string) =>
  new KrayLedger(undefined, 'regtest', potScript, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, potKey, undefined, undefined, undefined, undefined, h)

function main() {
  console.log('\n╔═ ATO B — DONATION-SCRIPT LAW: expected burn is NUMS, not env ═╗\n')

  const SEAL = { blockNumber: 273, root: 'd075bab7e6140030536ded94cfd6003b01e31b843b4565a6387527261ea57249' }
  const BURN_SCRIPT = selfAnchorBurnScriptHex(KrayAnchor.payload(SEAL.blockNumber, SEAL.root))
  const good = tx([{ sats: 10_000n, script: BURN_SCRIPT }, { sats: 0n, script: donorOpReturnScriptHex(DONOR) }])
  const proof = bury(good)
  const v = verifyDonationProof(proof, { potScriptHex: BURN_SCRIPT, minConfirmations: 1, net: 'regtest' })
  ok(v.ok && v.sats === 10_000n && v.donor === DONOR, 'fixture: NUMS self-anchor proof verifies')
  const OUT = v.outpoint!

  const ev = { seq: 1, kind: 'donate', to: DONOR, amount: '10000', outpoint: OUT, proof, anchorBlock: SEAL.blockNumber, anchorRoot: SEAL.root } as unknown as KrayEvent

  const bare = law(0)
  bare.applyLive(ev)
  ok(bare.balanceOf(DONOR) === 10_000n && bare.conserves(), 'B-01 at the pin, NO env: sealed donate re-derives NUMS and mints')

  const armed = law(0, POT_SCRIPT, BURN_INTERNAL_KEY)
  armed.applyLive(ev)
  ok(armed.balanceOf(DONOR) === 10_000n, 'B-02 at the pin, WITH env: same mint — env is not the judge')

  const spendable = '11'.repeat(32)
  rejects(
    () => law(0, undefined, spendable).applyLive(ev),
    /NUMS — a configured spendable key/,
    'B-03 a spendable potInternalKeyHex is refused — env cannot pick the burn key',
  )

  const classic = bury(tx([{ sats: 9_000n, script: POT_SCRIPT }, { sats: 0n, script: donorOpReturnScriptHex(DONOR) }]))
  const vc = verifyDonationProof(classic, { potScriptHex: POT_SCRIPT, minConfirmations: 1, net: 'regtest' })
  rejects(
    () => law(0, POT_SCRIPT).applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '9000', outpoint: vc.outpoint!, proof: classic } as unknown as KrayEvent),
    /must name its self-anchor seal/,
    'B-04 classic fixed-pot donate is refused at the pin — that script is not in the journal',
  )

  rejects(
    () => law(0).applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '100', outpoint: 'aa'.repeat(32) + ':0', proof: { rawTx: '00', txoutproof: '00', headers: [] } } as unknown as KrayEvent),
    /must name its self-anchor seal/,
    'B-05 dummy proof without a seal is refused (the P-03 skip is closed at the pin)',
  )

  const below = new KrayLedger(undefined, 'regtest')
  below.applyLive({ seq: 1, kind: 'donate', to: DONOR, amount: '10000', outpoint: OUT, proof } as unknown as KrayEvent)
  ok(below.balanceOf(DONOR) === 10_000n, 'B-06 below the pin, no env: skip still mints (byte-identical ADR-1 opt-in)')

  const tb1 = addr('signet', 'tb')
  rejects(
    () => new KrayLedger(undefined, 'signet').applyLive({ seq: 1, kind: 'donate', to: tb1, amount: '100', outpoint: 'bb'.repeat(32) + ':0', proof: { rawTx: '00', txoutproof: '00', headers: [] } } as unknown as KrayEvent),
    /must name its self-anchor seal/,
    'B-07 default Signet (pin 0) refuses a dummy proven donate — the test universe rehearses main',
  )

  const bc1 = addr('main', 'bc')
  rejects(
    () => new KrayLedger(undefined, 'main').applyLive({ seq: 1, kind: 'donate', to: bc1, amount: '100', outpoint: 'cc'.repeat(32) + ':0', proof: { rawTx: '00', txoutproof: '00', headers: [] } } as unknown as KrayEvent),
    /must name its self-anchor seal/,
    'B-08 default main (pin 0) refuses a dummy proven donate — empty genesis is perfect from the first mint',
  )

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the burn script is the book (NUMS), not a follower's env. ₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
