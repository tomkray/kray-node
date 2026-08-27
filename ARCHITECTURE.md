# Architecture

KRAY.NETWORK is split so a validator clones only the node.

## This repository

**kray-node** is the node: protocol, consensus/ledger, the JSON API, the
public scripts (follow · guardian · pot-signer), and a minimal self-verifying
reference explorer (`/`, `/validate`, `/verify`, `/proof`, `/anchor`,
`/network`).

The JSON contract is **`/api/kraynet/*`** (plus `/content`, `/render`,
`/l1content`). Any client — this explorer, another front-end, the wallet —
consumes that API. None is privileged.

## Running it

See the [README](README.md): clone, preflight this machine, follow. The node
re-derives the entire cascade root from the journal and re-proves every
anchor against Bitcoin — it trusts nothing, including its own operator.
Two nodes that followed the same writer arrive at the identical 32-byte
root, or they refuse.
