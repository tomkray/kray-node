/**
 * DIVISIBILITY ON THE POT DOOR — base-unit accounting, ord-sourced, never divided (PROVEN-POT column).
 *
 * The trap a naive bridge falls into: a display amount "X" on a divisibility-d rune is X·10^d BASE units.
 * This proves the CURRENT pot door never divides: a wallet sends a display amount to the bakery pot, the
 * node credits EXACTLY the u128 base amount ord recorded (the unique-spender credit), an L2 transfer moves
 * base units with no rounding, and a partial exit pays out and conserves to the base unit.
 *
 *   HARNESS=<dir> RUNE=138:1 RUNE_NAME='SILVER•TENTH•COIN' node src/test/rune-divisibility-pot-e2e.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _signKrayWallet, scriptOfAddress, runeSendMessage, runeExitMessage } from '../protocol/scheme.ts'
import { potCredit } from './dev-federation.mjs'

const HARNESS = process.env.HARNESS
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const RUNE = process.env.RUNE || '138:1'
const RUNE_NAME = process.env.RUNE_NAME || 'SILVER•TENTH•COIN'
const DISPLAY = process.env.DISPLAY || '5000'          // a display amount; base = DISPLAY × 10^div
const NET = 'regtest', BNET = toBtcNet(NET)
const bc = (...a) => execFileSync(`${HARNESS}/bc`, a, { encoding: 'utf8' }).trim()
const jget = (p) => JSON.parse(execFileSync('curl', ['-s', NODE + p], { encoding: 'utf8' }))
const jpost = (p, body) => JSON.parse(execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(body), NODE + p], { encoding: 'utf8' }))
const ordGet = (p) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081${p}`], { encoding: 'utf8' }))
const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
const sync = () => { const h = bc('getblockcount'); for (let i = 0; i < 40; i++) { try { if (String(ordGet('/r/blockheight')) === h) return } catch {} execFileSync('sleep', ['0.5']) } }
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const key = (t) => { const sk = createHash('sha256').update('div-pot|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }
const held = (addr) => { const r = (jget('/api/kraynet/runes/of/' + addr).runes || []).find((x) => x.runeId === RUNE); return r ? BigInt(String(r.amount ?? '0')) : 0n }

console.log(`\n╔═ DIVISIBILITY ON THE POT DOOR — base-unit exact, ord-sourced, never divided (${RUNE_NAME}) ═╗`)

const info = jget('/api/kraynet/donation/info')
ok(info.configured === true, `node pot + bitcoind wired (minConf ${info.minConfirmations})`)
const meta = ordGet('/rune/' + RUNE_NAME.replace(/•/g, '%E2%80%A2')).entry || {}
const div = Number(meta.divisibility ?? 0)
ok(div >= 1, `the test rune has divisibility ${div} — a display "${DISPLAY}" is ${DISPLAY}·10^${div} base units (the trap a naive bridge falls into)`)

// 1 · DEPOSIT the divisible rune through the pot door — the node credits the u128 base amount ord recorded
const NONCE = bc('getblockcount')
const A = key('alice|' + NONCE), BOB = key('bob|' + NONCE)
const A_ADDR = btc.p2tr(_hexToBytes(A.pk), undefined, NETWORKS[BNET]).address
const BOB_ADDR = btc.p2tr(_hexToBytes(BOB.pk), undefined, NETWORKS[BNET]).address
const { depTxid, dep, landed } = potCredit({ owner: A, amount: DISPLAY, net: NET, rune: RUNE, runeName: RUNE_NAME })
const expectBase = BigInt(DISPLAY) * (10n ** BigInt(div))
ok(landed === expectBase, `ord recorded ${landed} BASE units for display "${DISPLAY}" (= ${DISPLAY}·10^${div}) — read, never assumed`)
ok(dep.ok === true && BigInt(dep.amount) === landed && held(A_ADDR) === landed,
  `the node credited EXACTLY ${landed} base units (the same u128 ord reports) — never a divided display number`)

// gas — Alice needs 1 ₭ to move runes on the L2 (send AND exit), from a real SPV-proven donation
const gasHex = Buffer.from(A_ADDR, 'ascii').toString('hex')
const graw = bc('createrawtransaction', '[]', JSON.stringify([{ [info.potAddress]: 0.00001 }, { data: gasHex }]))
const gfun = JSON.parse(bc('fundrawtransaction', graw, JSON.stringify({ changePosition: 2 })))
const gtx = bc('sendrawtransaction', JSON.parse(bc('signrawtransactionwithwallet', gfun.hex)).hex)
mine(Math.max(1, info.minConfirmations)); sync()
jpost('/api/kraynet/donate', { txid: gtx })

// 2 · an L2 transfer moves base units exactly — a third out, the remainder exact, no rounding
const part = landed / 3n
const n0 = jget('/api/kraynet/profile/' + A_ADDR).nonce
const snd = jpost('/api/kraynet/rune/send', { from: A_ADDR, to: BOB_ADDR, runeId: RUNE, amount: part.toString(), nonce: n0, publicKey: A.pk, signature: _signKrayWallet(runeSendMessage(NET, A_ADDR, BOB_ADDR, RUNE, part, n0), A.sk), scheme: 'kraywallet' })
ok(snd.ok === true && held(A_ADDR) === landed - part && held(BOB_ADDR) === part,
  `an L2 transfer moved ${part} base units exactly: Alice ${landed - part}, Bob ${part} (base-unit arithmetic, no rounding)`)

// 3 · a partial EXIT of Alice's remainder pays out through the pot and conserves to the base unit
const keep = landed - part
const reserveBefore = BigInt((jget('/api/kraynet/runes').runes.find((r) => r.runeId === RUNE) || {}).reserve || '0')
const n1 = jget('/api/kraynet/profile/' + A_ADDR).nonce
const exit = jpost('/api/kraynet/rune/exit', { from: A_ADDR, runeId: RUNE, amount: keep.toString(), l1Address: A_ADDR, nonce: n1, publicKey: A.pk, signature: _signKrayWallet(runeExitMessage(NET, A_ADDR, RUNE, keep, A_ADDR, n1), A.sk) })
ok(exit.ok === true, `Alice signed an exit of her ${keep} base units — the node LOCKED exactly that`)
const ownScriptHex = scriptOfAddress(A_ADDR, BNET)
const built = jpost('/api/kraynet/rune/exit/payout-psbt', { from: A_ADDR, runeId: RUNE, publicKey: A.pk, feeRate: 2, funding: { txid: depTxid, vout: 2 } })
ok(built.ok === true && !!built.psbt, `the node BUILT the payout PSBT from the pot (base-unit amount ${built.summary && built.summary.amount})`)
const wtx = btc.Transaction.fromPSBT(Buffer.from(built.psbt, 'base64'), { allowUnknownInputs: true, allowUnknownOutputs: true })
for (let i = 0; i < wtx.inputsLength; i++) { const inp = wtx.getInput(i); const sh = inp.witnessUtxo && Buffer.from(inp.witnessUtxo.script).toString('hex'); if (sh === ownScriptHex) { try { wtx.signIdx(A.sk, i) } catch { /* not this input */ } } }
const sub = jpost('/api/kraynet/rune/exit/payout-submit', { from: A_ADDR, runeId: RUNE, psbt: Buffer.from(wtx.toPSBT(0)).toString('base64') })
ok(sub.ok === true && /^[0-9a-f]{64}$/.test(sub.txid || ''), `payout BROADCAST from the pot — ${String(sub.txid || sub.error).slice(0, 16)}…`)
mine(Math.max(1, info.minConfirmations)); sync()
const escd = RUNE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const destRaw = execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081/output/${sub.txid}:0`], { encoding: 'utf8' })
const dm = destRaw.match(new RegExp('"' + escd + '"\\s*:\\s*\\{\\s*"amount"\\s*:\\s*(\\d+)'))
ok(dm && BigInt(dm[1]) === keep, `ord confirms the L1 destination received EXACTLY ${keep} base units — never divided`)
let settled = false
for (let i = 0; i < 12 && !settled; i++) { execFileSync('sleep', ['3']); if (held(A_ADDR) === 0n && !(jget('/api/kraynet/runes/of/' + A_ADDR).runes || []).some((r) => r.runeId === RUNE && r.locked && BigInt(String(r.locked.amount ?? r.locked ?? '0')) > 0n)) settled = true }
ok(settled, 'the sweep SETTLED the exit automatically — the lock burned, base-unit exact')
const entry = (jget('/api/kraynet/runes').runes || []).find((r) => r.runeId === RUNE)
ok(entry && entry.solvent !== false && BigInt(entry.reserve) === reserveBefore - keep,
  `CONSERVATION: reserve fell by EXACTLY the exited ${keep} base units (${reserveBefore} → ${entry && entry.reserve}) — solvent, never rounded`)

console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the pot door is base-unit exact end to end: ord-sourced credit, no division, base-unit L2 transfer, base-unit egress, conserved. ⚗️₿⇄₭`)
process.exit(fail ? 1 : 0)
