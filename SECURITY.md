# Security

## Reporting a vulnerability

Report privately via a **GitHub private security advisory** on this repository
(Security → Report a vulnerability). Please do not open a public issue for anything
exploitable. You will get an answer, a fix timeline, and credit in the advisory if you want it.

**Scope that matters most:** `apps/kray-core/src/protocol` (consensus, ledger, reducer),
`apps/kray-core/src/economics` (presence, custody, split), and every write endpoint of the
node (`apps/kray-net/server.mjs`).

## The posture

The full red-teamed security posture — what is proven, what is open, and how to reproduce
every claim — lives in [docs/SECURITY.md](docs/SECURITY.md). The briefing prepared for
external auditors is [docs/AUDIT-DOSSIER.md](docs/AUDIT-DOSSIER.md).

The law beneath it all: value moves only by **signature ‖ SPV proof ‖ Bitcoin anchor** —
there is no admin path, and a node that cannot re-prove its past refuses to run it.

Signet and Bitcoin mainnet are separate universes (journal, pot, RPC, data dir).
A writer that would mix them refuses to boot. Public recipes:
[`networks/README.md`](networks/README.md).
