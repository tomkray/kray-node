# `scripts/` — the public doors

A stranger clones this repository to **follow** and **validate**. The workshop
that built the idea (`scripts/exam/`, `scripts/lab/`, this-operator vitrine
sync) is not in the official tree. Those folders stay on the working repo.
Houses: [`docs/FOLDER-LAW.md`](../docs/FOLDER-LAW.md) — official is the clone;
the writer disk is that clone plus secrets and the journal; the workshop is
exam tools and is zero for the live network.

| House | What it is | Ships in `kray-network` |
|---|---|---|
| **`follow/`** | Door 2 — full node of one public history | **Yes** |
| **`guardian/`** | Door 1 — measure, prime, mine | **Yes** |
| **`operator/pot-signer.mjs`** | Pot signs off the public process | **Yes** (no keys) |
| **`oss-guard.sh`** | Public-tree leak check | **Yes** |
| `exam/` · `lab/` · vitrine sync | Workshop / this operator | **No** |

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
vault key. Never paste it into the node. A second house is not a second writer.

## Guardian

```
node scripts/guardian/guardian.mjs https://signet.kray.network
```

Explorer pages (`index.html`, `validate.html`, …) stay in `apps/kray-net/`
— folder law, [`docs/FOLDER-LAW.md`](../docs/FOLDER-LAW.md). Era URLs
(`/v2.html`, `/kray-v2.js`, `/kray-v2.css`) alias the same files; they are
not names.

Live journals: `data-signet/` · `data-main/` (mainnet starts empty). Lab
bench names are not a public door. Operator live keys stay in gitignored
`/signet/` and `/mainnet/`.
