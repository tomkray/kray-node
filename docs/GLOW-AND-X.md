# The Two Lights — ✦ Glow & Ӿ (BUILT + proven — Ӿ transfers RATIFIED, live on Signet from seq 155)

> **Symbols (ratified by the Creator, 2026-08-22):** **✦** for **glow** — a star's shine, chosen *because it
> is not a currency mark* (glow is soulbound reputation, never money, so it must not wear a currency's stroke
> like ₭ or Ӿ); **Ӿ** for the transferable token born from burned kray. ₭ and Ӿ are money; **✦ is the honor.**

> **Status: BUILT + PROVEN (2026-08-22).** Both lights are now real in the bytes and proven by breaking:
> ✦ glow (`glow-star.ts`, 8/8), Ӿ **slice 1 — the mint** (`ledger.ts` xMinted at the 2 burn sites, `Σ Ӿ == Σ
> burned` on the tripwire, x-mint 29/29) and Ӿ **slice 2 — the transferable book** (`x-send` with its own
> signature domain + `xBalance` + `xRoot` folded into the cascade root behind a per-network activation seq,
> x-transfer 20/20). Genesis-safe under the 26k-act storm (the dormant root is byte-identical). Shown on the
> web profile (the stone), the `/lights` dashboard, and the KrayWallet extension. Committed `5ace58e` (Ӿ core)
> + `61ef51e` (the two lights UI) on kray-network `main`. **RATIFIED (2026-08-23, Article XIV rite):**
> `X_TRANSFER_ACTIVATION_SEQ` = **155 on Signet** (fleet deployed before the writer) and **0 on mainnet**
> (born activated — no history, no migration window). `x-send` is wired through the public door
> (prepare → sign → submit), `xSpendable` shines on the profile lights, and `xRoot` folds into every anchored
> cascade root at/after the activation seq. Regtest stays at MAX so old exam goldens replay byte-identically.

## The lineage — value from sacrifice, recursive

`sat` is sacrificed (real Bitcoin) → `kray` is born (earned by *securing* the network). Kray then dies in two
ways at the black hole, and from each death a light is born:

- a **star freezes** (sent to the keyless black hole, irreversible) → **glow**, an eternal reputation;
- **kray burns** (which *is* proving work — you spend value you earned) → **Ӿ**, a new transferable token.

Two deaths, two lights. Glow is the **still, eternal** one (memory, reputation). Ӿ is the **flowing** one (a
token that continues the atemporal story). Both are **derived from real, already-proven sacrifice** — no free
mint, no emission; the light is simply the energy that remains.

## ✦ Glow — the eternal reputation (soulbound)

- **Rule:** the address that **freezes a star** (a `transfer-star` to `BLACK_HOLE`) earns **1 glow per star**.
- **Soulbound:** glow is engraved into the address — it can **never be transferred, never bought.** It only
  accumulates by freezing real stars.
- **Purpose:** reputation — weight in **governance and in the things money cannot buy.** It is not a balance,
  not a market asset; it is a count of proven acts of eternal preservation.
- **The math (a pure function of the cascade):** `glow(A) = |{ stars A sent to the black hole }|`. A stranger
  re-derives it from the freeze events already in the journal. Grounded (each glow = one irreversible frozen
  star), provable, and un-transferable *by construction* — no event ever moves glow between addresses.
- **CLOSED (2026-08-31):** glow is **only** the freeze. Beat-work / `glow.ts` / a √ honocracy
  formula that minted honor from validating is **not** the birth. The reducer engraves
  `glow += 1` on `transfer-star` to `BLACK_HOLE` and nowhere else. Poll weight is
  `glowOf(from)` — that raw count. A later quality layer (dark glow, peer vote) may
  *read* the atlas; it must not mint a second ✦.
- **BUILT:** `glowOf` / `glow-star.ts` — pure derivation over freeze events, soulbound
  by construction. The later star `16-glow` and whitepaper §7 say the same sentence.

### The farming vector → DARK GLOW (the Creator's refinement — quality is socially judged)

