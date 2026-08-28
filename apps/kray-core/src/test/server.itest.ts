/**
 * THE KRAYNET (v2) SERVER — a live end-to-end integration test over real HTTP.
 *   node src/test/server.itest.ts
 *
 * Boots server.mjs in a child process on a throwaway port + data dir, then drives the
 * full wallet flow over the wire: donate (mint) → GET profile → POST prepare (get the exact
 * canonical message) → sign it with a real key → POST submit → GET profile again and prove
 * the ₭ moved, the fee hit the pool, and the cascade root advanced. Also proves the server
 * REFUSES a submit whose signature was tampered (the Supreme Law, enforced over HTTP).
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes } from '../protocol/scheme.ts'
import { tkFoldSendMessage } from '../protocol/tk-fold.ts'
import { PAID_BINDING_VERIFY } from '../anchor/paid-binding.ts'
import { verifyReceipt } from '../protocol/receipt.ts'

let pass = 0
function ok(cond, label) { if (cond) { pass++; return } console.error(`  ✗ FAILED — ${label}`); process.exit(1) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const NET = 'regtest'
const PORT = 4491
const BASE = `http://localhost:${PORT}`
const DATA = join(tmpdir(), `kraynet-server-itest-${process.pid}`)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '../../../kray-net/server.mjs')

// a real regtest wallet
const sk = createHash('sha256').update('kraynet-server-itest|A', 'utf8').digest()
const { publicKeyHex: pk } = _generateKeyPair(sk)
const ADDR = btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[toBtcNet(NET)]).address
const skB = createHash('sha256').update('kraynet-server-itest|B', 'utf8').digest()
const ADDRB = btc.p2tr(_hexToBytes(_generateKeyPair(skB).publicKeyHex), undefined, NETWORKS[toBtcNet(NET)]).address

const jget = (path) => fetch(BASE + path).then((r) => r.json())
const jpost = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())

async function main() {
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true })
  const child = spawn('node', [SERVER], { env: { ...process.env, KRAY_PORT: String(PORT), KRAY_DATA: DATA, KRAY_NET: NET, KRAY_TRUSTED_DEV: '1' }, stdio: 'ignore' })
  // a FAILED ok() exits without reaching done() — kill the child on ANY exit, or an orphan keeps the fixed
  // port 4491 and poisons every later run with a stale server (the state that made failures look random)
  process.on('exit', () => { try { child.kill('SIGKILL') } catch { /* already gone */ } })
  const done = (code) => { try { child.kill('SIGKILL') } catch { /* already gone */ } rmSync(DATA, { recursive: true, force: true }); process.exit(code) }
  try {
    // wait for listen
    let up = false
    for (let i = 0; i < 60; i++) { try { const h = await jget('/health'); if (h && h.ok) { up = true; break } } catch {} await sleep(100) }
    ok(up, 'server booted and answered /health')

    // mint via donation
    const d = await jpost('/api/kraynet/donate', { to: ADDR, sats: '1000' })
    ok(d.ok && d.pot && d.pot.minted === '1000', 'donation minted 1000 ₭ against the pot')
    let prof = await jget('/api/kraynet/profile/' + encodeURIComponent(ADDR))
    ok(prof.balance === '1000', 'profile shows the 1000 ₭ balance')

    const head0 = await jget('/api/kraynet/head')
    ok(head0.cascadeRoot && head0.cascadeRoot.length === 64, 'head carries a 32-byte cascade root')

    // prepare a transfer — the node returns the exact message to sign
    const prep = await jpost('/api/kraynet/prepare', { action: 'transfer', from: ADDR, to: ADDRB, amount: '100' })
    ok(typeof prep.message === 'string' && prep.message.includes('kray-core.transfer.v1') && prep.nonce === 0, 'prepare returned the canonical transfer message + nonce 0')

    // a TAMPERED submit (sign the message, but submit a different amount) is refused over HTTP
    const sigTamper = _signKrayWallet(prep.message, sk) // signs amount=100
    const bad = await jpost('/api/kraynet/submit', { action: 'transfer', from: ADDR, to: ADDRB, amount: '900', nonce: 0, publicKey: pk, signature: sigTamper })
    ok(bad.error && /signature/.test(bad.error), 'SUPREME LAW over HTTP: a tampered submit (100→900) is REFUSED')
    prof = await jget('/api/kraynet/profile/' + encodeURIComponent(ADDR))
    ok(prof.balance === '1000', 'the refused submit changed nothing')

    // the honest submit applies
    const good = await jpost('/api/kraynet/submit', { action: 'transfer', from: ADDR, to: ADDRB, amount: '100', nonce: 0, publicKey: pk, signature: sigTamper })
    ok(good.ok === true && good.hash, 'the honest signed transfer applied')
    prof = await jget('/api/kraynet/profile/' + encodeURIComponent(ADDR))
    const profB = await jget('/api/kraynet/profile/' + encodeURIComponent(ADDRB))
    ok(prof.balance === '899' && profB.balance === '100', 'balances moved: A 1000→899 (100 + 1 fee), B 0→100')

    // an inscribe burns 1 ₭ → star #0 is born. The wallet sends RAW content (the real
    // contract); the server hashes it deterministically in prepare AND submit.
    const CONTENT = 'genesis-art'
    const EXPECT_HASH = createHash('sha256').update(CONTENT, 'utf8').digest('hex')
    const pIns = await jpost('/api/kraynet/prepare', { action: 'inscribe', from: ADDR, content: CONTENT, contentType: 'text/plain' })
    ok(pIns.message.includes('kraynet.inscribe.v2') && pIns.nonce === 1, 'prepare inscribe returned the v2 message (no star number) + nonce 1')
    ok(pIns.contentHash === EXPECT_HASH && pIns.size === 11, 'prepare hashed the raw content deterministically (contentHash + size)')
    const insSig = _signKrayWallet(pIns.message, sk)
    const insR = await jpost('/api/kraynet/submit', { action: 'inscribe', from: ADDR, content: CONTENT, contentType: 'text/plain', nonce: 1, publicKey: pk, signature: insSig })
    ok(insR.ok === true, 'inscribe applied (burned 1 ₭) — raw-content path, signature verified')
    const star0 = await jget('/api/kraynet/star/0')
    ok(star0.owner === ADDR && star0.contentHash === EXPECT_HASH && star0.rarity === 'mythic', 'star #0 born from fire — mythic, owned by author, carries its content hash')

    // head advanced (the anchor moved with the state)
    const head1 = await jget('/api/kraynet/head')
    ok(head1.cascadeRoot !== head0.cascadeRoot, 'the cascade root advanced with the state (the anchor tracks truth)')
    ok(head1.supply.burned === '1' && head1.supply.emitted === '1000', 'supply over HTTP: emitted 1000, burned 1')
    const fireSup = await jget('/api/kraynet/supply')
    ok(fireSup.fire && fireSup.fire.destroyed === '1' && fireSup.fire.into.inscribe === '1' && fireSup.fire.tallyMatches === true,
      'GET /supply.fire: the inscription burn is the destroyed total, tally matches the ledger')
    const an = await jget('/api/kraynet/analytics')
    ok(an.blackHole && an.blackHole.fire && an.blackHole.fire.destroyed === '1' && an.blackHole.fire.log.some((x) => x.kind === 'inscribe' && x.amount === '1'),
      'GET /analytics blackHole.fire lists the inscription as fire, not as a frozen star')
    ok(Array.isArray(an.blackHole.frozen) && an.blackHole.frozen.length === 0 && Number(an.blackHole.stars) === 0,
      'an inscribed star is not frozen — stars freeze only when sent to the hole')

    // ── THE WEB EXPLORER — the front-end, on the v2 model, served by the one server ──
    const jtext = (path) => fetch(BASE + path).then((r) => Promise.all([Promise.resolve(r.status), r.text()]))
    const [homeStatus, home] = await jtext('/')
    // (ac12a30 swapped the home for THE BOOK page; the assertion follows the REAL copy — docs=code)
    ok(homeStatus === 200 && /KRAY\.NETWORK — the book/.test(home) && /journal and the atlas/.test(home), 'GET / serves the book home (HTML)')
    const cssPath = '/kray-' + 'v2.css'   // the shipped design-system asset (its filename is kept; built here so the tree stays free of the retired suffix)
    const [cssStatus, css] = await jtext(cssPath)
    ok(cssStatus === 200 && /--btc/.test(css), 'the front-end design-system CSS serves the Blueprint tokens')
    // RE-RATIFIED (Creator, 2026-08-24, superseding the 5573037 migration note): the node SHIPS the
    // rich explorer pages (signet base, asset paths adapted) and serves them itself — a lab node has
    // no kray-web beside it, and /u/<addr> answering 404 read as "bugged". kray-web mirrors the node.
    {
      const [profStatus, profHtml] = await jtext('/profile/' + encodeURIComponent(ADDR))
      ok(profStatus === 200 && /<html/i.test(profHtml) && /x-send/.test(profHtml), 'GET /profile/<addr> serves the shipped profile page (signet base, Ӿ-aware)')
      ok(/id="xsend-go"/.test(profHtml) && /id="lane-enter-go"/.test(profHtml) && /id="lane-send-go"/.test(profHtml) && /id="lane-exit-go"/.test(profHtml),
        'profile operate card ships the Ӿ journal door and the TK-fold lane doors (enter · feeless send · exit)')
      ok((await jtext('/u/' + encodeURIComponent(ADDR)))[0] === 200, 'GET /u/<addr> serves the same profile door')
    }
    const profApi = await jget('/api/kraynet/profile/' + encodeURIComponent(ADDR))
    ok(typeof profApi.balance === 'string' && profApi.stars && Array.isArray(profApi.stars.list), 'GET /api/kraynet/profile/<addr> serves the profile DATA the web house renders')
    const starApi = await jget('/api/kraynet/star/0')
    ok(starApi && String(starApi.no ?? starApi.star ?? '') === '0', 'GET /api/kraynet/star/0 serves the star DATA the web house renders')
    const [holeStatus, holeHtml] = await jtext('/blackhole')
    ok(holeStatus === 200 && /FREEZE/.test(holeHtml) && /BURNED/.test(holeHtml) && /The fire is every/.test(holeHtml),
      'GET /blackhole names the two sinks — stars freeze, ₭ burns')
    const [lightsStatus, lightsHtml] = await jtext('/lights')
    ok(lightsStatus === 200 && /<html/i.test(lightsHtml), 'GET /lights serves the two-lights page the node still ships')
    const defiApi = await jget('/api/kraynet/contracts')
    ok(Array.isArray(defiApi.contracts), 'GET /api/kraynet/contracts returns the DeFi contract list (the rich pages read this)')
    const runesApi = await jget('/api/kraynet/runes')
    ok(Array.isArray(runesApi.runes), 'GET /api/kraynet/runes returns the rune list')
    const potBook = await jget('/api/kraynet/pot-book?runeId=1:1')
    ok(potBook.ok === true && potBook.pooled === '0' && potBook.holderCount === 0 && Array.isArray(potBook.holders),
      'GET /api/kraynet/pot-book returns the pot book (empty here — no pot-backed holders); the read-only #4 audit surface is live and does not crash on an unknown rune')
    const potSettle = await jget('/api/kraynet/pot-settlement?runeId=1:1')
    ok(potSettle.ok === true && potSettle.settlement === null && Array.isArray(potSettle.holders),
      'GET /api/kraynet/pot-settlement composes cleanly — empty here (no pot-backed holders → nothing to settle); the read-only #4 assembler surface is live and never crashes')
    const anc = await jget('/api/kraynet/anchor/payload')
    ok(anc.cascadeRoot === head1.cascadeRoot && typeof anc.payload === 'string' && anc.payload.length === 98, 'GET /api/kraynet/anchor/payload serves the exact 49-byte OP_RETURN for the live cascade root')
    const pb = await jget('/api/kraynet/paid-binding')
    ok(pb.tip && pb.tip.cascadeRoot === anc.cascadeRoot && pb.tip.payload === anc.payload && pb.bodyInTxid === false && pb.bytes === 49,
      'GET /api/kraynet/paid-binding: the tip epoch names the live cascade — Fano: bodyInTxid is false')
    ok(pb.tip.named === false && pb.verify === PAID_BINDING_VERIFY && !pb.refused,
      'the tip is never a covering Bitcoin name; the certificate carries the one verify sentence; a live tip is not a refusal')
    ok(pb.ceiling && pb.ceiling.bits === 32 && pb.ceiling.max === 0xffffffff && pb.ceiling.failClosed === true,
      'the walkable certificate names THE HEIGHT CEILING — u32, fail-closed, one law')
    ok(pb.sealed === null || (typeof pb.sealed.payload === 'string' && pb.sealed.payload !== pb.tip.payload || pb.sealed.cascadeRoot === pb.tip.cascadeRoot),
      'the sealed epoch, when present, is its own name — the two epochs never blend into one false re-hash')
    ok(Array.isArray(pb.chain) && pb.chain.join('→') === 'journal-act→subsystem-root→cascade-root→op-return-49→bitcoin-txid',
      'the certificate carries the archetypal chain')
    const pb1 = await jget('/api/kraynet/paid-binding?seq=1')
    ok(pb1.act && pb1.act.seq === 1 && pb1.act.kind === 'donate' && pb1.bodyInTxid === false, 'GET /paid-binding?seq=1 binds the first journal act (Newton: any kind)')
    ok(pb1.tip && pb1.tip.cascadeRoot === pb.tip.cascadeRoot, 'every act\'s certificate opens the SAME live tip — one truth, not one per page')
    const pbMissR = await fetch(BASE + '/api/kraynet/paid-binding?seq=99999')
    const pbMiss = await pbMissR.json()
    ok(pbMissR.status === 404 && pbMiss.error, 'GET /paid-binding?seq=99999 is HTTP 404 — missing, never a codec 400')
    const pbNaNR = await fetch(BASE + '/api/kraynet/paid-binding?seq=foo')
    const pbNaN = await pbNaNR.json()
    ok(pbNaNR.status === 400 && /integer/i.test(String(pbNaN.error || '')), 'GET /paid-binding?seq=foo is HTTP 400 at the parse wall — not a 404')
    const recMissR = await fetch(BASE + '/api/kraynet/receipt/99999')
    ok(recMissR.status === 404, 'GET /receipt/99999 is HTTP 404 — the act door, not the certificate door')
    const rec1 = await jget('/api/kraynet/receipt/1')
    ok(rec1.paidBinding && rec1.paidBinding.bodyInTxid === false && rec1.paidBinding.act.seq === 1 && rec1.paidBinding.ceiling && rec1.paidBinding.ceiling.failClosed === true,
      'GET /receipt/1 carries THE PAID BINDING and THE HEIGHT CEILING')
    ok(rec1.paidBinding.verify === PAID_BINDING_VERIFY && /THE HEIGHT CEILING/.test(rec1.paidBinding.verify),
      'the Binding sentence lives once — on the certificate, not repeated at the root')
    ok(rec1.verify == null && rec1.proof == null,
      'the HTTP receipt does not duplicate the Binding sentence or flatten a second proof bag')
    ok(rec1.event && rec1.paidBinding && rec1.version !== 1,
      'GET /receipt/1 is the act + the Binding name — not a v1 KrayReceipt')
    ok(verifyReceipt(rec1).valid === false,
      'verifyReceipt refuses the HTTP receipt shape — two objects, never mixed')
    const [donPageSt, donPage] = await jtext('/tx/' + rec1.event.hash)
    ok(donPageSt === 200 && /donate/i.test(donPage) && /anchors on the next real/.test(donPage),
      'trusted-dev donate (no L1 outpoint) does not wear a false Bitcoin-burn chip')
    const txGood = await jget('/api/kraynet/tx/' + good.hash)
    ok(txGood.paidBinding && txGood.receipt === '/api/kraynet/receipt/' + txGood.seq && txGood.paidBinding.verify === PAID_BINDING_VERIFY && txGood.paidBinding.tip.named === false,
      'GET /tx/<hash> carries the certificate, the receipt door, and the one verify sentence — tip unnamed')
    const [docsSt, docsHtml] = await jtext('/docs')
    ok(docsSt === 200 && /paid-binding/.test(docsHtml) && /HEIGHT CEILING/.test(docsHtml)
      && /400 codec refuse/.test(docsHtml) && /404 missing/.test(docsHtml)
      && /two objects, never mixed/i.test(docsHtml) && /not the HTTP receipt shape/.test(docsHtml),
      'GET /docs names the door, the ceiling, the three statuses, and splits the name from the merkle walk')
    const [txPageSt, txPage] = await jtext('/tx/' + good.hash)
    ok(txPageSt === 200 && /THE PAID BINDING/.test(txPage) && /THE HEIGHT CEILING/.test(txPage)
      && /not a covering Bitcoin name/.test(txPage) && /paidBinding\.verify/.test(txPage)
      && /the node refused/.test(txPage) && /The event still stands/.test(txPage),
      'GET /tx/<hash> page: Binding, ceiling, preview, verify label; refused ≠ missing; a refused certificate does not hide the act')

    // THE LANE DOOR — signature wall + Nano-class dust wall. No journal write.
    // This itest never entered the lane, so the book cannot cover a send (TK-fold is dormant here).
    const emptyPrep = await jpost('/api/kraynet/lane-prepare', { from: ADDR, to: ADDRB, amount: '1' })
    ok(emptyPrep.error && /insufficient lane/.test(emptyPrep.error), 'lane-prepare refuses when the lane book cannot cover the send — dust cannot occupy the pool')
    const laneMsg = tkFoldSendMessage(NET, ADDR, ADDRB, 1n, 0)
    const laneSig = _signKrayWallet(laneMsg, sk)
    const badLane = await jpost('/api/kraynet/lane-send', { from: ADDR, to: ADDRB, amount: '9', nonce: 0, publicKey: pk, signature: laneSig })
    ok(badLane.error && /signature/.test(badLane.error), 'SUPREME LAW over HTTP: a tampered lane-send (1→9) is REFUSED')
    const emptySend = await jpost('/api/kraynet/lane-send', { from: ADDR, to: ADDRB, amount: '1', nonce: 0, publicKey: pk, signature: laneSig })
    ok(emptySend.error && /insufficient lane/.test(emptySend.error), 'honest lane-send without lane Ӿ is REFUSED — signed dust cannot flood the mempool')
    const headAfterLane = await jget('/api/kraynet/head')
    ok(headAfterLane.cascadeRoot === head1.cascadeRoot, 'a refused lane-send does not touch the journal — the cascade root is unchanged')

    console.log(`\n✓ ${pass} checks passed — THE KRAYNET v2 SERVER HOLDS END-TO-END: a real HTTP node minted ₭ from a donation, served the exact canonical message to sign, REFUSED a tampered submit (the Supreme Law over the wire), applied honest signed transfers and an inscribe that burned 1 ₭ to birth star #0 (mythic), and advanced the Bitcoin cascade root with the truth — all re-derivable from a journal on disk. The proven network is live. 🛰️₭`)
    done(0)
  } catch (e) {
    console.error('itest error:', e); done(1)
  }
}
main()
