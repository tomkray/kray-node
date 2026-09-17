/**
 * Local anti-replay ledger — beside the door, never on the journal.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function makeLedgerApi(stateDir) {
  function ledgerPath(policy) {
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true })
    return join(stateDir, `ledger-${policy.id}-${policy.audience}.json`)
  }

  function loadLedger(policy) {
    const p = ledgerPath(policy)
    if (!existsSync(p)) return { speakIds: [], byKey: {}, total: 0, window: Date.now() }
    try {
      const j = JSON.parse(readFileSync(p, 'utf8'))
      return {
        speakIds: Array.isArray(j.speakIds) ? j.speakIds : [],
        byKey: j.byKey && typeof j.byKey === 'object' ? j.byKey : {},
        total: Math.max(0, Math.floor(Number(j.total) || 0)),
        window: j.window || policy.window,
      }
    } catch {
      return { speakIds: [], byKey: {}, total: 0, window: Date.now() }
    }
  }

  function saveLedger(policy, ledger) {
    writeFileSync(
      ledgerPath(policy),
      JSON.stringify(
        {
          id: policy.id,
          audience: policy.audience,
          speakIds: ledger.speakIds.slice(-800),
          byKey: ledger.byKey,
          total: ledger.total,
          window: policy.window,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    )
  }

  return { ledgerPath, loadLedger, saveLedger }
}

export function quotaOk(policy, ledger, keyRow) {
  if (policy.expiresAt) {
    const t = Date.parse(policy.expiresAt)
    if (Number.isFinite(t) && Date.now() > t) return 'this door has expired'
  }
  if (policy.maxEntriesTotal != null && ledger.total >= policy.maxEntriesTotal) {
    return 'door entry limit reached'
  }
  if (keyRow.maxEntries != null) {
    const used = Math.max(0, Math.floor(Number(ledger.byKey[keyRow.id] || 0)))
    if (used >= keyRow.maxEntries) return `★${keyRow.id} has no entries left (${keyRow.maxEntries})`
  }
  return null
}
