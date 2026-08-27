# The Validator Raffle — full design, and the bug that shapes it

> Status: **design review**. The raffle primitive is proven (`raffle.ts`, `raffle.test.ts` 8/8). This document works
> out the exact transaction, the exact seed, and every failure mode — including one that reshapes the whole idea.

## 1 · The transaction, part by part

One donation is one keyless Bitcoin transaction, signed by the donor's wallet. It does everything at once:

```
INPUTS   the donor's own UTXOs (say 5,000 sats + a little for fee)

OUTPUT 0 the ANCHOR — seals the KRAY state (all past fast blocks) onto Bitcoin.
         Two equivalent ways to carry it:
           (a) OP_RETURN  "KRAY.NETWORK"|ver|blockNumber|cascadeRoot   (49 bytes, 0 sats) — visible
           (b) pay-to-contract in the BURN output's key                (0 extra bytes)     — stealth
         (b) is what self-anchor.ts already does; (a) is the classic magic OP_RETURN.

OUTPUT 1 the BACKING BURN — the sats that MINT ₭. Paid to the NUMS key (unspendable), so they are
         DESTROYED forever. This is what backs the mint (see §3 — this is the crux).   e.g. 4,500 sats

OUTPUT 2 the RAFFLE — the surplus, paid to ONE validator chosen by Bitcoin's hash (see §2).  e.g. 400 sats
         MINTS NOTHING (see §3). Omitted when it would be dust (< 546) or no validators have work.

FEE      to the Bitcoin miner — the cost of confirming (and of the anchor). This is already "sats to
         the miner", exactly your Idea 1, and it needs no key.                              e.g. ~100 sats
```

The donor's KRAY address (who receives the minted ₭) is derived from the **spending input's own public key** —
the transaction is signed by the donor, so the input proves who they are. No extra bytes, no second OP_RETURN
(Bitcoin relay policy allows only one OP_RETURN per tx anyway).

`verified`: outputs 0(b)+1 are exactly `self-anchor.ts` today. Output 2 + input-derived donor are `proposal`.

## 2 · The seed — which Bitcoin hash directs the raffle

The raffle winner must be a value **both the donor (at build time) and every node (at verify time) compute
identically**. So the seed and the candidate set must both be pinned to things that cannot drift:

- **The candidate set** = the validators and their proven work **as of the KRAY block the anchor seals**. That
  set is committed inside the `cascadeRoot` in OUTPUT 0. So the node re-derives the exact same set from the exact
  root the donation anchored — no "the set changed between build and verify" bug.
- **The seed** = the **beacon of that anchored KRAY block** — i.e. the Bitcoin block hash that KRAY block already
  recorded as its beacon. It is fixed the moment that block sealed, so it cannot be reorged out from under the
  raffle, and every node reads the same one.

Then, exactly as proven in `raffle.ts`:

```
draw   = sha256("kray.raffle.v1|" + beacon) mod totalWork      # a uniform point in [0, totalWork)
winner = the validator whose cumulative-work interval contains `draw`   # canonical order, work-weighted
```

### Why it CANNOT be a future block's hash (the keyless limit)

The only way to make the winner **secret/unknown at build time** is to seed from the block that will *confirm* the
donation — which does not exist yet when the wallet signs. Paying a not-yet-known winner would require the sats to
sit somewhere and be released later **by a key** — the exact custodian we are removing. So for a **real-satoshi**
prize the seed is necessarily a hash known at build time: the winner is **public and unbiasable, but not secret**.
(A *secret* raffle is only possible if the prize is **₭** — the ledger can settle it against the confirming block,
because ₭ needs no Bitcoin key. Real sats cannot.)  `verified` (this is a protocol limit, not a coding choice).

## 3 · THE BUG — a raffle that MINTS is infinite inflation

This is the one that reshapes the idea. Our supreme law is **every ₭ is backed by a sacrificed sat**:
`emitted ≤ satsDonated`. "Sacrificed" has to mean **destroyed**, and here is why:

> Suppose the raffle payout counted as backing (minted ₭ for the donor). Donor sends 4,500 sats to validator V and
> mints 4,500 ₭. **V now holds 4,500 spendable sats.** V donates the *same* 4,500 → mints another 4,500 ₭ → the
> surplus lands on V2 → V2 donates them again → … The same 4,500 real sats mint ₭ **forever**. Unbacked inflation.

`verified` by construction: **any sats that stay spendable (a validator's payout) can re-mint. Only DESTROYED sats
can back the mint.** Burning (NUMS, output 1) is true destruction — the sats can never re-mint. A miner fee is
*mostly* destruction (it leaves to a diffuse external party). A validator payout is the **opposite** of
destruction — it hands spendable coins to a known participant, so it must mint **nothing**.

### The rule that keeps money sound

```
MINT is backed ONLY by OUTPUT 1 (the burn) — the destroyed sats.        emitted ≤ satsBurned
The RAFFLE (OUTPUT 2) is a plain transfer — it backs no ₭, it mints nothing.
```

The node credits ₭ **only** for the value paid to the NUMS burn key, and treats the raffle output purely as "the
donor also chose to reward a guardian." No re-mint is possible, because the validator's coins were never counted.

## 4 · Every failure mode, and how it fails closed

| # | Risk | Handling |
| --- | --- | --- |
| 1 | **Re-mint inflation** (§3) | mint is backed by the BURN only; the raffle mints nothing — `verified` |
| 2 | **Reorg changes the seed** | seed = the *anchored KRAY block's* beacon, fixed at seal — not the live tip |
| 3 | **Validator set drifts** build→verify | set is pinned by the `cascadeRoot` the anchor commits |
| 4 | **Winner has no payable address** | fall back to burn (the surplus joins output 1) |
| 5 | **Surplus is dust** (< 546) | no output 2 — the surplus is burned |
| 6 | **Empty / zero-work set** (bootstrap) | `raffleWinner` returns null → surplus burns |
| 7 | **Sybil (fake validators)** | raffle weighted by work → splitting work is neutral — `verified` (8/8) |
| 8 | **Donor pays the WRONG winner** | node re-derives the winner; a mismatched output 2 → the raffle is void (still burns/mints from output 1), never a wrong credit |
| 9 | **Timing-grind** (donor waits for a favorable beacon) | irreducible for a keyless real-sat raffle; made irrational by work-weighting + thousands of validators + a tiny prize. Honest residual, not a crash. |

## 5 · The sound model (recommended)

Each donation, in the donor's own keyless transaction:

1. **Anchor** rides free (output key, pay-to-contract) — seals every past fast block. `verified`
2. **Backing burn** (output 1, NUMS) — the destroyed sats that MINT the donor's ₭. Soundest possible backing.
3. **Raffle cut** (output 2) — a small % to a work-weighted, Bitcoin-seeded validator. Real sats to a KRAY
   guardian, **minting nothing**, so no inflation. This is what recycles the sacrifice into decentralization —
   more real-Bitcoin reward for running a node → more independent validators. Sybil-neutral. `proposal`
4. **Miner fee** — the confirmation cost (your Idea 1, keyless).

The donor mints slightly less than they spend (the raffle cut), and that cut is what pays the guardians in real
Bitcoin, on top of their ₭ fees. Sound money (backed by burn), keyless, Sybil-neutral, and it actively funds the
decentralization we still need.

**Open decision for the Creator:** the raffle cut is *donor-funded* (a small, opt-in % that mints nothing). If a
guardian reward in **real Bitcoin** is worth donors minting ~90% instead of 100%, the raffle is in. If not, the
clean fallback is **pure burn** (mint 100%, guardians paid only in ₭ from fees). Both are sound and keyless.
