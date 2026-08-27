#!/usr/bin/env node
/**
 * Follow / run-node preflight — confront THIS machine, then teach the choice.
 *
 *   node scripts/follow/preflight.mjs
 *   node scripts/follow/preflight.mjs --universe signet --role follow
 *
 * Prints a lay-person report: what they chose, what it means, what is
 * already here, what is still needed, what is NOT needed. Exit 0 = you
 * may continue (warnings allowed). Exit 2 = hard stop.
 * Never prints secret values. Never prints live writer hostnames/IPs.
 *
 * Law: docs/RUN-NODE.md · docs/FOLDER-LAW.md
 */
import { existsSync, readdirSync, statSync, statfsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (f, d = '') => {
  const i = process.argv.indexOf(f)
  return i > 0 ? (process.argv[i + 1] || d) : d
}
const UNIVERSE = String(arg('--universe', '') || '').toLowerCase() // signet | main | lab
const ROLE = String(arg('--role', '') || '').toLowerCase()         // follow | guardian | validate | lab | custody
const PROOFS = String(arg('--proofs', 'replay') || 'replay').toLowerCase() // replay | bitcoin
const JSON_OUT = process.argv.includes('--json')
const NEED_MAJOR = 24

const WRITERS = {
  signet: { url: 'https://signet.kray.network', dir: 'follower', port: 4480 },
  main: { url: 'https://www.kray.network', dir: 'follower-main', port: 4481 },
  lab: { url: 'http://127.0.0.1:4477', dir: null, port: 4477 },
}

const CHOICE = {
  signet: {
    title: 'Signet',
    meaning: 'The public practice universe. Play money on Bitcoin Signet. Live today. Safe to learn on.',
  },
  main: {
    title: 'Bitcoin mainnet',
    meaning: 'The real-₿ universe. Same software, new book. The public writer is live at genesis (seq 0). You follow it — you never become that writer.',
  },
  lab: {
    title: 'Local lab',
    meaning: 'A private empty book on this computer only. Play ₭. It is not Signet and not mainnet. Nobody else sees it.',
  },
  follow: {
    title: 'Follow — a full node of this history',
    meaning: 'One command pulls the journal (the book) and the atlas (every star file: images, audio, pages). Each file is hash-checked. Missing or junk refuses the copy. Protocol vaults (rune locks) are rebuilt from the journal — there is no SQL database. Pot vault KEYS (vault-keys.env, owner.box) are never downloaded. This alone does not pay fees.',
  },
  guardian: {
    title: 'Guardian — prove work, earn a share',
    meaning: 'Every public act pays 1 ₭ into a fee pool. Easy 3×: open /validate, connect KrayWallet, leave Hold the library on — public star files + a powerless signMessage. The key never leaves the wallet. Never paste wallet hex into KRAY_MINER_SK. CLI miner key is a dedicated always-on identity only. Many devices, one wallet = one guardian. The journal pen is still one writer.',
  },
  custody: {
    title: 'Custody mirror — your follower serves the rune BOOK a custody guardian reads',
    meaning: 'A custody guardian never trusts the writer\'s word: before co-signing a pot withdraw it asks an independent mirror "does this exiter truly hold that balance?" and refuses if the book says no. This role makes YOUR follower one of those books — the same follow command already serves /api/kraynet/runes/of on current code; keep the box always-on. Honest part: no guardian KEY today (Signet custody slots are the operator\'s sealed rehearsal set); on mainnet, guardian operators with REAL keys are chosen from proven mirrors like this one. This is how you raise your hand.',
  },
  validate: {
    title: 'Validate in the browser',
    meaning: 'Open /validate, connect KrayWallet, leave Hold the library on for up to 3× (uncheck for 1× on a small plan). The tab downloads public stars; the wallet only signs kray.beat.submit.v1. The key never leaves KrayWallet. Never paste a private key into the node. Watch Your balance and Every distribution.',
  },
  labRole: {
    title: 'Local empty writer',
    meaning: 'A private practice book on this computer. Useful for exams. It does not make you the public Signet or mainnet writer. Never paste live vault keys here.',
  },
}

const lines = []
const blockers = []
const warnings = []
const have = []
const need = []
const notNeeded = []
const facts = {}

function say(s = '') { lines.push(s) }
function block(s) { blockers.push(s) }
function warn(s) { warnings.push(s) }

function sh(bin, args, ms = 8000) {
  try {
    return execFileSync(bin, args, { cwd: ROOT, encoding: 'utf8', timeout: ms, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function portBusy(port) {
  return new Promise((resolve) => {
    // destroy (never end) on EVERY path. An end()'d socket lingers half-closed in a CLOSING state, and a
    // later process.exit() while it is mid-close trips libuv's UV_HANDLE_CLOSING assertion on Windows —
    // the report prints, then the exit code is garbage (-1073740791) and an assistant reads it as failure.
    const s = net.createConnection({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true) })
    s.setTimeout(400, () => { s.destroy(); resolve(false) })
    s.on('error', () => { s.destroy(); resolve(false) })
  })
}

// The one Windows-safe way to read npm's version. npm's launcher is a shell shim (npm.cmd), and Node 24
// refuses to execFile a .cmd without a shell (EINVAL) — so run npm's OWN cli js with THIS node instead.
const WIN = process.platform === 'win32'
function npmVersion() {
  const nodeDir = dirname(process.execPath)
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),               // Windows: <nodejs>\node_modules\npm\bin\npm-cli.js
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),  // Unix: <prefix>/lib/node_modules/npm/bin/npm-cli.js
  ]
  for (const cli of candidates) {
    if (existsSync(cli)) { try { return execFileSync(process.execPath, [cli, '-v'], { cwd: ROOT, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { /* try next */ } }
  }
  try { return sh('npm', ['-v']) } catch { return '' }   // last resort — a plain symlink this node can exec directly
}

async function bitcoinInfo() {
  const url = process.env.KRAY_BTC_RPC || ''
  const user = process.env.KRAY_BTC_RPC_USER || 'kraycore'
  const pass = process.env.KRAY_BTC_RPC_PASS || ''
  if (!url) return { set: false }
  if (!pass) return { set: true, ok: false, error: 'KRAY_BTC_RPC_PASS unset' }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(user + ':' + pass).toString('base64') },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'preflight', method: 'getblockchaininfo', params: [] }),
      signal: AbortSignal.timeout(4000),
    })
    const j = await r.json()
    if (j.error) return { set: true, ok: false, error: 'rpc refused' }
    const info = j.result || {}
    return { set: true, ok: true, chain: info.chain, blocks: info.blocks, ibd: !!info.initialblockdownload }
  } catch {
    return { set: true, ok: false, error: 'unreachable' }
  }
}

