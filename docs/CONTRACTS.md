# KRAY.NETWORK contracts — tutorial for humans and AIs

Paste this file into Claude, Cursor, or any LLM. Then say what you want
("a paid drop of 12 songs", "escrow until I accept", "a 3-use concert pass").
You may **think** in Solidity, Rust, or Move. The model must **seal** only the
JSON paper below. Those languages can loop and mint; this reducer cannot run
them, so pasting them as the paper fails the exam on purpose — not as a taste
ban, as a proof gate. Translate the idea → IR → Run test.

Public explorer: hang the paper on a star you own (`/inscribe` → Law, or the
star page). **Run test** (dry exam, no ₭). Then **seal** (burns 1 ₭). A stranger
re-derives every call from the journal + Bitcoin anchor.

## What this is (Ethereum / Solana, Bitcoin's soul)

On Ethereum you write Solidity; the EVM can loop, so you pay gas and fear
reentrancy. On Solana you write a program; accounts and compute units are the
meter. **KRAY is the same idea — anyone may publish a law — with a smaller
language on purpose.**

| Their word | Here |
|---|---|
| Smart contract / program | A **paper**: `{ vars, rules }` sealed on a star |
| `constructor` | Hang the paper on a face you own (v2). Burns 1 ₭ |
| `msg.sender` | `ctx.caller` (who signed) · living owner is `ctx.holder` / `{ living: "owner" }` |
| ETH / SOL transfer into the program | `take` — caller pays into the pot this call |
| Transfer out | `pay` — only from what the pot already holds (plus `take` in the **same** call) |
| ERC-721 / candy-machine mint | **Inscribe a child.** Rule `mint` is a **blessing**, not a `contract-call` |
| `tokenURI` / off-chain metadata | Art URL lives on the **writer node only** (not the journal). Buyer signs the **hash** |
| Events / logs | The journal. Replay is the verifier |
| Admin key | There is none. Mouth tools (`collect`, `toggle_*`) follow `ownerOf(star)` |

Three laws of the language (they are consensus, not style):

1. **Total** — no loops, no recursion, no jumps. Finite expression tree. Node budget 512, depth 32.
2. **Deterministic** — integers only. No wall clock, no I/O, no RNG except the Bitcoin **beacon** already in the journal.
3. **Cannot create value** — a contract is an account. It cannot mint ₭. Worst case: it empties **itself**.

Templates on the desk (mint, raffle, escrow, scroll…) are **shortcuts for common
patterns**. Most people will write their own paper. Same IR either way.

## The paper (the only source you may emit)

```json
{
  "vars": { "open": "1", "price": "5", "taken": "0" },
  "rules": [
    {
      "name": "buy",
      "when": { "op": "and", "args": [
        { "op": "eq", "args": [{ "var": "open" }, { "lit": "1" }] },
        { "op": "lt", "args": [{ "var": "taken" }, { "lit": "10" }] }
      ]},
      "then": [
        { "take": { "amount": { "var": "price" } } },
        { "pay": { "to": { "living": "owner" }, "amount": { "var": "price" } } },
        { "set": { "var": "taken", "to": { "op": "add", "args": [{ "var": "taken" }, { "lit": "1" }] } } }
      ]
    }
  ]
}
```

Limits: ≤ 32 rules, ≤ 16 actions per rule, ≤ 32 vars. Names: `^[a-z][a-z0-9_]{0,23}$`.
Amounts are **decimal strings** of whole ₭ (`"5"`), never floats, never JS numbers
in the JSON you seal.

### Expressions

| Shape | Meaning |
|---|---|
| `{ "lit": "1" }` | Integer constant |
| `{ "var": "taken" }` | State |
| `{ "arg": "amount" }` | Signed call argument |
| `{ "ctx": "caller" }` | Signer as integer |
| `{ "ctx": "holder" }` | Living star owner as integer |
| `{ "ctx": "balance" }` | ₭ the pot holds **before** this call |
| `{ "ctx": "height" }` | Journal seq of this act |
| `{ "ctx": "beacon" }` | Bitcoin seal entropy (v2 calls) |
| `{ "ctx": "star" }` | Bound face number |
| `{ "op": "add", "args": [A, B] }` | `add sub mul div mod min max isqrt neg` · `eq ne lt le gt ge` · `and or not` · `if` (cond, then, else) |

### Actions

| Action | Effect |
|---|---|
| `{ "take": { "amount": E } }` | Caller pays E ₭ into the pot (same act) |
| `{ "pay": { "to": T, "amount": E } }` | Pot pays E. `T` is `{ "addr": "…" }`, `{ "living": "owner" }`, `{ "living": "caller" }`, or `{ "seat": E }` |
| `{ "set": { "var": "x", "to": E } }` | Remember a number |
| `{ "require": E }` | If E is 0, the **whole** call is refused (no partial write) |
| `{ "bind": { "at": E } }` | Remember the caller at roster seat E (raffle) |

`take` in the same rule **funds** later `pay` (the pot may start at 0).

### Living mouth vs public door

- **Mouth** (only `ownerOf` the face): `collect`, `toggle_*`, `once_*`, `stamp`, `draw`, `skip`.
- **Door** (anyone who can satisfy `when`): `claim`, `enter`, `accept`, `punch` if the guard says so, …
- Rule name **`mint`**: **not a call.** The reducer runs it when someone **inscribes** a child with this star as parent. A standalone `contract-call` `mint` is refused.

## Collection mint (the ETH/SOL drop)

People click Buy. One signed **inscribe**:

1. Eternal **burn** to write the star (floor 1 ₭, size may raise it).
2. Rule `mint`: `take` price → `pay` seller (`payTo` or living owner) → `taken++`.
3. Bytes are the **artist's** file (writer pulls a secret URL). Buyer never uploads.
4. **A5:** those exact bytes (and body hash) are unique forever. Same image cannot mint twice. Two clicks: first wins; second is refused **before** any ₭ moves.

Multi-edition URL must contain `{n}` (0-based next) or `{i}` (1-based). The URL is
**not** consensus — a replica must not learn it. Seal still requires a real `https://`.

Do **not** invent a second transaction "pay then mint". That races (`taken` without a child).

## How a person (or an AI) ships

1. Write or generate the JSON paper.
2. `/inscribe` → Law → pick a face → **Code** (or a template to start) → paste → **Run test**.
3. Exam must say **ready**. Solidity/Rust pasted as the paper fail at parse —
   ask the AI to translate that draft into this JSON first.
4. Seal. Burns 1 ₭. The `codeHash` in the explorer is what was signed.
5. People call public rules (`contract-call`, +1 ₭ fee) **or** mint by inscribing.

If the exam is not ready, fix the paper. Do not ask the user to sign a broken law.

## Refuse these ideas (they cannot be proven here)

- Loops, maps, strings, floats, HTTP inside the reducer, "call another contract".
- Minting ₭ or runes from the paper.
- An admin override, a server that "just credits".
- Putting the art URL in the journal (replicas would leak the drop).
- ERC-1155 same-bytes supply (A5: one universe, one content hash).

When the user wants something outside the IR, **say so** and offer a paper that
fits — or a star + inscription + this blessing — never a louder copy of Solidity.
