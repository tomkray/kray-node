/**
 * THE BOOK GATE — the guardians' law, now shared with the pen, proven against a mock book.
 *   node src/test/book-gate.test.ts
 *
 * Every branch of book-gate.ts is a live HTTP exchange here: lag (503), unreachable (503), a pre-rung-3
 * follower without /lineage (503), descendance (ok), a rewrite past the remembered head (403 that never
 * auto-clears), a rewrite past the remembered ANCHORED root (403), the anchored root ratcheting forward
 * only, the anti-TOCTOU confirm (503 when the snapshot moved), balances (spendable + locked; unknown →
 * null), and the head file's atomic persistence. Nothing here touches a real network.
 */
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  fetchLineage, bookHeadSnapshot, fetchBookBalance, exitPairs, bookBalances,
  lagGate, headGate, confirmSnapshot, nextHead, loadHeadFile, saveHeadFile,
} from '../protocol/book-gate.ts'

let pass = 0
function ok(c: boolean, m: string): void { if (c) { pass++; console.log('  ✓', m) } else { console.error('  ✗', m); process.exit(1) } }
const H = (n: number): string => n.toString(16).padStart(64, '0')

// ── a mock follower book whose answers the test steers ──────────────────────────────────────────
const state = {
  seq: 100, root: H(100), lineageSupported: true, unreachable: false,
  history: new Set<string>([H(90), H(100)]),          // roots the current history passes through
  anchors: [{ root: H(90), seq: 90 }] as Array<{ root: string; seq: number }>,
  balances: new Map<string, { amount: string; locked?: unknown }>(),
}
const book = createServer((req, res) => {
  if (state.unreachable) { req.socket.destroy(); return }
  const u = req.url || '/'
  res.setHeader('content-type', 'application/json')
  if (u === '/api/kraynet/head') { res.end(JSON.stringify({ seq: state.seq, cascadeRoot: state.root, network: 'regtest' })); return }
  const lin = /^\/api\/kraynet\/lineage\/([0-9a-f]{64})$/.exec(u)
  if (lin) {
    if (!state.lineageSupported) { res.statusCode = 404; res.end('{}'); return }
    const root = lin[1]
    const known = state.history.has(root)
    const last = state.anchors[state.anchors.length - 1] || null
    res.end(JSON.stringify({ root, known, seq: known ? Number(BigInt('0x' + root)) : null, head: { seq: state.seq, root: state.root }, lastProvenAnchor: last }))
    return
  }
  const bal = /^\/api\/kraynet\/runes\/of\/(.+)$/.exec(u)
  if (bal) {
    const addr = decodeURIComponent(bal[1])
    const b = state.balances.get(addr)
    res.end(JSON.stringify({ runes: b ? [{ id: '1:1', amount: b.amount, ...(b.locked !== undefined ? { locked: b.locked } : {}) }] : [] }))
    return
  }
  res.statusCode = 404; res.end('{}')
})

