# kray-fold — THE FORGE (TK-fold Gate 1b)

The SECOND implementation of the TK-fold executable specification
(`apps/kray-core/src/protocol/tk-fold.ts`), running inside the SP1 zkVM to
produce **fold proofs**. Design + law: `docs/TK-FOLD-DESIGN.md`.

- `lib/` — the Rust twin of the spec: BIP-340 schnorr over SHA256(utf8(msg)),
  taproot address binding, the orderWindow schedule, apply, diffs, roots,
  conservation. Vetted crates only (sha2, k256, bech32).
- `program/` — the SP1 guest: reads a breath, folds it, commits the public
  outputs (network, preRoot, postRoot, diffsHash, laneTotal, counts).
- `script/` — the bench.

**This forge is OPTIONAL infrastructure.** A validator never needs any of it
(the validator-burden law): verification ships as an npm dependency at Gate 2.
Only whoever chooses to be a folder builds this.

## Bench (requires rustup + sp1up; the wrap additionally needs Go/Docker)

```bash
cd script
cargo run --release -- --execute            # reproduce EVERY golden vector byte-for-byte
cargo run --release -- --prove --vector 1   # a REAL compressed fold proof, then verified
```

The golden vectors are frozen by the TypeScript reference at
`apps/kray-core/src/test/vectors/tk-fold.golden.json` — the exit criterion of
Gate 1 is byte-for-byte equality on every field of every vector.
