// ⚠ LATENT-PATH TEST (personal-vault model) — NOT the current SPV pot door.
// Exercises the STILL-SHIPPING but latent personal-vault code (buildVaultSpend/finalizeCooperative,
// vault-settlement, the rune-rehome sweep, personalOf) that the SPV deposit door no longer feeds — deposits
// are POT-ONLY; personal-vault backing is reachable only via the dev field-trust door. KEPT per council ruling,
// never retired, never repointed onto the pot (that would drop the safety property it proves). The pot door is
// covered by the *-pot-e2e / *-pot-node-e2e files. See docs/MAINNET-READINESS.md (PROVEN-POT vs LATENT-VAULT).

/**
 * POPULATE + EXAM the Runes L2 explorer — a real, rich rune book driven through the PROVEN paths, then a
 * verification that /api/kraynet/rune/<id> renders everything the page at /runes#<id> shows, with the
 * solvency equation balancing exactly. Run against a fresh bench so the numbers read clean.
 *
 *   node apps/kray-net/server.mjs
 *   HARNESS=<dir> RUNE=2566:1 RUNE_NAME=KRAYNETBRIDGETRI KRAY_BTC_RPC_PASS=<pw> node src/test/rune-explorer-populate.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, _signKrayWallet, scriptOfAddress, runeSendMessage, runeExitMessage } from '../protocol/scheme.ts'
import { devGuardians, depositorVault } from './dev-federation.mjs'
import { buildVaultSpend, finalizeCooperative, signSighash } from '../protocol/vault-spend.ts'
import { encodeVarint, TAG } from '../protocol/runestone.ts'
import { parseRuneKey } from '../economics/rune-book.ts'

const HARNESS = process.env.HARNESS
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const RUNE = process.env.RUNE || '2566:1'
const RUNE_NAME = process.env.RUNE_NAME || 'KRAYNETBRIDGETRI'
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
const key = (t) => { const sk = createHash('sha256').update('rex|' + t).digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { sk, pk } }
const addrOf = (k) => btc.p2tr(_hexToBytes(k.pk), undefined, NETWORKS[BNET]).address
const nonceOf = (a) => jget('/api/kraynet/profile/' + a).nonce
function realDonate(krayAddr, sats, potAddr, minConf) {
  const dataHex = Buffer.from(krayAddr, 'ascii').toString('hex')
  const raw = bc('createrawtransaction', '[]', JSON.stringify([{ [potAddr]: Number((sats / 1e8).toFixed(8)) }, { data: dataHex }]))
  const funded = JSON.parse(bc('fundrawtransaction', raw, JSON.stringify({ changePosition: 2 })))
  const signed = JSON.parse(bc('signrawtransactionwithwallet', funded.hex))
  const txid = bc('sendrawtransaction', signed.hex); mine(Math.max(1, minConf)); return jpost('/api/kraynet/donate', { txid })
}
// deposit `amt` (display units, div 0 here) into `who`'s federation vault via a real Runestone
function deposit(who, amt) {
  const { vault, params } = depositorVault(who.pk, NET)
  // postage 330sat — the SAME dynamic-dust rule the wallet PSBTs ride (ord's own default is a padded
  // 10000): what the explorer shows is what the product does. Safe here because this script never
  // spends the vault outpoint (deposits, sends and an exit LOCK only — no cooperative payout), so no
  // L1 fee ever needs headroom from the postage.
  const out = JSON.parse(ord('send', '--fee-rate', '1', '--postage', '330sat', vault.address, `${amt}:${RUNE_NAME}`)); mine(1); sync()
  const dep = jpost('/api/kraynet/rune/deposit', { runeId: RUNE, txid: out.txid, vault: params })
  return { dep, vault, params, txid: out.txid }
}
function send(from, to, amt) {
  const n = nonceOf(addrOf(from))
  return jpost('/api/kraynet/rune/send', { from: addrOf(from), to: addrOf(to), runeId: RUNE, amount: String(amt), nonce: n, publicKey: from.pk, signature: _signKrayWallet(runeSendMessage(NET, addrOf(from), addrOf(to), RUNE, BigInt(amt), n), from.sk), scheme: 'kraywallet' })
}

console.log('\n╔═ RUNES L2 EXPLORER — populate 2566:1 richly, then verify the page data is perfect ═╗')
const info = jget('/api/kraynet/donation/info')
ok(info.configured === true, 'node pot + bitcoind wired')
const G = devGuardians()
const alice = key('alice'), bob = key('bob'), carol = key('carol'), dave = key('dave')
for (const w of [alice, bob, carol, dave]) realDonate(addrOf(w), 1000, info.potAddress, info.minConfirmations)
sync()

// ── build a lively book: 2 deposits, several L2 sends (many holders), an OPEN exit, and a full SETTLE ──
const dA = deposit(alice, 900); ok(dA.dep.ok === true, 'Alice deposited 900 into her federation vault (proven)')
const dB = deposit(bob, 600); ok(dB.dep.ok === true, 'Bob deposited 600 (a second backing outpoint)')
ok(send(alice, carol, 250).ok === true, 'Alice → Carol 250 on the L2 (instant, signed)')
ok(send(alice, dave, 150).ok === true, 'Alice → Dave 150 on the L2')
ok(send(bob, carol, 100).ok === true, 'Bob → Carol 100 on the L2 (Carol now holds from two senders)')

// Dave opens an EXIT (locks 150) but does not settle — the explorer should show it as "exiting"
const nD = nonceOf(addrOf(dave))
const exit = jpost('/api/kraynet/rune/exit', { from: addrOf(dave), runeId: RUNE, amount: '150', l1Address: addrOf(dave), nonce: nD, publicKey: dave.pk, signature: _signKrayWallet(runeExitMessage(NET, addrOf(dave), RUNE, 150n, addrOf(dave), nD), dave.sk) })
ok(exit.ok === true, 'Dave signed an exit of 150 — the book LOCKS it (an open exit for the explorer to show)')

// ══ THE EXAM — is the explorer data perfect? ══════════════════════════════════
// The book now: Alice 500 (900 − 250 − 150), Bob 500 (600 − 100), Carol 350 (250 + 100), Dave 150 LOCKED
// (an open exit). Two real deposits back it on Bitcoin (reserve 1500). credits 1350 + locked 150 == 1500.
console.log('\n── the explorer view (/api/kraynet/rune/' + RUNE + ') ──')
const r = jget('/api/kraynet/rune/' + RUNE)
const holders = r.holders || []
const totalCredits = holders.reduce((t, h) => t + BigInt(h.amount), 0n)
ok(r.name === RUNE_NAME && r.runeId === RUNE, `identity: ${r.name} (${r.runeId})`)
ok(r.solvent === true, `SOLVENT — ${r.equation}`)
ok(BigInt(r.credits) + BigInt(r.locked) === BigInt(r.reserve), 'the equation BALANCES: credits + locked == reserve (the tripwire the node HALTs on)')
ok(totalCredits === BigInt(r.credits) && BigInt(r.reserve) === 1500n, `reserve 1500 backed by two deposits; credits ${r.credits} + locked ${r.locked} == 1500`)
const byAddr = (w) => (holders.find((h) => h.address === addrOf(w)) || { amount: '0' }).amount
ok(byAddr(alice) === '500' && byAddr(bob) === '500' && byAddr(carol) === '350', 'holders correct: Alice 500, Bob 500, Carol 350 (from two senders)')
ok(holders.length === 3 && holders[0].share >= holders[holders.length - 1].share && holders[0].share > 0, 'holders are RANKED by amount, each with a share %')
ok(BigInt(r.locked) === 150n && (r.exits || []).length === 1, 'the OPEN exit shows: 150 locked, 1 address exiting to L1')
const backing = r.backing || []
ok(backing.length === 2 && backing.every((b) => !b.released), `backing on Bitcoin: 2 vault outpoints, both live (${backing.map((b) => b.amount).join(' + ')} == reserve)`)
const kinds = (r.activity || []).map((a) => a.kind)
ok(kinds.includes('rune-deposit') && kinds.includes('rune-send') && kinds.includes('rune-exit'),
  `the activity feed carries every kind: ${[...new Set(kinds)].join(', ')}`)
ok((r.activity || []).length >= 6, `the story is full: ${r.activity.length} events, newest first, each tagged`)
// the overview too
const ov = jget('/api/kraynet/runes')
const card = (ov.runes || []).find((x) => x.runeId === RUNE)
// overview `holders` is the ARRAY (pages dereference it); `holderCount` carries the number
ok(!!card && card.solvent === true && Number(card.holderCount) === holders.length && Array.isArray(card.holders) && !!card.thumbnail,
  `overview card: ${card && card.name}, ${card && card.holderCount} holders, solvent, thumbnail present`)

console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the rune book is richly populated and the explorer shows it perfectly, solvency proven. 🔎⚗️₭`)
console.log(`   open http://localhost:4477/runes#${RUNE}\n`)
process.exit(fail ? 1 : 0)