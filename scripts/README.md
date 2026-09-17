# `scripts/` — the public doors

A stranger clones this repository to **follow** and **validate**.

| House | What it is | Ships here |
|---|---|---|
| **`follow/`** | Door 2 — full node of one public history | **Yes** |
| **`guardian/`** | Door 1 — measure, prime, mine | **Yes** |
| **`folder/`** | TK-fold breath (any house, never official) | **Yes** |
| **`oss-guard.sh`** | Public-tree leak check | **Yes** |
| `exam/` · `lab/` | Private workshop | **No** |
| `operator/` · `pot-signer.mjs` | Writer-disk bakery (pen) | **No** |

Any assistant: [`docs/RUN-NODE.md`](../docs/RUN-NODE.md) first — quiz, then
preflight this machine, then one recipe.

## Follow (the door strangers use)

```
node scripts/follow/preflight.mjs --universe signet --role follow
node scripts/follow/kray-follow.mjs --from https://signet.kray.network --dir ./follower
scripts/follow/signet.sh            # or scripts\follow\signet.cmd
scripts/follow/mainnet.sh           # or scripts\follow\mainnet.cmd
```

Stable aliases: `scripts/kray-follow.mjs`, `scripts/follow-signet.cmd`,
`scripts/follow-this-network.cmd` (Signet), `scripts/follow-mainnet.cmd`.

Environment (all optional): `KRAY_BTC_RPC` / `KRAY_BTC_RPC_USER` / `KRAY_BTC_RPC_PASS`
(re-prove donations and seals on your own bitcoind), `KRAY_SEAL_CONF` (default 6),
`KRAY_FOLLOW_BIND` (default `127.0.0.1`), `KRAY_FOLLOW_INBOX=0` (no mailbox),
`KRAY_FOLLOW_PREFIX=warn|refuse` (a verified history that does not extend the last
verified snapshot: label it, or keep the snapshot — default `warn`),
`KRAY_FOLLOW_CYCLE_MS` (persist cycle, default 30000, floor 1000 — for lab exams).
In `--serve`/`--watch` a failed cycle keeps the last verified snapshot online,
marked `stale` with `staleReason`; one-shot exits 1.

## Folder (the TK-fold role — any house, never official)

A breath of the lane lands with `fold-once.mjs`. Anyone with 1 ₭ may do it.
There is no privileged folder. Preflight first — it saves a failed forge.

```
KRAY_FOLDER_SK=<64-hex> node scripts/folder/preflight.mjs
KRAY_FOLDER_SK=<64-hex> node scripts/folder/fold-once.mjs
```

The secret is that house's own key (it pays the eternal 1 ₭). Never a writer
vault key. Never paste it into the node.

## Guardian

```
node scripts/guardian/guardian.mjs https://signet.kray.network
```

Explorer pages (`index.html`, `validate.html`, …) stay in `apps/kray-net/`.

Live journals: `data-signet/` · `data-main/` (gitignored). Operator live
keys stay in gitignored `/signet/` and `/mainnet/`.
