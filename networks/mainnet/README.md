# Bitcoin mainnet

Public writer: `https://www.kray.network`

Same protocol as Signet. **A different universe.** New genesis. New journal.
New bakery. New keys. Do not copy `/signet/`, `data-signet/`, or the Signet
journal here. This house is born with `data-main/` and `/api/kraynet` as
the mouth.

## Follow this history

```
git clone https://github.com/tomkray/kray-node.git KRAY-NODE
cd KRAY-NODE
cd apps/kray-core && npm ci && cd ../..
node scripts/follow/kray-follow.mjs --from https://www.kray.network --dir ./follower-main --watch --serve 4481
```

Windows: `scripts\follow\mainnet.cmd`.

Quiz + preflight first: [`../../docs/RUN-NODE.md`](../../docs/RUN-NODE.md).

That is a **full node** of mainnet KRAY — journal, stars, atlas, read-only
mirror on `:4481`. It never writes. It never holds the pot key. Use
`follower-main` so a machine that also follows Signet does not mix the two
books.

The last polish is **your** Bitcoin Core (`KRAY_BTC_RPC`) so seals are
re-proven here. Follow first; add bitcoind after. Same universe only.

## Wallet

KrayWallet with DevNet **OFF** talks to `https://www.kray.network`.
A `tb1` pot is refused.

## Writer env (operators)

Copy [`node.env.example`](node.env.example) into gitignored
`/mainnet/node-hot.env` on the public writer host. The owner secret stays
in `/mainnet/vault-keys.env` or `/mainnet/owner.box` on the **key machine**
— never on a follower, never in this repository.

Live journal: `apps/kray-net/data-main/kraynet-journal-main.jsonl`.

The writer refuses to boot if this folder still holds a Signet journal,
if the RPC is `:18454` (regtest) or `:38332` (Signet), if the pot is `tb1`,
or if `KRAY_TRUSTED_DEV=1`.
