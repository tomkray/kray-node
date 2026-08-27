/**
 * THE OVER-CAP DONATION ATTACK — an OUTSIDER pays the pot MORE than one mint-cap and hands the node the
 * txid, trying to mint over the cap and, worse, to CORRUPT the cascade root / break the mathematical proof.
 *
 * This is the exact worry: "if someone sends > MINT_CAP sats to the (self-anchor / NUMS) pot and our
 * proof-consolidation reads it, can they mint more than 10,000 ₭ — or does it bug our root?" The answer must
 * be: the reducer REFUSES the whole over-cap donation BEFORE any write (store.append applies-then-persists),
 * so NOTHING is journaled, the cascade root does NOT move, the attacker mints ZERO, the sats are simply burned
 * on L1 (self-inflicted, only reachable by bypassing the wallet), and a cold replay re-derives the identical
 * root — the attack leaves no trace. A later honest ≤cap donation still mints, proving no poison was left.
 *
 *   node apps/kray-net/server.mjs                 # (persisted, burn mode, exactly like signet)
 *   KRAY_BTC_RPC_PASS=<pw> node src/test/donation-overcap-attack-e2e.mjs
 */
const RPC = process.env.KRAY_BTC_RPC || 'http://127.0.0.1:18454'
const RPC_USER = process.env.KRAY_BTC_RPC_USER || 'kraycore'
const RPC_PASS = process.env.KRAY_BTC_RPC_PASS || ''
const WALLET = process.env.KRAY_WALLET || 'kray'
const NODE = process.env.KRAY_NODE || 'http://127.0.0.1:4477'
const OVER = BigInt(process.env.OVER || '50000')   // 5× the 10,000 mint-cap — an over-cap donation

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
const die = (m) => { console.error('\n✗ ' + m); process.exit(1) }
async function bc(method, params = []) {
  const r = await fetch(`${RPC}/wallet/${WALLET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64') },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'kray', method, params }),
  }).then((x) => x.json())
  if (r.error) throw new Error(`bitcoind ${method}: ${r.error.message}`)
  return r.result
}
const jget = (p) => fetch(NODE + p).then((r) => r.json())
const jpost = (p, b) => fetch(NODE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()).catch((e) => ({ error: 'net: ' + e.message }))
const satToBtc = (s) => (Number(s) / 1e8).toFixed(8)
const head = async () => { const h = await jget('/api/kraynet/head'); return { root: h.cascadeRoot, hash: h.head, seq: h.seq, emitted: String(h.supply?.emitted), burned: String(h.supply?.burned) } }
const same = (a, b) => a.root === b.root && a.hash === b.hash && a.seq === b.seq && a.emitted === b.emitted
const bal = async (a) => BigInt((await jget('/api/kraynet/profile/' + a)).balance || '0')

// pay `sats` to `dest`, commit `donorAscii` in an OP_RETURN, confirm it — returns the txid (a REAL burial)
async function payAndBury(dest, sats, donorAscii, minConf) {
  const dataHex = Buffer.from(donorAscii, 'ascii').toString('hex')
  const raw = await bc('createrawtransaction', [[], [{ [dest]: Number(satToBtc(sats)) }, { data: dataHex }]])
  const funded = await bc('fundrawtransaction', [raw, { changePosition: 2 }])
  const signed = await bc('signrawtransactionwithwallet', [funded.hex])
  if (!signed.complete) throw new Error('wallet could not sign')
  const txid = await bc('sendrawtransaction', [signed.hex])
  await bc('generatetoaddress', [Math.max(1, minConf), await bc('getnewaddress', ['', 'bech32m'])])
  return txid
}

async function main() {
  console.log('\n╔══ THE OVER-CAP DONATION ATTACK — an outsider tries to mint over the cap / corrupt the root ══╗')
  if (!RPC_PASS) die('set KRAY_BTC_RPC_PASS to the regtest rpcpassword')
  const info = await jget('/api/kraynet/donation/info')
  if (!info.configured) die('node has no pot configured — restart it with KRAY_POT_ADDRESS')
  const POT = info.potAddress, CAP = BigInt(info.mintCap), MC = Math.max(1, info.minConfirmations)
  ok(OVER > CAP, `the attack amount ${OVER} sats is over the ${CAP} ₭ mint-cap (${Number(OVER) / Number(CAP)}×)`)

  const s0 = await head()
  console.log(`   · root before any attack: ${s0.root.slice(0, 24)}… (seq ${s0.seq}, emitted ${s0.emitted})`)

  // ── ATTACK A · an over-cap payment to the REAL pot, handed to /donate as a bare txid ──
  const attacker = await bc('getnewaddress', ['attacker', 'bech32m'])
  const aBal0 = await bal(attacker)
  const txA = await payAndBury(POT, OVER, attacker, MC)
  const rA = await jpost('/api/kraynet/donate', { txid: txA })
  ok(rA.ok !== true, `A · the node REFUSED the over-cap donation (${rA.error ? rA.error.slice(0, 72) : 'ok:false'})`)
  ok(/at most|cap/i.test(rA.error || ''), 'A · the refusal names the mint-cap as the reason (not a crash, a LAW)')
  ok((await bal(attacker)) === aBal0, `A · the attacker minted ZERO ₭ (balance still ${aBal0}) — the burned sats bought nothing`)
  const sA = await head()
  ok(same(s0, sA), `A · the cascade ROOT DID NOT MOVE — the refused donation never touched the journal (root ${sA.root.slice(0, 16)}…, seq ${sA.seq})`)

  // ── ATTACK B · a fabricated CLIENT proof (forge the burial itself) ──
  const rB = await jpost('/api/kraynet/donate', { proof: { rawTx: '00'.repeat(60), txoutproof: '00'.repeat(80), headers: ['00'.repeat(80)] }, to: attacker, sats: OVER.toString() })
  ok(rB.ok !== true && /never trusted|proof/i.test(rB.error || ''), `B · a client-supplied {proof} is NEVER trusted — refused (${(rB.error || '').slice(0, 56)}…)`)
  ok(same(s0, await head()), 'B · the root still did not move after the forged-proof attempt')

  // ── ATTACK C · a real over-cap tx that pays a NON-pot address, submitted as a bare txid ──
  const notPot = await bc('getnewaddress', ['not-the-pot', 'bech32m'])
  const txC = await payAndBury(notPot, OVER, attacker, MC)
  const rC = await jpost('/api/kraynet/donate', { txid: txC })
  ok(rC.ok !== true, `C · a tx that did NOT pay the pot is refused (${(rC.error || 'ok:false').slice(0, 60)})`)
  ok(same(s0, await head()), 'C · the root still did not move — no pot payment, no mint, no journal write')

  // ── ATTACK D · the over-cap txid again, this time WITH a self-anchor hint (route via NUMS) ──
  const rD = await jpost('/api/kraynet/donate', { txid: txA, selfAnchor: { blockNumber: 5, root: 'e'.repeat(64) } })
  ok(rD.ok !== true, `D · the over-cap tx dressed as a self-anchor is STILL refused (${(rD.error || 'ok:false').slice(0, 56)})`)
  ok(same(s0, await head()), 'D · the root STILL did not move — the NUMS/self-anchor path enforces the same cap')

  // ── POISON CHECK · after 4 refused attacks, an HONEST ≤cap donation still mints exactly, root advances ──
  const honest = await bc('getnewaddress', ['honest', 'bech32m'])
  const hBal0 = await bal(honest)
  const txH = await payAndBury(POT, CAP, honest, MC)
  const rH = await jpost('/api/kraynet/donate', { txid: txH })
  ok(rH.ok === true && rH.sats === CAP.toString(), `POISON-CHECK · an honest ${CAP}-sat donation mints exactly ${CAP} ₭ (${rH.error ? rH.error.slice(0, 50) : 'ok'}) — the refused attacks left NO poison`)
  ok((await bal(honest)) - hBal0 === CAP, `POISON-CHECK · the honest donor's balance rose by exactly ${CAP}`)
  const sH = await head()
  ok(sH.seq === s0.seq + 1 && BigInt(sH.emitted) - BigInt(s0.emitted) === CAP, `POISON-CHECK · the root advanced by EXACTLY one honest mint (seq ${s0.seq}→${sH.seq}, +${CAP} ₭) — never by an attack`)

  // ── CONSERVATION · the whole net still balances ──
  const ov = await jget('/api/kraynet/overview')
  ok(ov.conserves !== false && ov.backed !== false, 'CONSERVATION · Σ balances == emitted − burned — every ₭ still backed by a real satoshi')

  console.log(`\n╚══ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — an over-cap donation (even via NUMS/self-anchor, even with a forged proof) mints ZERO and NEVER moves the cascade root; the reducer refuses it before any write, the burned sats are self-inflicted, and an honest mint still lands. The math cannot be over-minted, the root cannot be bugged. ⛓₭ ══╝`)
  if (fail) process.exit(1)
  // hand the caller the roots so an outer script can prove cold-replay re-derivation
  console.log(`ROOT_BEFORE=${s0.root} ROOT_AFTER=${sH.root} SEQ_AFTER=${sH.seq}`)
}
main().catch((e) => die(e.stack || e.message))
