/**
 * STAR LAW — live door exam on the regtest bench (:4477).
 *
 *   node apps/kray-net/server.mjs          # :4477, KRAY_TRUSTED_DEV=1
 *   node src/test/star-law-e2e.mjs
 *
 * Does not touch Signet / pot-signer. Reload the official explorer after door edits.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { NETWORKS } from '../protocol/scheme.ts'

const NET = 'regtest'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const TAG = 'law-e2e-' + Date.now() + '-' + Math.random().toString(16).slice(2)

let pass = 0, fail = 0, section = ''
const S = (s) => { section = s; console.log(`\n── ${s} ──`) }
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))
const bal = async (a) => BigInt((await jget('/api/kraynet/profile/' + encodeURIComponent(a))).balance || '0')
const supply = async () => {
  const s = await jget('/api/kraynet/supply')
  return { emitted: BigInt(s.emitted || '0'), burned: BigInt(s.burned || '0') }
}

const id = (t) => {
  const s = nsha(new TextEncoder().encode('star-law-e2e|' + t + '|' + TAG))
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
  return { ...sub, _star: prep.star ?? sub.star, _message: prep.message, _code: prep.code, _address: sub.address }
}

async function main() {
  console.log('\n╔═ STAR LAW — live door on the regtest bench ═╗\n')
  const up = await jget('/api/kraynet/supply')
  if (up.__down) die(`no node at ${NODE} — start the official explorer on :4477 (do not touch pot-signer / Signet)`)
  const ov0 = await jget('/api/kraynet/overview')
  ok(ov0.conserves === true, 'bench conserves before the exam')
  ok(ov0.network === 'regtest', 'this mouth is the regtest explorer')

  const info = await jget('/api/kraynet/donation/info')
  if (info.contractStarBurn == null) {
    die('this :4477 process is stale — reload the official explorer so donation/info publishes contractStarBurn (do not touch pot-signer / Signet)')
  }
  if (info.contractLivingMouth == null) {
    die('this :4477 process is stale — reload the official explorer so the living mouth is on the door (do not touch pot-signer / Signet)')
  }
  if (info.contractOnceMotion == null) {
    die('this :4477 process is stale — reload the official explorer so contractOnceMotion is on the door (do not touch pot-signer / Signet)')
  }
  if (info.contractSource == null) {
    die('this :4477 process is stale — reload the official explorer so contractSource is on the door (do not touch pot-signer / Signet)')
  }
  if (info.contractExam == null) {
    die('this :4477 process is stale — reload the official explorer so contractExam is on the door (do not touch pot-signer / Signet)')
  }
  if (info.starSpeak == null) {
    die('this :4477 process is stale — reload the official explorer so starSpeak is on the door (do not touch pot-signer / Signet)')
  }
  if (info.contractCallV2 == null || info.runeLawPotClosed == null) {
    die('this :4477 process is stale — reload the official explorer so call v2 + rune-pot close are on the door (do not touch pot-signer / Signet)')
  }
  ok(Number(info.contractStarBurn) === 1, 'door publishes the v2 law burn (1 ₭)')
  ok(info.contractLivingMouth === true, 'door publishes the living mouth — tools travel with the face')
  ok(info.contractOnceMotion === true, 'door publishes once motion — true → false, one call, never back')
  ok(info.contractSource === true, 'door publishes the sealed IR on the star — the paper is public')
  ok(info.contractExam === true, 'door publishes the dry-run exam — no journal, no ₭')
  ok(info.starSpeak === true, 'door publishes speak — the star id is the lock, hold is free')
  ok(info.contractCallV2 === true, 'door publishes call v2 — signed clock, beacon from the last seal')
  ok(info.runeLawPotClosed === true, 'door publishes the rune-pot close — IR pays only ₭')
  ok(info.starSpeakConsume === 'lock', 'door publishes speak consume — the lock, not the journal')

  S('0b · Contract exam — dry run before a seal (no journal, no ₭)')
  const burnedExam0 = (await supply()).burned
  const examJs = await fetch(NODE + '/contract-exam.js').then((r) => r.text()).catch(() => '')
  ok(/KrayContractExam/.test(examJs), 'the exam widget is served on the door')
  const examLiving = await jpost('/api/kraynet/contract-exam', {
    living: { flags: [{ name: 'alive', on: true, motion: 'toggle' }, { name: 'valid', on: true, motion: 'once' }] },
  })
  ok(examLiving.ready === true && (examLiving.checks || []).some((c) => c.id === 'rule:once_valid' && c.kind === 'pass'),
    'living pass exam is ready — the latch fires green under the fixture')
  const examSol = await jpost('/api/kraynet/contract-exam', { source: 'pragma solidity ^0.8.0; contract X {}' })
  ok(examSol.ready === false && (examSol.checks || []).some((c) => c.kind === 'fail' && /not IR/i.test(c.label || '')),
    'Solidity is refused at parse — it never touches runCall')
  const examProse = await jpost('/api/kraynet/contract-exam', { source: 'this is my ticket contract please' })
  ok(examProse.ready === false && (examProse.checks || []).some((c) => c.kind === 'fail'),
    'prose is refused — not JSON IR')
  const examEmpty = await jpost('/api/kraynet/contract-exam', { source: '' })
  ok(examEmpty.ready === false, 'empty paper is not ready')
  const examMark = await jpost('/api/kraynet/contract-exam', {
    source: JSON.stringify({
      vars: { hit: '0' },
      rules: [{ name: 'mark', when: { lit: '1' }, then: [{ set: { var: 'hit', to: { lit: '1' } } }] }],
    }),
  })
  ok(examMark.ready === true && (examMark.checks || []).some((c) => c.id === 'rule:mark' && c.kind === 'pass'),
    'a dropped JSON IR runs mark green')
  const examScroll = await jpost('/api/kraynet/contract-exam', {
    form: { kind: 'scroll', each: '1', max: '10', locked: true, gate: 'open' },
  })
  ok(examScroll.ready === true && (examScroll.checks || []).some((c) => c.id === 'rule:claim'),
    'the Scroll template compiles — claim is on the paper')
  const examTunnel = await jpost('/api/kraynet/contract-exam', {
    form: { kind: 'tunnel' }, star: '1',
  })
  ok(!!examTunnel.code && (examTunnel.code.rules || []).some((r) => r.name === 'punch'),
    'the Tunnel template compiles — a dest-less pipe follows the face')
  const examVest = await jpost('/api/kraynet/contract-exam', {
    form: { kind: 'vest', beneficiary: 'KRAYEXAMBENE', total: '100', duration: '64', start: '0' },
  })
  ok(examVest.ready === true && (examVest.code.rules || []).some((r) => r.name === 'release'),
    'the Vest template compiles — release is on the paper')
  const examStamp = await jpost('/api/kraynet/contract-exam', {
    form: { kind: 'scroll', each: '1', max: '10', locked: true, gate: 'stamp' }, star: '0',
  })
  ok(!!examStamp.code && (examStamp.code.rules || []).some((r) => r.name === 'stamp'),
    'the Stamp template compiles — the owner names the winner')
  const examList = await jpost('/api/kraynet/contract-exam', {
    form: { kind: 'scroll', each: '1', max: '2', locked: true, gate: 'list', allow: ['KRAYEXAMONE', 'KRAYEXAMTWO'] },
  })
  ok(examList.ready === true && (examList.code.rules || []).some((r) => r.name === 'claim_0'),
    'the List template compiles — two sealed names, one claim each')
  ok((await supply()).burned === burnedExam0, 'the exam burned nothing')

  const alice = id('alice'), mallory = id('mallory')
  const mint = await jpost('/api/kraynet/donate', { to: alice.a, sats: '80' })
  if (!mint.ok) die('need KRAY_TRUSTED_DEV=1 on this throwaway regtest to mint for the exam — ' + (mint.error || ''))
  const mintM0 = await jpost('/api/kraynet/donate', { to: mallory.a, sats: '40' })
  if (!mintM0.ok) die('need KRAY_TRUSTED_DEV=1 — ' + (mintM0.error || ''))
  ok(await bal(alice.a) >= 80n, 'Alice minted ₭ on the bench')

  S('1 · Face first — a star to hang the law on')
  const named = await act(alice, { action: 'name', name: ('law' + String(Date.now()).slice(-8)).replace(/\W/g, '') })
  ok(named.ok === true && named._star != null, `star #${named._star} baptized`)
  const face = String(named._star)

  S('1b · Speak — the master id, free hold (no journal, no ₭)')
  const burnedSpeak0 = (await supply()).burned
  const ch = await jget('/api/kraynet/speak?star=' + face + '&audience=car')
  ok(ch.fee === '0' && ch.journal === false && String(ch.message || '').startsWith('kray-core.star.speak.v1|'),
    'the door issues a speak challenge — 0 ₭, no journal')
  const spoken = await jpost('/api/kraynet/speak', {
    message: ch.message, from: alice.a, signature: alice.sign(ch.message), publicKey: alice.x, scheme: 'kraywallet',
  })
  ok(spoken.spoken === true && spoken.audience === 'car', 'Alice spoke — the car lock would open')
  const thiefSpeak = await jpost('/api/kraynet/speak', {
    message: ch.message, from: mallory.a, signature: mallory.sign(ch.message), publicKey: mallory.x, scheme: 'kraywallet',
  })
  ok(!!thiefSpeak.error, 'Mallory cannot speak for Alice\'s face')
  ok((await supply()).burned === burnedSpeak0, 'speak burned nothing')
  const starPage = await fetch(NODE + '/star/' + face).then((r) => r.text()).catch(() => '')
  ok(/master id/.test(starPage) && /speakcard/.test(starPage), 'the star page names the master id and the speak mouth')

  S('2 · Living desk compiles at the door and burns 1 ₭')
  const burned0 = (await supply()).burned
  const bal0 = await bal(alice.a)
  const flags = [
    { name: 'alive', on: true },
    { name: 'open', on: true },
    { name: 'agent', on: false },
  ]
  const sealed = await act(alice, { action: 'contract', star: face, living: { flags } })
  ok(sealed.ok === true && !!sealed._address, `law sealed at ${sealed._address}`)
  ok(String(sealed._message || '').startsWith('kray-core.contract.v2|'), 'prepare signed the v2 domain')
  ok(String(sealed._message || '').endsWith('|onstar=' + face), 'onstar rides LAST')
  ok((sealed._code?.rules || []).some((r) => r.name === 'toggle_agent'), 'desk compiled toggle_agent into the signed IR')
  const view = await jget('/api/kraynet/star/' + face)
  ok(view.contract === sealed._address, 'GET /star returns the pot pointer')
  ok(view.law && view.law.state.alive === '1' && view.law.state.agent === '0', 'flags are 1/0 on the being')
  ok(view.law.code && (view.law.code.rules || []).some((r) => r.name === 'toggle_agent'),
    'GET /star publishes the sealed IR — not only rule names')
  ok(typeof view.law.codeHash === 'string' && /^[0-9a-f]{64}$/.test(view.law.codeHash),
    'codeHash is the 32-byte commitment the seal signed')
  const potView = await jget('/api/kraynet/contract/' + encodeURIComponent(sealed._address))
  ok(potView.codeHash === view.law.codeHash, 'GET /contract is the same paper as the star')
  ok(!!sealed.hash && /^[0-9a-f]{64}$/.test(sealed.hash), 'the seal act has a journal hash')
  const txSeal = await jget('/api/kraynet/tx/' + sealed.hash)
  ok(txSeal.kind === 'contract' && txSeal.code && txSeal.codeHash === view.law.codeHash,
    'GET /tx of the seal publishes the IR — the paper rides the act')
  ok(txSeal.contract === sealed._address, 'the seal tx names the keyless pot')
  const page = await fetch(NODE + '/star/' + face).then((r) => r.text()).catch(() => '')
  ok(/source — the sealed IR/.test(page), 'the star page carries the source disclosure')
  const studio = await fetch(NODE + '/inscribe').then((r) => r.text()).catch(() => '')
  ok(/data-itab="law"/.test(studio) && /data-lkind="pass"/.test(studio) && /data-lkind="times3"/.test(studio),
    'the write studio carries the Law tab — templates, not a fused relic')
  ok(/data-lkind="escrow"/.test(studio) && /data-lkind="tunnel"/.test(studio) && /data-lkind="vest"/.test(studio) && /data-lkind="scroll"/.test(studio),
    'the Law tab pastes the proven forms — escrow, tunnel, vest, scroll')
  ok(/data-lkind="stamp"/.test(studio) && /data-lkind="list"/.test(studio),
    'stamp and list scrolls are examples — the same paper, two gates')
  ok(/data-lkind="raffle"/.test(studio),
    'the Law tab carries raffle — enter · settle · draw on a face')
  ok(/id="i-lawrun"/.test(studio) && /contract-exam\.js/.test(studio) && /id="i-lawfile"/.test(studio),
    'the Law tab has Run test + a file drop before the seal')
  ok(/id="i-lawcode"/.test(studio) && /class="input lawsrc"/.test(studio) && /id="i-lawfields"/.test(studio) && /KrayContractPapers/.test(examJs),
    'Code is open — knobs configure a template, the source is the paper that seals')
  ok(/data-lkind="code"/.test(studio) && studio.indexOf('data-lkind="code"') < studio.indexOf('data-lkind="being"'),
    'Code is the first paper — write or drop a file before the examples')
  const acc = await jget('/api/kraynet/account/' + encodeURIComponent(alice.a))
  ok(((acc.written || []).find((w) => String(w.star) === face) || {}).contract === sealed._address,
    'the account marks the face as carrying a law — not a metadata lie')
  ok(await bal(alice.a) === bal0 - 1n, 'exactly 1 ₭ burned')
  ok((await supply()).burned === burned0 + 1n, 'supply.burned advanced by 1')

  S('3 · Pulse — the being breathes (fee, not burn)')
  const pulse = await act(alice, { action: 'contract-call', contract: sealed._address, rule: 'pulse', args: {} })
  ok(pulse.ok === true, 'owner pulsed')
  const musePulse = await act(mallory, { action: 'contract-call', contract: sealed._address, rule: 'pulse', args: {} })
  ok(musePulse.ok === true, 'a stranger may still pulse — public breath (A3)')
  const afterPulse = await jget('/api/kraynet/star/' + face)
  ok(afterPulse.law.state.alive === '1', 'pulse changed nothing but proved the leash')

  S('4 · Flip a flag')
  const flip = await act(alice, { action: 'contract-call', contract: sealed._address, rule: 'toggle_agent', args: {} })
  ok(flip.ok === true, 'living owner flipped agent')
  const afterFlip = await jget('/api/kraynet/star/' + face)
  ok(afterFlip.law.state.agent === '1', 'agent is now true — ready for a mouth')
  const thiefFlip = await act(mallory, { action: 'contract-call', contract: sealed._address, rule: 'toggle_agent', args: {} })
  ok(!!thiefFlip.error && /living owner|mouth/i.test(thiefFlip.error), 'Mallory cannot flip — she does not hold the star')

  S('5 · The mouth travels with the face')
  const sale = await act(alice, { action: 'sendstar', to: mallory.a, star: face })
  ok(sale.ok === true, `star #${face} sold to Mallory`)
  const ghost = await act(alice, { action: 'contract-call', contract: sealed._address, rule: 'toggle_alive', args: {} })
  ok(!!ghost.error && /living owner|mouth/i.test(ghost.error), 'Alice lost the mouth — she no longer holds the star')
  const newMouth = await act(mallory, { action: 'contract-call', contract: sealed._address, rule: 'toggle_alive', args: {} })
  ok(newMouth.ok === true, 'Mallory flipped alive — the received key runs the tools')
  const tip = await act(alice, { action: 'transfer', to: sealed._address, amount: '5' })
  ok(tip.ok === true, '5 ₭ sat in the pot after the sale')
  const ghostTake = await act(alice, { action: 'contract-call', contract: sealed._address, rule: 'collect', args: {} })
  ok(!!ghostTake.error, 'Alice cannot collect after selling')
  const take = await act(mallory, { action: 'contract-call', contract: sealed._address, rule: 'collect', args: {} })
  ok(take.ok === true, 'Mallory collected — ₭ went to the living owner')
  ok((await bal(mallory.a)) >= 5n, 'the pot paid Mallory, not the sealer')

  S('6 · Once motion — a latch, not a toggle')
  const ticketName = ('pass' + String(Date.now()).slice(-8)).replace(/\W/g, '')
  const ticket = await act(alice, { action: 'name', name: ticketName })
  ok(ticket.ok === true && ticket._star != null, `star #${ticket._star} baptized as the pass`)
  const onceFlags = [
    { name: 'alive', on: true, motion: 'toggle' },
    { name: 'valid', on: true, motion: 'once' },
  ]
  const passSeal = await act(alice, { action: 'contract', star: String(ticket._star), living: { flags: onceFlags } })
  ok(passSeal.ok === true && !!passSeal._address, `once-law sealed at ${passSeal._address}`)
  ok((passSeal._code?.rules || []).some((r) => r.name === 'once_valid') && !(passSeal._code?.rules || []).some((r) => r.name === 'toggle_valid'),
    'desk compiled once_valid — not toggle_valid')
  const spend = await act(alice, { action: 'contract-call', contract: passSeal._address, rule: 'once_valid', args: {} })
  ok(spend.ok === true, 'living owner spent once_valid')
  const spentView = await jget('/api/kraynet/star/' + ticket._star)
  ok(spentView.law && spentView.law.state.valid === '0', 'valid is now false — the latch is spent')
  const twiceOnce = await act(alice, { action: 'contract-call', contract: passSeal._address, rule: 'once_valid', args: {} })
  ok(!!twiceOnce.error, 'a second once_valid is refused — the latch does not return')
  const thiefOnce = await act(mallory, { action: 'contract-call', contract: passSeal._address, rule: 'once_valid', args: {} })
  ok(!!thiefOnce.error && /living owner|mouth|when/i.test(thiefOnce.error), 'Mallory cannot spend Alice\'s once clause')

  S('7 · Raw IR — the Code tab, not a template')
  const ink = await act(alice, { action: 'name', name: ('ink' + String(Date.now()).slice(-8)).replace(/\W/g, '') })
  ok(ink.ok === true && ink._star != null, `star #${ink._star} baptized for raw paper`)
  const rawCode = {
    vars: { hit: '0' },
    rules: [{ name: 'mark', when: { lit: '1' }, then: [{ set: { var: 'hit', to: { lit: '1' } } }] }],
  }
  const junk = await act(alice, { action: 'contract', star: String(ink._star), code: { vars: {}, rules: [] } })
  ok(!!junk.error, 'empty IR is refused — invalid paper never enters')
  const rawSeal = await act(alice, { action: 'contract', star: String(ink._star), code: rawCode })
  ok(rawSeal.ok === true && !!rawSeal._address, `raw IR sealed at ${rawSeal._address}`)
  const rawView = await jget('/api/kraynet/star/' + ink._star)
  ok(rawView.law && rawView.law.code && (rawView.law.code.rules || []).some((r) => r.name === 'mark'),
    'GET /star shows the pasted IR')
  const marked = await act(alice, { action: 'contract-call', contract: rawSeal._address, rule: 'mark', args: {} })
  ok(marked.ok === true, 'the pasted rule runs')
  const afterMark = await jget('/api/kraynet/star/' + ink._star)
  ok(afterMark.law && afterMark.law.state.hit === '1', 'state advanced from the raw paper')

  S('8 · Attacks — no second law, no stranger, no silent burn')
  const balBefore = await bal(alice.a)
  const burnedBefore = (await supply()).burned
  const twice = await act(alice, { action: 'contract', star: face, living: { flags } })
  ok(!!twice.error && /already|law/i.test(twice.error), 'second law on the same star is refused')
  const thief = await act(mallory, { action: 'contract', star: face, living: { flags } })
  ok(!!thief.error, 'Mallory cannot hang a law on Alice\'s star')
  const v1onStar = await jpost('/api/kraynet/prepare', { action: 'contract', from: alice.a, star: face, living: { flags } })
  ok(!!v1onStar.message && v1onStar.message.startsWith('kray-core.contract.v2|'), 'prepare with a star is always v2')
  ok(await bal(alice.a) === balBefore, 'attacks burned nothing')
  ok((await supply()).burned === burnedBefore, 'supply.burned unchanged by the refused acts')

  const ov = await jget('/api/kraynet/overview')
  ok(ov.conserves === true, 'bench still conserves')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n╚═ ${pass} checks passed — living law on star #${face}, pot ${sealed._address}, pulse + toggle, doors closed. ⚖⭐`)
}
main().catch((e) => { console.error(e); process.exit(1) })
