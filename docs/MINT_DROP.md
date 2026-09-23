# The mint drop — N equal pots, one per hand, nobody named in advance

> *"fazer drops tipo mint, várias wallets podem pegar um pedaço do drop — porém cada wallet
> address só poderá mintar 1 pote, jamais duplica um pot por mint."* — the Creator, 2026-09-22

**Status: BUILT on 2026-09-22, PINNED SHUT on both live networks.** Protocol, reducer, door, suites and
the mint stampede are green; `MINT_DROP_SEQ` is MAX on signet and main, so nothing can be opened yet.

## The Oração

> Given a keyless pot that already refuses to pay one hand twice (`ClaimBook.taken`), and a
> giver who knows *how much each* and *how many* but not *who* — commit the TERMS instead of
> the NAMES, and let any hand that has not taken take exactly one pot while pots remain, so a
> public mint is the same law as a harvest with the list removed.

## Why it cannot be expressed today

| primitive | why it does not say this |
|---|---|
| **drop** (`price 0` listing) | one listing, one taker, all of it — nothing stops the same hand taking every one |
| **harvest** (`claim-*`) | the root commits a list of NAMES; you cannot name tomorrow's player |

The missing idea is **a harvest whose root commits terms rather than names**.

## What it reuses, unchanged

Everything expensive is already law and already proven by the market swarm:

- `KRAY_CLAIM` — the keyless pot no signature can reach
- `taken: root → Set<address>` — *one hand, one taking, forever*. This IS "jamais duplica".
- `takenChain` — the order-dependent hash of who took, already inside the consensus commitment
- `claim-close` — the giver recovers the remainder after the Bitcoin height they named
- conservation-or-HALT, the eternal 1-₭ fee, the nonce, the same-instant order

## The three new things

1. `perHand` — what one pot pays
2. `hands` — how many pots exist (`total = perHand × hands`, and the whole total leaves at open)
3. no list, no Merkle proof — *whoever has not taken and arrives while pots remain*

## Identity: the root commits the terms

A harvest's root is a Merkle root over leaves. A mint's root is a hash of its own terms, under
its **own domain string**, so the two can never collide inside the one `open` map:

```
mintRoot = sha256(
  "kray-core.mint.id.v1|net=<net>|giver=<addr>|lane=<lane>|asset=<asset>"
  + "|perHand=<n>|hands=<n>|gate=<none|star:N|childOf:N>|nonce=<n>"
)
```

Self-proving: anybody recomputes the id from the terms and checks the chain holds it. The
`nonce` is what lets the same terms be opened again after the first is closed.

**Why it can never collide with a harvest root.** Not merely "a different domain string" —
the Merkle construction in `block.ts` prefixes every hash it takes: `hashLeaf = H('\x00' + raw)`
and `hashNode = H('\x01' + a + b)`. So EVERY harvest root is `sha256` of a preimage whose first
byte is `0x00` or `0x01`. A mint id is `sha256` of a preimage whose first byte is `'k'` (0x6b).
The two preimage spaces are disjoint **by construction**, in their first byte — there is no
structured collision to find, only a raw sha256 break, which would end Bitcoin first.

## The acts

```
kray-core.mint-open.v1 |net=|from=|lane=|asset=|perHand=|hands=|gate=|expires=|nonce=
kray-core.mint-take.v1 |net=|from=|root=|star=|nonce=
kray-core.claim-close.v1                                  ← REUSED, unchanged
```

**`mint-take` does not carry an amount.** It cannot be haggled: the amount is fixed by the
terms the giver signed. A taker signs *"I take my one pot from this mint"*, nothing more.
`star=` is present only when the mint is gated, and names the star the taker claims to hold.

### What `mint-take` checks, in order

```
the eternal 1-₭ fee, exactly one
seq ≥ MINT_DROP_SEQ[net]                       ← below the pin the act does not exist
the taker is not a protocol pot
a mint is open at that root
this hand has NOT taken                        ← ClaimBook.hasTaken — the whole point
taken.size < hands                             ← the cap
the gate, if any (below)
the pot holds perHand of that lane/asset, or HALT
```

## The gate — the honest answer to sybil

**One per address is not one per person.** Anybody makes addresses; the cost of a second pot
is 1 ₭ plus a funded key. That is true of every Runes mint on Bitcoin and it is true here. The
mathematics proves *one per address* — that is exactly what it can prove, and we must never
call it more.

So the gate is the real defence, and it is what makes this useful to a world-builder:

