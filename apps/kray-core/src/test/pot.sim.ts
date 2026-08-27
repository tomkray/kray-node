/**
 * THE ANCHORING POT UNDER STORM — the cascade check for Phase 2's mint.
 *   node src/test/pot.sim.ts
 *
 * KRAY is born only from sacrifice: 1 satoshi ⇒ 1 ₭, capped at the pot's deficit; the
 * whole donation funds the pot (excess = runway, never wasted); anchoring drains the pot
 * and REOPENS minting. This drives thousands of random donations and anchor spends and
 * re-asserts the laws that make the network fair, durable, and un-gameable:
 *   · PEG-OF-SACRIFICE   minted ≤ donated, always — no ₭ without a real satoshi
 *   · NEVER WASTES        held == donated − spent; every donated sat is in the pot or spent
 *   · ANTI-WHALE          a single huge donation never mints more than the deficit
 *   · NO ZERO-MINT        a donation the pot accepts always mints ≥ 1 ₭ (never rounds to 0)
 *   · FULL POT REFUSES    donating into a full pot is refused (no sat taken for nothing)
 *   · SELF-REGULATING     drain the pot → deficit reopens → minting resumes
 *   · SYBIL-BOUNDED        splitting a donation into many mints no more than one big one
 * Then a byte-exact replay proves the pot is a pure function of its donate/anchor history.
 */
import { AnchoringPot } from '../protocol/pot.ts'

let pass = 0
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  console.error(`  ✗ FAILED — ${label}`); process.exit(1)
}
function lcg(seed: number) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000 }

type Op = { t: 'donate'; sats: bigint } | { t: 'anchor'; sats: bigint }

/** Replay a history into a fresh pot — the pot must be a pure function of its ops. */
function replay(target: bigint, ops: Op[]): AnchoringPot {
  const p = new AnchoringPot(target)
  for (const o of ops) { if (o.t === 'donate') { if (p.isOpen()) p.absorb(o.sats) } else { if (o.sats <= p.satsHeld) p.spendOnAnchor(o.sats) } }
  return p
}

