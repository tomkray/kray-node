/**
 * THE POT BINDING + CONTRACT-V1 RETIREMENT — two consensus pins born ABOVE the live heads.
 *   node src/test/pot-binding-pin.test.ts
 *
 * THE HOLE (verified by executed probe, 2026-09-18): the reducer re-proved a rune deposit from bytes
 * but took the VAULT from the event — `deriveVault({ ...proof.vault })` was whatever the writer
 * journaled. Only the writer's door checked that a `pool:true` deposit had landed in the network's
 * real consolidation pot, so a compromised writer could pay runes into a vault it alone controlled
 * and every honest replayer would credit pot-backed transferable runes (the Liquid class).
 *
 * THE PIN (`POT_BINDING_SEQ` — signet 227 / main 82; regtest inactive): at/after it, a pot deposit's
 * journaled vault must derive to THIS network's sealed pot script, and a personal-vault deposit must
 * carry THIS network's guardians, threshold and timelock (federation-consensus.ts). Below it, the
 * vault is the event's word exactly as before (A3 — the live heads are 226 / 81, nothing changes).
 *
 * Pins:
 *   PB-01  fixture: the sealed signet federation + the journaled consolidation key derive the sealed pot
 *   PB-02  (a) signet, pin 0: a pool deposit whose vault is a foreign federation → REFUSED, exact sentence
 *   PB-03  (a) the attacker's variant: the REAL guardians with the writer's OWN depositor key → refused
 *   PB-04  (a) the real params with a different timelock derive elsewhere → refused
 *   PB-05  (b) the real pot params PASS the binding — the refusal moves to the SPV gate (a stub bundle);
 *          the pure verdict says ok; both sealed pot scripts match their golden hex
 *   PB-06  (c) signet, pin 0: a personal-vault deposit with foreign guardians → REFUSED, exact sentence
 *   PB-07  (c) real guardians but the wrong threshold / timelock / a duplicated guardian → refused
 *   PB-08  (c) the real federation (any order, compressed or x-only) + the holder's own key PASSES the binding
 *   PB-09  (d) the seq is the boundary: pin 5 — the same foreign pool deposit passes at 4, refuses at 5
 *   PB-10  (d) A3 on regtest: a FULL, valid personal-vault deposit applies identically with the pin far
 *          above (cascade roots byte-equal) — and the same shape AT the pin refuses fail-closed (no
 *          sealed federation on regtest), mutating nothing
 *   PB-11  (d) THE TABLE ITSELF: a DEFAULT signet ledger binds at 227 not 226; a DEFAULT main ledger at 82 not 81
 *   CV-01  (e) regtest, ctor pin 3: a v1 law (no star) seals at 1, is REFUSED at 3 with the exact sentence,
 *          nothing changes; a v2 law (star) still walks the v2 path
 *   CV-02  (e) THE TABLE ITSELF: default signet seals v1 at 226 and refuses at 227; default main at 81 / 82
 *   CV-03  (e) the lab env retires v1 on a regtest bench; the same env is DEAD on main
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { openKrayLedger } from '../protocol/store.ts'
import { FEDERATION_CONSENSUS, POT_BINDING_SEQ, federationBindingVerdict, sealedFederationOf, type JournaledVault } from '../protocol/federation-consensus.ts'
import { deriveVault } from '../protocol/vault.ts'
import { checkProofOfWork, sha256d } from '../anchor/spv.ts'
import { settlementRunestoneHex } from '../protocol/vault-settlement.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, scriptOfAddress, contractMessage, type BtcNet } from '../protocol/scheme.ts'
import { canonicalCode, type ContractCode } from '../protocol/contract.ts'
import { sha256hex, type KrayEvent } from '../protocol/kray-primitives.ts'
import { parseRuneKey } from '../economics/rune-book.ts'

const MAX = Number.MAX_SAFE_INTEGER
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
/** the thrown sentence, or null when nothing threw */
const thrown = (fn: () => void): string | null => { try { fn(); return null } catch (e) { return (e as Error).message } }
const refusesExactly = (fn: () => void, msg: string, label: string) => {
  const got = thrown(fn)
  ok(got === msg, label + (got === msg ? '' : got === null ? ' — DID NOT throw' : ' — wrong sentence: ' + got))
}
const refusesLike = (fn: () => void, re: RegExp, not: RegExp | null, label: string) => {
  const got = thrown(fn)
  const good = got !== null && re.test(got) && (!not || !not.test(got))
  ok(good, label + (good ? '' : got === null ? ' — DID NOT throw' : ' — wrong sentence: ' + got))
}

