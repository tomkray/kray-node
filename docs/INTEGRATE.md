# Integrate KRAY.NETWORK — Wallet & Platform Guide

> How to put the KRAY.NETWORK mainnet inside any wallet or product — the way
> KrayWallet (Chrome extension and mobile PWA) already runs it in production.
> If you can sign a Bitcoin Taproot message, you can integrate KRAY.NETWORK.

**Audience:** wallet teams (Xverse, Leather, OKX, …), exchanges, explorers,
apps. **Base URL:** `https://www.kray.network`. **No API key. No SDK required.
CORS is open (`Access-Control-Allow-Origin: *`) — call the node directly from
a browser, an extension, a mobile app, or a server.**

---

## 1. The model in one minute

- **An account is a Bitcoin mainnet Taproot address** (`bc1p…`). Your users
  already have one. There are no new keys, no registration.
- **A write is a BIP-340 Schnorr signature** over `SHA256(message-bytes)`,
  where the *node* prepares the exact message bytes and the wallet re-verifies
  them before signing. The node re-verifies the signature on submit and on
  every replay — any stranger can re-prove the whole chain from bytes alone.
- **₭ (KRAY) is born only by proof-of-burn on Bitcoin** — a real L1
  transaction to a keyless NUMS address, SPV-proven by the node, minting
  1 ₭ per sacrificed satoshi. No custody, no trusted server.
- **State is a replayable journal.** `GET /api/kraynet/head` names the current
  height and cascade root; everything below folds into it.

Signature scheme, precisely:

```
key       = BIP-86 internal key (x-only, 32 bytes — NOT the tweaked output key)
message   = the exact string returned by the node's prepare step
signature = BIP-340 schnorr_sign(SHA256(utf8(message)), key)   → 64 bytes hex
publicKey = x-only pubkey                                       → 32 bytes hex
```

---

## 2. Quick start — read an account (no auth)

```bash
curl -s https://www.kray.network/api/kraynet/head
# → { "height": N, "cascadeRoot": "…", "network": "main", "supply": {…}, "pot": {…} }

curl -s https://www.kray.network/api/kraynet/profile/bc1p…
# → { "address", "balance", "nonce", "lights": { "glow", "xSpendable", "fireTank" },
#     "baptisms": [{ "name", "star" }], "stars": {…}, "supply", "pot" }
```

### Read endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/kraynet/head` | height, cascade root, network name, supply, pot |
| `GET /api/kraynet/profile/:addr` | balance (₭), nonce, lights (Ӿ / glow / fire tank), baptisms, star counts |
| `GET /api/kraynet/profile/:addr/inscriptions?limit=N` | inscribed stars (`{ total, items }`) |
| `GET /api/kraynet/account/:addr/activity` | recent activity rows |
| `GET /api/kraynet/runes/of/:addr` | L2 rune holdings |
| `GET /api/kraynet/name/:name` | baptism lookup → the full star view (`owner`, `name`, baptism, history, …) |
| `GET /api/kraynet/presence` | fee pool and liveness |
| `GET /api/kraynet/pot` | pot deficit / donated / open |
| `GET /api/kraynet/donation/info` | mint cap, `mintableNow`, the live `selfAnchor` |
| `GET /api/wallet/fees` | live sat/vB tiers (`{ fees: { low, medium, high } }`) |
| `GET /api/wallet/:addr/balance` | the address's confirmed BTC on this network |

All amounts are integer strings. Treat every field as optional — the node may
add fields; never break on extras.

---

## 3. The write arc — prepare → verify → sign → submit

Every L2 action (send ₭, burn ₭ → Ӿ, send Ӿ, name a star, inscribe, send a
star, freeze) follows one arc. **Never build message bytes yourself; never
sign bytes you did not verify.**

### 3.1 Prepare — the node builds the exact bytes

```
POST /api/kraynet/prepare
{ "action": "transfer", "from": "bc1p…", "to": "bc1p…", "amount": "1000" }

→ { "message": "…exact bytes to sign…", "nonce": 7 }
```

Actions and their parameters (the extension/mobile production set):

