# The invisible anchor — pay-to-contract stealth commitment (CORE SHIPPED, v2)

> **Status: the CORE IDEA ships and is LIVE; this exact draft encoding does not.**
> The invisible pay-to-contract anchor described here — the cascade root committed
> inside an ordinary Taproot output key, no OP_RETURN, indistinguishable on-chain —
> is IMPLEMENTED as the **self-anchoring donation** and live on signet:
>
> - **Construction:** [`apps/kray-core/src/protocol/self-anchor.ts`](../apps/kray-core/src/protocol/self-anchor.ts)
>   (`tweakKey` / `commitAnchorKey` / `selfAnchorAddress`) commits
>   `KrayAnchor.payload(blockNumber, cascadeRoot)` under a pot internal key with the
>   very BIP-341 output-key tweak specified below.
> - **Dual-carrier verifier (the widening):** [`apps/kray-core/src/anchor/spv.ts`](../apps/kray-core/src/anchor/spv.ts)
>   accepts EITHER the v1 49-byte OP_RETURN seal OR a recomputed self-anchor output
>   key — carrier-agnostic, exactly as this document argues.
> - **Wired end-to-end:** `protocol/donate-psbt.ts` (`buildSelfAnchorDonationPsbt`)
>   → `server.mjs` `donate/prepare` builds the self-anchoring donation whenever
>   `KRAY_SELF_ANCHOR=1` + `KRAY_POT_INTERNAL_KEY` are set (keyless **burn** when the
>   key is the NUMS point `BURN_INTERNAL_KEY` — the sats are destroyed forever and
>   the root is sealed in the same output).
> - **Live:** enabled on `signet.kray.network` (2026-08-15). Every donation seals the
>   current cascade root inside its own keyless-NUMS output — the donation **is** the
>   anchor: no operator, no multisig, no separate fee; the donor pays only the miner
>   fee.
>
> **What this draft does NOT match byte-for-byte:** the commitment encoding here
> (`m = "KRAY.NETWORK/anchor-v2" ‖ … ; t = TapTweak(P ‖ sha256(m))`) differs from the
> shipped one (`c = taggedHash("kray-core.self-anchor.v1", payload); t = TapTweak(P ‖ c)`),
> and the separate "published opening" was realized as on-the-wire **discovery from
> the transaction bytes** plus the hash-chained anchor log, not a distinct off-chain
> opening. Treat the sections below as the design rationale; treat `self-anchor.ts`
> as the **normative** construction. Read [`anchor-spec.md`](anchor-spec.md) first.

## Why

The v1 anchor is a bare `OP_RETURN` beginning with the ASCII string
`KRAY.NETWORK` and the fixed script prefix `6a31…`. That readability is a virtue
for auditors (A8: one human-readable root proves everything) and a liability for
survival: the exact bytes that make an anchor easy to *read* also make it easy to
*filter*. A hostile relay or mining policy that wished to censor KRAY would search
for precisely that prefix. Bitcoin was built so that anyone can write anything and
attach it to whatever they wish; a carrier that can be pattern-matched is a carrier
that can be denied.

The invisible anchor removes the pattern. It commits the same cascade root inside
an **ordinary Taproot output**, indistinguishable on-chain from any other payment.
To censor it, an adversary would have to censor Taproot spends in general — i.e.
censor Bitcoin itself. That is the property Satoshi made impossible, and the one
this carrier borrows.

## The construction — BIP-341 output-key tweak (pay-to-contract)

Pay-to-contract commits data by tweaking a public key. KRAY already relies on the
same BIP-341 tweak for every Taproot address it derives, so this introduces no new
cryptographic assumption.

Let the anchor transaction pay its own change to a Taproot output. Instead of an
arbitrary internal key, derive the output key from the cascade root:

```
m  = "KRAY.NETWORK/anchor-v2" ‖ version(1) ‖ blockNumber(4 BE) ‖ cascadeRoot(32)
P  = an internal key the anchor payer controls        (x-only, 32 bytes)
t  = tagged_hash("TapTweak", P ‖ sha256(m))           (BIP-341 tweak scalar)
Q  = P + t·G                                           (the Taproot output key)
outputScript = OP_1 PUSH32(Q)                          (a standard P2TR output)
```

On the chain, `OP_1 PUSH32(Q)` is byte-for-byte an ordinary Taproot payment:
`5120<32 bytes>`. There is no `OP_RETURN`, no tag, no version byte, no marker of any
kind. The commitment lives in the 32 bytes of the output key, recoverable only by
someone who already knows `P`, `m`, and where to look.

