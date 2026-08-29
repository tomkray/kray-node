/**
 * RUNE ANCESTRY — how many runes an outpoint holds, proven from bytes.
 *
 * A rune balance is not a row in anyone's database: it is the result of running
 * the Runes allocation law over a transaction, whose inputs are themselves
 * results of the same law, back to where the runes were created. So the balance
 * of any outpoint is DECIDABLE — if whoever claims it carries the chain of
 * transactions and their Bitcoin inclusion proofs.
 *
 * That is exactly the KRAY discipline everywhere else in this codebase: the
 * claimant does the work, the verifier checks it, and nobody is believed.
 *
 * ── WHAT THIS PROVES, AND WHAT IT HONESTLY CANNOT ───────────────────────────
 *
 * PROVEN, from bytes alone, with no indexer and no trust:
 *   · each transaction is real and buried in Bitcoin to the required depth
 *   · each transaction's runestone, decoded by the official specification
 *   · therefore each transaction's outputs, by the allocation law, given inputs
 *   · therefore the target outpoint, recursively — including burns and cenotaphs
 *
 * NOT PROVABLE LOCALLY, and refused rather than guessed:
 *   · that an open MINT was within its cap. The cap is global state: to know a
 *     mint was the k-th and k ≤ cap, you must have seen every other mint. A
 *     light verifier cannot, so an ancestry that bottoms out in a mint is
 *     returned as `needs-index` — never accepted on faith. It terminates
 *     cleanly at a PREMINE (which the etch transaction alone proves) or at an
 *     outpoint the network has ALREADY proven.
 *
 * Being unable to prove something and saying so is worth more than a number
 * that might be wrong: an L2 credited from a guess is an L2 that is insolvent
 * without knowing it.
 */
import { createHash } from 'node:crypto'
import { MIN_BLOCK_WORK, bip34Height, checkProofOfWork, parseHeader, parseTx, verifyTxOutProof, type TxInput } from '../anchor/spv.ts'
import { allocate, decipher, type RuneBalance, type RuneId } from './runestone.ts'

/** One transaction as a claimant presents it: the bytes plus Bitcoin's witness. */
export interface ProvenTx {
  rawTx: string
  /** BIP-37 merkle proof from `gettxoutproof` */
  txoutproof: string
  /** the containing block header, then each header burying it */
  headers: string[]
  /** the rune etched BY THIS transaction, if any — its id is (block height, index
   *  in block). THE CLAIM IS PROVEN, never taken: the index from this tx's own
   *  BIP-37 position, the height from the block's coinbase (BIP-34, below). */
  etchedId?: RuneId
  /** THE ETCH IDENTITY WITNESS — the block's coinbase and its merkle proof against
   *  the SAME header, so the claimed etch height is Bitcoin's own statement (BIP-34)
   *  and never a number someone reports. Required whenever `etchedId` is claimed. */
  coinbaseTx?: string
  coinbaseProof?: string
}

export interface AncestryOptions {
  /** how deep Bitcoin must have buried every transaction in the chain */
  minConfirmations: number
  /** which Bitcoin this proof claims to come from — the work floor depends on it */
  net?: string
  /** outpoints whose balances this network ALREADY proved — an ancestry only
   *  needs to reach one of these, so the first deposit pays the long walk and
   *  every later one is cheap. The network accumulates proven truth. */
  known?: Map<string, RuneBalance[]>
  /** refuse absurdly deep bundles rather than walking forever */
  maxDepth?: number
  /** THE RUNE BEING PROVEN. Setting it unlocks exactly one mathematically
   *  certain shortcut: the transaction that ETCHES a rune cannot have inputs
   *  holding that rune, because the rune did not exist yet. So an etch is a
   *  legitimate root of the ancestry FOR ITS OWN RUNE — and for that rune only.
   *  Without this focus, every unknown input is refused, as it must be. */
  rune?: RuneId
}

export type AncestryRefusal =
  | 'tx-missing' | 'tx-unproven' | 'tx-shallow' | 'txid-mismatch'
  | 'input-unknown' | 'needs-index' | 'too-deep' | 'malformed' | 'no-such-output'
  | 'etch-unproven' | 'etch-mismatch'