| `action` | params | effect |
|---|---|---|
| `transfer` | `to`, `amount` | send ₭ |
| `burn` | `amount` | burn ₭ → mint Ӿ (fungible fuel) |
| `x-send` | `to`, `amount` | send Ӿ (feeless) |
| `name` | `star`, `name` | baptize a star (one plain ASCII word) |
| `inscribe` | `star`, `content` | write content onto a star |
| `sendstar` | `star`, `to` | send a star (also used to freeze: `to` = `KRAY_BLACK_HOLE`) |

These six are the wallet core. The same prepare → sign → submit arc also
accepts the wider door set — `origin`, `eternize`, `contract`,
`contract-call`, star-market acts (`star-list`, `star-delist`, `star-buy`,
`star-offer`, `star-offer-cancel`, `star-offer-accept`), rune book acts
(`rune-send`, `rune-exit`, `rune-cancel`), AMM acts (`amm-add`, `amm-remove`,
`amm-swap` and the `amm-rr-*` trio), lanes (`lane-enter`, `lane-exit`,
`fold-seal`), `cut-send` and `quantum-commit` — each with its own params;
prepare returns the exact bytes either way, and the same Zero Trust gate
applies. Writes are rate-limited per IP (order of 120 POSTs/min); a
wrong-network address is refused `401` before any handler runs.

### 3.2 Verify — the Zero Trust gate (client-side, mandatory)

Before signing, assert the prepared bytes literally contain **your user's
address** and, when there is a recipient, **the resolved recipient** (or the
black-hole marker `KRAY_BLACK_HOLE`). Refuse otherwise. Reference:
`assertPreparedBytes` in KrayWallet mobile `src/services/kraynet.ts`.

### 3.3 Sign — locally, always

```js
const sig = schnorr.sign(sha256(utf8(prep.message)), bip86InternalKey);
```

The private key never leaves the wallet. There is no server-side signing door
— by design.

### 3.4 Submit — the node re-verifies

```
POST /api/kraynet/submit
{ "action": "transfer", "from": "bc1p…", "to": "bc1p…", "amount": "1000",
  "nonce": 7, "publicKey": "<64-hex x-only>", "signature": "<128-hex schnorr>" }

→ { "ok": true, "seq": 12345 }   |   { "error": "…" }
```

The `nonce` from prepare must ride along — it makes each act unique and
replay-safe. A submit with a stale nonce is refused; just prepare again.

### 3.5 Names (baptisms) — resolution law

A recipient may be typed as a name instead of an address. Resolve it **before
prepare** and re-check the fold:

1. Canon: NFKC → lowercase → strip spaces; must match `/^[a-z0-9]{1,64}$/`.
2. `GET /api/kraynet/name/:canon` → the star view; read its `name` and `owner`.
3. Refuse unless the node's returned `name` folds to the same canon, and
   `owner` is a living `bc1p…` (not the black hole).
4. Put the **resolved address** in prepare — the signed bytes name the
   taproot owner, never the alias.

### 3.6 Social like (star as post) — kind `star-like`

A like is a **journal act** that names the star. Always fee **1 ₭ → Treasury** (A2).
**Once-ever:** one wallet address may like each star **at most once** (tip cannot buy a second like; rank stays one-wallet-one-vote). Optional tip to the **living owner** on that same act:

| `tipAsset` | Tip move | Notes |
|---|---|---|
| `none` (or omit) | — | fee-only proof of engagement |
| `kray` | `amount` ₭ → owner | self-like: tip loops, fee still −1 |
| `x` | `amount` Ӿ → owner | never mint; never Fireborn feeless |
| `rune` | `amount` of `runeId` → owner | needs `runeId`; fee still 1 ₭ |

```js
await KRAY.likeStar(13, '0', { tipAsset: 'none' })           // fee only
await KRAY.likeStar(13, '2', { tipAsset: 'kray' })            // tip 2 ₭ + fee 1
await KRAY.likeStar(13, '1', { tipAsset: 'x' })               // tip 1 Ӿ + fee 1
await KRAY.likeStar(13, '10', { tipAsset: 'rune', runeId })   // tip runes + fee 1
// legacy: await KRAY.likeStar(13, '1')  ⇒ tipAsset kray
```

