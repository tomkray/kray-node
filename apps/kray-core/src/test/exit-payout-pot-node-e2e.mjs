/**
 * THE USER-FUNDED EXIT PAYOUT, THROUGH THE NODE — the bakery-tab last mile, live.
 *
 * The whole automatic withdraw, exactly as the extension will drive it:
 *   deposit (proven) → rune-exit (signed lock) → /rune/exit/payout-psbt (the node
 *   builds the vault spend: runes from the exiter's OWN vault, postage + fee from
 *   the exiter's OWN sats, destination = the SIGNED l1Address) → the wallet signs
 *   the PSBT (BIP-371: script path on the vault, tweaked key path on the funding)
 *   → /rune/exit/payout-submit (lab guardians co-sign, node broadcasts) → the
 *   sweep SETTLES the lock automatically once buried, and re-watches the change.
 *
 * No hands anywhere after the two signatures. Adversarial checks ride along:
 * a spoofed pubkey, a stranger's funding UTXO, an unsigned PSBT, and a replay.
 *
 *   HARNESS=<dir> KRAY_NODE=http://127.0.0.1:4499 RUNE=121:1 RUNE_NAME=KRAYNETBRIDGETWO \
 *     node src/test/exit-payout-node-e2e.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _signKrayWallet, scriptOfAddress, runeExitMessage } from '../protocol/scheme.ts'
import { potCredit } from './dev-federation.mjs'
import { parseRuneKey } from '../economics/rune-book.ts'

const HARNESS = process.env.HARNESS
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4499'
const RUNE = process.env.RUNE || '121:1'
const RUNE_NAME = process.env.RUNE_NAME || 'KRAYNETBRIDGETWO'
const DEPOSIT = BigInt(process.env.DEPOSIT || '5000')
const EXIT = BigInt(process.env.EXIT || '2000')          // partial — proves the change path
const NET = 'regtest', BNET = toBtcNet(NET)
const bc = (...a) => execFileSync(`${HARNESS}/bc`, a, { encoding: 'utf8' }).trim()
const ord = (...a) => execFileSync(`${HARNESS}/ordw`, a, { encoding: 'utf8' })
const ordGet = (path) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081${path}`], { encoding: 'utf8' }))
const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
const sync = () => { const h = bc('getblockcount'); for (let i = 0; i < 40; i++) { try { if (String(ordGet('/r/blockheight')) === h) return } catch {} execFileSync('sleep', ['0.5']) } }
const jget = (path) => JSON.parse(execFileSync('curl', ['-s', NODE + path], { encoding: 'utf8' }))
const jpost = (path, body) => JSON.parse(execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(body), NODE + path], { encoding: 'utf8' }))
const sleep = (s) => execFileSync('sleep', [String(s)])
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const key = (t) => { const sk = createHash('sha256').update('exit-payout-node|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }

function realDonate(krayAddr, sats, potAddr, minConf) {
  const dataHex = Buffer.from(krayAddr, 'ascii').toString('hex')
  const raw = bc('createrawtransaction', '[]', JSON.stringify([{ [potAddr]: Number((sats / 1e8).toFixed(8)) }, { data: dataHex }]))
  const funded = JSON.parse(bc('fundrawtransaction', raw, JSON.stringify({ changePosition: 2 })))
  const signed = JSON.parse(bc('signrawtransactionwithwallet', funded.hex))
  const txid = bc('sendrawtransaction', signed.hex)
  mine(Math.max(1, minConf))
  return jpost('/api/kraynet/donate', { txid })
}

console.log('\n╔═ THE USER-FUNDED EXIT PAYOUT, THROUGH THE NODE — build · sign · co-sign · auto-settle ═╗')

// ── 0 · node wired ────────────────────────────────────────────────────────────
const info = jget('/api/kraynet/donation/info')
ok(info.configured === true, `node has the pot + bitcoind wired (minConf ${info.minConfirmations})`)
if (!info.configured) process.exit(1)

// ── 1 · fresh owner + vault; a separate DESTINATION address (not the owner's) ─
const NONCE = bc('getblockcount')
const OWNER = key('owner|' + NONCE)
const DESTK = key('dest|' + NONCE)
const OWNER_ADDR = btc.p2tr(_hexToBytes(OWNER.pk), undefined, NETWORKS[BNET]).address
const DEST_ADDR = btc.p2tr(_hexToBytes(DESTK.pk), undefined, NETWORKS[BNET]).address
const rid = parseRuneKey(RUNE)
console.log(`   owner ${OWNER_ADDR.slice(0, 20)}…  dest ${DEST_ADDR.slice(0, 20)}…`)

// ── 2 · gas (real SPV-proven donation) + deposit (pot model: wallet → pot, credit = unique spender) ─
const don = realDonate(OWNER_ADDR, 1000, info.potAddress, info.minConfirmations)
sync()
ok(don.ok === true, 'owner funded with real SPV-proven ₭ for the 1-₭ exit gas')
const { dep } = potCredit({ owner: OWNER, amount: DEPOSIT, net: NET, rune: RUNE, runeName: RUNE_NAME })
ok(dep.ok === true && dep.amount === DEPOSIT.toString() && dep.credited === OWNER_ADDR, `deposited ${dep.amount} ${RUNE_NAME} to the pot, credited the owner (unique Taproot spender) — proven, watched`)

// ── 3 · the exiter's FUNDING utxo — their own sats for postage + fee ─────────
const fundTxid = bc('sendtoaddress', OWNER_ADDR, '0.00050000')
mine(1)
const fdec = JSON.parse(bc('getrawtransaction', fundTxid, 'true'))
const ownScript = scriptOfAddress(OWNER_ADDR, BNET)
const fundVout = fdec.vout.findIndex((o) => (o.scriptPubKey && o.scriptPubKey.hex || '').toLowerCase() === ownScript)
ok(fundVout >= 0, `the exiter holds their own sats utxo (${fundTxid.slice(0, 12)}…:${fundVout}, 50,000 sats)`)

// ── 4 · EXIT — the owner signs; the destination is a DIFFERENT address, bound in the signature ─
const nonce = jget('/api/kraynet/profile/' + OWNER_ADDR).nonce
const exitSig = _signKrayWallet(runeExitMessage(NET, OWNER_ADDR, RUNE, EXIT, DEST_ADDR, nonce), OWNER.sk)
const reserveBefore = BigInt((jget('/api/kraynet/runes').runes.find((r) => r.runeId === RUNE) || {}).reserve || '0')
const exit = jpost('/api/kraynet/rune/exit', { from: OWNER_ADDR, runeId: RUNE, amount: EXIT.toString(), l1Address: DEST_ADDR, nonce, publicKey: OWNER.pk, signature: exitSig })
ok(exit.ok === true, `exit LOCKED: ${EXIT} ${RUNE_NAME} payable ONLY to the signed destination`)

// ── 5 · PHASE A — the node builds the user-funded payout ─────────────────────
const built = jpost('/api/kraynet/rune/exit/payout-psbt', {
  from: OWNER_ADDR, runeId: RUNE, publicKey: OWNER.pk, feeRate: 2,
  funding: { txid: fundTxid, vout: fundVout },
})
ok(built.ok === true && !!built.psbt, `the node BUILT the payout PSBT — fee ${built.summary && built.summary.feeSats} sats @ ${built.summary && built.summary.feeRate} sat/vB (~${built.summary && built.summary.vsizeEst} vB), rune change ${built.summary && built.summary.runeChange}`)
ok(built.summary && built.summary.amount === EXIT.toString() && built.summary.l1Address === DEST_ADDR, 'the payout pays EXACTLY the lock, to EXACTLY the signed destination — read from the lock, never from the client')

// adversarial: a spoofed pubkey cannot build for someone else's exit
const spoof = jpost('/api/kraynet/rune/exit/payout-psbt', { from: OWNER_ADDR, runeId: RUNE, publicKey: key('mallory').pk, feeRate: 2, funding: { txid: fundTxid, vout: fundVout } })
ok(!!spoof.error && /does not derive/.test(spoof.error), 'ATTACK: a spoofed pubkey → REFUSED (the key must derive the exiting address)')
// adversarial: a stranger's UTXO cannot fund it (the exiter pays their own way)
const strangerUtxo = JSON.parse(bc('listunspent', '1', '9999999', '[]', 'false', '{"maximumCount":1,"minimumAmount":0.001}'))[0]
const wrongFund = jpost('/api/kraynet/rune/exit/payout-psbt', { from: OWNER_ADDR, runeId: RUNE, publicKey: OWNER.pk, feeRate: 2, funding: { txid: strangerUtxo.txid, vout: strangerUtxo.vout } })
ok(!!wrongFund.error && /must belong to the exiting address/.test(wrongFund.error), 'ATTACK: funding with a stranger\'s utxo → REFUSED')

// ── 6 · the WALLET signs the PSBT (BIP-371) — vault leaf + tweaked key path ──
const wtx = btc.Transaction.fromPSBT(Buffer.from(built.psbt, 'base64'), { allowUnknownInputs: true, allowUnknownOutputs: true })
// adversarial first: an UNSIGNED psbt must be refused
const unsigned = jpost('/api/kraynet/rune/exit/payout-submit', { from: OWNER_ADDR, runeId: RUNE, psbt: built.psbt })
ok(!!unsigned.error && /did not sign/.test(unsigned.error), 'ATTACK: an unsigned PSBT → REFUSED (the owner\'s signature is REQUIRED)')
// pot model: the owner signs ONLY their own funding input(s); the pot input is co-signed server-side
const ownHex = scriptOfAddress(OWNER_ADDR, BNET)
for (let i = 0; i < wtx.inputsLength; i++) {
  const inp = wtx.getInput(i)
  const sh = inp.witnessUtxo && Buffer.from(inp.witnessUtxo.script).toString('hex')
  if (sh === ownHex) { try { wtx.signIdx(OWNER.sk, i) } catch { /* not this input's key */ } }
}
const signedPsbt = Buffer.from(wtx.toPSBT(0)).toString('base64')

