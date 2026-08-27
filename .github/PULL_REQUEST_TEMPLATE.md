# What this proves

<!-- One paragraph: what changed and WHY. State the invariant it upholds (cite docs/AXIOMS.md). -->

## The proof

- [ ] `cd apps/kray-core && npm test` — the FULL suite is green (paste the closing line)
- [ ] New behavior is pinned by a test that fails without the change
- [ ] Old inputs still produce byte-identical output (additive, never destructive)
- [ ] No secret, key, harness state, or data dir is touched by this diff

## The discarded branch

<!-- Every fork echoes: name the alternative you considered and why it lost. -->
