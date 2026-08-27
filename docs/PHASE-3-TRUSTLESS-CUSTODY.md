# Phase 3 — Trustless Custody (dissolving the pot's single owner)

> **Status: DESIGN — lever 1 has since been WIRED LIVE and evolved past this text.** `self-anchor.ts` is
> no longer "wired nowhere": `server.mjs` records and re-verifies self-anchors (`/api/kraynet/self-anchors`,
> behind `KRAY_SELF_ANCHOR=1`), and the 2026-08-09 ADR (`DONATION-ECONOMICS-DECISION.md`) turned the donation
> into a keyless BURN (NUMS key) that IS the anchor. Read this for levers 2–3 and the rationale; read the ADR
> + `ANCHORING-UNIFICATION.md` for what actually runs.

> Status: **design + proven core primitive** (lever 1). Nothing here is wired into the live anchor path yet.
> The current pot/anchor flow is untouched and keeps working. Activation is gated and additive (see Rollout).

## Why this phase exists

Phase 1–2 made the **value and proof** layer trustless: every ₭ is backed by a proven donated satoshi
(`emitted ≤ satsDonated`), every state is anchored to Bitcoin, every action is signed, and the whole ledger is
re-derivable by any node. That part has no owner and cannot be inflated. `verified` — see
[`ledger.ts`](../apps/kray-core/src/protocol/ledger.ts) (`backed()`, `conserves()`).

One custodial fact remains. Today the **donation pot** is a real Bitcoin address whose key the node operator holds
(a hot fee-only wallet, `ismine`), and anchoring spends that pot to fund a **separate** OP_RETURN anchor tx. So:

1. the pooled sats are controlled by whoever runs the node (not "nobody"), and
2. anchoring depends on that operator continuing to pay a fee.

`verified` — see [`server.mjs`](../apps/kray-net/server.mjs) lines ~69–73 (fee-only wallet) and ~668–675
(`anchorSpend` reimburses the pot up to what it holds; the pot never goes negative).

Phase 3 removes both. Three levers, composable, ordered from *purest* to *most operationally robust*.

---

## Lever 1 — Self-anchoring donations (pay-to-contract) · **primitive proven**

**The idea.** Commit the anchor payload *into the very output the donor already pays*. The donation output is a
bona-fide BIP-341 taproot key-path output whose internal key is the network's published pot key `P`, tweaked by a
commitment to the anchor bytes. On-chain it is indistinguishable from any ordinary taproot payment (**stealth, zero
extra bytes, no OP_RETURN**), yet anyone who knows `P` and the claimed `(blockNumber, root)` can recompute the
output key and **prove** this donation sealed exactly that root.

**Construction** (`verified` against `@scure/btc-signer`'s own tweak in
[`self-anchor.test.ts`](../apps/kray-core/src/test/self-anchor.test.ts)):

```
c = taggedHash("kray-core.self-anchor.v1", payload)      # 32-byte commitment (taproot "merkle-root" slot)
t = int(taggedHash("TapTweak", P_xonly ‖ c)) mod n        # BIP-341 tweak — byte-identical to the standard
Q = lift_x(P) + t·G                                        # committed output key
output = P2TR(x(Q))                                        # a normal-looking witness-v1 output
```

`payload` = the exact 49 bytes `KrayAnchor.payload(blockNumber, root)` already used on-chain today
(`"KRAY.NETWORK" ‖ version ‖ blockNumber(4) ‖ root(32)`), so the committed root is the same cascade root the
network anchors now.

**What it buys.**

- Each donation **is** an anchor — anchoring rides the sats the user already sacrifices, and costs **nothing extra**.
- There is **no anchor-fee pot to drain**, so the "does the operator keep paying?" dependency disappears.
- The sats still land at a key the pot holder can sweep (`tweakedSpendSecret` → the reserve stays controllable),
  so **no funds are ever stranded** — the reserve's custody becomes a *separate* concern handled by Lever 3.

**Proven now** (`node src/test/self-anchor.test.ts`, 13/13): standard-taproot equivalence, honest commit→verify,
tamper rejection (root, height, key), spendability (Schnorr key-path), determinism, and stealth address form.
Module: [`self-anchor.ts`](../apps/kray-core/src/protocol/self-anchor.ts). **Pure, offline, wired nowhere.**

### Compatibility matrix (Lever 1)

