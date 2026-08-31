/**
 * THE MINT-WITNESS LAW — a rune ancestry may terminate at a WITNESSED mint of the focused rune.
 *   node src/test/mint-witness-law.test.ts
 *
 * Before this law (born-strict keystone), a deposit whose runes were born from an open MINT
 * could never be credited: the walk hit the mint and refused `needs-index`, honestly — cap
 * legality is global state no light verifier can decide. The law keeps every byte-provable
 * fact byte-proven (burial, the Mint tag, the BIP-34 height via the block's own coinbase,
 * the window and the amount from the etch's OWN terms in the SAME bundle) and admits exactly
 * ONE journaled statement: the writer's witness that the mint was within cap.
 *
 * Pinned here, by breaking:
 *   · honest: etch(terms) + witnessed mint + deposit → credited terms.amount from bytes
 *   · dormant: the same bundle BEFORE the pin → refused needs-index (A3: pre-law unchanged)
 *   · naked: a mint entry without the witness → refused needs-index (the pin alone opens nothing)
 *   · rootless: the etch missing from the bundle → refused mint-unproven (no terms, no amount)
 *   · shut window: a mint buried past heightEnd → refused mint-unproven (end exclusive, ord law)
 *   · forged: the event claims more than terms.amount → refused (present-but-false HALTs)
 *   · foreign witness: a coinbase proof from another block → refused mint-unproven
 *   · replay: a cold ledger re-derives the witnessed credit from the journal alone
 *   · conservation: the reserve rises by exactly the credited amount
 */
import { KrayLedger } from '../protocol/ledger.ts'
import { deriveVault } from '../protocol/vault.ts'
import { addressOf, scriptOfAddress, _generateKeyPair } from '../protocol/scheme.ts'
import { TAG, FLAG, encodeVarint, runeValue, type RuneId } from '../protocol/runestone.ts'
import { checkProofOfWork, sha256d, toDisplayHex } from '../anchor/spv.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'
import { createHash } from 'node:crypto'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}

// ── the miniature Bitcoin from the keystone exam: raw txs, real merkle proofs, mined regtest headers ──
const varintBytes = (n: number): number[] => (n < 0xfd ? [n] : [0xfd, n & 0xff, n >> 8])
function rawTx(inputs: Array<{ txid: string; vout: number }>, outputs: Uint8Array[]): string {
  const b: number[] = [0x01, 0x00, 0x00, 0x00, ...varintBytes(inputs.length)]
  for (const i of inputs) {
    b.push(...Buffer.from(i.txid, 'hex').reverse())
    b.push(i.vout & 0xff, (i.vout >> 8) & 0xff, (i.vout >> 16) & 0xff, (i.vout >> 24) & 0xff)
    b.push(0x00, 0xff, 0xff, 0xff, 0xff)
  }
  b.push(...varintBytes(outputs.length))
  for (const o of outputs) {
    b.push(0xe8, 0x03, 0, 0, 0, 0, 0, 0)
    b.push(...varintBytes(o.length), ...o)
  }
  b.push(0x00, 0x00, 0x00, 0x00)
  return Buffer.from(b).toString('hex')
}
function header(prevInternal: Buffer, merkleInternal: Buffer, nonce: number): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); merkleInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000, 68); h.writeUInt32LE(0x207fffff, 72)
  for (let n = nonce; n < nonce + 1_000_000; n++) {
    h.writeUInt32LE(n >>> 0, 76)
    if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h
  }
  throw new Error('unmineable')
}
function bury(raw: string, nonce: number, confs = 2): { txoutproof: string; headers: string[] } {
  const txid = sha256d(Buffer.from(raw, 'hex'))
  const h1 = header(Buffer.alloc(32, nonce), txid, nonce)
  const headers = [h1]
  for (let i = 1; i < confs; i++) headers.push(header(sha256d(headers[i - 1]), Buffer.alloc(32, i), nonce * 100 + i))
  const txoutproof = Buffer.concat([h1, Buffer.from([1, 0, 0, 0]), Buffer.from([1]), txid, Buffer.from([1]), Buffer.from([0x01])]).toString('hex')
  return { txoutproof, headers: headers.map((h) => h.toString('hex')) }
}
/** A coinbase carrying the BIP-34 height — the block's identity witness (etch AND mint). */
function cbTx(height: number): string {
  const le: number[] = []
  let h = height
  while (h > 0) { le.push(h & 0xff); h >>= 8 }
  const push = [le.length, ...le]
  const b: number[] = [0x01, 0x00, 0x00, 0x00, 0x01, ...new Array(32).fill(0), 0xff, 0xff, 0xff, 0xff]
  b.push(...varintBytes(push.length), ...push, 0xff, 0xff, 0xff, 0xff)
  b.push(0x01, 0xe8, 0x03, 0, 0, 0, 0, 0, 0, 0x02, 0x51, 0x51)
  b.push(0x00, 0x00, 0x00, 0x00)
  return Buffer.from(b).toString('hex')
}
/** Bury a TWO-tx block (coinbase at 0, target at 1) — proofs for both against one header. */
function bury2(cbRaw: string, raw: string, nonce: number, confs = 2): { txoutproof: string; headers: string[]; coinbaseTx: string; coinbaseProof: string } {
  const cbid = sha256d(Buffer.from(cbRaw, 'hex'))
  const txid = sha256d(Buffer.from(raw, 'hex'))
  const root = sha256d(Buffer.concat([cbid, txid]))
  const h1 = header(Buffer.alloc(32, nonce), root, nonce)
  const headers = [h1]
  for (let i = 1; i < confs; i++) headers.push(header(sha256d(headers[i - 1]), Buffer.alloc(32, i), nonce * 100 + i))
  const wrap = (flags: number) => Buffer.concat([
    h1, Buffer.from([2, 0, 0, 0]), Buffer.from([2]), cbid, txid, Buffer.from([1]), Buffer.from([flags]),
  ]).toString('hex')
  return { txoutproof: wrap(0x05), coinbaseProof: wrap(0x03), headers: headers.map((h) => h.toString('hex')), coinbaseTx: cbRaw }
}
const txidOf = (raw: string): string => toDisplayHex(sha256d(Buffer.from(raw, 'hex')))
function stone(ints: bigint[]): Uint8Array {
  const body: number[] = []
  for (const n of ints) body.push(...encodeVarint(n))
  const out = [0x6a, 0x5d]
  for (let i = 0; i < body.length; i += 75) { const c = body.slice(i, i + 75); out.push(c.length, ...c) }
  return Uint8Array.from(out)
}
const keyOf = (tag: string) => _generateKeyPair(createHash('sha256').update('mint-witness|' + tag).digest())

