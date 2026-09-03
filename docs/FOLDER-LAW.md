# FOLDER LAW — the names of this tree

> **Status: NORMATIVE.** These are folder names, not deploy hints.
> Changing one after Bitcoin mainnet is ignited is a different network,
> not a refactor.

**"While Signet is live" is a false window.** Signet may be paused, a last
rename applied, and the same writer brought back. Mainnet ignited does not
make a rename easier — it makes it **forbidden**. The lock is now.

Mainnet is ignited. Its journal is `data-main/` — born empty, never a copy
of Signet. New `bc1` pot, new keys, these names already on the door. No
Signet journal. No era folder. No second chrome. A rename now is a
different network.

The protocol axioms live in [`AXIOMS.md`](AXIOMS.md). This page is the
geometry those axioms sit in. One protocol, two universes of state — same
binary, never the same folder. **Book vs first apps:**
[`BOOK-AND-APPS.md`](BOOK-AND-APPS.md) — a validator clones the book;
rune bridge / DeFi / pen / federation are applications on it, not a second node.

**The public door is one repository.** Users and validators clone
[`https://github.com/tomkray/kray-node`](https://github.com/tomkray/kray-node)
(`main`). Exam tools, if any, live in a private sibling folder. They are
not a second protocol and not a clone URL.

## Three houses

These are not three protocols. They are three roles of the same node.

| House | One sentence | Must never hold |
|---|---|---|
| **Official** | The node anyone clones. | Workshop, vault keys, journals |
| **Writer disk** | That same node as the unique writer, plus secrets and the journal | A second writer; a public bind of the pot-signer; a Funnel of the vault |
| **Workshop** | Our exam tools. Not the vault. Not Signet. | A clone URL; a claim that the official tree is incomplete without it |

A workshop is a private exam folder. For the live network it is zero.
Nothing is missing from the official clone because a workshop exists.

A stranger who clones official and says “run a node” is conducted by
[`RUN-NODE.md`](RUN-NODE.md): quiz, then preflight of **their** machine,
then follow. They are never this writer disk.

How a senior tells the houses apart:

- `scripts/exam/` or `scripts/lab/` on disk → this folder is a **workshop**.
- Neither folder, `origin` is `tomkray/kray-node`, branch `main` → **public door**.
- A live `KRAY_NET` process plus gitignored keys and a journal → **writer disk**.
  Never reclone over the journal. A follower is not this house.

Secrets (`vault-keys.env`, `owner.box`, `node-hot.env`) belong to the writer
disk. They are not workshop tools.

## Locked names

| Kind | Name | Never |
|---|---|---|
| Law library | `apps/kray-core/` | flatten into `kray-net` |
| Writer + explorer | `apps/kray-net/` | `frontend/`, `web/`, `public/` |
| L1 oracle (this machine) | `apps/kray-api/` | the public clone or the zip |
| Explorer chrome | `index.html` · `kray.js` · `kray.css` | leftover files named `v2.html` / `kray-v2.*` |
| JSON mouth | `/api/kraynet` | a second prefix |
| Signet journal | `apps/kray-net/data-signet/` | poured into main |
| Mainnet journal | `apps/kray-net/data-main/` | a copy of Signet; a lab path |
| Lab bench | `apps/kray-net/data-lab/` | a public network |
| Signet recipe | `networks/signet/` | confused with `/signet/` |
| Mainnet recipe | `networks/mainnet/` | confused with `/mainnet/` |
| Signet keys | `/signet/` (gitignored) | committed; copied onto mainnet |
| Mainnet keys | `/mainnet/` (gitignored) | the Signet vault |
| Signet follow | `follower/` `:4480` | `follower-main` |
| Mainnet follow | `follower-main/` `:4481` | `follower` |
| Docs | `docs/*.md` at this root | `docs/law/` as a second tree |
| Public scripts | `scripts/follow/` · `scripts/guardian/` · `scripts/folder/` | `exam/` · `lab/` · `operator/` · pot-signer on the official clone |
| Creator desk | `later/` · `works/` · `PARENTS.md` (this disk) | the public clone or the `/validate` zip |
| Public remote | [`github.com/tomkray/kray-node`](https://github.com/tomkray/kray-node) · `main` | any other remote as a user door |

Docs shelf grouping (Law / Run / Design / History) lives in
[`README.md`](README.md) only. Citations stay `docs/AXIOMS.md`.

## What is not a name

- **Era URL aliases** `/v2.html` · `/kray-v2.js` · `/kray-v2.css` — the writer
  serves the canonical files so old Signet bookmarks do not 404. They are
  not chrome. They never ship as files. Mainnet's door is `/` + `/kray.js`.
- **`data-v2/`** — leftover lab directory. Mainnet **refuses** it. Not a
  public name. Do not create it for genesis.
- **`test:v2`** — retired npm alias. The suite is `test:core`.
- **Era doc stubs** `KRAYNET-V2-BUILD.md` · `KRAYNET-V2-RUN.md` ·
  `anchor-stealth-v2.md` — one-line pointers. Cite the canonical names.

## Mainnet genesis — zero km

Before anyone says **liga**:

1. `apps/kray-net/data-main/` is empty (no journal, no atlas, no Signet file).
2. `/mainnet/` holds a **new** `bc1` pot and new keys — never `/signet/`.
3. `KRAY_NET=main` · `KRAY_DATA=apps/kray-net/data-main`.
4. RPC is Bitcoin mainnet. `:18454` and `:38332` are refused.
5. `KRAY_TRUSTED_DEV` is off. A `tb1` pot is refused.

`apps/kray-net/network-boot.mjs` + `npm run test:boot` re-prove the isolation.
Recipe: [`../networks/mainnet/`](../networks/mainnet/).

After ignition this page is closed. A rename is a fork.

## What a senior does not do

- Do not move the explorer into `web/` or `public/`. `APP_DIR` is
  `apps/kray-net/` on purpose — the `ord` analogue.
- Do not split `docs/` into physical subfolders.
- Do not rename `data-signet`, `data-main`, or `/api/kraynet`.
- Do not defer a rename "until Signet is quieter." Pause it, finish, resume —
  or do not start. After mainnet, do not start.
- Do not copy Signet state onto mainnet to "save time."
- Do not send a stranger to a workshop remote.
- Do not `git pull` onto a writer disk that already holds a journal.
- Do not start a second Signet writer.
- Do not treat exam storms as a public validator door.
