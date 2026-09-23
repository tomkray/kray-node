/**
 * THE PHRASE NEVER SITS IN THE ENVIRONMENT — the pen daemon opens its box from a phrase piped on stdin.
 *   node src/test/pot-signer-pass-stdin.test.ts
 *
 * Found live on 2026-09-18: `delete process.env.KRAY_POT_SIGNER_PASS` scrubs Node's copy only; on Linux
 * /proc/<pid>/environ keeps the exec-time environment for the process's lifetime, readable by the same uid.
 * A phrase exported by the unlock script was therefore readable by anyone holding the box's shell, for as
 * long as the pen ran. With --pass-stdin the phrase travels on a pipe: it is never in argv, never in the
 * environment. This suite seals a box, starts the REAL daemon that way, proves it opened the box (health says
 * `owner: boxed`), proves the environment of the running process carries no phrase (Linux: /proc; macOS:
 * `ps -E`), and proves the daemon refuses a phrase that is BOTH piped and exported.
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sealOwnerSecret } from '../protocol/pot-key-box.ts'

let pass = 0
function ok(c: boolean, m: string): void { if (c) { pass++; console.log('  ✓', m) } else { console.error('  ✗', m); process.exit(1) } }

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/pot-signer.mjs')

/**
 * THE PEN IS KEPT OFF THE PUBLIC CLONE ON PURPOSE — it handles keys, and `fix(door): keep the writer kit
 * and pen off git` took it out deliberately. So in a clone that does not carry it, this file must SKIP,
 * loudly, naming why: `node <missing file>` exits non-zero for the wrong reason, and a suite that stays
 * red by design teaches everyone to ignore red. Where the file IS present — the operator's own house —
 * every check below runs and every failure is real.
 */
if (!existsSync(SCRIPT)) {
  console.log(`\n⊘ SKIPPED — scripts/pot-signer.mjs is not in this clone (kept off git on purpose: it handles keys).`)
  console.log('  This suite runs in the operator house, where the file lives. Nothing here is unproven;')
  console.log('  it is simply not testable from a clone that deliberately does not carry the thing.\n')
  process.exit(0)
}
const PORT = 18010
const TOKEN = 'pass-stdin-test-token-0123456789'
const PHRASE = 'a phrase that lives only in a head and on a pipe'
const dir = mkdtempSync(join(tmpdir(), 'kray-pen-stdin-'))
const boxPath = join(dir, 'owner.box')
writeFileSync(boxPath, JSON.stringify(sealOwnerSecret(randomBytes(32), PHRASE)) + '\n')
const baseEnv = { ...process.env, KRAY_POT_SIGNER_TOKEN: TOKEN, KRAY_POT_SIGNER_PORT: String(PORT), KRAY_POT_SIGNER_BOOK_URL: 'http://127.0.0.1:4489' }
delete (baseEnv as Record<string, string | undefined>).KRAY_POT_SIGNER_PASS
delete (baseEnv as Record<string, string | undefined>).KRAY_CONSOLIDATION_SECRET

function environOf(pid: number): string | null {
  if (existsSync(`/proc/${pid}/environ`)) { try { return readFileSync(`/proc/${pid}/environ`, 'utf8') } catch { return null } }
  try { return execFileSync('ps', ['-Eww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }) } catch { return null }
}

async function main() {
  // 1 · piped AND exported → refused (the daemon will not run with a phrase in the environment)
  const both = spawnSync('node', [SCRIPT, '--box', boxPath, '--pass-stdin'], { env: { ...baseEnv, KRAY_POT_SIGNER_PASS: PHRASE }, input: PHRASE + '\n', encoding: 'utf8', timeout: 8000 })
  ok(both.status !== 0 && /ALSO in the environment/.test(both.stderr || ''), 'a phrase piped AND exported → the daemon refuses to start')
  // 2 · a wrong phrase on stdin → the box does not open
  const wrong = spawnSync('node', [SCRIPT, '--box', boxPath, '--pass-stdin'], { env: baseEnv, input: 'not the phrase, but long enough\n', encoding: 'utf8', timeout: 8000 })
  ok(wrong.status !== 0, 'a wrong phrase on stdin → the box stays shut, the daemon does not start')
  // 3 · the right phrase on stdin → the daemon runs, boxed, and the environment carries nothing
  const child = spawn('node', [SCRIPT, '--box', boxPath, '--pass-stdin'], { env: baseEnv, stdio: ['pipe', 'ignore', 'ignore'] })
  child.stdin!.end(PHRASE + '\n')
  const BASE = `http://127.0.0.1:${PORT}`
  let health: { ok?: boolean; owner?: string } | null = null
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/health', { signal: AbortSignal.timeout(400) }); if (r.ok) { health = await r.json(); break } } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  ok(!!health && health.ok === true && health.owner === 'boxed', 'the right phrase on stdin opens the box — the daemon is up, owner: boxed')
  const env = environOf(child.pid!)
  ok(env !== null, 'the running process\'s environment is readable by this uid (which is exactly why the phrase must not be there)')
  ok(env !== null && !env.includes('KRAY_POT_SIGNER_PASS=') && !env.includes(PHRASE), 'the environment of the running pen carries NO phrase (nothing to read from /proc)')
  ok(!JSON.stringify(process.argv).includes(PHRASE) && !execFileSync('ps', ['-o', 'command=', '-p', String(child.pid)], { encoding: 'utf8' }).includes(PHRASE), 'the phrase is not in the daemon\'s argv either')
  try { child.kill('SIGKILL') } catch { /* gone */ }
  rmSync(dir, { recursive: true, force: true })
  console.log(`\n╚═ ${pass} passed — the phrase lives in a head and on a pipe, never in the environment of a running pen. 🔐₭`)
}
main().catch((e) => { console.error(e); process.exit(1) })
