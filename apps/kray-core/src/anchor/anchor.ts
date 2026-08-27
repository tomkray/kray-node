/**
 * KRAY-CORE — the Bitcoin anchor. "Garrado no Bitcoin" made real.
 *
 * Each sealed KRAY block's CASCADE ROOT (the one consolidated merkle that
 * compiles the whole network — ledger + stars + governance + attestations +
 * chain) is committed to Bitcoin L1 in a single OP_RETURN, so the entire KRAY
 * universe is auditable against the one chain no one controls. The commitment
 * leads with a HUMAN-READABLE professional tag so anyone reading the raw tx on
 * a Bitcoin explorer sees exactly what it is — 49 bytes (well under 80):
 *
 *     OP_RETURN  "KRAY.NETWORK"(12 ascii)  version(1)  blockNumber(4 BE)  cascadeRoot(32)
 *
 * THE PAID BINDING: this 49-byte name already binds every journal act — including
 * a fold-seal's Groth16 body — via cascadeRoot ⊃ laneRoot. The txid does not
 * hold the proof; it names it. See paid-binding.ts.
 *
 * Any node re-compiles the cascade root from the ledger and finds this exact
 * commitment on-chain — the same discipline KRILL uses to seal its ledger root
 * in every burn. This talks ONLY to the network it is pointed at (the isolated
 * KRAY-CORE regtest for tests); it never assumes mainnet.
 */
import type { SealProof } from './spv.ts'

export interface AnchorRpc { url: string; user: string; pass: string; wallet: string }
const TAG = 'KRAY.NETWORK' // 12 bytes, ASCII — shows as text on any Bitcoin explorer
const TAG_HEX = Buffer.from(TAG, 'ascii').toString('hex') // 4b52...
const VERSION = '01' // 1 byte — lets the format evolve without a hard fork
const PUSH = '31' // OP_RETURN push length = 49 bytes (12 + 1 + 4 + 32)
/** v1 height field is big-endian uint32. Past this the codec FAILS CLOSED — it never wraps. */
export const ANCHOR_HEIGHT_MAX = 0xffffffff
export const ANCHOR_VERSION = 1
export const ANCHOR_HEIGHT_BITS = 32

export interface AnchorCommitment { tag: string; version: number; blockNumber: number; root: string }

export class KrayAnchor {
  private readonly cfg: AnchorRpc
  constructor(cfg: AnchorRpc) { this.cfg = cfg }