| gate | law | what it means in KRAYVERSE |
|---|---|---|
| `none` | anyone | a public faucet, sybil-open |
| `star:N` | `stars.ownerOf(N) === taker` | one specific holder — the packet market's existing gate |
| `childOf:N` | `ownerOf(star) === taker && parentOf(star) === N` | **anyone who owns a plot in my land** |

`childOf` is the one a game wants, and it is O(1): the taker NAMES the star they hold and the
reducer verifies ownership and parentage — no scan, no unbounded work. `parentOf`/`childrenOf`
already exist in `starmap.ts`.

A gated mint is not sybil-proof either — it is sybil-*priced*: an extra pot now costs a plot.

## The commitment — folded by presence

The line is, today:

```
root|giver|lane|asset|total|paid|expires|takenChain|hand
```

A mint appends its terms; a plain harvest appends nothing:

```
…|takenChain|hand                          ← every harvest that exists today, byte-identical
…|takenChain|hand|mint=<perHand>x<hands>|gate=<…>
```

So a node replaying a chain with no mints produces **exactly the bytes it produces now**. The
five live signet harvests and their 242/242 cold replay cannot move. This is the same fold-by-
presence that let the claim book enter the cascade root without a fork.

## The pins (A3 — freeze, never fork)

```ts
export const MINT_DROP_SEQ: Record<string, number> = {
  regtest: 0,
  signet:  <the seq at ratification>,
  main:    Number.MAX_SAFE_INTEGER,
}
```

**Mainnet has never opened a harvest or a drop** (seq 81, `CLAIM_ESCROW_SEQ.main = MAX`, zero
listings, zero harvests). So mainnet does not migrate into this — when its market is finally
opened, `PACKET_MARKET_SEQ`, `CLAIM_ESCROW_SEQ` and `MINT_DROP_SEQ` are set to **the same
seq**, and the network begins with the whole law at once. There is no before.

Signet does have history, which is exactly what fold-by-presence protects.

**The coupling to hold, and to test:** `DEADLINE_FREE_ORDER_SEQ ≤ MINT_DROP_SEQ`, on every
network — the same pin test that already guards the other three.

## The attack surface, named

| attack | what stops it |
|---|---|
| one hand takes every pot | `hasTaken` — the same set that already survives an 8-way stampede |
| a hand takes more than a pot | the amount is not a signed parameter; it comes from the terms |
| a mint promises what the giver has not got | the whole total leaves at open, as a harvest does |
| the same terms opened twice over one pot | `that harvest is already open — one root, one escrow` |
| a mint id colliding with a harvest root | disjoint preimages **by construction**: a Merkle root's preimage starts `0x00`/`0x01`, a mint id's starts `'k'` |
| the cap read from a stale view | the cap is `taken.size` in the reducer; the door's view is only a view |
| an old node forking on a mint it cannot read | `MINT_DROP_SEQ` — below it the act is refused; an old node FREEZES |
| a gate on a star that cannot change hands | the packet market's existing guards: must exist, must not be frozen |
| **sybil** | **NOT stopped.** Priced by the gate, never prevented. Say so, always. |

## What must be proven before it ships

- the reducer suites: open, take, close, adversarial, and a **mint stampede** (N+K hands racing
  for N pots — exactly N are paid, the rest refused, the pot lands on zero)
- fold-by-presence: a chain with no mints hashes byte-identically before and after the code
- the pin test: below the pin every mint act is refused, on every network
- cold replay of both live chains, byte for byte, on the new code
- the door (`packet-door.itest`): the line the wallet is told to sign is the line the law verifies

## The three decisions, derived — RESOLVED 2026-09-22

The Creator: *"vamos seguir o padrão matematicamente prova perfeita, o que a ressonância
recomenda."* So each is derived from the axioms, not chosen by taste. Two of them overturn
what this document recommended in its first draft.

### 1. `expires = 0` is REFUSED on a mint. (was: "allow it, warn loudly")

A harvest may name no closing height because its law then reads: *what it holds belongs to
the hands in its root, forever.* That sentence is TRUE for a harvest — the hands are named, so
identifiable people are entitled forever and may come at any time.

**For a mint there are no hands in the root.** If three of ten pots are taken and the height is
zero, the other seven belong to nobody, entitle nobody, and can never move. That is not a
promise kept forever; it is value destroyed by an accident of configuration — and we have the
live proof of the shape: 15 ₭ on signet, stranded by `expires = 0` plus a lost list.

