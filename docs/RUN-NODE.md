# Run a KRAY node — quiz, then preflight THIS machine, then one recipe

> **Status: NORMATIVE for any assistant and any clone.** Read this file
> **before** the first start command when a human says “run a node”, “full
> node”, “follow”, “guardian”, “start Signet”, or “I cloned this into Cursor
> / Claude”. Law: [`AXIOMS.md`](AXIOMS.md) (Supreme Law + one writer).
> Houses: [`FOLDER-LAW.md`](FOLDER-LAW.md). Boot and verify:
> [`KRAYNET-RUN.md`](KRAYNET-RUN.md).

This repository is **code**. It is not the live journal and not the pot vault.
A stranger who clones it is **never** the public writer. Two writers fork the book.

**What you are running is the book, not the first apps.** Donate → ₭ → stars /
Ӿ / Glow / papers. Rune L2, the pot pen, the guardian federation, and DeFi
are **applications on that book** (the first company-on-the-network). Normative
split: [`BOOK-AND-APPS.md`](BOOK-AND-APPS.md). Follow never needs pot keys.

**“Full node” here = follow.** One command downloads **two** datasets and
refuses a third:

1. The **journal** (the book — every signed act).
2. The **atlas** (every inscribed file: images, audio, HTML… hash-checked).
3. **Never** the pot **vault keys**. Those are the writer’s secrets.

It does **not** mean `apps/kray-net/server.mjs`. There is **no SQL / Postgres /
Mongo** to install. Protocol “vaults” (rune locks) live **inside** the journal
and are rebuilt on replay. See § “What follow puts on disk”.

## 0 · The usual path in 3 commands (map, not a shortcut)

For the most common answer — **Signet + Follow** — the whole journey is:

```bash
git clone https://github.com/tomkray/kray-node.git && cd kray-node
node scripts/follow/preflight.mjs --universe signet --role follow
bash scripts/follow/signet.sh        # Windows: scripts\follow\signet.cmd
```

That is the public door. The launcher installs libraries by itself the first time
and starts the follow; the explorer of **your own** node opens at
`http://127.0.0.1:4480/` once it verifies. Needs only **Node.js 24+**
(`node -v`). No database, no keys, no Docker.

**What that node verifies by itself (no extra app):** every signature,
every ₭ and Ӿ balance, THE FIREBORN LAW's tanks, every Groth16
`fold-seal` on the TK-fold lane (a 255 KB WASM already in the clone —
you do **not** install Rust, SP1, or a “folder”). Anyone who replays
the same journal reaches the same `cascadeRoot`. If a byte lies, the
node HALTs. That is the whole security.

**Assistants: this box is the map, not permission to skip.** Run the quiz
(§ 1) first — the human may actually want guardian, browser, or lab — and
never start a command while preflight still prints a `BLOCK`.

**Humans walking alone** (no assistant): the same road, flattened into a
copy-paste walkthrough with expected outputs and a troubleshooting table —
[`RUN-NODE-TUTORIAL.md`](RUN-NODE-TUTORIAL.md). This file stays the law.

## 1 · Stop — quiz first (interactive)

A fresh clone into Cursor / Claude: the human says **“I want to run a KRAY
node”** / **“quero rodar o node”**. You become KRAY-DEV. Present this quiz
(`AskQuestion` if available, otherwise a numbered list). **Do not start a
process until they answer.** Recommend defaults. Never skip the ask.

Questions, in order: Q1 universe · Q2 role · Q2b custody mirror · Q3
Bitcoin proofs · Q4 earn? · Q4b any device · Q5 updates never auto ·
Q6 hear the book? (optional — never blocks follow).

### Q1 · Which universe?

| Option | When | Writer URL |
|---|---|---|
| **A · Signet** (recommended to learn) | Public lab, live | `https://signet.kray.network` |
| **B · Bitcoin mainnet** | Real ₿ — **writer live**, genesis seq 0. Same software, new book | `https://www.kray.network` |
| **C · Local lab** | Empty journal, play ₭, `bcrt1…` | none — `http://127.0.0.1:4477` |

Signet ≠ mainnet. Never copy a journal, pot, RPC, or data directory across.

### Q2 · What do you want this machine to *be*?

