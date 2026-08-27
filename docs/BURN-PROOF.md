# The Burn Proof — why the burn address belongs to NOBODY (verify it yourself)

KRAYNET mints ₭ only against Bitcoin provably **destroyed**. When you donate, your sats go to a "burn address"
like:

```
tb1pkgzs0qahe9eglrzmfhk0sw23jk320qg04fxwjaaa725sjp8gzjysvydc6c
```

It looks like any ordinary wallet address — so the fair question is: **"who owns that? Is there a key behind it,
like every other network?"** The answer is no, and you do not have to trust anyone to believe it. You can rebuild
the address yourself from public constants and see that **no number in the chain was chosen by a human**.

## The chain, in plain words

1. **Start at Bitcoin's own generator point `G`** — the public constant every Bitcoin key on Earth is built from,
   fixed since 2009. Nobody controls it; it *is* Bitcoin.

2. **Hash it: `SHA256(uncompressed G)`.** The result is
   `50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0`.
   This is the famous **NUMS point** ("Nothing Up My Sleeve") written into **BIP-341** — the same constant the
   entire taproot ecosystem already relies on. It was not picked by KRAYNET, nor by anyone: it **falls out of a
   hash of Bitcoin itself**. For a private key to exist, someone would need `k` with `k·G = lift_x(that hash)` —
   that is the discrete logarithm of a hash output. **No one has it. No one ever will.**

3. **Stamp the network's state into it.** Take the public anchor bytes
   `"KRAY.NETWORK" | version | blockNumber | cascadeRoot` (the same 49 bytes KRAY has always anchored), hash them
   into a commitment, and apply the **standard BIP-341 tweak** — the identical math every taproot wallet runs
   (proven byte-for-byte equal to the reference library in `self-anchor.test.ts`).

4. **Encode.** Plain bech32m of the tweaked key. That string **is** the burn address.

Every step is a hash or a curve addition. Every input is public. There is no secret anywhere in the chain —
**so there is nothing to steal, no owner, no "team wallet," no rug.** And because tweaking cannot *create* a
private key where none existed (spending the tweaked key would still require the NUMS discrete log), the sats
sent there are **destroyed with mathematical certainty**.

## One address per sealed state — a function, not a wallet

The burn address **changes as the network advances**: each donation pays the address that seals the *current*
cascade root. That is the point — **your donation IS the anchor**: the very output that destroys your sats also
engraves the entire KRAYNET state onto Bitcoin, for free, in the same transaction. A different root → a different
address → **none of them ever owned by anyone**.

## Verify it yourself (60 seconds, zero trust)

```bash
# from the repo, with the (blockNumber, root) your donation sealed — the node
# publishes the current ones at /api/kraynet/donation/info:
cd apps/kray-core
node ../kray-net/burn-verify.mjs 0 9d3b2de322cad91a420243c87fa3b6fce0d6bd90f1b2a1fce216b47e750030ac signet
```

The script prints the whole chain — G, its hash, the NUMS match, the payload, the tweak, the address — and you
compare the final line with the address your donation actually paid (visible on any block explorer). If they
match, you have personally proven that your sacrifice went to a key that **exists for nobody**, and that it sealed
the network's state onto Bitcoin.

Machine-checked version of the same chain: `apps/kray-core/src/test/burn-address-proof.test.ts` (7 checks).

## Why this is stronger than a "famous burn address"

Networks often burn to a *recognizable* address (like `1CounterpartyXXXX…` or `0x000…dead`) so that people can
*see* it is a burn. KRAYNET's burn is stronger on both axes that matter:

- **Proof**: recognizable burn addresses are trusted because "everyone knows nobody made them". Ours is trusted
  because **anyone can recompute it from Bitcoin's generator in one line** — proof, not folklore. It also carries
  the anchor, which a fixed vanity address never could.
- **Censorship**: on-chain, a KRAY burn looks like an ordinary taproot payment. A censor scanning for "KRAY burns"
  finds nothing to block. The proof is available to everyone *after the fact*, precisely when it is needed.

*Sats destroyed forever. The network anchored forever. Owned by no one. Verified by you.*
