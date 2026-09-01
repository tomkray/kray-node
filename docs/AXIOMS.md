# AXIOMS — the invariant truths of KRAY.NETWORK

Every architecture decision in this repository derives from these axioms. When
requirements conflict, the axiom wins. They are eternal: changing one is not an
update, it is a different network.

## THE SUPREME LAW — everything is proven, nothing is trusted

> **Nothing exists in KRAY.NETWORK unless mathematics proves it.** Every change of
> state is authorised by a signature over a domain-separated, network-labelled
> message — a BIP-340 Schnorr signature (Bitcoin's own), or a NIST post-quantum
> ML-DSA signature — and committed into a SHA-256 Merkle root that consolidates,
> through the cascade root, into the one commitment anchored to Bitcoin. Signature
> ‖ Merkle proof ‖ Bitcoin anchor is the ONLY path a byte of state may ever move.
> If a stranger cannot re-derive it from the bytes alone, it did not happen.

This law stands **above** the axioms below; A0–A10 are how it is spent. It is not a
feature of KRAY.NETWORK — it is what KRAY.NETWORK *is*. Read it, and the whole
system's immutability follows:

- **No path is exempt.** Mint, burn, transfer, transfer-star, inscribe, name,
  origin, opt-in, rune deposit/send/exit/settle, amm-add/remove/swap, amm-rr-add/remove/swap, contract, contract-call, work
  claim, guardian, anchor — every one carries a signature the reducer re-verifies,
  or a Bitcoin SPV proof re-derived from raw bytes, or both. There is no admin key,
  no operator override, no convenience endpoint, no "just this once" that moves
  state without a proof. A door that trusts is a door that will be walked through.
- **Enforced twice, or it is not law — and where it is not yet, we say so.** Every
  rule is checked at the door (the API) AND in the reducer (the replay); a rule
  enforced in only one place is half a rule, and the replay is the verifier. This
  holds **today, proven**, for the SIGNED layer: every user signature, every nonce,
  conservation, the immutable mint cap, once-ever donation crediting, and the
  network gate are all re-derived by a cold reboot from the journal alone. For the
  L1 PROOF layer the machinery is now **built and proven** for all three doors:
  a donation-burn (`KRAY_CONSENSUS_BURN_PROOF`, ADR-1), a rune deposit and a rune
  settle (`KRAY_CONSENSUS_RUNE_PROOF`, ADR-1 extended) may journal their SPV proof
  IN the event, and the reducer then re-proves the peg from bytes on every apply and
  replay — burial under weighed work, the exact outpoint/txid, the runestone
  allocation, and the credit bound to the unique Taproot spender that paid the
  shared bakery pot (read from the deposit's parent txs, hash-bound, never a
  client field). A proof that is
  present but false HALTs the replay (proven: a tampered journal cannot reproduce
  the root). Signet burn-in (2026-08-17) flipped the polarity: the three flags
  (`KRAY_CONSENSUS_BURN_PROOF`, `KRAY_CONSENSUS_RUNE_PROOF`, `KRAY_BACKING_GATE`)
  default ON on every network, including main; force `=0` only to replay a
  proofless or hostage past. The twin rebirth (2026-08-28) closed the first
  honest limit: at/after the PROOF-MANDATORY activation (`PROOF_MANDATORY_SEQ`,
  ledger.ts — signet and main are BORN STRICT at 0) the reducer itself refuses a
  donate / rune-deposit / rune-settle that does not embed its SPV proof, so the
  journal can never contain a mint whose sacrifice is not in it. Regtest keeps
  the bench dev-mint (activation MAX). THE KEYSTONE (2026-08-28, ratified while
  both books held zero transactions) closed the second: at/after
  `RUNE_ANCESTRY_MANDATORY_SEQ` (ledger.ts — signet and main BORN STRICT at 0) a
  rune-deposit must embed its recursive ancestry bundle (rune-ancestry.ts), and
  the reducer re-derives the INPUT STATE itself from bytes — every parent buried
  under weighed work, the allocation law re-run link by link, terminating at the
  rune's own etch (identity proven: BIP-37 position + BIP-34 coinbase height,
  never a claim), at the null prevout (a coinbase creates sats, never runes), or
  at an outpoint an earlier proven deposit in THIS journal already re-derived.
  `inputRunes` stops being ord's word on those networks — on BOTH legs: the
  SETTLE (same activation, same window) embeds the payout's ancestry too, and
  the walk stops at the journal's own accumulated truth (deposits + earlier
  settles' consolidation change), refusing a short delivery and any burn of
  the focused rune. THE MINT-WITNESS LAW (2026-08-31, `MINT_WITNESS_SEQ` —
  signet and main born at 0; regtest stays MAX, lab pin opts in) closes the
  last honest limit without a guess: a mint OF THE FOCUSED RUNE may terminate
  the walk when the entry carries the writer's mint witness (the block's
  coinbase + BIP-37 proof against the SAME header — the etch-identity
  mechanism). Every byte-provable fact stays byte-proven: burial, the Mint
  tag, the BIP-34 height, the window and the amount from the etch's OWN terms
  in the same bundle. Cap-legality — global state no light verifier can
  decide — is the writer's statement, journaled in the event, so replay is
  deterministic (A3). A naked mint, a foreign coinbase, a shut window, or a
  bundle missing the etch still refuse (`needs-index` / `mint-unproven`). The
  law widens acceptance only: every bundle valid before stays valid, so
  pinning it at 0 cannot fork a journal — refused events were never written.
