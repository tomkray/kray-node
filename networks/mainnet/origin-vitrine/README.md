# Writer vitrine — four houses, one appender

The Mini Mac Signet vitrine mixed **code + `bin/` + journal** in one folder.
A `git checkout` once deleted the run-layer and took `signet.kray.network` down
(exit 78). This house does **not** repeat that. Four rooms, one root.

One writer. Two writers = fork. A follower on another disk is a book, not a
second appender. If this machine dies, you **move this folder** (or pack a
fresh one), fill `hot/machine.env`, and start the **same** writer there.

```
<KRAY_VITRINE_ROOT>\
  code\      official tree (rsync). Never vault. Never journal. Safe to update.
  run\       operator wrappers + Cloudflare. Never inside code\.git
  hot\       node-hot.env + machine.env. Pubs + THIS bitcoin.conf
  state\     data-main\  (empty until ignition — this is the journal)
```

Default root on Origin: `C:\kray-network-vitrine`. On a new box, set
`KRAY_VITRINE_ROOT` in `hot\machine.env` (the only file you must edit).

| House | Holds | Must never hold |
|---|---|---|
| `code\` | `apps/kray-core`, `apps/kray-net/server.mjs` | `vault-keys.env`, `owner.box`, Signet journal |
| `run\` | probe / start-writer / start-tunnel | Owner/guardian secrets |
| `hot\` | pubs + door tokens + RPC user/pass | `KRAY_CONSOLIDATION_SECRET`, Signet `tb1` |
| `state\` | `kraynet-journal-main.jsonl` after ignition | Signet journal, lab `data-v2` |

Bitcoind mainnet, `ord`, and the Kray L1 API **already live on this disk**.
They are not copied here. `machine.env` only **points** at them.

The primary signer box keeps the pens (`:4579` / Signet `:4479`). This disk is paper.

## Move to another machine (minimum swap)

1. Copy the four houses (USB / `pack-writer-vitrine.sh`). Take `state\` if the
   journal already exists — that **is** the chain.
2. Edit **`hot\machine.env`**: root path, RPC user/pass, `KRAY_ORD_URL`.
3. Edit **`run\cloudflared.yml`**: this disk's tunnel UUID + credentials JSON.
4. Touch `hot\ORIGIN-WRITER` only on the box that will write. Never on the laptop.
5. `probe` green → `start-tunnel` → `start-writer` (ignition).

Do not start a second `ORIGIN-WRITER` while the first is still appending.

## Doors

```
run\probe.cmd / probe.sh              prove bitcoind chain=main + ord + pot bc1p. Writer stays dark.
run\start-writer.cmd / start-writer.sh ignition. Opens a visible console — that window is the writer lamp.
run\watch-writer.cmd / install-writer-watch.cmd  minute watchdog. Leaves a live :4478 alone.
run\start-tunnel.cmd                  cloudflared → 127.0.0.1:4478. Safe while dark (502).
```

Update rite (never `git checkout` blind):

1. rsync official **code only** into `code\` (`scripts/operator/sync-origin-vitrine.sh`)
2. `run\` / `hot\` / `state\` stay on disk
3. `probe` — same cascade / same isolation
4. Only then restart the writer process

Pack a portable folder (no SSH): `scripts/operator/pack-writer-vitrine.sh ./kray-writer-vitrine`
Install on Origin: `scripts/operator/sync-origin-vitrine.sh origin-novo`
