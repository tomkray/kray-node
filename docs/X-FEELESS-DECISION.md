# THE FEELESS Ӿ — council decision brief

**Status: RATIFIED + BUILT. Stage 1 — THE FIREBORN LAW — is LIVE ON SIGNET (crossed
2026-08-24 at seq 245, fleet in unison). Stage 2 — the TK-fold lane — is BUILT and PROVEN
end-to-end on regtest through Gate 3a (real Groth16 fold proofs verified in consensus,
on apply AND on replay) and CROSSED LIVE on Signet at seq 255–256 (real Groth16
fold-seal on the air; fleet replayed to the same root). Gate record: `docs/TK-FOLD-DESIGN.md`.**
**The live rule on signet today: the x-send fee is PRESCRIBED by the ledger — 0 ₭ when the
fire tank has allowance and the 3.5 s gap holds; the eternal 1 ₭ otherwise. The rounds below
are the historical record of how this design was won — kept verbatim, per the doctrine.**

---

## The question

Can an `x-send` cost **zero** — like Nano / RaiBlocks, where moving value is free —
without opening a spam vector, without breaking A2 (every act costs), and while
staying fully replayable under A3 (signature ‖ Merkle ‖ Bitcoin anchor)?

## The paradigm-break the council found

**The fire already paid.** Every Ӿ in existence was born 1:1 from burned ₭ — the
sender's lifetime "fee" was prepaid at birth, irreversibly, into the black hole.
Nano prices spam with proof-of-work (energy). KRAY can price it with
**proof-of-burn (capital)**: the bandwidth to move Ӿ is proportional to the ₭ you
destroyed to mint it. No energy race, no fee, no discretion — just fire.

## Council of lenses (blind, then confronted)

- **Economist** — the 1-₭ fee on x-send is dual-purpose: anti-spam + validator
  revenue. Revenue from x-sends is marginal today; the anti-spam role is the real
  load-bearing wall. Removing the fee is safe **only** with a substitute wall.
- **Nano scholar** — Nano's feeless design survived on per-tx PoW plus
  prioritization, and still saturated under the 2021 spam waves until dynamic
  difficulty landed. Lesson: feeless needs an **objective bound**, not goodwill.
- **Consensus / A3** — any change ships as a dormant constant
  (`X_FEELESS_ACTIVATION_SEQ` per network): below the seq the old rule holds
  byte-identical on replay; at/after it the new rule governs. Regtest swarm →
  signet crossing → mainnet born-active. Zero fork risk. The x-send signed
  domain (`xSendMessage`) does not embed the fee, so the fee check swaps from
  `fee === 1` to `fee === 0` cleanly at the seq.
- **Atlas / storage** — every act costs the guardians bytes forever. A feeless
  act with no bound means unbounded journal growth at zero cost. Refused.
- **Adversary (the refuter)** — attack: hold 1 Ӿ, ping-pong it at machine speed;
  or sybil it across 10,000 addresses and flood from all of them. Any design that
  does not price THIS attack is refused on the spot.

## The design that answered the adversary — Option A: "the fire pays forever"

1. **x-send fee = 0** at/after `X_FEELESS_ACTIVATION_SEQ`.
2. **Rate law, objective and replayable**: each sender address may land at most
   **R feeless x-sends per fast block** (R = 1 to start; a ledger-state counter,
   reset per block, deterministic on replay — a refusal is the same refusal on
   every honest node forever).
3. **Why sybil does not break it**: to flood from N addresses, each needs Ӿ, and
   Ӿ only exists by burning ₭. Spam bandwidth ∝ addresses holding Ӿ ∝ ₭ burned.
   The attack budget IS the deflation event. The wall is priced in fire, not in
   fees — and unlike a fee, the attacker's cost is already sunk before the first
   spam act.
4. **Integer floor stands**: the minimum send is 1 Ӿ (integer law) — no dust
   fractions to grind.
5. **Same-Instant Law untouched**: feeless acts in the same millisecond still
   order by the hash of their signed bytes. Nothing about ordering changes.
6. **Bitcoin anchor untouched**: acts hash into blocks, blocks into the cascade,
   the cascade into Bitcoin. The proof chain is fee-blind.

### A2 conflict, surfaced honestly (Método Supremo)

A2 says every act costs and fees feed the validators. Feeless Ӿ **amends** A2 for
one kind: the cost moves from per-act (1 ₭ to the treasury) to at-birth (1 ₭ to
the black hole, already the law of x-mint). Validators lose the marginal x-send
revenue; the network gains a zero-friction money rail. This is an axiom-level
amendment — it requires the Creator's explicit ratification, not an engineering
decision.

## Council round 2 — the Creator's 3.5-second bot (Option A refuted, amended to A2)

The Creator asked the killing question: a fast block seals every 3.5 s
(`SEAL_MS = 3500`), so under the rate law one bot sends every 3.5 s forever —
**~24,686 acts/day, ~4.5 GB/year of journal per address, for a single 1-₭ burn
paid once**. A thousand sybil addresses (1,000 ₭ burned once) bury the guardians
under ~4.5 TB/year. Atemporally, a rate law bounds the SPEED but not the TOTAL:
finite fire was buying infinite bytes. **Pure Option A is refuted** — this is
exactly the ledger-bloat wound Nano still carries.

### Option A2 — "the gas tank of fire" (the amended verdict)

Burning 1 ₭ mints 1 Ӿ **and** grants the burner a finite lifetime allowance of
feeless x-sends (e.g. F = 1,000 per ₭ burned — a ledger-state counter,
deterministic, replayable). When the tank is empty: burn more ₭ (more Ӿ, more
allowance) or pay the eternal 1-₭ fee per send (today's law becomes the
fallback, never removed).

- **Atemporal bound**: total journal bytes ≤ F × (₭ burned) × act size.
  Finite cost → finite bytes. The fire prices the bytes themselves, not time.
