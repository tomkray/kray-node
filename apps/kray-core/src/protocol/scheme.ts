/**
 * KRAY-CORE — cryptographic identity (proof of WHO acts), Bitcoin-native.
 *
 * A KRAY-CORE account IS the user's Bitcoin Taproot (P2TR) address — the very
 * same address their KrayWallet already shows and the KRAY L2 already uses. One
 * key, one address, from Bitcoin mainnet to the L2 to here: nothing new for the
 * user to learn, and — because reputation needs a stable, real identity — the
 * honor layer (Glow, Honocracy) rests on a persistent, attributable soul.
 *
 * PRIMARY SCHEME — KrayWallet: BIP-340 Schnorr over a single SHA-256 of the
 * UTF-8 message (the "Kray digest"), verified against the x-only INTERNAL
 * (untweaked, BIP-86) taproot key, signature 64 bytes as hex (128 chars).
 * Byte-for-byte the scheme KRILL's audited verifier
 * (krill-node/src/pool/bip322.ts, KrayWallet audit 2026-07-22) and the KRAY L2
 * both use. Identity is bound by RE-DERIVING the address from the internal key —
 * p2tr(internalKey) == address — never by reading the bech32m payload (that is
 * the TWEAKED output key and can never verify an internal-key signature).
 *
 * This is Bitcoin's OWN signature math (secp256k1 + Schnorr, BIP-340) — the same
 * curve and scheme as taproot. The economic math (proof-of-donation minting,
 * conservation, born-from-fire star creation) is untouched by any of this;
 * identity is a separate layer.
 *
 * CRYPTO-AGILE: verification dispatches on a named Scheme, so a future one
 * (bip322, or a post-quantum scheme) plugs in as ONE added case without touching
 * the core. SELF-CONTAINED: kray-core carries its own copy (the audited pure-JS
 * libs @noble/curves + @scure/btc-signer), never importing from krill-node.
 * "Needs no company/cloud/server" (the durability doctrine) is intact — a pure-JS
 * audited crypto lib bundled with the node depends on no one.
 *
 * Messages are domain-separated and network-bound, so a signature can never be
 * replayed on another network, action, or protocol version. Fail-closed: any
 * malformed key/signature verifies as `false`, never throws mid-verify.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import * as btc from '@scure/btc-signer'
import { bech32, bech32m } from '@scure/base'
import { createHash } from 'node:crypto'
import { verifyMldsa } from './mldsa.ts'   // post-quantum scheme (mldsa.ts imports only the TYPE BtcNet back — no runtime cycle)

/** Signature schemes this node can verify. Add a case → the network gains a scheme. */
export type SchemeId = 'kraywallet' | 'ml-dsa'
const SUPPORTED: Record<SchemeId, true> = { kraywallet: true, 'ml-dsa': true }
export function isSupportedScheme(s: string): s is SchemeId {
  return Object.prototype.hasOwnProperty.call(SUPPORTED, s)
}

/** The four Bitcoin networks by their address parameters (own copy, self-contained). */
export type BtcNet = 'main' | 'testnet' | 'signet' | 'regtest'
export const NETWORKS: Record<BtcNet, { bech32: string; pubKeyHash: number; scriptHash: number; wif: number }> = {
  main: { bech32: 'bc', pubKeyHash: 0x00, scriptHash: 0x05, wif: 0x80 },
  testnet: { bech32: 'tb', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef },
  signet: { bech32: 'tb', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef },
  regtest: { bech32: 'bcrt', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef },
}

/** Map a KRAY-CORE network label to its Bitcoin address network. Unknown/dev → regtest. */
export function toBtcNet(network: string): BtcNet {
  switch (network) {
    case 'mainnet':
    case 'main':
    case 'bitcoin':
      return 'main'
    case 'testnet':
    case 'test':
      return 'testnet'
    case 'signet':
      return 'signet'
    default:
      return 'regtest'
  }
}

/**
 * Re-encode a segwit/taproot address onto a target network by SWAPPING ONLY THE HRP — the witness
 * version and program (the key) are preserved byte-for-byte, so it is the SAME key's address on the
 * other network. This is how the unified DevNet accepts a wallet's mainnet `bc1…` address and speaks
 * to a regtest `bcrt1…` node: same key, different prefix. A non-bech32 address is returned untouched.
 */
export function normalizeAddr(addr: string, network: string): string {
  if (typeof addr !== 'string') return addr
  const hrp = NETWORKS[toBtcNet(network)].bech32
  const a = addr.trim().toLowerCase()
  for (const codec of [bech32m, bech32]) {
    try {
      const d = codec.decode(a as `${string}1${string}`, 200)
      if (d.prefix === hrp) return a           // already on the target network
      return codec.encode(hrp, d.words, 200)   // same words (version+program) under the new prefix
    } catch { /* not this codec — try the other, else leave the address as-is */ }
  }
  return addr
}

const sha256 = (b: Uint8Array): Uint8Array => new Uint8Array(createHash('sha256').update(b).digest())
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error('invalid hex')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
function bytesToHex(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0')
  return s
}

