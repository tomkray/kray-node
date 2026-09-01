/**
 * ATO C — PUBLIC HOST: the mint-shelf string is the same judge as gossip.
 *   node src/test/public-host.test.ts
 *
 * Door, not consensus. Closes the mapped-IPv6 hole (::ffff:169.254.169.254)
 * that the old assertPublicHost regex missed.
 */
import { isPublicAddress, isPublicHostname, isPublicHttpHost } from '../protocol/public-host.ts'
import { parseMintShelf } from '../protocol/star-forms.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ FAIL — ' + m) } }
const rejects = (fn: () => void, re: RegExp, m: string) => {
  try { fn(); ok(false, m + ' — DID NOT throw') }
  catch (e) { const msg = (e as Error).message; ok(re.test(msg), m + (re.test(msg) ? '' : ' — wrong error: ' + msg)) }
}

console.log('\n╔═ ATO C — PUBLIC HOST: mapped metadata cannot pass the mint-shelf ═╗\n')

ok(!isPublicHttpHost('http://[::ffff:169.254.169.254]/latest/meta-data/'), 'C-01 mapped IPv4 link-local is not a public HTTP host')
ok(!isPublicHttpHost('http://[::ffff:a9fe:a9fe]/x'), 'C-02 mapped hex 169.254.169.254 is refused')
ok(!isPublicHttpHost('http://[::127.0.0.1]/'), 'C-03 IPv4-compatible loopback is refused')
ok(!isPublicHostname('::ffff:127.0.0.1'), 'C-04 mapped loopback hostname is refused')
ok(!isPublicAddress('169.254.169.254'), 'C-05 link-local address is not public')
ok(!isPublicAddress('::ffff:169.254.169.254'), 'C-06 mapped link-local address is not public')
ok(isPublicHttpHost('https://cdn.example/{n}.png'.replace(/\{n\}/g, '0')), 'C-07 a public DNS name still passes the literal judge')
ok(isPublicAddress('1.2.3.4') && isPublicAddress('8.8.8.8'), 'C-08 genuine public v4 stays public')
ok(isPublicHostname('cdn.example'), 'C-09 a DNS name is allowed at parse — rebinding is the fetch pin')

rejects(() => parseMintShelf('http://[::ffff:169.254.169.254]/latest/meta-data/'), /public/, 'C-10 mint shelf refuses mapped metadata (the named hole)')
rejects(() => parseMintShelf('http://169.254.169.254/x.png'), /public/, 'C-11 mint shelf refuses dotted link-local')
rejects(() => parseMintShelf('http://[::1]/x.png'), /public/, 'C-12 mint shelf refuses IPv6 loopback')
rejects(() => parseMintShelf('http://100.64.0.1/x.png'), /public/, 'C-13 mint shelf refuses CGNAT')
rejects(() => parseMintShelf('http://localhost./x.png'), /public/, 'C-14 trailing-dot localhost is still loopback')
ok(parseMintShelf('https://cdn.example/{n}.png') === 'https://cdn.example/{n}.png', 'C-15 a public shelf is unchanged')

if (fail) { console.error(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1) }
console.log(`\n╚═ ${pass} passed — one judge; mapped metadata cannot open the desk. ₭\n`)
