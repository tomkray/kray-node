/**
 * FILL THE SHOP WINDOW — one of every kind of drop, on a regtest bench, through the public door.
 *
 *   KRAY_NET=regtest KRAY_DATA=./apps/kray-net/data-lab KRAY_TRUSTED_DEV=1 npm run explorer   # terminal 1
 *   node scripts/seed-drops.mjs                                                               # terminal 2
 *   node scripts/seed-drops.mjs --for bcrt1p…      # …and leave one NAMED for your own address
 *
 * The suites prove the law in memory; the swarms never touch a running node, so a bench's market looks
 * empty however green the tests are. This leaves REAL acts in the bench's own journal — signed, submitted
 * through `/api/kraynet/prepare` + `/submit` exactly as a wallet would — so `/market/drops` has something
 * to show and you can walk the floor.
 *
 * Regtest only. It refuses to run anywhere else, and it needs the dev mint (KRAY_TRUSTED_DEV=1) to fund
 * its cast without a real Bitcoin burn.
 */
import { randomBytes, createHash } from 'node:crypto'
import { addressOf, _generateKeyPair, _signKrayWallet } from '../apps/kray-core/src/protocol/scheme.ts'
import { compileCut } from '../apps/kray-core/src/protocol/star-forms.ts'
import { canonicalCode } from '../apps/kray-core/src/protocol/contract.ts'
import { sha256hex } from '../apps/kray-core/src/protocol/kray-primitives.ts'

const PORT = parseInt(process.env.KRAY_PORT || '4477', 10)
const BASE = `http://127.0.0.1:${PORT}`
const NET = 'regtest'
const forArg = process.argv.indexOf('--for')
const LEFT_FOR = forArg > 0 ? String(process.argv[forArg + 1] || '').trim() : ''
const RUNE = '840000:7'

