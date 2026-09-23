# THE CLAIM ESCROW — a harvest attested once, taken by the hands inside it

> **Status: built on regtest, dormant on signet and main.** `CLAIM_ESCROW_SEQ` is `0` on regtest and
> `MAX_SAFE_INTEGER` on signet and main: there, every claim act is refused, the pot never fills, no root
> grows and an old-era node freezes rather than forks (A3). Proven by 49 + 672 checks plus a live pass
> through the public HTTP door. Nothing here is live money yet.

The Creator, 2026-09-20:

> *"Tudo que nós criarmos no game vai ser token com prova matemática, ou em runes L2 ou em luz… o objetivo é
> que tenhamos um escrow que possamos fazer isso de forma matematicamente segura: quando o usuário de fato
> conquistar no game a asset, ele pode fazer o claim daquele token."*

---

## 1 · What this proves, and what it cannot

**It cannot prove that somebody watered a bed.** The chain does not see the game, and no mathematics can make
it. Anyone who tells you otherwise is selling a trust relationship with a proof painted on it.

What it does make irrefutable is everything *around* that fact, which is most of what a citizen actually
needs:

* **Who attested** — a BIP-340 signature over the exact root, so the attestation has an author forever.
* **What they attested** — the root is in the signed bytes, so the list cannot be edited afterwards.
* **That the promise is covered** — the whole total leaves the giver's hand at the open, into a keyless pot.
* **That nobody is paid twice** — a hand takes once, and the chain commits who has taken, in order.
* **That nobody is paid more than their leaf**, and by nobody but the pot.
* **That a proven hand cannot be refused** while the pot holds their share.
* **That what no hand claimed** returns only to the giver, and only at the Bitcoin height they named.

**And the attestation itself is checkable by anyone.** A land's farm is a pure reducer over a request log, so
a stranger replays it, recomputes the tally, rebuilds the root and compares. A giver who signs a root their
own journal does not produce is caught by arithmetic, in public, forever. That is the honest shape of a
bridge between a game and a chain: not "trust the land", but *"the land cannot lie without everyone seeing"*.

## 2 · The three acts

| act | who | what it does |
| --- | --- | --- |
| `claim-open` | the giver | signs `(lane, asset, total, root, expires)`; the **total leaves their hand** into `KRAY_CLAIM` |
| `claim-take` | a hand | proves its own leaf against the root and takes exactly that, once |
| `claim-close` | the giver | after `expires`, takes back only what no hand claimed |

Each pays the eternal 1 ₭. A harvest opened with `expires = 0` is **never** closeable: what it holds belongs
to the hands in its root, forever.

**The leaf** is `kray-core.claim.leaf.v1|to=<address>|amount=<n>`, hashed with `block.ts`'s `\x00` leaf
prefix; inner nodes carry `\x01`. The two hash spaces never meet, so an inner node can never be passed off
as a leaf — the classic merkle forgery is not merely refused, it cannot be built.

**The proof rides unsigned.** It is a witness, exactly like an SPV bag: it rebuilds the root or it does not,
so a relay that touches it breaks nothing but its own lie.

**The duplicated last leaf is real** (the old Bitcoin CVE-2012-2459): `[a,b,c]` and `[a,b,c,c]` have the same
root. It buys nothing here — the extra leaf is the same hand for the same amount, and a hand takes once.

## 3 · The pot, and the tripwire

`KRAY_CLAIM` is a keyless label. No key on earth encodes to it, so it can never sign its way out, and
**nothing may credit it** but a signed `claim-open` — a transfer into the pot is refused by name, because a
lie in the pot would halt every honest node.

After every accepted act, `conserves()` now also asks `claimsBacked()`: the pot holds **exactly** what the
open harvests still owe, in every lane and for every asset. A book that promises more than the pot is a lie
already applied; a pot that holds more is value nobody can reach. Either way the honest answer is to stop.

## 4 · Three lanes

`kray` (₭ itself), `luz` (the light of one star), `rune` (one rune of the L2). A farm's tomato does not need
a new token: seal a Luz paper on a star named Tomato and its ✧ **is** the tomato supply — the Creator's own
earlier idea, *"uma estrela tipo lanterna com 2100 luz naquela estrela"*. An egg is another star. A rune is
for when the thing must one day walk out to Bitcoin.

## 4b · For ANY creator — the whole recipe

