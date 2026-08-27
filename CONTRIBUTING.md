# Contributing to KRAY.NETWORK

KRAY is math first. Every contribution is judged by one question: **does the
math still never leave?**

## Before you open a PR

```
npm run test:boot      # Signet ≠ mainnet isolation + official-zip cleanliness
cd apps/kray-core
npm install
npm run test:fast      # ~38,000 hermetic checks — must be green
npm run test:hardcore  # the 10,000-year assault — must be green
```

A change that touches `apps/kray-core/src/protocol` or `src/economics` must come
with hermetic checks of its own, in the same style as the existing suites: pure,
deterministic, no infrastructure, seeded randomness only.

## The eternal laws (never up for debate)

The single source of these laws is [docs/AXIOMS.md](docs/AXIOMS.md) — when any doc
(including this one) disagrees with it, the axiom wins and the doc is the bug.

1. Conservation or HALT — Σ balances == emitted − burned, exactly, at every seal.
   ₭ is born only through the proof-of-burn mint (immutable 10,000-₭ per-mint cap)
   and dies only by fee burn; nothing else creates or destroys a unit.
2. The 1-KRAY fee is immutable. No auction, no exceptions.
3. No hard fork, ever — fail-safe (freeze), never fail-fork.
4. Honor gates money — governance voice is capped by earned, soulbound Glow.
5. Written stars are relics — inscribed/named stars never spend as gas;
   content is byte-unique, first writer wins; no re-inscription.
6. Zero dependency — no cloud, no company, no operator. Home nodes, local
   truth, anchored to Bitcoin.

PRs that weaken any law are closed, kindly and firmly.

## Practical rules

- **One public remote.** Friends clone and PR against
  [`github.com/tomkray/kray-node`](https://github.com/tomkray/kray-node)
  (`main`). That is the only user door.
- Everything in the repository is in English.
- No secrets, credentials, wallet files, or node data — ever. Lab datadirs
  are gitignored. The official clone does not ship the workshop (`scripts/exam/`,
  `scripts/lab/`).
- **Folder law.** Names in [`docs/FOLDER-LAW.md`](docs/FOLDER-LAW.md) are
  locked now. Mainnet ignited = a rename is a fork. Do not treat Signet
  uptime as a reason to defer or to keep a second name.
- **Two public networks, two houses.** Tracked recipes live in `networks/signet/`
  and `networks/mainnet/`. Live keys and journals live in gitignored `/signet/`,
  `/mainnet/`, `data-signet/`, `data-main/`. Never copy one universe into the
  other. See [`networks/README.md`](networks/README.md).
- **Scripts have houses.** Public work goes in `scripts/follow/` ·
  `scripts/guardian/` · `scripts/pot-signer.mjs`. See
  [`scripts/README.md`](scripts/README.md). Explorer chrome is `index.html`,
  `kray.js`, `kray.css`. Era URL aliases on the writer are compatibility,
  not names.
- No live host map: mesh IPs, private DNS names, SSH public keys, and
  `signet/*.env` / `mainnet/*.env` stay off the public tree. Operator files
  live in gitignored `ops/`. Run `bash scripts/oss-guard.sh` before a
  public push.
- No fictitious data in the explorer: a value is real or it is honestly absent.
- Match the style around you: heavily-commented, narrative source files that a
  stranger can audit in one sitting.

## Getting a node anywhere

Quiz + preflight first: [`docs/RUN-NODE.md`](docs/RUN-NODE.md). “Full node”
means follow. This clone is never the public writer.

```
git clone https://github.com/tomkray/kray-node.git KRAY-NODE
cd KRAY-NODE
node scripts/follow/preflight.mjs --universe signet --role follow
cd apps/kray-core && npm ci && cd ../..
npm run test:boot
node scripts/follow/kray-follow.mjs --from https://signet.kray.network --dir ./follower --watch --serve 4480
```

## On a code of conduct

Like bitcoin/bitcoin and ordinals/ord, this repo publishes none — the recorded
decision, not an oversight. The bar here is the work: proven code, honest docs,
respectful review. Anything else is off-topic.
