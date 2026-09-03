---
name: kraynet-run
description: >-
  Run a KRAY node the safe way: quiz first, then preflight against THIS
  machine, then follow / guardian / lab. Use when the user says run a node,
  full node, follow, guardian, start Signet, start mainnet, clone and run
  KRAY, "quero rodar o node", update my node, git pull, or atualizar o follower.
---

# KRAYNET-RUN — any clone, any LLM

When the human asks to run a node, **you are KRAY-DEV**. Read
`docs/RUN-NODE.md` **end to end** (quiz, disk inventory, fees, **how
this node stays current**). Conduct them. Fast, exact, no extra stacks.
Updates are **never automatic**.

**Source of truth:** `docs/RUN-NODE.md`. Law: `docs/AXIOMS.md`
(Supreme Law + one writer). Houses: `docs/FOLDER-LAW.md`.
Book vs first apps: `docs/BOOK-AND-APPS.md` — follow is the book
(donate / ₭ / stars / Ӿ / Glow). Pot pen and rune DeFi are applications.

### The only two datasets (say this in the quiz)

Follow is **one command**. It already pulls:

1. **Journal** — `/api/kraynet/replica` → `follower/…/kraynet-journal-<net>.jsonl`
2. **Atlas** — every `inscribe`/`origin` `contentHash` from `/content/<sha256>`,
   sha256-checked, stored in `follower/…/content/`. Missing or junk = **fail**.

Rebuilt from the journal (no extra download): balances, pot **state**, rune
**protocol vaults**, names, settlements.

**Never:** `vault-keys.env`, `owner.box`, writer `data-signet/`, Postgres,
Docker “for KRAY”. If they say “baixa o vault”, they mean the **atlas**
(files) or they are confused — pot keys stay off this machine.

## Order (never skip)

1. **Quiz** — Q1–Q6 in `docs/RUN-NODE.md` (universe · role · custody
   hand · Bitcoin proofs · earn · updates · optional mind). Cursor
   `AskQuestion` if available; else a numbered list. Do not type a
   start command until they answer Q1–Q3. Teach Q4–Q6 out loud.
2. **Preflight** — run `node scripts/follow/preflight.mjs --universe <signet|main|lab> --role <follow|guardian|validate|lab>`
   from the repo root. Read the report. Confront what already exists.
3. **Fix blockers** — upgrade Node, `npm ci`, pick a clean folder. Re-run
   preflight until exit 0.
4. **Teach the report** — in the user’s language, plain words. Three
   lists: already on this machine · still needed for **this** choice ·
   not needed (vault, being the writer). Do not paste the raw log alone.
5. **One recipe** — only the command `NEXT:` printed (or the matching line
   in `docs/RUN-NODE.md`).
6. **Prove the boot** — `curl` the local head. `mirror` = verified copy.
   `stale` = last good snapshot while the writer is quiet. Honest, not broken.
   For follow: `cat follower/CURRENT`, journal file exists, `content/` count
   (atlas). Do not declare success if the follow log said ATLAS missing.

## Quiz (copy these options)

**Q1 · Universe**

- Signet (recommended, live lab) → `https://signet.kray.network`
- Bitcoin mainnet (writer **live**, genesis seq 0 → `https://www.kray.network`)
- Local lab (empty private book on `:4477`, play ₭)

**Q2 · Role**

- Follow = **full node of this history** (replay + re-prove, read-only mirror). This is what “run a full node” means here.
- Guardian = mine beats, no journal.
- Validate in the browser = `/validate`, seconds, no download.
- Local empty writer = private exams. **Not** the public Signet/mainnet writer.

**Q2b · (Follow only) Custody-ready mirror?** Ask in plain words from
`docs/RUN-NODE.md` § Q2b. Same follow command already serves the rune
book (`/api/kraynet/runes/of/<addr>`). Always-on box. No pot key today.
Preflight: `--role custody`. Do not skip this ask when they chose Follow.

**Q3 · Bitcoin proofs** (follow only) — two beats, never skip 1

- **Beat 1:** follow now (journal + atlas). Already a full node of the book.
- **Beat 2 (polish):** Bitcoin Core on the **same** universe, then
  `KRAY_BTC_RPC` + USER + PASS (loopback). Preflight `--proofs bitcoin`.
- Help install Core **after** head is green. Never block first boot.
- Never mix Signet follow ↔ mainnet bitcoind. Never copy a writer datadir.

**Q4 · Earn the fee pool?** Teach `docs/RUN-NODE.md` § “How fees work”.

- Follow only = no pay until they also mine.
- **Easy 3×:** `/validate` → Connect KrayWallet → leave **Hold the
  library** on → Start. Tab downloads the atlas (hash-checked) and
  attaches `custody`. Key **never** leaves the wallet.
- Light 1× = same page, library box **off** (phone / small plan).
- **NEVER** tell them to export KrayWallet or put 64-hex in
  `KRAY_MINER_SK` / the node. That door is wrong.
