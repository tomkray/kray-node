/**
 * THE DATA-DIRECTORY LOCK — one writer, or none.
 *
 * WHY THIS EXISTS. Every journal in this node is append-only and hash-chained:
 * each line's `prevHash` is the previous line's hash, computed from the writer's
 * OWN in-memory head. That makes tampering impossible to hide — and it makes TWO
 * WRITERS fatal. Two processes on one directory each believe they own the head,
 * so both append at seq N, both at N+1, and the chain forks inside a single file.
 * The ledger's tripwire catches it at the next boot and refuses to run, which is
 * correct and useless: the history is already ruined.
 *
 * This was not theory. It happened here — a second node was started while the
 * first still held the directory, and seqs 36 through 97 were written twice. The
 * tripwire fired exactly as designed and the node fail-closed, but a chain that a
 * mistyped command can destroy is not a chain that lasts ten thousand years.
 *
 * THE FIX is the one every serious database uses: take an exclusive lock on the
 * directory at open, refuse to start if a LIVE process holds it, and reclaim it
 * if the holder is gone.
 *
 *   · `O_EXCL` creation is atomic in POSIX and on Windows, so two processes
 *     racing to create the file cannot both win — no lock-check-then-write gap.
 *   · A crashed node leaves a STALE lock. Refusing to boot after a power cut
 *     would be its own outage, so the holder's liveness is checked with
 *     `kill(pid, 0)` (a signal-less existence probe) and a dead holder's lock is
 *     reclaimed, loudly.
 *   · The lock records pid, host and start time. `host` matters: on a shared or
 *     networked volume a pid from another machine says nothing about liveness, so
 *     a foreign host's lock is NEVER reclaimed automatically — the operator is
 *     told exactly what to look at instead of a guess being made for them.
 *
 * The lock protects the FILES, not the truth. It is not consensus, it grants no
 * authority, and deleting it forges nothing: the roots are on Bitcoin and anyone
 * can still recompute them. It exists so an accident cannot cost a history.
 */
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { hostname } from 'node:os'

export interface LockInfo {
  pid: number
  host: string
  at: number
  network: string
  /** The directory this lock was taken FOR. A lock file travels when a data
   *  directory is copied (a backup, a container image, `cp -r`), and a copied
   *  lock names no holder of the COPY — it would otherwise make a perfectly
   *  safe restored directory look permanently occupied by a live process. */
  dir?: string
}

/** Is a process still alive? Signal 0 probes existence without delivering one. */
function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e: unknown) {
    // EPERM means it EXISTS but belongs to another user — alive, and not ours.
    return (e as { code?: string }).code === 'EPERM'
  }
}

export class DataDirLock {
  private readonly path: string
  private held = false
  readonly info: LockInfo

  /**
   * Take the directory. Throws if a live process holds it — the ONLY safe
   * outcome, because the alternative is two writers on one hash chain.
   */
  constructor(dataDir: string, network: string) {
    this.path = join(dataDir, `kray-node-${network}.lock`)
    this.info = { pid: process.pid, host: hostname(), at: Date.now(), network, dir: resolve(dataDir) }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // 'wx' = O_CREAT | O_EXCL: atomic, so a race has exactly one winner
        const fd = openSync(this.path, 'wx')
        try { writeSync(fd, JSON.stringify(this.info)) } finally { closeSync(fd) }
        this.held = true
        return
      } catch (e: unknown) {
        if ((e as { code?: string }).code !== 'EEXIST') throw e
      }

