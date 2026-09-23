/**
 * THE DROP, OVER REAL HTTP — a listing at price zero, closed by the hand it was left for.
 *   node src/test/packet-door.itest.ts
 *
 * Boots `server.mjs` in a child process on a throwaway port + data dir, then drives the SAME public door a
 * wallet uses: prepare (the node returns the exact line to sign) → sign with a real key → submit. It proves
 * the WIRED link, which the reducer's own suite cannot: that the line the door tells a wallet to sign is the
 * line the law verifies, for a star gift with its terms and for a ₭ packet, and that /api/kraynet/market and
 * /api/kraynet/packets show those offers honestly.
 *
 * Regtest only — the gift and the packet market are pinned shut on signet and main.
 */
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, starListMessage } from '../protocol/scheme.ts'
import { starListV2Message } from '../protocol/star-market.ts'
import { packetTakeMessage } from '../protocol/packet-market.ts'

let pass = 0
function ok(cond: unknown, label: string): void { if (cond) { pass++; console.log('  ✓ ' + label); return } console.error(`  ✗ FAILED — ${label}`); throw new Error(label) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const NET = 'regtest'
const PORT = 4492
const BASE = `http://localhost:${PORT}`
const DATA = join(tmpdir(), `kraynet-packet-door-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')

function wallet(tag: string) {
  const sk = createHash('sha256').update(`packet-door|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address!, sk, pk: publicKeyHex }
}
type W = ReturnType<typeof wallet>
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)
const jget = (path: string) => fetch(BASE + path).then((r) => r.json()) as Promise<Record<string, unknown>>
const jpost = (path: string, body: unknown) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()) as Promise<Record<string, unknown>>
const prep = (b: unknown) => jpost('/api/kraynet/prepare', b)
const sub = (b: unknown) => jpost('/api/kraynet/submit', b)
const balOf = async (a: string) => BigInt(String((await jget('/api/kraynet/profile/' + encodeURIComponent(a))).balance ?? '0'))
const refused = (r: Record<string, unknown>, m: string) => ok(!!r.error, m + (r.error ? ` (${String(r.error).slice(0, 44)})` : ' — NOT refused!'))
const accepted = (r: Record<string, unknown>, m: string) => ok(r.seq != null, m + (r.error ? ` — refused: ${String(r.error).slice(0, 80)}` : ''))

async function bornStar(owner: W): Promise<bigint> {
  const body = 'drop-' + randomBytes(5).toString('hex'), ch = createHash('sha256').update(body).digest('hex')
  const p = await prep({ action: 'inscribe', from: owner.addr, content: body, contentType: 'text/plain', size: body.length })
  const r = await sub({ action: 'inscribe', from: owner.addr, content: body, contentHash: ch, contentType: 'text/plain', size: body.length, nonce: p.nonce, publicKey: owner.pk, signature: sign(String(p.message), owner) })
  if (r.star == null) throw new Error('could not born a star: ' + JSON.stringify(r).slice(0, 160))
  return BigInt(String(r.star))
}
/** Ask the door what to sign, sign exactly that, submit exactly that — the honest wallet's path. */
async function act(action: string, w: W, fields: Record<string, unknown>) {
  const body = { action, from: w.addr, ...fields }
  const p = await prep(body)
  if (p.error) return p
  return sub({ ...body, nonce: p.nonce, publicKey: w.pk, signature: sign(String(p.message), w) })
}

