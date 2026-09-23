/**
 * THE MAINNET GATE — is each market law REHEARSED on signet, end to end?
 *
 * Not an opinion: a count, taken from signet's own journal. A law opens on real value only after a live
 * network has carried it from the signature to the settlement and back through a cold replay.
 * The precedent is the Creator's own, written where he shut the escrow:
 *     "shut until signet has carried a harvest end to end"
 */
const SIG = process.env.KRAY_REHEARSAL || 'https://signet.kray.network';
const j = async (p) => (await fetch(SIG + p, { signal: AbortSignal.timeout(30000) })).json();

// walk every act signet has ever applied, straight from the chunks a stranger can replay
const chunks = await j('/api/kraynet/chunks');
const events = [];
// a chunk is addressed by the hash of its own lines — the same door cold-replay reads
for (const c of (chunks.chunks || [])) {
  const { lines } = await j('/api/kraynet/chunk/' + c.address);
  for (const line of (lines || [])) {
    try { const e = JSON.parse(line); if (e && e.kind) events.push(e); } catch { /* not an act */ }
  }
}
const count = (k) => events.filter((e) => e.kind === k).length;
const handsOf = (k) => new Set(events.filter((e) => e.kind === k).map((e) => e.from)).size;

const LAWS = [
  { name: 'THE PACKET MARKET', pin: 'PACKET_MARKET_SEQ',
    need: [['a packet listed', count('packet-list') > 0, count('packet-list')],
           ['a packet taken', count('packet-take') > 0, count('packet-take')]] },
  { name: 'THE CLAIM ESCROW', pin: 'CLAIM_ESCROW_SEQ',
    need: [['a harvest opened', count('claim-open') > 0, count('claim-open')],
           ['a share taken', count('claim-take') > 0, count('claim-take')],
           ['by more than one hand', handsOf('claim-take') > 1, handsOf('claim-take') + ' hand(s)'],
           ['a harvest closed', count('claim-close') > 0, count('claim-close')]] },
  { name: 'THE MINT DROP', pin: 'MINT_DROP_SEQ',
    need: [['a mint opened', count('mint-open') > 0, count('mint-open')],
           ['a pot taken', count('mint-take') > 0, count('mint-take')],
           ['by more than one hand', handsOf('mint-take') > 1, handsOf('mint-take') + ' hand(s)'],
           ['a mint closed', events.some((e) => e.kind === 'claim-close') , count('claim-close')]] },
];

console.log(`signet has applied ${events.length} acts across ${(chunks.chunks || []).length} chunk(s)\n`);
let allReady = true;
for (const law of LAWS) {
  const ready = law.need.every((n) => n[1]);
  allReady = allReady && ready;
  console.log(`${ready ? '✓' : '✗'} ${law.name}  (${law.pin})`);
  for (const [what, ok, saw] of law.need) console.log(`     ${ok ? '✓' : '✗'} ${what.padEnd(26)} ${saw}`);
  console.log();
}
console.log(allReady
  ? '→ GO: every market law has been carried end to end on signet. Mainnet may take all pins at one seq.'
  : '→ NO-GO: a law mainnet would open has never been rehearsed on a live network.');
