# The Anchor Proof — visible, one-click, trustless (design of record)

> **Status: BUILT AND LIVE (2026-08-19).** Design locked by the council (2026-08); the build below is
> DONE and running on the live pages — do not rebuild it (find the spark first). Engine steps 1–4 and
> the frontend steps 6–8 shipped: `apps/kray-net/kray-spv.mjs` (the browser SPV port) is proven
> byte-identical to consensus `spv.ts` by `kray-spv-parity.test.ts` (**31 checks green, in the suite**);
> `GET /api/kraynet/anchor-opening/:blockNumber` serves the opening; `apps/kray-net/anchor-verify.js`
> (the badge state machine) mints the green ✓ ONLY from an in-browser recompute-then-match, wired into
> `anchor.html`, `block.html`, `burn.html`, `proof.html`, `verify.html`; `/proof/<n>` self-verifies.
> The honest-boundary line (journal→cascadeRoot delegated to `kray-follow.mjs`) is now shown right under
> the green/confirming badge. **Remaining (optional):** step 5 (`burn-proof.js` `scriptHex` convenience —
> the widget already computes `5120<outputKey>` inline) and step 10 (keep `KRAY_OPERATOR_ANCHOR` off).
> The math was always live and perfect; this document made the proof **visible and one-click-verifiable**
> without weakening a bit. The Supreme Law is untouched: signature ‖ Merkle proof ‖ Bitcoin anchor.
>
> The build plan below is kept verbatim as the record of what was done; read it as a checklist that is
> now ticked, not as work to start.

## The one principle

**The node delivers bytes; Bitcoin and your machine prove.** A green ✓ is minted ONLY by an in-page
recompute-and-match that also clears the work floor — never by a boolean the node returns. You trust
this node for none of it.

## Carrier decision (locked)

- **Emit: self-anchor only** (keyless-NUMS pay-to-contract). The 49 bytes live INSIDE the taproot output
  key, indistinguishable from any payment → uncensorable, and free (the donation output IS the anchor).
- **Classic OP_RETURN:** kept as a flag-gated liveness fallback (`KRAY_OPERATOR_ANCHOR`, default OFF),
  **never** emitted redundantly alongside a self-anchor. **Never** on milestone blocks either (the Creator
  chose "never" — the in-browser recompute already gives stronger legibility than a filterable marker).
- **Verifier stays DUAL forever** (`spv.ts::verifySealProof` accepts either carrier) — future-proofs every
  legacy/operator/third-party seal at zero cost. The second carrier belongs in the READER, never the WRITER.

Why self-anchor is the atemporal choice: survival is the only axiom a carrier can threaten, and only the
self-anchor has it (nothing to filter). Human-auditability — classic's only edge — is already superseded:
`burn-proof.js` recomputes the exact `5120<outputKey>` in the browser and matches it against Bitcoin's own
record via a third-party explorer the user picks. Recompute-then-match ≫ read-and-trust.

## What already exists (the foundation — do not rebuild)

- `apps/kray-net/burn-proof.js` — `BurnProof.derive(blockNumber, root, net)` recomputes G→NUMS→payload→
  commit→tweak→outputKey→address entirely in-browser, no deps. Guarded by `self-anchor.test.ts`.
- `apps/kray-net/burn-verify.mjs` — the offline, zero-trust CLI verifier (second machine escape hatch).
- `GET /api/kraynet/self-anchors` — the opening: `{internalKey, selfAnchors:[{txid, vout, blockNumber, root, sats, donor}]}`.
- `GET /api/kraynet/anchors` — rows carry the carrier as `kind: 'self-anchor'|'guardian'|'operator'`.
- `GET /api/kraynet/head` — `{seq, cascadeRoot, finality:{anchor:{tier}}}`.
- `KRAY_OPERATOR_ANCHOR` defaults OFF (`server.mjs`) — the writer default is already locked.

## The one missing engine piece

