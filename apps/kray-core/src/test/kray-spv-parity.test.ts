/**
 * KRAY-SPV PARITY — one algorithm, two runtimes, byte-identical forever.
 *
 * The browser verifier (apps/kray-net/kray-spv.mjs, WebCrypto + Uint8Array) must reach the EXACT same
 * verdict as the consensus SPV (apps/kray-core/src/anchor/spv.ts, node:crypto + Buffer) on the same bytes —
 * otherwise a page could show a green ✓ the node's own law would reject, or refuse a real seal. This feeds
 * both the SAME real vectors (a buried regtest self-anchor donation + real signet/mainnet headers) and
 * asserts identical results across parseTx, verifyTxOutProof, checkProofOfWork, targetFromBits/workOfTarget,
 * extractKraySeal and the whole proveTxBuried burial. This is what makes the in-browser recompute trustable.
 *
 *   node src/test/kray-spv-parity.test.ts     (offline — the vectors are embedded)
 */
import * as spv from '../anchor/spv.ts'
import * as web from '../../../kray-net/kray-spv.mjs'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('   ✓ ' + m) } else { fail++; console.log('   ✗ FAIL — ' + m) } }
// canonical form: Buffer/Uint8Array → hex, bigint → string, so two runtimes' outputs compare exactly
const canon = (v: unknown): unknown => {
  if (typeof v === 'bigint') return 'big:' + v.toString()
  if (v instanceof Uint8Array) return 'hex:' + Buffer.from(v).toString('hex')
  if (Buffer.isBuffer(v)) return 'hex:' + v.toString('hex')
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') { const o: Record<string, unknown> = {}; for (const k of Object.keys(v as object).sort()) o[k] = canon((v as Record<string, unknown>)[k]); return o }
  return v
}
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

// ── real vectors (collected from the live chain, embedded so the test is offline) ──
const REGTEST_TXID = '28c00a9a2c53461c24cd104c2b5a9de03acecd2be159fe3a0e63dcfe9f7acd81'
const REGTEST_RAWTX = '02000000000101c04c548b94ac43e409c868c6ba957bfa8ffc479caa7802cd5dd329a30b2df0d70000000000fdffffff0310270000000000002251205d7a6d6c6ab9ba0d80ab90eaafa80f71ab36d68fedfa559c40725a1bf8e14ece0000000000000000426a406263727431706a387466617a64386d676739306e717334746865366675756e366c6c387539323263376d667a707a6b366b706c70386c73716d7371357a667268d67707000000000022512091d69e89a7da1057cc10aaef9d279c9ebff3f0aa563db48822b6ac1f84ff80370141cf07b1e1c56fd590079b734d557d42a1e0ecf753def5e0a1840f6cac8bcc7653a043c8c1726c311b8a365b8bab6308908ada702b5deedad779816d3fd69cbb430100000000'
const REGTEST_PROOF = '00000020da6a596ec10f1ab90267423e06e4f45fb2f6f6860f0e4a7d3a8f15dafc59bd16a9f149e0607bfb12a3d8c8c364aab5d2e2f771e2159bdf7e7f599aef4a0b0c0a6574806affff7f200000000002000000027d17e9132847ea38af517048ad5a86418e6ad264d6b36c037bab584ff0027f5981cd7a9ffedc630e3afe59e12bcdce3ae09d5a2b4c10cd241c46532c9a0ac0280105'
const REGTEST_HEADERS = ['00000020da6a596ec10f1ab90267423e06e4f45fb2f6f6860f0e4a7d3a8f15dafc59bd16a9f149e0607bfb12a3d8c8c364aab5d2e2f771e2159bdf7e7f599aef4a0b0c0a6574806affff7f2000000000', '000000205f7245c8702f9d9220ea876e262cb9f8ed238b1f2868edeca19092f8ff202b569e4d39162c80eabaf81b7710f413cb63d576638abe122a87265904d6abf2c5186874806affff7f2000000000', '00000020ba4fcf193878d717baf51c95a4f845e36c3ff21d26ce4ddb428f1dc9a85cf66e2758e5941ca99132b38ab0102014abfad36a1decb48354e52d849275bcaa73a91075806affff7f2001000000']
const SIGNET_RAWTX = '020000000001029b0684c8bc0fcd59f2a3ad179c9838432f9dcba0b45fe3b5b51a35a62d7c56410100000000fdffffff8927459afa6930555d5970ae7613b6988d5c1cd2ae473b33dbe190e0714bd24b0000000000fdffffff0310270000000000002251209f49316420751f5853ca970b01d9ddfb117a4a3d537b3e4a48cb5b4a72fe045c0000000000000000406a3e7462317076646c33346e766574777363786877706b7a3267336d387132706c75706e6c6e367368633537706666666c3539366137357374717538326433775c21000000000000225120637f1acd995ba1835dc1b09488ece0507fc0cff3d42f8a78294a7f42ebbea41601418961f555f90d3bdd6cb074fe0c50e9972a36e966eea9c5ca481f8d3615aad07e0ebb7d4f697baa6440ed44e6ac7466b594fcf995dbd8ca0b518e6b30cdc20b060101419909598154d278006380e2076f758e7238132f982457cc5b376d7ffe71f8f87aa66aece874512bd58e12cda1fc728eddb28e37057915d1b6f064a580bcb2eade0100000000'
const SIGNET_HEADER = '00000020b1889adcf16b794359faa1090ec482934cc8f9afa1f27184b5f4f17d030000006a002c703e81f35b75ae9229b3cbc50006bf976a57b73c05736f00a742c01e6cc47c806a9f6a141d35460100'
const MAIN_HEADER = '0040de2bd9a0ecb0312faac28b9157729194c2d85174553fa8630000000000000000000031199a7bd465733f580b59793a0b92cae5475bda58ccc23dee995e816f3697bc9383806a3d3502177aa08ef8'

