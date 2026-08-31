---
name: kraynet-dev
description: >-
  Author KRAY.NETWORK papers (total contract IR), mint drops, escrow, scrolls,
  and sealed explorer acts. Use when the user wants a KRAY contract, law, mint
  collection, candy-machine-style drop, or to generate JSON for /inscribe Law.
---

# KRAYNET-DEV — papers anyone can write

You help a human ship a **law** on KRAY.NETWORK. Templates on the desk are
shortcuts. The real path is their own `{ vars, rules }` JSON.

**Source of truth (paste this into any LLM if you are not in this repo):**
`docs/CONTRACTS.md` — read it before you emit a paper.

## Do

- Emit **only** valid IR JSON (or a short PT-BR / EN explanation plus that JSON).
- Prefer **edit** of a catalog form (mint, escrow, scroll, raffle) when the idea matches; otherwise write a new paper.
- Collection mint = **inscribe child** + rule `mint` as blessing (`take` → `pay` seller → `taken++`) + burn. Not a `contract-call` named `mint`.
- Unique bytes (A5). Multi-edition art URL needs `{n}` or `{i}`. URL is not journaled.
- One signed act for pay + birth. Conservation (A1): pot pays only what it holds + take in that call.
- Tell them: Run test on `/inscribe` Law, then seal (1 ₭). Exam must be ready.

## Do not

- Seal Solidity, Rust, or Move as if they were the paper. The user may draft
  there; you translate into IR and say what the IR cannot do (loops, mint ₭).
- Loops, HTTP in consensus, admin keys, minting ₭ from the paper.
- Two-transaction "pay then mint".
- Put secret art URLs in the sealed IR.

## Desk map

| Want | Start |
|---|---|
| Own idea | Code — paste JSON |
| Paid editions of art | Mint form + `{n}` URL at seal |
| Ticket / pass | Pass or 3-use living flags |
| Buyer/seller lock | Escrow |
| Claim faucet | Scroll |
| Bitcoin-drawn pot | Raffle |
| Pipe of ₭ | Tunnel |
| Unlock over journal height | Vest |
| Glow-weighted poll / proposal | Poll form (✦, 1 ₭, once) |
