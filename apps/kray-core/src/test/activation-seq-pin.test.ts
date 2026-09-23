/**
 * ATO 0 — self-completing activation-seq catalog.
 *   node src/test/activation-seq-pin.test.ts
 *
 * A catalog, not a lock. It freezes WHICH activation seqs exist and their
 * per-network values. A new *_SEQ that is not in GOLDEN fails. A GOLDEN name
 * that vanished fails. A polarity change fails. RUNE_BOOK_OPEN_SEQ is the
 * Porta 2 pin (all nets open at 0); this harness still only catalogs, it does not apply.
 *
 * Bitcoin nSequence (SEQUENCE_RBF / SEQUENCE_FINAL_RBF) is not activation law.
 */
import { openKrayLedger } from '../protocol/store.ts'   // the SAME opener every node uses — the pins must arrive through it
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAX = Number.MAX_SAFE_INTEGER

type Nets = { regtest: number; signet: number; main: number }
type Golden =
  | { kind: 'table'; nets: Nets; file: string }
  | { kind: 'scalar'; value: number; file: string }

/** Intentional pin. A new activation seq must be added HERE with its values, or CI breaks. */
const GOLDEN: Record<string, Golden> = {
  INCLUSION_ACTIVATION_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: MAX, signet: 0, main: 0 } },
  PROOF_MANDATORY_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: MAX, signet: 0, main: 0 } },
  RUNE_ANCESTRY_MANDATORY_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: MAX, signet: 0, main: 0 } },
  MINT_WITNESS_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: MAX, signet: 0, main: 0 } },
  DONATION_SCRIPT_LAW_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: MAX, signet: 0, main: 0 } },
  RUNE_BOOK_OPEN_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: 0, signet: 0, main: 0 } },
  X_TRANSFER_ACTIVATION_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: MAX, signet: 0, main: 0 } },
  X_FEELESS_ACTIVATION_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: MAX, signet: 0, main: 0 } },
  TK_FOLD_ACTIVATION_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: MAX, signet: 0, main: 0 } },
  BURN_LAW_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: 1, signet: 1, main: 1 } },
  REWARD_RETIRED_FROM_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: 1, signet: 1, main: 1 } },
  ATLAS_FEE_ACTIVATION_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: MAX, signet: 0, main: 0 } },
  SAME_INSTANT_ORDER_ACTIVATION_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: MAX, signet: 0, main: 0 } },
  UNIQUE_RELIC_REFUSE_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: MAX, signet: 0, main: 0 } },
  DIGIT_LAW_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: MAX, signet: 0, main: 0 } },
  SIZE_PROPORTION_ACTIVATION_SEQ: { kind: 'table', file: 'protocol/kray-primitives.ts', nets: { regtest: MAX, signet: 0, main: 0 } },
  // Named with intent (2026-09-13): the paid profile law — 1 ₭ per set-face, bio ≤ 160 bytes, one rewrite a day —
  // opens past every feeless mouth scar (signet tip ~155 → 200; main tip ~49 → 80); regtest born active.
  PROFILE_VALUE_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: 0, signet: 200, main: 80 } },
  // Once-ever like, one address × one star: born active on every net — the tip cannot buy a second like.
  STAR_LIKE_ONCE_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: 0, signet: 0, main: 0 } },
  // Named with intent (2026-09-18): THE POT BINDING — a proof-bearing rune deposit's journaled vault must be THIS
  // network's sealed pot / federation (federation-consensus.ts). Pinned above the live heads at the rite (signet
  // tip 226 → 227, main tip 81 → 82) so every journaled deposit replays byte-identically; regtest has no sealed
  // federation (the lab's varies) and stays MAX.
  POT_BINDING_SEQ: { kind: 'table', file: 'protocol/federation-consensus.ts', nets: { regtest: MAX, signet: 227, main: 82 } },
  // E1 (2026-09-18): a law with no star (the v1 pot) is refused in the reducer at/after this pin — the same rite,
  // the same heads (227 / 82); no v1 seal exists in either live journal. Regtest stays MAX (goldens seal v1 pots).
  CONTRACT_V1_RETIRED_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: MAX, signet: 227, main: 82 } },
  // THE GIFT LISTING — a star may be listed at price 0 (a drop anyone may take for the eternal fee alone), and a
  // listing may NAME the one address it was left for. regtest born active (the lab and KRAYVERSE's own drops);
  // signet and main wait until every node of that fleet runs this law — an older era freezes, it never forks.
  GIFT_LISTING_SEQ: { kind: 'table', file: 'protocol/star-market.ts', nets: { regtest: 0, signet: 231, main: 82 } },
  // THE PACKET MARKET — the star market's law for a packet of ₭, of one star's Luz, or of a rune. regtest is
  // born with it (the lab and KRAYVERSE's own drops); signet and main wait for their whole fleet, and below
  // the pin every packet act is refused, so no root grows and an old-era node freezes rather than forks (A3).
  PACKET_MARKET_SEQ: { kind: 'table', file: 'protocol/packet-market.ts', nets: { regtest: 0, signet: 231, main: 82 } },
  // THE CLAIM ESCROW — one signed root opens a harvest for many hands, held in a keyless pot. regtest is
  // born with it; signet and main wait for their whole fleet, and below the pin every claim act is refused,
  // so no pot fills and an old-era node freezes rather than forks (A3).
  CLAIM_ESCROW_SEQ: { kind: 'table', file: 'protocol/claim-book.ts', nets: { regtest: 0, signet: 231, main: 82 } },
  // THE MINT DROP — a harvest whose root commits TERMS, not names: N pots, one per hand, while pots remain.
  // Shut on both live networks. Signet opens it once the reducer suites and a mint stampede are green;
  // mainnet has never opened a harvest or a drop, so it takes this, the packet market and the claim escrow
  // at the SAME seq and begins with the whole law at once.
  MINT_DROP_SEQ: { kind: 'table', file: 'protocol/claim-book.ts', nets: { regtest: 0, signet: 243, main: 82 } },
  // THE UNGRINDABLE TIEBREAK — the same-instant order key is the canonical message alone, never the opt-in
  // `|deadline=` suffix an author may vary for free while the act stays the same act. regtest born active;
  // signet and main stay MAX until the deploy pre-flight proves no live journal holds a signed act carrying
  // a deadline — with none, the new key is byte-identical to the old one and the pin may be born at 0.
  // THE COUPLING, pinned as a number and not only as a sentence: this seq must equal the market's three
  // above on every network. A market opened over a grindable tiebreak is a rigged queue with a proof.
  DEADLINE_FREE_ORDER_SEQ: { kind: 'table', file: 'protocol/ledger.ts', nets: { regtest: 0, signet: 231, main: 82 } },
  PRESENCE_WINDOW_FROM_SEQ: { kind: 'scalar', file: 'economics/presence-window.ts', value: 121 },
  BEAT_PAY_CAP_LIFTED_FROM_SEQ: { kind: 'scalar', file: 'economics/presence-window.ts', value: MAX },
}

