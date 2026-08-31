# ETERNIZE — the eternal door

> Status: **S1 + S2 BUILT AND PROVEN** (Creator, 2026-08-30). S3 (Signet rite) waits.
> Pipeline: regtest bench → Signet → main, per `OPERATOR-SHIP.md` § The change map.
> Mirror precedent: `ORIGIN.md` (the same door, walked the other way).
> Two acts, two facts: **blessing = possession** (father a child). **eternize = availability** (these exact bytes live on Bitcoin). They compose; they never fuse.

## The one sentence

A voluntary, signed, 1 ₭ act that binds a star to a Bitcoin L1 ordinal
inscription carrying the star's **exact bytes** — proven from raw
transactions, never from anyone's word — so that star's availability
becomes Bitcoin's own: every archival Bitcoin node on Earth carries it.

## Why (the honest gap it closes)

The Supreme Law already guarantees **integrity**: content SHA-256 rides
the signed act, folds through `starsRoot` into the cascade root, and the
root is anchored to Bitcoin. Nobody can falsify a byte without being
caught. What the anchor does not buy is **availability**: the bytes live
in the atlas, replicated by guardians whose custody is proven and paid
(`custody.ts`), not inside Bitcoin blocks. If every KRAY node vanished,
the hashes on Bitcoin would prove what existed but not return the bytes.

Ordinals has the opposite trade: bytes on L1 (availability absolute),
but ~390 KB practical, no 10 MB stars, no uniqueness, no living law.

Eternize makes the trade **per star, by choice**: the atlas stays the
default body (cheap, big, proven custody); the owner of a crown jewel
pays L1 price once and gains Bitcoin-grade availability for that star.
With this door open, KRAY strictly dominates the Ordinals guarantee —
everything it offers (when chosen) plus everything it cannot.

## Axioms this derives from

- **Supreme Law** — signature ‖ Merkle ‖ Bitcoin anchor; a stranger
  re-derives everything from bytes. The eternize proof is an SPV bundle
  the reducer re-verifies on every apply and replay, ADR-1 discipline.
- **A3 (grow-only absence)** — a star that never eternizes hashes
  byte-identically forever; the registry line only *extends*.
- **Self-custody** — the node never spends anyone's BTC. The human
  inscribes on L1 with their own wallet; the act only *proves* it.

## The act

Kind: `eternize`. Canonical message (v1, frozen once shipped):

```
kraynet.eternize.v1|net=<network>|from=<addr>|star=<N>|l1=<revealTxid>i<index>|nonce=<n>
```

Event fields:

| field | meaning |
|---|---|
| `from` | any signer holding 1 ₭ — see "who may call" |
| `star` | the star number being eternized |
| `l1InscriptionId` | `<64-hex reveal txid>i<index>` (`ORDINAL_ID_RE`) — the reveal, not the satpoint (sats move; the reveal does not) |
| `eternalProof` | `ProvenTx[]` bundle — raw reveal tx + BIP-37 merkle block + header chain (the same bag shape as a rune deposit) |
| `nonce`, `signature`, `publicKey` | the usual signed-act envelope |
| `fee` | exactly `MIN_FEE` (1 ₭) → Treasury. No mint, no burn — the L1 miner fee was the sacrifice, and it happened on Bitcoin |

**Who may call: anyone.** Eternity is a fact, not a right. The proof
cannot lie (a false one is refused; a true one is true no matter whose
signature carries it), the act grants no honor and moves no value, so
an owner-only gate would only slow a gift down. Same doctrine as
escrow's `refund`: when mathematics can verify, anyone may knock.

## Reducer verification (pure, offline, in order — refuse before mutate)

1. `requireSig` over the canonical message (network label, nonce).
2. The star exists and **has content** (`stars.isInscribed(N)`); a
   baptism-only star has no bytes to eternize.
