/**
 * THE EDICT CALCULATOR — the rune's point, never a ₭ fraction.
 *   node src/test/rune-units.test.ts
 */
import {
  toBaseUnits, fromBaseUnits, midSpot, pairSpot, KRAY_DIVISIBILITY,
} from '../protocol/rune-units.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`)
  process.exit(1)
}

function main(): void {
  ok(toBaseUnits('1', KRAY_DIVISIBILITY) === '1', '₭: 1 stays 1 (no point)')
  ok(toBaseUnits('1.0', KRAY_DIVISIBILITY) === null, '₭: a decimal is refused (no divisibility)')
  ok(toBaseUnits('10.5', 0) === null, 'div=0: 10.5 refused')
  ok(toBaseUnits('1.5', KRAY_DIVISIBILITY) === null, '1.5 ₭ does not exist')

  ok(toBaseUnits('1', 5) === '100000', 'DOG div=5: 1 display = 10^5 base')
  ok(toBaseUnits('1.5', 5) === '150000', 'DOG: 1.5 display = 150000 base')
  ok(toBaseUnits('1.50000', 5) === '150000', 'DOG: 1.50000 pads to the edict')
  ok(toBaseUnits('1.500001', 5) === null, 'DOG: a 6th decimal is purged, not rounded')
  ok(toBaseUnits('0.00001', 5) === '1', 'DOG: one base unit')
  ok(fromBaseUnits('150000', 5) === '1.5', 'DOG: 150000 base reads 1.5')
  ok(fromBaseUnits('1', 5) === '0.00001', 'DOG: 1 base reads 0.00001')
  ok(fromBaseUnits(toBaseUnits('1.5', 5)!, 5) === '1.5', 'DOG: display → base → display is exact')

  const k = 1500n, r = 1000n * 10n ** 5n
  const dog = midSpot(k, r, 5)!
  ok(dog.runePerKray === '0.66666', '1500 ₭ / 1000 DOG: 1 ₭ = 0.66666 DOG (edict 5, leftover named)')
  ok(dog.krayFloorPerRune === 1n && dog.krayCeilPerRune === 2n, '1 DOG ≈ 2 ₭ — ₭ approximates, never 1.5')
  ok(toBaseUnits(dog.runePerKray, 5) === dog.runeBasePerKray.toString(), 'spot display is a legal edict amount')

  const eleven = midSpot(1000n, 1111n * 10n ** 3n, 3)!
  ok(eleven.runePerKray === '1.111', '1000 ₭ / 1111 rune (div 3): 1 ₭ = 1.111 rune')
  ok(eleven.krayCeilPerRune === 1n, '1.111 rune per ₭ → 1 rune is covered by 1 ₭')

  ok(toBaseUnits('abc', 5) === null, 'garbage is refused')
  let threw = false
  try { toBaseUnits('1', 99) } catch { threw = true }
  ok(threw, 'divisibility > 38 (beyond the edict) is refused')

  const DIVS = [0, 1, 2, 3, 4, 5, 10, 12, 18] as const
  const PER: Record<number, string> = {
    0: '0', 1: '0.6', 2: '0.66', 3: '0.666', 4: '0.6666', 5: '0.66666',
    10: '0.6666666666', 12: '0.666666666666', 18: '0.666666666666666666',
  }
  for (const d of DIVS) {
    const one = toBaseUnits('1', d)
    ok(one === (10n ** BigInt(d)).toString(), `div=${d}: 1 display = 10^${d} base`)
    ok(fromBaseUnits(one!, d) === '1', `div=${d}: 10^${d} base reads 1`)
    ok(fromBaseUnits(toBaseUnits('1', d)!, d) === '1', `div=${d}: 1 ↔ 1 is exact`)
    const extra = d === 0 ? '1.0' : `1.${'0'.repeat(d)}1`
    ok(toBaseUnits(extra, d) === null, `div=${d}: one extra digit is refused, not rounded`)
    const spot = midSpot(1500n, 1000n * (10n ** BigInt(d)), d)!
    ok(spot.runePerKray === PER[d], `div=${d}: 1 ₭ = ${PER[d]} display-rune (edict floor)`)
    ok(spot.krayCeilPerRune === 2n, `div=${d}: 1 display-rune ≈ 2 ₭ (never 1.5 ₭)`)
    ok(toBaseUnits(spot.runePerKray, d) === spot.runeBasePerKray.toString(), `div=${d}: spot is an edict-legal amount`)
  }

  const iron = midSpot(1500n, 1000n, 0)!
  ok(iron.runePerKray === '0', 'div=0: 1 ₭ buys 0 whole IRON (no point to show 0.666)')
  ok(iron.rem === 1000n, 'div=0: leftover 1000 base is named, not rounded into ₭')

  ok(toBaseUnits('100000000000', 5) === '10000000000000000', 'DOG 100 billion display = 10^16 base (ord premine)')
  ok(fromBaseUnits('10000000000000000', 5) === '100000000000', 'DOG 10^16 base reads 100 billion')
  ok(toBaseUnits('0.000000000000000001', 18) === '1', 'div=18: one wei-scale unit is 1 base')
  ok(toBaseUnits('1.0000000000000000001', 18) === null, 'div=18: a 19th decimal dies')
  ok(toBaseUnits('10.5', KRAY_DIVISIBILITY) === null, '₭ 10.5 is never a signed amount')

  const asKray = pairSpot(1500n, 0, 1000n * 10n ** 5n, 5)!
  ok(asKray.bPerDisplayA === dog.runePerKray, 'pairSpot divA=0 matches midSpot (1 ₭ = 0.66666 DOG)')
  ok(asKray.aCeilPerDisplayB === '2', 'pairSpot: 1 DOG ≈ 2 ₭ — still no 1.5 ₭')

  const goldDog = pairSpot(1000n * 10n ** 2n, 2, 1111n * 10n ** 5n, 5)!
  ok(goldDog.bPerDisplayA === '1.111', '1.00 GOLD = 1.111 DOG (GOLD div 2, DOG div 5)')
  ok(toBaseUnits(goldDog.bPerDisplayA, 5) === goldDog.bBasePerDisplayA.toString(), 'RR spot B is edict-legal for B')
  ok(toBaseUnits(goldDog.aPerDisplayB, 2) === goldDog.aBasePerDisplayB.toString(), 'RR spot A is edict-legal for A')
  ok(toBaseUnits('1.1111', 2) === null, 'GOLD div 2 refuses a 3rd decimal — the pair does not invent an edict')

  const sameDiv = pairSpot(3000n, 0, 1000n, 0)!
  ok(sameDiv.bPerDisplayA === '0', 'two div=0 runes: 1 A buys 0 whole B (leftover named)')
  ok(sameDiv.remB === 1000n, 'div=0/div=0 leftover is the B pile, not a fake point')

  console.log(`\n✓ ${pass} checks — edict on the rune; ₭ is 1=1; leftover named. ₿₭`)
}
main()