/**
 * The KRAY-CORE account address = the taproot (P2TR) address of the x-only
 * internal key on `net` — the same address the wallet shows. Control of the key
 * IS control of the account. Throws on a malformed key (callers treat as invalid).
 */
export function addressOf(publicKeyHex: string, net: BtcNet): string {
  const raw = hexToBytes(publicKeyHex)
  const xonly = raw.length === 33 ? raw.slice(1) : raw
  if (xonly.length !== 32) throw new Error('public key must be x-only (32) or compressed (33) bytes')
  return btc.p2tr(xonly, undefined, NETWORKS[net]).address!
}

/** Canonical, domain-separated, network-bound message a transfer signs. */
export function transferMessage(network: string, from: string, to: string, amount: bigint, nonce: number): string {
  return `kray-core.transfer.v1|net=${network}|from=${from}|to=${to}|amount=${amount}|nonce=${nonce}`
}

/** Ӿ TRANSFER — the domain-separated, network-labelled message a holder signs to move the transferable token
 *  born from burned ₭ (slice 2). A DISTINCT domain from the ₭ transfer, so a ₭ signature can never be replayed
 *  as an Ӿ move, and vice-versa. */
export function xSendMessage(network: string, from: string, to: string, amount: bigint, nonce: number): string {
  return `kray-core.x-send.v1|net=${network}|from=${from}|to=${to}|amount=${amount}|nonce=${nonce}`
}

/** LUZ SEND — move this star's element (KRC-77). Own domain: a ₭ / Ӿ signature
 *  can never move Luz, and a send of ★N cannot replay as ★M. */
export function cutSendMessage(network: string, from: string, to: string, star: bigint, amount: bigint, nonce: number): string {
  return `kray-core.cut-send.v1|net=${network}|from=${from}|to=${to}|star=${star}|amount=${amount}|nonce=${nonce}`
}

/** THE TK-FOLD LANE ENTRY (Gate 2) — the message a holder signs to move their own spendable Ӿ INTO the
 *  compressed lane. Its OWN injective domain (no `to` — the lane credits the signer), so it can never be
 *  replayed as an x-send or a lane transfer, nor the reverse. Journal nonce (not the lane nonce). */
export function laneEnterMessage(network: string, from: string, amount: bigint, nonce: number): string {
  return `kray-core.lane-enter.v1|net=${network}|from=${from}|amount=${amount}|nonce=${nonce}`
}

/** THE TK-FOLD LANE EXIT (Gate 2) — the mirror: move lane Ӿ back to the spendable journal book. */
export function laneExitMessage(network: string, from: string, amount: bigint, nonce: number): string {
  return `kray-core.lane-exit.v1|net=${network}|from=${from}|amount=${amount}|nonce=${nonce}`
}

/** THE FOLD SEAL (Gate 2) — the message a FOLDER signs to land one proven breath on the journal. It binds
 *  the pre/post lane roots and the diffs hash (all three are public inputs of the fold proof), so the
 *  signature, the proof and the journal bytes can only ever tell ONE story. */
export function foldSealMessage(network: string, from: string, preRoot: string, postRoot: string, diffsHash: string, nonce: number): string {
  return `kray-core.fold-seal.v1|net=${network}|from=${from}|pre=${preRoot}|post=${postRoot}|diffs=${diffsHash}|nonce=${nonce}`
}

/** THE SPORADIC BURN — the message a holder signs to DESTROY their own ₭ (the Creator's law: ₭ can never be
 *  frozen — only burned; the burn mints Ӿ 1:1 to the burner). Its OWN injective domain, deliberately with NO
 *  `to` field — a burn has no recipient, so this signature can never be replayed as any transfer, and no
 *  transfer signature can ever burn. Network + nonce ride inside, like every KRAY message. */
export function burnMessage(network: string, from: string, amount: bigint, nonce: number): string {
  return `kray-core.burn.v1|net=${network}|from=${from}|amount=${amount}|nonce=${nonce}`
}

/** QUANTUM RECOVERY COMMITMENT — an account binds a HASH of its future post-quantum key under its current
 *  signature. Signed while ECC is still safe, so the binding is authentic; the hash itself is quantum-safe
 *  forever. `commit` is the 64-hex SHA-256 of the PQC public key. */
export function quantumCommitMessage(network: string, from: string, commit: string, nonce: number): string {
  return `kray-core.quantum-commit.v1|net=${network}|from=${from}|commit=${commit}|nonce=${nonce}`
}

/** THE QUANTUM ESCAPE HATCH — the message a Lamport key signs to rescue an account. Authorized SOLELY by the
 *  quantum-safe Lamport signature (not the ECC key), so it works even after a quantum computer has broken the
 *  account's ECC key: only the holder of the pre-committed Lamport key can move the value. */
export function quantumMigrateMessage(network: string, from: string, to: string, nonce: number): string {
  return `kray-core.quantum-migrate.v1|net=${network}|from=${from}|to=${to}|nonce=${nonce}`
}

/** Canonical opt-in message a validator signs to prove it controls its identity. */
export function optInMessage(network: string, validator: string): string {
  return `kray-core.validator-optin.v1|net=${network}|validator=${validator}`
}

