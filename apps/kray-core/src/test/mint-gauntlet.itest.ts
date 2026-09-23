/**
 * THE MINT GAUNTLET — every way a hand could try to corrupt a mint, fired at a REAL HTTP door.
 *
 *   node src/test/mint-gauntlet.itest.ts
 *
 * `mint-drop.test.ts` proves the reducer in-process. This proves the WIRE: a live node, real signatures,
 * and an attacker who lies in every field the protocol has. The question it answers is not "does the happy
 * path work" — it is "can anything but a valid signature over the exact canonical line move one unit".
 *
 * THE INVARIANT UNDER ALL OF IT: after every attack, Σ across every hand, the Treasury and the pots is
 * exactly what it was before, and the chain re-derives from its own journal.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes } from '../protocol/scheme.ts'
import { mintId, mintTakeMessage, mintOpenMessage, CLAIM_MAX_HANDS } from '../protocol/claim-book.ts'

const NET = 'regtest', PORT = 4496, BASE = `http://127.0.0.1:${PORT}`
const DATA = join(tmpdir(), `kraynet-mint-gauntlet-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0
const ok = (c: unknown, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function wallet(tag: string) {
  const sk = createHash('sha256').update(`mint-gauntlet|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { tag, addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address!, sk, pk: publicKeyHex }
}
type W = ReturnType<typeof wallet>
const jget = (p: string) => fetch(BASE + p).then((r) => r.json()) as Promise<Record<string, any>>
const jpost = (p: string, b: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()) as Promise<Record<string, any>>
const balOf = async (a: string) => BigInt(String((await jget('/api/kraynet/profile/' + encodeURIComponent(a))).balance ?? '0'))

/** The honest path: ask the door what to sign, sign exactly that, submit exactly that. */
async function act(action: string, w: W, fields: Record<string, unknown>) {
  const body = { action, from: w.addr, ...fields }
  const p = await jpost('/api/kraynet/prepare', body)
  if (p.error) return p
  return jpost('/api/kraynet/submit', { ...body, nonce: p.nonce, publicKey: w.pk, signature: _signKrayWallet(String(p.message), w.sk) })
}
/** An ATTACK: prepare one thing, submit another — or sign with the wrong key, or forge the line outright. */
async function attack(action: string, w: W, prepFields: Record<string, unknown>, twist: {
  submitFields?: Record<string, unknown>; signer?: W; signWhat?: string; nonce?: number; publicKey?: string; signature?: string
}) {
  const body = { action, from: w.addr, ...prepFields }
  const p = await jpost('/api/kraynet/prepare', body)
  const message = twist.signWhat ?? (p.error ? '' : String(p.message))
  const signer = twist.signer ?? w
  const sig = twist.signature ?? (message ? _signKrayWallet(message, signer.sk) : 'ff'.repeat(64))
  return jpost('/api/kraynet/submit', {
    ...body, ...(twist.submitFields ?? {}),
    nonce: twist.nonce ?? p.nonce ?? 0, publicKey: twist.publicKey ?? signer.pk, signature: sig,
  })
}
const stampede = async (entries: Array<{ action: string; w: W; fields: Record<string, unknown> }>) => {
  const armed = await Promise.all(entries.map(async (e) => {
    const body = { action: e.action, from: e.w.addr, ...e.fields }
    return { body, prep: await jpost('/api/kraynet/prepare', body), w: e.w }
  }))
  return Promise.all(armed.map(async ({ body, prep, w }) =>
    prep.error ? prep : jpost('/api/kraynet/submit', { ...body, nonce: prep.nonce, publicKey: w.pk, signature: _signKrayWallet(String(prep.message), w.sk) })))
}
const won = (rows: Record<string, any>[]) => rows.filter((r) => r.seq != null).length

