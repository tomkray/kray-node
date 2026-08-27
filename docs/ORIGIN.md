# THE ORIGIN — KRAY child inscriptions under a Bitcoin L1 Ordinal parent (a collection)

> **Status: LAW IN THE REDUCER.** A KRAY child of an L1 ordinal exists only when
> the journal carries `originProofs` 1:1 with the signed origins, the reducer
> re-derives `proveParentControl` from those bytes (Supreme Law + A5/A10), Casey
> provenance spends the parent sat once per child (`hops ≥ 1`, blessing txid
> unique), and the live door adds two unspent eyes that replay does not re-ask
> (A3). `parentTip` exists on `ControlOptions` and is **not** the ownership
> theorem. This document is the law they obey: **proven from bytes, enforced
> twice, re-provable from the journal, fail-closed.**
>
> **The model: Casey collection.** A Bitcoin L1 ordinal is the PARENT; a KRAY
> child is a NEW inscription with its own content. Many children may descend
> from one parent — each child costs one L1 spend of that parent's sat (send-to-self
> / last receive). Only the author whose blessing UTXO pays their address, and
> whose sat walks back to the reveal envelope, may father that child.

The rule this document is written under: **a user should never have to trust
anyone about the Bitcoin facts a KRAY collection rests on.** What origin proves —
that the parent ordinal EXISTS on Bitcoin, and that the child's author CONTROLS it
— anyone can check. SPV cannot see a mempool sale; the live door asks this
node's UTXO set (`gettxout`, mempool included) when the holder block is this
Bitcoin. Replay does not re-ask — an old child stays after a later sale.

## 0 · The one technical fact that shapes everything

Runes live in an `OP_RETURN` — a rune deposit is provable because `parseTx`
already hands the output scripts to a decoder. **Ordinals do not.** An inscription
lives in the **Taproot script-path witness** of its reveal transaction, inside an
envelope:

```
OP_FALSE
OP_IF
  PUSH "ord"              # the protocol marker (0x03 6f 72 64)
  PUSH 0x01 PUSH <type>   # tag 1 = content-type
  PUSH <other tags…>      # pointer(2), parent(3), metadata(5), content-encoding(9)…
  OP_0                    # empty push — the body separator
  PUSH <body chunk 0>     # content, split across pushes (each ≤ 520 bytes)
  PUSH <body chunk 1>
  …
OP_ENDIF
```

`verified` — this is `ord`'s canonical envelope (`ordinals-encoding.md`; `ord` is
normative). The inscription id is `<reveal_txid>i<N>`, N the inscription index in
that tx (0 for the first). The envelope sits in an **unexecuted branch**
(`OP_FALSE OP_IF …`), so it never affects the spend's validity — the content is
carried, not run.

`verified` — `protocol/inscription.ts` walks the envelope from raw witness
bytes (the counterpart of `runestone.ts`). `parseTx` still computes the segwit
txid from those bytes; the origin walk keeps the witness long enough to read
tags 1 (type) and 2 (pointer).

`verified` — origin **reads existing** L1 inscriptions; it never creates one.
Therefore BIP-110's proposed rule against executing `OP_IF` in Tapscript
(`bip110-tapscript.md`) — which would block *new* inscriptions — does **not** limit
origin: a historical reveal transaction is already mined, and parsing its bytes is
unaffected by any future policy. Origin can import an ordinal that could no longer
be inscribed today.

## 1 · What origin is — and what it deliberately is NOT

Origin inscribes a KRAY **child** under a Bitcoin L1 ordinal **parent** — a
collection. It is:

- a **new KRAY inscription** with its own content, created here, exactly like a
  native inscribe — plus a proven link to its L1 parent;
- a **separate event kind** (`origin`); the L1 parent rides in the inscription's
  `origin` field, **never** the star family-tree `parent` field — that is
  KRAY-internal lineage, a different axis;
- authorised by a **BIP-340 signature** of the child's author (A9: nothing enters
  without a signature — the foundation that became solid once the last unsigned path
  was closed);
- gated by **`originProofs` in the event** — the reducer calls
  `verifyOriginProofs` / `proveParentControl` (`ordinal-ancestry.ts`); a signed
  origins list without the bag never applies (live or replay);
- **not custody.** The L1 parent is not escrowed. Many children may descend from
  one parent after **one** send-to-self (Casey hop ≥ 1), like one L1 reveal with
  many envelopes. Each child has a distinct `originBind` =
  `sha256(domain|net|l1|holder|vout|offset|contentHash)`. The live door still
  refuses if that holder UTXO is spent (a sale).

