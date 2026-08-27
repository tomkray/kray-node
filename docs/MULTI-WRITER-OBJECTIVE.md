# Multi-writer objective — the pen as a role, not a machine

> **Status: LOCKED OBJECTIVE (the Creator, 2026-08-26).** Destination only. No consensus
> change in this file. The math already lives in ADR-3 slices 3a–3e; this pin names the
> live picture so a later wiring cannot invent a second consensus, a committee, or a
> louder copy of a working single writer.
>
> Law: `docs/AXIOMS.md` (Supreme Law · A3) · design: `docs/FRONTIER-ADRS.md` ADR-3 ·
> ratified folds: `docs/PEN-ACTIVATION-DECISION.md` · pure rule:
> `apps/kray-core/src/protocol/succession.ts`.

## The destination (one sentence)

**The writer is a role any full node may win under a rule every replica computes
identically — Bitcoin decides who wrote the window; the reducer decides what the
window means.** Two writers at once is a fork, not a feature. The lighter (or
provably-censoring) head loses. The book never has two pens that both stay true.

That is Bitcoin's own shape: one valid chain, many candidates, one rule.

## What is already true (do not rebuild)

| Slice | What it proves | Live? |
|---|---|---|
| Reducer | A hostile client cannot mint, steal, or rewrite an anchored past | yes |
| `chooseCanonical` | Competing *complete* histories resolve by buried Bitcoin work | yes |
| 3a inclusion SMT | Membership and *absence* of any signed-act key, one root | folds live (Art. XIV) |
| 3b inbox | A signed act survives writer death on every node that heard it | yes (inbox) |
| 3c `orderWindow` | Same admitted set + same nonces → **byte-identical** journal | primitive proven; door admission still owed for every kind |
| 3d censorship | Omission past a *signed* deadline is a Bitcoin-checkable fact | verdict live as **evidence** |
| 3e succession | Silence clock · successor-window re-derivation · N-claimant reduce · conduct teeth | **pure, not wired** |

Conduct already has teeth in the module, still caller-wired: `censorshipOpensSuccession`
opens the race on a standing strike (censorship is not silence);
`chooseCanonicalWithConduct` demotes a proven-censoring head **before** work is weighed.
`chooseCanonical` itself stays byte-identical when neither (or both) heads are struck.

Article XIV already turned the *folds* on (Signet seq 155; mainnet born-activated).
That is not yet “many writers.” It is the instrument the race will play.

## The live picture (when 3e is wired)

1. **Steady state.** One incumbent assembles the next window from the public inbox,
   orders it with 3c, folds 3a/3d into the cascade, anchors. Followers replay. Same
   as today — the train does not derail on the day the flag flips.
2. **Silence.** After `DEFAULT_SILENCE_BLOCKS` (6 Bitcoin blocks, Creator-tunable
   before wiring) with no anchored window, **any** node may assemble the next window
   from *its* inbox under the same 3c rule and bury the root. A hiccup is not a race.
3. **Censorship.** A strike this replica itself derived (`verifyCensorshipAnchored`
   + seal-height re-proved on *this* bitcoind) opens succession **immediately**.
   No strike ⇒ the silence clock is unchanged (additive, fail-closed).
4. **Equivocation.** Two valid windows for one height → `canonicalHead` /
   `chooseCanonicalWithConduct`. Deepest honest proven anchor wins. That is Bitcoin
   reorg uncertainty, already named in ADR-4 — never hidden as “instant finality.”
5. **The citizen.** Prepare → sign → inbox. Resubmit is safe by nonce. A deadline
   is opt-in. No new wallet ceremony on day one.

**What never transfers with the pen.** The pot key. A successor writes the book; it
never gains the vault (Article XIII). Bridge liveness is custody, not ordering.

## Wiring slices (additive, exam-first, Article XIV)

Each slice behind a height/seq flag. Below the flag, replay is byte-identical (A3).
No slice invents Raft, Paxos, or a ⅔ vote — a cartel is not Bitcoin.