async function getJson(url, ms = 8000) {
  try {
    // connection: close so the writer/local head check does not leave a keep-alive socket lingering in
    // undici's pool — that lingering socket is what a plain process.exit() force-closes mid-flight,
    // tripping the UV_HANDLE_CLOSING assertion on Windows. Closed sockets let Node exit on its own.
    const r = await fetch(url, { headers: { connection: 'close' }, signal: AbortSignal.timeout(ms) })
    if (!r.ok) return { ok: false, status: r.status }
    return { ok: true, status: r.status, json: await r.json() }
  } catch (e) {
    return { ok: false, error: e && e.name === 'TimeoutError' ? 'timeout' : 'unreachable' }
  }
}

function dirHint(rel) {
  const p = join(ROOT, rel)
  if (!existsSync(p)) return { exists: false, path: rel }
  let bytes = 0
  let files = 0
  const walk = (d, depth) => {
    if (depth > 4) return
    let ents = []
    try { ents = readdirSync(d) } catch { return }
    for (const name of ents) {
      const q = join(d, name)
      let st
      try { st = statSync(q) } catch { continue }
      if (st.isDirectory()) walk(q, depth + 1)
      else { files += 1; bytes += st.size }
    }
  }
  walk(p, 0)
  return { exists: true, path: rel, files, bytes }
}

function originHouse(url) {
  const u = (url || '').toLowerCase()
  if (u.includes('kray-node') || u.includes('kray-network')) return 'official'
  if (u.includes('kray-net')) return 'workshop'
  return 'unknown'
}

function parseMajor(v) {
  const n = Number(String(v || '').replace(/^v/, '').split('.')[0])
  return Number.isFinite(n) ? n : 0
}