const jget = (p) => fetch(BASE + p).then((r) => r.json())
const jpost = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json())
function wallet(tag) {
  const sk = createHash('sha256').update(`seed-drops|${tag}|${new Date().toISOString().slice(0, 10)}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: addressOf(publicKeyHex, NET), sk, pk: publicKeyHex, tag }
}
const sign = (m, w) => _signKrayWallet(m, w.sk)
/** prepare → sign exactly what the door said → submit. The honest wallet's path, and the only one used here. */
async function act(action, w, fields) {
  const body = { action, from: w.addr, ...fields }
  const p = await jpost('/api/kraynet/prepare', body)
  if (p.error) throw new Error(`${action}: ${p.error}`)
  const r = await jpost('/api/kraynet/submit', { ...body, nonce: p.nonce, publicKey: w.pk, signature: sign(String(p.message), w) })
  if (r.error) throw new Error(`${action}: ${r.error}`)
  return r
}
async function bornStar(w, note) {
  const body = `${note} · ${randomBytes(4).toString('hex')}`
  const r = await act('inscribe', w, { content: body, contentHash: createHash('sha256').update(body).digest('hex'), contentType: 'text/plain', size: body.length })
  return String(r.star)
}
const left = []
const note = (what, where) => { left.push({ what, where }); console.log(`  ✓ ${what}`) }

async function main() {
  const status = await jget('/api/kraynet/status').catch(() => null)
  if (!status || status.network == null) {
    console.error(`✗ no bench answering on :${PORT}. Start one first:\n    KRAY_NET=regtest KRAY_DATA=./apps/kray-net/data-lab KRAY_TRUSTED_DEV=1 npm run explorer`)
    process.exit(1)
  }
  if (status.network !== 'regtest') { console.error(`✗ this node is ${status.network}. The shop window is a regtest thing — the drop is pinned shut elsewhere.`); process.exit(1) }
  console.log(`\n╔═ FILLING THE SHOP WINDOW on ${BASE} (${status.network}, seq ${status.seq ?? '?'}) ══╗\n`)

  const giver = wallet('giver'), heir = wallet('heir'), keyHolder = wallet('key'), shopper = wallet('shopper')
  for (const w of [giver, heir, keyHolder, shopper]) {
    const d = await jpost('/api/kraynet/donate', { to: w.addr, sats: '9000' })
    if (d.error) { console.error(`✗ could not fund ${w.tag}: ${d.error}\n  (the bench needs KRAY_TRUSTED_DEV=1 to mint without a real Bitcoin burn)`); process.exit(1) }
  }
  console.log(`  cast funded · giver ${giver.addr.slice(0, 14)}… · heir ${heir.addr.slice(0, 14)}… · key-holder ${keyHolder.addr.slice(0, 14)}…\n`)

  // ── stars on the floor ────────────────────────────────────────────────────────────────────
  const free = await bornStar(giver, 'a star for whoever comes')
  await act('star-list', giver, { star: free, price: '0' })
  note(`star #${free} — a free drop, for whoever signs first`, '/market/drops')

  const named = await bornStar(giver, 'the testament')
  const heirAddr = LEFT_FOR || heir.addr
  await act('star-list', giver, { star: named, price: '0', to: heirAddr })
  note(`star #${named} — a drop named for ${LEFT_FOR ? 'YOU (' + LEFT_FOR.slice(0, 14) + '…)' : 'the heir'}`, '/market/drops')

  const key = await bornStar(keyHolder, 'the key')
  const gated = await bornStar(giver, 'behind the key')
  await act('star-list', giver, { star: gated, price: '0', gateStar: key })
  note(`star #${gated} — opens only for whoever HOLDS star #${key}`, '/market/drops')

  const bequest = await bornStar(giver, 'the bequest')
  await act('star-list', giver, { star: bequest, price: '0', to: heirAddr, notBefore: '900000' })
  note(`star #${bequest} — a bequest waiting for Bitcoin height 900,000`, '/market/drops')

  const forSale = await bornStar(giver, 'an honest ask')
  await act('star-list', giver, { star: forSale, price: '250' })
  note(`star #${forSale} — listed at 250 ₭ (not a drop; the star floor)`, '/market/star')

  // ── packets on the floor ──────────────────────────────────────────────────────────────────
  await act('packet-list', giver, { lane: 'kray', amount: '500', price: '0' })
  note('500 ₭ — a free packet drop', '/market/drops')
  await act('packet-list', heir, { lane: 'kray', amount: '300', price: '40' })
  note('300 ₭ — a packet offered at 40 ₭', '/market/drops')

  // runes: this dev node credits an already-proven deposit (a real one rides an SPV proof)
  const rd = await jpost('/api/kraynet/rune/deposit', { runeId: RUNE, to: keyHolder.addr, amount: '9000', pool: true })
  if (rd.error) console.log(`  · rune lane skipped: ${String(rd.error).slice(0, 90)}`)
  else {
    await act('packet-list', keyHolder, { lane: 'rune', runeId: RUNE, amount: '2500', price: '0', to: heirAddr })
    note(`2,500 of rune ${RUNE} — a drop named for ${LEFT_FOR ? 'YOU' : 'the heir'}`, '/market/drops')
  }

  // Luz: a paper sealed on a star makes its ✧, and a packet of it goes on the floor
  try {
    const luzStar = await bornStar(shopper, 'a star with light in it')
    const paper = compileCut({ supply: '100000' })
    await act('contract', shopper, { code: paper, star: luzStar, contentHash: sha256hex(canonicalCode(paper)) })
    await act('packet-list', shopper, { lane: 'luz', star: luzStar, amount: '25000', price: '0' })
    note(`25,000 ✧ of star #${luzStar} — a free Luz packet`, '/market/drops')
  } catch (e) { console.log(`  · Luz lane skipped: ${String(e.message).slice(0, 110)}`) }

  const packets = await jget('/api/kraynet/packets')
  const market = await jget('/api/kraynet/market')
  const drops = ((market.listings || []).filter((l) => l.drop).length) + ((packets.listings || []).filter((l) => l.drop).length)
  console.log(`\n  ${drops} drops and ${(market.listings || []).length + (packets.listings || []).length - drops} priced offers now stand in this bench's own journal.`)
  console.log(`  The chain here is sealed to Bitcoin height ${packets.sealedHeight ?? 0}, so the bequest waits — that is the law, not a bug.\n`)
  console.log(`  Walk the floor:   ${BASE}/market/drops`)
  console.log(`  The star floor:   ${BASE}/market/star`)
  console.log(`  Or read the books directly:`)
  console.log(`      curl -s ${BASE}/api/kraynet/packets | jq`)
  console.log(`      curl -s ${BASE}/api/kraynet/market  | jq '.listings[] | select(.drop)'\n`)
}
main().catch((e) => { console.error('\n✗ ' + e.message + '\n'); process.exit(1) })