The escrow knows nothing about farms. It takes a lane, an asset, a total and a root, so a game, a radio, a
school or a shop all use the same three acts and get the same guarantees. One command walks it:

```bash
KRAY_NET=regtest KRAY_DATA=./apps/kray-net/data-lab KRAY_TRUSTED_DEV=1 npm run explorer   # terminal 1
node scripts/claim-season.mjs --demo                             # a Luz season, start to claimed share
node scripts/claim-season.mjs --demo --lane rune --runeId 840000:7 --expires 900000
node scripts/claim-season.mjs --lane luz --supply 100000 --shares my-season.json
```

**① Make the token.** A song, a crop, a badge — seal a Luz paper on a star and its ✧ *is* that token
(`--supply 100000` is the Creator's own shape). Or pay in a rune already etched on the L2 (a music rune, a
game token), or in ₭ itself. Nothing else has to be invented.

**② Attest the list.** `[{to, amount}, …]` — whatever your own rules earned. Its merkle root is what you
sign; the list itself lives wherever you publish it. **Publish it.** A list nobody can read is an
attestation nobody can check.

**③ Open the season.** The whole total leaves your hand into the keyless pot. Name a closing height and what
nobody claims comes back to you at that height; name none and the season belongs to its root forever.

**④ Each hand claims.** They ask any node's proof desk for their path over your published list, sign one
line, and take exactly their leaf — once. Nobody needs your permission again, and you cannot take it back.

## 4c · What an attacker can and cannot do

Attacked with 672 adversarial checks and three seeded storms. Honestly, on both sides of the line:

**Cannot.** Take a share they are not in the root for; take more (or less) than their leaf; borrow another
hand's path; tamper, flip, truncate or pad a path; pass an inner node off as a leaf (the tree is
domain-separated, so that forgery cannot even be built); take twice; replay a winning act; forge a taker;
re-root, re-price or cross-network a signature; put anything into the pot except through a signed open;
make the pot sign; drain a season from another season's pot; close somebody else's season, or their own
before the height they named, or twice. A refused act leaves the books, balances, pot and cascade root
byte-identical — not even a fee moves.

**Can.** A giver can attest a list that is *false* — the chain cannot see your game (§1), and only a
published log makes that checkable. A giver can open a season whose total is smaller than the sum of its
leaves: the law pays leaves until the escrow is gone and then refuses the rest, so the last hands get
nothing (it is bounded and visible in `/api/kraynet/claims`, never a partial payment). And a season opened
with a closing height is revocable by its giver at that height, by design.

**One root, one escrow, forever.** The same list cannot be opened twice — which is also why a real season
should carry something unique to it (an epoch number in the amounts, or a distinct cast).

## 5 · How to test it

```bash
cd ~/ai-projects/kray-network/apps/kray-core
node src/test/claim-escrow.test.ts               #  49 · open · take · close · three lanes · the pin · replay
node src/test/claim-escrow-adversarial.test.ts   # 672 · the proof, the signature, the pot, the close + 3 storms
node src/test/packet-door.itest.ts               #  93 · including a whole harvest through the real HTTP door
```

Through a live bench, the way a wallet would:

```bash
KRAY_NET=regtest KRAY_DATA=./apps/kray-net/data-lab KRAY_TRUSTED_DEV=1 npm run explorer
curl -s localhost:4477/api/kraynet/claims | jq                     # every open harvest, and whether the pot is backed
curl -s -X POST localhost:4477/api/kraynet/claim/proof \
  -H 'content-type: application/json' \
  -d '{"shares":[{"to":"bcrt1p…","amount":"120"}],"to":"bcrt1p…"}' # the desk builds a root and a path, and stores nothing
```

The proof desk is pure arithmetic over a list **the caller brings**. The node keeps no harvest list and
learns nothing from being asked — the list lives wherever the giver published it.

## 6 · What the world still has to build

The chain half is done. KRAYVERSE's half is not, and it is the part that makes the attestation checkable:

1. **The farm must count by address.** Today `stock.produce` is communal and the keeper's receipts record
   only `by`, `id` and `revision` — enough to stop a replay, not enough to say who grew what.
2. **The request log must be published** (or its root inscribed), so a stranger can replay the land's own
   pure reducer and rebuild the same tally.
3. **Then the owner opens one harvest per epoch** with that root, and every player claims their own leaf.

Until 1 and 2 exist, a claim is still honest — but its attestation rests on the land owner's word rather
than on arithmetic anyone can redo. Say so plainly wherever it is offered.
