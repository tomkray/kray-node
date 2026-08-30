/**
 * THE KRAYNET NODE SERVER — the proven network, served.
 *
 * The one HTTP server for KRAYNET (fungible ₭ + born-from-fire stars + proof-of-donation):
 * it serves BOTH the JSON API and the rich explorer HTML pages (apps/kray-net/*.html), all
 * on the one engine. The KrayWallet KRAYNET tab talks to this. There is no other server.
 *
 *   Reads : /api/kraynet/head · /profile/<addr> · /account/<addr> · /star/<n> · /supply ·
 *           /pot · /overview · /runes/of/<addr> (stub until the capability migration)
 *   Writes: /api/kraynet/prepare  → the exact canonical message the wallet must sign
 *           /api/kraynet/submit   → verify the signature (in the reducer) and append
 *           /api/kraynet/donate    → the proof-of-donation mint (dev: sats given; SPV later)
 *
 * Every write goes through KrayNode → LedgerStore → the reducer, so the Supreme Law and
 * every economic law are enforced before a byte hits disk, and a reboot re-derives exactly.
 *   PORT: env KRAY_PORT or 4477      DATA: env KRAY_DATA or ./data-lab (./data-signet · ./data-main)
 */
import { createServer, request as httpRequest } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync, openSync, writeSync, readSync, fsyncSync, closeSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { KrayNode } from '../kray-core/src/protocol/node.ts'
import { KrayLedger } from '../kray-core/src/protocol/ledger.ts'   // genesis root + Fireborn F (rank / lights)
import { openKrayLedger } from '../kray-core/src/protocol/store.ts'   // private replay twins MUST share the live store's pins
import { finalityView } from '../kray-core/src/protocol/finality.ts'   // ADR-4 4a: the pure crane+anchor classifier (server feeds the bitcoind-attested hint)
import { WINDOW_PER_SEAL_SATS } from '../kray-core/src/protocol/pot.ts'
import { BYTES_PER_KRAY_BURN, BYTES_PER_KRAY_PROPORTION, BYTES_PER_KRAY_MIN, BYTES_PER_KRAY_MIN_PROPORTION, RETARGET_WINDOW_SEALS, SIZE_PROPORTION_ACTIVATION_SEQ, starBurnOf, retargetBytesPerKray, donationProofMinConf } from '../kray-core/src/protocol/kray-primitives.ts'
import {
  transferMessage, burnMessage, sendStarMessage, starListMessage, starDelistMessage, starBuyMessage, starOfferMessage, starOfferCancelMessage, starOfferAcceptMessage, xSendMessage, cutSendMessage, laneEnterMessage, laneExitMessage, foldSealMessage, inscribeMessageV2, nameMessageV2, originMessageV2,
  inscribeMessageV3, inscribeMessageV4, inscribeMessageV5, inscribeMessageV6, originCohortRootOf, originChildBindOf,
  assertInscriptionMeta, INSCRIBE_META_MAX,
  MAX_PARENTS_PER_ACT, MAX_ORIGINS_PER_ACT, ORDINAL_ID_RE,
  runeSendMessage, runeExitMessage, runeCancelMessage, ammAddMessage, ammRemoveMessage, ammSwapMessage, ammRrAddMessage, ammRrRemoveMessage, ammRrSwapMessage, quantumCommitMessage, contractMessage, contractMessageV2, contractCallMessage, contractCallMessageV2, scriptOfAddress, toBtcNet, normalizeAddr, verifySignature, addressOf,
  _generateKeyPair, isAddressOnNetwork, isSupportedScheme,
} from '../kray-core/src/protocol/scheme.ts'
import { tkFoldSendMessage, parseLaneAmount } from '../kray-core/src/protocol/tk-fold.ts'   // THE LANE DOOR: the fold's own signing domain
import { orderWindow, keyFromSignedMessage } from '../kray-core/src/protocol/window-order.ts'   // THE SAME-INSTANT GATE: the objective order
import { signedBytesOfEvent } from '../kray-core/src/protocol/signed-message.ts'   // the MIRROR the reducer's referee re-proves on every apply
import { verifyCensorshipAnchored } from '../kray-core/src/protocol/censorship-evidence.ts'   // ADR-3 3d — evidence door, no journal write
import { verifyBeat, BEAT_MIN_ZEROS } from '../kray-core/src/economics/beat-pow.ts'
import { BEAT_PAY_ZEROS_CAP, readPresenceTip } from '../kray-core/src/economics/presence-window.ts'
import { verifyCustody, custodyFromHex, custodyChallenges, hitCount, CUSTODY_CHALLENGES } from '../kray-core/src/economics/custody.ts'
import { settleFromBeats } from '../kray-core/src/economics/settlement.ts'
import { sha256hex, TREASURY, BLACK_HOLE, STAR_OFFER } from '../kray-core/src/protocol/kray-primitives.ts'
import { readName, categoryOf, CATEGORIES } from '../kray-core/src/protocol/library.ts'
import { id3TagTotalLength, readApic, READ_MIMES } from './id3-cover.js'
import { bodyHashOf } from './body-hash.js'
import { isValidName } from '../kray-core/src/protocol/star-lore.ts'
import { buildMerkleRoot, blockHash } from '../kray-core/src/protocol/block.ts'
import { KrayAnchor } from '../kray-core/src/anchor/anchor.ts'
import { certificateDoor, certificateOrRefuse } from '../kray-core/src/anchor/paid-binding.ts'
import { verifyDonationProof, proveTxBuried, MIN_BLOCK_WORK, donorOpReturnScriptHex, parseHeader, parseTx, verifySealProof } from '../kray-core/src/anchor/spv.ts'
import { AnchorPool, DEFAULT_REWARD } from '../kray-core/src/economics/anchor-pool.ts'
import { verifyRuneMovement } from '../kray-core/src/protocol/rune-bridge.ts'
import { parentCanHoldFocusedRune } from '../kray-core/src/protocol/rune-ancestry.ts'
import { buildDonationPsbt, buildSelfAnchorDonationPsbt } from '../kray-core/src/protocol/donate-psbt.ts'
import { selfAnchorScriptHex, addressFromOutputKey, BURN_INTERNAL_KEY } from '../kray-core/src/protocol/self-anchor.ts'
import { buildBtcSendPsbt, buildInscriptionSendPsbt, buildRuneSendPsbt, feeSatsAtRate } from '../kray-core/src/protocol/wallet-psbt.ts'
import { decipher, runeName, spacedRuneName } from '../kray-core/src/protocol/runestone.ts'
import { parseRuneKey, canonicalRuneKey } from '../kray-core/src/economics/rune-book.ts'
import { rrPairKey, isAmmPotAddress, ammPoolAddress, ammRrPoolAddress, parseAmmPotAddress } from '../kray-core/src/protocol/amm.ts'
import { deriveVault, toXOnly, VAULT_TIMELOCK_BLOCKS as VAULT_TIMELOCK_BLOCKS_SRV } from '../kray-core/src/protocol/vault.ts'
import { auditVaultSpend } from '../kray-core/src/protocol/vault-spend.ts'
import { validateWatch, markReleased, sweep as vaultWatchSweep } from '../kray-core/src/protocol/vault-watch.ts'
import { auditSettlementSafety, batchRunestoneFits } from '../kray-core/src/protocol/vault-settlement.ts'
import { buildExitPayout, extractWalletSignatures, finalizeExitPayout, signVaultSighash } from '../kray-core/src/protocol/exit-payout.ts'
import { selectRuneCoins } from '../kray-core/src/protocol/pot-coin-select.ts'
import { buildPotSettlement } from '../kray-core/src/protocol/pot-settlement.ts'
import { openExitSeq } from '../kray-core/src/protocol/sealed-spend.ts'
import { authorizePotSign, mergeGuardianShares, decideGuardianQuorum, planToWire } from '../kray-core/src/protocol/pot-signer.ts'
import { dustFromEnv } from '../kray-core/src/protocol/dust.ts'
import { creditOfPotDeposit } from '../kray-core/src/protocol/pot-deposit.ts'
import { inscriptionAtLoose } from '../kray-core/src/protocol/inscription.ts'
import { krayOutspendGate, kraySatpointGate, liveHolderGate, parseOriginProofs, parseSatpoint, satHopBack, verifyOriginProofs } from '../kray-core/src/protocol/ordinal-ancestry.ts'
import { validateContract, canonicalCode, contractAddress, isContractPotAddress } from '../kray-core/src/protocol/contract.ts'
import { examContract, parseExamSource } from '../kray-core/src/protocol/contract-exam.ts'
import { speakMessage, parseSpeakMessage, readAudience, verifySpeak, speakId, SPEAK_TTL_SEC } from '../kray-core/src/protocol/star-speak.ts'
import { compileLivingLaw, callerInt } from '../kray-core/src/protocol/star-law.ts'
import { compileForm, requireMintShelf, resolveMintShelf, isCutPaper } from '../kray-core/src/protocol/star-forms.ts'
import { packNodeTree, nodeVersionView } from './node-pack.mjs'
import { docsPack, docsFile } from './docs-pack.mjs'
import { defaultDataDirName, applyWriterIsolationOrDie } from './network-boot.mjs'
import { potSignerHoles, potSignerConfigured, assertPotSignerLoopback, choosePotSignerHole } from './pot-signer-holes.mjs'
import { createInbox } from './inbox.mjs'
import { createPeerBook, isPublicHttpHost } from './peer-book.mjs'
import { gossipTick } from './gossip.mjs'
import { boundedJson } from './bounded-fetch.mjs'
import { chunkJournal, chunkAddress, DEFAULT_CHUNK_SIZE } from '../kray-core/src/protocol/journal-chunks.ts'
import { frozenStarGlow, glowOf, GLOW_SYMBOL } from '../kray-core/src/economics/glow-star.ts'  // ✦ the frozen-star light (soulbound)
import { lightsView as foldLights } from './state-views.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dir, '..', '..')
const PORT = parseInt(process.env.KRAY_PORT || '4477', 10) || 4477
// Bind: default all interfaces (home lab). A Funnel/public node MUST set KRAY_BIND=127.0.0.1
// so LAN/Tailscale cannot hit the API except through the HTTPS proxy. KRAY_PUBLIC=1 also
// hides the local-wallet L1 scanners (CPU/DoS against bitcoind) — testers use the explorer, not those.
const BIND = process.env.KRAY_BIND || '0.0.0.0'
const PUBLIC = process.env.KRAY_PUBLIC === '1'
// Public Funnel node: these hit local bitcoind (broadcast / scantxoutset / finalize). Testers
// broadcast from their own wallet. Local DevNet (KRAY_PUBLIC unset) keeps the L1 proxy.
const PUBLIC_L1_OFF = new Set([
  '/api/wallet/broadcast',
  '/api/psbt/broadcast',
  '/api/kraywallet/finalize-psbt',
  '/api/kraywallet/build-send-psbt',
  '/api/kraywallet/build-send-inscription-psbt',
  '/api/runes/build-send-psbt',
])
const _postHitsIp = new Map()
let _postHitsGlobal = { t: 0, n: 0 }
const _regtestFaucetAt = new Map()
const _walletGetHitsIp = new Map()
// THE PROXY-TRUST LINCHPIN — a forwarded-for header is only as honest as the peer that set it.
// A public node MUST sit behind a proxy (Cloudflare tunnel → this origin on loopback); the tunnel
// is the ONLY peer allowed to speak for a remote client. If a stranger reaches the origin directly
// (KRAY_BIND left at 0.0.0.0, no firewall), their socket peer is NOT loopback, so we IGNORE every
// forwarded header and rate-limit by their real TCP address — a spoofed CF-Connecting-IP buys them
// nothing. KRAY_TRUST_PROXY_CIDRS may add non-loopback proxy peers (e.g. a docker gateway).
const TRUST_PROXY_EXTRA = String(process.env.KRAY_TRUST_PROXY_CIDRS || '').split(',').map((s) => s.trim()).filter(Boolean)

// ── PEER DISCOVERY (ADR-2 · 2c-wire) — the node learns where the journal lives and publishes what it learned.
// KRAY_PEERS seeds the book (comma-separated URLs); KRAY_SELF_URL is this node's own public URL, never
// discovered (a node does not gossip itself). Both are plain config, no secret. A head/peers gossip payload is
// tiny, so the fetch is bounded HARD (a "head" of 64MB is an attack) — much tighter than the chunk pull.
const PEER_SEED = String(process.env.KRAY_PEERS || '').split(',').map((s) => s.trim()).filter(Boolean)
const SELF_URL = String(process.env.KRAY_SELF_URL || '').trim()
const GOSSIP_ON = PEER_SEED.length > 0 || process.env.KRAY_GOSSIP === '1'
const GOSSIP_INTERVAL_MS = Math.max(parseInt(process.env.KRAY_GOSSIP_INTERVAL_MS || '30000', 10) || 30000, 5000)
const GOSSIP_FETCH_TIMEOUT_MS = 5000
const GOSSIP_MAX_BYTES = 256 * 1024   // a head is 64 hex + a little JSON; a /peers list is a few KB — 256KB is generous
const peerBook = createPeerBook({ maxPeers: 64, self: SELF_URL })
peerBook.addMany(PEER_SEED)
const gossipFetchJson = (url) => boundedJson(url, { timeoutMs: GOSSIP_FETCH_TIMEOUT_MS, maxBytes: GOSSIP_MAX_BYTES })
function peerIsTrustedProxy(req) {
  const peer = String(req.socket?.remoteAddress || '')
  if (peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1') return true
  return TRUST_PROXY_EXTRA.some((cidr) => peer === cidr || peer.startsWith(cidr))
}
function publicClientIp(req) {
  // Only a TRUSTED proxy peer may name the real client; athe owner boxe else is judged by their own socket.
  if (peerIsTrustedProxy(req)) {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim()
    if (cf) return cf
    const real = String(req.headers['x-real-ip'] || '').trim()
    if (real) return real
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (xff[0]) return xff[0]
  }
  return req.socket?.remoteAddress || 'x'
}
function publicPostFlood(req) {
  if (!PUBLIC) return false
  const now = Date.now()
  if (now - _postHitsGlobal.t > 60_000) _postHitsGlobal = { t: now, n: 0 }
  _postHitsGlobal.n++
  if (_postHitsGlobal.n > 600) return true
  const ip = publicClientIp(req)
  let b = _postHitsIp.get(ip)
  if (!b || now - b.t > 60_000) { b = { t: now, n: 0 }; _postHitsIp.set(ip, b) }
  b.n++
  return b.n > 120
}
let _walletGetHitsGlobal = { t: 0, n: 0 }
function publicWalletGetFlood(req) {
  if (!PUBLIC) return false
  const now = Date.now()
  // a global ceiling too (parity with publicPostFlood) so a flood of spoof-free distinct IPs
  // still cannot pin the node's L1 scanners — checked BEFORE the per-IP bucket is grown
  if (now - _walletGetHitsGlobal.t > 60_000) _walletGetHitsGlobal = { t: now, n: 0 }
  _walletGetHitsGlobal.n++
  if (_walletGetHitsGlobal.n > 1200) return true
  const ip = publicClientIp(req)
  let b = _walletGetHitsIp.get(ip)
  if (!b || now - b.t > 60_000) { b = { t: now, n: 0 }; _walletGetHitsIp.set(ip, b) }
  b.n++
  return b.n > 60
}
// THE REAPER for the rate-limit ledgers — every bucket is inert once its window passes, so a public
// node facing the whole internet (or spoofed distinct IPs) never grows these maps toward OOM. Prunes
// on the same cadence the windows expire; unref'd so it never holds the process open.
setInterval(() => {
  const now = Date.now()
  for (const [ip, b] of _postHitsIp) if (now - b.t > 60_000) _postHitsIp.delete(ip)
  for (const [ip, b] of _walletGetHitsIp) if (now - b.t > 60_000) _walletGetHitsIp.delete(ip)
  for (const [ip, t] of _regtestFaucetAt) if (now - t > 60_000) _regtestFaucetAt.delete(ip)
}, 60_000).unref?.()
// THE NETWORK NAME, CANONICALIZED AT BIRTH — toBtcNet treats 'mainnet'/'bitcoin' as aliases of
// 'main', so an operator writing the natural word KRAY_NET=mainnet would run a TRUE mainnet node
// while every raw `NET !== 'main'` comparison (the DEV_SHORTCUTS gate above all) still thought it
// was a bench. One normalization here makes every downstream comparison alias-proof forever.
const NET_INPUT = process.env.KRAY_NET || 'regtest'
const NET = NET_INPUT === 'mainnet' || NET_INPUT === 'bitcoin' ? 'main' : NET_INPUT
// …and a typo'd network fail-stops at birth (fail-closed, named): a node that boots as network
// "regtst" would verify NOTHING correctly while looking alive — refuse to exist instead.
if (!['main', 'signet', 'testnet', 'regtest'].includes(NET)) {
  console.error(`KRAY_NET="${NET_INPUT}" is not a network this node knows (main|mainnet|signet|testnet|regtest) — refusing to boot as a ghost chain`)
  process.exit(1)
}
const DATA_DIR = process.env.KRAY_DATA || join(__dir, defaultDataDirName(NET))
// Shareable lab aliases: the address bar keeps /signet or /regtest.
// Same-network paths are rewritten in-process (no 302). On the Funnel host (signet :443)
// /regtest is proxied to the local regtest node so the URL does not jump to :4477.
const LAB_SIGNET_URL = (process.env.KRAY_LAB_SIGNET_URL || '').replace(/\/$/, '')
const LAB_REGTEST_URL = (process.env.KRAY_LAB_REGTEST_URL || '').replace(/\/$/, '')
function labVanity(pathname) {
  const layers = [
    { name: 'signet', prefix: '/signet', home: LAB_SIGNET_URL },
    { name: 'regtest', prefix: '/regtest', home: LAB_REGTEST_URL },
  ]
  for (const layer of layers) {
    if (pathname !== layer.prefix && !pathname.startsWith(layer.prefix + '/')) continue
    const rest = (pathname === layer.prefix || pathname === layer.prefix + '/') ? '/' : pathname.slice(layer.prefix.length)
    if (NET === layer.name) return { rewrite: rest }
    if (NET === 'signet' && layer.name === 'regtest') return { proxyPort: 4477, rewrite: rest }
    if (layer.home) return { location: layer.home + (rest === '/' ? layer.prefix : layer.prefix + rest) }
    return { miss: true }
  }
  return null
}
function labReferer(req) {
  const raw = req.headers.referer || req.headers.referrer || ''
  try {
    const path = new URL(raw).pathname
    if (path === '/regtest' || path.startsWith('/regtest/')) return 'regtest'
    if (path === '/signet' || path.startsWith('/signet/')) return 'signet'
  } catch { /* no referer — stay on this node */ }
  return null
}
function proxyToLocal(req, res, port, destPath) {
  if (port !== 4477 && port !== 4478) return err(res, 500, 'refusing to proxy off the lab pair')
  const headers = { ...req.headers, host: '127.0.0.1:' + port }
  delete headers.connection
  delete headers['keep-alive']
  delete headers['transfer-encoding']
  const pReq = httpRequest({ hostname: '127.0.0.1', port, path: destPath, method: req.method, headers }, (pRes) => {
    // never let a Referer-routed response be shared-cached under the WRONG network's origin —
    // force it uncacheable and Vary on Referer (the header that chose which sibling answered)
    const outHeaders = { ...pRes.headers, 'cache-control': 'no-store', vary: 'Referer' }
    res.writeHead(pRes.statusCode || 502, outHeaders)
    pRes.pipe(res)
  })
  pReq.on('error', () => { if (!res.headersSent) err(res, 502, 'lab sibling unreachable') })
  req.pipe(pReq)
}

// ── PROOF-OF-DONATION config — the anchoring pot's Bitcoin address ──────────────
// A donation is a REAL payment to this Taproot address, committing the donor's KRAY
// address in an OP_RETURN, SPV-proven before it mints (credited once per outpoint).
// KRAY_POT_ADDRESS set ⇒ the node can verify proofs. Whether the dev {to, sats} shortcut is
// disabled (only a proof mints) is now governed by KRAY_TRUSTED_DEV below (closed by default).
// THE SOFTWARE VERSION — read once from the repo root package.json and exposed on /head as `v`, so
// any house (guardian, follower, stranger) verifies the same-commit law with a curl. Versions the
// SOFTWARE only; the protocol is versioned by its flags and activation seqs, never by this string.
const NODE_VERSION = (() => {
  try { return JSON.parse(readFileSync(join(__dir, '..', '..', 'package.json'), 'utf8')).version || '0.0.0' }
  catch { return '0.0.0' }
})()
const POT_ADDRESS = process.env.KRAY_POT_ADDRESS || null
const POT_SCRIPT_HEX = POT_ADDRESS ? scriptOfAddress(POT_ADDRESS, toBtcNet(NET)) : null
// ADR-4 slice 4c — the door's ingress gate is UN-LOWERABLE below the per-network consensus floor: it may
// demand MORE confirmations than the chain rule, never fewer. So on main it captures + requires >= 6 (Bitcoin's
// customary settlement), matching the reducer's donationProofMinConf — one atemporal ruler, one source of truth.
const DONATION_MIN_CONF = Math.max(parseInt(process.env.KRAY_DONATION_CONF || '2', 10) || 2, donationProofMinConf(toBtcNet(NET)))
// ── SELF-ANCHORING DONATIONS — same door on Signet and main.
// KRAY_SELF_ANCHOR=1 + KRAY_POT_INTERNAL_KEY = BIP-341 NUMS (BURN_INTERNAL_KEY): the donation
// pays that key tweaked by the cascade root. Sats are destroyed; the output IS the anchor.
// A non-NUMS internal key is reserve/custody (follower weight-zero). Never pin the vault key here.
const SELF_ANCHOR = process.env.KRAY_SELF_ANCHOR === '1'
const _rawPotKey = (process.env.KRAY_POT_INTERNAL_KEY || '').toLowerCase()
const POT_INTERNAL_KEY = /^0[23][0-9a-f]{64}$/.test(_rawPotKey) ? _rawPotKey.slice(2) : (/^[0-9a-f]{64}$/.test(_rawPotKey) ? _rawPotKey : null)
// V3 · THE MAINNET BURN GATE, in the door binary itself (start-mainnet-writer.mjs already dies on this;
// this makes the law hold even if the server is started any other way). On Bitcoin MAINNET a configured
// pot internal key MUST be the BIP-341 NUMS point: a spendable key here would turn "donations are burned
// forever" into someone's custody — the exact lie V1 taught the wallet to refuse. A follower that sets no
// key boots exactly as before (the gate fires only on a PRESENT, non-NUMS key).
if (NET === 'main' && POT_INTERNAL_KEY && POT_INTERNAL_KEY !== BURN_INTERNAL_KEY) {
  console.error('✗ KRAY_POT_INTERNAL_KEY on mainnet must be the BIP-341 NUMS point (' + BURN_INTERNAL_KEY + ') — a spendable key would make "burned" donations someone\'s custody. Refusing to boot.')
  process.exit(1)
}
const selfAnchorReady = () => SELF_ANCHOR && !!POT_INTERNAL_KEY
// THE DEV-TRUST GATE — a few endpoints accept an already-proven table/fields directly instead of
// re-proving them (the validator work table, a rune deposit's fields). That trust is safe ONLY on a
// throwaway dev node. On any value-bearing node this MUST be off, so those endpoints refuse a client
// body and demand the real proof/derivation. Default OFF — a production node is safe out of the box.
const TRUSTED_DEV = process.env.KRAY_TRUSTED_DEV === '1'
// Supreme Law: a mis-set env var must NEVER mint, credit runes, or sweep the fee pool on Bitcoin
// mainnet. Origin already double-gates (flag ∧ regtest). Donate / rune-deposit / settle now refuse
// `main` even if KRAY_TRUSTED_DEV=1. Regtest/signet benches keep the fixture; production cannot.
// PUBLIC × DEV COUPLING — the proofless {to,sats} mint is a faucet ONLY on a throwaway public
// regtest (₭ there is play-money). On a public SIGNET node (a real staging tier where ₭ is meant
// to be donation-proven from real signet sats) the dev mint is refused STRUCTURALLY, not by trust:
// a mis-set KRAY_TRUSTED_DEV can never open free minting to the internet on anything but regtest.
const DEV_SHORTCUTS = TRUSTED_DEV && NET !== 'main' && !(PUBLIC && NET !== 'regtest')
// ── ADR-3 · slice 3b — THE PUBLIC INBOX (ratified 2026-08-19). A mailbox of signed acts: an act a
// citizen signed survives a writer outage on any node that heard it. NOT a second door — every
// drained act re-enters through the ONE public `/api/kraynet/submit` on loopback, so the door's
// pre-validations and the reducer run identically. The account nonce makes a duplicate drain
// harmless. KRAY_INBOX=0 turns the mailbox off; the drain paces under the public flood budget.
const INBOX_ON = process.env.KRAY_INBOX !== '0'
const INBOX_TTL_SEC = Math.max(3600, parseInt(process.env.KRAY_INBOX_TTL_SEC || '86400', 10) || 86400)
const inbox = INBOX_ON ? createInbox({ dir: join(DATA_DIR, 'inbox') }) : null
let _inboxDraining = false
// Settle one drained act against the door's answer. `superseded` is NOT a failure: when the door
// refuses and the account's nonce has already advanced past this act's nonce, some act consumed that
// nonce — the intent is in the journal. This distinguishes "already applied (crash lost the receipt)"
// from "invalid", so a citizen polling the outcome is never told a journaled act was refused.
function settleDrainOutcome(id, act, r, out) {
  if (r.ok && out && out.ok) { inbox.markApplied(id, { seq: out.seq, hash: out.hash, star: out.star ?? null }); return 'applied' }
  const n = Number(act && act.nonce)
  if (Number.isInteger(n) && act && typeof act.from === 'string') {
    try { if (node.ledger.nonceOf(String(act.from)) > n) { inbox.markSuperseded(id, (out && out.error) || 'nonce already advanced'); return 'superseded' } } catch { /* no ledger view — fall through to a plain attempt */ }
  }
  inbox.markAttempt(id, (out && out.error) || `HTTP ${r.status}`)
  return 'attempt'
}
async function drainInbox(limit = 30) {
  if (!inbox || _inboxDraining) return { drained: 0 }
  _inboxDraining = true
  let applied = 0
  try {
    inbox.sweep(INBOX_TTL_SEC)
    for (const env of inbox.pending(limit)) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/api/kraynet/submit`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(env.act),
        })
        const out = await r.json().catch(() => ({}))
        if (settleDrainOutcome(env.id, env.act, r, out) === 'applied') applied++
      } catch (e) { inbox.markAttempt(env.id, e instanceof Error ? e.message : String(e)) }
      await new Promise((tick) => setTimeout(tick, 250))   // pace: ~4 acts/s, far under the public flood budget
    }
  } finally { _inboxDraining = false }
  return { drained: applied }
}

// Env polarity: "1"/"true" on, "0"/"false" off, unset → defaultOn.
// Signet burn-in (2026-08-17) sealed the polarity: unset = ON on every network,
// including main. Force 0 only to replay a proofless or hostage past.
function envFlag(name, defaultOn) {
  const v = (process.env[name] || '').trim()
  if (v === '1' || /^true$/i.test(v)) return true
  if (v === '0' || /^false$/i.test(v)) return false
  return !!defaultOn
}
// ADR-1 · when on, a real donation journals its SPV PROOF so the reducer re-verifies the burn on
// replay (the peg becomes a theorem, not the operator's word). Self-anchor donations pay a
// per-donation script, so only the PLAIN-pot proof is sent here.
const CONSENSUS_BURN_PROOF = envFlag('KRAY_CONSENSUS_BURN_PROOF', true)
// ADR-1 extended · SELF-ANCHOR proofs in consensus — when on, a self-anchoring donation journals its
// SPV proof + the sealed (anchorBlock, anchorRoot), and the reducer RE-DERIVES the tweaked script
// from the pot internal key and re-proves the burn on every replay. DEFAULT ON since the twin
// rebirth (2026-08-28): signet and main restart at seq 0 on THIS commit, so the old worry — a
// replayer on OLDER code verifying the seal proof against the FIXED pot script and HALTing — is
// void (the same-commit law is satisfied by the rebirth itself). It also became LOAD-BEARING:
// the reducer is born strict (PROOF_MANDATORY_SEQ 0 on signet/main), so a self-anchor donation
// whose proof did NOT ride would be refused in consensus — the flag ON is what lets the keyless
// burn mint at all. Force 0 only on a bench replaying a pre-seal journal.
const CONSENSUS_SELF_ANCHOR_PROOF = envFlag('KRAY_CONSENSUS_SELF_ANCHOR_PROOF', true)
// PROOF MANDATORY, MIRRORED AT THE DOOR (twin rebirth) — on signet/main the REDUCER refuses any
// L1-peg event that does not embed its SPV proof (PROOF_MANDATORY_SEQ = 0, ledger.ts). Journaling
// a doomed event helps nobody: when a flag forced =0 means the proof cannot ride, the door refuses
// FIRST with a named reason (the donor's txid stays redeemable on a correctly configured node —
// credited-once by outpoint, never lost). regtest, and a TRUSTED_DEV signet bench that lifted
// KRAY_LAB_PROOF_MANDATORY_SEQ (store.ts, the one named exception), keep the old door.
const PROOF_MANDATORY_LIVE = NET !== 'regtest' && !(TRUSTED_DEV && NET === 'signet' && process.env.KRAY_LAB_PROOF_MANDATORY_SEQ)
// ADR-1 extended to the RUNE peg · when on, a proven rune deposit/settle journals its SPV proof
// (+ the vault params and ord-attested input runes) so the reducer re-verifies the peg on every
// replay. Same polarity as the burn proof.
const CONSENSUS_RUNE_PROOF = envFlag('KRAY_CONSENSUS_RUNE_PROOF', true)
// THE KEYSTONE, MIRRORED AT THE DOOR — on signet/main the REDUCER refuses a rune-deposit whose
// proof does not embed the recursive ancestry bundle (RUNE_ANCESTRY_MANDATORY_SEQ = 0, ledger.ts),
// so the door assembles it (or refuses FIRST — journaling a doomed event helps nobody). regtest
// keeps the bench; KRAY_RUNE_ANCESTRY=1 turns the assembler on there for the lab's strict exams.
const RUNE_ANCESTRY_LIVE = NET !== 'regtest' || envFlag('KRAY_RUNE_ANCESTRY', false)
if (TRUSTED_DEV && PUBLIC && NET !== 'regtest' && NET !== 'main') {
  console.warn(`⚠ KRAY_TRUSTED_DEV=1 on a PUBLIC ${NET} node — the proofless dev mint is FORCED OFF (only a real proof-of-donation mints here). Set it only on a throwaway regtest.`)
}

// ── BITCOIN L1 RPC — the node's own eyes on the chain, so a donation or a rune deposit proves
// itself from the REAL transaction. Given a confirmed txid, the node fetches the raw tx, its BIP-37
// merkle proof, and the header + confirmations burying it — exactly what proveTxBuried needs — so
// the client sends only a txid and the node re-proves everything.
// Lab default is the local regtest bitcoind. Mainnet has no safe guess — an unset
// KRAY_BTC_RPC must not silently talk to :18454 (or Signet :38332). Isolation below
// refuses those ports and an empty URL on main.
const BTC_RPC = process.env.KRAY_BTC_RPC || (NET === 'main' ? '' : 'http://127.0.0.1:18454')
// Optional local handshake: if gitignored `devnet/rpc-credentials.txt` exists and
// no env credentials are set, read that file. Env always wins; with neither, the
// beacon stays unconfigured. A stranger sets KRAY_BTC_RPC_* themselves.
const devnetCred = (key) => {
  try {
    const txt = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'devnet', 'rpc-credentials.txt'), 'utf8')
    const m = txt.match(new RegExp(`^${key}=(.+)$`, 'm'))
    return m ? m[1].trim() : ''
  } catch { return '' }
}
const BTC_RPC_USER = process.env.KRAY_BTC_RPC_USER || devnetCred('user') || 'kraycore'
const BTC_RPC_PASS = process.env.KRAY_BTC_RPC_PASS || devnetCred('password') || ''
// the node's own funded wallet — used ONLY to pay the fee that carries the anchor OP_RETURN onto Bitcoin
// (fundrawtransaction/sign/send). It never holds or moves KRAYNET user value (donations go to the external
// pot, rune deposits to the external vault). IMPORTANT: on signet/main this MUST be a FEE-ONLY wallet — never
// one holding ordinals or runes, since anchor funding is not (yet) ordinal/rune-aware and could spend such a UTXO.
const BTC_WALLET = process.env.KRAY_BTC_WALLET || 'kray'
applyWriterIsolationOrDie({
  net: NET,
  dataDir: DATA_DIR,
  btcRpc: BTC_RPC,
  ordUrl: process.env.KRAY_ORD_URL || '',
  potAddress: POT_ADDRESS || '',
  trustedDev: TRUSTED_DEV,
})
const btcConfigured = () => !!(BTC_RPC && BTC_RPC_PASS)
// scantxoutset scans the WHOLE UTXO set — on a fully-synced node that takes far longer than a normal
// RPC (tens of seconds), so it gets its own generous timeout. Everything else stays fast-failing.
const BTC_RPC_TIMEOUT = 8000
const BTC_SCAN_TIMEOUT = parseInt(process.env.KRAY_BTC_SCAN_TIMEOUT_MS || '180000', 10) || 180000
async function btcRpcAt(url, method, params = [], timeoutMs = BTC_RPC_TIMEOUT) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${BTC_RPC_USER}:${BTC_RPC_PASS}`).toString('base64') },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'kray', method, params }),
    signal: AbortSignal.timeout(method === 'scantxoutset' ? BTC_SCAN_TIMEOUT : timeoutMs),
  }).then((x) => x.json())
  if (r.error) throw new Error(`bitcoind ${method}: ${r.error.message}`)
  return r.result
}
const btcRpc = (method, params = [], timeoutMs) => btcRpcAt(BTC_RPC, method, params, timeoutMs)
// wallet-scoped RPC (fundrawtransaction, signrawtransactionwithwallet, getnewaddress) — the anchor's fee source.
const btcWalletRpc = (method, params = [], timeoutMs) => btcRpcAt(`${BTC_RPC.replace(/\/$/, '')}/wallet/${encodeURIComponent(BTC_WALLET)}`, method, params, timeoutMs)

// OPTIONAL public-esplora backend (mempool.space and friends) — lets a node BROADCAST anchors and READ their
// confirmations WITHOUT a locally-synced bitcoind: the local wallet still signs OFFLINE (it only needs its keys,
// not the chain), and a public API supplies the UTXO, the relay, and the burial depth. The SPV math still
// re-verifies everything, so this is trustless for the proof — only the byte-delivery is delegated. Set
//   KRAY_MEMPOOL_API=https://mempool.space/signet/api  KRAY_ANCHOR_FEE_ADDR=<a wallet address holding sats>
// to self-anchor on a public chain (signet/main) in minutes instead of waiting out a full IBD.
const MEMPOOL_API = (process.env.KRAY_MEMPOOL_API || '').replace(/\/$/, '') || null
const ANCHOR_FEE_ADDR = process.env.KRAY_ANCHOR_FEE_ADDR || null
const ANCHOR_FEE_SATS = parseInt(process.env.KRAY_ANCHOR_FEE_SATS || '500', 10) || 500

// ── THE BRIDGE FEDERATION — the guardian set every rune vault is co-signed by ─────────────────────
// A depositor's vault is deriveVault({guardians, threshold, depositor: THEIR key, timelock}). The wallet
// needs the guardian set to derive its own vault (where to send runes on Bitcoin) — so the node PUBLISHES
// it (public info; the depositor can always reclaim unilaterally after the timelock regardless). Config:
//   KRAY_VAULT_GUARDIANS = comma-separated x-only (or 33-byte) guardian pubkeys
//   KRAY_VAULT_THRESHOLD = how many must co-sign a cooperative exit (default: majority)
//   KRAY_VAULT_TIMELOCK  = blocks before the unilateral self-reclaim opens (default 4320 ≈ 30 days;
//                          regtest defaults small so tests can exercise the escape)
// On regtest/signet with NO config, a DETERMINISTIC dev federation is generated (documented seeds) so the
// bench works out of the box. On MAINNET a dev federation is REFUSED — real money never rides keys nobody
// owns; the operator must configure a real guardian set.
const DEV_GUARDIAN_SEEDS = ['kray-dev-vault-guardian-0', 'kray-dev-vault-guardian-1', 'kray-dev-vault-guardian-2']
function devGuardianKeys() {
  return DEV_GUARDIAN_SEEDS.map((s) => _generateKeyPair(createHash('sha256').update(s).digest()).publicKeyHex)
}
function parseSecret32(hex, name) {
  const s = String(hex || '').trim().toLowerCase()
  if (!s) return null
  if (!/^[0-9a-f]{64}$/.test(s)) {
    console.error(`${name} is not 32-byte hex — ignored (fail-closed for that slot)`)
    return null
  }
  return Buffer.from(s, 'hex')
}
// the CONSOLIDATION vault's owner key — the shared pool a settlement routes departed runes into.
// Precedence: KRAY_CONSOLIDATION_SECRET (derive + optionally check KEY) → KEY alone (pubkey-only)
// → lab seed on non-main. Mainnet never invents a key.
function potSignerUrl() {
  return potSignerHoles(process.env).primary
}
function consolidationDepositorSecret() {
  // When a pot-signer URL is set the owner key lives in THAT process. Even if
  // this env still carries the hex, the public node must not touch it.
  if (potSignerConfigured()) return null
  const fromEnv = parseSecret32(process.env.KRAY_CONSOLIDATION_SECRET, 'KRAY_CONSOLIDATION_SECRET')
  if (fromEnv) return fromEnv
  if (NET === 'main') return null
  if ((process.env.KRAY_CONSOLIDATION_KEY || '').trim()) return null
  return createHash('sha256').update('kray-dev-consolidation-owner').digest()
}
function consolidationDepositorKey() {
  const sk = consolidationDepositorSecret()
  if (sk) {
    const derived = _generateKeyPair(sk).publicKeyHex
    const k = (process.env.KRAY_CONSOLIDATION_KEY || '').trim().toLowerCase()
    if (k) {
      try {
        if (toXOnly(k) !== derived) {
          console.error('KRAY_CONSOLIDATION_KEY does not match KRAY_CONSOLIDATION_SECRET — refusing the pot key (fail-closed)')
          return null
        }
      } catch {
        console.error('KRAY_CONSOLIDATION_KEY is not a valid pubkey — refusing the pot key (fail-closed)')
        return null
      }
    }
    return derived
  }
  const k = (process.env.KRAY_CONSOLIDATION_KEY || '').trim().toLowerCase()
  if (k) return k
  if (NET === 'main') return null
  return _generateKeyPair(createHash('sha256').update('kray-dev-consolidation-owner').digest()).publicKeyHex
}
function bridgeFederation() {
  const raw = (process.env.KRAY_VAULT_GUARDIANS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  let guardians = raw, dev = false
  if (!guardians.length) {
    if (NET === 'main') return { configured: false, guardians: [], threshold: 0, timelock: VAULT_TIMELOCK_BLOCKS_SRV, dev: false, net: NET }
    guardians = devGuardianKeys(); dev = true   // regtest/signet convenience only
  }
  const threshold = Math.max(1, Math.min(guardians.length, parseInt(process.env.KRAY_VAULT_THRESHOLD || String(Math.floor(guardians.length / 2) + 1), 10) || 1))
  const timelock = parseInt(process.env.KRAY_VAULT_TIMELOCK || (NET === 'regtest' ? '16' : String(VAULT_TIMELOCK_BLOCKS_SRV)), 10) || VAULT_TIMELOCK_BLOCKS_SRV
  return { configured: true, guardians, threshold, timelock, dev, net: NET }
}
// THE ONE canonical consolidation vault a settlement's remainder must pay — federation custody (guardians +
// the consolidation owner key), so the shared pool that backs everyone the depositor paid is provably the
// network's, not an address the depositor controls. Returns null if unconfigurable (mainnet without a key).
function consolidationVaultAddress() {
  return (consolidationVault() || {}).address || null
}
/** The shared-pool vault in full — address, script, params. Null when unconfigurable. */
function consolidationVault() {
  const fed = bridgeFederation()
  const ck = consolidationDepositorKey()
  if (!fed.configured || !ck) return null
  try {
    const v = deriveVault({ guardians: fed.guardians, threshold: fed.threshold, depositor: ck, timelock: fed.timelock, net: toBtcNet(NET) })
    return { address: v.address, scriptHex: scriptOfAddress(v.address, toBtcNet(NET)), params: v.params, depositor: ck }
  } catch { return null }
}
/** Lab guardian secrets: env hex list first, else the documented signet/regtest seeds.
 *  Mainnet never falls back to seeds — production guardians sign remotely. */
function labGuardianSecretMap() {
  const m = new Map()
  const raw = (process.env.KRAY_VAULT_GUARDIAN_SECRETS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (raw.length) {
    for (let i = 0; i < raw.length; i++) {
      const sk = parseSecret32(raw[i], `KRAY_VAULT_GUARDIAN_SECRETS[${i}]`)
      if (!sk) continue
      m.set(_generateKeyPair(sk).publicKeyHex, sk)
    }
    return m
  }
  if (NET === 'main') return m
  for (const s of DEV_GUARDIAN_SEEDS) {
    const sk = createHash('sha256').update(s).digest()
    m.set(_generateKeyPair(sk).publicKeyHex, sk)
  }
  return m
}
/** True only when this process holds enough matching secrets to meet the federation threshold.
 *  Mainnet is always false (remote guardians). Replaces the old `fed.dev` co-sign gate so a
 *  configured (non-dev) lab federation can still withdraw after seed rotation.
 *  This is the LAB fallback — not the only door. A writer with KRAY_GUARDIAN_SIGNER_URLS
 *  (the Signet go-live path) has ZERO guardian secrets on purpose; remotes co-sign. */
function canLabCosign(fed) {
  if (!fed || !fed.configured || NET === 'main') return false
  const byKey = labGuardianSecretMap()
  let n = 0
  for (const g of fed.guardians) if (byKey.has(g)) n++
  return n >= fed.threshold
}
/** Remote book-checking daemons are configured. The writer then needs no guardian secrets. */
function hasRemoteGuardians() {
  return guardianSignerUrls().length > 0
}
/** A payout may collect guardian shares: remotes (preferred) OR matching lab secrets. */
function guardianCosignReady(fed) {
  return hasRemoteGuardians() || canLabCosign(fed)
}
function guardianCosignMissing() {
  if (NET === 'main') return 'production guardians sign remotely — set KRAY_GUARDIAN_SIGNER_URLS'
  return 'no guardian path: this node has neither matching lab secrets nor remote guardian URLs'
}
function signedOpenExit(from, runeId) {
  const seq = openExitSeq(events, from, runeId)
  if (seq == null) return null
  const e = events[seq - 1]
  if (!e || e.kind !== 'rune-exit') return null
  return e
}
function exitWire(e) {
  return {
    from: e.from, runeId: String(e.runeId), amount: String(e.amount), l1Address: e.l1Address,
    nonce: Number(e.nonce), publicKey: e.publicKey, signature: e.signature,
    scheme: e.scheme === 'ml-dsa' ? 'ml-dsa' : 'kraywallet',
  }
}
async function potSignerHealth(url) {
  try {
    const r = await fetch(url + '/health', { signal: AbortSignal.timeout(800) })
    return r.ok
  } catch {
    return false
  }
}
async function askPotSigner(pend) {
  const claimed = pend.payout.sighashes.slice(0, pend.payout.vaultInputCount)
  const holes = potSignerHoles(process.env)
  const hole = choosePotSignerHole({
    primaryAlive: holes.primary ? await potSignerHealth(holes.primary) : false,
    fallbackAlive: holes.fallback ? await potSignerHealth(holes.fallback) : false,
  })
  const url = hole === 'fallback' ? holes.fallback : hole === 'primary' ? holes.primary : ''
  if (url) {
    const loop = assertPotSignerLoopback(url, hole === 'fallback' ? 'KRAY_POT_SIGNER_URL_FALLBACK' : 'KRAY_POT_SIGNER_URL')
    if (!loop.ok) return { ok: false, reason: loop.reason }
    const token = (process.env.KRAY_POT_SIGNER_TOKEN || '').trim()
    if (!token) return { ok: false, reason: 'KRAY_POT_SIGNER_TOKEN is required when a pot-signer URL is set' }
    try {
      const r = await fetch(url + '/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          network: NET, exit: pend.exitEvent,
          ...(pend.exitEvents && pend.exitEvents.length > 1 ? { exits: pend.exitEvents } : {}),
          params: pend.params,
          vaultUtxos: pend.vaultUtxos.map((u) => ({ txid: u.txid, vout: u.vout, amountSats: u.amountSats.toString() })),
          funding: { ...pend.funding, amountSats: pend.funding.amountSats.toString() },
          plan: planToWire(pend.plan), claimedSighashes: claimed,
        }),
        signal: AbortSignal.timeout(15000),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) return { ok: false, reason: j.reason || j.error || `pot-signer refused (${r.status})` }
      if (!Array.isArray(j.depositorSigs) || !j.depositorSigs.length) return { ok: false, reason: 'pot-signer returned no signatures' }
      return { ok: true, depositorSigs: j.depositorSigs }
    } catch (e) {
      return { ok: false, reason: 'pot-signer unreachable — ' + (e instanceof Error ? e.message : String(e)) }
    }
  }
  if (holes.primary || holes.fallback) {
    return { ok: false, reason: 'pot-signer holes are dark — primary and fallback both failed health; fail-closed (no local secret)' }
  }
  const csk = consolidationDepositorSecret()
  if (!csk) return { ok: false, reason: 'this node does not hold the consolidation owner key — start scripts/pot-signer.mjs on localhost and set KRAY_POT_SIGNER_URL' }
  return authorizePotSign({
    network: NET, exit: pend.exitEvent,
    ...(pend.exitEvents && pend.exitEvents.length > 1 ? { exits: pend.exitEvents } : {}),
    params: pend.params,
    vaultUtxos: pend.vaultUtxos, funding: pend.funding, plan: pend.plan, claimedSighashes: claimed,
  }, csk)
}
// ── BOOK-REPLAYING REMOTE GUARDIANS (dormant capability; default OFF) ──────────────────────────────
// The pot's cooperative co-sign, hardened. Today labCosignPerInput signs with LAB keys on THIS writer — one
// trust domain, no independent check. When KRAY_GUARDIAN_SIGNER_URLS is set, each URL is a guardian-signer.mjs
// on its OWN machine that re-checks balanceOf against its OWN follower before lending a share, so a compromised
// writer forging an over-balance exit gets nothing. Loopback-only (reached by SSH reverse tunnel). Fail-closed.
function guardianSignerUrls() {
  return (process.env.KRAY_GUARDIAN_SIGNER_URLS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
}
async function askGuardians(pend) {
  const urls = guardianSignerUrls()
  const token = (process.env.KRAY_GUARDIAN_SIGNER_TOKEN || '').trim()
  if (!token) return { ok: false, reason: 'KRAY_GUARDIAN_SIGNER_TOKEN is required when guardian signer URLs are set' }
  const claimed = pend.payout.sighashes.slice(0, pend.payout.vaultInputCount)
  // LAG≠THEFT (custody doctrine rung 2): carry the exit's journal seq so a guardian whose book is merely
  // BEHIND answers "syncing, retry" (503) instead of a refusal that would HOLD an honest withdraw. A book
  // AT/PAST this seq that then contradicts is the real safety refusal (403 → hold). Conservative on multi-
  // exit pends (wire strips seq → falls back to the single exitSeq; a lower minSeal only weakens the lag
  // courtesy, never the safety gate).
  const minSeal = Math.max(Number(pend.exitSeq) || 0, ...((pend.exitEvents || []).map((e) => Number(e.seq) || 0))) || null
  const bundle = {
    network: NET, exit: pend.exitEvent,
    ...(pend.exitEvents && pend.exitEvents.length > 1 ? { exits: pend.exitEvents } : {}),
    ...(minSeal ? { minSeal } : {}),
    params: pend.params,
    vaultUtxos: pend.vaultUtxos.map((u) => ({ txid: u.txid, vout: u.vout, amountSats: u.amountSats.toString() })),
    funding: { ...pend.funding, amountSats: pend.funding.amountSats.toString() },
    plan: planToWire(pend.plan), claimedSighashes: claimed,
  }
  // Collect each guardian's OUTCOME IN PARALLEL — sequential 15s×3×retries blew past the public
  // edge and the wallet parsed an HTML 502 (`<!DOCTYPE…`) instead of the JSON reason. Quorum
  // law is unchanged: unreachable is tolerated up to the threshold; a book NO holds.
  for (const url of urls) {
    let parsed
    try { parsed = new URL(url) } catch { continue }
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      return { ok: false, reason: 'every guardian URL must be loopback — the guardian key never answers the public internet' }
    }
  }
  const outcomes = await Promise.all(urls.map(async (url) => {
    let parsed
    try { parsed = new URL(url) } catch { return { ok: false, refused: false, reason: 'invalid guardian URL' } }
    try {
      // LAG≠THEFT: a 503-lagging guardian (its book behind the exit's seq) gets brief retries — sync lag is
      // a liveness condition, not a safety verdict. Still fail-closed: it never signs while behind; if it
      // stays behind it counts as a SOFT fault (tolerated by the threshold), never silently trusted.
      let r, j
      for (let attempt = 0; ; attempt++) {
        r = await fetch(url + '/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify(bundle),
          signal: AbortSignal.timeout(15000),
        })
        j = await r.json().catch(() => ({}))
        if (!(r.status === 503 && j.lagging) || attempt >= 2) break
        await new Promise((ok2) => setTimeout(ok2, 4000))
      }
      if (r.status === 403) return { ok: false, refused: true, reason: j.reason || j.error || 'guardian refused on its book' }
      if (r.status === 503 && j.lagging) return { ok: false, refused: false, reason: `guardian lagging (book seq ${j.bookSeq ?? '?'} < exit ${j.minSeal ?? '?'}) — tolerated as a fault, retriable` }
      if (!r.ok || !j.ok || !j.guardianKey || !Array.isArray(j.guardianSigs) || !j.guardianSigs.length) {
        return { ok: false, refused: false, reason: `guardian soft failure (${r.status})` }
      }
      return { ok: true, share: { guardianKey: j.guardianKey, guardianSigs: j.guardianSigs } }
    } catch (e) {
      return { ok: false, refused: false, reason: 'unreachable — ' + (e instanceof Error ? e.message : String(e)) }
    }
  }))
  const decided = decideGuardianQuorum(outcomes, pend.params.threshold)
  if (!decided.ok) console.error(`   ⚖ GUARDIAN QUORUM HELD — ${decided.reason}`)
  return decided
}
function labCosignPerInput(payout) {
  const byKey = labGuardianSecretMap()
  return payout.sighashes.slice(0, payout.vaultInputCount).map((sh) => {
    const m = new Map()
    for (const g of payout.params.guardians) {
      if (m.size >= payout.params.threshold) break
      const sk = byKey.get(g)
      if (sk) m.set(g, signVaultSighash(sh, sk))
    }
    return m
  })
}
async function mempoolGet(path) {
  const r = await fetch(MEMPOOL_API + path, { signal: AbortSignal.timeout(12000) })
  const t = await r.text()
  if (!r.ok) throw new Error(`mempool GET ${path}: ${r.status} ${t.slice(0, 80)}`)
  try { return JSON.parse(t) } catch { return t }
}
async function mempoolBroadcast(hex) {
  const r = await fetch(MEMPOOL_API + '/tx', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: hex, signal: AbortSignal.timeout(15000) })
  const t = (await r.text()).trim()
  if (!r.ok && !/already (in|known)|txn-already/i.test(t)) throw new Error(`mempool broadcast: ${t.slice(0, 120)}`)
  return /^[0-9a-f]{64}$/i.test(t) ? t : null
}
async function spvProofFor(txid, minConf = DONATION_MIN_CONF) {
  const rawTx = await btcRpc('getrawtransaction', [txid])
  const info = await btcRpc('getrawtransaction', [txid, true])
  if (!info.blockhash) throw new Error('the transaction is not confirmed yet')
  const txoutproof = await btcRpc('gettxoutproof', [[txid], info.blockhash])
  const headers = []
  let hash = info.blockhash
  for (let i = 0; i < minConf && hash; i++) {
    const h = await btcRpc('getblockheader', [hash, true])
    headers.push(await btcRpc('getblockheader', [hash, false]))
    hash = h.nextblockhash
  }
  // Fail-closed: a tip block has no nextblockhash, so the loop can return a
  // shorter chain than the law. verifyOriginProofs would then say tx-shallow
  // with no count. Refuse here with the burial we actually have.
  if (headers.length < minConf) {
    const have = Number(info.confirmations) || headers.length
    throw new Error(
      `${txid} needs ${minConf} confirmations on this network (has ${have}) — wait for the next block(s), then retry`,
    )
  }
  // BIP-34 clock: a self-anchor seal is born-strict (inclusion seq 0). The reducer
  // refuses a seal without l1Height. The height is Bitcoin's own statement — the
  // coinbase of the burying block, merkle-proven into the same header. Without
  // these bytes verifyDonationProof cannot name the clock and journalSeal fails
  // closed. A pruned/RPC miss is named, never silent: the donate still credits
  // (the burn is proven); journalMissingSeals retries once the header height lands.
  const proof = { rawTx, txoutproof, headers }
  try {
    const blk = await btcRpc('getblock', [info.blockhash, 1])
    const coinbase = blk && Array.isArray(blk.tx) ? blk.tx[0] : null
    if (coinbase) {
      proof.coinbaseTx = await btcRpc('getrawtransaction', [coinbase])
      proof.coinbaseProof = await btcRpc('gettxoutproof', [[coinbase], info.blockhash])
    }
  } catch (e) {
    console.error('spvProofFor: coinbase clock missing for', String(txid).slice(0, 16), '—', e instanceof Error ? e.message : e)
  }
  return proof
}

// THE KEYSTONE ASSEMBLER — build the ancestry bundle a born-strict rune-deposit must journal:
// walk the deposit's inputs through OUR OWN bitcoind until the rune's etch (identity witnessed
// by the block's coinbase, BIP-34) or an outpoint this journal already proved. ord only HINTS
// where the etch is; every byte in the bundle is re-proven by the reducer, so a wrong hint can
// only make assembly fail — never a false credit. Depth-capped fail-closed: a rune whose history
// cannot be walked is refused at the door with a named reason, not credited on faith.
// how many proven txs a deposit's bundle may carry — operator policy (journal weight), never consensus:
// the reducer verifies whatever rode in. The walk follows the RUNE: a parent buried
// BEFORE the etch block cannot hold it (the id IS that height). A fee coin's faucet
// history is pre-etch sats and is skipped. 256 is a ceiling on the post-etch path
// (transfers of this rune), not on the satoshi DAG. The outpoint stays uncredited
// until the walk fits; metal stays in the pot.
const RUNE_ANCESTRY_MAX_TX = Math.max(2, parseInt(process.env.KRAY_RUNE_ANCESTRY_MAX_TX || '256', 10) || 256)
async function txBlockHeight(txid) {
  const info = await btcRpc('getrawtransaction', [txid, true])
  if (!info || !info.blockhash) throw new Error(`transaction ${txid} is not buried — wait for a confirmation`)
  if (Number.isInteger(info.height)) return info.height
  const blk = await btcRpc('getblock', [info.blockhash, 1])
  if (!Number.isInteger(blk?.height)) throw new Error(`transaction ${txid} has no block height — the node cannot walk it`)
  return blk.height
}
async function attachEtchWitness(entry, txid, runeIdStr) {
  const info = await btcRpc('getrawtransaction', [txid, true])
  const blk = await btcRpc('getblock', [info.blockhash, 1])
  entry.etchedId = runeIdStr
  entry.coinbaseTx = await btcRpc('getrawtransaction', [blk.tx[0]])
  entry.coinbaseProof = await btcRpc('gettxoutproof', [[blk.tx[0]], info.blockhash])
}
function runestoneOfRaw(rawHex) {
  try {
    const parsed = parseTx(rawHex)
    return decipher(parsed.outputScripts.map((s) => Uint8Array.from(s)))
  } catch { return null }
}
function runestoneMayCarryFocus(art) {
  // A runestone (or cenotaph) can move or burn the focused rune even when no
  // edict names it — leftover follows the pointer. A sats-only tx (no stone)
  // is included shallow: one SPV proof, no recursion. A pass-through with no
  // stone that secretly carried the focus fails the amount check, never over-credits.
  if (!art) return false
  return art.kind === 'runestone' || art.kind === 'cenotaph'
}
async function assembleRuneAncestry(depositTxid, runeIdStr, { maxTx = RUNE_ANCESTRY_MAX_TX } = {}) {
  const runeInfo = await ordGet(`/rune/${encodeURIComponent(runeIdStr)}`)
  const etchTxid = String(runeInfo?.entry?.etching ?? runeInfo?.etching ?? '').toLowerCase()
  const rid = parseRuneKey(runeIdStr)
  const bundle = []
  const seen = new Set()
  async function pushProof(txid) {
    if (bundle.length >= maxTx) {
      throw new Error(`the rune's ancestry needs more than ${maxTx} transactions to prove — consolidate the runes nearer the etch (or through an already-credited outpoint) and deposit again`)
    }
    const p = await spvProofFor(txid, DONATION_MIN_CONF)
    return { rawTx: p.rawTx, txoutproof: p.txoutproof, headers: p.headers }
  }
  async function includeShallow(txid) {
    txid = String(txid).toLowerCase()
    if (seen.has(txid)) return
    seen.add(txid)
    bundle.push(await pushProof(txid))
  }
  async function walk(txid) {
    txid = String(txid).toLowerCase()
    if (seen.has(txid)) return
    seen.add(txid)
    const entry = await pushProof(txid)
    const info = await btcRpc('getrawtransaction', [txid, true])
    const height = Number.isInteger(info?.height) ? info.height : (info?.blockhash ? (await btcRpc('getblock', [info.blockhash, 1])).height : null)
    const art = runestoneOfRaw(entry.rawTx)
    const etchesFocus = !!(art && art.kind === 'runestone' && art.etching && Number.isInteger(height) && BigInt(height) === rid.block)
    if ((etchTxid && txid === etchTxid) || etchesFocus) {
      await attachEtchWitness(entry, txid, runeIdStr)
      bundle.push(entry)
      return
    }
    bundle.push(entry)
    for (const vin of (info.vin || [])) {
      if (!vin.txid) continue // coinbase
      if (node.ledger.hasProvenRuneOutpoint(runeIdStr, `${vin.txid}:${vin.vout}`)) continue
      const parentHeight = await txBlockHeight(vin.txid)
      if (!parentCanHoldFocusedRune(parentHeight, rid.block)) continue
      const parentRaw = await btcRpc('getrawtransaction', [vin.txid]).catch(() => null)
      const parentArt = parentRaw ? runestoneOfRaw(typeof parentRaw === 'string' ? parentRaw : parentRaw.hex) : null
      if (runestoneMayCarryFocus(parentArt) || (etchTxid && String(vin.txid).toLowerCase() === etchTxid)) {
        await walk(vin.txid)
      } else {
        await includeShallow(vin.txid)
      }
    }
  }
  await walk(depositTxid)
  return bundle
}

// EXPLORER — decode a Bitcoin transaction's runestone (offline, via the kray-core decoder) so the
// explorer shows a rune tx for what it IS — the rune id(s), edicts, an etching, a mint, the amounts —
// instead of mistaking it for a KRAY journal event. Deterministic; needs only the raw tx from bitcoind.
async function decodeBitcoinRuneTx(txid) {
  if (!btcConfigured()) return null
  const raw = await btcRpc('getrawtransaction', [txid]).catch(() => null)
  if (!raw) return null
  let parsed
  try { parsed = parseTx(raw) } catch { return null }
  let art = null
  try { art = decipher(parsed.outputScripts.map((x) => Uint8Array.from(x))) } catch { art = null }
  const rid = (id) => `${id.block}:${id.tx}`
  const etch = (e) => e && ({
    rune: e.rune != null ? runeName(e.rune) : null,
    spacedRune: e.rune != null ? spacedRuneName(e.rune, e.spacers || 0) : null,
    divisibility: e.divisibility ?? 0,
    premine: e.premine != null ? e.premine.toString() : '0',
    symbol: e.symbol ?? null,
    terms: e.terms ? { amount: e.terms.amount != null ? e.terms.amount.toString() : null, cap: e.terms.cap != null ? e.terms.cap.toString() : null } : null,
    turbo: !!e.turbo,
  })
  const runestone = art ? {
    type: art.kind, // 'runestone' | 'cenotaph'
    edicts: (art.edicts || []).map((ed) => ({ runeId: rid(ed.id), amount: ed.amount.toString(), output: ed.output })),
    etching: art.kind === 'runestone' ? (etch(art.etching) || null) : (art.etching != null ? { rune: runeName(art.etching), spacedRune: runeName(art.etching), divisibility: 0, premine: '0', symbol: null, terms: null, turbo: false } : null),
    mint: art.mint ? rid(art.mint) : null,
    pointer: art.kind === 'runestone' ? (art.pointer ?? null) : null,
    flaws: art.kind === 'cenotaph' ? art.flaws : null,
  } : null
  const hasRunestone = !!(runestone && (runestone.edicts.length || runestone.etching || runestone.mint || (runestone.flaws && runestone.flaws.length)))
  // best-effort: ask ord what runes each output actually holds (the normative allocation)
  let outputs = parsed.outputValues.map((v, i) => ({ index: i, sats: v.toString(), runes: null }))
  if (hasRunestone) {
    outputs = await Promise.all(outputs.map(async (o) => {
      try {
        const r = await fetch(`${ORD_URL}/output/${txid}:${o.index}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2500) }).then((x) => (x.ok ? x.json() : null))
        if (r && r.runes && Object.keys(r.runes).length) o.runes = r.runes
      } catch { /* ord optional — the decode already stands on its own */ }
      return o
    }))
  }
  // attach each edict's rune divisibility (ord /rune/<id>, deduped, best-effort) so the explorer renders
  // DISPLAY units, not raw base units — the same law the L2 events already carry via runeDiv. A rune whose
  // divisibility ord cannot resolve stays null → the page groups it whole (never a WRONG scale), and the
  // exact runeId is always shown regardless. Gated on hasRunestone so only rune txs pay the lookup.
  if (hasRunestone && runestone.edicts && runestone.edicts.length) {
    const divById = {}
    await Promise.all([...new Set(runestone.edicts.map((e) => e.runeId))].map(async (id) => {
      try {
        const r = await fetch(`${ORD_URL}/rune/${id}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2500) }).then((x) => (x.ok ? x.json() : null))
        const d = r && r.entry && r.entry.divisibility
        if (d != null) divById[id] = Number(d) || 0
      } catch { /* best-effort — the id alone is still exact */ }
    }))
    runestone.edicts = runestone.edicts.map((e) => ({ ...e, div: divById[e.runeId] != null ? divById[e.runeId] : null }))
  }
  return { txid, outputs, runestone, hasRunestone }
}
// resolve a rune's human name from its id (block:tx) via ord — best-effort, for display only.
async function runeNameOf(runeId) {
  try {
    const r = await fetch(`${ORD_URL}/rune/${runeId}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2500) }).then((x) => (x.ok ? x.json() : null))
    if (r) return r.entry?.spaced_rune || r.entry?.rune || r.spaced_rune || r.rune || null
  } catch { /* ord optional — the id alone is still exact */ }
  return null
}
function pairCall(name, fallback) {
  const s = String(name || fallback || '').trim()
  return s || String(fallback || '')
}
function dressAmmPool(pool) {
  if (!pool) return pool
  const rr = pool.kind === 'rr'
  const callA = rr ? pairCall(pool.name, pool.runeId) : '₭'
  const callB = rr ? pairCall(pool.otherName, pool.otherRuneId) : pairCall(pool.name, pool.runeId)
  pool.callA = callA
  pool.callB = callB
  pool.title = callA + ' / ' + callB
  pool.href = rr
    ? '/pool/' + encodeURIComponent(callA) + '/' + encodeURIComponent(callB)
    : '/pool/' + encodeURIComponent(callB)
  pool.kindLabel = rr ? 'rune / rune' : '₭ pair'
  return pool
}
/** Display-only pair on a pot address — same title the book page paints. Never a consensus field. */
async function ammPairWho(addr) {
  const parsed = parseAmmPotAddress(addr)
  if (!parsed) return null
  if (parsed.kind === 'kray') {
    const meta = await runeMetaOf(parsed.runeId).catch(() => null)
    return '₭ / ' + pairCall(meta && meta.name, parsed.runeId)
  }
  const ma = await runeMetaOf(parsed.a).catch(() => null)
  const mb = await runeMetaOf(parsed.b).catch(() => null)
  return pairCall(ma && ma.name, parsed.a) + ' / ' + pairCall(mb && mb.name, parsed.b)
}
async function enrichAmmPool(pool) {
  if (!pool) return null
  const meta = await runeMetaOf(pool.runeId).catch(() => null)
  const other = pool.otherRuneId ? await runeMetaOf(pool.otherRuneId).catch(() => null) : null
  const supply = BigInt(pool.lpSupply || 0)
  const pileA = BigInt(pool.krayReserve || pool.reserveA || 0)
  const pileB = BigInt(pool.runeReserve || pool.reserveB || 0)
  const holders = (pool.holders || []).map((h) => {
    const lp = BigInt(h.lp || 0)
    return {
      ...h,
      who: (labelOf(h.address) || {}).label || null,
      aOut: supply > 0n ? ((pileA * lp) / supply).toString() : '0',
      bOut: supply > 0n ? ((pileB * lp) / supply).toString() : '0',
    }
  }).sort((x, y) => {
    const d = BigInt(y.lp || 0) - BigInt(x.lp || 0)
    if (d > 0n) return 1
    if (d < 0n) return -1
    return x.address < y.address ? -1 : x.address > y.address ? 1 : 0
  })
  let pairKey = null
  try {
    if (pool.kind === 'rr' && pool.otherRuneId) pairKey = 'rr:' + rrPairKey(String(pool.runeId), String(pool.otherRuneId)).key
    else if (pool.runeId) pairKey = 'k:' + canonicalRuneKey(String(pool.runeId))
  } catch { /* malformed — the book still lists; the origin door stays closed */ }
  const origin = originOfPairKey(pairKey)
  return dressAmmPool({
    ...pool,
    pairKey,
    origin,
    holders,
    name: (meta && meta.name) || pool.runeId,
    symbol: (meta && meta.symbol) || null,
    divisibility: (meta && meta.divisibility) || 0,
    thumbnail: meta && meta.parent ? '/api/kraynet/rune-thumb/' + encodeURIComponent(pool.runeId) + '?v=2' : null,
    otherName: other ? (other.name || pool.otherRuneId) : null,
    otherSymbol: other ? (other.symbol || null) : null,
    otherDivisibility: other ? (other.divisibility || 0) : 0,
    otherThumbnail: other && other.parent ? '/api/kraynet/rune-thumb/' + encodeURIComponent(pool.otherRuneId) + '?v=2' : null,
  })
}
function orderRrBody(b) {
  const pair = rrPairKey(String(b.runeId), String(b.otherRuneId))
  const ca = canonicalRuneKey(String(b.runeId))
  const aIn = ca === pair.a ? units(b.runeIn, 'runeIn') : units(b.otherIn, 'otherIn')
  const bIn = ca === pair.a ? units(b.otherIn, 'otherIn') : units(b.runeIn, 'runeIn')
  return { pair, aIn, bIn }
}
const ordGet = async (path) => { try { return await fetch(`${ORD_URL}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3000) }).then((x) => (x.ok ? x.json() : null)) } catch { return null } }
// the RAW JSON text — ord serializes u128 rune amounts as JSON numbers, and JSON.parse would silently
// round any amount > 2^53 to a float. Where an EXACT integer matters (a settle burns a lock only when
// the delivered amount === the locked amount) we read the digits from the text, never via a JS number.
const ordGetText = async (path) => { try { return await fetch(`${ORD_URL}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3000) }).then((x) => (x.ok ? x.text() : null)) } catch { return null } }
// resolve a rune's id (block:tx) from its (spaced) name via ord — for building sends.
async function runeIdOf(name) {
  const r = await ordGet(`/rune/${encodeURIComponent(name)}`)
  return (r && (r.id || r.entry?.id)) || null
}
// Render ANY inscription content into a thumbnail an <img> can always show. Images (incl. SVG) pass
// through; text/html/json — the "mold" text a KRAYNET inscription carries — is drawn into a small SVG
// so it appears instead of a broken image. Returns { contentType, body }.
function contentThumbnail(buf, contentType) {
  const ct = String(contentType || '').toLowerCase()
  if (ct.startsWith('image/')) return { contentType: ct, body: buf } // photos + SVG render natively
  const escXml = (s) => s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'))
  const clean = buf.toString('utf8').replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 120)
  const words = clean.split(/\s+/).filter(Boolean)
  const lines = []; let cur = ''
  for (const w of words) {
    if (lines.length >= 5) break
    if ((cur + ' ' + w).trim().length > 12) { if (cur) lines.push(cur); cur = w } else cur = (cur + ' ' + w).trim()
  }
  if (cur && lines.length < 5) lines.push(cur)
  const shown = lines.length ? lines : ['◆']
  const y0 = 32 - (shown.length - 1) * 5
  const tspans = shown.map((l, i) => `<tspan x="32" ${i ? 'dy="10"' : `y="${y0}"`}>${escXml(l.slice(0, 13))}</tspan>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#17142b"/><text x="32" font-family="ui-monospace,SFMono-Regular,monospace" font-size="8" font-weight="600" fill="#c9b8ff" text-anchor="middle">${tspans}</text></svg>`
  return { contentType: 'image/svg+xml; charset=utf-8', body: Buffer.from(svg) }
}
// What a SPECIFIC output actually holds of a rune, per ord (the normative indexer) — NOT an assertion.
// This is how a settle proves the payout truly delivered the runes: a payout that moved no real runes
// (a plain dust tx to a victim's address, or a cenotaph that burned them) leaves 0 at the target output,
// so the settle refuses — closing the griefing-burn that trusting an asserted amount would have allowed.
async function ordOutputRuneAmount(txid, vout, rid) {
  const idStr = `${rid.block}:${rid.tx}`
  const name = await runeNameOf(idStr)
  // read the RAW text so the u128 amount survives as exact digits (JSON.parse would round > 2^53 to a
  // float, and a payout marginally short of a large lock could round UP to === lock.amount and burn it).
  const raw = await ordGetText(`/output/${txid}:${vout}`)
  if (!raw) return 0n
  let o; try { o = JSON.parse(raw) } catch { return 0n }
  if (!o || !o.runes) return 0n
  const key = Object.keys(o.runes).find((n) => n === name || n === idStr)
  if (!key) return 0n
  // ord's Pile serializes `amount` FIRST — pull its exact digits for THIS rune key from the text.
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = raw.match(new RegExp('"' + esc + '"\\s*:\\s*\\{\\s*"amount"\\s*:\\s*(\\d+)'))
  if (m) return BigInt(m[1])
  // fallback (small amounts are exact through JSON.parse): the parsed value
  const r = o.runes[key]
  return BigInt((r && r.amount != null ? r.amount : r) || 0)
}
// a rune's display metadata from ord — the human name, symbol, divisibility, and the parent
// inscription that IS its thumbnail. Used to render L2 runes richly (like the L1 wallet does).
async function runeMetaOf(runeId) {
  const r = await ordGet(`/rune/${encodeURIComponent(runeId)}`)
  if (!r) return null
  const e = r.entry || {}
  return { name: e.spaced_rune || e.rune || null, symbol: e.symbol || null, divisibility: e.divisibility ?? 0, parent: r.parent || null }
}
async function rawRevealHex(txid) {
  if (btcConfigured()) {
    const raw = await btcRpc('getrawtransaction', [txid]).catch(() => null)
    const hex = typeof raw === 'string' ? raw : (raw && raw.hex)
    if (hex && /^[0-9a-f]+$/i.test(String(hex).trim())) return String(hex).trim()
  }
  const bases = [MEMPOOL_API]
  if (NET === 'signet') bases.push('https://mempool.space/signet/api')
  for (const base of bases.filter(Boolean)) {
    try {
      const r = await fetch(`${String(base).replace(/\/$/, '')}/tx/${txid}/hex`, { signal: AbortSignal.timeout(8000) })
      if (!r.ok) continue
      const t = (await r.text()).trim()
      if (/^[0-9a-f]+$/i.test(t) && t.length > 80) return t
    } catch { /* next source */ }
  }
  return null
}
// Parent ordinal bytes for the rune face. Ord first; if it 404s, the reveal
// witness on this chain. No parent → caller 404s and the page shows the symbol.
async function l1InscriptionBytes(id) {
  const key = String(id || '')
  const parsed = key.match(/^([0-9a-f]{64})i(\d+)$/i)
  try {
    const r = await fetch(`${ORD_URL}/content/${key}`, { signal: AbortSignal.timeout(3000) })
    if (r.ok) return { body: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') || 'application/octet-stream' }
  } catch { /* reveal hex below */ }
  if (!parsed) return null
  const hex = await rawRevealHex(parsed[1])
  if (!hex) return null
  let ins
  try { ins = inscriptionAtLoose(hex, Number(parsed[2])) } catch { return null }
  if (!ins || !ins.content || !ins.content.length) return null
  return { body: ins.content, contentType: ins.contentType || 'application/octet-stream' }
}
// THE BTC/USD QUOTE, node-side — a last-resort price for the wallet when the client's network blocks
// every public price API (e.g. a ship's filtered wifi). The node fetches it server-side (no CORS) and
// caches it; if the node is ALSO offline, it falls back to KRAY_BTC_USD, then the last good value. So
// the wallet's USD survives a blocked client as long as the node reached a source once, or an env pins it.
let _nodeBtcPrice = { usd: 0, ts: 0 }
async function nodeBtcUsd() {
  const now = Date.now()
  if (_nodeBtcPrice.usd > 0 && now - _nodeBtcPrice.ts < 60000) return _nodeBtcPrice.usd
  const sources = [
    async () => Number((await fetch('https://mempool.space/api/v1/prices', { signal: AbortSignal.timeout(2500) }).then((r) => r.json())).USD) || 0,
    async () => Number((await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', { signal: AbortSignal.timeout(2500) }).then((r) => r.json())).data.amount) || 0,
    async () => Number((await fetch('https://blockchain.info/ticker', { signal: AbortSignal.timeout(2500) }).then((r) => r.json())).USD.last) || 0,
  ]
  for (const s of sources) { try { const u = await s(); if (u > 0) { _nodeBtcPrice = { usd: u, ts: now }; return u } } catch { /* try next */ } }
  // offline: the last REAL price this node fetched, else 0 (never a fabricated number — a wrong price
  // is worse than none; the wallet shows $0.00 honestly when every source is blocked).
  return _nodeBtcPrice.usd || 0
}

// THE REAL FEE MARKET, node-side — the recommended sat/vB rates for THIS network, so a donation (or any
// wallet tx) is priced to the live mempool instead of a flat guess that strands it blocks deep. Cached 60s.
// Regtest has no fee market: a flat honest schedule. Signet/testnet/main: mempool.space's own estimator.
let _nodeFees = { fees: null, ts: 0 }
async function nodeFees() {
  if (NET === 'regtest') return { fastest: 2, halfHour: 2, hour: 1, economy: 1, minimum: 1, source: 'regtest-flat' }
  const now = Date.now()
  if (_nodeFees.fees && now - _nodeFees.ts < 60000) return _nodeFees.fees
  const base = MEMPOOL_API || ('https://mempool.space/' + (NET === 'signet' ? 'signet/' : NET === 'testnet' ? 'testnet/' : '') + 'api')
  try {
    const r = await fetch(base + '/v1/fees/recommended', { signal: AbortSignal.timeout(3500) }).then((x) => x.json())
    const f = { fastest: +r.fastestFee, halfHour: +r.halfHourFee, hour: +r.hourFee, economy: +r.economyFee, minimum: +r.minimumFee, source: 'mempool.space' }
    if (f.fastest > 0 && f.halfHour > 0) { _nodeFees = { fees: f, ts: now }; return f }
  } catch { /* fall through to the last-known or a safe floor */ }
  // never fabricate a too-low rate: the last real read, else a conservative floor that confirms rather than strands
  return _nodeFees.fees || { fastest: 5, halfHour: 4, hour: 3, economy: 2, minimum: 1, source: 'fallback' }
}

// ── THE WALLET's L1 (Bitcoin) BACKEND, served from the node's OWN bitcoind + ord ─────────────────
// The DevNet unifies here: with DevNet on, the wallet asks THIS node for its balance, UTXOs, fees and
// runes — the same regtest the KRAYNET L2 anchors to — so what you see is what the L2 spends. One chain.
// (scantxoutset is a full-utxo-set scan — SECONDS per query on a synced signet. So we index by address the
//  way a real node would: a public indexer (mempool.space) gives an INSTANT lookup on signet/mainnet, and
//  scantxoutset stays the fallback — and the only path on regtest, where it is fast on a tiny chain.)
const ADDR_API = process.env.KRAY_ADDR_API != null ? (process.env.KRAY_ADDR_API || null)
  : NET === 'signet' ? 'https://mempool.space/signet/api'
  : NET === 'main' ? 'https://mempool.space/api'
  : NET === 'testnet' ? 'https://mempool.space/testnet/api'
  : null   // regtest → no public indexer; scantxoutset is fast on a tiny chain
const _utxoCache = new Map()   // address → { utxos, at } — a short cache so the live 8-s refresh never hammers the indexer
async function scanUtxosFast(address) {
  if (!ADDR_API) return null
  try {
    const r = await fetch(`${ADDR_API}/address/${encodeURIComponent(address)}/utxo`, { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return null
    const utxos = await r.json()
    if (!Array.isArray(utxos)) return null
    const scriptHex = scriptOfAddress(address, toBtcNet(NET))   // one address → one scriptPubKey, for every UTXO
    return utxos.filter((u) => u.status && u.status.confirmed).map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, scriptHex, height: u.status.block_height ?? null }))
  } catch { return null }
}
const _utxoInflight = new Map()   // address → the ONE scan in flight — simultaneous callers share it (single-flight)
let _scanTxoutQueue = Promise.resolve()   // bitcoind allows ONE scantxoutset at a time — every fallback scan queues
async function scanUtxos(address) {
  const c = _utxoCache.get(address)
  if (c && Date.now() - c.at < 12000) return c.utxos
  const inflight = _utxoInflight.get(address)
  if (inflight) return inflight                          // storm-proof: N simultaneous donors → ONE scan, shared
  const p = (async () => {
    let utxos = await scanUtxosFast(address)             // indexed → instant, where a public indexer exists
    if (!utxos) {                                        // fallback: the full-utxo-set scan (regtest, or the API down)
      // serialize through one queue so concurrent DIFFERENT-address scans can never collide either
      // ("Scan already in progress") — they simply wait their turn instead of failing a real donor.
      const run = _scanTxoutQueue.then(() => btcRpc('scantxoutset', ['start', [`addr(${address})`]]))
      _scanTxoutQueue = run.then(() => {}, () => {})
      const scan = await run
      utxos = (scan.unspents || []).map((u) => ({ txid: u.txid, vout: u.vout, value: Math.round(u.amount * 1e8), scriptHex: u.scriptPubKey, height: u.height }))
    }
    _utxoCache.set(address, { utxos, at: Date.now() })
    return utxos
  })()
  _utxoInflight.set(address, p)
  try { return await p } finally { _utxoInflight.delete(address) }
}
async function enrichedUtxos(address) {
  const utxos = await scanUtxos(address)
  return Promise.all(utxos.map(async (u) => {
    const o = await ordGet(`/output/${u.txid}:${u.vout}`)
    const runes = o && o.runes && Object.keys(o.runes).length ? o.runes : null
    const inscriptions = o && o.inscriptions && o.inscriptions.length ? o.inscriptions : null
    // `verified` = ord POSITIVELY answered for this output. When ord is null (blip / not-yet-indexed) verified is
    // false and the flags are false too — callers MUST treat an unverified UTXO as PROTECTED, never a fee input.
    return { txid: u.txid, vout: u.vout, value: u.value, scriptHex: u.scriptHex, confirmed: true, verified: !!o, hasRunes: !!runes, runes: runes || null, hasInscription: !!inscriptions, inscriptions: inscriptions || null }
  }))
}
// LEI SUPREMA — a spend that funds a donation may use ONLY pure BTC, never a UTXO that carries an
// inscription (ordinal) or a rune. This mirrors the KrayWallet extension's own spend filter
// (background-real.js: `!hasInscription && !hasRunes`), re-derived here from ord — the normative indexer —
// per output. FAIL-CLOSED: if ord cannot CONFIRM a UTXO is cardinal (ord unreachable, or an output it does
// not know), that UTXO is treated as PROTECTED and never spent — a donation must never burn a donor's
// ordinal or rune. (Rare-sat protection is a documented follow-up: it needs an ord run with `--index-sats`
// AND the rarity taxonomy applied to each range's first sat — merely having sat_ranges does NOT mean rare,
// so it is intentionally NOT gated here; the current ord indexes runes only. See docs.)
async function cardinalOnly(utxos) {
  const cardinal = [], guarded = []
  await Promise.all(utxos.map(async (u) => {
    const o = await ordGet(`/output/${u.txid}:${u.vout}`)
    if (!o) { guarded.push({ ...u, reason: 'unverified' }); return }             // fail-closed: cannot confirm → never spend
    const hasRunes = o.runes && Object.keys(o.runes).length > 0
    const hasInscription = Array.isArray(o.inscriptions) && o.inscriptions.length > 0
    if (hasRunes || hasInscription) { guarded.push({ ...u, reason: hasRunes ? 'rune' : 'inscription' }); return }
    cardinal.push(u)
  }))
  return { cardinal, guarded }
}
async function runesOfAddress(address) {
  const utxos = await enrichedUtxos(address)
  const agg = new Map() // name → { amount, divisibility, symbol }
  for (const u of utxos) {
    if (!u.runes) continue
    for (const [name, r] of Object.entries(u.runes)) {
      const amt = BigInt((r && r.amount != null ? r.amount : r) || 0)
      const cur = agg.get(name) || { amount: 0n, divisibility: r?.divisibility ?? 0, symbol: r?.symbol ?? null }
      cur.amount += amt
      if (r && r.divisibility != null) cur.divisibility = r.divisibility
      if (r && r.symbol) cur.symbol = r.symbol
      agg.set(name, cur)
    }
  }
  // Same wallet contract as mainnet kray-space: integer rawAmount + edict divisibility.
  // Ord output piles often omit the etching; /rune/<id> is the edict (never a foreign chain).
  return Promise.all([...agg.entries()].map(async ([name, v]) => {
    const runeId = await runeIdOf(name)
    const meta = await runeMetaOf(runeId || name)
    const divisibility = Number(meta && meta.divisibility != null ? meta.divisibility : v.divisibility) || 0
    const symbol = (meta && meta.symbol) || v.symbol || null
    const raw = v.amount.toString()
    const amount = divisibility > 0 ? Number(v.amount) / (10 ** divisibility) : Number(v.amount)
    return {
      name, spacedName: name, displayName: symbol ? `${name} ${symbol}` : name,
      symbol, divisibility, rawAmount: raw, amount, runeId,
    }
  }))
}
// Miner fee = the user's sat/vB × the REAL taproot key-path vsize (not a 160 vB guess).
// A 3-in / 4-out rune send is ~340 vB; pricing it as 160 collapsed High (4) into ~1.9 on-chain.
function feeRateOf(b) { return Math.max(1, Math.min(500, Number(b && b.feeRate) || 2)) }
const feeFor = (b, nIn = 2, nOut = 2) => feeSatsAtRate(feeRateOf(b), nIn, nOut)

// ORIGIN OWNERSHIP — an origin child descends from a Bitcoin L1 ordinal. Ord is a
// fast hint only (mismatch → 403). The law is the SPV bag + Casey spend + live
// unspent eyes. DEV-TRUST is not ownership.
// EVERY NETWORK HAS ITS OWN ord — regtest, signet and mainnet are DIFFERENT indexers on different
// ports, and a node that read the wrong one would credit/deny rune movements against a foreign chain.
// KRAY_ORD_URL always wins; the fallback is NET-AWARE so a node started without it still hits the ord
// that matches its own network (these match the harnesses this repo ships). Mainnet has no safe local
// guess, so it must be set explicitly — we refuse to invent one.
const ORD_DEFAULTS = { regtest: 'http://127.0.0.1:8081', signet: 'http://127.0.0.1:8083', main: null }
// MAINNET has no safe local guess — we REFUSE to invent one (falling through to the regtest 8081 literal
// would silently read a foreign-chain indexer, exactly the isolation break this claims to prevent). A
// mainnet node without KRAY_ORD_URL exits rather than serve rune data from the wrong chain.
if (!process.env.KRAY_ORD_URL && NET === 'main') {
  console.error('✗ KRAYNET on MAINNET requires KRAY_ORD_URL — refusing to start rather than read the wrong-chain ord. Set it to your mainnet ord indexer.')
  process.exit(1)
}
const ORD_URL = ((process.env.KRAY_ORD_URL || ORD_DEFAULTS[NET] || 'http://127.0.0.1:8081')).replace(/\/+$/, '')
console.log(`  ord (${NET}) → ${ORD_URL}${process.env.KRAY_ORD_URL ? '' : ' (net-aware default; set KRAY_ORD_URL to override)'}`)
/**
 * Ord indexer hint — NOT the law. `mismatch` is a fast 403 (ord says someone
 * else holds it). `match` / `unknown` still require the SPV bag: a signed claim
 * and DEV-TRUST are not ownership. The reducer re-proves the bag from bytes.
 */
async function ordinalHint(id, addr) {
  if (!id || !addr) return 'unknown'
  try {
    const r = await fetch(`${ORD_URL}/inscription/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(1500) })
    if (!r.ok) return 'unknown'
    const j = await r.json().catch(() => ({}))
    const owner = j.address || j.owner || null
    if (!owner) return 'unknown'
    return owner === addr ? 'match' : 'mismatch'
  } catch {
    return 'unknown'
  }
}

/** Door-side SPV — same math as the reducer. Throws an English refusal. */
function assertOriginProofsDoor(from, originIds, rawProofs) {
  if (!originIds.length) return null
  if (rawProofs === undefined || rawProofs === null) {
    throw new Error('an L1 ordinal parent needs a Bitcoin SPV control proof — a signed claim is not enough')
  }
  const proofs = parseOriginProofs(rawProofs)
  const v = verifyOriginProofs(from, NET, originIds, proofs, donationProofMinConf(toBtcNet(NET)))
  if (!v.ok) throw new Error(`L1 origin is not proven under ${from} — ${v.reason}`)
  return proofs
}

/**
 * Live L1 parentage — SPV + Casey blessing + two eyes. Used by prepare/submit
 * and by the batch convenience so a collection cannot skip the mempool sale gate.
 */
async function assertLiveOriginParentage(from, originIds, rawProofs) {
  if (!originIds.length) return
  for (const id of originIds) {
    if (await ordinalHint(id, from) === 'mismatch') {
      throw new Error(`you must OWN L1 ordinal ${id.slice(0, 12)}… to father a child from it — it is not at your address`)
    }
  }
  const proofs = assertOriginProofsDoor(from, originIds, rawProofs)
  await assertHoldersLiveOnThisBitcoin(proofs)
  await assertHoldersLiveOnKrayApi(proofs, originIds)
}

/**
 * Pending-sale close. SPV cannot see a mempool spend; this node's UTXO set can.
 * Replay does not re-ask (an old child stays after a later sale). Lab bags whose
 * holder block is not on THIS bitcoind are not invented as spent.
 */
async function assertHoldersLiveOnThisBitcoin(proofs) {
  if (!proofs || !proofs.length || !btcConfigured()) return
  for (const p of proofs) {
    const holder = p.bundle.find((tx) => {
      try { return parseTx(tx.rawTx).txidDisplay === p.holderTxid } catch { return false }
    })
    if (!holder) throw new Error('L1 origin bag is missing the holder transaction')
    let headerOnThisChain = null
    let headerConfirmations = null
    try {
      const h0 = parseHeader(Buffer.from(holder.headers[0], 'hex'))
      const hdr = await btcRpc('getblockheader', [h0.hashDisplay, true])
      headerOnThisChain = true
      headerConfirmations = Number(hdr.confirmations)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/not found|Block not found|-5/i.test(msg)) headerOnThisChain = null
      else throw new Error('this node cannot see Bitcoin — it will not father an L1 child while the chain eye is dark')
    }
    let utxoPresent = null
    if (headerOnThisChain === true && !(headerConfirmations != null && headerConfirmations < 0)) {
      try {
        const utxo = await btcRpc('gettxout', [p.holderTxid, p.holderVout, true])
        utxoPresent = utxo != null
      } catch {
        throw new Error('this node cannot see the UTXO set — it will not father an L1 child while the chain eye is dark')
      }
    }
    const gate = liveHolderGate({ headerOnThisChain, headerConfirmations, utxoPresent })
    if (!gate.ok && gate.reason === 'holder-orphaned') {
      throw new Error('L1 parent holder block is not on this Bitcoin')
    }
    if (!gate.ok && gate.reason === 'holder-spent') {
      throw new Error('L1 parent is already spent on Bitcoin — including a mempool sale. A sold parent cannot father a child')
    }
  }
}

/**
 * Second eye: the KRAY API KrayScan already uses. Esplora outspends mark a
 * mempool spend (`spent: true` while unconfirmed). satpoint / location names
 * the inscription's current outpoint. Main only — this gateway is mainnet;
 * value never crosses networks. A dark eye does not invent a sale; a spent
 * eye refuses even if this writer's mempool has not seen the sale yet.
 */
async function assertHoldersLiveOnKrayApi(proofs, originIds) {
  const base = String(process.env.KRAY_API_ENDPOINT || '').replace(/\/$/, '')
  if (!proofs || !proofs.length || !base) return
  if (NET !== 'main') return
  const key = String(process.env.KRAY_API_KEY || '').trim()
  const headers = {
    Accept: 'application/json',
    'X-Kray-Network': 'mainnet',
    ...(key ? { Authorization: 'Bearer ' + key } : {}),
  }
  const ids = Array.isArray(originIds) ? originIds : []
  for (let i = 0; i < proofs.length; i++) {
    const p = proofs[i]
    try {
      const r = await fetch(`${base}/api/tx/${p.holderTxid}/outspends`, { headers, signal: AbortSignal.timeout(5000) })
      if (r.ok) {
        const arr = await r.json()
        const row = Array.isArray(arr) ? arr[p.holderVout] : null
        const g = krayOutspendGate(row)
        if (!g.ok) {
          throw new Error('L1 parent is already spent on Bitcoin — KRAY API sees the spend (pending or confirmed). A sold parent cannot father a child')
        }
      }
    } catch (e) {
      if (e instanceof Error && /sold parent cannot father/i.test(e.message)) throw e
      // eye dark — local gettxout already ran
    }
    const id = ids[i]
    if (!id) continue
    try {
      const r = await fetch(`${base}/ord/inscription/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(5000) })
      if (!r.ok) continue
      const j = await r.json()
      const loc = j && (j.satpoint || j.location || j.output)
      const g = kraySatpointGate({ txid: p.holderTxid, vout: p.holderVout }, loc)
      if (!g.ok) {
        throw new Error('L1 parent satpoint has moved on KRAY API — the inscription is no longer at the claimed holder (pending or confirmed)')
      }
    } catch (e) {
      if (e instanceof Error && /satpoint has moved|sold parent cannot father/i.test(e.message)) throw e
    }
  }
}

/**
 * Build the Casey blessing bag from THIS node's bitcoind: walk the sat from the
 * holder satpoint back to the reveal, fetching each hop's SPV proof. The same
 * math as proveParentControl — the client does not invent the chain.
 */
async function assembleOriginProofFromBitcoin(from, parentId, satpointRaw) {
  if (!btcConfigured()) throw new Error('this node has no bitcoind — it cannot build an origin bag from the chain')
  const id = String(parentId || '').toLowerCase()
  if (!ORDINAL_ID_RE.test(id)) throw new Error('parentId must be a Bitcoin L1 ordinal id (<txid>iN)')
  const land = parseSatpoint(satpointRaw)
  if (!land) throw new Error('blessing satpoint must be txid:vout or txid:vout:offset')
  const minConf = donationProofMinConf(toBtcNet(NET))
  const cache = new Map()
  const load = async (txid) => {
    if (cache.has(txid)) return cache.get(txid)
    let proven
    try { proven = await spvProofFor(txid, minConf) }
    catch (e) { throw new Error(`cannot SPV-prove ${txid.slice(0, 12)}… — ${e instanceof Error ? e.message : String(e)}`) }
    let parsed
    try { parsed = parseTx(proven.rawTx) } catch { throw new Error(`malformed Bitcoin tx ${txid.slice(0, 12)}…`) }
    const row = { proven, parsed }
    cache.set(txid, row)
    return row
  }
  const revealTxid = id.slice(0, 64)
  let cur = { txid: land.txid, vout: land.vout, offset: land.offset }
  for (let hop = 0; hop < 128; hop++) {
    await load(cur.txid)
    if (cur.txid === revealTxid) break
    const { parsed } = cache.get(cur.txid)
    for (const inp of parsed.inputs) await load(inp.txid)
    const back = satHopBack(parsed, cur.vout, cur.offset, (txid, vout) => {
      const f = cache.get(txid)
      if (!f || vout >= f.parsed.outputValues.length) return null
      return f.parsed.outputValues[vout]
    })
    if (!back.ok) throw new Error(`cannot walk the parent sat — ${back.reason}`)
    cur = back.hop
  }
  if (cur.txid !== revealTxid) throw new Error('the blessing sat did not reach the parent reveal — too deep or not that inscription')
  await load(revealTxid)
  const proof = {
    holderTxid: land.txid,
    holderVout: land.vout,
    holderOffset: land.offset.toString(),
    bundle: [...cache.values()].map((x) => x.proven),
  }
  const v = verifyOriginProofs(from, NET, [id], [proof], minConf)
  if (!v.ok) {
    const why = String(v.reason || 'refused')
    if (why.includes('tx-shallow')) {
      throw new Error(
        `L1 origin is not proven under ${from} — ${why} (this network needs ${minConf} confirmations on every hop, including the blessing send-to-self)`,
      )
    }
    throw new Error(`L1 origin is not proven under ${from} — ${why}`)
  }
  await assertHoldersLiveOnThisBitcoin([proof])
  await assertHoldersLiveOnKrayApi([proof], [id])
  return proof
}

// MULTIPARENT (message v3) door reading — normalize {parents, origins} from a request body.
// Accepts arrays or comma-joined strings; strips "#" and whitespace; origins lowercased.
// Returns null when the act carries no lists (the frozen v2 path).
function multiparentLists(b) {
  const norm = (v, lower) => {
    if (v === undefined || v === null || v === '') return undefined
    const arr = Array.isArray(v) ? v.map((x) => String(x)) : String(v).split(',')
    const out = arr.map((x) => { x = x.replace(/[#\s]/g, ''); return lower ? x.toLowerCase() : x }).filter((x) => x !== '')
    return out.length ? out : undefined
  }
  const parents = norm(b.parents, false), origins = norm(b.origins, true)
  return (parents || origins) ? { parents: parents ?? [], origins: origins ?? [] } : null
}

/** Free JSON metadata from a request body. Null = absent (frozen v2/v3).
 *  A string is sealed as typed; an object is stringified (API convenience). */
function readInscriptionMeta(b) {
  if (b.meta == null || b.meta === '') return null
  const raw = typeof b.meta === 'string' ? b.meta.trim() : JSON.stringify(b.meta)
  if (!raw) return null
  assertInscriptionMeta(raw)
  return raw
}

// THE BACKING GATE — the reducer re-enforces the no-hostage send law on replay.
// Unset = on every network (Signet burn-in 2026-08-17). Force KRAY_BACKING_GATE=0
// only to replay a hostage past. The DOOR below enforces the law for every NEW
// send on every network regardless.
const BACKING_GATE = envFlag('KRAY_BACKING_GATE', true)
// ADR-1 extended: the pot INTERNAL key (x-only, public) lets the reducer re-derive self-anchor burn
// scripts from a donate event's sealed (anchorBlock, anchorRoot) — verification stays opt-in like the
// pot script itself. Passing it is safe on every network: it only fires on events that carry seal fields.
const node = new KrayNode(DATA_DIR, NET, undefined, POT_SCRIPT_HEX || undefined, BACKING_GATE, POT_INTERNAL_KEY || undefined)
// the genesis (empty-ledger) cascade root — the first donation on a fresh chain seals THIS root (labelled block 0,
// before any block is sealed), so a self-anchor of it is a valid anchor of the genesis state. Deterministic.
const GENESIS_ROOT = new KrayLedger(undefined, NET).cascadeRoot()
console.log(`KRAYNET node — network=${NET} data=${DATA_DIR} seq=${node.seq} stars=${node.ledger.stars.starCount}`)

// ── helpers ──────────────────────────────────────────────────────────────────
const jstr = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))
function send(res, code, body) {
  const s = typeof body === 'string' ? body : jstr(body)
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  })
  res.end(s)
}
const ok = (res, body) => send(res, 200, body)
const err = (res, code, message) => send(res, code, { error: message })
/** Rsync + restart is the whole ritual. HTML is no-store; chrome URLs follow the files on disk so the public edge cannot keep yesterday's nav. */
function stampExplorerHtml(html) {
  const js = existsSync(join(__dir, 'kray.js')) ? Math.trunc(statSync(join(__dir, 'kray.js')).mtimeMs).toString(16) : '0'
  const css = existsSync(join(__dir, 'kray.css')) ? Math.trunc(statSync(join(__dir, 'kray.css')).mtimeMs).toString(16) : '0'
  const batch = existsSync(join(__dir, 'inscribe-batch.js')) ? Math.trunc(statSync(join(__dir, 'inscribe-batch.js')).mtimeMs).toString(16) : '0'
  return String(html)
    .replace(/\/kray\.css(?:\?v=[^"'>\s]*)?/g, `/kray.css?v=${css}`)
    .replace(/\/kray\.js(?:\?v=[^"'>\s]*)?/g, `/kray.js?v=${js}`)
    .replace(/\/inscribe-batch\.js(?:\?v=[^"'>\s]*)?/g, `/inscribe-batch.js?v=${batch}`)
}
function serveFile(res, path, type, extraHeaders) {
  if (!existsSync(path)) return err(res, 404, 'not found')
  const st = statSync(path)
  const etag = `W/"${st.size.toString(16)}-${Math.trunc(st.mtimeMs).toString(16)}"`
  const isAsset = /\.(?:css|js|mjs|svg|png|ico|woff2?)$/i.test(path)
  const req = res.req
  if (isAsset && req && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' })
    return res.end()
  }
  let body = readFileSync(path)
  if (String(type).includes('text/html')) body = Buffer.from(stampExplorerHtml(body.toString('utf8')), 'utf8')
  const headers = {
    'Content-Type': type,
    'Cache-Control': isAsset ? 'public, max-age=300' : 'no-store',
    ETag: etag,
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    ...(extraHeaders || {}),
  }
  const ae = req ? String(req.headers['accept-encoding'] || '') : ''
  if (isAsset && body.length > 1024 && ae.includes('gzip') && /\.(?:css|js|mjs|svg)$/i.test(path)) {
    body = gzipSync(body)
    headers['Content-Encoding'] = 'gzip'
    headers.Vary = 'Accept-Encoding'
  }
  res.writeHead(200, headers)
  res.end(body)
}
const COVER_OK = new Set(READ_MIMES)
/** APIC from a sealed MP3 — ID3 prefix only, never the MPEG body. Null if absent. */
function peekApic(hash) {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null
  const path = join(CONTENT_DIR, hash)
  if (!existsSync(path)) return null
  let fd
  try {
    fd = openSync(path, 'r')
    const hdr = Buffer.alloc(10)
    if (readSync(fd, hdr, 0, 10, 0) < 10) return null
    const total = id3TagTotalLength(hdr)
    if (!total) return null
    const tag = Buffer.alloc(total)
    const n = readSync(fd, tag, 0, total, 0)
    const apic = readApic(n === total ? tag : tag.subarray(0, n))
    if (!apic || !COVER_OK.has(apic.mime)) return null
    return apic
  } catch {
    return null
  } finally {
    if (fd != null) try { closeSync(fd) } catch { /* already closed */ }
  }
}
function serveCover(res, hash) {
  if (!/^[0-9a-f]{64}$/.test(hash)) return err(res, 400, 'bad hash')
  { const held = heldContentPath(hash); if (held.held && !held.ok) return err(res, 503, CONTENT_CORRUPT) }
  const apic = peekApic(hash)
  if (!apic) return err(res, 404, 'no cover')
  res.writeHead(200, {
    'Content-Type': apic.mime,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:",
    'Access-Control-Allow-Origin': '*',
  })
  return res.end(Buffer.from(apic.bytes))
}
// ── the shareable proof card — a per-anchor gold seal rendered as dependency-free SVG (no image lib), so
//    /proof/<n> gets a rich zero-click preview in social feeds with ZERO on-chain cost and ZERO relay risk.
//    Pure presentation: it renders the SAME (blockNumber, cascadeRoot) the browser reproves — never a proof itself.
function svgEsc(s) { return String(s == null ? '' : s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c])) }
function proofCardSvg(bn, root, net, sealed) {
  const rootShort = root ? root.slice(0, 34) + '…' + root.slice(-6) : '—'
  const netLabel = net === 'main' ? 'BITCOIN' : String(net || 'signet').toUpperCase()
  const status = sealed ? 'SEALED INTO BITCOIN' : 'ANCHOR PENDING'
  const gold = sealed ? '#e0b34a' : '#7d828b'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="ui-sans-serif,-apple-system,Helvetica,Arial,sans-serif">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a0c10"/><stop offset="1" stop-color="#12161c"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="26" y="26" width="1148" height="578" rx="22" fill="none" stroke="#1e232b" stroke-width="1.5"/>
  <text x="76" y="104" font-family="ui-monospace,Menlo,monospace" font-size="21" letter-spacing="7" fill="#7d828b">KRAY.NETWORK</text>
  <text x="1124" y="104" text-anchor="end" font-family="ui-monospace,Menlo,monospace" font-size="16" letter-spacing="3" fill="${gold}">${svgEsc(netLabel)}</text>
  <text x="76" y="268" font-size="82" font-weight="800" fill="#eef1f4">Block ${svgEsc(String(bn))}</text>
  <text x="76" y="330" font-size="38" font-weight="700" fill="${gold}" letter-spacing="1">${svgEsc(status)}</text>
  <text x="76" y="424" font-family="ui-monospace,Menlo,monospace" font-size="16" letter-spacing="2" fill="#5f6570">CASCADE ROOT</text>
  <text x="76" y="458" font-family="ui-monospace,Menlo,monospace" font-size="23" fill="#c7ccd3">${svgEsc(rootShort)}</text>
  <circle cx="1036" cy="298" r="98" fill="none" stroke="${gold}" stroke-width="3"/>
  <circle cx="1036" cy="298" r="78" fill="none" stroke="${gold}" stroke-width="1" opacity="0.5"/>
  <text x="1036" y="332" text-anchor="middle" font-size="96" fill="${gold}">₿</text>
  <line x1="76" y1="512" x2="1124" y2="512" stroke="#1e232b" stroke-width="1"/>
  <text x="76" y="560" font-size="22" fill="#8b909a">Recompute it yourself — the proof runs in your browser, trusting no node.</text>
</svg>`
}
function proofOgMeta(bn, root, sealed, absBase) {
  if (bn == null) return '<meta property="og:title" content="KRAY.NETWORK — sealed in Bitcoin, verify it yourself">\n<meta property="og:description" content="Every KRAY block folds into one cascade root, committed on Bitcoin. Your own browser reproves it — no trust in any node.">\n<meta name="twitter:card" content="summary_large_image">'
  const title = `KRAY block ${bn} — ${sealed ? 'sealed into Bitcoin' : 'anchor pending'}`
  const desc = root ? `Cascade root ${root.slice(0, 24)}… committed on Bitcoin. Recompute-and-match it yourself in your browser — trust no node.` : 'Verify this KRAY anchor yourself, in your browser.'
  const img = `${absBase}/proof/${bn}/card.svg`
  return `<meta property="og:title" content="${svgEsc(title)}">\n<meta property="og:description" content="${svgEsc(desc)}">\n<meta property="og:image" content="${svgEsc(img)}">\n<meta property="og:url" content="${svgEsc(absBase)}/proof/${bn}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${svgEsc(img)}">`
}
// oversize sentinel — readBody resolves this (never null) when the guillotine fired, so the
// router can answer 413 instead of the generic 400, and no handler ever hangs on a dead socket.
const BODY_TOO_LARGE = Symbol('body-too-large')
const BODY_MAX = 32 * 1024 * 1024
function readBody(req) {
  return new Promise((resolve) => {
    // 32 MiB: a 10 MB star arrives as base64 JSON (~13.3 MB) — the cap must clear the
    // protocol's own ceiling with headroom, and still guillotine anything larger mid-flight.
    // Refuse an announced oversize before reading a byte (cheap), and — the audited hang —
    // ALWAYS settle on close/error too: after req.destroy() the 'end' event never fires,
    // so a promise listening only to data/end would leave the handler pending forever.
    // NOTE: never destroy here — the router answers 413 FIRST, then drops the socket
    // (destroying before the response leaves the client with a bare connection reset).
    const announced = Number(req.headers['content-length'] || 0)
    if (announced > BODY_MAX) return resolve(BODY_TOO_LARGE)
    let b = ''
    let settled = false
    const settle = (v) => { if (!settled) { settled = true; resolve(v) } }
    req.on('data', (c) => { b += c; if (b.length > BODY_MAX) { b = ''; settle(BODY_TOO_LARGE) } })
    req.on('end', () => { try { settle(b ? JSON.parse(b) : {}) } catch { settle(null) } })
    req.on('close', () => settle(null))
    req.on('error', () => settle(null))
  })
}

// ── the derived views the wallet/explorer render ─────────────────────────────
// ADR-4 4a — the deepest REAL, non-simulated anchor's burial, from THIS node's own bitcoind reconciliation
// (a HINT a follower re-proves — basis marks it as such, never an SPV re-proof). Depth is a MAX over anchors,
// never a sum, so a duplicated/fabricated anchor cannot inflate it. Thresholds are this node's OWN live
// ANCHOR_CONF/ANCHOR_FINAL, so the 'confirmed' boundary EQUALS the existing `verified` line by construction.
function nodeFinality(o) {
  let depth = 0, anchoredRoot = null, anchoredHeight = null, provenAnchors = 0
  for (const [number, a] of anchors.entries()) {
    if (!a || !a.real || a.simulated || !a.txid) continue   // dev/mempool markers (real:false/simulated) weigh nothing
    provenAnchors++
    const c = Number(a.confirmations) || 0
    if (c > depth) { depth = c; anchoredRoot = a.root ?? null; anchoredHeight = Number(number) }
  }
  return finalityView(o.cascadeRoot, o.seq, { depth, anchoredRoot, anchoredHeight, provenAnchors }, { confirmed: ANCHOR_CONF, deep: ANCHOR_FINAL, net: NET }, 'node-bitcoind-hint')
}
// THE BITCOIN HEIGHTS the explorer card "anchored at ₿" reads. genesis = first verified seal;
// anchored = latest verified seal. Height is Bitcoin's, never a KRAY block number. Missing
// btcHeight stays null (never invented) until bitcoind answers — fillMissingAnchorHeights.
function sealedAnchors() {
  let first = null, latest = null
  for (const [number, a] of anchors.entries()) {
    if (!a || !a.real || a.simulated || !a.verified) continue
    const row = {
      blockNumber: Number(number),
      txid: a.txid || null,
      btcHeight: a.btcHeight != null ? Number(a.btcHeight) : null,
      confirmations: Number(a.confirmations) || 0,
    }
    if (!first || row.blockNumber < first.blockNumber) first = row
    if (!latest || row.blockNumber > latest.blockNumber) latest = row
  }
  return { first, latest }
}
function statusPayload() {
  const { first, latest } = sealedAnchors()
  return {
    network: NET, seq: node.seq, latestBlock: tipNumber(),
    genesisBtcHeight: first && first.btcHeight != null ? first.btcHeight : null,
    anchoredBtcHeight: latest && latest.btcHeight != null ? latest.btcHeight : null,
    anchoredTxid: latest ? latest.txid : null,
    anchoredDepth: latest ? (latest.confirmations ?? null) : null,   // Bitcoin confirmations burying the latest sealed root — Bitcoin's own clock, not a node's word
  }
}
async function fillMissingAnchorHeights() {
  for (const [number, a] of anchors.entries()) {
    if (!a || !a.real || a.simulated || !a.txid || a.btcHeight != null) continue
    const st = await readAnchorStatus(a.txid)
    if (!st.ok || st.btcHeight == null) continue
    anchors.set(number, { ...a, btcHeight: st.btcHeight, confirmations: st.confirmations ?? a.confirmations })
    saveAnchors()
  }
  let selfDirty = false
  for (const s of selfAnchors.values()) {
    if (!s || !s.txid || Number.isInteger(s.btcHeight)) continue
    const st = await readAnchorStatus(s.txid)
    if (!st.ok || !Number.isInteger(st.btcHeight)) continue
    s.btcHeight = st.btcHeight
    selfAnchors.set(s.txid, s)
    selfDirty = true
  }
  if (selfDirty) saveSelfAnchors()
  // THE CLOCK ARRIVED — journal every verified donate that painted gold without a seal.
  // Order by Bitcoin height (non-decreasing). 1 or 1000, same law, no conflict.
  journalMissingSeals()
}
function headView() {
  const o = node.overview()
  // legacy shape stays BYTE-IDENTICAL (the 8 keys below); ADR-4 4a appends `finality` = { crane, anchor };
  // `v` (semver of the node software) is appended so any house can verify the same-commit law with a curl.
  return { height: o.seq, seq: o.seq, head: o.head, cascadeRoot: o.cascadeRoot, network: o.network, supply: o.supply, pot: o.pot, starCount: o.starCount, finality: nodeFinality(o), v: NODE_VERSION }
}
// ADR-3 3d — the live rules a stranger's claim is judged by. Deadline is read from the SIGNED
// bytes (`|deadline=D`), never an unsigned envelope field. Signature is this node's own verifier.
// Fail-closed: a missing identity or a throw is "not valid", never a crash into CENSORED.
function liveCensorshipRules() {
  return {
    keyOf: (act) => {
      const bytes = signedBytesOfEvent(act, NET)
      if (!bytes) throw new Error('the act has no signed identity')
      return keyFromSignedMessage(bytes)
    },
    isValid: (act) => {
      try {
        const from = String(act?.from || '')
        const bytes = signedBytesOfEvent(act, NET)
        if (!from || !bytes || !act?.signature || !act?.publicKey) return false
        return verifySignature(from, bytes, String(act.signature), String(act.publicKey), String(act.scheme || 'kraywallet'), toBtcNet(NET))
      } catch { return false }
    },
    deadlineOf: (act) => {
      try {
        const bytes = signedBytesOfEvent(act, NET)
        if (!bytes) return null
        const m = /\|deadline=(\d+)$/.exec(bytes)
        if (!m) return null
        const d = Number(m[1])
        return Number.isInteger(d) && d > 0 ? d : null
      } catch { return null }
    },
  }
}
function censorshipOpeningView() {
  const parts = node.ledger.cascadeParts()
  return {
    wired: 'verify-only',
    journal: false,
    automation: false,
    note: 'POST a claim to /api/kraynet/censorship/verify. This node runs verifyCensorshipAnchored and returns evidence. It does not write the journal and does not open succession.',
    inclusionActive: parts.inclusionRoot != null,
    seq: node.seq,
    cascadeRoot: node.cascadeRoot(),
    cascadeParts: parts,
    net: NET,
    minConfirmations: DONATION_MIN_CONF,
  }
}
function profileView(addr) {
  const starNos = node.starsOf(addr)
  // resolve each owned star to split inscriptions (wrote content) from baptisms (named it)
  const stars = starNos.map((no) => node.star(no)).filter(Boolean)
  const inscribed = stars.filter((s) => s && s.contentHash)
  const baptisms = stars.filter((s) => s && s.name).map((s) => ({ star: Number(s.no), name: s.name }))
  const nextStar = Number(node.ledger.stars.createdSeq)   // the number the next inscription will be born as
  const bal = node.balanceOf(addr).toString()             // v2: the whole balance is fungible ₭ (plain fuel)
  // the RELICS this citizen holds — every owned star as an object the profile's send/freeze pickers
  // read ({star, name, media, ctype, url, contentHash, held}). It was previously an array of bare
  // number-strings, which the pickers (expecting objects) rendered as "#NaN" — this is the shape
  // they actually consume. url / contentHash / held are additive: the chip paints the sealed face.
  const written = stars.map((s) => ({
    star: Number(s.no), name: s.name || null, ctype: s.contentType || null,
    media: !!(s.contentType && /^(image|video|audio)\//i.test(s.contentType)),
    contract: s.contract ?? null,
    contentHash: s.contentHash || null,
    url: s.contentHash ? '/content/' + s.contentHash : null,
    held: s.contentHash ? existsSync(join(CONTENT_DIR, s.contentHash)) : false,
  }))
  return {
    address: addr, network: NET, node: { height: node.seq },
    balance: bal, plain: bal, nonce: node.nonceOf(addr),
    stars: { total: starNos.length, free: [nextStar], list: starNos.map(String) },
    starCount: starNos.length, written,
    inscriptions: { total: inscribed.length },
    baptisms,
    freeStar: nextStar, freeStars: [nextStar],            // v2: not a pre-owned star — the next creation number
    supply: node.supply(), pot: node.pot(),
    // THE TWO LIGHTS (re-derived from the anchored journal, see docs/ACTIONS-MAP.md):
    //   ✦ glow — the soulbound count of stars this address froze, engraved on its stone (never transfers);
    //   Ӿ      — the transferable token born 1:1 from this address's own ₭ burns (a distinct token, not ₭).
    // x = the lifetime Ӿ this address minted from its own burns (the engraved record, never rewritten);
    // xSpendable = what it can move NOW by x-send (live from the ratified activation seq).
    // fireTank = THE FIREBORN LAW's remaining feeless x-send allowance (F per ₭ burned, lifetime; spendable
    // at/after the feeless activation seq — the door quotes the prescribed fee, never the client).
    // laneX = this address's Ӿ inside the TK-fold compressed lane (Gate 2; 0 until the fold activates).
    lights: { glow: glowOf(events, addr), glowSymbol: GLOW_SYMBOL, x: node.ledger.xMintedOf(addr).toString(), xSpendable: node.ledger.xBalanceOf(addr).toString(), xSymbol: 'Ӿ', fireTank: node.ledger.fireTankOf(addr).toString(), laneX: node.ledger.laneBalanceOf(addr).toString() },
    luz: node.ledger.cuts.holdingsOf(addr).map((h) => ({ ...h, name: 'Luz', glyph: '✧' })),
  }
}

// ══ THE BLOCK / SEAL LAYER over the journal ══════════════════════════════════
// The store is a pure journal; the explorer reads BLOCKS. Fast blocks live in
// memory on the same merkle/hash shape as `block.ts`. A real bitcoind names a
// cascade on Bitcoin when wired. Offline, a synthetic txid may stand in — it is
// marked simulated, never a Bitcoin seal. The 49-byte payload is always
// KrayAnchor.payload(number, cascadeRoot).
const ZERO64 = '0'.repeat(64)
const APP_DIR = __dir                                 // apps/kray-net — the rich front-end + assets
const CONTENT_DIR = join(DATA_DIR, 'content')         // v2's content store — inscribed bytes, content-addressed
mkdirSync(CONTENT_DIR, { recursive: true })
// THE ATLAS DOOR PROOF — /content/<hash> serves bytes BY NAME, and the name IS the sha256 (A5).
// Without this, a swapped disk file could speak wrong bytes through an honest hash while the
// journal still holds the truth. So the door re-derives the hash and refuses a mismatch — the
// curtain (signature ‖ Merkle ‖ anchor) reaches the disk's mouth. A proven file is remembered
// by (size, mtime); any touch re-proves. Operational stitch only: no root, no consensus change.
const contentProven = new Map()                       // hash → `${size}:${mtimeMs}` already re-derived
function heldContentPath(hash) {
  const path = join(CONTENT_DIR, hash)
  try {
    if (!existsSync(path)) return { path, held: false, ok: false }
    const st = statSync(path)
    const stamp = `${st.size}:${Math.trunc(st.mtimeMs)}`
    if (contentProven.get(hash) === stamp) return { path, held: true, ok: true }
    const ok = createHash('sha256').update(readFileSync(path)).digest('hex') === hash
    if (ok) contentProven.set(hash, stamp)
    else console.error(`atlas door: ${hash.slice(0, 12)}… on disk does not hash to its name — refusing to serve the lie`)
    return { path, held: true, ok }
  } catch { return { path, held: false, ok: false } }
}
const CONTENT_CORRUPT = 'this node holds bytes that do not hash to this name — the journal is still right; restore the atlas copy'
/** Artist art source — writer-only, never journaled (a replica would leak the drop). */
const MINT_SHELF_FILE = join(DATA_DIR, 'mint-shelves.json')
const SEAL_MS = parseInt(process.env.KRAY_SEAL_MS || '3500', 10) || 3500
const ANCHOR_EVERY = parseInt(process.env.KRAY_ANCHOR_EVERY || '4', 10) || 4
// how deep the anchor must bury before it counts as VERIFIED. On regtest the node mines these itself
// (the seal is instant); on signet/main the world's miners do, so the anchor confirms on Bitcoin's clock.
// Mainnet defaults to 6 (reorg-hard); signet to 2 (fast test feedback); regtest to 1 (self-mined).
// Clamp to a POSITIVE floor — a 0/NaN/negative would make `confirmations >= ANCHOR_CONF` true at 0 conf
// (a false seal in the mempool). `|| 1` alone rescues 0/NaN but not a negative, so validate explicitly.
const ANCHOR_CONF = (() => { const n = parseInt(process.env.KRAY_ANCHOR_CONF || (NET === 'regtest' ? '1' : NET === 'main' ? '6' : '2'), 10); return Number.isInteger(n) && n > 0 ? n : 1 })()
// how often the watch re-checks broadcast-but-unconfirmed anchors (and retries any that never broadcast).
const ANCHOR_WATCH_MS = parseInt(process.env.KRAY_ANCHOR_WATCH_MS || '20000', 10) || 20000
// depth past which an anchor is FINAL — no reorg reaches this far, so the watch stops re-polling it (cheap forever).
const ANCHOR_FINAL = parseInt(process.env.KRAY_ANCHOR_FINAL || '100', 10) || 100
// does this node BURY its own anchors? On regtest it controls the chain, so it mines them in (instant seal);
// on signet/main the world's miners do (the watch confirms later). Default: yes on regtest, no elsewhere.
const ANCHOR_SELF_MINE = process.env.KRAY_ANCHOR_SELF_MINE != null ? process.env.KRAY_ANCHOR_SELF_MINE === '1' : (NET === 'regtest')
// SLICE 2c — THE OPERATOR ANCHOR IS RETIRED BY DEFAULT. Anchoring now comes from the donations themselves
// (each burn IS the anchor — Slice 2a weighs it in fork-choice) and from the any-guardian backstop (Slice 2b).
// KRAY_OPERATOR_ANCHOR=1 keeps the operator OP_RETURN as an explicit last resort a node-runner can enable —
// removing a PARTY, never a check: every anchor stays SPV-proven and replay-verified exactly as before.
// (Offline dev with no bitcoind keeps its clearly-marked SIMULATED anchors — they never touch Bitcoin or the window.)
const OPERATOR_ANCHOR = process.env.KRAY_OPERATOR_ANCHOR === '1'
// the real Bitcoin seal txids, persisted beside the journal. A Bitcoin txid is an EXTERNAL fact — it
// cannot be derived from the journal, only VERIFIED by SPV — so we cache which tx carries which block's
// root here, and re-load it on boot instead of re-broadcasting. The commitment itself stays in the OP_RETURN.
const ANCHOR_FILE = join(DATA_DIR, 'anchors.json')
const BLOCKS_FILE = join(DATA_DIR, 'blocks.json')   // the sealed fast-block segmentation, durable across restarts
// PHASE 3 · the SELF-ANCHOR LOG — a burn donation's own output carries a pay-to-contract commitment of a cascade
// root. Unlike the operator OP_RETURN anchor, the anchor rides the donation itself (keyless, no operator spend).
// This registry records each one as a PROVEN anchor: {txid, vout, blockNumber, root, sats, donor}. It is proven by
// athe owner boxe re-deriving selfAnchorScriptHex(POT_INTERNAL_KEY, KrayAnchor.payload(blockNumber, root)) and matching the
// on-chain output — AND root === the cascade root this node sealed at blockNumber. Additive: it sits ALONGSIDE
// the operator anchor log for now (Slice 1); retiring the operator OP_RETURN is a later, reviewed step.
const SELF_ANCHOR_FILE = join(DATA_DIR, 'self-anchors.json')
// THE VAULT WATCHER (read-only, by law) — every PROVEN rune deposit registers its vault outpoint here;
// every PROVEN settle releases the outpoints its payout actually spent; a periodic sweep asks bitcoind
// whether each backing UTXO still exists and ALARMS on any spend the book never blessed. Eyes, no hands:
// it holds no keys, signs nothing, mutates no ledger state — the verdict logic is pure (vault-watch.ts).
const VAULT_WATCH_FILE = join(DATA_DIR, 'vault-watch.json')

const events = []                 // every journal event, in seq order (events[seq-1])
const eventByHash = new Map()     // hash -> event
const seqToStarNo = new Map()     // creating-event seq -> star creation number (string)
const seqToBurn = new Map()       // creative-act seq -> ₭ burned into the star (historical, era-priced)
// THE FIRE TALLY — display of ₭ destroyed into stars (inscribe/origin/name/v2 law). Consensus
// authority is ledger.totalBurned; this is the kind-split the black-hole page reads. Chosen ₭
// sent to the hole is a different sink (still in Σ at BLACK_HOLE) and is added at read time.
const fireTally = { inscribe: 0n, origin: 0n, name: 0n, law: 0n, sporadic: 0n, acts: 0 }   // sporadic = the signed burn (₭ died by choice, Ӿ born)
const blocks = []                 // sealed fast blocks; blocks[n].number === n
const anchors = new Map()         // blockNumber -> { txid, confirmations, root, verified, btcHeight, btcChain }
const selfAnchors = new Map()     // txid -> { txid, vout, blockNumber, root, sats, donor, at } — donations that ARE anchors
let anchorQueue = Promise.resolve() // serializes real anchor broadcasts so two never spend the same UTXO
let lastSealedSeq = 0
let bornCount = 0                 // stars born so far (to map a LIVE creation to its event)

// ── the live SSE fan-out (block on every seal, anchor on every seal-to-Bitcoin) ──
const sseClients = new Set()
function broadcast(type, data) {
  if (!sseClients.size) return
  const frame = 'event: ' + type + '\ndata: ' + JSON.stringify(data ?? {}) + '\n\n'
  for (const res of sseClients) { try { res.write(frame) } catch (_) { sseClients.delete(res) } }
}
function sseHandler(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
    'x-accel-buffering': 'no',
  })
  res.write('retry: 3000\n\n')
  res.write('event: hello\ndata: ' + JSON.stringify({ ok: true, network: NET, height: blocks.length - 1 }) + '\n\n')
  sseClients.add(res)
  const ka = setInterval(() => { try { res.write(': keepalive\n\n') } catch (_) {} }, 25000)
  req.on('close', () => { clearInterval(ka); sseClients.delete(res) })
}

// which star (creation number) a LIVE creative event birthed — the createdSeq counter
// grew by exactly one for a non-cursed inscribe/origin/name, so that star is (count-1).
function noteStar(e) {
  if (e.kind !== 'inscribe' && e.kind !== 'origin' && e.kind !== 'name') return
  const now = Number(node.ledger.stars.createdSeq)
  if (now > bornCount) { seqToStarNo.set(e.seq, String(now - 1)); bornCount = now }
}
function ingest(e, live) {
  events.push(e); eventByHash.set(e.hash, e); if (live) noteStar(e)
  // live creative acts: the ledger has just applied them, so bytesPerKray is still THIS era
  // (retarget fires on seal, not on inscribe). Boot history is indexed separately below.
  if (live) noteBurn(e, node.ledger.bytesPerKray)
  if (live && e.kind === 'contract-call' && node.ledger.lastCall) {
    callReceipts.set(e.hash, { hash: e.hash, seq: e.seq, ...node.ledger.lastCall })
  }
}
function noteBurn(e, rate) {
  if (e.kind === 'burn') {
    // the sporadic burn — ₭ destroyed by signature, Ӿ born 1:1 (the ratified law's door)
    seqToBurn.set(e.seq, String(e.amount ?? '0'))
    fireTally.sporadic += BigInt(e.amount ?? 0)
    fireTally.acts += 1
    return
  }
  if (e.kind === 'contract' && e.star != null) {
    seqToBurn.set(e.seq, '1')
    fireTally.law += 1n
    fireTally.acts += 1
    return
  }
  if (e.kind !== 'inscribe' && e.kind !== 'origin' && e.kind !== 'name') return
  const amt = starBurnOf(e.kind === 'name' ? undefined : e.size, rate)
  seqToBurn.set(e.seq, amt.toString())
  fireTally[e.kind] += amt
  fireTally.acts += 1
}
// Replay the size-burn schedule over the journal so a TX page shows what WAS burned, not
// today's era. Mirrors ledger.ts seal-breath (display only — never consensus).
function indexHistoricalBurns(evs) {
  const pin = SIZE_PROPORTION_ACTIVATION_SEQ[NET] ?? Number.MAX_SAFE_INTEGER
  let rate = pin === 0 ? BYTES_PER_KRAY_PROPORTION : BYTES_PER_KRAY_BURN
  let snapped = pin === 0
  let sealsSeen = 0, windowBytes = 0
  for (const e of evs) {
    if (!snapped && pin !== Number.MAX_SAFE_INTEGER && Number(e.seq) >= pin) {
      rate = BYTES_PER_KRAY_PROPORTION
      snapped = true
    }
    noteBurn(e, rate)
    if (e.kind === 'inscribe' || e.kind === 'origin') windowBytes += Number(e.size ?? 0)
    if (e.kind === 'seal') {
      sealsSeen += 1
      if (sealsSeen % RETARGET_WINDOW_SEALS === 0) {
        const min = (snapped || pin === 0) ? BYTES_PER_KRAY_MIN_PROPORTION : BYTES_PER_KRAY_MIN
        rate = retargetBytesPerKray(rate, windowBytes, min)
        windowBytes = 0
      }
    }
  }
}

// read the whole journal from disk on boot — the store's own append-only file (public path)
function loadJournalEvents() {
  const jp = node.store.journalPath
  if (!existsSync(jp)) return []
  const out = []
  for (const line of readFileSync(jp, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { break } // a torn tail was already truncated at replay
  }
  return out
}

function sealBlock(fromSeq, toSeq, at) {
  const leaves = events.slice(fromSeq - 1, toSeq).map((e) => e.hash)
  const number = blocks.length
  const body = {
    number, prevHash: number ? blocks[number - 1].hash : ZERO64,
    fromSeq, toSeq, txCount: leaves.length, merkleRoot: buildMerkleRoot(leaves), at,
  }
  // cascadeRoot is added AFTER hashing (so the block hash is unchanged) — it is the whole-state commitment
  // this block seals, and the STABLE key an anchor is tracked by (block NUMBER is not stable across reboots,
  // which collapse history into block #0; the cascade root is). It re-derives byte-exact from the journal.
  const b = { ...body, hash: blockHash(body), cascadeRoot: node.cascadeRoot() }
  blocks.push(b)
  lastSealedSeq = toSeq
  saveBlocks()        // persist the segmentation durably — block numbers now survive a restart
  return b
}
// ── BLOCK PERSISTENCE — the sealed segmentation is a durable atomic mirror of blocks[]. On boot it is
//    trusted ONLY if it re-derives against the journal that just replayed: contiguous seq from 1, matching
//    merkle roots and prev-hash chain, and — when it seals to the tip — the same whole-state cascade root
//    the node re-derived. Any mismatch discards the WHOLE sidecar and falls back to the single collapse, so
//    a stale or torn file can never wedge the boot or mislabel a block. This is what stops a reboot from
//    re-collapsing history into #0, re-anchoring it, and spawning a bookkeeping receipt block every restart.
function saveBlocks() {
  try {
    const tmp = BLOCKS_FILE + '.tmp'
    const fd = openSync(tmp, 'w'); writeSync(fd, JSON.stringify(blocks)); fsyncSync(fd); closeSync(fd)
    renameSync(tmp, BLOCKS_FILE)
  } catch (e) { console.error('block persist failed:', e.message) }
}
function loadPersistedBlocks() {
  if (!existsSync(BLOCKS_FILE)) return null
  let loaded
  try { loaded = JSON.parse(readFileSync(BLOCKS_FILE, 'utf8')) } catch { return null }
  if (!Array.isArray(loaded) || !loaded.length) return null
  let expectSeq = 1
  for (let i = 0; i < loaded.length; i++) {
    const b = loaded[i]
    if (!b || b.number !== i || b.fromSeq !== expectSeq || !Number.isInteger(b.toSeq) || b.toSeq < b.fromSeq || b.toSeq > events.length) return null
    if (b.prevHash !== (i ? loaded[i - 1].hash : ZERO64)) return null
    const leaves = events.slice(b.fromSeq - 1, b.toSeq).map((e) => e.hash)
    if (buildMerkleRoot(leaves) !== b.merkleRoot) return null
    expectSeq = b.toSeq + 1
  }
  const last = loaded[loaded.length - 1]
  if (last.toSeq === events.length && last.cascadeRoot !== node.cascadeRoot()) return null   // strongest tamper check
  return loaded
}
// THE ANCHOR STATES — a real anchor moves: pending (no txid yet) → broadcast (txid, <ANCHOR_CONF conf)
//   → verified (txid, ≥ANCHOR_CONF conf, buried under work). `verified` is the ONLY honest "sealed on
//   Bitcoin" flag: it is NEVER set until the tx is genuinely confirmed to the required depth. On regtest
//   the node mines instantly so a seal is verified at once; on signet/main the watch confirms it later.
// The sidecar caches, per anchor, {number, root, txid, rawHex, confirmations, verified, btcHeight} — a Bitcoin
// txid is an EXTERNAL fact (only SPV-verifiable, never derivable from the journal), reloaded on boot, never
// re-funded. A placeholder (real:false, no bitcoind) is SIMULATED and NEVER 'verified' — verified means buried.
function loadAnchors() {
  if (!existsSync(ANCHOR_FILE)) return
  try {
    for (const a of JSON.parse(readFileSync(ANCHOR_FILE, 'utf8'))) {
      const real = a.real !== false
      const confirmations = a.confirmations ?? 0
      // derive verified from the persisted CONFIRMATIONS, not a raw flag — a sidecar entry claiming
      // verified:true with too-few confirmations (corruption/forgery) can never be trusted as a seal.
      anchors.set(a.number, { txid: a.txid || null, rawHex: a.rawHex || null, confirmations, root: a.root, verified: real ? confirmations >= ANCHOR_CONF : false, btcHeight: a.btcHeight ?? null, btcChain: a.btcChain ?? null, pending: real ? !a.txid : false, real, simulated: !real })
    }
  } catch { /* a torn sidecar (writes are atomic below, so this is rare) is rebuilt as blocks re-anchor */ }
}
function saveAnchors() {
  const out = [...anchors.entries()].map(([number, a]) => ({ number, txid: a.txid, root: a.root, rawHex: a.rawHex || null, confirmations: a.confirmations, verified: a.verified, btcHeight: a.btcHeight, btcChain: a.btcChain, real: a.real !== false, simulated: !!a.simulated }))
  // DURABLE ATOMIC write: fsync the tmp to disk, THEN rename (atomic on POSIX). A torn/unflushed file would
  // drop external txids the journal cannot re-derive (→ a re-funded duplicate anchor). fsync closes that window.
  try {
    const tmp = ANCHOR_FILE + '.tmp'
    const fd = openSync(tmp, 'w'); writeSync(fd, JSON.stringify(out)); fsyncSync(fd); closeSync(fd)
    renameSync(tmp, ANCHOR_FILE)
  } catch (e) { console.error('anchor persist failed:', e.message) }
}

// ── THE SELF-ANCHOR LOG (Slice 1) — record a burn donation that provably sealed a real cascade root ──
function saveSelfAnchors() {
  try {
    const tmp = SELF_ANCHOR_FILE + '.tmp'
    const fd = openSync(tmp, 'w'); writeSync(fd, JSON.stringify([...selfAnchors.values()])); fsyncSync(fd); closeSync(fd)
    renameSync(tmp, SELF_ANCHOR_FILE)
  } catch (e) { console.error('self-anchor persist failed:', e.message) }
}
function loadSelfAnchors() {
  try { if (existsSync(SELF_ANCHOR_FILE)) { const arr = JSON.parse(readFileSync(SELF_ANCHOR_FILE, 'utf8')); if (Array.isArray(arr)) for (const s of arr) if (s && s.txid) selfAnchors.set(s.txid, s) } }
  catch (e) { console.error('self-anchor load failed:', e.message) }
}

// ── THE VAULT WATCHER — the eye that never blinks (read-only; verdicts are pure, vault-watch.ts) ──
let vaultWatch = []                 // WatchedOutpoint[] — the registry of vault backing outpoints
let vaultWatchLast = { at: 0, backed: 0, released: 0, alarms: [] }   // the latest sweep's verdicts
const VAULT_WATCH_SEC = Math.max(10, Number(process.env.KRAY_VAULT_WATCH_SEC || 60))
// THE SETTLEMENT REFLEX (Slice 2, OPT-IN) — flag default OFF, so the running network is byte-identical
// until an operator turns it on. When on, a depositor can lodge a fully co-signed cooperative settlement
// of their vault (owner + guardians, no timelock) that keeps them EXACTLY their L2 book balance; the node
// verifies its SAFETY against its OWN book (never a client claim) before storing, and the watcher
// BROADCASTS it the instant that vault is drained — the stale escape then loses the race for the outpoint.
const PRESIGNED_SETTLEMENT = process.env.KRAY_PRESIGNED_SETTLEMENT === '1'
// RUNG 5 — per-recipient settlement routing: one pot withdraw pays every other open, compatible
// exit of the rune as extra outputs (the LOAF). Enable ONLY after the whole fleet replays the
// delivery-outpoint settle law (an old follower HALTs on the second burn of one txid).
const EXIT_LOAF = process.env.KRAY_EXIT_LOAF === '1'
const VAULT_SETTLE_FILE = join(DATA_DIR, 'vault-settlements.json')
const settlementByOutpoint = new Map()   // "txid:vout" -> { runeId, cosignedTxHex, depositorCap, storedAt, broadcastTxid? }
function saveSettlements() {
  try {
    const tmp = VAULT_SETTLE_FILE + '.tmp'
    const fd = openSync(tmp, 'w'); writeSync(fd, JSON.stringify([...settlementByOutpoint.entries()])); fsyncSync(fd); closeSync(fd)
    renameSync(tmp, VAULT_SETTLE_FILE)
  } catch (e) { console.error('vault-settlement persist failed:', e.message) }
}
function loadSettlements() {
  try { if (existsSync(VAULT_SETTLE_FILE)) { const arr = JSON.parse(readFileSync(VAULT_SETTLE_FILE, 'utf8')); if (Array.isArray(arr)) for (const [k, v] of arr) settlementByOutpoint.set(k, v) } }
  catch (e) { console.error('vault-settlement load failed:', e.message) }
}
function saveVaultWatch() {
  // same DURABLE ATOMIC discipline as the anchor log: a watched outpoint is an external fact the
  // journal cannot re-derive (the vault address came from deposit-time params), so it must survive.
  try {
    const tmp = VAULT_WATCH_FILE + '.tmp'
    const fd = openSync(tmp, 'w'); writeSync(fd, JSON.stringify(vaultWatch)); fsyncSync(fd); closeSync(fd)
    renameSync(tmp, VAULT_WATCH_FILE)
  } catch (e) { console.error('vault-watch persist failed:', e.message) }
}
function loadVaultWatch() {
  try { if (existsSync(VAULT_WATCH_FILE)) { const arr = JSON.parse(readFileSync(VAULT_WATCH_FILE, 'utf8')); if (Array.isArray(arr)) vaultWatch = arr.filter((w) => w && validateWatch(w).ok) } }
  catch (e) { console.error('vault-watch load failed:', e.message) }
}
/** Register one PROVEN deposit's vault outpoint. Idempotent; junk never enters (validateWatch). */
function watchVaultOutpoint(w) {
  if (!validateWatch(w).ok) return
  if (vaultWatch.some((x) => x.outpoint === w.outpoint)) return
  vaultWatch.push(w); saveVaultWatch()
}
/** 0-conf or buried: the pot remainder is the next loaf's metal. changeVout defaults to 2 (one dest). */
async function watchExitPayoutChange(txid, changeVout, runeIdStr, rid, rec) {
  const changeRunes = await ordOutputRuneAmount(txid, changeVout, rid).catch(() => 0n)
  if (changeRunes <= 0n) return 0n
  const pool = consolidationVault()
  const changeKind = rec.changeKind || (pool ? 'consolidation' : 'vault')
  const changeVault = rec.changeVault || (pool && pool.address) || rec.vault
  watchVaultOutpoint({
    outpoint: `${txid}:${changeVout}`, runeId: runeIdStr, vault: changeVault,
    amount: changeRunes.toString(), depositor: changeKind === 'consolidation' ? '' : rec.depositor,
    at: Date.now(), kind: changeKind,
  })
  return changeRunes
}
// ── THE USER-FUNDED EXIT PAYOUT (the bakery-tab last mile) ────────────────────────────────────────
// The exiter taps "withdraw": the node BUILDS the vault spend (exit-payout.ts — runes from THEIR
// vault, postage + fee from THEIR sats, destination = the address their rune-exit SIGNED), the
// wallet signs both inputs via BIP-371 PSBT, the lab guardians co-sign here, the node broadcasts,
// and the reconcile loop below settles the lock through the SAME sacred path as every settle.
// Built payouts are in-memory only (the wallet re-asks after a reboot — nothing is lost); the
// broadcast txids persist so a reboot still settles what already hit the chain.
const pendingExitPsbts = new Map()       // "from|runeId" -> { payout, at }
const EXIT_PAYOUT_FILE = join(DATA_DIR, 'exit-payouts.json')
let exitPayouts = []                     // [{ from, runeId, txid, vault, depositor, settledSeq? }]
function saveExitPayouts() {
  try {
    const tmp = EXIT_PAYOUT_FILE + '.tmp'
    const fd = openSync(tmp, 'w'); writeSync(fd, JSON.stringify(exitPayouts)); fsyncSync(fd); closeSync(fd)
    renameSync(tmp, EXIT_PAYOUT_FILE)
  } catch (e) { console.error('exit-payout persist failed:', e.message) }
}
function loadExitPayouts() {
  try { if (existsSync(EXIT_PAYOUT_FILE)) { const arr = JSON.parse(readFileSync(EXIT_PAYOUT_FILE, 'utf8')); if (Array.isArray(arr)) exitPayouts = arr } }
  catch (e) { console.error('exit-payout load failed:', e.message) }
}
loadExitPayouts()
// ── THE REHOME (protocol leftover only) — moves personal-vault metal into the
// shared consolidation pot in ONE co-signed L1 transaction, WITHOUT exiting a single credit.
// After it confirms, everything they hold is pot-backed: they may pay athe owner boxe, and athe owner boxe they
// pay can withdraw without them. Drafts are in-memory (rebuilt after a reboot); broadcast txids
// persist so a reboot still journals the rune-rehome once the move is buried.
const pendingRehomePsbts = new Map()     // "from|runeId" -> { payout, at }
const REHOME_FILE = join(DATA_DIR, 'rehome-payouts.json')
let rehomePayouts = []                   // [{ from, runeId, txid, at, doneSeq? }]
function saveRehomes() {
  try {
    const tmp = REHOME_FILE + '.tmp'
    const fd = openSync(tmp, 'w'); writeSync(fd, JSON.stringify(rehomePayouts)); fsyncSync(fd); closeSync(fd)
    renameSync(tmp, REHOME_FILE)
  } catch (e) { console.error('rehome persist failed:', e.message) }
}
function loadRehomes() {
  try { if (existsSync(REHOME_FILE)) { const arr = JSON.parse(readFileSync(REHOME_FILE, 'utf8')); if (Array.isArray(arr)) rehomePayouts = arr } }
  catch (e) { console.error('rehome load failed:', e.message) }
}
loadRehomes()
/** THE REHOME RECONCILER — once a broadcast rehome is buried, verify it pays the ONE canonical
 *  pot, journal the rune-rehome (the book's backing follows the metal), release the spent
 *  personal outpoints and put the pot outpoint under the watcher's eye. Idempotent, per sweep. */
async function reconcileRehomes() {
  const pool = consolidationVault()
  if (!pool) return
  for (const rec of rehomePayouts) {
    if (rec.doneSeq != null || !rec.txid) continue
    const rid = parseRuneKey(rec.runeId)
    const proof = await spvProofFor(rec.txid, DONATION_MIN_CONF).catch(() => null)
    if (!proof) continue                                   // not buried yet — next sweep retries
    let buried
    try { buried = proveTxBuried(proof.rawTx, proof.txoutproof, proof.headers, { net: NET, minConfirmations: DONATION_MIN_CONF }) } catch { continue }
    if (!buried.ok) continue
    const parsed = parseTx(proof.rawTx)
    // output 0 must pay the ONE canonical pot — read from OUR bytes, never a claim
    const out0 = parsed.outputScripts[0] ? Buffer.from(parsed.outputScripts[0]).toString('hex') : ''
    if (out0 !== pool.scriptHex) { rec.doneSeq = -2; saveRehomes(); console.error(`   ⚖ REHOME REFUSED — ${rec.txid.slice(0, 12)}… does not pay the canonical pot; not journaled`); continue }
    const potRunes = await ordOutputRuneAmount(rec.txid, 0, rid).catch(() => 0n)
    if (potRunes <= 0n) continue                           // ord not caught up yet — retry
    try {
      if (node.ledger.runes.personalOf(rid, rec.from) > 0n) {
        const ev = node.runeRehome(rec.runeId, rec.from, rec.txid, `${rec.txid}:0`, 0, potRunes)
        rec.doneSeq = ev.seq
      } else rec.doneSeq = -1                              // already pot-backed (settled elsewhere)
      saveRehomes()
      // the eye follows the metal: personal outpoints this move spent are released by the spend
      // itself; the pot outpoint now backs the book and is watched as shared custody
      vaultWatch = markReleased(vaultWatch, parsed.inputs.map((i) => `${i.txid}:${i.vout}`), rec.txid); saveVaultWatch()
      watchVaultOutpoint({ outpoint: `${rec.txid}:0`, runeId: rec.runeId, vault: pool.address, amount: potRunes.toString(), depositor: '', at: Date.now(), kind: 'consolidation' })
      console.error(`   ⚖ BAKERY OPEN — ${rec.from.slice(0, 12)}… rehomed ${potRunes} of ${rec.runeId} to the pot (${rec.txid.slice(0, 12)}…:0); every credit they hand out is now withdrawable without them`)
      broadcast('rune-rehomed', { from: rec.from, runeId: rec.runeId, txid: rec.txid, amount: potRunes.toString() })
    } catch (e) { console.error('   ⚖ rehome journal failed (will retry):', e.message) }
  }
}
/** Estimate the payout's vsize from the federation's shape — conservative, so the user's chosen
 *  rate is honoured (never undershot into a stuck tx). */
function estimatePayoutVsize(fed, vaultInputs, outputs) {
  const n = fed.guardians.length, t = fed.threshold
  const leafLen = 35 * (n + 1) + 4
  const witness = t * 66 + (n - t) + 66 + leafLen + 66 + 8
  const perVault = 41 + Math.ceil(witness / 4)
  const funding = 41 + 17
  return 11 + outputs * 45 + vaultInputs * perVault + funding + 4
}
/** THE RECONCILER — once a broadcast payout is buried, settle the lock through the sacred path and
 *  put the rune CHANGE outpoint back under the watcher's eye. Idempotent; retried every sweep. */
async function reconcileExitPayouts() {
  for (const rec of exitPayouts) {
    if (rec.settledSeq != null || !rec.txid) continue
    const rid = parseRuneKey(rec.runeId)
    const stillOpen = node.ledger.runes.lockedOf(rid, rec.from)
    if (!stillOpen) { rec.settledSeq = -1; saveExitPayouts(); continue } // settled elsewhere
    const r = await proveAndSettleRuneExit(rec.from, rec.runeId, rec.txid, { loaf: !!rec.loaf }).catch((e) => ({ error: e.message }))
    if (!r.ok) continue // not buried yet — the next sweep retries; nothing mutates on failure
    rec.settledSeq = r.seq; saveExitPayouts()
    // the rune change (output 2 on a one-dest loaf, N+1 on a batch) is reserve again.
    // A RIDER's record (rung 5) carries no change to re-watch — the initiator's record does.
    if (rec.rider) { broadcast('rune-exit-paid', { from: rec.from, runeId: rec.runeId, txid: rec.txid, seq: r.seq }); continue }
    try {
      const changeVout = rec.changeVout != null ? Number(rec.changeVout) : 2
      const changeRunes = await watchExitPayoutChange(rec.txid, changeVout, rec.runeId, rid, rec)
      if (changeRunes > 0n) {
        const changeKind = rec.changeKind || (consolidationVault() ? 'consolidation' : 'vault')
        console.error(`   ⚖ EXIT PAYOUT SETTLED — lock burned at seq ${r.seq}; change ${changeRunes} re-watched as ${changeKind} at ${rec.txid.slice(0, 12)}…:${changeVout}`)
        // THE BOOK FOLLOWS THE METAL — a personal-path payout parked its remainder in the POT
        // (the pointer pad). Any personal backing the settle did not burn physically lives there now,
        // so journal the rehome fact: the exiter's leftover credits become pot-backed (freely
        // sendable, and their recipients withdraw without them). Same L1 tx = the audit trail.
        if (changeKind === 'consolidation' && node.ledger.runes.personalOf(rid, rec.from) > 0n) {
          try {
            const rev = node.runeRehome(rec.runeId, rec.from, rec.txid, `${rec.txid}:${changeVout}`)
            console.error(`   ⚖ BAKERY OPEN (via withdraw) — the remainder parked in the pot; personal backing rehomed at seq ${rev.seq}`)
          } catch (e2) { console.error('   ⚖ could not journal the remainder rehome (will not retry — the gate stays conservative):', e2.message) }
        }
      } else {
        console.error(`   ⚖ EXIT PAYOUT SETTLED — lock burned at seq ${r.seq}; no rune change to re-watch`)
      }
    } catch (e) { console.error('   ⚖ could not re-watch the exit-payout change:', e.message) }
    broadcast('rune-exit-paid', { from: rec.from, runeId: rec.runeId, txid: rec.txid, seq: r.seq })
  }
}
/**
 * PROVE + SETTLE A RUNE EXIT — the one place the exit's phase two lives, so the HTTP endpoint and the
 * watcher's reflex reconcile through the IDENTICAL sacred path: SPV-prove the payout, refuse a cenotaph,
 * require EXACTLY the locked amount at the SIGNED destination, then burn the lock (reserve falls in step).
 * Returns {ok, ...} or {error, status}. Never mutates on any failure — a lock burns only on a genuine,
 * exact, buried delivery. This is what makes a reflex-broadcast settlement reconcile the L2 book without
 * a new ledger rule: the forced exit settles exactly as a voluntary one does.
 */
async function proveAndSettleRuneExit(from, runeIdStr, txid, opts = {}) {
  if (!btcConfigured()) return { error: 'this node has no bitcoind RPC configured — it cannot SPV-prove an L1 payout', status: 501 }
  const rid = parseRuneKey(runeIdStr)
  const lock = node.ledger.runes.lockedOf(rid, from)
  if (!lock) return { error: 'no open exit for that address + rune — nothing to settle', status: 400 }
  const proof = await spvProofFor(txid, DONATION_MIN_CONF).catch((e) => ({ __err: e.message }))
  if (proof.__err) return { error: 'could not fetch the payout proof from bitcoind — ' + proof.__err, status: 400 }
  let buried
  try { buried = proveTxBuried(proof.rawTx, proof.txoutproof, proof.headers, { net: NET, minConfirmations: DONATION_MIN_CONF }) }
  catch (e) { return { error: 'the payout is not buried under enough work — ' + (e instanceof Error ? e.message : String(e)), status: 400 } }
  if (!buried.ok) return { error: 'the payout is not buried under enough work — ' + buried.reason, status: 400 }
  const parsed = parseTx(proof.rawTx)
  const art = decipher(parsed.outputScripts.map((s) => Uint8Array.from(s)))
  if (art && art.kind === 'cenotaph') return { error: 'the L1 payout is a cenotaph — it would burn the runes, refused', status: 400 }
  const targetScriptHex = scriptOfAddress(lock.l1Address, toBtcNet(NET))
  // THE DELIVERY OUTPUT — on a solo payout the first script match (historic behavior); on a LOAF
  // (rung 5: one pot tx, many exits) scan every script match for the one that delivers EXACTLY this
  // lock's amount and has not burned an exit yet (one delivery, one burn — the book's own key).
  let targetIdx = -1
  for (let oi = 0; oi < parsed.outputScripts.length; oi++) {
    if (Buffer.from(parsed.outputScripts[oi]).toString('hex') !== targetScriptHex) continue
    if (opts.loaf && node.ledger.runes.wasSettled(`${buried.txid}:${oi}`)) continue
    const got = await ordOutputRuneAmount(buried.txid, oi, rid).catch(() => 0n)
    if (got === lock.amount) { targetIdx = oi; break }
    if (targetIdx < 0 && !opts.loaf) { targetIdx = oi; break } // solo: first match judges (historic)
  }
  if (targetIdx < 0) return { error: 'the L1 payout does not pay the SIGNED destination — refused', status: 400 }
  if (parsed.outputValues[targetIdx] < dustFromEnv(process.env, 'p2tr')) return { error: 'the rune output is below the dust — it would not relay', status: 400 }
  const delivered = await ordOutputRuneAmount(buried.txid, targetIdx, rid).catch(() => 0n)
  if (delivered !== lock.amount) return { error: `the L1 payout delivered ${delivered} of the rune to the signed destination, not the ${lock.amount} it locked — refused (per ord, the normative indexer)`, status: 400 }
  // ADR-1 (runes): journal the payout's own proof so a cold replay re-proves the burn from bytes.
  // inputRunes read from the payout's OWN outputs (Σ in == Σ out — no cenotaph, no burn, both already
  // enforced); ord cannot answer for the spent inputs. Same attestation class, answerable.
  let attachSettleProof
  if (CONSENSUS_RUNE_PROOF) {
    let totalIn = 0n
    for (let oi = 0; oi < parsed.outputScripts.length; oi++) {
      totalIn += await ordOutputRuneAmount(buried.txid, oi, rid).catch(() => 0n)
    }
    const inputRunes = totalIn > 0n ? [{ id: runeIdStr, amount: totalIn.toString() }] : []
    attachSettleProof = { rawTx: proof.rawTx, txoutproof: proof.txoutproof, headers: proof.headers, inputRunes }
    // THE KEYSTONE, SETTLE LEG — born strict: the reducer refuses a settle without its ancestry
    // bundle on signet/main. The payout spends the pot's own coins, so the walk stops almost
    // immediately at outpoints this journal already proved (deposits + earlier consolidation
    // change) — the bundle is usually the payout tx alone. Refuse BEFORE a doomed append: the
    // L1 payout already happened and stays provable; the same txid settles once assembly works.
    if (RUNE_ANCESTRY_LIVE) {
      try {
        attachSettleProof.ancestry = await assembleRuneAncestry(buried.txid, runeIdStr)
      } catch (e4) {
        return { error: 'the payout\'s ancestry could not be proven from bytes — ' + (e4 instanceof Error ? e4.message : String(e4)), status: 400 }
      }
    }
  }
  // born strict: a settle must journal its own proof — refuse before a doomed append (the L1
  // payout already happened and stays provable; the same txid settles on a configured node)
  if (PROOF_MANDATORY_LIVE && !attachSettleProof) {
    return { error: 'this network is born strict — a rune settle must journal its own SPV proof, but KRAY_CONSENSUS_RUNE_PROOF is off on this node. The L1 payout stands; settle the same txid on a correctly configured node', status: 503 }
  }
  // a LOAF settle keys on its own delivery outpoint (txid:vout) so the next member of the same
  // tx can still burn its own lock; a solo settle stays byte-identical to every historic one.
  const ev = node.runeSettle(runeIdStr, from, lock.amount, buried.txid, 0, attachSettleProof, opts.loaf ? targetIdx : undefined)
  // RELEASE the backing outpoints this payout ACTUALLY spent — read from its own inputs, never a claim
  vaultWatch = markReleased(vaultWatch, parsed.inputs.map((i) => `${i.txid}:${i.vout}`), buried.txid); saveVaultWatch()
  return { ok: true, seq: ev.seq, burned: lock.amount.toString(), l1Txid: buried.txid, outputIndex: targetIdx, reserve: node.ledger.runes.reserveOf(rid).toString(), solvent: node.ledger.runesSolvent(), cascadeRoot: node.cascadeRoot() }
}

/** ONE SWEEP: ask bitcoind whether each unreleased backing UTXO still exists, judge, alarm.
 *  Fail-closed but calm: if ANY chain question errors, the whole sweep aborts and the previous
 *  verdicts stand — a sweep that could not ask the chain must not repaint the state of one that did. */
let vaultSweepRunning = false
async function sweepVaultWatch() {
  if (vaultSweepRunning || !vaultWatch.length || !btcConfigured()) return
  vaultSweepRunning = true
  try {
    const answers = []
    for (const w of vaultWatch) {
      if (w.releasedBy) continue                      // its story is closed; sweep() keeps it released
      const [txid, vout] = w.outpoint.split(':')
      // gettxout(include_mempool=true): null = spent (even by an unconfirmed drain attempt — the
      // earliest possible sighting), an object = the UTXO still backs the book
      const utxo = await btcRpc('gettxout', [txid, Number(vout), true])
      answers.push({ outpoint: w.outpoint, unspent: utxo != null })
    }
    const r = vaultWatchSweep(vaultWatch, answers)
    const prevAlarmed = new Set(vaultWatchLast.alarms.map((a) => a.outpoint))
    vaultWatchLast = { at: Date.now(), backed: r.backed, released: r.released, alarms: r.alarms }
    for (const a of r.alarms) {
      if (prevAlarmed.has(a.outpoint)) continue       // scream once per new alarm, report always
      console.error(`\n🚨 VAULT ALARM — ${a.reason}\n   outpoint ${a.outpoint} · rune ${a.runeId} · ${a.amount} credited · vault ${a.vault}\n`)
      broadcast('vault-alarm', a)
      // THE REFLEX — a drained vault with a lodged, already-safety-audited settlement gets the honest
      // split broadcast NOW. Both spend the same outpoint, so the stale escape can never confirm. The
      // settlement is fully co-signed and was verified against our own book when stored — we only relay.
      if (PRESIGNED_SETTLEMENT) {
        const s = settlementByOutpoint.get(a.outpoint)
        if (s && !s.broadcastTxid) {
          try {
            const txid = await btcRpc('sendrawtransaction', [s.cosignedTxHex])
            s.broadcastTxid = txid; saveSettlements()
            console.error(`   ⚖ SETTLEMENT REFLEX — broadcast the pre-signed split ${String(txid).slice(0, 16)}… (the escape loses the race)`)
            broadcast('vault-settlement-broadcast', { outpoint: a.outpoint, txid })
            // THE CONSOLIDATION REGISTRY — the shared pool this split fed (output 2) now enters the eye,
            // so the federation custody backing everyone the depositor paid is watched exactly like a
            // per-depositor vault. It is RELEASED later when a recipient's exit settles by spending it.
            try {
              const stx2 = parseTx(s.cosignedTxHex)
              if (s.consolidationGot && BigInt(s.consolidationGot) > 0n && stx2.outputScripts[2]) {
                watchVaultOutpoint({ outpoint: `${txid}:2`, runeId: s.runeId, vault: Buffer.from(stx2.outputScripts[2]).toString('hex'), amount: String(s.consolidationGot), depositor: '', kind: 'consolidation', at: Date.now() })
                console.error(`   ⚖ CONSOLIDATION WATCHED — the shared pool ${s.consolidationGot} at ${String(txid).slice(0, 16)}…:2 is now under the eye`)
              }
            } catch (e) { console.error('   ⚖ could not register the consolidation output for watching:', e.message) }
          } catch (e) {
            // A STRANGER may have broadcast this hex first — the permissionless watchtower door
            // (/api/kraynet/vault-settlements) publishes the bytes precisely so athe owner boxe can. bitcoind
            // then answers "already in block chain / txn-already-known": that is SUCCESS, not failure.
            // Record the txid from OUR OWN bytes (never a claim) so the reconcile loop settles the lock.
            if (/already in block chain|txn-already|already known|already in the mempool/i.test(e.message || '')) {
              try { s.broadcastTxid = parseTx(s.cosignedTxHex).txidDisplay; saveSettlements(); console.error(`   ⚖ SETTLEMENT ALREADY ON CHAIN — a stranger's broadcast won the relay; reconciling against it`) }
              catch (e2) { console.error('   ⚖ could not derive the settlement txid from its own hex:', e2.message) }
            } else console.error('   ⚖ settlement broadcast failed (the escape may confirm; alarm stands):', e.message)
          }
        }
      }
    }
    // THE RECONCILIATION — once a broadcast settlement is BURIED, settle the depositor's locked exit
    // against it (the sacred settle path). This burns their L2 balance in lockstep with the runes they
    // received on L1, so they can never hold both. Runs every sweep until done; the settle path itself is
    // idempotent (a lock burns once), so a retry after a partial confirmation is safe.
    if (PRESIGNED_SETTLEMENT) {
      for (const [outpoint, s] of settlementByOutpoint) {
        if (!s.broadcastTxid || s.reconciledSeq || !s.from) continue
        const stillOpen = node.ledger.runes.lockedOf(parseRuneKey(s.runeId), s.from)
        if (!stillOpen) { s.reconciledSeq = -1; saveSettlements(); continue } // already settled elsewhere
        const rec = await proveAndSettleRuneExit(s.from, s.runeId, s.broadcastTxid).catch((e) => ({ error: e.message }))
        if (rec.ok) {
          s.reconciledSeq = rec.seq; saveSettlements()
          console.error(`   ⚖ RECONCILED — the forced exit settled: ${s.lockAmount} burned from the L2 book, reserve fell in step (outpoint ${outpoint.slice(0, 16)}…)`)
          broadcast('vault-settlement-reconciled', { outpoint, txid: s.broadcastTxid, burned: s.lockAmount })
        } // not yet buried enough → try again next sweep (rec.error is expected until it confirms)
      }
    }
    // the USER-FUNDED exit payouts settle through the same sweep — automatic, no hands
    await reconcileExitPayouts()
    // …and broadcast rehomes journal once buried (the bakery opens on Bitcoin's clock, not ours)
    await reconcileRehomes()
  } catch (e) {
    console.error('vault-watch sweep aborted (chain unreachable — previous verdicts stand):', e.message)
  } finally { vaultSweepRunning = false }
}
/** Record a donation as a PROVEN self-anchor — only if it sealed a REAL cascade root this node produced at that
 *  block (else it is not an anchor of our history). Additive: it never touches the operator anchor log. */
function recordSelfAnchor(txid, vout, blockNumber, root, sats, donor, btcHeight) {
  if (!POT_INTERNAL_KEY || !/^[0-9a-f]{64}$/i.test(String(txid || '')) || !/^[0-9a-f]{64}$/i.test(String(root || ''))) return false
  const blk = blocks[blockNumber]
  // the seal must be a REAL cascade root this node produced: the genesis (empty) root, or the root sealed at that block
  if (!(root === GENESIS_ROOT || (blk && blk.cascadeRoot === root))) return false
  // sanity: the recorded root must re-derive the exact burn script the donation had to pay (proof is self-contained)
  try { selfAnchorScriptHex(POT_INTERNAL_KEY, KrayAnchor.payload(blockNumber, root)) } catch { return false }
  // btcHeight = the Bitcoin block that buried the donation (from verifyDonationProof) — the seal's 3d-a height,
  // persisted so the boot sweep can re-journal it (A3: ignored below activation, required at/after).
  const height = Number.isInteger(btcHeight) && btcHeight > 0 ? btcHeight : undefined
  selfAnchors.set(txid, { txid, vout: Number(vout) || 0, blockNumber, root, sats: String(sats), donor, at: Date.now(), ...(height ? { btcHeight: height } : {}) })
  saveSelfAnchors()
  console.log(`⚓ self-anchor recorded — donation ${String(txid).slice(0, 16)}… seals block #${blockNumber} (root ${root.slice(0, 12)}…)${height ? ` @ btc height ${height}` : ''} — keyless, the donation IS the anchor`)
  poolSatisfied(root)   // Slice 2b: the donation anchored it for free — the backstop stands down, nobody owed
  journalSeal(txid, height, root, blockNumber)   // Slice 2c: a confirmed seal reopens one mint-cap of window (once per txid, ever)
  // adopt the donation's seal into the anchor log (root-matched) so the explorer + sealOf() show it gold —
  // the donation IS the anchor, first-class, exactly as fork-choice already weighs it (Slice 2a).
  const ablk = blocks[blockNumber]
  if (ablk && ablk.cascadeRoot === root && !(anchors.get(blockNumber) || {}).verified) {
    anchors.set(blockNumber, { txid, rawHex: null, confirmations: DONATION_MIN_CONF, root, verified: true, btcHeight: height ?? null, btcChain: NET, pending: false, real: true, selfAnchor: true })
    saveAnchors()
  }
  return true
}
/** REDEMPTION RESILIENCE — discover which (blockNumber, root) a self-anchoring donation sealed from the tx
 *  bytes ALONE. The whole proof lives on Bitcoin: the burn output's script is a pure function of
 *  (internalKey, blockNumber, root), so the node re-derives the script for every root it has ever produced
 *  and tests it against the tx's actual outputs. A donor who lost the client-side context (wallet reinstall,
 *  cleared storage) therefore redeems FOREVER with just the {txid} — the sacrifice is never stranded. */
function discoverSelfAnchor(rawTxHex) {
  if (!selfAnchorReady()) return null
  let outs
  try { outs = new Set(parseTx(rawTxHex).outputScripts.map((s) => s.toString('hex'))) } catch { return null }
  const tried = new Set()
  const test = (blockNumber, root) => {
    if (!Number.isInteger(blockNumber) || blockNumber < 0 || !/^[0-9a-f]{64}$/i.test(String(root || ''))) return null
    const key = blockNumber + '|' + String(root).toLowerCase()
    if (tried.has(key)) return null
    tried.add(key)
    try {
      return outs.has(selfAnchorScriptHex(POT_INTERNAL_KEY, KrayAnchor.payload(blockNumber, String(root).toLowerCase())))
        ? { blockNumber, root: String(root).toLowerCase() } : null
    } catch { return null }
  }
  // candidates, likeliest-first: the live tip, the genesis root, every recorded self-anchor, every sealed block
  const live = test(Math.max(0, tipNumber()), node.cascadeRoot()); if (live) return live
  const gen = test(0, GENESIS_ROOT); if (gen) return gen
  for (const s of selfAnchors.values()) { const hit = test(s.blockNumber, s.root); if (hit) return hit }
  for (let n = blocks.length - 1; n >= 0; n--) { const hit = test(n, blocks[n].cascadeRoot); if (hit) return hit }
  return null
}

// ── SLICE 2b — THE ANY-GUARDIAN ANCHOR BACKSTOP (flag-gated, additive, non-consensus) ─────────────────────
// The COMMON case needs nobody: each burn donation IS the anchor (Slice 2a weighs it in fork-choice). This
// pool is the LIVENESS backstop for quiet periods: guardians stand a SIGNED offer of sats; when a sealed
// root stays unanchored past the quiet window, an UNBIASABLE draw (Bitcoin block hash — a pure function
// athe owner boxe recomputes) names the payer; they broadcast the 49-byte anchor from their OWN wallet and claim
// with a signature + the txid; the node SPV-verifies the seal with the SAME verifySealProof consensus uses,
// then rewards them FROM THE FEE POOL, capped at what it holds — conserved, never minted. No owner anywhere:
// the payer buys only the postage, never a word of what is sealed (proven in anchor-payer.test.ts).
const ANCHOR_POOL_ON = process.env.KRAY_ANCHOR_POOL === '1'
const ANCHOR_POOL_QUIET_MS = Math.max(5_000, parseInt(process.env.KRAY_ANCHOR_POOL_QUIET_MS || '1800000', 10) || 1_800_000)
const ANCHOR_POOL_MIN_FEE = BigInt(process.env.KRAY_ANCHOR_POOL_MIN_FEE || '200')
const ANCHOR_POOL_FILE = join(DATA_DIR, 'anchor-pool.json')
let anchorPool = ANCHOR_POOL_ON ? new AnchorPool() : null
let poolJobSince = null                     // when the CURRENT pending job first appeared (quiet-period gate)
let poolLastJobId = -1
const poolOfferAt = new Map()               // address → last signed offer timestamp (monotonic anti-replay)
const anchorOfferMessage = (address, sats, at) => `KRAY.NETWORK|anchor-offer|${NET}|${address}|${sats}|${at}`
const anchorClaimMessage = (address, txid, root) => `KRAY.NETWORK|anchor-claim|${NET}|${address}|${txid}|${root}`
function savePoolState() {
  if (!anchorPool) return
  try {
    const tmp = ANCHOR_POOL_FILE + '.tmp'
    const fd = openSync(tmp, 'w'); writeSync(fd, JSON.stringify({ pool: anchorPool.snapshot(), jobSince: poolJobSince, offerAt: [...poolOfferAt] })); fsyncSync(fd); closeSync(fd)
    renameSync(tmp, ANCHOR_POOL_FILE)
  } catch (e) { console.error('anchor-pool persist failed:', e.message) }
}
function loadPoolState() {
  if (!anchorPool) return
  try {
    if (existsSync(ANCHOR_POOL_FILE)) {
      const raw = JSON.parse(readFileSync(ANCHOR_POOL_FILE, 'utf8'))
      anchorPool = AnchorPool.restore(raw.pool)   // hostile-input hardened: a malformed file yields an empty pool
      poolJobSince = Number.isFinite(raw.jobSince) ? raw.jobSince : (anchorPool.pending ? Date.now() : null)
      poolLastJobId = anchorPool.pending ? anchorPool.pending.jobId : -1
      if (Array.isArray(raw.offerAt)) for (const [a, t] of raw.offerAt) if (typeof a === 'string' && Number.isFinite(t)) poolOfferAt.set(a, t)
    }
  } catch (e) { console.error('anchor-pool load failed:', e.message) }
  // anchors that confirmed while the node was down already satisfy the pending target (yield, reward nobody)
  for (const s of selfAnchors.values()) poolSatisfied(s.root)
  for (const a of anchors.values()) if (a.verified && a.root) poolSatisfied(a.root)
}
/** Every sealed VALUE block advances the single coalesced backstop target (O(1): the newest root already
 *  consolidates all prior state). No-op when the pool is off or the root is already sealed on Bitcoin. */
function poolAdvance(b) {
  if (!anchorPool || !blockHasValue(b)) return
  const covering = anchorForRoot(b.cascadeRoot)
  if (covering && covering.verified) return
  const id = anchorPool.advance(b.cascadeRoot, b.number)
  if (id !== poolLastJobId) { poolLastJobId = id; poolJobSince = Date.now() }
  savePoolState()
}
/** An anchor from OUTSIDE the pool (donation self-anchor, operator seal) confirmed — the backstop stands
 *  down for that exact root. Nobody is rewarded: the network bought nothing from the pool. */
function poolSatisfied(root) {
  if (!anchorPool || !root) return
  if (anchorPool.satisfied(String(root))) {
    poolJobSince = null; savePoolState()
    console.log(`⚓ anchor-pool: target satisfied by an external anchor (${String(root).slice(0, 12)}…) — job cleared, nobody owed`)
  }
}
/** THE WINDOW LAW hook (Slice 2c) — journal a CONFIRMED Bitcoin seal so the reducer reopens exactly one
 *  mint-cap of capacity, once per txid, ever. Idempotent (hasSeal) + fail-safe (a refused duplicate can
 *  never crash the caller). Call ONLY for seals this node verified buried — never for simulated markers. */
function journalSeal(txid, l1Height, l1Root, l1BlockNumber) {
  if (!txid || !/^[0-9a-f]{64}$/i.test(String(txid))) return
  const t = String(txid).toLowerCase()
  try {
    if (node.ledger.hasSeal(t)) return
    // ADR-3 3d-a — carry the Bitcoin height that BURIED the seal AND the cascade root + KRAY block number the
    // anchor COMMITS (l1Root/l1BlockNumber), from this node's own SPV. All three are ignored below the inclusion
    // activation seq (A3), REQUIRED at/after it — the reducer binds the height to the inclusion set l1Root
    // actually anchored (a PAST block-boundary root under confirmation latency), closing old-anchor-reuse.
    node.sealConfirmed(t, Date.now(), Number.isInteger(l1Height) ? l1Height : undefined,
      typeof l1Root === 'string' && /^[0-9a-f]{64}$/i.test(l1Root) ? l1Root : undefined,
      Number.isInteger(l1BlockNumber) ? l1BlockNumber : undefined)
    console.log(`♻ window: confirmed seal ${t.slice(0, 16)}… reopened ${WINDOW_PER_SEAL_SATS} ₭ of mint capacity (once, ever)${Number.isInteger(l1Height) ? ` @ btc height ${l1Height}` : ''}`)
  } catch (e) { console.error('seal journal failed:', e.message); return }
  void settleFeePoolOnSeal(t)   // validators are paid on EVERY proven seal — donation, drawn guardian, or operator
}
/** Every verified self-anchor / Bitcoin seal that has a height but is not yet in the journal.
 *  Sort by Bitcoin height (the reducer's non-decreasing law) so 1 or 1000 donates never collide. */
function journalMissingSeals() {
  const pending = []
  const consider = (txid, height, root, blockNumber) => {
    if (!txid || !/^[0-9a-f]{64}$/i.test(String(txid))) return
    const t = String(txid).toLowerCase()
    if (node.ledger.hasSeal(t)) return
    if (!Number.isInteger(height) || height <= 0) return
    if (typeof root !== 'string' || !/^[0-9a-f]{64}$/i.test(root)) return
    pending.push({ txid: t, height, root: root.toLowerCase(), blockNumber: Number.isInteger(blockNumber) ? blockNumber : 0 })
  }
  for (const [number, a] of anchors.entries()) {
    if (!a || !a.verified || !a.real || a.simulated) continue
    consider(a.txid, a.btcHeight, a.root, Number(number))
  }
  for (const s of selfAnchors.values()) consider(s.txid, s.btcHeight, s.root, s.blockNumber)
  pending.sort((a, b) => a.height - b.height || a.blockNumber - b.blockNumber || (a.txid < b.txid ? -1 : 1))
  const seen = new Set()
  for (const p of pending) {
    if (seen.has(p.txid)) continue
    seen.add(p.txid)
    journalSeal(p.txid, p.height, p.root, p.blockNumber)
  }
}
/** PHASE 2 · pay validators by PROVEN work, on EVERY confirmed seal (the operator is retired, so the payout
 *  can never depend on him): journal the beats gathered for the current beacon as ONE settlement — the ledger
 *  re-derives and pays from the fee pool, linear in work (sybil-neutral). When NO one beat this seal, the pool
 *  simply ACCUMULATES in the Treasury — ₭ leaves it ONLY for proven work, ever (no fallback address, no
 *  operator payout): the next seal that carries beats settles the whole accumulated pool. This makes "fees flow
 *  only to proven presence" a STRUCTURAL invariant, not a config accident. Fail-safe: a settle error never
 *  breaks the seal that triggered it. */
async function settleFeePoolOnSeal(txid) {
  try {
    if (node.feePool() > 0n) {
      const bcn = await bindSettleBeacon(txid)
      const tip = Math.max(0, tipNumber())
      const claims = bcn ? beatClaims(bcn) : []
      if (claims.length) {
        node.settleBeats(bcn, claims, Date.now(), tip)
        gcPresence(bcn)
        console.log(`⚖ settled the fee pool across ${claims.length} validator(s) by proven work (tip ${tip})`)
      }
      // else: no proven presence this seal → the pool accumulates in the Treasury until a guardian earns it.
    }
  } catch (e) { console.error(`settle skipped — ${e.message}`) }
}
/** THE SETTLEMENT TABLE, RE-DERIVED FOR THE EXPLORER — the exact table the reducer credited, rebuilt
 *  read-only so the tx page can SHOW who earned what. Single-law: the split itself is settleFromBeats
 *  (the same pure function ledger.ts:459 applies); this helper only reconstitutes the fee pool the
 *  settlement drew from, by folding the journal's own treasury arithmetic up to that seq —
 *  fees credited (transfer, transfer-star, rune-send, rune-exit, contract-call · ledger.ts:237,254,352,382,453)
 *  minus rewards and earlier settlements (ledger.ts:318,485). Returns null (never throws) if the event
 *  is not a settlement or the fold cannot reproduce it — the page then simply shows the raw record. */
const FEE_POOL_KINDS = new Set(['transfer', 'transfer-star', 'rune-send', 'rune-exit', 'rune-cancel', 'amm-add', 'amm-remove', 'amm-swap', 'amm-rr-add', 'amm-rr-remove', 'amm-rr-swap', 'contract-call', 'star-list', 'star-delist', 'star-buy', 'star-offer', 'star-offer-cancel', 'star-offer-accept'])
/** One forward pass over the journal, folding the treasury and handing every settlement's re-derived
 *  table to `onTable(event, lines, poolBefore, paid)` — return false from the callback to stop early. */
function foldSettlementTables(onTable) {
  let pool = 0n
  const claimsOf = (e) => (e.claims || []).map((c) => ({ address: c.address, beats: c.beats, hits: c.custody ? hitCount(custodyFromHex(c.custody)) : 0 }))
  for (const e of events) {
    if (e.kind === 'settlement') {
      const { lines } = settleFromBeats(e.beacon, pool, claimsOf(e), (() => {
        try {
          const t = readPresenceTip(e.presenceTip)
          return t !== undefined ? { presenceTip: t, seq: e.seq } : { seq: e.seq }
        } catch { return { seq: e.seq } }
      })())
      const paid = lines.reduce((t, l) => t + l.paid, 0n)
      if (onTable(e, lines, pool, paid) === false) return
      pool -= paid
    } else if (FEE_POOL_KINDS.has(e.kind)) pool += BigInt(e.fee || 0)
    else if (e.kind === 'reward') pool -= BigInt(e.amount || 0)
  }
}
function settlementTableOf(target) {
  try {
    if (!target || target.kind !== 'settlement') return null
    let out = null
    foldSettlementTables((e, lines, pool, paid) => {
      if (e.seq !== target.seq) return
      out = {
        pool: pool.toString(), paid: paid.toString(), beacon: e.beacon,
        payouts: lines.map((l) => ({ address: l.address, paid: l.paid.toString(), work: l.work.toString(), base: l.base.toString(), hits: l.hits, blocks: l.blocks.length })),
      }
      return false
    })
    return out
  } catch (_) { return null }   // a view must never break the page — the raw record still shows
}
/** Every settlement's re-derived table, memoized on the journal length — one fold serves the list
 *  endpoint AND the per-address reward rows, recomputed only when new events land. */
let _setlMemo = { upto: -1, tables: [] }
function settlementTables() {
  if (_setlMemo.upto === events.length) return _setlMemo.tables
  const tables = []
  try {
    foldSettlementTables((e, lines, pool, paid) => { tables.push({ hash: e.hash, seq: e.seq, at: e.at || 0, beacon: e.beacon, paid, payouts: lines }) })
  } catch (_) { /* list what could be read — never a broken page */ }
  _setlMemo = { upto: events.length, tables }
  return tables
}
/** This address's validator earnings as synthetic feed rows — one per settlement that paid it. The
 *  profile/wallet feeds are keyed by from/to, and a settlement has neither; these rows give the
 *  validator the "you earned" line their activity was missing. Each links (by hash) to the
 *  settlement's own page, where the full table is re-derived. */
function validatorRewardRows(addr, before = null) {
  const rows = []
  for (const t of settlementTables()) {
    if (before != null && t.seq >= before) continue
    const l = t.payouts.find((x) => x.address === addr && x.paid > 0n)
    if (l) rows.push({ synthetic: true, seq: t.seq, hash: t.hash, at: t.at, kind: 'validator-reward', from: null, to: addr, amount: l.paid.toString(), fee: '0', work: l.work.toString(), hits: l.hits, blocksPresent: l.blocks.length })
  }
  return rows
}
/** The recent Bitcoin block hashes — the claim window's beacons. The draw under ANY of the last `n` hashes
 *  accepts, so a payer who broadcast under hash H is not disqualified when H+1 arrives mid-confirmation.
 *  Deterministic + public: athe owner boxe recomputes the same window from the same chain. */
async function recentBeacons(n = 6) {
  const tip = await btcRpc('getblockcount', [])
  const out = []
  for (let i = 0; i < n && tip - i >= 0; i++) out.push(String(await btcRpc('getblockhash', [tip - i])))
  return out
}
/** The REAL fee a claimed anchor tx paid — Σinputs − Σoutputs from bitcoind's own view of the raw txs.
 *  Fail-closed: any unreadable prevout refuses the claim (never trust a client-declared fee). */
async function txFeeSats(txid) {
  const tx = await btcRpc('getrawtransaction', [txid, true])
  let inSum = 0n
  for (const vin of tx.vin || []) {
    if (!vin.txid) throw new Error('a coinbase input cannot pay an anchor')
    const prev = await btcRpc('getrawtransaction', [vin.txid, true])
    const po = prev.vout && prev.vout[vin.vout]
    if (!po) throw new Error(`missing prevout ${vin.txid}:${vin.vout}`)
    inSum += BigInt(Math.round(po.value * 1e8))
  }
  const outSum = (tx.vout || []).reduce((a, o) => a + BigInt(Math.round(o.value * 1e8)), 0n)
  if (inSum <= outSum) throw new Error('non-positive fee — not a real anchor payment')
  return inSum - outSum
}
// ask bitcoind where a txid actually sits. Returns {ok:true, confirmations, btcHeight} on a DEFINITIVE answer
// (found → its depth; genuinely-not-found → 0), or {ok:false} on an INCONCLUSIVE read (RPC unreachable/timeout/
// blip). The caller must NEVER demote a real seal on {ok:false} — an RPC hiccup is not a reorg.
async function readAnchorStatus(txid) {
  if (MEMPOOL_API) {
    try {
      const s = await mempoolGet('/tx/' + txid + '/status')   // { confirmed, block_height, block_hash }
      if (!s || !s.confirmed) return { ok: true, confirmations: 0, btcHeight: null }
      const tip = parseInt(await mempoolGet('/blocks/tip/height'), 10)
      const conf = Number.isFinite(tip) ? tip - s.block_height + 1 : 1
      return { ok: true, confirmations: conf, btcHeight: s.block_height }
    } catch (e) {
      if (/: 404\b/.test((e && e.message) || '')) return { ok: true, confirmations: 0, btcHeight: null }  // genuinely not seen (yet)
      return { ok: false }   // API blip — inconclusive; never demote a real seal
    }
  }
  try {
    const info = await btcRpc('getrawtransaction', [txid, true])
    const confirmations = info.confirmations || 0
    let btcHeight = null
    if (info.blockhash) { try { const bh = await btcRpc('getblockheader', [info.blockhash, true]); btcHeight = bh.height } catch { /* header race */ } }
    return { ok: true, confirmations, btcHeight }
  } catch (e) {
    const msg = (e && e.message) || ''
    // bitcoind ANSWERED that the tx is genuinely gone (not in mempool nor chain) → a definitive 0 confirmations.
    if (/No such mempool or blockchain transaction|-5\b/i.test(msg)) return { ok: true, confirmations: 0, btcHeight: null }
    return { ok: false }   // transport/timeout/JSON blip — inconclusive; keep the last-known state
  }
}
// RECONCILE a broadcast anchor against Bitcoin — the ONE state machine for confirmations. It PROMOTES to
// verified only once buried ≥ ANCHOR_CONF, and (crucially) DEMOTES back to unverified if a reorg/eviction
// drops it below the floor — `verified` means CURRENTLY buried, not once-buried. If Bitcoin no longer holds
// the tx (lost send response, mempool eviction, reorg to mempool) it re-sends the EXACT signed bytes
// (idempotent — bitcoind dedups by txid), recovering the seal without ever funding a second anchor for the root.
async function refreshAnchor(number) {
  const a = anchors.get(number)
  if (!a || !a.real || !a.txid) return
  const st = await readAnchorStatus(a.txid)
  if (!st.ok) return   // INCONCLUSIVE read (RPC blip) — never demote a real seal on a hiccup; retry next tick
  const { confirmations, btcHeight } = st
  const verified = confirmations >= ANCHOR_CONF
  if (!verified && confirmations === 0 && a.rawHex) {
    try { await sendAnchorTx(a.rawHex) } catch (e) { if (!/already (in|known)|txn-already|inputs missing|Missing inputs/i.test(e.message)) console.error(`anchor #${number} re-send failed — ${e.message}`) }
  }
  if (confirmations === a.confirmations && btcHeight === a.btcHeight && verified === a.verified) return
  anchors.set(number, { ...a, confirmations, btcHeight, verified })
  saveAnchors()
  broadcast('anchor', { number, txid: a.txid, confirmations, verified, btcHeight, real: true })
  if (verified && !a.verified) { poolSatisfied(a.root); journalSeal(a.txid, btcHeight, a.root, number); console.log(`⚓ anchor #${number} confirmed on Bitcoin — ${a.txid} @ height ${btcHeight} (${confirmations}/${ANCHOR_CONF} conf)`) }
  else if (!verified && a.verified) console.log(`⚠ anchor #${number} DEMOTED (reorg/eviction) — ${a.txid} now ${confirmations}/${ANCHOR_CONF} conf`)
}

// SEAL THE CASCADE ROOT ONTO BITCOIN — build the canonical 49-byte OP_RETURN, fund it from the node's own
// wallet, sign, broadcast, (if self-mining) mine it in, and record the HONEST confirmation state. Idempotent:
// once an anchor has a txid it only refreshes — never re-funds (no double-anchor). Async + fail-safe: NEVER
// blocks the heartbeat, NEVER throws into it.
// Build a funded + SIGNED anchor tx. Two funding sources, one signer (the local wallet, offline):
//   · mempool mode  — a confirmed UTXO at ANCHOR_FEE_ADDR fetched from the public API, spent to an OP_RETURN
//     + change back to the same fee address; signed with the prevout supplied (no local chain needed).
//   · node mode     — the wallet funds itself via fundrawtransaction (needs a synced local bitcoind).
async function buildSignedAnchorTx(payloadHex) {
  if (MEMPOOL_API && ANCHOR_FEE_ADDR) {
    const utxos = await mempoolGet('/address/' + ANCHOR_FEE_ADDR + '/utxo')
    const conf = (Array.isArray(utxos) ? utxos : []).filter((u) => u.status && u.status.confirmed).sort((a, b) => b.value - a.value)
    if (!conf.length) throw new Error(`no confirmed UTXO at the anchor fee address ${ANCHOR_FEE_ADDR} — fund it (faucet)`)
    // FAIL-CLOSED: the anchor fee must ride a PURE-BTC UTXO. The fee/pot address is PUBLIC, so an inscription or a
    // rune can land there; cardinalOnly guards both and protects anything ord cannot confirm cardinal. Anchoring is
    // idempotent + retried, so aborting here never blocks finality for long and never burns a donor's asset as fee.
    const { cardinal: confCardinal } = await cardinalOnly(conf)
    if (!confCardinal.length) throw new Error(`no pure-BTC UTXO at the anchor fee address ${ANCHOR_FEE_ADDR} that ord confirms carries no inscription or rune — fund it with plain sats (retry once ord is reachable)`)
    const u = confCardinal.sort((a, b) => b.value - a.value)[0]
    const change = u.value - ANCHOR_FEE_SATS
    if (change < 330) throw new Error(`the fee UTXO (${u.value} sats) is too small for an anchor + change`)
    const info = await btcWalletRpc('getaddressinfo', [ANCHOR_FEE_ADDR])
    const raw = await btcRpc('createrawtransaction', [[{ txid: u.txid, vout: u.vout }], [{ data: payloadHex }, { [ANCHOR_FEE_ADDR]: Number((change / 1e8).toFixed(8)) }]])
    const signed = await btcWalletRpc('signrawtransactionwithwallet', [raw, [{ txid: u.txid, vout: u.vout, scriptPubKey: info.scriptPubKey, amount: Number((u.value / 1e8).toFixed(8)) }]])
    if (!signed.complete) throw new Error('the wallet could not fully sign the anchor tx (is the fee address key in this wallet?)')
    return { hex: signed.hex, feeSats: ANCHOR_FEE_SATS }   // mempool mode spends exactly the fixed fee (change = value − fee)
  }
  const rawUnfunded = await btcRpc('createrawtransaction', [[], [{ data: payloadHex }]])
  // lockUnspents reserves the chosen inputs so a follow-up fund (or any wallet spend) can never pick the same UTXO.
  // A 49-byte OP_RETURN must NOT pay a mainnet-estimated fee on a test network: signet/regtest/testnet estimators
  // fall back to an absurd rate (~30 sat/vB → thousands of sats for a tiny tx). Fix a low sat/vB there, and let
  // mainnet use the wallet's estimator. Override either with KRAY_ANCHOR_FEERATE (sat/vB).
  const fundOpts = { lockUnspents: true }
  const feerate = process.env.KRAY_ANCHOR_FEERATE != null ? Number(process.env.KRAY_ANCHOR_FEERATE) : (NET === 'main' ? null : 2)
  if (feerate != null && feerate > 0) fundOpts.fee_rate = feerate    // sat/vB — bitcoind fundrawtransaction option
  const funded = await btcWalletRpc('fundrawtransaction', [rawUnfunded, fundOpts])
  // FAIL-CLOSED: bitcoind coin-selection is ordinal-blind. Before signing, prove every input it chose is pure BTC —
  // an inscription/rune in this wallet (e.g. at an ismine pot address) must NEVER be swept as an anchor fee. On a
  // non-cardinal pick, unlock the reserved inputs and abort; anchoring retries (idempotent), never burns an asset.
  const decodedAnchor = await btcRpc('decoderawtransaction', [funded.hex])
  const fundedVin = (decodedAnchor.vin || []).map((v) => ({ txid: v.txid, vout: v.vout }))
  const { guarded: fundedGuarded } = await cardinalOnly(fundedVin)
  if (fundedGuarded.length) {
    try { await btcWalletRpc('lockunspent', [true, fundedVin]) } catch { /* best-effort unlock so the next retry can re-fund */ }
    throw new Error(`anchor funding chose a non-cardinal input (${fundedGuarded[0].reason}) — the anchor wallet must hold only pure BTC; anchoring will retry`)
  }
  const signed = await btcWalletRpc('signrawtransactionwithwallet', [funded.hex])
  if (!signed.complete) throw new Error('the wallet could not fully sign the anchor tx')
  return { hex: signed.hex, feeSats: Math.max(0, Math.round((funded.fee || 0) * 1e8)) }   // the REAL fee bitcoind chose, in sats
}
// Relay a signed tx — via the public API (mempool mode) or the local bitcoind. Idempotent on "already known".
async function sendAnchorTx(hex) {
  if (MEMPOOL_API) return mempoolBroadcast(hex)
  try { return await btcRpc('sendrawtransaction', [hex]) } catch (e) { if (/already (in|known)|txn-already/i.test(e.message)) return null; throw e }
}

async function broadcastAnchorSeal(number, root) {
  const cur = anchors.get(number)
  if (cur && cur.txid) return refreshAnchor(number)     // already broadcast — reconcile depth / re-send bytes, never re-fund
  const payloadHex = KrayAnchor.payload(number, root)   // 49 bytes = 98 hex — the exact committed bytes
  try {
    const { hex: signedHex, feeSats } = await buildSignedAnchorTx(payloadHex)
    // derive the txid from the SIGNED bytes and persist {txid, rawHex} BEFORE sending — so if the send response
    // is lost (timeout/drop) the txid is never lost and the watch re-sends the SAME bytes (dedup by txid) instead
    // of funding a SECOND, different anchor for the same root (the lost-response double-anchor).
    const dec = await btcRpc('decoderawtransaction', [signedHex])
    const txid = dec.txid
    anchors.set(number, { ...(anchors.get(number) || {}), txid, rawHex: signedHex, confirmations: 0, root, verified: false, btcHeight: null, btcChain: NET, pending: false, real: true })
    saveAnchors()
    await sendAnchorTx(signedHex)
    // ── THE SELF-SUSTAINING LEDGER — a real anchor was just carried onto Bitcoin, so (1) the DONATION POT
    //    pays for it: anchorSpend drains the pot's sats and REOPENS the mint deficit (donations fund the
    //    anchoring ♻), and (2) the GUARDIAN running this node earns the fee pool accrued since the last seal.
    //    Both are journaled + conserved, and they ride the next USER-activity block (maybeAnchor ignores
    //    system-only blocks), so they can never trigger an anchor of their own — no fee-burning loop.
    // the pot pays the REAL fee this seal cost, capped at what it holds — if donations don't yet cover it, the
    // pot drains to zero and the operator's wallet made up the difference (honest books, the pot never goes negative).
    try { const held = node.pot().held, want = BigInt(feeSats || 0), pay = want > held ? held : want; if (pay > 0n) node.anchorSpend(pay, Date.now()) } catch (e) { console.error(`anchor #${number} pot-spend skipped — ${e.message}`) }
    // PHASE 2 validator payout now rides EVERY confirmed seal (journalSeal → settleFeePoolOnSeal), not this
    // operator broadcast — with the operator retired, guardians are paid when a donation or a drawn guardian
    // seals, exactly the same. (This call covers the self-mine path where the seal verifies instantly.)
    // a self-mining node (regtest) buries the seal itself so it confirms instantly; otherwise the network does (~10 min/block).
    if (ANCHOR_SELF_MINE) { const addr = await btcWalletRpc('getnewaddress', []); await btcRpc('generatetoaddress', [ANCHOR_CONF, addr]) }
    const st = await readAnchorStatus(txid)                 // inconclusive → treat as 0 conf; the watch reconciles it
    const confirmations = st.ok ? st.confirmations : 0
    const btcHeight = st.ok ? st.btcHeight : null
    const verified = confirmations >= ANCHOR_CONF
    anchors.set(number, { ...anchors.get(number), txid, rawHex: signedHex, confirmations, root, verified, btcHeight, btcChain: NET, pending: false, real: true })
    saveAnchors()
    broadcast('anchor', { number, txid, confirmations, verified, btcHeight, real: true })
    if (verified) { poolSatisfied(root); journalSeal(txid, btcHeight, root, number) }   // 2b: a confirmed operator seal stands the backstop down; 2c: it reopens window once
    console.log(`⚓ anchor #${number} ${verified ? 'sealed on Bitcoin' : 'broadcast — awaiting burial'} — ${txid}${btcHeight != null ? ` @ height ${btcHeight}` : ''} (${confirmations}/${ANCHOR_CONF} conf)`)
  } catch (e) {
    console.error(`anchor #${number} broadcast deferred — ${e.message}`)
    // if no txid was recorded, stays pending; the watch retries. If a txid WAS recorded (send hard-failed after
    // decode), the watch re-sends the same bytes. Nothing about KRAY state depends on this succeeding.
    const prev = anchors.get(number)
    if (prev && !prev.txid) anchors.set(number, { ...prev, pending: true })
  }
}

// THE WATCH — every ANCHOR_WATCH_MS: reconcile every non-final real anchor against Bitcoin (promote as it
// buries, DEMOTE on reorg, re-send if dropped) and broadcast any that never sent. An anchor buried beyond
// ANCHOR_FINAL is done — no reorg reaches that deep — so it is left alone (the poll stays cheap forever).
// Serialized through anchorQueue so no two funds race a UTXO.
function anchorWatch() {
  if (!btcConfigured()) return
  for (const [number, a] of anchors) {
    if (!a.real) continue
    if (a.verified && a.confirmations >= ANCHOR_FINAL) continue
    if (!a.txid) anchorQueue = anchorQueue.then(() => broadcastAnchorSeal(number, a.root)).catch(() => {})
    else anchorQueue = anchorQueue.then(() => refreshAnchor(number)).catch(() => {})
  }
}

// Is this cascade root ALREADY anchored (under any block number)? Block numbers are not stable across reboots
// (history collapses into block #0), so the ROOT is the identity of a seal — never pay to commit the same root twice.
function anchorForRoot(root) { for (const a of anchors.values()) if (a.txid && a.root === root) return a; return null }

function recordAnchor(b) {
  const root = b.cascadeRoot || node.cascadeRoot()
  const here = anchors.get(b.number)
  if (here && here.txid && here.root === root) return   // this slot already anchors THIS root — idempotent
  // this exact root is already anchored under another block number (a reboot re-segmented the blocks)? adopt that
  // seal into this slot instead of re-broadcasting — one root, one seal, forever (fixes reboot re-anchoring).
  const already = anchorForRoot(root)
  if (already) { anchors.set(b.number, { ...already }); saveAnchors(); return }
  if (!btcConfigured()) {
    // OFFLINE dev: a SIMULATED marker — the payload is the true 49 bytes, but there is NO Bitcoin tx, so it is
    // NEVER 'verified' (verified means buried on Bitcoin). Consumers see simulated:true and real:false.
    const txid = sha256hex('kraynet-dev-anchor:' + b.number + ':' + root)
    anchors.set(b.number, { txid, rawHex: null, confirmations: 0, root, verified: false, btcHeight: null, btcChain: null, pending: false, real: false, simulated: true })
    broadcast('anchor', { number: b.number, txid, confirmations: 0, verified: false, real: false, simulated: true })
    return
  }
  // ONLINE: record PENDING (so the heartbeat is never blocked), then broadcast for real via the serialized queue.
  anchors.set(b.number, { txid: null, rawHex: null, confirmations: 0, root, verified: false, btcHeight: null, btcChain: NET, pending: true, real: true })
  anchorQueue = anchorQueue.then(() => broadcastAnchorSeal(b.number, root)).catch((e) => console.error('anchor seal error:', e.message))
}
// the anchor of a specific block — ONLY if its recorded root matches this block's current root (so a stale
// reboot anchor from a different segmentation never mislabels a block as sealed).
const anchorOf = (blk) => { if (!blk) return null; const a = anchors.get(blk.number); return a && a.root === blk.cascadeRoot ? a : null }
// THE SEAL THAT PROVES A BLOCK IS ON BITCOIN — cascade-aware. A cascade root is CUMULATIVE, so a VERIFIED
// anchor at ANY block ≥ this one already commits this block's state onto Bitcoin; that is why an
// intermediate block (an odd one sitting between anchor points) must turn gold the instant the next seal
// buries it, instead of staying grey forever under an exact-number match. Returns the NEAREST such anchor
// and the block that carried it (=== this block when it is its own anchor point, a LATER block when a
// cascade buried it). Each candidate is root-matched at ITS OWN block, so a stale reboot anchor from a
// different segmentation never counts. Only a VERIFIED or SIMULATED anchor seals — a merely broadcast
// (0-conf) one is not yet buried. Bounded in practice: with anchors every ANCHOR_EVERY blocks the nearest
// seal is a step or two away, and the unsealed suffix at the tip is short.
function sealOf(blk) {
  if (!blk) return null
  const tip = tipNumber()
  for (let j = blk.number; j <= tip; j++) {
    const bj = blocks[j]
    if (!bj) continue
    const a = anchors.get(j)
    if (a && a.root === bj.cascadeRoot && (a.verified || a.simulated)) return { anchor: a, block: j }
  }
  return null
}
// The anchor a page shows for a block: the covering VERIFIED/SIMULATED seal if one exists (its own, or the
// later cascade that buried it), otherwise the block's own still-pending broadcast. `verified` reflects
// Bitcoin burial via the cascade; `sealedBy` names the block whose anchor proved it (=== the block itself
// at an anchor point, a LATER block when the cascade buried it).
function donateSealAt(blockNumber) {
  const n = Number(blockNumber)
  for (const s of selfAnchors.values()) {
    if (Number(s.blockNumber) === n) return s
  }
  const a = anchors.get(n) || anchors.get(String(n))
  return (a && a.selfAnchor) ? a : null
}
function sealView(blk) {
  const own = anchorOf(blk)
  const seal = sealOf(blk)
  const a = (seal && seal.anchor) || own
  if (!a) return null
  const donate = donateSealAt(blk.number)
  return {
    txid: a.txid, confirmations: a.confirmations, verified: !!seal, simulated: !!a.simulated,
    cascadeRoot: a.root, sealedBy: seal ? seal.block : null,
    btcHeight: a.btcHeight ?? null, btcChain: a.btcChain ?? null,
    selfAnchor: !!donate,
    donateTxid: donate ? donate.txid : null,
  }
}
/** THE PAID BINDING certificate for one journal seq (or the tip). Null if the seq is not on this node.
 *  Two epochs, never mixed: `sealed` = the covering Bitcoin name (cumulative — includes this act);
 *  `tip` = the live opening a stranger re-derives right now. Blending them would invite a false re-hash.
 *  Codec refusal is a REFUSED certificate, never a missing event — /tx and /receipt still show the act. */
function paidBindingOf(seq) {
  const tip = events.length
  const target = seq == null ? tip : seq
  if (!Number.isInteger(target) || target < 1 || target > tip) return null
  const e = events[target - 1]
  const blk = blockOfSeq(target)
  const sv = sealView(blk)
  const parts = node.ledger.cascadeParts()
  const named = !!(sv && sv.txid && !sv.simulated)
  const view = certificateOrRefuse({
    seq: target, kind: e.kind, hash: e.hash,
    sealed: sv ? {
      cascadeRoot: sv.cascadeRoot,
      blockNumber: sv.sealedBy != null ? sv.sealedBy : (blk ? blk.number : node.seq),
      bitcoinTxid: named ? sv.txid : null, named,
    } : null,
    tip: {
      seq: node.seq, cascadeRoot: node.cascadeRoot(),
      laneRoot: parts.laneRoot ?? null, xRoot: parts.xRoot ?? null, fireRoot: parts.fireRoot ?? null,
    },
  })
  if (view.refused) console.error('paid-binding: certificate refused —', view.reason)
  return view
}
// a block carries VALUE if it holds any event beyond the ledger's own bookkeeping (anchor spends,
// guardian rewards). Anchoring only value-blocks lets the self-sustaining anchorSpend/settle events —
// pure bookkeeping — ride along inside a value-block's seal instead of triggering their OWN anchor,
// which would loop and burn real Bitcoin fees forever with no user activity.
// system events (anchor spends, rewards, window-law seals) never count as value — else a confirmed seal
// would journal a seal event, seal a "value" block, trigger a new anchor, and loop anchors forever.
function blockHasValue(b) { for (let seq = b.fromSeq; seq <= b.toSeq; seq++) { const e = events[seq - 1]; if (e && e.kind !== 'anchor' && e.kind !== 'reward' && e.kind !== 'seal') return true } return false }
function maybeAnchor(b) {
  // Slice 2c: the operator broadcasts only as an EXPLICIT last resort (KRAY_OPERATOR_ANCHOR=1). Offline dev
  // (no bitcoind) keeps its clearly-marked simulated markers. The common case needs nobody: the donation IS
  // the anchor, and the drawn-guardian backstop covers quiet periods.
  if ((b.number === 0 || b.number % ANCHOR_EVERY === 0) && blockHasValue(b) && (OPERATOR_ANCHOR || !btcConfigured())) recordAnchor(b)
  poolAdvance(b)   // Slice 2b: the backstop tracks every unanchored value-root (coalesced O(1); no-op when off)
}

// the heartbeat: seal pending events into the next fast block. No pending events →
// no block (v1's rule — never spam empty keep-alive blocks).
function sealTick(at) {
  if (node.seq <= lastSealedSeq) return null
  const b = sealBlock(lastSealedSeq + 1, node.seq, at)
  broadcast('block', { number: b.number, leaves: b.txCount })
  maybeAnchor(b)
  return b
}
function tipNumber() { return blocks.length - 1 }

// ── PHASE 2 · THE LIVE BEAT LAYER — a guardian proves PRESENCE by spending real hashes bound to a
//    Bitcoin-revealed beacon + its own address + the block. The node verifies each beat (PoW + the
//    address's own signature, so only the holder is credited and value never crosses networks) and
//    accumulates the best-per-block IN MEMORY until a seal journals it as a settlement's beats. No
//    consensus state here — the journal is written only at the seal (settleFromBeats re-derives it). ──
let _beacon = null, _beaconAt = 0
async function currentBeacon() {
  if (_beacon && Date.now() - _beaconAt < 60000) return _beacon
  try { const h = await btcRpc('getbestblockhash'); if (/^[0-9a-f]{64}$/.test(h)) { _beacon = h; _beaconAt = Date.now() } } catch { /* keep the last known beacon on an RPC blip */ }
  return _beacon
}
/** F-05: one RPC shot at seal time — the block that buried the seal, else the live tip. Never the 60s cache. */
async function bindSettleBeacon(txid) {
  if (txid) {
    try {
      const raw = await btcRpc('getrawtransaction', [txid, true])
      const h = raw && raw.blockhash
      if (/^[0-9a-f]{64}$/.test(h)) { _beacon = h; _beaconAt = Date.now(); return h }
    } catch { /* fall through to tip */ }
  }
  try {
    const h = await btcRpc('getbestblockhash')
    if (/^[0-9a-f]{64}$/.test(h)) { _beacon = h; _beaconAt = Date.now(); return h }
  } catch { /* keep the last known beacon on an RPC blip */ }
  return _beacon
}
const beatBook = new Map()     // beacon → Map<address, Map<block, { nonce, zeros, work }>>  (best per block)
const custodyBook = new Map()  // beacon → Map<address, custodyHex>  — ONLY proofs verified against THIS node's atlas
const PRESENCE_FILE = join(DATA_DIR, 'presence-beats.json')
const beatSubmitMessage = (beacon, address, block, nonce, zeros) => `kray.beat.submit.v1|${NET}|${beacon}|${address}|${block}|${nonce}|${zeros}`
// THE NODE's ATLAS — every inscribed content (canonical creation order) + the bytes it holds. Only a node that
// KEEPS an inscription can prove or audit custody of it; this is the oracle verifyCustody re-derives against.
function atlasOracle() {
  const contents = node.ledger.stars.inscriptions().filter((x) => !x.cursed).map((x) => x.contentHash)
  // corrupt bytes are NOT held bytes — a custody oracle fed a lie would refuse honest provers (fail-closed
  // but wrong-way). heldContentPath re-derives the name, so the oracle only ever witnesses true atlas copies.
  return { contents, bytesOf: (hash) => { try { const h = heldContentPath(hash); return h.held && h.ok ? new Uint8Array(readFileSync(h.path)) : null } catch { return null } } }
}
function persistPresence() {
  try {
    const book = {}
    for (const [bcn, addrs] of beatBook) {
      book[bcn] = {}
      for (const [addr, blocks] of addrs) book[bcn][addr] = Object.fromEntries(blocks)
    }
    const custody = {}
    for (const [bcn, addrs] of custodyBook) custody[bcn] = Object.fromEntries(addrs)
    const tmp = PRESENCE_FILE + '.tmp'
    const fd = openSync(tmp, 'w'); writeSync(fd, JSON.stringify({ v: 1, book, custody })); fsyncSync(fd); closeSync(fd)
    renameSync(tmp, PRESENCE_FILE)
  } catch (e) { console.error('presence persist failed:', e.message) }
}
function loadPresence() {
  if (!existsSync(PRESENCE_FILE)) return
  let loaded
  try { loaded = JSON.parse(readFileSync(PRESENCE_FILE, 'utf8')) } catch { return }
  if (!loaded || loaded.v !== 1 || !loaded.book) return
  beatBook.clear(); custodyBook.clear()
  for (const [bcn, addrs] of Object.entries(loaded.book)) {
    const am = new Map()
    for (const [addr, blocks] of Object.entries(addrs || {})) {
      const bm = new Map()
      for (const [bl, x] of Object.entries(blocks || {})) bm.set(Number(bl), x)
      am.set(addr, bm)
    }
    beatBook.set(bcn, am)
  }
  for (const [bcn, addrs] of Object.entries(loaded.custody || {})) custodyBook.set(bcn, new Map(Object.entries(addrs || {})))
}
function gcPresence(keepBeacon) {
  for (const k of [...beatBook.keys()]) if (k !== keepBeacon) beatBook.delete(k)
  for (const k of [...custodyBook.keys()]) if (k !== keepBeacon) custodyBook.delete(k)
  if (keepBeacon) { beatBook.delete(keepBeacon); custodyBook.delete(keepBeacon) }
  persistPresence()
}
// the presence a beacon gathered, as settleFromBeats claims: [{ address, beats:[…], custody? }]. The custody
// carried is ONLY a proof this node already verified against its own atlas — so a seal never journals a lie.
// One moment per address: the best stored beat (door already refused non-tip at POST).
function beatClaims(beacon) {
  const book = beatBook.get(beacon)
  if (!book) return []
  const cbook = custodyBook.get(beacon)
  return [...book.entries()].map(([address, blocks]) => {
    let best = null
    for (const [block, x] of blocks) {
      if (!best || BigInt(x.work) > BigInt(best.work)) best = { block, nonce: x.nonce, zeros: Math.min(x.zeros, BEAT_PAY_ZEROS_CAP), work: x.work }
    }
    return {
      address,
      beats: best ? [{ block: best.block, nonce: best.nonce, zeros: best.zeros }] : [],
      ...(cbook && cbook.get(address) ? { custody: cbook.get(address) } : {}),
    }
  }).filter((c) => c.beats.length)
}
function blockOfSeq(seq) {
  for (let n = blocks.length - 1; n >= 0; n--) {
    const b = blocks[n]
    if (seq >= b.fromSeq && seq <= b.toSeq) return b
    if (b.toSeq < seq) break // blocks ascend by seq — past it means it is still unsealed
  }
  return null
}

// ── the derived views the rich pages render (v1 JSON shapes, mapped to v2) ──
function nameHeldBy(addr) {
  try {
    const nos = node.ledger.stars.starsOf(addr)
    for (const no of nos) {
      const n = node.ledger.stars.nameOfStar(no)
      if (n) return n
    }
  } catch (_) { /* node not ready — stay unnamed */ }
  return null
}
function labelOf(addr) {
  if (!addr) return null
  if (addr === TREASURY) return { label: 'Treasury', simulated: false, founder: false }
  if (addr === BLACK_HOLE) return { label: 'Black hole', simulated: false, founder: false }
  if (addr.startsWith('KRAY_AMM_RR_')) return { label: 'the pool · no key', simulated: false, founder: false }
  if (addr.startsWith('KRAY_AMM_')) return { label: 'the pool · no key', simulated: false, founder: false }
  if (addr.startsWith('KRAY_CONTRACT_')) return { label: 'Contract · derived · no key', simulated: false, founder: false }
  const n = nameHeldBy(addr)
  if (n) return { label: n, simulated: false, founder: false }
  return null
}
// ONE BLOCK, as the explorer reads it (mirrors v1 blockCard exactly). v2 maps:
// leaves=txCount, root=merkleRoot; anchored/txid/conf/verified/cascadeRoot/opreturn from the
// anchor tracking; minted/fees are '0' (v2 has no per-block econ yet) and btcHeight/land null.
function blockCard(b) {
  const own = anchorOf(b)                                // this block's OWN anchor (pending, verified, or null) — root-matched
  const seal = sealOf(b)                                 // the nearest VERIFIED/SIMULATED seal covering it (own, or a later cascade)
  const a = (seal && seal.anchor) || own                 // show the covering verified seal, else the own still-pending broadcast
  const cascadeRoot = b.cascadeRoot || (a && a.root) || null
  const simulated = !!(a && a.simulated)                 // a dev placeholder (no bitcoind) — NEVER a real Bitcoin seal
  return {
    h: b.number, leaves: b.txCount, fill: Math.max(8, Math.min(100, b.txCount * 4)),
    root: b.merkleRoot, from: b.fromSeq, to: b.toSeq, hash: b.hash, at: b.at,
    minted: '0', fees: '0',
    latest: b.number === tipNumber(),
    anchored: !!(a && a.txid && !simulated),             // a REAL Bitcoin tx carries this state (own tx, or the cascade seal that buried it)
    anchorPending: !!(own && own.pending), simulated,
    txid: a ? a.txid : null, conf: a ? a.confirmations : null, verified: !!seal,   // gold ⟺ a VERIFIED/SIMULATED seal covers this block
    sealedBy: seal ? seal.block : null,                  // which block's anchor proved it (=== h at an anchor point, a later block via cascade)
    cascadeRoot, opreturn: cascadeRoot ? KrayAnchor.payload(b.number, cascadeRoot) : null,
    btcHeight: a ? (a.btcHeight ?? null) : null, btcChain: a ? (a.btcChain ?? null) : null,
    selfAnchor: !!donateSealAt(b.number),
    donateTxid: (donateSealAt(b.number) || {}).txid || null,
    land: null,
  }
}
// ONE TRANSACTION (journal event), enriched — mirrors v1 txSummary. In v2 a star is BORN
// from the creative act, so its creation number rides seqToStarNo (transfer-star carries its
// own star on the event). movedStars is a later phase (v2 has no deterministic star-range map).
// A network-aware mempool.space link for a Bitcoin txid — the public proof door. Regtest is a LOCAL chain
// with no public explorer, so it returns null (the page then shows the bare txid, un-linked). A link is only
// ever emitted for the network this node actually runs, never pointed at a foreign chain's explorer.
function mempoolTxUrl(txid) {
  if (!txid) return null
  switch (NET) {
    case 'main': return 'https://mempool.space/tx/' + txid
    case 'signet': return 'https://mempool.space/signet/tx/' + txid
    case 'testnet': return 'https://mempool.space/testnet/tx/' + txid
    default: return null   // regtest — local chain, no public explorer
  }
}

/** Journal pair key. First amm-add / amm-rr-add for this key is Create pool (A5). Add is later. */
function ammPairKey(e) {
  try {
    if (e.kind === 'amm-add' && e.runeId) return 'k:' + canonicalRuneKey(String(e.runeId))
    if (e.kind === 'amm-rr-add' && e.runeId && e.otherRuneId) return 'rr:' + rrPairKey(String(e.runeId), String(e.otherRuneId)).key
  } catch { /* malformed id — not a pair */ }
  return null
}
function isCreatePool(e) {
  const key = ammPairKey(e)
  if (!key) return false
  const first = events.find((x) => ammPairKey(x) === key)
  if (!first) return false
  if (first.hash && e.hash) return first.hash === e.hash
  return Number(first.seq) === Number(e.seq)
}
/** First writer of this pair — the hash that proves the book exists (A5). */
function originOfPairKey(key) {
  if (!key) return null
  const first = events.find((x) => ammPairKey(x) === key)
  return first ? { hash: first.hash, seq: first.seq, at: first.at || 0, from: first.from || null } : null
}

/** The signed rune-exit this lodge armed — dest + amount already in the journal. View only. */
function parentExitOfLodge(lodge) {
  const from = String(lodge.from || '')
  let rid = ''
  try { rid = canonicalRuneKey(String(lodge.runeId || '')) } catch { return null }
  const before = Number(lodge.seq) || 0
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (Number(ev.seq) >= before) continue
    if (String(ev.from) !== from) continue
    let erid = ''
    try { erid = canonicalRuneKey(String(ev.runeId || '')) } catch { continue }
    if (erid !== rid) continue
    if (ev.kind === 'rune-cancel') return null
    if (ev.kind === 'rune-exit') return ev
  }
  try {
    const lock = node.ledger.runes.lockedOf(parseRuneKey(lodge.runeId), from)
    if (lock) return { l1Address: lock.l1Address, amount: String(lock.amount), hash: null, seq: null }
  } catch { /* lock already settled — the walk above is the proof */ }
  return null
}

function txSummary(e, block) {
  const starNo = seqToStarNo.get(e.seq) ?? (e.star ?? null)
  const out = {
    hash: e.hash, seq: e.seq, kind: e.kind, at: e.at,
    from: e.from ?? null, to: e.to ?? null,
    fromWho: labelOf(e.from), toWho: labelOf(e.to),
    amount: e.amount ?? null, fee: e.fee ?? null, nonce: e.nonce ?? null,
    star: starNo, name: e.name ?? null, parent: e.parent ?? null,
    contentHash: e.contentHash ?? null, contentType: e.contentType ?? null, size: e.size ?? null,
    burn: seqToBurn.get(e.seq) ?? null,   // ₭ destroyed into the star (inscribe/origin/name); honest absence otherwise
    movedStars: null,
    interval: e.interval ?? null,
    blockNumber: block ? block.number : null,
    krayIn: e.krayIn ?? null, runeIn: e.runeIn ?? null, minLp: e.minLp ?? null,
    lp: e.lp ?? null, minKrayOut: e.minKrayOut ?? null, minRuneOut: e.minRuneOut ?? null,
    side: e.side ?? null, minOut: e.minOut ?? null,
    otherRuneId: e.otherRuneId ?? null, otherIn: e.otherIn ?? null,
    payRuneId: e.payRuneId ?? null, minOtherOut: e.minOtherOut ?? null,
  }
  // ── THE TWO LIGHTS on the tx (additive — the rich pages read these): a ₭ burn births Ӿ 1:1 to the
  //    burner (inscribe/origin/name via the size-burn, a law seal = 1, the signed burn = its amount);
  //    a star freeze engraves ✦ glow on the freezer. Re-derivable facts, mirrored here for display. ──
  const xBorn = e.kind === 'burn' ? (e.amount ?? null)
    : (seqToBurn.get(e.seq) ?? (e.kind === 'contract' && e.star != null ? '1' : null))
  if (xBorn != null) { out.xMinted = String(xBorn); out.xTo = e.from ?? null }
  if (e.kind === 'burn') out.burn = String(e.amount ?? '')          // the ₭ destroyed IS the amount on a sporadic burn
  if (e.kind === 'transfer-star' && e.to === 'KRAY_BLACK_HOLE') { out.glowEarned = 1; out.glowTo = e.from ?? null }
  if (e.kind === 'burn-thaw') out.thaw = true                       // the one-shot redemption of the pre-law frozen ₭
  if (e.kind && String(e.kind).startsWith('amm-') && e.runeId) {
    out.runeId = e.runeId
  }
  if (e.kind === 'amm-add' && e.runeId) {
    try {
      out.to = ammPoolAddress(String(e.runeId))
      out.toWho = labelOf(out.to)
      out.pairKey = ammPairKey(e)
      out.createPool = isCreatePool(e)
    } catch { /* malformed rune id — leave the add as an add */ }
  }
  if (e.kind === 'amm-rr-add' && e.runeId && e.otherRuneId) {
    try {
      const pair = rrPairKey(String(e.runeId), String(e.otherRuneId))
      out.to = ammRrPoolAddress(pair.a, pair.b)
      out.toWho = labelOf(out.to)
      out.pairKey = 'rr:' + pair.key
      out.createPool = isCreatePool(e)
    } catch { /* malformed pair — leave the add as an add */ }
  }
  // RUNE events carry which rune moved and where — surface it (the explorer showed only ₭ before)
  if (e.kind && e.kind.startsWith('rune-')) {
    out.runeId = e.runeId ?? null
    out.outpoint = e.outpoint ?? null      // rune-deposit: the L1 UTXO the runes entered the vault at
    out.l1Address = e.l1Address ?? null    // rune-exit: the signed L1 destination
    out.l1Txid = e.l1Txid ?? null          // rune-settle / rune-rehome: the proven L1 payout
    // Lodge binds an OPEN exit to the pot coin the payout will spend. That outpoint is an
    // OLD bakery UTXO — never alias it as l1Txid or the /tx page paints a 0-amount "payout"
    // on a buried block. Decode still uses outpoint (the pot coin). Settle/rehome keep l1Txid.
    if (e.kind === 'rune-lodge' && e.outpoint) {
      const pot = String(e.outpoint)
      const potTx = pot.split(':')[0]
      out.l1Role = 'pot-spend'
      out.potSpend = pot
      if (/^[0-9a-f]{64}$/i.test(potTx)) {
        out.potTxid = potTx.toLowerCase()
        out.potExplorer = mempoolTxUrl(out.potTxid)
      }
      // TO the user can trust: the L1 address their rune-exit already signed — not a dash, not the pot coin.
      const parent = parentExitOfLodge(e)
      if (parent && parent.l1Address) {
        out.l1Address = String(parent.l1Address)
        out.to = out.l1Address
        out.toWho = labelOf(out.to)
        if (parent.amount != null) out.exitAmount = String(parent.amount)
        if (parent.hash) { out.exitHash = parent.hash; out.exitSeq = parent.seq }
      }
    } else {
      const l1 = out.l1Txid || (e.outpoint ? String(e.outpoint).split(':')[0] : null)
      if (l1 && /^[0-9a-f]{64}$/i.test(l1)) {
        out.l1Txid = l1.toLowerCase()
        out.l1Explorer = mempoolTxUrl(out.l1Txid)
        if (e.kind === 'rune-deposit') out.l1Role = 'deposit'
        else if (e.kind === 'rune-settle' || e.kind === 'rune-rehome') out.l1Role = 'payout'
      }
    }
  }
  // A DONATION's ₭ came FROM a burned Bitcoin sat — there is no L2 sender. Surface that transaction: the
  // txid from the credited outpoint (the burn Bitcoin buried) + a network-aware explorer link, so the tx
  // page shows the burn as a clickable proof door instead of an empty "from". Purely additive — donate
  // views GAIN these fields; every existing field (from/to/amount/…) is byte-identical to before.
  if (e.kind === 'donate') {
    out.outpoint = e.outpoint ?? null
    out.l1Txid = e.outpoint ? String(e.outpoint).split(':')[0] : null
    out.l1Explorer = mempoolTxUrl(out.l1Txid)
    if (e.anchorBlock != null) out.anchorBlock = e.anchorBlock
    if (e.anchorRoot) out.anchorRoot = e.anchorRoot
  }
  // A send-star / baptism event does not repeat the bytes — they live on the STAR.
  // Every tx that names a star must still show its name and the same content
  // container the star page does (dynamic: whatever is written there now).
  if (starNo != null) {
    try {
      const s = node.star(BigInt(starNo))
      const raw = node.ledger.stars.star(BigInt(starNo))
      if (s) out.rarity = s.rarity
      if (raw) {
        out.starName = raw.name ?? null   // STABLE SHAPE: always present, null when unnamed — thin shapes are the recurring disease
        if (raw.contentHash) {
          out.contentHash = raw.contentHash
          out.contentType = raw.contentType ?? null
          if (raw.size != null) out.size = raw.size
        }
        if (out.parent == null && raw.parent != null) out.parent = String(raw.parent)
      }
    } catch { /* not a real star — leave the event fields as they are */ }
  }
  if (out.contentHash) {
    out.contentUrl = '/content/' + out.contentHash
    out.contentHeld = existsSync(join(CONTENT_DIR, out.contentHash))
  }
  return out
}
// the minimal /api/state the explorer reads (network/simulation/latestBlock/mainnet), plus a
// non-breaking supply + cascadeRoot for athe owner boxe else.
function stateView() {
  const s = node.supply()
  return {
    network: NET, simulation: false,
    latestBlock: tipNumber(), tip: tipNumber(),
    cascadeRoot: node.cascadeRoot(),
    supply: { emitted: s.emitted.toString(), burned: s.burned.toString(), circulating: s.circulating.toString(), fire: fireView(node.ledger) },
    starCount: node.ledger.stars.starCount,
    mainnet: { online: false },       // Phase 1: no mainnet mirror on the v2 server yet
    ...statusPayload(),
  }
}

// ── static asset serving for the rich pages (path-traversal safe) ──
function serveAsset(res, p) {
  const rel = p.replace(/^\/+/, '')
  if (rel.includes('..') || rel.includes('\0')) return err(res, 400, 'bad path')
  const full = join(APP_DIR, rel)
  if (!full.startsWith(APP_DIR)) return err(res, 400, 'bad path')
  const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase()
  const CT = { mp3: 'audio/mpeg', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', js: 'application/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json' }
  return serveFile(res, full, CT[ext] || 'application/octet-stream')
}

// ══ KRAY LAND on v2 — a PARCEL is a star born from fire; a DISTRICT is the span of the
//    journal that one Bitcoin anchor sealed; the star's creation number IS its lot number.
//    An anchor with nothing written beneath it mints NO land (a barren anchor, stated). ══
function catOf(ct) {
  // empty = a star with no bytes (a name lot). Otherwise the protocol shelf —
  // code, markup, vector… must not collapse into "text" (library.ts CATEGORIES).
  if (!ct) return 'name'
  return categoryOf(ct)
}
// THE FIRE — ₭ destroyed into stars (consensus burned) plus ₭ a citizen sent to the hole (still in Σ).
// Stars freeze; fungible ₭ burn. The tally is display; ledger.totalBurned is the tripwire.
function fireView(L) {
  const destroyed = L.totalBurned
  const chosen = L.balances.get(BLACK_HOLE) || 0n
  const into = {
    inscribe: fireTally.inscribe.toString(),
    origin: fireTally.origin.toString(),
    name: fireTally.name.toString(),
    law: fireTally.law.toString(),
    sporadic: fireTally.sporadic.toString(),   // the signed burn — ₭ died by choice, Ӿ born 1:1
  }
  const tally = fireTally.inscribe + fireTally.origin + fireTally.name + fireTally.law + fireTally.sporadic
  const thawed = L.thawHasRun === true   // once the thaw ran, the historical chosen entries became true burns
  const log = []
  for (let i = events.length - 1; i >= 0 && log.length < 48; i--) {
    const e = events[i]
    if (e.kind === 'transfer' && e.to === BLACK_HOLE) {
      log.push({
        // pre-law frozen ₭ — after the thaw it reads as a true burn, redeemed (the fire reached it late, but exact)
        kind: thawed ? 'chosen · burned (thawed)' : 'chosen · frozen (awaiting the thaw)', amount: String(e.amount ?? '0'),
        by: e.from ?? null, at: e.at ?? null, txHash: e.hash, star: null,
        name: null, size: null, contentType: null,
      })
      continue
    }
    if (e.kind === 'burn-thaw') {
      log.push({ kind: 'thaw', amount: null, by: null, at: e.at ?? null, txHash: e.hash, star: null, name: null, size: null, contentType: null })
      continue
    }
    const burn = seqToBurn.get(e.seq)
    if (burn == null) continue
    if (e.kind !== 'inscribe' && e.kind !== 'origin' && e.kind !== 'name' && e.kind !== 'contract' && e.kind !== 'burn') continue
    log.push({
      kind: e.kind === 'contract' ? 'law' : (e.kind === 'burn' ? 'sporadic' : e.kind),
      amount: burn,
      by: e.from ?? null, at: e.at ?? null, txHash: e.hash,
      star: (e.star != null ? String(e.star) : (seqToStarNo.get(e.seq) ?? null)),
      name: e.name ?? null, size: e.size ?? null, contentType: e.contentType ?? null,
    })
  }
  return {
    destroyed: destroyed.toString(),
    chosen: chosen.toString(),                 // = the hole's live fungible balance: 0 after the thaw, automatically
    total: (destroyed + chosen).toString(),
    acts: fireTally.acts,
    into,
    thawed,
    tallyMatches: tally + (thawed ? (L.thawedTotal ?? 0n) : 0n) === destroyed,
    log,
    law: 'Fungible ₭ burns in the fire — an inscription, a name, a law, or the signed burn (₭ never freezes: '
       + 'the burn law). A star sent to the hole freezes: visible forever, beyond reach, never destroyed — that is ✦. '
       + 'circulating ₭ = emitted − burned. Pre-law ₭ frozen at the hole is redeemed into a true burn by the one-shot thaw.',
  }
}
// THE BLACK HOLE, as the register page reads it: STARS frozen there (owned by the BLACK_HOLE
// address), each resolved to a container the page renders. ₭ sent here is the fire (see fireView),
// not a freeze — a star only appears here if someone SENT it to the hole.
function blackHoleView(L) {
  const frozen = L.stars.starsOf(BLACK_HOLE)
  // The register's "when / who / receipt" columns come from the ACT that froze each thing:
  // the last transfer-star (or ₭ transfer) whose destination is the black hole. One pass over
  // the journal collects both — the freeze act per star, and every pure-₭ retirement.
  const freezeActs = new Map()
  const krayActs = []
  for (const e of events) {
    if (e.kind === 'transfer-star' && e.to === BLACK_HOLE && e.star != null) freezeActs.set(String(e.star), e)
    else if (e.kind === 'transfer' && e.to === BLACK_HOLE) krayActs.push(e)
  }
  const entombed = frozen.map((no) => {
    const s = node.star(no)
    if (!s) return null
    const rec = s.contentHash ? L.stars.inscription(s.contentId || s.id) : null
    // real bytes: the inscription record when it knows, else the content store itself —
    // the atlas on disk is the honest witness of what this node actually holds
    let size = rec ? rec.size : 0
    if (!size && s.contentHash) { try { size = statSync(join(CONTENT_DIR, s.contentHash)).size } catch { /* content not held here */ } }
    const act = freezeActs.get(String(no)) || null
    return {
      star: String(no), name: s.name || null,
      kind: (s.contentHash || s.name) ? 'relic' : 'star',
      category: s.contentHash ? catOf(s.contentType) : (s.name ? 'name' : 'work'),
      contentType: s.contentType || null, rarity: s.rarity || 'common',
      size,
      url: s.contentHash ? '/content/' + s.contentHash : null,      // the page's thumbnail door
      at: act ? act.at : null, by: act ? act.from : null,           // when it fell in, and who let go
      txHash: act ? act.hash : null,                                // the signed act — the receipt
    }
  }).filter(Boolean)
  const krayRows = krayActs.map((e) => ({
    kind: 'kray', amount: String(e.amount ?? '0'), by: e.from ?? null, at: e.at ?? null, txHash: e.hash,
  }))
  // ONE register, newest first — the page reads it top-down as "what just happened"
  const register = [...entombed, ...krayRows].sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
  const kray = L.balances.get(BLACK_HOLE) || 0n
  return {
    kray: kray.toString(), balance: kray, stars: entombed.length,
    // `entombed` is the FULL register (stars + pure-₭ retirements) the black-hole page renders;
    // `relics` stays the stars-only array the dashboard reads — neither page breaks on the other's name.
    entombed: register, relics: entombed, frozen: entombed, address: BLACK_HOLE, entombedCount: register.length,
    fire: fireView(L),
    law: 'The black hole is an address derived from nothing-up-my-sleeve constants — provably keyless, '
       + 'so no signature can ever exist to move anything out. A star sent here freezes: it keeps its '
       + 'inscription, its name and its family tree — visible forever, beyond reach. Fungible ₭ does '
       + 'not freeze: it burns in the fire (an inscription, a name, a law, or a chosen send).',
    note: 'Stars freeze. Fungible ₭ burns. The register keeps every frozen star; the fire keeps every ₭ that died.',
  }
}
/**
 * THE TWO LIGHTS — ✦ glow (frozen stars, soulbound) and Ӿ (burn-born money + Fireborn tank).
 * Pure fold of the journal + ledger books. `top` caps the ranked lists (null = uncapped, same
 * honesty as the ₭ rank). /rank reads this from analytics; /api/kraynet/lights stays the
 * same envelope for any other reader.
 */
function lightsView(top) {
  return foldLights({ node, events, labelOf, top })
}
// The shelf's mark + label per category. Glyphs mirror library.html's own SHELF
// constant byte-for-byte; labels mirror library.ts CATEGORIES — so a shelf shown
// by the library page carries exactly the glyph that page keys off. Covers every
// SHELF id even though catOf only ever produces a subset (future-proof, harmless).
const SHELF_SPEC = {
  image: { glyph: '▣', label: 'Image' }, vector: { glyph: '◈', label: 'Vector' },
  video: { glyph: '▶', label: 'Video' }, audio: { glyph: '♪', label: 'Audio' },
  code: { glyph: '⌘', label: 'Code' }, markup: { glyph: '❰', label: 'Markup' },
  document: { glyph: '▤', label: 'Document' }, data: { glyph: '⛁', label: 'Data' },
  text: { glyph: '¶', label: 'Text' }, model: { glyph: '◉', label: '3D' },
  font: { glyph: 'A', label: 'Font' }, archive: { glyph: '▦', label: 'Archive' },
  file: { glyph: '◇', label: 'File' },
  law: { glyph: '⚖', label: 'Law' },
}
function parcelOfStar(no) {
  const s = node.ledger.stars.star(BigInt(no)); if (!s) return null
  const blk = blockOfSeq(s.seq)
  const codex = node.ledger.stars.codexOf(BigInt(no))
  const size = s.size || (s.name ? Buffer.byteLength(String(s.name), 'utf8') : 0)
  return {
    star: String(no), lot: Number(no), size,                       // the creation number IS the lot
    contentType: s.contentType || null, category: s.contentHash ? catOf(s.contentType) : 'name',
    url: s.contentHash ? '/content/' + s.contentHash : null, name: s.name || null,
    kind: s.contentHash ? 'inscription' : 'baptism', number: s.contentHash ? Number(no) : null,
    id: s.id || null, by: s.by, byWho: labelOf(s.by),
    blockNumber: blk ? blk.number : null, rarity: codex.rarity, at: blk ? blk.at : null,
    contentHash: s.contentHash || null,
    held: s.contentHash ? existsSync(join(CONTENT_DIR, s.contentHash)) : false,  // this node holds the bytes → render the content on the parcel
    lookalike: false, tld: null,
  }
}
// a block mints its land only once Bitcoin has SEALED it — the anchor is buried ≥ ANCHOR_CONF
// (verified), or a dev placeholder when no bitcoind is live (simulated). A merely-broadcast anchor
// (real tx, still 0..ANCHOR_CONF-1 conf) or a pending one is NOT a land yet — its district is still
// forming. This keeps the amber master consistent with the strip's gold: sealed ⟺ verified‖simulated.
const anchoredBlocks = () => [...anchors.entries()].filter(([, a]) => a.verified || a.simulated).map(([n]) => n).sort((a, b) => a - b)
function parcelsInBlocks(fromBlock, toBlock) {
  const out = [], total = Number(node.ledger.stars.createdSeq)
  for (let no = 0; no < total; no++) {
    const s = node.ledger.stars.star(BigInt(no)); if (!s) continue
    const blk = blockOfSeq(s.seq); if (!blk || blk.number < fromBlock || blk.number > toBlock) continue
    out.push(parcelOfStar(no))
  }
  return out
}
// the city register: consecutive land numbers for the anchored blocks that minted parcels
function landRollV2() {
  const anc = anchoredBlocks(), lands = [], lotOf = new Map(); let landNo = 0, prevBoundary = -1
  for (const ab of anc) {
    const parcels = parcelsInBlocks(prevBoundary + 1, ab)
    if (parcels.length) {
      landNo++; for (const p of parcels) lotOf.set(p.star, { lot: p.lot })
      const a = anchors.get(ab)
      lands.push({ number: landNo, height: ab, minted: true, txid: a.txid, cascadeRoot: a.root,
        at: (blocks[ab] || {}).at || null, btcHeight: a.btcHeight ?? null, btcChain: a.btcChain ?? null,
        parcels: parcels.length, bytes: parcels.reduce((x, p) => x + (p.size || 0), 0), firstLot: parcels[0].lot })
    }
    prevBoundary = ab
  }
  return { lands, totalLands: landNo, totalLots: lotOf.size, lotOf, lastBoundary: prevBoundary }
}
const heightOfLandV2 = (n) => { const e = landRollV2().lands[n - 1]; return e ? e.height : null }
function buildLandV2(height) {
  const R = landRollV2()
  const pack = (from, to, entry, a) => {
    const parcels = to >= from ? parcelsInBlocks(from, to) : []
    return {
      land: entry ? entry.number : null, height: a ? height : null, minted: !!entry, live: !a, exists: parcels.length > 0,
      range: { fromBlock: from, toBlock: to, blocks: Math.max(0, to - from + 1), leaves: parcels.length },
      totals: { parcels: parcels.length, lots: parcels.length, bytes: parcels.reduce((x, p) => x + (p.size || 0), 0), inscriptions: parcels.filter((p) => p.kind === 'inscription').length, baptisms: parcels.filter((p) => p.kind === 'baptism').length, writers: new Set(parcels.map((p) => p.by)).size }, parcels,
      lots: { first: entry ? entry.firstLot : null, count: parcels.length },
      cityTotals: { lands: R.totalLands, lots: R.totalLots },
      anchor: a ? { txid: a.txid, confirmations: a.confirmations, verified: !!a.verified, simulated: !!a.simulated, cascadeRoot: a.root,
        at: (blocks[height] || {}).at || null, btcHeight: a.btcHeight ?? null, btcChain: a.btcChain ?? null } : null,
      neighbours: entry ? { prev: entry.number > 1 ? entry.number - 1 : null, next: entry.number < R.totalLands ? entry.number + 1 : null } : { prev: R.totalLands || null, next: null },
    }
  }
  if (height === null) return pack(R.lastBoundary + 1, tipNumber(), null, null)   // the forming (live) district
  const a = anchors.get(height); if (!a) return null
  const anc = anchoredBlocks(), idx = anc.indexOf(height)
  return pack(idx > 0 ? anc[idx - 1] + 1 : 0, height, R.lands.find((l) => l.height === height), a)
}

// ══ THE RICH STAR PAGE VIEW ══════════════════════════════════════════════════
// node.star() is FLAT (a registry row). star.html renders a much richer object:
// an inscriptions[] array, a family tree (ancestors + children as tree nodes),
// the birth block, the baptism, the name reading, and the full history. Build it
// here — with a real DARK state for a number no star has reached yet, so paging to
// an uncreated number renders "not yet created" instead of breaking the page.
function starCard(v) {                                   // one node of the constellation tree
  if (!v) return null
  return {
    star: String(v.no), name: v.name ?? null, rarity: v.rarity,
    url: v.contentHash ? '/content/' + v.contentHash : null, contentType: v.contentType ?? null,
  }
}
function originKidCards(l1Id) {
  return node.ledger.stars.childrenOfOrigin(l1Id).map((c) => starCard(node.star(c))).filter(Boolean)
}
const callReceipts = new Map()
let callReceiptsReady = false
function ensureCallReceipts() {
  if (callReceiptsReady) return
  // Re-derive contract-call receipts by replaying the journal on a private ledger. It MUST be built
  // exactly like the live store's ledger (store.ts) — same potScriptHex, backingGate AND atlas — or the
  // replay diverges: a WINDOWED settlement re-verifies its custody claim against the content bytes, and an
  // atlas-less ledger reads null for every hash → `hit-unreadable` → HALT, which the read path then
  // surfaces as "could not be loaded from the node". The atlas is the same disk-backed reader the store uses.
  const L = openKrayLedger(NET, undefined, POT_SCRIPT_HEX || undefined, BACKING_GATE, (hash) => {
    try { const p = join(CONTENT_DIR, hash); return existsSync(p) ? new Uint8Array(readFileSync(p)) : null } catch { return null }
  })
  for (const e of events) {
    L.applyLive(e)
    if (e.kind === 'contract-call' && L.lastCall) {
      callReceipts.set(e.hash, { hash: e.hash, seq: e.seq, ...L.lastCall })
    }
  }
  callReceiptsReady = true
}

function historyOfStar(nStr) {                           // every event that ever touched this star, oldest first
  ensureCallReceipts()
  const face = node.star(BigInt(nStr))
  const pot = face && face.contract ? String(face.contract) : null
  const out = []
  let lastMarket = null                                  // live offer on THIS star — so a second list is a relist
  for (const e of events) {                              // events[] is stored in seq order — oldest first
    const evStar = seqToStarNo.get(e.seq) ?? (e.star != null ? String(e.star) : null)
    const onPot = pot && e.kind === 'contract-call' && String(e.contract || '') === pot
    if (evStar !== nStr && !onPot) continue
    const blk = blockOfSeq(e.seq)
    const rec = e.kind === 'contract-call' ? callReceipts.get(e.hash) : null
    const paid = rec ? rec.payments.filter((p) => BigInt(p.amount) > 0n) : []
    let tag = e.kind
    let via = 'act'
    if (e.kind === 'star-list') {
      via = 'market'
      tag = lastMarket === 'star-list' ? 'relist' : 'list'
      lastMarket = 'star-list'
    } else if (e.kind === 'star-delist') {
      via = 'market'; tag = 'cancel'; lastMarket = null
    } else if (e.kind === 'star-buy') {
      via = 'market'; tag = 'sale'; lastMarket = null
    } else if (e.kind === 'star-offer') {
      via = 'market'; tag = 'offer'
    } else if (e.kind === 'star-offer-cancel') {
      via = 'market'; tag = 'offer-cancel'
    } else if (e.kind === 'star-offer-accept') {
      via = 'market'; tag = 'offer-accept'; lastMarket = null
    } else if (e.kind === 'transfer-star') {
      via = String(e.to || '') === 'KRAY_BLACK_HOLE' ? 'fire' : 'send'
      tag = via === 'fire' ? 'freeze' : 'send'
      lastMarket = null
    } else if (e.kind === 'inscribe' || e.kind === 'origin' || e.kind === 'name') {
      via = 'birth'
      tag = e.kind === 'inscribe' ? 'write' : e.kind
    } else if (e.kind === 'contract' || e.kind === 'contract-call') {
      via = 'law'
    }
    out.push({
      kind: e.kind, tag, via, from: e.from ?? null, to: e.to ?? null, hash: e.hash,
      amount: e.amount != null ? String(e.amount) : null,
      at: e.at ?? null,
      blockNumber: blk ? blk.number : null,
      blockAt: blk && blk.at != null ? blk.at : null,
      burn: seqToBurn.get(e.seq) ?? null,
      ...(e.kind === 'contract-call' ? { rule: e.rule ?? null, contract: e.contract ?? null } : {}),
      ...(rec ? { take: rec.take, payments: rec.payments, interval: rec.interval, beacon: rec.beacon, paid } : {}),
    })
  }
  return out
}
function starView(nBig) {
  const s = node.star(nBig)
  if (!s) {
    // a number below createdSeq with no star is truly absent (cursed/missing) → 404 upstream;
    // a number at or beyond createdSeq is simply UNBORN → a dark placeholder the page can render.
    if (nBig < node.ledger.stars.createdSeq) return null
    return {
      star: String(nBig), no: String(nBig), dark: true, rarity: 'dark', written: false,
      inscriptions: [], children: [], family: { childCount: 0, children: [], ancestors: [], immediate: [] },
      listing: null, offers: [],
      traits: [], collection: null, owner: null, name: null, contract: null, law: null,
      baptism: null, nameReading: null, birth: null, history: [],
    }
  }
  const nStr = String(s.no)
  const written = !!(s.contentHash || s.name)

  // the ONE inscription (a star holds exactly one), enriched with its birth order,
  // its byte size, and whether THIS node holds the sealed bytes locally.
  let inscriptions = []
  if (s.contentHash) {
    const rec = node.ledger.stars.inscription(s.contentId || s.id)      // s.id IS the inscription id → its birth number + size
    inscriptions = [{
      number: rec ? rec.number ?? null : null,           // birth order among all living inscriptions
      id: s.id, contentHash: s.contentHash, contentType: s.contentType,
      size: rec ? rec.size ?? null : null, by: s.by,
      meta: (rec && rec.meta) || s.meta || null,
      parent: s.parent != null ? String(s.parent) : null,
      held: existsSync(join(CONTENT_DIR, s.contentHash)),
      url: '/content/' + s.contentHash, category: catOf(s.contentType),
    }]
  }

  // the family tree — children are direct descendants. Immediate parents are EVERY
  // signed blood (KRAY stars + L1 origins), side by side. A linear ancestor climb
  // is only honest when there is exactly one parent; two bloods are never stacked
  // as if they were one chain. (parent/origin scalars stay first-of, forever.)
  const parentNos = (s.parents && s.parents.length)
    ? s.parents.map(String)
    : (s.parent != null ? [String(s.parent)] : [])
  const originIds = (s.origins && s.origins.length)
    ? s.origins.map((o) => o.l1InscriptionId)
    : (s.origin && s.origin.l1InscriptionId ? [s.origin.l1InscriptionId] : [])
  const immediate = []
  for (const p of parentNos) {
    const card = starCard(node.star(BigInt(p)))
    if (card) immediate.push({ ...card, role: 'parent' })
  }
  for (const id of originIds) {
    immediate.push({ l1: true, id, txid: String(id).split('i')[0], role: 'origin', children: originKidCards(id) })
  }
  const ancestors = []
  if (parentNos.length === 1 && originIds.length === 0) {
    let pno = parentNos[0], guard = 0
    while (pno != null && guard++ < 64) {
      const anc = node.star(BigInt(pno)); if (!anc) break
      ancestors.push(starCard(anc)); pno = anc.parent
    }
  } else if (parentNos.length === 0 && originIds.length === 1) {
    ancestors.push({ l1: true, id: originIds[0], txid: originIds[0].split('i')[0], children: originKidCards(originIds[0]) })
  }
  const children = (s.children || []).map((c) => starCard(node.star(BigInt(c)))).filter(Boolean)

  // the birth block, and whether this star was the FIRST one born in that block
  let birth = null
  const blk = blockOfSeq(s.seq)
  if (blk) {
    let firstOfInterval = true
    for (let k = 0n; k < s.no; k++) {                    // any earlier-numbered star sharing the block?
      const es = node.ledger.stars.star(k); if (!es) continue
      const eb = blockOfSeq(es.seq)
      if (eb && eb.number === blk.number) { firstOfInterval = false; break }
    }
    birth = { interval: blk.number, firstOfInterval }
  }

  // THE STAR MARKET — the live offer (if any) rides the star view so the page and the wallet render the
  // Buy / Cancel / Relist chrome from the same proven source (the reducer's listing book).
  const _mkt = node.ledger.market.get(nBig)
  const listing = _mkt ? { seller: _mkt.seller, price: _mkt.price.toString() } : null
  const offers = node.ledger.offers.onStar(nBig).map((o) => ({ bidder: o.bidder, price: o.price.toString() }))

  const history = historyOfStar(nStr)
  const inscEv = history.find((h) => h.kind === 'inscribe' || h.kind === 'origin')
  const nameEv = history.find((h) => h.kind === 'name')
  if (inscriptions[0]) inscriptions[0].burn = inscEv && inscEv.burn ? inscEv.burn : null

  return {
    star: nStr, no: nStr, dark: false, written,
    owner: s.owner, by: s.by, id: s.id, seq: s.seq,
    name: s.name ?? null, contentHash: s.contentHash ?? null, contentType: s.contentType ?? null,
    meta: s.meta ?? null,
    contract: s.contract ?? null,
    law: s.contract ? node.contract(s.contract) : null,
    parent: s.parent != null ? String(s.parent) : null, origin: s.origin ?? null,
    // MULTIPARENT (additive): the FULL signed lineage; the scalars above keep first-of meaning
    parents: s.parents ? s.parents.map(String) : null, origins: s.origins ? s.origins.map((o) => o.l1InscriptionId) : null,
    rarity: s.rarity, collection: s.collection, traits: s.traits,
    inscriptions,
    baptism: s.name ? { name: s.name, by: s.by, burn: nameEv && nameEv.burn ? nameEv.burn : null } : null,
    nameReading: s.name ? readName(s.name) : null,
    birth,
    family: { childCount: children.length, children, ancestors, immediate },
    history,
    listing,   // { seller, price } when the star is for sale on the native market, else null
    offers,    // live escrowed bids [{ bidder, price }] — pot-locked, highest first
    lastDelivery: [...history].reverse().find((h) => h.kind === 'contract-call' && (h.rule === 'settle' || h.rule === 'draw') && Array.isArray(h.paid) && h.paid.length) || null,
    luz: luzFace(nStr, s.contract ? node.contract(s.contract) : null),
  }
}

/** Luz ✧ on this face — book when portioned, named-empty when the paper is infinite, unportioned otherwise. */
function luzFace(nStr, law) {
  const book = node.ledger.cuts.view(nStr)
  if (book) return { ...book, glyph: '✧', unportioned: false }
  if (law && isCutPaper(law.code) && String(law.code.vars?.capped) === '0') {
    return { star: nStr, name: 'Luz', glyph: '✧', supply: '0', capped: false, circulating: '0', holders: [], unportioned: false, infinite: true }
  }
  return { star: nStr, name: 'Luz', glyph: '✧', unportioned: true, supply: null, circulating: '0', holders: [] }
}

// ══ LINEAGE COLLECTIONS — a parent with children is the collection.
//    A named KRAY star OR a Bitcoin L1 ordinal (origin). The L1 is not a star
//    on this book; it is still the father. The front must show it as a collection
//    because the children are here. Derived from the journal. No new event kind.
function isImageType(ct) {
  return String(ct || '').toLowerCase().startsWith('image/')
}
function parseStarMeta(s) {
  if (!s || !s.meta) return null
  try { const m = JSON.parse(s.meta); return m && typeof m === 'object' ? m : null } catch { return null }
}
function collectionFace(s) {
  const media = s.contentHash ? '/content/' + s.contentHash : null
  const meta = parseStarMeta(s)
  const bannerHash = meta && typeof meta.banner === 'string' ? String(meta.banner).toLowerCase() : ''
  const banner = /^[0-9a-f]{64}$/.test(bannerHash)
    ? '/content/' + bannerHash
    : (media && isImageType(s.contentType) ? media : null)
  let about = null
  if (meta && typeof meta.description === 'string' && meta.description.trim()) about = meta.description.trim().slice(0, 4000)
  else if (meta && typeof meta.about === 'string' && meta.about.trim()) about = meta.about.trim().slice(0, 4000)
  return { media, banner, about, contentType: s.contentType || null }
}
function marketMarks() {
  const listedAt = new Map()
  const volumeByStar = new Map()
  const salesByStar = new Map()
  for (const e of events) {
    if (e.star == null) continue
    const k = String(e.star)
    if (e.kind === 'star-list') listedAt.set(k, e.seq)
    if (e.kind === 'star-buy' || e.kind === 'star-offer-accept') {
      try { volumeByStar.set(k, (volumeByStar.get(k) || 0n) + BigInt(e.amount || '0')) } catch { /* refuse a hostile amount silently — volume is display */ }
      salesByStar.set(k, (salesByStar.get(k) || 0) + 1)
    }
  }
  return { listedAt, volumeByStar, salesByStar }
}
function starMarketFace(starNo) {
  try {
    const s = node.star(BigInt(starNo))
    if (!s) return { star: String(starNo), name: null, media: null, contentType: null, collection: null, rarity: null }
    return {
      star: String(s.no),
      name: s.name ?? null,
      media: s.contentHash ? '/content/' + s.contentHash : null,
      contentType: s.contentType ?? null,
      collection: s.collection ?? null,
      rarity: s.rarity ?? null,
    }
  } catch { return { star: String(starNo), name: null, media: null, contentType: null, collection: null, rarity: null } }
}
/** Read-only pulse — last sold / just listed / highest ask / hottest collection. Journal + live book. */
function marketPulse() {
  const { listedAt, volumeByStar, salesByStar } = marketMarks()
  const live = node.ledger.market.all()
  const sold = []
  const tape = []
  const lastList = new Map()
  let sales = 0
  let volume = 0n
  let acts = 0
  for (const e of events) {
    if (e.kind !== 'star-list' && e.kind !== 'star-delist' && e.kind !== 'star-buy'
      && e.kind !== 'star-offer' && e.kind !== 'star-offer-cancel' && e.kind !== 'star-offer-accept') continue
    acts += 1
    const star = e.star != null ? String(e.star) : null
    let tag = e.kind === 'star-buy' || e.kind === 'star-offer-accept' ? 'sale'
      : (e.kind === 'star-delist' ? 'cancel'
        : (e.kind === 'star-offer' ? 'offer'
          : (e.kind === 'star-offer-cancel' ? 'offer-cancel' : 'list')))
    if (e.kind === 'star-list' && star && lastList.get(star) === 'star-list') tag = 'relist'
    if (star) lastList.set(star, e.kind === 'star-list' ? 'star-list' : null)
    const face = star ? starMarketFace(star) : {}
    const blk = blockOfSeq(e.seq)
    const row = {
      kind: e.kind, tag, via: 'market',
      star, name: face.name ?? null, media: face.media ?? null, contentType: face.contentType ?? null,
      collection: face.collection ?? null,
      amount: e.amount != null ? String(e.amount) : null,
      from: e.from ?? null, to: e.to ?? null, hash: e.hash,
      seq: e.seq, at: e.at ?? null, block: blk ? blk.number : null,
    }
    tape.push(row)
    if (e.kind === 'star-buy' || e.kind === 'star-offer-accept') {
      sales += 1
      try { volume += BigInt(e.amount || '0') } catch { /* display only */ }
      sold.push(row)
    }
  }
  const listedLive = live.map((l) => {
    const face = starMarketFace(l.star)
    return {
      ...face,
      seller: l.seller,
      price: String(l.price),
      listedSeq: listedAt.get(String(l.star)) ?? null,
    }
  })
  const justListed = listedLive.slice().sort((a, b) => Number(b.listedSeq || 0) - Number(a.listedSeq || 0)).slice(0, 12)
  const expensive = listedLive.slice().sort((a, b) => {
    try { const d = BigInt(b.price) - BigInt(a.price); return d > 0n ? 1 : d < 0n ? -1 : 0 } catch { return 0 }
  }).slice(0, 8)
  const cols = collectionsIndex().map((c) => ({ ...c })).sort((a, b) => {
    try {
      const d = BigInt(b.volume || '0') - BigInt(a.volume || '0')
      if (d !== 0n) return d > 0n ? 1 : -1
    } catch { /* fall through */ }
    return (b.sales || 0) - (a.sales || 0) || (b.listed - a.listed)
  })
  return {
    stats: {
      listed: live.length,
      sales,
      volume: volume.toString(),
      acts,
      feePerAct: '1',
      fees: String(acts),
    },
    sold: sold.slice(-12).reverse(),
    listed: justListed,
    expensive,
    bids: node.ledger.offers.all()
      .map((o) => ({ ...starMarketFace(o.star), bidder: o.bidder, price: o.price }))
      .sort((a, b) => {
        try { const d = BigInt(b.price) - BigInt(a.price); return d > 0n ? 1 : d < 0n ? -1 : 0 } catch { return 0 }
      })
      .slice(0, 12),
    hotCollections: cols.slice(0, 6),
    tape: tape.slice(-48).reverse(),
  }
}
function collectionItem(s, listedAt) {
  const mkt = node.ledger.market.get(s.no)
  const face = collectionFace(s)
  return {
    star: String(s.no),
    name: s.name ?? null,
    owner: s.owner,
    rarity: s.rarity,
    contentType: face.contentType,
    media: face.media,
    listing: mkt ? { seller: mkt.seller, price: mkt.price.toString() } : null,
    listedSeq: listedAt.get(String(s.no)) ?? null,
    createdSeq: s.seq,
  }
}
function originIdsOf(s) {
  if (!s) return []
  if (s.origins && s.origins.length) return s.origins.map((o) => String(o.l1InscriptionId || o).toLowerCase()).filter(Boolean)
  if (s.origin && s.origin.l1InscriptionId) return [String(s.origin.l1InscriptionId).toLowerCase()]
  return []
}
function kidMarketRoll(kids, volumeByStar, salesByStar) {
  let listed = 0
  let floor = null
  let volume = 0n
  let sales = 0
  const owners = new Set()
  for (const c of kids) {
    const cs = node.star(c)
    if (cs && cs.owner) owners.add(cs.owner)
    const offer = node.ledger.market.get(c)
    if (offer) {
      listed++
      if (floor == null || offer.price < floor) floor = offer.price
    }
    volume += volumeByStar.get(String(c)) || 0n
    if (salesByStar) sales += salesByStar.get(String(c)) || 0
  }
  return { listed, floor, volume, sales, owners }
}
function l1CollectionFace(kids) {
  for (const c of kids) {
    const cs = node.star(c)
    if (!cs) continue
    const face = collectionFace(cs)
    if (face.banner || (face.media && isImageType(face.contentType))) return face
  }
  for (const c of kids) {
    const cs = node.star(c)
    if (cs) return collectionFace(cs)
  }
  return { media: null, banner: null, about: null, contentType: null }
}
function collectionsIndex() {
  const { volumeByStar, salesByStar } = marketMarks()
  const out = []
  const R = node.ledger.stars
  for (let i = 0n; i < R.createdSeq; i++) {
    const s = node.star(i)
    if (!s || !s.name) continue
    const kids = s.children || []
    if (!kids.length) continue
    const roll = kidMarketRoll(kids, volumeByStar, salesByStar)
    const face = collectionFace(s)
    out.push({
      name: s.name,
      href: s.name,
      star: String(s.no),
      owner: s.owner,
      l1: false,
      media: face.media,
      banner: face.banner,
      contentType: face.contentType,
      childCount: kids.length,
      listed: roll.listed,
      owners: roll.owners.size,
      floor: roll.floor != null ? roll.floor.toString() : null,
      volume: roll.volume.toString(),
      sales: roll.sales,
    })
  }
  const seenL1 = new Set()
  for (let i = 0n; i < R.createdSeq; i++) {
    const s = node.star(i)
    for (const id of originIdsOf(s)) {
      if (seenL1.has(id)) continue
      const kids = R.childrenOfOrigin(id)
      if (!kids.length) continue
      seenL1.add(id)
      const roll = kidMarketRoll(kids, volumeByStar, salesByStar)
      const face = l1CollectionFace(kids)
      out.push({
        name: '₿ ' + id.slice(0, 8) + '…',
        href: 'ord/' + id,
        origin: id,
        star: null,
        owner: null,
        l1: true,
        media: face.media,
        banner: face.banner,
        contentType: face.contentType,
        childCount: kids.length,
        listed: roll.listed,
        owners: roll.owners.size,
        floor: roll.floor != null ? roll.floor.toString() : null,
        volume: roll.volume.toString(),
        sales: roll.sales,
      })
    }
  }
  out.sort((a, b) => (b.listed - a.listed) || (b.childCount - a.childCount) || (Number(a.star || 0) - Number(b.star || 0)))
  return out
}
function resolveCollectionStar(raw) {
  const key = String(raw || '').trim()
  if (!key) return null
  if (/^(0|[1-9]\d*)$/.test(key)) {
    const s = node.star(BigInt(key))
    return s ? s.no : null
  }
  const insId = key.toLowerCase()
  if (/^[0-9a-f]{64}i\d+$/.test(insId)) {
    const ins = node.ledger.stars.inscription(insId)
    if (!ins || ins.cursed || ins.star == null) return null
    return typeof ins.star === 'bigint' ? ins.star : BigInt(ins.star)
  }
  return node.ledger.stars.starOfName(key)
}
function l1CollectionView(l1Id) {
  const kids = node.ledger.stars.childrenOfOrigin(l1Id)
  if (!kids.length) return null
  const { listedAt, volumeByStar } = marketMarks()
  const items = []
  const owners = new Set()
  let listed = 0
  let floor = null
  let volume = 0n
  for (const c of kids) {
    const cs = node.star(c)
    if (!cs) continue
    if (cs.owner) owners.add(cs.owner)
    const item = collectionItem(cs, listedAt)
    items.push(item)
    if (item.listing) {
      listed++
      const p = BigInt(item.listing.price)
      if (floor == null || p < floor) floor = p
    }
    volume += volumeByStar.get(String(c)) || 0n
  }
  const face = l1CollectionFace(kids)
  return {
    name: '₿ ' + l1Id.slice(0, 8) + '…',
    href: 'ord/' + l1Id,
    origin: l1Id,
    l1: true,
    star: null,
    owner: null,
    rarity: null,
    contentType: face.contentType,
    media: face.media,
    banner: face.banner,
    about: 'Bitcoin L1 ordinal — not a star on this book. Father of these stars by signed origin.',
    items,
    stats: {
      items: items.length,
      listed,
      owners: owners.size,
      floor: floor != null ? floor.toString() : null,
      volume: volume.toString(),
    },
  }
}
function collectionView(rawKey) {
  const key = String(rawKey || '').trim()
  const named = key.match(/^ord\/([0-9a-f]{64}i\d+)$/i)
  const l1 = (named ? named[1] : key).toLowerCase()
  if (/^[0-9a-f]{64}i\d+$/.test(l1) && node.ledger.stars.childrenOfOrigin(l1).length) {
    return l1CollectionView(l1)
  }
  const no = resolveCollectionStar(rawKey)
  if (no == null) return null
  const s = node.star(no)
  if (!s) return null
  const { listedAt, volumeByStar } = marketMarks()
  const kids = s.children || []
  const items = []
  const owners = new Set()
  let listed = 0
  let floor = null
  let volume = 0n
  for (const c of kids) {
    const cs = node.star(c)
    if (!cs) continue
    if (cs.owner) owners.add(cs.owner)
    const item = collectionItem(cs, listedAt)
    items.push(item)
    if (item.listing) {
      listed++
      const p = BigInt(item.listing.price)
      if (floor == null || p < floor) floor = p
    }
    volume += volumeByStar.get(String(c)) || 0n
  }
  const face = collectionFace(s)
  let about = face.about
  if (!about && s.contentHash && /^text\//i.test(s.contentType || '')) {
    try {
      const pth = join(CONTENT_DIR, s.contentHash)
      if (existsSync(pth)) about = readFileSync(pth, 'utf8').slice(0, 4000)
    } catch { /* missing atlas is not a missing collection */ }
  }
  return {
    name: s.name,
    href: s.name,
    l1: false,
    star: String(s.no),
    owner: s.owner,
    rarity: s.rarity,
    contentType: face.contentType,
    media: face.media,
    banner: face.banner,
    about,
    items,
    stats: {
      items: items.length,
      listed,
      owners: owners.size,
      floor: floor != null ? floor.toString() : null,
      volume: volume.toString(),
    },
  }
}

// ── boot: load the journal + the real Bitcoin anchors, seal all history into block #0, then heartbeat ──
loadAnchors()   // real seal txids survive a reboot — reloaded, never re-broadcast
loadSelfAnchors()   // the self-anchor log (donations that ARE anchors) survives a reboot too
loadVaultWatch()    // the vault watcher's registry survives too — an eye that forgets is no eye
loadSettlements()   // lodged pre-signed settlements survive a reboot (only read/broadcast if the flag is on)
if (btcConfigured()) { setInterval(() => { sweepVaultWatch() }, VAULT_WATCH_SEC * 1000).unref?.() }
loadPoolState()   // Slice 2b: standing offers + the pending backstop job survive a reboot (then yield to any seal)
for (const e of loadJournalEvents()) ingest(e, false)
indexHistoricalBurns(events)
for (let no = 0n; no < node.ledger.stars.createdSeq; no++) {
  const s = node.ledger.stars.star(no)
  if (s) seqToStarNo.set(s.seq, no.toString())   // boot: map every already-born star to its event
}
bornCount = Number(node.ledger.stars.createdSeq)
// restore the persisted block segmentation if it re-derives against the journal; else collapse into #0
// (the pre-persistence behaviour — the safe fallback for a fresh chain or a torn sidecar).
{
  const persisted = loadPersistedBlocks()
  if (persisted) {
    for (const b of persisted) blocks.push(b)
    lastSealedSeq = persisted[persisted.length - 1].toSeq
    // seal ONLY the tail that arrived after the last persisted block. Restored blocks keep their anchor
    // state (the anchor sidecar + the boot watch reconcile them), so nothing already sealed is re-anchored.
    if (events.length > lastSealedSeq) { const bt = sealBlock(lastSealedSeq + 1, events.length, events[events.length - 1].at || Date.now()); maybeAnchor(bt) }
    console.log(`blocks restored — ${blocks.length} block(s), numbers stable across the restart`)
  } else if (events.length) {
    const b0 = sealBlock(1, events.length, events[events.length - 1].at || Date.now()); maybeAnchor(b0)
  }
  saveBlocks()
}
loadPresence()   // F-03: beats survive a writer restart; unpaid work is not RAM-only
node.store.onEvent = (e) => ingest(e, true)       // every live write appends to the block layer

// ══ THE LANE MEMPOOL (TK-fold Gate 3 tooling — NON-consensus) ═══════════════════════════════
// Pending lane transfers wait here for a folder. Admission mirrors the spec's door (canonical
// amount/nonce + a real signature over the lane's own domain) so hostile bytes never occupy a
// slot — but NOTHING here is consensus: the fold proof re-checks every signature inside the
// zkVM, and the reducer re-checks the fold. In-memory by design (a mempool, not a journal);
// a lost pool is re-submitted, never re-derived. Pruned lazily: a transfer whose nonce fell
// below the account's PROVEN lane nonce is dead (it landed, or a rival did).
const LANE_POOL_MAX = 10_000
const lanePool = []
function lanePrune() {
  for (let i = lanePool.length - 1; i >= 0; i--) {
    if (lanePool[i].nonce < node.ledger.laneNonceOf(lanePool[i].from)) lanePool.splice(i, 1)
  }
}
/** Next unsigned lane nonce for `from`: the proven nonce plus every pending send already in the pool.
 *  Same arithmetic the crossing rite uses — the HTML must not invent the domain string or the nonce. */
function laneNextNonce(from) {
  lanePrune()
  return node.ledger.laneNonceOf(from) + lanePool.filter((x) => x.from === from).length
}
/** Nano-class dust wall: a slot in the lane pool costs lane Ӿ already on the book (plus pending).
 *  Signature-valid empty accounts cannot flood RAM. Not consensus — the fold still re-checks. */
function lanePendingFrom(from) {
  return lanePool.filter((x) => x.from === from).reduce((s, x) => s + (parseLaneAmount(x.amount) ?? 0n), 0n)
}
function assertLaneCovered(from, amt) {
  const have = node.ledger.laneBalanceOf(from)
  const reserved = lanePendingFrom(from)
  if (have < amt + reserved) throw new Error(`insufficient lane Ӿ (have ${have}, pending ${reserved}, need ${amt}) — dust cannot occupy the pool`)
}
/** THE LANE PREPARE — returns the exact `tkFoldSendMessage` + nonce the wallet must sign.
 *  No journal write. No state mutation. The folder / reducer still re-check the signature. */
function prepareLaneSend(b) {
  const from = String(b.from || '')
  const to = String(b.to || '')
  const amount = String(b.amount || '')
  const amt = parseLaneAmount(amount)
  if (!from) throw new Error('from is required')
  if (amt === undefined || amt <= 0n) throw new Error('a lane amount must be a positive canonical decimal within u128 (the canonical-decimal law)')
  if (!to) throw new Error('to is required')
  if (from === to) throw new Error('a lane transfer needs two different parties')
  if (!isAddressOnNetwork(from, toBtcNet(NET))) throw new Error(`that address is not a ${NET} address — a ${NET} node writes only for its own network (value never crosses networks)`)
  if (!isAddressOnNetwork(to, toBtcNet(NET))) throw new Error(`the receiver is not a ${NET} address — a ${NET} node writes only for its own network`)
  assertNotAmmPot(to, 'lane-send')
  assertNotContractPot(to, 'lane-send')
  assertLaneCovered(from, amt)
  const nonce = laneNextNonce(from)
  return { message: tkFoldSendMessage(NET, from, to, amt, nonce), nonce }
}
// Slice 2c boot sweep — AFTER the live-ingest hook, so the seal events enter the block layer like any other
// write. Seals that confirmed while the node was down (or before this law existed) reopen their window
// increment now, once each, ever (hasSeal makes this idempotent across every future boot). Only REAL,
// VERIFIED seals count: simulated markers never touch Bitcoin, so they never touch the window.
journalMissingSeals()
// the heartbeat survives an error, but never silently: a seal that cannot happen is NAMED (once per
// distinct cause) — a mute catch here once hid a whole exam's worth of unsealed blocks.
let _sealErrSeen = ''
setInterval(() => {
  try { sealTick(Date.now()); journalMissingSeals(); _sealErrSeen = '' } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (m !== _sealErrSeen) { _sealErrSeen = m; console.error('⚠ seal heartbeat failed (will keep retrying): ' + m) }
  }
}, SEAL_MS)
// the anchor watch: confirm broadcast anchors as Bitcoin buries them, retry any that never sent. Fires once
// on boot too, so a seal left unconfirmed before a restart (or reloaded from the sidecar) gets promoted.
if (btcConfigured()) { setInterval(() => { try { anchorWatch() } catch (_) { /* keep the watch alive */ } }, ANCHOR_WATCH_MS); anchorWatch() }

// ── the Supreme-Law write flow ───────────────────────────────────────────────
// inscribe: the wallet sends raw `content` (or a pre-hashed `contentHash`+`size`). We derive
// the byte-unique hash and size DETERMINISTICALLY, identically in prepare and submit, so the
// message the wallet signed is exactly the one the reducer re-derives. (A star is born from
// the act, so v2 signs NO star number.)
// THE INSCRIBED BYTES — base64-decoded when the client says so (encoding:'base64'), else the raw
// utf8 string. Content-addressing hashes the REAL bytes: an image is its pixels, not its base64
// envelope. Text/SVG (no encoding) hash identically to before — utf8 bytes — so nothing regresses.
// The door's ceiling IS the protocol's ceiling — one constant, imported, so door and reducer
// can never drift apart. Env override stays for bench experiments only.
function liveContentMax() {
  const env = parseInt(process.env.KRAY_CONTENT_MAX || '', 10)
  if (Number.isFinite(env) && env > 0) return env
  return node.ledger.inscriptionCeiling
}
function contentBuf(b) {
  const buf = b && b.encoding === 'base64' ? Buffer.from(String(b.content), 'base64') : Buffer.from(String(b.content ?? ''), 'utf8')
  const cap = liveContentMax()
  if (!(buf.length <= cap)) throw new Error(`content is ${buf.length} bytes — the protocol ceiling is ${cap}`)
  return buf
}
function inscribeFields(b) {
  const contentType = b.contentType || 'text/plain'
  if (b.content != null) {
    const buf = contentBuf(b)
    const contentHash = createHash('sha256').update(buf).digest('hex')
    // Genetics: recompute from the real bytes (magic wins over a lying type). Never trust a client bodyHash.
    let bodyHash = null
    try { bodyHash = bodyHashOf(buf, contentType) } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e))
    }
    return { contentHash, contentType, size: buf.length, parent: b.parent, ...(bodyHash ? { bodyHash } : {}) }
  }
  // SECURITY: content uniqueness must be earned with the actual BYTES, never a client-asserted hash. Accepting a
  // bare contentHash would let athe owner boxe compute sha256(a rival's not-yet-published art) and mint a star that claims
  // it — front-running the true creator and leaving an unservable "ghost" star. First-writer-wins means first
  // writer of the BYTES, so we require them here.
  throw new Error('inscribing content needs the actual bytes (content) — a bare contentHash cannot claim uniqueness')
}
function originRide(b, origins, contentHash) {
  if (!origins.length) return {}
  const out = {}
  if (b.originProofs) out.originProofs = parseOriginProofs(b.originProofs)
  if (typeof b.originCohortRoot === 'string' && b.originCohortRoot) out.originCohortRoot = String(b.originCohortRoot).toLowerCase()
  // Opening act only. bodiesOf copies extra.originCohort onto every file; a sibling
  // that re-journals the leaf list is refused ("only the opening act…"). Strip here
  // so one leftover folder does not die after the first star.
  if (out.originProofs && Array.isArray(b.originCohort) && b.originCohort.length) {
    out.originCohort = b.originCohort.map((x) => String(x).toLowerCase())
  }
  if (out.originProofs && out.originProofs[0] && contentHash) {
    const p = out.originProofs[0]
    out.originBind = originChildBindOf(NET, origins[0], p.holderTxid, p.holderVout, p.holderOffset, String(contentHash))
  }
  return out
}
function units(raw, name) {
  const s = String(raw ?? '')
  if (!/^[0-9]+$/.test(s)) throw new Error(`${name} must be a whole number of base units`)
  return BigInt(s)
}
/** THE BACKING GATE, AT THE DOOR (always on) — same law as rune-send. A new AMM write
 *  never waits on KRAY_BACKING_GATE: hostage credits cannot birth a pool or swap in.
 *  Replay of a pre-law journal is the reducer's flag; the door is only for NEW acts. */
function assertNotAmmPot(to, verb) {
  if (isAmmPotAddress(String(to || ''))) {
    throw new Error(`an AMM pot is not a payment address — ${verb} refused; reserves move only by signed amm-add/swap`)
  }
  if (String(to || '') === STAR_OFFER) {
    throw new Error(`the star-offer pot is not a payment address — ${verb} refused; ₭ enters only by signed star-offer`)
  }
}
function assertNotContractPot(to, verb) {
  if (isContractPotAddress(String(to || ''))) {
    throw new Error(`${verb}: a rune cannot enter a law pot — the IR pays only ₭. Send ₭ to fund it.`)
  }
}
function assertAmmPotBacked(from, runeId, amount, verb) {
  const rid = parseRuneKey(String(runeId))
  const want = typeof amount === 'bigint' ? amount : BigInt(String(amount))
  const free = node.ledger.runes.transferableOf(rid, String(from))
  if (want > free) {
    const pers = node.ledger.runes.personalOf(rid, String(from))
    throw new Error(`only pot-backed runes may ${verb} (hostage ${pers} stays, transferable ${free}) — a pool must never depend on a living personal key`)
  }
}
function assertRuneOnL2(runeId, verb) {
  const id = canonicalRuneKey(String(runeId))
  if (!node.ledger.runes.knows(parseRuneKey(id))) {
    throw new Error(`${id} is not on this L2 — cannot ${verb}; a pool is born only from a proven rune book`)
  }
}

/** Door compile — IR as typed, or a living-flag desk that emits the same IR. */
function readContractCode(b, from, opts) {
  const exam = !!(opts && opts.exam)
  if (b.code != null) {
    const code = b.code
    if (!code || typeof code !== 'object') throw new Error('code must be a contract object')
    const v = validateContract(code)
    if (!v.ok) throw new Error(v.reason || 'the contract is not valid')
    return code
  }
  if (b.living && Array.isArray(b.living.flags)) {
    return compileLivingLaw({
      owner: callerInt(String(from)),
      payout: String(from),
      flags: b.living.flags.map((f) => ({
        name: String(f.name || ''),
        on: !!f.on,
        motion: String(f.motion || '') === 'once' ? 'once' : 'toggle',
      })),
    })
  }
  if (b.form && typeof b.form === 'object') {
    const f = b.form
    const kind = String(f.kind || '')
    if (kind === 'escrow') {
      const lock = f.lock != null && String(f.lock) !== '' ? Number(f.lock) : NaN
      const deadline = (f.deadline != null && String(f.deadline) !== '')
        ? String(f.deadline)
        : String(node.ledger.appliedSeq + (Number.isFinite(lock) && lock > 0 ? Math.floor(lock) : 64))
      return compileForm({ kind: 'escrow', buyer: String(f.buyer || ''), seller: String(f.seller || ''), deadline })
    }
    if (kind === 'tunnel') {
      const dest = f.dest != null && String(f.dest) !== '' ? String(f.dest) : undefined
      if (!dest && readOnStar(b) == null) {
        throw new Error('a follow-face tunnel needs a star — or name a dest')
      }
      return compileForm({ kind: 'tunnel', dest })
    }
    if (kind === 'vest') {
      const start = (f.start != null && String(f.start) !== '') ? String(f.start) : String(node.ledger.appliedSeq)
      return compileForm({
        kind: 'vest',
        beneficiary: String(f.beneficiary || ''),
        start,
        duration: String(f.duration || ''),
        total: String(f.total || ''),
      })
    }
    if (kind === 'scroll') {
      const gate = String(f.gate || 'open')
      const locked = !!f.locked
      const allowRaw = f.allow
      const allow = Array.isArray(allowRaw)
        ? allowRaw.map((a) => String(a))
        : String(allowRaw || '').split(/[\s,]+/).filter(Boolean)
      if (readOnStar(b) == null && (gate === 'stamp' || !locked)) {
        throw new Error('a stamp or unlocked scroll needs a star — v1 can only seal a locked open/list scroll')
      }
      return compileForm({
        kind: 'scroll',
        each: String(f.each || ''),
        max: String(f.max || (gate === 'list' ? String(allow.length) : '')),
        locked,
        gate,
        allow,
      })
    }
    if (kind === 'raffle') {
      return compileForm({
        kind: 'raffle',
        price: String(f.price || ''),
        period: f.period != null && String(f.period) !== '' ? String(f.period) : undefined,
        seats: f.seats != null && String(f.seats) !== '' ? String(f.seats) : undefined,
      })
    }
    if (kind === 'mint') {
      const max = String(f.max || '')
      const payTo = String(f.payTo || '').trim()
      const code = compileForm({
        kind: 'mint',
        price: String(f.price || ''),
        max,
        ...(payTo ? { payTo } : {}),
      })
      if (!exam) requireMintShelf(f.shelf, Number(max))
      return code
    }
    if (kind === 'cut' || kind === 'luz') {
      return compileForm({
        kind: 'luz',
        supply: f.supply != null && String(f.supply) !== '' ? String(f.supply) : undefined,
        infinite: !!f.infinite,
      })
    }
    throw new Error(`unknown form "${kind}" — escrow, tunnel, vest, scroll, raffle, mint, or luz`)
  }
  throw new Error('a contract needs code, a living-law flag list, or a form (escrow / tunnel / vest / scroll / raffle / mint / luz)')
}
function readCallArgs(b) {
  const raw = (b.args && typeof b.args === 'object') ? b.args : (b.callArgs && typeof b.callArgs === 'object' ? b.callArgs : {})
  const out = {}
  for (const [k, val] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9_]{0,23}$/.test(k)) throw new Error(`bad argument name "${k}"`)
    const s = String(val)
    if (!/^-?\d+$/.test(s)) throw new Error(`argument "${k}" must be a whole number`)
    out[k] = BigInt(s)
  }
  return out
}
function isRafflePaper(code) {
  const names = new Set((code?.rules || []).map((r) => r.name))
  return names.has('enter') && names.has('settle') && names.has('draw')
}
function isMintPaper(code) {
  const names = new Set((code?.rules || []).map((r) => r.name))
  return names.has('mint') && !names.has('enter')
}
function loadMintShelves() {
  try { return existsSync(MINT_SHELF_FILE) ? JSON.parse(readFileSync(MINT_SHELF_FILE, 'utf8')) : {} }
  catch { return {} }
}
function saveMintShelf(star, shelf) {
  const all = loadMintShelves()
  all[String(star)] = shelf
  writeFileSync(MINT_SHELF_FILE, JSON.stringify(all))
}
function mintShelfOf(star) {
  const v = loadMintShelves()[String(star)]
  return (v && String(v).trim()) || null
}
function isMintFace(starNo) {
  try {
    const st = node.star(BigInt(starNo))
    if (!st || !st.contract) return false
    const law = node.contract(st.contract)
    return !!(law && isMintPaper(law.code))
  } catch { return false }
}
async function pullMintArt(starNo) {
  const st = node.star(BigInt(starNo))
  if (!st || !st.contract) throw new Error('that face has no mint paper')
  const law = node.contract(st.contract)
  if (!law || !isMintPaper(law.code)) throw new Error('that face is not a mint')
  const shelf = mintShelfOf(starNo)
  if (!shelf) throw new Error('this node cannot reveal that drop — the art source stays on the writer')
  const taken = Number(law.state && law.state.taken != null ? law.state.taken : 0)
  const max = Number(law.state && law.state.max != null ? law.state.max : 0)
  if (String((law.state && law.state.open) || '1') !== '1') throw new Error('the drop is paused')
  if (!(taken < max)) throw new Error('sold out')
  const url = resolveMintShelf(shelf, taken)
  const fr = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000) })
  if (!fr.ok) throw new Error('the artist source refused')
  const len = Number(fr.headers.get('content-length') || 0)
  const cap = liveContentMax()
  if (len > cap) throw new Error('the art is larger than the inscription ceiling')
  const buf = Buffer.from(await fr.arrayBuffer())
  if (buf.length > cap) throw new Error('the art is larger than the inscription ceiling')
  if (!buf.length) throw new Error('the artist source returned empty bytes')
  const type = String(fr.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream'
  return { content: buf.toString('base64'), encoding: 'base64', contentType: type, size: buf.length }
}
async function bindMintArt(b) {
  const mintFrom = b.mintFrom != null && String(b.mintFrom) !== '' ? String(b.mintFrom).replace(/[#,\s]/g, '') : ''
  const listed = (b.parents && b.parents[0] != null) ? String(b.parents[0]).replace(/[#,\s]/g, '') : (b.parent != null ? String(b.parent).replace(/[#,\s]/g, '') : '')
  const face = mintFrom || listed
  if (!face || !isMintFace(face)) return
  if (b.content != null) throw new Error('you buy the artist’s edition — do not attach your own file')
  const art = await pullMintArt(face)
  b.content = art.content
  b.encoding = art.encoding
  b.contentType = art.contentType
  if (!b.parents && b.parent == null) b.parents = [face]
}
function readOnStar(b) {
  if (b.star == null || String(b.star) === '') return undefined
  const n = String(b.star).replace(/[#,\s]/g, '')
  if (!/^(0|[1-9]\d*)$/.test(n)) throw new Error('star must be a creation number')
  return n
}
function prepareMessage(action, b, nonceOverride) {
  const from = b.from
  if (!from) throw new Error('from is required')
  // a batch prepares many actions at once, each at a sequential nonce (n, n+1, …); the override lets the
  // batch builder assign them without each item re-reading the same current nonce. Default = the live nonce.
  const nonce = nonceOverride != null ? nonceOverride : node.nonceOf(from)
  switch (action) {
    case 'transfer': assertNotAmmPot(b.to, 'transfer'); return { message: transferMessage(NET, from, b.to, BigInt(b.amount), nonce), nonce }
    case 'burn': return { message: burnMessage(NET, from, BigInt(b.amount), nonce), nonce }   // the sporadic burn — its own domain, no `to`
    case 'x-send': {
      assertNotAmmPot(b.to, 'x-send'); assertNotContractPot(b.to, 'x-send')
      const xAmt = parseLaneAmount(String(b.amount ?? ''))
      if (xAmt === undefined) throw new Error('an Ӿ amount must be a canonical decimal within u128 (the canonical-decimal law)')
      return { message: xSendMessage(NET, from, b.to, xAmt, nonce), nonce }
    }
    case 'cut-send': {
      assertNotAmmPot(b.to, 'cut-send'); assertNotContractPot(b.to, 'cut-send')
      const star = readOnStar(b)
      if (star == null) throw new Error('a Luz send needs a star number')
      const luzAmt = parseLaneAmount(String(b.amount ?? ''))
      if (luzAmt === undefined) throw new Error('a Luz amount must be a canonical decimal within u128 (the canonical-decimal law)')
      return { message: cutSendMessage(NET, from, b.to, BigInt(star), luzAmt, nonce), nonce, star }
    }
    // THE TK-FOLD (Gate 2, dormant until the ratified seq): enter/exit the compressed lane; a folder lands a proven breath
    case 'lane-enter': {
      const enterAmt = parseLaneAmount(String(b.amount ?? ''))
      if (enterAmt === undefined) throw new Error('a lane amount must be a canonical decimal within u128 (the canonical-decimal law)')
      return { message: laneEnterMessage(NET, from, enterAmt, nonce), nonce }
    }
    case 'lane-exit': {
      const exitAmt = parseLaneAmount(String(b.amount ?? ''))
      if (exitAmt === undefined) throw new Error('a lane amount must be a canonical decimal within u128 (the canonical-decimal law)')
      return { message: laneExitMessage(NET, from, exitAmt, nonce), nonce }
    }
    case 'fold-seal': return { message: foldSealMessage(NET, from, String(b.foldPre), String(b.foldPost), String(b.foldDiffsHash), nonce), nonce }
    case 'sendstar': assertNotAmmPot(b.to, 'send star'); return { message: sendStarMessage(NET, from, b.to, BigInt(b.star), nonce), nonce, star: String(b.star) }
    // THE STAR MARKET — the exact terms each party signs (buyer signs star+price+seller: no phantom price)
    case 'star-list': return { message: starListMessage(NET, from, BigInt(b.star), BigInt(b.price), nonce), nonce, star: String(b.star) }
    case 'star-delist': return { message: starDelistMessage(NET, from, BigInt(b.star), nonce), nonce, star: String(b.star) }
    case 'star-buy': assertNotAmmPot(b.seller, 'buy star'); return { message: starBuyMessage(NET, from, BigInt(b.star), BigInt(b.price), String(b.seller), nonce), nonce, star: String(b.star) }
    case 'star-offer': return { message: starOfferMessage(NET, from, BigInt(b.star), BigInt(b.price), nonce), nonce, star: String(b.star) }
    case 'star-offer-cancel': return { message: starOfferCancelMessage(NET, from, BigInt(b.star), nonce), nonce, star: String(b.star) }
    case 'star-offer-accept': assertNotAmmPot(b.bidder, 'accept offer'); return { message: starOfferAcceptMessage(NET, from, BigInt(b.star), BigInt(b.price), String(b.bidder), nonce), nonce, star: String(b.star) }
    case 'inscribe': {
      const f = inscribeFields(b)
      const meta = readInscriptionMeta(b)
      const mp = multiparentLists(b)
      const onStar = b.star != null && String(b.star) !== '' ? BigInt(String(b.star).replace(/[#,\s]/g, '')) : undefined
      const cohortRoot = typeof b.originCohortRoot === 'string' ? b.originCohortRoot.toLowerCase() : ''
      if (cohortRoot) {
        if (onStar != null && (mp || f.parent != null)) throw new Error('lineage rides only on a BIRTH act — not on add-to-existing')
        const parents = mp ? mp.parents : (f.parent != null ? [String(f.parent).replace(/[#\s]/g, '')] : [])
        const origins = mp ? mp.origins : []
        return {
          message: inscribeMessageV6(NET, from, f.contentHash, f.contentType, f.size, parents, origins, cohortRoot, nonce, onStar, f.bodyHash, meta),
          nonce, size: f.size, contentHash: f.contentHash, bodyHash: f.bodyHash,
          burn: starBurnOf(f.size, node.ledger.bytesPerKray).toString(), atlasFee: node.ledger.atlasFeeOf(f.size).toString(),
          star: (onStar != null ? String(onStar) : node.ledger.stars.createdSeq.toString()),
        }
      }
      // METADATA (v4): free JSON present → v4 (lineage lists empty-OK). A single v2
      // parent becomes the v4 parents list so one signature still states parentage.
      // Absent meta → frozen v3 (lists) or v2 (scalar / onStar).
      if (f.bodyHash) {
        if (onStar != null && (mp || f.parent != null)) throw new Error('lineage rides only on a BIRTH act — not on add-to-existing')
        const parents = mp ? mp.parents : (f.parent != null ? [String(f.parent).replace(/[#\s]/g, '')] : [])
        const origins = mp ? mp.origins : []
        return {
          message: inscribeMessageV5(NET, from, f.contentHash, f.contentType, f.size, parents, origins, f.bodyHash, nonce, onStar, meta),
          nonce, size: f.size, contentHash: f.contentHash, bodyHash: f.bodyHash,
          burn: starBurnOf(f.size, node.ledger.bytesPerKray).toString(), atlasFee: node.ledger.atlasFeeOf(f.size).toString(),
          star: (onStar != null ? String(onStar) : node.ledger.stars.createdSeq.toString()),
        }
      }
      if (meta) {
        if (onStar != null && (mp || f.parent != null)) throw new Error('lineage rides only on a BIRTH act — not on add-to-existing')
        const parents = mp ? mp.parents : (f.parent != null ? [String(f.parent).replace(/[#\s]/g, '')] : [])
        const origins = mp ? mp.origins : []
        return { message: inscribeMessageV4(NET, from, f.contentHash, f.contentType, f.size, parents, origins, meta, nonce, onStar), nonce, size: f.size, contentHash: f.contentHash, burn: starBurnOf(f.size, node.ledger.bytesPerKray).toString(), atlasFee: node.ledger.atlasFeeOf(f.size).toString(), star: (onStar != null ? String(onStar) : node.ledger.stars.createdSeq.toString()) }
      }
      if (mp) return { message: inscribeMessageV3(NET, from, f.contentHash, f.contentType, f.size, mp.parents, mp.origins, nonce), nonce, size: f.size, contentHash: f.contentHash, burn: starBurnOf(f.size, node.ledger.bytesPerKray).toString(), atlasFee: node.ledger.atlasFeeOf(f.size).toString(), star: node.ledger.stars.createdSeq.toString() }
      return { message: inscribeMessageV2(NET, from, f.contentHash, f.contentType, f.size, f.parent != null ? BigInt(f.parent) : undefined, nonce, onStar), nonce, size: f.size, contentHash: f.contentHash, burn: starBurnOf(f.size, node.ledger.bytesPerKray).toString(), atlasFee: node.ledger.atlasFeeOf(f.size).toString(), star: (onStar != null ? String(onStar) : node.ledger.stars.createdSeq.toString()) }
    }
    case 'origin': {
      // ORIGIN — a NEW born-from-fire star whose PARENT is a Bitcoin L1 ordinal (cascaded
      // provenance from L1). Same content as an inscribe; the parent is the L1 inscription id.
      const f = inscribeFields(b)
      if (!b.parentId) throw new Error('origin needs a Bitcoin L1 ordinal id as parent (parentId)')
      return { message: originMessageV2(NET, from, b.parentId, f.contentHash, f.contentType, f.size, nonce), nonce, size: f.size, contentHash: f.contentHash, burn: starBurnOf(f.size, node.ledger.bytesPerKray).toString(), atlasFee: node.ledger.atlasFeeOf(f.size).toString(), star: node.ledger.stars.createdSeq.toString() }
    }
    case 'name': { const onStar = b.star != null && String(b.star) !== '' ? BigInt(String(b.star).replace(/[#,\s]/g, '')) : undefined; return { message: nameMessageV2(NET, from, nonce, b.name, onStar), nonce, star: (onStar != null ? String(onStar) : node.ledger.stars.createdSeq.toString()) } }
    case 'rune-send': assertNotAmmPot(b.to, 'rune-send'); assertNotContractPot(b.to, 'rune-send'); return { message: runeSendMessage(NET, from, b.to, b.runeId, BigInt(b.amount), nonce), nonce }
    case 'rune-exit': return { message: runeExitMessage(NET, from, b.runeId, BigInt(b.amount), b.l1Address, nonce), nonce }
    case 'rune-cancel': return { message: runeCancelMessage(NET, from, b.runeId, nonce), nonce }
    case 'amm-add': {
      const runeId = canonicalRuneKey(String(b.runeId))
      assertRuneOnL2(runeId, 'create or add to a pool')
      assertAmmPotBacked(from, runeId, units(b.runeIn, 'runeIn'), 'enter a pool')
      return { message: ammAddMessage(NET, from, runeId, units(b.krayIn, 'krayIn'), units(b.runeIn, 'runeIn'), units(b.minLp || '0', 'minLp'), nonce), nonce }
    }
    case 'amm-remove': {
      const runeId = canonicalRuneKey(String(b.runeId))
      return { message: ammRemoveMessage(NET, from, runeId, units(b.lp, 'lp'), units(b.minKrayOut || '0', 'minKrayOut'), units(b.minRuneOut || '0', 'minRuneOut'), nonce), nonce }
    }
    case 'amm-swap': {
      const runeId = canonicalRuneKey(String(b.runeId))
      assertRuneOnL2(runeId, 'swap')
      if (b.side === 'rune') assertAmmPotBacked(from, runeId, units(b.amount, 'amount'), 'swap in')
      return { message: ammSwapMessage(NET, from, runeId, b.side === 'rune' ? 'rune' : 'kray', units(b.amount, 'amount'), units(b.minOut || '0', 'minOut'), nonce), nonce }
    }
    case 'amm-rr-add': {
      const { pair, aIn, bIn } = orderRrBody(b)
      assertRuneOnL2(pair.a, 'create or add to a rune/rune pool')
      assertRuneOnL2(pair.b, 'create or add to a rune/rune pool')
      assertAmmPotBacked(from, pair.a, aIn, 'enter a rune/rune pool')
      assertAmmPotBacked(from, pair.b, bIn, 'enter a rune/rune pool')
      return { message: ammRrAddMessage(NET, from, pair.a, pair.b, aIn, bIn, units(b.minLp || '0', 'minLp'), nonce), nonce, runeId: pair.a, otherRuneId: pair.b }
    }
    case 'amm-rr-remove': {
      const pair = rrPairKey(String(b.runeId), String(b.otherRuneId))
      const ca = canonicalRuneKey(String(b.runeId))
      const minA = ca === pair.a ? units(b.minRuneOut || '0', 'minRuneOut') : units(b.minOtherOut || '0', 'minOtherOut')
      const minB = ca === pair.a ? units(b.minOtherOut || '0', 'minOtherOut') : units(b.minRuneOut || '0', 'minRuneOut')
      return { message: ammRrRemoveMessage(NET, from, pair.a, pair.b, units(b.lp, 'lp'), minA, minB, nonce), nonce, runeId: pair.a, otherRuneId: pair.b }
    }
    case 'amm-rr-swap': {
      const pair = rrPairKey(String(b.runeId), String(b.otherRuneId))
      const pay = canonicalRuneKey(String(b.payRuneId || b.pay || ''))
      if (pay !== pair.a && pay !== pair.b) throw new Error('payRuneId must be one side of the pair')
      assertAmmPotBacked(from, pay, units(b.amount, 'amount'), 'swap in')
      return { message: ammRrSwapMessage(NET, from, pair.a, pair.b, pay, units(b.amount, 'amount'), units(b.minOut || '0', 'minOut'), nonce), nonce, runeId: pair.a, otherRuneId: pair.b, payRuneId: pay }
    }
    case 'quantum-commit': { const commit = String(b.commit || '').toLowerCase(); return { message: quantumCommitMessage(NET, from, commit, nonce), nonce, commit } }
    case 'contract': {
      const code = readContractCode(b, from)
      const codeHash = sha256hex(canonicalCode(code))
      const onStar = readOnStar(b)
      if (isRafflePaper(code) && onStar == null) {
        throw new Error('a raffle needs a star — the Bitcoin seal is the clock, and draw is the living mouth')
      }
      if (isMintPaper(code) && onStar == null) {
        throw new Error('a mint needs a star — the face is the parent of every child')
      }
      if (onStar != null) {
        return { message: contractMessageV2(NET, from, codeHash, BigInt(onStar)), star: onStar, burn: '1', codeHash, code }
      }
      return { message: contractMessage(NET, from, codeHash), codeHash, code }
    }
    case 'contract-call': {
      if (!b.contract || !b.rule) throw new Error('a call needs contract + rule')
      if (String(b.rule) === 'mint') throw new Error('mint is a birth — inscribe with this face as parent')
      const args = readCallArgs(b)
      const clock = Date.now()
      return { message: contractCallMessageV2(NET, from, String(b.contract), String(b.rule), args, nonce, clock), nonce, clock }
    }
    default: throw new Error(`unknown action "${action}"`)
  }
}
function buildSubmitEvent(action, b, atOverride) {
  const base = { from: b.from, nonce: Number(b.nonce), publicKey: b.publicKey, signature: b.signature, scheme: (b.scheme === 'ml-dsa' ? 'ml-dsa' : 'kraywallet'), at: atOverride ?? Date.now() }
  let action_
  // SECURITY: never touch the content store before the signature is verified. An unsigned/unpaid request must
  // write NOTHING (else it is an unauthenticated disk-fill, and a way to plant attacker-chosen bytes served from
  // this origin). We stage the write here and execute it ONLY after node.submit() accepts the signed event.
  let pendingWrite = null
  const stageContent = (f) => { if (b.content != null) pendingWrite = { hash: f.contentHash, buf: contentBuf(b), meta: { contentType: f.contentType, size: f.size, at: Date.now() } } }
  switch (action) {
    case 'transfer': assertNotAmmPot(b.to, 'transfer'); action_ = { ...base, kind: 'transfer', to: b.to, amount: String(b.amount), fee: '1' }; break
    case 'burn': action_ = { ...base, kind: 'burn', amount: String(b.amount), fee: '1' }; break   // the sporadic burn — no recipient; ₭ dies, Ӿ born 1:1
    case 'x-send': assertNotAmmPot(b.to, 'x-send'); assertNotContractPot(b.to, 'x-send'); action_ = { ...base, kind: 'x-send', to: b.to, amount: String(b.amount), fee: '1' }; break   // Ӿ transfer (slice 2, live from the ratified seq)
    case 'cut-send': {
      assertNotAmmPot(b.to, 'cut-send'); assertNotContractPot(b.to, 'cut-send')
      const star = readOnStar(b)
      if (star == null) throw new Error('a Luz send needs a star number')
      action_ = { ...base, kind: 'cut-send', to: b.to, star, amount: String(b.amount), fee: '1' }
      break
    }
    // THE TK-FOLD (Gate 2): the lane's journal doors — the reducer holds every wall (proof, chaining, conservation)
    case 'lane-enter': action_ = { ...base, kind: 'lane-enter', amount: String(b.amount), fee: '1' }; break
    case 'lane-exit': action_ = { ...base, kind: 'lane-exit', amount: String(b.amount), fee: '1' }; break
    case 'fold-seal': action_ = {
      ...base, kind: 'fold-seal', fee: '1',
      foldPre: String(b.foldPre), foldPost: String(b.foldPost), foldDiffsHash: String(b.foldDiffsHash),
      foldDiffs: b.foldDiffs, foldProof: String(b.foldProof), foldPublic: String(b.foldPublic),
    }; break
    case 'sendstar': assertNotAmmPot(b.to, 'send star'); action_ = { ...base, kind: 'transfer-star', to: b.to, star: String(b.star), fee: '1' }; break
    // THE STAR MARKET — native, atomic, trustless. list/edit-price + delist + buy; the eternal 1-₭ fee → validators.
    case 'star-list': action_ = { ...base, kind: 'star-list', star: String(b.star), amount: String(b.price), fee: '1' }; break
    case 'star-delist': action_ = { ...base, kind: 'star-delist', star: String(b.star), fee: '1' }; break
    case 'star-buy': assertNotAmmPot(b.seller, 'buy star'); action_ = { ...base, kind: 'star-buy', to: b.seller, star: String(b.star), amount: String(b.price), fee: '1' }; break
    case 'star-offer': action_ = { ...base, kind: 'star-offer', star: String(b.star), amount: String(b.price), fee: '1' }; break
    case 'star-offer-cancel': action_ = { ...base, kind: 'star-offer-cancel', star: String(b.star), fee: '1' }; break
    case 'star-offer-accept': assertNotAmmPot(b.bidder, 'accept offer'); action_ = { ...base, kind: 'star-offer-accept', to: b.bidder, star: String(b.star), amount: String(b.price), fee: '1' }; break
    case 'inscribe': {
      const f = inscribeFields(b)
      stageContent(f)
      const meta = readInscriptionMeta(b)
      const mp = multiparentLists(b)   // v3 lists ride the event verbatim (order is signed)
      const onStar = b.star != null && String(b.star) !== '' ? String(b.star).replace(/[#,\s]/g, '') : undefined
      if (f.bodyHash) {
        if (onStar != null && (mp || f.parent != null)) throw new Error('lineage rides only on a BIRTH act — not on add-to-existing')
        const parents = mp ? mp.parents : (f.parent != null ? [String(f.parent).replace(/[#\s]/g, '')] : [])
        const origins = mp ? mp.origins : []
        action_ = {
          ...base, kind: 'inscribe', contentHash: f.contentHash, contentType: f.contentType, size: f.size,
          bodyHash: f.bodyHash,
          ...(meta ? { meta } : {}),
          ...(parents.length ? { parents } : {}), ...(origins.length ? { origins } : {}),
          ...originRide(b, origins, f.contentHash),
          ...(onStar != null ? { star: onStar } : {}),
        }
      } else if (meta) {
        if (onStar != null && (mp || f.parent != null)) throw new Error('lineage rides only on a BIRTH act — not on add-to-existing')
        const parents = mp ? mp.parents : (f.parent != null ? [String(f.parent).replace(/[#\s]/g, '')] : [])
        const origins = mp ? mp.origins : []
        action_ = {
          ...base, kind: 'inscribe', contentHash: f.contentHash, contentType: f.contentType, size: f.size,
          meta,
          ...(parents.length ? { parents } : {}), ...(origins.length ? { origins } : {}),
          ...originRide(b, origins, f.contentHash),
          ...(onStar != null ? { star: onStar } : {}),
        }
      } else {
        action_ = mp
          ? { ...base, kind: 'inscribe', contentHash: f.contentHash, contentType: f.contentType, size: f.size, parents: mp.parents, origins: mp.origins, ...originRide(b, mp.origins, f.contentHash) }
          : { ...base, kind: 'inscribe', contentHash: f.contentHash, contentType: f.contentType, size: f.size, ...(f.parent != null ? { parent: String(f.parent) } : {}), ...(onStar != null ? { star: onStar } : {}) }
      }
      break
    }
    case 'origin': {
      const f = inscribeFields(b)
      if (!b.parentId) throw new Error('origin needs a Bitcoin L1 ordinal id as parent (parentId)')
      stageContent(f)
      action_ = { ...base, kind: 'origin', l1InscriptionId: b.parentId, contentHash: f.contentHash, contentType: f.contentType, size: f.size, originProofs: parseOriginProofs(b.originProofs) }
      break
    }
    case 'name': action_ = { ...base, kind: 'name', name: String(b.name ?? ''), ...(b.star != null && String(b.star) !== '' ? { star: String(b.star).replace(/[#,\s]/g, '') } : {}) }; break
    case 'quantum-commit': action_ = { ...base, kind: 'quantum-commit', quantumCommit: String(b.commit || '').toLowerCase() }; break
    case 'contract': {
      const code = readContractCode(b, b.from)
      const onStar = readOnStar(b)
      if (isRafflePaper(code) && onStar == null) {
        throw new Error('a raffle needs a star — the Bitcoin seal is the clock, and draw is the living mouth')
      }
      if (isMintPaper(code) && onStar == null) {
        throw new Error('a mint needs a star — the face is the parent of every child')
      }
      const { nonce: _n, ...signed } = base
      void _n
      const pendingShelf = isMintPaper(code)
        ? requireMintShelf(b.form && b.form.shelf != null ? b.form.shelf : b.shelf, Number((code.vars && code.vars.max) || '0'))
        : undefined
      action_ = { ...signed, kind: 'contract', code, ...(onStar != null ? { star: onStar } : {}) }
      if (pendingShelf && onStar != null) b._pendingMintShelf = { star: onStar, shelf: pendingShelf }
      break
    }
    case 'contract-call': {
      if (String(b.rule) === 'mint') throw new Error('mint is a birth — inscribe with this face as parent')
      const args = readCallArgs(b)
      const callArgs = {}
      for (const [k, val] of Object.entries(args)) callArgs[k] = val.toString()
      const view = node.contract(String(b.contract))
      if (view?.star != null && (String(b.rule) === 'collect' || String(b.rule) === 'stamp' || String(b.rule) === 'draw' || String(b.rule) === 'skip' || String(b.rule).startsWith('toggle_') || String(b.rule).startsWith('once_'))) {
        const holder = node.ledger.stars.ownerOf(BigInt(view.star))
        if (String(b.from) !== holder) {
          throw new Error('only the living owner of the star may use its law — the mouth travels with the face')
        }
      }
      const clock = Number(b.clock)
      if (!Number.isInteger(clock) || clock < 0) throw new Error('a contract-call needs the signed clock from prepare')
      action_ = { ...base, kind: 'contract-call', contract: String(b.contract), rule: String(b.rule), callArgs, fee: '1', clock }
      break
    }
    case 'amm-add': {
      const runeId = canonicalRuneKey(String(b.runeId))
      assertRuneOnL2(runeId, 'create or add to a pool')
      assertAmmPotBacked(b.from, runeId, units(b.runeIn, 'runeIn'), 'enter a pool')
      action_ = { ...base, kind: 'amm-add', runeId, krayIn: String(units(b.krayIn, 'krayIn')), runeIn: String(units(b.runeIn, 'runeIn')), minLp: String(units(b.minLp || '0', 'minLp')), fee: '1' }
      break
    }
    case 'amm-remove': {
      const runeId = canonicalRuneKey(String(b.runeId))
      action_ = { ...base, kind: 'amm-remove', runeId, lp: String(units(b.lp, 'lp')), minKrayOut: String(units(b.minKrayOut || '0', 'minKrayOut')), minRuneOut: String(units(b.minRuneOut || '0', 'minRuneOut')), fee: '1' }
      break
    }
    case 'amm-swap': {
      const runeId = canonicalRuneKey(String(b.runeId))
      assertRuneOnL2(runeId, 'swap')
      if (b.side === 'rune') assertAmmPotBacked(b.from, runeId, units(b.amount, 'amount'), 'swap in')
      action_ = { ...base, kind: 'amm-swap', runeId, side: (b.side === 'rune' ? 'rune' : 'kray'), amount: String(units(b.amount, 'amount')), minOut: String(units(b.minOut || '0', 'minOut')), fee: '1' }
      break
    }
    case 'amm-rr-add': {
      const { pair, aIn, bIn } = orderRrBody(b)
      assertRuneOnL2(pair.a, 'create or add to a rune/rune pool')
      assertRuneOnL2(pair.b, 'create or add to a rune/rune pool')
      assertAmmPotBacked(b.from, pair.a, aIn, 'enter a rune/rune pool')
      assertAmmPotBacked(b.from, pair.b, bIn, 'enter a rune/rune pool')
      action_ = { ...base, kind: 'amm-rr-add', runeId: pair.a, otherRuneId: pair.b, runeIn: String(aIn), otherIn: String(bIn), minLp: String(units(b.minLp || '0', 'minLp')), fee: '1' }
      break
    }
    case 'amm-rr-remove': {
      const pair = rrPairKey(String(b.runeId), String(b.otherRuneId))
      const ca = canonicalRuneKey(String(b.runeId))
      const minA = ca === pair.a ? units(b.minRuneOut || '0', 'minRuneOut') : units(b.minOtherOut || '0', 'minOtherOut')
      const minB = ca === pair.a ? units(b.minOtherOut || '0', 'minOtherOut') : units(b.minRuneOut || '0', 'minRuneOut')
      action_ = { ...base, kind: 'amm-rr-remove', runeId: pair.a, otherRuneId: pair.b, lp: String(units(b.lp, 'lp')), minRuneOut: String(minA), minOtherOut: String(minB), fee: '1' }
      break
    }
    case 'amm-rr-swap': {
      const pair = rrPairKey(String(b.runeId), String(b.otherRuneId))
      const pay = canonicalRuneKey(String(b.payRuneId || b.pay || ''))
      if (pay !== pair.a && pay !== pair.b) throw new Error('payRuneId must be one side of the pair')
      assertAmmPotBacked(b.from, pay, units(b.amount, 'amount'), 'swap in')
      action_ = { ...base, kind: 'amm-rr-swap', runeId: pair.a, otherRuneId: pair.b, payRuneId: pay, amount: String(units(b.amount, 'amount')), minOut: String(units(b.minOut || '0', 'minOut')), fee: '1' }
      break
    }
    default: throw new Error(`unknown action "${action}"`)
  }
  return { action_, pendingWrite, b }
}
function applySubmitEvent(built) {
  // THE FIREBORN LAW: the x-send fee is PRESCRIBED by the reducer, never chosen — quote it here at the last
  // moment (state may have moved since build: an earlier act in this same gate flush can consume the tank or
  // arm the gap clock). Below the activation seq this returns the eternal 1 ₭, so the path is byte-identical.
  if (built.action_.kind === 'x-send') {
    built.action_.fee = String(node.ledger.xSendFeeFor(built.action_.from, Number(built.action_.at), node.seq + 1))
  }
  // node.submit is SYNCHRONOUS — capture the star delta around THIS act alone, so a response can
  // never report a sibling's star when the instant gate applies several acts inside one flush.
  const bornBefore = node.ledger.stars.createdSeq
  const e = node.submit(built.action_)   // throws on a bad signature / any economic precondition — BEFORE any disk write
  const bornAfter = node.ledger.stars.createdSeq
  if (built.pendingWrite) {
    try {
      writeFileSync(join(CONTENT_DIR, built.pendingWrite.hash), built.pendingWrite.buf)
      writeFileSync(join(CONTENT_DIR, built.pendingWrite.hash + '.json'), JSON.stringify(built.pendingWrite.meta))
    } catch { /* the chain already holds the hash; the bytes are a convenience the write can retry later */ }
  }
  if (built.b && built.b._pendingMintShelf) saveMintShelf(built.b._pendingMintShelf.star, built.b._pendingMintShelf.shelf)
  return { e, star: bornAfter > bornBefore ? Number(bornAfter) - 1 : undefined }
}
function submitAction(action, b, atOverride) {   // the direct path (tests, internal callers) — one act, its own instant
  return applySubmitEvent(buildSubmitEvent(action, b, atOverride)).e
}

// ═══ THE SAME-INSTANT GATE (docs/SAME-INSTANT-ORDER-DECISION.md) ═══════════════════════════════════
// Concurrent submits are collected for one tick, stamped ONE shared millisecond (`at`, strictly
// monotonic per flush so two flushes can never share an instant), keyed by sha256 of the bytes each
// author SIGNED (the ungrindable window-order key — the reducer re-derives the same key and its
// SAME-INSTANT LAW refuses any other order), and applied in the order the arithmetic derives.
// Admission before ordering: a forged signature must never occupy a rival's nonce slot (the
// window-order admission law) — it gets no key and dies at the reducer with its honest error.
const INSTANT_GATE_MS = 4
const _instantGate = { queue: [], timer: null, lastAt: 0 }
function submitThroughInstantGate(action, b) {
  return new Promise((resolve, reject) => {
    _instantGate.queue.push({ action, b, resolve, reject })
    if (!_instantGate.timer) _instantGate.timer = setTimeout(_flushInstantGate, INSTANT_GATE_MS)
  })
}
function _flushInstantGate() {
  _instantGate.timer = null
  const jobs = _instantGate.queue.splice(0)
  if (!jobs.length) return
  let at = Date.now()
  if (at <= _instantGate.lastAt) at = _instantGate.lastAt + 1
  _instantGate.lastAt = at
  for (const j of jobs) {
    try {
      j.built = buildSubmitEvent(j.action, j.b, at)
      const ev = j.built.action_
      const signed = signedBytesOfEvent(ev, NET)
      // admission: the signature must verify FOR the claimed `from` (verifySignature binds pk↔address)
      if (signed != null && ev.from && ev.signature && ev.publicKey &&
          verifySignature(ev.from, signed, ev.signature, ev.publicKey, ev.scheme, toBtcNet(NET))) {
        j.key = keyFromSignedMessage(signed)
      }
    } catch (ex) { if (!j.built) j.err = ex }
  }
  const keyed = jobs.filter((j) => j.key)
  const acts = keyed.map((j) => ({ from: String(j.built.action_.from || ''), nonce: j.built.action_.nonce, job: j }))
  const { ordered, deferred, rejected } = orderWindow(acts, {
    nonceOf: (a) => node.ledger.nonceOf(a),
    keyOf: (x) => x.job.key,
    isValid: () => true,   // admission already ran above; unkeyed jobs never entered the window
  })
  const tail = [...deferred, ...rejected].map((x) => x.job)   // nonce gaps — they fail at the reducer with the honest error
  const unkeyed = jobs.filter((j) => !j.key)                  // unbuildable / unadmitted — same: the reducer speaks
  // LIVENESS: orderWindow DEDUPS by signed-identity key (two signatures of one message are ONE act), so N
  // byte-identical resubmits (a retry, a double-click, or a DoS) collapse to a single scheduled act — the
  // other N-1 jobs appear in NEITHER ordered/deferred/rejected. They must still be answered, or their HTTP
  // connections hang forever (a connection-exhaustion vector). Route each such duplicate through the reducer
  // too: it applies the honest error (the winner already took the nonce → "nonce != expected"), never a hang.
  const scheduled = new Set([...ordered.map((x) => x.job), ...tail])
  const dupKeyed = jobs.filter((j) => j.key && !scheduled.has(j))
  for (const j of [...ordered.map((x) => x.job), ...tail, ...unkeyed, ...dupKeyed]) {
    if (j.err) { j.reject(j.err); continue }
    try { j.resolve(applySubmitEvent(j.built)) }
    catch (ex) {
      // SAFETY VALVE (fail-open to a SOLO instant, never to a broken run): if the reducer's law ever
      // disagrees with this gate's order — a mirror-parity escape the referee also guards — re-instant
      // the act alone at a fresh millisecond instead of failing the citizen.
      if (ex instanceof Error && ex.message.includes('THE SAME-INSTANT LAW')) {
        try {
          _instantGate.lastAt = Math.max(Date.now(), _instantGate.lastAt + 1)
          j.resolve(applySubmitEvent(buildSubmitEvent(j.action, j.b, _instantGate.lastAt)))
          continue
        } catch (ex2) { j.reject(ex2); continue }
      }
      j.reject(ex)
    }
  }
}

// ── BATCH (a collection) — a pure CONVENIENCE over the per-action flow, NOT a new consensus rule. Each item is
//    still its own signed event, still burns its own 1 ₭, still passes the same reducer. The batch only spares
//    the user doing prepare→sign→submit one at a time: prepare N messages at sequential nonces (n, n+1, …), the
//    wallet signs them, and submit-batch applies them in order. A collection = a batch whose items share a
//    parent (a KRAY star you own, or an L1 ordinal via `origin`). ──
const BATCH_MAX = 200
async function assertLiveOriginFromBody(b) {
  const action = String(b.action || '')
  if (action === 'origin') {
    await assertLiveOriginParentage(b.from, [String(b.parentId || '')], b.originProofs)
    return
  }
  if (action === 'inscribe') {
    const mp = multiparentLists(b)
    if (mp && mp.origins.length && b.originProofs) await assertLiveOriginParentage(b.from, mp.origins, b.originProofs)
  }
}

async function prepareBatch(b) {
  const from = b.from
  if (!from) throw new Error('from is required')
  const items = Array.isArray(b.items) ? b.items : null
  if (!items || !items.length) throw new Error('a batch needs a non-empty {items:[...]} array')
  if (items.length > BATCH_MAX) throw new Error(`a batch is at most ${BATCH_MAX} actions — split larger collections`)
  const nonceStart = node.nonceOf(from)
  const originsKeyOf = (it) => {
    const action = String(it.action || 'inscribe')
    if (action === 'origin') return String(it.parentId || '').toLowerCase()
    const mp = multiparentLists({ ...it, from })
    return mp && mp.origins.length ? mp.origins.join(',') : ''
  }
  let cohort = null
  const explicit = items.find((it) => Array.isArray(it.originCohort) && it.originCohort.length >= 2)
  const opener = items.findIndex((it) => Array.isArray(it.originProofs) && it.originProofs.length)
  if (explicit) {
    const leaves = explicit.originCohort.map((x) => String(x).toLowerCase())
    cohort = { root: originCohortRootOf(leaves), leaves, opener }
  } else if (items.length > 1 && opener >= 0) {
    const key = originsKeyOf(items[0])
    if (key && items.every((it) => originsKeyOf(it) === key)) {
      const leaves = items.map((it) => inscribeFields({ ...it, from }).contentHash)
      cohort = { root: originCohortRootOf(leaves), leaves, opener }
    }
  }
  const prepared = []
  for (let i = 0; i < items.length; i++) {
    const raw = items[i]
    const action = String(raw.action || 'inscribe')
    if (!['inscribe', 'origin', 'name'].includes(action)) throw new Error(`item ${i}: batch supports inscribe/origin/name (creations), not "${action}"`)
    const it = { ...raw }
    if (cohort) {
      it.originCohortRoot = cohort.root
      if (i === cohort.opener && cohort.opener >= 0) it.originCohort = cohort.leaves
      else { delete it.originProofs; delete it.originCohort }
    }
    await assertLiveOriginFromBody({ ...it, from, action })
    const prep = prepareMessage(action, { ...it, from }, nonceStart + i)
    prepared.push({
      i, action, nonce: nonceStart + i, message: prep.message, star: prep.star,
      contentHash: prep.contentHash, size: prep.size,
      originCohortRoot: it.originCohortRoot || undefined,
      originCohort: it.originCohort || undefined,
      stripProofs: !!(cohort && i !== cohort.opener),
    })
  }
  return { ok: true, from, nonceStart, count: prepared.length, feeTotalKray: prepared.length, items: prepared }
}
async function submitBatch(b) {
  const from = b.from
  const items = Array.isArray(b.items) ? b.items : null
  if (!from || !items || !items.length) throw new Error('submit-batch needs {from, items:[{action, ...signed fields}]}')
  if (items.length > BATCH_MAX) throw new Error(`a batch is at most ${BATCH_MAX} actions`)
  const results = []
  let applied = 0, stopped = false
  for (let i = 0; i < items.length; i++) {
    if (stopped) { results.push({ i, ok: false, skipped: true, error: 'skipped — a prior item failed, so this item\'s nonce is now out of sequence; re-batch from here' }); continue }
    const it = items[i]
    const action = String(it.action || 'inscribe')
    try {
      await assertLiveOriginFromBody({ ...it, from, action })
      const r = await submitThroughInstantGate(action, { ...it, from })
      const e = r.e
      // a creating act (inscribe/origin/name) advances createdSeq — the star delta is measured INSIDE the
      // synchronous apply, so the client learns each item's real star id even across gate flushes.
      const star = (['inscribe', 'origin', 'name'].includes(action) && r.star !== undefined) ? String(r.star) : undefined
      results.push({ i, ok: true, seq: e.seq, star, action })
      applied++
    } catch (err) {
      // a sequential-nonce batch cannot skip a gap: once one item fails, every later item's nonce is wrong.
      // Stop cleanly and report, so the client re-batches the remainder — nothing half-applied, nothing lost.
      results.push({ i, ok: false, error: err instanceof Error ? err.message : String(err) })
      stopped = true
    }
  }
  return { ok: applied > 0, applied, failed: results.length - applied, feePaidKray: applied, cascadeRoot: node.cascadeRoot(), results }
}

// ── router ───────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '')
  // DEFENSIVE URL PARSE — a malformed request line (e.g. `//` or a bad %-escape) must NEVER crash the node.
  // A node that a single junk request can kill is not a node; refuse it and keep beating.
  let url
  try { url = new URL(req.url, `http://localhost:${PORT}`) }
  catch { return send(res, 400, 'bad request URL') }
  const rawPath = url.pathname
  let p = rawPath
  if (req.method === 'POST' && publicPostFlood(req)) return err(res, 429, 'too many writes — wait a minute')
  const vanity = labVanity(p)
  if (vanity && vanity.miss) return err(res, 404, 'this node has no lab sibling URL for that network')
  if (vanity && vanity.location) {
    res.writeHead(302, { Location: vanity.location + url.search, 'Cache-Control': 'no-store' })
    return res.end()
  }
  // DEFENSE IN DEPTH — the front node flood-gates BEFORE publishing its sibling, so a proxied
  // path can never be an unthrottled tunnel to the regtest node's L1 scanners.
  const proxyFlooded = (rq) => rq.method === 'GET' ? publicWalletGetFlood(rq) : publicPostFlood(rq)
  if (vanity && vanity.proxyPort) {
    if (proxyFlooded(req)) return err(res, 429, 'slow down')
    return proxyToLocal(req, res, vanity.proxyPort, vanity.rewrite + url.search)
  }
  if (vanity && vanity.rewrite) p = vanity.rewrite
  // A page sitting at /regtest on this Funnel host fetches /api on the same origin — send it to regtest.
  if (NET === 'signet' && labReferer(req) === 'regtest' && !rawPath.startsWith('/signet')) {
    if (proxyFlooded(req)) return err(res, 429, 'slow down')
    return proxyToLocal(req, res, 4477, p + url.search)
  }
  try {
    // web explorer
    if (req.method === 'GET') {
      // THE RICH EXPLORER — served from apps/kray-net/
      if (p === '/' || p === '/v2' || p === '/v2.html' || p === '/index.html') {
        return serveFile(res, join(APP_DIR, 'index.html'), 'text/html; charset=utf-8')
      }
      if (p === '/kray.js' || p === '/kray-v2.js') {
        return serveFile(res, join(__dir, 'kray.js'), 'application/javascript; charset=utf-8', { 'Cache-Control': 'no-store' })
      }
      if (p === '/model-viewer.min.js') {
        // the 3D viewer (self-hosted, versioned/immutable) — /render mounts it for model/* stars
        return serveFile(res, join(__dir, 'model-viewer.min.js'), 'text/javascript; charset=utf-8', { 'Cache-Control': 'public, max-age=31536000, immutable' })
      }
      if (/^\/vendor\/(?:draco|basis)\/[a-z0-9._-]+\.(?:js|wasm)$/i.test(p)) {
        // self-hosted 3D decoders — Draco (compressed geometry) + basis/KTX2 (compressed textures). model-viewer
        // loads these for compressed GLBs from OUR origin, never gstatic; the node stays self-contained. The
        // regex allows only draco|basis + safe names, so no path can escape. Versioned bytes → immutable cache.
        const ct = /\.wasm$/i.test(p) ? 'application/wasm' : 'text/javascript; charset=utf-8'
        return serveFile(res, join(__dir, p.replace(/^\//, '')), ct, { 'Cache-Control': 'public, max-age=31536000, immutable' })
      }
      if (p === '/custody-browser.js') {
        return serveFile(res, join(__dir, 'custody-browser.js'), 'application/javascript; charset=utf-8', { 'Cache-Control': 'no-store' })
      }
      if (p === '/contract-exam.js') {
        return serveFile(res, join(__dir, 'contract-exam.js'), 'application/javascript; charset=utf-8')
      }
      if (p === '/kray.css' || p === '/kray-v2.css') {
        return serveFile(res, join(__dir, 'kray.css'), 'text/css; charset=utf-8', { 'Cache-Control': 'no-store' })
      }
      if (p === '/network' || p === '/nodes') return serveFile(res, join(APP_DIR, 'network.html'), 'text/html; charset=utf-8')
      if (p === '/burn' || p === '/burn-proof') return serveFile(res, join(APP_DIR, 'burn.html'), 'text/html; charset=utf-8')
      if (p === '/verify') return serveFile(res, join(APP_DIR, 'verify.html'), 'text/html; charset=utf-8')
      if (p === '/validate' || p === '/mine-live') return serveFile(res, join(APP_DIR, 'validate.html'), 'text/html; charset=utf-8')
      // THE EXPLORER'S PRETTY DOORS — the node SHIPS the whole rich explorer in its own tree
      // (blocks/chain constellation, block, star, tx, profile, rune, land…), but only a handful of
      // pages were ever routed: /blocks (the /chain constellation) answered "no route" on every node
      // while kray-web carried the map alone. The node is the source of these routes (kray-web
      // mirrors THEM); exact table + parametric pages that read their id client-side from location.
      {
        const PRETTY = {
          '/blocks': 'blocks.html', '/chain': 'blocks.html',
          '/land3d': 'landcity.html', '/city': 'landcity.html', '/land': 'map.html',
          '/rank': 'rank.html', '/dashboard': 'dashboard.html', '/library': 'library.html',
          '/mind': 'mind.html',
          '/docs': 'docs.html', '/inscribe': 'inscribe.html', '/send': 'send.html', '/baptize': 'baptize.html',
          '/mine': 'mine.html', '/rune': 'rune.html', '/defi': 'defi.html', '/pool': 'pool.html',
          '/market': 'market.html', '/marketplace': 'market.html',
          '/collections': 'market.html',
        }
        const PARAM = [
          // /star/<n> · /star/<name> · /star/<inscription id> — star.html resolves all three
          // client-side (a baptized name 302s to its number). The canon relic promises
          // /star/<name>, so the door must route it, not 404 it.
          [/^\/star\/[a-zA-Z0-9]+\/?$/, 'star.html'], [/^\/block\/\w+\/?$/, 'block.html'], [/^\/tx\/[0-9a-f]+/i, 'tx.html'],
          // /collection/ord/<l1 id> — Bitcoin father, not a star on this book.
          // /collection/<name|number> — a named KRAY parent star.
          [/^\/collection\/ord\/[0-9a-f]{64}i\d+\/?$/i, 'collection.html'],
          [/^\/collection\/[a-zA-Z0-9]+\/?$/, 'collection.html'],
          // /profile RE-RATIFIED (Creator, 2026-08-24): the node ships profile.html (the signet base,
          // asset paths adapted) and serves it — a lab node has no kray-web beside it, and a 404 on
          // /u/<addr> read as "bugged". Supersedes the 5573037 migration note; server.itest asserts this.
          [/^\/profile\/\w+/, 'profile.html'], [/^\/(?:u|address)\/\w+/, 'profile.html'],
          [/^\/(?:land|parcel)\/\w+/, 'map.html'], [/^\/pool\/[^/]+/, 'pool.html'],
        ]
        const page = PRETTY[p] || (PARAM.find(([rx]) => rx.test(p)) || [])[1]
        if (page) return serveFile(res, join(APP_DIR, page), 'text/html; charset=utf-8')
      }
      if (p === '/api/node-version') return ok(res, nodeVersionView(REPO_ROOT))
      if (p === '/downloads/kray-node.zip') {
        const pack = packNodeTree(REPO_ROOT)
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="kray-node.zip"',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff',
        })
        return res.end(pack.zip)
      }
      { const cm = p.match(/^\/proof\/(\d+)\/card\.svg$/); if (cm) {
        const bn = Number(cm[1]); const sa = [...selfAnchors.values()].find((s) => Number(s.blockNumber) === bn); const op = anchors.get(bn) || anchors.get(String(bn))
        const root = sa ? sa.root : (op && op.root) || null; const sealed = !!(sa || (op && op.real && op.txid && !op.simulated))
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=120', 'Access-Control-Allow-Origin': '*' }); return res.end(proofCardSvg(bn, root, NET, sealed))
      } }
      if (p === '/proof' || /^\/proof\/\d+\/?$/.test(p)) {
        // serve proof.html with PER-BLOCK OpenGraph meta injected (title/desc/card image), so a shared link
        // renders a rich gold-seal preview — pure presentation; the actual proof still runs in the browser.
        const m = p.match(/^\/proof\/(\d+)/); const bn = m ? Number(m[1]) : null
        const sa = bn == null ? null : [...selfAnchors.values()].find((s) => Number(s.blockNumber) === bn)
        const op = bn == null ? null : (anchors.get(bn) || anchors.get(String(bn)))
        const root = sa ? sa.root : (op && op.root) || null; const sealed = !!(sa || (op && op.real && op.txid && !op.simulated))
        const absBase = (req.headers['x-forwarded-proto'] || 'https') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'kray.network')
        const html = stampExplorerHtml(readFileSync(join(APP_DIR, 'proof.html'), 'utf8').replace('<!--OG-META-->', proofOgMeta(bn, root, sealed, absBase)))
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' }); return res.end(html)
      }
      // the static assets those pages need — any root-level .css/.js the front-end ships
      { const am = p.match(/^\/([\w.-]+\.(?:css|js|mjs))$/); if (am && existsSync(join(__dir, am[1]))) return serveFile(res, join(__dir, am[1]), am[1].endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8') }
      if (p === '/vendor/three.min.js') return serveFile(res, join(__dir, 'vendor', 'three.min.js'), 'application/javascript; charset=utf-8')
      if (p === '/kray-mark.svg' && existsSync(join(__dir, 'kray-mark.svg'))) return serveFile(res, join(__dir, 'kray-mark.svg'), 'image/svg+xml')
      if (p === '/nyx-mark.svg' && existsSync(join(__dir, 'nyx-mark.svg'))) return serveFile(res, join(__dir, 'nyx-mark.svg'), 'image/svg+xml')
      if ((p === '/favicon.ico' || p === '/favicon.png') && existsSync(join(__dir, 'favicon.png'))) return serveFile(res, join(__dir, 'favicon.png'), 'image/png')
      if (p === '/apple-touch-icon.png' && existsSync(join(__dir, 'apple-touch-icon.png'))) return serveFile(res, join(__dir, 'apple-touch-icon.png'), 'image/png')
      if (p === '/favicon.svg' && existsSync(join(__dir, 'kray-mark.svg'))) return serveFile(res, join(__dir, 'kray-mark.svg'), 'image/svg+xml')
      if (p.startsWith('/sound/') || p.startsWith('/logos/')) return serveAsset(res, p)
      // user-inscribed bytes served under a STRICT sandbox: `Content-Security-Policy: sandbox` forces a unique
      // opaque origin, so an HTML/SVG inscription can never touch this node's real origin (read no cookie/storage,
      // rewrite no donor-facing page). It renders in isolation; it cannot become stored XSS against the explorer.
      { const cm = p.match(/^\/content\/([0-9a-f]{64})$/); if (cm) { const held = heldContentPath(cm[1]); if (held.held && !held.ok) return err(res, 503, CONTENT_CORRUPT); const mp = join(CONTENT_DIR, cm[1] + '.json'); const ct = existsSync(mp) ? (JSON.parse(readFileSync(mp, 'utf8')).contentType || 'application/octet-stream') : 'application/octet-stream'; return serveFile(res, held.path, ct, { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self' data:; style-src 'unsafe-inline'", 'Content-Disposition': 'inline' }) } }
      { const km = p.match(/^\/cover\/([0-9a-f]{64})$/); if (km) return serveCover(res, km[1]) }
      // THE RENDER DOOR — the same sealed bytes, served EXECUTABLE inside a cage (the Ordinals
      // pattern, tightened): only for text/html stars, only when the viewer PRESSES the render
      // button (the star page iframes this with sandbox="allow-scripts" — opaque origin, no
      // cookies, no parent access). The CSP is the cage's bars: inline scripts may run and the
      // star may talk to THIS node only (recursion via /r/ and /content — connect-src 'self'),
      // so a hostile star can neither phone home, exfiltrate, nor touch the viewer's world.
      // Everything else keeps the locked /content/ door unchanged.
      { const cm = p.match(/^\/render\/([0-9a-f]{64})$/); if (cm) {
          { const held = heldContentPath(cm[1]); if (held.held && !held.ok) return err(res, 503, CONTENT_CORRUPT) }
          const mp = join(CONTENT_DIR, cm[1] + '.json')
          const ct = existsSync(mp) ? (JSON.parse(readFileSync(mp, 'utf8')).contentType || 'application/octet-stream') : 'application/octet-stream'
          if (/markdown/i.test(ct) || /^text\/(x-)?md\b/i.test(ct)) {
            // markdown's render door — the READING ROOM. /content stays the raw proof door
            // (byte-exact, what hashes and recursive embeds consume); this shell is OUR static
            // page: it fetches those sealed bytes, sanitizes them to inert markup (kray.js)
            // and mounts them. The star's bytes never execute — the only script allowed by the
            // CSP is this node's own file (script-src 'self': no inline, no eval), so even a
            // sanitizer bug cannot smuggle a running script. cm[1] is regex-proven 64-hex.
            const shell = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>markdown star · KRAY.NETWORK</title></head>'
              + stampExplorerHtml(`<body data-mdview="${cm[1]}"><script src="/kray.js"></script></body></html>`)
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' data: blob:; style-src 'unsafe-inline'; font-src 'self' data:" })
            return res.end(shell)
          }
          if (/^audio\//i.test(ct)) {
            // music's render door — a zero-script stage. Browsers never paint ID3 APIC
            // inside <audio>, so this shell (OUR HTML, not the relic) shows the cover
            // from /cover and plays the same sealed /content bytes. Proof door unchanged.
            const hash = cm[1]
            const art = peekApic(hash)
            const shell = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
              + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
              + '<title>music star · KRAY.NETWORK</title>'
              + '<style>html,body{margin:0;min-height:100dvh;background:#08090a;color:#f4f5fa;font:16px/1.5 -apple-system,system-ui,sans-serif}'
              + 'main{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px}'
              + 'img{width:min(100%,480px);aspect-ratio:1/1;object-fit:cover;border-radius:10px}'
              + 'audio{width:min(100%,480px)}</style></head><body><main>'
              + (art ? `<img src="/cover/${hash}" alt="">` : '')
              + `<audio src="/content/${hash}" controls preload="metadata"></audio>`
              + '</main></body></html>'
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
            })
            return res.end(shell)
          }
          if (/^model\//i.test(ct)) {
            // 3D's render door — model-viewer (self-hosted) paints the sealed bytes: orbit + auto-rotate,
            // the Ordinals experience. The CSP is the cage: the self-hosted module + its wasm (three.js) and
            // workers may run, it may read THIS node's own bytes (/content, connect-src 'self'), and nothing
            // else — no phone-home, no external fetch. A Draco-compressed model needs the gstatic decoder
            // (blocked by design); an uncompressed GLB/GLTF renders directly.
            const shell = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>3D star · KRAY.NETWORK</title>'
              + '<style>html,body{margin:0;height:100%;background:#08090a}model-viewer{width:100vw;height:100dvh;--poster-color:transparent}</style>'
              + '<script type="module" src="/model-viewer.min.js?v=2"></script></head>'
              + `<body><model-viewer src="/content/${cm[1]}" alt="3D star" camera-controls auto-rotate touch-action="pan-y" shadow-intensity="1" exposure="1"></model-viewer></body></html>`
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:" })
            return res.end(shell)
          }
          if (/^application\/pdf\b/i.test(ct)) {
            // pdf's render door — the browser's own viewer. The locked /content door cannot show a
            // PDF (its `sandbox` CSP rightly disables plugin content), so the render door serves the
            // SAME sealed bytes viewable: correct content-type + nosniff means these bytes can never
            // be interpreted as HTML on this origin — a PDF cannot script the explorer. Proof door unchanged.
            return serveFile(res, join(CONTENT_DIR, cm[1]), ct, { 'Content-Disposition': 'inline' })
          }
          if (!/^text\/html/.test(ct)) { res.writeHead(302, { Location: '/content/' + cm[1] }); return res.end() }
          return serveFile(res, join(CONTENT_DIR, cm[1]), ct, {
            'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'",
            'Content-Disposition': 'inline',
          })
      } }
      // ── the RICH pages (from apps/kray-net/) — one front-end, on the v2 engine ──
      if (p === '/docs/pack.json') {
        const pack = docsPack()
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
          'Access-Control-Allow-Origin': '*',
        })
        return res.end(JSON.stringify(pack))
      }
      if (p === '/skill/kraynet-dev') {
        return serveFile(res, join(__dir, '../../docs/CONTRACTS.md'), 'text/plain; charset=utf-8')
      }
      {
        const dm = /^\/docs\/([a-z0-9][a-z0-9._-]{0,80})\.md$/i.exec(p)
        if (dm) {
          const f = docsFile(dm[1])
          if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('not found') }
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60' })
          return res.end(f.text)
        }
      }
      if (p === '/anchor') return serveFile(res, join(APP_DIR, 'anchor.html'), 'text/html; charset=utf-8')
      // The black-hole register — where frozen stars glow forever and burned ₭ died in the fire. The
      // KRAY_BLACK_HOLE redirect below lands here; without this route it fell through to a page with neither sink.
      if (p === '/blackhole') return serveFile(res, join(APP_DIR, 'blackhole.html'), 'text/html; charset=utf-8')
      // THE TWO LIGHTS live on /rank as books (tabs + hash). Old doors 302 so a bookmark never 404s
      // and we never ship a second ranking surface (one derived order, one URL).
      if (p === '/x') { res.writeHead(302, { Location: '/rank#nyx', 'Cache-Control': 'no-store' }); return res.end() }
      if (p === '/glow') { res.writeHead(302, { Location: '/rank#glow', 'Cache-Control': 'no-store' }); return res.end() }
      if (p === '/lights' || p === '/two-lights') { res.writeHead(302, { Location: '/rank', 'Cache-Control': 'no-store' }); return res.end() }
      // v2 is the ONLY version — the old /v1 monolith (explorer.html) is retired, no duplication
      // /contracts has no rich HTML page (the DeFi data rides /api/kraynet/contracts) — no broken route left
      // KRAY_BLACK_HOLE is a protocol label, not a citizen — its home is the black-hole register, never a profile page
      if (/^\/(?:profile|u|address)\/KRAY_BLACK_HOLE\/?$/.test(p)) { res.writeHead(302, { Location: '/blackhole', 'Cache-Control': 'no-store' }); return res.end() }
      // KRAY_AMM_* is the no-key pot, not a wallet — open the book, never the citizen page
      {
        const potm = p.match(/^\/(?:profile|u|address)\/(KRAY_AMM_[A-Z0-9_]+)\/?$/)
        if (potm) {
          const parsed = parseAmmPotAddress(potm[1])
          const dest = parsed
            ? (parsed.kind === 'rr' ? '/pool/' + encodeURIComponent(parsed.a) + '/' + encodeURIComponent(parsed.b) : '/pool/' + encodeURIComponent(parsed.runeId))
            : '/pool/' + encodeURIComponent(potm[1])
          res.writeHead(302, { Location: dest, 'Cache-Control': 'no-store' })
          return res.end()
        }
      }
      // /inscription/<id> is not a page — it is the star, reached by the tattoo's id.
      {
        const inscPath = /^\/inscription\/([^/]+)\/?$/.exec(p)
        if (inscPath) {
          const raw = decodeURIComponent(inscPath[1])
          const id = /^[0-9a-fA-F]{64}i\d+$/.test(raw) ? raw.toLowerCase() : raw
          res.writeHead(301, { Location: '/star/' + encodeURIComponent(id), 'Cache-Control': 'no-store' })
          return res.end()
        }
      }
    }
    // reads
    if (req.method === 'GET') {
      // ── the recursion layer (ord-style) — an inscription reads its own lineage + the live chain ──
      let gm
      // THE ORIGIN PICKER — the L1 ordinals an address actually HOLDS, composed from what this
      // node already trusts: its own bitcoind (address UTXOs) and its own ord (/output). The
      // inscribe page always spoke this route; the server finally answers it.
      if ((gm = /^\/api\/kraynet\/wallet-ordinals$/.exec(p))) {
        const addr = String(url.searchParams.get('address') || '')
        if (!isAddressOnNetwork(addr, toBtcNet(NET))) return err(res, 400, `address is not a ${NET} address`)
        if (!btcConfigured()) return ok(res, { online: false, ordinals: [] })
        try {
          const utxos = await enrichedUtxos(addr)
          const ids = [...new Set(utxos.flatMap((u) => u.inscriptions || []))]
          const ordinals = (await Promise.all(ids.slice(0, 60).map(async (id) => {
            const meta = await ordGet(`/inscription/${id}`)
            return { id, contentType: meta?.content_type ?? null, number: meta?.number ?? null, url: '/l1content/' + id }
          })))
          return ok(res, { online: true, address: addr, ordinals })
        } catch (e) { return ok(res, { online: false, ordinals: [], note: String(e.message || e) }) }
      }
      // THE BLESSING FINDER — where an L1 ordinal lives RIGHT NOW (its satpoint) and how deep
      // that send is buried, so /inscribe fills the blessing field itself instead of making the
      // user hunt a txid:vout:offset. Read-only; the real proof is still assembled + SPV-verified
      // at inscribe time — this route is a lantern, never the gate.
      if ((gm = /^\/api\/kraynet\/l1-satpoint\/([0-9a-f]{64}i\d+)$/i.exec(p))) {
        const id = gm[1].toLowerCase()
        const meta = await ordGet(`/inscription/${id}`)
        if (!meta || !meta.satpoint) return ok(res, { online: !!meta, id, net: NET, satpoint: null, confirmations: 0, minConf: DONATION_MIN_CONF, blessed: false, address: null })
        const [spTxid, spVout] = String(meta.satpoint).split(':')
        let confirmations = 0
        if (btcConfigured()) {
          // gettxout answers only while the outpoint is UNSPENT — exactly the blessing's own rule
          const txo = await btcRpc('gettxout', [spTxid, Number(spVout) || 0, true]).catch(() => null)
          confirmations = txo ? Number(txo.confirmations) || 0 : 0
        }
        return ok(res, { online: true, id, net: NET, satpoint: String(meta.satpoint), address: meta.address ?? null, confirmations, minConf: DONATION_MIN_CONF, blessed: confirmations >= DONATION_MIN_CONF })
      }
      // ord content, proxied through the node — the page gets thumbnails from ONE origin,
      // network-correct on every chain (each node proxies its own ord).
      if ((gm = /^\/l1content\/([0-9a-f]{64}i\d+)$/.exec(p))) {
        const got = await l1InscriptionBytes(gm[1])
        if (!got) return err(res, 404, "content not found on this node's ord")
        res.writeHead(200, { 'Content-Type': got.contentType, 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' })
        return res.end(got.body)
      }
      if (p.startsWith('/r/')) {
        const starOf = (raw) => { try { const nn = BigInt(raw); return nn >= 0n && nn < node.ledger.stars.createdSeq ? nn : null } catch { return null } }
        let rm
        if ((rm = /^\/r\/children\/(\d+)$/.exec(p))) { const s = starOf(rm[1]); if (s == null) return err(res, 400, 'bad star'); return ok(res, { star: rm[1], children: node.ledger.stars.childrenOf(s).map(String) }) }
        if ((rm = /^\/r\/parent\/(\d+)$/.exec(p))) { const s = starOf(rm[1]); if (s == null) return err(res, 400, 'bad star'); const par = node.ledger.stars.parentOf(s); return ok(res, { star: rm[1], parent: par != null ? String(par) : null }) }
        // MULTIPARENT recursion (additive) — the FULL signed lineage; /r/parent keeps its singular meaning forever
        if ((rm = /^\/r\/parents\/(\d+)$/.exec(p))) { const s = starOf(rm[1]); if (s == null) return err(res, 400, 'bad star'); return ok(res, { star: rm[1], parents: node.ledger.stars.parentsOf(s).map(String) }) }
        if ((rm = /^\/r\/origins\/(\d+)$/.exec(p))) { const s = starOf(rm[1]); if (s == null) return err(res, 400, 'bad star'); return ok(res, { star: rm[1], origins: node.ledger.stars.originsOf(s) }) }
        if ((rm = /^\/r\/l1-children\/([0-9a-f]{64}i\d+)$/.exec(p))) {
          return ok(res, { origin: rm[1], children: node.ledger.stars.childrenOfOrigin(rm[1]).map(String) })
        }
        if ((rm = /^\/r\/star\/(\d+)$/.exec(p))) { const s = starOf(rm[1]); if (s == null) return err(res, 400, 'bad star'); const v = node.star(s); return ok(res, { star: rm[1], owner: v.owner, by: v.by, name: v.name, rarity: v.rarity, contentHash: v.contentHash, contentType: v.contentType, url: v.contentHash ? '/content/' + v.contentHash : null, parent: v.parent != null ? String(v.parent) : null, children: node.ledger.stars.childrenOf(s).map(String) }) }
        if ((rm = /^\/r\/inscription\/(.+)$/.exec(p))) { const ins = node.ledger.stars.inscription(decodeURIComponent(rm[1])); return ins ? ok(res, ins) : err(res, 404, 'no such inscription') }
        if (p === '/r/blockheight') return ok(res, { height: tipNumber() })
        if (p === '/r/cascaderoot') return ok(res, { cascadeRoot: node.cascadeRoot() })
        if (p === '/r/blockhash') { const t = blocks[tipNumber()]; return ok(res, { blockhash: t ? t.hash : ZERO64, height: tipNumber() }) }
        if (p === '/r/bitcoin') { const reals = [...anchors.values()].filter((a) => a.real && a.txid); const anc = reals.filter((a) => a.verified).pop() || reals.pop() || null; return ok(res, { anchored: !!(anc && !anc.simulated), verified: !!(anc && anc.verified), txid: anc ? anc.txid : null, cascadeRoot: anc ? anc.root : node.cascadeRoot() }) }
        return err(res, 404, 'unknown recursion endpoint')
      }
      // ── THE WALLET's L1 BACKEND (this node's bitcoind + ord) ──
      // Public node: GET balance/utxos/fees/runes only (rate-limited), on EVERY network — a tester's wallet
      // must see its own signet/testnet balance to donate. Writes stay 404 (they broadcast from their own
      // wallet). Local DevNet keeps the full proxy. NOTE: the ee6b1d7 hardening over-restricted GET to regtest
      // only, which blanked the balance on the public signet node — a read-only, cached, rate-limited GET is safe.
      { let wm
        if (PUBLIC && /^\/api\/wallet\//.test(p) && req.method !== 'GET') {
          return err(res, 404, 'wallet L1 proxy is off on this public node — broadcast from your own wallet')
        }
        if (PUBLIC && /^\/api\/wallet\//.test(p) && publicWalletGetFlood(req)) {
          return err(res, 429, 'slow down')
        }
        if ((wm = p.match(/^\/api\/wallet\/([a-z0-9]+)\/balance$/i))) {
          if (!btcConfigured()) return err(res, 501, 'no bitcoind RPC configured')
          const utxos = await scanUtxos(normalizeAddr(wm[1], NET)).catch(() => null)
          if (!utxos) return ok(res, { success: false, balance: null })
          const total = utxos.reduce((t, u) => t + u.value, 0)
          return ok(res, { success: true, balance: { confirmed: total, unconfirmed: 0, total } })
        }
        if ((wm = p.match(/^\/api\/wallet\/utxos\/([a-z0-9]+)$/i))) {
          if (!btcConfigured()) return err(res, 501, 'no bitcoind RPC configured')
          const utxos = await enrichedUtxos(normalizeAddr(wm[1], NET)).catch((e) => ({ __err: e.message }))
          if (utxos.__err) return err(res, 400, 'could not scan UTXOs — ' + utxos.__err)
          return ok(res, { success: true, utxos })
        }
        if ((wm = p.match(/^\/api\/wallet\/([a-z0-9]+)\/runes$/i))) {
          if (!btcConfigured()) return err(res, 501, 'no bitcoind RPC configured')
          const runes = await runesOfAddress(normalizeAddr(wm[1], NET)).catch(() => [])
          return ok(res, { success: true, runes })
        }
        if (p === '/api/wallet/fees') {
          // the LIVE fee market for this network (regtest = a flat honest schedule; signet/main = mempool.space),
          // so the wallet can offer real slow/medium/high/custom instead of a flat guess that strands a tx.
          const f = await nodeFees()
          return ok(res, {
            success: true,
            network: NET === 'main' ? 'mainnet' : NET,
            source: f.source === 'regtest-flat' ? 'kraynet-regtest' : f.source,
            fees: { minimum: f.minimum, low: f.economy, medium: f.halfHour, high: f.fastest },
            labels: { low: 'Economy', medium: 'Normal', high: 'Priority' }, recommended_for_swap: f.halfHour,
          })
        }
        if (p === '/api/kraynet/btc-price' || p === '/api/btc-price') {
          // a last-resort BTC/USD the wallet can always reach on localhost when its own network blocks
          // every public price API (a ship's filtered wifi). The node fetches it server-side + caches it.
          const usd = await nodeBtcUsd().catch(() => 0)
          return ok(res, { usd, source: usd > 0 ? 'kraynet' : 'unavailable' })
        }
      }
      // ── the proof surface — is this node still telling Bitcoin's story? ──
      if (p === '/api/kraynet/audit') {
        const L = node.ledger, intact = L.conserves() && L.backed() && L.runesSolvent() && L.ammSolvent()
        return send(res, intact ? 200 : 500, {
          intact, checked: anchors.size, conserves: L.conserves(), backed: L.backed(), runesSolvent: L.runesSolvent(),
          ammSolvent: L.ammSolvent(),
          anchors: anchors.size, cascadeRoot: node.cascadeRoot(),
          note: intact
            ? 'Σ balances == emitted − burned, every ₭ backed by a real satoshi, every rune solvent, every AMM pair supply === holders + dead shares, and each cascade root committed to Bitcoin still matches the journal it serves — no event was edited, inserted, removed or reordered.'
            : 'HALT — this node contradicts a law it proved to Bitcoin.',
        })
      }
      // ── a self-contained, offline-verifiable receipt for one event ──
      { let rc; if ((rc = p.match(/^\/api\/kraynet\/receipt\/(\d+)$/))) {
        const seq = parseInt(rc[1], 10), e = events[seq - 1]
        if (!e) return err(res, 404, 'no such event')
        const blk = blockOfSeq(seq)
        return ok(res, {
          seq, event: e,
          block: blk ? { number: blk.number, merkleRoot: blk.merkleRoot, hash: blk.hash, fromSeq: blk.fromSeq, toSeq: blk.toSeq } : null,
          paidBinding: paidBindingOf(seq),
        })
      } }
      // THE REAL BITCOIN OF THIS NODE'S OWN NETWORK — read live from our own bitcoind + ord, so the mirror
      // panel always shows the chain you are actually CONNECTED to (signet here, mainnet on a mainnet node),
      // never a hardcoded "mainnet". Degrades honestly: a field the node cannot read is null, never invented.
      if (p === '/api/kraynet/bitcoin') {
        let height = null, hash = null
        try { const h = await btcRpc('getblockcount'); if (Number.isInteger(h)) { height = h; hash = await btcRpc('getbestblockhash') } } catch { /* bitcoind unreachable → offline */ }
        const st = await ordGet('/status')                 // ord Status API — this network's inscription + rune totals
        return ok(res, {
          network: NET, source: 'own node', online: height != null || !!st,
          height: height ?? (st && Number.isInteger(st.height) ? st.height : null), hash,
          inscriptions: st && Number.isInteger(st.inscriptions) ? st.inscriptions : null,
          runes: st && Number.isInteger(st.runes) ? st.runes : null, ord: !!st,
        })
      }
      // PHASE 2 · beat challenge — what a guardian mines against right now (the Bitcoin-revealed beacon + tip)
      if (p === '/api/kraynet/beat/challenge') {
        const beacon = await currentBeacon()
        if (!beacon) return err(res, 503, 'no Bitcoin beacon yet — the node cannot reach bitcoind')
        return ok(res, { beacon, block: Math.max(0, tipNumber()), minZeros: BEAT_MIN_ZEROS, at: Date.now() })
      }
      // PHASE 2 · the atlas a guardian is asked to KEEP — every inscribed content, canonical order (the bonus is
      //           for holding the network's data, not just spending CPU). A guardian proves possession via custody.
      if (p === '/api/kraynet/atlas') {
        const contents = node.ledger.stars.inscriptions().filter((x) => !x.cursed).map((x) => x.contentHash)
        return ok(res, { size: contents.length, contents, k: CUSTODY_CHALLENGES })
      }
      // EVERY DISTRIBUTION, LISTED — each settlement the fee pool ever paid, newest first, with its
      // re-derived totals (the same single-law fold the tx page uses). Each row links to /tx/<hash>
      // where the full who-earned-what table lives.
      if (p === '/api/kraynet/settlements') {
        const list = settlementTables().map((t) => ({ hash: t.hash, seq: t.seq, at: t.at, paid: t.paid.toString(), beacon: t.beacon, validators: t.payouts.length })).reverse()
        return ok(res, { count: list.length, settlements: list.slice(0, 100) })
      }
      // PHASE 2 · presence — who has proven work against the current beacon, and how much (the settle preview)
      if (p === '/api/kraynet/presence') {
        const beacon = _beacon
        const book = beacon ? beatBook.get(beacon) : null
        const validators = []
        if (book) for (const [address, blocks] of book) {
          let work = 0n; const bl = []
          for (const [block, x] of blocks) { work += BigInt(x.work); bl.push(block) }
          validators.push({ address, work: work.toString(), blocks: bl.sort((a, b) => a - b) })
        }
        validators.sort((a, b) => (BigInt(b.work) > BigInt(a.work) ? 1 : BigInt(b.work) < BigInt(a.work) ? -1 : 0))
        return ok(res, { beacon: beacon || null, validators, pool: node.feePool().toString() })
      }
      // ── the block river + one block + one transaction (EXACT v1 JSON shapes) ──
      if (p === '/api/state') { await fillMissingAnchorHeights(); return ok(res, stateView()) }
      if (p === '/api/kraynet/status') { await fillMissingAnchorHeights(); return ok(res, statusPayload()) }
      if (p === '/api/kraynet/stream') return sseHandler(req, res)
      if (p === '/api/kraynet/world') {
        const R = landRollV2()
        const trim = (pp) => ({ star: pp.star, size: pp.size, category: pp.category, contentType: pp.contentType, url: pp.url, name: pp.name, kind: pp.kind, lot: pp.lot, blockNumber: pp.blockNumber })
        const bySize = (a2, b2) => (b2.size || 0) - (a2.size || 0)
        const pcap = 40
        const lands = R.lands.slice(-24).map((e) => {
          const L = buildLandV2(e.height); if (!L) return null
          const a = L.anchor || {}
          return { land: L.land, height: L.height, minted: true, btcHeight: a.btcHeight ?? null, btcChain: a.btcChain ?? null, txid: a.txid ?? null, confirmations: a.confirmations ?? null, verified: !!a.verified, at: a.at ?? null, bytes: L.totals.bytes, leaves: L.range.leaves, blocks: L.range.blocks, parcelCount: L.parcels.length, parcels: L.parcels.slice().sort(bySize).slice(0, pcap).map(trim) }
        }).filter(Boolean)
        const liveL = buildLandV2(null)
        const live = liveL && liveL.parcels.length ? { land: null, minted: false, live: true, fromBlock: liveL.range.fromBlock, toBlock: liveL.range.toBlock, blocks: liveL.range.blocks, leaves: liveL.range.leaves, bytes: liveL.totals.bytes, parcelCount: liveL.parcels.length, parcels: liveL.parcels.slice().sort(bySize).slice(0, pcap).map(trim) } : null
        // ONE NEURON PER BITCOIN — every verified/simulated seal, including barren ones that mint no land
        // number. /chain used to draw only lands (stars-under-the-seal); the 61 barren seals on a young
        // book vanished and every later fast block glued to one FORMING blob. This list is the honest
        // spine: height + txid + optional land number. Additive; lands[] stays the city register.
        const landAt = new Map(R.lands.map((e) => [e.height, e.number]))
        const byTx = new Map()
        for (const h of anchoredBlocks()) {
          const a = anchors.get(h) || {}
          const key = a.txid || ('h:' + h) // one Bitcoin tx = one neuron; covering heights collapse
          const prev = byTx.get(key)
          if (!prev || h > prev.height) {
            byTx.set(key, { height: h, txid: a.txid || null, confirmations: a.confirmations ?? null, verified: !!a.verified, simulated: !!a.simulated, land: landAt.get(h) ?? prev?.land ?? null })
          }
        }
        const seals = [...byTx.values()].sort((a, b) => a.height - b.height)
        return ok(res, { tip: tipNumber(), anchors: anchors.size, totalLands: R.totalLands, totalLots: R.totalLots, lands, live, seals })
      }
      if (p === '/api/kraynet/rune-flow') {
        // THE RUNE RIVER — every rune-* journal event with the fast block it sealed in, so the
        // constellation can hang a coloured rune node off that block. Read-only, newest-capped.
        // Purely additive: the graph gains rune nodes; every existing node is untouched.
        const kinds = { 'rune-deposit': 'in', 'rune-send': 'move', 'rune-exit': 'out', 'rune-cancel': 'back', 'rune-lodge': 'arm', 'rune-settle': 'home' }
        const flow = []
        for (const e of events) {
          if (!e.kind || !kinds[e.kind]) continue
          const blk = blockOfSeq(e.seq)
          flow.push({
            seq: e.seq, kind: e.kind, act: kinds[e.kind], runeId: e.runeId ?? null,
            amount: e.amount ?? null, from: e.from ?? null, to: e.to ?? null,
            block: blk ? blk.number : null, at: e.at ?? null,
          })
        }
        return ok(res, { count: flow.length, flow: flow.slice(-200) })
      }
      if (p === '/api/kraynet/act-flow') {
        // THE ACTIVITY RIVER — every user act with the fast block it sealed in and its FAMILY, so the
        // constellation can hang one coloured node per act and be read at a glance. Read-only, newest-capped,
        // purely additive. Stars (inscribe/name/origin) come from /world already; structural events
        // (anchor/seal/settlement/genesis) are the chain itself, not user acts, so both are skipped here.
        const FAMILY = {
          'rune-deposit': 'rune', 'rune-send': 'rune', 'rune-exit': 'rune', 'rune-cancel': 'rune', 'rune-lodge': 'rune', 'rune-settle': 'rune', 'rune-rehome': 'rune',
          'amm-add': 'defi', 'amm-remove': 'defi', 'amm-swap': 'defi', 'amm-rr-add': 'defi', 'amm-rr-remove': 'defi', 'amm-rr-swap': 'defi',
          'transfer': 'money', 'reward': 'money', 'donate': 'money', 'burn': 'money', 'x-send': 'money',
          // THE LANE'S JOURNAL ACTS (TK-fold): enter/exit move Ӿ between books, a fold-seal lands one
          // proven breath — user acts, so the stage hangs a node for each (the transfers INSIDE the
          // fold are private to the proof by design; only these doors touch the journal).
          'lane-enter': 'money', 'lane-exit': 'money', 'fold-seal': 'money',
          'contract': 'law', 'contract-call': 'law',
          'quantum-commit': 'quantum', 'quantum-migrate': 'quantum',
          'transfer-star': 'starmove',
          // THE NATIVE STAR MARKET — list / delist / buy are user acts; the constellation
          // hangs a market-coloured node for each so a sale reads at a glance.
          'star-list': 'market', 'star-delist': 'market', 'star-buy': 'market',
          'star-offer': 'market', 'star-offer-cancel': 'market', 'star-offer-accept': 'market',
        }
        const flow = []
        for (const e of events) {
          if (!e.kind) continue
          let fam = FAMILY[e.kind]
          if (!fam) continue
          if (e.kind === 'transfer-star' && String(e.to || '') === 'KRAY_BLACK_HOLE') fam = 'fire'
          const blk = blockOfSeq(e.seq)
          // market acts carry price, not amount — surface it in the same field so the hover shows the ₭
          flow.push({
            seq: e.seq, kind: e.kind, family: fam, block: blk ? blk.number : null,
            amount: e.amount ?? e.price ?? null, to: e.to ?? null, at: e.at ?? null,
            runeId: e.runeId ?? null, otherRuneId: e.otherRuneId ?? null,
            createPool: isCreatePool(e) || undefined,
          })
        }
        return ok(res, { count: flow.length, flow: flow.slice(-300) })
      }
      if (p === '/api/kraynet/lands') {
        const R = landRollV2()
        return ok(res, { count: R.lands.length, totalLots: R.totalLots, barrenAnchors: anchors.size - R.totalLands, lands: R.lands.slice().reverse(), law: 'An anchor mints land only if a star was born beneath it. Land numbers are consecutive and permanent; a barren anchor takes no number.' })
      }
      {
        let lm
        if ((lm = p.match(/^\/api\/kraynet\/land\/(?:h(\d+)|(\d+)|(live)|(forming))$/))) {
          let height = null
          if (lm[2]) { height = heightOfLandV2(parseInt(lm[2], 10)); if (height === null) return err(res, 404, `land #${lm[2]} not minted yet`) }
          else if (lm[1]) height = parseInt(lm[1], 10)
          if (lm[3]) {
            // 'live' = the WHOLE city — every star ever created, across all districts — so the 3D
            // view and the treemap always render the full universe and never empty out after an anchor.
            const to = tipNumber(), all = parcelsInBlocks(0, to), R = landRollV2()
            return ok(res, {
              land: null, height: null, minted: false, live: true, exists: all.length > 0,
              range: { fromBlock: 0, toBlock: to, blocks: to + 1, leaves: all.length },
              totals: { parcels: all.length, lots: all.length, bytes: all.reduce((x, p) => x + (p.size || 0), 0), inscriptions: all.filter((p) => p.kind === 'inscription').length, baptisms: all.filter((p) => p.kind === 'baptism').length, writers: new Set(all.map((p) => p.by)).size }, parcels: all,
              lots: { first: all.length ? 0 : null, count: all.length },
              cityTotals: { lands: R.totalLands, lots: R.totalLots },
              anchor: null, neighbours: { prev: R.totalLands || null, next: null },
            })
          }
          // the TRUE forming district (what map.html's /land deed shows): ONLY the parcels not yet sealed
          // into a land. Unlike /live (the whole city, which never empties so the 3D/treemap stay full),
          // this honestly empties once Bitcoin has sealed everything — so a minted land is never re-shown
          // as "forming". buildLandV2(null) = pack(lastBoundary+1, tip): the range past the last sealed block.
          if (lm[4]) return ok(res, buildLandV2(null))
          const out = buildLandV2(height)
          return out ? ok(res, out) : err(res, 404, 'no anchor sealed that height on this node')
        }
        if ((lm = p.match(/^\/api\/kraynet\/parcel\/(\d+)$/))) {
          const pc = parcelOfStar(lm[1]); return pc ? ok(res, pc) : err(res, 404, 'no such parcel')
        }
        if ((lm = p.match(/^\/api\/kraynet\/land-of\/(.+)$/))) {
          const no = decodeURIComponent(lm[1]).replace(/[^0-9]/g, '')
          const s = no !== '' ? node.ledger.stars.star(BigInt(no)) : null
          if (!s) return err(res, 404, 'star not found')
          const blk = blockOfSeq(s.seq), anc = anchoredBlocks(); let land = null
          for (let i = 0; i < anc.length; i++) { const from = i > 0 ? anc[i - 1] + 1 : 0; if (blk && blk.number >= from && blk.number <= anc[i]) { land = buildLandV2(anc[i]); break } }
          if (!land) land = buildLandV2(null)
          return ok(res, { parcel: parcelOfStar(no), land: land ? { land: land.land, height: land.height, minted: land.minted, live: land.live, anchor: land.anchor } : null })
        }
      }
      // ── the compiled reading: rank of ₭ holders, supply, the library census ──
      if (p === '/api/kraynet/analytics') {
        const L = node.ledger
        const PROTOCOL = new Set([TREASURY, BLACK_HOLE])   // v2 has no emission vault — no premine
        const citizens = [...L.balances.entries()].filter(([a, b]) => !PROTOCOL.has(a) && b > 0n).map(([address, balance]) => ({ address, balance }))
        const totalHeld = citizens.reduce((t, a) => t + a.balance, 0n)
        const liveIns = L.stars.inscriptions().filter((x) => !x.cursed), liveNames = L.stars.baptisms().filter((x) => !x.cursed)
        const insBy = new Map(), nameBy = new Map()
        for (const x of liveIns) insBy.set(x.by, (insBy.get(x.by) || 0) + 1)
        for (const bp of liveNames) nameBy.set(bp.by, (nameBy.get(bp.by) || 0) + 1)
        const glowMap = frozenStarGlow(events)
        const lights = lightsView(null)
        const rank = citizens.map((a) => ({
          address: a.address, who: (labelOf(a.address) || {}).label || null, simulated: false, founder: false,
          balance: a.balance, share: totalHeld > 0n ? Number((a.balance * 1000000n) / totalHeld) / 10000 : 0,
          stars: L.stars.starsOf(a.address).length, works: insBy.get(a.address) || 0, names: nameBy.get(a.address) || 0,
          glow: String(glowMap.get(a.address) || 0), validating: false,
        })).sort((x, y) => (y.balance > x.balance ? 1 : y.balance < x.balance ? -1 : 0))
        const sup = node.supply(), R = landRollV2()
        const shelves = {}; let writtenBytes = 0
        for (const x of liveIns) { const c = catOf(x.contentType); shelves[c] = (shelves[c] || 0) + 1; writtenBytes += x.size || 0 }
        const bh = blackHoleView(L)
        return ok(res, {
          // envelope the /rank page reads: the network label, the simulation flag, and the FULL
          // holder count (the rank is uncapped today, so rankTotal == rank.length — but the page
          // states the cut explicitly the day a top-N cap is added, so it must never read 0).
          tip: tipNumber(), at: Date.now(), network: NET, simulation: false, rankTotal: rank.length,
          chain: { conserves: L.conserves() && L.backed(), cascadeRoot: node.cascadeRoot(), height: tipNumber(), events: node.seq, interval: 0, blocksPerMin: 0 },
          supply: { total: sup.circulating, emitted: sup.emitted, burned: sup.burned, circulating: sup.circulating, treasury: L.balances.get(TREASURY) || 0n, vault: 0n, heldByCitizens: totalHeld, holders: citizens.length, fire: bh.fire },
          pot: node.pot(), citizens: citizens.length, totalHeld,
          // PARTICIPATION — the UNFORGEABLE carry of this history: proven sha256 WORK (re-derived by
          // settleFromBeats), over an ACTIVE WINDOW of the last K seals. Never all-time, never a node count.
          // The headline is provenWork (a MAGNITUDE a splitter cannot inflate — the linear-settlement theorem);
          // distinctProvers rides only with the "identity is free, this counts work not machines" caveat.
          work: (() => {
            const tabs = settlementTables()
            const K = Math.min(24, tabs.length)
            const provers = new Set(); let w = 0n
            for (const t of tabs.slice(-K)) for (const l of (t.payouts || [])) { const paid = BigInt(l.paid ?? l.amount ?? 0); if (paid > 0n) { provers.add(l.address ?? l.id); w += BigInt(l.work ?? 0) } }
            return { windowSeals: K, distinctProvers: provers.size, provenWork: w.toString(), seals: tabs.length, lastSealAt: tabs.length ? (tabs[tabs.length - 1].at || null) : null }
          })(),
          rank,
          lights,
          stars: { total: L.stars.starCount, written: liveIns.length, named: liveNames.length },
          library: { works: liveIns.length, names: liveNames.length, bytes: writtenBytes, shelves, census: shelves },
          land: { totalLands: R.totalLands, totalLots: R.totalLots },
          blackHole: bh,
        })
      }
      // ── the library — every name humanity has written, and the works ──
      if (p === '/api/kraynet/library') {
        const L = node.ledger
        const bps = L.stars.baptisms().filter((x) => !x.cursed)       // every claimed name, claim order
        const inscs = L.stars.inscriptions().filter((x) => !x.cursed) // every work, creation order (oldest-first)
        // a star's rarity — BigInt-safe and never throwing (a bad number reads as no rarity)
        const rarityOf = (star) => { try { return node.star(BigInt(star))?.rarity ?? null } catch { return null } }
        // star -> its (non-cursed) name, and star -> its (non-cursed) work — for cross-lookups
        const nameByStar = new Map(bps.map((bp) => [String(bp.star), bp.name]))
        const workByStar = new Map(inscs.map((x) => [String(x.star), x]))

        // ── the census: every claimed name classified by the pure reading (readName) ──
        const census = { domain: 0, handle: 0, name: 0 }
        const tlds = {}
        const entries = bps.map((bp) => {
          const r = readName(bp.name)
          census[r.kind] = (census[r.kind] || 0) + 1
          if (r.kind === 'domain' && r.tld) tlds[r.tld] = (tlds[r.tld] || 0) + 1
          const w = workByStar.get(String(bp.star))
          return {
            star: String(bp.star), name: bp.name, canonical: r.canonical, kind: r.kind,
            tld: r.tld ?? null, lookalike: r.lookalike, lookalikeReason: r.lookalikeReason ?? null,
            rarity: rarityOf(bp.star),
            inscription: w ? { contentType: w.contentType, category: catOf(w.contentType), url: '/content/' + w.contentHash, size: w.size } : null,
          }
        })

        // ── the shelves: protocol reading order (library.ts CATEGORIES) ──
        // Every inscription is shelved by the content type its author SIGNED.
        // Law is a parallel canvas (a contract sealed on a star) — not a mime type.
        const shelfCount = {}
        for (const c of CATEGORIES) shelfCount[c.id] = 0
        shelfCount.law = 0
        const works = inscs.map((x) => {
          const category = catOf(x.contentType)
          shelfCount[category] = (shelfCount[category] || 0) + 1
          return {
            star: String(x.star), number: x.number ?? null, category, url: '/content/' + x.contentHash,
            contentType: x.contentType, size: x.size,
            name: nameByStar.get(String(x.star)) ?? null, rarity: rarityOf(x.star),
          }
        }).reverse()   // inscriptions() ascends by number (oldest-first); the page reads newest-first
        const laws = []
        for (let i = 0; i < L.stars.starCount; i++) {
          const s = L.stars.star(BigInt(i))
          if (!s || !s.contract) continue
          const no = String(s.no)
          laws.push({
            star: no, number: null, category: 'law', url: '/star/' + no + '#lawcard',
            contentType: 'application/kray-law', size: 0,
            name: nameByStar.get(no) ?? null, rarity: rarityOf(s.no),
            contract: s.contract,
          })
        }
        shelfCount.law = laws.length
        // first-class media + craft stay on the rail even at zero; rare empty shelves stay hidden
        const always = new Set(['image', 'video', 'audio', 'text', 'code', 'law'])
        const order = CATEGORIES.map((c) => c.id)
        const codeAt = order.indexOf('code')
        order.splice(codeAt + 1, 0, 'law')
        const shelves = order.filter((id) => always.has(id) || (shelfCount[id] || 0) > 0).map((id) => ({
          id, glyph: (SHELF_SPEC[id] || {}).glyph || '◇', label: (SHELF_SPEC[id] || {}).label || id,
        }))

        return ok(res, {
          count: bps.length, census, tlds,
          law: 'A name is claimed by its first writer and is theirs forever; every keyboard variation of a name is the same name, so nothing can be spoofed.',
          workCount: works.length, shelfCount, shelves, works, laws, lawCount: laws.length, entries,
        })
      }
      if (p === '/api/kraynet/blocks') {
        const q = url.searchParams
        const tip = tipNumber()
        let before = parseInt(q.get('before') ?? '', 10)
        if (!Number.isFinite(before)) before = tip + 1
        before = Math.max(0, Math.min(before, tip + 1))
        const limit = Math.max(1, Math.min(60, parseInt(q.get('limit') ?? '24', 10) || 24))
        const out = []
        for (let n = before - 1; n >= 0 && out.length < limit; n--) { if (blocks[n]) out.push(blockCard(blocks[n])) }
        const oldest = out.length ? out[out.length - 1].h : null
        return ok(res, { tip, blocks: out, nextBefore: oldest !== null && oldest > 0 ? oldest : null, done: oldest === null || oldest === 0 })
      }
      {
        let bm
        if ((bm = p.match(/^\/api\/kraynet\/block\/(\d+)$/))) {
          const b = blocks[parseInt(bm[1], 10)]
          if (!b) return err(res, 404, 'no such block')
          const sv = sealView(b)                          // cascade-aware: covered by its own seal OR the later one that buried it
          const evs = events.slice(b.fromSeq - 1, b.toSeq)
          return ok(res, {
            number: b.number, hash: b.hash, prevHash: b.prevHash, merkleRoot: b.merkleRoot,
            fromSeq: b.fromSeq, toSeq: b.toSeq, txCount: b.txCount, at: b.at,
            anchor: sv ? { txid: sv.txid, confirmations: sv.confirmations, verified: sv.verified, simulated: sv.simulated, cascadeRoot: sv.cascadeRoot, sealedBy: sv.sealedBy, selfAnchor: !!sv.selfAnchor, donateTxid: sv.donateTxid || null } : null,
            btcHeight: sv ? sv.btcHeight : null, btcChain: sv ? sv.btcChain : null,
            land: { land: null, live: true, lots: 0, note: 'sealed — building the district the next Bitcoin block will mint' },
            transactions: evs.map((e) => txSummary(e, b)),
          })
        }
        if ((bm = p.match(/^\/api\/kraynet\/tx\/([0-9a-f]{64})$/))) {
          const e = eventByHash.get(bm[1])
          if (e) {
            const block = blockOfSeq(e.seq)
            const sv = sealView(block)                    // cascade-aware: a tx is on Bitcoin once ITS block is buried by any seal ≥ it
            const sum = txSummary(e, block)
            // a RUNE event → resolve the rune name and decode its L1 Bitcoin tx (deposit outpoint /
            // exit payout) so the page shows WHICH rune moved, with its real edicts + amounts.
            if (sum.runeId) {
              const rmeta = await runeMetaOf(sum.runeId).catch(() => null)
              sum.runeName = (rmeta && rmeta.name) || await runeNameOf(sum.runeId)
              sum.runeSymbol = (rmeta && rmeta.symbol) || null
              sum.runeDiv = (rmeta && rmeta.divisibility) || 0
              sum.thumbnail = rmeta && rmeta.parent ? '/api/kraynet/rune-thumb/' + encodeURIComponent(sum.runeId) + '?v=2' : null
              const l1 = sum.l1Txid || (sum.outpoint ? String(sum.outpoint).split(':')[0] : null)
              if (l1) { const d = await decodeBitcoinRuneTx(l1).catch(() => null); if (d) sum.l1 = d }
            }
            if (sum.otherRuneId) {
              const ometa = await runeMetaOf(sum.otherRuneId).catch(() => null)
              sum.otherName = (ometa && ometa.name) || await runeNameOf(sum.otherRuneId).catch(() => sum.otherRuneId)
              sum.otherSymbol = (ometa && ometa.symbol) || null
              sum.otherDiv = (ometa && ometa.divisibility) || 0
              sum.otherThumbnail = ometa && ometa.parent ? '/api/kraynet/rune-thumb/' + encodeURIComponent(sum.otherRuneId) + '?v=2' : null
            }
            // a SETTLEMENT → re-derive the exact payout table the reducer credited (who earned what, and why)
            if (e.kind === 'settlement') {
              const st = settlementTableOf(e)
              if (st) { sum.payouts = st.payouts; sum.payoutCount = st.payouts.length; sum.feesPaid = st.paid; sum.pool = st.pool; sum.beacon = st.beacon }
            }
            // a LAW SEAL — the journal event IS the paper. Publish the IR + codeHash on this
            // tx only (not on every later call). A stranger re-derives the hash from these bytes.
            if (e.kind === 'contract' && e.code) {
              try {
                const codeHash = sha256hex(canonicalCode(e.code))
                sum.code = e.code
                sum.codeHash = codeHash
                sum.contract = contractAddress(codeHash, String(e.from), e.seq)
                sum.rules = Array.isArray(e.code.rules) ? e.code.rules.map((r) => r.name) : []
              } catch { /* malformed journal code — the act still shows; the paper does not */ }
            }
            if (e.kind === 'contract-call') {
              ensureCallReceipts()
              sum.contract = e.contract ?? null
              sum.rule = e.rule ?? null
              sum.callArgs = e.callArgs && typeof e.callArgs === 'object' ? e.callArgs : {}
              const rec = callReceipts.get(e.hash)
              if (rec) {
                sum.take = rec.take
                sum.payments = rec.payments
                sum.paid = rec.payments.filter((p) => BigInt(p.amount) > 0n)
                sum.interval = rec.interval
                sum.beacon = rec.beacon
              }
            }
            // an ANCHOR or SEAL → hand the page the DOOR to the distribution this seal paid: the anchor
            // finds its confirming seal (the next one journaled), the seal finds the settlement it fired
            // (journalSeal appends it in the same breath, so it sits within the next 2 seqs). Navigation
            // only — the table itself is re-derived on the settlement's own page.
            if (e.kind === 'seal' || e.kind === 'anchor') {
              let sealSeq = e.seq
              if (e.kind === 'anchor') { const s = events.find((x) => x.seq > e.seq && x.kind === 'seal'); sealSeq = s ? s.seq : -1 }
              if (sealSeq > 0) {
                const st = events.find((x) => x.kind === 'settlement' && x.seq > sealSeq && x.seq <= sealSeq + 2)
                if (st) { sum.settlementHash = st.hash; sum.settlementSeq = st.seq }
              }
            }
            return ok(res, {
              ...sum,
              prevHash: e.prevHash,
              block: block ? { number: block.number, hash: block.hash, merkleRoot: block.merkleRoot, at: block.at, txCount: block.txCount } : null,
              anchor: sv ? { txid: sv.txid, confirmations: sv.confirmations, verified: sv.verified, simulated: sv.simulated, cascadeRoot: sv.cascadeRoot, sealedBy: sv.sealedBy, selfAnchor: !!sv.selfAnchor, donateTxid: sv.donateTxid || null } : null,
              btcHeight: sv ? sv.btcHeight : null, btcChain: sv ? sv.btcChain : null,
              receipt: '/api/kraynet/receipt/' + e.seq,
              paidBinding: paidBindingOf(e.seq),
            })
          }
          // not a KRAY journal event — maybe a Bitcoin RUNE tx on the chain this node watches
          const brt = await decodeBitcoinRuneTx(bm[1]).catch(() => null)
          if (brt && brt.hasRunestone) return ok(res, { kind: 'bitcoin-rune', hash: bm[1], ...brt })
          return err(res, 404, 'no transaction with that hash on this node')
        }
      }
      if (p === '/api/kraynet/head') return ok(res, headView())
      // THE STAR MARKET — every live listing, enriched with the star's face (name, media, rarity) so the
      // marketplace page renders a card per offer. Read-only: the reducer's listing book is the sole truth.
      if (p === '/api/kraynet/market') {
        const listings = node.ledger.market.all().map((l) => {
          const s = node.star(BigInt(l.star))
          return {
            star: l.star, seller: l.seller, price: l.price,
            name: s?.name ?? null, contentHash: s?.contentHash ?? null, contentType: s?.contentType ?? null,
            rarity: s?.rarity ?? null, collection: s?.collection ?? null,
            media: s?.contentHash ? '/content/' + s.contentHash : null,
            owner: s?.owner ?? null,   // == seller while the offer is live; a mismatch means the offer is stale
          }
        })
        return ok(res, { count: listings.length, listings, ...marketPulse() })
      }
      // LINEAGE COLLECTIONS — a named parent with children. Read-only view of the journal + listing book.
      if (p === '/api/kraynet/collections') return ok(res, { collections: collectionsIndex() })
      { const cm = p.match(/^\/api\/kraynet\/collection\/(.+)$/); if (cm) {
        const view = collectionView(decodeURIComponent(cm[1]))
        return view ? ok(res, view) : err(res, 404, 'no such collection')
      } }
      // THE LANE, READABLE (TK-fold) — the proven lane state (the folder's breath `pre`) + the pending pool.
      if (p === '/api/kraynet/lane') {
        lanePrune()
        return ok(res, { ok: true, laneRoot: node.ledger.laneRootNow(), laneTotal: node.ledger.laneTotalNow().toString(), pre: node.ledger.laneStateView(), pending: lanePool })
      }
      if (p === '/api/kraynet/peers') {
        // ADR-2 2c-wire: publish the peers we have head-verified, so a joining node bootstraps discovery from
        // any node it already reaches. Only head-verified URLs (never raw candidates) are shared, and the list
        // is bounded — this endpoint hands out no secret and cannot itself become a flood vector.
        if (PUBLIC && publicWalletGetFlood(req)) return err(res, 429, 'slow down — peer discovery is gossiped, not polled')
        return ok(res, { peers: peerBook.peers().slice(0, 64), self: SELF_URL || undefined, head: node.overview().head })
      }
      // ADR-3 3b · the mailbox, readable: counts + the pending queue (signed PUBLIC objects — listing
      // them is what lets a future gossip layer exist; there is nothing private in a signed act).
      if (p === '/api/kraynet/inbox') {
        if (!inbox) return err(res, 404, 'the inbox is off on this node (KRAY_INBOX=0)')
        // The pending list is cheap (O(limit), in-memory ordering) but a public reader must still be
        // rate-limited so a hammering GET cannot monopolize the single event loop under an inflated queue.
        if (PUBLIC && publicWalletGetFlood(req)) return err(res, 429, 'slow down')
        const st = inbox.status()
        return ok(res, {
          ok: true, ...st,
          acts: inbox.pending(100).map((e) => ({ id: e.id, receivedAt: e.receivedAt, attempts: e.attempts || 0, action: e.act?.action ?? null, from: e.act?.from ?? null, lastError: e.lastError || null })),
        })
      }
      {
        const im = /^\/api\/kraynet\/inbox\/([0-9a-f]{64})$/.exec(p)
        if (im) {
          if (!inbox) return err(res, 404, 'the inbox is off on this node (KRAY_INBOX=0)')
          const { seat, envelope } = inbox.lookup(im[1])
          if (!seat || !envelope) return err(res, 404, 'no act with that id in this inbox (terminal receipts are reclaimed on a retention TTL — the journal is the truth)')
          return ok(res, { ok: true, id: im[1], status: seat, receivedAt: envelope.receivedAt, attempts: envelope.attempts || 0, lastError: envelope.lastError || null, outcome: envelope.outcome ?? null, reason: envelope.reason ?? null, note: envelope.note ?? null })
        }
      }
      if (p === '/api/kraynet/replica') {
        // THE REPLICATION SURFACE (Movement 2) — the raw journal, paginated, byte-faithful. The journal is
        // the ONLY consensus dataset: the v2 cascade root is a pure function of it, so a follower that
        // replays these lines re-derives the entire commitment Bitcoin witnessed — balances, stars, pot,
        // seals, runes, contracts — and trusts NOTHING this server said about them. Raw lines on purpose:
        // the audit is the replay, so this endpoint must not interpret anything.
        const q = url.searchParams
        const from = Math.max(1, parseInt(q.get('from') || '1', 10) || 1)
        const limit = Math.min(5000, Math.max(1, parseInt(q.get('limit') || '2000', 10) || 2000))
        const jp = node.store.journalPath
        const all = existsSync(jp) ? readFileSync(jp, 'utf8').split('\n').filter((l) => l.trim()) : []
        return ok(res, { file: 'journal', network: NET, total: all.length, from, lines: all.slice(from - 1, from - 1 + limit) })
      }
      // ── ADR-2 2a · THE CHUNK MANIFEST — the journal's content-addressed boundaries, so a follower can
      //    fetch the history in pieces from ANY peer and verify each against the anchored head (Article XII).
      //    Read-only: the boundaries + addresses, never a verdict. `verifyManifest(chunks, head)` is the client's.
      if (p === '/api/kraynet/chunks') {
        if (PUBLIC && publicWalletGetFlood(req)) return err(res, 429, 'slow down — the chunk manifest rebuilds per call')
        const jp = node.store.journalPath
        const all = existsSync(jp) ? readFileSync(jp, 'utf8').split('\n').filter((l) => l.trim()) : []
        if (!all.length) return ok(res, { network: NET, head: node.store.head, genesis: node.store.head, chunkSize: DEFAULT_CHUNK_SIZE, total: 0, chunks: [] })
        const { chunks, head, genesis } = chunkJournal(all, DEFAULT_CHUNK_SIZE)
        return ok(res, { network: NET, head, genesis, chunkSize: DEFAULT_CHUNK_SIZE, total: all.length, chunks: chunks.map((c) => ({ index: c.index, startSeq: c.startSeq, endSeq: c.endSeq, startPrevHash: c.startPrevHash, endHash: c.endHash, address: c.address })) })
      }
      // ── ADR-2 2a · ONE CHUNK by content address — the raw lines whose SHA-256 is that address. The client
      //    re-hashes to confirm the address and re-derives the chain from its boundary; a lying server is caught.
      {
        const cm = /^\/api\/kraynet\/chunk\/([0-9a-f]{64})$/.exec(p)
        if (cm) {
          if (PUBLIC && publicWalletGetFlood(req)) return err(res, 429, 'slow down')
          const jp = node.store.journalPath
          const all = existsSync(jp) ? readFileSync(jp, 'utf8').split('\n').filter((l) => l.trim()) : []
          if (all.length) { for (let s = 0; s < all.length; s += DEFAULT_CHUNK_SIZE) { const span = all.slice(s, s + DEFAULT_CHUNK_SIZE); if (chunkAddress(span) === cm[1]) return ok(res, { address: cm[1], lines: span }) } }
          return err(res, 404, 'no chunk with that content address in this journal')
        }
      }
      if (p === '/api/kraynet/anchors') {
        // every Bitcoin seal this node knows (operator/pooled + the donations that ARE anchors) — txids and
        // claimed roots ONLY. A follower treats these as HINTS: it re-proves each one from its OWN bitcoind
        // (raw tx + merkle path + headers) and refuses any that Bitcoin does not actually bury.
        const ops = [...anchors.entries()].filter(([, a]) => a.real && a.txid && !a.simulated)
          .map(([number, a]) => ({ kind: a.selfAnchor ? 'self-anchor' : a.pooled ? 'guardian' : 'operator', blockNumber: Number(number), txid: a.txid, root: a.root, verified: !!a.verified, btcHeight: a.btcHeight ?? null, confirmations: a.confirmations ?? 0 }))
        const selfs = [...selfAnchors.values()].map((s) => ({ kind: 'self-anchor', blockNumber: s.blockNumber, txid: s.txid, root: s.root }))
        const seen = new Set(); const list = []
        for (const a of [...ops, ...selfs]) { if (!seen.has(a.txid)) { seen.add(a.txid); list.push(a) } }
        return ok(res, { network: NET, count: list.length, anchors: list })
      }
      if (p === '/api/kraynet/overview') return ok(res, node.overview())
      if (p === '/api/kraynet/supply') {
        const s = node.supply()
        return ok(res, { ...s, fire: fireView(node.ledger) })
      }
      if (p === '/api/kraynet/pot') return ok(res, node.pot())
      // THE SELF-ANCHOR LOG — donations that ARE anchors (keyless, pay-to-contract). Each is re-verifiable: derive
      // selfAnchorScriptHex(internalKey, KrayAnchor.payload(blockNumber, root)) → the burn address the tx paid, and
      // confirm root == the cascade root this node sealed at blockNumber. `keyless` = the pot key is the NUMS point.
      if (p === '/api/kraynet/anchor-pool') {
        // the backstop's public state — pending target, quiet-window clock, the CURRENT draw (recomputable by
        // athe owner boxe from the beacon), the exact 49-byte payload a drawn guardian must broadcast, and the honest
        // reward source (fee pool — conserved, capped at what it holds, never minted).
        if (!anchorPool) return ok(res, { enabled: false, note: 'the any-guardian anchor backstop is OFF on this node — set KRAY_ANCHOR_POOL=1' })
        const pending = anchorPool.pending
        const waitedMs = pending && poolJobSince ? Date.now() - poolJobSince : 0
        const eligible = !!(pending && poolJobSince && waitedMs >= ANCHOR_POOL_QUIET_MS)
        let beacon = null, drawn = null
        if (eligible && btcConfigured()) {
          try { beacon = String(await btcRpc('getbestblockhash', [])); drawn = anchorPool.draw(beacon, ANCHOR_POOL_MIN_FEE) }
          catch { /* beacon unreadable this instant — shown as null; claims re-verify against live beacons */ }
        }
        return ok(res, {
          enabled: true, pending, eligible, waitedMs, quietMs: ANCHOR_POOL_QUIET_MS, beacon, drawn,
          minFeeSats: ANCHOR_POOL_MIN_FEE.toString(), ready: anchorPool.readyCount(ANCHOR_POOL_MIN_FEE),
          payload: pending ? KrayAnchor.payload(pending.height, pending.root) : null,
          reward: { perAnchor: DEFAULT_REWARD.perAnchor.toString(), maxFeeSats: DEFAULT_REWARD.maxFeeSats.toString(), source: 'fee pool — conserved, capped at what it holds, never minted' },
          feePool: node.feePool().toString(),
          settlements: anchorPool.settlements().map((s) => ({ ...s, sats: s.sats.toString(), reward: s.reward.toString() })),
        })
      }
      { const qm = p.match(/^\/api\/kraynet\/quantum\/(.+)$/); if (qm && qm[1] !== 'migrate') {
        // the post-quantum recovery commitment registered for an address (opt-in), plus whether it has been
        // rescued. A HASH — safe to serve, quantum-safe to hold. See docs/QUANTUM-READINESS.md.
        const addr = decodeURIComponent(qm[1])
        return ok(res, { address: addr, quantumCommit: node.ledger.quantumCommitOf(addr), migrated: node.ledger.isMigrated(addr), note: 'SHA-256 of a future post-quantum key, registered under the current signature — quantum-safe recovery' })
      } }
      if (p === '/api/kraynet/self-anchors') {
        const list = [...selfAnchors.values()].map((s) => {
          let burnAddress = null
          try { burnAddress = addressFromOutputKey(selfAnchorScriptHex(POT_INTERNAL_KEY, KrayAnchor.payload(s.blockNumber, s.root)).slice(4), NET) } catch { /* leave null */ }
          const verified = s.root === GENESIS_ROOT || !!(blocks[s.blockNumber] && blocks[s.blockNumber].cascadeRoot === s.root)
          return { ...s, burnAddress, verified }
        }).sort((a, b) => (b.at || 0) - (a.at || 0))
        return ok(res, { count: list.length, internalKey: POT_INTERNAL_KEY, keyless: POT_INTERNAL_KEY === BURN_INTERNAL_KEY, selfAnchors: list })
      }
      { const aom = p.match(/^\/api\/kraynet\/anchor-opening\/(\d+)$/); if (aom) {
        // THE UNIFIED OPENING — the PUBLIC bytes a client needs to re-prove an anchor ITSELF, never a verdict.
        // A cube that only golds through the CASCADE has no own Bitcoin tx — the covering seal's opening
        // is the one to prove (same bytes as /block/<sealedBy>). THIS ENDPOINT ASSERTS NOTHING.
        const bn = Number(aom[1])
        const hintBases = NET === 'main' ? ['https://mempool.space', 'https://blockstream.info']
          : NET === 'signet' ? ['https://mempool.space/signet']
          : NET === 'testnet' ? ['https://mempool.space/testnet', 'https://blockstream.info/testnet'] : []
        const hintsFor = (txid) => hintBases.map((b) => ({ name: b.replace('https://', ''), txPage: `${b}/tx/${txid}`, rawTx: `${b}/api/tx/${txid}/hex`, merkleProof: `${b}/api/tx/${txid}/merkle-proof` }))
        const openingAt = (n) => {
          const sa = [...selfAnchors.values()].find((s) => Number(s.blockNumber) === n)
          const op = anchors.get(n) || anchors.get(String(n))
          if (sa) {
            const payload = KrayAnchor.payload(sa.blockNumber, sa.root)
            let burnAddress = null
            try { burnAddress = addressFromOutputKey(selfAnchorScriptHex(POT_INTERNAL_KEY, payload).slice(4), NET) } catch { /* leave null */ }
            const claimed = sa.root === GENESIS_ROOT || !!(blocks[sa.blockNumber] && blocks[sa.blockNumber].cascadeRoot === sa.root)
            return { carrier: 'self-anchor', txid: sa.txid, vout: sa.vout ?? 0, blockNumber: sa.blockNumber, root: sa.root, internalKey: POT_INTERNAL_KEY, keyIsNums: POT_INTERNAL_KEY === BURN_INTERNAL_KEY, payload, burnAddress, nodeClaimsVerified: claimed }
          }
          if (op && op.real && op.txid && !op.simulated) {
            return { carrier: op.pooled ? 'guardian' : 'operator', txid: op.txid, vout: op.vout ?? null, blockNumber: n, root: op.root, payload: KrayAnchor.payload(n, op.root), nodeClaimsVerified: !!op.verified }
          }
          return null
        }
        let opening = openingAt(bn)
        let cascadeCover = false
        let coveredBlock = null
        if (!opening) {
          const cover = blocks[bn] ? sealOf(blocks[bn]) : null
          if (cover && Number.isInteger(cover.block)) {
            opening = openingAt(cover.block)
            if (opening) { cascadeCover = true; coveredBlock = bn }
          }
        }
        if (!opening) return err(res, 404, `no anchor opening for KRAY block ${bn} — it is not sealed into Bitcoin yet, or unknown to this node`)
        return ok(res, {
          network: NET, ...opening, explorerHints: hintsFor(opening.txid),
          ...(cascadeCover ? { cascadeCover: true, coveredBlock, sealedBy: opening.blockNumber } : {}),
          note: 'opening bytes only — recompute the output key from (payload) and match it against Bitcoin yourself; this node asserts nothing',
        })
      } }
      { const txm = p.match(/^\/api\/kraynet\/address-txs\/(.+)$/); if (txm) {
        // THE PROFILE'S ACTIVITY FEED — every journal event that touched this address, newest first,
        // paginated for the profile page (which renders each with txRow). Reuses txSummary (the rich
        // per-event shape the explorer already uses) and adds the address-relative direction. A pure
        // read of the journal — re-derivable, byte-exact, no state touched. (Local `txm`, not the shared
        // `m` which is only declared later in this handler — using `m` here would hit its TDZ.)
        const addr = decodeURIComponent(txm[1])
        const q = url.searchParams
        const limit = Math.max(1, Math.min(50, parseInt(q.get('limit') ?? '25', 10) || 25))
        const before = q.get('before') != null ? parseInt(q.get('before'), 10) : null   // a seq cursor
        const mine = events.filter((e) => (e.from === addr || e.to === addr) && (before == null || e.seq < before))
        // + the validator's settlement earnings (a settlement has no from/to, so the filter misses them)
        const merged = [...mine, ...validatorRewardRows(addr, before)].sort((a, b) => a.seq - b.seq)
        const page = merged.slice(-limit).reverse()   // newest-first within the page
        const transactions = await Promise.all(page.map(async (e) => {
          if (e.synthetic) {
            const blk = blockOfSeq(e.seq)
            return { hash: e.hash, seq: e.seq, kind: e.kind, at: e.at, from: null, to: addr, amount: e.amount, fee: '0', direction: 'in', work: e.work, hits: e.hits, blocksPresent: e.blocksPresent, blockNumber: blk ? blk.number : null }
          }
          const s = txSummary(e, blockOfSeq(e.seq))
          s.direction = e.from === addr && e.to === addr ? 'self' : e.from === addr ? 'out' : 'in'
          // rune events render RICH: the rune's name, symbol, divisibility (for display math) and its
          // parent-ordinal thumbnail — so a rune-deposit reads "777,000 KRAYNETBRIDGETRI", never "₭"
          if (s.runeId) {
            const meta = await runeMetaOf(s.runeId).catch(() => null)
            s.runeName = (meta && meta.name) || s.runeId
            s.runeSymbol = (meta && meta.symbol) || null
            s.runeDiv = (meta && meta.divisibility) || 0
            s.thumbnail = meta && meta.parent ? '/api/kraynet/rune-thumb/' + encodeURIComponent(s.runeId) + '?v=2' : null
          }
          if (s.otherRuneId) {
            const ometa = await runeMetaOf(s.otherRuneId).catch(() => null)
            s.otherName = (ometa && ometa.name) || s.otherRuneId
            s.otherSymbol = (ometa && ometa.symbol) || null
            s.otherDiv = (ometa && ometa.divisibility) || 0
            s.otherThumbnail = ometa && ometa.parent ? '/api/kraynet/rune-thumb/' + encodeURIComponent(s.otherRuneId) + '?v=2' : null
          }
          return s
        }))
        const oldestSeqInPage = page.length ? page[page.length - 1].seq : null
        const done = merged.length <= limit
        return ok(res, { address: addr, transactions, nextBefore: done ? null : oldestSeqInPage, done })
      } }
      { const am = p.match(/^\/api\/kraynet\/account\/(.+)\/activity$/); if (am) {
        // THE ACTIVITY FEED — every journal event that touched this address, newest first, formatted
        // for the wallet's Activity list (kind, direction, amount, the rune moved, a thumbnail, time).
        const addr = decodeURIComponent(am[1])
        const mine = events.filter((e) => e.from === addr || e.to === addr)
        // + the validator's settlement earnings (a settlement has no from/to, so the filter misses them)
        const merged = [...mine, ...validatorRewardRows(addr)].sort((a, b) => a.seq - b.seq)
        const recent = merged.slice(-60).reverse()
        const activity = await Promise.all(recent.map(async (e) => {
          if (e.synthetic) {
            return { hash: e.hash, seq: e.seq, kind: e.kind, at: e.at, from: null, to: addr, amount: e.amount, fee: '0', direction: 'in', star: null, name: null, runeId: null, sealed: blockOfSeq(e.seq) != null, block: (blockOfSeq(e.seq) || {}).number ?? null }
          }
          const sum = txSummary(e, blockOfSeq(e.seq))
          const out = {
            hash: e.hash, seq: e.seq, kind: e.kind, at: e.at || 0,
            from: e.from ?? null, to: e.to ?? null, amount: sum.amount, fee: sum.fee,
            direction: e.from === addr ? 'out' : 'in',
            star: sum.star, name: sum.name, runeId: sum.runeId || null,
            sealed: sum.blockNumber != null, block: sum.blockNumber,
          }
          if (sum.runeId) { out.runeName = await runeNameOf(sum.runeId).catch(() => null); out.thumbnail = '/api/kraynet/rune-thumb/' + encodeURIComponent(sum.runeId) + '?v=2' }
          return out
        }))
        return ok(res, { address: addr, activity })
      } }
      // A DONATION's LIVE BURIAL DEPTH — so the wallet can show a dynamic "X/N confirmations" while it waits,
      // and a "seen on the network" state the moment it is broadcast. Just reads the tx; no SPV, no mint.
      { let dm; if ((dm = p.match(/^\/api\/kraynet\/donate\/status\/([0-9a-f]{64})$/i))) {
        let confirmations = 0, seen = false
        if (btcConfigured()) {
          try { const info = await btcRpc('getrawtransaction', [dm[1], true]); seen = true; confirmations = info.confirmations || 0 } catch { /* not in mempool/chain yet */ }
        }
        return ok(res, { txid: dm[1], seen, confirmations, needed: DONATION_MIN_CONF })
      } }
      // THE DONATION CONTRACT — everything a client needs to BUILD a proof-of-donation: where to
      // pay (the pot), how deep it must bury (confirmations), how the donor is committed (an
      // OP_RETURN carrying the KRAY address, ascii), and how much is mintable now (the deficit).
      // Read-only. `configured:false` ⇒ this node only does the dev mint (regtest), no proofs yet.
      if (p === '/api/kraynet/censorship') return ok(res, censorshipOpeningView())
      if (p === '/api/kraynet/donation/info') {
        const pot = node.pot()
        return ok(res, {
          configured: !!POT_SCRIPT_HEX,
          proofRequired: !DEV_SHORTCUTS,   // closed on mainnet even if KRAY_TRUSTED_DEV=1
          net: NET,
          potAddress: POT_ADDRESS,
          potScript: POT_SCRIPT_HEX,
          minConfirmations: DONATION_MIN_CONF,
          mintCap: node.ledger.mintCap.toString(),   // the immutable per-mint cap (anti-whale) — 10,000 ₭ max per donation (MINT_CAP_SATS)
          mintableNow: (node.pot().deficit < node.ledger.mintCap ? node.pot().deficit : node.ledger.mintCap).toString(), // what a single donation can mint now = min(deficit, cap)
          rate: `1 KRAY per satoshi, capped at ${node.ledger.mintCap} per mint`,
          donorCommit: { output: 'op-return', payload: 'your KRAY address, ascii', note: 'the node reads this to know whom to credit' },
          contentMax: liveContentMax(),
          atlasFeeActive: node.ledger.atlasFeeOf(1) > 0n, // the wall-toll (branch A, ratified 2026-08-23): when true, a sized inscribe pays burn + an equal-law atlas fee to TREASURY
          inscriptionMetaMax: INSCRIBE_META_MAX,          // document cap (UTF-8 bytes) — consensus, not a page courtesy
          contractStarBurn: 1,                            // v2 law on a star burns exactly 1 ₭ (A2)
          contractLivingMouth: true,                      // v2 toggle_*/once_*/collect/stamp/draw/skip require living ownerOf(N); pulse/enter/settle stay public (A3)
          contractOnceMotion: true,                       // living flag motion once: true → false, one call, never back
          contractForms: true,                            // desk compiles escrow / tunnel / vest / scroll / raffle to the same IR
          contractScroll: true,                           // proven Dev Scroll: claim pays the caller; no secret key
          contractRaffle: true,                           // looping pot: enter · settle · draw · skip — needs a star
          contractMint: true,                             // drop on the face: inscribe with this star as parent; runCall mint is the blessing
          contractCut: true,                              // KRC-77 Cut: seal supply (max or infinite) + deposit ₭; no collect
          contractSource: true,                           // GET /star and /contract publish the sealed IR + codeHash (public paper)
          contractExam: true,                             // POST /contract-exam dry-runs IR (no journal, no ₭) before a seal
          starSpeak: true,                                // GET/POST /speak — BIP-340 hold proof, no journal, no ₭ (A2 intact)
          starSpeakConsume: 'lock',                       // nonce consume is the lock's job; on-cascade latch is once_ at 1 ₭
          censorshipVerify: true,                         // GET/POST /censorship — verifyCensorshipAnchored, evidence only, no journal
          contractCallV2: true,                           // door signs clock; beacon/interval re-derived from the last Bitcoin seal
          runeLawPotClosed: true,                         // rune-send to KRAY_CONTRACT_ is refused (IR pays only ₭)
          bytesPerKrayBurn: node.ledger.bytesPerKray,     // THE ERA'S RATE (retargets every 1008 seals) — pages price BEFORE signing
          sealContentBudget: node.ledger.sealBudgetLeft,  // bytes still open in this seal's hard 1 MB budget
          sealsToRetarget: node.ledger.sealsToRetarget,   // seals until the next space retarget
          // PHASE 3 (gated) · self-anchoring donations. The 'burn' label is TRUE only when the pot's internal key IS
          // the NUMS point (nobody's key) — otherwise the sats land at an operator-sweepable key, so we must NOT
          // claim "burned forever". The mode is DERIVED from the key, so the narrative can never outrun the truth.
          ...(selfAnchorReady() ? (() => {
            const blockNumber = Math.max(0, tipNumber()), root = node.cascadeRoot()
            const isBurn = POT_INTERNAL_KEY === BURN_INTERNAL_KEY
            return { selfAnchor: { mode: isBurn ? 'burn' : 'reserve', internalKey: POT_INTERNAL_KEY, keyIsNums: isBurn, blockNumber, root, burnAddress: (() => { try { return addressFromOutputKey(selfAnchorScriptHex(POT_INTERNAL_KEY, KrayAnchor.payload(blockNumber, root)).slice(4), NET) } catch { return null } })(), note: isBurn ? 'the donation pays this address — sats burned forever at a keyless NUMS output, the root sealed in the same output' : 'the donation pays this address and seals the root, but the pot key is NOT the NUMS point — these sats are custodian-sweepable, not burned' } }
          })() : {}),
        })
      }
      // the exact 49-byte OP_RETURN committing the whole state to Bitcoin — ready to broadcast
      // (an operator's node writes it; blockNumber is the journal seq until the Bitcoin clock lands)
      if (p === '/api/kraynet/anchor/payload') {
        const root = node.cascadeRoot(), blockNumber = node.seq
        return ok(res, { blockNumber, cascadeRoot: root, payload: KrayAnchor.payload(blockNumber, root), bytes: 49 })
      }
      // THE PAID BINDING — the named inclusion: journal act ⊂ cascade ⊂ 49-byte OP_RETURN ⊂ Bitcoin txid.
      // Optional ?seq=N (default: tip). The Groth16 body stays on the journal; bodyInTxid is always false.
      // The view always carries HEIGHT_CEILING (v1 u32, fail-closed). No v2 payload.
      if (p === '/api/kraynet/paid-binding') {
        const raw = url.searchParams.get('seq')
        if (raw != null && raw !== '') {
          const seq = parseInt(raw, 10)
          if (!Number.isInteger(seq) || String(seq) !== raw) return err(res, 400, 'seq must be an integer')
          const door = certificateDoor(paidBindingOf(seq))
          if (door.status !== 200) return err(res, door.status, door.error)
          return ok(res, door.body)
        }
        const door = certificateDoor(paidBindingOf(null), 'the journal is empty')
        if (door.status !== 200) return err(res, door.status, door.error)
        return ok(res, door.body)
      }
      let m
      // an address's inscriptions, newest-first + paginated — the profile's "chiselled into its stars" grid.
      // MUST come before the generic /profile/<addr> route or the address would swallow "…/inscriptions".
      if ((m = p.match(/^\/api\/kraynet\/profile\/(.+)\/inscriptions$/))) {
        const addr = decodeURIComponent(m[1])
        const q = url.searchParams
        const offset = Math.max(0, parseInt(q.get('offset') ?? '0', 10) || 0)
        const limit = Math.max(1, Math.min(48, parseInt(q.get('limit') ?? '12', 10) || 12))
        const inscs = node.starsOf(addr).map(Number).sort((a, b) => b - a)   // newest star (creation order) first
          .map((no) => node.star(BigInt(no))).filter((s) => s && s.contentHash)
          .map((s) => {
            const rec = node.ledger.stars.inscription(s.contentId || s.id)
            return {
              star: String(s.no), id: s.id, number: rec ? rec.number : null,
              held: existsSync(join(CONTENT_DIR, s.contentHash)), url: '/content/' + s.contentHash,
              contentHash: s.contentHash,
              ctype: s.contentType, rarity: s.rarity, name: s.name || null,
              meta: s.meta || null,
              size: rec ? rec.size : 0, parent: s.parent != null ? String(s.parent) : null,
              origin: s.origin ?? null,   // L1-ordinal provenance (additive — the wallet's ₿ seal)
              parents: s.parents ? s.parents.map(String) : null,               // v3 lineage (additive)
              origins: s.origins ? s.origins.map((o) => o.l1InscriptionId) : null,
            }
          })
        return ok(res, { total: inscs.length, items: inscs.slice(offset, offset + limit) })
      }
      if ((m = p.match(/^\/api\/kraynet\/profile\/(.+)$/))) {
        // the profile, ENRICHED with the address's L2 rune holdings (name, amount, and what is exiting)
        // in the exact shape the profile page renders — so "Your rune · the L2" shows real balances.
        const addr = decodeURIComponent(m[1])
        const view = profileView(addr)
        const held = node.runesOf(addr)
        view.runes = await Promise.all(held.map(async (r) => {
          const meta = await runeMetaOf(r.runeId).catch(() => null)
          // an OPEN exit shows its SIGNED destination too, so the profile's Cancel pedal can say
          // exactly where the lock was headed before the holder pulls it back — additive field.
          const pend = r.locked > 0n ? node.ledger.runes.lockedOf(parseRuneKey(r.runeId), addr) : null
          return {
            runeId: r.runeId, rune: (meta && meta.name) || r.runeId, symbol: (meta && meta.symbol) || null,
            divisibility: (meta && meta.divisibility) || 0,
            balance: r.amount.toString(), locked: r.locked > 0n ? { amount: r.locked.toString(), l1Address: (pend && pend.l1Address) || null } : null,
            personal: (r.personal ?? 0n).toString(), transferable: (r.transferable ?? 0n).toString(),
            thumbnail: meta && meta.parent ? '/api/kraynet/rune-thumb/' + encodeURIComponent(r.runeId) + '?v=2' : null,
          }
        }))
        return ok(res, view)
      }
      if ((m = p.match(/^\/api\/kraynet\/account\/(.+)$/))) return ok(res, profileView(decodeURIComponent(m[1])))
      // THE TWO LIGHTS — same fold /rank reads (analytics.lights). `top` caps the lists; omit for the full books.
      if (p === '/api/kraynet/lights') {
        const raw = url.searchParams.get('top')
        const top = raw == null || raw === '' ? null : Math.min(500, Math.max(1, Number(raw) || 100))
        return ok(res, { network: NET, ...lightsView(top) })
      }
      if ((m = p.match(/^\/api\/kraynet\/star\/(\d+)$/))) {
        const v = starView(BigInt(m[1])); return v ? ok(res, v) : err(res, 404, 'no such star')
      }
      // same star, named by its tattoo id (`<signed act hash>i<index>`). The page at /star/<id>
      // resolves here, then renders /api/kraynet/star/<number>. Cursed tattoos never bind a star.
      if ((m = p.match(/^\/api\/kraynet\/inscription\/([0-9a-f]{64}i\d+)$/))) {
        const ins = node.ledger.stars.inscription(m[1])
        if (!ins || ins.cursed) return err(res, 404, 'no such inscription')
        return ok(res, { star: ins.star, id: ins.id })
      }
      if ((m = p.match(/^\/api\/kraynet\/l1-children\/([0-9a-f]{64}i\d+)$/))) {
        return ok(res, { origin: m[1], children: originKidCards(m[1]) })
      }
      if (p === '/api/kraynet/speak') {
        // THE KEY — star #N is the master id a lock names. The living owner signs.
        // No journal, no ₭. A stranger re-verifies from the bytes + ownerOf(N).
        const star = String(url.searchParams.get('star') || '')
        if (!/^(0|[1-9]\d*)$/.test(star)) return err(res, 400, 'speak needs a star number')
        const v = starView(BigInt(star))
        if (!v) return err(res, 404, 'no such star')
        if (!v.owner || v.owner === 'KRAY_BLACK_HOLE') return err(res, 403, 'this star has no living mouth')
        let audience
        try { audience = readAudience(url.searchParams.get('audience')) }
        catch (e) { return err(res, 400, e instanceof Error ? e.message : String(e)) }
        const nonce = randomBytes(16).toString('hex')
        const exp = Math.floor(Date.now() / 1000) + SPEAK_TTL_SEC
        const challenge = { network: NET, star, owner: v.owner, audience, nonce, exp }
        const message = speakMessage(challenge)
        return ok(res, {
          ...challenge,
          message,
          speakId: speakId(message),
          fee: '0',
          journal: false,
          note: 'BIP-340 of the living owner. A stranger re-verifies from these bytes + ownerOf(star). The lock stores speakId — the network does not consume it. Not a journal act. Not 1 ₭.',
        })
      }
      // resolve a baptism NAME → its star (case-insensitive, universal-keyboard canonical, unique forever)
      if ((m = p.match(/^\/api\/kraynet\/name\/(.+)$/))) {
        const no = node.ledger.stars.starOfName(decodeURIComponent(m[1]))
        return no != null ? ok(res, starView(no)) : err(res, 404, 'no star carries that name')
      }
      if ((m = p.match(/^\/api\/kraynet\/runes\/of\/(.+)$/))) {
        // the L2 book (runeId, amount, locked) ENRICHED with ord metadata so the wallet renders
        // each rune richly — its name, symbol, divisibility, and a thumbnail (the parent inscription).
        const held = node.runesOf(decodeURIComponent(m[1]))
        const runes = await Promise.all(held.map(async (r) => {
          const meta = await runeMetaOf(r.runeId).catch(() => null)
          return {
            runeId: r.runeId, amount: r.amount.toString(), locked: r.locked.toString(),
            personal: (r.personal ?? 0n).toString(), transferable: (r.transferable ?? 0n).toString(),
            name: (meta && meta.name) || r.runeId, spacedName: (meta && meta.name) || r.runeId,
            symbol: meta && meta.symbol, divisibility: (meta && meta.divisibility) || 0,
            thumbnail: meta && meta.parent ? '/api/kraynet/rune-thumb/' + encodeURIComponent(r.runeId) + '?v=2' : null,
          }
        }))
        return ok(res, { runes })
      }
      if ((m = p.match(/^\/api\/kraynet\/rune-thumb\/(.+)$/))) {
        const meta = await runeMetaOf(decodeURIComponent(m[1])).catch(() => null)
        if (!meta || !meta.parent) return err(res, 404, 'no thumbnail for this rune')
        const got = await l1InscriptionBytes(meta.parent)
        if (!got) return err(res, 404, 'thumbnail unavailable')
        const thumb = contentThumbnail(got.body, got.contentType)
        res.writeHead(200, { 'Content-Type': thumb.contentType, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' })
        return res.end(thumb.body)
      }
      if (p === '/api/kraynet/runes') {
        // THE L2 RUNES OVERVIEW — every rune's book ENRICHED for the explorer: name, symbol, divisibility,
        // thumbnail, reserve, holder count, open exits, and the LIVE solvency verdict (reserve == Σ credits
        // + Σ locks). Read-only, re-derivable from the journal — the numbers ARE the proof.
        const list = await Promise.all(node.runes().map(async (r) => {
          const meta = await runeMetaOf(r.runeId).catch(() => null)
          const rid = parseRuneKey(r.runeId)
          const locks = node.ledger.runes.locksOf(rid)
          const lockedTotal = locks.reduce((t, l) => t + l.amount, 0n)
          const creditsTotal = r.holders.reduce((t, h) => t + h.amount, 0n)
          return {
            runeId: r.runeId, name: (meta && meta.name) || r.runeId, symbol: (meta && meta.symbol) || null,
            divisibility: (meta && meta.divisibility) || 0,
            thumbnail: meta && meta.parent ? '/api/kraynet/rune-thumb/' + encodeURIComponent(r.runeId) + '?v=2' : null,
            reserve: r.reserve.toString(), credits: creditsTotal.toString(), locked: lockedTotal.toString(),
            // KEEP `holders` the ARRAY it has always been (consumers do holders.find/.filter); the explorer
            // reads holderCount for the tally. Changing holders to a number broke every reader — never again.
            holders: r.holders.map((h) => ({ address: h.address, amount: h.amount.toString() })),
            holderCount: r.holders.length, exits: locks.length,
            solvent: creditsTotal + lockedTotal === r.reserve,
          }
        }))
        return ok(res, { runes: list, solvent: node.ledger.runesSolvent(), count: list.length })
      }
      if (p === '/api/kraynet/amm/book') {
        const q = url.searchParams
        const pot = String(q.get('pot') || '')
        let runeId = String(q.get('runeId') || q.get('a') || '')
        let otherId = String(q.get('otherRuneId') || q.get('b') || '')
        const name = String(q.get('name') || '')
        const other = String(q.get('other') || '')
        try {
          if (pot) {
            const parsed = parseAmmPotAddress(pot)
            if (!parsed) return err(res, 400, 'not a pool pot')
            const raw = parsed.kind === 'rr' ? node.ammRrPool(parsed.a, parsed.b) : node.ammPool(parsed.runeId)
            if (!raw) return err(res, 404, 'no book for that pot')
            return ok(res, await enrichAmmPool(raw))
          }
          if (runeId) {
            try { runeId = canonicalRuneKey(runeId) } catch { return err(res, 400, 'malformed runeId') }
          }
          if (otherId) {
            try { otherId = canonicalRuneKey(otherId) } catch { return err(res, 400, 'malformed otherRuneId') }
          }
          if (runeId && otherId) {
            const raw = node.ammRrPool(runeId, otherId)
            if (!raw) return err(res, 404, 'no rune/rune book for that pair')
            return ok(res, await enrichAmmPool(raw))
          }
          if (runeId) {
            const raw = node.ammPool(runeId)
            if (!raw) return err(res, 404, 'no ₭ book for that rune')
            return ok(res, await enrichAmmPool(raw))
          }
          if (name) {
            const dressed = await Promise.all(node.ammPools().map((pool) => enrichAmmPool(pool)))
            const up = (s) => String(s || '').toUpperCase()
            const hit = dressed.find((p) => {
              if (other) {
                const a = up(p.callA), b = up(p.callB)
                const n = up(name), o = up(other)
                return p.kind === 'rr' && (
                  (a === n && b === o) || (a === o && b === n)
                  || (up(p.name) === n && up(p.otherName) === o)
                  || (up(p.name) === o && up(p.otherName) === n)
                )
              }
              return p.kind !== 'rr' && (up(p.callB) === up(name) || up(p.name) === up(name))
            })
            if (!hit) return err(res, 404, 'no book with that name on this node')
            return ok(res, hit)
          }
          return err(res, 400, 'book needs a pair — ?name=IRON or ?name=IRON&other=GOLD or ?runeId=')
        } catch (e) { return err(res, 400, e.message || 'book refused') }
      }
      if (p === '/api/kraynet/amm/pools') {
        const pools = await Promise.all(node.ammPools().map((pool) => enrichAmmPool(pool)))
        return ok(res, { pools })
      }
      if (p === '/api/kraynet/amm/quote') {
        const q = url.searchParams
        let runeId
        try { runeId = canonicalRuneKey(String(q.get('runeId') || '')) } catch { return err(res, 400, 'malformed runeId') }
        const op = String(q.get('op') || 'swap')
        const otherRaw = q.get('otherRuneId')
        try {
          if (otherRaw) {
            let otherId
            try { otherId = canonicalRuneKey(String(otherRaw)) } catch { return err(res, 400, 'malformed otherRuneId') }
            if (op === 'add') {
              const runeIn = String(q.get('runeIn') || '')
              const otherIn = String(q.get('otherIn') || '')
              if (!/^[0-9]+$/.test(runeIn) || !/^[0-9]+$/.test(otherIn)) return err(res, 400, 'quote rr-add needs ?runeId=&otherRuneId=&runeIn=&otherIn=')
              return ok(res, node.ammRrQuoteAdd(runeId, otherId, BigInt(runeIn), BigInt(otherIn)))
            }
            if (op === 'remove') {
              const lp = String(q.get('lp') || '')
              if (!/^[0-9]+$/.test(lp)) return err(res, 400, 'quote rr-remove needs ?runeId=&otherRuneId=&lp=')
              return ok(res, node.ammRrQuoteRemove(runeId, otherId, BigInt(lp)))
            }
            const amount = String(q.get('amount') || '')
            const pay = String(q.get('payRuneId') || q.get('pay') || '')
            if (!/^[0-9]+$/.test(amount)) return err(res, 400, 'quote rr-swap needs ?runeId=&otherRuneId=&payRuneId=&amount=')
            return ok(res, node.ammRrQuote(runeId, otherId, pay, BigInt(amount)))
          }
          if (op === 'add') {
            const krayIn = String(q.get('krayIn') || '')
            const runeIn = String(q.get('runeIn') || '')
            if (!/^[0-9]+$/.test(krayIn) || !/^[0-9]+$/.test(runeIn)) return err(res, 400, 'quote add needs ?runeId=&krayIn=&runeIn=')
            return ok(res, node.ammQuoteAdd(runeId, BigInt(krayIn), BigInt(runeIn)))
          }
          if (op === 'remove') {
            const lp = String(q.get('lp') || '')
            if (!/^[0-9]+$/.test(lp)) return err(res, 400, 'quote remove needs ?runeId=&lp=')
            return ok(res, node.ammQuoteRemove(runeId, BigInt(lp)))
          }
          const side = q.get('side') === 'rune' ? 'rune' : 'kray'
          const amount = String(q.get('amount') || '')
          if (!/^[0-9]+$/.test(amount)) return err(res, 400, 'quote needs ?runeId=&side=kray|rune&amount=')
          return ok(res, node.ammQuote(runeId, side, BigInt(amount)))
        } catch (e) { return err(res, 400, e.message || 'quote refused') }
      }
      if (p === '/api/kraynet/amm/tape') {
        const q = url.searchParams
        let wantId = ''
        let wantOther = ''
        if (q.get('runeId')) {
          try { wantId = canonicalRuneKey(String(q.get('runeId'))) } catch { return err(res, 400, 'malformed runeId') }
        }
        if (q.get('otherRuneId')) {
          try { wantOther = canonicalRuneKey(String(q.get('otherRuneId'))) } catch { return err(res, 400, 'malformed otherRuneId') }
        }
        const sameTape = (e) => {
          if (wantOther) {
            if (!wantId || !String(e.kind || '').startsWith('amm-rr-')) return false
            try {
              const want = rrPairKey(wantId, wantOther)
              const pair = rrPairKey(String(e.runeId || ''), String(e.otherRuneId || ''))
              return pair.a === want.a && pair.b === want.b
            } catch { return false }
          }
          if (!wantId) return String(e.kind || '').startsWith('amm-')
          if (String(e.kind || '').startsWith('amm-rr-')) return false
          try { return canonicalRuneKey(String(e.runeId || '')) === wantId } catch { return String(e.runeId) === wantId }
        }
        const limit = Math.max(1, Math.min(512, parseInt(q.get('limit') || '48', 10) || 48))
        const evs = events.filter((e) => e.kind && sameTape(e)).slice(-limit).reverse()
        return ok(res, {
          tape: evs.map((e) => {
            const s = txSummary(e, blockOfSeq(e.seq))
            return {
              hash: e.hash, seq: e.seq, kind: e.kind, at: e.at || 0, from: e.from || null,
              runeId: e.runeId || null, otherRuneId: e.otherRuneId || null, side: e.side || null,
              payRuneId: e.payRuneId || null, createPool: !!s.createPool,
              amount: s.amount, krayIn: e.krayIn || null, runeIn: e.runeIn || null, otherIn: e.otherIn || null, lp: e.lp || null,
              block: s.blockNumber, sealed: s.blockNumber != null,
            }
          }),
        })
      }
      if (p === '/api/kraynet/amm/rr-pool') {
        const q = url.searchParams
        let a, b
        try { a = canonicalRuneKey(String(q.get('a') || q.get('runeId') || '')) } catch { return err(res, 400, 'malformed a') }
        try { b = canonicalRuneKey(String(q.get('b') || q.get('otherRuneId') || '')) } catch { return err(res, 400, 'malformed b') }
        const pool = node.ammRrPool(a, b)
        if (!pool) return err(res, 404, 'no rune/rune pool for that pair')
        return ok(res, await enrichAmmPool(pool))
      }
      if ((m = p.match(/^\/api\/kraynet\/amm\/pool\/(.+)$/))) {
        let runeId
        try { runeId = canonicalRuneKey(decodeURIComponent(m[1])) } catch { return err(res, 400, 'malformed runeId') }
        const pool = node.ammPool(runeId)
        if (!pool) return err(res, 404, 'no pool for that rune')
        return ok(res, await enrichAmmPool(pool))
      }
      if (p === '/api/kraynet/rune/backing') {
        // THE BACKING PANEL — MUST sit above /rune/:id, or "backing" is parsed as a rune name.
        // Read-only: how much of this address's balance is PERSONAL-vault backed (gated until
        // rehomed) vs pot-backed (freely sendable; recipients withdraw without them).
        const q = url.searchParams
        if (!q.get('runeId') || !q.get('address')) return err(res, 400, 'backing needs ?runeId=&address=')
        let brid
        try { brid = parseRuneKey(String(q.get('runeId'))) } catch { return err(res, 400, 'malformed runeId') }
        const baddr = String(q.get('address'))
        const pool = consolidationVault()
        const pendingRehome = rehomePayouts.find((r) => r.from === baddr && r.runeId === q.get('runeId') && r.doneSeq == null)
        const potHeld = vaultWatch
          .filter((w) => w.runeId === String(q.get('runeId')) && !w.releasedBy && w.kind === 'consolidation')
          .reduce((t, w) => t + BigInt(w.amount || 0), 0n)
        return ok(res, {
          ok: true, runeId: q.get('runeId'), address: baddr,
          balance: node.ledger.runes.balanceOf(brid, baddr).toString(),
          locked: (node.ledger.runes.lockedOf(brid, baddr)?.amount ?? 0n).toString(),
          personal: node.ledger.runes.personalOf(brid, baddr).toString(),
          transferable: node.ledger.runes.transferableOf(brid, baddr).toString(),
          potHeld: potHeld.toString(),
          potConfigured: !!pool, pot: pool ? pool.address : null,
          rehomePending: pendingRehome ? { txid: pendingRehome.txid, at: pendingRehome.at } : null,
          reducerGate: BACKING_GATE,
        })
      }
      if (p === '/api/kraynet/pot-book') {
        // READ-ONLY: the SHARED pot's book — who it backs (a holder's balance MINUS their personal-vault
        // slice) and by how much, straight from the ledger. This is the exact set the pot's pre-signed split
        // pays, each holder to their own address (#4). Pure derived view — no ord, no keys, no mutation.
        // MUST sit above /rune/:id so "pot-book" is never parsed as a rune name.
        const q = url.searchParams
        if (!q.get('runeId')) return err(res, 400, 'pot-book needs ?runeId=')
        let pbid
        try { pbid = parseRuneKey(String(q.get('runeId'))) } catch { return err(res, 400, 'malformed runeId') }
        const pbHolders = node.ledger.runes.potBackedHolders(pbid)
        const pooled = pbHolders.reduce((t, h) => t + h.amount, 0n)
        const pbPool = consolidationVault()
        return ok(res, {
          ok: true, runeId: q.get('runeId'),
          pooled: pooled.toString(),
          holderCount: pbHolders.length,
          holders: pbHolders.map((h) => ({ address: h.address, amount: h.amount.toString() })),
          potConfigured: !!pbPool, pot: pbPool ? pbPool.address : null,
        })
      }
      if (p === '/api/kraynet/pot-settlement') {
        // READ-ONLY: ASSEMBLE (but never sign) the pot's pre-signed split — pay each pot-backed holder their
        // book to their OWN address, from the pot's rune outpoints (#4). Composes proven pieces
        // (potBackedHolders → selectRuneCoins over the ord-resolved pot coins → buildPotSettlement) and proves
        // it safe (auditSettlementSafety, ord's own decoder). No keys, no signing, no broadcast, no mutation —
        // the inspection surface. Armed later (owner + guardians co-sign) it makes the owner sweep auto-fail.
        const q = url.searchParams
        if (!q.get('runeId')) return err(res, 400, 'pot-settlement needs ?runeId=')
        let psid
        try { psid = parseRuneKey(String(q.get('runeId'))) } catch { return err(res, 400, 'malformed runeId') }
        const psHolders = node.ledger.runes.potBackedHolders(psid)
        if (!psHolders.length) return ok(res, { ok: true, runeId: q.get('runeId'), holders: [], settlement: null, note: 'no pot-backed holders — nothing to settle' })
        const psPool = consolidationVault()
        if (!psPool) return err(res, 501, 'no consolidation vault configured (KRAY_CONSOLIDATION_KEY) — the pot has no home')
        if (!btcConfigured()) return err(res, 501, 'this node has no bitcoind/ord wired — it cannot resolve the pot outpoints')
        // resolve the pot's rune coins (scan the pot address + ord per output) — the proven withdraw pattern
        const psScan = await scanUtxos(psPool.address).catch(() => [])
        const psCoins = []
        for (const u of psScan) {
          const r = await ordOutputRuneAmount(u.txid, u.vout, psid).catch(() => 0n)
          if (r > 0n) psCoins.push({ txid: u.txid, vout: u.vout, amountSats: BigInt(u.value), runes: r })
        }
        const psNeed = psHolders.reduce((t, h) => t + h.amount, 0n)
        const psSel = selectRuneCoins(psCoins, psNeed)
        if (psSel.totalRunes < psNeed) {
          return ok(res, { ok: true, runeId: q.get('runeId'), holders: psHolders.map((h) => ({ address: h.address, amount: h.amount.toString() })), settlement: null, note: `the pot holds ${psSel.totalRunes} of ${psNeed} of this rune on chain — cannot fully back the book yet` })
        }
        let psSpend, psAudit
        try {
          psSpend = buildPotSettlement({
            runeId: psid, potParams: psPool.params,
            potUtxos: psSel.selected.map((c) => ({ txid: c.txid, vout: c.vout, amountSats: c.amountSats })),
            potTotalRunes: psSel.totalRunes,
            holders: psHolders.map((h) => ({ address: h.address, bookRunes: h.amount })),
            remainderAddress: psPool.address,
          })
          psAudit = auditSettlementSafety({ runeId: psid, outputScriptsHex: psSpend.outputScriptsHex, inputRunes: psSel.totalRunes, depositorOutput: 0, consolidationOutput: psSpend.consolidationOutput, maxDepositorRunes: 0n, dests: psSpend.dests })
        } catch (e) { return err(res, 400, 'could not assemble the pot split — ' + (e instanceof Error ? e.message : String(e))) }
        return ok(res, {
          ok: true, runeId: q.get('runeId'),
          holders: psHolders.map((h) => ({ address: h.address, amount: h.amount.toString() })),
          settlement: {
            unsignedTxHex: psSpend.unsignedTxHex,
            inputs: psSel.selected.length,
            dests: psSpend.dests.map((d) => ({ output: d.output, amount: d.amount.toString() })),
            audit: { ok: psAudit.ok, ...(psAudit.reason ? { reason: psAudit.reason } : {}) },
            note: 'UNSIGNED — the owner + a threshold of guardians co-sign this to arm it; publishing then makes the owner unilateral sweep auto-fail (Ark ceiling: censor, never steal).',
          },
        })
      }
      if ((m = p.match(/^\/api\/kraynet\/rune\/([^/?]+)$/))) {
        // ONE RUNE, IN FULL — its identity, its L2 book, its backing on Bitcoin, and its whole story. Everything
        // an explorer shows for a rune, each figure re-derivable from the journal + the anchored vault-watch.
        // Accepts the canonical id ("block:tx", %3A included) OR the rune's NAME — a name is resolved to its
        // id through ord (the normative indexer), so /runes#KRAYNETLTWODEMOAAA lands on the same book.
        // (GET only — the POST verbs /rune/deposit|send|exit|settle live in the POST branch, untouched.)
        let runeIdStr = decodeURIComponent(m[1])
        if (!/^\d+:\d+$/.test(runeIdStr)) {
          const resolved = await runeIdOf(runeIdStr).catch(() => null)
          if (!resolved || !/^\d+:\d+$/.test(String(resolved))) return err(res, 404, 'no rune with that id or name on this network')
          runeIdStr = String(resolved)
        }
        const rid = parseRuneKey(runeIdStr)
        const known = node.ledger.runes.runes().some((x) => `${x.block}:${x.tx}` === runeIdStr)
        if (!known) return err(res, 404, 'no L2 book for that rune on this node')
        const meta = await runeMetaOf(runeIdStr).catch(() => null)
        const reserve = node.ledger.runes.reserveOf(rid)
        const holders0 = node.ledger.runes.holders(rid)
        const creditsTotal = holders0.reduce((t, h) => t + h.amount, 0n)
        const locks = node.ledger.runes.locksOf(rid)
        const lockedTotal = locks.reduce((t, l) => t + l.amount, 0n)
        const holders = await Promise.all(holders0.map(async (h) => ({
          address: h.address,
          who: (await ammPairWho(h.address)) || (labelOf(h.address) || {}).label || null,
          amount: h.amount.toString(),
          share: reserve > 0n ? Number((h.amount * 1000000n) / reserve) / 10000 : 0,
        })))
        // THE BACKING ON BITCOIN — the watched vault outpoints holding this rune's reserve (proven on L1)
        const backing = vaultWatch.filter((w) => w.runeId === runeIdStr).map((w) => ({ outpoint: w.outpoint, vault: w.kind === 'consolidation' ? '(consolidation pool)' : w.vault, amount: w.amount, kind: w.kind || 'vault', released: !!w.releasedBy }))
        // THE STORY — every rune-* journal event for this rune, newest first, enriched with a per-kind tag
        const evs = events.filter((e) => e.kind && e.kind.startsWith('rune-') && e.runeId === runeIdStr).slice(-40).reverse()
        const activity = evs.map((e) => {
          const s = txSummary(e, blockOfSeq(e.seq))
          return { hash: e.hash, kind: e.kind, at: e.at || 0, from: e.from || null, to: e.to || null, amount: s.amount, l1Address: e.l1Address || null, l1Txid: e.l1Txid || null, outpoint: e.outpoint || null, block: s.blockNumber, sealed: s.blockNumber != null }
        })
        return ok(res, {
          runeId: runeIdStr, name: (meta && meta.name) || runeIdStr, symbol: (meta && meta.symbol) || null,
          divisibility: (meta && meta.divisibility) || 0, parent: (meta && meta.parent) || null,
          thumbnail: meta && meta.parent ? '/api/kraynet/rune-thumb/' + encodeURIComponent(runeIdStr) + '?v=2' : null,
          reserve: reserve.toString(), credits: creditsTotal.toString(), locked: lockedTotal.toString(),
          solvent: creditsTotal + lockedTotal === reserve,
          equation: `${creditsTotal} credits + ${lockedTotal} locked == ${reserve} reserve`,
          holders, exits: locks.map((l) => ({ address: l.address, amount: l.amount.toString(), l1Address: l.l1Address })),
          backing, activity,
        })
      }
      if (p === '/api/kraynet/bridge/params') {
        // THE FEDERATION, PUBLISHED — the guardian set + threshold + timelock every rune vault is built
        // from. A wallet derives a PERSONAL vault as deriveVault({these guardians, its own depositor key}).
        // That personal box has a unilateral leaf (the user's key, after the timelock). A pot-first
        // credit does not: the pot depositor is the network consolidation key (Article XIII).
        // Mainnet must be explicitly configured.
        const f = bridgeFederation()
        if (!f.configured) return err(res, 501, 'this node has no bridge federation configured — set KRAY_VAULT_GUARDIANS (and threshold/timelock) to enable rune deposits')
        const pool = consolidationVault()
        return ok(res, {
          ok: true, net: NET, guardians: f.guardians, threshold: f.threshold, timelock: f.timelock, dev: f.dev,
          unilateralDays: Math.round(f.timelock / 144),
          pot: pool ? pool.address : null,
          proofs: { burn: CONSENSUS_BURN_PROOF, rune: CONSENSUS_RUNE_PROOF },
          backingGate: BACKING_GATE,
          potUnilateral: pool ? 'network-consolidation-key' : null,
          potSigner: potSignerConfigured(),
          remoteGuardians: guardianSignerUrls().length,
          note: 'Send runes to `pot` on Bitcoin — one fee, instantly sendable on the L2. Your Bitcoin wallet is the vault; the pot is the shop window. The credit binds to the Taproot key that spent the coins. The pot\'s unilateral leaf is the network consolidation key, not the user. A withdraw is authorised by the signed rune-exit; the pot key (pot-signer, not this process) only signs a rebuilt payout bound to that exit.',
        })
      }
      if ((m = p.match(/^\/api\/kraynet\/bridge\/vault\/([0-9a-fA-F]{64,66})$/))) {
        // DERIVE A DEPOSITOR'S VAULT — given their x-only (or 33-byte) key, return the Taproot address to
        // send runes into, plus the exact params. The node RE-DERIVES this on every deposit and the wallet
        // can re-derive it too (same pure function), so nobody has to trust this address — it is checkable.
        const f = bridgeFederation()
        if (!f.configured) return err(res, 501, 'no bridge federation configured on this node — rune deposits are disabled')
        let depositor
        try { depositor = toXOnly(String(m[1]).toLowerCase()) } catch (e) { return err(res, 400, 'the depositor key must be 32-byte x-only or 33-byte compressed hex') }
        let v
        try { v = deriveVault({ guardians: f.guardians, threshold: f.threshold, depositor, timelock: f.timelock, net: toBtcNet(NET) }) }
        catch (e) { return err(res, 400, 'could not derive a vault — ' + (e instanceof Error ? e.message : String(e))) }
        return ok(res, {
          ok: true, net: NET, vault: v.address, depositor,
          params: { guardians: f.guardians, threshold: f.threshold, depositor, timelock: f.timelock },
          unilateralDays: Math.round(f.timelock / 144),
          note: 'Not a product deposit path. New deposits go to the bakery pot (GET /api/kraynet/bridge/params → pot). This address is the federation-derived vault used internally for exit and rehome of historical personal backing.',
        })
      }
      if (p === '/api/kraynet/vault-watch') {
        // the watcher's report — read-only. ?sweep=1 asks the chain RIGHT NOW (still read-only:
        // a sweep only reads UTXOs and reports; it cannot move anything), which is what lets a
        // test or an auditor get a deterministic answer instead of waiting out the interval.
        if (url.searchParams.get('sweep') === '1' && btcConfigured()) await sweepVaultWatch()
        return ok(res, {
          ok: true, watching: vaultWatch.length, intervalSec: VAULT_WATCH_SEC, chainWired: btcConfigured(),
          reflexEnabled: PRESIGNED_SETTLEMENT, settlementsLodged: settlementByOutpoint.size,
          lastSweepAt: vaultWatchLast.at || null, backed: vaultWatchLast.backed, released: vaultWatchLast.released,
          alarms: vaultWatchLast.alarms,
          outpoints: vaultWatch.map((w) => ({ outpoint: w.outpoint, runeId: w.runeId, vault: w.vault, amount: w.amount, released: w.releasedBy || null, settlement: settlementByOutpoint.get(w.outpoint) ? { lodged: true, broadcastTxid: settlementByOutpoint.get(w.outpoint).broadcastTxid || null } : null })),
        })
      }
      if (p === '/api/kraynet/vault-settlements') {
        // THE PERMISSIONLESS WATCHTOWER DOOR — every ARMED settlement, bytes included, public.
        // A co-signed cooperative split is NOT a secret: it can only pay the book's own truth
        // (audited against this node's OWN book at lodge time — depositor ≤ lock, remainder to the
        // canonical consolidation vault, nothing burned), and it spends ONE fixed outpoint, so the
        // worst a stranger can do with the hex is SETTLE THE EXIT EARLY — which is the honest
        // outcome, not an attack. Publishing the bytes makes the reflex permissionless: any wallet,
        // any watcher, any stranger may `sendrawtransaction` it the instant the vault drains (or
        // sooner), and the node's reconcile loop settles the L2 lock against whichever broadcast
        // confirms. The node stops being the only hand on the brake.
        const list = [...settlementByOutpoint.entries()].map(([outpoint, s]) => ({
          outpoint, runeId: s.runeId, from: s.from || null, lockAmount: s.lockAmount || null,
          depositorGot: s.depositorGot || null, consolidationGot: s.consolidationGot || null,
          cosignedTxHex: s.cosignedTxHex, broadcastTxid: s.broadcastTxid || null,
          reconciledSeq: s.reconciledSeq ?? null, storedAt: s.storedAt || null,
        }))
        return ok(res, {
          enabled: PRESIGNED_SETTLEMENT, count: list.length, settlements: list,
          note: 'athe owner boxe may broadcast an armed hex (sendrawtransaction) — the split pays only the book\'s own audited truth, so early broadcast just settles the exit honestly',
        })
      }
      if (p === '/api/kraynet/mint-offer') {
        // Public card only — never the art URL, never the bytes. Those leave only after a paid birth.
        const q = new URL(req.url || '', 'http://127.0.0.1').searchParams
        const starNo = String(q.get('star') || '').replace(/[#,\s]/g, '')
        if (!/^(0|[1-9]\d*)$/.test(starNo)) return err(res, 400, 'mint-offer needs star=N')
        const st = node.star(BigInt(starNo))
        if (!st || !st.contract) return err(res, 404, 'that face has no mint paper')
        const law = node.contract(st.contract)
        if (!law || !isMintPaper(law.code)) return err(res, 400, 'that face is not a mint')
        const taken = Number(law.state && law.state.taken != null ? law.state.taken : 0)
        const max = Number(law.state && law.state.max != null ? law.state.max : 0)
        const open = String((law.state && law.state.open) || '1') === '1'
        return ok(res, {
          ok: true, star: starNo, edition: taken, max, price: String((law.state && law.state.price) || '0'),
          open, soldOut: !(taken < max), hasArt: !!mintShelfOf(starNo),
          cover: st.contentHash ? ('/content/' + st.contentHash) : null,
          note: 'pay the mint — the artist’s file is written on your star. The source URL is not published.',
        })
      }
      if (p === '/api/kraynet/contracts') return ok(res, { contracts: node.contracts() })
      if ((m = p.match(/^\/api\/kraynet\/contract\/(.+)$/))) { const c = node.contract(decodeURIComponent(m[1])); return c ? ok(res, c) : err(res, 404, 'no such contract') }
      if (p === '/health' || p === '/') {
        // B_max (custody doctrine rung 6): a MONITORED pot-size ceiling — the tripwire that keeps
        // "the pot is deliberately tiny" a checked fact, not a hope. Operational (never consensus):
        // breach = loud log + visible here, so any watcher sees the pool outgrowing its doctrine.
        const bmax = Number(process.env.KRAY_POT_BMAX_SATS || 0)
        const held = node.pot().held
        const ceiling = bmax > 0 ? { maxSats: String(bmax), heldSats: String(held), breached: held > BigInt(bmax) } : null
        if (ceiling && ceiling.breached) console.error(`⚠ B_MAX BREACH: the pot holds ${held} sats > ceiling ${bmax} — shrink-the-pot (settle out) before it grows further`)
        return ok(res, { ok: true, network: NET, seq: node.seq, version: 'v2', ...(ceiling ? { potCeiling: ceiling } : {}) })
      }
    }
    // writes
    if (req.method === 'POST') {
      const b = await readBody(req)
      if (b === BODY_TOO_LARGE) { err(res, 413, 'body too large'); return req.destroy() }
      if (b === null) return err(res, 400, 'invalid JSON body')
      // KRAY_PUBLIC_L1_WRITES=1 is the operator's EXPLICIT opt-in to serve the L1 wallet writes
      // (build/finalize/broadcast) on a public TEST-net node (signet lab — friends send from the
      // wallet, behind the per-IP POST rate limiter). Default stays hardened: writes 404 on public.
      if (PUBLIC && process.env.KRAY_PUBLIC_L1_WRITES !== '1' && PUBLIC_L1_OFF.has(p)) return err(res, 404, 'L1 wallet proxy is off on this public node — broadcast from your wallet')
      if (p === '/api/kraynet/status') { await fillMissingAnchorHeights(); return ok(res, statusPayload()) }
      // ADR-3 3b · POST an already-signed act into the mailbox. Stored FIRST (durable, atomic), then
      // tried once through the ONE public door on loopback. A refusal is NOT final here: nonce-gapped
      // or early acts stay pending and the drain loop retries FIFO — only the door ever judges an act.
      if (p === '/api/kraynet/inbox') {
        if (!inbox) return err(res, 404, 'the inbox is off on this node (KRAY_INBOX=0)')
        const took = inbox.accept(b)
        if (!took.ok) return err(res, took.code, took.error)
        if (took.duplicate) {
          const seen = inbox.lookup(took.id).envelope
          return ok(res, { ok: true, id: took.id, duplicate: true, status: took.status, outcome: seen?.outcome ?? null, reason: seen?.reason ?? null })
        }
        try {
          const r = await fetch(`http://127.0.0.1:${PORT}/api/kraynet/submit`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
          })
          const out = await r.json().catch(() => ({}))
          const fate = settleDrainOutcome(took.id, b, r, out)
          if (fate === 'applied') return ok(res, { ok: true, id: took.id, stored: true, applied: true, seq: out.seq, hash: out.hash, ...(out.star != null ? { star: out.star, url: out.url } : {}), cascadeRoot: out.cascadeRoot })
          if (fate === 'superseded') return ok(res, { ok: true, id: took.id, stored: true, applied: false, superseded: true, note: 'the account nonce already advanced past this act — its intent is already in the journal' })
          return ok(res, { ok: true, id: took.id, stored: true, applied: false, lastError: (out && out.error) || `HTTP ${r.status}`, note: 'held in the inbox — the drain loop retries FIFO; poll GET /api/kraynet/inbox/' + took.id })
        } catch (e) {
          inbox.markAttempt(took.id, e instanceof Error ? e.message : String(e))
          return ok(res, { ok: true, id: took.id, stored: true, applied: false, note: 'held in the inbox — the drain loop retries FIFO; poll GET /api/kraynet/inbox/' + took.id })
        }
      }
      // PHASE 2 · submit a beat — a guardian's proof-of-presence for this block. Verified two ways: the PoW
      // (verifyBeat: the hash of beacon‖address‖block‖nonce carries the claimed leading zeros → real compute),
      // and the address's OWN signature over the submission (so only the holder is credited and — via the
      // network check inside verifySignature — value never crosses networks). Accumulated in memory; the seal journals it.
      if (p === '/api/kraynet/beat') {
        const beacon = await currentBeacon()
        if (!beacon) return err(res, 503, 'no Bitcoin beacon yet')
        if (String(b.beacon || '') !== beacon) return err(res, 409, 'stale beacon — GET /api/kraynet/beat/challenge and mine the current one')
        const address = String(b.address || ''), block = Number(b.block), nonce = String(b.nonce ?? ''), zeros = Number(b.zeros)
        const tip = Math.max(0, tipNumber())
        if (!Number.isInteger(block) || block !== tip) return err(res, 409, 'stale block — GET /api/kraynet/beat/challenge and mine the current tip')
        if (!b.signature || !b.publicKey || !verifySignature(address, beatSubmitMessage(beacon, address, block, nonce, zeros), String(b.signature), String(b.publicKey), String(b.scheme || 'kraywallet'), toBtcNet(NET)))
          return err(res, 401, 'a beat must be signed by its own address (the silent miner signature) on this network')
        const work = verifyBeat(beacon, address, { block, nonce, zeros })
        if (work <= 0n) return err(res, 400, 'the beat proves no work — check block, nonce and zeros')
        let book = beatBook.get(beacon); if (!book) { book = new Map(); beatBook.set(beacon, book) }
        let blocks = book.get(address); if (!blocks) { blocks = new Map(); book.set(address, blocks) }
        if (blocks.size && !blocks.has(block)) blocks.clear()   // one moment per address — drop stale indices (F-01)
        const prev = blocks.get(block)
        if (!prev || work > BigInt(prev.work)) blocks.set(block, { nonce, zeros, work: work.toString() })   // a block counts once — keep the best
        // CUSTODY (optional): the atlas-possession proof, verified against THIS node's own atlas. A node holding
        // the challenged content that finds a wrong aggregate has found a LIE and refuses it — only a proof that
        // verifies (or an empty atlas) is stored, so a seal NEVER journals custody this node has not audited.
        let hitsStored = 0
        if (b.custody) {
          let verdict; try { verdict = verifyCustody(custodyFromHex(String(b.custody)), beacon, address, atlasOracle()) } catch (e) { return err(res, 400, `custody proof malformed — ${e.message}`) }
          if (!verdict.exact) return err(res, 400, `custody did not verify against this node's atlas (${verdict.reason || 'mismatch'})`)
          let cbook = custodyBook.get(beacon); if (!cbook) { cbook = new Map(); custodyBook.set(beacon, cbook) }
          cbook.set(address, String(b.custody)); hitsStored = verdict.claimedHits
        }
        persistPresence()
        let total = 0n; for (const x of blocks.values()) total += BigInt(x.work)
        return ok(res, { ok: true, work: work.toString(), spanWork: total.toString(), blocks: blocks.size, custodyHits: hitsStored })
      }
      // only the HOLDER of a Bitcoin L1 ordinal may father an origin child from it —
      // SPV control proof is the law (DEV-TRUST is not ownership). Ord mismatch is a fast 403.
      if ((p === '/api/kraynet/prepare' || p === '/api/kraynet/submit') && b && b.action === 'origin') {
        try { await assertLiveOriginParentage(b.from, [String(b.parentId || '')], b.originProofs) }
        catch (e) { return err(res, 403, e.message) }
      }
      // MULTIPARENT (v3) — every claimed parent must be YOURS, each named in its refusal:
      // KRAY parents by this ledger, L1 origins by SPV (proveParentControl). Refused here
      // WITHOUT a burn; the consensus reducer enforces the same law again.
      if ((p === '/api/kraynet/prepare' || p === '/api/kraynet/submit') && b && b.action === 'inscribe') {
        try { await bindMintArt(b) } catch (e) { return err(res, 400, e instanceof Error ? e.message : String(e)) }
        try { readInscriptionMeta(b) } catch (e) { return err(res, 400, e.message) }
        const mp = multiparentLists(b)
        if (mp) {
          if (b.star != null && String(b.star) !== '') return err(res, 400, 'parents/origins lists ride only on a BIRTH act — not on add-to-existing (star)')
          if (b.parent != null && String(b.parent) !== '') return err(res, 400, 'use EITHER the single parent (v2) or the parents list (v3), never both — one statement of parentage per signature')
          if (mp.parents.length > MAX_PARENTS_PER_ACT) return err(res, 400, `at most ${MAX_PARENTS_PER_ACT} parents per act — the lineage cap is consensus`)
          if (mp.origins.length > MAX_ORIGINS_PER_ACT) return err(res, 400, `at most ${MAX_ORIGINS_PER_ACT} origins per act — the lineage cap is consensus`)
          if (new Set(mp.parents).size !== mp.parents.length || new Set(mp.origins).size !== mp.origins.length) return err(res, 400, 'duplicate parents refused — each parent is claimed once')
          for (const ps of mp.parents) {
            if (!/^(0|[1-9]\d*)$/.test(ps)) return err(res, 400, `"${ps}" is not a star number`)
            const owner = node.ledger.stars.ownerOf(BigInt(ps))
            if (owner == null) return err(res, 404, `parent star #${ps} does not exist`)
            if (owner !== String(b.from) && !isMintFace(ps)) return err(res, 403, `only the owner of star #${ps} can father a child from it`)
          }
          for (const id of mp.origins) {
            if (!ORDINAL_ID_RE.test(id)) return err(res, 400, `"${id}" is not a Bitcoin L1 ordinal id (<txid>iN)`)
          }
          if (mp.origins.length) {
            try { await assertLiveOriginParentage(b.from, mp.origins, b.originProofs) }
            catch (e) { return err(res, 403, e.message) }
          }
        }
      }
      // THE NETWORK DOOR — a write from an address of ANOTHER network is refused before anything else.
      // The ledger's signature check would refuse it anyway (the address cannot derive from any key on
      // this network), but the door names the refusal instead of leaving a hostile client guessing.
      if ((p === '/api/kraynet/prepare' || p === '/api/kraynet/submit' || p === '/api/kraynet/lane-prepare' || p === '/api/kraynet/lane-send') && b && b.from != null && !isAddressOnNetwork(String(b.from), toBtcNet(NET)))
        return err(res, 401, `that address is not a ${NET} address — a ${NET} node writes only for its own network (value never crosses networks)`)
      // PRE-VALIDATE at the door so an invalid/taken name or duplicate content is refused WITHOUT
      // burning 1 ₭ (the ledger still curses it as the consensus backstop for a hostile client).
      if ((p === '/api/kraynet/prepare' || p === '/api/kraynet/submit') && b) {
        if (b.action === 'name') {
          // RAW-BYTE CEILING (mirrors the reducer's NAME_MAX_BYTES gate): isValidName trims
          // padding, so a whitespace-inflated field would pass it — the raw field itself is capped.
          if (Buffer.byteLength(String(b.name ?? ''), 'utf8') > 64) return err(res, 400, 'a name is at most 64 bytes — trim it')
          if (!isValidName(String(b.name ?? ''))) return err(res, 400, 'a name is one plain word — ASCII letters and digits only, no space, dot, @ or bullet')
          if (node.ledger.stars.isNameTaken(String(b.name))) return err(res, 409, 'that name is already taken — a name is written once, forever')
        }
        if (b.action === 'inscribe' && (b.content != null || b.contentHash)) {
          const f = inscribeFields(b)
          if (node.ledger.stars.isContentTaken(f.contentHash)) return err(res, 409, 'that exact content is already inscribed — every byte is unique in the universe')
          if (f.bodyHash && node.ledger.stars.isBodyTaken(f.bodyHash)) return err(res, 409, 'that exact work is already inscribed — the skeleton is unique in the universe')
        }
      }
      if (p === '/api/kraynet/quantum/migrate') {
        // THE QUANTUM ESCAPE HATCH (POST) — rescue a compromised account with a hash-based Lamport signature
        // matching the pre-registered quantum-commit. Authorized by the Lamport key ALONE (no ECC), so it works
        // even after a quantum computer breaks the ECC key. The reducer verifies it with pure hashing.
        if (!b.from || !b.to || !b.lamportPublicKey || !b.lamportSignature) return err(res, 400, 'a quantum-migrate needs {from, to, nonce, lamportPublicKey, lamportSignature}')
        try {
          const ev = node.quantumMigrate(String(b.from), String(b.to), Number(b.nonce) || 0, String(b.lamportPublicKey), String(b.lamportSignature))
          return ok(res, { ok: true, seq: ev.seq, rescued: b.to, cascadeRoot: node.cascadeRoot() })
        } catch (e) { return err(res, 400, 'quantum-migrate refused — ' + (e instanceof Error ? e.message : String(e))) }
      }
      if (p === '/api/kraynet/speak') {
        const parsed = parseSpeakMessage(String(b.message || ''))
        if ('ok' in parsed && parsed.ok === false) return err(res, 400, parsed.reason)
        const living = node.ledger.stars.ownerOf(BigInt(parsed.star))
        if (b.from != null && String(b.from) !== String(living || '')) {
          return err(res, 403, 'only the living owner of this star may speak')
        }
        const verdict = verifySpeak({
          ...parsed,
          message: String(b.message),
          signature: String(b.signature || ''),
          publicKey: String(b.publicKey || ''),
          scheme: b.scheme || 'kraywallet',
        }, living || '', Math.floor(Date.now() / 1000), NET)
        if (!verdict.ok) return err(res, 401, verdict.reason)
        return ok(res, {
          ok: true, spoken: true, fee: '0', journal: false,
          star: parsed.star, owner: parsed.owner, audience: parsed.audience,
          message: verdict.message,
          speakId: speakId(verdict.message),
          note: 'the lock stores speakId — it does not pay the network. Replay the journal to re-derive ownerOf. A paid latch is once_ (1 ₭).',
        })
      }
      if (p === '/api/kraynet/censorship/verify') {
        // ADR-3 3d — evidence only. Same verifier the exams pin. Never appends. Never opens succession.
        // A claim is kilobytes (proofs + parts) — a megabyte body is not a claim, it is a hose.
        try { if (JSON.stringify(b).length > 2 * 1024 * 1024) return err(res, 413, 'a censorship claim is kilobytes — this is not one') } catch { return err(res, 400, 'invalid claim body') }
        const before = node.cascadeRoot()
        let verdict
        try {
          verdict = verifyCensorshipAnchored(b, liveCensorshipRules(), { net: NET, minConfirmations: DONATION_MIN_CONF })
        } catch (e) {
          verdict = { censored: false, reason: 'malformed claim — ' + (e instanceof Error ? e.message : String(e)) }
        }
        if (node.cascadeRoot() !== before) {
          console.error('censorship/verify mutated the cascade — refusing to serve a dirty book')
          return err(res, 500, 'verify must not write — this node froze the response')
        }
        return ok(res, { ...verdict, journal: false, automation: false, cascadeRoot: before })
      }
      if (p === '/api/kraynet/contract-exam') {
        // DRY RUN — same validate + runCall as the reducer. No signature, no journal, no ₭.
        // Mint art URL is writer sidecar — the exam compiles the paper without it.
        try {
          const src = (typeof b.source === 'string') ? b.source
            : (typeof b.code === 'string' ? b.code : null)
          let body = { ...b }
          if (body.form && body.form.kind === 'mint') {
            const { shelf: _shelf, ...form } = body.form
            void _shelf
            body = { ...body, form }
          }
          if (src != null) {
            const parsed = parseExamSource(src)
            if (!parsed.ok) {
              return ok(res, {
                ok: false, ready: false, codeHash: '', code: null,
                checks: [{ id: 'parse', ok: false, kind: 'fail', label: parsed.reason }],
              })
            }
            body = { ...body, code: parsed.code }
          }
          const from = String(body.from || 'KRAYEXAMOWNER')
          const code = readContractCode(body, from, { exam: true })
          return ok(res, examContract(code))
        } catch (e) {
          return ok(res, {
            ok: false, ready: false, codeHash: '', code: null,
            checks: [{ id: 'compile', ok: false, kind: 'fail', label: (e instanceof Error ? e.message : String(e)) }],
          })
        }
      }
      if (p === '/api/kraynet/origin-proof') {
        try {
          if (!b.from) return err(res, 400, 'origin-proof needs {from, parentId, satpoint}')
          const proof = await assembleOriginProofFromBitcoin(String(b.from), b.parentId, b.satpoint)
          return ok(res, { ok: true, proof, parentId: String(b.parentId || '').toLowerCase() })
        } catch (e) { return err(res, 403, e instanceof Error ? e.message : String(e)) }
      }
      // THE LANE PREPARE — the profile's feeless door. Returns the exact domain string + next nonce
      // so HTML never duplicates `tkFoldSendMessage`. No journal write. No state mutation.
      if (p === '/api/kraynet/lane-prepare') {
        try { return ok(res, prepareLaneSend(b)) }
        catch (e) { return err(res, 400, e instanceof Error ? e.message : String(e)) }
      }
      // THE LANE DOOR (TK-fold) — submit one lane transfer to the pool. Feeless BY LAW (the lane has no
      // fee field at all); the fold proof is what carries it into consensus. Signature checked here so
      // a forged act never occupies a slot; the zkVM re-checks it regardless (the door is not trusted).
      if (p === '/api/kraynet/lane-send') {
        const t = { from: String(b.from || ''), to: String(b.to || ''), amount: String(b.amount || ''), nonce: b.nonce, publicKey: String(b.publicKey || ''), signature: String(b.signature || ''), scheme: String(b.scheme || 'kraywallet') }
        const amt = parseLaneAmount(t.amount)
        if (amt === undefined || amt <= 0n) return err(res, 400, 'a lane amount must be a positive canonical decimal within u128 (the canonical-decimal law)')
        if (!Number.isSafeInteger(t.nonce) || t.nonce < 0) return err(res, 400, 'a lane nonce must be a canonical non-negative integer')
        if (t.from === t.to) return err(res, 400, 'a lane transfer needs two different parties')
        if (!isAddressOnNetwork(t.to, toBtcNet(NET))) return err(res, 400, `the receiver is not a ${NET} address — a ${NET} node writes only for its own network`)
        try { assertNotAmmPot(t.to, 'lane-send'); assertNotContractPot(t.to, 'lane-send') }
        catch (e) { return err(res, 400, e instanceof Error ? e.message : String(e)) }
        if (!isSupportedScheme(t.scheme) || !verifySignature(t.from, tkFoldSendMessage(NET, t.from, t.to, amt, t.nonce), t.signature, t.publicKey, t.scheme, toBtcNet(NET)))
          return err(res, 401, 'the signature does not verify over the lane domain')
        lanePrune()
        if (t.nonce < node.ledger.laneNonceOf(t.from)) return err(res, 409, 'that lane nonce already settled — the account moved past it')
        if (lanePool.some((x) => x.from === t.from && x.nonce === t.nonce && x.to === t.to && x.amount === t.amount)) return ok(res, { ok: true, pending: lanePool.length, dedup: true })
        try { assertLaneCovered(t.from, amt) }
        catch (e) { return err(res, 400, e instanceof Error ? e.message : String(e)) }
        if (lanePool.length >= LANE_POOL_MAX) return err(res, 429, 'the lane pool is full — wait for the next fold')
        lanePool.push(t)
        return ok(res, { ok: true, pending: lanePool.length })
      }
      if (p === '/api/kraynet/prepare') {
        try { return ok(res, prepareMessage(b.action, b)) }
        catch (e) { return err(res, 400, (e instanceof Error ? e.message : String(e))) }
      }
      if (p === '/api/kraynet/prepare-batch') { try { return ok(res, await prepareBatch(b)) } catch (e) { return err(res, 400, 'prepare-batch — ' + (e instanceof Error ? e.message : String(e))) } }
      if (p === '/api/kraynet/submit-batch') { try { return ok(res, await submitBatch(b)) } catch (e) { return err(res, 400, 'submit-batch — ' + (e instanceof Error ? e.message : String(e))) } }
      if (p === '/api/kraynet/submit') {
        let r
        try { r = await submitThroughInstantGate(b.action, b) }
        catch (ex) { return err(res, 400, ex instanceof Error ? ex.message : String(ex)) }
        const e = r.e
        const out = { ok: true, seq: e.seq, hash: e.hash, cascadeRoot: node.cascadeRoot() }
        // a creating act (inscribe/name/origin) advances createdSeq — the star delta is measured INSIDE
        // the synchronous apply (applySubmitEvent), so a gate flush of siblings can never cross-report
        if ((b.action === 'inscribe' || b.action === 'name' || b.action === 'origin') && r.star !== undefined) {
          out.star = r.star; out.url = '/star/' + r.star
        }
        if (b.action === 'contract') {
          const view = node.contract(contractAddress(sha256hex(canonicalCode(e.code || b.code)), String(b.from), e.seq))
          if (view) { out.address = view.address; out.rules = view.rules; out.star = view.star || null }
        }
        if (b.action === 'contract-call' && b.contract) {
          const view = node.contract(String(b.contract))
          if (view) out.state = view.state
        }
        return ok(res, out)
      }
      // ── THE WALLET's L1 WRITE (regtest, this node's bitcoind) — broadcast, finalize, build sends ──
      if (p === '/api/wallet/broadcast' || p === '/api/psbt/broadcast') {
        if (!btcConfigured()) return err(res, 501, 'no bitcoind RPC configured')
        if (!b.hex) return err(res, 400, 'broadcast needs {hex}')
        const txid = await btcRpc('sendrawtransaction', [b.hex]).catch((e) => ({ __err: e.message }))
        if (txid && txid.__err) return ok(res, { success: false, error: 'bitcoind refused the tx — ' + txid.__err })
        return ok(res, { success: true, txid })
      }
      if (p === '/api/kraywallet/finalize-psbt') {
        if (!btcConfigured()) return err(res, 501, 'no bitcoind RPC configured')
        if (!b.psbt) return err(res, 400, 'finalize needs {psbt}')
        const psbtB64 = /^[0-9a-fA-F]+$/.test(b.psbt) ? Buffer.from(b.psbt, 'hex').toString('base64') : b.psbt
        const fin = await btcRpc('finalizepsbt', [psbtB64, true]).catch((e) => ({ __err: e.message }))
        if (fin.__err) return ok(res, { success: false, error: 'could not finalize — ' + fin.__err })
        if (!fin.complete || !fin.hex) return ok(res, { success: false, error: 'the PSBT is not fully signed yet' })
        const txid = await btcRpc('sendrawtransaction', [fin.hex]).catch((e) => ({ __err: e.message }))
        // signed ≠ sent — never claim success without a txid Bitcoin accepted
        if (txid && txid.__err) return ok(res, { success: false, hex: fin.hex, broadcast: false, error: 'bitcoind refused the tx — ' + txid.__err })
        return ok(res, { success: true, txid, hex: fin.hex, broadcast: true })
      }
      if (p === '/api/kraywallet/build-send-psbt') {
        if (!btcConfigured()) return err(res, 501, 'no bitcoind RPC configured')
        const from = normalizeAddr(b.fromAddress, NET), to = normalizeAddr(b.toAddress, NET), sats = BigInt(b.amount || '0'), pubkey = b.fromPubkey
        if (!from || !to || !pubkey || sats <= 0n) return err(res, 400, 'build-send-psbt needs {fromAddress, fromPubkey, toAddress, amount}')
        // FAIL-CLOSED coin selection (the donate path's proven guard): cardinalOnly re-derives purity from ord
        // per output and PROTECTS anything it cannot confirm cardinal (ord blip → guarded, never spent). The old
        // enrichedUtxos filter failed OPEN — an ord blip marked an inscription UTXO "pure" and it could be swept.
        const { cardinal, guarded } = await cardinalOnly(await scanUtxos(from))
        if (!cardinal.length) return ok(res, { success: false, error: guarded.some((g) => g.reason === 'unverified') ? 'cannot prove your UTXOs are asset-free right now (indexer unreachable) — try again shortly; a send never spends a coin it cannot prove is pure BTC' : 'no rune/inscription-free BTC UTXOs at this address' })
        const utxos = cardinal.map((u) => ({ txid: u.txid, vout: u.vout, sats: BigInt(u.value), xonly: pubkey }))
        try {
          const dust = dustFromEnv(process.env, 'p2tr')
          let feeSats = feeFor(b, 1, 2)
          let built = buildBtcSendPsbt({ net: NET, from, to, sats, utxos, feeSats, dust })
          const nOut = BigInt(built.change) > 0n ? 2 : 1
          feeSats = feeFor(b, built.inputs, nOut)
          built = buildBtcSendPsbt({ net: NET, from, to, sats, utxos, feeSats, dust })
          return ok(res, { success: true, psbt: built.psbtB64, psbtHex: built.psbtHex, fee: built.fee, feeRate: feeRateOf(b), change: built.change, rbf: true })
        } catch (e) { return ok(res, { success: false, error: e instanceof Error ? e.message : String(e) }) }
      }
      // ── SEND ONE INSCRIPTION — same body/answer contract as the kray-space builder, so the
      // KrayWallet extension works against this node with zero client edits. Input 0 = the inscribed
      // outpoint (postage preserved to the recipient), fee ONLY from ord-proven pure-BTC inputs
      // (fail-closed: unverifiable → refused). The node never sees a key; the wallet signs locally. ──
      if (p === '/api/kraywallet/build-send-inscription-psbt') {
        if (!btcConfigured()) return err(res, 501, 'no bitcoind RPC configured')
        const from = normalizeAddr(b.fromAddress, NET), to = normalizeAddr(b.recipientAddress, NET)
        const iu = b.inscription && b.inscription.utxo
        if (!from || !to || !iu || !iu.txid || iu.vout == null) return err(res, 400, 'build-send-inscription-psbt needs {fromAddress, recipientAddress, inscription:{id, utxo:{txid, vout}}}')
        // inscriptions live on taproot — a keyed/script recipient would strand the sat for this wallet
        if (!scriptOfAddress(to, toBtcNet(NET)).startsWith('5120')) {
          return ok(res, { success: false, code: 'RECIPIENT_MUST_BE_TAPROOT', error: 'the recipient must be a Taproot address on this network' })
        }
        // the outpoint itself, from this node's bitcoind — value and script are chain truth, never client fields
        const txo = await btcRpc('gettxout', [String(iu.txid), Number(iu.vout), true]).catch(() => null)
        if (!txo || !txo.scriptPubKey || !txo.scriptPubKey.hex) return ok(res, { success: false, error: 'that inscription outpoint is unknown or already spent' })
        const inscSats = BigInt(Math.round(Number(txo.value) * 1e8))
        // MIXED-UTXO GATE (fail-closed, ord is the oracle): runes riding the same outpoint would burn
        const o = await ordGet(`/output/${iu.txid}:${iu.vout}`)
        if (!o) return ok(res, { success: false, code: 'MIXED_UTXO_CHECK_FAILED', error: 'cannot verify that outpoint right now (indexer unreachable) — try again shortly' })
        if (o.runes && Object.keys(o.runes).length) return ok(res, { success: false, code: 'MIXED_UTXO_HAS_RUNES', error: 'this inscription UTXO also holds runes — separate the assets first; sending it now would burn them' })
        if (!Array.isArray(o.inscriptions) || !o.inscriptions.length) return ok(res, { success: false, error: 'no inscription lives on that outpoint' })
        if (b.inscription.id && !o.inscriptions.includes(String(b.inscription.id))) return ok(res, { success: false, error: 'that outpoint does not hold the inscription you named — refresh your inscriptions' })
        // fee purse: the donate path's proven guard — pure BTC only, unverifiable UTXOs protected
        const { cardinal, guarded } = await cardinalOnly((await scanUtxos(from)).filter((u) => !(u.txid === iu.txid && u.vout === Number(iu.vout))))
        if (!cardinal.length) return ok(res, { success: false, error: guarded.some((g) => g.reason === 'unverified') ? 'cannot prove your fee UTXOs are asset-free right now (indexer unreachable) — try again shortly' : 'no rune/inscription-free BTC UTXOs to pay the fee at this address' })
        const feeUtxos = cardinal.map((u) => ({ txid: u.txid, vout: u.vout, sats: BigInt(u.value), script: Buffer.from(u.scriptHex, 'hex') }))
        const inscriptionUtxo = { txid: String(iu.txid), vout: Number(iu.vout), sats: inscSats, script: Buffer.from(txo.scriptPubKey.hex, 'hex') }
        try {
          const dust = dustFromEnv(process.env, 'p2tr')
          let feeSats = feeFor(b, 2, 2)
          let built = buildInscriptionSendPsbt({ net: NET, from, to, inscriptionUtxo, feeUtxos, feeSats, dust })
          const nOut = BigInt(built.change) > 0n ? 2 : 1
          feeSats = feeFor(b, built.inputs, nOut)
          built = buildInscriptionSendPsbt({ net: NET, from, to, inscriptionUtxo, feeUtxos, feeSats, dust })
          return ok(res, { success: true, psbt: built.psbtB64, psbtHex: built.psbtHex, fee: Number(built.fee), feeRate: feeRateOf(b), change: Number(built.change), inputCount: built.inputs, rareProtect: null, rbf: true })
        } catch (e) { return ok(res, { success: false, error: e instanceof Error ? e.message : String(e) }) }
      }
      if (p === '/api/runes/build-send-psbt') {
        if (!btcConfigured()) return err(res, 501, 'no bitcoind RPC configured')
        const from = normalizeAddr(b.fromAddress, NET), to = normalizeAddr(b.toAddress, NET), amount = BigInt(b.amount || '0'), pubkey = b.fromPubkey
        if (!from || !to || !pubkey || !b.runeId || amount <= 0n) return err(res, 400, 'runes/build-send-psbt needs {fromAddress, fromPubkey, toAddress, runeId, runeName, amount}')
        const rid = parseRuneKey(b.runeId)
        const runeUtxos = [], feeUtxos = []
        for (const u of await enrichedUtxos(from)) {
          let held = 0n
          if (u.runes) for (const [name, r] of Object.entries(u.runes)) { if (name === b.runeName || name === b.runeId) held += BigInt((r && r.amount != null ? r.amount : r) || 0) }
          if (held > 0n) runeUtxos.push({ txid: u.txid, vout: u.vout, sats: BigInt(u.value), xonly: pubkey, runeAmount: held })
          else if (u.verified && !u.hasRunes && !u.hasInscription) feeUtxos.push({ txid: u.txid, vout: u.vout, sats: BigInt(u.value), xonly: pubkey })   // fail-closed: an ord-unverified UTXO is PROTECTED, never burned as a fee input
        }
        if (!runeUtxos.length) return ok(res, { success: false, error: `no UTXOs hold ${b.runeName || b.runeId} at this address` })
        try {
          const picked = selectRuneCoins(runeUtxos.map((u) => ({
            txid: u.txid, vout: u.vout, amountSats: u.sats, runes: u.runeAmount ?? 0n,
          })), amount)
          const selectedRune = picked.selected.map((c) => runeUtxos.find((u) => u.txid === c.txid && u.vout === c.vout)).filter(Boolean)
          const nRune = selectedRune.length
          const nOut = 4
          let nFee = 1
          let feeSats = feeFor(b, nRune + nFee, nOut)
          const dust = dustFromEnv(process.env, 'p2tr')
          const runeSats = selectedRune.reduce((t, u) => t + u.sats, 0n)
          if (runeSats >= dust * 2n + feeSats + dust) nFee = 0
          feeSats = feeFor(b, nRune + nFee, nOut)
          let built = buildRuneSendPsbt({ net: NET, runeId: rid, amount, to, from, runeUtxos: selectedRune, feeUtxos, feeSats, dust })
          if (built.inputs !== nRune + nFee) {
            feeSats = feeFor(b, built.inputs, nOut)
            built = buildRuneSendPsbt({ net: NET, runeId: rid, amount, to, from, runeUtxos: selectedRune, feeUtxos, feeSats, dust })
          }
          // inputCount tells the wallet exactly which inputs to sign ([0..n-1]) — without it the
          // extension falls back to a guessed 3 and would try to sign a nonexistent input.
          return ok(res, { success: true, psbt: built.psbtB64, psbtHex: built.psbtHex, fee: built.fee, feeRate: feeRateOf(b), runeChange: built.runeChange, inputCount: built.inputs, rbf: true })
        } catch (e) { return ok(res, { success: false, error: e instanceof Error ? e.message : String(e) }) }
      }
      if (p === '/api/kraynet/anchor-pool/offer') {
        // a guardian's SIGNED standing offer to pay anchor fees (supreme law: every user action is a
        // signature). Timestamp-monotonic per address, so a captured offer — especially a sats=0
        // withdrawal — can never be replayed later. Offers move no ₭: they are capacity declarations,
        // never bids (the reward is flat; offering more buys a fair chance, never influence).
        if (!anchorPool) return err(res, 501, 'the anchor backstop is disabled on this node — set KRAY_ANCHOR_POOL=1')
        const address = normalizeAddr(String(b.address || ''), NET)
        let sats; try { sats = BigInt(b.sats ?? '') } catch { return err(res, 400, 'offer needs integer {sats} (0 withdraws the offer)') }
        const at = Number(b.at)
        if (!address || sats < 0n || !Number.isFinite(at)) return err(res, 400, 'offer needs {address, sats ≥ 0, at, signature, publicKey}')
        if (Math.abs(Date.now() - at) > 600_000) return err(res, 400, 'the offer timestamp is stale — sign a fresh one (±10 min)')
        if (at <= (poolOfferAt.get(address) || 0)) return err(res, 409, 'an equal-or-newer signed offer from this address already stands — sign a fresher timestamp')
        if (!b.signature || !verifySignature(address, anchorOfferMessage(address, sats, at), String(b.signature), String(b.publicKey || ''), String(b.scheme || 'kraywallet'), toBtcNet(NET)))
          return err(res, 403, 'the offer must be SIGNED by the offering address — refused')
        anchorPool.offer(address, sats)
        poolOfferAt.set(address, at)
        savePoolState()
        return ok(res, { ok: true, address, sats: sats.toString(), ready: anchorPool.readyCount(ANCHOR_POOL_MIN_FEE) })
      }
      if (p === '/api/kraynet/burn-thaw' && req.method === 'POST') {
        // THE ONE-SHOT THAW (operator rite only) — transmute the pre-law fungible ₭ frozen at the hole into a
        // true burn, Ӿ born to the ORIGINAL senders. The reducer is the real guard (deterministic, once-ever,
        // shape-gated); this door only keeps strangers from pulling the trigger: the raw socket must be
        // loopback AND carry no proxy headers (tunnel traffic always does — a public client can never look
        // like the operator's own curl). Firing it twice is harmless: the reducer refuses with a clean reason.
        const peer = String(req.socket?.remoteAddress || '')
        const rawLoopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1'
        const proxied = !!(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip'])
        if (!rawLoopback || proxied) return err(res, 403, 'the burn-thaw is the operator\'s rite — loopback only, never through the tunnel')
        try {
          const e = node.burnThaw(Date.now())
          return ok(res, { ok: true, seq: e.seq, hash: e.hash, burned: node.ledger.totalBurned.toString(), xEmitted: node.ledger.xEmitted.toString() })
        } catch (e2) { return err(res, 409, e2 instanceof Error ? e2.message : String(e2)) }
      }
      if (p === '/api/kraynet/anchor-pool/claim') {
        // the drawn payer anchored the pending root from their OWN wallet and claims the reward. Every check
        // fail-closed: quiet window elapsed ‖ claimant signed ‖ claimant is the beacon's draw ‖ the tx is
        // SPV-proven to seal EXACTLY the pending (height, root) by the SAME verifySealProof consensus uses
        // (either shape: OP_RETURN or self-anchor output) ‖ the fee is what bitcoind says the tx really paid.
        // The reward is flat, CAPPED AT THE FEE POOL, journaled as a `reward` event — conserved, never minted.
        if (!anchorPool) return err(res, 501, 'the anchor backstop is disabled on this node — set KRAY_ANCHOR_POOL=1')
        const pending = anchorPool.pending
        if (!pending) return err(res, 409, 'no anchor job is pending — nothing to claim')
        if (!poolJobSince || Date.now() - poolJobSince < ANCHOR_POOL_QUIET_MS)
          return err(res, 409, `the quiet window has not elapsed — a donation may still anchor this root for free (wait ${Math.ceil((ANCHOR_POOL_QUIET_MS - (Date.now() - (poolJobSince || Date.now()))) / 1000)}s)`)
        const already = anchorForRoot(pending.root)
        if (already && already.verified) { poolSatisfied(pending.root); return err(res, 409, 'this root is already sealed on Bitcoin — the job is satisfied, no reward is owed') }
        const payer = normalizeAddr(String(b.payer || ''), NET)
        const txid = String(b.txid || '').toLowerCase()
        if (!payer || !/^[0-9a-f]{64}$/.test(txid)) return err(res, 400, 'claim needs {payer, txid, signature, publicKey}')
        if (!b.signature || !verifySignature(payer, anchorClaimMessage(payer, txid, pending.root), String(b.signature), String(b.publicKey || ''), String(b.scheme || 'kraywallet'), toBtcNet(NET)))
          return err(res, 403, 'the claim must be SIGNED by the drawn payer — refused')
        if (!btcConfigured()) return err(res, 501, 'this node has no bitcoind RPC configured — it cannot verify an anchor claim')
        const beacons = await recentBeacons(6).catch(() => [])
        if (!beacons.length) return err(res, 502, 'could not read the Bitcoin beacon — try again')
        if (!beacons.some((bc) => anchorPool.draw(bc, ANCHOR_POOL_MIN_FEE) === payer))
          return err(res, 403, 'this address is not the drawn payer under any recent Bitcoin beacon — the draw is a pure function athe owner boxe recomputes')
        const proof = await spvProofFor(txid, ANCHOR_CONF).catch((e) => ({ __err: e.message }))
        if (proof.__err) return err(res, 400, 'could not fetch the anchor proof from bitcoind — ' + proof.__err)
        const v = verifySealProof(proof, { cascadeRoot: pending.root, blockNumber: pending.height, minConfirmations: ANCHOR_CONF, net: NET })
        if (!v.ok) return err(res, 400, 'anchor claim refused — ' + v.reason)
        let feeSats; try { feeSats = await txFeeSats(txid) } catch (e) { return err(res, 400, 'could not derive the real fee this tx paid — ' + e.message) }
        // the reward the fee pool can HONESTLY pay right now — flat, capped, conserved (never minted)
        const payable = DEFAULT_REWARD.perAnchor < node.feePool() ? DEFAULT_REWARD.perAnchor : node.feePool()
        let s
        try { s = anchorPool.settle(payer, txid, feeSats, pending.root, { perAnchor: payable, maxFeeSats: DEFAULT_REWARD.maxFeeSats }) }
        catch (e) { return err(res, 400, 'anchor claim refused — ' + e.message) }
        poolJobSince = null
        // THE PAYOUT IS RETIRED (2026-08-23, council + adversary): the unsigned `reward` was the last
        // writer-trusted payout — the reducer now refuses it everywhere. The claim still ADOPTS the
        // guardian's seal (the real value: the root is anchored, the window reopens); the payout returns
        // when its self-proving successor exists — first valid sealer, the SPV proof AS the entitlement.
        const rewardSeq = null
        // adopt the guardian's seal into the anchor log so the explorer + sealOf() see this root as anchored
        const st = await readAnchorStatus(txid).catch(() => ({ ok: false }))
        anchors.set(pending.height, { txid, rawHex: null, confirmations: st.ok ? st.confirmations : ANCHOR_CONF, root: pending.root, verified: true, btcHeight: st.ok ? st.btcHeight : null, btcChain: NET, pending: false, real: true, pooled: true, payer })
        saveAnchors(); savePoolState()
        journalSeal(txid, st.ok ? st.btcHeight : undefined, pending.root, pending.height)   // Slice 2c: the guardian's confirmed seal reopens one mint-cap of window (once, ever)
        console.log(`⚓ anchor-pool: guardian ${payer.slice(0, 12)}… anchored root ${pending.root.slice(0, 12)}… (${txid.slice(0, 16)}…) — seal adopted; payout retired (awaits the self-proving successor)`)
        return ok(res, { ok: true, settlement: { jobId: s.jobId, payer: s.payer, txid: s.txid, sats: s.sats.toString(), reward: '0', root: s.root, height: s.height }, rewardSeq, payout: 'retired — the fee pool pays only what the bytes prove; the first-valid-sealer successor will pay anchors', feePool: node.feePool().toString() })
      }
      if (p === '/api/kraynet/regtest/faucet') {
        // Play-sat faucet for the public regtest Funnel only. Signet uses signetfaucet.com;
        // regtest has no public faucet, so this node mines a small UTXO to the tester's bcrt1.
        // Never enabled on signet/main. Rate-limited per IP. Does not mint ₭ (donate still needs a real burn).
        if (NET !== 'regtest') return err(res, 404, 'faucet is only on the regtest node')
        if (!btcConfigured()) return err(res, 501, 'this node has no bitcoind RPC')
        const addr = String(b.address || '').trim()
        if (!/^bcrt1[qp][a-z0-9]{20,}$/i.test(addr)) return err(res, 400, 'regtest faucet needs a bcrt1… address (DevNet Regtest in KrayWallet)')
        const now = Date.now()
        const ip = publicClientIp(req)
        const prev = _regtestFaucetAt.get(ip) || 0
        if (now - prev < 30_000) return err(res, 429, 'faucet cooldown — wait 30s')
        _regtestFaucetAt.set(ip, now)
        try {
          const txid = await btcWalletRpc('sendtoaddress', [addr, 0.01])
          const mineTo = await btcWalletRpc('getnewaddress', [])
          await btcRpc('generatetoaddress', [1, mineTo])
          return ok(res, { ok: true, txid, sats: 1_000_000, mined: 1, net: 'regtest' })
        } catch (e) {
          return err(res, 400, 'faucet refused — ' + (e instanceof Error ? e.message : String(e)))
        }
      }
      if (p === '/api/kraynet/donate/prepare') {
        // Build an UNSIGNED taproot PSBT that pays the pot + commits the donor in an OP_RETURN,
        // funded from the DONOR's OWN UTXOs (the node finds them via its bitcoind — no key, no
        // custody). The wallet signs it (key-path, its normal sign popup); the mint still happens
        // ONLY from the confirmed {txid}, SPV-proven. This just spares the wallet a local indexer.
        if (!POT_ADDRESS) return err(res, 501, 'this node has no anchoring-pot address configured (KRAY_POT_ADDRESS)')
        if (!btcConfigured()) return err(res, 501, 'this node has no bitcoind RPC configured (KRAY_BTC_RPC_PASS)')
        const donor = b.donor, donorPubkey = b.donorPubkey, sats = BigInt(b.sats || '0')
        if (!donor || !donorPubkey || sats <= 0n) return err(res, 400, 'donate/prepare needs {donor, donorPubkey (x-only or compressed hex), sats}')
        // THE DEFICIT GATE — refuse to BUILD a payment that would sacrifice sats the mint cannot honor. In burn
        // mode the sats are destroyed on Bitcoin before the mint applies, so an over-deficit donation would burn
        // the excess for NOTHING. Refuse at build time, with the honest maximum. (Residual race: concurrent
        // in-flight donations near the cap can still land partial by total order — bounded, and absorb refuses
        // any zero-mint outright, so no satoshi is ever taken for nothing at the moment of application.)
        // the per-mint cap (immutable, 10,000 ₭ — MINT_CAP_SATS) is the binding limit; the deficit is a distant secondary ceiling.
        // Refuse an over-cap donation at BUILD time so the donor never signs a burn whose excess mints nothing —
        // the same 10,000 the consensus reducer enforces (this gate is only UX; the reducer is the real law).
        const cap = node.ledger.mintCap
        const deficit = node.pot().deficit
        const mintable = deficit < cap ? deficit : cap
        if (mintable <= 0n) return err(res, 409, 'minting is CLOSED right now — a donation would mint nothing. Try again shortly.')
        if (sats > mintable) return err(res, 409, `a single mint is capped at ${cap} ₭ (anti-whale — split larger amounts across separate donations, each its own anchor). Donate up to ${mintable} sats.`)
        // ROBUSTNESS — indexed UTXO lookup (12-s cache + address indexer) instead of a raw scantxoutset, which
        // walks the WHOLE UTXO set and refuses concurrent scans ("Scan already in progress" hit a real donor).
        // scanUtxos() uses the indexer where one exists and falls back to scantxoutset only where it is cheap.
        const found = await scanUtxos(donor).catch((e) => ({ __err: e instanceof Error ? e.message : String(e) }))
        if (found && found.__err) return err(res, 400, 'could not scan the donor UTXOs — ' + found.__err)
        const allUtxos = (Array.isArray(found) ? found : []).map((u) => ({ txid: u.txid, vout: u.vout, sats: BigInt(u.value), scriptHex: u.scriptHex }))
        if (!allUtxos.length) return err(res, 400, `the donor address holds no confirmed UTXOs — fund ${donor} first`)
        // LEI SUPREMA — a donation is funded ONLY by pure BTC. Drop any UTXO carrying an inscription or rune
        // (fail-closed via ord), so the donor never burns an ordinal/rune to donate — the same law the wallet
        // enforces on every spend. From here on the builder sees the CARDINAL set alone.
        const { cardinal: utxos, guarded } = await cardinalOnly(allUtxos)
        if (!utxos.length) {
          const allUnverified = guarded.length > 0 && guarded.every((g) => g.reason === 'unverified')
          return err(res, allUnverified ? 503 : 409, allUnverified
            ? 'could not verify your UTXOs are pure BTC right now (the ord indexer is unreachable) — try again shortly. A donation never spends a UTXO it cannot prove is asset-free.'
            : `every confirmed UTXO on ${donor} carries an inscription or rune — donating would BURN it. Fund this address with plain BTC, or donate from a pure-BTC address.`)
        }
        // THE FEE, PRICED TO THE LIVE MARKET — a client may pass an explicit {feeRate} (sat/vB, the wallet's
        // slow/medium/high/custom pick); otherwise default to THIS network's current recommended rate, never a
        // flat guess. The builder multiplies it by the tx's real input count, so the donation confirms instead of
        // stranding blocks deep (the first signet donation went in at a flat 1.4 sat/vB and sat 25 blocks back).
        const feeRate = Math.max(1, Math.ceil(Number(b.feeRate) || (await nodeFees()).halfHour || 2))
        // PHASE 3 (gated): pay the pot's internal key tweaked by the CURRENT tip, so the donation output seals the
        // cascade root itself (pay-to-contract). Default OFF → the classic fixed-pot donation below, unchanged.
        if (selfAnchorReady()) {
          const blockNumber = Math.max(0, tipNumber()), rootHex = node.cascadeRoot()
          const payload = KrayAnchor.payload(blockNumber, rootHex)
          const sa = buildSelfAnchorDonationPsbt({ net: NET, potInternalXOnly: POT_INTERNAL_KEY, anchorPayloadHex: payload, donor, donorXOnly: donorPubkey, sats, utxos, feeRate, dust: dustFromEnv(process.env, 'p2tr') })
          return ok(res, { ok: true, psbt: sa.psbtHex, psbtB64: sa.psbtB64, sats: sats.toString(), fee: sa.fee.toString(), change: sa.change.toString(), inputs: sa.inputs, feeRate: sa.feeRate, pot: sa.potAddress, protectedUtxos: guarded.length, selfAnchor: { blockNumber, root: rootHex, keyIsNums: POT_INTERNAL_KEY === BURN_INTERNAL_KEY } })
        }
        const built = buildDonationPsbt({ net: NET, potAddress: POT_ADDRESS, donor, donorXOnly: donorPubkey, sats, utxos, feeRate, dust: dustFromEnv(process.env, 'p2tr') })
        return ok(res, { ok: true, psbt: built.psbtHex, psbtB64: built.psbtB64, sats: sats.toString(), fee: built.fee.toString(), feeRate: built.feeRate, change: built.change.toString(), inputs: built.inputs, pot: POT_ADDRESS, protectedUtxos: guarded.length })
      }
      if (p === '/api/kraynet/donate/broadcast') {
        // finalize the SIGNED PSBT and broadcast it on the node's bitcoind; returns the txid the
        // client then hands to /donate to mint once it confirms. (Accepts PSBT hex or base64.)
        if (!btcConfigured()) return err(res, 501, 'this node has no bitcoind RPC configured (KRAY_BTC_RPC_PASS)')
        if (!b.psbt) return err(res, 400, 'donate/broadcast needs the signed {psbt}')
        const psbtB64 = /^[0-9a-fA-F]+$/.test(b.psbt) ? Buffer.from(b.psbt, 'hex').toString('base64') : b.psbt
        const fin = await btcRpc('finalizepsbt', [psbtB64, true]).catch((e) => ({ __err: e.message }))
        if (fin.__err) return err(res, 400, 'could not finalize the PSBT — ' + fin.__err)
        if (!fin.complete || !fin.hex) return err(res, 400, 'the PSBT is not fully signed yet — the wallet must sign every input')
        // Public Funnel: this is NOT a generic tx relay. The hex must pay THIS node's pot
        // (or a self-anchor output derived from it). Anything else is refused. FAIL CLOSED like
        // its siblings (donate/prepare, the proof path): a node with no pot cannot verify a
        // donation and must NOT degrade into an open sendrawtransaction relay for strangers.
        if (!POT_SCRIPT_HEX) return err(res, 501, 'this node has no anchoring-pot address configured (KRAY_POT_ADDRESS) — it cannot verify or relay a donation')
        {
          let scripts
          try { scripts = parseTx(fin.hex).outputScripts.map((s) => Buffer.from(s).toString('hex')) }
          catch { return err(res, 400, 'could not parse the donation transaction') }
          const paysPot = scripts.includes(POT_SCRIPT_HEX)
          const paysSelfAnchor = !!(selfAnchorReady() && discoverSelfAnchor(fin.hex))
          if (!paysPot && !paysSelfAnchor) return err(res, 400, 'that transaction does not pay this node\'s pot — refused')
        }
        let txid = await btcRpc('sendrawtransaction', [fin.hex]).catch((e) => ({ __err: e.message }))
        if (txid && txid.__err) {
          if (MEMPOOL_API) {
            const viaMempool = await mempoolBroadcast(fin.hex).catch(() => null)
            if (viaMempool) txid = viaMempool
            else return err(res, 400, 'bitcoind refused the donation tx — ' + txid.__err)
          } else return err(res, 400, 'bitcoind refused the donation tx — ' + txid.__err)
        }
        return ok(res, { ok: true, txid })
      }
      if (p === '/api/kraynet/donate') {
        // PRODUCTION — a proof-of-donation: a real Bitcoin payment to the pot, buried under
        // work, committing the donor. SPV-verified here; the sats minted are the on-chain
        // output value (never a client field); credited once by the outpoint (the ledger enforces it).
        // easiest for a client: send only the confirmed {txid} and the node fetches the proof
        // from its own bitcoind and re-proves it. Or send a full {proof} built anywhere.
        // A CLIENT-supplied {proof} is only trustworthy where forging its headers costs real work.
        // On a network with NO proof-of-work floor (regtest/test, MIN_BLOCK_WORK == 0), a proof can be
        // fabricated for free — paying the real pot in a block nobody actually mined — so accepting a
        // client {proof} there would mint UNBACKED ₭ with no signature and no anchor. There the only
        // trustworthy source is the node's OWN bitcoind: send {txid} and it re-proves what is truly buried.
        // A client-supplied {proof} is only trustworthy where forging its headers costs REAL, prohibitive,
        // non-resettable proof-of-work — and that is mainnet ALONE. Signet's blocks are secured by a
        // SIGNATURE (its PoW floor 1<<24 is a few CPU-seconds to forge); testnet's difficulty is resettable
        // to the minimum; regtest has no work at all. SPV-by-work (verifyDonationProof) checks none of those
        // consensus rules, so on any non-mainnet network a client {proof} is forgeable and would mint
        // UNBACKED ₭ up to the whole pot deficit. There the only trustworthy source is the node's OWN
        // bitcoind, which enforced this network's real consensus when it accepted the block: send {txid}.
        // ADR-4 slice 4c — a client-supplied {proof} is NEVER trusted, on any network. verifyDonationProof
        // weighs headers against the network's WORK FLOOR (MIN_BLOCK_WORK, the historical minimum), not the
        // CURRENT difficulty — so even on mainnet a client could forge N floor-difficulty headers for far less
        // than N real blocks of burial, minting ₭ from a "settlement-final" burn that Bitcoin never actually
        // buried that deep. The ONLY trustworthy source is the node's OWN bitcoind (or esplora), which enforced
        // this network's REAL consensus when it accepted the blocks: send the confirmed {txid} and the node
        // re-proves what is truly buried. This is what makes 4c's theorem true — un-burying a credited mint
        // costs out-working N real blocks — on the one network where it matters.
        if (b.proof) {
          return err(res, 400, 'a client-supplied {proof} is never trusted — its headers are weighed against the work FLOOR, not the current difficulty, so they are forgeable below real burial cost. Send the confirmed {txid} and the node re-proves it against its own bitcoind')
        }
        const proof = b.txid ? await spvProofFor(b.txid, DONATION_MIN_CONF).catch((e) => ({ __err: e.message })) : null
        if (proof) {
          if (!POT_SCRIPT_HEX) return err(res, 501, 'this node has no anchoring-pot address configured (KRAY_POT_ADDRESS) — it cannot verify a donation proof')
          if (proof.__err) return err(res, 400, 'could not fetch the donation proof from bitcoind — ' + proof.__err)
          // PHASE 3 (gated): a self-anchoring donation paid the pot's internal key tweaked by (blockNumber, root),
          // so verify against THAT script — a tx that did not pay it simply fails, exactly as a wrong pot would.
          // Default OFF (or no {selfAnchor}) → the classic fixed pot script, byte-identical to before.
          let expectScriptHex = POT_SCRIPT_HEX, sealed = null
          if (selfAnchorReady() && b.selfAnchor && Number.isInteger(b.selfAnchor.blockNumber) && /^[0-9a-f]{64}$/i.test(String(b.selfAnchor.root || ''))) {
            sealed = { blockNumber: b.selfAnchor.blockNumber, root: String(b.selfAnchor.root).toLowerCase() }
            expectScriptHex = selfAnchorScriptHex(POT_INTERNAL_KEY, KrayAnchor.payload(sealed.blockNumber, sealed.root))
          }
          // REDEMPTION RESILIENCE — no client context? The proof is all on Bitcoin: discover which root the
          // donation sealed from the tx bytes alone, so a bare {txid} redeems forever. Discovery only CHOOSES
          // which script to verify against — verifyDonationProof below remains the sole judge of the mint.
          if (!sealed && selfAnchorReady() && proof.rawTx) {
            const foundSeal = discoverSelfAnchor(proof.rawTx)
            if (foundSeal) { sealed = foundSeal; expectScriptHex = selfAnchorScriptHex(POT_INTERNAL_KEY, KrayAnchor.payload(sealed.blockNumber, sealed.root)) }
          }
          const v = verifyDonationProof(proof, { potScriptHex: expectScriptHex, minConfirmations: DONATION_MIN_CONF, net: toBtcNet(NET) })
          if (!v.ok) return err(res, 400, 'donation proof refused — ' + v.reason)
          try { assertNotAmmPot(v.donor, 'donate') } catch (e3) { return err(res, 400, e3.message) }
          // THE LATCH, now a spoken fork (no silent branch): a PLAIN-pot proof attaches under ADR-1 as
          // always; a SELF-ANCHOR proof attaches only when KRAY_CONSENSUS_SELF_ANCHOR_PROOF is on AND the
          // sealed (blockNumber, root) ride the event, so the reducer re-derives the tweaked script instead
          // of HALTing against the fixed pot. Flag OFF (default) ⇒ byte-identical to the old latch.
          const isPlainPot = expectScriptHex === POT_SCRIPT_HEX
          const attachSelfAnchor = !!(CONSENSUS_SELF_ANCHOR_PROOF && sealed && !isPlainPot)
          const attachProof = (CONSENSUS_BURN_PROOF && (isPlainPot || attachSelfAnchor)) ? proof : undefined
          // born strict: the reducer would refuse a proofless mint anyway — refuse HERE, named,
          // before journaling a doomed event. The burn is not lost: the outpoint was never
          // credited, so the same {txid} redeems the mint on a node whose proof flags are on.
          if (PROOF_MANDATORY_LIVE && !attachProof) {
            return err(res, 503, 'this network is born strict — a mint must journal its own SPV proof, but this node\'s proof flags are off (KRAY_CONSENSUS_BURN_PROOF / KRAY_CONSENSUS_SELF_ANCHOR_PROOF). Your burn is safe: the outpoint was never credited; redeem the same {txid} on a correctly configured node')
          }
          const e = node.donate(v.donor, v.sats, 0, v.outpoint, attachProof, (attachProof && attachSelfAnchor) ? sealed : undefined)
          // a self-anchoring donation that sealed a REAL cascade root is a keyless anchor — RECORD it in the
          // self-anchor log (Slice 1). The seal already rides the output on Bitcoin; this makes it a proven,
          // re-verifiable anchor the explorer can show, alongside the operator OP_RETURN anchor.
          if (sealed) {
            let sealHeight = v.btcHeight
            if (!Number.isInteger(sealHeight) || sealHeight <= 0) {
              const st = await readAnchorStatus(String(v.outpoint).split(':')[0])
              if (st.ok && Number.isInteger(st.btcHeight) && st.btcHeight > 0) sealHeight = st.btcHeight
            }
            const [atxid, avout] = String(v.outpoint).split(':')
            recordSelfAnchor(atxid, avout, sealed.blockNumber, sealed.root, v.sats, v.donor, sealHeight)
          }
          const isLiveSeal = !!(sealed && String(sealed.blockNumber) === String(Math.max(0, tipNumber())) && sealed.root === node.cascadeRoot())
          return ok(res, { ok: true, minted: node.pot().minted, seq: e.seq, credited: v.donor, sats: String(v.sats), outpoint: v.outpoint, pot: node.pot(), ...(sealed ? { selfAnchor: { ...sealed, liveSeal: isLiveSeal } } : {}) })
        }
        // DEV shortcut — trust {to, sats} and mint directly. FAIL-CLOSED like the other dev-trust paths:
        // a value-bearing node mints ONLY from a real proof-of-donation. The {to,sats} mint (no signature,
        // no SPV, no anchor — value from a client field) is disabled unless KRAY_TRUSTED_DEV=1, so it can
        // never be reached by default (matching /rune/deposit and /settle — closed-by-default polarity).
        if (!DEV_SHORTCUTS) return err(res, 403, 'this node mints only from a real Bitcoin burn, SPV-proven {proof|txid} — use the KrayWallet extension (Donate). The dev {to, sats} mint is disabled; set KRAY_TRUSTED_DEV=1 only on a throwaway regtest/signet node (never mainnet).')
        try { assertNotAmmPot(b.to, 'donate') } catch (e3) { return err(res, 400, e3.message) }
        const e = node.donate(b.to, BigInt(b.sats)); return ok(res, { ok: true, minted: node.pot().minted, seq: e.seq, pot: node.pot() })
      }
      // ── RUNES L2 — deposit (SPV-proven at ingress; dev accepts the proven fields), send + exit (signed) ──
      if (p === '/api/kraynet/rune/deposit') {
        // THE DEPOSIT, PROVEN — metal on Bitcoin names the credit. One home:
        //   the tx pays THIS node's shared bakery pot. Credit binds to the unique
        //   Taproot spender (parent txs, hash-bound) — never a client field, never the pool key.
        //   `pool: true` from birth. One L1 fee, instantly sendable.
        // The Bitcoin wallet is the vault. A personal L2 pantry is not a deposit path.
        // Shared law: SPV burial, no cenotaph, ord amount, outpoint once, federation custody.
        if (b && b.txid) {
          if (!btcConfigured()) return err(res, 501, 'this node has no bitcoind RPC configured (KRAY_BTC_RPC_PASS) — it cannot SPV-prove an L1 deposit')
          if (!b.runeId) return err(res, 400, 'a proven deposit needs {runeId, txid} — send the runes to the bakery pot (GET /api/kraynet/bridge/params → pot)')
          const rid = parseRuneKey(b.runeId)
          const fed = bridgeFederation()
          if (!fed.configured) return err(res, 501, 'this node has no bridge federation configured — rune deposits are disabled (set KRAY_VAULT_GUARDIANS)')
          const proof = await spvProofFor(b.txid, DONATION_MIN_CONF).catch((e) => ({ __err: e.message }))
          if (proof.__err) return err(res, 400, 'could not fetch the deposit proof from bitcoind — ' + proof.__err)
          let buried
          try { buried = proveTxBuried(proof.rawTx, proof.txoutproof, proof.headers, { net: NET, minConfirmations: DONATION_MIN_CONF }) }
          catch (e) { return err(res, 400, 'the deposit is not buried under enough work — ' + (e instanceof Error ? e.message : String(e))) }
          if (!buried.ok) return err(res, 400, 'the deposit is not buried under enough work — ' + buried.reason)
          const parsed = parseTx(proof.rawTx)
          const art = decipher(parsed.outputScripts.map((s) => Uint8Array.from(s)))
          if (art && art.kind === 'cenotaph') return err(res, 400, 'the deposit runestone is a CENOTAPH — it burned the input runes on L1; there is nothing to credit')
          const hexOf = (s) => Buffer.from(s).toString('hex')
          const alreadyBacks = (outpoint) => vaultWatch.some((w) => w.kind === 'consolidation' && w.outpoint === outpoint)
          const spendsWatchedVault = parsed.inputs.some((inp) => vaultWatch.some((w) => !w.releasedBy && w.outpoint === `${inp.txid}:${inp.vout}`))
          async function runeProofBag(vaultParams, extra) {
            if (!CONSENSUS_RUNE_PROOF) return undefined
            let totalIn = 0n
            for (let oi = 0; oi < parsed.outputScripts.length; oi++) {
              totalIn += await ordOutputRuneAmount(buried.txid, oi, rid).catch(() => 0n)
            }
            const inputRunes = totalIn > 0n ? [{ id: b.runeId, amount: totalIn.toString() }] : []
            const bag = { rawTx: proof.rawTx, txoutproof: proof.txoutproof, headers: proof.headers, vault: vaultParams, inputRunes, ...(extra || {}) }
            // THE KEYSTONE — born strict: the reducer will refuse a deposit without its ancestry
            // bundle, so assemble it here (bytes from our own bitcoind; ord only hints the etch).
            // Assembly failure refuses the deposit at the door with the walker's named reason —
            // the outpoint stays uncredited and redeemable once the ancestry can be walked.
            if (RUNE_ANCESTRY_LIVE) {
              bag.ancestry = await assembleRuneAncestry(buried.txid, b.runeId)
            }
            return bag
          }

          // ── POT FIRST — metal in the bakery names the path, not a client flag ──
          const pool = consolidationVault()
          const potIdx = pool ? parsed.outputScripts.findIndex((s) => hexOf(s) === pool.scriptHex) : -1
          if (potIdx >= 0) {
            if (parsed.outputValues[potIdx] < dustFromEnv(process.env, 'p2tr')) return err(res, 400, 'the pot output is below the dust — it would not have relayed')
            const amount = await ordOutputRuneAmount(buried.txid, potIdx, rid).catch(() => 0n)
            if (amount <= 0n) return err(res, 400, 'ord sees none of that rune at the bakery pot — nothing to credit (per ord, the normative indexer)')
            const depOutpoint = `${buried.txid}:${potIdx}`
            if (alreadyBacks(depOutpoint)) return err(res, 400, 'this outpoint already backs the L2 book — it cannot be deposited again (that would double-count the reserve)')
            if (spendsWatchedVault) return err(res, 400, 'this payment spends a watched vault — that is a rehome or withdraw, not a new deposit')
            const parentTxs = []
            for (const inp of parsed.inputs) {
              if (!inp.txid || inp.txid === '0'.repeat(64)) continue
              const raw = await btcRpc('getrawtransaction', [inp.txid]).catch(() => null)
              if (!raw) return err(res, 400, `could not fetch parent tx ${inp.txid} — the node cannot name who spent into the pot`)
              parentTxs.push(raw)
            }
            const who = creditOfPotDeposit(proof.rawTx, parentTxs, NET)
            if (!who.ok) return err(res, 400, who.reason)
            if (who.address === pool.address) return err(res, 400, 'a pot deposit cannot credit the pot itself — send from your own Taproot wallet')
            const potParams = { guardians: pool.params.guardians, threshold: pool.params.threshold, depositor: pool.params.depositor, timelock: pool.params.timelock }
            let attachRuneProof
            try {
              attachRuneProof = await runeProofBag(potParams, { parentTxs, pool: true })
            } catch (e4) {
              // the ancestry could not be walked — refuse BEFORE a doomed append; nothing was credited
              return err(res, 400, 'the deposit\'s ancestry could not be proven from bytes — ' + (e4 instanceof Error ? e4.message : String(e4)))
            }
            // born strict: a rune credit must journal its own proof — refuse before a doomed append
            if (PROOF_MANDATORY_LIVE && !attachRuneProof) {
              return err(res, 503, 'this network is born strict — a rune deposit must journal its own SPV proof, but KRAY_CONSENSUS_RUNE_PROOF is off on this node. Your runes are safe in the pot: the outpoint was never credited; redeem the same {runeId, txid} on a correctly configured node')
            }
            const ev = node.runeDeposit(b.runeId, depOutpoint, who.address, amount, 0, attachRuneProof, true)
            watchVaultOutpoint({ outpoint: depOutpoint, runeId: b.runeId, vault: pool.address, amount: amount.toString(), depositor: '', kind: 'consolidation', at: Date.now() })
            return ok(res, { ok: true, seq: ev.seq, credited: who.address, amount: amount.toString(), outpoint: depOutpoint, vault: pool.address, pool: true, reserve: node.ledger.runes.reserveOf(rid).toString(), solvent: node.ledger.runesSolvent(), cascadeRoot: node.cascadeRoot() })
          }

          return err(res, 400, 'this tx did not pay the bakery pot (GET /api/kraynet/bridge/params → pot). Your Bitcoin wallet is the vault — send runes to the pot to put them in the shop. A personal L2 pantry is not a deposit path.')
        }
        // FAIL-CLOSED: crediting a rune from raw client fields, with no SPV proof, would mint UNBACKED
        // L2 credits (reserve == credits + locks stays true, so it is invisible to solvency). The
        // field-trust path is DEV-ONLY; a value-bearing node must use the PROVEN {txid} pot path above.
        if (!DEV_SHORTCUTS) return err(res, 403, 'rune deposit needs an SPV proof of the L1 runestone into the bakery pot — send {runeId, txid} (the proven path). The dev field-trust path is disabled; set KRAY_TRUSTED_DEV=1 only on a throwaway regtest/signet node (never mainnet).')
        // production would SPV-prove {runeId, txid} against Bitcoin to derive (outpoint, amount, to);
        // this dev node accepts the already-proven fields directly (like a donation trusts its sats in dev).
        if (b.to == null || b.amount == null) return err(res, 400, 'this dev node needs the proven {runeId, to, amount, outpoint}; live SPV from a raw {txid} needs the Bitcoin/ord bridge')
        try { assertNotAmmPot(b.to, 'rune-deposit') } catch (e3) { return err(res, 400, e3.message) }
        const outpoint = b.outpoint || ((b.txid || sha256hex(String(b.runeId) + '|' + b.to + '|' + b.amount)) + ':0')
        const e = node.runeDeposit(b.runeId, outpoint, b.to, BigInt(b.amount), 0, undefined, b.pool === true)
        return ok(res, { ok: true, seq: e.seq, runes: node.runesOf(b.to) })
      }
      if (p === '/api/kraynet/rune/send') {
        // THE BACKING GATE, AT THE DOOR (always on) — a recipient must never be born a hostage:
        // a send may only hand out credits the SHARED pot already backs on Bitcoin. Credits still
        // backed by a PERSONAL vault stay with the holder (only their key opens that box).
        // Product path: wallet → pot. Rehome is protocol-only (journal replay / leftover recovery).
        try {
          const gateRid = parseRuneKey(String(b.runeId))
          const wanted = BigInt(String(b.amount))
          const free = node.ledger.runes.transferableOf(gateRid, String(b.from))
          if (wanted > free) {
            const pers = node.ledger.runes.personalOf(gateRid, String(b.from))
            return err(res, 400, `this send would hand out credits still backed by a PERSONAL vault (${pers} personal, ${free} transferable) — a recipient must never need your key to reach Bitcoin. Only pot-backed credits are sendable. Deposit new runes to the bakery pot (GET /api/kraynet/bridge/params → pot).`)
          }
          // THE POT, ON BITCOIN — the book cannot see the chain. A send is legal only
          // when the shared pot already holds the metal. 400 at the door, event never applied.
          const potAmt = vaultWatch
            .filter((w) => w.runeId === String(b.runeId) && !w.releasedBy && w.kind === 'consolidation')
            .reduce((t, w) => t + BigInt(w.amount || 0), 0n)
          if (wanted > potAmt) {
            return err(res, 400, `the shared pot does not yet hold enough of this rune on Bitcoin (pot ${potAmt}, send ${wanted}) — deposit to the bakery pot first. The send is refused; the node is not frozen.`)
          }
        } catch (e2) { return err(res, 400, 'could not evaluate the backing gate — ' + e2.message) }
        try { assertNotAmmPot(b.to, 'rune-send') } catch (e3) { return err(res, 400, e3.message) }
        try { assertNotContractPot(b.to, 'rune-send') } catch (e3) { return err(res, 400, e3.message) }
        const base = { from: b.from, nonce: Number(b.nonce), publicKey: b.publicKey, signature: b.signature, scheme: (b.scheme === 'ml-dsa' ? 'ml-dsa' : 'kraywallet'), at: Date.now() }
        const e = node.submit({ ...base, kind: 'rune-send', to: b.to, runeId: b.runeId, amount: String(b.amount), fee: '1' })
        return ok(res, { ok: true, seq: e.seq, cascadeRoot: node.cascadeRoot() })
      }
      if (p === '/api/kraynet/rune/exit') {
        const base = { from: b.from, nonce: Number(b.nonce), publicKey: b.publicKey, signature: b.signature, scheme: (b.scheme === 'ml-dsa' ? 'ml-dsa' : 'kraywallet'), at: Date.now() }
        const e = node.submit({ ...base, kind: 'rune-exit', runeId: b.runeId, amount: String(b.amount), l1Address: b.l1Address, fee: '1' })
        return ok(res, { ok: true, seq: e.seq, cascadeRoot: node.cascadeRoot() })
      }
      if (p === '/api/kraynet/rune/cancel') {
        // WITHDRAW AN OPEN EXIT — the locked credits return untouched. The armed-exit refusal is
        // REDUCER LAW now (rune-lodge journals the arming; the book itself refuses the cancel and
        // replay re-derives it). This door check remains as defense-in-depth with a friendlier 409.
        const armed = [...settlementByOutpoint.values()].some((s) => s.from === b.from && s.runeId === b.runeId && !s.broadcastTxid)
        if (armed) return err(res, 409, 'a pre-signed settlement is armed against this exit — a co-signed settlement cannot be un-signed, so the exit it reconciles cannot be cancelled')
        // a user-funded withdraw already broadcast is the same law: its co-signed payout is on the
        // network and will settle. The reducer refuses the cancel (the lock is armed); this is the
        // friendly 409 that names why before the signed act is even built.
        const paying = exitPayouts.some((r) => r.from === b.from && r.runeId === b.runeId && r.settledSeq == null)
        if (paying) return err(res, 409, 'a withdraw payout for this exit is already broadcast on Bitcoin — it can only settle, not cancel (the runes are on their way to your signed address)')
        const base = { from: b.from, nonce: Number(b.nonce), publicKey: b.publicKey, signature: b.signature, scheme: (b.scheme === 'ml-dsa' ? 'ml-dsa' : 'kraywallet'), at: Date.now() }
        const e = node.submit({ ...base, kind: 'rune-cancel', runeId: b.runeId, fee: '1' })
        return ok(res, { ok: true, seq: e.seq, cascadeRoot: node.cascadeRoot() })
      }
      if (p === '/api/kraynet/rune/exit/payout-psbt') {
        // THE BAKERY-TAB LAST MILE, PHASE A — build the user-funded payout for an OPEN exit.
        // Runes come from the exiter's OWN vault; postage + miner fee come from the exiter's
        // OWN sats (they choose the rate); the destination is the address their rune-exit
        // SIGNED. Nothing here trusts the client: the lock, the vault outpoints, the funding
        // UTXO and every amount are re-read from this node's own bitcoind + ord.
        if (!btcConfigured()) return err(res, 501, 'this node has no bitcoind/ord wired — it cannot build an exit payout')
        const fed = bridgeFederation()
        if (!fed.configured) return err(res, 501, 'this node has no bridge federation configured — exit payouts are disabled')
        if (!b.from || !b.runeId || !b.publicKey || !b.funding || !b.funding.txid) {
          return err(res, 400, 'an exit payout needs {from, runeId, publicKey, feeRate, funding:{txid,vout}}')
        }
        const rid = parseRuneKey(b.runeId)
        const lock = node.ledger.runes.lockedOf(rid, String(b.from))
        if (!lock) return err(res, 400, 'no open exit for that address + rune — sign a rune-exit first (/rune/exit)')
        // anti-spoof: the pubkey must derive the exiting address, exactly as the reducer binds it
        const pub = toXOnly(String(b.publicKey).toLowerCase())
        if (addressOf(pub, toBtcNet(NET)) !== String(b.from)) return err(res, 400, 'the public key does not derive the exiting address')
        const personalParams = { guardians: fed.guardians, threshold: fed.threshold, depositor: pub, timelock: fed.timelock, net: toBtcNet(NET) }
        const personalAddr = deriveVault(personalParams).address
        const pool = consolidationVault()
        async function liveRuneUtxos(entries) {
          const coins = []
          let totalRunes = 0n
          for (const w of entries) {
            const [wtxid, wvout] = w.outpoint.split(':')
            const txo = await btcRpc('gettxout', [wtxid, Number(wvout), true]).catch(() => null)
            if (!txo) continue // spent — the watcher's sweep will name it
            const runes = await ordOutputRuneAmount(wtxid, Number(wvout), rid).catch(() => 0n)
            if (runes <= 0n) continue
            coins.push({
              txid: wtxid, vout: Number(wvout),
              amountSats: BigInt(Math.round(Number(txo.value) * 1e8)), runes,
            })
            totalRunes += runes
          }
          return { coins, totalRunes }
        }
        // Historical personal watch first (old deposits). New Bridge deposits land in the pot,
        // so this is empty and the payout spends the shared bakery — any holder, no hostage.
        const personalWatch = vaultWatch.filter((w) => w.runeId === String(b.runeId) && w.vault === personalAddr && !w.releasedBy && (w.kind || 'vault') === 'vault')
        let path = 'personal', params = personalParams, vaultAddr = personalAddr
        let live = await liveRuneUtxos(personalWatch)
        if (!live.coins.length) {
          const poolWatch = vaultWatch.filter((w) => w.runeId === String(b.runeId) && !w.releasedBy && w.kind === 'consolidation')
          if (!pool || !poolWatch.length) {
            return err(res, 400, 'no watched pot outpoints back this exit — withdraw spends the bakery pot on Bitcoin. Your Bitcoin wallet is the vault; the pot is the shop.')
          }
          live = await liveRuneUtxos(poolWatch)
          path = 'consolidation'
          params = pool.params
          vaultAddr = pool.address
        }
        if (live.totalRunes < BigInt(lock.amount)) return err(res, 400, `the ${path === 'consolidation' ? 'shared pool' : 'vault'} physically holds ${live.totalRunes} of the rune, the lock is ${lock.amount} — cannot pay out more than it carries`)
        let picked
        try { picked = selectRuneCoins(live.coins, BigInt(lock.amount)) }
        catch (e) { return err(res, 400, e.message) }
        const vaultUtxos = picked.selected.map((c) => ({ txid: c.txid, vout: c.vout, amountSats: c.amountSats }))
        const totalRunes = picked.totalRunes
        // the funding UTXO: re-read from bitcoind, and it must be the exiter's OWN key-path P2TR
        const ftxo = await btcRpc('gettxout', [String(b.funding.txid).toLowerCase(), Number(b.funding.vout), true]).catch(() => null)
        if (!ftxo) return err(res, 400, 'the funding utxo does not exist or is already spent')
        const fScript = String(ftxo.scriptPubKey && ftxo.scriptPubKey.hex || '').toLowerCase()
        const ownScript = scriptOfAddress(String(b.from), toBtcNet(NET))
        if (fScript !== ownScript) return err(res, 400, 'the funding utxo must belong to the exiting address — the exiter pays their own postage and fee')
        // no rune may ride the fee input — it would leak into the runestone's allocation
        // FAIL-CLOSED: the fee input must be PURE BTC — ord must positively confirm it carries NO rune AND NO
        // inscription. cardinalOnly guards both and treats an unverifiable output as PROTECTED. The old gate saw
        // only THIS rune and failed OPEN, so an inscription, a second rune, or an ord blip could ride the fee and
        // sweep the asset FOREVER (even with ord fully up, for a different rune / an inscription).
        const { cardinal: fCardinal } = await cardinalOnly([{ txid: String(b.funding.txid).toLowerCase(), vout: Number(b.funding.vout) }])
        if (!fCardinal.length) return err(res, 400, 'the funding utxo must be a pure-BTC output ord confirms carries no rune or inscription — fund the fee with plain sats (if ord is unreachable, try again shortly)')
        const dust = dustFromEnv(process.env, 'p2tr')
        const feeRate = Math.max(1, Math.min(500, Number(b.feeRate) || 1))
        const vsizeEst = estimatePayoutVsize(fed, vaultUtxos.length, 4)
        const feeSats = BigInt(Math.ceil(feeRate * vsizeEst))
        const funding = {
          txid: String(b.funding.txid).toLowerCase(), vout: Number(b.funding.vout),
          amountSats: BigInt(Math.round(Number(ftxo.value) * 1e8)), scriptHex: fScript, internalKey: pub,
        }
        // The initiator's SOLO baseline — one dest, one postage, the historic shape. This is also
        // the floor the loaf may never push the initiator below (their sats change and fee terms
        // must be AT LEAST as good riding a loaf as clicking alone, or the riders are trimmed).
        const soloSatsChange = vaultUtxos.reduce((t, u) => t + u.amountSats, 0n) + funding.amountSats - dust * 2n - feeSats
        const initiatorDestScript = scriptOfAddress(lock.l1Address, toBtcNet(NET))
        let loafDests = null       // [{ from, amount, l1Address, destScriptHex, seq }] — dests[0] = the initiator
        let loafUtxos = vaultUtxos
        let loafTotalRunes = totalRunes
        let loafFeeSats = feeSats
        let loafVsize = vsizeEst
        // ── RUNG 5 · PER-RECIPIENT SETTLEMENT ROUTING (the exit LOAF) ─────────────────────────
        // One pot ceremony pays EVERY other open, compatible exit of this rune too — each
        // recipient on its OWN output, straight to the address their rune-exit SIGNED. The pot
        // sheds N holders per withdraw instead of one; the pot-signer and every guardian bind
        // EACH dest to a holder-signed exit (the writer cannot invent a rider). Flag-gated:
        // KRAY_EXIT_LOAF=1 only after the WHOLE fleet replays the delivery-outpoint settle law
        // (a pre-rung-5 follower would HALT on the second burn of one txid).
        if (EXIT_LOAF && path === 'consolidation' && pool) {
          const takenScripts = new Set([initiatorDestScript, (pool.scriptHex || '').toLowerCase(), ownScript])
          const candidates = []
          for (const l of node.ledger.runes.locksOf(rid)) {
            if (l.address === String(b.from) || l.armed) continue
            if (exitPayouts.some((r2) => r2.from === l.address && r2.runeId === String(b.runeId) && r2.settledSeq == null)) continue
            const ev = signedOpenExit(l.address, String(b.runeId))
            if (!ev) continue
            let ds
            try { ds = scriptOfAddress(l.l1Address, toBtcNet(NET)).toLowerCase() } catch { continue }
            // duplicate dest scripts would make the per-output settle ambiguous — those wait their own click
            if (takenScripts.has(ds)) continue
            takenScripts.add(ds)
            candidates.push({ from: l.address, amount: l.amount, l1Address: l.l1Address, destScriptHex: ds, seq: ev.seq })
          }
          candidates.sort((a2, b2) => a2.seq - b2.seq) // deterministic: oldest signed exit rides first
          const MAX_LOAF = 8
          let members = [{ from: String(b.from), amount: BigInt(lock.amount), l1Address: lock.l1Address, destScriptHex: initiatorDestScript, seq: (signedOpenExit(String(b.from), String(b.runeId)) || {}).seq || 0 }]
          for (const c of candidates) {
            if (members.length >= MAX_LOAF) break
            const trial = [...members, c]
            const amounts = trial.map((t) => BigInt(t.amount))
            if (!batchRunestoneFits(rid, amounts)) break // the 83-byte runestone cap — later exits wait
            const need = amounts.reduce((t2, a3) => t2 + a3, 0n)
            if (need > live.totalRunes) break            // the pot physically holds less — wait
            let sel
            try { sel = selectRuneCoins(live.coins, need) } catch { break }
            const tUtxos = sel.selected.map((c2) => ({ txid: c2.txid, vout: c2.vout, amountSats: c2.amountSats }))
            const tVsize = estimatePayoutVsize(fed, tUtxos.length, trial.length + 3)
            const tFee = BigInt(Math.ceil(feeRate * tVsize))
            const tVaultSats = tUtxos.reduce((t2, u) => t2 + u.amountSats, 0n)
            // the initiator-no-worse law: riders ride on the pot's own sats surplus, never on the
            // initiator's pocket — their sats change must stay ≥ the solo build's. Else stop here.
            const tSatsChange = tVaultSats + funding.amountSats - dust * BigInt(trial.length + 1) - tFee
            if (tSatsChange < soloSatsChange) break
            members = trial
            loafUtxos = tUtxos; loafTotalRunes = sel.totalRunes; loafFeeSats = tFee; loafVsize = tVsize
          }
          if (members.length > 1) loafDests = members
        }
        const plan = {
          runeId: rid, exitAmount: BigInt(lock.amount), totalVaultRunes: loafTotalRunes,
          destScriptHex: initiatorDestScript, destPostage: dust, changePostage: dust,
          satsChangeScriptHex: ownScript, feeSats: loafFeeSats, dust,
          changeScriptHex: (pool && pool.scriptHex) || undefined,
          ...(loafDests ? { dests: loafDests.map((d2) => ({ destScriptHex: d2.destScriptHex, exitAmount: BigInt(d2.amount) })) } : {}),
        }
        const planUtxos = loafDests ? loafUtxos : vaultUtxos
        let payout
        try { payout = buildExitPayout(params, planUtxos, funding, plan) }
        catch (e) { return err(res, 400, e.message) }
        const exitEv = signedOpenExit(String(b.from), String(b.runeId))
        // one signed exit per dest, IN OUTPUT ORDER — the wire the pot-signer + every guardian re-verify
        const exitEvents = loafDests
          ? loafDests.map((d2) => { const e2 = signedOpenExit(d2.from, String(b.runeId)); return e2 ? { ...exitWire(e2), seq: e2.seq } : null })
          : null
        if (loafDests && exitEvents.some((e2) => !e2)) return err(res, 400, 'a loaf member\'s signed exit vanished mid-build — rebuild')
        pendingExitPsbts.set(`${b.from}|${b.runeId}`, {
          payout, vault: vaultAddr, path, at: Date.now(),
          changeKind: pool ? 'consolidation' : 'vault',
          changeVault: (pool && pool.address) || vaultAddr,
          changeVout: payout.changeVout,
          params, vaultUtxos: planUtxos, funding, plan,
          exitEvent: exitEv ? exitWire(exitEv) : null,
          exitSeq: exitEv ? exitEv.seq : null,
          ...(loafDests ? { exitEvents, loafMembers: loafDests.map((d2) => ({ from: d2.from, amount: d2.amount.toString(), l1Address: d2.l1Address, seq: d2.seq })) } : {}),
        })
        return ok(res, {
          ok: true, psbt: payout.psbtBase64, path,
          summary: {
            amount: lock.amount.toString(), l1Address: lock.l1Address,
            postage: dust.toString(), feeSats: loafFeeSats.toString(), feeRate, vsizeEst: loafVsize,
            fundingSats: funding.amountSats.toString(),
            satsChange: (payout.outputs[payout.changeVout + 1] ? payout.outputs[payout.changeVout + 1].amountSats.toString() : '0'),
            runeChange: (loafTotalRunes - (loafDests ? loafDests.reduce((t2, d2) => t2 + BigInt(d2.amount), 0n) : BigInt(lock.amount))).toString(),
            vaultOutpoints: planUtxos.map((u) => `${u.txid}:${u.vout}`),
            fundingIndex: planUtxos.length,
            changeKind: pool ? 'consolidation' : 'vault',
            ...(loafDests ? { loaf: loafDests.map((d2, i2) => ({ vout: i2, from: d2.from, amount: d2.amount.toString(), l1Address: d2.l1Address })) } : {}),
          },
        })
      }
      if (p === '/api/kraynet/rune/exit/payout-submit') {
        // PHASE B — the same ceremony that already worked: Phase A re-read every UTXO from
        // bitcoind+ord (cardinal funding, live pot coins, lock ≤ physical). Here the wallet's
        // funding sig is extracted, the book-checking guardians approve FIRST, then the pot
        // owner (cofre / pot-signer) signs LAST. finalize + lodge + broadcast are unchanged.
        if (!b.from || !b.runeId || !b.psbt) return err(res, 400, 'a payout submit needs {from, runeId, psbt} — the signed PSBT from phase A')
        const pend = pendingExitPsbts.get(`${b.from}|${b.runeId}`)
        if (!pend) return err(res, 400, 'no payout was built for that exit — call /rune/exit/payout-psbt first (a reboot clears drafts; just rebuild)')
        const liveExit = signedOpenExit(String(b.from), String(b.runeId))
        if (!liveExit || liveExit.seq !== pend.exitSeq) return err(res, 400, 'the open exit changed since the payout was built — rebuild')
        const fed = bridgeFederation()
        if (!guardianCosignReady(fed)) return err(res, 501, guardianCosignMissing())
        const walletSignsVault = pend.path !== 'consolidation'
        let sigs
        try { sigs = extractWalletSignatures(pend.payout, String(b.psbt), { walletSignsVault }) }
        catch (e) { return err(res, 400, e.message) }
        // WRITER HYGIENE (custody rung): the lab co-sign is computed ONLY when no remote guardians exist —
        // with KRAY_GUARDIAN_SIGNER_URLS set, the writer's env needs NO guardian secrets at all (they were
        // computed-and-discarded before; now the pen machine can run with zero signing material).
        let perInput = guardianSignerUrls().length ? [] : labCosignPerInput(pend.payout)
        // Books first: each remote re-checks balanceOf against its OWN follower. A book NO holds;
        // unreachable is tolerated up to the threshold. Parallel so the public door does not HTML-502.
        if (guardianSignerUrls().length) {
          const remote = await askGuardians(pend)
          if (!remote.ok) return err(res, 502, 'the book-checking guardians held the withdraw (fail-closed): ' + remote.reason)
          // remote-only: askGuardians already returned exactly `threshold` book-checked shares, so no lab
          // rubber-stamp is ever mixed in — that would defeat the book gate for that guardian slot.
          perInput = mergeGuardianShares(pend.payout, remote.shares, () => null)
        }
        // Owner last — the pot-signer on the cofre signs only after the books approved.
        // authorizePotSign rebuilds the payout and refuses a dest/amount that is not the SIGNED rune-exit.
        if (!walletSignsVault) {
          const signed = await askPotSigner(pend)
          if (!signed.ok) return err(res, 403, signed.reason)
          sigs.depositorSigs = signed.depositorSigs
        }
        let finalTx
        try { finalTx = finalizeExitPayout(pend.payout, perInput, sigs.depositorSigs, sigs.fundingSig) }
        catch (e) { return err(res, 400, e.message) }
        // ── ARM THE LOCK BEFORE A SINGLE BYTE HITS THE NETWORK (the anti-double-claim gate) ──
        // finalizeExitPayout just proved the OWNER co-signed this payout: an unstoppable, co-signed
        // hex now exists. Journal a rune-lodge so the exit becomes UNCANCELLABLE at the reducer AND
        // on replay — exactly as a pre-signed settlement arms. This closes the burst attack: exit →
        // withdraw (broadcast) → cancel before it confirms → claim the runes on L1 while the credits
        // respend on L2. Arming FIRST means a cancel racing the broadcast is already refused by the
        // book. Idempotent: a re-submit after a failed broadcast finds it armed and skips straight on.
        const subRid = parseRuneKey(String(b.runeId))
        const openLock = node.ledger.runes.lockedOf(subRid, String(b.from))
        if (!openLock) return err(res, 400, 'no open exit to pay — nothing to withdraw (it may already have settled)')
        // RUNG 5 — every LOAF member's lock must still be the one the payout was built against:
        // a rider that cancelled/settled/re-exited since the build makes the co-signed hex pay a
        // dest the book no longer owes. Refuse the whole submit BEFORE any arming — rebuild.
        const loafMembers = Array.isArray(pend.loafMembers) ? pend.loafMembers : null
        if (loafMembers) {
          for (const m2 of loafMembers) {
            const l2 = node.ledger.runes.lockedOf(subRid, m2.from)
            const e2 = signedOpenExit(m2.from, String(b.runeId))
            if (!l2 || !e2 || e2.seq !== m2.seq || l2.amount !== BigInt(m2.amount) || l2.l1Address !== m2.l1Address) {
              return err(res, 400, `loaf member ${m2.from.slice(0, 12)}…'s open exit changed since the payout was built — rebuild`)
            }
          }
        }
        // THE POT DOUBLE-DELIVERY GATE — bind the arm to the POT-OUTPOINT SET this payout spends. The
        // pot commingles + coin-selects, so (unlike a personal vault whose single outpoint is spent-in-
        // mempool) a SECOND payout of ONE lock can spend a DIFFERENT pot outpoint and deliver E again —
        // the destination gets 2E for an E lock while the book debits only E (a hidden pot drain). Refuse
        // a distinct pot-spend; ALLOW an idempotent same-outpoint re-broadcast (RBF/liveness). The bound
        // set rides the rune-lodge event's `outpoint`, so a follower re-derives it from the journal alone.
        const spend = (pend.vaultUtxos || []).map((u) => `${u.txid}:${u.vout}`).sort().join(',')
        if (openLock.armed) {
          if ((openLock.boundVault || '') !== spend) return err(res, 409, 'this exit is already armed to a broadcast payout spending different pot outpoints — one exit pays exactly once; re-submit the IDENTICAL payout (same pot outpoints) to retry (RBF)')
        } else {
          try { node.runeLodge(String(b.runeId), String(b.from), spend) }
          catch (e) { return err(res, 400, 'could not arm the exit before payout — ' + e.message) }
        }
        // arm every RIDER to the same pot-outpoint set — a rider's cancel racing this broadcast must
        // already be refused by the book, exactly as the initiator's. Same idempotent re-submit law.
        if (loafMembers) {
          for (const m2 of loafMembers) {
            if (m2.from === String(b.from)) continue
            const l2 = node.ledger.runes.lockedOf(subRid, m2.from)
            if (l2 && l2.armed) {
              if ((l2.boundVault || '') !== spend) return err(res, 409, `loaf member ${m2.from.slice(0, 12)}… is already armed to a different payout — rebuild without them`)
              continue
            }
            try { node.runeLodge(String(b.runeId), m2.from, spend) }
            catch (e) { return err(res, 400, 'could not arm a loaf member before payout — ' + e.message) }
          }
        }
        let txid
        try { txid = await btcRpc('sendrawtransaction', [finalTx.txHex]) }
        catch (e) {
          if (/already in block chain|txn-already|already known|already in the mempool/i.test(e.message || '')) txid = finalTx.txid
          // the lock stays ARMED even on a hard broadcast failure: no double-claim is possible, and
          // the exiter rebuilds + resubmits (RBF, same vault outpoint) to get liveness back. Safety
          // never depends on a broadcast succeeding.
          else return err(res, 400, 'broadcast refused (the exit is now armed and can only settle — rebuild + resubmit to retry) — ' + e.message)
        }
        pendingExitPsbts.delete(`${b.from}|${b.runeId}`)
        const changeVout = pend.changeVout != null ? Number(pend.changeVout) : 2
        exitPayouts.push({
          from: String(b.from), runeId: String(b.runeId), txid: String(txid),
          vault: pend.vault, depositor: pend.payout.params.depositor,
          changeKind: pend.changeKind || 'vault', changeVault: pend.changeVault || pend.vault,
          changeVout,
          ...(loafMembers ? { loaf: true } : {}),
        })
        // one settle record PER RIDER — each lock burns against its OWN delivery outpoint once buried
        if (loafMembers) {
          for (const m2 of loafMembers) {
            if (m2.from === String(b.from)) continue
            exitPayouts.push({ from: m2.from, runeId: String(b.runeId), txid: String(txid), vault: pend.vault, rider: true, loaf: true })
          }
        }
        saveExitPayouts()
        vaultWatch = markReleased(vaultWatch, pend.vaultUtxos.map((u) => `${u.txid}:${u.vout}`), String(txid)); saveVaultWatch()
        try {
          const changeRunes = await watchExitPayoutChange(String(txid), changeVout, String(b.runeId), subRid, {
            changeKind: pend.changeKind, changeVault: pend.changeVault, vault: pend.vault, depositor: pend.payout.params.depositor,
          })
          if (changeRunes > 0n) {
            console.error(`   ⚖ EXIT PAYOUT BROADCAST — ${String(txid).slice(0, 16)}… pays the signed dest; 0-conf pot remainder ${changeRunes} watched at :${changeVout}`)
          } else {
            console.error(`   ⚖ EXIT PAYOUT BROADCAST — ${String(txid).slice(0, 16)}… pays the signed dest; remainder watch waits for ord (sweep retries)`)
          }
        } catch (e) {
          console.error('   ⚖ EXIT PAYOUT BROADCAST — remainder watch deferred (sweep retries):', e.message)
        }
        return ok(res, { ok: true, txid: String(txid), settlesAutomatically: true, minConfirmations: DONATION_MIN_CONF })
      }
      if (p === '/api/kraynet/rune/rehome/psbt') {
        // OPEN THE BAKERY, PHASE A — build the depositor's rehome: ALL the runes their personal
        // vault holds move to the ONE canonical consolidation pot, in one transaction THEY co-sign
        // (owner-first: nobody can rehome athe owner boxe else's box). Not an exit: no credit locks, no
        // credit burns — only the backing's home changes, so everyone they pay stops depending on
        // their living key. Postage + miner fee come from their OWN sats; nothing trusts the client.
        if (!btcConfigured()) return err(res, 501, 'this node has no bitcoind/ord wired — it cannot build a rehome')
        const fed = bridgeFederation()
        if (!fed.configured) return err(res, 501, 'this node has no bridge federation configured — rehomes are disabled')
        const pool = consolidationVault()
        if (!pool) return err(res, 501, 'this node has no consolidation pot configured (KRAY_CONSOLIDATION_KEY) — a rehome needs the shared pot to exist')
        if (!b.from || !b.runeId || !b.publicKey || !b.funding || !b.funding.txid) {
          return err(res, 400, 'a rehome needs {from, runeId, publicKey, feeRate, funding:{txid,vout}}')
        }
        const rid = parseRuneKey(String(b.runeId))
        const pub = toXOnly(String(b.publicKey).toLowerCase())
        if (addressOf(pub, toBtcNet(NET)) !== String(b.from)) return err(res, 400, 'the public key does not derive the rehoming address')
        const persBook = node.ledger.runes.personalOf(rid, String(b.from))
        if (persBook <= 0n) return err(res, 400, 'nothing to rehome — your balance is already pot-backed (the bakery is open); just send')
        if (node.ledger.runes.lockedOf(rid, String(b.from))) return err(res, 400, 'you have an open exit for this rune — settle or cancel it first (a rehome spends the same vault outpoints the payout would)')
        const rhParams = { guardians: fed.guardians, threshold: fed.threshold, depositor: pub, timelock: fed.timelock, net: toBtcNet(NET) }
        const rhVaultAddr = deriveVault(rhParams).address
        const rhWatch = vaultWatch.filter((w) => w.runeId === String(b.runeId) && w.vault === rhVaultAddr && !w.releasedBy && (w.kind || 'vault') === 'vault')
        if (!rhWatch.length) return err(res, 400, 'no watched personal-vault outpoints to rehome — deposit first (or the move already happened)')
        const rhUtxos = []
        let rhTotal = 0n
        for (const w of rhWatch) {
          const [wtxid, wvout] = w.outpoint.split(':')
          const txo = await btcRpc('gettxout', [wtxid, Number(wvout), true]).catch(() => null)
          if (!txo) continue // spent — the watcher's sweep will name it
          const runes = await ordOutputRuneAmount(wtxid, Number(wvout), rid).catch(() => 0n)
          if (runes <= 0n) continue
          rhUtxos.push({ txid: wtxid, vout: Number(wvout), amountSats: BigInt(Math.round(Number(txo.value) * 1e8)) })
          rhTotal += runes
        }
        if (!rhUtxos.length) return err(res, 400, 'your personal vault outpoints are already spent — wait for the sweep to reconcile, then check /rune/backing')
        // funding: the rehomer's OWN plain P2TR sats — same law as a withdraw
        const ftxo = await btcRpc('gettxout', [String(b.funding.txid).toLowerCase(), Number(b.funding.vout), true]).catch(() => null)
        if (!ftxo) return err(res, 400, 'the funding utxo does not exist or is already spent')
        const fScript = String(ftxo.scriptPubKey && ftxo.scriptPubKey.hex || '').toLowerCase()
        const ownScript = scriptOfAddress(String(b.from), toBtcNet(NET))
        if (fScript !== ownScript) return err(res, 400, 'the funding utxo must belong to the rehoming address — you pay your own postage and fee')
        // FAIL-CLOSED: the fee input must be PURE BTC — ord must positively confirm it carries NO rune AND NO
        // inscription. cardinalOnly guards both and treats an unverifiable output as PROTECTED. The old gate saw
        // only THIS rune and failed OPEN, so an inscription, a second rune, or an ord blip could ride the fee and
        // sweep the asset FOREVER (even with ord fully up, for a different rune / an inscription).
        const { cardinal: fCardinal } = await cardinalOnly([{ txid: String(b.funding.txid).toLowerCase(), vout: Number(b.funding.vout) }])
        if (!fCardinal.length) return err(res, 400, 'the funding utxo must be a pure-BTC output ord confirms carries no rune or inscription — fund the fee with plain sats (if ord is unreachable, try again shortly)')
        const dust = dustFromEnv(process.env, 'p2tr')
        const feeRate = Math.max(1, Math.min(500, Number(b.feeRate) || 1))
        const vsizeEst = estimatePayoutVsize(fed, rhUtxos.length, 4)
        const feeSats = BigInt(Math.ceil(feeRate * vsizeEst))
        const funding = {
          txid: String(b.funding.txid).toLowerCase(), vout: Number(b.funding.vout),
          amountSats: BigInt(Math.round(Number(ftxo.value) * 1e8)), scriptHex: fScript, internalKey: pub,
        }
        // the rehome IS an exit-payout shape with dest = the pot and amount = EVERYTHING:
        // same builder, same runestone-safety audit, same signatures — reuse over reinvention
        const plan = {
          runeId: rid, exitAmount: rhTotal, totalVaultRunes: rhTotal,
          destScriptHex: pool.scriptHex, destPostage: dust, changePostage: dust,
          changeScriptHex: pool.scriptHex, satsChangeScriptHex: ownScript, feeSats, dust,
        }
        let payout
        try { payout = buildExitPayout(rhParams, rhUtxos, funding, plan) }
        catch (e) { return err(res, 400, e.message) }
        pendingRehomePsbts.set(`${b.from}|${b.runeId}`, { payout, at: Date.now() })
        return ok(res, {
          ok: true, psbt: payout.psbtBase64, path: 'rehome',
          summary: {
            moving: rhTotal.toString(), pot: pool.address,
            postage: dust.toString(), feeSats: feeSats.toString(), feeRate, vsizeEst,
            fundingSats: funding.amountSats.toString(),
            satsChange: (payout.outputs[3] ? payout.outputs[3].amountSats.toString() : '0'),
            vaultOutpoints: rhUtxos.map((u) => `${u.txid}:${u.vout}`),
            fundingIndex: rhUtxos.length,
          },
        })
      }
      if (p === '/api/kraynet/rune/rehome/submit') {
        // OPEN THE BAKERY, PHASE B — the wallet signed its vault leaf + funding (BIP-371); the lab
        // guardians co-sign, the node broadcasts, and the sweep journals the rune-rehome once the
        // move is buried and provably pays the pot. Nothing locks and nothing burns meanwhile —
        // the gate simply keeps refusing third-party sends until the bakery is provably open.
        if (!b.from || !b.runeId || !b.psbt) return err(res, 400, 'a rehome submit needs {from, runeId, psbt} — the signed PSBT from phase A')
        const pend = pendingRehomePsbts.get(`${b.from}|${b.runeId}`)
        if (!pend) return err(res, 400, 'no rehome was built for that address — call /rune/rehome/psbt first (a reboot clears drafts; just rebuild)')
        const fed = bridgeFederation()
        if (!canLabCosign(fed)) return err(res, 501, 'guardian co-signing runs only where this node holds matching LAB guardian secrets (regtest/signet) — production guardians sign remotely')
        let sigs
        try { sigs = extractWalletSignatures(pend.payout, String(b.psbt)) }
        catch (e) { return err(res, 400, e.message) }
        const perInput = labCosignPerInput(pend.payout)
        let finalTx
        try { finalTx = finalizeExitPayout(pend.payout, perInput, sigs.depositorSigs, sigs.fundingSig) }
        catch (e) { return err(res, 400, e.message) }
        let txid
        try { txid = await btcRpc('sendrawtransaction', [finalTx.txHex]) }
        catch (e) {
          if (/already in block chain|txn-already|already known|already in the mempool/i.test(e.message || '')) txid = finalTx.txid
          else return err(res, 400, 'broadcast refused — ' + e.message)
        }
        pendingRehomePsbts.delete(`${b.from}|${b.runeId}`)
        rehomePayouts.push({ from: String(b.from), runeId: String(b.runeId), txid: String(txid), at: Date.now() })
        saveRehomes()
        console.error(`   ⚖ REHOME BROADCAST — ${String(txid).slice(0, 16)}… moves the personal vault to the pot; the sweep opens the bakery once buried`)
        return ok(res, { ok: true, txid: String(txid), opensAutomatically: true, minConfirmations: DONATION_MIN_CONF })
      }
      if (p === '/api/kraynet/rune/settle') {
        // THE EXIT, PHASE TWO — the co-signed L1 payout is SPV-proven by THIS node against its
        // own bitcoind, then the matching L2 lock BURNS. Easiest for a client: send only
        // {from, runeId, txid}; the node reads the open lock (the SIGNED L1 destination + amount),
        // fetches the payout proof, and refuses unless the runes moved there cleanly — no cenotaph,
        // exactly the locked amount, ≥ dust, buried under work. The ledger credits once by l1Txid.
        if (!b.from || !b.runeId || !b.txid) return err(res, 400, 'a rune settle needs {from, runeId, txid} — the confirmed L1 payout transaction')
        // a LOAF payout (rung 5) settles per delivery outpoint — recognized by this node's own record
        const loafRec = exitPayouts.find((x) => x.txid === String(b.txid).toLowerCase() && x.loaf)
        const r = await proveAndSettleRuneExit(b.from, b.runeId, b.txid, { loaf: !!loafRec })
        if (r.error) return err(res, r.status || 400, r.error)
        return ok(res, r)
      }
      if (p === '/api/kraynet/vault-settlement') {
        // LODGE A PRE-SIGNED SETTLEMENT (opt-in). This is the reflex AND its reconciliation, made sound:
        // the depositor must FIRST have signed a rune-exit of their committed balance to their own L1
        // address (/rune/exit) — which LOCKS that balance, so they can no longer send it away and leave a
        // stale settlement over-promising. The lodged settlement must pay EXACTLY that locked amount to
        // EXACTLY that signed address, and the remainder to consolidation (proven safe). When the watcher
        // later broadcasts it on a drain, the node settles THAT SAME open exit against it (the sacred
        // settle path) — so the depositor's L2 book falls in lockstep with what they received on L1, and
        // solvency (reserve == Σ balances + locks) holds at every step. The signature is the exit's; the
        // proof is SPV; the anchor is the confirmed settlement. Supreme law, all three.
        if (!PRESIGNED_SETTLEMENT) return err(res, 501, 'the pre-signed settlement reflex is off — start the node with KRAY_PRESIGNED_SETTLEMENT=1 to enable it')
        if (!btcConfigured()) return err(res, 501, 'this node has no bitcoind/ord wired — it cannot verify a settlement')
        if (!b.runeId || !b.vault || !b.vault.depositor || !b.outpoint || !b.cosignedTxHex) return err(res, 400, 'a settlement needs {runeId, vault:{guardians,threshold,depositor,timelock}, outpoint, cosignedTxHex}')
        if (!/^[0-9a-f]{64}:\d+$/.test(String(b.outpoint))) return err(res, 400, 'outpoint must be txid:vout')
        const srid = parseRuneKey(b.runeId)
        let svault, sowner
        try {
          svault = deriveVault({ guardians: b.vault.guardians.map(String), threshold: Number(b.vault.threshold), depositor: String(b.vault.depositor), timelock: Number(b.vault.timelock), net: toBtcNet(NET) })
          sowner = addressOf(String(b.vault.depositor), toBtcNet(NET))
        } catch (e) { return err(res, 400, 'the vault params do not derive a vault — ' + (e instanceof Error ? e.message : String(e))) }
        // THE COMMITMENT LOCK — the depositor must already have a signed, OPEN exit. Locking their balance
        // is what forbids the "send more, then fire the old settlement" double-spend: they cannot promise
        // consolidation a share and also spend it. No lock → no lodge.
        const slock = node.ledger.runes.lockedOf(srid, sowner)
        if (!slock) return err(res, 400, 'lodge a settlement only AFTER signing a rune-exit of the committed balance to your own L1 address (/rune/exit) — the exit locks it, so the settlement cannot over-promise')
        // the settlement tx must SPEND the claimed outpoint (parse its own inputs — never a claim)
        let stx
        try { stx = parseTx(b.cosignedTxHex) } catch (e) { return err(res, 400, 'the cosignedTxHex does not parse — ' + (e instanceof Error ? e.message : String(e))) }
        if (!stx.inputs.some((i) => `${i.txid}:${i.vout}` === String(b.outpoint))) return err(res, 400, 'the settlement does not spend the named vault outpoint')
        // the settlement's depositor output MUST be the exact address the exit signed — so when it fires,
        // the sacred settle path recognises it as this exit's payout
        const lockScriptHex = scriptOfAddress(slock.l1Address, toBtcNet(NET))
        if (Buffer.from(stx.outputScripts[0]).toString('hex') !== lockScriptHex) return err(res, 400, 'the settlement must pay its depositor output (0) to the SIGNED exit destination')
        // THE CONSOLIDATION OUTPUT (2) MUST PAY THE NETWORK'S CANONICAL POOL — federation custody the depositor
        // does NOT control. Without this, a depositor routes the remainder (that should back everyone they paid
        // on the L2) to their OWN address. auditSettlementSafety only checks the NUMBERS conserve, not WHERE.
        const conVaultAddr = consolidationVaultAddress()
        if (!conVaultAddr) return err(res, 501, 'this node has no consolidation vault configured (KRAY_CONSOLIDATION_KEY) — the settlement reflex is disabled until the shared pool has a home')
        if (Buffer.from(stx.outputScripts[2] || []).toString('hex') !== scriptOfAddress(conVaultAddr, toBtcNet(NET))) {
          return err(res, 400, 'the settlement consolidation output (2) must pay the network\'s consolidation vault — the remainder that backs everyone the depositor paid cannot go to an address the depositor controls')
        }
        // IT MUST ACTUALLY BE CO-SIGNED. auditSettlementSafety checks the RUNE allocation only; verify the
        // Bitcoin witness is a real cooperative spend (depositor + exactly `threshold` guardian sigs over this
        // tx's own sighash) — else a garbage/empty witness would "arm" a reflex that fails at broadcast time,
        // and the residue theft succeeds against the very protection reported active.
        const [otx, ovout] = String(b.outpoint).split(':')
        let vutxoSats
        try { const raw = await btcRpc('getrawtransaction', [otx, true]); vutxoSats = BigInt(Math.round(Number(raw.vout[Number(ovout)].value) * 1e8)) }
        catch (e) { return err(res, 400, 'could not read the vault outpoint value from bitcoind — ' + (e instanceof Error ? e.message : String(e))) }
        const spendAudit = auditVaultSpend(String(b.cosignedTxHex), { guardians: b.vault.guardians.map(String), threshold: Number(b.vault.threshold), depositor: String(b.vault.depositor), timelock: Number(b.vault.timelock), net: toBtcNet(NET) }, [{ txid: otx, vout: Number(ovout), amountSats: vutxoSats }])
        if (!spendAudit.ok || spendAudit.path !== 'cooperative') return err(res, 400, 'the settlement is not a valid COOPERATIVE co-signed spend — ' + (spendAudit.reason || 'wrong path') + '. A reflex is only armed by a settlement Bitcoin would actually accept.')
        // the REAL rune total the outpoint holds, from ord (never a client number)
        const total = await ordOutputRuneAmount(otx, Number(ovout), srid).catch(() => 0n)
        if (total <= 0n) return err(res, 400, 'ord sees none of that rune at the outpoint — nothing to settle')
        // SAFETY: the depositor keeps EXACTLY the locked amount (not their whole deposit), remainder to
        // consolidation, nothing burned — audited by the same decoder ord uses. Cap = the locked exit.
        const verdict = auditSettlementSafety({ runeId: srid, outputScriptsHex: stx.outputScripts.map((s) => Buffer.from(s).toString('hex')), inputRunes: total, depositorOutput: 0, consolidationOutput: 2, maxDepositorRunes: slock.amount })
        if (!verdict.ok) return err(res, 400, 'the settlement is not safe — ' + verdict.reason)
        if (verdict.depositorGot !== slock.amount) return err(res, 400, `the settlement pays the depositor ${verdict.depositorGot} but the open exit locked ${slock.amount} — they must match exactly, or the reconciliation would not balance`)
        // JOURNAL THE ARMING FIRST (consensus law): the reducer marks this exit uncancellable, so a
        // replay — even one whose settlement sidecar was lost — re-derives the refusal forever. A
        // co-signed hex cannot be un-signed; the journal now knows it. Refused here ⇒ nothing armed.
        node.runeLodge(b.runeId, sowner, String(b.outpoint))
        settlementByOutpoint.set(String(b.outpoint), { runeId: b.runeId, from: sowner, cosignedTxHex: String(b.cosignedTxHex), lockAmount: slock.amount.toString(), total: total.toString(), depositorGot: verdict.depositorGot.toString(), consolidationGot: verdict.consolidationGot.toString(), storedAt: Date.now() })
        saveSettlements()
        return ok(res, { ok: true, outpoint: b.outpoint, vault: svault.address, depositorKeeps: verdict.depositorGot.toString(), consolidation: verdict.consolidationGot.toString(), lockAmount: slock.amount.toString(), reflex: 'armed — the watcher will broadcast this if the vault is drained, then reconcile the locked exit' })
      }
      // /api/kraynet/settle is GONE (2026-08-23): even dev-gated, a body-provided work table was the shape
      // of the retired unsigned reward. The ONLY settlement is settleBeats — the ledger trusts beats, never
      // a handed-in table. (The reducer refuses the `reward` kind everywhere now; this door died with it.)
      if (p === '/api/kraynet/settle') return err(res, 410, 'retired — the fee pool pays only through the self-proving settlement (beats), never a caller-provided table')
    }
    return err(res, 404, `no route for ${req.method} ${p}`)
  } catch (e) {
    return err(res, 400, e instanceof Error ? e.message : String(e))
  }
})

server.listen(PORT, BIND, () => {
  console.log(`KRAYNET listening on http://${BIND}:${PORT}`)
  console.log(`  proofs · burn=${CONSENSUS_BURN_PROOF} rune=${CONSENSUS_RUNE_PROOF} backingGate=${BACKING_GATE} potSigner=${potSignerConfigured() ? 'loopback' : 'local-or-none'}`)
  if (inbox) {
    const st = inbox.status()
    console.log(`  inbox ✓ (ADR-3 3b) — ${st.pending} pending act(s) held from before this boot`)
    // the writer RETURNING is the whole story: drain what the mailbox held through the one door
    setTimeout(() => { drainInbox().then((r) => { if (r.drained) console.log(`  inbox drained ${r.drained} act(s) into the journal`) }).catch(() => {}) }, 3000)
    setInterval(() => { drainInbox().catch(() => {}) }, 60_000)
  }
  // ADR-2 2c-wire — the discovery loop: learn peers from the seed's /peers, verify each against OUR head.
  // The node trusts its own replayed head as authentic, so only same-chain peers survive. Bounded fetch, so a
  // discovered stranger can neither hang nor flood this loop. Off entirely unless seeded (KRAY_PEERS/KRAY_GOSSIP).
  if (GOSSIP_ON) {
    // SSRF guard (council): on a PUBLIC node, a url LEARNED from the mesh may not point at loopback / metadata /
    // RFC1918 — only public hosts. Operator SEEDS (KRAY_PEERS) bypass this (already on the book). A local/dev
    // node (KRAY_PUBLIC unset) keeps loopback discovery so a 127.0.0.1 regtest mesh still works.
    const allowLearned = PUBLIC ? isPublicHttpHost : undefined
    const tick = () => gossipTick(peerBook, { authenticHead: () => node.overview().head, fetchJson: gossipFetchJson, allowLearned })
      .then((v) => { if (v.length) console.log(`  gossip ✓ (ADR-2 2c) — ${v.length} same-chain peer(s) verified`) })
      .catch(() => { /* a bad tick never derails the node */ })
    setTimeout(tick, 4000)
    setInterval(tick, GOSSIP_INTERVAL_MS).unref?.()
    if (!SELF_URL) console.warn('  ⚠ gossip on without KRAY_SELF_URL — this node may discover itself (harmless, wasteful); set it to exclude self')
    console.log(`  gossip on (ADR-2 2c) — seed=${PEER_SEED.length} peer(s), every ${Math.round(GOSSIP_INTERVAL_MS / 1000)}s${PUBLIC ? ' · public-host filter ON' : ''}`)
  }
  // A public node's whole rate-limit model rests on the proxy-trust boundary — announce it loudly
  // so a misconfigured exposure (0.0.0.0 with no fronting proxy) is visible at a glance in the log.
  if (PUBLIC) {
    console.log(`  PUBLIC node · net=${NET} · dev-mint=${DEV_SHORTCUTS ? 'OPEN (regtest faucet)' : 'CLOSED'} · trusting proxy headers from: loopback${TRUST_PROXY_EXTRA.length ? ' + ' + TRUST_PROXY_EXTRA.join(',') : ''}`)
    if (BIND === '0.0.0.0' || BIND === '::') console.warn(`  ⚠ KRAY_BIND=${BIND} — the origin is reachable directly; ensure a firewall admits ONLY the fronting proxy, else set KRAY_BIND=127.0.0.1 (spoofed forwarded-for headers from a direct peer are already ignored, but a direct peer can still hit endpoints by its real IP)`)
  }
})

// ORD SANITY PROBE — a node quietly reading the WRONG-network ord is the subtle failure the Creator
// flagged: rune reads would come from a foreign chain. Cross-check ord's own tip against this node's
// bitcoind; a large gap (or ord unreachable) is logged loudly. Non-blocking, best-effort, once at boot.
;(async () => {
  try {
    const ordH = await ordGetText('/r/blockheight').then((t) => parseInt(String(t).trim(), 10)).catch(() => NaN)
    if (!Number.isFinite(ordH)) { console.error(`⚠ ord at ${ORD_URL} is not answering — rune thumbnails/amounts will be blank until it is reachable (net=${NET})`); return }
    if (btcConfigured()) {
      const btcH = await btcRpc('getblockcount').catch(() => NaN)
      if (Number.isFinite(btcH) && Math.abs(btcH - ordH) > 100) {
        console.error(`⚠ ord tip ${ordH} vs bitcoind tip ${btcH} differ by >100 blocks — is ${ORD_URL} the ${NET} ord? A wrong-network ord reads foreign runes.`)
      } else console.log(`  ord ✓ tip ${ordH} (net=${NET}), in step with bitcoind`)
    } else console.log(`  ord ✓ reachable at tip ${ordH} (net=${NET})`)
  } catch (e) { console.error('ord probe error:', e.message) }
})()