| Option | Plain English | Writes the public book? | Downloads | Never download |
|---|---|---|---|---|
| **1 · Follow (full node)** | Pull journal + **every star file**, replay, hash-check, serve a read-only mirror. Fail-closed if a file is missing or junk. | No | Journal + atlas (`/content/<sha256>`) | Pot keys, `owner.box`, writer `data-signet/` |
| **2 · Guardian** | Mine beats / earn. Easy 3× = `/validate` + Hold the library. | No | Beats only | Pot keys · wallet hex |
| **3 · Validate in the browser** | `/validate`. Seconds. | No | Nothing | Pot keys |
| **4 · Local empty writer** | Private exam book. Not Signet. | Only its own empty journal | Nothing public | Live keys |

If they said “full node” or “run KRAY”, recommend **1** after they confirm Q1.

### Q2b · (Follow only) Do you also want your mirror to be a CUSTODY-GUARDIAN book? (ask this)

If they chose **Follow**, ask one more question, in plain words:

> “Your mirror can also serve the **rune book** — the page a custody guardian reads before it co-signs any
> pot withdraw. A guardian daemon never trusts the writer’s word: it asks an independent mirror *“does this
> exiter truly hold that balance?”* and refuses if the book says no. **Do you want your mirror to be one of
> those books, and help guard the pot?”**

| Answer | What changes | What it needs |
|---|---|---|
| **Yes — guardian-ready mirror** | Nothing extra to run: the normal follow command (`--serve 4480`) already serves `/api/kraynet/runes/of/<addr>` on current code. Keep the box **always-on**. | Node.js 24+ (`node -v`) · the follow command below · code at or after the `runes/of` mirror route (`git pull` if older) · polish: your own Bitcoin Core (makes the mirror **gold** — anchors re-proven here) |
| **No — just a copy** | Follow as normal. You can opt in later with a `git pull` + restart. | Nothing extra |

**Say the honest part out loud:** serving the book does NOT make you a key-holding custody guardian today —
on Signet the sealed custody slots are the operator’s rehearsal set (lab keys). On **mainnet**, custody
guardian slots go to **independent operators with real sealed keys**, and they are drawn from exactly this:
proven, always-on, book-serving mirrors. This question is how you raise your hand. Verify yours answers:
`curl -s http://127.0.0.1:4480/api/kraynet/runes/of/<any-address>` → `{"runes":[…]}`.

Preflight has a dedicated role for this check: `node scripts/follow/preflight.mjs --role custody`.

### Q3 · How hard should Bitcoin proofs be? (follow only)

The **bible is two beats**. Do not skip beat 1 to wait for Bitcoin.

| Option | What happens |
|---|---|
| **A · Follow now** (recommended first day) | Journal + atlas land and replay. Cascade root must match. Anchors stay **hints** until bitcoind exists. **This is already a full node of the book.** |
| **B · Then add Bitcoin Core** (the last polish) | Same follow, plus **this** machine’s bitcoind. Each seal is re-proven from raw Bitcoin bytes. Perfect. |
| **C · I already have bitcoind** | Preflight pings it. Chain must match (Signet follow ↔ Signet Core). |

Do **not** block the first boot on a bitcoind they do not have. Do **not**
point a Signet follow at a mainnet Core (or the reverse). Help them
install **after** follow is green — § “Bitcoin Core — the last polish”.

### Q4 · Do you want to earn the fee pool? (teach this out loud)

Follow **alone** does not pay. Earning is **presence**: you prove you were here.
Then say the money path in their language (full detail: § “How fees work” below).

| Option | What they become | Typical pay |
|---|---|---|
| **No — just a copy** | Follow only. Verify the book. | Nothing, until they also mine. |
| **Yes — light (phone / small plan)** | `/validate` → Connect → **uncheck** Hold the library → Start | **1×** presence |
| **Yes — library in the tab (recommended 3×)** | `/validate` → Connect KrayWallet → leave **Hold the library** on → Start. The tab downloads `/api/kraynet/atlas` + `/content/<sha256>` (hash-checked) and attaches `custody` to each beat. | Up to **3×** if the writer verifies hits |

**The easy 3× door is that checkbox.** Say this out loud: the spending key **never leaves KrayWallet**. The tab only fetches public star bytes and a powerless `signMessage`.

**NEVER** (stop and correct them):

- Export the KrayWallet private key
- Paste 64-hex into the node, `.env`, or `KRAY_MINER_SK`
- “Put my wallet key on the machine that is running”

`KRAY_MINER_SK` is only for a **dedicated** always-on miner identity — a new key, not their daily wallet. Unset = junk demo identity, not their KrayWallet.

Follow’s `content/` on disk does **not** pay 3× by itself. Wallet **Start mining** (extension) is still **1×** until that surface attaches the same proof. Same wallet on ten devices **merges, never doubles**.

