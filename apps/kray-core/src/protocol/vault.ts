/**
 * THE VAULT — where a bridged rune actually sits on Bitcoin L1.
 *
 * Every bridge in existence asks one question the user cannot usually answer:
 * "what, exactly, can move my coins?" Here the answer is a script the depositor
 * DERIVES THEMSELVES before sending a single satoshi, from parameters they can
 * read. Two spend paths, and nothing else:
 *
 *   COOPERATIVE  <g1> CHECKSIG <g2> CHECKSIGADD … <t> NUMEQUAL
 *                a threshold of the network's SEALED guardians, the fast path
 *
 *   UNILATERAL   <depositor> CHECKSIGVERIFY <Δ> CHECKSEQUENCEVERIFY
 *                after the timelock, the DEPOSITOR ALONE reclaims — no
 *                federation, no permission, no support ticket
 *
 * The internal key is the NUMS point, so the key path is PROVABLY unspendable:
 * there is no private key for it, which means the only ways out are the two
 * scripts above. A vault whose key path could be spent would be a custodian
 * pretending to be a script.
 *
 * ── WHY THIS SHAPE, AND WHAT IT COSTS ───────────────────────────────────────
 * A k-of-n tapscript needs no FROST ceremony, no distributed key generation and
 * no external library: `CHECKSIGADD` is consensus-level Bitcoin since taproot.
 * The trade is that signatures are not aggregated, so the witness grows with the
 * threshold — a price paid in bytes, not in trust. FROST can replace the
 * cooperative leaf later WITHOUT changing this contract: same two paths, same
 * unilateral guarantee, smaller witness.
 *
 * The honest residue, stated here as everywhere: guardians alone can move NOTHING
 * — the cooperative leaf demands the depositor's own signature first — so the
 * residue is not collusion but the ESCAPE HATCH: after Δ the depositor reclaims
 * the vault's physical total even if their L2 book balance has since dropped
 * (script is carved at deposit time and cannot read the book). Any such sweep is
 * visible on Bitcoin and matched against the anchored book, so it is provable
 * theft — and it is closed entirely by the pre-signed settlement design (each L2
 * transfer co-signs a no-timelock cooperative split at the current book state,
 * which always outruns the Δ-delayed escape).
 *
 * Pure derivation: no I/O, no keys held, no network. Same parameters → same
 * address, on any machine, forever. That is what lets a depositor check.
 */
import * as btc from '@scure/btc-signer'
import { NETWORKS, type BtcNet } from './scheme.ts'

/** How long a depositor waits before the unilateral path opens. ~30 days of
 *  blocks: long enough that an honest federation always settles first, short
 *  enough that nobody's money is ever hostage. */
export const VAULT_TIMELOCK_BLOCKS = 4320

export interface VaultParams {
  /** the SEALED guardians' x-only public keys, hex — order is normalised below */
  guardians: string[]
  /** how many of them must sign the cooperative path */
  threshold: number
  /** the depositor's x-only public key, hex — the only key on the exit path */
  depositor: string
  /** blocks the depositor waits before reclaiming alone */
  timelock?: number
  net: BtcNet
}

export interface VaultDescriptor {
  /** the address to deposit into — derived, never assigned */
  address: string
  /** the two spend paths, as hex scripts anyone can read */
  cooperativeScript: string
  unilateralScript: string
  /** the tap tree's merkle root, so the address can be re-derived by hand */
  tapMerkleRoot: string
  /** the parameters, normalised — what was actually committed to */
  params: Required<Omit<VaultParams, 'net'>> & { net: BtcNet }
}

const XONLY_RE = /^[0-9a-f]{64}$/
/**
 * NORMALISE A KEY TO X-ONLY, by the SAME rule the address derivation uses.
 *
 * A wallet may hand over a 33-byte compressed key or a 32-byte x-only one, and
 * `addressOf` accepts both — so the chain stores whichever it was given. A vault
 * built from sealed guardian keys therefore has to accept both too, or the
 * federation on the chain and the federation in the script would be different
 * sets. One rule, applied in one place: drop the parity byte, keep the x.
 */
export function toXOnly(key: string): string {
  const k = key.toLowerCase()
  if (XONLY_RE.test(k)) return k
  if (/^0[23][0-9a-f]{64}$/.test(k)) return k.slice(2)
  throw new Error('vault: a key must be 32-byte x-only or 33-byte compressed hex')
}
const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** A minimal script number push, Bitcoin's own minimal encoding. */
function pushNumber(n: number): Uint8Array {
  if (n === 0) return Uint8Array.from([0x00])
  if (n >= 1 && n <= 16) return Uint8Array.from([0x50 + n]) // OP_1..OP_16
  const bytes: number[] = []
  let v = n
  while (v > 0) { bytes.push(v & 0xff); v >>= 8 }
  if (bytes[bytes.length - 1] & 0x80) bytes.push(0x00) // keep it positive
  return Uint8Array.from([bytes.length, ...bytes])
}

/**
 * THE COOPERATIVE LEAF — the DEPOSITOR and a k-of-n of the guardians.
 * `<depositor> CHECKSIGVERIFY <g1> CHECKSIG (<g_i> CHECKSIGADD)… <k> NUMEQUAL`
 *
 * The depositor's CHECKSIGVERIFY comes FIRST and is not optional: no threshold of
 * guardians — not even all n in collusion — can move the funds without the owner's
 * own signature. The federation is a CO-SIGNER that speeds the exit up, never a
 * custodian that could take it. This is the Lightning shape (both sides for the
 * cooperative close; the owner alone, timelocked, for the unilateral one), so
 * guardian theft stops being "detectable" and becomes cryptographically impossible.
 */
