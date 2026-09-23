/**
 * WHO HOLDS A DROP WHILE IT STANDS? — the packet market keeps NO custody, and this is what that costs.
 *
 *   node src/test/drop-custody.itest.ts
 *
 * The Creator, 2026-09-22, after listing 144 ₭ at price zero: *"ainda fica o valor do token aparecendo na
 * carteira do dono que criou… se eu criar o drop 144 e eu enviar esses 144 da minha wallet em outra action,
 * isso é possível?"*
 *
 * IT IS POSSIBLE, AND IT IS THE DESIGN. A harvest ESCROWS — `claim-open` moves the whole total into a
 * keyless pot at once, because a promise to MANY hands that can be spent from behind is not a promise. A
 * drop is a STANDING OFFER to ONE hand: the packet never leaves the seller, so listing costs them nothing
 * but the eternal fee and they keep the use of their own value until somebody actually takes it.
 *
 * So the honest question is not "can the seller spend it" — they can. It is: CAN ANYBODY BE ROBBED BY THAT?
 * This file answers no, and measures every way it could have been yes.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes } from '../protocol/scheme.ts'
import { claimRoot } from '../protocol/claim-book.ts'

const NET = 'regtest', PORT = 4497, BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-drop-custody-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (c: unknown, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update(`drop-custody|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { tag, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address!, sk, pk: publicKeyHex }
}
type W = ReturnType<typeof wallet>
const jget = (p: string) => fetch(BASE + p).then((r) => r.json()) as Promise<Record<string, any>>
const jpost = (p: string, b: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()) as Promise<Record<string, any>>
const balOf = async (a: string) => BigInt(String((await jget('/api/kraynet/profile/' + encodeURIComponent(a))).balance ?? '0'))
async function act(action: string, w: W, fields: Record<string, unknown>) {
  const body = { action, from: w.addr, ...fields }
  const p = await jpost('/api/kraynet/prepare', body)
  if (p.error) return p
  return jpost('/api/kraynet/submit', { ...body, nonce: p.nonce, publicKey: w.pk, signature: _signKrayWallet(String(p.message), w.sk) })
}
const stampede = async (entries: Array<{ action: string; w: W; fields: Record<string, unknown> }>) => {
  const armed = await Promise.all(entries.map(async (e) => {
    const body = { action: e.action, from: e.w.addr, ...e.fields }
    return { body, prep: await jpost('/api/kraynet/prepare', body), w: e.w }
  }))
  return Promise.all(armed.map(async ({ body, prep, w }) =>
    prep.error ? prep : jpost('/api/kraynet/submit', { ...body, nonce: prep.nonce, publicKey: w.pk, signature: _signKrayWallet(String(prep.message), w.sk) })))
}
const listingOf = async (seller: string) => ((await jget('/api/kraynet/packets')).listings || []).find((l: any) => l.seller === seller)

async function main() {
  console.log('\n╔═ WHO HOLDS A DROP WHILE IT STANDS ═╗\n')
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  const child = spawn('node', [SERVER], { env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_TRUSTED_DEV: '1' }, stdio: 'ignore' })
  process.on('exit', () => { try { child.kill('SIGKILL') } catch { /* gone */ } })
  const done = (code: number) => { try { child.kill('SIGKILL') } catch { /* gone */ } rmSync(DATA, { recursive: true, force: true }); process.exit(code) }

  try {
    let up = false
    for (let i = 0; i < 120 && !up; i++) { try { const h = await jget('/health'); up = !!(h && h.ok) } catch { /* not yet */ } if (!up) await sleep(100) }
    ok(up, 'the door booted')

    const seller = wallet('seller'), taker = wallet('taker'), other = wallet('other'), sink = wallet('sink')
    const all = [seller, taker, other, sink]
    for (const w of all) await jpost('/api/kraynet/donate', { to: w.addr, sats: '500' })
    const sumAll = async () => {
      let s = 0n
      for (const w of all) s += await balOf(w.addr)
      return s + (await balOf('KRAY_TREASURY')) + (await balOf('KRAY_CLAIM'))
    }
    const SUPPLY = await sumAll()

    // ── DC-0 · THE THREE SHAPES, SIDE BY SIDE ────────────────────────────────────────────────
    // The Creator: *"a harvest ou a mint, quando abre, é diferente? eles saem da wallet?"* The same 100,
    // promised three ways, measured at the instant after the signature. This is the whole difference.
    console.log('\nDC-0 — the same 100, promised three ways')
    {
      const three = { drop: wallet('s-drop'), harv: wallet('s-harv'), mint: wallet('s-mint') }
      for (const w of Object.values(three)) { await jpost('/api/kraynet/donate', { to: w.addr, sats: '500' }); all.push(w) }
      const potBefore = await balOf('KRAY_CLAIM')

      const b = { drop: await balOf(three.drop.addr), harv: await balOf(three.harv.addr), mint: await balOf(three.mint.addr) }
      ok((await act('packet-list', three.drop, { lane: 'kray', amount: '100', price: '0' })).seq != null, 'a DROP of 100 is listed')
      const hRoot = claimRoot([{ to: taker.addr, amount: 60n }, { to: other.addr, amount: 40n }])
      ok((await act('claim-open', three.harv, { lane: 'kray', amount: '100', claimRoot: hRoot, expires: 900000 })).seq != null, 'a HARVEST of 100 is opened')
      ok((await act('mint-open', three.mint, { lane: 'kray', perHand: '25', hands: 4, expires: 900000 })).seq != null, 'a MINT of 4 × 25 is opened')

      const a = { drop: await balOf(three.drop.addr), harv: await balOf(three.harv.addr), mint: await balOf(three.mint.addr) }
      console.log(`      drop    ${b.drop} → ${a.drop}   (moved ${b.drop - a.drop})`)
      console.log(`      harvest ${b.harv} → ${a.harv}   (moved ${b.harv - a.harv})`)
      console.log(`      mint    ${b.mint} → ${a.mint}   (moved ${b.mint - a.mint})`)

      ok(b.drop - a.drop === 1n, 'the DROP took ONLY the eternal fee — the 100 is still the seller\'s')
      ok(b.harv - a.harv === 101n, 'the HARVEST took the whole 100 PLUS the fee — it left at the signature')
      ok(b.mint - a.mint === 101n, 'the MINT took the whole 100 PLUS the fee — it left at the signature')
      ok((await balOf('KRAY_CLAIM')) === potBefore + 200n, 'and both totals are in the keyless pot, which no signature can reach')

      // AND THE PROOF THAT IT REALLY LEFT. 450 is the test: if the promised 100 had stayed, every one of
      // the three could afford it (they held 500). Only the two that ESCROWED are refused.
      const tryBig = async (w: W, label: string) => {
        const r = await act('transfer', w, { to: sink.addr, amount: '450' })
        return { ok: r.seq != null, why: String(r.error || '').slice(0, 44), label }
      }
      const rh = await tryBig(three.harv, 'harvest'), rm = await tryBig(three.mint, 'mint'), rd = await tryBig(three.drop, 'drop')
      ok(!rh.ok, `the HARVEST's giver cannot send 450 — the 100 really left ("${rh.why}…")`)
      ok(!rm.ok, `the MINT's giver cannot send 450 — the 100 really left ("${rm.why}…")`)
      ok(rd.ok, 'but the DROP\'s seller CAN send 450 — their 100 never left, and the offer simply goes stale')
    }

    // ── DC-1 · listing costs the seller nothing but the fee ──────────────────────────────────
    console.log('\nDC-1 — the packet never leaves the seller')
    const b0 = await balOf(seller.addr)
    ok((await act('packet-list', seller, { lane: 'kray', amount: '144', price: '0' })).seq != null, 'a drop of 144 at price zero is listed')
    const b1 = await balOf(seller.addr)
    ok(b1 === b0 - 1n, `the seller paid ONLY the eternal fee — 144 is still theirs (${b0} → ${b1})`)
    const l1 = await listingOf(seller.addr)
    ok(l1 && l1.drop === true && l1.sellerHolds === String(b1), 'and the book PUBLISHES what the seller actually holds beside the offer')
    ok(l1.fillable === true, 'so a reader can see at a glance the offer can still be filled')

    // ── DC-2 · the seller spends it out from under the offer ─────────────────────────────────
    console.log('\nDC-2 — the seller spends the very packet they offered')
    ok((await act('transfer', seller, { to: sink.addr, amount: String(b1 - 2n) })).seq != null, 'the seller sends almost everything away')
    const l2 = await listingOf(seller.addr)
    ok(l2 && l2.fillable === false, 'the offer is STILL listed, and the book now says it cannot be filled')
    ok(BigInt(l2.sellerHolds) < 144n, `and publishes the true holding (${l2.sellerHolds}), not the promise`)

    // ── DC-3 · and NOBODY can be robbed by that ──────────────────────────────────────────────
    console.log('\nDC-3 — the taker who arrives too late')
    const t0 = await balOf(taker.addr)
    const late = await act('packet-take', taker, { lane: 'kray', seller: seller.addr, amount: '144', price: '0' })
    ok(late.error != null, `taking a packet the seller no longer holds → refused ("${String(late.error).slice(0, 56)}…")`)
    ok((await balOf(taker.addr)) === t0, 'and the taker paid NOTHING for arriving too late — not even the gas')

    // ── DC-4 · what the law refuses outright ─────────────────────────────────────────────────
    console.log('\nDC-4 — promising more than is held, at the moment of listing')
    const over = await act('packet-list', other, { lane: 'kray', amount: '999999', price: '0' })
    ok(over.error != null && /do not hold|have not got/.test(String(over.error)), 'listing more than the seller holds → refused at the open')
    // ONE SELLER, ONE OFFER PER ASSET — a second listing REPLACES the first rather than stacking beside it.
    // (`other` is used because `seller` was deliberately drained above and could not pay the fee.)
    ok((await act('packet-list', other, { lane: 'kray', amount: '100', price: '0' })).seq != null, 'another seller lists 100')
    ok((await act('packet-list', other, { lane: 'kray', amount: '60', price: '2' })).seq != null, 'and then lists 60 at a price on the same lane')
    const ls = ((await jget('/api/kraynet/packets')).listings || []).filter((l: any) => l.seller === other.addr)
    ok(ls.length === 1 && ls[0].amount === '60', `the second REPLACED the first — one seller, one offer per asset (${ls.length}, amount ${ls[0]?.amount})`)

    // ── DC-5 · the race: spending and taking in the SAME instant ─────────────────────────────
    console.log('\nDC-5 — a take and a spend fired together')
    const racer = wallet('racer'), grabber = wallet('grabber')
    await jpost('/api/kraynet/donate', { to: racer.addr, sats: '400' })
    await jpost('/api/kraynet/donate', { to: grabber.addr, sats: '400' })
    all.push(racer, grabber)
    const SUPPLY2 = await sumAll()
    ok((await act('packet-list', racer, { lane: 'kray', amount: '300', price: '0' })).seq != null, 'a drop of 300 stands')
    const rows = await stampede([
      { action: 'packet-take', w: grabber, fields: { lane: 'kray', seller: racer.addr, amount: '300', price: '0' } },
      { action: 'transfer', w: racer, fields: { to: sink.addr, amount: '300' } },
    ])
    const winners = rows.filter((r) => r.seq != null).length
    ok(winners >= 1, `at least one of the two applied — neither deadlocked (${winners})`)
    ok((await sumAll()) === SUPPLY2, 'and whoever won, Σ across every hand is exactly what it was')

    // ── DC-7 · A FRACTION OF WHAT WAS OFFERED ────────────────────────────────────────────────
    // The Creator: *"e se tiver uma fração do proposto, como 50 de 144?"* A TAKE IS WHOLE OR NOTHING.
    // The taker signs the exact amount, the exact price AND a hash of the whole offer's terms — so a
    // re-listed, re-priced or re-aimed offer refutes a stale signature rather than quietly honouring it.
    console.log('\nDC-7 — a fraction of what was offered')
    const frac = wallet('frac'), grab2 = wallet('grab2')
    await jpost('/api/kraynet/donate', { to: frac.addr, sats: '400' })
    await jpost('/api/kraynet/donate', { to: grab2.addr, sats: '400' })
    all.push(frac, grab2)
    ok((await act('packet-list', frac, { lane: 'kray', amount: '144', price: '0' })).seq != null, 'a drop of 144 stands')
    ok((await act('transfer', frac, { to: sink.addr, amount: '340' })).seq != null, 'the seller spends down to about 50')
    const held = await balOf(frac.addr)
    ok(held < 144n, `the seller now holds ${held}, less than the 144 they offered`)

    const g0 = await balOf(grab2.addr)
    const whole = await act('packet-take', grab2, { lane: 'kray', seller: frac.addr, amount: '144', price: '0' })
    ok(whole.error != null && /no longer holds/.test(String(whole.error)), `taking the WHOLE 144 → refused ("${String(whole.error).slice(0, 48)}…")`)
    const part = await act('packet-take', grab2, { lane: 'kray', seller: frac.addr, amount: String(held), price: '0' })
    ok(part.error != null && /whole or nothing|listed amount/.test(String(part.error)), `taking the FRACTION the seller still holds → refused ("${String(part.error).slice(0, 56)}…")`)
    ok((await balOf(grab2.addr)) === g0, 'and neither attempt cost the taker a single unit — not even the gas')

    // THE DOOR REFUSES FIRST, so a wallet never opens for an offer the law will certainly refuse.
    // `claim-take` re-proved its merkle path at the door from the start; a packet take had no twin, so
    // the citizen signed and only then learned the offer was stale. It has one now.
    const doorStale = await jpost('/api/kraynet/prepare', { action: 'packet-take', from: grab2.addr, lane: 'kray', seller: frac.addr, amount: '144', price: '0' })
    ok(doorStale.error != null && doorStale.message == null, `the door refuses a STALE take before any signature ("${String(doorStale.error).slice(0, 50)}…")`)
    const doorPart = await jpost('/api/kraynet/prepare', { action: 'packet-take', from: grab2.addr, lane: 'kray', seller: frac.addr, amount: String(held), price: '0' })
    ok(doorPart.error != null && /whole or nothing/.test(String(doorPart.error)), `and refuses a FRACTION before any signature ("${String(doorPart.error).slice(0, 50)}…")`)
    const doorPrice = await jpost('/api/kraynet/prepare', { action: 'packet-take', from: grab2.addr, lane: 'kray', seller: frac.addr, amount: '144', price: '99' })
    ok(doorPrice.error != null, 'and refuses a re-priced take before any signature')
    const ghostSeller = await jpost('/api/kraynet/prepare', { action: 'packet-take', from: grab2.addr, lane: 'kray', seller: sink.addr, amount: '5', price: '0' })
    ok(ghostSeller.error != null && /not listed/.test(String(ghostSeller.error)), 'and a seller with no offer at all is named plainly')

    // THE SELLER CAN RE-AIM — and the old signature dies with the old offer
    const armed = await jpost('/api/kraynet/prepare', { action: 'packet-take', from: grab2.addr, lane: 'kray', seller: frac.addr, amount: '144', price: '0' })
    ok((await act('packet-list', frac, { lane: 'kray', amount: String(held - 1n), price: '0' })).seq != null, `the seller re-lists what they really hold (${held - 1n})`)
    if (!armed.error) {
      const stale = await jpost('/api/kraynet/submit', { action: 'packet-take', from: grab2.addr, lane: 'kray', seller: frac.addr, amount: '144', price: '0',
        nonce: armed.nonce, publicKey: grab2.pk, signature: _signKrayWallet(String(armed.message), grab2.sk) })
      ok(stale.error != null, `a signature armed against the OLD offer dies with it ("${String(stale.error).slice(0, 52)}…")`)
    } else { ok(true, 'the door refused the stale arm before it could be signed') }
    const nowOk = await act('packet-take', grab2, { lane: 'kray', seller: frac.addr, amount: String(held - 1n), price: '0' })
    ok(nowOk.seq != null, 'and the HONEST take of the re-listed amount is paid')
    ok((await balOf(grab2.addr)) === g0 + (held - 1n) - 1n, 'exactly what was listed, minus the eternal fee')

    // ── DC-6 · the arithmetic, after all of it ───────────────────────────────────────────────
    console.log('\nDC-6 — nothing was created and nothing was lost')
    ok((await sumAll()) === SUPPLY + 3100n, 'Σ is the original supply plus exactly what was donated since')
    const ov = await jget('/api/kraynet/overview')
    ok(ov.conserves === true && ov.backed === true, 'the chain conserves and every pot is backed')

    console.log(`\n${pass} passed, ${fail} failed`)
    if (fail) { console.log('\n✗ A DROP CAN BE ABUSED'); done(1) }
    console.log('\n✓ A DROP KEEPS NO CUSTODY, AND NOBODY CAN BE ROBBED BY THAT: the seller keeps their own value and')
    console.log('  may spend it; the book publishes what they really hold beside what they offered; a taker who')
    console.log('  arrives after it is gone is refused and pays nothing at all. ⛓₭')
    done(0)
  } catch (e) {
    console.error('\n✗ crashed:', (e as Error).message)
    done(1)
  }
}
void main()
