# KRAYNET — the one-version consolidation contract

> **Status: EXECUTED — HISTORICAL.** The consolidation this contract governs has happened: v2 took the
> canonical names (one `ledger.ts`, one `starmap.ts`, one `node.ts`, one `server.mjs`), the v1 twins are
> deleted, and the whole explorer runs on the one node. Kept as the record of how the merge was made safe;
> nothing in it is pending work.

**The law of this project: there is ONE KRAYNET.** v2 is the true, updated network — fungible
₭ + born-from-fire stars + proof-of-donation, with the mathematical proof on Bitcoin and every
capability v1 had. When it is complete, v2 **takes the canonical names, v1 is deleted, and the
whole front-end runs on it.** No two versions. No duplicated, mixed files. One clean project.

This document is the contract for how we get there without mess and without breaking anything.

## The organizing principle (why the transition is not chaos)

During the transition, **only the files COUPLED to the old 2.1Q model have a temporary `-v2`
twin.** Every MODEL-AGNOSTIC module is SHARED and reused as-is — never duplicated. That keeps
the duplication small, deliberate, and easy to erase at the end.

### Temporary twins (model-coupled) — collapse to ONE at consolidation

| the twin (v2, temporary) | replaces (v1, deleted at consolidation) | final canonical name |
| --- | --- | --- |
| `protocol/ledger-v2.ts` (`LedgerV2`) | `protocol/ledger.ts` (`KrayLedger`) | `protocol/ledger.ts` |
| `protocol/starmap-v2.ts` (`StarRegistry`) | `protocol/starmap.ts` (`StarMap` range/FIFO) | `protocol/starmap.ts` |
| `protocol/store-v2.ts` (`LedgerStoreV2`) | (was inside `KrayLedger`) | folds into `ledger.ts` or `store.ts` |
| `protocol/node-v2.ts` (`KrayNodeV2`) | `protocol/node.ts` (`KrayNode`) | `protocol/node.ts` |
| `kray-net/server-v2.mjs` | `kray-net/server.mjs` | `kray-net/server.mjs` |
| `protocol/pot.ts` (`AnchoringPot`) | — (new; no v1 twin) | `protocol/pot.ts` (stays) |

### Shared — reused, NEVER duplicated (no `-v2` twin, ever)

`protocol/scheme.ts` (signatures + message builders — v2 adds `inscribeMessageV2`/`nameMessageV2`
alongside the v1 ones, same file), `anchor/*` (the Bitcoin OP_RETURN transport takes a plain root
string), `protocol/presence.ts` · `custody.ts` · `reward.ts` · `beat-pow.ts` (fee-pool
distribution), `protocol/chain.ts` · `block.ts`, `glow.ts` · `governance.ts` · `attestations.ts`,
`protocol/library.ts`, `rune-*.ts` · `contract.ts` · `vault.ts`, `anchor/spv.ts`.

### Deleted at consolidation (pure v1-model — no home in v2)

`protocol/emission.ts` and `protocol/schedule.ts` (the fixed 2.1Q halving curve — v2 mints only
by proof-of-donation), the `EMISSION_VAULT` premine path, the range/FIFO star machinery inside
the old `StarMap`, and the `Σ == 2.1Q` conservation.

## The front-end — all of it on v2, one server

- **One node server** (`server.mjs`, the promoted `server-v2`) serves BOTH the JSON API and the
  explorer HTML pages. No second server.
- **The explorer pages** (`kray-net/*.html`) render the v2 model: fungible ₭, supply =
  emitted − burned, the anchoring pot/donation, stars by creation number with the Codex.
- **The wallet** has ONE KRAYNET network, pointing at this server. The KRAYNET panel renders the
  v2 model (₭ balance, stars born from fire, the pot). No v1 network path left for kraynet.

## The sequence (consolidate LAST, after it all works)

1. **Finish v2 functionality on the twin scaffold** — everything v1 had, re-proven:
   - [x] core: ledger · starmap · pot · cascade root · Supreme Law (signatures)
   - [x] durability: the persistence shell (journal, hash-chain, replay)
   - [x] node + HTTP server + wallet write-flow (prepare→sign→submit)
   - [ ] the Bitcoin anchor broadcast (reuse `KrayAnchor`, feed `cascadeRoot()`, emit `anchor` on spend)
   - [ ] the capabilities: runes L2, ordinals-origin, contracts, fee-pool distribution (reuse the
         model-agnostic modules; port the coupled branches into `LedgerV2`)
   - [ ] the front-end: explorer pages + the wallet panel on the v2 model
2. **CONSOLIDATE (the big-bang, mechanical + proven):** delete every v1-model file, rename each
   twin to its canonical name, rewire all imports and the front-ends, and run the WHOLE test suite
   green + a byte-exact reboot. One commit, fully proven, nothing half-renamed.
3. **Zero-duplication checklist (the definition of done):**
   - [ ] `grep -r "\-v2" src/` returns nothing — the names are canonical, no `-v2` suffix survives.
   - [ ] no file has a v1 and a v2 variant; one `ledger.ts`, one `starmap.ts`, one `node.ts`, one `server.mjs`.
   - [ ] one journal format, one set of message builders, one conservation law (emitted − burned).
   - [ ] the explorer and the wallet both talk to the one server and render the one model.
   - [ ] the whole suite is green and a cold reboot is byte-exact.

