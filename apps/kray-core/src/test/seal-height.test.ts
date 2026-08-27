/**
 * THE SEAL CARRIES ITS BITCOIN HEIGHT (ADR-3 3d-a · the born-activated unblocker) — node.sealConfirmed threads
 * the burial height into the seal event, so an ACTIVATED chain's first seal is accepted (the mint window reopens).
 *
 *   node src/test/seal-height.test.ts
 *
 * Without this the reducer refuses the first post-activation seal (l1Height is required at/after activation) and
 * the chain dies on arrival. The FOLD of that height is proven by window-commitment/nonce-fold/omission-swarm;
 * this pins the WIRING: the height reaches the event, and its ABSENCE keeps the pre-activation seal byte-identical.
 */
import { rmSync, mkdirSync } from 'node:fs'
import { KrayNode } from '../protocol/node.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const dir = '/private/tmp/claude-501/seal-height-exam'

function main() {
  console.log('\n╔═ THE SEAL CARRIES ITS BITCOIN HEIGHT — node.sealConfirmed wiring (ADR-3 3d-a) ═╗\n')
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const node = new KrayNode(dir, 'regtest')

  const withH = node.sealConfirmed('a'.repeat(64), 0, 850_000) as KrayEvent & { l1Height?: number }
  ok(withH.kind === 'seal' && withH.l1Height === 850_000, 'sealConfirmed(txid, at, height) threads l1Height into the seal event — the reducer can bind 3d-a to it')

  const noH = node.sealConfirmed('b'.repeat(64), 0) as KrayEvent & { l1Height?: number }
  ok(noH.kind === 'seal' && noH.l1Height === undefined, 'sealConfirmed with NO height omits l1Height — a pre-activation seal hashes byte-identically (A3)')

  const badH = node.sealConfirmed('c'.repeat(64), 0, 1.5) as KrayEvent & { l1Height?: number }
  ok(badH.l1Height === undefined, 'a non-integer height is DROPPED, never journaled as a bad value (fail-safe)')

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the burial height reaches the seal event; the mint window can reopen under activation, and stays byte-identical without it. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
