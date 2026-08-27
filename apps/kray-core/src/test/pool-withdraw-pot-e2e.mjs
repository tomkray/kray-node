/**
 * POOL WITHDRAWAL ON THE POT DOOR — a recipient who NEVER deposited withdraws from the shared pot.
 *
 * The shared-pool loop the Creator asked about, on the CURRENT pot model: Alice deposits to the bakery
 * pot (credited to her, the unique Taproot spender); she sends her credits to Bob on the L2; Bob — who
 * never touched Bitcoin — signs an exit to HIS OWN L1 address; the node builds a payout FROM THE POT to
 * exactly Bob's signed address, Bob co-funds it, the pot co-signs, and the sweep settles. Bob gets his
 * runes on L1 from a pot he never paid into — backed the whole way, solvent the whole way.
 *
 *   HARNESS=<dir> RUNE=130:1 RUNE_NAME='IRON•SATOSHI•ROCK' node src/test/pool-withdraw-pot-e2e.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _signKrayWallet, scriptOfAddress, runeSendMessage, runeExitMessage } from '../protocol/scheme.ts'
import { potCredit } from './dev-federation.mjs'

const HARNESS = process.env.HARNESS
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const RUNE = process.env.RUNE || '130:1'
const RUNE_NAME = process.env.RUNE_NAME || 'IRON•SATOSHI•ROCK'
const DEPOSIT = BigInt(process.env.DEPOSIT || '6000')
const HOP = BigInt(process.env.HOP || '2500')            // what Alice sends Bob on the L2
const NET = 'regtest', BNET = toBtcNet(NET)
const bc = (...a) => execFileSync(`${HARNESS}/bc`, a, { encoding: 'utf8' }).trim()
const ordGet = (p) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081${p}`], { encoding: 'utf8' }))
const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
const sync = () => { const h = bc('getblockcount'); for (let i = 0; i < 40; i++) { try { if (String(ordGet('/r/blockheight')) === h) return } catch {} execFileSync('sleep', ['0.5']) } }
const jget = (p) => JSON.parse(execFileSync('curl', ['-s', NODE + p], { encoding: 'utf8' }))
const jpost = (p, body) => JSON.parse(execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(body), NODE + p], { encoding: 'utf8' }))
const runeAt = (op) => { const raw = execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081/output/${op}`], { encoding: 'utf8' }); const esc = RUNE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const m = raw.match(new RegExp('"' + esc + '"\\s*:\\s*\\{\\s*"amount"\\s*:\\s*(\\d+)')); return m ? BigInt(m[1]) : 0n }
const held = (addr) => { const r = (jget('/api/kraynet/runes/of/' + addr).runes || []).find((x) => x.runeId === RUNE); return r ? BigInt(String(r.amount ?? '0')) : 0n }
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const key = (t) => { const sk = createHash('sha256').update('pool-withdraw|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }
const gasFund = (addr, potAddr, minConf) => { const dataHex = Buffer.from(addr, 'ascii').toString('hex'); const raw = bc('createrawtransaction', '[]', JSON.stringify([{ [potAddr]: 0.00001 }, { data: dataHex }])); const f = JSON.parse(bc('fundrawtransaction', raw, JSON.stringify({ changePosition: 2 }))); const tx = bc('sendrawtransaction', JSON.parse(bc('signrawtransactionwithwallet', f.hex)).hex); mine(Math.max(1, minConf)); sync(); return jpost('/api/kraynet/donate', { txid: tx }) }

console.log('\n╔═ POOL WITHDRAWAL ON THE POT DOOR — a non-depositor withdraws from the shared pot ═╗')

const info = jget('/api/kraynet/donation/info')
ok(info.configured === true, `node pot + bitcoind wired (minConf ${info.minConfirmations})`)

// 1 · Alice deposits to the pot (credited to her, the unique spender)
const NONCE = bc('getblockcount')
const ALICE = key('alice|' + NONCE), BOB = key('bob|' + NONCE)
const A_ADDR = btc.p2tr(_hexToBytes(ALICE.pk), undefined, NETWORKS[BNET]).address
const B_ADDR = btc.p2tr(_hexToBytes(BOB.pk), undefined, NETWORKS[BNET]).address
const ownB = scriptOfAddress(B_ADDR, BNET)
const { dep } = potCredit({ owner: ALICE, amount: DEPOSIT, net: NET, rune: RUNE, runeName: RUNE_NAME })
ok(dep.ok === true && dep.credited === A_ADDR && held(A_ADDR) === DEPOSIT, `Alice deposited ${DEPOSIT} ${RUNE_NAME} to the pot (credited the unique spender)`)

// 2 · gas for Alice (to send) and Bob (to exit)
gasFund(A_ADDR, info.potAddress, info.minConfirmations)
gasFund(B_ADDR, info.potAddress, info.minConfirmations)

// 3 · Alice SENDS to Bob on the L2 — Bob now holds runes he never deposited
const nA = jget('/api/kraynet/profile/' + A_ADDR).nonce
const snd = jpost('/api/kraynet/rune/send', { from: A_ADDR, to: B_ADDR, runeId: RUNE, amount: HOP.toString(), nonce: nA, publicKey: ALICE.pk, signature: _signKrayWallet(runeSendMessage(NET, A_ADDR, B_ADDR, RUNE, HOP, nA), ALICE.sk), scheme: 'kraywallet' })
ok(snd.ok === true && held(B_ADDR) === HOP && held(A_ADDR) === DEPOSIT - HOP, `Alice → Bob ${HOP} on the L2 — Bob holds ${HOP}, Alice ${DEPOSIT - HOP} (Bob never touched Bitcoin)`)
const bobBacking = (jget('/api/kraynet/vault-watch').outpoints || []).some((w) => String(w.depositor || '') === B_ADDR)
ok(!bobBacking, 'Bob has NO backing outpoint of his own — his credits are backed by the SHARED pot, not a deposit he made')

// 4 · Bob signs an exit to HIS OWN L1 address; the node locks his credits
const reserveBefore = BigInt((jget('/api/kraynet/runes').runes.find((r) => r.runeId === RUNE) || {}).reserve || '0')
const nB = jget('/api/kraynet/profile/' + B_ADDR).nonce
const exit = jpost('/api/kraynet/rune/exit', { from: B_ADDR, runeId: RUNE, amount: HOP.toString(), l1Address: B_ADDR, nonce: nB, publicKey: BOB.pk, signature: _signKrayWallet(runeExitMessage(NET, B_ADDR, RUNE, HOP, B_ADDR, nB), BOB.sk) })
ok(exit.ok === true, `Bob (a non-depositor) signed an exit of his ${HOP} to his own L1 — the node LOCKED it`)

// 5 · the node builds the payout FROM THE POT to Bob; Bob co-funds; the pot co-signs; broadcast
const fundTxid = bc('sendtoaddress', B_ADDR, '0.00050000'); mine(1)
const fdec = JSON.parse(bc('getrawtransaction', fundTxid, 'true'))
const fundVout = fdec.vout.findIndex((o) => (o.scriptPubKey?.hex || '').toLowerCase() === ownB)
const built = jpost('/api/kraynet/rune/exit/payout-psbt', { from: B_ADDR, runeId: RUNE, publicKey: BOB.pk, feeRate: 2, funding: { txid: fundTxid, vout: fundVout } })
ok(built.ok === true && built.summary && built.summary.l1Address === B_ADDR && built.summary.amount === HOP.toString(), `the node BUILT Bob's payout FROM THE POT — exactly ${HOP} to exactly Bob's signed address (read from the lock)`)
const wtx = btc.Transaction.fromPSBT(Buffer.from(built.psbt, 'base64'), { allowUnknownInputs: true, allowUnknownOutputs: true })
for (let i = 0; i < wtx.inputsLength; i++) { const inp = wtx.getInput(i); const sh = inp.witnessUtxo && Buffer.from(inp.witnessUtxo.script).toString('hex'); if (sh === ownB) { try { wtx.signIdx(BOB.sk, i) } catch { /* not Bob's input */ } } }
const sub = jpost('/api/kraynet/rune/exit/payout-submit', { from: B_ADDR, runeId: RUNE, psbt: Buffer.from(wtx.toPSBT(0)).toString('base64') })
ok(sub.ok === true && /^[0-9a-f]{64}$/.test(sub.txid || ''), `payout BROADCAST from the pot to Bob — ${String(sub.txid || sub.error).slice(0, 16)}…`)
mine(Math.max(1, info.minConfirmations)); sync()
ok(runeAt(`${sub.txid}:0`) === HOP, `ord confirms Bob received EXACTLY ${HOP} ${RUNE_NAME} on L1 — from a pot he never paid into`)

// 6 · the sweep settles Bob's lock; the pool conserves
let settled = false
for (let i = 0; i < 12 && !settled; i++) { execFileSync('sleep', ['3']); if (held(B_ADDR) === 0n && !(jget('/api/kraynet/runes/of/' + B_ADDR).runes || []).some((r) => r.runeId === RUNE && r.locked && BigInt(String(r.locked.amount ?? r.locked ?? '0')) > 0n)) settled = true }
ok(settled, 'the sweep SETTLED Bob\'s exit automatically — his lock burned with no manual settle')
const entry = (jget('/api/kraynet/runes').runes || []).find((r) => r.runeId === RUNE)
ok(entry && entry.solvent !== false && BigInt(entry.reserve) === reserveBefore - HOP, `CONSERVATION: the pool reserve fell by EXACTLY the withdrawn ${HOP} (${reserveBefore} → ${entry && entry.reserve}) — solvent, backed the whole way`)

console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the shared pot backs everyone: a recipient who never deposited withdrew his runes to L1, exact and solvent. ⚗️₿⇄₭`)
process.exit(fail ? 1 : 0)