/** Canonical inscription message — EVERY field the tattoo seals is signed
 *  (contentType/size/parent included, so nothing is wire-mutable after signing). */
export function inscribeMessage(network: string, from: string, star: bigint, contentHash: string, contentType: string, size: number, parent: bigint | undefined, nonce: number): string {
  return `kray-core.inscribe.v1|net=${network}|from=${from}|star=${star}|content=${contentHash}|type=${contentType}|size=${size}|parent=${parent ?? ''}|nonce=${nonce}`
}

/** Canonical baptism message — the name goes LAST so any bytes are unambiguous. */
export function nameMessage(network: string, from: string, star: bigint, nonce: number, name: string): string {
  return `kray-core.name.v1|net=${network}|from=${from}|star=${star}|nonce=${nonce}|name=${name}`
}

/** KRAYNET v2 inscribe — the star is BORN from the act, so there is NO star number to
 *  sign; every OTHER sealed field (content, type, size, parent) is signed, so nothing is
 *  wire-mutable after signing. The creation number is assigned by the journal at apply. */
export function inscribeMessageV2(network: string, from: string, contentHash: string, contentType: string, size: number, parent: bigint | undefined, nonce: number, onStar?: bigint): string {
  const base = `kraynet.inscribe.v2|net=${network}|from=${from}|content=${contentHash}|type=${contentType}|size=${size}|parent=${parent ?? ''}|nonce=${nonce}`
  // onStar present → this content is added to an EXISTING star you own (a star is a canvas: name AND/OR content)
  return onStar != null ? `${base}|onstar=${onStar}` : base
}

/** KRAYNET v2 baptism — no star number (born from the act); the name goes LAST. */
export function nameMessageV2(network: string, from: string, nonce: number, name: string, onStar?: bigint): string {
  const base = `kraynet.name.v2|net=${network}|from=${from}|nonce=${nonce}|name=${name}`
  // onStar present → this name baptises an EXISTING star you own (a star is a canvas: name AND/OR content)
  return onStar != null ? `${base}|onstar=${onStar}` : base
}

/** MULTIPARENT consensus law (message v3) — caps and grammars, mirrored in the ledger's
 *  shape gate. Small caps bound the graph-spam surface (each parent is an ownership check;
 *  each origin is an external attestation) while leaving real collections room. */
export const MAX_PARENTS_PER_ACT = 8
export const MAX_ORIGINS_PER_ACT = 8
/** A Bitcoin L1 ordinal inscription id: <64-hex reveal txid>i<index>. */
export const ORDINAL_ID_RE = /^[0-9a-f]{64}i\d+$/

/** KRAYNET v3 inscribe — MULTIPARENT provenance. Two typed lists ride INSIDE the signed
 *  message, always present (empty allowed), fixed field order:
 *    `parents` — KRAY parent stars (decimal creation numbers), EVERY one owned by `from`;
 *    `origins` — Bitcoin L1 ordinal ids (<txid>iN), holder-attested at ingress.
 *  Injective BY CONSTRUCTION: both charsets are consensus-constrained (digits / 64-hex+iN,
 *  comma-joined), so no attacker-chosen bytes can shift a pipe-field boundary. v2 and
 *  origin.v2 are FROZEN — every already-journaled event re-verifies against its original
 *  builder forever; domain separation (`kraynet.inscribe.v3`) does retro-compat for free. */
export function inscribeMessageV3(network: string, from: string, contentHash: string, contentType: string, size: number, parents: readonly (bigint | string)[], origins: readonly string[], nonce: number, onStar?: bigint): string {
  const base = `kraynet.inscribe.v3|net=${network}|from=${from}|content=${contentHash}|type=${contentType}|size=${size}|parents=${parents.join(',')}|origins=${origins.join(',')}|nonce=${nonce}`
  return onStar != null ? `${base}|onstar=${onStar}` : base
}

/** Optional inscription metadata — any JSON the writer chooses (Ordinals-style).
 *  Sealed INSIDE the signed act. Empty-absent keeps every v2/v3 journal and
 *  historical cascade root byte-identical (A3). The JSON goes LAST so any bytes
 *  (pipes, newlines) stay unambiguous — same law as a baptism name. */
export const INSCRIBE_META_MAX = 8192

export function assertInscriptionMeta(meta: string): void {
  if (typeof meta !== 'string') throw new Error('inscription meta: must be a string')
  if (!meta.trim()) throw new Error('inscription meta: empty metadata is absence — do not sign a blank v4')
  const bytes = Buffer.byteLength(meta, 'utf8')
  if (bytes > INSCRIBE_META_MAX) throw new Error(`inscription meta: ${bytes} bytes — cap is ${INSCRIBE_META_MAX}`)
  try { JSON.parse(meta) }
  catch { throw new Error('inscription meta: must be JSON') }
}

/** KRAYNET v4 inscribe — v3 lineage plus a free JSON blob. `meta` rides LAST
 *  (free text). v2 and v3 stay FROZEN. */
