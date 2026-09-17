# Anchoring Unification (Slice 2) — retire the operator, keep every proof

> **Status (label, 2026-08-19):** largely **executed**. The operator OP_RETURN is
> opt-in (`KRAY_OPERATOR_ANCHOR=1`). The common seal is the donation itself
> (self-anchor). The any-guardian backstop is wired. Do not treat the
> “three mechanisms today” snapshot below as the live map — that was the
> plan-of-record. Remaining edges: [`MAINNET-READINESS.md`](MAINNET-READINESS.md).
> Supreme law unchanged. Body kept as the record of the plan.

> Original design preface (kept): no consensus code changes until the Creator approves this plan. Supreme law unchanged:
> `signature ‖ SPV proof ‖ Bitcoin anchor`. The security of anchoring never depended on WHO writes the anchor —
> only on "the committed root must reproduce from a replay, and Bitcoin's work decides ties". That stays exact.

## Where we were (three mechanisms — 2026-08-19 snapshot; NOT the live map)

> Live map today: the operator OP_RETURN is **opt-in** (`KRAY_OPERATOR_ANCHOR`, default off), the
> self-anchor **does** feed fork-choice (dual-carrier `verifySealProof` in `spv.ts` accepts OP_RETURN
> or the NUMS self-anchor script), and the anchor pool is **wired** behind `KRAY_ANCHOR_POOL=1`.

1. **Operator OP_RETURN anchor — LIVE.** `maybeAnchor` → `recordAnchor` → `broadcastAnchorSeal` writes a
   `KRAY.NETWORK|ver|blockNumber|cascadeRoot` OP_RETURN, funded from the operator's own Bitcoin wallet, every
   `ANCHOR_EVERY` value-blocks. This is the last operator dependency in anchoring.
2. **Self-anchor log — LIVE (Slice 1).** Each burn donation's output pay-to-contract-commits a cascade root;
   recorded + re-verifiable at `/api/kraynet/self-anchors` (`verified` = the root is one this node produced). It
   does NOT yet feed fork-choice.
3. **Any-guardian anchor pool — BUILT, UNWIRED.** `economics/anchor-pool.ts` (`AnchorPool`, `rewardFor`,
   beacon-drawn payer) + `anchor-payer.test.ts` exist and pass, but are wired nowhere in the server (grep = 0).

Fork-choice (`consensus.ts` `chooseCanonical`/`provenWeight`) weighs anchors proven by `verifySealProof` — an
OP_RETURN seal. It does not yet recognise a pay-to-contract (self-anchor) commitment.

## Target: the operator is gone, anchoring is permissionless, every proof stands

- **Every donation IS the anchor** (self-anchor, keyless, free) — the common case.
- **In quiet periods, any guardian may anchor and earn ₭** (the wired AnchorPool) — the backstop, so the network
  never goes stale for lack of a donation. Payer drawn by the Bitcoin block hash, work-weighted, sybil-neutral.
- **No operator OP_RETURN** — retired, or kept only as an explicit last-resort a node-runner can enable.
- **Fork-choice is unchanged in spirit**: a root only counts if a replay reproduces it, and Bitcoin's work orders
  the rest. A fabricated root is `refuted` (weight 0) no matter who published it.

## The three parts

### Part A — the self-anchor becomes a first-class anchor (feeds fork-choice)
`verifySealProof` (or a sibling) learns a second proof shape: an output that pays
`selfAnchorScriptHex(internalKey, KrayAnchor.payload(blockNumber, root))`, buried ≥ SEAL_CONFIRMATIONS, whose
`root` reproduces from the journal at `blockNumber`. Then `provenWeight` counts self-anchors exactly like OP_RETURN
anchors — same Bitcoin-work weighting, same `refuted`-on-mismatch. `verified` in the self-anchor log already does
the root check; this adds the SPV burial + wires it to the weight. `inference` until tested on signet.

### Part B — wire the any-guardian backstop (AnchorPool)
Connect `AnchorPool` to the server: a guardian registers a signed standing offer; when a seal is due and no
donation has anchored it, the payer is drawn from the triggering Bitcoin block hash (pure function, unbiasable),
broadcasts the anchor, and is credited a ₭ reward from the fee pool proportional to sats actually spent —
conserved, sybil-neutral (`rewardFor`). A drawn payer who doesn't pay is excluded and the job re-drawn; the
backlog stays O(1) (one anchor seals everything since the last). `anchor-payer.test.ts` already proves the payer
math; this is wiring + the reducer credit path. `proposal`.

### Part C — retire the operator anchor + recalibrate the mint window
- `maybeAnchor` stops broadcasting from the operator wallet by default (`KRAY_OPERATOR_ANCHOR=1` to keep it as a
  last resort). Anchoring now comes from donations (A) or the guardian pool (B).
- **The window law:** today `anchorSpend` (the operator paying a fee) reopens the mint deficit. With no operator
  spend, reopen the window **per confirmed seal** instead: each anchor Bitcoin buries reopens a fixed increment of
  mint capacity. This keeps the anti-whale/rate regulator, sourced from the network's proven Bitcoin heartbeat
  rather than an operator spend. Deterministic, re-derivable, no operator. `proposal`.

## Security — does retiring the operator open a vector? NO (integrity)

