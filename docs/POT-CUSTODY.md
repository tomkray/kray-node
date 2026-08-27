# Pot custody — who can move the bakery metal

Law: Article XIII (bridge ≠ ledger) · Article VI (anchors witness, they do not unlock).
The signed `rune-exit` authorises dest and amount. This page is only about **who
holds the pot owner key**.

## The three keys (simple)

The bakery pot is one Bitcoin address with two doors, both of which start with
the **owner** (`CHECKSIGVERIFY` first):

| Key | What it is | What it can do alone |
|---|---|---|
| **Owner** (consolidation) | one 32-byte secret | After the timelock (~1 day on Signet): sweep the pot. Before that: nothing without guardians. |
| **Guardians** (2 of 3) | three secrets, threshold 2 | **Nothing.** Without the owner signature the leaf does not even start. |
| **Your wallet** | your Taproot key | Deposit and receive. Never a leaf on this pot. |

So the nuclear key is the **owner**. Guardians speed a cooperative withdraw; they
cannot steal. That is already a theorem (`vault.ts`).

## The ladder (each rung is real; do not skip)

1. **One process (left behind, 2026-08-17).** The previous Mini Mac process held
   the owner secret in RAM. That process was stopped. The running node sources
   `node-hot.env` and talks to the cofre via loopback. Rung 1 is no longer live.
2. **Two processes, same machine (this slice).** `scripts/pot-signer.mjs` holds
   the owner secret and binds `127.0.0.1` only. The public node holds the
   **pubkey**, a door token, and (on Signet lab) the guardian secrets. A hack of
   the HTTP API cannot sign. A hack of the whole Mini Mac still can. The signer
   rebuilds the payout and refuses a dest that is not the signed exit.
2b. **Owner secret boxed at rest (this slice).** scrypt + AES-256-GCM
   (`pot-key-box.ts`). Stolen file ≠ pot. Running signer still has the key in
   RAM. Phrase is yours, not a file next to the box.
3. **Ceremony.** Start the signer only when you intend to pay. The attack window
   is the time the signer is up. Public auto-withdraw then needs you present.
4. **Second machine.** Signer on another box; the node reaches it only through a
   localhost tunnel. Compromising the public host does not yield the secret.
5. **Split the owner (Shamir 2-of-3 — this slice).** GF(256) in
   `pot-key-share.ts`. Any two `signet/shares/share-N.json` rebuild the 32-byte
   owner; one share is not the pot. Reconstruct, then reseal `owner.box` and
   unlock the signer as today. This is **not** FROST (no distributed signing).
   Carry share-2 by USB to a **cofre-only** box. Never the vitrine, Origin, or
   the L1 Umbrel. Never Tailscale-bind the signer. Never put a host in git.
6. **Hardware.** The owner secret never sits on a disk. Harder here: the leaf is
   tapscript, not a plain BIP-86 key path. Named, not now.
7. **Covenants (`OP_CTV`).** Bitcoin itself would lock where the pot may pay.
   Not on Signet today.

**Encrypt the owner secret on the public process? No** — the process that decrypts
is the one the attacker already has. Theater.

**Encrypt it for the private signer, at rest? Yes.** A stolen `vault-keys.env` is
then not the pot, unless they also have your passphrase. While the signer is
running the key is open in RAM (honest). `scripts/seal-vault-owner.mjs` writes
`signet/owner.box`; the signer opens it with `KRAY_POT_SIGNER_PASS`. The phrase
never lives in `node-hot.env`.

## Files (gitignored — one house per network)

Signet lab uses `signet/`. Bitcoin mainnet uses `mainnet/` (empty until ignition).
Never copy one into the other.

| File | Holds | Who may load it |
|---|---|---|
| `signet/vault-keys.env` | Signet owner secret (until retired) + pubs + lab guardian secrets + door token | **only** the pot-signer |
| `signet/owner.box` | Signet owner secret encrypted; useless without your phrase | pot-signer with `KRAY_POT_SIGNER_PASS` |
| `signet/shares/share-N.json` | one Shamir share (not the pot) | two shares + phrase rebuild the box; never the vitrine / Origin / L1 |
| `signet/node-hot.env` | Signet pubs + lab guardian secrets + signer URL + token | the Signet public node |
| `mainnet/vault-keys.env` | **new** mainnet owner secret — never the Signet file | **only** the pot-signer |
| `mainnet/owner.box` | mainnet owner secret encrypted | pot-signer with `KRAY_POT_SIGNER_PASS` |
| `mainnet/node-hot.env` | mainnet pubs + signer URL + token | the mainnet public node |