export function inscribeMessageV4(
  network: string, from: string, contentHash: string, contentType: string, size: number,
  parents: readonly (bigint | string)[], origins: readonly string[],
  meta: string, nonce: number, onStar?: bigint,
): string {
  const base = `kraynet.inscribe.v4|net=${network}|from=${from}|content=${contentHash}|type=${contentType}|size=${size}|parents=${parents.join(',')}|origins=${origins.join(',')}|nonce=${nonce}`
  const mid = onStar != null ? `${base}|onstar=${onStar}` : base
  return `${mid}|meta=${meta}`
}

/** Genetics of a work — sha256 of the skeleton (MPEG / JPEG / PNG), 64 hex.
 *  Injective: hex cannot shift a pipe-field. */
export const BODY_HASH_RE = /^[0-9a-f]{64}$/

/** KRAYNET v5 inscribe — v3 lineage plus the signed body hash (A5 skeleton).
 *  `body` is 64 hex. `meta` stays LAST and optional (File tab without JSON is
 *  lawful). v2 / v3 / v4 stay FROZEN — an event without bodyHash re-verifies
 *  on its original builder (A3). */
export function inscribeMessageV5(
  network: string, from: string, contentHash: string, contentType: string, size: number,
  parents: readonly (bigint | string)[], origins: readonly string[],
  bodyHash: string, nonce: number, onStar?: bigint, meta?: string,
): string {
  if (!BODY_HASH_RE.test(bodyHash)) throw new Error('body hash must be 64 lowercase hex')
  const base = `kraynet.inscribe.v5|net=${network}|from=${from}|content=${contentHash}|type=${contentType}|size=${size}|parents=${parents.join(',')}|origins=${origins.join(',')}|nonce=${nonce}`
  const mid = onStar != null ? `${base}|onstar=${onStar}` : base
  const withBody = `${mid}|body=${bodyHash}`
  return meta != null && meta !== '' ? `${withBody}|meta=${meta}` : withBody
}

/** Per-child bind — one send-to-self (Casey hop ≥ 1) fathers many KRAY
 *  children, like one L1 reveal with many envelopes. Distinct because
 *  contentHash is unique (A5). */
export const ORIGIN_CHILD_DOMAIN = 'kray-core.origin.child.v1'
export function originChildBindOf(
  net: string, l1Id: string, holderTxid: string, holderVout: number, holderOffset: string, contentHash: string,
): string {
  return createHash('sha256').update(
    [ORIGIN_CHILD_DOMAIN, net, String(l1Id).toLowerCase(), String(holderTxid).toLowerCase(), String(holderVout), String(holderOffset), String(contentHash).toLowerCase()].join('|'),
    'utf8',
  ).digest('hex')
}

/** Optional batch compression: one SPV bag + SHA-256 of every content hash.
 *  Siblings may sign only the root. Max = batch door. */
export const ORIGIN_COHORT_MAX = 200
export const ORIGIN_COHORT_DOMAIN = 'kray-core.origin.cohort.v1'

export function originCohortRootOf(hashes: readonly string[]): string {
  const leaves = hashes.map((h) => String(h).toLowerCase())
  if (leaves.length < 2 || leaves.length > ORIGIN_COHORT_MAX) {
    throw new Error(`origin cohort is 2..${ORIGIN_COHORT_MAX} content hashes`)
  }
  if (leaves.some((h) => !BODY_HASH_RE.test(h))) throw new Error('origin cohort leaves must be 64 lowercase hex')
  if (new Set(leaves).size !== leaves.length) throw new Error('origin cohort leaves must be unique')
  const sorted = [...leaves].sort()
  return createHash('sha256').update(ORIGIN_COHORT_DOMAIN + '|' + sorted.join('|'), 'utf8').digest('hex')
}

/** KRAYNET v6 inscribe — v3 lineage plus a committed L1 origin cohort root.
 *  The opening act journals the leaf list (reducer checks sha256(leaves)===root)
 *  and the SPV bag; siblings sign only the root and prove membership.
 *  v2–v5 stay FROZEN. `cohort` is 64 hex (injective). body/meta optional, meta LAST. */
export function inscribeMessageV6(
  network: string, from: string, contentHash: string, contentType: string, size: number,
  parents: readonly (bigint | string)[], origins: readonly string[],
  cohortRoot: string, nonce: number,
  onStar?: bigint, bodyHash?: string, meta?: string,
): string {
  if (!BODY_HASH_RE.test(cohortRoot)) throw new Error('origin cohort root must be 64 lowercase hex')
  if (bodyHash != null && bodyHash !== '' && !BODY_HASH_RE.test(bodyHash)) throw new Error('body hash must be 64 lowercase hex')
  const base = `kraynet.inscribe.v6|net=${network}|from=${from}|content=${contentHash}|type=${contentType}|size=${size}|parents=${parents.join(',')}|origins=${origins.join(',')}|cohort=${cohortRoot}|nonce=${nonce}`
  const mid = onStar != null ? `${base}|onstar=${onStar}` : base
  const withBody = bodyHash ? `${mid}|body=${bodyHash}` : mid
  return meta != null && meta !== '' ? `${withBody}|meta=${meta}` : withBody
}

