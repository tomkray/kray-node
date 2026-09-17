# Residual Advantage Vectors — the ledger (nothing left behind)

> **Status (2026-08-22).** After the market-comparison study and the fairness audit against the five axioms
> — *decentralized · no-privilege-without-proof · sybil/whale-neutral · atemporal · exact-to-each-energy* —
> this ledger accounts for **every** residual advantage vector the council named. Each is **verified against
> the real code** (not the synthesis alone — two turned out to be phantoms the code already closed), with an
> honest status and a path. Overclaiming is the worst failure (Fano): where a fix is a genuine trade-off or
> needs a layer we have not built, this says so plainly.
>
> The **core — presence → fee-pool split — remains the strongest part**: permissionless (no gate, open to a
> laptop), linearly sybil/whale-neutral (Cauchy: only a linear split is), exact to the unit, and **proven**
> (not merely bounded) against a self-dealing writer by `verifySettlement`. Every vector below is at the
> **periphery**; none lets a non-worker earn — the residuals let a large/clever *worker* capture slightly more
> than exact contribution, or bias *who among workers* is paid.

## The map

| # | vector | verified status | path |
|---|--------|-----------------|------|
| **V1** | pay-zeros cap → split to out-earn yourself | **FIXED (mean); ~1.3× payout-concavity residual (audit)** | `471cfee` + the audit §V1 |
| **V2/V4-possession** | custody premium separable → address-grind fakes full custody | **address-grind KILLED (proven ×3); possession NOT closed** | proof-of-storage frontier (§V2) |
| **V2/V4-service** | premium prices *possession*, not *service* | **OPEN — needs the proof-of-service layer** | the decentralization ADR |
| **V3** | `CUSTODY_PAYOUT_FACTOR = 3` is a fixed constant | **subsumed** by the hybrid redesign | §V3 below |
| **V5** | anchor draw uniform + **unescrowed offers, rival reward** | **relocated + bounded** (not "solved" — audit) | escrow/bond or keep uniform (§V5 · audit) |
| **V6** | raffle timing bias at tiny N | **self-healing with scale** | none needed |
| **V7** | integer dust in the split | **immaterial (E ≈ 0)** | none needed |
| **V8** | governance √-weight sybil surface | **outside the reward pool** | rests on proof-of-personhood |
| ↳ | phantom "uniform draw" | **GOOD phantom — the insight was TRUE** | it named the anchor draw (→ V5); the raffle it blamed is work-weighted |
| **V9** | the v1 `contract` seal (E1): free, nonce-less, one signature re-submittable | **CLOSED at the door (2026-09-17); reducer pin `CONTRACT_V1_RETIRED_SEQ` next** | §V9 below |
| **M** | phantom "unverified capacity" | **hallucination + a grain** | flat shape is correct; the grain: `perAnchor` is a magic-number level (§M) |

---

## The anti-centralization audit — three independent lenses (2026-08-22)

The Creator's stated purpose: KRAY must solve the problem Bitcoin has — where hashpower/capital concentration
becomes **control**. Three independent entities (a hashpower lens · a capital lens · a writer lens) attacked
the claim adversarially. **Convergent verdict: KRAY genuinely solves it — hashpower and capital earn
proportional (even sub-proportional / anti-whale) but NEVER control.** The audit also caught four of the
author's own overclaims (the grains-of-truth independent-convergence law working: the discoverer is never the
sole validator).

**PROVEN achieved (all three converge):**
- **Hashpower → no control.** Income is *concave* in hashrate — the payout-vs-hashrate slope is ≤ 1 everywhere
  (≈ 0.98 for a small miner, → 0.03 near majority), so a big miner earns strictly *sub*-proportionally.
  Out-hashing buys **no** ordering, inclusion, or writer-selection power — unlike Bitcoin, where hashpower *is*
  write access. KRAY turns Bitcoin's *winner-take-all → pool-for-variance → the pool gains control* into
  *winner-take-most → split-for-variance → no one gains control.*
