# Bitcoin mainnet — a new universe, zero kilometres

Public writer: `https://www.kray.network`

Same protocol as Signet. **New genesis. New journal. New bakery. New keys.**
The names are already the locked names in [`../../docs/FOLDER-LAW.md`](../../docs/FOLDER-LAW.md).
Do not copy `/signet/`, `data-signet/`, or the Signet journal here.
Do not invent `data-v2/` or a second API prefix for "a clean start."
This house is born with `data-main/` empty and `/api/kraynet` as the mouth.

**Status: ignited (2026-08).** Unique writer is Origin. Journal is `data-main/`.
Do not re-ignite. Do not start a second `KRAY_NET=main` writer. Updates:
official `AGENTS.md` § Ship — chrome-only rsync needs no restart; consensus
must reach Origin **and** every guardian follower.

## Wallet — seated, not launched

KrayWallet with DevNet **OFF** already talks to `https://www.kray.network` and
stays dark until the node answers. **Do not ship an “it’s live” extension zip.**
Igniting this writer **is** the public launch — every DevNet-OFF wallet will
hit the tab the same minute the URL answers. A `tb1` pot is refused.

## Prove the house (no writer)

```
node scripts/operator/preflight-mainnet.mjs
node scripts/operator/verify-mainnet-bridge.mjs
```

House pin: `house organized · writer dark · extension unshipped`.
Bridge pin: `bridge recipe + local hot env agree` — `KRAY_POT_ADDRESS` must
equal `deriveVault` of the pubs (rune deposits that miss that script are refused).

## Same Signet stack — own mainnet bytes

Signet was the production rehearsal. Mainnet is that same machine: donate NUMS
+ federation rune L2 + 2-of-3 exit. New journal, new `bc1` vault, burial 6.
A pot-key self-anchor is custody — refused. The vault pot stays the rune door.

| Door | Mainnet pin |
|---|---|
| Donate / burn mint | NUMS self-anchor (`KRAY_SELF_ANCHOR=1` + `BURN_INTERNAL_KEY`) · SPV · `KRAY_DONATION_CONF=6` · `KRAY_CONSENSUS_BURN_PROOF=1` |
| Rune deposit | pays the **vault** pot script · `ord` amount · `KRAY_CONSENSUS_RUNE_PROOF=1` |
| L1 oracle | bitcoind `:8332` · **required** `KRAY_ORD_URL` (writer refuses to invent it) |
| Backing | `KRAY_BACKING_GATE=1` |
| Exit | owner-signed → remote 2-of-3 book-check → cofre pot-signer |
| Secrets on Origin | none. No `KRAY_CONSOLIDATION_SECRET`. No `KRAY_VAULT_GUARDIAN_SECRETS` |
| Anchor | donation output at NUMS (same as Signet). Pot-key self-anchor = forbidden |

Signet leftover that must **not** land here: lab guardian secrets in `node-hot.env`,
timelock 144, `tb1` pot, mempool `/signet`, RPC `:38332`.

## Follow this history (when the writer is live)

```
git clone https://github.com/tomkray/kray-node.git KRAY-NODE
cd KRAY-NODE
cd apps/kray-core && npm ci && cd ../..
node scripts/follow/kray-follow.mjs --from https://www.kray.network --dir ./follower-main --watch --serve 4481
```

Windows: `scripts\follow\mainnet.cmd`.

Use `follower-main` and `:4481` so a machine that also follows Signet
does not mix the two books.

## Cofre (keys are gitignored — never in this README)

A local `/mainnet/` house may already hold a generated owner + 2-of-3 guardian
set. **You** still have to seal and Shamir. Phrase lives in your head (16+ chars).
Never in git. Never in chat. Never in `node-hot.env`.

```
KRAY_POT_SEAL_PASS='your-16+-char-phrase' \
  node scripts/operator/seal-vault-owner.mjs --env mainnet/vault-keys.env

KRAY_POT_SIGNER_PASS='your-16+-char-phrase' \
  node scripts/operator/split-owner-shares.mjs \
    --box mainnet/owner.box --out mainnet/shares
```

After a boxed signer unlocks once, re-run seal with `--retire-plaintext`.
Then: share-1 stays on this cofre; share-2 USB to a second box; share-3 steel/paper
offline. Never vitrine, never Origin disk, never iCloud.

## Writer env (operators — ignition day, not today)

`/mainnet/node-hot.env` is pubs + tokens only when generated locally.
Mint / use the **derived** `bc1` pot — never the Signet `tb1` vault.
The owner secret stays in `/mainnet/owner.box` on the key machine — never on the writer.
Guardian pubs + tokens only in `node-hot.env`. Vault set **before** the first deposit.

Cofre processes (loopback only — never Signet paths). Each `guardian-N.env`
already pins port + token + `KRAY_GUARDIAN_BOOK_URL=http://127.0.0.1:4481`
(the independent follower — never the writer).

```
KRAY_POT_SIGNER_PASS='…' node scripts/operator/pot-signer.mjs \
  --env mainnet/vault-keys.env --box mainnet/owner.box

node scripts/operator/guardian-signer.mjs --env mainnet/guardians/guardian-0.env
node scripts/operator/guardian-signer.mjs --env mainnet/guardians/guardian-1.env
node scripts/operator/guardian-signer.mjs --env mainnet/guardians/guardian-2.env
```

**The primary signer box holds two pens.** Signet rune-bridge signer stays `:4479` / `signet/`.
Mainnet signer is `:4579` / `mainnet/`. Unlock with
the operator unlock tool (see the private operator runbook).
Tunnel the loopback hole to the writer, never the Signet vitrine.
The pot-signer binary refuses a mainnet env on `:4479` and a Signet env on `:4579`.

**Fallback pen (same key, other hole).** Not a second vault. Not a second bind
on `:4579`. Spare box unlocks on **`:4580`** and tunnels that hole to Origin.
Writer health-gates: primary `:4579` alive → only the primary. Primary dark → only `:4580`.
A refuse from a live primary does **not** shop the fallback. Phrase typed on that
box. Not Origin. Not a guardian-threshold machine.

**Origin vitrine** is four houses — better than the Mini Mac one-folder mix
(`networks/mainnet/origin-vitrine/`). One appender. Move the folder, fill
`hot/machine.env` + `run/cloudflared.yml`, probe, start. Do not light a
second `ORIGIN-WRITER` while the first still writes.

```
./scripts/operator/pack-writer-vitrine.sh ./kray-writer-vitrine --with-code
./scripts/operator/sync-origin-vitrine.sh origin-novo
```

Then on Origin: `C:\kray-network-vitrine\run\probe.cmd`. Writer stays dark.
Sources `mainnet/node-hot.env` only. Mainnet bitcoind `:8332` + mainnet `ord` already
on Origin. Do not start from the laptop.

Live journal: `apps/kray-net/data-main/kraynet-journal-main.jsonl` (must start empty).

The writer refuses to boot if this folder still holds a Signet journal,
if the RPC is `:18454` (regtest) or `:38332` (Signet), if the pot is `tb1`,
or if `KRAY_TRUSTED_DEV=1`.

Ceremony (private): `kray-dev` → `skill/kray-dev/references/mainnet-ignition-ceremony.md`.
