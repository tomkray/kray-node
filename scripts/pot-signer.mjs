#!/usr/bin/env node
/**
 * POT SIGNER — the consolidation owner key lives HERE, never in the public node.
 *
 *   node scripts/pot-signer.mjs --env signet/vault-keys.env
 *   KRAY_CONSOLIDATION_SECRET=… KRAY_POT_SIGNER_TOKEN=… node scripts/pot-signer.mjs
 *
 * Binds 127.0.0.1 only. Refuses to start without a token and the 32-byte secret.
 * Never logs the secret. The public node POSTs a rebuild bundle; this process
 * re-verifies the signed rune-exit, rebuilds the payout, and only then signs.
 *
 * The public node must set KRAY_POT_SIGNER_URL=http://127.0.0.1:<port> and the
 * same token — and must NOT source the owner secret (use signet/node-hot.env).
 * When that URL is set the node will not touch a local secret even if one is
 * still in its env.
 *
 * This file is the public door. It must never import scripts/operator/.
 */
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { authorizePotSign, planFromWire, fundingFromWire, utxosFromWire, paramsFromWire } from '../apps/kray-core/src/protocol/pot-signer.ts'
import { openOwnerSecret, parseOwnerBox } from '../apps/kray-core/src/protocol/pot-key-box.ts'

