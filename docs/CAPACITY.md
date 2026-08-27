# CAPACITY — what a KRAY validator must carry, out to 20 years

> **Status: DESIGN (measured study) — figures from the pre-burn-era journal; method current, numbers due a re-measure.**
> The unit costs and 20-year tables were measured before proof-of-burn minting, beats and custody reshaped
> the record mix (the compact interval record at the end IS implemented and live). Treat the storage *targets*
> as the design constraint; re-measure the per-record bytes on the live v2 journal before citing them.

Every number below is derived from **bytes measured on a live node**, not
estimated: 52,608 journal events across 5,802 sealed blocks and 1,099 real
inscriptions. Measure again anytime — the journal is right there.

## Measured unit costs

| Record | Bytes | Written when |
|---|---|---|
| `emit` (per validator) | 308 | every emission interval |
| `reward` (per validator) | 286 | every emission interval |
| glow line (per validator) | 309 | every emission interval |
| `settle` | 217 | once per interval |
| fast-block record | 309 | every fast block (~3.5s) |
| `transfer` | 386 | per user action |
| `inscribe` (the 32-byte commitment, **not** the content) | 452 | per user action |
| `name` | 339 | per user action |
| `transfer-star` (relic move) | 398 | per user action |

An emission interval is **one Bitcoin block** (~52,560/year) — the curve is
Bitcoin-clocked. Fast blocks only seal; they do not settle.

## The 20-year projection

| Scenario | Validators | Actions/day | CHAIN (mandatory) | CONTENT (optional) |
|---|---|---|---|---|
| Conservative | 100 | 5,000 | **154 GB** | 418 GB |
| Expected | 1,000 | 100,000 | **1.2 TB** | 16.7 TB |
| Mass adoption | 10,000 | 2,000,000 | **14.3 TB** | 490 TB |

Reference points for scale: Bitcoin's full chain is ~650 GB after 16 years
(~50–60 GB/yr now); a pruned Bitcoin node verifies everything in ~10 GB; an
`ord` index costs ~100–150 GB on top of Bitcoin, or 400+ GB with `--index-sats`.

> **STATUS: FIXED.** The finding below was acted on before mainnet — settlement
> and Glow are now written as ONE compact record per interval. Measured after
> the change: **169 bytes per validator per interval instead of ~903 (5.4×
> smaller)**, proven by `npm run test:settlement` and the full hermetic suite
> including the 10,000-year assault. The 20-year table above is the OLD model;
> the corrected one is at the end of this document.

## THE FINDING — 73% of chain growth is bookkeeping, and it is fixable NOW

At 1,000 validators the chain grows 60.4 GB/year, and **44.2 GB of that is
`emit` + `reward` + glow written once per validator per interval**. That term
is O(validators × intervals): it is not user activity, it is accounting.

Writing the interval's settlement as ONE aggregate record (a packed
validator→amount table) instead of three lines per validator:

| Validators | Today | Aggregated |
|---|---|---|
| 1,000 | 1,208 GB | **329 GB** |
| 10,000 | 9,164 GB | **373 GB** |

Ten thousand validators would then cost barely more than one thousand — the
network scales in people without scaling in bytes.

**Why this must be decided before mainnet:** the journal IS the chain, and
axiom A3 forbids hard forks. The record format is consensus. It can be
designed freely today and never again.

## Why CONTENT is not the same problem it is for Ordinals

On Bitcoin, inscription bytes live **inside the blocks** — every full node
carries every image forever, and that is why the chain and the `ord` index
have grown the way they have.

On KRAY the chain seals a **32-byte commitment**; the bytes live in a
content-addressed store beside it (the filename IS the sha256). Consequences:

- A validator can verify the **entire** network — conservation, star map,
  governance, cascade root, the Bitcoin anchor — holding **zero** content.
  This is the KRAY equivalent of a pruned Bitcoin node, and it is the honest
  floor of participation.
- Content is shardable by design: nodes hold what they choose, prove they hold
  it, and get rewarded for it (the storage-proof layer builds on this store).
- Anyone re-hashes a served file and checks it against the sealed commitment,
  so a stranger serving content can never lie about it.

## Recommended targets

| Profile | Carries | 20-year budget |
|---|---|---|
| **Verifier** (floor) | chain only | ~150–400 GB |
| **Guardian** (default) | chain + recent/own content | ~1–2 TB |
| **Archivist** | chain + full content | tens of TB, rewarded |

A 2 TB consumer SSD in year 20 is the target for the default guardian. That is
the design constraint every future decision should be checked against.

## Levers, in order of effect

1. ~~**Aggregate settlement records**~~ — **DONE** (see below).
2. **Fast-block cadence** — 3.5s → 30s saves ~46 GB over 20 years. Cheap, and
   costs UX responsiveness; revisit only if needed.
3. **Content policy** — the 400,000-byte ceiling per inscription is already the
   main brake; sharding + storage proofs handle the rest.

---

# AFTER THE FIX — the compact interval record (implemented)

An interval no longer writes `emit` + `reward` + a glow line per validator. It
writes **two records, whatever the validator count**:

- `settlement` in the ledger journal — `[address, subsidy, reward]` per row,
  validated as one atomic table (the 10,000-₭ mint cap, vault/pool solvency, no repeated
  address, no protocol account, no zero row) and closing the interval in the
  same stroke;
- `earn-many` in the Glow journal — `[address, points]` per row, same law per
  row as the single `earn`.

**Measured on a fresh node** (50 validators × 50 intervals): 223,104 journal
bytes + 198,634 glow bytes = **169 bytes per validator per interval**, against
~903 before — **5.4× smaller**, and the whole hermetic suite plus the
10,000-year assault stay green (conservation to the unit, star ranges
identical, reboot-exact to the same cascade root).

## The corrected 20-year chain projection

| Scenario | Validators | Actions/day | Before | **After** |
|---|---|---|---|---|
| Conservative | 100 | 5,000 | 154 GB | **82 GB** |
| Expected | 1,000 | 100,000 | 1,208 GB | **489 GB** |
| Mass adoption | 10,000 | 2,000,000 | 14.3 TB | **7.1 TB** |

For scale: Bitcoin's own chain is ~650 GB after 16 years. In the expected
scenario a KRAY validator carries **less than a Bitcoin node** while holding a
network with orders of magnitude more activity — and the verifier floor (chain
only, no content) fits any laptop.

## What remains, honestly

At mass adoption the per-validator term is still O(validators × intervals):
7.1 TB is dominated by 10,000 addresses × 52,560 intervals × 169 bytes. The
next lever, if that day comes, is **address indices** — a validator registry
where a settlement row references a 3-byte index instead of a 62-character
address, which would cut the row to ~20 bytes and the 20-year figure to under
1.5 TB. It is not needed now, and it can be added the same way this was:
before it matters, never after.
