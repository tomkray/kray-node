# KRAYNET — Mainnet Readiness

> **Status: NORMATIVE (plan of record) — the registration of how every piece must behave
> identically to mainnet before mainnet exists.** When this doc and the code disagree, the code
> and its proofs win, and this doc gets corrected.

The whole system must work **exactly as it will on mainnet** — nothing dev-only, nothing
disorganized, everything inside the one flow: **donor → proof → anchor → validator**, all
re-derivable from the cascade root. This is the plan of record for getting there.

Geometry: [`FOLDER-LAW.md`](FOLDER-LAW.md). Mainnet is not a rename window.
It is born zero km in `data-main/` with the names already locked.

## The Supreme Law (unchanged)

Value is the chain's, never a client field. A ₭ exists only through
`signature ‖ SPV proof ‖ Bitcoin anchor`. No premine, no emission — ₭ is minted only by a
proven donation (1 ₭ / satoshi, backed). Every follower re-derives the cascade root from the
journal and refutes anything outside it.

## Flow readiness audit — UPDATED 2026-08-10

Every ⚠️ from the 2026-08-08 audit is now resolved and proven. The public
re-proof is `cd apps/kray-core && npm test` plus `npm run test:boot` (hermetic
suite + Signet ≠ mainnet isolation + official zip). A follower re-derives the
root: `node scripts/follow/kray-follow.mjs --from <writer>`.

| Flow | Status | Note |
| --- | --- | --- |
| **Proof** (self-verification) | ✅ mainnet-ready | cumulative cascade root, root-completeness, `verifySettlement`, byte-exact OP_RETURN; append-only 2c extension preserves every buried root |
| **Donor** (donation → mint) | ✅ proven live | SPV `{txid}` re-proven by bitcoind, 1/sat, backed, once-per-outpoint, 10,000 cap immutable, cap-gate at prepare; storm-proof (1000 simultaneous), crash-proof (kill -9 mid-storm), redeemable forever from a bare `{txid}`. Runs `TRUSTED_DEV=0` in prod |
| **Anchor** (state → Bitcoin) | ✅ unified | **operator retired** (`KRAY_OPERATOR_ANCHOR=1` opt-in only): the donation IS the anchor (self-anchor weighed in fork-choice, 2a), any-guardian backstop pays from fees (2b), the mint window reopens per confirmed Bitcoin seal (2c). Blocks/anchors persist across reboot |
| **Validator** (fees → guardians) | ✅ wired live | `settleFeePoolOnSeal` pays proven presence on every confirmed seal, LINEAR. 3× only when the beat carries `custody` the writer verifies against **its** atlas. `/validate` Hold the library attaches that proof; the wallet key never leaves the extension. Follow `content/` is not read for pay. |
| **Rune L2** (deposit ⇄ exit) | ✅ proven both ends (POT door) | **Current model = shared POT.** `/rune/deposit {runeId, txid}` credits the UNIQUE Taproot spender (from bytes, never a client field), SPV-proven, cenotaph-refused, `ord`-exact amount, credited-once, pool-backed from birth; exit is owner-signed and paid FROM THE POT (`/rune/exit/payout-psbt` → owner signs only their own funding → the pot co-signs → auto-settle). **Since 2026-08-22 that pot co-sign is BOOK-CHECKED:** remote guardian daemons (2-of-3, `KRAY_GUARDIAN_SIGNER_URLS`), each grounding its verdict in its own mirror's independent replay, gate every payout — an unreachable guardian is tolerated up to the threshold, a book-NO holds the withdraw (fail-closed; the CSV leaf keeps funds unfreezable). Proven by the Tier-1 ceremony e2e (20/20, `guardian-golive-tier1-e2e`) and live on Signet (`docs/POT-CUSTODY.md` § book-checking federation). **A real SPV deposit is pot-only** — a tx that does not pay the pot is refused. Proven live on the pot door: `bridge-node-pot-e2e` 15/15, `exit-payout-pot-node-e2e` 19/19 (conservation = reserve falls by exactly the exited amount). **PROVEN-POT vs LATENT-PERSONAL-VAULT (two truthful columns):** the per-depositor personal-vault path is LATENT — reachable ONLY via the dev field-trust door (never a real SPV deposit), but it still ships (buildVaultSpend/finalizeCooperative, vault-settlement, the rune-rehome sweep, `personalOf`) and is kept under the vault-path e2es, which stay AS-IS and are marked LATENT, exercised via the dev door — never repointed onto the pot (that would drop the safety property they prove). |
| **Address / network** | ✅ gated | `requireRecipientNetwork` rejects a `to`/donor not on the node's network; protocol sinks exempt. Value never crosses networks |
| **Second node** (survive the operator) | ✅ built | follower re-derives the whole root + re-proves anchors & donations from its own bitcoind; read-only mirror serves the last verified snapshot; succession proven (a follower becomes the writer at the byte-exact root) |
| **Pen decentralization** (ADR-3) | ✅ **RATIFIED — LIVE on Signet** (Article XIV, seq 155, 2026-08-23; mainnet born activated at seq 0) | the omission path is trustless end to end — A (inclusion root) · B (deterministic window order) · C (OPT-IN signed deadline) · 3d-a (windowCommitment bound to the inclusion set the anchor ACTUALLY committed, via `l1Root`→`seq_anchor`) · availability witness (the citizen's own Bitcoin anchor) · the eligibility opening (nonce map with sticky first-anchor height, so a light client reads expected@deadline trustlessly) · the prover `buildCensorshipClaim` ↔ verifier `verifyCensorshipAnchored` (opens the anchored cascade so the window root is a Bitcoin fact) · D (succession) · and the **seal-height "enforced twice"**: the door proves `l1Height` (BIP-34 coinbase) and the follower (`kray-follow.mjs` §4b) INDEPENDENTLY re-proves it from its own bitcoind, bound to `l1Root` — closing old-anchor-reuse. Ships IDENTICALLY on every network; every fold is activation-gated OFF (`INCLUSION_ACTIVATION_SEQ[main] = MAX`) until the Creator ratifies a FUTURE height per network (Article XIV) — mainnet is byte-identical to Signet until then, and the reducer change is byte-identical in the synchronous case (goldens frozen). The deadline is OPT-IN (never mandatory — runs on today's wallet). Network-agnostic (SPV floor `MIN_BLOCK_WORK[net]`). Council-hardened at TWO levels (design + verify, each caught a real consensus-boundary defect). Verifiers pure — no consensus change until activation |

