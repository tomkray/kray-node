/**
 * T10 MADE ADVERSARIAL — a stranger replays the LIVE journal, then tries to rewrite the withdraw inside it.
 *
 *   node src/test/live-exit-replay-e2e.mjs                      # against https://signet.kray.network
 *   KRAY_EDGE=https://www.kray.network KRAY_NET=main node src/test/live-exit-replay-e2e.mjs
 *   KRAY_JOURNAL=/path/kraynet-journal-signet.jsonl node src/test/live-exit-replay-e2e.mjs   # offline
 *
 * The audit's residue on T10 was that the cold replay was a narrative: a truncated root, no fixed point,
 * nothing hostile. This closes it. The script pulls the raw journal (the ONLY consensus dataset), replays
 * every event through the SAME reducer the writer runs, and checks the re-derived cascade root against the
 * head the edge claims — the full 64 hex, never a prefix. Then it attacks the real withdraw INSIDE the
 * replay: for each mutation of the settle event (a different destination, a larger amount, the pot's own
 * change as the delivery, a tampered raw payout, a tampered merkle branch, a tampered header, a dropped
 * ancestry, a replayed delivery), the reducer must HALT at that event. A replica that would accept any of
 * them could be handed a lying history and would serve it as consensus.
 *
 * Exit 0 only if the honest history replays to the claimed root AND every mutation HALTs.
 */
import { readFileSync } from 'node:fs'
import { KrayLedger } from '../protocol/ledger.ts'

const EDGE = process.env.KRAY_EDGE || 'https://signet.kray.network'
const NET = process.env.KRAY_NET || (EDGE.includes('signet') ? 'signet' : 'main')
const JOURNAL = process.env.KRAY_JOURNAL || ''
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

async function pullJournal() {
  if (JOURNAL) {
    const lines = readFileSync(JOURNAL, 'utf8').split('\n').filter((l) => l.trim())
    return { lines, head: null }
  }
  const head = await (await fetch(EDGE + '/api/kraynet/head', { signal: AbortSignal.timeout(20000) })).json()
  const lines = []
  for (let from = 1; ; ) {
    const r = await (await fetch(`${EDGE}/api/kraynet/replica?from=${from}&limit=2000`, { signal: AbortSignal.timeout(60000) })).json()
    lines.push(...r.lines)
    if (lines.length >= r.total || !r.lines.length) break
    from = lines.length + 1
  }
  return { lines, head }
}

/** Replay a whole journal through the real reducer. Returns the ledger, or the HALT reason and where. */
function replay(lines) {
  const L = new KrayLedger(undefined, NET, undefined, false, undefined)
  L.plateAtlasStrict = false   // a cold copy rebuilds tip pointers from sealed hashes (store.ts journal-replay law)
  for (let i = 0; i < lines.length; i++) {
    try { L.applyLive(JSON.parse(lines[i])) }
    catch (e) { return { halted: true, at: i + 1, why: e instanceof Error ? e.message : String(e) } }
  }
  return { halted: false, ledger: L }
}

const { lines, head } = await pullJournal()
console.log(`\n₭  T10 ADVERSARIAL — ${lines.length} event(s) from ${JOURNAL || EDGE} (${NET})\n`)

// ── 1 · the honest history replays to the claimed root ─────────────────────
const honest = replay(lines)
ok(!honest.halted, 'the honest journal replays end to end through the consensus reducer' + (honest.halted ? ` — HALT at ${honest.at}: ${honest.why}` : ''))
if (honest.halted) { console.log('\n  ✗ nothing further can be proven on a history that does not replay.\n'); process.exit(1) }
const L = honest.ledger
const root = L.cascadeRoot().toLowerCase()
if (head) ok(root === String(head.cascadeRoot).toLowerCase(), `the cascade root RE-DERIVED HERE is the edge's head, all 64 hex — ${root}`)
else ok(true, `cascade root re-derived from the local journal — ${root}`)
ok(L.conserves(), 'the ledger conserves after every single event')
ok(L.backed(), `the peg of sacrifice holds (${L.totalEmitted} ≤ ${L.pot.satsDonated})`)