| # | Slice | Pin |
|---|---|---|
| W1 | **Door admission = 3c `isValid` + `keyOf` for every kind** | Forged act cannot seize a nonce slot on the live path (the exam already pins transfer + inscribe). |
| W2 | **Prev-root + nonce snapshot** | Successor window binds the previous canonical cascade root; `nonceOf` is the applied state at that root, re-derived, never a peer field. |
| W3 | **Followers run `validateSuccessorWindow` then fork-choice** | Tampered set / smuggled invalid / fabricated commitment refused *before* follow. |
| W4 | **Conduct on the live choose** | Call `chooseCanonicalWithConduct` / `censorshipOpensSuccession` only with replica-local strikes. Peer “CENSORED” is noise. |
| W5 | **ADR-2 gossip completeness** | Until a channel the writer cannot suppress exists, many independent inboxes are the honest interim. A successor can still omit what it never heard — 3d scars that once a deadline + availability witness exist. |

Order: W1 → W2 → W3 on lab (`:4477`) → Signet manual → then W4 teeth if not already caller-wired → W5 as availability, not as a rewrite of 3e.

**3e activates only after 3c’s theorem holds on Signet** (ADR-3 build order). Mainnet
receives a commit that already proved on Signet — never the other way.

## Honest limits (Fano — named, not hidden)

- Safety of *which book is real* is `chooseCanonical` (live). Guaranteed liveness
  under an adversary who withholds anchors **and** hides the inbox is ADR-2, not a
  3e claim.
- During a race, write-finality degrades to **anchor-confidence** (ADR-4). Crane
  replay stays; burial depth is a different fact.
- Policy (dust, flood, batch 200) stays per-door. Consensus stays the reducer.
  A successor may be stricter on relay; it cannot be looser on validity.
- Two writers “always on” in parallel, sharing one tip without a race rule, **is
  a fork by construction.** Discarded.

## Beacon refinement — Bitcoin deals the deck (CANDIDATE, the Creator's idea, 2026-08-26)

Instead of a free-for-all race when succession opens, let **Bitcoin's own block hash**
order the bench. No vote, no committee, no new randomness:

- **Beacon** = the hash of the Bitcoin block that buried the previous seal's anchor at
  ≥ `donationProofMinConf` (reorg-safe — never the raw tip).
- **Queue** = candidates sorted by `SHA256(beacon ‖ epoch ‖ candidateKey)`, smallest
  first; the whole sorted list is the succession order for that epoch.
- **Bench** = journaled enrollment acts (₭ bond), **enrolled strictly before the beacon
  block exists** (enrollment seq < beacon height) — key-grinding after seeing the beacon
  is dead by construction. Weight may ride proven atlas custody (beats), which a sybil
  cannot spin up instantly.
- **Silence** = the 3e clock unchanged: a scheduled leader silent for `T` blocks yields
  to the next in queue. **Censorship** = a standing strike skips the leader immediately
  and evicts it from the bench (bond burned).
- **Fork/equivocation** = `chooseCanonicalWithConduct`, unchanged. The lottery is
  liveness and economy; safety stays the live fork choice.

Honest bias, named: a Bitcoin miner can withhold a found block to re-roll the beacon,
at the cost of the full block reward — and the KRAY writer role carries no loot (the
math cage), so the grind buys nothing worth a block. The leading-zero count reflects
the difficulty target, not an individual block's luck; what the beacon uses is the
hash's unpredictability, which is total.

## Discarded branches

| Branch | Why discarded |
|---|---|
| Raft / Paxos / ⅔ writer committee | Cartel. Bitcoin has no official miner. |
| Ops-promoted follower (launchd / “you are writer now”) | Human pen. 3e exists so this is unnecessary. |
| Always-on N writers, merge journals | Two pens = two books. Order is 3c on one admitted set, then work. |
| Automatic slashing from a peer’s CENSORED gossip | Verdict without validating-replica is a lie that moves money. |
| Successor inherits the pot | Article XIII. The book and the vault are different organs. |

## How a stranger checks we kept this

1. One journal prefix, one cascade root, one Bitcoin anchor — or it did not happen.
2. Two independent nodes holding the same admitted set emit the same window
   (`orderWindow` exam).
3. A silent incumbent yields a successor whose window re-derives
   (`validateSuccessorWindow`).
4. A proven censor loses to an honest head before work
   (`chooseCanonicalWithConduct`).
5. Cold reboot of any honest replica reprints the same root.

Until W1–W4 are live, the honest sentence remains: **the folds are on; the pen is
still one machine; the race rule is proven and waiting.** This file forbids
selling the wait as Nakamoto, and forbids selling a louder single-writer as the
destination.
