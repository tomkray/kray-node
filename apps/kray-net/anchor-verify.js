/* ANCHOR-VERIFY — the one-click "prove it yourself" widget, trustless and client-side.
 *
 * Given an anchor OPENING (carrier, txid, blockNumber, cascadeRoot), YOUR browser:
 *   1. recomputes the expected Bitcoin output from (blockNumber, root) — self-anchor: BurnProof.derive →
 *      5120<outputKey>; classic: the 6a31 KRAY.NETWORK OP_RETURN — never the node's stored value;
 *   2. asks a third-party explorer YOU choose (mempool.space / blockstream) for the tx, and matches an
 *      output's raw scriptPubKey against the recomputed one — recompute-then-match, not read-and-trust;
 *   3. WEIGHS the containing block's work in-browser (KraySPV.checkProofOfWork — target from nBits, real
 *      hashes), and folds the explorer's merkle path to the block's own merkle root, so the tx is proven
 *      INSIDE a block that genuinely cost work — not merely reported "confirmed";
 *   4. mints a badge ONLY from what it reproved: a green ✓ is earned by work, never by a node boolean.
 *
 * Depends on: /kray-spv.mjs (KraySPV), /burn-proof.js (BurnProof), /verify.js (KrayVerify.mempoolBase).
 * Fail-closed: any step it cannot reproduce leaves the badge grey/amber, never green.
 */