/** KRAYNET v2 origin — adopt an L1 Ordinals inscription as a born-from-fire star. No star
 *  number (born from the act); the SIGNED L1 inscription id binds the provenance (the L1
 *  existence/ownership proof is verified at ingress, like a rune deposit). */
export function originMessageV2(network: string, from: string, l1InscriptionId: string, contentHash: string, contentType: string, size: number, nonce: number): string {
  return `kraynet.origin.v2|net=${network}|from=${from}|ins=${l1InscriptionId}|content=${contentHash}|type=${contentType}|size=${size}|nonce=${nonce}`
}

/** Canonical proposal message — the title goes LAST (free text). */
export function proposeMessage(network: string, proposer: string, proposalId: string, closesAtInterval: number, title: string): string {
  return `kray-core.propose.v1|net=${network}|by=${proposer}|id=${proposalId}|closes=${closesAtInterval}|title=${title}`
}

/** Canonical vote message — honor-gated governance (the choice goes LAST). */
export function voteMessage(network: string, voter: string, proposalId: string, choice: string): string {
  return `kray-core.vote.v1|net=${network}|voter=${voter}|id=${proposalId}|choice=${choice}`
}

/** Canonical send-star message — the explicit move of ONE named star (the NFT send). */
export function sendStarMessage(network: string, from: string, to: string, star: bigint, nonce: number): string {
  return `kray-core.sendstar.v1|net=${network}|from=${from}|to=${to}|star=${star}|nonce=${nonce}`
}

/** THE STAR MARKET (native, atomic, trustless) — three domain-separated messages so a signature for one
 *  act can never be replayed as another (Fano: never overclaim). Every act pays the eternal 1-₭ fee to the
 *  validators (TREASURY), exactly like transfer-star, which a buy IS underneath. A listing is a SIGNED
 *  commitment; it moves no star until a matching buy applies both legs in ONE reducer step. */
/** LIST (also EDIT PRICE — re-listing the same star replaces the offer): the owner signs "star for price". */
export function starListMessage(network: string, from: string, star: bigint, price: bigint, nonce: number): string {
  return `kray-core.star-list.v1|net=${network}|from=${from}|star=${star}|price=${price}|nonce=${nonce}`
}
/** DELIST (cancel): the owner signs to withdraw their own live offer. */
export function starDelistMessage(network: string, from: string, star: bigint, nonce: number): string {
  return `kray-core.star-delist.v1|net=${network}|from=${from}|star=${star}|nonce=${nonce}`
}
/** BUY: the buyer signs the EXACT terms — which star, at which price, from which seller — so the buy applies
 *  only against the offer the buyer saw (a re-priced or delisted offer refutes the stale buy; no phantom price). */
export function starBuyMessage(network: string, buyer: string, star: bigint, price: bigint, seller: string, nonce: number): string {
  return `kray-core.star-buy.v1|net=${network}|buyer=${buyer}|star=${star}|price=${price}|seller=${seller}|nonce=${nonce}`
}
/** ESCROWED OFFER — bidder locks `price` ₭ into the keyless offer pot. */
export function starOfferMessage(network: string, from: string, star: bigint, price: bigint, nonce: number): string {
  return `kray-core.star-offer.v1|net=${network}|from=${from}|star=${star}|price=${price}|nonce=${nonce}`
}
/** Bidder unlocks their own live offer — ₭ returns. */
export function starOfferCancelMessage(network: string, from: string, star: bigint, nonce: number): string {
  return `kray-core.star-offer-cancel.v1|net=${network}|from=${from}|star=${star}|nonce=${nonce}`
}
/** Owner accepts the EXACT offer (star, price, bidder) — atomic pay + star move. */
export function starOfferAcceptMessage(network: string, owner: string, star: bigint, price: bigint, bidder: string, nonce: number): string {
  return `kray-core.star-offer-accept.v1|net=${network}|owner=${owner}|star=${star}|price=${price}|bidder=${bidder}|nonce=${nonce}`
}

/**
 * THE SCRIPT AN ADDRESS PAYS TO — hex, derived from the address itself.
 *
 * A rune deposit is recognised by matching the VAULT's script against the raw
 * transaction's outputs. Matching by output index would let a claimant pick
 * which output to call the vault; matching by script cannot be steered. This
 * derives the script rather than trusting anyone's word for it.
 */
export function scriptOfAddress(address: string, net: BtcNet): string {
  const decoded = btc.Address(NETWORKS[net]).decode(address)
  return Buffer.from(btc.OutScript.encode(decoded)).toString('hex')
}

/**
 * THE ADDRESS A SCRIPT PAYS TO — inverse of `scriptOfAddress`.
 *
 * A pot deposit names its L2 owner from the proven Bitcoin tx's vin prevouts.
 * Those prevouts are scripts, not addresses. This re-encodes a script onto `net`
 * so the unique-spender law can speak in the same address the wallet holds.
 * Unknown / non-standard scripts return null (the caller refuses — never invents).
 */
export function addressOfScript(scriptHex: string, net: BtcNet): string | null {
  try {
    const raw = Buffer.from(String(scriptHex || ''), 'hex')
    if (raw.length === 0) return null
    const decoded = btc.OutScript.decode(raw)
    return btc.Address(NETWORKS[net]).encode(decoded)
  } catch {
    return null
  }
}

