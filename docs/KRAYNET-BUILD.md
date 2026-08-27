# KRAYNET — the build plan (phased, testable, non-breaking)

> **Status: EXECUTED — HISTORICAL (build plan of 2026-08-02).** Every phase of this plan has been built,
> proven and consolidated — the v2 model is the running network, and the v1 it protected mid-flight is
> deleted. Kept as the founding execution record beside `KRAYNET-MODEL.md`; read `KRAYNET-RUN.md` for
> how to run what it produced.

The execution map to turn `docs/KRAYNET-MODEL.md` into running code, **in minute detail,
without breaking what works.** Read `KRAYNET-MODEL.md` first (the what/why); this is the
how/order.

## The prime directive

**v1 keeps running untouched while v2 is born.** The current node (2.1Q model) is what
the KrayWallet KRAYNET panel talks to today — it must not break mid-flight. So:

- **Branch `kraynet-v2`** off the committed state. All v2 work lives there. `main`/the
  current branch keep the working v1.
- **Reset the v2 node clean** at each phase (dev phase, reset-friendly) — the journal is
  born under the new laws, no migration of old 2.1Q history needed.
- **Every phase ends GREEN**: its own tests pass, the sims pass, a cold reboot is
  byte-exact, before the next phase starts. A phase is not done until it is proven.
- **Nothing is deleted until its replacement is proven.** Old code is removed in the same
  phase that proves the new path, never before.

## Phase 0 — safety (before any core change)

1. **Commit the current session's work** (security fixes, the KRAYNET wallet, all docs) on
   `travel-portability-fixes` so nothing is lost.
2. **Create branch `kraynet-v2`**. A build flag `KRAY_MODEL=v2` (default v1) lets the two
   models coexist during the transition; v2 code is gated until proven.

## Phase 1 — the dual starmap (the foundation)

**Goal:** KRAY becomes a fungible balance; stars become a non-fungible, creation-numbered
registry. Delete the 2.1Q range/FIFO machinery.

| file | change |
| --- | --- |
| `protocol/starmap.ts` | replace the `hold` FIFO ranges + `debitPreferring` tiers with **(a)** a plain `Map<address, bigint>` KRAY ledger and **(b)** a **star registry**: `Map<starNo, {owner, contentHash?, name?, seq, by}>` numbered by creation order. Keep `starTraits`/`starCollection` (now keyed on the creation number). Delete `plainUnitsExcluding`, the range structs, the FIFO selector. |
| `protocol/ledger.ts` | `transfer` becomes a simple balance move (debit `from`, credit `to`, fee → treasury) — no star selection. `inscribe`/`name` become **burn-and-mint** (see Phase 3). The conservation invariant flips from `Σ == 2.1Q` to `circulating == emitted − burned` (Phase 2 wires emitted; here, burned starts at 0). |
| `protocol/starmap.ts` (Codex) | `starTraits(n)`/`starCollection(n)` unchanged in logic, re-pointed to `n = creation order`. |

**Tests:** rewrite `starmap.test.ts` (no ranges/FIFO; fungible + registry), and the parts
of `all-laws.sim.ts` / `ledger.test.ts` that assumed numbered-star transfers. New checks:
a transfer moves fungible KRAY; a star is created only by inscribe/name; conservation holds
as an equation. Reboot byte-exact.

## Phase 2 — proof-of-donation mint (no premine)

**Goal:** KRAY is earned by donating sats to the anchoring pot; reward follows the pot
deficit; **no founder allocation.**

| file | change |
| --- | --- |
| `protocol/schedule.ts` | delete the fixed 2.1Q halving curve. New: a **reward function of the pot deficit** — simple, transparent, immutable (a formula anyone verifies), with a per-round cap and a vested/dripped release. Uncapped, self-regulating. |
| `protocol/emission.ts` / new `protocol/pot.ts` | the **anchoring pot** as a proven account: sats donated (SPV-proven, reusing the rune-deposit machinery), the deficit = target − held, the emission = f(deficit) split by donation with the cap. |
| `protocol/node.ts` / `ledger.ts` | **remove the genesis founder coinbase** (the 5B). Genesis mints nothing. Emission only ever flows from proven donations. |
| `server.mjs` | a `donate`/mint endpoint (prepare→sign→submit + SPV proof), mirroring `rune/deposit`. |

**Tests:** a donation mints KRAY proportional to the sacrifice; the pot deficit drives the
reward; the reward tapers as the pot fills; no premine exists at genesis; conservation
`circulating == emitted − burned` holds on every apply and reboot. Adversarial: a whale
donation past the pot target earns ~nothing; a Sybil split is bounded by the identity cost.

## Phase 3 — burn → star (the creation)

**Goal:** inscribe/baptize **burns KRAY** and mints a creation-numbered star.

| file | change |
| --- | --- |
| `protocol/ledger.ts` | `inscribe`/`name`: verify signature (unchanged), **burn 1 ₭** (`burned += 1`, balance −1), mint the next star (creation order), record content/name. The inscription id stays `<eventHash>i<index>` (A10). |
| `protocol/starmap.ts` | the star registry gains the star; `starTraits`/`starCollection` computed at birth from the creation number. `sendStar` moves a star whole (unchanged shape). |
| explorer + wallet | one number everywhere; "born from fire" language; supply shown as `emitted − burned`. |

**Tests:** inscribing burns exactly 1 ₭ and creates star #N (creation order); the Codex
stamps at birth; `sendStar` moves it; conservation holds.

## Phase 4 — the anchoring pot's trustless custody (where "untouchable" is won)

| file | change |
| --- | --- |
| `protocol/vault.ts` | the pot vault: **FROST** threshold sig across validators for the cooperative anchor path + a **CSV-timelock** unilateral leaf (already sketched). The pot signs each anchor tx; no single party can drain it. |
| anchor path | the seal is funded from the pot; permissionless (anyone assembles it, the pot signs+pays); never-freeze (CSV fallback + self-anchor with own sats). |

**Tests (design-resilient-runes lens):** the pot cannot be drained by any single party; a
stalled quorum still releases via CSV; anyone can anchor at any instant; a forged anchor is
refused.

## Phase 5 — migrate the capabilities

Bring the `KRAYNET-MIGRATION.md` capabilities onto v2: rune L2, ordinals-as-parent
(`origin`), DeFi/AMM (as contracts), the marketplace (`trade` 2-of-2), inscriptions. Each is
already partly built; re-home each onto the fungible-KRAY + star-registry base, phase by
phase, tests green.

## The non-negotiables at every phase (the Supreme Law + the hard requirements)

- Every state change: BIP-340 signature, re-verified at ingress **and** replay, into the
  cascade root anchored to Bitcoin.
- Permissionless anchoring, never-freeze, no single point of control, anti-whale by
  construction — verified per phase, never regressed.
- No premine, real cost from block one, simple + immutable — the Satoshi test.
- Atemporal: re-derivable from bytes at every instant; laws unchanged in every instant.
