# THE RITE — the map of what may never break, and how we prove it hasn't

**Status: normative.** When this document and the code disagree, the code and its proofs win
and this file gets a header saying so.

The foundation of KRAY.NETWORK is finished and proven. From here everything is **evolution**, and
every evolution is built on top of that base. So the one thing that must never happen is a change
that breaks the base — because a change that breaks the base is not an evolution, it is a
different network.

The rite is how we know, before and after every change, that the base is still standing.

> Read this before touching anything. Run the rite after touching anything. Update only what
> actually moved, and leave the rest exactly as it is.

---

## 1 · The base — what may never break

Five load-bearing truths. Each one has a way to prove it is still true; if you cannot run the
proof, you do not know, and "I think it still works" is not an answer this project accepts.

| the truth | what it means | how the rite proves it |
| --- | --- | --- |
| **The Supreme Law** | `signature ‖ Merkle proof ‖ Bitcoin anchor` is the only path a byte of state may move. No admin key, no override, no convenience door. | the suite (every refusal), and the anchors in `/api/kraynet/audit` |
| **Enforced twice** | Every refusal lives at the door (API) **and** in the reducer (replay). A rule in only one place is half a rule, and the replay is the verifier. | the suite's door/reducer pairs; `adversarial-audit.ts` |
| **Conservation or HALT** | `Σ balances == emitted − burned`, every ₭ backed, every rune solvent. A node that cannot re-derive a line stops; it never guesses. | `/api/kraynet/audit` → `intact · conserves · backed · runesSolvent · ammSolvent` |
| **No hard fork (A3)** | New law arrives on a **per-network activation sequence pin**. Below the pin the act does not exist; at and above it, it does. An old node meeting a new act **FREEZES** — it never forks. | cold replay on every live network, byte for byte |
| **The journal is the only truth** | Any state a cold reboot cannot re-derive from the journal + stored proofs is not part of the chain. | `scripts/cold-replay.mjs` |

A sixth, quieter one: **value never crosses networks.** An address of another network is refused at
the door before anything else is considered.

### The pins, and why they are the shape of evolution

A new act is added by pinning it, per network, at the sequence where it becomes law:

```ts
export const MINT_DROP_SEQ: Record<string, number> = { regtest: 0, signet: 243, main: 82 }
```

Everything below the pin replays exactly as it always did — that is why adding an act cannot
rewrite history. **A chain with no act of that kind hashes byte-identically before and after the
change.** This is the mechanism that lets the project evolve forever without ever breaking its own
past, and it is why the cold replay is the single most important step of the rite: if the live
chains still re-derive byte for byte on the new code, the base did not move.

---

## 2 · The map — the roles

This file names **roles**, never machines. The live host map is operator-local
(`scripts/operator/`, kept out of the public tree on purpose) — see [`POT-CUSTODY.md`](POT-CUSTODY.md).

| role | what it is | does a protocol change reach it? |
| --- | --- | --- |
| **writer** | one per network. The only house that appends to the journal. | **yes** — it computes the law |
| **guardian / follower** | an independent mirror that replays the writer's journal from public bytes. Several per network. | **yes** — it replays the law, so it must know it, or it freezes (correctly) |
| **pen / signer** | holds keys. Deliberately **off git** and outside every deploy. | **no** — never sync a pen for a protocol change |
| **vitrine** | the public face: static chrome (`kray.js`, `*.html`) served from disk per request. | chrome only — **no restart needed, ever** |
| **validator** | anyone who proves beats against a live Bitcoin beacon. Earns the fee pool at each seal. Not a fixed role and not a privileged one. | no — it is a client of the law |

**Ordering law:** on a protocol change, **guardians go first**, then the writer. A guardian that
does not yet know an act freezes on it; a writer that produces an act its guardians cannot read
strands the mirrors. First teach the readers, then let the writer speak.

**Never mirror, always overlay.** A deploy extracts over the existing tree. Mirroring deletes
`apps/kray-core/node_modules` and kills the follower.

---

## 3 · The flows that must keep breathing

The base is not only structure — it is motion. These cycles are what "working" means.

**The anchor cycle.** `donate → self-anchor → seal → settlement → payout`. The node never anchors
by itself: **the donation IS the anchor** (`KRAY_SELF_ANCHOR=1`). A seal closes a block; the
settlement re-derives its whole payout table from journaled beats and HALTs on disagreement —
self-proving, never a handed-in table. Fees with no validator present do not vanish; they wait in
the pool until someone proves beats.

**The market.** Three shapes, one book, and their custody is the thing to hold in your head:

| shape | who holds the value while it waits | who may take |
| --- | --- | --- |
| **drop** | the seller keeps it — the offer can go stale | the first hand |
| **harvest** | escrowed at signature, in the keyless pot | a named list of addresses |
| **mint** | escrowed at signature, in the keyless pot | anyone, one equal pot each, nobody named in advance |

The pot is `KRAY_CLAIM` — keyless **by encoding**: bech32's alphabet is all lowercase, and
`KRAY_` has capitals and an underscore, so no input can ever produce that string.

**The runes.** `deposit (SPV-proven) → credits → send → exit`. The reserve is inviolable: reserve
== credits + locked, always, or the audit says so out loud.

