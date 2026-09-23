# THE DROP AND THE PACKET MARKET

> **Status: built on regtest, dormant on signet and main.** The consensus law is in the reducer, proven by
> 1,548 checks across five files (below), including three seeded storms and a live pass through the public
> HTTP door. The activation pins `GIFT_LISTING_SEQ` and `PACKET_MARKET_SEQ` are `0` on regtest and
> `MAX_SAFE_INTEGER` on signet and main: until a fleet ratifies its sequence, every act of this law is
> refused there, nothing mutates and no root grows. Nothing here is live money yet.

The Creator, 2026-09-19:

> *"não precisa ser fork, nem nada — já temos o market funcionando no reducer. É só listar algo por valor 0,
> daí vai pagar normalmente 1 KRAY de gas pra listar, tudo mantém o mesmo. Só que do outro lado a pessoa que
> for comprar, ela paga o gas e não paga valor, porque o valor foi 0. Isso é um drop, um escrow."*

That sentence is the whole design. There is no new escrow contract, no new star, no new token and no fork:
**a listing at price zero IS the drop.** Everything below is that one idea, made exact.

---

## 1 · The law in one line

> A listing is a signed offer. A take applies both legs in one reducer step or the act is refused. A price of
> **zero** makes the take a gift: the taker pays the eternal 1 ₭ of gas and no price.

Nothing about the market's shape changes. The lister pays the eternal 1 ₭ like any act. The taker pays the
eternal 1 ₭ like any act. The only thing that is new is that the price may be `0`, and that an offer may
carry **terms** saying whose hand may close it.

## 2 · The three terms — who may take it, and when

All three are optional, all three are **signed into the offer**, and all three are re-proven **at the instant
of the take**, never at the instant of the offer. A relay can neither add, strip nor rewrite one: the signed
line carries each field (empty when absent), so any tampering changes the bytes and the signature fails.

| term | meaning | what it makes possible |
| --- | --- | --- |
| `to` | only this address may take it | a private drop, a whitelist of one, a named sale |
| `gate` | only whoever **holds that star** may take it | the right travels with the star, not with a name |
| `notBefore` | not until Bitcoin reaches that height | the bequest: it opens on the chain's own clock |

They are **AND**: an offer carrying all three opens only for the named address, only while it holds the key
star, and only after the height. `gate` is a star number, so an L1 ordinal gates too — it becomes a star
through `origin`. Star `#0` is a real star, so an absent gate is the **absent field**, never the number zero.

**A term is read only when it is well formed; otherwise it is absent.** This is not leniency, it is what
shuts the relay's last door. The signed line renders an ill-formed height exactly as it renders no height at
all (`notBefore=0`), so a law that branched on the raw field could be used to kill somebody's honest,
correctly signed act by appending `notBefore: -1` to it in flight — no signature broken, the act simply
refused. Read once, well formed or absent: a malformed addition is inert, and a well-formed one changes the
line so the signature fails. **The public door is the opposite**, and deliberately so: a citizen who asks for
a term and is handed silence would be robbed by their own wallet, so the door refuses an ill-formed term by
name, up front, rather than letting a bequest fall through as a drop anyone can take.

**A pot can never be named.** A `to` that is a protocol pot is refused: a pot has no key, so it could never
take the offer — and `KRAY_` labels skip the address charset check, which would let a name carrying the
book's own separators make two different markets write the same committed line. The root must name one
market.

**The clock is the journal's own sealed Bitcoin height**, on every network — not the ADR-3 window height,
which only moves where that regime is active and would have left every bequest sealed shut on the one
network where this law is switched on.

**The testament.** A holder lists a packet of runes (or ₭, or Luz, or a star) at price 0, named `to` the
heir, with `notBefore` set to a Bitcoin height in the future. While they live they may delist it or push the
height forward. After that height the heir — and only the heir — closes it for the price of gas. The proof
is the chain's own seals; no executor, no oracle, no trusted party.

## 3 · The packet market — the same law for the things that are not stars

The star market moves one star. The **packet market** moves a whole quantity of one fungible thing:

