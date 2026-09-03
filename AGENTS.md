# AGENTS.md — KRAY.NETWORK

> Law: `docs/AXIOMS.md` · geometry: `docs/FOLDER-LAW.md` ·
> book vs apps: `docs/BOOK-AND-APPS.md`.

This repository is the public node. Clone it. Follow it. Verify it.
A stranger's clone is never the writer. Two writers = fork.

**Teach the book, not the bakery.** What people run here is donate → ₭ →
stars / Ӿ / Glow / papers. Rune L2, DeFi, and the pot signer are
**applications** on that book (`docs/BOOK-AND-APPS.md`). “Run a node”
never means “install the pot signer.”

## When the human says “run a node”

Do not start `server.mjs` as if this clone were the public writer.
Do not ask for pot vault keys.

1. Read `docs/RUN-NODE.md` **end to end** (quiz, disk inventory, fees).
   Solo human (no assistant): `docs/RUN-NODE-TUTORIAL.md`. Skill:
   `.cursor/skills/kraynet-run/SKILL.md`.
2. Interactive quiz **Q1–Q6** (+ **Q2b** if follow): universe · role ·
   custody hand · proofs · earn · updates · optional mind. Teach out loud:
   follow = journal **+** atlas (images/files). Protocol vaults = replay.
   Pot keys = never. 3× = `/validate` Hold the library — never export
   the wallet key into the node. Signet `:4480` · mainnet `:4481` · lab
   `:4477`. Writer **live** on both public books.
3. Run `node scripts/follow/preflight.mjs --universe … --role …` and obey
   it. Confront Node, existing `follower/` / `follower-main/`, ports,
   writer reachability.
4. One recipe. After follow: `CURRENT`, journal file, `content/` count,
   local `/api/kraynet/head`. No Postgres. Then offer Bitcoin Core on
   **the same universe**. Never block beat 1 on bitcoind. Never mix
   Signet/main.
5. Updates never auto-run. Follower `git pull` + restart, or `/validate`
   → Update my node folder.

## Houses (this clone)

| If you see… | You are in… |
|---|---|
| `origin` = `tomkray/kray-node`, branch `main` | **Public door** — the node anyone clones |
| Live `KRAY_NET` + gitignored keys + a journal | **Writer disk** — never reclone over it |
| `scripts/exam/` or `scripts/lab/` | A private workshop — not shipped here |

## Contribute

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

- Code, comments, commits, and repo docs: English (EN-US).
- One protocol, two universes. Signet ≠ mainnet journal / pot / RPC / data dir.
- Secrets stay gitignored (`/signet/`, `/mainnet/`, `ops/`). Never commit them.
- `bash scripts/oss-guard.sh` before a public push.
- Confirm `git diff --cached --name-only` has no `vault-keys.env`,
  `node-hot.env`, `owner.box`, `ops/`, `exam/`, `lab/`.

If a change fights the axioms or the folder law, stop.
