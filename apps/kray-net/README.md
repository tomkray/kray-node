# kray-net — the node’s mouth

This folder is **not** a frontend. It is the node: one process (`server.mjs`)
loads `KrayNode` from `../kray-core` and serves JSON + this explorer. Same
job as `ord` — HTTP and HTML in one tree. The name `kray-net` is locked
([`../../docs/FOLDER-LAW.md`](../../docs/FOLDER-LAW.md)). Never `frontend/`,
`web/`, or `public/`.

URLs (`/validate`, `/kray.js`) are the contract. Files live next to the
server on purpose (`APP_DIR === this directory`).

## Stay at this root (process / CLI)

| File | Job |
|---|---|
| `server.mjs` | Writer + HTTP + static |
| `node-pack.mjs` | Official source zip for `/validate` |
| `kray-miner.mjs` | Headless guardian (Door 1) |
| `kray-spv.mjs` | Browser-parity SPV (CLI twin) |
| `burn-verify.mjs` | Offline burn-key recompute |

## Explorer (same folder — the `ord` analogue)

| Kind | Files |
|---|---|
| Chrome | `index.html` `kray.js` `kray.css` `kray-mark.svg` `nyx-mark.svg` `favicon.png` `apple-touch-icon.png` `logos/` |
| Chain | `blocks.html` `block.html` `tx.html` |
| People / stars | `profile.html` `star.html` `library.html` `rank.html` `blackhole.html` |
| Act | `inscribe.html` `send.html` `baptize.html` `mine.html` `rune.html` `dashboard.html` |
| Prove | `verify.html` `verify.js` `burn.html` `burn-proof.js` `proof.html` `anchor.html` `anchor-verify.js` |
| Guard | `validate.html` `validate.js` `node-update.js` |
| Docs / map | `docs.html` `map.html` `landcity.html` |
| Vendor | `vendor/three.min.js` `sound/` |

## Never source (gitignored)

`data-lab/` · `data-signet/` · `data-main/` · `*-harness/` · `*.log` · `*.bak`.
The packer skips them. Explorer files stay next to `server.mjs` — folder law
([`../../docs/FOLDER-LAW.md`](../../docs/FOLDER-LAW.md)), not a live-Signet caution.
