/**
 * RAFFLE — live door on the regtest bench (:4477), start to finish.
 *   KRAY_BTC_RPC_PASS=<pw> node src/test/star-raffle-e2e.mjs
 * Does not touch Signet. Bench math stays in star-raffle.test.ts + swarm.
 *
 * Covers: paying the ticket · nobody paying · arriving at the Bitcoin seal
 * with a prize field · arriving at the seal without the meta (0 or 1 ticket).
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const RPC = process.env.KRAY_BTC_RPC || 'http://127.0.0.1:18454'
const RPC_USER = process.env.KRAY_BTC_RPC_USER || 'kraycore'
const RPC_PASS = process.env.KRAY_BTC_RPC_PASS || ''
const WALLET = process.env.KRAY_BTC_WALLET || process.env.KRAY_WALLET || 'kray'
const TAG = 'raffle-' + Date.now().toString(36)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))
const html = (p) => fetch(NODE + p).then((r) => r.text()).catch(() => '')
const satToBtc = (s) => (Number(s) / 1e8).toFixed(8)

async function bc(method, params = []) {
  const r = await fetch(`${RPC}/wallet/${WALLET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64') },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'kray', method, params }),
  }).then((x) => x.json())
  if (r.error) throw new Error(`bitcoind ${method}: ${r.error.message}`)
  return r.result
}

const id = (t) => {
  const s = nsha(new TextEncoder().encode('star-raffle-e2e|' + t + '|' + TAG))
  const x = Buffer.from(schnorr.getPublicKey(s)).toString('hex')
  return {
    s, x, a: btc.p2tr(Buffer.from(x, 'hex'), undefined, NETWORKS[NET]).address,
    sign: (m) => Buffer.from(schnorr.sign(nsha(new TextEncoder().encode(m)), s)).toString('hex'),
  }
}

async function act(who, body) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: who.a })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)), _prep: prep }
  const sub = await jpost('/api/kraynet/submit', {
    ...body, from: who.a, code: prep.code || body.code, nonce: prep.nonce, clock: prep.clock, publicKey: who.x,
    signature: who.sign(prep.message), scheme: 'kraywallet',
  })
  return { ...sub, _star: prep.star ?? sub.star, _address: sub.address, _code: prep.code }
}

async function fund(who, sats = '400') {
  const mint = await jpost('/api/kraynet/donate', { to: who.a, sats })
  if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 — ' + (mint.error || ''))
}

async function hangHouse(who, name) {
  const named = await act(who, { action: 'name', name })
  if (!named.ok || named._star == null) die('name failed — ' + (named.error || ''))
  const sealed = await act(who, {
    action: 'contract', star: String(named._star),
    form: { kind: 'raffle', price: '5', period: '1', seats: '4' },
  })
  if (!sealed.ok) die('hang failed — ' + (sealed.error || ''))
  return { face: String(named._star), pot: sealed._address, sealed }
}

async function seals() {
  const o = await jget('/api/kraynet/overview')
  return Number(o.bitcoinSeals || 0)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitSealsPast(before, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const n = await seals()
    if (n > before) return n
    await sleep(300)
  }
  return await seals()
}

/**
 * Advance ctx.interval by one confirmed Bitcoin seal.
 * On this lab the operator self-mines when a value KRAY block lands on ANCHOR_EVERY.
 * A quiet tip after an odd fold needs a tiny trusted-dev nudge so the next heartbeat
 * is a value block. Donation-to-burn is the last resort (live root must match the folded block).
 */