// ── the exact sentences the reducer speaks ──────────────────────────────────
const POT_MSG = "ledger: a pot deposit must land in this network's consolidation pot — the journaled vault is not the pot (refused)"
const PERSONAL_MSG = "ledger: a personal vault must use this network's federation (guardians, threshold, timelock) — refused"
const NOFED_MSG = 'ledger: this network has no sealed federation — a bound rune deposit cannot be verified (refused)'
const V1_MSG = 'ledger: at/after contract-v1 retirement a law must hang on a star — the v1 pot is retired'
const SPV_GATE = /the rune deposit's own SPV proof does not verify on replay/
const BINDING = /consolidation pot|this network's federation|no sealed federation/

/** ctor positions: 25 = potBindingSeq, 26 = contractV1RetiredSeq (everything else = the per-network table) */
const pinned = (net: string, o: { pot?: number; v1?: number } = {}): KrayLedger => {
  const args: unknown[] = [undefined, net, undefined, false, ...Array(20).fill(undefined), o.pot, o.v1]
  return new (KrayLedger as unknown as new (...a: unknown[]) => KrayLedger)(...args)
}
const mk = (tag: string, bnet: BtcNet) => {
  const sk = createHash('sha256').update(`pot-binding|${tag}`).digest()
  const { publicKeyHex: pk } = _generateKeyPair(sk)
  return { sk, pk, addr: btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[bnet]).address! }
}
const RUNE = '840000:1'
const outpointOf = (tag: string) => createHash('sha256').update('op|' + tag).digest('hex') + ':0'
/** a structurally complete proof whose SPV bundle is a stub — enough to reach the binding, never to pass the SPV gate */
const stubProof = (vault: JournaledVault | undefined, pool: boolean) => ({
  rawTx: '00', txoutproof: '00', headers: [] as string[],
  ...(vault ? { vault } : {}),
  inputRunes: [{ id: RUNE, amount: '500' }],
  ancestry: [{ rawTx: '00', txoutproof: '00', headers: [] as string[] }],
  ...(pool ? { parentTxs: ['00'], pool: true } : {}),
})
const deposit = (seq: number, to: string, proof: unknown, pool: boolean, tag: string): KrayEvent =>
  ({ seq, kind: 'rune-deposit', hash: tag, runeId: RUNE, outpoint: outpointOf(tag), to, amount: '500', ...(pool ? { pool: true } : {}), proof } as unknown as KrayEvent)

// ── THE SEALED SIGNET FEDERATION and the consolidation key every live signet pool deposit journals
//    (proof.vault.depositor of seqs 38, 39, 40, 51, 54, 76 — public, re-derivable, never a secret) ──
const SIG = FEDERATION_CONSENSUS.signet
const SIGNET_POT_DEPOSITOR = '2fc69b2b67590fa63a2c836759cacac96210c42f36ebee25bb7c3653efae1118'
const REAL_POT_PARAMS: JournaledVault = { guardians: [...SIG.guardians], threshold: SIG.threshold, depositor: SIGNET_POT_DEPOSITOR, timelock: SIG.timelock }
const SIGNET_POT_SCRIPT = '512008b0d7951e58a6e229b3305ed3e05daae942c02b858a1d1885349b8676440976'
const MAIN_POT_SCRIPT = '5120184a91ecb9d38494acd4f5a869ef8630ec7c0a45c81533c51e2c3269bde6dd7a'

