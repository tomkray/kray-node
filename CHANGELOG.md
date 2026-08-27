# Changelog

All notable changes to KRAY.NETWORK are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Every entry corresponds to a slice that was proven (tested, attacked, or
verified live) before it landed. From v1.0.0 the software carries Semantic
Versioning (the tag names the SOFTWARE; the protocol is versioned by its
consensus flags and activation sequences — a tag never replaces a proof):

- **MAJOR** — consensus: a replayer on the previous version would HALT.
  Every guardian/follower runs the same commit BEFORE the writer flips.
- **MINOR** — door/features: replay-compatible endpoints or UI.
- **PATCH** — chrome: docs, canon, cosmetics, no contract touched.

## [1.0.0] — 2026-08-26 · THE GENESIS RELEASE

Signet and mainnet are both born at block #0 under this version — the same
height, the same commit, the complete law active from the first event. Every ₭
ever minted is re-derivable from the journal bytes alone; no grandfather
clauses, no door-trusted past. Exposed on `/api/kraynet/head` as `v`.

- **SELF-ANCHORING BURNS RE-PROVEN IN CONSENSUS (ADR-1 extended).** A `donate`
  event carries `anchorBlock` + `anchorRoot` beside its SPV proof; the reducer
  re-derives the expected script — the pot internal key tweaked by
  `KrayAnchor.payload` (BIP-341 pay-to-contract; NUMS key = a keyless burn) —
  and re-proves the burn on every apply and replay. A claim never chooses the
  script. Door flag `KRAY_CONSENSUS_SELF_ANCHOR_PROOF` is ON from genesis on
  both universes. Pinned by `self-anchor-consensus-proof.test.ts` (tampered
  root/block/script all HALT; absence stays byte-identical; enforcement is
  opt-in per node config, the exact `potScriptHex` polarity).
- **THE MAINNET BURN GATE in the door binary.** On `KRAY_NET=main` a configured
  `KRAY_POT_INTERNAL_KEY` must be the BIP-341 NUMS point or `server.mjs`
  refuses to boot — a spendable key would turn "burned forever" into someone's
  custody. Followers that set no key boot exactly as before.
- **THE CHAIR LAW — the pot target is an identity, ratified by the Creator.**
  `DEFAULT_POT_TARGET_SATS = 21,000,000` = **2,100 chairs × 10,000 ₭** (the immutable per-mint
  cap): the two Bitcoin numbers meet in one constant that explains itself. One chair = one
  full-cap mint; one confirmed Bitcoin seal frees exactly one chair, forever. NOT a supply
  ceiling (₭ has none — every unit costs a burned satoshi and a buried seal); this sizes the
  standing reservoir. Self-checked at module load; a consensus constant in code, never an env
  var. Every golden root re-captured under it (pre-chair values kept named in the tests).