Black-hole stars refuse. Receipt = the sealed event (`/tx` · `/receipt`). Tip is a
**settled payment**, not a promissory note. Plate `actTo` remains a separate invitation.

Without `kray.js`:

```
POST /api/kraynet/prepare  { action: "star-like", from, star, tipAsset, amount?, runeId? }
→ sign BIP-340 → POST /api/kraynet/submit (+ nonce, publicKey, signature)
```

### 3.7 Kray Lock — Speak (The Key) · 0 ₭

A **star number** is a master id a door may name. **Speak** proves the living
owner holds it. Not a journal act. Not 1 ₭. The **Kray Lock** (physical relay,
Discord bot, game room, or `/lock`) consumes `speakId` locally.

```
GET  /api/kraynet/speak?star=N&audience=house
→ sign message (BIP-340) in KrayWallet
POST /api/kraynet/speak  { message, from, signature, publicKey, scheme: "kraywallet" }
→ { ok, spoken, speakId, fee: "0", journal: false }
```

Door UI: `/lock?star=N&audience=house`. Agent: `apps/kray-lock/kray-lock.mjs`.
Guide: [`KRAY-LOCK.md`](KRAY-LOCK.md).

---

## 4. Donate → mint ₭ — the ONE on-ramp (proof-of-burn)

The only way ₭ is created. The node builds a real Bitcoin PSBT from the
donor's own coins; the wallet audits and signs it; the node broadcasts,
SPV-proves the confirmed txid and mints 1 ₭ per sacrificed satoshi.

```
1. GET  /api/kraynet/donation/info                      → mintableNow, selfAnchor
2. GET  /api/wallet/fees                                → live sat/vB tiers
3. POST /api/kraynet/donate/prepare
        { donor, donorPubkey, sats, feeRate }
        → { psbtB64, sats(mint), fee, feeRate, inputs, change, pot, selfAnchor }
4.      AUDIT the PSBT locally (see 4.2) — refuse on a proven lie
5.      sign the PSBT (Taproot key path, ALL inputs, do NOT finalize)
6. POST /api/kraynet/donate/broadcast  { psbt: signedPsbtB64 }   → { txid }
7. GET  /api/kraynet/donate/status/:txid                → { seen, confirmations, needed }
8. POST /api/kraynet/donate  { txid, selfAnchor }       → { ok, seq }  (the mint)
```

Persist `{ txid, selfAnchor }` after broadcast and retry step 8 on wallet
open until it succeeds or the node answers "already credited" — a slow chain
must never lose a mint. (KrayWallet stores it as `knPendingDonate`.)

### 4.1 The cardinal law — your users' ordinals and runes are safe

`/donate/prepare` **never selects a UTXO holding an inscription or rune** —
that filter is consensus law on the node, covered by its own e2e exam
(`donate-cardinal-filter-e2e`). A donor whose only coin is a rune is refused
at build time (HTTP 409), never handed bytes that would burn it. Wallets
should still audit outputs (below) — trust nothing, verify everything.

### 4.2 The NUMS burn audit — verify the sacrifice locally

Do **not** trust `selfAnchor.keyIsNums`. Re-derive the keyless script and
check the PSBT pays it:

```
NUMS_X  = 50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0
payload = "KRAY.NETWORK" || 0x01 || uint32be(blockNumber) || root(32 bytes)
commit  = taggedHash("kray-core.self-anchor.v1", payload)
t       = int(taggedHash("TapTweak", NUMS_X || commit)) mod n
script  = 0x5120 || xonly( lift_x(NUMS_X) + t·G )
```

Refuse to sign **only** when the JSON claimed a NUMS burn and the PSBT bytes
do not pay that script (a label is not a proof). Fail open on auditor errors
— never block an honest donate because your auditor could not run.

**Proven test vector (live mainnet anchor):**

```
blockNumber = 0
root        = 34a98fa06583b4e6a3ad40722e5339b150ea257a74ba261626e57d36940082c8
→ address   = bc1pxgl2356ctr4qcm03mp0xaps6w7vlafktc5jpazlaqagkrvu9m4ss9unjaw
```

