# WHERE KRAY STANDS — the mathematics, compared honestly

> **Status: NORMATIVE (comparative essay, code-grounded)** — not operational law; where a
> guarantee named here and the code disagree, the code wins.

A network is only as strong as the weakest thing it asks you to *trust* instead
of *check*. This document names, for KRAY and for the chains it is measured
against, exactly which guarantees are mathematical, which are economic, and
which are neither. It is written to be uncomfortable where the truth is
uncomfortable — a comparison that flatters is a comparison that hides a hole.

## The five questions every chain must answer

1. **Supply** — can units be created out of nothing?
2. **Ownership** — can someone move what is not theirs?
3. **History** — can the past be rewritten after the fact?
4. **Payout** — is the issuance split verifiable, or is the producer trusted?
5. **Consensus** — who decides the order, and what stops them cheating?

| | Bitcoin | Ethereum | typical PoS | Filecoin/Arweave | **KRAY** |
|---|---|---|---|---|---|
| **Supply** | consensus rule per block. *(The 2010 overflow bug minted 184B BTC and needed a fork — the rule was checked, the arithmetic was not.)* | consensus rule + EVM invariants | consensus rule | consensus rule | **conservation (Σ balances == emitted − burned) re-asserted after EVERY event or the node HALTS**, proof-of-burn (₭ minted only from real satoshis burned, 1:1), BigInt-only, no overflow reachable |
| **Ownership** | ECDSA / BIP-340 Schnorr | ECDSA (+ AA) | varies (Ed25519 et al.) | ECDSA/BLS | **BIP-340 Schnorr, address = p2tr(key)** — same primitive as Bitcoin taproot, bound to the network |
| **History** | accumulated proof-of-work (economic depth) | finality by ⅔ stake + slashing (crypto-economic) | stake-weighted finality (liveness varies by design) | anchored to own chain | **anchored INTO Bitcoin, and each seal carries an OFFLINE SPV proof** (raw tx → txid → merkle → header chain → depth). KRAY's past is as unrewritable as the Bitcoin blocks that witnessed it |
| **Payout** | producer writes its own coinbase; peers only check the *cap* | validator rewards by protocol formula, trusted to the client | same | storage proofs size the reward | **the settlement table is RE-COMPUTED by the reducer on every apply and every replay** — there is exactly one lawful table; a single unit moved between two workers, with sums intact, is refused and named |
| **Consensus** | Nakamoto PoW, thousands of mutually distrusting nodes | PoS, ~⅔ stake + slashing | PoS variants | PoS + storage | **BITCOIN IS THE REFEREE** — the canonical history is the one whose deepest SPV-PROVEN anchor sits deepest in Bitcoin (`protocol/consensus.ts`). A pure, total, offline function every follower computes identically; forged anchors weigh nothing and mark their author. Writing is still single-writer; DECIDING which past is real no longer is |
| **Work is proven, not declared** | hashes (physics) | stake (capital) | stake | **storage (Filecoin PoRep/PoSt, Arweave SPoRA)** | **custody: beacon-driven sampling of the atlas** — same family as Filecoin/Arweave, plus linear (sybil-neutral) presence |

## Where KRAY is genuinely stronger

- **Supply integrity.** Bitcoin's CVE-2010-5139 minted 184 billion BTC because
  an addition overflowed a check. KRAY cannot express that: every amount is a
  BigInt, and conservation is re-asserted after every single event — the node
  HALTS rather than serve a chain that gained or lost one unit.
- **Verifiable issuance split.** On Bitcoin and typical PoS chains the producer's reward is checked only against
  a cap or a formula (see the Payout row) — none re-derive the full split from proven work the
  rules. In KRAY the whole payout table is a *function* of journal-recorded
  facts (work, presence bitmap, span, beacon), so any stranger recomputes it and
  refuses a different one. This is a guarantee the big chains do not offer.
  Every paid row under a seal now carries its worker's own BIP-340 signature —
  what nobody signed is never paid — and a clocked chain can only settle under a
  span, so no settlement can escape the recomputed table, the signatures and the
  Bitcoin clock at once (the one exception is block #0's founder coinbase,
  checked against the genesis event, exactly as Bitcoin defines its own).
