/**
 * Official zip — public network recipes ship; operator houses never do.
 *   node apps/kray-net/node-pack.test.mjs
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shouldPackPath, packNodeTree } from './node-pack.mjs'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

console.log('\n╔═ OFFICIAL ZIP — public recipes in, operator houses out ═╗\n')

ok(shouldPackPath('networks/README.md'), 'networks/README.md ships')
ok(shouldPackPath('networks/signet/README.md'), 'networks/signet/ (public recipe) ships')
ok(shouldPackPath('networks/signet/node.env.example'), 'networks/signet/node.env.example ships')
ok(shouldPackPath('networks/mainnet/README.md'), 'networks/mainnet/ (public recipe) ships')
ok(shouldPackPath('networks/mainnet/node.env.example'), 'networks/mainnet/node.env.example ships')
ok(shouldPackPath('apps/kray-net/network-boot.mjs'), 'isolation module ships')
ok(shouldPackPath('docs/FOLDER-LAW.md'), 'folder law ships')
ok(shouldPackPath('scripts/follow/kray-follow.mjs'), 'scripts/follow/kray-follow.mjs ships')
ok(shouldPackPath('scripts/follow/signet.cmd'), 'scripts/follow/signet.cmd ships')
ok(shouldPackPath('scripts/follow/mainnet.cmd'), 'scripts/follow/mainnet.cmd ships')
ok(shouldPackPath('scripts/kray-follow.mjs'), 'stable door scripts/kray-follow.mjs ships')
ok(shouldPackPath('scripts/follow-signet.cmd'), 'stable door follow-signet.cmd ships')
ok(shouldPackPath('scripts/follow-mainnet.cmd'), 'stable door follow-mainnet.cmd ships')

ok(!shouldPackPath('signet/vault-keys.env'), 'root signet/ operator house is excluded')
ok(!shouldPackPath('signet/node-hot.env'), 'root signet/node-hot.env is excluded')
ok(!shouldPackPath('mainnet/vault-keys.env'), 'root mainnet/ operator house is excluded')
ok(!shouldPackPath('mainnet/node-hot.env'), 'root mainnet/node-hot.env is excluded')
ok(!shouldPackPath('ops/vitrine.env'), 'ops/ is excluded')
ok(!shouldPackPath('follower/CURRENT'), 'Signet follower state is excluded')
ok(!shouldPackPath('follower-main/CURRENT'), 'mainnet follower state is excluded')
ok(!shouldPackPath('apps/kray-net/data-signet/kraynet-journal-signet.jsonl'), 'Signet journal is excluded')
ok(!shouldPackPath('apps/kray-net/data-main/kraynet-journal-main.jsonl'), 'mainnet journal is excluded')
ok(!shouldPackPath('apps/kray-api/index.js'), 'L1 oracle is excluded')
ok(shouldPackPath('apps/kray-net/index.html'), 'explorer index.html ships')
ok(shouldPackPath('apps/kray-net/kray.js'), 'kray.js ships')
ok(shouldPackPath('apps/kray-net/custody-browser.js'), 'custody-browser.js ships')
ok(shouldPackPath('apps/kray-net/kray.css'), 'kray.css ships')
ok(!shouldPackPath('apps/kray-net/v2.html'), 'era leftover v2.html is excluded')
ok(!shouldPackPath('apps/kray-net/kray-v2.js'), 'era leftover kray-v2.js is excluded')
ok(!shouldPackPath('apps/kray-net/kray-v2.css'), 'era leftover kray-v2.css is excluded')
ok(!shouldPackPath('networks/signet/vault-keys.env'), 'a secret filename is excluded even under networks/')
ok(shouldPackPath('scripts/guardian/guardian.mjs'), 'Door 1 guardian ships')
ok(shouldPackPath('scripts/guardian/swarm.mjs'), 'guardian mining swarm ships (not the exam swarm)')
ok(shouldPackPath('scripts/operator/pot-signer.mjs'), 'pot-signer (custody) ships')
ok(shouldPackPath('scripts/operator'), 'the operator DIRECTORY is walkable — or pot-signer never reaches the zip')
ok(shouldPackPath('scripts/pot-signer.mjs'), 'the stable-door pot-signer shim ships')
ok(!shouldPackPath('apps/kray-net/.kray-api.json'), 'writer gateway key .kray-api.json is excluded beside server.mjs')
ok(!shouldPackPath('.kray-api.json'), 'writer gateway key .kray-api.json is excluded at the root')
ok(!shouldPackPath('apps/kray-net/guardian.box'), 'any sealed .box is excluded, wherever it sits')
ok(!shouldPackPath('scripts/owner.box'), 'owner.box stays out even outside the operator houses')
ok(shouldPackPath('scripts/oss-guard.sh'), 'oss-guard ships')
ok(!shouldPackPath('scripts/exam/swarm-exam.mjs'), 'workshop swarm-exam is excluded')
ok(!shouldPackPath('scripts/exam/gauntlet.mjs'), 'workshop gauntlet is excluded')
ok(!shouldPackPath('scripts/lab/testnode.mjs'), 'workshop testnode is excluded')
ok(!shouldPackPath('scripts/lab/devnet.mjs'), 'workshop devnet is excluded')
ok(!shouldPackPath('scripts/gauntlet.mjs'), 'workshop shim gauntlet.mjs is excluded')
ok(!shouldPackPath('scripts/testnode.mjs'), 'workshop shim testnode.mjs is excluded')
ok(!shouldPackPath('scripts/operator/sync-vitrine.sh'), 'this-operator vitrine sync is excluded')
ok(!shouldPackPath('scripts/operator/update-guardians.sh'), 'guardian-fleet rsync stays off the zip')
ok(!shouldPackPath('networks/mainnet/origin-vitrine/start-writer.cmd'), 'origin vitrine kit stays off the zip')
ok(!shouldPackPath('networks/mainnet/origin-vitrine/cloudflared.yml.example'), 'cloudflared writer recipe stays off the zip')
ok(!shouldPackPath('networks/mainnet/origin-local.env.example'), 'origin-local.env.example stays off the zip')
ok(!shouldPackPath('docs/OPERATOR-SHIP.md'), 'OPERATOR-SHIP stays off the zip')
ok(!shouldPackPath('docs/KRAYOS-MIND.md'), 'KRAYOS-MIND stays off the zip')
ok(!shouldPackPath('bin/run-cloudflared.sh'), 'operator cloudflared wrapper is excluded')
ok(!shouldPackPath('bin/run-signet-node.sh'), 'operator signet launch wrapper is excluded')
ok(!shouldPackPath('bin/launchd/com.kray.signet.node.plist'), 'operator launchd units are excluded')
ok(!shouldPackPath('bin/README-DEV-CHANNEL.md'), 'operator run-layer README is excluded')
ok(!shouldPackPath('manifesto/liberdade.md'), 'manifesto scroll stays off the zip')
ok(!shouldPackPath('docs/HANDOFF-CUSTODY-RUNG3.md'), 'operator handoff stays off the zip')
ok(!shouldPackPath('apps/kray-core/src/adapter/krill-adapter.ts'), 'external tenant adapter stays off the zip')
ok(!shouldPackPath('apps/kray-core/src/adapter/radiola-adapter.ts'), 'Radiola is another house — off the zip')
ok(!shouldPackPath('apps/kray-core/src/adapter/satspace-adapter.ts'), 'Satspace is another house — off the zip')
ok(!shouldPackPath('apps/kray-core/src/adapter/station-adapter.ts'), 'Station is another house — off the zip')
ok(!shouldPackPath('scripts/lab/custody-antigrind.sim.mjs'), 'workshop lab leftover stays off the zip')
ok(!shouldPackPath('.oss-guard-local'), 'local oss-guard tripwires stay off the zip')
ok(!shouldPackPath('TRAVEL.md'), 'lab travelogue is excluded')
ok(!shouldPackPath('WORKSHOP.md'), 'workshop operator map is excluded')
ok(shouldPackPath('AGENTS.md'), 'house-detection AGENTS.md ships')
ok(!shouldPackPath('apps/kray-net/HARNESS.md'), 'lab harness doc is excluded')
ok(!shouldPackPath('archive/kray-network-official/README.md'), 'official worktree extract is excluded')

// ── THE REAL ZIP, not just the path oracle — a false-green here was the audit's exact catch:
//    shouldPackPath said pot-signer ships while the walk pruned scripts/operator whole. Read the
//    zip's central directory (names stored as plain utf8) — exact membership, no content noise.
{
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  process.env.KRAY_PACK_HEAD_TTL_MS = '0'
  const pack = packNodeTree(repoRoot)
  const names = new Set()
  const SIG = 0x02014b50
  let i = 0
  while ((i = pack.zip.indexOf('PK\x01\x02', i)) !== -1) {
    if (pack.zip.readUInt32LE(i) === SIG) {
      const nameLen = pack.zip.readUInt16LE(i + 28)
      names.add(pack.zip.toString('utf8', i + 46, i + 46 + nameLen))
      i += 46 + nameLen
    } else i += 1
  }
  ok(names.size === pack.files, `REAL ZIP: central directory parsed — ${names.size} entries match the pack count`)
  const endsWith = (suffix) => [...names].some((n) => n.endsWith(suffix))
  ok(names.has('scripts/operator/pot-signer.mjs'), 'REAL ZIP: pot-signer.mjs is actually inside — the shim entrypoint is not broken')
  ok(names.has('scripts/pot-signer.mjs'), 'REAL ZIP: the stable-door shim is inside')
  ok(names.has('apps/kray-net/server.mjs'), 'REAL ZIP: the node itself is inside (sanity)')
  ok(!endsWith('.kray-api.json'), 'REAL ZIP: no gateway key anywhere in the archive')
  ok(!endsWith('vault-keys.env'), 'REAL ZIP: no vault keys anywhere in the archive')
  ok(!endsWith('.box'), 'REAL ZIP: no sealed key box anywhere in the archive')
  ok(!names.has('scripts/operator/sync-vitrine.sh'), 'REAL ZIP: bakery scripts stayed out even though the directory is walkable')
  ok(!names.has('scripts/operator/update-guardians.sh'), 'REAL ZIP: guardian-fleet rsync stayed out')
  ok(![...names].some((n) => /kraynet-journal-|\/data-(signet|main|lab)\//.test(n)), 'REAL ZIP: no journal file, no chain data dir (journal-chunks.ts the module is code, not data)')
}

console.log(`\n╚═ ${pass} passed${fail ? `, ${fail} FAILED` : ''} — the zip stays clean. ⛓₭\n`)
process.exit(fail ? 1 : 0)
