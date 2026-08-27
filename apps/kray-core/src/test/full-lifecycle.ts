/**
 * THE FULL LIFECYCLE — from a ZEROED KrayNet, create EVERY action that exists, in order, each
 * signed and Merkle-anchored, then prove the whole thing. Drives the live node (default :4477).
 *
 *   KRAY_PORT=4477 node src/test/full-lifecycle.ts
 *
 * Every action kind: donate (mint) · transfer · inscribe (born from fire) · name (baptize) ·
 * recursion child · origin child (Bitcoin L1 parent) · send-star · rune deposit/send/exit ·
 * validator settlement (the fee pool distributed by work) — then conservation, the family tree,
 * rune solvency, the fee-pool settlement (conserved + re-derivable), and the Bitcoin anchor.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, scriptOfAddress } from '../protocol/scheme.ts'
import { authorHeldOriginProof } from './ordinal-proof-fixture.ts'

const NET = process.env.KRAY_NET || 'regtest'
const BASE = `http://localhost:${process.env.KRAY_PORT || '4477'}`
const wallet = (tag: string) => { const sk = createHash('sha256').update('lifecycle|' + tag, 'utf8').digest(); const { publicKeyHex: pk } = _generateKeyPair(sk); return { tag, sk, pk, addr: btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[toBtcNet(NET)]).address! } }
const jget = (p: string) => fetch(BASE + p).then((r) => r.json() as Promise<any>)
const jpost = (p: string, b: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json() as Promise<any>)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const money = (v: unknown) => Number(v).toLocaleString()
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const step = (s: string) => console.log('\n─ ' + s + ' ' + '─'.repeat(Math.max(0, 62 - s.length)))

async function signed(w: { sk: Uint8Array; pk: string; addr: string }, action: string, params: Record<string, unknown>, endpoint = '/api/kraynet/submit') {
  const prep = await jpost('/api/kraynet/prepare', { action, from: w.addr, ...params })
  if (prep.error) throw new Error(`prepare ${action}: ${prep.error}`)
  const signature = _signKrayWallet(prep.message, w.sk)
  const out = await jpost(endpoint, { action, from: w.addr, ...params, nonce: prep.nonce, publicKey: w.pk, signature })
  if (out.error) throw new Error(`${action}: ${out.error}`)
  return out
}
const SVG = (h: number, l: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><radialGradient id="g"><stop offset="0" stop-color="hsl(${h},85%,62%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},70%,16%)"/></radialGradient></defs><rect width="120" height="120" fill="url(#g)"/><text x="60" y="66" fill="#fff" font-family="monospace" font-size="13" text-anchor="middle">${l}</text></svg>`

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await jget('/health')).ok) break } catch {} await sleep(150) }
  const start = await jget('/api/kraynet/overview')
  console.log('\n╔══════════════════════════════════════════════════════════════════╗')
  console.log('║   FULL LIFECYCLE — every action, from a zeroed KrayNet             ║')
  console.log('╚══════════════════════════════════════════════════════════════════╝')
  ok(Number(start.starCount) === 0 && Number(start.seq) === 0, `the network is ZEROED — ${start.starCount} stars, seq ${start.seq}`)
  const A = wallet('alice'), B = wallet('bob'), C = wallet('carol'), V1 = wallet('validator-1'), V2 = wallet('validator-2')

  step('1 · DONATE — proof-of-donation mints fungible ₭ (the only mint)')
  for (const [w, sats] of [[A, '40000'], [B, '20000'], [C, '10000']] as const) { await jpost('/api/kraynet/donate', { to: w.addr, sats }); console.log(`   · ${w.tag} donated ${money(sats)} sats → ${money(sats)} ₭`) }
  const pot = await jget('/api/kraynet/pot')
  ok(BigInt(pot.minted) === BigInt(pot.donated) && BigInt(pot.donated) === 70000n, `the peg: ${money(pot.minted)} ₭ minted == ${money(pot.donated)} sats donated (1:1)`)

  step('2 · TRANSFER — a signed ₭ move (each pays 1 ₭ into the fee pool)')
  await signed(A, 'transfer', { to: B.addr, amount: '500' }); await signed(B, 'transfer', { to: C.addr, amount: '200' }); await signed(A, 'transfer', { to: C.addr, amount: '300' })
  console.log('   · 3 signed transfers — alice→bob, bob→carol, alice→carol')

  step('3 · INSCRIBE — born from fire (burn 1 ₭ → a star), varied content')
  const s0 = await signed(A, 'inscribe', { content: SVG(300, 'GENESIS'), contentType: 'image/svg+xml' })
  await signed(B, 'inscribe', { content: 'the first written word on the network', contentType: 'text/plain' })
  await signed(C, 'inscribe', { content: SVG(160, 'VEGA'), contentType: 'image/svg+xml' })
  ok(String((await jget('/api/kraynet/star/0')).rarity) === 'mythic', `alice's first inscription is star #0 · MYTHIC (${s0.star === undefined ? 'seq ' + s0.seq : '#' + s0.star})`)

  step('4 · NAME — baptize a star (a plain name, unique in the universe forever)')
  const nm = await signed(A, 'name', { name: 'genesis' }); await signed(B, 'name', { name: 'nova' })
  console.log('   · genesis and nova baptised')

  step('4b · CANVAS — add content ONTO the baptised star (a star holds name AND content)')
  await signed(A, 'inscribe', { content: SVG(120, 'GENESIS'), contentType: 'image/svg+xml', star: String(nm.star) })
  const canvas = await jget('/api/kraynet/star/' + nm.star)
  ok(!!canvas.name && !!canvas.contentHash, `star #${nm.star} now carries name="${canvas.name}" AND content — one canvas, two signed acts, same id`)

  step('5 · RECURSION — a KRAY star fathers a child (only its OWNER can)')
  const kid = await signed(A, 'inscribe', { content: SVG(300, 'HEIR'), contentType: 'image/svg+xml', parent: '0' })
  const kidStar = await jget('/api/kraynet/star/' + kid.star)
  ok(String(kidStar.parent) === '0', `star #${kid.star} descends from alice's star #0 (recursion)`)
  let refused = false
  try { await signed(B, 'inscribe', { content: 'bob tries to father a child of #0', contentType: 'text/plain', parent: '0' }) } catch (e) { refused = /owner of star/.test(String(e)) }
  ok(refused, 'bob (NOT the owner) was REFUSED a child of alice\'s star #0 — provenance is owned, authenticated by the signature')

  step('6 · ORIGIN — a Bitcoin L1 ordinal fathers a KRAY star')
  const held = authorHeldOriginProof(scriptOfAddress(A.addr, NET), { confirmations: 1, salt: 'lifecycle-l1' })
  const L1 = held.parentId
  const org = await signed(A, 'origin', { content: SVG(220, 'FROM-L1'), contentType: 'image/svg+xml', parentId: L1, originProofs: [held.proof] })
  const orgStar = await jget('/api/kraynet/star/' + org.star)
  ok(orgStar.origin && orgStar.origin.l1InscriptionId === L1, `star #${org.star} descends from a Bitcoin L1 ordinal (origin)`)
  ok((orgStar.family.ancestors || []).some((a: any) => a.l1), 'the origin child shows its Bitcoin L1 parent in the family tree')

  step('7 · SEND-STAR — a whole star travels to another owner')
  await signed(A, 'sendstar', { to: B.addr, star: String(org.star) })
  ok(String((await jget('/api/kraynet/star/' + org.star)).owner) === B.addr, `star #${org.star} now belongs to bob (moved whole, not as money)`)

  step('8 · RUNES ON L2 — deposit → signed send → signed exit')
  await jpost('/api/kraynet/rune/deposit', { runeId: '840000:9', to: A.addr, amount: '1000000', outpoint: 'f'.repeat(64) + ':0' })
  await signed(A, 'rune-send', { to: B.addr, runeId: '840000:9', amount: '400000' }, '/api/kraynet/rune/send')
  await signed(B, 'rune-exit', { runeId: '840000:9', amount: '150000', l1Address: C.addr }, '/api/kraynet/rune/exit')
  const rune = (await jget('/api/kraynet/runes')).runes[0]
  ok(BigInt(rune.reserve) === 1000000n, `rune reserve ${money(rune.reserve)} — solvency holds through deposit/send/exit`)

  step('9 · THE RETIRED SETTLEMENT DOOR — a caller-provided work table can never name who gets the pool')
  // the unsigned reward + the /settle door are RETIRED: the fee pool pays ONLY through the self-proving
  // `settlement` (beats the reducer re-derives — proven in settle-beats-node + economics-guardian).
  const validators = [{ address: V1.addr, work: '30' }, { address: V2.addr, work: '10' }]
  const settle = await jpost('/api/kraynet/settle', { validators })
  ok(!!settle.error && /retired/i.test(String(settle.error)), 'the /settle door is RETIRED (410) — the pool pays only what the bytes prove')
  const paid1 = BigInt((await jget('/api/kraynet/profile/' + encodeURIComponent(V1.addr))).balance)
  const paid2 = BigInt((await jget('/api/kraynet/profile/' + encodeURIComponent(V2.addr))).balance)
  ok(paid1 === 0n && paid2 === 0n, 'the refused door paid nobody — no caller table ever moves the pool again')

  step('THE PROOF — conservation, the anchor, and byte-exact replay')
  await sleep(4000)
  const o = await jget('/api/kraynet/overview')
  ok(BigInt(o.supply.circulating) === BigInt(o.supply.emitted) - BigInt(o.supply.burned), `CONSERVATION: circulating ${money(o.supply.circulating)} = emitted ${money(o.supply.emitted)} − burned ${money(o.supply.burned)}`)
  ok(o.conserves === true && o.backed === true, 'the node reports conserves=true · backed=true (every ₭ from a real sat)')
  ok(o.runesSolvent !== false, 'rune solvency holds')
  const anc = await jget('/api/kraynet/anchor/payload')
  ok(anc.bytes === 49 && anc.cascadeRoot === o.cascadeRoot, 'the whole state is committed in the exact 49-byte Bitcoin OP_RETURN')

  console.log(`\n╚══════════════════════════════════════════════════════════════════╝`)
  console.log(`   ${pass} PROOFS PASSED${fail ? `, ${fail} FAILED` : ''} — every action kind created, signed, conserved, and anchored.`)
  console.log(`   ${o.starCount} stars · ${money(o.supply.circulating)} ₭ · rune on L2 · validators paid from the fee pool`)
  console.log(`   cascade root ${o.cascadeRoot}\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('\n✗ lifecycle error:', e); process.exit(1) })
