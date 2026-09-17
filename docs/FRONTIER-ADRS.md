# Frontier ADRs — the design, before the software

> **Status: DESIGN (2026-08-14).** The Architecture Decision Records for the four remaining frontier
> rails the council + the experienced reviewer named (rail 5, the Consensus Constitution, is built).
> Each ADR states the invariant it makes true, the design, the **proven slices** (built and attacked
> in order, the proof-driven-pipeline way), and the retro-safety on fresh genesis. Protocol before
> software: no consensus code lands until its ADR is agreed. These promote articles of
> `CONSENSUS-CONSTITUTION.md` from **[NAMED PATH]** to **[ENFORCED]**.

> **Status 2026-08-23 (ADR-3):** Article XIV **RATIFIED** — the inclusion/window/nonce folds crossed
> live on the old Signet chain at seq 155; after the v1.0.0 genesis reset (2026-08-26) they are
> **born active at seq 0 on both nets**, and Ӿ transfers ride the same pin. The per-slice "wired into
> no live path" lines below were true at their dates and are left as written; since activation those
> folds ARE the live path (`docs/PEN-ACTIVATION-DECISION.md`).

---

## ADR-1 — Proof-of-burn in consensus (the keystone) · promotes Article X

> **Status 2026-08-17:** slices 1a–1d proven (Signet `proofs.burn/rune=true`, `backingGate=true`).
> Article X promoted to ENFORCED (machinery). Unset flags now default ON; force `=0` only to replay
> a proofless past. **Update (v1.0.0 rebirth, 2026-08-28/29):** the proof is no longer merely
> default-on — it is **mandatory born strict**: `PROOF_MANDATORY_SEQ` and `RUNE_ANCESTRY_MANDATORY_SEQ`
> are **0 on signet and main**, so a proofless L1-peg event is refused by the reducer itself.
> The design text below is the original ADR — left as written.

**Invariant to make true.** Total ₭ minted ≤ total satoshis *provably and irreversibly* burned, and
**any stranger holding only the journal + the anchored root re-verifies the peg from bytes alone** —
not on any operator's word.

**Today.** The door (`server.mjs`) runs `verifyDonationProof` / `proveTxBuried` (spv.ts) against the
node's own bitcoind, extracts `{outpoint, sats}`, and calls `node.donate(to, sats, outpoint)`. The
journaled event is `{kind:'donate', to, amount, outpoint}` — the *result*, not the *cause*. The
reducer re-checks the cap + credited-once but **re-verifies no SPV on replay** (`ledger.ts:140`).

**The elegant key.** `spv.ts.proveTxBuried(rawTx, txoutproof, headers, {net, minConf})` is **pure and
offline** — it takes the proof BYTES and re-derives tx→txid→merkle→PoW-header-chain, with no network.
And the cascade root already hashes each event's canonical body (`store.ts:55`). So if the proof bytes
ride *inside* the donate event, they are **automatically committed into the root** — and re-verifiable
by any cold replay, with zero new root machinery.

**Design (additive, default-off, byte-identical when absent).**
1. Append-only type: `KrayEvent.proof?: { rawTx, txoutproof, headers }` (kray-primitives.ts) — a new
   optional field; an event without it hashes exactly as today, so every existing history is
   byte-identical (retro-safe on fresh genesis and beyond).
2. `node.donate(to, sats, at, outpoint, proof?)` journals `proof` when present.
3. Reducer donate case: **when `proof` is present**, re-run `proveTxBuried` offline; re-derive
   `{outpoint, sats, paysPot}` from the proof; require they MATCH the event's claimed `outpoint`,
   `amount`, and the pot's OP_RETURN; require burial ≥ `DONATION_MIN_CONF`. Any mismatch → `throw`
   (HALT). When `proof` is absent (the dev/regtest mint, or a node that has not enabled the flag),
   behavior is unchanged — so the slice never breaks the live public nodes.
4. Door: behind `KRAY_CONSENSUS_BURN_PROOF=1` (**default off**), pass the proof material into
   `node.donate` so real donations journal their cause. Flip to on only after the slice is proven; the
   live regtest/signet nodes are untouched until then.
5. Same shape applied next to `rune-deposit` and `rune-settle` (their SPV already lives in spv.ts).

