# 🗺️ THE MAP OF THE BYTES — how every thing in KRAY.NETWORK becomes a hash, a Merkle, and a fact on Bitcoin

> _A mental map of the one pipeline every act travels: **human intent → canonical bytes → a SHA-256 hash →
> the cascade root → 49 bytes on Bitcoin.** If a stranger cannot re-derive it from these bytes alone, it did
> not happen. This is not a metaphor — every string and offset below is the real code (`scheme.ts`,
> `store.ts`, `ledger.ts`, `cascade-root.ts`, `anchor/anchor.ts`)._

Everything in KRAY is **text turned into bytes turned into a hash**. There is no database row that is "the
truth" — the truth is a chain of SHA-256 hashes anyone can recompute. Value moves only when the bytes say so.

---

## The five rings — from a wish to Bitcoin

```
   ┌─ RING 1 · THE MESSAGE ─────────────────────────────────────────────────────┐
   │  a human intent → ONE canonical, domain-separated, network-labelled string │
   │  "kray-core.transfer.v1|net=signet|from=tb1p…|to=tb1p…|amount=5|nonce=7"    │
   │  → the wallet BIP-340 Schnorr-signs THESE EXACT BYTES (never a hidden blob) │
   └───────────────────────────────┬────────────────────────────────────────────┘
                                    │  signature proves "the key owner meant this"
   ┌─ RING 2 · THE EVENT + THE HASH-CHAIN ──────────────────────────────────────┐
   │  the signed act becomes a journal event {seq, prevHash, …fields…}          │
   │  hash = sha256( prevHash + canonical(body) )   ← each event chains the last │
   │  → tamper one byte of one old event and EVERY later hash changes            │
   └───────────────────────────────┬────────────────────────────────────────────┘
                                    │  the reducer folds the event into state
   ┌─ RING 3 · THE SUB-ROOTS (each subsystem's committed bytes) ────────────────┐
   │  money → balanceRoot   stars → starsRoot   pot → potCommitment             │
   │  runes · contracts · amm · seals · Ӿ-book …  each = sorted text → its bytes │
   └───────────────────────────────┬────────────────────────────────────────────┘
                                    │  sequential SHA-256 over all of them
   ┌─ RING 4 · THE CASCADE ROOT (one 32-byte hash = the WHOLE network) ─────────┐
   │  cascadeRoot = sha256( "kraynet\n" + seq + emitted|burned + money + stars  │
   │                        + pot + …every present part, append-only… )         │
   └───────────────────────────────┬────────────────────────────────────────────┘
                                    │  written into a single Bitcoin output
   ┌─ RING 5 · THE ANCHOR (49 bytes on Bitcoin L1) ─────────────────────────────┐
   │  OP_RETURN  "KRAY.NETWORK"(12) version(1) blockNumber(4 BE) cascadeRoot(32) │
   │  → Bitcoin's proof-of-work now timestamps + orders the whole KRAY state     │
   └────────────────────────────────────────────────────────────────────────────┘
```

Each ring **only consumes the bytes of the ring below it** — so anyone, with nothing but the journal and
Bitcoin, walks the rings backward and re-derives every byte. That walk *is* the security.

---

## RING 1 — THE MESSAGE: intent becomes ONE canonical string

Nothing is ever signed as an opaque blob. Every action has a **message builder** in `scheme.ts` that turns it
into a single, human-readable, deterministic string. Three properties make it safe:

- **Domain-separated** (`kray-core.transfer.v1` vs `kray-core.burn.v1`) — a signature for one act can never be
  replayed as another. A ₭ transfer signature can never move Ӿ, and a burn has no `to` at all.
- **Network-labelled** (`net=signet`) — a signet signature can never act on mainnet.
- **Every field pinned** — `from`, `to`, `amount`, `nonce`. Change one character → a different message → the
  signature no longer verifies.

```
transfer  →  kray-core.transfer.v1|net=signet|from=tb1p…|to=tb1p…|amount=5|nonce=7
burn      →  kray-core.burn.v1|net=signet|from=tb1p…|amount=100|nonce=43         (no recipient — ₭ dies)
inscribe  →  kray-core.inscribe.v2|net=signet|from=…|contentHash=<sha256>|contentType=…|size=…|nonce=…
```

The **wallet BIP-340 Schnorr-signs the UTF-8 bytes of that exact string.** The signature is the proof that the
private-key owner authorized *precisely this*, and only the client ever holds the key. **This is Supreme Law
clause 1: signature.**

> The `contentHash` above is itself a SHA-256 of the actual content — a 10 MB video and a one-line poem both
> become 32 bytes here. The bytes ride the chain (integrity, forever); the raw content lives off-chain in the
> atlas (availability). The hash is the handle.

---

## RING 2 — THE EVENT + THE HASH-CHAIN: bytes that cannot be un-said

The signed act is journaled as an event with a sequence number and TWO hashes (`store.ts`):

```
hash = sha256( prevHash + canonical(body) )
```

- `canonical(body)` is the event's fields serialized in ONE fixed key order (so two nodes always produce the
  identical bytes — no drift).
- `prevHash` is the previous event's hash. So the journal is a **hash-chain**: every event's hash depends on
  the entire history before it. Rewrite one byte of event #12 and events #13…#∞ all get different hashes —
  the forgery is visible to anyone who recomputes.

On boot, a node **re-reads the whole journal and re-verifies the chain** — `prevHash` links, every signature,
every economic precondition — before it trusts a single byte. **This is Supreme Law clause 2, half one:
enforced at REPLAY, not only at the door.** A cold machine with just the journal re-derives the identical
state, or it HALTs. Nothing is "remembered"; everything is re-proven.

---

## RING 3 — THE SUB-ROOTS: each subsystem commits its bytes

