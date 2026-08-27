/**
 * Two pens, two holes — never dual-sign, never steal Signet :4479.
 *   node apps/kray-net/pot-signer-holes.test.mjs
 */
import {
  potSignerHoles,
  potSignerConfigured,
  assertPotSignerLoopback,
  choosePotSignerHole,
  MAINNET_PEN_PRIMARY,
  MAINNET_PEN_FALLBACK,
  SIGNET_PEN,
} from './pot-signer-holes.mjs'

let pass = 0
const ok = (c, m) => {
  if (c) { pass++; console.log('  ✓ ' + m) }
  else { console.error('  ✗ ' + m); process.exit(1) }
}

ok(MAINNET_PEN_PRIMARY === 4579 && MAINNET_PEN_FALLBACK === 4580 && SIGNET_PEN === 4479, 'holes are distinct (primary / fallback / Signet)')
ok(MAINNET_PEN_PRIMARY !== MAINNET_PEN_FALLBACK, 'fallback is another hole, not a second bind on the primary')
ok(MAINNET_PEN_PRIMARY !== SIGNET_PEN && MAINNET_PEN_FALLBACK !== SIGNET_PEN, 'neither mainnet hole is the live Signet pen')

const both = potSignerHoles({
  KRAY_POT_SIGNER_URL: 'http://127.0.0.1:4579',
  KRAY_POT_SIGNER_URL_FALLBACK: 'http://127.0.0.1:4580/',
})
ok(both.primary === 'http://127.0.0.1:4579' && both.fallback === 'http://127.0.0.1:4580', 'primary + fallback parse (slash stripped)')
ok(potSignerConfigured({
  KRAY_POT_SIGNER_URL: 'http://127.0.0.1:4579',
  KRAY_POT_SIGNER_URL_FALLBACK: 'http://127.0.0.1:4580',
}) && potSignerConfigured({ KRAY_POT_SIGNER_URL_FALLBACK: 'http://127.0.0.1:4580' }),
  'configured if either hole is set')
ok(!potSignerConfigured({}), 'unset holes are not a pen')

ok(choosePotSignerHole({ primaryAlive: true, fallbackAlive: true }) === 'primary', 'both alive → ONLY the primary (fallback stays idle)')
ok(choosePotSignerHole({ primaryAlive: false, fallbackAlive: true }) === 'fallback', 'primary dark → the other hole')
ok(choosePotSignerHole({ primaryAlive: true, fallbackAlive: false }) === 'primary', 'fallback dark → the primary still signs')
ok(choosePotSignerHole({ primaryAlive: false, fallbackAlive: false }) === null, 'both dark → fail-closed, no local secret')

ok(assertPotSignerLoopback('http://127.0.0.1:4580').ok, 'fallback hole is loopback')
ok(!assertPotSignerLoopback('http://10.0.0.9:4580').ok, 'public bind refused on either hole')
ok(!assertPotSignerLoopback('not-a-url').ok, 'garbage URL fail-closed')

console.log('\n  ' + pass + ' pot-signer hole pins\n')
