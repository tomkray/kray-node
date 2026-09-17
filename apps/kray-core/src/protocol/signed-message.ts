/**
 * THE SIGNED BYTES OF AN EVENT — one pure function, two consumers (THE SAME-INSTANT LAW's foundation).
 *
 * The reducer verifies every signed act against a per-kind canonical message built inline in its own
 * case (`ledger.ts`). The same-instant order law needs that exact string BEFORE an act applies — the
 * door must key concurrent submits by `sha256(signed bytes)` (window-order.ts, the ungrindable
 * tiebreak) and emit an order the reducer's law will accept. Two independent constructions of the
 * message would be a silent fork waiting to happen, so this module is the MIRROR and `requireSig`
 * is the REFEREE: on EVERY apply and EVERY replay the reducer asserts its inline message equals
 * this function's output. Parity is not a test that ran once — it is re-proven on every act, on
 * every node, fail-closed (a divergence refuses the act at the door before any journal write; no
 * follower ever sees it, so no fork).
 *
 * RULES OF THE MIRROR:
 *   · Field derivations are copied VERBATIM from the reducer's cases (posAmt, rrPairKey, onStar…).
 *     If a case's derivation changes, the referee explodes the whole suite instantly.
 *   · This function may THROW on an event too malformed to have signed bytes (e.g. a non-numeric
 *     amount) — every such event is refused by the reducer's own validation before requireSig, so
 *     the referee never meets the throw. The door treats a throw as "no key" and gives the act its
 *     own instant (it will fail at the reducer with the honest per-kind error).
 *   · An unsigned kind (donate, seal, settlement, exit rows…) returns null — no key, breaks a run.
 *   · quantum-migrate (Lamport, verified outside requireSig) returns null too: it never enters the
 *     inclusion SMT today, so it stays exempt from the run law — consistent, and named honestly.
 */
import {
  transferMessage, xSendMessage, cutSendMessage, burnMessage, sendStarMessage, starListMessage, starDelistMessage, starBuyMessage, starOfferMessage, starOfferCancelMessage, starOfferAcceptMessage, inscribeMessageV2, nameMessageV2, originMessageV2,
  inscribeMessageV3, inscribeMessageV4, inscribeMessageV5, inscribeMessageV6,
  runeSendMessage, runeExitMessage, runeCancelMessage, ammAddMessage, ammRemoveMessage, ammSwapMessage,
  ammRrAddMessage, ammRrRemoveMessage, ammRrSwapMessage, contractMessage, contractMessageV2, eternizeMessage,
  contractCallMessage, contractCallMessageV2, quantumCommitMessage,
  laneEnterMessage, laneExitMessage, foldSealMessage, setFaceMessage, clearFaceMessage, setProfileMessage,
  starLikeMessage,
} from './scheme.ts'
import { setKrayPlateMessage } from './kray-plate.ts'
import { sha256hex, type KrayEvent } from './kray-primitives.ts'
import { canonicalCode } from './contract.ts'
import { rrPairKey } from './amm.ts'
import { canonicalRuneKey } from '../economics/rune-book.ts'

/** verbatim twin of the reducer's posAmt — same acceptance, same refusal */
function posAmt(raw: string | undefined, name: string): bigint {
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) throw new Error(`ledger: ${name} must be a whole number of base units`)
  return BigInt(raw)
}

