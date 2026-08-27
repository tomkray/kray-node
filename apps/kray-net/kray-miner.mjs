// KRAYNET GUARDIAN MINER — prove your presence, earn the network's fees.
//
// A guardian runs this to MINE beats: it fetches the current Bitcoin-revealed beacon, spends real hashes to
// find the best nonce for THIS block (bound to the beacon + your own address, so nobody can pre-grind, copy
// or replay it), signs the submission with your key, and posts it. The node verifies the PoW + the signature
// and gathers your presence; at each seal it pays the fee pool across the validators by PROVEN work, linearly
// (sybil-neutral). More hashes → more work → more reward, exactly like Bitcoin's own hashrate share.
//
//   KRAY_MINER_SK=<32-byte hex seed>  node apps/kray-net/kray-miner.mjs [nodeUrl]
//
// The seed is the guardian's key (NEVER leaves this process). Without one it mines under a throwaway demo
// identity. Env: KRAY_MINE_BUDGET (hashes/beat, default 60000), KRAY_MINE_MS (ms/beat, default 4000),
// KRAY_MINE_TICKS (stop after N beats; default: run forever).
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { mineBeat } from '../kray-core/src/economics/beat-pow.ts'
import { addressOf, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes } from '../kray-core/src/protocol/scheme.ts'
import { buildCustodyClaim, custodyToHex } from '../kray-core/src/economics/custody.ts'

const NODE = (process.argv[2] || process.env.KRAY_NODE || 'http://localhost:4477').replace(/\/+$/, '')
const seedHex = (process.env.KRAY_MINER_SK && /^[0-9a-f]{64}$/i.test(process.env.KRAY_MINER_SK))
  ? process.env.KRAY_MINER_SK
  : createHash('sha256').update(process.env.KRAY_MINER_SK || 'kray-demo-miner').digest('hex')   // seed a demo identity
const sk = _hexToBytes(seedHex)
const { publicKeyHex } = _generateKeyPair(sk)
const BUDGET = Number(process.env.KRAY_MINE_BUDGET || 60000)
const EVERY = Number(process.env.KRAY_MINE_MS || 4000)
const TICKS = process.env.KRAY_MINE_TICKS ? Number(process.env.KRAY_MINE_TICKS) : Infinity
const ATLAS_DIR = process.env.KRAY_ATLAS_DIR || join(process.cwd(), 'guardian-atlas')

const get = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => null)
const ov = await get('/api/kraynet/overview')
const net = (ov && ov.network) || 'signet'
const address = addressOf(publicKeyHex, toBtcNet(net))

// THE ATLAS A MASTER GUARDIAN KEEPS — download every inscribed content once and hold the bytes on disk. Custody
// is then PROVEN each seal against these bytes (address-salted, beacon-fresh), lifting the reward toward 3×. A
// guardian that holds nothing still mines the base 1× — custody only ever ADDS, and a wrong byte proves nothing.
async function syncAtlas() {
  const a = await get('/api/kraynet/atlas')
  if (!a || !Array.isArray(a.contents)) return { contents: [], bytesOf: () => null }
  if (a.contents.length && !existsSync(ATLAS_DIR)) mkdirSync(ATLAS_DIR, { recursive: true })
  let pulled = 0
  for (const h of a.contents) {
    if (!/^[0-9a-f]{64}$/.test(h)) continue
    const p = join(ATLAS_DIR, h)
    if (existsSync(p)) continue   // already held — hold it, don't re-stream it
    try {
      const r = await fetch(NODE + '/content/' + h)
      if (!r.ok) continue
      const buf = Buffer.from(await r.arrayBuffer())
      // VERIFY BEFORE GUARDING — the hash is consensus (journaled at inscribe); bytes that do not hash to it
      // are junk a lying server fed us, and guarding junk proves nothing. Refused, retried next sync.
      if (createHash('sha256').update(buf).digest('hex') !== h) { console.warn(`   ⚠ atlas: served bytes for ${h.slice(0, 12)}… do NOT match the journaled hash — junk refused`); continue }
      writeFileSync(p, buf); pulled++
    } catch { /* retry next sync */ }
  }
  if (pulled) console.log(`   📦 atlas: pulled ${pulled} content(s) — now guarding ${a.contents.length}`)
  return { contents: a.contents, bytesOf: (h) => { try { const p = join(ATLAS_DIR, h); return existsSync(p) ? new Uint8Array(readFileSync(p)) : null } catch { return null } } }
}
let atlas = await syncAtlas()

console.log(`⛏  KRAYNET miner — ${address}`)
console.log(`   on ${net} · node ${NODE} · ${BUDGET} hashes/beat${atlas.contents.length ? ` · 🛡 custody ON, guarding ${atlas.contents.length} (${ATLAS_DIR})` : ' · custody idle (empty atlas)'}`)

let done = 0
async function tick() {
  if (done > 0 && done % 20 === 0) atlas = await syncAtlas()   // a new inscription joins the atlas — keep guarding it
  const ch = await get('/api/kraynet/beat/challenge')
  if (!ch || !ch.beacon) { console.log('   … no beacon yet (node offline or bitcoind unreachable)'); return }
  const beat = mineBeat(ch.beacon, address, ch.block, BUDGET)   // spend real hashes; keep the best nonce
  if (!beat) return
  const msg = `kray.beat.submit.v1|${net}|${ch.beacon}|${address}|${ch.block}|${beat.nonce}|${beat.zeros}`
  // prove the atlas we actually hold (address-salted, this-beacon) — omitted when there is nothing to guard
  const custody = atlas.contents.length ? custodyToHex(buildCustodyClaim(ch.beacon, address, atlas)) : undefined
  const r = await fetch(NODE + '/api/kraynet/beat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, beacon: ch.beacon, block: ch.block, nonce: beat.nonce, zeros: beat.zeros, publicKey: publicKeyHex, signature: _signKrayWallet(msg, sk), scheme: 'kraywallet', ...(custody ? { custody } : {}) }),
  }).then((x) => x.json()).catch(() => null)
  if (r && r.ok) console.log(`   ⚡ block #${ch.block} · ${beat.zeros} leading zeros · span work ${r.spanWork} · ${r.blocks} block(s) held${r.custodyHits ? ` · 🛡 ${r.custodyHits}/${8} custody proven` : ''}`)
  else console.log(`   beat refused: ${(r && r.error) || 'no response'}`)
  if (++done >= TICKS) { const pr = await get('/api/kraynet/presence'); console.log(`   done — presence: ${pr ? pr.validators.length : '?'} validator(s), pool ${pr ? pr.pool : '?'} ₭`); process.exit(0) }
}
await tick()
if (TICKS !== 1) setInterval(() => { tick().catch(() => {}) }, EVERY)
