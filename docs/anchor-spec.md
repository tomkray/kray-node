# The KRAY.NETWORK Bitcoin anchor — commitment specification

Every anchor commits the network's **cascade root** — one 32-byte root, a
sequential hash over the entire state — to Bitcoin in a single OP_RETURN output.
This document is the complete spec: with it and a Bitcoin node, anyone can
verify KRAY with no other software.

## The commitment (49 bytes)

```
OP_RETURN  PUSH(49)  "KRAY.NETWORK"  version  blockNumber  cascadeRoot
           0x31      12 bytes ASCII  1 byte   4 bytes BE   32 bytes
```

Script hex layout: `6a` `31` + 98 hex chars:

| Offset (bytes) | Field | Encoding |
|---|---|---|
| 0..11 | tag | ASCII `KRAY.NETWORK` (`4b5241592e4e4554574f524b`) — human-readable on any explorer |
| 12 | version | `0x01` — lets the format evolve without a hard fork |
| 13..16 | blockNumber | big-endian uint32 — the KRAY fast-block height sealed |
| 17..48 | cascadeRoot | 32 bytes — the sequential whole-state hash (below) |

Reference codec: `apps/kray-core/src/anchor/anchor.ts`
(`KrayAnchor.payload` / `KrayAnchor.decode` — pure functions, no I/O).

## The cascade root

The cascade root is a **sequential SHA-256 hash** over each subsystem's committed
value — not a merkle of independent leaves. Domain-separated, order-fixed, append-only:

```
cascadeRoot = sha256(
  "kraynet\n" +
  "seq:"     + seq                           + "\n" +   // the fast-block height sealed
  "emitted:" + emitted + "|burned:" + burned + "\n" +   // supply — Σ conserved or HALT
  "money:"   + moneyRoot                     + "\n" +   // balances + locks
  "stars:"   + starsRoot                     + "\n" +   // ordinals: holdings, inscriptions, baptisms, lineage
  potCommitment                              + "\n" +   // the pot's own already-labelled commitment line
  // ── conditional folds — present ONLY when the subsystem exists today, appended in THIS order ──
  [ "seals:"    + count + "|" + root + "\n" ] +         // confirmed Bitcoin seals
  [ "qcommits:" + count + "|" + root + "\n" ] +         // quantum recovery-key commitments (ML-DSA)
  [ "qmigrated:" + sortedAccounts.join(",") + "\n" ] +  // accounts migrated to post-quantum keys
  "runes:"     + runesCommitment             + "\n" +   // the L2 rune book
  "contracts:" + contractsRoot               + "\n" +   // deterministic contract state
  [ "amm:"       + ammCommitment  + "\n" ] +            // the AMM pools
  [ "inclusion:" + inclusionRoot  + "\n" ] +            // ADR-3: censorship inclusion tree (post-activation)
  [ "window:"    + windowRoot     + "\n" ] +            // ADR-3: seal-window commitment (post-activation)
  [ "nonce:"     + nonceRoot      + "\n" ] +            // ADR-3: eligibility opening
  [ "x:"         + xRoot          + "\n" ] +            // Ӿ transferable book (post x-transfer activation)
  [ "fire:"      + fireRoot       + "\n" ] +            // FIREBORN tank book (post feeless activation)
  [ "lane:"      + laneRoot       + "\n" ]              // TK-fold lane — appended LAST (post fold activation)
)
```

Because it is a **sequential** hash and not a merkle of components, proving that ONE
component is part of an anchored root means revealing ALL the parts and re-hashing — a
full **opening** of the anchored root. That opening is the single source of truth
`cascadeRootFromParts` in `apps/kray-core/src/protocol/cascade-root.ts`:
`ledger.cascadeRoot()` (via `node.cascadeRoot()`) builds the parts and calls it, and a
censorship verifier calls the very same function on the parts a prover reveals — writer
and verifier are one function over the frozen parts, so they can never drift.

A conditional line folds only when its subsystem exists, appended in the order above, so
an all-empty history hashes to the exact bytes it always did — a format anchored on
Bitcoin may only ever **grow** (axiom A3). Every node compiles the identical root from
its own journal (`node.cascadeRoot()` in `src/protocol/node.ts`). Verify this ONE root
and you have verified everything underneath it.

## Anchor pacing

Fast KRAY blocks seal locally at any cadence. Anchoring beats with **real
Bitcoin blocks**: when mainnet finds a block, one anchor commits the latest
cascade root — which already consolidates every fast block since the previous
anchor. A backlog therefore costs O(1), never O(n): one commitment seals all
accumulated history at once. Pending anchors are never lost (see the voluntary
anchor pool, `src/economics/anchor-pool.ts` — the payer is drawn fairly from
the triggering Bitcoin block hash itself).

## Auditor's checklist

1. Find the anchor tx; extract the 98-hex OP_RETURN payload.
2. `KrayAnchor.decode(payload)` → `{ tag, version, blockNumber, root }`;
   require `tag == "KRAY.NETWORK"`, `version == 1`.
3. Replay the KRAY journal (or run a node) up to `blockNumber`;
   compute `cascadeRoot()`.
4. Require byte equality with the on-chain `root`.
5. Bitcoin confirmations on the anchor tx are confirmations of the WHOLE
   KRAY state — the chain no one controls has sealed it.

THE PAID BINDING (round 10): the 49-byte name already binds every journal
act, including a `fold-seal`. The Groth16 body lives on that act (paid
1 ₭). The Bitcoin txid is the name of the commitment — it does not
contain the proof (a 32-byte digest cannot hold a Groth16 body). Opening
the cascade at/after fold activation includes `lane:`; a stranger who
passes this checklist has already verified the fold. See
`apps/kray-core/src/anchor/paid-binding.ts`.

THE HEIGHT CEILING (round 11 grain, now a named object): `blockNumber` is
big-endian **uint32**. The codec **fails closed** past `2^32 − 1` — it
never wraps. At a 3.5 s seal cadence that saturates in ~476 years of
continuous sealing. This is a *label* limit, not a conservation or replay
limit: the journal still re-derives past it; only the on-Bitcoin height
field cannot. The version byte is the designed-in widening (A3, not
activated). A stranger reads the same object on
`GET /api/kraynet/paid-binding` as `ceiling`. That door is 200 live ·
400 codec refuse · 404 missing — refuse is never “no such event”.
`/tx` and `/receipt` still show the act. Do not implement a v2
payload until the format must grow.

## Future: a censorship-proof carrier for the same root

This readable OP_RETURN is easy to audit and, for the same reason, easy to
*filter*. A proposed second carrier commits the identical cascade root inside an
ordinary Taproot output (BIP-341 pay-to-contract), indistinguishable on-chain
from any other payment — unfilterable without censoring Taproot itself. It is
designed as a **widening**, not a fork: the verifier accepts either carrier, and
this v1 format is unchanged. See [`anchor-stealth.md`](anchor-stealth.md).
