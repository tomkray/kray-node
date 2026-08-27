# The Atemporality Audit — is KRAY.NETWORK sound to be lived for long life?

> **Status: VERDICT (2026-08-14).** A council of nine wisdom-lenses (Satoshi · Lamport · Merkle ·
> Nash · Shannon · Newton · Szabo · Turing · da Vinci) audited every mechanism against the real
> code, then two grand adversaries tried to refute the strongest claims, and a chair delivered the
> whole-system verdict. This document records it — honestly, distinguishing what is **literally
> proven** from what rests on a **chosen constant or economic assumption**. Overclaiming is treated
> as the worst failure. (Two lenses — da Vinci/proportion, Szabo/trust — died on API errors mid-run;
> their themes were carried by the adversaries and the judgment column below; re-run to complete.)

## The headline

**YES — atemporal in its whole conception, with ONE load-bearing condition.**

The machine KRAY actually built — the money's arithmetic and the single-sequencer order — is
mathematically sound and **literally proven**. The one keystone that turns *"₭ born only from REAL
satoshis burned"* from an honest operator's promise into a **stranger-verifiable theorem** — the
proof-of-burn living **in consensus** (committed into the anchored root, re-verified on replay) — is
**not yet wired**. Today the burn is proven only at the server door. Fresh genesis makes this free to
fix now, and the fix (the self-anchoring keyless-burn donation) is already a **proven primitive wired
nowhere**. So: trustless in its arithmetic and its order today; trustless in its *peg* the day the
proofs move from the door into the reducer.

## What is PROVEN atemporal (theorem · test · replay-invariant)

- **Conservation is structural.** `Σ balances == emitted − burned` holds by construction — every
  reducer branch is balanced (mint credits and raises emitted together; burn debits and raises
  burned together; transfer/reward/settlement net to zero). `donation-once` 13/13, `mint-cap` 18/18.
- **The per-mint cap is unbreakable — even by the operator.** `MINT_CAP_SATS = 10,000` is a hardcoded
  constant, not a parameter; enforced in the one reducer every path crosses, re-checked on replay.
  A hand-forged journal line with a valid hash-chain makes the node **HALT** rather than over-mint.
- **A donation mints once, ever.** The credit key is the Bitcoin-derived outpoint (never a client
  field), checked before any mutation, rebuilt on replay. Every duplication vector closed.
- **The burn address has no author — real mathematics.** `BURN_INTERNAL_KEY == SHA256(uncompressed G)`
  == the canonical BIP-341 NUMS point, byte-identical to `@scure`. Spending it ⟺ solving a discrete
  log that exists for no one. `burn-address-proof` 1/1.
- **The self-anchor is a true Bitcoin commitment.** The pay-to-contract tweak is byte-identical to
  `@scure/btc-signer`'s taproot tweak on every network; the 49-byte OP_RETURN any explorer shows.
- **SPV weighs real work, not header count.** `⌊2^256/(target+1)⌋` per header, PoW-limit-bounded,
  per-network floor. The fabricated-5000-headers attack was found and fixed; fork choice ranks
  histories by cumulative Bitcoin work, one block counted once. Forged SPV/anchor: **hunted, not found.**
- **Deterministic replay-exactness + atomic reducer.** `applyLive` validates every precondition and
  throws *before* any mutation; a fresh node re-derives the identical cascade root from the journal
  bytes alone. `concurrency-proof` 26/26 (byte-exact reboot), the 7-level assault 3→2,187 users.
- **The linear split is the unique sybil-neutral curve.** `N·f(W/N)=f(W)` ⇒ only linear; splitting one
  machine into N identities pays exactly what one does; a whale gains nothing pretending to be small.
  **Sybil/whale capture: refuted.** Beat PoW is `2^zeros` bound to beacon+address+block, one block once.
- **Capacity is bounded in consensus, forever.** 21 MB/seal hard content budget ⇒ ≤ ~1.1 TB/yr worst,
  ~52.5 GB/yr average — below the world's disks eternally. **Atlas bloat: hunted, not found.**
