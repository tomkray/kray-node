/**
 * THE LIQUID-CLASS GAUNTLET — the signer-side withdrawal validation engine as a seeded swarm.
 *   node src/test/liquid-class-gauntlet.test.ts
 *   LCG_SEEDS=3000 node src/test/liquid-class-gauntlet.test.ts        (default 600, floor 100; arena C runs min(seeds, 200) locks)
 *
 * ORAÇÃO:
 *   given (keys honest) ∧ (the writer is hostile) ∧ (every output not inside a holder's signature is the
 *          pot's own or the funder's own) ∧ (every number has a ceiling) ∧ (the plan pays the SIGNED rune)
 *          ∧ (the exit is OPEN in the book as signed) ∧ (one lock is delivered once) ∧ (the wire's network
 *          is the signer's own) ∧ (UNKNOWN = REFUSE)
 *   + a seeded swarm that builds a random honest payout and mutates ONE dimension per round
 *   → the honest shape signs at BOTH signers; every hostile mutation is refused by BOTH; the pen and the
 *     guardian always agree; the verdict never depends on the order of the pot inputs.
 *
 * PORT NOTE (2026-09-18). Ported from audit/liquid-class-federation onto main's current signer API:
 * authorizePotSign / authorizeGuardianSign with SignerOptions { policy, memory, lockOf, network }, the
 * payout-policy engine (P1–P8), and the plan crossing planToWire → planFromWire exactly as the daemons see it.
 * The fixture shapes are signer-law-v2.test.ts's; this file is that law at swarm scale. Two of the six audit
 * arenas run here:
 *   A · the policy engine swarm — seventeen dimensions, both signers, order-free verdicts
 *   C · the signer memory — one lock, one delivery: an RBF re-sign over the SAME set signs, a different set holds
 * Kept OUT of this port (they would not import on main today, or are out of the signer's scope):
 *   B · the L1 gate — needs protocol/payout-l1-gate.ts (auditPayoutL1, L1Facts): absent on main
 *   D · decoder ord-parity — a runestone flag-word model, not a signer law; its imports do exist on main
 *       (TAG, FLAG, decipher) and it can be ported on its own when the decoder is the subject
 *   E · per-vout memo on mined bytes — needs the audit branch's rune-ancestry additions (per-vout `outputs`
 *       on proveDeposit and the per-vout `known` memo law): not on main
 *   F · the canonical delivery key — needs ledger.ts DELIVERY_OUTPOINT_RE: absent on main
 * Only failures print per round; the summary table counts everything; exit 1 on any failure.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { deriveVault } from '../protocol/vault.ts'
import { buildExitPayout, type FundingUtxo, type ExitPayoutPlan } from '../protocol/exit-payout.ts'
import {
  authorizePotSign, authorizeGuardianSign, planFromWire, planToWire, signedExitKey, spendSetOf,
  type SignedExitMemory, type SignerOptions, type PotSignRequest, type SignedRuneExit,
} from '../protocol/pot-signer.ts'
import { auditPayoutPolicy, DEFAULT_PAYOUT_POLICY, type PayoutPolicy } from '../protocol/payout-policy.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, runeExitMessage, addressOf, scriptOfAddress, type BtcNet } from '../protocol/scheme.ts'

// ── the swarm's dials ────────────────────────────────────────────────────────────────────────────
const wanted = Number(process.env.LCG_SEEDS || 600)
const SEEDS = Number.isFinite(wanted) ? Math.max(100, Math.floor(wanted)) : 600

let pass = 0, fail = 0
/** silent on success — the summary counts; loud on failure — one line names the round and the lie */
const check = (c: boolean, m: string): boolean => { if (c) pass++; else { fail++; console.log('  ✗ FAIL — ' + m) } return c }
function mulberry32(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const keypair = (tag: string) => { const sk = createHash('sha256').update(tag).digest(); return { sk, pk: _generateKeyPair(sk).publicKeyHex } }
const txidOf = (tag: string): string => createHash('sha256').update(tag).digest('hex')
const p2trOf = (tag: string): string => hex(btc.p2tr(Buffer.from(keypair(tag).pk, 'hex'), undefined, NETWORKS.regtest).script!)
const sum = (xs: bigint[]): bigint => xs.reduce((t, a) => t + a, 0n)
const reasonOf = (v: { ok: boolean; reason?: string }): string => (v.ok ? 'ok' : String(v.reason))

// ── the fixture: one vault, three guardians, the pen — the same shapes as signer-law-v2.test.ts ──
const NET = 'regtest'
const G = [keypair('g1'), keypair('g2'), keypair('g3')]
const OWNER = keypair('pot-owner')
const params = { guardians: G.map((g) => g.pk), threshold: 2, depositor: OWNER.pk, timelock: 144, net: 'regtest' as const }
const potScript = scriptOfAddress(deriveVault(params).address, 'regtest')
const RUNE = '1:1', RUNE_ID = { block: 1n, tx: 1n }
const VALUABLE_ID = { block: 2n, tx: 2n }
const SERVICE = p2trOf('service')
const POLICY: PayoutPolicy = { serviceFeeScripts: [SERVICE], requireExiterFunding: true }

type Exiter = { sk: Buffer; pk: string; addr: string; script: string }
type Pot = { txid: string; vout: number; amountSats: bigint }
/** the SAME key on any network: the address changes its HRP, the script bytes do not */
const exiterOn = (tag: string, net: BtcNet): Exiter => { const k = keypair(tag); const addr = addressOf(k.pk, net); return { ...k, addr, script: scriptOfAddress(addr, net) } }
const signExit = (x: Exiter, amount: bigint, nonce: number, network = NET): SignedRuneExit => ({
  from: x.addr, runeId: RUNE, amount: amount.toString(), l1Address: x.addr, nonce, publicKey: x.pk, scheme: 'kraywallet',
  signature: _signKrayWallet(runeExitMessage(network, x.addr, RUNE, amount, x.addr, nonce), x.sk),
})
const mem = (): SignedExitMemory & { map: Map<string, string> } => { const map = new Map<string, string>(); return { map, get: (k) => map.get(k) ?? null, set: (k, v) => { map.set(k, v) } } }
/** the sighashes the writer would claim for this exact payout — what the signers must rebuild byte-for-byte */
const claimedOf = (utxos: Pot[], funding: FundingUtxo, plan: ExitPayoutPlan): string[] => { const b = buildExitPayout(params, utxos, funding, plan); return b.sighashes.slice(0, b.vaultInputCount) }
/** which law a refusal named — informational, for the summary table (no assertion reads this wording) */
function lawOf(reason: string): string {
  const p = reason.match(/\((P\d)\)/); if (p) return p[1]
  if (/rune-id swap/.test(reason)) return 'P0'
  if (/signs only for/.test(reason)) return 'network'
  if (/twice in the loaf/.test(reason)) return 'loaf-twice'
  if (/different pot-outpoint set/.test(reason)) return 'memory'
  if (/NO open exit|is not the signed exit/.test(reason)) return 'lock'
  if (/not the SIGNED exit address|loaf dest \d+ is not/.test(reason)) return 'signed-dest'
  if (/not the signed lock/.test(reason)) return 'signed-amount'
  if (/signer ceiling/.test(reason)) return 'svc-ceiling'
  if (/^exit-payout:/.test(reason)) return 'builder'
  if (/book/.test(reason)) return 'book'
  return 'other'
}

console.log(`\nTHE LIQUID-CLASS GAUNTLET (main port) — ${SEEDS} seeds · arena A (the policy engine) · arena C (the signer memory)\n`)

// ═══ ARENA A · THE POLICY ENGINE — honest shapes sign, one hostile mutation refuses, both signers agree ═══
const MUTATIONS = [
  'none', 'changePad', 'satsChange', 'serviceSats', 'serviceScript', 'fee', 'inputs', 'potSats',
  'destSwap', 'amountUp', 'riderSwap', 'riderAmount', 'runeSwap', 'duplicateRider', 'wrongNetwork', 'burnedLock', 'doubleDelivery',
] as const
type Mutation = typeof MUTATIONS[number]
/** the seven dimensions payout-policy.ts alone must refuse (P1 · P2 · P5 · P5 · P4 · P6 · P8) — the engine is asked directly as well */
const POLICY_DIMENSIONS = new Set<Mutation>(['changePad', 'satsChange', 'serviceSats', 'serviceScript', 'fee', 'inputs', 'potSats'])
type Tally = { rounds: number; hostile: number; held: number; signed: number; agree: number; orderFree: number; laws: Record<string, number> }
const tally = Object.fromEntries(MUTATIONS.map((m) => [m, { rounds: 0, hostile: 0, held: 0, signed: 0, agree: 0, orderFree: 0, laws: {} }])) as Record<Mutation, Tally>
const tA = Date.now()

for (let seed = 1; seed <= SEEDS; seed++) {
  const rand = mulberry32(seed)
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]
  const mut: Mutation = MUTATIONS[seed % MUTATIONS.length]
  const hostile = mut !== 'none'
  // a random honest payout: 1–8 pot inputs, 1–3 loaf dests each with a signed exit, funding from the initiator
  const nIn = 1 + Math.floor(rand() * 8)
  const potUtxos: Pot[] = Array.from({ length: nIn }, (_, i) => ({ txid: txidOf(`pot|${seed}|${i}`), vout: Math.floor(rand() * 3), amountSats: 546n + BigInt(Math.floor(rand() * 9_000)) }))
  const ridesLoaf = mut === 'riderSwap' || mut === 'riderAmount' // a rider mutation needs a rider: the loaf is forced
  const nDest = ridesLoaf ? 2 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 3)
  const exiters = Array.from({ length: nDest }, (_, i) => exiterOn(`x|${seed}|${i}`, 'regtest'))
  const amounts = exiters.map(() => 1n + BigInt(Math.floor(rand() * 5_000)))
  let exits = exiters.map((x, i) => signExit(x, amounts[i], i))
  const paid = sum(amounts)
  const totalVaultRunes = paid + BigInt(Math.floor(rand() * 100_000))
  // ≥ 30 000 sats always covers the honest outputs (3 × 330 + 330 + 546) plus the honest fee (≤ 20 500)
  const funding: FundingUtxo = { txid: txidOf(`fund|${seed}`), vout: 0, amountSats: 30_000n + BigInt(Math.floor(rand() * 200_000)), scriptHex: exiters[0].script, internalKey: exiters[0].pk }
  let plan: ExitPayoutPlan = {
    runeId: RUNE_ID, exitAmount: amounts[0], totalVaultRunes, destScriptHex: exiters[0].script, destPostage: 330n, changePostage: 330n,
    changeScriptHex: potScript, satsChangeScriptHex: exiters[0].script, feeSats: 500n + BigInt(Math.floor(rand() * 20_000)), dust: 330n,
    ...(rand() < 0.5 ? { serviceFee: { scriptHex: SERVICE, sats: 546n } } : {}),
    ...(nDest > 1 ? { dests: exiters.map((x, i) => ({ destScriptHex: x.script, exitAmount: amounts[i] })) } : {}),
  }
  let utxos = potUtxos
  let network = NET
  const memory = mem()
  let burned: string | null = null
  const book = (from: string, rid: string): bigint | null => { const i = exiters.findIndex((x) => x.addr === from); return rid === RUNE && i >= 0 ? amounts[i] : null }
  const lockOf = (from: string, rid: string) => { if (rid !== RUNE || from === burned) return null; const i = exiters.findIndex((x) => x.addr === from); return i >= 0 ? { amount: amounts[i], l1Address: exiters[i].addr } : null }
  const thief = p2trOf(`thief|${seed}`)

  // ONE hostile dimension per round
  switch (mut) {
    case 'none': break
    case 'changePad': plan = { ...plan, changeScriptHex: thief }; break
    case 'satsChange': plan = { ...plan, satsChangeScriptHex: pick([thief, potScript, '0014' + '00'.repeat(20)]) }; break
    case 'serviceSats': plan = { ...plan, serviceFee: { scriptHex: SERVICE, sats: DEFAULT_PAYOUT_POLICY.maxServiceFeeSats + 1n + BigInt(Math.floor(rand() * 50_000)) } }; funding.amountSats += 100_000n; break
    case 'serviceScript': plan = { ...plan, serviceFee: { scriptHex: thief, sats: 546n } }; break
    case 'fee': plan = { ...plan, feeSats: DEFAULT_PAYOUT_POLICY.maxFeeSats + 1n + BigInt(Math.floor(rand() * 100_000)) }; funding.amountSats += 400_000n; break
    case 'inputs': utxos = Array.from({ length: DEFAULT_PAYOUT_POLICY.maxVaultInputs + 1 + Math.floor(rand() * 30) }, (_, i) => ({ txid: txidOf(`pot|${seed}|big|${i}`), vout: 0, amountSats: 546n })); break
    // P8 counts the pot sats that leave beyond the change postage: one fat pot input over that ceiling
    case 'potSats': utxos = [{ txid: txidOf(`pot|${seed}|fat`), vout: 0, amountSats: DEFAULT_PAYOUT_POLICY.maxPotSatsOut + plan.changePostage + 1n + BigInt(Math.floor(rand() * 1_000_000)) }]; break
    case 'destSwap': plan = { ...plan, destScriptHex: thief, ...(plan.dests ? { dests: [{ destScriptHex: thief, exitAmount: amounts[0] }, ...plan.dests.slice(1)] } : {}) }; break
    case 'amountUp': {
      const up = amounts[0] + 1n + BigInt(Math.floor(rand() * 1_000))
      plan = { ...plan, exitAmount: up, totalVaultRunes: totalVaultRunes + up, ...(plan.dests ? { dests: [{ destScriptHex: exiters[0].script, exitAmount: up }, ...plan.dests.slice(1)] } : {}) }
      break
    }
    case 'riderSwap':
    case 'riderAmount': {
      const loaf = plan.dests ?? []
      if (loaf.length < 2) { check(false, `A#${seed} ${mut}: the fixture must ride a loaf of at least two dests`); continue }
      plan = mut === 'riderSwap'
        ? { ...plan, dests: [loaf[0], { destScriptHex: thief, exitAmount: amounts[1] }, ...loaf.slice(2)] }
        : { ...plan, totalVaultRunes: totalVaultRunes + 1n, dests: [loaf[0], { destScriptHex: exiters[1].script, exitAmount: amounts[1] + 1n }, ...loaf.slice(2)] }
      break
    }
    // the P0 pin: the holder signed for 1:1, the plan moves 2:2
    case 'runeSwap': plan = { ...plan, runeId: VALUABLE_ID }; break
    // the same signed exit twice in one loaf (one lock delivered twice in one tx)
    case 'duplicateRider': {
      const d0 = { destScriptHex: exiters[0].script, exitAmount: amounts[0] }
      plan = { ...plan, totalVaultRunes: totalVaultRunes + amounts[0], dests: [...(plan.dests ?? [d0]), d0] }
      exits = [...exits, exits[0]]
      break
    }
    // a bundle that is VALID for signet (signet addresses, signet-labelled signatures, same keys → same script
    // bytes) replayed at a regtest signer: only the signer's own network pin can refuse it
    case 'wrongNetwork': {
      network = 'signet'
      exits = exiters.map((_, i) => signExit(exiterOn(`x|${seed}|${i}`, 'signet'), amounts[i], i, 'signet'))
      break
    }
    // the book shows no open exit for the initiator (burned, cancelled or never journaled) — the balance still covers
    case 'burnedLock': burned = exiters[0].addr; break
    // the memory already delivered this exit over a different pot-outpoint set
    case 'doubleDelivery': memory.map.set(signedExitKey(NET, exits[0]), spendSetOf([{ txid: txidOf(`pot|${seed}|elsewhere`), vout: 0 }])); break
  }

  const wirePlan = planFromWire(planToWire(plan)) // the plan the daemons see: the wire's
  let claimed: string[] = []
  let builderSaid: string | null = null
  try { claimed = claimedOf(utxos, funding, wirePlan) } catch (e) { builderSaid = e instanceof Error ? e.message : String(e) }
  const t = tally[mut]
  t.rounds++
  if (!hostile && builderSaid) { check(false, `A#${seed} none: the honest shape must build — ${builderSaid}`); continue }
  // a hostile shape the builder itself refuses still reaches both signers (they rebuild and refuse the same way)

  const req: PotSignRequest = { network, exit: exits[0], ...(exits.length > 1 ? { exits } : {}), params, vaultUtxos: utxos, funding, plan: wirePlan, claimedSighashes: claimed }
  const opts: SignerOptions = { policy: POLICY, memory, lockOf, network: NET }
  const pen = authorizePotSign(req, OWNER.sk, book, opts)
  const g = authorizeGuardianSign(req, G[seed % 3].sk, book, opts)

  // the policy engine, asked directly: the seven policy dimensions must fall on the engine alone; the honest shape passes it
  if (mut === 'none' || POLICY_DIMENSIONS.has(mut)) {
    const pv = auditPayoutPolicy({ network: NET, params, vaultUtxos: utxos, funding, plan: wirePlan, initiatorFrom: exits[0].from, policy: POLICY })
    check(pv.ok === !hostile, `A#${seed} ${mut}: the policy engine alone must ${hostile ? 'refuse' : 'pass'} — ${reasonOf(pv)}`)
  }
  if (hostile) {
    t.hostile++
    if (check(!pen.ok && !g.ok, `A#${seed} ${mut}: pen=${reasonOf(pen)} · guardian=${reasonOf(g)} — a hostile mutation must be refused by BOTH`)) t.held++
  } else if (check(pen.ok && g.ok, `A#${seed} honest ${nIn}-input ${nDest}-dest payout must sign: pen=${reasonOf(pen)} · guardian=${reasonOf(g)}`)) {
    t.signed++
  }
  if (check(pen.ok === g.ok, `A#${seed} ${mut}: the pen (${pen.ok}) and the guardian (${g.ok}) must AGREE — ${reasonOf(pen)} · ${reasonOf(g)}`)) t.agree++
  if (!pen.ok) { const law = lawOf(pen.reason); t.laws[law] = (t.laws[law] ?? 0) + 1 }

  // the verdict is order-free: the same pot set in reverse is the same payout (spendSetOf sorts; the rebuild matches)
  const reversed = [...utxos].reverse()
  let claimed2: string[] = []
  try { claimed2 = claimedOf(reversed, funding, wirePlan) } catch { claimed2 = [] }
  const pen2 = authorizePotSign({ ...req, vaultUtxos: reversed, claimedSighashes: claimed2 }, OWNER.sk, book, opts)
  if (check(pen.ok === pen2.ok, `A#${seed} ${mut}: input order must not change the verdict (${pen.ok} vs ${pen2.ok}: ${reasonOf(pen2)})`)) t.orderFree++
}

