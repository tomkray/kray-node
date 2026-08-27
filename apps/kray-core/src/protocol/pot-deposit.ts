/**
 * POT DEPOSIT — who the L2 credit binds to when metal lands in the SHARED pot.
 *
 * A personal vault bakes the depositor key into the script, so `to` is that key's
 * address. The pot does not: its "depositor" is the network pool key. Crediting
 * that key would mint to the network. Crediting a client-named address would let
 * Bob steal Alice's pot payment.
 *
 * The spender set is read from the proven Bitcoin tx's vin prevouts. Parent txs
 * are bound by hash: each journaled parent must hash to the deposit vin's txid,
 * so a stranger cannot swap Alice's key for Bob's. Exactly one distinct Taproot
 * address may spend into the pot — that address is `to`. Two spenders → refuse
 * (ambiguous). None → refuse (not a wallet we can name).
 */
import { parseTx } from '../anchor/spv.ts'
import { addressOfScript, toBtcNet } from './scheme.ts'

const TAPROOT_RE = /^(bc|tb|bcrt)1p[0-9a-z]{39,87}$/i

export function uniqueTaprootSpender(addresses: string[]): { ok: true; address: string } | { ok: false; reason: string } {
  const set = new Set<string>()
  for (const raw of addresses) {
    const a = String(raw || '').trim().toLowerCase()
    if (!a) continue
    if (!TAPROOT_RE.test(a)) return { ok: false, reason: 'a pot deposit must be spent from a Taproot address — the same key that holds the L2 credit' }
    set.add(a)
  }
  if (set.size === 0) return { ok: false, reason: 'no spender address on the pot-deposit inputs — the node cannot name who to credit' }
  if (set.size > 1) return { ok: false, reason: 'this pot payment has more than one spender — send the runes from one wallet so the credit has one owner' }
  return { ok: true, address: [...set][0] }
}

/**
 * Read every vin prevout's address from the parent txs, bound by hash.
 * Extra parents are ignored (the vins name which ones matter). A missing or
 * unparseable parent, or a prevout this node cannot name, refuses — never invents.
 */
export function spendersFromParentTxs(
  depositRawTx: string,
  parentRawTxs: string[],
  net: string,
): { ok: true; addresses: string[] } | { ok: false; reason: string } {
  const bnet = toBtcNet(String(net))
  let deposit
  try { deposit = parseTx(depositRawTx) } catch {
    return { ok: false, reason: 'the deposit tx did not parse — the spender cannot be named from bytes' }
  }
  const byTxid = new Map<string, ReturnType<typeof parseTx>>()
  for (const raw of parentRawTxs || []) {
    if (!raw) continue
    try {
      const p = parseTx(raw)
      byTxid.set(p.txidDisplay, p)
    } catch {
      return { ok: false, reason: 'a parent tx did not parse — the spender cannot be named from bytes' }
    }
  }
  const addresses: string[] = []
  for (const inp of deposit.inputs) {
    const parent = byTxid.get(inp.txid)
    if (!parent) return { ok: false, reason: `no parent tx for input ${inp.txid}:${inp.vout} — the spender cannot be named` }
    const script = parent.outputScripts[inp.vout]
    if (!script) return { ok: false, reason: `parent ${inp.txid} has no output ${inp.vout}` }
    const addr = addressOfScript(script.toString('hex'), bnet)
    if (!addr) return { ok: false, reason: 'a pot-deposit input is not an address this node can name — send from a Taproot wallet' }
    addresses.push(addr)
  }
  return { ok: true, addresses }
}

/** The one address a pot deposit may credit — unique Taproot spender, from bytes. */
export function creditOfPotDeposit(
  depositRawTx: string,
  parentRawTxs: string[],
  net: string,
): { ok: true; address: string } | { ok: false; reason: string } {
  const spenders = spendersFromParentTxs(depositRawTx, parentRawTxs, net)
  if (!spenders.ok) return spenders
  return uniqueTaprootSpender(spenders.addresses)
}
