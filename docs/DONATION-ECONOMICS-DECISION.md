# ADR — The Donation Economics, final (BURN: nobody's key)

> Decided by the Creator, 2026-08-09. This closes the question "who pays anchoring, who holds the donated sats".
> Every claim here is proven by a named test. Supreme law unchanged: `signature ‖ SPV proof ‖ Bitcoin anchor`.

## The decision

**A donation is a BURN that anchors.** One keyless Bitcoin transaction, signed by the donor's own wallet:

```
INPUTS    the donor's own UTXOs
OUTPUT 0  the donation → the NUMS key TWEAKED by the current anchor payload (pay-to-contract):
            · the sats are DESTROYED forever — the key exists for nobody (provably)
            · the same output SEALS (blockNumber, cascadeRoot) — the donation IS the anchor, free
OUTPUT 1  OP_RETURN committing the donor's KRAY address (whom to mint to) — unchanged from v1
OUTPUT 2  change back to the donor
FEE       the Bitcoin miner — the only party paid, for confirmation (keyless by nature)
```

The node SPV-proves the confirmed tx, checks output 0 pays exactly the tweaked script for the claimed
`(blockNumber, root)`, and mints **1 ₭ per burned sat** to the committed donor. Credited once per outpoint.

## Why burn — the three rejections

1. **Pooled pot (v1) — rejected.** Accumulating sats to pay anchors later requires a spend key; whoever holds it
   is a custodian and a single point. Bitcoin has no keyless dynamic payer. (This was the honest gap in v1.)
2. **Fee-to-miner as the sacrifice — rejected.** The miner receives *spendable* sats. Spendable sats can re-enter
   and re-mint; soundness would rest on an economic assumption ("miners won't recycle"), and over unbounded time
   economic assumptions break. Only destruction is eternal. (Miners still earn the tx fee — enough.)
3. **Validator raffle of the surplus — rejected (Creator + review).** Proven sybil-neutral and keyless
   (`raffle.test.ts`, 8/8) but it hands *spendable* sats to an insider: donor→validator→re-donate→re-mint = the
   same sats minting ₭ forever. A raffle that mints is infinite inflation; a raffle that doesn't is possible but
   was declined for simplicity and purity. Design preserved in `docs/RAFFLE-DESIGN.md` + `economics/raffle.ts`.

**The invariant that decided it:** any sats that remain spendable by anyone can re-mint. Therefore
`emitted ≤ sats provably DESTROYED`. Burning is the only backing that is mathematics rather than assumption.

## What each party gets

| Party | Gives | Gets |
| --- | --- | --- |
| Donor | real sats, burned + tx fee | 1 ₭ per burned sat, SPV-proven; their donation anchors the network |
| Bitcoin miner | block space | the tx fee (and a scarcer Bitcoin, via the burn) |
| Guardians | work (beat PoW + custody) | the eternal 1-₭ fees, split linearly by proven work (sybil-neutral) |
| Nobody | — | the burned sats: the key exists for no one (NUMS, BIP-341) |

## Proofs (all green, `apps/kray-core`)

- `self-anchor.test.ts` (13) — the tweak is byte-identical to @scure BIP-341; commit→verify; tamper rejected.
- `self-anchor-burn.test.ts` (8) — NUMS key = nobody's; still seals the root; custodied-vs-burn contrast.
- `self-anchor-donation.test.ts` (11) — full PSBT: build → seal → audit → mint path → (for custodied keys) sweep.
- `first-donation.sim.ts` (5) — the plain-language walkthrough on the real ledger (Ana's 5,000 sats).
- `raffle.test.ts` (8) — the rejected branch, proven before rejection (Echo de Bifurcação discipline).
- `donation-proof.test.ts` (18) — the SPV mint gate; `donate-proof-gate.test.ts` (5) — forgeable-proof refusal.

## Rollout state

- Server: gated behind `KRAY_SELF_ANCHOR=1` + `KRAY_POT_INTERNAL_KEY` (the NUMS constant for burn mode).
  OFF ⇒ byte-identical v1 behavior. `/api/kraynet/donation/info` exposes `{selfAnchor}` when armed.
- Extension: threads `selfAnchor` from prepare → confirm → mint; shows the honest 🔥 burn review.
- Next: signet live broadcast (`inference` → `verified` in the compatibility matrix), then integrate the
  self-anchor into the anchor log as a proven anchor, then retire the operator-funded OP_RETURN anchor.

## Rune L2 bridge — audited under the same lens (no hidden owners)

- **Vault key path is provably unspendable (NUMS internal key)** — no single owner exists (`vault.ts:171-210`).
- Deposit: SPV-proven runestone into the vault; credited once per outpoint; `reserve == credits + locks`
  (`rune-bridge` 8, `rune-book` 27, `rune-ancestry` 14, `runestone` 49 — all from bytes).
- Exit: cooperative path needs EXACTLY t-of-n sealed guardians (NUMEQUAL); the depositor ALWAYS has the
  unilateral CSV timelock path — funds can never be stranded by absent guardians (`vault` 40, `vault-spend` 54).
- Honest border: t-of-n is a threshold federation for cooperative exits — decentralized, not keyless; the
  keyless guarantee is the depositor's unilateral path. This matches the decided model (burn for ₭; script-law
  for runes).
