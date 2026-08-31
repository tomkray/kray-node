/**
 * File-tab batch — folder / multi-file drops become a queue of ordinary inscribe acts.
 * Consensus is unchanged: prepare-batch / submit-batch, one signature and one ₭ burn per star.
 */
(function (global) {
  'use strict'

  var MAX = 200
  var WAVE_BYTES = 8000000
  var CEIL = 10000000
  var DOC_CAP = 8192
  var JUNK = /^(?:\.DS_Store|Thumbs\.db|desktop\.ini)$/i

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    })
  }

  function junkName(name) {
    if (!name) return true
    if (name.charAt(0) === '.') return true
    if (name.indexOf('._') === 0) return true
    return JUNK.test(name)
  }

  var EXT = {
    mp3: 'audio/mpeg', mpeg: 'audio/mpeg', mpga: 'audio/mpeg',
    wav: 'audio/wav', wave: 'audio/wav', flac: 'audio/flac',
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus',
    m4a: 'audio/mp4', aac: 'audio/aac', aiff: 'audio/aiff', aif: 'audio/aiff', wma: 'audio/x-ms-wma',
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
    mkv: 'video/x-matroska', avi: 'video/x-msvideo', ogv: 'video/ogg',
    glb: 'model/gltf-binary', gltf: 'model/gltf+json', glft: 'model/gltf+json',
    obj: 'model/obj', stl: 'model/stl', fbx: 'model/fbx', usdz: 'model/vnd.usdz+zip', ply: 'model/ply', '3mf': 'model/3mf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
    pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
    json: 'application/json', wasm: 'application/wasm',
    md: 'text/markdown', markdown: 'text/markdown', mdown: 'text/markdown',
    html: 'text/html', htm: 'text/html', css: 'text/css',
    js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
    txt: 'text/plain', csv: 'text/csv'
  }

  function mimeOf(file) {
    var t = String((file && file.type) || '').trim().split(';')[0]
    var n = (file && file.name) || ''
    var ext = (n.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1]
    var guessed = ext && EXT[ext]
    var generic = !t || t === 'application/octet-stream' || t === 'text/plain' || t === 'application/json'
    if (guessed && (generic || (t === 'application/json' && ext !== 'json'))) return guessed
    if (t) return t
    return guessed || 'application/octet-stream'
  }

  // the shelf glyph a non-image tile shows in the batch grid (matches the library shelves)
  function fbGlyph(t) {
    t = String(t || '')
    if (t === 'application/json') return '{ }'
    if (/^model\//.test(t)) return '◉'
    if (/^audio\//.test(t)) return '♪'
    if (/^video\//.test(t)) return '▶'
    return '◇'
  }

  function pathOf(file) {
    var p = file.webkitRelativePath || file.__rel || file.name || 'file'
    return String(p).replace(/^\/+/, '')
  }

  function folderOf(path) {
    var i = path.lastIndexOf('/')
    return i < 0 ? '' : path.slice(0, i)
  }

  function nat(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  }

  // Drop order: 01-indole.md, 02-canon.md… — nat() reads the prefix.
  // The baptism is still the word after the number (stemKey strips 01-).
  var SKELETON = [
    'indole', 'canon', 'foundation', 'divine', 'algorithm', 'kray',
    'bitcoin', 'fenyx', 'consensus', 'diretriz', 'consciousness', 'lightdoor',
  ]
  // after the twelve — parent-safe (satoshi before donation before bornstrict;
  // paper before its contract children; poll after glow)
  var LATER = [
    'satoshi', 'donation', 'nums', 'psbt', 'rune', 'bridge', 'glow',
    'whitepaper', 'bornstrict', 'witness',
    'paper', 'being', 'escrow', 'tunnel', 'vest', 'scroll', 'raffle',
    'mint', 'luz', 'poll', 'abundance', 'origin', 'eternize', 'library',
  ]
  var SPINE = SKELETON.concat(LATER)

  function stemKey(path) {
    var base = String(path || '').split('/').pop() || ''
    return base.replace(/\.[^.]+$/, '').toLowerCase().replace(/^\d+[-_.]/, '')
  }

  function bySpine(a, b) {
    var ia = SPINE.indexOf(stemKey(a))
    var ib = SPINE.indexOf(stemKey(b))
    var ra = ia < 0 ? SPINE.length : ia
    var rb = ib < 0 ? SPINE.length : ib
    if (ra !== rb) return ra - rb
    return nat(a, b)
  }

  function flatten(arrs) {
    return arrs.reduce(function (a, b) { return a.concat(b) }, [])
  }

  function readDir(reader) {
    return new Promise(function (resolve, reject) {
      var all = []
      function tick() {
        reader.readEntries(function (batch) {
          if (!batch.length) return resolve(all)
          all = all.concat(batch)
          tick()
        }, reject)
      }
      tick()
    })
  }

  function stampPath(file, rel) {
    try { Object.defineProperty(file, '__rel', { value: rel, configurable: true }) } catch (_) { file.__rel = rel }
    return file
  }

  function walkEntry(entry, prefix) {
    prefix = prefix || ''
    if (!entry) return Promise.resolve([])
    if (entry.isFile) {
      return new Promise(function (resolve, reject) {
        entry.file(function (f) {
          var rel = (prefix ? prefix + '/' : '') + (entry.name || f.name)
          resolve([stampPath(f, rel)])
        }, reject)
      })
    }
    if (entry.isDirectory) {
      var next = (prefix ? prefix + '/' : '') + entry.name
      return readDir(entry.createReader()).then(function (ents) {
        return Promise.all(ents.map(function (e) { return walkEntry(e, next) })).then(flatten)
      })
    }
    return Promise.resolve([])
  }

  function filesFromTransfer(dt) {
    if (!dt) return Promise.resolve([])
    var items = dt.items
    if (items && items.length && items[0].webkitGetAsEntry) {
      var jobs = []
      for (var i = 0; i < items.length; i++) {
        var ent = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null
        if (ent) jobs.push(walkEntry(ent, ''))
        else {
          var f = items[i].getAsFile && items[i].getAsFile()
          if (f) jobs.push(Promise.resolve([f]))
        }
      }
      return Promise.all(jobs).then(function (lists) {
        var out = flatten(lists)
        if (out.length) return out
        return [].slice.call(dt.files || [])
      })
    }
    return Promise.resolve([].slice.call(dt.files || []))
  }

  function filesFromList(list) {
    return [].slice.call(list || [])
  }

  function organize(files) {
    var kept = []
    var skipped = []
    var seen = Object.create(null)
    ;(files || []).forEach(function (f) {
      if (!f) return
      var name = f.name || ''
      var path = pathOf(f)
      if (junkName(name)) { skipped.push({ path: path, why: 'system file' }); return }
      if (!f.size) { skipped.push({ path: path, why: 'empty' }); return }
      var ceil = liveCeil()
      if (f.size > ceil) {
        kept.push(f)
        skipped.push({ path: path, why: 'over ' + Math.round(ceil / 1000000) + ' MB — quoted, not sealed' })
        return
      }
      var key = path + '|' + f.size + '|' + (f.lastModified || 0)
      if (seen[key]) { skipped.push({ path: path, why: 'duplicate drop' }); return }
      seen[key] = 1
      kept.push(f)
    })
    kept.sort(function (a, b) { return bySpine(pathOf(a), pathOf(b)) })
    return { files: kept, skipped: skipped }
  }

  function liveCeil() {
    var n = (typeof window !== 'undefined' && window.kraynetContentMax) ? Number(window.kraynetContentMax) : CEIL
    return (Number.isFinite(n) && n > 0) ? n : CEIL
  }

  function isJsonFile(file) {
    return /\.json$/i.test((file && file.name) || '')
  }

  function isMdFile(file) {
    return /\.md$/i.test((file && file.name) || '')
  }

  function isDocFile(file) {
    return isJsonFile(file) || isMdFile(file)
  }

  function stemOf(name) {
    return String(name || '').replace(/\.(json|md)$/i, '').replace(/\.[^.]+$/, '')
  }

  function isCatalogName(name) {
    return /^_?(metadata|collection|manifest)\.json$/i.test(name || '')
  }

  function readText(file) {
    if (file.text) return file.text()
    return file.arrayBuffer().then(function (ab) { return new TextDecoder().decode(ab) })
  }

  function matchCatalogRow(arr, fileName) {
    var want = String(fileName || '').toLowerCase()
    var wantStem = stemOf(want).toLowerCase()
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i]
      if (!e || typeof e !== 'object') continue
      var img = String(e.image || e.file || e.filename || e.name || '').split('/').pop().toLowerCase()
      if (!img) continue
      if (img === want || stemOf(img).toLowerCase() === wantStem) return JSON.stringify(e)
    }
    return null
  }

  function sealedBytes(txt) {
    try { JSON.parse(txt); return new TextEncoder().encode(txt).length }
    catch (_) { return new TextEncoder().encode(JSON.stringify(txt)).length }
  }

  async function readDoc(file, skipped) {
    var path = pathOf(file)
    var txt
    try { txt = await readText(file) } catch (_) {
      skipped.push({ path: path, why: 'could not read document' })
      return { file: file, loose: true }
    }
    var parsed = null
    try { parsed = JSON.parse(txt) } catch (_) { parsed = null }
    if (parsed === null && isJsonFile(file)) {
      skipped.push({ path: path, why: 'json not valid — sealed as its own star' })
      return { file: file, loose: true }
    }
    var bytes = sealedBytes(txt)
    if (bytes > DOC_CAP) {
      skipped.push({ path: path, why: 'document over ' + DOC_CAP + ' bytes — sealed as its own star' })
      return { file: file, loose: true }
    }
    return { file: file, raw: txt, parsed: parsed, prose: parsed === null }
  }

  async function pairFiles(files, skipped) {
    var contents = []
    var docs = []
    var catalogs = Object.create(null)
    ;(files || []).forEach(function (f) {
      if (isDocFile(f)) {
        var base = (pathOf(f).split('/').pop() || f.name)
        if (isCatalogName(base)) catalogs[folderOf(pathOf(f))] = f
        else docs.push(f)
      } else contents.push(f)
    })
    docs.sort(function (a, b) { return (isMdFile(a) ? 1 : 0) - (isMdFile(b) ? 1 : 0) })
    var byPath = Object.create(null)
    var byStem = Object.create(null)
    docs.forEach(function (f) {
      var p = pathOf(f)
      byPath[p] = f
      var k = folderOf(p) + '|' + stemOf(f.name).toLowerCase()
      if (!byStem[k] || isJsonFile(f)) byStem[k] = f
    })
    var used = Object.create(null)
    var catalogCache = Object.create(null)
    var jobs = []
    contents.forEach(function (c) {
      jobs.push((async function () {
        var p = pathOf(c)
        var fold = folderOf(p)
        var side = byPath[p + '.json'] || byPath[p + '.md'] || byStem[fold + '|' + stemOf(c.name).toLowerCase()]
        var meta = null
        var sidecarName = ''
        if (side) {
          used[pathOf(side)] = 1
          var doc = await readDoc(side, skipped)
          if (doc.raw) { meta = doc.raw; sidecarName = side.name }
        }
        if (!meta && catalogs[fold]) {
          if (!catalogCache[fold]) catalogCache[fold] = await readDoc(catalogs[fold], skipped)
          var cat = catalogCache[fold]
          if (cat && Array.isArray(cat.parsed)) {
            var row = matchCatalogRow(cat.parsed, c.name)
            if (row) { meta = row; sidecarName = catalogs[fold].name }
          } else if (cat && cat.raw && cat.parsed && typeof cat.parsed === 'object' && !Array.isArray(cat.parsed)) {
            meta = cat.raw
            sidecarName = catalogs[fold].name
          }
        }
        return { file: c, meta: meta, sidecar: sidecarName }
      })())
    })
    var pairs = await Promise.all(jobs)
    var loose = []
    docs.forEach(function (f) { if (!used[pathOf(f)]) loose.push(f) })
    Object.keys(catalogs).forEach(function (fold) {
      var attached = pairs.some(function (p) { return folderOf(pathOf(p.file)) === fold && p.sidecar === catalogs[fold].name })
      if (!attached) loose.push(catalogs[fold])
    })
    return { pairs: pairs, loose: loose }
  }

  function hex32(buf) {
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0') }).join('')
  }

  function previewUrl(file, type) {
    if (!file || !/^(image|video|audio)\//.test(type || '')) return ''
    try {
      if (typeof URL !== 'undefined' && URL.createObjectURL) return URL.createObjectURL(file)
    } catch (_) { /* node exam / revoked context */ }
    return ''
  }

  function stageItem(file) {
    var type = mimeOf(file)
    var path = pathOf(file)
    return {
      file: file,
      path: path,
      name: file.name || path,
      folder: folderOf(path),
      type: type,
      size: file.size,
      sha: '',
      url: previewUrl(file, type),
      meta: null,
      sidecar: '',
      blocked: file.size > liveCeil() ? 'over' : ''
    }
  }

  function stage(rawFiles) {
    var org = organize(rawFiles)
    return { items: org.files.map(stageItem), skipped: org.skipped }
  }

  function toB64(u8) {
    var CHUNK = 0x8000
    var s = ''
    for (var i = 0; i < u8.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK))
    }
    return btoa(s)
  }

  function readItem(file) {
    return file.arrayBuffer().then(function (ab) {
      var u8 = new Uint8Array(ab)
      return crypto.subtle.digest('SHA-256', u8).then(function (h) {
        var type = mimeOf(file)
        var path = pathOf(file)
        var url = previewUrl(file, type)
        return {
          file: file,
          path: path,
          name: file.name,
          folder: folderOf(path),
          type: type,
          size: file.size,
          sha: hex32(h),
          url: url,
          meta: null,
          sidecar: '',
        }
      })
    })
  }

  function revoke(item) {
    if (item && item.url) {
      try { URL.revokeObjectURL(item.url) } catch (_) { /* already gone */ }
    }
  }

  function mergeQueue(queue, items) {
    var out = (queue || []).slice()
    var sha = Object.create(null)
    var path = Object.create(null)
    out.forEach(function (it) { sha[it.sha] = 1; path[it.path] = 1 })
    var skipped = []
    ;(items || []).forEach(function (it) {
      if (it.sha && sha[it.sha]) { skipped.push({ path: it.path, why: 'same bytes already in the batch' }); revoke(it); return }
      if (path[it.path]) { skipped.push({ path: it.path, why: 'same path already in the batch' }); revoke(it); return }
      if (it.sha) sha[it.sha] = 1
      path[it.path] = 1
      out.push(it)
    })
    out.sort(function (a, b) { return bySpine(a.path, b.path) })
    return { queue: out, skipped: skipped }
  }

  function groupsOf(queue) {
    var g = []
    var last = null
    ;(queue || []).forEach(function (it, i) {
      var fold = it.folder || '·'
      if (!last || last.folder !== fold) {
        last = { folder: fold, items: [] }
        g.push(last)
      }
      last.items.push({ item: it, i: i })
    })
    return g
  }

  function burnOf(size, rate) {
    if (window.KRAY && typeof KRAY.starFire === 'function') return KRAY.starFire(size, rate)
    rate = Number(rate)
    if (!Number.isFinite(rate) || rate <= 0) return 1
    var s = Number(size)
    if (!Number.isFinite(s) || s <= 0) return 1
    return Math.max(1, Math.ceil(s / rate))
  }

  function burnsOf(queue, rate) {
    var n = 0
    ;(queue || []).forEach(function (it) { n += burnOf(it.size, rate) })
    return n
  }

  function summarize(queue) {
    var docs = 0, jsonStars = 0, bytes = 0
    var folds = Object.create(null)
    ;(queue || []).forEach(function (it) {
      if (it.sidecar) docs++
      if (it.type === 'application/json') jsonStars++
      bytes += it.size || 0
      folds[it.folder || '·'] = 1
    })
    return { n: (queue || []).length, docs: docs, jsonStars: jsonStars, bytes: bytes, folders: Object.keys(folds).length }
  }

  function paint(host, queue, onRemove, opts) {
    if (!host) return
    if (!queue || !queue.length) {
      if (opts && opts.skipped) {
        host.hidden = false
        host.innerHTML = '<p class="ibatch-skip">' + esc(opts.skipped) + '</p>'
        return
      }
      host.hidden = true
      host.innerHTML = ''
      return
    }
    host.hidden = false
    opts = opts || {}
    var groups = groupsOf(queue)
    var sum = summarize(queue)
    var fire = opts.burn != null ? Number(opts.burn) : burnsOf(queue, opts.rate)
    if (!Number.isFinite(fire) || fire < 0) fire = 0
    var atlas = Number(opts.atlas || 0)
    if (!Number.isFinite(atlas) || atlas < 0) atlas = 0
    var total = opts.total != null ? Number(opts.total) : (fire + atlas)
    if (!Number.isFinite(total) || total < 0) total = fire + atlas
    var atlasOn = atlas > 0 || !!opts.atlasOn
    var parent = String(opts.parent || '').trim()
    var origin = !!opts.origin
    var faceFirst = !!opts.faceFirst && !parent && !origin && queue.length > 1
    var nextN = (opts.nextStar != null && Number.isFinite(Number(opts.nextStar)) && Number(opts.nextStar) >= 0)
      ? Math.trunc(Number(opts.nextStar)) : null
    var spineHits = 0
    ;(queue || []).forEach(function (it) { if (SKELETON.indexOf(stemKey(it.path)) >= 0) spineHits++ })
    var plan = parent
      ? 'children of star #' + esc(parent.replace(/[^0-9,]/g, ''))
      : (origin && queue.length > 1
        ? sum.n + ' L1 children of the same ordinal · one blessing · one SHA-256 cohort'
        : (faceFirst ? 'first file is the face · the rest hang on it' : (origin ? 'one L1 child · one blessing'
          : (spineHits ? 'spine order — first card is the next number on the book (not the alphabet)'
            : 'each file is its own root star · this tray order is the birth order'))))
    var costHint = atlasOn
      ? fire.toLocaleString() + ' fire + ' + atlas.toLocaleString() + ' atlas · to born ' + sum.n + ' star' + (sum.n === 1 ? '' : 's') + ' · look over the tray, then sign once'
      : 'to born ' + sum.n + ' star' + (sum.n === 1 ? '' : 's') + ' · look over the tray, then sign once'
    var html = '<div class="ibatch-review">'
      + '<div class="ibatch-cost"><b>' + total.toLocaleString() + ' ₭</b><span>' + costHint + '</span></div>'
      + '<p class="ibatch-plan">' + esc(plan)
      + ' · ' + sum.folders + ' folder' + (sum.folders === 1 ? '' : 's')
      + (sum.docs ? ' · ' + sum.docs + ' JSON document' + (sum.docs === 1 ? '' : 's') + ' seated on their file' : '')
      + (sum.jsonStars ? ' · ' + sum.jsonStars + ' JSON star' + (sum.jsonStars === 1 ? '' : 's') : '')
      + ' · ' + Number(sum.bytes).toLocaleString() + ' bytes</p>'
      + (opts.skipped ? '<p class="ibatch-skip">' + esc(opts.skipped) + '</p>' : '')
      + '</div>'
      + '<div class="ibatch-head"><b>Verify</b><span>✕ removes one · drop more anytime · this order is the number</span></div>'
    groups.forEach(function (g) {
      html += '<div class="ibatch-fold">' + esc(g.folder) + ' · ' + g.items.length + '</div><div class="ibatch-grid">'
      g.items.forEach(function (row) {
        var it = row.item
        var thumb = (it.url && /^image\//.test(it.type || ''))
          ? '<img src="' + esc(it.url) + '" alt="">'
          : (it.url && /^video\//.test(it.type || ''))
            ? '<video src="' + esc(it.url) + '" muted playsinline></video>'
            : '<span class="ibatch-fb">' + fbGlyph(it.type) + '</span>'
        html += '<div class="ibatch-card' + (faceFirst && row.i === 0 ? ' face' : '') + (it.blocked ? ' blocked' : '') + '" data-i="' + row.i + '">'
          + thumb
          + (it.blocked ? '<span class="ibatch-tag">OVER</span>' : (faceFirst && row.i === 0 ? '<span class="ibatch-tag face">FACE</span>' : (it.sidecar ? '<span class="ibatch-tag">' + (/\.md$/i.test(it.sidecar) ? 'MD' : 'JSON') + '</span>' : '')))
          + '<div class="ibatch-nm" title="' + esc(it.path) + (it.sidecar ? ' + ' + esc(it.sidecar) : '') + '">'
          + (nextN != null ? '#' + (nextN + row.i) + ' · ' : '') + esc(it.name) + '</div>'
          + '<div class="ibatch-sz">' + Number(it.size).toLocaleString() + ' B · ' + (function () {
            var piece = burnOf(it.size, opts.rate)
            return (atlasOn ? piece * 2 : piece).toLocaleString() + ' ₭'
          }()) + (it.sidecar ? ' · +doc' : '') + '</div>'
          + '<button type="button" class="ibatch-x" data-rm="' + row.i + '" aria-label="remove">✕</button>'
          + '</div>'
      })
      html += '</div>'
    })
    host.innerHTML = html
    host.querySelectorAll('[data-rm]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault()
        e.stopPropagation()
        if (onRemove) onRemove(Number(btn.getAttribute('data-rm')))
      })
    })
  }

  function skipNote(skipped) {
    if (!skipped || !skipped.length) return ''
    var n = skipped.length
    var sample = skipped.slice(0, 4).map(function (s) { return s.path + ' (' + s.why + ')' }).join(' · ')
    return n + ' skipped — ' + sample + (n > 4 ? '…' : '')
  }

  function prettyDoc(raw) {
    if (!raw) return ''
    try { return JSON.stringify(JSON.parse(raw), null, 2) }
    catch (_) { return raw }
  }

  /**
   * Seat JSON or Markdown documents onto an existing tray (photo.json /
   * photo.md ↔ photo.png, or a metadata.json catalog). One unmatched
   * document fills the box. Markdown is prose — the seal wraps it as a JSON string.
   */
  async function attachDocs(queue, rawFiles) {
    var skipped = []
    var org = organize(rawFiles || [])
    org.skipped.forEach(function (s) { skipped.push(s) })
    var docs = (org.files || []).filter(isDocFile)
    if (!docs.length) return { attached: 0, box: '', skipped: skipped, note: 'that drop had no JSON or Markdown' }
    var q = queue || []
    if (!q.length) {
      if (docs.length === 1) {
        var one = await readDoc(docs[0], skipped)
        return { attached: 0, box: prettyDoc(one.raw || ''), skipped: skipped, note: one.raw ? 'document loaded into the box' : 'could not read that document' }
      }
      return { attached: 0, box: '', skipped: skipped, note: 'drop the images first, then these JSON / MD sidecars — or upload one document into the box' }
    }
    var fake = q.map(function (it) { return it.file }).concat(docs)
    var plan = await pairFiles(fake, skipped)
    var attached = 0
    plan.pairs.forEach(function (pair) {
      if (!pair.meta) return
      var hit = q.find(function (it) { return it.file === pair.file || it.path === pathOf(pair.file) })
      if (!hit) return
      hit.meta = pair.meta
      hit.sidecar = pair.sidecar || ''
      attached++
    })
    var box = ''
    if (!attached && docs.length === 1) {
      var solo = await readDoc(docs[0], skipped)
      box = prettyDoc(solo.raw || '')
    }
    var note = attached
      ? ('seated ' + attached + ' document' + (attached === 1 ? '' : 's') + ' on matching files')
      : (box ? 'document loaded into the box' : 'no name matched — use photo.json or photo.md next to photo.png, or metadata.json / collection.json')
    return { attached: attached, box: box, skipped: skipped, note: note }
  }

  async function ingest(rawFiles) {
    var org = organize(rawFiles)
    var live = []
    var blocked = []
    org.files.forEach(function (f) {
      var it = stageItem(f)
      if (it.blocked) blocked.push(it)
      else live.push(f)
    })
    var plan = await pairFiles(live, org.skipped)
    var items = []
    for (var i = 0; i < plan.pairs.length; i++) {
      var it = await readItem(plan.pairs[i].file)
      it.meta = plan.pairs[i].meta || null
      it.sidecar = plan.pairs[i].sidecar || ''
      items.push(it)
    }
    for (var j = 0; j < plan.loose.length; j++) items.push(await readItem(plan.loose[j]))
    items = items.concat(blocked)
    items.sort(function (a, b) { return bySpine(a.path, b.path) })
    return { items: items, skipped: org.skipped }
  }

  async function enrich(items) {
    for (var i = 0; i < (items || []).length; i++) {
      var it = items[i]
      if (!it || it.sha || it.blocked) continue
      try {
        var hashed = await readItem(it.file)
        it.sha = hashed.sha
        it.type = it.type || hashed.type
        if (!it.url && hashed.url) it.url = hashed.url
        if (hashed.size) it.size = hashed.size
      } catch (_) {
        it.blocked = it.blocked || 'unreadable'
      }
    }
    return items
  }

  function mountPreview(host, item) {
    if (!host) return
    if (!item) {
      host.hidden = true
      host.innerHTML = ''
      return
    }
    var type = item.type || ''
    host.hidden = false
    if (/^image\//.test(type) && item.url) {
      host.innerHTML = '<img alt="" src="' + esc(item.url) + '">'
    } else if (/^video\//.test(type) && item.url) {
      host.innerHTML = '<video src="' + esc(item.url) + '" controls muted playsinline></video>'
    } else if (/^audio\//.test(type) && item.url) {
      host.innerHTML = '<audio src="' + esc(item.url) + '" controls></audio><p class="imeta">' + esc(item.name || '') + '</p>'
    } else {
      host.innerHTML = '<div class="ibatch-fb">' + fbGlyph(type) + '</div><p class="imeta">' + esc(item.name || '') + ' · ' + esc(type) + '</p>'
    }
  }

  function blockedOf(queue) {
    return (queue || []).filter(function (it) { return it && it.blocked })
  }

  function wavesOf(queue) {
    var out = []
    var cur = []
    var bytes = 0
    ;(queue || []).forEach(function (it) {
      var next = bytes + (it.size || 0)
      if (cur.length && (cur.length >= MAX || next > WAVE_BYTES)) {
        out.push(cur)
        cur = []
        bytes = 0
      }
      cur.push(it)
      bytes += it.size || 0
    })
    if (cur.length) out.push(cur)
    return out
  }

  async function ensureB64(item) {
    if (item.b64) return item
    var ab = await item.file.arrayBuffer()
    item.b64 = toB64(new Uint8Array(ab))
    return item
  }

  function bodiesOf(slice, extra) {
    return slice.map(function (it) {
      var body = {
        action: 'inscribe',
        content: it.b64,
        encoding: 'base64',
        contentType: it.type,
      }
      Object.keys(extra || {}).forEach(function (k) { if (extra[k] != null) body[k] = extra[k] })
      if (it.meta) body.meta = it.meta
      return body
    })
  }

  async function sealWave(from, slice, extra, signOne, opts, onProgress, label) {
    for (var i = 0; i < slice.length; i++) await ensureB64(slice[i])
    var items = bodiesOf(slice, extra)
    onProgress(label + 'preparing ' + items.length + '…')
    var pr = await fetch('/api/kraynet/prepare-batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: from, items: items }),
    })
    var prep = await pr.json()
    if (!pr.ok || prep.error) throw new Error(prep.error || 'prepare-batch refused')
    var signed = []
    var pub = opts.publicKey
    for (var s = 0; s < prep.items.length; s++) {
      onProgress(label + 'sign ' + (s + 1) + '/' + prep.items.length + ' — ' + (slice[s] && slice[s].name || 'file'))
      var sig = await signOne(prep.items[s].message)
      if (!pub) {
        var p = await opts.getPublicKey()
        pub = (p && p.publicKey) || p
        opts.publicKey = pub
      }
      var row = Object.assign({}, items[s], {
        from: from,
        nonce: prep.items[s].nonce,
        publicKey: pub,
        signature: (sig && sig.signature) || sig,
        scheme: 'kraywallet',
      })
      if (prep.items[s].originCohortRoot) row.originCohortRoot = prep.items[s].originCohortRoot
      if (prep.items[s].originCohort) row.originCohort = prep.items[s].originCohort
      if (prep.items[s].stripProofs) {
        delete row.originProofs
        delete row.originCohort
      }
      signed.push(row)
    }
    onProgress(label + 'sealing…')
    var sr = await fetch('/api/kraynet/submit-batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: from, items: signed }),
    })
    var res = await sr.json()
    if (!sr.ok || res.error) throw new Error(res.error || 'submit-batch refused')
    return res
  }

  async function seal(opts) {
    var from = opts.from
    var queue = (opts.queue || []).slice()
    var extra = Object.assign({}, opts.extra || {})
    var onProgress = opts.onProgress || function () {}
    if (!from || !queue.length) throw new Error('a batch needs files')
    if (blockedOf(queue).length) throw new Error('a file is over this node\'s ceiling — compress or split before you seal')
    var confirmed = false
    async function signOne(msg) {
      if (!confirmed) {
        confirmed = true
        return opts.sign(msg)
      }
      return (opts.signQuiet || opts.sign)(msg)
    }
    var hasStarParent = !!(extra.parent || (extra.parents && extra.parents.length))
    var hasOrigin = !!(extra.origins && extra.origins.length) || !!extra.originProofs
    var faceFirst = !!opts.faceFirst && !hasStarParent && !hasOrigin && queue.length > 1
    var results = []
    var applied = 0
    var leftover = -1
    var done = 0

    async function runSlice(slice, tag) {
      var res = await sealWave(from, slice, extra, signOne, opts, onProgress, tag)
      var localFail = (res.results || []).findIndex(function (r) { return !r.ok })
      ;(res.results || []).forEach(function (r) { results.push(r) })
      applied += res.applied || 0
      if (localFail >= 0) leftover = done + localFail
      done += slice.length
      return res
    }

    if (hasOrigin && queue.length > 1) {
      onProgress('hashing the drop — one L1 blessing will commit a SHA-256 cohort of every file…')
      extra.originCohort = []
      for (var qi = 0; qi < queue.length; qi++) {
        await ensureB64(queue[qi])
        var ab = await queue[qi].file.arrayBuffer()
        var digest = await crypto.subtle.digest('SHA-256', ab)
        extra.originCohort.push([...new Uint8Array(digest)].map(function (x) { return x.toString(16).padStart(2, '0') }).join(''))
      }
    }

    if (faceFirst) {
      onProgress('collection face — first file becomes the parent…')
      var face = await runSlice([queue[0]], 'face · ')
      if (leftover >= 0) return { ok: applied > 0, applied: applied, failed: results.length - applied, results: results, leftover: leftover }
      var born = (face.results || []).filter(function (r) { return r.ok && r.star != null })[0]
      if (!born) throw new Error('the collection face did not receive a star number')
      extra.parent = String(born.star)
      delete extra.parents
      queue = queue.slice(1)
    }

    var waves = wavesOf(queue)
    for (var w = 0; w < waves.length; w++) {
      if (leftover >= 0) break
      await runSlice(waves[w], 'wave ' + (w + 1) + '/' + waves.length + ' · ')
      if (hasOrigin && extra.originProofs) delete extra.originProofs
    }
    return { ok: applied > 0, applied: applied, failed: results.length - applied, results: results, leftover: leftover, parent: extra.parent || null }
  }

  global.KrayInscribeBatch = {
    MAX: MAX,
    SKELETON: SKELETON,
    LATER: LATER,
    SPINE: SPINE,
    WAVE_BYTES: WAVE_BYTES,
    CEIL: CEIL,
    filesFromTransfer: filesFromTransfer,
    filesFromList: filesFromList,
    organize: organize,
    readItem: readItem,
    mergeQueue: mergeQueue,
    revoke: revoke,
    paint: paint,
    burnOf: burnOf,
    burnsOf: burnsOf,
    skipNote: skipNote,
    summarize: summarize,
    ingest: ingest,
    stage: stage,
    enrich: enrich,
    mountPreview: mountPreview,
    blockedOf: blockedOf,
    attachDocs: attachDocs,
    ensureB64: ensureB64,
    seal: seal,
    pathOf: pathOf,
    mimeOf: mimeOf,
  }
})(typeof window !== 'undefined' ? window : globalThis)
