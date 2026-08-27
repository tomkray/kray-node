/**
 * KRAY-CORE — public API.
 *
 * KRAYNET: fungible ₭ (emitted − burned, minted by proof-of-donation, burned to
 * create a star), born-from-fire stars numbered by creation order, the anchoring
 * pot, signed user actions (the Supreme Law), and every state root merkle-anchored
 * to Bitcoin. Import from here, never from deep paths.
 */

// protocol — the shared primitives + the KRAYNET engine
export * from './protocol/kray-primitives.ts'
export * from './protocol/star-lore.ts'
export * from './protocol/ledger.ts'
export * from './protocol/starmap.ts'
export * from './protocol/store.ts'
export * from './protocol/node.ts'
export * from './protocol/pot.ts'
export * from './protocol/block.ts'
export * from './protocol/scheme.ts'
export * from './protocol/attest.ts'
export * from './protocol/receipt.ts'
export * from './protocol/consensus.ts'
export * from './protocol/finality.ts'
export * from './protocol/contract.ts'
export * from './protocol/vault.ts'
export * from './protocol/vault-spend.ts'
export * from './protocol/runestone.ts'
export * from './protocol/rune-ancestry.ts'

// economics — reward split + governance
export * from './economics/reward.ts'
export * from './economics/custody.ts'
export * from './economics/beat-pow.ts'
export * from './economics/anchor-payment.ts'
export * from './economics/rune-book.ts'
export * from './economics/glow.ts'
export * from './economics/honocracy.ts'
export * from './economics/governance.ts'

// anchor — Bitcoin L1 commitment + the offline SPV proof of every seal
export * from './anchor/anchor.ts'
export * from './anchor/anchor-log.ts'
export * from './anchor/spv.ts'