export interface AncestryVerdict {
  ok: boolean
  /** the target outpoint's rune balances, when proven */
  balances?: RuneBalance[]
  reason?: AncestryRefusal
  /** which outpoint could not be resolved — a refusal that names itself */
  at?: string
  /** every transaction actually verified along the way */
  verified?: number
  /** THE TARGET TX'S WHOLE OUTPUT MAP — the same walk proves every output, so a settle
   *  can memoize its consolidation change as journal truth for the next payout's walk. */
  outputs?: Map<number, RuneBalance[]>
  /** what the TARGET tx burned of the focused rune (all runes when unfocused) — a payout
   *  that burns is refused by the settle law, so the number must be visible, not implied. */
  burnedFocused?: bigint
}

export const outpointKey = (txid: string, vout: number): string => `${txid}:${vout}`

/** The canonical bytes of a bundle — so its hash names it, forever, and two
 *  nodes hash the identical proof to the identical value. */
export function bundleHash(bundle: ProvenTx[]): string {
  const canonical = JSON.stringify(bundle.map((t) => [t.rawTx, t.txoutproof, t.headers, t.etchedId ? `${t.etchedId.block}:${t.etchedId.tx}` : '']).sort())
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/**
 * PROVE ONE OUTPOINT. Walks the bundle depth-first, verifying each transaction
 * against Bitcoin and re-deriving its outputs by the allocation law.
 *
 * Fail-closed everywhere: a missing transaction, an unproven one, one buried
 * less deep than required, a txid that does not match its own bytes, an input
 * whose balance nobody has proven, or a mint that would need global state — all
 * refuse, and say which outpoint stopped them. Nothing is ever assumed to be
 * zero: silently under-crediting a deposit robs the depositor as surely as
 * over-crediting robs the network.
 */
export function proveOutpoint(txid: string, vout: number, bundle: ProvenTx[], opts: AncestryOptions): AncestryVerdict {
  const known = opts.known ?? new Map<string, RuneBalance[]>()
  const maxDepth = opts.maxDepth ?? 64
  const byTxid = new Map<string, { tx: ProvenTx; parsed: ReturnType<typeof parseTx> }>()
  let verified = 0

  // 1 · every transaction in the bundle must BE what it claims and be buried
  for (const tx of bundle) {
    let parsed: ReturnType<typeof parseTx>
    try { parsed = parseTx(tx.rawTx) } catch (_) { return { ok: false, reason: 'malformed' } }
    let proof: ReturnType<typeof verifyTxOutProof>
    try { proof = verifyTxOutProof(tx.txoutproof) } catch (_) { return { ok: false, reason: 'tx-unproven', at: parsed.txidDisplay } }
    if (!proof.provenTxids.includes(parsed.txidDisplay)) return { ok: false, reason: 'txid-mismatch', at: parsed.txidDisplay }
    if (!tx.headers.length) return { ok: false, reason: 'tx-unproven', at: parsed.txidDisplay }
    // header[0] must BE the block the merkle proof belongs to, and every header
    // after it must chain onto the one before — the depth is not a claim
    let chained = true
    try {
      const hs = tx.headers.map((h) => parseHeader(Buffer.from(h, 'hex')))
      if (hs[0].hashDisplay !== proof.header.hashDisplay) chained = false
      for (let i = 1; i < hs.length; i++) if (hs[i].prevDisplay !== hs[i - 1].hashDisplay) chained = false
      // ── AND EVERY HEADER MUST HAVE COST WHAT THIS NETWORK'S HEADERS COST ──
      // A review found this path counting headers while the seal path weighed
      // them. A chained list is free to manufacture — 5,000 of them took ten
      // milliseconds — so without this a rune deposit could be "proven" by a
      // burial nobody paid for, and the L2 would credit runes that never moved.
      // The seal path has enforced it since the fork-choice fix; the ancestry
      // path was the outlier, and an outlier in a proof is a hole.
      for (const h of tx.headers) {
        const pow = checkProofOfWork(h, opts.net ?? 'main')
        if (!pow.ok) { chained = false; break }
      }
      const floor = BigInt(tx.headers.length) * (MIN_BLOCK_WORK[opts.net ?? 'main'] ?? MIN_BLOCK_WORK.main)
      let work = 0n
      for (const h of tx.headers) work += checkProofOfWork(h, opts.net ?? 'main').work
      if (work < floor) chained = false
    } catch (_) { chained = false }
    if (!chained) return { ok: false, reason: 'tx-unproven', at: parsed.txidDisplay }
    if (tx.headers.length < opts.minConfirmations) return { ok: false, reason: 'tx-shallow', at: parsed.txidDisplay }
    // ── THE ETCH IDENTITY — an etch root is a CLAIM of (block height, index in block),
    // and a claim in a proof is a hole until it is bytes. Without this check a hostile
    // etch of a worthless rune could state the TARGET rune's id and premine the vault
    // out of thin air. Three facts, none reported: the runestone actually etches; the
    // tx's own BIP-37 position IS the claimed index; the block's coinbase (proven at
    // index 0 of the SAME header) carries the claimed height as its BIP-34 push. ──
    if (tx.etchedId) {
      const art = decipher(parsed.outputScripts.map((b) => Uint8Array.from(b)))
      if (!art || art.kind !== 'runestone' || !art.etching) return { ok: false, reason: 'etch-mismatch', at: parsed.txidDisplay }
      const pos = proof.positions[proof.provenTxids.indexOf(parsed.txidDisplay)]
      if (pos === undefined || BigInt(pos) !== tx.etchedId.tx) return { ok: false, reason: 'etch-mismatch', at: parsed.txidDisplay }
      if (!tx.coinbaseTx || !tx.coinbaseProof) return { ok: false, reason: 'etch-unproven', at: parsed.txidDisplay }
      try {
        const cb = parseTx(tx.coinbaseTx)
        const cbProof = verifyTxOutProof(tx.coinbaseProof)
        if (cbProof.header.hashDisplay !== proof.header.hashDisplay) return { ok: false, reason: 'etch-unproven', at: parsed.txidDisplay }
        const cbIdx = cbProof.provenTxids.indexOf(cb.txidDisplay)
        if (cbIdx < 0 || cbProof.positions[cbIdx] !== 0) return { ok: false, reason: 'etch-unproven', at: parsed.txidDisplay }
        const h = bip34Height(tx.coinbaseTx)
        if (h === null || BigInt(h) !== tx.etchedId.block) return { ok: false, reason: 'etch-mismatch', at: parsed.txidDisplay }
      } catch (_) { return { ok: false, reason: 'etch-unproven', at: parsed.txidDisplay } }
    }
    byTxid.set(parsed.txidDisplay, { tx, parsed })
    verified++
  }

  // 2 · resolve outpoints recursively, memoised
  const memo = new Map<string, RuneBalance[]>()
  const resolving = new Set<string>()
  let refusal: AncestryVerdict | null = null
  let targetBurned: RuneBalance[] = []

  const resolveTx = (id: string, depth: number): Map<number, RuneBalance[]> | null => {
    if (depth > maxDepth) { refusal = { ok: false, reason: 'too-deep', at: id }; return null }
    const entry = byTxid.get(id)
    if (!entry) { refusal = { ok: false, reason: 'tx-missing', at: id }; return null }
    const { tx, parsed } = entry

    // THE ETCH IS A ROOT — checked BEFORE the inputs are even looked at. A rune
    // cannot be in the inputs of the transaction that creates it, so for the
    // focused rune those inputs carry nothing, whether or not the bundle happens
    // to include them. Walking past an etch is not just wasted work: it turns a
    // provable deposit into a refusal, because the parents are older than the
    // rune and can never be decided.
    const etchesTheFocus = opts.rune !== undefined && tx.etchedId !== undefined
      && tx.etchedId.block === opts.rune.block && tx.etchedId.tx === opts.rune.tx
    // the inputs' balances: already proven by the network, or proven right here
    const inputs: RuneBalance[] = []
    for (const inp of etchesTheFocus ? [] : (parsed.inputs as TxInput[])) {
      // THE NULL PREVOUT IS A ROOT: a coinbase's input creates sats out of subsidy and can
      // carry no runes — rune balances ride real outpoints only. Provable from the bytes
      // themselves (the all-zero txid is spendable by nobody and allocated by nothing), so
      // a chain that bottoms out in coinbases terminates instead of refusing forever.
      if (/^0{64}$/.test(inp.txid)) continue
      const key = outpointKey(inp.txid, inp.vout)
      const cached = memo.get(key) ?? known.get(key)
      if (cached) { inputs.push(...cached); continue }
      if (!byTxid.has(inp.txid)) {
        // THE ETCH IS A ROOT, for its own rune only: a rune cannot be in the
        // inputs of the transaction that creates it. Any other unknown input is
        // refused — assuming zero would quietly under-credit the depositor and
        // hide a broken bundle.
        refusal = { ok: false, reason: 'input-unknown', at: key }
        return null
      }
      if (resolving.has(inp.txid)) { refusal = { ok: false, reason: 'too-deep', at: key }; return null }
      const outs = resolveTx(inp.txid, depth + 1)
      if (!outs) return null
      const bal = outs.get(inp.vout) ?? []
      memo.set(key, bal)
      inputs.push(...bal)
    }

    const artifact = decipher(parsed.outputScripts.map((b) => Uint8Array.from(b)))
    // a MINT OF THE FOCUSED RUNE needs the global mint count to be legal — a light verifier
    // cannot know it, so the ancestry stops here and says exactly why. A mint of a DIFFERENT
    // rune adds nothing of the focused one (allocation pools are per rune id, independent),
    // so the focused answer stays exact with mintAmount unknown — refusing there would make
    // every wallet that ever minted anything unable to prove an unrelated deposit.
    if (artifact !== null && artifact.mint !== undefined) {
      const mintsTheFocus = opts.rune === undefined
        || (artifact.mint.block === opts.rune.block && artifact.mint.tx === opts.rune.tx)
      if (mintsTheFocus) { refusal = { ok: false, reason: 'needs-index', at: id }; return null }
    }

    const alloc = allocate(artifact, {
      outputScripts: parsed.outputScripts.map((b) => Uint8Array.from(b)),
      inputs,
      etchedId: tx.etchedId,
    })
    if (depth === 0) targetBurned = alloc.burned
    for (const [vout, bal] of alloc.outputs) memo.set(outpointKey(id, vout), bal)
    return alloc.outputs
  }

  resolving.add(txid)
  const outs = resolveTx(txid, 0)
  if (!outs) return refusal ?? { ok: false, reason: 'malformed' }
  if (vout >= (byTxid.get(txid)?.parsed.outputScripts.length ?? 0)) return { ok: false, reason: 'no-such-output', at: outpointKey(txid, vout) }
  const burnedFocused = targetBurned
    .filter((b) => opts.rune === undefined || (b.id.block === opts.rune.block && b.id.tx === opts.rune.tx))
    .reduce((t, b) => t + b.amount, 0n)
  return { ok: true, balances: outs.get(vout) ?? [], verified, outputs: outs, burnedFocused }
}

/**
 * A DEPOSIT, PROVEN: how much of `rune` landed in `vaultScript` in transaction
 * `txid`, with the whole ancestry checked. This is the exact question the L2
 * mint must answer, and it answers it from bytes or refuses.
 */
export function proveDeposit(
  txid: string,
  vaultScriptHex: string,
  rune: RuneId,
  bundle: ProvenTx[],
  opts: AncestryOptions,
): { ok: boolean; amount?: bigint; vout?: number; reason?: AncestryRefusal; at?: string } {
  const entry = bundle.map((t) => ({ t, p: (() => { try { return parseTx(t.rawTx) } catch (_) { return null } })() })).find((x) => x.p?.txidDisplay === txid)
  // `at` names the transaction a light assembler still has to fetch, so a bundle
  // can be grown one proven tx at a time until the whole ancestry is present. It
  // is a HINT for building the proof, never part of judging it: the verdict is
  // still ok/refused on the bytes alone.
  if (!entry || !entry.p) return { ok: false, reason: 'tx-missing', at: txid }
  // WHICH output is the vault's — matched by script, never by an index the
  // claimant chooses. Sum every output that pays it, so a deposit split across
  // two vault outputs is credited once, wholly, and never twice.
  let amount = 0n
  let firstVout: number | undefined
  for (let v = 0; v < entry.p.outputScripts.length; v++) {
    if (entry.p.outputScripts[v].toString('hex') !== vaultScriptHex.toLowerCase()) continue
    const verdict = proveOutpoint(txid, v, bundle, { ...opts, rune })
    if (!verdict.ok) return { ok: false, reason: verdict.reason, at: verdict.at }
    for (const b of verdict.balances ?? []) {
      if (b.id.block === rune.block && b.id.tx === rune.tx) amount += b.amount
    }
    if (firstVout === undefined) firstVout = v
  }
  if (firstVout === undefined) return { ok: false, reason: 'no-such-output', at: txid }
  return { ok: true, amount, vout: firstVout }
}