Spending that output later is a normal key-path Taproot spend with the tweaked
private key `p + t` — so the anchor payer keeps full control of the change coins;
the commitment costs no extra output and no burned sats.

## Publishing the opening

`Q` alone hides the root even from the network — which also means a stranger
cannot verify it. The anchor payer therefore publishes the **opening**
`(P, version, blockNumber, cascadeRoot, outpoint)` off-chain, in exactly the place
v1 auditors already look: the node's own `/api/kraynet/head` and the hash-chained
anchor log (`kray-anchors-<net>.jsonl`). The opening is small, public, and — like
every KRAY proof — re-derivable and refused loudly if it does not check out.

The security asymmetry is the whole point:

- **To verify:** anyone with the opening recomputes `t`, `Q`, and matches it
  against the on-chain output. Pure function, no node, no network — the same trust
  model as the v1 receipt.
- **To censor:** an adversary who does *not* have the opening sees only a Taproot
  payment among millions. There is nothing to filter on.

Publishing the opening reveals which historical outputs were anchors, but only
*after* they are already buried in Bitcoin — visibility after inclusion, never a
filter before it. A citizen who fears censorship anchors invisibly and withholds or
delays the opening; an auditor who wants daylight anchors with v1. Same network,
same root, two provenances — honestly labelled (A6).

## Dual-carrier verifier rule (the widening)

The verifier is extended, never rewritten:

1. **v1 path (unchanged):** find an `OP_RETURN` whose script is `6a31` + 98 hex;
   `KrayAnchor.decode` → require `tag == "KRAY.NETWORK"`, `version == 1`; match the
   32-byte root.
2. **v2 path (new):** given an opening `(P, version, blockNumber, cascadeRoot,
   outpoint)`, recompute `m`, `t`, `Q`; require the transaction at `outpoint` to
   pay `OP_1 PUSH32(Q)`; take `cascadeRoot` as the committed root.
3. **Either carrier suffices.** A block's KRAY state is sealed if *either* a valid
   v1 OP_RETURN *or* a valid v2 opening commits the matching cascade root. Fork
   choice (`protocol/consensus.ts`) already weighs an anchor by the Bitcoin work
   burying it; that logic is carrier-agnostic and does not change — only how the
   32-byte root is extracted from a transaction changes.

Because an old node that knows nothing of v2 still reads every v1 anchor, and a v2
node reads both, the format widens without splitting the network — A3 in practice,
exactly as the settlement rows widened 3→5→7→8 columns without invalidating a
single old row.

## What must be specified before implementation

This proposal is deliberately not code. Building it as law requires, in the KRAY
style (every rule enforced at the door AND in the reducer, re-provable from bytes
on replay):

- **Canonical opening encoding** — exact field order and byte widths, so one
  opening has one serialization and one hash.
- **Internal-key provenance** — how `P` is chosen and proven to be the payer's, so
  a stranger cannot claim someone else's Taproot output as a KRAY anchor
  (grinding-resistance: `Q` must be infeasible to hit without knowing `t`).
- **Where the opening is committed** — it should itself fall under the cascade
  root of a *later* anchor, so the set of invisible anchors is as tamper-evident
  as everything else, not a side channel.
- **Reducer behavior** — a v2 opening that does not reproduce the on-chain output
  is refused and named, never silently ignored (fail-closed, like every seal).
- **Test vectors** — a mined-block fixture proving a real tweaked output round-trips
  through derive → publish → verify, and every forgery (wrong `P`, wrong root,
  wrong outpoint, a v1 output presented as v2) refused. A fixture that could fake
  an anchor would prove a law we do not have.
- **Adversarial review** — the standing bar: try to make the verifier bless a
  Taproot output that commits nothing, or two openings for one output.

## The border, stated honestly

The invisible anchor closes the **external** censorship front — no one can filter
what they cannot recognize. It does **not**, by itself, close the **internal**
front: a single writer can still refuse to *include* an action before it is ever
anchored (see `PROOF-COMPARISON.md`, roadmap items 2 and 3). Stealth carriage
protects the anchor once it is written; it does not yet make writing itself
unstoppable. Both fronts matter, and this document only claims the one it closes.

## Primary sources

- KRAY v1 anchor: [`anchor-spec.md`](anchor-spec.md)
- The honest border this widens toward: [`PROOF-COMPARISON.md`](PROOF-COMPARISON.md)
- [BIP-341: Taproot](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki)
  (output-key tweak, tagged hashes)
- The `design-resilient-runes` skill's consensus / relay / miner / indexer matrix —
  the lens under which this carrier was evaluated (verified standard under current
  policy and under BIP-110 as drafted; a standard P2TR output has no OP_RETURN size
  or datacarrier exposure at all).