## 2 · The honest line — proven vs. asserted (the heart)

**PROVEN from Bitcoin bytes — refuse or HALT if any fails:**
1. the PARENT's reveal transaction exists and is buried ≥ `ORIGIN_CONFIRMATIONS`
   deep — `sha256d(rawTx) → merkle(txoutproof) → header chain`, **every header
   weighed by PoW** (`checkProofOfWork`, cumulative work ≥ `MIN_BLOCK_WORK[net]`);
2. that tx's witness carries an `ord` envelope at the claimed index, so the parent
   `inscriptionId = <txid>i0` is a real Bitcoin ordinal, not a claim;
3. **the author controls the parent sat as of the blessing burial** —
   `proveParentControl`: envelope at `iN` (pointer = landing sat; no pointer +
   `i0` = sat 0; no pointer + `iN≠0` = refuse), then the sat is followed
   backward through SPV-proven hops to a holder UTXO that pays the author's
   address. Casey: `(hops ?? 0) < 1` is `parent-not-spent` — the reveal sitting
   still is not a child. One blessing fathers many children (unique content).
   A later owner who received the sat blesses with a **new** spend. There is no
   0-hop remint and no `parentTip` registry in the ledger.
4. the child's author signed the origin / inscribe message — every field of the
   child, so none is wire-mutable after signing.

**ASSERTED — what SPV cannot settle, named and closed at the live door:**
- SPV cannot prove a UTXO is still unspent. Replay therefore does **not** re-ask
  unspent (A3: an old child stays after a later sale). The **live** door asks
  this node's `gettxout` (mempool included) when the holder header is **this**
  Bitcoin, and on main a second eye: KRAY API outspend + satpoint. A pending
  sale cannot also be the blessing. Lab fixture bags whose headers are not this
  chain are not invented as spent.
- The child's own content is new KRAY content, signed and byte-unique here.

The phrase the UI and the record carry, verbatim: *"This inscription descends,
provably, from L1 ordinal `<parentId>` — that parent's reveal is buried in Bitcoin
and its satoshi was, as of block N, held by this author. The child's own content
was created on KRAY."*

## 3 · The three proofs

### Proof 1 — EXISTENCE: the PARENT is a Bitcoin fact
A child is claimed with a bundle proving its parent:
```
originBundle = { rawTx, txoutproof, headers[] }         # the PARENT's reveal, ProvenTx shape
  txid  = sha256d(rawTx)                                 exactly these bytes
  txid ∈ merkle → header, headers chain, each PoW-weighed buried ≥ N
  envelope decoded from rawTx's witness → parent inscriptionId = <txid>iN
```
A node that cannot parse the envelope or verify the burial **refuses** — no child
descends on doubt. `proofHash = bundleHash(originBundle)` is committed in the event;
the bytes live in an injected oracle (`inscriptionProofOf`, peer of `runeProofOf`),
re-proven on every replay. The child's OWN content is new KRAY content — signed and
byte-unique here, never on Bitcoin, so it is not proven, by design.

### Proof 2 — CONSENT: the child is signed
`verifySignature` over `originMessage(...)` — a child nobody signed never enters the
chain (the discipline the `bridge` and `inscribe` cases share).

### Proof 3 — MANY children, ONE blessing
Many children may descend from one L1 parent after **one** send-to-self
(sating / Casey: one parent input, many envelopes). Each child carries the
same SPV bag (or a v6 cohort root) plus a distinct `originBind` derived from
that bag and its `contentHash`. A sale is closed at the live door (`gettxout`).
Each child's content is byte-unique on KRAY (`contentSeen`) (A5).

### Assemble — `POST /api/kraynet/origin-proof`
The client does not invent hops. Body `{ from, parentId, satpoint }`
(`txid:vout` or `txid:vout:offset`). The node walks the sat from the blessing
satpoint back to the reveal via `satHopBack` + `spvProofFor`, then
`verifyOriginProofs` + the two live eyes. Explorer inscribe / profile attach
the returned bag to prepare/submit. The same bag fathers every file in a
folder. The blessing must exist on **this** bitcoind and be buried under
`donationProofMinConf` (Signet/testnet = 2, main = 6, regtest = 1); a 0-conf
or 1-conf blessing is not a bag (`tx-shallow`). A fixture bag is for exams, not
for this endpoint. The wallet does not yet build the send-to-self PSBT — the
user (or a later slice) supplies the satpoint after the L1 spend.

