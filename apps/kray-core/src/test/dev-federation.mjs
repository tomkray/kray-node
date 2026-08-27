/**
 * THE DEV FEDERATION — the exact guardian + consolidation keys a regtest/signet node generates when no
 * KRAY_VAULT_GUARDIANS / KRAY_CONSOLIDATION_KEY is configured. The server derives the guardian PUBLIC keys
 * from these seeds (server.mjs: devGuardianKeys / consolidationDepositorKey); a test derives the PRIVATE
 * keys from the SAME seeds, so it can co-sign a real cooperative vault spend the node will accept.
 *
 * Deposits are now bound to this federation (a vault the depositor could spend alone is refused), and a
 * settlement's consolidation output must pay the ONE canonical consolidation vault — so every bridge e2e
 * must build its vaults from HERE, exactly as a real wallet would after GET /api/kraynet/bridge/params.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _hexToBytes, scriptOfAddress } from '../protocol/scheme.ts'
import { deriveVault } from '../protocol/vault.ts'
import { encodeVarint, TAG } from '../protocol/runestone.ts'

const GUARDIAN_SEEDS = ['kray-dev-vault-guardian-0', 'kray-dev-vault-guardian-1', 'kray-dev-vault-guardian-2']
const CONSOLIDATION_SEED = 'kray-dev-consolidation-owner'
const key = (seed) => { const sk = createHash('sha256').update(seed).digest(); return { sk, pk: _generateKeyPair(sk).publicKeyHex } }

/** The dev guardian keypairs (with private keys, so a test can co-sign) — same order the server publishes. */
export function devGuardians() { return GUARDIAN_SEEDS.map(key) }
/** The dev threshold + timelock a regtest node uses by default (2-of-3, 144-block reclaim). */
export const DEV_THRESHOLD = 2
export const devTimelock = (net) => (net === 'regtest' ? 16 : 4320)
/** The consolidation vault owner keypair. */
export function devConsolidationKey() { return key(CONSOLIDATION_SEED) }

/** The federation params a depositor's vault must use (guardians pubkeys + threshold + timelock). */
export function federationParams(net) {
  return { guardians: devGuardians().map((g) => g.pk), threshold: DEV_THRESHOLD, timelock: devTimelock(net) }
}

/** Derive a depositor's vault under the dev federation (the address to deposit into, + params for /rune/deposit). */
export function depositorVault(depositorPk, net) {
  const f = federationParams(net)
  const vault = deriveVault({ ...f, depositor: depositorPk, net: toBtcNet(net) })
  return { vault, params: { guardians: f.guardians, threshold: f.threshold, depositor: depositorPk, timelock: f.timelock } }
}

/**
 * THE PROVEN POT DEPOSIT, as a helper — the CURRENT model every bridge e2e shares.
 * The owner sends `amount` of the rune from its OWN Taproot address straight to the bakery pot;
 * the node names the credit from the unique Taproot spender (bytes, never a client field) and
 * returns {credited, amount, outpoint, pool}. Replaces the retired personal-vault deposit path.
 *
 *   owner   — { sk, pk } (pk x-only hex); the credited party = OWNER's Taproot address
 *   returns — { depTxid, dep, ownerAddr } where dep is the /rune/deposit response
 */
