# KRAY.NETWORK — Quantum Readiness

> The honest posture, stated the way the whole network is: no comfort, no overclaim. A system that hid its
> exposure could not be trusted at its core. This is exactly where KRAY stands against a cryptographically
> relevant quantum computer (CRQC), and the staged plan that a *new* network can execute that Bitcoin cannot.

## The one-line verdict

**KRAY is exactly as quantum-resistant as Bitcoin itself — no more, no less — and it is architecturally
positioned to become more, because it is new.** Claiming "quantum-proof" would be a lie; no elliptic-curve
system on Earth (Bitcoin, Ethereum, every wallet) is quantum-proof today. What KRAY *is*: its history,
anchoring, and proof layer are already quantum-durable, and its design has the seams to migrate the
signature layer without stranding a single user or rewriting a byte of the past.

## Two layers, two very different fates

Every guarantee in KRAY rests on one of two cryptographic primitives. They face a quantum computer completely
differently, and separating them is the whole analysis.

### 1 · The HASH layer — SHA-256 — is quantum-DURABLE

A quantum computer attacks a hash only with **Grover's algorithm**, a quadratic speedup: 256-bit security
becomes an effective ~128 bits, which remains astronomically far beyond any reachable computation, this
century or the next. Everything below is secured by SHA-256, and is therefore safe:

| What | Secured by | Quantum status |
| --- | --- | --- |
| The cascade root (the whole network state → one commitment) | SHA-256 | durable |
| The journal hash chain (the past cannot be rewritten) | SHA-256 (`prevHash + canonical(event)`) | durable |
| The Bitcoin anchor (state sealed to L1) | Bitcoin's SHA-256d PoW + merkle | durable |
| The keyless burn address (nobody's key) | SHA-256 of the generator G | durable |
| Beat proof-of-work (validator presence) | SHA-256 leading zeros | durable |
| credited-once, the peg-of-sacrifice, star identity | SHA-256 of outpoints / content | durable |

**Consequence:** a quantum adversary can **never** rewrite KRAY's history, forge an anchor, unbind the burn,
counterfeit the cascade root, or fake proven work. The *ledger's integrity and the entire proof of the past
are quantum-safe.* This is most of what makes KRAY antifragile — and it is already done.

### 2 · The SIGNATURE layer — secp256k1 / BIP-340 Schnorr — is quantum-EXPOSED

A CRQC attacks an elliptic-curve public key with **Shor's algorithm**, which derives the private key from the
public key in polynomial time. KRAY authorizes every user action (transfer, star move, rune send) with a
BIP-340 Schnorr signature over secp256k1 — **Bitcoin's own signature scheme**. So KRAY inherits **exactly
Bitcoin's exposure, no more**: when a CRQC exists, an exposed public key's future *spending authorization* is
at risk. It does **not** put the past at risk (that is the hash layer), and it is the identical problem the
entire ECC world must solve together.

**Honest summary:** history and anchoring — safe forever. Future spending authorization — as safe as Bitcoin,
and no safer, until the migration below.

## Why a NEW network is decisively advantaged

Bitcoin cannot easily fix this: fifteen years of coins sit at addresses whose public keys are already exposed
on-chain, and migrating them needs a soft-fork the whole world must adopt. KRAY, launching now, has three
advantages Bitcoin lacks — two already in the code, one to add.

### A · Crypto-agility is already a seam, not a rewrite — `verified`

Every signed event carries a `scheme` field, and the consensus reducer dispatches on it
(`verifySignature` → `if (scheme === 'kraywallet') …`), **fail-closed on anything unknown**
(`isSupportedScheme`). Adding a post-quantum scheme (NIST FIPS-204 ML-DSA / FIPS-205 SLH-DSA / Falcon) is a
single additive `case`, never a hard fork: old `kraywallet` events keep verifying byte-identically, new
events can be signed by a PQC key, and the address binds to that key exactly as it binds to a taproot key
today (`verifyKrayWallet` re-derives the address from the key — a PQC scheme re-derives from `H(pqc_pubkey)`).
This is designed-in, not retrofitted — pinned in `quantum-agility.test.ts`.

### B · The past is hash-sealed, so migration loses nothing — `verified`

Because the whole history is committed to Bitcoin by SHA-256, activating a PQC scheme at some future block
does not endanger anything already sealed. Balances, stars, runes and the pot are all re-derived from a
quantum-durable journal; only the *keys that authorize new actions* change form. Nobody loses history, and
no anchor is invalidated.

### C · Hash-committed quantum recovery + the escape hatch — `verified` (built, proven, additive)

**Built and proven.** An account registers `commit = SHA-256(Lamport public key)` via the `quantum-commit`
event (a hash — quantum-safe today), signed under its current ECC key while ECC is still secure. When needed,
it invokes the **quantum escape hatch** (`quantum-migrate`): it reveals the Lamport public key and one
**Lamport signature** (a real, hash-based, quantum-safe one-time signature — Leslie Lamport 1979, the
primitive under NIST SLH-DSA), and the reducer verifies `SHA-256(revealed key) == commit` and the Lamport
signature over the migration message, then moves the account's ₭ to a fresh address. This is authorized by the
**Lamport key ALONE — deliberately not the ECC key** — so it works *precisely when a quantum computer has
broken the ECC key*: an attacker holding the broken ECC key cannot forge the Lamport signature and cannot
steal the account, while the true owner rescues their value. Proven: `lamport.test.ts` 16/16 (the primitive),
`quantum-migrate.test.ts` 12/12 (the ceremony, including the attacker-with-broken-ECC scenario), live via
`POST /api/kraynet/quantum/migrate`. Additive and append-only: a history with no commitment/migration hashes
byte-identically to the genesis root. Introduces NO new cryptographic assumption — it is SHA-256, which KRAY
already trusts everywhere.

### D · ML-DSA everyday accounts — `verified` (built, proven, live)

**Built and proven — the everyday quantum-safe account is here.** ML-DSA (FIPS-204, NIST's standardized
lattice signature, "Dilithium") is wired as a first-class `ml-dsa` scheme in `verifySignature`, using the
audited `@noble/post-quantum` library (the post-quantum sibling of the `@noble/curves` KRAY already runs — we
do not hand-roll lattice math). An ML-DSA account's address is `kq1` + SHA-256(its 1312-byte public key); it
signs an UNBOUNDED number of transactions (unlike the one-time escape hatch), each verified by consensus.
Proven: `mldsa.test.ts` 13/13 (a kq1 account funds, spends twice, forgery/tamper/wrong-address/replay refused,
value flows to it, conservation + byte-exact replay), full suite EXIT 0, and LIVE over HTTP (a real 2420-byte
FIPS-204 transfer accepted through `/prepare`+`/submit` with `scheme:'ml-dsa'`, a forgery refused). Additive:
kraywallet accounts are untouched, the genesis root is byte-identical, and the `scheme` dispatch stays
fail-closed on anything still unactivated (e.g. `falcon`).

**KRAY now runs, end to end, on a NIST post-quantum signature — the everyday one, not just the rescue.**

### C-legacy · The original P2QRH note — `background`

The atemporal protection for users, addable now: an account may pre-register a **hash commitment to a future
post-quantum key** — `commit = SHA-256(pqc_pubkey)`. A hash is quantum-safe, so this commitment is safe the
instant it is made, today, with no CRQC in sight. When migration is called, the owner reveals the PQC key
whose hash they committed and signs the migration with it — proving ownership **without ever relying on the
exposed ECC key**. The wallet does not need to do PQC signing until that day; it only stores a PQC keypair and
commits its hash. This is the pattern Bitcoin researchers call pay-to-quantum-resistant-hash (P2QRH), and a
new network can offer it from genesis. Optionally, addresses themselves can be hash commitments (`H(pubkey)`)
so the ECC public key is revealed only at spend, shrinking the attack window — a design trade against
"address = taproot key" parity with Bitcoin, to be weighed explicitly.

## The staged plan (each stage additive, proven, gated — the network's own discipline)

1. **Now — durable by design.** The hash layer secures all history and anchoring; the `scheme` seam and the
   hash-sealed past make migration additive. Documented here; agility pinned by test. *(done)*
2. **Recovery commitments (proposal).** A `quantum-commit` event stores `SHA-256(pqc_pubkey)` for an account —
   quantum-safe today, additive, and it touches no existing signing. Design → Creator approval → build →
   prove, exactly as a consensus change must (the way the mint-window law was shipped).
3. **PQC scheme activation (proposal).** When a CRQC is a credible threat (or proactively, by governance),
   add the ML-DSA/SLH-DSA `case` to `verifySignature`, teach the wallet to sign with it, and let accounts
   migrate via their recovery commitment. Old events stay valid; the anchor keeps working; the mint,
   validators and bridge are untouched.

## What we will NOT do

- **We will not ship an unproven PQC scheme into consensus.** The Supreme Law is that nothing moves state
  without a proof that survives replay; a hastily-added signature algorithm would violate it. PQC enters the
  same way every consensus change has: designed on paper, approved, built behind an additive seam, tested to
  destruction, and only then activated.
- **We will not claim quantum-proof.** We claim what is true: quantum-durable history and anchoring, Bitcoin-
  equal signature exposure, and a genuine, designed-in migration path that protects users atemporally.

*The math that secures the past is already quantum-safe. The math that authorizes the future is Bitcoin's, and
will migrate on Bitcoin's timeline or ahead of it — additively, provably, losing no one.* ⛓₭