(function () {
  'use strict'
  var ANCHOR_CONF = { regtest: 1, signet: 2, test: 2, main: 6 }
  var clean = function (s) { return String(s == null ? '' : s).replace(/[<>]/g, '') }
  var h2b = function (h) { var n = h.length >> 1, b = new Uint8Array(n); for (var i = 0; i < n; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b }
  var b2h = function (b) { var s = ''; for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0'); return s }
  var rev = function (b) { var o = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) o[i] = b[b.length - 1 - i]; return o }
  var cat = function (a, b) { var o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o }

  function line(host, html) {
    var d = document.createElement('div'); d.className = 'vf-line'; d.innerHTML = html; host.appendChild(d)
    requestAnimationFrame(function () { requestAnimationFrame(function () { d.classList.add('on') }) })
    return d
  }
  function badge(host, cls, text, sub) {
    var d = document.createElement('div'); d.className = 'av-badge ' + cls
    d.innerHTML = '<div class="av-badge__t">' + text + '</div>' + (sub ? '<div class="av-badge__s">' + sub + '</div>' : '')
    host.appendChild(d); requestAnimationFrame(function () { requestAnimationFrame(function () { d.classList.add('on') }) })
    return d
  }
  var src = function (name) { return '<span class="src">' + name + '</span> ' }

  // THE HONEST BOUNDARY — named right where the green check is minted, because overclaiming this seam is
  // the worst trust-and-safety outcome (ANCHOR-PROOF-UX.md). A sealed root proves the root is ON Bitcoin
  // under real work; it does NOT by itself prove the root is the honest COMPILE of the whole journal. The
  // last mile is the follower's replay — offer the one command that closes it. Shown only where a root is
  // genuinely committed on-chain (green / confirming), never on a grey "nothing proven" state.
  function boundary(host) {
    line(host, src('the last mile') +
      'This proved the cascade root is <b>sealed in Bitcoin</b> under real work — <b>not</b> that the root is the honest compile of the whole journal (every balance, star and rune). Close that mile yourself: re-derive the root from the journal with <span class="vf-hex"><b>node scripts/kray-follow.mjs</b></span> — it replays every signature and refuses a tampered history. Bitcoin proves the seal; the follower proves the books.')
  }

  // self-contained styling — inject once, scoped under .av-scope, resonant with /kray.css tokens, so any
  // page can mount the widget with only a button + a container (no per-page CSS to add or keep in sync).
  function ensureStyle() {
    if (document.getElementById('av-style')) return
    var s = document.createElement('style'); s.id = 'av-style'
    s.textContent =
      '.av-prove-btn{background:var(--signal,#5b8cff);color:var(--signal-ink,#fff);border:0;border-radius:var(--r1,8px);font-weight:700;font-size:13px;padding:9px 18px;cursor:pointer;letter-spacing:.02em}' +
      '.av-prove-btn:hover{opacity:.9}.av-prove-btn:disabled{opacity:.55;cursor:default}' +
      '.av-scope .vf-line{border:1px solid var(--line);border-radius:var(--r1,8px);background:var(--surface);padding:10px 12px;margin-bottom:8px;font-size:12.5px;line-height:1.55;opacity:0;transform:translateY(4px);transition:opacity .35s ease,transform .35s ease}' +
      '.av-scope .vf-line.on{opacity:1;transform:none}' +
      '.av-scope .vf-hex{font-family:var(--mono);font-size:11.5px;word-break:break-all;color:var(--ink-2);margin:6px 0}.av-scope .vf-hex b{color:var(--ink)}' +
      '.av-scope .ok{color:var(--good);font-weight:700}.av-scope .bad{color:var(--bad,#e5484d);font-weight:700}' +
      '.av-scope .src{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);border:1px solid var(--line-2);border-radius:999px;padding:2px 9px;margin-right:6px}' +
      '.av-scope .av-badge{border-radius:var(--r2,12px);padding:16px;margin-top:12px;opacity:0;transform:translateY(4px);transition:opacity .4s ease,transform .4s ease;border:1px solid var(--line-2)}.av-scope .av-badge.on{opacity:1;transform:none}' +
      '.av-scope .av-badge__t{font-weight:800;font-size:15px}.av-scope .av-badge__s{color:var(--ink-2);font-size:12.5px;line-height:1.6;margin-top:6px}' +
      '.av-scope .av-badge.green{border-color:var(--good);background:color-mix(in srgb,var(--good) 12%,var(--surface))}.av-scope .av-badge.green .av-badge__t{color:var(--good)}' +
      '.av-scope .av-badge.amber{border-color:#d9a441;background:color-mix(in srgb,#d9a441 12%,var(--surface))}.av-scope .av-badge.amber .av-badge__t{color:#d9a441}' +
      '.av-scope .av-badge.grey .av-badge__t{color:var(--ink-2)}' +
      '.av-scope .av-badge.blue{border-color:#5b8cff;background:color-mix(in srgb,#5b8cff 10%,var(--surface))}.av-scope .av-badge.blue .av-badge__t{color:#5b8cff}'
    document.head.appendChild(s)
  }

  // fold an esplora merkle-proof (siblings bottom-up, display order + pos) to the block's merkle root
  async function merkleRootFromProof(txidDisplay, siblings, pos) {
    var h = rev(h2b(txidDisplay)), p = pos
    for (var i = 0; i < siblings.length; i++) {
      var sib = rev(h2b(siblings[i]))
      h = await KraySPV.sha256d((p & 1) ? cat(sib, h) : cat(h, sib))
      p = Math.floor(p / 2)
    }
    return b2h(rev(h)) // display order
  }

  async function run(host, opening, net) {
    ensureStyle(); host.classList.add('av-scope'); host.innerHTML = ''
    if (!window.KraySPV || !window.BurnProof || !window.KrayVerify) { line(host, '<span class="bad">✗</span> the in-browser proof engine did not load — refresh the page.'); return }
    var carrier = opening.carrier || 'self-anchor'
    var txid = String(opening.txid || '').toLowerCase()
    var blk = Number(opening.blockNumber), root = String(opening.root || '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(txid) || !(blk >= 0) || !/^[0-9a-f]{64}$/.test(root)) { badge(host, 'grey', 'UNVERIFIABLE', 'Missing txid / block / root — nothing to prove.'); return }

    if (opening.cascadeCover && opening.coveredBlock != null) {
      line(host, src('sealed chain') + 'KRAY block <b>#' + clean(String(opening.coveredBlock)) + '</b> has no own Bitcoin transaction. It is already inside the cascade that <b>block #' + clean(String(blk)) + '</b> sealed. That prefix cannot be rewritten. The proof below is the covering seal — the same one you would run on the donate cube.')
    }

    // ── 1 · recompute the expected Bitcoin output, in YOUR browser ──
    var expectScript
    try {
      if (carrier === 'self-anchor') {
        var pr = await BurnProof.derive(blk, root, net)
        expectScript = '5120' + pr.outputKey
        line(host, src('your browser') + 'the seal for (block ' + blk + ', root ' + clean(root.slice(0, 12)) + '…) must pay the keyless output <div class="vf-hex"><b>' + expectScript + '</b></div>' + (pr.numsIsHashOfG ? '<span class="ok">NUMS = SHA256(G) ✓ — keyless</span>' : '<span class="bad">NUMS mismatch ✗</span>'))
      } else {
        // classic OP_RETURN: 6a 31 "KRAY.NETWORK" 01 blockNumber(4 BE) root(32)
        var payload = '4b5241592e4e4554574f524b01' + ('00000000' + blk.toString(16)).slice(-8) + root
        expectScript = '6a31' + payload
        line(host, src('your browser') + 'the seal must carry the OP_RETURN <div class="vf-hex"><b>' + expectScript + '</b></div>')
      }
    } catch (e) { badge(host, 'grey', 'UNVERIFIABLE', 'This browser could not recompute the expected output — ' + clean(e && e.message)); return }

    // ── 2 · fetch the RAW tx bytes and BIND them to the claimed txid, in YOUR browser ──
    // Never trust the explorer's decoded JSON: reparse the bytes, prove they hash to THIS txid, and match
    // the recomputed seal against the REPARSED output scripts — bytes, not the explorer's word.
    var base = KrayVerify.mempoolBase(net)
    if (!base) { badge(host, 'blue', 'DEV CHAIN', 'This is ' + clean(net) + ' — no public explorer, and its work is trivial by design. Verify offline: node apps/kray-net/burn-verify.mjs'); return }
    var rawHex
    try { rawHex = (await (await fetch(base + '/tx/' + txid + '/hex')).text()).trim() } catch (e) { badge(host, 'grey', 'UNVERIFIABLE', 'Could not reach ' + clean(base) + ' to ask Bitcoin.'); return }
    var rec
    try { rec = await KraySPV.parseTx(rawHex) } catch (e) { badge(host, 'grey', 'UNVERIFIABLE', 'This browser could not parse the transaction bytes — ' + clean(e && e.message)); return }
    if (rec.txidDisplay !== txid) { badge(host, 'grey', 'TXID MISMATCH', 'The bytes this explorer served do NOT hash to the claimed transaction id — refuse it, and try another explorer.'); return }
    var matchIx = -1
    for (var oi = 0; oi < rec.outputScripts.length; oi++) { if (b2h(rec.outputScripts[oi]) === expectScript) { matchIx = oi; break } }
    if (matchIx < 0) { badge(host, 'grey', 'NO ANCHOR', 'Bitcoin shows no output committing this (block, root). This state is NOT anchored by that transaction — or the claim is false.'); return }
    line(host, src('your browser') + '<span class="ok">✓ the raw tx bytes hash to this txid, and one of ITS outputs pays the recomputed seal</span> — bound to the bytes, not the explorer\'s word' + (carrier === 'self-anchor' ? ' · <b>' + clean(String(rec.outputValues[matchIx])) + ' sats</b> burned to a keyless address' : ''))

    // ── 3 · confirmed & located — the explorer only says WHERE; the WORK is weighed below, never counted ──
    var stt
    try { stt = await (await fetch(base + '/tx/' + txid + '/status')).json() } catch (e) { badge(host, 'grey', 'UNVERIFIABLE', 'Could not read the confirmation status from ' + clean(base) + '.'); return }
    if (!stt || !stt.confirmed) { badge(host, 'amber', 'SEEN IN MEMPOOL', 'Broadcast but not yet in a block — a mempool payment can still be dropped or replaced. NOT final.'); return }
    var bh = stt.block_height, bhash = stt.block_hash
    var need = ANCHOR_CONF[net] || 2
    var floor = (KraySPV.MIN_BLOCK_WORK && KraySPV.MIN_BLOCK_WORK[net] != null) ? KraySPV.MIN_BLOCK_WORK[net] : KraySPV.MIN_BLOCK_WORK.main

    // ── 4 · WEIGH burial in-browser: the containing block AND each confirmation must clear the network's
    //        per-block WORK FLOOR and chain by prevHash — NEVER an explorer confirmation count (tip - bh). ──
    var incl = false, containOk = false, h0 = null
    try {
      var h0hex = (await (await fetch(base + '/block/' + bhash + '/header')).text()).trim()
      if (!/^[0-9a-f]{160}$/.test(h0hex)) throw new Error('malformed header')
      h0 = await KraySPV.parseHeader(h2b(h0hex))
      var pow0 = await KraySPV.checkProofOfWork(h0hex, net)
      containOk = !!(pow0.ok && BigInt(pow0.work) >= floor)
      line(host, src('your browser') + (containOk ? '<span class="ok">✓ the containing block cleared the work floor</span> — its hash meets a target above the network minimum (' + pow0.work + ' hashes)' : '<span class="bad">✗ the containing block does NOT clear the work floor</span> — a difficulty-1 or invalid header proves nothing (' + clean(pow0.reason || 'below the ' + net + ' floor') + ')'))
      var mp = await (await fetch(base + '/tx/' + txid + '/merkle-proof')).json()
      var folded = await merkleRootFromProof(txid, mp.merkle || [], mp.pos)
      incl = folded === h0.merkleRootDisplay
      line(host, src('your browser') + (incl ? '<span class="ok">✓ the transaction is INSIDE that block</span> — its merkle path folds to the block\'s own root' : '<span class="bad">✗ merkle inclusion failed</span> — the path does not fold to the header'))
    } catch (e) { line(host, src('your browser') + 'could not weigh the containing block (' + clean(e && e.message) + ')') }

    // weigh the CONFIRMATIONS: fetch each following header, require it clear the floor AND chain by prevHash
    var depth = containOk ? 1 : 0, chainPrev = h0 ? h0.hashDisplay : null
    if (containOk && chainPrev) {
      for (var d = 1; d < need; d++) {
        try {
          var hh = (await (await fetch(base + '/block-height/' + (bh + d))).text()).trim()
          if (!/^[0-9a-f]{64}$/.test(hh)) break
          var hx = (await (await fetch(base + '/block/' + hh + '/header')).text()).trim()
          if (!/^[0-9a-f]{160}$/.test(hx)) break
          var hp = await KraySPV.parseHeader(h2b(hx)), pw = await KraySPV.checkProofOfWork(hx, net)
          if (!(pw.ok && BigInt(pw.work) >= floor)) break     // a header nobody paid for is not a confirmation
          if (hp.prevDisplay !== chainPrev) break              // …and it must chain onto the one before it
          chainPrev = hp.hashDisplay; depth++
        } catch (e) { break }
      }
      line(host, src('your browser') + 'weighed <b>' + depth + '</b> chained block(s) of real work above the floor' + (depth < need ? ' — the KRAY law waits for ' + need : ''))
    }

    // ── 5 · the badge, minted ONLY from work weighed in-browser (never an explorer count) ──
    var powMeaningful = containOk && net !== 'regtest'
    if (powMeaningful && incl && depth >= need) {
      badge(host, 'green', '✓ CONFIRMED — SEALED IN BITCOIN', 'Your browser reproved it: the exact cascade root is committed on-chain, inside a block it weighed for real work, under ' + depth + ' chained block(s) each above the network floor. You trusted this node — and the explorer — for none of the proof.')
      boundary(host)
    } else if (incl && containOk) {
      badge(host, 'amber', 'CONFIRMING', 'Committed inside a real block your browser weighed, buried ' + depth + ' deep — the KRAY law waits for ' + need + '. Shallow anchors can still reorg.')
      boundary(host)
    } else if (!incl && containOk) {
      badge(host, 'amber', 'WORK OK · INCLUSION UNCONFIRMED', 'The block cleared the work floor, but this browser could not fold the merkle path — try another explorer.')
    } else {
      badge(host, 'grey', 'UNVERIFIABLE HERE', 'Could not reprove burial above the work floor in this browser. Try another explorer, or verify offline with burn-verify.mjs.')
    }
  }

  globalThis.AnchorVerify = { run: run }
  try { ensureStyle() } catch (e) { /* head not ready — run() injects it anyway */ }
})()