The foundation this system rests on is that energy reaches whoever creates utility and is
never quietly extracted or destroyed. A mode whose only possible outcome, when underused, is
silent destruction does not belong in the law. **A mint names a Bitcoin height, always.**
Warning about a trap is weaker than not building the trap.

### 2. `hands` reuses `CLAIM_MAX_HANDS` (100,000).

Not because memory demands it — a mint's `Set` grows one entry per ACTUAL taker, and the
economics already bound the declaration (`total = perHand × hands` must leave the giver's hand
at open, so `hands` is capped by what they hold, and `MAX_BOOK_DIGITS` caps the arithmetic).

The reason is **one book, one ceiling**. A second, different bound on the same `ClaimBook`
would be a seam, and a seam is where the bug lives. Also enforced: `perHand ≥ 1`, `hands ≥ 1`,
and `total` computed in BigInt as exactly `perHand × hands` — never supplied, never trusted.

### 3. Gates in v1: `none` and `childOf:N`. `star:N` is REFUSED for a mint. (was: "all three")

`star:N` means *only whoever holds star N*. That is one address. A mint gated to one address
with `hands > 1` can, by arithmetic, never pay out more than one pot — every other pot is
guaranteed unclaimable from the instant it is signed.

The law must not let you build something whose waste is provable at the moment of building.
So: `none` (public) and `childOf:N` (anyone holding a plot of land N) ship together — a gate
added later is a second law, a second pin and a second fold — and `star:N` is refused with its
own sentence, naming why.

### What this does NOT change

The sybil statement stands exactly as written above. `childOf` prices a second pot at a second
plot. It does not prevent one.

## Sequencing note

This extends `ClaimBook`, not the packet market. The lane arithmetic it inherits — ₭, Luz of a
star, an L2 rune — was proven live on signet 2026-09-22 (21/21 + closed-supply conservation:
1,200 + 98,700 + 100 = 100,000 exactly). The drops floor is a different book. **The drop test
is not a prerequisite for this work**, which was a wrong call in this document's first draft.


## What the build revealed (2026-09-22)

Four things the design did not know until it was written:

1. **There is a THIRD gate, and it is not in `assertMarketDoor`.** `node.ts` keeps a `USER_KINDS`
   allowlist — an act absent from it is refused with *"is not a submittable user action"* before any
   pin is consulted. So a new act must be named in FOUR places or it silently does not exist:
   `KrayEventKind`, `USER_KINDS`, `assertMarketDoor`'s pin mirror, and the two door switches.

2. **`prepare` and `submit` must read the wire through ONE function.** They build the line to sign and
   the event to apply from the same body; if they coerce it differently by one step, the wallet signs
   one thing and the law verifies another. `doorMintTerms()` exists so neither parses the body itself.

3. **The pin test refuses an orphan, and it is right to.** `MINT_DROP_SEQ` failed
   `activation-seq-pin` twice before it was law: once as an ORPHAN SEQ (a pin not in the GOLDEN catalog
   is not a pin), and once for changing the constructor's positional order. Both were updated with
   intent, and the mint was added to the market coupling — `DEADLINE_FREE_ORDER_SEQ ≤ MINT_DROP_SEQ`
   is now checked on every network, every run.

4. **The reducer HALTs on an unknown kind** rather than skipping it — seen live while writing the
   suite. That is A3 working: an old node freezes on a mint it cannot read, it does not fork past it.

## A note the Creator raised, kept for later

> *"esse mint não deveria ter o parâmetro lá quando criamos uma Luz também? aí ficaríamos com o
> parâmetro de mint igual o runes."*

He is right that Luz already carries creation-time terms: `compileCut` in `star-forms.ts` takes
`supply`, `infinite`, `founders` and `rain`, and `MAX_CUT_SUPPLY` is 10,000,000. So a Luz IS etched with
its economics, Runes-style — including an `infinite` mode.

That is a DIFFERENT primitive from this one, and the difference is conservation:

- **this mint distributes** value that already exists and already left the giver's hand. Σ is invariant
  at every step, which is the Supreme Law's easiest case.
- **an etched mint would EMIT** — units coming into existence as hands mint them. That is emission, the
  most dangerous thing a chain does, and it needs the cap in consensus at creation, a count checked
  against it forever, and a supply that moves over time.

The Creator set it aside because the escrow mint is what L2 runes need. Recorded here so the idea is
not lost: **an etched mint on the Luz law is a second design, not an extension of this one.**