async function buryOneSeal() {
  if (!RPC_PASS) die('set KRAY_BTC_RPC_PASS (workshop live-exam loads it from the harness conf)')
  const before = await seals()
  let after = await waitSealsPast(before, 8000)
  if (after > before) return { before, after, how: 'pending Bitcoin seal confirmed' }

  for (let i = 0; i < 3 && after <= before; i++) {
    const nudge = id('nudge-clock-' + i)
    const mint = await jpost('/api/kraynet/donate', { to: nudge.a, sats: '1' })
    if (!mint.ok) die('clock nudge refused — ' + (mint.error || ''))
    after = await waitSealsPast(before, 8000)
  }
  if (after > before) return { before, after, how: 'operator self-mined the next value block' }

  const info = await jget('/api/kraynet/donation/info')
  const burn = info.selfAnchor?.burnAddress
  if (!burn) die('lab is not in burn/self-anchor mode — raffle clock needs a real Bitcoin seal')
  const donor = await bc('getnewaddress', ['raffle-clock', 'bech32m'])
  const raw = await bc('createrawtransaction', [[], [{ [burn]: Number(satToBtc(1000n)) }, { data: Buffer.from(donor, 'ascii').toString('hex') }]])
  const funded = await bc('fundrawtransaction', [raw, { changePosition: 2 }])
  const signed = await bc('signrawtransactionwithwallet', [funded.hex])
  if (!signed.complete) die('wallet could not sign the clock burn')
  const txid = await bc('sendrawtransaction', [signed.hex])
  await bc('generatetoaddress', [Math.max(1, info.minConfirmations || 1), await bc('getnewaddress', ['', 'bech32m'])])
  const res = await jpost('/api/kraynet/donate', { txid })
  if (!res.ok) die('clock burn refused — ' + (res.error || JSON.stringify(res)))
  after = await waitSealsPast(before, 22000)
  if (after <= before) {
    die(`Bitcoin clock did not advance (${before}) — burn ${JSON.stringify({ selfAnchor: res.selfAnchor || null })}`)
  }
  return { before, after, how: 'self-anchor burn', txid }
}

/** Finish one hung wheel: more empty windows accumulate, then a second ticket, then prize. */
async function cyclePinnedStar(no) {
  console.log('\n╔═ STAR #' + no + ' — accumulate across seals · then prize · roster closes ═╗\n')
  const star = await jget('/api/kraynet/star/' + no)
  if (star.__down || star.error) die('no star #' + no + ' on :4477')
  const pot = star.contract
  if (!pot) die('star #' + no + ' has no pot')
  ok(star.name && /thin|full|empty|raffle/i.test(String(star.name) + String((star.law && star.law.rules || []).join(','))),
    `star #${no} “${star.name || '?'}” is a raffle face`)
  const page = await html('/star/' + no)
  ok(/function raffleSeats/.test(page), 'the being page paints numbered seats that refresh until the window closes')

  let view = await jget('/api/kraynet/contract/' + encodeURIComponent(pot))
  ok(view.state && view.state.price === '5', 'this is the ticket pot')
  const startTaken = Number(view.state.taken || 0)
  const startBal = BigInt(view.balance || '0')
  ok(startTaken >= 1 && startBal >= 5n, `someone already paid — ${startTaken} seat(s), ${startBal} ₭ (the lonely face stays on the roster)`)
  ok(Array.isArray(view.faces) && view.faces.filter(Boolean).length === startTaken, 'positions match the people sitting')

  const roller = id('pin-roll')
  const sit2 = id('pin-sit2')
  const prize = id('pin-prize')
  for (const w of [roller, sit2, prize]) await fund(w)

  const due0 = Number(view.state.due || 0)
  const seals0 = await seals()
  if (!(due0 !== 0 && seals0 >= due0)) {
    const clock = await buryOneSeal()
    ok(clock.after >= due0, `Bitcoin reached the target window (${clock.before} → ${clock.after}, due ${due0})`)
  }

  const roll1 = await act(roller, { action: 'contract-call', contract: pot, rule: 'settle', args: {} })
  ok(roll1.ok === true, 'target block, no prize meta — someone fired settle, the pot stayed')
  view = await jget('/api/kraynet/contract/' + encodeURIComponent(pot))
  ok(view.state.taken === String(startTaken) && BigInt(view.balance || '0') === startBal, 'first close without the field — still accumulating')
  const due1 = Number(view.state.due || 0)
  ok(due1 > due0, `due restarted for more Bitcoin seals (${due0} → ${due1})`)

  const clock2 = await buryOneSeal()
  ok(clock2.after >= due1, `another sealed window arrived (${clock2.before} → ${clock2.after})`)
  const roll2 = await act(roller, { action: 'contract-call', contract: pot, rule: 'settle', args: {} })
  ok(roll2.ok === true, 'second target without new people — still rolls, still accumulates')
  view = await jget('/api/kraynet/contract/' + encodeURIComponent(pot))
  ok(view.state.taken === String(startTaken) && BigInt(view.balance || '0') === startBal, 'after more blocks the lonely ticket is still sitting')
  ok(Number(view.state.due) > due1, 'the clock restarted again')

  const join = await act(sit2, { action: 'contract-call', contract: pot, rule: 'enter', args: {} })
  ok(join.ok === true, 'a second person paid the ticket — two positions now')
  view = await jget('/api/kraynet/contract/' + encodeURIComponent(pot))
  ok(view.state.taken === '2' && view.faces.filter(Boolean).length === 2, 'roster shows two people until close')

  const due3 = Number(view.state.due || 0)
  if ((await seals()) < due3) await buryOneSeal()
  const pay = await act(prize, { action: 'contract-call', contract: pot, rule: 'settle', args: {} })
  ok(pay.ok === true, 'someone triggered prize delivery at the anchored window')
  view = await jget('/api/kraynet/contract/' + encodeURIComponent(pot))
  ok(view.state.taken === '0' && view.balance === '0', 'prize closed the window — pot empty, seats wiped')
  ok(!(view.faces || []).some(Boolean), 'no one remains on the roster after close')

  const ov = await jget('/api/kraynet/overview')
  ok(ov.conserves !== false, 'the net still conserves on star #' + no)
}

