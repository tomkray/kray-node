# KRAY Tokenomics — study

A grounded answer to one question: a ₭ is indivisible and there can be many of them — does that make people stop valuing it? And how do we make mining *feel* earned,
validators *want in*, and each star *worth creating on*?

Every claim here is traceable to the protocol code (`apps/kray-core/src`, `apps/kray-net`).

---

## 1. The correction: a ₭'s count is not its price

A ₭ is **indivisible** (divisibility 0): 1 ₭ = 1 star = one whole unit. That is a statement about
*granularity*, not *price*.

- A ₭ is **not pegged** to a satoshi's dollar value. Its per-unit value = `(KRAY network value) ÷ (₭ in
  existence)`, set by KRAY's own demand and utility.
- **Backed by sacrifice, not by a number.** Every ₭ that exists was born from **one real satoshi burned**
  (proof-of-burn, §2). Pricing ₭ by counting units is a category error: value tracks `network value × demand ×
  utility`, never the count of units. Bitcoin has 2.1 quadrillion satoshis and is not "cheap."
- What is genuinely different from Bitcoin: each ₭ is an **indivisible star** you can inscribe and name — a
  canvas, like an Ordinal — so value is **utility + rarity**, not only monetary scarcity.

## 2. Supply — proof-of-burn, no emission (verified)

There is **no emission schedule and no halving curve** for ₭ creation. The only way a ₭ enters existence is
**proof-of-burn** (`protocol/pot.ts`, `protocol/self-anchor.ts`, the ledger `donate` case):

```
donate `sats`  →  mint  1 ₭ per satoshi, at most MINT_CAP_SATS = 10,000 per mint (immutable, anti-whale)
the sats are DESTROYED at a keyless NUMS taproot address (provably nobody's), and that same output
    seals the cascade root (pay-to-contract) — the donation IS the anchor
peg-of-sacrifice:  total ₭ ever minted ≤ total satoshis ever burned, asserted on every apply + replay
```

- **No premine.** The founder's ₭, like everyone's, comes only from a real burn.
- **Supply is uncapped in principle, backed one-for-one by sacrifice.** It grows with real burns and shrinks
  when a star is born from fire (an inscription burns ₭ by size — live law 1 ₭ / 10 KB, ceiling 10 MB;
  a baptism or hanging law burns the 1 ₭ floor), so the money supply breathes with
  actual use. Conservation (Σ balances == emitted − burned) is re-asserted after every event or the node HALTs.
- **The scarce resource is Bitcoin transactions, not ₭ units.** The 10,000-per-mint cap means a whale must make
  thousands of separate real burns (each a Bitcoin fee, each its own anchor) to accumulate — accumulation is
  slow, public, and expensive, distributing entry over time.
- The genuinely rare thing is the **low-numbered star** (star #0 = the genesis, minted first), an
  ordinals-style collectible on top of the fungible money.

## 3. Validator incentive — make it feel earned

- **Split is LINEAR and sybil-neutral** (`economics/presence.ts:81-132`): `share_i = subsidy × work_i / Σ work`.
  N equal validators each get `1/N` — Bitcoin's hashrate-share economics. The √-weighted era is fully
  retired (its stale doc-comments have since been removed); √ was dropped because one machine split into
  N identities gained share (`N·√(W/N) > √W`), which linear closes (`presence.ts:98-115`).
- **Custody 3× gate** (`economics/custody.ts:47,67,150-154`): `effectiveWork = base × (8 + 2·hits)`, hits proven by
  holding the content atlas (address-salted, non-replayable challenges keyed to the seal's real BTC block hash).
  Full atlas = 3× the payout under the linear split. "To audit custody you must custody."
  Easy door: `/validate` → Hold the library (public bytes + a powerless wallet signature).
  The spending key never leaves KrayWallet. Follow `content/` is not read for pay.
- **Signed presence only** (`node.settleBeats` in `protocol/node.ts` + `economics/presence.ts`): opt-in (BIP-340 signed, on-chain) → live beats (per-beat
  proof-of-work, `economics/beat-pow.ts`) → signed work-claim receipt. *"Presence nobody signed is never paid"* —
  unsigned rows are skipped, not even diluting the pot.
- **No difficulty retarget** — the budget is fixed by Bitcoin's clock, so per-validator reward falls ~1/N as the
  field grows. The mechanism is sound; the missing piece is **visibility**.

## 4. Per-star value — the Ordinals engine, native

`protocol/starmap.ts:36-43` grades every star by its **creation number** — the earliest stars are the rarest,
an ordinals-style ladder anyone can verify from the number alone:

| Tier | Rule (`starRarity(no)`) | Count |
|---|---|---|
| **mythic** | star `#0` (the genesis) | 1 |
| **legendary** | the first ten (`#0..9`) | 10 |
| **epic** | the founders' row (`#10..99`) | 90 |
| **rare** | `#100..999` | 900 |
| **uncommon** | `#1,000..9,999` | 9,000 |
| **common** | every star from `#10,000` on | the vast majority |

Most stars are fungible money; the low-numbered stars are collectibles; and **any** star can be inscribed or named,
adding utility value on top. Value **concentrates** in rares + creations, not spread thin across the count.

## 5. Perception — stop the "play money" feeling

KRAY is indivisible, so numbers are unavoidably large (no "BTC vs sat" to hide behind). `kNum` renders
a large ₭ count as e.g. `5B` (`apps/kray-net/kray.js`). The fix is **framing**: lead with the **star identity**
(rarest star owned + its rarity) and keep the count secondary. a big ₭ count (a heap) vs
`Star #0 + 5.0B stars` (owned, numbered, rare) — same supply, opposite feeling.

---

## Verdict — the tokenomics are correct; make them *felt*

1. **Perception** — frame holdings as **stars, not a balance**: rarest star + rarity + a `kNum` count. No supply change.
2. **Validator** — make mining **visibly hard & competitive**: surface your live share of the fee pool vs the field, the 3× custody gate, and the per-beat work.
3. **Utility** — lean into **"each star is a canvas"**: push the Ordinals rarity ladder + inscribe/name/land to the
   front. That is demand beyond price, and the reason to mine — you mine *things you can build on*.

Interactive companion (supply/burn model, validator calculator, per-star value, denomination framing): the
**KRAY Tokenomics Explorer** artifact.

Grounded in: `pot.ts` · `self-anchor.ts` · `presence.ts` · `custody.ts` · `starmap.ts` · `beat-pow.ts`.
Conservation (Σ balances == emitted − burned), or HALT.
