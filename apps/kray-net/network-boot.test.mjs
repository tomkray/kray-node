/**
 * Isolation proofs — Signet and mainnet never share a journal, RPC, pot, or folder.
 *   node apps/kray-net/network-boot.test.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalizeNet,
  defaultDataDirName,
  rpcPortOf,
  assertWriterNetworkIsolation,
  assertFollowNetworkIsolation,
} from './network-boot.mjs'

const EXAMPLE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'networks', 'mainnet', 'node.env.example')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const refuses = (fn, re, m) => {
  try { fn(); ok(false, m + ' — did NOT refuse') }
  catch (e) { const msg = e instanceof Error ? e.message : String(e); ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
const allows = (fn, m) => {
  try { fn(); ok(true, m) }
  catch (e) { ok(false, m + ' — refused: ' + (e instanceof Error ? e.message : e)) }
}

const emptyFs = {
  existsSync: () => false,
  readFileSync: () => { throw new Error('no file') },
}
const fsWith = (files) => ({
  existsSync: (p) => {
    const key = String(p).replace(/\\/g, '/')
    if (files.has(key)) return true
    for (const k of files.keys()) if (key.endsWith(k) || k.endsWith(key)) return true
    return false
  },
  readFileSync: (p) => {
    const key = String(p).replace(/\\/g, '/')
    if (files.has(key)) return files.get(key)
    for (const [k, v] of files) if (key.endsWith(k) || k.endsWith(key)) return v
    throw new Error('missing ' + p)
  },
})

const mainOk = {
  net: 'main',
  dataDir: '/tmp/kray-data-main',
  btcRpc: 'http://127.0.0.1:8332',
  ordUrl: 'http://127.0.0.1:80',
  potAddress: 'bc1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  trustedDev: false,
}

console.log('\n╔═ NETWORK ISOLATION — Signet lab ≠ Bitcoin mainnet ═╗\n')

ok(canonicalizeNet('mainnet') === 'main' && canonicalizeNet('bitcoin') === 'main', 'mainnet/bitcoin alias to main')
ok(canonicalizeNet('signet') === 'signet' && canonicalizeNet('') === 'regtest', 'signet stays signet; empty is regtest')
refuses(() => canonicalizeNet('regtst'), /ghost chain/, 'a typo network is refused')
ok(defaultDataDirName('main') === 'data-main' && defaultDataDirName('signet') === 'data-signet' && defaultDataDirName('regtest') === 'data-lab', 'each universe has its own data folder name')
ok(rpcPortOf('http://127.0.0.1:18454') === 18454 && rpcPortOf('http://127.0.0.1:38332') === 38332, 'lab RPC ports parse')

allows(() => assertWriterNetworkIsolation(mainOk, emptyFs), 'a complete mainnet writer boots')
allows(
  () => assertWriterNetworkIsolation({ net: 'signet', dataDir: '/tmp/data-signet', btcRpc: 'http://127.0.0.1:38332', potAddress: 'tb1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' }, emptyFs),
  'a Signet writer with a tb1 pot boots',
)
allows(
  () => assertWriterNetworkIsolation({ net: 'regtest', dataDir: '/tmp/data' }, emptyFs),
  'regtest stays a lab — no mainnet gates',
)

refuses(() => assertWriterNetworkIsolation({ ...mainOk, trustedDev: true }, emptyFs), /TRUSTED_DEV/, 'mainnet refuses KRAY_TRUSTED_DEV=1')
refuses(() => assertWriterNetworkIsolation({ ...mainOk, btcRpc: '' }, emptyFs), /KRAY_BTC_RPC/, 'mainnet refuses the silent regtest RPC default')
refuses(() => assertWriterNetworkIsolation({ ...mainOk, btcRpc: 'http://127.0.0.1:18454' }, emptyFs), /18454/, 'mainnet refuses :18454 (regtest)')
refuses(() => assertWriterNetworkIsolation({ ...mainOk, btcRpc: 'http://127.0.0.1:38332' }, emptyFs), /38332/, 'mainnet refuses :38332 (Signet)')
refuses(() => assertWriterNetworkIsolation({ ...mainOk, ordUrl: '' }, emptyFs), /KRAY_ORD_URL/, 'mainnet refuses a guessed ord')
refuses(() => assertWriterNetworkIsolation({ ...mainOk, dataDir: '/tmp/apps/kray-net/data-signet' }, emptyFs), /Signet data directory/, 'mainnet refuses data-signet/')
refuses(() => assertWriterNetworkIsolation({ ...mainOk, dataDir: '/tmp/apps/kray-net/data-lab' }, emptyFs), /regtest lab directory/, 'mainnet refuses data-lab/')
refuses(() => assertWriterNetworkIsolation({ ...mainOk, dataDir: '/tmp/apps/kray-net/data-v2' }, emptyFs), /regtest lab directory/, 'mainnet refuses era data-v2/')
refuses(() => assertWriterNetworkIsolation({ ...mainOk, dataDir: '/tmp/apps/kray-net/data-signet-local' }, emptyFs), /Signet data directory/, 'mainnet refuses data-signet-local/')
refuses(() => assertWriterNetworkIsolation({ ...mainOk, dataDir: '/tmp/signet/data' }, emptyFs), /Signet data directory/, 'mainnet refuses a path under signet/')
refuses(() => assertWriterNetworkIsolation({ ...mainOk, potAddress: '' }, emptyFs), /KRAY_POT_ADDRESS/, 'mainnet refuses a writer with no bakery')
refuses(() => assertWriterNetworkIsolation({ ...mainOk, potAddress: 'tb1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' }, emptyFs), /Signet\/regtest pot/, 'mainnet refuses the Signet pot')
refuses(() => assertWriterNetworkIsolation({ ...mainOk, potAddress: 'bcrt1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' }, emptyFs), /Signet\/regtest pot/, 'mainnet refuses a regtest pot')
refuses(
  () => assertWriterNetworkIsolation({ net: 'signet', dataDir: '/tmp/data-signet', potAddress: mainOk.potAddress }, emptyFs),
  /mainnet \(bc1\) pot/,
  'Signet refuses a mainnet pot',
)
refuses(
  () => assertWriterNetworkIsolation(mainOk, fsWith(new Map([['kraynet-journal-signet.jsonl', 'x']]))),
  /journal-signet/,
  'mainnet refuses a folder that already holds the Signet journal',
)
refuses(
  () => assertWriterNetworkIsolation({ net: 'signet', dataDir: '/tmp/mixed' }, fsWith(new Map([['kraynet-journal-main.jsonl', 'x']]))),
  /journal-main/,
  'Signet refuses a folder that already holds the mainnet journal',
)

allows(
  () => assertFollowNetworkIsolation({ from: 'https://signet.kray.network', dir: '/tmp/follower', writerNetwork: 'signet' }, emptyFs),
  'Signet follow into an empty follower/ is allowed',
)
allows(
  () => assertFollowNetworkIsolation({ from: 'https://www.kray.network', dir: '/tmp/follower-main', writerNetwork: 'main' }, emptyFs),
  'mainnet follow into an empty follower-main/ is allowed',
)
refuses(
  () => assertFollowNetworkIsolation({ from: 'https://signet.kray.network', dir: '/tmp/x', writerNetwork: 'main' }, emptyFs),
  /Signet lab/,
  'follow refuses a main advertisement from the Signet URL',
)
refuses(
  () => assertFollowNetworkIsolation({ from: 'https://www.kray.network', dir: '/tmp/x', writerNetwork: 'signet' }, emptyFs),
  /mainnet name/,
  'follow refuses a signet advertisement from www.kray.network',
)
refuses(
  () => assertFollowNetworkIsolation(
    { from: 'https://www.kray.network', dir: '/tmp/follower', writerNetwork: 'main' },
    fsWith(new Map([['/tmp/follower/CURRENT', '/tmp/follower/run-1/node-signet\n']])),
  ),
  /already holds a Signet replica/,
  'follow refuses to pour mainnet into the Signet follower folder',
)
refuses(
  () => assertFollowNetworkIsolation(
    { from: 'https://signet.kray.network', dir: '/tmp/follower-main', writerNetwork: 'signet' },
    fsWith(new Map([['/tmp/follower-main/CURRENT', '/tmp/follower-main/run-1/node-main\n']])),
  ),
  /already holds a mainnet replica/,
  'follow refuses to pour Signet into the mainnet follower folder',
)

const recipe = readFileSync(EXAMPLE, 'utf8')
ok(/KRAY_NET=main\b/.test(recipe) && /KRAY_TRUSTED_DEV=0/.test(recipe) && /KRAY_VAULT_TIMELOCK=4320/.test(recipe),
  'mainnet recipe is organized (main, no faucet, genesis vault timelock) and is not ignition')

console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the two public networks cannot mix. ⛓₭\n`)
process.exit(fail ? 1 : 0)
