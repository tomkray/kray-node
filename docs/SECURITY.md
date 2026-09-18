# KRAY.NETWORK — Security posture

> **Status: NORMATIVE (living posture)** — updated as invariants move; the code and its
> proofs win on any drift.

Grounded, honest, and adversarially audited (2026-08-01, 8-agent red-team + line-by-line
re-verification). Overclaiming security is treated as the worst possible failure.

## The invariants that hold

- **Keys never touch the server, in production.** The node holds no user private key and signs
  nothing for users; every action is authorised by the citizen's own KrayWallet
  (prepare → sign → submit, re-verified in the reducer on apply AND replay). The only server-side
  wallet is the FEE-ONLY Bitcoin wallet that pays anchor fees (`KRAY_BTC_WALLET`), and every dev
  shortcut sits behind `KRAY_TRUSTED_DEV` (default OFF — a production node is safe out of the box).
  *(The former `KRAY_SIMULATION` / `KRAY_FOUNDER_ADDR` switches no longer exist in `server.mjs`.)*
- **Every user action is signed, and verified at BOTH the door and the replay.** `transfer`,
  `transfer-star`, `inscribe`, `name`, `origin`, opt-in, rune-send/exit, contract, work-claim
  all carry a BIP-340 Schnorr signature over a domain-separated, network-labelled message; the
  reducer (`ledger.ts`) re-verifies it on every apply and every replay. *(As of 2026-08-01 this
  now includes `inscribe`/`name`/`transfer-star`, which previously verified only at the door —
  a keyless journal line can no longer steal a relic or rename a star and survive replay.)*
- **Fail-closed verification.** `verifyKrayWallet` (`scheme.ts`) survived a 27-case forgery /
  malleability / wrong-key / off-curve / cross-network battery; a 33-byte pubkey must be a real
  compressed point (`0x02/0x03`). Every call site is `if (!verifySignature(...)) throw` — no
  `||` fallthrough, no swallowed exception.
- **Entropy.** All randomness is `node:crypto` CSPRNG (key material, session tokens). Zero
  `Math.random` in any security path. Crypto is `@noble/curves` — constant-time, audited.
- **Integrity is Bitcoin-grade.** Content hashes, inscription ids, merkle roots, the cascade
  root and the anchor are SHA-256; the anchor's SPV proof re-derives tx→txid→merkle→PoW header
  chain→root from bytes and cannot be forged or replayed. Conservation (Σ balances == emitted −
  burned) is re-asserted after every event, or the node HALTs.
- **A rune credit is backed by THIS network's pot, in consensus.** At/after `POT_BINDING_SEQ` (signet 227,
  main 82 — one above each live head at the 2026-09-18 rite; regtest inactive) the reducer refuses a
  `pool:true` rune deposit whose journaled vault does not derive to the sealed consolidation pot, and a
  personal-vault deposit whose guardians / threshold / timelock are not the sealed federation
  (`federation-consensus.ts` — the pot address, guardian set, threshold and timelock each writer publishes).
  Before the pin the vault was the event's word: only the writer's door checked the pot, so a compromised
  writer could journal pot-backed credit against a vault it alone controlled (the Liquid class). Below the
  pin history replays byte-identically. Proven: `pot-binding-pin.test.ts` (42/42).

## Post-quantum posture — the honest truth

The classical layer is **exactly as quantum-exposed as Bitcoin, no more**, and the integrity layer
is quantum-durable — and, unlike Bitcoin, the upgrade is **built and live**. See
`docs/QUANTUM-READINESS.md` for the full analysis and proofs.

- **Quantum-durable already (SHA-256, Grover-only, ~128-bit residual):** the cascade root, the
  journal hash chain, the Bitcoin anchor, the keyless burn address, and beat proof-of-work. The
  entire *history and anchoring* are safe forever — the past can never be rewritten.
- **Classical signature exposure (secp256k1/BIP-340):** a Shor-capable adversary could forge for an
  active taproot account — the same class as Bitcoin, and the same problem the whole ECC world
  shares. It affects only *future spending authorisation*, never the past.
- **The fix is live, not scaffolding.** `SchemeId` is a fail-closed dispatch, and a real NIST
  post-quantum scheme is already a first-class case: **ML-DSA (FIPS-204)** accounts (address =
  `kq1` + SHA-256(key)) sign an unbounded stream of transactions the reducer verifies exactly as it
  verifies taproot ones. For existing taproot accounts, a hash-committed **quantum recovery** is
  built: register `SHA-256(a Lamport key)` via `quantum-commit`, and if a quantum computer ever
  breaks ECC, rescue your value with a one-time Lamport signature (`quantum-migrate`) an attacker
  holding your broken ECC key cannot forge. Proven: `lamport.test.ts`, `quantum-commit.test.ts`,
  `quantum-migrate.test.ts`, `mldsa.test.ts`, `quantum-agility.test.ts`.

## The rune bridge — SPV-proven in both directions (custody is federated)

Every credit and every burn is authorised by a Bitcoin SPV proof, not by anyone's word. **Custody
of the L1 reserves is the one named trust boundary:** a guardian federation holds the shared bakery
pot (threshold-signed, timelocked). This is disclosed here and in the audit dossier's known-boundaries
note — never claimed away.

