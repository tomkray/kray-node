/**
 * Challenge + acceptProof — Speak on the book, policy on the door.
 */
import { spawn } from 'node:child_process'
import { keyAllowed, die } from './policy.mjs'
import { makeLedgerApi, quotaOk } from './ledger.mjs'
import { parseStarFromMessage } from './bounce.mjs'

async function fetchJson(url, init) {
  const r = await fetch(url, init)
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) {
    const err = new Error(j.error || `HTTP ${r.status}`)
    err.status = r.status
    throw err
  }
  return j
}

export function makeUnlockApi(stateDir) {
  const { ledgerPath, loadLedger, saveLedger } = makeLedgerApi(stateDir)

  async function challenge(policy, star) {
    const key = keyAllowed(policy, star)
    if (!key) {
      throw Object.assign(new Error(`★${star} is not on this door's allowlist`), { status: 403 })
    }
    const q = new URLSearchParams({ star: String(star), audience: policy.audience })
    return fetchJson(`${policy.node}/api/kraynet/speak?${q}`)
  }

  async function verifyOnNode(policy, proof) {
    return fetchJson(`${policy.node}/api/kraynet/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: proof.message,
        from: proof.from || proof.owner,
        signature: proof.signature,
        publicKey: proof.publicKey,
        scheme: proof.scheme || 'kraywallet',
      }),
    })
  }

  function runUnlockHook(policy, env) {
    const cmd = policy.onUnlock
    if (!cmd) {
      console.log('UNLOCK — math + policy passed (no onUnlock hook).')
      return Promise.resolve(0)
    }
    return new Promise((resolveExit) => {
      const child = spawn(cmd, {
        shell: true,
        env: { ...process.env, ...env },
        stdio: 'inherit',
      })
      child.on('exit', (code) => resolveExit(code ?? 1))
      child.on('error', (e) => {
        console.error('unlock hook failed:', e.message)
        resolveExit(1)
      })
    })
  }

  async function acceptProof(policy, proof) {
    if (!proof || typeof proof !== 'object') {
      if (policy.security.failClosed) die('proof object required')
      throw new Error('proof object required')
    }
    const star =
      String(proof.star || '').trim() || parseStarFromMessage(proof.message) || ''
    if (!/^(0|[1-9]\d*)$/.test(star)) die('proof must name a star')
    const keyRow = keyAllowed(policy, star)
    if (!keyRow) die(`★${star} is not allowed on door ${policy.id}`)
    if (proof.audience && String(proof.audience) !== policy.audience) {
      die(`proof audience ${proof.audience} ≠ door audience ${policy.audience}`)
    }

    const ledger = loadLedger(policy)
    const quota = quotaOk(policy, ledger, keyRow)
    if (quota) die(quota)

    const sidHint = String(proof.speakId || '').trim()
    if (policy.security.antiReplay && sidHint && ledger.speakIds.includes(sidHint)) {
      die('speakId already used on this door (replay)')
    }

    const verdict = await verifyOnNode(policy, proof)
    const speakId = String(verdict.speakId || sidHint || '')
    if (!speakId) die('node returned no speakId')
    if (policy.security.antiReplay && ledger.speakIds.includes(speakId)) {
      die('speakId already used on this door (replay)')
    }
    if (String(verdict.star || star) !== star) die('verified star mismatch')

    ledger.speakIds.push(speakId)
    ledger.byKey[star] = Math.max(0, Math.floor(Number(ledger.byKey[star] || 0))) + 1
    ledger.total += 1
    saveLedger(policy, ledger)

    const left =
      keyRow.maxEntries == null ? null : Math.max(0, keyRow.maxEntries - ledger.byKey[star])

    const code = await runUnlockHook(policy, {
      KRAY_LOCK_ID: policy.id,
      KRAY_LOCK_NAME: policy.name,
      KRAY_LOCK_STAR: star,
      KRAY_LOCK_AUDIENCE: policy.audience,
      KRAY_LOCK_SPEAK_ID: speakId,
      KRAY_LOCK_OWNER: String(verdict.owner || proof.from || ''),
      KRAY_LOCK_ENTRIES_LEFT: left == null ? 'unlimited' : String(left),
    })

    return {
      ok: true,
      unlocked: true,
      door: policy.id,
      doorName: policy.name,
      star,
      audience: policy.audience,
      label: keyRow.label || undefined,
      speakId,
      owner: verdict.owner,
      entriesUsed: ledger.byKey[star],
      entriesLeft: left,
      doorTotal: ledger.total,
      hookExit: code,
    }
  }

  return { challenge, acceptProof, ledgerPath, loadLedger }
}
