# THE RUNE VACUUM — turning any Bitcoin rune into a proven KRAY L2

KRAY already proves its own money. This is how a citizen turns **their own rune**,
etched on Bitcoin L1, into an L2 asset here — with the accounting proven rather
than promised, and the road back to L1 always open.

The rule this document is written under: **a user should never have to trust
anyone about how many runes exist on L2, who owns them, or whether the L1
reserve still covers them.** Every one of those must be a consequence of a
Bitcoin fact they can check themselves.

## 0 · The one technical fact that shapes everything

Runes are **UTXO-native**. A rune balance is not a database row an indexer
maintains (as with BRC-20) — it lives in the UTXO set, written by runestones in
`OP_RETURN`. So a rune balance is provable by **the UTXO plus its ancestry**: the
transaction that created it, the transactions that fed it, back to the etch or
mint. Each link is an ordinary Bitcoin transaction, and KRAY already proves
ordinary Bitcoin transactions from raw bytes (`anchor/spv.ts`: tx → txid →
merkle → header chain → depth).

That is the whole opening: **a rune deposit can be proven to a light verifier**,
if the depositor carries the ancestry with the claim. Nobody has to be believed;
the claimant does the work, and the reducer checks it.

## 1 · The trilemma every Bitcoin L2 hits (and where each project lands)

Without covenants, no Bitcoin L2 gets all three at once:

1. assets transfer freely **off-chain**,
2. the **current holder** can exit unilaterally,
3. **no trusted operator set**.

| | 1 · off-chain transfer | 2 · unilateral exit | 3 · no trusted set |
|---|---|---|---|
| Lightning | only along channels/routes | ✅ | ✅ (2-party) |
| Ark | ✅ | ✅ (with expiry) | ⚠️ ASP can grief |
| **Spark (statechain family)** | ✅ | ✅ | ⚠️ documented as **"1-of-n trust assumptions and perfect forward security"** — FROST signing among Signing Operators; safety rests on at least one operator behaving (deleting key material) |
| Liquid (federated sidechain) | ✅ | ❌ | ❌ |
| Ethereum rollups | ✅ | ✅ | ✅ — but needs L1 verification Bitcoin does not have |

Spark's own docs state the trust model as *1-of-n* with *self-custody and
unilateral exit guarantees*. It is an honest, well-chosen point in the trilemma.
KRAY's aim is not to pretend the trilemma away — it is to land on the same point
and then make **everything that can be proven, proven**, so the trusted part is
as small, as visible and as accountable as mathematics allows.

## 2 · KRAY's answer, in four proofs

### Proof 1 — MINT: the credit exists because Bitcoin says so

A deposit is claimed with a bundle, not a message:

```
deposit = { rawTx, txoutproof, headers, ancestry[] }
  txid  = sha256d(rawTx)                     the tx is exactly these bytes
  txid ∈ merkle → header, headers chain      Bitcoin buried it, ≥ N deep
  runestone decoded from the tx's OP_RETURN  which runes moved, and where
  ancestry[] proves the inputs' rune balance recursively, each link SPV-proven
  an output pays the shared bakery POT       parsed structurally, never claimed
⇒ credit exactly that amount of rune R, once, to the Taproot key that paid the pot
```

Each deposit outpoint is credited **exactly once** (the reducer keeps the spent
set), so a replayed proof mints nothing. A node that cannot decode or verify the
bundle **refuses** — it never mints on doubt.

### Proof 2 — SOLVENCY: an equation, not a dashboard

The vault is a public Taproot address. Its rune balance is readable by anyone.
The credit book is derived from the journal. So for every rune R:

```
Σ (L2 credits of R)  ==  Σ (proven deposits of R)  −  Σ (proven withdrawals of R)
                     ==  the vault's L1 balance of R
```

The middle equality is enforced **by the reducer, per event** — the same
discipline as conservation (Σ balances == emitted − burned) for KRAY itself: a settlement that would break it does
not apply. The right-hand equality is checkable by any stranger with two fetches.
A bridge that is short by one unit says so publicly and permanently.

### Proof 3 — WITHDRAW: you can only take what you still hold

Exit is two-phase, and the first phase is what makes it airtight:

1. **Request** — the holder signs `withdraw R, amount A, to <L1 address>`. The
   reducer moves A from their balance into a **pending-exit lock**. From that
   instant the credits are non-transferable: they cannot be spent on L2 and
   claimed on L1 at the same time, because they are already gone from the
   spendable book.
2. **Settle** — the L1 payout happens (cooperatively, or by the timelock path),
   and its SPV proof burns the locked credits, matched by txid.

If the payout never happens, the holder signs a **`rune-cancel`** (its own
consensus event: nonce-bound, 1-₭ fee, re-verified on replay) and the credits
return untouched — nothing is created, nothing is stranded. Locks never expire
on their own: only the holder's signature reopens them. One exception, and it is
**consensus law**: a lodged pre-signed settlement journals a **`rune-lodge`**
event that ARMS the exit inside the book — an armed exit refuses the cancel in
the reducer itself, on every replay (a co-signed hex cannot be un-signed;
cancelling under it would double-pay). An armed exit always completes: anyone
may broadcast the public settlement hex and settle it. The invariant holds at
every step, including mid-flight.

### Proof 4 — CUSTODY OF THE VAULT: small, visible, accountable

The vault is a Taproot output with an unspendable internal key (NUMS) and two
script paths:

- **cooperative**: `<depositor_key> CHECKSIGVERIFY` **first**, then t-of-n of the
  **sealed guardian identities** (`CHECKSIGADD … NUMEQUAL`) — the owner's own
  signature is REQUIRED, so no threshold of guardians, not even all n colluding,
  can move the funds. The federation co-signs speed, never custody.
- **unilateral**: `<depositor_key> CHECKSIGVERIFY <Δ> CHECKSEQUENCEVERIFY` — after
  the timelock the depositor alone can reclaim. No federation, no permission.

Both paths are BUILT (`vault.ts`, `vault-spend.ts`): the address is derived and
re-derivable by any depositor before sending; the cooperative leaf takes exactly
t signatures (taproot's own `CHECKSIGADD`, no FROST ceremony — FROST can replace
this leaf later without changing the contract); and `auditVaultSpend` verifies a
broadcast spend from raw bytes and public parameters alone, including the
premature exit whose signature is valid but whose sequence lies, BIP-341 annexes,
and 65-byte explicit-sighash signatures other wallets lawfully produce.

And the residue is named — and it is smaller than this document once claimed.
Guardian collusion is NOT a residue: the owner-first cooperative leaf makes
guardian theft cryptographically impossible, not merely detectable. What remains
is the **stale escape**: a depositor who already sold their credits on the L2 can
wait out Δ and sweep their vault's physical total. The watcher (`vault-watch.ts`)
sees that drain the moment it hits the mempool, and the pre-signed settlement
(`vault-settlement.ts`, opt-in flag) makes it FAIL on its own — the no-timelock
cooperative split wins the RBF race for the outpoint, proven end-to-end on real
regtest Bitcoin. Without the flag, the sweep is provable theft on-chain, forever,
attributable to a derived vault whose parameters name its owner. Nothing about
this is deniable, and nothing about it is invisible — which is exactly the
difference between a trust assumption and a blind spot.

## 3 · How this compares, honestly

| | Spark / statechains | **KRAY rune vacuum** |
|---|---|---|
| Why the L2 balance exists | operator attestation | **SPV + runestone + ancestry, verified by the reducer** |
| Reserve check | trust the operator set | **public equation, per rune, enforced per event** |
| Exit when operators vanish | ✅ unilateral | ✅ **unilateral** (timelock script path) |
| Double-claim (spend on L2, exit on L1) | prevented by key deletion (unobservable) | **prevented by the pending-exit lock — arithmetic, not behaviour** |
| Misbehaviour | key deletion cannot be audited | **a vault spend with no matching burn is proof** |
| Who signs | a fixed operator set | **sealed identities, weighted by proven custody, rotating** |
| History | operator infrastructure | **self-verifying journal anchored into Bitcoin, replayable by anyone** |

The trust residue is the same *class* as Spark's — that is the trilemma, not a
flaw. What differs is that in KRAY it is the **only** thing left to trust, and
every neighbouring guarantee is arithmetic.

## 3b · SUBFROST / frBTC — the other honest attempt, and why it is not runes

SUBFROST is the closest neighbour to what we are building, and the comparison is
instructive precisely because their choices are coherent — just aimed elsewhere.