/**
 * Does `address` belong to `net`? True iff it decodes under that network's rules — a `bcrt1…`
 * on a signet node, or a `bc1…` on regtest, is false. The signature already binds a spender's
 * OWN address to the network (verifyKrayWallet re-derives it there); this is for the addresses
 * NObody signs — a transfer recipient, a donor credited from an L1 OP_RETURN — so value can never
 * be minted onto or sent to an address that belongs to a different Bitcoin network.
 */
export function isAddressOnNetwork(address: string, net: BtcNet): boolean {
  try { btc.Address(NETWORKS[net]).decode(address); return true } catch { return false }
}

/**
 * Canonical CONTRACT-CALL message — the caller signs the contract, the rule and
 * the exact arguments, in a fixed order. Nothing about a call is wire-mutable
 * after signing: change one argument and the signature no longer verifies.
 */
export function contractCallMessage(network: string, from: string, contract: string, rule: string, args: Record<string, bigint>, nonce: number): string {
  const list = Object.keys(args).sort().map((k) => `${k}=${args[k]}`).join(',')
  return `kray-core.contract-call.v1|net=${network}|from=${from}|contract=${contract}|rule=${rule}|args=${list}|nonce=${nonce}`
}

/** CONTRACT-CALL v2 — additive (A3). `clock` is LAST and required: the signed world-time
 *  the IR reads as ctx.at. Absent `clock` on the event keeps the frozen v1 message so
 *  every already-journaled call replays. Beacon/interval are NOT in this string — a
 *  stranger re-derives them from the journal prefix (the last Bitcoin seal). */
export function contractCallMessageV2(network: string, from: string, contract: string, rule: string, args: Record<string, bigint>, nonce: number, clock: number): string {
  if (!Number.isInteger(clock) || clock < 0) throw new Error('scheme: a v2 call needs a whole-number clock')
  const list = Object.keys(args).sort().map((k) => `${k}=${args[k]}`).join(',')
  return `kray-core.contract-call.v2|net=${network}|from=${from}|contract=${contract}|rule=${rule}|args=${list}|nonce=${nonce}|clock=${clock}`
}

/** Canonical CONTRACT message — the creator signs the exact code they deploy. */
export function contractMessage(network: string, from: string, codeHash: string): string {
  return `kray-core.contract.v1|net=${network}|from=${from}|code=${codeHash}`
}

/** KRAYNET contract v2 — the third canvas on a star. `onstar` is LAST and required:
 *  the law is born from fire (burns 1 ₭) onto a star the signer already owns.
 *  v1 stays FROZEN (no burn, no star) so every already-journaled pot replays. */
export function contractMessageV2(network: string, from: string, codeHash: string, onStar: bigint): string {
  return `kray-core.contract.v2|net=${network}|from=${from}|code=${codeHash}|onstar=${onStar}`
}

/** KRAYNET eternize v1 (docs/ETERNIZE.md) — bind a star to the L1 ordinal inscription that
 *  carries its EXACT bytes. The signer names star + inscription id; the SPV bundle rides the
 *  event and the reducer re-proves it (ADR-1). Anyone may prove — eternity is a fact. */
export function eternizeMessage(network: string, from: string, star: bigint, l1InscriptionId: string, nonce: number): string {
  return `kraynet.eternize.v1|net=${network}|from=${from}|star=${star}|l1=${l1InscriptionId}|nonce=${nonce}`
}

/** Citizen face — bind one OWNED star as this address's profile face (avatar + name mouth).
 *  Ownership is re-proven in the reducer on every apply; losing the star clears the face. */
export function setFaceMessage(network: string, from: string, star: bigint, nonce: number): string {
  return `kraynet.set-face.v1|net=${network}|from=${from}|star=${star}|nonce=${nonce}`
}

/** CITIZEN MOUTH — bio + site URL + banner (owned image star) + banner click URL.
 *  Feeless like quantum-commit: signature + nonce only; no ₭. Fields must not contain `|` or newlines
 *  so the domain-separated message stays unambiguous. Empty strings clear. */
export const PROFILE_DESC_MAX_BYTES = 400
export const PROFILE_URL_MAX_BYTES = 512
export function assertProfileText(s: string, maxBytes: number, label: string): void {
  if (typeof s !== 'string') throw new Error(`set-profile: ${label} must be a string`)
  if (Buffer.byteLength(s, 'utf8') > maxBytes) throw new Error(`set-profile: ${label} is ${Buffer.byteLength(s, 'utf8')} bytes — cap is ${maxBytes}`)
  if (/[|\r\n]/.test(s)) throw new Error(`set-profile: ${label} must not contain | or newlines`)
}
export function assertHttpsOrEmpty(u: string, label: string): void {
  assertProfileText(u, PROFILE_URL_MAX_BYTES, label)
  if (u === '') return
  let parsed: URL
  try { parsed = new URL(u) } catch { throw new Error(`set-profile: ${label} is not a valid URL`) }
  if (parsed.protocol !== 'https:') throw new Error(`set-profile: ${label} must be https`)
}
export function setProfileMessage(
  network: string, from: string,
  description: string, url: string, bannerStar: string, bannerUrl: string,
  nonce: number,
): string {
  return `kray-core.set-profile.v1|net=${network}|from=${from}|desc=${description}|url=${url}|bannerStar=${bannerStar}|bannerUrl=${bannerUrl}|nonce=${nonce}`
}

