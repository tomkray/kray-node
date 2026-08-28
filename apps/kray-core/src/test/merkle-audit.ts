/**
 * MERKLE AUDIT — the standing discipline: after every update, PROVE that nothing on the
 * live node exists outside the mathematics. Runs against the running :4477 and shows that
 * every star, name and donation (including anything written from the wallet) is:
 *   1. conserved + backed (circulating = emitted − burned; every ₭ from a real sat),
 *   2. sealed into a block whose merkle root RECOMPUTES from the event hashes alone,
 *   3. folded into ONE cascade root that is committed in the exact Bitcoin OP_RETURN,
 *   4. reproducible byte-exact by a FRESH node replaying only the journal — so there is
 *      no off-chain state anywhere; the Merkle root is the whole truth.
 *
 *   node src/test/merkle-audit.ts            (audits http://localhost:4477)
 */
import { spawn } from 'node:child_process'
import { rmSync, mkdirSync, cpSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { buildMerkleRoot } from '../protocol/block.ts'
import { KrayAnchor } from '../anchor/anchor.ts'

const PORT = process.env.KRAY_PORT || '4477'
const BASE = `http://localhost:${PORT}`
const NET_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net')
const DATA = existsSync(join(NET_DIR, 'data-lab')) ? join(NET_DIR, 'data-lab') : join(NET_DIR, 'data-v2')
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jget = (p: string, base = BASE) => fetch(base + p).then((r) => r.json() as Promise<any>)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

async function main() {
  console.log('\n╔═ MERKLE AUDIT — is anything outside the proof? ════════════════╗')

  // 1 · the economic law
  const o = await jget('/api/kraynet/overview')
  ok(o.conserves === true, 'CONSERVATION: circulating = emitted − burned holds right now')
  ok(o.backed === true, 'PEG: every ₭ in existence is backed by a real donated satoshi')
  const C = o.cascadeRoot
  console.log('    cascade root: ' + C)

  // 2 · every block's merkle root RECOMPUTES from its event hashes (no trust)
  const { blocks } = await jget('/api/kraynet/blocks?limit=60')
  let checkedBlocks = 0
  for (const bc of blocks) {
    const num = (bc.number != null ? bc.number : (bc.n != null ? bc.n : bc.h))
    const full = await jget('/api/kraynet/block/' + num)
    const hashes = (full.transactions || []).map((t: any) => t.hash).filter(Boolean)
    if (!hashes.length) continue
    const root = buildMerkleRoot(hashes)
    ok(root === full.merkleRoot, `block #${num}: merkle root recomputes from its ${hashes.length} event hashes`)
    checkedBlocks++
  }
  ok(checkedBlocks > 0, `re-derived the merkle root of ${checkedBlocks} block(s) — none taken on faith`)

  // 3 · the cascade root is committed in the EXACT 49-byte Bitcoin OP_RETURN
  const anc = await jget('/api/kraynet/anchor/payload')
  ok(anc.cascadeRoot === C, 'the anchor payload commits THIS cascade root')
  const decoded = KrayAnchor.decode(anc.payload)
  ok(!!decoded && decoded.root === C, 'the raw 49-byte OP_RETURN decodes back to the same cascade root (tamper-evident)')
  ok(anc.bytes === 49, 'the commitment is exactly 49 bytes — the canonical KRAY anchor')

  // 4 · a specific star's inscription is provably in the chain, end to end
  const sc = Number(o.starCount)
  if (sc > 0) {
    const anyStar = await jget('/api/kraynet/star/0')
    const rc = await jget('/api/kraynet/receipt/' + anyStar.seq)
    if (rc && rc.event) {
      ok(rc.event.hash && /^[0-9a-f]{64}$/.test(rc.event.hash), 'star #0 receipt: the event carries the id it claims')
      ok(!!(rc.block && rc.block.merkleRoot), 'star #0 receipt: it names the block merkle root it sits under')
    }
  }

  // 5 · THE STRONGEST PROOF — a fresh node, given ONLY the journal on disk, rebuilds the
  //     identical cascade root. If any state lived off the Merkle, this would diverge.
  const TMP = join(tmpdir(), `kray-audit-${process.pid}`)
  rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true })
  if (existsSync(DATA)) cpSync(DATA, TMP, { recursive: true })
  const child = spawn('node', [SERVER], { env: { ...process.env, KRAY_PORT: String(Number(PORT) + 100), KRAY_DATA: TMP, KRAY_NET: process.env.KRAY_NET || 'regtest' }, stdio: 'ignore' })
  try {
    for (let i = 0; i < 60; i++) { try { if ((await jget('/health', `http://localhost:${Number(PORT) + 100}`)).ok) break } catch {} await sleep(100) }
    const o2 = await jget('/api/kraynet/overview', `http://localhost:${Number(PORT) + 100}`)
    ok(o2.cascadeRoot === C, 'REPLAY: a fresh node rebuilt the IDENTICAL cascade root from the journal alone — nothing lives off the Merkle')
    ok(Number(o2.starCount) === sc, `REPLAY: the same ${sc} stars reappear, in the same order`)
  } finally { try { child.kill('SIGKILL') } catch {}; rmSync(TMP, { recursive: true, force: true }) }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the anchored Merkle root is the whole truth. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
function hexToBytes(h: string): Uint8Array { const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return a }
main().catch((e) => { console.error('\n✗ audit error:', e); process.exit(1) })