**What it is.** A "decentralized custodian": a lightweight layer over an ALKANES
indexer that listens for new blocks and coordinates a small ring of FROST signers
who custody real BTC and redeem it. The asset is **frBTC** — synthetic BTC living
inside metaprotocol space, powered by a smart contract on ALKANES.

**How it works.** Peg-in is instant: a PROTORUNES protocol message inside a
single Bitcoin transaction, atomically composable with other intents. Peg-out
"requires the decentralized multisig": the ALKANES contract tracks burn events,
the signer ring observes them and pays out on L1. State lives in the ALKANES
database, computed by a **metashrew** indexer running the ALKANES WASM rules.

**Why they do not work with runes.** Not an oversight — a different goal:

1. They want **programmability**. Runes are deliberately dumb: no state machine,
   no contracts. ALKANES exists to bring WASM smart contracts to Bitcoin, so it
   reimplemented an asset layer (protorunes) that runes cannot express.
2. ALKANES **borrows the runestone envelope** (OP_RETURN + a protocol tag) but
   not the Runes asset semantics. It is a sibling protocol, not a rune bridge.
3. Wrapping an existing rune would leave them with exactly the bridge problem in
   this document. They chose to wrap BTC instead — the larger market, and a
   single asset instead of thousands.
4. Their verification model needs the indexer. A rune deposit, by contrast, is
   provable from bytes (UTXO plus ancestry), so a rune bridge can be verified
   light. That door is open to us and closed to them by construction.

**Where SUBFROST is genuinely ahead of us.** Programmability — they have WASM
contracts and atomic composition in one transaction; we have no contracts at all.
And they have a live signer ring doing real custody, while our vault is still a
design. On that axis they ship and we specify; saying otherwise would be a lie.

**Where KRAY is ahead.**

| | SUBFROST / frBTC | **KRAY rune vacuum** |
|---|---|---|
| The asset | synthetic BTC minted in metaprotocol space | the user's OWN rune, still on L1, credited on L2 |
| Where state lives | ALKANES database, computed by a metashrew indexer | a hash-chained journal, anchored into Bitcoin with SPV proofs |
| How a user verifies | run metashrew + the ALKANES WASM rules over the chain | replay the journal; a deposit re-proves from raw bytes, merkle path and headers |
| Why a credit exists | the indexer's state after a protocol message | **an SPV-proven deposit with its rune ancestry** |
| Solvency | not stated as a public equation | **an equation the reducer enforces per event**, L1 side readable by anyone |
| Peg-out safety | burn observed by the signer ring | **two-phase lock: spending on L2 and claiming on L1 cannot both happen** |
| Unilateral exit | not addressed in the documentation | **built and tested**: `<depositor> CHECKSIGVERIFY <Δ> CHECKSEQUENCEVERIFY`, spendable by the depositor alone |
| Runes | not supported (ALKANES assets only) | the entire point |

**The shared, unresolved axis.** Both designs involve a federation, and neither
has covenants. Their documentation does not state signer count, threshold,
rotation, or whether a user can exit without the ring; ours states the design and
has BUILT it — owner-first vault, unilateral CSV exit, watcher, and the
pre-signed settlement reflex, all proven by test. What remains unbuilt here is
narrower: SPV inside the reducer (the named keystone) and the retirement of the
consolidation key. Same trilemma, different corners of honesty — and the last
residue is real for both of us until covenants or fraud proofs land.

## 4 · The road that removes even the residue

1. **Covenants** (`OP_CTV` / `OP_CSFS`): the deposit commits to where it may go,
   so the federation cannot redirect funds at all.
2. **BitVM-style fraud proofs**: an invalid vault spend becomes *revertible* on
   L1, not merely provable.
3. **Custody-rotated federation**: already possible with what exists — membership
   follows the same proof the emission uses.

## 5 · Build order (each step useful on its own)