## 4 · The envelope parser — `protocol/inscription.ts` (the one new primitive)

`proposal` — a pure module, peer of `runestone.ts`, no I/O. Compatibility reasoning
(design-resilient-runes; never collapse the layers):

| Layer | Verdict | Note |
| --- | --- | --- |
| Consensus | valid | the reveal tx is already mined; parsing bytes needs no consensus opinion |
| `ord` recognition | **must match** | the parser has to reproduce `ord`'s envelope rules exactly, or it will disagree with the canonical id/content — this is the layer that matters |
| Relay / miner | n/a | origin reads history, never broadcasts |

The parser must: (a) make a witness-retaining tx reader (extend `parseTx` or add a
peer); (b) locate each `OP_FALSE OP_IF "ord" … OP_ENDIF` envelope in the tapscript;
(c) read tags (content-type tag 1 at minimum; handle unknown odd tags as ignorable,
even tags as significant, per `ord`); (d) concatenate body pushes after the empty
separator into `C`; (e) enforce push bounds (each ≤ 520 under current Tapscript)
and index multiple inscriptions per tx as `iN`. `inference` — content-encoding
(tag 9, e.g. `br`) affect what `ord` reports; v1 refuses an encoding it does not
handle. Pointer (tag 2) is kept: it names the inscription sat. Never guess.
Differential-test the parser against a real `ord` on mainnet inscriptions, exactly
as `scripts/rune-diff.mjs` tests the runestone decoder.

## 5 · The new event — the A3-safe insertion (seven places, changed together)

A new kind is forward-incompatible by design: an old node **freezes** on the first
`origin` event (A3, fail-safe not fail-fork), upgrades, resumes. The three places
that MUST change together are the union, the two reducer switches, and the
forward-compat test.

1. **Union** — add `'origin'` to `KrayEventKind` (`ledger.ts`).
2. **Fields** — on `KrayEvent`: reuse `outpoint` (`txid:vout` of the reveal) and
   `proofHash`; add `l1InscriptionId`, `star`, `contentHash`. Signature fields
   (`publicKey/signature/scheme`) already exist.
3. **Ledger reducer** — `case 'origin'`: validate fields → `verifySignature` over
   `originMessage` (covers parent id, star, child content, type, size, nonce) → gate
   on `inscriptionProofOf` (bytes off-chain) → `bundleHash(bundle) !== proofHash`
   refuses → `proveInscription` on the PARENT refuted ⇒ **HALT** → parsed parent
   `inscriptionId` must equal the event's ⇒ else HALT. NO spent-set: many children
   per parent. The child's own content is not cross-checked (it is new KRAY content).
4. **Message** — `originMessage(net, addr, parentId, star, childContentHash,
   contentType, size, nonce)` in `scheme.ts`, `kray-core.origin.v1|…`.
5. **Append method** — `ledger.origin(…)`, peer of `bridge()` / `inscribe()`.
6. **Star map reducer** — `case 'origin'`: inscribe the CHILD's content onto the
   star exactly as `inscribe` does (`tattoos`/`tattooedStars`/`contentSeen`/
   `inscriptionById`), respecting A5 (no re-inscription) and byte-uniqueness, and
   record the parent link in **`Inscription.origin: { l1InscriptionId, l1Txid }`**.
   Never touch `parent`.
7. **Forward-compat** — update `forward-compat.test.ts` expectations and pin the new
   merkle roots (`ledger.merkleRoot`, `starMap.merkleRoot` fold in the new state).

## 6 · Adversarial validation — every attack becomes a permanent test (`test/origin.test.ts`)

- a parent id Bitcoin does not show (proof refuted / wrong id) ⇒ HALT;
- SPV bundle with an invalid-PoW header or a free (unmined) header chain ⇒ refused
  (the hole `9d0a268` closed for runes);
- a parent buried shallower than `ORIGIN_CONFIRMATIONS` ⇒ HALT;
- consent by a non-signer / a signature from another key ⇒ refused at the door;
- **many children under one parent** ⇒ ALL bind (that is the collection — there is
  no once-only);
- a child whose content already lives on L2 ⇒ byte-uniqueness curses it (first
  writer wins), exactly like a native inscription;
- an envelope whose tags the parser does not handle ⇒ skipped, never guessed;
- **reboot**: replay re-proves every parent from bytes; balances and the cascade
  root are byte-exact; a node without the proof bytes still replays (it trusts the
  writer on that layer, as it does for rune deposits — named in §8).

