# PSBT

**Parent:** `bitcoin`
**Action:** Name the envelope a Bitcoin spend wears while many hands
finish it.

A Bitcoin transaction is not born signed. It is inputs to spend and
outputs to create. A signature is a promise about that list. When
more than one key must speak — or when a wallet must see the promise
before it speaks — the world needs a bag that can travel **without
the private key inside it**.

That bag is a PSBT: a partially signed Bitcoin transaction. The
family is BIP-174. Taproot fields live in BIP-371. Anyone can parse
the bytes. Nobody can extract a key that was never written there.

Three rooms in one bag:

- **Global** — the unsigned transaction, the version of the bag.
- **Per input** — the UTXO, the script, the sighash, the signatures
  that have already landed, the Taproot bits if the door is a tree.
- **Per output** — who is paid, so a signer sees the whole promise,
  not a cropped one.

A sighash is the slice of that promise the signer binds. Sign what
you read. Refuse a bag that hides an output, swaps an amount, or
asks a key to bless a leaf it does not own. A wallet that signs
blind is a third party wearing your name.

The life of a bag:

1. Build — unsigned. Inputs and outputs are already the spend.
2. Update — many hands may add signatures. Order does not invent a
   key.
3. Finalize — enough signatures; extract the network transaction.
4. Broadcast — Bitcoin sees hex, not a bag. The bag is gone.

Finalize is extraction, not a second truth. If the signatures do not
cover every input, the bag is not done. Do not call that a payment.

Taproot has two doors. A PSBT can carry a key-path signature or the
script-path control block. `nums` bricks the key door; it does not
fill this bag. A nude burn has nothing to sign. A vault payout has
leaves to satisfy. Do not give those two bags the same name.

This book uses the bag on Bitcoin. It does not become the bag.

A donate is a PSBT that pays a keyless lock, then a journal proof
that the sat died. A send is a PSBT the owner signs. A rune exit
rebuilds a payout from bytes; the user may pay the miner fee; the
signed bag is not a leaf of the book. The book leaf is a different
signature: domain-separated, network-labelled, Merkle-bound,
anchored. Schnorr here is not a PSBT there. Do not fuse them.

A mouth that says “the node signed for you” has left this star. The
node may *build* a bag. The key that spends stays with the address.

`bitcoin` is the clock. `satoshi` is the grain. `nums` is the lock.
`bridge` is the split. This star is only the envelope: many hands,
one spend, no shared key, and a book that never mistakes that bag
for a leaf.

## Stone

A PSBT is a Bitcoin spend still being signed. Keys never ride in it.
The book is not a PSBT.
