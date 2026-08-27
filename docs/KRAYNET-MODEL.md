# KRAYNET — the model: fungible fuel, stars born from fire

> **Status: VISION LOCKED (2026-08-02) — and since BUILT AND LIVE.** This blueprint
> was captured before any code moved; the v2 model it designs (fungible ₭ born only
> from burned satoshis, stars born by inscription) is now the running protocol — the
> proof-of-burn mint, presence mining, custody and the self-anchor all live in
> `apps/kray-core` and are exercised by the full suite. The 2.1Q numbered-star era
> it replaced is retired. Kept as the founding design record.

## The one-sentence pivot

**From** "every ₭ *is* a pre-numbered star (Bitcoin's exact 2.1Q curve)"
**to** "**KRAY is pure fungible fuel; a STAR is born the moment you inscribe — you burn
KRAY, and a non-fungible star is created.**"

Bitcoin Ordinals had to number every satoshi to give provenance a home. KRAYNET
doesn't: plain money stays fungible and light, and a **star is something you
*create*** — precious because it was made, not because it was pre-assigned a number.

## The dual system (simple, on purpose)

| | **KRAY** (the fuel) | **Star** (the creation) |
| --- | --- | --- |
| nature | fungible, no number | **non-fungible**, one number |
| born by | mining (hard/slow emission) | **burning 1 KRAY** on inscribe/baptize |
| moves as | an amount (like Bitcoin) — FIFO/ranges GONE | a whole, by an explicit **Send Star** |
| identity | just a balance | the **creation-order number** = the inscription |
| value | utility / fuel | scarce, permanent, collectible — where value lives |

Because plain KRAY is fungible, **all the per-unit machinery disappears**: no 2.1Q
star ranges, no FIFO selector, no "fee takes the newest star", no plain-vs-relic
per unit. A transfer just moves a number. Lighter, fewer bug surfaces.

## One number, forever

A star's identity **is** its creation number (the inscription order): star **#1** is
the **first thing ever written on the network** — the most sacred. No second number,
no dual "star # vs inscription #" ever again. The provenance id stays
`<signed-event-hash>i<index>` (A10) — derived from the signature, so a star cannot
exist without the act that authored it.

## The mint — Proof-of-Donation-to-Bitcoin (a genuine, novel PoW distribution)

KRAY is **earned, not bought.** You mine KRAY by **sacrificing real satoshis** into
the network's **anchoring pot** — the communal fund of sats that keeps KRAY sealed to
Bitcoin. This is a genuine, fair-launch distribution with real proof-of-work, and it
does **not** lock capital forever.

- **Mine = donate sats to the anchoring pot.** Your KRAY emission is your share of the
  work — measured by the real satoshis you sacrificed. No premine, no buy-in against
  collateral; everyone earns in proportion to what they gave.
- **The sacrifice is not wasted** (unlike Bitcoin's electricity): the donated sats
  **fund the network's Bitcoin anchoring for decades**. The work produces a real,
  permanent good — the chain's continuous seal on Bitcoin.
- **The anchoring pot is a slow drip, not a one-shot.** Each seal spends only its own
  Bitcoin tx fee (~a few thousand sats); the rest stays in the pot for the next seal,
  and the next. Amortised across many intervals per seal, a modest pot lasts *decades*
  (≈ 1 BTC ⇒ ~50,000 seals). Nothing is locked "forever" — sats are *spent*, over a
  very long time, on real Bitcoin security.

**Why this is the strongest security available:** to mine — or to attack/game — you
need real, expensive satoshis. As the sat's value rises, the cost of both rises with
it. **KRAYNET inherits Bitcoin's own economic security**; the difficulty scales with
Bitcoin's price, exactly as hashrate does. There is nothing cheaper to forge than
Bitcoin itself, which is now the cost of forging KRAY.

**The natural taper (fair launch):** as the pot fills (it already funds anchoring for
years), the need for new donations falls, so mining slows on its own — the earliest
donors, who bet on KRAY when it was worth little, are rewarded most. This is the same
bet the first Bitcoin miners made spending electricity. Early belief, larger share.

**Value:** KRAY's value is emergent, from (a) the real cost to produce it (satoshis
sacrificed + the work) and (b) the demand to use it (you need KRAY to create stars and
to act). Not a fixed 1-sat peg — organic, like Bitcoin's own.

## The anchoring pot + custody — where "untouchable" is won

The pot of donated sats **is** the vault, and the whole model is only as trustless as
its custody. If any operator can drain it, the proof-of-work is theatre. The
2026-08-01 audit already flagged the rune bridge's custody as a server-held hot wallet
— for the native anchoring pot that is unacceptable. It must be genuinely
distributed/keyless:

- **FROST** — a threshold Schnorr signature split across the validator set; the pot
  signs each anchor tx cooperatively, and no single party (or server) can move it.
- **Covenant / CSV vault** — kray-net already sketches this in `vault.ts` (taproot,
  NUMS internal key, cooperative t-of-n leaf + a unilateral CSV-4320 exit).
- **Likely both:** FROST for the cooperative anchor path, a CSV-timelock leaf so the
  pot is never hostage to a stalled quorum.

**This is the central engineering decision of KRAYNET v2** — the anchoring pot's
trustless custody is where "intocável" is literally won.

## Stars — burning earned KRAY into a permanent creation

A star is still born by **burning KRAY** on inscribe/baptize. The KRAY was *earned*
(sacrificed sats → work → KRAY), and burning it into a star makes something permanent
and numbered. So the full chain of value: **real satoshis → Bitcoin anchoring +
earned KRAY → stars (permanent, scarce creations)**. Conservation is provable at each
hop: `circulating_KRAY == emitted − burned`, and the pot's sats are auditable on
Bitcoin.

## Rarity — re-homed onto creation order

The Codex (Sacred Houses honoring da Vinci / Tesla / Kepler / the Egyptians, and the
sacred-geometry traits — Fibonacci, prime, perfect, π, resonance…) **survives, in
full** — it simply reads the **star's creation number** instead of an emission
position. The rarity/House/traits are **stamped at BIRTH**: the instant a star is
created (you inscribe/baptize), its creation number is fixed forever and its Codex
identity is computed deterministically from it — `starTraits(n)`/`starCollection(n)`
run exactly as today, just on `n = creation order`.

Low numbers are the first creations; `sub-100`, `sub-1k` are the founding galleries.
This is arguably *more* meaningful — the rarest stars are the earliest **acts**, not
arbitrary calendar slots — and it aligns perfectly with the slow, hardcore
tokenomics: **create early and your star is born rarer**, so the incentive to
participate while the network is young is baked into the Codex itself.

## What stays — the Supreme Law is untouched

Every state change is still a **BIP-340 signature** the reducer re-verifies at ingress
**and** replay, committed into the **cascade root anchored to Bitcoin**. Mint
(emission), burn (inscription→star), transfer, name, Send Star — all proven, nothing
trusted. Signature ‖ Merkle proof ‖ Bitcoin anchor remains the only path.

## The axioms — what changes

| axiom | v1 (now) | v2 (this model) |
| --- | --- | --- |
| A0 · the symbol is ₭ | ✓ | ✓ unchanged |
| A1 · Σ == 2.1Q, every ₭ a numbered star | fixed 2.1Q, all numbered | 🔄 **KRAY fungible; supply = emit − burn, no cap** |
| A2 · the 1-₭ fee | every action = 1 ₭ | ✓ kept (refine: fee to validators vs part of the burn) |
| A5 · written stars are relics | a written star keeps its birth number | 🔄 **a star IS a created inscription; there is no "plain star"** |
| A8 · one root proves everything | ✓ | ✓ unchanged |
| A9 · the address is the user | ✓ | ✓ unchanged |
| A10 · an inscription id is its signed act | ✓ | ✓ becomes central (the star = the inscription) |
| mint | Bitcoin's exact curve, mined by the schedule | 🔄 **Proof-of-Donation: KRAY earned by sacrificing sats into the anchoring pot; uncapped, tapering, disciplined by the burn** |

## What gets built / reworked (implementation map — later)

- **starmap → split:** a plain fungible ledger (KRAY balances) + a **star registry**
  (creation-order numbered, non-fungible). Delete the 2.1Q range/FIFO machinery.
- **emission:** replace the fixed halving curve with the hardcore/slow uncapped
  schedule (curve TBD — a refinement below).
- **inscribe/name:** now a **burn-and-mint** (consume KRAY → create the star with the
  next creation number), signed + replay-verified.
- **conservation check:** from `Σ == 2.1Q` to `circulating == emitted − burned`.
- **Codex:** repoint `starTraits`/`starCollection` to the creation number.
- **explorer + wallet:** one number everywhere; "born from fire" language; the
  supply shown as a living emit/burn figure.
- Tests, the sims, the profile, the KRAYNET wallet panel — all follow.

## Open refinements (decide before code)

1. **The reward curve** — how much KRAY per seal, and how is it split among donors?
   Proportional to sats donated (proof-of-burn-fair) with a cap or a curve? How steep
   is the natural taper as the pot fills? Does compute-work (presence beats) still play
   a role, or is the sat donation the whole proof?
2. **The anchoring pot's custody** — FROST vs covenant/CSV vault (the central call).
3. **The 1-₭ fee** — kept as A2; flows to validators/donors (the reward loop) — the
   inscription burn is *separate* (fuel → art).