function mark(list, okYes, text) {
  list.push((okYes ? '  [yes] ' : '  [no ] ') + text)
}

const universe = UNIVERSE === 'main' ? 'main' : UNIVERSE === 'lab' ? 'lab' : (UNIVERSE === 'signet' || UNIVERSE === '' ? 'signet' : UNIVERSE)
const role = ROLE === 'guardian' || ROLE === 'validate' || ROLE === 'lab' || ROLE === 'follow' || ROLE === 'custody'
  ? ROLE
  : 'follow'
const wantsFollow = role === 'follow'
const wantsCustody = role === 'custody'
const wantsGuardian = role === 'guardian'
const wantsValidate = role === 'validate'
const wantsLab = role === 'lab'
const needsNode = !wantsValidate
const needsDeps = wantsFollow || wantsLab || wantsGuardian || wantsCustody
const needsWriterNet = universe !== 'lab' && !wantsLab

// ── gather ───────────────────────────────────────────────────────────────
const isWorkshop = existsSync(join(ROOT, 'scripts/exam')) || existsSync(join(ROOT, 'scripts/lab'))
const vaultSignet = existsSync(join(ROOT, 'signet/vault-keys.env'))
const vaultMain = existsSync(join(ROOT, 'mainnet/vault-keys.env'))
const ownerBox = existsSync(join(ROOT, 'signet/owner.box')) || existsSync(join(ROOT, 'mainnet/owner.box'))
const journalSignet = existsSync(join(ROOT, 'apps/kray-net/data-signet')) || existsSync(join(ROOT, 'data-signet'))
const journalMain = existsSync(join(ROOT, 'apps/kray-net/data-main')) || existsSync(join(ROOT, 'data-main'))
const looksWriter = vaultSignet || vaultMain || ownerBox || journalSignet || journalMain
const origin = sh('git', ['remote', 'get-url', 'origin'])
const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
const commit = sh('git', ['rev-parse', '--short', 'HEAD'])
const houseRemote = originHouse(origin)
const treeOk = existsSync(join(ROOT, 'apps/kray-core')) && existsSync(join(ROOT, 'scripts/follow/kray-follow.mjs'))
const nodeVer = process.versions.node
const major = parseMajor(nodeVer)
const nodeOk = major >= NEED_MAJOR
const npmVer = npmVersion()
const coreMods = existsSync(join(ROOT, 'apps/kray-core/node_modules'))
const follower = dirHint('follower')
const followerMain = dirHint('follower-main')
const ports = { 4477: await portBusy(4477), 4480: await portBusy(4480), 4481: await portBusy(4481), 11434: await portBusy(11434) }
const local4480 = ports[4480] ? await getJson('http://127.0.0.1:4480/api/kraynet/head', 2500) : null
const local4481 = ports[4481] ? await getJson('http://127.0.0.1:4481/api/kraynet/head', 2500) : null
const local4477 = ports[4477] ? await getJson('http://127.0.0.1:4477/api/kraynet/head', 2500) : null
const alreadySignetFollow = Boolean(ports[4480] && local4480 && local4480.ok)
const alreadyMainFollow = Boolean(ports[4481] && local4481 && local4481.ok)
const alreadyLab = Boolean(ports[4477] && local4477 && local4477.ok)
const targetPort = universe === 'main' ? 4481 : universe === 'lab' || wantsLab ? 4477 : 4480
const targetDir = universe === 'main' ? followerMain : follower
const btc = process.env.KRAY_BTC_RPC || ''
const btcInfo = (wantsFollow || wantsCustody) ? await bitcoinInfo() : { set: false }
// DX: if they asked for Bitcoin proofs and a bitcoind RPC port is LISTENING but KRAY_BTC_RPC is unset, say so
// in one line (the exact URL). We never read their rpcpassword — the user pastes USER/PASS from their conf.
const btcRpcPort = universe === 'main' ? 8332 : (universe === 'lab' || wantsLab) ? 18443 : 38332
const btcPortListening = (wantsFollow && PROOFS === 'bitcoin' && !btc) ? await portBusy(btcRpcPort) : false
// custody: does the local mirror serve the rune BOOK? (the route a guardian daemon grounds its verdict in —
// old code answers 404 there; that means "git pull + restart follow", never a guess)
let bookServes = false
if (wantsCustody && alreadySignetFollow) {
  const probe = await getJson('http://127.0.0.1:4480/api/kraynet/runes/of/probe', 2500)
  bookServes = Boolean(probe.ok && probe.json && Array.isArray(probe.json.runes))
}
facts.bookServes = wantsCustody ? bookServes : undefined
facts.btcRpcSet = Boolean(btc)
facts.btc = btcInfo.set ? { ok: btcInfo.ok, chain: btcInfo.chain || null, ibd: btcInfo.ibd || false } : { set: false }
facts.proofs = PROOFS

