# KRAYNET Migration — from the centralized l2kray to the proven network

> **Status: DESIGN (standing plan) — parity map frozen 2026-08-02, partially overtaken by events.**
> The strangler-fig intent (KRAYNET as the wallet's third network mode) still stands, and the third mode
> now exists **in production**: the extension and the mobile PWA speak the live Bitcoin **mainnet** writer
> at `www.kray.network` (see `INTEGRATE.md`). Several 🔴 "build" rows below have since shipped as native
> kinds — the star **marketplace** (`star-list` / `star-delist` / `star-buy` / `star-offer*`) and the
> **AMM** (`amm-add` / `amm-remove` / `amm-swap` + `amm-rr-*`) live in the reducer, not as contracts.
> The parity table predates the v2 pivot and the live node — re-verify every row against the current
> wallet + `server.mjs` before acting on it.

The plan to replace the wallet's **l2kray** (centralized: Supabase / `kray-local.onrender.com`
+ `kray.space`) with **KRAYNET** — the same ideas, but where every action is *proven*
instead of *trusted*. Non-destructive: KRAYNET is added as a **third network mode beside**
mainnet and l2kray (the strangler-fig pattern), grown to parity feature by feature, then
flipped to default, then l2kray is retired.

**kray-space is tenant #1** — an **application**, not a second definition of
`kray-node` ([`BOOK-AND-APPS.md`](BOOK-AND-APPS.md)). Under axiom A7 (the tenant flywheel — a validator's mined KRAY
gives life to their project, sealed onto the chain), kray-space is the first big tenant to
bring its ideas home: the **marketplace of stars/inscriptions** and the **rune AMM DeFi (L2)**.
Everything it prototyped centrally on Supabase becomes, on KRAYNET, an elite-grade capability
with immutable, mathematically-proven signatures — the flagship proof that thousands of
future builders can run their own ideas on the proven network. Every action, tenant or not,
pays the eternal 1-₭ fee (A2); there are no exemptions, only elite *advantages*.

Ground truth: wallet surface mapped from `~/ai-projects/kraywallet-extension`
(`popup/krayL2.js`, `radiola.js`, `kraychat-client.js`); kray-net surface from
`apps/kray-net/server.mjs` + `apps/kray-core/src/protocol/ledger.ts`. Re-verify any
file:line before acting.

## The two truths

| | **l2kray (today)** | **KRAYNET (the target)** |
| --- | --- | --- |
| Infra | Supabase rows, a server you trust | the journal is the truth; state derived by pure replay |
| Authority | the backend accepts the write | the reducer re-verifies the signature at ingress **and** replay |
| Identity | an `account_id` row created per address | the taproot address **IS** the account (A9) — no create step |
| Proof | none — trust the DB | signature ‖ Merkle root ‖ Bitcoin anchor (the Supreme Law) |

## The enabling insight — the wallet is already ready

The 2026-08-01 extension audit proved the KrayWallet signs **BIP-340 Schnorr over
`SHA256(utf8(message))`** — which is *exactly* kray-net's "Kray digest". So KRAYNET mode
needs **no new crypto**: it uses the existing `signMessageWithConfirmation` /
`signL2Transaction`, pointed at kray-net's two-step flow:

```
POST /api/kraynet/prepare {action, …}  → { message, nonce }   // kray-core builds the bytes
   wallet signs `message` (popup-confirmed)                    // the proof
POST /api/kraynet/submit  {action, …, publicKey, signature, nonce}  // reducer verifies + executes
```

One difference to honour in the adapter: l2kray signs its **own** canonical string
(`from:to:amount:nonce:type`); KRAYNET signs the **protocol's** message bytes returned by
`/prepare` (e.g. `transferMessage(NET, from, to, amount, nonce)`). The adapter must sign
what `/prepare` returns — never re-invent the string — so the reducer re-verifies exactly
what the user approved.

## The NFT is a star inscription

The l2kray "NFT" **is** a KRAY **written star (relic)** — 1:1, and stronger on KRAYNET:

