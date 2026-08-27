/**
 * THE PAID BINDING — how a TK-fold (and every other journal act) already lives
 * inside a Bitcoin txid that has already been paid.
 *
 * A Bitcoin txid is SHA256d(raw tx). It is a NAME, not a container:
 *
 *   journal act (1 ₭, A2)
 *     → subsystem root   (laneRoot / xRoot / fireRoot / …)
 *     → cascadeRoot      = cascadeRootFromParts(parts)   // sequential SHA-256
 *     → OP_RETURN 49 B   = KRAY.NETWORK | ver | height | cascadeRoot
 *     → Bitcoin txid     = SHA256d(tx containing that OP_RETURN)
 *
 * Fano: a 32-byte digest binds 32 bytes of commitment. It cannot contain a
 * Groth16 body. Huffman: a second 32-byte foldRoot beside cascadeRoot is a
 * duplicate commitment (two roots can disagree). Newton: the chain is the
 * same at every zoom — fold-seal is not a special L1 encoding.
 *
 * The 1 ₭ on fold-seal pays the journal body. The Bitcoin anchor pays the
 * 49-byte name. No third book. Council: docs/X-FEELESS-DECISION.md round 10.
 */
import { ANCHOR_HEIGHT_BITS, ANCHOR_HEIGHT_MAX, ANCHOR_VERSION, KrayAnchor, type AnchorCommitment } from './anchor.ts'
import { cascadeRootFromParts, type CascadeParts } from '../protocol/cascade-root.ts'

export const ANCHOR_PAYLOAD_BYTES = 49
export const ANCHOR_DIGEST_BYTES = 32
export { ANCHOR_HEIGHT_BITS, ANCHOR_HEIGHT_MAX, ANCHOR_VERSION }

/** Years of continuous sealing at `sealMs` until the v1 height field saturates. Named grain, round 11. */
export function heightYearsAtCadence(sealMs: number): number {
  if (!(sealMs > 0) || !Number.isFinite(sealMs)) throw new Error('paid-binding: sealMs must be a positive finite number')
  return (ANCHOR_HEIGHT_MAX * sealMs) / (365.25 * 24 * 60 * 60 * 1000)
}

/** THE HEIGHT CEILING — the one atemporal limit the gauntlet named. Fail-closed; v2 widening is A3, not now. */
export type HeightCeiling = {
  field: 'blockNumber'
  bits: typeof ANCHOR_HEIGHT_BITS
  max: typeof ANCHOR_HEIGHT_MAX
  version: typeof ANCHOR_VERSION
  failClosed: true
}

export const HEIGHT_CEILING: HeightCeiling = {
  field: 'blockNumber',
  bits: ANCHOR_HEIGHT_BITS,
  max: ANCHOR_HEIGHT_MAX,
  version: ANCHOR_VERSION,
  failClosed: true,
}

/**
 * The one sentence a receipt hands a stranger. Derived from HEIGHT_CEILING so
 * bits/version cannot drift from the codec. Fano + the asterisk, one law.
 */
export const PAID_BINDING_VERIFY =
  `Re-hash the event → walk it to the block merkle root → fold that into the cascade root → find that root in the Bitcoin OP_RETURN. All offline, no node trusted. THE PAID BINDING: the Bitcoin txid names that cascade; it does not hold the proof body. THE HEIGHT CEILING: v${HEIGHT_CEILING.version} height is uint${HEIGHT_CEILING.bits}, fail-closed. The version byte is the designed-in widening — not a v2 today.`

/** The archetypal chain — one small rule, iterated. Mandelbrot: every zoom obeys this. */
export const PAID_BINDING_CHAIN = [
  'journal-act',
  'subsystem-root',
  'cascade-root',
  'op-return-49',
  'bitcoin-txid',
] as const

export type PaidBinding = {
  cascadeRoot: string
  payloadHex: string
  commitment: AnchorCommitment
}

/** Bind cascade parts into the 49-byte OP_RETURN that a Bitcoin txid will name. */
export function paidBinding(parts: CascadeParts, blockNumber: number): PaidBinding {
  const cascadeRoot = cascadeRootFromParts(parts)
  const payloadHex = KrayAnchor.payload(blockNumber, cascadeRoot)
  const commitment = KrayAnchor.decode(payloadHex)
  if (!commitment) throw new Error('paid-binding: the 49-byte payload must decode')
  return { cascadeRoot, payloadHex, commitment }
}

/**
 * Fano's inequality as a door: a digest of `digestBytes` cannot contain a body
 * of `bodyBytes` when the body is larger. The txid BINDS the body via the chain
 * above; it does not HOLD it.
 */
export function digestContainsBody(digestBytes: number, bodyBytes: number): boolean {
  return bodyBytes > 0 && bodyBytes <= digestBytes
}