| Step | What it delivers | State |
|---|---|---|
| Rune link | a citizen binds its rune, signed, first-writer-forever | ✅ **done** (`bridge` event, refusals proven live) |
| Runestone decoder | decode etch/mint/edicts from raw tx bytes, pure | ✅ **done** (`runestone.ts`, matched to ord — cenotaph = refusal) |
| Ancestry verifier | rune balance of an outpoint, proven recursively | ✅ **done** (`rune-ancestry.ts`) |
| Deposit / withdraw / cancel events + solvency in the reducer | the accounting, airtight | ✅ **done** (`rune-deposit` / `rune-send` / `rune-exit` / `rune-cancel` / `rune-settle`; reserve == credits + locks, HALT on break) |
| Vault construction (NUMS + owner-first CHECKSIGADD + CSV timelock) | custody the owner is in on every path | ✅ **done** (`vault.ts` / `vault-spend.ts`; FROST can later shrink the witness without changing the contract) |
| Watcher + pre-signed settlement reflex | the residue attack fails on its own (RBF race) | ✅ **built & proven e2e** — reflex flag stays opt-in (`KRAY_PRESIGNED_SETTLEMENT`) |
| SPV of deposit/settle inside the reducer (not just the door) | a cold replay re-proves the peg from bytes | ✅ **built & proven** (`KRAY_CONSENSUS_RUNE_PROOF`, unset = ON after Signet burn-in 2026-08-17; `inputRunes` stays ord-attested — embedded ancestry is the next slice) |
| Pot-signer (exit-bound) | the pot owner key signs only a rebuilt payout bound to the signed rune-exit, off the public process | ✅ **built & proven in tests**. Live Signet relaunched on `node-hot.env` (2026-08-17): `potSigner=loopback`, seq 74. Lab withdraw still pending before shredding the vitrine leftover file. Law: `docs/POT-CUSTODY.md`. |

Nothing here needs a new trust assumption. It needs the parts built, in order,
each one proven before the next leans on it — the same way the emission law was
built tonight.


## 6 · The anchor-payer pool — what is proven, and what is not

A citizen may sign a standing offer of satoshis, and when a seal is due the payer
is drawn from the triggering Bitcoin block hash. Two of the three legs are real
and one is not, and the panel says so rather than implying otherwise:

**Proven today.** The offer is a signed declaration whose AMOUNT lives inside the
signed message, so a signature cannot be replayed for a different number (a 403
with the reason named). The draw is reproducible by any stranger —
`AnchorPool.pick(beacon, jobId, root, candidates)` returns the same payer byte for
byte — and it is drawn from a real Bitcoin block hash, so nobody can steer it, and
offering more buys a fair chance rather than influence.

**Not built.** The drawn volunteer's satoshis never leave their wallet: this
node's own bitcoind broadcasts every anchor. And no KRAY is credited to anyone for
it — the reward is the pool's own bookkeeping and touches no ledger. The two legs
are unattached SYMMETRICALLY, which is why this is a gap rather than a leak:
nobody is paid for nothing, because nobody is paid.

**Why it can wait, and why it cannot wait long.** On regtest the node holds ~15,000
locally-mined BTC, so "the node pays for everyone" costs nothing and hides nothing.
The moment sats are scarce — signet — the operator is silently subsidising
volunteers whose declarations cost them nothing. And if anyone ever wires the KRAY
reward to the ledger WITHOUT wiring the payment, the result is free money: exactly
the class of defect the emission clock and the signed-row law were built to close.

**The choice was made: proof, not cooperation.** The volunteer broadcasts their own
anchor and proves they paid it, and `economics/anchor-payment.ts` is that proof:

```
1 · the anchor is real and buried        sha256d → merkle → headers, each WEIGHED by PoW
2 · it carries THIS root at THIS height  the KRAY.NETWORK OP_RETURN, decoded
3 · EVERY input traces to an output      each funding transaction proven the same way,
    that paid the payer's own script     its prevout matched by SCRIPT, never by claim
4 · fee = Σ inputs − Σ outputs           arithmetic on numbers Bitcoin already committed
```

Step 3 is what turns a story into a payment: to claim a fee you must show the coins
spent were yours, so a stranger's anchor for the same root is refused by name. Step 4
demands EVERY input — a fee computed from a subset is a guess wearing a proof's
clothes — and every funding's own block is weighed too, because those amounts ARE the
fee's arithmetic and a free header would let a payer invent the value of their coins.

What remains is the ledger credit, and it has exactly one conservation-safe shape:
the reward is MOVED from a balance that already holds it (the Treasury, which is
where fees already accumulate), never minted, and bounded by what that balance
holds. Conservation is not negotiable, so postage is paid out of the network's own fee
pool before the rest is shared — and no proof, no payment, no reward.