async function main() {
  const pinned = process.env.KRAY_RAFFLE_STAR
  if (pinned) {
    const info = await jget('/api/kraynet/donation/info')
    if (info.__down) die('no node at ' + NODE + ' — do not touch Signet')
    if (info.contractRaffle !== true) die('stale :4477')
    await cyclePinnedStar(String(pinned))
    if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
    console.log(`\n✓ ${pass} checks passed — STAR #${pinned} accumulated across empty windows, then a second ticket delivered the prize and the roster closed. ⚖⭐`)
    return
  }

  console.log('\n╔═ STAR RAFFLE — live door · tickets · empty · thin · prize · Bitcoin clock ═╗\n')
  const info = await jget('/api/kraynet/donation/info')
  if (info.__down) die('no node at ' + NODE + ' — start the official explorer on :4477 (do not touch Signet)')
  if (info.contractRaffle !== true) die('stale :4477 — reload the official explorer so the raffle door is live')
  ok(info.contractRaffle === true, 'door publishes raffle')
  ok(info.contractExam === true, 'door publishes the dry-run exam')
  ok(info.selfAnchor?.mode === 'burn' && !!info.selfAnchor?.burnAddress, 'lab is burn-mode — the clock is a real Bitcoin seal')

  const studio = await html('/inscribe')
  ok(/data-lkind="raffle"/.test(studio), 'write studio carries the Raffle paper')
  const examJs = await html('/contract-exam.js')
  ok(/kind: "raffle"/.test(examJs), 'the paper catalog compiles raffle knobs')

  const dry = await jpost('/api/kraynet/contract-exam', { form: { kind: 'raffle', price: '5', period: '100', seats: '8' } })
  ok(dry.ready === true && dry.code && (dry.code.rules || []).map((r) => r.name).join(',') === 'toggle_open,enter,settle,draw,skip',
    'exam of the knobs is ready — no star, no ₭, IR is the looping pot')
  ok(!(dry.code.rules || []).some((r) => r.name === 'collect'), 'exam paper has no collect')

  const ghost = await jpost('/api/kraynet/prepare', {
    action: 'contract', from: id('ghost').a, form: { kind: 'raffle', price: '5' },
  })
  ok(/star/i.test(ghost.error || ''), 'prepare without a face is refused — raffle is not a v1 pot')

  const emptyHouse = id('empty-house')
  const thinHouse = id('thin-house')
  const fullHouse = id('full-house')
  const ghostSit = id('ghost-sit')
  const thinSit = id('thin-sit')
  const thinRoll = id('thin-roll')
  const fullSit = id('full-sit')
  const fullSit2 = id('full-sit2')
  const prizeRoll = id('prize-roll')
  for (const w of [emptyHouse, thinHouse, fullHouse, ghostSit, thinSit, thinRoll, fullSit, fullSit2, prizeRoll]) {
    await fund(w)
  }

  const empty = await hangHouse(emptyHouse, ('empty' + TAG.slice(-5)).replace(/\W/g, ''))
  const thin = await hangHouse(thinHouse, ('thin' + TAG.slice(-5)).replace(/\W/g, ''))
  const full = await hangHouse(fullHouse, ('full' + TAG.slice(-5)).replace(/\W/g, ''))
  ok(!!empty.pot && !!thin.pot && !!full.pot, 'three wheels hung — empty / thin / prize')

  const emptyView0 = await jget('/api/kraynet/contract/' + encodeURIComponent(empty.pot))
  ok(emptyView0.state && emptyView0.state.taken === '0' && emptyView0.state.due === '0' && emptyView0.balance === '0',
    'nobody paid — pot empty, clock never started')
  const emptyEarly = await act(ghostSit, { action: 'contract-call', contract: empty.pot, rule: 'settle', args: {} })
  ok(!!emptyEarly.error, 'settle on a never-entered pot is refused — no tickets, no clock')

  const thinEnter = await act(thinSit, { action: 'contract-call', contract: thin.pot, rule: 'enter', args: {} })
  ok(thinEnter.ok === true, 'one person paid the ticket — thin field sits')
  const thinView = await jget('/api/kraynet/contract/' + encodeURIComponent(thin.pot))
  ok(thinView.state && thinView.state.taken === '1' && thinView.balance === '5', 'one ticket — 5 ₭ in the pot, not prizeReady')

  const sit = await act(fullSit, { action: 'contract-call', contract: full.pot, rule: 'enter', args: {} })
  const sit2 = await act(fullSit2, { action: 'contract-call', contract: full.pot, rule: 'enter', args: {} })
  ok(sit.ok === true && sit2.ok === true, 'two people paid the ticket — prize field sits')
  const fullView = await jget('/api/kraynet/contract/' + encodeURIComponent(full.pot))
  ok(fullView.state && fullView.state.taken === '2' && fullView.balance === '10', 'two tickets — 10 ₭ in the pot')
  ok(Array.isArray(fullView.faces) && fullView.faces.filter(Boolean).length === 2, 'two faces on the roster')

  const earlyThin = await act(thinRoll, { action: 'contract-call', contract: thin.pot, rule: 'settle', args: {} })
  const earlyFull = await act(prizeRoll, { action: 'contract-call', contract: full.pot, rule: 'settle', args: {} })
  ok(!!earlyThin.error && !!earlyFull.error, 'settle before the Bitcoin seal is refused — thin and prize')
  const thief = await act(prizeRoll, { action: 'contract-call', contract: full.pot, rule: 'draw', args: {} })
  ok(/living owner|mouth/i.test(thief.error || ''), 'a stranger cannot draw')
  const steal = await act(fullHouse, { action: 'contract-call', contract: full.pot, rule: 'collect', args: {} })
  ok(!!steal.error, 'collect is not a rule')

  const clock = await buryOneSeal()
  ok(clock.after > clock.before, `Bitcoin clock advanced (${clock.before} → ${clock.after}${clock.how ? ', ' + clock.how : ''})`)

  const emptyAfterSeal = await act(ghostSit, { action: 'contract-call', contract: empty.pot, rule: 'settle', args: {} })
  ok(!!emptyAfterSeal.error, 'block arrived with nobody paying — empty pot still refuses settle (due stays 0)')
  const emptyView1 = await jget('/api/kraynet/contract/' + encodeURIComponent(empty.pot))
  ok(emptyView1.balance === '0' && emptyView1.state.taken === '0', 'empty pot did not invent a prize')

  const thinBal0 = BigInt((await jget('/api/kraynet/profile/' + thinSit.a)).balance || '0')
  const rollBal0 = BigInt((await jget('/api/kraynet/profile/' + thinRoll.a)).balance || '0')
  const thinSettle = await act(thinRoll, { action: 'contract-call', contract: thin.pot, rule: 'settle', args: {} })
  ok(thinSettle.ok === true, 'block arrived without the meta — settle rolls, does not pay a prize')
  const thinAfter = await jget('/api/kraynet/contract/' + encodeURIComponent(thin.pot))
  ok(thinAfter.balance === '5' && thinAfter.state.taken === '1', 'thin pot accumulated — ticket and 5 ₭ stay')
  const thinBal1 = BigInt((await jget('/api/kraynet/profile/' + thinSit.a)).balance || '0')
  const rollBal1 = BigInt((await jget('/api/kraynet/profile/' + thinRoll.a)).balance || '0')
  ok(thinBal1 === thinBal0, 'the lonely ticket did not win')
  ok(rollBal1 === rollBal0 - 1n, 'rolling a thin field costs the signer their own 1 ₭')
  const thinDraw = await act(thinHouse, { action: 'contract-call', contract: thin.pot, rule: 'draw', args: {} })
  ok(!!thinDraw.error, 'owner cannot draw a one-ticket pot')

  const p0 = BigInt((await jget('/api/kraynet/profile/' + prizeRoll.a)).balance || '0')
  const a0 = BigInt((await jget('/api/kraynet/profile/' + fullSit.a)).balance || '0')
  const b0 = BigInt((await jget('/api/kraynet/profile/' + fullSit2.a)).balance || '0')
  const prizeSettle = await act(prizeRoll, { action: 'contract-call', contract: full.pot, rule: 'settle', args: {} })
  ok(prizeSettle.ok === true, 'block arrived with people — public settle delivers')
  const prizeAfter = await jget('/api/kraynet/contract/' + encodeURIComponent(full.pot))
  ok(prizeAfter.balance === '0' && prizeAfter.state.taken === '0', 'prize settle emptied the pot and wiped the roster')
  const p1 = BigInt((await jget('/api/kraynet/profile/' + prizeRoll.a)).balance || '0')
  const a1 = BigInt((await jget('/api/kraynet/profile/' + fullSit.a)).balance || '0')
  const b1 = BigInt((await jget('/api/kraynet/profile/' + fullSit2.a)).balance || '0')
  const moved = (p1 - p0) + (a1 - a0) + (b1 - b0)
  ok(moved === 9n, 'prize field conserved the pot: 1 ₭ to the settler, 9 ₭ to the beacon seat (or 10 if they are the same face)')
  ok((a1 > a0) || (b1 > b0) || (p1 - p0 === 9n), 'winner is a seated face — nobody named them')

  const ov = await jget('/api/kraynet/overview')
  ok(ov.conserves !== false, 'the net still conserves after every live branch')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — LIVE RAFFLE HOLDS START TO FINISH: ticket, nobody paid, seal with prize, seal without the meta. Bitcoin is the clock. ⚖⭐`)
}
main().catch((e) => die(e.stack || e.message))