/** keystone strict AND the mint-witness law active from seq 0 (constructor position 19) */
const witnessLedger = () => new KrayLedger(
  undefined, 'regtest', undefined, false, undefined,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  undefined, undefined, 0, undefined, 0,
)
/** keystone strict, mint-witness DORMANT (regtest default MAX) — the pre-law world */
const dormantLedger = () => new KrayLedger(
  undefined, 'regtest', undefined, false, undefined,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  undefined, undefined, 0,
)

function main() {
  console.log('\n╔═ THE MINT-WITNESS LAW — a witnessed mint terminates the walk ═╗\n')

  const depositor = keyOf('depositor')
  const guardians = [keyOf('g1'), keyOf('g2'), keyOf('g3')].map((k) => k.publicKeyHex)
  const vaultParams = { guardians, threshold: 2, depositor: depositor.publicKeyHex, timelock: 4320 }
  const vault = deriveVault({ ...vaultParams, net: 'regtest' })
  const VAULT = Uint8Array.from(Buffer.from(scriptOfAddress(vault.address, 'regtest'), 'hex'))
  const MINTER = Uint8Array.from([0x51, 0x20, ...new Array(32).fill(0x22)])
  const to = addressOf(depositor.publicKeyHex, 'regtest')
  const RUNE: RuneId = { block: 900_000n, tx: 1n }
  const runeId = '900000:1'

  // ── the chain: etch (terms 100/cap 3, NO premine) → mint (witnessed, height 900,050) → deposit ──
  const etchRaw = rawTx([{ txid: '00'.repeat(32), vout: 0 }], [
    MINTER,
    stone([TAG.Flags, (1n << FLAG.Etching) | (1n << FLAG.Terms), TAG.Rune, runeValue('KRAYMINTWITNESS'), TAG.Amount, 100n, TAG.Cap, 3n]),
  ])
  const etch = { rawTx: etchRaw, ...bury2(cbTx(900_000), etchRaw, 1), etchedId: runeId }
  const mintRaw = rawTx([{ txid: '11'.repeat(32), vout: 0 }], [
    MINTER,
    stone([TAG.Mint, RUNE.block, TAG.Mint, RUNE.tx]),
  ])
  const mintBurial = bury2(cbTx(900_050), mintRaw, 2)
  const mintWitnessed = {
    rawTx: mintRaw, txoutproof: mintBurial.txoutproof, headers: mintBurial.headers,
    mintWitness: { coinbaseTx: mintBurial.coinbaseTx, coinbaseProof: mintBurial.coinbaseProof },
  }
  const mintNaked = { rawTx: mintRaw, txoutproof: mintBurial.txoutproof, headers: mintBurial.headers }
  const depRaw = rawTx([{ txid: txidOf(mintRaw), vout: 0 }], [VAULT])
  const dep = { rawTx: depRaw, ...bury(depRaw, 3) }
  const outpoint = `${txidOf(depRaw)}:0`

  const depositEvent = (extra: Partial<KrayEvent>): KrayEvent => ({
    seq: 1, at: 0, kind: 'rune-deposit', hash: 'mw' + Math.random(),
    runeId, outpoint, to, amount: '100',
    ...extra,
  } as KrayEvent)
  const honestProof = { rawTx: depRaw, txoutproof: dep.txoutproof, headers: dep.headers, vault: vaultParams, ancestry: [etch, mintWitnessed, dep] }

  // ── 1 · HONEST: witnessed mint → credited terms.amount, everything else from bytes ──
  const L = witnessLedger()
  L.applyLive(depositEvent({ proof: honestProof }))
  ok(L.runes.balanceOf(RUNE, to) === 100n, 'HONEST: etch(terms) + witnessed mint + deposit → 100 credited (amount = the etch terms, never a report)')
  ok(L.runes.reserveOf(RUNE) === 100n, 'CONSERVATION: the reserve rises by exactly the credited amount')

  // ── 2 · DORMANT: the identical bundle BEFORE the pin refuses — A3, the pre-law world unchanged ──
  rejects(
    () => dormantLedger().applyLive(depositEvent({ proof: honestProof })),
    /needs-index/,
    'DORMANT: before the activation pin the same witnessed bundle still refuses needs-index (A3)',
  )

  // ── 3 · NAKED: the pin alone opens nothing — a mint entry without the witness refuses ──
  rejects(
    () => witnessLedger().applyLive(depositEvent({
      proof: { ...honestProof, ancestry: [etch, mintNaked, dep] },
    })),
    /needs-index/,
    'NAKED: the law active but no witness on the mint entry → refused needs-index',
  )

  // ── 4 · ROOTLESS: no etch in the bundle → no terms → refused, never guessed ──
  rejects(
    () => witnessLedger().applyLive(depositEvent({
      proof: { ...honestProof, ancestry: [mintWitnessed, dep] },
    })),
    /mint-unproven/,
    'ROOTLESS: the etch (the terms) missing from the bundle → refused mint-unproven',
  )

  // ── 5 · SHUT WINDOW: heightEnd 900,040 and the mint buried at 900,050 → refused ──
  {
    const shutEtchRaw = rawTx([{ txid: '00'.repeat(32), vout: 0 }], [
      MINTER,
      stone([TAG.Flags, (1n << FLAG.Etching) | (1n << FLAG.Terms), TAG.Rune, runeValue('KRAYWINDOWSHUT'), TAG.Amount, 100n, TAG.Cap, 3n, TAG.HeightEnd, 900_040n]),
    ])
    const shutEtch = { rawTx: shutEtchRaw, ...bury2(cbTx(900_000), shutEtchRaw, 4), etchedId: runeId }
    const shutDepRaw = rawTx([{ txid: txidOf(mintRaw), vout: 0 }], [VAULT])
    const shutDep = { rawTx: shutDepRaw, ...bury(shutDepRaw, 5) }
    rejects(
      () => witnessLedger().applyLive(depositEvent({
        outpoint: `${txidOf(shutDepRaw)}:0`,
        proof: { rawTx: shutDepRaw, txoutproof: shutDep.txoutproof, headers: shutDep.headers, vault: vaultParams, ancestry: [shutEtch, mintWitnessed, shutDep] },
      })),
      /mint-unproven/,
      'SHUT WINDOW: the mint buried at 900,050 against heightEnd 900,040 → refused mint-unproven',
    )
  }

  // ── 6 · FORGED: the event claims more than the terms allow one mint to yield ──
  rejects(
    () => witnessLedger().applyLive(depositEvent({
      amount: '150',
      proof: honestProof,
    })),
    /ancestry proves 100 .* not the credited 150/,
    'FORGED: claiming 150 when one mint yields 100 → refused (present-but-false HALTs)',
  )

  // ── 7 · FOREIGN WITNESS: a coinbase proof from ANOTHER block → refused before the walk ──
  rejects(
    () => witnessLedger().applyLive(depositEvent({
      proof: {
        ...honestProof,
        ancestry: [etch, {
          rawTx: mintRaw, txoutproof: mintBurial.txoutproof, headers: mintBurial.headers,
          mintWitness: { coinbaseTx: etch.coinbaseTx, coinbaseProof: etch.coinbaseProof },
        }, dep],
      },
    })),
    /mint-unproven/,
    'FOREIGN WITNESS: the etch block\'s coinbase presented as the mint\'s → refused mint-unproven',
  )

  // ── 8 · REPLAY: a cold ledger re-derives the witnessed credit from the journal alone ──
  {
    const cold = witnessLedger()
    cold.applyLive(depositEvent({ hash: 'mw-replay', proof: honestProof }))
    ok(cold.runes.balanceOf(RUNE, to) === 100n, 'REPLAY: a cold reboot re-proves the witnessed deposit from the journaled event alone')
  }

  if (fail) { console.log(`\n  ${fail} failed · ${pass} passed\n`); process.exit(1) }
  console.log(`\n  ${pass} passed\n`)
}

main()