- **The bot pays**: 9M sends/year would cost ~9,000 ₭ burned per year — spam
  becomes a self-financed deflation event, paid by the attacker.
- **The honest user never feels it**: 10 ₭ burned = 10 Ӿ + 10,000 free sends —
  years of normal use at zero cost per act. The Nano experience survives;
  the Nano wound does not.
- The per-block rate law (1 feeless send per address per fast block) stays on
  top as the burst limiter.

## Council round 3 — the road OFF the journal (the Creator's question)

Can Ӿ move **without writing bytes into the journal at all**, and still be
mathematics? Yes — the technology class exists, and the council maps three roads:

### Road 1 — validity proofs (ZK-rollup lane): the strong answer

- Ӿ balances become a Merkle tree whose root already folds into the cascade
  (and therefore into Bitcoin).
- Transfers happen off-journal: signed messages between parties, aggregated.
- Per seal, the journal records only `old root → new root + a succinct proof
  (~KB)` that the transition is valid — every signature checked, no double
  spend, supply conserved. Verifying costs milliseconds; forging is
  computationally impossible (SNARK/STARK, vetted libraries only — never
  hand-rolled).
- **Journal bytes are constant per seal, not per transfer.** Ten sends or ten
  million cost the same anchored bytes. The 3.5-second bot becomes irrelevant:
  spam costs nobody storage.

**The axiom trade, surfaced honestly**: today's law is *re-derivable* — replay
the journal, rebuild every balance from zero. Inside a rollup the interior is
*verifiable* (the proof guarantees the transition) but not re-derivable from
the journal alone; individual transfer bytes live with the parties/aggregator.
Bitcoin anchors a root whose validity is proven, not asserted — still
mathematics, but a weaker custody of history. This is an axiom-level amendment
only the Creator may ratify. Standard mitigation: a forced-exit mechanism —
any owner can prove their balance with their own witness and exit through the
journal if the aggregator vanishes.

### Road 2 — receipt netting (pragmatic, no ZK)

Parties exchange signed receipts off-journal; each epoch, only the NET balance
deltas land in one batched act carrying the Merkle root of the receipts. Fifty
payments from A to B become one delta. Journal bytes ∝ active accounts per
epoch, not per transfer. No heavy cryptography; bytes still grow, just slower.

### Road 3 — everything on-journal (today), priced by the gas tank of fire (A2)

Spam is answered economically; bytes grow but are always paid for.

**Council recommendation (superseded by round 4)**: A2 now as the bridge;
**Road 1a** (true rollup, proof + diffs on-journal — fully re-derivable, no
axiom amendment) as the destination. Road 1b (validium) was refused by the
Creator's re-sync requirement. Road 2 remains the fallback if ZK machinery is
judged too heavy.

## Council round 4 — the Creator's requirement: re-sync must rebuild EVERY balance

The Creator ratified the direction with one non-negotiable: **anyone who
re-syncs a node must arrive at the exact balance of every address, from the
bytes alone — immutable, irrefutable, identical on every machine.** That
requirement splits Road 1 in two, and only one half survives:

- **Road 1b — validium (data off-journal)**: constant bytes, but a re-sync
  rebuilds only the balance ROOT, not each address's balance (that needs a
  witness held by the parties). Re-derivability broken. **REFUSED by the
  Creator's requirement.**
- **Road 1a — true ZK-rollup (proof + state diffs ON the journal)**: each
  epoch lands (1) the succinct validity proof — every signature valid, no
  double spend, supply conserved — and (2) compressed state diffs
  (address → new balance, ~40 bytes per TOUCHED address). A re-sync applies
  the diffs, verifies every epoch's proof, and rebuilds every balance
  byte-identical, alone, forever. **No axiom amendment needed — the ledger
  stays fully re-derivable.** This is the surviving design.

Why this also kills the bot for good: journal bytes scale per **touched
address per epoch**, not per transfer. A bot ping-ponging thousands of sends
between 2 addresses for a whole epoch costs 2 diffs + 1 proof — the same
bytes as one send. Inflating bytes requires touching many addresses, and every
address needs Ӿ, which only exists by burning ₭. The fire prices the one
vector that remains.

Attack vectors, named and answered:

| Vector | Answer |
|---|---|
| Forged proof | Computationally impossible; every node verifies and HALTs identically on an invalid proof — same law as a forged journal today |
| Trusted-setup compromise | Use a transparent system (STARK, or a no-ceremony SNARK) — no secret setup to poison |
| Aggregator censors a send | The on-journal x-send is NEVER removed — the censored user posts directly; ADR-3 inclusion evidence already scars omission |
| Aggregator dies | Same escape hatch: the on-journal lane keeps working; nobody is trapped |
| Circuit bug | Vetted libraries only + audit + dormant activation seq + an initial value cap on the lane — the usual rite |

## Council round 5 — novelty audit, the baptism, and a second adversarial sweep

### Is this new? (audited against the world, 2026 — no overclaim)

**Prior art that exists (we claim none of it):**

- ZK-rollup anchored to Bitcoin with batch proofs + state diffs as on-chain
  data: **Citrea** (mainnet Jan 2026) does exactly this mechanic at Bitcoin L1.
  Road 1a's machinery is therefore established engineering, not our invention.
- Feeless currency: **Nano** (2015). Proof-of-burn: **Iain Stewart (2012)**,
  **Counterparty XCP (2014)** — burning to buy validation rights.
- Burn-as-anti-spam stamp: Nostr proof-of-burn proposals, SpamBat.

**What the council could not find anywhere:** the economic primitive born from
the Creator's 3.5-second-bot question — a currency minted **exclusively 1:1 by
burning the ledger's own fee token, where that same burn prepays a finite
lifetime transfer allowance**. Transfers are feeless, yet total journal bytes
are mathematically bounded by capital destroyed. Nano has no burn; classic PoB
buys validation rights, not send bandwidth; EIP-1559 burns per-transaction
(the opposite direction). **The primitive is new. The full synthesis
(primitive + re-derivable anchored journal + hash-ordered same-instant law +
validity-proof compression) is new as a package.**