`node scripts/split-signet-custody.mjs` writes the hot file and ensures the token
exists. It never prints a secret. It never overwrites the live owner key.

## Two houses (elite Signet)

Do not open the pot-signer on the internet. The node may only call
`http://127.0.0.1:4479`. A second machine is reached by an SSH **reverse**
tunnel, so the vitrine sees localhost and the secret never leaves the cofre.

| House | Role | Holds | Must never hold |
|---|---|---|---|
| **Cofre** | private signer machine | `vault-keys.env` / `owner.box`, `pot-signer` | a public bind, Funnel, a copy of the vitrine disk |
| **Vitrine L2** | public writer (`signet.kray.network`) | KRAYNET node, `node-hot.env`, Signet bitcoind/ord | owner secret, `vault-keys.env`, `owner.box` |
| **L1 oracle** | Bitcoin + ord + **full node** (follow + read-only mirror) | chain + indexer + verified journal/atlas | owner secret, pot-signer, a second writer, a public bind of the signer |

A follower is not a fourth house and not a second writer. It clones **this repo**
from GitHub, then `kray-follow.mjs --from https://signet.kray.network --watch --serve 4480`.
That is the foundation full node: same journal and atlas, read-only mirror, no pot
key. Code updates are `git pull` on `main`. History updates are the follow loop.

Default elite split: cofre signs, vitrine writes the L2, L1 stays the Bitcoin
oracle (and may follow). Do not put the owner key on the L1 box. Do not open the
pot-signer on the internet or Tailscale.

Ceremony (from the cofre — never on the public writer):

```
# vault-keys.env is gitignored. Never copy it onto the writer disk.
node scripts/operator/pot-signer.mjs --env signet/vault-keys.env
# expose the signer to the writer on loopback only, by your own means
# the public tree does not ship a host map or a deploy script
```

## The book-checking federation (LIVE since 2026-08-22)

The cooperative leaf's guardian co-sign is no longer a rubber stamp on the writer. Since the go-live flip
(Signet, 2026-08-22), the writer consults **remote guardian co-signers** on every pot withdraw:

- **The rule:** a payout collects the owner signature (the pot-signer, unchanged) **plus** a 2-of-3 quorum of
  guardian daemons (`scripts/operator/guardian-signer.mjs`). Each daemon, before lending its share, re-checks
  the exit against **its own mirror's book** (`KRAY_GUARDIAN_BOOK_URL` → a `kray-follow` replica that
  re-derived the whole cascade) — `authorizeGuardianSign` refuses a validly-signed exit whose amount exceeds
  the exiter's replayed balance. A compromised writer can no longer over-drain the pot: the books say no.
- **Fault semantics (fail-closed, never frozen):** an UNREACHABLE guardian is tolerated up to the threshold
  (run more daemons than t — that surplus is the fault tolerance); a guardian whose book says **NO** holds
  the withdraw — safety is never routed around. Funds never freeze either way: the depositor's unilateral
  CSV leaf needs no guardian.
- **Topology (no host map, per this page's law):** three co-signer boxes, each = its own validating follower
  (root byte-parity required) + a loopback-only daemon + an SSH **reverse** tunnel into the writer's
  loopback. One shared bearer token in the writer's private hot env (`KRAY_GUARDIAN_SIGNER_URLS` +
  `KRAY_GUARDIAN_SIGNER_TOKEN`). No box holds the owner key **and** a guardian threshold — the cage law.
  Rollback: remove the two env lines, kickstart.
- **Honest residues, named:** (1) Signet guardian keys are the documented **lab seeds** — the rehearsal; on
  mainnet each guardian is a fresh key **sealed in its own box** (`guardian.box` — the daemon supports it;
  `/health` must say `boxed`) held by an independent operator, set at genesis. (2) The owner's unilateral
  post-timelock sweep remains the pot's deepest residue — rung 5 (per-recipient settlement routing, the
  exit loaf) shipped 2026-08-23 and shrinks what the pot ever holds; the pre-signed split (rung 4) stays
  deferred pending FROST. Retirement is by shrinking the pot, not key-hiding.
