/**
 * INSCRIPTION METADATA (v4) — free JSON sealed with the relic (Ordinals-style).
 * Pins A3 (a no-meta journal stays on frozen v2) and the Supreme Law (tampered
 * JSON refuses). A later contract may READ the blob; it never executes.
 *   node src/test/inscription-meta.test.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { KrayLedger } from '../protocol/ledger.ts'
import {
  NETWORKS, _generateKeyPair, _signKrayWallet, _hexToBytes,
  inscribeMessageV2, inscribeMessageV3, inscribeMessageV4, nameMessageV2,
  assertInscriptionMeta, INSCRIBE_META_MAX,
} from '../protocol/scheme.ts'
import type { KrayEvent } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const pin = (c: boolean, m: string) => { if (c) { pass++; return } fail++; console.log('  ✗ FAIL — ' + m) }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}
function wallet(tag: string) {
  const sk = createHash('sha256').update('inscribe-meta|' + tag).digest()
  const { publicKeyHex } = _generateKeyPair(sk)
  return { addr: btc.p2tr(_hexToBytes(publicKeyHex), undefined, NETWORKS.regtest).address!, sk, pk: publicKeyHex }
}

function main() {
  console.log('\n╔═ INSCRIPTION METADATA — free JSON · A3 · injectivity ═╗\n')
  const A = wallet('A')
  const blob = '{"name":"Aurora","traits":{"medium":"oil"},"note":"any shape"}'

  rejects(() => assertInscriptionMeta(''), /empty metadata/, 'blank metadata is absence — never a signed v4')
  rejects(() => assertInscriptionMeta('not json'), /must be JSON/, 'non-JSON is refused')
  assertInscriptionMeta(blob)
  assertInscriptionMeta('[1,2,3]')
  assertInscriptionMeta('{"pipe":"a|b","nl":"x\\ny"}')
  const mdSealed = JSON.stringify('# lore\n\nnot a protocol type')
  assertInscriptionMeta(mdSealed)
  ok(typeof JSON.parse(mdSealed) === 'string', 'a JSON string is lawful — prose is not a second consensus type')
  ok(Buffer.byteLength('{"x":"★"}', 'utf8') > '{"x":"★"}'.length, 'the cap counts UTF-8 bytes, not JS characters')
  const exact = '{"x":"' + 'a'.repeat(INSCRIBE_META_MAX - 8) + '"}'
  ok(Buffer.byteLength(exact, 'utf8') === INSCRIBE_META_MAX, 'exact-cap fixture is 8192 UTF-8 bytes')
  assertInscriptionMeta(exact)
  rejects(() => assertInscriptionMeta(exact + ' '), /cap is/, 'one extra byte over 8192 is refused')
  ok(true, 'any JSON value is lawful — object, array, string, pipes inside strings')

  const L = new KrayLedger(undefined, NET)
  L.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: A.addr, amount: '10000' } as KrayEvent)
  let seq = 1
  const next = () => ++seq
  const signOn = (ledger: KrayLedger, fields: Record<string, unknown>, buildMsg: (n: number) => string) => {
    const n = ledger.nonceOf(A.addr)
    return {
      seq: next(), at: 0, from: A.addr, publicKey: A.pk, signature: _signKrayWallet(buildMsg(n), A.sk), scheme: 'kraywallet',
      ...fields, nonce: n,
    } as unknown as KrayEvent
  }

  const chBare = createHash('sha256').update('bare-bytes').digest('hex')
  const L2 = new KrayLedger(undefined, NET)
  L2.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: A.addr, amount: '10000' } as KrayEvent)
  L.applyLive(signOn(L, { kind: 'inscribe', hash: 'b1', contentHash: chBare, contentType: 'image/png', size: 12 },
    (n) => inscribeMessageV2(NET, A.addr, chBare, 'image/png', 12, undefined, n)))
  L2.applyLive({
    seq: 2, kind: 'inscribe', hash: 'b1', at: 0, from: A.addr, contentHash: chBare, contentType: 'image/png', size: 12,
    nonce: 0, publicKey: A.pk, signature: _signKrayWallet(inscribeMessageV2(NET, A.addr, chBare, 'image/png', 12, undefined, 0), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L.stars.merkleRoot() === L2.stars.merkleRoot(), 'A3 — two no-meta inscriptions of the same bytes share the star merkle (v2 frozen)')
  ok(L.stars.star(0n)?.meta == null, 'a v2 star carries no metadata')

  const rootBeforeMeta = L.cascadeRoot()
  const chMeta = createHash('sha256').update('meta-bytes').digest('hex')
  ok(inscribeMessageV4(NET, A.addr, chMeta, 'image/png', 16, [], [], blob, L.nonceOf(A.addr)).startsWith('kraynet.inscribe.v4|'), 'metadata uses the v4 domain (v2/v3 stay frozen)')
  L.applyLive(signOn(L, {
    kind: 'inscribe', hash: 'm1', contentHash: chMeta, contentType: 'image/png', size: 16, meta: blob,
  }, (n) => inscribeMessageV4(NET, A.addr, chMeta, 'image/png', 16, [], [], blob, n)))
  ok(L.cascadeRoot() !== rootBeforeMeta, 'a JSON inscription moves the cascade root')
  const s1 = L.stars.star(1n)!
  ok(s1.meta === blob, 'the star carries the exact JSON bytes')
  ok(L.stars.inscription(s1.contentId || s1.id)?.meta === blob, 'the inscription record carries the same JSON')

  const L3 = new KrayLedger(undefined, NET)
  L3.applyLive({ seq: 1, kind: 'donate', hash: 'd', to: A.addr, amount: '10000' } as KrayEvent)
  L3.applyLive({
    seq: 2, kind: 'inscribe', hash: 'b1', at: 0, from: A.addr, contentHash: chBare, contentType: 'image/png', size: 12,
    nonce: 0, publicKey: A.pk, signature: _signKrayWallet(inscribeMessageV2(NET, A.addr, chBare, 'image/png', 12, undefined, 0), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  L3.applyLive({
    seq: 3, kind: 'inscribe', hash: 'm1', at: 0, from: A.addr, contentHash: chMeta, contentType: 'image/png', size: 16, meta: blob,
    nonce: 1, publicKey: A.pk, signature: _signKrayWallet(inscribeMessageV4(NET, A.addr, chMeta, 'image/png', 16, [], [], blob, 1), A.sk), scheme: 'kraywallet',
  } as KrayEvent)
  ok(L3.stars.merkleRoot() === L.stars.merkleRoot() && L3.cascadeRoot() === L.cascadeRoot(), 'reboot of a mixed v2+v4 journal is byte-exact')

  const chT = createHash('sha256').update('tamper-bytes').digest('hex')
  rejects(() => L.applyLive(signOn(L, {
    kind: 'inscribe', hash: 't1', contentHash: chT, contentType: 'image/png', size: 8, meta: '{"name":"LIE"}',
  }, (n) => inscribeMessageV4(NET, A.addr, chT, 'image/png', 8, [], [], '{"name":"Honest"}', n))), /does not verify|signature/, 'tampering the JSON after sign is refused')

  const chP = createHash('sha256').update('parent-trap').digest('hex')
  rejects(() => L.applyLive(signOn(L, {
    kind: 'inscribe', hash: 'p1', contentHash: chP, contentType: 'image/png', size: 8, meta: '{"k":1}', parent: '0',
  }, (n) => inscribeMessageV4(NET, A.addr, chP, 'image/png', 8, [], [], '{"k":1}', n))), /singular parent|parents list/, 'v4 cannot carry an unsigned v2 parent')

  L.applyLive(signOn(L, { kind: 'name', hash: 'n1', name: 'lyra' }, (n) => nameMessageV2(NET, A.addr, n, 'lyra')))
  const named = L.stars.starOfName('lyra')!
  const chAdd = createHash('sha256').update('add-on-lyra').digest('hex')
  const song = '{"bpm":120,"verse":"first"}'
  L.applyLive(signOn(L, {
    kind: 'inscribe', hash: 'a1', star: named.toString(), contentHash: chAdd, contentType: 'audio/mpeg', size: 24, meta: song,
  }, (n) => inscribeMessageV4(NET, A.addr, chAdd, 'audio/mpeg', 24, [], [], song, n, named)))
  const lyra = L.stars.star(named)!
  ok(lyra.name === 'lyra' && lyra.meta === song, 'add-to-star seals JSON on the same number — name and content stay two canvases')

  const pretty = '{\n  "k": 1,\n  "pipe": "a|b"\n}'
  const chPretty = createHash('sha256').update('pretty-json').digest('hex')
  L.applyLive(signOn(L, {
    kind: 'inscribe', hash: 'pj', contentHash: chPretty, contentType: 'image/png', size: 8, meta: pretty,
  }, (n) => inscribeMessageV4(NET, A.addr, chPretty, 'image/png', 8, [], [], pretty, n)))
  ok(L.stars.star(L.stars.createdSeq - 1n)?.meta === pretty, 'pretty-printed JSON with newlines and pipes inside strings seals byte-exact')

  const over = '{"x":"' + 'a'.repeat(INSCRIBE_META_MAX) + '"}'
  rejects(() => assertInscriptionMeta(over), /cap is/, 'JSON over the 8 KB cap is refused at the shape gate')
  const chOver = createHash('sha256').update('oversize').digest('hex')
  rejects(() => L.applyLive(signOn(L, {
    kind: 'inscribe', hash: 'ov', contentHash: chOver, contentType: 'image/png', size: 8, meta: over,
  }, (n) => inscribeMessageV4(NET, A.addr, chOver, 'image/png', 8, [], [], over, n))), /cap is|must be JSON/, 'oversize JSON is refused before burn')

  const chV3 = createHash('sha256').update('v3-no-meta').digest('hex')
  L.applyLive(signOn(L, {
    kind: 'inscribe', hash: 'v3', contentHash: chV3, contentType: 'image/png', size: 8, parents: ['0'],
  }, (n) => inscribeMessageV3(NET, A.addr, chV3, 'image/png', 8, ['0'], [], n)))
  ok(L.stars.star(L.stars.createdSeq - 1n)?.meta == null, 'v3 lineage without JSON stays on the frozen path')

  const chV4p = createHash('sha256').update('v4-with-parent').digest('hex')
  const kid = '{"child":true}'
  L.applyLive(signOn(L, {
    kind: 'inscribe', hash: 'v4p', contentHash: chV4p, contentType: 'image/png', size: 8, parents: ['0'], meta: kid,
  }, (n) => inscribeMessageV4(NET, A.addr, chV4p, 'image/png', 8, ['0'], [], kid, n)))
  const last = L.stars.star(L.stars.createdSeq - 1n)!
  ok(last.meta === kid && last.parents?.[0] === 0n, 'v4 + owned parent: JSON and lineage ride one signature')

  swarm()

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n✓ ${pass} checks passed — free JSON metadata is signed, append-only, and a stranger can re-derive it.\n`)
}

function lcg(seed: number) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000 }

function swarm(): void {
  console.log('\n── SWARM — mixed v2/v3/v4 · random JSON · attacks · reboot ──\n')
  const seeds = [1, 7, 42, 1337, 99999]
  let acts = 0, refused = 0, applied = 0
  for (const seed of seeds) {
    const rnd = lcg(seed)
    const W = [wallet('s' + seed + 'A'), wallet('s' + seed + 'B'), wallet('s' + seed + 'C')]
    const L = new KrayLedger(undefined, NET)
    const journal: KrayEvent[] = []
    let seq = 0
    const push = (e: KrayEvent) => { L.applyLive(e); journal.push(e) }
    for (const w of W) {
      seq++
      push({ seq, kind: 'donate', hash: 'd' + seed + seq, to: w.addr, amount: '10000' } as KrayEvent)
    }
    const tryApply = (e: KrayEvent): boolean => {
      const before = L.cascadeRoot()
      const burned = L.totalBurned
      try {
        L.applyLive(e)
        journal.push(e)
        pin(L.conserves(), `seed ${seed} seq ${e.seq}: conserves after apply`)
        return true
      } catch {
        pin(L.cascadeRoot() === before && L.totalBurned === burned, `seed ${seed} seq ${e.seq}: refused apply mutates nothing`)
        return false
      }
    }
    const sign = (w: typeof W[0], fields: Record<string, unknown>, buildMsg: (n: number) => string): KrayEvent => {
      seq++
      const n = L.nonceOf(w.addr)
      return {
        seq, at: 0, from: w.addr, publicKey: w.pk, signature: _signKrayWallet(buildMsg(n), w.sk), scheme: 'kraywallet',
        ...fields, nonce: n,
      } as unknown as KrayEvent
    }
    const jsonOf = (): string => {
      const roll = rnd()
      if (roll < 0.12) return JSON.stringify('# md\n\nseed ' + seed)
      if (roll < 0.22) return '[]'
      if (roll < 0.35) return '{}'
      if (roll < 0.5) return JSON.stringify({ n: Math.floor(rnd() * 1e6), pipe: 'a|b' })
      if (roll < 0.65) return '{\n  "nested": { "ok": true },\n  "u": "★"\n}'
      if (roll < 0.78) return JSON.stringify([1, 'x|y', { k: rnd() }])
      return JSON.stringify({ seed, t: rnd(), extra: 'x'.repeat(1 + Math.floor(rnd() * 40)) })
    }
    for (let step = 0; step < 80; step++) {
      const w = W[Math.floor(rnd() * W.length)]
      const ch = createHash('sha256').update(`swarm|${seed}|${step}|${rnd()}`).digest('hex')
      const roll = rnd()
      acts++
      if (roll < 0.08) {
        // ATTACK · not JSON
        const okRefuse = !tryApply(sign(w, { kind: 'inscribe', hash: ch, contentHash: ch, contentType: 'text/plain', size: 6, meta: 'nope' },
          (n) => inscribeMessageV4(NET, w.addr, ch, 'text/plain', 6, [], [], 'nope', n)))
        if (okRefuse) refused++; else { pin(false, `seed ${seed} step ${step}: bad JSON must refuse`); return }
      } else if (roll < 0.12) {
        // ATTACK · tamper JSON after sign
        const honest = '{"ok":true}'
        const e = sign(w, { kind: 'inscribe', hash: ch, contentHash: ch, contentType: 'text/plain', size: 6, meta: '{"ok":false}' },
          (n) => inscribeMessageV4(NET, w.addr, ch, 'text/plain', 6, [], [], honest, n))
        if (!tryApply(e)) refused++; else { pin(false, `seed ${seed} step ${step}: tamper must refuse`); return }
      } else if (roll < 0.16) {
        // ATTACK · v4 + unsigned singular parent
        const meta = '{"x":1}'
        const e = sign(w, { kind: 'inscribe', hash: ch, contentHash: ch, contentType: 'text/plain', size: 6, meta, parent: '0' },
          (n) => inscribeMessageV4(NET, w.addr, ch, 'text/plain', 6, [], [], meta, n))
        if (!tryApply(e)) refused++; else { pin(false, `seed ${seed} step ${step}: unsigned parent must refuse`); return }
      } else if (roll < 0.45) {
        // v2 — no metadata
        if (tryApply(sign(w, { kind: 'inscribe', hash: ch, contentHash: ch, contentType: 'image/png', size: 8 },
          (n) => inscribeMessageV2(NET, w.addr, ch, 'image/png', 8, undefined, n)))) applied++
        else refused++
      } else if (roll < 0.62) {
        // v3 — lineage, no JSON (only if this wallet already holds a star)
        const held = L.stars.starsOf(w.addr)
        if (!held.length) { refused++; continue }
        const parent = held[Math.floor(rnd() * held.length)].toString()
        if (tryApply(sign(w, { kind: 'inscribe', hash: ch, contentHash: ch, contentType: 'image/png', size: 8, parents: [parent] },
          (n) => inscribeMessageV3(NET, w.addr, ch, 'image/png', 8, [parent], [], n)))) applied++
        else refused++
      } else {
        // v4 — free JSON, sometimes with an owned parent
        const meta = jsonOf()
        const held = L.stars.starsOf(w.addr)
        const withParent = held.length > 0 && rnd() < 0.35
        const parents = withParent ? [held[Math.floor(rnd() * held.length)].toString()] : []
        if (tryApply(sign(w, {
          kind: 'inscribe', hash: ch, contentHash: ch, contentType: 'image/png', size: 10, meta,
          ...(parents.length ? { parents } : {}),
        }, (n) => inscribeMessageV4(NET, w.addr, ch, 'image/png', 10, parents, [], meta, n)))) applied++
        else refused++
      }
    }
    pin(L.conserves(), `seed ${seed}: conserves at storm end`)
    const reboot = new KrayLedger(undefined, NET)
    for (const e of journal) reboot.applyLive(e)
    pin(reboot.cascadeRoot() === L.cascadeRoot(), `seed ${seed}: reboot cascade root byte-exact`)
    pin(reboot.stars.merkleRoot() === L.stars.merkleRoot(), `seed ${seed}: reboot star merkle byte-exact`)
    pin(reboot.stars.starCount === L.stars.starCount, `seed ${seed}: reboot star count`)
    for (let n = 0n; n < L.stars.createdSeq; n++) {
      const a = L.stars.star(n), b = reboot.stars.star(n)
      pin(!!a && !!b && a.meta === b.meta && a.contentHash === b.contentHash && a.owner === b.owner, `seed ${seed}: star #${n} meta+content+owner survive reboot`)
    }
  }
  ok(applied > 0 && refused > 0, `swarm mixed applies and refusals (applied ${applied}, refused ${refused}, acts ${acts})`)
  console.log(`  · ${acts} acts across ${seeds.length} seeds · ${applied} applied · ${refused} refused (the law working)`)
}
main()