/** Canonical RUNE-SEND message — an L2 rune transfer, signed by its holder. */
export function runeSendMessage(network: string, from: string, to: string, runeId: string, amount: bigint, nonce: number): string {
  return `kray-core.rune-send.v1|net=${network}|from=${from}|to=${to}|rune=${runeId}|amount=${amount}|nonce=${nonce}`
}

/** Canonical RUNE-EXIT message — the request that LOCKS credits before any L1
 *  payout exists. The L1 destination is signed, so a payout can never be
 *  redirected after the fact. */
export function runeExitMessage(network: string, from: string, runeId: string, amount: bigint, l1Address: string, nonce: number): string {
  return `kray-core.rune-exit.v1|net=${network}|from=${from}|rune=${runeId}|amount=${amount}|to=${l1Address}|nonce=${nonce}`
}

/** Canonical RUNE-CANCEL message — withdraw an open exit; the locked credits
 *  return untouched. No amount field: an address holds at most ONE open exit
 *  per rune, so (from, rune, nonce) names the lock unambiguously. */
export function runeCancelMessage(network: string, from: string, runeId: string, nonce: number): string {
  return `kray-core.rune-cancel.v1|net=${network}|from=${from}|rune=${runeId}|nonce=${nonce}`
}

/** AMM add (empty pool = create). Amounts are atomic base units — never display. */
export function ammAddMessage(network: string, from: string, runeId: string, krayIn: bigint, runeIn: bigint, minLp: bigint, nonce: number): string {
  return `kray-core.amm-add.v1|net=${network}|from=${from}|rune=${runeId}|kray=${krayIn}|runeIn=${runeIn}|minLp=${minLp}|nonce=${nonce}`
}

export function ammRemoveMessage(network: string, from: string, runeId: string, lp: bigint, minKrayOut: bigint, minRuneOut: bigint, nonce: number): string {
  return `kray-core.amm-remove.v1|net=${network}|from=${from}|rune=${runeId}|lp=${lp}|minKray=${minKrayOut}|minRune=${minRuneOut}|nonce=${nonce}`
}

/** side=kray → amountIn is ₭; side=rune → amountIn is the rune's base units. */
export function ammSwapMessage(network: string, from: string, runeId: string, side: 'kray' | 'rune', amountIn: bigint, minOut: bigint, nonce: number): string {
  return `kray-core.amm-swap.v1|net=${network}|from=${from}|rune=${runeId}|side=${side}|in=${amountIn}|minOut=${minOut}|nonce=${nonce}`
}

/** Rune/rune add. `a`/`b` are the ordered pair; amounts are that side's base units. */
export function ammRrAddMessage(network: string, from: string, a: string, b: string, aIn: bigint, bIn: bigint, minLp: bigint, nonce: number): string {
  return `kray-core.amm-rr-add.v1|net=${network}|from=${from}|a=${a}|b=${b}|aIn=${aIn}|bIn=${bIn}|minLp=${minLp}|nonce=${nonce}`
}

export function ammRrRemoveMessage(network: string, from: string, a: string, b: string, lp: bigint, minA: bigint, minB: bigint, nonce: number): string {
  return `kray-core.amm-rr-remove.v1|net=${network}|from=${from}|a=${a}|b=${b}|lp=${lp}|minA=${minA}|minB=${minB}|nonce=${nonce}`
}

/** pay is the canonical id of the rune spent. */
export function ammRrSwapMessage(network: string, from: string, a: string, b: string, pay: string, amountIn: bigint, minOut: bigint, nonce: number): string {
  return `kray-core.amm-rr-swap.v1|net=${network}|from=${from}|a=${a}|b=${b}|pay=${pay}|in=${amountIn}|minOut=${minOut}|nonce=${nonce}`
}

/**
 * Canonical BRIDGE-LINK message — a citizen binding its Bitcoin L1 rune to its
 * KRAY identity. This is the ONLY thing that distinguishes one validator from
 * another: not a class, not an invitation, not a list somebody curates — a
 * signed claim over a rune that already exists on Bitcoin, which anyone can
 * check against the L1 etch. Everyone mines by the same law; some also settle a
 * rune's vacuum here, and say so with a signature.
 */
export function bridgeLinkMessage(network: string, address: string, rune: string, runeId: string, vault: string): string {
  return `kray-core.bridge-link.v1|net=${network}|addr=${address}|rune=${rune}|id=${runeId}|vault=${vault}`
}