### Q4b · Any device can be a guardian (say this out loud)

The **cups** (fee share + Glow) go to **proven presence**, not to a data
center. Light guardian is SHA-256 + a powerless signature. No ASIC
requirement. No chain sync.

| Device | How | Typical tier |
|---|---|---|
| Phone / tablet | Browser → `signet.kray.network/validate` + KrayWallet. Uncheck the library on a tight data plan. | 1×, or 3× if they hold the library |
| Laptop / home PC | Same `/validate` door. Leave **Hold the library** on. | up to **3×** |
| Always-on box (“nerd miner”, Pi, old mini) | `guardian.mjs` + a **dedicated** miner key (not the daily wallet) + atlas dir | 1× or 3× on that process |
| Many gadgets, one wallet | They **merge**. Ten phones ≠ ten shares. | Still one guardian |

The network **wants many watches**. A thousand homes beating is healthier
than one farm. Linear split: more honest machines = each cup is smaller,
the book is harder to capture.

**Honest decentralization (do not overclaim):** anyone may **verify**
(follow) and anyone may **earn** (guardian). The **pen** that appends the
public journal is still **one writer** (A3). Two writers fork the book.
But the pen’s hand is bound by mathematics every follower checks: from
**block zero** (born active on today’s signet and mainnet after the
v1.0.0 genesis reset; the old chain crossed it at seq 155) every seal
commits its inclusion window (omitting a deadline-carrying act is
provably CENSORED, from Bitcoin bytes), and from the same block zero
(old-chain crossing seq 175) acts landing in the **same millisecond** must stand in
the one order arithmetic derives (`sha256` of the signed bytes) — not
even the writer chooses. Succession primitives exist; they are not the
live pen yet. That is the truth — a people-first network with a
mathematically supervised pen, not “Bitcoin-complete consensus.”

### Teach in plain words (before any command)

After they answer, say this in **their language**, short, no jargon first:

| They chose | Say this |
|---|---|
| Signet | The public practice network. Safe. Live today. |
| Mainnet | Real Bitcoin. Same program, a different book. Writer live. Follow `:4481`. |
| Local lab | A private toy book on this computer. Nobody else sees it. |
| Follow | This computer keeps a **verified copy** of the book **and every star file** (images, songs…). One command. No extra database. No pot keys. It does **not** pay you until you also mine. |
| Custody mirror | Your mirror also serves the **rune book** — the page a custody guardian reads before co-signing a pot withdraw. Same follow command, always-on box. No key today; on mainnet, guardian operators are chosen from mirrors like yours. |
| Guardian | Phone, PC, or a small always-on box. Proves “I was here.” Earns a cup from the 1 ₭ pool. Many devices, one wallet = one guardian. |
| Browser | Open `/validate`, connect KrayWallet, press start. Seconds. Fees land on **that** wallet address. |
| Earn 3× | Open `/validate`, leave **Hold the library** on, Start. Not “I run follow.” Not “paste my wallet key into the node.” Extension Start mining is still 1×. |
| Bitcoin polish | After follow is green: install Signet Bitcoin Core on this PC. Then this machine re-proves every seal. Same universe only. |
| Updates | Never automatic. You `git pull` this clone (or the /validate button), then restart follow. Writer is a different ritual. |
| Local writer | A private exam book. It does **not** make you Signet. |
| Mind (optional) | After the head is green: open `/mind` on **this** node. Tap a local model or paste a key. The node never sees the key. Follow does not need this. |

### Q5 · Updates are never automatic (say why)

A live book must not overwrite itself in the dark. That is a **safety lock**,
not a missing feature.

| House | How code arrives | Never |
|---|---|---|
| **This clone (follow)** | You decide: `git pull origin main` in the clone, then restart follow. Or `/validate` → **Update my node folder** (sha256 fail-closed). Journal and `content/` stay; only **code** moves. | Auto-update. `git pull` on a **writer disk**. |
| **Public writer** | Operator rsync + restart (`docs/KRAYNET-RUN.md`). Strangers do not do this. | `git pull` over `data-signet/`. |
| **Guardian / browser** | Next page load / next `git pull` of the clone that runs `guardian.mjs`. | A silent updater. |

After a pull, re-run preflight, then the same follow command. Optional
`--from-chunks` (below) needs that new code.

### Q6 · Hear the book? (optional — never blocks follow)

The node is the **body**. A mouth is an **app** (`docs/BOOK-AND-APPS.md`).
Follow is already complete when the head is green.
Do **not** install Ollama, a vendor key, or a “module” as part of the
follow command. Do **not** delay beat 1 for a mouth.