| lane | asset | the book it lives in | the field it rides on |
| --- | --- | --- | --- |
| `kray` | ₭ itself | `balances` | none |
| `luz` | the ✧ of **one** star | `cuts` (per star, per holder) | `star` |
| `rune` | one rune of the L2 (FENYX included) | `runes` | `runeId` |

A lane carries **its own asset field and no other** — a star smuggled onto a ₭ packet is refused by name, so
one act has exactly one shape. A rune id must be canonical (`840000:7`, never `0840000:7`): one spelling,
one signed line, one key.

Three acts: `packet-list`, `packet-delist`, `packet-take`. One live listing per `(lane, asset, seller)` —
re-listing edits that one offer instead of breeding twins.

**Whole packets only.** A take is all or nothing. No partial fill means no rounding, no residue, and no race
between two takers over one listing: the first take consumes it, the second finds nothing.

**Ӿ is deliberately absent.** Its transfers are still dormant and carry their own fee law (the Fireborn
tank), so it will enter the market as its own slice, never by widening this one quietly.

## 4 · Why there is no custody pot

A star can only be held whole, so a lien over it is exact — that is why `star-list` never moved the star. A
balance can be spent while an offer stands, so the packet market **re-proves the holding at the moment of the
take** and refuses when the packet is no longer there. A refused take moves nothing at all, not even a fee.

This is a deliberate trade, and its consequences are stated honestly:

* **What it buys.** The market stays outside Σ: no pot, no new value-bearing address, no conservation
  surface. The worst a bug in this code can do is fail a take. It can never touch the money supply.
* **What it costs.** A listing is a standing offer, not a vault. A seller who spends what they offered leaves
  a listing that refuses every take until they refill or delist. Nothing is lost but the attempt.
* **Why a bequest is better for it.** The giver goes on living off their own balance; the heir takes what is
  actually there when the height opens. An escrow would have entombed the money while the giver still lived.

## 5 · The bytes

Every line is domain-separated, network-labelled and nonced. Terms are always present in the line — empty
when absent — so an offer with no terms and an offer whose terms were stripped are **different bytes**.

```
kray-core.star-list.v1|net=|from=|star=|price=|nonce=                              (an offer with no terms)
kray-core.star-list.v2|net=|from=|star=|price=|to=|gate=|notBefore=|nonce=         (an offer with terms)
kray-core.packet-list.v1|net=|from=|lane=|asset=|amount=|price=|to=|gate=|notBefore=|nonce=
kray-core.packet-delist.v1|net=|from=|lane=|asset=|nonce=
kray-core.packet-take.v1|net=|from=|seller=|lane=|asset=|amount=|price=|nonce=
```

**The signed line is a function of the act alone — never of an activation pin.** This is the hard-won rule of
this work. The reducer and the signed-bytes mirror (`signed-message.ts`) build every line from the same
reader, and the referee re-proves their equality on every apply and every replay, fail-closed. A message that
depended on a pin would make two honest nodes disagree about what was signed the moment one of them was
configured differently. The **pin decides admission, the act decides its bytes.**

## 5b · The door has laws of its own

The reducer is the law; the public door is where a citizen meets it. Attacking that door produced four rules
it now keeps, none of which touch consensus:

* **Read the raw value, never `String(x)` or `Number(x)`.** Those launder a hostile body into a line the
  citizen never meant: a JSON number beyond the safe integers rounds, `true` becomes the height 1, `"0x10"`
  becomes 16, a one-element list becomes its join. The door reads with the reducer's own "typeof first" law,
  and bounds a number of base units at 40 digits — the widest a u128 rune amount can be, so an honest packet
  passes and a megabyte of digits (a free freeze of the node) does not.
* **Read every spelling the node itself publishes.** `/api/kraynet/market` publishes the key star as `gate`
  while the write door read only `gateStar`, so a client that handed a row straight back lost the condition
  IN SILENCE and a stranger could take the star. Both names are read now, and naming both differently is
  refused rather than guessed.
* **Ask the pin before inviting a signature.** On a network where the law is shut, preparing the act spends
  a citizen's effort on something no node will ever apply. The door asks the same pin the reducer enforces.