3. The star is **not yet eternal** — one binding, first proof, forever.
4. `proveInscription(revealTxid, index, proof, { minConfirmations,
   net })` (`inscription-proof.ts`) — burial under weighed work, txid
   re-derived from the raw bytes, envelope parsed by
   `inscriptionAtLoose`. Depth: the same floor as a rune deposit
   (`donationProofMinConf`), one number, no second climate.
5. `verdict.contentHash === star.contentHash` — **byte-for-byte**. The
   envelope's declared content-type is NOT compared; the hash is the
   identity. A gzip / content-encoding envelope hashes differently and
   is therefore auto-refused by this same line — no decompressor ever
   enters consensus.
6. Fee gate: signer holds ≥ 1 ₭; exactly 1 ₭, never more.
7. **Mutate atomically:** fee → Treasury; the star gains
   `eternal = <l1InscriptionId>`.

A proof that is present but false HALTs the replay, exactly like a
tampered donation proof — a journal cannot contain an eternity that is
not in the bytes.

## What folds into the root

The registry star line (`starmap.ts` `root()`) extends the A3 way,
after `law`:

```
<no>|<owner>|<contentHash>|<name>|<parent>|<origin>…|meta=…|law=…|eternal=<l1InscriptionId>
```

Absent ⇒ the line is byte-identical to today, so every root already
anchored on Bitcoin re-derives exactly. Present ⇒ the binding itself
folds through `starsRoot` into the cascade root and is anchored back
to Bitcoin — the eternity is notarized by the same clock it lives on.

## Invariants (what can never happen)

- A star eternized by an inscription whose bytes differ from its own
  (refusal 5 — and birth-time duplicate refusal means at most one star
  can ever match a given L1 body).
- A second eternal binding on a star, or an "un-eternize".
- Ownership, name, law, lineage, or any ₭ beyond the 1 ₭ fee changing
  because of this act.
- The node signing, funding, or broadcasting the L1 inscription.
- A star *depending* on L1 to be served — the atlas remains the body;
  L1 is the eternal backup, read by humans in a disaster, not by the
  reducer in the hot path.

## Size and cost (the honest border)

v1 covers a single standard-relay envelope: stars up to ~390 KB of
exact bytes. That is every text star, every law, most images and
songs worth carving. A 6 MB star does not fit a Bitcoin block and
does not compress (media is already entropy-coded — measured
2026-08-30: MP3 gzip ≈ 0–1%; text ≈ 61%). Big stars wait for a
chunk-cohort v2 (sha256 chunk list whose root equals a committed
cohort — its own design, not smuggled into v1).

## The stack — origin (blessing) + eternize on one star (PROVEN)

The two acts share the SPV machine but state independent facts, and
they compose without touching each other
(`src/test/origin-eternize-stack.test.ts`, 22/22):

```text
Bitcoin L1                          KRAY
──────────                          ────
ordinal <id> carries BODY   ──①──▶  trunk star born via origin:
(two-hop blessing proves            body = the SAME bytes,
 the author held the sat)           paternity proven in the reducer
                            ──②──▶  eternize the trunk against the
     the SAME ProvenTx              SAME <id>: byte-equality proven —
     (bundle[0]) serves             origin + eternal, one id, two
     BOTH proofs                    slots, dual citizenship
                                    ③ children derive from the trunk
                                      (own bodies, KRAY lineage; NO
                                      eternal inherited — availability
                                      is per-body, never per-lineage)
                                    ④ the trunk sells: owner moves,
                                      origin + eternal ride with the
                                      star (facts about the body)
```

Proven in the stack exam: the child cannot wear the father's carving
(different bytes → refused); a second binding refused; a blessing
theft after the eternize dies the same death; eternize lands before
OR after a sale (anyone, anytime, once); a cold replay re-proves the
blessing AND the carving from the journal alone, same cascade root.

Neither act requires the other: a blessing births children with no
eternize forever; an eternize needs no lineage. When the bytes
coincide, the same proven reveal serves both — one bag, two facts.