Ask in plain words, after they understand follow:

> “This computer will hold a verified copy of the book. When the head is
> green, you can **talk** to it — your Llama on this machine, or a
> Claude / Grok / GPT key. The key never hits the node. Do you want that
> after the book is live, or only the copy for now?”

| Answer | What you do | Never |
|---|---|---|
| **Yes — open Mind** | After `curl` head is green: open `http://127.0.0.1:<port>/mind` (Signet follow `:4480`, main `:4481`, lab `:4477`). One page: install Ollama if missing, tap a model (progress), or paste a key. Chat uses **this** node’s book (`GET /docs/pack.json` + sealed twelve when present). No persona hardness. | Put a key in `.env`. Proxy a key through the node. Require a model to follow. Tell them `OLLAMA_ORIGINS=*`. |
| **No — just the book** | Follow is done. They can open `/mind` later. | Shame them. Hide the door. |

Say out loud: **the mouth does not write the journal.** `/mind` is a
product wrap. A stranger who refuses it has lost nothing of KRAY.

Then run preflight and **read the report out loud** in the same simple voice: what they already have, what they still need for **this** choice, what they do **not** need (vault, being the writer, an LLM). Do not dump the raw log without translating `[yes]` / `[no ]` / `BLOCK`.

## 2 · Preflight — confront THIS machine first

Always run this **after** the quiz and **before** `npm ci`, follow, guardian,
or `server.mjs`. It reads what is already on the disk and refuses the usual
traps (old Node, workshop folder, writer-disk vault, port already serving).

```bash
node scripts/follow/preflight.mjs --universe signet --role follow
```

| They chose | Flags |
|---|---|
| Signet follow (usual) | `--universe signet --role follow` |
| Signet follow + Bitcoin polish | `--universe signet --role follow --proofs bitcoin` |
| Custody mirror (Q2b — serve the rune book) | `--universe signet --role custody` |
| Mainnet follow | `--universe main --role follow` |
| Guardian | `--universe signet --role guardian` |
| Browser only | `--universe signet --role validate` |
| Local empty writer | `--universe lab --role lab` |

Windows: `scripts\follow\preflight.cmd --universe signet --role follow`.

Machine-readable: add `--json`.

### What the script checks (and what you must do)

| Check | Pass | Your job if it fails |
|---|---|---|
| This folder is a KRAY tree | `apps/kray-core` + `scripts/follow` exist | Clone `https://github.com/tomkray/kray-node.git` |
| House | official origin, no exam/lab, no vault | Workshop → official clone. Writer-disk + follow → **different folder**. Never copy keys. |
| Node.js | `>= 24` (`package.json` `engines`) | Upgrade, then **re-run preflight**. Do not start. |
| npm | on `PATH` | Install npm with Node. |
| `apps/kray-core/node_modules` | present | `cd apps/kray-core && npm ci && cd ../..` |
| Disk free | ≳ 1 GB | Free space. Journal is small today and grows. |
| `./follower` or `./follower-main` | missing **or** already there | Already there → **resume**, never wipe. |
| Ports `4477` / `4480` / `4481` | free, or already **this** node | If a head already answers, do not start a second process. |
| Public writer | Signet or mainnet answers `/api/kraynet/head` for the universe they chose | Network down → wait. Do **not** invent a local public writer. |
| `KRAY_BTC_RPC` | optional | Unset is fine for first follow. |

Exit **0** = continue (warnings allowed). Exit **2** = stop. Fix every
`BLOCK` line. Re-run the same command until it is 0.

If the last line is `ALREADY:` a follower is already serving. `curl` that
head. Do not start another `--serve` on the same port.

### Node too old — help for their OS, then verify again

Show `node -v` vs `>= 24`. Ask before installing a runtime.

| OS | Typical path |
|---|---|
| macOS (Homebrew) | `brew install node@24` then put it on `PATH` |
| Windows | Install LTS/Current **24+** from https://nodejs.org — then open a **new** terminal |
| Linux | distro Node 24+ or the official Node binary; do not stay on Node 18/20 |

Then:

```bash
node -v
node scripts/follow/preflight.mjs --universe signet --role follow
```

## What follow puts on disk — teach this in the quiz

There is **no separate “download the vault” step** and **no database to
install**. One follow command pulls everything a replica may hold. The
`FOLLOWER_CONTRACT` refuses the snapshot if a star file is missing or does
not hash to the journal.

### Two words that sound like “vault”