if (wantsFollow && btcInfo.set && btcInfo.ok) {
  const wantChain = universe === 'main' ? 'main' : universe === 'signet' ? 'signet' : null
  if (wantChain && btcInfo.chain && btcInfo.chain !== wantChain) {
    block('Bitcoin Core is on chain "' + btcInfo.chain + '" but this follow is ' + universe + '. Same universe only. Do not mix.')
  }
  if (btcInfo.ibd) warn('Bitcoin Core is still first-syncing (IBD). Follow may run; seal re-proofs wait until the chain is caught up.')
} else if (wantsFollow && btcInfo.set && !btcInfo.ok) {
  warn('KRAY_BTC_RPC is set but Bitcoin Core did not answer (' + (btcInfo.error || '?') + '). Password not printed. Follow still works as replay.')
} else if (wantsFollow && PROOFS === 'bitcoin' && !btcInfo.ok) {
  if (btcPortListening) {
    warn('Bitcoin Core looks like it is listening on 127.0.0.1:' + btcRpcPort + ', but KRAY_BTC_RPC is unset. Export KRAY_BTC_RPC=http://127.0.0.1:' + btcRpcPort + ' plus KRAY_BTC_RPC_USER / KRAY_BTC_RPC_PASS (copy them from YOUR bitcoin.conf) and re-run follow to weigh seals. This preflight never reads your rpcpassword.')
  } else {
    warn('You chose complete Bitcoin proofs. Bitcoin Core is not ready yet. Follow first (journal + atlas), then install Signet bitcoind, then set KRAY_BTC_RPC + USER + PASS and re-run follow. Do not block the first boot.')
  }
}

let writerHead = null
if (needsWriterNet) {
  const w = WRITERS[universe === 'main' ? 'main' : 'signet']
  writerHead = await getJson(w.url.replace(/\/$/, '') + '/api/kraynet/head', 8000)
}

let freeBytes = null
try {
  const fs = statfsSync(ROOT)
  freeBytes = Number(fs.bavail) * Number(fs.bsize)
} catch { /* some OS / sandboxes */ }

facts.house = isWorkshop ? 'workshop' : looksWriter ? 'writer-disk' : houseRemote === 'official' ? 'official' : 'clone'
facts.origin = houseRemote
facts.branch = branch || null
facts.commit = commit || null
facts.node = nodeVer
facts.nodeOk = nodeOk
facts.npm = npmVer || null
facts.krayCoreInstalled = coreMods
facts.follower = follower
facts.followerMain = followerMain
facts.ports = ports
facts.writer = writerHead ? { universe, reachable: writerHead.ok, status: writerHead.status || writerHead.error || null } : null
facts.choice = { universe, role }

