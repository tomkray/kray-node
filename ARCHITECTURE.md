# Architecture

KRAY.NETWORK is split across **focused repositories** so you clone only what you need — the pattern serious
protocols use (a lean node repo; the app and explorers separate). A validator downloads the node, nothing else.

## The repositories

| Repo | What it is | Who clones it |
|---|---|---|
| **kray-node** (this repo) | **The node** — protocol, consensus/ledger, the JSON API, the operator scripts (follow · guardian · pot-signer), and a minimal self-verifying **reference explorer** (`/`, `/validate`, `/verify`, `/proof`, `/anchor`, `/network`). What a validator runs and follows. | Anyone running or following a node |
| **kray-web** | **The rich app** served at `kray.network` — the explorer, DeFi, land, dashboard, minting, the market. Holds no keys; it renders and re-verifies whatever node it points at, over the public API. | Front-end developers |

## The boundary is the API

The node and the app share exactly one contract: the HTTP API at **`/api/kraynet/*`** (plus the on-chain
content routes `/content`, `/render`, `/l1content`). The node serves it; the app — and any client, like the
KrayWallet extension — consumes it. This is why:

- **The node stays lean.** It does consensus, serves the API, and ships only the "prove it yourself" UI +
  the atlas explorer a validator needs. No product weight.
- **The app evolves on its own.** It is one of potentially many front-ends; none is privileged. Point it at
  any node — signet, mainnet, your own follower.
- **A validator downloads only the node.** Never the app, never anything they won't run.

## Where changes go

- Node · protocol · consensus · API · the reference explorer/verifier → **kray-node** (here).
- Rich app · product pages · the full explorer → **kray-web**.

Each repository is its **own source of truth**. Nothing here is generated, mirrored, or split from a
superrepo — what you read is what runs. That is the whole point: no drift, no hidden step, verifiable end to
end.

## Running it

See the [README](README.md): clone, preflight this machine, follow. The node re-derives the entire cascade
root from the journal and re-proves every anchor against Bitcoin — it trusts nothing, **including its own
operator**. Two nodes that followed the same writer arrive at the identical 32-byte root, or they refuse.