* **A view must not promise what the chain forbids.** `fillable` now accounts for the offer's height, and a
  listing with a name, a key star or a waiting height says so where a "Buy now" button used to be.

## 5c · What this law does NOT protect you from

Four adversaries attacked this design and the ones below are the findings that are **properties, not bugs**.
They are written here because a citizen who does not know them can be hurt by them, and because each has a
remedy the law already offers.

**An open drop is a race, and the race can be bought.** A listing at price 0 with no name and no key goes to
whoever signs first, and "first" among acts in the same instant is decided by the hash of the signed bytes.
A taker's own address is part of those bytes and a fresh keypair is free, so an attacker can grind addresses
offline until theirs sorts first. Measured on one core: 300,000 tries in 142 seconds beat a field of 200
honest takers, and took a 5,000 ₭ drop for 3 ₭. Setting a `notBefore` makes it worse, not better — the
opening moment is public, so the grinding happens before the race. **The remedy is in the law already:** name
the taker with `to`, or gate it with a star. A drop meant for one person should say so.

**A key star is a bearer instrument, and bearing it is what counts.** `gate` opens for whoever holds that
star *at the instant of the take* — including someone who borrowed it for that instant. A star can be sold
and sold back in three acts, so a gated offer can be harvested by a stranger who holds the key for one
breath and returns it. Worse, the key's holder can redirect or destroy offers they never made: sending the
star to a confederate hands them every offer gated on it, and sending it to the black hole makes every such
offer unfillable forever, for one ₭ and nobody's consent. **The remedy:** gate on a star you hold yourself,
or whose holder you would trust with the thing you are giving away. If you mean a person, name them.

**A bequest waits on the writer's seals, not on Bitcoin directly.** `notBefore` is compared against the
highest Bitcoin height any seal in this journal has carried. Seals are how the chain learns the time, so a
writer that stops sealing stalls every bequest, and one that seals a height early opens them. On signet and
main a seal must also bind a produced root and is re-proven by any follower running its own bitcoind, so a
lie is caught — but caught *after* the taking. And the giver may still delist at any moment, including after
the height lands: this law makes a bequest revocable by design, because the giver is alive until they are
not. **If you need it irrevocable, this is not yet that instrument.**

**The listing fee and the ₭ lane share a balance.** A ₭ offer now must be covered by `amount + fee`, so it
can no longer be born dead — but any later 1 ₭ act by the seller still lowers the balance behind a standing
offer. That is the price of holding no custody, and it is why a take re-proves the holding.

**Nothing prunes a book.** Only a lister may sweep their own line, and a drop whose whole value is 1 ₭ pays
its taker exactly nothing, so nobody will ever sweep it. The cost of a dead line is now bounded — a number
in a book is at most 40 digits, and the committed line is remembered rather than rebuilt for every act — but
the line itself stays until its author removes it.

**One more, in a law this change did not write — now CLOSED (2026-09-20).** The same-instant order key was
`sha256` of the signed bytes, and `requireSig` appends an opt-in `|deadline=D` with no upper bound. `D` moves
no value, so one author could regrind their own key freely — measured, a *single* try can already drag a
rival under an honest act, and a handful beats a field of a thousand. Where allocation is a race, that is the
difference between arithmetic and a rigged queue.

The order key is now the canonical message **alone**, under `DEADLINE_FREE_ORDER_SEQ`. The signature still
covers the deadline, and the **inclusion SMT leaf is still keyed on the signed bytes**, so no anchored root
moves — proven directly: the same journal carrying deadlines produces the identical cascade root on both
sides of the pin. A same-instant run never spans the pin: keys from the two eras are not comparable, so the
boundary closes the run exactly as a new millisecond does. Proof: `src/test/deadline-grind.test.ts` (15
checks — it grinds the attack, shows the old law *accepting the theft and refusing the honest order*, then
shows the pin refusing it).

## 6 · The pins, and what an old node does