if (!treeOk) block('This folder is not the KRAY.NETWORK code. Clone https://github.com/tomkray/kray-node.git and run preflight again.')
if (isWorkshop && wantsFollow) warn('This folder looks like the workshop (exam tools). Follow from a clone of github.com/tomkray/kray-node.')
if (looksWriter && wantsFollow) block('This folder looks like the unique writer disk (vault and/or live journal). Do not start follow here. Use a clean official clone. Leave these files untouched.')
else if (looksWriter) warn('Vault or live journal folders exist here. Do not copy keys. Guardian / browser validate may still use the public writer URL.')
if (houseRemote === 'workshop') warn('git origin is the workshop remote. The public door is github.com/tomkray/kray-node.')
if (needsNode && !nodeOk) block('Node.js v' + nodeVer + ' is too old. This choice needs Node.js 24 or newer. Upgrade, then re-run this preflight. Do not start yet.')
if (needsDeps && !npmVer) warn('npm is not on PATH. You will need it to install the libraries (comes with Node.js).')
if (needsDeps && !coreMods && npmVer) need.push('Install the libraries once:  cd apps/kray-core && npm ci && cd ../..')
if (freeBytes != null && freeBytes < 1e9 && wantsFollow) warn('Less than 1 GB free. The book is small today and grows — free some disk.')
if (wantsFollow && universe === 'signet' && alreadySignetFollow) warn('A Signet full node is already answering on this computer. Do not start a second one.')
if (wantsFollow && universe === 'main' && alreadyMainFollow) warn('A mainnet-follow process is already answering. Do not start a second one.')
if (wantsFollow && universe === 'signet' && ports[4480] && !alreadySignetFollow) warn('Something already uses port 4480 and it is not a KRAY head. Identify or stop it before starting follow.')
if (wantsFollow && universe === 'main' && ports[4481] && !alreadyMainFollow) warn('Something already uses port 4481 and it is not a KRAY head.')
if (wantsLab && ports[4477] && !alreadyLab) warn('Port 4477 is in use. Identify that process before starting a local lab writer.')
if (needsWriterNet && writerHead && !writerHead.ok && universe === 'signet') warn('The public Signet writer did not answer. Check your internet. Do not invent a local public writer.')
if (needsWriterNet && writerHead && !writerHead.ok && universe === 'main') warn('The mainnet writer did not answer — wait; do not invent a writer.')

// ── have / need / not-needed (lay language) ──────────────────────────────
mark(have, treeOk, 'KRAY code in this folder' + (commit ? ' (git ' + (branch || '?') + ' @ ' + commit + ')' : ''))
if (needsNode) mark(have, nodeOk, 'Node.js v' + nodeVer + '  (need 24 or newer)')
else have.push('  [—  ] Node.js  — not required for a browser tab')
if (needsDeps) mark(have, Boolean(npmVer), npmVer ? 'npm ' + npmVer : 'npm  (needed to install libraries)')
if (needsDeps) mark(have, coreMods, coreMods ? 'Libraries already installed (apps/kray-core)' : 'Libraries  — not installed yet')
if (wantsFollow) {
  const label = universe === 'main' ? './follower-main' : './follower'
  const journalHint = dirHint(label)
  let journalFile = false
  let contentN = 0
  if (targetDir.exists) {
    const walkCount = (rel) => {
      const p = join(ROOT, rel)
      if (!existsSync(p)) return { journal: false, contents: 0 }
      let journal = false, contents = 0
      const walk = (d, depth) => {
        if (depth > 6) return
        let ents = []
        try { ents = readdirSync(d) } catch { return }
        for (const name of ents) {
          const q = join(d, name)
          let st
          try { st = statSync(q) } catch { continue }
          if (st.isDirectory()) walk(q, depth + 1)
          else if (/kraynet-journal-/.test(name)) journal = true
          else if (d.endsWith('content') && /^[0-9a-f]{64}$/.test(name)) contents++
        }
      }
      walk(p, 0)
      return { journal, contents }
    }
    const got = walkCount(label)
    journalFile = got.journal
    contentN = got.contents
  }
  facts.atlasFiles = contentN
  mark(have, targetDir.exists, targetDir.exists
    ? 'Follower folder ' + label + ' already on disk (' + journalHint.files + ' files) — resume, do not wipe'
    : 'Follower folder  — none yet; follow will create ' + label)
  mark(have, journalFile, journalFile
    ? 'Journal file already here (the book)'
    : 'Journal  — not on disk yet; follow pulls /api/kraynet/replica')
  mark(have, contentN > 0, contentN > 0
    ? 'Atlas already here — ' + contentN + ' star file(s) in content/ (images, audio, pages)'
    : 'Atlas  — follow will pull every /content/<sha256> and hash-check it (0 files until the first star)')
}
if (wantsFollow || wantsLab) {
  const portYes = wantsLab ? alreadyLab : (universe === 'main' ? alreadyMainFollow : alreadySignetFollow)
  mark(have, portYes, portYes
    ? 'This role is already running on this computer (port ' + targetPort + ')'
    : ports[targetPort]
      ? 'Port ' + targetPort + ' is busy with something else'
      : 'Port ' + targetPort + ' is free')
  mark(have, ports[11434], ports[11434]
    ? 'Ollama is already on this machine (:11434) — after the head is green, /mind can plug a local module'
    : 'Ollama  — not required. After follow is green, /mind can install a module or take a key')
}
if (wantsCustody) {
  mark(have, alreadySignetFollow, alreadySignetFollow
    ? 'Your Signet mirror is serving on port 4480 — the follower this book rides on'
    : 'A serving Signet mirror  — none on port 4480 yet; the follow command below starts it (the mirror IS the book)')
  mark(have, bookServes, bookServes
    ? 'Your mirror serves the rune BOOK (/api/kraynet/runes/of answers) — guardian-ready'
    : alreadySignetFollow
      ? 'The rune-book route  — this mirror runs older code; git pull origin main, restart follow'
      : 'The rune-book route  — comes with the follow command (current code serves it)')
  if (btcInfo.ok) mark(have, true, 'Bitcoin Core answers here — your mirror is GOLD (anchors re-proven on this box)')
  else mark(have, false, 'Bitcoin Core  — optional polish today, gold for a custody mirror; mainnet guardians need it')
}
if (needsWriterNet) {
  mark(have, Boolean(writerHead && writerHead.ok), writerHead && writerHead.ok
    ? 'The public ' + (universe === 'main' ? 'mainnet' : 'Signet') + ' writer answers'
    : universe === 'main'
      ? 'The public mainnet writer  — no answer, need internet'
      : 'The public Signet writer  — no answer, need internet')
}
if (wantsFollow) {
  if (btcInfo.ok) {
    mark(have, true, 'Bitcoin Core answers · chain ' + (btcInfo.chain || '?') + ' · height ' + (btcInfo.blocks ?? '?') + (btcInfo.ibd ? ' · still syncing' : ' · synced') + ' — seals can be re-proven here')
  } else if (btc) {
    mark(have, false, 'KRAY_BTC_RPC is set but bitcoind did not answer — follow still replays the journal')
  } else {
    mark(have, false, 'Bitcoin Core  — not on this machine yet. First follow is still valid; adding Signet bitcoind later makes seal proofs complete')
  }
}
if (freeBytes != null) mark(have, freeBytes >= 1e9, (freeBytes / 1e9).toFixed(1) + ' GB free disk')

