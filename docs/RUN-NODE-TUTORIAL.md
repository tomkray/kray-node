# Run a KRAY full node — the copy-paste tutorial

> **Who this is for:** a person walking alone, no assistant, no prior node
> experience. Every command is copy-paste; every step says what you should
> see before you move on.
> **Who this is NOT for:** assistants / LLMs given this repo — they must
> follow [`RUN-NODE.md`](RUN-NODE.md) (quiz first, preflight, one recipe).
> This tutorial is that same road, flattened for a human. When the two
> disagree, `RUN-NODE.md` is the law.

**What you will have at the end:** a **full node** of the KRAY Signet
history on your computer — the whole journal (every signed act) and the
whole atlas (every inscribed file, hash-checked), re-verified by your own
machine, with your own explorer at `http://127.0.0.1:4480/`. No database.
No keys. Nothing to buy.

**What this does NOT make you:** the writer (there is exactly one public
pen; a second one would fork the book) or a key-holder of the pot vault
(those secrets are never downloaded — a "node" that asks for them is a
scam). Your node **verifies**; it trusts no one, including us.

**Still only Node.js.** The same replay re-checks Ӿ balances, FIREBORN
tanks, and every TK-fold Groth16 proof (a small WASM already in the
download). You do not install Rust, SP1, or a folder. When your
`cascadeRoot` matches `https://signet.kray.network/api/kraynet/head`,
you independently rebuilt the same money.

---

## Step 0 · Requirements (5 minutes, once)

You need **Node.js 24 or newer**. Check what you have:

```bash
node -v
```

If it prints `v24.x` or higher, skip to Step 1. Otherwise:

| Your OS | Install |
|---|---|
| macOS | `brew install node@24` (then open a new terminal) — or the installer from https://nodejs.org |
| Windows | Installer from https://nodejs.org (24+), then open a **new** terminal |
| Linux | Your distro's Node 24+, or the official binary from https://nodejs.org — do not stay on Node 18/20 |

Run `node -v` again until it says 24+. That is the only requirement.

## Step 1 · Download the code (1 minute)

```bash
git clone https://github.com/tomkray/kray-node.git
cd kray-node
```

(No `git`? Download the ZIP from that page and unpack it, or install git
first. This is the public door — not the developer backup.)

## Step 2 · Ask your machine first (preflight, 1 minute)

Before starting anything, run the preflight — it reads what is already on
this computer and refuses the classic traps for you:

```bash
node scripts/follow/preflight.mjs --universe signet --role follow
```

Windows: `scripts\follow\preflight.cmd --universe signet --role follow`

How to read what it prints:

| It says | It means | What you do |
|---|---|---|
| `[yes]` lines | that piece is ready | nothing |
| `[no ]` lines | missing but not fatal | read the hint on the line |
| `BLOCK …` and exit code 2 | a real stopper | fix exactly that line, run preflight again |
| `ALREADY: …` | a follower is already running here | don't start a second one — you're done |
| `NEXT` + a command | your machine is ready | that command is Step 3 |

Keep re-running the same preflight until there is no `BLOCK`.

## Step 3 · Start your node (one command)

```bash
bash scripts/follow/signet.sh
```

Windows: `scripts\follow\signet.cmd`

The first run installs the libraries by itself (that happens only once),
then starts the **follow**: your machine downloads the journal and every
star file, replays the whole history, and re-computes every hash. If a
single byte were wrong, it would refuse — that is the point.

**What you should see:** progress lines, then a line saying the explorer
is live. **Leave this terminal open** — the follow keeps watching the
network and re-verifying. Closing it stops your node (nothing breaks;
run the same command to resume).

## Step 4 · Prove it worked (2 minutes)

In a **second** terminal, from the same folder:

```bash
cat follower/CURRENT
ls "$(cat follower/CURRENT)"/kraynet-journal-signet.jsonl
ls "$(cat follower/CURRENT)"/content | wc -l
curl -s http://127.0.0.1:4480/api/kraynet/head
```

| Check | What a good answer looks like |
|---|---|
| `CURRENT` | a path ending in `node-signet` — the last **verified** snapshot |
| the journal file | exists — that is the book, every signed act |
| the `content` count | how many star files your node holds and hash-checked (0 on a young book is honest) |
| the `head` | JSON with `mirror: true` and a `cascadeRoot` — compare it with `https://signet.kray.network/api/kraynet/head`: same root = you re-derived the same history |

Now open **your own explorer**: `http://127.0.0.1:4480/` — this is your
node proving itself in your browser, no external dependency.

## Step 5 · (Optional) Earn from the fee pool

Running follow alone does not pay — earning is **presence**, and it takes
seconds in a browser:

1. Open `https://signet.kray.network/validate`
2. Connect **KrayWallet** (the extension)
3. Leave **Hold the library** checked → press **Start**

That is up to **3×** of the presence share; uncheck the library box on a
phone or a tight data plan for **1×**. Fees land on that wallet address
on the next Bitcoin seal. Honest limits: Signet ₭ is lab money, and a
quiet network means a small pool.

