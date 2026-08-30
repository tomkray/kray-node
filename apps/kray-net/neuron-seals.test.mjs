/**
 * One big neuron per Bitcoin seal. Land is a badge, never the only clock.
 *   node apps/kray-net/neuron-seals.test.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { masterRanges } from './neuron-seals.mjs'

const here = dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

const signetNow = [
  { height: 12, txid: '13a7ecf3', land: 1, confirmations: 100 },
  { height: 32, txid: '48ad60e6', land: null, confirmations: 59 },
]

const masters = masterRanges(signetNow, 51)
ok(masters.length === 3, 'two seals + forming tip (not one land blob)')
ok(masters[0].land === 1 && !masters[0].barren && masters[0].fromBlock === 0 && masters[0].toBlock === 12, 'seal 12 wears land #1 and covers genesis…12')
ok(masters[1].barren && masters[1].land == null && masters[1].height === 32 && masters[1].fromBlock === 13, 'seal 32 is a barren master — no land number')
ok(masters[2].forming && masters[2].fromBlock === 33 && masters[2].toBlock === 51, 'FORMING starts after the last seal, not after the last land')
ok(masters.filter((m) => m.barren).length === 1, 'exactly one barren seal on this book')
ok(masters.filter((m) => m.land != null).length === 1, 'land highlight is a subset of seals')

const shuffled = masterRanges([signetNow[1], signetNow[0]], 51)
ok(shuffled[0].height === 12 && shuffled[1].height === 32, 'seals sort by height — paint order is not JSON order')

const empty = masterRanges([], 7)
ok(empty.length === 1 && empty[0].forming && empty[0].fromBlock === 0 && empty[0].toBlock === 7, 'no seals yet → one forming district')

const justSealed = masterRanges([{ height: 0, land: null }], 0)
ok(justSealed.length === 1 && justSealed[0].barren && !justSealed[0].forming, 'a barren genesis seal is a master, not FORMING')

const chrome = readFileSync(join(here, 'blocks.html'), 'utf8')
ok(/worldData=\{lands:.*seals:/.test(chrome), 'constellation load keeps /world.seals')
ok(/masterRanges\(worldData\.seals/.test(chrome) || /KEEP IN LOCKSTEP with neuron-seals\.mjs/.test(chrome), 'paint names the shared spine')
ok(/SEAL #/.test(chrome) && /LAND #/.test(chrome), 'labels split seal vs land')
ok(/n\.barren/.test(chrome) && /\/block\/'\+n\.height/.test(chrome), 'barren master opens the donate cube, not a fake land')

const block = readFileSync(join(here, 'block.html'), 'utf8')
ok(/two clocks on this cube/.test(block), 'block page names the two clocks')
ok(/acts inside this cube/.test(block), 'leaves tray is not titled as the Bitcoin donate')
ok(/this Bitcoin seal minted no land/.test(block), 'barren self-anchor states the land law')
ok(/rune-lodge/.test(block) && /not the Bitcoin donate/.test(block), 'lodge receipt is a journal act, not the seal')

console.log(fail ? ('FAIL ' + fail + '/' + (pass + fail)) : ('ok  ' + pass + '/' + (pass + fail) + '  neuron spine = Bitcoin seals'))
if (fail) process.exit(1)
