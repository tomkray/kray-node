/**
 * THE RUNE BRIDGE VERIFIER — fail-closed, ord-normative.
 *
 * A rune movement between L1 and L2 is a RUNESTONE the indexer interprets, not a plain payment — and
 * a malformed one (a CENOTAPH) BURNS the input runes. So a deposit (user → vault) or a payout
 * (vault → owner) is trusted ONLY when every one of these holds, and refused by default otherwise:
 *
 *   1. it is NOT a cenotaph (the canonical decoder, matched to `ord`, says so);
 *   2. its allocation BURNS nothing;
 *   3. the target output — the vault on the way in, the owner on the way out — receives EXACTLY the
 *      runes it must (an edict, or the default allocation, that lands them anywhere else is refused);
 *   4. that output carries at least the DUST, or it would not relay and the runes would be stranded.
 *
 * Reuses the canonical Runes decoder (runestone.ts) and the live dust knob (dust.ts). No new parsing,
 * no guessing — the same bytes `ord` reads, and the refusal a bridge needs so no rune is ever burned.
 */
import { parseTx, proveTxBuried } from '../anchor/spv.ts'
import { decipher, allocate, type RuneBalance, type RuneId } from './runestone.ts'
import { deriveVault } from './vault.ts'
import { addressOf, scriptOfAddress, toBtcNet } from './scheme.ts'
import { creditOfPotDeposit } from './pot-deposit.ts'
import { proveDeposit, proveOutpoint, type ProvenTx } from './rune-ancestry.ts'

export interface RuneMovementCheck {
  rawTx: string                                   // the deposit/payout transaction, exact bytes, hex
  runeId: RuneId                                  // the rune that must move
  amount: bigint                                  // how much must reach the target
  targetScriptHex: string                         // the vault (deposit) or owner (payout) output script
  inputRunes: Array<{ id: RuneId; amount: bigint }> // the runes the tx's inputs carry (from ord)
  dust: bigint                                    // the target output must be ≥ this to relay (resolveDust)
}
export interface RuneMovementVerdict { ok: boolean; reason?: string; outputIndex?: number; sats?: bigint }

const sameId = (a: RuneId, b: RuneId): boolean => a.block === b.block && a.tx === b.tx

