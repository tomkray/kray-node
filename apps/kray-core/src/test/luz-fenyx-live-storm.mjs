/**
 * LUZ + FENYX — thousands of live acts on the regtest bench (:4477).
 *   node src/test/luz-fenyx-live-storm.mjs
 *
 * Seals KRC-77 on a new star, circulates luz, then lights Fenyx (burn → Ӿ)
 * and circulates Nyx. Pins conservation on the living journal. No --fresh.
 * Does not touch Signet.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'storm-' + Date.now().toString(36)
const SUPPLY = 100000n
const LUZ_SENDS = Number(process.env.STORM_LUZ || 2500)
const FENYX_SENDS = Number(process.env.STORM_FENYX || 1500)
const N = 6

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))

const id = (t) => {
  const s = nsha(new TextEncoder().encode('luz-fenyx-storm|' + t + '|' + TAG))
  const x = Buffer.from(schnorr.getPublicKey(s)).toString('hex')
  return {
    s, x, a: btc.p2tr(Buffer.from(x, 'hex'), undefined, NETWORKS[NET]).address,
    sign: (m) => Buffer.from(schnorr.sign(nsha(new TextEncoder().encode(m)), s)).toString('hex'),
    tag: t,
  }
}

async function act(who, body) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: who.a })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)), _prep: prep }
  const sub = await jpost('/api/kraynet/submit', {
    ...body, from: who.a, code: prep.code || body.code, nonce: prep.nonce, clock: prep.clock,
    publicKey: who.x, signature: who.sign(prep.message), scheme: 'kraywallet',
  })
  return { ...sub, _star: prep.star ?? sub.star }
}

async function chain() {
  const a = await jget('/api/kraynet/analytics')
  return { conserves: a.chain?.conserves === true, root: a.chain?.cascadeRoot, seq: a.chain?.events }
}

async function luzBook(star, wallets) {
  const face = await jget('/api/kraynet/star/' + star)
  let sum = 0n
  const rows = []
  for (const w of wallets) {
    const p = await jget('/api/kraynet/profile/' + encodeURIComponent(w.a))
    const row = (p.luz || []).find((h) => String(h.star) === String(star))
    const n = row ? BigInt(row.amount) : 0n
    sum += n
    rows.push(n)
  }
  return {
    supply: BigInt(face.luz?.supply || '0'),
    circulating: BigInt(face.luz?.circulating || '0'),
    name: face.luz?.name,
    sum,
    rows,
  }
}

async function nyxRows(wallets) {
  const rows = []
  let sum = 0n
  let tank = 0n
  for (const w of wallets) {
    const p = await jget('/api/kraynet/profile/' + encodeURIComponent(w.a))
    const n = BigInt(p.lights?.xSpendable || '0')
    rows.push(n)
    sum += n
    tank += BigInt(p.lights?.fireTank || '0')
  }
  return { sum, rows, tank }
}

function pickHolder(rows) {
  const idx = []
  for (let i = 0; i < rows.length; i++) if (rows[i] > 0n) idx.push(i)
  if (!idx.length) return undefined
  return idx[Math.floor(Math.random() * idx.length)]
}

function svgFace(label, hue) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img"><rect width="256" height="256" rx="18" fill="hsl(${hue} 58% 9%)"/><circle cx="128" cy="104" r="50" fill="none" stroke="hsl(${hue} 90% 68%)" stroke-width="5"/><path d="M128 68 L140 98 L172 98 L146 116 L156 146 L128 128 L100 146 L110 116 L84 98 L116 98 Z" fill="hsl(${hue} 92% 78%)"/><text x="128" y="214" text-anchor="middle" fill="hsl(${hue} 80% 88%)" font-size="13" font-family="ui-sans-serif,system-ui">${label}</text></svg>`
}

async function birthImageStar(who, label, hue, supply) {
  const born = await act(who, {
    action: 'inscribe',
    content: svgFace(label + ' ' + TAG, hue),
    contentType: 'image/svg+xml',
  })
  if (!born.ok || born._star == null) die('inscribe failed — ' + (born.error || ''))
  const star = String(born._star)
  const face = await jget('/api/kraynet/star/' + star)
  const ct = String(face.contentType || face.inscriptions?.[0]?.contentType || '')
  if (!ct.startsWith('image/')) die(`star #${star} is not image content (${ct || 'empty'})`)
  const sealed = await act(who, { action: 'contract', star, form: { kind: 'cut', supply: String(supply) } })
  if (!sealed.ok) die('seal failed — ' + (sealed.error || ''))
  return { star, contentType: ct, contentHash: face.contentHash }
}

async function main() {
  console.log('\n╔═ LUZ + FENYX LIVE STORM — thousands on :4477 ═╗\n')
  const health = await jget('/health')
  if (health.__down || !health.ok) die('lab :4477 is down')
  const before = await chain()
  ok(before.conserves, `lab conserves at seq ${before.seq}`)
  console.log(`   · starting seq ${before.seq}  root ${String(before.root).slice(0, 16)}…`)

  const W = Array.from({ length: N }, (_, i) => id('w' + i))
  const eve = id('eve')
  for (const w of [...W, eve]) {
    const mint = await jpost('/api/kraynet/donate', { to: w.a, sats: '4000' })
    if (!mint.ok) die('donate failed — ' + (mint.error || 'need KRAY_TRUSTED_DEV=1'))
  }
  ok(true, `funded ${N} citizens + Eve (4000 ₭ each)`)

  // ── LUZ / KRC-77 on IMAGE stars (two faces — byte-unique SVG) ──────────
  const a = await birthImageStar(W[0], 'LUZ', 42, SUPPLY)
  const b = await birthImageStar(W[1], 'LUZ2', 198, 7777n)
  const star = a.star
  ok(a.contentType.startsWith('image/'), `star #${a.star} content is ${a.contentType}`)
  ok(b.contentType.startsWith('image/'), `star #${b.star} content is ${b.contentType}`)
  ok(a.contentHash && b.contentHash && a.contentHash !== b.contentHash, 'two image hashes, two stars')
  let book = await luzBook(star, W)
  ok(book.name === 'Luz' && book.supply === SUPPLY && book.sum === SUPPLY && book.circulating === SUPPLY,
    `star #${star} sealed — ${SUPPLY} luz ✧ on the sealer, Σ = supply`)
  const twin = await luzBook(b.star, W)
  ok(twin.supply === 7777n && twin.sum === 7777n, `twin image star #${b.star} sealed 7777 ✧, Σ = supply`)
  const hop = await act(W[1], { action: 'cut-send', to: W[2].a, star: b.star, amount: '77' })
  ok(hop.ok === true, `twin book moved 77 ✧ (cut-send on the second image)`)
  const twinAfter = await luzBook(b.star, W)
  ok(twinAfter.sum === 7777n, 'twin Σ untouched after the hop')

  let sent = 0, refused = 0
  const t0 = Date.now()
  for (let i = 0; i < LUZ_SENDS; i++) {
    const fromI = pickHolder(book.rows)
    let toI = Math.floor(Math.random() * N)
    if (toI === fromI) toI = (toI + 1) % N
    const r = await act(W[fromI], { action: 'cut-send', to: W[toI].a, star, amount: '1' })
    if (r.ok) {
      sent++
      book.rows[fromI] -= 1n
      book.rows[toI] += 1n
    } else {
      refused++
    }
    if ((i + 1) % 100 === 0) {
      const eveTry = await act(eve, { action: 'cut-send', to: eve.a, star, amount: '1' })
      if (!eveTry.error && eveTry.ok) { ok(false, 'Eve stole luz at step ' + i); die('Eve broke the book') }
      refused++
      const live = await luzBook(star, W)
      const ch = await chain()
      if (live.sum !== SUPPLY || live.circulating !== SUPPLY || !ch.conserves) {
        die(`Luz broke at ${i + 1}: Σ=${live.sum} circ=${live.circulating} conserves=${ch.conserves}`)
      }
      book.rows = live.rows
      process.stdout.write(`   · luz ${i + 1}/${LUZ_SENDS}  sent ${sent}  Σ ${live.sum}  seq ${ch.seq}\n`)
    }
  }
  const luzMs = Date.now() - t0
  const luzEnd = await luzBook(star, W)
  const afterLuz = await chain()
  ok(luzEnd.sum === SUPPLY && luzEnd.circulating === SUPPLY, `after ${sent} luz sends, Σ still ${SUPPLY}`)
  ok(afterLuz.conserves, `₭ still conserves after the Luz storm (seq ${afterLuz.seq})`)
  ok(sent >= LUZ_SENDS - 5, `landed ${sent}/${LUZ_SENDS} luz sends in ${(luzMs / 1000).toFixed(1)}s`)

  const over = await act(W[0], { action: 'cut-send', to: W[1].a, star, amount: String(SUPPLY + 1n) })
  ok(!!over.error || over.ok !== true, 'over-supply still refused after the storm')
  const still = await luzBook(star, W)
  ok(still.sum === SUPPLY, 'over-supply left Σ untouched')

  // ── FENYX — ₭ dies, Ӿ remains, circulate Nyx ────────────────────────────
  // Living journal: two image inscribes + two law seals already burned ₭ → Ӿ on the sealers.
  // Pin the DELTA (A1 / 1:1), never an absolute 80 on a grow-only book.
  const burnAmt = 80n
  const xBefore = await nyxRows(W)
  const burned = await act(W[0], { action: 'burn', amount: String(burnAmt) })
  ok(burned.ok === true, `Fenyx lit — burned ${burnAmt} ₭ → ${burnAmt} Ӿ`)
  let xBook = await nyxRows(W)
  ok(xBook.sum === xBefore.sum + burnAmt, `Nyx Δ = ${xBook.sum - xBefore.sum} (1:1); Σ now ${xBook.sum} (name+seal already on the book)`)
  const xExpected = xBook.sum

  let xSent = 0
  const t1 = Date.now()
  for (let i = 0; i < FENYX_SENDS; i++) {
    const fromI = pickHolder(xBook.rows)
    if (fromI == null) break
    let toI = Math.floor(Math.random() * N)
    if (toI === fromI) toI = (toI + 1) % N
    const r = await act(W[fromI], { action: 'x-send', to: W[toI].a, amount: '1' })
    if (r.ok) {
      xSent++
      xBook.rows[fromI] -= 1n
      xBook.rows[toI] += 1n
    }
    if ((i + 1) % 100 === 0) {
      const eveTry = await act(eve, { action: 'x-send', to: eve.a, amount: '1' })
      if (!eveTry.error && eveTry.ok) { ok(false, 'Eve stole Nyx at step ' + i); die('Eve broke Fenyx') }
      const xLive = await nyxRows(W)
      const ch = await chain()
      if (xLive.sum !== xExpected || !ch.conserves) {
        die(`Fenyx broke at ${i + 1}: Nyx Σ=${xLive.sum} expected ${xExpected} conserves=${ch.conserves}`)
      }
      xBook.rows = xLive.rows
      process.stdout.write(`   · fenyx ${i + 1}/${FENYX_SENDS}  sent ${xSent}  Ӿ Σ ${xLive.sum}  seq ${ch.seq}\n`)
    }
  }
  const fenyxMs = Date.now() - t1
  const xEnd = await nyxRows(W)
  const afterAll = await chain()
  const luzFinal = await luzBook(star, W)
  ok(xEnd.sum === xExpected, `after ${xSent} Ӿ sends, Nyx Σ still ${xExpected}`)
  ok(luzFinal.sum === SUPPLY, `Luz Σ still ${SUPPLY} after the Fenyx storm — the two books did not mix`)
  ok(afterAll.conserves, `final conserves at seq ${afterAll.seq}`)
  ok(xSent >= FENYX_SENDS - 5, `landed ${xSent}/${FENYX_SENDS} Fenyx sends in ${(fenyxMs / 1000).toFixed(1)}s`)

  const faceEnd = await jget('/api/kraynet/star/' + star)
  const luzTape = (faceEnd.history || []).filter((h) => h.kind === 'cut-send')
  ok(luzTape.length > 0, `star #${star} journal carries ${luzTape.length} cut-send lines`)
  const lights = await jget('/api/kraynet/analytics')
  const nyxTape = lights.lights?.x?.tape || lights.x?.tape || []
  ok(Array.isArray(nyxTape) && nyxTape.length > 0, `Nyx tape present (${nyxTape.length} shown)`)
  ok(nyxTape.every((row) => ['x-send', 'burn', 'burn-thaw', 'lane-enter', 'lane-exit', 'fold-seal'].includes(row.kind)),
    'Nyx tape kinds stay on the Fenyx book — no cut-send leak')
  const twinFace = await jget('/api/kraynet/star/' + b.star)
  ok(String(twinFace.contentType || '').startsWith('image/'), `twin #${b.star} still image after the swarm`)
  ok((twinFace.history || []).some((h) => h.kind === 'cut-send'), `twin #${b.star} has its own Luz tape`)

  console.log(`\n   image stars #${a.star} + #${b.star}  ·  luz sent ${sent}  ·  fenyx sent ${xSent}  ·  seq ${before.seq} → ${afterAll.seq}`)
  console.log(`   holders luz: ${luzFinal.rows.map((n, i) => `w${i}:${n}`).join('  ')}`)
  console.log(`   holders Ӿ:   ${xEnd.rows.map((n, i) => `w${i}:${n}`).join('  ')}`)
  if (fail) { console.error(`\n✗ ${fail} failed · ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks — ${sent + xSent} live transits, both books intact, cascade conserves. ✧🔥\n`)
}
main()
