/**
 * THE STRANGER — day 1 → tip from the journal alone.
 *
 * A person who wants to verify does not trust the desk, the quote, or the operator.
 * They replay every line. If anything in the AMM history is not the math, the
 * replay HALTs or the cascade root diverges. That is the whole proof.
 *
 *   node src/test/amm-stranger-verify.ts
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import * as btc from '@scure/btc-signer'
import { LedgerStore } from '../protocol/store.ts'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes, ammAddMessage, ammRemoveMessage, ammSwapMessage } from '../protocol/scheme.ts'
import { sha256hex, canonical, type KrayEvent } from '../protocol/kray-primitives.ts'
import { ammPoolAddress, quoteOut } from '../protocol/amm.ts'
import { parseRuneKey } from '../economics/rune-book.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`)
  process.exit(1)
}

const NET = 'regtest'
const BNET = toBtcNet(NET)
const RUNE = '840000:9'
interface Wallet { addr: string; sk: Uint8Array; pk: string }
function makeWallet(tag: string): Wallet {
  const sk = createHash('sha256').update(`kraynet-amm-stranger|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[BNET]).address!, sk, pk: publicKeyHex }
}
const A = makeWallet('A')
const B = makeWallet('B')

function finger(S: LedgerStore): string {
  const L = S.ledger
  const pot = ammPoolAddress(RUNE)
  const rid = parseRuneKey(RUNE)
  return [
    `seq:${S.seq}`, `head:${S.head}`, `cascade:${L.cascadeRoot()}`,
    `amm:${L.amm.commitment()}`, `k:${L.balanceOf(pot) * L.runes.balanceOf(rid, pot)}`,
    `potK:${L.balanceOf(pot)}`, `potR:${L.runes.balanceOf(rid, pot)}`,
    `A:${L.balanceOf(A.addr)}`, `B:${L.balanceOf(B.addr)}`,
    `lpA:${L.amm.lpOf(RUNE, A.addr)}`, `lpB:${L.amm.lpOf(RUNE, B.addr)}`,
    `emitted:${L.totalEmitted}`, `conserves:${L.conserves()}`, `solvent:${L.runesSolvent()}`, `ammSolvent:${L.ammSolvent()}`,
  ].join('|')
}

function signAdd(S: LedgerStore, w: Wallet, krayIn: string, runeIn: string, minLp: string): void {
  const nonce = S.ledger.nonceOf(w.addr)
  const msg = ammAddMessage(NET, w.addr, RUNE, BigInt(krayIn), BigInt(runeIn), BigInt(minLp), nonce)
  S.append({
    kind: 'amm-add', from: w.addr, runeId: RUNE, krayIn, runeIn, minLp, fee: '1',
    nonce, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet',
  } as KrayEvent)
}
function signSwap(S: LedgerStore, w: Wallet, side: 'kray' | 'rune', amount: string, minOut: string): void {
  const nonce = S.ledger.nonceOf(w.addr)
  const msg = ammSwapMessage(NET, w.addr, RUNE, side, BigInt(amount), BigInt(minOut), nonce)
  S.append({
    kind: 'amm-swap', from: w.addr, runeId: RUNE, side, amount, minOut, fee: '1',
    nonce, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet',
  } as KrayEvent)
}
function signRemove(S: LedgerStore, w: Wallet, lp: string, minK: string, minR: string): void {
  const nonce = S.ledger.nonceOf(w.addr)
  const msg = ammRemoveMessage(NET, w.addr, RUNE, BigInt(lp), BigInt(minK), BigInt(minR), nonce)
  S.append({
    kind: 'amm-remove', from: w.addr, runeId: RUNE, lp, minKrayOut: minK, minRuneOut: minR, fee: '1',
    nonce, publicKey: w.pk, signature: _signKrayWallet(msg, w.sk), scheme: 'kraywallet',
  } as KrayEvent)
}

function fund(S: LedgerStore, to: string, kray: string, runeAmt: string): void {
  S.append({ kind: 'donate', to, amount: kray } as KrayEvent)
  const op = createHash('sha256').update(`${to}|${S.seq}`).digest('hex') + ':0'
  S.append({ kind: 'rune-deposit', runeId: RUNE, outpoint: op, to, amount: runeAmt, pool: true } as KrayEvent)
}

function rehash(line: string, mutate: (e: Record<string, unknown>) => void): string {
  const e = JSON.parse(line) as Record<string, unknown>
  const prev = String(e.prevHash)
  mutate(e)
  const { hash: _h, ...rest } = e
  e.hash = sha256hex(prev + canonical(rest as unknown as KrayEvent))
  return JSON.stringify(e)
}

function bootMustHalt(dir: string, why: string): void {
  let threw = false
  try { new LedgerStore(dir, NET, undefined, undefined, true) } catch { threw = true }
  ok(threw, `stranger HALTs — ${why}`)
}

async function liveTip(): Promise<{ cascadeRoot: string; seq: number; conserves: boolean } | null> {
  try {
    const r = await fetch('http://127.0.0.1:4477/api/kraynet/overview', { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return null
    return await r.json() as { cascadeRoot: string; seq: number; conserves: boolean }
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  console.log('\n╔═ THE STRANGER — rebuild day 1 → tip. Anything off the math HALTs. ═╗')
  const dir = join(tmpdir(), `kraynet-amm-stranger-${process.pid}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  const S = new LedgerStore(dir, NET, undefined, undefined, true)
  fund(S, A.addr, '9000', '40000')
  fund(S, B.addr, '9000', '20000')
  signAdd(S, A, '4000', '8000', '1')
  const pot = ammPoolAddress(RUNE)
  const rid = parseRuneKey(RUNE)
  const out = quoteOut(S.ledger.balanceOf(pot), S.ledger.runes.balanceOf(rid, pot), 500n)
  signSwap(S, B, 'kray', '500', out.toString())
  signAdd(S, B, '1100', '2000', '1')
  const lpB = S.ledger.amm.lpOf(RUNE, B.addr)
  signRemove(S, B, lpB.toString(), '1', '1')
  ok(S.ledger.conserves() && S.ledger.runesSolvent() && S.ledger.ammSolvent(), 'day-N: conserved + rune-solvent + AMM solvent')
  ok(!S.ledger.amm.empty(), 'day-N: the LP book is on the cascade')
  const truth = finger(S)
  const tip = S.ledger.cascadeRoot()
  const n = S.seq

  const stranger = new LedgerStore(dir, NET, undefined, undefined, true)
  ok(finger(stranger) === truth, 'stranger rebuilt day 1 → tip — fingerprint byte-exact')
  ok(stranger.ledger.cascadeRoot() === tip, `stranger cascade ${tip.slice(0, 16)}… matches the writer`)
  ok(stranger.seq === n, `stranger walked every seq (1…${n})`)
  ok(stranger.ledger.conserves() && stranger.ledger.runesSolvent() && stranger.ledger.ammSolvent(), 'stranger: A1 + rune + AMM solvency still hold')

  const journal = join(dir, `kraynet-journal-${NET}.jsonl`)
  const raw = readFileSync(journal, 'utf8')
  const lines = raw.trim().split('\n')
  const swapAt = lines.findLastIndex((l) => l.includes('"amm-swap"'))
  ok(swapAt >= 0, 'history contains a sealed swap')

  const quoteDir = join(tmpdir(), `kraynet-amm-quote-lie-${process.pid}`)
  rmSync(quoteDir, { recursive: true, force: true }); mkdirSync(quoteDir, { recursive: true })
  const lied = lines.slice()
  lied[swapAt] = rehash(lied[swapAt], (e) => { e.amountOut = '999999' })
  writeFileSync(join(quoteDir, `kraynet-journal-${NET}.jsonl`), lied.join('\n') + '\n')
  bootMustHalt(quoteDir, 'a journaled amountOut (a quote pretending to be proof)')

  const stealDir = join(tmpdir(), `kraynet-amm-steal-${process.pid}`)
  rmSync(stealDir, { recursive: true, force: true }); mkdirSync(stealDir, { recursive: true })
  const stolen = lines.slice()
  stolen[swapAt] = rehash(stolen[swapAt], (e) => { e.amount = '1' })
  writeFileSync(join(stealDir, `kraynet-journal-${NET}.jsonl`), stolen.join('\n') + '\n')
  bootMustHalt(stealDir, 'amount changed after the signature (drain attempt)')

  const breakDir = join(tmpdir(), `kraynet-amm-break-${process.pid}`)
  rmSync(breakDir, { recursive: true, force: true }); mkdirSync(breakDir, { recursive: true })
  const broken = lines.slice()
  broken[swapAt] = broken[swapAt].replace(/"hash":"[0-9a-f]{64}"/, '"hash":"' + 'ab'.repeat(32) + '"')
  writeFileSync(join(breakDir, `kraynet-journal-${NET}.jsonl`), broken.join('\n') + '\n')
  bootMustHalt(breakDir, 'a broken hash-chain (corruption)')

  rmSync(quoteDir, { recursive: true, force: true })
  rmSync(stealDir, { recursive: true, force: true })
  rmSync(breakDir, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })

  const lab = process.env.KRAY_LAB_JOURNAL
    || join(homedir(), 'ai-projects/kray-net/apps/kray-net/data-v2/kraynet-journal-regtest.jsonl')
  if (existsSync(lab)) {
    const liveDir = join(tmpdir(), `kraynet-amm-lab-${process.pid}`)
    rmSync(liveDir, { recursive: true, force: true }); mkdirSync(liveDir, { recursive: true })
    copyFileSync(lab, join(liveDir, `kraynet-journal-${NET}.jsonl`))
    const labNode = new LedgerStore(liveDir, NET, undefined, undefined, true)
    ok(labNode.seq > 0, `lab journal: stranger walked ${labNode.seq} events from line 1`)
    ok(labNode.ledger.conserves() && labNode.ledger.runesSolvent() && labNode.ledger.ammSolvent(), 'lab journal: conserved + rune + AMM solvent after full replay')
    const ov = await liveTip()
    if (ov && ov.cascadeRoot) {
      ok(labNode.ledger.cascadeRoot() === ov.cascadeRoot, 'lab journal: stranger root equals the live :4477 tip')
      ok(ov.conserves === true, 'live tip reports A1')
    } else {
      ok(true, 'lab journal replayed (live :4477 not compared — node not answering)')
    }
    rmSync(liveDir, { recursive: true, force: true })
  }

  console.log(`\n✓ ${pass} checks — the stranger compiled the same world. A lie in the journal HALTs. ₿₭`)
}

main().catch((e) => { console.error(e); process.exit(1) })