async function main() {
  console.log('\n╔══ KRAY-SPV PARITY — the browser verifier and the consensus SPV must agree byte-for-byte ══╗')

  console.log('\n── targetFromBits + workOfTarget (a range of nBits, incl. invalid) ──')
  for (const bits of [0x1d00ffff, 0x1e0377ae, 0x207fffff, 0x1b0404cb, 0x18009645, 0x00800000, 0x03000000, 0x21010000, 0xff123456]) {
    const t1 = spv.targetFromBits(bits), t2 = web.targetFromBits(bits)
    ok(same(t1, t2), `targetFromBits(0x${bits.toString(16)}): ${t1 === null ? 'null' : 'big'} — identical`)
    ok(same(spv.workOfTarget(t1 ?? 0n), web.workOfTarget(t2 ?? 0n)), `  workOfTarget → identical`)
  }

  console.log('\n── checkProofOfWork (regtest / signet / mainnet real headers) ──')
  for (const [hdr, net] of [[REGTEST_HEADERS[0], 'regtest'], [SIGNET_HEADER, 'signet'], [MAIN_HEADER, 'main']] as [string, string][]) {
    const a = spv.checkProofOfWork(hdr, net), b = await web.checkProofOfWork(hdr, net)
    ok(same(a, b), `checkProofOfWork(${net}): ok=${a.ok} work=${a.work} — identical (${a.ok ? 'meets target' : a.reason})`)
  }
  // a tampered header (flip a byte) must fail identically on both
  const bad = 'ff' + SIGNET_HEADER.slice(2)
  ok(same(spv.checkProofOfWork(bad, 'signet'), await web.checkProofOfWork(bad, 'signet')), `checkProofOfWork(tampered signet) — both refuse identically`)

  console.log('\n── parseTx (segwit-stripped txid, scripts, values, inputs) ──')
  for (const [raw, label] of [[REGTEST_RAWTX, 'regtest self-anchor'], [SIGNET_RAWTX, 'signet ignition']] as [string, string][]) {
    const a = spv.parseTx(raw), b = await web.parseTx(raw)
    ok(same(a, b), `parseTx(${label}): txid ${a.txidDisplay.slice(0, 16)}… + ${a.outputScripts.length} outputs — identical`)
  }
  ok(spv.parseTx(REGTEST_RAWTX).txidDisplay === REGTEST_TXID, `parseTx txid == the real on-chain txid (${REGTEST_TXID.slice(0, 16)}…)`)

  console.log('\n── extractKraySeal (a self-anchor tx carries NO classic OP_RETURN seal → null, on both) ──')
  ok(same(spv.extractKraySeal(REGTEST_RAWTX), await web.extractKraySeal(REGTEST_RAWTX)), `extractKraySeal(self-anchor) → null on both (no KRAY.NETWORK OP_RETURN)`)

  console.log('\n── verifyTxOutProof (BIP-37 merkle + CVE-2012-2459 guard) ──')
  const p1 = spv.verifyTxOutProof(REGTEST_PROOF), p2 = await web.verifyTxOutProof(REGTEST_PROOF)
  ok(same({ root: p1.header.merkleRootDisplay, txids: p1.provenTxids, pos: p1.positions, hh: p1.headerHex }, { root: p2.header.merkleRootDisplay, txids: p2.provenTxids, pos: p2.positions, hh: p2.headerHex }), `verifyTxOutProof: root + provenTxids + positions — identical`)
  ok(p1.provenTxids.includes(REGTEST_TXID), `the proof proves the real txid`)

  console.log('\n── proveTxBuried (the whole burial: txid ∈ merkle → header chain → weighed work → depth) ──')
  const opt = { net: 'regtest', minConfirmations: 1 }
  const v1 = spv.proveTxBuried(REGTEST_RAWTX, REGTEST_PROOF, REGTEST_HEADERS, opt)
  const v2 = await web.proveTxBuried(REGTEST_RAWTX, REGTEST_PROOF, REGTEST_HEADERS, opt)
  // compare the load-bearing verdict fields (drop parsed-header objects, already checked via parseHeader/proof)
  const trim = (v: any) => v.ok ? { ok: v.ok, txid: v.txid, confirmations: v.confirmations, work: v.work, powMeaningful: v.powMeaningful } : { ok: v.ok, reason: v.reason }
  ok(same(trim(v1), trim(v2)), `proveTxBuried: ok=${(v1 as any).ok} conf=${(v1 as any).confirmations} work=${(v1 as any).work} powMeaningful=${(v1 as any).powMeaningful} — identical`)
  ok((v1 as any).ok === true && (v1 as any).txid === REGTEST_TXID, `the real regtest self-anchor is proven buried, txid matches`)
  // a hostile input must be refused identically: swap header[1] to break the chain
  const broken = [REGTEST_HEADERS[0], REGTEST_HEADERS[2], REGTEST_HEADERS[1]]
  const b1 = spv.proveTxBuried(REGTEST_RAWTX, REGTEST_PROOF, broken, opt)
  const b2 = await web.proveTxBuried(REGTEST_RAWTX, REGTEST_PROOF, broken, opt)
  ok(same(trim(b1), trim(b2)) && (b1 as any).ok === false, `a broken header chain is REFUSED identically (${(b1 as any).reason})`)

  console.log(`\n╚══ ${fail === 0 ? `ALL GREEN — the browser SPV and the consensus SPV agree byte-for-byte across ${pass} checks. The in-browser proof is trustable. ⛓₿` : `${fail} PARITY BREAKS — the browser port diverges from consensus`} ══╝`)
  if (fail) process.exit(1)
}
main().catch((e) => { console.error('\n✗ ' + (e?.stack || e?.message || e)); process.exit(1) })