| NFT concept (l2kray) | Becomes, on KRAYNET |
| --- | --- |
| the NFT itself | a **written star** (`inscribe`) — content byte-unique in the universe, first-writer-wins, no re-inscription (A5) |
| the token id | the **inscription id** `<signed-event-hash>i<index>` — derived from the BIP-340 signature, so it cannot exist without the signature that authorised it (A10) |
| transfer the NFT | `sendstar` — a relic travels whole, its writings riding forever; never spent as gas |
| collection | parent→child lineage (`inscribe`/`origin` with a parent), committed into the anchored root |
| rarity / traits | the **Codex** (`starCollection`/`starTraits`) — rarity is mathematics of the number, not a DB tag |
| mint under an L1 collection | `origin` — a KRAY child under your own Bitcoin L1 ordinal, SPV-proven |
| the NFT **name** | `name` — one baptism, unique in the universe forever |

The only NFT piece kray-net does **not** yet prove is the **marketplace** (list/buy/sell)
and **fractional shares** — see Tier 3.

## The parity map

**Legend** — 🟢 proven on kray-net today · 🟡 model difference / design decision · 🔴 build on kray-net.

### Reads (holdings, history, chain)

| l2kray feature | Supabase endpoint | KRAYNET | kray-net source |
| --- | --- | --- | --- |
| account bootstrap | `POST /l2/account/create` | 🟢 **not needed** — address is the account (A9) | — |
| KRAY balance | `GET /l2/account/:id/balance` | 🟢 | `GET /api/kraynet/profile/<addr>` |
| multi-token balances | `GET /l2/account/:id/balances` | 🟢 KRAY + 🟡 tokens=runes | `profile` + `GET /api/kraynet/runes/of/<addr>` |
| tx history | `GET /l2/account/:id/transactions` | 🟢 | `GET /api/kraynet/journal` (filter by addr) |
| explorer address | `GET /api/explorer/address/:a` | 🟢 | `profile/<addr>` + explorer pages |
| portfolio USD | swap-preview + mempool | 🟢 external price feed — unchanged (display only) | off-chain |
| membership tier / free-tx | `GET /l2/account/:id/membership` | 🟡 kray-net has the immutable 1-₭ fee (A2), no tiers | design decision |

### Value transfer

| l2kray feature | Supabase endpoint | KRAYNET | kray-net action |
| --- | --- | --- | --- |
| **L2 send (KRAY)** | `POST /l2/transaction/send` | 🟢 **the beachhead** | `prepare/submit` `transfer` |
| L2 send (token) | `POST /l2/transaction/send` | 🟢 (bridged rune) | `prepare/submit` `rune-send` |

### Bridge (L1 ↔ L2)

| l2kray feature | Supabase endpoint | KRAYNET | kray-net action |
| --- | --- | --- | --- |
| deposit address / info | `GET /l2/bridge/info` | 🟢 different model | `bridge-link` + `POST /api/kraynet/rune/deposit` (SPV-proven) |
| pending deposits | `GET /l2/bridge/deposits/:id` | 🟢 no limbo — proven+credited atomically | `submitRuneDeposit` |
| **withdrawal (L2→L1)** | `POST /l2/bridge/withdrawal/user-funded` (+ PSBT co-sign) | 🟢 **trustless now** | `rune-exit` (lock, signed) → `rune-settle` (SPV-proven payout — H2 fix, 2026-08-01) |
| cancel withdrawal | `POST /l2/bridge/withdrawal/:id/cancel` | 🟢 **built** — `rune-cancel` consensus event (signed, nonce, 1-₭ fee) + `POST /api/kraynet/rune/cancel`; door refuses while a pre-signed settlement is armed | done 2026-08-16 |

### NFTs (= star inscriptions)

| l2kray feature | Supabase endpoint | KRAYNET | kray-net action |
| --- | --- | --- | --- |
| NFT inventory (owned) | `GET /l2/nfts/:account` | 🟢 | `profile/<addr>` (stars, incl. relics) |
| **transfer whole NFT** | `POST /l2/nfts/transfer` | 🟢 | `sendstar` |
| **mint an NFT** | `POST /l2/nfts/mint` (kray.space) | 🟢 | `inscribe` (or `origin` under an L1 parent) |
| collection create | `POST /l2/nfts/collection/create` | 🟢 parent→child lineage | `inscribe` with `parent` |
| name the NFT | — | 🟢 | `name` |
| media upload (IPFS) | `POST /l2/ipfs/upload` | 🟡 content lives in the journal/atlas; large-media handling to decide | `inscribe` bytes |
| list / unlist on market | `POST /l2/nfts/market/list` `/unlist` | 🔴 **build** — a relic marketplace on kray-net | new (escrow via `contract`, or a market event) |
| fractional shares | `POST /l2/nfts/shares/transfer` | 🔴 stars are indivisible — **build** a shares model (rune-as-shares or a contract) | design + build |
| royalties | mint `royalty_config` | 🔴 **build** — enforced in a `contract` | design + build |