/**
 * Canonical ORIGIN message — a citizen's SIGNED consent to bind their Bitcoin L1
 * Ordinals inscription to a KRAY star. It proves WHO consented; the inscription's
 * existence and content are proven separately from Bitcoin bytes. The L1 id, the
 * star and the content hash are all signed, so none can be swapped after the
 * fact. What binds an L1 provenance to a star is a signature, exactly as nothing
 * else in this network moves without one. EVERY field the binding seals is signed
 * — the L1 id, the star, the content hash, the content type, the size and the
 * nonce — so none is wire-mutable after signing, exactly as an inscription signs
 * all of its own.
 */
export function originMessage(network: string, address: string, l1InscriptionId: string, star: bigint, contentHash: string, contentType: string, size: number, nonce: number): string {
  return `kray-core.origin.v1|net=${network}|addr=${address}|ins=${l1InscriptionId}|star=${star}|content=${contentHash}|type=${contentType}|size=${size}|nonce=${nonce}`
}

/** Canonical WORK-CLAIM message — the guardian's own signed statement of the
 *  presence it is paid for: the span base, the last block the claim covers,
 *  the scalar work, and the presence bitmap over exactly that window (hex,
 *  LAST — unambiguous). What nobody signed, the law never pays. */
export function workClaimMessage(network: string, address: string, fromBlock: number, upToBlock: number, work: bigint, presenceHex: string, custodyHex?: string): string {
  const base = `kray-core.work-claim.v1|net=${network}|addr=${address}|from=${fromBlock}|upto=${upToBlock}|work=${work}|presence=${presenceHex}`
  // custody rides LAST and only when claimed: a guardian that proves the atlas
  // signs its proof together with its presence, so the two can never be split
  // apart — and a pre-custody signature stays valid exactly as it was.
  return custodyHex === undefined ? base : `${base}|custody=${custodyHex}`
}

/**
 * Verify a KrayWallet signature: BIP-340 Schnorr over SHA256(utf8(message)),
 * bound to `address` by re-deriving p2tr(internalKey). The internal x-only key
 * MUST be supplied (the bech32m address holds only the tweaked output key).
 * Fail-closed: every malformed-input path returns false, never throws.
 */
export function verifyKrayWallet(address: string, message: string, signatureHex: string, publicKeyHex: string | undefined, net: BtcNet): boolean {
  if (!/^[0-9a-fA-F]{128}$/.test(signatureHex)) return false // exactly 64 bytes; rejects the 65-byte case + garbage
  if (!publicKeyHex) return false
  try {
    let decoded: { type: string; pubkey?: Uint8Array }
    try {
      decoded = btc.Address(NETWORKS[net]).decode(address) as typeof decoded
    } catch {
      return false // address does not decode on this network
    }
    if (decoded.type !== 'tr' || !decoded.pubkey) return false
    const raw = hexToBytes(publicKeyHex)
    // a 33-byte key MUST be a real compressed point (0x02/0x03). Without this, an
    // attacker-chosen prefix (e.g. 0xff) slices to the same x-only and still
    // verifies, but the full 33-byte string is what a guardian opt-in seals as the
    // vault key — junk that later bricks vault derivation for the whole federation.
    if (raw.length === 33 && raw[0] !== 0x02 && raw[0] !== 0x03) return false
    const xonly = raw.length === 33 ? raw.slice(1) : raw
    if (xonly.length !== 32) return false
    // anti-spoof binding: the INTERNAL key must re-derive to exactly this address
    if (btc.p2tr(xonly, undefined, NETWORKS[net]).address !== address) return false
    const digest = sha256(utf8(message)) // the Kray digest: plain single SHA-256, NOT tagged, NOT a tx sighash
    return schnorr.verify(hexToBytes(signatureHex), digest, xonly)
  } catch {
    return false
  }
}

/** Verify `signatureHex` over `message` for `address` under `scheme` on `net`. Fail-closed. */
export function verifySignature(address: string, message: string, signatureHex: string, publicKeyHex: string | undefined, scheme: SchemeId, net: BtcNet): boolean {
  if (!isSupportedScheme(scheme)) return false
  if (scheme === 'kraywallet') return verifyKrayWallet(address, message, signatureHex, publicKeyHex, net)
  // POST-QUANTUM (FIPS-204 ML-DSA) — the many-time quantum-safe scheme. Additive: existing kraywallet accounts
  // are untouched; an account signing with ml-dsa has a `kq1…` address bound to SHA-256(its ML-DSA key).
  if (scheme === 'ml-dsa') return verifyMldsa(address, message, signatureHex, publicKeyHex, net)
  return false
}

// ── test-only signers (NEVER on a production path — the node only ever verifies) ──
export interface KeyPair { secretKey: Uint8Array; publicKeyHex: string }

/** A fresh secp256k1 keypair with its x-only internal public key (like KrayWallet). */
export function _generateKeyPair(secret: Uint8Array): KeyPair {
  const xonly = schnorr.getPublicKey(secret)
  return { secretKey: secret, publicKeyHex: bytesToHex(xonly) }
}

/** Sign the KrayWallet way: BIP-340 Schnorr over SHA256(utf8(message)). Returns 64-byte hex. */
export function _signKrayWallet(message: string, secret: Uint8Array): string {
  return bytesToHex(schnorr.sign(sha256(utf8(message)), secret))
}

export { bytesToHex as _bytesToHex, hexToBytes as _hexToBytes }
