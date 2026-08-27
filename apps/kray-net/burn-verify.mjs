// THE BURN PROOF — verify with your own eyes that a KRAYNET burn address belongs to NOBODY.
//
// You trust nothing here: not KRAYNET, not this node, not the person who sent you the address. This script
// rebuilds the address from Bitcoin's own generator point upward — every input is public, every step is a hash
// or a curve addition, and not one number in the chain was chosen by a human. If the final line matches the
// address you were given, then spending it would require the discrete log of a SHA-256 output, which no one
// on Earth has. The sats sent there are destroyed. Forever. For everyone.
//
//   node apps/kray-net/burn-verify.mjs <blockNumber> <cascadeRoot> [network]
//   node apps/kray-net/burn-verify.mjs 0 9d3b2de322cad91a420243c87fa3b6fce0d6bd90f1b2a1fce216b47e750030ac signet
//
// (blockNumber + cascadeRoot are what the donation sealed — the node publishes them at /api/kraynet/donation/info,
//  and any block explorer shows which address the donation actually paid. Compare. That is the whole audit.)
import { KrayAnchor } from '../kray-core/src/anchor/anchor.ts'
import { BURN_INTERNAL_KEY, anchorCommitment, tweakKey, addressFromOutputKey, numsAuthorlessProof } from '../kray-core/src/protocol/self-anchor.ts'

const [blockArg, rootArg, netArg] = process.argv.slice(2)
if (!blockArg || !/^[0-9a-f]{64}$/i.test(rootArg || '')) {
  console.log('usage: node apps/kray-net/burn-verify.mjs <blockNumber> <cascadeRoot-64hex> [main|signet|regtest]')
  process.exit(1)
}
const blockNumber = Number(blockArg)
const root = rootArg.toLowerCase()
const net = netArg || 'signet'

console.log('\n─── THE BURN PROOF — no number below was chosen by anyone ───\n')

// STEP 1 · Bitcoin's generator point G — the public constant the entire Bitcoin system is built on.
const nums = numsAuthorlessProof()
console.log('STEP 1 · Bitcoin’s own generator point G (public, fixed since 2009):')
console.log('         G.x = ' + nums.gxHex)

// STEP 2 · hash it. That hash IS the burn key. Nobody picked it — it falls out of SHA-256.
console.log('\nSTEP 2 · SHA256(uncompressed G) — a hash anyone can recompute:')
console.log('         ' + nums.sha256OfG)
console.log('         equals the BIP-341 NUMS key used by all of taproot:  ' + (nums.matches ? '✓ YES' : '✗ NO — ABORT'))
if (!nums.matches) process.exit(1)
console.log('         → to spend from this key you would need its private key: k with k·G = lift_x(that hash).')
console.log('           That is the discrete log of a hash output. No one has it. No one ever will.')

// STEP 3 · the public anchor bytes this donation seals — network tag, version, block, root. Nothing hidden.
const payload = KrayAnchor.payload(blockNumber, root)
console.log('\nSTEP 3 · the PUBLIC bytes this donation seals (tag "KRAY.NETWORK" | v1 | block | root):')
console.log('         ' + payload)

// STEP 4 · commit + standard BIP-341 tweak — the same math every taproot wallet on Earth runs.
const c = anchorCommitment(payload)
const Q = tweakKey(BURN_INTERNAL_KEY, c)
console.log('\nSTEP 4 · commit = tag-hash(payload); output key = NUMS + tweak·G (standard BIP-341):')
console.log('         commit     = ' + c)
console.log('         output key = ' + Q.outputKeyHex)

// STEP 5 · encode. This is the address. If it matches the one on-chain, the proof is complete.
const addr = addressFromOutputKey(Q.outputKeyHex, net)
console.log('\nSTEP 5 · the address (plain bech32m of that key, on ' + net + '):')
console.log('\n         ' + addr + '\n')
console.log('COMPARE it with the address the donation actually paid (any block explorer).')
console.log('If they match: those sats sit behind SHA256(G) — a key that exists for NOBODY —')
console.log('and the same output seals KRAY block #' + blockNumber + ' root ' + root.slice(0, 16) + '… onto Bitcoin.')
console.log('\nDestroyed forever. Anchored forever. Owned by no one. Verified by you.\n')
