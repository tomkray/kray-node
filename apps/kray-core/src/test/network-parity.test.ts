/**
 * VALUE NEVER CROSSES NETWORKS — a recipient or a credited donor must be an address on the node's OWN
 * Bitcoin network. The signer's own address is already network-bound by its signature; this proves the
 * addresses NObody signs (a transfer's `to`, a donation's donor) are REFUSED when they belong to a
 * different network, while same-network addresses and the protocol's own KRAY_ labels pass — and a
 * refused act leaves no trace, so conservation never bends.
 *
 *   node src/test/network-parity.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import { DEFAULT_POT_TARGET_SATS } from '../protocol/pot.ts'
import { NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes, transferMessage } from '../protocol/scheme.ts'
import { BLACK_HOLE, type KrayEvent } from '../protocol/kray-primitives.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const refuses = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — did NOT refuse') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}

type BNet = 'main' | 'signet' | 'regtest'
function wallet(net: BNet, tag: string) {
  const sk = createHash('sha256').update(net + '|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS[net]).address!, sk, pk: publicKeyHex }
}

const NET = 'signet'
let seq = 0

function main() {
  console.log('\n╔═ VALUE NEVER CROSSES NETWORKS — the recipient/donor must be on THIS network ═╗\n')
  // this exam is about the NETWORK wall, not the peg — lift proof-mandatory (born strict on the
  // real signet) so the funding donate stays a bare fixture; proof-mandatory.test.ts pins that law.
  const L = new KrayLedger(DEFAULT_POT_TARGET_SATS, NET, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, Number.MAX_SAFE_INTEGER)

  const A = wallet('signet', 'A')             // a real signet holder — it signs
  const tb1 = wallet('signet', 'B').addr      // same-network recipient
  const bcrt1 = wallet('regtest', 'X').addr   // WRONG network (regtest)
  const bc1 = wallet('main', 'Y').addr        // WRONG network (mainnet)
  ok(A.addr.startsWith('tb1') && tb1.startsWith('tb1') && bcrt1.startsWith('bcrt1') && bc1.startsWith('bc1') && !bc1.startsWith('bcrt1'),
    `fixtures span three networks: signet ${A.addr.slice(0, 7)}…, regtest ${bcrt1.slice(0, 8)}…, mainnet ${bc1.slice(0, 6)}…`)

  // ── 1 · a DONATION credits a donor — it must be a signet address ────────────
  L.applyLive({ seq: ++seq, kind: 'donate', hash: 'h' + seq, to: A.addr, amount: '10000' } as KrayEvent)
  ok(L.balanceOf(A.addr) === 10_000n, 'donation to a signet donor mints 10,000 ₭ (within the 10k per-mint cap)')
  refuses(() => L.applyLive({ seq: seq + 1, kind: 'donate', hash: 'hx', to: bcrt1, amount: '10000' } as KrayEvent),
    /not a signet address|cross Bitcoin networks/, 'donation crediting a regtest (bcrt1) donor is REFUSED')
  refuses(() => L.applyLive({ seq: seq + 1, kind: 'donate', hash: 'hy', to: bc1, amount: '10000' } as KrayEvent),
    /not a signet address|cross Bitcoin networks/, 'donation crediting a mainnet (bc1) donor is REFUSED')

  // ── 2 · a TRANSFER moves ₭ — the recipient must be a signet address ─────────
  // Signet is BORN ACTIVE (v1.0.0 genesis reset): every signed act carries an integer `at`, and
  // each act here gets a DISTINCT instant so time (not the same-instant window) orders them.
  const xfer = (to: string, nonce: number): KrayEvent => {
    const msg = transferMessage(NET, A.addr, to, 10n, nonce)
    return { seq: ++seq, kind: 'transfer', hash: 'x' + seq, at: 1_000 + seq, from: A.addr, to, amount: '10', fee: '1', nonce, publicKey: A.pk, signature: _signKrayWallet(msg, A.sk), scheme: 'kraywallet' } as KrayEvent
  }
  L.applyLive(xfer(tb1, 0))
  ok(L.balanceOf(tb1) === 10n, 'transfer to a signet recipient moves 10 ₭')
  // the signature is perfectly valid — it is the RECIPIENT's network that refuses it
  refuses(() => L.applyLive(xfer(bcrt1, 1)), /not a signet address/, 'transfer to a regtest (bcrt1) recipient is REFUSED (valid signature notwithstanding)')
  refuses(() => L.applyLive(xfer(bc1, 1)), /not a signet address/, 'transfer to a mainnet (bc1) recipient is REFUSED')

  // ── 3 · THE BURN LAW is born active on the new signet: fungible ₭ can NEVER be frozen at the
  //    hole — only the signed `burn` destroys ₭ (minting Ӿ 1:1). The old chain allowed one pre-law
  //    hole-credit; the reborn signet refuses it from block zero, exactly like main. ──
  refuses(() => L.applyLive(xfer(BLACK_HOLE, 1)), /cannot be frozen — only burned/, 'fungible ₭ aimed at the black hole is REFUSED from genesis (the burn law, born active)')
  ok(L.balanceOf(BLACK_HOLE) === 0n, 'the hole holds no fungible ₭ — stars only, forever')

  // ── 4 · the refused acts left NO trace ──────────────────────────────────────
  ok(L.balanceOf(bcrt1) === 0n && L.balanceOf(bc1) === 0n, 'not one ₭ reached a wrong-network address')
  ok(L.conserves(), 'conservation holds — a refused act mutates nothing')

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — value stays on its own Bitcoin network, always. ⛓₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
