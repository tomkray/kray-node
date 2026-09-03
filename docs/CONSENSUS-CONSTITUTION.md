# The KRAY Consensus Constitution

> **Status: NORMATIVE (v0, 2026-08-14).** The minimal, rigid set of invariants no implementation may
> violate — separate from the product/build docs, written to match the CODE EXACTLY. Every article is
> marked **[ENFORCED]** (a theorem, a test, or a replay-invariant, with file:line) or **[NAMED PATH]**
> (a destination the law states but the code has not yet reached — honestly declared, never implied
> as done). Overclaiming is the worst failure; an article that drifts from the code is itself a bug.
> This document is the answer to the reviewer's call for a "Consensus Constitution" and the council's
> demand that the Supreme Law match the reducer.

## The Supreme Law

Value moves only by **signature ‖ Merkle proof ‖ Bitcoin anchor** — no admin key, no operator
override, no convenience path. See `AXIOMS.md` for the full statement; the articles below are how it
is, or will be, spent — and exactly how far the code has walked.

## Articles

### I — Conservation is structural. **[ENFORCED]**
`Σ balances == emitted − burned`, by construction: every reducer branch is balanced (a mint credits
and raises `emitted` together; a burn debits and raises `burned` together; transfer/reward/settlement
net to zero). Verifiable at any point via `conserves()` (`ledger.ts`), and **checked literally on every
apply**: `applyLive` runs `conserves()` after each accepted act and HALTs the ledger on the first lie
(the act never reaches disk). Proven: `donation-once` 13/13, `mint-cap` 18/18.

### II — No ₭ without a recorded donation, and the per-mint cap is immutable. **[ENFORCED]**
`MINT_CAP_SATS = 10,000` is a hardcoded constant, not a parameter (`economics/pot.ts`), enforced in the one
reducer every path crosses and re-checked on replay; a hand-forged journal line over the cap makes the
node **HALT**. Genesis mints nothing; anchor and seal mint/burn zero. No premine.

### III — A donation credits once per Bitcoin outpoint, ever. **[ENFORCED]**
The credit key is the Bitcoin-derived outpoint (never a client field), checked before any mutation,
rebuilt from the journal on replay (`ledger.ts:154,161`). Every duplication vector — resubmit, burst,
fabricated txid, restart — is closed. `donation-once` 13/13.

### IV — The burn address has no author. **[ENFORCED]**
`BURN_INTERNAL_KEY == SHA256(uncompressed G)` == the canonical BIP-341 NUMS point, byte-identical to
`@scure` (`self-anchor.ts`). Spending it ⟺ solving a discrete log that exists for no one, under ECDLP
+ SHA-256 preimage-resistance (the strongest assurance any Bitcoin construction has — not
unconditional). `burn-address-proof` 1/1.

### V — Honest nodes on the same journal produce the same state root. **[ENFORCED]**
The reducer is a pure, deterministic function of the journal; `applyLive` validates every precondition
and throws BEFORE any mutation; the cascade root is re-derived byte-exact on a cold reboot.
`concurrency-proof` 26/26 (byte-exact reboot), the 7-level assault 3→2,187 users. Canonical hashing is
one function (`canonical`, used on append AND replay-verify, `store.ts:55,114`) — never impl-defined JSON.

### VI — Bitcoin anchors witness states; they do not create them. **[ENFORCED]**
An anchored root carries weight only by the cumulative **Bitcoin proof-of-work** burying it
(`consensus.ts` `provenWeight`/`chooseCanonical`); an unproven claim weighs nothing; a forged-header
history is refused. One block is counted once. `consensus.test.ts` (order-independent, forged-proofs-
weigh-nothing, dead-tie-identical).

### VII — Every signature is domain-separated and network-bound. **[ENFORCED]**
Every signed message is `kray-core.<action>.v1|net=<network>|…|nonce=<n>` (`scheme.ts:122-137`): action
type, protocol version, network and a per-account monotonic nonce are all bound, so no signature is
replayable across action, network, or version. *(Named: an optional height/expiration bound on signed
actions, to defeat a very-old offline-signed replay at the same nonce.)*

### VIII — Guardians serve liveness; they never decide truth. **[ENFORCED]**
A guardian cannot make an invalid user event valid — the reducer re-verifies every user signature and
nonce regardless of any guardian. Custody only REDISTRIBUTES conserved Treasury ₭; a seal only opens a
mint *gate* (a donation still burns to mint). No guardian path mints ₭ or forges a user event.

### IX — Capacity is bounded in consensus, forever. **[ENFORCED]**
The live size-proportion law caps a new inscription and the per-seal content budget at
`MAX_INSCRIPTION_PROPORTION` (10,000,000 bytes = 10 MB). Fire is
`max(1, ceil(size / 10_000))` ₭ (`BYTES_PER_KRAY_PROPORTION`). Main and Signet are born
in this law (pin 0) — both books were reborn empty at the v1.0.0 genesis. The old Signet
pin 274 guarded a 57-star journal that no longer exists. The byte price still retargets every 1008 seals
(`retargetBytesPerKray`), integer-deterministic, journal-derived.