**House status (2026-08-24):** recipe organized (`networks/mainnet/`) for the **whole L2** — donate SPV, rune pot-only deposit, remote 2-of-3 exit, ord required, no lab secrets. `data-main/` empty. Pins: `npm run preflight:mainnet` and `npm run verify:mainnet-bridge`. Writer dark. Extension already seats `www.kray.network` — do not ship an “it’s live” zip; igniting the writer is the public launch.

**Remaining before mainnet (decisions + one optional hardening), not blocking correctness:**
- external audit (dossier ready: `docs/AUDIT-DOSSIER.md`) · light-value mainnet ignition (Creator's call)
- **pen decentralization (ADR-3):** the math foundation is COMPLETE (A·B·C·3d-a·availability·eligibility-opening·prover·verifier·D·seal-height-enforced-twice). **(1) RATIFIED 2026-08-23 (Article XIV): Signet activates at seq 155 (fleet deployed first, then the writer); mainnet is born activated (`INCLUSION_ACTIVATION_SEQ[main] = 0`, no migration window on a chain with no history). Ӿ transfers (`x-send`) ratified at the same seqs. See `docs/PEN-ACTIVATION-DECISION.md`.** Still open: (2) under activation the writer MUST anchor via OP_RETURN or keyless-burn (a pot-key self-anchor is weight-zero at the follower — the honest residual); (3) the writer-inclusion obligation now has TEETH (2026-08-24): `chooseCanonicalWithConduct` demotes a provably-censoring head below an honest one BEFORE any work is weighed, and `censorshipOpensSuccession` opens the pen race immediately (censorship is not silence) — both pure, additive (`chooseCanonical` byte-identical), fail-closed on the validating-replica gate (`sealHeightReproven`), healing structural (a chain that includes the act derives no current strike). Proven in `succession.test.ts` (a heavier censoring incumbent loses; an unverified accusation moves nothing). Remaining residue: the node's operational strike-derivation loop (run `verifyCensorshipAnchored` per head over the follower-re-proven journal and feed these two functions) is live wiring, not new math; (4) trustless L1 custody of the pot sats stays the open custody frontier (accounting pot trustless; sats key the operator's today) — first rung closed LIVE 2026-08-22: every pot withdraw now requires independent book-checking guardian co-signers (2-of-3 over own-mirror replays); the owner-key unilateral residue remains; **rung #5 (per-recipient settlement routing — the exit loaf) shipped 2026-08-23** (`docs/POT-CUSTODY.md`), rung #4 (pre-signed split) stays deferred pending FROST (doctrine §10). Optional hardening (council-deferred): catch a lied keyless-self-anchor root at the follower (today weight-zero); document is at every `verifyCensorshipAnchored` call site
- public TLS on `www.kray.network` (the name exists; the writer is not ignited)
- empty `apps/kray-net/data-main` + a **new** `bc1` pot on the cofre (never the Signet vault)
- optional: wire `origin` L1-ownership to full SPV (`proveInscription`/`proveParentControl` — built & tested,
  today `ord` is the oracle by design) and rune-lineage SPV (`rune-ancestry` — built, unwired)

