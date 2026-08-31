# ETERNIZE — the eternal door

> Status: **HELD** (Creator, 2026-08-31). Lab exams exist. The living world
> does not offer this door (`ETERNIZE_OPEN = false` on the star page).
> Not a Signet/main rite. Resume: `kray-dev` `references/eternize.md`.
> Two acts, two facts: **blessing = possession**. **eternize = availability**.
> They compose; they never fuse. The living floor does not wait on this door.

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
| `from` | the star owner who seals — see "who may call" |
| `star` | the star number being eternized |
| `l1InscriptionId` | `<64-hex reveal txid>i<index>` (`ORDINAL_ID_RE`) — the reveal, not the satpoint (sats move; the reveal does not) |
| `eternalProof` | `ProvenTx[]` bundle — raw reveal tx + BIP-37 merkle block + header chain (the same bag shape as a rune deposit) |
| `nonce`, `signature`, `publicKey` | the usual signed-act envelope |
| `fee` | exactly `MIN_FEE` (1 ₭) → Treasury. No mint, no burn — the L1 miner fee was the sacrifice, and it happened on Bitcoin |

**Who may call: the owner, only.** `from` must be `star.owner` at the
door and again in the reducer — a rule in one place is a hole. The
reveal must have **paid that eternizer's script** (`paidScriptHex ===
scriptOfAddress(from)`). Owner changes later; this line does not chase
them. A clone of the same bytes born to another key is false. After
the seal, the star is already eternal — anyone else who tries is
refused. Tag 5 is a label, never this gate. After a sale with no seal
yet, the new holder must carve to themselves; the previous birth
stone cannot bind.

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
6. `verdict.paidScriptHex === scriptOfAddress(from)` — the reveal
   output that received the inscribed sat **was paid to the owner who
   seals**. Not "whoever owns the star later." A clone paid to another
   key cannot bind. Bitcoin still allows the clone to exist; the book
   will not wear it.
7. Fee gate: signer holds ≥ 1 ₭; exactly 1 ₭, never more.
8. **Mutate atomically:** fee → Treasury; the star gains
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
- A stranger binding the star by carving the same bytes on Bitcoin
  first, or by injecting an `eternize` into their own node. The
  writer journal is the book; `requireSig` + owner + paid-to-`from`
  refuse both. A private fork is not this cascade.

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
OR after a sale (the new owner, once); a cold replay re-proves the
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
  star · missing star · fee ≠ 1 · second binding · stranger inject.
  Proven: owner-only seal, ownership frozen, 1 ₭ → Treasury, cascade
  folds it, cold replay re-verifies the SPV bundle byte-exact.
- **S2 — door + desk: HELD** (2026-08-31). Code and exams remain. The living
  star page does not offer the two buttons (`ETERNIZE_OPEN = false`).
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
4. Sign the 1 ₭ seal. The star gains `⚓ eternal`. Only the holder
   may pay that seal; ownership does not move.

Blessing a parent to birth a child is a different button, a different
fact. If the child's body *is* that ordinal's body, the same reveal bag
can later eternize the child — two signatures, two slots, one stone.

The user runs **bitcoind + KRAY follow**. Consensus never asks `ord`.
A satpoint is a lantern (wallet, explorer, or KrayScan) so the blessing
can start its walk; the walk itself is raw Bitcoin.

## Discarded branches (bifurcation echo)

- **Anyone-may-prove eternize** — a stranger could carve the same
  bytes and bind the owner's star (or lock it, if a later bridge
  rides the stone). Creator reversed this (2026-08-31): owner-only
  at door and reducer. Metadata is not the lock.
- **Chase the current holder after hops** — owner changes many times;
  eternize is one instant. The birth script must be the eternizer's,
  not "whoever holds the sat now." A later buyer cannot wear the
  previous owner's stone; they carve to themselves or they do not
  seal. Tag 5 / a pubkey in metadata is forgeable — the reveal
  `scriptPubKey` is the check.
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
