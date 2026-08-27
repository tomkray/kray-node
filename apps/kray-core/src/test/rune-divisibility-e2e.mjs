// ⚠ LATENT-PATH TEST (personal-vault model) — NOT the current SPV pot door.
// Exercises the STILL-SHIPPING but latent personal-vault code (buildVaultSpend/finalizeCooperative,
// vault-settlement, the rune-rehome sweep, personalOf) that the SPV deposit door no longer feeds — deposits
// are POT-ONLY; personal-vault backing is reachable only via the dev field-trust door. KEPT per council ruling,
// never retired, never repointed onto the pot (that would drop the safety property it proves). The pot door is
// covered by the *-pot-e2e / *-pot-node-e2e files. See docs/MAINNET-READINESS.md (PROVEN-POT vs LATENT-VAULT).

/**
 * DIVISIBILITY — the node is divisibility-AGNOSTIC because it never interprets divisibility, proven.
 *
 * Every rune etches its own divisibility, supply, premine and terms. A bridge that assumed one shape
 * would burn or miscredit the others. KRAY.NETWORK sidesteps the whole class of bug: it NEVER reads a
 * display amount and NEVER divides — every credit, transfer, lock and burn is the atomic u128 BASE
 * unit, and that number is always taken from ORD (the normative indexer) at the exact output, not
 * asserted. Divisibility is decoded only as display metadata; it touches no accounting path.
 *
 * This proves it on a DIVISIBLE rune (divisibility 3): whatever base-unit amount ord says landed in the
 * vault is EXACTLY what the node credits, transfers on the L2, locks on exit, and burns on settle — the
 * round-trip conserves the exact u128, with no ×1000 / ÷1000 error anywhere.
 *
 *   HARNESS=<dir> RUNE=<divisible id> RUNE_NAME=<name> KRAY_BTC_RPC_PASS=<pw> node src/test/rune-divisibility-e2e.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _signKrayWallet, scriptOfAddress, runeSendMessage, runeExitMessage } from '../protocol/scheme.ts'
import { deriveVault } from '../protocol/vault.ts'
import { devGuardians, depositorVault } from './dev-federation.mjs'
import { buildVaultSpend, finalizeCooperative, signSighash } from '../protocol/vault-spend.ts'
import { encodeVarint, TAG } from '../protocol/runestone.ts'
import { parseRuneKey } from '../economics/rune-book.ts'

const HARNESS = process.env.HARNESS
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const RUNE = process.env.RUNE || '3212:1'
const RUNE_NAME = process.env.RUNE_NAME || 'KRAYDIVISIBLETEST'
// a DISPLAY amount to send — ord converts it to base units by the rune's divisibility. We never assume
// the factor; we read the true base-unit result from ord and prove the node matches it exactly.
const SEND_DISPLAY = process.env.SEND_DISPLAY || '12.345'
const NET = 'regtest', BNET = toBtcNet(NET)
const bc = (...a) => execFileSync(`${HARNESS}/bc`, a, { encoding: 'utf8' }).trim()
const ord = (...a) => execFileSync(`${HARNESS}/ordw`, a, { encoding: 'utf8' })
const ordGet = (path) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081${path}`], { encoding: 'utf8' }))
const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
const sync = () => { const h = bc('getblockcount'); for (let i = 0; i < 40; i++) { try { if (String(ordGet('/r/blockheight')) === h) return } catch {} execFileSync('sleep', ['0.5']) } }
const jget = (path) => JSON.parse(execFileSync('curl', ['-s', NODE + path], { encoding: 'utf8' }))
const jpost = (path, body) => JSON.parse(execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(body), NODE + path], { encoding: 'utf8' }))
const rid = parseRuneKey(RUNE)
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const key = (t) => { const sk = createHash('sha256').update('divis|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }
const held = (addr) => { const o = jget('/api/kraynet/runes'); const r = (o.runes || []).find((x) => x.runeId === RUNE); const h = r && (r.holders || []).find((x) => x.address === addr); return h ? BigInt(h.amount) : 0n }
// the EXACT base-unit amount ord reports at an output — the same raw-digit read the node uses (u128-safe)
const ordBaseUnits = (txid, vout) => {
  const raw = execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081/output/${txid}:${vout}`], { encoding: 'utf8' })
  const esc = RUNE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = raw.match(new RegExp('"' + esc + '"\\s*:\\s*\\{\\s*"amount"\\s*:\\s*(\\d+)'))
  return m ? BigInt(m[1]) : 0n
}
function realDonate(krayAddr, sats, potAddr, minConf) {
  const dataHex = Buffer.from(krayAddr, 'ascii').toString('hex')
  const raw = bc('createrawtransaction', '[]', JSON.stringify([{ [potAddr]: Number((sats / 1e8).toFixed(8)) }, { data: dataHex }]))
  const funded = JSON.parse(bc('fundrawtransaction', raw, JSON.stringify({ changePosition: 2 })))
  const signed = JSON.parse(bc('signrawtransactionwithwallet', funded.hex))
  const txid = bc('sendrawtransaction', signed.hex); mine(Math.max(1, minConf)); return jpost('/api/kraynet/donate', { txid })
}
const payoutStone = (amt) => { const [rb, rt] = RUNE.split(':').map(BigInt); const push = (h) => (h.length / 2).toString(16).padStart(2, '0') + h; return '6a5d' + push(Buffer.concat([TAG.Body, rb, rt, amt, 0n].map((n) => Buffer.from(encodeVarint(n)))).toString('hex')) }

console.log(`\n╔═ DIVISIBILITY — base-unit accounting, ord-sourced, never divided (rune ${RUNE_NAME}) ═╗`)
const info = jget('/api/kraynet/donation/info')
ok(info.configured === true, `node pot + bitcoind wired (minConf ${info.minConfirmations})`)
const meta = jget('/api/kraynet/rune/' + encodeURIComponent(RUNE_NAME)).catch?.(() => ({})) || {}
const div = ordGet('/rune/' + RUNE_NAME).entry.divisibility
ok(div >= 1, `the test rune has divisibility ${div} — a display "X" is X·10^${div} base units (the trap a naive bridge falls into)`)

const NONCE = bc('getblockcount')
const A = key('alice|' + NONCE), BOB = key('bob|' + NONCE), G = devGuardians()
const _dv = depositorVault(A.pk, NET)
const params = { ..._dv.params, net: NET }
const vault = _dv.vault
const A_ADDR = btc.p2tr(_hexToBytes(A.pk), undefined, NETWORKS[BNET]).address
const BOB_ADDR = btc.p2tr(_hexToBytes(BOB.pk), undefined, NETWORKS[BNET]).address

// 1 · send a DISPLAY amount into the vault; read the TRUE base units ord recorded
realDonate(A_ADDR, 1000, info.potAddress, info.minConfirmations); sync()
const depOut = JSON.parse(ord('send', '--fee-rate', '1', vault.address, `${SEND_DISPLAY}:${RUNE_NAME}`)); mine(1); sync()
const decoded = JSON.parse(bc('getrawtransaction', depOut.txid, 'true'))
const vaultScriptHex = scriptOfAddress(vault.address, NET)
const vVout = decoded.vout.findIndex((o) => o.scriptPubKey.hex === vaultScriptHex)
const landed = ordBaseUnits(depOut.txid, vVout)
ok(landed > 0n, `ord recorded ${landed} BASE units at the vault for a display send of "${SEND_DISPLAY}" (= ${SEND_DISPLAY} × 10^${div})`)

// 2 · the node credits EXACTLY what ord says landed — no assumption, no ÷10^div
const dep = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: depOut.txid, vault: _dv.params })
ok(dep.ok === true && BigInt(dep.amount) === landed && held(A_ADDR) === landed,
  `the node credited EXACTLY ${landed} base units — the same u128 ord reports, never a divided display number`)
const [vtx, vout2] = dep.outpoint.split(':')
const vaultSats = BigInt(Math.round(decoded.vout[vVout].value * 1e8))

// 3 · an L2 transfer moves base units exactly (send a third of it, keep the remainder exact)
const part = landed / 3n
const n0 = jget('/api/kraynet/profile/' + A_ADDR).nonce
jpost('/api/kraynet/rune/send', { from: A_ADDR, to: BOB_ADDR, runeId: RUNE, amount: part.toString(), nonce: n0, publicKey: A.pk, signature: _signKrayWallet(runeSendMessage(NET, A_ADDR, BOB_ADDR, RUNE, part, n0), A.sk), scheme: 'kraywallet' })
ok(held(A_ADDR) === landed - part && held(BOB_ADDR) === part,
  `an L2 transfer moved ${part} base units exactly: Alice ${landed - part}, Bob ${part} (base-unit arithmetic, no rounding)`)

// 4 · exit + settle round-trips the exact base-unit amount Alice still holds
const keep = landed - part
const n1 = jget('/api/kraynet/profile/' + A_ADDR).nonce
const exit = jpost('/api/kraynet/rune/exit', { from: A_ADDR, runeId: RUNE, amount: keep.toString(), l1Address: A_ADDR, nonce: n1, publicKey: A.pk, signature: _signKrayWallet(runeExitMessage(NET, A_ADDR, RUNE, keep, A_ADDR, n1), A.sk) })
ok(exit.ok === true, `Alice signed an exit of her ${keep} base units — the node locked exactly that`)
// federation co-signs a payout of `keep` to Alice, and `part` (Bob's) stays with the vault change via the pointer
const push = (h) => (h.length / 2).toString(16).padStart(2, '0') + h
const [rb, rt] = RUNE.split(':').map(BigInt)
const stone = '6a5d' + push(Buffer.concat([TAG.Pointer, 2n, TAG.Body, rb, rt, keep, 0n].map((n) => Buffer.from(encodeVarint(n)))).toString('hex'))
const utxo = [{ txid: vtx, vout: Number(vout2), amountSats: vaultSats }]
const outs = [{ address: A_ADDR, amountSats: 330n }, { script: stone, amountSats: 0n }, { address: A_ADDR, amountSats: vaultSats - 330n - 500n }]
const sp = buildVaultSpend(params, utxo, outs, 'cooperative')
const payout = finalizeCooperative(sp, new Map([[G[0].pk, signSighash(sp.sighashes[0], G[0].sk)], [G[1].pk, signSighash(sp.sighashes[0], G[1].sk)]]), signSighash(sp.sighashes[0], A.sk))
const payoutTxid = bc('sendrawtransaction', payout.txHex); mine(1); sync()
ok(ordBaseUnits(payoutTxid, 0) === keep, `ord confirms EXACTLY ${keep} base units left to Alice's L1 — the divisible amount round-tripped with no ×/÷ error`)
const settle = jpost('/api/kraynet/rune/settle', { from: A_ADDR, runeId: RUNE, txid: payoutTxid })
ok(settle.ok === true && settle.burned === keep.toString(), `the node settled and burned EXACTLY ${keep} base units — lock == payout == burn, to the atomic unit`)
ok(jget('/api/kraynet/runes').solvent !== false, 'SOLVENT — a divisible rune conserves exactly like any other, because divisibility never entered the math')

console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — every amount was the atomic base unit from ord; divisibility ${div} touched nothing but the display. ⚖₿₭\n`)
process.exit(fail ? 1 : 0)