/** The per-kind canonical message (WITHOUT the deadline suffix), or null for an unsigned/exempt kind. */
export function signedMessageOfEvent(e: KrayEvent, network: string): string | null {
  switch (e.kind) {
    case 'quantum-commit': {
      const commit = String(e.quantumCommit || '').toLowerCase()
      return quantumCommitMessage(network, e.from!, commit, e.nonce!)
    }
    case 'transfer': return transferMessage(network, e.from!, e.to!, BigInt(e.amount!), e.nonce!)
    case 'transfer-star': return sendStarMessage(network, e.from!, e.to!, BigInt(e.star!), e.nonce!)
    // THE STAR MARKET — verbatim twins of the reducer's cases (the referee re-proves parity on every replay)
    case 'star-list': return starListMessage(network, e.from!, BigInt(e.star!), BigInt(e.amount!), e.nonce!)
    case 'star-delist': return starDelistMessage(network, e.from!, BigInt(e.star!), e.nonce!)
    case 'star-buy': return starBuyMessage(network, e.from!, BigInt(e.star!), BigInt(e.amount!), e.to!, e.nonce!)
    case 'star-offer': return starOfferMessage(network, e.from!, BigInt(e.star!), BigInt(e.amount!), e.nonce!)
    case 'star-offer-cancel': return starOfferCancelMessage(network, e.from!, BigInt(e.star!), e.nonce!)
    case 'star-offer-accept': return starOfferAcceptMessage(network, e.from!, BigInt(e.star!), BigInt(e.amount!), e.to!, e.nonce!)
    case 'x-send': return xSendMessage(network, e.from!, e.to!, BigInt(e.amount!), e.nonce!)
    case 'cut-send': return cutSendMessage(network, e.from!, e.to!, BigInt(e.star!), BigInt(e.amount!), e.nonce!)
    case 'burn': return burnMessage(network, e.from!, BigInt(e.amount!), e.nonce!)
    // THE TK-FOLD (Gate 2) — the lane's journal kinds, verbatim twins of the reducer's cases
    case 'lane-enter': return laneEnterMessage(network, e.from!, BigInt(e.amount!), e.nonce!)
    case 'lane-exit': return laneExitMessage(network, e.from!, BigInt(e.amount!), e.nonce!)
    case 'fold-seal': return foldSealMessage(network, e.from!, e.foldPre!, e.foldPost!, e.foldDiffsHash!, e.nonce!)
    case 'name': case 'origin': case 'inscribe': {
      const useV3 = e.parents !== undefined || e.origins !== undefined
      const useV4 = e.meta !== undefined
      const useV5 = e.bodyHash !== undefined
      const useV6 = e.originCohortRoot !== undefined
      const onStar = (e.kind !== 'origin' && e.star != null) ? BigInt(e.star) : undefined
      return e.kind === 'name' ? nameMessageV2(network, e.from!, e.nonce!, e.name!, onStar)
        : e.kind === 'origin' ? originMessageV2(network, e.from!, e.l1InscriptionId!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.nonce!)
        : useV6 ? inscribeMessageV6(network, e.from!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.parents ?? [], e.origins ?? [], e.originCohortRoot!, e.nonce!, onStar, e.bodyHash, e.meta)
        : useV5 ? inscribeMessageV5(network, e.from!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.parents ?? [], e.origins ?? [], e.bodyHash!, e.nonce!, onStar, e.meta)
        : useV4 ? inscribeMessageV4(network, e.from!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.parents ?? [], e.origins ?? [], e.meta!, e.nonce!, onStar)
        : useV3 ? inscribeMessageV3(network, e.from!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.parents ?? [], e.origins ?? [], e.nonce!)
        : inscribeMessageV2(network, e.from!, e.contentHash!, e.contentType ?? 'application/octet-stream', e.size!, e.parent !== undefined ? BigInt(e.parent) : undefined, e.nonce!, onStar)
    }
    case 'rune-send': return runeSendMessage(network, e.from!, e.to!, e.runeId!, BigInt(e.amount!), e.nonce!)
    case 'rune-exit': return runeExitMessage(network, e.from!, e.runeId!, BigInt(e.amount!), e.l1Address!, e.nonce!)
    case 'rune-cancel': return runeCancelMessage(network, e.from!, e.runeId!, e.nonce!)
    case 'amm-add': return ammAddMessage(network, e.from!, e.runeId!, posAmt(e.krayIn, 'krayIn'), posAmt(e.runeIn, 'runeIn'), posAmt(e.minLp ?? '0', 'minLp'), e.nonce!)
    case 'amm-remove': return ammRemoveMessage(network, e.from!, e.runeId!, posAmt(e.lp, 'lp'), posAmt(e.minKrayOut ?? '0', 'minKrayOut'), posAmt(e.minRuneOut ?? '0', 'minRuneOut'), e.nonce!)
    case 'amm-swap': return ammSwapMessage(network, e.from!, e.runeId!, e.side!, posAmt(e.amount, 'amountIn'), posAmt(e.minOut ?? '0', 'minOut'), e.nonce!)
    case 'amm-rr-add': {
      const pair = rrPairKey(e.runeId!, e.otherRuneId!)
      return ammRrAddMessage(network, e.from!, pair.a, pair.b, posAmt(e.runeIn, 'runeIn'), posAmt(e.otherIn, 'otherIn'), posAmt(e.minLp ?? '0', 'minLp'), e.nonce!)
    }
    case 'amm-rr-remove': {
      const pair = rrPairKey(e.runeId!, e.otherRuneId!)
      return ammRrRemoveMessage(network, e.from!, pair.a, pair.b, posAmt(e.lp, 'lp'), posAmt(e.minRuneOut ?? '0', 'minRuneOut'), posAmt(e.minOtherOut ?? '0', 'minOtherOut'), e.nonce!)
    }
    case 'amm-rr-swap': {
      const pair = rrPairKey(e.runeId!, e.otherRuneId!)
      const pay = canonicalRuneKey(e.payRuneId!)
      return ammRrSwapMessage(network, e.from!, pair.a, pair.b, pay, posAmt(e.amount, 'amountIn'), posAmt(e.minOut ?? '0', 'minOut'), e.nonce!)
    }
    case 'contract': {
      const codeHash = sha256hex(canonicalCode(e.code!))
      return e.star !== undefined
        ? contractMessageV2(network, e.from!, codeHash, BigInt(e.star))
        : contractMessage(network, e.from!, codeHash)
    }
    case 'eternize': return eternizeMessage(network, e.from!, BigInt(e.star!), e.l1InscriptionId!, e.nonce!)
    case 'set-face': return setFaceMessage(network, e.from!, BigInt(e.star!), e.nonce!)
    case 'clear-face': return clearFaceMessage(network, e.from!, e.nonce!)
    case 'star-like': {
      const tipRaw = typeof e.tipAsset === 'string' ? e.tipAsset : ''
      const tip = (tipRaw === 'kray' || tipRaw === 'x' || tipRaw === 'rune') ? tipRaw : 'none'
      const amount = tip === 'none' ? null : BigInt(e.amount!)
      const runeId = tip === 'rune' ? String(e.runeId || '') : null
      return starLikeMessage(network, e.from!, BigInt(e.star!), tip, amount, runeId, e.nonce!)
    }
    case 'set-profile': return setProfileMessage(
      network, e.from!,
      typeof e.description === 'string' ? e.description : '',
      typeof e.url === 'string' ? e.url : '',
      typeof e.bannerStar === 'string' ? e.bannerStar : '',
      typeof e.bannerUrl === 'string' ? e.bannerUrl : '',
      e.nonce!,
    )
    case 'set-kray-plate': return setKrayPlateMessage(
      network, e.from!,
      typeof e.plateHash === 'string' ? e.plateHash : '',
      typeof e.star === 'string' ? e.star : '',
      e.nonce!,
    )
    case 'contract-call': {
      const args: Record<string, bigint> = {}
      for (const [kk, val] of Object.entries(e.callArgs ?? {})) {
        if (!/^-?\d+$/.test(val)) throw new Error(`ledger: argument "${kk}" must be a whole number`)
        args[kk] = BigInt(val)
      }
      return e.clock !== undefined
        ? contractCallMessageV2(network, e.from!, e.contract!, e.rule!, args, e.nonce!, e.clock as number)
        : contractCallMessage(network, e.from!, e.contract!, e.rule!, args, e.nonce!)
    }
    default: return null   // unsigned kind (donate/seal/settlement/…) or Lamport-verified quantum-migrate
  }
}

/** The EXACT bytes the author signed — message + the opt-in `|deadline=D` suffix (requireSig's one
 *  choke point). `sha256(this)` IS the act's order key AND its inclusion-SMT leaf (ADR-3 3a). */
export function signedBytesOfEvent(e: KrayEvent, network: string): string | null {
  const message = signedMessageOfEvent(e, network)
  if (message === null) return null
  return e.deadline !== undefined ? `${message}|deadline=${e.deadline}` : message
}
