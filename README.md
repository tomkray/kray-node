<h1 align="center">₭</h1>

<p align="center"><strong>KRAY.NETWORK</strong></p>

<p align="center">
  A Bitcoin-anchored ledger that proves itself.<br>
  <em>Signature ‖ Merkle proof ‖ Bitcoin anchor — and nothing else.</em>
</p>

<p align="center">
  <a href="https://signet.kray.network">Signet live</a>
  ·
  <a href="https://www.kray.network">Mainnet live</a>
  ·
  No premine
  ·
  No owner
</p>

---

A ₭ is born only when someone **burns real satoshis** at a keyless address (provably nobody's) — one ₭ per satoshi, at most 10,000 ₭ per mint. That same burn *is* the network's anchor. Every node that replays the signed journal computes the same hashes, the same **cascade root**, and the same settlement table. Verify that root on Bitcoin and you have verified everything.

Bitcoin has ₿. KRAY has **₭** (U+20AD). The symbol lives in the protocol, not in a stylesheet.

## Status

One protocol. Two universes of state. Same binary — never the same journal, pot, RPC, or data directory.

| | Signet | Bitcoin mainnet |
|---|---|---|
| Role | Public lab — **live** | Bitcoin mainnet — **live** (genesis seq 0) |
| Writer | https://signet.kray.network | https://www.kray.network |
| Follow | `scripts/follow/signet` → `follower` `:4480` | `scripts/follow/mainnet` → `follower-main` `:4481` |
| Wallet | KrayWallet · DevNet **ON** · Signet | KrayWallet · DevNet **OFF** |
| Journal | `kraynet-journal-signet.jsonl` | `kraynet-journal-main.jsonl` |

Do not copy the Signet journal or the Signet vault onto mainnet. The writer refuses to boot if they mix. Map: [`networks/`](networks/README.md).

This repository is the public door. Clone it. Follow it. Do not clone a
workshop remote. Official = the node anyone clones. The live writer is that
same node plus secrets and the journal. Exam tools are not in this tree.
Houses: [`docs/FOLDER-LAW.md`](docs/FOLDER-LAW.md).

## I cloned this. I want to run a node.

**Stop. Ask first.** Any assistant in this folder must open
[`docs/RUN-NODE.md`](docs/RUN-NODE.md) and do, in order:

1. **Quiz** — Signet or mainnet or local lab? Follow (full node), guardian,
   browser `/validate`, or a private empty writer?
2. **Preflight** — confront *this* machine (Node ≥ 24, house, ports, folders
   that already exist) before any start:

```
node scripts/follow/preflight.mjs --universe signet --role follow
```

3. **One recipe** — only what preflight prints as `NEXT`. “Full node” means
   **follow**, not `server.mjs`. This clone is never the public writer.
   Need: Node.js ≥ 24, `npm`, network to the writer. No vault.

Walking alone, no assistant? The copy-paste walkthrough with expected
outputs and troubleshooting: [`docs/RUN-NODE-TUTORIAL.md`](docs/RUN-NODE-TUTORIAL.md).

## Three doors

### 1 · Validate — a browser tab

Every other Bitcoin network makes validating hard. On KRAY a validator's job is one SHA-256 loop and a **powerless** signature (it can move no money). Open [`/validate`](https://signet.kray.network/validate), connect KrayWallet, leave **Hold the library** on, press start. The tab downloads public star files (hash-checked) and asks the wallet for the usual `signMessage`. The spending key **never leaves KrayWallet**. Never paste wallet hex into the node. Reward: 1× presence, up to **3×** when the beat carries that library proof.

Optional always-on box — a **dedicated** miner key, not the daily wallet:

```
node scripts/guardian/guardian.mjs https://signet.kray.network
```

Unset `KRAY_MINER_SK` = junk demo identity. How the 1 ₭ fee pool pays:
[`docs/RUN-NODE.md`](docs/RUN-NODE.md) § “How fees work”. Live table:
[`/validate`](https://signet.kray.network/validate).

| To validate you must… | Bitcoin / Ordinals | KRAY.NETWORK |
|---|---|---|
| Download the chain | hundreds of GB | **nothing** (atlas is optional, 3×) |
| Run infrastructure | a full node + indexers | **a browser tab** |
| Special hardware | often | **none** |
| Time to first proven work | hours to days | **seconds** |

### 2 · Follow — a full node of this history

Code from this repository. History from a writer you re-verify. A follower is **not** a second writer. Two writers fork the book.

```
git clone https://github.com/tomkray/kray-node.git && cd kray-node
node scripts/follow/preflight.mjs --universe signet --role follow
bash scripts/follow/signet.sh
```

Node.js 24+ only. The launcher installs libraries once and starts the follow.
Your explorer: `http://127.0.0.1:4480/`. Same replay re-checks Ӿ, FIREBORN
tanks, and every TK-fold proof (WASM in the clone — no Rust, no SP1).

**On Windows, use the doors — not the bare `node …` lines above.** Node 24 on Windows rejects the writer's TLS cert unless it reads the Windows CA store, so the doors pass `--use-system-ca` for you (never disable TLS):

```
scripts\follow\preflight.cmd --universe signet --role follow
scripts\follow\signet.cmd
```

Bitcoin mainnet (when the writer is live): `scripts\follow\mainnet.cmd`.

`--serve` is a read-only mirror (`127.0.0.1`, no writes, no pot key). Follow
already pulls the **journal** and the **atlas** (`content/` — every image and
file, hash-checked). Protocol vaults are replayed from the journal. Never
copy `signet/vault-keys.env` or `mainnet/vault-keys.env`. Refresh *code*
later with `git pull` + restart (never automatic), or `/validate` →
**Update my node folder** (sha256 fail-closed). Inventory and update
law: [`docs/RUN-NODE.md`](docs/RUN-NODE.md).

A local writer without history: `node apps/kray-net/server.mjs`. Follow first if you want *this* history.

### 3 · Prove — no infrastructure

```
cd apps/kray-core && npm ci
npm test                          # hermetic suite (~861,000 checks)
cd ../.. && npm run test:boot     # Signet ≠ mainnet isolation + official zip
```

On a running node:

- **`/burn`** — recompute the keyless burn address from Bitcoin's generator point.
- **`/verify`** — the burn, a donation against Bitcoin itself, the journal as a SHA-256 chain.
- **`scripts/follow/kray-follow.mjs`** — re-derive the cascade root; a tampered journal is refused.

## What's in this tree

| Path | What it is |
|---|---|
| [`apps/kray-core`](apps/kray-core/) | The law: ledger, signatures, conservation, cascade root, SPV, vaults. |
| [`apps/kray-net`](apps/kray-net/) | One process — writer, JSON API, explorer (`index.html`, `/validate`, `/verify`). |
| [`scripts/follow/`](scripts/README.md) | Door 2. Public houses: `follow` · `guardian` · `folder`. |
| *not here* | `later/` · `works/` · `PARENTS.md` — Creator desk. Follow never needs them. |
| [`networks/signet`](networks/signet/) · [`networks/mainnet`](networks/mainnet/) | Public recipes. Live keys stay in gitignored `/signet/` and `/mainnet/`. |
| [`docs/`](docs/README.md) | Axioms, folder law, constitution, audit dossier — indexed by status. |

A clone never contains journals, pot keys, or this machine's L1 oracle. Those paths are gitignored. `bash scripts/oss-guard.sh` refuses a leak.

## The law

The full frame is [`docs/AXIOMS.md`](docs/AXIOMS.md). Folder names:
[`docs/FOLDER-LAW.md`](docs/FOLDER-LAW.md) — locked now; mainnet ignited
freezes them. When a document and the code disagree, the code and its proofs win.

1. **Everything proven, nothing trusted** — signature ‖ Merkle proof ‖ Bitcoin anchor is the only path a byte of state may move.
2. **Conservation or HALT** — the ledger conserves after every event, or the node freezes.
3. **Proof-of-burn, no premine** — a ₭ is born only from a real satoshi destroyed at a keyless address. Total minted ≤ total burned. One mint ≤ 10,000 ₭.
4. **The 1-₭ fee is immutable** — no auction, no MEV, nobody priced out.
5. **No hard fork, ever** — unknown future events freeze the node. There is always exactly one Bitcoin-anchored chain.
6. **No owner** — each donation *is* the anchor. A follower can become the writer at the byte-exact root.
7. **Quantum-safe by design** — the past is hash-sealed; accounts may commit a post-quantum recovery key and transact with NIST **ML-DSA** ([`docs/QUANTUM-READINESS.md`](docs/QUANTUM-READINESS.md)).

## Sister project

[KRILL](https://github.com/tomkray/krill) — the reference tenant. Off-chain accounting mirrored onto KRAY, paid for with the ₭ it mines as a validator.

## Library

- [docs/](docs/README.md) — normative · design · historical
- [CHANGELOG](CHANGELOG.md) · [CONTRIBUTING](CONTRIBUTING.md) · [SECURITY](SECURITY.md)

---

<p align="center"><em>The dreams written in this book leap into reality, timeless.</em> ⛓₭</p>
