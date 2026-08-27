/**
 * Hermetic proof of Glow — the soulbound proof-of-work reputation.
 *   node src/test/glow.test.ts
 *
 * Proves: Glow is earned only by work (no transfer exists — soulbound), decays
 * deterministically to zero over MAX_IDLE idle intervals, working refreshes it,
 * out-of-order work is refused, the journal is hash-chained + reboot-exact, and
 * it feeds the Honocracy governance VOICE (not the reward) so active validators
 * out-voice idle ones.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Glow, decayedGlow, MAX_IDLE_INTERVALS } from '../economics/glow.ts'
import { voice } from '../economics/honocracy.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
function rejects(fn: () => void, label: string): void {
  try { fn(); console.error(`  ✗ FAILED (expected rejection) — ${label}`); process.exit(1) } catch { pass++ }
}

function main() {
  // 1 · DECAY is a clean deterministic linear ramp to zero
  ok(MAX_IDLE_INTERVALS === 210, 'MAX_IDLE is 210 intervals')
  ok(decayedGlow(1000n, 0) === 1000n, 'idle 0 → full Glow')
  ok(decayedGlow(1000n, 42) === 800n, 'idle 42/210 → 80% (800)')
  ok(decayedGlow(1000n, 105) === 500n, 'idle 105/210 → half (500)')
  ok(decayedGlow(1000n, 210) === 0n, 'idle == MAX_IDLE → 0')
  ok(decayedGlow(1000n, 999) === 0n, 'idle beyond MAX_IDLE → 0 (never negative)')

  const dir = mkdtempSync(join(tmpdir(), 'kray-glow-'))
  let glow = new Glow(dir, 'regtest')

  // 2 · EARN → glowOf reflects it, and decays as the validator idles
  glow.earn('alice', 0, 1000n)
  ok(glow.glowOf('alice', 0) === 1000n, 'earned Glow shows immediately')
  ok(glow.glowOf('alice', 105) === 500n, 'Glow halves after 105 idle intervals')
  ok(glow.glowOf('alice', 210) === 0n, 'Glow fully decays after MAX_IDLE idle')
  ok(glow.glowOf('nobody', 50) === 0n, 'an unknown address has 0 Glow')

  // 3 · SOULBOUND — there is no way to move Glow; only `earn` mutates it
  ok(typeof (glow as unknown as { transfer?: unknown }).transfer === 'undefined', 'Glow has NO transfer method (soulbound)')
  ok(typeof (glow as unknown as { bridge?: unknown }).bridge === 'undefined', 'Glow has NO bridge method (soulbound)')

  // 4 · WORKING REFRESHES — earning again decays-then-adds, resetting the clock
  glow.earn('bob', 0, 1000n)
  glow.earn('bob', 50, 10n) // decay(1000, 50)=761, +10 = 771, clock now at 50
  ok(glow.glowOf('bob', 50) === 771n, 'working decays-then-adds and refreshes the decay clock')
  ok(glow.glowOf('bob', 50 + 105) === 385n, 'after refresh, decay counts from the new work interval')

  // 5 · OUT-OF-ORDER work is refused (intervals only move forward)
  glow.earn('carol', 10, 5n)
  rejects(() => glow.earn('carol', 5, 5n), 'work at an earlier interval is refused')

  // 6 · active() = the live reward/governance set at an interval, sorted, no zeros
  glow.earn('dave', 100, 900n)
  const activeAt100 = glow.active(100)
  ok(activeAt100.every((x) => x.glow > 0n), 'active() never lists a zero-Glow validator')
  ok(activeAt100[0].glow >= activeAt100[activeAt100.length - 1].glow, 'active() is sorted by Glow, desc')
  ok(!glow.active(1000).some((x) => x.validator === 'alice'), 'a long-idle validator drops out of the active set')

  const rootBefore = glow.merkleRoot()
  ok(rootBefore === glow.merkleRoot(), 'merkleRoot is stable across calls')
  const daveBefore = glow.glowOf('dave', 100)
  const seqBefore = glow.journalLength

  // 7 · REBOOT — rebuilt exactly from the fsync'd, hash-chained journal
  glow = new Glow(dir, 'regtest')
  ok(glow.glowOf('dave', 100) === daveBefore, 'Glow exact after reboot')
  ok(glow.journalLength === seqBefore, 'journal length identical after reboot')
  ok(glow.merkleRoot() === rootBefore, 'merkle root identical after reboot')

  // 8 · INTEGRATION — Glow feeds GOVERNANCE, not the reward: the recently-active
  //     validator has more Honocracy voice than the long-idle one. (The reward is
  //     Bitcoin-standard — sized by work each interval — so Glow stays out of it.)
  glow.earn('eve', 200, 400n)
  glow.earn('frank', 10, 400n)
  const eveVoice = voice(glow.glowOf('eve', 200), 0n)     // eve: full Glow at 200
  const frankVoice = voice(glow.glowOf('frank', 200), 0n) // frank: heavily decayed since interval 10
  ok(eveVoice > frankVoice, `the recently-active validator has more governance voice than the idle one (${Number(eveVoice)} > ${Number(frankVoice)})`)

  console.log(`\n✓ ${pass} checks passed — Glow holds: soulbound (earn-only, no transfer), deterministic decay, working refreshes, chain-verified, reboot-exact, feeds the Honocracy governance voice.`)
  process.exit(0)
}
main()
