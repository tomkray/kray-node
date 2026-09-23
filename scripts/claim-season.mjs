/**
 * A CREATOR'S HARVEST — seal a token, escrow a season, hand out the proofs.
 *
 *   KRAY_NET=regtest KRAY_DATA=./apps/kray-net/data-lab KRAY_TRUSTED_DEV=1 npm run explorer   # terminal 1
 *   node scripts/claim-season.mjs --demo                                                      # terminal 2
 *
 * The claim escrow knows nothing about farms, games or radios. It takes a lane, an asset, a total and a
 * merkle root — so ANY creator can pay ANY list of hands, and the chain guarantees the same things for all
 * of them. This is that recipe, runnable, from an empty bench to a claimed share.
 *
 *   --demo                       walk the whole thing with a made-up cast (Luz on a fresh star)
 *   --lane luz --supply 100000   seal a Luz paper on a new star and pay the season in its ✧
 *   --lane rune --runeId b:t     pay the season in a rune of the L2 (the etched kind, e.g. a music rune)
 *   --lane kray                  pay the season in ₭ itself
 *   --shares file.json           [{ "to": "bcrt1p…", "amount": "120" }, …]  the list YOU attest
 *   --expires 900000             the Bitcoin height after which what nobody claimed comes back to you
 *
 * WHAT THE CHAIN GUARANTEES, once you have opened a season: the list cannot be edited (its root is in your
 * signature); the total has already left your hand (it sits in a keyless pot); nobody is paid twice, or more
 * than their leaf, or by anyone but that pot; a hand that can prove its leaf CANNOT be refused; and what no
 * hand claimed returns only to you, only at the height you named.
 *
 * WHAT IT DOES NOT: it cannot know your list is true. That part is yours, and the only honest way to make it
 * checkable is to publish the log your list was computed from, so a stranger can recompute it and compare.
 */
import { readFileSync } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'
import { addressOf, _generateKeyPair, _signKrayWallet } from '../apps/kray-core/src/protocol/scheme.ts'
import { claimRoot, claimProof } from '../apps/kray-core/src/protocol/claim-book.ts'
import { compileCut } from '../apps/kray-core/src/protocol/star-forms.ts'
import { canonicalCode } from '../apps/kray-core/src/protocol/contract.ts'
import { sha256hex } from '../apps/kray-core/src/protocol/kray-primitives.ts'

const PORT = parseInt(process.env.KRAY_PORT || '4477', 10)
const BASE = `http://127.0.0.1:${PORT}`
const NET = 'regtest'
const arg = (name, fallback = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? String(process.argv[i + 1] ?? '') : fallback }
const has = (name) => process.argv.includes(`--${name}`)

