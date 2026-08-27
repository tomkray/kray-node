# `apps/` — three houses, three jobs

This folder is not a grab-bag. Each child is a different *kind* of program.
Validators clone **core + net**. They never need the L1 oracle.

| House | Kind | What it is | Ships in the official clone |
|---|---|---|---|
| **`kray-core/`** | library | The ledger. Signatures, reducer, conservation, cascade root, SPV, vaults. No HTTP, no HTML. | **Yes** — `npm ci` here |
| **`kray-net/`** | node + explorer | One process: journal I/O + JSON API + the website (explorer, `/validate`, `/verify`). | **Yes** — `node server.mjs` |
| **`kray-api/`** | L1 oracle | Local Bitcoin Core + `ord` gateway. Not the ledger. | **No** — gitignored; this machine only |

Ordinals analogy (same split, our names):

| Bitcoin / Ordinals | KRAY |
|---|---|
| Consensus rules (`libbitcoinconsensus`) | **`kray-core`** |
| `ord` HTTP + HTML explorer | **`kray-net`** (`server.mjs` + the pages) |
| `bitcoind` / `ord` RPC on the operator box | **`kray-api`** (never the public tree) |

`scripts/follow/kray-follow.mjs` is the second node: it imports `kray-core` and talks to a `kray-net` writer. It is not a fourth app. The stable door `scripts/kray-follow.mjs` remains for `/validate` and older recipes.

---

## `kray-core` — the law

Pure TypeScript. Tests live next to the engine (`src/test/`). Import from `src/index.ts`.

```
src/
  protocol/    the chain: journal, ledger, node, stars, pot, vaults, runes, identity
  economics/   fee split, beats, custody, rune book (Glow/gov/raffle are shelf)
  anchor/      cascade root → Bitcoin (payload + SPV)
  test/        hermetic proofs (~861k checks)
```

External tenants (KRILL, Radiola, Satspace, Station) are other houses. They are not this node and do not ship in the public clone.

If it can change a ₭ or a star without going through the reducer, it does not belong here.

---

## `kray-net` — the door the world sees

One Node process (`server.mjs`) loads `KrayNode` from `kray-core` and serves:

- **JSON** `/api/kraynet/*` — wallet, follower, `/validate` beats
- **HTML/CSS/JS** — explorer (same job as `ord`’s UI, fuller: land, library, donate, prove, update)

Pages (all served from this folder; `APP_DIR` is here on purpose):

| Surface | Files |
|---|---|
| Explorer chrome | `index.html`, `kray.js`, `kray.css` |
| Chain | `blocks.html`, `block.html`, `tx.html` |
| People / stars | `profile.html`, `star.html`, `library.html`, `rank.html` |
| Act | `inscribe.html`, `send.html`, `baptize.html`, `mine.html`, `rune.html` |
| Prove | `verify.html`, `burn.html`, `proof.html`, `anchor.html` |
| Guard | `validate.html`, `validate.js`, `node-update.js`, `node-pack.mjs` |
| Docs | `docs.html` |
| Map / city | `map.html`, `landcity.html` |

**Not source** (gitignored, stay on the writer disk): `data-lab/` · `data-signet/` · `data-main/` · `*-harness/` · `*.log` · `*.bak`.

Do not rename this folder to `frontend/`. The explorer is not a separate SPA — it is the node’s mouth. Names: [`../docs/FOLDER-LAW.md`](../docs/FOLDER-LAW.md).

---

## `kray-api` — stay off the clone

Bitcoin RPC + ord proxy for *this* operator. A follower brings their own `bitcoind` via `KRAY_BTC_RPC`. Packing this into `/validate` “Update my node folder” is forbidden.

Explorer chrome is `index.html`, `kray.js`, `kray.css`. Era URLs
(`/v2.html`, `/kray-v2.js`, `/kray-v2.css`) are writer aliases, not names.
The packer skips leftover era filenames so the official zip stays clean.

---

## What a senior does *not* do

- Do not flatten `kray-core` into `kray-net`. The follower must import the library without the website.
- Do not force `src/{core,infrastructure,presentation}`. The two live names already *are* that split.
- Do not move the HTML into a `web/` or `public/` tree. Folder law, not a live-Signet caution.