**Never** export your KrayWallet private key, and never paste any key
into the node or an `.env` — the tab only fetches public files and asks
the wallet for a powerless signature. Anyone who tells you otherwise is
attacking you.

## Step 6 · (Optional) The last polish: your own Bitcoin Core

Your node already re-verifies the whole KRAY history. Adding a **Signet**
Bitcoin Core makes it also re-prove every Bitcoin anchor from raw Bitcoin
bytes on your own disk. Do this only **after** Step 4 looks healthy:

1. Install [Bitcoin Core](https://bitcoincore.org/en/download/) (macOS: `brew install bitcoin`).
2. Give it a Signet-only config (`bitcoin.conf`):

```
signet=1
server=1
txindex=1
rpcuser=kraycore
rpcpassword=CHOOSE-A-LONG-SECRET
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
```

3. Start `bitcoind` and wait until `bitcoin-cli getblockchaininfo` shows
   `"initialblockdownload": false` (Signet is small; still give it time).
4. In the terminal that runs your follow (Ctrl+C it first):

```bash
export KRAY_BTC_RPC=http://127.0.0.1:38332
export KRAY_BTC_RPC_USER=kraycore
export KRAY_BTC_RPC_PASS='the-password-you-chose'
node scripts/follow/preflight.mjs --universe signet --role follow --proofs bitcoin
bash scripts/follow/signet.sh
```

Never point a Signet follow at a mainnet Core (preflight blocks the mix).

## Step 7 · Keeping your node current

Nothing updates itself — that is a safety lock, not a missing feature.
When you want the newest code:

```bash
git pull origin main
# then Ctrl+C the follow and run Step 3 again
```

Your journal and `content/` stay; only code moves. (Alternative:
`https://signet.kray.network/validate` → **Update my node folder** —
sha256 fail-closed.)

## When something goes wrong

| Symptom | Meaning | Fix |
|---|---|---|
| `node -v` prints v18/v20 | Node too old | Step 0, then a **new** terminal |
| `npm ci` fails inside the launcher | libraries could not install | check the network; then `cd apps/kray-core && npm ci` and read its error |
| `BLOCK … port 4480` | something already answers there | if it is your own earlier follow: you're done (see `ALREADY`); else close that program |
| `BLOCK … Node.js` / `house` / `folder` | preflight caught a trap | do exactly what the line says, re-run preflight |
| `THE ATLAS: … missing` in the follow output | a star file failed its hash check | the follow did **not** succeed — run it again; if it persists, the writer may be mid-update: wait, retry |
| head shows `stale: true` | the writer is quiet right now | honest, not broken: your snapshot is the last **verified** one |
| Windows: TLS / certificate error on bare `node …` | Node 24 on Windows needs the system CA store | use the doors: `scripts\follow\signet.cmd` (they pass `--use-system-ca`; never disable TLS) |
| the follow crashed once | almost always transient | do **not** delete `follower/` — just run Step 3 again; it resumes |

## Another universe: Bitcoin mainnet

This walkthrough is **Signet** (the recommended first day). Mainnet is
the same program, a different live book, real ₿. Writer:
`https://www.kray.network`. If that is what you chose:

```bash
node scripts/follow/preflight.mjs --universe main --role follow
bash scripts/follow/mainnet.sh          # Windows: scripts\follow\mainnet.cmd
```

Your explorer is then `http://127.0.0.1:4481/`. Journal + atlas land in
`follower-main/`. Never mix Signet follow with mainnet Bitcoin Core
(or the reverse). The quiz law for assistants is still
[`RUN-NODE.md`](RUN-NODE.md).

## Optional · custody-ready mirror (follow only)

The same follow already serves the rune book a custody guardian reads
before co-signing a pot withdraw. No extra command. Keep the box
always-on. Check:

```bash
curl -s http://127.0.0.1:4480/api/kraynet/runes/of/bc1ptest
```

(Use `:4481` on mainnet.) Serving the book is not holding a pot key.

## Optional · hear the book (`/mind`)

After Step 4 is green, open `http://127.0.0.1:4480/mind` (mainnet
`:4481`, lab `:4477`). A local model or a pasted key. The key never
hits the node. Follow does not need this. The mouth does not write
the journal.

## Optional · guardian, browser, or a private lab

| Want | Door |
|---|---|
| Earn (3×) | Step 5 — `/validate` + Hold the library |
| Always-on miner | `docs/RUN-NODE.md` § Guardian — dedicated key only, never your wallet |
| Private empty book | `docs/RUN-NODE.md` § Local empty writer — `:4477`, play ₭, not the public net |

## The safety rails (read once, remember forever)

- **Never** download `vault-keys.env`, `owner.box`, `node-hot.env`, or anything called "the pot keys". A follower needs no keys.
- **Never** run `apps/kray-net/server.mjs` thinking it makes you the public network — that is a private empty book. "Full node" = **follow**.
- **Never** paste a wallet private key into anything on this machine.
- **Never** install a database "for the journal" — the journal is a file.
- **Never** delete `follower/` to "fix" an error — read the error, resume.

That's the whole road. One command downloads the book and the library,
your machine re-proves both, and from that moment the writer can never
lie to you — you check the mathematics yourself, forever.
