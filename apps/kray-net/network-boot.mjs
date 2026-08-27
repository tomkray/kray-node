/**
 * Writer / follower boot isolation — each Bitcoin network is its own universe.
 *
 * Signet lab and Bitcoin mainnet never share a journal, an RPC port, a pot
 * address, or a data directory. Mixing them is a silent fork. Fail closed.
 *
 *   import { assertWriterNetworkIsolation, assertFollowNetworkIsolation } from './network-boot.mjs'
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const KNOWN_NETS = ['main', 'signet', 'testnet', 'regtest']

const LAB_RPC_PORT = { regtest: 18454, signet: 38332 }

export function canonicalizeNet(input) {
  const raw = input == null || input === '' ? 'regtest' : String(input)
  const net = raw === 'mainnet' || raw === 'bitcoin' ? 'main' : raw
  if (!KNOWN_NETS.includes(net)) {
    throw new Error(
      `KRAY_NET="${input}" is not a network this node knows (main|mainnet|signet|testnet|regtest) — refusing to boot as a ghost chain`,
    )
  }
  return net
}

/** Default $KRAY_DATA leaf when the operator does not set one. Each universe has its own name. */
export function defaultDataDirName(net) {
  if (net === 'main') return 'data-main'
  if (net === 'signet') return 'data-signet'
  return 'data-lab'
}

export function rpcPortOf(url) {
  const raw = String(url || '').trim()
  if (!raw) return 0
  try {
    const u = new URL(raw)
    if (u.port) return parseInt(u.port, 10)
    return u.protocol === 'https:' ? 443 : 80
  } catch {
    return 0
  }
}

function pathLooksLikeSignetLab(dataDir) {
  const parts = String(dataDir || '').replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean)
  return parts.some((seg) => seg === 'signet' || seg === 'data-signet' || seg.startsWith('data-signet'))
}

function pathLooksLikeRegtestLab(dataDir) {
  const parts = String(dataDir || '').replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean)
  return parts.some((seg) => seg === 'data-lab' || seg === 'data-v2')
}

function defaultIo() {
  return { existsSync, readFileSync }
}

/**
 * Refuse a writer that would breathe the wrong chain or sit on a foreign journal.
 * @param {{ net: string, dataDir: string, btcRpc?: string, ordUrl?: string, potAddress?: string, trustedDev?: boolean }} opts
 */
export function assertWriterNetworkIsolation(opts, io = defaultIo()) {
  const net = opts.net
  const dataDir = opts.dataDir || ''
  const btcRpc = String(opts.btcRpc || '').trim()
  const ordUrl = String(opts.ordUrl || '').trim()
  const potAddress = String(opts.potAddress || '').trim()
  const trustedDev = !!opts.trustedDev

  if (net === 'main') {
    if (trustedDev) {
      throw new Error('kraynet-boot: KRAY_TRUSTED_DEV=1 is refused on mainnet — a production writer has no faucet')
    }
    if (!btcRpc) {
      throw new Error('kraynet-boot: MAINNET requires KRAY_BTC_RPC — refusing the regtest default :18454')
    }
    const port = rpcPortOf(btcRpc)
    if (port === LAB_RPC_PORT.regtest) {
      throw new Error('kraynet-boot: MAINNET refuses Bitcoin RPC on :18454 (that is regtest)')
    }
    if (port === LAB_RPC_PORT.signet) {
      throw new Error('kraynet-boot: MAINNET refuses Bitcoin RPC on :38332 (that is Signet)')
    }
    if (!ordUrl) {
      throw new Error('kraynet-boot: MAINNET requires KRAY_ORD_URL — refusing to invent a local indexer')
    }
    if (pathLooksLikeSignetLab(dataDir)) {
      throw new Error('kraynet-boot: MAINNET refuses a Signet data directory — genesis must be empty and separate')
    }
    if (pathLooksLikeRegtestLab(dataDir)) {
      throw new Error('kraynet-boot: MAINNET refuses a regtest lab directory (data-lab / data-v2) — genesis must be empty and separate')
    }
    if (!potAddress) {
      throw new Error('kraynet-boot: MAINNET requires KRAY_POT_ADDRESS (a bc1… bakery, never the Signet tb1… vault)')
    }
    if (potAddress.startsWith('tb1') || potAddress.startsWith('bcrt1')) {
      throw new Error('kraynet-boot: MAINNET refuses a Signet/regtest pot address — mint a new mainnet pot; never reuse the lab vault')
    }
    if (!potAddress.startsWith('bc1')) {
      throw new Error('kraynet-boot: MAINNET pot must be a mainnet bc1 address')
    }
  }

  if (net === 'signet' && potAddress.startsWith('bc1') && !potAddress.startsWith('bcrt1')) {
    throw new Error('kraynet-boot: SIGNET refuses a mainnet (bc1) pot address — that vault is a different universe')
  }

  for (const other of KNOWN_NETS) {
    if (other === net) continue
    const journal = join(dataDir, `kraynet-journal-${other}.jsonl`)
    if (io.existsSync(journal)) {
      throw new Error(
        `kraynet-boot: ${net} writer refuses a directory that already holds kraynet-journal-${other}.jsonl — each network is its own universe`,
      )
    }
  }
}

/**
 * Refuse a follower that would pour one public history into the other network's folder.
 * @param {{ from: string, dir: string, writerNetwork: string }} opts
 */
export function assertFollowNetworkIsolation(opts, io = defaultIo()) {
  const from = String(opts.from || '').toLowerCase()
  const dir = opts.dir || ''
  const writerNetwork = opts.writerNetwork
  if (writerNetwork === 'main' && from.includes('signet.kray.network')) {
    throw new Error('kraynet-follow: writer advertised main but --from is the Signet lab — refusing to mix universes')
  }
  if (writerNetwork === 'signet' && (from.includes('www.kray.network') || /https?:\/\/kray\.network(?:\/|$)/.test(from))) {
    throw new Error('kraynet-follow: writer advertised signet but --from is the mainnet name — refusing to mix universes')
  }

  const currentPath = join(dir, 'CURRENT')
  if (io.existsSync(currentPath)) {
    let ptr = ''
    try { ptr = String(io.readFileSync(currentPath, 'utf8')) } catch { /* pointer is convenience */ }
    if (writerNetwork === 'main' && /node-signet|journal-signet/.test(ptr)) {
      throw new Error('kraynet-follow: this folder already holds a Signet replica — use follower-main for Bitcoin mainnet')
    }
    if (writerNetwork === 'signet' && /node-main|journal-main/.test(ptr)) {
      throw new Error('kraynet-follow: this folder already holds a mainnet replica — use ./follower for Signet')
    }
  }

  for (const other of KNOWN_NETS) {
    if (other === writerNetwork) continue
    if (io.existsSync(join(dir, `kraynet-journal-${other}.jsonl`))) {
      throw new Error(
        `kraynet-follow: ${writerNetwork} replica refuses a folder that already holds kraynet-journal-${other}.jsonl`,
      )
    }
  }
}

export function applyWriterIsolationOrDie(opts) {
  try {
    assertWriterNetworkIsolation(opts)
  } catch (e) {
    console.error('✗ ' + (e && e.message ? e.message : e))
    process.exit(1)
  }
}