{
  const w = (s: string | number, n: number): string => String(s).padStart(n)
  const all = MUTATIONS.map((m) => tally[m])
  const total = (k: 'rounds' | 'hostile' | 'held' | 'signed' | 'agree' | 'orderFree'): number => all.reduce((t, x) => t + x[k], 0)
  console.log(`  ARENA A · the policy engine swarm — ${SEEDS} seeds in ${((Date.now() - tA) / 1000).toFixed(1)} s`)
  console.log(`  ${'mutation'.padEnd(15)} ${w('rounds', 6)} ${w('hostile', 7)} ${w('refused', 7)} ${w('signed', 6)} ${w('agree', 5)} ${w('order', 5)}  law named by the pen`)
  for (const m of MUTATIONS) {
    const t = tally[m]
    const laws = Object.entries(t.laws).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' ') || '—'
    console.log(`  ${m.padEnd(15)} ${w(t.rounds, 6)} ${w(t.hostile, 7)} ${w(t.held, 7)} ${w(t.signed, 6)} ${w(t.agree, 5)} ${w(t.orderFree, 5)}  ${laws}`)
  }
  console.log(`  ${'Σ'.padEnd(15)} ${w(total('rounds'), 6)} ${w(total('hostile'), 7)} ${w(total('held'), 7)} ${w(total('signed'), 6)} ${w(total('agree'), 5)} ${w(total('orderFree'), 5)}`)
  check(MUTATIONS.every((m) => tally[m].held === tally[m].hostile), 'ARENA A: every hostile mutation was refused by BOTH signers in every round')
  check(tally.none.rounds > 0 && tally.none.signed === tally.none.rounds, 'ARENA A: every honest shape signed at BOTH signers')
  check(MUTATIONS.every((m) => tally[m].agree === tally[m].rounds), 'ARENA A: the pen and the guardian agreed on every round')
  check(MUTATIONS.every((m) => tally[m].orderFree === tally[m].rounds), 'ARENA A: no verdict depended on the order of the pot inputs')
}