`apps/kray-net/kray-spv.mjs` — a dependency-free **browser port of the load-bearing core** of
`apps/kray-core/src/anchor/spv.ts`, so the burial itself is re-proven in the browser (not read from an
explorer's `confirmed` boolean): `parseTx` (segwit-stripped `sha256d` txid), `parseHeader`,
`verifyTxOutProof` (BIP-37 merkle rebuild + the **CVE-2012-2459** duplicate-node refusal verbatim),
`extractKraySeal` (OP_RETURN branch), `targetFromBits`/`workOfTarget`/`checkProofOfWork` with `POW_LIMIT`
+ `MIN_BLOCK_WORK` copied **exactly** (main `1<<74n`, signet `workOfTarget(powLimit)` = `4838420n`, test/regtest `0n`), and
`proveTxBuried(rawTx, txoutproof, headersHex, {net, minConfirmations, minWork})` → `{ok, confirmations, work, powMeaningful}`.

**The guarantee that it never breaks the math:** `apps/kray-core/src/test/kray-spv-parity.test.ts` feeds
`kray-spv.mjs` and `spv.ts` the same vectors (the proven signet anchor `a66af956…` + a raw OP_RETURN seal +
a regtest case) and asserts **byte-identical verdicts**. One algorithm, two runtimes, forever — exactly as
`burn-proof.js` is guarded by `self-anchor.test.ts`.

## The badge state machine (the ✓ is earned, never given)

| Badge | Exact condition |
| --- | --- |
| **UNVERIFIABLE** (grey) | browser could not recompute R or the expected output key. "Nothing here is proven." |
| **NO ANCHOR** (grey) | R/Q recomputed, but no `vout` raw-hex scriptPubKey equals the expected output. "Bitcoin shows no output committing this root." |
| **SEEN IN MEMPOOL** (amber) | output matches, `confirmations == 0`. "Broadcast, not buried — NOT final." |
| **CONFIRMING** (amber) | match AND `1 ≤ D < ANCHOR_CONF`, work `W` recomputed. "Buried under D block(s); shallow anchors can still reorg." |
| **CONFIRMED** (green) | raw-hex match AND `D ≥ ANCHOR_CONF` AND `W ≥ D·MIN_BLOCK_WORK[net]` AND `powMeaningful` (net ≠ regtest). "Sealed under more work than any attacker could redo." |
| **FINAL BY WORK** (green+lock) | all CONFIRMED AND `D ≥ ANCHOR_FINAL` (100). "No reorg in Bitcoin history has reached this depth." |
| **DEV CHAIN** (blue) | `powMeaningful === false` (regtest). Never green: "Development chain — trivial work, proves nothing about cost." |

Source badges per line: **[your browser]** (recompute), **[bitcoin · explorer]** (a third party the user
chose), **[node claims]** (grey, never green).

## Build plan (ordered, additive — no consensus/math change)

1. `kray-spv.mjs` (new) — the browser SPV port above; the same file is the offline CLI.
2. `kray-spv-parity.test.ts` (new) — the byte-identical-verdict gate.
3. `GET /api/kraynet/anchor-opening/:blockNumber` (server.mjs, additive) — one unified opening shape both
   carriers/pages consume `{carrier, txid, vout, blockNumber, root, internalKey?, keyIsNums?, net, explorerHints[]}`.
   Serves PUBLIC opening data only — **never a verdict**.
4. Surface `carrier` as a first-class field in `headView()` and the anchor rows.
5. `burn-proof.js` — add `scriptHex = '5120' + outputKey` to `derive()` (pure addition; parity test still passes).
6. `anchor-verify.js` (new) — the shared "Verify on Bitcoin" widget (badge state machine over `BurnProof.derive`
   + `kray-spv.mjs`, editable txid/root/block, explorer dropdown + paste-raw-tx zero-explorer mode).
7. Wire the widget into `verify.html`, `anchor.html`, `block.html`/`blocks.html` (per sealed/golden block).
8. `proof.html` at `/proof/<blockNumber>` (and `?tx=<txid>`) — the shareable, self-verifying per-anchor page.
9. Copy pass — self-anchor-forward hero on `anchor.html`; "Share this proof ↗" → `/proof/<n>`; keep the
   offline/second-node escape hatch verbatim.
10. Lock the writer default — `KRAY_OPERATOR_ANCHOR` stays OFF; no redundant classic ever emitted.

> Steps 1–4 are the **engine** (server + new modules, zero frontend risk). Steps 5–9 touch the **frontend
> pages** (the Creator's in-progress front) → coordinated with him. Step 10 is a one-line confirmation.

## Must never break (the invariants)

- The frozen 49-byte payload: `TAG "KRAY.NETWORK"(12) ‖ 0x01 ‖ blockNumber(4 BE) ‖ cascadeRoot(32)`.
- The self-anchor tweak tag `kray-core.self-anchor.v1` lives in TWO places (`self-anchor.ts`,
  `burn-proof.js`) — they must stay byte-identical; never edit one alone. `spv.ts` reaches it only
  through `selfAnchorScriptHex`, so consensus has one source.
- `BURN_INTERNAL_KEY` = `SHA256(uncompressed G)`, the authorless NUMS point. The keyless default is what
  makes the sacrifice real.
- `spv.ts` stays **dual-carrier**; fork choice weighs **work** (`BigInt`), never a confirmation count.
- Verification stays **client-side recompute** against a **third-party** explorer — no trusted oracle, ever.
- Conservation untouched: mint = `min(sats, deficit)`, 1 ₭/sat read from the proven on-chain output, once per outpoint.

## Honest boundaries (name them, never overclaim)

- The `journal → cascadeRoot` last mile: the page proves everything Bitcoin-side + journal integrity, and
  **honestly delegates** the full cascade compile to `kray-follow.mjs` with a one-command CTA. A green check
  that overclaims that seam is the worst trust-and-safety outcome — name the boundary out loud.
- "Burned" copy is only honest while the internal key is the NUMS burn key (keyless). If a reserve key is ever
  used, the copy must not say "burned".
