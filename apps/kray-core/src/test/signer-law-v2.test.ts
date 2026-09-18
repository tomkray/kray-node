/**
 * THE SIGNER LAW v2 — the 2026-09-18 gauntlet's hostile plans, every one REFUSED by the pen AND by a guardian.
 *   node src/test/signer-law-v2.test.ts
 *
 * Before this law, every plan below was SIGNED (the probes are in the audit record): the rune change to a thief
 * script (the whole pot per withdraw), the rune-id swap, sats change / funding / fee unpinned, the same signed
 * exit paid over two pot-outpoint sets, a burned lock paid again, the same exit twice in a loaf, a foreign
 * network on the wire. Now: the honest plan signs; each hostile mutation names the invariant it broke; the
 * pen and the guardian agree on every verdict; a pre-v2 caller (no options) is byte-identical.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { deriveVault } from '../protocol/vault.ts'
import { buildExitPayout, type FundingUtxo, type ExitPayoutPlan } from '../protocol/exit-payout.ts'
import {
  authorizePotSign, authorizeGuardianSign, planFromWire, planToWire, signedExitKey, spendSetOf,
  type SignedExitMemory, type SignerOptions, type PotSignRequest, type SignedRuneExit,
} from '../protocol/pot-signer.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, runeExitMessage, addressOf, scriptOfAddress } from '../protocol/scheme.ts'

let pass = 0
function ok(c: boolean, m: string): void { if (c) { pass++; console.log('  ✓', m) } else { console.error('  ✗', m); process.exit(1) } }
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const keypair = (tag: string) => { const sk = createHash('sha256').update(tag).digest(); return { sk, pk: _generateKeyPair(sk).publicKeyHex } }
const txidOf = (tag: string) => createHash('sha256').update(tag).digest('hex')
const p2trOf = (tag: string) => hex(btc.p2tr(Buffer.from(keypair(tag).pk, 'hex'), undefined, NETWORKS.regtest).script!)

const NET = 'regtest'
const G = [keypair('g1'), keypair('g2'), keypair('g3')]
const OWNER = keypair('pot-owner')
const params = { guardians: G.map((g) => g.pk), threshold: 2, depositor: OWNER.pk, timelock: 144, net: 'regtest' as const }
const potScript = scriptOfAddress(deriveVault(params).address, 'regtest')
const RUNE = '1:1', RUNE_ID = { block: 1n, tx: 1n }
const VALUABLE = '2:2', VALUABLE_ID = { block: 2n, tx: 2n }
const SERVICE = p2trOf('service')
const THIEF = p2trOf('thief')

const exiter = (tag: string) => { const k = keypair(tag); const addr = addressOf(k.pk, 'regtest'); return { ...k, addr, script: scriptOfAddress(addr, 'regtest') } }
const A = exiter('alice')
const signExit = (x: ReturnType<typeof exiter>, runeId: string, amount: bigint, nonce: number, l1 = x.addr): SignedRuneExit => ({
  from: x.addr, runeId, amount: amount.toString(), l1Address: l1, nonce, publicKey: x.pk, scheme: 'kraywallet',
  signature: _signKrayWallet(runeExitMessage(NET, x.addr, runeId, amount, l1, nonce), x.sk),
})
const pot = (tag: string, vout = 0) => ({ txid: txidOf('pot|' + tag), vout, amountSats: 546n })
const funding: FundingUtxo = { txid: txidOf('fund'), vout: 0, amountSats: 50_000n, scriptHex: A.script, internalKey: A.pk }
const honestPlan = (over: Partial<ExitPayoutPlan> = {}): ExitPayoutPlan => ({
  runeId: RUNE_ID, exitAmount: 100n, totalVaultRunes: 700n,
  destScriptHex: A.script, destPostage: 330n, changePostage: 330n, changeScriptHex: potScript,
  satsChangeScriptHex: A.script, feeSats: 2_000n, dust: 330n,
  serviceFee: { scriptHex: SERVICE, sats: 546n },
  ...over,
})
const exit = signExit(A, RUNE, 100n, 0)
const req = (plan: ExitPayoutPlan, vaultUtxos = [pot('a')], exits?: SignedRuneExit[], network = NET): PotSignRequest => {
  const built = buildExitPayout(params, vaultUtxos, funding, plan)
  return { network, exit, ...(exits ? { exits } : {}), params, vaultUtxos, funding, plan: planFromWire(planToWire(plan)), claimedSighashes: built.sighashes.slice(0, built.vaultInputCount) }
}
// the honest book: alice holds 100 of RUNE, and her exit is OPEN exactly as signed
const book = (m: Record<string, bigint>) => (from: string, rid: string): bigint | null => (rid === RUNE && Object.prototype.hasOwnProperty.call(m, from) ? m[from] : (rid === VALUABLE ? 0n : null))
const openLock = (locks: Record<string, { amount: bigint; l1Address: string } | null>) => (from: string, rid: string) => (rid === RUNE ? (locks[from] ?? null) : null)
const mem = (): SignedExitMemory & { map: Map<string, string> } => { const map = new Map<string, string>(); return { map, get: (k) => map.get(k) ?? null, set: (k, v) => { map.set(k, v) } } }
const opts = (over: Partial<SignerOptions> = {}): SignerOptions => ({
  policy: { serviceFeeScripts: [SERVICE], requireExiterFunding: true },
  lockOf: openLock({ [A.addr]: { amount: 100n, l1Address: A.addr } }),
  network: NET,
  ...over,
})
const both = (r: PotSignRequest, o: SignerOptions | undefined, bal = book({ [A.addr]: 100n })) => {
  const pen = authorizePotSign(r, OWNER.sk, bal, o)
  const g = authorizeGuardianSign(r, G[0].sk, bal, o)
  return { pen, g, agree: pen.ok === g.ok, reason: (pen.ok ? '' : pen.reason) + ' | ' + (g.ok ? '' : g.reason) }
}

// ── the honest shape signs, with every option on ─────────────────────────────────────────────────
const honest = both(req(honestPlan()), opts())
ok(honest.pen.ok && honest.g.ok, 'HONEST: change → the pot, sats change → the funder (= the exiter), service fee pinned, exit open as signed → pen AND guardian sign')
const legacy = both(req(honestPlan()), undefined)
ok(legacy.pen.ok && legacy.g.ok, 'a pre-v2 caller (no options) is byte-identical: still signs')

// ── P1 · the rune change to a thief script → refused (the whole pot per withdraw) ────────────────
const p1 = both(req(honestPlan({ changeScriptHex: THIEF }), [pot('a'), pot('b'), pot('c')]), opts())
ok(!p1.pen.ok && !p1.g.ok && /P1|return home/.test(p1.reason), `P1: rune change to a writer P2TR → REFUSED by both (${p1.reason.slice(0, 70)}…)`)
const p1pool = both(req(honestPlan({ changeScriptHex: THIEF })), opts({ policy: { serviceFeeScripts: [SERVICE], allowedChangeScripts: [THIEF] } }))
ok(p1pool.pen.ok && p1pool.g.ok, 'P1: a change pad the operator CONFIGURED (the consolidation pool) is allowed')

// ── P0 · the rune-id swap → refused ──────────────────────────────────────────────────────────────
const p0 = both(req(honestPlan({ runeId: VALUABLE_ID })), opts())
ok(!p0.pen.ok && !p0.g.ok && /rune-id swap/.test(p0.reason), 'P0: exit signed for rune 1:1, plan pays rune 2:2 → REFUSED by both (the swap)')
ok(!authorizePotSign(req(honestPlan({ runeId: VALUABLE_ID })), OWNER.sk, book({ [A.addr]: 100n }), { network: NET }).ok, 'P0 needs no policy and no book: the rune pin is unconditional under v2 options')

// ── P2/P3 · sats change and funding must be the exiter's own ────────────────────────────────────
const p2 = both(req(honestPlan({ satsChangeScriptHex: THIEF })), opts())
ok(!p2.pen.ok && !p2.g.ok && /P2/.test(p2.reason), 'P2: sats change to a writer script → REFUSED')
const foreignFunding = { ...funding, scriptHex: THIEF, internalKey: keypair('thief').pk }
const p3req: PotSignRequest = (() => { const plan = honestPlan({ satsChangeScriptHex: THIEF }); const built = buildExitPayout(params, [pot('a')], foreignFunding, plan); return { network: NET, exit, params, vaultUtxos: [pot('a')], funding: foreignFunding, plan: planFromWire(planToWire(plan)), claimedSighashes: built.sighashes.slice(0, built.vaultInputCount) } })()
const p3 = both(p3req, opts())
ok(!p3.pen.ok && !p3.g.ok && /P3/.test(p3.reason), 'P3: a funding utxo that is not the exiter\'s own → REFUSED (strict mode)')

// ── P4/P5/P6/P8 · ceilings ───────────────────────────────────────────────────────────────────────
const richFunding: FundingUtxo = { ...funding, txid: txidOf('fund-rich'), amountSats: 900_000n }
const p4req: PotSignRequest = (() => { const plan = honestPlan({ feeSats: 300_000n }); const built = buildExitPayout(params, [pot('a')], richFunding, plan); return { network: NET, exit, params, vaultUtxos: [pot('a')], funding: richFunding, plan: planFromWire(planToWire(plan)), claimedSighashes: built.sighashes.slice(0, built.vaultInputCount) } })()
const p4 = both(p4req, opts())
ok(!p4.pen.ok && !p4.g.ok && /P4/.test(p4.reason), 'P4: a 300 000-sat miner fee → REFUSED')
const p5 = both(req(honestPlan({ serviceFee: { scriptHex: THIEF, sats: 546n } })), opts())
ok(!p5.pen.ok && !p5.g.ok && /P5/.test(p5.reason), 'P5: a service output to an unknown script → REFUSED')
const nine = Array.from({ length: 9 }, (_, i) => pot('many' + i))
const p6 = both(req(honestPlan({ totalVaultRunes: 9_000n }), nine), opts())
ok(!p6.pen.ok && !p6.g.ok && /P6/.test(p6.reason), 'P6: nine pot inputs in one payout → REFUSED (a drain needs the whole pot in one tx)')
const fat = [{ ...pot('fat'), amountSats: 500_000n }]
const p8 = both(req(honestPlan(), fat), opts())
ok(!p8.pen.ok && !p8.g.ok && /P8/.test(p8.reason), 'P8: 500 000 sats leaving the pot in a payout → REFUSED')

// ── THE LOCK · the exit must be OPEN in the book exactly as signed ───────────────────────────────
const burned = both(req(honestPlan()), opts({ lockOf: openLock({ [A.addr]: null }) }))
ok(!burned.pen.ok && !burned.g.ok && /NO open exit/.test(burned.reason), 'LOCK: a burned or cancelled lock (no open exit in the book) → REFUSED, even though the balance still covers it')
const tampered = both(req(honestPlan()), opts({ lockOf: openLock({ [A.addr]: { amount: 100n, l1Address: exiter('other').addr } }) }))
ok(!tampered.pen.ok && !tampered.g.ok && /is not the signed exit/.test(tampered.reason), 'LOCK: an open exit to a different destination than the signed one → REFUSED')
const legacyBook = both(req(honestPlan()), opts({ lockOf: () => undefined }))
ok(legacyBook.pen.ok && legacyBook.g.ok, 'LOCK: a pre-v2 follower that exposes no locks → the check is skipped (the balance predicate still runs)')

// ── ONE LOCK, ONE DELIVERY · the memory ──────────────────────────────────────────────────────────
const M = mem()
const first = both(req(honestPlan(), [pot('a')]), opts({ memory: M }))
ok(first.pen.ok && first.g.ok && M.map.get(signedExitKey(NET, exit)) === spendSetOf([pot('a')]), 'MEMORY: the first delivery signs and is remembered over its pot-outpoint set')
const again = both(req(honestPlan(), [pot('a')]), opts({ memory: M }))
ok(again.pen.ok && again.g.ok, 'MEMORY: an RBF re-sign over the SAME outpoint set is allowed')
const twice = both(req(honestPlan(), [pot('b')]), opts({ memory: M }))
ok(!twice.pen.ok && !twice.g.ok && /already signed over a different pot-outpoint set/.test(twice.reason), 'MEMORY: the same signed exit over a DIFFERENT outpoint set → REFUSED (one lock pays exactly once)')

// ── NO EXIT TWICE · a loaf carrying the same exit twice ──────────────────────────────────────────
const dupPlan = honestPlan({ dests: [{ destScriptHex: A.script, exitAmount: 100n }, { destScriptHex: A.script, exitAmount: 100n }] })
const dup = both(req(dupPlan, [pot('a')], [exit, exit]), opts())
ok(!dup.pen.ok && !dup.g.ok && /appears twice in the loaf/.test(dup.reason), 'LOAF: the same signed exit twice → REFUSED')

// ── NETWORK · the wire names another network ─────────────────────────────────────────────────────
const wrongNet = both(req(honestPlan(), [pot('a')], undefined, 'signet'), opts())
ok(!wrongNet.pen.ok && !wrongNet.g.ok && /signs only for regtest|does not verify/.test(wrongNet.reason), 'NETWORK: a bundle naming signet at a regtest signer → REFUSED (the exit signature is network-labelled, the pin backs it)')
const netPin = both({ ...req(honestPlan()), network: 'signet' }, opts({ network: 'regtest' }))
ok(!netPin.pen.ok && !netPin.g.ok, 'NETWORK: the pin itself refuses a bundle whose network is not the signer\'s')
const wrongParams = both({ ...req(honestPlan()), params: { ...params, net: 'signet' as never } }, opts())
ok(!wrongParams.pen.ok && !wrongParams.g.ok, 'NETWORK: vault params naming another network → REFUSED')

// ── the balance predicate still runs and an unknown balance is a LIVENESS answer ─────────────────
const unknown = authorizeGuardianSign(req(honestPlan()), G[0].sk, () => null, opts())
ok(!unknown.ok && unknown.lagging === true, 'BOOK: an unknown balance is flagged lagging (the daemon answers 503, the writer retries) — never a silent sign')
const over = both(req(honestPlan()), opts(), book({ [A.addr]: 99n }))
ok(!over.pen.ok && !over.g.ok && /over-balance/.test(over.reason), 'BOOK: balance 99 < exit 100 → REFUSED by both')

console.log(`\n╚═ ${pass} passed — the signer law v2: the pot's own, the funder's own, the signed rune, the open lock, one delivery, one network. ⚖₭`)