function loadEnvFile(path) {
  if (!existsSync(path)) throw new Error('env file not found: ' + path)
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

const envArg = process.argv.indexOf('--env')
const envPath = envArg >= 0 && process.argv[envArg + 1] ? process.argv[envArg + 1] : ''
const fileEnv = envPath ? loadEnvFile(envPath) : {}
const boxArg = process.argv.indexOf('--box')
const boxFlag = boxArg >= 0 && process.argv[boxArg + 1] ? process.argv[boxArg + 1] : ''

const BIND = '127.0.0.1'
const PORT = parseInt(process.env.KRAY_POT_SIGNER_PORT || fileEnv.KRAY_POT_SIGNER_PORT || '4479', 10) || 4479
const TOKEN = (process.env.KRAY_POT_SIGNER_TOKEN || fileEnv.KRAY_POT_SIGNER_TOKEN || '').trim()
const envNorm = String(envPath || '').replace(/\\/g, '/')
const fromSignetHouse = /(?:^|\/)signet\//.test(envNorm)
const fromMainHouse = /(?:^|\/)mainnet\//.test(envNorm)
if (fromMainHouse && PORT === 4479) {
  console.error('✗ pot-signer: mainnet vault refuses :4479 — that loopback door is the Signet pen. Use 4579 (primary) or 4580 (fallback)')
  process.exit(1)
}
if (fromMainHouse && PORT !== 4579 && PORT !== 4580) {
  console.error('✗ pot-signer: mainnet pen is :4579 (primary) or :4580 (fallback) — not :' + PORT)
  process.exit(1)
}
if (fromSignetHouse && (PORT === 4579 || PORT === 4580)) {
  console.error('✗ pot-signer: Signet vault refuses :' + PORT + ' — those doors are the mainnet pens')
  process.exit(1)
}

function die(m) {
  console.error('✗ pot-signer: ' + m)
  process.exit(1)
}

function resolveOwnerSecret() {
  const pass = (process.env.KRAY_POT_SIGNER_PASS || '').trim()
  let boxPath = boxFlag || process.env.KRAY_OWNER_BOX || fileEnv.KRAY_OWNER_BOX || ''
  if (!boxPath && envPath && pass) {
    const sibling = join(dirname(envPath), 'owner.box')
    if (existsSync(sibling)) boxPath = sibling
  }
  if (boxPath) {
    if (pass.length < 16) die('an owner box is present — set KRAY_POT_SIGNER_PASS (16+ chars, never log it)')
    if (!existsSync(boxPath)) die('owner box not found: ' + boxPath)
    try {
      return Buffer.from(openOwnerSecret(parseOwnerBox(readFileSync(boxPath, 'utf8')), pass))
    } catch (e) {
      die(e instanceof Error ? e.message : String(e))
    }
  }
  const hex = (process.env.KRAY_CONSOLIDATION_SECRET || fileEnv.KRAY_CONSOLIDATION_SECRET || '').trim().toLowerCase()
  if (/^[0-9a-f]{64}$/.test(hex)) {
    console.warn('⚠ pot-signer: owner key is plaintext — seal it with scripts/seal-vault-owner.mjs when you choose a phrase')
    return Buffer.from(hex, 'hex')
  }
  die('no owner key — plaintext secret or an owner.box + KRAY_POT_SIGNER_PASS')
}

if (TOKEN.length < 16) die('KRAY_POT_SIGNER_TOKEN must be at least 16 characters — this is the only door to the pot key')
const FROM_BOX = !!(boxFlag || process.env.KRAY_OWNER_BOX || fileEnv.KRAY_OWNER_BOX || (envPath && process.env.KRAY_POT_SIGNER_PASS && existsSync(join(dirname(envPath), 'owner.box'))))
const SECRET = resolveOwnerSecret()
// Phrase and plaintext owner must not sit in this process's environ after unlock.
// A `ps e` on a stolen laptop would otherwise reprint them. The 32-byte key
// remains in SECRET (RAM) while we are up — that is honest, not hidden.
delete process.env.KRAY_POT_SIGNER_PASS
delete process.env.KRAY_POT_SEAL_PASS
delete process.env.KRAY_CONSOLIDATION_SECRET

function tokenOk(got) {
  const raw = String(got || '')
  const bearer = raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw.trim()
  const a = Buffer.from(bearer)
  const b = Buffer.from(TOKEN)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let n = 0
    req.on('data', (c) => {
      n += c.length
      if (n > limit) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res, code, body) {
  const s = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(s)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    return send(res, 200, { ok: true, bind: BIND, port: PORT, owner: FROM_BOX ? 'boxed' : 'plaintext' })
  }
  if (req.method !== 'POST' || url.pathname !== '/sign') {
    return send(res, 404, { ok: false, reason: 'no route' })
  }
  const auth = req.headers.authorization || req.headers['x-kray-pot-signer'] || ''
  if (!tokenOk(auth)) return send(res, 401, { ok: false, reason: 'unauthorized' })
  let body
  try {
    const raw = await readBody(req, 1_000_000)
    body = JSON.parse(raw)
  } catch {
    return send(res, 400, { ok: false, reason: 'a pot sign needs a JSON rebuild bundle' })
  }
  if (!body || typeof body !== 'object') return send(res, 400, { ok: false, reason: 'a pot sign needs a JSON rebuild bundle' })
  let claimed = body.claimedSighashes
  if (!Array.isArray(claimed)) claimed = []
  let verdict
  try {
    verdict = authorizePotSign({
      network: String(body.network || ''),
      exit: body.exit,
      ...(Array.isArray(body.exits) ? { exits: body.exits } : {}),
      params: paramsFromWire(body.params || {}),
      vaultUtxos: utxosFromWire(body.vaultUtxos),
      funding: fundingFromWire(body.funding || {}),
      plan: planFromWire(body.plan || {}),
      claimedSighashes: claimed.map(String),
    }, SECRET)
  } catch (e) {
    return send(res, 400, { ok: false, reason: e instanceof Error ? e.message : String(e) })
  }
  if (!verdict.ok) return send(res, 403, { ok: false, reason: verdict.reason })
  return send(res, 200, { ok: true, depositorSigs: verdict.depositorSigs })
})

server.listen(PORT, BIND, () => {
  console.log(`pot-signer listening on http://${BIND}:${PORT} — owner key is in this process only (${FROM_BOX ? 'opened from box' : 'plaintext'})`)
})