## Slices (proof-driven pipeline)

- **S1 — bench (regtest): ✅ BUILT + PROVEN** (`src/test/eternize.test.ts`,
  34/34). Reducer case (`ledger.ts 'eternize'`), registry slot
  (`Star.eternal`, folded into `starsRoot` as `|eternal=<id>`, A3
  line-extension), scheme `eternizeMessage` v1 + signed-message mirror,
  desk index `starOfEternal`. Broken and refused: wrong bytes · tampered
  burial · missing proof · wrong index · malformed id · baptism-only
  star · missing star · fee ≠ 1 · second binding. Proven: stranger-may-
  prove, ownership frozen, 1 ₭ → Treasury, cascade folds it, cold replay
  re-verifies the SPV bundle byte-exact.
- **S2 — door + desk: ✅ BUILT** (server syntax-clean; live Bitcoin is S3).
  `/api/kraynet/eternize-proof` assembles the SPV bag from bitcoind,
  proves the carving locally, and AUTO-DETECTS the KRAY side: the one
  star those bytes could belong to (`starOfContent`) and whether the
  carving is already bound (`starOfEternal` — consensus already forbids
  a second binding; the index only saves a doomed signature).
  `prepare`/`submit` gained the `eternize` action (door mirrors the
  reducer's refusals). The star page shows "⚓ eternal — carved on
  Bitcoin" + explorer link when bound, and the eternize form (id → prove
  → byte-match gate → sign 1 ₭) when not. Blessing stays untouched.
  `origin-proof` may return a `carving` hint from the same reveal bag
  (hash / already-eternal); a hint failure never refuses a blessing.
- **S3 — the rite (NOT YET):** Signet live proof with a real inscription,
  then main per the change map. Consensus and the desk wait here; no
  new act is invented for the rite.

## What a person does (S2, when Bitcoin is on this node)

1. Carve the star's exact bytes as a Bitcoin ordinal (own wallet, own
   BTC, miners paid on L1). The KRAY node never spends.
2. On the star page, paste the inscription id `<txid>iN`.
3. The node proves the carving from bitcoind (no `ord` server). If the
   bytes are not this star's, the wallet never signs.
4. Sign the 1 ₭ seal. The star gains `⚓ eternal`. Anyone may pay that
   seal; ownership does not move.

Blessing a parent to birth a child is a different button, a different
fact. If the child's body *is* that ordinal's body, the same reveal bag
can later eternize the child — two signatures, two slots, one stone.

The user runs **bitcoind + KRAY follow**. Consensus never asks `ord`.
A satpoint is a lantern (wallet, explorer, or KrayScan) so the blessing
can start its walk; the walk itself is raw Bitcoin.

## Discarded branches (bifurcation echo)

- **Owner-only gate** — a provable fact should not need permission;
  discarded for the anyone-may-prove door (refund precedent).
- **Gzip in consensus** — saves fees on text but imports a
  decompressor into the reducer's trusted surface; discarded, the
  hash-equality line refuses it for free.
- **Chunked multi-tx in v1** — real need, separate design; a small
  frame ships proven, a wide one ships late.
- **Node-side auto-inscriber** — the node spending BTC for users
  violates self-custody; the human's own wallet carves the stone.
- **Fuse eternize into blessing** — possession ≠ availability; a child
  with new bytes must not inherit a father's stone. Same bag, two acts.
- **Anchor on the satpoint** — sats move every spend; the reveal txid
  does not. Eternize names `<txid>iN`.
- **Reinscription-as-eternize / as-blessing** — a new envelope is a
  new id and a new L1 fee; it does not replace the 1 ₭ seal nor the
  sat walk. Useful only as a way the holder learns their own satpoint.
- **Require an `ord` server** — verification is SPV + envelope + sat
  arithmetic from bitcoind. `ord` is optional discovery, never law.
