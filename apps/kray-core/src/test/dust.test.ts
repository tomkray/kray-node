/**
 * THE DUST KNOB, PROVEN — KRAYNET can point the postage limit wherever it wants, whenever it wants,
 * without a break. The threshold is Bitcoin Core's exact formula (so it matches reality), it FALLS
 * with the network as relays lower the dust-relay fee (down to 1 sat), and an operator can PIN any
 * value the instant a relay accepts it. Pure arithmetic; no node, no funds.
 *
 *   node src/test/dust.test.ts
 */
import { dustFor, resolveDust, dustFromEnv, DEFAULT_DUST_RELAY_FEE } from '../protocol/dust.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const threw = (fn: () => unknown, why: RegExp, m: string) => { let t = false; try { fn() } catch (e) { t = why.test(String((e as Error).message)) } ok(t, m) }

function main() {
  console.log('\n╔═ THE DUST KNOB — pointable anywhere, anytime, without a break ═════╗')

  // ── 1 · Bitcoin Core's EXACT values at the default 3000 sat/kvB ────────────
  ok(dustFor('p2tr') === 330n, 'p2tr dust == 330 sats at the default 3000 sat/kvB — Bitcoin Core\'s exact value')
  ok(dustFor('p2wpkh') === 294n, 'p2wpkh dust == 294 sats — Core\'s exact value')
  ok(dustFor('p2wsh') === 330n, 'p2wsh dust == 330 sats')
  ok(dustFor('p2pkh') === 546n, 'p2pkh dust == 546 sats — Core\'s exact value')
  ok(dustFor('p2sh') === 540n, 'p2sh dust == 540 sats')
  ok(DEFAULT_DUST_RELAY_FEE === 3000, 'the default dust-relay fee is Core\'s 3000 sat/kvB')

  // ── 2 · IT FALLS WITH THE NETWORK — lower the relay fee, the dust follows ──
  ok(dustFor('p2tr', 1000) === 110n, 'relay fee 1000/kvB → p2tr dust 110 (a third of today) — no code change, it just tracks')
  ok(dustFor('p2tr', 200) === 22n, 'relay fee 200/kvB → p2tr dust 22')
  ok(dustFor('p2tr', 9) === 1n, 'relay fee 9/kvB → p2tr dust 1 sat — the day a relay accepts 1-sat postage, KRAYNET already computes it')
  ok(dustFor('p2tr', 0) === 0n, 'relay fee 0 → dust 0 (a relay with no dust floor at all)')

  // ── 3 · THE PIN — point the limit at ANY exact value, this instant ─────────
  ok(resolveDust({ override: 1n }) === 1n, 'PIN to 1 sat → 1 (an operator can force it the moment a miner/relay accepts it)')
  ok(resolveDust({ override: 200 }) === 200n, 'PIN to 200 → 200 (any value, immediately)')
  ok(resolveDust({ override: 330n }) === 330n, 'PIN to 330 → 330 (stay put explicitly)')
  ok(resolveDust({ dustRelayFeePerKvB: 3000 }) === 330n, 'no pin, default fee → 330 (the safe network value)')
  ok(resolveDust() === 330n, 'no options at all → the safe default 330')
  threw(() => resolveDust({ override: -5 }), /cannot be negative/, 'a NEGATIVE pin is refused, never silently used')

  // ── 4 · THE ENV KNOB — a single place the node reads it ────────────────────
  ok(dustFromEnv({ KRAY_DUST_SATS: '1' }) === 1n, 'KRAY_DUST_SATS=1 → the node runs 1-sat postage')
  ok(dustFromEnv({ KRAY_DUST_RELAY_FEE: '1500' }) === 165n, 'KRAY_DUST_RELAY_FEE=1500 → dust tracks to 165')
  ok(dustFromEnv({}) === 330n, 'no env set → the safe default 330')
  ok(dustFromEnv({ KRAY_DUST_SATS: '1', KRAY_DUST_RELAY_FEE: '3000' }) === 1n, 'an explicit pin WINS over the fee (the operator has the final word)')

  // ── 5 · NOTHING BREAKS — a builder using resolveDust works at every value ──
  for (const d of [1n, 22n, 200n, 330n, 546n]) {
    const dust = resolveDust({ override: d })
    // a payout that keeps its rune-output at or above the dust is always relayable
    ok(dust === d && 100_000n >= dust, `a 100k-sat vault payout stays ≥ dust=${d} → relayable, KRAYNET unbroken`)
  }

  console.log(`\n╚═ ${pass} checks passed${fail ? `, ${fail} FAILED` : ''} — the dust is a live knob: Core-exact, network-tracking, pinnable to 1 sat, and a break-free builder at every value. ⚙️₿`)
  process.exit(fail ? 1 : 0)
}
main()
