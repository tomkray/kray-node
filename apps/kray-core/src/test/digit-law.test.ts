/**
 * DIGIT LAW — polarity + the pin the door/reducer share.
 *   node src/test/digit-law.test.ts
 *
 * Main and signet are born active (0). Regtest stays MAX (benches).
 * The IR refuse is proven in isqrt-law.test.ts (N2-10…N2-13).
 */
import { KrayLedger } from '../protocol/ledger.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }

/** 22nd ctor arg = digitLawSeq. */
const pinned = (net: string, seq: number) =>
  new KrayLedger(undefined, net, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, seq)

function main() {
  console.log('\n╔═ DIGIT LAW: 78-digit cap born active on signet + main ═╗\n')

  ok(new KrayLedger(undefined, 'main').digitLawActive(1), 'D-01 default main is on from seq 0')
  ok(new KrayLedger(undefined, 'signet').digitLawActive(1), 'D-02 default signet rehearses main')
  ok(!new KrayLedger(undefined, 'regtest').digitLawActive(1), 'D-03 default regtest stays a bench')
  ok(pinned('regtest', 0).digitLawActive(1), 'D-04 lab inject 0 on regtest turns the law on')
  ok(!pinned('main', Number.MAX_SAFE_INTEGER).digitLawActive(1), 'D-05 inject MAX on main is the bench residual')

  if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
  console.log(`\n╚═ ${pass} passed — digit law polarity frozen; IR refuse in isqrt-law. ₭\n`)
}
main()