### DeFi

| l2kray feature | Supabase endpoint | KRAYNET | kray-net action |
| --- | --- | --- | --- |
| AMM pools / quote / swap | `GET /l2/defi/pools` `/quote` · `POST /l2/defi/swap` | 🔴 **build** — an AMM as a kray-net `contract` (total, deterministic, keyless address) | `contract` + `contract-call` |

### Social

| l2kray feature | Supabase endpoint | KRAYNET | note |
| --- | --- | --- | --- |
| E2E chat (KrayChat) | `wss://kray.space/kraychat`, `GET /api/kraychat/pubkey/:a` | 🔴 build **or keep off-chain** | E2E messaging may stay a side channel; only the pubkey registry needs the proven address book |
| atomic-swap marketplace (L1) | `/api/atomic-swap/*` | 🔴 L1 marketplace — out of KRAYNET scope for now | separate track |

## The three tiers

- **Tier 1 — 🟢 migrate first (proven, ~1:1):** balances, tx history, KRAY transfer, rune
  transfer, NFT inventory, NFT transfer (`sendstar`), mint (`inscribe`/`origin`), name,
  collection (parent/child), deposit + withdrawal (the SPV-proven bridge). This is most of
  the daily wallet, and it is *already provable end-to-end*.
- **Tier 2 — 🟡 decide the model:** membership tiers vs the flat 1-₭ fee; multi-token as
  bridged runes; fractional NFT shares; large-media inscriptions. Small designs, no new
  trust.
- **Tier 3 — 🔴 build on kray-net (never on Supabase again):** the relic **marketplace**
  (both sides proven), the **rune AMM**, **royalties** (as a contract), and **chat**
  (build or keep off-chain). Each ships as a *signed + proven* capability. Designed below.

## The two Tier-3 builds, designed

Both must be **proven for BOTH parties** — no trusted escrow, no server that could favour
one side. On a Supabase market you trust the backend to match buyer and seller honestly; on
KRAYNET the trade *is* the proof.

### The marketplace — an atomic, mutually-signed trade

Recommended primitive: a dedicated **2-of-2 signed `trade` event** — the on-chain analogue
of a Bitcoin atomic-swap PSBT.

1. The **seller** signs the exact terms: *sell star S to whoever pays P (₭ or rune R)*.
   Signing locks the relic (it cannot move as anything else while the offer stands).
2. The **buyer** signs the *same* terms: *buy star S for P*.
3. The reducer, at ingress **and** replay, verifies **both** BIP-340 signatures over the
   identical terms, then applies the settlement **atomically**: relic → buyer, payment →
   seller, the eternal 1-₭ fee → treasury. All three, or none.

Neither side can be cheated — the seller cannot take payment without releasing the relic,
the buyer cannot take the relic without paying, because the reducer does both or throws.
No escrow account holds anyone's asset in limbo, and any stranger re-derives the whole trade
from the two signatures. (Bids/offers are just signed terms a counterparty later accepts.)

*Real build item:* a `trade` event kind that moves a **star** (not only ₭) atomically
against a payment — today `sendstar` and `transfer` are separate signed acts; a trade fuses
them under two signatures.

### The rune AMM — DeFi as a proven contract

The AMM is a kray-net **`contract`** (total, deterministic, keyless address — the same class
that seals the vault) holding a pool of **runes + ₭**. It swaps rune ↔ ₭ (and rune ↔ rune
via two hops) on a constant-product rule.

- **LPs** sign a deposit that credits the pool contract; **swappers** sign a `contract-call`
  that pays in and receives out. Both sides proven; the pool never pays more than it holds
  (payments come only from the contract's own balance, so Σ = 2.1Q is untouchable from
  inside).
- The rule is integer-only (BigInt `x·y = k`, floor division that always rounds **toward the
  pool**, never minting a satoshi), re-executed on every replay — identical output on every
  node, or HALT.
- The rune-book's solvency tripwire (Σ credits + locks = reserve) still holds across every
  swap: the pool's rune credits move, the reserve does not.

*Real build item:* the contract VM must be able to hold and move **rune-book** balances (today
it moves ₭). A contract address is already a valid rune holder; wiring `contract-call` to
debit/credit the rune-book — under the same solvency assertion — is the core of the work.

## Backend reality — what l2kray actually does (and where KRAYNET wins)

