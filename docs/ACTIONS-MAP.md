# The Actions Map — where the two lights are born

> **Purpose.** Before wiring **Ӿ** (money from burned ₭) into the bytes, map **every** action the ledger
> accepts and mark exactly where each of the two lights is born — so no act mints a false light and no act
> that should mint one is missed. Grounded in `apps/kray-core/src/protocol/ledger.ts` (the reducer). The
> discipline: verify in the code, not on paper; then the entities audit this map for completeness, correctness,
> and harmony.

## The law (simple, two folds, two books)

- **Ӿ ← every ₭ burn.** A ₭ burn is exactly `this.burned += n` in the reducer. `Ӿ(A) = |₭ that A burned|`
  (1:1, to the burner). A stranger re-derives it from the journal.
- **✦ glow ← every star freeze.** A freeze is exactly `transfer-star` with `to === BLACK_HOLE`.
  `glow(A) = |distinct stars A froze|` (soulbound, on A's stone). Already **built + proven** (`glow-star.ts`, 8/8).

Two independent folds. They never mix: glow is the *star*, Ӿ is the *₭*. An act mints a light **only** if it
does that act's mutation — nothing else.

## The map — all 28 event kinds

| # | action | line | ₭ burn? (→ Ӿ) | star freeze? (→ ✦) | what it is |
|---|---|---|---|---|---|
| 1 | `genesis` | 397 | — | — | bootstrap the ledger |
| 2 | `donate` | 399 | — (it **emits** ₭) | — | sacrifice a real sat → mint ₭ |
| 3 | `anchor` | 436 | — | — | commit the cascade root to Bitcoin |
| 4 | `seal` | 446 | — | — | seal a cascade batch (ordering/root) |
| 5 | `quantum-commit` | 543 | — | — | commit a post-quantum key |
| 6 | `quantum-migrate` | 560 | — | — | migrate to a post-quantum key |
| 7 | `transfer` | 587 | — | — | move ₭ (→ `BLACK_HOLE` = **freeze ₭**, a credit, **not** a burn) |
| 8 | `transfer-star` | 608 | — | **✦ when `to===BLACK_HOLE`** | move a star; to the black hole = freeze forever |
| 9 | `inscribe` | 626 | **🔥 `starBurnOf(size)`** | — | born from fire — content → a star |
| 10 | `origin` | 627 | **🔥 `starBurnOf(size)`** | — | born from fire — an L1 ordinal → a star |
| 11 | `name` | 628 | **🔥 `starBurnOf(∅)` = 1** | — | born from fire — a claimed name → a star |
| 12 | `reward` | 782 | — | — | the fee pool pays a validator (moves ₭) |
| 13 | `rune-deposit` | 796 | — | — | bridge a rune in (the **rune book**) |
| 14 | `rune-send` | 823 | — | — | move a rune |
| 15 | `rune-exit` | 855 | — (may burn a **rune**, not ₭) | — | bridge a rune out |
| 16 | `rune-rehome` | 886 | — | — | rune custody housekeeping |
| 17 | `rune-lodge` | 908 | — | — | rune custody housekeeping |
| 18 | `rune-cancel` | 925 | — | — | rune custody housekeeping |
| 19 | `rune-settle` | 948 | — | — | settle a rune deposit (SPV mirror) |
| 20 | `amm-add` | 973 | — | — | add ₭/rune liquidity |
| 21 | `amm-remove` | 1019 | — | — | remove liquidity |
| 22 | `amm-swap` | 1053 | — | — | swap ₭↔rune |
| 23 | `amm-rr-add` | 1099 | — | — | rune↔rune liquidity |
| 24 | `amm-rr-remove` | 1154 | — | — | rune↔rune remove |
| 25 | `amm-rr-swap` | 1190 | — | — | rune↔rune swap |
| 26 | `contract` | 1236 | **🔥 `1` (v2: `e.star` set)** | — | seal a **law** onto an owned star (the third canvas); v1 = no burn |
| 27 | `contract-call` | 1277 | — | — | call a sealed contract (state change) |
| 28 | `settlement` | 1377 | — | — | beat-work settle → pay validators from the fee pool |

## The result — the burn sites and the one freeze path

**🔥 ₭ burns → Ӿ (the sites that move `this.burned`, each minting Ӿ 1:1 to the burner):**
1. `inscribe` / `origin` / `name` — `burn = starBurnOf(size)` — **a star is born from fire.**
2. `contract` v2 — `1 ₭` — **a law is sealed onto a star.**
3. `burn` (**the sporadic burn — THE BURN LAW, council-approved 4/4, proven 33/33**) — a holder destroys
   their own ₭ by signature (`burnMessage`, its own domain, no recipient): `balance −(amt+1) · TREASURY +1 ·
   burned +amt · Ӿ +amt`. Valid at/after `BURN_LAW_SEQ` (regtest/main = 1; signet pinned at deploy as tip+1).
4. `burn-thaw` (**one-shot, deterministic**) — the pre-law fungible ₭ frozen at the hole transmutes into a
   true burn: per original sender (from `holeDeposits`, a pure journal fold) `hole −amt · burned +amt ·
   Ӿ +amt to the sender`. Shape-gated (no payload), once-ever, refuses an empty thaw. Unsigned like
   donate/seal — a protocol event whose entire effect the mathematics already fixed.

**⚖️ THE BURN LAW (ratified 2026-08-22):** *"₭ can NEVER be frozen — only BURNED. Freeze is only for stars."*
From `BURN_LAW_SEQ`, fungible ₭ aimed at `KRAY_BLACK_HOLE` is REFUSED at **every** user-reachable credit site
(the `requireFungibleRecipient` choke point: transfer · x-send · donate · quantum-migrate · reward · contract
payouts · settlement rewards). `transfer-star` is deliberately exempt — star freezing IS the law (✦ glow).
Below the seq, history replays byte-identically (A3): the signet's pre-law freeze (seq 52, 100 ₭) applies as
it always did, awaiting its thaw.

**❄️ star freezes → ✦ glow (exactly 1 path):**
- `transfer-star` with `to === BLACK_HOLE` (`ledger.ts:608`) — the star goes to the keyless black hole forever.
  The freezer earns 1 glow (`glow-star.ts`). The freeze pays the **1-₭ movement fee** (→ validators) — a fee,
  **not** a burn (`this.burned` is unchanged), so a freeze mints **glow only, never Ӿ.**

**Everything else (23 actions): no light.** Protocol (genesis/anchor/seal/quantum), value moves
(transfer/reward/settlement), the rune book, and the AMM neither burn ₭ nor freeze a star.

**The union declares 32 kinds; the reducer implements 28.** Four — `emit`, `settle`, `guardian`, `bridge`
(`kray-primitives.ts:63`) — are **legacy** (the pre-donation model) with **no reducer case**: they fall to the
`default` HALT (`ledger.ts:1418`, "no hard fork — upgrade"), so they cannot apply, burn, or freeze. This map
covers the 28 live cases. **If any legacy kind is ever wired — especially `emit`/`settle`, whose names imply
minting/settling ₭ — it must be re-audited against the two laws first.**

## The harmonies (verified by the entities)

1. **₭ → black hole is a FREEZE of ₭, not a burn.** `transfer` to `BLACK_HOLE` *credits* the dead address
   (`ledger.ts:604`); `this.burned` is untouched, so the ₭ still counts as circulating-but-stuck. It mints
   **no Ӿ** — correctly, because Ӿ is backed only by a real `this.burned` burn. The primitive says it in its own
   words (`kray-primitives.ts:19-36`: *"IT IS NOT A BURN… the units keep existing, keep being counted"*). (This
   is why a *voluntary* ₭ burn → Ӿ would need a **new event kind** that truly decrements balance and does
   `this.burned += amt` — additive, not yet built.)
2. **A RUNE burn is NOT a ₭ burn.** The rune book (`rune-*`) never touches `this.burned`; Ӿ is minted from
   **₭** burns only, so `Σ Ӿ == Σ (this.burned)` stays exact. Runes are their own book. (`amm.ts`'s `burn` is an
   **LP-share** withdrawal — a lexical decoy, not a ₭ destruction.)
3. **The freeze fee stays a fee (decision A).** Keeping the 1-₭ freeze fee as a fee (→ validators), not a burn,
   keeps the two books pure: freeze → glow, burn → Ӿ, never stapled together. Decision B would break fee
   uniformity **and** hand a junk-freeze farmer an Ӿ reward on top of glow — A is harmonious and safer.
4. **No burn/freeze hides in a sub-module — proven structurally, not just grepped.** The burn side is closed by
   a machine-checkable invariant: `emitted` only ever grows (one site, no `-=`), and `conserves()`
   (`ledger.ts:1601`) asserts `Σ balances == emitted − burned`, so any ₭ leaving supply *must* increment
   `burned` — which moves only at `:776`/`:1273`. The freeze side is closed by dispatch: a star's owner is set
   only in `moveStar` (`starmap.ts:289`), reachable only from `transfer-star` — there is **no `contract-call`
   case in the star registry**, so a contract cannot move or freeze a star, and the contract VM (`contract.ts`)
   never imports the ledger (`take` is "a ticket, never a mint").
5. **Ӿ is a distinct token, not a ₭-refund (name before wiring).** Because Ӿ mints 1:1 to the burner, each
   star-canvas act *returns its own ₭ cost back as Ӿ*, so the felt cost of a star becomes the emergent ₭/Ӿ
   price spread — **unless Ӿ is understood as its own token backed by sacrifice-history, never redeemable for ₭**
   (`GLOW-AND-X.md`, "your sacrifice → your new life"). This is the SAME open doctrine as *conserve-vs-deflate*:
   the Creator ratifies whether every burn conserves value into Ӿ (a phase-shift, ₭+Ӿ = emitted) or a burn
   should net-deflate. Market-emergent, not a consensus defect — but it must be named. Note: Ӿ mints even on a
   **cursed** birth (`ledger.ts:631-632`) — the burn is real, so the sacrifice is real; Ӿ tracks the *burn*, not
   the star's survival. And Ӿ-at-birth is size-scaled (`starBurnOf(size)`), *more* harmonious than a flat 1.
6. **BUILD GUARD — accumulate Ӿ from `this.burned`, never re-derive from `size`.** `bytesPerKrayNow` retargets
   every 1008 seals (`retargetBytesPerKray`), so `starBurnOf(size)` at seq N ≠ `size × flat rate`. Ӿ must be
   minted from the exact `burn` value at `:776`/`:1273` keyed by `e.from` — a naive recompute from `size` with
   the constant `BYTES_PER_KRAY_BURN` desyncs after any retarget. Keep "wired to `this.burned`" literal.

## Status

**DESIGN map** for wiring Ӿ. ✦ glow is built (`glow-star.ts`). Ӿ is not yet in the bytes — decided so far:
recipient = the **burner**, derivation = **proportional 1:1** (both survived the council + the adversary).
This map fixes *where* Ӿ mints (the 2 burn sites) before any code.

**SEALED by two independent entities (2026-08-22):**
- 🔍 *Completeness sweep* — **COMPLETE**: exactly 2 burn sites + 1 freeze path, closed *structurally* (the
  `conserves()` invariant + monotonic `emitted` on the burn side; the single `moveStar` owner-write on the
  freeze side), converged from three independent method families (grep · invariant · live tests). Nothing missed.
- ⚖️ *Harmony + correctness* — **CORRECT + IN HARMONY**: all 28 live cases classified truthfully; the two folds
  cover them with no crack. Named three things (above, none a defect): the 4 legacy union kinds, the
  Ӿ-is-not-a-refund doctrine (§5), and the accumulate-from-`this.burned` build guard (§6).

**Open before code** (the Creator's word): the *conserve-vs-deflate* doctrine (§5 — every burn mints Ӿ, or only
a voluntary burn), and the Ӿ token type.