**Proven slices.** (1a) type + `node.donate` plumbing, suite byte-identical. (1b) reducer re-verify
when present + a test that PINS it: a genuine proof replays and mints; a **forged** proof HALTs; an
**absent** proof is byte-identical to today; a proof whose derived `{outpoint,sats}` disagrees with the
claimed event HALTs. (1c) wire the door behind the default-off flag; live-prove on the regtest bench
end to end. (1d) extend to rune-deposit/settle, then promote Article X to [ENFORCED] and delete the
"backed by the books, not Bitcoin" caveat.

**Honest limit.** Irreversibility is "no key under ECDLP + SHA-256 preimage-resistance" (Article IV) —
the strongest any Bitcoin construction has, not unconditional. A Bitcoin reorg that un-buries a proof
is handled by ADR-4 (the credited-once set + the burial-depth requirement already bound it).

---

## ADR-2 — Data availability & trust-minimized reconstruction · promotes Article XII

**Invariant.** *Bitcoin preserves the commitment; the network preserves the evidence.* If every
official server vanishes, the data + rules + Bitcoin remain enough for a stranger to rebuild the truth.

**Today.** `kray-follow.mjs` re-derives the identical root and re-proves every anchor from its own
bitcoind — any copy proves itself — but there is no mandatory replication, no content-addressed
chunking, no peer discovery, and replay reads the whole journal from line 1 (no snapshot/pruning).

**Design (a research/infra project — slices, not one change).**
- **Content-addressed journal chunks.** Cut the journal into fixed spans, each addressed by its hash;
  the anchored root already fixes the sequence, so a chunk is self-verifying against it.
- **Replication factor R + erasure coding.** Guardians (Article VIII) commit, in-journal, to holding
  chunk ranges; the custody proof (already address-salted) extends from "holds the atlas" to "holds
  journal chunk C." Erasure coding lets any k-of-n chunks reconstruct a span.
- **Peer discovery** without a central index: a gossip layer, seeded by the anchored root + a small set
  of DNS/Bitcoin-published bootstrap hints (never a trusted snapshot server).