| Word | What it is | Does a follower take it? |
|---|---|---|
| **Atlas / contents** | Every inscribed file (JPEG, PNG, MP3, HTML…) named by `sha256` | **Yes — automatic.** `GET /content/<hash>`, then sha256 must match the journal or the file is junk. |
| **Protocol vault** (rune lock, bakery pot *state*) | Numbers and addresses **inside the journal** | **Yes — by replay.** No extra file. The reducer rebuilds balances, pot, rune vaults, names, settlements. |
| **Pot vault keys** | `vault-keys.env`, `owner.box`, `node-hot.env` | **Never.** Those move Bitcoin in the bakery pot. A stranger with them is a thief path, not a node. |

If the human says “baixa o vault”, answer: *the library of images is the
atlas — follow already fetches it. The pot keys you must never download.*

### What the command creates (Signet)

```
follower/
  CURRENT                         → path of the last verified run
  run-<timestamp>/
    node-signet/
      kraynet-journal-signet.jsonl   ← the book (every signed act)
      content/
        <64-hex sha256>              ← one file per star (image, song, page…)
```

Mainnet uses `./follower-main/` and `kraynet-journal-main.jsonl`.

`--watch --serve 4480` keeps a **read-only** mirror on loopback:

- `/api/kraynet/replica` — the verified journal (another stranger can follow *you*)
- `/content/<sha256>` — the same bytes you hash-checked
- `/api/kraynet/head` — `mirror: true`, cascade root

### What is NOT a download

- Postgres, SQLite server, Redis, Docker compose “for KRAY”
- The writer’s `data-signet/` folder
- Anyone mailing you a zip of keys
- A second copy of `apps/kray-core` as a “database”

Disk: journal is small today and grows one line per act. Atlas grows with
every inscription. Preflight warns below ~1 GB free. Signet is still a
lab — not hundreds of GB.

### After follow — prove the library is here

```bash
cat follower/CURRENT
# …/node-signet
ls "$(cat follower/CURRENT)"/kraynet-journal-signet.jsonl
ls "$(cat follower/CURRENT)"/content | wc -l
curl -s http://127.0.0.1:4480/api/kraynet/head
```

The `wc -l` of `content/` is how many star files this replica held and
checked. Zero stars on a young book is honest. A follow that printed
`THE ATLAS: … missing` **did not succeed** — do not tell them they have a
full node.

Easy 3× earn is the `/validate` checkbox (library in the tab). Optional
CLI: `guardian.mjs` may keep `guardian-atlas/` with a **dedicated** miner
key — same bytes, a second folder for mining, not a second truth. Never
the daily wallet hex.

## Bitcoin Core — the last polish (after follow is green)

Follow without bitcoind is already a **verified copy of the KRAY book**.
Adding Bitcoin Core on **the same universe** is what makes every seal
re-proven from **this** machine’s raw Bitcoin bytes. That is the last
polish. The assistant helps install it **after** `curl …/head` looks
healthy — never instead of follow.

### Signet (the usual polish)