// ── 7 · PHASE B — guardians co-sign, the node broadcasts ─────────────────────
const sub = jpost('/api/kraynet/rune/exit/payout-submit', { from: OWNER_ADDR, runeId: RUNE, psbt: signedPsbt })
ok(sub.ok === true && /^[0-9a-f]{64}$/.test(sub.txid || ''), `payout BROADCAST — ${String(sub.txid).slice(0, 16)}… (settles automatically after ${sub.minConfirmations} conf)`)
mine(Math.max(1, info.minConfirmations)); sync()
let destGot = 0n
try { const o = ordGet(`/output/${sub.txid}:0`); const r = o.runes && (o.runes[RUNE_NAME] || o.runes[RUNE]); if (r) destGot = BigInt((r.amount ?? r) || 0) } catch {}
ok(destGot === EXIT, `ord confirms the SIGNED destination received exactly ${destGot} ${RUNE_NAME} on L1`)
// the rune change returns to the pot IF coin-selection left any — an exact-fit pot outpoint leaves none.
// The COMPLETE conservation proof is the reserve-delta below, not a fixed change amount.
let changeGot = 0n
try { const o = ordGet(`/output/${sub.txid}:2`); const r = o.runes && (o.runes[RUNE_NAME] || o.runes[RUNE]); if (r) changeGot = BigInt((r.amount ?? r) || 0) } catch {}