if (!treeOk) need.push('Clone the official code: git clone https://github.com/tomkray/kray-node.git')
if (needsNode && !nodeOk) {
  need.push('Install Node.js 24 or newer from https://nodejs.org (or brew install node@24 on macOS). Open a new terminal. Run: node -v')
}
// (the "install libraries" step is already added once above, for every role that needsDeps — no duplicate here)
if (wantsFollow && universe === 'signet' && alreadySignetFollow) {
  need.push('Nothing to start. Your full node is already up. Open http://127.0.0.1:4480 or: curl -s http://127.0.0.1:4480/api/kraynet/head')
} else if (wantsFollow && universe === 'signet' && ports[4480] && !alreadySignetFollow) {
  need.push('Free port 4480 (stop the other program) or we cannot start the Signet full node.')
} else if (wantsFollow && universe === 'main' && alreadyMainFollow) {
  need.push('Nothing to start. Mainnet follow is already up on port 4481.')
} else if (wantsFollow && universe === 'main' && ports[4481] && !alreadyMainFollow) {
  need.push('Free port 4481 before starting mainnet follow.')
} else if (wantsLab && alreadyLab) {
  need.push('Nothing to start. A local node is already answering on port 4477.')
} else if (wantsLab && ports[4477] && !alreadyLab) {
  need.push('Free port 4477 before starting the local lab writer.')
} else if (wantsValidate) {
  need.push('A web browser, internet, and KrayWallet. Fees land on the connected address after the next Bitcoin seal. Watch Your balance + Every distribution on /validate.')
} else if (wantsCustody) {
  if (!alreadySignetFollow) need.push('Start your follower first (the follow command below) — your mirror IS the book. Keep the box always-on.')
  else if (!bookServes) need.push('Update this clone: git pull origin main, then restart follow — the rune-book route (/api/kraynet/runes/of) ships with current code.')
  else need.push('Nothing to install. Keep the box always-on, add Bitcoin Core when you can (gold), and raise your hand — mainnet custody-guardian operators are chosen from proven mirrors exactly like this one (docs/RUN-NODE.md § Q2b).')
} else if (wantsGuardian && nodeOk) {
  need.push('Easy 3× is /validate → Hold the library (key stays in KrayWallet). CLI KRAY_MINER_SK is a dedicated miner key only — never the daily wallet. Unset = demo identity. Follow content/ alone does not pay 3×.')
} else if (wantsFollow && universe === 'main') {
  need.push('Internet to www.kray.network, then the one follow command below. It pulls the journal AND every star file. After: cat follower-main/CURRENT.')
} else if (wantsFollow) {
  need.push('Internet to signet.kray.network, then the one follow command below. It pulls the journal AND every star file. Leave the terminal open. After: cat follower/CURRENT and count content/.')
  if (PROOFS === 'bitcoin' && !btcInfo.ok) {
    need.push('Polish (after follow is up): install Bitcoin Core on Signet, wait until synced, set KRAY_BTC_RPC / USER / PASS (loopback only), re-run follow. Same universe only. See docs/RUN-NODE.md § Bitcoin Core.')
  }
}

