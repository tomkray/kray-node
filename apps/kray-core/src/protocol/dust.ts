/**
 * THE DUST THRESHOLD — a LIVE knob, never a magic number.
 *
 * Dust is a RELAY POLICY, not Bitcoin consensus: an output below it will not propagate, so a rune
 * stranded on a sub-dust output is stuck. The threshold is Bitcoin Core's own formula — the vsize
 * to CREATE and SPEND one output of a given type, times the node's dust-relay fee (sat/kvB):
 *
 *     dust(type) = ⌈ spendVsize(type) × dustRelayFeePerKvB / 1000 ⌉
 *
 * At Core's default 3000 sat/kvB this yields the familiar values (p2tr 330, p2wpkh 294, p2pkh 546),
 * proven below. Because it is DERIVED, KRAYNET follows the network automatically: the day relays
 * lower the fee (Core has debated it toward zero), the threshold falls with it — no code change, no
 * break. And an operator may PIN an exact value — down to 1 sat — the instant a relay accepts it,
 * pointing the limit wherever they want, whenever they want, without touching the protocol.
 *
 * Pure: no I/O, no network. The node reads `KRAY_DUST_SATS` (an exact pin) or `KRAY_DUST_RELAY_FEE`
 * (track the network) and resolves through here.
 */

export type ScriptType = 'p2tr' | 'p2wpkh' | 'p2wsh' | 'p2pkh' | 'p2sh'

/** Bitcoin Core GetDustThreshold: the serialized output size + the cost to spend it. A witness
 *  spend is discounted (+67), a legacy one is not (+148). These are the exact vsizes Core uses. */
const SPEND_VSIZE: Record<ScriptType, number> = {
  p2tr: 110,   // txout 43 (8+1+34) + witness spend 67  → 330 sat at 3000/kvB
  p2wsh: 110,  // txout 43 + 67                          → 330
  p2wpkh: 98,  // txout 31 (8+1+22) + witness spend 67   → 294
  p2pkh: 182,  // txout 34 (8+1+25) + legacy spend 148   → 546
  p2sh: 180,   // txout 32 (8+1+23) + legacy spend 148   → 540
}

/** Bitcoin Core's default dust-relay fee, sat per kvB. Lowering this is what lowers the dust. */
export const DEFAULT_DUST_RELAY_FEE = 3000

/** The dust threshold (sats) for an output TYPE at a given dust-relay fee (sat/kvB).
 *  ⌈ vsize × fee / 1000 ⌉ — Core's exact arithmetic; at 3000/kvB → p2tr 330, p2wpkh 294, p2pkh 546. */
export function dustFor(type: ScriptType, dustRelayFeePerKvB: number = DEFAULT_DUST_RELAY_FEE): bigint {
  if (!Number.isFinite(dustRelayFeePerKvB) || dustRelayFeePerKvB < 0) {
    throw new Error('dust: the relay fee must be a non-negative number of sat/kvB')
  }
  const vsize = SPEND_VSIZE[type]
  if (!vsize) throw new Error(`dust: unknown script type "${type}"`)
  return BigInt(Math.ceil((vsize * dustRelayFeePerKvB) / 1000))
}

/**
 * THE LIVE KNOB. Resolve the dust to use, in strict order:
 *   1. an explicit override — pin ANY value (even 1 sat), the instant a relay accepts it;
 *   2. the fee-derived threshold — track the network as it lowers the dust-relay fee;
 *   3. the safe default (p2tr at 3000/kvB = 330).
 * The whole point: KRAYNET can point the limit wherever it wants, at any moment, without a break.
 */
export function resolveDust(opts?: { override?: bigint | number | null; dustRelayFeePerKvB?: number; type?: ScriptType }): bigint {
  if (opts?.override != null && opts.override !== '') {
    const v = BigInt(opts.override)
    if (v < 0n) throw new Error('dust: an override cannot be negative')
    return v
  }
  return dustFor(opts?.type ?? 'p2tr', opts?.dustRelayFeePerKvB ?? DEFAULT_DUST_RELAY_FEE)
}

/** Resolve the dust from environment: KRAY_DUST_SATS pins an exact value; KRAY_DUST_RELAY_FEE tracks
 *  the network; otherwise the default. This is the single place the node/backend reads the knob. */
export function dustFromEnv(env: Record<string, string | undefined> = process.env, type: ScriptType = 'p2tr'): bigint {
  const pin = env.KRAY_DUST_SATS
  if (pin != null && pin !== '') return resolveDust({ override: BigInt(pin) })
  const fee = env.KRAY_DUST_RELAY_FEE
  return resolveDust({ dustRelayFeePerKvB: fee != null && fee !== '' ? Number(fee) : DEFAULT_DUST_RELAY_FEE, type })
}