- **Proofs from bytes, never from trust.** SPV re-derivation, BIP-34 coinbase
  heights, BIP-37 merkle paths, taproot control blocks, runestones — all parsed
  from raw bytes and refused loudly on any mismatch. HALT beats a lie applied.
- **This is the security.** Not a firewall, not an audit, not the honesty of any
  operator — *mathematics*: the same signatures and the same Merkle-into-Bitcoin
  proof that secure Bitcoin itself. Hold this law forever and KRAY.NETWORK cannot
  fail in a way Bitcoin would not also fail. Break it anywhere — one unsigned
  write, one unproven mint, one root that never reaches Bitcoin — and the
  guarantee is gone everywhere. There is no partial version of this law.

Any new feature, endpoint, migration or optimisation is measured against this law
FIRST. If it cannot be expressed as *signature + Merkle proof + Bitcoin anchor*, it
is redesigned until it can, or it is not built. Written in stone.

## A0 · The symbol is ₭

U+20AD, one character, in Unicode since 1999. It names the money and prices the
fee in the protocol itself — never in a stylesheet, because a symbol that lives
in the presentation layer can be changed by whoever ships the next page. Bitcoin
has ₿. KRAY has ₭.

## A1 · Conservation or HALT

Σ balances == **emitted − burned**, exactly, after every single event — or the
node freezes. This is the tripwire (`ledger.conserves()`): no ₭ appears from
nothing and none vanishes unaccounted. ₭ is BORN only by **proof-of-burn** — a
real satoshi destroyed at a keyless NUMS address, one ₭ per satoshi, at most
10,000 ₭ per mint (the immutable anti-whale cap) — so the peg-of-sacrifice holds:
total ₭ ever minted ≤ total satoshis ever burned. And ₭ is BURNED back when a
star is born from fire (an inscription or baptism costs 1 ₭, destroyed): the
money supply breathes with real use, uncapped in principle yet backed one-for-one
by sacrifice. No premine, no emission schedule, no halving ladder for ₭ creation.

**The black hole is the corollary, not the exception.** A citizen who wants
something gone forever sends it to `KRAY_BLACK_HOLE`, and it is ENTOMBED rather
than destroyed: the units keep existing, keep being counted in Σ, and lose every
way out. Nothing can leave, for two independent reasons anyone can check — no
public key encodes to that account, AND the reducer refuses to spend from it on
any journal. An entombed star keeps its inscription, its name and its family
tree: visible forever, beyond reach forever. Destroying units instead would
break this axiom and force every future reader to trust a subtraction they
cannot verify.

## A2 · The 1-KRAY fee is immutable

Every action costs exactly 1 KRAY, indivisible. No auction, no MEV, nobody
priced out — in any era.

## A3 · No hard fork, ever

Fail-safe, not fail-fork: a node meeting an event from a future era FREEZES.
There is always exactly ONE Bitcoin-anchored chain.

## A4 · Honor gates money

Glow ✦ is born one way: an address freezes a star to the keyless black hole
and receives one glow. Soulbound — never transferred, never bought. Voice
in a poll is that count (`glowOf`). One frozen star, one unit of honor.
A whale cannot buy the top: there is nothing to buy. Splitting one hand
into many names does not grow the share — every glow still costs a real
star given to the fire (linear in sacrifice, the same Cauchy fact).
The frozen star stays in the atlas; the count is not the whole reputation —
anyone can see what was given.

The validator **fee-pool** is a different pipe: 1-₭ fees already in the book,
share ∝ proven presence — never a second mint of ✦. Do not give those two
the same name.

## A5 · Written stars are relics