- **The contract VM is total and deterministic.** No loops/recursion/jumps, bounded nodes+depth, BigInt
  only. **Sandbox escape / value creation: hunted, not found.** HTML/SVG stars render only in a caged
  iframe. **Post-quantum:** ML-DSA (FIPS-204) and Lamport recovery are real, not stubs.

## What is JUDGMENT (a chosen constant or economic assumption — recorded, not derived)

- `MINT_CAP_SATS = 10,000`, `WINDOW_PER_SEAL_SATS = cap`, `DEFAULT_POT_TARGET_SATS` — elegant design
  choices (Bitcoin's heartbeat as rate regulator), not invariants forced by the axioms.
- `CUSTODY_PAYOUT_FACTOR = 3` — a self-documented **launch placeholder**, inert at genesis; the studied
  fix is a retarget-to-a-redundancy-setpoint (see [the custody study](#the-custody-study)).
- **"Value inherits Bitcoin's cost"** holds today for the *ordering and the root* (fork choice buys
  history with real work), **not yet per-₭** (the burn→mint link is enforced at the door, not in consensus).
- **Linear sybil-neutrality** is proven, but its premise — *identity is free* — is an economic
  assumption; concavity would become safe only the day identity costs something scarce.

## The weaknesses that SURVIVED adversarial verification (ranked)

1. **[HIGH] THE KEYSTONE GAP — proof-of-burn is enforced only at the door, never in consensus.** The
   journaled donate event is `{to, amount, outpoint}`; the reducer re-verifies **no** SPV on replay,
   and the cascade root commits to the *result* (emitted/burned/balances), not the *cause* (the
   donation proofs). Consequence: a cold replay, or any third party holding only the journal + anchored
   root, mints the claimed ₭ **on faith**; and the operator could journal fabricated outpoints and mint
   unbacked ₭ up to the cap while `conserves()` and `backed()` both still return true. The code is
   honest about it (*"SPV-proven at ingress… wired at integration"*), and the fix primitive exists.
2. **[MEDIUM] The Supreme Law overclaims.** `AXIOMS.md` says every rule is *"re-proven on every replay
   from the journal + stored proofs alone,"* citing the L1 value paths as the exemplar — literally
   false today for burn, rune-deposit and rune-settle (proofs live at the door). Align the prose to
   what the reducer enforces, or promote the proofs. For a project whose ethos is *never overclaim*,
   this is itself a bug of honesty.
3. **[MEDIUM] Settlement custody is trusted, not proven, on replay.** The reducer scales each
   validator's work by the *claimed* hit bitmap without re-verifying it against the atlas on replay.
4. **[MEDIUM] The rune bridge can mint-unbacked / lose runes if the door is bypassed** — same root
   cause: `rune-settle` re-verifies no SPV in consensus.
5. **[LOW] The pot "of real sats, no operator" (A8) is aspirational** — the AnchoringPot is pure
   integer accounting; no UTXO ownership is proven on-chain yet (the honest memory already says so).
6. **[LOW] The cascade root is not injective over all valid journals** (omits the head hash / some
   derived state) — cosmetically weakens "one root proves everything."
7. **[LOW] Two one-liners of honesty:** `conserves()` is a tripwire at `/proof` but is **not** asserted
   with a HALT inside `applyLive` (A1 says "checked on every apply"); and `backed()`'s doc-comment
   calls itself "the peg of sacrifice" when it is a within-books tautology.

**What the adversaries could NOT break:** sybil/whale capture, fork-choice fabrication, cross-network
value leak, fee-pool death spiral, atlas bloat, forged SPV/anchor, contract sandbox escape, and the
quantum-migrate for any pre-committed account. These are genuine, earned wins.

## The vision check

**Delivered:** Bitcoin-anchored (a real BIP-341 commitment + work-weighed fork choice); math-proven for
the money *arithmetic* and the *order* (one 32-byte root any stranger re-derives from the journal
forever); and the real-sat burn is real *at the mainnet door*. **Aspiration:** *"math-proven,
anyone-can-verify"* becomes true for the **peg** only when the burn/rune proofs move from the door
into the consensus reducer and into the anchored root — the one keystone.

## The path (shortest list that moves judgment → proven; free on fresh genesis)

1. **Promote proof-of-burn from door to consensus** — journal the donation's SPV / self-anchor proof
   material; re-verify it in the reducer on every apply and replay; commit it into the cascade root.
   *This single change moves the most weight from judgment to proven.*
2. **Apply the same to `rune-deposit` and `rune-settle`** (re-verify the L1 proof in the reducer) — or,
   if deferred, **downgrade the axiom's prose** so the law never claims more than the code enforces.
3. **Harden settlement:** a once-per-beacon consumed-set; re-verify (or commit) the custody bitmap.
4. **Align `AXIOMS.md` to the code** — say exactly what is re-proven on replay today vs door-only.
5. **Two one-liners:** a post-apply `conserves()` assert with HALT (makes A1 literally true); re-label
   `backed()`'s comment as "bookkeeping consistency," not "the peg."

<a name="the-custody-study"></a>
## Appendix — the custody multiplier (separate study, consolidated 2026-08-14)

A four-lens tribunal proved the 1×→3× master multiplier is a **launch placeholder, not atemporal**:
the *machinery* (a fixed-point, integer-deterministic, replay-exact retarget mirroring the byte-price
loop) is **provable and split-invariant** (byte-identical on an empty atlas), but its *sensor* is
**unsound without a proof-of-service layer** — a possession-only coverage sensor is Sybil-inflatable in
the direction that would starve honest masters, so the downward loop must be gated on proof-of-service
(a separate P2P project). Buildable now, retro-safe: the doc reconcile, the conservative cap, and the
fixed-point plumbing; deferred: the retarget's live downward loop until proof-of-service exists.

---

*Audited against the code, not the promises. What is proven is named proven; what is chosen is named
chosen. The train is sound where the rails are laid — and the map shows exactly where to lay the last one.* ⛓₭

---

# The experienced reviewer's confrontation (2026-08-14)

An experienced reviewer read the public docs and returned a 32-point adversarial review — the good
kind, asking not *"does it work today?"* but *"is it still correct if operators vanish, nodes
disagree, the network grows 1000×, someone censors, two histories compete, anchors conflict, or the
economically powerful manipulate it?"* Each point was confronted against the **real code**, cross-
referenced with the council verdict above. The reviewer thinks exactly as we do — his deepest
provocation (*"if we all vanish tomorrow, are the data + rules + Bitcoin enough for someone else to
rebuild the truth?"*) **is** the council's keystone plus data-availability. Nothing here shakes the
foundation; it sharpens the frontier.

## Tally

Of 32: **~4 fully SOLVED with receipts · ~18 PARTIAL (the proven core is there; the missing half is
one recurring theme) · ~7 genuinely OPEN · 1 framing we ADOPT.** None refute the arithmetic or the
order. The OPEN/PARTIAL ones nearly all trace to a **single honest truth the code already states out
loud**: KRAY is today a *single-writer, deterministically-verifiable, Bitcoin-anchored ledger* —
`PROOF-COMPARISON.md:63-66` says exactly that, and `AUDIT-DOSSIER §9` defers live multi-writer as "a
full BFT problem pending a written ADR." The reviewer independently rediscovered our own roadmap.

## SOLVED — the receipts to show the reviewer

- **(18) Domain separation — obsessive, already.** Every signed message is
  `kray-core.<action>.v1|net=<network>|from=…|nonce=…` (`scheme.ts:122-137`): action type, protocol
  version, network, sender and nonce are all bound, so a "transfer 10" can never be replayed as a
  vote/burn/delegate, nor across mainnet/signet/regtest. Exactly the reviewer's ask.
- **(16) Canonical serialization is consensus — and it is one function, not "JSON our way."** The
  journal hash is `sha256(prevHash + canonical(body))` (`store.ts:55`, `kray-primitives.ts` `canonical`),
  the *same* canonicalization on append and on replay-verify (`store.ts:114`); the persisted JSON line
  is never the hash input. (Hardening left: publish `canonical`'s byte rules as a normative spec so a
  second-language client matches it — see OPEN #27.)
- **(20) Time is Bitcoin, never a local clock.** Consensus uses the Bitcoin beacon (block hash) and
  the seal, never wall-clock; the event `at` is display-only and touches no root. No machine decides
  consensus by its clock.
- **(24) Composability stays out of consensus — by design, a strength.** The contract VM is total
  (no loops/recursion, bounded nodes+depth), and HTML/SVG stars execute only in a client-side
  sandboxed iframe. "Consensus understands facts; clients understand experiences" — we already live it.

## PARTIAL — the proven half is real; the missing half is one theme

- **(7,8) Proof-of-burn & irreversibility.** PROVEN: conservation, the immutable 10k cap (HALTs on a
  forged journal line), once-per-outpoint credit, and the burn address as the canonical NUMS point
  `SHA256(G)` — byte-exact, authorless *under ECDLP + SHA256 preimage-resistance* (the strongest
  assurance any Bitcoin construction has; honestly not "unconditionally no key"). MISSING: the burn
  SPV proof lives at the **door**, not the reducer — **the council's keystone**.
- **(5,6,11) Anchor semantics.** Same-Bitcoin-block resolution, invalid-before-valid scanning and
  work-weighed fork choice are specified and tested; duplicate-anchor DoS is cheap-rejected. MISSING:
  Bitcoin **reorgs are not a formal state-machine transition**, and "Crane state finality" vs "Bitcoin
  anchor confidence" are not distinct protocol states. Grinding/withholding on the beacon is bounded
  **judgment**, not proven-impossible.
- **(10,23) Guardians & Stars.** PROVEN: a guardian **cannot** make an invalid user event valid — the
  reducer re-verifies every signature/nonce; custody only redistributes conserved Treasury ₭, the seal
  only opens a mint *gate* (donations still burn). Stars are write-once, universe-unique, one-per-burn.
  MISSING: "if the content bytes vanish, the star still represents its committed hash + provenance" —
  true, but data-availability (see OPEN) decides whether the bytes survive.
- **(12) Vault crypto is strong** (NUMS key-path, k-of-n taproot where the **depositor must co-sign**,
  a unilateral timelock escape) — but the live guardian set is operator-configured; **ledger security
  ≠ bridge security**, and we adopt saying so.
- **(2,3,4) Data availability & scale.** `kray-follow.mjs` genuinely re-derives the identical root and
  re-proves every anchor from its own bitcoind — any copy proves itself. MISSING: no mandatory
  replication / erasure-coding / peer-discovery, and replay reads the whole journal from line 1 (no
  snapshot/pruning yet). At scale and under operator-death this is the real gap.
- **(15,17,19,22,28,29) Hygiene & process.** Receipts, per-action `.v1` versioning, per-account nonces,
  the 1-₭-fee + size-burn + 21 MB/seal spam bound, and real adversarial suites (chaos-fuzz, the 7-level
  assault, reducer-guards) all EXIST. MISSING: a standalone multi-language receipt verifier;
  activation-height protocol versioning; signed-action expiration; and a formal property-based/bounty
  adversarial phase.

## OPEN — valid concerns with real logic (ranked, merged with the council + the reviewer's top-5)

1. **Proof-of-burn from door → consensus** (council keystone + reviewer #7,#8) — the reducer re-proves
   the burn on replay and the anchored root commits the *cause*, not just the result. *The one change
   that moves the most weight to "proven."*
2. **Data availability & trust-minimized reconstruction** (#2,#3,#4) — *"Bitcoin preserves the
   commitment; someone must preserve the evidence."* Replication factor, content-addressed chunking,
   peer discovery, snapshots-derived-from-verifiable-state. Answers *"can the truth be rebuilt if we
   all vanish?"*
3. **Objective ordering without a cartel** (#1,#21,#25) — a Bitcoin-shaped ordering rule (events
   ordered by the seal they fall under + a deterministic within-window tiebreak) so any writer replays
   to the same root; plus inclusion-deadlines that turn censorship from *invisible* into *evident*.
4. **Anchor/reorg as formal state** (#6,#5) — model Bitcoin reorg as an explicit transition;
   separate Crane-finality from anchor-confidence in protocol and UI.
5. **The Consensus Constitution + spec-vs-implementation** (#26,#27,#31,#16-spec) — promote `AXIOMS.md`
   to a minimal normative constitution that **matches the code exactly** (fixing the overclaim the
   council flagged), publish the canonical byte-spec, and grow a second independent client.
6. **Bridge trust: bilateral proof-of-reserves & operator-death exit** (#13,#14) — make `X ≥ Y`
   externally computable, and document the honest trust level of withdrawal (an L2-transfer recipient
   cannot yet unilaterally exit).

## Framings we ADOPT from the reviewer (language discipline, #31)

- **"deterministically verifiable · Bitcoin-anchored · independently replayable · proof-of-burn
  issued"** — not the word *"trustless"* wherever a writer, vault, guardian or data-provider still sits.
- **"ledger security ≠ bridge security"** — separated technically and in communication.
- **"Bitcoin can preserve commitment; someone still has to preserve the evidence."**
- **The definition of success: if we all vanish tomorrow, the data + rules + Bitcoin are enough for a
  stranger to rebuild the truth.** That is the atemporality bar, and it names the next phase.

## The next engineering phase (the reviewer's five, merged with ours)

The frontier is one coherent body of work, buildable on fresh genesis (retro-safe): **(1) proof-of-burn
in consensus → (2) data availability & reconstruction → (3) objective multi-writer ordering + inclusion
evidence → (4) formal anchor/reorg semantics → (5) the normative constitution + a second client.** Each
is a proven slice, adversarially tested before the next. The custody-multiplier retarget (appendix) and
the settlement custody re-verification fold into (1) and (3). Nothing above changes what KRAY *is* — it
finishes turning an honest single-writer ledger into a protocol that outlives its authors.

*Confronted against the code, not the promises. The reviewer found no forgery, no inflation, no broken
proof — he found the frontier we had already named, and named it more sharply. We keep the receipts,
adopt the humility, and build the five.* ⛓₭

---

# Audit completion — the two lenses that had died, and the deep hygiene pass (2026-08-14)

The council's da Vinci (proportion) and Szabo (trust) lenses died on API errors in the first run; they
were re-run, and the reviewer's hygiene cluster got its full-depth pass. Result: **no new consensus
hole — but da Vinci found six real "legibility-as-security" defects**, all COMMENT contradictions
where the source-of-truth comments lied about the enforced value (a "1 MB" seal-budget comment over a
21 MB reducer bound; a "physics caps 1.1 TB/yr" that is really an economic bound; MAX_INSCRIPTION_BYTES
carrying two contradicting legends; a fee "floor you may exceed" that is enforced as an equality; a
stale "every 210th seal" over 1008; a dead emission story in reward.ts). For a project whose Supreme
Law is *"if a stranger cannot re-derive it from the bytes alone, it did not happen,"* a comment that
teaches a stranger the wrong number IS a bug. **All six are fixed in this commit** — comment-only, zero
behavior change, the legends now match the reducer. Szabo confirmed the trust boundaries the reviewer's
bridge cluster already mapped ("ledger security ≠ bridge security," proof lives at the door), and the
deep hygiene pass confirmed domain separation, canonical serialization, per-account nonces and
Bitcoin-clock time as SOLVED, with receipt-verifier-spec, activation-height versioning and signed-action
expiration as PARTIAL — folded into the constitution's [NAMED PATH] articles. The nine-lens council is
now complete; the verdict above stands, sharper: the arithmetic and the crypto are proven, the honesty
of the source comments is now repaired, and the frontier is the five named rails (rail 5 built; ADRs in
`FRONTIER-ADRS.md`).