async function main() {
  console.log('\n╔═ THE DROP — live at the public door (prepare → sign → submit) ══╗\n')
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  const child = spawn('node', [SERVER], { env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_TRUSTED_DEV: '1' }, stdio: 'ignore' })
  process.on('exit', () => { try { child.kill('SIGKILL') } catch { /* already gone */ } })
  const done = (code: number) => { try { child.kill('SIGKILL') } catch { /* already gone */ } rmSync(DATA, { recursive: true, force: true }); process.exit(code) }
  try {
    let up = false
    for (let i = 0; i < 80; i++) { try { const h = await jget('/health'); if (h && h.ok) { up = true; break } } catch { /* not yet */ } await sleep(100) }
    ok(up, 'the door booted and answered /health')

    const giver = wallet('giver'), heir = wallet('heir'), stranger = wallet('stranger'), keyHolder = wallet('key')
    for (const w of [giver, heir, stranger, keyHolder]) await jpost('/api/kraynet/donate', { to: w.addr, sats: '600' })
    ok((await balOf(giver.addr)) === 600n, 'four wallets funded on the throwaway regtest node')

    // ── the star gift ────────────────────────────────────────────────────────────────────────
    const s1 = await bornStar(giver)
    accepted(await act('star-list', giver, { star: s1.toString(), price: '0' }), `a star listed at price 0 — the drop`)
    const before = await balOf(stranger.addr)
    accepted(await act('star-buy', stranger, { star: s1.toString(), price: '0', seller: giver.addr }), 'the first hand to sign takes it')
    ok((await balOf(stranger.addr)) === before - 1n, 'the taker paid the eternal 1 ₭ of gas and no price')

    // ── the named drop (the testament) ───────────────────────────────────────────────────────
    const s2 = await bornStar(giver)
    accepted(await act('star-list', giver, { star: s2.toString(), price: '0', to: heir.addr }), 'listed at 0, named for the heir')
    refused(await act('star-buy', stranger, { star: s2.toString(), price: '0', seller: giver.addr }), 'a stranger cannot take a named drop')
    accepted(await act('star-buy', heir, { star: s2.toString(), price: '0', seller: giver.addr }), 'the named heir takes it')

    // ── the relay cannot add or strip a term the wallet did not sign ─────────────────────────
    const s3 = await bornStar(giver)
    const n3 = Number((await prep({ action: 'star-list', from: giver.addr, star: s3.toString(), price: '0' })).nonce)
    refused(await sub({ action: 'star-list', from: giver.addr, star: s3.toString(), price: '0', to: stranger.addr, nonce: n3, publicKey: giver.pk, signature: sign(starListMessage(NET, giver.addr, s3, 0n, n3), giver) }),
      'a name ADDED after signing is refused')
    const n3b = Number((await prep({ action: 'star-list', from: giver.addr, star: s3.toString(), price: '0', to: heir.addr })).nonce)
    refused(await sub({ action: 'star-list', from: giver.addr, star: s3.toString(), price: '0', nonce: n3b, publicKey: giver.pk, signature: sign(starListV2Message(NET, giver.addr, s3, 0n, { to: heir.addr }, n3b), giver) }),
      'a name STRIPPED after signing is refused')

    // ── a key star opens it ──────────────────────────────────────────────────────────────────
    const key = await bornStar(keyHolder), s4 = await bornStar(giver)
    accepted(await act('star-list', giver, { star: s4.toString(), price: '0', gateStar: key.toString() }), `listed at 0, opened only by a star`)
    refused(await act('star-buy', stranger, { star: s4.toString(), price: '0', seller: giver.addr }), 'whoever does not hold the key is refused')
    accepted(await act('star-buy', keyHolder, { star: s4.toString(), price: '0', seller: giver.addr }), 'the key-holder takes it')

    // ── a bequest waits for Bitcoin ──────────────────────────────────────────────────────────
    const s5 = await bornStar(giver)
    accepted(await act('star-list', giver, { star: s5.toString(), price: '0', to: heir.addr, notBefore: '20000000' }), 'listed for the heir, not before height 20,000,000')
    refused(await act('star-buy', heir, { star: s5.toString(), price: '0', seller: giver.addr }), 'even the heir waits for the chain\'s own clock')
    const market = await jget('/api/kraynet/market')
    const row = (market.listings as Array<Record<string, unknown>> | undefined)?.find((l) => String(l.star) === s5.toString())
    ok(row && row.drop === true && row.to === heir.addr && row.notBefore === 20000000, 'the market view shows the drop, its heir and the height it waits for')

    // ── the door refuses a term it cannot honour, instead of quietly dropping it ─────────────
    // To the LAW an ill-formed term is absent (that is what stops a relay from killing an honest act by
    // appending one). To a CITIZEN that silence would be theft: a bequest meant to open at a future height
    // would fall through as a listing anyone can take right now. The door refuses it, by name, up front.
    const s6 = await bornStar(giver)
    for (const bad of ['0', '-1', '1.5', '21000001', '2026-12-01']) {
      const r = await prep({ action: 'star-list', from: giver.addr, star: s6.toString(), price: '0', to: heir.addr, notBefore: bad })
      ok(typeof r.error === 'string' && /Bitcoin height/.test(String(r.error)), `a height of "${bad}" is refused at the door, never silently dropped`)
    }
    const rg = await prep({ action: 'star-list', from: giver.addr, star: s6.toString(), price: '0', gateStar: 'seven' })
    ok(typeof rg.error === 'string' && /canonical star number/.test(String(rg.error)), 'a key star that is not a star number is refused at the door')

    // ── the ₭ packet ─────────────────────────────────────────────────────────────────────────
    accepted(await act('packet-list', giver, { lane: 'kray', amount: '100', price: '0', to: heir.addr }), '100 ₭ listed at price 0, named for the heir')
    refused(await act('packet-take', stranger, { lane: 'kray', seller: giver.addr, amount: '100', price: '0' }), 'a stranger cannot take the named packet')
    refused(await act('packet-take', heir, { lane: 'kray', seller: giver.addr, amount: '99', price: '0' }), 'a partial take is refused — a packet is whole or nothing')
    const packets = await jget('/api/kraynet/packets')
    const prow = (packets.listings as Array<Record<string, unknown>> | undefined)?.[0]
    ok(prow && prow.lane === 'kray' && prow.drop === true && prow.fillable === true, 'the packet view shows the lane, the drop and that it is still fillable')
    const heirBefore = await balOf(heir.addr)
    accepted(await act('packet-take', heir, { lane: 'kray', seller: giver.addr, amount: '100', price: '0' }), 'the heir takes the whole packet')
    ok((await balOf(heir.addr)) === heirBefore + 100n - 1n, 'the heir received 100 ₭ and paid exactly 1 ₭ of gas')

    accepted(await act('packet-list', giver, { lane: 'kray', amount: '50', price: '10' }), '50 ₭ listed at a price of 10 ₭')
    const n6 = Number((await prep({ action: 'packet-take', from: stranger.addr, lane: 'kray', seller: giver.addr, amount: '50', price: '10' })).nonce)
    refused(await sub({ action: 'packet-take', from: stranger.addr, lane: 'kray', seller: giver.addr, amount: '50', price: '10', nonce: n6, publicKey: stranger.pk, signature: sign(packetTakeMessage(NET, stranger.addr, giver.addr, 'kray', '', 50n, 1n, n6), stranger) }),
      'paying the line but signing a cheaper price is refused')
    const sBefore = await balOf(stranger.addr)
    accepted(await act('packet-take', stranger, { lane: 'kray', seller: giver.addr, amount: '50', price: '10' }), 'the honest taker pays price + gas and receives the packet')
    ok((await balOf(stranger.addr)) === sBefore + 50n - 10n - 1n, 'exactly +50 ₭ −10 ₭ price −1 ₭ gas')

    accepted(await act('packet-list', giver, { lane: 'kray', amount: '30', price: '3' }), 'another packet listed')
    accepted(await act('packet-delist', giver, { lane: 'kray' }), 'and withdrawn by its own seller')
    refused(await act('packet-take', stranger, { lane: 'kray', seller: giver.addr, amount: '30', price: '3' }), 'a withdrawn packet cannot be taken')

    // ── THE DOOR AS A HOSTILE SURFACE ────────────────────────────────────────────────────────
    // Every check below was a real defect found by attacking this door. They are pinned so they cannot
    // come back: what a citizen is told to sign must be what they asked for, or they must be told no.
    {
      // A ROW HANDED STRAIGHT BACK KEEPS ITS KEY STAR. The read routes publish `gate`; the write door
      // always read `gateStar`, so a client that re-listed from its own row lost the condition IN SILENCE
      // and a stranger took the star.
      const key = await bornStar(keyHolder)
      const gated = await bornStar(giver)
      accepted(await act('star-list', giver, { star: gated.toString(), price: '0', gateStar: key.toString() }), 'a gated offer is listed')
      const row = ((await jget('/api/kraynet/market')).listings as Array<Record<string, unknown>>).find((l) => String(l.star) === gated.toString())!
      ok(String(row.gate) === key.toString(), 'the market row publishes the key star as `gate`')
      // re-list from that row verbatim, the way any client would
      accepted(await act('star-list', giver, { star: gated.toString(), price: '50', gate: row.gate }), 'the same row is handed back to the door')
      const after = ((await jget('/api/kraynet/market')).listings as Array<Record<string, unknown>>).find((l) => String(l.star) === gated.toString())!
      ok(String(after.gate) === key.toString(), 'and the key star SURVIVES the round trip — it is not dropped in silence')
      refused(await act('star-buy', stranger, { star: gated.toString(), price: '50', seller: giver.addr }), 'so a stranger still cannot take it')
      const both = await prep({ action: 'star-list', from: giver.addr, star: gated.toString(), price: '0', gate: '1', gateStar: '2' })
      ok(/ONE key star|disagree/.test(String(both.error)), 'and naming two different key stars is refused, never guessed')
    }
    {
      // NOTHING IS LAUNDERED. `String(x)` and `Number(x)` turn a hostile body into a line the citizen never
      // meant: a JSON number rounds, `true` becomes height 1, "0x10" becomes 16, an array becomes its join.
      const probe = async (body: Record<string, unknown>, what: string) => {
        const r = await prep({ from: giver.addr, ...body })
        ok(typeof r.error === 'string', `${what} is refused at the door, not laundered into a signed line`)
      }
      await probe({ action: 'packet-list', lane: 'kray', amount: '10', price: 9007199254740993 }, 'a price beyond safe integers')
      await probe({ action: 'packet-list', lane: ['kray'], amount: '1', price: '0' }, 'a lane that is a list')
      await probe({ action: 'packet-list', lane: 'luz', star: 7.5, amount: '1', price: '0' }, 'a star that is not a whole number')
      {
        // An EXACT safe integer loses nothing, so it is canonicalised rather than refused — and what rides
        // to the reducer is the canonical string, which is the only spelling the law accepts.
        const r = await prep({ from: giver.addr, action: 'packet-list', lane: 'luz', star: 0, amount: '1', price: '0' })
        ok(typeof r.message === 'string' && /\|asset=0\|/.test(String(r.message)), 'an exact whole number for a star is canonicalised, never rounded')
      }
      await probe({ action: 'packet-list', lane: 'kray', amount: ['100'], price: '0' }, 'an amount that is a list')
      await probe({ action: 'star-list', star: '1', price: '0', notBefore: true }, 'a height that is a boolean')
      await probe({ action: 'star-list', star: '1', price: '0', notBefore: '0x10' }, 'a height in hex')
      await probe({ action: 'star-list', star: '1', price: '0', notBefore: '2e7' }, 'a height in exponent form')
      await probe({ action: 'star-list', star: '1', price: 1e21 }, 'a price the door once signed in one spelling and submitted in another')
      await probe({ action: 'packet-list', lane: 'kray', amount: '0', price: '0' }, 'a packet of nothing')
      await probe({ action: 'packet-take', lane: 'kray', amount: '1', price: '0' }, 'a take with no seller')
      await probe({ action: 'star-list', star: '1', price: '0', to: giver.addr }, 'an offer named for yourself')
      await probe({ action: 'star-list', star: '1', price: '0', to: 'KRAY_TREASURY' }, 'an offer left to a protocol pot')
      await probe({ action: 'star-list', star: '3', price: '0', gateStar: '3' }, 'an offer opened by the very star it offers')
      await probe({ action: 'packet-list', lane: 'kray', amount: '1'.repeat(1_000_000), price: '0' }, 'a million-digit amount (a free freeze)')
      {
        // The bound is the widest LEGITIMATE value, not a round number: a rune amount is u128, 39 digits.
        // A bound below that would refuse an honest packet; one above it buys an attacker nothing.
        const u128Max = ((1n << 128n) - 1n).toString()
        const r = await prep({ from: giver.addr, action: 'packet-list', lane: 'rune', runeId: '840000:7', amount: u128Max, price: '0' })
        ok(typeof r.message === 'string' && String(r.message).includes(`amount=${u128Max}`), 'the widest honest rune amount (u128, 39 digits) still passes the door')
        await probe({ action: 'packet-list', lane: 'rune', runeId: '840000:7', amount: '9'.repeat(41), price: '0' }, 'but a number wider than any book can hold')
      }
    }
    {
      // A VIEW MUST NOT PROMISE WHAT THE CHAIN FORBIDS. `fillable` ignored the offer's own height and told
      // every visitor a waiting bequest was takeable now.
      accepted(await act('packet-list', giver, { lane: 'kray', amount: '40', price: '0', notBefore: '21000000' }), 'a packet that waits for a far Bitcoin height')
      const row = ((await jget('/api/kraynet/packets')).listings as Array<Record<string, unknown>>).find((l) => String(l.amount) === '40')!
      ok(row.fillable === false, 'the view says it is NOT fillable while the chain is sealed below its height')
      ok(row.openToAnyone === true, 'and says plainly that no name or key stands in the way, only the clock')
      refused(await act('packet-take', stranger, { lane: 'kray', seller: giver.addr, amount: '40', price: '0' }), 'and the law agrees')
      accepted(await act('packet-delist', giver, { lane: 'kray' }), 'the giver withdraws it again')
    }

    // ── THE CLAIM ESCROW, END TO END ─────────────────────────────────────────────────────────
    // A land attests a harvest once; every hand proves its own share and takes it. The node never holds
    // the list — the proof desk is pure arithmetic over a list the caller brings.
    {
      const shares = [{ to: heir.addr, amount: '120' }, { to: stranger.addr, amount: '45' }, { to: keyHolder.addr, amount: '5' }]
      const desk = await jpost('/api/kraynet/claim/proof', { shares })
      ok(typeof desk.root === 'string' && /^[0-9a-f]{64}$/.test(String(desk.root)) && desk.hands === 3, 'the proof desk returns the harvest root for a brought list')
      accepted(await act('claim-open', giver, { lane: 'kray', total: '170', claimRoot: desk.root }), 'the giver opens the harvest — 170 ₭ leave their hand')
      const view = await jget('/api/kraynet/claims')
      const row = (view.claims as Array<Record<string, unknown>>)[0]!
      ok(row.owed === '170' && row.hands === 0 && view.potBacked === true, 'the node shows what the pot owes, and that the pot is backed')

      const mine = await jpost('/api/kraynet/claim/proof', { shares, to: heir.addr })
      ok(mine.inList === true && mine.amount === '120' && Array.isArray(mine.proof), 'a hand asks the desk for its own path')
      const before = await balOf(heir.addr)
      accepted(await act('claim-take', heir, { claimRoot: desk.root, amount: mine.amount, claimProof: mine.proof }), 'and takes its share with that path')
      ok((await balOf(heir.addr)) === before + 120n - 1n, 'exactly its leaf, less the eternal 1 ₭ of gas')
      refused(await act('claim-take', heir, { claimRoot: desk.root, amount: mine.amount, claimProof: mine.proof }), 'a second helping is refused')

      const notMine = await jpost('/api/kraynet/claim/proof', { shares, to: giver.addr })
      ok(notMine.inList === false, 'the desk tells a hand that is not in the list, plainly')
      refused(await act('claim-take', giver, { claimRoot: desk.root, amount: '120', claimProof: mine.proof }), 'and borrowing somebody else\'s path is refused at the door')
      const after = await jget('/api/kraynet/claims')
      ok((after.claims as Array<Record<string, unknown>>)[0]!.owed === '50' && after.potBacked === true, 'the pot still owes exactly the two hands that have not come')
      // THE CONTRACT WITH THE WORLD. A counter discovers what a harvest pays for by dividing its ORIGINAL
      // total by the raw tally a season published — `owed` shrinks with every hand and cannot be divided
      // by. KRAYVERSE read `owed` once and went blind the instant anybody claimed first; the number it
      // needs has always been here, and this pin is why it will stay.
      const open = (after.claims as Array<Record<string, unknown>>)[0]!
      ok(open.total === '170' && open.owed === '50', 'the book publishes BOTH what was opened and what is left')
      ok(typeof open.root === 'string' && typeof open.giver === 'string' && typeof open.lane === 'string',
        'and the three public facts a stranger needs to find a harvest without asking its giver')

    }

    // ── the floor a person can actually look at ──────────────────────────────────────────────
    const page = await fetch(BASE + '/market/drops').then((r) => ({ status: r.status, body: r.text() }))
    const html = await page.body
    ok(page.status === 200 && /KRAY\.NETWORK · Drops/.test(html), 'the drops floor is served at /market/drops')
    ok(/\/api\/kraynet\/packets/.test(html) && /\/api\/kraynet\/market/.test(html), 'and it reads the node\'s own two books, not a cache')
    ok(/Packets for sale/.test(html), 'and a priced packet is not invisible — the whole book has somewhere to appear')
    ok(/src="\/kray\.js(\?v=[0-9a-f]+)?"/.test(html), 'the floor wears the same header every other page wears')

    // ── and the escrow's own window ──────────────────────────────────────────────────────────
    // The claim works from anywhere even when a land's server is dark — which was only true for somebody
    // who could write code until this page existed. It handles a LIST and a ROOT and never learns what
    // the work was, which is exactly why a game, a radio and a payroll can all use one pot.
    for (const path of ['/harvests', '/market/harvests']) {
      const floor = await fetch(BASE + path)
      const body = await floor.text()
      ok(floor.status === 200 && /KRAY\.NETWORK · Harvests/.test(body), `the harvest floor is served at ${path}`)
      ok(/\/api\/kraynet\/claims/.test(body) && /\/api\/kraynet\/claim\/proof/.test(body),
        `and ${path} reads the node's own book and its own desk, not a cache`)
      ok(/src="\/kray\.js(\?v=[0-9a-f]+)?"/.test(body), `${path} wears the same header every other page wears`)
    }
    // A window nobody can reach is not a window. Every market floor names it, or it does not exist.
    ok(/href="\/harvests"/.test(html), 'and the drops floor names the harvest floor, so it can be found at all')
    ok(/Leave something on the ground/.test(html) && /data-what="star"/.test(html) && /data-what="kray"/.test(html) && /data-what="luz"/.test(html) && /data-what="rune"/.test(html),
      'and carries the counter where a citizen leaves one — a star, ₭, Luz or a rune')
    ok(/id="i-who"/.test(html) && /id="i-not"/.test(html) && /One hand, not a list/.test(html),
      'with the conditions folded away, one question for WHO, and the honest word that there is no comma-list')
    ok(/\.leave \.field\[hidden\]\{display:none\}/.test(html),
      'and a field the chosen lane does not need is really hidden — `.field{display:grid}` outranks the browser\'s own [hidden]')
    ok(/data-take=/.test(html) && /data-pull=/.test(html), 'and a hand can take, or withdraw its own, from the floor itself')
    const starPage = await fetch(BASE + '/star/1').then((r) => r.text())
    ok(/\/market\/drops\?star=/.test(starPage), 'a star\'s own page points at the counter with that star already in hand')
    const starFloor = await fetch(BASE + '/market/star').then((r) => r.text())
    ok(/left for /.test(starFloor) && /opens at Bitcoin height /.test(starFloor) && /only whoever holds/.test(starFloor),
      'the star floor names a term instead of offering a buy the law would refuse')
    for (const floor of ['/market', '/market/star', '/market/luz']) {
      const other = await fetch(BASE + floor).then((r) => r.text())
      ok(/href="\/market\/drops"/.test(other), `the floor at ${floor} links to the drops`)
    }

    // ── AND ON A NETWORK WHERE THE LAW IS PINNED SHUT, THE DOOR SAYS SO ──────────────────────
    // The rune book's gate is asked in both halves of the door; these two pins were not, so a signet node
    // handed out lines for acts its own reducer could only burn. A second node, on signet, proves it now.
    {
      const sPort = PORT + 3
      const sData = DATA + '-signet'
      rmSync(sData, { recursive: true, force: true }); mkdirSync(sData, { recursive: true })
      const sChild = spawn('node', [SERVER], { env: { ...process.env, KRAY_PORT: String(sPort), KRAY_DATA: sData, KRAY_NET: 'signet', KRAY_TRUSTED_DEV: '1' }, stdio: 'ignore' })
      try {
        let sUp = false
        for (let i = 0; i < 80; i++) { try { const h = await fetch(`http://localhost:${sPort}/health`).then((r) => r.json()); if (h && h.ok) { sUp = true; break } } catch { /* not yet */ } await sleep(100) }
        ok(sUp, 'a signet node booted beside it')
        const sPrep = (body: unknown) => fetch(`http://localhost:${sPort}/api/kraynet/prepare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()) as Promise<Record<string, unknown>>
        const signetAddr = 'tb1pzfrd4agncf2aet4fwdgap9u49vu7y649j2642lx4pvwgalwkw65quuk8vk'
        for (const body of [
          { action: 'packet-list', lane: 'kray', amount: '100', price: '5' },
          { action: 'packet-delist', lane: 'kray' },
          { action: 'packet-take', lane: 'kray', seller: signetAddr, amount: '1', price: '0' },
        ]) {
          const r = await sPrep({ from: signetAddr, ...body })
          ok(/not the law on this network yet/.test(String(r.error)), `signet: the door refuses to prepare ${body.action} — the packet market is pinned shut there`)
        }
        // THE ESCROW'S SIX, which the first mirror forgot — and the gap reached mainnet: the door prepared
        // a `claim-open` on a network whose reducer refuses every claim act, so a citizen would have signed
        // for nothing. A pin that is not asked for at the door is a pin that is only half a law.
        const ROOT64 = 'a'.repeat(64)
        for (const body of [
          { action: 'claim-open', lane: 'kray', total: '10', claimRoot: ROOT64 },
          { action: 'claim-take', claimRoot: ROOT64, amount: '1', claimProof: [] },
          { action: 'claim-close', claimRoot: ROOT64 },
          { action: 'pool-fund', lane: 'kray', total: '10' },
          { action: 'pool-season', lane: 'kray', amount: '1', claimRoot: ROOT64 },
          { action: 'pool-close', lane: 'kray' },
        ]) {
          const r = await sPrep({ from: signetAddr, ...body })
          ok(/not the law on this network yet/.test(String(r.error)), `signet: the door refuses to prepare ${body.action} — the claim escrow is pinned shut there`)
        }
        const gift = await sPrep({ from: signetAddr, action: 'star-list', star: '1', price: '0' })
        ok(/positive price|not its law/.test(String(gift.error)), 'signet: the door refuses to prepare a price-zero listing — the gift is pinned shut there')
        const terms = await sPrep({ from: signetAddr, action: 'star-list', star: '1', price: '5', to: signetAddr.replace('quuk8vk', 'quuk8vq') })
        ok(/not the law on this network yet/.test(String(terms.error)), 'signet: nor one carrying terms')
        const plain = await sPrep({ from: signetAddr, action: 'star-list', star: '1', price: '5' })
        ok(typeof plain.message === 'string' && /star-list\.v1\|net=signet/.test(String(plain.message)), 'signet: and the law that IS in force there still answers')
      } finally { try { sChild.kill('SIGKILL') } catch { /* gone */ } rmSync(sData, { recursive: true, force: true }) }
    }

    console.log(`\n✓ ${pass} checks passed — THE DROP HOLDS AT THE DOOR: the line the wallet is told to sign is the line the law verifies. ⛓₭\n`)
    done(0)
  } catch (e) {
    console.error('itest error:', (e as Error).message)
    done(1)
  }
}
main()