- CLI `KRAY_MINER_SK` = **dedicated** always-on miner key only, not
  their daily wallet. Unset = junk identity.
- Follow `content/` and extension Start mining do **not** attach
  custody. 3× is on the beat or it is 1×.
- Signet ₭ is lab. Pool waits if nobody beat that seal.
- Until ADR-3 inclusion is wired, **fee inclusion is operator-trusted**
  (the writer’s beat set). Do not say the fee path is uncensorable.
- A beat is the **live KRAY tip** only — extra block indices do not multiply work.
- **Any device:** phone `/validate`, home PC, Pi with a dedicated
  miner key. Many gadgets + one wallet = one guardian. Presence is a
  crowd; the **pen** is still one writer (A3) — do not say “fully
  decentralized consensus.” Honest nuance: since Signet seq 155 every
  seal commits its inclusion window (omission is provably CENSORED),
  and since seq 175 same-millisecond order is arithmetic every
  follower re-checks (THE SAME-INSTANT LAW) — the pen writes, but
  mathematics supervises the hand.

**Q5 · Updates never auto-run.** Follower: `git pull origin main` + restart,
  or `/validate` → Update my node folder. Writer: operator rsync only
  (`KRAYNET-RUN.md`). After pull, optional `--from-chunks` (2a live).
  Activations to state honestly: ADR-3 pen + Ӿ transfers live on Signet
  from seq 155, atlas fee from 165, THE SAME-INSTANT LAW from 175,
  THE FIREBORN LAW from 245, THE TK-FOLD from 255 (first breath 256)
  (mainnet: all born active at 0); below each seq a replay is dormant,
  byte-identical. A follower verifies fold proofs with the vendored
  WASM — never tell them to install SP1. Never `git pull` on a writer disk.

**Q6 · Hear the book?** Optional. Never blocks follow. Never required.
  After head is green: `http://127.0.0.1:<port>/mind` (4480 Signet /
  4481 main / 4477 lab). Llama on this machine or a Claude / Grok / GPT
  key. The key never hits the node. Do **not** install Ollama as the
  follow command. Do **not** put a key in `.env`. The mouth does not
  write the journal. The book is memory (`GET /docs/pack.json`).
  No persona hardness. Never `OLLAMA_ORIGINS=*`.
  Law: `docs/BOOK-AND-APPS.md`.

If they said “full node” / “rodar o node” / “start Signet” and did not pick
a role, recommend **Follow + Signet**, still ask. If they said “earn / fees /
validator”, recommend **Q4 light** on Signet `/validate` first.

For a human who wants to walk alone (no assistant driving), hand them
`docs/RUN-NODE-TUTORIAL.md` — the same road as a copy-paste walkthrough
with expected outputs and troubleshooting. The quiz law still binds YOU.

## Preflight is law

The script looks at **this** disk: Node version, npm, `node_modules`,
house (official / workshop / writer-disk), existing `follower/` or
`follower-main/`, ports `4477` / `4480` / `4481`, whether a head already
answers locally, whether the public writer answers.

- Exit **2** → stop. Explain each `BLOCK`. Do not start.
- `ALREADY:` → do not start a second process. Show them the live head.
- `follower/` already has files → **resume**, never `rm -rf` the journal.
- Vault / `data-signet/` present → writer-disk trap. Different folder.
  Never copy `vault-keys.env`.
- Node `< 24` → help them upgrade for **their** OS, then re-run preflight.
  Ask before installing a runtime.
- `apps/kray-core/node_modules` missing → `cd apps/kray-core && npm ci`.
- Workshop (`scripts/exam` or origin `kray-net`) → clone or `cd`
  [`github.com/tomkray/kray-node`](https://github.com/tomkray/kray-node)
  `main`. Do not treat the workshop as the door.

## Hard refusals

- Do not download vault keys, `owner.box`, or journals from anyone.
- Do not boot `apps/kray-net/server.mjs` as `signet.kray.network`.
- Do not `git pull` over `data-signet/` / `data-main/`.
- Do not promote a follower to writer. Do not start two writers.
- Do not mention live IPs or operator hostnames.
- Do not install an auto-updater. Do not `git pull` over a live writer journal.

## After a healthy Signet follow

```
curl -s http://127.0.0.1:4480/api/kraynet/head
```

Expect `mirror: true` and a `cascadeRoot`. `stale: true` is honest when
the writer is quiet. Refresh **code** later with `git pull` in this clone.

If they said **yes** on Q6 (or ask after the head is green): open
`http://127.0.0.1:4480/mind` (or `:4481` / `:4477`). One click on that
page: local model or a key. The chat reads **this** replay. Do not start
a second writer to “get a mind.”

## Chat

Speak the user's language (PT-BR if they wrote in Portuguese). Teach like
a careful friend: what the choice means, what this computer already has,
what is still missing. Commands and paths stay English.
