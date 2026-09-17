/**
 * E1 — THE V1 POT IS RETIRED AT THE DOOR (2026-09-17).
 *
 *   node apps/kray-net/contract-v1-door.test.mjs
 *
 * Hermetic: boots its OWN regtest writer from this tree on a free port (never the lab at :4477), then:
 *   · /prepare  {action:'contract', code}            (no star) → refused, the message names the retirement
 *   · /prepare  {action:'contract', form: scroll…}   (no star) → refused
 *   · /submit   a SELF-BUILT, correctly signed v1 act  → refused at buildSubmitEvent (the acceptance path)
 *   · /submit-batch with that act                     → refused
 *   · the journal holds ZERO contract events after all of the above
 *   · control: a v2 law WITH a star (donate → name a star → contract on it) still seals — the door only closed v1
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { _generateKeyPair, _signKrayWallet, addressOf, toBtcNet, contractMessage } from '../kray-core/src/protocol/scheme.ts'
import { canonicalCode } from '../kray-core/src/protocol/contract.ts'
import { sha256hex } from '../kray-core/src/protocol/kray-primitives.ts'

const NET = 'regtest'
const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TMP = mkdtempSync(join(tmpdir(), 'kray-e1-door-'))
let writer = null
const cleanup = () => { try { writer && writer.kill('SIGKILL') } catch { /* gone */ } try { rmSync(TMP, { recursive: true, force: true }) } catch { /* best effort */ } }
process.on('exit', cleanup)

const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
const PORT = await freePort()
const NODE = `http://127.0.0.1:${PORT}`
const jget = (p) => fetch(NODE + p).then((r) => r.json()).catch(() => ({ __down: true }))
const jpost = (p, b) => fetch(NODE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) })).catch((e) => ({ error: 'net: ' + e.message }))

const sk = createHash('sha256').update('e1-door|paper', 'utf8').digest()
const { publicKeyHex: pub } = _generateKeyPair(sk)
const addr = addressOf(pub, toBtcNet(NET))
const sign = (m) => _signKrayWallet(m, sk)
const CODE = { vars: { paid: '0' }, rules: [{ name: 'noop', when: { lit: '1' }, then: [{ set: { var: 'paid', to: { lit: '1' } } }] }] }

async function act(body) {
  const prep = await jpost('/api/kraynet/prepare', { ...body, from: addr })
  if (!prep.message) return { error: 'prepare: ' + (prep.error || JSON.stringify(prep)), _prep: prep }
  const sub = await jpost('/api/kraynet/submit', { ...body, from: addr, code: prep.code || body.code, nonce: prep.nonce, clock: prep.clock, publicKey: pub, signature: sign(prep.message), scheme: 'kraywallet' })
  return { ...sub, _star: prep.star ?? sub.star }
}

async function main() {
  console.log('\n╔═ E1 — a law hangs on a star: the v1 pot is refused at every writer door ═╗\n')
  const env = { ...process.env, KRAY_NET: NET, KRAY_PORT: String(PORT), KRAY_DATA: join(TMP, 'data'), KRAY_TRUSTED_DEV: '1', KRAY_INBOX: '0' }
  delete env.KRAY_BTC_RPC; delete env.KRAY_BTC_RPC_PASS; delete env.KRAY_BTC_RPC_USER
  writer = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let wlog = ''; writer.stdout.on('data', (d) => { wlog += d }); writer.stderr.on('data', (d) => { wlog += d })
  const t0 = Date.now(); let up = false
  while (Date.now() - t0 < 30_000) { const s = await jget('/api/kraynet/supply'); if (s && !s.__down && s.emitted !== undefined) { up = true; break } await sleep(300) }
  if (!up) { console.error('writer did not come up:\n' + wlog.slice(-2000)); process.exit(1) }
  ok(true, `a regtest writer from THIS tree is up on :${PORT}`)

  // ── 1 · prepare refuses v1 (raw IR and a locked form) ──
  const p1 = await jpost('/api/kraynet/prepare', { action: 'contract', from: addr, code: CODE })
  ok(!!p1.error && /retired at this door/.test(String(p1.error)), `/prepare v1 (raw IR, no star) → refused: ${String(p1.error).slice(0, 80)}`)
  const p2 = await jpost('/api/kraynet/prepare', { action: 'contract', from: addr, form: { kind: 'scroll', each: '1', max: '1', locked: true, gate: 'open' } })
  ok(!!p2.error && /retired at this door/.test(String(p2.error)), '/prepare v1 (locked scroll form, no star) → refused')

  // ── 2 · the acceptance path refuses a SELF-BUILT, correctly signed v1 act ──
  const codeHash = sha256hex(canonicalCode(CODE))
  const v1 = { action: 'contract', from: addr, code: CODE, publicKey: pub, signature: sign(contractMessage(NET, addr, codeHash)), scheme: 'kraywallet' }
  const s1 = await jpost('/api/kraynet/submit', v1)
  ok(!!s1.error && /retired at this door/.test(String(s1.error)), `/submit self-built v1 → refused (HTTP ${s1.status})`)
  const { from: _f, ...v1item } = v1; void _f
  const s2 = await jpost('/api/kraynet/submit-batch', { from: addr, items: [v1item] })
  const r0 = Array.isArray(s2.results) ? s2.results[0] : null
  ok(!!r0 && r0.ok === false && /retired at this door/.test(String(r0.error)), `/submit-batch: the v1 item reaches buildSubmitEvent and is refused there (${r0 ? String(r0.error).slice(0, 60) : JSON.stringify(s2).slice(0, 80)})`)
  const c0 = await jget('/api/kraynet/contracts')
  const count0 = Array.isArray(c0.contracts) ? c0.contracts.length : (c0.count ?? 0)
  ok(count0 === 0, `no contract exists after every v1 attempt (${count0})`)

  // ── 3 · control: a v2 law WITH a star still seals ──
  const mint = await jpost('/api/kraynet/donate', { to: addr, sats: '1000' })
  ok(!!mint.ok, 'dev-mint funds the paper (regtest lab door)')
  const named = await act({ action: 'name', name: ('e1d' + Date.now().toString(36)).replace(/\W/g, '') })
  ok(!!named.ok && named._star != null, `a star is named (#${named._star})`)
  const law = await act({ action: 'contract', code: CODE, star: String(named._star) })
  ok(!!law.ok && !!law.address, `a v2 law WITH a star still seals at ${String(law.address).slice(0, 22)}…`)
  const c1 = await jget('/api/kraynet/contracts')
  const count1 = Array.isArray(c1.contracts) ? c1.contracts.length : (c1.count ?? 0)
  ok(count1 === 1, 'exactly one contract exists: the v2 law on the star')

  console.log(`\n  ${pass} passed, ${fail} FAILED\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