      const prior = this.read()
      if (prior === null) {
        // Unreadable or malformed: it cannot name a holder, so it cannot defend
        // one. Clear it and retry once — the O_EXCL race decides any tie.
        try { unlinkSync(this.path) } catch (_) { /* another process won the race; the retry will see its lock */ }
        continue
      }
      // A COPIED LOCK. The file names a directory that is not this one, so it was
      // carried in by a copy and guards nothing here. Clearing it is not a
      // weakening: the original directory keeps its own lock, untouched.
      if (prior.dir !== undefined && prior.dir !== this.info.dir) {
        console.warn(
          `kray-node: found a lock copied from ${prior.dir} — it names no holder of this directory, so it is being cleared. ` +
          `The original directory keeps its own lock.`,
        )
        try { unlinkSync(this.path) } catch (_) { /* another process cleared it first; the retry decides */ }
        continue
      }
      if (prior.host !== this.info.host) {
        throw new Error(
          `kray-node: this data directory is locked by pid ${prior.pid} on ANOTHER HOST (${prior.host}). ` +
          `Two writers on one hash-chained journal destroy it, and a pid from another machine says nothing about liveness here, ` +
          `so this lock will not be reclaimed automatically. Stop that node, then delete ${this.path}. Directory: ${dataDir}`,
        )
      }
      if (alive(prior.pid)) {
        throw new Error(
          `kray-node: this data directory is already open by pid ${prior.pid} (since ${new Date(prior.at).toISOString()}). ` +
          `Refusing to start: two processes appending to one hash-chained journal fork it inside the file and ruin the history. ` +
          `Stop that node first. Directory: ${dataDir}`,
        )
      }
      // A dead holder — a crash or a kill. Reclaim, but say so out loud: an
      // unclean shutdown is worth an operator's attention, not a silent pass.
      console.warn(
        `kray-node: reclaiming the data directory from pid ${prior.pid}, which is no longer running ` +
        `(locked at ${new Date(prior.at).toISOString()}). The journals are hash-chained and were verified on replay, ` +
        `so any half-written tail would have been refused rather than trusted.`,
      )
      try { unlinkSync(this.path) } catch (_) { /* someone else reclaimed it first; the retry decides */ }
    }
    throw new Error(`kray-node: could not take the data-directory lock at ${this.path} — another process is contending for it. Directory: ${dataDir}`)
  }

  /** What the lock file says, or null if it is missing or unreadable. */
  private read(): LockInfo | null {
    try {
      if (!existsSync(this.path)) return null
      const o = JSON.parse(readFileSync(this.path, 'utf8')) as LockInfo
      return typeof o?.pid === 'number' && typeof o?.host === 'string' ? o : null
    } catch (_) { return null }
  }

  /**
   * DO WE STILL OWN THE DIRECTORY WE ARE WRITING TO?
   *
   * The lock stops a second process from OPENING a live directory. It cannot stop
   * the directory itself from being moved, renamed or deleted underneath us — and
   * that is not hypothetical: it happened here. A running node's data directory
   * was renamed, its lock file travelled away with it, a second node saw an empty
   * path and started cleanly, and both then appended to the same recreated file.
   * The journal ended up interleaving two histories line by line
   * (…28, 133, 29, 134, 135, 30…), which no chain check can repair afterwards.
   *
   * Appends re-resolve the path every time (`openSync(path, 'a')`), so a moved
   * directory is silently RECREATED rather than refused. The only defence is to
   * keep asking whether the lock we took is still the lock that is there.
   *
   * Returns a reason string when ownership is LOST, or null when all is well.
   * Cheap enough to call on a timer: one small read.
   */
  ownershipLost(): string | null {
    if (!this.held) return null
    const cur = this.read()
    if (cur === null) {
      return existsSync(this.path)
        ? 'the data-directory lock is unreadable — the directory was replaced underneath this node'
        : 'the data-directory lock has VANISHED — the directory was moved, renamed or deleted underneath this node'
    }
    if (cur.pid !== process.pid || cur.host !== this.info.host) {
      return `the data-directory lock is now held by pid ${cur.pid} on ${cur.host} — another node took the directory underneath this one`
    }
    if (cur.at !== this.info.at) {
      return 'the data-directory lock was rewritten — this node no longer owns the history it is appending to'
    }
    return null
  }

  /** Release the directory. Idempotent, and safe to call from an exit handler. */
  release(): void {
    if (!this.held) return
    this.held = false
    try {
      // only remove OUR lock — never another process's, even if it looks stale
      const cur = this.read()
      if (cur && cur.pid === process.pid && cur.host === this.info.host && cur.dir === this.info.dir) unlinkSync(this.path)
    } catch (_) { /* the directory may already be gone at shutdown; nothing to protect */ }
  }
}