**Until step 2, v1 keeps running untouched so nothing breaks. After step 2, there is only KRAYNET.**

---

## The precise execution plan (from the dependency map, 2026-08)

A full read of the import graph revealed the exact surface — and one ordering constraint that
reshapes the sequence. Recorded here so the consolidation is a mechanical, verified pass, not
a rediscovery.

### The ordering constraint (why "delete v1 now" is not clean yet)

**The v1 `server.mjs` serves the ENTIRE web explorer** — ~20 HTML pages (`v2.html`, `profile.html`,
`star.html`, `blocks.html`, `mine.html`, …), the `/content/<hash>` blobs, and all static assets
(`kray-v2.js/.css`, `/vendor`, `/logos`, `/sound`). It imports the v1 `KrayNode`. Deleting the v1
node breaks that server, which takes the explorer down. `server-v2.mjs` is JSON-API-only.
**Therefore the explorer/static layer must move onto the v2 server BEFORE v1 can be deleted.**
The real order is: **migrate the explorer → then the big-bang delete.**

### The two hybrids to untangle first (Step A)

- **`protocol/ledger.ts`** = shared primitives (lines ~35–232) + the `KrayLedger` class (234+).
  The primitives (`EMISSION_VAULT, TREASURY, BLACK_HOLE, MIN_FEE, FIXED_FEE, KrayEventKind,
  NAME_MAX_BYTES, STAR_RE, KrayEvent, SettlementRow, MAX_INSCRIPTION_BYTES, GENESIS_HASH,
  sha256hex, canonical`) are model-agnostic (verified: no emission/schedule dependency) → move to
  `protocol/kray-primitives.ts`; the class is deleted. Do this by rewriting ledger.ts WHOLE
  (safer than exact-match surgery on the 130-line KrayEvent block).
- **`protocol/starmap.ts`** = shared star helpers (`canonicalName, isValidName, NAME_INVISIBLE,
  starCollection/StarCollection, starTraits/StarTrait, Inscription, Baptism`) that **v2 imports**
  (`starmap-v2.ts:25-28`, `node-v2.ts:20`) + the v1 `StarMap` class + v1 rarity (`starBirth`,
  `starRarity`, `StarRange`). Move the shared helpers to `protocol/star-lore.ts`; delete the class
  + v1 rarity. **Coupling:** `starTraits` reads `TOTAL_SUPPLY` from `schedule.ts` — keep a trimmed
  `schedule.ts` (just `SEAL_CONFIRMATIONS`, consumed by the kept `consensus.ts`, and `TOTAL_SUPPLY`).

### File map (twins → canonical; deletes; renames)

| v2 (twin) | → canonical | class rename | v1 file deleted |
| --- | --- | --- | --- |
| `ledger-v2.ts` | `ledger.ts` | `LedgerV2`→`KrayLedger` | old `KrayLedger` class |
| `starmap-v2.ts` | `starmap.ts` | `StarRegistry` stays; `starRarityV2`→`starRarity`, `StarV2`→`Star` | old `StarMap` class |
| `store-v2.ts` | `store.ts` | `LedgerStoreV2`→`LedgerStore` | (none; new) |
| `node-v2.ts` | `node.ts` | `KrayNodeV2`→`KrayNode` | old `KrayNode` |
| `server-v2.mjs` | `server.mjs` | — | old v1 `server.mjs` (after explorer moves) |
| `pot.ts` | unchanged | — | — |
| — new — | `kray-primitives.ts`, `star-lore.ts` (shared) | — | — |
| DELETE | — | — | `emission.ts`; trim `schedule.ts` |

Barrel `index.ts` (currently exports only v1) → rewrite to the v2 stack. Collisions to drop on
rename: `ledger-v2.ts` re-export of `{TREASURY, BLACK_HOLE}` + its own `MIN_FEE`; `node-v2.ts`
re-export of `starRarityV2`.

### Tests (Step G)

- **Delete/rewrite** the v1-model tests (they test `KrayLedger`/`StarMap`/`emission`/`KrayNode`):
  `ledger.test, seal-law, settlement, forward-compat, origin, block, rune-l2, starmap.test,
  emission.test, emission-clock, symbol, node.test, all-laws.sim, send-law, datadir-lock, resolve,
  library, hardcore, name-law, governance, receipt, krill-adapter, contract-chain, codex`, helper `pay.ts`.
- **Keep** the v2 sims (`ledger-v2, node-v2, store-v2, starmap-v2, contract-v2, rune-v2, pot, server-v2.itest`)
  — and ADD them to `package.json` `test`/`test:fast` (they are absent today).
- **Keep** the shared-module tests (`scheme, contract, rune-book, custody, presence, reward, glow,
  runestone, rune-ancestry, ordinal-ancestry, inscription, vault, spv, consensus, beat-pow, anchor-*`);
  re-point any that instantiate `KrayNode`/`canonicalName` to the renamed v2 modules.
- **Ripple (outside apps/):** `scripts/grand-exam.mjs`, `swarm-exam.mjs`, `kray-follow.mjs` import the
  v1 `KrayNode`/`emission` — update or retire with the rename.

### The safest way to run it

Rewrite whole files (not exact-match surgery), keep the **full test suite as the hard gate**, and do
it in an **isolated git worktree** so the main tree is never at risk — merge back only when every v2
sim + shared test is green and a cold reboot is byte-exact.