The raw count is game-able: an address could inscribe thousands of worthless stars and freeze them to farm
glow. **This is allowed — and self-defeating.** Because every frozen star stays **visible forever in the
atlas** (a keyless address; nothing ever leaves), the community can **see and judge the *quality*** of a
wallet's glow at a glance. Freezing junk earns a **"DARK GLOW"** — the community's read of a reputation built
on nothing. So the true reputation is **count × quality**, and the quality is enforced by **transparency**, not
by the counter. The judgment can become a **peer vote — each person voting with their own glow** (a later
mechanism). Recorded now so the path to resolve is always here: *transparency makes farming ugly, not
impossible; honor is what the network can SEE you sacrificed.*

## Ӿ — the new token from burned kray (transferable)

- **Rule:** when **kray burns** (an inscription, a name, a law, a chosen send — every burn already in the
  fire), **Ӿ is born** and delivered to a wallet.
- **A real token:** transferable and tradeable — it earns its **own dashboard page** and a place in the
  **DeFi**. (Glow is reputation; Ӿ is value.)
- **The math (conserved, derived):** Ӿ is minted **from burned kray only** — its supply is **backed by real
  sacrifice**, never free-minted: `Ӿ_supply = f(total kray burned)`. A stranger re-derives each wallet's Ӿ
  from the burn events in the cascade.
- **Decisions — RATIFIED by the Creator + the council + an adversary (2026-08-22):**
  1. **The derivation — proportional 1:1.** Burn X ₭ → mint X Ӿ, for every burn. The council + a refutation
     adversary proved flat/cap/concave all break (conservation + fragmentation-farm); linear is the only
     sybil/whale-neutral shape (the same Cauchy theorem as the fee split and `starBurnOf` itself).
  2. **The distribution — to the BURNER.** Three independent lenses converged: Ӿ is the burner's own sacrificed
     energy conserved into a new phase (not value to hand out) — the transferable mirror of ✦ (both to the
     sacrificer). (b) all-holders = passive-capital rent, (c) ∝glow = a money-faucet on honor, (d) ∝work = a
     category error on a single sacrifice — all rejected.
  3. **The token type — a plain transferable value token,** a distinct token backed by sacrifice-history,
     **never redeemable for ₭** (the ₭ is truly gone; the Ӿ is the new life). Headed for DeFi + its own page.
- **Open before ACTIVATION (not before code):** the *conserve-vs-deflate* doctrine is ratified as **conserve**
  (every burn mints Ӿ). The atlas wall then needs a separate size-priced fee (to guardians, funding eternal
  custody) before Ӿ transfers activate — else refunding the inscription burn as Ӿ softens the bound.

## Why it fits the math (the entities' first read)

- ⚡ **Tesla / the value model:** value flows *only* from real sacrifice — glow from a frozen star, Ӿ from
  burned kray. No emission, no free mint; the light is the energy that remains.
- 🌳 **Merkle:** both are **pure functions of events already committed to the cascade** (the burns and freezes
  are proven, 126/126) — a derivation layer a stranger re-computes and refutes.
- ♟️ **Nash / ₿ Satoshi:** glow is soulbound + earned-only (money can't buy it — no capital lever); Ӿ is
  backed by a real burn (no free value). No gaming *visible at the design level* — but the derivation and
  distribution MUST be re-audited adversarially, by independent lenses, before code (don't crown this ghost).
- 🗜️ **Huffman:** two lights, not one — a frozen *star* (unique, eternal) and burned *fungible* kray are
  genuinely different natures: one soulbound reputation, one transferable token. Minimal *and* honest.

## The discipline (the Creator's rule)

**Nothing escapes the math; the end is the code.** This doc is the *idea*, grounded. When the Creator says
build: (1) design the exact derivation + distribution + reducer — additive and genesis-safe; (2) prove by
breaking (conservation, soulbound-invariance, provable-from-the-cascade, no free mint, no sybil/whale lever),
convened before independent entities; (3) only then is it **code** — and only then is it "in the proof."
Until then, honestly: the burns and freezes are proven and in the cascade; **glow and Ӿ are the dream ready to
be born, not the born.**