// ── regtest fixture builders (mirrored from rune-consensus-proof.test.ts) — a FULL, valid deposit ──
const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b.toString('hex') }
const pushScript = (hex: string) => (hex.length / 2).toString(16).padStart(2, '0') + hex
function tx(outs: Array<{ sats: bigint; script: string }>): string {
  const outHex = outs.map((o) => u64le(o.sats) + pushScript(o.script)).join('')
  return ['01000000', '01', '00'.repeat(32), 'ffffffff', '00', 'ffffffff', outs.length.toString(16).padStart(2, '0'), outHex, '00000000'].join('')
}
function mineHeader(prevInternal: Buffer, merkleRootInternal: Buffer): Buffer {
  const h = Buffer.alloc(80)
  h.writeUInt32LE(0x20000000, 0); prevInternal.copy(h, 4); merkleRootInternal.copy(h, 36)
  h.writeUInt32LE(1_700_000_000, 68); h.writeUInt32LE(0x207fffff, 72)
  for (let nonce = 0; nonce < 2_000_000; nonce++) { h.writeUInt32LE(nonce, 76); if (checkProofOfWork(h.toString('hex'), 'regtest').ok) return h }
  throw new Error('could not mine a regtest header')
}
function txoutProof(header: Buffer, txidInternal: Buffer): string {
  return Buffer.concat([header, Buffer.from([1, 0, 0, 0]), Buffer.from([1]), txidInternal, Buffer.from([1]), Buffer.from([0x01])]).toString('hex')
}
function bury(rawTx: string, depth = 3) {
  const txidInternal = sha256d(Buffer.from(rawTx, 'hex'))
  const headers: Buffer[] = [mineHeader(Buffer.alloc(32), txidInternal)]
  for (let i = 1; i < depth; i++) headers.push(mineHeader(sha256d(headers[i - 1]), Buffer.alloc(32, i + 5)))
  return { rawTx, txoutproof: txoutProof(headers[0], txidInternal), headers: headers.map((h) => h.toString('hex')) }
}
const txidOf = (rawTx: string) => Buffer.from(sha256d(Buffer.from(rawTx, 'hex'))).reverse().toString('hex')

// ── a v1 law (no star) and a v2 law (on a star), signed by the same key ──
const splitter: ContractCode = {
  vars: { paid: '0' },
  rules: [{ name: 'release', when: { op: 'ge', args: [{ ctx: 'balance' }, { arg: 'amount' }] }, then: [{ set: { var: 'paid', to: { op: 'add', args: [{ var: 'paid' }, { arg: 'amount' }] } } }] }],
}
const codeHash = sha256hex(canonicalCode(splitter))
const v1Law = (net: string, seq: number, who: { sk: Buffer; pk: string; addr: string }, tag: string): KrayEvent => ({
  seq, kind: 'contract', hash: tag, from: who.addr, code: splitter, at: 1_700_000_000_000 + seq,
  publicKey: who.pk, signature: _signKrayWallet(contractMessage(net, who.addr, codeHash), who.sk), scheme: 'kraywallet',
} as unknown as KrayEvent)