- **Snapshots derived from a verifiable state.** A snapshot at seal N carries the root at N; a new node
  accepts it only after replaying from a *prior* verifiable checkpoint or the anchor, so a snapshot can
  never silently become a trusted checkpoint (the reviewer's #4).

**Proven slices.** (2a) chunk + content-address the journal, prove a chunk self-verifies against the
root. (2b) journaled chunk-custody commitments + the custody-proof extension. (2c) gossip + bootstrap.
(2d) verifiable snapshots with the "replay-from-prior-checkpoint" rule. Couples with ADR-3's ordering.

### 2a status (2026-08-19) — content-addressed journal chunks: built, adversarially hardened, NOT wired

The pure primitive is `apps/kray-core/src/protocol/journal-chunks.ts`; its exam is
`apps/kray-core/src/test/journal-chunks.test.ts` (19/19, in the suite). The journal (a hash-chain of
signed events) is cut into content-addressed chunks (`chunkAddress = sha256(bytes)`); `verifyChunkChain`
re-derives a span's internal chain from a boundary (`startPrevHash`, `startSeq`), reusing the store's own
`GENESIS_HASH`/`sha256hex`/`canonical` **and** its strictly-incrementing `seq` guard; `verifyManifest`
reconstructs genesis → the anchored head, refusing a dropped, reordered, tampered, or seq-broken chunk.
Wired into **no live path** (the writer, reducer, and cascade root are unchanged).

An adversarial council found no forgery against the true head, but three honest overclaims — each now
fixed: (1) the "byte-identical to `store.ts`" parity claim was false because `verifyChunkChain` omitted
the store's `seq`-monotonicity gate; the gate is now enforced (a `seq=[1,1,1]` span is refused, proven),
and the comment no longer claims `applyLive`-level parity (signatures/economics come only on replay);
(2) `verifyChunk` in isolation proves self-consistency against a boundary, **not** authenticity — an
attacker can forge a fully self-consistent chunk against a chosen boundary; authenticity lives in
`verifyManifest` binding to the Bitcoin-anchored head (a new exam proves the forged chunk passes alone
but the manifest against the true head refuses it); (3) "a tampered byte breaks both" is precise only for
a field VALUE (a formatting-only re-encoding breaks the address while the canonical chain re-derives).

**Proven now:** given the true anchored head, the journal is fetchable in pieces from **untrusted** peers,
each self-verifying (bytes trusted to no one); a genesis→head hash-chain with monotonic seq is, by
collision resistance, byte-identical (modulo canonical-equivalent encoding) to the real journal — the
exam confirms it by replaying the reassembled chunks to the identical cascade root. Drop, reorder,
tamper, seq-break, and forged-head are refused.

**Still needed (unbuilt):** the head's provenance is the follower's independent re-derivation + Bitcoin's
anchor (outside 2a, honestly named); event VALIDITY (signatures/economics) comes on reassembly + replay;
and replication factor + erasure coding (2b), gossip/bootstrap (2c), and verifiable snapshots (2d) still
sit on top before real liveness under adversarial silence (the ADR-3 3e dependency) is delivered.

### 2c status (2026-08-19) — the peer book: built, adversarially hardened, NOT wired

The pure trust-filter is `apps/kray-net/peer-book.mjs`; its exam is `apps/kray-net/peer-book.test.mjs`
(19/19, in the suite). A node accumulates candidate peer URLs from gossip and ADMITS one as a candidate
data source only once it CLAIMS the authentic anchored head — so discovery needs no central directory: a
peer on a different chain, a fork, a fabricated URL, or a down node never enters `peers()`. The head fetch
is injected, so the trust logic is provable with no network. Wired into **no live path** (nothing consumes
the book yet; `reconstructFromChunks` still takes peers from `--from`/`--peers`).

An adversarial council found no false-verify and no unbounded growth, but two honest defects — both fixed:
1. **Overclaim (the sharp one).** The anchored head is PUBLIC (it is on Bitcoin), so any node can ECHO it
   for free while holding zero data. The first draft's prose and exam claimed a head-echoer "never becomes
   usable / junk churns out," but a head-echoer verifies and is not evicted. Corrected: the book filters
   CHAIN / LIVENESS / FABRICATION, never byte-honesty or usefulness — that is proven downstream by the
   chunk content-address + hash-chain + replay + anchor (2a). A new exam case proves a head-echoer IS
   admitted and is NOT evicted, documenting the real boundary.
2. **Dedup / self-bypass.** `norm` only stripped a trailing slash, so case/default-port variants were
   distinct slots and a case/port variant of `self` bypassed the self-exclusion (a node could discover
   itself). Now `norm` canonicalizes scheme+host case and drops the default port (http/https stay
   distinct); an exam pins that variants collapse to one slot and no variant of self is added.

**Proven now:** permissionless discovery whose only admission key is the anchored head; a wrong-chain lie
is rejected by the book, a data lie is inert downstream; the pool is hard-bounded; verification is
continuous (a peer that stops serving the head is dropped).

**Still needed for the live gossip loop (2c-wire, unbuilt — the council named these):** (1) a
**data-liveness demotion** signal fed back from the chunk-fetch loop, so a verified head-echoer that never
delivers a valid chunk loses its slot (head-proof must not confer permanence); (2) **honest-peer headroom**
under a saturated cap (reserve a fraction for fresh gossip, or prefer-evict verified-but-never-delivering),
keeping never-evict-to-fit for incumbents so the anti-censorship property survives; (3) the injected head
fetch must be wrapped in the follower's `fetchBoundedJson` (timeout + 64MB ceiling), since the book
guarantees no per-fetch bounds itself; and (4) the gossip endpoint (`GET /api/kraynet/peers`) + the loop
that feeds the book's `peers()` into `reconstructFromChunks`.

---

## ADR-3 — Objective multi-writer ordering + inclusion evidence · promotes Article XI

> **Status 2026-08-19: SPEC v1 — ratified by the Creator; slices 0 + 3b built and proven on the lab
> bench, on `main`, awaiting the operator deploy to the Signet writer.** Expanded from the original
> sketch to the full Bitcoin-shaped rule (inbox · window · tiebreak · deadline · succession-by-anchor)
> after the live Signet writer outage proved the pen is the last centralized organ: the truth
> survived, the writing stopped. **Slice 0** turned out to be ALREADY BUILT — the follower mirror
> serves the last verified snapshot, honestly marked stale, with no write path by construction.
> **Slice 3b (the public inbox) is built and proven on tier 1** (`apps/kray-net/inbox.mjs`,
> `POST /api/kraynet/inbox` on the writer and on the mirror; the mirror relays, the writer's boot
> and 60s drains apply through the ONE door): the lab exam kills the writer with SIGKILL twice and
> the signed act survives both ways — held on the writer's own disk (boot drain applies it) and
> held on a mirror while the writer is dead, relayed and applied when it returns; duplicates and
> replays are refused by the account nonce end to end. An adversarial council then hardened it (no
> Supreme-Law/value violation): the per-address quota was removed (a censorship lever on an
> unauthenticated `from`), terminal receipts are reclaimed on a retention TTL, status/accept are
> O(1) with the public GET flood-gated, and a crash between the door's fsync and the receipt records
> `superseded`, never a false refused. Workshop `inbox-exam` 29/29, plus the full suite green. Tier 2
> (the live Signet writer) is reached by the operator ship ritual, not a git push. Consensus slices
> (3a, 3c, 3d, 3e) remain protocol-before-software: no code until each slice's exam design is agreed.
> Explicitly rejected: Raft/Paxos writer committees, ops-driven follower→writer promotion, ⅔ voting —
> a cartel is not Bitcoin.

**Invariant to make true.** Order is a pure function of Bitcoin plus the signed acts themselves —
never of one machine; a censored act becomes *evident*, not invisible; and when the pen falls
silent, any full node may pick it up under a rule everyone computes identically. The writer stops
being a machine and becomes a role any node can win.

**Today (verified in code).** One writer assigns global order (`store.ts` `append`: hash-chain +
fsync, fail-stop on a durable-write failure); it cannot forge a signature or rewrite an anchored
past, but it can reorder or silently refuse. Fork choice already resolves competing *complete*
histories by buried Bitcoin work (`protocol/consensus.ts` `chooseCanonical` — "the operator
becomes checked, not trusted"), and the anchor backstop already pays a stranger from the conserved
fee pool for burying the root (`economics/anchor-pool.ts`). Truth and reading are decentralized
(`kray-follow.mjs` replays the identical root and re-proves anchors on its own bitcoind). Writing
is not: if the writer dies, no new act enters the book.

**The Bitcoin analogy, made exact.** Bitcoin has no official miner because it has (1) a public
mempool, (2) a clock — the block, (3) one deterministic validity rule, and (4) work as the
tiebreak on the past. KRAY already holds (3) — the reducer — and (4) — `chooseCanonical`. This
ADR adds (1) the inbox and (2) the window. Nothing else is missing.

**Slice 0 — pure ops, needs no ADR.** Point the public GET surface at a healthy, already-verified
follower (`--serve` mirror, honestly marked stale); POST stays on the writer. The vitrine survives
an outage today. This is availability of *reading* — it is not the pen, and must never be sold as
Nakamoto.

**Design — five slices, each additive and provable alone.**

- **3a · Root injectivity.** A commitment that is injective over the included act SET, with a proof
  of inclusion AND of absence for any given signed hash. Prerequisite for proof-of-absence (the
  audit's root-injectivity item). Status: the pure accumulator is built and proven — see the 3a
  status block below.
- **3b · The public inbox.** A signed act is ALREADY a self-contained public object
  (`prepare → BIP-340 / ML-DSA signature → blob`; domain-separated, network-bound, nonced —
  Article VII). New: every full node accepts, stores and gossips signed acts WITHOUT applying
  them (idempotent by signed hash); the writer drains the inbox. The 1-₭ fee still charges at
  apply (A2 untouched). A citizen's act now survives the writer's death on every node that heard
  it — resubmission is safe by nonce. Ops value lands immediately: no act is lost to an outage.
- **3c · The window rule.** Window = the Bitcoin block the seal falls under (the beacon already
  in the journal). Within a window the canonical order is a pure greedy schedule over the
  **admitted** acts: (1) an act is admitted only if its signature verifies — an invalid act must
  never occupy a nonce slot, or a forger who grinds an invalid act onto an account's next nonce
  would evict that account's real chain every window, forever, invisibly; (2) the order key is the
  hash of the **signed message only** — never the signature or an unsigned envelope field — so the
  key cannot be reground while the act stays valid; (3) repeatedly take the smallest-key eligible
  act (a nonce-free act at once; a nonced act when its nonce equals the one its account expects),
  appending it and advancing that account's expected nonce; whatever never becomes eligible defers
  to a later window. **Theorem to pin:** two independent writers holding the same admitted set emit
  byte-identical journals and the same cascade root. "Which order?" becomes arithmetic, not a
  choice. Status: the pure primitive is built and proven — see the 3c status block below.
- **3d · Inclusion deadline → proof-of-absence.** A signed act may carry a `deadlineSeal` (inside
  the bytes it signs). If the cumulative anchored root at a seal ≥ that deadline excludes it
  (checkable via 3a) while the act was public in the inbox (3b), censorship stops being invisible
  and becomes a proof any stranger can hold up. Status: the pure verdict function is built and
  proven — see the 3d status block below.
- **3e · Succession by anchor — the pen as a race.** If the current writer publishes no sealed
  window for `W` consecutive Bitcoin blocks, ANY node may assemble the next window from its
  inbox under the 3c rule and anchor its root. `chooseCanonical` already elects the deepest
  buried proven anchor; the backstop already pays the worker. "The second writer when the first
  silences" stops being a human with launchd and becomes: whoever assembled the valid window and
  buried it. Equivocation — two act sets for one window — resolves by the same rule: deepest
  proven anchor wins. That is Bitcoin's own uncertainty, not a new one. Status: the pure rule (the
  silence clock, the successor-window check, the N-claimant reduce) is built and proven — see the 3e
  status block below.

**What never transfers with the pen.** The pot key. A successor writer writes the BOOK; it never
gains the vault (Article XIII — k-of-n + depositor co-sign + timelock; the pot-signer stays off
the public node). Bridge liveness is a custody problem, not an ordering one.

**Retro-safety.** Every slice is additive behind a default-off flag until proven (the ADR-1
pattern): an act without `deadlineSeal` hashes byte-identically; a node without an inbox still
follows; the window rule activates at an explicit seal height (the Article XIV pattern), so two
versions can never silently produce two roots.

**Honest limits, stated.** 3b/3e lean on ADR-2's gossip for "a channel the writer cannot
suppress" to be fully true — until then, many independent inboxes and published follower
endpoints are the honest interim. During a succession race, write-finality degrades to
anchor-confidence — the same uncertainty Bitcoin itself has during a reorg, surfaced by ADR-4's
two finalities, never hidden.

### 3c status (2026-08-19) — the ordering primitive: built, adversarially hardened, NOT wired to live

The pure ordering rule is `apps/kray-core/src/protocol/window-order.ts`; the convergence exam is
`apps/kray-core/src/test/window-order.test.ts` (18/18, in the suite). It is wired into **no live
path** — it is the proven primitive 3e will stand on, not a change to the single writer.

An adversarial council attacked the first draft and found four real defects, each now fixed and
pinned by an exam that fails without the fix:

1. **Prose ≠ code (would have diverged two writers).** The first draft's text said "greedy —
   smallest-key eligible each step" but the code did a multi-take sweep; the two are different
   functions for order-sensitive kinds, so a second implementer following the text would compute a
   different book. Fixed: one canonical greedy (a min-heap), and an exam that cross-checks
   `orderWindow` against an **independent** reference greedy over random sets — the code IS the rule.
2. **Grindable key (free front-running/MEV once live).** The key hashed the whole act blob,
   including the malleable signature and unsigned `action`/`at`/`fee`; re-signing (BIP-340 without
   fixed aux_rand yields a fresh signature) or tweaking an unsigned field re-rolled the key at
   microsecond cost. Fixed: the key is the hash of the **signed message only** (`keyFromSignedMessage`);
   an exam proves a re-sign leaves the key unchanged.
3. **Invisible permanent censorship.** The scheduler advanced an account's expected nonce without
   verifying the signature, so a forged act ground onto an account's next nonce evicted that
   account's real chain every window — and because every writer computed the same censored book, it
   looked like consensus. Fixed: **admission verifies the signature first** (`isValid` is a required
   input, mirroring the reducer's own law); an exam grinds a forged act with a smaller key onto A's
   nonce slot and proves it is rejected while A's genuine chain lands intact.
4. **O(n²) sweep.** Replaced by the min-heap greedy (O(n log n)); the griefing amplification is gone.

**Proven now:** given a fixed set of validly-signed acts and a shared starting-nonce snapshot, the
primitive is a pure deterministic function of (admitted set, starting nonces); every arrival
permutation yields the identical order and root, including for an **order-sensitive** first-inscribe
race (not only commuting transfers); a second implementation converges; the key is ungrindable; a
forged act cannot seize a nonce slot; nonce order, nonce-gap deferral, and a double-spend's winner
are deterministic.

**Still needed before "two independent writers, one book" is a live claim (unbuilt, listed not
implied):** (a) **admission at the door** — the live path must pass a real signature-verifying
`isValid` and a per-kind signed-message `keyOf` for every one of the ~21 kinds (the exam covers
transfer + inscribe); (b) the **window boundary** — which Bitcoin seal an act falls under, and the
deadline (3d); (c) wiring the ordered window into the writer's append behind an activation-height
flag (Article XIV) so no two versions ever produce two roots; (d) **3e succession/fork-choice for
competing SETS** — this slice makes a different set yield a different root (equivocation is visible)
but does not resolve two writers holding different sets; that is `chooseCanonical` weighing anchor
depth, deferred. Until (a)–(d) land, the honest claim is "deterministic, ungrindable, censorship-
resistant ordering of a fixed pre-validated act set," not "objective live consensus order."

### 3a status (2026-08-19) — the inclusion accumulator: built, adversarially hardened, NOT wired

The pure set-accumulator is `apps/kray-core/src/protocol/inclusion-tree.ts`; its exam is
`apps/kray-core/src/test/inclusion-tree.test.ts` (22/22, in the suite). It is a Sparse Merkle Tree
over the 3c signed-message key of each act: a key IN the window has a present leaf, a key OUT has the
empty default leaf, so ONE root yields both a membership proof and a **non-membership (proof-of-
absence) proof** a stranger verifies against the root alone. Wired into **no live path** — it is the
accumulator 3d will stand on; the cascade root and the writer are unchanged.

An adversarial council found no soundness or implementation defect in the primitive (a false
inclusion or false absence would require a SHA-256 second-preimage on the fixed root; the verifier
derives the leaf from the key and the path length from the 256 key bits, so neither is forgeable via
the API). It did find that the first exam **overclaimed**: its "second-preimage" block asserted domain
separation but only exercised leaf-identity binding — the whole suite stayed green even with the
domain tags removed. Fixed (test only, code unchanged): the tags are now exported and the exam
regresses the instant they are equalised, the leaf/node hashes of one payload are asserted distinct,
and the block is honestly retitled; "injective" is stated as computational (under SHA-256).

**Proven now:** given a set of ungrindable 256-bit act keys, one order-independent, duplicate-
idempotent root commits to WHICH acts are present and yields sound inclusion and absence proofs;
neither direction is forgeable, tampering any sibling is refused, and the second-preimage pitfall is
closed by construction (disjoint domain tags + a key-derived leaf + fixed depth).

**Still needed to turn a non-membership proof into censorship EVIDENCE (now built as 3d — see below):**
(1) bind a given `inclusionRoot` into the cascade/Bitcoin commitment, so "absent under THIS anchored
root" is non-repudiable; (2) a **deadline** binding a signed act to the window by which it was owed
inclusion; and (3) the link to 3c **admission**, so a writer cannot answer "I left it out because it
was invalid." 3a is the sound accumulator; 3d composes the clock and the admission link (the anchor
binding remains the live-wiring step). Proof size today is the full 256 siblings (~16 KB of hex) —
bounded, but a compaction line-item.

### 3d status (2026-08-19) — the censorship verdict: built, adversarially hardened, NOT wired

The pure verdict function is `apps/kray-core/src/protocol/censorship-evidence.ts`; its exam is
`apps/kray-core/src/test/censorship-evidence.test.ts` (11/11, in the suite). `verifyCensorship`
composes the three proven primitives into a single checkable verdict: it returns CENSORED only when
the act carries a **signed** deadline, its signature verifies (3c admission), the inclusion root is
the one committed at that window's seal (re-derived — a fabricated root is refused), the seal is at or
past the deadline against a **cumulative** root, an availability witness shows the act was public by
the deadline (3b), and a 3a non-membership proof verifies; otherwise NOT-CENSORED with the exact
reason. Wired into **no live path** — the writer, the cascade root, and the anchor are unchanged.

An adversarial council found no wrong verdict in the delivered code, but named two false-positive
vectors that a loose LIVE wiring would open — each now closed in the contract and pinned by an
adversarial exam case:

1. **Per-window vs cumulative root.** `seal ≥ deadline` is sound only if the inclusion root is
   cumulative (contains every key included at any seal ≤ this one); under a per-window root, a writer
   who included an act on time in an earlier window would be convicted from a later one. Now a
   documented obligation on `CensorshipClaim.inclusionRoot`, and the exam proves an on-time act stays
   PRESENT in every later cumulative root, so it cannot be framed.
2. **Unsigned deadline.** If a wiring read the deadline from an unsigned envelope field, a stranger
   could stamp an aggressive deadline on someone else's valid act and manufacture a verdict. Now
   `deadlineOf`'s contract mirrors `keyOf`'s — the deadline MUST be read from the signed bytes — and
   the exam proves that stamping a new deadline breaks the signature (`isValid` fails).

The absolute "no false CENSORED without a SHA-256 break" claim was softened to its honest contingent
form: *given* the deadline, key, and validity are bound to one signed message AND the root is
cumulative through the seal.

**Proven now:** given six inputs, the verdict is CENSORED iff a valid, signed-deadline, publicly-
available act is absent from the cumulative anchored window at/after its deadline; every innocent or
fabricated case (invalid act, no deadline, unfounded root, deadline not reached, not-yet-public, no
witness, tampered proof, earlier-inclusion, stamped deadline) is refused with a named reason. No
false negative was found.

**Still needed for trustless censorship proof at the live layer (unbuilt, listed):** (a) fold the
window commitment into the cascade root and pin it under the Bitcoin anchor, so `anchoredCommitment`
is non-repudiable rather than an input; (b) the availability witness (`availableBySeal`) from a
trustless 3b/ADR-2 channel the writer cannot suppress; (c) proof-size compaction (256 siblings) for
shipping evidence at scale.

### 3e status (2026-08-19) — the succession rule: built, adversarially hardened, NOT wired

The pure rule is `apps/kray-core/src/protocol/succession.ts`; its exam is
`apps/kray-core/src/test/succession.test.ts` (16/16, in the suite). It invents no consensus — it
composes the LIVE fork choice with the proven window rules. Three pieces: the **silence clock**
(`successionWindow` — succession opens after `DEFAULT_SILENCE_BLOCKS = 6` Bitcoin blocks with no
anchored window; a tunable parameter, the Creator sets the final value); the **successor-window check**
(`validateSuccessorWindow` — re-derives 3c order → 3a root → 3d commitment and refuses a tampered set,
a smuggled invalid act, or a fabricated commitment); and the **N-claimant reduce** (`canonicalHead`)
over the live `chooseCanonical`. Wired into **no live path** — the writer, cascade root, anchor, and
the live `chooseCanonical`/backstop are unchanged.

An adversarial council found no wrong result (the reduce is a lexicographic total order, provably
order-invariant), and named three items — each now fixed:

1. **(medium) exam overclaim** — the first `canonicalHead` exam used only proofless heads, so it
   exercised the free tie-break (height, tip hash), never the Bitcoin-work tiers it headlined. Fixed
   with a genuine anchored case: real SPV-proven anchors of differing burial depth, proving the deeper
   anchor wins the reduce order-invariantly and outranks a taller unwitnessed chain.
2. **(low) mixed-network throw** — `canonicalHead` reduced over `chooseCanonical`, which throws on a
   network mismatch, so one hostile off-network claim aborted fork choice. Now it fails **closed**
   (returns null on a heterogeneous list), consistent with `provenWeight`'s never-throw posture, and an
   exam pins it.
3. **(low) clock provenance asymmetry** — only `tipHeight` was documented as the successor's own
   SPV-verified view; an inflated `lastAnchoredBtcHeight` would freeze succession shut (liveness
   denial). The contract now binds **both** heights to the successor's own verified anchor, and an exam
   asserts the inflated-input direction.

**Proven now:** the silence clock is a correct integer function (fail-closed on non-integers); a
successor's window is follower-checkable for internal consistency (no invalid act can enter or move the
commitment); and N claimants reduce to one deterministic winner — over BOTH the free tie-break and the
real Bitcoin-work tier — in any order, so equivocation never becomes a permanent split.

**Still needed for live succession (unbuilt, listed — the module disclaims all of these):** (a)
**prev-root binding** — that a successor's window sits on the previous canonical root (the live wiring
folding `windowCommitment` into the cascade root and onto Bitcoin); (b) the **shared nonce snapshot**
both writers evaluate against (a caller-supplied `nonceOf`, not verified here); (c) **data availability
/ inbox completeness** (ADR-2 — without it a successor can omit acts and still produce an internally
valid window); and (d) **liveness under adversarial silence** (withheld anchors + a hidden inbox).
Safety rests on `chooseCanonical` (live + tested); guaranteed liveness is the ADR-2 + live-wiring
frontier, not a 3e claim.