| pin | regtest | signet | main | lives in |
| --- | --- | --- | --- | --- |
| `GIFT_LISTING_SEQ` | `0` | **`231`** | `MAX` | `protocol/star-market.ts` |
| `PACKET_MARKET_SEQ` | `0` | **`231`** | `MAX` | `protocol/packet-market.ts` |
| `CLAIM_ESCROW_SEQ` | `0` | **`231`** | `MAX` | `protocol/claim-book.ts` |
| `DEADLINE_FREE_ORDER_SEQ` | `0` | **`231`** | `MAX` | `protocol/ledger.ts` |

**RATIFIED ON SIGNET, 2026-09-21.** Its tip was 230, so 231 — the house's own rite, the same tip+1 that
`POT_BINDING_SEQ` took three days earlier (signet 226→227, main 81→82). Opening at the tip's next act makes
the activation one explicit, auditable instant in the journal.

**Main stays shut, deliberately.** A law is proven alive on the test universe before it is opened where a
mistake costs somebody's real value. Signet is a test network; mainnet is not. Main opens in its own
release, after signet has carried a harvest end to end — farmed, published, rooted, signed, claimed.

**Everything was already on this code before the pins moved.** All five houses — the Origin writer, the
three guardians, the signet writer — were updated and verified first, so no node can meet an act it cannot
read. The pre-flight ran again with the pins flipped: both chains still re-derive byte for byte (main
81/81 root `af2bd8a3…`, signet 230/230 root `c1461ab2…`), because every act below a pin is untouched by it.

**The coupling is now a number, not a sentence.** `activation-seq-pin.test.ts` asserts on every network that
`DEADLINE_FREE_ORDER_SEQ ≤` each of the three market pins. A market opened over a grindable tiebreak is a
rigged queue with a proof attached, and a sentence in a document does not stop that — a failing test does.

Below its pin, an offer at price zero, an offer carrying terms, and every packet act are **refused**. Nothing
mutates, so no root grows and no history can replay differently (A3). An old-era node that meets one of these
acts after activation **freezes** rather than forking — the house law, unchanged.

Both books fold into the cascade root **by presence**: with no listing the field is absent, so every root
anchored before this law opens byte-identically. `packetCommitment` is appended last.

## 7 · Before DEPLOYING this code, and before flipping a pin

The first check belongs to the **deploy**, not to the flip. `gateStar` and `notBefore` are new field names no
earlier act could hold, but `to` is a field the event always had: a historical `star-list` that happened to
carry one was accepted by the old law, which ignored it, and is refused by this one. Such a line would stop an
upgraded node from replaying its own journal at boot, before any pin is flipped. Today's writer never emitted
one — the public door's `star-list` carried only `{star, price}` — and every journal reachable when this
shipped was verified clean. Verify it again, on the writer itself.

0. **The deadline grinder is closed in the law; now decide its pin.** `DEADLINE_FREE_ORDER_SEQ` is `0` on
   regtest and `MAX` on signet and main. It must be at/below the seq where the market opens, or a drop's
   allocation is still decided by a key one author can regrind at will (see §5c). Its pre-flight is one
   grep, on the writer itself — the new key differs from the old one ONLY for an act that carried a deadline:

   ```bash
   J=<data-dir>/kraynet-journal-main.jsonl          # or -signet
   grep -c '"deadline"' "$J"                        # 0 → the pin may be born at 0, byte-identical to today
   ```

   With `0`, set signet and main to `0` and the law is inert on all history. With any hit, pin it at a future
   seq past the tip (the `149→155` deploy-rite discipline) and note that acts below it keep the old key.

   **THE STRONGEST FORM OF THIS CHECK IS NOT A GREP — IT IS A REPLAY.** `scripts/cold-replay.mjs` pulls
   every content-addressed chunk from each live node, re-hashes it against the address that node published
   (so a lying server is caught before a line is read), and feeds the whole journal from an EMPTY ledger
   through `openKrayLedger` — the same opener every node uses. Run 2026-09-20 on this code:

   | network | events replayed | live cascade root | verdict |
   | --- | --- | --- | --- |
   | main | 81 / 81 | `af2bd8a3e0c878d8…` | re-derived byte for byte |
   | signet | 230 / 230 | `c1461ab2980b99fd…` | re-derived byte for byte |

   A grep says "no act carries the field this law changes". A replay says "this code IS the code that wrote
   your chain". Run it on the day of the deploy; a journal only grows.

   **ALREADY RUN, 2026-09-20, against the live journals themselves** — not a projection of them. Every
   content-addressed chunk was pulled from each node and re-hashed against the address that node published,
   so a lying server would have been caught before a single line was read:

   | network | events | signed | with a `deadline` | market acts | `star-list` with a term |
   | --- | --- | --- | --- | --- | --- |
   | main | 81 | 74 | **0** | 0 | **0** |
   | signet | 230 | 198 | **0** | 14 (`star-list`, `star-buy`, `star-delist`, `star-like`) | **0** |

   Both journals replay under this code, and `DEADLINE_FREE_ORDER_SEQ` may be born at `0` on both networks.
   Re-run it on the day of the deploy (`scripts/preflight-deadline.mjs`): a journal only grows.

   **THE COUPLING, because it is the kind of thing that gets forgotten:** the grinder only pays where
   allocation is a race, which is exactly what the market opens. **Whoever flips `GIFT_LISTING_SEQ` or
   `PACKET_MARKET_SEQ` on a network MUST flip `DEADLINE_FREE_ORDER_SEQ` on it in the same release**, at a
   seq at or below theirs. A market opened over a grindable tiebreak is a rigged queue with a proof attached.
