# KRAYNET — run & validate

> **Status: NORMATIVE — how to boot and verify the same binary.**
> Folder names: [`FOLDER-LAW.md`](FOLDER-LAW.md). Public map:
> [`../networks/README.md`](../networks/README.md).
> To **follow a public history**, start at [`RUN-NODE.md`](RUN-NODE.md).

This page documents the process every network runs:
`apps/kray-net/server.mjs`.

## Boot

```bash
# this history (recommended)
node scripts/follow/kray-follow.mjs --from https://signet.kray.network --dir ./follower --watch --serve 4480

# or a local writer with an empty journal
node apps/kray-net/server.mjs
# → http://localhost:4477  (regtest defaults)
```

| Env | Default | Notes |
|---|---|---|
| `KRAY_PORT` | `4477` | Lab bench. Public Signet writer uses its own port. |
| `KRAY_NET` | `regtest` | `signet` · `main` |
| `KRAY_DATA` | `apps/kray-net/data-lab` | `data-signet` when `KRAY_NET=signet`; `data-main` when `KRAY_NET=main` |

Mainnet also requires `KRAY_BTC_RPC`, `KRAY_ORD_URL`, and a **new** `bc1`
`KRAY_POT_ADDRESS`. The writer refuses a mixed universe (Signet journal, lab
RPC, `tb1` pot, `TRUSTED_DEV=1` on main). Recipe: [`networks/mainnet/`](../networks/mainnet/).

Public writers:

| Network | URL |
|---|---|
| Signet (live) | https://signet.kray.network |
| Bitcoin mainnet | https://www.kray.network |

Pages on any writer: `/` · `/validate` · `/verify` · `/burn` · `/docs` ·
`/mind` · `/profile/<addr>` · `/star/<n>` · `/runes`.

## The wallet

KrayWallet already seats both public names. It does not invent a third.

| Toggle | L1 | KRAYNET tab |
|---|---|---|
| DevNet **OFF** | Bitcoin mainnet (`bc1…`) | https://www.kray.network (dark until the writer answers) |
| DevNet **ON** + Signet | Signet (`tb1…`) | https://signet.kray.network |
| DevNet **ON** + regtest | regtest (`bcrt1…`) | local bench (`localhost:4477`) |

Every act is prepare → review-and-sign → submit. The reducer re-verifies the
signature. A pot whose HRP is on the other network is refused.

## Mint ₭ (regtest bench only)

In production a donation is SPV-proven. A local bench may credit directly when
`KRAY_TRUSTED_DEV=1`. A Signet or mainnet writer refuses this door.

```bash
curl -s localhost:4477/api/kraynet/donate -H 'content-type: application/json' \
  -d '{"to":"<your bcrt1p…>","sats":"5000"}'
```

→ 5,000 ₭ (1 ₭ per satoshi, capped at the pot deficit).

## The API

| endpoint | returns |
| --- | --- |
| `GET /api/kraynet/overview` | network: supply, pot, star count, cascade root, conserves/backed |
| `GET /api/kraynet/head` | seq, head, cascade root, supply, pot |
| `GET /api/kraynet/supply` · `/pot` | `{emitted,burned,circulating}` · the anchoring pot |
| `GET /api/kraynet/profile/<addr>` | balance, nonce, stars held, star count |
| `GET /api/kraynet/star/<n>` | owner, creator, content/name, the Codex, L1 provenance |
| `GET /api/kraynet/runes` · `/runes/of/<addr>` | the rune L2: reserves + holders / an address's holdings |
| `GET /api/kraynet/contracts` · `/contract/<addr>` | the DeFi layer: contracts + state |
| `GET /api/kraynet/anchor/payload` | the exact 49-byte OP_RETURN committing the whole state |
| `POST /api/kraynet/prepare` | the canonical message the wallet must sign |
| `POST /api/kraynet/submit` | verify the signature (in the reducer) + append |
| `POST /api/kraynet/donate` | proof-of-donation mint (bench / proven path) |

## Verify

```bash
cd apps/kray-core && npm ci
npm test                 # hermetic suite
cd ../.. && npm run test:boot
```

`npm run test:core` (from `apps/kray-core`) runs the core sims: starmap · pot ·
ledger · store · node · rune · contract · anchor · grand-exam · server.itest ·
donation-live.itest · concurrency-proof. Every act is signed, every invariant
re-checked, a cold reboot is byte-exact.

## What remains (not this page's job)

Live anchor broadcast and validator fee-pool settle **already ship**. What is
left before Bitcoin mainnet is ignition: empty `data-main`, a new `bc1` pot,
public TLS on `www.kray.network`, and the external audit
([`AUDIT-DOSSIER.md`](AUDIT-DOSSIER.md)). The executed v1→v2 rename is
historical: [`KRAYNET-CONSOLIDATION.md`](KRAYNET-CONSOLIDATION.md).