4. **Membership** — the non-fee elite perk (already parked) fits cleanly: a membership
   card is itself a star.

## Fair distribution — the Satoshi test (three commandments)

KRAYNET's distribution must pass the test Satoshi set, and improve on it:

1. **No premine — no privilege.** There is **no founder allocation**. Everyone,
   including the founder, earns KRAY only by donating sats under the same rules. (The
   v1 genesis 5B founder coinbase is gone in v2.) This fixes Bitcoin's one accidental
   unfairness: the near-free early CPU mining that concentrated coins in the first
   hands.
2. **Real cost from block one.** Mining costs real satoshis from the very first block
   — no free early mining, ever. The cost is equal for all, at all times.
3. **Simple and immutable, as Satoshi would build it.** The reward rule is a fixed,
   transparent formula anyone can verify and predict — not an opaque, discretionary
   mechanism. Fewer parameters, less discretion, fewer bugs over 100 years.

Where KRAY is fairer than Bitcoin: the PoW sacrifice is not wasted (it funds the
Bitcoin anchoring, not heat); there is no near-free early-miner windfall; and the
chain inherits Bitcoin's own security instead of building a small, attackable one.

## Longevity & decentralization — hard requirements (non-negotiable)

1. **Permissionless anchoring, forever.** ANYONE can pay to anchor the current cascade
   root at ANY moment in history — it is a plain Bitcoin OP_RETURN tx anyone can build
   and broadcast, and the node accepts the SPV proof from anyone. No gatekeeper, ever.
2. **Never freezes.** Transfers and inscriptions apply to the journal independently of
   anchoring; if no one anchors, only *mining* pauses (emission waits) — the network
   stays fully alive, and anyone can unstall it by anchoring.
3. **No single point of control.** The anchoring pot's custody is distributed
   (FROST/covenant) with a unilateral CSV exit, so the sats are never hostage to a
   stalled quorum, and anyone can self-anchor with their own sats.
4. **Anti-whale by construction.** The pot has a bounded natural size (only what funds
   anchoring for a long time); the reward follows the pot's **deficit**, not raw
   donation — once the pot is funded, extra sats earn ~nothing, so a whale cannot buy
   dominance. Plus a **per-round cap** and a **vested/dripped** reward so sustained
   participation beats a one-shot dump. Avoid naive √-weighting (Sybil-exploitable);
   use bounded need + caps + an identity cost.
5. **The self-regulating cycle:** pot fills → mining slows → pot drains (anchoring) →
   deficit grows → reward returns → new donors mine. Emission is pulled by the real
   security need, forever — the network mines exactly what it needs to stay sealed to
   Bitcoin, and matures toward *utility* (creating stars) over speculation.

## The full network — Ethereum/Solana capability, Bitcoin's soul

KRAYNET is not only money and stars. On this proven base run the capabilities mapped
in `KRAYNET-MIGRATION.md`: the **rune L2**, **ordinals aligned as L1 parents** (the
`origin` mint — a KRAY star child under a real Bitcoin ordinal), **DeFi / AMM** (as
proven contracts), the **marketplace** (the 2-of-2 atomic `trade`), **inscriptions**,
and **total, deterministic contracts**. It is an Ethereum/Solana-class network — but
**founded on Bitcoin, secured by Bitcoin, carrying Bitcoin's purpose**: sound,
permissionless, no privilege, everything proven. Not a competitor that ignores
Bitcoin — the one that finally extends it, on its own terms.

## The honest trade

This **abandons the Bitcoin-mirror identity** — the poetic "2.1Q, one ₭ per satoshi,
the last ₭ mined with the last satoshi, digital gold." In exchange it gains a modern,
lighter, self-disciplining **fuel + created-stars** model where scarcity and value
live in what people *make*. It is a different soul for the network — chosen with eyes
open, in the dev phase, when the chain can still be reset clean.

## The soul — the network of every instant (atemporal)

KRAYNET does not aim to "last 10,000 years" — a duration still ages and ends. It aims
higher: to be **true at every instant, independent of time.** Atemporal.

- Its truth is **re-derived from the bytes at every instant** — never a fragile past
  you trust, always a whole re-proven *now*. Time does not wear it, because it does
  not depend on time — only on the journal, which anyone re-proves in this moment.
- Its **laws do not change with time** — the axioms and the Supreme Law hold identical
  in every instant. What is true now is true always.
- It has **no schedule that expires** — the pot self-regulates at every instant,
  forever; there is no final date, only the continuous present.
- It is **alive at every instant** — permissionless anchoring and never-freeze mean
  no moment of the history is ever dead or ungovernable.
- **Every instant is sealed into Bitcoin** — the most durable timeline there is; the
  now becomes permanent.

> **KRAYNET does not survive time — it transcends it. The network of every instant.**