An inscribed or named star can never again be spent as gas. Content is
byte-unique in the whole universe; the first writer wins; no re-inscription.
A second claim on the same name or the same bytes is not a star — at/after
the unique-relic pin it is refused before any fire (the Buy fractal); below
the pin a cursed birth may still burn, so history replays byte-identically (A3).

## A6 · Zero dependency, moored to Bitcoin

Home nodes, local truth. The clock, the beacon and the seal are always REAL
Bitcoin blocks — the mainnet mirror at home, the public mainnet tip on the
road, the anchor chain itself offline — by best available provenance, honestly
labelled. No cloud, no company, no operator to trust. Nothing is ever invented:
absent infrastructure shows as absent.

## A7 · Mined KRAY is fuel — the tenant flywheel

A validator's KRAY is not a trophy; it is what gives LIFE to their project.
The cycle that builds the network:

1. **Validate** — do work, earn KRAY from the **linear fee-pool settlement**
   (A4 names the split, not the honor): the 1-₭ fees collected from every action
   are distributed to the validators who proved presence, share ∝ work —
   conserved ₭ that already exists, never freshly emitted. Glow is not mined
   here; it is only born when a star is frozen (A4).
2. **Create** — the validator has a real project with real off-chain
   accounting: credits, drops, claims, receipts. Today that ledger lives in
   the VACUUM — a Supabase, a local script, a private database nobody else
   can verify.
3. **Seal** — the tenant mirrors each vacuum event onto KRAY as an anchored
   attestation, paying the eternal 1-KRAY fee (A2) with the KRAY it mined in
   step 1. The fee flows back to validators; the event becomes public,
   Bitcoin-sealed history.

KRILL is the reference tenant and the proof: a community-mining pool whose
rune drops to participants are driven by validation work — its whole credit
book now lives on KRAY instead of the vacuum, gas-paid with its own mined
KRAY. Every future tenant (RADIOLA, SATSPACE, …) enters the same way. The
network begins with one validator — the founder — and only ever grows.
Tenants are **applications**. The book they seal onto is named in
[`BOOK-AND-APPS.md`](BOOK-AND-APPS.md) — rune L2 / DeFi / pen / federation
are the first of those apps, not a second definition of the node.

## A8 · One root proves everything

The entire network — ledger, stars, the burn-pot, the consumed-seal set, the
rune L2, contracts, and post-quantum recovery commitments — consolidates into a
single 32-byte cascade root, committed to Bitcoin. The **common anchor is the
donation itself**: a burn output pays a taproot key tweaked by the root
(pay-to-contract), so the sacrifice IS the seal, with no operator — and the
fork-choice weighs it by the exact Bitcoin work of an OP_RETURN of the same
root. A human-readable 49-byte `KRAY.NETWORK` OP_RETURN remains the guardian
backstop. Verify that one root against your own replay and you have verified
everything. A backlog costs O(1): one anchor seals all accumulated history.

## A10 · An inscription id is its signed act

`<signed event hash>i<index>` — the same shape and the same semantics as
Ordinals' `<txid>i<index>`. On Bitcoin the txid covers the witness, so the id
derives from the signed transaction; here the event hash is computed over every
field the author's BIP-340 signature covered **and** over the previous event,
so the id cannot exist without the signature that authorised it, nor without
its place in history. Any tampering with any signed field changes the id, and
anyone recomputes it from the journal alone. The `i<index>` suffix leaves room
for a future act carrying more than one inscription without a fork (A3).

Chosen over the alternative — deriving the id from the inscription's own facts
(`sha256(star|contentHash|seq)`) — precisely because that form could NOT
distinguish two acts that differed only in a field it omitted (content type,
parent, nonce). The stronger tamper-evidence wins on a 10,000-year horizon.

## A9 · The address is the user

The identity the system knows is a wallet-held key that re-derives to its own
address — by default a Bitcoin taproot address (BIP-340 Schnorr): your account
IS your address, the same key you already hold. No address, no access: every
write requires the connected address and its signature; even presence (a
validator's liveness beat) is animated only by a session minted from that signed
approval. No username, no email, no password, no server-side key — ever. Reads
stay public: the chain is everyone's.

**Post-quantum accounts** are the additive second form: an account may hold a
NIST **ML-DSA (FIPS-204)** key, addressed as `kq1` + SHA-256(its key), and sign
every action with a many-time quantum-safe signature the reducer verifies exactly
as it verifies a taproot one (the `scheme` field dispatches, fail-closed on any
unknown). A taproot account can also pre-commit a hash of a post-quantum recovery
key and, if a quantum computer ever breaks ECC, rescue its value with a Lamport
signature it alone can produce — see `docs/QUANTUM-READINESS.md`.