- **Capital → no control.** No live path from money to control: donations are burns (mint 1:1, capped 10k/mint,
  window-metered); the pot is not purchasable (burned, not held; the vault is owner + 2/3-guardian +
  depositor-CSV-escape, slots qualified not sold); governance is √-damped, additive (a crowd out-votes a
  whale), and touches only the shell — the economic core is never governed.
- **The writer cannot mint / forge / steal** — a live theorem (verifySettlement recompute + the follower); the
  rune-bridge escape is real.

This is the value model made math: because the game is to **secure real value (sacrificed-Bitcoin stars), not
to farm yield**, there is no profit-race for a large actor to dominate — the thing Bitcoin never had.

**The ONE real centralization that remains — the WRITER (the pen), orthogonal to hashpower/capital.** Since
the Article XIV ratification (2026-08-23; old-chain Signet pin 155 — born active at seq 0 on both nets after the v1.0.0 genesis reset) the writer can
no longer censor **silently**: every seal folds the inclusion root, window commitment and nonce map into the
anchored cascade root, so omitting a deadline-carrying act leaves a CENSORED verdict any follower proves from
Bitcoin bytes (`buildCensorshipClaim` ↔ `verifyCensorshipAnchored`). What the writer still CAN do: **delay and
order** (MEV over the live AMM, bounded by the user's signed `minOut`), and **halt** (a single point of
failure — succession is built and proven, invoked manually). The anchored root bounds **safety** (no
mint/forge/theft) and now scars **omission**; wiring the CENSORED verdict into fork-choice/succession
automatically is the remaining automation. Honest present tense: **"reading and truth are decentralized;
writing is single-writer under an activated evidence law — omission scars, the scar's enforcement is still a
human act."**

**The four overclaims the audit corrected (kept honest):**
1. **V1** — "`2^zeros` is sybil-neutral by itself" holds for the *mean weight* but not the *payout*: since
   `pay = W/(W+R)` is concave and splitting cuts weight-variance ~1/k, Jensen gives a **~1.2–1.5×
   concave-payout sybil edge** that survives the cap-lift (three independent sims + closed form). It is a
   bounded **sophistication tax** — roughly size-uniform, collapses near majority — *anti-size, not
   pro-centralization* — but "sybil buys nothing" is false at the payout level.
2. **V5** — "SOLVED via sats-weighting" is **relocated + bounded**, not solved: offers are **unescrowed** and
   the flat reward is **rival** (drawn from the worker fee pool), so a free-declarer of huge capacity wins
   ~every draw, pays only the min fee (never fails), and siphons a bounded, intermittent ₭ stream from workers.
   Fix: escrow/bond the offer, cap the backstop's pool share, or keep uniform+flag-gated. (The uniform
   default's "capital-gated" bound is also illusory — offers lock nothing.)
3. **Custody "possession CLOSED"** — already corrected (`b8b7836`): kills the address-grind, not streaming.
4. **"Honor can never be bought" (`glow.ts`)** — soulbound blocks transfer, not production; honor = f(work) =
   f(rentable hashpower), so voice is buyable — but **sub-linearly** (√-damped, additive, shell-only). A
   narrative overclaim, not a super-proportional lever.

**The earning/variance residuals (all anti-whale, size-neutral, or bounded — none hands a big actor control):**
the concave-payout sybil (V1), an **α = 1 heavy tail** (per-seal winner-take-most, defused because the response
is *splitting*, not ceding control), an **integer-floor squeeze-out** (a laptop earns 0 ₭ when pool ≪
network-scale — a participation floor, refining V7), the anchor-backstop siphon (V5), and the **wired v1 custody
3×** hashrate×storage complementarity (favors co-located capital; latent — inert only by an empty atlas). Each
is a *fairness/variance* refinement of the securing-reward, never a control lever.

---

## V1 · the pay-zeros cap — FIXED (dormant, proven)

