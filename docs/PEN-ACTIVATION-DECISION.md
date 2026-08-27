# Pen Decentralization — the Creator's activation decision brief (ADR-3)

> **Status: RATIFIED FOR SIGNET (the Creator, 2026-08-23).** H = seq **155**, pinned live while the tip stood
> at 149 (the deploy-race rite). The Ӿ transfer activation rides the SAME seq — one upgrade, one story to
> audit. Mainnet constants are set to **born-activated (0)** now, so mainnet genesis needs no future edit.
> The anchoring shape was verified before ratification: the writer self-anchors with the NUMS internal key
> (`keyless: true` on `/api/kraynet/self-anchors`) — every activated seal height is trustlessly re-provable.
> The CENSORED verdict stays **evidence, not automation** (the minimal safe choice below). The original
> decision brief follows, kept intact as the record of what was decided and why.

## What activation does (in one breath)

Today the writer (the single pen) can silently drop a citizen's valid, public, eligible act and no one can
prove it. Activation turns on the machinery that makes that omission **as evident on replay as forging would
be**: the writer must fold, into the Bitcoin-anchored cascade root, a commitment to *which acts each window
contained at which Bitcoin height*. A citizen who anchored their own act and set a deadline can then hand any
stranger a proof — checkable from Bitcoin bytes alone, even from a light wallet — that reads **CENSORED**, or
an honest not-censored reason. No committee, no vote, no second human pen.

Everything below activation is **byte-identical** to a chain that never activated (axiom A3), so activation is
a coordinated switch at a **future height**, exactly how Bitcoin itself ships a soft fork.

## The decisions — only the Creator can make these

### 1. The activation height **H**, per network (Article XIV)

A future seal height, above the live tip, at which the folds turn on. Set once, in code (a consensus constant,
never an env var). Model:
- **regtest** — H = 0 (born activated) for the swarm exam. Disposable; already exercised.
- **signet** — H = the next anchored seal (a live-chain **upgrade test** — the real thing we will do forever).
- **mainnet** — H = 0 (born activated at genesis, when the Creator creates it).

Below H the past opens byte-identically; at/after H the inclusion/window/nonce roots fold. Ratifying H is the
one input the whole path waits on.

### 2. The writer's **anchoring shape** under activation

For a follower to re-prove a seal's height trustlessly (the "enforced twice"), the seal's anchor must be one
the follower can reconstruct from public bytes:
- ✅ **OP_RETURN operator anchor** — fully re-provable (the committed root is readable).
- ✅ **keyless self-anchor** (the donation-IS-the-anchor burn, NUMS key `SHA256(G)`) — fully re-provable.
- ⚠️ **pot-key self-anchor** — the follower cannot reconstruct the operator's key, so it re-proves as
  *weight-zero* (never a lie, but never a proof). **Under activation the writer should anchor via OP_RETURN or
  keyless-burn**, so every seal height is trustlessly checkable. (Honest residual; documented, not hidden.)

### 3. The writer's **inclusion obligation** — what a CENSORED verdict triggers

The verdict is now buildable and trustless. The Creator decides what *acting on it* means:
- the minimal, safe choice: a CENSORED verdict is **evidence any node can publish and any follower re-checks**
  — reputational, and an input to succession (D) fork-choice, nothing automatic.
  The multi-writer *destination* (pen as a role; 3e live wiring W1–W5) is locked in
  `docs/MULTI-WRITER-OBJECTIVE.md` — not this ratification.
- any automation (slashing, forced succession) **must** consume `windowSeals` only from a journal a follower has
  seal-height-re-proven (see `verifyCensorshipAnchored`'s validating-replica note). Do not wire automation onto
  the pure verdict alone.

## The sequence (the ratification rite)

1. **regtest swarm, activated** — ✅ done (`omission-swarm.test.ts`, 11/11 at scale under attack).
2. **signet upgrade test** — ratify H = next seal on the running Signet; watch the folds turn on with the chain
   moving, a follower re-prove the heights, the omission verdict be constructible. This is the rehearsal for
   every future mainnet upgrade.
3. **both certainties** — the Signet upgrade is clean AND the external gates below are met.
4. **mainnet** — born activated at genesis, everything perfect from the first block.

## Prerequisites that are NOT building (external gates)

- **Trustless L1 custody of the pot sats.** The accounting pot is trustless math; the sats key is the operator's
  today. This is the open custody frontier (research), independent of the omission path.
- **A professional external audit** (dossier ready: `docs/AUDIT-DOSSIER.md`). Do not call the network "safe for
  the public's real value" before this, no matter how green the exams are.

## What is already true (so the decision rests on facts)

- The omission path is proven end to end — prover ↔ verifier, at scale, under adversarial attack, replay-exact.
- The seal height is **enforced twice**: the door proves it (BIP-34 coinbase), the follower re-proves it
  independently from its own bitcoind, bound to the inclusion set the anchor actually committed.
- The deadline is **opt-in** — the network runs on today's wallet; a citizen adds a deadline only to demand
  protection.
- Two council levels (design + verify) each caught a real consensus-boundary defect that is now closed;
  the last state is byte-identical in the synchronous case (goldens frozen) and dormant.

**The building is done. The decision is the Creator's.**
