# KRAY-CORE

**A Bitcoin-anchored, self-verifying L2 — the elite Bitcoin-standard base protocol.**

> *From fire, with proof.* KRAY is not a farm and not a premine. Every unit is backed by a real
> satoshi, every act is signed, and the whole network's truth is sealed into Bitcoin.

KRAY-CORE is the base protocol on which KRAY.NETWORK (and tenant rune projects like KRILL) run.
It follows one law and derives everything from it: **signature ‖ Merkle proof ‖ Bitcoin anchor**,
enforced both at the door and again on replay. Built on the proven KRILL engine's discipline
(hash-chained ledgers, conservation-or-HALT, fsync durability), and anchored to Bitcoin so any node
can verify the truth from first principles.

## The idea in one line

**KRAY (₭) is fungible fuel** — there is no fixed supply, no emission curve, no halving, no premine.
Supply is conserved as `circulating = emitted − burned`. ₭ is minted **only by proof-of-donation**:
sacrifice real satoshis to the anchoring pot and mint **1 ₭ per satoshi**, capped at the pot's
deficit (self-regulating and atemporal — no clock, no schedule). A **star is born from fire**: burn
1 ₭ to inscribe and a star is born, **numbered by creation order** (the earliest are the rarest); its
Codex is derived from that number. Stars are the non-fungible canvases — the direction for
inscriptions. Every act is BIP-340 signed by the owner's wallet, proven by a Merkle path, and the
whole network commits **one cascade root** to Bitcoin via OP_RETURN.

## Architecture

```
src/
├── protocol/            the base chain
│   ├── kray-primitives.ts  shared model-agnostic core (events, reserved accounts, canonical, hashing)
│   ├── star-lore.ts        star naming + the Codex (traits by creation number)
│   ├── ledger.ts           the fungible ledger — applyLive is atomic (validate-before-mutate),
│   │                       conserves(emitted−burned), owns the star registry, rune book, pot, contracts
│   ├── starmap.ts          the star registry (stars born by creation order; rarity by number)
│   ├── pot.ts              the anchoring pot (proof-of-donation mint; drains on each anchor)
│   ├── store.ts            event-sourced, hash-chained, fsync'd journal + deterministic replay
│   ├── node.ts             the orchestrator (ingest → seal → conserve → cascade root)
│   ├── block.ts            block chain + merkle root + inclusion proofs
│   ├── scheme.ts           BIP-340 Schnorr identity (address re-derived, never read from bech32m)
│   ├── contract.ts         sandboxed DeFi contracts (conservation + rune solvency untouchable)
│   ├── vault.ts / vault-spend.ts   rune script vaults (deposit locks, exit unlocks, provably)
│   └── consensus.ts        seal-depth-by-WORK fork choice + confirmation rules
├── economics/           the math
│   ├── rune-book.ts        per-rune reserves — reserve == Σ credits + Σ locked, or HALT
│   ├── anchor-payment.ts   a fee/anchor spend PROVEN from Bitcoin, never merely attested
│   └── (reward / custody / beat-pow / glow / honocracy / governance — the validator-reward
│        layer; see "Deferred" below)
├── anchor/
│   ├── anchor.ts           commit the cascade root to Bitcoin (OP_RETURN, 49-byte payload)
│   └── spv.ts              SPV proofs — a deposit/settle is a Bitcoin-proven mirror
├── index.ts             public API — import from here, never from deep paths
└── test/                hermetic proofs + the storm suite + the live anchor test
```

## Non-negotiables

- **BigInt only** — no float ever touches a ₭.
- **Conservation-or-HALT** — `circulating == emitted − burned` at every moment, every ₭ minted is
  backed by a real donated satoshi, and no premine can ever satisfy the pot's books — or the node stops.
- **THE SUPREME LAW** — signature ‖ Merkle proof ‖ Bitcoin anchor is the ONLY path a state change may
  take, enforced at the door AND re-verified on replay. Nothing settles outside it.
- **Self-contained** — kray-core carries its own audited crypto (@noble/curves, @scure/btc-signer);
  it reuses KRILL's *discipline*, never modifying the KRILL app.
- **Two public universes** — Signet (live lab) and Bitcoin mainnet (fresh genesis,
  not ignited) share this library and never share a journal, pot, or RPC.
  Isolation is `npm run test:boot` at the repo root.

## Run the tests

```bash
npm run test:core     # the storm suite — starmap · pot · ledger · store · node · rune ·
                      # contract · anchor · grand-exam · server integration
npm test              # the full chain (the above + the module unit proofs)
```

Individual sims: `test:pot`, `test:ledger`, `test:grand-exam`, `test:server`, …

## Status

This is the one engine: fungible ₭, stars born from fire, proof-of-donation,
self-anchor, presence/custody settle on every confirmed seal. The explorer
(`apps/kray-net`) and the public Signet writer run it. Bitcoin mainnet uses
the same library on a new journal — see [`../../networks/mainnet/`](../../networks/mainnet/).

Glow / honocracy / governance / raffle remain shelf economics
(`economics/{glow,honocracy,governance,raffle}`). Presence, custody, beat-pow
and the fee pool are live. Plan of record: [`../../docs/MAINNET-READINESS.md`](../../docs/MAINNET-READINESS.md).