- **Any follower can serve a book:** the mirror route `/api/kraynet/runes/of/<addr>` ships with follow; the
  quiz (`docs/RUN-NODE.md` § Q2b, `preflight --role custody`) is how a stranger raises their hand. Mirrors
  stay anonymous — the qualification is the mirror, never a public list.

## What live Signet is (honest, no host map)

The public writer is on `node-hot.env` (`potSigner=loopback`). Rung 1 is no longer
the running process. A leftover `vault-keys.env` on the vitrine disk is shredded
only after a lab withdraw has paid. The follower recipe never copies that file.

## The wire

Locked split. Do not invent a fourth house. Do not skip a box.

1. Writer relaunched on `node-hot.env` — `GET /api/kraynet/bridge/params` → `potSigner: true`.
2. Lab withdraw still needs the Creator's wallet (signed `rune-exit` + own Signet sats).
3. Then shred leftover `vault-keys.env` on the vitrine only.
4. Later: `owner.box` + passphrase (in the head, not next to the box). Then Shamir 2-of-3 (`split-owner-shares.mjs`). Then hardware.

**Never:** Funnel/public bind of the signer · owner secret on the L1/follower box ·
donate-as-withdraw-gate · treat iCloud as another machine · `--force` overwrite
live pot keys · kill the cofre signer/tunnel while the vitrine is paying.

A follower on the L1 box is welcome. It is not the cofre.

---

## Rung 4 verdict — pre-signed pot split: RE-RANKED, not shipped (council + adversary, 2026-08-23)

Two lenses studied the real code. **The "auto-fail" promise is FALSE as stated** — it conflated
*can-be-broadcast* (the split has no timelock) with *wins-the-fee-auction* (who confirms). The honest matrix:

