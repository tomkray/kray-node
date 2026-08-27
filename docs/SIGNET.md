# RUNNING KRAY ON SIGNET — a Bitcoin nobody here controls

> **Status: HISTORICAL (2026-07-30) — the pre-launch signet study; KRAYNET went LIVE on public signet 2026-08-06.**
> Kept as the record of the crossing. Two facts have moved since: the boot command (the code reads
> `KRAY_NET=signet`; `KRAY_ANCHOR_NET`/`KRAY_SIMULATION` were never read by `server.mjs` — corrected below),
> and mainnet is a **separate universe** (`KRAY_NET=main`, empty `data-main`, a new `bc1` pot) — never this
> Signet writer wearing a mainnet name. Operator map: [`networks/README.md`](../networks/README.md).
> Public follow: [`../networks/signet/README.md`](../networks/signet/README.md).
> The live public writer is `https://signet.kray.network` — do not stand up a
> second writer. Live keys stay in a gitignored `/signet/` on the operator box.

Regtest is a laboratory: the operator mines their own confirmations, so a seal
"confirms" because we said so and its proof-of-work costs nothing. Everything the
code does is identical on signet — but there the blocks arrive from strangers, the
difficulty is real, and an anchor costs a fee. That is the difference between
*works* and *proven*.

## What is already true

The node's own signet is provisioned inside this repository and fully synced.
Verified against REAL signet data at height 315,440:

| check | result |
|---|---|
| header's proof of work vs signet's powLimit | **valid** |
| the same header judged by MAINNET's ruler | **refused** — signet difficulty is easier, and the code says so |
| BIP-34 height read from the coinbase | **315,440**, exactly |
| SPV seal verification | network-agnostic; the machinery is the same code path |

The anchor transaction is already network-general: `createrawtransaction` →
`fundrawtransaction` → `signrawtransactionwithwallet` → `sendrawtransaction`. The
wallet chooses the UTXOs and pays the fee, so nothing about the anchoring path is
regtest-specific. `CAN_MINE` is false outside regtest, so confirmations are
awaited rather than manufactured.

## The one thing missing: sats

```
wallet:  kray-anchor       (signet)
balance: 0
address:  (printed by the provisioner — never a hardcoded operator address)
```

Signet faucets require a captcha, so this is the one step a human has to take.
Fund a Signet wallet you control from any faucet — a few thousand sats is
enough for many anchors — and then:

```
# server.mjs reads KRAY_NET — KRAY_ANCHOR_NET / KRAY_SIMULATION were never read by it.
# Point at YOUR Signet bitcoind. Live keys stay gitignored in /signet/.
KRAY_NET=signet KRAY_PORT=4478 \
KRAY_DATA=apps/kray-net/data-signet \
KRAY_BTC_RPC=http://127.0.0.1:38332 \
KRAY_BTC_RPC_USER=<your rpc user> \
KRAY_BTC_RPC_PASS=<your rpc password> \
KRAY_BTC_WALLET=<your signet wallet> \
KRAY_POT_ADDRESS=<the network pot tb1p… address> \
node apps/kray-net/server.mjs
```

## What changes the moment you do

- **Seals cost money.** Each anchor is a real signet transaction with a real fee,
  so the network stops anchoring for free and starts anchoring on purpose.
- **The clock becomes somebody else's.** An interval is released when signet
  reaches genesis + k, proven by BIP-34 from a coinbase mined by strangers. The
  operator cannot hurry it, which is exactly the property regtest cannot test.
- **`powMeaningful` turns true.** On regtest the verdict says out loud that the
  work means nothing; on signet the number is real weight in a chain we do not
  control.
- **Confirmations take minutes, not milliseconds.** `SEAL_CONFIRMATIONS = 2` is
  roughly twenty minutes of signet, so the ladder advances at Bitcoin's pace. The
  patience is the point.

## What signet still cannot prove

Signet's difficulty is low and its blocks are signed by a fixed set of miners, so
its proof of work is not economically meaningful the way mainnet's is. It proves
the CODE — every path, every parse, every refusal, against a chain nobody here
mines. It does not prove the ECONOMICS. Only Bitcoin mainnet does that, and that
is a **different writer**: fresh genesis, new pot, `KRAY_NET=main`. This Signet
process must never become that writer. `NET_CONF` is gone; isolation is
`apps/kray-net/network-boot.mjs`.
