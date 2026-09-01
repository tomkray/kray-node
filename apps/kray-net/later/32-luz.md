# LUZ

**Parent:** `paper`
**Action:** Seal a token constitution on a star — KRC-77 — a
capped (or infinite) supply on the book. Rain is a sealed
choice: ₭ deposits fall on every holder, or the paper is
book-only. No hand, not even the owner's, can drain a pot.

Luz ✧ is a share of a star's light. The paper seals the supply at
birth — a hard cap, or infinite, declared once and never amended.
Founders may be named in the genesis, each with their sealed cut;
after the seal, shares move only on the book, hand to hand.

Rain is off by default (book only). When rain is on, one public door,
`deposit`, is the pot economy:
anyone drops ₭, and the paper raises the accumulator — rewards
per share, in fixed-point integers (`prec` = 1e12). ₭ itself has
no decimals. A small drop on a large supply stays dust until a
hand can claim a whole ₭ (`floor(held * acc_rps / prec)`). Off
means book-only: no pot door. Either way there is no `collect`.

What is missing is the constitution. There is no `collect`. There
is no toggle. There is no admin door of any kind. The sealer of a
Luz paper walks away with exactly the shares they were dealt and no
lever over anyone else's. A rug needs a hand on the drain; this
paper was sealed without a drain.

Shares, balances, and claims live on the book — derived from the
journal, replayed identically by every node — because the paper
itself keeps only integers. The paper is the law; the book is the
memory; neither can contradict the other.

What this star refuses: a supply amendment, an owner drain, a
founder minted after birth, a deposit that pays some holders more
per share than others.

## Stone

Luz ✧ is a sealed supply. Rain is off by default; opt in at seal. When on,
every deposit rains on all holders per share. No collect, no
toggle, no drain — the constitution has no hands.
