/**
 * Unfurl — SSRF closed + OG parse. No live fetch.
 *   node unfurl.test.mjs
 */
import { isPrivateIp, assertHttpsShape, parsePagePreview } from './unfurl.mjs'

function ok(cond, msg) {
  if (!cond) throw new Error('FAIL ' + msg)
  console.log('  ok  ' + msg)
}

ok(isPrivateIp('127.0.0.1'), 'loopback v4')
ok(isPrivateIp('10.1.2.3'), '10/8')
ok(isPrivateIp('192.168.0.9'), '192.168/16')
ok(isPrivateIp('172.16.0.1'), '172.16/12')
ok(isPrivateIp('169.254.169.254'), 'link-local / metadata')
ok(isPrivateIp('::1'), 'loopback v6')
ok(isPrivateIp('::ffff:127.0.0.1'), 'v4-mapped loopback')
ok(!isPrivateIp('1.1.1.1'), 'public v4')

let threw = false
try { assertHttpsShape('http://example.com') } catch { threw = true }
ok(threw, 'http refused')
threw = false
try { assertHttpsShape('https://127.0.0.1/') } catch { threw = true }
ok(threw, 'https loopback refused')
threw = false
try { assertHttpsShape('https://user:pass@example.com/') } catch { threw = true }
ok(threw, 'credentials refused')
threw = false
try { assertHttpsShape('https://example.com:8443/') } catch { threw = true }
ok(threw, 'non-443 refused')
ok(assertHttpsShape('https://www.example.com/path').hostname === 'www.example.com', 'https public accepted')

const html = `
<!doctype html><html><head>
<title>Fallback Title</title>
<meta property="og:title" content="OG Title &amp; Co">
<meta name="twitter:description" content="A short blurb">
<meta property="og:image" content="/front.jpg">
</head></html>`
const p = parsePagePreview(html, 'https://news.example/story')
ok(p.host === 'news.example', 'host from page')
ok(p.title === 'OG Title & Co', 'og:title wins + entities')
ok(p.description === 'A short blurb', 'twitter:description')
ok(p.image === 'https://news.example/front.jpg', 'relative og:image resolved https')

const evil = parsePagePreview(
  '<meta property="og:image" content="http://evil.example/x.jpg">',
  'https://news.example/',
)
ok(evil.image === '', 'http og:image dropped')

const localImg = parsePagePreview(
  '<meta property="og:image" content="https://127.0.0.1/x.jpg">',
  'https://news.example/',
)
ok(localImg.image === '', 'loopback og:image dropped')

console.log('unfurl tests passed')