Reference implementations: extension `popup/nums-burn.js` (from-scratch
bigint math) and mobile `src/services/kraynetDonate.ts`
(`xOnlyPointAddTweak` path) — byte-identical outputs, exam in
`scripts/test-nums-audit.mjs`.

---

## 5. Rune bridge — Bitcoin → KRAYNET

Bring an L1 rune onto the L2 with one Bitcoin send. The proof IS the
authorization; no deposit can be forged.

```
1. GET  /api/kraynet/bridge/params        → { ok, net, pot: "bc1p…", … }
       refuse unless net is mainnet and pot starts with bc1
2.     L1: send the rune to `pot` (a normal rune send from the user's wallet)
3.     persist { runeId, txid }           (KrayWallet: `kraynetPendingDeposit`)
4. POST /api/kraynet/rune/deposit  { runeId, txid }
       retry on wallet open until { ok } — the node credits after 2
       confirmations, exactly what landed, bound to the Taproot key that
       spent the coins
```

`runeId` is the protocol id (`block:tx`, e.g. `840000:9`).

---

## 6. Guardian mining — optional, earns the fee pool

Any wallet may contribute proof-of-work beats and earn from the pool:

```
1. GET  /api/kraynet/beat/challenge   → { beacon, block }
2.      find nonce: zeros = leading zero BITS of
        SHA256(`${beacon}|${address}|${block}|${nonce}`)
3.      message = `kray.beat.submit.v1|${net}|${beacon}|${address}|${block}|${nonce}|${zeros}`
        (`net` = the node's own `network` string from /api/kraynet/head)
4.      sign it (same BIP-340 scheme as §3.3)
5. POST /api/kraynet/beat
        { address, beacon, block, nonce, zeros, publicKey, signature, scheme: "kraywallet" }
        → { ok, spanWork }
```

A wrong `net` string only makes the node reject the signature — fail-safe,
never a bad write. Pool balance: `GET /api/kraynet/presence` (`pool`).

---

## 7. Integrator's security checklist

1. **Keys never leave the wallet.** There is no delegated signing.
2. **Sign only node-prepared bytes**, and only after asserting they name your
   user (and the resolved recipient / black hole). Show the exact bytes to
   the human before the password.
3. **Resolve names yourself** (canon fold, §3.5) — never sign an alias.
4. **Audit donate PSBTs** with the NUMS derivation (§4.2). Fail closed on a
   proven lie; fail open on auditor errors.
5. **Never spend protected UTXOs.** The node already refuses them for
   donations; apply the same cardinal filter to any L1 send you build.
6. **Integer satoshis / integer ₭ everywhere.** Format only at presentation.
7. **Persist pending proofs** (`knPendingDonate`, `kraynetPendingDeposit`)
   and resume on open — a slow chain must never strand value.
8. **Version authority is the node itself** — no config fetched from third
   parties may redirect signing, pots, or URLs.

---

## 8. Reference implementations (production)

| Surface | Where |
|---|---|
| Chrome extension (MV3) | `kraywallet-extension/popup/krayNet.js` + `popup/nums-burn.js` |
| Mobile / PWA (React Native Web) | `kraywallet-app-mobile/src/services/kraynet.ts`, `kraynetDonate.ts`, `src/components/tabs/KrayNetTab.tsx` |
| Node & consensus | this repository — `apps/kray-core` (the law), `docs/` (the book) |
| Kray Lock (Speak door) | `apps/kray-lock/kray-lock.mjs` · `/lock` · [`KRAY-LOCK.md`](KRAY-LOCK.md) |

Deeper protocol reading: [`KRAYNET-MODEL.md`](KRAYNET-MODEL.md) ·
[`TOKENOMICS.md`](TOKENOMICS.md) · [`BURN-PROOF.md`](BURN-PROOF.md) ·
[`BRIDGE.md`](BRIDGE.md) · [`SECURITY.md`](SECURITY.md) ·
[`ACTIONS-MAP.md`](ACTIONS-MAP.md).

Questions or a wallet to list? Open an issue on `tomkray/kray-network`.