- **THE STAR MARKET — native, atomic, trustless (in the reducer).** Three additive
  signed kinds — `star-list`, `star-delist`, `star-buy` (edit price = re-list) —
  each its own domain. A listing is a signed commitment that moves no star; a BUY
  applies both legs in ONE reducer step (buyer's ₭ → seller, star → buyer) or is
  refused: the escrow is the mathematics, not a third party. The buyer signs the
  exact terms, so a re-priced/delisted/resold offer refutes a stale buy (no phantom
  price). The eternal 1-₭ fee goes to the validators (TREASURY), like the
  transfer-star a buy is underneath. Conservation-safe; the market never mints,
  burns, or holds value. Folds into the cascade root BY PRESENCE (AMM pattern) — an
  empty market is byte-identical to a pre-market history (A3). Pinned by
  `star-market.test.ts`; live `:4477` swarm 15/15 incl. a same-instant two-buyer
  race (exactly one wins). Born active at genesis.
- **`/api/kraynet/head` carries `v`** — any house verifies the same-commit law
  with a curl.

Every previously-unreleased proven slice below also ships in this tag; the
`[v2.0.0-alpha]` and `[v1]` sections further down are the pre-version eras
that built the machine, kept as history.

- **THE CONDUCT STRIKE — the censorship verdict gets teeth (ADR-3).**
  `chooseCanonicalWithConduct`: a head under a standing CENSORED verdict
  (this node's own `verifyCensorshipAnchored`, seal heights re-proven by
  the follower) loses fork choice to an honest head BEFORE Bitcoin work
  is weighed — the heavier incumbent censor no longer wins by weight.
  `censorshipOpensSuccession`: a standing strike opens the pen race
  without waiting for the silence clock. Pure, additive —
  `chooseCanonical` and the clock stay byte-identical; an unverified
  accusation moves nothing (fail-closed); healing is structural (an
  included act yields no current absence proof). `succession.test.ts`.

- **Two objects, never mixed.** HTTP `/receipt` is the act + the Binding
  name, not a v1 `KrayReceipt`. `verifyReceipt` stays in protocol and
  refuses that shape. A refused certificate does not hide the event.
  No v2. No consensus change.

- **`/docs` names the three statuses.** `200` live · `400` codec refuse ·
  `404` missing; `/tx` and `/receipt` still show the act. Same law on
  the node page and the public page. No v2. No consensus change.

- **`certificateDoor` is 200 / 400 / 404.** The HTTP mapping lives on
  `paid-binding.ts`. Live certificate → 200; codec refuse → 400;
  missing → 404. TC-10 + gauntlet + itest status (not `.error` alone).
  `/tx` and `/receipt` still keep the act. No v2. No consensus change.

- **`certificateOrRefuse` is the one mouth.** Codec refusal is a named
  object on `paid-binding.ts` (not a `catch` only the server knows).
  TC-09 breaks the u32 height and a bad root and asserts REFUSED, not
  missing. No v2. No consensus change.

- **A refused certificate does not hide the act.** `paidBindingOf`
  returns `{ refused, reason }` on codec failure. `/paid-binding` still
  400s; `/tx` and `/receipt` still show the event. The page names the
  refusal. No v2. No consensus change.

- **THE PAGE PINS revised.** Custody teaches the law once (steps from
  the object; `verify` is the how-to label, not a fourth checkmark).
  The record cannot print a covering name on the tip. A refused door
  is not labelled "not found". No v2. No consensus change.

- **THE PAGE reads the object.** `/tx` teaches tip-as-preview and the
  live `verify` sentence. `paidBindingOf` no longer swallows codec
  refusal as a 404 "no such event". No v2. No consensus change.

- **THE CERTIFICATE is the sentence.** `paidBindingView` carries
  `verify` (the one `PAID_BINDING_VERIFY`) and `tip.named: false` —
  a live payload is a preview, never a covering Bitcoin name. Receipt
  and `/tx` JSON inherit both. No v2. No consensus change.

- **THE HEIGHT CEILING on the receipt.** `PAID_BINDING_VERIFY` is derived
  from `HEIGHT_CEILING` (one sentence, no drift). `GET /receipt/<seq>`
  returns that constant — Binding + fail-closed u32, the asterisk a
  stranger saves with the 3 KB bundle. No v2. No consensus change.

- **THE HEIGHT CEILING on `/tx`.** The custody page reads
  `paidBinding.ceiling` from the live certificate (version · bits ·
  fail-closed) — the asterisk a stranger sees without opening the API.
  No v2. No consensus change.

- **THE HEIGHT CEILING is walkable.** The gauntlet's u32 grain is now a
  named object on every Paid Binding certificate (`ceiling`: bits 32,
  fail-closed, version 1). Same constant drives `KrayAnchor.payload`.
  Auditor spec + `/docs` name it. No v2 payload. No consensus change.

- **THE PAID BINDING GAUNTLET.** Nineteen entity lenses as hostile attackers
  over 1,200 seeds of real conserved ledgers (2,423 checks): forged roots,
  every-byte channel flips, Fano body-stuffing at seven sizes, a 200k vanity
  grind, two-anchor equilibrium, append-only A3, the phantom sweep. No vector
  moves a byte without signature ‖ Merkle ‖ anchor; the txid never holds the
  body. Named grain: the anchor height is u32 — it FAILS CLOSED (never wraps)
  and saturates in ~476 years at 3.5s/block, so "1000 years" carries the
  version-byte v2 widening as its honest asterisk. `paid-binding-gauntlet.test.ts`.
  Council: `docs/X-FEELESS-DECISION.md` round 11.

- **THE PAID BINDING.** The entities named the inclusion that was already
  paid: journal act ⊂ subsystem root ⊂ cascade ⊂ 49-byte OP_RETURN ⊂
  Bitcoin txid. The Groth16 body stays on the fold-seal (1 ₭); the txid
  *names* it, it does not hold it (Fano). No new L1 bytes, no second
  foldRoot, no activation seq. Walkable: `GET /api/kraynet/paid-binding`
  (optional `?seq=`), on the receipt and the tx page. The certificate holds
  TWO epochs that never mix — `sealed` (the covering Bitcoin name,
  cumulative) and `tip` (the live opening) — a same-day audit caught and
  fixed a first cut that blended them (presentation only; consensus never
  imports the module). `paid-binding.ts` · `paid-binding.test.ts`.
  Council: `docs/X-FEELESS-DECISION.md` round 10.

- **THE FOLDER — Gate 3c, any house folds.** Preflight before the forge:
  THIS key, THIS network, 1 ₭, or HALT. Two unrelated houses both qualify;
  a 0-₭ house cannot start a proof; the second sealer is refused as stale,
  never as unofficial. `scripts/folder/preflight.mjs` · `fold-once.mjs`
  re-checks · `folder-two-houses.test.ts`. No cron, no allow-list, no Seal
  button. The 1 ₭ stays A2.

- **THE NIX FRACTAL SWARM.** Atemporal antifragility of Ӿ by formula, not wall-clock:
  `W(s)=2^s`, `R(s)=R0·2^s`, one `at += 100y` jump per octave. Same tripwire I at
  every scale; time does not refill the tank (Koinos-class Mana regen is dead);
  hostile hex/pad/sybil/fee-flip leave the book byte-identical; a follower
  replays the largest journal to the same root. `nix-fractal-swarm.test.ts`.

- **A1 is a HALT, not a report.** `applyLive` now throws and freezes the ledger
  if `conserves()` fails after an accepted act (Σ ₭ / Σ Ӿ / tank). The store
  poisons so dirty RAM cannot append the next seq; the lie never reaches the
  journal; a restart replays only durable honest bytes. `x-send` amounts obey
  the same canonical-decimal law as the lane (`0x10` / pads refuse — no JS/Rust
  twin-fork). The lane door refuses a send the lane book cannot cover
  (amount + pending) — signed dust cannot flood the mempool. Proven:
  `conservation-halt.test.ts`; `server.itest` refuses empty-lane prepare/send.

- **THE TK-FOLD — profile lane doors (no consensus change).** The Operate card
  now ships enter · feeless lane-send · exit · journal `x-send`. HTML never
  invents the lane domain: `POST /api/kraynet/lane-prepare` returns
  `tkFoldSendMessage` + the next nonce. Seal stays `fold-once.mjs` (no in-browser
  Groth16). `server.itest` — tampered lane-send refused; empty-lane send refused;
  cascade root unchanged.

- **THE TK-FOLD — Gate 3b CROSSED LIVE on Signet (2026-08-24).** Pin 255
  (tip was 248). Fleet first, then the writer — head stayed byte-identical at
  seq 248. Crossing rite walked 249–254, entered 2 Ӿ at seq 255, and landed a
  REAL Groth16 `fold-seal` at seq 256 (cascade `b0e41001…`). Local replay and
  all three guardian houses reached the same root. The compressed lane is
  consensus on Signet. Mainnet born active at 0.

- **THE TK-FOLD — Gate 3a: THE FOLDER runs end to end on regtest, with the REAL forge (2026-08-24).**
  The operational pipeline, folder holding ZERO power. (1) The lane mempool — non-consensus, in-memory:
  `POST /api/kraynet/lane-send` admits a pending lane transfer only past the canonical-decimal law, a
  canonical nonce, distinct parties and a REAL BIP-340 signature over `tkFoldSendMessage` (hostile bytes
  never occupy a slot; the zkVM re-checks everything regardless); capped at 10,000, dedup'd, pruned
  against the PROVEN lane nonce; `GET /api/kraynet/lane` serves the proven pre state + the pool.
  (2) THE FOLDER (`scripts/folder/fold-once.mjs`): pull → fold (the TS spec re-runs locally and its
  preRoot must equal the node's live lane root) → forge (the SP1→Groth16 bench gained `--input` to prove
  an ARBITRARY breath, expectations re-derived by the Rust twin inside) → land (normal prepare/submit;
  the reducer re-verifies all six walls). Worst hostile folder: folds nothing — anyone with the script
  folds instead. PROVEN by fire (workshop folder exam, 18/18, real ~250 s Groth16 forge): three users'
  signed sends cross the pool; forged signature and `"0x10"` amount refuse at the door; the fold-seal
  lands; an address that NEVER touched the journal holds lane Ӿ; the pool prunes itself; a pure-lane
  account cannot exit without fire (the eternal 1-₭ fee — feeless life is inside the lane); reboot
  re-verifies the proof from bytes alone, byte-identical root. Full suite green.

- **THE TK-FOLD — Gate 2: the lane is in consensus, dormant, proven with the REAL proof (2026-08-24).**
  Three additive journal kinds behind `TK_FOLD_ACTIVATION_SEQ` (regtest/signet MAX — signet pins at
  the Gate 3 rite; mainnet born active): `lane-enter`/`lane-exit` move spendable Ӿ between the journal
  book and the compressed lane (signed, own domains, eternal 1-₭ fee); `fold-seal` lands one proven
  breath — the folder signs `pre|post|diffsHash` (all public inputs of the proof) and the reducer holds
  six walls BEFORE any mutation: diffs re-hash, preRoot chains to the lane's present (a breath can never
  land twice), public values equal the act and the network, conservation (`laneTotal` == the lane's
  total), the Groth16 proof verifies via the vendored WASM verifier against the ONE pinned program
  (`TK_FOLD_VKEY_HASH` — fail-closed: a node that cannot load the verifier HALTs), and the diffs alone
  rebuild the claimed postRoot (the re-sync law). Apply and replay are the same code path — a re-syncing
  stranger re-verifies every fold proof from bytes. The Ӿ tripwire extends (Σ spendable + Σ lane ==
  burned) and the lane root folds into the cascade LAST, only at/after activation (A3). PROVEN tier-1:
  `tk-fold-consensus.test.ts` 25/25 (the real 356-byte Groth16 artifact lands in-reducer ~235 ms; every
  wall attacked; byte-identical replay) and `tk-fold-swarm.test.ts` 13/13 LIVE over HTTP (disposable
  regtest node, `KRAY_LAB_TK_FOLD_SEQ` lab door; reboot re-verifies the proof to the identical root).
  Full suite green — no existing journal moves a byte. Named residue: the folder daemon is operational
  tooling for Gate 3, not consensus.

- **THE TK-FOLD — Gate 2 bridge: the fold proof verifies in PURE NODE (2026-08-23).**
  The validator-burden law is now a running artifact, not a promise. `apps/kray-fold/verifier-wasm/`
  wraps the vetted `sp1-verifier` crate (Groth16 over bn254) in wasm-bindgen; `wasm-pack` emits a
  pure JS + 255 KB WASM package, vendored in-repo — a validator needs NO Rust, NO Go, NO Docker.
  The bench gained `--save`, and the REAL 356-byte Groth16 fold proof of golden vector V2 is
  committed at `apps/kray-fold/proofs/fold-groth16-v2.json` (proof + public values + vkey hash).
  `node apps/kray-fold/wasm-verify.mjs` verifies it in ~262 ms cold / ~55 ms warm, decodes the
  committed public outputs (preRoot, postRoot, diffsHash, laneTotal, applied/refused/deferred), and
  proves fail-closed behavior live: one flipped proof byte → refused; a valid proof under an alien
  vkey hash (the WRONG program) → refused. End-to-end chain now real: TS spec → golden vectors →
  Rust twin → SP1 guest → Groth16 wrap → Node verifier any stranger can run. Remaining for Gate 2
  proper: the dormant journal kinds behind `TK_FOLD_ACTIVATION_SEQ`, wired to this verifier in the
  reducer on apply AND on replay.