function main() {
  console.log('\n╔═ THE POT BINDING + CONTRACT-V1 RETIREMENT — the federation is a consensus constant; a law hangs on a star ═╗\n')

  // ── PB-01 · fixture: the sealed federation derives the sealed pot ──
  const derivedPot = deriveVault({ ...REAL_POT_PARAMS, net: 'signet' })
  ok(derivedPot.address === SIG.pot, `PB-01 the sealed signet guardians (2-of-3, Δ 144) + the journaled consolidation key derive the sealed pot ${SIG.pot.slice(0, 14)}…`)
  ok(scriptOfAddress(SIG.pot, 'signet') === SIGNET_POT_SCRIPT && scriptOfAddress(FEDERATION_CONSENSUS.main.pot, 'main') === MAIN_POT_SCRIPT,
    'PB-01 both sealed pot scripts match their golden hex (signet 512008b0…, main 5120184a…)')
  ok(sealedFederationOf('regtest') === null && sealedFederationOf('nowhere') === null, 'PB-01 regtest (and an unknown net) has NO sealed federation — the lab\'s varies')

  const alice = mk('alice', 'signet'), mallory = mk('mallory', 'signet')
  const fg = ['fg1', 'fg2', 'fg3'].map((t) => mk(t, 'signet').pk)   // a foreign federation the writer alone controls
  const FOREIGN_POT: JournaledVault = { guardians: fg, threshold: 2, depositor: mallory.pk, timelock: 144 }

  // ── PB-02 · (a) a pool deposit whose journaled vault is a foreign federation ──
  const L0 = pinned('signet', { pot: 0 })
  refusesExactly(() => L0.applyLive(deposit(1, alice.addr, stubProof(FOREIGN_POT, true), true, 'pb02')), POT_MSG,
    'PB-02 (a) signet, pin 0: a pool deposit into a vault of foreign guardians is REFUSED with the exact sentence')
  ok(L0.runes.balanceOf(parseRuneKey(RUNE), alice.addr) === 0n && L0.conserves() && L0.haltedReason() === null, 'PB-02 nothing was credited, the book conserves, not halted')

  // ── PB-03 · (a) the attacker's true shape: the REAL guardians, the writer's OWN depositor key ──
  const OWN_DEPOSITOR_POT: JournaledVault = { ...REAL_POT_PARAMS, depositor: mallory.pk }
  refusesExactly(() => L0.applyLive(deposit(1, alice.addr, stubProof(OWN_DEPOSITOR_POT, true), true, 'pb03')), POT_MSG,
    'PB-03 (a) the sealed guardians with the writer\'s OWN depositor key derive a vault the writer alone reclaims — not the pot, refused')

  // ── PB-04 · (a) the real params with a different timelock derive elsewhere ──
  refusesExactly(() => L0.applyLive(deposit(1, alice.addr, stubProof({ ...REAL_POT_PARAMS, timelock: 4320 }, true), true, 'pb04')), POT_MSG,
    'PB-04 (a) the real keys with Δ 4320 instead of 144 derive a different script — refused')
  refusesExactly(() => L0.applyLive(deposit(1, alice.addr, stubProof(undefined, true), true, 'pb04b')),
    'ledger: a rune-deposit consensus proof must carry the vault params the credit binds to',
    'PB-04 (a) a pool proof with NO vault params cannot be bound — refused (fail-closed)')

  // ── PB-05 · (b) the real pot params PASS the binding: the refusal moves to the SPV gate ──
  refusesLike(() => L0.applyLive(deposit(1, alice.addr, stubProof(REAL_POT_PARAMS, true), true, 'pb05')), SPV_GATE, BINDING,
    'PB-05 (b) the REAL pot params pass the binding — the stub bundle is then refused by the SPV gate, never by the binding')
  const vb = federationBindingVerdict(REAL_POT_PARAMS, { network: 'signet', pool: true })
  ok(vb.ok === true, 'PB-05 (b) the pure verdict: the sealed pot params ARE the pot (ok)')
  const vpool = federationBindingVerdict(REAL_POT_PARAMS, { network: 'signet', pool: false })
  ok(vpool.ok === true, 'PB-05 (b) the same params judged as a personal vault: sealed guardians, threshold, timelock — ok (the depositor is bound by the verifier, not here)')
  // `proof.pool` alone (event without `pool`) still means the pot — the OR the verifier uses
  refusesExactly(() => L0.applyLive({ ...deposit(1, alice.addr, stubProof(FOREIGN_POT, true), false, 'pb05c') } as KrayEvent), POT_MSG,
    'PB-05 (b) `proof.pool: true` with no event `pool` is still judged as a pot deposit (the verifier\'s own OR)')

  // ── PB-06 · (c) a personal-vault deposit with foreign guardians ──
  const FOREIGN_PERSONAL: JournaledVault = { guardians: fg, threshold: 2, depositor: alice.pk, timelock: 144 }
  refusesExactly(() => L0.applyLive(deposit(1, alice.addr, stubProof(FOREIGN_PERSONAL, false), false, 'pb06')), PERSONAL_MSG,
    'PB-06 (c) signet, pin 0: a personal vault under foreign guardians is REFUSED with the exact sentence')

  // ── PB-07 · (c) real guardians, wrong threshold / timelock / a duplicated guardian ──
  refusesExactly(() => L0.applyLive(deposit(1, alice.addr, stubProof({ guardians: [...SIG.guardians], threshold: 1, depositor: alice.pk, timelock: 144 }, false), false, 'pb07a')), PERSONAL_MSG,
    'PB-07 (c) the sealed guardians with threshold 1 (one guardian could co-sign) — refused')
  refusesExactly(() => L0.applyLive(deposit(1, alice.addr, stubProof({ guardians: [...SIG.guardians], threshold: 2, depositor: alice.pk, timelock: 4320 }, false), false, 'pb07b')), PERSONAL_MSG,
    'PB-07 (c) the sealed guardians with Δ 4320 — refused')
  refusesExactly(() => L0.applyLive(deposit(1, alice.addr, stubProof({ guardians: [SIG.guardians[0], SIG.guardians[0], SIG.guardians[1]], threshold: 2, depositor: alice.pk, timelock: 144 }, false), false, 'pb07c')), PERSONAL_MSG,
    'PB-07 (c) a duplicated guardian standing in for the third — a set, not a list — refused')
  refusesExactly(() => L0.applyLive(deposit(1, alice.addr, stubProof({ guardians: [SIG.guardians[0], SIG.guardians[1]], threshold: 2, depositor: alice.pk, timelock: 144 }, false), false, 'pb07d')), PERSONAL_MSG,
    'PB-07 (c) two of the three sealed guardians — refused')
  refusesExactly(() => L0.applyLive(deposit(1, alice.addr, stubProof({ guardians: ['zz'], threshold: 1, depositor: alice.pk, timelock: 144 }, false), false, 'pb07e')), PERSONAL_MSG,
    'PB-07 (c) malformed guardian keys cannot be the federation — refused, never thrown past')

  // ── PB-08 · (c) the real federation in ANY order / key form + the holder's own key passes the binding ──
  const shuffled = [SIG.guardians[2], '02' + SIG.guardians[0], SIG.guardians[1].toUpperCase()]
  refusesLike(() => L0.applyLive(deposit(1, alice.addr, stubProof({ guardians: shuffled, threshold: 2, depositor: alice.pk, timelock: 144 }, false), false, 'pb08')), SPV_GATE, BINDING,
    'PB-08 (c) the sealed set (re-ordered, one compressed, one upper-case) + the holder\'s own key passes the binding — refused only by the stub SPV gate')
  ok(federationBindingVerdict({ guardians: shuffled, threshold: 2, depositor: alice.pk, timelock: 144 }, { network: 'signet', pool: false }).ok === true,
    'PB-08 (c) the pure verdict agrees: same members as x-only keys, order-insensitive')

  // ── PB-09 · (d) the seq is the boundary ──
  const L5 = pinned('signet', { pot: 5 })
  refusesLike(() => L5.applyLive(deposit(4, alice.addr, stubProof(FOREIGN_POT, true), true, 'pb09a')), SPV_GATE, BINDING,
    'PB-09 (d) pin 5: at seq 4 the foreign vault is the event\'s word — the binding is not consulted (old law, A3)')
  refusesExactly(() => L5.applyLive(deposit(5, alice.addr, stubProof(FOREIGN_POT, true), true, 'pb09b')), POT_MSG,
    'PB-09 (d) pin 5: at seq 5 the same shape is refused — the activation is the boundary')

  // ── PB-10 · (d) A3 on regtest: a FULL valid deposit applies identically with the pin far above ──
  const ra = mk('regtest-alice', 'regtest'), rg1 = mk('regtest-g1', 'regtest'), rg2 = mk('regtest-g2', 'regtest')
  const RV: JournaledVault = { guardians: [rg1.pk, rg2.pk], threshold: 2, depositor: ra.pk, timelock: 16 }
  const rvault = deriveVault({ ...RV, net: 'regtest' })
  const rid = parseRuneKey(RUNE)
  const depTx = tx([
    { sats: 10_000n, script: scriptOfAddress(rvault.address, 'regtest') },
    { sats: 0n, script: settlementRunestoneHex(rid, 500n, 0, 2) },
    { sats: 5_000n, script: scriptOfAddress(mk('regtest-change', 'regtest').addr, 'regtest') },
  ])
  const fullProof = { ...bury(depTx), vault: RV, inputRunes: [{ id: RUNE, amount: '500' }] }
  const fullDeposit = (seq: number, tag: string): KrayEvent =>
    ({ seq, kind: 'rune-deposit', hash: tag, runeId: RUNE, outpoint: `${txidOf(depTx)}:0`, to: ra.addr, amount: '500', proof: fullProof } as unknown as KrayEvent)
  const Roff = new KrayLedger(undefined, 'regtest')          // the table: regtest MAX
  const Ron = pinned('regtest', { pot: 100 })                // the pin, far above this history
  Roff.applyLive(fullDeposit(1, 'pb10'))
  Ron.applyLive(fullDeposit(1, 'pb10'))
  ok(Roff.runes.balanceOf(rid, ra.addr) === 500n && Ron.runes.balanceOf(rid, ra.addr) === 500n,
    'PB-10 (d) a FULL, valid personal-vault deposit (regtest bundle, real PoW) credits 500 on both ledgers')
  ok(Roff.cascadeRoot() === Ron.cascadeRoot() && Ron.runesSolvent(),
    `PB-10 (d) A3: below its seq the pin changes NOTHING — cascade roots byte-equal ${Ron.cascadeRoot().slice(0, 16)}…`)
  const fresh2 = { ...fullDeposit(100, 'pb10b'), outpoint: outpointOf('pb10b') } as KrayEvent   // a new outpoint (credited-once must not shadow the pin)
  refusesExactly(() => Ron.applyLive(fresh2), NOFED_MSG,
    'PB-10 (d) AT the pin on regtest the same shape refuses FAIL-CLOSED — no sealed federation there, never silently open')
  ok(Ron.runes.balanceOf(rid, ra.addr) === 500n && Ron.conserves() && Ron.haltedReason() === null, 'PB-10 (d) the refusal mutated nothing and did not halt the book')

  // ── PB-11 · (d) THE TABLE ITSELF — no injection: the per-network constant is the law ──
  ok(POT_BINDING_SEQ.regtest === MAX && POT_BINDING_SEQ.signet === 227 && POT_BINDING_SEQ.main === 82,
    'PB-11 POT_BINDING_SEQ = { regtest: MAX, signet: 227, main: 82 } — one above each live head at the rite (226 / 81)')
  const Ls = new KrayLedger(undefined, 'signet')
  refusesLike(() => Ls.applyLive(deposit(226, alice.addr, stubProof(FOREIGN_POT, true), true, 'pb11a')), SPV_GATE, BINDING,
    'PB-11 a DEFAULT signet ledger at seq 226 (the live head) does not bind — every journaled deposit replays as written')
  refusesExactly(() => Ls.applyLive(deposit(227, alice.addr, stubProof(FOREIGN_POT, true), true, 'pb11b')), POT_MSG,
    'PB-11 a DEFAULT signet ledger at seq 227 binds — the next deposit must land in the sealed pot')
  const ma = mk('main-alice', 'main'), mm = mk('main-mallory', 'main')
  const MAIN_FOREIGN: JournaledVault = { guardians: fg, threshold: 2, depositor: mm.pk, timelock: 4320 }
  const Lm = new KrayLedger(undefined, 'main')
  refusesLike(() => Lm.applyLive(deposit(81, ma.addr, stubProof(MAIN_FOREIGN, true), true, 'pb11c')), SPV_GATE, BINDING,
    'PB-11 a DEFAULT main ledger at seq 81 (the live head) does not bind')
  refusesExactly(() => Lm.applyLive(deposit(82, ma.addr, stubProof(MAIN_FOREIGN, true), true, 'pb11d')), POT_MSG,
    'PB-11 a DEFAULT main ledger at seq 82 binds — a pot deposit must land in bc1prp9frm9…')
  refusesExactly(() => Lm.applyLive(deposit(82, ma.addr, stubProof({ guardians: [...FEDERATION_CONSENSUS.main.guardians], threshold: 2, depositor: ma.pk, timelock: 144 }, false), false, 'pb11e')), PERSONAL_MSG,
    'PB-11 a DEFAULT main ledger at seq 82: the sealed main guardians with signet\'s Δ 144 — refused (Δ 4320 is the law)')

  // ── CV-01 · (e) regtest, ctor pin 3: v1 seals below, refuses at/after; v2 walks its own path ──
  const ca = mk('law-alice', 'regtest')
  const C = pinned('regtest', { v1: 3 })
  C.applyLive(v1Law('regtest', 1, ca, 'cv01a'))
  ok(C.allContractAddresses().length === 1 && !C.contractAt(C.allContractAddresses()[0])?.star, 'CV-01 (e) below the pin a v1 law (no star) still seals a pot — A3')
  refusesExactly(() => C.applyLive(v1Law('regtest', 3, ca, 'cv01b')), V1_MSG, 'CV-01 (e) AT the pin the same v1 law is REFUSED with the exact sentence')
  ok(C.allContractAddresses().length === 1 && C.conserves() && C.haltedReason() === null, 'CV-01 (e) nothing changed — one pot, conserved, not halted')
  refusesLike(() => C.applyLive({ ...v1Law('regtest', 4, ca, 'cv01c'), star: '1' } as KrayEvent), /does not exist|owner|signature/, /contract-v1 retirement/,
    'CV-01 (e) a v2 law (star set) at/after the pin walks the v2 path — refused for ITS reasons, never by the retirement')

  // ── CV-02 · (e) THE TABLE ITSELF ──
  const sa = mk('signet-law', 'signet'), mla = mk('main-law', 'main')
  const Cs = new KrayLedger(undefined, 'signet')
  Cs.applyLive(v1Law('signet', 226, sa, 'cv02a'))
  ok(Cs.allContractAddresses().length === 1, 'CV-02 (e) a DEFAULT signet ledger seals a v1 law at seq 226 (the live head) — history replays as written')
  refusesExactly(() => Cs.applyLive(v1Law('signet', 227, sa, 'cv02b')), V1_MSG, 'CV-02 (e) a DEFAULT signet ledger refuses a v1 law at seq 227 — CONTRACT_V1_RETIRED_SEQ.signet is 227, pinned')
  const Cm = new KrayLedger(undefined, 'main')
  Cm.applyLive(v1Law('main', 81, mla, 'cv02c'))
  ok(Cm.allContractAddresses().length === 1, 'CV-02 (e) a DEFAULT main ledger seals a v1 law at seq 81 (the live head)')
  refusesExactly(() => Cm.applyLive(v1Law('main', 82, mla, 'cv02d')), V1_MSG, 'CV-02 (e) a DEFAULT main ledger refuses a v1 law at seq 82 — CONTRACT_V1_RETIRED_SEQ.main is 82, pinned')

  // ── CV-03 · (e) the lab env retires v1 on a regtest bench; the same env is DEAD on main ──
  const envBefore = process.env.KRAY_LAB_CONTRACT_V1_RETIRED_SEQ
  process.env.KRAY_LAB_CONTRACT_V1_RETIRED_SEQ = '1'
  try {
    refusesExactly(() => openKrayLedger('regtest').applyLive(v1Law('regtest', 1, ca, 'cv03a')), V1_MSG,
      'CV-03 (e) KRAY_LAB_CONTRACT_V1_RETIRED_SEQ=1 retires the v1 pot on a regtest bench (store.ts, the one door)')
    process.env.KRAY_LAB_CONTRACT_V1_RETIRED_SEQ = String(MAX)
    const Cme = openKrayLedger('main')
    Cme.applyLive(v1Law('main', 81, mla, 'cv03b'))
    refusesExactly(() => Cme.applyLive(v1Law('main', 82, mla, 'cv03c')), V1_MSG,
      'CV-03 (e) the SAME env (MAX) is DEAD on main — the table still retires v1 at 82')
  } finally {
    if (envBefore === undefined) delete process.env.KRAY_LAB_CONTRACT_V1_RETIRED_SEQ; else process.env.KRAY_LAB_CONTRACT_V1_RETIRED_SEQ = envBefore
  }

  console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed, ${fail} failed — the federation is a consensus constant; a law hangs on a star. ⛓₭\n`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