notNeeded.push('Pot vault KEYS (vault-keys.env, owner.box) — not the atlas. Atlas = star files. Keys = bakery secrets.')
notNeeded.push('Postgres / Mongo / Docker “for the journal” — the book is one jsonl file')
notNeeded.push('To be the public writer — this clone never becomes that machine')
notNeeded.push('An LLM / Ollama / a vendor key — follow is the book. /mind is an optional app after the head is green')
if (!wantsFollow) notNeeded.push('A copy of the whole book and atlas on this disk')
if (wantsValidate) notNeeded.push('Node.js, npm, or any install')
if (wantsFollow && PROOFS !== 'bitcoin') notNeeded.push('Bitcoin Core on day one — add it after follow is healthy (the last polish)')
if (wantsFollow && PROOFS === 'bitcoin' && !btcInfo.ok) notNeeded.push('Waiting for bitcoind before the first follow — journal + atlas do not need it')
if (wantsGuardian || wantsValidate) notNeeded.push('A pot-key vault, a writer journal folder, or a second writer')
if (wantsCustody) notNeeded.push('A guardian KEY today — Signet custody slots are the operator\'s sealed rehearsal set; on mainnet, real keys go to independent operators drawn from proven mirrors. The mirror is the qualification, never the key.')

// ── next command ─────────────────────────────────────────────────────────
let next = ''
if (blockers.length) {
  next = 'STOP. Fix what is missing (BLOCK below). Then: ' + (WIN ? 'scripts\\follow\\preflight.cmd --universe ' + universe + ' --role ' + role : 'node scripts/follow/preflight.mjs --universe ' + universe + ' --role ' + role)
} else if (wantsFollow && universe === 'signet' && alreadySignetFollow) {
  next = 'ALREADY running. curl -s http://127.0.0.1:4480/api/kraynet/head'
} else if (wantsFollow && universe === 'signet' && ports[4480]) {
  next = 'STOP. Port 4480 is in use. Identify that program first. Do not start a second follow.'
} else if (wantsFollow && universe === 'main' && alreadyMainFollow) {
  next = 'ALREADY running. curl -s http://127.0.0.1:4481/api/kraynet/head'
} else if (wantsFollow && universe === 'main' && ports[4481]) {
  next = 'STOP. Port 4481 is in use. Do not start a second follow.'
} else if (wantsCustody && alreadySignetFollow && bookServes) {
  next = 'Your book is live. Verify any time: curl -s http://127.0.0.1:4480/api/kraynet/runes/of/<any-address>'
} else if (wantsCustody && alreadySignetFollow) {
  next = 'git pull origin main   (then restart the follow command — it adds the rune-book route)'
} else if (wantsCustody) {
  next = WIN ? 'scripts\\follow\\signet.cmd' : 'node scripts/follow/kray-follow.mjs --from https://signet.kray.network --dir ./follower --watch --serve 4480'
} else if (wantsGuardian) {
  next = universe === 'main'
    ? 'node scripts/guardian/guardian.mjs https://www.kray.network'
    : 'node scripts/guardian/guardian.mjs https://signet.kray.network'
} else if (wantsValidate) {
  next = universe === 'main'
    ? 'Open https://www.kray.network/validate in your browser. No download.'
    : 'Open https://signet.kray.network/validate in your browser. No download.'
} else if (wantsLab && alreadyLab) {
  next = 'ALREADY running. Open http://127.0.0.1:4477'
} else if (wantsLab) {
  next = 'KRAY_NET=regtest KRAY_TRUSTED_DEV=1 node apps/kray-net/server.mjs'
} else if (universe === 'main' && wantsFollow) {
  next = WIN ? 'scripts\\follow\\mainnet.cmd' : 'node scripts/follow/kray-follow.mjs --from https://www.kray.network --dir ./follower-main --watch --serve 4481'
} else {
  next = WIN ? 'scripts\\follow\\signet.cmd' : 'node scripts/follow/kray-follow.mjs --from https://signet.kray.network --dir ./follower --watch --serve 4480'
}