| Concern | Answer |
| --- | --- |
| Inject a fake anchor | Already possible today (anyone can write a `KRAY.NETWORK` OP_RETURN); already rejected — a fabricated root can't reproduce from a replay (`refuted`, weight 0). Removing the operator changes nothing here. |
| Bribe the anchoring | Nobody to bribe: the canonical anchor is decided by (root reproduces from replay) + (Bitcoin work), not by any party's choice. |
| A donation seals a fake root | The self-anchor verify requires `root` be a real root this node produced (genesis root or a sealed block's root). A fake root is not recorded and counts for nothing. |
| Sybil the guardian backstop | Payer draw + reward are work-weighted → linear → sybil-neutral (same theorem as the fee split, proven). |
| Liveness (a real gap, not integrity) | Handled by B: any guardian anchors in quiet periods for a reward, so the network never goes stale. |

Retiring the operator **removes a party, not a check.** Every anchor remains Bitcoin-proven and replay-verified.

## Compatibility matrix (Part A, the consensus-touching one)

| Layer | Verdict | Evidence |
| --- | --- | --- |
| Bitcoin consensus | valid `verified` | a self-anchor is an ordinary taproot output; already on-chain (tx 39f5825b…) |
| Relay / miner | relayed `inference` | standard outputs; confirm on signet |
| Canonical `ord` | ignored (benign) `inference` | not an inscription/runestone |
| KRAY fork-choice | weighed `proposal` | `verifySealProof` extended to the pay-to-contract shape + root-replay |
| Auditor | re-verifiable `verified` | derive the burn script from (internalKey, payload) + match the output |

## Rollout (gated, tested — no big-bang consensus change)

1. **2a — DONE, `verified`.** `verifySealProof` recognises the self-anchor shape (re-derives
   `selfAnchorScriptHex(NUMS, payload(blockNumber, root))` from the raw bytes, same burial law); proven in
   `self-anchor-seal.test.ts` (8/8): identical work weight to an OP_RETURN of the same root, fabricated
   self-anchor `refuted`, both shapes prove the same root. Full suite green.
2. **2b — DONE, `verified` live.** The AnchorPool backstop is wired behind `KRAY_ANCHOR_POOL=1`:
   - core: `satisfied(root)` (the pool yields to ANY external anchor — donation or operator — rewarding
     nobody; a stale seal cannot cancel a newer target) + `snapshot()/restore()` (offers/job/settlements
     survive reboots; hostile snapshot → empty pool). `anchor-backstop.test.ts` 17/17.
   - server: signed standing offers (timestamp-monotonic anti-replay) → every unanchored value-root becomes
     the single coalesced job → quiet window (`KRAY_ANCHOR_POOL_QUIET_MS`, default 30 min) → draw by Bitcoin
     block hash (claim window = last 6 beacons) → the drawn guardian broadcasts the 49-byte payload from
     their OWN wallet → claim is signed + SPV-proven by the SAME `verifySealProof` consensus uses → fee
     derived from raw txs (never client-declared) → reward journaled as a `reward` event **from the fee
     pool, capped at what it holds — conserved, never minted**.
   - `anchor-backstop-e2e.mjs` 19/19 against live regtest bitcoind: unsigned offer/claim refused, replayed
     offer refused, operator seal stands the backstop down, undrawn claimant refused, real 364-sat anchor
     SPV-claimed, reward capped at the 3-₭ fee pool, drained to zero, claim replay refused.
3. **2c — DONE, `verified` live (Creator-approved 2026-08-10).** The operator is retired; the window beats
   with Bitcoin:
   - **The window law** (consensus): new event kind `seal` — a CONFIRMED Bitcoin seal (any shape) reopens
     EXACTLY `WINDOW_PER_SEAL_SATS = MINT_CAP_SATS = 10,000` of mint capacity, ONCE per Bitcoin txid, ever
     (`sealedTxids` in the reducer; duplicate/malformed refused before mutation; empty-pot seal is a defined
     consumed no-op). The consumed-seal set folds into the cascade root **append-only**: a zero-seal history
     hashes byte-identically to the pre-2c format, so the genesis root the first real burn sealed
     (`b35f059e…`, tx 39f5825b…) and every historical anchor still re-derive exactly — no proof orphaned.
     Pinned in `window-law.test.ts` (22/22), full suite green.
   - **Operator OFF by default**: `maybeAnchor` broadcasts only with `KRAY_OPERATOR_ANCHOR=1` (explicit last
     resort — a party removed, never a check). Offline dev keeps its clearly-marked simulated markers, which
     never touch the window. Seal hooks journal the reopen at every confirmation site (donation self-anchor,
     guardian claim, operator flip) + an idempotent boot sweep (`hasSeal`); `seal` events are system events
     (`blockHasValue` excludes them — no anchor feedback loop). A donation's confirmed seal is also adopted
     into the anchor log (root-matched) so the explorer shows it first-class.
   - Live: signet runs with NO operator anchor; the historical operator seal AND the first real burn each
     reopened 10,000 ₭ of window once; reboot re-derives blocks and journals nothing twice. The 2b regtest
     e2e (19/19) passes unchanged under the 2c code with the operator flag on.

Nothing is removed before its replacement is proven. At each step the full suite stays green and the live signet
chain keeps anchoring (belt-and-suspenders until the operator anchor is provably redundant).

## Redemption resilience (shipped alongside)

A self-anchoring donor who lost the client context (wallet reinstall) redeems FOREVER with a bare `{txid}`:
`discoverSelfAnchor` re-derives the burn script for every root the node ever produced (live tip, genesis,
recorded self-anchors, every sealed block) and tests it against the tx's actual outputs. Discovery only CHOOSES
the script to verify against — `verifyDonationProof` remains the sole judge of the mint, and `credited-once`
still bars any double. Proven live on signet: the real burn 39f5825b… submitted bare now reaches the ledger and
is refused only by "already credited". `/donate/prepare` also moved to the indexed `scanUtxos()` (12-s cache +
address indexer) — the "Scan already in progress" collision is gone (130 ms prepare on the live signet node).