// ── 8 · AUTOMATIC SETTLE — the sweep burns the lock with NO further hands ────
let settled = false
for (let i = 0; i < 12 && !settled; i++) {
  sleep(5)
  const runes = jget('/api/kraynet/runes/of/' + OWNER_ADDR)
  const mine_ = (runes.runes || []).find((r) => r.runeId === RUNE)
  const lockedNow = mine_ && mine_.locked != null ? BigInt(String(mine_.locked.amount != null ? mine_.locked.amount : mine_.locked || '0')) : 0n
  if (lockedNow === 0n) settled = true
}
ok(settled, 'the sweep SETTLED the exit automatically — the lock burned with no manual settle call')
const book = jget('/api/kraynet/runes')
const entry = (book.runes || []).find((r) => r.runeId === RUNE)
ok(!!entry && entry.solvent !== false && book.solvent !== false, `the rune book stays SOLVENT (reserve ${entry && entry.reserve} == credits ${entry && entry.credits} + locks)`)
const reserveAfter = BigInt((entry || {}).reserve || '0')
ok(reserveAfter === reserveBefore - EXIT, `CONSERVATION: reserve fell by EXACTLY the exited ${EXIT} (${reserveBefore} → ${reserveAfter}) — nothing burned beyond the settle`)
const watch = jget('/api/kraynet/vault-watch')
const changeWatched = JSON.stringify(watch).includes(`${sub.txid}:2`)
ok(changeGot === 0n ? true : changeWatched, changeGot > 0n
  ? `the ${changeGot} rune change returned to the pot and is back under the WATCHER's eye — the reserve never blinks`
  : `the payout coin-selected an exact-fit pot outpoint — all ${EXIT} delivered, no rune change to watch (conservation proven by the reserve-delta)`)

// ── 9 · replay: the pending draft is gone, and a rebuilt payout finds no lock ─
const replay = jpost('/api/kraynet/rune/exit/payout-submit', { from: OWNER_ADDR, runeId: RUNE, psbt: signedPsbt })
ok(!!replay.error, 'REPLAY: submitting the same payout again → REFUSED (the draft is consumed)')
const rebuilt = jpost('/api/kraynet/rune/exit/payout-psbt', { from: OWNER_ADDR, runeId: RUNE, publicKey: OWNER.pk, feeRate: 2, funding: { txid: fundTxid, vout: fundVout } })
ok(!!rebuilt.error && /no open exit/.test(rebuilt.error), 'REBUILD after settle: no open exit remains — one lock, one payout, one burn')

console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the bakery tab pays out by itself: user-funded, owner-first, guardians co-sign, the sweep settles. ⚗️₿⇄₭`)
process.exit(fail ? 1 : 0)