async function main() {
  await new Promise<void>((r) => book.listen(0, '127.0.0.1', () => r()))
  const port = (book.address() as { port: number }).port
  const URL = `http://127.0.0.1:${port}`
  const dir = mkdtempSync(join(tmpdir(), 'kray-book-gate-'))
  const headFile = join(dir, 'pot-head.json')

  // ── primitives ──
  const snap = await bookHeadSnapshot(URL)
  ok(!!snap && snap.seq === 100 && snap.root === H(100), 'head snapshot reads seq + cascadeRoot')
  const lin = await fetchLineage(URL, H(90))
  ok(!!lin && !('unsupported' in lin) && lin.known === true && lin.head.seq === 100, 'lineage: a root the history passes through is KNOWN, with the current head')
  const unk = await fetchLineage(URL, H(7))
  ok(!!unk && !('unsupported' in unk) && unk.known === false, 'lineage: a foreign root is NOT known')
  state.lineageSupported = false
  const pre = await fetchLineage(URL, H(90))
  ok(!!pre && 'unsupported' in pre, 'lineage: a pre-rung-3 follower (404) reads as unsupported, not as a verdict')
  state.lineageSupported = true
  state.unreachable = true
  ok((await fetchLineage(URL, H(90))) === null && (await bookHeadSnapshot(URL)) === null, 'an unreachable book reads as null everywhere — a liveness answer')
  state.unreachable = false

  // ── balances: spendable + LOCKED, unknown → null ──
  state.balances.set('alice', { amount: '60', locked: { amount: '40' } })
  state.balances.set('bob', { amount: '5', locked: '7' })
  ok((await fetchBookBalance(URL, 'alice', '1:1')) === 100n, 'balance = spendable + locked (object form)')
  ok((await fetchBookBalance(URL, 'bob', '1:1')) === 12n, 'balance = spendable + locked (string form)')
  ok((await fetchBookBalance(URL, 'carol', '1:1')) === 0n, 'an address the book answers for but that holds none → 0 (a verdict, not a fault)')
  ok((await fetchBookBalance(URL, 'alice', '2:2')) === 0n, 'a rune the address does not hold → 0')
  state.unreachable = true
  ok((await fetchBookBalance(URL, 'alice', '1:1')) === null, 'an unreachable book → null → the signer refuses fail-closed')
  state.unreachable = false
  const pairs = exitPairs({ exit: { from: 'Alice', runeId: '1:1' }, exits: [{ from: 'alice', runeId: '1:1' }, { from: 'bob', runeId: '1:1' }] })
  ok(pairs.length === 2, 'exit pairs are de-duplicated case-insensitively (the initiator appears once)')
  const lookup = await bookBalances(URL, { exit: { from: 'alice', runeId: '1:1' }, exits: [{ from: 'alice', runeId: '1:1' }, { from: 'bob', runeId: '1:1' }] })
  ok(lookup('ALICE', '1:1') === 100n && lookup('bob', '1:1') === 12n && lookup('dave', '1:1') === null, 'the prefetched lookup answers every pair, null for anything it did not fetch')

  // ── rung 2: lag ≠ theft ──
  ok((await lagGate(URL, 0)) === null, 'no minSeal → no lag gate')
  ok((await lagGate(URL, 100)) === null, 'book at the exit seq → passes')
  const lag = await lagGate(URL, 101, 'pen')
  ok(!!lag && lag.status === 503 && lag.lagging === true && lag.bookSeq === 100 && /lagging/.test(lag.reason), 'book behind the exit seq → 503 lagging (retriable), never a refusal')
  state.unreachable = true
  const lagDown = await lagGate(URL, 5)
  ok(!!lagDown && lagDown.status === 503 && lagDown.bookSeq === null, 'unreachable book with a minSeal → 503 lagging')
  state.unreachable = false

  // ── rung 3: bootstrap, then descendance, then the rewrite ──
  ok(loadHeadFile(headFile) === null, 'no head file yet → no memory (bootstrap)')
  const boot = await headGate(URL, null, 'pen')
  ok(boot.ok && boot.gateHead?.root === H(100) && boot.lineageSupported && boot.gateAnchor?.root === H(90), 'bootstrap captures the head and the deepest proven anchor')
  const first = nextHead(boot as never, null)
  ok(!!first && first.root === H(100) && first.anchoredRoot === H(90), 'the first sign plants the memory: head + anchored root')
  saveHeadFile(headFile, first!)
  ok(existsSync(headFile) && !existsSync(headFile + '.tmp') && loadHeadFile(headFile)?.root === H(100), 'the head file is written atomically and reads back')
  // the book advances honestly: 100 → 120, history still passes through 100 and 90
  state.seq = 120; state.root = H(120); state.history.add(H(120))
  const desc = await headGate(URL, loadHeadFile(headFile), 'pen')
  ok(desc.ok && desc.gateHead?.seq === 120, 'an honest advance descends from the remembered head → ok')
  // a deeper anchor appears: the memory ratchets forward
  state.anchors.push({ root: H(110), seq: 110 }); state.history.add(H(110))
  const deeper = await headGate(URL, loadHeadFile(headFile), 'pen')
  ok(deeper.ok && deeper.gateAnchor?.root === H(110), 'a DEEPER proven anchor is adopted')
  saveHeadFile(headFile, nextHead(deeper as never, loadHeadFile(headFile))!)
  ok(loadHeadFile(headFile)?.anchoredRoot === H(110), 'the anchored root ratcheted forward')
  // the book later claims a SHALLOWER anchor: the memory keeps 110
  state.anchors.push({ root: H(95), seq: 95 }); state.history.add(H(95))
  const shallow = await headGate(URL, loadHeadFile(headFile), 'pen')
  ok(shallow.ok && shallow.gateAnchor?.root === H(110), 'a shallower anchor hint never walks the memory backwards')
  // THE REWRITE: a history that no longer passes through the remembered head
  state.history.delete(H(120)); state.seq = 130; state.root = H(130); state.history.add(H(130))
  const rewrite = await headGate(URL, loadHeadFile(headFile), 'pen')
  ok(!rewrite.ok && rewrite.status === 403 && rewrite.equivocation === true && /EQUIVOCATION/.test(rewrite.reason), 'a history that abandons the remembered head → 403 EQUIVOCATION (never auto-clears)')
  state.history.add(H(120))
  // THE DEEPER REWRITE: the head still known, but the anchored root abandoned
  state.history.delete(H(110))
  const anchorGone = await headGate(URL, loadHeadFile(headFile), 'pen')
  ok(!anchorGone.ok && anchorGone.status === 403 && /anchored root/.test(anchorGone.reason), 'a history that abandons the remembered ANCHORED root → 403')
  state.history.add(H(110))
  // liveness faults are 503, never 403
  state.lineageSupported = false
  const noLin = await headGate(URL, loadHeadFile(headFile), 'pen')
  ok(!noLin.ok && noLin.status === 503 && noLin.lagging === true, 'a pre-rung-3 book with a memory to check → 503 (update the follower), not a verdict')
  state.lineageSupported = true
  state.unreachable = true
  const down = await headGate(URL, loadHeadFile(headFile), 'pen')
  ok(!down.ok && down.status === 503, 'an unreachable book with a memory to check → 503')
  state.unreachable = false

  // ── rung 4: the anti-TOCTOU confirm ──
  const g = await headGate(URL, loadHeadFile(headFile), 'pen')
  ok(g.ok && (await confirmSnapshot(URL, g as never, 'pen')) === null, 'same snapshot after the balances → confirmed')
  state.seq = 131; state.root = H(131); state.history.add(H(131))
  const moved = await confirmSnapshot(URL, g as never, 'pen')
  ok(!!moved && moved.status === 503 && /swapped|advanced/.test(moved.reason), 'the book moved mid-request → 503 retry (the balances and the gate must agree)')

  book.close()
  console.log(`\n╚═ ${pass} passed — the book gate: lag is a wait, a rewrite is a refusal, an unknown balance is a refusal, and the memory only moves forward. ⛓₭`)
}
main().catch((e) => { console.error(e); process.exit(1) })