  private async rpc<T>(method: string, params: unknown[] = [], useWallet = false): Promise<T> {
    const url = useWallet ? `${this.cfg.url}/wallet/${encodeURIComponent(this.cfg.wallet)}` : this.cfg.url
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${this.cfg.user}:${this.cfg.pass}`).toString('base64') },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'anchor', method, params }),
    })
    const j = (await res.json()) as { result: T; error: { message: string } | null }
    if (j.error) throw new Error(`${method}: ${j.error.message}`)
    return j.result
  }

  /** Build the 49-byte OP_RETURN payload committing a block's cascade root.
   *  Leads with the readable "KRAY.NETWORK" tag + version, then blockNumber + root. */
  static payload(blockNumber: number, root: string): string {
    if (!/^[0-9a-f]{64}$/i.test(root)) throw new Error('anchor: root must be 32-byte hex')
    if (blockNumber < 0 || blockNumber > ANCHOR_HEIGHT_MAX) throw new Error('anchor: block number out of range')
    const num = blockNumber.toString(16).padStart(8, '0')
    return TAG_HEX + VERSION + num + root.toLowerCase()
  }

  /** Decode a payload hex (no script prefix) back to its commitment, or null if
   *  it isn't a KRAY.NETWORK anchor. Pure + offline — the auditor's core check. */
  static decode(payloadHex: string): AnchorCommitment | null {
    const p = payloadHex.toLowerCase()
    if (p.length !== 98 || !p.startsWith(TAG_HEX + VERSION)) return null
    return {
      tag: Buffer.from(p.slice(0, 24), 'hex').toString('ascii'),
      version: parseInt(p.slice(24, 26), 16),
      blockNumber: parseInt(p.slice(26, 34), 16),
      root: p.slice(34),
    }
  }

  /** Anchor a block's merkle root to Bitcoin L1. Returns the anchor txid. */
  async anchor(blockNumber: number, merkleRoot: string): Promise<string> {
    const data = KrayAnchor.payload(blockNumber, merkleRoot)
    const raw = await this.rpc<string>('createrawtransaction', [[], [{ data }]], true)
    const funded = await this.rpc<{ hex: string }>('fundrawtransaction', [raw, {}], true)
    const signed = await this.rpc<{ hex: string; complete: boolean }>('signrawtransactionwithwallet', [funded.hex], true)
    if (!signed.complete) throw new Error('anchor: could not sign the anchor tx')
    return this.rpc<string>('sendrawtransaction', [signed.hex])
  }

  /**
   * GATHER THE OFFLINE PROOF of a confirmed seal: the raw tx (txid recomputable),
   * the BIP-37 merkle proof (`gettxoutproof`) and the burying headers. Once this
   * rides the anchor log, ANY replay re-proves the seal with no Bitcoin node at
   * all (spv.ts). Returns null while unconfirmed — a proof of nothing is nothing.
   */
  async fetchSealProof(txid: string): Promise<SealProof | null> {
    try {
      const wtx = await this.rpc<{ hex: string; blockhash?: string; confirmations?: number }>('gettransaction', [txid, true], true)
      if (!wtx.blockhash || !wtx.confirmations || wtx.confirmations <= 0) return null
      const txoutproof = await this.rpc<string>('gettxoutproof', [[txid], wtx.blockhash])
      const contain = await this.rpc<{ height: number }>('getblockheader', [wtx.blockhash])
      const tipN = await this.rpc<number>('getblockcount')
      const upTo = Math.min(tipN, contain.height + 11) // the law needs SEAL_CONFIRMATIONS; a few extra headers, never hundreds
      const headers: string[] = []
      for (let h = contain.height; h <= upTo; h++) {
        const bh = await this.rpc<string>('getblockhash', [h])
        headers.push(await this.rpc<string>('getblockheader', [bh, false]))
      }
      // THE COINBASE, so the proof carries Bitcoin's own statement of WHEN.
      // BIP-34 puts the height in the coinbase's scriptSig, and a merkle path
      // makes it a fact rather than a report — which is what lets the emission
      // law be a clock instead of a number this node happened to mention.
      let coinbaseTx: string | undefined
      let coinbaseProof: string | undefined
      try {
        const blk = await this.rpc<{ tx: string[] }>('getblock', [wtx.blockhash, 1])
        const cbTxid = blk.tx[0]
        coinbaseTx = await this.rpc<string>('getrawtransaction', [cbTxid, false, wtx.blockhash])
        coinbaseProof = await this.rpc<string>('gettxoutproof', [[cbTxid], wtx.blockhash])
      } catch (_) {
        // a proof without the coinbase still proves WHAT was sealed; it simply
        // reads no clock, and the reducer treats that as releasing nothing
      }
      return { rawTx: wtx.hex, txoutproof, headers, ...(coinbaseTx && coinbaseProof ? { coinbaseTx, coinbaseProof } : {}) }
    } catch (_) { return null }
  }

  /** Regtest helper: confirm the anchor by mining a block to the wallet. */
  async confirm(): Promise<void> {
    const addr = await this.rpc<string>('getnewaddress', [], true)
    await this.rpc('generatetoaddress', [1, addr], true)
  }

  /**
   * Read an anchor back FROM Bitcoin — what any auditor runs: fetch the tx,
   * find the OP_RETURN, and decode the committed (blockNumber, merkleRoot).
   */
  async readAnchor(txid: string): Promise<{ blockNumber: number; merkleRoot: string; confirmations: number } | null> {
    // Auditor path first: getrawtransaction covers mempool txs and, on a
    // -txindex node, ANY confirmed tx. A node WITHOUT txindex still audits its
    // own anchors through the wallet that broadcast them (gettransaction →
    // decoderawtransaction) — the decoded commitment is byte-identical either
    // way. If both paths fail, the error propagates (never a silent branch).
    let tx: { confirmations?: number; vout: Array<{ scriptPubKey: { type: string; hex: string } }> }
    try {
      tx = await this.rpc<typeof tx>('getrawtransaction', [txid, true])
    } catch (_) {
      const wtx = await this.rpc<{ hex: string; confirmations?: number }>('gettransaction', [txid], true)
      const dec = await this.rpc<{ vout: Array<{ scriptPubKey: { type: string; hex: string } }> }>('decoderawtransaction', [wtx.hex])
      tx = { confirmations: wtx.confirmations, vout: dec.vout }
    }
    const op = tx.vout.find((v) => v.scriptPubKey.type === 'nulldata')
    if (!op) return null
    // scriptPubKey.hex = 6a (OP_RETURN) + 31 (push 49 bytes) + 98-hex payload
    const m = new RegExp(`^6a${PUSH}([0-9a-f]{98})$`, 'i').exec(op.scriptPubKey.hex)
    if (!m) return null
    const c = KrayAnchor.decode(m[1])
    if (!c) return null
    return { blockNumber: c.blockNumber, merkleRoot: c.root, confirmations: tx.confirmations ?? 0 }
  }
}
