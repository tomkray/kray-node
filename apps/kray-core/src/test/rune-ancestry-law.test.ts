/**
 * THE KEYSTONE LAW — a rune deposit's input state re-derived from bytes in CONSENSUS.
 *   node src/test/rune-ancestry-law.test.ts
 *
 * Born strict on signet/main (RUNE_ANCESTRY_MANDATORY_SEQ = 0, ratified while both books
 * held zero transactions): at/after activation the reducer refuses a rune-deposit whose
 * proof does not embed the recursive ancestry bundle, and re-derives the deposited amount
 * itself — ord's word (`inputRunes`) stops being consensus input on those networks.
 *
 * Pinned here, by breaking:
 *   · strict: no bundle → refused before any verify
 *   · honest: etch premine → vault, proven from bytes, credited
 *   · forged: event claims more than the bundle proves → refused (present-but-false)
 *   · truncated: a link removed → walk proves 0, claimed credit refuses (amount check)
 *   · accumulated truth: a later deposit's walk stops at an outpoint this journal proved
 *   · attestation era: regtest default (MAX) keeps the old law byte-identical
 *   · replay: a cold second ledger re-derives the same credits from the journal alone
 *
 * PART II — THE SETTLE LEG (same activation, same window): the payout's input state is
 * re-derived from bytes too. Pinned: attestation-only settle refused · honest payout burns
 * the lock with the bundle = the payout alone (inputs are journal truth) · a payout that
 * delivers less than the lock refused · a payout that BURNS the focused rune refused ·
 * the consolidation change becomes accumulated truth for the next settle · journal-local ·
 * cold replay re-derives the whole deposit→exit→settle chain from the journal alone.
 */
import { KrayLedger } from '../protocol/ledger.ts'
import { deriveVault } from '../protocol/vault.ts'
import { addressOf, scriptOfAddress, _generateKeyPair, _signKrayWallet, runeExitMessage } from '../protocol/scheme.ts'
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

// ── a miniature Bitcoin: raw txs with real sats, real merkle proofs, mined regtest headers ──
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
    b.push(0xe8, 0x03, 0, 0, 0, 0, 0, 0) // 1,000 sats — the attestation path checks dust
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
/** A coinbase carrying the BIP-34 height — the etch block's identity witness. */
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
const keyOf = (tag: string) => _generateKeyPair(createHash('sha256').update('keystone|' + tag).digest())

/** A regtest ledger with THE KEYSTONE injected active from seq 0 (regtest's table default is MAX). */
const strictLedger = () => new KrayLedger(
  undefined, 'regtest', undefined, false, undefined,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  undefined, undefined, 0,
)