const SKIP = new Set(['SEQUENCE_RBF', 'SEQUENCE_FINAL_RBF'])

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}

function parseNum(raw: string): number | null {
  const s = raw.trim()
  if (s === 'Number.MAX_SAFE_INTEGER') return MAX
  if (/^\d+$/.test(s)) return Number(s)
  return null
}

function isActivationName(name: string): boolean {
  if (SKIP.has(name)) return false
  return /(?:_SEQ|_FROM_SEQ)$/.test(name) && !name.startsWith('SEQUENCE_')
}

/** Declarations: `const NAME: Record<string, number> = {` or `export const NAME = <num>`. */
function scanFile(abs: string, rel: string): Map<string, { kind: 'table' | 'scalar'; nets?: Nets; value?: number }> {
  const src = readFileSync(abs, 'utf8')
  const found = new Map<string, { kind: 'table' | 'scalar'; nets?: Nets; value?: number }>()

  const tableRe = /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*:\s*Record<string,\s*number>\s*=\s*\{([\s\S]*?)\}/g
  let m: RegExpExecArray | null
  while ((m = tableRe.exec(src))) {
    const name = m[1]
    if (!isActivationName(name)) continue
    const body = m[2]
    const pick = (net: string) => {
      const hit = body.match(new RegExp(net + '\\s*:\\s*([^,\\n]+)'))
      return hit ? parseNum(hit[1]) : null
    }
    const regtest = pick('regtest'), signet = pick('signet'), main = pick('main')
    if (regtest == null || signet == null || main == null) {
      found.set(name, { kind: 'table' })
      continue
    }
    found.set(name, { kind: 'table', nets: { regtest, signet, main } })
  }

  const scalarRe = /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*(?:_SEQ|_FROM_SEQ))\s*=\s*([^/\n]+)/g
  while ((m = scalarRe.exec(src))) {
    const name = m[1]
    if (!isActivationName(name) || found.has(name)) continue
    const value = parseNum(m[2])
    if (value == null) continue
    found.set(name, { kind: 'scalar', value })
  }

  void rel
  return found
}

