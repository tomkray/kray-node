# `scripts/` — the public doors

A stranger clones this repository to **follow** and **validate**.

| House | What it is | Ships here |
|---|---|---|
| **`follow/`** | Door 2 — full node of one public history | **Yes** |
| **`guardian/`** | Door 1 — measure, prime, mine | **Yes** |
| **`pot-signer.mjs`** | Pot signs off the public process (no keys) | **Yes** |
| **`oss-guard.sh`** | Public-tree leak check | **Yes** |
| `exam/` · `lab/` | Private workshop | **No** |

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
