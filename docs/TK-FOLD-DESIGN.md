# THE TK-FOLD — design record (stage 2 of the feeless Ӿ resonance)

> **Post-reset note (v1.0.0 genesis, 2026-08-26):** the seq-255 pin below belongs to the retired old
> Signet chain. On the reborn signet and on mainnet the fold is **born active at seq 0**
> (`TK_FOLD_ACTIVATION_SEQ` in `ledger.ts`), and the proving stack the early sections call
> "not yet wired" HAS since been wired (WASM verifier in consensus, `fold-verifier.ts`,
> `scripts/folder/fold-once.mjs`, `POST /api/kraynet/lane-send`) — the later gate records in this
> same file are the executed truth.

> Status: **BUILT + PROVEN THROUGH GATE 3a (2026-08-24)** — the executable
> specification, the SP1 guest (golden vectors byte-for-byte), real Groth16
> fold proofs verified by the vendored WASM verifier in consensus (on apply
> AND on replay), the lane's journal kinds behind the dormant activation seq,
> and the folder end to end (18/18 + a live regtest crossing on the 4477 lab
> node, two breaths sealed). **Signet CROSSED LIVE at seq 255–256** (first
> Groth16 fold-seal on the air, fleet in unison at root `b0e41001…`).
> Mainnet born active (0). The gate record below is the law.
> Parent record: `docs/X-FEELESS-DECISION.md` (rounds 1–10).
> Name law (round 8): TK = **Total Knowledge**, signed **Tom Kray**. KRAY hides
> nothing — the proof delivers total knowledge of the transition, so the
> world's "zero-knowledge rollup" was always the wrong word here. The engine
> is **the TK-fold**; its proof is **the fold proof**; its on-journal data are
> **the fold diffs**; the role that assembles a breath is **the folder**.

## The frame (axioms first)

- **A1** — nothing exists unless mathematics proves it (signature ‖ Merkle ‖
  Bitcoin anchor), at the door AND on replay.
- **A3** — a format anchored on Bitcoin only ever GROWS; history is never
  rewritten. Every new law activates at a pinned seq, dormant below.
- **The Creator's re-sync law (X-FEELESS round 4)**: anyone who re-syncs must
  rebuild EVERY balance from the journal's bytes alone — irrefutable, no
  trust, no external data. This is why the fold diffs live ON the journal
  (a validium, with data off-journal, was refused and stays refused).

## What the TK-fold is

A second lane for Ӿ. The journal lane (THE FIREBORN LAW, live on signet since
seq 245) stays forever — it is the escape hatch no folder can close. The
TK-fold lane compresses: transfers happen inside a **breath** (an epoch), and
what lands on the journal per breath is

1. **the fold proof** — one succinct validity proof: *"there exists a set of
   validly-signed lane transfers that, applied to the state with root
   `preLaneRoot` in the canonical order, yields the state with root
   `postLaneRoot`, whose net effect is exactly these diffs"*;
2. **the fold diffs** — every touched address → its new lane balance + nonce.

Bytes per breath scale with **addresses touched**, never with transfer count:
the Creator's bot doing a zillion sends between 2 addresses costs 2 diff
lines + one proof — the same bytes as 1 send.

## The council's ratified anatomy

