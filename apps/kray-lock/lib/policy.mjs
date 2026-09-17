/**
 * Policy — the ONE file that is the door.
 *
 * Edit ids, quantities, true/false here. Everything else derives.
 * Never journaled (A2). Speak only proves ownerOf(★).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const DEFAULT_NODE = 'https://www.kray.network'

export function die(msg, code = 1) {
  console.error('kray-lock: ' + msg)
  process.exit(code)
}

export function arg(argv, flag, fallback = '') {
  const i = argv.indexOf(flag)
  return i > 0 ? String(argv[i + 1] || fallback) : fallback
}

export function has(argv, flag) {
  return argv.includes(flag)
}

function asBool(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false
  return fallback
}

function asNullInt(v) {
  if (v === undefined || v === null || v === '') return null
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n) || n < 0) die('quantity must be null or a non-negative integer')
  return n
}

function slugId(s) {
  return String(s || 'door')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'door'
}

/**
 * Normalize a raw policy.json into a sealed runtime policy.
 * Unknown fields are ignored (forward-compatible). Missing bools get elite defaults.
 */
export function normalizePolicy(raw, source, argv = process.argv) {
  if (!raw || typeof raw !== 'object') die('policy must be a JSON object')

  const enabled = asBool(raw.enabled, true)
  const audience = String(raw.audience || 'hold').trim().toLowerCase() || 'hold'
  if (!/^[a-z][a-z0-9._-]{0,31}$/.test(audience)) die('policy.audience invalid (short name)')

  const keysIn = Array.isArray(raw.keys) ? raw.keys : []
  if (!keysIn.length) die('policy.keys must list at least one id')

  const keys = keysIn.map((k, i) => {
    if (!k || typeof k !== 'object') die(`keys[${i}] must be an object`)
    const kind = String(k.kind || 'star').toLowerCase()
    const id = String(k.id || '').trim()
    if (kind === 'star' && !/^(0|[1-9]\d*)$/.test(id)) die(`keys[${i}].id must be a star number`)
    if (kind === 'ordinal' && !/^[0-9a-f]{64}i\d+$/i.test(id)) {
      die(`keys[${i}]: ordinal needs inscription id (…iN) — Speak path is stars today`)
    }
    if (kind !== 'star' && kind !== 'ordinal') die(`keys[${i}].kind must be star|ordinal`)
    return {
      kind,
      id: kind === 'star' ? id : id.toLowerCase(),
      enabled: asBool(k.enabled, true),
      maxEntries: asNullInt(k.maxEntries),
      label: String(k.label || '').slice(0, 64),
    }
  })

  const mode = String(raw.mode || (keys.length === 1 ? 'single' : 'any')).toLowerCase()
  if (mode !== 'single' && mode !== 'any' && mode !== 'collection') {
    die('policy.mode: single | any | collection')
  }
  if (mode === 'collection') {
    die('mode=collection is phase 2 — use mode=any with an explicit keys[] list')
  }

  const activeKeys = keys.filter((k) => k.enabled)
  if (!activeKeys.length) die('at least one keys[].enabled=true required')
  const starKeys = activeKeys.filter((k) => k.kind === 'star')
  if (!starKeys.length) die('at least one enabled kind=star key required (Speak is ready for stars)')

  const t = raw.transport && typeof raw.transport === 'object' ? raw.transport : {}
  const transport = {
    wifi: asBool(t.wifi, true),
    qr: asBool(t.qr, true),
    nfc: asBool(t.nfc, false),
    ble: asBool(t.ble, false),
    uwb: asBool(t.uwb, false),
    mesh: asBool(t.mesh, false),
  }
  if (!transport.wifi && !transport.qr && !transport.nfc && !transport.ble) {
    die('transport: enable at least one of wifi | qr | nfc | ble')
  }

  const s = raw.serve && typeof raw.serve === 'object' ? raw.serve : {}
  const serve = {
    host: String(s.host || arg(argv, '--host', '') || process.env.KRAY_LOCK_HOST || '0.0.0.0'),
    port: Math.max(
      1,
      Number(arg(argv, '--port', '') || s.port || process.env.KRAY_LOCK_PORT || 8787) || 8787,
    ),
    doorPage: asBool(s.doorPage, true),
    cors: asBool(s.cors, true),
  }

  const sec = raw.security && typeof raw.security === 'object' ? raw.security : {}
  const security = {
    antiReplay: asBool(sec.antiReplay, true),
    failClosed: asBool(sec.failClosed, true),
  }

  const id = slugId(raw.id || raw.name || 'door')
  const name = String(raw.name || raw.id || 'Door').trim().slice(0, 64) || 'Door'

  return {
    enabled,
    id,
    name,
    audience,
    node: String(raw.node || DEFAULT_NODE).replace(/\/$/, ''),
    mode,
    keys,
    starKeys,
    maxEntriesTotal: asNullInt(raw.maxEntriesTotal),
    window: String(raw.window || 'forever').toLowerCase(),
    expiresAt: raw.expiresAt ? String(raw.expiresAt) : null,
    transport,
    serve,
    security,
    onUnlock: String(
      arg(argv, '--on-unlock', '') || raw.onUnlock || process.env.KRAY_LOCK_ON_UNLOCK || '',
    ).trim(),
    source,
  }
}

export function loadPolicy(argv = process.argv) {
  const path = arg(argv, '--policy', process.env.KRAY_LOCK_POLICY || '')
  if (path) {
    const raw = JSON.parse(readFileSync(resolve(path), 'utf8'))
    const policy = normalizePolicy(raw, resolve(path), argv)
    if (!policy.enabled) die(`policy.enabled=false — door “${policy.name}” is off`)
    return policy
  }

  const star = String(arg(argv, '--star', process.env.KRAY_LOCK_STAR || '')).trim()
  if (!/^(0|[1-9]\d*)$/.test(star)) {
    die('needs --policy FILE  or  --star N  ·  or:  create --name "…" --star N')
  }
  const audience =
    String(arg(argv, '--audience', process.env.KRAY_LOCK_AUDIENCE || 'hold'))
      .trim()
      .toLowerCase() || 'hold'
  const policy = normalizePolicy(
    {
      id: `star-${star}`,
      name: arg(argv, '--name', '') || `★ ${star}`,
      enabled: true,
      audience,
      node: arg(argv, '--node', process.env.KRAY_LOCK_NODE || DEFAULT_NODE),
      mode: 'single',
      keys: [{ kind: 'star', id: star, enabled: true, maxEntries: null }],
      onUnlock: arg(argv, '--on-unlock', process.env.KRAY_LOCK_ON_UNLOCK || ''),
    },
    null,
    argv,
  )
  return policy
}

/** Living allowlist row for a star (enabled keys only). */
export function keyAllowed(policy, star) {
  const s = String(star)
  return policy.starKeys.find((k) => k.id === s) || null
}
