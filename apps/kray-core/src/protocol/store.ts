/**
 * The Ledger Store — durability for the pure KrayLedger reducer.
 *
 * KrayLedger (ledger.ts) is a pure in-memory reducer: applyLive(event) and nothing else.
 * This shell gives it a life on disk, using the shared hash-chain (kray-primitives) so there
 * is one journal format and no drift:
 *
 *   · APPEND   — build the next event {seq, prevHash, hash}, where
 *                  hash = sha256(prevHash + canonical(body))
 *                apply it to the reducer FIRST (a throw leaves the disk untouched — the
 *                journal only ever records transitions the reducer accepted), then fsync
 *                one JSONL line. The event's own hash is its identity — a born star is
 *                `${hash}i0` (starmap), so the chain hash and the star id are the same fact.
 *   · REPLAY   — on boot, re-read the journal, RE-VERIFY the whole hash-chain (prevHash, the
 *                recomputed hash, and the strictly-incrementing seq) or HALT; a torn final
 *                line from a crash mid-append (never fsync'd, never answered) is truncated,
 *                but an unparseable NON-final line is corruption and refuses to run.
 *
 * The result: the state is a pure, signature-bound, tamper-evident function of a journal
 * that survives reboots byte-exact.
 */
import { openSync, appendFileSync, fsyncSync, closeSync, existsSync, readFileSync, truncateSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { KrayLedger } from './ledger.ts'
import { DEFAULT_POT_TARGET_SATS } from './pot.ts'
import { GENESIS_HASH, sha256hex, canonical, type KrayEvent } from './kray-primitives.ts'

/**
 * THE ONE DOOR for opening a ledger that must replay a journal (the live store AND any
 * private read-path twin — star history, call receipts). Lab pins are regtest-only env
 * (dead code on signet/main). A twin that skips this and uses `new KrayLedger(net)` will
 * HALT on a living lab journal the moment a law was pinned above default (A3).
 *
 * ONE named exception (twin rebirth, 2026-08-28): KRAY_LAB_PROOF_MANDATORY_SEQ may lift the
 * born-strict proof-mandatory law on a DISPOSABLE bench — regtest always, signet only under
 * KRAY_TRUSTED_DEV=1 (the signet-actions exam spawns such a bench to storm the tb1 action
 * surface without a real SPV burn). On main the env is DEAD — nothing lifts the law there.
 * A writer that lifted it would only fork itself out: every strict verifier refuses a
 * proofless mint on replay, so the lie is caught loudly, never inherited.
 */
export function labActivationPins(network: string) {
  const n = (k: string) => (process.env[k] ? Number(process.env[k]) : undefined)
  const proof = network === 'regtest' || (network === 'signet' && process.env.KRAY_TRUSTED_DEV === '1')
    ? n('KRAY_LAB_PROOF_MANDATORY_SEQ')
    : undefined   // main: the env is dead code — born strict is not liftable
  if (network !== 'regtest') return { x: undefined, burn: undefined, same: undefined, fire: undefined, tk: undefined, relic: undefined, mintw: undefined, proof }
  return {
    x: n('KRAY_LAB_X_SEQ'),
    burn: n('KRAY_LAB_BURN_LAW_SEQ'),
    same: n('KRAY_LAB_SAME_INSTANT_SEQ'),
    fire: n('KRAY_LAB_FIREBORN_SEQ'),
    tk: n('KRAY_LAB_TK_FOLD_SEQ'),
    relic: n('KRAY_LAB_UNIQUE_RELIC_SEQ'),
    mintw: n('KRAY_LAB_MINT_WITNESS_SEQ'),
    proof,
  }
}

export function openKrayLedger(
  network: string,
  potTarget: bigint = DEFAULT_POT_TARGET_SATS,
  potScriptHex?: string,
  backingGate = false,
  atlasBytes?: (hash: string) => Uint8Array | null,
  potInternalKeyHex?: string,
) {
  const p = labActivationPins(network)
  return new KrayLedger(potTarget, network, potScriptHex, backingGate, atlasBytes, undefined, p.x, p.burn, undefined, undefined, p.same, p.fire, p.tk, undefined, potInternalKeyHex, p.proof, undefined, p.relic, p.mintw)
}

export class LedgerStore {
  readonly ledger: KrayLedger
  readonly journalPath: string
  private seqNo = 0
  private lastHash: string = GENESIS_HASH
  /** set if a durable write ever fails AFTER the reducer advanced in memory — the store is then ahead
   *  of disk and MUST NOT accept more appends (they would reuse a seq and journal an unapplied event).
   *  A restart replays the durable journal (which lacks the failed event) and is consistent again. */
  private poisoned = false
  /** live derived layers (e.g. an explorer index) may follow every appended event */
  onEvent?: (e: KrayEvent) => void

  constructor(dataDir: string, network = 'regtest', potTarget: bigint = DEFAULT_POT_TARGET_SATS, potScriptHex?: string, backingGate = false, potInternalKeyHex?: string) {
    // Windowed custody verify reads DATA_DIR/content — same atlas the door audited.
    // A follower that did not pull those bytes fail-closes on new (presenceTip) settlements.
    const atlasBytes = (hash: string): Uint8Array | null => {
      try {
        const p = join(dataDir, 'content', hash)
        return existsSync(p) ? new Uint8Array(readFileSync(p)) : null
      } catch {
        return null
      }
    }
    // THE LAB DOOR (regtest ONLY — the KRAY_TRUSTED_DEV doctrine): a disposable bench may pin the
    // same-instant law low to storm it LIVE over HTTP (tier 1 of the Creator's chronology). On
    // signet/main this env is dead code — the per-network constant in ledger.ts is the only truth.
    this.ledger = openKrayLedger(network, potTarget, potScriptHex, backingGate, atlasBytes, potInternalKeyHex)
    mkdirSync(dataDir, { recursive: true })
    this.journalPath = join(dataDir, `kraynet-journal-${network}.jsonl`)
    this.replay()
  }

  get seq(): number { return this.seqNo }
  get head(): string { return this.lastHash }

  /** Append one event: hash-chain it, apply it (throws BEFORE any write if the transition is
   *  invalid — the Supreme Law and every economic law gate here), then fsync the JSONL line. */
  append(partial: Omit<KrayEvent, 'seq' | 'prevHash' | 'hash'>): KrayEvent {
    if (this.poisoned) throw new Error('kraynet-store: HALTED after a durable-write failure — restart to replay the journal and recover')
    const body = { ...partial, seq: this.seqNo + 1, prevHash: this.lastHash }
    const hash = sha256hex(this.lastHash + canonical(body))
    const e: KrayEvent = { ...body, hash }
    try {
      this.ledger.applyLive(e)                     // live: origins without SPV refuse — nothing persisted
    } catch (err) {
      // A1: if the tripwire fired after mutation, RAM is dirty and lastAppliedSeq advanced.
      // Poison so the next append cannot reuse this seq or apply on a lying book. Restart
      // replays the durable journal (this line was never written).
      if (this.ledger.haltedReason()) this.poisoned = true
      throw err
    }
    try {
      const fd = openSync(this.journalPath, 'a')
      try { appendFileSync(fd, JSON.stringify(e) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
    } catch (werr) {
      // The reducer already advanced in memory (ledger.lastAppliedSeq = e.seq) but these bytes are NOT
      // durable. We must not continue: the next append would reuse this seq and journal an event the
      // reducer's `seq <= lastAppliedSeq` guard silently skips applying — a permanent live-vs-replay
      // fork. Fail-stop: poison the store and re-throw. A restart replays the durable journal (which
      // never got this line) and the phantom in-memory mutation vanishes, restoring consistency.
      this.poisoned = true
      throw new Error(`kraynet-store: DURABLE WRITE FAILED at seq ${e.seq} (${(werr as Error)?.message ?? werr}) — node HALTED to protect the chain; restart to recover from the journal`)
    }
    this.seqNo = e.seq
    this.lastHash = e.hash
    this.onEvent?.(e)
    return e
  }

  /** Rebuild the reducer from the journal on disk, re-verifying the whole chain or HALT. */
  private replay(): void {
    if (!existsSync(this.journalPath)) return
    let raw = readFileSync(this.journalPath, 'utf8')
    // DURABILITY INVARIANT: a committed event's line is NEWLINE-TERMINATED. A tail without a trailing
    // newline is a torn/unacknowledged write (the fsync never completed to the last byte) — even when it
    // happens to be complete, chain-valid JSON. Truncate it here, so "torn tail" is ONE consistent rule
    // (\n-terminated == real) and a later append can never glue `{a}{b}\n` onto one physical line. Without
    // this, a parseable-but-unterminated tail was accepted and served, then the next append glued a second
    // event onto it — and the following restart silently LOST both (or HALTed the boot). Proven closed in
    // partial-apply-attack.test.ts.
    if (raw.length > 0 && !raw.endsWith('\n')) {
      const cut = raw.lastIndexOf('\n') + 1                 // 0 if the whole file is one unterminated line
      truncateSync(this.journalPath, Buffer.byteLength(raw.slice(0, cut), 'utf8'))
      console.warn('kraynet-store: torn tail after crash — truncated 1 unacknowledged line with no terminator')
      raw = raw.slice(0, cut)
    }
    const rawLines = raw.split('\n')
    let offset = 0
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i]
      const lineStart = offset
      offset += Buffer.byteLength(line, 'utf8') + 1 // +1 for the newline
      if (!line.trim()) continue
      let e: KrayEvent
      try {
        e = JSON.parse(line) as KrayEvent
      } catch {
        // a torn FINAL line is a crash artifact from mid-append (never fsync'd, never
        // answered) — truncate it and carry on. An unparseable NON-final line = corruption.
        if (rawLines.slice(i + 1).some((l) => l.trim())) {
          throw new Error(`kraynet-store: JOURNAL CHAIN BROKEN at line ${i + 1} — unparseable non-final line`)
        }
        truncateSync(this.journalPath, lineStart)
        console.warn('kraynet-store: torn tail after crash — truncated 1 unacknowledged partial line')
        break
      }
      const { hash, ...rest } = e
      const expect = sha256hex(this.lastHash + canonical({ ...rest }))
      if (e.prevHash !== this.lastHash || hash !== expect || e.seq !== this.seqNo + 1) {
        throw new Error(`kraynet-store: JOURNAL CHAIN BROKEN at seq ${e.seq} — refusing to run on corrupted accounting`)
      }
      this.ledger.applyLive(e)
      this.seqNo = e.seq
      this.lastHash = e.hash
    }
  }
}
