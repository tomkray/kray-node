/**
 * CUSTODY-BROWSER — the tab's claim MUST equal the node's claim.
 *   node src/test/custody-browser.test.ts
 *
 * A browser that "almost" matches custody.ts would earn 0 (writer refuse) or,
 * worse, a lie that looks like a hit. This locks the domain strings, the
 * 6-byte BE pick, the salted answer, and the 33-byte hex row.
 */
import { createRequire } from 'node:module'
import { createHash, randomBytes, webcrypto } from 'node:crypto'
import {
  buildCustodyClaim, custodyToHex, custodyChallenges, custodyAnswer,
  aggregateAnswers, packHits,
} from '../economics/custody.ts'

if (!globalThis.crypto) globalThis.crypto = webcrypto as unknown as Crypto

const require = createRequire(import.meta.url)
require('../../../kray-net/custody-browser.js')
// Official package is ESM: the IIFE attaches the API on globalThis (script-tag twin).
const KrayCustody = (globalThis as { KrayCustody: {
  K: number
  sha256Hex: (b: Uint8Array) => Promise<string>
  challenges: (beacon: string, address: string, atlasSize: number, k?: number) => Promise<number[]>
  answer: (bytes: Uint8Array, beacon: string, address: string) => Promise<string>
  packHits: (hits: boolean[]) => string
  aggregateAnswers: (answers: string[]) => Promise<string>
  toHex: (c: { hits: string; aggregate: string }) => string
  buildClaim: (beacon: string, address: string, oracle: { contents: string[]; bytesOf: (h: string) => Uint8Array | null }) => Promise<{ hits: string; aggregate: string }>
} }).KrayCustody

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`)
  process.exit(1)
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const BEACON = sha(Buffer.from('a real bitcoin block hash')).slice(0, 64)
const A = 'bcrt1p' + 'a'.repeat(58)

function atlas(n: number) {
  const bytes = new Map<string, Uint8Array>()
  const contents: string[] = []
  for (let i = 0; i < n; i++) {
    const b = Buffer.concat([Buffer.from(`content ${i} — `), randomBytes(16)])
    const h = sha(b)
    contents.push(h)
    bytes.set(h, new Uint8Array(b))
  }
  return {
    contents,
    bytes,
    bytesOf: (h: string) => bytes.get(h) ?? null,
  }
}

async function main() {
  const full = atlas(12)
  const none = { contents: full.contents, bytesOf: () => null }

  const idxNode = custodyChallenges(BEACON, A, full.contents.length)
  const idxTab = await KrayCustody.challenges(BEACON, A, full.contents.length)
  ok(JSON.stringify(idxNode) === JSON.stringify(idxTab), 'challenges: tab == custody.ts (6-byte BE modulo)')

  const sample = full.bytes.get(full.contents[0])!
  const ansNode = custodyAnswer(sample, BEACON, A)
  const ansTab = await KrayCustody.answer(sample, BEACON, A)
  ok(ansNode === ansTab, 'answer: tab == custody.ts (bytes ‖ |beacon|address)')

  const hits = [true, false, true, true, false, false, true, false]
  ok(KrayCustody.packHits(hits) === packHits(hits), 'packHits: LSB-first bitmap matches')

  const answers = [ansNode, sha(Buffer.from('second'))]
  ok(await KrayCustody.aggregateAnswers(answers) === aggregateAnswers(answers), 'aggregate: domain string matches')

  const claimFull = buildCustodyClaim(BEACON, A, full)
  const tabFull = await KrayCustody.buildClaim(BEACON, A, full)
  ok(custodyToHex(claimFull) === KrayCustody.toHex(tabFull), 'full-atlas claim hex is identical (33-byte row)')

  const claimNone = buildCustodyClaim(BEACON, A, none)
  const tabNone = await KrayCustody.buildClaim(BEACON, A, none)
  ok(custodyToHex(claimNone) === KrayCustody.toHex(tabNone), 'zero-hit claim hex is identical')

  console.log(`  ✓ custody-browser ↔ custody.ts (${pass} checks)`)
}

await main()