export function cooperativeScript(depositor: string, guardians: string[], threshold: number): Uint8Array {
  if (guardians.length === 0) throw new Error('vault: a cooperative path needs at least one guardian')
  // exported, so it must defend itself: a repeated key would let one guardian
  // satisfy a threshold twice over
  if (new Set(guardians.map((k) => k.toLowerCase())).size !== guardians.length) throw new Error('vault: duplicate guardian keys — a set, not a list')
  if (threshold < 1 || threshold > guardians.length) throw new Error('vault: the threshold must be between 1 and the number of guardians')
  let dep: string
  try { dep = toXOnly(depositor) } catch (_) { throw new Error('vault: the depositor key must be 32-byte x-only hex') }
  const parts: number[] = [0x20, ...hexToBytes(dep), 0xad] // push depositor, OP_CHECKSIGVERIFY — REQUIRED first
  guardians.forEach((raw, i) => {
    let pk: string
    try { pk = toXOnly(raw) } catch (_) { throw new Error('vault: a guardian key must be 32-byte x-only hex') }
    parts.push(0x20, ...hexToBytes(pk)) // push 32 bytes
    parts.push(i === 0 ? 0xac : 0xba) // OP_CHECKSIG : OP_CHECKSIGADD
  })
  parts.push(...pushNumber(threshold), 0x9c) // OP_NUMEQUAL
  return Uint8Array.from(parts)
}

/**
 * THE UNILATERAL LEAF — the depositor alone, after the timelock.
 * `<depositor> CHECKSIGVERIFY <Δ> CHECKSEQUENCEVERIFY`
 *
 * CHECKSIGVERIFY before the timelock, so a spend must satisfy BOTH: the wrong
 * key fails immediately and the right key still waits out the delay.
 */
export function unilateralScript(depositor: string, timelock: number): Uint8Array {
  let dep: string
  try { dep = toXOnly(depositor) } catch (_) { throw new Error('vault: the depositor key must be 32-byte x-only hex') }
  if (!Number.isInteger(timelock) || timelock < 1 || timelock > 0xffff) throw new Error('vault: the timelock must be 1..65535 blocks (a relative CSV height)')
  return Uint8Array.from([
    0x20, ...hexToBytes(dep), 0xad, // push key, OP_CHECKSIGVERIFY
    ...pushNumber(timelock), 0xb2, // OP_CHECKSEQUENCEVERIFY
  ])
}

/**
 * DERIVE THE VAULT. Deterministic and total: the same parameters produce the
 * same address on every machine, which is precisely what lets a depositor verify
 * the vault instead of trusting whoever handed them an address.
 *
 * Guardian keys are SORTED, so the same set never yields two different vaults —
 * an address that depends on the order somebody happened to list keys in is an
 * address nobody can re-derive with confidence.
 */
export function deriveVault(p: VaultParams): VaultDescriptor {
  // normalise FIRST, then dedup: the compressed and x-only forms of one key are
  // the SAME guardian, and counting them twice would fake a threshold
  const normalised = p.guardians.map((k) => {
    try { return toXOnly(k) } catch (_) { throw new Error('vault: a guardian key must be 32-byte x-only hex') }
  })
  const guardians = [...new Set(normalised)].sort()
  if (guardians.length !== normalised.length) throw new Error('vault: duplicate guardian keys — a set, not a list')
  const timelock = p.timelock ?? VAULT_TIMELOCK_BLOCKS
  const coop = cooperativeScript(p.depositor.toLowerCase(), guardians, p.threshold)
  const solo = unilateralScript(p.depositor.toLowerCase(), timelock)
  // the NUMS internal key: no private key exists for it, so the key path can
  // never be spent and the two leaves are the ONLY ways out
  const out = btc.p2tr(
    btc.TAPROOT_UNSPENDABLE_KEY,
    [{ script: coop }, { script: solo }],
    NETWORKS[p.net],
    true,
  )
  return {
    address: out.address!,
    cooperativeScript: bytesToHex(coop),
    unilateralScript: bytesToHex(solo),
    tapMerkleRoot: bytesToHex(out.tapMerkleRoot ?? new Uint8Array()),
    params: { guardians, threshold: p.threshold, depositor: toXOnly(p.depositor), timelock, net: p.net },
  }
}

/**
 * VERIFY A VAULT ADDRESS against the parameters it claims to encode. This is the
 * check a depositor runs BEFORE sending funds, and the check the L2 runs before
 * accepting a vault as a rune's home: an address is only as good as the script
 * it provably commits to.
 */
export function verifyVault(address: string, p: VaultParams): { ok: boolean; reason?: string; derived?: string } {
  try {
    const d = deriveVault(p)
    // bech32 allows an ALL-uppercase form (QR codes use it); mixed case is
    // invalid bech32 and must never be accepted by a case-insensitive shortcut
    const given = /[A-Z]/.test(address) && address === address.toUpperCase() ? address.toLowerCase() : address
    if (d.address !== given) return { ok: false, reason: 'the address does not match these parameters', derived: d.address }
    return { ok: true, derived: d.address }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'malformed vault parameters' }
  }
}

/** Is this the provably unspendable internal key? A vault whose key path can be
 *  spent is a custodian wearing a script's clothes. */
export function keyPathIsUnspendable(internalKeyHex: string): boolean {
  return internalKeyHex.toLowerCase() === bytesToHex(btc.TAPROOT_UNSPENDABLE_KEY)
}