The live state is not stored as a blob — it is **re-derived into a small committed value per subsystem**, each
built the same honest way: **take the entries, SORT them (deterministic order), join as text, and that text
(or its SHA-256) is the commitment.** Example — the money book (`ledger.balanceRoot()`):

```
tb1paaa…:1200
tb1pbbb…:59925          ← every non-zero balance, address-sorted, one per line
KRAY_TREASURY:7
|emitted:60000|burned:175   ← the supply totals, pinned at the end
```

That exact text IS the money commitment. Any stranger with the journal replays it, sorts the same way, and
gets the byte-identical string — so the number "you have 1200 ₭" is not a claim, it is a **re-derivable fact.**
The same shape builds `starsRoot` (the NFT registry), the `potCommitment` (custody sats book),
`runesCommitment`, `contractsRoot`, the `ammCommitment`, the seal window, and the **Ӿ-book** (`xRootFold` —
sorted `addr:balance` + `|xtotal:N`). Conservation is checked here too: `Σ balances == emitted − burned`, and
`Σ Ӿ == burned` — if a fold ever breaks the equality, the node HALTs rather than commit a lie.

---

## RING 4 — THE CASCADE ROOT: the whole network in 32 bytes

All the sub-roots consolidate into **one** hash — the cascade root — by a **sequential SHA-256** over each
part, in a fixed order (`cascade-root.ts`, `cascadeRootFromParts` — the SINGLE source of truth, so the node
that builds it and the censorship-verifier that opens it can never disagree):

```
h = sha256_stream(
      "kraynet\n"
      "seq:<n>\n"
      "emitted:<E>|burned:<B>\n"
      "money:<balanceRoot>\n"
      "stars:<starsRoot>\n"
      "<potCommitment>\n"
      [ "seals:…"  "qcommits:…"  "qmigrated:…" ]      ← present ONLY if that subsystem folds today
      "runes:<runesCommitment>\n"
      "contracts:<contractsRoot>\n"
      [ "amm:…"  "inclusion:…"  "window:…"  "nonce:…"  "x:…" ]   ← each appended, in this exact order
   )  →  a single 32-byte (64-hex) digest
```

Two laws live in that picture:

- **APPEND-ONLY (axiom A3).** A part is in the stream **only when its subsystem actually folds today.** So a
  history that never used Ӿ, or never activated inclusion, hashes to the *exact same bytes it always did* —
  nothing already anchored on Bitcoin is ever orphaned when the format grows. New capability = a new part
  appended **last**, invisible below its activation.
- **ONE ROOT, ONE TRUTH.** This 64-hex string is the entire KRAY.NETWORK — money, stars, pot, runes,
  contracts, the two lights — pinned to a single value. Change anything anywhere and this changes.

---

## RING 5 — THE ANCHOR: 49 bytes make Bitcoin the witness

The cascade root is written into Bitcoin in one tiny output (`anchor/anchor.ts`) — a payload a block explorer
reads as exactly what it is:

```
OP_RETURN  <push 0x31=49>  "KRAY.NETWORK"(12 ascii)  version(1)  blockNumber(4 BE)  cascadeRoot(32)
```

49 bytes, well under Bitcoin's 80-byte OP_RETURN budget. (There is also a **self-anchor** shape that commits
the same root inside a spendable output's key, for anchors that pay themselves — same 32-byte commitment,
different carrier.) Once that transaction confirms, **Bitcoin's proof-of-work timestamps and orders the whole
KRAY state.** Nobody — not the writer, not an operator — can rewrite history, because rewriting would need a
different cascade root, which would need a different anchor, which would need to out-mine Bitcoin. **This is
Supreme Law clause 3: the Bitcoin anchor.** KRAY cannot fail in a way Bitcoin itself would not.

---

## The round-trip — how a stranger PROVES any single fact

Because each ring only consumes the ring below, verification is the pipeline walked **backward**, trusting no
operator at any step:

```
"Does address X really hold 1200 ₭ at block N?"
  5 ← read Bitcoin block N's OP_RETURN → decode → (blockNumber N, cascadeRoot R)     [Bitcoin PoW vouches]
  4 ← replay the journal up to N; re-hash all parts with cascadeRootFromParts → must equal R  (else lie)
  3 ← inside that, re-derive balanceRoot; find "X:1200"                              [pure re-derivation]
  2 ← the balance came only from events whose hash-chain + signatures re-verify      [no unsigned move]
  1 ← each such event's signature verifies against X's key over the canonical message [X truly authorized]
```

Every arrow is bytes → hash, recomputable by anyone, forever, with **no node alive and no key needed to
verify.** That is why a KRAY follower's banner can say: _"this copy can prove it is the real history to anyone,
forever, with no operator alive."_

---

## The one-line laws to remember

- **Intent is a canonical string; the signature signs the string, not a blob.** (domain + network + fields)
- **Every event's hash = sha256(prevHash + canonical body).** History is a hash-chain; tampering is visible.
- **State is re-derived, then committed as sorted text.** Your balance is a fact, not a record.
- **All sub-roots → one cascade root by sequential SHA-256, append-only.** The whole network in 32 bytes.
- **The 32 bytes go into 49 bytes on Bitcoin.** Proof-of-work becomes KRAY's clock and its witness.
- **Enforced twice — at the door AND at replay — or it is not law.** If a stranger can't re-derive it from the
  bytes, it did not happen.

_Anchor files: `apps/kray-core/src/protocol/scheme.ts` (messages) · `store.ts` (hash-chain) ·
`ledger.ts` (sub-roots, `balanceRoot`/`xRootFold`, `conserves`) · `cascade-root.ts` (`cascadeRootFromParts`) ·
`anchor/anchor.ts` (the 49-byte payload) · full statement in `docs/AXIOMS.md`._