Mapped from `~/ai-projects/kray-local/kray-space` (Supabase backend). Every rule below is
real, with the number; the "→ KRAYNET" column is the proven replacement.

### The shape of it
The l2kray "chain" is a **Supabase mutable-row system**: signatures gate *intent* (they ARE
Schnorr-verified, message `from:to:amount:nonce:tx_type`, pubkey bound to `from` — good), but
**settlement is a plain `UPDATE`** the server applies and can rewrite. A hub Merkleizes the
signed intents into blocks it **signs itself** — the prover is the trusted party. Admin routes
mint/adjust/re-own at will. This is the exact gap KRAYNET closes: on kray-net the reducer
**re-derives** every balance/owner from the signed events on every replay — no row to rewrite,
no self-signed block.

### Money & identity
| l2kray rule | → KRAYNET |
| --- | --- |
| account = L1 taproot address, created as a row | already the model (A9), no create step |
| balances = `TEXT` BigInt rows the server can rewrite | derived by replay; conservation-or-HALT (A1) |
| fee = flat **1 KRAY**/op, 100% to treasury, 0% burn | identical (A2) |
| **membership tiers** give free-tx/day (black 100 · diamond 50 · gold 30 · amethyst 15 · common 5 · none 0), gated by owning an Ordinal child of a parent inscription | ✅ **DECIDED:** the 1-₭ fee is immutable (A2) — free-tx is impossible on KRAYNET. Membership becomes a **non-fee elite perk**, designed later with the Creator. Seeds (all A2/A4-safe): the membership card IS a relic (a star inscription); it unlocks visibility/verified badges, premium name namespaces, creator tools (deploy contracts / open collections), priority ordering — status and access, never a discount. |
| tokens: KRAY + runes DOG / DSC / RADIOLA / SATSPACE | bridge each as a rune (rune-book) |

### The bridge
| l2kray rule | → KRAYNET |
| --- | --- |
| deposit: server poller, **6 confs**, exact rune-name match, credits sender | `rune/deposit` — **SPV-proven** from raw bytes, same 6-conf depth, exact rune id |
| withdrawal: user-funded collaborative PSBT, balance burned on request, **24 h** nominal window but real trigger = the hub sealing its own block | `rune-exit` (signed lock) → `rune-settle` (**SPV proof** the payout reached the signed L1 address — H2) |
| custody: 2-of-3 taproot **but the server holds all 3 keys** (hot wallet) | **no custody** — kray-net never holds user keys; the payout is proven, not signed by an operator |

### The AMM — reproduce to the unit
Constant-product, **0.3% fee hardcoded as `997/1000`** (the `fee_rate` DB column is display-only
— do NOT read it). Pools are rune↔KRAY or rune↔rune. LP = Uniswap-V2 (first deposit
`floor(sqrt(a·b)) − 1000`, the 1000 `MINIMUM_LIQUIDITY` burned; fees accrue in-reserve, realized
on `removeLiquidity`). The kray-net **contract** must reproduce exactly:

```
amountOut = floor( (amountIn·997 · reserveOut) / (reserveIn·1000 + amountIn·997) )
reject if amountOut == 0  or  amountOut >= reserveOut
require (reserveIn+amountIn)·(reserveOut−amountOut) >= reserveIn·reserveOut   // k grows
first LP mint: floor(sqrt(a·b)) − 1000  (burn 1000)   ·   add: min(floor(a·L/Ra), floor(b·L/Rb))
remove: out_x = floor(lp·Rx/L)          ·   all BigInt, floor = rounds toward the pool
```
**What KRAYNET fixes (the AMM trust points):** today the swap signs only the *input* side —
`reserveOut`, `amountOut`, `minAmountOut` and even the `pool_id` are server-chosen and unsigned,
so a bad server can mis-price or reroute. On kray-net the swap is a `contract-call` whose output
is **re-derived by the reducer** from on-chain reserves; the pool is the contract's own address;
`minAmountOut` is part of the signed call. Reserves live in the contract (replay-derived), not a
DB row — and the k-invariant is code, re-checked on every replay.

### The NFT marketplace — the both-sides gap, exactly
- NFT = a Supabase row (`owner_address` IS the NFT). Mint signs the content-hash + price;
  collection/name/file are trusted to the server.