1. **Prove the journal is clean.** Confirm no `star-list` already carries `to`, `gateStar` or `notBefore`,
   and that no `packet-*` act exists. Today's writer cannot emit one, so this is a confirmation, not a hope —
   but confirm it, on the writer itself, against that network's own journal:

   ```bash
   J=<data-dir>/kraynet-journal-main.jsonl          # or -signet
   grep '"kind":"star-list"' "$J" | grep -cE '"(to|gateStar|notBefore)":'   # must print 0
   grep -cE '"kind":"packet-(list|delist|take)"' "$J"                        # must print 0
   ```
2. **Run the whole fleet on this code first** — every writer, follower, guardian and pen. A node that has not
   adopted it will freeze at the first act, which is the intended, safe failure.
3. **Choose a future sequence** for that network and set it in the table. Never an env var: it is consensus.
4. **Rehearse on regtest at that exact sequence**, including the below-the-pin refusals.

## 8 · How to test it

```bash
cd ~/ai-projects/kray-network/apps/kray-core

# the law itself — the reducer, every attack, three seeded storms with replay twins
node src/test/star-market.test.ts              # 121 · list · delist · atomic buy · terms · fold by presence
node src/test/star-gift-adversarial.test.ts    # 612 · the gift and its three terms, attacked every way
node src/test/packet-market.test.ts            #  58 · three lanes, Porta 2, the backing gate, the bequest opening
node src/test/packet-market-adversarial.test.ts#  722 · every field, every lane, every hand + 3 storms

# the wired link — boots server.mjs on a throwaway port and drives prepare → sign → submit
node src/test/packet-door.itest.ts             #  35 · the drop, the heir, the key star, the height, the ₭ packet

# everything, the way a release is judged
cd ~/ai-projects/kray-network && npm test && npm run test:all
```

To drive it by hand on a long-lived bench:

```bash
KRAY_NET=regtest KRAY_DATA=./apps/kray-net/data-lab KRAY_TRUSTED_DEV=1 npm run explorer
curl -s localhost:4477/api/kraynet/packets | jq          # what is on offer, and whether it is still fillable
curl -s localhost:4477/api/kraynet/market  | jq '.listings[] | select(.drop)'   # the drops
```

`KRAY_TRUSTED_DEV=1` opens the dev mint so a lab wallet can be funded without a real Bitcoin burn. It is a
throwaway-regtest switch and nothing else — never set it on signet or main.

## 9 · What this opens

A drop left on the ground of a KRAYVERSE land is a listing at price 0 whose taker is whoever signs first. A
whitelist is a series of named offers. An inheritance is a named offer with a height. A key-gated reward is
an offer gated by a star. A shop that pays in runes is a packet listing at a price. None of it needs a new
contract, a new token, or a single line of trust — it is the market that already existed, told that zero is
a price like any other.
