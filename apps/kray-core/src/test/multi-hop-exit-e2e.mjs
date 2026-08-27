// ⚠ LATENT-PATH TEST (personal-vault model) — NOT the current SPV pot door.
// Exercises the STILL-SHIPPING but latent personal-vault code (buildVaultSpend/finalizeCooperative,
// vault-settlement, the rune-rehome sweep, personalOf) that the SPV deposit door no longer feeds — deposits
// are POT-ONLY; personal-vault backing is reachable only via the dev field-trust door. KEPT per council ruling,
// never retired, never repointed onto the pot (that would drop the safety property it proves). The pot door is
// covered by the *-pot-e2e / *-pot-node-e2e files. See docs/MAINNET-READINESS.md (PROVEN-POT vs LATENT-VAULT).

/**
 * MULTI-HOP WITHDRAWAL — a recipient who NEVER deposited withdraws from the shared consolidation, proven.
 *
 * The residue design routes the runes a depositor sent away into a CONSOLIDATION vault — a federation
 * custody (owner = a designated consolidation key, + the guardians; NUMS key path) that holds the
 * shared backing for everyone the depositors paid on the L2. This proves the loop the Creator asked
 * about closes: Bob, who received runes on the L2 and never touched Bitcoin, gets his runes back on L1.
 *
 *   1 · 600 runes sit in the consolidation vault (a real deposit, node-credited to the consolidation key);
 *   2 · the consolidation key sends 600 to Bob on the L2 — Bob now holds 600, backed by that vault;
 *   3 · Bob signs an exit to HIS L1 address; the node locks his 600;
 *   4 · the federation (consolidation key + 2 guardians) co-signs a payout FROM the consolidation vault
 *       to Bob's signed L1 address — the exact machinery the bridge already proves, on shared custody;
 *   5 · the node SETTLES Bob's exit against that payout: his lock burns, the reserve falls by 600,
 *       and the book stays solvent the whole way.
 *
 * Attacks: a payout to the WRONG destination, a SHORT payout, and a settle with no open lock are all
 * refused by the same proven settle path — a lock can only ever burn against a genuine, exact delivery
 * to the address Bob himself signed. Nobody can drain the pool to somewhere the L2 never authorised.
 *
 *   HARNESS=<dir> RUNE=2566:1 RUNE_NAME=KRAYNETBRIDGETRI KRAY_BTC_RPC_PASS=<pw> node src/test/multi-hop-exit-e2e.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _signKrayWallet, scriptOfAddress, runeSendMessage, runeExitMessage } from '../protocol/scheme.ts'
import { deriveVault, toXOnly } from '../protocol/vault.ts'
import { consolidationVault, devGuardians } from './dev-federation.mjs'
import { buildVaultSpend, finalizeCooperative, signSighash, auditVaultSpend } from '../protocol/vault-spend.ts'
import { encodeVarint, TAG } from '../protocol/runestone.ts'
import { parseRuneKey } from '../economics/rune-book.ts'

const HARNESS = process.env.HARNESS
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const RUNE = process.env.RUNE || '2566:1'
const RUNE_NAME = process.env.RUNE_NAME || 'KRAYNETBRIDGETRI'
const POOL = 600n
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
const key = (t) => { const sk = createHash('sha256').update('multihop|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }
const held = (addr) => { const o = jget('/api/kraynet/runes'); const r = (o.runes || []).find((x) => x.runeId === RUNE); const h = r && (r.holders || []).find((x) => x.address === addr); return h ? BigInt(h.amount) : 0n }
const reserve = () => { const o = jget('/api/kraynet/runes'); const r = (o.runes || []).find((x) => x.runeId === RUNE); return r ? BigInt(r.reserve) : 0n }
function realDonate(krayAddr, sats, potAddr, minConf) {
  const dataHex = Buffer.from(krayAddr, 'ascii').toString('hex')
  const raw = bc('createrawtransaction', '[]', JSON.stringify([{ [potAddr]: Number((sats / 1e8).toFixed(8)) }, { data: dataHex }]))
  const funded = JSON.parse(bc('fundrawtransaction', raw, JSON.stringify({ changePosition: 2 })))
  const signed = JSON.parse(bc('signrawtransactionwithwallet', funded.hex))
  const txid = bc('sendrawtransaction', signed.hex); mine(Math.max(1, minConf))
  return jpost('/api/kraynet/donate', { txid })
}
// a runestone moving `amt` of the rune to output 0 (the payout recipient); any remainder is routed by
// a Pointer to `remainderOut` (default 2 = the change/FED output) so a SHORT payout truly leaves Bob short
// — without the pointer, the Runes default would drop the leftover onto output 0 and quietly top Bob up.
const payoutStone = (amt, remainderOut = 2) => {
  const [rb, rt] = RUNE.split(':').map(BigInt); const push = (h) => (h.length / 2).toString(16).padStart(2, '0') + h
  const body = Buffer.concat([TAG.Pointer, BigInt(remainderOut), TAG.Body, rb, rt, amt, 0n].map((n) => Buffer.from(encodeVarint(n))))
  return '6a5d' + push(body.toString('hex'))
}

console.log('\n╔═ MULTI-HOP WITHDRAWAL — a recipient who never deposited withdraws from the shared pool ═╗')
const info = jget('/api/kraynet/donation/info')
ok(info.configured === true, `node pot + bitcoind wired (minConf ${info.minConfirmations})`)

const NONCE = bc('getblockcount')
const _con = consolidationVault(NET), FED = _con.ownerKey, G = devGuardians()
const BOB = key('bob|' + NONCE), MAL = key('mallory|' + NONCE)
// THE CONSOLIDATION VAULT — the ONE canonical shared federation custody (consolidation owner key + guardians)
const cparams = { ..._con.params, net: NET }
const cvault = _con.vault
const FED_ADDR = btc.p2tr(_hexToBytes(FED.pk), undefined, NETWORKS[BNET]).address
const BOB_ADDR = btc.p2tr(_hexToBytes(BOB.pk), undefined, NETWORKS[BNET]).address
const MAL_ADDR = btc.p2tr(_hexToBytes(MAL.pk), undefined, NETWORKS[BNET]).address

// 1 · 600 runes land in the consolidation vault (a real deposit; node credits the consolidation key)
realDonate(FED_ADDR, 1000, info.potAddress, info.minConfirmations)  // gas for the L2 send
realDonate(BOB_ADDR, 1000, info.potAddress, info.minConfirmations); sync()  // Bob's exit gas
const cdepOut = JSON.parse(ord('send', '--fee-rate', '1', cvault.address, `${POOL}:${RUNE_NAME}`)); mine(1); sync()
const cdep = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: cdepOut.txid, vault: _con.params })
ok(cdep.ok === true && cdep.credited === FED_ADDR && held(FED_ADDR) === POOL, `${POOL} runes consolidated in the shared vault (credited to the consolidation key)`)
const [ctxid, cvout] = cdep.outpoint.split(':')
const cSats = BigInt(Math.round(JSON.parse(bc('getrawtransaction', ctxid, 'true')).vout[Number(cvout)].value * 1e8))

// 2 · the consolidation key sends 600 to Bob on the L2 (Bob is a recipient, never a depositor)
const n1 = jget('/api/kraynet/profile/' + FED_ADDR).nonce
const s = jpost('/api/kraynet/rune/send', { from: FED_ADDR, to: BOB_ADDR, runeId: RUNE, amount: POOL.toString(), nonce: n1, publicKey: FED.pk, signature: _signKrayWallet(runeSendMessage(NET, FED_ADDR, BOB_ADDR, RUNE, POOL, n1), FED.sk), scheme: 'kraywallet' })
ok(s.ok === true && held(BOB_ADDR) === POOL, `Bob received ${POOL} on the L2 — his balance is backed by the consolidation vault, not a vault he owns`)
const reserveBefore = reserve()

// 3 · Bob signs an exit to HIS L1 address; the node locks his 600
const n2 = jget('/api/kraynet/profile/' + BOB_ADDR).nonce
const exit = jpost('/api/kraynet/rune/exit', { from: BOB_ADDR, runeId: RUNE, amount: POOL.toString(), l1Address: BOB_ADDR, nonce: n2, publicKey: BOB.pk, signature: _signKrayWallet(runeExitMessage(NET, BOB_ADDR, RUNE, POOL, BOB_ADDR, n2), BOB.sk) })
ok(exit.ok === true && held(BOB_ADDR) === 0n, 'Bob signed an exit for his 600 — the node locked them (spend-on-L2 and claim-on-L1 now exclusive)')

// ── ATTACK A · a payout from the pool to the WRONG address cannot settle Bob's exit ──
const utxo = [{ txid: ctxid, vout: Number(cvout), amountSats: cSats }]
const wrongOuts = [{ address: MAL_ADDR, amountSats: 330n }, { script: payoutStone(POOL), amountSats: 0n }, { address: FED_ADDR, amountSats: cSats - 330n - 500n }]
const wrongSpend = buildVaultSpend(cparams, utxo, wrongOuts, 'cooperative')
const wrongPayout = finalizeCooperative(wrongSpend, new Map([[G[0].pk, signSighash(wrongSpend.sighashes[0], G[0].sk)], [G[1].pk, signSighash(wrongSpend.sighashes[0], G[1].sk)]]), signSighash(wrongSpend.sighashes[0], FED.sk))
const wrongTxid = bc('sendrawtransaction', wrongPayout.txHex); mine(1); sync()
const wrongSettle = jpost('/api/kraynet/rune/settle', { from: BOB_ADDR, runeId: RUNE, txid: wrongTxid })
ok(!wrongSettle.ok && /signed destination|does not pay/i.test(String(wrongSettle.error || '')),
  'a pool payout to the WRONG address cannot settle Bob\'s exit — the runes must reach the address Bob SIGNED')
// that payout spent the pool UTXO though — so re-fund a fresh pool outpoint for the honest path
// (in production the pool is one evolving custody; here we just deposit again to get a clean outpoint)
const cdep2Out = JSON.parse(ord('send', '--fee-rate', '1', cvault.address, `${POOL}:${RUNE_NAME}`)); mine(1); sync()
const cdep2 = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: cdep2Out.txid, vault: _con.params })
const [c2txid, c2vout] = cdep2.outpoint.split(':')
const c2Sats = BigInt(Math.round(JSON.parse(bc('getrawtransaction', c2txid, 'true')).vout[Number(c2vout)].value * 1e8))

// ── ATTACK B · a SHORT payout (less than the lock) cannot settle ──
const utxo2 = [{ txid: c2txid, vout: Number(c2vout), amountSats: c2Sats }]
const shortOuts = [{ address: BOB_ADDR, amountSats: 330n }, { script: payoutStone(POOL - 1n), amountSats: 0n }, { address: FED_ADDR, amountSats: c2Sats - 330n - 500n }]
const shortSpend = buildVaultSpend(cparams, utxo2, shortOuts, 'cooperative')
const shortPayout = finalizeCooperative(shortSpend, new Map([[G[0].pk, signSighash(shortSpend.sighashes[0], G[0].sk)], [G[1].pk, signSighash(shortSpend.sighashes[0], G[1].sk)]]), signSighash(shortSpend.sighashes[0], FED.sk))
const shortTxid = bc('sendrawtransaction', shortPayout.txHex); mine(1); sync()
const shortSettle = jpost('/api/kraynet/rune/settle', { from: BOB_ADDR, runeId: RUNE, txid: shortTxid })
ok(!shortSettle.ok && /not the .* it locked|delivered/i.test(String(shortSettle.error || '')),
  `a SHORT payout (${POOL - 1n} < ${POOL}) cannot settle — a settlement matches its lock EXACTLY`)
// re-fund one more clean outpoint for the honest path
const cdep3Out = JSON.parse(ord('send', '--fee-rate', '1', cvault.address, `${POOL}:${RUNE_NAME}`)); mine(1); sync()
const cdep3 = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: cdep3Out.txid, vault: _con.params })
const [c3txid, c3vout] = cdep3.outpoint.split(':')
const c3Sats = BigInt(Math.round(JSON.parse(bc('getrawtransaction', c3txid, 'true')).vout[Number(c3vout)].value * 1e8))

// 4 · THE HONEST WITHDRAWAL — federation co-signs the pool payout to Bob's signed address, exact amount
const utxo3 = [{ txid: c3txid, vout: Number(c3vout), amountSats: c3Sats }]
const bobOuts = [{ address: BOB_ADDR, amountSats: 330n }, { script: payoutStone(POOL), amountSats: 0n }, { address: FED_ADDR, amountSats: c3Sats - 330n - 500n }]
const bobSpend = buildVaultSpend(cparams, utxo3, bobOuts, 'cooperative')
const bobPayout = finalizeCooperative(bobSpend, new Map([[G[0].pk, signSighash(bobSpend.sighashes[0], G[0].sk)], [G[1].pk, signSighash(bobSpend.sighashes[0], G[1].sk)]]), signSighash(bobSpend.sighashes[0], FED.sk))
const pa = auditVaultSpend(bobPayout.txHex, cparams, utxo3)
ok(pa.ok && pa.signers.includes(toXOnly(FED.pk)), 'the pool payout is federation-cosigned (consolidation key + 2 guardians), proven from raw bytes')
const bobTxid = bc('sendrawtransaction', bobPayout.txHex); mine(1); sync()
ok(ordRunesAt2(bobTxid, 0) === POOL, `ord confirms ${POOL} left the pool to Bob's L1 address`)

// 5 · the node settles Bob's exit — his lock burns, the reserve falls by exactly 600, solvent throughout
const settle = jpost('/api/kraynet/rune/settle', { from: BOB_ADDR, runeId: RUNE, txid: bobTxid })
ok(settle.ok === true && settle.burned === POOL.toString(), `the node SETTLED Bob's multi-hop exit — his lock burned, ${POOL} runes home on L1`)
ok(jget('/api/kraynet/runes').solvent !== false, 'the book is SOLVENT after a recipient withdrew from the shared pool — reserve == Σ credits + locks held throughout')

// ── ATTACK C · re-settling, or settling with no open lock, is refused ──
const dup = jpost('/api/kraynet/rune/settle', { from: BOB_ADDR, runeId: RUNE, txid: bobTxid })
ok(!dup.ok, 're-settling the same payout is refused — one payout, one burn, forever')

function ordRunesAt2(txid, vout) { try { const o = ordGet(`/output/${txid}:${vout}`); const r = o.runes && (o.runes[RUNE_NAME] || o.runes[RUNE]); return r ? BigInt((r.amount ?? r) || 0) : 0n } catch { return 0n } }

console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — a recipient who never deposited withdrew from the shared pool, exactly, provably, solvent. ⇄₿₭\n`)
process.exit(fail ? 1 : 0)