- **Fractional shares:** optional, supply **1 – 10,000,000** (there is *no* fixed 100k — that
  was a UI default), cap-table in rows, sealed only by `sha256(nft_id:shareTokenId:supply)`.
  **The "value stream" (dividends/revenue/governance) is NOT implemented** — aspirational
  metadata. 🟡 KRAYNET gets to *define* it (rune-as-shares + a payout rule in a contract).
- **Marketplace settlement — the headline gap:** listing keeps the NFT in the seller's own row
  (**no escrow**); **buy is signed by the BUYER only** (`buyer:listing_id:price:token:nonce:buy_nft`)
  — the *seller*, the **2% fee** (to a hardcoded `bc1prwz…kkdnfn`), the seller payout and the
  split are all **server-computed and unsigned**; settlement is a JS saga with manual rollback
  (a crash mid-flow leaves money moved but NFT not). **Creator royalty on resale = 0** (none exists).
- **→ KRAYNET:** the 2-of-2 signed atomic `trade` (designed above) closes every one of these —
  both parties sign the *same* terms (star, price, token, fee, royalty), the reducer applies
  relic→buyer, payment→seller, fee→treasury **atomically** or throws, and royalties (if the
  Creator wants them) are part of the signed terms, not a server's discretion.

### The trust points KRAYNET closes (the whole point)
From the backend audit, every one of these is "trust the server" today → "proven" on kray-net:
balances are rewritable rows · confirmation is instant + self-attested · custody is a
server hot-wallet · deposits mint on an off-chain oracle · the "challenge window" is a delay,
not a fraud proof · solvency is the server auditing itself · marketplace settlement is
off-signature · NFT ownership is a mutable column · swap output/pool/reserves are unsigned.

## Adapter architecture

- Add `activeNetwork: 'mainnet' | 'kray-l2' | 'kraynet'` (the switcher already forks the
  view on `activeNetwork === 'kray-l2'`).
- New `popup/krayNet.js` mirroring `krayL2.js`'s shape, but every write is
  `prepare → signMessageWithConfirmation → submit`, and every read hits `/api/kraynet/*`.
  Same UI components, swapped data source + a real proof per action.
- Reuse `krayL2.js`'s UI; only the data/signing layer changes.

## Migration order (phased, each phase shippable)

1. **Read-only beachhead** — KRAYNET mode shows balance + stars + history from the node
   (no signing). Proves connectivity + the read model.
2. **First signed action** — `transfer` (send KRAY), end-to-end: prepare → popup sign →
   submit → sealed in the explorer. Proves the Supreme Law from the wallet.
3. **NFT core** — inventory (stars) + `inscribe` (mint) + `sendstar` (transfer) + `name`.
4. **Runes** — `rune-send` + the deposit/exit/**settle** bridge.
5. **Tier-3 build** — marketplace, AMM, royalties, chat (each signed + proven).
6. **Flip** — KRAYNET becomes the default; l2kray labelled *legacy*.
7. **Retire** — decommission the `/l2/*` Supabase surface below.

## Prerequisites (the Creator's calls)

- **A reachable kray-net node.** Lab: `localhost:4477`. Public Signet:
  `https://signet.kray.network`. Bitcoin mainnet writer:
  `https://www.kray.network` (not ignited). Phases 1–4 can run against the
  local bench with zero user risk.
- **Tier-2 model decisions** (fee/tiers, fractional shares, tokens-as-runes).
- **Tier-3 scope** — which of marketplace / AMM / royalties / chat land in the first
  public KRAYNET, and which wait.

## The Supabase surface being retired (`/l2/*`)

```
POST /l2/account/create            GET /l2/account/:id/balance(s)
GET  /l2/account/:id/transactions  GET /l2/account/:id/membership
POST /l2/transaction/send          GET /l2/bridge/info
GET  /l2/bridge/deposits/:id       GET /l2/bridge/withdrawals/:id
POST /l2/bridge/withdrawal/user-funded  …/:id/submit-signed  …/:id/cancel
GET  /l2/defi/pools  /quote/…      POST /l2/defi/swap
GET  /l2/nfts/:account  …/market/seller/:account  …/shares/:id  …/shares/balance/:a
POST /l2/nfts/transfer  …/shares/transfer  …/market/list  …/market/unlist
GET  /l2/nfts/vault-check/…  /collection/:id  POST /l2/ipfs/upload  /nfts/collection/create  /nfts/mint
wss://kray.space/kraychat  GET /api/kraychat/pubkey/:a  GET /api/dashboard/avatar/:a
```

Each retires only once its KRAYNET replacement is proven and default. Nothing is turned off
before its proof is on.