function main() {
  console.log('\n╔═ ATO 0 — ACTIVATION SEQ CATALOG: every pin named, every polarity frozen ═╗\n')

  const dirs = [join(ROOT, 'protocol'), join(ROOT, 'economics')]
  const scanned = new Map<string, { rel: string; hit: ReturnType<typeof scanFile> extends Map<string, infer V> ? V : never }>()
  for (const dir of dirs) {
    for (const abs of walk(dir)) {
      const rel = abs.slice(ROOT.length + 1).replaceAll('\\', '/')
      const hits = scanFile(abs, rel)
      for (const [name, hit] of hits) {
        if (scanned.has(name)) {
          ok(false, `${name} declared twice (${scanned.get(name)!.rel} and ${rel}) — one name, one pin`)
          continue
        }
        scanned.set(name, { rel, hit })
      }
    }
  }

  const names = [...scanned.keys()].sort()
  const goldenNames = Object.keys(GOLDEN).sort()
  const extra = names.filter((n) => !GOLDEN[n])
  const missing = goldenNames.filter((n) => !scanned.has(n))

  ok(extra.length === 0, extra.length === 0
    ? `scan found ${names.length} activation seqs — none escaped the catalog`
    : `ORPHAN SEQ (add to GOLDEN with intent, or it is not law): ${extra.join(', ')}`)
  ok(missing.length === 0, missing.length === 0
    ? 'every GOLDEN name still lives in source'
    : `GOLDEN name vanished from source: ${missing.join(', ')}`)

  for (const name of goldenNames) {
    const g = GOLDEN[name]
    const s = scanned.get(name)
    if (!s) continue
    ok(s.rel === g.file, `${name} lives in ${s.rel}` + (s.rel === g.file ? '' : ` — GOLDEN said ${g.file}`))
    if (g.kind === 'table') {
      ok(s.hit.kind === 'table' && !!s.hit.nets, `${name} is a per-network table`)
      if (s.hit.nets) {
        const a = s.hit.nets, b = g.nets
        ok(a.regtest === b.regtest && a.signet === b.signet && a.main === b.main,
          `${name} polarity frozen  {regtest:${a.regtest === MAX ? 'MAX' : a.regtest}, signet:${a.signet === MAX ? 'MAX' : a.signet}, main:${a.main === MAX ? 'MAX' : a.main}}`)
      }
    } else {
      ok(s.hit.kind === 'scalar' && s.hit.value === g.value,
        `${name} scalar frozen at ${g.value === MAX ? 'MAX' : g.value}`)
    }
  }

  const ledger = readFileSync(join(ROOT, 'protocol/ledger.ts'), 'utf8')
  const tablesInLedger = goldenNames.filter((n) => GOLDEN[n].kind === 'table' && GOLDEN[n].file === 'protocol/ledger.ts')
  const unwired = tablesInLedger.filter((n) => !ledger.includes(`this.` ) || !new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\[').test(ledger))
  ok(unwired.length === 0, unwired.length === 0
    ? 'every ledger table is indexed in ledger.ts (unknown net cannot silently skip a pin)'
    : `ledger table never indexed: ${unwired.join(', ')}`)

  const sizeWired = /SIZE_PROPORTION_ACTIVATION_SEQ\[/.test(ledger)
  ok(sizeWired, 'SIZE_PROPORTION_ACTIVATION_SEQ is read in the ledger (imported table, same ctor law)')
  const potWired = /POT_BINDING_SEQ\[/.test(ledger) && /federationBindingVerdict\(/.test(ledger)
  ok(potWired, 'POT_BINDING_SEQ is read in the ledger and the binding verdict is consulted there (imported table, same ctor law)')

  // ── THE MARKET'S FOUR PINS MOVE AS ONE ────────────────────────────────────────────────────────
  // The same-instant order key is `sha256` of what an author signed, and `requireSig` lets them append an
  // opt-in `|deadline=D` that moves no value — so below DEADLINE_FREE_ORDER_SEQ a racer can regrind their
  // own key for free. Measured: ONE try can drag a rival under an honest act. Where allocation IS the
  // tiebreak — a drop listed at price zero — that is the difference between arithmetic and a rigged queue.
  //
  // So opening any of the three market laws on a network where the tiebreak is still grindable would ship
  // a proof over a fixed race. The coupling was written as a sentence in the deploy doc first, and a
  // sentence is not a law: here it is a number, checked on every network, every run.
  {
    const market = ['GIFT_LISTING_SEQ', 'PACKET_MARKET_SEQ', 'CLAIM_ESCROW_SEQ', 'MINT_DROP_SEQ'] as const
    const guard = GOLDEN.DEADLINE_FREE_ORDER_SEQ
    for (const net of ['regtest', 'signet', 'main'] as const) {
      const tiebreak = guard.kind === 'table' ? guard.nets[net] : MAX
      for (const name of market) {
        const row = GOLDEN[name]
        const open = row && row.kind === 'table' ? row.nets[net] : MAX
        ok(tiebreak <= open,
          open === MAX
            ? `${net}: ${name} is shut, so the tiebreak may be anything (${tiebreak === MAX ? 'shut' : tiebreak})`
            : `${net}: ${name} opens at ${open} and the ungrindable tiebreak is already law at ${tiebreak}`)
      }
    }
  }

  // ── THE CONSTRUCTOR'S ORDER IS LAW ────────────────────────────────────────────────────────────
  // Every pin reaches the ledger as a POSITIONAL argument. Insert one parameter in the middle and every
  // pin after it silently shifts by one — a whole network would activate the wrong law at the wrong seq,
  // and nothing would throw. So the order itself is pinned here, read from the reducer's own source.
  {
    const src = readFileSync(new URL('../protocol/ledger.ts', import.meta.url), 'utf8')
    // up to the LAST `)` of the signature, not the first: one parameter is itself a function type
    const ctor = /constructor\((.*)\)\s*\{/.exec(src)?.[1] ?? ''
    // split on top-level commas only (a function-type parameter may carry its own)
    const parts: string[] = []
    let depth = 0, cur = ''
    for (const ch of ctor) {
      if (ch === '(' || ch === '[') depth++
      else if (ch === ')' || ch === ']') depth--
      if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
    }
    if (cur.trim()) parts.push(cur)
    const names = parts.map((a) => (a.split(':')[0] ?? '').replace(/=.*$/, '').replace(/\?$/, '').trim()).filter(Boolean)
    const GOLDEN_ORDER = [
      'potTarget', 'network', 'potScriptHex', 'backingGate', 'atlasBytes', 'inclusionActivationSeq',
      'xTransferActivationSeq', 'burnLawSeq', 'rewardRetiredSeq', 'atlasFeeActivationSeq',
      'sameInstantOrderSeq', 'xFeelessActivationSeq', 'tkFoldActivationSeq', 'sizeProportionSeq',
      'potInternalKeyHex', 'proofMandatorySeq', 'runeAncestrySeq', 'uniqueRelicRefuseSeq', 'mintWitnessSeq',
      'donationScriptSeq', 'runeBookOpenSeq', 'digitLawSeq', 'profileValueSeq', 'starLikeOnceSeq',
      'potBindingSeq', 'contractV1RetiredSeq',
      'giftListingSeq', 'packetMarketSeq', 'claimEscrowSeq', 'deadlineFreeOrderSeq', 'mintDropSeq',
    ]
    ok(names.length === GOLDEN_ORDER.length && names.every((n, i) => n === GOLDEN_ORDER[i]),
      names.join(',') === GOLDEN_ORDER.join(',')
        ? `the ledger constructor's ${names.length} parameters are in the pinned order — no pin can shift`
        : `CONSTRUCTOR ORDER CHANGED — every positional pin after the change now lands in the wrong slot.\n      got:    ${names.join(', ')}\n      pinned: ${GOLDEN_ORDER.join(', ')}`)
  }

  // ── AND THE PIN THAT ARRIVES IS THE PIN THAT WAS MEANT ────────────────────────────────────────
  // The order above is read from the source; this proves the LIVE wiring, through the same opener every
  // node uses. A price-zero listing is lawful only where GIFT_LISTING_SEQ is 0, and a packet act only
  // where PACKET_MARKET_SEQ is 0 — so the behaviour itself says which slot each table reached.
  for (const net of ['regtest', 'signet', 'main'] as const) {
    const led = openKrayLedger(net)
    const open = GOLDEN.GIFT_LISTING_SEQ.nets[net] === 0
    let gift = 'applied'
    try {
      led.applyLive({ seq: 1, kind: 'star-list', hash: 'g', at: 1, from: 'x', star: '0', amount: '0', fee: '1', nonce: 0 } as never)
    } catch (e) { gift = (e as Error).message }
    // Below the pin the refusal names the PRICE; at or after it, the act gets past that line and dies later
    // (no such star, no signature) — which is exactly how we know the pin landed where it was meant to.
    ok(open ? !/needs a positive price/.test(gift) : /needs a positive price/.test(gift),
      `${net}: the gift pin arrived in its own slot (price-zero ${open ? 'is lawful' : 'is refused'})`)
    let packet = 'applied'
    try {
      led.applyLive({ seq: 1, kind: 'packet-list', hash: 'p', at: 1, from: 'x', lane: 'kray', amount: '1', price: '0', fee: '1', nonce: 0 } as never)
    } catch (e) { packet = (e as Error).message }
    const packetOpen = GOLDEN.PACKET_MARKET_SEQ.nets[net] === 0
    ok(packetOpen ? !/not the law on this network yet/.test(packet) : /not the law on this network yet/.test(packet),
      `${net}: the packet pin arrived in its own slot (the market ${packetOpen ? 'exists' : 'does not exist'})`)
    let claim = 'applied'
    try {
      led.applyLive({ seq: 1, kind: 'claim-open', hash: 'c', at: 1, from: 'x', lane: 'kray', amount: '1', claimRoot: 'a'.repeat(64), fee: '1', nonce: 0 } as never)
    } catch (e) { claim = (e as Error).message }
    const claimOpen = GOLDEN.CLAIM_ESCROW_SEQ.nets[net] === 0
    ok(claimOpen ? !/claim escrow is not the law/.test(claim) : /claim escrow is not the law/.test(claim),
      `${net}: the claim pin arrived in its own slot (the escrow ${claimOpen ? 'exists' : 'does not exist'})`)
  }

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — catalog; RUNE_BOOK_OPEN_SEQ is 0 on every named net (Porta 2 open). ₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