**The break.** A windowed settle clamped each beat at `BEAT_PAY_ZEROS_CAP = 24`. Because `2^zeros` is convex,
a flat per-identity cap let a miner *above* the cap out-earn itself by splitting: `2^30 === 64 × 2^24`, so one
honest address earning `2^24` was beaten 64× by the same hashrate spread over 64 addresses.

**The fix (the simplest movement).** `2^zeros` is sybil-neutral **by itself** — the cap was the one thing that
broke it. Lift the cap at/above `BEAT_PAY_CAP_LIFTED_FROM_SEQ`; below it, clamp exactly as before so all
history replays byte-for-byte. **Dormant** (`LIFT = MAX_SAFE_INTEGER`): today's behavior is unchanged;
activation is a ratified, network-aware seq (a future Signet seq; a fresh mainnet genesis starts lifted).

**Proven.** `v1-paycap-lift.test.ts` 9/9 — capped 64× break reproduced, lifted neutral (1.000×), clamp real,
dormancy byte-identical, seq gate routes, presence window intact — plus 9 consensus suites green. Commit
`471cfee`. The lucky-beat variance the cap guarded against stays bounded by the split ratio and self-averages
over seals (inherent lottery variance, not a grindable vector). If we ever want to shrink it, the tool is
network-**relative**, never a per-identity flat.

## V2 / V4 (possession) · the custody premium is grindable — PROVEN, and the fix is designed

**The break (Design A, today).** `effectiveWork = base · (K + 2·hits)`, where `hits` = atlas challenges
answered. The premium is a **separable claim**: a partial holder of fraction *f* can **address-grind** — try
addresses until all K beacon-chosen challenges happen to land in the blocks it does hold — and so fake
`hits = K`, stealing the full premium. Grind cost is `~1/f^K`, which is **cheap for a moderate holder**.

Proven with real sha256 (`scripts/lab/custody-antigrind.sim.mjs`):

```
holds 75%  → faked hits=8 in 14 tries    → steals the full 3× premium
holds 50%  → faked hits=8 in 3 tries      → steals the full 3× premium
holds 38%  → faked hits=8 in 7,296 tries  → steals the full 3× premium
```

**The fix — the entangled PoR (Permacoin/Chia/Arweave lineage).** Make the premium a **proof-of-retrievability**
instead of a separable claim: a beat *completes* only if it can read the atlas block at
`idx = H(beacon ‖ address ‖ nonce) mod atlasSize`. Then a holder of fraction *f* completes exactly a fraction
*f* of attempts — **effective mining rate = f, linear and ungrindable**: to *skip* a non-held index you must
first compute the hash that reveals it, so filtering costs a full hash. Effective work `= f` strictly.

```
holds 100%  → effective rate 100.0%   (Δ 0.00pp)
holds  50%  → effective rate  49.8%   (Δ -0.03pp)
holds  25%  → effective rate  23.8%   (Δ -0.09pp)
holds  10%  → effective rate   9.8%   (Δ 0.00pp)   ← a 10% holder earns exactly 10%
```

**The hybrid (keep the 1-click door open).** Pure PoR pays a CPU-only guardian (f = 0) nothing, which would
kill the guardian lottery the Creator intends. So: a small **CPU floor** (base work, present-lottery, no
holding) **+** the **entangled premium** (data-dependent, ungrindable), tuned floor:premium ≈ the current
1×:3×. Honest payouts stay identical; the *bonus* becomes physics, not a claim a grinder can forge.