- **Below Δ** (outpoint younger than the CSV delay): the owner sweep is **BIP-68 non-final** — bitcoind
  rejects it, no miner may include it. This is **CONSENSUS, not a race**: the armed split confirms unopposed.
  This half is a TRUE, consensus-grade win (the design lens's key correction to the adversary).
- **At/after Δ**: both signal RBF → a **fee auction**. The split's fee is fixed (pre-signed); a higher-fee
  sweep replaces it, or the thief submits **direct-to-miner** past the reactive watcher. The split can LOSE.
  The *refresh* discipline (a pot→pot cooperative spend resetting the CSV clock before Δ) keeps outpoints
  below Δ so the auction never opens — a real mechanism, but see the killer:

**The killer (both lenses, `verified`): F2 — re-arm needs the very key we defend.** The cooperative leaf is
`<owner> CHECKSIGVERIFY + t-of-n guardians`. Every re-arm and every refresh needs the OWNER to co-sign. In
rung 4's own threat model (owner key compromised) the attacker simply stops co-signing. **So rung 4
presupposes FROST-on-owner (rung 7) — a rung that does not exist yet.** Also verified: F3 the pot commingles
so a fixed split dies (invalid double-spend, silent no-op) on any exit/rehome that churns its outpoints, and
goes stale-but-valid on any book change (a sold-on holder gets robbed; `auditSettlementSafety` checks
conservation, not book freshness); F4 split dests are writer-asserted (no holder signature → trust migrates
to the writer); F5 the 83-byte runestone ceiling caps a split at ~10 holders — a real pot doesn't fit.

**What the pre-signed split HONESTLY buys (the corrected claim, now in the code comments):** against a
compromised **writer** (owner honest) or a guardian **liveness** failure, each holder holds a standing exit
that is **consensus-valid below Δ** — Ark's ceiling, censor-never-steal. It does **not** defend a compromised
**owner key**. The overclaiming comments in `pot-settlement.ts` / `vault-settlement.ts` were corrected to say
exactly this (docs=code). `KRAY_PRESIGNED_SETTLEMENT` (personal-vault reflex) is flag-OFF; nothing live
depended on the overclaim.

**Re-rank:** rung 4 (full arm/re-arm) is DEFERRED behind FROST-on-owner. The honest next trust-reducers that
do NOT presuppose missing rungs: **rung 5 — per-recipient settlement routing (shrink-the-pot)**: move
circulating value into each recipient's own self-custody so the pool shrinks to the in-flight residue
(dominates "grow the federation", needs no owner-key-in-the-loop for the settled funds); and **rung 3 —
monotonic guardian head** (persist the last co-signed root, refuse non-descendant — the covenant-less
anti-equivocation substitute, zero-code fallback: co-sign only anchor-descended roots). NEVER call the pot
"trustless": can't-steal-only-censor for settled balances is the honest ceiling; the pooled residue is
owner-first single-key until FROST-on-owner is real.

---

## Rung 3 — monotonic guardian head: BUILT + proven (2026-08-23), awaiting the fleet deploy

The covenant-less anti-equivocation gate. A guardian daemon now **remembers** — on its own disk
(`guardian-head.json`, atomic write) — the head of ITS OWN BOOK against which it last co-signed:
`{ seq, root, anchoredRoot }`. Before reading a single balance, every `/sign` proves the book's CURRENT
verified history still **passes through** that root (membership in the mirror's re-derived prefix roots IS
descendance — the cascade root at seq S commits events 1..S). A writer that rewrites, forks, or re-serves an
old genuine history to different guardians (equivocation) hits a **403 that never auto-clears**; only the
operator's conscious rite (deleting the head file after inspecting) resets it.

- **The wire:** the mirror (`kray-follow.mjs --serve`) answers a new read-only route,
  `GET /api/kraynet/lineage/{root}` → `{ known, seq, head, lastProvenAnchor }` — one verified snapshot, one
  atomic answer, computed from the §3 prefix-root replay this box already performs. The daemon
  (`guardian-signer.mjs`) gates on it and CONFIRMS after fetching balances that the snapshot did not swap
  mid-request (anti-TOCTOU: gate and balances must agree, else 503 retry). The writer needed **zero changes**
  — `askGuardians` already holds on 403 and tolerates 503-lagging as a fault.
- **The anchored ratchet (A3 at the co-sign door):** the daemon also pins the deepest anchor root its book
  **re-proved on its own bitcoind** (`lastProvenAnchor`, §4 of the follow) and refuses a history that
  abandons it — a rewrite below a Bitcoin anchor is refused even if the plain head were somehow re-grown.
  The anchor memory only ratchets forward; a writer serving fewer anchor hints on a later cycle cannot walk
  it backwards.
- **LAG ≠ THEFT preserved:** a book that CANNOT answer (unreachable, or a pre-rung-3 follower without the
  lineage route) is a **503 liveness fault** — retriable, tolerated by the quorum, never a silent sign and
  never a false hold. Only a book that ANSWERED "this history abandons your root" is the hard 403.
- **Proven by breaking:** `guardian-monotonic-head.test.ts` **17/17** — bootstrap plants the memory · honest
  advance ratchets · tail rewrite → 403 (file unchanged) · stale-history replay → 403 · anchored-root
  abandonment → 403 · unreachable book → 503 · pre-rung-3 book → 503 "update the follower" · mid-request
  snapshot swap → 503 (anti-TOCTOU) · the operator rite replants · old-mirror bootstrap stays deploy-safe
  (persists from `/head` alone, **no anchor claimed where none was proven**). Rung 2 re-proven untouched
  (`guardian-lag-theft.test.ts` 6/6). Both exams now pinned in the deterministic suite.
- **Honest residues, named:** (1) the head file is local state on the guardian box — an attacker with disk
  write there already holds that guardian's key (same box, same blast radius); the OTHER guardians' memories
  are unaffected (2-of-3 still holds the withdraw). (2) A LEGITIMATE succession that drops an un-anchored
  tail will read as equivocation to a guardian that co-signed inside that tail — the withdraw holds until
  the operator inspects and performs the rite; funds never freeze (the depositor's CSV leaf needs no
  guardian). Safety over liveness, stated not hidden. (3) The gate binds each guardian to ONE continuous
  history — it does not yet make the three guardians compare heads with EACH OTHER (a cross-guardian
  consistency layer would close the "writer partitions the guardians onto three forks from birth" corner;
  today that corner is already narrow because each book independently re-proves anchors on its own bitcoind).
- **Deploy (the maintenance law):** daemon + mirror ship together per box via the workshop's
  `update-guardians.sh` (same clone serves both). Order-safe either way: an updated daemon against an old
  mirror answers 503 (retriable) once a memory exists, and bootstraps via `/head` when none does.

---

## Rung 5 — per-recipient settlement routing (the exit LOAF): BUILT + proven (2026-08-23)

The shrink-the-pot rung, honest scope: circulating value leaves the shared pot **straight to each
recipient's own signed self-custody address**, and it leaves FASTER — one pot ceremony now pays **every
compatible open exit of that rune at once** (the LOAF), each recipient on its own output, instead of one
recipient per click. The pot drains to the in-flight residue at N× the rate; nothing about who may take
what changed one bit.

- **The trust math (why this is the right rung, not a throughput toy):** the pot-signer and EVERY remote
  guardian already bind **each dest to a holder-SIGNED rune-exit** (`authorizePotSign` /
  `authorizeGuardianSign` verify per-dest signature, dest script, and amount — proven in
  `pot-signer.test.ts`). The writer cannot invent, redirect, or resize a rider. A recipient's settled
  runes land on a plain P2TR only their key opens — Tier-1 pure-math self-custody, out of every
  federation's reach forever.
- **The new consensus law — ONE DELIVERY, ONE BURN:** the historic settle law keyed each burn on the
  whole `l1Txid` ("one payout, one burn"), which would refuse the second member of a loaf. A loaf settle
  now carries its **delivery outpoint** (`outpoint: l1Txid:vout`, an EXISTING event field) and the
  `RuneBook` keys the dedup on it. Append-only, byte-identical for every settle journaled before the
  loaf existed; replay attacks refuse in BOTH directions (a re-used delivery outpoint, a whole-tx settle
  of a per-output-consumed txid, a per-output settle of a whole-tx-consumed txid).
- **The door (writer only, flag `KRAY_EXIT_LOAF=1`):** when one exiter clicks and funds, the door rides
  every other open, unarmed, compatible exit of the same rune (oldest signed exit first, cap 8):
  runestone must stay ≤ 83 bytes (`batchRunestoneFits`), the pot must physically hold Σ, duplicate dest
  scripts wait their own click (per-output settles must never be ambiguous), and the
  **initiator-no-worse law** holds — riders ride on the pot's own sats surplus, never on the initiator's
  pocket (the loaf's sats change to the initiator must be ≥ the solo build's, or riders are trimmed).
  Every member is **armed (rune-lodge) before a single byte broadcasts** — a rider's cancel racing the
  loaf refuses in the book, the same anti-double-claim gate the initiator always had; a member whose
  lock changed since the build refuses the whole submit before any arming.
- **Guardian claim fix (rung-2 refinement, shipped with this):** the daemon's book check now counts the
  exiter's claim as **spendable + locked** — once a guardian's book replays the rune-exit, the credits
  sit in the LOCK (the two-phase law), and counting only the spendable slice would falsely refuse every
  honest full-balance withdraw the moment the book syncs past its own exit event.
- **Proven by breaking:** `exit-loaf.test.ts` **13/13** — three exits burn against three outputs of one
  txid (solvent, reserve exact) · replayed delivery outpoint → refused · whole-tx replay of a delivered
  txid → refused · historic no-outpoint law byte-identical · cross-tx outpoint aliasing → refused ·
  malformed outpoint → refused by shape · refusals leave the root byte-identical · cold reboot replay
  re-derives the root byte-exact. Loaf authorization + builder already pinned
  (`pot-signer.test.ts`, `exit-payout.test.ts`). Pinned in the deterministic suite.
- **Deploy law (CONSENSUS change — fleet first, flag last):** a pre-rung-5 follower HALTs on the second
  burn of one txid, so the order is absolute: (1) ship this code to every journal-replaying box
  (guardian fleet via `update-guardians.sh`, writer via `sync-vitrine.sh`); (2) only then set
  `KRAY_EXIT_LOAF=1` on the writer. The flag OFF keeps every byte of today's behavior.
- **Honest residues, named:** (1) value that never exits stays pot-backed — the loaf shrinks the pot per
  withdraw wave, it does not force anyone out; the pooled in-flight residue keeps its rung-4/FROST
  story unchanged. (2) A rider whose dest script duplicates another member's waits its own click —
  stated, not hidden. (3) The loaf is writer-assembled (who rides when), but nothing about it is
  writer-TRUSTED — every dest is signature-bound and every guardian re-checks every member against its
  own book with the rung-2 lag semantics and the rung-3 monotonic head intact (`minSeal` already rides
  as the max member seq).
