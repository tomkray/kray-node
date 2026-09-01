# WHITEPAPER

**Parent:** `kray`
**Action:** Explain the whole machine to any person, forever.

This page is the entire network, told once, in plain words. If you
read nothing else, read this. If you doubt anything here, do not
believe it — verify it. That is the point of the whole design.

## The one law

Nothing exists here unless mathematics proves it. Every change is
signed by the key of the person who made it, folded into one
fingerprint, and that fingerprint is written into Bitcoin. If a
stranger cannot re-derive it from the bytes alone, it did not happen.
There is no admin key. There is no operator override. There is no
"trust us."

## 1 · Money is born from sacrifice

There is no printer. The only way ₭ is born:

1. You send real satoshis to a **keyless** Bitcoin address. Keyless
   means no private key exists for it — the address is built from a
   public constant of Bitcoin itself (the NUMS point of BIP-341), and
   anyone on Earth can rebuild it and check. Nobody can ever spend
   from it. The sats are gone forever.
2. The network reads that burial from Bitcoin's own bytes — the
   transaction, its Merkle path, the proof-of-work above it — and
   only then writes one line in its book: **one ₭ per satoshi
   destroyed.** At most 10,000 ₭ per donation, and the window to
   mint again only reopens when a new seal is confirmed on Bitcoin.

So the total ₭ that has ever existed can never exceed the total
satoshis that ever died for it. No premine. No schedule. No
exception. If the books ever disagree with this rule, the node does
not argue — it freezes. A frozen honest node beats a lie applied.

## 2 · Everything costs one fire

Every action — writing, naming, moving — costs exactly **1 ₭**, in
every era, for everyone. That ₭ is destroyed (it becomes Ӿ, the
after-fire, and feeds the validators who prove the network's pulse).
No auctions, no bidding wars, nobody priced out. The money breathes:
born from burned sats, burned again into memory.

## 3 · The book

The network is one **journal**: a single ordered list of signed acts.

- Each act carries the **signature** of its author — the same
  BIP-340 Schnorr signature Bitcoin uses. Your key never leaves
  your wallet. The address IS the account.
- Each act carries the fingerprint (SHA-256) of the act before it.
  Change one byte anywhere in history and every later fingerprint
  breaks. The past cannot be quietly edited.
- A machine called the **reducer** replays the journal from zero and
  refuses anything invalid: a wrong signature, a reused nonce, a fee
  not paid, money appearing from nowhere. After every single act it
  re-checks: total balances = everything minted − everything burned,
  exactly, or HALT.

Any stranger can download the journal, replay it on their own
machine, and arrive at the same balances, the same stars, the same
totals — without asking anyone's permission or believing anyone's
word.

## 4 · Stars

Every satoshi of meaning here lives as a **star**: one number, one
optional name, one optional content.

- **Number** = when. Birth order, given by the journal, never reused.
- **Name** = who. One word, unique in the universe, first writer
  wins, never renamed.
- **Content** = what. Any bytes — text, image, code, music. Content
  is byte-unique: the first writer of those bytes owns them forever;
  a copy is cursed, not born.
- A written star is a **relic**: it can never be spent as gas again.
  Music carries its cover inside one file; the audio frames are
  never re-encoded, and the song's skeleton (its "gene") is hashed
  so the same music cannot be reborn wearing a different sleeve.

## 5 · The fold — one fingerprint proves everything

Acts are packed into blocks. Each block has a Merkle root — a tree
of fingerprints where every act can prove its place. All the blocks,
balances, stars, pots and subsystems then fold into **one 32-byte
fingerprint: the cascade root.** One root proves the entire
universe at that moment.

That root is written into Bitcoin in two ways:

- The burn itself: the donation output is tweaked by the root
  (pay-to-contract), so **the sacrifice IS the seal** — no operator
  needed.
- A human-readable 49-byte note (`KRAY.NETWORK` + version + height +
  root) in an OP_RETURN.

The Bitcoin transaction id **names** that root. It does not contain
the book — a 32-byte digest cannot hold a library — it binds it.
Bitcoin's proof-of-work then guards that name with the same energy
that guards Bitcoin itself.

## 6 · How a stranger verifies, in any century

You need: the journal (any copy), and Bitcoin's chain (public,
everywhere). No server. No permission. Offline.

1. Re-hash the act you care about. Does it match its claimed id?
2. Walk it up its block's Merkle tree. Does it reach the block root?
3. Fold the blocks. Does the cascade root match?
4. Find that exact root inside a Bitcoin transaction — the
   OP_RETURN, or the tweaked burn output.

Four matches: it happened, it was paid for, and rewriting it would
now require rewriting Bitcoin. One mismatch: the copy in your hands
is a forgery. This works today and works in one hundred years,
because it needs only SHA-256, Schnorr, and Bitcoin's history —
nothing of ours needs to survive except the bytes.

## 7 · What grows inside

Everything above is the trunk. On it grow: baptized names; a native
star market (a listing is a signed offer, a sale moves star and
payment atomically or not at all); a rune Layer-2 (real Bitcoin runes
cross in with SPV proof and cross out to the signed owner); contracts
(law written in stars, executed by the reducer); Glow — soulbound
honor: freeze a star to the black hole, one ✦, never bought; and tenants — real
projects that seal their own history onto this book, paying the same
1 ₭ everyone pays. Every leaf folds into the same cascade root. One
anchor seals it all.

## 8 · What we do not claim

Honesty is part of the proof. Today: one writer orders the acts per
universe (any follower re-derives everything and can succeed it);
the rune bridge's L1 reserves sit with a threshold federation —
it cannot steal, it could at worst censor, and that is named, not
hidden. A rune crossing in OR out carries its whole ancestry inside
the event: the book re-derives from bytes how many runes truly
moved, back to the rune's own birth or to coins the book already
proved — no indexer's word on either leg. None of these can mint a
₭, move your balance, or edit the past — those are already under
the one law.

## Stone

A satoshi dies where no key exists. A ₭ is born and can only die
again into memory. Every memory is signed, chained, folded into one
root, and that root is named on Bitcoin. Believe none of it —
replay it.