**Status — a real step, but NOT closed (corrected by a three-lens independent audit, 2026-08-22).** The
entangled primitive (`premiumIndex` / `verifyPremiumBeat`, in `custody.ts`) genuinely **kills the v1
address-grind**: the read-index is per-nonce, and a PoW-cost-aware filtering attack still yields effective
rate ≤ f (cost ratio 1 + f ≥ 1). Three independent lenses — **Nash · Shannon · Satoshi** — confirmed this
core is sound. **But the wider claim "possession CLOSED" was an OVERCLAIM** (Fano's worst failure), and the
council — attacking independently — caught what the author (its own discoverer) missed. The exam that
"proved" it hardcoded a no-fetch adversary, so it proved a narrower proposition than claimed (Nash and
Shannon found this by *independent* paths — real convergence, not echo):

- **Determinism (the decisive break).** `verifyPremiumBeat` is *verifier-relative* — it returns 0 both for a
  lie AND for "I don't hold this block," with **no abstain state** (unlike v1 `verifyCustody`, which returns
  exact / mismatch / bytes-missing). Two honest nodes holding different atlas fractions compute different
  `entangledPremiumWork` → **non-deterministic**. The only deterministic wiring is fail-close HALT — and
  because the index sweeps the atlas uniformly (the very anti-grind property), a partial holder almost surely
  hits an uncheckable beat and HALTs, so an active premium **forces full replication to follow the tip**
  (centralizing — it refutes "open to a laptop"), or on the abstain-accept path **restores a writer
  mint-privilege** on unheld content. The primitive cannot express the abstain state that would route safely.
- **Streaming.** The atlas bytes are **not in the PoW loop**; the read happens once per *winning* nonce (~1
  read / 2^zeros hashes). So a holder-of-nothing can **stream** the block at challenge time, and with sampled
  `P ≪ M` reads, streaming is **strictly cheaper than storing** as the atlas grows. The entanglement does not
  force storage — it converts a compute-grind into a bandwidth-grind that inverts in the attacker's favor.
- **Unbounded block.** `entangledPremiumWork` sums best-per-block over an unbounded `p.block` — the exact
  free-axis presence already had to close with `presenceTip`. A dormant hazard (the exam tested only 1 block).
- **Storage priced by hashrate.** `premiumWork ∝ f·E_premium` rewards hashrate-gated-by-storage, not storage:
  equal replicas earn unequally, a pure-storage provider (W≈0) earns **zero**, the equilibrium is size-sorted
  → custody *centralizes*, the opposite of the redundancy goal.
- **Redundancy spoofable.** The salt is on the *answer*, not the stored *replica*; one disk fakes R salted
  "copies" for free, so "≈R copies exist" stays unmeasurable — exactly what the retarget must never key on.

**Corrected verdict.** The primitive is a **real improvement over v1** (the compute/address-grind is dead,
proven three independent ways) — but **V2/V4-possession is NOT closed**, and the premium **cannot be wired
today** without either centralizing (full replication) or re-trusting the writer. A full proof-of-storage
needs what the primitive lacks: a **3-state verdict** (valid / provable-lie / can't-check + a checkable
count), a **non-holder-verifiable** retrievability proof (a vector-commitment opening, a SNARK, or
erasure-coded sampling with a fraud-proof + a data-availability layer), premium **windowed to the tip**, a
**storage-priced** meter, and **latency-bounded** challenges so a remote fetch is detectable. That is the
**proof-of-storage frontier**, and it rides on the same decentralization / DA layer that V2/V4-service needs.
The primitive stays **dormant** — activating it today would HALT the network. Kept and honestly scoped: a
step, not the destination. *This correction is the grains-of-truth flow working exactly as designed — it
refused to let a discoverer crown his own ghost.*

## V2 / V4 (service) · possession ≠ service — OPEN, needs a layer we have not built

Even with the entangled PoR, the premium proves you **hold** the data, not that you **serve** it to anyone. A
lazy holder, a streaming re-fetcher, or a bribery-oracle could hold-to-earn without ever answering a peer.
Closing this needs **proof-of-service** — a challenge answered *to another node* — which needs the
decentralized peer layer that is **dormant by design** today. This is the honest frontier: it is the subject
of the decentralization ADR, not a constant we can retarget. Named here so it is never mistaken for closed.

## V3 · the fixed `CUSTODY_PAYOUT_FACTOR = 3` — subsumed

The `3×` is a chosen constant (self-flagged in `custody.ts` as a placeholder to retarget toward *redundancy*).
It is **inert today** (same reason as above). Under the hybrid PoR the multiplier stops being a magic number:
the premium becomes the *physically-measured* fraction held, and its weight retargets to the network's
redundancy target rather than a fixed 3. So V3 is not a separate fix — it dissolves into the hybrid redesign.

## V5 · the anchor draw is uniform — real, bounded, a design trilemma (the Creator decides)

**Verified — the phantoms tested (Rosenblatt's law).** One part was real; two were phantoms the phantom test
judged honestly — one a *good* insight mis-located, one *mostly* hallucination carrying a grain:
- *(real)* the **anchor payer draw** (`AnchorPool.pick = H(beacon|jobId|root|candidates) mod n`) is **uniform
  among candidates**. Same capital, *more identities* → more chances to be the drawn payer and earn
  `perAnchor`: a volunteer with K×minFee sats in **one** offer gets one shot; split into K minFee offers, K
  shots. A sybil vector — **bounded** (each identity parks ≥ minFee; a failed payer is excluded and the job
  re-draws), but real.
- *(phantom → VALID)* the "**uniform draw**" the synthesis first flagged for the *raffle* was a **good
  phantom**: the donation raffle (`raffle.ts`) is in fact work-weighted (chance `work/totalWork`; splitting W
  into N keeps the total `W/total` — sybil-neutral), so the accusation was **mis-located** — but the
  **intuition was TRUE**: a uniform draw *does* exist, at the anchor above. Kept and corrected, not discarded.
- *(phantom → HALLUCINATION + grain)* the "**unverified capacity**" charge against the flat `perAnchor` was
  mostly hallucination — the flat shape is correct and adversarially vetted (fee-proportional is fatal:
  `profit = P·min(sats+100,10⁶) − sats` argmaxes at a ~0.01-BTC deadweight bid; flat makes `profit =
  P·perAnchor − feeSats` strictly decreasing, so the rational fee is the minimum that confirms). The **grain**:
  `perAnchor = 100_000` is a chosen *level* — a magic-number (§M), not a sybil vector.

**Why not a unilateral fix.** Closing it means weighting the draw by a *conserved* quantity, and every choice
is a genuine trade-off — a **trilemma**, pick two:
- **uniform** (today): egalitarian + whale-neutral, but **sybil-vulnerable**;
- **weight by sats offered**: sybil-neutral + matches the "capacity declaration" intent, but **whale-favoring**
  (big capacity wins proportionally more anchors);
- **weight by proven work** (like the fee split & raffle): sybil-neutral + axiom-consistent, but **couples**
  anchor-service to mining (a sats-rich non-miner never wins).

**SOLVED — sats-weighted draw (dormant, proven, 2026-08-22).** The trilemma's sharp edge — "sats-weighting is
whale-favoring" — is de-fanged by a fact re-examined under the phantom test: the anchor is a **trustless
commodity**. Whoever pays the fee, the root reaches Bitcoin and *every node verifies it*, and the reward is
**flat** (`perAnchor`), so weighting the draw by capacity changes *who* is picked — never *how much* they earn,
and never *any power*. A whale wins ∝ the capacity it commits (exactly fair), while **splitting one offer of S
into K conserves the total interval S → sybil-neutral** (the axiom that outranks the egalitarian nicety).
Work-weighting was the earlier guess; sats-weighting is better — it uses the capacity the pool already
declares, needs no external work data, and does not couple anchoring to mining. And because the draw is a
**live operator coordination, not replayed consensus** (offers are never journaled — verified against the
code), the fix is a **per-operator flag** (`ANCHOR_DRAW_SATS_WEIGHTED`, default off), not a seq-gate. Built and
proven: `anchor-draw-v5.test.ts` **6/6** — consolidated == split (ratio 1.02), the uniform contrast reproduces
the ~8× sybil, a whale wins ∝ capacity, dormancy byte-identical — plus 6 anchor suites green. **Honest limit
(named, not hidden):** offers are not escrowed, so a liar can over-offer to dominate ONE draw and then fail —
bounded, `markFailed` excludes them and the job re-draws (one wasted, recoverable pick); bonding the offer
would close even that, if it ever matters.

## V6 · raffle timing bias at tiny N — self-healing

With very few guardians, the public-at-build-time beacon lets a donor wait for a block that favors a chosen
friend. The raffle doc already states the honest limit; with thousands of work-weighted guardians the wait
becomes impractical. It **self-heals with scale** and needs no code change; a KRAY-denominated prize seeded by
the *confirming* block would remove it entirely if ever desired (a future option, not a debt).

## V7 · integer dust — immaterial

The largest-remainder split leaves sub-1-₭ dust whose expectation is ≈ 0 and whose sum is conserved (Hamilton
allocation). Below the unit of account; no advantage accrues. Recorded for completeness.

## V8 · governance √-weight — outside the reward pool

The √-weighted governance surface is a **sybil consideration in the identity/voting layer, not the reward
pool** — it moves no ₭. It rests on a proof-of-personhood trust gate, an explicit trust assumption named in
the governance design. It is not a distribution vector and is out of scope for this ledger; flagged so the
boundary is visible.

## M · magic-number levels — calibration constants, not advantage vectors

A distinct class the atemporality lens (Newton · Kepler) names, and the **grain** the second phantom carried:
chosen *levels*, correct in **shape** but fixed in **value**, so they do not scale with the network. **None
grants an advantage or a sybil edge** — they are calibration setpoints that should become retargeted outputs
at scale (the `ATEMPORALITY-AUDIT` already flags this class). Named so the grain is not lost, and so the two
classes are never confused:

- `BEAT_PAY_ZEROS_CAP = 24` — **lifted** (V1); if variance ever needs bounding, the tool is network-relative.
- `CUSTODY_CHALLENGES = 8` — should breathe with `atlasSize` (custody.ts notes it).
- `CUSTODY_PAYOUT_FACTOR = 3` — a launch placeholder; dissolves into the entangled premium's redundancy setpoint (V3).
- `perAnchor = 100_000` — the grain from the phantom: the flat *shape* is proven correct; the *level* should
  track the real anchor cost as ₭ value and scale move (a retargeted output, like the 3×, not a fixed truth).
- `MAX_ANCHOR_FEE_SATS = 1_000_000` — a griefing guard far above any honest fee; a bound, not a policy.

Retargeting these is **atemporality-calibration** work (its own ADR), decided not defaulted, free at a fresh
genesis — never an advantage vector.

---

## V9 · the v1 contract seal (E1) — CLOSED at the door, the consensus pin next

Found by the 2026-09-17 audit (report 04), confirmed twice by execution. A `contract` event **without a star**
(the v1 seal, message `kray-core.contract.v1|net|from|code`) pays no fee, burns nothing and carries **no nonce**;
its address includes `e.seq`, so the SAME signed event re-submitted is a NEW pot every time — the journal, the
`contracts` map and `contractsRoot` grow for 0 ₭ forever. Constitution Art. VII ("no signature is replayable")
did not hold for this kind.

**Recipe (stamp an integer `at` — the same-instant law refuses byte-identical duplicates on main/signet, so an
un-stamped recipe is a false negative):** one signature over the v1 message from a zero-balance key; apply it
as seq 1..5 with distinct `at` on a `main`-network `KrayLedger` → 5 pots created, balance 0 → 0, burned 0 → 0,
nonce 0, never refused. With identical `at` the second is refused by the same-instant law; regtest accepts all five.

**Status:** refused at every writer door since 2026-09-17 — `prepareMessage` and `buildSubmitEvent`
(`/submit`, `/submit-batch`, the inbox drain, every mirror relay converge there); the "Advanced · v1 pot"
panel retired from the profile page. The reducer keeps accepting v1 below the future `CONTRACT_V1_RETIRED_SEQ`
pin (regtest MAX, signet/main at tip + margin, writer door first, then the fleet) so every journaled byte
replays as before. No v1 seal exists in any live journal (main: 0 `contract` events; signet: 3, all v2 on
stars). Residue, named: v2 seals are nonce-less too, latched one-law-per-star with a 1-₭ burn.

## Conclusion

Every vector the council named is accounted for. **V1 is fixed and proven.** The custody grind
(**V2/V4-possession**) is **proven and its fix is designed** (the entangled PoR — effective rate = fraction
held, ungrindable), waiting only for a dormant slice since custody is inert today; **V3** dissolves into it.
The custody **service** gap (**V2/V4-service**) is the honest open frontier — it needs the proof-of-service
layer that rides on decentralization. **V5** is a real but bounded anchor-draw sybil that is a genuine
trilemma for the Creator to decide. **V6/V7/V8** are self-healing, immaterial, or outside the pool.

Two of the loudest synthesis findings were **phantoms** the code already closed (the raffle is work-weighted;
the flat anchor reward is correct-by-design) — caught by verifying against the real code, which is the whole
discipline: *the real pattern, never the phantom.*

Nothing is left behind: fixed, proven-and-designed, decided-by-the-Creator, or honestly deferred with its
reason — each vector has a name, a status, and a path.

---

## Addendum 2026-08-23 — the `reward` retirement (the last writer-trusted payout) + one new named residue

**THE RESIDUE.** The unsigned `reward` kind moved ₭ from the fee pool on the writer's word — conserved and
pool-bounded (never inflation), but its ENTITLEMENT was not re-derivable on replay, and the outflow was
near-invisible (no `from` field ⇒ absent from address feeds; `conserves()` true by construction).

**THE MEASUREMENT (adversary lens, live).** Pool = 7 ₭, accruing 4.63 ₭/day; the live journal (149/149
replayed) holds **zero** `reward` events; the anchor backstop is disabled on every node. Decisive: ~8 s of
laptop CPU reaches 2^24 under the LIVE pay-cap and takes ~99 % of the same pool through the *self-proving*
`settlement` path — so `reward`'s marginal power was ≈ 0.06 ₭. The residue was real, conserved, negligible,
and dominated by the true frontiers (omission/ordering — ADR-3, since ratified and born active at seq 0 on both nets; the pot custody key).

**THE VERDICT (both lenses converged): retire, don't armor.** The proposed SPV+draw hardening was REFUTED as
a false-green — `AnchorPool`'s candidate set is writer-local and never journaled, so a journaled draw would
prove the anchor (already provable) and not the entitlement. **Shipped instead:** `REWARD_RETIRED_FROM_SEQ = 1`
on every network (provably byte-identical — R-03 pins the equivalence on a reward-free journal);
`node.settle()`/`node.reward()` deleted; the dev `/settle` door is 410; the anchor-backstop claim still ADOPTS
the guardian's seal (the real value) but pays nothing until its self-proving successor exists — **first valid
sealer, the SPV proof AS the entitlement, no draw**. Proven: `reward-retired.test.ts` 19/19 + the full
affected regression; `economics-guardian` upgraded to earn the pool by real mined beats. With this, **no ₭
moves anywhere — fee, pot, payout — without a stranger being able to re-derive the reason from bytes.**

**NEW NAMED RESIDUE (found by the design lens, deferred with its reason).** The optional-proof pattern
(`donate`/`rune-deposit`/`rune-settle`: `if (e.proof) verify…`) binds the proof to the journal hash-chain,
not to the anchored cascade root — the root hashes *state*, so a journal variant with the proof stripped
reaches the same anchored root. Ingress refuses proofless events on live doors, so this is a
**replay-presentation residue, not a live mint vector** — but making those proofs *mandatory-from-a-seq*
(the retirement's own pattern) is the clean future slice. Named here so the path is always visible.