| Piece | The law |
|---|---|
| **Lane entry / exit** | Journal acts (existing signed kinds, extended at Gate 2) — the lane can never mint or destroy Ӿ; it only rearranges what entered. Conservation is checked at every seal: Σ lane balances is a public input. |
| **The breath** | A bounded window of lane transfers assembled by the folder. Cadence decided at Gate 2 (candidate: one breath per Bitcoin seal, so every anchor carries a settled lane). |
| **Order inside a breath** | THE SAME THEOREM as the Same-Instant Law: admission by signature first, then the `orderWindow` schedule over `sha256(signed bytes)` — not even the folder chooses. One ordering law for the whole network, journal and lane alike. |
| **The lane's signed domain** | `kray-core.tk-fold-send.v1|net=…|from=…|to=…|amount=…|nonce=…` — its OWN domain: a journal x-send signature can never be replayed into the lane, nor the reverse. Lane nonces are per-account and persist across breaths (replay across breaths is dead by nonce law). |
| **The folder** | A role, never a trust. It cannot forge (signatures), cannot reorder (orderWindow), cannot inflate (conservation public input), cannot lie about state (the fold proof). The worst it can do is stall — and the journal lane is always open. |
| **The fold proof** | Generated in a zkVM guest that implements THE SAME executable spec (`tk-fold.ts` is the reference the guest must match byte-for-byte). Verified by the reducer on every node, on apply AND on replay — fail-closed. |
| **Fireborn interplay** | The fire stays the sybil wall: Ӿ only exists by burning ₭, and lane entry is a journal act. Inside the lane, transfers are feeless and unmetered — per-transfer bytes are zero, so the stage-1 tank and 3.5-s gap (which bound JOURNAL bytes) do not apply in-lane. They remain the journal lane's law. The one byte that still grows — a diff line per touched address — is priced by the fire: reaching a new address requires Ӿ that burned ₭. |

### Public inputs of the fold proof (the binding, exact)

```
network | breathIndex | preLaneRoot | postLaneRoot | diffsHash | laneTotal
```

- `preLaneRoot` must equal the lane root the journal already holds (chain of
  breaths — a fork or replayed proof from another breath/network dies here);
- `diffsHash` binds the proof to the EXACT diffs posted beside it — a proof
  cannot be re-used over altered diffs;
- `laneTotal` (Σ balances) must be unchanged by a pure-transfer breath —
  conservation as a public input, checked by every node in O(1);
- `network` kills cross-network replay (signet proof on mainnet: refused).

## The mathematics already in bytes (Gate 0 — proven today)

`apps/kray-core/src/protocol/tk-fold.ts` is the executable specification —
the pure function every future prover and verifier must equal:

- `tkFoldSendMessage` — the lane's injective signed domain;
- `foldBreath(network, preState, transfers)` — admission by real signature
  verification, the `orderWindow` schedule, validate-then-mutate application
  (a refused act mutates nothing and never advances a nonce), diffs, roots,
  and a conservation tripwire that throws if Σ moves;
- `applyFoldDiffs` + `verifyFold` — the follower's path: rebuild the post
  state from diffs alone and demand the claimed root, byte-for-byte.