const jget = (p) => fetch(BASE + p).then((r) => r.json())
const jpost = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json())
function wallet(tag) {
  const sk = createHash('sha256').update(`claim-season|${tag}|${new Date().toISOString().slice(0, 10)}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: addressOf(publicKeyHex, NET), sk, pk: publicKeyHex, tag }
}
const sign = (m, w) => _signKrayWallet(m, w.sk)
/** prepare → sign exactly what the door said → submit. No key ever leaves this process. */
async function act(action, w, fields) {
  const body = { action, from: w.addr, ...fields }
  const p = await jpost('/api/kraynet/prepare', body)
  if (p.error) throw new Error(`${action}: ${p.error}`)
  const r = await jpost('/api/kraynet/submit', { ...body, nonce: p.nonce, publicKey: w.pk, signature: sign(String(p.message), w) })
  if (r.error) throw new Error(`${action}: ${r.error}`)
  return r
}

async function main() {
  const status = await jget('/api/kraynet/status').catch(() => null)
  if (!status || status.network == null) {
    console.error(`✗ no bench answering on :${PORT}. Start one:\n    KRAY_NET=regtest KRAY_DATA=./apps/kray-net/data-lab KRAY_TRUSTED_DEV=1 npm run explorer`)
    process.exit(1)
  }
  if (status.network !== 'regtest') { console.error(`✗ this node is ${status.network} — the claim escrow is pinned shut outside regtest.`); process.exit(1) }

  const lane = arg('lane', 'luz')
  const demo = has('demo')
  console.log(`\n╔═ A CREATOR'S HARVEST on ${BASE} · lane ${lane} ══╗\n`)

  const creator = wallet('creator')
  // A season is keyed by its ROOT — one root, one escrow, forever. So a demo cast must be fresh each run,
  // or the second run collides with its own first and the law (rightly) refuses it.
  const run = randomBytes(3).toString('hex')
  const cast = demo ? ['listener-1', 'listener-2', 'listener-3'].map((t) => wallet(`${t}-${run}`)) : []
  for (const w of [creator, ...cast]) {
    const d = await jpost('/api/kraynet/donate', { to: w.addr, sats: '9000' })
    if (d.error) { console.error(`✗ could not fund ${w.tag}: ${d.error}\n  (the bench needs KRAY_TRUSTED_DEV=1)`); process.exit(1) }
  }
  console.log(`  creator ${creator.addr.slice(0, 16)}…${cast.length ? ` · ${cast.length} hands` : ''}\n`)

  // ── ① THE TOKEN ─────────────────────────────────────────────────────────────────────────────
  let asset = '', assetField = {}
  if (lane === 'luz') {
    const supply = arg('supply', '100000')
    const body = `season · ${randomBytes(4).toString('hex')}`
    const born = await act('inscribe', creator, { content: body, contentHash: createHash('sha256').update(body).digest('hex'), contentType: 'text/plain', size: body.length })
    asset = String(born.star)
    const paper = compileCut({ supply })
    await act('contract', creator, { code: paper, star: asset, contentHash: sha256hex(canonicalCode(paper)) })
    assetField = { star: asset }
    console.log(`  ① star #${asset} carries ${Number(supply).toLocaleString()} ✧ — this IS the token (a song, a crop, a badge)`)
  } else if (lane === 'rune') {
    asset = arg('runeId', '840000:7')
    assetField = { runeId: asset }
    if (has('demo')) await jpost('/api/kraynet/rune/deposit', { runeId: asset, to: creator.addr, amount: '2000000', pool: true })
    console.log(`  ① rune ${asset} — an etched L2 rune (a music rune, a game token)`)
  } else {
    console.log('  ① ₭ itself')
  }

  // ── ② THE LIST YOU ATTEST ───────────────────────────────────────────────────────────────────
  const shares = has('shares')
    ? JSON.parse(readFileSync(arg('shares'), 'utf8')).map((row) => ({ to: String(row.to), amount: BigInt(row.amount) }))
    : cast.map((w, i) => ({ to: w.addr, amount: BigInt((i + 1) * 1000) }))
  if (!shares.length) { console.error('✗ no shares — pass --shares file.json or use --demo'); process.exit(1) }
  const total = shares.reduce((t, s) => t + s.amount, 0n)
  const root = claimRoot(shares)
  console.log(`  ② ${shares.length} hands · ${total} in total · root ${root.slice(0, 16)}…`)
  console.log('     (the root is what you SIGN — the list itself lives wherever you publish it)')

  // ── ③ THE SEASON ────────────────────────────────────────────────────────────────────────────
  const expires = arg('expires', '')
  await act('claim-open', creator, { lane, ...assetField, total: total.toString(), claimRoot: root, ...(expires ? { expires } : {}) })
  const open = await jget('/api/kraynet/claims')
  const row = (open.claims || []).find((c) => c.root === root)
  console.log(`  ③ the season is open — ${row?.owed} left the creator's hand into the keyless pot`)
  console.log(`     the pot is backed: ${open.potBacked}${expires ? ` · what nobody claims comes back at Bitcoin height ${expires}` : ' · nothing comes back: this season belongs to its root, forever'}`)

  // ── ④ A HAND CLAIMS ─────────────────────────────────────────────────────────────────────────
  if (demo) {
    const hand = cast[0], index = 0
    const proof = claimProof(shares, index)
    console.log(`\n  ④ ${hand.tag} proves its leaf (${shares[index].amount}) with ${proof.length} steps`)
    await act('claim-take', hand, { claimRoot: root, amount: shares[index].amount.toString(), claimProof: proof })
    const after = await jget('/api/kraynet/claims')
    const now = (after.claims || []).find((c) => c.root === root)
    console.log(`     taken. the pot now owes ${now?.owed} to the ${shares.length - 1} hands that have not come`)
    try {
      await act('claim-take', hand, { claimRoot: root, amount: shares[index].amount.toString(), claimProof: proof })
      console.log('     ✗ A SECOND HELPING WAS ALLOWED — this is a bug, report it')
    } catch (e) { console.log(`     and a second helping is refused: ${String(e.message).slice(0, 70)}`) }
  }

  // ── ⑤ WHAT EACH HAND NEEDS ──────────────────────────────────────────────────────────────────
  console.log('\n  ⑤ what every hand needs, to claim from anywhere:')
  console.log(`     POST ${BASE}/api/kraynet/prepare  {"action":"claim-take","from":"<their address>",`)
  console.log(`            "claimRoot":"${root}","amount":"<their leaf>"}`)
  console.log('     …sign the returned message, then POST /api/kraynet/submit with the same fields + claimProof.')
  console.log(`     The path comes from the desk, over the list you published:`)
  console.log(`     curl -s -X POST ${BASE}/api/kraynet/claim/proof -H 'content-type: application/json' \\`)
  console.log(`          -d '{"shares":[…your published list…],"to":"<their address>"}'`)
  console.log(`\n  Read the season any time:  curl -s ${BASE}/api/kraynet/claims | jq\n`)
}
main().catch((e) => { console.error('\n✗ ' + e.message + '\n'); process.exit(1) })