async function main() {
  console.log('\n╔═ THE MINT GAUNTLET — every lie a wire can carry, at a real door ═╗\n')
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  const child = spawn('node', [SERVER], { env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_TRUSTED_DEV: '1' }, stdio: 'ignore' })
  process.on('exit', () => { try { child.kill('SIGKILL') } catch { /* gone */ } })
  const done = (code: number) => { try { child.kill('SIGKILL') } catch { /* gone */ } rmSync(DATA, { recursive: true, force: true }); process.exit(code) }

  try {
    let up = false
    for (let i = 0; i < 120 && !up; i++) { try { const h = await jget('/health'); up = !!(h && h.ok) } catch { /* not yet */ } if (!up) await sleep(100) }
    ok(up, 'the door booted')

    const giver = wallet('giver'), thief = wallet('thief'), hands = Array.from({ length: 12 }, (_, i) => wallet('h' + i))
    const everyone = [giver, thief, ...hands]
    for (const w of everyone) await jpost('/api/kraynet/donate', { to: w.addr, sats: '5000' })
    const sumAll = async () => {
      let s = 0n
      for (const w of everyone) s += await balOf(w.addr)
      return s + (await balOf('KRAY_TREASURY')) + (await balOf('KRAY_CLAIM'))
    }
    const SUPPLY = await sumAll()
    ok(SUPPLY > 0n, `every hand is funded — Σ starts at ${SUPPLY}`)

    // ── G-1 · OPENING A MINT: every field lied about ─────────────────────────────────────────
    console.log('\nG-1 — the open, attacked field by field')
    const base = { lane: 'kray', perHand: '50', hands: 4, expires: 900000 }
    const bad = async (fields: Record<string, unknown>, label: string, re: RegExp) => {
      const r = await act('mint-open', giver, { ...base, ...fields })
      ok(r.error != null && re.test(String(r.error)), `${label} → refused${r.error ? '' : ' — IT WAS ACCEPTED'}${r.error && !re.test(String(r.error)) ? ' (wrong reason: ' + r.error + ')' : ''}`)
    }
    await bad({ expires: 0 }, 'a mint with no closing height', /may not say 0|Bitcoin height/)
    await bad({ expires: -5 }, 'a negative height', /may not say 0|Bitcoin height/)
    await bad({ expires: 99_000_000 }, 'a height Bitcoin cannot reach', /Bitcoin height|21,000,000/)
    await bad({ hands: 0 }, 'zero pots', /at least one pot/)
    await bad({ hands: -3 }, 'negative pots', /at least one pot/)
    await bad({ hands: CLAIM_MAX_HANDS + 1 }, 'more pots than the one ceiling', /at most|ceiling|pots/)
    await bad({ perHand: '0' }, 'a pot that pays nothing', /positive|a pot/)
    await bad({ perHand: '99999999' }, 'promising what the giver has not got', /do not hold|insufficient/)
    await bad({ gateStar: '7' }, 'a gate on holding ONE star', /ONE star|unclaimable/)
    await bad({ gateChildOf: '999999' }, 'a gate on a land that does not exist', /no star|does not exist/)

    // ── G-2 · THE SIGNATURE IS THE ONLY KEY ──────────────────────────────────────────────────
    console.log('\nG-2 — the signature, forged every way')
    const before2 = await sumAll()
    const forged = await attack('mint-open', giver, base, { signer: thief })
    ok(forged.error != null, `a mint signed by somebody else → refused ("${String(forged.error).slice(0, 60)}…")`)
    const junk = await attack('mint-open', giver, base, { signature: 'ab'.repeat(64) })
    ok(junk.error != null, 'a mint with a junk signature → refused')
    const wrongKey = await attack('mint-open', giver, base, { publicKey: thief.pk })
    ok(wrongKey.error != null, "a mint carrying the thief's public key → refused")
    // SIGN ONE LINE, SUBMIT ANOTHER: honest terms signed, richer terms submitted
    const honestLine = mintOpenMessage(NET, giver.addr, 'kray', '', 50n, 4, null, 900000, 0)
    const swapped = await attack('mint-open', giver, base, { signWhat: honestLine, submitFields: { perHand: '500' } })
    ok(swapped.error != null, 'terms signed small, submitted BIG → refused (the line is the law)')
    ok((await sumAll()) === before2, 'and not one unit moved through any of it')

    // ── G-3 · AN HONEST MINT, then every way to take more than one pot ───────────────────────
    console.log('\nG-3 — one honest mint, then the takers lie')
    const nonce = Number((await jpost('/api/kraynet/prepare', { action: 'mint-open', from: giver.addr, ...base })).nonce)
    const root = mintId(NET, giver.addr, 'kray', '', 50n, 4, null, nonce)
    const opened = await act('mint-open', giver, base)
    ok(opened.seq != null, `a mint of 4 pots of 50 is open at its own derived id (${root.slice(0, 12)}…)`)
    ok(String((await jget('/api/kraynet/claims')).claims.find((c: any) => c.root === root)?.total) === '200', 'its total is perHand × pots, computed')

    const h0 = hands[0]!, h1 = hands[1]!
    const b0 = await balOf(h0.addr)
    ok((await act('mint-take', h0, { claimRoot: root })).seq != null, 'an honest hand takes one pot')
    ok((await balOf(h0.addr)) === b0 + 50n - 1n, 'and is paid exactly one pot, minus the eternal fee')

    const again = await act('mint-take', h0, { claimRoot: root })
    ok(again.error != null && /already taken your pot/.test(String(again.error)), 'the same hand asking twice → refused by name')
    // AMOUNT INJECTION: a take carries no amount, so try to smuggle one in
    const greedy = await attack('mint-take', h1, { claimRoot: root }, { submitFields: { amount: '100000' } })
    const b1 = await balOf(h1.addr)
    ok(greedy.seq == null || b1 <= 5000n + 50n, `smuggling an amount onto a take changes nothing (${greedy.seq != null ? 'applied, paid one pot' : 'refused'})`)
    // ROOT SWAP: sign for this mint, submit against another root
    const otherRoot = 'd'.repeat(64)
    const swap = await attack('mint-take', hands[2]!, { claimRoot: root }, { submitFields: { claimRoot: otherRoot } })
    ok(swap.error != null, 'signing for one mint and submitting another root → refused')
    // NONCE REPLAY — a REAL one: spend the nonce on another act first, then reuse that exact number.
    // (Passing 0 to a wallet that has never acted is not a replay; it is that wallet's honest next nonce.)
    const rep = hands[3]!
    const spent = Number((await jpost('/api/kraynet/prepare', { action: 'transfer', from: rep.addr, to: thief.addr, amount: '1' })).nonce)
    ok((await act('transfer', rep, { to: thief.addr, amount: '1' })).seq != null, `a hand spends nonce ${spent} on an honest transfer`)
    const replay = await attack('mint-take', rep, { claimRoot: root }, { nonce: spent })
    ok(replay.error != null, `and a take reusing that same spent nonce → refused ("${String(replay.error).slice(0, 50)}…")`)
    // A POT CANNOT TAKE
    const potTake = await jpost('/api/kraynet/prepare', { action: 'mint-take', from: 'KRAY_CLAIM', claimRoot: root })
    ok(potTake.error != null, 'a protocol pot asking for a pot → refused at the door')

    // THE DOOR MUST REFUSE BEFORE THE SIGNATURE. A refusal that arrives only at `submit` still opened a
    // wallet popup — the citizen approved, and only then learned there was nothing for them.
    const doorTwice = await jpost('/api/kraynet/prepare', { action: 'mint-take', from: h0.addr, claimRoot: root })
    ok(doorTwice.error != null && doorTwice.message == null && /already taken your pot/.test(String(doorTwice.error)),
      `the door refuses a SECOND take before any signature ("${String(doorTwice.error).slice(0, 44)}…")`)
    const doorGhost = await jpost('/api/kraynet/prepare', { action: 'mint-take', from: hands[5]!.addr, claimRoot: 'e'.repeat(64) })
    ok(doorGhost.error != null && /no mint is open/.test(String(doorGhost.error)), 'and a root no mint carries is named plainly at the door')
    const doorStar = await jpost('/api/kraynet/prepare', { action: 'mint-take', from: hands[5]!.addr, claimRoot: root, star: '7' })
    ok(doorStar.error != null && /has no gate/.test(String(doorStar.error)), 'and naming a star on an ungated mint is refused at the door')

    // ── G-4 · THE CAP, UNDER A STAMPEDE ──────────────────────────────────────────────────────
    console.log('\nG-4 — more hands than pots remain, all in one instant')
    const left = (await jget('/api/kraynet/claims')).claims.find((c: any) => c.root === root)!.mint.potsLeft
    const rushers = hands.slice(4, 4 + Math.max(6, left + 5))
    const pre = new Map<string, bigint>()
    for (const w of rushers) pre.set(w.addr, await balOf(w.addr))
    const rows = await stampede(rushers.map((w) => ({ action: 'mint-take', w, fields: { claimRoot: root } })))
    ok(won(rows) === left, `exactly the ${left} remaining pots were paid to ${rushers.length} racing hands (${won(rows)} won)`)
    let untouched = 0
    for (const w of rushers) if ((await balOf(w.addr)) === pre.get(w.addr)) untouched++
    ok(untouched === rushers.length - left, `every loser paid NOTHING — not even the gas (${untouched})`)
    const after4 = (await jget('/api/kraynet/claims')).claims.find((c: any) => c.root === root)
    ok(after4.owed === '0' && after4.mint.potsLeft === 0, 'the mint landed on zero with no pot left')
    const late = await act('mint-take', thief, { claimRoot: root })
    ok(late.error != null && /every pot/.test(String(late.error)), 'a latecomer is refused by the CAP, not by arithmetic')

    // ── G-5 · THE GATE, LIED ABOUT ───────────────────────────────────────────────────────────
    console.log('\nG-5 — a gated mint, and every lie about the star')
    const bornBody = 'gauntlet-land-' + Math.random().toString(36).slice(2)
    const bp = await jpost('/api/kraynet/prepare', { action: 'inscribe', from: giver.addr, content: bornBody, contentType: 'text/plain', size: bornBody.length })
    const land = await jpost('/api/kraynet/submit', { action: 'inscribe', from: giver.addr, content: bornBody, contentHash: createHash('sha256').update(bornBody).digest('hex'), contentType: 'text/plain', size: bornBody.length, nonce: bp.nonce, publicKey: giver.pk, signature: _signKrayWallet(String(bp.message), giver.sk) })
    ok(land.star != null, `a land star #${land.star} exists to gate on`)
    const gbase = { lane: 'kray', perHand: '20', hands: 3, expires: 900000, gateChildOf: String(land.star) }
    const gnonce = Number((await jpost('/api/kraynet/prepare', { action: 'mint-open', from: giver.addr, ...gbase })).nonce)
    const groot = mintId(NET, giver.addr, 'kray', '', 20n, 3, { kind: 'childOf', star: BigInt(land.star) }, gnonce)
    const gopen = await act('mint-open', giver, gbase)
    ok(gopen.seq != null, 'a mint gated on that land is open')

    const noStar = await act('mint-take', hands[0]!, { claimRoot: groot })
    ok(noStar.error != null && /name the star/.test(String(noStar.error)), 'taking without naming a star → refused')
    const notMine = await act('mint-take', hands[1]!, { claimRoot: groot, star: String(land.star) })
    ok(notMine.error != null && /do not hold/.test(String(notMine.error)), 'naming a star somebody ELSE holds → refused')
    const ghost = await act('mint-take', hands[2]!, { claimRoot: groot, star: '888888' })
    ok(ghost.error != null, 'naming a star that does not exist → refused')
    const wrongParent = await act('mint-take', giver, { claimRoot: groot, star: String(land.star) })
    ok(wrongParent.error != null && /not of land|is not of/.test(String(wrongParent.error)), 'naming a star that is not OF that land → refused (owner true, parent false)')

    // ── G-6 · THE CLOSE ──────────────────────────────────────────────────────────────────────
    console.log('\nG-6 — taking back what nobody took')
    const early = await act('claim-close', giver, { claimRoot: groot })
    ok(early.error != null && /sealed to/.test(String(early.error)), 'the giver closing BEFORE the height they named → refused')
    const notGiver = await act('claim-close', thief, { claimRoot: groot })
    ok(notGiver.error != null && /only the hand that opened/.test(String(notGiver.error)), 'a stranger closing somebody else\'s mint → refused')

    // ── G-6b · PROMISING WHAT YOU HAVE NOT GOT, in every lane ────────────────────────────────
    // The Creator's question: is a hand with no balance stopped by the SIGNATURE, or after it? A signature
    // proves WHO wrote a line — it cannot know a balance, and no signature over any bytes ever could. So a
    // poor hand signs perfectly, and the REDUCER refuses. Here that is shown for ₭, for a star's Luz, and
    // for an L2 rune — the three things a citizen can promise — each over the real wire.
    console.log('\nG-6b — promising what you have not got, in every lane')
    const pauper = wallet('pauper')
    await jpost('/api/kraynet/donate', { to: pauper.addr, sats: '30' })     // enough for fees, nothing to give
    const beforeP = await balOf(pauper.addr)

    const kray = await act('mint-open', pauper, { lane: 'kray', perHand: '1000', hands: 10, expires: 900000 })
    ok(kray.error != null && /do not hold/.test(String(kray.error)), `₭ he has not got → refused ("${String(kray.error).slice(0, 52)}…")`)

    const luz = await act('mint-open', pauper, { lane: 'luz', star: '0', perHand: '500', hands: 4, expires: 900000 })
    ok(luz.error != null, `Luz of a star he holds none of → refused ("${String(luz.error).slice(0, 52)}…")`)

    const rune = await act('mint-open', pauper, { lane: 'rune', runeId: '840000:7', perHand: '500', hands: 4, expires: 900000 })
    ok(rune.error != null, `a rune he holds none of → refused ("${String(rune.error).slice(0, 52)}…")`)

    const harvest = await act('claim-open', pauper, { lane: 'kray', amount: '9999', claimRoot: 'a'.repeat(64), expires: 900000 })
    ok(harvest.error != null && /do not hold/.test(String(harvest.error)), 'and a HARVEST of what he has not got → refused the same way')

    const listing = await act('packet-list', pauper, { lane: 'kray', amount: '9999', price: '1' })
    ok(listing.error != null && /do not hold|have not got/.test(String(listing.error)), 'and a packet LISTING of what he has not got → refused the same way')

    ok((await balOf(pauper.addr)) === beforeP, 'through every one of those, the pauper paid NOTHING — not even the gas')

    // AND THE OTHER SIDE OF THE SAME COIN: gating a mint on a land he does NOT own is allowed, because the
    // gate binds the TAKERS, not the giver. Nobody can be robbed by it — he is giving his own ₭ away to the
    // holders of somebody else's land. The law refuses what you cannot COVER, never what you choose to give.
    const gifted = await act('mint-open', pauper, { lane: 'kray', perHand: '5', hands: 2, expires: 900000, gateChildOf: String(land.star) })
    ok(gifted.seq != null, 'but a mint GATED on a land he does not own is allowed — the gate binds takers, not the giver')
    ok((await balOf(pauper.addr)) === beforeP - 10n - 1n, 'and it cost him exactly what he promised, plus the one fee')

    // ── G-6c · THE ESCROW'S OWN DOOR ─────────────────────────────────────────────────────────
    // Found by an adversarial sweep of the LIVE mainnet the hour its market opened: `claim-take` and
    // `claim-close` still handed out a line to sign for acts the reducer would certainly refuse. The
    // packet and the mint had already been fixed; the escrow's two spending acts had not.
    console.log('\nG-6c — the escrow refuses at the door too')
    {
      const nobody = wallet('nobody')
      await jpost('/api/kraynet/donate', { to: nobody.addr, sats: '50' })
      const badProof = await jpost('/api/kraynet/prepare', { action: 'claim-take', from: nobody.addr, claimRoot: 'b'.repeat(64), amount: '5', claimProof: [] })
      ok(badProof.error != null && badProof.message == null, `a claim on a root no harvest carries → refused at the door ("${String(badProof.error).slice(0, 44)}…")`)
      const ghostClose = await jpost('/api/kraynet/prepare', { action: 'claim-close', from: nobody.addr, claimRoot: 'c'.repeat(64) })
      ok(ghostClose.error != null && ghostClose.message == null, `closing a harvest that does not exist → refused at the door ("${String(ghostClose.error).slice(0, 40)}…")`)
      const notGiverDoor = await jpost('/api/kraynet/prepare', { action: 'claim-close', from: nobody.addr, claimRoot: root })
      ok(notGiverDoor.error != null && /only the hand that opened|is a mint/.test(String(notGiverDoor.error)), `a stranger closing somebody else's → refused at the door ("${String(notGiverDoor.error).slice(0, 40)}…")`)
    }

    // ── G-7 · THE CHAIN, AFTER ALL OF IT ─────────────────────────────────────────────────────
    console.log('\nG-7 — after every attack, the arithmetic')
    const ov = await jget('/api/kraynet/overview')
    ok(ov.conserves === true, 'the chain conserves')
    ok(ov.backed === true, 'and every pot is backed by its book')
    const chunks = await jget('/api/kraynet/chunks')
    ok(Array.isArray(chunks.chunks) && chunks.chunks.length > 0, `the journal published ${(chunks.chunks || []).length} chunk(s) a stranger can replay`)
    ok(BigInt(String((await jget('/api/kraynet/claims')).claims.reduce((s: bigint, c: any) => s + BigInt(c.owed), 0n))) === (await balOf('KRAY_CLAIM')),
      'what the pot holds is exactly what every open mint and harvest still owes')

    console.log(`\n${pass} passed, ${fail} failed`)
    if (fail) { console.log('\n✗ THE GAUNTLET FOUND A HOLE'); done(1) }
    console.log('\n✓ THE MINT GAUNTLET HOLDS: not one lie on the wire moved a single unit, the cap is counted not computed, and after every attack the chain conserves. ⛓₭')
    done(0)
  } catch (e) {
    console.error('\n✗ gauntlet crashed:', (e as Error).message)
    done(1)
  }
}
void main()