/**
 * The walkable certificate — what a stranger is handed. TWO EPOCHS, NEVER MIXED:
 *
 * - `sealed` — the covering Bitcoin name. A seal at block ≥ the act's block; the cascade is
 *   CUMULATIVE, so that root already includes this act. Its subsystem openings are the
 *   journal replayed to THAT height — not repeated here (replay is the opening).
 * - `tip` — the LIVE opening a stranger re-derives right now: today's cascade root and the
 *   subsystem roots (`lane:`/`x:`/`fire:`) that fold into IT. These are generally NOT the
 *   roots inside `sealed.cascadeRoot` — the lane breathes on after a seal. A certificate
 *   that blended the two would invite a false re-hash; the split is the honesty.
 *   `tip.named` is always false: the tip payload is a preview (same convention as
 *   `/anchor/payload`), never a covering Bitcoin name. The covering name lives on `sealed`.
 */
export type PaidBindingView = {
  chain: typeof PAID_BINDING_CHAIN
  act: { seq: number; kind: string | null; hash: string | null }
  sealed: {
    cascadeRoot: string
    blockNumber: number
    payload: string
    bitcoinTxid: string | null
    named: boolean
  } | null
  tip: {
    seq: number
    cascadeRoot: string
    payload: string
    laneRoot: string | null
    xRoot: string | null
    fireRoot: string | null
    named: false
  }
  bytes: typeof ANCHOR_PAYLOAD_BYTES
  bodyInTxid: false
  ceiling: HeightCeiling
  verify: typeof PAID_BINDING_VERIFY
}

export function paidBindingView(args: {
  seq: number
  kind?: string | null
  hash?: string | null
  sealed?: { cascadeRoot: string; blockNumber: number; bitcoinTxid?: string | null; named?: boolean } | null
  tip: { seq: number; cascadeRoot: string; laneRoot?: string | null; xRoot?: string | null; fireRoot?: string | null }
}): PaidBindingView {
  const s = args.sealed
  return {
    chain: PAID_BINDING_CHAIN,
    act: { seq: args.seq, kind: args.kind ?? null, hash: args.hash ?? null },
    sealed: s ? {
      cascadeRoot: s.cascadeRoot.toLowerCase(),
      blockNumber: s.blockNumber,
      payload: KrayAnchor.payload(s.blockNumber, s.cascadeRoot),
      bitcoinTxid: s.bitcoinTxid ?? null,
      named: !!s.named && !!s.bitcoinTxid,
    } : null,
    tip: {
      seq: args.tip.seq,
      cascadeRoot: args.tip.cascadeRoot.toLowerCase(),
      payload: KrayAnchor.payload(args.tip.seq, args.tip.cascadeRoot),
      laneRoot: args.tip.laneRoot ?? null,
      xRoot: args.tip.xRoot ?? null,
      fireRoot: args.tip.fireRoot ?? null,
      named: false,
    },
    bytes: ANCHOR_PAYLOAD_BYTES,
    bodyInTxid: false,
    ceiling: HEIGHT_CEILING,
    verify: PAID_BINDING_VERIFY,
  }
}

/** Codec refusal — a named object, never a missing event. The act still stands. */
export type RefusedBinding = {
  refused: true
  reason: string
  bodyInTxid: false
  ceiling: HeightCeiling
  verify: typeof PAID_BINDING_VERIFY
  tip: { named: false }
}

export function isRefusedBinding(v: PaidBindingView | RefusedBinding | null | undefined): v is RefusedBinding {
  return !!v && (v as RefusedBinding).refused === true
}

/**
 * THE CERTIFICATE DOOR — three HTTP statuses, never mixed.
 * Missing event → 404. Codec refusal → 400 (the certificate door stays fail-closed).
 * A live certificate → 200. /tx and /receipt do not use this: the act still stands.
 */
export type CertificateDoor =
  | { status: 200; body: PaidBindingView }
  | { status: 404; error: string }
  | { status: 400; error: string }

export function certificateDoor(
  view: PaidBindingView | RefusedBinding | null,
  missing = 'no such event',
): CertificateDoor {
  if (view == null) return { status: 404, error: missing }
  if (isRefusedBinding(view)) return { status: 400, error: view.reason }
  return { status: 200, body: view }
}

/** The one mouth: a walkable certificate, or a refused certificate. Never a throw at the door. */
export function certificateOrRefuse(args: Parameters<typeof paidBindingView>[0]): PaidBindingView | RefusedBinding {
  try {
    return paidBindingView(args)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      refused: true,
      reason,
      bodyInTxid: false,
      ceiling: HEIGHT_CEILING,
      verify: PAID_BINDING_VERIFY,
      tip: { named: false },
    }
  }
}