| Layer | Verdict | Evidence |
| --- | --- | --- |
| Bitcoin consensus | **valid** `verified` | a P2TR key-path output + key-path spend; identical to any taproot output |
| Relay / mempool policy | **relayed** `inference` | standard v1 witness output, standard key-path witness; no non-standard script — confirm on signet |
| Miner policy | **includable** `inference` | ordinary taproot tx; no policy edge — confirm on signet |
| Canonical `ord` | **ignored (benign)** `inference` | no inscription envelope, no runestone; ord sees a normal payment, exactly as intended |
| KRAY auditor | **recognized** `verified` | `verifySelfAnchor(outputKey, P, payload)` re-derives the key — the whole check, no Bitcoin node needed |
| Wallet (KrayWallet) | **spendable** `verified` | `tweakedSpendSecret` → key whose pubkey == output key; Schnorr sign/verify pass |

**Byte budget:** **0 extra bytes.** The commitment lives in the output *key*, not in an OP_RETURN — so the 80-byte
nulldata ceiling is irrelevant and the anchor is invisible to a censor scanning for `OP_RETURN "KRAY"`.

### Honest borders (Lever 1)

- **Verifier needs `P` + the claimed `(blockNumber, root)`.** The node publishes `P` and its own block history, so it
  (and any external auditor given them) can match each donation output to the root it sealed. A third party with
  *only* the raw chain sees an ordinary payment — that is the stealth property, by design, not a gap.
- **This anchors; it does not by itself decentralize who *holds* the swept reserve.** That is Lever 3.
- `inference` labels above must become `verified` by a signet broadcast + `ord` decode before mainnet (per
  `design-resilient-runes`: never broadcast production keys while exploring; test consensus and policy separately).

---

## Lever 2 — Any guardian may anchor (no single point)

Because the proof (`signature ‖ merkle ‖ journal`) is self-verifying, **any** guardian can pay an anchor fee (or
broadcast a self-anchoring donation of their own) to seal the current root — the node operator is not privileged.
The pot, if it still exists, becomes a *reimbursement* tank, not a required custodian. Removes the single-point-of-
anchoring **without new cryptography** (reuses today's anchor build path). `proposal`.

**Design sketch:** a guardian submits a signed "I anchored root R at btc-txid X" claim; the reducer verifies the
on-chain commitment (Lever 1 or OP_RETURN) matches R and credits/【reimburses】 the guardian from the fee pool,
conserved. Sybil-neutral by the same linear split already used for settlement.

---

## Lever 3 — Federation N-of-M for any pooled reserve

Any reserve that *is* pooled (e.g. swept self-anchor outputs) is held under an **N-of-M multisig across independent
guardians** — the same guardians who mine and settle, and the federation set is already derived *from the chain*
(`verified` — commit `cdc6897`, "the federation comes from the chain"). No single party can move it; spending needs
a threshold. `proposal`. Taproot script-path (`p2tr_ms`/`p2tr_ns`) or MuSig2 key-path are both open options — decide
against the relay/miner matrix before building.

---

## Rollout — additive, gated, "sem quebrar nada"

1. **Now (done):** the Lever-1 primitive exists as a pure module + 13/13 proof, imported by nothing. Zero effect on
   the running system.
2. **Next (signet-only, flagged OFF by default):** a `KRAY_SELF_ANCHOR=1` path that builds donation PSBTs paying the
   self-anchoring address, and a node-side `verifySelfAnchor` audit that maps each donation to the root it sealed.
   The existing OP_RETURN anchor + pot flow stays the default until this is `verified` on signet end-to-end.
3. **Then:** Lever 2 (any-guardian-anchors) reducer + reimbursement, sybil-neutral.
4. **Then:** Lever 3 federation for the swept reserve.
5. **Mainnet:** only after the full compatibility matrix is `verified` (signet broadcast + `ord` decode + reorg/RBF
   tests), never from a `proposal`/`inference` state.

**Invariant preserved throughout:** the supreme law — `signature ‖ SPV proof ‖ Bitcoin anchor` — is unchanged.
Self-anchoring changes *how* the anchor rides Bitcoin (in the output key instead of an OP_RETURN), never *whether*
the root is sealed, backed, and conserved.

## Adversarial test plan (before any mainnet use)

- Signet: broadcast a self-anchoring donation; confirm relay + inclusion; `verifySelfAnchor` matches the root;
  sweep the output with `tweakedSpendSecret` and confirm the sats move.
- `ord` decode: confirm it is seen as an ordinary payment (no cenotaph, no accidental inscription/runestone).
- Boundaries: wrong root, wrong height, wrong `P`, a second donation for the same root, reorg of the donation block,
  RBF of the donation, and a donation whose commitment `t` is (astronomically) degenerate → all fail closed.
- Conservation/backing unchanged: emitted ≤ satsDonated and Σ balances == emitted − burned across the new path.
