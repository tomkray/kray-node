# NUMS

**Parent:** `bitcoin`
**Action:** Name the lock whose key was never cut.

NUMS means nothing up my sleeve: a number nobody chose by hand.
On Bitcoin the famous one is written into BIP-341 —

```
H = SHA256(uncompressed G)
```

A real curve point. Nobody has the private key. Spending the
key-path would mean solving the discrete log of a hash. That is
the same hardness the clock already bets on. Anyone recomputes
H. No server is required. This book did not invent the point.
That is the virtue.

The primitive is not “burn.” The primitive is: prove the key-path
belongs to nobody. Burn is one composition. A script tree is
another. Tweaking H with a hash seals a document and still cannot
create a key that never existed.

Taproot has two doors. NUMS bricks only the first.

| Door | If the internal key is H |
|---|---|
| Key path | Closed forever. |
| Script path | Still open, if a leaf exists that someone can satisfy. |

So a sat sent to H with **no** leaf is dead. A sat sent to H
**with** leaves is reserved. Do not give those two outputs the
same name.

This book uses one constant three ways. Keep the names apart:

- **Donate** — H, no spendable leaf, root tweaked in. A satoshi
  dies. One ₭ is born. That sat does not return.
- **Vault / pot** — same H, leaves live. Metal sleeps. The book
  is not that metal.
- **Black hole** — a third keyless construction. Entombment in
  the book. Another name.

A covenant on Bitcoin may one day lock where a vault may pay.
It does not raise a sat that died on a nude H. Do not ask NUMS
to be a bank. Do not invent a second point so a brand looks
original.

`bitcoin` is the clock. `satoshi` is the grain. `donation` is
the 2010 gift. This star is only the lock: the mailbox whose
key was never made.

## Stone

NUMS bricks the key door. Burn needs no script. Return needs a
leaf. Do not give those two the same name.
