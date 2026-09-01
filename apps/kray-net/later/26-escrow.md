# ESCROW

**Parent:** `paper`
**Action:** Lock a payment between two sealed keys — release by the
buyer's word, refund by the clock, trust by neither.

Two addresses are sealed into the paper: a buyer and a seller. They
must differ — an escrow with one party is not an escrow. Anyone may
fund the pot; the pot is keyless, so no third hand can reach in.

Two doors, and only two:

- **accept** — only the sealed buyer. The whole pot pays the seller
  and the deal settles, once, forever. Not the star's owner, not
  the sealer, not a stranger: the buyer's signature or nothing.
- **refund** — after the sealed journal deadline, anyone may return
  the pot to the buyer. The clock is journal height, not a wall
  clock, so every node agrees on when "late" begins.

`settled` latches at the first exit. A second accept, a second
refund, an accept after refund — all refused. The mathematics is
the escrow agent: it cannot be bribed, cannot vanish with the pot,
and cannot pay early.

What this star refuses: a mediator key, a "support can release it"
door, an owner drain. If a deal needs a human judge, that judge is
a party sealed into a different paper — never a hidden hand over
this one.

## Stone

Escrow is two sealed keys and a deadline: the buyer's signature pays
the seller, the late clock pays the buyer back, and no third hand
exists.