- **Every action is a self-contained receipt.** Merkle proof → block → cascade
  root → the exact OP_RETURN on Bitcoin. No indexer, no node, no trust.
- **Content is content-addressed and its custody is sampled** — the atlas cannot
  silently rot or be claimed by someone who does not hold it.

## The gap — stated plainly

**Fork choice is now mathematical; production is still single-writer.** The rule
`chooseCanonical` (proven anchors → Bitcoin depth → tie-breaks, all pure) means
no operator can decide which past is real, and `/api/kraynet/head` +
`/api/kraynet/journal` let any stranger fetch, replay and judge without trust.
What remains is that ONE node still writes and orders:

| What Bitcoin gets from thousands of nodes | What KRAY has today |
|---|---|
| Censorship resistance | none yet — the operator can refuse to include an action |
| Liveness without the operator | none yet — if the node stops, writing stops (followers keep serving the verified history) |
| Ordering nobody controls | the operator orders — but can never rewrite, and never decide the fork |
| Data availability | any follower can mirror the journal from `/api/kraynet/journal`; the anchors prove what it must contain |
| Sybil-resistant base weight | partial — custody proves storage AND each beat now proves its own work (`beat-pow.ts`: leading-zero-bit PoW bound to the Bitcoin beacon, the address and the block, so work is measured, no longer declared). The residue is not measurement but *identity*: the split is now strictly LINEAR in work, which is sybil-neutral because only a linear weight satisfies N·f(W/N)=f(W) — a concave √ would reward splitting one machine into N free identities. A residual whale/identity concern (many names behind one disk) is bounded by real per-beat proof-of-work and, optionally, costly identity (a slashable bond, or one SPV-proven L1 tx per opt-in) |

So the honest classification: **KRAY is a Bitcoin-anchored, self-verifying,
single-writer ledger with proof-of-storage weighting.** Inside its own rules it
is mathematically stricter than Bitcoin. As a *network*, it is not yet a
Nakamoto consensus system and must not be described as one.

## What would close it (the roadmap, in order of weight)

1. ~~**Fork choice by Bitcoin**~~ — **DONE** (`protocol/consensus.ts`, 13 checks):
   the anchored root decides, offline and identically for everyone. What is left
   of this item is the *transport*: peers gossiping heads automatically, and a
   second writer able to take over when the first goes silent.
2. **Censorship evidence** — signed actions get an inclusion deadline; a
   citizen can publish a signed action that is provably absent by seal N,
   turning censorship from invisible into evidence.
3. **Base work as a proof, not a declaration** — ~~the per-beat side is **DONE**~~
   (`beat-pow.ts`: every beat carries a leading-zero-bit proof of work, bound to
   the Bitcoin beacon, the address and the block; a claim cannot be inflated,
   pre-ground, bought or replayed). Two things remain: *service* proof (random
   retrieval audits — did the guardian actually serve the bytes another guardian
   asked for?), and the **identity** decision the measured-work proof exposed but
   does not settle — now settled as a LINEAR, Bitcoin-like weight (hashrate share = reward share); identity may later be made costly (a slashable bond or one SPV-proven L1 transaction per opt-in) to further harden it. Concavity could not both shield the small validator and deny
   the splitter while identity is free.
4. **v2 custody: address-salted replicas** — each identity must store its own
   slow-to-derive encoding, so N identities require N real disks. This moves
   "one disk behind many identities" from *expensive* to *impossible*.
5. **Differential fuzzing of the reducer** — property-based tests generating
   random journals to prove no sequence of legal events can break conservation.

## The border, which every honest chain has

Bitcoin's own whitepaper documents the 51% attack: forging a signature is
*mathematically impossible*, out-mining the honest majority is merely
*economically irrational*. KRAY draws the same border, in writing:

- **Impossible:** forging a signature, an identity, a settlement table, a
  presence bitmap, a custody proof, a seal, or a past that Bitcoin witnessed.
- **Expensive, not impossible (until the roadmap above lands):** many identities
  behind one disk, streaming bytes from a third party at challenge time, one
  machine split into many free identities to try to bend the linear reward split, and — the
  big one — a dishonest operator, whose limits are the anchors it already
  published and the proofs it cannot fake, but who is not yet outvoted by peers.

Anything that claims to have no border is hiding one.
