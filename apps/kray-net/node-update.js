/**
 * Door 2 guided update — same gesture as kraywallet.com "Update my install folder".
 * Writes official *source* into the clone the user picks. Never journal, keys, or node_modules.
 * Fail-closed: zip sha256 must match /api/node-version. Zip URL is same-origin only.
 */
(function () {
  'use strict'

  var FORBIDDEN = [
    'follower/', 'node_modules/', '.git/', 'ops/', 'signet/', 'apps/kray-api/',
    'apps/kray-net/data', 'apps/kray-net/regtest-harness/', 'apps/kray-net/signet-harness/',
  ]
  var FORBIDDEN_FILE = /(?:^|\/)(?:vault-keys\.env|owner\.box|node-hot\.env|\.kray-sync-rev)$/i

  function $(id) { return document.getElementById(id) }
  function setStatus(msg, kind) {
    var el = $('nodeUpStatus')
    if (!el) return
    el.textContent = msg || ''
    el.classList.remove('ok', 'bad')
    if (kind === 'ok') el.classList.add('ok')
    if (kind === 'err') el.classList.add('bad')
  }

  function forbiddenPath(rel) {
    var p = String(rel || '').replace(/^\/+/, '').replace(/\\/g, '/')
    if (!p || p.indexOf('..') !== -1) return true
    if (FORBIDDEN_FILE.test(p)) return true
    for (var i = 0; i < FORBIDDEN.length; i++) {
      var pre = FORBIDDEN[i]
      if (p === pre.replace(/\/$/, '') || p.indexOf(pre) === 0) return true
    }
    return false
  }

  function stripSharedPrefix(names) {
    if (!names.length) return function (n) { return n }
    var first = names[0].split('/')[0]
    var roots = { scripts: 1, apps: 1, docs: 1, manifesto: 1, 'package.json': 1, 'README.md': 1 }
    if (roots[first]) return function (n) { return n }
    var all = names.every(function (n) { return n === first || n.indexOf(first + '/') === 0 })
    if (!all) return function (n) { return n }
    return function (n) { return n === first ? '' : n.slice(first.length + 1) }
  }

  function u16(b, o) { return b[o] | (b[o + 1] << 8) }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot inflate the zip — use Download ZIP and extract by hand.')
    var ds = new DecompressionStream('deflate-raw')
    var stream = new Blob([bytes]).stream().pipeThrough(ds)
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }

  async function readZip(buf) {
    var u = new Uint8Array(buf)
    var out = []
    var i = 0
    while (i + 30 <= u.length && u32(u, i) === 0x04034b50) {
      var method = u16(u, i + 8)
      var comp = u32(u, i + 18)
      var uncomp = u32(u, i + 22)
      var nlen = u16(u, i + 26)
      var elen = u16(u, i + 28)
      var name = new TextDecoder().decode(u.subarray(i + 30, i + 30 + nlen))
      var start = i + 30 + nlen + elen
      var slice = u.subarray(start, start + comp)
      var data
      if (method === 0) data = slice
      else if (method === 8) data = await inflateRaw(slice)
      else throw new Error('zip uses an unsupported method')
      if (data.length !== uncomp && method === 8) throw new Error('zip inflate size mismatch')
      if (name && !name.endsWith('/')) out.push({ name: name, data: data })
      i = start + comp
    }
    if (!out.length) throw new Error('zip contained no files')
    return out
  }

  async function sha256hex(buf) {
    var d = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(d)).map(function (b) { return b.toString(16).padStart(2, '0') }).join('')
  }

  async function ensureDir(root, parts) {
    var dir = root
    for (var i = 0; i < parts.length; i++) dir = await dir.getDirectoryHandle(parts[i], { create: true })
    return dir
  }

  // traverse WITHOUT creating — read the user's existing file for the up-to-date check (throws if absent)
  async function getDirNoCreate(root, parts) {
    var dir = root
    for (var i = 0; i < parts.length; i++) dir = await dir.getDirectoryHandle(parts[i])
    return dir
  }
  function bytesEqual(a, b) {
    if (a.length !== b.length) return false
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  async function validateKrayNetFolder(dirHandle) {
    try {
      var fh = await dirHandle.getFileHandle('package.json')
      var j = JSON.parse(await (await fh.getFile()).text())
      if (j && (j.name === 'kray-node' || j.name === 'kray-network' || j.name === 'kray-net')) return
    } catch (_) { /* try follow script */ }
    try {
      var scripts = await dirHandle.getDirectoryHandle('scripts')
      await scripts.getFileHandle('kray-follow.mjs')
      return
    } catch (_) { /* fall through */ }
    throw new Error('Pick the KRAY-NODE folder (the one with scripts/kray-follow.mjs), not follower/ or a random directory.')
  }

  var published = null

  async function loadVersion() {
    var r = await fetch('/api/node-version', { cache: 'no-store' })
    if (!r.ok) throw new Error('This node has no software pack yet — the writer needs the new server.')
    var info = await r.json()
    if (!info || !info.sha256 || !/^[0-9a-f]{64}$/i.test(info.sha256)) throw new Error('node-version is missing sha256 — refuse.')
    published = info
    var meta = $('nodeUpMeta')
    if (meta) {
      var short = String(info.v || 'running').slice(0, 12)
      var repo = String(info.repo || 'https://github.com/tomkray/kray-node').replace(/^https:\/\//, '')
      var branch = info.branch || 'main'
      meta.innerHTML = 'This door · official <a href="' + String(info.repo || 'https://github.com/tomkray/kray-node') + '" target="_blank" rel="noopener">' + repo + '</a> · ' + branch + ' · ' + short + ' · ' + (info.files || '?') + ' files · sha256 ' + String(info.sha256).slice(0, 12) + '…'
    }
    var zipA = $('nodeUpZip')
    if (zipA) zipA.href = '/downloads/kray-node.zip'
    return info
  }

  async function runUpdate() {
    var btn = $('nodeUpBtn')
    if (!window.showDirectoryPicker) {
      setStatus('This browser cannot write folders. Use Download ZIP and extract into the same clone, then restart follow.', 'err')
      return
    }
    try {
      if (!published) await loadVersion()
      if (btn) { btn.disabled = true; btn.textContent = 'Choose folder…' }
      setStatus('Select the KRAY-NODE folder you already cloned…')
      var dir = await window.showDirectoryPicker({ mode: 'readwrite' })
      await validateKrayNetFolder(dir)

      if (btn) btn.textContent = 'Downloading…'
      setStatus('Downloading the official source pack…')
      var res = await fetch('/downloads/kray-node.zip', { cache: 'no-store' })
      if (!res.ok) throw new Error('Download failed (' + res.status + ')')
      var buf = await res.arrayBuffer()
      var got = await sha256hex(buf)
      if (got !== String(published.sha256).toLowerCase()) throw new Error('sha256 mismatch — zip refused. No files written.')

      var entries = await readZip(buf)
      var strip = stripSharedPrefix(entries.map(function (e) { return e.name }))

      // ── IS THIS FOLDER ALREADY CURRENT? Compare every official file to what is on disk BEFORE writing —
      //    the same "up to date / update available" signal the KrayWallet shows, here for the node folder. ──
      if (btn) btn.textContent = 'Checking…'
      setStatus('Comparing your node folder to the official source…')
      var differ = 0, missing = 0, current = 0
      for (var c = 0; c < entries.length; c++) {
        var crel = strip(entries[c].name).replace(/^\/+/, '')
        if (!crel || forbiddenPath(crel)) continue
        var cparts = crel.split('/'); var cfile = cparts.pop()
        try {
          var cdir = cparts.length ? await getDirNoCreate(dir, cparts) : dir
          var cbuf = new Uint8Array(await (await (await cdir.getFileHandle(cfile)).getFile()).arrayBuffer())
          if (bytesEqual(cbuf, entries[c].data)) current++; else differ++
        } catch (_) { missing++ }
      }
      if (differ === 0 && missing === 0) {
        setStatus('✓ Your node is already up to date — all ' + current + ' official files match (sha256 ' + String(published.sha256).slice(0, 12) + '…). Nothing to write.', 'ok')
        return
      }

      if (btn) btn.textContent = 'Writing files…'
      setStatus((differ + missing) + ' file(s) behind the official source (' + current + ' already current) — writing the update; journal and keys untouched…')
      var written = 0, skipped = 0
      for (var i = 0; i < entries.length; i++) {
        var rel = strip(entries[i].name).replace(/^\/+/, '')
        if (!rel || forbiddenPath(rel)) { skipped++; continue }
        var parts = rel.split('/')
        var fileName = parts.pop()
        var parent = parts.length ? await ensureDir(dir, parts) : dir
        var fh = await parent.getFileHandle(fileName, { create: true })
        var w = await fh.createWritable()
        await w.write(entries[i].data)
        await w.close()
        written++
      }
      setStatus('Done — wrote ' + written + ' files' + (skipped ? ' (skipped ' + skipped + ' protected paths)' : '') + '. Restart kray-follow --watch (or follow-this-network.cmd). History and keys stayed.', 'ok')
    } catch (e) {
      if (e && e.name === 'AbortError') setStatus('Cancelled — no files changed.')
      else setStatus((e && e.message) || 'Update failed.', 'err')
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Update my node folder' }
    }
  }

  function boot() {
    var btn = $('nodeUpBtn')
    if (!btn) return
    btn.addEventListener('click', runUpdate)
    loadVersion().catch(function () {
      setStatus('Pack not served yet — writer still on an older server. Download ZIP will work after that process restarts.', 'err')
    })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
