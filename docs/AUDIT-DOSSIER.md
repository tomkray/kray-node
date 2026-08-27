# KRAY.NETWORK — Security Audit Dossier

> **Purpose.** This document is the briefing a third-party security firm receives to scope and execute an
> audit of KRAY.NETWORK. It states what the system is, the invariants it claims, the exact attack surfaces,
> the proofs that already exist, and the precise commands to reproduce every one of them. It is deliberately
> honest about boundaries: an audit is worthless if the target oversells itself.
>
> **Status at issue.** Signet, single writer, one operator (the author), self-audited. Not yet externally
> audited, not on mainnet, not multi-writer. Everything below is reproducible against the code at the current
> commit.

---

## 1. What KRAY.NETWORK is, in one paragraph

KRAY.NETWORK is a Bitcoin-anchored Layer-2 whose entire state is a pure function of a signed, hash-chained
journal. Every state change is authorised by a BIP-340 Schnorr signature over a domain-separated,
network-labelled message, folded into a SHA-256 **cascade root** (one 32-byte commitment over money, stars,
the donation pot, the consumed-seal set, the rune L2, and contracts), and that root is committed to Bitcoin.
Value is created only by **burning real satoshis** (1 ₭ per satoshi, no premine); the burn output is a
pay-to-contract taproot output at the NUMS point (`SHA256(uncompressed G)` — a provably keyless address) that
simultaneously destroys the sats and seals the cascade root. There is no admin key, no operator override, and
no convenience endpoint that moves state without a proof. **If a stranger cannot re-derive it from the bytes
alone, it did not happen.**

## 2. The Supreme Law and the axioms (what the auditor is testing against)

The invariants live in [AXIOMS.md](AXIOMS.md). The one law above all:

> Signature ‖ Merkle proof ‖ Bitcoin anchor is the ONLY path a byte of state may ever move.

The eleven axioms an auditor should treat as the specification:

| # | Axiom | What breaking it would look like |
| --- | --- | --- |
| Supreme | everything proven, nothing trusted | any state change with no signature and no SPV proof |
| A1 | Conservation or HALT | Σ balances changes without a matching burn/mint; the reducer keeps running on a broken invariant |
| A2 | the 1-₭ fee is immutable | a transfer/star move charging ≠ 1 ₭ accepted |
| A3 | no hard fork, ever | an unknown event kind silently ignored instead of HALTing the node |
| A4 | honor gates money | a work claim paid without a re-verified signed presence proof |
| A5 | written stars are relics | a second inscription/name on a star that already carries one |
| A6 | zero dependency, moored to Bitcoin | state that a cold reboot cannot re-derive from journal + stored proofs |
| A7 | mined KRAY is fuel | a validator reward that is not from the fee pool, or split non-linearly (sybil-exploitable) |
| A8 | one root proves everything | a dataset the cascade root commits to that a follower cannot reproduce |
| A9 | the address is the user | value credited to a recipient not bound in the signed message |
| A10 | an inscription id is its signed act | an origin whose L1 parent the author does not control |

**The single highest-value audit question:** find one path — any endpoint, any event, any race, any reorg —
that moves value or mutates consensus state without (a signature the reducer re-verifies) OR (a Bitcoin SPV
proof re-derived from raw bytes). That is the whole game.

## 3. Architecture and trust boundaries

```
  KrayWallet (browser extension)         ← holds keys; signs every user action; keys NEVER leave the client
        │  signed events / bare {txid}
        ▼
  server.mjs  (the WRITER node)          ← orders events, exposes HTTP; owns NO private key for user value
        │  append (synchronous, total order)
        ▼
  kray-core  (the CONSENSUS reducer)     ← the law: applyLive() validates-then-mutates, atomic, fail-stop
        │  cascade root
        ▼
  Bitcoin (bitcoind + ord)               ← the anchor + the normative rune/ordinal oracle
        ▲
  kray-follow.mjs (the SECOND NODE)      ← re-derives EVERYTHING from the journal; trusts none of the above
```

