# The library — every document, and where it stands

Start at the repository door: [`../README.md`](../README.md) (the ₭) and the
public network map [`../networks/README.md`](../networks/README.md). Any
assistant: [`../AGENTS.md`](../AGENTS.md) → [`RUN-NODE.md`](RUN-NODE.md).

The page people open from the footer is [`../apps/kray-net/docs.html`](../apps/kray-net/docs.html)
(`/docs`). The LLM contract tutorial on the wire is [`CONTRACTS.md`](CONTRACTS.md)
(`/docs/contracts.md`). This folder is the library behind those doors.

Every document here is either LAW the code must match (**normative**), a **design** still earning its way into the code, or a **historical** record — dated, never rewritten, only labeled — and when a doc and the code disagree, the code and its proofs win, and the doc gets a header saying so.

Files stay at this root so every citation (`docs/AXIOMS.md`, `/docs` HTML, clone recipes) keeps working. The houses below are how a senior reads the shelf — not a second tree. That is [`FOLDER-LAW.md`](FOLDER-LAW.md), not a deploy caution.

## Law

| doc | one-line purpose | status |
| --- | --- | --- |
| [`AXIOMS.md`](AXIOMS.md) | The Supreme Law (`signature ‖ Merkle proof ‖ Bitcoin anchor`) and axioms A0–A10 every decision derives from. | normative |
| [`FOLDER-LAW.md`](FOLDER-LAW.md) | The names of this tree. Three houses: official / writer disk / workshop. Locked now. Mainnet ignited = rename forbidden. | normative |
| [`CONSENSUS-CONSTITUTION.md`](CONSENSUS-CONSTITUTION.md) | The rigid invariants: each article is [ENFORCED] or an honest [NAMED PATH]. | normative |
| [`BRIDGE.md`](BRIDGE.md) | The rune vacuum: a Bitcoin L1 rune becomes a proven L2 asset, with the road back always open. | normative |
| [`CONTRACTS.md`](CONTRACTS.md) | The IR tutorial served at `/docs/contracts.md` — paste into any LLM. Total paper, no loops, cannot mint ₭. | normative |
| [`BURN-PROOF.md`](BURN-PROOF.md) | Verify yourself that the burn address belongs to NOBODY — the NUMS chain, rebuilt from public constants. | normative |
| [`TOKENOMICS.md`](TOKENOMICS.md) | Why an indivisible ₭ holds value, and how mining, validating and stars are made worth it. | normative |
| [`ORIGIN.md`](ORIGIN.md) | The law of KRAY child inscriptions under a Bitcoin L1 ordinal parent — owner-gated, proven from bytes. | normative |
| [`PROOF-COMPARISON.md`](PROOF-COMPARISON.md) | Where KRAY's guarantees stand against Bitcoin and other chains — uncomfortable where the truth is. | normative |
| [`QUANTUM-READINESS.md`](QUANTUM-READINESS.md) | The exact quantum exposure (no more, no less than Bitcoin's) and the staged post-quantum migration, live. | normative |
| [`AUDIT-DOSSIER.md`](AUDIT-DOSSIER.md) | The briefing a third-party security firm receives: claims, attack surfaces, and the commands that reproduce every proof. | normative |
| [`SECURITY.md`](SECURITY.md) | The security posture: invariants that hold, open items tracked out loud, responsible disclosure. | normative |
| [`POT-CUSTODY.md`](POT-CUSTODY.md) | Who may hold the bakery pot owner key; follower ≠ cofre; no live host map. | normative |
| [`anchor-spec.md`](anchor-spec.md) | The 49-byte OP_RETURN anchor commitment, byte by byte — verify KRAY with nothing but a Bitcoin node. | normative |

## Run

| doc | one-line purpose | status |
| --- | --- | --- |
| [`RUN-NODE.md`](RUN-NODE.md) | Any clone / any LLM: quiz → preflight this machine → follow, guardian, or lab. “Full node” = follow. | normative |
| [`KRAYNET-RUN.md`](KRAYNET-RUN.md) | Boot, env, API, and the hermetic proof suite for the same binary. | normative |
| [`MAINNET-READINESS.md`](MAINNET-READINESS.md) | The plan of record for donor → proof → anchor → validator working exactly as it will on mainnet. | normative |
| [`../networks/README.md`](../networks/README.md) | Official map: `networks/signet/` vs `networks/mainnet/`. | normative |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Clone, prove, follow. The official tree is the validator door. | normative |

## Design

| doc | one-line purpose | status |
| --- | --- | --- |
| [`CAPACITY.md`](CAPACITY.md) | The measured 20-year storage model of a validator, and the compact interval record it forced. | design |
| [`FRONTIER-ADRS.md`](FRONTIER-ADRS.md) | ADRs for the remaining frontier rails before their consensus code lands. | design |
| [`KRAYNET-MIGRATION.md`](KRAYNET-MIGRATION.md) | The standing plan to replace the wallet's centralized l2kray with the proven KRAYNET, mode by mode. | design |
| [`PHASE-3-TRUSTLESS-CUSTODY.md`](PHASE-3-TRUSTLESS-CUSTODY.md) | The three levers that dissolve the pot's single owner; lever 1 has since gone live as the burn. | design |
| [`RAFFLE-DESIGN.md`](RAFFLE-DESIGN.md) | The validator raffle worked out to the byte — including the bug that reshapes the whole idea. | design |
| Mind (`/mind`) | Product mouth. Linker: `GET /docs/pack.json` (twelve + public docs). The book is memory. No persona hardness. See [`BOOK-AND-APPS.md`](BOOK-AND-APPS.md). | design |
| [`anchor-stealth.md`](anchor-stealth.md) | The stealth pay-to-contract anchor proposal — since realized in code as `self-anchor.ts`. | design |

## History

| doc | one-line purpose | status |
| --- | --- | --- |
| [`ANCHOR-PROOF-UX.md`](ANCHOR-PROOF-UX.md) | One-click burn/SPV in the explorer — built and live; body kept as the checklist. | historical |
| [`ANCHORING-UNIFICATION.md`](ANCHORING-UNIFICATION.md) | Slice-2 plan to retire the operator — largely executed; header is the live map. | historical |
| [`ATEMPORALITY-AUDIT.md`](ATEMPORALITY-AUDIT.md) | The 2026-08-14 council verdict: what is literally proven vs what is a chosen constant. | historical |
| [`DONATION-ECONOMICS-DECISION.md`](DONATION-ECONOMICS-DECISION.md) | The ADR of 2026-08-09: a donation is a keyless BURN that anchors — still the law in force. | historical |
| [`KRAYNET-CONSOLIDATION.md`](KRAYNET-CONSOLIDATION.md) | The executed contract that collapsed the era twin into ONE KRAYNET with the canonical names. | historical |
| [`KRAYNET-MODEL.md`](KRAYNET-MODEL.md) | The founding blueprint — fungible fuel, stars born from fire — captured before code moved, since built. | historical |
| [`KRAYNET-BUILD.md`](KRAYNET-BUILD.md) | The executed phased build plan. | historical |
| [`SIGNET.md`](SIGNET.md) | The pre-launch signet study of 2026-07-30; the network went live on public signet on 2026-08-06. | historical |

Era filenames (`KRAYNET-V2-BUILD.md`, `KRAYNET-V2-RUN.md`, `anchor-stealth-v2.md`)
are one-line pointers to the rows above. Cite the canonical name. Do not
treat them as a second library.