## 7 · Build order — one session, each step proven before the next leans on it

1. `protocol/inscription.ts` — the pure envelope parser (+ witness-retaining reader).
2. `test/inscription.test.ts` — the parser's attacks, plus a differential run vs `ord`.
3. `protocol/inscription-proof.ts` — `proveInscription`, SPV + PoW + envelope, refuses by name.
4. The `origin` event — the seven insertion points of §5, `case 'origin'` mirroring `rune-deposit`.
5. `test/origin.test.ts` — §6, and the reboot/replay proof.
6. Endpoints — `POST /api/kraynet/origin` (verify-before-write, store the bytes), read via the existing `/r/inscription/<id>`.
7. Interface — the "bring my ordinal" flow, showing INHERITED and ASSERTED side by side. The honesty is the product.

## 8 · The residue, named — what is proven now, and what remains

Existence, consent AND **control** are proven from bytes (§2, `ordinal-ancestry.ts`).
The squatting hole an earlier draft carried is **closed**: a stranger cannot add
children to a parent they do not hold. What remains, named honestly:

1. **Casey provenance (ord handbook).** A child exists only if the parent sat
   is spent as an input of the blessing tx (send-to-self). hops < 1 is
   refused (`parent-not-spent`). That blessing txid is consumed once per child
   — reuse is a double-spend of the proof. A pending L1 sale already spends
   the same sat, so it cannot also be the blessing. Official spec:
   https://docs.ordinals.com/inscriptions/provenance.html
   Two live eyes (`gettxout` + KRAY API outspend/satpoint) still refuse a
   spent holder. Replay re-derives the blessing set; it does not re-ask unspent.
2. **The reveal must carry an envelope at `iN`.** `inscriptionAt` on the reveal
   bytes — no envelope is `no-inscription`. Pointer (tag 2) lands on that sat;
   no pointer + `i0` lands on sat 0; no pointer + `iN≠0` is `bad-parent-id`
   (sequential assignment is not guessed). Multi-envelope reveals are indexed
   as `iN`; a missing index is refused, not guessed.
3. **Optional richer bindings later**: escrowing the L1 ordinal into a vault (the
   `vault.ts` shape) to make a KRAY star the redeemable holder is a different,
   heavier feature — the rune-bridge trilemma corner — not needed for collections.

The floor is honest and real: **descent proven, and only the owner fills the
collection.**

### Named residues an adversarial review surfaced (v1, on purpose)

- **`proofHash` is not in the signed message** (same as `rune-deposit`). The id,
  star, content hash, type and size ARE signed, so a stripped proof can never bind
  a *different* inscription than the signer meant — it can only skip the on-replay
  existence re-check on a node that holds the oracle, downgrading "re-proved on
  every replay" to "trust who wrote it." That is the single-writer residue already
  named in `PROOF-COMPARISON.md`, not a new one; the journal hash-chain still makes
  any post-write change detectable.
- **The endpoint must persist the proven content bytes.** The reducer pushes the
  content *hash* to the atlas; the bytes come from the proof (`verdict.content`).
  Until `POST /api/kraynet/origin` stores them in the content store, a custody
  challenge over an origin index reports `hit-unreadable` and is refused at the
  door — fail-closed, and replay exempts it from HALT, so it never breaks
  consensus; it only means guardians cannot yet prove custody of origin content.
  The endpoint closes it by storing `verdict.content` before appending.
- **The parser keeps content-type, body, and pointer.** Parent, metadata,
  content-encoding, delegate, and unknown even tags are still skipped — those
  remain a per-tag widening, each gated by a differential test against a real
  `ord`. Pointer is not skipped: it is the landing sat in `proveParentControl`.

## Primary sources

- The rune bridge this mirrors: [`BRIDGE.md`](BRIDGE.md)
- The KRAY anchor / SPV layer reused: [`anchor-spec.md`](anchor-spec.md), `apps/kray-core/src/anchor/spv.ts`
- The rune decoder this parallels: `apps/kray-core/src/protocol/runestone.ts`
- Inscription id and the no-re-inscription law: `docs/AXIOMS.md` (A5, A10), `apps/kray-core/src/protocol/starmap.ts`
- Envelope structure & BIP-110 interaction: the `design-resilient-runes` skill (`references/ordinals-encoding.md`, `references/bip110-tapscript.md`)
- [Ordinals inscription format](https://docs.ordinals.com/inscriptions.html) · [`ord`](https://github.com/ordinals/ord)
