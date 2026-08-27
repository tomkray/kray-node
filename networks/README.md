# Networks — official public map

This repository is **one protocol, two public Bitcoin networks**. Same binary.
Different universe. A contributor who mixes them forks the book.

Three houses (not three protocols): official clone · writer disk · workshop.
See [`../docs/FOLDER-LAW.md`](../docs/FOLDER-LAW.md).

Folder names are locked: [`../docs/FOLDER-LAW.md`](../docs/FOLDER-LAW.md).
Signet may pause. Mainnet ignited freezes the names. Mainnet genesis is
empty `data-main/` — zero km, no Signet copy.

| | [Signet](signet/) | [Mainnet](mainnet/) |
|---|---|---|
| Role | public lab (live) | Bitcoin mainnet (live, genesis) |
| `KRAY_NET` | `signet` | `main` |
| Writer | `https://signet.kray.network` | `https://www.kray.network` |
| Journal | `kraynet-journal-signet.jsonl` | `kraynet-journal-main.jsonl` |
| Live data (gitignored) | `apps/kray-net/data-signet/` | `apps/kray-net/data-main/` |
| Operator keys (gitignored) | `/signet/` at repo root | `/mainnet/` at repo root |
| Follow folder | `follower/` `:4480` | `follower-main/` `:4481` |
| Wallet (KrayWallet) | DevNet **ON** + flavor Signet | DevNet **OFF** |

Read the folder for the network you mean. Do not copy files across.

## What a clone contains vs what it must never grow

```
KRAY-NODE/                         ← git clone …/kray-network.git
├── AGENTS.md                      ← which house is this folder
├── networks/
│   ├── signet/                    ← public Signet recipe (tracked)
│   └── mainnet/                   ← public mainnet recipe (tracked)
├── apps/kray-core/                ← the law
├── apps/kray-net/                 ← the writer + explorer
├── CLAUDE.md · AGENTS.md          ← any LLM first door
├── docs/RUN-NODE.md               ← quiz + preflight + one recipe
├── scripts/follow/                ← Door 2
├── scripts/guardian/              ← Door 1 (mining swarm lives here)
└── scripts/follow/kray-follow.mjs ← the full node (stable door: scripts/kray-follow.mjs)
# never in this clone — workshop only
# scripts/exam/  scripts/lab/  WORKSHOP.md

# never commit — gitignored operator / state
/signet/                           ← Signet pot keys (operator machine)
/mainnet/                          ← mainnet pot keys (operator machine)
/apps/kray-net/data-signet/        ← live Signet journal + atlas
/apps/kray-net/data-main/          ← live mainnet journal + atlas
/follower/                         ← your Signet replica
/follower-main/                    ← your mainnet replica
/ops/                              ← this operator's host map
/apps/kray-api/                    ← this machine's bitcoind/ord gateway
```

`networks/signet/` is documentation. `/signet/` is the live key house.
They are not the same folder. The official zip ships the first and
refuses the second.

## Isolation (enforced)

`apps/kray-net/network-boot.mjs` refuses a writer or follower that would
share a journal, a lab RPC port, a pot address, or a data directory
across networks. `npm run test:boot` re-proves it.

Fresh mainnet genesis. New `bc1` pot. New keys. Never the Signet vault,
never the Signet journal.

## Follow (full node — not a second writer)

```
# Signet (live)
node scripts/follow/kray-follow.mjs --from https://signet.kray.network --dir ./follower --watch --serve 4480
# Windows: scripts\follow\signet.cmd   (alias: follow-signet.cmd / follow-this-network.cmd)

# Bitcoin mainnet (when the writer is live)
node scripts/follow/kray-follow.mjs --from https://www.kray.network --dir ./follower-main --watch --serve 4481
# Windows: scripts\follow\mainnet.cmd
```

## Wallet

KrayWallet already seats both names. DevNet **OFF** talks to
`https://www.kray.network` and stays dark until that node answers.
DevNet **ON** + Signet talks to `https://signet.kray.network`.
The wallet will not fill a pot whose HRP is on the other network.