export function potCredit({ owner, amount, net = 'regtest', harness = process.env.HARNESS, node = process.env.KRAY_NODE || 'http://127.0.0.1:4477', rune = '130:1', runeName = 'IRON•SATOSHI•ROCK' }) {
  const bnet = toBtcNet(net)
  const bc = (...a) => execFileSync(`${harness}/bc`, a, { encoding: 'utf8' }).trim()
  const ord = (...a) => execFileSync(`${harness}/ordw`, a, { encoding: 'utf8' })
  const ordGet = (p) => JSON.parse(execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081${p}`], { encoding: 'utf8' }))
  const mine = (n = 1) => bc('generatetoaddress', String(n), bc('getnewaddress'))
  const sync = () => { const h = bc('getblockcount'); for (let i = 0; i < 40; i++) { try { if (String(ordGet('/r/blockheight')) === h) return } catch {} execFileSync('sleep', ['0.5']) } }
  const jget = (p) => JSON.parse(execFileSync('curl', ['-s', node + p], { encoding: 'utf8' }))
  const jpost = (p, body) => JSON.parse(execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(body), node + p], { encoding: 'utf8' }))
  const amt = BigInt(amount)
  const xonly = _hexToBytes(owner.pk)
  const ownerAddr = btc.p2tr(xonly, undefined, NETWORKS[bnet]).address
  const ownScriptHex = scriptOfAddress(ownerAddr, bnet)
  const ownScript = _hexToBytes(ownScriptHex)
  const POT = jget('/api/kraynet/bridge/params').pot

  // fund OWNER with EXACTLY amt of the rune + a sats utxo for postage/fee
  const sent = JSON.parse(ord('send', '--fee-rate', '1', ownerAddr, `${amt}:${runeName}`))
  mine(1); sync()
  const rdec = JSON.parse(bc('getrawtransaction', sent.txid, 'true'))
  const runeVout = rdec.vout.findIndex((o) => (o.scriptPubKey?.hex || '').toLowerCase() === ownScriptHex)
  const runeSats = BigInt(Math.round(rdec.vout[runeVout].value * 1e8))
  const fundTxid = bc('sendtoaddress', ownerAddr, '0.00100000')
  mine(1); sync()
  const fdec = JSON.parse(bc('getrawtransaction', fundTxid, 'true'))
  const fundVout = fdec.vout.findIndex((o) => (o.scriptPubKey?.hex || '').toLowerCase() === ownScriptHex)
  const fundSats = BigInt(Math.round(fdec.vout[fundVout].value * 1e8))

  // DIVISIBILITY-CORRECT: `amt` is a DISPLAY amount to ord; the runestone edict is in BASE units. Never
  // assume the 10^div factor — read the TRUE base-unit result ord recorded at the rune output and move
  // exactly that. For a div-0 rune base == display, so this is identity; for divisible runes it is exact.
  const esc = String(runeName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const ordBaseUnits = (txid, vout) => {
    const raw = execFileSync('curl', ['-s', '-H', 'Accept: application/json', `http://127.0.0.1:8081/output/${txid}:${vout}`], { encoding: 'utf8' })
    const m = raw.match(new RegExp('"' + esc + '"\\s*:\\s*\\{\\s*"amount"\\s*:\\s*(\\d+)'))
    return m ? BigInt(m[1]) : 0n
  }
  const landed = ordBaseUnits(sent.txid, runeVout)

  // build the pot-deposit tx — OWNER's own utxos → pot(out0), runestone edict → out0, sats change → OWNER
  const [rb, rt] = rune.split(':').map(BigInt)
  const push = (h) => (h.length / 2).toString(16).padStart(2, '0') + h
  const runestoneHex = '6a5d' + push(Buffer.concat([TAG.Body, rb, rt, landed, 0n].map((n) => Buffer.from(encodeVarint(n)))).toString('hex'))
  const POT_VAL = 1000n, FEE = 400n
  const tx = new btc.Transaction({ allowUnknownOutputs: true, version: 2 })
  tx.addInput({ txid: sent.txid, index: runeVout, witnessUtxo: { script: ownScript, amount: runeSats }, tapInternalKey: xonly })
  tx.addInput({ txid: fundTxid, index: fundVout, witnessUtxo: { script: ownScript, amount: fundSats }, tapInternalKey: xonly })
  tx.addOutputAddress(POT, POT_VAL, NETWORKS[bnet])
  tx.addOutput({ script: _hexToBytes(runestoneHex), amount: 0n })
  tx.addOutputAddress(ownerAddr, runeSats + fundSats - POT_VAL - FEE, NETWORKS[bnet])
  tx.sign(owner.sk); tx.finalize()
  const depTxid = bc('sendrawtransaction', Buffer.from(tx.extract()).toString('hex'))
  mine(1); sync()
  const dep = jpost('/api/kraynet/rune/deposit', { runeId: rune, txid: depTxid })
  return { depTxid, dep, ownerAddr, changeVout: 2, landed }
}

/** The ONE canonical consolidation vault (federation guardians + the consolidation owner key). Its address
 *  is where every settlement's remainder (output 2) must go, and its keypair set can co-sign a pool payout. */
export function consolidationVault(net) {
  const f = federationParams(net)
  const con = devConsolidationKey()
  const vault = deriveVault({ ...f, depositor: con.pk, net: toBtcNet(net) })
  return {
    vault, params: { guardians: f.guardians, threshold: f.threshold, depositor: con.pk, timelock: f.timelock },
    ownerKey: con, address: vault.address,
    addr: btc.p2tr(_hexToBytes(con.pk), undefined, NETWORKS[toBtcNet(net)]).address,
  }
}
