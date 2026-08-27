# THE SAME-INSTANT LAW — order by arithmetic, not by the writer's hand

> Status: **CROSSED LIVE ON SIGNET (2026-08-23)** — ratified by the Creator ("the writer
> cannot choose; it must respect a mathematical, proven rule"), built additive, proven by
> the three-tier chronology. Tier 1 (regtest): 17 unit checks + the 24×6 live HTTP swarm
> (zero refusals, every run in the orderWindow schedule, byte-exact reboot) + full suite
> green with the referee inside every signed act. Tier 2 (signet): pinned at seq 175 with
> the live tip at 166; disposable dormant replay byte-identical; fleet first, then the
> writer; the live crossing storm landed 12 concurrent acts with FOUR same-millisecond
> runs (biggest 8 acts) all in the objective schedule (seqs 175–209); the 3 guardians
> replayed under the active law to the writer's exact root d23f4038… at seq 209.
> Tier 3 (mainnet): born active at seq 0 — nothing to decide at genesis.

## The law (one sentence)

User acts the writer stamps into the **same millisecond** (`at`) MUST stand in the
journal in the one order arithmetic derives — `orderWindow` over the SHA-256 of the
bytes each author **signed** — or the act is refused at the door and a lying journal
**HALTs every follower** on replay.

## Why this key (the ungrindable tiebreak)

The order key is `keyFromSignedMessage(signed bytes)` — already proven in
`window-order.ts` (ADR-3 slice 3c) and already computed for every signed act at
apply time (`ledger.ts` requireSig → `_pendingInclusionKey`). To move your key you
must change what you signed (nonce, recipient, content) — a different act with a
different meaning. Re-signing does not move you; the signature is not hashed.

## The three moving parts (all additive)

1. **The mirror + the referee** — `signed-message.ts` exports the pure
   `signedBytesOfEvent(e, network)` (the exact per-kind message the reducer
   verifies, deadline suffix included). `requireSig` now ASSERTS its inline
   message equals the mirror on EVERY apply and EVERY replay — parity by
   continuous verification, fail-closed. The door and the reducer can never
   disagree about an act's key without the whole network refusing the act.
2. **The law in the reducer** — activation-gated (`SAME_INSTANT_ORDER_ACTIVATION_SEQ`:
   regtest lab pins low, signet pinned at tip+margin at deploy, main 0). Run
   tracking: consecutive signed acts sharing one `at`, all at/after activation.
   Each new act must extend the run so that the journal order EQUALS
   `orderWindow(run)` (starting nonces = each account's first nonce in the run).
   Checked in `requireSig` BEFORE any mutation: live door → refusal; forged
   journal → follower HALT. Same code path, both teeth.
3. **The gate at the door** — concurrent submits are collected for one tick
   (~4 ms), stamped ONE shared `at` (strictly monotonic per flush so two flushes
   never share a millisecond), keyed by the mirror, ordered by `orderWindow`
   (signature + address verified before ordering, so a forged act can never
   occupy a victim's nonce slot — the admission law), then applied in that order.

## The adversary's refutations (answered)

- **Grind the key** → key hashes signed bytes only; grinding = signing a different
  act. Priced, not free.
- **Occupy a rival's nonce slot in the flush** → gate admission verifies the
  signature AND the pk↔address binding before ordering (mirrors `orderWindow`'s
  admission law); garbage never claims a slot.
- **Writer stamps distinct `at` to escape the law** → NAMED RESIDUE: across
  instants, time orders — but `at` rides the anchored bytes, deadlines (ADR-3
  slice C) bound gross delay, and the pen's inclusion evidence already scars
  omission. The law kills the writer's choice WITHIN simultaneity, which is the
  only place a socket accident or a covert preference could hide.
- **Same-account chain with descending keys** → nonce law outranks key order
  inside one account (orderWindow's greedy); the law accepts exactly that.
- **Insertion trick** (hide an inversion behind an own-account chain) → the check
  is greedy-equality over the WHOLE run, not pairwise-adjacent; the trick HALTs.

## Discarded branches (Echo de Bifurcação)

- **B: order whole seals, not instants** — breaks instant crane finality. Refused.
- **C: policy-only ordering (no follower verification)** — the writer could still
  choose unseen; the Creator asked for proof, not politeness. Refused.
- **D: retry-and-bump instead of upfront ordering** — kills the covert choice but
  keeps arrival racing inside the flush; a louder copy of the socket. Refused.
- **E: pairwise-adjacent check** — gameable by insertion (proved by
  counterexample x1(k5,A) x2(k1,A) x3(k3,B)). Refused for greedy-equality.

## Proof plan (three tiers, in order — the Creator's chronology)

1. **regtest** — unit: dormant A3 byte-identity, boundary, wrong-order refusal,
   same-account chains, insertion trick, unsigned run-breaks, forged-journal
   replay HALT, mirror parity across kinds. Swarm: lab writer with the law
   active from seq 1, dozens of concurrent same-millisecond submits, arrival
   permutations → identical journal order every run.
2. **signet** — fleet first, writer, pin at tip+margin, live crossing with a real
   concurrent storm; guardians replay green, roots byte-identical.
3. **mainnet** — born active at seq 0. Nothing new to decide at genesis.
