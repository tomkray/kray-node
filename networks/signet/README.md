# Signet — the public lab

Live writer: `https://signet.kray.network`

This is the dress rehearsal. Real Signet sats, real seals, the same binary
mainnet will run. It is **not** Bitcoin mainnet. Do not point
`www.kray.network` at this writer.

## Follow this history

```
git clone https://github.com/tomkray/kray-node.git KRAY-NODE
cd KRAY-NODE
cd apps/kray-core && npm ci && cd ../..
node scripts/follow/kray-follow.mjs --from https://signet.kray.network --dir ./follower --watch --serve 4480
```

Windows: `scripts\follow\signet.cmd`.

Quiz + preflight first: [`../../docs/RUN-NODE.md`](../../docs/RUN-NODE.md).

That is a **full node** of Signet KRAY — journal, stars, atlas, read-only
mirror on `:4480`. It never writes. It never holds the pot key.

The last polish is **your** Signet Bitcoin Core (`KRAY_BTC_RPC`) so seals
are re-proven here. Follow first; add bitcoind after. Same universe only.

## Writer env (operators)

Copy [`node.env.example`](node.env.example) into gitignored `/signet/node-hot.env`
on the public writer host. The owner secret stays in `/signet/vault-keys.env`
or `/signet/owner.box` on the key machine — never on a follower.

Live journal: `apps/kray-net/data-signet/kraynet-journal-signet.jsonl`.

## Wallet

KrayWallet → DevNet **ON** → flavor **Signet**. The KRAYNET tab talks to
this writer. A `bc1` pot is refused.