Operator map of the two public networks: [`networks/README.md`](../networks/README.md).
The writer refuses to boot if Signet and mainnet share a journal, RPC, pot, or folder.

### Original 2026-08-08 audit (kept for the record)

| Flow | Status | Note |
| --- | --- | --- |
| **Validator** | ⚠️ math ready, live not wired | now ✅ (`settleFeePoolOnSeal`) |
| **Anchor** | ⚠️ works, not persistent | now ✅ (persistence + unification 2a/2b/2c) |
| **Address / network** | ⚠️ no per-network gate | now ✅ (`requireRecipientNetwork`) |

## Phase 1 — mainnet-coherent core + clean reset

Make donor / proof / anchor **exactly mainnet**, then reset to a clean genesis that runs in
mainnet mode from block #0.

1. **Per-network address gate** — the ledger rejects a `to`/donor address that does not decode
   on the node's network (protocol sinks TREASURY/BLACK_HOLE exempt). Consensus-level, so every
   follower enforces it. Value never crosses networks.
2. **Real anchor-fee accounting** — `anchorSpend` debits the pot by the *actual* Bitcoin fee the
   seal paid, not a fixed placeholder.
3. **Block persistence** — blocks + anchors survive a restart (no re-collapse, no re-anchor, no
   receipt blocks). Block numbers are stable across reboots.
4. **Proof-only mode** — run with `TRUSTED_DEV=0`; the dev `{to,sats}` mint, field-trust rune
   deposit, and client settlement table are all closed. Only a proof mints.
5. **Reset** — archive the current `data-signet` (a reset moves the old universe aside, never
   deletes). Mainnet starts a **fresh** genesis in `data-main`. Do not copy the Signet journal.
   Do not reuse `signet/vault-keys.env`.
6. **Re-donate** — the Creator donates from zero through the real proof flow (the extension
   already sends `{txid}`), building the new chain the mainnet way.

## Phase 2 — decentralized validators

Wire the proven presence layer to the live node so `settle` derives its `{address, work}` table
from **proven** presence (per-beat PoW + custody, signed receipts), verified by `verifySettlement`.
Mainnet can launch solo (one guardian) on Phase 1 and gain this when others run nodes.

## Non-negotiables while doing this

- Chat PT-BR, code/commits EN-US.
- Never commit `signet-harness/` (RPC password), `data-*.bak*/`, data dirs, or unreviewed PSBT
  files. Stage explicit paths, never `git add -A`; scan the staged diff for secrets.
- Every change proven (tests) and non-breaking before it ships.