- A **deposit MINTS** L2 credits only when Bitcoin proves runes entered the shared bakery pot
  (`submitRuneDeposit` → `proveDeposit`: real tx, buried 6 deep, runestone decoded, amount landing
  in the pot script). The credit binds to the unique Taproot spender that paid the pot — read from
  the deposit's parent txs, hash-bound, never a client field.
- A **settle BURNS** them only when Bitcoin proves the runes LEFT the pot to the **exact L1
  address the exiter signed** in phase-one (`rune-exit`). `submitRuneSettle` re-runs `proveDeposit`
  against the exit's signed destination; the reducer re-proves it on every replay from the kept
  bytes and HALTs on any shortfall. The **ledger logic** trusts no signature and no operator — the
  SPV proof itself is the authorisation, so nobody can burn an exit the holder was never actually
  paid for; moving the reserves out of the pot is the federation's threshold-signed act. Verified
  end-to-end: a payout to the wrong address, a shallow (2-deep) payout, and a double-settle are all
  refused; a proven payout burns exactly the lock and the reboot re-proves it
  (`rune-bridge.test.ts`, `pot-deposit.test.ts`).

## Known open items (tracked, not hidden)

- **Built 2026-09-18, awaiting the rite — the signer law v2.** The gauntlet proved the signers bound only the
  holder's destination and amount: rune change, rune id, sats change, funding, fees, the open lock and single
  delivery were the writer's word. `signerLawV2` + `payout-policy.ts` (P0–P8, the lock, one delivery, one network)
  now run in the pen and in every guardian; the writer verifies shares before counting and speaks a token per
  guardian. Live on a network only after every signer box runs it (see POT-CUSTODY, "the signer law v2").
- **Built 2026-09-18, awaiting the rite — the pen consults its own book.** The owner signer never checked the
  book: with two guardian keys and the pen's local token, a self-signed over-balance exit drained the pot. The pen
  now runs the guardians' gate (`book-gate.ts`): its own follower, lag ≠ theft, monotonic head + lineage, the
  balance predicate, the anti-TOCTOU confirm; a pen without a book refuses to start. Live on a network only after
  the pen's box holds the fixed daemon + kray-core and the pen is restarted with its phrase (see POT-CUSTODY).
- **Proven 2026-09-18 — our reading of the Runes protocol equals ord's on live transactions.** The L2 credits runes
  by re-deriving the allocation law from raw bytes with its own decoder (`runestone.ts`); a reading that differed from
  ord's in any edge case would let a transaction be credited one way here and settled another on Bitcoin (unbacked
  runes — the protocol-interpretation twin of the 2026-09-06 Liquid exploit, where a validation cache let 4,000
  unbacked L-BTC through an honest federation). `runestone-ord-differential-e2e.mjs` builds runestone transactions
  byte by byte, mines each one on regtest and compares every output and every burn with ord 0.27.1, taking the input
  state from ord's own view: 31 deterministic edge cases (edicts, amount 0, spreads with remainder, clamping, pointers
  at the OP_RETURN, every cenotaph flaw the specification names, mints and a mint inside a cenotaph, a nameless
  etching, two-rune delta encoding, two runestone outputs, PUSHDATA1 payloads) plus seeded random cases. Three runs,
  211 real transactions, 0 divergences. Run it before touching the decoder: `HARNESS=<regtest harness>
  npm run live:runestone-ord` in `apps/kray-core`. It is a proof against ord's implementation, not against the
  specification text; a divergence would be pinned by activation seq, never hot-fixed.
- **Closed 2026-09-17 — withdraws held by the signer wire:** since the withdraw door began stating a
  546-sat service output (2026-09-01), the plan wire between the node and the remote pen/guardians dropped
  that field, so every remote co-sign refused ("claimed sighashes do not match the rebuilt payout") and
  every cooperative withdraw was held. Fail-closed held as designed (no exit was open on either public
  network in that window; the mainnet pot was never funded). Fixed in `pot-signer.ts` (the field crosses,
  under a 1 000-sat signer ceiling), pinned in three suites, proven live on regtest. Deploy law: the same
  commit on the writer, both pens and all guardians — a mixed fleet holds, it never over-signs.
- **DoS**: `/api/kraynet/star/<n>` re-parses the whole journal per request — needs a cache.
- **File modes / PQ migration pieces** as above.
- **E1 — the v1 `contract` seal (a law with no star)**: it paid no fee, burned nothing and carried no nonce,
  so one signature could open a new pot on every re-submission (confirmed 5/5 on regtest and on a `main`-network
  ledger, 2026-09-17). Refused at every writer door since 2026-09-17 and retired in the reducer at
  `CONTRACT_V1_RETIRED_SEQ` (pinned 2026-09-18: signet 227, main 82 — one above each live head; regtest
  inactive); below the pin history replays byte-identically — no v1 seal exists in any live
  journal (main: 0 contracts; signet: 3, all on stars). Recipe and status: `RESIDUAL-VECTORS.md` §V9.

## Responsible disclosure

Found a vulnerability? Report it privately via a **GitHub private security advisory** on this
repository (Security → Report a vulnerability). Please do not open a public issue for
anything exploitable. You will get an answer, a fix timeline, and credit in the advisory if you
want it. There is no bug-bounty pot yet; there is a maintainer who reads every report.

**Dependency you must own:** the KrayWallet extension's key generation. KRAY only ever *verifies*;
the wallet must generate keys with a CSPRNG and sign BIP-340 with a deterministic nonce. That code
runs in every user's browser (readable via devtools — not a secret), and can be audited on request.
