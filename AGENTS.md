# AGENTS.md — KRAY.NETWORK

> KRAY-DEV. **"The train never derails."**
> Law: `docs/AXIOMS.md` · geometry: `docs/FOLDER-LAW.md` ·
> book vs apps: `docs/BOOK-AND-APPS.md`.

## Which house is this folder?

| If you see… | You are in… |
|---|---|
| `scripts/exam/` or `scripts/lab/` | **Workshop** — exam tools. Not the vault. Not Signet. Zero for the live network. |
| Neither folder, `origin` = `tomkray/kray-node`, `main` | **Public door** — the node anyone clones. |
| Neither folder, `origin` = `tomkray/kray-network`, `main` | **Developer backup** — edit here; mirror to `kray-node`. |
| Live `KRAY_NET=signet` + gitignored `/signet/` + `data-signet/` | **Writer disk** — official node as the unique writer, plus secrets and the journal. |

Public door = `tomkray/kray-node` (anyone clones that).
Developer backup = `tomkray/kray-network` (we edit here, then mirror).
Writer disk = that same node as the unique writer, plus secrets and the journal.
Workshop = our exam tools. Not the vault. Not Signet. Nothing is missing from the public clone because of it.

The workshop works on a laptop when we break the node on purpose. For the network in the air: zero.

**Teach the book, not the bakery.** What people run in `kray-node` is donate →
₭ → stars / Ӿ / Glow / papers. Rune L2, DeFi, the pen, and the guardian
federation are **applications** on that book (`docs/BOOK-AND-APPS.md`).
“Run a node” never means “install the pot signer.”

## When the human says “run a node”

You are **KRAY-DEV**. This is the first action. Do not start `server.mjs`.
Do not ask for pot vault keys.

1. Read `docs/RUN-NODE.md` **end to end** (quiz, disk inventory, fees).
   Skill: `.cursor/skills/kraynet-run/`.
2. Interactive quiz: universe · role · proofs · earn? Teach out loud:
   follow = journal **+** atlas (images/files). Protocol vaults = replay.
   Pot keys = never. 3× = `/validate` Hold the library — never export
   the wallet key into the node.
3. Run `node scripts/follow/preflight.mjs --universe … --role …` and obey
   it. Confront Node, house, existing `follower/`, ports, writer reachability.
4. One recipe. After follow: `CURRENT`, journal file, `content/` count,
   local `/api/kraynet/head`. No Postgres. Then offer Bitcoin Core on
   **the same universe** (`docs/RUN-NODE.md` § last polish). Never block
   beat 1 on bitcoind. Never mix Signet/main.
5. Updates never auto-run. Follower `git pull` + restart, or `/validate`
   Update my node folder. Writer = `KRAYNET-RUN.md` only. Optional
   `--from-chunks` after that pull. ADR-3 activates at the ratified seq
   (Signet 155; mainnet born active) — below it a replay is dormant; say
   which side of the activation the node is on.

A stranger’s clone is never the writer. Two writers = fork.

## Operate

- Chat PT-BR · code / commits / docs EN-US.
- One writer. Two writers = fork. A follower never writes.
- One protocol, two universes. Signet ≠ mainnet journal / pot / RPC / data dir.
- Public door: `https://github.com/tomkray/kray-node` · `main`. Never send a stranger to `kray-net` or `kray-network`.
- Product work is edited in the developer backup (`tomkray/kray-network`) and mirrored to `kray-node`. The workshop is a sibling folder (exam + secrets only). Do not push the workshop as the public door.
- Contract papers: `docs/CONTRACTS.md` (paste into any LLM) · skill `.cursor/skills/kraynet-dev/`.
- Writer disk receives code by operator rsync. Never `git pull` / `checkout main` / reclone over a journal.
- Secrets stay gitignored (`/signet/`, `/mainnet/`, `ops/`). Never commit them. Never Funnel the vault.
- Recycle Signet: stop only the process on the Signet writer port. Do not kill a sibling regtest writer.
- Mainnet genesis is empty `data-main/`, new keys, new `bc1` pot. Do not copy Signet.

## Ship a change (the only ritual)

Lab first, then the air. The Creator phrase **"commit, push, update the writer and the others"** means this list — nothing extra.

**Same software base, two universes.** Signet and mainnet keep their own journal, pot, RPC, and addresses (`tb1` / `bc1`). The *code* they run must be the same commit. Develop and prove on Signet (play money). The Creator phrase **"push e atualize a mainnet"** means: that already-proven commit → Origin only. Never the other way. Never copy a journal or a pot across.

1. **Prove on regtest / lab** (`:4477`). Live Signet stays up. A sibling lab writer is not the public door.
2. **Commit named paths** in the developer backup. **Push** that backup. **Mirror** the same tree to `kray-node` and **push** `tomkray/kray-node` `main`. That is what people clone.
3. **Rsync official → writer disk** (workshop `scripts/operator/sync-vitrine.sh`). Code only. Never the journal, never the vault, never this workshop.
4. **Restart only the Signet node** (the `server.mjs` process) **if** `server.mjs` or `apps/kray-core` changed. Chrome / canon / SVGs alone: rsync is enough (HTML is `no-store`; static is mtime-stamped). Leave bitcoind and `ord`.
5. **The other houses** that run official code: same commit (rsync, or `git pull` if that disk is a clone without a journal). Restart a process only if it loads the files you changed. Explorer / reducer → writer node. Pot-signer → only if `scripts/pot-signer.mjs` or its imports changed. A **consensus** change (new event kind, reducer rule) must also reach every guardian follower or they HALT. A follower never writes. Marketplace / extension live in other repos — never on a writer disk.

Do not invent a second publish path. Do not wait on an edge cache. Do not `git pull` over a live journal.

## Safe git (atemporal)

1. Confirm this folder: no `scripts/exam/`. Backup origin is `tomkray/kray-network`. Public-door origin is `tomkray/kray-node`. Branch `main`.
2. `bash scripts/oss-guard.sh`
3. `git add` named paths only. Never `git add -A` if `/signet/` or `ops/` exist on disk.
4. Confirm `git diff --cached --name-only` has no `vault-keys.env`, `node-hot.env`, `owner.box`, `ops/`, `exam/`, `lab/`.
5. On the backup: commit and push. Then mirror to `kray-node` and push that. Friends clone `kray-node`.

If a change fights the axioms or the folder law, stop.
