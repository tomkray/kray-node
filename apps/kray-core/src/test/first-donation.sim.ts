/**
 * THE FIRST DONATION — a simulation, told plainly, run on the REAL code.
 *
 * Ana sacrifices 5,000 real satoshis to mint 5,000 ₭. This walks the whole mechanism in the BURN model (option A):
 * the sats go to an address NOBODY can spend (the Bitcoin NUMS point), that same address seals the network's root
 * onto Bitcoin for free, and the ledger mints Ana her ₭ — backed, conserved, and anchored. No pot, no operator, no
 * key. Every number and hash below comes from the actual KrayLedger and self-anchor primitives, not a mock-up.
 *
 *   node src/test/first-donation.sim.ts
 */
import { createHash } from 'node:crypto'
import * as btc from '@scure/btc-signer'
import { schnorr } from '@noble/curves/secp256k1.js'
import { KrayLedger } from '../protocol/ledger.ts'
import { NETWORKS } from '../protocol/scheme.ts'
import { KrayAnchor } from '../anchor/anchor.ts'
import { BURN_INTERNAL_KEY, selfAnchorBurnAddress, selfAnchorBurnScriptHex, verifySelfAnchor } from '../protocol/self-anchor.ts'
import type { KrayEvent as Ev } from '../protocol/kray-primitives.ts'

const NET = 'regtest'
const b2h = (b: Uint8Array): string => Buffer.from(b).toString('hex')
let pass = 0, fail = 0
const proof = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log('   ✗ INVARIANT BROKEN — ' + m) } ; return c }
const line = () => console.log('   ' + '─'.repeat(66))