function main(): void {
  const seeds = [5, 23, 101, 7777, 424242]
  let totalOps = 0, donations = 0, anchors = 0, refusedFull = 0, reopened = 0

  for (const seed of seeds) {
    const rnd = lcg(seed)
    const target = 10_000n + BigInt(Math.floor(rnd() * 90_000)) // varied runway targets
    const p = new AnchoringPot(target)
    const ops: Op[] = []
    let mintedShadow = 0n, donatedShadow = 0n, spentShadow = 0n
    let wasFull = false

    for (let step = 0; step < 400; step++) {
      const doDonate = rnd() < 0.62
      if (doDonate) {
        // sometimes a whale (10× the whole target) to prove the deficit cap holds
        const whale = rnd() < 0.12
        const sats = whale ? target * 10n : 1n + BigInt(Math.floor(rnd() * Number(target / 4n + 1n)))
        const deficitBefore = p.deficit()
        const preview = p.previewMint(sats)
        if (!p.isOpen()) {
          // full pot — the door must refuse, pot untouched
          let threw = false
          try { p.absorb(sats) } catch { threw = true }
          ok(threw, `${seed}.${step}: full pot REFUSES the donation`)
          refusedFull++
        } else {
          const minted = p.absorb(sats)
          ok(minted === preview, `${seed}.${step}: mint matches the pure preview`)
          ok(minted === (sats < deficitBefore ? sats : deficitBefore), `${seed}.${step}: mint == min(sats, deficit)`)
          ok(minted >= 1n, `${seed}.${step}: NO ZERO-MINT — an accepted donation mints ≥ 1`)
          ok(minted <= deficitBefore, `${seed}.${step}: ANTI-WHALE — mint never exceeds the deficit`)
          ops.push({ t: 'donate', sats })
          donatedShadow += sats; mintedShadow += minted; donations++
        }
      } else {
        // anchoring spends from the pot — drains it, reopening the deficit
        if (p.satsHeld === 0n) { continue }
        const sats = 1n + BigInt(Math.floor(rnd() * Number(p.satsHeld)))
        const wasOpenBefore = p.isOpen()
        p.spendOnAnchor(sats)
        ops.push({ t: 'anchor', sats })
        spentShadow += sats; anchors++
        if (!wasOpenBefore && p.isOpen()) reopened++ // a full pot reopened by anchoring
      }

      // ── the laws, re-checked after EVERY op ──
      ok(p.krayMinted === mintedShadow, `${seed}.${step}: minted shadow`)
      ok(p.satsDonated === donatedShadow, `${seed}.${step}: donated shadow`)
      ok(p.satsSpent === spentShadow, `${seed}.${step}: spent shadow`)
      ok(p.satsHeld === donatedShadow - spentShadow, `${seed}.${step}: NEVER WASTES — held == donated − spent`)
      ok(p.krayMinted <= p.satsDonated, `${seed}.${step}: PEG — minted ≤ donated`)
      ok(p.balances(), `${seed}.${step}: pot books balance`)
      ok(p.deficit() === (target > p.satsHeld ? target - p.satsHeld : 0n), `${seed}.${step}: deficit == max(0, target − held)`)
      if (p.deficit() === 0n) wasFull = true
      totalOps++
    }

    // ── SELF-REGULATING — on a SEPARATE clone (ops/shadows untouched): a full pot, once
    //    drained to empty, reopens and mints again ──
    if (wasFull) {
      const clone = replay(target, ops)
      if (clone.satsHeld > 0n) clone.spendOnAnchor(clone.satsHeld) // drain to empty
      ok(clone.isOpen(), `${seed}: drained pot has reopened (deficit > 0)`)
      ok(clone.absorb(100n) === 100n, `${seed}: SELF-REGULATING — minting resumed after the drain`)
    }

    // ── THE REBOOT IS THE VERIFIER — replay the ops into a fresh pot ──
    const a = replay(target, ops), b = replay(target, ops)
    ok(a.commitment() === b.commitment(), `${seed}: replay is deterministic`)
    ok(a.satsHeld === (donatedShadow - spentShadow), `${seed}: REBOOT held byte-exact`)
    ok(a.krayMinted === mintedShadow, `${seed}: REBOOT minted byte-exact`)
    ok(a.balances() && a.krayMinted <= a.satsDonated, `${seed}: reboot laws hold`)
  }

  // ── THE ADVERSARIAL DOORS ──
  const p = new AnchoringPot(1000n)
  ok(p.deficit() === 1000n && p.isOpen(), 'fresh pot: full deficit, open')

  // anti-whale: one donation of 10× the target mints exactly the target, no more
  const whaleMint = p.absorb(10_000n)
  ok(whaleMint === 1000n, 'ANTI-WHALE: a 10× donation mints exactly the deficit (1000), not 10000')
  ok(p.satsHeld === 10_000n, 'the whole whale donation still funds the pot (9000 excess = runway)')
  ok(!p.isOpen(), 'pot is now full — minting closed')
  ok(p.krayMinted === 1000n && p.satsDonated === 10_000n, 'PEG holds: minted (1000) ≤ donated (10000)')

  // full pot refuses — no sat taken for nothing
  let threw = false
  try { p.absorb(500n) } catch { threw = true }
  ok(threw, 'FULL POT REFUSES a further donation')
  ok(p.satsHeld === 10_000n && p.krayMinted === 1000n, 'refused donation left the pot untouched')

  // Sybil: splitting a donation mints no more than one big donation
  const solo = new AnchoringPot(1000n); const soloMint = solo.absorb(10_000n)
  const split = new AnchoringPot(1000n); let splitMint = 0n
  for (let i = 0; i < 100; i++) { if (split.isOpen()) splitMint += split.absorb(100n) }
  ok(splitMint === soloMint, `SYBIL-BOUNDED: split mint (${splitMint}) == solo mint (${soloMint})`)

  // drain reopens minting
  p.spendOnAnchor(9500n)
  ok(p.isOpen() && p.deficit() === 500n, 'anchoring drained the pot → deficit reopened to 500')
  ok(p.absorb(500n) === 500n, 'SELF-REGULATING: minting resumed after the drain')

  // never a zero mint on an open pot; never overspend
  let ov = false; try { p.spendOnAnchor(p.satsHeld + 1n) } catch { ov = true }
  ok(ov, 'anchor overspend refused')

  console.log(`\n✓ ${pass} checks passed — THE ANCHORING POT HOLDS UNDER STORM: ${totalOps} ops across ${seeds.length} seeds (${donations} donations, ${anchors} anchor spends, ${refusedFull} full-pot refusals, ${reopened} reopenings by drain), the peg-of-sacrifice (minted ≤ donated) never broke, no satoshi was ever wasted (held == donated − spent), a whale never minted past the deficit, an accepted donation never minted zero, splitting never beat one big donation, the pot self-regulated (drain → reopen → mint), and a byte-exact replay proves the pot is a pure function of its history. Proof-of-donation, no premine, atemporal. ₿→₭`)
}
main()