Proven by breaking in `src/test/tk-fold-spec.test.ts`: arrival-permutation
invariance (the folder's socket order is irrelevant), diff↔replay
equivalence, conservation under storm, forged signature exclusion, overdraft
and nonce laws, forged/withheld diff detection, cross-domain replay refusal,
and the Creator's bot exam — thousands of sends between 2 addresses collapse
to exactly 2 balance diffs.

## The validator-burden law (council — the Creator's simplicity question)

*"Will every validator have to install these things?"* — **No. Sealed as law:**

- **A validator's install NEVER grows.** The fold-proof **verifier** ships as a
  vetted, version-pinned **pure-WASM/JS npm dependency** inside `kray-node` —
  it arrives in the same `npm install` every follower already runs. Verifying
  a proof costs milliseconds and a few MB. Clone → install → run, today and
  after the lane activates: zero Rust, zero Docker, zero GPU, ever.
- **Only the folder carries iron.** The heavy toolchain (Rust, SP1, Docker for
  the proof wrap) belongs to whoever CHOOSES to be a folder — exactly
  Bitcoin's asymmetry: anyone may mine, nobody must mine to validate. The
  complexity stays locked in the forge; the network receives only the simple
  artifact — a fixed-size proof any `npm install` knows how to check.
- **Fail-closed, no toolchain escape hatch:** the reducer refuses to apply a
  `fold-seal` it cannot verify — a verifier that required an external
  toolchain would make honest nodes diverge, so a toolchain-free verifier is
  a CONSENSUS requirement, not a convenience (Gate 2 exit criterion).
- **No folder, no problem:** the journal lane (THE FIREBORN LAW) never
  closes — the network breathes with zero folders alive.

## The proving stack (grounded 2026, decided — not yet wired)

- **Family precedent, live**: Citrea (Bitcoin mainnet since Jan 2026) runs
  exactly this shape — zkVM batch proofs (RISC Zero → Groth16) + compressed
  state diffs published to Bitcoin as data availability. The family works in
  production on the most hostile base layer there is.
- **KRAY's choice: SP1 zkVM** — the guest is Rust implementing `tk-fold.ts`'s
  spec (schnorr/secp256k1 precompiles keep cycles sane); proofs compressed
  and wrapped (Plonk preferred: no per-circuit trusted ceremony); the
  **verifier runs in the Node reducer via the `sp1-verifier` WASM bindings**
  (vetted crate, wasm-wrapped — no hand-rolled crypto, per the repo's law).
- Fallback recorded: RISC Zero (Citrea's stack) if SP1's wasm verifier
  disappoints under audit.

## Adversary sweep (round: every vector, its wall)

| Vector | Wall |
|---|---|
| Cross-lane double-spend (spend on journal + in lane) | Lane balance and journal balance are DISJOINT books; entry/exit are journal acts; conservation public input at every breath |
| Folder equivocation (two breaths from one preRoot) | The journal hash-chain admits one `fold-seal` per breath; preLaneRoot chaining kills the sibling; guardians' monotonic head + ADR-3 scar the attempt |
| Diff withholding | Diffs are journal bytes — omission breaks replay → identical HALT on every node (same law as any journal act) |
| Forged diff under a real proof | `diffsHash` is a public input — the proof binds the diffs; altered diffs = verification failure |
| Proof replay (another breath / another network) | `preLaneRoot` chaining + `network` in public inputs |
| Folder censors a user | The journal lane is NEVER closed — post the x-send directly (Fireborn fee schedule applies); ADR-3 inclusion evidence already scars journal omission |
| Sybil diff bloat (touch millions of addresses) | Every lane balance is Ӿ, and Ӿ only exists by burning ₭ — a million touched addresses is a million funded addresses: capital destroyed prices the byte |
| Circuit/spec drift | ONE executable spec (`tk-fold.ts`), exams pinned; the guest must reproduce its vectors byte-for-byte before any activation (Gate 1 exit criterion) |
| Mock-prover false-green | FORBIDDEN by this document: no lane activation until real fold proofs verify in the reducer — a mock is not a proof and will never gate consensus |

## The honest gates (no overclaim — the only path)

- **Gate 0 — the spec (DONE)**: `tk-fold.ts` + exams green.
  Nothing consensus-visible; a pure, proven reference.
- **Gate 1a — the golden vectors (DONE)**: `src/test/vectors/tk-fold.golden.json`
  — six frozen scenarios with REAL schnorr signatures over the lane domain and
  byte-exact expected outputs (preRoot, postRoot, diffsHash, sorted diffs,
  applied/refused/deferred): a plain breath, same-nonce rivals, every refusal
  law, the Creator's bot (100 sends → 2 diff lines), the empty breath, and the
  cross-domain replay. Guarded by `tk-fold-vectors.test.ts` in the suite —
  any drift in ordering, hashing, refusal law or diff shape breaks loudly.
  The Gate 1 exit criterion is the zkVM guest reproducing EVERY field of
  EVERY vector byte-for-byte. (Regeneration refreshes signatures — BIP340
  aux randomness — but the mathematics must not move; `--regen` prints a
  drift verdict.)
- **Gate 1b — the prover bench (DONE, 2026-08-23, Creator-authorized forge
  install)**: `apps/kray-fold/` — the SECOND implementation. `lib/` is the
  Rust twin of `tk-fold.ts` (sha2 + k256 BIP-340 + bech32 taproot binding +
  the orderWindow port, vetted crates only); `program/` is the SP1 guest;
  `script/` is the bench. RESULTS: **all six golden vectors reproduced
  byte-for-byte by the guest on the first crossing** (V1 13.9M cycles ·
  V2 4.7M · V3 10.2M · V4 the-bot 227M · V5 0.14M · V6 2.3M), and a **REAL
  fold proof** (SP1 compressed STARK) of V2 was generated in ~45 s and
  **verified in ~29 ms** — the validator-burden asymmetry demonstrated live
  (~1,500× prove/verify). Public outputs of the proof matched the frozen
  vector. Toolchain on the forge only: rustup + sp1up (cargo-prove
  f66b4bf 2026-08-12) + protoc; `native-gnark` deliberately OFF (the
  Groth16/Plonk wrap needs Go/Docker and serves only the tiny-verifier wrap).
  CONTINUED same night, both remainders closed at the bench level:
  (1) **THE CANONICAL-DECIMAL LAW** — the TS door hardened to the narrower
  law (an amount is admitted only as the exact string `BigInt.toString`
  emits, within u128; a nonce is a canonical non-negative safe integer; the
  Rust twin gains the same 2^53 nonce ceiling) — TF-11 proves 12 hostile
  encodings all refused at admission; golden vectors unchanged (no drift);
  (2) **the Groth16 wrap is REAL** — with Go installed (forge only),
  `--features wrap --groth16` produced a constant-size Groth16 proof of V2
  over bn254 in ~12.7 min (first run, including circuit-artifact download)
  and **verified it in ~152 ms** — this is the exact artifact shape the
  npm-shippable WASM verifier will check inside the Node reducer.
  REMAINING for Gate 2 proper: embed that verifier as the pinned npm/WASM
  dependency in the reducer (the validator-burden law's delivery), then the
  dormant journal kinds behind `TK_FOLD_ACTIVATION_SEQ`.
- **Gate 2 bridge — the WASM verifier (DONE, 2026-08-23, same night)**:
  `apps/kray-fold/verifier-wasm/` wraps the vetted `sp1-verifier` crate
  (Groth16 over bn254) in wasm-bindgen; `wasm-pack build --target nodejs`
  emits a pure JS + 255 KB WASM package — **zero toolchain for validators**.
  The bench gained `--save`: the REAL Groth16 fold proof of V2 (356 bytes,
  constant-size) is committed at `apps/kray-fold/proofs/fold-groth16-v2.json`
  with its public values and vkey hash. `apps/kray-fold/wasm-verify.mjs`
  then verified it **in pure Node in ~262 ms** (first call includes WASM
  init; subsequent calls ~55 ms), decoded the committed public outputs
  (preRoot/postRoot/diffsHash/laneTotal/applied/refused/deferred), and the
  two adversary exams fail closed: one flipped proof byte → false; an alien
  vkey hash (a valid proof of the WRONG program) → false. The verification
  chain is now end-to-end real: TS spec → golden vectors → Rust twin →
  SP1 guest → Groth16 wrap → **Node verifier a stranger can run with
  `node wasm-verify.mjs`**. REMAINING for Gate 2 proper: the dormant journal
  kinds behind `TK_FOLD_ACTIVATION_SEQ` wired to this verifier in the
  reducer, on apply AND on replay.
- **Gate 2 — the lane in consensus (BUILT + PROVEN dormant, 2026-08-24)**:
  the council's ratified anatomy, all additive behind `TK_FOLD_ACTIVATION_SEQ`
  (regtest MAX; signet PINNED at 255 on 2026-08-24, tip was 248; mainnet born active):
  - **Three journal kinds.** `lane-enter` (signed, own domain, no `to`) moves
    spendable Ӿ into the lane; `lane-exit` is the mirror; `fold-seal` lands one
    proven breath — the folder signs `pre|post|diffsHash` (all three are public
    inputs of the proof, so signature, proof and journal bytes tell ONE story),
    and carries the proof, the committed public values, and the sorted diffs
    (the re-sync law: every lane balance rebuilds from journal bytes alone).
    All three pay the eternal 1-₭ fee — verification work is spam-priced.
  - **The reducer's six walls, in order, all BEFORE any mutation:** (1) the
    diffs re-hash to `foldDiffsHash`; (2) `foldPre` chains to the ledger's
    CURRENT lane root (a stale fold refuses — the same breath can never land
    twice); (3) the decoded public values equal the act's claims and the
    network (the domain wall); (4) conservation — the proven `laneTotal`
    equals the lane's total now; (5) the Groth16 proof verifies via the
    vendored WASM verifier against the ONE pinned program
    (`TK_FOLD_VKEY_HASH` in `fold-verifier.ts` — a proof of any other guest
    refuses; fail-closed: a node that cannot load the verifier HALTs, never
    accepts); (6) the diffs alone rebuild the claimed `foldPost` root.
    Apply and replay are the SAME code path, so a re-syncing stranger
    re-verifies every fold proof from bytes.
  - **The tripwire extended, never weakened:** Σ spendable Ӿ + Σ lane Ӿ ==
    burned (`conserves()`); the lane root folds into the cascade LAST, only
    at/after activation (A3 — every anchored root below opens byte-identical).
  - **PROVEN with the REAL proof, tier 1 (regtest first):**
    `tk-fold-consensus.test.ts` — 25/25: consensus acts reconstruct golden
    V2's exact pre state (burn → lane-enter → laneRoot == the golden preRoot),
    the committed 356-byte Groth16 artifact lands in-reducer (~235 ms), and
    every wall is attacked (tamper, altered diffs, public-value lies, wrong
    network, conservation lie, stale fold, overdrawn exit, dormant refusals,
    byte-identical replay). `tk-fold-swarm.test.ts` — 13/13 LIVE over HTTP: a
    disposable regtest node (`KRAY_LAB_TK_FOLD_SEQ`, regtest-only lab door)
    accepts the real fold-seal at the door, lights agree, reboot re-verifies
    the proof and reaches the byte-identical root. Full suite green (the
    dormant guarantee: no existing journal moves a byte).
  - **Named residue:** the folder daemon (assembling breaths from user lane
    transfers + running the forge) is OPERATIONAL tooling, not consensus —
    it lands with Gate 3's crossing rite.
- **Gate 3a — THE FOLDER, end to end on regtest (BUILT + PROVEN, 2026-08-24)**:
  the operational pipeline, with the folder holding ZERO power:
  - **The lane mempool (non-consensus, in-memory).** `POST /api/kraynet/lane-send`
    admits one pending lane transfer — the door pre-checks the canonical-decimal
    law, the canonical nonce, distinct parties, and the REAL BIP-340 signature
    over `tkFoldSendMessage`, so hostile bytes never occupy a slot (the zkVM
    re-checks everything regardless; the door is not trusted). Capped at 10,000,
    dedup by (from, nonce, to, amount), pruned lazily against the PROVEN lane
    nonce. `GET /api/kraynet/lane` serves the proven pre state (the breath's
    `pre`) + the pool — any auditor's view. A lost pool is re-submitted, never
    re-derived: a mempool, not a journal.
  - **The folder (`scripts/folder/fold-once.mjs`).** Pull → fold (the TS spec
    re-runs locally; its `preRoot` must equal the node's live lane root) →
    forge (the SP1→Groth16 bench gained `--input`: it proves an ARBITRARY
    breath, expectations re-derived by the Rust twin inside — the guest is
    still checked against a second computation) → land (normal prepare/submit;
    the reducer re-verifies all six walls). Worst hostile folder: folds
    NOTHING — anyone else with the script folds instead.
  - **PROVEN by fire (workshop `tk-fold-folder-exam.mjs` — 18/18, real forge,
    ~5 min):** 3 users sign lane sends (A→B 40, A→C 10, B→C 25); a forged
    signature and a `"0x10"` amount refuse at the door; the folder forges a
    REAL Groth16 proof (~250 s) and lands it; C — an address that NEVER
    touched the journal — holds 35 lane Ӿ; the pool prunes itself; a
    pure-lane account CANNOT exit without fire (the eternal 1-₭ fee is the
    law: feeless life is inside the lane, journal bytes cost ₭); with 1 ₭ C
    exits; reboot re-verifies the proof from bytes alone, byte-identical root.
- **Gate 3b — signet crossing (CROSSED LIVE, 2026-08-24)**: pin 255
  (tip was 248). Fleet first, then the writer (head stayed
  `8d511231…` at seq 248 — A3 on the air). Crossing rite: walk 249–254,
  `lane-enter` of 2 Ӿ at seq 255, one feeless lane-send in the pool, a
  REAL Groth16 breath forged in 185 s and landed as `fold-seal` at seq
  256 (cascade `b0e41001…`, lane root `9aefcb2d…`). Local replay of the
  whole journal reached the writer's exact root. All three guardian
  houses replayed 256 events to the SAME root and re-verified the
  Bitcoin seals — VERIFIED, AND NOW THERE ARE TWO.   Mainnet born active
  at 0.
- **Gate 3c — any house folds (BUILT + PROVEN, 2026-08-24)**: the folder is a
  ROLE, not a person. `scripts/folder/preflight.mjs` confronts THIS key
  against THIS node (1 ₭, this network, the lane door) BEFORE a forge.
  `fold-once.mjs` re-runs that gate so a second house does not burn minutes
  of compute to learn it cannot pay. Proven: `folder-two-houses.test.ts` —
  two unrelated keys both pass preflight; a 0-₭ house fails closed; house A
  lands the breath; house B is refused as a STALE fold, not as unofficial.
  No allow-list. No cron. No Seal button. The eternal 1 ₭ stays A2.

## THE PAID BINDING — the fold already lives in the Bitcoin txid (round 10)

The entities named the missing object. It is a **reading**, not a new
book, not a new fee, not a new activation:

```
fold-seal (journal, 1 ₭)
  ⊂ laneRoot
  ⊂ cascadeRoot          // sequential SHA-256, lane: last (A3)
  ⊂ OP_RETURN 49 bytes   // KRAY.NETWORK | ver | height | cascadeRoot
  ⊂ Bitcoin txid         // SHA256d of the tx that already paid those 49 bytes
```

The Groth16 body stays on the journal act the folder already paid. The
Bitcoin txid is the **name** of that commitment — 32 bytes of binding, not
a container for the body (Fano). A second `foldRoot` beside the cascade is
a duplicate (Huffman). Fold-seal is not a special L1 encoding: `x-send`
and `fire:` ride the same chain (Newton).

Code: `apps/kray-core/src/anchor/paid-binding.ts`.
Proof: `apps/kray-core/src/test/paid-binding.test.ts`.
Council: `docs/X-FEELESS-DECISION.md` round 10.
Auditor: `docs/anchor-spec.md` (the 49-byte checklist already verifies the
fold, because the cascade opening includes `lane:`).
Door: `GET /api/kraynet/paid-binding` (optional `?seq=`) — the certificate
a stranger holds (`ceiling` names the v1 u32 height field: fail-closed).
Statuses never mix: 200 live · 400 codec refuse · 404 missing.
Also on `/api/kraynet/receipt/<seq>` and `/api/kraynet/tx/<hash>` — those
act doors still return the event when the certificate is refused.
The `/tx/<hash>` page teaches both THE PAID BINDING and THE HEIGHT CEILING
from the live certificate — not a hardcoded year-count. The certificate
itself carries `verify` (`PAID_BINDING_VERIFY`) and `tip.named: false`
(a live payload is a preview, never a covering Bitcoin name).

Discarded branches (named): validium (diffs off-journal) — breaks the
re-sync law, refused in round 3 and stays dead; a trusted-committee lane
(no proof, multisig attestation) — trust is not mathematics; activating the
lane before the verifier exists — a false-green worse than no lane. Gate 2
additions: an UNSIGNED fold-seal (mathematically sufficient, but free DoS at
the door — the folder signs and pays the eternal 1 ₭ instead); feeless
lane-enter via the fireborn tank (entry is rare; coupling two laws multiplies
the audit surface for zero user value — enter/exit pay the eternal fee).
Gate 3a additions: a PERSISTED lane mempool (a journal for the unjournaled —
pending transfers are the sender's to re-submit, persistence would invite
"the pool is truth" confusion); a long-running folder daemon with a timer
(a one-breath tool composes into cron/systemd on the operator's terms;
the loop adds state where none is owed). Gate 3c additions: an allow-listed
folder address (a second writer by another name); a LaunchAgent that makes
one house THE folder. Round 10 additions: stuffing the Groth16 into the
txid / OP_RETURN (past Fano); a v2 payload with a second foldRoot
(Huffman-redundant); an inscription envelope for the proof body (new L1
surface, validium if diffs leave the journal); piggybacking the seal on a
feeless x-send (couples kinds, free DoS); vanity-grinding the txid
(does not halt).