export function verifyRuneMovement(c: RuneMovementCheck): RuneMovementVerdict {
  try {
    if (c.amount <= 0n) return { ok: false, reason: 'a rune movement must be positive' }
    const parsed = parseTx(c.rawTx)
    const scripts = parsed.outputScripts.map((b) => Uint8Array.from(b))

    // 1 · decode the runestone as ord does — a CENOTAPH burns, so refuse it outright
    const artifact = decipher(scripts)
    if (artifact && artifact.kind === 'cenotaph') {
      return { ok: false, reason: `the runestone is a CENOTAPH (${artifact.flaws.join(', ')}) — it would BURN the input runes` }
    }

    // 2 · allocate exactly as ord would; ANY burn is fail-closed (a bad edict, a pointer past the end)
    const alloc = allocate(artifact, { outputScripts: scripts, inputs: c.inputRunes })
    if (alloc.burned.some((b) => b.amount > 0n)) {
      const burnedTarget = alloc.burned.filter((b) => sameId(b.id, c.runeId)).reduce((t, b) => t + b.amount, 0n)
      const burnedAll = alloc.burned.reduce((t, b) => t + b.amount, 0n)
      return { ok: false, reason: `the allocation BURNS runes (${burnedTarget} of the target rune, ${burnedAll} in all) — refused` }
    }

    // 3 · the target output must receive EXACTLY `amount` of the rune
    const want = c.targetScriptHex.toLowerCase()
    let idx = -1
    for (let i = 0; i < scripts.length; i++) { if (Buffer.from(scripts[i]).toString('hex') === want) { idx = i; break } }
    if (idx < 0) return { ok: false, reason: 'no output matches the target script (the vault on deposit, the owner on payout)' }
    const got = (alloc.outputs.get(idx) ?? []).filter((b) => sameId(b.id, c.runeId)).reduce((t, b) => t + b.amount, 0n)
    if (got !== c.amount) return { ok: false, reason: `the target output received ${got} of the rune, not the ${c.amount} it must` }

    // 4 · the rune output must clear the dust, or it will not relay and the runes are stranded
    const sats = parsed.outputValues[idx]
    if (sats < c.dust) return { ok: false, reason: `the rune output pays ${sats} sats, below the ${c.dust}-sat dust — it would not relay` }

    return { ok: true, outputIndex: idx, sats }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * ── ADR-1 EXTENDED TO RUNES — the consensus proofs a rune-deposit / rune-settle event may carry ──
 *
 * Same law as the donation burn-proof: the proof rides IN the journaled event (so the anchored
 * cascade root commits the CAUSE), and these verifiers are PURE and OFFLINE (so a cold replay
 * re-proves the peg from bytes, never from the operator's word).
 *
 * What is re-proven from bytes alone: the burial (PoW-weighed headers, min confirmations), the
 * exact outpoint/txid, the runestone allocation (cenotaph = refuse, burn = refuse, the target
 * receives EXACTLY the claimed amount), and the binding of the credit to the vault's OWN depositor
 * key (re-derived from the journaled vault params — a credit to anyone else refuses).
 *
 * THE KEYSTONE (2026-08-28): a deposit proof may carry `ancestry` — the recursive bundle of
 * SPV-proven parent transactions (rune-ancestry.ts) that re-derives the input state FROM BYTES,
 * terminating at the rune's own etch (a premine is proven by the etch alone) or at an outpoint
 * this journal already proved. When the bundle is present, `inputRunes` stops being ord's word:
 * the verifier recomputes the deposited amount itself and refuses any disagreement. Signet and
 * mainnet are BORN STRICT (the reducer requires the bundle from seq 0 — RUNE_ANCESTRY_MANDATORY);
 * `inputRunes` remains as the attestation era's shape for regtest benches and the settle path.
 */
export interface RuneConsensusProof {
  rawTx: string
  txoutproof: string
  headers: string[]
  vault?: { guardians: string[]; threshold: number; depositor: string; timelock: number }
  inputRunes?: Array<{ id: string; amount: string }>
  /** pot deposit: parent txs of the deposit vins (hash-bound). Absent on a personal-vault proof. */
  parentTxs?: string[]
  /** pot deposit: credit binds to the unique Taproot spender, not the vault depositor. */
  pool?: boolean
  /** THE KEYSTONE: the SPV-proven ancestry bundle (deposit tx included) that re-derives the
   *  input rune state from bytes — no indexer's word. Mandatory from seq 0 on signet/main.
   *  `etchedId` rides as the canonical "block:tx" string (the journal is JSON — no bigint);
   *  an etch entry must also carry the block's coinbase + proof (the BIP-34 identity witness).
   *  THE MINT-WITNESS LAW (2026-08-31): a mint entry may carry `mintWitness` (coinbase + proof,
   *  the same BIP-34 mechanism) — the writer's journaled statement that the mint was within
   *  cap; honoured only at/after the reducer's activation pin. */
  ancestry?: Array<{ rawTx: string; txoutproof: string; headers: string[]; etchedId?: string; coinbaseTx?: string; coinbaseProof?: string; mintWitness?: { coinbaseTx: string; coinbaseProof: string } }>
}

/** The journaled (JSON-safe) bundle → the walker's shape. A malformed etchedId throws → refuse. */
const parseAncestry = (list: NonNullable<RuneConsensusProof['ancestry']>): ProvenTx[] =>
  list.map((t) => ({
    rawTx: t.rawTx, txoutproof: t.txoutproof, headers: t.headers,
    ...(t.etchedId ? { etchedId: parseRuneIdStr(t.etchedId) } : {}),
    ...(t.coinbaseTx ? { coinbaseTx: t.coinbaseTx } : {}),
    ...(t.coinbaseProof ? { coinbaseProof: t.coinbaseProof } : {}),
    ...(t.mintWitness ? { mintWitness: t.mintWitness } : {}),
  }))

const parseRuneIdStr = (s: string): RuneId => { const [b, t] = String(s).split(':'); return { block: BigInt(b), tx: BigInt(t) } }
const parseInputRunes = (list: Array<{ id: string; amount: string }>): Array<{ id: RuneId; amount: bigint }> =>
  list.map((r) => ({ id: parseRuneIdStr(r.id), amount: BigInt(r.amount) }))

/** Re-prove a rune-deposit event's claims from its own journaled proof. Fail-closed: a proof that
 *  is present but does not verify refuses the event — on live apply AND on every cold replay.
 *  `known` is the journal's own accumulated truth: outpoints whose balances of THIS rune earlier
 *  proven deposits already re-derived (scoped per rune — the etch-root shortcut is only exact for
 *  the focused rune, so one rune's memo must never answer for another). */
export function verifyRuneDepositProof(
  proof: RuneConsensusProof,
  expect: { runeId: RuneId; outpoint: string; to: string; amount: bigint; net: string; minConfirmations: number; minWork?: bigint; pool?: boolean; allowMintWitness?: boolean },
  known?: Map<string, RuneBalance[]>,
): { ok: boolean; reason?: string; provenVaultBalance?: bigint } {
  try {
    if (!proof.vault) return { ok: false, reason: 'a rune-deposit consensus proof must carry the vault params the credit binds to' }
    if (!proof.inputRunes && !proof.ancestry) return { ok: false, reason: 'a rune-deposit consensus proof must carry the input rune amounts (attestation) or the ancestry bundle (byte-pure)' }
    const buried = proveTxBuried(proof.rawTx, proof.txoutproof, proof.headers, { net: expect.net, minConfirmations: expect.minConfirmations, minWork: expect.minWork })
    if (!buried.ok) return { ok: false, reason: buried.reason }
    // the vault is RE-DERIVED from the journaled params — an address nobody can re-derive is refused
    const vault = deriveVault({ ...proof.vault, net: toBtcNet(expect.net) })
    // PERSONAL vault: credit binds to the vault's OWN depositor key.
    // POT (`pool: true`): the vault's depositor is the network pool key — crediting that
    // key would mint to the network. The credit binds to the unique Taproot spender,
    // re-derived from the journaled parent txs (each parent hashes to a deposit vin).
    const pot = expect.pool === true || proof.pool === true
    if (pot) {
      if (!proof.parentTxs || proof.parentTxs.length === 0) {
        return { ok: false, reason: 'a pot-deposit proof must carry the parent txs that name the spender' }
      }
      const who = creditOfPotDeposit(proof.rawTx, proof.parentTxs, expect.net)
      if (!who.ok) return { ok: false, reason: who.reason }
      if (who.address !== expect.to) {
        return { ok: false, reason: `the pot payment's unique spender is ${who.address}, not the credited ${expect.to} — refused` }
      }
    } else {
      const owner = addressOf(proof.vault.depositor, toBtcNet(expect.net))
      if (owner !== expect.to) return { ok: false, reason: `the proof's vault binds depositor ${owner}, not the credited ${expect.to} — refused` }
    }
    const vaultScriptHex = scriptOfAddress(vault.address, toBtcNet(expect.net))
    // the runestone allocation, re-derived by the same decoder ord uses (dust is door relay policy;
    // consensus proves structure + allocation — the output's existence and exact rune amount)
    let outputIndex: number | undefined
    if (proof.inputRunes) {
      const move = verifyRuneMovement({
        rawTx: proof.rawTx, runeId: expect.runeId, amount: expect.amount,
        targetScriptHex: vaultScriptHex,
        inputRunes: parseInputRunes(proof.inputRunes), dust: 1n,
      })
      if (!move.ok) return { ok: false, reason: move.reason }
      outputIndex = move.outputIndex
    }
    // THE KEYSTONE — the input state re-derived from bytes, no indexer's word. The bundle must
    // contain the deposit tx and every parent back to the rune's etch or a journal-proven outpoint;
    // the walk re-proves each link's burial and re-runs the allocation law, then must land EXACTLY
    // the credited amount on the vault script. Present-but-false refuses (→ HALT in the reducer).
    let provenVaultBalance: bigint | undefined
    if (proof.ancestry) {
      const walk = proveDeposit(buried.txid, vaultScriptHex, expect.runeId, parseAncestry(proof.ancestry), {
        minConfirmations: expect.minConfirmations, net: expect.net, known, rune: expect.runeId,
        allowMintWitness: expect.allowMintWitness === true,
        // a bundle of N txs can never need a walk deeper than N — self-scaling, still bounded
        // by the door's assembly cap; the walker's own cycle guard stays in force
        maxDepth: proof.ancestry.length,
      })
      if (!walk.ok) return { ok: false, reason: `the ancestry bundle does not prove the deposit — ${walk.reason}${walk.at ? ' at ' + walk.at : ''}` }
      if (walk.amount !== expect.amount) return { ok: false, reason: `the ancestry proves ${walk.amount} of the rune landed in the vault, not the credited ${expect.amount} — refused` }
      if (outputIndex !== undefined && walk.vout !== outputIndex) return { ok: false, reason: 'the attestation and the ancestry disagree on the vault output — refused' }
      outputIndex = walk.vout
      provenVaultBalance = walk.amount
    }
    const outpoint = `${buried.txid}:${outputIndex}`
    if (outpoint !== expect.outpoint) return { ok: false, reason: `the proof buries outpoint ${outpoint}, not the claimed ${expect.outpoint} — refused` }
    return { ok: true, provenVaultBalance }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** Re-prove a rune-settle event's claims: the journaled payout is buried, IS the claimed l1Txid,
 *  and delivers EXACTLY the locked amount to the exit's SIGNED L1 destination.
 *
 *  THE KEYSTONE, SETTLE LEG (2026-08-29 — same ratification window, both books still empty):
 *  when the proof carries `ancestry`, the payout's INPUT STATE is re-derived from bytes by the
 *  same walker the deposit law uses — every input is a journal-proven outpoint (`known`: the
 *  deposits and earlier settles this journal already re-derived) or is proven inside the bundle.
 *  The walk re-runs the allocation law, must land EXACTLY the locked amount on the signed
 *  destination, and refuses a payout that BURNS any of the focused rune. `provenOutputs` hands
 *  the reducer the payout's whole focused output map, so the consolidation change becomes the
 *  accumulated truth the NEXT settle's walk stops at. `inputRunes` (the attestation era) remains
 *  for the regtest bench; when both ride, both must pass — a disagreement refuses. */
export function verifyRuneSettleProof(
  proof: RuneConsensusProof,
  expect: {
    runeId: RuneId; l1Txid: string; l1Address: string; amount: bigint; net: string
    minConfirmations: number; minWork?: bigint
    /** the loaf's delivery output (from the event's `outpoint`) — absent on a solo settle */
    deliveryVout?: number
    /** THE MINT-WITNESS LAW gate — the reducer's activation pin, mirrored on the payout leg */
    allowMintWitness?: boolean
  },
  known?: Map<string, RuneBalance[]>,
): { ok: boolean; reason?: string; provenOutputs?: Array<{ vout: number; amount: bigint }> } {
  try {
    if (!proof.inputRunes && !proof.ancestry) return { ok: false, reason: 'a rune-settle consensus proof must carry the input rune amounts (attestation) or the ancestry bundle (byte-pure)' }
    const buried = proveTxBuried(proof.rawTx, proof.txoutproof, proof.headers, { net: expect.net, minConfirmations: expect.minConfirmations, minWork: expect.minWork })
    if (!buried.ok) return { ok: false, reason: buried.reason }
    if (buried.txid !== expect.l1Txid.toLowerCase()) return { ok: false, reason: `the proof buries ${buried.txid}, not the claimed payout ${expect.l1Txid} — refused` }
    const destScriptHex = scriptOfAddress(expect.l1Address, toBtcNet(expect.net)).toLowerCase()
    if (proof.inputRunes) {
      const move = verifyRuneMovement({
        rawTx: proof.rawTx, runeId: expect.runeId, amount: expect.amount,
        targetScriptHex: destScriptHex,
        inputRunes: parseInputRunes(proof.inputRunes), dust: 1n,
      })
      if (!move.ok) return { ok: false, reason: move.reason }
    }
    let provenOutputs: Array<{ vout: number; amount: bigint }> | undefined
    if (proof.ancestry) {
      const bundle = parseAncestry(proof.ancestry)
      const parsed = parseTx(proof.rawTx)
      const scripts = parsed.outputScripts.map((b) => Buffer.from(b).toString('hex').toLowerCase())
      // WHICH output the burn keys on — the loaf's journaled delivery outpoint, or (solo,
      // historic law) the first output paying the signed destination. Matched by SCRIPT,
      // never by an index the claimant chooses freely: a claimed vout must BE the destination.
      let vout = expect.deliveryVout
      if (vout === undefined) vout = scripts.findIndex((s) => s === destScriptHex)
      if (vout < 0 || vout >= scripts.length) return { ok: false, reason: 'no output pays the SIGNED destination — refused' }
      if (scripts[vout] !== destScriptHex) return { ok: false, reason: `delivery output ${vout} does not pay the SIGNED destination — refused` }
      const walk = proveOutpoint(buried.txid, vout, bundle, {
        minConfirmations: expect.minConfirmations, net: expect.net, known, rune: expect.runeId,
        allowMintWitness: expect.allowMintWitness === true,
        maxDepth: bundle.length,
      })
      if (!walk.ok) return { ok: false, reason: `the ancestry bundle does not prove the payout — ${walk.reason}${walk.at ? ' at ' + walk.at : ''}` }
      const got = (walk.balances ?? []).filter((b) => sameId(b.id, expect.runeId)).reduce((t, b) => t + b.amount, 0n)
      if (got !== expect.amount) return { ok: false, reason: `the ancestry proves ${got} of the rune reached the signed destination, not the ${expect.amount} locked — refused` }
      if ((walk.burnedFocused ?? 0n) > 0n) return { ok: false, reason: `the payout BURNS ${walk.burnedFocused} of the rune — a settlement never burns, refused` }
      provenOutputs = []
      for (const [v, bals] of walk.outputs ?? []) {
        const amt = bals.filter((b) => sameId(b.id, expect.runeId)).reduce((t, b) => t + b.amount, 0n)
        if (amt > 0n) provenOutputs.push({ vout: v, amount: amt })
      }
    }
    return { ok: true, provenOutputs }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