// ═══ ARENA C · SIGNER MEMORY — one lock, one delivery: the same set signs again (RBF), a different set holds ═══
{
  // 200 locks × 5–9 rounds × three rebuilds each proves the memory law in ~12 s; LCG_SEEDS scales arena A beyond it
  const C_SEEDS = Math.min(SEEDS, 200)
  const tC = Date.now()
  let rounds = 0, allowed = 0, held = 0, wrong = 0, boundOnce = 0
  for (let seed = 1; seed <= C_SEEDS; seed++) {
    const rand = mulberry32(seed * 13)
    const x = exiterOn(`mem|${seed}`, 'regtest')
    const amt = 1n + BigInt(Math.floor(rand() * 1_000))
    const exit = signExit(x, amt, 0)
    const key = signedExitKey(NET, exit)
    const funding: FundingUtxo = { txid: txidOf(`mf|${seed}`), vout: 0, amountSats: 50_000n, scriptHex: x.script, internalKey: x.pk }
    const plan = planFromWire(planToWire({
      runeId: RUNE_ID, exitAmount: amt, totalVaultRunes: amt + 100n, destScriptHex: x.script, destPostage: 330n, changePostage: 330n,
      changeScriptHex: potScript, satsChangeScriptHex: x.script, feeSats: 1_000n, dust: 330n,
    }))
    // three disjoint pot-outpoint sets of 1–3 outpoints each
    const sets: Pot[][] = [0, 1, 2].map((j) => Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, i) => ({ txid: txidOf(`mp|${seed}|${j}|${i}`), vout: i, amountSats: 600n })))
    const book = (from: string, rid: string): bigint | null => (from === x.addr && rid === RUNE ? amt : null)
    const lockOf = (from: string, rid: string) => (from === x.addr && rid === RUNE ? { amount: amt, l1Address: x.addr } : null)
    // each daemon keeps its OWN memory — the pen's and the guardian's must still agree on every verdict
    const penMemory = mem(), guardianMemory = mem()
    // the schedule: deliver over set 0, RBF re-sign over set 0, try set 1 (must hold), then random tries
    const schedule = [0, 0, 1, ...Array.from({ length: 2 + Math.floor(rand() * 4) }, () => Math.floor(rand() * 3))]
    for (const j of schedule) {
      const chosen = sets[j]
      const bound = penMemory.map.get(key) ?? null
      const expectSign = bound === null || bound === spendSetOf(chosen)
      const shuffled = rand() < 0.5 ? [...chosen].reverse() : chosen // the same set in any order is the same key
      const req: PotSignRequest = { network: NET, exit, params, vaultUtxos: shuffled, funding, plan, claimedSighashes: claimedOf(shuffled, funding, plan) }
      const pen = authorizePotSign(req, OWNER.sk, book, { policy: POLICY, memory: penMemory, lockOf, network: NET })
      const g = authorizeGuardianSign(req, G[seed % 3].sk, book, { policy: POLICY, memory: guardianMemory, lockOf, network: NET })
      rounds++
      const agree = check(pen.ok === g.ok, `C#${seed} set ${j}: the pen (${pen.ok}) and the guardian (${g.ok}) must AGREE — ${reasonOf(pen)} · ${reasonOf(g)}`)
      if (expectSign) {
        const signed = check(pen.ok && g.ok, `C#${seed} set ${j}: the same exit over the ${bound === null ? 'first' : 'SAME'} pot-outpoint set must sign — pen=${reasonOf(pen)} · guardian=${reasonOf(g)}`)
        if (signed && agree) allowed++; else wrong++
      } else {
        const byMemory = !pen.ok && !g.ok && /different pot-outpoint set/.test(pen.reason) && /different pot-outpoint set/.test(g.reason)
        const heldNow = check(byMemory, `C#${seed} set ${j}: the same exit over a DIFFERENT pot-outpoint set must be held by the memory — pen=${reasonOf(pen)} · guardian=${reasonOf(g)}`)
        if (heldNow && agree) held++; else wrong++
      }
    }
    // the memory never re-binds a lock: one key, bound once, to the first delivery's set — at both daemons
    const first = spendSetOf(sets[0])
    const once = penMemory.map.size === 1 && penMemory.map.get(key) === first && guardianMemory.map.size === 1 && guardianMemory.map.get(key) === first
    if (check(once, `C#${seed}: the memory must hold exactly one binding, to the first delivery's set, at both daemons`)) boundOnce++
  }
  console.log(`\n  ARENA C · the signer memory — ${C_SEEDS} locks · ${rounds} rounds in ${((Date.now() - tC) / 1000).toFixed(1)} s`)
  console.log(`  ${'same-set re-signs allowed'.padEnd(30)} ${String(allowed).padStart(6)}`)
  console.log(`  ${'disjoint-set deliveries held'.padEnd(30)} ${String(held).padStart(6)}`)
  console.log(`  ${'locks bound exactly once'.padEnd(30)} ${String(boundOnce).padStart(6)} / ${C_SEEDS}`)
  console.log(`  ${'wrong verdicts'.padEnd(30)} ${String(wrong).padStart(6)}`)
  check(wrong === 0 && held >= C_SEEDS && allowed >= 2 * C_SEEDS && boundOnce === C_SEEDS, 'ARENA C: one lock, one delivery — every same-set re-sign signed, every disjoint set held, at both daemons')
}

console.log(`\n╚═ ${pass} passed, ${fail} FAILED — the gauntlet on main: honest shapes sign at both signers, every hostile dimension holds, one lock pays once, verdicts are order-free. ₿₭\n`)
if (fail) process.exit(1)