- **THE TK-FOLD — Gate 1b closed: canonical-decimal law + the Groth16 wrap is real (2026-08-23).**
  The two Gate-2 blockers fell the same night. THE CANONICAL-DECIMAL LAW: the TS door now admits an
  amount only as the exact string `BigInt.toString` emits (no hex, no whitespace, no sign, no
  leading zeros) within u128, and a nonce only as a canonical non-negative safe integer — the Rust
  twin gains the same 2^53 nonce ceiling, so the two implementations give ONE verdict on every
  conceivable act (TF-11: 12 hostile encodings refused at admission, root unmoved; golden vectors
  byte-identical — no drift; full suite green). And the constant-size proof exists: with Go on the
  forge, the bench's `--features wrap --groth16` wrapped the V4-lineage fold proof of V2 into a
  Groth16 proof over bn254 (~12.7 min first run including circuit-artifact download) and verified
  it in ~152 ms — the exact artifact the npm-shippable WASM verifier will check inside the Node
  reducer at Gate 2. Also proven meanwhile: the bot vector V4 (100 sends, 227M cycles) as a real
  compressed fold proof in ~17.5 min, verified in ~30 ms. Remaining for Gate 2: the pinned WASM
  verifier dependency in the reducer, then the dormant journal kinds behind `TK_FOLD_ACTIVATION_SEQ`.

- **THE TK-FOLD — Gate 1b: the forge is lit — the first REAL fold proofs (2026-08-23).**
  Creator-authorized toolchain install on the dev Mac only (rustup + sp1up + protoc — the
  validator-burden law stands: a validator installs nothing). `apps/kray-fold/` is the SECOND
  implementation of the executable spec: `lib/` the Rust twin of `tk-fold.ts` (sha2, k256 BIP-340
  schnorr over SHA256(utf8(msg)), bech32m taproot address binding, the orderWindow port — vetted
  crates only), `program/` the SP1 zkVM guest, `script/` the bench. Results: **all six golden
  vectors reproduced byte-for-byte by the guest on the first crossing** (V1 13.9M cycles, V2 4.7M,
  V3 10.2M, V4 the-bot 227M, V5 0.14M, V6 2.3M) — two independent implementations of admission,
  ordering, application, diffs and roots now agree on every field of every vector. Then a **REAL
  fold proof** (SP1 compressed STARK) of V2 was generated in ~45 s and **verified in ~29 ms** —
  the prove/verify asymmetry (~1,500×) that the validator-burden law is built on, demonstrated
  live; the proof's public outputs matched the frozen vector. Honest remainder gating Gate 2,
  recorded in `docs/TK-FOLD-DESIGN.md`: the Groth16/Plonk wrap + npm-shippable WASM verifier
  (needs Go/Docker; `native-gnark` deliberately OFF), and the canonical-decimal hardening of the
  TS door so the twins are total-equal, not just vector-equal. The lane still touches no live path.

- **THE TK-FOLD — Gate 1a: the golden vectors (2026-08-23).** The bridge every second
  implementation must cross: `apps/kray-core/src/test/vectors/tk-fold.golden.json` freezes six
  scenarios with REAL schnorr signatures over the lane's own domain and the byte-exact outputs the
  spec produces (preRoot, postRoot, diffsHash, sorted diffs, applied/refused/deferred) — a plain
  breath, same-nonce rivals, every refusal law, the Creator's bot (100 sends between 2 addresses →
  exactly 2 balance diff lines), the empty breath, and the cross-domain replay. Guarded in the suite
  by `tk-fold-vectors.test.ts` (10 checks): any drift in ordering, hashing, refusal law or diff
  shape breaks a vector loudly. The Gate 1 exit criterion is the SP1 zkVM guest reproducing every
  field of every vector byte-for-byte. Honest machine note recorded in `docs/TK-FOLD-DESIGN.md`:
  the dev Mac has no Rust toolchain and no Docker, so Gate 1b (real fold proofs on the bench)
  requires an operator install of `rustup` + `sp1up` (+ Docker for the Groth16/Plonk wrap) first —
  recorded, not skipped, and the lane still touches no live path.