1. Install [Bitcoin Core](https://bitcoincore.org/en/download/) (or `brew install bitcoin` on macOS). Ask before installing.
2. A `bitcoin.conf` for **Signet only** (loopback RPC — never 0.0.0.0):

```
signet=1
server=1
txindex=1
rpcuser=kraycore
rpcpassword=CHOOSE-A-LONG-SECRET
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
```

3. Start `bitcoind`. Wait until it is **not** in initial block download
   (`getblockchaininfo` → `initialblockdownload: false`). Signet is small
   next to mainnet — still can take a while. Do not copy a writer’s
   Bitcoin datadir.
4. In the **same terminal** that will re-run follow (password stays in
   the shell, not in git):

```bash
export KRAY_BTC_RPC=http://127.0.0.1:38332
export KRAY_BTC_RPC_USER=kraycore
export KRAY_BTC_RPC_PASS='the-password-you-chose'
node scripts/follow/preflight.mjs --universe signet --role follow --proofs bitcoin
# when preflight says Bitcoin Core answers · chain signet · synced:
node scripts/follow/kray-follow.mjs --from https://signet.kray.network --dir ./follower --watch --serve 4480
```

A mixed chain is a **BLOCK**. Signet KRAY + mainnet Core = refuse.

### Mainnet Core

Hundreds of GB and days of sync. Only if they chose universe **B**.
Do not start a local `server.mjs` to “make Signet more real.” Mainnet
follow is `--from https://www.kray.network`. This clone is never the
public writer.

### What Bitcoin adds (plain words)

| Without Core | With Core (same universe, synced) |
|---|---|
| Journal replayed, root matches, atlas hash-checked | Same, **plus** each seal/donation re-proven from raw tx + headers on **this** disk |
| Anchors are hints | A lying writer cannot invent a Bitcoin burn |

## 3 · Hard refusals (any assistant)

- Do **not** download `vault-keys.env`, `owner.box`, `node-hot.env`, or `/signet/` `/mainnet/` keys.
- Do **not** boot `apps/kray-net/server.mjs` as if this clone became `signet.kray.network`.
- Do **not** `git pull` / reclone over a live `data-signet/` or `data-main/`.
- Do **not** copy Signet state onto mainnet.
- Do **not** invent a second public writer, Raft, or “promote this follower”.
- Do **not** `rm -rf follower/` because a follow failed once — read the error.
- Do **not** install a SQL database “for the journal”. The journal is a file.
- Do **not** fetch pot keys because someone said “vault”. Atlas ≠ pot vault.
- Do **not** mix Signet follow with mainnet `bitcoind` (or the reverse).
- Do **not** copy a writer’s Bitcoin datadir or RPC password into git.

## 4 · Recipes (only after quiz + preflight exit 0)

### Follow Signet — the usual “run a full node”

Easiest (installs libraries by itself the first time):

```bash
bash scripts/follow/signet.sh          # Windows: scripts\follow\signet.cmd
```

Or the explicit two steps (identical result):

```bash
cd apps/kray-core && npm ci && cd ../..   # skip if preflight said modules are present
node scripts/follow/kray-follow.mjs --from https://signet.kray.network --dir ./follower --watch --serve 4480
```

When it verifies, the explorer of **your own** node is live at
`http://127.0.0.1:4480/` — leave the terminal running.

### How this node stays current

Nothing updates itself. You (or your assistant, when you ask) pull **code**.
The book on disk is rebuilt by follow, not by git.

```bash
cd /path/to/this/clone
git pull origin main
# restart the follow process (Ctrl+C, then the same command as first boot)
```

Or open `https://signet.kray.network/validate` → **Update my node folder**.
It writes official source into the folder you pick. Journal, follower
data, and keys stay.

**What a pull brings (honest):**

- ADR-2 **2a** (availability) **is live in the follower**: the mirror can
  serve `/api/kraynet/chunks`, and you may pull the journal in pieces.
- ADR-3 primitives (inbox / order / inclusion / censorship / succession)
  are **activation-gated**: born active at **seq 0** on today’s signet
  and mainnet (Article XIV, ratified 2026-08-23; crossed live on the old
  Signet chain at seq 155, retired with the v1.0.0 genesis reset). Below
  an activation seq a replay sees them dormant — byte-identical history.
  They still never make a follower the writer by themselves. Since
  activation every seal commits its window, so omitting a deadline-
  carrying act is provably CENSORED; wiring that verdict into
  succession is still a manual, evidence-backed act.
- **Ӿ transfers** are live from seq 0 on both nets (old-chain pin 155):
  the transferable light minted from burned ₭ can move between addresses.
- **The atlas fee** is live from seq 0 on both nets (old-chain pin 165): a sized
  inscribe/origin pays `max(1, ceil(size / rate))` ₭ to the TREASURY
  beside the untouched 1 ₭ burn — the validators who hold the atlas are
  funded by the bytes they carry. The door quotes it before you sign.
- **THE SAME-INSTANT LAW** is live from seq 0 on both nets (old-chain pin 175):
  acts the writer stamps into one millisecond must stand in the journal
  in the one order arithmetic derives — `orderWindow` over the sha256 of
  the bytes each author signed. Your replay ENFORCES it: a journal that
  lies about same-instant order HALTs this follower at the forged line.
- **THE FIREBORN LAW** is live from seq 0 on both nets (old-chain pin 245): the
  x-send fee is prescribed (0 ₭ with tank + 3.5 s gap; else 1 ₭). Your
  replay re-derives every tank. A forged counter is a different root.
- **THE TK-FOLD** is live from seq 0 on both nets (old-chain pin 255,
  first breath 256): each `fold-seal` is re-verified on replay
  by the vendored WASM. You do not forge proofs. You check them. A
  lying fold HALTs this follower at that line.

**Pieces from more than one peer** (after that pull). `--from` plus optional
`--peers` (comma-separated). Each chunk is content-addressed; a lying peer
cannot feed junk. Example — writer + a **second follower you control**
(never invent a public IP):

```bash
node scripts/follow/kray-follow.mjs --from-chunks \
  --from https://signet.kray.network \
  --peers http://127.0.0.1:4481 \
  --dir ./follower --watch --serve 4480
```

One machine is enough: omit `--peers` (the writer is already in `--from`).
See the public manifest: `curl -s https://signet.kray.network/api/kraynet/chunks`

The writer is updated only by the Creator phrase in
[`KRAYNET-RUN.md`](KRAYNET-RUN.md). A follower **never** becomes that ritual.

Keep the process in the foreground (or a dedicated terminal). When the first
replay finishes:

```bash
curl -s http://127.0.0.1:4480/api/kraynet/head
```

Expect `mirror: true`, a `cascadeRoot`, and (if the writer is quiet)
`stale: true`. That is honest: last **verified** snapshot, not a second pen.

**The stale law (persist mode).** A cycle that fails any proof — the writer
unreachable, the atlas incomplete, a history that does not replay here, a
check failing — never takes the mirror down: it keeps serving the last
verified snapshot with `stale: true`, `staleSince` and `staleReason`, and
retries next cycle. A guardian's book therefore answers "lagging" at the
withdraw door, never a crash loop. One-shot mode (no `--serve`/`--watch`)
still exits 1 — the stranger's clear verdict. `KRAY_FOLLOW_PREFIX=refuse`
makes the mirror keep its snapshot when the writer's verified history does
not extend it (a rewrite as seen from this box); the default `warn` adopts
it but labels every answer with `prefixBreak`.

`--serve` is loopback, read-only. An inbox on a mirror, if enabled, **stores
and relays** signed acts — it never applies them.

Updates are **never automatic**. See § “How this node stays current”.

### Follow mainnet (when they chose B)

```bash
node scripts/follow/kray-follow.mjs --from https://www.kray.network --dir ./follower-main --watch --serve 4481
```

Windows: `scripts\follow\mainnet.cmd`. Expect `https://www.kray.network/api/kraynet/head` → `network: main`. This clone stays a mirror.

### Guardian (no journal)

```bash
node scripts/guardian/guardian.mjs https://signet.kray.network
```

**Easy 3× (teach this first):** open
`https://signet.kray.network/validate` → Connect KrayWallet → leave
**Hold the library** checked → Start. The tab pulls the stars and puts
`custody` on the beat. The key **never** leaves the wallet.

Uncheck the box = presence **1×** (phone / small plan).

**NEVER** export KrayWallet or set `KRAY_MINER_SK` to that hex.

**Always-on CLI (optional, dedicated key only):**

```bash
export KRAY_MINER_SK='a-new-64-hex-not-your-wallet'
export KRAY_ATLAS_DIR="$(cat follower/CURRENT)/content"   # or omit to download a second copy
node scripts/guardian/guardian.mjs https://signet.kray.network
```

Unset `KRAY_MINER_SK` = junk demo identity, not their KrayWallet.
Proof: `/validate` log `🛡 N/8` and the settlement custody column.
A signed sentence “I have the atlas” is refused — only those hashes.

### Local empty writer (lab only)

```bash
KRAY_NET=regtest KRAY_TRUSTED_DEV=1 node apps/kray-net/server.mjs
```

→ `http://127.0.0.1:4477`. Play ₭ only. Isolation refuses a mixed universe.

## How fees work — teach this whenever they ask about earning

Normative for any assistant. Law: A2 (every act costs **1 ₭**), A4 (split is
**linear in proven work**), A7 (mined ₭ is fuel). Code: fee pool in the
ledger; beats in `economics/beat-pow.ts`; pay on seal in the writer
(`settleFeePoolOnSeal`). Do not invent a bank payout or a new mint.

### Where the money comes from

Every public action (send, inscribe, swap, …) burns exactly **1 ₭** as the
fee. That ₭ already existed. It goes into the **fee pool** (the treasury).
Nobody prints extra ₭ for validators. From **seq 0** on both nets
(old-chain pin 165) a **sized** inscribe/origin also pays the **atlas fee** —
`max(1, ceil(size / rate))` ₭, quoted by the door before you sign — into
the same treasury: the people who hold the library are paid by the bytes
they carry. Creative burns themselves (the fire) still pay nobody.

### What you do to be paid

1. Use **your** KrayWallet on `/validate` (Connect → Start). The key
   stays in the extension. Do **not** paste it into `KRAY_MINER_SK`.
   A CLI miner without a dedicated key mines a **demo identity** — the ₭
   does not land in their wallet.
2. Run it on **whatever they already own**: phone tab, PC, Raspberry Pi,
   a small SHA-256 box left on. The puzzle is ordinary SHA-256, not a
   Bitcoin ASIC lottery. The network is meant to be a **crowd of homes**,
   not a warehouse.
3. Each Bitcoin block hash is a **beacon**. Your device searches for a SHA-256
   beat bound to `(beacon ‖ your address)`. You sign
   `kray.beat.submit.v1` — a **powerless** signature: it can never move
   money, only prove “I was here.”
4. The writer gathers beats. The same address on many devices **merges**. A
   thousand fake names earn what one machine earns (sybil-neutral). Many
   real homes make the watch **decentralized**. The journal **pen** is
   still one writer — say that too.

### When ₭ actually arrives

On the next **confirmed Bitcoin seal** of the KRAY book:

- If your address had proven beats → the pool is split
  `your_work / everyone’s_work` (linear). `/validate` with **Hold the
  library** attaches `custody`; the writer verifies it against **its**
  atlas (8 challenges, address-salted, beacon-fresh) → up to **3×**.
  Unchecked box, or extension Start mining = **1×** (no `custody` on the
  POST). Follow’s `content/` is not read for pay. The factor 3 is a
  **launch placeholder** (`custody.ts`); if **everyone** who settles has
  the same hits (all 0, or all 8), the linear split pays the same — the
  bonus only shows when the field is mixed.
- If **nobody** beat that seal, the pool **waits** in the treasury. It is
  not given to an operator.

The ledger **credits your KRAY address**. That is the receive. Not a bank.
Not satoshis in Bitcoin. Open the wallet: the balance is ₭ you can spend
as the next 1 ₭ fee (inscribe, send, …).

### Where they look

| Place | What they see |
|---|---|
| `https://signet.kray.network/validate` | Live work, **Your balance**, pool size, **every settlement table** (who got how much) |
| KrayWallet | Same address, same ₭ after the seal |
| `/dashboard` | Network pulse: supply, pot, presence |
| A follower’s `/api/kraynet/head` | Same book, same settlement — every full node re-derives the table |

### Honest limits (say them)

- **Signet ₭ is lab.** Mainnet is live (real ₿, genesis seq 0) — do not promise
  a fat fee pool on day one. Follow without mining still earns zero.
- Follow **without** mining = a verified copy, **zero** fee share.
- Quiet network = small pool. Pay waits for a seal **and** proven beats.
- Demo miner key = they are not earning to themselves.
- A beat is valid only on the **live KRAY tip** (`GET /beat/challenge`.block). Extra block indices do not multiply work. At seal, one best beat per address is paid if it still sits within 128 heights of the tip. `presenceTip` is a whole number or the event HALTs (a string is not the old path). New settlements (seq ≥ 121) must carry it — including `settleFromBeats` (omit seq = live era). One p2tr is one row (bech32 case and trailing space fold). Since the ADR-3 activation (born active at seq 0 on both nets; old-chain pin 155) every seal commits its inclusion window into the anchored root — omission of a deadline-carrying act is provable; and since THE SAME-INSTANT LAW (seq 0; old-chain pin 175) the order of acts inside one millisecond is arithmetic every follower re-checks, not the writer's hand. Across distinct instants time orders — the `at` rides the anchored bytes.
- **ADR-3 inclusion is ACTIVE from seq 0 on both nets (old-chain pin 155).** The writer still assembles the beat set (durable `presence-beats.json`, then the journal at seal), but every seal now commits its window — a follower re-derives pay from the journal's claims AND can prove omission of a deadline-carrying act (CENSORED, from Bitcoin bytes). Call fee inclusion **evidence-backed, not auto-enforced**: the verdict's wiring into succession is still a human act, so do not oversell it as automatic.
- Custody **3×** is a launch placeholder (`custody.ts`). Streaming bytes at challenge time, and one disk behind many salted addresses, are expensive — not killed. The bonus only shows when the field is mixed.

## 5 · Prove (optional, same clone)

```bash
cd apps/kray-core && npm ci && npm test
cd ../.. && npm run test:boot
```

On a live writer or your mirror: `/burn` · `/verify`.

## What to tell the human (one paragraph)

A **follower** is a full node of **this** history: it re-derives the book and
refuses a lie. A **guardian** proves “I was here” and is paid from the **1 ₭
fee pool** on each Bitcoin seal, to **their wallet address** — 1× light, up
to 3× when `/validate` holds the library on the beat. A **writer** is one machine plus secrets — this clone
is never that machine. Signet is the live lab; mainnet is the same
software on a different live book (real ₿). Never mix the two.