function main() {
  console.log('\n╔═ THE KEYSTONE — rune ancestry in consensus · born strict ═╗\n')

  // ── the cast: a depositor, three guardians, THE vault (re-derivable by anyone) ──
  const depositor = keyOf('depositor')
  const guardians = [keyOf('g1'), keyOf('g2'), keyOf('g3')].map((k) => k.publicKeyHex)
  const vaultParams = { guardians, threshold: 2, depositor: depositor.publicKeyHex, timelock: 4320 }
  const vault = deriveVault({ ...vaultParams, net: 'regtest' })
  const VAULT = Uint8Array.from(Buffer.from(scriptOfAddress(vault.address, 'regtest'), 'hex'))
  const OWNER = Uint8Array.from([0x51, 0x20, ...new Array(32).fill(0x11)])
  const to = addressOf(depositor.publicKeyHex, 'regtest')
  const RUNE: RuneId = { block: 900_000n, tx: 1n } // etched at INDEX 1 of block 900,000 — proven, never claimed
  const runeId = '900000:1'

  // ── the chain: etch (premine 1,000 → owner) → deposit (all 1,000 → THE VAULT) ──
  const etchRaw = rawTx([{ txid: '00'.repeat(32), vout: 0 }], [
    OWNER,
    stone([TAG.Flags, 1n << FLAG.Etching, TAG.Rune, runeValue('KRAYKEYSTONE'), TAG.Premine, 1000n]),
  ])
  const etch = { rawTx: etchRaw, ...bury2(cbTx(900_000), etchRaw, 1), etchedId: runeId }
  const depRaw = rawTx([{ txid: txidOf(etchRaw), vout: 0 }], [VAULT])
  const dep = { rawTx: depRaw, ...bury(depRaw, 2) }
  const outpoint = `${txidOf(depRaw)}:0`

  const depositEvent = (extra: Partial<KrayEvent>): KrayEvent => ({
    seq: 1, at: 0, kind: 'rune-deposit', hash: 'rd' + Math.random(),
    runeId, outpoint, to, amount: '1000',
    ...extra,
  } as KrayEvent)

  // ── 1 · BORN STRICT: no bundle → refused before any verify ─────────────────
  rejects(
    () => strictLedger().applyLive(depositEvent({
      proof: { rawTx: depRaw, txoutproof: dep.txoutproof, headers: dep.headers, vault: vaultParams, inputRunes: [{ id: runeId, amount: '1000' }] },
    })),
    /ancestry activation .* must embed its ancestry bundle/,
    'STRICT: an attestation-only proof is refused — ord\'s word is not consensus input',
  )
  rejects(
    () => strictLedger().applyLive(depositEvent({})),
    /must embed its L1 SPV proof|ancestry/,
    'STRICT: a proofless deposit is refused outright',
  )

  // ── 2 · THE HONEST DEPOSIT, PROVEN FROM BYTES ──────────────────────────────
  const L = strictLedger()
  L.applyLive(depositEvent({
    proof: { rawTx: depRaw, txoutproof: dep.txoutproof, headers: dep.headers, vault: vaultParams, ancestry: [etch, dep] },
  }))
  ok(L.runes.balanceOf(RUNE, to) === 1000n, 'HONEST: etch premine → vault, re-derived from bytes — 1,000 credited with no indexer\'s word')

  // ── 3 · FORGED: the event claims more than the bundle proves ───────────────
  rejects(
    () => strictLedger().applyLive(depositEvent({
      amount: '1700',
      proof: { rawTx: depRaw, txoutproof: dep.txoutproof, headers: dep.headers, vault: vaultParams, ancestry: [etch, dep] },
    })),
    /ancestry proves 1000 .* not the credited 1700/,
    'FORGED: claiming 1,700 when the bytes prove 1,000 → refused (present-but-false HALTs)',
  )

  // ── 4 · TRUNCATED: a link removed → the walk proves 0, the claimed credit refuses ──
  rejects(
    () => strictLedger().applyLive(depositEvent({
      proof: { rawTx: depRaw, txoutproof: dep.txoutproof, headers: dep.headers, vault: vaultParams, ancestry: [dep] },
    })),
    /ancestry proves 0 .* not the credited 1000/,
    'TRUNCATED: the etch removed from the bundle → walk proves 0, claimed 1,000 refuses (amount check)',
  )

  // ── 5 · THE JOURNAL'S ACCUMULATED TRUTH: a second hop stops at a proven outpoint ──
  const dep2Raw = rawTx([{ txid: txidOf(depRaw), vout: 0 }], [VAULT])
  const dep2 = { rawTx: dep2Raw, ...bury(dep2Raw, 3) }
  const outpoint2 = `${txidOf(dep2Raw)}:0`
  L.applyLive(depositEvent({
    seq: 2, outpoint: outpoint2,
    proof: { rawTx: dep2Raw, txoutproof: dep2.txoutproof, headers: dep2.headers, vault: vaultParams, ancestry: [dep2] },
  }))
  ok(L.runes.balanceOf(RUNE, to) === 2000n, 'ACCUMULATED TRUTH: the second deposit\'s bundle carries ONLY itself — the walk stops at the outpoint deposit #1 proved')
  rejects(
    () => strictLedger().applyLive(depositEvent({
      seq: 1, outpoint: outpoint2,
      proof: { rawTx: dep2Raw, txoutproof: dep2.txoutproof, headers: dep2.headers, vault: vaultParams, ancestry: [dep2] },
    })),
    /ancestry proves 0 .* not the credited 1000/,
    'ACCUMULATED TRUTH is journal-local: a fresh ledger that never proved deposit #1 walks 0 and refuses the claimed 1,000',
  )

  // ── 6 · THE ATTESTATION ERA IS UNTOUCHED: regtest default keeps the old law ──
  const bench = new KrayLedger(undefined, 'regtest')
  bench.applyLive(depositEvent({
    proof: { rawTx: depRaw, txoutproof: dep.txoutproof, headers: dep.headers, vault: vaultParams, inputRunes: [{ id: runeId, amount: '1000' }] },
  }))
  ok(bench.runes.balanceOf(RUNE, to) === 1000n, 'A3: the regtest bench (activation MAX) still accepts the attestation era byte-identically')

  // ── 7 · REPLAY: a cold ledger re-derives everything from the journaled events alone ──
  const journal: KrayEvent[] = [
    depositEvent({ seq: 1, hash: 'r1', proof: { rawTx: depRaw, txoutproof: dep.txoutproof, headers: dep.headers, vault: vaultParams, ancestry: [etch, dep] } }),
    depositEvent({ seq: 2, hash: 'r2', outpoint: outpoint2, proof: { rawTx: dep2Raw, txoutproof: dep2.txoutproof, headers: dep2.headers, vault: vaultParams, ancestry: [dep2] } }),
  ]
  const cold = strictLedger()
  for (const e of journal) cold.applyLive(e)
  ok(cold.runes.balanceOf(RUNE, to) === 2000n, 'REPLAY: a cold reboot re-proves both deposits (bundle + accumulated truth) from the journal alone')

  // ═══ PART II — THE SETTLE LEG: the payout's input state re-derived from bytes ═══
  console.log('\n╔═ THE KEYSTONE, SETTLE LEG — the payout input state is bytes ═╗\n')

  const destKey = keyOf('settle-dest')
  const destAddr = addressOf(destKey.publicKeyHex, 'regtest')
  const DEST = Uint8Array.from(Buffer.from(scriptOfAddress(destAddr, 'regtest'), 'hex'))

  // the honest payout: spends THE deposit outpoint (journal truth), 600 → the signed
  // destination, the 400 change consolidates back to the vault (pointer → output 1)
  const payout1Raw = rawTx([{ txid: txidOf(depRaw), vout: 0 }], [
    DEST, VAULT,
    stone([TAG.Pointer, 1n, TAG.Body, RUNE.block, RUNE.tx, 600n, 0n]),
  ])
  const payout1 = { rawTx: payout1Raw, ...bury(payout1Raw, 11) }
  const payout1Txid = txidOf(payout1Raw)

  /** a fresh strict world: donate gas → keystone deposit (1,000 in the vault outpoint) */
  const world = () => {
    const W = strictLedger()
    let s = 0
    const events: KrayEvent[] = []
    const put = (e: KrayEvent) => { W.applyLive(e); events.push(e); return e }
    const seq = () => ++s
    put({ seq: seq(), at: 0, kind: 'donate', hash: 'sd' + Math.random(), to, amount: '10' } as KrayEvent)
    put(depositEvent({
      seq: seq(), hash: 'sw' + Math.random(),
      proof: { rawTx: depRaw, txoutproof: dep.txoutproof, headers: dep.headers, vault: vaultParams, ancestry: [etch, dep] },
    }))
    const exit = (amount: bigint) => {
      const nonce = W.nonceOf(to)
      return put({
        seq: seq(), at: 0, kind: 'rune-exit', hash: 'sx' + Math.random(),
        runeId, from: to, amount: amount.toString(), l1Address: destAddr, fee: '1', nonce,
        publicKey: depositor.publicKeyHex, scheme: 'kraywallet',
        signature: _signKrayWallet(runeExitMessage('regtest', to, runeId, amount, destAddr, nonce), depositor.secretKey),
      } as KrayEvent)
    }
    const settle = (l1Txid: string, amount: string, proof: KrayEvent['proof']) => put({
      seq: seq(), at: 0, kind: 'rune-settle', hash: 'ss' + Math.random(),
      runeId, from: to, amount, l1Txid, proof,
    } as KrayEvent)
    return { W, events, exit, settle }
  }

  // ── S1 · BORN STRICT: an attestation-only settle is refused ────────────────
  {
    const w = world()
    w.exit(600n)
    rejects(
      () => w.settle(payout1Txid, '600', { rawTx: payout1Raw, txoutproof: payout1.txoutproof, headers: payout1.headers, inputRunes: [{ id: runeId, amount: '1000' }] }),
      /rune settle must embed its ancestry bundle/,
      'S1 STRICT: an attestation-only settle is refused — ord\'s word is not consensus input on the payout leg either',
    )
  }

  // ── S2 · THE HONEST SETTLE: bundle = the payout alone (inputs are journal truth) ──
  const w2 = world()
  w2.exit(600n)
  w2.settle(payout1Txid, '600', { rawTx: payout1Raw, txoutproof: payout1.txoutproof, headers: payout1.headers, ancestry: [payout1] })
  ok(!w2.W.runes.lockedOf(RUNE, to) && w2.W.runes.balanceOf(RUNE, to) === 400n,
    'S2 HONEST: the payout burns the lock — delivery re-derived from bytes, bundle is the payout tx alone')
  ok(w2.W.runes.reserveOf(RUNE) === 400n, 'S2 the reserve falls by exactly the burned lock')
  ok(w2.W.hasProvenRuneOutpoint(runeId, `${payout1Txid}:1`),
    'S2 ACCUMULATED TRUTH: the consolidation change is now a journal-proven outpoint')

  // ── S3 · FORGED: the payout delivers less than the lock ────────────────────
  {
    const shortRaw = rawTx([{ txid: txidOf(depRaw), vout: 0 }], [
      DEST, VAULT,
      stone([TAG.Pointer, 1n, TAG.Body, RUNE.block, RUNE.tx, 500n, 0n]),
    ])
    const short = { rawTx: shortRaw, ...bury(shortRaw, 12) }
    const w = world()
    w.exit(600n)
    rejects(
      () => w.settle(txidOf(shortRaw), '600', { rawTx: shortRaw, txoutproof: short.txoutproof, headers: short.headers, ancestry: [short] }),
      /ancestry proves 500 .* not the 600 locked/,
      'S3 FORGED: a payout delivering 500 against a 600 lock → refused (present-but-false HALTs)',
    )
  }

  // ── S4 · A PAYOUT THAT BURNS THE RUNE IS REFUSED ───────────────────────────
  {
    const burnRaw = rawTx([{ txid: txidOf(depRaw), vout: 0 }], [
      DEST, VAULT,
      stone([TAG.Pointer, 1n, TAG.Body, RUNE.block, RUNE.tx, 600n, 0n, 0n, 0n, 100n, 2n]),
    ])
    const burn = { rawTx: burnRaw, ...bury(burnRaw, 13) }
    const w = world()
    w.exit(600n)
    rejects(
      () => w.settle(txidOf(burnRaw), '600', { rawTx: burnRaw, txoutproof: burn.txoutproof, headers: burn.headers, ancestry: [burn] }),
      /BURNS 100 of the rune/,
      'S4 BURNER: exact delivery but 100 edicted into the OP_RETURN → refused (a settlement never burns)',
    )
  }

  // ── S5 · ACCUMULATED TRUTH CHAINS: settle #2 spends settle #1's consolidation ──
  const payout2Raw = rawTx([{ txid: payout1Txid, vout: 1 }], [
    DEST,
    stone([TAG.Body, RUNE.block, RUNE.tx, 400n, 0n]),
  ])
  const payout2 = { rawTx: payout2Raw, ...bury(payout2Raw, 14) }
  w2.exit(400n)
  w2.settle(txidOf(payout2Raw), '400', { rawTx: payout2Raw, txoutproof: payout2.txoutproof, headers: payout2.headers, ancestry: [payout2] })
  ok(w2.W.runes.balanceOf(RUNE, to) === 0n && w2.W.runes.reserveOf(RUNE) === 0n,
    'S5 ACCUMULATED TRUTH: settle #2\'s walk stops at the consolidation outpoint settle #1 proved — bundle is the payout alone')

  // ── S6 · JOURNAL-LOCAL: a world that never saw settle #1 refuses the short bundle ──
  {
    const w = world()
    w.exit(400n)
    rejects(
      () => w.settle(txidOf(payout2Raw), '400', { rawTx: payout2Raw, txoutproof: payout2.txoutproof, headers: payout2.headers, ancestry: [payout2] }),
      /ancestry proves 0 .* not the 400 locked/,
      'S6 JOURNAL-LOCAL: a ledger that never proved settle #1 walks 0 and refuses the claimed 400',
    )
  }

  // ── S7 · REPLAY: the whole deposit → exit → settle chain re-derives cold ───
  {
    const coldW = strictLedger()
    for (const e of w2.events) coldW.applyLive(e)
    ok(coldW.runes.balanceOf(RUNE, to) === 0n && coldW.runes.reserveOf(RUNE) === 0n
      && coldW.runes.wasSettled(payout1Txid) && coldW.runes.wasSettled(txidOf(payout2Raw)),
      'S7 REPLAY: a cold reboot re-proves donate → deposit → exit → settle ×2 from the journal alone')
  }

  if (fail) { console.log(`\n  ${fail} failed · ${pass} passed\n`); process.exit(1) }
  console.log(`\n  ${pass} passed\n`)
}

main()