- **THE TK-FOLD — design ratified + the lane's mathematics proven in bytes (Gate 0, 2026-08-23).**
  Stage 2 of the feeless-Ӿ resonance: the compressed lane whose engine the Creator named the TK-fold
  (TK = Total Knowledge, signed Tom Kray — KRAY hides nothing, so "zero-knowledge" was always the
  wrong word; and *fold* is the codebase's own verb). Per breath (epoch), the journal will carry ONE
  fold proof + the fold diffs (touched address → new balance/nonce) — bytes scale per touched
  address, never per transfer, and a re-syncing node rebuilds every balance from the diffs alone
  (the Creator's re-sync law; validium stays refused). `docs/TK-FOLD-DESIGN.md` records the council's
  anatomy (lane entry/exit as journal acts, conservation as a public input, the folder as a role
  never a trust, the journal lane as the eternal escape hatch, Fireborn as the sybil wall), the
  public-input binding (network | breathIndex | preLaneRoot | postLaneRoot | diffsHash | laneTotal),
  the adversary sweep (folder equivocation, diff withholding/forgery, cross-lane double-spend,
  proof replay, sybil diff bloat), the grounded proving-stack decision (SP1 zkVM guest implementing
  the same spec; `sp1-verifier` via WASM in the Node reducer; Citrea proves the family live on
  Bitcoin mainnet), and the honest gates — the lane can NEVER activate before real fold proofs
  verify in the reducer (a mock is not a proof). Gate 0 shipped now: `tk-fold.ts`, the executable
  specification every prover/verifier must equal — the lane's own injective signed domain, admission
  by real signature verification, the `orderWindow` schedule (the Same-Instant theorem, lane
  edition), validate-then-mutate application, diffs, roots, conservation tripwire — proven by
  breaking in `tk-fold-spec.test.ts` (20 checks): 20 arrival permutations → one truth; diffs alone
  rebuild the exact state; forged signature excluded; same-nonce rivals collapse to one; forged AND
  withheld diffs refused by the root; journal x-send signatures die at the lane door; and the
  Creator's bot — 3,000 sends between 2 addresses — folds to exactly 2 balance diff lines per
  breath. Wired into no live path yet, exactly like `window-order.ts` before the Same-Instant Law.

- **THE FIREBORN LAW (stage 1) — ratified and built (2026-08-23): burn once, move forever (within
  the tank).** The novel economic primitive baptized after a six-round council + prior-art audit
  (docs/X-FEELESS-DECISION.md; the money's name stays open — X / Fenix / NiX, the people choose):
  every ₭ burned that mints Ӿ ALSO mints a finite, non-regenerating lifetime allowance of feeless
  x-sends to the burner (`FIREBORN_SENDS_PER_KRAY` = 1,000 per ₭, accrued retroactively from every
  burn since genesis — the fire always paid). At/after `X_FEELESS_ACTIVATION_SEQ` the ledger
  PRESCRIBES the x-send fee — never a choice, so a writer can flip nothing (the signed domain
  carries no fee): 0 iff the tank has allowance AND the 3.5-second gap law holds (`FIREBORN_GAP_MS`
  = one free send per address per fast-block cadence; bursts pay the eternal 1 ₭; a timeless or
  backwards `at` pays too), else exactly 1 ₭. A feeless act moves Ӿ with ZERO ₭ anywhere — a
  pure-Ӿ wallet pays nothing, the treasury gains nothing, total journal bytes stay bounded by
  capital destroyed (Σ feeless ≤ F × ₭ burned — the 3.5-second-bot refutation answered by fire).
  The tank book (`fireRoot`: tanks + gap clocks + lifetime spend) folds into the cascade root ONLY
  at/after activation (A3: absent below ⇒ byte-identical history) and a new tripwire holds
  `Σ tanks + spent == F × burned` on every apply. The door quotes the prescribed fee at the last
  moment inside the gate flush and exposes `lights.fireTank` on profiles. Activation: signet pinned
  245 (live tip 209 at design); mainnet born active (0); regtest dormant for golden replays with
  the `KRAY_LAB_FIREBORN_SEQ` + `KRAY_LAB_X_SEQ` lab doors (KRAY_TRUSTED_DEV doctrine). Proven by
  the Creator's chronology, regtest first: 25 unit checks (`fireborn-law.test.ts` — dormancy A3,
  retroactive accrual, the pure-Ӿ feeless path, fee-flipping refused BOTH directions, the gap law
  at ±1 ms, time travel pays, the 1,005-round bot bounded exactly by its fire, conservation, root
  fold + byte-exact replay, additive accumulation) and the live HTTP swarm (`fireborn-swarm.test.ts`
  — 12 wallets burn + volley feeless concurrently with treasury unchanged, the rapid-fire bot pays
  1 ₭ per burst, the journal's fee fields re-derive the treasury delta, byte-identical root on
  reboot). Full core suite green. Dormant replay proof vs the LIVE signet journal: byte-identical
  root at seq 209; the active-from-1 adversary HALTs at seq 157 on the prescription — the law has
  teeth, which is exactly why activation is pinned in the future. The Nix lane (Road 1a validity-
  proof compression) remains the ratified destination for a later stage. **CROSSED LIVE on Signet
  (2026-08-24)**: fleet-first deploy (3/3 guardians, then the writer, head byte-identical below the
  pin), then the crossing rite walked the tip to 244 and crossed — burn at seq 245 (tank retroactive
  101,000 → 103,000), feeless send at 246 (treasury untouched), the burst PAID 1 ₭ at 247, free again
  at 248; journal fees `[0,1,0]`; local replay AND all three guardians reached the writer's exact
  root `8d511231e4c4de84…` at seq 248.

- **THE SAME-INSTANT LAW — ratified and built (2026-08-23): within one millisecond, not even the
  writer chooses.** User acts stamped into the same `at` must stand in the journal in the one order
  arithmetic derives — `orderWindow` (ADR-3 3c) over `sha256(signed bytes)`, the ungrindable key — or
  the act is refused BEFORE any mutation at the live door and a lying journal HALTs every follower on
  replay (one code path, both teeth: `ledger.ts` `assertSameInstantOrder`, checked inside `requireSig`).
  Three additive parts: (1) the MIRROR + the REFEREE — `signed-message.ts` `signedBytesOfEvent` is the
  one pure source of every act's signed bytes, and `requireSig` now asserts its inline message equals
  the mirror on EVERY apply and EVERY replay (parity re-proven continuously, fail-closed); (2) the law
  in the reducer, activation-gated per network (`SAME_INSTANT_ORDER_ACTIVATION_SEQ` — Signet pinned at
  175 by the deploy rite with the live tip at 166; mainnet born activated at 0; regtest dormant for
  golden replays, with the regtest-only `KRAY_LAB_SAME_INSTANT_SEQ` lab door under the KRAY_TRUSTED_DEV
  doctrine); (3) the SAME-INSTANT GATE at the door (`server.mjs`) — concurrent submits collect for one
  tick, share ONE strictly-monotonic millisecond, pass signature admission (a forged act never occupies
  a rival's nonce slot), and apply in the orderWindow schedule; the star delta moved inside the
  synchronous apply so gate siblings can never cross-report a birth. Proven by the Creator's chronology,
  regtest first: 17 unit checks (`same-instant-order.test.ts` — dormancy A3, the timestamp law, wrong
  order refused, nonce-over-key inside one account, the pairwise insertion trick HALTing under
  greedy-equality, unsigned run-breaks, the boundary, a forged journal HALTing a follower, byte-exact
  replay), the 24×6 live HTTP swarm (`same-instant-swarm.test.ts` — two dozen citizens per millisecond
  across six permuted arrival orders: zero refusals, every run in the schedule, byte-identical reboot
  under the active law), the full suite green with the referee live inside every signed act, and the
  disposable-node dormant replay of the live Signet journal — byte-identical root at the 175 pin.
  Decision brief with the council, the adversary's refutations, and the discarded branches (whole-seal
  ordering, policy-only, retry-and-bump, pairwise checking): `docs/SAME-INSTANT-ORDER-DECISION.md`.

- **THE ATLAS FEE — branch A ratified and built (2026-08-23): the wall-toll beside the fire.** From the
  per-network activation seq (`ATLAS_FEE_ACTIVATION_SEQ` — Signet pinned at 165 by the deploy-race rite
  with the live tip at 157; mainnet born activated at 0; regtest dormant for golden replays), every sized
  inscribe/origin pays — beside the untouched SIZE-BURN (full deflation stays word-for-word as ratified) —
  an equal-law fee `max(1, ceil(size / bytesPerKrayNow))` credited to TREASURY, so the validators who hold
  the atlas are funded by the bytes they carry, not only by act count. Payer-funded and conserved (the
  tripwire never moves), linear therefore split/merge-neutral, one breathing rate for both components, and
  zero-byte acts (names, laws, empty stars) pay no toll. The door quotes `atlasFee` in every prepare answer
  (`Ledger.atlasFeeOf`), `donation/info` announces `atlasFeeActive`, and the inscribe page paints
  "burns N ₭ + N ₭ atlas" the moment the law wakes — frontend and reducer can never disagree on the price.
  Proven by breaking (`atlas-fee.test.ts`, 21 checks: dormant default, activation boundary, size pricing,
  split neutrality, conservation, whole-act refusal, zero-byte exemption, replay, root gating) and by the
  disposable-node rite: the live 157-event Signet journal replays byte-identical under the pinned constant,
  while a retroactive activation HALTs — the gate is real. CROSSED LIVE the same day: a 65-byte inscribe
  landed exactly at seq 165 (burn 1 ₭ + atlas 1 ₭, quoted by the door before the act), TREASURY grew by
  exactly 1 ₭ re-derived from the journal, and writer + all three guardians serve the same post-crossing
  root at the same seq. Design record: `docs/ATLAS-FEE-DECISION.md`.

- **THE PEN OPENS — ADR-3 Article XIV ratified for Signet (2026-08-23): H = seq 155, the live-chain
  upgrade test.** From seal seq 155 the writer must fold, into the Bitcoin-anchored cascade root, the
  cumulative included-act root, the per-seal window commitment, and the nonce map — silent omission of a
  citizen's act becomes as evident on replay as forging: a citizen who anchored their act and signed an
  opt-in deadline can hand any stranger a CENSORED verdict (or an honest not-censored reason) checkable
  from Bitcoin bytes alone. Pinned by the deploy-race rite (tip stood at 149; the disposable-follower
  replay of the live journal under the new law re-derived the head root byte-exact — A3, nothing anchored
  is orphaned). Anchoring shape verified keyless (NUMS internal key), so every activated seal height is
  trustlessly re-provable. The verdict is EVIDENCE, never automation (the brief's minimal safe choice).
  Mainnet constants set born-activated (0). Regtest stays MAX (live lab journals; exams inject their own).
- **Ӿ TRANSFERS LIVE — slice 2 ratified for Signet at the same seq 155 (2026-08-23).** `x-send` moves the
  transferable token born from burned ₭ by its own signed domain (`xSendMessage`), pays the eternal 1-₭
  fee to the validators, and folds its book into the cascade root. The door now speaks it end to end:
  `x-send` joined the node's USER_KINDS, `/api/kraynet/prepare` + `/submit` build and accept it (AMM/
  contract pots refused at the door), profiles expose `xSpendable` beside the engraved lifetime `x`, and
  the act-flow river files it under money. Below 155 every anchored root re-derives byte-identically;
  ledger law was already pinned by `x-transfer.test.ts` (dormant + active sides both exercised).
- **Pot custody rung 5: per-recipient settlement routing — the exit LOAF (2026-08-23, proven).** One pot
  ceremony now pays EVERY compatible open exit of a rune at once, each recipient on its OWN output,
  straight to the address their rune-exit SIGNED — the pot sheds circulating value to self-custody at N×
  the rate, and not one bit of who-may-take-what changed: the pot-signer and every remote guardian
  already bound each dest to its holder-signed exit (the writer cannot invent a rider). New consensus
  law, ONE DELIVERY ONE BURN: a loaf settle carries its delivery outpoint (`outpoint: l1Txid:vout` on
  `rune-settle`) and the `RuneBook` keys the dedup on it — append-only, byte-identical for every historic
  settle, replay refused in both directions. The door (flag `KRAY_EXIT_LOAF=1`, default OFF) assembles
  riders oldest-signed-first under the 83-byte runestone cap, refuses duplicate dest scripts (per-output
  settles must never be ambiguous), enforces the initiator-no-worse sats law (riders ride the pot's own
  sats surplus, never the initiator's pocket), and ARMS every member (`rune-lodge`) before a single byte
  broadcasts. Guardian daemon claim fixed to spendable + locked (a synced book would falsely refuse an
  honest full-balance withdraw — the two-phase law puts the credits in the LOCK). Proven by breaking:
  `exit-loaf.test.ts` 13/13, pinned; loaf authorization/builder were already pinned
  (`pot-signer.test.ts`, `exit-payout.test.ts`). **Deploy order absolute (consensus change): fleet +
  writer code first, only then the flag** — a pre-rung-5 follower HALTs on the second burn of one txid.
- **Pot custody rung 3: the monotonic guardian head — writer equivocation dies at the co-sign door
  (2026-08-23, proven).** A guardian daemon now persists the head of its OWN book against which it last
  co-signed (`guardian-head.json` — `{seq, root, anchoredRoot}`, atomic) and refuses to co-sign against any
  history that no longer passes through that root — membership in the mirror's re-derived prefix roots IS
  descendance, so a rewrite, a fork, or an old genuine history re-served (equivocation) is a **403 that
  never auto-clears** (the operator's conscious rite resets it). The anchored root only RATCHETS deeper
  (A3 at the co-sign door). LAG ≠ THEFT preserved: a book that cannot answer is a 503 liveness fault, never
  a silent sign, never a false hold. Ships: `GET /api/kraynet/lineage/{root}` on the mirror
  (`kray-follow --serve` — one verified snapshot, one atomic answer, from the §3 prefix-root replay it
  already performs), the gate + anti-TOCTOU confirm in `guardian-signer.mjs`; the writer needed **zero
  changes**. Proven by breaking: `guardian-monotonic-head.test.ts` 17/17, rung-2 regression 6/6, both
  exams pinned in the deterministic suite. Honest residues named in `docs/POT-CUSTODY.md` § rung 3
  (local-disk memory = same blast radius as the guardian key; a legitimate un-anchored-tail succession
  reads as equivocation and holds for the operator; no cross-guardian head comparison yet).
- **Pot custody: the book-checking guardian federation — LIVE on Signet (2026-08-22).** Every pot
  withdraw now requires the owner **plus** a 2-of-3 quorum of remote guardian co-signers, each grounding
  its verdict in its **own mirror's independent replay** (`authorizeGuardianSign` re-checks the exiter's
  balance against the guardian's book; a compromised writer can no longer over-drain). Fault-tolerant
  quorum (`decideGuardianQuorum`): an unreachable guardian is tolerated up to the threshold; a book-NO
  **holds** the withdraw — safety is never routed around; the depositor's CSV leaf keeps funds
  unfreezable. Ships: `scripts/operator/guardian-signer.mjs` (loopback-only, token-gated, boxed-key
  support), dormant writer wiring behind `KRAY_GUARDIAN_SIGNER_URLS` (default OFF ⇒ byte-identical),
  and the Tier-1 ceremony e2e (`guardian-golive-tier1-e2e.mjs`, 20/20 by breaking: remote co-sign ·
  one-dead tolerated · two-dead held with the lock surviving · stale-book held-for-safety · recovery
  without loss). Flip verified live: the cascade root replayed byte-identical through the new code.
- **The follower now serves the guardian's book.** `kray-follow --serve` answers
  `/api/kraynet/runes/of/<addr>` from the mirror's **own replayed ledger** (never proxied) — root
  parity, book parity, and refuse-via-mirror proven (guardian-over-follower exam).
- **Pot transparency, read-only.** `/api/kraynet/pot-book` (who the shared pot backs, and by how much —
  a pure derived view) and `/api/kraynet/pot-settlement` (the pot's pre-signed split, ASSEMBLED but
  never signed: pays every pot-backed holder exactly their book, proven safe by ord's own decoder —
  the inspection surface for the sweep-defeating reflex).
- **PSBT safety, fail-closed everywhere.** Every node funding path (donate · BTC send · rune-send fee ·
  exit · rehome · anchor ×2) now passes the same `cardinalOnly` gate: if ord cannot CONFIRM an output
  is pure BTC, it is protected and never spent — no inscription or rune can be burned as a fee.
- **Run-a-node: the custody-mirror question.** `docs/RUN-NODE.md` § Q2b asks every follower whether
  their mirror should also serve the rune book (always-on, anonymous, no key — the qualification for
  mainnet guardian operators), and `preflight --role custody` confronts the machine for it (Node 24+,
  serving mirror, book route, Bitcoin Core as gold).
- Run-a-node door for any clone / any LLM. `docs/RUN-NODE.md` is now the
  first stop: interactive quiz (Signet · mainnet · lab × follow · guardian ·
  browser · local writer), then `scripts/follow/preflight.mjs` confronts
  **this** machine and teaches the choice in plain words — what it means,
  what is already here, what that role still needs, what it does **not**
  need (vault, being the writer). README, AGENTS, and `.cursor/skills/kraynet-run`
  refuse the “boot `server.mjs` / ask for a vault” trap. Full node = follow.
  Quiz Q4 + `docs/RUN-NODE.md` § “How fees work”: 1 ₭ acts → pool → linear
  split on the Bitcoin seal → credit on the wallet address (1× light, 3×
  atlas); follow alone does not pay; demo miner key is not their wallet.
  Follow inventory is explicit: journal + atlas (`/content/<sha256>`) are the
  only downloads; protocol vaults replay from the journal; pot keys and SQL
  are refused. Quiz teaches atlas ≠ pot vault.
  Guardians may earn from any device (phone, PC, Pi, always-on box); many
  watches, one wallet merges. Honest split: presence is a crowd; the pen
  is still one writer.
  Follow bible is two beats: journal+atlas first, then optional Signet
  Bitcoin Core (`--proofs bitcoin`) so seals re-prove on this machine.
  Preflight pings bitcoind, refuses a mixed chain, never blocks first boot.
  Quiz Q5 + “How this node stays current”: no auto-update (house law).
  Follower = `git pull` + restart or `/validate` button; writer = rsync
  ritual. `--from-chunks` / `--peers` documented; ADR-3 called dormant
  when it is.
  Stranger-clone door: root `CLAUDE.md` points any Claude/Cursor at
  AGENTS + RUN-NODE so a fresh machine can say “run the node” and hit
  the quiz without hunting.
  Honest 3×: wallet /validate mining is 1× (no custody on the beat).
  Follow `content/` does not pay. `guardian.mjs` + `KRAY_MINER_SK` +
  atlas dir is the live 3× door. The factor 3 is a launch placeholder.
- Data availability (ADR-2 · slice 2a — content-addressed journal chunks, PRIMITIVE ONLY). The honest
  prerequisite for real decentralization liveness (ADR-3 3e leans on it). `apps/kray-core/src/protocol/
  journal-chunks.ts` cuts the journal into content-addressed chunks, each self-verifying against the
  Bitcoin-anchored head, so the journal can be fetched in pieces from UNTRUSTED peers and reassembled —
  "if every official server vanishes, the data + rules + Bitcoin still rebuild the truth" (Article XII).
  The chunk chain reuses the store's own GENESIS_HASH/sha256hex/canonical AND its strictly-incrementing
  seq guard, so a chunk that verifies is a byte-authentic span; `verifyManifest` refuses a dropped,
  reordered, tampered, seq-broken, or forged-head chunk, and the exam replays the reassembled chunks to
  the IDENTICAL cascade root. Wired into NO live path. An adversarial council found no forgery but three
  honest overclaims, each fixed and pinned (`journal-chunks.test.ts`, 19/19): the missing seq-monotonicity
  gate is now enforced (parity with store.ts, a seq=[1,1,1] span refused); the docs no longer claim
  isolated-chunk authenticity (it lives in the head binding — proven by a self-consistent forged chunk
  that passes alone but the manifest against the true head refuses); and "tampered byte breaks both" is
  narrowed to a field VALUE. Honest scope in docs/FRONTIER-ADRS.md § "2a status": head provenance +
  event validity + 2b/2c/2d still sit on top.
- Data availability (ADR-2 · 2a WIRED, read-only). Every node now serves its journal in
  content-addressed pieces: `GET /api/kraynet/chunks` (the manifest — boundaries + addresses) and
  `GET /api/kraynet/chunk/:address` (the raw lines), on the writer AND on the follower's `--serve`
  mirror. So a fresh follower can reconstruct the history from ANY peer (not only the writer),
  fetching each chunk by content address, re-hashing it, and verifying it against the anchored head —
  a lying chunk server is caught at the door. Additive and read-only; no consensus change (the manifest
  is `verifyManifest`'s to check, never a verdict the node returns). Canonical `DEFAULT_CHUNK_SIZE=128`
  so every honest node cuts the same chunks. Public nodes flood-gate both endpoints (the manifest
  rebuilds per call — a cache is a later optimization). Proven on the lab bench: a stranger with only
  HTTP reconstructs a live node's journal piece-by-piece, byte-identical, and refuses a tampered chunk
  (workshop `chunk-availability-exam`, 8/8).
- Decentralizing the pen (ADR-3 · slice 3e — the pen as a race, PRIMITIVE ONLY). The final primitive
  of the arc. `apps/kray-core/src/protocol/succession.ts` invents no consensus — it composes the LIVE
  fork choice (`chooseCanonical`) with the proven window rules. Three pieces: the silence clock
  (succession opens after N Bitcoin blocks of writer silence — a tunable parameter), the
  successor-window check (re-derives 3c order → 3a root → 3d commitment and refuses a tampered set, a
  smuggled invalid act, or a fabricated commitment), and the N-claimant reduce (`canonicalHead`,
  order-invariant, the deeper Bitcoin anchor wins). Wired into NO live path. An adversarial council
  found no wrong result but named three items, each now fixed and pinned (`succession.test.ts`, 16/16):
  the exam's `canonicalHead` case now uses REAL SPV-proven anchors of differing depth (the first draft
  used only proofless heads, so the Bitcoin-work tiers it headlined were untested); `canonicalHead`
  now fails closed (null) on a mixed-network list instead of an uncaught throw; and the silence clock's
  contract now binds BOTH heights to the successor's own SPV-verified view (an inflated
  `lastAnchoredBtcHeight` would otherwise freeze succession shut). Honest scope in
  `docs/FRONTIER-ADRS.md` § "3e status": what live succession still needs (prev-root binding, the
  shared nonce snapshot, data availability, liveness under adversarial silence). With this, all five
  ADR-3 primitives (3a inclusion, 3b inbox, 3c ordering, 3d censorship, 3e succession) are built,
  adversarially hardened, and proven on the bench — none wired to the live writer (A3 intact).
- Decentralizing the pen (ADR-3 · slice 3d — censorship becomes proof, PRIMITIVE ONLY).
  `apps/kray-core/src/protocol/censorship-evidence.ts` composes the three proven primitives into one
  checkable verdict: `verifyCensorship` returns CENSORED only when a valid, signed-deadline,
  publicly-available act is absent (3a non-membership) from the cumulative anchored window at/after
  its deadline, with the inclusion root re-derived from the seal (a fabricated root is refused);
  every innocent or fabricated case is refused with a named reason. Wired into NO live path (writer,
  cascade root, anchor unchanged). An adversarial council found no wrong verdict but named two
  false-positive vectors a loose live wiring would open — each now closed in the contract and pinned
  by an exam case (`apps/kray-core/src/test/censorship-evidence.test.ts`, 11/11): (1) `seal ≥ deadline`
  is sound only under a CUMULATIVE inclusion root — now a documented obligation, proven by an on-time
  act staying present in every later root; (2) the deadline MUST be read from the SIGNED bytes — now
  `deadlineOf`'s contract mirrors `keyOf`'s, proven by a stamped-deadline breaking the signature. The
  absolute "no false CENSORED without a SHA-256 break" claim was softened to its honest contingent
  form. Honest scope in `docs/FRONTIER-ADRS.md` § "3d status": what live wiring still needs (fold the
  window commitment into the cascade/anchor; a trustless availability witness; proof compaction).
- Decentralizing the pen (ADR-3 · slice 3a — the inclusion accumulator, PRIMITIVE ONLY).
  `apps/kray-core/src/protocol/inclusion-tree.ts` is a Sparse Merkle Tree over each act's 3c
  signed-message key: one order-independent root commits to WHICH acts a window contains and yields
  BOTH a membership proof and a non-membership (proof-of-absence) proof a stranger verifies against
  the root alone — the missing set-commitment that turns censorship into evidence (slice 3d). The
  cascade root today commits to STATE, not the act SET, so it cannot prove absence; this can. Wired
  into NO live path (cascade root and writer unchanged). An adversarial council found no soundness or
  implementation defect in the primitive, but caught the first exam OVERCLAIMING: its "second-preimage"
  block only exercised leaf-identity binding, so the suite stayed green even with the domain tags
  removed. Fixed (test only): the tags are exported and the exam now regresses if they are equalised,
  the leaf/node hashes of one payload are asserted distinct, and the block is retitled honestly;
  `verifyProof` hardened to require a strict boolean `present`. Exam 22/22. Honest scope in
  `docs/FRONTIER-ADRS.md` § "3a status": proven vs what 3d still needs (bind the root into the anchor,
  a deadline clock, and the 3c admission link).
- Decentralizing the pen (ADR-3 · slice 3c — the deterministic window, PRIMITIVE ONLY).
  `apps/kray-core/src/protocol/window-order.ts` is a pure ordering rule: two independent writers
  holding the same set of validly-signed acts derive the byte-identical journal and cascade root
  ("order is arithmetic, not a writer's choice"). It is wired into NO live path — it is the proven
  primitive the succession rule (3e) will stand on; the single writer is unchanged. An adversarial
  council found four real defects in the first draft, each now fixed and pinned by an exam that
  fails without the fix (`apps/kray-core/src/test/window-order.test.ts`, 18/18): (1) the written
  rule and the code were different functions — reconciled to one canonical greedy (min-heap) and
  cross-checked against an independent reference implementation; (2) the order key hashed the
  malleable signature and unsigned envelope, so it was grindable — now it hashes the SIGNED MESSAGE
  only (`keyFromSignedMessage`), ungrindable; (3) the scheduler advanced a nonce without verifying
  the signature, letting a forged act permanently, invisibly censor an account — now admission
  verifies the signature FIRST (`isValid` required), proven by a forged-act attack; (4) an O(n²)
  sweep became O(n log n). Honest scope in `docs/FRONTIER-ADRS.md` § "3c status": what is proven vs
  what a live multi-kind window still needs (door admission for all kinds, the window boundary,
  activation-height wiring, and 3e fork-choice for competing sets).
- Decentralizing the pen (ADR-3 · slice 3b — the public inbox). A signed act
  survives the single writer's outage: `apps/kray-net/inbox.mjs` is a mailbox
  of already-signed acts (`POST /api/kraynet/inbox` on the writer AND on the
  follower mirror). It applies nothing — every act drains through the ONE door
  (`/api/kraynet/submit`), so signature/nonce/conservation are re-checked
  identically; the account nonce makes a duplicate drain idempotent. The writer
  drains on boot (the outage's end) and every 60 s; a mirror holds a citizen's
  act while the writer is dead and relays it on return. Proven on the lab bench
  with two SIGKILLs of the writer (workshop `inbox-exam`, 29/29). An adversarial
  council then hardened it: no per-address quota (keyed on an unauthenticated
  `from`, it was a censorship lever — global count/byte caps + per-IP rate limit
  are the real spam floor); terminal receipts (`applied`/`refused`/`superseded`)
  are reclaimed on a retention TTL so junk cannot fill the disk the journal
  shares; an in-memory pending index keeps status/accept O(1) and the public GET
  is flood-gated; a crash between the door's fsync and the receipt now records
  `superseded` (nonce already advanced), never a false `refused`. No Supreme-Law
  path changed — value still moves only by signature ‖ Merkle proof ‖ anchor.
  Slice 0 (read mirror, honestly stale) was already built; slices 3a/3c/3d/3e
  (deterministic window, inclusion evidence, succession-by-anchor) stay
  protocol-before-software in `docs/FRONTIER-ADRS.md`. `KRAY_INBOX=0` disables it.
- Test: `reducer-guards` N9 accepts the earlier protocol-pot refusal message
  (a pre-existing AMM-era guard fires before the signature guard; both fail
  closed before any mutation — the assertion was too narrow, not the code).
- Official door: README redesigned around the protocol symbol **₭**. Operator
  guide and the doc index no longer describe a v1-alongside-v2 node, a
  localhost-only wallet, or leftover lab datadir names. Public clone is
  [`tomkray/kray-network`](https://github.com/tomkray/kray-network) on
  **`main`** (the repository is public). Mainnet is not ignited.
- Official default branch is `main`. Operator guide is `docs/KRAYNET-RUN.md`.
  `npm run test:core` is the storm suite.
- Folder law (`docs/FOLDER-LAW.md`): names are locked now, not "while Signet
  is live." Signet may pause for a last rename. Mainnet ignited freezes the
  tree. Mainnet genesis is empty `data-main/` — zero km, no Signet copy.
- Public e2e boot comments name `apps/kray-net/server.mjs`, not the workshop
  `testnode` shim. Workshop scripts stay on the working tree.
- Official zip skips `archive/` (the official worktree extract must never
  land in `/validate`).
- `/docs` longer recipe: cwd-correct, `KRAY_NET` (never the unread
  `KRAY_ANCHOR_NET`), public Signet is follow-not-fork. Provisioner print
  matches.
- Official public tree is the validator door only: `follow` · `guardian` ·
  pot-signer · hermetic proofs. Workshop (`scripts/exam/`, `scripts/lab/`,
  gauntlet/testnode/devnet shims, this-operator vitrine sync, TRAVEL, HARNESS)
  stays on the working repo and is excluded from `kray-network` and the
  `/validate` zip. Stable doors at `scripts/<name>` remain for follow and
  guardian. Signet and Bitcoin mainnet recipes live in `networks/signet/` and
  `networks/mainnet/`. Boot isolation refuses a mixed universe.
- Explorer chrome is `index.html`, `kray.js`, `kray.css`. Era URLs
  (`/v2.html`, `/kray-v2.js`, `/kray-v2.css`) stay as writer aliases.
  The official zip skips leftover era filenames.
- Folder names: lab journal is `data-lab/` (era `data-v2/` still read if it
  already holds a bench). Unset `KRAY_DATA` defaults to `data-signet` /
  `data-main` / `data-lab`. Docs shelf is grouped Law / Run / Design / History;
  files stay at `docs/` root so citations do not 404.

## [v2.0.0-alpha] — 2026-08-13

The v2 era, on the `kraynet-v2` branch since it diverged from `main`
(`caeadee`): KRAY as fungible fuel (hard mint + burn, no cap), stars born from
fire, donations that ARE the anchor, guardians paid for proven presence and
custody, a trustless rune bridge at both ends, and a quantum-safe account
layer. Each bullet is a commit subject, kept verbatim.

### Added

- Be a guardian in ONE command: measure the machine, prime the atlas, mine (`7f68fa6`)
- One local endpoint, three worlds: the gateway proxies mainnet to production (`da6bc27`)
- One launcher, three networks: the gateway pointed at each chain's OWN live stack (`0f283fc`)
- One click to every distribution: /validate lists each settlement, each row opens its table (`e8c0469`)
- The settlement page shows WHO guarded and WHO earned — the reducer's exact table (`2eca86c`)
- The swarm exam joins the v2 era: minted by Bitcoin, stormed, attacked, verified by strangers (`45f52e9`)
- Runes L2 explorer — a populate+exam that proves the page data is perfect (`92dbcd1`)
- The Runes L2 explorer — every rune's vault, holders and story, solvency proven live (`b852655`)
- Vault provisioning + per-network ord — the deposit flow a wallet can actually drive (`003ea09`)
- Consolidation registry — the shared pool enters the watcher's eye automatically (`bb3b6c4`)
- Prove divisibility-agnostic accounting on a real divisible rune (`1d03b11`)
- Slice 4 · reconciliation — the forced exit settles the book in lockstep with L1 (`893d29c`)
- Slice 3 · multi-hop withdrawal — a recipient who never deposited gets their runes home (`f82a89b`)
- Slice 1 · the vault watcher — the eye on the bridge's honest residue (`cd25d4c`)
- Rune send — the L2 transfer leg proven (deposit + send + exit now all covered) (`171888d`)
- Batch inscribe — mint a whole collection in one flow (pure convenience, per-item signed + fee-paid) (`2630221`)
- The Stress Exam — randomized adversarial max-pressure fuzzer, 14/14 (`5a49dca`)
- The Grand Exam — every action fired and attacked in one live run, 29/29 (`6741b6f`)
- scripts/testnode.mjs — the regtest exam bench, one reproducible command (`9eec6f5`)
- Be a validator from a browser tab — /validate breaks the difficulty paradigm (`38d439a`)
- The network outlives any node — mirror + succession made a permanent proof (`db1a1a1`)
- The antifragility gauntlet — one command re-proves the whole idea, forever (`64b2602`)
- Verify KRAY yourself — three in-browser proofs against independent sources (`42fe561`)
- The audit dossier — the briefing a security firm receives to scope KRAY.NETWORK (`d5847f1`)
- Movement 2, slice 3 — the read-only mirror + provable succession: the network outlives its writer (`9cb86d4`)
- Movement 2, slice 2 — the atlas travels: guardians and followers hold verified content (`da43686`)
- Movement 2, slice 1 — THE SECOND NODE: a follower that re-derives everything and trusts nothing (`10b3bdc`)
- The chaos proof — murder the node mid-storm; the mathematics survives (`545fa82`)
- Validators are paid on EVERY proven seal + the guardian swarm + the mega-storm (`02b15b2`)
- The donation storm — the same millisecond cannot fragment the law (`0e7ac12`)
- The public burn proof — anyone's browser recomputes that the burn address belongs to nobody (`eecfc70`)
- The live node under the unified law — self-anchoring donations, eternal redemption, the guardian pool wired (`48f643e`)
- Phase 3 slice 1 — the donation IS the anchor: keyless burn primitives, proven byte-exact (`441dd3f`)
- Phase 2 slice 5b — custody in consensus: store the atlas, prove it, earn 3× — audited (`8cfcf9c`)
- Phase 2 slice 6 — the guardian miner: prove presence, earn the fees, for real (`41c81e8`)
- Phase 2 slice 5a — custody scales the reward: store the atlas, earn up to 3× (`ae3e5c1`)
- Phase 2 slice 4 — the seal pays proven work: beats become a settlement, not a solo reward (`55527b7`)
- Phase 2 slice 3 — the live beat layer: guardians prove presence, the node collects it (`53ef34d`)
- Phase 2 slice 2 — the settlement event: the ledger pays proven work, trustlessly (`b8dda34`)
- Phase 2 slice 1 — verified beats become a provable reward table (`ccd6a64`)
- The donations pay the anchor, and the guardian earns the fees — self-sustaining (`5886882`)

### Changed

- The stranger's path is now true: devnet handshake honored, docs speak the present (`4c51d99`)
- The front door speaks the present: guardian one-command, v2 law, disclosure (`fb11757`)
- Analytics labels are the operator's private notebook, not source (`2a05f35`)
- Fees are a per-chain market: signet asks its own estimator, every cache key carries the network (`14e0c79`)
- The validator's activity finally says it: ⚖ earned — with the door to the full table (`39d949e`)
- The anchor and the seal carry the door to their distribution (`645ac5b`)
- A seal remembers WHEN: sealConfirmed and settleBeats stamp the real clock (`d4df8b4`)
- The demo deposits ride the 330-sat rule, and every tx wears its action tag (`8c5fb43`)
- The rune's face rides beside its name everywhere — and a name now opens its page (`740dd8d`)
- Every rune name is a door: click it anywhere and land on the rune's page (`40138e5`)
- Rune postage stays the network's DYNAMIC minimum — no hardcoded floor (`ece9a18`)
- Transaction page — runes wear their faces here too (thumbnail, name, own decimals) (`a71a033`)
- Profile · runes wear their faces — thumbnails, names, and per-act stories (`c3a7a82`)
- Profile · the L2 rune card — readable, self-explaining, user-first (`7ea4eed`)
- Docs alignment — the law now matches the code: proof-of-burn, linear split, quantum live (`aedb806`)
- README — current, accurate, and the easy-validator front door (`c183b1d`)
- Project audit — remove dead debug-repro scratch; everything else verified live (`5626710`)
- Docs — §15c "Be a validator from a browser tab": the difficulty paradigm, broken (`b236fff`)
- Repo hygiene — untrack the dead reset-backup data, ignore archive/atlas/gauntlet dirs (`0c971ce`)
- Docs consistency pass — every claim and command matches today's system (`3afea6e`)
- Docs — the official record of what we now are: antifragile, and without an owner (`d186ca0`)
- Dossier — tighten the NUMS claim to what the code proves (numsAuthorlessProof) (`2905936`)
- Docs — trustless custody honesty + the anchoring unification record (2a/2b/2c verified live) (`b4614cc`)
- The economics decision — BURN wins; the raffle is the road not taken, kept for the record (`ba4d1ce`)
- Anchoring unification — the operator retired: cap 10k, self-anchor in fork-choice, guardian backstop, the window beats with Bitcoin (`62fe132`)
- Gold means sealed-on-Bitcoin, through the cascade — not merely at an anchor point (`4515cf2`)

### Fixed

- Auto-resume asks to reconnect exactly ONCE — never a prompt loop (`422b10c`)
- A refresh no longer forgets your Start: remembered consent auto-resumes mining (`5035349`)
- /validate recognizes an address already proving presence elsewhere (`f551e6b`)
- The gateway cache learns which chain it is caching: every key stamped with the network (`a0d9827`)
- The stranger-replay check is honest under concurrency: retry the snapshot (`4649b82`)
- Fix the spilled onerror junk and make face + name ONE door to the rune page (`b0e0a0a`)
- Explorer populate exam reads holderCount — holders is the array the pages consume (`8c04a83`)
- Fix a regression the swarm caught: /api/kraynet/runes holders stayed a COUNT (`acd76f9`)
- Rune explorer endpoint accepts the browser-encoded id (%3A) — fixes the 404 (`92a0bf2`)
- Dashboard + black-hole register — the freeze view renders again (`e41272e`)
- Profile page — wire the three data cards that looked complete but were inert (`26ee947`)
- vault: the header's honest residue caught up with the law it describes (`1b340a6`)
- Landing gets every action; dashboard fixed for the current KRAYNET shape (`4631136`)
- Address balance is indexed, not scanned — "checking…" resolves in ~1s, not 30 (`ea9950c`)
- The mirror shows the network you're on — signet block, signet ordinals, live (`1362ccc`)
- Blocks persist across a restart — no re-collapse, no re-anchor, no receipt block (`bedace7`)
- The pot pays the anchor's REAL fee, not a placeholder — honest books (`346b363`)
- The rank page reads a whole envelope — network, simulation and the holder total (`53bdf1c`)

### Security

- Harden the rune bridge — fix 5 confirmed findings from the adversarial review (`65e095c`)
- rune-exit: refuse an unsettleable L1 destination before it can strand the runes (`d6f36c2`)
- Slice 2 · the settlement reflex — the residue attack fails on its own (`0d94abf`)
- Node robustness — a malformed request URL can no longer crash the node (DoS fix) (`c70f2fa`)
- 100% quantum-safe: ML-DSA (FIPS-204) is a first-class everyday account scheme (`63d9351`)
- The quantum escape hatch — a real hash-based signature rescues an account no quantum computer can steal (`6c52763`)
- Quantum recovery commitments — opt-in, additive, hijack-proof: safer than Bitcoin, by design (`d2c444c`)
- Quantum readiness — the honest two-layer posture, and a proven agility seam (`ba8adf6`)
- The proven deposit — the rune bridge is now trustless at BOTH ends (`49cf160`)
- Value never crosses networks — the ledger refuses a wrong-network recipient or donor (`cc94b7f`)
- The anchor pays a sane fee, and the emission split is linear — sybil-neutral, official (`9e42045`)

## [v1] — 2026-08-08

**Retired era.** The pre-v2 KRAYNET, preserved on `main` (genesis `77cdb11`,
2026-07-24, through `caeadee`, 2026-08-08). Superseded by the v2 model above.

- The numbered-star model: every inscription born as a sequential star ("the star number is born, never chosen"), with citizen profiles, the mosaic, the land map growing from the centre, and the address-as-identity law.
- The emission clock: emission driven by Bitcoin's own block clock and delivered at the seal — settlement and Glow recorded in compact intervals, with a measured 20-year storage model.
- Bitcoin anchors: the cascade root committed on-chain (signet and an honest mainnet mirror), verifiable receipts, and cost-ranked fork choice — "a copied anchor is not a paid one".
- ORIGIN: an L1 Ordinals inscription bound to an L2 star, grown into the collection model where every mint proves current parent ownership, live, both ways.
- The rune bridge (first generation): fail-closed L1↔L2 rune deposits and exits, proven round-trip on a real regtest with bitcoind and ord agreeing at every hop.
- Security audits: H1 (sign-verified replay) and H2 (SPV-proven rune settle) fixed; the last unsigned path closed; adversarial swarms, ultra reviews, and the grand audit made standing practice.
- The v2 pivot, prepared on `main`: the fungible ₭ ledger (EMITTED − BURNED), the dual Star Registry, proof-of-donation mint, and the Supreme Law in the ledger — the foundation the `kraynet-v2` branch grew from.