**Trust boundaries the auditor must probe:**

- **Client → writer.** The writer trusts a client for *nothing that carries value*: a mint's sats come from
  the on-chain output, never a field; a donor is read from the OP_RETURN; a rune amount is what `ord` says
  landed. Signatures are the only client input that authorises state.
- **Writer → Bitcoin.** The writer's own `bitcoind` is the source of SPV truth. A client-supplied proof is
  accepted **only on mainnet** (where forging headers costs prohibitive work); on signet/testnet/regtest the
  node re-proves from its own node (`server.mjs`, the `/donate` and `/rune/*` comments state this explicitly).
- **Writer → follower.** The follower trusts the writer for nothing: it replays the journal through the same
  reducer, re-derives the whole root, and re-proves every anchor and every donation from its own bitcoind.
- **`ord` as oracle.** Rune amounts and (today) L1 ordinal ownership for `origin` are read from `ord`, the
  normative indexer. This is a **named, documented trust boundary** (see §9, Known boundaries).

## 4. The consensus core (the primary audit target)

~3,000 LOC across `ledger.ts`, `pot.ts`, `spv.ts`, `consensus.ts`, `self-anchor.ts`, `rune-bridge.ts`. The
reducer (`ledger.applyLive`) is **atomic**: every precondition is checked and thrown on BEFORE any mutation,
so a rejected event leaves the ledger byte-identical (no half-spent balance, no phantom nonce). 28 event kinds.

Load-bearing invariants and where they live:

| Invariant | Enforcement point | Note |
| --- | --- | --- |
| BIP-340 signature over the exact domain-separated message | `requireSig` | protocol labels (`KRAY_*`) can never sign — a sink never spends |
| integer nonce, strictly increasing per address | `checkNonce` | a missing/non-integer nonce is refused (double-spend fix) |
| conservation after every event | `conserves()` / `backed()` | Σ emitted ≤ Σ sats donated (peg-of-sacrifice) |
| per-mint cap = 10,000 ₭, immutable | `pot.ts` `MINT_CAP_SATS`, `readonly mintCap` | no constructor param; injection-proof |
| the window law: 1 confirmed seal → 1 cap reopened, once per txid | `case 'seal'` + `sealedTxids` | mint rate metered by Bitcoin's heartbeat |
| credited-once per donation outpoint | `creditedDonations` | segwit txid non-malleable |
| unknown event kind HALTS | `default:` throws | A3 — no silent hard fork |
| value never crosses Bitcoin networks | `requireRecipientNetwork` | a `bcrt1…` on signet is refused |
| the burn address is keyless | `self-anchor.ts` `BURN_INTERNAL_KEY` | `= SHA256(uncompressed G)`, recomputable from Bitcoin's own generator (`numsAuthorlessProof`) — no private key exists |
| append-only cascade-root extension | `cascadeRoot()` | a zero-seal history hashes byte-identically to the pre-2c format — no buried proof is orphaned |

**Fork-choice** (`consensus.ts`): the canonical history is ranked by the cumulative Bitcoin proof-of-work of
buried anchors verified by `verifySealProof`; a fabricated root is `refuted` (weight 0); one block counts once.
`verifySealProof` recognises both anchor shapes — the operator `OP_RETURN` and the donation's own pay-to-contract
self-anchor — and weighs them identically.

## 5. Attack surface inventory (66 HTTP endpoints)

The full surface is `server.mjs` (`/api/kraynet/*`). The value-bearing endpoints and their gate:

| Endpoint | Moves value? | Gate |
| --- | --- | --- |
| `/donate`, `/donate/prepare`, `/donate/broadcast` | mints ₭ | SPV proof from own bitcoind; sats from output; donor from OP_RETURN; credited-once; cap |
| `/rune/deposit` | credits L2 runes | pays this node's shared bakery pot; SPV-proven; cenotaph-refused; amount from `ord`; credit bound to the unique Taproot spender read from the deposit's parent txs (hash-bound, never a client field), pool-backed; outpoint once |
| `/rune/exit`, `/rune/settle` | locks / burns L2 runes | signed exit; payout SPV-proven; `ord`-exact amount to the SIGNED destination; burn once per l1Txid |
| `/rune/send` | moves L2 runes | signed |
| `/submit` (transfer, transfer-star, inscribe, name, origin) | moves ₭ / stars | signed; 1-₭ fee; origin gated on L1 ownership |
| `/anchor-pool/offer`, `/anchor-pool/claim` | pays ₭ from fee pool | signed offer (timestamp-monotonic); claim SPV-proven; reward capped at fee pool |
| `/replica`, `/anchors`, `/head`, `/supply`, `/profile/*`, `/star/*` | read-only | no state change; a follower re-verifies anyway |

**Closed-by-default polarity.** Every dev-trust shortcut (`{to,sats}` mint, field-trust rune deposit, `ownsOrdinal`
dev acceptance) is gated behind `KRAY_TRUSTED_DEV=1` AND (for some) `NET==='regtest'`. A default production node
fails closed on all of them. The auditor should verify each shortcut is unreachable with the flag off.

## 6. Existing proofs and how to reproduce them

**The full unit/consensus suite** — 110 test files, ≈861,000 assertions, deterministic (no network):

```bash
cd apps/kray-core && npm test        # expect: EXIT 0
```

Highest-signal individual proofs (all in `apps/kray-core/src/test/`):

| Proof | File | Claim pinned |
| --- | --- | --- |
| mint cap immutable | `mint-cap.test.ts` | 10,000/10,001 boundary + every injection vector, incl. a forged journal line caught on replay |
| reducer guards | `reducer-guards.test.ts` | nonce, unknown-kind HALT, reward network gate, `KRAY_*` cannot sign |
| self-anchor in fork-choice | `self-anchor-seal.test.ts` | self-anchor weighs identically to OP_RETURN; forgery refuted |
| the window law | `window-law.test.ts` | 1 seal = 1 cap, once per txid; genesis root preserved byte-exact |
| the backstop stands down | `anchor-backstop.test.ts` | pool yields to any external anchor; snapshot/restore; hostile snapshot → empty |
| burn address is keyless | `burn-address-proof.test.ts` | G → NUMS → tweak → bech32m, byte-identical to @scure |

**The live adversarial e2e suite** — real regtest bitcoind + ord, no fixtures. These are the audit's crown
jewels; each exercises the exact path the extension drives, on real Bitcoin. Requires a running harness
(§8):

```bash
cd apps/kray-core
KRAY_BTC_RPC_PASS=<pw> node src/test/donate-node-e2e.mjs         # real burn → SPV → 1:1 mint, credited-once
STORM_N=100 STORM_WAVE=1000 node src/test/donation-storm-e2e.mjs  # 1000 simultaneous requests, 100 real burns, no fragmentation
KRAY_SERVER=<path> node src/test/chaos-crash-e2e.mjs             # kill -9 mid-storm; the math survives the murder
node src/test/anchor-backstop-e2e.mjs                            # a drawn stranger anchors; paid only from the fee pool
HARNESS=<dir> RUNE=<id> node src/test/bridge-node-e2e.mjs        # a real rune crosses IN and OUT; replay + forged-depositor refused
```

**The second node** — proves the whole commitment from the journal alone, and re-proves anchors + donations
from its own bitcoind:

```bash
KRAY_BTC_RPC=<url> KRAY_BTC_RPC_PASS=<pw> \
node scripts/kray-follow.mjs --from http://127.0.0.1:4478 --dir ./follower
# expect: cascade root re-derived == head; every donation re-proven on Bitcoin; a tampered journal refused at boot
```

## 7. Threat model — what an attacker is assumed to control

