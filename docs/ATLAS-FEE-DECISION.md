# The Atlas Fee — the Creator's decision brief (storage-side of the Space Trinity)

> **Status: RATIFIED (the Creator, 2026-08-23) — branch A BUILT, additive.** The wall-toll lives in
> `ledger.ts` (`ATLAS_FEE_ACTIVATION_SEQ` + the inscribe/origin charge beside the untouched burn) and
> the door quotes it (`atlasFee` in every prepare answer, from `Ledger.atlasFeeOf`). Proven by breaking
> in `src/test/atlas-fee.test.ts` (21 checks: dormant default, the boundary, size pricing, split
> neutrality, conservation, whole-act refusal, zero-byte exemption, replay, root gating). Signet seq is
> pinned at deploy as tip+margin (the deploy-race rite); mainnet is born activated (0); regtest stays
> MAX so lab goldens replay byte-exact. This brief remains as the design record; entities and the
> adversary below are the council that shaped it.
>
> **CROSSED LIVE (2026-08-23, the atlas crossing rite):** Signet pinned at **seq 165** (tip re-read as
> 157 during the rite, +8 margin). Fleet updated FIRST (the three book-check houses), then the writer. Signed
> transfers walked the tip to 164; the door flipped `atlasFeeActive=true` at the doorstep; a 65-byte
> inscribe landed exactly AT seq 165, quoted burn 1 ₭ + atlas 1 ₭. The 165-event live journal replays
> byte-identical under the shipped constants, TREASURY grew by exactly 1 ₭ at seq 165 (re-derived from
> the bytes, not asserted), conservation holds, and writer + all three guardians serve the same root
> `d17961b9…` at the same seq — no fork, no HALT. The wall is paid.

## The gap, in bytes (verified 2026-08-23, file:line)

- A creative act **burns** ₭ linearly with size (`ledger.ts:935` → `starBurnOf`, 1 ₭ per
  `bytesPerKrayNow`, weekly retarget) — the SIZE-BURN LAW, the Creator's full-deflation decision of
  2026-08-13 (`kray-primitives.ts:266`). **The burn pays nobody. That is its point.**
- A money act pays the eternal `MIN_FEE = 1 ₭` to `TREASURY` (`ledger.ts:715/:761`), and TREASURY
  settles to validators on every proven seal, weighted by proven work with the up-to-3× custody
  multiplier for library holders.
- An **inscribe/origin pays NOTHING to TREASURY** (`ledger.ts:925–960` — burn only). So the people
  who hold the atlas are funded by **act count**, while their cost grows with **bytes held**.

**The threat this opens (why now):** at the Ӿ activation (seq 155) the network's money becomes
tradable; if inscription demand rises with it, the atlas wall grows in GB while the storers' income
does not grow with a single byte of it. Conservation doctrine says the wall must be paid for by the
one who builds on it.

## The design (branch A — the only axiom-consistent one)

One new component at the inscribe/origin gate, priced by the SAME law and the SAME breathing rate:

```
atlasFee(size) = 0                                  if size == 0   (names, empty stars: unchanged)
atlasFee(size) = max(1, ceil(size / bytesPerKrayNow))   otherwise
```

- **Credited to TREASURY** (the existing fee pool) — settled by the existing proven-work split with
  the existing custody multiplier. No new pool, no new oracle, no new grind surface.
- **The burn is untouched.** Full deflation stays word-for-word as ratified: the same act burns the
  same ₭ into the star. The fee rides BESIDE the fire, never instead of it.
- **Linear, therefore split/merge-neutral** — the same Cauchy theorem that shaped the burn: slicing
  a song into chunks or gluing spam into one monster changes nothing about what it costs.
- **One rate, one breath**: the fee reuses `bytesPerKrayNow`, so the weekly retarget prices both
  components together. A flood doubles BOTH the fire and the wall-toll against the flooder.
- **Activation-gated per network** (`ATLAS_FEE_ACTIVATION_SEQ`, MAX until ratified): below the seq
  the fee is absent and history replays byte-identically (A3); mainnet may be born activated.
- Genesis-rate example: a 21 MB star costs 21 ₭ burned + 21 ₭ to the wall = 42 ₭; a 1-byte poem
  costs 1 ₭ burned + 1 ₭ to the wall; a name stays exactly 1 ₭.

## The adversary's refutations (each one answered in the design)

1. *"A fee credited to TREASURY is inflation."* — No: payer-funded, conserved. The tripwire
   (`circulating == emitted − burned`) holds on every apply and replay; credit-TREASURY equals
   debit-payer, no ₭ is created.
2. *"The writer can profit from it."* — No: TREASURY settles by proven work (beats), the writer
   holds no settlement privilege, and a follower re-derives the whole table.
3. *"It reopens the proof-of-storage grind (V2/V4)."* — No: the fee funds the SAME pool metered by
   the SAME custody multiplier already council-vetted. Nothing pays a specific holder per byte, so
   no new targeting surface exists. V2/V4 stays the honest open frontier it already is.
4. *"It breaks replay."* — No: gated by the Article XIV activation machinery, exercised live at the
   pen crossing. Below the seq, byte-identical.
5. *"It taxes the poor creator twice."* — Named honestly: the total cost per MB doubles at the
   genesis rate. That IS the decision — the wall was free until now, and free walls fall. The floor
   protects the smallest acts: a name or empty star pays no atlas fee at all.

## Discarded branches (named, per the Echo law)

- **B · split the burn** (X% of the fire to TREASURY): REFUSED — it weakens the ratified
  full-deflation law. The fire is the Creator's word; we do not negotiate with it.
- **C · re-weight the existing pool only** (no new charge): REFUSED — the pool's income stays
  act-count-driven; the byte-growth gap this brief exists to close remains open.
- **D · pay specific holders per byte held**: REFUSED for now — that is the V2/V4 proof-of-storage
  frontier (retrievability proofs, latency bounds, DA layer); building it as a fee route today would
  crown exactly the grind the residual-vectors audit refused.

## The one decision for the Creator

Ratify the atlas fee (branch A)? If yes: the constants land dormant (`MAX`), the build is additive,
proven by breaking (conservation storm + split-neutrality + activation-boundary goldens), the fleet
deploys FIRST, and a future seq above the live tip is pinned at ratification — the same rite the pen
just walked. If no: the gap stays named here, honest and open.