facts.blockers = blockers
facts.warnings = warnings
facts.next = next
facts.have = have
facts.need = need

const uni = CHOICE[universe] || CHOICE.signet
const rol = role === 'lab' ? CHOICE.labRole : (CHOICE[role] || CHOICE.follow)

say('')
say('KRAY — what you chose, what this machine already has')
say('folder  ' + ROOT)
say('')
say('YOU CHOSE')
say('  Universe:  ' + uni.title)
say('  Role:      ' + rol.title)
say('')
say('WHAT THIS MEANS')
say('  ' + uni.meaning)
say('  ' + rol.meaning)
say('')
say('WHAT YOU ALREADY HAVE')
for (const row of have) say(row)
say('')
say('WHAT YOU STILL NEED FOR THIS CHOICE')
if (!need.length && !blockers.length) say('  Nothing. The next command is enough.')
else {
  for (const row of need) say('  · ' + row)
}
say('')
say('NOT NEEDED FOR THIS CHOICE')
for (const row of notNeeded) say('  · ' + row)
if (warnings.length) {
  say('')
  say('PLEASE READ')
  for (const w of warnings) say('  ! ' + w)
}
if (blockers.length) {
  say('')
  say('MUST FIX BEFORE STARTING')
  for (const b of blockers) say('  BLOCK  ' + b)
}
say('')
say('NEXT')
say('  ' + next)
if (wantsFollow && !blockers.length) {
  const exPort = universe === 'main' ? 4481 : 4480
  say('  Then open the explorer — this node, proving itself: http://127.0.0.1:' + exPort + '/')
  say('  Optional — talk to this book: http://127.0.0.1:' + exPort + '/mind')
  say('  (A key or Llama stays on this computer. The node never sees it. Not required to follow.)')
  say('  (Leave the terminal running; the follow keeps verifying and the explorer stays live.)')
}
if (wantsLab && !blockers.length && next.startsWith('KRAY_NET')) {
  say('  That is a private empty book. Not Signet. Not mainnet.')
}
if (universe === 'main' && wantsFollow && !blockers.length) {
  say('  This clone is a mirror of the live mainnet book. Never a second writer.')
}
say('')
say('Words: follower = journal + atlas (star files). guardian = proves work and can earn.')
say('       writer = the one public pen (not this clone). atlas = images/files. pot keys = never.')
say('       fees = 1 ₭ per act → pool → your KrayWallet on the next Bitcoin seal (not a bank).')
say('       mind = optional mouth on /mind after the head is green. Never the follow command.')
say('')

if (JSON_OUT) {
  process.stdout.write(JSON.stringify(facts, null, 2) + '\n')
} else {
  process.stdout.write(lines.join('\n') + '\n')
}

// Let Node exit on its OWN once the port probes and the writer-check socket have closed. An abrupt
// process.exit() force-closes a socket libuv is still closing → the UV_HANDLE_CLOSING assertion on
// Windows and a garbage exit code (-1073740791) that an assistant reads as a failed preflight, even
// though the report above is correct. The sockets are already destroy()'d / connection:close'd, so the
// loop drains immediately; a short unref'd fallback still guarantees exit if some handle ever hangs
// (by then nothing is mid-close, so the forced exit is safe).
process.exitCode = blockers.length ? 2 : 0
setTimeout(() => process.exit(process.exitCode ?? 0), 6000).unref()