Assume the attacker can: send any HTTP request in any order and concurrency; craft any Bitcoin transaction and
get it mined on the network in question; run a modified writer or follower; and read all source. The attacker
does **not** control: the victim's signing key, Bitcoin's proof-of-work on mainnet, or the collision resistance
of SHA-256 / BIP-340.

Concrete adversary goals the audit should attempt to achieve (each SHOULD be impossible):

1. Mint ₭ without burning a satoshi, or mint the same burn twice, or mint over the 10,000 cap.
2. Move value from an address without its signature, or from a `KRAY_*` label at all.
3. Reopen the mint window without a confirmed Bitcoin seal, or reopen the same seal twice.
4. Credit a rune deposit that a cenotaph burned, or to an address other than the unique Taproot spender that paid the pot, or twice.
5. Settle a rune exit against a payout that did not deliver the locked amount to the signed destination.
6. Get a follower to accept a history whose root it cannot reproduce, or a seal Bitcoin did not bury.
7. Fragment the ledger under concurrency (the same-millisecond storm) or across a mid-write crash.
8. Anchor-pool: bias the draw, claim another's payment, or be paid more than the fee pool holds.
9. Father a star from a parent (KRAY star or L1 ordinal) the attacker does not control.

Each of 1–9 has a reproducing proof in §6 demonstrating the current defense. The audit's value is finding a
variant not covered.

## 8. How to stand up a test environment

The consensus suite (`cd apps/kray-core && npm test`) needs nothing but Node.
`npm run test:boot` at the repo root proves Signet ≠ mainnet isolation and that
the official zip stays clean. The live e2e files under `apps/kray-core/src/test/*-e2e.mjs`
need a regtest `bitcoind` + `ord` the audit team provisions itself — a wallet, a
funded address, and an etched test rune are the only fixtures. **Signet credentials
and any real keys are gitignored and never shipped in this dossier.**

## 9. Known boundaries and latent items (stated, not hidden)

An honest audit needs the target's own list of soft spots:

- **`ord` as oracle.** Rune amounts and `origin` L1-ownership are read from `ord`, a trusted indexer. Full
  SPV re-derivation of rune lineage (`rune-ancestry.ts`) and ordinal control (`proveInscription` /
  `proveParentControl`) exists in the core and is **tested but unwired** — a deliberate phase decision. On
  mainnet the trust is `ord` computing a deterministic function of Bitcoin; the hardening path is designed.
- **Bridged-rune custody is federated.** The L1 rune reserves sit in a shared bakery pot held by a guardian
  federation (threshold-signed, timelocked) — the one place the bridge is not trustless. The *ledger logic*
  (mint on an SPV-proven deposit into the pot, burn on an SPV-proven payout to the signed destination) trusts
  no operator; **moving the reserves out of the pot** is the federation's threshold-signed act. Trustless L1
  custody is the named hardening path. The signed ₭ / star / name ledger has no such custodian.
- **Single writer.** State ordering is by one writer. Availability is covered by the read-only mirror and
  provable succession (a follower can become the writer, re-deriving the byte-exact root). **Live multi-writer
  fork-choice is deliberately deferred** (concurrent-write reorg is a full BFT problem) pending a written ADR
  and this audit.
- **Not yet on mainnet, not yet battle-tested at value.** The proofs are rigorous; the mileage is not there.
- **KrayWallet extension entropy** has not been independently reviewed (out of scope of the core, but named).
- **`ANCHOR_FINAL` / reorg depth** assumptions (100 blocks) should be reviewed against target networks.

## 10. What a passing audit would assert

That no path moves value or mutates consensus state outside *signature + SPV proof + Bitcoin anchor*; that the
reducer is atomic and fail-stop under concurrency and crash; that conservation and the peg-of-sacrifice hold
across every event; that a follower re-derives the exact committed root and refutes any forgery; and that every
named boundary in §9 is the *only* trust in the system. Findings against §7.1–9, or a new class entirely, are
the deliverable.

---

*Reproduce before you believe. Every claim here is a command away from verification, which is the whole point
of the network this dossier describes.* ⛓₭