**Locked objective (2026-08-26):** the live picture — writer as a *role*, silence-or-strike
opens the race, Bitcoin + conduct pick the head, pot never transfers — is pinned in
`docs/MULTI-WRITER-OBJECTIVE.md`. Wiring slices W1–W5 only. Do not invent a committee.

**The order of build.** 3a → 3b → 3c (the theorem) → 3d → 3e — each slice attacked before the
next, exam-first on the lab bench, live Signet last. 3e activates only after 3c's theorem holds
on Signet.

---

## ADR-4 — Bitcoin reorg as a formal state transition · promotes Articles VI + X

**Invariant.** A Bitcoin reorg is an explicit, specified transition — never undefined behavior — and
**Crane state finality** is a distinct concept from **Bitcoin anchor confidence**.

**Today.** Fork choice weighs cumulative work and counts a block once; the seal's window law is
once-per-txid. But a reorg that un-buries an anchored root is not a named transition, and the two
finalities are not distinct protocol states.

**Design.**
- **Two explicit states.** `crane-finality` (a root is canonical-by-replay the instant it is produced)
  vs `anchor-confidence` (graded by the burial depth of the deepest SPV-proven anchor). Surface both in
  protocol and UI; they are different facts (the reviewer's #6).
- **Reorg rule.** Execution is NOT reverted merely because an anchor changed status — the journal and
  its replay stand. Only `anchor-confidence` drops; the network waits for the next anchor (or a deeper
  competitor) and fork choice re-weighs. A burn proof (ADR-1) un-buried by a reorg fails its
  burial-depth check on re-verification and its mint is refused on replay, so no ₭ survives without a
  definitive burn (closes the reviewer's #7 reorg-inflation vector).
- **Anchor semantics (reviewer #5):** same-Bitcoin-block anchors resolved by the existing rule; a flood
  of fabricated anchors is cheap-rejected before the expensive verify (`consensus.ts:113`); specify the
  scan bound as protocol.

**Proven slices.** (4a) split the two finalities in the state + `/api`. (4b) the reorg transition +
a test that reverts an anchor and asserts execution stands while confidence drops. (4c) the burn-under-
reorg test (couples with ADR-1). (4d) the fabricated-anchor DoS bound as a specified limit.

---

## The order of build (the entities' cronograma)

**Rail 5 (constitution) — DONE.** Then, each a proven slice attacked before the next:
**ADR-1 (peg in consensus)** first — the highest value, the most contained, retro-safe today →
**ADR-4 (reorg formalism)** (small, couples with ADR-1's burn re-verify) →
**ADR-2 (data availability)** (infra) →
**ADR-3 (multi-writer ordering)** (the hardest; last, on the firmest possible base).

*The design is the promise the code will keep. Ratify an ADR, then build its slices — and KRAY walks,
one proven step at a time, from an honest single-writer ledger toward a protocol that outlives us.* ⛓₭
