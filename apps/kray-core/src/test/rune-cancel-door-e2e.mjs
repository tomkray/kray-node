// THE CANCEL DOOR, THROUGH HTTP — deposit → exit → cancel → re-exit, all via the node's own API.
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { NETWORKS, toBtcNet, _generateKeyPair, _signKrayWallet, _hexToBytes } from './src/protocol/scheme.ts'
const NODE = 'http://127.0.0.1:4499'
const NET = 'regtest', BNET = toBtcNet(NET)
const sk = createHash('sha256').update('cancel-door|alice').digest()
const { publicKeyHex: pk } = _generateKeyPair(sk)
const addr = btc.p2tr(_hexToBytes(pk), undefined, NETWORKS[BNET]).address
const j = async (path, body) => { const r = await fetch(NODE + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}); return r.json() }
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }

// gas + runes (dev shortcuts on this throwaway bench)
await j('/api/kraynet/donate', { to: addr, sats: 100 })
await j('/api/kraynet/rune/deposit', { runeId: '840000:1', outpoint: 'f'.repeat(64) + ':0', to: addr, amount: '1000' })
const prof0 = await j('/api/kraynet/profile/' + addr)
ok(BigInt(prof0.balance) >= 3n, `Alice holds ₭ gas (${prof0.balance})`)

// EXIT via prepare → sign → submit door
const prep1 = await j('/api/kraynet/prepare', { action: 'rune-exit', from: addr, runeId: '840000:1', amount: '1000', l1Address: addr })
const exit1 = await j('/api/kraynet/rune/exit', { from: addr, runeId: '840000:1', amount: '1000', l1Address: addr, nonce: prep1.nonce, publicKey: pk, signature: _signKrayWallet(prep1.message, sk) })
ok(exit1.ok === true, 'EXIT locked 1000 through the door')

// CANCEL — prepare returns the canonical message; sign; submit
const prep2 = await j('/api/kraynet/prepare', { action: 'rune-cancel', from: addr, runeId: '840000:1' })
ok(typeof prep2.message === 'string' && prep2.message.includes('rune-cancel'), `prepare knows rune-cancel (${prep2.message})`)
const can = await j('/api/kraynet/rune/cancel', { from: addr, runeId: '840000:1', nonce: prep2.nonce, publicKey: pk, signature: _signKrayWallet(prep2.message, sk) })
ok(can.ok === true, 'CANCEL accepted through the door')
const runes1 = await j('/api/kraynet/runes/of/' + addr)
ok(JSON.stringify(runes1).includes('1000'), 'the 1000 credits are back and spendable')

// double cancel refused
const prep3 = await j('/api/kraynet/prepare', { action: 'rune-cancel', from: addr, runeId: '840000:1' })
const can2 = await j('/api/kraynet/rune/cancel', { from: addr, runeId: '840000:1', nonce: prep3.nonce, publicKey: pk, signature: _signKrayWallet(prep3.message, sk) })
ok(!!can2.error && /no open exit/.test(can2.error), `double cancel refused (${can2.error})`)

// re-exit works — the road reopens
const prep4 = await j('/api/kraynet/prepare', { action: 'rune-exit', from: addr, runeId: '840000:1', amount: '400', l1Address: addr })
const exit2 = await j('/api/kraynet/rune/exit', { from: addr, runeId: '840000:1', amount: '400', l1Address: addr, nonce: prep4.nonce, publicKey: pk, signature: _signKrayWallet(prep4.message, sk) })
ok(exit2.ok === true, 'RE-EXIT after cancel locked 400 — nothing stranded')
const head = await j('/api/kraynet/head')
console.log(`SEQ=${head.seq} ROOT=${head.cascadeRoot}`)
console.log(fail === 0 ? `ALL ${pass} DOOR CHECKS GREEN` : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
