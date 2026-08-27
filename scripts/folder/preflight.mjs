#!/usr/bin/env node
/**
 * THE FOLDER PREFLIGHT — any house, one role, never a privilege (Gate 3c).
 *
 *   KRAY_FOLDER_SK=<64-hex> node scripts/folder/preflight.mjs
 *   KRAY_FOLDER_SK=… KRAY_NODE=http://127.0.0.1:4477 node scripts/folder/preflight.mjs
 *
 * Confront THIS key against THIS node BEFORE a forge (minutes of compute).
 * Exit 0 = you may fold-once. Exit 2 = hard stop.
 * Never prints the secret. Never names a privileged folder address.
 *
 * The folder is a ROLE: any citizen with 1 ₭ and this script may land a breath.
 * A second house is not a second writer. Worst hostile folder: folds nothing.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _generateKeyPair, _hexToBytes, addressOf, toBtcNet, isAddressOnNetwork } from '../../apps/kray-core/src/protocol/scheme.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_FORGE = join(HERE, '../../apps/kray-fold')

/**
 * @param {{ nodeUrl?: string, sk?: string, forgeDir?: string, requireForge?: boolean }} opts
 * @returns {Promise<{ ok: boolean, errors: string[], warnings: string[], from?: string, network?: string, balance?: string, pending?: number }>}
 */
export async function folderPreflight(opts = {}) {
  const errors = []
  const warnings = []
  const nodeUrl = String(opts.nodeUrl || process.env.KRAY_NODE || 'http://127.0.0.1:4477').replace(/\/$/, '')
  const sk = String(opts.sk ?? process.env.KRAY_FOLDER_SK ?? '')
  const forgeDir = opts.forgeDir || process.env.KRAY_FORGE || DEFAULT_FORGE
  const requireForge = opts.requireForge !== false && process.env.KRAY_FOLD_DRY !== '1'

  if (!/^[0-9a-f]{64}$/i.test(sk)) {
    return { ok: false, errors: ['KRAY_FOLDER_SK must be a 32-byte hex key (the folder\'s OWN account — it pays the eternal 1 ₭). Never a writer vault key.'], warnings }
  }

  let pk
  try {
    pk = _generateKeyPair(_hexToBytes(sk)).publicKeyHex
  } catch {
    return { ok: false, errors: ['KRAY_FOLDER_SK does not decode as a key — refused'], warnings }
  }

  let head
  try {
    head = await fetch(nodeUrl + '/api/kraynet/head').then((r) => r.json())
  } catch (e) {
    return { ok: false, errors: [`the node at KRAY_NODE did not answer /api/kraynet/head (${e instanceof Error ? e.message : e})`], warnings }
  }
  if (!head || !head.network) return { ok: false, errors: ['the node did not name its network — refused'], warnings }
  const network = String(head.network)
  const net = toBtcNet(network)
  const from = addressOf(pk, net)
  if (!isAddressOnNetwork(from, net)) {
    errors.push(`this key's address is not a ${network} address — a ${network} node writes only for its own network`)
  }

  let prof
  try {
    prof = await fetch(nodeUrl + '/api/kraynet/profile/' + encodeURIComponent(from)).then((r) => r.json())
  } catch (e) {
    return { ok: false, errors: [`profile door failed (${e instanceof Error ? e.message : e})`], warnings, from, network }
  }
  const balance = String(prof.balance ?? '0')
  let bal
  try { bal = BigInt(balance) } catch { bal = -1n }
  if (bal < 1n) {
    errors.push(`this house holds ${balance} ₭ — a fold-seal costs the eternal 1 ₭ (A2). Fund THIS address, then fold. There is no official folder to pay for you.`)
  }

  let lane
  try {
    lane = await fetch(nodeUrl + '/api/kraynet/lane').then((r) => r.json())
  } catch (e) {
    return { ok: false, errors: [`the lane door failed (${e instanceof Error ? e.message : e}) — this node cannot fold`], warnings, from, network, balance }
  }
  if (!lane || lane.ok !== true) {
    errors.push('the node has no /api/kraynet/lane door — update the node before folding')
  }
  const pending = Array.isArray(lane?.pending) ? lane.pending.length : 0
  if (pending === 0) warnings.push('the pool is empty — fold-once will exit without forging (nothing to land)')

  if (requireForge) {
    const scriptDir = join(forgeDir, 'script')
    if (!existsSync(scriptDir)) {
      errors.push('the forge is not on this disk (apps/kray-fold/script). Verifiers do not need it; a folder does. Build the forge or point KRAY_FORGE at it.')
    }
  }

  return { ok: errors.length === 0, errors, warnings, from, network, balance, pending }
}

function line(ok, msg) { console.log((ok ? '  ✓ ' : '  ✗ ') + msg) }

async function main() {
  console.log('\n╔═ THE FOLDER PREFLIGHT — any house may fold; none is official ═╗\n')
  const r = await folderPreflight({ requireForge: !process.argv.includes('--door') })
  if (r.from) line(true, `this house: ${r.from.slice(0, 12)}…${r.from.slice(-6)}  (${r.network || '?'})`)
  if (r.balance != null) line(BigInt(r.balance || '0') >= 1n, `balance ${r.balance} ₭ — the seal costs exactly 1`)
  if (r.pending != null) line(true, `lane pool pending ${r.pending} (mempool, not consensus)`)
  for (const w of r.warnings) console.log('  · ' + w)
  for (const e of r.errors) line(false, e)
  if (r.ok) {
    console.log('\n  you are A folder, not THE folder. Any other key with 1 ₭ may fold instead.')
    console.log('  next: node scripts/folder/fold-once.mjs\n')
    process.exit(0)
  }
  console.log('\n  HALT — do not forge. A failed preflight saves minutes of compute and 0 ₭.\n')
  process.exit(2)
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isCli) main()