---

## 4 · THE RITE

In order. Each step answers one question, and a red result means **stop** — not "probably fine".

### Step 0 · Measure before you touch
Read the layer above. Know the undo. Never invent a blocker, and if a measurement contradicts an
instruction, show the measurement.

### Step 1 · The suite
```sh
cd apps/kray-core && npm run test:fast     # test:fast ENDS by calling test:core — it is the superset
```
Exit 0, zero failures. Skips are allowed only when they announce themselves and say why.
*Proves:* the law refuses what it must, in the reducer and at the door.

### Step 2 · The cold replay — the most important step
```sh
node scripts/cold-replay.mjs
```
A stranger pulls every content-addressed chunk from each live node, re-hashes each against the
address that node published, and replays the whole journal from an empty ledger **on this code**.
The replay root must equal the published root, byte for byte, on **every live network**.
*Proves:* the base did not move. If this is red, the change is a fork — stop and do not deploy.

### Step 3 · Every house holds the published law, and every node is running it
```sh
bash scripts/operator/fleet-law-check.sh
```
The authority is `origin/main`, never a local checkout. Three questions: does every house hold the
same runtime files; did every node process start **after** its own code was written; and does every
live edge **answer** as the current law (a read-only `prepare` must come back with the current
law's own refusal).
*Proves:* what is deployed is what was published, and what is running is what is deployed.

### Step 4 · Every book fresh, every door answers, every rune solvent
```sh
bash scripts/operator/fleet-health.sh
```
*Proves:* the fleet is alive and in agreement, and custody is intact.

> **Steps 1 and 2 run from any clone. Steps 3 and 4 do not:** `scripts/operator/` is kept out of the
> public tree on purpose (it carries the host map), so a stranger's clone will not have those two
> scripts. What a stranger *can* do is stronger anyway — steps 1 and 2 need nothing but this code and
> the public bytes, and between them they prove the law refuses what it must and that every live
> network re-derives byte for byte. That is the whole guarantee; the operator scripts only tell the
> operator whether their own houses are in step with it.

### Step 5 · Only then, stamp
Write the sync revision **after** the files have been measured, never in the same breath as the
extraction. See §5.

---

## 5 · The scars — every law here was paid for

These are not style preferences. Each one is a real incident, and each is why a step of the rite
exists.

- **The stamp lies.** Two guardians reported the correct sync revision while missing nine runtime
  files — the whole market — with their books frozen on `unknown event kind`. The deploy writes the
  stamp in the same `ssh` as the extraction, so a partial extraction still stamps.
  **Extract → hash → only then stamp.** (A3 held perfectly: they froze, they never forked.)
- **A process outlives its code.** A node ran 36 days with current files on disk that it had never
  reloaded, serving a reducer from before the market existed. **Uptime is not proof of health.**
- **A refusal for the wrong reason is not a proof.** An adversarial audit printed 38 green checks
  from an unfunded wallet: every attack was refused for *insufficient balance* instead of for the
  law under test. **Assert the fixture before firing a single attack, and make a refusal count only
  when it refuses for the law being tested.**
- **A green suite nobody runs is a guardian asleep.** Sixteen suites existed that no runner named.
  Periodically diff the test directory against the runner strings in `package.json`.
- **A 200 proves nothing.** Unknown paths fall back to the app shell. **Check the content — the
  `<title>`, the bytes — never the status code.**
- **The door and the reducer must refuse the same thing.** A refusal that lives only in `submit`
  still opens the user's wallet. Mirror every refusal into the prepare-time door *and* the reducer.
- **Never restart a pen for a protocol change.** The pens do not replay the reducer.

---

## 6 · Adding a new act without breaking the base

A new user action must be named in **four** places. Missing one is silent until it is expensive:

1. the **reducer** (`apps/kray-core/src/protocol/ledger.ts`) — the case, and its activation pin
2. `USER_KINDS` (`apps/kray-core/src/protocol/node.ts`) — or the node refuses to submit it at all
3. the **door** (`apps/kray-net/server.mjs`) — prepare + submit, with every refusal mirrored
4. the **fee catalog** — `eternal-fee-completeness.test.ts` must know it, or the guardian goes red

Then: pin it shut on every live network first (`regtest: 0`, the public nets at a future sequence),
prove it, and ratify each network at its own sequence. Constructor parameters are appended at the
**end** only — the pin test refuses a reordering, on purpose.

---

## 7 · What the rite does NOT cover

Said plainly, so nobody mistakes silence for a guarantee:

- It does not prove a **validator is present**. Fees accumulate in the pool with nobody to pay, and
  that is correct behaviour, not a fault — but it is also not "the payout flow is exercised".
  Exercising it means someone proving beats.
- It does not watch units belonging to **other projects** that happen to share a host.
- It does not verify the **pens** (they are outside every deploy, by design).
- It does not prove a **Bitcoin anchor has confirmed** — only that the anchors the node claims are
  the anchors the journal supports. Confirmation depth is read from `/api/kraynet/head`
  (`finality.anchor.tier`).

---

*The base is proven. Everything after it is evolution, and evolution rides on the base — never
through it.*