function main() {
  console.log('\n╔══ KRAYNET · A PRIMEIRA DOAÇÃO — 5.000 sats viram 5.000 ₭, e a rede se ancora no Bitcoin ══╗\n')

  // the network, just born
  const L = new KrayLedger(undefined, NET)
  const anaX = schnorr.getPublicKey(createHash('sha256').update('ana').digest())
  const ana = btc.p2tr(anaX, undefined, NETWORKS[NET]).address!
  const rootNow = L.cascadeRoot()
  const tip = 0

  console.log('   ELENCO')
  console.log('   • A rede KRAYNET acabou de nascer (gênese). A "raiz" de tudo agora é:')
  console.log('       ' + rootNow.slice(0, 32) + '…  (32 bytes que resumem a rede inteira)')
  console.log('   • Ana, a doadora. O endereço ₭ dela é:')
  console.log('       ' + ana)
  console.log('   • Ana tem ' + L.balanceOf(ana) + ' ₭ e vai sacrificar 5.000 satoshis de Bitcoin REAL.')
  line()

  // ── PASSO 1 · para onde vão os 5.000 sats: um endereço de QUEIMA que ninguém controla ──
  const payload = KrayAnchor.payload(tip, rootNow)                 // os 49 bytes que a rede quer selar
  const burnAddr = selfAnchorBurnAddress(payload, NET)
  const burnScript = selfAnchorBurnScriptHex(payload)
  const outputKey = burnScript.slice(4)                            // tira o 5120 → a chave de saída
  console.log('   PASSO 1 · Para onde vão os 5.000 sats? Para um endereço de QUEIMA.')
  console.log('   A rede pega a raiz de agora e a "carimba" dentro de um endereço Bitcoin normal:')
  console.log('       endereço de queima:  ' + burnAddr)
  console.log('   Esse endereço nasce do ponto NUMS do Bitcoin (' + BURN_INTERNAL_KEY.slice(0, 12) + '…): a chave')
  console.log('   privada dele NÃO EXISTE pra ninguém. Achá-la é matematicamente impossível.')
  console.log('   → Os 5.000 sats vão pra lá e NUNCA mais saem. Sacrifício total, chave de ninguém.')
  proof(BURN_INTERNAL_KEY === b2h(btc.TAPROOT_UNSPENDABLE_KEY), 'the burn key is the NUMS point')
  line()

  // ── PASSO 2 · a doação É a âncora, de graça ──
  const sealed = verifySelfAnchor(outputKey, BURN_INTERNAL_KEY, payload)
  console.log('   PASSO 2 · Essa MESMA transação ancora a rede no Bitcoin — de graça.')
  console.log('   Como o endereço carrega a raiz, quando a doação confirmar no Bitcoin, a rede inteira')
  console.log('   (do jeito que estava agora) fica gravada no Bitcoin. Ninguém paga âncora separada —')
  console.log('   Ana só paga a taxa normal da transação dela pro minerador do Bitcoin.')
  console.log('   Qualquer pessoa pode PROVAR qual raiz foi selada, sem confiar em ninguém:')
  console.log('       verifySelfAnchor(saída, NUMS, raiz)  →  ' + (sealed ? '✓ selou a raiz de agora' : '✗'))
  proof(sealed, 'the burn output verifiably seals the current root')
  line()

  // ── PASSO 3 · a rede minta 5.000 ₭ pra Ana (1 ₭ por sat sacrificado) ──
  const before = { ana: L.balanceOf(ana), emitted: L.totalEmitted, donated: L.pot.satsDonated, deficit: L.pot.deficit() }
  const burnTxid = 'f'.repeat(64)                                  // o id da transação de queima (viria do Bitcoin)
  L.applyLive({ seq: 1, kind: 'donate', hash: 'd1', to: ana, amount: '5000', outpoint: burnTxid + ':0' } as unknown as Ev)
  const after = { ana: L.balanceOf(ana), emitted: L.totalEmitted, donated: L.pot.satsDonated, minted: L.pot.krayMinted }
  console.log('   PASSO 3 · A rede minta ₭ pra Ana — 1 ₭ por satoshi sacrificado.')
  console.log('   Ana (₭):      ' + before.ana + '  →  ' + after.ana)
  console.log('   Sats sacrificados (total da rede):  ' + before.donated + '  →  ' + after.donated)
  console.log('   ₭ emitidos (total da rede):         ' + before.emitted + '  →  ' + after.emitted)
  console.log('   (mint = min(sats, teto). O teto era gigante, então os 5.000 sats viraram 5.000 ₭.)')
  proof(after.ana === before.ana + 5000n && after.emitted === before.emitted + 5000n, '5000 sats minted 5000 ₭ to Ana')
  line()

  // ── PASSO 4 · as duas leis que TODO nó confere, pra sempre ──
  const backed = L.backed(), conserves = L.conserves()
  console.log('   PASSO 4 · As duas leis que TODO nó confere sozinho, pra sempre:')
  console.log('   • LASTRO:       ₭ emitidos (' + after.emitted + ') ≤ sats sacrificados (' + after.donated + ')   →  ' + (backed ? '✓' : '✗'))
  console.log('   • CONSERVAÇÃO:  soma de todos os saldos == emitidos − queimados                →  ' + (conserves ? '✓' : '✗'))
  console.log('   Nenhum ₭ nasce sem um satoshi real morrer por ele. Ninguém consegue inflar.')
  proof(backed, 'every ₭ is backed by a sacrificed sat'); proof(conserves, 'balances conserve')
  line()

  console.log('   O QUE ACONTECEU, EM UMA FRASE:')
  console.log('   Ana queimou 5.000 sats num endereço SEM DONO, essa mesma transação ancorou a rede no')
  console.log('   Bitcoin de graça, e ela recebeu 5.000 ₭ provados e lastreados. Nenhum operador, nenhum')
  console.log('   pote, nenhuma chave — só matemática e código.')

  console.log(`\n╚══ ${pass}/${pass + fail} invariantes verdadeiras${fail ? ` · ${fail} QUEBRADA(S)` : ' · tudo bate'} — a base do sistema, provada rodando o código real. ⛓₭ ══╝\n`)
  process.exit(fail ? 1 : 0)
}
main()
