/**
 * THE FOLD VERIFIER (Gate 2) — the consensus bridge to the vendored WASM Groth16 verifier.
 *
 * The reducer refuses any `fold-seal` it cannot verify (fail-closed): a verifier that required an
 * external toolchain would make honest nodes diverge, so the toolchain-free WASM package built at
 * the forge (`apps/kray-fold/verifier-wasm/pkg` — pure JS + 255 KB WASM, from the vetted
 * `sp1-verifier` crate) is a CONSENSUS dependency, vendored in-repo and loaded lazily here.
 *
 * THE PINNED PROGRAM: `TK_FOLD_VKEY_HASH` is the SP1 verifying-key hash of the ONE guest program
 * (`apps/kray-fold/program`) whose semantics equal `tk-fold.ts` byte-for-byte (proven across the
 * six golden vectors). A valid proof of ANY other program — even a well-formed one — is refused.
 * Changing the guest before activation requires re-pinning this constant in the same ratified
 * commit; changing it after activation is a hard fork, exactly like any consensus law.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The SP1 verifying-key hash of the kray-fold guest (vk.bytes32() at the Gate 1b forge). */
export const TK_FOLD_VKEY_HASH = '0x003242b002be10e3e2b63ca69f6f18a0d49d9d9d08d4252169bc7ef502218d08'

const HEX_RE = /^[0-9a-f]*$/
/** Groth16-wrapped SP1 proofs are ~356 bytes; anything past this bound is hostile, not a proof. */
const MAX_PROOF_HEX = 4096
/** The committed public values are bincode(String) of a small JSON — bounded by construction. */
const MAX_PUBLIC_HEX = 8192

type VerifyFn = (proof: Uint8Array, publicInputs: Uint8Array, vkHash: string) => boolean
let _verify: VerifyFn | null = null

/** Load the vendored WASM verifier ONCE, lazily — a dormant network never pays the load, and a node
 *  missing the package HALTs on its first fold-seal instead of accepting it (fail-closed). */
function wasmVerify(): VerifyFn {
  if (_verify) return _verify
  const here = dirname(fileURLToPath(import.meta.url))
  const require = createRequire(import.meta.url)
  try {
    const pkg = require(join(here, '../../../kray-fold/verifier-wasm/pkg/kray_fold_verifier_wasm.js')) as { verify_groth16: VerifyFn }
    _verify = pkg.verify_groth16
    return _verify
  } catch (err) {
    throw new Error(`fold-verifier: the vendored WASM verifier failed to load (${(err as Error)?.message ?? err}) — a fold-seal cannot be verified, so it cannot exist (fail-closed)`)
  }
}

/** The fold proof's public outputs, as the guest commits them (bincode(String) of this JSON). */
export interface FoldPublicOutputs {
  network: string
  preRoot: string
  postRoot: string
  diffsHash: string
  laneTotal: string
  applied: number
  refused: number
  deferred: number
}

/** Decode the committed public values: an 8-byte LE length prefix, then the UTF-8 JSON. Returns
 *  undefined on ANY malformation — the caller refuses (hostile bytes never become an exception path). */
export function decodeFoldPublic(publicHex: string): FoldPublicOutputs | undefined {
  if (typeof publicHex !== 'string' || publicHex.length === 0 || publicHex.length > MAX_PUBLIC_HEX
    || publicHex.length % 2 !== 0 || !HEX_RE.test(publicHex)) return undefined
  const buf = Buffer.from(publicHex, 'hex')
  if (buf.length < 9) return undefined
  const len = buf.readBigUInt64LE(0)
  if (len !== BigInt(buf.length - 8)) return undefined
  let parsed: unknown
  try { parsed = JSON.parse(buf.subarray(8).toString('utf8')) } catch { return undefined }
  const p = parsed as Record<string, unknown>
  const isHex64 = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)
  const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
  if (typeof p.network !== 'string' || !isHex64(p.preRoot) || !isHex64(p.postRoot) || !isHex64(p.diffsHash)
    || typeof p.laneTotal !== 'string' || !/^(0|[1-9][0-9]*)$/.test(p.laneTotal)
    || !isCount(p.applied) || !isCount(p.refused) || !isCount(p.deferred)) return undefined
  return p as unknown as FoldPublicOutputs
}

/** Verify a Groth16 fold proof against its committed public values and THE pinned program.
 *  Returns false on any malformation; throws ONLY when the verifier itself is unavailable
 *  (a node that cannot verify must halt, never accept). */
export function verifyFoldProof(proofHex: string, publicHex: string): boolean {
  if (typeof proofHex !== 'string' || proofHex.length === 0 || proofHex.length > MAX_PROOF_HEX
    || proofHex.length % 2 !== 0 || !HEX_RE.test(proofHex)) return false
  if (typeof publicHex !== 'string' || publicHex.length === 0 || publicHex.length > MAX_PUBLIC_HEX
    || publicHex.length % 2 !== 0 || !HEX_RE.test(publicHex)) return false
  const verify = wasmVerify()
  return verify(Buffer.from(proofHex, 'hex'), Buffer.from(publicHex, 'hex'), TK_FOLD_VKEY_HASH)
}
