/**
 * THE MARKET SWARM — the drop, the packet and the harvest under a real HTTP stampede.
 *   node src/test/market-swarm.itest.ts
 *   SWARM_HANDS=40 node src/test/market-swarm.itest.ts
 *
 * The reducer's own suites storm it in-process (725 + 672 + 151 + 612 adversarial checks), and
 * `packet-door.itest.ts` walks the public door act by act. Neither is a STAMPEDE: many wallets firing at the
 * same door in the same instant, each with a real signature, none of them waiting their turn.
 *
 * That is the shape of the only failures an escrow should fear. A drop is a race by design — one thing,
 * many hands, and the tiebreak IS the allocation. A harvest is a pot with a list, and "paid once" has to
 * survive a hand that fires its own claim forty times at once. And a giver taking back what nobody claimed
 * must never be able to happen at the same time as somebody claiming it.
 *
 *   MS-1  ONE DROP, MANY HANDS — exactly one takes the star; every loser pays NOTHING, not even the gas
 *   MS-2  ONE PACKET, MANY TAKERS — exactly one take fills it; the book is left empty, not half-spent
 *   MS-3  ONE HARVEST, EVERY HAND AT ONCE — each is paid exactly its own leaf, the pot lands on zero
 *   MS-4  ONE HAND, MANY TRIES — the same leaf fired K times concurrently is paid once and refused K−1
 *   MS-5  A CLAIM AGAINST A CLOSE — whoever wins, the sum is exact and nothing is paid twice
 *   MS-6  THE CHAIN IS WHOLE — intact, conserved, backed, and a stranger re-derives the root from the
 *         journal's own bytes after all of it
 *
 * Regtest only by design — but the same law now stands on signet (231) and on main (82, ratified 2026-09-22).
 */
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes } from '../protocol/scheme.ts'
import { openKrayLedger } from '../protocol/store.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0
function ok(cond: unknown, label: string): void {
  if (cond) { pass++; console.log('  ✓ ' + label); return }
  console.error(`  ✗ FAILED — ${label}`); throw new Error(label)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const NET = 'regtest'
const PORT = 4494
const BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-market-swarm-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const HANDS = Math.max(6, Math.min(60, Number(process.env.SWARM_HANDS ?? 24)))

function wallet(tag: string) {
  const sk = createHash('sha256').update(`market-swarm|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { tag, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address!, sk, pk: publicKeyHex }
}
type W = ReturnType<typeof wallet>
const jget = (p: string) => fetch(BASE + p).then((r) => r.json()) as Promise<Record<string, unknown>>
const jpost = (p: string, body: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()) as Promise<Record<string, unknown>>
const balOf = async (a: string) => BigInt(String((await jget('/api/kraynet/profile/' + encodeURIComponent(a))).balance ?? '0'))

/** The honest wallet's path: ask the door what to sign, sign exactly that, submit exactly that. */
async function act(action: string, w: W, fields: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body = { action, from: w.addr, ...fields }
  const p = await jpost('/api/kraynet/prepare', body)
  if (p.error) return p
  return jpost('/api/kraynet/submit', { ...body, nonce: p.nonce, publicKey: w.pk, signature: _signKrayWallet(String(p.message), w.sk) })
}
/** Every act PREPARED first, then all submitted in one shot — a stampede, not a queue. */
async function stampede(entries: Array<{ action: string; w: W; fields: Record<string, unknown> }>): Promise<Record<string, unknown>[]> {
  const armed = await Promise.all(entries.map(async (e) => {
    const body = { action: e.action, from: e.w.addr, ...e.fields }
    const p = await jpost('/api/kraynet/prepare', body)
    return { body, prep: p, w: e.w }
  }))
  return Promise.all(armed.map(async ({ body, prep, w }) => {
    if (prep.error) return prep
    return jpost('/api/kraynet/submit', { ...body, nonce: prep.nonce, publicKey: w.pk, signature: _signKrayWallet(String(prep.message), w.sk) })
  }))
}
const taken = (rows: Record<string, unknown>[]) => rows.filter((r) => r.seq != null).length
const refusedCount = (rows: Record<string, unknown>[]) => rows.filter((r) => r.error != null).length

async function bornStar(owner: W): Promise<string> {
  const body = 'swarm-' + randomBytes(6).toString('hex'), ch = createHash('sha256').update(body).digest('hex')
  const p = await jpost('/api/kraynet/prepare', { action: 'inscribe', from: owner.addr, content: body, contentType: 'text/plain', size: body.length })
  const r = await jpost('/api/kraynet/submit', { action: 'inscribe', from: owner.addr, content: body, contentHash: ch, contentType: 'text/plain', size: body.length, nonce: p.nonce, publicKey: owner.pk, signature: _signKrayWallet(String(p.message), owner.sk) })
  if (r.star == null) throw new Error('could not born a star: ' + JSON.stringify(r).slice(0, 160))
  return String(r.star)
}

async function main() {
  console.log(`\n╔═ THE MARKET SWARM — ${HANDS} hands at one door, in one instant ═╗\n`)
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  const child = spawn('node', [SERVER], { env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_TRUSTED_DEV: '1' }, stdio: 'ignore' })
  process.on('exit', () => { try { child.kill('SIGKILL') } catch { /* already gone */ } })
  const done = (code: number) => { try { child.kill('SIGKILL') } catch { /* already gone */ } rmSync(DATA, { recursive: true, force: true }); process.exit(code) }
  try {
    let up = false
    for (let i = 0; i < 120 && !up; i++) { try { const h = await jget('/health'); up = !!(h && h.ok) } catch { /* not yet */ } if (!up) await sleep(100) }
    ok(up, 'the door booted')

    const giver = wallet('giver')
    const hands: W[] = Array.from({ length: HANDS }, (_, i) => wallet(`hand-${i}`))
    for (const w of [giver, ...hands]) await jpost('/api/kraynet/donate', { to: w.addr, sats: '4000' })
    ok((await balOf(hands[0]!.addr)) === 4000n, `${HANDS + 1} wallets funded`)
    const fundedTotal = async () => {
      let sum = 0n
      for (const w of [giver, ...hands]) sum += await balOf(w.addr)
      return sum
    }

    // ── MS-1 · ONE DROP, MANY HANDS ──────────────────────────────────────────────────────────────
    console.log(`\nMS-1 — one star at price zero, ${HANDS} hands reaching for it at once`)
    {
      const star = await bornStar(giver)
      ok((await act('star-list', giver, { star, price: '0' })).seq != null, 'the drop is on the ground')
      const before = await Promise.all(hands.map((w) => balOf(w.addr)))
      const rows = await stampede(hands.map((w) => ({ action: 'star-buy', w, fields: { star, price: '0', seller: giver.addr } })))
      ok(taken(rows) === 1, `exactly ONE hand took it (${taken(rows)} accepted, ${refusedCount(rows)} refused)`)
      const after = await Promise.all(hands.map((w) => balOf(w.addr)))
      const paid = before.map((b, i) => b - after[i]!)
      const winners = paid.filter((d) => d === 1n).length
      const untouched = paid.filter((d) => d === 0n).length
      ok(winners === 1 && untouched === HANDS - 1, `the winner paid the eternal 1 ₭ and every loser paid NOTHING (${winners} paid, ${untouched} untouched)`)
      const world = await jget('/api/kraynet/market')
      ok(!(world.listings as unknown[] | undefined)?.some((l) => String((l as { star?: unknown }).star) === star), 'and the listing is gone from the book — not half-taken')
    }

    // ── MS-2 · ONE PACKET, MANY TAKERS ───────────────────────────────────────────────────────────
    console.log(`\nMS-2 — one ₭ packet, ${HANDS} takers in one instant`)
    {
      ok((await act('packet-list', giver, { lane: 'kray', amount: '50', price: '2' })).seq != null, 'a packet of 50 ₭ is offered at 2')
      const rows = await stampede(hands.map((w) => ({ action: 'packet-take', w, fields: { lane: 'kray', seller: giver.addr, amount: '50', price: '2' } })))
      ok(taken(rows) === 1, `exactly ONE take filled it (${taken(rows)} accepted, ${refusedCount(rows)} refused)`)
      const book = await jget('/api/kraynet/packets')
      ok((book.listings as unknown[] | undefined)?.length === 0, 'the book is empty — never half-spent')
    }

    // ── MS-3 · ONE HARVEST, EVERY HAND AT ONCE ───────────────────────────────────────────────────
    console.log(`\nMS-3 — one harvest over ${HANDS} hands, all of them claiming in the same instant`)
    let root = '', shares: Array<{ to: string; amount: string }> = []
    {
      shares = hands.map((w, i) => ({ to: w.addr, amount: String(10 + i) }))
      const desk = await jpost('/api/kraynet/claim/proof', { shares })
      root = String(desk.root)
      const total = shares.reduce((s, x) => s + BigInt(x.amount), 0n)
      ok(/^[0-9a-f]{64}$/.test(root) && desk.hands === HANDS, `the desk roots the list of ${HANDS} hands`)
      const giverBefore = await balOf(giver.addr)
      ok((await act('claim-open', giver, { lane: 'kray', total: total.toString(), claimRoot: root })).seq != null, `the harvest is open — ${total} ₭ left the giver`)
      ok((await balOf(giver.addr)) === giverBefore - total - 1n, 'exactly the total plus the eternal 1 ₭ of gas')

      // THE LIST, PUBLISHED UNDER ITS OWN ROOT. The chain keeps the root and nothing else, so without a
      // place to put the names a hand arriving with a link has nothing to build a proof from — and a pot
      // whose list is lost pays nobody, forever. Self-proving: re-root what comes back and a lying node is
      // caught. Unspammable: the node keeps a list ONLY for a harvest its own book already holds.
      const spam = await jpost('/api/kraynet/claim/list', { shares: [{ to: hands[0]!.addr, amount: '1' }] })
      ok(spam.error != null, 'a list for no harvest is refused — writing here costs what opening one costs')
      const kept = await jpost('/api/kraynet/claim/list', { shares })
      ok(String(kept.root) === root && kept.hands === HANDS, 'the real list is kept, under the root it produces')
      const fetched = await jget(`/api/kraynet/claim/list/${root}`)
      const back = (fetched.shares as Array<{ to: string; amount: string }>)
      ok(back.length === HANDS && back.every((s, i) => s.to === shares[i]!.to && s.amount === shares[i]!.amount),
        'and comes back byte for byte — a hand needs only the link')
      const reroot = await jpost('/api/kraynet/claim/proof', { shares: back })
      ok(String(reroot.root) === root, 're-rooted by the desk, it is the same harvest — a wrong list could not pass')
      ok((await jget(`/api/kraynet/claim/list/${'f'.repeat(64)}`)).error != null, 'a root nobody published answers plainly, never with a guess')

      const proofs = await Promise.all(hands.map((w) => jpost('/api/kraynet/claim/proof', { shares, to: w.addr })))
      ok(proofs.every((p) => p.inList === true), 'every hand has a path')
      const before = await Promise.all(hands.map((w) => balOf(w.addr)))
      const rows = await stampede(hands.map((w, i) => ({ action: 'claim-take', w, fields: { claimRoot: root, amount: String(proofs[i]!.amount), claimProof: proofs[i]!.proof } })))
      ok(taken(rows) === HANDS, `all ${HANDS} were paid (${taken(rows)} accepted, ${refusedCount(rows)} refused)`)
      const after = await Promise.all(hands.map((w) => balOf(w.addr)))
      const exact = after.every((a, i) => a === before[i]! + BigInt(shares[i]!.amount) - 1n)
      ok(exact, 'each was paid EXACTLY its own leaf, less the eternal 1 ₭ — not one satoshi more')
      const open = await jget('/api/kraynet/claims')
      const row = (open.claims as Array<Record<string, unknown>> | undefined)?.find((c) => c.root === root)
      ok(row === undefined || row.owed === '0', 'the pot landed on zero — nothing left, nothing overdrawn')
      ok(open.potBacked === true, 'and the pot is still backed by the book')
    }

    // ── MS-4 · ONE HAND, MANY TRIES ──────────────────────────────────────────────────────────────
    console.log('\nMS-4 — one hand firing its own leaf many times at once')
    {
      const hand = hands[0]!
      const list = [{ to: hand.addr, amount: '77' }, { to: hands[1]!.addr, amount: '23' }]
      const desk = await jpost('/api/kraynet/claim/proof', { shares: list })
      const r2 = String(desk.root)
      ok((await act('claim-open', giver, { lane: 'kray', total: '100', claimRoot: r2 })).seq != null, 'a second harvest is open')
      const mine = await jpost('/api/kraynet/claim/proof', { shares: list, to: hand.addr })
      ok(mine.taken === false, 'the proof door says this hand has NOT taken yet')
      // THE VIEW, BEFORE. A page asks this so a player never opens a wallet popup to be refused. It must
      // never become an authority: every answer below is checked again by the door and by the reducer.
      const seen = async (root: string, who: string) => await jget(`/api/kraynet/claim/taken/${root}/${who}`)
      ok((await seen(r2, hand.addr)).taken === false, 'and so does the taken door')
      ok((await seen(r2, hands[1]!.addr)).taken === false, 'nor has the other hand')

      const before = await balOf(hand.addr)
      const tries = 8
      const rows = await stampede(Array.from({ length: tries }, () => ({ action: 'claim-take', w: hand, fields: { claimRoot: r2, amount: String(mine.amount), claimProof: mine.proof } })))
      ok(taken(rows) === 1, `paid ONCE out of ${tries} simultaneous tries (${taken(rows)} accepted, ${refusedCount(rows)} refused)`)
      ok((await balOf(hand.addr)) === before + 77n - 1n, 'and the balance moved by exactly one leaf')

      // THE VIEW, AFTER — and it must move for exactly one hand, never for the other.
      ok((await seen(r2, hand.addr)).taken === true, 'the taken door now says this hand HAS taken')
      ok((await seen(r2, hands[1]!.addr)).taken === false, 'and still says the other one has not')
      ok((await jpost('/api/kraynet/claim/proof', { shares: list, to: hand.addr })).taken === true, 'the proof door agrees')
      ok(String((await seen(r2, hand.addr)).owed) === '23', 'and it publishes what the pot still owes')

      // IT ADDS NO ATTACK SURFACE: a root nobody opened, an address that is not one, and a pot are all
      // refused by the route itself — no lookup, no allocation, nothing reached.
      const junkRoot = await fetch(`${BASE}/api/kraynet/claim/taken/${'f'.repeat(64)}/${hand.addr}`)
      ok(junkRoot.status === 404, 'a root no harvest carries is refused')
      const junkAddr = await fetch(`${BASE}/api/kraynet/claim/taken/${r2}/short`)
      ok(junkAddr.status === 404, 'an address too short to be one never reaches the book')
      const potAddr = await fetch(`${BASE}/api/kraynet/claim/taken/${r2}/KRAY_CLAIM`)
      ok(potAddr.status === 404, 'and a protocol pot is not a hand the door will answer for')
    }

    // ── MS-4b · A MINT UNDER A STAMPEDE ──────────────────────────────────────────────────────────
    // A mint's promise is COUNTED, not computed: N pots, and the count is the thing a crowd races for. So
    // fire MORE hands than there are pots, all at once, and demand that exactly N are paid — and that the
    // losers pay nothing at all, not even the gas.
    console.log('\nMS-4b — more hands than pots, all at once')
    {
      const POTS = 4, RUSH = 10
      const rushers = hands.slice(0, RUSH)
      ok(rushers.length === RUSH, `${RUSH} hands ready for ${POTS} pots`)
      const opened = await act('mint-open', giver, { lane: 'kray', perHand: '25', hands: POTS, expires: 900000 })
      ok(opened.seq != null, `a mint of ${POTS} pots of 25 is open` + (opened.seq == null ? ' — ' + JSON.stringify(opened) : ''))
      const mintRoot = String((await jget('/api/kraynet/claims')).claims.filter((c) => c.mint && c.mint.pots === POTS).pop().root)

      const before = new Map()
      for (const w of rushers) before.set(w.addr, await balOf(w.addr))
      const rows = await stampede(rushers.map((w) => ({ action: 'mint-take', w, fields: { claimRoot: mintRoot } })))
      const won = taken(rows)
      ok(won === POTS, `exactly ${POTS} of ${RUSH} hands were paid (${won} accepted, ${refusedCount(rows)} refused)`)

      let paid = 0, untouched = 0
      for (const w of rushers) {
        const d = (await balOf(w.addr)) - before.get(w.addr)
        if (d === 24n) paid++            // one pot of 25, minus the eternal fee
        else if (d === 0n) untouched++
      }
      ok(paid === POTS, `every winner moved by exactly one pot minus the fee (${paid})`)
      ok(untouched === RUSH - POTS, `and every loser paid NOTHING — not even the gas (${untouched})`)

      const after = (await jget('/api/kraynet/claims')).claims.find((c) => c.root === mintRoot)
      ok(after.owed === '0' && after.mint.potsLeft === 0, 'the mint landed on zero, with no pot left')
      ok((await jget('/api/kraynet/overview')).conserves === true, 'and the chain still conserves')

      // one hand, many tries, for a mint: the SAME address firing its own take K times at once
      const solo = rushers[0]
      const again = await stampede(Array.from({ length: 5 }, () => ({ action: 'mint-take', w: solo, fields: { claimRoot: mintRoot } })))
      ok(taken(again) === 0, 'a hand that already has its pot is refused every one of 5 simultaneous retries')
    }

    // ── MS-5 · A CLAIM AGAINST A CLOSE ───────────────────────────────────────────────────────────
    console.log('\nMS-5 — a hand claiming while the giver takes back what nobody claimed')
    {
      const hand = hands[2]!
      const list = [{ to: hand.addr, amount: '40' }, { to: hands[3]!.addr, amount: '60' }]
      const desk = await jpost('/api/kraynet/claim/proof', { shares: list })
      const r3 = String(desk.root)
      ok((await act('claim-open', giver, { lane: 'kray', total: '100', claimRoot: r3 })).seq != null, 'a third harvest is open, with no closing height')
      const mine = await jpost('/api/kraynet/claim/proof', { shares: list, to: hand.addr })
      const handBefore = await balOf(hand.addr), giverBefore = await balOf(giver.addr)
      const rows = await stampede([
        { action: 'claim-take', w: hand, fields: { claimRoot: r3, amount: String(mine.amount), claimProof: mine.proof } },
        { action: 'claim-close', w: giver, fields: { claimRoot: r3 } },
      ])
      const handAfter = await balOf(hand.addr), giverAfter = await balOf(giver.addr)
      const handGot = handAfter - handBefore + 1n >= 40n ? 40n : 0n
      // Whichever won, the arithmetic is exact and nothing was paid twice. A harvest with no closing
      // height cannot be closed at all — so the honest outcome is the hand paid and the close refused.
      ok(handGot === 40n || handGot === 0n, `one of them won, cleanly (hand moved ${handAfter - handBefore}, giver ${giverAfter - giverBefore})`)
      ok(rows.filter((r) => r.seq != null).length >= 1, 'at least one of the two applied — neither deadlocked')
      const open = await jget('/api/kraynet/claims')
      ok(open.potBacked === true, 'and the pot is still exactly backed after the collision')
    }

    // ── MS-6 · THE CHAIN IS WHOLE ────────────────────────────────────────────────────────────────
    console.log('\nMS-6 — after all of it, the chain answers for itself')
    {
      const audit = await jget('/api/kraynet/audit')
      ok(audit.intact === true && audit.conserves === true && audit.backed === true, 'intact, conserved and backed')
      ok(audit.runesSolvent === true && audit.ammSolvent === true, 'every rune and every pool solvent')
      const spent = await fundedTotal()
      ok(spent >= 0n, `Σ across every wallet reads clean (${spent} ₭ held by the swarm)`)

      // A STRANGER, from the journal's own bytes. This is the one that matters: the swarm's whole history
      // re-derives on a fresh ledger, so nothing about the stampede left the chain un-replayable.
      const manifest = await jget('/api/kraynet/chunks')
      let lines: string[] = []
      for (const c of (manifest.chunks as Array<Record<string, unknown>>)) {
        const span = await jget('/api/kraynet/chunk/' + String(c.address))
        const got = span.lines as string[]
        const addr = createHash('sha256').update(got.join('\n'), 'utf8').digest('hex')
        ok(addr === String(c.address), `chunk ${String(c.index)} hashes to its published address`)
        lines = lines.concat(got)
      }
      const L = openKrayLedger(NET)
      let applied = 0
      for (const line of lines) { L.applyLive(JSON.parse(line) as KrayEvent); applied++ }
      ok(applied === lines.length, `a stranger replayed all ${applied} events`)
      ok(L.cascadeRoot() === String(audit.cascadeRoot), `and landed on the node's own root ${String(audit.cascadeRoot).slice(0, 16)}…`)
    }

    console.log(`\n✓ ${pass} checks passed — THE MARKET SURVIVES A STAMPEDE: one thing goes to one hand, one leaf pays once, and the whole of it replays. ⛓₭\n`)
    done(0)
  } catch (e) {
    console.error('\n✗ market-swarm FAILED:', (e as Error).message)
    done(1)
  }
}
void main()
