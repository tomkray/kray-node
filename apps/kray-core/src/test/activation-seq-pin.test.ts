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

  console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — catalog; RUNE_BOOK_OPEN_SEQ is 0 on every named net (Porta 2 open). ₭\n`)
  process.exit(fail ? 1 : 0)
}
main()