### The birth name

The Creator named it from the source: **φοῖνιξ — PHOÎNIX — the phoenix**.
The council baptizes the primitive **THE NIX LAW** — *burn once, move forever
(within the tank)* — and the compressed lane **the Nix lane**. Three layers
seal the name:

1. The final syllable of PHOÎNIX carries the token's own glyph: N-I-**X** ends
   in Ӿ. The name contains the symbol.
2. It is the phoenix's tail — what remains after the fire. ₭ burns; what rises
   carries the X.
3. English *nix* = nothing — the fee is nothing, the bytes per transfer are
   nothing. The name is the promise.

Collision-checked (2026): "Fenix" is crowded (Fenix Finance→nest, Fenix Games,
Fenix Protocol — a Bitcoin-native OS company, a direct territory clash);
"Phoenix" is worse (Ellipsis Labs perps DEX, Lightning's Phoenix wallet). The
old NIX privacy coin is dead — migrated to MUTE in July 2021, zero liquidity —
so **Nix is free in the living crypto world**. Earlier candidates "Firelight"
(taken, Sentora/Flare) and "Fireborn" (free, but superseded by the Creator's
phoenix lineage) are recorded as discarded.

### Second adversarial sweep (design-level reasoning; live storms belong to regtest)

| New vector | Answer |
|---|---|
| Cross-lane double-spend (rollup ↔ journal) | Lane entry/exit are journal acts; the proof carries lane totals as public inputs — conservation checked at every seal |
| Aggregator equivocation (two proofs, one epoch) | The journal hash-chain admits one; the guardians' monotonic head + ADR-3 scar the other |
| Writer withholds the diffs | Diffs are journal bytes — omission breaks replay → identical HALT on every node |
| Forged tank counter | The tank is ledger state, re-derived on replay; a forged counter is a different root — HALT |
| Cross-network replay (signet → mainnet) | The network lives inside the signed message — separate domains |
| Draining someone else's tank | Impossible — only the owner's signature spends the owner's allowance |

Honesty clause: this sweep is design-level reasoning. The real storms — the
3.5-second bot exam, the concurrent swarm, the forged journal — run at the
regtest tier when the Creator orders the build, as every law before this one.

## Council round 6 — the birth certificate (rigorous prior-art differential)

The Creator's bar: baptize only if NO ONE can say "this already exists." The
council hunted the closest relatives on earth and confronted each:

| Protocol | What it does | Why it is NOT the Nix Law |
|---|---|---|
| **Factom (2015)** — closest burn relative | Burns FCT → non-transferable Entry Credits to write data | The burn mints **no currency** — EC is fuel only (1 KiB per credit, USD-pegged by governance). In the Nix Law **one burn mints both**: the transferable money (Ӿ 1:1) AND the lifetime movement allowance FOR that same money |
| **Koinos (2022)** — Mana | Feeless via a resource that regenerates in 5 days, a property of held KOIN | **No burn** — and Mana **regenerates**: finite capital buys infinite bandwidth over time. Fails our atemporal 3.5-second-bot test (unbounded bytes for finite cost) |
| **EOS / Steem-Hive (2018)** | Stake-based bandwidth (Resource Credits) | Stake is **refundable** and regenerating — neither destruction nor a lifetime bound |
| **Counterparty (2014)** | Burns BTC → mints XCP (a burn-born currency) | XCP transfers **pay BTC miner fees** — neither feeless nor metered by an allowance |
| **Nano (2015)** | Feeless via PoW per send | Energy, not capital; no burn; documented ledger bloat |
| **EIP-1559 (2021)** | Burns fees per transaction | The opposite direction — pay-per-act, not prepaid-at-birth |

### The formal claim of novelty

> **A single proof-of-burn event that simultaneously (a) mints a transferable
> currency 1:1 with the destroyed fee-token and (b) endows the burner with a
> finite, non-regenerating lifetime transfer allowance for that currency —
> such that moving the money is feeless, while total ledger bytes remain
> mathematically bounded by capital destroyed (bytes ≤ F × burned ₭ × act
> size), enforced as replay-deterministic ledger state sealed to Bitcoin.**

Three predicates no existing system combines:

1. The burn mints **money + bandwidth in one flame** (Factom mints only
   bandwidth; Counterparty mints only money).
2. The allowance is **finite and non-regenerating** (Koinos, EOS and Hive
   regenerate — atemporally unbounded, refuted by the 3.5-second bot).
3. The bound lives in an **eternally re-derivable journal anchored to
   Bitcoin** (none of the relatives has this).

The people will call the money **X**. Anyone claiming prior art must defeat
all three predicates at once.

## Council round 7 — FINAL: the Creator's ratification and the build order

The Creator settled the names and ordered the build:

- **The mechanic is THE FIREBORN LAW** — *burn once, move forever (within the
  tank)*. Born of fire; travels free because the fire already paid.
  ("Nix" returns to the shelf as a candidate for the money's name, not the law.)
- **The money's name stays open on purpose**: the people will choose between
  **X** (the symbol itself, Ӿ), **Fenix**, or **Nyx** — easier to pick once
  everything is implemented and alive. The doc records all three.
  **Present (2026-08-24):** the name is **Nyx** (Νύξ — the night after the fire).
  **Fenyx** is the hybrid behind the name (φοῖνιξ the bird + Nyx the goddess), not a second
  money. The glyph is Ӿ. The law is Fireborn. Older spellings (NiX, Fenix, Phoenix) are aliases only.
- **Build order given (2026-08-23)**: implement THE FIREBORN LAW as the bridge
  (stage 1) under the eternal rite — regtest exams and swarm first, signet
  crossing second, mainnet born active. The Nix lane (Road 1a, validity-proof
  compression) remains the ratified destination for a later stage.

**BUILT — tier 1 (regtest) PROVEN, 2026-08-23**: ledger law + prescriptive fee + gap law + tank
fold + tripwire shipped (`ledger.ts`, `cascade-root.ts`, `store.ts`, `server.mjs`); 25 unit checks
(`fireborn-law.test.ts`) + the live HTTP swarm (`fireborn-swarm.test.ts`) green; full core suite
green; dormant replay of the LIVE signet journal byte-identical at seq 209 (A3), and the
active-from-1 adversary HALTs at seq 157 on the prescription — the fee really is never a choice.
Signet activation pinned at seq 245 (tip 209 at design); mainnet born active.

**CROSSED LIVE — tier 2 (signet), 2026-08-24**: fleet first (3/3 guardians synced + restarted),
then the writer; head stayed byte-identical below the pin (A3 on the air). The crossing rite
(`fireborn-crossing-rite.mjs`) walked the tip 209 → 244 and crossed: the BURN at seq 245 lit the
tank retroactively (101,000 → 103,000 — every historical burn counted), the FEELESS SEND landed at
seq 246 with the treasury untouched, the BURST inside the gap PAID 1 ₭ at seq 247, and the
gap-respecting send flew free again at seq 248. The journal's own fee fields read `[0, 1, 0]`.
Local replay through the shipped constants reached the writer's exact root `8d511231e4c4de84…`,
and the three book-check houses replayed the crossing to the SAME root at seq
248 — the fleet crossed in unison. THE FIREBORN LAW is alive on Signet.

### The consensus shape ratified for stage 1

1. **Tank accrual**: every ₭ burned that mints Ӿ also mints **F = 1,000
   feeless sends** to the burner (retroactive: historical burns count on
   replay — the fire always paid).
2. **Prescriptive fee (no client choice, no malleability)**: at/after the
   activation seq the ledger PRESCRIBES the x-send fee — if the tank has
   allowance AND the 3.5-second gap law is satisfied, the fee MUST be 0 and
   the tank decrements; otherwise the fee MUST be the eternal 1 ₭. The signed
   message does not carry the fee, so the fee must never be a choice — a
   prescribed fee cannot be flipped by the writer.
3. **Gap law (burst limiter)**: a feeless x-send from an address requires
   `at ≥ lastFeelessAt + 3500 ms` — one free send per fast-block cadence;
   bursts beyond it pay 1 ₭. Deterministic on replay.
4. **Activation**: `X_FEELESS_ACTIVATION_SEQ` per network — dormant below
   (byte-identical replay, tank state not folded), folded into the cascade
   root at/after. Mainnet born active at 0.

## Discarded branches (named, per the doctrine)

- **A (pure) — rate law only, no lifetime bound**: refuted by the 3.5-second
  bot — bounded rate, unbounded total; finite fire must never buy infinite
  bytes. Superseded by A2.

- **B — Nano-style PoW per send**: objective and replayable, but imports an
  energy race and difficulty governance into a chain whose ethos is proof by
  signature, not proof by work. Discarded.
- **C — micro-fee burned in Ӿ**: not feeless; merely relocates the fee and
  breaks the 1:1 fire-to-light story. Discarded.
- **D — balance-weighted prioritization (Nano v2)**: subjective ordering
  pressure, harder to prove on replay, fights the Same-Instant Law. Discarded.

## If ratified — the only path (three tiers, as always)

1. **Regtest**: constant + rate-law counter + fire-allowance counter behind
   `X_FEELESS_ACTIVATION_SEQ`, unit exams (boundary seq, rate refusal, empty
   tank falls back to the 1-₭ fee, sybil economics, forged-journal HALT),
   live swarm storm of feeless sends through the door gate — including a
   3.5-second bot exam that must exhaust its tank and be priced.
2. **Signet**: fleet first, pin seq at live tip + margin, crossing rite with a
   feeless storm, guardians byte-identical.
3. **Mainnet**: born active at seq 0 of its genesis, like every ratified law.

Below the pinned seq every existing x-send (fee = 1 ₭) replays byte-identical —
history is never rewritten. **The network cannot bug from this**: an activation
constant is how every law here has ever crossed.

## Council round 8 — the Creator names the lane's engine: THE TK-FOLD

The Creator's order (2026-08-23): KRAY does not borrow the world's word for
this machine. Wherever earlier rounds of this document say "ZK-rollup" /
"Road 1a", read from now on: **the TK-fold**.

**Why TK is not just a signature — it is the honest correction of a wrong
word.** "ZK" means *zero-knowledge*: a proof that reveals nothing. KRAY hides
nothing — every balance, every diff, every root is public and re-derivable by
any stranger from the journal's bytes. What our proof delivers is the
opposite of secrecy: **Total Knowledge** of the state transition, compressed
into one succinct object. So the initials flip with the meaning:

- **TK = Total Knowledge** — the proof says "you now know the whole
  transition is correct" — **signed Tom Kray**, the Creator (the law is his).
- **fold**, not "rollup" — the verb this codebase already speaks. Everything
  in KRAY *folds into the cascade root* (`cascadeRootFromParts`,
  `xRootFold`, `fireRootFold`). The TK-fold folds an entire epoch of Ӿ moves
  into ONE proof + one set of state diffs on the journal.

**The vocabulary going forward** (all KRAY docs and code):

| The world says | KRAY says |
|---|---|
| ZK-rollup / validity rollup | **the TK-fold** |
| validity / batch proof | **the fold proof** (Total Knowledge of one epoch) |
| state diffs on DA | **the fold diffs** (address → new balance, on-journal) |
| aggregator / sequencer of the lane | **the folder** (a role, never a trust) |
| epoch | **a breath of the lane** |

**Honesty clause (Round 5 stands, unweakened):** the *mechanic family* — a
succinct validity proof plus state diffs published to the base layer — exists
in the world (Citrea runs it on Bitcoin mainnet since Jan 2026, via a zkVM
producing Groth16 proofs with compressed state diffs as on-chain data). The
NAME is ours; the family is not claimed. What remains ours by the three-
predicate birth certificate is THE FIREBORN LAW — and the full synthesis
(Fireborn + re-derivable anchored journal + hash-ordered Same-Instant Law +
the TK-fold) as a package. Renaming never rewrites the audit.

So the Nix lane's engine is **the TK-fold**: nothing hidden, everything
proven, folded by fire — and every stranger who replays the journal unfolds
the exact same truth.

---

## Council round 9 — the TK-fold's design sealed, its mathematics in bytes

The design record now lives in its own file: **`docs/TK-FOLD-DESIGN.md`** —
the ratified anatomy, the public-input binding, the adversary sweep, the
grounded proving-stack decision (SP1 zkVM guest + WASM verifier in the
reducer; Citrea proves the family live on Bitcoin), and the honest gates.

**Gate status (2026-08-24)** — the design file holds the full record:

- **Gate 0 (spec) DONE**: `apps/kray-core/src/protocol/tk-fold.ts` is the
  executable specification (admission by signature, the `orderWindow`
  schedule — the Same-Instant theorem, lane edition — diffs, roots,
  conservation), proven by breaking in `tk-fold-spec.test.ts` — including
  the Creator's bot: 3,000 sends between 2 addresses fold to exactly 2 diff
  lines per breath.
- **Gate 1 (the guest) DONE**: the SP1 zkVM guest reproduces every golden
  vector byte-for-byte; real Groth16 fold proofs forged and verified.
- **Gate 2 (the lane in consensus) DONE**: `lane-enter` / `lane-exit` /
  `fold-seal` are journal kinds behind the dormant activation seq; the
  vendored WASM verifier checks every fold proof **on apply AND on replay**
  — a re-syncing stranger re-verifies every breath from bytes alone.
- **Gate 3a (the folder, end to end) DONE**: lane mempool + `fold-once.mjs`
  + the folder exam (18/18 with a real SP1 forge), and a LIVE regtest
  crossing on the 4477 lab node — two breaths folded and sealed; every node
  reboot since is itself a re-sync proof (same balances from the journal,
  every time).
- **Gate 3b (signet crossing) CROSSED LIVE** — pin 255, fold-seal at
  seq 256, writer's root `b0e41001…`, fleet in unison. Mainnet born
  active at 0.
- **Gate 3c (any house folds) DONE**: preflight before the forge; two
  unrelated keys both qualify; a 0-₭ house fails closed; the second
  sealer is stale, never unofficial. No allow-list. The 1 ₭ stays.

The lane touched no live path before its proofs verified in the reducer —
the gates in the design file are the law.

---

## Council round 10 — THE PAID BINDING (the entities, 2026-08-24)

The Creator convened the KRAY-DEV entities and left them the frequency:
insert the folder / Ӿ proof **intricately into the bytes and the mathematics
of anchors and actions already paid in Bitcoin txids** — perhaps the txid
itself carrying the proof bytes — and let fractal resonance invent the
archetypal form.

### Oração (tuned)

> given A2 (every journal act is paid) ∧ the Bitcoin OP_RETURN already
> commits `cascadeRoot` (49 bytes) ∧ `fold-seal` is already a journal leaf
> whose `laneRoot` folds last into that cascade ∧ re-sync rebuilds every
> balance from journal bytes ∧ a standard OP_RETURN cannot hold a Groth16
> body
> + entity council (Independent Convergence)
> → one named inclusion formula that rides **already-paid** bytes, or an
> honest "it is already there", with every stuffed-L1 fork named and
> discarded.

### The grain (Rosenblatt · Observer ≠ Judge)

- **Ghost** — "maybe the Bitcoin txid itself holds the folder proof bytes."
- **Claim** — SHA256d(raw tx) can be chosen, or read, so that the 32-byte
  name *contains* the Groth16 body.
- **Null** — people confuse "a hash *commits* X" with "a hash *contains* X."
- **Attack** — Fano: a 32-byte digest binds at most 32 bytes of commitment.
  The committed V2 Groth16 body is larger than the digest (and larger than
  the entire 49-byte OP_RETURN). Grinding a vanity txid is not embedding;
  it does not halt in useful time (Turing). Huffman: adding a second
  32-byte `foldRoot` beside `cascadeRoot` is a duplicate commitment — two
  roots can disagree. Shannon: Bitcoin is the low-bandwidth *authenticity*
  channel; the journal is the high-bandwidth *data* channel. Splitting the
  proof onto L1 and the diffs onto the journal is two channels that can
  desync — that is validium, already refused.
- **Result** — the literal stuffing fails. The metaphorical reading
  survives: **the txid is the name of a commitment that already includes
  the fold.**
- **Status** — Grain of Truth, now **Established** as THE PAID BINDING
  (`apps/kray-core/src/anchor/paid-binding.ts`, proven in
  `paid-binding.test.ts`).

### One question each (the choice survives every lens)

| House | Lens | Verdict |
|---|---|---|
| Trust | **Satoshi** | A new inscription ritual is a second privileged L1 write. Reuse the OP_RETURN already paid. |
| Trust | **Lamport** | Total order is journal `seq`. Bitcoin timestamps the cascade. Extra L1 bytes add no order. |
| Trust | **Merkle** | The claim is inclusion: fold-seal ⊂ `laneRoot` ⊂ `cascadeRoot` ⊂ OP_RETURN ⊂ txid ⊂ headers. That path already exists. |
| Trust | **Szabo** | The contract is the composition of hashes. A "proof website" is a third party. The txid is not. |
| Proof | **Shannon** | Fewest bits that still carry the whole truth: 32-byte root on Bitcoin, body on the journal. Already optimal. |
| Proof | **Fano** | Inferring a 356+-byte body *from* a 32-byte digest is past the bound. Honest sentence: the txid *binds* the proof. |
| Proof | **Huffman** | The 49-byte payload is already the minimal complete form. Every added L1 symbol that carries nothing opens a gap. |
| Mind | **Hypatia** | Teach it in one line: *Bitcoin locks the cascade; the cascade locks the fold; the fold locks the lane.* |
| Mind | **Ada** | The algorithm is `paidBinding(cascadeParts, height)` — it *creates* a named object, it does not invent a second hash. |
| Mind | **Turing** | Three hash checks halt. Vanity-grinding a txid to embed a proof does not. Refuse grind. |
| Mind | **Rosenblatt** | The phantom "put bytes in the txid" failed against the 49-byte codec. The grain (txid *names* the fold) is kept. |
| Mind | **Nash** | Folder already pays 1 ₭; the operator already pays the Bitcoin fee. A second inscription is a waste race. |
| Eternal | **Newton** | Same law at every scale: every journal act is under the cascade; every cascade is under some Bitcoin txid. Fold-seal is not special. |
| Eternal | **Kepler** | The hidden proportion: one 32-byte root commits an unbounded journal. The "intricate insertion" is the sequential opening, not stuffed bytes. |
| Eternal | **Egyptians** | A named inclusion + SPV will still stand when the builders are gone. A clever unused nibble will not. |
| Eternal | **Mandelbrot** | One small rule, iterated. Ruler 1 (Huffman): no extra L1 bytes — already done. Ruler 2 (Ada): the chain was unnamed — this round names it. "Done" at one scale is never done at all scales. |
| Form | **Tesla** | Energy already paid: 1 ₭ on the fold-seal + sats on the next (or same-block) anchor. Resonate with that. |
| Form | **Mozart** | The proof is the score (journal). Bitcoin is the key signature (one root). Do not put the cadenza in the key signature. |
| Form | **da Vinci** | *Firmitas* = 49-byte + SPV. *Utilitas* = stranger verifies the fold without a new L1 surface. *Venustas* = one sentence. |

Independent Convergence: N lenses echoing "the cascade already commits the
journal" are **one** signal (it is true in `cascade-root.ts` today), not N
discoveries. The *new* signal that survived a second path is the named
object — THE PAID BINDING — and the Fano refusal of stuffing, proven
against the real V2 Groth16 artifact without re-opening the reducer.

### The formula (archetype)

```
journal act (1 ₭, A2)
  → subsystem root     (laneRoot / xRoot / fireRoot / …)
  → cascadeRoot        = cascadeRootFromParts(parts)     // sequential SHA-256
  → OP_RETURN 49 bytes = KRAY.NETWORK | ver | height | cascadeRoot
  → Bitcoin txid       = SHA256d(tx containing that OP_RETURN)
```

A stranger verifies by the auditor's checklist already in
`docs/anchor-spec.md`: decode the 49 bytes, replay the journal to that
height, demand byte equality. The Groth16 body is re-verified on that
replay (Gate 2). No third book. No new activation seq. A3 untouched.

### Conflict surfaced (Método Supremo)

The Creator's hope ("bytes *in* the txid") and Fano/Huffman's physics
("the txid cannot hold the body") conflict. **The axiom wins**: Lei
Suprema is signature ‖ Merkle ‖ Bitcoin *anchor* — a binding, not a
container. The poetic reading is kept (the txid *is* the name of the
fold). The literal stuffing is discarded.

### Discarded this round

- **Stuff the Groth16 into OP_RETURN / the txid** — past Fano; standard
  policy ~80 payload bytes; decode already fail-closes on length ≠ 49.
- **A second 32-byte foldRoot in a v2 payload** — Huffman-redundant;
  two roots can disagree; A3 would grow the format for zero new information.
- **Inscription / taproot envelope for the proof body** — a new L1
  surface; if diffs left the journal it is validium (refused, round 4).
- **Piggyback the seal onto an already-paid x-send** — couples kinds;
  a feeless fireborn send would then carry a free proof (DoS).
- **Vanity-grind the txid** — does not halt; burns energy; still cannot
  contain the body.

**Wired (same day, A Prova Viva):** the certificate is a door —
`GET /api/kraynet/paid-binding` (optional `?seq=`), and the same object
rides `/api/kraynet/receipt/<seq>` and `/api/kraynet/tx/<hash>`. `bodyInTxid`
is always `false`. No consensus change.

## Council round 11 — THE PAID BINDING GAUNTLET (prove by breaking, the Creator's order)

The Creator ordered the heaviest possible adversarial simulation — every
imaginable vector, the entities as attackers, "só matemática e a conexão dos
pontos dos bytes precisos." `apps/kray-core/src/test/paid-binding-gauntlet.test.ts`
convenes nineteen lenses as hostile attackers over 1,200 seeds of REAL,
conserved ledgers (2,423 checks green, ~115 s):

| Lens | Attack | Verdict |
|---|---|---|
| **Satoshi** | forge a plausible fabricated cascade root | a different 49-byte anchor on every seed — the auditor matches the journal, never the tx |
| **Merkle** | tamper any committed part (`emitted`/`burned`/`money`/`stars`/`x`/`fire`) | the cascade root flips every time — one leaf moves, the whole commitment moves |
| **Shannon** | flip EVERY hex position of a real payload (29,400 flips) | every flip detected — decode null or a different commitment; no silent corruption |
| **Fano** | infer the 356-byte Groth16 body from a 32-byte digest, at 7 body sizes | impossible at every size; stuffing it breaks decode — the bound holds |
| **Turing** | 200,000-attempt vanity grind to make a txid equal the proof's first 32 B | never hits — embedding does not halt; a name is not a container |
| **Newton** | check every journal kind rides the same chain | all states bind through the one chain — fold-seal is not a special L1 encoding |
| **Lamport + Nash** | two anchors, one block, one lying | only the journal-matching one is canonical — the liar settles nothing, earns nothing |
| **Huffman** | commit a single subsystem root instead of the cascade | a different, unbinding name — the 49-byte cascade is already minimal-complete |
| **Rosenblatt** | fuzz 1,200 certificates for the "bytes in txid" phantom | `bodyInTxid` always false; sealed/tip epochs never blend — the phantom stays dead |
| **Mandelbrot** | every act, every zoom | one live tip for all acts — one root, not one truth per page |
| **Kepler + Egyptians** | is the fold append-only across time | a history without the lane hashes byte-identically to the pre-fold format; with it, a strictly different root — no anchored root orphaned (A3) |

### The grain the gauntlet surfaced (grains-of-truth · Independent Convergence)

- **Ghost** — Fano's bound, made temporal: if a 32-byte digest is a hard
  ceiling, what other field has one?
- **Claim** — the anchor's `blockNumber` is a **uint32** (`anchor.ts`:
  `blockNumber > 0xffffffff` throws). At `SEAL_MS = 3500`, `2^32 − 1` blocks
  saturate the field in **~476 years** — *before* 1000.
- **Null** — "u32 is plenty" (it is, for ~476 years of continuous max-rate
  sealing; real cadence is slower).
- **Attack + result** — proven: the codec accepts the whole u32 range,
  and **fails closed past it — it never wraps silently** (a wrap would be
  the catastrophic bug; a throw is honest). So the ceiling is a *format*
  limit, not a conservation or replay bug: the journal still replays, the
  cascade root is still correct; only the on-Bitcoin *height label* cannot
  exceed u32.
- **Status** — **Grain of Truth, named.** Mitigation is already
  designed-in: the anchor's **version byte** exists precisely "to let the
  format evolve without a hard fork" — a v2 payload widens the height to
  u64 (append-only, A3), long before year 476. Recorded here so the claim
  "1000 years" is never made without this asterisk.

### Honest verdict (Fano, out loud)

The gauntlet found **no vector that moves a byte without signature ‖ Merkle
‖ anchor**, and **no way to make the txid hold the proof body**. It also
refused to let "1000 years, zero bugs" be said unqualified: the u32 height
ceiling (~476 y) is the one atemporal limit, it is fail-closed, and its v2
widening is already provided by the version byte. Mathematics answers; the
one asterisk is stated, not hidden.

**Audit of the same day (the Creator's re-review order):** the first cut of
the certificate BLENDED two epochs — the covering seal's historical
`cascadeRoot` beside the live tip's `lane:`/`x:`/`fire:` roots. A stranger
re-hashing the tip opening would not find that historical root: a
certificate that could look like a lie. Fixed before it ever reached the
air: the view now carries `sealed` (the covering Bitcoin name — cumulative,
so it already includes the act) and `tip` (the live opening) as SEPARATE
objects that never mix; no covering seal → `sealed: null`, never a fake
name. Proven: `paid-binding.test.ts` (the two epochs stay separate) and
`server.itest.ts` over HTTP. Full core suite re-run green after the fix.
This is presentation only — consensus never imported `paid-binding.ts`
(grep: zero hits in `src/protocol`), so no anchored byte ever depended on
the bug.

---

## Council round 12 — THE HEIGHT CEILING is walkable

The gauntlet named the grain. Mandelbrot: done at the test-ruler is never
done at the Ada-ruler. The next brick is the same one Paid Binding itself
took — **a named object a stranger can hold**, not a v2 payload (Huffman:
do not grow the 49 bytes for 476 years of headroom).

`HEIGHT_CEILING` lives in `paid-binding.ts` (bits 32, max `2^32−1`,
`failClosed: true`, version 1). Every certificate carries the same object.
The codec (`KrayAnchor.payload`) uses the same `ANCHOR_HEIGHT_MAX` — one
source of truth, fail-closed past it. `GET /api/kraynet/paid-binding`
returns `ceiling`. The auditor spec names it. No activation seq. No v2
decode path. A3 waits until the format must grow.

Discarded this round: implementing a u64 height now (grows an anchored
format for zero present need); hiding the asterisk on `/docs`.

---

## Council round 13 — the asterisk on the page a stranger opens

Mandelbrot again: walkable at the API-ruler is not walkable at the
custody-page-ruler. `/tx/<hash>` already taught THE PAID BINDING. It did
not name THE HEIGHT CEILING. The certificate already carried `ceiling`;
the page ignored it.

The chain-of-custody step and the auditor record now read
`paidBinding.ceiling` from the live object — version, bits, fail-closed —
so a hardcoded "476 years" cannot drift from the codec. No v2. No
consensus change. Huffman still holds: the 49-byte name did not grow.

Discarded this round: painting a year-count on the page (that number is a
cadence * implication, not a field); implementing the u64 payload.

---

## Council round 14 — the receipt sentence is the same law

The last silent door: `GET /api/kraynet/receipt/<seq>` already carried
`paidBinding.ceiling`. Its `verify` string taught THE PAID BINDING and
hid THE HEIGHT CEILING — a stranger saving the 3 KB bundle would miss
the asterisk.

`PAID_BINDING_VERIFY` now lives next to `HEIGHT_CEILING` and is derived
from it (`v${version}`, `uint${bits}`, fail-closed). The receipt returns
that constant. One sentence, one codec, no drift.

Discarded this round: a second verify sentence on `/proof` (that page is
the SPV of a seal, a different door — Huffman: do not teach the same
chain twice in a louder copy); claiming the system is now "perfect"
(Fano: detect + HALT is the honest ceiling, not zero bugs).

---

## Council round 15 — the certificate is the sentence; the tip is never a name

Mandelbrot: the receipt carried `verify`. The certificate itself did
not. `/tx/<hash>` JSON carried `paidBinding` and pointed at the receipt
— a stranger hitting the tx door missed the sentence unless they took
a second hop.

Same object, same constant: `paidBindingView` now includes
`verify: PAID_BINDING_VERIFY`. Every door that already handed the
certificate (API, receipt, tx JSON) now hands the sentence. No second
string.

The other silent fork at this zoom: `tip.payload` looks like
`sealed.payload`. `sealed` is null or a covering name. The tip is a
preview of `/anchor/payload` (journal seq as height until a seal
lands). Without `named: false` it could be read as a fake Bitcoin
name — the same class as the blended-epoch bug. The tip is now
literally `named: false`. Always. The covering name stays on
`sealed`.

Discarded this round: changing `/anchor/payload` to use KRAY block
number (would orphan the live preview contract the itest pins); a
second verify field on the tx JSON beside `paidBinding.verify`
(Huffman).

---

## Council round 16 — the page reads the object; a refused certificate never 404s

Two remaining forks at this zoom:

1. `/tx/<hash>` JSON already carried `verify` and `tip.named: false`.
   The custody page taught Binding + ceiling and ignored both. The page
   now reads `paidBinding.verify` and names the tip as a preview.

2. `paidBindingOf` swallowed codec refusal (`catch { return null }`).
   A height past u32 or a bad root became "no such event" — a lie.
   The catch is gone. Refusal propagates (the server's outer door
   answers 400 with the codec reason). Missing seq is still null → 404.

Discarded this round: the ship ritual (commit / push / writer) — that
is a Creator phrase, not this brick; a louder `/proof` page.

---

## Council round 17 — revise the pins on the page (Huffman)

The custody card taught the law twice: Binding + ceiling as steps,
then the whole `verify` sentence as a fourth checkmark (a louder
copy of 1+2). The auditor record could print "named on Bitcoin" if
`tip.named` were ever truthy — a pin that can lie.

Revised, from the object, once:
- steps: chain, ceiling fields, tip-as-preview (`named === false`)
- `verify` once, as the how-to label under the buttons
- the record prints "preview" unless `named === true`, in which case
  it says refuse (the tip cannot be a covering name)
- an error that is not "no such / not found" is labelled "the node
  refused", never a fake 404

Discarded this round: forcing `docs.html` node ↔ kray-web to be
byte-identical (different mouths, same law); ship.

---

## Council round 18 — the act survives a refused certificate

Flow pins, stranger path: profile activity → `/tx/<hash>`. Round 16
deleted the silent catch so a codec refusal would not 404 as "no such
event". That over-corrected: the throw took the **whole** `/tx` and
`/receipt` with it. A real fold-seal (or donate) vanished because the
49-byte name could not encode.

`paidBindingOf` now returns `{ refused, reason, … }` on codec refusal.
`GET /paid-binding` still 400s (the certificate door stays fail-closed).
`/tx` and `/receipt` still return the act. The page says the certificate
refused and **the event still stands**.

Discarded this round: killing the event page to prove the codec is
honest (the honest thing is two doors); ship.

---

## Council round 19 — the refusal is on the object (one mouth)

The refuse-vs-missing split lived only in `server.mjs` — a second
mouth that a test on the HTML template could not break. Supreme
proof: `certificateOrRefuse` sits next to `paidBindingView`. A height
past u32 or a malformed root returns `{ refused, reason }` from the
same module. The door calls that function. TC-09 actually throws the
codec and asserts the act is not "missing".

Discarded this round: keeping the catch as server-only folklore
(unprovable); a mock HTTP 400 as a substitute for the codec break.

---

## Council round 20 — THE CERTIFICATE DOOR (200 / 400 / 404)

`certificateOrRefuse` named the object. The HTTP mapping still lived
as two `if`s in `server.mjs`, and the itest swallowed status
(`jget` → `.error` only). Missing and refuse could collapse.

`certificateDoor` sits next to that object. Three statuses, never
mixed: live → 200, codec refuse → 400, missing → 404. The server
calls the function. TC-10 breaks the codec and asserts the three
cannot collapse. The gauntlet repeats it across seeds. The itest
locks HTTP 404 on a missing seq and HTTP 400 on a non-integer —
over the wire, not a regex on the HTML.

The act doors (`/tx`, `/receipt`) still do not use this mapping:
a refused certificate attaches; the event stands.

Discarded this round: a force-refuse query on the live node (a hole);
changing `/anchor/payload`; ship.

---

## Council round 21 — the door on the page a stranger reads

Mandelbrot: walkable at the object-ruler is not walkable at `/docs`.
The table still taught only the happy certificate. A 400 could be
read as “the event is gone.”

The same law, one sentence: `200` live · `400` codec refuse · `404`
missing; `/tx` and `/receipt` still show the act. Node docs and
public docs (same law, not byte-identical). The itest locks those
phrases on `/docs`.

Discarded this round: a new docs section (louder copy); forcing the
twins identical; ship.

---

## Council round 22 — two objects, never mixed

`/docs#receipt` put `GET /receipt` and `verifyReceipt(receipt)` in one
pipeline. A stranger saving the HTTP JSON would watch the protocol
function reject it. Same class as blending `sealed` and `tip`.

The HTTP receipt is the **act + the Binding name**. `verifyReceipt`
walks a v1 `KrayReceipt` (merkle bundle). Protocol never imports
`paid-binding.ts`. A refused name does not invalidate the event.
TC-11 locks the two modules apart. The itest proves
`verifyReceipt(httpReceipt).valid === false`.

Discarded this round: rewriting `GET /receipt` into a v1 bundle
(would collide with the live `proof` object contract); teaching
`/proof` Binding (different door); ship.