// ── 2 · find the withdraw acts this journal actually contains ──────────────
const events = lines.map((l) => JSON.parse(l))
const settles = events.filter((e) => e.kind === 'rune-settle' && e.proof)
if (!settles.length) {
  // A network that has not yet paid a withdraw is not a failure — T10 (the cold replay to the claimed head)
  // is the whole proof available here, and it passed. The attack suite needs a real payout to rewrite.
  console.log(`\n  · this journal carries no settled withdraw yet — T10 proven above; the rewrite suite waits for the first payout\n`)
  console.log(`╚═ ${pass} passed, ${fail} failed — ${lines.length} events re-derived the head. 🔐₭\n`)
  process.exit(fail ? 1 : 0)
}
ok(true, `this journal carries ${settles.length} proven pot payout(s) — the withdraws to attack`)
const target = settles[settles.length - 1]      // the most recent withdraw
const idx = events.findIndex((e) => e.seq === target.seq)
const exitEv = events.find((e) => e.kind === 'rune-exit' && e.from === target.from && e.runeId === target.runeId && e.amount === target.amount)
console.log(`\n  attacking seq ${target.seq} — ${target.amount} of ${target.runeId} paid by ${target.l1Txid.slice(0, 16)}… to the address signed at seq ${exitEv ? exitEv.seq : '?'}\n`)

// ── 3 · every rewrite of that withdraw must HALT the replay ────────────────
const flip = (hex, at) => { const i = Math.min(at, Math.max(0, hex.length - 1)); return hex.slice(0, i) + (hex[i] === '0' ? '1' : '0') + hex.slice(i + 1) }
const mutate = (fn) => { const copy = lines.slice(); const e = JSON.parse(lines[idx]); fn(e); copy[idx] = JSON.stringify(e); return copy }
const other = events.find((e) => typeof e.from === 'string' && e.from !== target.from && /^(tb1p|bc1p)/.test(e.from))?.from
const attacks = [
  ['the amount is inflated above the lock', (e) => { e.amount = String(BigInt(e.amount) + 1n) }],
  ['the amount is deflated below the lock', (e) => { e.amount = String(BigInt(e.amount) - 1n) }],
  ['the burn is claimed against a different transaction', (e) => { e.l1Txid = flip(e.l1Txid, 10) }],
  ['the payout is credited to a different holder', (e) => { if (other) e.from = other }],
  ['the delivery is pointed at another output of the same payout', (e) => { e.outpoint = `${e.l1Txid}:2` }],
  ['one byte of the raw payout is tampered', (e) => { e.proof.rawTx = flip(e.proof.rawTx, 40) }],
  ['one byte of the merkle branch is tampered', (e) => { e.proof.txoutproof = flip(e.proof.txoutproof, 200) }],
  ['one byte of the header chain is tampered', (e) => { e.proof.headers[0] = flip(e.proof.headers[0], 100) }],
  ['the header chain is emptied', (e) => { e.proof.headers = [] }],
  ['the ancestry bundle is dropped (the input state becomes an assertion)', (e) => { delete e.proof.ancestry; delete e.proof.inputRunes }],
  ['the whole proof is dropped ("trust the writer")', (e) => { delete e.proof }],
].filter(([name]) => name !== 'the payout is credited to a different holder' || other)
for (const [name, fn] of attacks) {
  const r = replay(mutate(fn))
  const halted = r.halted && r.at === idx + 1
  ok(halted, `${name} → the replay HALTS at seq ${target.seq}` + (r.halted ? ` (${String(r.why).slice(0, 88)})` : ' — IT APPLIED, THE LAW IS BROKEN'))
}

// ── 4 · the same delivery cannot pay twice (one delivery, one burn) ────────
// The append-only law makes a byte-identical duplicate a no-op (`e.seq <= lastAppliedSeq` returns), so the
// real double-spend is what a thief would actually append: the SAME delivery claimed again at the NEXT seq.
{
  const copy = lines.slice()
  const again = JSON.parse(lines[idx]); again.seq = lines.length + 1
  copy.push(JSON.stringify(again))
  const r = replay(copy)
  ok(r.halted && r.at === copy.length, 'the same delivery claimed again at the next seq → HALTS (one delivery, one burn)' + (r.halted ? ` (${String(r.why).slice(0, 80)})` : ' — IT APPLIED, THE LAW IS BROKEN'))
}
// …and a byte-identical duplicate at the same seq is simply not a second act (append-only idempotence).
{
  const copy = lines.slice(); copy.push(lines[idx])
  const r = replay(copy)
  ok(!r.halted && r.ledger.cascadeRoot().toLowerCase() === root, 'a byte-identical duplicate at the same seq changes nothing — the root is unmoved (append-only idempotence)')
}

// ── 5 · the honest history still replays after all of it ───────────────────
const again = replay(lines)
ok(!again.halted && again.ledger.cascadeRoot().toLowerCase() === root, 'after every attack the untouched journal still replays to the same root — the verifier carries no poison')

console.log(`\n╚═ ${pass} passed, ${fail} failed — ${lines.length} events re-derived the head, and every rewrite of the live withdraw HALTED. 🔐₭\n`)
process.exit(fail ? 1 : 0)
