#!/usr/bin/env node
/**
 * THE FOLDER — one breath of the TK-fold lane, end to end (Gate 3 tooling, NEVER consensus).
 *
 *   1. PULL    — GET /api/kraynet/lane: the proven pre state + the pending pool
 *   2. FOLD    — run the executable spec (tk-fold.ts) locally: canonical order, diffs, roots
 *   3. FORGE   — prove the same breath in the SP1 zkVM (Groth16 wrap) via apps/kray-fold
 *   4. LAND    — submit the fold-seal (proof + diffs) through the node's normal prepare/submit door
 *
 * The folder holds NO power: it cannot forge a transfer (the zkVM re-checks every BIP-340 signature),
 * cannot reorder (orderWindow is a theorem over sha256 of the signed bytes), cannot tamper the diffs
 * (diffsHash is a public input of the proof), and cannot replay (preRoot must chain). The worst a
 * hostile folder can do is fold NOTHING — and anyone else with this script can fold instead.
 *
 * Needs: Node 24+, the SP1 toolchain (`sp1up`) and a built forge (apps/kray-fold) — the HEAVY tools
 * live here by the validator-burden law; validators verify folds with the vendored WASM alone.
 *
 * env:
 *   KRAY_NODE       node url                     (default http://127.0.0.1:4477)
 *   KRAY_FOLDER_SK  32-byte hex secret key       (REQUIRED — the folder's own KRAY account, pays the act fee)
 *   KRAY_FORGE      path to apps/kray-fold       (default <repo>/apps/kray-fold)
 *   KRAY_FOLD_DRY   1 = fold + report, never forge/land (a rehearsal)
 *
 * Run `node scripts/folder/preflight.mjs` first — it proves THIS house holds 1 ₭
 * and is on THIS network. fold-once re-checks that BEFORE the forge so a second
 * house does not burn minutes of compute to learn it cannot pay.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { foldBreath } from '../../apps/kray-core/src/protocol/tk-fold.ts'
import { _generateKeyPair, _signKrayWallet, _hexToBytes, addressOf, toBtcNet } from '../../apps/kray-core/src/protocol/scheme.ts'
import { folderPreflight } from './preflight.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const NODE_URL = (process.env.KRAY_NODE || 'http://127.0.0.1:4477').replace(/\/$/, '')
const FORGE = process.env.KRAY_FORGE || join(HERE, '../../apps/kray-fold')
const DRY = process.env.KRAY_FOLD_DRY === '1'

// One retry on a transport error: the forge blocks this process for minutes, so the pooled
// keep-alive socket is long dead when we come back — the first write can EPIPE. The retry opens
// a fresh connection. Safe even for the submit POST: the reducer's nonce makes a double-landing
// impossible (the second copy refuses deterministically).
async function fetchFresh(p, init) {
  try { return await fetch(NODE_URL + p, init) }
  catch { await new Promise((r) => setTimeout(r, 250)); return fetch(NODE_URL + p, init) }
}
const jget = async (p) => (await fetchFresh(p)).json()
const jpost = async (p, body) => (await fetchFresh(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
const die = (m) => { console.error('✗ ' + m); process.exit(1) }

async function main() {
  console.log('\n╔═ THE FOLDER — one breath of the lane ═╗\n')

  // ── 1. PULL ──
  const head = await jget('/api/kraynet/head').catch(() => null)
  if (!head || !head.network) die(`the node at ${NODE_URL} did not answer /api/kraynet/head`)
  const network = head.network
  const lane = await jget('/api/kraynet/lane')
  if (!lane || !lane.ok) die('the node has no /api/kraynet/lane door — update it first')
  console.log(`  node ${NODE_URL} · network ${network} · lane root ${lane.laneRoot.slice(0, 16)}… · pending ${lane.pending.length}`)
  if (lane.pending.length === 0) { console.log('\n  nothing to fold — the pool is empty. ✓\n'); return }

  // ── 2. FOLD (the executable spec — the same mathematics the zkVM will prove) ──
  const pre = {
    balances: new Map(lane.pre.balances.map(([a, b]) => [a, BigInt(b)])),
    nonces: new Map(lane.pre.nonces),
  }
  const outcome = foldBreath(network, pre, lane.pending)
  if (outcome.preRoot !== lane.laneRoot) die(`the local fold's preRoot ${outcome.preRoot.slice(0, 16)}… does not match the node's lane root — the lane moved; pull again`)
  console.log(`  fold: ${outcome.applied.length} applied · ${outcome.refused.length} refused · ${outcome.deferred.length} deferred`)
  for (const r of outcome.refused) console.log(`    refused ${r.t.from.slice(0, 12)}…#${r.t.nonce}: ${r.reason}`)
  if (outcome.applied.length === 0) { console.log('\n  no transfer is applicable — nothing worth a proof. ✓\n'); return }
  console.log(`  postRoot ${outcome.postRoot.slice(0, 16)}… · diffsHash ${outcome.diffsHash.slice(0, 16)}…`)
  if (DRY) { console.log('\n  KRAY_FOLD_DRY=1 — rehearsal only, no forge, no landing. ✓\n'); return }

  // ── 2b. PREFLIGHT (Gate 3c) — any house, 1 ₭, THIS network. BEFORE the forge.
  const gate = await folderPreflight({ nodeUrl: NODE_URL, requireForge: true })
  if (!gate.ok) die('preflight HALT — ' + gate.errors.join('; '))
  console.log(`  folder house ${gate.from.slice(0, 12)}… holds ${gate.balance} ₭ — A folder, not THE folder`)

  // ── 3. FORGE (the SP1 zkVM proves the breath; expectations re-derived by the Rust twin inside) ──
  const sk = process.env.KRAY_FOLDER_SK
  if (!sk || !/^[0-9a-f]{64}$/i.test(sk)) die('KRAY_FOLDER_SK (32-byte hex) is required to land a fold-seal')
  const proofsDir = join(FORGE, 'proofs')
  mkdirSync(proofsDir, { recursive: true })
  const stamp = Date.now()
  const inputPath = join(proofsDir, `breath-${stamp}.json`)
  const artifactPath = join(proofsDir, `breath-${stamp}.groth16.json`)
  writeFileSync(inputPath, JSON.stringify({ network, pre: lane.pre, transfers: lane.pending }))
  console.log(`\n  forging the proof (SP1 → Groth16) — this is the folder's cost, minutes of compute…`)
  const t0 = Date.now()
  const forge = spawnSync('cargo', ['run', '--release', '--features', 'wrap', '--', '--prove', '--groth16', '--input', inputPath, '--save', artifactPath], {
    cwd: join(FORGE, 'script'),
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PATH: `${process.env.HOME}/.sp1/bin:${process.env.HOME}/.cargo/bin:/opt/homebrew/bin:${process.env.PATH}` },
  })
  if (forge.status !== 0 || !existsSync(artifactPath)) die('the forge failed — the breath was NOT landed (nothing was spent)')
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
  console.log(`  proof forged in ${((Date.now() - t0) / 1000).toFixed(0)}s`)

  // ── 4. LAND (the node's normal door; the reducer re-verifies everything) ──
  const secret = _hexToBytes(sk)
  const kp = _generateKeyPair(secret)
  const from = addressOf(kp.publicKeyHex, toBtcNet(network))
  const fields = {
    action: 'fold-seal', from,
    foldPre: outcome.preRoot, foldPost: outcome.postRoot, foldDiffsHash: outcome.diffsHash,
    foldDiffs: outcome.diffs, foldProof: artifact.proof, foldPublic: artifact.publicValues,
  }
  const prep = await jpost('/api/kraynet/prepare', fields)
  if (typeof prep.message !== 'string') die('prepare refused — ' + (prep.error || '?'))
  const sub = await jpost('/api/kraynet/submit', { ...fields, nonce: prep.nonce, publicKey: kp.publicKeyHex, signature: _signKrayWallet(prep.message, secret), scheme: 'kraywallet' })
  if (sub.error) die('the reducer refused the fold-seal — ' + sub.error)
  console.log(`  fold-seal LANDED — seq ${sub.seq} · cascade ${String(sub.cascadeRoot).slice(0, 16)}…`)

  const after = await jget('/api/kraynet/lane')
  console.log(`  lane root now ${after.laneRoot.slice(0, 16)}… · pending left ${after.pending.length}`)
  if (after.laneRoot !== outcome.postRoot) die('the node lane root does not match the proven postRoot — investigate before folding again')
  rmSync(inputPath, { force: true })
  console.log('\n═ the breath is consensus: transfers private to the proof, diffs on the journal, root in the cascade ═\n')
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))
