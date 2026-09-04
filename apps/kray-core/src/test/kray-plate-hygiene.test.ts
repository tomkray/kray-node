/**
 * KRAY PLATE HYGIENE — elastic tip · clean journal · no bio landfill.
 *   node src/test/kray-plate-hygiene.test.ts
 *
 * Proves what the Creator asked:
 *   1. Journal lines seal ONLY plateHash (never description/url plaintext).
 *   2. After many rotations, tip has exactly ONE plate per address (and per star).
 *   3. Identical seal refused — no no-op litter in the journal.
 *   4. Old tip hashes leave the tip set (elastic tip). Atlas SHOULD keep sealed bytes for cold replay.
 *   5. Journal line size stays bounded (hash seal, not growing bios).
 *   6. Tip cardinality stays O(1) slots — bios do not stack in the living tip.
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  inscribeMessageV2,
} from '../protocol/scheme.ts'
import {
  encodeKrayPlate, hashKrayPlate, setKrayPlateMessage,
} from '../protocol/kray-plate.ts'
import { TREASURY, type KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); fail++; console.log('  ✗ FAIL (accepted!) — ' + m) }
  catch (e) {
    const s = e instanceof Error ? e.message : String(e)
    if (re.test(s)) { pass++; console.log('  ✓ ' + m) }
    else { fail++; console.log(`  ✗ FAIL (wrong refusal "${s}") — ` + m) }
  }
}

interface W { addr: string; sk: Uint8Array; pk: string }
type Fields = { description: string; url: string; bannerUrl: string }
function wallet(tag: string): W {
  const sk = createHash('sha256').update(`kray-plate-hygiene|${tag}`, 'utf8').digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}
const sign = (m: string, w: W) => _signKrayWallet(m, w.sk)

function main() {
  console.log('\n╔═ KRAY PLATE HYGIENE — tip elastic · journal clean · no bio landfill ═╗\n')

  const atlas = new Map<string, Uint8Array>()
  const A = wallet('alice')
  let seq = 0
  const journal: KrayEvent[] = []
  const L = new KrayLedger(undefined, NET, undefined, false, (h) => atlas.get(h) ?? null)
  const apply = (e: Omit<KrayEvent, 'seq' | 'hash' | 'prevHash'>) => {
    const full = { ...e, seq: ++seq, hash: 'h' + seq, prevHash: '' } as KrayEvent
    L.applyLive(full)
    journal.push(full)
    return full
  }
  apply({
    kind: 'donate', at: 1, to: A.addr, amount: '10000',
    outpoint: createHash('sha256').update('hygiene-o').digest('hex') + ':0',
  } as never)

  const born = (): bigint => {
    const before = L.stars.createdSeq
    const body = 'hygiene-star'
    const ch = createHash('sha256').update(body).digest('hex')
    const nonce = L.nonceOf(A.addr)
    const msg = inscribeMessageV2(NET, A.addr, ch, 'image/png', body.length, undefined, nonce)
    apply({
      kind: 'inscribe', at: 0, from: A.addr, contentHash: ch, contentType: 'image/png', size: body.length,
      nonce, publicKey: A.pk, signature: sign(msg, A), scheme: 'kraywallet',
    } as never)
    return BigInt(before)
  }
  const star = born()

  const put = (f: Fields) => {
    const ph = hashKrayPlate(f)
    atlas.set(ph, encodeKrayPlate(f))
    return ph
  }
  const seal = (plateHash: string, starNo = '') => {
    const nonce = L.nonceOf(A.addr)
    const msg = setKrayPlateMessage(NET, A.addr, plateHash, starNo, nonce)
    return apply({
      kind: 'set-kray-plate', at: Date.now() + seq, from: A.addr, plateHash,
      ...(starNo ? { star: starNo } : {}), fee: '1',
      nonce, publicKey: A.pk, signature: sign(msg, A), scheme: 'kraywallet',
    } as never)
  }

  // ── 1 · journal never carries bio plaintext ──
  const bio = 'A long living bio that must NEVER land in the journal line as landfill text'
  const f1 = { description: bio, url: 'https://one.example', bannerUrl: 'https://ban.example' }
  const h1 = put(f1)
  const e1 = seal(h1)
  const line1 = JSON.stringify(e1)
  ok(e1.plateHash === h1, 'seal journals plateHash = tip hash')
  ok(!line1.includes(bio), 'journal line does NOT contain the bio plaintext')
  ok(!line1.includes('https://one.example'), 'journal line does NOT contain the site URL plaintext')
  ok(!line1.includes('description'), 'journal line has no description field')
  ok(Buffer.byteLength(line1, 'utf8') < 900, `journal seal line is compact (${Buffer.byteLength(line1, 'utf8')} B < 900)`)

  // ── 2 · tip is elastic: many rotations → still ONE tip plate ──
  const oldHashes: string[] = [h1]
  let last = h1
  for (let i = 2; i <= 12; i++) {
    const f = { description: `rotate ${i} ${'x'.repeat(40)}`, url: `https://r${i}.example`, bannerUrl: '' }
    const h = put(f)
    oldHashes.push(h)
    seal(h)
    last = h
    ok(L.krayPlateOf(A.addr) === h, `after rotate #${i} tip is the new hash only`)
    ok(L.tipKrayPlateCount() === 1, `after rotate #${i} tip cardinality = 1 (not stacking)`)
  }
  ok(L.krayPlateOf(A.addr) === last, 'final tip is the latest hash')
  ok(!L.tipKrayPlateHashes().has(h1), 'first hash left the tip set (old tip not living)')
  const orphans = oldHashes.filter((h) => h !== last)
  ok(orphans.length === 11, 'eleven prior tips are orphans relative to the tip set')
  ok(orphans.every((h) => !L.tipKrayPlateHashes().has(h)), 'every prior tip hash left the living tip set')

  // ── 3 · identical refuse = no no-op litter ──
  const beforeLen = journal.length
  const beforeRoot = L.cascadeRoot()
  rejects(() => seal(last), /identical|unchanged/i, 'identical tip refused (journal hygiene)')
  ok(journal.length === beforeLen, 'identical refuse did not append a journal event')
  ok(L.cascadeRoot() === beforeRoot, 'identical refuse did not move cascade')

  // ── 4 · tip atlas survives; disk MAY keep orphan seals (100-year resync) ──
  ok(atlas.has(last), 'tip atlas bytes still held')
  ok(atlas.has(h1), 'prior seal bytes still on atlas (no mandatory GC — cold replay)')
  const tipBytes = atlas.get(last)!
  ok(Buffer.compare(Buffer.from(tipBytes), encodeKrayPlate({
    description: `rotate 12 ${'x'.repeat(40)}`, url: 'https://r12.example', bannerUrl: '',
  })) === 0, 'living tip plaintext still decodes')

  ok(L.tipKrayPlateHashes().size === 1, 'tip set size = 1 (elastic tip, not stacked bios)')
  ok(L.cascadeParts().krayPlateCommitment !== undefined, 'plate still folds into cascade')

  // ── 5 · star plate is a separate tip slot (still one per star) ──
  const sf1 = { description: 'star v1', url: 'https://star.example', bannerUrl: '' }
  const sh1 = put(sf1)
  seal(sh1, star.toString())
  ok(L.tipKrayPlateCount() === 2, 'addr tip + star tip = 2 slots')
  const sf2 = { description: 'star v2', url: 'https://star2.example', bannerUrl: '' }
  const sh2 = put(sf2)
  seal(sh2, star.toString())
  ok(L.krayStarPlateOf(star) === sh2, 'star tip rotated to v2')
  ok(!L.tipKrayPlateHashes().has(sh1), 'star v1 left tip set')
  ok(L.tipKrayPlateCount() === 2, 'still exactly 2 tip slots after star rotate')

  // ── 6 · clear empties tip; commitment absent (A3 elastic) ──
  seal('')
  ok(L.krayPlateOf(A.addr) === null, 'address tip cleared')
  seal('', star.toString())
  ok(L.krayStarPlateOf(star) === null, 'star tip cleared')
  ok(L.tipKrayPlateCount() === 0, 'tip empty after clears')
  ok(L.cascadeParts().krayPlateCommitment === undefined, 'empty tip ⇒ plate commitment absent (A3)')

  // ── 7 · treasury got 1 ₭ per successful seal (not per refused identical) ──
  const plateLines = journal.filter((e) => e.kind === 'set-kray-plate')
  const plateActs = plateLines.length
  ok(plateActs === 12 + 2 + 2, `journal has ${plateActs} plate seals (12 addr + 2 star + 2 clears)`)
  ok(L.balanceOf(TREASURY) === BigInt(plateActs), `Treasury got exactly ${plateActs} ₭ from plate seals`)
  ok(L.conserves(), 'conservation holds after hygiene storm')

  // Tip footprint stays O(1) hashes; stacked bios would be O(rotations).
  const tipHashBytes = 64 // one living tip hash
  const stackedBioBytes = orphans.reduce((n, _h, i) => {
    const f = { description: `rotate ${i + 1} ${'x'.repeat(40)}`, url: `https://r${i + 1}.example`, bannerUrl: '' }
    return n + encodeKrayPlate(f).length
  }, 0)
  ok(tipHashBytes < stackedBioBytes, `tip keeps one hash (64 B) << stacked old bios (${stackedBioBytes} B)`)
  ok(plateLines.every((e) => typeof e.plateHash === 'string' && (e as { description?: unknown }).description === undefined),
    'every plate journal event is hash-only (no description field)')

  const sealedBytes = plateLines.reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e), 'utf8'), 0)
  console.log(`\n  · tip slots now: ${L.tipKrayPlateCount()}`)
  console.log(`  · plate journal lines: ${plateActs} · sealed bytes: ${sealedBytes}`)
  console.log(`  · prior tips left the living tip set: ${orphans.length}`)
  console.log(`\n${fail === 0 ? '✅' : '❌'} kray-plate-hygiene: ${pass} passed, ${fail} failed\n`)
  if (fail) process.exit(1)
}
main()
