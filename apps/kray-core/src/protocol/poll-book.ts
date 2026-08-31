/**
 * POLL BOOK — one glow-weighted ballot per address on a sealed poll star.
 *
 * The IR cannot store a map (CONTRACTS.md). Glow cannot move (✦ is a tally of
 * frozen stars). This book is the missing piece: who voted, which face, what
 * weight was locked at the act. Rebuilt from the journal on every replay.
 *
 * Not money. Not a cascade field (A3: glow itself is a derivation, not a root).
 * Empty book ⇒ no votes yet. A stranger re-derives the same tallies from the
 * signed `vote` calls + the freeze events that minted each voter's ✦.
 *
 * Mouth: Poll · ✦. Compiler kind: `poll`. Glow never transfers; the 1 ₭ fee
 * is the eternal seal on the call — same as every other public door.
 */
export interface PollBallot {
  address: string
  face: number
  weight: number
}

export interface PollView {
  star: string
  title: string
  choices: string[]
  ballots: number
  tallies: number[]
  voters: PollBallot[]
}

interface PollRow {
  title: string
  choices: string[]
  votes: Map<string, { face: number; weight: number }>
}

export class PollBook {
  private readonly rows = new Map<string, PollRow>()

  empty(): boolean { return this.rows.size === 0 }

  has(star: string): boolean { return this.rows.has(String(star)) }

  voted(star: string, addr: string): boolean {
    return this.rows.get(String(star))?.votes.has(addr) ?? false
  }

  open(star: string, title: string, choices: string[]): void {
    const k = String(star)
    if (this.rows.has(k)) throw new Error('poll-book: this star already has a poll')
    if (!Array.isArray(choices) || choices.length < 2) throw new Error('poll-book: a poll needs at least two choices')
    this.rows.set(k, { title: String(title || ''), choices: choices.map((c) => String(c)), votes: new Map() })
  }

  cast(star: string, addr: string, face: number, weight: number): void {
    const k = String(star)
    const row = this.rows.get(k)
    if (!row) throw new Error('poll-book: no poll on this star')
    if (!addr) throw new Error('poll-book: a vote needs a signer')
    if (row.votes.has(addr)) throw new Error('poll-book: already voted on this poll')
    if (!Number.isInteger(face) || face < 0 || face >= row.choices.length) {
      throw new Error('poll-book: that face is not on this poll')
    }
    if (!Number.isInteger(weight) || weight < 1) throw new Error('poll-book: a vote needs ✦ glow')
    row.votes.set(addr, { face, weight })
  }

  view(star: string): PollView | null {
    const k = String(star)
    const row = this.rows.get(k)
    if (!row) return null
    const tallies = row.choices.map(() => 0)
    const voters: PollBallot[] = []
    for (const [address, v] of row.votes) {
      tallies[v.face] += v.weight
      voters.push({ address, face: v.face, weight: v.weight })
    }
    voters.sort((a, b) => (b.weight !== a.weight ? b.weight - a.weight : (a.address < b.address ? -1 : 1)))
    return {
      star: k,
      title: row.title,
      choices: row.choices.slice(),
      ballots: row.votes.size,
      tallies,
      voters,
    }
  }
}