### X — The peg is re-proven in consensus, and the proof is mandatory. **[ENFORCED — proof + ancestry born strict at seq 0 on signet and main]**
A donation-burn, a rune deposit and a rune settle may journal their SPV bag IN the event
(`KRAY_CONSENSUS_BURN_PROOF` / `KRAY_CONSENSUS_RUNE_PROOF`). When the proof is present, the reducer
re-proves it from bytes on every apply and replay: burial under weighed work, the exact outpoint/txid,
the runestone allocation, and the credit bound to the unique Taproot spender that paid the shared
bakery pot (the live SPV door is pot-only; the reducer keeps the personal-vault binding only to
replay pre-pot journals). Present-but-false HALTs. Proven: `donate-consensus-proof`, `rune-consensus-proof`
(tamper HALTs; cold replay byte-exact). Unset flags default ON after Signet burn-in (2026-08-17).
**Residues since closed (v1.0.0 rebirth, 2026-08-28/29):** the proofless door is gone — at/after
`PROOF_MANDATORY_SEQ` (**0 on signet and main**, born strict) the reducer refuses an L1-peg event that
does not embed its own SPV proof; and input ancestry is no longer "the next slice" — at/after
`RUNE_ANCESTRY_MANDATORY_SEQ` (**0 on both nets**) a rune-deposit or rune-settle without a proven
`proof.ancestry` is refused (THE KEYSTONE). `inputRunes` remains ord's attestation, but allocation math
and ancestry are re-derived. Do not say the peg is trustless while a federation holds the pot
(Article XIII).

### XI — Ordering is single-writer today; objective multi-writer ordering is a named path. **[ENFORCED (inclusion evidence) · NAMED PATH (multi-writer ordering)]**
One writer assigns global order (`LedgerStore.append` in `store.ts`); the reducer only validates. This
can neither forge a signature nor rewrite an anchored past. Since the Article XIV ratification (crossed
live on the old Signet chain at seq 155, 2026-08-23; after the v1.0.0 genesis reset both signet and
mainnet are **born activated at seq 0** — `INCLUSION_ACTIVATION_SEQ` in `ledger.ts`) censorship is no
longer invisible: every seal folds the inclusion root, window commitment and nonce map into the
anchored cascade root, and a
signed act carrying an opt-in deadline that the chain omits yields a CENSORED verdict re-derivable from
Bitcoin bytes (`censorship-evidence.ts:259` verifier ↔ `:343` prover). The writer can still delay and
order within a window. **The remaining named path:** live multi-writer ordering (events ordered by the
seal they fall under + a deterministic within-window tiebreak) so any writer replays to the same root —
deferred as a full BFT problem pending a written ADR and external audit.

### XII — Data availability is a security property, not an assumption. **[NAMED PATH]**
Bitcoin preserves the 32-byte commitment; someone must preserve the evidence. Today `kray-follow.mjs`
lets any copy re-derive the identical root and re-prove every anchor from its own bitcoind, but there
is no mandatory replication, erasure coding, content-addressed chunking, or peer discovery, and replay
reads the whole journal from line 1 (no snapshot/pruning). **The bar:** if every official server
vanishes, the data + rules + Bitcoin must still be enough for a stranger to rebuild the truth. Named
path: replication factor, content-addressed chunks, peer discovery, and snapshots derived from a
previously-verifiable state (never a silent trusted checkpoint).

### XIII — Bridge security is not ledger security. **[ENFORCED (separation) · NAMED PATH (trustlessness)]**
The vault crypto is real: a NUMS key-path, a k-of-n taproot federation where the DEPOSITOR must co-sign
(guardians alone move nothing), and a unilateral timelock escape. A PERSONAL vault's unilateral leaf
is the user's key. A pot-first credit has no user leaf — the pot depositor is the network
consolidation key. Guardians alone cannot spend the pot; the pool key plus threshold can; after the
timelock the pool key alone can. The live guardian set is operator-configured. **Ledger security ≠
bridge security** — separated in code and in all communication. A withdraw is authorised by the
signed `rune-exit` (dest and amount); the pot key may sign only a rebuilt payout bound to that
exit (`authorizePotSign`). A donate witnesses the book (Article VI) — it does not unlock a
withdraw. Named: bilateral proof-of-reserves (assets X ≥ liabilities Y, externally computable),
the localhost pot-signer (writer-disk daemon — the consolidation secret off the hot public
node; see `docs/POT-CUSTODY.md`; the daemon is not this clone), split owner key (FROST/Shamir), and a documented withdrawal
trust level.

### XIV — Consensus changes are versioned and deterministically activated. **[ENFORCED (machinery, exercised live)]**
Messages carry a per-action `.v1`, and rule changes bind to per-network activation constants that every
replayer applies identically (`INCLUSION_ACTIVATION_SEQ`, `X_TRANSFER_ACTIVATION_SEQ`, … in `ledger.ts`,
locked by `activation-seq-pin.test.ts`): below the seq the fold is absent and history is byte-identical;
at/after it every node folds the same way — two versions cannot silently produce two roots. Exercised
live 2026-08-23 on the old Signet chain (inclusion/window/nonce and Ӿ folds crossed at seq 155, fleet
updated before the writer). After the v1.0.0 genesis reset (2026-08-26) those old-chain pins are retired:
the reborn signet and mainnet are **born activated at seq 0**. Ratification of an activation seq remains
the Creator's explicit act, recorded in `docs/PEN-ACTIVATION-DECISION.md`.

## The language discipline (binding on all KRAY communication)

Say **deterministically verifiable · Bitcoin-anchored · independently replayable · proof-of-burn
issued.** Do NOT say **"trustless"** wherever a writer, a vault federation, a data provider, or an
operator still sits. Precision about the limits is what earns the trust.

## Amendment

An article marked [ENFORCED] may not be weakened without breaking a test or a theorem — such a change
"is not an update, it is a different network." An article marked [NAMED PATH] is amended by promoting
it to [ENFORCED] with the code and proof that makes it true. This document changes only toward more
honesty or more proof, never toward more claim.

---

*The constitution states the law and confesses the distance to it, article by article. That confession
is not weakness — it is the only foundation a protocol meant to outlive its authors can stand on.* ⛓₭
