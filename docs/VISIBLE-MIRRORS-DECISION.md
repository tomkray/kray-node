# Visible mirrors on /network — decision brief (CANDIDATE, not ratified)

> **Status: PARKED by the Creator (2026-08-28) — "guardado, decidimos depois".**
> Nothing is built. Nothing on the live map changed. This note exists so the
> design is not re-argued from zero when the decision returns.

## The ask (Creator, 2026-08-28)

`/network` shows the writer, the presence beacons and a deliberately inert
"countless followers" fog. The Creator wants the map to also show **how many
full-node followers exist** — as authority ("≥ N mirrors verifying") and as a
richer three.js scene (new color, weight-bucketed sizes) — **without** hurting
follower anonymity, without breaking anything live, and without betraying the
decentralization idea.

## The conflict this touches (why it is parked, not just built)

- `network.html` carries a **council-locked DATA LAW**: the follower field is a
  fixed, semantically-inert fog — *never a count, topology, or magnitude, never
  `/peers`*. Sizes are bucketed and angles shuffled so the scene is never a
  target ranking.
- The public page promises: *"we do not count them, and never will."*
  Shipping any count means rewording that promise honestly.
- A true total is **unknowable by design** (a follower is just someone who
  pulled the journal; NAT/VPN make IP counting a lie in both directions).

## The agreed shape, if ratified (opt-in floor — never a census)

1. **Follow flag, default OFF** (e.g. `--hello`): the follower volunteers a
   heartbeat signed by an **ephemeral key generated in its follower dir** —
   message domain-separated + network-labelled, carrying head `seq`/root and
   whether it serves the rune book. Silent followers stay exactly as today.
2. **Writer door**: verifies the signature, keeps an in-memory TTL map keyed by
   pubkey. **No IP stored, no IP shown, no location.** Exposes only the
   aggregate: `{ count, freshness buckets }` — pubkeys never listed.
3. **Map layer**: new color for visible mirrors; sizes in 3–4 honest buckets
   (head freshness / atlas / rune book), shuffled angles; **the fog stays** for
   the silent majority. Legend: *"≥ N visible mirrors · opt-in floor, not a
   census · identity is free — not sybil-resistant"* (same honest pattern as
   presence beacons).
4. **Text change**: *"never will"* → *"we count only volunteers; the silent
   are uncountable by design — on purpose."*
5. Purely additive: no journal write, no reducer touch, no consensus change.
   Order: lab `:4477` → Signet → ship rite.

## Creator's ratification conditions (his words, 2026-08-28)

- Only if truly safe; **nothing that already works may break**.
- Real security + anonymity for followers running full nodes.
- Nothing that goes against decentralization or the idea.

## Discarded branches (do not revisit)

- **Passive IP census** — invented number (NAT/VPN) + surveillance posture;
  attackable, and a debunked count costs more authority than the fog ever did.
- **Listing pubkeys / per-node detail** — a target list; aggregate only.
- **Fine-grained size by weight** — ranking = biggest-fish-first target map;
  buckets only, angles shuffled.

## When the decision returns

Re-read this file, confirm the conditions above still hold, then cut the slice
exam-first (bad signature refused · TTL expiry · no-IP invariant · aggregate
shape golden) before any map pixel changes.
